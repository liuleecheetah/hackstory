// render 層：與方向無關的資料準備
//
// 「哪些事件要畫、它們落在哪段時間、標題與日期文字長什麼樣、軸線用什麼顏色」——
// 這些橫式與直式完全一樣，因此抽到這裡；剩下「換算成第幾個像素」才是各自的排版工作。
//
// 這一層只認得 core 的資料模型，不碰畫面、不知道資料從哪裡來。

import type {
  AbsoluteTimePoint,
  HstEvent,
  RelativeAnchor,
  RelativeResolution,
  TimelineDocument,
} from '../core'
import { dateFromParts, isAbsolute, isFeatured, resolveRelativeEvents } from '../core'
import type { TimeWarp } from './gaps'
import { buildWarp } from './gaps'
import { truncate } from './layout'
import { formatPointShort, spanMidpoint, timePointToSpan } from './timeScale'
import type { TimelineSource } from './types'

const DAY = 86_400_000

/** 軸線沒指定顏色時輪流使用的預設色 */
export const PALETTE = ['#3b6ea5', '#d97706', '#0f766e', '#9333ea', '#be123c', '#4d7c0f']

/** 關係類型的中文名稱（沒有自訂 label 時顯示） */
export const RELATION_LABELS: Record<string, string> = {
  causes: '導致',
  responds_to: '回應',
  derives_from: '衍生自',
  contradicts: '與之矛盾',
  same_event: '同一事件',
}

/** 標題在軸上最多顯示幾個字（超過截斷，完整標題到詳情卡看） */
const TITLE_MAX_CHARS = 16

/** 一個準備好要畫的事件：只有時間與屬性，沒有像素座標 */
export interface PreparedEvent {
  ev: HstEvent
  kind: 'dot' | 'bar'
  /** 圖形佔用的真實時間範圍（毫秒）。dot 的 tStart = tEnd = 精度範圍中點 */
  tStart: number
  tEnd: number
  /** tStart 對應的壓縮座標（與目前縮放無關），供「跳到最早／最新事件」定位 */
  u: number
  isKey: boolean // featured：放大、粗體、光暈
  ongoing: boolean // 進行中：長條畫到今天、末端淡出
  estimate: boolean // 相對時間推估：虛線空心圓點
  relativeNote: string | null
  /** 已依 showDates／showYears／estimate 算好的日期前綴（不顯示時為空字串） */
  dateLabel: string
  /** 截斷後的標題 */
  title: string
}

/** 一條準備好要畫的軸線 */
export interface PreparedBand {
  key: string // `${sourceId}/${trackId}`
  sourceId: string
  trackId: string
  docTitle: string
  trackTitle: string
  /** 含「N 筆相對時間無法推估」註記的軸線標題 */
  label: string
  color: string
  /** 依 tStart 排序 */
  events: PreparedEvent[]
}

/** 與「要畫幾條軸線」無關的底層計算：相對時間求解、空白摺疊、初始可視範圍 */
export interface TimelineBase {
  /** 每份文件的相對時間求解結果（key = source.id） */
  resolvedBySource: Map<string, RelativeResolution>
  /** 時間 t ↔ 壓縮座標 u（含空白摺疊） */
  warp: TimeWarp
  /** 初始可視範圍（u 座標） */
  initialDomain: [number, number]
  /**
   * 每個事件的定位時間（毫秒），key = `${sourceId}/${eventId}`。
   * 「切尺度時把選取事件置中」「回到選取的事件」用這個找位置。
   */
  anchorTimes: Map<string, number>
}

export interface TimelineData extends TimelineBase {
  bands: PreparedBand[]
}

/** 依事件推算所有文件合起來的時間範圍（毫秒） */
function eventsExtent(docs: TimelineDocument[]): [number, number] | null {
  let min = Infinity
  let max = -Infinity
  for (const doc of docs) {
    for (const ev of doc.events) {
      if (isAbsolute(ev.start)) {
        const s = timePointToSpan(ev.start)
        min = Math.min(min, s.start.getTime())
        max = Math.max(max, s.end.getTime())
      }
      if (ev.end && isAbsolute(ev.end)) {
        max = Math.max(max, timePointToSpan(ev.end).end.getTime())
      }
      // 進行中的事件延伸到「今天」
      if (ev.ongoing && !ev.end) {
        max = Math.max(max, Date.now())
      }
    }
  }
  return min < max ? [min, max] : null
}

