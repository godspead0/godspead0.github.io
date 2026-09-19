<script setup>
/** 全局提示浮层：右下角堆叠，点击可立即关闭 */
import { useToast } from '../composables/useToast.js'
import AppIcon from './AppIcon.vue'

const { toasts, dismissToast } = useToast()

const STYLE = {
  info: { icon: 'info', cls: 'border-[#0969da]/40 bg-[#ddf4ff] text-[#0a3069] dark:bg-[#0c2d6b]/60 dark:text-[#cae8ff]' },
  success: { icon: 'check-circle', cls: 'border-[#1a7f37]/40 bg-[#dafbe1] text-[#0f5323] dark:bg-[#0f2f1d]/70 dark:text-[#aff5b4]' },
  warn: { icon: 'alert', cls: 'border-[#9a6700]/40 bg-[#fff8c5] text-[#7d4e00] dark:bg-[#3a2d04]/80 dark:text-[#f5e6a8]' },
  error: { icon: 'alert', cls: 'border-[#cf222e]/40 bg-[#ffebe9] text-[#a40e26] dark:bg-[#4a1113]/80 dark:text-[#ffcecb]' },
}

function styleOf(type) {
  return STYLE[type] || STYLE.info
}
</script>

<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(92vw,26rem)] flex-col gap-2">
    <TransitionGroup name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="pointer-events-auto flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg backdrop-blur"
        :class="styleOf(t.type).cls"
        role="status"
        @click="dismissToast(t.id)"
      >
        <AppIcon :name="styleOf(t.type).icon" :size="16" class="mt-0.5" />
        <span class="flex-1 whitespace-pre-wrap break-words leading-5">{{ t.message }}</span>
        <button class="opacity-60 transition hover:opacity-100" title="关闭" @click.stop="dismissToast(t.id)">
          <AppIcon name="x" :size="14" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.22s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(16px);
}
.toast-move {
  transition: transform 0.22s ease;
}
</style>
