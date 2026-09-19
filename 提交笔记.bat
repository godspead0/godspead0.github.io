@echo off
chcp 65001 >nul
setlocal
title 提交笔记（技术 + 算法）

cd /d "%~dp0"

set "ROOT=%~dp0"

rem ==================== 笔记仓库（与站点目录同级，不在站点仓库内部）====================
rem 技术笔记：笔记位于 全栈/ 目录
set "TECH_DIR=D:\vscode_test_all\godspead0_understand"
set "TECH_REMOTE=https://github.com/godspead0/godspead0_understand.git"
set "TECH_BRANCH=master"
set "TECH_LABEL=技术笔记"

rem 算法笔记：笔记直接位于仓库根目录
set "ALGO_DIR=D:\vscode_test_all\test_algorithm"
set "ALGO_REMOTE=https://github.com/godspead0/godspead0_algorithm.git"
set "ALGO_BRANCH=main"
set "ALGO_LABEL=算法笔记"

rem ==================== 公开展示仓库（网站对所有人展示的就是它）====================
rem 这个仓库是 public 的，只放 .md 笔记副本；私有工作区里的 .cpp / origin/ 等不会进来。
set "PUBLIC_DIR=D:\vscode_test_all\notes_public"
set "PUBLIC_REMOTE=https://github.com/godspead0/godspead0_notes.git"
set "PUBLIC_BRANCH=main"
rem 公开仓库内的子目录名（技术笔记从 全栈/ 复制过去，算法笔记从根目录复制到 算法/）
set "PUBLIC_TECH_SUB=全栈"
set "PUBLIC_ALGO_SUB=算法"

echo ============================================================
echo               笔记提交助手（技术 + 算法 + 公开镜像）
echo ============================================================
echo   站点目录：%ROOT%
echo   技术笔记：%TECH_DIR%   (分支 %TECH_BRANCH%)
echo   算法笔记：%ALGO_DIR%   (分支 %ALGO_BRANCH%)
echo   公开展示：%PUBLIC_DIR%   (分支 %PUBLIC_BRANCH%)
echo ============================================================
echo.

where git >nul 2>nul
if errorlevel 1 goto :no_git

set "MSG="
set /p "MSG=请输入本次提交说明（直接回车使用默认）："
if "%MSG%"=="" set "MSG=更新笔记 %date%"
echo.

call :sync_vault "%TECH_DIR%" "%TECH_REMOTE%" "%TECH_BRANCH%" "%TECH_LABEL%" "%MSG%" "1/4"
if errorlevel 1 goto :vault_fail

call :sync_vault "%ALGO_DIR%" "%ALGO_REMOTE%" "%ALGO_BRANCH%" "%ALGO_LABEL%" "%MSG%" "2/4"
if errorlevel 1 goto :vault_fail

rem ==================== 第三步：镜像到公开展示仓库 ====================
echo [3/4] 同步公开展示仓库 ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0镜像到公开仓库.ps1" ^
  -TechNotesDir "%TECH_DIR%\%PUBLIC_TECH_SUB%" -TechDestSub "%PUBLIC_TECH_SUB%" ^
  -AlgoNotesDir "%ALGO_DIR%" -AlgoDestSub "%PUBLIC_ALGO_SUB%" ^
  -PublicDir "%PUBLIC_DIR%" -PublicRemote "%PUBLIC_REMOTE%" ^
  -Branch "%PUBLIC_BRANCH%" -Message "%MSG%"
if errorlevel 1 goto :public_fail
echo.

goto :site

rem ==================== 子过程：同步单个笔记仓库 ====================
rem 参数：%1=目录 %2=远端 %3=分支 %4=名称 %5=提交说明 %6=步骤号
:sync_vault
set "V_DIR=%~1"
set "V_REMOTE=%~2"
set "V_BRANCH=%~3"
set "V_LABEL=%~4"
set "V_MSG=%~5"

echo [%6] 同步%V_LABEL% ...
if exist "%V_DIR%\.git" goto :sv_ready

echo       未找到本地仓库，正在克隆 ...
git clone "%V_REMOTE%" "%V_DIR%"
if errorlevel 1 goto :sv_clone_fail

:sv_ready
pushd "%V_DIR%"
git add -A
git diff --cached --quiet
if not errorlevel 1 goto :sv_clean

echo       正在提交 ...
git commit -q -m "%V_MSG%"
if errorlevel 1 goto :sv_fail

echo       正在同步远端最新改动 ...
git pull --rebase origin %V_BRANCH%
if errorlevel 1 goto :sv_conflict

echo       正在推送 ...
git push origin %V_BRANCH%
if errorlevel 1 goto :sv_push_fail

echo       [完成] %V_LABEL% 已推送。
echo.
popd
exit /b 0

:sv_clean
echo       没有检测到改动，跳过。
echo.
popd
exit /b 0

:sv_clone_fail
echo       [失败] 克隆失败。请确认已安装 Git、已登录 GitHub，且你有该私有仓库权限。
exit /b 1

:sv_conflict
popd
echo       [失败] %V_LABEL% 与远端冲突，需要手动处理。请执行：
echo                  cd /d "%V_DIR%"
echo                  git status
echo              解决冲突后：
echo                  git rebase --continue
echo                  git push origin %V_BRANCH%
exit /b 3

:sv_push_fail
popd
echo       [失败] %V_LABEL% 推送失败，请检查网络或 GitHub 凭据。
exit /b 4

:sv_fail
popd
echo       [失败] %V_LABEL% 提交失败。
exit /b 2

rem ==================== 第四步：提交站点源码 ====================
:site
echo [4/4] 检查站点源码 ...
git add -A
git diff --cached --quiet
if not errorlevel 1 goto :site_clean

git commit -q -m "站点更新 %date%"
if errorlevel 1 goto :fail

echo       正在推送站点源码 ...
git push -u origin main
if not errorlevel 1 goto :site_ok
rem 直连 github.com:443 有时会被拦，回退走本机代理
echo       直连失败，尝试通过本机代理 127.0.0.1:7892 推送 ...
git -c http.proxy=http://127.0.0.1:7892 push -u origin main
if errorlevel 1 goto :site_push_fail

:site_ok
echo       [完成] 站点源码已推送，1-2 分钟后网站自动更新。
goto :end

:site_clean
echo       站点源码无改动。
goto :end

:site_push_fail
echo.
echo       [失败] 站点源码推送失败，请检查网络后重试。
goto :end

:vault_fail
echo.
echo       [失败] 笔记仓库同步失败，已跳过后续步骤（详见上方提示）。
goto :end

:public_fail
echo.
echo       [失败] 公开展示仓库同步失败 —— 私有仓库已推送成功，
echo              但网站展示的还是旧内容。修好网络后重跑一次即可。
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
