# 笔记收纳与打卡系统（notes-manager）

部署在 **GitHub Pages**（`https://godspead0.github.io`）的**个人在线笔记查看器**。

核心机制：**纯前端 SPA + GitHub 只读 REST API**。网站没有自建后端，浏览器直连 GitHub ——
用 Git Trees API 取一次文件树，笔记正文走 `raw.githubusercontent.com`（CDN，不计入 API 额度）。

> **本站是纯只读的。** 页面上没有新建 / 编辑 / 删除 / 导入 / 打卡入口，
> 也不存在 Token 输入框或 `localStorage` 凭据 —— 打开即看，关掉什么都不留。
> 内容在本地写好，由 `提交笔记.bat` 单向镜像到公开展示仓库。

- 站点源码：本仓库 `your-name/godspead0.github.io`（用户站点仓库，发布在**站点根路径**）
- 访问地址：`https://godspead0.github.io/`
- 公开展示仓库：`godspead0_notes1`（**公开**，网站对所有人展示的就是它：`全栈/` + `算法/`）
- 私有工作区（占位符）：`https://github.com/your-name/my-tech-notes`（技术笔记，私有）
  与 `https://github.com/your-name/my-algo-notes`（算法笔记，私有）

> **关于占位符**：`your-name` / `my-tech-notes` / `my-algo-notes` / `my-algo-notes-dir`
> 都是**占位符，不是真实仓库名** —— 公开仓库的文档不写私有仓库名。
> 公开展示仓库 `godspead0_notes1` 本身就是公开的，所以直接写出来：
> 它必须公开，否则访客读不到内容。

> Vite 已配置 `base: './'`（相对路径），因此无论发布在根路径还是 `/<repo>/` 子路径下都能正常加载资源。

---

## 1. 功能总览

| 模块 | 能力 |
| --- | --- |
| 零配置 | 数据源固定在 `useConfig.js` 的 `PUBLIC_*` 常量；访客打开即读，无需登录 |
| 多分类聚合 | 一次同步拉取全部分类目录，按**分类（一级）→ 分类文件夹 → 标签**聚合；侧栏可只看某一类 |
| 笔记浏览 | Markdown 渲染（DOMPurify 消毒）、目录锚点、字数 / 阅读时长估算 |
| 导出备份 | 单篇下载、复制 Markdown 原文、多选导出、全站打包 `zip`（含 `checkins.json`、`categories.json`） |
| 分类与标签 | 侧边栏实时筛选树（分类 / 标签云 / 未分类），多标签为 AND 语义；颜色按名字哈希稳定推导 |
| 时间线归档 | 按「年份-月份」自动分组并折叠，形如 `2026年9月 (4)`；侧栏与主列表均支持归档视图 |
| 搜索 | Fuse.js 对 `title` / `tags` / `category` / `body` 即时模糊全文检索，中文友好 |
| 排序 | 更新时间 / 创建时间 / 标题，升序或降序一键切换 |
| 打卡热力图 | SVG 实现的 GitHub Contribution Graph：7 行 × N 周（12 / 26 / 53 周可切换）、5 级色阶、月份刻度、悬停浮层、点击查看某日 |
| 打卡热力图 | GitHub 风格 SVG 贡献图（7 行 × N 周，4 级绿色），**只读展示** `checkins.json`；页面上没有打卡 / 撤销 / 补卡入口 |
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
| 测试 | `scripts/smoke.mjs`（Vite SSR + Node，157 项断言，无需浏览器） |

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
    │   ├── github.js                #    GitHub 只读客户端：Git Trees 列目录、raw CDN 读正文、错误映射
    │   ├── notes.js                 #    领域模型：id/slug/path、frontmatter 化笔记、日期与统计工具
    │   ├── frontmatter.js           #    零依赖 YAML 子集解析 / 序列化
    │   ├── exporter.js              #    Blob 下载、JSZip 打包
    │   └── markdown.js              #    marked + DOMPurify 渲染（不可用时降级为纯文本）
    ├── composables/                 # ② 状态与业务编排层（模块级单例，天然全局状态）
    │   ├── useConfig.js             #    只读数据源（PUBLIC_OWNER / PUBLIC_REPO / PUBLIC_BRANCH）
    │   ├── useNotes.js              #    笔记拉取（sha 级缓存 + 并发限制 + 文件树缓存）
    │   ├── useCheckins.js           #    checkins.json 读取、连续天数统计
    │   ├── useCategories.js         #    categories.json 读取、颜色散列
    │   ├── useSearch.js             #    Fuse 索引、分类/标签/年月筛选、排序、筛选树推导
    │   ├── useWorkspace.js          #    应用级编排：并行同步、详情浮层、导出动作
    │   ├── useTheme.js              #    浅色/深色主题
    │   └── useToast.js              #    全局轻提示
    └── components/                  # ③ 视图层
        ├── AppHeader.vue            #    顶栏：搜索、同步、导出、主题、数据来源
        ├── FilterSidebar.vue        #    侧栏筛选树（分类 / 标签 / 时间线归档），移动端抽屉
        ├── NoteListPanel.vue        #    列表：工具栏、批量导出、卡片视图 / 归档视图、空态与骨架屏
        ├── NoteCard.vue             #    笔记卡片
        ├── DashboardPanel.vue       #    仪表盘：热力图、区间切换、统计指标（全部只读）
        ├── ContributionGraph.vue    #    ★ SVG 点阵打卡热力图
        ├── NoteDetailModal.vue      #    阅读视图：渲染正文 + 元数据 + GitHub 原文链接
        ├── SourceModal.vue          #    「数据来源」信息弹窗
        ├── MarkdownPreview.vue      #    安全渲染容器
        ├── AppIcon.vue              #    内联 SVG 图标集（零图标库依赖）
        └── ToastHost.vue            #    提示浮层
