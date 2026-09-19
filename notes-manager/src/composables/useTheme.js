/**
 * 主题（浅色 / 深色）Composable
 * ---------------------------------------------------------------
 * 策略：Tailwind darkMode='class'，在 <html> 上切换 .dark。
 *   - 首次访问跟随系统 prefers-color-scheme
 *   - 用户手动切换后写入 localStorage，之后不再跟随系统
 */
import { ref } from 'vue'

const STORAGE_KEY = 'notes-manager.theme'

const isDark = ref(false)
const followsSystem = ref(true)

/** 计算"当前应为"的主题 */
function resolveInitial() {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'dark' || saved === 'light') {
    followsSystem.value = false
    return saved === 'dark'
  }
  followsSystem.value = true
  return Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches)
}

function apply(dark) {
  isDark.value = dark
  const root = document.documentElement
  root.classList.toggle('dark', dark)
  // 让浏览器原生控件（滚动条、表单）同步配色
  root.style.colorScheme = dark ? 'dark' : 'light'
}

/** 应用启动时调用一次（main.js） */
export function initTheme() {
  apply(resolveInitial())

  // 未手动指定时，跟随系统变化实时切换
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
  mq?.addEventListener?.('change', (e) => {
    if (followsSystem.value) apply(e.matches)
  })
  return isDark
}

function toggleTheme() {
  followsSystem.value = false
  const next = !isDark.value
  apply(next)
  try {
    localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light')
  } catch {
    /* 隐私模式忽略 */
  }
  return next
}

/** 恢复"跟随系统" */
function useSystemTheme() {
  localStorage.removeItem(STORAGE_KEY)
  followsSystem.value = true
  apply(Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches))
}

export function useTheme() {
  return { isDark, followsSystem, toggleTheme, useSystemTheme, initTheme }
}
