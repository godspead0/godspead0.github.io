/**
 * 冒烟测试（无浏览器环境）
 * ---------------------------------------------------------------
 * 运行： npm run smoke
 *
 * 覆盖：
 *   1. 服务层纯函数：UTF-8 Base64 往返、frontmatter 解析/序列化、slug、日期键
 *   2. Fuse.js 搜索与筛选逻辑（useSearch）
 *   3. 整棵组件树的 SSR 渲染（能捕获模板/响应式引用类运行时错误）
 *
 * 说明：SSR 仅用于"能否渲染"的静态校验，不代替浏览器端人工验收。
 */

/* ------------------------- 浏览器 API 垫片 ------------------------- */

const memory = new Map()
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
  clear: () => memory.clear(),
  key: (i) => [...memory.keys()][i] ?? null,
  get length() {
    return memory.size
  },
}

const noop = () => {}
const fakeEl = () => ({
  style: {},
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  setAttribute: noop,
  appendChild: noop,
  removeChild: noop,
  remove: noop,
  click: noop,
  focus: noop,
  select: noop,
})

globalThis.window = globalThis
globalThis.document = {
  documentElement: { classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, style: {} },
  body: { appendChild: noop, removeChild: noop },
  createElement: fakeEl,
  addEventListener: noop,
  removeEventListener: noop,
  activeElement: null,
}
globalThis.window.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop })
globalThis.window.addEventListener = noop
globalThis.window.removeEventListener = noop
// Node 24 的 navigator 是只读 getter，需用 defineProperty 覆盖
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async () => {} } },
    configurable: true,
    writable: true,
  })
} catch {
  /* 忽略：已有 navigator 也能运行 */
}

/* ------------------------- 断言工具 ------------------------- */

let passed = 0
const failures = []

function check(name, condition, extra = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(`${name}${extra ? ` — ${extra}` : ''}`)
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

/* ------------------------- 启动 Vite SSR 环境 ------------------------- */

const { createServer } = await import('vite')

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'warn',
})

