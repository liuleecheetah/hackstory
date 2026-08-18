# 直式時間軸與比例匯出——架構與執行計畫

**狀態：** 已定案，待開發（V1a → V1b → V2 → V3 依序執行）
**最後更新：** 2026-08-18

> **給執行的 Claude：** 開工前先讀 `CLAUDE.md`（六層鐵律、驗收方式）與本文件全文。
> 一次只做一個步驟，做完讓使用者用眼睛驗收、commit，才進下一步。
> 使用者看不懂程式碼，所有說明用繁體中文、以「畫面上會看到什麼」為準。

---

## 0. 背景與定位

- 手機與網頁的閱讀習慣是垂直捲動；專案的行動版目標是「能**看**得舒服」（非目標：不做行動版編輯）。
- `SPEC.md` 第 8 節已預留 `display.orientation: "horizontal" | "vertical"`，`core` 的型別（`src/core/types.ts:171`）與驗證器**都已支援**——`core` 層一行不改。
- **直式不是把橫式轉 90 度。** 文字是橫的：直式裡每個事件天然擁有整行寬度，適合閱讀。時間由上往下流（上＝早，下＝晚），多條軸線變成左右並排的欄。
- 直式定位為**閱讀與輸出**模式。

## 0.5 已決定的事（2026-08-18 與使用者確認）

1. **多軸排法：** 桌機用「多欄並排」（A），容器寬度不足時自動退到「單欄合流」（B，事件按時間混排、用顏色與軸線名區分）。
2. **匯出比例：** 先做五種——9:16、4:5、3:4、1:1、A4 直式。
3. **直式編輯：** 第一版**不做**（不接 `onEventCreate`），之後會補——寫程式時不要把「加回編輯」的路堵死，但也不要先做。
4. **自動切直式：** 嵌入／分享檢視在窄螢幕自動用直式（可用 `?orient=` 覆寫）；編輯主畫面不自動切，由使用者手動按按鈕。

---

## 1. 架構總覽

### 1.1 現況（開工前）

`render/` 現有四個檔案：

| 檔案 | 內容 | 直式能否共用 |
|---|---|---|
| `TimelineView.tsx`（1072 行） | 資料準備＋橫式排版＋互動＋繪製，全部混在一起 | **資料準備的部分要抽出來共用** |
| `timeScale.ts` | 時間點→範圍、刻度、日期格式化（純函式） | ✅ 直接共用 |
| `gaps.ts` | 空白摺疊 TimeWarp（純函式） | ✅ 直接共用 |
| `layout.ts` | 車道分配 `assignLanes`、文字寬度估算（純函式） | ✅ 直接共用（車道演算法與方向無關：橫式餵水平區間、直式餵垂直區間） |

### 1.2 目標（完工後）

```
src/render/
  types.ts                共用型別（自 TimelineView 移出）
  timelineData.ts         ★新增：與方向無關的資料準備層（自 TimelineView 抽出）
  timelineData.test.ts    ★新增：資料層測試
  TimelineView.tsx        橫式視圖（瘦身後：只剩橫式排版＋互動＋繪製）
  VerticalTimelineView.tsx ★新增：直式視圖（排版＋互動＋繪製）
  verticalLayout.ts       ★新增：直式排版的純函式（欄分配、合流判斷）
  verticalLayout.test.ts  ★新增：直式排版測試
  exportSvg.tsx           ★新增（V3）：以指定寬高離屏渲染直式 SVG
  timeScale.ts / gaps.ts / layout.ts   不動或極小修改
```

`ui/App.tsx` 負責橫直切換；`ui/ExportDialog.tsx` 負責比例選擇。`adapters/export.ts` 的 `serializeSvg` / `svgToPngBlob` / `downloadBlob` 直接沿用，不改。

### 1.3 層級關係檢查（鐵律）

- 匯出流程的分工：**ui 層**（ExportDialog）呼叫 **render 層**（exportSvg 產生 SVG 元素）再呼叫 **adapters 層**（序列化、轉 PNG、下載）。ui 可以呼叫所有層，合法。
- render 不 import ui、不 import compose；`VerticalTimelineView` 只認得 `TimelineSource[]`，跟 `TimelineView` 一樣。

---

## 2. 各模組規格

### 2.1 `render/types.ts`（V1a）

