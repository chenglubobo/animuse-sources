#!/usr/bin/env node
/**
 * index.json 生成器（零依赖，Node 18+）
 *
 *   node scripts/generate-index.mjs            # 按目录里的 *.json 重建 index.json
 *   node scripts/generate-index.mjs --check    # 只检查是否同步（CI 用，不同步退出码 1）
 *   node scripts/generate-index.mjs --dry-run  # 打印结果但不写盘
 *
 * 为什么需要它：KazumiRules 的 index.json 是 CI 自动生成的，手写迟早会漏登记 ——
 * 而漏登记的源在客户端**根本不会出现**（不报错，最容易被忽略）。
 *
 * 保留策略（不会覆盖你手写的东西）：
 *   · sources 数组按 name 排序重建
 *   · 每条已存在的条目：保留 summary / tags，version 以 **文件里的为准**（文件才是事实来源）
 *   · api 字段保留旧值（缺省 1）
 *   · updatedAt 刷新为当前时间（--check 时忽略这个字段）
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** 读取目录里所有源文件（跳过 index.json），返回 { name, version, requires } */
export function readSourceFiles(dir) {
  const files = readdirSync(dir).filter((file) => file.endsWith('.json') && file !== 'index.json')
  const out = []

  for (const file of files) {
    const name = basename(file, '.json')
    let raw
    try {
      raw = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    } catch (err) {
      out.push({ name, file, error: `不是合法 JSON：${err.message}` })
      continue
    }
    out.push({
      name,
      file,
      version: typeof raw?.version === 'string' ? raw.version : undefined,
      requires:
        Number.isInteger(raw?.requires) && raw.requires > 0 ? raw.requires : undefined,
      error: raw?.name !== name ? `文件里的 name（${JSON.stringify(raw?.name)}）与文件名不一致` : undefined,
    })
  }

  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** 生成 index 对象；existing 用于保留 summary/tags/api */
export function buildIndex(dir, existing, now = new Date()) {
  const previous = new Map(
    (Array.isArray(existing?.sources) ? existing.sources : [])
      .filter((entry) => entry && typeof entry.name === 'string')
      .map((entry) => [entry.name, entry]),
  )

  const sources = []
  for (const item of readSourceFiles(dir)) {
    if (item.error) continue // 坏文件交给 check.mjs 报错，这里不掩盖
    const old = previous.get(item.name)
    sources.push({
      name: item.name,
      version: item.version ?? old?.version ?? '1.0.0',
      ...(typeof old?.summary === 'string' ? { summary: old.summary } : {}),
      ...(item.requires !== undefined ? { requires: item.requires } : old?.requires !== undefined ? { requires: old.requires } : {}),
      ...(Array.isArray(old?.tags) ? { tags: old.tags } : {}),
    })
  }

  return {
    api: Number.isInteger(existing?.api) ? existing.api : 1,
    updatedAt: now.toISOString(),
    sources,
  }
}

/** --check 用：忽略 updatedAt 后逐字段比较 */
export function isIndexUpToDate(current, expected) {
  const strip = (value) => JSON.stringify({ ...value, updatedAt: undefined })
  return strip(current) === strip(expected)
}

function findDir(argv) {
  const explicit = argv.find((arg) => !arg.startsWith('--') && !arg.endsWith('.mjs'))
  if (explicit) return resolve(explicit)
  return resolve(fileURLToPath(import.meta.url), '..', '..')
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const argv = process.argv.slice(2)
  const dir = findDir(argv)
  const checkOnly = argv.includes('--check')
  const dryRun = argv.includes('--dry-run') || checkOnly

  const indexPath = join(dir, 'index.json')
  const existing = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : {}
  const next = buildIndex(dir, existing)
  const text = `${JSON.stringify(next, null, 2)}\n`

  if (dryRun) {
    if (isIndexUpToDate(existing, next)) {
      console.log(`index.json 已与 ${next.sources.length} 个源文件同步（${next.sources.map((s) => s.name).join(', ')}）`)
      process.exitCode = 0
    } else {
      console.log('index.json 与源文件不同步，需要执行：node scripts/generate-index.mjs')
      console.log(text)
      process.exitCode = 1
    }
  } else {
    writeFileSync(indexPath, text, 'utf8')
    console.log(`已写入 index.json：${next.sources.length} 条源（${next.sources.map((s) => s.name).join(', ')}）`)
  }
}
