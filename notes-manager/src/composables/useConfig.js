/**
 * 连接配置 Composable
 * 负责 Owner / Repo / Branch / Token 的读写、连通性测试与在线状态。
 */
import { computed, reactive, ref } from 'vue'
import {
  DEFAULT_CONFIG,
  GithubError,
  clearConfig as clearStoredConfig,
  isConfigured as checkConfigured,
  loadConfig,
  setConfig,
  testConnection,
} from '../services/github.js'
import { toast } from './useToast.js'

const form = reactive({ ...DEFAULT_CONFIG })
const testing = ref(false)
const connected = ref(false)
const lastError = ref('')
const repoInfo = ref(null)
const showModal = ref(false)

// 启动即从 localStorage 恢复；若缺少关键字段则自动弹出配置弹窗
{
  const saved = loadConfig()
  Object.assign(form, saved)
  setConfig(saved)
  showModal.value = !(saved.token && saved.owner && saved.repo)
}

const configured = computed(() => Boolean(form.token && form.owner && form.repo))

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
  testing.value = true
  lastError.value = ''
  setConfig({ ...form }) // 先落库，request 层才能取到 token

  try {
    const info = await testConnection()
    repoInfo.value = info
    connected.value = true
    if (!form.branch) form.branch = info.branch
    setConfig({ ...form })
    toast.success(`连接成功：${info.repo} @ ${info.branch}（${info.private ? '私有' : '公开'}仓库）`)
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
  setConfig({ ...form })
  lastError.value = ''
  toast.info('配置已保存到本地浏览器')
  return true
}

function resetConfig() {
  clearStoredConfig()
  Object.assign(form, DEFAULT_CONFIG)
  setConfig({ ...DEFAULT_CONFIG })
  connected.value = false
  repoInfo.value = null
  lastError.value = ''
  toast.info('已清除本地凭据')
}

export function useConfig() {
  return {
    form,
    testing,
    connected,
    lastError,
    repoInfo,
    showModal,
    configured,
    isConfigured: checkConfigured,
    saveAndTest,
    saveOnly,
    resetConfig,
    openModal: () => (showModal.value = true),
  }
}
