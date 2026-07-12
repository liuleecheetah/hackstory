// ui 層：頁面外殼與工具列。
// M3：預載「同婚立法進程」與「平權運動」兩份檔案作為兩個圖層，
// 左側面板可顯示隱藏、排序、改配色，也能載入更多 .hst.json。
import { useCallback, useState } from 'react'
import rawMovement from '../../examples/equality-movement.hst.json?raw'
import rawLegislation from '../../examples/marriage-legislation.hst.json?raw'
import { parseHstJson } from '../adapters/json'
import { useLayers } from '../compose/useLayers'
import type { ScaleMode, ScaleRequest } from '../render/TimelineView'
import { TimelineView } from '../render/TimelineView'
import { ImportDialog } from './ImportDialog'
import { LayerPanel } from './LayerPanel'

const SCALE_LABELS: Record<ScaleMode, string> = {
  day: '日',
  week: '週',
  month: '月',
  year: '年',
}

// 預載的範例（模組載入時解析一次）
const INITIAL_RESULTS = [rawLegislation, rawMovement].map((raw) => parseHstJson(raw))
const INITIAL_DOCS = INITIAL_RESULTS.flatMap((r) => (r.ok ? [r.doc] : []))
const INITIAL_ERRORS = INITIAL_RESULTS.flatMap((r) =>
  r.ok ? [] : r.errors.map((e) => `內建範例載入失敗 ${e.path}：${e.message}`),
)

export default function App() {
  const { layers, visibleSources, addLayer, removeLayer, toggleVisible, setColor, moveLayer } =
    useLayers(INITIAL_DOCS)
  const [loadErrors, setLoadErrors] = useState<string[]>(INITIAL_ERRORS)
  const [scaleRequest, setScaleRequest] = useState<ScaleRequest | null>(null)
  const [activeMode, setActiveMode] = useState<ScaleMode>('year')
  const [importOpen, setImportOpen] = useState(false)

  // 使用者從檔案挑選器載入 .hst.json：好的變圖層，壞的把原因列出來（不靜默）
  const handleAddFiles = useCallback(
    (files: FileList) => {
      for (const file of Array.from(files)) {
        void file.text().then((text) => {
          const result = parseHstJson(text)
          if (result.ok) {
            addLayer(result.doc)
          } else {
            const first = result.errors[0]
            setLoadErrors((prev) => [
              ...prev,
              `「${file.name}」載入失敗：${first ? `${first.path} ${first.message}` : '格式錯誤'}` +
                (result.errors.length > 1 ? `（共 ${result.errors.length} 個問題）` : ''),
            ])
          }
        })
      }
    },
    [addLayer],
  )

  return (
    <div className="flex h-screen flex-col bg-white">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 px-4 py-2">
        <h1 className="text-lg font-bold tracking-wide text-slate-800">HackStory</h1>
        <span className="text-xs text-slate-400">
          {layers.length} 個圖層，顯示中 {visibleSources.length} 個
        </span>

        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-100"
        >
          匯入 CSV / Google Sheet
        </button>

        {/* 尺度切換（像 Google 日曆） */}
        <div className="ml-auto flex overflow-hidden rounded-md border border-slate-300">
          {(Object.keys(SCALE_LABELS) as ScaleMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setScaleRequest((prev) => ({ mode, nonce: (prev?.nonce ?? 0) + 1 }))}
              className={
                'px-3 py-1 text-sm transition-colors ' +
                (activeMode === mode
                  ? 'bg-slate-800 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-100')
              }
            >
              {SCALE_LABELS[mode]}
            </button>
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <LayerPanel
          layers={layers}
          errors={loadErrors}
          onToggle={toggleVisible}
          onMove={moveLayer}
          onRemove={removeLayer}
          onColor={setColor}
          onAddFiles={handleAddFiles}
        />
        <div className="min-w-0 flex-1">
          <TimelineView
            sources={visibleSources}
            scaleRequest={scaleRequest}
            onScaleModeChange={setActiveMode}
          />
        </div>
      </div>

      <footer className="border-t border-slate-200 px-4 py-1.5 text-xs text-slate-400">
        滑鼠滾輪：縮放　｜　按住拖曳：平移　｜　右上按鈕：切換日／週／月／年尺度　｜　左側面板：管理圖層
      </footer>

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={addLayer}
      />
    </div>
  )
}
