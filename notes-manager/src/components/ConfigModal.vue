<script setup>
/**
 * 连接设置弹窗（多仓库：技术 / 算法）
 * ---------------------------------------------------------------
 * 每个仓库独立配置 Owner / Repo / Branch / 笔记目录 / PAT。
 * 凭据只保存在本机 localStorage，绝不经过任何第三方服务器。
 */
import { computed, watch } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { useNotes } from '../composables/useNotes.js'
import { useCheckins } from '../composables/useCheckins.js'
import { confirmDialog } from '../composables/useConfirm.js'
import { toast } from '../composables/useToast.js'
import AppIcon from './AppIcon.vue'

const {
  form,
  vaults,
  editingVaultIdx,
  editingVault,
  testing,
  connected,
  lastError,
  repoInfo,
  saveAndTest,
  saveOnly,
  resetConfig,
  switchVault,
  showModal,
} = useConfig()

const tokenUrl = 'https://github.com/settings/tokens/new?scopes=repo&description=notes-manager-vault'
const fineGrainedUrl = 'https://github.com/settings/personal-access-tokens/new'
/**
 * 「打开数据仓库」外链。
 * 只在该页签**确实配置过**（存了 Token）时给出 —— 不能用 form.owner/form.repo 判断，
 * 因为 form 的初始值来自代码里的默认配置，会让访客看到一个他从没配过的仓库链接。
 */
const repoUrl = computed(() => {
  const v = editingVault.value
  if (!v || !v.token || !v.owner || !v.repo) return ''
  return `https://github.com/${v.owner}/${v.repo}`
})
/** 该仓库的笔记目录：空串表示仓库根目录 */
const notesDirLabel = computed(() =>
  form.notesDir ? `仓库内的 ${form.notesDir}/ 目录` : '仓库根目录（含子文件夹）',
)

function close() {
  showModal.value = false
}

async function onTest() {
  await saveAndTest()
}

/**
 * 清除凭据 = 清除 Token + **本机缓存的笔记正文与打卡记录**。
 * 只清 Token 是不够的：笔记正文缓存在 localStorage 里，
 * 若不清掉，别人在这台电脑上打开网站仍能从缓存读到全部笔记。
 */
async function onReset() {
  const ok = await confirmDialog({
    title: '清除本机全部数据？',
    message: '将删除本机保存的 Token、笔记缓存（含正文）与打卡缓存。',
    detail: 'GitHub 仓库里的笔记不受影响，下次填入 Token 后可重新同步。',
    confirmText: '清除',
    danger: true,
  })
  if (!ok) return
  resetConfig()
  useNotes().purge()
  useCheckins().purge()
  toast.info('已清除本机凭据与全部本地缓存')
}

function onKey(e) {
  if (e.key === 'Escape') close()
}

