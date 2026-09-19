/**
 * 笔记仓库 Composable（核心状态）—— 只读
 * ---------------------------------------------------------------
 * 负责从 GitHub 公开仓库把笔记**读**进来（本站不写）：
 *   loadAll  递归拉取数据仓库全部 Markdown 并解析 frontmatter
 * 内建 sha 级缓存：内容未变的文件不会重复下载，显著降低限频风险。
 *
 * 新建 / 更新 / 删除 / 导入等写能力已移除 —— 那些在本地由
 * 「提交笔记.bat」完成，网页端不发起任何写请求。
 */
import { computed, ref } from 'vue'
import { GithubError, getFile, listFiles } from '../services/github.js'
import { countWords, parseNoteFile } from '../services/notes.js'
import { toast } from './useToast.js'
import { useConfig } from './useConfig.js'

const notes = ref([])
const loading = ref(false)
const lastSyncAt = ref('')
const loadError = ref('')
const progress = ref({ done: 0, total: 0, label: '' })

/** path -> { sha, note } 的本地缓存，避免重复下载 */
const fileCache = new Map()

/* ------------------------------------------------------------------ */
/* 跨刷新缓存（localStorage）                                          */
/* ------------------------------------------------------------------ */
/**
 * 笔记正文合计不到 1MB，完全可以放进 localStorage。
 * 作用：打开网站时先用上次的笔记渲染首屏（几乎瞬间），
 *       再在后台按 sha 校验差异 —— 内容没变的笔记连正文都不用重新下载。
 */
const CACHE_KEY = 'notes-manager.notes.v1'
const CACHE_VERSION = 1
/** 上次从本地缓存渲染的时间 */
const cachedAt = ref('')

/**
 * 当前「已配置仓库」的指纹。
 * ---------------------------------------------------------------
 * 缓存里会记下写入时的指纹。若之后改了 Owner / Repo / 分支 / 笔记目录，
 * 说明这份缓存属于**另一批仓库**，必须丢弃 —— 否则会把上一个仓库的笔记
 * 当成当前的显示出来（张冠李戴，换机器使用时也是隐私问题）。
 */
function vaultSignature() {
  const { vaults } = useConfig()
  return vaults.value
    .filter((v) => v.owner && v.repo)
    .map((v) => `${v.id}:${v.owner}/${v.repo}@${v.branch}/${v.notesDir || ''}`)
    .join('|')
}

/**
 * 从 localStorage 恢复笔记并预热 sha 缓存
 * @returns {number} 恢复的笔记条数（0 表示没有可用缓存）
 */
function hydrateFromCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return 0
    const data = JSON.parse(raw)
    if (!data || data.v !== CACHE_VERSION || !Array.isArray(data.notes)) return 0
    // 仓库指纹不一致 → 丢弃缓存（旧版本缓存没有 sig 字段，按兼容处理）
    if (data.sig !== undefined && data.sig !== vaultSignature()) {
      localStorage.removeItem(CACHE_KEY)
      return 0
    }
    const list = data.notes.filter((n) => n && typeof n.path === 'string')
    if (!list.length) return 0

    notes.value = list
    cachedAt.value = data.savedAt || ''
    lastSyncAt.value = data.savedAt || ''
    hydratedFromCache.value = true

    // 关键：用缓存的 sha 预热 fileCache，
    // 这样远端 sha 未变的笔记会被直接复用，不产生正文请求。
    if (!data.lite) {
      for (const n of list) {
        if (n.path && n.sha) fileCache.set(n.path, { sha: n.sha, note: n })
      }
    }
    return list.length
  } catch {
    return 0 // 缓存损坏时静默忽略，走正常网络加载
  }
}

/** 把当前笔记写入 localStorage；空间不足时退化为不含正文的精简版 */
function persistCache() {
  const build = (list, lite) =>
    JSON.stringify({
      v: CACHE_VERSION,
      savedAt: new Date().toISOString(),
      lite,
      sig: vaultSignature(),
      notes: list,
    })
  try {
    localStorage.setItem(CACHE_KEY, build(notes.value, false))
  } catch {
    try {
      localStorage.setItem(CACHE_KEY, build(notes.value.map((n) => ({ ...n, body: '' })), true))
    } catch {
      /* 实在放不下就放弃缓存，不影响主流程 */
    }
  }
}

/** 首屏内容是否来自本地缓存（同步完成后置回 false） */
const hydratedFromCache = ref(false)

const noteCount = computed(() => notes.value.length)
const totalWords = computed(() => notes.value.reduce((sum, n) => sum + countWords(n.body), 0))

