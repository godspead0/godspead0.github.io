# 笔记收纳与打卡系统（notes-manager）

部署在 **GitHub Pages**（`https://godspead0.github.io`）的**个人在线笔记收纳与打卡系统**。

核心机制：**纯前端 SPA + GitHub REST API**。网站没有自建后端，浏览器直接使用你自己填写的
Personal Access Token（PAT）调用 GitHub Contents API，把 Markdown 笔记、打卡记录、
分类元数据**双向同步**到你指定的数据仓库。

- 站点源码：本仓库 `godspead0/godspead0.github.io`（用户站点仓库，发布在**站点根路径**）
- 访问地址：`https://godspead0.github.io/`
- 数据仓库示例：`https://github.com/godspead0/godspead0_understand`（技术笔记，私有）
  与 `https://github.com/godspead0/godspead0_algorithm`（算法笔记，私有）

> Vite 已配置 `base: './'`（相对路径），因此无论发布在根路径还是 `/<repo>/` 子路径下都能正常加载资源。

---

## 1. 功能总览

| 模块 | 能力 |
| --- | --- |
| 连接与鉴权 | **多仓库（技术 / 算法）** 各自配置 Owner / Repo / Branch / 笔记目录 / PAT，逐仓连通性测试，凭据存 `localStorage`，支持清除 |
| 多仓库聚合 | 一次同步拉取全部已配置仓库，按**仓库（一级分类）→ 分类 → 标签**聚合；侧栏可只看某个仓库 |
| 笔记管理 | 新建 / 编辑 / 删除 / 改名（自动重命名文件）、Markdown 实时预览、分栏编辑、下载单篇 `.md` |
| 批量导入 | 拖拽（支持整个文件夹递归收集）或选择本地 `.md` / `.markdown` / `.txt`，自动解析 frontmatter |
| 导出备份 | 单篇下载、多选导出、全站打包 `zip`（含 `全栈/`、按年月归档目录、`checkins.json`、`categories.json`） |
| 分类与标签 | 每篇笔记绑定 Category + 多个 Tags；侧边栏实时筛选树（分类 / 标签云 / 未分类），多标签为 AND 语义 |
| 时间线归档 | 按「年份-月份」自动分组并折叠，形如 `2026年9月 (4)`；侧栏与主列表均支持归档视图 |
| 搜索 | Fuse.js 对 `title` / `tags` / `category` / `body` 即时模糊全文检索，中文友好 |
| 排序 | 更新时间 / 创建时间 / 标题，升序或降序一键切换 |
| 打卡热力图 | SVG 实现的 GitHub Contribution Graph：7 行 × N 周（12 / 26 / 53 周可切换）、5 级色阶、月份刻度、悬停浮层、点击查看某日 |
| 打卡联动 | 「今日一键打卡」（**每天仅限一次**，已打卡后按钮置灰）、撤销、补卡；**新建 / 修改 / 导入笔记时自动当日 +1**（异步、静默、失败不打断主流程） |
| 主题 | 浅色 / 深色手动切换（`html.dark`），首次访问跟随系统 |
| 异常处理 | 401 / 403 限频 / 404 / 409 冲突 / 422 / 5xx / 超时 / 断网，全部归一化为中文可读提示 |

键盘快捷键：`/` 或 `Ctrl/⌘ + K` 聚焦搜索，`Ctrl/⌘ + S` 保存笔记，`Esc` 关闭弹窗。

---

## 2. 技术栈

| 领域 | 选型 |
| --- | --- |
| 构建 | Vite 5 |
| 框架 | Vue 3（Composition API，全部 `<script setup>`）+ Tailwind CSS 3 |
| API 通信 | 原生 `fetch` + `AbortController`（未引入 Octokit，省掉 ~50KB 依赖） |
| 客户端搜索 | Fuse.js 7 |
| Markdown | marked 12（解析）+ DOMPurify 3（XSS 消毒，fail-closed） |
| 导出 | `FileReader`（读取本地文件）/ `Blob`（单篇下载）/ JSZip（全站打包） |
| 本地缓存 | `localStorage`（凭据、主题、打卡记录预热缓存） |
| 测试 | `scripts/smoke.mjs`（Vite SSR + Node，102 项断言，无需浏览器） |

---

## 3. 目录结构

