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
 * 去掉行内 Markdown 标记，得到适合当标题的纯文本
 */
function cleanInline(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, '') // HTML 标签
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接只保留文字
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1') // 行内代码
    .replace(/[*_~]{1,3}/g, '') // 强调符号
    .replace(/\s+/g, ' ')
    .trim()
}

/** 明显不是标题的噪音（目录标记 / 代码围栏 / 分隔线等） */
function isNoise(text) {
  const t = String(text || '').trim()
  if (!t) return true
  if (/^\[toc\]$/i.test(t)) return true
  if (/^(```|~~~)/.test(t)) return true
  if (/^[-=*_#\s]{3,}$/.test(t)) return true
  return false
}

/**
 * 逐行产出「正文行」，跳过围栏代码块（``` / ~~~）内部的内容
 * 解决两个真实问题：
 *   1) 代码块里的 "# 注释" 不该被当成标题
 *   2) 代码行不该被当成"正文第一行"当标题
 * 注意：必须在这里判断，不能靠 cleanInline ——
 * 行内代码正则会吃掉 ``` 的前两个反引号，把 "```plaintext" 变成 "plaintext"。
 */
function contentLines(src) {
  const out = []
  let fenceChar = ''
  for (const line of String(src || '').split(/\r?\n/)) {
    const m = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (m) {
      const ch = m[1][0]
      if (!fenceChar) fenceChar = ch
      else if (fenceChar === ch) fenceChar = ''
      continue // 围栏行本身不算内容
    }
    if (fenceChar) continue // 围栏未闭合时，后面全部视作代码
    out.push(line)
  }
  return out
}

/**
 * 从正文提取标题：任意级别的 ATX 标题（# ~ ######）→ HTML 标题（<h1>…）
 * 注意：不再只认一级标题 —— 大量笔记用的是 ## / #### 或 HTML 标题
 */
export function extractTitleFromBody(body) {
  const src = String(body || '').replace(/^\uFEFF/, '')
  const lines = contentLines(src)

  // 1) ATX 标题：# ~ ######，取第一个有文字的（跳过光秃秃的 "#"）
  for (const line of lines) {
    const m = line.match(/^\s{0,3}#{1,6}\s+(.*\S)\s*$/)
    if (!m) continue
    const t = cleanInline(m[1].replace(/\s*#+\s*$/, ''))
    if (t && !isNoise(t)) return t
  }

  // 2) HTML 标题：<h1>redis集群</h1>
  const h = lines.join('\n').match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)
  if (h) {
    const t = cleanInline(h[1])
    if (t && !isNoise(t)) return t
  }

  return ''
}

/**
 * 取正文第一行有意义的文字（清洗 Markdown 标记，最长 60 字）
 * 这是最后的兜底：只在既没有标题、文件名也派不上用场时才用。
 * 拆成独立函数是为了让「文件名」的优先级高于「截取正文首行」——
 * 你自己起的文件名（如 volatile与DCL.md）比正文开头那句话更像标题。
 */
export function extractLeadLine(body) {
  const src = String(body || '').replace(/^\uFEFF/, '')
  for (const line of contentLines(src)) {
    if (isNoise(line)) continue
    const t = cleanInline(line)
    if (t && !isNoise(t)) return t.slice(0, 60)
  }
  return ''
}
