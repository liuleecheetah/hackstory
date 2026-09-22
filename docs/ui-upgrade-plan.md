# 介面升級計畫——簡報出圖工作室與會議模式

**狀態：** 已定案、決策點全部已決，可直接開工（U0a → … 依第 3 節順序執行；U4 暫停）
**最後更新：** 2026-09-17

> **給執行的 Claude（Opus）：** 開工前先讀 `CLAUDE.md`（六層鐵律、驗收方式）、`SPEC.md`，以及本文件全文。
> 一次只做一個步驟，做完讓使用者用眼睛驗收、commit，才進下一步。
> 使用者看不懂程式碼，所有說明用繁體中文、以「畫面上會看到什麼」為準。
> 第 2.7 節的五個決策點**使用者已於 2026-09-17 全部決定**，照表中「決定」欄執行即可，不必再問。其餘照做，不要自行擴大範圍。

---

## 0. 背景與目標

HackStory 的功能已經很完整（多軸、多圖層、關係線、相對時間、匯入匯出、直式、比例出圖），但外觀還是工程師預設值：全站用 Tailwind 的灰色系、字幾乎都是最小的兩級、時間軸上的字是 10–13 像素寫死在程式裡。功能齊全但不吸引人，就不會有人來用，也就不知道該往哪裡修。

這次升級鎖定兩個使用情境：

1. **簡報用資訊圖表。** 使用者能做出有品質、可自行設定的時間軸圖，直接貼進 Keynote／PowerPoint／Google Slides。輸出 PNG 與 SVG 都要。
2. **會議與工作。** 投影在會議室的電視上，三公尺外看得清楚；操作簡明；能當場補事件；與會者能掃碼跟看。

兩個情境共用同一個地基：**render 層要能吃一組「主題設定」**（字級、字型、配色、密度、留白），而不是把尺寸寫死。簡報出圖是主題設為大字、留白多、固定尺寸；會議模式是同一組主題套到即時畫面上，加全螢幕。

## 0.5 已決定的事（2026-09-17 與使用者確認）

1. **輸出格式：** PNG 與 SVG 都要。
2. **字型：** 思源黑體（Noto Sans TC），**自己放進網站**，不走 Google Fonts 的線上服務。PNG 匯出要把字型嵌進 SVG 再轉檔（現在的轉檔方式看不到網頁載入的字型，見第 4 節風險 1）。
3. **協作：** 這輪**不開後端**（不進 `docs/share-plan.md` 的 S3）。會議模式只做「一台電腦投影＋與會者掃 QR code 跟看」，前提是該時間軸已有公開網址。
4. **時期底色：** 做。需 SPEC 升 0.5 新增選填欄位，core 加驗證與測試。排在出圖工作室之後、會議模式之前。
5. **標註事件：** 出圖工作室最多挑 6–8 個事件顯示「標題＋一句摘要」的標註框，預設自動挑 `featured` 的事件。
6. **四種版型都做**，順序：A 多軸泳道、D 直式大事記 → B 雙向對照 → C 因果魚骨（最後）。
7. **順序等距模式：** 做。少量事件時不照時間比例排，但圖上**必須**標示「非等比」。
8. **版型 B 以「雙軸各佔一側」為預設**，要同時支援上下對照（橫式）與左右對照（直式）。
9. **視覺風格（配色、字重、留白的具體數值）：** 使用者之後會另外提供風格參考圖，本文件第 5 節先留「待補」。在那之前，Opus 用第 2.1 節給的暫定值做，做出來的東西要能靠改 token 換皮，不能把顏色數字散落在各處。

## 0.6 設計原則（依 ProPublica〈Some Thoughts on Timelines〉整理，使用者已確認）

1. **兩層閱讀。** 遠景（軸上的點、長條、顏色、時期底色）讓人一眼看懂結構；近景（詳情卡）給想深究的人。**圖片只做遠景加少量標註**，不把詳情塞進圖裡；圖片底部的 QR code 通往互動版的近景。
2. **比例決定方向。** 寬比例（16:9、4:3、2:1）用橫式；長比例（9:16、4:5、A4 直式）用直式。工作室依所選比例自動建議，使用者可改。
3. **對照是主角。** 多軸版型要讓「彼此的互動」一眼看出；關係線在輸出中要少、要有標籤、要可讀，不是全部畫出來變蜘蛛網。
4. **顏色有意義且色盲安全。** 顏色只編碼「哪條軸線／哪個圖層」；重要性用大小（`featured` 放大），時期用底色。色盤用色盲安全組合，最多八色。
5. **文字階層固定。** 標題、副標、軸線名、事件名、日期、出處六級字，比例固定，全站思源黑體。
6. **誠實。** 相對時間的虛線、摺疊空白的斷軸記號、日期精度、「非等比」標示，畫面上有的輸出圖也要有，不能為了好看拿掉。
7. **可信。** 出處、授權、版本日期、QR code 固定在圖片底部，不可關閉，只能縮小。

## 0.7 四種版型的定義（使用者的語言，計畫沿用）

