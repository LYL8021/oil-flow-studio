# 共用修改建議服務

主網站維持 https://oil-flow-studio.vercel.app/ ，前端在 `dist/feedback.js`，由 `dist/app.js` 的 `setupFeedback` 指定服務網址：

https://oil-flow-feedback-8c41.sacredzebra19.chatgpt.site

後端由 Sites Worker 與 D1 提供；不需要同仁登入。所有訪客可讀取與新增留言，網站已告知留言會公開顯示。油路圖與圖面儲存區不會上傳。

## 原始碼與部署

- `feedback-worker.js` 是 Worker ESM 來源，`feedback-schema.sql` 是初始 D1 遷移。
- Sites 專案的 Worker 來源需與本目錄同步，D1 binding 為 `DB`。遷移在部署時執行，不在請求中建表。
- Vercel 只發布 `dist/`；合併 GitHub 不會自動發布這個獨立後端。修改後端時，透過 Sites 工具從上述網址解析既有專案，沿用它的專案身分與資料庫。同步 Worker、提交推送來源、建立版本，再發布同一專案；不可另建空白服務取代既有留言。
- 本機檢查用 `node --test tests/feedback-worker.test.mjs`，需要 Node.js 24 的 `node:sqlite`。測試涵蓋實際 SQLite、驗證、分頁、CORS、重試去重及維護權限。

## API

`GET /api/feedback?limit=200&cursor=...` 回傳 `{items,total,nextCursor}`，由新到舊；前端可載入較早留言，匯出與複製會先取得全部頁面。

`POST /api/feedback` 接收 JSON：`requestId`（UUID）、`name`（選填）、`title`、`category`（idea／bug／ui／other）、`body`、空白的 `website` 防機器人欄位。同一識別碼重試會回傳已存在的留言；不得以瀏覽器暫存冒充成功送出。

跨來源只開放正式網站、同站、loopback 本機預覽與離線檔案的 `null` origin。Vercel 分支預覽仍可檢查其他功能；共用留言整合須用正式網址或本機預覽。

維護用 `DELETE /api/feedback/:id` 需要 runtime secret `FEEDBACK_ADMIN_KEY` 的 Bearer 權限，匿名訪客不能刪除。必要時由專案擁有人在 Sites 環境設定輪替金鑰，再重新發布已儲存版本以套用；金鑰不能提交、寫入前端、網址或日誌。測試新增的留言應以維護權限清除。
