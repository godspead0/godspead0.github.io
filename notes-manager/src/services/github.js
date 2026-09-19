/**
 * GitHub REST API 客户端（只读为主）
 * ---------------------------------------------------------------
 * 纯前端直连 GitHub，无自建后端。站点**不持有任何凭据**。
 * 职责：
 *   1. UTF-8 安全的 Base64 编解码（中文不乱码）
 *   2. listFilesViaTree + getFile / listFiles 文件级读取
 *   3. 匿名读正文走 raw CDN（不计入 API 额度）
 *   4. 统一错误拦截：403 限频、404、超时、网络异常
 *
 * `saveFile` / `deleteFile` 仍保留在服务层，但**应用层已无任何调用点** ——
 * 它们需要 Token（`requireToken`），而站点无从获得 Token，调用即抛 `NO_TOKEN`。
 * 留着是为了万一将来重新引入写路径时不至于静默写出去。
 */

const API_BASE = 'https://api.github.com'
const DEFAULT_TIMEOUT = 20000

/* ------------------------------------------------------------------ */
/* 错误类型                                                             */
/* ------------------------------------------------------------------ */

export class GithubError extends Error {
  /**
   * @param {string} message  面向用户的中文提示
   * @param {object} [info]
   * @param {number} [info.status]   HTTP 状态码
   * @param {string} [info.code]     机器可读错误码
   * @param {object} [info.detail]   原始响应体，便于调试
   */
  constructor(message, info = {}) {
    super(message)
    this.name = 'GithubError'
    this.status = info.status ?? 0
    this.code = info.code ?? 'UNKNOWN'
    this.detail = info.detail ?? null
  }
}

/** 错误码 -> 用户可读提示 */
function describeError(status, payload, resetAt) {
  const apiMessage = payload?.message || ''
  switch (status) {
    case 401:
      return {
        code: 'BAD_CREDENTIALS',
        message: 'Token 无效或已过期，请重新生成 Personal Access Token 并保存配置。',
      }
    case 403:
      if (/rate limit/i.test(apiMessage) || resetAt) {
        const when = resetAt ? new Date(resetAt * 1000).toLocaleTimeString('zh-CN') : '稍后'
        return {
          code: 'RATE_LIMIT',
          message: `GitHub API 触发限频（未认证 60 次/小时，认证 5000 次/小时）。请在 ${when} 之后重试。`,
        }
      }
      return {
        code: 'FORBIDDEN',
        message: '权限不足：请确认 Token 具备 repo（私有仓库）或 public_repo 权限。',
      }
    case 404:
      return {
        code: 'NOT_FOUND',
        message: '仓库不存在或不是公开的：请检查 Owner / Repo / Branch 拼写，并确认该仓库是 public（私有仓库匿名读不到）。',
      }
    case 409:
      return { code: 'CONFLICT', message: '文件冲突：远端内容已被修改，请先拉取最新版本再提交。' }
    case 422:
      return { code: 'VALIDATION', message: `提交被拒绝：${apiMessage || '参数校验失败'}` }
    default:
      if (status >= 500) {
        return { code: 'SERVER_ERROR', message: 'GitHub 服务端异常（5xx），请稍后重试。' }
      }
      return { code: 'HTTP_ERROR', message: apiMessage || `请求失败（HTTP ${status}）` }
  }
}

/* ------------------------------------------------------------------ */
/* UTF-8 安全的 Base64 编解码                                           */
/* ------------------------------------------------------------------ */

/**
 * 字符串 -> Base64（UTF-8 安全）
 * btoa 只接受 Latin-1，直接传入中文会抛 InvalidCharacterError。
 * 先经 TextEncoder 转 UTF-8 字节，再逐字节映射为字符。
 */
export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  const CHUNK = 0x8000 // 分块避免超长参数导致调用栈溢出
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * Base64 -> 字符串（UTF-8 安全）
 * GitHub 返回的 content 带换行符，需先清理。
 */