| 版型 | 說明力核心 | 事件定位 | 對應 HackStory 的能力 |
|---|---|---|---|
| **A 多軸泳道** | 跨主體的橫向交互作用 | 不同行動主體（政府／公民團體／企業）各佔一軌，看 A 的決策如何誘發 B 的反制 | 現有橫式多軸檢視，改外觀：左側軸線名色塊、頂部刻度帶、長條有頭尾 |
| **B 雙向對照** | 二元對抗與矛盾檢驗 | 中央主軸，事件依「正反立場／官方宣稱 vs 調查事實」分流到兩側 | 直式已有「刻度置中對照」；橫式要新增「軸線置中，兩軸上下對照」。加大年份、標註框、順序等距選項 |
| **C 因果魚骨** | 非線性的多重因果匯聚 | 核心事件當主幹，各面向的觸發事件斜向匯入 | 由 `relations` 推導的全新排版，只做匯出用 |
| **D 直式大事記** | 深度證據鏈與脈絡錨定 | 每個節點是高承載卡片：引言、數據、佐證來源 | 現有直式檢視，加「卡片」呈現：帶入 `description`、`sources`、`confidence` |

---

## 1. 架構總覽

### 1.1 現況（開工前）

| 位置 | 內容 | 這次要動嗎 |
|---|---|---|
| `src/index.css` | 只有一行 `@import "tailwindcss"` | **U0 全面改寫**：設計 token、字型、元件樣式 |
| `index.html` | 沒有載入任何字型 | U0 加字型 CSS 連結 |
| `src/render/TimelineView.tsx`（906 行） | 橫式；尺寸寫死在檔案頂端的常數與 `M` 物件（`LANE_H`、`DOT_R`、`font: 12` 等） | U1 改讀主題；U2 加標註框、順序等距；B 加軸線置中 |
| `src/render/VerticalTimelineView.tsx`（1310 行） | 直式；同樣寫死常數（`FONT = 12`、`DOT_R = 5` 等）；已有 `centerAxis`、`reversed` | U1 改讀主題；U2 加標註框；D 加卡片模式 |
| `src/render/timelineData.ts` | 與方向無關的資料層；`PALETTE` 六色寫在這裡 | U1 把色盤搬到主題 |
| `src/render/exportSvg.tsx` | 離屏渲染橫式／直式，畫面與匯出共用同一段繪製程式 | U2 接主題與標註；C 加魚骨入口 |
| `src/adapters/export.ts` | `serializeSvg`（加白底與 font-family）、`svgToPngBlob`（SVG → `<img>` → canvas） | U2 加字型嵌入 |
| `src/ui/ExportDialog.tsx`（583 行） | 已有**十種比例**（含 16:9、4:3、2:1、A4 橫直）、縮圖預覽、PNG 2 倍、SVG、iframe、分享連結 | U2 把「出圖（選比例）」區塊搬進工作室；其餘保留 |
| `src/ui/App.tsx`（1214 行） | 工具列平鋪所有按鈕與勾選框；字級 `text-sm`／`text-xs` | U0 重整工具列；U3 加會議模式 |
| `src/ui/EventDetailCard.tsx` | `position: fixed`，位置在點擊當下算好就不動 | U0 修（捲動與縮放後跟著事件走） |
| `src/core/*` | 型別、驗證器、測試 | **只有 U2.5 動**（新增 `periods`），其餘步驟一行不改 |

**重要更正：** 16:9 已經存在，不是這次要加的東西。缺的是「設計權」，不是比例。

### 1.2 目標（完工後）

```
public/fonts/
  noto-sans-tc/                 ★U0：思源黑體切片檔（woff2）與 CSS，自架
scripts/
  fetch-fonts.mjs               ★U0：下載並整理字型切片的一次性腳本（附中文說明）
src/
  index.css                     ★U0 改寫：@theme token、字型、元件樣式
  render/
    theme.ts                    ★U1：RenderTheme 型別、預設主題、色盲安全色盤
    theme.test.ts               ★U1：主題衍生尺寸的測試
    callouts.ts                 ★U2：標註框排版（純函式）
    callouts.test.ts            ★U2
    ordinal.ts                  ★U2：順序等距的 TimeWarp（純函式）
    ordinal.test.ts             ★U2
    periods.ts                  ★U2.5：時期底色的排版（純函式）
    fishboneLayout.ts           ★U2e：魚骨排版（純函式）
    fishboneLayout.test.ts      ★U2e
    FishboneView.tsx            ★U2e：魚骨檢視（只在匯出用）
    TimelineView.tsx            改：讀主題、標註、等距、軸線置中、時期底色、聚焦
    VerticalTimelineView.tsx    改：讀主題、標註、卡片模式、時期底色、聚焦
    timelineData.ts             改：色盤改由 theme.ts 提供
    exportSvg.tsx               改：接主題、標註、等距；加魚骨入口
  adapters/
    fonts.ts                    ★U2：找出用到的字、抓對應切片、嵌進 SVG
    fonts.test.ts               ★U2
    export.ts                   改：serializeSvg 可選嵌入字型
  compose/
    useLayers.ts                改（U2.5）：時期的新增／修改／刪除，進復原歷史
  ui/
    App.tsx                     改：工具列三組、會議模式狀態、開工作室
    Toolbar.tsx                 ★U0：工具列抽成獨立元件（App.tsx 太長了）
    ExportStudio.tsx            ★U2：全螢幕出圖工作室
    StudioPreview.tsx           ★U2：工作室的即時預覽
    PresentBar.tsx              ★U3：會議模式的細工具列
    ShareQr.tsx                 ★U3：QR code 顯示
    PeriodEditor.tsx            ★U2.5：時期編輯
    ExportDialog.tsx            改：拿掉「出圖（選比例）」區塊，改成「開啟出圖工作室」按鈕
    EventDetailCard.tsx         改（U0）：位置跟著事件；U3 加大字版
```