```

数据流是单向的：`services`（纯逻辑） ← `composables`（状态与副作用） ← `components`（视图）。
组件之间不互相传参，统一通过 `useWorkspace()` / `useNotes()` 等单例读写状态。

---

## 4. 数据仓库结构

笔记数据存放在**站点源码仓库之外的一个公开仓库**里。网站内部仍保留「多 vault 聚合」的结构，
默认的两个 vault 指向**同一个公开展示仓库**的不同子目录：

| 分类 | 仓库 | 分支 | 笔记目录 |
| --- | --- | --- | --- |
| 技术 | `godspead0_notes1`（公开） | `main` | `全栈/` |
| 算法 | `godspead0_notes1`（公开） | `main` | `算法/` |

> 两个分类指向同一仓库时，**文件树只请求一次**（按 `owner/repo@branch` 缓存 60 秒），
> 因为匿名访客每小时只有 60 次 API 额度。

网站里 **一级分类 = vault（技术 / 算法）**，二级才是分类文件夹。

```text
godspead0_notes1/             # 公开展示仓库（public）· 网站展示的就是它
├── 全栈/                      # ★ 技术笔记根目录（分类「技术」只扫描这里）
│   ├── 前端部分/Vue.md        # 按分类建文件夹，文件夹名 = 笔记分类
│   ├── 后端部分/spring框架/SpringBoot.md
│   └── 术语解释.md            # 散落在 全栈/ 下的单篇笔记（无分类）
├── 算法/                      # ★ 算法笔记根目录（分类「算法」只扫描这里）
│   └── 力扣/二分查找.md       # ← 镜像自私有工作区的 笔记/ 目录
├── checkins.json              # { "YYYY-MM-DD": count, ... }（可选，热力图数据源）
└── categories.json            # 分类 / 标签配色元数据（可选）
```

镜像来源是私有工作区，代码文件不会被复制过去（只复制 `.md` / `.markdown`）：

```text
my-tech-notes/                 # 私有工作区 · 默认分支 master
└── 全栈/                      # ★ 唯一镜像来源
    └── 前端部分/Vue.md  ...

my-algo-notes/                 # 私有工作区 · 默认分支 main
├── 力扣/ 洛谷/ acwing/ ...    # 代码目录（.cpp / .prob），镜像时忽略
└── 笔记/                      # ★ 唯一镜像来源 → 公开仓库的 算法/
    └── 力扣/二分查找.md
```

> 算法的镜像来源是 `笔记/` 而**不是仓库根目录** —— 根下还有 `力扣/` `洛谷/` 等代码目录，
> 限定在 `笔记/` 更清晰（虽然有 `.md` 过滤兜底，扫根目录也不会误传代码）。

> **只展示 `.md` / `.markdown`**，其他类型（`.cpp`、`.prob`、`.json`、`.png` 等）一律不展示。
> 两个分类的扫描范围都被「笔记目录」限死在各自的子树内，因此互不重叠。

### 4.1 笔记文件格式

网站不关心文件名，只认内容。带 frontmatter 的 `.md`：

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

- `id`：13 位毫秒时间戳（历史遗留命名 `{id}_{slug}.md` 仍能正常解析）
- `slug`：标题转写，**保留中文**，仅剔除 `\/:*?"<>|` 等文件系统非法字符

