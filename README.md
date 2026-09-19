# 个人在线笔记收纳与打卡系统

纯前端 SPA（Vue 3 + Vite），浏览器直连 GitHub REST API，**没有后端服务器**。

- 🌐 线上地址：<https://godspead0.github.io/>
- 📦 站点源码：本仓库 `godspead0.github.io`（公开）
- 🔒 笔记数据：[`godspead0_understand`](https://github.com/godspead0/godspead0_understand)（私有）→ `全栈/` 目录

## 目录结构

```
tech_doc/                              ← 站点仓库（公开）
├─ .github/workflows/deploy.yml        # 推送到 main 自动构建并发布到 GitHub Pages
├─ notes-manager/                      # SPA 源码
│  ├─ src/services/                    # GitHub API / 笔记模型 / Markdown / 导出
│  ├─ src/composables/                 # 状态管理（笔记、打卡、分类、搜索、配置）
│  ├─ src/components/                  # 界面组件（含 SVG 打卡热力图）
│  └─ scripts/smoke.mjs                # 离线冒烟测试（60 项断言）
├─ godspead0_understand/               # 私有笔记仓库的本地克隆（已被 .gitignore 排除）
│  └─ 全栈/                            # ★ 你的笔记都在这里
│     ├─ 前端部分/  后端部分/  中间件部分/  架构部分/  …
│     ├─ 前端总结.md  后端总结.md  术语解释.md  …
└─ 提交笔记.bat                         # 写完笔记后双击即可提交推送
```

## 日常使用：写笔记 → 提交

1. 打开 `godspead0_understand/全栈/`，新建或编辑 `.md` 笔记
   （可按分类放进子文件夹，如 `前端部分/Vue.md`；文件夹名会自动成为笔记分类）
2. 双击根目录的 **`提交笔记.bat`**
3. 脚本自动提交 → 拉取远端 → 推送；打开网站点「重新同步」即可看到

> 第一次运行 `提交笔记.bat` 时如果 `godspead0_understand/` 不存在，脚本会自动克隆它。
> 之后每次都是标准的 `add / commit / pull --rebase / push`，行为可预期。

## 网站功能

| 功能 | 说明 |
| --- | --- |
| 笔记列表 | 读取私有仓库 `全栈/` 下全部 `.md`（递归 6 层），4 种排序模式 |
| 分类 / 标签 | 侧栏筛选树；分类由文件夹名自动推断 |
| 全文搜索 | Fuse.js 检索标题、标签、正文 |
| 年月归档 | 侧栏时间线，如 `2026年9月 (4)` |
| 打卡热力图 | GitHub 风格 SVG 贡献图，7 行 × N 周，4 级绿色 |
| 一键打卡 | 「今日一键打卡」写入 `checkins.json`；新建/更新笔记自动 +1 |
| 导入导出 | 拖拽导入 `.md`、单篇下载、多选导出、全站打包 `zip` |

## 首次配置（网页端）

打开网站 → 右上角「连接设置」，填写：

| 字段 | 值 |
| --- | --- |
| Owner | `godspead0` |
| Repo | `godspead0_understand` |
| Branch | `master` |
| Token | 你的 Personal Access Token |

Token 只保存在浏览器 `localStorage`，不会上传到任何服务器。
建议使用 **fine-grained Token**，仅授权 `godspead0_understand` 一个仓库、
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
