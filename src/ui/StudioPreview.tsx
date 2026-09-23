// ui 層：出圖工作室的即時預覽
//
// 把離屏畫好的 SVG 直接放進頁面（不是轉成圖片），這樣預覽用的就是網頁已載入的思源黑體，
// 看到的字跟下載的 PNG 一致。再依可用空間等比例縮放，整張圖永遠完整可見。

import { useEffect, useMemo, useRef, useState } from 'react'
import { serializeSvg } from '../adapters/export'

interface Props {
  /** 離屏畫好的圖（null = 還沒畫好） */
  svg: SVGSVGElement | null
  width: number
  height: number
  /** 圖片底色（深底主題不是白色） */
  background: string
  busy: boolean
  warnings: string[]
  /** 不是問題、但要讓人知道的事（例如文字自動縮小了） */
  info?: string
  /** 有事件放不下、不能下載的原因 */
  blocked?: string
  error: string | null
}

/**
 * 預覽放進頁面後，SVG 裡的 id（漸層、箭頭、裁切框）會跟畫面上時間軸的 id 重名，
 * 瀏覽器會拿錯定義。全部加上前綴避開。
 */
function isolateIds(svgText: string): string {
  return svgText.replace(/\bid="([^"]+)"/g, 'id="studio-$1"').replace(/url\(#/g, 'url(#studio-')
}

export function StudioPreview({ svg, width, height, background, busy, warnings, info, blocked, error }: Props) {
  const areaRef = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setArea({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const markup = useMemo(() => {
    if (!svg) return null
    const text = isolateIds(serializeSvg(svg, { background }))
    // 加上 viewBox 並讓它填滿外框，縮放交給外框的尺寸決定
    return text.replace(
      /^<svg([^>]*?)\swidth="[^"]*"([^>]*?)\sheight="[^"]*"/,
      `<svg$1 viewBox="0 0 ${width} ${height}" width="100%"$2 height="100%"`,
    )
  }, [svg, width, height, background])

  // 等比例塞進可用空間。很長的圖（自動長度）整張塞進來會小到看不清，
  // 那種情況改成「寬度填滿、上下捲動」
  const fitAll = area.w > 0 && area.h > 0 ? Math.min(area.w / width, area.h / height) : 0
  const fitWidth = area.w > 0 ? Math.min(area.w / width, 1) : 0
  const scrolling = fitAll > 0 && fitAll < fitWidth * 0.5
  const scale = scrolling ? fitWidth : fitAll
  const boxW = width * scale
  const boxH = height * scale

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {blocked && (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <p>✕ {blocked}</p>
        </div>
      )}
      {info && (
        <div className="rounded border border-line bg-surface px-3 py-2 text-sm text-ink-muted">
          <p>ⓘ {info}</p>
        </div>
      )}
      {/* 畫不好的地方直接講清楚（沿用匯出對話框的文案） */}
      {(warnings.length > 0 || error) && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {error && <p>預覽失敗：{error}</p>}
          {warnings.map((w) => (
            <p key={w}>⚠ {w}</p>
          ))}
        </div>
      )}
      <div ref={areaRef} className={'relative min-h-0 flex-1 ' + (scrolling ? 'overflow-y-auto' : '')}>
        {markup && scale > 0 && (
          <div
            className={
              'shadow-lg ring-1 ring-line ' +
              (scrolling
                ? 'mx-auto'
                : 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2')
            }
            style={{ width: boxW, height: boxH, background }}
            dangerouslySetInnerHTML={{ __html: markup }}
          />
        )}
        {(busy || !markup) && (
          <div className="absolute right-2 top-2 rounded bg-surface/90 px-2 py-1 text-sm text-ink-muted shadow">
            {markup ? '更新預覽中…' : '產生預覽中…'}
          </div>
        )}
      </div>
      <p className="text-center text-sm text-ink-faint">
        實際尺寸 {width}×{height} · 預覽縮放 {Math.round(scale * 100)}%
        {scrolling && ' · 長圖：上下捲動看全部'}
      </p>
    </div>
  )
}