### 1.3 層級關係檢查（鐵律）

- **主題住在 render。** `render/theme.ts` 定義 `RenderTheme` 與預設值；ui 層挑一個主題傳給 render；render 不知道「使用者在哪個模式」，只知道收到什麼主題。
- **字型嵌入住在 adapters。** 「把字型檔塞進 SVG 文字」是檔案輸出的事，跟畫面無關。render 只在 SVG 上標 `font-family`。
- **時期（periods）是資料，住在 core。** 它描述的是事實（「戒嚴時期 1949–1987」），不是呈現偏好，所以放文件頂層而非 `display`。
- **順序等距是一種座標對應，住在 render。** 它跟 `gaps.ts` 的 TimeWarp 是同一個介面的另一種實作。
- **標註框的「挑哪些事件」在 ui，「怎麼排」在 render。** ui 把事件 key 清單傳進去，render 負責排版與畫。
- **會議模式是 ui 狀態。** render 只多收 `focusKey`（聚焦哪個事件）與 `focusRequest`（置中到哪個事件），不知道「會議」這回事。
- **QR code 產生：** 用 `qrcode` 套件（純 JS、無相依），住在 ui 層的 `ShareQr.tsx`。

---

## 2. 各模組規格

### 2.1 U0 視覺基礎

#### 2.1.1 設計 token（`src/index.css`）

用 Tailwind v4 的 `@theme` 定義，全站只能用 token，不准再直接寫 `text-slate-600` 這類顏色。

```css
@import "tailwindcss";

@theme {
  /* 字型 */
  --font-sans: 'Noto Sans TC', system-ui, 'PingFang TC', sans-serif;

  /* 字級：六級，比例 1.2；基準從 14 提到 15 */
  --text-xs: 12px;   /* 出處、輔助 */
  --text-sm: 13px;   /* 日期、次要標籤 */
  --text-base: 15px; /* 內文、按鈕 */
  --text-lg: 18px;   /* 軸線名、對話框標題 */
  --text-xl: 22px;   /* 區塊標題 */
  --text-2xl: 28px;  /* 頁面標題 */

  /* 語意色（暫定值，等使用者風格圖進來再調） */
  --color-ink: #1a1a1a;        /* 主要文字 */
  --color-ink-muted: #5c5c5c;  /* 次要文字 */
  --color-ink-faint: #9a9a9a;  /* 輔助文字 */
  --color-surface: #ffffff;
  --color-surface-alt: #f5f4f0; /* 面板底 */
  --color-line: #e2e0da;
  --color-accent: #0072b2;     /* 主要按鈕、選取 */
  --color-warn: #b45309;
  --color-danger: #b91c1c;
}
```

- **元件樣式**：用 `@layer components` 定義 `.btn`、`.btn-primary`、`.btn-group`、`.panel`、`.dialog`、`.field` 幾個類別，所有按鈕最小高度 36px、可點區域夠大。
- **深色模式**：這輪**不做**全站深色，只在 U1 的「簡報（深底）」主題做時間軸本身的深色。
- **色盲安全色盤**（給圖層與軸線；住在 U1 的 `render/theme.ts`，U0 先不動 `PALETTE`）：以 Okabe–Ito 為基礎的六色
  `['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#e69f00', '#56b4e9']`。
  **已決定：** 換成這組色盤，使用者已同意；U1 驗收時給使用者看前後對照即可。

#### 2.1.2 字型自架（`public/fonts/`、`scripts/fetch-fonts.mjs`）

做法：**沿用 Google Fonts 的切片，但檔案放在自己網站**。

