// render 層：把直式時間軸以指定的尺寸離屏渲染成一張圖
//
// 關鍵設計：**不另外寫一套繪圖程式**。這裡只是把 VerticalTimelineView 切到
// 「匯出模式」（固定寬高、不互動）渲染一次，再把產生的 <svg> 節點取出來。
// 匯出走的是同一段排版與繪製，所以「畫面上看到的」與「存下來的圖」不會長不一樣。
//
// 這一層不知道圖片之後要變成 PNG 還是 SVG 檔——那是 adapters 的事。

import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { CalloutSpec } from './callouts'
import type { DateParts } from './timeScale'
import { ChronicleView } from './ChronicleView'
import type { RenderTheme } from './theme'
import { buildTimelineBase } from './timelineData'
import { TimelineView } from './TimelineView'
import type { TimelineSource } from './types'
import { VerticalTimelineView } from './VerticalTimelineView'

/** 直式與橫式共用的匯出參數 */
export interface ExportRequestBase {
  sources: TimelineSource[]
  /** 目前畫面的可視範圍（壓縮座標 u）——所見即所得。與 timeRange 擇一；都沒給就畫全部 */
  domain?: [number, number]
  /** 用真實時間（毫秒）指定範圍，例如「1980 到 2020 年」。優先於 domain */
  timeRange?: [number, number]
  /** 邏輯尺寸（像素） */
  width: number
  height: number
  showDates: boolean
  showYears: boolean
  /** 年、月、日分別控制（出圖工作室）；有給就取代上面兩個 */
  dateParts?: DateParts
  showRelations: boolean
  collapseGaps: boolean
  /** 圖片頂部的標題 */
  title: string
  /** 標題下方的副標（選填） */
  subtitle?: string
  /** 圖片底部左側的註記（選填），例如「僅列關鍵事件（25 件中的 9 件）」 */
  note?: string
  /** 圖片底部的出處小字 */
  footer: string
  /** 主題（字級、尺寸、配色），預設螢幕主題 */
  theme?: RenderTheme
}

/**
 * 決定要畫哪一段時間（壓縮座標 u）。
 * 真實時間要先經過「摺疊空白」的換算，才對得上時間軸的座標——這是 render 的知識，
 * 所以 ui 只要說「1980 到 2020 年」，換算留在這裡做。
 */
function resolveDomain(req: ExportRequestBase): [number, number] {
  if (!req.timeRange && req.domain) return req.domain
  const { warp, initialDomain } = buildTimelineBase(req.sources, req.collapseGaps)
  if (!req.timeRange) return initialDomain
  const [a, b] = req.timeRange
  return [warp.toU(Math.min(a, b)), warp.toU(Math.max(a, b))]
}

/** 直式另外吃兩個排版選項，匯出的圖才會跟畫面上一致 */
export interface VerticalExportRequest extends ExportRequestBase {
  reversed: boolean
  centerAxis: boolean
  /** 標註框（選填） */
  callouts?: CalloutSpec[]
}

/** 橫式另外吃「精簡模式」——那是使用者調整「一張圖塞得下幾條軸線」的主要手段 */
export interface HorizontalExportRequest extends ExportRequestBase {
  compact: boolean
  /** 版型 A「多軸泳道」外觀：左側軸線名色塊、頂部刻度帶、方頭長條 */
  swimlane?: boolean
  /** 標註框（選填） */
  callouts?: CalloutSpec[]
}

/** 每種匯出結果都會回報：全部內容放得下需要多高（「自動長度」用） */
interface ContentHeight {
  contentHeight: number
}

/** 放不下而省略的標註（事件 key） */
interface CalloutsDropped {
  calloutsDropped: string[]
}

export interface VerticalExportResult extends ContentHeight, CalloutsDropped {
  svg: SVGSVGElement
  /** 事件太多、標題排不下（只畫得出圓點）的件數 */
  hidden: number
  /** 欄太窄，標題幾乎只剩省略號 */
  narrowColumns: boolean
}

export interface HorizontalExportResult extends ContentHeight, CalloutsDropped {
  svg: SVGSVGElement
  /** 軸線太多，超出這個比例的高度被裁掉 */
  overflow: boolean
}

/** 離屏渲染時用的 id，避免與畫面上的時間軸 SVG 撞名 */
const OFFSCREEN_ID = 'hackstory-export-svg'

/**
 * 把一個 React 元素掛到畫面外渲染一次，讀出結果後立刻拆掉。
 *
 * 要真的掛到頁面上（不是 detached 節點），字型與尺寸才算得準。
 */
function renderOffscreen<T>(element: ReactElement, read: (svg: SVGSVGElement) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const host = document.createElement('div')
    host.style.cssText =
      'position:fixed;left:-100000px;top:0;pointer-events:none;opacity:0;z-index:-1'
    document.body.appendChild(host)
    const root = createRoot(host)

    const cleanup = () => {
      root.unmount()
      host.remove()
    }

    root.render(element)

    // 等瀏覽器畫完一個影格，DOM 才真的存在。
    // 分頁切到背景時 requestAnimationFrame 不會觸發，所以加一個計時器保底——
    // 否則使用者切走再切回來，預覽會永遠停在「產生預覽中…」
    let done = false
    const extract = () => {
      if (done) return
      done = true
      try {
        const svg = host.querySelector('svg')
        if (!(svg instanceof SVGSVGElement)) throw new Error('離屏渲染沒有產生 SVG')
        resolve(read(svg))
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      } finally {
        cleanup()
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(extract))
    setTimeout(extract, 150)
  })
}

