#!/usr/bin/env node
/**
 * 源目录校验器（零依赖，Node 18+）
 *
 *   node scripts/check.mjs               # 校验脚本所在仓库根目录
 *   node scripts/check.mjs ../other      # 校验指定目录
 *   node scripts/check.mjs --json        # 机器可读输出（给 CI 用）
 *
 * 校验的是 **Animuse 客户端真正会执行的规则**，不是更宽松的「看起来像 JSON」：
 *   · index.json 结构 / api 代际 / 名称合法性与唯一性
 *   · {name}.json 必须存在，且其中声明的 name 与文件名一致（客户端会直接丢弃不一致的源）
 *   · requires 不得高于客户端代际，否则客户端会拒绝安装（等于白推）
 *   · urlTemplate 非空、变量只能是已知的 5 个、http:// 与可疑写法给出提示
 *   · referer / userAgent 长度与字符校验（CR-LF 注入会被服务端清洗掉，等于字段失效）
 *   · {name}.json 里的 version 必须与 index.json 一致（不一致 = 用户永远收不到这次更新）
 *
 * 配套脚本：new.mjs（新增源）· bump.mjs（改版本，自动同步两处）· url.mjs（推导要填的目录地址）
 *          · publish.mjs（先自检，再 git 提交/推送）
 *
 * 退出码：有 error → 1，仅 warning → 0。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { CLIENT_SOURCE_API_LEVEL, validateRuleSource } from './lib.mjs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 客户端当前支持的源能力代际（定义在 lib.mjs，这里重新导出，保持原有导入路径可用） */
export { CLIENT_SOURCE_API_LEVEL }
/** 本校验器认识的目录格式代际 */
export const CATALOG_API = 1
/** 客户端只接受这种源名（要能安全拼进 URL 路径） */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const KNOWN_VARIABLES = new Set(['title', 'titleCN', 'id', 'ep', 'epName'])
const MAX_USER_AGENT_LENGTH = 256

