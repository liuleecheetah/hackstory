// 頂部工具列：由左到右分三組——檢視、編輯、輸出。
// 只負責「長什麼樣子、按了通知誰」，所有狀態與動作都由 App 傳進來。

import { useEffect, useRef, useState } from 'react'
import type { ScaleMode } from '../render/TimelineView'
import type { ThemeId } from '../render/theme'

type Orientation = 'horizontal' | 'vertical'

/** 橫式／直式切換的按鈕文字 */
const ORIENTATION_LABELS: Record<Orientation, string> = {
  horizontal: '橫式',
  vertical: '直式',
}

/** 暫時的主題選單（U1 驗收用；U3 會議模式上線後移除） */
const THEME_LABELS: Record<ThemeId, string> = {
  screen: '螢幕',
  presentation: '簡報（淺底）',
  'presentation-dark': '簡報（深底）',
  print: '列印',
}

const SCALE_LABELS: Record<ScaleMode, string> = {
  day: '日',
  week: '週',
  month: '月',
  year: '年',
}

/** 「顯示選項」下拉裡的各個勾選框：目前的值與改值的函式 */
export interface DisplayOptionsState {
  showDates: boolean
  setShowDates: (v: boolean) => void
  showYears: boolean
  setShowYears: (v: boolean) => void
  showRelations: boolean
  setShowRelations: (v: boolean) => void
  collapseGaps: boolean
  setCollapseGaps: (v: boolean) => void
  compact: boolean
  setCompact: (v: boolean) => void
  reversed: boolean
  setReversed: (v: boolean) => void
  centerAxis: boolean
  setCenterAxis: (v: boolean) => void
  themeId: ThemeId
  setThemeId: (v: ThemeId) => void
}

export interface ToolbarProps {
  layerCount: number
  visibleCount: number
  // 檢視
  orientation: Orientation
  onOrientationChange: (dir: Orientation) => void
  activeMode: ScaleMode
  onScaleSelect: (mode: ScaleMode) => void
  display: DisplayOptionsState
  // 編輯
  readOnly: boolean
  onMakeEditableCopy: () => void
  onOpenLibrary: () => void
  onOpenImport: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  dirty: boolean
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
  // 輸出
  onOpenExport: () => void
  onOpenStudio: () => void
}

/** 分段切換按鈕的樣式：選到的是強調色底 */
function segmentClass(active: boolean): string {
  return (
    'transition-colors ' +
    (active ? 'bg-accent text-white' : 'bg-surface text-ink-muted hover:bg-surface-alt')
  )
}