try {
  const load = (p) => server.ssrLoadModule(p)

  console.log('\n[1] 服务层纯函数')
  const gh = await load('/src/services/github.js')
  const notesSvc = await load('/src/services/notes.js')
  const fm = await load('/src/services/frontmatter.js')

  const cn = '# 中文标题 🎉\n\n正文：你好，世界！'
  check('UTF-8 -> Base64 -> UTF-8 往返一致（中文/emoji）', gh.base64ToUtf8(gh.utf8ToBase64(cn)) === cn)

  const raw = ['---', 'id: "1700000000000"', 'title: "Vue3 笔记"', 'category: 前端部分', 'tags: [vue, 源码, "响应式"]', 'created: 2026-09-01T10:00:00.000Z', '---', '', '# 标题', '', '正文内容'].join('\n')
  const { meta, body } = fm.parseFrontmatter(raw)
  check('frontmatter 解析 title', meta.title === 'Vue3 笔记')
  check('frontmatter 解析行内数组 tags', Array.isArray(meta.tags) && meta.tags.length === 3, JSON.stringify(meta.tags))
  check('frontmatter 拆出正文', body.includes('正文内容') && !body.includes('---'))

  const note = notesSvc.parseNoteFile({ path: '全栈/1700000000000_Vue3-笔记.md', sha: 'abc', size: raw.length }, raw)
  check('parseNoteFile 从路径兜底 id', note.id === '1700000000000')
  const roundTrip = notesSvc.parseNoteFile({ path: note.path, sha: 'x' }, notesSvc.serializeNote(note))
  check(
    '序列化 -> 再解析 保持标题/分类/标签',
    roundTrip.title === note.title && roundTrip.category === note.category && roundTrip.tags.join() === note.tags.join(),
  )

  check('slugify 保留中文并转义空白', notesSvc.slugify('Docker 中间件 / 笔记') === 'Docker-中间件-笔记', notesSvc.slugify('Docker 中间件 / 笔记'))
  check('buildPath 结构为 全栈/{id}_{slug}.md', /^全栈\/\d+_.+\.md$/.test(notesSvc.buildPath('1700000000000', '标题')))
  check('normalizeTags 去重去 #', notesSvc.normalizeTags('#Vue, vue，源码').join() === 'Vue,源码')
  check('toDateKey 生成 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(notesSvc.toDateKey(new Date(2026, 8, 5))))
  check('formatArchiveLabel 生成 2026年9月', notesSvc.formatArchiveLabel('2026-09') === '2026年9月')

  // ---- 兼容既有笔记：无 frontmatter、直接按分类文件夹存放 ----
  const legacyRaw = '# **主题**：Vue 全家桶\n\n正文内容'
  const legacyFile = { path: '全栈/前端部分/Vue.md', sha: 'l1', size: legacyRaw.length }
  const legacy = notesSvc.parseNoteFile(legacyFile, legacyRaw)
  check('历史笔记：用文件夹名兜底为分类', legacy.category === '前端部分', legacy.category)
  check('历史笔记：标题取正文首个标题（并清理 Markdown 标记）', legacy.title === '主题：Vue 全家桶', legacy.title)
  check('历史笔记：id 由路径稳定派生（多次解析一致）', !!legacy.id && legacy.id === notesSvc.parseNoteFile(legacyFile, legacyRaw).id, legacy.id)
  check('历史笔记：不同路径得到不同 id', legacy.id !== notesSvc.parseNoteFile({ path: '全栈/后端部分/Java.md', sha: 'l2' }, legacyRaw).id)
  check('历史笔记：判定为非托管命名（不跟随标题改名）', notesSvc.isManagedPath(legacyFile.path) === false)
  check('托管命名：全栈/{id}_{slug}.md 判定为 true', notesSvc.isManagedPath('全栈/1700000000000_Vue.md') === true)
  check('嵌套分类：全栈/后端部分/spring框架/SpringBoot.md 归类为 后端部分', notesSvc.categoryFromPath('全栈/后端部分/spring框架/SpringBoot.md') === '后端部分')
  check('笔记目录下的散装 .md 不产生分类', notesSvc.categoryFromPath('全栈/术语解释.md') === '')

  // ---- 标题兜底：原先只认一级 "#"，导致 44/93 篇笔记显示「未命名笔记」 ----
  const T = (body, path = '全栈/x.md') => notesSvc.parseNoteFile({ path, sha: 's' }, body).title
  check('标题兜底：二级标题 ## 能识别', T('## 核心前提：先明确本质\n正文') === '核心前提：先明确本质')
  check('标题兜底：四级标题 #### 能识别', T('#### Java性质\n正文') === 'Java性质')
  check('标题兜底：HTML 标题 <h1> 能识别', T('<h1>redis集群</h1>\n正文') === 'redis集群')
  check('标题兜底：跳过 [toc] 取真正的标题', T('[toc]\n\n# 真实标题\n正文') === '真实标题')
  check('标题兜底：跳过独立的 "#" 取下一个标题', T('#\n## 次级标题\n正文') === '次级标题')
  check('标题兜底：清理标题里的 Markdown 强调符', T('## **加粗**标题') === '加粗标题')
  check('标题兜底：空文件用文件名（0 字节占位文件）', T('', '全栈/语言部分/Rust.md') === 'Rust')
  check('标题兜底：空文件用文件名（中文）', T('   \n\n', '全栈/前端总结.md') === '前端总结')
  check('标题兜底：文件名去掉托管 id 前缀', T('', '全栈/1758000000000_示例笔记.md') === '示例笔记')
  check('标题兜底：文件名为空(.md)时用上级目录', T('', '全栈/一些个人理解/.md') === '一些个人理解')
  check('标题兜底：文件名优先于正文首行猜测', T('大家在连接mysql的时候会警告你', '全栈/其他/网络部分.md') === '网络部分')
  check('标题兜底：无文件名时才用正文首行', T('你在连接mysql时会收到警告', '') === '你在连接mysql时会收到警告')
  check('标题兜底：正文首行的链接只保留文字', T('[Java：IO流详解](https://example.com/a)', '') === 'Java：IO流详解')
  check('标题兜底：跳过代码围栏，取围栏后的正文首行', T('```plaintext\n代码\n```\n\n真正的第一行', '') === '真正的第一行')
  check('标题兜底：围栏内的 # 注释不算标题', T('```bash\n# 这不是标题\n```\n\n## 这才是标题', '全栈/示例.md') === '这才是标题')
  check('标题兜底：围栏未闭合时其后内容全部忽略', T('```plaintext\n# 看起来像标题', '全栈/占位.md') === '占位')
  check('标题兜底：极端情况下才出现「未命名笔记」', T('', '') === '未命名笔记')

  // ---- 跨刷新缓存（localStorage）：首屏秒开的数据来源 ----
  const notesApi = (await load('/src/composables/useNotes.js')).useNotes()
  const cachedNote = {
    id: 'c1',
    title: '缓存里的标题',
    path: '全栈/缓存.md',
    sha: 'sha-c1',
    body: '缓存正文',
    category: '前端部分',
    tags: ['vue'],
    created: '2026-09-01T00:00:00.000Z',
    updated: '2026-09-01T00:00:00.000Z',
  }
  const putCache = (payload) => localStorage.setItem('notes-manager.notes.v1', JSON.stringify(payload))

  localStorage.removeItem('notes-manager.notes.v1')
  check('无缓存时 hydrateFromCache 返回 0', notesApi.hydrateFromCache() === 0)

  putCache({ v: 1, savedAt: '2026-09-19T08:00:00.000Z', lite: false, notes: [cachedNote] })
  const restored = notesApi.hydrateFromCache()
  check('有缓存时恢复全部笔记', restored === 1 && notesApi.notes.value.length === 1, `恢复了 ${restored} 篇`)
  check('恢复的笔记内容完整（含正文）', notesApi.notes.value[0]?.body === '缓存正文')
  check('恢复后标记为「来自缓存」', notesApi.hydratedFromCache.value === true)

  putCache({ v: 1, savedAt: 'x', lite: true, notes: [cachedNote] })
  check('lite 精简缓存同样能恢复列表', notesApi.hydrateFromCache() === 1)

  putCache({ v: 99, savedAt: 'x', notes: [cachedNote] })
  notesApi.notes.value = []
  check('版本不匹配的缓存被忽略', notesApi.hydrateFromCache() === 0)

  localStorage.setItem('notes-manager.notes.v1', '{这不是合法 JSON')
  notesApi.notes.value = []
  check('损坏的缓存被安全忽略（不抛异常）', notesApi.hydrateFromCache() === 0)

  notesApi.invalidateCache()
  check('invalidateCache 同时清掉 localStorage', localStorage.getItem('notes-manager.notes.v1') === null)
  notesApi.notes.value = []
  notesApi.hydratedFromCache.value = false

  // ---- 安全：清除凭据必须连笔记正文缓存一起抹掉 ----
  putCache({ v: 1, savedAt: 'x', lite: false, notes: [cachedNote] })
  notesApi.hydrateFromCache()
  check('purge 前缓存中确实含笔记正文', notesApi.notes.value[0]?.body === '缓存正文')
  notesApi.purge()
  check('purge 清空内存中的笔记列表', notesApi.notes.value.length === 0)
  check('purge 抹掉 localStorage 里的笔记正文', localStorage.getItem('notes-manager.notes.v1') === null)
  check('purge 重置同步时间与缓存标记', notesApi.lastSyncAt.value === '' && notesApi.hydratedFromCache.value === false)
  check('purge 后无法再从缓存恢复', notesApi.hydrateFromCache() === 0)

  // ---- 安全：仓库指纹变化时不得展示上一个仓库的缓存 ----
  putCache({ v: 1, savedAt: 'x', lite: false, sig: 'tech:some-user/other-repo@main/notes', notes: [cachedNote] })
  notesApi.notes.value = []
  check('仓库指纹不一致时丢弃缓存', notesApi.hydrateFromCache() === 0)
  check('被判定为异仓库的缓存已被删除', localStorage.getItem('notes-manager.notes.v1') === null)

  // 无 sig 字段的历史缓存仍需兼容（不能因为升级而丢数据）
  putCache({ v: 1, savedAt: 'x', lite: false, notes: [cachedNote] })
  check('无 sig 字段的旧缓存仍可恢复（向后兼容）', notesApi.hydrateFromCache() === 1)

  // ---- 安全：打卡缓存也要能被抹掉 ----
  const checkinsApi = (await load('/src/composables/useCheckins.js')).useCheckins()
  localStorage.setItem('notes-manager.checkins.cache', JSON.stringify({ '2026-09-19': 3 }))
  checkinsApi.hydrateFromCache()
  check('purge 前打卡缓存已载入', checkinsApi.totalCheckins.value === 3)
  checkinsApi.purge()
  check('purge 抹掉 localStorage 里的打卡记录', localStorage.getItem('notes-manager.checkins.cache') === null)
  check('purge 清空内存中的打卡数据', checkinsApi.totalCheckins.value === 0)

  notesApi.purge()
  localStorage.removeItem('notes-manager.notes.v1')

  console.log('\n[2] 搜索 / 筛选 / 排序（Fuse.js）')
  const { useSearch } = await load('/src/composables/useSearch.js')
  const { ref } = await import('vue')

  const list = ref([
    notesSvc.createNote({ id: '1', title: 'Vue3 响应式原理', category: '前端部分', tags: ['vue'], body: 'ref 与 reactive 的区别', created: '2026-09-01T00:00:00.000Z' }),
    notesSvc.createNote({ id: '2', title: 'Redis 持久化', category: '中间件部分', tags: ['redis'], body: 'RDB 与 AOF', created: '2026-08-01T00:00:00.000Z' }),
    notesSvc.createNote({ id: '3', title: 'Docker 网络', category: '中间件部分', tags: [], body: 'bridge host none', created: '2026-09-15T00:00:00.000Z' }),
  ])

  const s = useSearch(list)
  check('默认按更新时间倒序返回全部', s.results.value.length === 3)

  s.keyword.value = 'vue'
  check('关键词全文检索命中 1 篇', s.results.value.length === 1 && s.results.value[0].id === '1', `实际 ${s.results.value.length} 篇`)

  s.keyword.value = 'RDB'
  check('关键词可命中正文内容', s.results.value.length === 1 && s.results.value[0].id === '2')
  s.keyword.value = ''

  s.selectCategory('中间件部分')
  check('分类筛选命中 2 篇', s.results.value.length === 2, `实际 ${s.results.value.length}`)
  s.selectCategory('中间件部分')
  check('再次点击分类可取消筛选', s.results.value.length === 3)

  s.toggleTag('redis')
  check('标签筛选命中 1 篇', s.results.value.length === 1)
  s.toggleTag('redis')

  s.activeMonth.value = '2026-09'
  check('归档月份筛选命中 2 篇', s.results.value.length === 2, `实际 ${s.results.value.length}`)
  s.activeMonth.value = ''

  s.toggleSort('title')
  check('按标题升序时 Docker 排首位', s.sortBy.value === 'title' && s.sortOrder.value === 'asc' && s.results.value[0].id === '3')

  check('分类树统计计数正确', s.categoryTree.value.length === 2 && s.categoryTree.value.every((c) => c.count > 0))
  check('标签树去重统计正确', s.tagTree.value.length === 2)
  check('时间线归档按年月分组', s.archiveTree.value.length === 2 && s.archiveTree.value[0].key === '2026-09')
  check('活跃筛选状态可识别', (s.clearFilters(), s.hasActiveFilter.value === false))

  /* 2.9 多仓库（技术 / 算法）：一级分类 */
  check('buildPath 默认写入 全栈/ 目录', notesSvc.buildPath('1', '标题') === '全栈/1_标题.md')
  check('buildPath 支持仓库根目录（算法仓库）', notesSvc.buildPath('1', '标题', '') === '1_标题.md')
  check('buildPath 支持自定义目录', notesSvc.buildPath('1', '标题', '算法') === '算法/1_标题.md')
  check('buildPath 容错首尾斜杠', notesSvc.buildPath('1', '标题', '/算法/') === '算法/1_标题.md')

  const vaultNotes = ref([
    notesSvc.createNote({ id: 'v1', title: 'MySQL 索引', category: '数据库部分', tags: ['mysql'], body: 'B+ 树', created: '2026-09-01T00:00:00.000Z' }),
    notesSvc.createNote({ id: 'v2', title: '二分查找', category: '力扣', tags: ['二分'], body: 'log n', created: '2026-09-02T00:00:00.000Z' }),
    notesSvc.createNote({ id: 'v3', title: '最短路', category: '洛谷', tags: ['图论'], body: 'dijkstra', created: '2026-09-03T00:00:00.000Z' }),
  ])
  vaultNotes.value[0].vault = 'tech'
  vaultNotes.value[0].vaultLabel = '技术'
  vaultNotes.value[1].vault = 'algo'
  vaultNotes.value[1].vaultLabel = '算法'
  vaultNotes.value[2].vault = 'algo'
  vaultNotes.value[2].vaultLabel = '算法'

  const vs = useSearch(vaultNotes)
  check('仓库树聚合出技术/算法两项', vs.vaultTree.value.length === 2, `实际 ${vs.vaultTree.value.length}`)
  check('仓库树统计各仓库笔记数', vs.vaultTree.value.find((v) => v.id === 'algo')?.count === 2)
  check('仓库树带出中文标签', vs.vaultTree.value.find((v) => v.id === 'tech')?.label === '技术')

  vs.selectVault('algo')
  check('选中算法仓库后只剩 2 篇', vs.results.value.length === 2, `实际 ${vs.results.value.length}`)
  check('仓库筛选联动分类树（不混入技术分类）', vs.categoryTree.value.every((c) => c.name !== '数据库部分'))
  check('仓库筛选计入活跃筛选状态', vs.hasActiveFilter.value === true)
  check('仓库筛选联动标签树', vs.tagTree.value.every((t) => t.name !== 'mysql'))
  vs.selectVault('algo')
  check('再次点击仓库可取消筛选', vs.results.value.length === 3 && vs.activeVault.value === '')

  vs.selectVault('tech')
  check('切到技术仓库只剩 1 篇', vs.results.value.length === 1 && vs.results.value[0].id === 'v1')
  vs.clearFilters()
  check('清除筛选同时重置仓库维度', vs.activeVault.value === '')
  check('无 vault 字段的笔记不进仓库树', useSearch(ref([notesSvc.createNote({ id: 'x', title: '裸笔记' })])).vaultTree.value.length === 0)

  console.log('\n[3] 组件树 SSR 渲染')
  const { createSSRApp } = await import('vue')
  const { renderToString } = await import('vue/server-renderer')
  const App = (await load('/src/App.vue')).default
  const { useWorkspace } = await load('/src/composables/useWorkspace.js')
  const ws = useWorkspace()

  const warnings = []
  async function renderApp() {
    const app = createSSRApp(App)
    app.config.warnHandler = (msg) => warnings.push(msg)
    app.config.errorHandler = (err) => warnings.push(String(err?.message || err))
    return renderToString(app)
  }

  /* 3.1 访客默认状态：站点默认指向公开展示仓库，打开即能看到内容 */
  let html = await renderApp()
  check('根组件渲染出顶栏标题', html.includes('笔记收纳与打卡'))
  check('渲染出搜索框', html.includes('搜索标题'))
  check('渲染出打卡热力图组件', html.includes('打卡热力图'))

  /* 公开展示仓库是**刻意公开**的，所以名字写在代码里没问题 ——
     访客没有任何配置，只能靠这份默认值匿名读取。
     这里不写死具体名字，而是拿模块自己的默认值来断言，避免测试与实现脱节。 */
  const pubOwner = ws.config.vaults.value[0].owner
  const pubRepo = ws.config.vaults.value[0].repo
  check('默认已指向公开展示仓库（访客无需任何配置）', Boolean(pubOwner && pubRepo) && ws.config.configured.value)
  check(
    '两个页签共用同一公开仓库的不同子目录',
    ws.config.vaults.value.every((v) => v.owner === pubOwner && v.repo === pubRepo && v.notesDir),
  )
  check('访客顶栏显示公开展示仓库', html.includes(`${pubOwner}/${pubRepo}`))
  check('访客顶栏带「只读」标记', html.includes('只读'))
  check('访客无需配置 → 不自动弹出连接设置', !html.includes('连接 GitHub 数据仓库'))
  check('访客默认不含 Token（匿名只读）', ws.config.vaults.value.every((v) => !v.token))
  check('访客处于只读模式', ws.config.readOnly.value === true && ws.config.writable.value === false)
  check('只读模式下仍保留同步入口', html.includes('同步'))
  check('未配置时列表引导同步/新建', html.includes('还没有同步到任何笔记'))

  /* 只读模式必须在服务层就拦住写操作，而不是等 GitHub 回 403 */
  const ghMod = await load('/src/services/github.js')
  let roErr = null
  try {
    await ghMod.saveFile('全栈/不该被写进去.md', 'x', '', 'test', ws.config.vaults.value[0])
  } catch (e) {
    roErr = e
  }
  check('只读模式下写文件被拒绝', roErr && roErr.code === 'NO_TOKEN')
  let roDel = null
  try {
    await ghMod.deleteFile('全栈/不该被删掉.md', 'deadbeef', 'test', ws.config.vaults.value[0])
  } catch (e) {
    roDel = e
  }
  check('只读模式下删文件被拒绝', roDel && roDel.code === 'NO_TOKEN')

  /* 配置弹窗默认不弹出；手动打开后仍应有技术/算法两个页签 */
  ws.config.openModal()
  html = await renderApp()
  check('打开设置后渲染连接弹窗', html.includes('连接 GitHub 数据仓库'))
  check(
    '配置弹窗渲染技术/算法两个仓库页签',
    html.includes('笔记目录（留空 = 仓库根目录）') && html.includes('技术') && html.includes('算法'),
  )
  ws.config.showModal.value = false

  /* 清空仓库 → 顶栏回到「未配置仓库」 */
  const savedVaults = ws.config.vaults.value.map((v) => ({ ...v }))
  ws.config.vaults.value.forEach((v) => {
    v.owner = ''
    v.repo = ''
  })
  html = await renderApp()
  check('清空仓库后顶栏回到「未配置仓库」', html.includes('未配置仓库'))
  savedVaults.forEach((v, i) => Object.assign(ws.config.vaults.value[i], v))

  /* 后续断言需要一个「已连接」的仓库。
     用虚构的 owner/repo —— 真实仓库名不该出现在这个公开仓库的源码里。 */
  const [techVault, algoVault] = ws.config.vaults.value
  Object.assign(techVault, {
    owner: 'octocat',
    repo: 'my-tech-notes',
    branch: 'main',
    token: 'ghp_dummy_for_render',
    notesDir: 'notes',
  })
  Object.assign(algoVault, {
    owner: 'octocat',
    repo: 'my-algo-notes',
    branch: 'main',
    token: 'ghp_dummy_for_render',
    notesDir: '',
  })
  html = await renderApp()
  check('配置两个仓库后顶栏显示两个仓库标签', html.includes('技术 + 算法'))

  /* 3.2 注入数据：列表 / 侧栏筛选树 / 归档 / 仪表盘 */
  ws.config.showModal.value = false
  ws.notes.value = [
    notesSvc.createNote({
      id: '1',
      title: 'Vue3 响应式原理',
      category: '前端部分',
      tags: ['vue', '源码'],
      body: '# 响应式\n\nref 与 reactive 的区别',
      created: '2026-09-01T00:00:00.000Z',
      updated: '2026-09-02T00:00:00.000Z',
      path: 'notes/1_a.md',
      sha: 'a1',
    }),
    notesSvc.createNote({
      id: '2',
      title: 'Redis 持久化',
      category: '中间件部分',
      tags: ['redis'],
      body: 'RDB 与 AOF',
      created: '2026-08-20T00:00:00.000Z',
      updated: '2026-08-21T00:00:00.000Z',
      path: 'notes/2_b.md',
      sha: 'a2',
    }),
    notesSvc.createNote({
      id: '3',
      title: 'Docker 网络',
      category: '',
      tags: [],
      body: 'bridge host none',
      created: '2026-09-15T00:00:00.000Z',
      updated: '2026-09-16T00:00:00.000Z',
      path: 'notes/3_c.md',
      sha: 'a3',
    }),
  ]
  ws.checkins.data.value = { [notesSvc.toDateKey()]: 3, '2026-09-01': 2 }

  // 打上多仓库标记：1/2 来自技术仓库，3 来自算法仓库
  ws.notes.value[0].vault = 'tech'
  ws.notes.value[0].vaultLabel = '技术'
  ws.notes.value[1].vault = 'tech'
  ws.notes.value[1].vaultLabel = '技术'
  ws.notes.value[2].vault = 'algo'
  ws.notes.value[2].vaultLabel = '算法'

  html = await renderApp()
  check('列表渲染出笔记卡片', html.includes('Vue3 响应式原理') && html.includes('Redis 持久化'))
  check('侧栏渲染分类树', html.includes('前端部分') && html.includes('中间件部分'))
  check('侧栏渲染仓库（技术/算法）一级分类', html.includes('仓库') && html.includes('技术') && html.includes('算法'))
  const algoHits = (html.match(/算法/g) || []).length
  check('算法笔记带仓库徽章（侧栏 + 卡片）', algoHits >= 2, `实际 ${algoHits} 处`)
  check('侧栏渲染时间线归档「2026年9月」', html.includes('2026年9月'))
  check('侧栏渲染未分类分组', html.includes('未分类'))
  check('侧栏渲染标签云', html.includes('#vue') && html.includes('#redis'))
  check('仪表盘渲染打卡统计', html.includes('今日打卡') && html.includes('连续'))
  check(
    '统计卡片展示笔记总数/字数',
    html.includes('笔记总数') && html.includes('正文字数') && html.includes('最长连续'),
  )
  const rects = (html.match(/<rect/g) || []).length
  check('热力图渲染出着色单元格', /class="[^"]*lvl-[1-4]/.test(html))
  check('热力图近 26 周共 182 个单元格', rects === 26 * 7, `实际 ${rects} 个`)

  /* 3.3 编辑器弹窗 */
  ws.openCreate()
  html = await renderApp()
  check(
    '新建笔记弹窗渲染完整表单',
    html.includes('新建笔记') && html.includes('标签（Enter / 逗号 添加）') && html.includes('创建并同步'),
  )
  check('新建笔记可选保存到的仓库', html.includes('保存到仓库') && html.includes('my-algo-notes'))
  ws.closeEditor()

  ws.openEdit(ws.notes.value[1])
  html = await renderApp()
  check('编辑模式回填标题与操作按钮', html.includes('Redis 持久化') && html.includes('保存并同步') && html.includes('删除'))
  ws.closeEditor()

  /* 3.4 阅读视图（Markdown 渲染管线） */
  ws.detailNote.value = ws.notes.value[0]
  html = await renderApp()
  check('阅读视图渲染 Markdown 容器', html.includes('markdown-body'))
  check('阅读视图提供「在 GitHub 查看」入口', html.includes('在 GitHub 查看'))
  check('输出中不含可执行的 script 标签', !/<script[\s>]/i.test(html))
  ws.detailNote.value = null

  /* 3.5 搜索命中与空态 */
  s.keyword.value = 'zzz-不存在的关键词-zzz'
  html = await renderApp()
  check('无匹配时渲染空态提示', html.includes('没有匹配的笔记'))
  s.clearFilters()

  check('全流程渲染无 Vue 警告/错误', warnings.length === 0, warnings.slice(0, 3).join(' | '))

  console.log('\n[4] Markdown 渲染与 XSS 防护')
  const mdSvc = await load('/src/services/markdown.js')
  const evil = '<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>\n\n[链接](javascript:alert(3))'
  const safeOut = mdSvc.renderMarkdown(evil)
  check('输出中不残留 <script> 标签', !/<script[\s>]/i.test(safeOut))
  check('输出中不残留内联事件处理器', !/<[a-z][^>]*\son[a-z]+\s*=/i.test(safeOut))
  check('输出中不残留 javascript: 链接', !/href\s*=\s*["']?\s*javascript:/i.test(safeOut))
  check('无 DOM 环境下按纯文本降级（fail-closed）', mdSvc.canSanitize || /&lt;img/.test(safeOut))
  check('toPlainText 剥离 Markdown 语法', mdSvc.toPlainText('## 标题\n\n- a\n- b') === '标题 a b', mdSvc.toPlainText('## 标题\n\n- a\n- b'))
  check('readingMinutes 最少返回 1 分钟', mdSvc.readingMinutes('短') === 1)

  console.log('\n[5] GitHub REST API 错误映射（可选联网检查）')
  if (!process.env.SMOKE_NETWORK) {
    console.log('  - 已跳过（设置 SMOKE_NETWORK=1 可开启，会向 api.github.com 发起 1 次请求）')
  } else {
    gh.setConfig({ owner: 'octocat', repo: 'my-tech-notes', branch: 'main', token: 'ghp_invalid_token_for_smoke' })
    try {
      await gh.testConnection()
      check('无效 Token 应被拒绝', false, '请求竟然成功了')
    } catch (err) {
      if (err?.code === 'NETWORK_ERROR' || err?.code === 'TIMEOUT') {
        console.log(`  - 已跳过（无法访问 api.github.com：${err.message}）`)
      } else {
        check('无效 Token 归一化为 BAD_CREDENTIALS', err?.code === 'BAD_CREDENTIALS' || err?.status === 401, `${err?.code}/${err?.status}`)
        check('错误信息为中文可读提示', /Token/.test(err?.message || ''), err?.message)
      }
    } finally {
      gh.clearConfig()
    }
  }

  console.log(`\n结果：${passed} 项通过，${failures.length} 项失败`)
  if (failures.length) {
    console.log('失败明细：')
    failures.forEach((f) => console.log(`  - ${f}`))
  }
} finally {
  await server.close()
}

process.exitCode = failures.length ? 1 : 0

// 联网检查会留下 undici 的 keep-alive 连接，短暂延时后强制收敛退出，
// 避免 Node 在句柄关闭过程中触发 libuv 断言。
setTimeout(() => process.exit(process.exitCode ?? 0), 300)