- Google Fonts 把 Noto Sans TC 切成約 120 個小檔（每個涵蓋一段 Unicode 範圍，`unicode-range`），瀏覽器只下載頁面用到的那幾片。我們把這些切片檔與對應的 CSS 抓下來放進 `public/fonts/noto-sans-tc/`，CSS 裡的網址改成相對路徑。這樣不需要任何字型子集化工具，讀者的瀏覽器也不會連 Google。
- 兩種粗細：Regular（400）、Bold（700）。
- `scripts/fetch-fonts.mjs`：Node 腳本，抓 Google Fonts 的 CSS（要用桌機 Chrome 的 User-Agent 才會拿到 woff2 切片版）、下載每個切片、改寫網址、寫出 `noto-sans-tc.css`。**只跑一次**，結果 commit 進 repo。腳本要附中文說明：怎麼跑、會產生什麼、大約多少 MB。
- `index.html` 加 `<link rel="stylesheet" href="./fonts/noto-sans-tc/noto-sans-tc.css">`。
- 授權：SIL OFL 1.1，把 `OFL.txt` 一併放進資料夾。

**已決定：** 兩種粗細的切片（約 6–8 MB）直接進 repo，使用者已同意。

#### 2.1.3 工具列重整（`ui/Toolbar.tsx`，自 `App.tsx` 抽出）

三組，由左到右：

| 組 | 內容 |
|---|---|
| **檢視** | 橫式｜直式、日｜週｜月｜年、「顯示選項 ▾」下拉（日期、年份、關係線、摺疊空白、精簡、直式的兩個選項） |
| **編輯** | 共用庫、匯入、復原／重做、草稿狀態 |
| **輸出** | 出圖工作室（U2 才接）、匯出／分享、會議模式（U3 才接） |

- 「顯示選項」**一律**收進下拉，不再依螢幕寬度攤開或收起（現在 `xl` 以上攤開會讓工具列很雜）。
- 唯讀檢視（分享連結）時「編輯」組整組換成「建立可編輯副本」。
- 只搬 JSX 與 props，**不改任何行為**。抽完 `App.tsx` 應該明顯變短。

#### 2.1.4 修「會說謊」與「碰不到」（上次審查留下的三項）

1. **詳情卡跟著事件走**（`EventDetailCard.tsx`）：render 層回報的 `EventSelection` 已帶 `clientX/Y`；改為 render 在每次重繪後也回報選取事件的目前位置（新增 `onSelectionMove?: (pos: {clientX, clientY} | null) => void`，事件捲出畫面時回報 null），ui 據此重定位或收起卡片。
2. **直式摺疊空白的斷軸記號**（`VerticalTimelineView.tsx`）：橫式已有 ⫽ 與「略過 N 年」，直式照同一語彙畫在刻度尺上。`formatSkipped` 已可共用。
3. **直式左上角範圍標籤**：改成「畫面上實際看得到的那段」（`visibleURange` 已算好，只是標籤沒用它）。

### 2.2 U1 主題引擎（`render/theme.ts`）

```ts
/** 一組主題：render 層所有尺寸與顏色的唯一來源 */
export interface RenderTheme {
  id: 'screen' | 'presentation' | 'presentation-dark' | 'print'
  /** 字級倍率：1 = 螢幕；簡報 1.4；會議模式再乘 1.2 */
  scale: number
  fontFamily: string
  /** 六級字（px），由 scale 衍生，不各自手填 */
  font: { title: number; subtitle: number; track: number; event: number; date: number; footer: number }
  /** 幾何（px），由 scale 衍生 */
  laneH: number; trackLabelH: number; bandGap: number
  dotR: number; keyDotR: number; barH: number; keyBarH: number
  /** 顏色 */
  colors: { bg: string; ink: string; inkMuted: string; grid: string; axis: string; halo: string }
  /** 圖層／軸線色盤（色盲安全） */
  palette: string[]
  /** 密度：compact 把 laneH 等再乘 0.7（取代原本 compact 那組手填數字） */
  density: 'comfortable' | 'compact'
}

export const THEMES: Record<RenderTheme['id'], RenderTheme>
export function deriveTheme(base: RenderTheme, opts: { scale?: number; density?: RenderTheme['density'] }): RenderTheme
```

- `TimelineView` 與 `VerticalTimelineView` 各加 `theme?: RenderTheme` prop（預設 `THEMES.screen`）。檔案頂端的尺寸常數與 `M` 物件**全部改由 theme 衍生**；`compact` prop 保留，內部等同 `density: 'compact'`。
- `timelineData.ts` 的 `PALETTE` 改從 `theme.ts` 匯入（`buildBands` 多收一個 `palette` 參數，預設用 screen 的）。
- 測試：`deriveTheme` 的倍率正確、compact 的縮小比例、四個預設主題都通過「事件字級 ≥ 12px」與「文字對背景的對比度 ≥ 4.5」兩條檢查（對比度用 WCAG 公式自己算，幾行程式，不引入套件）。
- **驗收方式：** App 工具列「顯示選項」暫時加一個「主題」下拉（screen／presentation／print），切換後時間軸上的字明顯變大變粗、圓點變大。這個下拉在 U3 會被會議模式取代，但 U1 先用它驗收。

### 2.3 U2 出圖工作室（`ui/ExportStudio.tsx`）

全螢幕覆蓋層（不是小對話框）。**左邊 70% 是即時預覽，右邊 30% 是設定面板。**

#### 2.3.1 設定面板（由上到下）

