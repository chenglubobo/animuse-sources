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