```text
notes-manager/
├── .github/workflows/deploy.yml     # 推送 main 自动构建并发布到 GitHub Pages
├── index.html                       # SPA 挂载点
├── vite.config.js                   # base:'./'，适配 Pages 子路径
├── tailwind.config.js               # darkMode:'class' + GitHub 绿阶色板
├── postcss.config.js
├── package.json                     # dev / build / preview / smoke / verify
├── public/404.html                  # 任意子路径 404 回落到首页
├── scripts/smoke.mjs                # 冒烟测试：服务层 + 搜索逻辑 + 整树 SSR 渲染
├── examples/data-repo/              # 可直接复制到数据仓库的示例数据
│   ├── checkins.json
│   ├── categories.json
│   └── 全栈/1758000000000_示例笔记-Vue3-响应式原理.md
└── src/
    ├── main.js                      # 应用入口：主题初始化、打卡缓存预热、错误兜底
    ├── App.vue                      # 根组件：三栏布局 + 全局浮层编排
    ├── index.css                    # Tailwind 入口、CSS 变量主题、Markdown 排版
    ├── services/                    # ① 与外界打交道的纯逻辑层（无 Vue 依赖）
    │   ├── github.js                #    GitHub Contents API：UTF-8 Base64、SHA、错误映射、递归列目录
    │   ├── notes.js                 #    领域模型：id/slug/path、frontmatter 化笔记、日期与统计工具
    │   ├── frontmatter.js           #    零依赖 YAML 子集解析 / 序列化
    │   ├── exporter.js              #    FileReader 导入、Blob 下载、JSZip 打包
    │   └── markdown.js              #    marked + DOMPurify 渲染（不可用时降级为纯文本）
    ├── composables/                 # ② 状态与业务编排层（模块级单例，天然全局状态）
    │   ├── useConfig.js             #    凭据读写、表单校验、连通性测试
    │   ├── useNotes.js              #    笔记拉取/新建/更新/删除/批量上传（sha 级缓存 + 并发限制）
    │   ├── useCheckins.js           #    checkins.json 读写、连续天数统计、写入合并与 409 重试
    │   ├── useCategories.js         #    categories.json 读写、颜色散列、按笔记自动补登记
    │   ├── useSearch.js             #    Fuse 索引、分类/标签/年月筛选、排序、筛选树推导
    │   ├── useWorkspace.js          #    应用级编排：三路并行同步、编辑器状态机、导入导出动作
    │   ├── useTheme.js              #    浅色/深色主题
    │   ├── useToast.js              #    全局轻提示
    │   └── useConfirm.js            #    Promise 化确认弹窗
    └── components/                  # ③ 视图层
        ├── AppHeader.vue            #    顶栏：搜索、同步、新建、导入、导出、打卡、主题、设置
        ├── FilterSidebar.vue        #    侧栏筛选树（分类 / 标签 / 时间线归档），移动端抽屉
        ├── NoteListPanel.vue        #    列表：工具栏、批量操作、卡片视图 / 归档视图、空态与骨架屏
        ├── NoteCard.vue             #    笔记卡片
        ├── DashboardPanel.vue       #    仪表盘：打卡主卡片、热力图、区间切换、统计指标
        ├── ContributionGraph.vue    #    ★ SVG 点阵打卡热力图
        ├── NoteEditorModal.vue      #    编辑器：元数据、Markdown 工具栏、编辑/预览/分栏
        ├── NoteDetailModal.vue      #    阅读视图：渲染正文 + 元数据 + GitHub 原文链接
        ├── ConfigModal.vue          #    连接设置弹窗
        ├── ImportOverlay.vue        #    全局拖拽导入浮层（含文件夹递归）
        ├── MarkdownPreview.vue      #    安全渲染容器
        ├── AppIcon.vue              #    内联 SVG 图标集（零图标库依赖）
        ├── ToastHost.vue            #    提示浮层
        └── ConfirmDialog.vue        #    确认弹窗
```

数据流是单向的：`services`（纯逻辑） ← `composables`（状态与副作用） ← `components`（视图）。
组件之间不互相传参，统一通过 `useWorkspace()` / `useNotes()` 等单例读写状态。

---

## 4. 数据仓库结构

笔记数据存放在**站点源码仓库之外的独立仓库**里，网站支持**多个仓库聚合**（vault），
每个仓库在「连接设置」里有独立页签：