/** 讀出繪製端回報的「放不下而省略的標註」 */
function calloutsDroppedOf(svg: SVGSVGElement): string[] {
  const raw = svg.dataset.calloutsDropped
  return raw ? raw.split('|') : []
}

/** 讀出繪製端回報的「全部放得下需要的高度」 */
function contentHeightOf(svg: SVGSVGElement): number {
  return Number(svg.dataset.contentHeight ?? 0)
}

/** 取出可序列化的副本（離屏用的 id 要拿掉，免得跟畫面上的撞名） */
function detach(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.removeAttribute('id')
  return clone
}

/**
 * 以指定尺寸渲染一張**直式**時間軸，回傳可以序列化的 SVG 元素
 * （呼叫端自行決定要存成 SVG 還是 PNG）。
 */
export function renderVerticalExportSvg(
  req: VerticalExportRequest,
): Promise<VerticalExportResult> {
  return renderOffscreen(
    <VerticalTimelineView
      sources={req.sources}
      domain={resolveDomain(req)}
      theme={req.theme}
      showDates={req.showDates}
      showYears={req.showYears}
      dateParts={req.dateParts}
      showRelations={req.showRelations}
      reversed={req.reversed}
      centerAxis={req.centerAxis}
      collapseGaps={req.collapseGaps}
      callouts={req.callouts}
      exportMode={{
        width: req.width,
        height: req.height,
        svgId: OFFSCREEN_ID,
        title: req.title,
        subtitle: req.subtitle,
        note: req.note,
        footer: req.footer,
      }}
    />,
    (svg) => ({
      svg: detach(svg),
      contentHeight: contentHeightOf(svg),
      calloutsDropped: calloutsDroppedOf(svg),
      hidden: Number(svg.dataset.hidden ?? 0),
      narrowColumns: svg.dataset.narrowColumns === '1',
    }),
  )
}

/** 版型 D 卡片大事記的結果 */
export interface ChronicleExportResult extends ContentHeight {
  svg: SVGSVGElement
  /** 畫布放不下、沒列出來的事件數 */
  hidden: number
}

/** 以指定尺寸渲染一張**卡片式大事記**（版型 D） */
export function renderChronicleExportSvg(
  req: ExportRequestBase & {
    reversed: boolean
    showConfidence: boolean
    showSources: boolean
    onlyStartingInRange?: boolean
  },
): Promise<ChronicleExportResult> {
  return renderOffscreen(
    <ChronicleView
      sources={req.sources}
      domain={resolveDomain(req)}
      collapseGaps={req.collapseGaps}
      reversed={req.reversed}
      dateParts={req.dateParts}
      showConfidence={req.showConfidence}
      showSources={req.showSources}
      onlyStartingInRange={req.onlyStartingInRange}
      theme={req.theme}
      exportMode={{
        width: req.width,
        height: req.height,
        svgId: OFFSCREEN_ID,
        title: req.title,
        subtitle: req.subtitle,
        note: req.note,
        footer: req.footer,
      }}
    />,
    (svg) => ({
      svg: detach(svg),
      hidden: Number(svg.dataset.hidden ?? 0),
      contentHeight: contentHeightOf(svg),
    }),
  )
}

/** 以指定尺寸渲染一張**橫式**時間軸 */
export function renderHorizontalExportSvg(
  req: HorizontalExportRequest,
): Promise<HorizontalExportResult> {
  return renderOffscreen(
    <TimelineView
      sources={req.sources}
      domain={resolveDomain(req)}
      theme={req.theme}
      showDates={req.showDates}
      showYears={req.showYears}
      dateParts={req.dateParts}
      showRelations={req.showRelations}
      collapseGaps={req.collapseGaps}
      compact={req.compact}
      swimlane={req.swimlane}
      callouts={req.callouts}
      exportMode={{
        width: req.width,
        height: req.height,
        svgId: OFFSCREEN_ID,
        title: req.title,
        subtitle: req.subtitle,
        note: req.note,
        footer: req.footer,
      }}
    />,
    (svg) => ({
      svg: detach(svg),
      overflow: svg.dataset.overflow === '1',
      contentHeight: contentHeightOf(svg),
      calloutsDropped: calloutsDroppedOf(svg),
    }),
  )
}

/** 自動長度的最矮高度：內容很少時也不要擠成一條細長條 */
const MIN_AUTO_HEIGHT = 360

/**
 * 「自動長度」：寬度固定，高度拉長到全部內容都放得下。
 *
 * 先用一個試算高度畫一次，讀出繪製端回報的「需要多高」，再用那個高度正式畫。
 * 試算高度要夠大，卡片大事記才會把所有卡片都排進去、算出真正的總高度。
 */
export async function renderWithAutoHeight<Req extends ExportRequestBase, Res extends ContentHeight>(
  render: (req: Req) => Promise<Res>,
  req: Req,
  probeHeight = 200_000,
): Promise<Res & { height: number }> {
  const probe = await render({ ...req, height: probeHeight })
  const height = Math.max(MIN_AUTO_HEIGHT, Math.ceil(probe.contentHeight))
  const final = await render({ ...req, height })
  return { ...final, height }
}
