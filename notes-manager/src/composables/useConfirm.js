/**
 * Promise 化的确认弹窗
 * ---------------------------------------------------------------
 * 用法：
 *   if (await confirmDialog({ title: '删除笔记', message: '该操作不可撤销' })) { ... }
 * 由 <ConfirmDialog /> 在根组件渲染一次即可。
 */
import { shallowRef } from 'vue'

const EMPTY = {
  open: false,
  title: '请确认',
  message: '',
  detail: '',
  confirmText: '确定',
  cancelText: '取消',
  danger: false,
  resolve: null,
}

const confirmState = shallowRef({ ...EMPTY })

/**
 * @param {{title?:string,message?:string,detail?:string,confirmText?:string,cancelText?:string,danger?:boolean}} options
 * @returns {Promise<boolean>}
 */
export function confirmDialog(options = {}) {
  return new Promise((resolve) => {
    confirmState.value = { ...EMPTY, ...options, open: true, resolve }
  })
}

/** 由弹窗组件回调：true = 确认，false = 取消/关闭 */
export function settleConfirm(value) {
  const resolver = confirmState.value.resolve
  confirmState.value = { ...confirmState.value, open: false, resolve: null }
  if (typeof resolver === 'function') resolver(Boolean(value))
}

export function useConfirm() {
  return { confirmState, confirmDialog, settleConfirm }
}
