/**
 * Markdown 渲染服务
 * ---------------------------------------------------------------
 * marked 负责解析，DOMPurify 负责消毒。
 * 笔记正文来自远端仓库（可被任何协作者修改），因此**必须**经过
 * DOMPurify 清洗后再 v-html，避免 XSS。
 *
 * 安全策略（fail-closed）：
 *   若当前环境无法提供可用的 DOMPurify（例如 SSR / 老旧浏览器 / 消毒器加载失败），
 *   绝不"原样输出 HTML"，而是整体降级为转义后的纯文本 <pre>，
 *   宁可少渲染样式，也不允许脚本注入。
 */
import { marked } from 'marked'
import dompurifyImport from 'dompurify'

marked.setOptions({
  gfm: true, // 表格、任务列表、删除线
  breaks: true, // 单个换行即换行，符合笔记书写习惯
})

/* ------------------------------------------------------------------ */
/* 消毒器解析                                                          */
/* ------------------------------------------------------------------ */

function escapeHtml(text) {
  return String(text ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )
}

/**
 * 浏览器中 dompurify 的 default 导出就是初始化好的实例；
 * 无 DOM 环境（SSR / Node 脚本）下它是工厂函数，此时按"消毒不可用"处理。
 */
function resolvePurifier() {
  let candidate = dompurifyImport
  if (typeof candidate === 'function' && typeof candidate.sanitize !== 'function') {
    try {
      candidate = candidate(globalThis.window)
    } catch {
      candidate = null
    }
  }
  if (!candidate || typeof candidate.sanitize !== 'function') return null
  // isSupported 为 false 时 sanitize 会原样返回输入（fail-open），必须拒绝
  if (candidate.isSupported === false) return null
  return candidate
}

const purifier = resolvePurifier()

let hooksInstalled = false

function installHooks() {
  if (hooksInstalled || !purifier) return
  hooksInstalled = true
  // 外链新窗口打开，并阻断 opener 引用
  purifier.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('href')) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer nofollow')
    }
  })
}

/* ------------------------------------------------------------------ */
/* 对外 API                                                            */
/* ------------------------------------------------------------------ */

/** 当前环境是否具备 HTML 消毒能力 */
export const canSanitize = Boolean(purifier)

export function renderMarkdown(text) {
  const source = String(text ?? '')
  const plainFallback = `<pre class="md-plain">${escapeHtml(source)}</pre>`

  try {
    if (!purifier) return plainFallback
    const raw = marked.parse(source, { async: false })
    installHooks()
    const clean = purifier.sanitize(raw, { ADD_ATTR: ['target', 'rel'] })
    // 消毒器在极端情况下可能返回空串，此时同样降级，避免"内容消失"
    return clean && clean.trim() ? clean : plainFallback
  } catch {
    return plainFallback
  }
}

/** 提取纯文本摘要（用于列表预览） */
export function toPlainText(md, limit = 160) {
  const text = String(md ?? '')
    .replace(/```[\s\S]*?```/g, ' ') // 代码块
    .replace(/`[^`]*`/g, ' ') // 行内代码
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接保留文字
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // 标题
    .replace(/^\s{0,3}>\s?/gm, '') // 引用
    .replace(/^\s{0,3}[-*+]\s+/gm, '') // 列表
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/**
 * 粗略估算阅读时长（中文 400 字/分钟，英文 200 词/分钟）
 * @returns {number} 分钟，最小 1
 */
export function readingMinutes(text) {
  const s = String(text ?? '')
  const cjk = (s.match(/[\u4e00-\u9fa5]/g) || []).length
  const words = (s.replace(/[\u4e00-\u9fa5]/g, ' ').match(/[A-Za-z0-9_'-]+/g) || []).length
  return Math.max(1, Math.round(cjk / 400 + words / 200))
}
