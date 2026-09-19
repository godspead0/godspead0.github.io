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
  NOTES_DIR,
  parseNoteFile,
  serializeNote,
} from '../services/notes.js'
import { parseLocalMarkdownFiles } from '../services/exporter.js'
import { toast } from './useToast.js'

const notes = ref([])
const loading = ref(false)
const saving = ref(false)
const lastSyncAt = ref('')
const loadError = ref('')
const progress = ref({ done: 0, total: 0, label: '' })

/** path -> { sha, note } 的本地缓存，避免重复下载 */
const fileCache = new Map()

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
 * 全量拉取笔记
 * @param {{silent?: boolean}} [opts]
 */
async function loadAll(opts = {}) {
  if (loading.value) return
  loading.value = true
  loadError.value = ''
  progress.value = { done: 0, total: 0, label: `正在列出 ${NOTES_DIR}/ 目录…` }

  try {
    // 只扫描笔记目录（数据仓库里还有代码等其它内容，避免无谓的请求）
    const files = await listFiles(NOTES_DIR)
    progress.value = { done: 0, total: files.length, label: `正在读取 ${files.length} 篇笔记…` }

    const parsed = await mapLimit(files, 5, async (file) => {
      try {
        const cached = fileCache.get(file.path)
        if (cached && cached.sha === file.sha) {
          progress.value = { ...progress.value, done: progress.value.done + 1 }
          return cached.note
        }
        const remote = await getFile(file.path)
        if (!remote) return null
        const note = parseNoteFile({ ...file, sha: remote.sha }, remote.content)
        fileCache.set(file.path, { sha: remote.sha, note })
        progress.value = { ...progress.value, done: progress.value.done + 1 }
        return note
      } catch (err) {
        // 单篇失败不阻断整体加载
        toast.warn(`读取失败：${file.path}（${err?.message || err}）`)
        progress.value = { ...progress.value, done: progress.value.done + 1 }
        return null
      }
    })

    notes.value = parsed.filter(Boolean)
    lastSyncAt.value = new Date().toISOString()
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
    const id = genId()
    const title = (draft.title || '').trim() || '未命名笔记'
    const note = createNote({ ...draft, id, title })
    note.path = buildPath(id, title)

    const { sha } = await saveFile(note.path, serializeNote(note), undefined, `create: ${note.title}`)
    note.sha = sha
    notes.value = [note, ...notes.value]
    fileCache.set(note.path, { sha, note })
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
    const updated = { ...note, updated: new Date().toISOString() }
    // 仅对 SPA 托管命名的文件跟随标题改名；
    // 历史笔记按原路径原位写回，保持用户自己整理的目录结构不被搬动。
    const nextPath = isManagedPath(updated.path) ? buildPath(updated.id, updated.title) : updated.path
    const renamed = nextPath !== updated.path
    const content = serializeNote(updated)

    // 已存在则携带原 sha，避免覆盖他人提交
    const { sha } = await saveFile(nextPath, content, renamed ? undefined : updated.sha, `update: ${updated.title}`)

    if (renamed && updated.path) {
      try {
        await deleteFile(updated.path, updated.sha, `rename: ${note.title} -> ${updated.title}`)
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
    await deleteFile(note.path, note.sha, `delete: ${note.title}`)
    notes.value = notes.value.filter((n) => n.id !== note.id)
    fileCache.delete(note.path)
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
        note.path = buildPath(id, title)
        // 逐篇串行上传：内容哈希由 GitHub 计算，串行可保证 commit 顺序清晰
        const { sha } = await saveFile(note.path, serializeNote(note), undefined, `import: ${note.title}`)
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
    if (ok) toast.success(`成功导入 ${ok} 篇笔记${failed ? `，${failed} 篇失败` : ''}`)
    return { ok, failed }
  } finally {
    saving.value = false
    progress.value = { done: 0, total: 0, label: '' }
  }
}

/** 清空本地缓存，强制下次全量下载 */
function invalidateCache() {
  fileCache.clear()
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
    noteCount,
    totalWords,
    loadAll,
    create,
    update,
    remove,
    uploadLocal,
    invalidateCache,
    getById,
  }
}
