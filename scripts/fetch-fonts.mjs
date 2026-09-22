// 下載思源黑體（Noto Sans TC）切片檔，放進網站自己的資料夾（自架字型）。
//
// ── 這支腳本在做什麼 ──
// Google Fonts 把 Noto Sans TC 切成一百多個小檔（每個檔只含一段字元範圍），
// 瀏覽器只會下載頁面上真的用到的那幾片。這支腳本：
//   1. 跟 Google Fonts 要一份字型 CSS（Regular 400 與 Bold 700 兩種粗細）
//   2. 把 CSS 裡列出的每一個切片檔（.woff2）下載到 public/fonts/noto-sans-tc/
//   3. 把 CSS 裡的網址改成相對路徑，寫成 public/fonts/noto-sans-tc/noto-sans-tc.css
//   4. 一併下載字型授權書 OFL.txt（SIL Open Font License 1.1）
// 完成後網站讀者的瀏覽器只連我們自己的網站，不會連到 Google。
//
// ── 怎麼跑 ──
// 在專案資料夾執行：  node scripts/fetch-fonts.mjs
// 只需要跑一次，產生的檔案直接 commit 進 repo。之後除非要更新字型，否則不必再跑。
//
// ── 會產生什麼 ──
// public/fonts/noto-sans-tc/ 底下約一百個 .woff2 檔（400 與 700 兩種粗細共用同一批可變字型檔）、
// 一個 noto-sans-tc.css、一個 OFL.txt，合計約 4 MB。

import { mkdir, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const OUT_DIR = fileURLToPath(new URL('../public/fonts/noto-sans-tc/', import.meta.url))
const CSS_URL = 'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&display=swap'
const LICENSE_URL = 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE'
// 要假裝成桌機版 Chrome，Google 才會回傳 woff2 切片版的 CSS
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

async function fetchOk(url, asText) {
  const res = await fetch(url, { headers: { 'User-Agent': CHROME_UA } })
  if (!res.ok) throw new Error(`下載失敗（${res.status}）：${url}`)
  return asText ? res.text() : Buffer.from(await res.arrayBuffer())
}

async function main() {
  // 先清空舊檔，避免殘留用不到的切片
  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(OUT_DIR, { recursive: true })

  const css = await fetchOk(CSS_URL, true)

  // 同一個網址只下載一次（有些粗細會共用同一個檔）
  const urlToName = new Map()
  const rewritten = css.replace(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g, (_, url) => {
    if (!urlToName.has(url)) {
      urlToName.set(url, `slice-${String(urlToName.size).padStart(3, '0')}.woff2`)
    }
    return `url(./${urlToName.get(url)})`
  })

  let totalBytes = 0
  let done = 0
  // 一次最多同時下載 8 個，免得對方拒絕
  const queue = [...urlToName.entries()]
  async function worker() {
    while (queue.length) {
      const [url, name] = queue.shift()
      const buf = await fetchOk(url, false)
      await writeFile(OUT_DIR + name, buf)
      totalBytes += buf.length
      done++
      if (done % 20 === 0) console.log(`已下載 ${done} / ${urlToName.size} 個切片…`)
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))

  const header =
    '/* 思源黑體（Noto Sans TC）自架字型。由 scripts/fetch-fonts.mjs 自動產生，請勿手改。\n' +
    '   授權：SIL Open Font License 1.1（見同資料夾 OFL.txt） */\n'
  await writeFile(OUT_DIR + 'noto-sans-tc.css', header + rewritten)
  await writeFile(OUT_DIR + 'OFL.txt', await fetchOk(LICENSE_URL, true))

  console.log(`完成：${urlToName.size} 個切片，共 ${(totalBytes / 1024 / 1024).toFixed(1)} MB`)
  console.log(`檔案在 ${OUT_DIR}`)
}

main().catch((err) => {
  console.error('字型下載失敗：', err.message)
  process.exit(1)
})
