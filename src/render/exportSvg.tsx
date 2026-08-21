// render 層：把直式時間軸以指定的尺寸離屏渲染成一張圖
//
// 關鍵設計：**不另外寫一套繪圖程式**。這裡只是把 VerticalTimelineView 切到
// 「匯出模式」（固定寬高、不互動）渲染一次，再把產生的 <svg> 節點取出來。
// 匯出走的是同一段排版與繪製，所以「畫面上看到的」與「存下來的圖」不會長不一樣。
//
// 這一層不知道圖片之後要變成 PNG 還是 SVG 檔——那是 adapters 的事。

import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { TimelineView } from './TimelineView'
import type { TimelineSource } from './types'
import { VerticalTimelineView } from './VerticalTimelineView'

/** 直式與橫式共用的匯出參數 */
export interface ExportRequestBase {
  sources: TimelineSource[]
  /** 目前畫面的可視範圍（壓縮座標 u）——所見即所得 */
  domain: [number, number]
  /** 邏輯尺寸（像素） */
  width: number
  height: number
  showDates: boolean
  showYears: boolean
  showRelations: boolean
  collapseGaps: boolean
  /** 圖片頂部的標題 */
  title: string
  /** 圖片底部的出處小字 */
  footer: string
}

/** 直式另外吃兩個排版選項，匯出的圖才會跟畫面上一致 */
export interface VerticalExportRequest extends ExportRequestBase {
  reversed: boolean
  centerAxis: boolean
}

/** 橫式另外吃「精簡模式」——那是使用者調整「一張圖塞得下幾條軸線」的主要手段 */
export interface HorizontalExportRequest extends ExportRequestBase {
  compact: boolean
}

export interface VerticalExportResult {
  svg: SVGSVGElement
  /** 事件太多、標題排不下（只畫得出圓點）的件數 */
  hidden: number
  /** 欄太窄，標題幾乎只剩省略號 */
  narrowColumns: boolean
}

export interface HorizontalExportResult {
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
      domain={req.domain}
      showDates={req.showDates}
      showYears={req.showYears}
      showRelations={req.showRelations}
      reversed={req.reversed}
      centerAxis={req.centerAxis}
      collapseGaps={req.collapseGaps}
      exportMode={{
        width: req.width,
        height: req.height,
        svgId: OFFSCREEN_ID,
        title: req.title,
        footer: req.footer,
      }}
    />,
    (svg) => ({
      svg: detach(svg),
      hidden: Number(svg.dataset.hidden ?? 0),
      narrowColumns: svg.dataset.narrowColumns === '1',
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
      domain={req.domain}
      showDates={req.showDates}
      showYears={req.showYears}
      showRelations={req.showRelations}
      collapseGaps={req.collapseGaps}
      compact={req.compact}
      exportMode={{
        width: req.width,
        height: req.height,
        svgId: OFFSCREEN_ID,
        title: req.title,
        footer: req.footer,
      }}
    />,
    (svg) => ({ svg: detach(svg), overflow: svg.dataset.overflow === '1' }),
  )
}