| 页签 | 仓库 | 默认分支 | 笔记目录 |
| --- | --- | --- | --- |
| 技术 | `godspead0_understand`（私有） | `master` | `全栈/` |
| 算法 | `godspead0_algorithm`（私有） | `main` | 仓库根目录 |

网站里 **一级分类 = 仓库（技术 / 算法）**，二级才是分类文件夹。

```text
godspead0_understand/          # 技术笔记 · 默认分支 master
├── 全栈/                      # ★ 笔记根目录（只扫描这里）
│   ├── 前端部分/Vue.md        # 按分类建文件夹，文件夹名 = 笔记分类
│   ├── 后端部分/spring框架/SpringBoot.md
│   ├── 术语解释.md            # 散落在 全栈/ 下的单篇笔记（无分类）
│   └── {id}_{slug}.md         # 在网站里新建的笔记（带 frontmatter）
├── checkins.json              # { "YYYY-MM-DD": count, ... }（自动创建，主仓库根目录）
├── categories.json            # 分类与标签元数据（自动创建，主仓库根目录）
└── origin/                    # 该仓库里的其它内容（代码 .cpp / 图片等），不读取

test_algorithm/                # 算法笔记 · 默认分支 main
├── 力扣/ 洛谷/ 牛客/ ...      # ★ 笔记与题解（文件夹名 = 笔记分类）
└── {id}_{slug}.md             # 在网站里新建的算法笔记会落在仓库根目录
```

> **只展示 `.md` / `.markdown`**，其他类型（`.cpp`、`.prob`、`.json`、`.png` 等）一律不展示。
> 技术仓库因为有「笔记目录 = `全栈`」，扫描范围**限定在该子树内**；
> 算法仓库的「笔记目录」留空，等于扫描**整个仓库**里的全部 `.md`——
> 若想限定范围，把该页签的笔记目录填成具体文件夹名（如 `笔记`）即可。
> **打卡记录 `checkins.json` 与 `categories.json` 存放在第一个已配置的仓库的根目录**（通常是技术仓库）。

### 4.1 笔记文件 `{id}_{slug}.md`

- `id`：13 位毫秒时间戳，天然按时间排序且几乎不会冲突
- `slug`：标题转写，**保留中文**，仅剔除 `\/:*?"<>|` 等文件系统非法字符

```markdown
---
id: "1758000000000"
title: "示例笔记：Vue3 响应式原理"
category: "前端部分"
tags: [vue, 源码, 面试]
created: "2026-09-01T02:00:00.000Z"
updated: "2026-09-02T03:30:00.000Z"
---

# 正文标题

正文内容……
```

`frontmatter` 是唯一事实来源：`category` / `tags` 直接决定筛选归属，
所以 `categories.json` 丢失也不会导致筛选不可用（UI 会依据笔记自动推导并补登记）。

### 4.2 `checkins.json`

```json
{ "2026-09-19": 2, "2026-09-18": 1 }
```

### 4.3 快速初始化数据仓库

1. 在 GitHub 上创建或使用已有的笔记仓库（例如 `godspead0/godspead0_understand`），私有/公开皆可；
2. 把 `examples/data-repo/` 下的三个示例文件上传进去（可选，不传也能用）；
3. 在弹窗的「技术」页签填 `master`、「算法」页签填 `main`（各自仓库的默认分支）。
   网站内新建的笔记按当前所选仓库写入：
   技术仓库 → <code class="font-mono">全栈/{id}_{slug}.md</code>；
   算法仓库 → <code class="font-mono">{id}_{slug}.md</code>（根目录）。
   你自己整理的历史笔记放在各自的笔记目录下的任意子文件夹里也能被读取。
4. Token 在 Repository access 中**同时勾选两个仓库**，权限选 `Contents: Read and write`。

---

## 5. 本地开发

```bash
cd notes-manager
npm install

npm run dev       # 开发服务器 http://localhost:5173
npm run build     # 产物输出到 dist/
npm run preview   # 本地预览构建产物 http://localhost:4173
npm run smoke     # 冒烟测试（102 项断言，无浏览器依赖）
npm run verify    # build + smoke
```

首次打开会**自动弹出连接设置弹窗**，在「技术 / 算法」两个页签分别填写
Owner / Repo / Branch / 笔记目录 / Token，各自点「测试并保存」。

---

## 6. 凭据与安全