watch(showModal, (open) => {
  if (open) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Transition name="fade">
    <div
      v-if="showModal"
      class="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/45 p-4 py-10"
      @click.self="close"
    >
      <div class="card w-full max-w-2xl p-5 shadow-2xl">
        <!-- 头部 -->
        <div class="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 class="flex items-center gap-2 text-lg font-semibold">
              <AppIcon name="github" :size="18" />
              连接 GitHub 数据仓库
            </h2>
            <p class="mt-1 text-xs muted">
              纯前端直连 GitHub REST API，无自建后端。笔记可来自多个仓库（技术 / 算法），统一聚合展示。
            </p>
          </div>
          <button class="btn btn-sm" title="关闭" @click="close"><AppIcon name="x" :size="14" /></button>
        </div>

        <!-- 仓库页签 -->
        <div class="mb-4 flex flex-wrap gap-1.5 rounded-lg border border-[var(--app-border)] p-1">
          <button
            v-for="(v, i) in vaults"
            :key="v.id"
            class="flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition"
            :class="
              i === editingVaultIdx
                ? 'bg-[var(--app-accent)] text-white'
                : 'muted hover:bg-black/5 dark:hover:bg-white/10'
            "
            @click="switchVault(i)"
          >
            <AppIcon name="book" :size="13" />
            {{ v.label }}
            <span
              v-if="v.token && v.owner && v.repo"
              class="inline-block h-1.5 w-1.5 rounded-full bg-[#1f883d]"
              title="已配置"
            />
          </button>
        </div>

        <!-- 安全提示 -->
        <div class="mb-4 rounded-lg border border-[#0969da]/35 bg-[#ddf4ff]/70 p-3 text-xs leading-6 dark:bg-[#0c2d6b]/40">
          <p class="flex items-start gap-2">
            <AppIcon name="shield" :size="14" class="mt-1" />
            <span>
              Token 仅保存在本浏览器的 <code class="font-mono">localStorage</code>，不会上传到任何服务器；
              但两个仓库都需要访问权限（fine-grained Token 可在同一 Token 里勾选多个仓库）。
              仍建议：<b>仅在私人设备上使用</b>，并创建<b>仅授权目标仓库 Contents: Read and write</b> 的
              Token。若在公共电脑使用，用完请点击「清除凭据」——
              它会同时抹掉 Token、<b>本机缓存的笔记正文</b>与打卡记录。
            </span>
          </p>
        </div>

        <!-- 表单 -->
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="label" for="cfg-owner">Owner（用户名 / 组织名）</label>
            <input id="cfg-owner" v-model="form.owner" class="input" placeholder="你的 GitHub 用户名" autocomplete="username" />
          </div>
          <div>
            <label class="label" for="cfg-repo">数据仓库 Repo</label>
            <input id="cfg-repo" v-model="form.repo" class="input" placeholder="存放笔记的仓库名" />
          </div>
          <div>
            <label class="label" for="cfg-branch">分支 Branch</label>
            <input id="cfg-branch" v-model="form.branch" class="input" placeholder="如 main 或 master" />
          </div>
          <div>
            <label class="label" for="cfg-notesdir">笔记目录（留空 = 仓库根目录）</label>
            <input
              id="cfg-notesdir"
              v-model="form.notesDir"
              class="input font-mono"
              placeholder="扫描的子目录名，留空则扫整个仓库"
            />
          </div>
          <div class="sm:col-span-2">
            <label class="label" for="cfg-token">Personal Access Token（{{ editingVault?.label }}）</label>
            <input
              id="cfg-token"
              v-model="form.token"
              class="input font-mono"
              type="password"
              placeholder="ghp_xxx 或 github_pat_xxx（已保存后不会回显明文）"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
        </div>

        <!-- 帮助链接 -->
        <div class="mt-3 flex flex-wrap gap-3 text-xs">
          <a class="link" :href="tokenUrl" target="_blank" rel="noopener noreferrer">
            <AppIcon name="key" :size="12" /> 生成经典 Token（勾选 repo）
          </a>
          <a class="link" :href="fineGrainedUrl" target="_blank" rel="noopener noreferrer">
            <AppIcon name="shield" :size="12" /> 生成 Fine-grained Token（推荐）
          </a>
          <a v-if="repoUrl" class="link" :href="repoUrl" target="_blank" rel="noopener noreferrer">
            <AppIcon name="external-link" :size="12" /> 打开数据仓库
          </a>
        </div>

        <!-- 结果回显 -->
        <div
          v-if="lastError"
          class="mt-4 flex items-start gap-2 rounded-lg border border-[#cf222e]/40 bg-[#ffebe9]/70 p-3 text-xs leading-6 text-[#a40e26] dark:bg-[#4a1113]/50 dark:text-[#ffcecb]"
        >
          <AppIcon name="alert" :size="14" class="mt-1" />
          <span>{{ lastError }}</span>
        </div>

        <div
          v-else-if="connected && repoInfo"
          class="mt-4 rounded-lg border border-[#1a7f37]/40 bg-[#dafbe1]/70 p-3 text-xs leading-6 text-[#0f5323] dark:bg-[#0f2f1d]/60 dark:text-[#aff5b4]"
        >
          <p class="flex items-center gap-2 font-semibold">
            <AppIcon name="check-circle" :size="14" /> 连接正常
          </p>
          <p class="mt-1">
            仓库：{{ repoInfo.repo }}（{{ repoInfo.private ? '私有' : '公开' }}） · 分支：{{ repoInfo.branch }} ·
            写入权限：{{ repoInfo.canWrite ? '可写 ✅' : '只读 ❌（Token 缺少 Contents 写权限）' }}
            <span v-if="repoInfo.user"> · 身份：{{ repoInfo.user }}</span>
          </p>
        </div>

        <!-- 操作区 -->
        <div class="mt-5 flex flex-wrap items-center justify-between gap-2">
          <button class="btn btn-sm" title="清除 Token 与本机全部缓存（笔记正文、打卡记录）" @click="onReset">
            <AppIcon name="log-out" :size="13" /> 清除凭据
          </button>
          <div class="flex flex-wrap gap-2">
            <button class="btn" :disabled="testing" @click="saveOnly">仅保存</button>
            <button class="btn btn-primary" :disabled="testing" @click="onTest">
              <AppIcon :name="testing ? 'loader' : 'zap'" :size="14" />
              {{ testing ? '正在测试…' : '测试并保存' }}
            </button>
          </div>
        </div>

        <p class="mt-3 text-[11px] muted">
          「{{ editingVault?.label }}」将读取 {{ notesDirLabel }} 下的全部 <code class="font-mono">.md</code>，
          按一级子文件夹自动归类；打卡记录与分类配色存放在<b>第一个已配置的仓库</b>。
        </p>
        <p v-if="!form.notesDir" class="mt-1 text-[11px] text-[var(--app-warn,#9a6700)]">
          笔记不在仓库根部时，请填写具体子目录名 —— 留空会扫描整个仓库，
          容易把仓库里的说明文档也识别成笔记。
        </p>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--app-accent);
}
.link:hover {
  text-decoration: underline;
}
</style>
