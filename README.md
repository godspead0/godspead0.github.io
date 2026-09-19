# 个人在线笔记收纳与打卡系统

纯前端 SPA（Vue 3 + Vite），浏览器直连 GitHub REST API，**没有后端服务器**。

- 🌐 线上地址：<https://godspead0.github.io/>
- 📖 **操作手册**：[`操作手册.md`](操作手册.md) —— 首次配置 / 日常写笔记与提交 / 打卡 / 排错对照表
- 📦 站点源码：本仓库 `godspead0.github.io`（公开）
- 🔒 技术笔记：`my-tech-notes`（私有）→ `全栈/` 目录
- 🧮 算法笔记：`my-algo-notes`（私有）→ 仓库根目录

> **关于占位符**：本文档中的 `your-name` / `my-tech-notes` / `my-algo-notes` /
> `my-algo-notes-dir` 都是**占位符，不是真实仓库名**。真实的仓库名与本地路径只保存在
> 本机私有文件（已被 `.gitignore` 忽略）与浏览器 `localStorage` 中，不进入公开仓库。

> 网站把两个仓库聚合成一棵树：**一级分类 = 仓库（技术 / 算法）**，二级才是分类文件夹。

## 目录结构

```
tech_doc/                              ← 站点仓库（公开）
├─ .github/workflows/deploy.yml        # 推送到 main 自动构建并发布到 GitHub Pages
├─ notes-manager/                      # SPA 源码
│  ├─ src/services/                    # GitHub API / 笔记模型 / Markdown / 导出
│  ├─ src/composables/                 # 状态管理（笔记、打卡、分类、搜索、配置）
│  ├─ src/components/                  # 界面组件（含 SVG 打卡热力图）
│  └─ scripts/smoke.mjs                # 离线冒烟测试（113 项断言）
├─ 提交笔记.bat                         # 写完笔记后双击即可提交推送（两个仓库依次提交）
│                                      # 笔记仓库克隆位于站点目录之外：
│                                      # D:\vscode_test_all\my-tech-notes\
│                                      #   └─ 全栈/      ← ★ 技术笔记
│                                      # D:\vscode_test_all\my-algo-notes-dir\
│                                      #   └─ 力扣/ 洛谷/ ... ← ★ 算法笔记
├─ 操作手册.md                          # ★ 完整使用流程（首次配置 / 日常 / 排错）
└─ .gitignore                          # 排除笔记仓库、构建产物、系统文件
```

## 日常使用：写笔记 → 提交

1. 打开 `my-tech-notes/全栈/`（技术）或 `my-algo-notes-dir/`（算法），新建或编辑 `.md` 笔记
   （可按分类放进子文件夹，如 `前端部分/Vue.md`；文件夹名会自动成为笔记分类）
2. 双击根目录的 **`提交笔记.bat`**，输入一次提交说明
3. 脚本依次提交两个笔记仓库 → 拉取远端 → 推送，最后提交站点源码；打开网站点「重新同步」即可看到

> 第一次运行 `提交笔记.bat` 时如果某个笔记仓库目录不存在，脚本会自动克隆它。
> 之后每次都是标准的 `add / commit / pull --rebase / push`，行为可预期。

## 网站功能

| 功能 | 说明 |
| --- | --- |
| 笔记列表 | 聚合读取两个私有仓库的全部 `.md`（技术仓库扫 `全栈/`，算法仓库扫根目录），4 种排序模式 |
| 仓库（一级分类） | 侧栏「仓库」区块可在 技术 / 算法 间筛选；点击即切换列表与新建目标仓库 |
| 分类 / 标签 | 侧栏筛选树；分类由文件夹名自动推断，且随所选仓库联动 |
| 全文搜索 | Fuse.js 检索标题、标签、正文；搜索框右侧按钮可直接执行 |
| 年月归档 | 侧栏时间线，如 `2026年9月 (4)` |
| 打卡热力图 | GitHub 风格 SVG 贡献图，7 行 × N 周，4 级绿色 |
| 一键打卡 | 「今日一键打卡」写入 `checkins.json`，**每天仅限一次**；新建/更新笔记自动 +1 |
| 导入导出 | 拖拽导入 `.md`、单篇下载、多选导出、全站打包 `zip` |

## 首次配置（网页端）

打开网站 → 右上角「连接设置」，弹窗里有 **技术 / 算法** 两个页签，分别填写：

| 页签 | Owner | Repo | Branch | 笔记目录 |
| --- | --- | --- | --- | --- |
| 技术 | `your-name` | `my-tech-notes` | `master` | `全栈` |
| 算法 | `your-name` | `my-algo-notes` | `main` | （留空 = 仓库根目录） |

| 字段 | 值 |
| --- | --- |
| Token | 你的 Personal Access Token（两个页签填同一个即可） |

Token 只保存在浏览器 `localStorage`，不会上传到任何服务器。
建议使用 **fine-grained Token**，在 Repository access 里同时勾选
`my-tech-notes` 与 `my-algo-notes` 两个仓库、
权限选 **Contents: Read and write**。

> ⚠️ 私有仓库必须填 Token 才能读取；请只在私人设备上使用。

## 本地开发

```powershell
cd notes-manager
npm install
npm run dev        # 开发服务器
npm run build      # 构建到 dist/
npm run smoke      # 离线冒烟测试
npm run verify     # 构建 + 冒烟测试
```

## 部署

推送到 `main` 分支且改动涉及 `notes-manager/**` 时，
GitHub Actions 会自动构建并发布到 GitHub Pages。

> 仓库 **Settings → Pages → Source** 需选择 **GitHub Actions**。
