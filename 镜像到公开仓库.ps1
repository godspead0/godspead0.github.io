<#
  把笔记镜像到「公开展示仓库」（单向）
  ------------------------------------------------------------------
  做三件事：
    1. 首次运行时克隆公开展示仓库
    2. 把两个笔记工作区里的 .md 复制到公开仓库的对应子目录（含删除同步）
    3. 提交并推送

  为什么是单向的？
    网站是**纯只读**的：访客只能看，页面上没有任何新建/编辑/打卡入口，
    因此公开仓库里不会出现"只存在于公开仓库"的笔记，不需要反向取回。
    内容永远是「私有工作区 → 公开仓库」这一个方向。

  设计约束：
    · 只复制 .md / .markdown —— checkins.json / categories.json 属于网站数据，
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
    # ⚠️ 这里**不能**用 -Filter *.md：Windows 通配符不做扩展名前缀匹配，
    #    实测 -Filter *.md 匹配不到 .markdown，而站点侧的正则是 /\.(md|markdown)$/i。
    #    两边不一致会让 .markdown 笔记在本地一切正常、网站上却永远看不到。
    Get-ChildItem -LiteralPath $Src -Recurse -File |
      Where-Object { $_.Extension -match '^\.(md|markdown)$' } |
      # 排除 .git / .obsidian / .claude 等工具目录，这些不该出现在公开仓库里
      Where-Object { $_.FullName -notmatch '\\\.[^\\]+\\' }
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
  # 扩展名判断必须与上面的收集逻辑**完全一致**，否则会漏删 .markdown 的旧副本
  $removed = 0
  foreach ($old in @(Get-ChildItem -LiteralPath $Dst -Recurse -File | Where-Object { $_.Extension -match '^\.(md|markdown)$' })) {
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

# ---------- 网络说明 ----------
# github.com:443 在部分网络环境下会被拦，而且拦截是间歇性的。
# 所有 git 网络操作都走这里：先直连重试，再回退本机代理（如果代理开着）。
$ProxyUrl = 'http://127.0.0.1:7892'

function Test-ProxyUp {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $c.Connect('127.0.0.1', 7892)
    $ok = $c.Connected
    $c.Close()
    return $ok
  } catch { return $false }
}

function Invoke-GitNet {
  param([string[]]$GitArgs, [int]$Retries = 3)

  for ($i = 1; $i -le $Retries; $i++) {
    git @GitArgs
    if ($LASTEXITCODE -eq 0) { return $true }
    if ($i -lt $Retries) { Say "第 $i 次失败，6 秒后重试 ..."; Start-Sleep -Seconds 6 }
  }

  if (Test-ProxyUp) {
    Say "直连不通，改走本机代理 $ProxyUrl ..."
    git -c "http.proxy=$ProxyUrl" @GitArgs
    if ($LASTEXITCODE -eq 0) { return $true }
  }
  return $false
}

# ---------- 1. 首次克隆 ----------
if (-not (Test-Path -LiteralPath (Join-Path $PublicDir '.git'))) {
  Say '未找到公开展示仓库，正在克隆 ...'
  if (-not (Invoke-GitNet -GitArgs @('clone', $PublicRemote, $PublicDir))) {
    throw '克隆公开展示仓库失败（检查网络与 GitHub 凭据）'
  }
}

# ---------- 2. 镜像 Markdown（纯单向）----------
#    网站是只读的，不会在公开仓库里生成长文，所以不需要反向取回。
$nTech = Sync-MdTree -Src $TechNotesDir -Dst (Join-Path $PublicDir $TechDestSub)
$nAlgo = Sync-MdTree -Src $AlgoNotesDir -Dst (Join-Path $PublicDir $AlgoDestSub)
Say "镜像完成：技术 $nTech 篇、算法 $nAlgo 篇。"

# 无条件写入仓库级匿名身份。
# 注意：不能判断「user.email 是否为空」—— git config 读的是**生效值**（含全局配置），
# 新克隆的仓库会继承全局的真实邮箱，一旦判断非空就跳过，真实邮箱就被提交进公开仓库了。
Push-Location -LiteralPath $PublicDir
try {
  git config user.email '174760772+godspead0@users.noreply.github.com'
  git config user.name 'zhongrongwei'
} finally { Pop-Location }

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

    if (-not (Invoke-GitNet -GitArgs @('pull', '--rebase', 'origin', $Branch))) {
      throw "公开展示仓库与远端冲突或网络不通，请到 $PublicDir 执行 git status 手动处理"
    }

    if (-not (Invoke-GitNet -GitArgs @('push', 'origin', $Branch))) {
      throw '推送公开展示仓库失败（检查网络）'
    }

    Say '[完成] 公开展示仓库已推送。'
  }
} catch {
  $failed = $_
} finally {
  Pop-Location
}

if ($failed) { throw $failed }
exit 0