1. **版型**：A 多軸泳道｜D 直式大事記｜B 雙向對照｜C 因果魚骨（未完成的顯示「即將推出」並停用）。
2. **比例**：沿用 `ExportDialog` 現有的十種 `RATIO_PRESETS`（搬到 `ui/ratios.ts` 共用）。選比例時依 `dir` 自動建議版型的方向（原則 2），使用者可覆寫。
   **另有「自動長度」**（2026-09-23 使用者要求）：寬度固定、高度拉長到所有軸線與事件都放得下，不裁切、不出現「另有 N 件未列出」。**四種版型 A、B、C、D 都要支援**——A、D 已做（繪製端回報 `data-content-height`，`renderWithAutoHeight` 先試算再正式畫）；B、C 實作時必須一併回報所需高度。PNG 太長時自動降低倍率（`safePngScale`），並告知使用者。
3. **主題**：螢幕｜簡報（淺底）｜簡報（深底）｜列印。字級微調滑桿（0.8–1.6 倍）。
4. **標題區**：標題（預設文件 `meta.title`）、副標（預設 `meta.subtitle`）、出處行（預設「作者 · 授權 · 日期」由 `meta` 組成，可改）。
5. **內容**：要哪些圖層與軸線（勾選，預設跟目前畫面一樣）；時間範圍（「目前畫面」或自訂起訖）；顯示日期、年份、關係線、摺疊空白（沿用現有旗標）。
6. **標註事件**：清單列出候選（`featured` 優先），勾選最多 8 個；每個可改一句摘要（預設取 `description` 前 40 字）。
7. **順序等距**：勾選框，說明文字「事件之間不照時間比例，適合少量精選事件；圖上會標示『非等比』」。
8. **底部**：QR code 開關（產生器用 `qrcode` 套件，已決定，見 2.7）。

面板最下面：「下載 PNG（2×）」「下載 PNG（3×）」「下載 SVG」「複製到剪貼簿」。SVG 旁有「嵌入字型」勾選（預設關，提示「開啟後檔案會大好幾 MB，但在沒裝思源黑體的電腦也能正確顯示」）。

#### 2.3.2 預覽（`ui/StudioPreview.tsx`）

- 呼叫 `render/exportSvg.tsx` 的離屏渲染，結果縮放到左側面積內顯示。任何設定改變後 300ms 重畫（debounce）。
- 渲染時回傳的警告（`overflow`、`hidden`、`narrowColumns`）顯示在預覽上方黃色條，沿用現有文案。

#### 2.3.3 標註框（`render/callouts.ts`）

```ts
export interface CalloutSpec { key: string; title: string; summary: string }
export interface PlacedCallout { key: string; x: number; y: number; w: number; h: number; anchorX: number; anchorY: number; side: 'above' | 'below' | 'left' | 'right' }
/** 給每個標註找一個不重疊、離錨點最近的位置。橫式在軸上下方交錯，直式在欄右側堆疊 */
export function placeCallouts(specs: Array<CalloutSpec & { anchorX: number; anchorY: number }>, bounds: { w: number; h: number }, orientation: 'horizontal' | 'vertical', theme: RenderTheme): PlacedCallout[]
```

- 標註框：白底（深色主題為深灰底）、細邊、圓角 4px、標題粗體、摘要一到兩行、引線從框到事件。
- 測試：任兩框不重疊、全部在畫布內、引線長度有上限。
- `TimelineView` 與 `VerticalTimelineView` 各加 `callouts?: CalloutSpec[]` prop，只在 `exportMode` 時繪製。

#### 2.3.4 順序等距（`render/ordinal.ts`）

- 實作與 `gaps.ts` 的 `TimeWarp` 同介面（`toU`／`toT`）的 `buildOrdinalWarp(times: number[])`：把每個相異時間點平均分配到等距的格子，格子之間線性內插。
- 刻度：等距模式下不畫規律刻度，改在每個格子畫該事件的日期；軸線畫成一段一段的斷線；畫布右上固定一枚「非等比」標示（原則 6，**不可關閉**）。
- 只在出圖工作室與（U3）會議模式提供，主編輯畫面不提供。

#### 2.3.5 版型 A（多軸泳道）與 D（直式大事記）的外觀差異

兩者都是現有檢視換主題，加上：

- **A**：左側軸線名改成**滿高色塊**（軸線色底、白字），頂部刻度改成**整條刻度帶**（淡底、粗年份），區間長條頭尾各留 2px 圓角，`featured` 圓點外加光暈。
- **D**：直式每個事件從「圓點＋一行標題」變成**卡片**：時間在左欄、右側卡片含標題（粗）、摘要（`description` 前兩行）、來源數與查證程度小標（例如「3 個來源 · 已查證」）。卡片高度自適應，事件太多超出畫布時列出警告並建議縮小時間範圍。這需要 `VerticalTimelineView` 多一個 `cardMode?: boolean` prop（只在 exportMode 生效）。

#### 2.3.6 版型 B（雙向對照）

