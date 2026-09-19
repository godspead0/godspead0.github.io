<#
  把笔记镜像到「公开展示仓库」
  ------------------------------------------------------------------
  做三件事：
    1. 首次运行时克隆公开展示仓库
    2. 把两个笔记仓库里的 .md 复制到公开仓库的对应子目录（含删除同步）
    3. 提交并推送

  设计约束：
    · 只复制 .md —— checkins.json / categories.json 由网站直接写入公开仓库，
      本脚本绝不触碰，否则会把打卡记录覆盖掉。
    · 源目录与目标子目录**全部由调用方传入**，脚本内不含任何仓库名/用户名，
      因此它可以安全地放在公开仓库里。

  由「提交笔记.bat」第三步调用。
#>
[CmdletBinding()]
param(
  [string]$TechNotesDir = '',
  [string]$TechDestSub = '',
  [string]$AlgoNotesDir = '',
  [string]$AlgoDestSub = '',
  [string]$PublicDir = '',
  [string]$PublicRemote = '',
  [string]$Branch = 'main',
  [string]$Message = ''
)

$ErrorActionPreference = 'Stop'

function Say([string]$msg) { Write-Host "      $msg" }

function Sync-MdTree {
  param([string]$Src, [string]$Dst)

  if ([string]::IsNullOrWhiteSpace($Src) -or -not (Test-Path -LiteralPath $Src)) {
    Say "跳过（源目录不存在）：$Src"
    return 0
  }

  $files = @(
    Get-ChildItem -LiteralPath $Src -Recurse -File -Filter *.md |
      Where-Object { $_.FullName -notmatch '\\\.git\\' }
  )

  if (-not (Test-Path -LiteralPath $Dst)) {
    New-Item -ItemType Directory -Force -Path $Dst | Out-Null
  }

  $want = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($f in $files) {
    $rel = $f.FullName.Substring($Src.Length).TrimStart('\', '/')
    $target = Join-Path $Dst $rel
    $parent = Split-Path -Parent $target
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
      New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    Copy-Item -LiteralPath $f.FullName -Destination $target -Force
    [void]$want.Add($target.ToLowerInvariant())
  }

  # 本地删掉的笔记也要从公开仓库移除，否则公开站点会留着早已删除的内容
  $removed = 0
  foreach ($old in @(Get-ChildItem -LiteralPath $Dst -Recurse -File -Filter *.md)) {
    if (-not $want.Contains($old.FullName.ToLowerInvariant())) {
      Remove-Item -LiteralPath $old.FullName -Force
      $removed++
    }
  }

  # 清掉因删除而空掉的目录
  foreach ($d in @(Get-ChildItem -LiteralPath $Dst -Recurse -Directory | Sort-Object { $_.FullName.Length } -Descending)) {
    if (@(Get-ChildItem -LiteralPath $d.FullName -Force).Count -eq 0) {
      Remove-Item -LiteralPath $d.FullName -Force
    }
  }

  Say ("{0} → {1} 篇" -f (Split-Path -Leaf $Src), $files.Count) | Out-Null
  if ($removed -gt 0) { Say "已移除 $removed 篇公开副本" | Out-Null }
  return $files.Count
}

if ([string]::IsNullOrWhiteSpace($PublicDir) -or [string]::IsNullOrWhiteSpace($PublicRemote)) {
  throw '缺少 -PublicDir / -PublicRemote 参数'
}

# ---------- 1. 首次克隆 ----------
if (-not (Test-Path -LiteralPath (Join-Path $PublicDir '.git'))) {
  Say '未找到公开展示仓库，正在克隆 ...'
  git clone $PublicRemote $PublicDir
  if ($LASTEXITCODE -ne 0) { throw '克隆公开展示仓库失败（检查网络与 GitHub 凭据）' }
}

# ---------- 2. 镜像 Markdown ----------
$nTech = Sync-MdTree -Src $TechNotesDir -Dst (Join-Path $PublicDir $TechDestSub)
$nAlgo = Sync-MdTree -Src $AlgoNotesDir -Dst (Join-Path $PublicDir $AlgoDestSub)
Say "镜像完成：技术 $nTech 篇、算法 $nAlgo 篇。"

# ---------- 3. 提交并推送 ----------
Push-Location -LiteralPath $PublicDir
$failed = $null
try {
  git add -A
  git diff --cached --quiet
  $hasChange = ($LASTEXITCODE -ne 0)

  if (-not $hasChange) {
    Say '公开展示仓库无改动。'
  } else {
    if ([string]::IsNullOrWhiteSpace($Message)) {
      $Message = 'mirror: 同步公开笔记 ' + (Get-Date -Format 'yyyy-MM-dd HH:mm')
    }
    git commit -q -m $Message
    if ($LASTEXITCODE -ne 0) { throw '提交公开展示仓库失败' }

    git pull --rebase origin $Branch
    if ($LASTEXITCODE -ne 0) {
      throw "公开展示仓库与远端有冲突，请到 $PublicDir 执行 git status 手动处理"
    }

    git push origin $Branch
    if ($LASTEXITCODE -ne 0) { throw '推送公开展示仓库失败（检查网络）' }

    Say '[完成] 公开展示仓库已推送。'
  }
} catch {
  $failed = $_
} finally {
  Pop-Location
}

if ($failed) { throw $failed }
exit 0
