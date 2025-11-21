@echo off
:: #################### 注意：修改为你的仓库实际路径 ####################
cd D:\vscode_test_all\tech_doc\godspead0.github.io

:: 切换到 main 分支并拉取最新代码
git checkout main
git pull origin main

:: 提示编辑笔记，按任意键继续
echo.
echo 👉 请打开 VS Code 编辑/新建笔记（docs/notes_core 文件夹下）
echo 👉 编辑完成后，回到这个窗口按任意键继续...
echo.
pause

:: 提交修改到 GitHub main 分支
git add .
set /p commit_msg=请输入提交备注（如：新增Vue3笔记）：
git commit -m "%commit_msg%"
git push origin main

:: 构建静态文件 + 部署到 gh-pages（更新线上网站）
npm run docs:build
npm run deploy

:: 部署完成提示
echo.
echo 🎉 笔记更新并部署成功！
echo 🕒 请等待1-2分钟后，打开网站按 Ctrl+F5 刷新查看：
echo 🔗 https://godspead0.github.io/
echo.
pause