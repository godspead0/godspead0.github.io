<script setup>
/**
 * 笔记列表面板
 * 排序 / 视图切换（卡片 · 时间线归档）/ 多选批量操作 / 空态与骨架屏
 */
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import NoteCard from './NoteCard.vue'
import { useWorkspace } from '../composables/useWorkspace.js'
import { useSearch } from '../composables/useSearch.js'
import { formatArchiveLabel } from '../services/notes.js'

const ws = useWorkspace()
const { notes, notesLoading, loadError, syncing } = ws
const { results, sortBy, sortOrder, toggleSort, hasActiveFilter, clearFilters, keyword } = useSearch(notes)

const view = ref('cards') // cards | archive
const selectedIds = ref([])

/* ------------------------- 多选 ------------------------- */

function toggleSelect(id) {
  const idx = selectedIds.value.indexOf(id)
  if (idx >= 0) selectedIds.value.splice(idx, 1)
  else selectedIds.value.push(id)
}

function isSelected(id) {
  return selectedIds.value.includes(id)
}

const allSelected = computed(
  () => results.value.length > 0 && selectedIds.value.length === results.value.length,
)

function toggleSelectAll() {
  selectedIds.value = allSelected.value ? [] : results.value.map((n) => n.id)
}

const selectedNotes = computed(() => results.value.filter((n) => selectedIds.value.includes(n.id)))

function clearSelection() {
  selectedIds.value = []
}

/* ------------------------- 归档分组 ------------------------- */

const groups = computed(() => {
  const map = new Map()
  for (const note of results.value) {
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
      items: items.sort((a, b) => String(b.created || '').localeCompare(String(a.created || ''))),
    }))
})

const collapsedGroups = ref({})
function toggleGroup(key) {
  collapsedGroups.value = { ...collapsedGroups.value, [key]: !collapsedGroups.value[key] }
}
function isGroupOpen(key) {
  return !collapsedGroups.value[key]
}

/* ------------------------- 排序头 ------------------------- */

