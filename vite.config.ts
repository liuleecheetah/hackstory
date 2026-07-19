import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cpSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 建置後把 examples/ 複製進 dist/，讓網站上的分享連結（?src=）能用「同源」網址載入範例檔。
// 沒有這一步，examples/ 只存在原始碼裡、不會出現在部署的網站上，
// 對著 .../examples/xxx.hst.json 的連結就會抓不到檔案（404），畫面一片空白。
function copyExamples() {
  return {
    name: 'copy-examples',
    apply: 'build' as const,
    closeBundle() {
      cpSync(
        fileURLToPath(new URL('examples', import.meta.url)),
        fileURLToPath(new URL('dist/examples', import.meta.url)),
        { recursive: true },
      )
    },
  }
}

// Vite 建置設定：React + Tailwind CSS
export default defineConfig({
  plugins: [react(), tailwindcss(), copyExamples()],
  // 相對路徑：讓建置結果放在 GitHub Pages 的子路徑（/hackstory/）也能正常載入
  base: './',
})
