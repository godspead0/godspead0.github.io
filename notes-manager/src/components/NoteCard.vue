<script setup>
/** 单篇笔记卡片 */
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import { useWorkspace } from '../composables/useWorkspace.js'
import { formatDateTime, countWords } from '../services/notes.js'
import { toPlainText } from '../services/markdown.js'

const props = defineProps({
  note: { type: Object, required: true },
  selected: { type: Boolean, default: false },
  selectable: { type: Boolean, default: true },
})

const emit = defineEmits(['open', 'toggle-select'])

const ws = useWorkspace()

const excerpt = computed(() => toPlainText(props.note.body, 180) || '（无正文）')
const words = computed(() => countWords(props.note.body))
const categoryColor = computed(() => ws.categories.colorFor(props.note.category || '未分类', 'category'))
const updatedLabel = computed(() => formatDateTime(props.note.updated))

function onOpen() {
  emit('open', props.note)
}
</script>

<template>
  <article
    class="note-card card group cursor-pointer p-3 transition hover:border-[var(--app-accent)]"
    :class="{ picked: selected }"
    @click="onOpen"
  >
    <div class="flex items-start gap-2">
      <input
        v-if="selectable"
        type="checkbox"
        class="mt-1 h-3.5 w-3.5 cursor-pointer accent-[#0969da]"
        :checked="selected"
        title="选择"
        @click.stop
        @change="emit('toggle-select', note.id)"
      />

      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="truncate text-sm font-semibold">{{ note.title }}</h3>
          <span
            v-if="note.category"
            class="rounded-full px-2 py-0.5 text-[10px] font-medium"
            :style="{ background: `${categoryColor}22`, color: categoryColor }"
          >
            {{ note.category }}
          </span>
          <span v-else class="rounded-full bg-black/5 px-2 py-0.5 text-[10px] muted dark:bg-white/10">未分类</span>
        </div>

        <p class="mt-1 line-clamp-2 text-xs leading-5 muted">{{ excerpt }}</p>

        <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span v-for="t in note.tags" :key="t" class="chip">#{{ t }}</span>
        </div>

        <div class="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] muted">
          <span class="flex items-center gap-1"><AppIcon name="clock" :size="11" />{{ updatedLabel }}</span>
          <span class="flex items-center gap-1"><AppIcon name="file-text" :size="11" />{{ words }} 字</span>
          <span v-if="note.source" class="flex items-center gap-1"><AppIcon name="upload" :size="11" />{{ note.source }}</span>
        </div>
      </div>

      <!-- 悬停操作 -->
      <div class="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
        <button class="btn btn-sm" title="编辑" @click.stop="ws.openEdit(note)">
          <AppIcon name="edit" :size="13" />
        </button>
        <button class="btn btn-sm" title="下载 .md" @click.stop="ws.exportOne(note)">
          <AppIcon name="download" :size="13" />
        </button>
        <button class="btn btn-sm btn-danger" title="删除" @click.stop="ws.removeNote(note)">
          <AppIcon name="trash" :size="13" />
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped>
.note-card.picked {
  border-color: var(--app-accent);
  background: rgba(9, 105, 218, 0.06);
}
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