export function Toolbar(props: ToolbarProps) {
  const {
    layerCount,
    visibleCount,
    orientation,
    onOrientationChange,
    activeMode,
    onScaleSelect,
    display,
    readOnly,
    onMakeEditableCopy,
    onOpenLibrary,
    onOpenImport,
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    dirty,
    saveStatus,
    onOpenExport,
    onOpenStudio,
  } = props
  const isVertical = orientation === 'vertical'

  // 「顯示選項」下拉：點外面就收起
  const [optionsOpen, setOptionsOpen] = useState(false)
  const optionsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!optionsOpen) return
    const onDown = (e: PointerEvent) => {
      if (!optionsRef.current?.contains(e.target as Node)) setOptionsOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [optionsOpen])

  // 顯示選項：一律收在下拉裡，不依螢幕寬度攤開
  const displayOptions = (
    <>
      <label className="flex items-center justify-between gap-2 text-base text-ink-muted">
        主題
        <select
          value={display.themeId}
          onChange={(e) => display.setThemeId(e.target.value as ThemeId)}
          className="rounded border border-line bg-surface px-1.5 py-0.5 text-base text-ink"
        >
          {(Object.keys(THEME_LABELS) as ThemeId[]).map((id) => (
            <option key={id} value={id}>
              {THEME_LABELS[id]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-base text-ink-muted">
        <input
          type="checkbox"
          checked={display.showDates}
          onChange={(e) => display.setShowDates(e.target.checked)}
          className="accent-accent"
        />
        顯示事件日期
      </label>
      <label
        className={
          'flex items-center gap-1.5 text-base ' +
          (display.showDates ? 'text-ink-muted' : 'text-ink-faint')
        }
      >
        <input
          type="checkbox"
          checked={display.showYears}
          disabled={!display.showDates}
          onChange={(e) => display.setShowYears(e.target.checked)}
          className="accent-accent"
        />
        含年份
      </label>
      <label className="flex items-center gap-1.5 text-base text-ink-muted">
        <input
          type="checkbox"
          checked={display.showRelations}
          onChange={(e) => display.setShowRelations(e.target.checked)}
          className="accent-accent"
        />
        顯示關係線
      </label>
      <label className="flex items-center gap-1.5 text-base text-ink-muted">
        <input
          type="checkbox"
          checked={display.collapseGaps}
          onChange={(e) => display.setCollapseGaps(e.target.checked)}
          className="accent-accent"
        />
        摺疊空白
      </label>
      <label
        className={
          'flex items-center gap-1.5 text-base ' + (isVertical ? 'text-ink-faint' : 'text-ink-muted')
        }
        title={
          isVertical
            ? '直式暫不支援精簡模式'
            : '把事件列縮小，讓事件很多的軸線收斂，其他軸線比較看得到'
        }
      >
        <input
          type="checkbox"
          checked={display.compact && !isVertical}
          disabled={isVertical}
          onChange={(e) => display.setCompact(e.target.checked)}
          className="accent-accent"
        />
        精簡模式
      </label>
      {/* 只有直式才有意義的兩個選項 */}
      {isVertical && (
        <>
          <label
            className="flex items-center gap-1.5 text-base text-ink-muted"
            title="最新的事件排在最上面，像新聞或社群那樣由新往舊讀"
          >
            <input
              type="checkbox"
              checked={display.reversed}
              onChange={(e) => display.setReversed(e.target.checked)}
              className="accent-accent"
            />
            最新的在上面
          </label>
          <label
            className="flex items-center gap-1.5 text-base text-ink-muted"
            title="年份刻度尺移到畫面中央，軸線分左右兩側，貼著同一根時間軸對照（需要兩條以上軸線）"
          >
            <input
              type="checkbox"
              checked={display.centerAxis}
              onChange={(e) => display.setCenterAxis(e.target.checked)}
              className="accent-accent"
            />
            刻度置中對照
          </label>
        </>
      )}
    </>
  )

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2">
      <div className="flex items-baseline gap-2">
        <h1 className="text-lg font-bold tracking-wide text-ink">HackStory</h1>
        <span className="text-sm text-ink-faint">
          {layerCount} 個圖層，顯示中 {visibleCount} 個
        </span>
      </div>

      {/* ── 檢視 ── */}
      <div className="flex items-center gap-2">
        {/* 橫式／直式切換：直式是給閱讀與分享用的，時間由上往下流 */}
        <div className="btn-group">
          {(Object.keys(ORIENTATION_LABELS) as Orientation[]).map((dir) => (
            <button
              key={dir}
              type="button"
              onClick={() => onOrientationChange(dir)}
              className={segmentClass(orientation === dir)}
            >
              {ORIENTATION_LABELS[dir]}
            </button>
          ))}
        </div>

        {/* 尺度切換（像 Google 日曆），橫直式共用 */}
        <div className="btn-group">
          {(Object.keys(SCALE_LABELS) as ScaleMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onScaleSelect(mode)}
              className={segmentClass(activeMode === mode)}
            >
              {SCALE_LABELS[mode]}
            </button>
          ))}
        </div>

        <div ref={optionsRef} className="relative">
          <button type="button" onClick={() => setOptionsOpen((v) => !v)} className="btn">
            顯示選項 ▾
          </button>
          {optionsOpen && (
            <div className="absolute left-0 z-30 mt-1 flex w-56 flex-col gap-2 rounded-md border border-line bg-surface p-3 shadow-lg">
              {displayOptions}
            </div>
          )}
        </div>
      </div>

      {/* ── 編輯（唯讀檢視時整組換成「建立可編輯副本」）── */}
      <div className="flex items-center gap-2 border-l border-line pl-4">
        {readOnly ? (
          <>
            <span className="rounded bg-surface-alt px-2 py-1 text-sm text-ink-muted">
              唯讀檢視（分享連結）
            </span>
            <button type="button" onClick={onMakeEditableCopy} className="btn btn-primary">
              建立可編輯副本
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onOpenLibrary} className="btn">
              共用庫
            </button>
            <button
              type="button"
              onClick={onOpenImport}
              title="匯入 CSV 檔或公開的 Google Sheet"
              className="btn"
            >
              匯入
            </button>

            {/* 復原／重做 */}
            <div className="btn-group">
              <button
                type="button"
                onClick={onUndo}
                disabled={!canUndo}
                title="復原（Ctrl/Cmd+Z）"
                className="text-ink-muted hover:bg-surface-alt disabled:opacity-30"
              >
                ↩
              </button>
              <button
                type="button"
                onClick={onRedo}
                disabled={!canRedo}
                title="重做（Ctrl/Cmd+Shift+Z）"
                className="text-ink-muted hover:bg-surface-alt disabled:opacity-30"
              >
                ↪
              </button>
            </div>

            {/* 草稿保存狀態：顯示的訊息與實際寫入結果一致 */}
            {dirty && saveStatus === 'saving' && (
              <span className="rounded border border-line bg-surface-alt px-2 py-1 text-sm text-ink-muted">
                正在保存草稿…
              </span>
            )}
            {dirty && saveStatus === 'saved' && (
              <button
                type="button"
                onClick={onOpenExport}
                title="修改已存為瀏覽器草稿；下載 .hst.json 才是永久保存。點我開啟匯出"
                className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-sm text-amber-800 hover:bg-amber-100"
              >
                草稿已保存（尚未下載）
              </button>
            )}
            {dirty && saveStatus === 'error' && (
              <button
                type="button"
                onClick={onOpenExport}
                title="瀏覽器無法寫入草稿（可能空間不足或被封鎖）。請立即下載 .hst.json 保存"
                className="rounded border border-red-300 bg-red-50 px-2 py-1 text-sm font-medium text-red-700 hover:bg-red-100"
              >
                ⚠ 草稿保存失敗——請立即下載
              </button>
            )}
          </>
        )}
      </div>

      {/* ── 輸出（會議模式之後加在這裡）── */}
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenStudio}
          title="選版型、比例、主題與標題，做簡報或社群用的圖"
          className="btn"
        >
          出圖工作室
        </button>
        <button type="button" onClick={onOpenExport} className="btn">
          匯出／分享
        </button>
      </div>
    </header>
  )
}
