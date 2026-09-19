<script setup>
/** 全局确认弹窗（由 useConfirm 的 Promise 驱动） */
import { watch } from 'vue'
import { useConfirm } from '../composables/useConfirm.js'
import AppIcon from './AppIcon.vue'

const { confirmState, settleConfirm } = useConfirm()

function onKey(e) {
  if (e.key === 'Escape') settleConfirm(false)
  if (e.key === 'Enter') settleConfirm(true)
}

watch(
  () => confirmState.value.open,
  (open) => {
    if (open) window.addEventListener('keydown', onKey)
    else window.removeEventListener('keydown', onKey)
  },
)
</script>

<template>
  <Transition name="fade">
    <div
      v-if="confirmState.open"
      class="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4"
      @click.self="settleConfirm(false)"
    >
      <div class="w-full max-w-md rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-5 shadow-2xl">
        <div class="mb-2 flex items-center gap-2">
          <span
            class="flex h-7 w-7 items-center justify-center rounded-full"
            :class="confirmState.danger ? 'bg-[#cf222e]/12 text-[#cf222e]' : 'bg-[#0969da]/12 text-[var(--app-accent)]'"
          >
            <AppIcon :name="confirmState.danger ? 'alert' : 'info'" :size="16" />
          </span>
          <h3 class="text-base font-semibold">{{ confirmState.title }}</h3>
        </div>

        <p v-if="confirmState.message" class="whitespace-pre-wrap text-sm leading-6 muted">
          {{ confirmState.message }}
        </p>
        <p v-if="confirmState.detail" class="mt-2 rounded-md bg-black/5 p-2 font-mono text-xs dark:bg-white/5">
          {{ confirmState.detail }}
        </p>

        <div class="mt-5 flex justify-end gap-2">
          <button class="btn" @click="settleConfirm(false)">{{ confirmState.cancelText }}</button>
          <button
            class="btn"
            :class="confirmState.danger ? 'btn-danger' : 'btn-primary'"
            autofocus
            @click="settleConfirm(true)"
          >
            {{ confirmState.confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
