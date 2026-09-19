/**
 * 站点配置 —— 纯只读
 * ------------------------------------------------------------------
 * 本站是一个**只读的笔记查看器**：
 *   · 数据固定来自一个公开仓库，访客不需要填任何东西
 *   · 站点不向 GitHub 发起任何写请求，界面上也没有写入口
 *   · 新建 / 编辑 / 删除 / 打卡全部在本地完成（写好笔记后跑「提交笔记.bat」）
 *
 * 为什么仓库名直接写在代码里？
 * 因为它**本来就是公开仓库**，任何人都看得到；而且必须写死 ——
 * 访客打开网站时没有任何本地配置，只能靠这份默认值去匿名读取内容。
 * 没有 Token、没有表单、没有「测试连接」，因此不存在凭据泄露面。
 *
 * 读取路径见 services/github.js 的 getFile()：无 Token 时走 raw CDN。
 */
import { computed, ref } from 'vue'

/** 公开展示仓库：必须是 public，否则访客读不到 */
const PUBLIC_OWNER = 'godspead0'
const PUBLIC_REPO = 'godspead0_notes1'
const PUBLIC_BRANCH = 'main'

/**
 * 两个页签指向**同一个公开仓库**的不同子目录。
 * 这样侧栏仍保留「技术 / 算法」两级分类，但仓库只需要维护一份。
 */
function defaultVaults() {
  return [
    {
      id: 'tech',
      label: '技术',
      owner: PUBLIC_OWNER,
      repo: PUBLIC_REPO,
      branch: PUBLIC_BRANCH,
      notesDir: '全栈',
    },
    {
      id: 'algo',
      label: '算法',
      owner: PUBLIC_OWNER,
      repo: PUBLIC_REPO,
      branch: PUBLIC_BRANCH,
      notesDir: '算法',
    },
  ]
}

const vaults = ref(defaultVaults())
const activeVaultIdx = ref(0)

const activeVault = computed(() => vaults.value[activeVaultIdx.value] || vaults.value[0])
/** 打卡记录 / 分类元数据所在的主仓库 —— 固定取第一个页签 */
const primaryVault = computed(() => vaults.value[0])
/** 有 Owner/Repo 即可读取；本站恒定成立 */
const configured = computed(() => vaults.value.some((v) => v.owner && v.repo))

/** 本站永远是只读的：没有 Token，也没有任何写入口 */
const writable = computed(() => false)
const readOnly = computed(() => true)

/** 「数据来源」弹窗开关 */
const showSource = ref(false)

function setActiveVault(idx) {
  activeVaultIdx.value = Number(idx) || 0
}

export function useConfig() {
  return {
    vaults,
    activeVaultIdx,
    activeVault,
    primaryVault,
    configured,
    writable,
    readOnly,
    showSource,
    openSource: () => (showSource.value = true),
    setActiveVault,
  }
}
