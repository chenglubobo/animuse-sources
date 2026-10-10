#!/usr/bin/env node
/**
 * 改版本号：**同时**更新 {name}.json 与 index.json，避免两处版本不一致
 *
 *   node scripts/bump.mjs <name> --patch     # 1.0.0 → 1.0.1（改了内容必须升版本）
 *   node scripts/bump.mjs <name> --minor     # 1.0.1 → 1.1.0
 *   node scripts/bump.mjs <name> --major     # 1.1.0 → 2.0.0
 *   node scripts/bump.mjs <name> 1.4.0       # 直接指定
 *
 * 为什么必须升版本：客户端只在「目录版本高于本地已装版本」时提示更新。
 * 改了 urlTemplate 而不升版本 = 用户永远收不到这次修改。
 */
import { existsSync } from 'node:fs'
import {
  ROOT,
  VERSION_PATTERN,
  abort,
  bumpVersion,
  findEntry,
  notice,
  ok,
  parseArgs,
  readIndex,
  readJson,
  saveIndex,
  sourcePath,
  writeJson,
} from './lib.mjs'

const { positional, flags } = parseArgs(process.argv.slice(2))
const name = positional[0]
const target = positional[1]

if (!name) {
  abort('缺少源名', '用法：node scripts/bump.mjs <name> --patch | --minor | --major | <版本号>')
  process.exit()
}

const index = readIndex(ROOT)
const entry = findEntry(index, name)
if (!entry) {
  abort(`index.json 里没有 "${name}"`, '新增源请用：node scripts/new.mjs <name> --url "…"')
  process.exit()
}

const path = sourcePath(name, ROOT)
if (!existsSync(path)) {
  abort(`${name}.json 不存在`, 'index.json 登记了但文件缺失，先补齐文件再改版本')
  process.exit()
}
const source = readJson(path)

const part = flags.major ? 'major' : flags.minor ? 'minor' : flags.patch ? 'patch' : null
let next
if (part) {
  next = bumpVersion(entry.version, part)
} else if (target) {
  if (!VERSION_PATTERN.test(target)) {
    abort(`版本号 "${target}" 不合法`, '必须是数字段，如 1.4.0 / 2.0（前缀 v 可选）')
    process.exit()
  }
  next = target
} else {
  abort('没给出新版本', '用 --patch / --minor / --major，或直接写版本号：node scripts/bump.mjs <name> 1.4.0')
  process.exit()
}

const before = entry.version
if (next === before) {
  abort(
    `版本没变（仍是 ${next}）`,
    '客户端只在目录版本更高时才提示更新；要发布新内容请用 --patch / --minor / --major',
  )
  process.exit()
}
source.version = next
entry.version = next
writeJson(path, source)
saveIndex(index, ROOT)

ok(`${name}: ${before} → ${next}（{name}.json 与 index.json 已同步）`)
notice('客户端下次读取目录时会提示「可更新」；用户确认后才生效')
console.log('\n别忘了：node scripts/check.mjs && node scripts/publish.mjs --push')
