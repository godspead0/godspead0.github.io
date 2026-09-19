/**
 * 轻量 Frontmatter 解析 / 序列化
 * ---------------------------------------------------------------
 * 不引入 gray-matter 等依赖，仅支持笔记场景所需的 YAML 子集：
 *   title: 字符串
 *   tags: [a, b]  或  - a \n - b
 *   category: 字符串
 *   created / updated: ISO 时间字符串
 * 保持零依赖可以让最终 bundle 更小（方案一的"轻量"目标）。
 */

const FM_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/** 去掉值两侧引号 */
function unquote(value) {
  const v = value.trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1)
  }
  return v
}

/**
 * 解析 frontmatter 文本块
 * @param {string} text
 * @returns {Record<string, any>}
 */
export function parseYamlBlock(text) {
  const out = {}
  const lines = text.split(/\r?\n/)
  let pendingKey = null

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue

    // 列表项： - value
    const listMatch = line.match(/^\s*-\s+(.*)$/)
    if (listMatch && pendingKey) {
      if (!Array.isArray(out[pendingKey])) out[pendingKey] = []
      out[pendingKey].push(unquote(listMatch[1]))
      continue
    }

    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (!kv) continue

    const key = kv[1]
    const rawValue = kv[2]
    pendingKey = key

    if (rawValue === '') {
      out[key] = '' // 可能跟着列表，后续行会覆盖成数组
      continue
    }

    // 行内数组 [a, b, c]
    if (/^\[.*\]$/.test(rawValue.trim())) {
      const inner = rawValue.trim().slice(1, -1)
      out[key] = inner
        .split(',')
        .map((s) => unquote(s))
        .filter(Boolean)
      continue
    }

    out[key] = unquote(rawValue)
  }

  // '' -> [] 的修正在列表解析时已处理，这里清理空字符串残留
  for (const [k, v] of Object.entries(out)) {
    if (v === '') out[k] = ''
  }
  return out
}

/**
 * 拆分 Markdown 为 { meta, body }
 * @param {string} raw
 */
export function parseFrontmatter(raw) {
  const text = String(raw ?? '')
  const match = text.match(FM_RE)
  if (!match) return { meta: {}, body: text }
  return { meta: parseYamlBlock(match[1]), body: text.slice(match[0].length) }
}

function needsQuote(str) {
  return /[:#\-{}[\]&*!|>'"%@`]/.test(str) || str.trim() !== str
}

function yamlValue(value) {
  if (Array.isArray(value)) return `[${value.join(', ')}]`
  const str = String(value ?? '')
  return needsQuote(str) ? `"${str.replace(/"/g, '\\"')}"` : str
}

/**
 * 序列化为 frontmatter + body
 * @param {Record<string, any>} meta
 * @param {string} body
 */
export function stringifyFrontmatter(meta, body) {
  const order = ['id', 'title', 'category', 'tags', 'created', 'updated', 'source']
  const keys = [
    ...order.filter((k) => meta[k] !== undefined && meta[k] !== '' && !(Array.isArray(meta[k]) && !meta[k].length)),
    ...Object.keys(meta).filter(
      (k) => !order.includes(k) && meta[k] !== undefined && meta[k] !== '' && !(Array.isArray(meta[k]) && !meta[k].length),
    ),
  ]

  const lines = keys.map((k) => `${k}: ${yamlValue(meta[k])}`)
  return `---\n${lines.join('\n')}\n---\n\n${String(body ?? '').replace(/^\n+/, '')}`
}

/**
 * 提取正文首个一级标题作为兜底标题
 */
export function extractTitleFromBody(body) {
  const m = String(body || '').match(/^\s*#\s+(.+)$/m)
  return m ? m[1].trim() : ''
}
