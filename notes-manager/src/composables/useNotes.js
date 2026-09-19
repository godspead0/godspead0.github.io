/**
 * 笔记仓库 Composable（核心状态）
 * ---------------------------------------------------------------
 * 负责与 GitHub 数据仓库的笔记双向同步：
 *   loadAll  递归拉取数据仓库全部 Markdown 并解析 frontmatter
 *   save     新建 / 更新（SHA 乐观锁，409 冲突自动提示）
 *   remove   删除
 *   upload   批量导入本地 .md
 * 内建 sha 级缓存：内容未变的文件不会重复下载，显著降低限频风险。
 */
import { computed, ref } from 'vue'
import {
  GithubError,
  deleteFile,
  getFile,
  listFiles,
  saveFile,
} from '../services/github.js'
import {
  buildPath,
  countWords,
  createNote,
  genId,
  isManagedPath,
  parseNoteFile,
  serializeNote,
} from '../services/notes.js'
import { parseLocalMarkdownFiles } from '../services/exporter.js'
import { toast } from './useToast.js'
import { useConfig } from './useConfig.js'

const notes = ref([])
const loading = ref(false)
const saving = ref(false)
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
      throw new GithubError('尚未配置任何数据仓库，请先在「连接设置」中填写 Owner 与 Repo。')
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
          const note = parseNoteFile({ ...file, sha }, remote.content)
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

/**
 * 新建笔记并推送到 GitHub
 * @param {{title?:string, category?:string, tags?:string[]|string, body?:string}} draft
 * @returns {Promise<object|null>}
 */
async function create(draft) {
  saving.value = true
  try {
    const { activeVault } = useConfig()
    const vault = activeVault.value
    const id = genId()
    const title = (draft.title || '').trim() || '未命名笔记'
    const note = createNote({ ...draft, id, title })
    note.vault = vault.id
    note.vaultLabel = vault.label
    note.vaultNotesDir = vault.notesDir || ''
    note.path = buildPath(id, title, vault.notesDir)

    const { sha } = await saveFile(note.path, serializeNote(note), undefined, `create: ${note.title}`, vault)
    note.sha = sha
    notes.value = [note, ...notes.value]
    fileCache.set(note.path, { sha, note })
    persistCache()
    toast.success(`已创建：${note.title}`)
    return note
  } catch (err) {
    const message = err instanceof GithubError ? err.message : err?.message || '创建失败'
    toast.error(message)
    return null
  } finally {
    saving.value = false
  }
}

/**
 * 保存（更新）笔记
 * 标题变化时会重命名文件（先写新文件，再删除旧文件）。
 * @param {object} note
 * @returns {Promise<object|null>}
 */
async function update(note) {
  if (!note) return null
  saving.value = true
  try {
    const { vaults } = useConfig()
    const vault = vaults.value.find((v) => v.id === note.vault) || vaults.value[0]
    const updated = { ...note, updated: new Date().toISOString() }
    // 仅对 SPA 托管命名的文件跟随标题改名；
    // 历史笔记按原路径原位写回，保持用户自己整理的目录结构不被搬动。
    const nextPath = isManagedPath(updated.path) ? buildPath(updated.id, updated.title, vault.notesDir) : updated.path
    const renamed = nextPath !== updated.path
    const content = serializeNote(updated)

    // 已存在则携带原 sha，避免覆盖他人提交
    const { sha } = await saveFile(nextPath, content, renamed ? undefined : updated.sha, `update: ${updated.title}`, vault)

    if (renamed && updated.path) {
      try {
        await deleteFile(updated.path, updated.sha, `rename: ${note.title} -> ${updated.title}`, vault)
      } catch (err) {
        toast.warn(`旧文件清理失败（可忽略）：${err?.message || err}`)
      }
      fileCache.delete(updated.path)
    }

    updated.path = nextPath
    updated.sha = sha
    const idx = notes.value.findIndex((n) => n.id === updated.id)
    if (idx >= 0) notes.value.splice(idx, 1, updated)
    fileCache.set(nextPath, { sha, note: updated })
    persistCache()
    toast.success(`已保存：${updated.title}`)
    return updated
  } catch (err) {
    if (err instanceof GithubError && err.status === 409) {
      toast.error('保存冲突：远端文件已更新，请点击「重新同步」后再编辑。')
    } else {
      toast.error(err instanceof GithubError ? err.message : err?.message || '保存失败')
    }
    return null
  } finally {
    saving.value = false
  }
}

