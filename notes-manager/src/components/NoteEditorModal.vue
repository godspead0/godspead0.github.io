<script setup>
/**
 * 笔记编辑器（新建 / 编辑）
 * ---------------------------------------------------------------
 * - 标题 / 分类 / 标签 / 正文（Markdown）
 * - 编辑 / 预览 / 分栏三种视图
 * - Ctrl/Cmd + S 保存，Esc 关闭（有改动时二次确认）
 * - 保存时由父组件负责推送到 GitHub，并在成功后触发自动打卡 +1
 */
import { computed, nextTick, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import MarkdownPreview from './MarkdownPreview.vue'
import { countWords, normalizeTags } from '../services/notes.js'
import { confirmDialog } from '../composables/useConfirm.js'
import { downloadNote } from '../services/exporter.js'
import { readingMinutes } from '../services/markdown.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  mode: { type: String, default: 'create' }, // create | edit
  note: { type: Object, default: null },
  categories: { type: Array, default: () => [] },
  knownTags: { type: Array, default: () => [] },
  saving: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'submit', 'delete'])

const title = ref('')
const category = ref('')
const tags = ref([])
const body = ref('')
const tagInput = ref('')
const view = ref('split') // edit | preview | split
const fullscreen = ref(false)
const titleInput = ref(null)

/** 打开时的初始快照，用于判断"是否有未保存改动" */
let snapshot = ''

function currentDraft() {
  return {
    id: props.note?.id || '',
    title: title.value.trim() || '未命名笔记',
    category: category.value.trim(),
    tags: [...tags.value],
    body: body.value,
    created: props.note?.created || new Date().toISOString(),
  }
}

function serialize() {
  const d = currentDraft()
  return JSON.stringify([d.title, d.category, d.tags, d.body])
}

function reset() {
  const n = props.note
  title.value = n?.title || ''
  category.value = n?.category || ''
  tags.value = [...(n?.tags || [])]
  body.value = n?.body || ''
  tagInput.value = ''
  view.value = 'split'
  fullscreen.value = false
  snapshot = serialize()
}

watch(
  () => [props.open, props.note],
  async ([open]) => {
    if (!open) return
    reset()
    await nextTick()
    if (props.mode === 'create') titleInput.value?.focus()
  },
  { immediate: true },
)

const dirty = computed(() => serialize() !== snapshot)
const words = computed(() => countWords(body.value))
const minutes = computed(() => readingMinutes(body.value))
const isEdit = computed(() => props.mode === 'edit')

/* --------------------------- 标签编辑 --------------------------- */

function commitTagInput() {
  const incoming = normalizeTags(tagInput.value)
  if (!incoming.length) return
  const merged = normalizeTags([...tags.value, ...incoming])
  tags.value = merged
  tagInput.value = ''
}

function removeTag(name) {
  tags.value = tags.value.filter((t) => t !== name)
}

function onTagKeydown(e) {
  if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
    e.preventDefault()
    commitTagInput()
  } else if (e.key === 'Backspace' && !tagInput.value && tags.value.length) {
    tags.value = tags.value.slice(0, -1)
  }
}

/* --------------------------- 操作 --------------------------- */

async function close() {
  if (dirty.value && !props.saving) {
    const ok = await confirmDialog({
      title: '放弃未保存的修改？',
      message: '当前笔记有改动尚未提交到 GitHub，关闭后将丢失。',
      confirmText: '放弃修改',
      danger: true,
    })
    if (!ok) return
  }
  emit('close')
}

function submit() {
  commitTagInput()
  emit('submit', currentDraft())
}

async function onDelete() {
  if (!props.note) return
  const ok = await confirmDialog({
    title: '删除这篇笔记？',
    message: `将同时删除 GitHub 仓库中的文件：\n${props.note.path || props.note.title}`,
    confirmText: '删除',
    danger: true,
  })
  if (ok) emit('delete', props.note)
}

function onKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    submit()
  } else if (e.key === 'Escape') {
    // 全屏预览时先退出全屏
    if (fullscreen.value) fullscreen.value = false
    else close()
  }
}

/* --------------------------- 插入语法辅助 --------------------------- */

function insert(before, after = '') {
  const el = document.activeElement
  const target = el && el.tagName === 'TEXTAREA' ? el : null
  if (!target) return
  const start = target.selectionStart
  const end = target.selectionEnd
  const selected = body.value.slice(start, end)
  const next = `${body.value.slice(0, start)}${before}${selected}${after}${body.value.slice(end)}`
  body.value = next
  nextTick(() => {
    target.focus()
    target.setSelectionRange(start + before.length, start + before.length + selected.length)
  })
}
</script>