- **橫式上下對照**：`TimelineView` 加 `centerAxis?: boolean` prop。恰好兩條可見軸線時，第一條畫在共用刻度軸**上方**（車道往上疊），第二條畫在**下方**；多於兩條時前半上方、後半下方，並警告「對照版型最適合兩條軸線」。
- **直式左右對照**：直接用現有的 `centerAxis`。
- 兩者都套用：大年份（刻度數字用 `font.title` 級）、標註框、順序等距（可選）。
- 對照版型的關係線只畫 `contradicts` 與 `responds_to` 兩類（原則 3：對照要的是張力），其他類型在此版型隱藏並註明。

#### 2.3.7 `adapters/fonts.ts`——字型嵌入

```ts
/** 讀入自架的字型 CSS，得到每個切片的 unicode-range 與檔案路徑 */
export async function loadFontManifest(cssUrl: string): Promise<FontSlice[]>
/** 掃描 SVG 裡所有文字，找出需要哪些切片 */
export function requiredSlices(text: string, slices: FontSlice[]): FontSlice[]
/** 把需要的切片抓成 base64，組成 @font-face 樣式字串 */
export async function buildEmbeddedFontCss(slices: FontSlice[]): Promise<string>
```

- `export.ts` 的 `serializeSvg` 多一個 `opts?: { embeddedFontCss?: string }`，有值就在 `<defs><style>` 塞進去。
- PNG 一律嵌入（不然字會跑掉）；SVG 依勾選。
- 測試：`requiredSlices` 對「只有英數」「含常用中文」「含罕見字」三種文字回傳正確切片；`unicode-range` 字串解析正確。

### 2.4 U2.5 時期底色（`periods`）

#### 2.4.1 SPEC 0.5

在 `SPEC.md` 新增第 7.5 節「`periods` — 時期」，版本歷史加 0.5。文件頂層新增選填陣列：

```json
"periods": [
  {
    "id": "martial-law",
    "title": "戒嚴時期",
    "start": { "value": "1949", "precision": "year" },
    "end": { "value": "1987", "precision": "year" },
    "color": "#e8e4dc",
    "description": "1949-05-20 至 1987-07-15"
  }
]
```

| 欄位 | 必要 | 說明 |
|---|---|---|
| `id` | ❌ | 文件內唯一 |
| `title` | ✅ | 時期名稱，畫在底色帶的角落 |
| `start` / `end` | ✅ | 絕對時間點（不接受相對時間）；`end` 可省略代表「至今」 |
| `color` | ❌ | 底色，省略時由 render 依主題自動配淡色 |
| `description` | ❌ | 點底色帶時顯示 |

為什麼放頂層不放 `display`：時期是內容事實，別人取用你的時間軸時應該一併拿到；`display` 只是呈現偏好。

#### 2.4.2 core

- `types.ts` 加 `Period` 與 `TimelineDocument.periods?: Period[]`。
- `validate.ts`：`title` 非空、`start`／`end` 為絕對時間且格式正確、`end` 早於 `start` 給警告、`id` 重複給錯誤、`color` 不是色碼給警告。`SUPPORTED_MINOR` 升到 5。
- `validate.test.ts` 補對應測試；`examples/taiwan-democracy.hst.json` 加三個時期（戒嚴、解嚴後、政黨輪替後）作為真實測試資料。

#### 2.4.3 render、compose、ui

- `render/periods.ts`：把時期換算成畫布上的區段（用 warp，摺疊空白時會跟著壓縮）。
- 兩種檢視都畫：**只有最上層可見圖層的時期畫成滿版底色帶**（避免多圖層互相蓋）；其他圖層的時期畫成刻度旁的細條。時期名畫在帶子的起點角落，字級 `font.date`。
- `compose/useLayers.ts`：`addPeriod`、`replacePeriod`、`removePeriod`，進復原歷史。
- `ui/PeriodEditor.tsx`：在圖層面板每個圖層下加「時期」小節：清單、＋新增（名稱、起年、迄年）、改名、刪除。**只做這四個動作**，顏色用主題自動配，不做顏色挑選器。

### 2.5 U3 會議模式

