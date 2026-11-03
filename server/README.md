# 共用修改建議與圖面服務

## 本版服務配置

主網站維持 https://oil-flow-studio.vercel.app/ 。本版前端將修改建議及共用圖面的服務網址設定為：

https://oil-flow-studio.lililinomj330223.workers.dev

留言網址由 `dist/app.js` 的 `setupFeedback` 指定；圖面網址由 `dist/cloud-project-store.js` 的預設 origin 指定。兩處與離線下載 ZIP 必須同步更新，並更新對應模組的快取版本。

後端使用專案擁有人帳號內的 Cloudflare Workers Free＋D1，不需要 R2、綁卡或開通計費。免費方案有容量、每日讀寫及運算限制，超額可能暫時無法儲存或讀取，不會由程式自動升級成付費方案。完整圖面、底圖與歷史快照以 D1 文字塊保存。

這是程式配置與操作說明，不代表正式切換或資料核對已完成。必須暫停舊服務寫入、核對所有圖面／歷史／留言及跨瀏覽器操作，通過後才發布前端切換。舊 Sites 服務切換後以唯讀備份保留；日常服務不依賴 Codex 開發環境，完成匯入標記後的日常部署也不再讀取舊 Sites。

所有訪客可免登入讀取與新增留言，也可在共用圖面庫開啟、儲存及更新圖面；介面會告知共用內容可由使用網站的人開啟。本機圖面與工作草稿不自動上傳；只有明確儲存／分享共用圖面時才上傳圖面及已套用的圖片底圖，原始 PDF 不會上傳。

## 原始碼與部署

- `feedback-worker.js` 是路由與留言來源，`drawings-worker.js` 處理圖面版本，`d1-snapshots.js` 提供 D1 快照儲存介面。共同來源變更後，執行 `node server/cloudflare/refresh-source.mjs` 更新獨立部署副本，再檢查並提交。
- Cloudflare Builds 連接共用程式庫的 `main`：Root directory 為 `server/cloudflare`、Build command 留白、Deploy command 為 `npm run deploy:bootstrap`。此流程先配置 D1，再套用未執行的遷移、處理一次性匯入，最後發布 Worker。`DB` 是唯一的儲存綁定；不得加入 R2 或升級付費方案。
- `server/cloudflare/migrations/` 的遷移建立留言、圖面／版本、快照文字塊及匯入標記。已套用的 SQL 不得改寫，後續結構變更須追加新遷移；請求處理期間不得建表。
- `import-source.mjs` 僅在尚未完成匯入且目的庫為空白時，從既有服務匯入完整資料。完成標記後直接略過來源讀取。中斷續傳只能沿用相同來源 checksum，並核對已匯入內容，不覆寫未知資料。操作與完整搬移工具見 [Cloudflare 說明](cloudflare/README.md) 及 [CLOUD_MIGRATION.md](../scripts/CLOUD_MIGRATION.md)。
- Vercel 只發布 `dist/`；主網站與 Cloudflare 後端是兩個部署。確認各自建置完成及正式 API 正常後，才能宣稱更新上線。保留原有資料庫及 Worker 身分，不可建立空白副本取代已有資料。
- 本機測試用 `npm test`；後端與搬移測試使用 Node.js 24 內建 SQLite。檢查後端時應包含留言、圖面、D1 快照與匯入情境。

## API

`GET /api/feedback?limit=200&cursor=...` 回傳 `{items,total,nextCursor}`，由新到舊；前端可載入較早留言，匯出與複製會先取得全部頁面。

`POST /api/feedback` 接收 JSON：`requestId`（UUID）、`name`（選填）、`title`、`category`（idea／bug／ui／other）、`body`、空白的 `website` 防機器人欄位。同一識別碼重試會回傳已存在的留言；不得以瀏覽器暫存冒充成功送出。

跨來源只開放正式網站、同站、loopback 本機預覽與離線檔案的 `null` origin。Vercel 分支預覽仍可檢查其他功能；共用留言整合須用正式網址或本機預覽。

