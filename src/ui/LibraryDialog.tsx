// ui 層：共用庫對話框
// 上半部：官方精選目錄（share 層讀取），一鍵載入成圖層；
// 下半部：貼上任何人分享的 .hst.json 或 Google 試算表公開網址載入。
// 想把自己的時間軸上架，目前用 GitHub issue 投稿，由維護者審核（見 docs/share-plan.md）。

import { useEffect, useState } from 'react'
import { loadFromUrl } from '../adapters/remote'
import type { TimelineDocument } from '../core'
import type { LibraryEntry } from '../share/library'
import { fetchLibraryIndex, resolveLibraryUrl } from '../share/library'

interface Props {
  open: boolean
  onClose: () => void
  /** 載入成功：把文件交給上層（App 會加成新圖層） */
  onLoad: (doc: TimelineDocument) => void
}

export function LibraryDialog({ open, onClose, onLoad }: Props) {
  // 目錄只抓一次：null = 還沒抓（或抓失敗待重試）
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null)
  const [indexError, setIndexError] = useState<string | null>(null)
  // 正在載入的目錄項 id；已載入過的目錄項 id（顯示 ✓，仍可再載一份）
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [loadedIds, setLoadedIds] = useState<string[]>([])
  // 貼網址載入
  const [url, setUrl] = useState('')
  const [urlLoading, setUrlLoading] = useState(false)
  // 最近一次操作的結果訊息（成功綠色、失敗紅色）
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  // 打開面板時抓目錄（失敗後再打開會重試）
  useEffect(() => {
    if (!open || entries !== null) return
    setIndexError(null)
    void fetchLibraryIndex().then((result) => {
      if (result.ok) {
        setEntries(result.entries)
      } else {
        setIndexError(result.error)
      }
    })
  }, [open, entries])

  if (!open) return null

  const close = () => {
    setNotice(null)
    setUrl('')
    onClose()
  }

  /** 共用的載入流程：目錄項與貼網址都走這裡 */
  const loadUrl = async (absoluteUrl: string, doneLabel: string) => {
    const result = await loadFromUrl(absoluteUrl)
    if (result.ok) {
      onLoad(result.doc)
      setNotice({
        kind: 'ok',
        text:
          `已把「${result.doc.meta.title}」載入成新圖層` +
          (result.notice ? `（${result.notice}）` : ''),
      })
      return true
    }
    setNotice({ kind: 'error', text: `${doneLabel}載入失敗：${result.error}` })
    return false
  }

  const handleEntry = async (entry: LibraryEntry) => {
    setLoadingId(entry.id)
    setNotice(null)
    const ok = await loadUrl(resolveLibraryUrl(entry.url), `「${entry.title}」`)
    setLoadingId(null)
    if (ok && !loadedIds.includes(entry.id)) {
      setLoadedIds([...loadedIds, entry.id])
    }
  }

  const handleUrl = async () => {
    setUrlLoading(true)
    setNotice(null)
    const ok = await loadUrl(url.trim(), '這個網址')
    setUrlLoading(false)
    if (ok) setUrl('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[88vh] w-[640px] max-w-full flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-bold text-slate-800">共用庫</h2>
          <button type="button" onClick={close} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
          {/* 操作結果訊息 */}
          {notice && (
            <p
              className={
                'rounded border px-3 py-2 text-sm ' +
                (notice.kind === 'ok'
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-red-200 bg-red-50 text-red-700')
              }
            >
              {notice.text}
            </p>
          )}

          <section>
            <h3 className="mb-1 text-sm font-semibold text-slate-700">精選時間軸</h3>
            <p className="mb-3 text-xs text-slate-400">
              點「載入」把時間軸加成一個圖層，跟你手上的軸疊加對比。載入後可自由編輯，不會影響原始檔案。
            </p>

            {indexError && (
              <div className="flex items-center gap-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {indexError}
                <button
                  type="button"
                  onClick={() => {
                    setIndexError(null)
                    setEntries(null) // 清掉才會重抓
                  }}
                  className="rounded border border-red-300 px-2 py-0.5 text-xs hover:bg-red-100"
                >
                  重試
                </button>
              </div>
            )}
            {!indexError && entries === null && (
              <p className="text-sm text-slate-400">正在讀取目錄⋯</p>
            )}

            {entries !== null && (
              <ul className="space-y-2">
                {entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-start gap-3 rounded border border-slate-200 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800">
                        {entry.title}
                        {entry.period && (
                          <span className="ml-2 text-xs font-normal text-slate-400">
                            {entry.period}
                          </span>
                        )}
                      </p>
                      {entry.description && (
                        <p className="mt-0.5 text-xs text-slate-500">{entry.description}</p>
                      )}
                      {entry.topics && entry.topics.length > 0 && (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {entry.topics.map((t) => (
                            <span
                              key={t}
                              className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500"
                            >
                              {t}
                            </span>
                          ))}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleEntry(entry)}
                      disabled={loadingId !== null}
                      className="shrink-0 rounded bg-slate-800 px-3 py-1.5 text-xs text-white hover:bg-slate-700 disabled:opacity-40"
                    >
                      {loadingId === entry.id
                        ? '載入中⋯'
                        : loadedIds.includes(entry.id)
                          ? '✓ 再載入一份'
                          : '載入'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-1 text-sm font-semibold text-slate-700">
              或貼上別人分享的時間軸網址
            </h3>
            <p className="mb-2 text-xs text-slate-400">
              支援放在 GitHub、Gist 等處的 .hst.json 檔案網址，或 Google 試算表公開網址。
            </p>
            <div className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…/xxx.hst.json"
                className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => void handleUrl()}
                disabled={urlLoading || url.trim() === ''}
                className="rounded bg-slate-800 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-40"
              >
                {urlLoading ? '載入中⋯' : '載入'}
              </button>
            </div>
          </section>

          <p className="border-t border-slate-100 pt-3 text-xs text-slate-400">
            想把自己整理的時間軸放上共用庫？
            <a
              href="https://github.com/liuleecheetah/hackstory-next/issues/new/choose"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-slate-600"
            >
              開一個 GitHub issue 投稿
            </a>
            ，附上你的 .hst.json 檔案，審核後就會加入目錄。
          </p>
        </div>
      </div>
    </div>
  )
}
