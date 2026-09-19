<script setup>
/** 笔记阅读视图（Markdown 渲染 + 元数据 + 快捷操作） */
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import MarkdownPreview from './MarkdownPreview.vue'
import { useWorkspace } from '../composables/useWorkspace.js'
import { countWords, formatDateTime } from '../services/notes.js'
import { readingMinutes } from '../services/markdown.js'

const props = defineProps({
  note: { type: Object, default: null },
})

const emit = defineEmits(['close'])

const ws = useWorkspace()

const categoryColor = computed(() => ws.categories.colorFor(props.note?.category || '未分类', 'category'))

/** 用「这篇笔记所属的仓库」拼 GitHub 链接（多仓库下不能只看当前表单） */
const noteVault = computed(() => {
  const list = ws.config.vaults.value
  return list.find((v) => v.id === props.note?.vault) || ws.config.primaryVault.value || ws.config.form
})
const githubUrl = computed(() => {
  const { owner, repo, branch } = noteVault.value || {}
  if (!owner || !repo || !props.note?.path) return ''
  return `https://github.com/${owner}/${repo}/blob/${branch || 'master'}/${props.note.path}`
})

const words = computed(() => countWords(props.note?.body))
const minutes = computed(() => readingMinutes(props.note?.body))
</script>

<template>
  <Transition name="fade">
    <div
      v-if="note"
      class="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/50 sm:p-6"
      @click.self="emit('close')"
    >
      <div class="card flex w-full max-w-4xl flex-col overflow-hidden shadow-2xl">
        <!-- 头部 -->
        <div class="flex items-start gap-2 border-b border-[var(--app-border)] px-4 py-3">
          <div class="min-w-0 flex-1">
            <h2 class="truncate text-lg font-semibold">{{ note.title }}</h2>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] muted">
              <span
                v-if="note.vaultLabel"
                class="rounded-full px-2 py-0.5 font-semibold text-[#8250df]"
                style="background: rgba(130, 80, 223, 0.12)"
              >
                {{ note.vaultLabel }}
              </span>
              <span
                v-if="note.category"
                class="rounded-full px-2 py-0.5 font-medium"
                :style="{ background: `${categoryColor}22`, color: categoryColor }"
              >
                {{ note.category }}
              </span>
              <span v-for="t in note.tags" :key="t" class="chip">#{{ t }}</span>
              <span class="flex items-center gap-1"><AppIcon name="calendar" :size="11" />创建 {{ formatDateTime(note.created) }}</span>
              <span class="flex items-center gap-1"><AppIcon name="clock" :size="11" />更新 {{ formatDateTime(note.updated) }}</span>
              <span class="flex items-center gap-1"><AppIcon name="file-text" :size="11" />{{ words }} 字 · 约 {{ minutes }} 分钟</span>
            </div>
          </div>
          <button class="btn btn-sm" title="关闭 (Esc)" @click="emit('close')"><AppIcon name="x" :size="14" /></button>
        </div>

        <!-- 正文 -->
        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <MarkdownPreview :content="note.body" />
        </div>

        <!-- 底部操作 -->
        <div class="flex flex-wrap items-center gap-2 border-t border-[var(--app-border)] px-4 py-3">
          <button class="btn btn-sm btn-primary" @click="ws.openEdit(note)">
            <AppIcon name="edit" :size="13" /> 编辑
          </button>
          <button class="btn btn-sm" @click="ws.exportOne(note)">
            <AppIcon name="download" :size="13" /> 下载 .md
          </button>
          <button class="btn btn-sm" @click="ws.copyRaw(note)">
            <AppIcon name="copy" :size="13" /> 复制原文
          </button>
          <a
            v-if="githubUrl"
            class="btn btn-sm"
            :href="githubUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            <AppIcon name="github" :size="13" /> 在 GitHub 查看
          </a>
          <span class="ml-auto font-mono text-[10px] muted">sha: {{ (note.sha || '').slice(0, 7) || '-' }}</span>
          <button class="btn btn-sm btn-danger" @click="ws.removeNote(note)">
            <AppIcon name="trash" :size="13" /> 删除
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
