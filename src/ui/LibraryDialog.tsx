// ui 層：共用庫對話框
// 上半部：官方精選目錄（share 層讀取），一鍵載入成圖層；
// 下半部：貼上任何人分享的 .hst.json 或 Google 試算表公開網址載入。
// 想把自己的時間軸上架，目前用 GitHub issue 投稿，由維護者審核（見 docs/share-plan.md）。

import { useEffect, useState } from 'react'
import { loadFromUrl } from '../adapters/remote'
import type { TimelineDocument } from '../core'
import type { LibraryEntry } from '../share/library'
import { checkEntryMatchesDocument, fetchLibraryIndex, resolveLibraryUrl } from '../share/library'

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
  // warn = 載入成功、但有事情要告訴使用者（例如目錄與檔案的 id 對不上）
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(
    null,
  )

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

  // Esc 關閉（跟出圖工作室、其他對話框一樣）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNotice(null)
        setUrl('')
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const close = () => {
    setNotice(null)
    setUrl('')
    onClose()
  }

  /** 共用的載入流程：目錄項與貼網址都走這裡。entry 只有從目錄點進來時才有 */
  const loadUrl = async (absoluteUrl: string, doneLabel: string, entry?: LibraryEntry) => {
    const result = await loadFromUrl(absoluteUrl)
    if (result.ok) {
      onLoad(result.doc)
      // 檔案本身沒問題，但目錄的 id 與它對不上 → 載入照做，同時把問題講出來
      const mismatch = entry ? checkEntryMatchesDocument(entry, result.doc.id) : null
      const extras = [result.notice, mismatch].filter((t): t is string => !!t)
      setNotice({
        kind: mismatch ? 'warn' : 'ok',
        text:
          `已把「${result.doc.meta.title}」載入成新圖層` +
          (extras.length > 0 ? `（${extras.join('；')}）` : ''),
      })
      return true
    }
    setNotice({ kind: 'error', text: `${doneLabel}載入失敗：${result.error}` })
    return false
  }

  const handleEntry = async (entry: LibraryEntry) => {
    setLoadingId(entry.id)
    setNotice(null)
    const ok = await loadUrl(resolveLibraryUrl(entry.url), `「${entry.title}」`, entry)
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
      <div className="flex max-h-[88vh] w-[640px] max-w-full flex-col rounded-lg bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-base font-bold text-ink">共用庫</h2>
          <button type="button" onClick={close} className="text-ink-faint hover:text-ink">
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
          {/* 操作結果訊息 */}
          {notice && (
            <p
              className={
                'rounded border px-3 py-2 text-base ' +
                (notice.kind === 'ok'
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : notice.kind === 'warn'
                    ? 'border-amber-300 bg-amber-50 text-amber-800'
                    : 'border-red-200 bg-red-50 text-red-700')
              }
            >
              {notice.text}
            </p>
          )}

          <section>
            <h3 className="mb-1 text-base font-semibold text-ink">精選時間軸</h3>
            <p className="mb-3 text-sm text-ink-faint">
              點「載入」把時間軸加成一個圖層，跟你手上的軸疊加對比。載入後可自由編輯，不會影響原始檔案。
            </p>

            {indexError && (
              <div className="flex items-center gap-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-base text-red-700">
                {indexError}
                <button
                  type="button"
                  onClick={() => {
                    setIndexError(null)
                    setEntries(null) // 清掉才會重抓
                  }}
                  className="rounded border border-red-300 px-2 py-0.5 text-sm hover:bg-red-100"
                >
                  重試
                </button>
              </div>
            )}
            {!indexError && entries === null && (
              <p className="text-base text-ink-faint">正在讀取目錄⋯</p>
            )}

            {entries !== null && (
              <ul className="space-y-2">
                {entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-start gap-3 rounded border border-line p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-medium text-ink">
                        {entry.title}
                        {entry.period && (
                          <span className="ml-2 text-sm font-normal text-ink-faint">
                            {entry.period}
                          </span>
                        )}
                      </p>
                      {entry.description && (
                        <p className="mt-0.5 text-sm text-ink-muted">{entry.description}</p>
                      )}
                      {entry.topics && entry.topics.length > 0 && (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {entry.topics.map((t) => (
                            <span
                              key={t}
                              className="rounded bg-surface-alt px-1.5 py-0.5 text-sm text-ink-muted"
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
                      className="btn btn-primary text-base shrink-0 disabled:opacity-40"
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
            <h3 className="mb-1 text-base font-semibold text-ink">
              或貼上別人分享的時間軸網址
            </h3>
            <p className="mb-2 text-sm text-ink-faint">
              支援放在 GitHub、Gist 等處的 .hst.json 檔案網址，或 Google 試算表公開網址。
            </p>
            <div className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…/xxx.hst.json"
                className="min-w-0 flex-1 rounded border border-line px-3 py-2 text-base"
              />
              <button
                type="button"
                onClick={() => void handleUrl()}
                disabled={urlLoading || url.trim() === ''}
                className="btn btn-primary disabled:opacity-40"
              >
                {urlLoading ? '載入中⋯' : '載入'}
              </button>
            </div>
          </section>

          <p className="border-t border-line pt-3 text-sm text-ink-faint">
            想把自己整理的時間軸放上共用庫？
            <a
              href="https://github.com/liuleecheetah/hackstory/issues/new/choose"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-ink-muted"
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