/** 删除笔记 */
async function remove(note) {
  if (!note?.path) return false
  saving.value = true
  try {
    const { vaults } = useConfig()
    const vault = vaults.value.find((v) => v.id === note.vault) || vaults.value[0]
    await deleteFile(note.path, note.sha, `delete: ${note.title}`, vault)
    notes.value = notes.value.filter((n) => n.id !== note.id)
    fileCache.delete(note.path)
    persistCache()
    toast.success(`已删除：${note.title}`)
    return true
  } catch (err) {
    toast.error(err instanceof GithubError ? err.message : err?.message || '删除失败')
    return false
  } finally {
    saving.value = false
  }
}

/**
 * 批量导入本地 Markdown 文件
 * @param {FileList|File[]} files
 * @param {{preserveSource?: boolean}} [opts]
 * @returns {Promise<{ok:number, failed:number}>}
 */
async function uploadLocal(files, opts = {}) {
  const { notes: parsed, errors } = await parseLocalMarkdownFiles(files)
  errors.forEach((e) => toast.warn(`${e.name}：${e.message}`))
  if (!parsed.length) {
    toast.warn('没有可导入的 Markdown 文件')
    return { ok: 0, failed: errors.length }
  }

  saving.value = true
  let ok = 0
  let failed = 0
  progress.value = { done: 0, total: parsed.length, label: '正在上传…' }

  try {
    const { activeVault } = useConfig()
    const vault = activeVault.value
    for (const draft of parsed) {
      try {
        const id = genId()
        const title = (draft.title || '').trim() || '未命名笔记'
        const note = createNote({
          ...draft,
          id,
          title,
          source: opts.preserveSource === false ? '' : draft.source,
        })
        note.vault = vault.id
        note.vaultLabel = vault.label
        note.vaultNotesDir = vault.notesDir || ''
        note.path = buildPath(id, title, vault.notesDir)
        // 逐篇串行上传：内容哈希由 GitHub 计算，串行可保证 commit 顺序清晰
        const { sha } = await saveFile(note.path, serializeNote(note), undefined, `import: ${note.title}`, vault)
        note.sha = sha
        notes.value = [note, ...notes.value]
        fileCache.set(note.path, { sha, note })
        ok += 1
      } catch (err) {
        failed += 1
        toast.error(`上传失败：${draft.title}（${err?.message || err}）`)
      } finally {
        progress.value = { ...progress.value, done: progress.value.done + 1 }
      }
    }
    if (ok) persistCache()
    if (ok) toast.success(`成功导入 ${ok} 篇笔记${failed ? `，${failed} 篇失败` : ''}`)
    return { ok, failed }
  } finally {
    saving.value = false
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
 * 彻底抹除本机笔记数据（内存 + localStorage）
 * ---------------------------------------------------------------
 * 用于「清除凭据」：只清 Token 是不够的 —— 笔记正文默认缓存在 localStorage，
 * 若不清掉，别人在这台电脑上打开网站仍能从缓存里读到全部笔记。
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
    saving,
    progress,
    lastSyncAt,
    loadError,
    cachedAt,
    hydratedFromCache,
    noteCount,
    totalWords,
    loadAll,
    hydrateFromCache,
    create,
    update,
    remove,
    uploadLocal,
    invalidateCache,
    purge,
    getById,
  }
}
