/**
 * 分类与标签元数据 Composable —— 只读
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
 *
 * ⚠️ 本站只读：不再写回 categories.json。原先 refresh() 后会自动调用
 *    syncFromNotes() 把新分类补登记进元数据 —— 那是**每次打开页面都会触发的隐式写**，
 *    只读站点必须去掉，否则每个访客都会看到一条写入失败报错。
 *    缺的颜色由 colorFor() 按名字哈希稳定推导，效果一样。
 */
import { computed, ref } from 'vue'
import { GithubError, getFile } from '../services/github.js'
import { toast } from './useToast.js'
import { useConfig } from './useConfig.js'

const CATEGORIES_PATH = 'categories.json'

/** 分类默认配色（按索引循环取用） */
const PALETTE = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#84cc16']

const meta = ref({ categories: [], tags: [], updated: '' })
const sha = ref('')
const loading = ref(false)

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

/**
 * 拉取元数据；文件不存在时静默留空（UI 会自动推导）
 * @param {{silent?: boolean, fresh?: boolean}} [opts] fresh = 用户主动同步，绕过 raw CDN 缓存
 */
async function load(opts = {}) {
  loading.value = true
  try {
    const vault = useConfig().primaryVault.value
    const remote = await getFile(CATEGORIES_PATH, vault, opts.fresh ? { bust: Date.now() } : {})
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


export function useCategories() {
  return {
    CATEGORIES_PATH,
    meta,
    loading,
    categoryNames,
    tagNames,
    colorFor,
    load,
  }
}
