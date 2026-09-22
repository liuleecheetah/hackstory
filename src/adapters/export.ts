// adapters 層：匯出（.hst.json / SVG / PNG / iframe 嵌入碼）
// 只呼叫 core；不管畫面長怎樣，只負責「把東西變成可下載、可分享的格式」。

import type { TimelineDocument } from '../core'

/**
 * 把文件序列化成 .hst.json 文字。
 * 直接序列化原物件——程式不認識的欄位也會原樣寫回（SPEC 第 10 節的向前相容）。
 */
export function documentToJson(doc: TimelineDocument): string {
  return JSON.stringify(doc, null, 2) + '\n'
}

/** 產生 iframe 嵌入碼 */
export function embedCode(url: string): string {
  return `<iframe src="${url}" width="960" height="600" style="border:1px solid #ddd" title="HackStory 時間軸"></iframe>`
}

/**
 * 把畫面上的 SVG 元素序列化成獨立的 .svg 檔內容（自帶白底與字型設定）。
 * embeddedFontCss：要嵌進去的字型樣式（由 fonts.ts 產生）。PNG 一定要帶，
 * 不然轉檔時看不到思源黑體；SVG 檔可選——帶了檔案會大，但在沒裝字型的電腦上也正確。
 */
export function serializeSvg(
  svg: SVGSVGElement,
  opts: { embeddedFontCss?: string; background?: string } = {},
): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  // 思源黑體排第一：跟網頁畫面同一套字；沒嵌字型、電腦也沒裝時才退回系統字
  clone.setAttribute('font-family', "'Noto Sans TC', system-ui, 'PingFang TC', sans-serif")
  if (opts.embeddedFontCss) {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    style.textContent = opts.embeddedFontCss
    defs.appendChild(style)
    clone.insertBefore(defs, clone.firstChild)
  }
  // 畫面上的白底來自 CSS，存成獨立檔案要自己帶一塊白色背景
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bg.setAttribute('width', '100%')
  bg.setAttribute('height', '100%')
  bg.setAttribute('fill', opts.background ?? '#ffffff')
  // 白底要畫在字型樣式之後、所有內容之前
  clone.insertBefore(bg, opts.embeddedFontCss ? clone.firstChild!.nextSibling : clone.firstChild)
  return new XMLSerializer().serializeToString(clone)
}

/**
 * PNG 能用的最大放大倍率。瀏覽器的畫布有尺寸上限（Safari 約 1600 萬像素、單邊約 3.2 萬像素），
 * 很長的圖用 2 倍、3 倍會超過而畫不出來——超過時降低倍率，保證整張完整（寧可解析度低一點）。
 */
export function safePngScale(width: number, height: number, wanted: number): number {
  const limit = Math.min(Math.sqrt(16_000_000 / (width * height)), 32_000 / Math.max(width, height))
  return Math.min(wanted, Math.floor(limit * 100) / 100)
}

/** SVG 文字 → PNG 圖檔（scale 預設 2 倍，輸出比較清晰） */
export async function svgToPngBlob(
  svgText: string,
  width: number,
  height: number,
  scale = 2,
): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('SVG 圖片載入失敗'))
      img.src = url
    })
    // 等圖片（含嵌入的字型）完全解碼再畫，避免字型還沒套上就被畫進 PNG
    await img.decode().catch(() => {})
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('瀏覽器不支援 canvas')
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('PNG 轉檔失敗'))),
        'image/png',
      ),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * 把 PNG 複製到剪貼簿，可以直接貼進 Keynote／PowerPoint／Google 簡報。
 * 傳入「還在產生中的 PNG」：Safari 規定要在按下按鈕的當下就開始寫剪貼簿，
 * 等圖做好才寫會被拒絕，所以把「等待」交給剪貼簿自己處理。
 * 回傳 false 代表這個瀏覽器不讓複製（呼叫端改成下載）。
 */
export async function copyPngToClipboard(png: Promise<Blob>): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
    return true
  } catch {
    return false
  }
}

/** 觸發瀏覽器下載 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadText(filename: string, text: string, mime: string): void {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }))
}
