/**
 * GitHub Contents API 服务层
 * ---------------------------------------------------------------
 * 纯前端直连 GitHub REST API，无自建后端。
 * 职责：
 *   1. 凭据管理（localStorage）
 *   2. UTF-8 安全的 Base64 编解码（中文不乱码）
 *   3. getFile / saveFile / deleteFile / listFiles 文件级封装
 *   4. SHA 乐观锁校验，防止并发覆盖
 *   5. 统一错误拦截：401 Token 失效、403 限频、404、超时、网络异常
 */

const API_BASE = 'https://api.github.com'
const STORAGE_KEY = 'notes-manager.config.v1'
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
        message: '仓库或路径不存在：请检查 Owner / Repo / Branch 拼写，以及 Token 是否有权访问该私有仓库。',
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

export const DEFAULT_CONFIG = {
  owner: 'godspead0',
  repo: 'godspead0_understand',
  branch: 'master',
  token: '',
  tokenPrefix: 'ghp-', // 仅用于 UI 提示，不参与请求
}

export function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_CONFIG }
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_CONFIG, ...parsed }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function persistConfig(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    return true
  } catch (err) {
    throw new GithubError('本地存储写入失败：浏览器可能处于隐私模式或容量已满。', {
      code: 'STORAGE_ERROR',
      detail: err,
    })
  }
}

export function clearConfig() {
  localStorage.removeItem(STORAGE_KEY)
}

/* ------------------------------------------------------------------ */
/* 请求核心                                                             */
/* ------------------------------------------------------------------ */

let currentConfig = loadConfig()

export function setConfig(next) {
  currentConfig = { ...currentConfig, ...next }
  persistConfig(currentConfig)
  return currentConfig
}

export function getConfig() {
  return { ...currentConfig }
}

export function isConfigured() {
  return Boolean(currentConfig.token && currentConfig.owner && currentConfig.repo)
}

function buildHeaders(extra = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...extra,
  }
  if (currentConfig.token) {
    headers.Authorization = `Bearer ${currentConfig.token}`
  }
  return headers
}

function contentsUrl(path) {
  const { owner, repo } = currentConfig
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
async function request(url, options = {}, timeout = DEFAULT_TIMEOUT) {
  if (!currentConfig.token) {
    throw new GithubError('尚未配置 Personal Access Token，请先在「连接设置」中填写。', {
      code: 'NO_TOKEN',
    })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  let response
  try {
    response = await fetch(url, { ...options, headers: buildHeaders(options.headers), signal: controller.signal })
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

/* ------------------------------------------------------------------ */
/* 连通性测试                                                           */
/* ------------------------------------------------------------------ */

/**
 * 验证 Token / 仓库 / 分支是否可用
 * @returns {Promise<{repo: string, branch: string, private: boolean, canWrite: boolean, user: string}>}
 */
export async function testConnection() {
  const repoInfo = await request(`${API_BASE}/repos/${currentConfig.owner}/${currentConfig.repo}`)
  let user = ''
  try {
    const me = await request(`${API_BASE}/user`)
    user = me?.login || ''
  } catch {
    /* Token 可能是 fine-grained 且无 user 权限，忽略 */
  }
  const branch = currentConfig.branch || repoInfo.default_branch
  return {
    repo: repoInfo.full_name,
    branch,
    private: Boolean(repoInfo.private),
    canWrite: Boolean(repoInfo.permissions?.push),
    user,
  }
}

/* ------------------------------------------------------------------ */
/* 文件读写                                                             */
/* ------------------------------------------------------------------ */

/**
 * 读取单个文件
 * @param {string} path 仓库内相对路径，如 'checkins.json'
 * @returns {Promise<{content: string, sha: string, path: string} | null>} 不存在时返回 null
 */
export async function getFile(path) {
  const url = `${contentsUrl(path)}?ref=${encodeURIComponent(currentConfig.branch)}`
  try {
    const data = await request(url)
    if (!data || Array.isArray(data)) return null

    // 超过 1MB 的文件 Contents API 不返回 content，需要走 blob/download_url
    if (!data.content && data.size > 0) {
      const raw = await fetch(data.download_url, { headers: buildHeaders() })
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
export async function saveFile(path, content, sha, message) {
  const body = {
    message: message || `${sha ? 'update' : 'create'}: ${path}`,
    content: utf8ToBase64(content),
    branch: currentConfig.branch,
  }
  if (sha) body.sha = sha

  const data = await request(contentsUrl(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  return { sha: data?.content?.sha || '', commit: data?.commit?.sha || '' }
}

/**
 * 删除文件
 * @param {string} path
 * @param {string} sha
 */
export async function deleteFile(path, sha, message) {
  const body = {
    message: message || `delete: ${path}`,
    sha,
    branch: currentConfig.branch,
  }
  await request(contentsUrl(path), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return true
}

/**
 * 列出目录下的文件（单层）
 * @param {string} path 目录路径，空字符串表示仓库根目录
 * @returns {Promise<Array<{name: string, path: string, sha: string, size: number, type: string, download_url: string}>>}
 */
export async function listDir(path = '') {
  const url = `${contentsUrl(path)}?ref=${encodeURIComponent(currentConfig.branch)}`
  try {
    const data = await request(url)
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
 * 递归列出笔记目录下所有 .md 文件（含子目录）
 * 深度上限 6 层，避免异常结构导致请求爆炸。
 * @param {string} dir
 * @param {number} depth
 * @returns {Promise<Array>}
 */
export async function listFiles(dir = '全栈', depth = 0) {
  if (depth > 6) return []
  const entries = await listDir(dir)
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
    const settled = await Promise.all(batch.map((d) => listFiles(d, depth + 1)))
    results.push(...settled.flat())
  }

  return files.concat(results)
}

/**
 * 读取当前仓库最新 commit 时间，用于展示"最后同步时间"
 */
export async function getLatestCommit() {
  const url = `${API_BASE}/repos/${currentConfig.owner}/${currentConfig.repo}/commits?sha=${encodeURIComponent(
    currentConfig.branch,
  )}&per_page=1`
  const data = await request(url)
  if (Array.isArray(data) && data.length) {
    return {
      sha: data[0].sha,
      date: data[0].commit?.committer?.date || '',
      message: data[0].commit?.message || '',
    }
  }
  return null
}
