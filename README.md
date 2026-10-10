# Animuse 源目录

这是一个**可以独立托管**的 Animuse 在线源目录仓库模板：把它复制成一个新仓库（或丢到任意 https 静态托管），
在 Animuse 的「设置 → 在线源目录」里填根地址，客户端就能拉取目录、比对版本并按需安装源。
以后改这个仓库即可更新源，**不需要重新发版客户端**。

> 目录里只有「地址模板 + 请求头声明」这类数据，**不含任何影视内容**。
> 你放进去的地址会被直接用于播放，请只放你自己确认合法、可信的地址。
> 合规提醒：请遵守你所在地区的法律与站点条款；Animuse 本身不存储、不内置、不传播任何影视内容。

---

## 1. 目录结构

```
.
├── index.json                 # 目录清单（客户端第一个请求的文件）
├── public-test-stream.json    # 示例源：公开测试流，装上就能播，用来验证链路
├── my-static-hls.json         # 示例源：自建静态 HLS 片库（域名要改成你自己的）
├── .gitignore
├── .gitattributes            # 统一 LF 换行（避免 Windows 上反复出现 CRLF 告警）
├── .github/
│   └── workflows/validate.yml # push / PR 时自动跑校验
└── scripts/
    ├── check.mjs              # 零依赖校验器（本地与 CI 共用）
    ├── new.mjs                # 新增一条源（同时写两个文件）
    ├── bump.mjs               # 改版本号（自动同步 index 与 {name}.json）
    ├── url.mjs                # 推导「填进 Animuse 的目录地址」
    ├── publish.mjs            # 一键：先自检，再提交 / 推送
    └── lib.mjs                # 上面几个脚本的共用工具
```

文件**必须放在仓库根目录**：客户端请求的是 `{根地址}{name}.json`，放进子目录会 404。
文件名即源名：`my-static-hls.json` 对应目录项里的 `"name": "my-static-hls"`，两者不一致的源会被客户端直接丢弃。

---

## 2. 五分钟上手

```bash
# 1) 把本目录复制成一个新仓库（在 Animuse 仓库里可以先导出，再独立 init）
cp -r examples/source-catalog ~/animuse-sources && cd ~/animuse-sources

# 2) 新增一条源（或者直接改 my-static-hls.json 的域名）
node scripts/new.mjs my-site --url "https://cdn.example.com/anime/{ep}.m3u8" \
  --referer https://cdn.example.com/ --summary "我的静态片库" --tags hls,self-hosted

# 3) 自检（有 error 会退出码 1，坏源别推）
node scripts/check.mjs

# 4) 首次建仓并推送（--init 建仓库，--push 推 origin；推送前会再自检一遍）
node scripts/publish.mjs --init --push

# 5) 拿到要填进 Animuse 的地址
node scripts/url.mjs
```

第 5 步会输出类似：

```
    https://raw.githubusercontent.com/<你>/<仓库>/main/
```

把它填进 Animuse：**设置 → 在线源目录 → 粘贴地址 → 读取目录 → 安装**。
（直接粘 `.../index.json` 也认，客户端会自动去掉文件名。）

**改了源内容必须升版本**，否则客户端认为「没有更新」：

```bash
node scripts/bump.mjs my-site --patch     # 1.0.0 → 1.0.1
node scripts/publish.mjs --push
```

---

## 3. 脚本一览

| 命令 | 作用 | 常用参数 |
|---|---|---|
| `node scripts/check.mjs` | 校验整个目录（本地与 CI 同一套规则） | `--json` 机器可读；`[dir]` 校验指定目录 |
| `node scripts/new.mjs <name>` | 新增源：写 `{name}.json` + 往 `index.json` 追加条目 | `--url` `--referer` `--ua` `--kind hls\|file` `--summary` `--tags a,b` |
| `node scripts/bump.mjs <name>` | 改版本号，**同时**更新 `{name}.json` 与 `index.json` | `--patch` `--minor` `--major` 或直接写 `1.4.0` |
| `node scripts/url.mjs` | 从 `.git/config` 推导可直接粘贴的目录根地址 | `--remote <git-url>` `--branch <name>` |
| `node scripts/publish.mjs` | 自检 → `git add` → `commit`（可选推送） | `--init` `--push` `--message "…"` `--dry-run` |

`publish.mjs` 的三条纪律：**校验有 error 绝不提交**；不做任何破坏性 git 操作（没有 force / hard reset）；
推送只推当前分支到 `origin`，不猜远端、不改远端配置。不确定它会做什么时先加 `--dry-run`。

---

## 4. 格式契约

### 4.1 `index.json`

```jsonc
{
  "api": 1,                                  // 目录格式代际；高于客户端支持会整份忽略
  "updatedAt": "2026-10-10T00:00:00Z",       // RFC3339；脚本会自动刷新
  "sources": [
    {
      "name": "my-static-hls",               // 必填：必须与 {name}.json 的文件名一致
      "version": "1.0.0",                    // 必填：数字段版本号，决定客户端是否提示更新
      "summary": "自建静态片库",              // 可选：设置页里显示的说明
      "requires": 1,                         // 可选：需要的客户端源能力代际（当前 = 1）
      "tags": ["hls", "self-hosted"]         // 可选：最多 8 个
    }
  ]
}
```

