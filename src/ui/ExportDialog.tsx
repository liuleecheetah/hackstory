// ui 層：匯出對話框
// 下載各圖層的 .hst.json、把目前畫面存成 SVG / PNG、複製 iframe 嵌入碼。

import { useEffect, useState } from 'react'
import {
  documentToJson,
  downloadBlob,
  downloadText,
  embedCode,
  serializeSvg,
  svgToPngBlob,
} from '../adapters/export'
import { documentToMarkdown } from '../adapters/markdown'
import type { Layer } from '../compose/useLayers'
import { validateDocument } from '../core'
import { renderVerticalExportSvg } from '../render/exportSvg'
import type { TimelineSource } from '../render/types'

interface Props {
  open: boolean
  onClose: () => void
  layers: Layer[]
  /** 使用者下載了 .hst.json。coveredAll = 這次下載涵蓋了所有圖層 */
  onDownloaded?: (coveredAll: boolean) => void
  /** 目前的檢視方向：分享出去的連結要跟「我現在看到的樣子」一致 */
  orientation?: 'horizontal' | 'vertical'
  /** 目前顯示中的圖層（比例匯出要重畫一張，所以需要原始資料） */
  sources?: TimelineSource[]
  /** 目前畫面的可視時間範圍（壓縮座標 u）——比例匯出照這個範圍出圖 */
  viewDomain?: [number, number] | null
  showDates?: boolean
  showYears?: boolean
  collapseGaps?: boolean
}

/**
 * 直式圖片的比例。w/h 是邏輯尺寸，PNG 一律 2 倍輸出
 * （9:16 → 1080×1920、A4 → 1240×1754）。
 */
const RATIO_PRESETS = [
  { id: '9-16', label: '9:16', hint: '手機全螢幕／限時動態', w: 540, h: 960 },
  { id: '4-5', label: '4:5', hint: '社群貼文（直式）', w: 540, h: 675 },
  { id: '3-4', label: '3:4', hint: '一般直式', w: 540, h: 720 },
  { id: '1-1', label: '1:1', hint: '方形', w: 540, h: 540 },
  { id: 'a4', label: 'A4', hint: '直式列印', w: 620, h: 877 },
] as const

type RatioId = (typeof RATIO_PRESETS)[number]['id']

/** 畫面上時間軸 SVG 的 id（render 層掛的） */
const SVG_ID = 'hackstory-timeline-svg'

