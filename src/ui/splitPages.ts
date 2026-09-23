// ui 層：出圖工作室「切分成多張圖」的切法（純函式，不碰畫面）
//
// 固定比例放不下全部事件時，依時間前後切成好幾張同樣比例的圖：
// 第 1 張放最早的一段、第 2 張接著往下……先算出最少要幾張，再盡量讓每張的事件數平均。
// 「放不放得下」要實際畫一次才知道，所以由呼叫的人傳 fits 進來。

/** 最多切幾張——再多就不是「一組簡報圖」了，請使用者改用別的做法 */
export const MAX_PAGES = 20

/** 事件的起點（時間軸座標），排序並去掉重複——同一個時間點的事件不能拆到兩張 */
export function eventGroups(starts: number[]): number[] {
  return [...new Set(starts)].sort((a, b) => a - b)
}

export type PagePlan =
  | { ok: true; pages: Array<[number, number]> }
  /** 某個時間點單獨一張都放不下 */
  | { ok: false; reason: 'single-too-big' }
  | { ok: false; reason: 'too-many-pages' }

/**
 * 從最早的事件開始，每張盡量多放，直到下一件放不下為止。
 * 張與張的分界落在兩件事件的正中間，所以每張前後都留一點空，且整段時間連續、沒有漏掉。
 */
export async function planPages(
  groups: number[],
  domain: [number, number],
  fits: (d: [number, number]) => Promise<boolean>,
): Promise<PagePlan> {
  const [d0, d1] = domain
  if (groups.length === 0) return { ok: true, pages: [[d0, d1]] }
  const last = groups.length - 1
  /** 第 i 群與第 i+1 群之間的分界 */
  const cut = (i: number) => (i >= last ? d1 : (groups[i] + groups[i + 1]) / 2)
  const pages: Array<[number, number]> = []
  let s = 0
  while (s <= last) {
    if (pages.length >= MAX_PAGES) return { ok: false, reason: 'too-many-pages' }
    const from = s === 0 ? d0 : cut(s - 1)
    const range = (e: number): [number, number] => [from, cut(e)]
    if (!(await fits(range(s)))) return { ok: false, reason: 'single-too-big' }
    // 二分搜尋：這張最多能放到第幾群
    let lo = s
    let hi = last
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (await fits(range(mid))) lo = mid
      else hi = mid - 1
    }
    pages.push(range(lo))
    s = lo + 1
  }
  return { ok: true, pages: (await balanced(groups.length, pages.length, cut, domain, fits)) ?? pages }
}

/**
 * 張數定了之後，試著讓每張的事件數平均一點（例如 12＋13，而不是 24＋1）。
 * 平均切法每一張都放得下才採用，否則維持原本的切法。
 */
async function balanced(
  count: number,
  n: number,
  cut: (i: number) => number,
  [d0, d1]: [number, number],
  fits: (d: [number, number]) => Promise<boolean>,
): Promise<Array<[number, number]> | null> {
  if (n < 2) return null
  const pages: Array<[number, number]> = []
  let from = d0
  for (let p = 1; p <= n; p++) {
    const endIdx = Math.round((p * count) / n) - 1
    const to = p === n ? d1 : cut(endIdx)
    if (!(await fits([from, to]))) return null
    pages.push([from, to])
    from = to
  }
  return pages
}