### 4.2 `{name}.json`

```jsonc
{
  "name": "my-static-hls",                   // 必填：与文件名一致
  "version": "1.0.0",                        // 必填：与 index.json 里的版本一致
  "kind": "hls",                             // hls | file，省略按地址推断
  "urlTemplate": "https://cdn.example.com/anime/{ep}.m3u8",
  "referer": "https://cdn.example.com/",     // 可选：防盗链
  "userAgent": "Mozilla/5.0 (…)",            // 可选：覆盖出站 UA（≤256 字符，不能含换行）
  "proxy": true,                             // 建议 true：同源代理是跨域、防盗链与实时超分的前提
  "requires": 1                              // 可选：与 index.json 一致
}
```

填了 `referer` 或 `userAgent` 时会**自动强制走代理**——浏览器无法给 `<video>` 设置这两个头，不走代理字段就是死的。

### 4.3 地址模板可用变量

| 变量 | 含义 | 例子 |
|---|---|---|
| `{title}` | 番剧原名（日文） | `Sousou no Frieren` |
| `{titleCN}` | 中文名（不存在时回落到原名） | `葬送的芙莉莲` |
| `{id}` | Bangumi 条目 ID | `400602` |
| `{ep}` | 集数序号（从 1 开始，**不补零**） | `7` |
| `{epName}` | 该集标题 | `第 7 集` |

替换时会做 URL 编码（中文名、空格都会转义）。**未定义的变量原样保留**，不会被替换成空。

---

## 5. 托管与「填地址」

### 5.1 各平台的根地址格式

| 托管方式 | 根地址 | 说明 |
|---|---|---|
| GitHub 仓库 | `https://raw.githubusercontent.com/<owner>/<repo>/<branch>/` | `scripts/url.mjs` 会自动推导 |
| Gitee 仓库 | `https://gitee.com/<owner>/<repo>/raw/<branch>/` | 国内访问更稳 |
| GitLab 仓库 | `https://gitlab.com/<owner>/<repo>/-/raw/<branch>/` | — |
| Cloudflare Pages | `https://<项目>.pages.dev/` | 把仓库根目录作为发布目录即可 |
| 自己的 Nginx / 对象存储 | `https://<域名>/<路径>/` | 必须能直接 200 返回 `index.json` |

**结尾一定要有斜杠。** 客户端拼的是 `{根地址}{name}.json`。

### 5.2 客户端真的会校验这些

| 要求 | 原因 |
|---|---|
| **必须 https** | 目录端点只接受 https（http 直接 400） |
| 端口 443 | 非 443 会被拒绝 |
| 公网可解析地址 | 端点做 DNS 全量校验，任何一条记录落在内网即拒绝（防 SSRF） |
| 不要用重定向 | 302/301 会被判为失败（避免只校验第一跳） |
| 单个文件 ≤ 512 KB | 超过会被拒绝（目录本来就该很小） |
| 内容为 UTF-8 JSON | 解析失败会给出可读错误，不会静默 |

### 5.3 在 Animuse 里的填写步骤

1. 打开 Animuse → **设置** → **在线源目录**，粘贴 5.1 里的根地址；
2. 点 **读取目录** → 列表显示每条源的状态（可安装 / 可更新 / 已是最新 / 需要更新的客户端）；
3. 点 **安装** → 源进入播放列表，来源标记为「在线」；
4. 之后改仓库并推上去，用户点「读取目录」即可看到「可更新」（默认**需要用户确认**才落库）。

### 5.4 GitHub 一步步（最常用）

> 前提：仓库必须是 **Public**。客户端拉目录不带任何凭证，私有仓库的 raw 地址会 404。

1. 网页建空仓库：<https://github.com/new> → Name 填 `animuse-sources` → 选 **Public** →
   **不要**勾 “Add a README file” / .gitignore / license（否则第一次 push 会冲突）。
2. 把骨架复制出去，自检 + 建仓 + 首次提交：

   ```powershell
   Copy-Item -Recurse examples\source-catalog D:\Projects\animuse-sources
   cd D:\Projects\animuse-sources
   node scripts/check.mjs
   node scripts/publish.mjs --init
   ```

3. 接上远端并推送（HTTPS 首次推送会弹出浏览器登录；有 SSH key 就用注释里那行）：

   ```powershell
   git remote add origin https://github.com/<owner>/animuse-sources.git
   # 或用 SSH：git remote add origin git@github.com:<owner>/animuse-sources.git
   node scripts/publish.mjs --push
   ```

4. 拿到地址（`<owner>` 换成你自己的账号）：

   ```
   https://raw.githubusercontent.com/<owner>/animuse-sources/main/
   ```

   `node scripts/url.mjs` 会直接从 `.git/config` 推出这一行，不用手拼。

