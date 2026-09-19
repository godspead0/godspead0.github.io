import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  base: './', // GitHub Pages å­è·¯å¾„éƒ¨ç½²æ—¶ä½¿ç”¨ç›¸å¯¹è·¯å¾„ï¼Œä¿è¯èµ„æºå¯è®¿é—®
  server: {
    port: 5173,
    open: false,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1500,
  },
})
// ÍøÕ¾¹¹½¨Óë²¿ÊğÓÉ .github/workflows/deploy.yml ¸ºÔğ£¨GitHub Actions£©
