/**
 * 打卡（Check-in）Composable —— 只读
 * ---------------------------------------------------------------
 * 数据文件： checkins.json
 * 数据格式： { "YYYY-MM-DD": count, ... }
 *
 * 本站只**读取**打卡记录用于渲染热力图与统计。
 * 原先的写入逻辑（+1 / 撤销 / 补卡 / 409 冲突重试 / 1.2s 合并提交）
 * 已全部移除 —— 网页端不再向 GitHub 发起任何写请求。
 */
import { computed, ref } from 'vue'
import { GithubError, getFile } from '../services/github.js'
import { toDateKey } from '../services/notes.js'
import { toast } from './useToast.js'
import { useConfig } from './useConfig.js'

const CHECKINS_PATH = 'checkins.json'

const data = ref({}) // { 'YYYY-MM-DD': number }
const loading = ref(false)
const lastError = ref('')

/* ---------------------------------------------------------------- */
/* 本地缓存：先用 localStorage 秒开热力图，再与远端对齐                */
/* ---------------------------------------------------------------- */
const CACHE_KEY = 'notes-manager.checkins.cache'

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeCache(value) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(value))
  } catch {
    /* 隐私模式忽略 */
  }
}

/**
 * 彻底抹除本机打卡缓存（内存 + localStorage）
 * 用于「清除站点数据」：缓存里是公开笔记的副本，本身不敏感，清掉只是不留痕。
 */
function purge() {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    /* 存储不可用时无需清理 */
  }
  data.value = {}
  lastError.value = ''
}

/* ---------------------------------------------------------------- */

const today = computed(() => toDateKey())
const todayCount = computed(() => Number(data.value[today.value] || 0))
const totalCheckins = computed(() =>
  Object.values(data.value).reduce((sum, n) => sum + (Number(n) || 0), 0),
)
const activeDays = computed(() => Object.values(data.value).filter((n) => Number(n) > 0).length)

/** 连续打卡天数（从今天或昨天往前推） */
const streak = computed(() => {
  const dates = new Set(
    Object.entries(data.value)
      .filter(([, n]) => Number(n) > 0)
      .map(([d]) => d),
  )
  if (!dates.size) return 0

  const cursor = new Date()
  // 今天没打但昨天打了，连续天数仍然连续
  if (!dates.has(toDateKey(cursor))) cursor.setDate(cursor.getDate() - 1)

  let count = 0
  while (dates.has(toDateKey(cursor))) {
    count += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return count
})

/** 最长连续打卡记录 */
const longestStreak = computed(() => {
  const days = Object.entries(data.value)
    .filter(([, n]) => Number(n) > 0)
    .map(([d]) => d)
    .sort()
  if (!days.length) return 0

  let best = 1
  let cur = 1
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(`${days[i - 1]}T00:00:00`)
    const now = new Date(`${days[i]}T00:00:00`)
    const diff = Math.round((now - prev) / 86400000)
    if (diff === 1) {
      cur += 1
      best = Math.max(best, cur)
    } else if (diff > 1) {
      cur = 1
    }
  }
  return best
})

/**
 * 拉取远端 checkins.json
 * @param {{silent?: boolean, fresh?: boolean}} [opts] fresh = 用户主动同步，绕过 raw CDN 缓存
 */
async function load(opts = {}) {
  loading.value = true
  lastError.value = ''
  try {
    const vault = useConfig().primaryVault.value
    const remote = await getFile(CHECKINS_PATH, vault, opts.fresh ? { bust: Date.now() } : {})
    if (remote) {
      const parsed = JSON.parse(remote.content || '{}')
      data.value = parsed && typeof parsed === 'object' ? parsed : {}
      writeCache(data.value)
    } else {
      // 文件不存在：视为空记录（本站只读，不会去创建它）
      data.value = {}
    }
    if (!opts.silent) {
      const n = activeDays.value
      if (n) toast.info(`已载入打卡记录：累计 ${totalCheckins.value} 次 / ${n} 天`)
    }
  } catch (err) {
    const message = err instanceof GithubError ? err.message : err?.message || '打卡记录读取失败'
    lastError.value = message
    toast.error(message)
  } finally {
    loading.value = false
  }
}

/** 用本地缓存立即渲染，做到"打开即见热力图" */
function hydrateFromCache() {
  const cached = readCache()
  if (cached && typeof cached === 'object') {
    data.value = { ...cached, ...data.value }
  }
}

export function useCheckins() {
  return {
    data,
    loading,
    lastError,
    today,
    todayCount,
    totalCheckins,
    activeDays,
    streak,
    longestStreak,
    load,
    hydrateFromCache,
    purge,
  }
}