- App 新增 `presenting: boolean`。開啟時：進全螢幕（`requestFullscreen`，失敗就只是隱藏工具列）、主題切成 `presentation`（依螢幕寬度再乘 1.2）、圖層面板收起、工具列換成 `ui/PresentBar.tsx`（一條細列：離開、上一個／下一個、聚焦開關、日週月年、QR、字級 ±）。
- **鍵盤**（`PresentBar` 掛在 window 上，離開時解除）：← → 上一個／下一個關鍵事件；空白鍵 = 下一個；F 全螢幕；Esc 離開；+ − 字級；1–4 切尺度；H 顯示按鍵說明。
- **聚焦**：render 兩種檢視加 `focusKey?: string | null`，有值時其他事件與關係線降到 25% 透明，聚焦事件放大 1.3 倍並顯示大字詳情卡（`EventDetailCard` 加 `size: 'large'` 變體，字級用主題的 `font.event × 1.3`，位置固定在畫面右下角而非跟著點擊）。
- **逐一播放**：ui 把所有可見來源的 `featured` 事件依時間排序成清單，← → 在清單間移動；每移動一步，設 `focusKey` 並送 `focusRequest: { key, nonce }` 給 render，render 以現有的置中邏輯（橫式 `jumpToU`、直式同等函式）把該事件移到畫面中央。沒有 `featured` 事件時改用全部事件。
- **當場補事件**：雙擊新增沿用現有 `onEventCreate`，表單字級跟著主題放大。
- **QR 跟看**（`ui/ShareQr.tsx`）：若目前是分享連結檢視（`?src=` 有值）或使用者在匯出對話框填過公開網址，顯示該連結的 QR code（加 `&orient=vertical&embed=1`，手機掃到的是直式閱讀版）；否則顯示「這份時間軸還沒有公開網址，先到匯出／分享放上網」的說明。

### 2.6 U2e 版型 C（因果魚骨）——最後做

- `render/fishboneLayout.ts`：主幹 = `featured` 事件依時間排列（沒有就用全部）；對每個主幹節點，找 `relations` 裡指向它的 `causes`／`derives_from`（畫在上方，標「原因」）與從它出發的 `causes`／`responds_to`（畫在下方，標「影響」）；同一節點的分支依時間由外往內斜向匯入。沒有任何關係的事件不畫，數量列在警告裡。
- `render/FishboneView.tsx`：只給 `exportSvg.tsx` 用的離屏檢視，套主題、標註框。
- 前提檢查：`relations` 少於 3 條時工作室停用此版型並說明原因。
- 測試：分支不重疊、每個關係只畫一次、跨文件關係略過（沿用 `isCrossDocument`）。

### 2.7 決策點彙整（使用者已於 2026-09-17 全部決定）

| 步驟 | 問題 | **決定** |
|---|---|---|
| U0a | 字型切片約 6–8 MB 進 repo | **可以**，直接 commit 進 `public/fonts/` |
| U1 | 換色盲安全色盤會改變範例的預設顏色 | **換**，驗收時給使用者看前後對照 |
| U2 | QR code 產生器 | **安裝 `qrcode` 套件**（純 JS、無相依）。這是本計畫唯一允許新增的相依套件；安裝時告訴使用者一聲即可，不必再徵求同意 |
| U2 | 「複製到剪貼簿」在 Safari 行為可能不同 | **做**，Safari 失敗時退回「已下載」並提示 |
| U2.5 | SPEC 升 0.5 的 `periods` 欄位設計（2.4.1） | **同意**，照 2.4.1 動 core |

---

## 3. 開發步驟與驗收

| 步驟 | 內容 | 驗收（使用者用眼睛確認） | commit 訊息建議 |
|---|---|---|---|
| **U0a** | 字型腳本＋切片進 repo＋`index.css` token＋元件樣式 | 整個網站的字變成思源黑體、基準字級變大；按鈕變高變好按；功能全部沒變。開發者工具的網路面板看不到任何 google 網址 | 自架思源黑體並建立設計 token |
| **U0b** | `Toolbar.tsx` 抽出、三組重整、顯示選項一律下拉 | 工具列只剩一列，左檢視、中編輯、右輸出；每個按鈕按下去行為跟以前一樣；唯讀檢視變成「建立可編輯副本」 | 工具列重整為檢視／編輯／輸出三組 |
| **U0c** | 詳情卡跟著事件、直式斷軸記號、直式範圍標籤 | 點一個事件後捲動或縮放，卡片跟著走或收起；直式開摺疊空白看到 ⫽ 與「略過 N 年」；直式左上角的年份範圍等於眼前看到的那段 | 修正詳情卡位置與直式兩個顯示錯誤 |
| **U1** | `theme.ts`＋兩種檢視改讀主題＋色盤搬家＋暫時的主題下拉 | 切「簡報」主題，時間軸上的字明顯變大、圓點變大、軸線間距變寬；切回「螢幕」跟以前一樣；精簡模式照舊；測試全綠 | 新增主題引擎，時間軸尺寸改由主題決定 |
| **U2a**（技術驗證） | `adapters/fonts.ts`＋`serializeSvg` 嵌入＋在現有「匯出目前畫面」先接上 | 下載 PNG，用 Chrome 與 Safari 各做一次，圖裡的中文是思源黑體（跟畫面一樣），不是系統字；檔案能正常開 | PNG 匯出嵌入思源黑體 |
| **U2b** | `ExportStudio.tsx`＋`StudioPreview.tsx`＋版型 A、D（主題、比例、標題區、內容選擇） | 從「出圖工作室」進入全螢幕：左邊即時預覽、右邊設定；選 16:9＋簡報主題＋版型 A，下載 PNG 貼進 Keynote，三公尺外看得到字；選 A4 直式＋版型 D 看到卡片式大事記 | 新增出圖工作室與泳道、大事記版型 |
| **U2c** | 標註框＋順序等距 | 勾 6 個關鍵事件，預覽出現有引線的標註框且不重疊；開順序等距後事件均勻分布、右上角有「非等比」 | 出圖工作室加入標註框與順序等距 |
| **U2d** | 版型 B（橫式 `centerAxis`、大年份、關係線篩選） | 載入婚姻平權（挑「立法」與「反同動員」兩軸），版型 B 橫式：兩軸夾一條大年份中軸；切 9:16 變成左右對照 | 新增雙向對照版型 |
| **U2.5a** | SPEC 0.5＋core `periods`＋驗證＋測試＋範例加時期 | 測試全綠並列出新測試在測什麼；載入台灣民主運動史不報錯 | SPEC 0.5：新增時期欄位與驗證 |
| **U2.5b** | render 時期底色＋compose＋`PeriodEditor` | 台灣民主運動史的軸後面出現三段淡色底、角落寫「戒嚴時期」等；圖層面板能新增一個時期並立刻看到；復原可以撤掉；出圖工作室的圖也有底色 | 時間軸繪製時期底色並可編輯 |
| **U3a** | `presenting` 狀態＋`PresentBar`＋全螢幕＋大字主題＋聚焦 | 按「會議模式」全螢幕、工具列變一條細列、字變大；點事件其他事件變淡、右下角出現大字卡；Esc 離開一切復原 | 新增會議模式與聚焦顯示 |
| **U3b** | 逐一播放＋鍵盤＋QR | 按 → 一個一個關鍵事件亮起並置中；按 H 出現按鍵說明；分享連結檢視下按 QR，手機掃描開出直式閱讀版 | 會議模式加入逐一播放與掃碼跟看 |
| **U2e** | 版型 C 魚骨 | 載入二二八（關係線多），版型 C：主幹是關鍵事件，上方原因、下方影響斜向匯入；關係少於 3 條的文件此版型停用並說明 | 新增因果魚骨版型 |