`frontmatter` 是唯一事实来源：`category` / `tags` 直接决定筛选归属，
所以 `categories.json` 丢失也不会导致筛选不可用（颜色按名字哈希稳定推导）。
**分类也可以完全不带 frontmatter** —— 会退化为「一级子文件夹名」。

### 4.2 `checkins.json`

```json
{ "2026-09-19": 2, "2026-09-18": 1 }
```

存在就渲染热力图，不存在就显示空白。**网站只读不写**，要改就在 GitHub 网页上编辑。

### 4.3 换个数据仓库

1. 在 GitHub 上创建一个**公开**的笔记仓库（本站用 `godspead0_notes1`）——
   **必须公开**，否则匿名访客读不到；
2. 改 `src/composables/useConfig.js` 里的三个常量：

   ```js
   const PUBLIC_OWNER  = 'godspead0'
   const PUBLIC_REPO   = 'godspead0_notes1'
   const PUBLIC_BRANCH = 'main'
   ```

3. 两个分类的 `notesDir` 分别是 `全栈` 与 `算法`（按需改）；
4. 重新构建并推送站点源码即可。**不需要任何 Token。**

---

## 5. 本地开发

```bash
cd notes-manager
npm install

npm run dev       # 开发服务器 http://localhost:5173
npm run build     # 产物输出到 dist/
npm run preview   # 本地预览构建产物 http://localhost:4173
npm run smoke     # 冒烟测试（157 项断言，无浏览器依赖）
npm run verify    # build + smoke
```

打开网站即可浏览（站点代码已预填公开展示仓库，无需任何配置）。
换数据源请改 `src/composables/useConfig.js` 里的 `PUBLIC_*` 常量。

---

## 6. 凭据与安全

**本站不持有任何凭据。**

- 没有 Token 输入框
- 没有「测试连接」「保存配置」
- 不把任何密钥写进 `localStorage`
- 只向 `api.github.com`（取文件树）与 `raw.githubusercontent.com`（取正文）发**读**请求

因此不存在「XSS 偷 Token」这条攻击链。Markdown 渲染仍走 `marked` + `DOMPurify`
**fail-closed**（消毒器不可用则拒绝渲染），阻断 XSS 本身。

> 服务层的 `github.js` 保留了 `saveFile` / `deleteFile` 及其 `requireToken()` 守卫
> （无 Token 时抛 `NO_TOKEN`「当前是只读模式」）。应用层已无任何调用点 ——
> 守卫留在这里是为了万一将来重新引入写路径时不会静默地写出去，
> 冒烟测试也对此有断言。

### 6.1 本机缓存

为让首屏秒开，笔记正文与打卡记录会缓存在 `localStorage`：

| localStorage 键 | 内容 |
| --- | --- |
| `notes-manager.notes.v1` | **笔记列表与正文** |
| `notes-manager.checkins.cache` | 打卡记录预热缓存 |

这些只是**公开笔记的本地副本**，不敏感；清掉只会让下次打开慢一点。
想清干净直接在浏览器里「清除站点数据」即可。

**仓库指纹**：笔记缓存里记录写入时的 `owner/repo/branch/笔记目录` 组合。
配置变更后指纹不匹配，缓存会被判为「上一个仓库的」并自动丢弃，
避免把别的仓库的笔记当成当前的展示（无 `sig` 字段的旧缓存按兼容处理）。

相关代码：`src/services/github.js`（`getFile` / `rawFileUrl` / `listFilesViaTree` / `requireToken`）。

---

## 7. 关键设计说明

### 7.1 UTF-8 安全

`btoa` 只接受 Latin-1，直接传中文会抛 `InvalidCharacterError`。写入侧仍保留了
`TextEncoder` → UTF-8 字节 → 分块 `String.fromCharCode` → `btoa` 的实现；
读取侧匿名走 raw CDN（纯文本，无需解码），带 Token 时走 Contents API
（`atob` + `TextDecoder('utf-8')`，并清理 GitHub 返回内容中的换行）。

### 7.2 只读保证（三道）

1. **UI 层**：新建 / 编辑 / 删除 / 导入 / 打卡的按钮与弹窗组件已删除
2. **应用层**：`useNotes` / `useCheckins` / `useCategories` / `useWorkspace` 里的
   写入函数（create / update / remove / uploadLocal / checkIn / persist / …）已移除
3. **服务层**：`github.js` 的 `saveFile` / `deleteFile` 需要 Token，而站点无法获得 Token，
   调用即抛 `NO_TOKEN`

