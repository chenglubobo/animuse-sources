/**
 * 源目录脚本的共用工具（零依赖，Node 18+）
 *
 * 这个目录会被**整体复制成一个独立仓库**，所以：
 *   · 不做任何跨仓库引用；
 *   · 所有路径都相对本文件的上一级（= 目录仓库根）；
 *   · 只用 node: 内置模块。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 目录仓库根（本文件位于 <root>/scripts/） */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 源名：必须能安全拼进 URL 路径，与客户端 / check.mjs 保持一致 */
export const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
/** 客户端当前支持的源/规则能力代际，高于它会被拒绝加载 */
export const CLIENT_SOURCE_API_LEVEL = 1
/** 版本号：数字段，客户端按段比较（1.10.0 > 1.9.0） */
export const VERSION_PATTERN = /^v?\d+(\.\d+)*$/

export function indexPath(root = ROOT) {
  return resolve(root, 'index.json')
}

export function sourcePath(name, root = ROOT) {
  return resolve(root, `${name}.json`)
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** 统一写盘格式：2 空格缩进 + 结尾换行（与仓库里现有文件一致，diff 干净） */
export function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function readIndex(root = ROOT) {
  const path = indexPath(root)
  if (!existsSync(path)) throw new Error(`${path} 不存在：目录仓库根必须有 index.json`)
  const index = readJson(path)
  if (!index || typeof index !== 'object' || Array.isArray(index)) {
    throw new Error('index.json 必须是一个 JSON 对象')
  }
  if (!Array.isArray(index.sources)) throw new Error('index.json 缺少 sources 数组')
  return index
}

/** 写回 index.json，并顺手刷新 updatedAt */
export function saveIndex(index, root = ROOT) {
  index.updatedAt = new Date().toISOString()
  writeJson(indexPath(root), index)
}

export function findEntry(index, name) {
  return index.sources.find((entry) => entry && entry.name === name)
}

/** 版本号自增：--major / --minor / --patch */
export function bumpVersion(version, part) {
  const numbers = version.replace(/^v/, '').split('.').map((n) => Number(n))
  while (numbers.length < 3) numbers.push(0)
  if (part === 'major') return `${numbers[0] + 1}.0.0`
  if (part === 'minor') return `${numbers[0]}.${numbers[1] + 1}.0`
  return `${numbers[0]}.${numbers[1]}.${numbers[2] + 1}`
}

/* --------------------------------- Git --------------------------------- */

export function isGitRepo(root = ROOT) {
  return existsSync(resolve(root, '.git'))
}

/** 直接读 .git/config，避免依赖 git 子进程（也便于在无 git 环境给出提示） */
export function readGitRemote(root = ROOT, remote = 'origin') {
  const configPath = resolve(root, '.git', 'config')
  if (!existsSync(configPath)) return null
  let inSection = false
  for (const line of readFileSync(configPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    const section = /^\[remote "(.+)"\]$/.exec(trimmed)
    if (section) {
      inSection = section[1] === remote
      continue
    }
    if (trimmed.startsWith('[')) {
      inSection = false
      continue
    }
    if (!inSection) continue
    const pair = /^url\s*=\s*(.+)$/.exec(trimmed)
    if (pair) return pair[1].trim()
  }
  return null
}

/** 读 .git/HEAD 得到当前分支名（detached 时返回 null） */
export function readGitBranch(root = ROOT) {
  const headPath = resolve(root, '.git', 'HEAD')
  if (!existsSync(headPath)) return null
  const match = /^ref:\s*refs\/heads\/(.+)$/.exec(readFileSync(headPath, 'utf8').trim())
  return match ? match[1] : null
}

/**
 * 运行 git：stdio 走 inherit（原样透传到用户终端），返回是否成功。
 * 永远不拼 --force / --hard 这类破坏性参数。
 */
export function runGit(args, root = ROOT) {
  const result = spawnSync('git', args, { cwd: root, stdio: 'inherit' })
  return result.status === 0
}

/** 静默运行 git（只需要退出码时用，例如判断有没有暂存改动） */
export function runGitQuiet(args, root = ROOT) {
  const result = spawnSync('git', args, { cwd: root, stdio: 'ignore' })
  return result.status
}

/* ----------------------------- 规则校验 ----------------------------- */

/**
 * 校验一份规则式源的「说明书」（mode: "rule" 的 rule 字段）。
 *
 * 与客户端 src/rules/validate.ts 的 parseRule **同一套判定**：
 * 这里能过的，客户端就能加载；这里拦下的，客户端也会丢弃（或在安装时报错）。
 * new.mjs（发布）与 check.mjs（校验目录）都用它，避免两处标准漂移。
 *
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateRuleSource(rule, options = {}) {
  const errors = []
  const warnings = []
  const fileName = options.name

  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    return { errors: ['rule 必须是一个 JSON 对象'], warnings }
  }

  // 本客户端不执行规则里的任何脚本（与 Kazumi 的取舍不同），这是硬线
  // 真正危险的脚本字段：出现即拒绝
  for (const field of ['captchaScript', 'captchaScripts', 'script', 'scripts', 'eval', 'preload']) {
    if (rule[field] !== undefined) {
      errors.push(`规则包含脚本类字段 "${field}"：客户端不执行规则里的任何脚本`)
    }
  }
  // 反爬配置块：Kazumi 的规则文件总是带它（哪怕没启用），客户端忽略即可 → 只告警
  if (rule.antiCrawlerConfig !== undefined) {
    warnings.push('规则带 antiCrawlerConfig：客户端会忽略它（不支持验证码交互），遇到验证页时这条源会失败')
  }

  if (typeof rule.name !== 'string' || !NAME_PATTERN.test(rule.name)) {
    errors.push('rule.name 不合法（只允许字母或数字开头、最多 64 位的 A-Za-z0-9._-）')
  } else if (fileName && rule.name !== fileName) {
    warnings.push(`rule.name（${rule.name}）与文件名不一致；客户端以文件名为准`)
  }

  if (typeof rule.version !== 'string' || !rule.version.trim()) {
    errors.push('rule.version 缺失')
  }

  if (rule.api !== undefined && (!Number.isInteger(rule.api) || rule.api > CLIENT_SOURCE_API_LEVEL)) {
    errors.push(`rule.api 高于客户端代际 ${CLIENT_SOURCE_API_LEVEL}，客户端会拒绝加载`)
  }

  const modes = ['xpath', 'api']
  if (!modes.includes(rule.searchMode)) errors.push('rule.searchMode 必须是 "xpath" 或 "api"')
  if (!modes.includes(rule.chapterMode)) errors.push('rule.chapterMode 必须是 "xpath" 或 "api"')

  if (typeof rule.baseURL !== 'string' || !rule.baseURL.trim()) {
    errors.push('rule.baseURL 必填（用于补全相对链接）')
  }

  // XPath 选择器一律要求绝对路径（与客户端 selectors.ts 同义）
  // 接受 // 、.// 、/self:: —— 这三类在真实规则里都出现过（裸相对路径不接受）
  for (const field of ['searchList', 'searchName', 'searchResult', 'chapterRoads', 'chapterResult']) {
    const value = rule[field]
    if (typeof value === 'string' && value.trim() && !/^\s*(\/\/|\.\/|\.\/\/|\/self::)/.test(value)) {
      errors.push(`rule.${field} 必须以 // 、.// 或 /self:: 开头（不接受裸相对路径）`)
    }
  }

  if (rule.searchMode === 'xpath') {
    for (const field of ['searchURL', 'searchList', 'searchName', 'searchResult']) {
      if (typeof rule[field] !== 'string' || !rule[field].trim()) {
        errors.push(`XPath 搜索模式需要 rule.${field}`)
      }
    }
  } else if (rule.searchMode === 'api') {
    const search = rule.searchApiConfig
    if (!search || typeof search !== 'object') {
      errors.push('API 搜索模式需要 rule.searchApiConfig')
    } else {
      if (!search.request || typeof search.request.url !== 'string' || !search.request.url.trim()) {
        errors.push('searchApiConfig.request.url 必填')
      }
      for (const field of ['listPath', 'namePath', 'sourcePath']) {
        if (typeof search[field] !== 'string' || !search[field].trim()) {
          errors.push(`searchApiConfig.${field} 必填`)
        }
      }
    }
  }

  if (rule.chapterMode === 'xpath') {
    for (const field of ['chapterRoads', 'chapterResult']) {
      if (typeof rule[field] !== 'string' || !rule[field].trim()) {
        errors.push(`XPath 选集模式需要 rule.${field}`)
      }
    }
  } else if (rule.chapterMode === 'api') {
    const chapter = rule.chapterApiConfig
    if (!chapter || typeof chapter !== 'object') {
      errors.push('API 选集模式需要 rule.chapterApiConfig')
    } else {
      if (!chapter.request || typeof chapter.request.url !== 'string' || !chapter.request.url.trim()) {
        errors.push('chapterApiConfig.request.url 必填')
      }
      // roadNamePath / episodeNamePath 可缺省或为空（界面用「线路 N / 第 N 集」兜底）
      for (const field of ['roadsPath', 'episodesPath', 'episodeUrlPath']) {
        if (typeof chapter[field] !== 'string' || !chapter[field].trim()) {
          errors.push(`chapterApiConfig.${field} 必填`)
        }
      }
      for (const field of ['roadNamePath', 'episodeNamePath']) {
        if (typeof chapter[field] !== 'string' || !chapter[field].trim()) {
          warnings.push(`chapterApiConfig.${field} 缺省或为空：界面里会用兜底名字`)
        }
      }
      if (!chapter.episodePage || typeof chapter.episodePage.url !== 'string' || !chapter.episodePage.url.trim()) {
        errors.push('chapterApiConfig.episodePage.url 必填（播放页模板）')
      }
    }
  }

  // JSONPath 子集：递归 / 过滤 / 切片都不支持（客户端遇到会直接抛错）
  for (const [path, field] of [
    [rule.searchApiConfig?.listPath, 'searchApiConfig.listPath'],
    [rule.searchApiConfig?.namePath, 'searchApiConfig.namePath'],
    [rule.searchApiConfig?.sourcePath, 'searchApiConfig.sourcePath'],
    [rule.chapterApiConfig?.roadsPath, 'chapterApiConfig.roadsPath'],
    [rule.chapterApiConfig?.roadNamePath, 'chapterApiConfig.roadNamePath'],
    [rule.chapterApiConfig?.episodesPath, 'chapterApiConfig.episodesPath'],
    [rule.chapterApiConfig?.episodeNamePath, 'chapterApiConfig.episodeNamePath'],
    [rule.chapterApiConfig?.episodeUrlPath, 'chapterApiConfig.episodeUrlPath'],
  ]) {
    if (typeof path !== 'string' || !path.trim()) continue
    if (path.includes('..')) errors.push(`${field}: 不支持递归下降 $..`)
    if (path.includes('?') || path.includes(':')) errors.push(`${field}: 不支持过滤或切片表达式`)
    if (!path.trim().startsWith('$')) errors.push(`${field}: JSONPath 必须以 $ 开头`)
  }

  return { errors, warnings }
}

/* -------------------------------- 输出 -------------------------------- */

export function ok(message) {
  console.log(`✓ ${message}`)
}

export function notice(message) {
  console.log(`  ${message}`)
}

export function abort(message, hint) {
  console.error(`✗ ${message}`)
  if (hint) console.error(`  ${hint}`)
  process.exitCode = 1
}

/** 极简参数解析：--key value / --flag */
export function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next
      i += 1
    } else {
      flags[key] = true
    }
  }
  return { positional, flags }
}
