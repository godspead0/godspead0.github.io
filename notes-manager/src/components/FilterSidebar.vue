<script setup>
/**
 * 侧边栏筛选树
 * 分类 / 标签 / 时间线归档（年-月自动折叠）
 */
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { useWorkspace } from '../composables/useWorkspace.js'
import { useSearch } from '../composables/useSearch.js'

const ws = useWorkspace()
const { notes } = ws
const {
  keyword,
  activeVault,
  activeCategory,
  activeTags,
  activeMonth,
  onlyUntagged,
  vaultTree,
  categoryTree,
  tagTree,
  archiveTree,
  hasActiveFilter,
  toggleTag,
  isTagActive,
  selectCategory,
  selectVault,
  clearFilters,
} = useSearch(notes)

/** 仓库配色（与卡片徽章保持一致） */
const VAULT_COLORS = { tech: '#0969da', algo: '#8250df' }
function vaultColor(id) {
  return VAULT_COLORS[id] || '#8b949e'
}

/** 点击仓库：既筛选列表，也把它设为「新建笔记」的目标仓库 */
function pickVault(v) {
  selectVault(v.id)
  const idx = ws.config.vaults.value.findIndex((x) => x.id === v.id)
  if (idx >= 0) ws.config.setActiveVault(idx)
}

const activeVaultLabel = computed(
  () => vaultTree.value.find((v) => v.id === activeVault.value)?.label || activeVault.value,
)

const collapsed = ref({ vaults: false, categories: false, tags: false, archive: false, tools: false })
const archiveOpen = ref({})

const totalCount = computed(() => notes.value.length)

function toggleSection(key) {
  collapsed.value = { ...collapsed.value, [key]: !collapsed.value[key] }
}

function toggleArchiveMonth(key) {
  archiveOpen.value = { ...archiveOpen.value, [key]: !archiveOpen.value[key] }
}

function isArchiveOpen(key, index) {
  // 默认展开最近 2 个月
  if (archiveOpen.value[key] === undefined) return index < 2
  return archiveOpen.value[key]
}

function pickMonth(key) {
  if (activeMonth.value === key) {
    activeMonth.value = ''
    return
  }
  activeMonth.value = key
  // 点击归档同时展开该月，方便连贯浏览
  archiveOpen.value = { ...archiveOpen.value, [key]: true }
}

function pickAll() {
  clearFilters()
}

