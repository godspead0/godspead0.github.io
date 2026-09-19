/**
 * 笔记领域模型
 * ---------------------------------------------------------------
 * 仓库内的笔记路径由「笔记目录 + 子目录 + 文件名」组成，例如：
 *   全栈/前端部分/Vue.md      （技术分类，笔记目录 = 全栈）
 *   算法/力扣/二分查找.md      （算法分类，笔记目录 = 算法）
 *
 * ⚠️ 扫描起点（笔记目录）**必须由调用方传入**，不能硬编码。
 *    分类推断的语义是「笔记目录之下的第一层子目录」，
 *    所以要先剥掉笔记目录前缀，否则算法笔记会被整体归到「算法」这一个分类里，
 *    而不是它自己所在的 `力扣` / `洛谷` / …
 */

import { extractLeadLine, extractTitleFromBody, parseFrontmatter, stringifyFrontmatter } from './frontmatter.js'

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

/**
 * 剥掉「笔记目录」前缀，得到笔记目录内的相对路径。
 *   stripRootDir('全栈/前端部分/Vue.md', '全栈')  -> '前端部分/Vue.md'
 *   stripRootDir('算法/力扣/a.md', '算法')       -> '力扣/a.md'
 *   stripRootDir('力扣/a.md', '')                -> '力扣/a.md'（笔记目录 = 仓库根）
 */
export function stripRootDir(path, root = '') {
  const p = String(path || '')
  const r = String(root || '').replace(/^\/+|\/+$/g, '')
  if (!r) return p
  if (p === r) return ''
  return p.startsWith(`${r}/`) ? p.slice(r.length + 1) : p
}

/** 由路径解析出 id（容错：老文件可能没有 id 前缀） */
export function idFromPath(path) {
  const name = String(path || '').split('/').pop() || ''
  const m = name.match(/^(\d{8,})[_-]/)
  return m ? m[1] : ''
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
 * 从路径推断分类：取「笔记目录之下」的一级目录名。
 *   全栈/前端部分/Vue.md  （root=全栈）-> 前端部分
 *   算法/力扣/二分查找.md  （root=算法）-> 力扣
 *   前端部分/Vue.md       （root=''）  -> 前端部分
 * 直接躺在笔记目录根下的文件没有分类（归入「未分类」）。
 */
export function categoryFromPath(path, root = '') {
  const parts = stripRootDir(path, root).split('/').filter(Boolean)
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
export function titleFromPath(path, root = '') {
  const parts = stripRootDir(path, root).split('/').filter(Boolean)
  const file = parts.pop() || ''
  const base = file
    .replace(/\.(md|markdown)$/i, '')
    .replace(/^\d{8,}[_-]/, '') // 去掉历史托管命名的 id 前缀
    .replace(/_+/g, ' ')
    .trim()
  if (base) return base
  return parts.pop() || ''
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
  // 「笔记目录」决定路径如何解释（剥掉它才是分类 / 标题推断的起点）
  const root = input.vaultNotesDir || input.root || ''
  // 标题优先级：显式标题 → 正文标题 → 文件名 → 正文首行
  const title =
    input.title ||
    meta.title ||
    extractTitleFromBody(body) ||
    titleFromPath(input.path, root) ||
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
 * @param {{path: string, sha: string, size: number}} file 仓库内相对路径
 * @param {string} raw
 * @param {{root?: string}} [opts] root = 该 vault 的笔记目录（如 `全栈` / `算法`）。
 *   分类与标题都从「剥掉 root 之后」的路径推断 —— 不传的话多分类会全部挤成一级分类。
 */
export function parseNoteFile(file, raw, opts = {}) {
  const { meta, body } = parseFrontmatter(raw)
  const path = file?.path || ''
  const root = opts.root || ''
  return createNote({
    id: meta.id || idFromPath(path) || stableId(path),
    title: meta.title || extractTitleFromBody(body) || titleFromPath(path, root) || extractLeadLine(body),
    // 历史笔记没有 frontmatter，用目录名兜底为分类
    category: meta.category || categoryFromPath(path, root),
    tags: meta.tags,
    created: meta.created,
    updated: meta.updated,
    body,
    path,
    sha: file?.sha,
    size: file?.size,
    source: meta.source,
    vaultNotesDir: root,
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
