@echo off
chcp 65001 >nul
setlocal
title 提交笔记

cd /d "%~dp0"

set "ROOT=%~dp0"
rem 笔记仓库使用你原有的克隆（与站点目录同级，不在站点仓库内部）
set "VAULT=D:\vscode_test_all\godspead0_understand"
set "VAULT_REMOTE=https://github.com/godspead0/godspead0_understand.git"
set "VAULT_BRANCH=master"

echo ============================================================
echo                    笔记提交助手
echo ============================================================
echo   站点目录：%ROOT%
echo   笔记仓库：%VAULT%  (分支 %VAULT_BRANCH%)
echo ============================================================
echo.

where git >nul 2>nul
if errorlevel 1 goto :no_git

rem ==================== 第一步：提交并推送笔记 ====================
echo [1/2] 同步笔记到私有仓库 godspead0_understand ...
echo.

if exist "%VAULT%\.git" goto :vault_ready
echo       未找到本地笔记仓库，正在克隆 ...
git clone "%VAULT_REMOTE%" "%VAULT%"
if errorlevel 1 goto :clone_fail
echo.

:vault_ready
pushd "%VAULT%"

git add -A
git diff --cached --quiet
if not errorlevel 1 goto :vault_clean

set "MSG="
set /p "MSG=      请输入提交说明（直接回车使用默认）："
if "%MSG%"=="" set "MSG=更新笔记 %date%"

echo       正在提交 ...
git commit -q -m "%MSG%"
if errorlevel 1 goto :fail

echo       正在同步远端最新改动 ...
git pull --rebase origin %VAULT_BRANCH%
if errorlevel 1 goto :rebase_fail

echo       正在推送 ...
git push origin %VAULT_BRANCH%
if errorlevel 1 goto :push_fail

echo.
echo       [完成] 笔记已推送到私有仓库。
popd
goto :site

:vault_clean
echo       没有检测到笔记改动，跳过。
popd
goto :site

:rebase_fail
popd
echo.
echo       [失败] 与远端冲突，需要手动处理。请在本窗口执行：
echo                  cd /d "%VAULT%"
echo                  git status
echo              解决冲突后执行：
echo                  git rebase --continue
echo                  git push origin %VAULT_BRANCH%
goto :end

:push_fail
popd
echo.
echo       [失败] 推送失败，请检查网络或 GitHub 凭据后重试。
goto :end

:clone_fail
echo.
echo       [失败] 克隆失败。请确认：
echo              1) 已安装 Git 并登录过 GitHub（首次会弹出登录窗口）
echo              2) 你有该私有仓库的访问权限
goto :end

rem ==================== 第二步：提交站点源码 ====================
:site
echo.
echo [2/2] 检查站点源码 ...
git add -A
git diff --cached --quiet
if not errorlevel 1 goto :site_clean

git commit -q -m "站点更新 %date%"
if errorlevel 1 goto :fail

echo       正在推送站点源码 ...
git push -u origin main
if errorlevel 1 goto :site_push_fail
echo       [完成] 站点源码已推送，1-2 分钟后网站自动更新。
goto :end

:site_clean
echo       站点源码无改动。
goto :end

:site_push_fail
echo.
echo       [失败] 站点源码推送失败。
echo              若这是第一次推送，请先执行一次初始化（只需一次）：
echo                  git push --force origin main
echo              之后本脚本即可正常推送。
goto :end

:no_git
echo [错误] 未检测到 git，请先安装 Git for Windows 并重新打开本窗口。
goto :end

:fail
echo.
echo [错误] 上一步执行失败，请查看上方提示信息。
goto :end

:end
echo.
echo ============================================================
echo   网站地址：https://godspead0.github.io/
echo   提示：打开网站后点击「重新同步」即可看到最新笔记。
echo ============================================================
echo.
pause