**每步共同守則：**

- 每步結束跑 `npx vitest run` 全綠，並告訴使用者在瀏覽器怎麼驗、應該看到什麼。
- U0a、U0b、U1 三步的原則是**「外觀變、行為不變」**：任何「順便重構」都不做。
- 動 render 時，橫式與直式**都要**改，不能只改一邊。
- 每個新的純函式檔（`theme`、`callouts`、`ordinal`、`periods`、`fishboneLayout`、`fonts`）都要有測試。
- 只有 U2.5a 可以動 `core/`。其他步驟若發現需要動 core，停下來問。

---

## 4. 風險與注意事項

1. **PNG 看不到網頁字型。** `svgToPngBlob` 是把 SVG 當圖片載進 `<img>` 再畫到 canvas，這個環境**載不到外部資源**，只認得 SVG 內嵌的 `data:` 字型。所以 U2a 是整個計畫的技術關卡，要在 Chrome 與 Safari 都驗過才能往下。萬一 Safari 對 SVG 內嵌 woff2 有問題，備案是改嵌 woff（切片檔另抓一份 woff 格式）。
2. **字型切片與罕見字。** Google 的切片涵蓋 CJK 統一表意文字的常用範圍；極罕見的字會落到系統字。匯出時若偵測到有字不在任何切片內，警告「有 N 個字會用替代字型」，不靜默。
3. **主題化最容易悄悄改壞版面。** U1 的做法是「把常數改成從 theme 讀，screen 主題的值與原常數**完全相同**」，改完先讓使用者驗收橫直兩式與以前一模一樣，再做其他主題。
4. **標註框排版是新演算法。** 保持簡單：候選位置固定幾個（上下左右各一），挑第一個不重疊的；找不到就縮短摘要；還是不行就只畫標題並警告。不要寫通用的力導向排版。
5. **順序等距與相對時間。** 等距模式下相對時間事件不再需要推估位置，直接照先後排。但 `featured`、關係線、時期底色都要在等距座標下仍正確，測試要涵蓋。
6. **會議模式的鍵盤攔截**要在離開時確實解除，且不能干擾詳情卡與表單的輸入（輸入框有焦點時不攔截）。
7. **`App.tsx` 已經 1214 行。** U0b 抽工具列、U3 抽會議列，每次只搬不改；不要趁機大重構。
8. **版型 C 資料依賴重。** 沒有關係線的文件做不出魚骨，工作室要誠實停用而不是畫出一條孤零零的主幹。

---

## 5. 待補：視覺風格

使用者會另外提供風格參考圖（配色、字重、留白、標題處理）。收到後補這一節，內容至少包括：

- 2.1.1 的語意色與 U1 主題四組 `colors` 的最終值
- 標題區的排版（標題左對齊還是置中、副標與出處的相對位置）
- 標註框的樣式（邊框、陰影、引線粗細）
- 深底主題的底色與軸線色調整

**在此之前**，Opus 用第 2.1.1 節的暫定值做，所有顏色只能寫在 token 與 `theme.ts`，之後換皮只改這兩處。
