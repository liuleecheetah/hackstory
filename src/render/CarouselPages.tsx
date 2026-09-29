// render 層：輪播（切分成多張圖）的封面與收尾頁
//
// 封面：logo、大標題、副標、時間範圍、「共 N 張，往後滑 →」。
// 收尾頁：行動呼籲（大字）、資料來源清單（放不下寫「…另有 N 筆」）、logo。
// 兩頁底部都有出處行（誠實與可信原則：每一張圖都自帶出處）。
// 字級依畫布大小決定（封面要遠看就讀得到），出處行沿用主題字級，跟內容頁一致。

import { exportFooterHeight, ExportFooter } from './ExportFooter'
import { wrapLines } from './layout'
import type { RenderTheme } from './theme'

/** 內容頁一行出處原本留的高度（與 TimelineView 相同） */
const BASE_FOOTER_H = 22

/** 一筆資料來源：名稱與網址（網址選填） */
export interface CitationLine {
  title: string
  url?: string
}

interface Common {
  width: number
  height: number
  theme: RenderTheme
  footer: string
  /** logo 圖片（data: 網址）；沒有就不畫 */
  logo?: string
  svgId?: string
}

/** 大標題的字級：依畫布短邊決定，直式、橫式都不會太小或爆出去 */
function titleFontFor(width: number, height: number, theme: RenderTheme): number {
  return Math.max(theme.font.title * 1.4, Math.min(width, height * 1.4) * 0.085)
}

function Lines({
  lines,
  x,
  y,
  font,
  lineH,
  fill,
  weight,
}: {
  lines: string[]
  x: number
  y: number
  font: number
  lineH: number
  fill: string
  weight?: number
}) {
  return (
    <text x={x} y={y} fontSize={font} fontWeight={weight} fill={fill}>
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : lineH}>
          {line}
        </tspan>
      ))}
    </text>
  )
}

/** 封面 */
export function CoverPage({
  width,
  height,
  theme,
  footer,
  logo,
  svgId,
  title,
  subtitle,
  rangeText,
  pageCount,
}: Common & {
  title: string
  subtitle?: string
  /** 例如「1947–2000」 */
  rangeText?: string
  /** 整組輪播共幾張（含封面與收尾頁） */
  pageCount: number
}) {
  const C = theme.colors
  const S = theme.scale
  const pad = Math.round(Math.min(width, height) * 0.08)
  const innerW = width - pad * 2
  const footerH = exportFooterHeight(BASE_FOOTER_H * S, footer, undefined, width, theme)

  const titleFont = titleFontFor(width, height, theme)
  const subFont = titleFont * 0.48
  const rangeFont = titleFont * 0.42
  const hintFont = Math.max(theme.font.event, titleFont * 0.34)

  const logoH = logo ? Math.min(height * 0.1, width * 0.14) : 0
  const logoTop = pad
  const hintY = height - footerH - pad * 0.6

  const titleLines = wrapLines(title, innerW, titleFont, 3)
  const subLines = subtitle ? wrapLines(subtitle, innerW, subFont, 2) : []
  const accentH = 6 * S
  const gap = titleFont * 0.45
  const blockH =
    accentH +
    gap +
    titleLines.length * titleFont * 1.2 +
    (subLines.length ? gap * 0.6 + subLines.length * subFont * 1.4 : 0) +
    (rangeText ? gap + rangeFont * 1.2 : 0)
  // 內容區塊放在 logo 下緣與「往後滑」之間的正中間
  const areaTop = logoTop + logoH + (logo ? gap : 0)
  const areaBottom = hintY - hintFont * 1.5
  let y = areaTop + Math.max(0, (areaBottom - areaTop - blockH) / 2)

  const accentY = y
  y += accentH + gap + titleFont * 0.95
  const titleY = y
  y += (titleLines.length - 1) * titleFont * 1.2
  let subY = 0
  if (subLines.length) {
    y += gap * 0.6 + subFont * 1.2
    subY = y
    y += (subLines.length - 1) * subFont * 1.4
  }
  let rangeY = 0
  if (rangeText) {
    y += gap + rangeFont
    rangeY = y
  }

  return (
    <svg id={svgId} width={width} height={height} className="block" style={{ background: C.bg }} data-page-kind="cover">
      <rect x={0} y={0} width={width} height={height} fill={C.bg} />
      {logo && (
        <image href={logo} x={pad} y={logoTop} width={innerW * 0.6} height={logoH} preserveAspectRatio="xMinYMid meet" />
      )}
      <rect x={pad} y={accentY} width={48 * S} height={accentH} rx={accentH / 2} fill={theme.palette[0]} />
      <Lines lines={titleLines} x={pad} y={titleY} font={titleFont} lineH={titleFont * 1.2} fill={C.ink} weight={700} />
      {subLines.length > 0 && (
        <Lines lines={subLines} x={pad} y={subY} font={subFont} lineH={subFont * 1.4} fill={C.inkSoft} />
      )}
      {rangeText && (
        <text x={pad} y={rangeY} fontSize={rangeFont} fontWeight={700} fill={theme.palette[0]}>
          {rangeText}
        </text>
      )}
      {pageCount > 1 && (
        <text x={width - pad} y={hintY} textAnchor="end" fontSize={hintFont} fill={C.inkMuted}>
          共 {pageCount} 張，往後滑 →
        </text>
      )}
      <ExportFooter footer={footer} width={width} height={height} noteX={12 * S} theme={theme} />
    </svg>
  )
}

