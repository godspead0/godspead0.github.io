<script setup>
/**
 * GitHub 风格点阵打卡热力图
 * ---------------------------------------------------------------
 * 纯 SVG 实现：7 行（周一~周日，可按 weekStart 调整）× N 周（默认 26 周 ≈ 半年）。
 *   - 频次越高绿色越深（5 级色阶，浅色/深色主题各一套）
 *   - 顶部月份刻度、左侧星期刻度、悬停浮层、点击选中某日
 *   - 今日单元格带描边高亮
 * 除 Vue 外零依赖。
 */
import { computed, ref } from 'vue'

const props = defineProps({
  /** { 'YYYY-MM-DD': count } */
  data: { type: Object, default: () => ({}) },
  weeks: { type: Number, default: 26 },
  cell: { type: Number, default: 12 },
  gap: { type: Number, default: 3 },
  /** 0 = 周日开头（GitHub 默认），1 = 周一开头 */
  weekStart: { type: Number, default: 0 },
  /** 高亮的日期键 */
  selected: { type: String, default: '' },
  /** 区间说明文案，例如「近 26 周」 */
  rangeLabel: { type: String, default: '' },
})

const emit = defineEmits(['select'])

const LEFT = 26 // 左侧星期标签宽度
const TOP = 16 // 顶部月份标签高度

/* ----------------------------- 日期工具 ----------------------------- */

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  d.setHours(0, 0, 0, 0)
  return d
}

function keyOf(date) {
  const d = date instanceof Date ? date : new Date(date)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

const WEEKDAY_FULL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/* ----------------------------- 计算网格 ----------------------------- */

const today = startOfDay(new Date())
const todayKey = keyOf(today)

const activeDates = computed(() =>
  Object.entries(props.data || {})
    .filter(([, n]) => Number(n) > 0)
    .map(([k]) => k)
    .sort(),
)

const maxCount = computed(() => {
  const values = Object.values(props.data || {}).map((n) => Number(n) || 0)
  return Math.max(1, ...values)
})

/** 频次 -> 0~4 级 */
function levelOf(count) {
  const n = Number(count) || 0
  if (n <= 0) return 0
  const max = maxCount.value
  if (max <= 1) return 4
  const ratio = n / max
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}

const columns = computed(() => {
  const counts = props.data || {}
  const offset = (today.getDay() - props.weekStart + 7) % 7
  // 本周最后一天，保证最后一列是"完整的一周"
  const end = addDays(today, 6 - offset)
  const start = addDays(end, -(props.weeks * 7 - 1))

  let lastLabelColumn = -99
  const cols = []

  for (let w = 0; w < props.weeks; w++) {
    const days = []
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d)
      const key = keyOf(date)
      const count = Number(counts[key] || 0)
      days.push({
        key,
        count,
        level: levelOf(count),
        x: LEFT + w * (props.cell + props.gap),
        y: TOP + d * (props.cell + props.gap),
        future: date.getTime() > today.getTime(),
        isToday: key === todayKey,
      })
    }

    // 月份刻度：以每列首日的月份变化作为分界，且避免标签互相重叠
    const first = days[0]
    const monthOfFirst = first.key.slice(0, 7)
    const prevMonth = w > 0 ? cols[w - 1].month : ''
    const month = monthOfFirst
    const showLabel = month !== prevMonth && w - lastLabelColumn >= 3
    if (showLabel) lastLabelColumn = w

    cols.push({
      index: w,
      days,
      month,
      label: showLabel ? `${Number(month.slice(5, 7))}月` : '',
      labelX: days[0].x,
    })
  }
  return cols
})

const width = computed(() => LEFT + props.weeks * (props.cell + props.gap) - props.gap)
const height = computed(() => TOP + 7 * (props.cell + props.gap) - props.gap)

/** 左侧只标注周一 / 周三 / 周五，避免拥挤 */
const weekdayLabels = computed(() =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => {
    const realDay = (d + props.weekStart) % 7
    const show = realDay === 1 || realDay === 3 || realDay === 5
    return {
      d,
      text: show ? WEEKDAY_FULL[realDay] : '',
      y: TOP + d * (props.cell + props.gap) + props.cell - 2,
    }
  }),
)

/* ----------------------------- 交互 ----------------------------- */

const hovered = ref(null)

function onEnter(day) {
  hovered.value = day
}

function onLeave() {
  hovered.value = null
}

function onSelect(day) {
  if (day.future) return
  emit('select', day.key)
}

const tooltipStyle = computed(() => {
  const day = hovered.value
  if (!day) return {}
  return {
    left: `${day.x + props.cell / 2}px`,
    top: `${day.y - 6}px`,
  }
})

function tooltipText(day) {
  if (!day) return ''
  const [y, m, d] = day.key.split('-')
  const label = `${y}年${Number(m)}月${Number(d)}日`
  if (day.future) return `${label} · 未来`
  if (!day.count) return `${label} · 无打卡`
  return `${label} · ${day.count} 次`
}

/* ----------------------------- 汇总 ----------------------------- */

