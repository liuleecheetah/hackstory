// 從 vitest/config 匯入，才能在同一份設定裡寫 test 區塊
import { defineConfig } from 'vitest/config'
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
  test: {
    // 這台機器的檔案 I/O 很慢（實測型別檢查有 97% 時間在等磁碟），
    // 高負載時讀檔的測試可能超過 vitest 預設的 5 秒而「因為太慢」被誤判失敗。
    // 放寬逾時只會消除誤判——真的壞掉的測試仍然會失敗。
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
