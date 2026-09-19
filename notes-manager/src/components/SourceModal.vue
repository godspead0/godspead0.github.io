<script setup>
/**
 * 「数据来源」弹窗（纯只读）
 * ---------------------------------------------------------------
 * 本站是只读的笔记查看器，没有任何需要用户填写的配置，
 * 因此原「连接设置」弹窗被替换成这张信息卡片：
 * 告诉访客数据从哪来、展示了哪些目录、为什么不需要登录。
 */
import { computed, onUnmounted, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { useConfig } from '../composables/useConfig.js'

const { vaults, showSource } = useConfig()

const repoFullName = computed(() => {
  const v = vaults.value[0]
  return v?.owner && v?.repo ? `${v.owner}/${v.repo}` : ''
})

const repoUrl = computed(() => (repoFullName.value ? `https://github.com/${repoFullName.value}` : ''))

function close() {
  showSource.value = false
}

function onKey(e) {
  if (e.key === 'Escape') close()
}

watch(showSource, (open) => {
  if (open) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
})

onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Transition name="fade">
    <div
      v-if="showSource"
      class="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/45 p-4 py-10"
      @click.self="close"
    >
      <div class="card w-full max-w-lg p-5 shadow-2xl">
        <div class="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 class="flex items-center gap-2 text-lg font-semibold">
              <AppIcon name="book" :size="18" />
              数据来源
            </h2>
            <p class="mt-1 text-xs muted">本站是<b>只读</b>的笔记查看器，不需要登录，也没有需要填写的配置。</p>
          </div>
          <button class="btn btn-sm" title="关闭" @click="close"><AppIcon name="x" :size="14" /></button>
        </div>

        <!-- 仓库信息 -->
        <div class="mb-4 rounded-lg border border-[var(--app-border)] p-3 text-xs leading-6">
          <div class="flex items-center justify-between gap-3">
            <span class="muted">数据仓库</span>
            <a
              v-if="repoUrl"
              :href="repoUrl"
              target="_blank"
              rel="noreferrer noopener"
              class="flex items-center gap-1 font-mono hover:underline"
            >
              <AppIcon name="github" :size="13" />
              {{ repoFullName }}
            </a>
          </div>
          <div class="mt-1 flex items-center justify-between gap-3">
            <span class="muted">可见性</span>
            <span>公开仓库（任何人都能读取）</span>
          </div>
        </div>

        <!-- 展示范围 -->
        <table class="mb-4 w-full text-xs">
          <thead>
            <tr class="muted">
              <th class="py-1 text-left font-medium">分类</th>
              <th class="py-1 text-left font-medium">扫描目录</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in vaults" :key="v.id" class="border-t border-[var(--app-border)]">
              <td class="py-1.5">{{ v.label }}</td>
              <td class="py-1.5 font-mono">{{ v.notesDir ? `${v.notesDir}/` : '仓库根目录' }}</td>
            </tr>
          </tbody>
        </table>

        <!-- 为什么只读 -->
        <div class="rounded-lg border border-[#0969da]/35 bg-[#ddf4ff]/70 p-3 text-xs leading-6 dark:bg-[#0c2d6b]/40">
          <p class="flex items-start gap-2">
            <AppIcon name="shield" :size="14" class="mt-1" />
            <span>
              页面<b>不向 GitHub 发起任何写请求</b>，也不保存任何凭据 ——
              打开就能看，关掉什么都不留。笔记的新增与修改在本地完成后，
              由 <code class="font-mono">提交笔记.bat</code> 推送到上面这个公开仓库。
            </span>
          </p>
        </div>

        <div class="mt-4 flex justify-end">
          <button class="btn btn-primary btn-sm" @click="close">知道了</button>
        </div>
      </div>
    </div>
  </Transition>
</template>
