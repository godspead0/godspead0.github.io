/**
 * 工作区编排层（应用级状态 + 副作用编排）—— 纯只读
 * ---------------------------------------------------------------
 * 把"UI 弹窗状态"与"跨模块业务动作"收敛到一处，避免组件之间互相传参：
 *   - 同步：笔记 + 打卡 + 分类元数据 三份数据**并行拉取**（全部只读）
 *   - 详情：查看笔记浮层
 *   - 导出：单篇下载 / 复制原文 / 全站打包 zip
 *
 * ⚠️ 本站不写入 GitHub：
 *   新建 / 编辑 / 删除 / 导入 / 打卡 / 补登记分类 等写动作一律没有入口，
 *   连"从笔记补登记分类元数据"这种隐式写也去掉了 —— 否则访客每次打开页面
 *   都会尝试写 categories.json，然后每个人都看到一条报错。
 *   内容更新靠本地写好笔记后运行「提交笔记.bat」推送到公开仓库。
 */
import { computed, ref } from 'vue'
import { useNotes } from './useNotes.js'
import { useCheckins } from './useCheckins.js'
import { useCategories } from './useCategories.js'
import { useConfig } from './useConfig.js'
import { toast } from './useToast.js'
import { downloadAllAsZip, downloadNote } from '../services/exporter.js'
import { serializeNote } from '../services/notes.js'

const notesApi = useNotes()
const checkins = useCheckins()
const categories = useCategories()

/* ------------------------------ UI 状态 ------------------------------ */

const detailNote = ref(null)
const exporting = ref(false)
const sidebarOpen = ref(false)

/* ------------------------------ 同步 ------------------------------ */

const syncing = computed(() => notesApi.loading.value || checkins.loading.value)

/**
 * 三路并行拉取；单路失败不影响其它两路。
 * @param {{silent?: boolean, fresh?: boolean}} [opts]
 *   fresh = true 表示用户主动同步，绕过文件树与 raw CDN 两层缓存（见 useNotes.loadAll）
 */
async function refresh(opts = {}) {
  if (!useConfig().configured.value) {
    toast.warn('尚未配置数据仓库，请检查 src/composables/useConfig.js 中的 PUBLIC_* 常量')
    return
  }
  await Promise.allSettled([
    notesApi.loadAll(opts),
    // 打卡与分类也跟随 fresh：用户主动同步时一并绕过 CDN 缓存
    checkins.load({ silent: true, fresh: opts.fresh }),
    categories.load({ silent: true, fresh: opts.fresh }),
  ])
}

/* ------------------------------ 导出 ------------------------------ */

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
    progress: notesApi.progress,
    lastSyncAt: notesApi.lastSyncAt,
    loadError: notesApi.loadError,
    noteCount: notesApi.noteCount,
    totalWords: notesApi.totalWords,
    checkins,
    categories,
    config: useConfig(),
    // UI
    detailNote,
    exporting,
    syncing,
    sidebarOpen,
    // 动作（全部只读）
    refresh,
    exportZip,
    exportOne,
    copyRaw,
  }
}