**Token 只保存在当前浏览器的 `localStorage`**，请求直连 `api.github.com`，不经过任何第三方服务器。
但浏览器端的 PAT 仍是敏感信息，务必遵守：

- 优先使用 **Fine-grained token**：`Repository access` 只勾选数据仓库，
  权限只给 **Contents: Read and write**（`Metadata: Read` 会自动附带）；
- 老式经典 Token 需要 `repo` 作用域（私有仓库）；
- **不要在公共电脑上使用**；用完点「清除凭据」，或直接使用浏览器的访客模式；
- Token 泄露后立即到 GitHub Settings 吊销。

相关代码：`src/services/github.js`（`loadConfig` / `persistConfig` / `clearConfig`）、
`src/composables/useConfig.js`（表单校验与连通性测试）。

---

## 7. 关键设计说明

### 7.1 UTF-8 安全的 Base64（中文不乱码）

`btoa` 只接受 Latin-1，直接传中文会抛 `InvalidCharacterError`。`github.js` 的做法是
`TextEncoder` → UTF-8 字节 → 分块 `String.fromCharCode` → `btoa`；解码侧用 `atob` +
`TextDecoder('utf-8')`，并清理 GitHub 返回内容中的换行。

### 7.2 SHA 乐观锁与并发保护

GitHub Contents API 更新文件必须携带该文件**当前**的 `sha`：

- 新建 → 不带 `sha`；更新 → 带 `sha`；
- 若远端已被别处改动 → 返回 `409`，前端提示「保存冲突，请重新同步后再编辑」；
- 笔记标题变更时采用「先写新路径、再删旧文件」，避免中间态丢失内容。

### 7.3 限频与并发

GitHub 未认证 60 次/小时、认证 5000 次/小时。前端做了三层收敛：

1. `listFiles` 递归子目录时并发度 4；
2. 批量下载笔记正文时并发度 5（`mapLimit`）；
3. **sha 级缓存**：目录列表里 `sha` 未变化的文件直接复用内存中的笔记，不重复下载；
4. 响应头 `x-ratelimit-remaining: 0` 或 403 + `rate limit` 时，提示具体重置时间。

### 7.4 打卡写入策略（防覆盖）

`checkins.json` 是单文件共享状态，最容易出现「本地旧快照覆盖远端新数据」。`useCheckins` 的做法：

1. 每次提交**先拉取远端最新 JSON 与 `sha`**，在内存中叠加增量后立即提交；
2. 同一日期内的连续打卡做 **1.2s debounce 合并**，减少 commit 噪声（自动打卡走这条路径）；
3. 遇到 `409` / `422` 时重新拉取远端、按日取 `Max` 合并，再重试（最多 2 次）；
4. 本地 `localStorage` 缓存一份打卡记录，用于首屏秒开热力图，打开后再与远端对齐。

### 7.5 XSS 防护（fail-closed）

笔记正文来自远端仓库，可被任何协作者修改，因此渲染前必须经 DOMPurify 消毒。
若当前环境拿不到可用的消毒器（无 DOM、加载失败、`isSupported === false`），
`markdown.js` **不会原样输出 HTML**，而是整体降级为转义后的纯文本 —— 宁可少渲染样式，也不允许脚本注入。

### 7.6 错误映射

| 场景 | 用户可见提示 |
| --- | --- |
| 401 | Token 无效或已过期，请重新生成 PAT |
| 403 + rate limit | 触发限频，附额度重置时间 |
| 403 其它 | 权限不足：确认 Contents 读写权限 |
| 404 | 仓库 / 路径不存在：检查 Owner / Repo / Branch 与私有仓库授权 |
| 409 | 文件冲突：远端已被修改，先同步再提交 |
| 422 | 提交被拒绝（参数校验失败） |
| 5xx | GitHub 服务端异常，请稍后重试 |
| 超时（20s） | 请求超时：网络较慢或被代理拦截 |
| 网络异常 | 无法连接 api.github.com：检查网络 / VPN / 广告拦截 |

所有错误都抛出自定义 `GithubError`，带 `code` 与 `status`，UI 层据此给出针对性提示。

---

## 8. 部署到 GitHub Pages

工作流文件：**仓库根目录**的 `.github/workflows/deploy.yml`
（GitHub Actions 只识别仓库根目录下的工作流，此文件由 `notes-manager` 维护，
若以后把 SPA 拆到独立仓库，记得把该文件一并复制过去）。
推送到 `main` 且改动命中 `notes-manager/**` 时自动构建并发布：