維護用 `DELETE /api/feedback/:id` 需要 runtime secret `FEEDBACK_ADMIN_KEY` 的 Bearer 權限，匿名訪客不能刪除。由專案擁有人在 Cloudflare Worker 的執行時 Secrets 設定或輪替金鑰，重新部署後確認生效；金鑰不能提交、寫入前端、網址或日誌。測試新增的留言應以維護權限清除。

## 共用圖面 API

- `GET /api/drawings?limit=100&cursor=...`：回傳 `{items,total,nextCursor}`，清單只含名稱、版本、時間、元件／油管／作業數量，不載入大型底圖。
- `GET /api/drawings/:id`：目前版本的 metadata 與完整 `project`。
- `POST /api/drawings`：接收 `{requestId,name,project}` 建立；更新必須另帶 `{id,expectedRevision}`。回傳 `{item,duplicate}`，建立為 201，更新或相同重試為 200。版本衝突為 409 `code:conflict`，同名圖面為 409 `code:name-exists`。
- `GET /api/drawings/:id/revisions?limit=100&cursor=...`：歷史版本清單。
- `GET /api/drawings/:id/revisions/:revision`：指定歷史快照。僅讀取，不修改目前雲端圖面；前端載入畫布後，使用者需明確儲存才建立新版。
- `DELETE /api/drawings/:id`：僅維護用，需相同 `FEEDBACK_ADMIN_KEY` Bearer 權限；不提供匿名刪除功能。清除測試資料時須精確指定本次建立的 ID。

D1 的 `drawings` 保存目前版本 metadata，`drawing_revisions` 保存不可變歷史索引與 requestId；`drawing_snapshot_objects`／`drawing_snapshot_chunks` 保存完整 JSON（包括底圖）的 header 與 UTF-8 文字塊。這可避免大型圖面超過 D1 單列大小限制。請求最多 24 MiB，圖片底圖仍沿用編輯器的 3.5 MB data URL 上限。先原子保存不可變快照，再以 D1 batch 檢查預期版本並更新圖面與歷史；不能刪除可能已提交或仍被引用的快照。

`node --test tests/drawings-worker.test.mjs tests/d1-snapshots.test.mjs tests/cloud-project-store.test.mjs tests/cloudflare-ci-import.test.mjs` 驗證持久化、歷史、實際 SQLite 交易、競爭更新、重試去重、分塊、格式及搬移保護。完整檢查使用 `npm test`。

## 舊 Sites 唯讀備份與切換

原服務 https://oil-flow-feedback-8c41.sacredzebra19.chatgpt.site 使用既有 D1 metadata 與 R2 快照。此路徑只保留相容性及唯讀備份，新的 Cloudflare 部署不需要 `BUCKET`。`feedback-worker.js` 在存在 `BUCKET` 時沿用舊 R2 路徑，否則使用 `createD1SnapshotStore(DB)`，不可因此改掉舊服務的儲存身分。

最終切換前，在舊服務的執行時設定 `SHARED_READ_ONLY=1` 並發布，暫停共用圖面與留言的 POST／DELETE；讀取仍開放，本機畫布不受影響。暫停後重做來源快照，完整比較新服務每個圖面 ID、名稱、時間、全部版本、元件、油管、底圖、作業及留言，再檢查跨來源讀寫與兩個獨立瀏覽器操作，通過後才發布前端服務網址更新。空清單或建置成功都不能取代資料核對。

切換後保留舊服務唯讀及私人備份，不再將它作為前端的寫入目標。若新服務已接受新資料，回復前須先處理新增資料，不可直接回切較舊快照。公開 API 不暴露舊歷史請求的去重欄位；CI 匯入保留所有可見圖面與留言資料，歷史 request key 會重新產生。使用者應在切換後重新整理／重開舊分頁，不要直接重送切換前未確認的儲存請求。需完整保留維護欄位時，使用私人 provenance 備份及搬移工具。

Cloudflare 的 `FEEDBACK_ADMIN_KEY` 必須設在 Worker 執行時 Secrets，Build variables／secrets 不會自動成為執行時設定。舊 Sites 的維護金鑰屬於另一個服務，必要時由擁有人在該舊服務環境操作。任何金鑰、私人快照、匯入 SQL 或原 Sites 部署身分都不得提交到 GitHub。
