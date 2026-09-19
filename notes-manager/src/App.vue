<script setup>
/**
 * 应用根组件
 * ---------------------------------------------------------------
 * 本站是**纯只读**的笔记查看器：
 *   · 数据固定来自一个公开仓库，访客无需任何配置
 *   · 界面上不存在新建 / 编辑 / 删除 / 导入 / 打卡入口
 *   · 笔记的新增与修改在本地完成后，由「提交笔记.bat」推送到公开仓库
 *
 * 布局：
 *   ┌──────────── 顶栏（搜索 / 同步 / 导出）────────────┐
 *   ├── 侧边栏筛选树 ──┬── 笔记列表 ──┬── 仪表盘/热力图 ──┤
 * 状态全部来自 composables 单例，组件之间不互相传参。
 */
import { onMounted, onUnmounted } from 'vue'
import AppHeader from './components/AppHeader.vue'
import FilterSidebar from './components/FilterSidebar.vue'
import NoteListPanel from './components/NoteListPanel.vue'
import DashboardPanel from './components/DashboardPanel.vue'
import SourceModal from './components/SourceModal.vue'
import NoteDetailModal from './components/NoteDetailModal.vue'
import ToastHost from './components/ToastHost.vue'
import { useWorkspace } from './composables/useWorkspace.js'

const ws = useWorkspace()

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
    <AppHeader />

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
    <SourceModal />
    <NoteDetailModal :note="ws.detailNote.value" @close="ws.detailNote.value = null" />
    <ToastHost />
  </div>
</template>
