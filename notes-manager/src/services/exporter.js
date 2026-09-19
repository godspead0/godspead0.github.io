/**
 * 导出服务（只读）
 * ---------------------------------------------------------------
 * 依赖浏览器原生能力：
 *   Blob + a[download] -> 单篇下载
 *   JSZip              -> 全站打包导出
 *
 * 导入相关的能力（FileReader 读本地 .md、解析成笔记对象）已随只读改造移除 ——
 * 站点不写入任何仓库。
 */

import JSZip from 'jszip'
import { serializeNote, slugify } from './notes.js'

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
 * 笔记在导出包里的相对路径。
 * ---------------------------------------------------------------
 * 以前是把**所有**笔记扁平塞进一个写死的 `全栈/` 目录 ——
 * 现在有两个分类（技术 / 算法），那样会让算法笔记也躺在 `全栈/` 下，
 * 既名不副实又可能撞名。改成按分类建顶层目录，并保留原有的分类子文件夹结构。
 * @returns {{top: string, rel: string}} top = 顶层目录（分类名），rel = 其下的相对路径
 */
export function zipEntryPath(note) {
  const top = note.vaultLabel || note.vault || 'notes'
  // note.path 形如 `全栈/前端部分/Vue.md`；剥掉笔记目录前缀，避免出现 `技术/全栈/...`
  let rel = note.path || `${note.id}_${slugify(note.title)}.md`
  const dir = note.vaultNotesDir
  if (dir && (rel === dir || rel.startsWith(`${dir}/`))) {
    rel = rel === dir ? '' : rel.slice(dir.length + 1)
  }
  if (!rel) rel = `${note.id}_${slugify(note.title)}.md`
  return { top, rel }
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

  // 按分类（技术 / 算法）保留原有目录结构，方便直接扔回 Obsidian 等工具
  const tops = new Set()
  list.forEach((note) => {
    const { top, rel } = zipEntryPath(note)
    let folder = zip.folder(top)
    const slash = rel.lastIndexOf('/')
    if (slash > 0) folder = folder.folder(rel.slice(0, slash))
    folder.file(rel.slice(slash + 1), serializeNote(note))
    tops.add(top)
  })

  // 另存一份按年份-月份归档的结构
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
      ...[...tops].map((t) => `- \`${t}/\` 该分类下的 Markdown（含 frontmatter，保留原目录结构）`),
      '- `archive/` 按 年份-月份 归档（扁平）',
      '- `checkins.json` 打卡记录（若存在）',
      '- `categories.json` 分类与标签元数据（若存在）',
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
