/**
 * 分类与标签元数据 Composable
 * ---------------------------------------------------------------
 * 数据文件： categories.json
 * 格式：
 *   {
 *     "categories": [{ "name": "前端部分", "color": "#3b82f6" }],
 *     "tags":       [{ "name": "vue",      "color": "#10b981" }],
 *     "updated":    "ISO 字符串"
 *   }
 *
 * 该文件只承载"展示元数据"（颜色、排序、别名）。
 * 笔记与分类的真实归属关系始终以笔记 frontmatter 为准，
 * 因此 categories.json 缺失/损坏不会导致筛选功能不可用 —— 会依据笔记自动推导。
 */
import { computed, ref } from 'vue'
import { GithubError, getFile, saveFile } from '../services/github.js'
import { toast } from './useToast.js'

const CATEGORIES_PATH = 'categories.json'

/** 分类默认配色（按索引循环取用） */
const PALETTE = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#84cc16']

const meta = ref({ categories: [], tags: [], updated: '' })
const sha = ref('')
const loading = ref(false)
const saving = ref(false)

const categoryNames = computed(() => meta.value.categories.map((c) => c.name))
const tagNames = computed(() => meta.value.tags.map((t) => t.name))

function colorFor(name, kind = 'category') {
  const pool = kind === 'tag' ? meta.value.tags : meta.value.categories
  const found = pool.find((x) => x.name === name)
  if (found?.color) return found.color
  // 基于名称做稳定散列，保证同一分类每次颜色一致
  let hash = 0
  for (let i = 0; i < String(name).length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 9973
  return PALETTE[hash % PALETTE.length]
}

function normalizeIncoming(raw) {
  const obj = raw && typeof raw === 'object' ? raw : {}
  const toList = (input) =>
    (Array.isArray(input) ? input : [])
      .map((item) =>
        typeof item === 'string'
          ? { name: item, color: '' }
          : { name: String(item?.name || '').trim(), color: item?.color || '' },
      )
      .filter((item) => item.name)
  return {
    categories: toList(obj.categories),
    tags: toList(obj.tags),
    updated: obj.updated || '',
  }
}

/** 拉取元数据；文件不存在时静默留空（UI 会自动推导） */
async function load(opts = {}) {
  loading.value = true
  try {
    const remote = await getFile(CATEGORIES_PATH)
    if (remote) {
      meta.value = normalizeIncoming(JSON.parse(remote.content || '{}'))
      sha.value = remote.sha
    } else {
      meta.value = { categories: [], tags: [], updated: '' }
      sha.value = ''
      if (!opts.silent) toast.info('尚未创建 categories.json，分类将依据笔记自动推导')
    }
  } catch (err) {
    // 解析失败不应阻断主流程
    toast.warn(err instanceof GithubError ? err.message : `分类元数据读取失败：${err?.message || err}`)
  } finally {
    loading.value = false
  }
}

async function persist(message = 'chore: update categories.json') {
  saving.value = true
  try {
    const payload = { ...meta.value, updated: new Date().toISOString() }
    const { sha: newSha } = await saveFile(
      CATEGORIES_PATH,
      JSON.stringify(payload, null, 2),
      sha.value || undefined,
      message,
    )
    sha.value = newSha
    meta.value = payload
    return true
  } catch (err) {
    toast.error(err instanceof GithubError ? err.message : err?.message || '分类元数据保存失败')
    return false
  } finally {
    saving.value = false
  }
}

/** 将笔记中出现过、但元数据里没有的分类/标签补登记 */
async function syncFromNotes(notes) {
  const catSeen = new Set(meta.value.categories.map((c) => c.name))
  const tagSeen = new Set(meta.value.tags.map((t) => t.name))
  let changed = false

  for (const note of notes || []) {
    if (note.category && !catSeen.has(note.category)) {
      catSeen.add(note.category)
      meta.value.categories.push({ name: note.category, color: '' })
      changed = true
    }
    for (const tag of note.tags || []) {
      if (!tagSeen.has(tag)) {
        tagSeen.add(tag)
        meta.value.tags.push({ name: tag, color: '' })
        changed = true
      }
    }
  }

  if (changed) return persist('chore: sync categories from notes')
  return false
}

function addCategory(name, color = '') {
  const n = String(name || '').trim()
  if (!n) return false
  if (meta.value.categories.some((c) => c.name === n)) {
    toast.info(`分类「${n}」已存在`)
    return false
  }
  meta.value.categories.push({ name: n, color })
  return true
}

function removeCategory(name) {
  meta.value.categories = meta.value.categories.filter((c) => c.name !== name)
}

function addTag(name, color = '') {
  const n = String(name || '').trim().replace(/^#/, '')
  if (!n) return false
  if (meta.value.tags.some((t) => t.name === n)) return false
  meta.value.tags.push({ name: n, color })
  return true
}

function removeTag(name) {
  meta.value.tags = meta.value.tags.filter((t) => t.name !== name)
}

function renameCategory(from, to) {
  const target = meta.value.categories.find((c) => c.name === from)
  if (target) target.name = String(to || '').trim() || from
}

export function useCategories() {
  return {
    CATEGORIES_PATH,
    meta,
    sha,
    loading,
    saving,
    categoryNames,
    tagNames,
    colorFor,
    load,
    persist,
    syncFromNotes,
    addCategory,
    removeCategory,
    addTag,
    removeTag,
    renameCategory,
  }
}
