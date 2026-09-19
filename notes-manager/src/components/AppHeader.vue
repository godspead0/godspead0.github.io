<script setup>
/**
 * 顶部导航栏
 * 搜索框 / 全局动作（同步、新建、导入、导出、打卡、主题、设置）
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { useWorkspace } from '../composables/useWorkspace.js'
import { useSearch } from '../composables/useSearch.js'
import { useTheme } from '../composables/useTheme.js'
import { useConfig } from '../composables/useConfig.js'

const emit = defineEmits(['pick-files'])

const ws = useWorkspace()
const { notes } = ws
const { keyword, hasActiveFilter, clearFilters, filteredCount } = useSearch(notes)
const { isDark, toggleTheme } = useTheme()
const { form, connected, openModal } = useConfig()

const searchInput = ref(null)

const repoLabel = computed(() => (form.repo ? `${form.owner}/${form.repo}` : '未配置仓库'))

async function onSync() {
  await ws.refresh()
}

function onPickFiles() {
  emit('pick-files')
}

function onKeydown(e) {
  const tag = document.activeElement?.tagName
  const typing = tag === 'INPUT' || tag === 'TEXTAREA'
  // “/” 聚焦搜索（GitHub 习惯）
  if (e.key === '/' && !typing) {
    e.preventDefault()
    searchInput.value?.focus()
  }
  // Ctrl/Cmd + K 同样聚焦搜索
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    searchInput.value?.focus()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <header
    class="sticky top-0 z-40 border-b border-[var(--app-border)] bg-[var(--app-surface)]/95 backdrop-blur"
  >
    <div class="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
      <!-- 品牌 -->
      <div class="flex items-center gap-2">
        <button class="btn btn-sm lg:hidden" title="筛选面板" @click="ws.sidebarOpen = !ws.sidebarOpen">
          <AppIcon name="menu" :size="14" />
        </button>
        <span class="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1f883d] text-white">
          <AppIcon name="book" :size="16" />
        </span>
        <div class="hidden leading-tight sm:block">
          <div class="text-sm font-semibold">笔记收纳与打卡</div>
          <button class="flex items-center gap-1 text-[11px] muted hover:underline" @click="openModal">
            <AppIcon :name="connected ? 'cloud' : 'cloud-off'" :size="11" />
            {{ repoLabel }}
          </button>
        </div>
      </div>

      <!-- 搜索 -->
      <div class="relative order-last w-full sm:order-none sm:ml-4 sm:w-auto sm:flex-1 sm:max-w-xl">
        <AppIcon name="search" :size="14" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 muted" />
        <input
          ref="searchInput"
          v-model="keyword"
          class="input pl-8 pr-24"
          type="search"
          placeholder="搜索标题 / 标签 / 正文…（/ 或 Ctrl+K 聚焦）"
          autocomplete="off"
        />
        <div class="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
          <button class="btn btn-sm" title="搜索（输入即实时过滤，无需回车）" @click="searchInput?.focus()">
            <AppIcon name="search" :size="12" />
            <span class="hidden sm:inline">搜索</span>
          </button>
          <span v-if="hasActiveFilter" class="text-[11px] muted">{{ filteredCount }} 条</span>
          <button v-if="keyword" class="btn btn-sm" title="清空搜索" @click="keyword = ''">
            <AppIcon name="x" :size="12" />
          </button>
        </div>
      </div>

      <!-- 动作区 -->
      <div class="ml-auto flex items-center gap-1.5">
        <button
          class="btn btn-sm"
          :disabled="ws.syncing.value"
          :title="ws.lastSyncAt.value ? `上次同步：${new Date(ws.lastSyncAt.value).toLocaleString('zh-CN')}` : '从 GitHub 拉取最新数据'"
          @click="onSync"
        >
          <AppIcon :name="ws.syncing.value ? 'loader' : 'refresh'" :size="14" />
          <span class="hidden sm:inline">{{ ws.syncing.value ? '同步中' : '同步' }}</span>
        </button>

        <button class="btn btn-sm btn-primary" title="新建笔记" @click="ws.openCreate()">
          <AppIcon name="plus" :size="14" />
          <span class="hidden sm:inline">新建</span>
        </button>

        <button class="btn btn-sm" title="导入本地 Markdown" @click="onPickFiles">
          <AppIcon name="upload" :size="14" />
          <span class="hidden md:inline">导入</span>
        </button>

        <button class="btn btn-sm" :disabled="ws.exporting.value" title="打包导出全部笔记 (zip)" @click="ws.exportZip()">
          <AppIcon :name="ws.exporting.value ? 'loader' : 'package'" :size="14" />
          <span class="hidden md:inline">导出</span>
        </button>

        <button
          class="btn btn-sm"
          :class="ws.checkins.checkedToday.value ? 'border-[#1f883d] text-[#1f883d]' : ''"
          :disabled="ws.checkins.checkedToday.value"
          :title="ws.checkins.checkedToday.value ? '今日已打卡（每天仅限一次）' : '今日一键打卡'"
          @click="ws.checkins.checkIn(1)"
        >
          <AppIcon name="flame" :size="14" />
          <span class="hidden sm:inline">{{ ws.checkins.checkedToday.value ? '已打卡' : ws.checkins.todayCount.value }}</span>
        </button>

        <button class="btn btn-sm" :title="isDark ? '切换到浅色' : '切换到深色'" @click="toggleTheme">
          <AppIcon :name="isDark ? 'sun' : 'moon'" :size="14" />
        </button>

        <button class="btn btn-sm" title="连接设置" @click="openModal">
          <AppIcon name="sliders" :size="14" />
        </button>
      </div>
    </div>

    <!-- 筛选提示条 -->
    <div
      v-if="hasActiveFilter"
      class="flex items-center gap-2 border-t border-[var(--app-border)] px-4 py-1 text-[11px] muted"
    >
      <AppIcon name="filter" :size="11" />
      <span>已启用筛选，当前匹配 {{ filteredCount }} / {{ notes.length }} 篇</span>
      <button class="hover:underline" @click="clearFilters">清除全部筛选</button>
    </div>
  </header>
</template>