const SORTS = [
  { key: 'updated', label: '更新时间' },
  { key: 'created', label: '创建时间' },
  { key: 'title', label: '标题' },
]
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col">
    <!-- 工具栏 -->
    <div
      class="flex flex-wrap items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2"
    >
      <span class="text-xs muted">
        共 <b class="text-[var(--app-text)]">{{ results.length }}</b> 篇
        <span v-if="hasActiveFilter">/ {{ notes.length }}</span>
      </span>

      <div class="flex items-center gap-1">
        <span class="text-xs muted">排序</span>
        <button
          v-for="s in SORTS"
          :key="s.key"
          class="btn btn-sm"
          :class="sortBy === s.key && 'border-[var(--app-accent)] text-[var(--app-accent)]'"
          @click="toggleSort(s.key)"
        >
          {{ s.label }}
          <AppIcon v-if="sortBy === s.key" :name="sortOrder === 'asc' ? 'sort-asc' : 'sort-desc'" :size="11" />
        </button>
      </div>

      <div class="flex items-center gap-1">
        <button class="btn btn-sm" :class="view === 'cards' && 'active'" title="卡片视图" @click="view = 'cards'">
          <AppIcon name="grid" :size="13" />
        </button>
        <button class="btn btn-sm" :class="view === 'archive' && 'active'" title="时间线归档视图" @click="view = 'archive'">
          <AppIcon name="archive" :size="13" />
        </button>
      </div>

      <label class="flex cursor-pointer items-center gap-1 text-xs muted">
        <input
          type="checkbox"
          class="h-3.5 w-3.5 accent-[#0969da]"
          :checked="allSelected"
          @change="toggleSelectAll"
        />
        全选
      </label>

      <div class="ml-auto flex items-center gap-1">
        <button v-if="hasActiveFilter" class="btn btn-sm" @click="clearFilters">
          <AppIcon name="x" :size="12" /> 清除筛选
        </button>
        <button
          class="btn btn-sm"
          :disabled="syncing.value"
          title="重新拉取远端数据"
          @click="ws.refresh()"
        >
          <AppIcon :name="syncing.value ? 'loader' : 'refresh'" :size="12" /> 刷新
        </button>
      </div>
    </div>

    <!-- 批量操作条 -->
    <Transition name="slide">
      <div
        v-if="selectedIds.length"
        class="flex flex-wrap items-center gap-2 border-b border-[var(--app-border)] bg-[#ddf4ff]/70 px-3 py-2 text-xs dark:bg-[#0c2d6b]/40"
      >
        <span>已选中 <b>{{ selectedIds.length }}</b> 篇</span>
        <button class="btn btn-sm" @click="ws.exportZip(selectedNotes)">
          <AppIcon name="package" :size="12" /> 导出所选 zip
        </button>
        <button class="btn btn-sm" @click="selectedNotes.forEach((n) => ws.exportOne(n))">
          <AppIcon name="download" :size="12" /> 逐篇下载
        </button>
        <button class="btn btn-sm ml-auto" @click="clearSelection">取消选择</button>
      </div>
    </Transition>

    <!-- 主体 -->
    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <!-- 错误提示 -->
      <div
        v-if="loadError.value"
        class="mb-3 flex items-start gap-2 rounded-lg border border-[#cf222e]/40 bg-[#ffebe9]/70 p-3 text-xs leading-6 text-[#a40e26] dark:bg-[#4a1113]/50 dark:text-[#ffcecb]"
      >
        <AppIcon name="alert" :size="14" class="mt-1" />
        <div class="flex-1">
          <p class="font-semibold">数据同步失败</p>
          <p>{{ loadError.value }}</p>
        </div>
        <button class="btn btn-sm" @click="ws.refresh()">重试</button>
      </div>

      <!-- 骨架屏 -->
      <div v-if="notesLoading.value && !notes.length" class="grid gap-2">
        <div v-for="i in 5" :key="i" class="card animate-pulse p-3">
          <div class="mb-2 h-4 w-1/3 rounded bg-black/10 dark:bg-white/10" />
          <div class="mb-1 h-3 w-full rounded bg-black/5 dark:bg-white/5" />
          <div class="h-3 w-2/3 rounded bg-black/5 dark:bg-white/5" />
        </div>
        <p v-if="ws.progress.value.total" class="text-center text-xs muted">
          {{ ws.progress.value.label }}
        </p>
      </div>

      <!-- 没有笔记 -->
      <div v-else-if="!notes.length && !hasActiveFilter" class="empty">
        <AppIcon name="cloud" :size="28" class="muted" />
        <h3 class="text-sm font-semibold">还没有同步到任何笔记</h3>
        <p class="max-w-md text-xs leading-6 muted">
          本站从公开展示仓库读取笔记。如果确实还没有内容，把 <code class="font-mono">.md</code>
          放进笔记目录后跑一次「提交笔记.bat」，再回来点「立即同步」即可。
        </p>
        <div class="flex flex-wrap justify-center gap-2">
          <button class="btn btn-sm" @click="ws.config.openSource()">
            <AppIcon name="sliders" :size="13" /> 数据来源
          </button>
          <button class="btn btn-sm btn-primary" @click="ws.refresh()">
            <AppIcon name="refresh" :size="13" /> 立即同步
          </button>
        </div>
      </div>

      <!-- 无匹配 -->
      <div v-else-if="!results.length" class="empty">
        <AppIcon name="search" :size="26" class="muted" />
        <h3 class="text-sm font-semibold">没有匹配的笔记</h3>
        <p class="text-xs muted">
          当前关键词 <b>“{{ keyword }}”</b> 没有命中结果，试试更换关键词或清除筛选条件。
        </p>
        <button class="btn btn-sm" @click="clearFilters">清除筛选</button>
      </div>

      <!-- 卡片视图 -->
      <div v-else-if="view === 'cards'" class="grid gap-2 xl:grid-cols-2">
        <NoteCard
          v-for="note in results"
          :key="note.id"
          :note="note"
          :selected="isSelected(note.id)"
          @open="ws.detailNote.value = $event"
          @toggle-select="toggleSelect"
        />
      </div>

      <!-- 归档视图 -->
      <div v-else class="space-y-3">
        <div v-for="g in groups" :key="g.key" class="card overflow-hidden">
          <button
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5"
            @click="toggleGroup(g.key)"
          >
            <AppIcon :name="isGroupOpen(g.key) ? 'chevron-down' : 'chevron-right'" :size="14" />
            <AppIcon name="calendar" :size="14" class="muted" />
            <span class="font-semibold">{{ g.label }}</span>
            <span class="chip">({{ g.items.length }})</span>
          </button>
          <div v-show="isGroupOpen(g.key)" class="space-y-2 border-t border-[var(--app-border)] p-2">
            <NoteCard
              v-for="note in g.items"
              :key="note.id"
              :note="note"
              :selected="isSelected(note.id)"
              @open="ws.detailNote.value = $event"
              @toggle-select="toggleSelect"
            />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 3rem 1rem;
  text-align: center;
}
.btn.active {
  border-color: var(--app-accent);
  color: var(--app-accent);
  background: rgba(9, 105, 218, 0.08);
}
</style>
