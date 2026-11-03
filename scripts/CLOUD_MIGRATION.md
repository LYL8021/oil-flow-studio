# 搬移共用圖面與留言到 Workers＋D1

這份工具只處理資料搬移，主網站仍留在 Vercel。此部署使用自己的 Cloudflare Workers 與 D1，**不需要 R2，也不需要為此啟用 R2 付費方案**。部署設定見 `server/cloudflare/README.md`。未確認新帳號的服務、資料及跨瀏覽器測試正常前，不要修改正式前端服務網址，也不要刪除舊服務。可用量仍依帳號當時的免費方案限制。

## 搬移順序

1. 在自己的 Cloudflare 帳號建立 Worker 與全新的 D1 資料庫，套用 `server/cloudflare/migrations/` 中的全部遷移。圖面中繼資料、完整 JSON 底圖及版本歷史都儲存在 D1；大型 JSON 以文字分塊保存，避開單列大小限制。
2. 暫停所有人在舊共用圖面及建議區的寫入。**從最後一次匯出起，直到匯入、核對及前端切換完成，都必須維持暫停寫入。** 匯出工具前後重讀來源只能偵測匯出期間的變更，不能取代這段切換期間的暫停。
3. 匯出到 Git 儲存庫之外的私人路徑。檔案包含完整底圖及留言，不能提交到 GitHub。

   ```bash
   python3 scripts/cloud-migration.py export --source https://oil-flow-feedback-8c41.sacredzebra19.chatgpt.site --output /workspace/private-backups/oil-shared-final.json
   ```

   需要完整保留舊請求去重資訊時，先由擁有人匯出 D1 的 `drawing_revisions`，以 `{"drawing_revisions":[...]}` 保存私有 sidecar，再加上 `--provenance /workspace/private-backups/revision-provenance.json`。每列需有 `drawing_id`、`revision`、`object_key`、`request_id`、`request_hash`。一般公開 API 不提供這些維護欄位；沒有 sidecar 時，圖面 ID、名稱、版本、時間、所有圖面內容及留言仍完整保留，但歷史請求去重鍵會重新產生。切換前應關閉／重新整理舊分頁，不要在新服務重送切換前尚未確認的儲存請求。`object_key` 仍作為快照識別碼，但 D1 部署不需要任何對應的 R2 bucket。

4. 產生 **D1** 匯入檔案，輸出目錄必須不存在且位於 Git 儲存庫之外。`--storage` 必須明確指定，避免誤用另一種部署：

   ```bash
   python3 scripts/cloud-migration.py prepare --storage d1 --backup /workspace/private-backups/oil-shared-final.json --destination /workspace/private-backups/oil-import
   ```

   會產生 `import.sql` 及 `import-plan.json`，不會產生 R2 物件或要求上傳檔案至 bucket。SQL 保存留言、圖面名稱及歷史索引，並使用 `drawing_snapshot_objects` 與 `drawing_snapshot_chunks` 保存完整圖面。每個 UTF-8 文字塊最多 32 KiB，不拆開 Unicode 字元；所有文字以 UTF-8 hex literal 表示，名稱、留言或底圖不會被當成 SQL 執行。每條 SQL 小於 90 KB，保留 D1 每條 SQL 100 KB 限制的餘量。`import-plan.json` 包含 SQL SHA-256、儲存模式、圖面／版本數量及文字塊數。

5. 以下動作必須由已授權正確 Cloudflare 帳號的操作者執行。先檢查新 D1 的五張表為空：

   ```bash
   npx wrangler d1 execute DB --config server/cloudflare/wrangler.jsonc --remote --command "SELECT (SELECT COUNT(*) FROM feedback) AS feedback, (SELECT COUNT(*) FROM drawings) AS drawings, (SELECT COUNT(*) FROM drawing_revisions) AS revisions, (SELECT COUNT(*) FROM drawing_snapshot_objects) AS snapshots, (SELECT COUNT(*) FROM drawing_snapshot_chunks) AS chunks;" --json
   ```

   如任何數量非零，停止；不要清空或覆蓋未知的既有資料。必要時改用新資料庫，或由維護者逐列核對已完成的部分匯入。

6. 檢查 `import.sql` 的 SHA-256 與 `import-plan.json` 的 `sqlSha256` 一致，再匯入這個尚未接通正式前端的空白 D1：

   ```bash
   npx wrangler d1 execute DB --config server/cloudflare/wrangler.jsonc --remote --file /workspace/private-backups/oil-import/import.sql
   ```

   SQL 使用嚴格 `INSERT`，不會替換既有 ID。此工具不假設 Wrangler 的整份 SQL 匯入具備跨所有 statement 的單一交易；因此只可用於尚未接通使用者的空白目的庫，全部完成並驗證後才能切換。若任一步失敗，停止切換，不要以清空資料方式重試；SQL 部分失敗時，須先核對目標狀態，不能直接再次執行整份匯入。舊服務不受影響。

7. 指向新 Worker 的公開網址，核對完整資料：

   ```text
   python3 scripts/cloud-migration.py verify --backup /workspace/private-backups/oil-shared-final.json --target https://<新Worker>.<你的子網域>.workers.dev
   ```

   此步會比較全部留言、圖面 ID／名稱／版本／時間／數量、每一個歷史版本及完整 JSON（包含底圖與作業），不是只比較清單數量。任何差異都會失敗，不得切換前端。

8. 驗證新服務的匿名儲存、版本衝突、歷史開啟與兩個獨立瀏覽器讀取，最後再發布前端服務網址更新。確認正式網站正常後才恢復寫入。保留舊服務與私人備份，供必要時還原；恢復寫入後如需回切，需先處理新服務新增的資料，不能直接切回較舊快照。

工具不建立公開管理匯入端點、不讀取或寫入帳號憑證，也不自動變更正式服務。網路請求沿用環境的代理與 CA，TLS 驗證保持開啟。輸出只有成功狀態、數量與校驗碼，不會印出圖面或留言內容。`--storage r2` 僅保留給既有、明確選用 R2 的其他目的環境；此處的 Workers＋D1 部署請一律使用 `--storage d1`。

驗證工具（需要 Node.js 24 與 Python 3）：

```bash
node --test tests/cloud-migration.test.mjs
```

測試會把實際匯入 SQL 套用至 SQLite，再使用正式 `createD1SnapshotStore` 重組所有歷史圖面，驗證完整內容與 UTF-8 長度一致，並檢查每條 SQL 小於 D1 上限。
