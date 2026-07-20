// share 層（第 5 層）：共用庫——發佈到共用庫／取用他人時間軸。
// S1（目前階段）：「取用」先行。目錄是隨網站部署的靜態檔案 library/index.json，
// 不需要登入、不需要資料庫；想上架的時間軸以 GitHub issue 投稿、由維護者審核加入。
// S3 接 Supabase 做登入與發佈時，只改這一層（見 docs/share-plan.md）。
// 鐵律：只能呼叫比它低的層。

/** 共用庫目錄裡的一筆時間軸 */
export interface LibraryEntry {
  /** 時間軸文件的全域識別碼（對應 .hst.json 的 id） */
  id: string
  title: string
  description?: string
  /** 主題標籤（顯示用） */
  topics?: string[]
  /** 涵蓋年代（顯示用，例：「1986–2017」） */
  period?: string
  /** 檔案網址：相對路徑（相對於網站）或完整 https 網址 */
  url: string
}

export type LibraryIndexResult =
  | { ok: true; entries: LibraryEntry[] }
  | { ok: false; error: string }

/** 目錄檔的預設位置（public/library/index.json，隨網站一起部署） */
export const LIBRARY_INDEX_URL = 'library/index.json'

/** 把目錄裡可能是相對路徑的網址，解析成完整網址（相對於目前網頁） */
export function resolveLibraryUrl(url: string, base: string = window.location.href): string {
  return new URL(url, base).href
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/**
 * 解析共用庫目錄 JSON（純函式，方便測試）。
 * 目錄壞掉是維護者的錯，不是使用者的錯——所以直接回報第一個問題，不嘗試部分載入。
 */
export function parseLibraryIndex(text: string): LibraryIndexResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: '共用庫目錄不是有效的 JSON' }
  }
  if (typeof data !== 'object' || data === null || !Array.isArray((data as { entries?: unknown }).entries)) {
    return { ok: false, error: '共用庫目錄缺少 entries 清單' }
  }
  const raw = (data as { entries: unknown[] }).entries
  const entries: LibraryEntry[] = []
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i] as Partial<LibraryEntry> | null
    if (
      typeof e !== 'object' ||
      e === null ||
      !isNonEmptyString(e.id) ||
      !isNonEmptyString(e.title) ||
      !isNonEmptyString(e.url)
    ) {
      return { ok: false, error: `共用庫目錄第 ${i + 1} 筆缺少 id、title 或 url` }
    }
    entries.push({
      id: e.id,
      title: e.title,
      url: e.url,
      description: isNonEmptyString(e.description) ? e.description : undefined,
      period: isNonEmptyString(e.period) ? e.period : undefined,
      topics: Array.isArray(e.topics) ? e.topics.filter(isNonEmptyString) : undefined,
    })
  }
  return { ok: true, entries }
}

/** 讀取共用庫目錄 */
export async function fetchLibraryIndex(
  indexUrl: string = LIBRARY_INDEX_URL,
): Promise<LibraryIndexResult> {
  try {
    const res = await fetch(resolveLibraryUrl(indexUrl))
    if (!res.ok) {
      return { ok: false, error: `無法讀取共用庫目錄（HTTP ${res.status}）` }
    }
    return parseLibraryIndex(await res.text())
  } catch {
    return { ok: false, error: '無法連線讀取共用庫目錄，請檢查網路後再試' }
  }
}