5. 先自测这个地址真的可用（期望输出 `200`）：

   ```powershell
   curl.exe -sS -o NUL -w "%{http_code}`n" https://raw.githubusercontent.com/<owner>/animuse-sources/main/index.json
   ```

   | 返回 | 含义 |
   |---|---|
   | `200` | 可以填进 Animuse 了 |
   | `404` | 仓库还是私有，或默认分支不叫 `main` |
   | `403` | 分支/路径不对 |
   | 其它 | 刚推完 raw 有 CDN 缓存，等几十秒再试 |

6. 把这个地址填进 Animuse（步骤见 5.3）。

**国内访问 raw 慢时的备选**：jsDelivr 镜像同样满足「https + 443 + 直出 JSON」——

```
https://cdn.jsdelivr.net/gh/<owner>/animuse-sources@main/
```

（`@main` 是分支名或 tag；实测返回 200 JSON。客户端若报拉取失败就换回 raw 地址。）

**以后每次改源**：`bump.mjs` 升版本 → `publish.mjs --push` → 用户在设置里点「读取目录」看到「可更新」。

---

## 6. 客户端的更新语义（决定你怎么发版）

| 行为 | 说明 |
|---|---|
| **不降级** | 只有目录版本**高于**本地已装版本才提示更新（按数字段比较：`1.10.0 > 1.9.0`） |
| **默认手动** | 拉取只提示「可更新」，**用户确认才落库**；本地手填的源不会被目录覆盖 |
| 目录缓存 5 分钟 | 短时间内重复点「读取目录」不会重复打你的仓库 |
| 并发上限 4 | 批量安装最多 4 个并发请求 |
| 代际闸门 | `requires` 高于客户端能力代际的源会被拒绝安装，所以**别乱升 requires** |
| 脏条目跳过 | 单条源不合法只跳过它，不影响整批 |

所以「改内容必须升版本」是硬要求——`bump.mjs` 帮你把两处版本一起改掉，
`check.mjs` 会在你忘记时直接报 error。

---

## 7. 校验与 CI

```bash
node scripts/check.mjs          # 校验当前仓库
node scripts/check.mjs --json   # 机器可读，便于接 CI
```

校验内容与客户端一致（且对明显笔误更严格）：名称合法性与唯一性、文件是否存在、
**name 与文件名是否一致**、**version 与 index.json 是否一致**、`urlTemplate` 是否为绝对地址、
变量是否在白名单内、`requires` 是否越代际、`userAgent` 是否含 CR-LF 或超长、是否有未登记/缺文件的条目。

仓库自带 `.github/workflows/validate.yml`：push / PR 时自动跑一遍，坏源进不了主干。
`publish.mjs` 在提交前也会跑同一个校验器，所以**本地通不过的东西不会被推上去**。

---

## 8. 安全与合规

- **这是供应链**：目录内容会被用于拼接播放地址并决定请求头。只放你自己确认过的地址，不要收来历不明的源。
- **不要放需要登录的源**：客户端目前只支持 `referer` 与 `userAgent`，**没有 Cookie / 会话**，需要登录的站点套不上。
- **不要放带一次性签名的地址**：`?sign=…&t=…` 这类地址模板必然失效，装上也播不了。
- **`{ep}` 不补零**：站点用 `ep07` 这种写法时，当前模板套不上。
- **推送前挑一个许可证**：这是你自己的仓库，建议至少加一个 `LICENSE`（例如 MIT）说明使用条件。
- **合规**：请遵守你所在地区的法律与站点条款；源的内容责任在使用者。

---

## 9. 常见错误

| 现象 | 原因 |
|---|---|
| `目录缺少 sources 数组` | `index.json` 顶层写成数组了，必须是 `{ "sources": [...] }` |
| `目录格式非法（不是 JSON 对象）` | 拉到的不是本契约的 JSON（例如把别的仓库的 index.json 填进来了） |
| `name 必须与文件名一致` | 文件名叫 `a.json`，里面的 `name` 却是 `b` |
| `version 必须与 index.json 一致` | 改了源没升版本，或只改了一处；跑 `bump.mjs <name> --patch` |
| 列表里有「需要更新的客户端」 | 该源 `requires` 高于客户端代际 |
| 拉取失败 403 | 地址是内网/回环，或端口不是 443 |
| 拉取失败 502 | 目标不是 https、或用了重定向、或返回了非 200 |
| 推上去但用户看不到更新 | 忘了升版本，或目录地址填的是别的分支/仓库 |

---

## 10. 发布前检查清单

- [ ] `node scripts/check.mjs` 0 error
- [ ] 改过内容的源都升了版本（`bump.mjs` 会同步两个文件）
- [ ] `urlTemplate` 用真实地址验过一次（把 `{ep}` 换成 `1`）
- [ ] 没有把需要登录 / 一次性签名 / `http://` 的地址放进来
- [ ] `git status` 里没有多余文件（`.gitignore` 已挡掉日志、临时文件）
- [ ] `node scripts/publish.mjs --push` 后跑一次 `node scripts/url.mjs`，确认地址与分支
