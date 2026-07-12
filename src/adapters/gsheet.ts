// adapters 層：Google Sheet 匯入
// 只接受「公開」試算表：發布到網路的 CSV 連結，或開啟連結共用的一般網址。
// 刻意不碰 Google API 授權——那正是 2017 年原型翻車的地方。

/** 把使用者貼的各種 Google Sheet 網址轉成 CSV 下載網址；認不得回傳 null */
export function toCsvUrl(input: string): string | null {
  const url = input.trim()
  if (!/^https?:\/\/docs\.google\.com\/spreadsheets\//.test(url)) return null

  // 「發布到網路」的連結（/d/e/…/pub）：補上 output=csv
  if (url.includes('/pub')) {
    if (/[?&]output=csv/.test(url)) return url
    return url + (url.includes('?') ? '&' : '?') + 'output=csv'
  }

  // 一般網址（/spreadsheets/d/<id>/…）→ export CSV；保留 gid（分頁）
  const m = url.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)
  if (m) {
    const gid = url.match(/[#&?]gid=(\d+)/)?.[1]
    return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`
  }
  return null
}

export type SheetFetchResult = { ok: true; text: string } | { ok: false; error: string }

/** 從公開的 Google Sheet 抓 CSV 文字 */
export async function fetchSheetCsv(input: string): Promise<SheetFetchResult> {
  const csvUrl = toCsvUrl(input)
  if (!csvUrl) {
    return { ok: false, error: '這看起來不是 Google 試算表網址（應以 https://docs.google.com/spreadsheets/ 開頭）' }
  }
  try {
    const res = await fetch(csvUrl)
    if (!res.ok) {
      return {
        ok: false,
        error: `Google 回應 ${res.status}。請確認試算表已「檔案 → 分享 → 發布到網路」，或已開啟「知道連結的人可檢視」`,
      }
    }
    const text = await res.text()
    if (text.trimStart().startsWith('<')) {
      return {
        ok: false,
        error: '拿到的不是 CSV（試算表可能需要登入）。請改用「發布到網路」產生的 CSV 連結',
      }
    }
    return { ok: true, text }
  } catch {
    return {
      ok: false,
      error: '無法連線到 Google。請檢查網路，或改用「下載成 CSV 後上傳檔案」的方式匯入',
    }
  }
}
