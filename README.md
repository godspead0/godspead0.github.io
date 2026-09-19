# 个人在线笔记收纳与打卡系统

纯前端 SPA（Vue 3 + Vite），浏览器直连 GitHub 读取数据，**没有后端服务器**。

- 🌐 线上地址：<https://godspead0.github.io/> —— **任何人打开就能看到全部笔记，无需登录、无需配置**
- 📖 **操作手册**：[`操作手册.md`](操作手册.md) —— 日常写笔记与提交 / 排错对照表
- 📦 站点源码：本仓库 `godspead0.github.io`（公开）
- 🌍 公开展示仓库：`godspead0_notes1`（**公开**）→ 网站展示的就是它
- 🔒 私有工作区：`my-tech-notes` / `my-algo-notes`（**占位符**，实际是私有仓库）

> **关于占位符**：本文档中的 `your-name` / `my-tech-notes` / `my-algo-notes` /
> `my-algo-notes-dir` 都是**占位符，不是真实仓库名** —— 公开仓库的文档不写私有仓库名。
> 公开展示仓库 `godspead0_notes1` 本身就是公开的，所以直接写出来。

## 本站是纯只读的

| | 访客 | 说明 |
| --- | --- | --- |
| 浏览笔记 / 搜索 / 筛选 / 导出 | ✅ | 打开即用，零配置 |
| 新建 / 编辑 / 删除 / 导入 / 打卡 | ❌ | **页面上根本没有这些按钮** |

页面向 GitHub 只发**读**请求，不保存任何凭据（没有 Token 输入框、不写 `localStorage`）。
读取走 `raw.githubusercontent.com`，正文不占用 API 额度。

> 内容怎么更新？在本地写好笔记，双击 **`提交笔记.bat`** 推送到公开展示仓库。
> 网页端不承担编辑职责，所以不存在同步冲突、覆盖、丢失的问题。

## 三个仓库的分工

```
私有工作区（本地编辑，含 .cpp / origin/ 等额外文件，网站不读）
   技术 my-tech-notes      笔记在 全栈/
   算法 my-algo-notes      笔记在 笔记/
          │
          │  提交笔记.bat 第 3 步：单向镜像，只复制 .md / .markdown
          ▼
公开展示仓库 godspead0_notes1（public）
   全栈/     ← 技术笔记副本
   算法/     ← 算法笔记副本
          │
          │  网站匿名读取（raw CDN，无需 Token）
          ▼
访客浏览器 —— 打开网站直接看到全部笔记
```

## 目录结构

```
tech_doc/                              ← 站点仓库（公开）
├─ .github/workflows/deploy.yml        # 推送到 main 自动构建并发布到 GitHub Pages
├─ notes-manager/                      # SPA 源码
│  ├─ src/services/                    # GitHub 只读客户端 / 笔记模型 / Markdown / 导出
│  ├─ src/composables/                 # 状态管理（笔记、打卡、分类、搜索、数据源）
│  ├─ src/components/                  # 界面组件（含 SVG 打卡热力图）
│  └─ scripts/smoke.mjs                # 离线冒烟测试（157 项断言，无需浏览器）
├─ 提交笔记.bat                         # 写完笔记后双击即可提交推送（纯 ASCII 启动器）
├─ submit-notes.ps1                     # 上面那个 bat 的实际逻辑（4 个步骤，UTF-8 带 BOM）
├─ 镜像到公开仓库.ps1                    # 第 3 步调用：把 .md / .markdown 单向镜像到公开展示仓库
├─ 我的仓库配置（本机私有）.md            # 已 gitignore，真实仓库名只在这里
├─ 操作手册.md                          # ★ 完整使用流程
└─ .gitignore                          # 排除笔记仓库、构建产物、系统文件
```

> ⚠️ **改 `提交笔记.bat` 时必须保持它纯 ASCII**（只能有英文和符号，不能写中文）。
> cmd.exe 是按系统 OEM 代码页（中文 Windows 是 936）**逐字节**读批处理文件的，不是按 UTF-8：
> 里面的中文会变乱码，而且 `chcp` 一旦中途改变代码页，cmd 之后按字节偏移续读就会错位，
> **把后面的行从中间劈开**（症状：`'-AlgoNotesDir' 不是内部或外部命令`、`'ail' 不是内部或外部命令`、
> `^` 续行失效）。所以逻辑和中文都在 `submit-notes.ps1` 里，那个文件是 UTF-8 **带 BOM**，
> 用编辑器改完若 BOM 丢了，中文同样会乱 —— 改完请确认首三字节是 `EF BB BF`。