<template>
  <Transition name="fade">
    <div
      v-if="open"
      class="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/50 p-0 sm:p-6"
      @click.self="close"
      @keydown="onKeydown"
    >
      <div
        class="card flex w-full flex-col overflow-hidden shadow-2xl"
        :class="fullscreen ? 'max-w-none sm:m-0' : 'max-w-5xl'"
      >
        <!-- 头部 -->
        <div class="flex items-center gap-2 border-b border-[var(--app-border)] px-4 py-3">
          <AppIcon :name="isEdit ? 'edit' : 'plus'" :size="16" />
          <h2 class="text-base font-semibold">{{ isEdit ? '编辑笔记' : '新建笔记' }}</h2>
          <span v-if="dirty" class="chip">未保存</span>
          <span class="ml-auto flex items-center gap-1 text-xs muted">
            <AppIcon name="file-text" :size="12" /> {{ words }} 字 · 约 {{ minutes }} 分钟
          </span>
          <button class="btn btn-sm" :title="fullscreen ? '退出全屏' : '全屏'" @click="fullscreen = !fullscreen">
            <AppIcon :name="fullscreen ? 'minimize' : 'maximize'" :size="13" />
          </button>
          <button class="btn btn-sm" title="关闭 (Esc)" @click="close"><AppIcon name="x" :size="13" /></button>
        </div>

        <!-- 元数据 -->
        <div class="grid gap-3 border-b border-[var(--app-border)] px-4 py-3 sm:grid-cols-[2fr,1fr]">
          <div>
            <label class="label" for="editor-title">标题</label>
            <input
              id="editor-title"
              ref="titleInput"
              v-model="title"
              class="input"
              placeholder="例如：Vue3 响应式原理笔记"
              @keydown.enter.prevent="submit"
            />
          </div>
          <div>
            <label class="label" for="editor-category">分类</label>
            <input
              id="editor-category"
              v-model="category"
              class="input"
              list="editor-category-options"
              placeholder="例如：前端部分"
            />
            <datalist id="editor-category-options">
              <option v-for="c in categories" :key="c" :value="c" />
            </datalist>
          </div>
          <div class="sm:col-span-2">
            <label class="label" for="editor-tags">标签（Enter / 逗号 添加）</label>
            <div
              class="flex flex-wrap items-center gap-1.5 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] px-2 py-1.5"
            >
              <span v-for="t in tags" :key="t" class="chip">
                #{{ t }}
                <button class="opacity-60 hover:opacity-100" @click="removeTag(t)"><AppIcon name="x" :size="11" /></button>
              </span>
              <input
                id="editor-tags"
                v-model="tagInput"
                class="min-w-[8rem] flex-1 border-0 bg-transparent p-1 text-sm outline-none"
                placeholder="vue, 源码, 面试"
                list="editor-tag-options"
                @keydown="onTagKeydown"
                @blur="commitTagInput"
              />
              <datalist id="editor-tag-options">
                <option v-for="t in knownTags" :key="t" :value="t" />
              </datalist>
            </div>
          </div>
        </div>

        <!-- 工具栏 -->
        <div class="flex flex-wrap items-center gap-1 border-b border-[var(--app-border)] px-4 py-2 text-xs">
          <button class="btn btn-sm" title="加粗" @click="insert('**', '**')"><b>B</b></button>
          <button class="btn btn-sm" title="行内代码" @click="insert('`', '`')"><span class="font-mono">{ }</span></button>
          <button class="btn btn-sm" title="引用" @click="insert('> ')">❝</button>
          <button class="btn btn-sm" title="列表" @click="insert('- ')">☰</button>
          <button class="btn btn-sm" title="任务" @click="insert('- [ ] ')">☑</button>
          <button class="btn btn-sm" title="代码块" @click="insert('\n```\n', '\n```\n')">⌘</button>
          <button class="btn btn-sm" title="链接" @click="insert('[', '](https://)')">🔗</button>
          <button class="btn btn-sm" title="表格" @click="insert('\n| 列1 | 列2 |\n| --- | --- |\n| a | b |\n')">▦</button>

          <div class="ml-auto flex items-center gap-1">
            <button class="btn btn-sm" :class="view === 'edit' && 'active'" @click="view = 'edit'">编辑</button>
            <button class="btn btn-sm" :class="view === 'preview' && 'active'" @click="view = 'preview'">预览</button>
            <button class="btn btn-sm" :class="view === 'split' && 'active'" @click="view = 'split'">分栏</button>
          </div>
        </div>

        <!-- 主体 -->
        <div class="flex min-h-0 flex-1">
          <textarea
            v-if="view !== 'preview'"
            v-model="body"
            class="editor-body"
            :class="view === 'split' ? 'w-1/2 border-r border-[var(--app-border)]' : 'w-full'"
            placeholder="在这里书写 Markdown 正文…&#10;&#10;支持 GFM：表格、任务列表、代码块、脚注链接等。"
            spellcheck="false"
          />
          <div
            v-if="view !== 'edit'"
            class="overflow-y-auto px-4 py-3"
            :class="view === 'split' ? 'w-1/2' : 'w-full'"
          >
            <MarkdownPreview :content="body" empty-text="（预览区：开始输入后实时渲染）" />
          </div>
        </div>

        <!-- 底部操作 -->
        <div class="flex flex-wrap items-center gap-2 border-t border-[var(--app-border)] px-4 py-3">
          <button v-if="isEdit" class="btn btn-danger btn-sm" :disabled="saving" @click="onDelete">
            <AppIcon name="trash" :size="13" /> 删除
          </button>
          <button
            class="btn btn-sm"
            :disabled="!body && !title"
            title="下载为 .md 文件"
            @click="downloadNote(currentDraft())"
          >
            <AppIcon name="download" :size="13" /> 下载 .md
          </button>
          <span class="text-[11px] muted">Ctrl/⌘ + S 保存</span>
          <div class="ml-auto flex gap-2">
            <button class="btn" :disabled="saving" @click="close">取消</button>
            <button class="btn btn-primary" :disabled="saving" @click="submit">
              <AppIcon :name="saving ? 'loader' : 'save'" :size="14" />
              {{ saving ? '正在提交…' : isEdit ? '保存并同步' : '创建并同步' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.card {
  max-height: 100%;
}
.editor-body {
  flex: 1;
  min-height: 16rem;
  resize: none;
  border: 0;
  outline: none;
  padding: 0.75rem 1rem;
  background: transparent;
  color: var(--app-text);
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.7;
  overflow-y: auto;
}
.btn.active {
  border-color: var(--app-accent);
  color: var(--app-accent);
  background: rgba(9, 105, 218, 0.08);
}
</style>
