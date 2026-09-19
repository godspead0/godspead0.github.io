/**
 * 打卡（Check-in）Composable
 * ---------------------------------------------------------------
 * 数据文件： checkins.json
 * 数据格式： { "YYYY-MM-DD": count, ... }
 *
 * 写入策略（关键）：
 *   每次打卡前先拉取远端最新 JSON 与 sha，在内存中 +1 后立刻提交，
 *   避免"本地旧快照覆盖远端新数据"。若遇 409 冲突，自动重试一次。
 *   同一日期内的多次打卡做 1.2s 合并（debounce），减少 commit 噪声。
 */
import { computed, ref } from 'vue'
import { GithubError, getFile, saveFile } from '../services/github.js'
import { toDateKey } from '../services/notes.js'
import { toast } from './useToast.js'

const CHECKINS_PATH = 'checkins.json'
const FLUSH_DELAY = 1200

const data = ref({}) // { 'YYYY-MM-DD': number }
const sha = ref('')
const loading = ref(false)
const checkedToday = ref(false)
const lastError = ref('')
const retryAfter = ref(0) // 409 冲突重试计数

let flushTimer = null
let pendingDelta = 0

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
 * @param {{silent?: boolean}} [opts]
 */
async function load(opts = {}) {
  loading.value = true
  lastError.value = ''
  try {
    const remote = await getFile(CHECKINS_PATH)
    if (remote) {
      const parsed = JSON.parse(remote.content || '{}')
      data.value = parsed && typeof parsed === 'object' ? parsed : {}
      sha.value = remote.sha
      writeCache(data.value)
    } else {
      // 文件不存在：视为空记录，首次打卡时会自动创建
      data.value = {}
      sha.value = ''
    }
    checkedToday.value = todayCount.value > 0
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
    checkedToday.value = todayCount.value > 0
  }
}

/**
 * 提交打卡数据到 GitHub
 * @param {number} attempt 内部重试计数
 */
async function flush(attempt = 0) {
  if (pendingDelta === 0) return true

  const delta = pendingDelta
  pendingDelta = 0
  const snapshot = { ...data.value }

  try {
    const { sha: newSha } = await saveFile(
      CHECKINS_PATH,
      JSON.stringify(snapshot, null, 2),
      sha.value || undefined,
      `checkin: +${delta} (${today.value})`,
    )
    sha.value = newSha
    writeCache(snapshot)
    checkedToday.value = todayCount.value > 0
    return true
  } catch (err) {
    // 3600 冲突：远端被别处更新，重新拉取后合并重试一次
    if (err instanceof GithubError && (err.status === 409 || err.status === 422) && attempt < 2) {
      try {
        const remote = await getFile(CHECKINS_PATH)
        if (remote) {
          const remoteData = JSON.parse(remote.content || '{}')
          // 合并：逐日取较大值，防止本地回退远端
          const merged = { ...remoteData }
          for (const [k, v] of Object.entries(snapshot)) {
            merged[k] = Math.max(Number(merged[k] || 0), Number(v) || 0)
          }
          data.value = merged
          sha.value = remote.sha
        } else {
          sha.value = ''
        }
        pendingDelta += delta
        retryAfter.value = attempt + 1
        return await flush(attempt + 1)
      } catch {
        pendingDelta += delta
      }
    }
    pendingDelta += delta // 失败回滚增量，等待下次重试
    const message = err instanceof GithubError ? err.message : err?.message || '打卡提交失败'
    lastError.value = message
    toast.error(`打卡同步失败：${message}`)
    return false
  }
}

/** 延迟合并提交 */
function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    flush()
  }, FLUSH_DELAY)
}

/**
 * 打卡 +n
 * @param {number} n
 * @param {{silent?: boolean, date?: string}} [opts]
 */
async function checkIn(n = 1, opts = {}) {
  const key = opts.date || today.value
  data.value = { ...data.value, [key]: Number(data.value[key] || 0) + n }
  pendingDelta += n
  checkedToday.value = todayCount.value > 0

  if (opts.silent) {
    scheduleFlush()
    return true
  }
  const ok = await flush()
  if (ok) toast.success(`打卡成功！今日第 ${Number(data.value[key] || 0)} 次 🎉`)
  return ok
}

/** 撤销今日打卡（减 1，最低 0） */
async function undoToday() {
  const key = today.value
  const current = Number(data.value[key] || 0)
  if (current <= 0) {
    toast.info('今天还没有打卡记录')
    return false
  }
  data.value = { ...data.value, [key]: current - 1 }
  pendingDelta -= 1
  const ok = await flush()
  if (ok) toast.info(`已撤销 1 次打卡，今日剩余 ${data.value[key]} 次`)
  return ok
}

/**
 * 设置某天次数（用于手动校正）
 */
async function setDay(dateKey, count) {
  const value = Math.max(0, Number(count) || 0)
  const prev = Number(data.value[dateKey] || 0)
  data.value = { ...data.value, [dateKey]: value }
  pendingDelta += value - prev
  return flush()
}

/** 笔记创建/修改时自动触发的静默打卡（不弹成功提示，失败也不打断主流程） */
function autoCheckIn(reason = '笔记更新') {
  return checkIn(1, { silent: true }).then((ok) => {
    if (ok) toast.info(`已自动打卡 +1（${reason}）`)
  })
}

export function useCheckins() {
  return {
    data,
    sha,
    loading,
    checkedToday,
    lastError,
    retryAfter,
    today,
    todayCount,
    totalCheckins,
    activeDays,
    streak,
    longestStreak,
    load,
    hydrateFromCache,
    checkIn,
    undoToday,
    setDay,
    autoCheckIn,
    flush,
  }
}