/** 收集所有事件佔用的時間範圍（毫秒），給空白摺疊的計算用 */
function collectSpans(docs: TimelineDocument[]): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  for (const doc of docs) {
    for (const ev of doc.events) {
      if (!isAbsolute(ev.start)) continue
      const s = timePointToSpan(ev.start)
      let end = s.end.getTime()
      if (ev.end && isAbsolute(ev.end)) {
        end = Math.max(end, timePointToSpan(ev.end).end.getTime())
      }
      if (ev.ongoing && !ev.end) {
        end = Math.max(end, Date.now())
      }
      spans.push([s.start.getTime(), end])
    }
  }
  return spans
}

/**
 * 初始可視範圍（壓縮座標 u）：疊多個圖層時以最外層（第一份）的 display.range 建議為準
 * （SPEC 第 8 節），否則用所有事件的實際範圍，前後各留 3% 呼吸空間。
 */
function initialDomainOf(sources: TimelineSource[], warp: TimeWarp): [number, number] {
  let extent = eventsExtent(sources.map((s) => s.doc))
  const range = sources[0]?.doc.display?.range
  if (range && /^\d{4}$/.test(range.start) && /^\d{4}$/.test(range.end)) {
    // 用 dateFromParts 而非 new Date(y, 0, 1)：古代年份（0–99）會被 JS 當成 1900–1999
    extent = [
      dateFromParts(Number(range.start)).getTime(),
      dateFromParts(Number(range.end) + 1).getTime(),
    ]
  }
  if (!extent) {
    const now = Date.now()
    return [now - 365 * DAY, now + 365 * DAY]
  }
  const u0 = warp.toU(extent[0])
  const u1 = warp.toU(extent[1])
  const pad = (u1 - u0) * 0.03
  return [u0 - pad, u1 + pad]
}

/**
 * 底層計算：相對時間求解 → 空白摺疊對應 → 初始範圍 → 事件定位時間。
 * 只跟 sources 與 collapseGaps 有關，與「要不要顯示日期」這類文字選項無關，
 * 因此獨立出來讓呼叫端可以分開快取（切換顯示選項時不必重算 warp）。
 */
export function buildTimelineBase(
  sources: TimelineSource[],
  collapseGaps: boolean,
): TimelineBase {
  // 相對時間事件的推估位置（每份文件各自求解）。
  // 用 fullDoc 求解：隱藏軸線只影響「畫什麼」，不該改變事件推算出來的時間位置
  const resolvedBySource = new Map<string, RelativeResolution>()
  for (const s of sources) resolvedBySource.set(s.id, resolveRelativeEvents(s.fullDoc ?? s.doc))

  // 時間 t ↔ 壓縮座標 u 的對應（不摺疊時為直通）。
  // 之後所有座標運算（縮放、平移、排版）都在 u 空間進行。
  // 相對時間的推估位置也算進佔用範圍，避免它們掉進被摺疊的空白裡
  const spans = collectSpans(sources.map((s) => s.doc))
  for (const s of sources) {
    // 只算進畫得出來的事件——隱藏軸線的事件雖然仍參與求解，但不該影響空白摺疊
    const drawable = new Set(s.doc.events.map((e) => e.id))
    resolvedBySource.get(s.id)?.positions.forEach((t, id) => {
      if (drawable.has(id)) spans.push([t, t + 3_600_000])
    })
  }
  const warp = buildWarp(spans, collapseGaps)

  const initialDomain = initialDomainOf(sources, warp)

  // 每個事件的定位時間：絕對時間取精度範圍中點，相對時間取推估位置（推不出來就沒有這個鍵）
  const anchorTimes = new Map<string, number>()
  for (const source of sources) {
    for (const ev of source.doc.events) {
      const t = isAbsolute(ev.start)
        ? spanMidpoint(timePointToSpan(ev.start))
        : resolvedBySource.get(source.id)?.positions.get(ev.id)
      if (t != null) anchorTimes.set(`${source.id}/${ev.id}`, t)
    }
  }

  return { resolvedBySource, warp, initialDomain, anchorTimes }
}

/** 文字選項：只影響事件旁的日期前綴 */
export interface BandTextOptions {
  /** 是否在事件標題前顯示日期 */
  showDates: boolean
  /** 日期是否含年份 */
  showYears: boolean
}

