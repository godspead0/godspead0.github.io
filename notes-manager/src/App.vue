<script setup>
/**
 * 应用根组件
 * ---------------------------------------------------------------
 * 布局：
 *   ┌──────────── 顶栏（搜索 / 全局动作）────────────┐
 *   ├── 侧边栏筛选树 ──┬── 笔记列表 ──┬── 仪表盘/热力图 ──┤
 * 状态全部来自 composables 单例，组件之间不互相传参。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import AppHeader from './components/AppHeader.vue'
import FilterSidebar from './components/FilterSidebar.vue'
import NoteListPanel from './components/NoteListPanel.vue'
import DashboardPanel from './components/DashboardPanel.vue'
import ConfigModal from './components/ConfigModal.vue'
import NoteEditorModal from './components/NoteEditorModal.vue'
import NoteDetailModal from './components/NoteDetailModal.vue'
import ImportOverlay from './components/ImportOverlay.vue'
import ToastHost from './components/ToastHost.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import { useWorkspace } from './composables/useWorkspace.js'

const ws = useWorkspace()
const importer = ref(null)

/** 分类 / 标签候选，供编辑器自动补全 */
function categoryNames() {
  const fromMeta = ws.categories.categoryNames.value
  const fromNotes = new Set(ws.notes.value.map((n) => n.category).filter(Boolean))
  return [...new Set([...fromMeta, ...fromNotes])]
}

function tagNames() {
  const fromMeta = ws.categories.tagNames.value
  const fromNotes = new Set(ws.notes.value.flatMap((n) => n.tags || []))
  return [...new Set([...fromMeta, ...fromNotes])].slice(0, 200)
}

/** Esc 关闭移动端抽屉 */
function onKeydown(e) {
  if (e.key === 'Escape' && ws.sidebarOpen.value) ws.sidebarOpen.value = false
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  if (ws.config.configured.value) {
    await ws.refresh({ silent: false })
  }
})

onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="flex flex-col lg:h-screen lg:overflow-hidden">
    <AppHeader @pick-files="importer?.pickFiles()" />

    <main class="flex min-h-0 flex-1 flex-col xl:flex-row">
      <!-- 侧边栏筛选树 -->
      <FilterSidebar />

      <!-- 列表 -->
      <NoteListPanel class="min-h-0 flex-1" />

      <!-- 仪表盘 -->
      <aside
        class="border-t border-[var(--app-border)] bg-[var(--app-bg)] xl:w-[26rem] xl:flex-shrink-0 xl:border-l xl:border-t-0"
      >
        <DashboardPanel />
      </aside>
    </main>

    <!-- 全局浮层 -->
    <ConfigModal />
    <NoteEditorModal
      :open="ws.editor.value.open"
      :mode="ws.editor.value.mode"
      :note="ws.editor.value.note"
      :categories="categoryNames()"
      :known-tags="tagNames()"
      :saving="ws.saving.value"
      @close="ws.closeEditor()"
      @submit="ws.submitDraft"
      @delete="ws.removeNote"
    />
    <NoteDetailModal :note="ws.detailNote.value" @close="ws.detailNote.value = null" />
    <ImportOverlay ref="importer" />
    <ToastHost />
    <ConfirmDialog />
  </div>
</template>
