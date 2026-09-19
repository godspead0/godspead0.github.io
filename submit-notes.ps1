<#
  提交笔记（技术 + 算法 + 公开镜像 + 站点源码）
  ==================================================================
  由「提交笔记.bat」调用。

  ⚠️ 为什么中文不写在 .bat 里：
     cmd.exe 是**按系统 OEM 代码页**（中文 Windows 是 936）逐字节读取批处理文件的，
     不是按 UTF-8。所以 .bat 里的中文会变成乱码；更糟的是 `chcp 65001` 一旦在文件
     中途改变代码页，cmd 之后按字节偏移续读就会错位，**把后面的行从中间劈开**
     （典型症状：`'-AlgoNotesDir' 不是内部或外部命令`、`'ail' 不是内部或外部命令`，
     以及 `^` 续行失效）。
     结论：.bat 必须保持纯 ASCII，所有中文输出都放在这个 .ps1 里 ——
     本文件是 UTF-8 **带 BOM**，PowerShell 会正确识别编码，中文不会乱。

  四步：
    [1/4] 提交推送技术私有仓库（master）
    [2/4] 提交推送算法私有仓库（main）
    [3/4] 把两个工作区里的 .md / .markdown 单向镜像到公开展示仓库并推送
          ← 网站展示的就是这一步的结果
    [4/4] 提交推送站点源码（只在改了网站代码时才有内容）

  远端全部使用 SSH：本机 github.com:443 常被拦，~/.ssh/config 已把 github.com
  映射到 ssh.github.com:443（GitHub 官方备用入口）。
#>
[CmdletBinding()]
param([string]$Message = '')

# 让中文在控制台正常显示。
# 「提交笔记.bat」已用 chcp 65001 把控制台切到 UTF-8，这里把 .NET 的输出编码
# 也对齐到 UTF-8 —— 两边必须一致，只改一边反而会乱码。
# bat 本身是纯 ASCII，所以 chcp 改变代码页不会让 cmd 的字节偏移错位。
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
  # 某些宿主（如重定向到文件）不支持设置，忽略即可
}

# 刻意不用 'Stop'：每一步自己判断退出码并给出中文提示。
# 抛异常会把后面本来还能跑完的步骤一起中断掉；而且 Stop + 被重定向的 stderr
# 会把 git 的进度信息变成终止性错误（见 Invoke-Native 的注释）。
$ErrorActionPreference = 'Continue'

$Root = $PSScriptRoot

# ==================== 笔记仓库（与站点目录同级，不在站点仓库内部）====================
# 技术笔记：笔记位于 全栈/ 目录
$TechDir    = 'D:\vscode_test_all\godspead0_understand'
$TechRemote = 'git@github.com:godspead0/godspead0_understand.git'
$TechBranch = 'master'
$TechLabel  = '技术笔记'
$TechSub    = '全栈'

# 算法笔记：笔记位于 笔记/ 目录（不是仓库根目录）
$AlgoDir    = 'D:\vscode_test_all\test_algorithm'
$AlgoRemote = 'git@github.com:godspead0/godspead0_algorithm.git'
$AlgoBranch = 'main'
$AlgoLabel  = '算法笔记'
$AlgoSub    = '笔记'

# ==================== 公开展示仓库（网站对所有人展示的就是它）====================
# public，只放 .md / .markdown 副本；私有工作区里的 .cpp / origin/ 等不会进来。
$PublicDir     = 'D:\vscode_test_all\notes_public'
$PublicRemote  = 'git@github.com:godspead0/godspead0_notes1.git'
$PublicBranch  = 'main'
$PublicTechSub = '全栈'   # 技术笔记从 全栈/ 复制到这里
$PublicAlgoSub = '算法'   # 算法笔记从 笔记/ 复制到这里

# 公开仓库统一使用的匿名身份。
# 注意：**不能**判断「user.email 是否为空」—— git config 读的是含全局配置的生效值，
# 新克隆的仓库会继承全局的真实邮箱，一旦判断非空就跳过，真实邮箱就被提交进公开仓库了。
$BotEmail = '174760772+godspead0@users.noreply.github.com'
$BotName  = 'zhongrongwei'

