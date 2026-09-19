import { createApp } from 'vue'
import App from './App.vue'
import './index.css'
import { initTheme } from './composables/useTheme.js'
import { useCheckins } from './composables/useCheckins.js'
import { useNotes } from './composables/useNotes.js'

// 主题：优先读取本地偏好，其次跟随系统
initTheme()

// 先用本地缓存渲染热力图，避免首屏空白（随后由 refresh() 与远端对齐）
useCheckins().hydrateFromCache()

// 同理：笔记列表也用本地缓存秒开首屏，随后在后台静默校验差异
useNotes().hydrateFromCache()

const app = createApp(App)

// 全局错误兜底：任何未捕获的异常都以可见方式暴露，避免白屏无提示
app.config.errorHandler = (err, _instance, info) => {
  // eslint-disable-next-line no-console
  console.error('[notes-manager] 未捕获异常:', err, info)
}

// 本站只读、无凭据：数据源固定在 useConfig.js 的 PUBLIC_* 常量里，启动即可读。
app.mount('#app')