把 `TimelineView.tsx` 目前 export 的型別移過來：`ScaleMode`、`ScaleRequest`、`TimelineSource`、`EventSelection`、`NewEventDraft`。
**`TimelineView.tsx` 保留 re-export**（`export type { ... } from './types'`），`ui/App.tsx` 等處的既有 import 不用改、不會壞。

### 2.2 `render/timelineData.ts`（V1a）——與方向無關的資料層

從 `TimelineView.tsx` 抽出所有「不含像素座標」的計算。**抽出後橫式畫面必須完全沒變。**

```ts
/** 一個準備好要畫的事件：只有時間與屬性，沒有像素座標 */
export interface PreparedEvent {
  ev: HstEvent
  kind: 'dot' | 'bar'
  /** 圖形佔用的真實時間範圍（毫秒）。dot 的 start=end=精度範圍中點 */
  tStart: number
  tEnd: number
  isKey: boolean          // featured：放大、粗體、光暈
  ongoing: boolean        // 進行中：長條畫到今天、末端淡出
  estimate: boolean       // 相對時間推估：虛線空心圓點
  relativeNote: string | null
  dateLabel: string       // 已依 showDates/showYears/estimate 算好的日期前綴
  title: string           // 截斷後的標題
}

/** 一條準備好要畫的軸線 */
export interface PreparedBand {
  key: string             // `${sourceId}/${trackId}`
  sourceId: string
  trackId: string
  docTitle: string
  trackTitle: string
  label: string           // 含「N 筆相對時間無法推估」註記
  color: string
  events: PreparedEvent[] // 依 tStart 排序
}

export interface TimelineData {
  bands: PreparedBand[]
  warp: TimeWarp          // 時間 t ↔ 壓縮座標 u（含空白摺疊）
  initialDomain: [number, number]   // u 座標
}

export function buildTimelineData(
  sources: TimelineSource[],
  opts: { collapseGaps: boolean; showDates: boolean; showYears: boolean },
): TimelineData
```

搬進來的既有邏輯（原封不動移動，不改行為）：`eventsExtent`、`collectSpans`、`initialDomainOf`、`resolveRelativeEvents` 的呼叫與快取、warp 建構、顏色決定順序（多軸以軸線色優先／單軸以圖層色優先）、`PALETTE`、`RELATION_LABELS`、相對時間說明文字的組裝。

`TimelineView.tsx` 改為呼叫 `buildTimelineData()`，其餘（車道、標籤翻邊、像素投影、互動、繪製）留在原地。
**注意：** 橫式的標籤佔位寬度（`occL`/`occR`）依賴像素，屬橫式排版，**不**搬進資料層。

### 2.3 `render/verticalLayout.ts`（V1b）——直式排版純函式

```ts
/** 依容器寬度決定排法：欄夠寬→多欄並排，不夠→單欄合流 */
export function pickVerticalMode(
  containerWidth: number,
  bandCount: number,
): 'columns' | 'merged'
// 規則：RULER_W = 64px（左側刻度尺）；(containerWidth - RULER_W) / bandCount >= 180px → columns，否則 merged

/** columns 模式：算出每欄的 x 起點與寬度 */
export function columnRects(containerWidth: number, bandCount: number): Array<{ x: number; w: number }>

/** 欄內事件的水平副車道（兩事件時間太近、標籤上下打架時，往右錯開）
 *  直接重用 layout.ts 的 assignLanes：把每個事件的「垂直佔位區間」[yTop, yBottom] 當作 left/right 餵進去 */
```

有測試：`pickVerticalMode` 的臨界值、`columnRects` 加總等於可用寬度、副車道不重疊。

### 2.4 `render/VerticalTimelineView.tsx`（V1b 靜態、V2 互動）

Props（**沒有** `onEventCreate`——直式第一版不做編輯）：

```ts
interface Props {
  sources: TimelineSource[]
  scaleRequest?: ScaleRequest | null
  onScaleModeChange?: (mode: ScaleMode) => void
  showDates?: boolean
  showYears?: boolean
  collapseGaps?: boolean
  selectedKey?: string | null
  onEventSelect?: (selection: EventSelection | null) => void
}
```

**畫面結構（columns 模式）：**