笔记仓库的本地克隆位于**站点目录之外**：

```
D:\vscode_test_all\my-tech-notes\      全栈/         ← ★ 技术笔记
D:\vscode_test_all\my-algo-notes-dir\  笔记/         ← ★ 算法笔记
D:\vscode_test_all\notes_public\       全栈/ 算法/   ← 公开展示仓库（自动生成，别手改）
```

## 日常使用：写笔记 → 提交

1. 打开 `my-tech-notes/全栈/`（技术）或 `my-algo-notes-dir/笔记/`（算法），新建或编辑 `.md` 笔记
   （可按分类放进子文件夹，如 `前端部分/Vue.md`；文件夹名会自动成为笔记分类）
2. 双击根目录的 **`提交笔记.bat`**，输入一次提交说明
3. 脚本依次执行 4 步：

   | 步骤 | 动作 |
   | --- | --- |
   | `[1/4]` | 提交推送**技术**私有仓库 |
   | `[2/4]` | 提交推送**算法**私有仓库 |
   | `[3/4]` | 把 `.md` **单向镜像到公开展示仓库**并推送 ← 网站看到的内容就是这一步 |
   | `[4/4]` | 提交推送**站点源码**（改了网站代码时才有内容） |

4. 打开网站点「同步」即可看到最新笔记

> 第一次运行 `提交笔记.bat` 时如果某个仓库目录不存在，脚本会自动克隆它。
> 镜像只复制 `.md` / `.markdown`，并会**同步删除**：本地删掉的笔记也会从公开仓库移除。
> `checkins.json` / `categories.json` 属于网站数据，镜像脚本绝不触碰。

## 网站功能

| 功能 | 说明 |
| --- | --- |
| 公开浏览 | **无需任何配置**，访客打开即看到公开展示仓库的全部笔记 |
| 笔记列表 | 聚合读取两个分类目录（`全栈/` 与 `算法/`），4 种排序模式 |
| 仓库（一级分类） | 侧栏「仓库」区块可在 技术 / 算法 间筛选 |
| 分类 / 标签 | 侧栏筛选树；分类由文件夹名自动推断，且随所选分类联动 |
| 全文搜索 | Fuse.js 检索标题、标签、正文；`/` 或 `Ctrl+K` 聚焦 |
| 年月归档 | 侧栏时间线，如 `2026年9月 (4)` |
| 打卡热力图 | GitHub 风格 SVG 贡献图，7 行 × N 周，4 级绿色（只读展示历史记录） |
| 导出 | 单篇下载 / 复制 Markdown 原文 / 多选导出 / 全站打包 `zip` |
| 数据来源 | 顶栏按钮可查看仓库地址与各分类的扫描目录 |

## 本地开发

```powershell
cd notes-manager
npm install
npm run dev        # 开发服务器
npm run build      # 构建到 dist/
npm run smoke      # 离线冒烟测试（157 项断言）
npm run verify     # 构建 + 冒烟测试
```

数据源固定在 `notes-manager/src/composables/useConfig.js` 的三个常量里：

```js
const PUBLIC_OWNER  = 'godspead0'
const PUBLIC_REPO   = 'godspead0_notes1'
const PUBLIC_BRANCH = 'main'
```

换仓库改这里即可。**必须填公开仓库**，否则访客读不到内容。

## 部署

推送到 `main` 分支且改动涉及 `notes-manager/**` 时，
GitHub Actions 会自动构建并发布到 GitHub Pages。

> 仓库 **Settings → Pages → Source** 需选择 **GitHub Actions**。

## 网络说明

本机 `github.com:443` 经常被拦截，HTTPS 推送会报 `Failed to connect ... port 443`。
`~/.ssh/config` 已把 `github.com` 映射到 **`ssh.github.com:443`**（GitHub 官方备用入口），
所有仓库的 remote 均使用 SSH，`提交笔记.bat` 与镜像脚本都带重试。

`api.github.com` 与 `raw.githubusercontent.com` 可直连。匿名 GitHub API 限制为
**60 次/小时/IP**，因此站点做了两件事把开销压到最低：

- 用 Git Trees API **一次请求**取回整棵文件树（而不是逐层列目录）
- 技术 / 算法两个分类指向同一仓库时**共享文件树缓存**（60 秒），只请求一次
- 笔记正文走 raw CDN，**不计入** API 额度