/** 限制并发，避免瞬时打满 GitHub 限频 */
async function mapLimit(items, limit, worker) {
  const results = []
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

/**
 * 全量拉取笔记（多仓库）
 * 逐个读取已配置的 vault（技术 / 算法），合并后统一展示。
 * @param {{silent?: boolean}} [opts]
 */
async function loadAll(opts = {}) {
  if (loading.value) return
  loading.value = true
  loadError.value = ''
  progress.value = { done: 0, total: 0, label: '正在读取仓库配置…' }

  try {
    const { vaults } = useConfig()
    /* 有 Owner/Repo 就参与读取 —— Token 可选：
       有 Token 走 Contents API（限额 5000/小时，可写）；
       没有 Token 走 raw CDN 匿名读（公开仓库，访客路径）。 */
    const enabled = vaults.value.filter((v) => v.owner && v.repo)
    if (!enabled.length) {
      throw new GithubError('尚未配置数据仓库，请检查 src/composables/useConfig.js 中的 PUBLIC_* 常量。')
    }

    const merged = []
    const seen = new Map() // key: `${notesDir}|${仓库内相对路径}` → 已收录的笔记
    for (const vault of enabled) {
      // 只扫描该仓库的笔记目录（算法仓库在根目录，notesDir 为空串）
      const files = await listFiles(vault.notesDir || '', 0, vault)
      progress.value = { done: 0, total: files.length, label: `「${vault.label}」正在读取 ${files.length} 篇笔记…` }

      const parsed = await mapLimit(files, 5, async (file) => {
        try {
          const cached = fileCache.get(file.path)
          if (cached && cached.sha === file.sha && cached.note.vault === vault.id) {
            progress.value = { ...progress.value, done: progress.value.done + 1 }
            return cached.note
          }
          const remote = await getFile(file.path, vault)
          if (!remote) return null
          // 匿名读没有 sha，用文件树里的 sha 兜底，保证缓存能命中
          const sha = remote.sha || file.sha
          // 必须把笔记目录传给解析器：分类要从「剥掉笔记目录之后」的路径推断
          const note = parseNoteFile({ ...file, sha }, remote.content, { root: vault.notesDir || '' })
          note.vault = vault.id
          note.vaultLabel = vault.label
          note.vaultNotesDir = vault.notesDir || ''
          fileCache.set(file.path, { sha, note })
          progress.value = { ...progress.value, done: progress.value.done + 1 }
          return note
        } catch (err) {
          // 单篇失败不阻断整体加载
          toast.warn(`读取失败：${file.path}（${err?.message || err}）`)
          progress.value = { ...progress.value, done: progress.value.done + 1 }
          return null
        }
      })

      /* 跨仓库去重：同一篇笔记可能同时存在于「公开展示仓库」和你的私有工作区，
         按「笔记目录 + 仓库内路径」归并，先到者胜（vaults 顺序即优先级）。 */
      const kept = []
      for (const note of parsed.filter(Boolean)) {
        const key = `${note.vaultNotesDir}|${note.path}`
        if (seen.has(key)) continue
        seen.set(key, note)
        kept.push(note)
      }
      merged.push(...kept)
    }

    notes.value = merged
    hydratedFromCache.value = false
    lastSyncAt.value = new Date().toISOString()
    persistCache()
    if (!opts.silent) toast.success(`已同步 ${notes.value.length} 篇笔记`)
  } catch (err) {
    const message = err instanceof GithubError ? err.message : err?.message || '拉取笔记失败'
    loadError.value = message
    toast.error(message)
  } finally {
    loading.value = false
    progress.value = { done: 0, total: 0, label: '' }
  }
}

/** 清空本地缓存（内存 + localStorage），强制下次全量下载 */
function invalidateCache() {
  fileCache.clear()
  cachedAt.value = ''
  hydratedFromCache.value = false
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    /* 存储不可用时无需清理 */
  }
}

/**
 * 彻底抹除本机笔记缓存（内存 + localStorage）
 * ---------------------------------------------------------------
 * 站点不持有凭据，缓存里只是**公开笔记的副本**，本身不敏感；
 * 想在这台电脑上不留痕时调用它（等同浏览器「清除站点数据」）。
 */
function purge() {
  invalidateCache()
  notes.value = []
  lastSyncAt.value = ''
  loadError.value = ''
}

/** 按 id 取笔记 */
function getById(id) {
  return notes.value.find((n) => n.id === id) || null
}

export function useNotes() {
  return {
    notes,
    loading,
    progress,
    lastSyncAt,
    loadError,
    cachedAt,
    hydratedFromCache,
    noteCount,
    totalWords,
    loadAll,
    hydrateFromCache,
    invalidateCache,
    purge,
    getById,
  }
}