const windowStats = computed(() => {
  const cols = columns.value
  if (!cols.length) return { total: 0, activeDays: 0, peak: 0 }
  const rangeKeys = new Set()
  cols.forEach((c) => c.days.forEach((d) => !d.future && rangeKeys.add(d.key)))
  let total = 0
  let activeDays = 0
  let peak = 0
  for (const key of rangeKeys) {
    const n = Number(props.data?.[key] || 0)
    if (n > 0) {
      total += n
      activeDays += 1
      peak = Math.max(peak, n)
    }
  }
  return { total, activeDays, peak }
})
</script>

<template>
  <div class="contribution-graph">
    <!-- 图例 / 汇总 -->
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs muted">
      <span>
        {{ rangeLabel || `近 ${weeks} 周` }}：<b class="text-[var(--app-text)]">{{ windowStats.total }}</b> 次打卡 ·
        <b class="text-[var(--app-text)]">{{ windowStats.activeDays }}</b> 天有记录 · 峰值
        <b class="text-[var(--app-text)]">{{ windowStats.peak }}</b> 次/天
      </span>
      <span class="flex items-center gap-1">
        少
        <i v-for="l in [0, 1, 2, 3, 4]" :key="l" class="legend-cell" :class="`lvl-${l}`" />
        多
      </span>
    </div>

    <!-- 网格：窄屏横向滚动，不压缩单元格 -->
    <div class="scroll-x">
      <div class="relative" :style="{ width: `${width}px` }">
        <svg
          :width="width"
          :height="height"
          :viewBox="`0 0 ${width} ${height}`"
          role="img"
          :aria-label="`打卡热力图，${rangeLabel || `近 ${weeks} 周`}，共 ${windowStats.total} 次打卡`"
          @mouseleave="onLeave"
        >
          <!-- 月份刻度 -->
          <text
            v-for="col in columns"
            :key="`m-${col.index}`"
            :x="col.labelX"
            :y="11"
            class="axis-text"
          >
            {{ col.label }}
          </text>

          <!-- 星期刻度 -->
          <text
            v-for="w in weekdayLabels"
            :key="`w-${w.d}`"
            :x="0"
            :y="w.y"
            class="axis-text"
          >
            {{ w.text }}
          </text>

          <!-- 单元格 -->
          <g v-for="col in columns" :key="`c-${col.index}`">
            <rect
              v-for="day in col.days"
              :key="day.key"
              :x="day.x"
              :y="day.y"
              :width="cell"
              :height="cell"
              rx="2"
              class="cell"
              :class="[`lvl-${day.level}`, { future: day.future, today: day.isToday, picked: selected === day.key }]"
              @mouseenter="onEnter(day)"
              @click="onSelect(day)"
            >
              <title>{{ tooltipText(day) }}</title>
            </rect>
          </g>
        </svg>

        <!-- 悬停浮层 -->
        <div v-if="hovered" class="tip" :style="tooltipStyle">{{ tooltipText(hovered) }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scroll-x {
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 2px;
}

.axis-text {
  font-size: 9px;
  fill: var(--app-muted);
}

.cell {
  cursor: pointer;
  stroke: transparent;
  stroke-width: 1;
  transition: stroke 0.12s ease;
}
.cell:hover {
  stroke: var(--app-text);
}
.cell.future {
  opacity: 0.28;
  cursor: default;
}
.cell.today {
  stroke: var(--app-text);
  stroke-width: 1.5;
}
.cell.picked {
  stroke: var(--app-accent);
  stroke-width: 2;
}

/* GitHub 贡献图配色：浅色主题 */
.lvl-0 {
  fill: #ebedf0;
}
.lvl-1 {
  fill: #9be9a8;
}
.lvl-2 {
  fill: #40c463;
}
.lvl-3 {
  fill: #30a14e;
}
.lvl-4 {
  fill: #216e39;
}

/* 深色主题 */
:global(html.dark) .lvl-0 {
  fill: #21262d;
}
:global(html.dark) .lvl-1 {
  fill: #0e4429;
}
:global(html.dark) .lvl-2 {
  fill: #006d32;
}
:global(html.dark) .lvl-3 {
  fill: #26a641;
}
:global(html.dark) .lvl-4 {
  fill: #39d353;
}

.legend-cell {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.legend-cell.lvl-0 {
  background: #ebedf0;
}
.legend-cell.lvl-1 {
  background: #9be9a8;
}
.legend-cell.lvl-2 {
  background: #40c463;
}
.legend-cell.lvl-3 {
  background: #30a14e;
}
.legend-cell.lvl-4 {
  background: #216e39;
}
:global(html.dark) .legend-cell.lvl-0 {
  background: #21262d;
}
:global(html.dark) .legend-cell.lvl-1 {
  background: #0e4429;
}
:global(html.dark) .legend-cell.lvl-2 {
  background: #006d32;
}
:global(html.dark) .legend-cell.lvl-3 {
  background: #26a641;
}
:global(html.dark) .legend-cell.lvl-4 {
  background: #39d353;
}

.tip {
  position: absolute;
  transform: translate(-50%, -100%);
  padding: 3px 7px;
  border-radius: 6px;
  background: var(--app-text);
  color: var(--app-surface);
  font-size: 11px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 5;
}
</style>
