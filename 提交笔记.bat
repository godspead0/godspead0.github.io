@echo off
rem ================================================================
rem  IMPORTANT: keep this file PURE ASCII. Do not add Chinese here,
rem  and do not remove the chcp line.
rem
rem  Why:  cmd.exe reads a .bat file byte-by-byte using the system
rem  OEM code page (936 on a Chinese Windows), NOT UTF-8. Chinese
rem  text stored as UTF-8 therefore shows up as mojibake, and worse,
rem  switching the code page with "chcp" part-way through the file
rem  makes cmd resume reading at a wrong byte offset -- it then
rem  splits later lines in half (symptoms: "'-AlgoNotesDir' is not
rem  recognized as an internal or external command", "'ail' is not
rem  recognized...", and broken "^" continuations).
rem
rem  Because this file is pure ASCII, every byte is one character in
rem  both cp936 and cp65001, so "chcp 65001" here is safe and keeps
rem  cmd's line offsets correct.
rem
rem  All real work and all Chinese output live in submit-notes.ps1,
rem  which is UTF-8 *with BOM* so PowerShell decodes it correctly.
rem ================================================================
setlocal
title Submit Notes
cd /d "%~dp0"

rem Prefer PowerShell 7 (pwsh) when available; fall back to Windows PowerShell 5.1.
set "PS=powershell"
where pwsh >nul 2>nul && set "PS=pwsh"

chcp 65001 >nul

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0submit-notes.ps1"
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" echo [FAILED] exit code %RC% -- see the messages above.
echo Press any key to close this window . . .
pause >nul
