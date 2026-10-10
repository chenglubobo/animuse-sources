#!/usr/bin/env node
/**
 * 推导「要填进 Animuse 的目录根地址」
 *
 *   node scripts/url.mjs                          # 从 .git/config 的 origin 推导
 *   node scripts/url.mjs --remote git@github.com:me/animuse-sources.git
 *   node scripts/url.mjs --branch main
 *
 * 只读文件、不发网络请求；拿到的地址要满足：https + 结尾斜杠 + 直接返回 JSON（不要 302 短链）。
 */
import {
  ROOT,
  isGitRepo,
  notice,
  parseArgs,
  readGitBranch,
  readGitRemote,
} from './lib.mjs'

const { flags } = parseArgs(process.argv.slice(2))

/** 把各种写法的远端地址归一成 { host, path }（path 不含前导斜杠、不含 .git） */
function normalizeRemote(url) {
  const ssh = /^git@([^:]+):(.+)$/.exec(url)
  if (ssh) return { host: ssh[1], path: ssh[2].replace(/\.git$/, '') }
  try {
    const parsed = new URL(url)
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(parsed.protocol)) return null
    return {
      host: parsed.hostname,
      path: parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, ''),
    }
  } catch {
    return null
  }
}

/** 各代码托管平台的「raw 直链」前缀 */
const RAW_PREFIX = {
  'github.com': (path, branch) => `https://raw.githubusercontent.com/${path}/${branch}/`,
  'gitee.com': (path, branch) => `https://gitee.com/${path}/raw/${branch}/`,
  'gitcode.com': (path, branch) => `https://raw.gitcode.com/${path}/raw/${branch}/`,
  'gitlab.com': (path, branch) => `https://gitlab.com/${path}/-/raw/${branch}/`,
}

const remoteFlag = typeof flags.remote === 'string' ? flags.remote : null
const remote = remoteFlag ?? readGitRemote(ROOT)
const branch = (typeof flags.branch === 'string' && flags.branch) || readGitBranch(ROOT) || 'main'

console.log('源目录地址推导\n')
console.log(`  仓库根：${ROOT}`)
console.log(`  git 仓库：${isGitRepo(ROOT) ? '是' : '否（还没 git init）'}`)
console.log(``)

if (!remote) {
  console.log('  没能读到远端地址（.git/config 里没有 origin）。')
  console.log('  两种办法：')
  console.log('    1. 先建仓并推送：node scripts/publish.mjs --init --push')
  console.log('    2. 手动告诉它：node scripts/url.mjs --remote git@github.com:<你>/<仓库>.git\n')
  console.log('  如果不用代码托管，而是自建静态托管，填你自己的根地址即可，例如：')
  console.log(`    https://sources.example.com/animuse/     （结尾必须有斜杠）`)
  process.exitCode = 0
} else {
  const normalized = normalizeRemote(remote)
  console.log(`  远端：${remote}`)
  console.log(`  分支：${branch}\n`)

  if (!normalized) {
    console.log('  无法识别这个远端写法。请手动填写你的 https 静态根地址（结尾带斜杠）。')
    process.exitCode = 0
  } else {
    const build = RAW_PREFIX[normalized.host]
    const address = build
      ? build(normalized.path, branch)
      : `https://${normalized.host}/${normalized.path}/${branch}/`
    console.log('  把这一行填进 Animuse：\n')
    console.log(`    ${address}\n`)
    if (!build) {
      console.log('  （这个平台没有内置的 raw 直链规则，上面的地址是推断值；')
      console.log('    自建静态托管时请换成你自己的域名与路径，规则见 README「托管要求」。）\n')
    }
    console.log('  也可以直接粘 index.json 的地址，客户端会自动去掉文件名：')
    console.log(`    ${address}index.json\n`)
  }

  console.log('填写步骤：')
  console.log('  1. Animuse → 设置 → 在线源目录 → 粘贴上面的地址')
  console.log('  2. 点「读取目录」→ 列表里出现「可安装」')
  console.log('  3. 点「安装」→ 播放页的源列表里就能选到它')
  console.log('')
  notice(`推送前先自检：node scripts/check.mjs`)
  notice('地址必须是 https、结尾斜杠、直接 200 返回 JSON（302/301 会被客户端判为失败）')
}