export function base64ToUtf8(base64) {
  const clean = String(base64).replace(/\s/g, '')
  const binary = atob(clean)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

/* ------------------------------------------------------------------ */
/* 配置管理                                                             */
/* ------------------------------------------------------------------ */

/**
 * 一个仓库配置的形状。
 * owner / repo / branch 由 `useConfig.js` 的 `PUBLIC_*` 常量填入；
 * `token` 恒为空串 —— 站点不持有凭据（保留该字段是为了让 `requireToken` 的守卫有判断依据）。
 */
export const DEFAULT_CONFIG = {
  owner: '',
  repo: '',
  branch: '',
  token: '',
}

/* ------------------------------------------------------------------ */
/* 请求核心                                                             */
/* ------------------------------------------------------------------ */

/**
 * 把 vault（多仓库配置项）归一化成 request 层需要的仓库配置。
 * 所有导出的 API 都支持显式传入 vault，内部一律走这个函数，
 * 避免「全局 currentConfig」在并发加载时互相踩踏。
 * 不传 vault 时返回默认配置（读取必然失败，符合「没配数据源」的语义）。
 */
function resolveConfig(vault) {
  if (!vault) return { ...DEFAULT_CONFIG }
  return {
    ...DEFAULT_CONFIG,
    owner: vault.owner || DEFAULT_CONFIG.owner,
    repo: vault.repo || DEFAULT_CONFIG.repo,
    branch: vault.branch || DEFAULT_CONFIG.branch,
    token: vault.token || '',
  }
}

function buildHeaders(extra = {}, cfg = DEFAULT_CONFIG) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...extra,
  }
  if (cfg.token) {
    headers.Authorization = `Bearer ${cfg.token}`
  }
  return headers
}

/**
 * 写操作守卫：匿名（访客）没有 Token，GitHub 必然拒绝写请求。
 * 提前抛出可读的错误，避免访客看到生硬的 403/404。
 */
function requireToken(cfg) {
  if (!cfg.token) {
    throw new GithubError('当前是只读模式：公开仓库任何人都能看，但只有填入 Token 后才能修改。', {
      code: 'NO_TOKEN',
    })
  }
}

function contentsUrl(path, cfg = DEFAULT_CONFIG) {
  const { owner, repo } = cfg
  const clean = String(path || '').replace(/^\/+/, '').replace(/\/+$/, '')
  const base = `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents`
  // 根目录不加尾部斜杠，避免部分网关对 /contents/ 的 301 处理差异
  return clean ? `${base}/${clean}` : base
}

/**
 * 统一 fetch 封装：超时控制 + 错误拦截 + 限频信息透出
 * @param {string} url
 * @param {RequestInit} options
 * @param {number} timeout
 * @returns {Promise<any>} 解析后的 JSON；204 返回 null
 */
async function request(url, options = {}, timeout = DEFAULT_TIMEOUT, cfg = DEFAULT_CONFIG) {
  /* 没有 Token 时不再直接报错：公开仓库允许匿名读取，访客正是靠这条路径看笔记。
     匿名调用的 API 限额是 60 次/小时（每 IP），因此匿名读正文时改走 raw CDN，
     见 getFile()。写操作没有 Token 会被 GitHub 拒绝，由界面层提前拦截。 */

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  let response
  try {
    response = await fetch(url, { ...options, headers: buildHeaders(options.headers, cfg), signal: controller.signal })
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new GithubError(`请求超时（${timeout / 1000}s）：网络较慢或被代理拦截，请检查网络后重试。`, {
        code: 'TIMEOUT',
        detail: err,
      })
    }
    throw new GithubError('网络异常：无法连接 api.github.com，请检查网络 / VPN / CORS 代理设置。', {
      code: 'NETWORK_ERROR',
      detail: err,
    })
  } finally {
    clearTimeout(timer)
  }

  if (response.status === 204) return null

  const resetAt = response.headers.get('x-ratelimit-reset')
  const remaining = response.headers.get('x-ratelimit-remaining')

  let payload = null
  const text = await response.text()
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { message: text.slice(0, 300) }
    }
  }

  if (!response.ok) {
    // 剩余额度为 0 时，一律按限频处理
    const desc =
      remaining === '0'
        ? describeError(403, payload, resetAt)
        : describeError(response.status, payload, resetAt)
    throw new GithubError(desc.message, {
      status: response.status,
      code: desc.code,
      detail: payload,
    })
  }

  return payload
}

