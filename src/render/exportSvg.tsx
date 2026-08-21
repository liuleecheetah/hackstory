// render 層：把直式時間軸以指定的尺寸離屏渲染成一張圖
//
// 關鍵設計：**不另外寫一套繪圖程式**。這裡只是把 VerticalTimelineView 切到
// 「匯出模式」（固定寬高、不互動）渲染一次，再把產生的 <svg> 節點取出來。
// 匯出走的是同一段排版與繪製，所以「畫面上看到的」與「存下來的圖」不會長不一樣。
//
// 這一層不知道圖片之後要變成 PNG 還是 SVG 檔——那是 adapters 的事。

import { createRoot } from 'react-dom/client'
import type { TimelineSource } from './types'
import { VerticalTimelineView } from './VerticalTimelineView'

export interface VerticalExportRequest {
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

export interface VerticalExportResult {
  svg: SVGSVGElement
  /** 事件太多、標題排不下（只畫得出圓點）的件數 */
  hidden: number
  /** 欄太窄，標題幾乎只剩省略號 */
  narrowColumns: boolean
}

/** 離屏渲染時用的 id，避免與畫面上的時間軸 SVG 撞名 */
const OFFSCREEN_ID = 'hackstory-export-svg'

/**
 * 以指定尺寸渲染一張直式時間軸，回傳可以序列化的 SVG 元素（呼叫端自行決定要存成什麼）。
 *
 * 作法：掛一個看不見的容器到頁面上（要真的掛上去，字型與尺寸才算得準），
 * 渲染完取出節點、立刻拆掉。
 */
export function renderVerticalExportSvg(
  req: VerticalExportRequest,
): Promise<VerticalExportResult> {
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

    root.render(
      <VerticalTimelineView
        sources={req.sources}
        domain={req.domain}
        showDates={req.showDates}
        showYears={req.showYears}
        showRelations={req.showRelations}
        collapseGaps={req.collapseGaps}
        exportMode={{
          width: req.width,
          height: req.height,
          svgId: OFFSCREEN_ID,
          title: req.title,
          footer: req.footer,
        }}
      />,
    )

    // 等瀏覽器畫完一個影格，DOM 才真的存在。
    // 分頁切到背景時 requestAnimationFrame 不會觸發，所以加一個計時器保底——
    // 否則使用者切走再切回來，預覽會永遠停在「產生預覽中…」
    let done = false
    const whenReady = (run: () => void) => {
      if (done) return
      done = true
      run()
    }
    const extract = () => {
      try {
        const svg = host.querySelector('svg')
        if (!(svg instanceof SVGSVGElement)) throw new Error('離屏渲染沒有產生 SVG')
        // 取出來的是副本，取完就可以把離屏容器拆掉
        const clone = svg.cloneNode(true) as SVGSVGElement
        clone.removeAttribute('id')
        resolve({
          svg: clone,
          hidden: Number(svg.dataset.hidden ?? 0),
          narrowColumns: svg.dataset.narrowColumns === '1',
        })
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      } finally {
        cleanup()
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(() => whenReady(extract)))
    setTimeout(() => whenReady(extract), 150)
  })
}
