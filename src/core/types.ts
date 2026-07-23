// core 層：資料模型
// 依 SPEC.md 定義 .hst.json 的所有型別。
// 鐵律：此檔案不准 import 任何其他層。

/** 時間精度：現實世界的時間是模糊的，不能全部壓扁成假精確的日期 */
export type Precision = 'year' | 'month' | 'day' | 'minute'

/** 絕對時間點。value 格式依 precision 而定（見 SPEC 第 4 節） */
export interface AbsoluteTimePoint {
  /** year: "2010"｜month: "2010-06"｜day: "2017-05-24"｜minute: "2016-11-24T09:00" */
  value: string
  precision: Precision
  /** 「大約」，畫面上以虛化邊緣表示 */
  circa?: boolean
  /** 原始輸入字串，永遠保留，方便回溯與除錯 */
  raw?: string
}

/**
 * 相對時間錨點（Phase 2 才實作繪製，但型別現在就要留位置——
 * 這是 SPEC 最重要的前瞻設計，不要拿掉）
 */
export interface RelativeAnchor {
  relative: {
    /** 在此事件之後（事件 id） */
    after?: string
    /** 在此事件之前（事件 id） */
    before?: string
  }
  raw?: string
}

/** 時間點 = 絕對時間 或 相對錨點 的聯集 */
export type TimePoint = AbsoluteTimePoint | RelativeAnchor

/** 判斷一個 TimePoint 是否為絕對時間 */
export function isAbsolute(point: TimePoint): point is AbsoluteTimePoint {
  return 'value' in point
}

export interface Author {
  name: string
  url?: string
}

export interface SourceRef {
  title?: string
  url?: string
}

/** meta — 時間軸的身分證（SPEC 第 3 節） */
export interface Meta {
  title: string
  subtitle?: string
  description?: string
  /** 陣列 → 支援共筆 */
  authors?: Author[]
  /** 授權不是可有可無的，預設 CC-BY-4.0 */
  license?: string
  language?: string
  topics?: string[]
  created?: string
  updated?: string
  /** 單調遞增整數，Phase 2 同步／合併用 */
  revision?: number
  /** 原始出處，讓「這份資料哪來的」永遠可追溯 */
  source?: {
    type: string
    url?: string
  }
}

/** 軸線 — 文件內部的分軌（SPEC 第 5 節） */
export interface Track {
  /** 只需在同一份文件內唯一 */
  id: string
  title: string
  description?: string
  color?: string
  order?: number
}

/** 查證程度 */
export type Confidence = 'verified' | 'reported' | 'disputed' | 'unknown'

export interface EventLocation {
  name: string
  /** 預留給未來的地圖功能，MVP 不畫地圖 */
  lat?: number
  lng?: number
}

export interface MediaRef {
  type: 'image' | 'video' | 'document'
  url: string
  caption?: string
}

/** 事件（SPEC 第 6 節） */
export interface HstEvent {
  /** 文件內唯一。一旦發佈就不可改 */
  id: string
  /** 對應 tracks[].id */
  track: string
  /** 一句話講完，軸上唯一直接顯示的文字 */
  title: string
  description?: string
  start: TimePoint
  /** 有 end = 區間事件（長條），無 = 點事件（圓點） */
  end?: TimePoint | null
  /**
   * true = 事件仍在持續中：畫成從 start 延伸到「今天」的長條，右端淡出。
   * 與 end 擇一使用（兩者都有時以 end 為準）。SPEC 0.2 新增
   */
  ongoing?: boolean
  location?: EventLocation
  /**
   * 「作者選來優先呈現的重點」。true = 在軸上放大、加光暈、粗體顯示。
   * 語意是編輯選擇（作者的取捨），不是客觀分數。SPEC 0.3 新增，取代 importance。
   */
  featured?: boolean
  /**
   * @deprecated 舊欄位（0.3 之前）。原為 1–5 的重要性分數，但實務上只有 5 有效果，
   * 已由布林的 featured 取代。仍可讀取（importance >= 5 視為 featured）；
   * 新建與新匯出的檔案只寫 featured。等 1.0 才正式移除。
   */
  importance?: number
  confidence?: Confidence
  tags?: string[]
  sources?: SourceRef[]
  media?: MediaRef[]
  /** 覆寫該事件顏色 */
  color?: string | null
}

/** 事件關係類型（SPEC 第 7 節） */
export type RelationType =
  | 'causes' // 導致
  | 'responds_to' // 回應／反制
  | 'derives_from' // 衍生自
  | 'contradicts' // 與之矛盾
  | 'same_event' // 同一事件的不同記載（跨圖層知識整合的關鍵）

export interface Relation {
  from: string
  to: string
  type: RelationType
  label?: string
}

/** 建議呈現方式（SPEC 第 8 節）。只是建議，載入者可覆寫 */
export interface Display {
  orientation?: 'horizontal' | 'vertical'
  defaultScale?: 'day' | 'week' | 'month' | 'year'
  range?: { start: string; end: string }
  collapseGaps?: boolean
}

/** 時間軸文件 — 一個 .hst.json 檔案，發佈與分享的最小單位 */
export interface TimelineDocument {
  /** 規格版本號（major.minor），程式靠這個判斷怎麼讀 */
  hackstory: string
  /** 全域識別碼，slug（英數與連字號） */
  id: string
  meta: Meta
  /** 至少一條 */
  tracks: Track[]
  /** 可為空陣列 */
  events: HstEvent[]
  relations?: Relation[]
  display?: Display
}