/* 注：原先还有一个 testConnection()（验证 Token / 仓库 / 读写权限），
   随「连接设置」弹窗一起移除 —— 站点没有 Token 可测，也不需要测权限。 */

/* ------------------------------------------------------------------ */
/* 文件读写                                                             */
/* ------------------------------------------------------------------ */

/**
 * raw CDN 地址：匿名读取公开仓库正文时使用
 * 不计入 GitHub API 的 60 次/小时匿名限额，也不需要鉴权。
 * @param {string|number} [bust] 传入时附加 `?v=` 打破 CDN 缓存。
 *   raw.githubusercontent.com 带 `Cache-Control: max-age=300`，
 *   刚推完笔记点「同步」会拿到 5 分钟前的旧正文 —— 手动同步时用这个绕开。
 *   首次/自动加载**不要**传，否则每次都重新下载全部正文，白丢浏览器缓存。
 */
function rawFileUrl(path, cfg = DEFAULT_CONFIG, bust = null) {
  const { owner, repo, branch } = cfg
  const encoded = String(path || '')
    .replace(/^\/+/, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/')
  const base = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${encoded}`
  return bust ? `${base}?v=${encodeURIComponent(bust)}` : base
}

/**
 * 匿名读取公开仓库的单个文件（访客路径）
 * @returns {Promise<{content: string, sha: string, path: string} | null>} 404 返回 null
 */
async function getFileViaRaw(path, cfg, bust = null) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)
  try {
    const res = await fetch(rawFileUrl(path, cfg, bust), { signal: controller.signal })
    if (res.status === 404) return null
    if (!res.ok) {
      const hint =
        res.status === 403 || res.status === 429
          ? '公开仓库读取被限流，请稍后重试。'
          : `读取失败（HTTP ${res.status}）：仓库可能不存在、分支名写错，或该仓库并非公开仓库。`
      throw new GithubError(hint, { status: res.status, code: 'RAW_ERROR' })
    }
    return {
      content: await res.text(),
      sha: '', // 匿名模式不写文件，sha 由文件树补齐
      path: String(path || '').replace(/^\/+/, ''),
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new GithubError('请求超时，请检查网络后重试。', { code: 'TIMEOUT', detail: err })
    }
    if (err instanceof GithubError) throw err
    throw new GithubError('网络异常：无法连接 raw.githubusercontent.com，请检查网络。', {
      code: 'NETWORK_ERROR',
      detail: err,
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 读取单个文件
 * @param {string} path 仓库内相对路径，如 'checkins.json'
 * @param {object} [vault] 仓库配置
 * @param {{bust?: string|number}} [opts] bust = 打破 raw CDN 缓存（手动同步时用）
 * @returns {Promise<{content: string, sha: string, path: string} | null>} 不存在时返回 null
 */
export async function getFile(path, vault = null, opts = {}) {
  const cfg = resolveConfig(vault)

  /* 无 Token（访客）→ 走 raw CDN。
     若 94 篇笔记全用 Contents API，匿名限额 60 次/小时会瞬间打爆；
     raw CDN 无此限额。sha 留空，由调用方用文件树里的 sha 兜底，
     这样缓存仍然命中，二次刷新只花 1 次 API 调用。 */
  if (!cfg.token) return getFileViaRaw(path, cfg, opts.bust ?? null)

  const url = `${contentsUrl(path, cfg)}?ref=${encodeURIComponent(cfg.branch)}`
  try {
    const data = await request(url, {}, DEFAULT_TIMEOUT, cfg)
    if (!data || Array.isArray(data)) return null

    // 超过 1MB 的文件 Contents API 不返回 content，需要走 blob/download_url
    if (!data.content && data.size > 0) {
      const raw = await fetch(data.download_url, { headers: buildHeaders({}, cfg) })
      if (!raw.ok) {
        throw new GithubError('大文件下载失败（>1MB 需走 raw 通道）。', {
          status: raw.status,
          code: 'LARGE_FILE_ERROR',
        })
      }
      return { content: await raw.text(), sha: data.sha, path: data.path }
    }

    return {
      content: base64ToUtf8(data.content || ''),
      sha: data.sha,
      path: data.path,
    }
  } catch (err) {
    if (err instanceof GithubError && (err.status === 404 || err.code === 'NOT_FOUND')) {
      return null // 文件尚未创建，属于正常情况
    }
    throw err
  }
}

/**
 * 创建 / 更新文件
 * @param {string} path    仓库内相对路径
 * @param {string} content 文本内容（UTF-8）
 * @param {string} [sha]   已存在文件的 sha；新建时省略
 * @param {string} [message] commit message
 * @returns {Promise<{sha: string, commit: string}>}
 */
export async function saveFile(path, content, sha, message, vault = null) {
  const cfg = resolveConfig(vault)
  requireToken(cfg)
  const body = {
    message: message || `${sha ? 'update' : 'create'}: ${path}`,
    content: utf8ToBase64(content),
    branch: cfg.branch,
  }
  if (sha) body.sha = sha

  const data = await request(contentsUrl(path, cfg), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, DEFAULT_TIMEOUT, cfg)

  invalidateTree(cfg)
  return { sha: data?.content?.sha || '', commit: data?.commit?.sha || '' }
}

/**
 * 删除文件
 * @param {string} path
 * @param {string} sha
 */
export async function deleteFile(path, sha, message, vault = null) {
  const cfg = resolveConfig(vault)
  requireToken(cfg)
  const body = {
    message: message || `delete: ${path}`,
    sha,
    branch: cfg.branch,
  }
  await request(contentsUrl(path, cfg), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, DEFAULT_TIMEOUT, cfg)
  invalidateTree(cfg)
  return true
}

/**
 * 列出目录下的文件（单层）
 * @param {string} path 目录路径，空字符串表示仓库根目录
 * @returns {Promise<Array<{name: string, path: string, sha: string, size: number, type: string, download_url: string}>>}
 */
export async function listDir(path = '', vault = null) {
  const cfg = resolveConfig(vault)
  const url = `${contentsUrl(path, cfg)}?ref=${encodeURIComponent(cfg.branch)}`
  try {
    const data = await request(url, {}, DEFAULT_TIMEOUT, cfg)
    if (!Array.isArray(data)) return []
    return data.map((item) => ({
      name: item.name,
      path: item.path,
      sha: item.sha,
      size: item.size,
      type: item.type,
      download_url: item.download_url,
    }))
  } catch (err) {
    if (err instanceof GithubError && (err.status === 404 || err.code === 'NOT_FOUND')) return []
    throw err
  }
}

/**
 * 用 Git Trees API 一次性列出整棵子树的 .md 文件
 * ---------------------------------------------------------------
 * 逐层递归列目录需要「每个子目录 1 次请求」（当前 14 个子目录 = 15 次），
 * Trees API 递归模式只要 1 次就能拿到全部路径与 sha。
 * 返回 null 表示此接口不可用（无权限 / 网络失败 / 结果被截断），
 * 调用方应回退到逐层递归，保证功能不退化。
 * @param {string} dir
 * @returns {Promise<Array|null>}
 */
/**
 * 文件树缓存。
 * ---------------------------------------------------------------
 * 技术/算法两个页签通常指向**同一个仓库**的不同子目录，
 * 不缓存的话每次加载要把同一棵树取两遍。匿名访客每小时只有 60 次 API 额度，
 * 所以这里按 owner/repo@branch 缓存整棵树，只对「成功且未截断」的结果生效。
 */
const treeCache = new Map()
const TREE_TTL = 60 * 1000

/** 写/删文件后立刻失效该仓库的文件树缓存，否则新笔记要等 1 分钟才出现 */
function invalidateTree(cfg) {
  treeCache.delete(`${cfg.owner}/${cfg.repo}@${cfg.branch}`)
}

/**
 * 清空全部文件树缓存。
 * 手动点「同步」时调用：文件树缓存有 60 秒 TTL，
 * 不清的话刚推上去的新笔记连「列」都列不出来（它会继续用旧的树）。
 */
export function clearTreeCache() {
  treeCache.clear()
}

async function listFilesViaTree(dir = '', vault = null) {
  const cfg = resolveConfig(vault)
  const key = `${cfg.owner}/${cfg.repo}@${cfg.branch}`

  let data = null
  const hit = treeCache.get(key)
  if (hit && Date.now() - hit.at < TREE_TTL) data = hit.tree

  if (!data) {
    const url = `${API_BASE}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(
      cfg.repo,
    )}/git/trees/${encodeURIComponent(cfg.branch)}?recursive=1`

    try {
      data = await request(url, {}, 30000, cfg)
    } catch (err) {
      /* ⚠️ 这里的 404 必须抛出去，不能吞掉。
         本请求的 URL 里**没有路径**（只有 owner/repo/branch），
         所以 404 不可能是「笔记目录不存在」，只能是「仓库或分支不存在 / 不是公开的」。
         吞掉的话站点会静默显示「0 篇笔记」，用户完全看不出是仓库配错了。
         其它错误（403 限频、超时、网络、结果被截断）仍回退到逐层递归，功能不退化。 */
      if (err instanceof GithubError && (err.status === 404 || err.code === 'NOT_FOUND')) throw err
      return null
    }
    // truncated=true 说明仓库太大被截断，此时结果不完整，宁可回退递归
    if (!data || !Array.isArray(data.tree) || data.truncated) return null
    treeCache.set(key, { at: Date.now(), tree: data })
  }

  const prefix = String(dir || '').replace(/^\/+|\/+$/g, '')
  const files = []
  for (const node of data.tree) {
    if (node.type !== 'blob') continue
    if (!/\.(md|markdown)$/i.test(node.path)) continue
    if (prefix && !node.path.startsWith(`${prefix}/`)) continue
    files.push({
      name: node.path.slice(node.path.lastIndexOf('/') + 1),
      path: node.path,
      sha: node.sha,
      size: node.size ?? 0,
      type: 'file',
      download_url: '',
    })
  }
  return files
}

/**
 * 递归列出笔记目录下所有 .md 文件（含子目录）
 * 深度上限 6 层，避免异常结构导致请求爆炸。
 * @param {string} dir
 * @param {number} depth
 * @returns {Promise<Array>}
 */
export async function listFiles(dir = '全栈', depth = 0, vault = null) {
  if (depth > 6) return []

  // 顶层优先走 Trees API（1 次请求），失败再逐层递归
  if (depth === 0) {
    const viaTree = await listFilesViaTree(dir, vault)
    if (viaTree) return viaTree
  }

  const entries = await listDir(dir, vault)
  const files = []
  const subdirs = []

  for (const entry of entries) {
    if (entry.type === 'dir') {
      subdirs.push(entry.path)
    } else if (/\.(md|markdown)$/i.test(entry.name)) {
      files.push(entry)
    }
  }

  // 并发拉取子目录，控制并发度避免限频
  const results = []
  const CONCURRENCY = 4
  for (let i = 0; i < subdirs.length; i += CONCURRENCY) {
    const batch = subdirs.slice(i, i + CONCURRENCY)
    const settled = await Promise.all(batch.map((d) => listFiles(d, depth + 1, vault)))
    results.push(...settled.flat())
  }

  return files.concat(results)
}

/**
 * 读取当前仓库最新 commit 时间，用于展示"最后同步时间"
 */
export async function getLatestCommit(vault = null) {
  const cfg = resolveConfig(vault)
  const url = `${API_BASE}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(
    cfg.repo,
  )}/commits?sha=${encodeURIComponent(cfg.branch)}&per_page=1`
  const data = await request(url, {}, DEFAULT_TIMEOUT, cfg)
  if (Array.isArray(data) && data.length) {
    return {
      sha: data[0].sha,
      date: data[0].commit?.committer?.date || '',
      message: data[0].commit?.message || '',
    }
  }
  return null
}