/** 把每份文件的每條軸線攤平成「準備好要畫的軸線」 */
export function buildBands(
  sources: TimelineSource[],
  base: TimelineBase,
  { showDates, showYears }: BandTextOptions,
): PreparedBand[] {
  const { resolvedBySource, warp } = base
  let bandIndex = 0

  return sources.flatMap((source) => {
    const tracks = [...source.doc.tracks].sort((t1, t2) => (t1.order ?? 0) - (t2.order ?? 0))
    const resolvedForSource = resolvedBySource.get(source.id)
    // 「本來是不是多軸」以原始文件為準（compose 傳入的 multiTrack），
    // 這樣把多軸文件隱藏到只剩一條時，仍當多軸處理——保留軸線名與軸線配色
    const multiTrack = source.multiTrack ?? tracks.length > 1
    return tracks.map((track) => {
      // 顏色優先序：多軸文件以文件內的軸線配色區分（圖層色只當後備）；
      // 單軸文件以圖層色為主（面板改色才會生效）
      const color = multiTrack
        ? track.color ?? source.color ?? PALETTE[bandIndex % PALETTE.length]
        : source.color ?? track.color ?? PALETTE[bandIndex % PALETTE.length]
      // 單軸文件直接用文件標題；多軸文件標成「文件｜軸線」。
      // 無法推估的相對時間事件不靜默——在軸線標題上註記
      const unresolvedCount = (resolvedForSource?.unresolved ?? []).filter((u) =>
        source.doc.events.some((e) => e.id === u.id && e.track === track.id),
      ).length
      const label =
        (!multiTrack ? source.doc.meta.title : `${source.doc.meta.title}｜${track.title}`) +
        (unresolvedCount > 0 ? `（${unresolvedCount} 筆相對時間無法推估）` : '')
      bandIndex++

      const events = source.doc.events
        .filter((ev) => ev.track === track.id)
        .flatMap((ev): PreparedEvent[] => {
          const start = ev.start
          const estimate = !isAbsolute(start)
          // 相對時間事件：用求解器的推估位置畫成虛線圓點
          const estimatedT = estimate ? resolvedForSource?.positions.get(ev.id) : undefined
          if (estimate && estimatedT === undefined) return [] // 無法推估（軸線標題已註記）
          const startSpan = estimate
            ? { start: new Date(estimatedT!), end: new Date(estimatedT!) }
            : timePointToSpan(start as AbsoluteTimePoint)
          const endPoint =
            !estimate && ev.end && isAbsolute(ev.end) ? (ev.end as AbsoluteTimePoint) : null

          // 相對時間的文字說明（詳情卡用）：「在Ａ之後、在Ｂ之前」
          let relativeNote: string | null = null
          if (estimate) {
            const relRef = (start as RelativeAnchor).relative
            const titleOf = (id: string) => source.doc.events.find((e) => e.id === id)?.title ?? id
            const parts: string[] = []
            if (relRef.after) parts.push(`在「${titleOf(relRef.after)}」之後`)
            if (relRef.before) parts.push(`在「${titleOf(relRef.before)}」之前`)
            relativeNote = parts.join('、')
          }

          // 進行中事件（ongoing 且沒有 end）：長條一路畫到「今天」，末端淡出。
          // 推估位置的事件不適用（位置本身就不確定）
          const ongoing = ev.ongoing === true && !endPoint && !estimate

          let kind: 'dot' | 'bar'
          let tStart: number
          let tEnd: number
          if (endPoint) {
            // 區間事件 = 長條：從開始範圍的頭到結束範圍的尾
            kind = 'bar'
            tStart = startSpan.start.getTime()
            tEnd = timePointToSpan(endPoint).end.getTime()
          } else if (ongoing) {
            kind = 'bar'
            tStart = startSpan.start.getTime()
            tEnd = Date.now()
          } else {
            // 點事件 = 圓點：畫在精度範圍的中點
            kind = 'dot'
            tStart = spanMidpoint(startSpan)
            tEnd = tStart
          }

          // 日期前綴（「顯示事件日期」「含年份」兩個勾選框控制）。
          // 推估位置永遠標示「（推估）」——明確告訴讀者這不是真實日期
          const dateLabel = estimate
            ? '（推估）'
            : showDates
              ? formatPointShort(start as AbsoluteTimePoint, showYears)
              : ''

          return [
            {
              ev,
              kind,
              tStart,
              tEnd,
              u: warp.toU(tStart),
              isKey: isFeatured(ev), // 重點事件：放大、粗體、光暈，一眼看到
              ongoing,
              estimate,
              relativeNote,
              dateLabel,
              title: truncate(ev.title, TITLE_MAX_CHARS),
            },
          ]
        })
        .sort((p, q) => p.tStart - q.tStart)

      return {
        key: `${source.id}/${track.id}`,
        sourceId: source.id,
        trackId: track.id,
        docTitle: source.doc.meta.title,
        trackTitle: track.title,
        label,
        color,
        events,
      }
    })
  })
}

/** 一次備好整份資料（直式檢視與圖片匯出用；橫式檢視為了快取分兩步呼叫） */
export function buildTimelineData(
  sources: TimelineSource[],
  opts: BandTextOptions & { collapseGaps: boolean },
): TimelineData {
  const base = buildTimelineBase(sources, opts.collapseGaps)
  return { ...base, bands: buildBands(sources, base, opts) }
}
