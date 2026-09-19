/**
 * 导入 / 导出服务
 * ---------------------------------------------------------------
 * 依赖浏览器原生能力：
 *   FileReader  -> 读取本地 .md 文件
 *   Blob + a[download] -> 单篇下载
 *   JSZip       -> 全站打包导出
 */

import JSZip from 'jszip'
import { serializeNote, parseNoteFile, NOTES_DIR, slugify } from './notes.js'

/** 触发浏览器下载 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 延迟释放，Safari 需要一点时间才开始下载
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/**
 * 下载单篇笔记为 .md
 * @param {object} note
 */
export function downloadNote(note) {
  if (!note) throw new Error('没有可下载的笔记')
  const filename = `${slugify(note.title)}.md`
  downloadBlob(new Blob([serializeNote(note)], { type: 'text/markdown;charset=utf-8' }), filename)
}

/**
 * 打包全部笔记为 zip
 * @param {Array} notes
 * @param {object} [extras] 额外的 JSON 数据（checkins.json / categories.json）
 * @param {(done:number,total:number)=>void} [onProgress]
 */
export async function downloadAllAsZip(notes, extras = {}, onProgress) {
  const list = Array.isArray(notes) ? notes : []
  const zip = new JSZip()
  const folder = zip.folder(NOTES_DIR)

  list.forEach((note) => {
    const name = `${note.id}_${slugify(note.title)}.md`
    folder.file(name, serializeNote(note))
  })

  // 保留按年份-月份归档的目录结构，方便直接扔回 Obsidian 等工具
  const archive = zip.folder('archive')
  list.forEach((note) => {
    const d = new Date(note.created || note.updated || Date.now())
    if (Number.isNaN(d.getTime())) return
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    archive.folder(month).file(`${note.id}_${slugify(note.title)}.md`, serializeNote(note))
  })

  for (const [name, data] of Object.entries(extras)) {
    if (data === undefined || data === null) continue
    zip.file(name, typeof data === 'string' ? data : JSON.stringify(data, null, 2))
  }

  zip.file(
    'README.md',
    [
      '# 笔记导出包',
      '',
      `导出时间：${new Date().toLocaleString('zh-CN')}`,
      `笔记总数：${list.length}`,
      '',
      `- \`${NOTES_DIR}/\` 扁平存放全部 Markdown（含 frontmatter）`,
      '- `archive/` 按 年份-月份 归档',
      '- `checkins.json` 打卡记录',
      '- `categories.json` 分类与标签元数据',
      '',
    ].join('\n'),
  )

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, (meta) => {
    if (typeof onProgress === 'function') onProgress(Math.round(meta.percent), 100)
  })

  const stamp = new Date().toISOString().slice(0, 10)
  downloadBlob(blob, `notes-backup-${stamp}.zip`)
  return list.length
}

/**
 * 读取本地 File 对象为文本（FileReader）
 * @param {File} file
 * @returns {Promise<string>}
 */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('未选择文件'))
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      reject(new Error(`文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），建议拆分后再上传。`))
      return
    }
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`))
    reader.onabort = () => reject(new Error(`读取被中断：${file.name}`))
    reader.readAsText(file, 'utf-8')
  })
}

/**
 * 批量解析本地 .md 文件为笔记对象（不含 sha / path，由上传阶段补齐）
 * @param {FileList|File[]} files
 * @returns {Promise<{notes: Array, errors: Array<{name:string,message:string}>}>}
 */
export async function parseLocalMarkdownFiles(files) {
  const list = Array.from(files || []).filter((f) => /\.(md|markdown|txt)$/i.test(f.name))
  const notes = []
  const errors = []

  for (const file of list) {
    try {
      const raw = await readFileAsText(file)
      const note = parseNoteFile({ path: `${NOTES_DIR}/${file.name}`, sha: '', size: file.size }, raw)
      if (!note.title || note.title === '未命名笔记') {
        note.title = file.name.replace(/\.(md|markdown|txt)$/i, '')
      }
      note.source = file.name
      notes.push(note)
    } catch (err) {
      errors.push({ name: file.name, message: err?.message || String(err) })
    }
  }

  if (!list.length) errors.push({ name: '-', message: '未找到任何 .md / .markdown 文件' })
  return { notes, errors }
}
