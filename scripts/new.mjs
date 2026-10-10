#!/usr/bin/env node
/**
 * 新增一条源（同时写 {name}.json 与 index.json，避免两处不一致）
 *
 *   node scripts/new.mjs <name> --url "https://cdn.example.com/anime/{ep}.m3u8" \
 *     [--referer https://cdn.example.com/] [--ua "Mozilla/5.0 …"] \
 *     [--kind hls|file] [--summary "说明"] [--tags hls,self-hosted]
 *
 * 只创建骨架，不会去访问你填的地址；地址是否真的能播由你自己确认。
 */
import { existsSync } from 'node:fs'
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
  writeJson,
} from './lib.mjs'

const { positional, flags } = parseArgs(process.argv.slice(2))
const name = positional[0]

if (!name) {
  abort('缺少源名', '用法：node scripts/new.mjs <name> --url "https://…/{ep}.m3u8"')
  process.exit()
}
if (!NAME_PATTERN.test(name)) {
  abort(`源名 "${name}" 不合法`, '只允许字母或数字开头、最多 64 位的 A-Za-z0-9._-（要能安全拼进 URL 路径）')
  process.exit()
}

const kind = flags.kind === 'file' ? 'file' : 'hls'
const urlTemplate =
  typeof flags.url === 'string' && flags.url.trim() ? flags.url.trim() : 'https://example.com/anime/{ep}.m3u8'
const referer = typeof flags.referer === 'string' && flags.referer.trim() ? flags.referer.trim() : undefined
const userAgent = typeof flags.ua === 'string' && flags.ua.trim() ? flags.ua.trim() : undefined
const summary = typeof flags.summary === 'string' ? flags.summary : undefined
const tags =
  typeof flags.tags === 'string' && flags.tags.trim()
    ? flags.tags.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 8)
    : undefined

if (userAgent && /[\r\n]/.test(userAgent)) {
  abort('userAgent 里不能有换行', '服务端会清洗掉含 CR/LF 的值，等于该字段失效')
  process.exit()
}

const index = readIndex(ROOT)
if (findEntry(index, name)) {
  abort(`index.json 里已经有 "${name}"`, `改现有源请用：node scripts/bump.mjs ${name} --patch`)
  process.exit()
}
if (existsSync(sourcePath(name, ROOT))) {
  abort(`${name}.json 已存在`, '先删除或改名，避免出现「文件在但没登记」的孤儿文件')
  process.exit()
}

const source = {
  name,
  version: '1.0.0',
  kind,
  urlTemplate,
  ...(referer ? { referer } : {}),
  ...(userAgent ? { userAgent } : {}),
  proxy: true,
  requires: 1,
}

const entry = {
  name,
  version: '1.0.0',
  ...(summary ? { summary } : {}),
  requires: 1,
  ...(tags ? { tags } : {}),
}

writeJson(sourcePath(name, ROOT), source)
index.sources.push(entry)
saveIndex(index, ROOT)

ok(`已创建 ${name}.json 并登记到 index.json（version 1.0.0）`)
notice(`地址模板：${urlTemplate}`)
console.log('\n下一步：')
console.log(`  1. 确认地址真能播（把 {ep} 换成 1 试一次）`)
console.log(`  2. node scripts/check.mjs`)
console.log(`  3. node scripts/publish.mjs --init --push`)
console.log(`  4. node scripts/url.mjs   # 拿到填进 Animuse 的目录地址`)