连带移除的还有一个**隐式写**：以前每次同步后会调用 `syncFromNotes()` 把新分类
补登记进 `categories.json` —— 那意味着**每个访客打开页面都会触发起一次写请求**并失败报错。
现在分类颜色由 `colorFor()` 按名字哈希稳定推导，不再需要写回。

### 7.3 限频与并发

GitHub 未认证 60 次/小时、认证 5000 次/小时。前端做了三层收敛：

1. `listFiles` 递归子目录时并发度 4；
2. 批量下载笔记正文时并发度 5（`mapLimit`）；
3. **sha 级缓存**：目录列表里 `sha` 未变化的文件直接复用内存中的笔记，不重复下载；
4. 响应头 `x-ratelimit-remaining: 0` 或 403 + `rate limit` 时，提示具体重置时间。

**两层缓存，以及「同步」为什么能立刻看到新笔记**

| 层 | 位置 | 有效期 | 作用 |
| --- | --- | --- | --- |
| 文件树缓存 | 内存（`treeCache`） | 60s | 技术 / 算法指向同一仓库时，整棵树只请求一次 |
| raw CDN | 浏览器 + CDN | `max-age=300` | 首屏不必重新下载 94 篇正文 |

这两层都会让**刚推上去的笔记延迟出现**，所以：

- **首屏自动加载**走缓存（`refresh({ silent: false })`，不带 `fresh`）—— 快
- **用户点「同步」**传 `fresh: true` → 先 `clearTreeCache()` 再给每个 raw URL 附 `?v=<时间戳>`，
  两层一起绕过，保证立刻看到最新内容

⚠️ 这里有个容易踩的坑：**不能**用 `silent` 兼职表达「用户主动」。
`silent` 的语义是「要不要弹提示」，而首屏挂载时也是 `silent: false`，
直接复用会导致**每次打开页面都重新下载全部正文**，白丢浏览器缓存。所以用独立的 `fresh` 选项。

### 7.4 分类推断：笔记目录必须由调用方传入

笔记的分类 = **笔记目录之下**的一级子目录名。所以推断前必须先剥掉「笔记目录」前缀：

```
全栈/前端部分/Vue.md   （root=全栈）→ 分类「前端部分」
算法/力扣/二分查找.md   （root=算法）→ 分类「力扣」
```

⚠️ 这里踩过一个坑：早期 `categoryFromPath()` 把 `全栈` **硬编码**在函数里。
多分类改造后，`算法/力扣/x.md` 因为剥不掉 `算法/`，分类会被算成「算法」本身 ——
**所有算法笔记的分类树会塌成一层**。

现在的做法是让调用方把 `notesDir` 一路传下去（`parseNoteFile(file, raw, { root })`
→ `categoryFromPath(path, root)` / `titleFromPath(path, root)`），
`stripRootDir()` 负责剥前缀，**函数里不再出现任何具体仓库的目录名**。
冒烟测试对这条有专门的回归断言。

### 7.5 404 不静默：仓库配错要报错，而不是显示 0 篇

`listFiles` 的降级链是「Trees API → 逐层列目录」，两侧都曾把 404 吞掉：

- `listFilesViaTree` 把任何异常都当成「Trees 不可用」→ `return null`
- `listDir` 把 404 当成「这个目录不存在」→ `return []`

后果是**仓库名写错、或仓库被改成私有时，站点静默显示「0 篇笔记」**，
用户完全看不出是配置问题。

关键区别：Trees 请求的 URL 是 `/repos/{owner}/{repo}/git/trees/{branch}?recursive=1`，
**里面没有路径** —— 所以它返回 404 只可能是「仓库或分支不存在 / 不是公开的」，
不可能是「笔记目录不存在」。因此现在这个 404 直接抛出，
其它错误（403 限频、超时、网络、结果截断）仍回退递归，功能不退化。

「笔记目录不存在」这种情况交由 `listDir` 继续容忍为 0 篇 —— 那是正常的空分类。

### 7.6 打卡记录只读缓存

`checkins.json` 由网站**读取**用于渲染热力图与统计，本地 `localStorage` 缓存一份
用于首屏秒开，打开后再与远端对齐。写入逻辑（先拉 `sha` 再叠加增量、1.2s debounce 合并、
409 冲突按日取 `Max` 重试）已随只读改造一并移除。

### 7.7 XSS 防护（fail-closed）

笔记正文来自远端仓库，可被任何协作者修改，因此渲染前必须经 DOMPurify 消毒。
若当前环境拿不到可用的消毒器（无 DOM、加载失败、`isSupported === false`），
`markdown.js` **不会原样输出 HTML**，而是整体降级为转义后的纯文本 —— 宁可少渲染样式，也不允许脚本注入。

