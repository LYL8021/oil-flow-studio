# 共用修改建議與圖面服務

## 搬到自己的 Cloudflare

已提供可獨立部署的 [Cloudflare 後端](cloudflare/README.md)，含一鍵部署按鈕、D1 遷移與 R2 綁定。完整資料搬移工具與核對順序見 [CLOUD_MIGRATION.md](../scripts/CLOUD_MIGRATION.md)。

這些檔案只代表搬移準備完成。取得自己帳號的實際 Worker 網址、保留全部圖面與歷史留言、確認資料核對與跨瀏覽器測試通過後，才修改前端服務網址；目前正式前端仍連原服務。本機圖面不在此搬移範圍，不會自動上傳。Cloudflare 與 Vercel 各依帳號方案運作，不保證永久免費。

主網站維持 https://oil-flow-studio.vercel.app/ ，前端在 `dist/feedback.js`，由 `dist/app.js` 的 `setupFeedback` 指定服務網址：

https://oil-flow-feedback-8c41.sacredzebra19.chatgpt.site

後端由 Sites Worker、D1 與 R2 提供；不需要同仁登入。所有訪客可讀取與新增留言，也可在共用圖面庫開啟、儲存及更新圖面。介面告知共用圖面可由使用此網站的人開啟。本機圖面與工作草稿不自動上傳；明確儲存／分享共用圖面時才上傳完整圖面與已套用的圖片底圖，原始 PDF 不會上傳。

## 原始碼與部署

- `feedback-worker.js` 是 Worker 路由與留言 ESM，`drawings-worker.js` 是共用圖面 ESM。`feedback-schema.sql` 是既有初始 D1 遷移，`drawings-schema.sql` 是後續新增圖面／版本表的遷移；已套用遷移不得修改。
- Sites 專案的 Worker 來源需與本目錄同步，D1 binding 為 `DB`，R2 binding 為 `BUCKET`。遷移在部署時執行，不在請求中建表。
- Vercel 只發布 `dist/`；合併 GitHub 不會自動發布這個獨立後端。修改後端時，透過 Sites 工具從上述網址解析既有專案，沿用它的專案身分與資料庫。將 `drawings-worker.js` 的具名匯出封裝為區域作用域，與移除該 import 的 `feedback-worker.js` 合成 Worker 單檔來源；新增的 SQL 放入後續遷移。提交推送來源、建置及封裝，再建立版本並發布同一專案；不可另建空白服務取代既有留言與圖面。
- 本機檢查用 `node --test tests/feedback-worker.test.mjs`，需要 Node.js 24 的 `node:sqlite`。測試涵蓋實際 SQLite、驗證、分頁、CORS、重試去重及維護權限。

## API

`GET /api/feedback?limit=200&cursor=...` 回傳 `{items,total,nextCursor}`，由新到舊；前端可載入較早留言，匯出與複製會先取得全部頁面。

`POST /api/feedback` 接收 JSON：`requestId`（UUID）、`name`（選填）、`title`、`category`（idea／bug／ui／other）、`body`、空白的 `website` 防機器人欄位。同一識別碼重試會回傳已存在的留言；不得以瀏覽器暫存冒充成功送出。

跨來源只開放正式網站、同站、loopback 本機預覽與離線檔案的 `null` origin。Vercel 分支預覽仍可檢查其他功能；共用留言整合須用正式網址或本機預覽。

維護用 `DELETE /api/feedback/:id` 需要 runtime secret `FEEDBACK_ADMIN_KEY` 的 Bearer 權限，匿名訪客不能刪除。必要時由專案擁有人在 Sites 環境設定輪替金鑰，再重新發布已儲存版本以套用；金鑰不能提交、寫入前端、網址或日誌。測試新增的留言應以維護權限清除。

## 共用圖面 API

- `GET /api/drawings?limit=100&cursor=...`：回傳 `{items,total,nextCursor}`，清單只含名稱、版本、時間、元件／油管／作業數量，不載入大型底圖。
- `GET /api/drawings/:id`：目前版本的 metadata 與完整 `project`。
- `POST /api/drawings`：接收 `{requestId,name,project}` 建立；更新必須另帶 `{id,expectedRevision}`。回傳 `{item,duplicate}`，建立為 201，更新或相同重試為 200。版本衝突為 409 `code:conflict`，同名圖面為 409 `code:name-exists`。
- `GET /api/drawings/:id/revisions?limit=100&cursor=...`：歷史版本清單。
- `GET /api/drawings/:id/revisions/:revision`：指定歷史快照。僅讀取，不修改目前雲端圖面；前端載入畫布後，使用者需明確儲存才建立新版。
- `DELETE /api/drawings/:id`：僅維護用，需相同 `FEEDBACK_ADMIN_KEY` Bearer 權限；不提供匿名刪除功能。清除測試資料時須精確指定本次建立的 ID。

D1 的 `drawings` 保存目前版本 metadata，`drawing_revisions` 保存不可變的歷史索引與 requestId。完整 JSON（包含底圖）存於 R2，避免 D1 單列大小限制。請求最多 24 MiB，圖片底圖仍沿用編輯器的 3.5 MB data URL 上限；伺服器檢查圖形、接管、作業與底圖資料。先寫不可變 R2 物件，再用原子 D1 batch 更新指定版本與歷史；失敗不能刪除可能已提交的物件。

`node --test tests/drawings-worker.test.mjs tests/cloud-project-store.test.mjs` 驗證持久化、歷史、實際 SQLite 交易、競爭更新、重試去重、失敗保留、格式及權限。`npm test` 同時確認既有留言與油路功能。