/** 收尾頁 */
export function ClosingPage({
  width,
  height,
  theme,
  footer,
  logo,
  svgId,
  title,
  callToAction,
  citations,
}: Common & {
  /** 沒有行動呼籲時，頂端改放標題，版面才不會空一大塊 */
  title: string
  callToAction?: string
  citations: CitationLine[]
}) {
  const C = theme.colors
  const S = theme.scale
  const F = theme.font
  const pad = Math.round(Math.min(width, height) * 0.08)
  const innerW = width - pad * 2
  const footerH = exportFooterHeight(BASE_FOOTER_H * S, footer, undefined, width, theme)

  const titleFont = titleFontFor(width, height, theme)
  const cta = callToAction?.trim()
  const headFont = cta ? titleFont * 0.8 : titleFont * 0.6
  const headLines = wrapLines(cta || title, innerW, headFont, cta ? 4 : 2)
  const listHeadFont = Math.max(F.track, headFont * 0.42)
  const itemFont = Math.max(F.event, width * 0.026)
  const itemH = itemFont * 1.5

  const logoH = logo ? Math.min(height * 0.08, width * 0.12) : 0
  const bottom = height - footerH - pad * 0.6 - (logo ? logoH + itemFont : 0)

  let y = pad + headFont
  const headY = y
  y += (headLines.length - 1) * headFont * 1.3

  // 資料來源：一筆一行，太長截短；放不下的寫「…另有 N 筆」
  const rows: string[] = []
  let listHeadY = 0
  if (citations.length > 0) {
    y += headFont * 0.9 + listHeadFont
    listHeadY = y
    y += itemH * 0.4
    const room = Math.max(0, Math.floor((bottom - y) / itemH))
    const all = citations.map((c) => {
      let host = ''
      try {
        host = c.url ? new URL(c.url).hostname.replace(/^www\./, '') : ''
      } catch {
        host = ''
      }
      const text = c.title && host ? `${c.title}（${host}）` : c.title || c.url || ''
      return wrapLines(`・${text}`, innerW, itemFont, 1)[0] ?? ''
    })
    if (all.length <= room) rows.push(...all)
    else if (room > 0) rows.push(...all.slice(0, room - 1), `…另有 ${all.length - (room - 1)} 筆`)
  }

  return (
    <svg id={svgId} width={width} height={height} className="block" style={{ background: C.bg }} data-page-kind="closing">
      <rect x={0} y={0} width={width} height={height} fill={C.bg} />
      <Lines
        lines={headLines}
        x={pad}
        y={headY}
        font={headFont}
        lineH={headFont * 1.3}
        fill={cta ? C.ink : C.inkSoft}
        weight={700}
      />
      {citations.length > 0 && (
        <>
          <text x={pad} y={listHeadY} fontSize={listHeadFont} fontWeight={700} fill={C.inkMuted}>
            資料來源
          </text>
          {rows.map((row, i) => (
            <text key={i} x={pad} y={listHeadY + itemH * 0.4 + (i + 1) * itemH} fontSize={itemFont} fill={C.inkSoft}>
              {row}
            </text>
          ))}
        </>
      )}
      {logo && (
        <image
          href={logo}
          x={pad + innerW * 0.4}
          y={height - footerH - pad * 0.6 - logoH}
          width={innerW * 0.6}
          height={logoH}
          preserveAspectRatio="xMaxYMax meet"
        />
      )}
      <ExportFooter footer={footer} width={width} height={height} noteX={12 * S} theme={theme} />
    </svg>
  )
}
