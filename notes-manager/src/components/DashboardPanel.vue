<script setup>
/**
 * 仪表盘：打卡热力图 + 统计指标（**全部只读**，页面上没有打卡 / 撤销 / 补卡入口）
 */
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import ContributionGraph from './ContributionGraph.vue'
import { useWorkspace } from '../composables/useWorkspace.js'
import { useSearch } from '../composables/useSearch.js'
import { toDateKey } from '../services/notes.js'

const ws = useWorkspace()
const { notes, notesLoading } = ws
const { todayCreated } = useSearch(notes)

const checkinData = ws.checkins.data
const todayCount = ws.checkins.todayCount
const totalCheckins = ws.checkins.totalCheckins
const activeDays = ws.checkins.activeDays
const streak = ws.checkins.streak
const longestStreak = ws.checkins.longestStreak
const checkinLoading = ws.checkins.loading

const rangeWeeks = ref(26)
const RANGES = [
  { weeks: 12, label: '近 12 周' },
  { weeks: 26, label: '近 26 周' },
  { weeks: 53, label: '近一年' },
]
const rangeLabel = computed(() => RANGES.find((r) => r.weeks === rangeWeeks.value)?.label || '')

const selectedDay = ref(toDateKey())

/** 选中日期的打卡次数与该日创建的笔记 */
const dayInfo = computed(() => {
  const key = selectedDay.value
  const count = Number(checkinData.value[key] || 0)
  const created = notes.value.filter((n) => toDateKey(new Date(n.created || Date.now())) === key)
  return { key, count, created }
})

/* 本站只读：打卡 / 撤销等写入动作已全部移除，热力图仅用于回顾历史记录 */

function onSelectDay(key) {
  selectedDay.value = key
}

const stats = computed(() => [
  { label: '笔记总数', value: ws.noteCount.value, icon: 'book', unit: '篇' },
  { label: '正文字数', value: ws.totalWords.value, icon: 'file-text', unit: '字' },
  { label: '今日新建', value: todayCreated.value, icon: 'plus', unit: '篇' },
  { label: '活跃天数', value: activeDays.value, icon: 'calendar', unit: '天' },
  { label: '累计打卡', value: totalCheckins.value, icon: 'flame', unit: '次' },
  { label: '最长连续', value: longestStreak.value, icon: 'zap', unit: '天' },
])
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
    <!-- 打卡主卡片 -->
    <div class="card mb-3 p-4">
      <div class="flex flex-wrap items-center gap-4">
        <div class="flex items-center gap-3">
          <div
            class="flex h-14 w-14 flex-col items-center justify-center rounded-xl"
            :class="todayCount.value ? 'bg-[#1f883d]/12 text-[#1f883d]' : 'bg-black/5 muted dark:bg-white/10'"
          >
            <AppIcon name="flame" :size="22" />
          </div>
          <div>
            <p class="text-xs muted">今日打卡</p>
            <p class="text-2xl font-bold leading-tight">
              {{ todayCount.value }}<span class="ml-1 text-xs font-normal muted">次</span>
            </p>
            <p class="text-[11px] muted">连续 {{ streak.value }} 天 · 最长 {{ longestStreak.value }} 天</p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <span class="rounded-md border border-[var(--app-border)] px-2 py-1 text-[11px] muted">
            记录来自 <code class="font-mono">checkins.json</code>（只读展示）
          </span>
          <button class="btn" :disabled="checkinLoading.value" title="重新拉取 checkins.json" @click="ws.checkins.load()">
            <AppIcon :name="checkinLoading.value ? 'loader' : 'refresh'" :size="14" />
          </button>
        </div>

        <div class="ml-auto grid grid-cols-3 gap-3 text-center text-xs">
          <div>
            <p class="text-base font-semibold">{{ activeDays.value }}</p>
            <p class="muted">活跃天数</p>
          </div>
          <div>
            <p class="text-base font-semibold">{{ totalCheckins.value }}</p>
            <p class="muted">累计打卡</p>
          </div>
          <div>
            <p class="text-base font-semibold">{{ ws.noteCount.value }}</p>
            <p class="muted">笔记总数</p>
          </div>
        </div>
      </div>

      <p v-if="ws.checkins.lastError.value" class="mt-3 text-[11px] text-[#cf222e]">
        {{ ws.checkins.lastError.value }}
      </p>
    </div>

    <!-- 热力图 -->
    <div class="card mb-3 p-4">
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <h2 class="flex items-center gap-2 text-sm font-semibold">
          <AppIcon name="calendar" :size="15" /> 打卡热力图
        </h2>
        <div class="ml-auto flex items-center gap-1">
          <button
            v-for="r in RANGES"
            :key="r.weeks"
            class="btn btn-sm"
            :class="rangeWeeks === r.weeks && 'border-[var(--app-accent)] text-[var(--app-accent)]'"
            @click="rangeWeeks = r.weeks"
          >
            {{ r.label }}
          </button>
        </div>
      </div>

      <ContributionGraph
        :data="checkinData"
        :weeks="rangeWeeks"
        :selected="selectedDay"
        :range-label="rangeLabel"
        @select="onSelectDay"
      />

      <!-- 选中日期详情（只读：不再提供补卡） -->
      <div class="mt-3 rounded-lg border border-[var(--app-border)] p-3 text-xs">
        <div class="flex flex-wrap items-center gap-2">
          <AppIcon name="calendar" :size="13" class="muted" />
          <b>{{ dayInfo.key }}</b>
          <span class="chip">{{ dayInfo.count }} 次打卡</span>
          <span class="chip">当日新建 {{ dayInfo.created.length }} 篇</span>
        </div>
        <div v-if="dayInfo.created.length" class="mt-2 flex flex-wrap gap-1">
          <button
            v-for="n in dayInfo.created"
            :key="n.id"
            class="chip hover:underline"
            :title="`查看：${n.title}`"
            @click="ws.detailNote.value = n"
          >
            {{ n.title }}
          </button>
        </div>
        <p v-else class="mt-1 text-[11px] muted">这天没有新建笔记记录。</p>
      </div>
    </div>

    <!-- 统计指标 -->
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      <div v-for="s in stats" :key="s.label" class="card p-3">
        <div class="flex items-center gap-1.5 text-[11px] muted">
          <AppIcon :name="s.icon" :size="12" />
          {{ s.label }}
        </div>
        <p class="mt-1 text-lg font-semibold leading-tight">
          {{ s.value }}<span class="ml-0.5 text-[10px] font-normal muted">{{ s.unit }}</span>
        </p>
      </div>
    </div>

    <!-- 同步进度 -->
    <div
      v-if="notesLoading.value && ws.progress.value.total"
      class="mt-3 card flex items-center gap-3 p-3 text-xs"
    >
      <AppIcon name="loader" :size="14" />
      <span>{{ ws.progress.value.label }}</span>
      <div class="h-1.5 flex-1 overflow-hidden rounded bg-black/10 dark:bg-white/10">
        <div
          class="h-full bg-[var(--app-accent)] transition-all"
          :style="{ width: `${Math.round((ws.progress.value.done / ws.progress.value.total) * 100)}%` }"
        />
      </div>
      <span class="muted">{{ ws.progress.value.done }}/{{ ws.progress.value.total }}</span>
    </div>
  </section>
</template>
