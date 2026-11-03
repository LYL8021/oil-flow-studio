# 搬移共用圖面與留言

這份工具只處理資料搬移，主網站仍留在 Vercel。部署設定見 `server/cloudflare/README.md`。未確認新帳號的服務、資料及跨瀏覽器測試正常前，不要修改正式前端服務網址，也不要刪除舊服務。

## 搬移順序

1. 在自己的 Cloudflare 帳號建立 Worker、全新的 D1 資料庫及 R2 bucket，套用兩份 schema 遷移。確認新目標尚無使用者資料。
2. 暫停所有人在舊共用圖面及建議區的寫入。**從最後一次匯出起，直到匯入、核對及前端切換完成，都必須維持暫停寫入。** 匯出工具前後重讀來源只能偵測匯出期間的變更，不能取代這段切換期間的暫停。
3. 匯出到 Git 儲存庫之外的私人路徑。檔案包含完整底圖及留言，不能提交到 GitHub。

   ```bash
   python3 scripts/cloud-migration.py export --source https://oil-flow-feedback-8c41.sacredzebra19.chatgpt.site --output /workspace/private-backups/oil-shared-final.json
   ```

   需要完整保留舊請求去重資訊時，先由擁有人匯出 D1 的 `drawing_revisions`，以 `{"drawing_revisions":[...]}` 保存私有 sidecar，再加上 `--provenance /workspace/private-backups/revision-provenance.json`。每列需有 `drawing_id`、`revision`、`object_key`、`request_id`、`request_hash`。一般公開 API 不提供這些維護欄位；沒有 sidecar 時，圖面 ID、名稱、版本、時間、所有圖面內容及留言仍完整保留，但歷史請求去重鍵會重新產生。切換前應關閉／重新整理舊分頁，不要在新服務重送切換前尚未確認的儲存請求。

4. 產生匯入檔案，輸出目錄必須不存在且位於 Git 儲存庫之外：

   ```bash
   python3 scripts/cloud-migration.py prepare --backup /workspace/private-backups/oil-shared-final.json --destination /workspace/private-backups/oil-import
   ```

   會產生 `import.sql`、`import-plan.json` 及 `objects/*.json`。SQL 中只有中繼資料；大型圖面及底圖在 R2 JSON，避免 D1 單列限制。所有文字用 UTF-8 hex literal 表示，名稱或留言不會被當成 SQL 執行。

5. 以下動作必須由已授權正確 Cloudflare 帳號的操作者執行。先檢查新 D1 的三張表為空：

   ```bash
   npx wrangler d1 execute DB --config server/cloudflare/wrangler.jsonc --remote --command "SELECT (SELECT COUNT(*) FROM feedback) AS feedback, (SELECT COUNT(*) FROM drawings) AS drawings, (SELECT COUNT(*) FROM drawing_revisions) AS revisions;" --json
   ```

   如任何數量非零，停止；不要清空或覆蓋未知的既有資料。必要時改用新資料庫，或由維護者逐列核對已完成的部分匯入。

6. 依 `import-plan.json` 的 `objects` 清單，先將所有 `file` 上傳至指定新 bucket 的 `key`。`file` 相對於該私人匯入目錄。使用 Wrangler 的參數陣列執行，避免把檔名或使用者文字拼入 shell 指令。單一物件格式為：

   ```text
   npx wrangler r2 object put <新bucket名稱>/<key> --file <完整file路徑> --remote
   ```

   上傳前檢查每個檔案的 SHA-256 與 `import-plan.json` 一致。不要把物件寫到舊服務或已有使用者資料的 bucket。全部上傳成功後，才把 `import.sql` 匯入全新的 D1：

   ```bash
   npx wrangler d1 execute DB --config server/cloudflare/wrangler.jsonc --remote --file /workspace/private-backups/oil-import/import.sql
   ```

   SQL 使用嚴格 `INSERT`，不會替換既有 ID。若任一步失敗，停止切換。R2 已上傳但 D1 尚未匯入的物件不會影響舊服務；不要以清空資料方式重試。SQL 部分失敗時，須先核對目標狀態，不能直接再次執行整份匯入。

7. 指向新 Worker 的公開網址，核對完整資料：

   ```text
   python3 scripts/cloud-migration.py verify --backup /workspace/private-backups/oil-shared-final.json --target https://<新Worker>.<你的子網域>.workers.dev
   ```

   此步會比較全部留言、圖面 ID／名稱／版本／時間／數量、每一個歷史版本及完整 JSON（包含底圖與作業），不是只比較清單數量。任何差異都會失敗，不得切換前端。

8. 驗證新服務的匿名儲存、版本衝突、歷史開啟與兩個獨立瀏覽器讀取，最後再發布前端服務網址更新。確認正式網站正常後才恢復寫入。保留舊服務與私人備份，供必要時還原；恢復寫入後如需回切，需先處理新服務新增的資料，不能直接切回較舊快照。

工具不建立公開管理匯入端點、不讀取或寫入帳號憑證，也不自動變更正式服務。網路請求沿用環境的代理與 CA，TLS 驗證保持開啟。輸出只有成功狀態、數量與校驗碼，不會印出圖面或留言內容。

驗證工具：

```bash
node --test tests/cloud-migration.test.mjs
```