function checkSourceFile(dir, entry, errors, warnings, summary) {
  const file = `${entry.name}.json`
  const path = join(dir, file)

  if (!existsSync(path)) {
    errors.push({ file, message: '目录里登记了，但文件不存在' })
    return
  }

  let raw
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    errors.push({ file, message: `不是合法 JSON：${err.message}` })
    return
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push({ file, message: '必须是一个 JSON 对象' })
    return
  }

  // 完整性：客户端要求文件里声明的 name 与目录项完全一致
  if (raw.name !== entry.name) {
    errors.push({
      file,
      message: `name 必须与文件名一致（目录里是 "${entry.name}"，文件里是 ${JSON.stringify(raw.name)}）`,
    })
  }

  // 版本一致性：客户端按 index.json 的 version 判断「有没有更新」，
  // 两处不一致会让人以为改了源，实际用户永远收不到更新。
  if (typeof raw.version !== 'string' || !raw.version.trim()) {
    errors.push({
      file,
      message: `version 缺失或为空（用 node scripts/bump.mjs ${entry.name} --patch 生成/同步）`,
    })
  } else if (typeof entry.version === 'string' && raw.version.trim() !== entry.version.trim()) {
    errors.push({
      file,
      message: `version 必须与 index.json 一致（目录里是 ${entry.version}，文件里是 ${raw.version}）；改完源跑 node scripts/bump.mjs ${entry.name} --patch`,
    })
  }

  // ---- 规则式源（mode: "rule"）：没有地址模板，校验的是说明书 ----
  // 判定逻辑与 new.mjs / 客户端 src/rules/validate.ts 共用一份，避免两处标准漂移。
  const isRule = raw.mode === 'rule' || (raw.rule !== undefined && raw.rule !== null)
  if (isRule) {
    if (!raw.rule || typeof raw.rule !== 'object' || Array.isArray(raw.rule)) {
      errors.push({ file, message: 'mode="rule" 时必须有 rule 对象（规则说明书）' })
    } else {
      const result = validateRuleSource(raw.rule, { name: entry.name })
      for (const message of result.errors) errors.push({ file, message })
      for (const message of result.warnings) warnings.push({ file, message })
    }

    // 规则源没有模板，后面的模板校验整段跳过
    summary.push({ name: entry.name, version: entry.version, kind: 'rule', file, hasVariables: false })
    return
  }


  const template = typeof raw.urlTemplate === 'string' ? raw.urlTemplate.trim() : ''
  if (!template) {
    errors.push({ file, message: 'urlTemplate 缺失或为空' })
  } else {
    if (!/^https?:\/\//i.test(template)) {
      errors.push({ file, message: 'urlTemplate 必须是绝对地址（http:// 或 https:// 开头）' })
    } else if (template.startsWith('http://')) {
      warnings.push({ file, message: 'urlTemplate 用的是 http://，客户端只能经代理播放，且明文传输有风险' })
    }

    const variables = [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1])
    for (const name of variables) {
      if (!KNOWN_VARIABLES.has(name)) {
        errors.push({
          file,
          message: `未知变量 {${name}}，客户端不会替换它（可用：${[...KNOWN_VARIABLES].join(' ')}）`,
        })
      }
    }
    if (!variables.length) {
      warnings.push({ file, message: '地址里没有任何变量 —— 所有集数都会播放同一个地址（单片源可忽略）' })
    }
  }

  const kind = raw.kind ?? 'hls'
  if (kind !== 'hls' && kind !== 'file') {
    errors.push({ file, message: `kind 只能是 "hls" 或 "file"，当前是 ${JSON.stringify(raw.kind)}` })
  }

  if (raw.proxy === false) {
    warnings.push({ file, message: 'proxy=false：不走同源代理，跨域/防盗链源会直接失败，实时超分也无法工作' })
  }

  if (raw.referer !== undefined && typeof raw.referer !== 'string') {
    errors.push({ file, message: 'referer 必须是字符串' })
  }
  if (typeof raw.userAgent === 'string') {
    if (raw.userAgent.length > MAX_USER_AGENT_LENGTH) {
      errors.push({ file, message: `userAgent 超过 ${MAX_USER_AGENT_LENGTH} 字符，客户端会忽略它` })
    }
    if (/[\r\n]/.test(raw.userAgent)) {
      errors.push({ file, message: 'userAgent 含 CR/LF，会被服务端清洗掉（等于字段失效）' })
    }
  }

  const requires = raw.requires ?? entry.requires
  if (requires !== undefined) {
    if (!Number.isInteger(requires) || requires < 1) {
      errors.push({ file, message: 'requires 必须是 >= 1 的整数' })
    } else if (requires > CLIENT_SOURCE_API_LEVEL) {
      errors.push({
        file,
        message: `requires=${requires} 高于客户端代际 ${CLIENT_SOURCE_API_LEVEL}，客户端会拒绝安装`,
      })
    }
  }

  summary.push({
    name: entry.name,
    version: entry.version,
    kind,
    file,
    hasVariables: /\{\w+\}/.test(template),
  })
}

