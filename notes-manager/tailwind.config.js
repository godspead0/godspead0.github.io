/** @type {import('tailwindcss').Config} */
export default {
  // 手动切换主题（useTheme 在 <html> 上增删 .dark），而非仅跟随系统
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // GitHub Contribution Graph 类似色阶（从浅到深）
        'gh-0': '#ebedf0',
        'gh-1': '#9be9a8',
        'gh-2': '#40c463',
        'gh-3': '#30a14e',
        'gh-4': '#216e39',
      },
    },
  },
  plugins: [],
}