/**
 * 全局轻提示（Toast）
 * 模块级 reactive 状态即天然单例，无需引入状态管理库。
 */
import { ref } from 'vue'

const toasts = ref([])
let seq = 0

/**
 * @param {string} message
 * @param {'info'|'success'|'error'|'warn'} type
 * @param {number} duration 毫秒，error 默认停留更久
 */
export function pushToast(message, type = 'info', duration) {
  const id = ++seq
  const ttl = duration ?? (type === 'error' ? 7000 : 3000)
  toasts.value.push({ id, message: String(message), type })
  setTimeout(() => dismissToast(id), ttl)
  return id
}

export function dismissToast(id) {
  const idx = toasts.value.findIndex((t) => t.id === id)
  if (idx >= 0) toasts.value.splice(idx, 1)
}

export const toast = {
  info: (m, d) => pushToast(m, 'info', d),
  success: (m, d) => pushToast(m, 'success', d),
  warn: (m, d) => pushToast(m, 'warn', d),
  error: (m, d) => pushToast(m, 'error', d),
}

export function useToast() {
  return { toasts, pushToast, dismissToast, toast }
}
