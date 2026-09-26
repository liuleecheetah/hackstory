// ui 層：匯出對話框
// 下載各圖層的 .hst.json、把目前畫面存成 SVG / PNG、複製 iframe 嵌入碼。

import { useRef, useState } from 'react'
import {
  documentToJson,
  downloadBlob,
  downloadText,
  embedCode,
  serializeSvg,
} from '../adapters/export'
import { missingGlyphNote, svgToPngWithFonts } from '../adapters/fonts'
import { documentToMarkdown } from '../adapters/markdown'
import type { Layer } from '../compose/useLayers'
import { validateDocument } from '../core'

interface Props {
  open: boolean
  onClose: () => void
  layers: Layer[]
  /** 使用者下載了 .hst.json。coveredAll = 這次下載涵蓋了所有圖層 */
  onDownloaded?: (coveredAll: boolean) => void
  /** 目前的檢視方向：分享出去的連結要跟「我現在看到的樣子」一致 */
  orientation?: 'horizontal' | 'vertical'
  /** 開啟出圖工作室（比例出圖搬到那裡了） */
  onOpenStudio: () => void
}

/** 畫面上時間軸 SVG 的 id（render 層掛的） */
const SVG_ID = 'hackstory-timeline-svg'

export function ExportDialog({
  open,
  onClose,
  layers,
  onDownloaded,
  orientation = 'horizontal',
  onOpenStudio,
}: Props) {
  const [message, setMessage] = useState<string | null>(null)
  // 分享連結：使用者把 .hst.json 放上公開網址（或用公開試算表）後貼進來
  const [shareSrc, setShareSrc] = useState('')
  const shareInputRef = useRef<HTMLInputElement>(null)

  const say = (msg: string, ms = 3000) => {
    setMessage(msg)
    window.setTimeout(() => setMessage(null), ms)
  }



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
    say('正在嵌入字型、產生 PNG…', 10_000)
    void svgToPngWithFonts(svg, width, height)
      .then(({ blob, missing }) => {
        downloadBlob('hackstory-timeline.png', blob)
        const note = missingGlyphNote(missing)
        say(`已下載 PNG 圖片${note ? '；' + note : ''}`, note ? 8000 : 3000)
      })
      .catch((e: Error) => say(`匯出失敗：${e.message}`))
  }

  // 只有直式才寫進網址：橫式不標記，嵌入到手機上時才能自動切成好讀的直式
  const orientParam = orientation === 'vertical' ? '&orient=vertical' : ''

  const copy = (text: string, what: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => say(`已複製${what}`))
      .catch(() => say('複製失敗——請直接框選文字手動複製'))
  }

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
      <div className="flex max-h-[88vh] w-[560px] max-w-full flex-col rounded-lg bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-base font-bold text-ink">匯出與分享</h2>
          <button type="button" onClick={onClose} className="text-ink-faint hover:text-ink">
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-5 overflow-y-auto p-5">
          {/* .hst.json */}
          <section>
            <h3 className="mb-1 text-base font-semibold text-ink">下載時間軸檔案（.hst.json）</h3>
            <p className="mb-2 text-sm text-ink-faint">
              每個圖層是一份可攜的檔案：可以備份、寄給別人、或在這裡重新載入疊加。
            </p>
            <ul className="space-y-1">
              {layers.map((layer) => (
                <li key={layer.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-base text-ink">
                    {layer.doc.meta.title}
                    <span className="ml-2 text-sm text-ink-faint">
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
                    className="btn text-base"
                  >
                    下載
                  </button>
                </li>
              ))}
              {layers.length === 0 && (
                <li className="text-sm text-ink-faint">目前沒有圖層</li>
              )}
            </ul>
            {layers.length > 1 && (
              <button
                type="button"
                onClick={handleDownloadAll}
                className="btn btn-primary text-base mt-2"
              >
                下載全部（{layers.length} 份）
              </button>
            )}
          </section>

          {/* Markdown 大事記 */}
          <section>
            <h3 className="mb-1 text-base font-semibold text-ink">
              匯出大事記（Markdown）
            </h3>
            <p className="mb-2 text-sm text-ink-faint">
              依時間排序的中文大事記，可直接貼進 HackMD、共筆或報導草稿。適合對外說明；要完整資料仍請用上面的
              .hst.json。
            </p>
            <ul className="space-y-1">
              {layers.map((layer) => (
                <li key={layer.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-base text-ink">
                    {layer.doc.meta.title}
                    <span className="ml-2 text-sm text-ink-faint">
                      {layer.doc.events.length} 筆事件
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => downloadMarkdown(layer)}
                    className="btn text-base"
                  >
                    下載 .md
                  </button>
                </li>
              ))}
              {layers.length === 0 && <li className="text-sm text-ink-faint">目前沒有圖層</li>}
            </ul>
          </section>

          {/* 分享連結（免後端） */}
          <section>
            <h3 className="mb-1 text-base font-semibold text-ink">分享連結</h3>
            <p className="mb-2 text-sm leading-relaxed text-ink-faint">
              把上面下載的 .hst.json 放上任何公開網址（最簡單：GitHub 或 Gist 的 raw
              網址），或直接用「公開的 Google 試算表」網址——貼進下面，就會產生一個開啟即見的分享連結。
            </p>
            <input
              ref={shareInputRef}
              type="url"
              value={shareSrc}
              onChange={(e) => setShareSrc(e.target.value)}
              placeholder="https://raw.githubusercontent.com/... 或 https://docs.google.com/spreadsheets/..."
              className="mb-2 w-full rounded border border-line px-3 py-2 text-base"
            />
            {shareLink && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={shareLink}
                    onFocus={(e) => e.target.select()}
                    className="min-w-0 flex-1 rounded border border-line bg-surface-alt px-2 py-1.5 font-mono text-sm text-ink"
                  />
                  <button
                    type="button"
                    onClick={() => copy(shareLink, '分享連結')}
                    className="btn btn-primary text-base shrink-0"
                  >
                    複製連結
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={shareEmbedHtml}
                    onFocus={(e) => e.target.select()}
                    className="min-w-0 flex-1 rounded border border-line bg-surface-alt px-2 py-1.5 font-mono text-sm text-ink"
                  />
                  <button
                    type="button"
                    onClick={() => copy(shareEmbedHtml, '嵌入碼')}
                    className="btn text-base shrink-0"
                  >
                    複製嵌入碼
                  </button>
                </div>
                <p className="text-sm text-ink-faint">
                  想同時分享多份：在連結後面繼續接 <code>&src=另一個網址</code>，開啟時會疊成多個圖層。
                </p>
              </div>
            )}
          </section>

          {/* 圖片 */}
          <section>
            <h3 className="mb-1 text-base font-semibold text-ink">匯出目前畫面為圖片</h3>
            <p className="mb-2 text-sm text-ink-faint">
              時間範圍依你目前的縮放；軸線則會全部畫進去，包含捲出畫面外的部分。
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSvg}
                className="btn"
              >
                下載 SVG（向量）
              </button>
              <button
                type="button"
                onClick={handlePng}
                className="btn"
              >
                下載 PNG（點陣，2 倍解析度）
              </button>
            </div>
          </section>

          {/* 出圖工作室：選版型、比例、主題、標題，做簡報用的圖 */}
          <section>
            <h3 className="mb-1 text-base font-semibold text-ink">出圖工作室</h3>
            <p className="mb-2 text-sm text-ink-faint">
              要做簡報或社群用的圖？在工作室裡選版型、比例、主題與標題，預覽就是下載下來的樣子。
            </p>
            <button type="button" onClick={onOpenStudio} className="btn btn-primary">
              開啟出圖工作室
            </button>
          </section>

          {/* iframe：嵌入碼一定要指向使用者自己的資料。
              沒有後端，網站本身不存任何人的時間軸——沒有公開網址的嵌入碼只會顯示內建範例，
              貼進報導就是刊出事故，所以寧可不給，也不給錯的 */}
          <section>
            <h3 className="mb-1 text-base font-semibold text-ink">嵌入到其他網頁（iframe）</h3>
            {shareEmbedHtml ? (
              <>
                <p className="mb-2 text-sm text-ink-faint">
                  把下面這段貼進部落格或網站的 HTML，就會顯示這份時間軸（資料來自你在「分享連結」填的網址）。
                </p>
                <textarea
                  readOnly
                  value={shareEmbedHtml}
                  rows={3}
                  onFocus={(e) => e.target.select()}
                  className="w-full rounded border border-line bg-surface-alt p-2 font-mono text-sm text-ink"
                />
                <button
                  type="button"
                  onClick={() => copy(shareEmbedHtml, '嵌入碼')}
                  className="btn btn-primary mt-2"
                >
                  複製嵌入碼
                </button>
              </>
            ) : (
              <>
                <p className="mb-2 text-sm leading-relaxed text-ink-muted">
                  嵌入碼要能顯示<strong>你的</strong>時間軸，資料必須先放在公開網址上（本網站不替你保存檔案）。
                  請先在上面的「分享連結」貼上 .hst.json 或公開 Google 試算表的網址，這裡就會出現對應的嵌入碼。
                </p>
                <button
                  type="button"
                  onClick={() => {
                    shareInputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                    shareInputRef.current?.focus()
                  }}
                  className="btn"
                >
                  前往填寫公開網址
                </button>
              </>
            )}
          </section>

          {message && (
            <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-base text-green-800">
              {message}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