### 7.8 错误映射

| 场景 | 用户可见提示 |
| --- | --- |
| 403 + rate limit | 触发限频（匿名 60 次/小时/IP），附额度重置时间 |
| 403 其它 | 权限不足 / 被拒绝 |
| 404 | 仓库不存在或不是公开的（见 §7.5） |
| 5xx | GitHub 服务端异常，请稍后重试 |
| 超时（20s） | 请求超时：网络较慢或被代理拦截 |
| 网络异常 | 无法连接 api.github.com / raw.githubusercontent.com |

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
npm run smoke                  # 离线：157 项断言
SMOKE_NETWORK=1 npm run smoke  # 联网：163 项断言，会以匿名身份读一次真实数据源
```

`scripts/smoke.mjs` 用 Vite 的 `ssrLoadModule` 在 Node 中加载真实源码，覆盖：

1. **服务层纯函数**：UTF-8 Base64 往返（中文 / emoji）、frontmatter 解析与序列化往返、
   slug / stripRootDir / 日期键 / 归档标题；
2. **分类推断回归**：多分类下必须按**各自的**笔记目录剥前缀
   （`算法/力扣/x.md` 的分类是「力扣」而不是「算法」，见 §7.4）；
3. **导出路径**：算法笔记不会被塞进 `全栈/` 顶层目录（见 §7.4 同类问题）；
4. **搜索与筛选**：Fuse 命中标题与正文、分类 / 标签 / 年月筛选、排序、筛选树计数与归档分组；
5. **整棵组件树 SSR 渲染**：注入数据后的列表 / 侧栏 / 仪表盘 / 热力图（断言 26 周 = 182 个单元格）、
   阅读视图、搜索空态、「数据来源」弹窗 —— 任何模板或响应式引用错误都会让断言失败；
6. **只读保证**：断言 DOM 里**不存在**新建 / 导入 / 一键打卡 / 补卡 / 批量删除 / 连接设置入口，
   配置对象里没有 `token` 字段，且服务层 `saveFile` / `deleteFile` 在无 Token 时抛 `NO_TOKEN`；
7. **限频优化**：桩掉 `fetch` 断言同一仓库的文件树**只请求一次**（命中缓存），
   且匿名读正文走 `raw.githubusercontent.com` 而非 `api.github.com`；
8. **错误不再静默**：桩出 404 断言「仓库不存在 / 非公开」会抛错，而不是返回空列表（见 §7.5）；
9. **Markdown 与 XSS**：`<script>`、内联事件、`javascript:` 链接均不得出现在输出中；
10. **联网检查（可选）**：`SMOKE_NETWORK=1` 时以匿名身份读**真实配置的数据源**，
    验证访客看到的那条路径确实通，并断言 404 归一化为 `NOT_FOUND`。

> 第 10 项依赖你的公开展示仓库是 public。算法分类当前 0 篇时会打印一行说明而不是失败
> （空分类是正常状态），但合计 0 篇会失败 —— 那说明数据源真的有问题。

> 说明：SSR 断言用于「能否渲染」的静态校验，不能替代浏览器端人工验收；
> 由于 Node 无 DOM，第 6 项在本地会走 fail-closed 的纯文本降级分支。

---

## 10. 常见问题

| 现象 | 排查方向 |
| --- | --- |
| 打开一篇笔记都没有 | 公开展示仓库是否为 public；`useConfig.js` 里的 `PUBLIC_*` 常量是否写对；仓库里是否有对应子目录（`全栈/`、`算法/`） |
| 算法一篇都没有 | 算法分类扫的是公开仓库的 `算法/`，它镜像自私有工作区的 `笔记/`；确认里面有 `.md` |
| 触发限频 | 匿名 60 次/小时/IP；等提示的重置时间，或换个网络 |
| 中文变成乱码 | 不应发生（已做 UTF-8 安全编解码）；若出现请提 issue 并附上笔记原文 |
| 笔记数量对不上 | 只统计 `.md` / `.markdown`；`.cpp` / `.prob` / `.json` 等不会被读取 |
| 本地删了笔记网站还在 | 还没跑 `提交笔记.bat` 第 3 步（镜像带删除同步），或网站没点「同步」 |
| 单文件读取失败 | Contents API 对 >1MB 文件不返回内容，前端会自动改走 `download_url` raw 通道 |
| 换电脑后要重新配置吗 | 不用 —— 没有任何凭据需要迁移，打开网站就能看 |

