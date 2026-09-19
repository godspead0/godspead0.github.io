/**
 * 笔记领域模型
 * ---------------------------------------------------------------
 * 文件名约定： 全栈/{id}_{slug}.md
 *   id    : 13 位时间戳（毫秒级，天然可排序且难冲突）
 *   slug  : 标题转写，保留中文；仅剔除文件系统非法字符
 */

import { extractLeadLine, extractTitleFromBody, parseFrontmatter, stringifyFrontmatter } from './frontmatter.js'

export const NOTES_DIR = '全栈'

/** 生成 13 位时间戳 id */
export function genId() {
  return String(Date.now())
}

/**
 * 标题 -> 文件名安全 slug
 * 保留中英文与数字，空白转连字符，剔除 Windows/POSIX 非法字符。
 */
export function slugify(title) {
  const base = String(title || '')
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '') // 非法字符
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '')
    .slice(0, 60)
  return base || 'untitled'
}

/** 由 id + 标题构造仓库内相对路径 */
export function buildPath(id, title, dir = NOTES_DIR) {
  const name = `${id}_${slugify(title)}.md`
  const base = String(dir || '').replace(/^\/+|\/+$/g, '')
  return base ? `${base}/${name}` : name
}

/** 由路径解析出 id（容错：老文件可能没有 id 前缀） */
export function idFromPath(path) {
  const name = String(path || '').split('/').pop() || ''
  const m = name.match(/^(\d{8,})[_-]/)
  return m ? m[1] : ''
}

/**
 * 是否为 SPA 托管命名的文件（全栈/{id}_{slug}.md）。
 * 用户手工整理的历史笔记不满足该命名，更新时应原位写回，避免被改名搬移。
 */
export function isManagedPath(path) {
  return new RegExp(`^${NOTES_DIR}/\\d{8,}[_-][^/]*\\.md$`, 'i').test(String(path || ''))
}

/**
 * 由路径派生稳定 id（djb2 -> base36）。
 * 历史笔记没有 frontmatter id，用路径哈希保证每次加载 id 一致。
 */
export function stableId(path) {
  const s = String(path || '')
  if (!s) return ''
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return `p${(h >>> 0).toString(36)}`
}

/**
 * 从路径推断分类：取一级目录名。
 * 兼容两种布局：
 *   全栈/前端部分/Vue.md -> 前端部分
 *   前端部分/Vue.md            -> 前端部分
 */
export function categoryFromPath(path) {
  let parts = String(path || '').split('/').filter(Boolean)
  if (parts[0] === NOTES_DIR) parts = parts.slice(1)
  return parts.length >= 2 ? parts[0] : ''
}

/**
 * 由文件名兜底推断标题。
 * 你的笔记里有不少 0 字节的占位文件（如 前端总结.md、其他/Git.md），
 * 它们没有正文可提取标题 —— 用文件名当标题远比「未命名笔记」有意义。
 * 例：全栈/语言部分/Rust.md        -> Rust
 *     全栈/1758000000000_示例-标题.md -> 示例-标题（去掉 id 前缀）
 *     全栈/一些个人理解/.md          -> 一些个人理解（文件名不可用时退回上级目录）
 */
export function titleFromPath(path) {
  const parts = String(path || '').split('/').filter(Boolean)
  const file = parts.pop() || ''
  const base = file
    .replace(/\.(md|markdown)$/i, '')
    .replace(/^\d{8,}[_-]/, '') // 去掉 SPA 托管命名的 id 前缀
    .replace(/_+/g, ' ')
    .trim()
  if (base) return base
  return parts.filter((p) => p !== NOTES_DIR).pop() || ''
}

/**
 * 规范化标签数组
 */
export function normalizeTags(input) {
  const arr = Array.isArray(input)
    ? input
    : String(input || '')
        .split(/[,，\s]+/)
        .filter(Boolean)
  const seen = new Set()
  const out = []
  for (const t of arr) {
    const tag = String(t).trim().replace(/^#/, '')
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

/**
 * 构造一条笔记对象
 * @param {object} input
 * @returns {object}
 */
export function createNote(input = {}) {
  const now = new Date().toISOString()
  const body = String(input.body ?? '')
  const meta = input.meta || {}
  // 标题优先级：显式标题 → 正文标题 → 文件名 → 正文首行
  const title =
    input.title ||
    meta.title ||
    extractTitleFromBody(body) ||
    titleFromPath(input.path) ||
    extractLeadLine(body) ||
    '未命名笔记'

  return {
    id: String(input.id || meta.id || genId()),
    title,
    category: input.category ?? meta.category ?? '',
    tags: normalizeTags(input.tags ?? meta.tags),
    created: input.created || meta.created || now,
    updated: input.updated || meta.updated || now,
    body,
    path: input.path || '',
    sha: input.sha || '',
    size: input.size ?? body.length,
    source: input.source || meta.source || '',
  }
}

/**
 * 解析远端 Markdown 文件为笔记对象
 * @param {{path: string, sha: string, size: number}} file
 * @param {string} raw
 */
export function parseNoteFile(file, raw) {
  const { meta, body } = parseFrontmatter(raw)
  const path = file?.path || ''
  return createNote({
    id: meta.id || idFromPath(path) || stableId(path),
    title: meta.title || extractTitleFromBody(body) || titleFromPath(path) || extractLeadLine(body),
    // 历史笔记没有 frontmatter，用目录名兜底为分类
    category: meta.category || categoryFromPath(path),
    tags: meta.tags,
    created: meta.created,
    updated: meta.updated,
    body,
    path,
    sha: file?.sha,
    size: file?.size,
    source: meta.source,
  })
}

/**
 * 笔记对象 -> Markdown 全文（含 frontmatter）
 */
export function serializeNote(note) {
  const meta = {
    id: note.id,
    title: note.title,
    category: note.category || '',
    tags: note.tags || [],
    created: note.created,
    updated: note.updated,
  }
  if (note.source) meta.source = note.source
  return stringifyFrontmatter(meta, note.body || '')
}

/**
 * 生成 YYYY-MM-DD（本地时区，用于打卡键名）
 */
export function toDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 'YYYY-MM' -> '2026年9月' 归档分组标题 */
export function formatArchiveLabel(monthKey) {
  const [y, m] = String(monthKey).split('-')
  return `${y}年${Number(m)}月`
}

/** ISO 时间 -> 展示文本 */
export function formatDateTime(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`
}

/** 统计正文可读字数（中文按字计，英文按词计，近似） */
export function countWords(text) {
  const s = String(text || '')
  const cjk = (s.match(/[\u4e00-\u9fa5]/g) || []).length
  const words = (s.replace(/[\u4e00-\u9fa5]/g, ' ').match(/[A-Za-z0-9_'-]+/g) || []).length
  return cjk + words
}