```yaml
on:
  push:
    branches: [main]
    paths: ['notes-manager/**', '.github/workflows/deploy.yml']
```

部署前需要在仓库设置里做一次性配置：

1. **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**；
2. 确认仓库的 Pages 环境允许 `main` 分支部署（首次运行会提示授权 `github-pages` 环境）；
3. 推送后再看 **Actions** 面板，`build` → `deploy` 两个 job 全绿即发布成功。

> ⚠️ **同一仓库的 Pages 只能有一个来源。** 本仓库当前还是 VitePress 文档站，
> 通过根目录的 `npm run deploy`（`gh-pages` 分支）发布在站点根路径。
> 两者都想用根路径，必须二选一：
> - **方案 A（本项目的目标形态）**：Settings → Pages → Source 切到 **GitHub Actions**，
>   之后由本工作流发布 SPA，VitePress 文档改到子目录或另开仓库；
> - **方案 B**：保留 `gh-pages` 分支发布，把 SPA 产物手动推到一个独立仓库 / 子路径，
>   例如把 Pages 源保留为分支、再由分支发布流程合并两套产物。
>
> 推荐方案 A：把文档站挪到独立仓库（如 `notes-docs`），本仓库专心做 SPA。

本地也可以手工验证产物：

```bash
npm run build
npx serve dist        # 或任意静态服务器；预览时同样是相对路径加载资源
```

---

## 9. 测试

```bash
npm run smoke                  # 离线：102 项断言
SMOKE_NETWORK=1 npm run smoke  # 额外向 api.github.com 发 1 次请求，验证错误映射
```

`scripts/smoke.mjs` 用 Vite 的 `ssrLoadModule` 在 Node 中加载真实源码，覆盖：

1. **服务层纯函数**：UTF-8 Base64 往返（中文 / emoji）、frontmatter 解析与序列化往返、
   slug / path / 日期键 / 归档标题；
2. **搜索与筛选**：Fuse 命中标题与正文、分类 / 标签 / 年月筛选、排序、筛选树计数与归档分组；
3. **整棵组件树 SSR 渲染**：未配置态、注入数据后的列表 / 侧栏 / 仪表盘 / 热力图（断言 26 周 = 182 个单元格）、
   编辑器新建与编辑、阅读视图、搜索空态 —— 任何模板或响应式引用错误都会让断言失败；
4. **Markdown 与 XSS**：`<script>`、内联事件、`javascript:` 链接均不得出现在输出中；
5. **联网检查（可选）**：无效 Token 必须被归一化为 `BAD_CREDENTIALS` + 中文提示。

> 说明：SSR 断言用于「能否渲染」的静态校验，不能替代浏览器端人工验收；
> 由于 Node 无 DOM，第 4 项在本地会走 fail-closed 的纯文本降级分支。

---

## 10. 常见问题

| 现象 | 排查方向 |
| --- | --- |
| 打开就提示「Token 无效或已过期」 | Token 被吊销 / 复制不全 / 已过期；重新生成并「测试并保存」 |
| 提示「仓库或路径不存在」 | Owner / Repo / Branch 拼写；私有仓库是否已在 Token 授权范围内 |
| 提示权限不足 | 经典 Token 需要 `repo`；fine-grained 需要 `Contents: Read and write` |
| 触发限频 | 已认证 5000 次/小时；少点几次「同步」，或等提示的重置时间 |
| 中文变成乱码 | 不应发生（已做 UTF-8 安全编解码）；若出现请提 issue 并附上笔记原文 |
| 保存冲突 409 | 同一文件被别处修改；点「同步」拉取最新版本后重新编辑 |
| 笔记数量对不上 | 技术仓库只统计 `全栈/` 下的 `.md` / `.markdown`，算法仓库统计根目录及子目录；两个仓库的代码等其它文件都不会被读取 |
| 某个仓库的笔记没出现 | 该仓库页签的 Token 未填 / 填错；在「连接设置」对应页签点「测试并保存」确认可写 |
| 单文件读取失败 | Contents API 对 >1MB 文件不返回内容，前端会自动改走 `download_url` raw 通道 |
| 换电脑后需要重新配置 | 凭据存在浏览器本地，不同设备/浏览器互不同步（安全设计，而非缺陷） |

