/**
 * 工作区编排层（应用级状态 + 副作用编排）
 * ---------------------------------------------------------------
 * 把"UI 弹窗状态"与"跨模块业务动作"收敛到一处，避免组件之间互相传参：
 *   - 同步：笔记 + 打卡 + 分类元数据 三份数据并行拉取
 *   - 编辑：新建 / 编辑弹窗状态机，保存成功后自动静默打卡 +1
 *   - 导入 / 导出 / 删除
 * 各组件只需 `const ws = useWorkspace()` 即可读写全局状态。
 */
import { computed, ref } from 'vue'
import { useNotes } from './useNotes.js'
import { useCheckins } from './useCheckins.js'
import { useCategories } from './useCategories.js'
import { useConfig } from './useConfig.js'
import { toast } from './useToast.js'
import { confirmDialog } from './useConfirm.js'
import { downloadAllAsZip, downloadNote } from '../services/exporter.js'
import { serializeNote } from '../services/notes.js'

const notesApi = useNotes()
const checkins = useCheckins()
const categories = useCategories()

/* ------------------------------ UI 状态 ------------------------------ */

const editor = ref({ open: false, mode: 'create', note: null })
const detailNote = ref(null)
const exporting = ref(false)
const importing = ref(false)
const sidebarOpen = ref(false)

/* ------------------------------ 同步 ------------------------------ */

const syncing = computed(() => notesApi.loading.value || checkins.loading.value)

/**
 * 三路并行同步；单路失败不影响其它两路。
 * @param {{silent?: boolean}} [opts]
 */
async function refresh(opts = {}) {
  if (!useConfig().configured.value) {
    toast.warn('请先在「连接设置」中填写 GitHub 仓库与 Token')
    return
  }
  await Promise.allSettled([
    notesApi.loadAll(opts),
    checkins.load({ silent: true }),
    categories.load({ silent: true }),
  ])
  // 用笔记里出现过的分类/标签补齐元数据（失败静默，不打断使用）
  categories.syncFromNotes(notesApi.notes.value).catch(() => {})
}

/* ------------------------------ 编辑 ------------------------------ */

function openCreate() {
  editor.value = { open: true, mode: 'create', note: null }
}

function openEdit(note) {
  editor.value = { open: true, mode: 'edit', note }
  detailNote.value = null
}

function closeEditor() {
  editor.value = { ...editor.value, open: false }
}

/**
 * 提交编辑器内容
 * @param {{id?:string,title:string,category:string,tags:string[],body:string,created:string}} draft
 */
async function submitDraft(draft) {
  const existing = editor.value.mode === 'edit' ? editor.value.note : null
  let saved = null

  if (existing) {
    saved = await notesApi.update({
      ...existing,
      title: draft.title,
      category: draft.category,
      tags: draft.tags,
      body: draft.body,
    })
  } else {
    saved = await notesApi.create({
      title: draft.title,
      category: draft.category,
      tags: draft.tags,
      body: draft.body,
      created: draft.created,
    })
  }

  if (!saved) return null

  closeEditor()
  // 编辑/新建成功后自动触发当日打卡 +1（异步、静默，失败不打断主流程）
  checkins.autoCheckIn(existing ? '笔记已更新' : '笔记已创建')
  return saved
}

/* ------------------------------ 删除 ------------------------------ */

async function removeNote(note) {
  if (!note) return false
  const ok = await confirmDialog({
    title: '删除笔记',
    message: `确认删除「${note.title}」？\n文件：${note.path}`,
    detail: '该操作会同时删除 GitHub 仓库中的对应文件，且不可撤销。',
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return false
  const done = await notesApi.remove(note)
  if (done && detailNote.value?.id === note.id) detailNote.value = null
  return done
}

/** 批量删除 */
async function removeMany(list) {
  const items = (list || []).filter(Boolean)
  if (!items.length) {
    toast.info('请先勾选要删除的笔记')
    return
  }
  const ok = await confirmDialog({
    title: `删除选中的 ${items.length} 篇笔记？`,
    message: items.map((n) => `· ${n.title}`).join('\n'),
    detail: '将逐个删除 GitHub 仓库中的对应文件，不可撤销。',
    confirmText: '全部删除',
    danger: true,
  })
  if (!ok) return
  let done = 0
  for (const note of items) {
    if (await notesApi.remove(note)) done += 1
  }
  toast.info(`批量删除完成：成功 ${done} / ${items.length}`)
}

/* ------------------------------ 导入 / 导出 ------------------------------ */

async function importFiles(files) {
  if (!files || !files.length) return
  importing.value = true
  try {
    const result = await notesApi.uploadLocal(files)
    if (result.ok) checkins.autoCheckIn(`导入 ${result.ok} 篇笔记`)
    return result
  } finally {
    importing.value = false
  }
}

/**
 * 导出：全部笔记（可只导出当前筛选结果）
 * @param {Array} [list] 指定要导出的集合，缺省为全部
 */
async function exportZip(list) {
  const target = list && list.length ? list : notesApi.notes.value
  if (!target.length) {
    toast.warn('没有可导出的笔记')
    return
  }
  exporting.value = true
  toast.info(`正在打包 ${target.length} 篇笔记…`)
  try {
    await downloadAllAsZip(
      target,
      {
        'checkins.json': checkins.data.value,
        'categories.json': categories.meta.value,
      },
      () => {},
    )
    toast.success(`已导出 ${target.length} 篇笔记`)
  } catch (err) {
    toast.error(`导出失败：${err?.message || err}`)
  } finally {
    exporting.value = false
  }
}

function exportOne(note) {
  try {
    downloadNote(note)
    toast.success(`已下载：${note.title}.md`)
  } catch (err) {
    toast.error(`下载失败：${err?.message || err}`)
  }
}

/** 复制笔记原文（frontmatter + 正文）到剪贴板 */
async function copyRaw(note) {
  const text = serializeNote(note)
  try {
    await navigator.clipboard.writeText(text)
    toast.success('已复制 Markdown 原文到剪贴板')
  } catch {
    toast.warn('剪贴板不可用（需 HTTPS 环境），请改用「下载 .md」')
  }
}

export function useWorkspace() {
  return {
    // 数据
    notes: notesApi.notes,
    notesLoading: notesApi.loading,
    saving: notesApi.saving,
    progress: notesApi.progress,
    lastSyncAt: notesApi.lastSyncAt,
    loadError: notesApi.loadError,
    noteCount: notesApi.noteCount,
    totalWords: notesApi.totalWords,
    checkins,
    categories,
    config: useConfig(),
    // UI
    editor,
    detailNote,
    exporting,
    importing,
    syncing,
    sidebarOpen,
    // 动作
    refresh,
    openCreate,
    openEdit,
    closeEditor,
    submitDraft,
    removeNote,
    removeMany,
    importFiles,
    exportZip,
    exportOne,
    copyRaw,
  }
}