- 左側固定 64px 刻度尺：橫線格線貫穿全寬，刻度文字（`formatTick`）靠左；左上角顯示可視範圍（`formatRangeLabel`）。
- 頂部固定一列欄標題（sticky）：每欄顯示軸線 label、底色與左側色條，樣式對應橫式的軸線標題列。
- 每欄內：點事件＝圓點在 `y(t)`，標題橫排在圓點右側；區間事件＝**縱向長條**（從 `y(tStart)` 到 `y(tEnd)`，寬 12px），標題在長條右側、對齊長條頂端；進行中＝長條畫到今天、**下端**淡出（漸層方向轉 90 度）；推估＝虛線空心圓點＋「（推估）」；featured＝放大＋光暈，與橫式同語彙。
- 標題過長：以欄寬換算可容納字數截斷（重用 `estimateTextWidth`／`truncate`）。
- 事件太密時：副車道往右錯開（2.3 節）。

**merged 模式：** 單欄，事件全部按時間排序混排；每列開頭加一個 8px 色點＋軸線縮寫，其餘同上。

**V1b 先不做：** 關係線（V4）、空白摺疊的斷軸記號（V4；`collapseGaps` 的座標壓縮本身經由 warp 已生效，只是不畫 ⫽ 記號）、`compact` 模式（直式本來就密）。

**V2 互動（在同一檔案補上）：**

- 滾輪＝上下平移時間（自然捲動的閱讀感，**刻意與橫式的「滾輪＝縮放」不同**）；Ctrl/⌘＋滾輪與觸控板捏合＝以游標 y 為錨點縮放。
- 觸控拖曳＝平移時間（`touchAction: 'none'`＋pointer 事件，沿用橫式的 dragState 模式，但只有 y 軸）。
- 日／週／月／年按鈕：沿用 `SCALE_SPANS` 與「年＝回到全貌」邏輯，選取事件置中的行為照搬。
- 點事件→`onEventSelect`（詳情卡由 ui 層現有的 `EventDetailCard` 顯示，不用改）；點空白→取消選取；選取光環照橫式語彙。
- 「回到選取的事件」浮動鈕：方向改為上下（↑／↓），出現在畫面上緣／下緣中央。
- SVG 掛同一個 id `hackstory-timeline-svg`（一次只會有一個視圖在畫面上），讓 ExportDialog 現有的「匯出目前畫面」在直式下直接可用。

### 2.5 `ui/App.tsx` 修改（V1b 接上、V2 補嵌入）

- 新增 state：`orientation: 'horizontal' | 'vertical'`，初始值取第一份文件的 `display.orientation ?? 'horizontal'`（比照 `collapseGaps` 的既有寫法，載入新檔時同步更新）。
- 工具列加「橫式｜直式」切換（樣式比照現有的日／週／月／年按鈕組）。
- 依 orientation 條件渲染 `TimelineView` 或 `VerticalTimelineView`；直式時**不傳** `onEventCreate`，並把「顯示關係線」「精簡模式」兩個勾選框停用（disabled＋提示「直式暫不支援」）。
- **嵌入模式（V2）：** 讀 `?orient=vertical|horizontal`；沒給 orient 時，`embed=1` 且 `window.innerWidth < 640` → 預設直式。主畫面不自動切。
- `ExportDialog` 的 `embedCode` 分享／嵌入連結產生處：附上目前 orientation（`&orient=vertical`），讓「我看到的直式」分享出去也是直式。

### 2.6 `render/exportSvg.tsx`（V3）——比例匯出

```ts
/** 以指定邏輯尺寸離屏渲染直式時間軸，回傳可序列化的 SVG 元素 */
export function renderVerticalExportSvg(opts: {
  sources: TimelineSource[]
  domain: [number, number]      // 目前畫面的可視範圍（u 座標）——所見即所得
  width: number                  // 邏輯像素
  height: number
  showDates: boolean
  showYears: boolean
  collapseGaps: boolean
}): Promise<SVGSVGElement>
```

- 做法：在 detached 的 `<div>` 上用 `createRoot` 渲染一個**無互動**的直式 SVG（與 `VerticalTimelineView` 共用同一套排版函式——這是防止「畫面與匯出圖長不一樣」的關鍵），等一個 frame 後取出 SVG 節點、unmount。
- 匯出版面固定用 columns 模式（寬度是使用者指定的，不做合流退場）；欄數多而寬度不夠時，在對話框顯示警告「欄寬過窄，建議選更寬的比例或隱藏部分圖層」。
- 額外加：頂部標題列（文件標題）與底部小字出處（`hackstory` ＋ 日期），輸出的圖片才自帶脈絡。

