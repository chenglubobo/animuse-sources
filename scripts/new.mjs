#!/usr/bin/env node
/**
 * 新增一条源（同时写 {name}.json 与 index.json，避免两处不一致）
 *
 * 模板源：
 *   node scripts/new.mjs <name> --url "https://cdn.example.com/anime/{ep}.m3u8" \
 *     [--referer https://cdn.example.com/] [--ua "Mozilla/5.0 …"] \
 *     [--kind hls|file] [--summary "说明"] [--tags hls,self-hosted]
 *
 * 规则式源（地址没有规律时用这种：源里写"怎么搜索、怎么选集"，真实地址由桌面版嗅探）：
 *   node scripts/new.mjs <name> --rule templates/rule-xpath.json [--summary "说明"] [--tags ...]
 *
 * 只创建骨架，不会去访问你填的地址、也不会替你验证规则是否真能用；
 * 能不能播由你自己确认（桌面版里跑一次最快）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  NAME_PATTERN,
  ROOT,
  abort,
  findEntry,
  notice,
  ok,
  parseArgs,
  readIndex,
  saveIndex,
  sourcePath,
  validateRuleSource,
  writeJson,
} from './lib.mjs'

const { positional, flags } = parseArgs(process.argv.slice(2))
const name = positional[0]

if (!name) {
  abort('缺少源名', '用法：node scripts/new.mjs <name> --url "https://…/{ep}.m3u8" 或 --rule path/to/rule.json')
  process.exit()
}
if (!NAME_PATTERN.test(name)) {
  abort(`源名 "${name}" 不合法`, '只允许字母或数字开头、最多 64 位的 A-Za-z0-9._-（要能安全拼进 URL 路径）')
  process.exit()
}

const summary = typeof flags.summary === 'string' ? flags.summary : undefined
const tags =
  typeof flags.tags === 'string' && flags.tags.trim()
    ? flags.tags.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 8)
    : undefined

const isRule = typeof flags.rule === 'string' && flags.rule.trim().length > 0

/* ------------------------------ 组装源对象 ------------------------------ */

let source
let version = '1.0.0'

if (isRule) {
  const rulePath = resolve(process.cwd(), flags.rule)
  if (!existsSync(rulePath)) {
    abort(`规则文件不存在：${rulePath}`, '可以先复制 templates/rule-xpath.json 或 templates/rule-api.json 再改')
    process.exit()
  }

  let rule
  try {
    rule = JSON.parse(readFileSync(rulePath, 'utf8'))
  } catch (err) {
    abort('规则文件不是合法 JSON', err.message)
    process.exit()
  }

  // 源名以文件名/命令行为准（客户端也是这么做的）——先把规则名统一过来，再校验"要写出去的东西"
  if (rule && typeof rule === 'object' && !Array.isArray(rule)) {
    const declared = typeof rule.name === 'string' ? rule.name.trim() : ''
    if (declared && declared !== name) {
      notice(`规则名 "${declared}" 将统一为 "${name}"（客户端以文件名为准）`)
    }
    rule.name = name
  }

  const result = validateRuleSource(rule, { name })
  if (result.errors.length) {
    // 一次调用输出，避免 stdout/stderr 交错导致顺序看起来是乱的
    abort(
      `规则未通过校验（${result.errors.length} 项）`,
      '判定标准与客户端 parseRule 一致 —— 这里不过，客户端也会拒绝：\n  · ' + result.errors.join('\n  · '),
    )
    process.exit()
  }
  for (const message of result.warnings) notice(`提示：${message}`)

  // 版本以规则文件里的为准（客户端按 index 的 version 判断有没有更新）
  if (typeof rule.version === 'string' && /^v?\d+(\.\d+)*$/.test(rule.version.trim())) {
    version = rule.version.trim()
  }

  source = {
    name,
    mode: 'rule',
    version,
    rule,
  }
} else {
  const kind = flags.kind === 'file' ? 'file' : 'hls'
  const urlTemplate =
    typeof flags.url === 'string' && flags.url.trim() ? flags.url.trim() : 'https://example.com/anime/{ep}.m3u8'
  const referer = typeof flags.referer === 'string' && flags.referer.trim() ? flags.referer.trim() : undefined
  const userAgent = typeof flags.ua === 'string' && flags.ua.trim() ? flags.ua.trim() : undefined

  if (userAgent && /[\r\n]/.test(userAgent)) {
    abort('userAgent 里不能有换行', '服务端会清洗掉含 CR/LF 的值，等于该字段失效')
    process.exit()
  }

  source = {
    name,
    version,
    kind,
    urlTemplate,
    ...(referer ? { referer } : {}),
    ...(userAgent ? { userAgent } : {}),
    proxy: true,
    requires: 1,
  }
}

/* ------------------------------ 写入与登记 ------------------------------ */

const index = readIndex(ROOT)
if (findEntry(index, name)) {
  abort(`index.json 里已经有 "${name}"`, `改现有源请用：node scripts/bump.mjs ${name} --patch`)
  process.exit()
}
if (existsSync(sourcePath(name, ROOT))) {
  abort(`${name}.json 已存在`, '先删除或改名，避免出现「文件在但没登记」的孤儿文件')
  process.exit()
}

const entry = {
  name,
  version,
  ...(summary ? { summary } : {}),
  requires: 1,
  ...(tags ? { tags } : {}),
}

writeJson(sourcePath(name, ROOT), source)
index.sources.push(entry)
// 与 generate-index.mjs 的产物保持一致：sources 按 name 排序。
// 不排序的话，CI 里的 `generate-index.mjs --check` 会在每次发布后立刻报"不同步"。
index.sources.sort((a, b) => String(a.name).localeCompare(String(b.name)))
saveIndex(index, ROOT)

ok(`已创建 ${name}.json 并登记到 index.json（version ${version}）`)
if (isRule) {
  notice(`规则模式：${source.rule.searchMode} 搜索 / ${source.rule.chapterMode} 选集`)
  notice(`规则名：${source.rule.name}`)
} else {
  notice(`地址模板：${source.urlTemplate}`)
}

console.log('\n下一步：')
if (isRule) {
  console.log('  1. 在 Animuse 设置页「规则式源」粘贴同一份 JSON 先跑一次（桌面版才能走到嗅探这一步）')
  console.log('  2. 确认能搜到作品、选集正确后，再发布出去')
} else {
  console.log('  1. 确认地址真能播（把 {ep} 换成 1 试一次）')
}
console.log(`  ${isRule ? 3 : 2}. node scripts/check.mjs`)
console.log(`  ${isRule ? 4 : 3}. node scripts/publish.mjs --init --push`)
console.log(`  ${isRule ? 5 : 4}. node scripts/url.mjs   # 拿到填进 Animuse 的目录地址`)