/** 校验一个目录仓库，返回 { errors, warnings, sources }（不打印、不退出，方便被测试直接调用） */
export function checkCatalog(dir) {
  const errors = []
  const warnings = []
  const sources = []

  const indexPath = join(dir, 'index.json')
  if (!existsSync(indexPath)) {
    errors.push({ file: 'index.json', message: '不存在（目录根必须有 index.json）' })
    return { errors, warnings, sources }
  }

  let index
  try {
    index = JSON.parse(readFileSync(indexPath, 'utf8'))
  } catch (err) {
    errors.push({ file: 'index.json', message: `不是合法 JSON：${err.message}` })
    return { errors, warnings, sources }
  }

  if (!index || typeof index !== 'object' || Array.isArray(index)) {
    errors.push({ file: 'index.json', message: '必须是一个 JSON 对象' })
    return { errors, warnings, sources }
  }

  if (index.api !== undefined) {
    if (!Number.isInteger(index.api) || index.api < 1) {
      errors.push({ file: 'index.json', message: 'api 必须是 >= 1 的整数' })
    } else if (index.api > CATALOG_API) {
      errors.push({
        file: 'index.json',
        message: `api=${index.api} 高于本校验器支持的 ${CATALOG_API}，客户端可能整份忽略该目录`,
      })
    }
  } else {
    warnings.push({ file: 'index.json', message: '建议显式写 "api": 1' })
  }

  if (typeof index.updatedAt !== 'string') {
    warnings.push({ file: 'index.json', message: '建议写 updatedAt（RFC3339），便于使用者判断新鲜度' })
  }

  if (!Array.isArray(index.sources) || index.sources.length === 0) {
    errors.push({ file: 'index.json', message: 'sources 必须是非空数组' })
    return { errors, warnings, sources }
  }

  const seen = new Set()
  for (const [position, entry] of index.sources.entries()) {
    const where = `index.sources[${position}]`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push({ file: 'index.json', message: `${where} 必须是对象` })
      continue
    }
    if (typeof entry.name !== 'string' || !NAME_PATTERN.test(entry.name)) {
      errors.push({
        file: 'index.json',
        message: `${where}.name 不合法（只允许字母/数字开头、最多 64 位的 A-Za-z0-9._-）`,
      })
      continue
    }
    if (seen.has(entry.name)) {
      errors.push({ file: 'index.json', message: `${where}.name "${entry.name}" 重复` })
      continue
    }
    seen.add(entry.name)

    if (typeof entry.version !== 'string' || !/^v?\d+(\.\d+)*$/.test(entry.version)) {
      errors.push({
        file: 'index.json',
        message: `${where}.version 必须是数字段版本号（如 1.0.0），当前是 ${JSON.stringify(entry.version)}`,
      })
    }
    if (entry.requires !== undefined && (!Number.isInteger(entry.requires) || entry.requires < 1)) {
      errors.push({ file: 'index.json', message: `${where}.requires 必须是 >= 1 的整数` })
    }

    checkSourceFile(dir, entry, errors, warnings, sources)
  }

  // 反向检查：仓库里有 JSON 文件却没登记，使用者会以为它没生效
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json') || file === 'index.json') continue
    const name = basename(file, '.json')
    if (!seen.has(name)) {
      warnings.push({ file, message: '文件存在但没有登记在 index.json 里（客户端不会看到它）' })
    }
  }

  return { errors, warnings, sources }
}

/* ------------------------------- CLI ------------------------------- */

function findDirArg(argv) {
  const explicit = argv.find((arg) => !arg.startsWith('--') && !arg.endsWith('.mjs'))
  if (explicit) return resolve(explicit)
  // 默认：脚本所在目录的上一级（即仓库根）
  return resolve(fileURLToPath(import.meta.url), '..', '..')
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const dir = findDirArg(process.argv.slice(2))
  const asJson = process.argv.includes('--json')
  const result = checkCatalog(dir)

  if (asJson) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`源目录校验：${dir}`)
    for (const source of result.sources) {
      console.log(`  ✓ ${source.file}  (${source.kind}${source.hasVariables ? ', 含变量' : ', 固定地址'})`)
    }
    for (const warning of result.warnings) console.log(`  ! ${warning.file}: ${warning.message}`)
    for (const error of result.errors) console.log(`  ✗ ${error.file}: ${error.message}`)
    console.log(
      `\n${result.sources.length} 条源 · ${result.errors.length} error · ${result.warnings.length} warning`,
    )
    if (!result.errors.length) {
      console.log('目录可用。把本仓库 push 到 https 静态托管后，在 Animuse 设置页「在线源目录」填根地址即可。')
    }
  }

  process.exitCode = result.errors.length ? 1 : 0
}
