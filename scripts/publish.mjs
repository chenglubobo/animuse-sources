#!/usr/bin/env node
/**
 * 一键发布：先自检，再提交（可选推送）
 *
 *   node scripts/publish.mjs                     # 自检 + git add + commit
 *   node scripts/publish.mjs --init              # 还不是 git 仓库时顺便 git init -b main
 *   node scripts/publish.mjs --push              # 提交后推 origin 当前分支
 *   node scripts/publish.mjs --message "…"       # 自定义提交信息
 *   node scripts/publish.mjs --dry-run           # 只打印将要执行的命令
 *
 * 纪律：
 *   · 校验有 error 时**绝不**提交（坏源进主干比晚发布一次贵得多）；
 *   · 不执行任何破坏性 git 操作（没有 force / hard reset / 覆盖远端历史）；
 *   · 推送只推当前分支到 origin，不猜远端、不改远端配置。
 */
import {
  ROOT,
  abort,
  isGitRepo,
  notice,
  ok,
  parseArgs,
  readGitBranch,
  readGitRemote,
  runGit,
  runGitQuiet,
} from './lib.mjs'
import { checkCatalog } from './check.mjs'

const { flags } = parseArgs(process.argv.slice(2))
const dryRun = flags['dry-run'] === true
const wantInit = flags.init === true
const wantPush = flags.push === true
const message =
  typeof flags.message === 'string' && flags.message.trim()
    ? flags.message.trim()
    : null

/* ------------------------------ 1. 先自检 ------------------------------ */

const result = checkCatalog(ROOT)
console.log(`校验：${result.sources.length} 条源`)
for (const source of result.sources) {
  console.log(`  ✓ ${source.file}  (${source.kind}${source.hasVariables ? ', 含变量' : ', 固定地址'})`)
}
for (const warning of result.warnings) console.log(`  ! ${warning.file}: ${warning.message}`)
for (const error of result.errors) console.log(`  ✗ ${error.file}: ${error.message}`)

if (result.errors.length) {
  abort(`${result.errors.length} 个 error：坏源不提交`, '修好后重跑 node scripts/check.mjs')
  process.exit()
}
ok('校验通过')

/* --------------------------- 2. 生成提交信息 --------------------------- */

const counts = new Map()
for (const source of result.sources) counts.set(source.kind, (counts.get(source.kind) ?? 0) + 1)
const summary = [...counts.entries()].map(([kind, count]) => `${kind} ${count}`).join(' / ')
const commitMessage = message ?? `chore: 更新源目录（${result.sources.length} 条源：${summary}）`

/* ------------------------------ 3. git 流程 ---------------------------- */

if (!isGitRepo(ROOT)) {
  if (!wantInit) {
    abort('这里还不是 git 仓库', '加 --init 让我初始化（git init -b main），或先自己 git init')
    process.exit()
  }
  const plan = ['git init -b main', 'git add -A', `git commit -m "${commitMessage}"`]
  if (wantPush) plan.push(`git push -u origin ${readGitBranch(ROOT) ?? 'main'}`)
  if (dryRun) {
    console.log('\n[dry-run] 将执行：')
    for (const step of plan) console.log(`  ${step}`)
    process.exitCode = 0
    process.exit()
  }
  console.log('')
  if (!runGit(['init', '-b', 'main'])) {
    abort('git init 失败')
    process.exit()
  }
}

if (dryRun) {
  console.log('\n[dry-run] 将执行：')
  console.log('  git add -A')
  console.log(`  git commit -m "${commitMessage}"`)
  if (wantPush) console.log(`  git push -u origin ${readGitBranch(ROOT) ?? 'main'}`)
  process.exitCode = 0
  process.exit()
}

if (!runGit(['add', '-A'])) {
  abort('git add 失败')
  process.exit()
}

// `git diff --cached --quiet`：0 = 暂存区没变化，1 = 有变化
const staged = runGitQuiet(['diff', '--cached', '--quiet'])
if (staged === 0) {
  ok('没有需要提交的改动（源头已是最新）')
} else {
  console.log('')
  if (!runGit(['commit', '-m', commitMessage])) {
    abort(
      'git commit 失败',
      '常见原因：没配提交身份。执行 git config --global user.name "你的名字" 与 user.email "you@example.com" 后重试',
    )
    process.exit()
  }
  ok('已提交')
}

/* -------------------------------- 4. 推送 ------------------------------ */

if (!wantPush) {
  console.log('\n下一步：')
  console.log('  node scripts/publish.mjs --push     # 推到 origin')
  console.log('  node scripts/url.mjs                # 拿到填进 Animuse 的地址')
  process.exitCode = 0
  process.exit()
}

const remote = readGitRemote(ROOT)
if (!remote) {
  abort('没有 origin 远端，无法推送', '先加远端：git remote add origin git@github.com:<你>/<仓库>.git')
  process.exit()
}

const branch = readGitBranch(ROOT) ?? 'main'
console.log('')
if (!runGit(['push', '-u', 'origin', branch])) {
  abort(
    '推送失败',
    '检查远端权限与分支保护；这里不会替你 force push，需要合并远端改动请手动处理',
  )
  process.exit()
}
ok(`已推送到 origin/${branch}`)

notice(`远端：${remote}`)
console.log('\n最后一步：node scripts/url.mjs  → 把地址填进 Animuse')