export function ExportDialog({
  open,
  onClose,
  layers,
  onDownloaded,
  orientation = 'horizontal',
  sources = [],
  viewDomain,
  showDates = true,
  showYears = true,
  collapseGaps = false,
}: Props) {
  const [message, setMessage] = useState<string | null>(null)
  // 分享連結：使用者把 .hst.json 放上公開網址（或用公開試算表）後貼進來
  const [shareSrc, setShareSrc] = useState('')
  // 比例匯出：選中的比例、縮圖預覽、以及畫不好時要提醒的話
  const [ratio, setRatio] = useState<RatioId | null>(null)
  const [preview, setPreview] = useState<{ url: string; warnings: string[] } | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)

  const say = (msg: string) => {
    setMessage(msg)
    window.setTimeout(() => setMessage(null), 3000)
  }

  const preset = RATIO_PRESETS.find((r) => r.id === ratio) ?? null

  /** 圖片頂部標題與底部出處：讓輸出的圖自帶脈絡 */
  const imageTitle =
    layers.length === 1
      ? layers[0].doc.meta.title
      : layers.length > 1
        ? `${layers[0].doc.meta.title} 等 ${layers.length} 份`
        : 'HackStory'
  const today = new Date()
  const imageFooter = `以 HackStory 製作 · ${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`

  /** 依目前選的比例重畫一張直式時間軸（畫面上是橫式也一樣，圖片一律直式） */
  const renderRatio = async (p: NonNullable<typeof preset>) => {
    if (!viewDomain) throw new Error('還沒有可以出圖的時間範圍')
    return renderVerticalExportSvg({
      sources,
      domain: viewDomain,
      width: p.w,
      height: p.h,
      showDates,
      showYears,
      collapseGaps,
      title: imageTitle,
      footer: imageFooter,
    })
  }

  // 選了比例（或畫面範圍改了）就重畫縮圖預覽
  useEffect(() => {
    if (!open || !preset || !viewDomain || sources.length === 0) {
      setPreview(null)
      setPreviewBusy(false)
      return
    }
    let cancelled = false
    setPreviewBusy(true)
    void renderRatio(preset)
      .then(({ svg, hidden, narrowColumns }) => {
        if (cancelled) return
        const warnings: string[] = []
        if (narrowColumns) {
          warnings.push('欄寬過窄，建議選更寬的比例，或在左側面板暫時隱藏部分圖層／軸線')
        }
        if (hidden > 0) {
          warnings.push(
            `這段時間的事件太多，有 ${hidden} 件只畫得出圓點、放不下標題——請先在畫面上縮放到較短的期間，或選更長的比例`,
          )
        }
        const text = serializeSvg(svg)
        setPreview({
          url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`,
          warnings,
        })
      })
      .catch((e: Error) => {
        if (!cancelled) say(`預覽失敗：${e.message}`)
      })
      .finally(() => {
        if (!cancelled) setPreviewBusy(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ratio, viewDomain, sources, showDates, showYears, collapseGaps])

  if (!open) return null

  const getSvg = (): SVGSVGElement | null => {
    const svg = document.getElementById(SVG_ID)
    if (!(svg instanceof SVGSVGElement)) {
      say('找不到時間軸畫面——請先確認至少有一個顯示中的圖層')
      return null
    }
    return svg
  }

  const handleSvg = () => {
    const svg = getSvg()
    if (!svg) return
    downloadText('hackstory-timeline.svg', serializeSvg(svg), 'image/svg+xml')
    say('已下載 SVG 圖片')
  }

  const handlePng = () => {
    const svg = getSvg()
    if (!svg) return
    const width = svg.width.baseVal.value
    const height = svg.height.baseVal.value
    void svgToPngBlob(serializeSvg(svg), width, height)
      .then((blob) => {
        downloadBlob('hackstory-timeline.png', blob)
        say('已下載 PNG 圖片')
      })
      .catch((e: Error) => say(`匯出失敗：${e.message}`))
  }

  // 只有直式才寫進網址：橫式不標記，嵌入到手機上時才能自動切成好讀的直式
  const orientParam = orientation === 'vertical' ? '&orient=vertical' : ''
  /** 依比例下載：SVG 直接存，PNG 一律 2 倍解析度 */
  const downloadRatio = (kind: 'svg' | 'png') => {
    if (!preset) return
    void renderRatio(preset)
      .then(async ({ svg }) => {
        const text = serializeSvg(svg)
        const name = `hackstory-${preset.id}`
        if (kind === 'svg') {
          downloadText(`${name}.svg`, text, 'image/svg+xml')
          say(`已下載 ${preset.label} SVG`)
          return
        }
        const blob = await svgToPngBlob(text, preset.w, preset.h, 2)
        downloadBlob(`${name}.png`, blob)
        say(`已下載 ${preset.label} PNG（${preset.w * 2}×${preset.h * 2}）`)
      })
      .catch((e: Error) => say(`匯出失敗：${e.message}`))
  }

  const embedUrl = `${window.location.origin}${window.location.pathname}?embed=1${orientParam}`
  const embedHtml = embedCode(embedUrl)

  const copy = (text: string, what: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => say(`已複製${what}`))
      .catch(() => say('複製失敗——請直接框選文字手動複製'))
  }

  const handleCopyEmbed = () => copy(embedHtml, '嵌入碼')

  /** 下載一個圖層，下載前先做整份文件驗證——不合法就拒絕，避免產出壞檔案 */
  const downloadLayer = (layer: Layer): boolean => {
    const check = validateDocument(layer.doc)
    if (!check.ok) {
      const first = check.errors[0]
      say(
        `「${layer.doc.meta.title}」未通過驗證，未下載：${first ? `${first.path} ${first.message}` : ''}` +
          (check.errors.length > 1 ? `（共 ${check.errors.length} 個問題）` : ''),
      )
      return false
    }
    downloadText(`${layer.doc.id}.hst.json`, documentToJson(layer.doc), 'application/json')
    return true
  }

  const handleDownloadAll = () => {
    let ok = 0
    for (const layer of layers) {
      if (downloadLayer(layer)) ok++
    }
    if (ok === layers.length) {
      say(`已下載全部 ${ok} 份`)
      onDownloaded?.(true)
    } else {
      say(`已下載 ${ok}／${layers.length} 份——有圖層未通過驗證，請修正後再下載`)
    }
  }

  /** 下載一個圖層的 Markdown 大事記（純文字，不影響 dirty 狀態——這是衍生輸出，不算「保存」） */
  const downloadMarkdown = (layer: Layer) => {
    downloadText(`${layer.doc.id}.md`, documentToMarkdown(layer.doc), 'text/markdown')
    say(`已下載大事記 ${layer.doc.id}.md`)
  }

  // 分享連結與對應的嵌入碼
  const shareBase = `${window.location.origin}${window.location.pathname}`
  const trimmedSrc = shareSrc.trim()
  const shareLink = trimmedSrc
    ? `${shareBase}?src=${encodeURIComponent(trimmedSrc)}${orientParam}`
    : ''
  const shareEmbedHtml = trimmedSrc
    ? embedCode(`${shareBase}?embed=1&src=${encodeURIComponent(trimmedSrc)}${orientParam}`)
    : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[88vh] w-[560px] max-w-full flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-bold text-slate-800">匯出與分享</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-5 overflow-y-auto p-5">
          {/* .hst.json */}
          <section>
            <h3 className="mb-1 text-sm font-semibold text-slate-700">下載時間軸檔案（.hst.json）</h3>
            <p className="mb-2 text-xs text-slate-400">
              每個圖層是一份可攜的檔案：可以備份、寄給別人、或在這裡重新載入疊加。
            </p>
            <ul className="space-y-1">
              {layers.map((layer) => (
                <li key={layer.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                    {layer.doc.meta.title}
                    <span className="ml-2 text-xs text-slate-400">
                      {layer.doc.events.length} 筆事件
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (downloadLayer(layer)) {
                        say(`已下載 ${layer.doc.id}.hst.json`)
                        onDownloaded?.(layers.length === 1)
                      }
                    }}
                    className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
                  >
                    下載
                  </button>
                </li>
              ))}
              {layers.length === 0 && (
                <li className="text-xs text-slate-400">目前沒有圖層</li>
              )}
            </ul>
            {layers.length > 1 && (
              <button
                type="button"
                onClick={handleDownloadAll}
                className="mt-2 rounded bg-slate-800 px-3 py-1.5 text-xs text-white hover:bg-slate-700"
              >
                下載全部（{layers.length} 份）
              </button>
            )}
          </section>

          {/* Markdown 大事記 */}
          <section>
            <h3 className="mb-1 text-sm font-semibold text-slate-700">
              匯出大事記（Markdown）
            </h3>
            <p className="mb-2 text-xs text-slate-400">
              依時間排序的中文大事記，可直接貼進 HackMD、共筆或報導草稿。適合對外說明；要完整資料仍請用上面的
              .hst.json。
            </p>
            <ul className="space-y-1">
              {layers.map((layer) => (
                <li key={layer.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                    {layer.doc.meta.title}
                    <span className="ml-2 text-xs text-slate-400">
                      {layer.doc.events.length} 筆事件
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => downloadMarkdown(layer)}
                    className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
                  >
                    下載 .md
                  </button>
                </li>
              ))}
              {layers.length === 0 && <li className="text-xs text-slate-400">目前沒有圖層</li>}
            </ul>
          </section>

          {/* 分享連結（免後端） */}
          <section>
            <h3 className="mb-1 text-sm font-semibold text-slate-700">分享連結</h3>
            <p className="mb-2 text-xs leading-relaxed text-slate-400">
              把上面下載的 .hst.json 放上任何公開網址（最簡單：GitHub 或 Gist 的 raw
              網址），或直接用「公開的 Google 試算表」網址——貼進下面，就會產生一個開啟即見的分享連結。
            </p>
            <input
              type="url"
              value={shareSrc}
              onChange={(e) => setShareSrc(e.target.value)}
              placeholder="https://raw.githubusercontent.com/... 或 https://docs.google.com/spreadsheets/..."
              className="mb-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
            {shareLink && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={shareLink}
                    onFocus={(e) => e.target.select()}
                    className="min-w-0 flex-1 rounded border border-slate-300 bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-700"
                  />
                  <button
                    type="button"
                    onClick={() => copy(shareLink, '分享連結')}
                    className="shrink-0 rounded bg-slate-800 px-3 py-1.5 text-xs text-white hover:bg-slate-700"
                  >
                    複製連結
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={shareEmbedHtml}
                    onFocus={(e) => e.target.select()}
                    className="min-w-0 flex-1 rounded border border-slate-300 bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-700"
                  />
                  <button
                    type="button"
                    onClick={() => copy(shareEmbedHtml, '嵌入碼')}
                    className="shrink-0 rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
                  >
                    複製嵌入碼
                  </button>
                </div>
                <p className="text-xs text-slate-400">
                  想同時分享多份：在連結後面繼續接 <code>&src=另一個網址</code>，開啟時會疊成多個圖層。
                </p>
              </div>
            )}
          </section>

          {/* 圖片 */}
          <section>
            <h3 className="mb-1 text-sm font-semibold text-slate-700">匯出目前畫面為圖片</h3>
            <p className="mb-2 text-xs text-slate-400">
              時間範圍依你目前的縮放；軸線則會全部畫進去，包含捲出畫面外的部分。
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSvg}
                className="rounded border border-slate-300 px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                下載 SVG（向量）
              </button>
              <button
                type="button"
                onClick={handlePng}
                className="rounded border border-slate-300 px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                下載 PNG（點陣，2 倍解析度）
              </button>
            </div>
          </section>

          {/* 直式圖片（選比例） */}
          <section>
            <h3 className="mb-1 text-sm font-semibold text-slate-700">直式圖片（選比例）</h3>
            <p className="mb-2 text-xs text-slate-400">
              重新畫成適合手機與社群的直式長圖，用的是你目前看到的時間範圍。
            </p>
            <div className="mb-3 flex flex-wrap gap-2">
              {RATIO_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.hint}
                  onClick={() => setRatio(ratio === p.id ? null : p.id)}
                  className={
                    'rounded border px-3 py-1.5 text-sm transition-colors ' +
                    (ratio === p.id
                      ? 'border-slate-800 bg-slate-800 text-white'
                      : 'border-slate-300 text-slate-700 hover:bg-slate-100')
                  }
                >
                  {p.label}
                  <span
                    className={
                      'ml-1.5 text-xs ' + (ratio === p.id ? 'text-slate-300' : 'text-slate-400')
                    }
                  >
                    {p.hint}
                  </span>
                </button>
              ))}
            </div>

            {preset && (
              <div className="flex items-start gap-4">
                <div
                  className="shrink-0 overflow-hidden rounded border border-slate-200 bg-white"
                  style={{ width: 160, height: Math.round((160 * preset.h) / preset.w) }}
                >
                  {preview ? (
                    <img src={preview.url} alt="預覽" className="h-full w-full object-contain" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                      {previewBusy ? '產生預覽中…' : '沒有可預覽的內容'}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="mb-2 text-xs text-slate-500">
                    {preset.w * 2}×{preset.h * 2} 像素（PNG 為 2 倍解析度）
                  </p>
                  <div className="mb-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => downloadRatio('png')}
                      className="rounded border border-slate-300 px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
                    >
                      下載 PNG
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadRatio('svg')}
                      className="rounded border border-slate-300 px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
                    >
                      下載 SVG
                    </button>
                  </div>
                  {preview?.warnings.map((w) => (
                    <p key={w} className="text-xs text-amber-700">
                      ⚠ {w}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* iframe */}
          <section>
            <h3 className="mb-1 text-sm font-semibold text-slate-700">嵌入到其他網頁（iframe）</h3>
            <p className="mb-2 text-xs text-slate-400">
              把下面這段貼進部落格或網站的 HTML，就會顯示乾淨的時間軸檢視（部署上線後網址會自動變成正式網址）。
            </p>
            <textarea
              readOnly
              value={embedHtml}
              rows={3}
              onFocus={(e) => e.target.select()}
              className="w-full rounded border border-slate-300 bg-slate-50 p-2 font-mono text-xs text-slate-700"
            />
            <button
              type="button"
              onClick={handleCopyEmbed}
              className="mt-2 rounded bg-slate-800 px-4 py-1.5 text-sm text-white hover:bg-slate-700"
            >
              複製嵌入碼
            </button>
          </section>

          {message && (
            <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              {message}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
