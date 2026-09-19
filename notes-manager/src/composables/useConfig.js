/**
 * 连接配置 Composable（多数据仓库）
 * ---------------------------------------------------------------
 * 每个 vault 对应一个 GitHub 数据仓库（Owner / Repo / Branch / Token / notesDir）：
 *   - 技术：一个私有仓库的 全栈/ 子目录
 *   - 算法：另一个私有仓库的根目录
 *
 * 仓库名等具体值刻意不写进代码（见 defaultVaults 注释）。
 *
 * - vaults    ：全部仓库配置（localStorage 持久化，自动从旧单仓库配置迁移）
 * - form      ：连接设置弹窗里正在编辑的那个仓库
 * - activeVault：新建笔记写入的仓库
 * - primaryVault：打卡记录 / 分类元数据所在的主仓库（第一个已配置的）
 */
import { computed, reactive, ref } from 'vue'
import { DEFAULT_CONFIG, GithubError, setConfig, testConnection } from '../services/github.js'
import { toast } from './useToast.js'

const STORAGE_KEY = 'notes-manager.vaults.v3'
const LEGACY_KEY = 'notes-manager.config.v1'

/**
 * 站点默认指向的**公开展示仓库**。
 * ---------------------------------------------------------------
 * 这是个刻意公开的仓库：里面只有笔记的 Markdown 副本，
 * 你的私有工作区（含 .cpp / origin/ 等）不在这里。
 *
 * 因为仓库是公开的，所以名字写在代码里没有问题，反而必须写 ——
 * 访客打开网站时没有任何配置，只能靠这份默认值去匿名读取并展示内容。
 *
 * Token 一律留空：访客不带凭据匿名读（走 raw CDN）；
 * 你自己在浏览器里补填 Token 后就切换成可写模式。
 */
const PUBLIC_OWNER = 'godspead0'
const PUBLIC_REPO = 'godspead0_notes'
const PUBLIC_BRANCH = 'main'

function defaultVaults() {
  return [
    { id: 'tech', label: '技术', owner: PUBLIC_OWNER, repo: PUBLIC_REPO, branch: PUBLIC_BRANCH, token: '', notesDir: '全栈' },
    { id: 'algo', label: '算法', owner: PUBLIC_OWNER, repo: PUBLIC_REPO, branch: PUBLIC_BRANCH, token: '', notesDir: '算法' },
  ]
}

/** 读取 vaults；兼容旧的单仓库配置（notes-manager.config.v1） */
function loadVaults() {
  const defaults = defaultVaults()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((v, i) => ({ ...(defaults[i] || {}), ...v }))
      }
    }
  } catch {
    /* 损坏数据按未配置处理 */
  }
  // 迁移旧版单仓库配置
  try {
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const old = JSON.parse(legacy)
      if (old && old.owner && old.repo) {
        const vaults = defaultVaults()
        vaults[0] = {
          ...vaults[0],
          owner: old.owner,
          repo: old.repo,
          branch: old.branch || 'master',
          token: old.token || '',
        }
        return vaults
      }
    }
  } catch {
    /* 忽略 */
  }
  return defaults
}

const vaults = ref(loadVaults())
const editingVaultIdx = ref(0)
const activeVaultIdx = ref(0)

/** 弹窗表单：始终反映「正在编辑的仓库」 */
const form = reactive({ ...(vaults.value[editingVaultIdx.value] || vaults.value[0]) })

const editingVault = computed(() => vaults.value[editingVaultIdx.value] || vaults.value[0])
const activeVault = computed(() => vaults.value[activeVaultIdx.value] || vaults.value[0])
/**
 * 打卡 / 分类元数据所在的主仓库 = 第一个**可写**（填了 Token）的仓库。
 * 访客没有 Token，因此回退到第一个已配置仓库；此时只读，界面会禁用写操作。
 */
const primaryVault = computed(
  () =>
    vaults.value.find((v) => v.token && v.owner && v.repo) ||
    vaults.value.find((v) => v.owner && v.repo) ||
    vaults.value[0],
)
/** 有 Owner/Repo 即可读取（公开仓库允许匿名读），Token 不再是必需项 */
const configured = computed(() => vaults.value.some((v) => v.owner && v.repo))
/** 是否可写：至少有一个仓库填了 Token */
const writable = computed(() => vaults.value.some((v) => v.token && v.owner && v.repo))
/** 只读模式（访客）：能看，不能改 */
const readOnly = computed(() => configured.value && !writable.value)

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(vaults.value))
  } catch {
    /* 隐私模式忽略 */
  }
}

