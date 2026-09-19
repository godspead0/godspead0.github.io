/**
 * 搜索 / 筛选 / 排序 Composable
 * ---------------------------------------------------------------
 * - Fuse.js 对 title / tags / body 做即时模糊全文检索（中英文均可）
 * - 分类、标签、时间线（年-月）三级筛选，支持多选与交集
 * - 多字段排序：更新时间 / 创建时间 / 标题，升序或降序
 * - 侧边栏筛选树（含计数）由笔记集合实时推导
 */
import { computed, ref, shallowRef, watch } from 'vue'
import Fuse from 'fuse.js'
import { formatArchiveLabel, toDateKey } from '../services/notes.js'

/* ---------------- 筛选状态 ---------------- */
const keyword = ref('')
const activeCategory = ref('') // 空串 = 全部
const activeTags = ref([]) // 多选标签，AND 语义
const activeMonth = ref('') // 'YYYY-MM'，空串 = 全部
const sortBy = ref('updated') // updated | created | title
const sortOrder = ref('desc') // asc | desc
const onlyUntagged = ref(false)
const activeVault = ref('') // 仓库（技术 / 算法），空串 = 全部

/* ---------------- Fuse 实例（懒建 + 缓存） ---------------- */
const fuse = shallowRef(null)
let fuseSource = null

function buildIndex(notes) {
  if (fuseSource === notes && fuse.value) return fuse.value
  fuse.value = new Fuse(notes, {
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.38,
    minMatchCharLength: 1,
    useExtendedSearch: false,
    keys: [
      { name: 'title', weight: 0.5 },
      { name: 'tags', weight: 0.25 },
      { name: 'category', weight: 0.1 },
      { name: 'body', weight: 0.35 },
    ],
  })
  fuseSource = notes
  return fuse.value
}

/**
 * @param {import('vue').Ref<Array>} notesRef useNotes() 返回的 notes ref
 */