### 2.7 `ui/ExportDialog.tsx` 修改（V3）

新增「直式圖片（選比例）」區塊：

```ts
const RATIO_PRESETS = [
  { id: '9-16', label: '9:16 手機全螢幕／限時動態', w: 540, h: 960 },
  { id: '4-5',  label: '4:5 社群貼文（直式）',       w: 540, h: 675 },
  { id: '3-4',  label: '3:4 一般直式',               w: 540, h: 720 },
  { id: '1-1',  label: '1:1 方形',                   w: 540, h: 540 },
  { id: 'a4',   label: 'A4 直式（列印）',            w: 620, h: 877 },
] // w/h 為邏輯尺寸；PNG 一律 2 倍輸出（9:16 → 1080×1920，A4 → 1240×1754）
```

- 選一個比例→即時顯示縮圖預覽（把 `renderVerticalExportSvg` 的結果縮小顯示，寬約 160px）→「下載 PNG」「下載 SVG」。
- 流程：ExportDialog（ui）→ `renderVerticalExportSvg`（render）→ `serializeSvg`／`svgToPngBlob`／`downloadBlob`（adapters，全部現成）。
- 既有的「匯出目前畫面」區塊保留不動（那是跟著視窗尺寸的所見即所得）。

---

## 3. 開發步驟與驗收

| 步驟 | 內容 | 驗收（使用者用眼睛確認） | commit 訊息建議 |
|---|---|---|---|
| **V1a** | 建 `types.ts`＋`timelineData.ts`（含測試），`TimelineView` 改用之 | ①測試全綠（含既有測試）②橫式畫面逐項比對**完全沒變**：縮放、拖曳、關係線、詳情卡、匯出都正常 | 抽出與方向無關的時間軸資料層 |
| **V1b** | `verticalLayout.ts`（含測試）＋`VerticalTimelineView` 靜態版＋App 切換按鈕 | 按「直式」看到同婚時間軸由上而下、多欄並排；縮窄視窗變單欄合流；切回橫式一切如舊 | 新增直式時間軸檢視 |
| **V2** | 直式互動（捲動、縮放、尺度按鈕、點選）＋嵌入 `?orient=`＋窄螢幕自動直式 | 手機模擬（iPhone 尺寸）開嵌入連結：自動直式、單手捲完整條軸；點事件出詳情卡 | 直式時間軸互動與行動版嵌入 |
| **V3** | `exportSvg.tsx`＋ExportDialog 比例區塊 | 選 9:16 下載 PNG（1080×1920），傳到手機全螢幕看：清楚、不變形；五種比例都試 | 直式圖片匯出與比例選擇 |
| **V4**（另行規劃） | 直式關係線、斷軸 ⫽ 記號、直式編輯、橫式 16:9 匯出 | — | — |

**每步共同守則：** V1a 是最大風險點——搬移程式碼時**不改行為**，任何「順便重構」都不做。每步結束跑 `npx vitest run` 確認全綠，並告訴使用者在瀏覽器怎麼驗。

---

## 4. 風險與注意事項

1. **V1a 抽取時最容易悄悄改壞橫式。** 對策：純搬移、不重寫；抽完先讓使用者驗收橫式，再開始寫直式。
2. **匯出是第二條渲染路徑。** 對策：匯出與畫面共用 `verticalLayout.ts` 的排版函式，只有「互動」與「固定尺寸」的差別。
3. **直式的滾輪語意與橫式不同**（直式滾輪＝平移，橫式滾輪＝縮放）。這是刻意的閱讀優先設計，介面上在直式模式給一次性提示（「滾輪捲動時間，Ctrl＋滾輪縮放」）。
4. **欄寬與中文標題。** 180px 欄寬約容納 12 個全形字（含日期前綴會更少），截斷是常態——詳情卡看全文的動線要順。
5. 未來要補直式編輯（已決定第 3 點）：`VerticalTimelineView` 的 Props 與內部座標換算（`y → 時間`）寫的時候保持乾淨，屆時加 `onEventCreate` 即可，不需要先留死code。