/** 把 form 写回正在编辑的 vault */
function syncFormToVault() {
  Object.assign(editingVault.value, { ...form })
}

/** 弹窗切换编辑目标仓库 */
function switchVault(idx) {
  syncFormToVault()
  editingVaultIdx.value = Math.max(0, Math.min(Number(idx) || 0, vaults.value.length - 1))
  Object.assign(form, { ...vaults.value[editingVaultIdx.value] })
}

/** 设置「新建笔记写入哪个仓库」 */
function setActiveVault(idx) {
  activeVaultIdx.value = Math.max(0, Math.min(Number(idx) || 0, vaults.value.length - 1))
}

/** 校验表单本地合法性（不发起网络请求） */
function validate() {
  if (!form.owner.trim()) return '请填写 Owner（GitHub 用户名或组织名）'
  if (!/^[A-Za-z0-9._-]+$/.test(form.owner.trim())) return 'Owner 含非法字符'
  if (!form.repo.trim()) return '请填写数据仓库名 Repo'
  if (!/^[A-Za-z0-9._-]+$/.test(form.repo.trim())) return 'Repo 名含非法字符'
  if (!form.branch.trim()) return '请填写分支名 Branch'
  if (!form.token.trim()) return '请填写 Personal Access Token'
  if (form.token.trim().length < 20) return 'Token 长度异常，请确认已完整复制'
  return ''
}

/** 提交前统一整理（去空格、补默认分支） */
function normalize() {
  form.owner = form.owner.trim()
  form.repo = form.repo.trim()
  form.branch = form.branch.trim() || 'master'
  form.token = form.token.trim()
}

/**
 * 保存配置并测试连通性
 * @returns {Promise<boolean>}
 */
async function saveAndTest() {
  const err = validate()
  if (err) {
    lastError.value = err
    toast.warn(err)
    return false
  }
  normalize()
  syncFormToVault()
  persist()
  setConfig({ ...form }) // 同步内存配置，供无显式 vault 的调用使用

  testing.value = true
  lastError.value = ''
  try {
    const info = await testConnection(editingVault.value)
    repoInfo.value = info
    connected.value = true
    if (!form.branch) form.branch = info.branch
    Object.assign(editingVault.value, { branch: form.branch })
    persist()
    setConfig({ ...form })
    toast.success(`「${editingVault.value.label}」连接成功：${info.repo} @ ${info.branch}（${info.private ? '私有' : '公开'}仓库）`)
    showModal.value = false
    return true
  } catch (e) {
    connected.value = false
    const message = e instanceof GithubError ? e.message : e?.message || '未知错误'
    lastError.value = message
    toast.error(message)
    return false
  } finally {
    testing.value = false
  }
}

/** 仅保存，不测试 */
function saveOnly() {
  const err = validate()
  if (err) {
    lastError.value = err
    toast.warn(err)
    return false
  }
  normalize()
  syncFormToVault()
  persist()
  setConfig({ ...form })
  lastError.value = ''
  toast.info(`「${editingVault.value.label}」配置已保存到本地浏览器`)
  return true
}

function resetConfig() {
  vaults.value = defaultVaults()
  persist()
  Object.assign(form, { ...vaults.value[editingVaultIdx.value] })
  setConfig({ ...DEFAULT_CONFIG })
  connected.value = false
  repoInfo.value = null
  lastError.value = ''
  toast.info('已清除本地凭据')
}

const testing = ref(false)
const connected = ref(false)
const lastError = ref('')
const repoInfo = ref(null)
const showModal = ref(false)

// 启动即恢复；没有任何仓库配置时自动弹出配置弹窗
showModal.value = !configured.value

export function useConfig() {
  return {
    vaults,
    editingVaultIdx,
    activeVaultIdx,
    editingVault,
    activeVault,
    primaryVault,
    // 表单与状态
    form,
    testing,
    connected,
    lastError,
    repoInfo,
    showModal,
    configured,
    writable,
    readOnly,
    // 动作
    saveAndTest,
    saveOnly,
    resetConfig,
    switchVault,
    setActiveVault,
    openModal: () => (showModal.value = true),
  }
}
