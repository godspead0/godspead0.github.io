# 个人在线笔记收纳与打卡系统

纯前端 SPA（Vue 3 + Vite），浏览器直连 GitHub REST API，**没有后端服务器**。

- 🌐 线上地址：<https://godspead0.github.io/> —— **任何人打开就能看到全部笔记**
- 📖 **操作手册**：[`操作手册.md`](操作手册.md) —— 首次配置 / 日常写笔记与提交 / 打卡 / 排错对照表
- 📦 站点源码：本仓库 `godspead0.github.io`（公开）
- 🌍 公开展示仓库：`godspead0_notes1`（**公开**）→ 网站对所有人展示的就是它
- 🔒 私有工作区：`my-tech-notes` / `my-algo-notes`（**占位符**，实际是私有仓库）

> **关于占位符**：本文档中的 `your-name` / `my-tech-notes` / `my-algo-notes` /
> `my-algo-notes-dir` 都是**占位符，不是真实仓库名** —— 公开仓库的文档不写私有仓库名。
> 真实值只保存在本机私有文件（已被 `.gitignore` 忽略）与浏览器 `localStorage` 中。
> 公开展示仓库 `godspead0_notes1` 本身就是公开的，所以直接写出来。

## 三个仓库的分工

```
私有工作区（本地编辑，含 origin/ 等额外文件）
   技术 my-tech-notes      笔记在 全栈/
   算法 my-algo-notes      笔记在 仓库根目录
          │
          │  提交笔记.bat 第 3 步：只镜像 .md
          ▼
公开展示仓库 godspead0_notes1（public）
   全栈/     ← 技术笔记副本
   算法/     ← 算法笔记副本
          │
          │  网站匿名读取（raw CDN，无需 Token）
          ▼
访客浏览器 —— 打开网站直接看到全部笔记
```

**网站对访客是只读的**：没有 Token 时顶栏显示「只读」徽标，
新建 / 导入 / 打卡按钮自动禁用，读取走 `raw.githubusercontent.com`（不计入 API 额度）。

## 目录结构

```
tech_doc/                              ← 站点仓库（公开）
├─ .github/workflows/deploy.yml        # 推送到 main 自动构建并发布到 GitHub Pages
├─ notes-manager/                      # SPA 源码
│  ├─ src/services/                    # GitHub API / 笔记模型 / Markdown / 导出
│  ├─ src/composables/                 # 状态管理（笔记、打卡、分类、搜索、配置）
│  ├─ src/components/                  # 界面组件（含 SVG 打卡热力图）
│  └─ scripts/smoke.mjs                # 离线冒烟测试（131 项断言）
├─ 提交笔记.bat                         # 写完笔记后双击即可提交推送（4 个步骤）
├─ 镜像到公开仓库.ps1                    # 第 3 步调用：把 .md 镜像到公开展示仓库
├─ 我的仓库配置（本机私有）.md            # 已 gitignore，真实仓库名只在这里
├─ 操作手册.md                          # ★ 完整使用流程（首次配置 / 日常 / 排错）
└─ .gitignore                          # 排除笔记仓库、构建产物、系统文件
```

笔记仓库的本地克隆位于**站点目录之外**：

```
D:\vscode_test_all\my-tech-notes\      全栈/         ← ★ 技术笔记
D:\vscode_test_all\my-algo-notes-dir\  力扣/ 洛谷/   ← ★ 算法笔记
D:\vscode_test_all\notes_public\       全栈/ 算法/   ← 公开展示仓库（自动生成，别手改）
```

## 日常使用：写笔记 → 提交

1. 打开 `my-tech-notes/全栈/`（技术）或 `my-algo-notes-dir/`（算法），新建或编辑 `.md` 笔记
   （可按分类放进子文件夹，如 `前端部分/Vue.md`；文件夹名会自动成为笔记分类）
2. 双击根目录的 **`提交笔记.bat`**，输入一次提交说明
3. 脚本依次执行 4 步：

   | 步骤 | 动作 |
   | --- | --- |
   | `[1/4]` | 提交推送**技术**私有仓库 |
   | `[2/4]` | 提交推送**算法**私有仓库 |
   | `[3/4]` | 把 `.md` **镜像到公开展示仓库**并推送（网站展示的内容就是这一步） |
   | `[4/4]` | 提交推送**站点源码**（改了网站代码时才有内容） |

4. 打开网站点「重新同步」即可看到最新笔记

> 第一次运行 `提交笔记.bat` 时如果某个仓库目录不存在，脚本会自动克隆它。
> 镜像只复制 `.md`，并会**同步删除**：本地删掉的笔记也会从公开仓库移除。
> `checkins.json` / `categories.json` 由网站直接写入公开仓库，镜像脚本绝不触碰。

## 网站功能

| 功能 | 说明 |
| --- | --- |
| 公开浏览 | **无需任何配置**，访客打开即看到公开展示仓库的全部笔记 |
| 笔记列表 | 聚合读取两个页签的 `.md`（同一公开仓库的 `全栈/` 与 `算法/`），4 种排序模式 |
| 仓库（一级分类） | 侧栏「仓库」区块可在 技术 / 算法 间筛选；点击即切换列表与新建目标仓库 |
| 分类 / 标签 | 侧栏筛选树；分类由文件夹名自动推断，且随所选仓库联动 |
| 全文搜索 | Fuse.js 检索标题、标签、正文；搜索框右侧按钮可直接执行 |
| 年月归档 | 侧栏时间线，如 `2026年9月 (4)` |
| 打卡热力图 | GitHub 风格 SVG 贡献图，7 行 × N 周，4 级绿色 |
| 一键打卡 | 「今日一键打卡」写入 `checkins.json`，**每天仅限一次**；新建/更新笔记自动 +1 |
| 导入导出 | 拖拽导入 `.md`、单篇下载、多选导出、全站打包 `zip` |

## 配置（网页端）

**访客什么都不用填** —— 站点代码里已指向公开展示仓库，打开即读。

要让**你自己**获得写入权限（新建 / 编辑 / 删除 / 打卡），在右上角「连接设置」的
**技术 / 算法**两个页签里各粘贴一次 Personal Access Token：

| 字段 | 值 |
| --- | --- |
| Owner / Repo / Branch | 已预填为公开展示仓库，保持不动 |
| 笔记目录 | 技术 = `全栈`，算法 = `算法` |
| Token | 你的 PAT（两个页签填同一个） |

Token 只保存在浏览器 `localStorage`（键名 `notes-manager.vaults.v3`），不会上传到任何服务器。
建议使用 **fine-grained Token**，Repository access 只勾 `godspead0_notes1`，
权限选 **Contents: Read and write**。

> ⚠️ Token 等于笔记的读写权限。别贴聊天、别写进文件、别提交进仓库；
> 在共用电脑上用完点「清除凭据」。

## 本地开发

```powershell
cd notes-manager
npm install
npm run dev        # 开发服务器
npm run build      # 构建到 dist/
npm run smoke      # 离线冒烟测试（131 项断言）
npm run verify     # 构建 + 冒烟测试
```

## 部署

推送到 `main` 分支且改动涉及 `notes-manager/**` 时，
GitHub Actions 会自动构建并发布到 GitHub Pages。

> 仓库 **Settings → Pages → Source** 需选择 **GitHub Actions**。

## 网络说明

本机 `github.com:443` 经常被拦截，HTTPS 推送会报 `Failed to connect ... port 443`。
`~/.ssh/config` 已把 `github.com` 映射到 **`ssh.github.com:443`**（GitHub 官方备用入口），
所有仓库的 remote 均使用 SSH，`提交笔记.bat` 与镜像脚本都带重试。
