<script setup>
/**
 * 导入面板：全局拖拽 + 文件选择
 * ---------------------------------------------------------------
 * - 拖拽 .md 文件到页面任意位置即可导入（支持整个文件夹递归收集）
 * - 顶部工具条的「导入」按钮通过 defineExpose 调用 pickFiles()
 */
import { onMounted, onUnmounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { useWorkspace } from '../composables/useWorkspace.js'
import { toast } from '../composables/useToast.js'

const ws = useWorkspace()

const dragging = ref(false)
const fileInput = ref(null)
let dragDepth = 0

const ACCEPT = /\.(md|markdown|txt)$/i

/* ------------------------- 文件选择 ------------------------- */

function pickFiles() {
  fileInput.value?.click()
}

async function onInputChange(e) {
  const files = Array.from(e.target.files || [])
  e.target.value = '' // 允许重复选择同一文件
  if (files.length) await ws.importFiles(files)
}

/* ------------------------- 拖拽 ------------------------- */

function hasFiles(e) {
  return Array.from(e.dataTransfer?.types || []).includes('Files')
}

function onDragEnter(e) {
  if (!hasFiles(e)) return
  dragDepth += 1
  dragging.value = true
}

function onDragOver(e) {
  if (!hasFiles(e)) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
}

function onDragLeave(e) {
  if (!hasFiles(e)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragging.value = false
}

/** 递归读取 FileSystemDirectoryEntry（拖入文件夹时使用） */
function readEntry(entry, depth = 0) {
  return new Promise((resolve) => {
    if (!entry || depth > 5) {
      resolve([])
      return
    }
    if (entry.isFile) {
      entry.file(
        (file) => {
          if (ACCEPT.test(file.name) && file.size < 8 * 1024 * 1024) resolve([file])
          else resolve([])
        },
        () => resolve([]),
      )
      return
    }
    if (entry.isDirectory) {
      const reader = entry.createReader()
      const all = []
      const readBatch = () => {
        reader.readEntries(
          async (entries) => {
            if (!entries.length) {
              const nested = await Promise.all(all.map((en) => readEntry(en, depth + 1)))
              resolve(nested.flat())
              return
            }
            all.push(...entries)
            readBatch()
          },
          () => resolve([]),
        )
      }
      readBatch()
      return
    }
    resolve([])
  })
}

async function onDrop(e) {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragDepth = 0
  dragging.value = false

  const dt = e.dataTransfer
  let files = []

  // 优先走 FileSystemEntry API：可递归处理拖入的文件夹
  const entries = Array.from(dt.items || [])
    .filter((it) => it.kind === 'file')
    .map((it) => (typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null))
    .filter(Boolean)

  if (entries.length) {
    try {
      const nested = await Promise.all(entries.map((en) => readEntry(en)))
      files = nested.flat()
    } catch {
      files = []
    }
  }

  if (!files.length) {
    files = Array.from(dt.files || []).filter((f) => ACCEPT.test(f.name))
  }

  if (!files.length) {
    toast.warn('未识别到可导入的 Markdown 文件（仅支持 .md / .markdown / .txt）')
    return
  }

  const unique = [...new Map(files.map((f) => [`${f.name}-${f.size}`, f])).values()]
  toast.info(`开始导入 ${unique.length} 个文件…`)
  await ws.importFiles(unique)
}

/* ------------------------- 生命周期 ------------------------- */

onMounted(() => {
  window.addEventListener('dragenter', onDragEnter)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('drop', onDrop)
  // 避免拖拽到页面其它区域时浏览器直接打开文件
  window.addEventListener('dragover', preventDefaultPassive)
})

onUnmounted(() => {
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('drop', onDrop)
  window.removeEventListener('dragover', preventDefaultPassive)
})

function preventDefaultPassive(e) {
  // 已在 onDragOver 中处理；此处兜底阻止浏览器默认行为
  if (hasFiles(e) && !e.defaultPrevented) e.preventDefault()
}

defineExpose({ pickFiles })
</script>

<template>
  <div>
    <input
      ref="fileInput"
      class="hidden"
      type="file"
      accept=".md,.markdown,.txt,text/markdown,text/plain"
      multiple
      @change="onInputChange"
    />

    <Transition name="fade">
      <div
        v-if="dragging"
        class="pointer-events-none fixed inset-0 z-[75] flex items-center justify-center bg-[#0969da]/12 backdrop-blur-[2px]"
      >
        <div
          class="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-[var(--app-accent)] bg-[var(--app-surface)] px-10 py-8 shadow-2xl"
        >
          <AppIcon name="upload" :size="30" class="text-[var(--app-accent)]" />
          <p class="text-sm font-semibold">松开鼠标即可导入</p>
          <p class="text-xs muted">支持 .md / .markdown / .txt，可直接拖入整个文件夹（递归收集）</p>
        </div>
      </div>
    </Transition>
  </div>
</template>
