<script setup>
/** 安全的 Markdown 渲染视图（marked + DOMPurify） */
import { computed } from 'vue'
import { renderMarkdown } from '../services/markdown.js'

const props = defineProps({
  content: { type: String, default: '' },
  emptyText: { type: String, default: '（空白正文）' },
})

const html = computed(() => renderMarkdown(props.content))
</script>

<template>
  <div v-if="content && content.trim()" class="markdown-body" v-html="html" />
  <p v-else class="text-sm muted">{{ emptyText }}</p>
</template>
