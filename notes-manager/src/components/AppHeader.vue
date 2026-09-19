<script setup>
/**
 * 顶部导航栏（纯只读）
 * 搜索框 / 全局动作（同步、导出、主题、数据来源）
 *
 * 本站不提供新建 / 导入 / 打卡 —— 那些写入动作都在本地由
 * 「提交笔记.bat」完成，页面不向 GitHub 发起任何写请求。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { useWorkspace } from '../composables/useWorkspace.js'
import { useSearch } from '../composables/useSearch.js'
import { useTheme } from '../composables/useTheme.js'
import { useConfig } from '../composables/useConfig.js'

const ws = useWorkspace()
const { notes } = ws
const { keyword, hasActiveFilter, clearFilters, filteredCount } = useSearch(notes)
const { isDark, toggleTheme } = useTheme()
const { vaults, openSource } = useConfig()

const searchInput = ref(null)

/**
 * 顶栏仓库标识。仓库名显示出来是正常的 —— 它本来就是公开仓库，
 * 也正是访客要读取的那个。两个页签指向同一仓库时只显示一次。
 */
const repoLabel = computed(() => {
  const list = vaults.value.filter((v) => v.owner && v.repo)
  if (!list.length) return '未配置仓库'
  const repos = [...new Set(list.map((v) => `${v.owner}/${v.repo}`))]
  if (repos.length === 1) return repos[0]
  return list.map((v) => v.label).join(' + ')
})

async function onSync() {
  await ws.refresh()
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
          <div class="flex items-center gap-1.5 text-sm font-semibold">
            笔记收纳与打卡
            <span
              class="rounded border border-[var(--app-border)] px-1 text-[10px] font-normal muted"
              title="本站是只读的笔记查看器：任何访客都能查看，但页面上不做任何修改"
            >只读</span>
          </div>
          <button class="flex items-center gap-1 text-[11px] muted hover:underline" @click="openSource">
            <AppIcon name="cloud" :size="11" />
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

        <button class="btn btn-sm" :disabled="ws.exporting.value" title="打包导出全部笔记 (zip)" @click="ws.exportZip()">
          <AppIcon :name="ws.exporting.value ? 'loader' : 'package'" :size="14" />
          <span class="hidden md:inline">导出</span>
        </button>

        <button class="btn btn-sm" :title="isDark ? '切换到浅色' : '切换到深色'" @click="toggleTheme">
          <AppIcon :name="isDark ? 'sun' : 'moon'" :size="14" />
        </button>

        <button class="btn btn-sm" title="数据来源" @click="openSource">
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