function Say([string]$m)  { Write-Host "      $m" }
function Fail([string]$m) { Write-Host "      [失败] $m" }

# 运行原生命令，只以**退出码**判断成败，并且保证不污染调用方的返回值。
#
# 这个包装是必须的，踩过两个坑：
#   1. git 把进度/叙述写到 stderr（"Cloning into" / "From" / "To"）。若调用方把 stderr
#      重定向了，PowerShell 会把它们变成终止性错误 —— 明明成功却报失败。
#   2. git push / git pull 还会往 **stdout** 写东西（"To <url>"、ref 更新摘要）。
#      函数里若直接调用，这些输出会和 `return $false` 一起被当成返回值，函数就返回
#      数组 @('To ...', $false)；调用方写 `if (-not (Sync-Vault ...))` 时，非空数组
#      恒为真，于是**冲突明明发生了却继续往下跑**，还把镜像推了上去。
# 所以：丢弃 stdout，只返回整数退出码。
function Invoke-Native {
  param([string]$Exe, [string[]]$ExeArgs)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $Exe @ExeArgs | Out-Null
    $code = $LASTEXITCODE
    return $code
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Invoke-Git {
  param([string[]]$GitArgs)
  return (Invoke-Native 'git' $GitArgs)
}

# ==================== 单个笔记仓库的同步 ====================
# 返回值严格是 [bool]：函数体里除 return 外没有任何东西写进管道，
# 否则调用方的判断会被数组带偏（见 Invoke-Native 注释第 2 条）。
function Sync-Vault {
  param(
    [string]$Dir, [string]$Remote, [string]$Branch,
    [string]$Label, [string]$Msg, [string]$Step
  )

  Write-Host "[$Step] 同步$Label ..."

  if (-not (Test-Path -LiteralPath (Join-Path $Dir '.git'))) {
    Say '未找到本地仓库，正在克隆 ...'
    if ((Invoke-Native 'git' @('clone', $Remote, $Dir)) -ne 0) {
      Fail '克隆失败。请确认已安装 Git、已登录 GitHub，且你有该私有仓库的权限。'
      return $false
    }
  }

  Push-Location -LiteralPath $Dir
  try {
    [void](Invoke-Git @('add', '-A'))
    if ((Invoke-Git @('diff', '--cached', '--quiet')) -eq 0) {
      Say '没有检测到改动，跳过。'
      Write-Host ''
      return $true
    }

    Say '正在提交 ...'
    if ((Invoke-Git @('commit', '-q', '-m', $Msg)) -ne 0) {
      Fail '提交失败（可能是 Git 身份未配置）。'
      return $false
    }

    Say '正在同步远端最新改动 ...'
    if ((Invoke-Git @('pull', '--rebase', 'origin', $Branch)) -ne 0) {
      Fail "$Label 与远端冲突，需要手动处理。请执行："
      Say "cd /d `"$Dir`""
      Say 'git status                    # 看看哪些文件冲突'
      Say 'git rebase --continue         # 改好冲突并 git add 之后'
      Say 'git rebase --abort            # 想放弃本次提交、回到动手之前'
      Say "git push origin $Branch"
      return $false
    }

    Say '正在推送 ...'
    if ((Invoke-Git @('push', 'origin', $Branch)) -ne 0) {
      Fail "$Label 推送失败，请检查网络或 GitHub 凭据。"
      return $false
    }

    Say "[完成] $Label 已推送。"
    Write-Host ''
    return $true
  } finally {
    Pop-Location
  }
}

# ==================== 主流程 ====================

Write-Host '============================================================'
Write-Host '              笔记提交助手（技术 + 算法 + 公开镜像）'
Write-Host '============================================================'
Write-Host "  站点目录：$Root"
Write-Host "  技术笔记：$TechDir   (分支 $TechBranch)"
Write-Host "  算法笔记：$AlgoDir   (分支 $AlgoBranch)"
Write-Host "  公开展示：$PublicDir   (分支 $PublicBranch)"
Write-Host '============================================================'
Write-Host ''

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host '[错误] 未检测到 git，请先安装 Git for Windows 并重新打开本窗口。'
  exit 1
}

if ([string]::IsNullOrWhiteSpace($Message)) {
  $Message = Read-Host '请输入本次提交说明（直接回车使用默认）'
}
if ([string]::IsNullOrWhiteSpace($Message)) {
  $Message = "更新笔记 $(Get-Date -Format 'yyyy-MM-dd')"
}
Write-Host ''

# ---- 1/4、2/4 两个私有工作区 ----
# 用 -eq $false 而不是 -not：万一将来 Sync-Vault 又漏出多余输出成了数组，
# 这里也能正确判定为「失败」并停下来，而不是继续把镜像推上去。
if ((Sync-Vault -Dir $TechDir -Remote $TechRemote -Branch $TechBranch -Label $TechLabel -Msg $Message -Step '1/4') -eq $false) {
  Write-Host ''
  Write-Host '[失败] 笔记仓库同步失败，已跳过后续步骤（详见上方提示）。'
  exit 1
}
if ((Sync-Vault -Dir $AlgoDir -Remote $AlgoRemote -Branch $AlgoBranch -Label $AlgoLabel -Msg $Message -Step '2/4') -eq $false) {
  Write-Host ''
  Write-Host '[失败] 笔记仓库同步失败，已跳过后续步骤（详见上方提示）。'
  exit 1
}

# ---- 3/4 单向镜像到公开展示仓库 ----
Write-Host '[3/4] 同步公开展示仓库 ...'
$mirror = Join-Path $Root '镜像到公开仓库.ps1'
$mirrorErr = $null
try {
  & $mirror `
    -TechNotesDir (Join-Path $TechDir $TechSub) -TechDestSub $PublicTechSub `
    -AlgoNotesDir (Join-Path $AlgoDir $AlgoSub) -AlgoDestSub $PublicAlgoSub `
    -PublicDir $PublicDir -PublicRemote $PublicRemote `
    -Branch $PublicBranch -Message $Message
} catch {
  $mirrorErr = $_
}
if ($mirrorErr) {
  Write-Host ''
  Fail $mirrorErr.Exception.Message
  Write-Host '[失败] 公开展示仓库同步失败 —— 私有仓库已推送成功，'
  Write-Host '       但网站展示的还是旧内容。修好网络后重跑一次即可。'
  exit 1
}
Write-Host ''

# ---- 4/4 站点源码 ----
Write-Host '[4/4] 检查站点源码 ...'
Push-Location -LiteralPath $Root
try {
  # 本仓库是公开的，无条件写入匿名身份（理由见上方 $BotEmail 的注释）
  [void](Invoke-Git @('config', 'user.email', $BotEmail))
  [void](Invoke-Git @('config', 'user.name', $BotName))

  [void](Invoke-Git @('add', '-A'))
  if ((Invoke-Git @('diff', '--cached', '--quiet')) -eq 0) {
    Say '站点源码无改动。'
  } else {
    if ((Invoke-Git @('commit', '-q', '-m', "站点更新 $(Get-Date -Format 'yyyy-MM-dd HH:mm')")) -ne 0) {
      Fail '站点源码提交失败。'
    } else {
      Say '正在推送站点源码 ...'
      # 远端是 SSH，偶尔会抖，重试几次
      $pushed = $false
      for ($i = 1; $i -le 5; $i++) {
        if ((Invoke-Git @('push', 'origin', 'main')) -eq 0) { $pushed = $true; break }
        Say "第 $i 次失败，8 秒后重试 ..."
        Start-Sleep -Seconds 8
      }
      if ($pushed) {
        Say '[完成] 站点源码已推送，1-2 分钟后网站自动更新。'
      } else {
        Write-Host ''
        Fail '站点源码推送失败，请检查网络后重试。'
      }
    }
  }
} finally {
  Pop-Location
}

Write-Host ''
Write-Host '============================================================'
Write-Host '  网站地址：https://godspead0.github.io/'
Write-Host '  提示：打开网站后点右上角「同步」即可看到最新笔记。'
Write-Host '============================================================'
exit 0
