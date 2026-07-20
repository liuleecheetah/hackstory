# share（第 5 層）— Phase 2

發佈到共用庫／取用他人時間軸。整體規劃見 `docs/share-plan.md`。

**目前進度（S1）：** 「取用」已實作——`library.ts` 讀取隨網站部署的靜態目錄
`public/library/index.json`，UI 的「共用庫」面板據此列出精選時間軸供一鍵載入。
不需要登入、不需要資料庫；上架靠 GitHub issue 投稿與人工審核。

**下一步（S3）：** 接 Supabase 做登入與發佈。到時只動這一層。

**鐵律：** 只能呼叫比它低的層。接資料庫時，只動這一層。