const activeSummary = computed(() => {
  const parts = []
  if (keyword.value.trim()) parts.push(`关键词「${keyword.value.trim()}」`)
  if (activeVault.value) parts.push(`仓库「${activeVaultLabel.value}」`)
  if (activeCategory.value) parts.push(`分类「${activeCategory.value}」`)
  if (onlyUntagged.value) parts.push('未分类')
  if (activeTags.value.length) parts.push(`标签 ${activeTags.value.map((t) => `#${t}`).join(' ')}`)
  if (activeMonth.value) parts.push(`归档 ${activeMonth.value}`)
  return parts
})
</script>

<template>
  <aside
    class="filter-sidebar"
    :class="ws.sidebarOpen.value ? 'open' : ''"
  >
    <!-- 全部笔记 -->
    <div class="section">
      <button
        class="row"
        :class="{ active: !hasActiveFilter }"
        @click="pickAll"
      >
        <AppIcon name="list" :size="14" />
        <span class="flex-1 text-left">全部笔记</span>
        <span class="count">{{ totalCount }}</span>
      </button>
    </div>

    <div v-if="hasActiveFilter" class="section">
      <div class="rounded-md border border-[var(--app-border)] p-2 text-[11px] leading-5 muted">
        <p class="mb-1 font-semibold text-[var(--app-text)]">当前筛选</p>
        <p>{{ activeSummary.join(' · ') }}</p>
        <button class="mt-1 flex items-center gap-1 text-[var(--app-accent)] hover:underline" @click="clearFilters">
          <AppIcon name="x" :size="11" /> 清除筛选
        </button>
      </div>
    </div>

    <!-- 仓库（一级分类）：技术 / 算法 -->
    <div v-if="vaultTree.length > 1" class="section">
      <button class="section-head" @click="toggleSection('vaults')">
        <AppIcon :name="collapsed.vaults ? 'chevron-right' : 'chevron-down'" :size="13" />
        <AppIcon name="book" :size="13" />
        <span class="flex-1 text-left">仓库</span>
        <span class="count">{{ vaultTree.length }}</span>
      </button>
      <div v-show="!collapsed.vaults" class="pl-1">
        <button
          v-for="v in vaultTree"
          :key="v.id"
          class="row"
          :class="{ active: activeVault === v.id }"
          :title="`只看「${v.label}」的笔记；同时新建笔记会写入该仓库`"
          @click="pickVault(v)"
        >
          <span class="dot" :style="{ background: vaultColor(v.id) }" />
          <span class="flex-1 truncate text-left">{{ v.label }}</span>
          <span class="count">{{ v.count }}</span>
        </button>
      </div>
    </div>

    <!-- 分类 -->
    <div class="section">
      <button class="section-head" @click="toggleSection('categories')">
        <AppIcon :name="collapsed.categories ? 'chevron-right' : 'chevron-down'" :size="13" />
        <AppIcon name="folder" :size="13" />
        <span class="flex-1 text-left">分类</span>
        <span class="count">{{ categoryTree.length }}</span>
      </button>
      <div v-show="!collapsed.categories" class="pl-1">
        <button
          v-for="c in categoryTree"
          :key="c.name"
          class="row"
          :class="{ active: c.virtual ? onlyUntagged : activeCategory === c.name && !onlyUntagged }"
          @click="selectCategory(c.name)"
        >
          <span class="dot" :style="{ background: c.virtual ? '#8b949e' : ws.categories.colorFor(c.name, 'category') }" />
          <span class="flex-1 truncate text-left">{{ c.name }}</span>
          <span class="count">{{ c.count }}</span>
        </button>
        <p v-if="!categoryTree.length" class="px-2 py-1 text-[11px] muted">暂无分类（可在笔记中填写）</p>
      </div>
    </div>

    <!-- 标签 -->
    <div class="section">
      <button class="section-head" @click="toggleSection('tags')">
        <AppIcon :name="collapsed.tags ? 'chevron-right' : 'chevron-down'" :size="13" />
        <AppIcon name="tag" :size="13" />
        <span class="flex-1 text-left">标签</span>
        <span class="count">{{ tagTree.length }}</span>
      </button>
      <div v-show="!collapsed.tags" class="px-2 pb-1">
        <div v-if="tagTree.length" class="flex flex-wrap gap-1">
          <button
            v-for="t in tagTree"
            :key="t.name"
            class="tag-chip"
            :class="{ active: isTagActive(t.name) }"
            :style="isTagActive(t.name) ? { borderColor: ws.categories.colorFor(t.name, 'tag'), color: ws.categories.colorFor(t.name, 'tag') } : {}"
            @click="toggleTag(t.name)"
          >
            #{{ t.name }}<span class="opacity-60">{{ t.count }}</span>
          </button>
        </div>
        <p v-else class="py-1 text-[11px] muted">暂无标签</p>
      </div>
    </div>

    <!-- 时间线归档 -->
    <div class="section flex-1 overflow-y-auto">
      <button class="section-head" @click="toggleSection('archive')">
        <AppIcon :name="collapsed.archive ? 'chevron-right' : 'chevron-down'" :size="13" />
        <AppIcon name="archive" :size="13" />
        <span class="flex-1 text-left">时间线归档</span>
        <span class="count">{{ archiveTree.length }}</span>
      </button>
      <div v-show="!collapsed.archive">
        <div v-for="(group, index) in archiveTree" :key="group.key">
          <div class="flex items-center">
            <button
              class="row flex-1"
              :class="{ active: activeMonth === group.key }"
              @click="pickMonth(group.key)"
            >
              <AppIcon name="calendar" :size="12" />
              <span class="flex-1 text-left">{{ group.label }} ({{ group.count }})</span>
            </button>
            <button class="px-1.5 muted hover:text-[var(--app-text)]" @click="toggleArchiveMonth(group.key)">
              <AppIcon :name="isArchiveOpen(group.key, index) ? 'chevron-down' : 'chevron-right'" :size="12" />
            </button>
          </div>
          <div v-show="isArchiveOpen(group.key, index)" class="pl-3">
            <button
              v-for="n in group.notes.slice(0, 30)"
              :key="n.id"
              class="row text-[11px]"
              @click="ws.openEdit(n)"
            >
              <span class="dot" :style="{ background: ws.categories.colorFor(n.category || '未分类') }" />
              <span class="flex-1 truncate text-left">{{ n.title }}</span>
            </button>
            <p v-if="group.notes.length > 30" class="px-2 py-1 text-[10px] muted">
              仅显示最近 30 篇，共 {{ group.notes.length }} 篇
            </p>
          </div>
        </div>
        <p v-if="!archiveTree.length" class="px-2 py-1 text-[11px] muted">暂无归档数据</p>
      </div>
    </div>

    <!-- 统计脚注 -->
    <div class="border-t border-[var(--app-border)] px-3 py-2 text-[11px] leading-5 muted">
      <p>笔记 {{ totalCount }} 篇 · 约 {{ ws.totalWords.value }} 字</p>
      <p v-if="ws.lastSyncAt.value">同步于 {{ new Date(ws.lastSyncAt.value).toLocaleString('zh-CN') }}</p>
      <p v-else>尚未同步</p>
    </div>
  </aside>
</template>

<style scoped>
.filter-sidebar {
  display: flex;
  flex-direction: column;
  width: 15.5rem;
  flex-shrink: 0;
  border-right: 1px solid var(--app-border);
  background: var(--app-surface);
  overflow-y: auto;
  max-height: 100%;
}
.section {
  border-bottom: 1px solid var(--app-border);
  padding: 0.25rem 0.25rem;
}
.section-head {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
  padding: 0.3rem 0.4rem;
  font-size: 12px;
  font-weight: 600;
  color: var(--app-muted);
  border-radius: 6px;
}
.section-head:hover {
  background: rgba(110, 118, 129, 0.12);
}
.row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
  font-size: 12px;
  color: var(--app-text);
}
.row:hover {
  background: rgba(110, 118, 129, 0.14);
}
.row.active {
  background: rgba(9, 105, 218, 0.14);
  color: var(--app-accent);
  font-weight: 600;
}
.count {
  font-size: 10px;
  color: var(--app-muted);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 1px solid var(--app-border);
  border-radius: 999px;
  padding: 1px 7px;
  font-size: 11px;
  color: var(--app-muted);
}
.tag-chip:hover {
  border-color: var(--app-accent);
  color: var(--app-accent);
}
.tag-chip.active {
  font-weight: 600;
  background: rgba(9, 105, 218, 0.1);
}

/* 移动端：抽屉式 */
@media (max-width: 1023px) {
  .filter-sidebar {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 50;
    transform: translateX(-100%);
    transition: transform 0.22s ease;
    box-shadow: 0 0 24px rgba(0, 0, 0, 0.25);
    max-height: none;
  }
  .filter-sidebar.open {
    transform: translateX(0);
  }
}
</style>