export function useSearch(notesRef) {
  /** 关键词命中后的集合（未命中时保持原顺序，避免无谓重排） */
  const searched = computed(() => {
    const list = notesRef.value || []
    const q = keyword.value.trim()
    if (!q) return list
    const index = buildIndex(list)
    return index.search(q).map((r) => r.item)
  })

  /** 分类 / 标签 / 月份筛选（交集） */
  const filtered = computed(() => {
    const tags = activeTags.value
    return searched.value.filter((note) => {
      // 仓库维度（技术 / 算法）—— 最外层的"一级分类"
      if (activeVault.value && note.vault !== activeVault.value) return false
      if (activeCategory.value && note.category !== activeCategory.value) return false
      if (activeMonth.value) {
        const d = new Date(note.created || note.updated || Date.now())
        if (Number.isNaN(d.getTime())) return false
        const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        if (month !== activeMonth.value) return false
      }
      // 未分类筛选：只展示「没有分类」的笔记（之前错误地检查了 tags）
      if (onlyUntagged.value && note.category) return false
      if (tags.length) {
        const own = new Set((note.tags || []).map((t) => t.toLowerCase()))
        // AND：必须同时包含所有选中标签
        if (!tags.every((t) => own.has(t.toLowerCase()))) return false
      }
      return true
    })
  })

  /** 排序后结果 */
  const results = computed(() => {
    const list = [...filtered.value]
    const dir = sortOrder.value === 'asc' ? 1 : -1
    const cmp = {
      updated: (a, b) => String(a.updated || '').localeCompare(String(b.updated || '')),
      created: (a, b) => String(a.created || '').localeCompare(String(b.created || '')),
      title: (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans-CN'),
    }[sortBy.value] || ((a, b) => 0)
    list.sort((a, b) => cmp(a, b) * dir)
    return list
  })

  /* ---------------- 侧边栏筛选树 ---------------- */

  /**
   * 仓库树（一级分类）：{ id, label, count }[]
   * 从笔记的 vault / vaultLabel 字段推导，因此无需依赖配置模块。
   */
  const vaultTree = computed(() => {
    const map = new Map()
    for (const note of notesRef.value || []) {
      const key = note.vault
      if (!key) continue
      const found = map.get(key)
      if (found) found.count += 1
      else map.set(key, { id: key, label: note.vaultLabel || key, count: 1 })
    }
    return [...map.values()]
  })

  /**
   * 只看「当前选中仓库」的集合，供侧栏各棵树统计。
   * 这样选中「算法」后，分类树里不会混入技术仓库的分类；
   * 同时树的统计不随分类/标签自身收缩，便于反复切换。
   */
  const vaultScope = computed(() => {
    const list = notesRef.value || []
    if (!activeVault.value) return list
    return list.filter((n) => n.vault === activeVault.value)
  })

  /** 分类树：{ name, count }[]，按计数降序 */
  const categoryTree = computed(() => {
    const map = new Map()
    let uncategorized = 0
    for (const note of vaultScope.value) {
      const key = note.category || ''
      if (!key) {
        uncategorized += 1
        continue
      }
      map.set(key, (map.get(key) || 0) + 1)
    }
    const list = [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'))
    if (uncategorized) list.push({ name: '未分类', count: uncategorized, virtual: true })
    return list
  })

  /** 标签云：{ name, count }[]，按计数降序 */
  const tagTree = computed(() => {
    const map = new Map()
    for (const note of vaultScope.value) {
      for (const tag of note.tags || []) {
        map.set(tag, (map.get(tag) || 0) + 1)
      }
    }
    return [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'))
  })

  /**
   * 时间线归档树：按"年份-月份"分组，形如
   *   [{ key: '2026-09', label: '2026年9月', count: 4, notes: [...] }]
   * 默认折叠状态由 group.collapsed 控制（UI 层维护）。
   */
  const archiveTree = computed(() => {
    const map = new Map()
    for (const note of vaultScope.value) {
      const d = new Date(note.created || note.updated || Date.now())
      if (Number.isNaN(d.getTime())) continue
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(note)
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, items]) => ({
        key,
        label: formatArchiveLabel(key),
        count: items.length,
        notes: items.sort((a, b) => String(b.created).localeCompare(String(a.created))),
      }))
  })

  /** 今日新建的笔记数量，用于仪表盘 */
  const todayCreated = computed(() => {
    const key = toDateKey()
    return (notesRef.value || []).filter((n) => toDateKey(new Date(n.created || Date.now())) === key).length
  })

  const hasActiveFilter = computed(
    () =>
      Boolean(keyword.value.trim()) ||
      Boolean(activeVault.value) ||
      Boolean(activeCategory.value) ||
      Boolean(activeMonth.value) ||
      activeTags.value.length > 0 ||
      onlyUntagged.value,
  )

  function toggleTag(name) {
    const idx = activeTags.value.findIndex((t) => t.toLowerCase() === String(name).toLowerCase())
    if (idx >= 0) activeTags.value.splice(idx, 1)
    else activeTags.value.push(name)
  }

  function isTagActive(name) {
    return activeTags.value.some((t) => t.toLowerCase() === String(name).toLowerCase())
  }

  function selectCategory(name) {
    const target = name === '未分类' ? '' : name
    activeCategory.value = activeCategory.value === target ? '' : target
    onlyUntagged.value = name === '未分类' ? !onlyUntagged.value : false
  }

  /** 选择仓库（一级分类）；再次点击取消 */
  function selectVault(id) {
    activeVault.value = activeVault.value === id ? '' : id
  }

  function clearFilters() {
    keyword.value = ''
    activeVault.value = ''
    activeCategory.value = ''
    activeTags.value = []
    activeMonth.value = ''
    onlyUntagged.value = false
  }

  function toggleSort(field) {
    if (sortBy.value === field) {
      sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
    } else {
      sortBy.value = field
      sortOrder.value = field === 'title' ? 'asc' : 'desc'
    }
  }

  // 笔记集合变化时让 Fuse 索引失效，避免检索到已删除内容
  watch(
    notesRef,
    (next) => {
      if (fuseSource !== next) fuse.value = null
    },
    { flush: 'post' },
  )

  return {
    // 状态
    keyword,
    activeCategory,
    activeTags,
    activeMonth,
    sortBy,
    sortOrder,
    onlyUntagged,
    activeVault,
    // 派生
    results,
    filteredCount: computed(() => results.value.length),
    vaultTree,
    categoryTree,
    tagTree,
    archiveTree,
    todayCreated,
    hasActiveFilter,
    // 操作
    toggleTag,
    isTagActive,
    selectCategory,
    selectVault,
    clearFilters,
    toggleSort,
  }
}
