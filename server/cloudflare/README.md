# Cloudflare 免費方案部署：只用 Workers 與 D1

這份設定把共用圖面與修改建議後端部署到你自己的 Cloudflare，主網站保留在 https://oil-flow-studio.vercel.app/ 。只建立 `DB`（D1 資料庫）綁定；元件、油管、底圖與歷史版本的 JSON 也分段保存於 D1，不需要啟用其他儲存服務或 Workers Paid。

此流程依 Workers Free 與 D1 的免費額度運作，不會自行升級付費方案，也不要求填寫信用卡。若 Cloudflare 顯示付費方案或付款資料畫面，先停止該步驟並確認選到的是這份 D1-only 部署設定，不要為了繼續而開通付費項目。

目前前端仍使用原本雲端服務。只完成新後端部署，不代表既有圖面與留言已搬移；資料核對及正式網站的服務網址切換仍需後續完成。

## 修正現有 oil-flow-studio Worker

目前已建立的 Worker 名稱是 `oil-flow-studio`，網址為 https://oil-flow-studio.lililinomj330223.workers.dev 。如果這個網址顯示油路工坊的完整畫面，表示 Cloudflare 發布了程式庫內的靜態網站；此 Worker 應改為共用圖面與留言的後端。

到 Cloudflare 的 **Workers & Pages → oil-flow-studio → Settings → Builds → Build configuration**，設定：

| 欄位 | 設定 |
| --- | --- |
| GitHub 程式庫 | `LYL8021/oil-flow-studio` |
| 正式分支 | `main` |
| Root directory | `server/cloudflare` |
| Build command | 留白 |
| Deploy command | `npm run deploy:bootstrap` |

儲存後，從建置紀錄選擇重新執行／Retry build。Worker 名稱與 `wrangler.jsonc` 的 `name` 都必須是 `oil-flow-studio`。新版設定只有一個 D1 綁定，不需要另外建立儲存桶。

`deploy:bootstrap` 先發布一次 Worker，讓 Wrangler 為 `DB` 建立或沿用資料庫，並將實際 ID 寫入本次建置的設定；接著套用資料表遷移、執行一次性的舊資料匯入，再發布可用的後端。首次發布與遷移完成之間，API 可能暫時無法使用，原 Vercel 網站此時仍使用原本服務。完成後，Cloudflare 網址首頁顯示 JSON 服務資訊是正常結果，Vercel 主網站網址不變。

每次 Git 建置都是新的工作目錄。設定尚未保存實際 D1 ID 時，後續也維持 `npm run deploy:bootstrap`，讓 Wrangler 先解析 Worker 已連接的資料庫。只有把已核對的實際 D1 ID 保存到部署設定後，才可改用先套用遷移再發布的 `npm run deploy`。不要改綁新的空白資料庫，也不要刪除已存在的資料庫。

## 從自己的帳號首次建立

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/LYL8021/oil-flow-studio/tree/main/server/cloudflare)

1. 登入要長期管理本專案的 Cloudflare 帳號，再按部署按鈕。
2. 依畫面連接 GitHub。Cloudflare 會將這個獨立後端範本複製為你帳號內的新程式庫，並接上自動建置；原本的程式庫與 Vercel 網址保留。
3. 保留 `DB`（D1）綁定與免費方案即可。此範本不包含需要建立儲存桶的設定。
4. 部署成功後，保留 Cloudflare 顯示的實際 `workers.dev` 網址，供資料搬移與核對。不要自行猜測帳號子網域。

登入和 GitHub 授權都在 Cloudflare／GitHub 內完成，不需要把密碼、信用卡或 API Token 貼進聊天。獨立資料夾已附 `worker.js`、設定與遷移，不需要上層原始碼。

## 免費額度與資料容量

依 Cloudflare 官方文件，本方案有以下用量限制；此處數字為部署準備時的規則，後續以 Cloudflare 公告與帳號畫面為準。

| 項目 | 免費額度 |
| --- | --- |
| Workers 動態請求 | 每日 100,000 次 |
| D1 讀取 | 每日 5,000,000 列 |
| D1 寫入 | 每日 100,000 列 |
| 單一 D1 資料庫 | 500 MB |
| 帳號內 D1 總儲存 | 5 GB |

圖面及歷史版本都會使用資料庫容量，包含圖片底圖。超過每日 D1 讀寫額度時，查詢會暫停到次日 UTC 00:00 重置，已保存資料不會因此刪除；超過儲存限制時也不能繼續新增資料。免費額度不會自動轉成付費用量，程式不會替使用者升級方案。接近額度時應先備份、整理歷史或調整用法，再決定後續處理。

D1 每列有大小限制，所以完整快照會切成多列保存，讀取時再還原成原始 JSON；元件、油管、底圖和作業內容不會因此縮減。新增的 `0003_d1_snapshots.sql` 建立快照資料表；舊的 `0001`／`0002` 遷移維持原樣。

## 第一次建置自動搬移資料

`npm run import:source` 會由 Cloudflare 的建置環境讀取原服務的公開圖面、所有歷史版本和留言，使用該次建置已取得的 Wrangler 授權寫入新的 D1。使用者不需要提供 API Token，也不需要手動上傳底圖。

圖面、歷史、留言的 ID 與時間均保留；原服務未公開的舊儲存請求識別資料，改用搬移腳本產生的固定新識別碼。搬移完成並切換網站後，請關閉搬移前的舊分頁，重新開啟正式網站再繼續儲存，避免沿用舊的待重試請求。

腳本完成後會在 D1 記錄匯入完成標記。日後建置看到標記就略過原服務讀取，不會持續依賴原服務。匯入失敗不得當成搬移成功；正式網站的服務網址必須等資料核對完成才切換。腳本不會自動暫停舊服務，因此第一次搬移前仍需安排短暫維護，避免同仁在搬移期間繼續新增資料。

## 搬移與切換核對

1. 先保存可還原的完整備份，並安排短暫維護或暫停舊服務寫入，避免搬移時同仁仍新增版本與留言。
2. 執行 `npm run deploy:bootstrap`，由建置流程自動搬移留言、圖面目前版本、所有歷史索引與 JSON 快照到新 D1。核對保留的 ID、版本、時間與固定搬移請求識別碼；不能只用一般「儲存新圖面」操作冒充完整搬移。
3. 比較新舊留言數、圖面數、各圖版本數及 JSON 快照，確認元件、油管、底圖、油品、接點和作業配置完整。
4. 驗證新服務的 `/api/feedback`、`/api/drawings`、圖面讀寫、歷史版本、版本衝突與跨來源回應。只有空白清單不代表搬移成功。
5. 資料及 API 確認後，才將正式網站的共用圖面、留言服務網址切換到新 Worker，更新模組快取版本並同步離線 ZIP，經 PR 發布到 Vercel。
6. 以兩個獨立瀏覽器確認既有圖面、更新、歷史版本和留言；通過後才考慮停止舊服務。回復時也須保留切換後已新增的資料。

SQL 遷移只建立結構，不含使用者圖面或留言。私人資料備份、搬移檔和 Secret 不得提交 GitHub。管理清理用的 `FEEDBACK_ADMIN_KEY` 須設為 Worker 執行時 Secret；一般訪客不需要這把金鑰。建置時 Secret 與執行時 Secret 是不同設定。

## 命令列部署

在完整程式庫內執行，需 Node.js 20 以上與 npm：

```sh
cd server/cloudflare
npx --yes wrangler@4 login
npx --yes wrangler@4 whoami
npm run deploy:bootstrap
```

登入時選擇自己的帳號，`whoami` 可核對帳號。Wrangler 自動建立缺少的 D1 資源並將實際 ID 寫回設定；之後沿用同一資料庫。`npm run check` 只驗證本機打包，不會發布；`npm run db:migrate:local` 只套用到本機測試資料庫。

已保存實際資料庫 ID 的部署可使用 `npm run deploy`。已套用的 SQL 不得修改，後續資料表變更應新增遷移檔。

## 同步共同原始碼

共同來源為上層的 `feedback-worker.js`、`drawings-worker.js` 與 `d1-snapshots.js`。在完整程式庫修改後，執行：

```sh
cd server/cloudflare
npm run refresh-source
```

此指令將模組封裝為獨立 `worker.js`，並核對三份共同來源遷移。獨立匯入程序的 `0004_cloud_import.sql` 為額外的附加遷移，保留且不由同步指令覆寫。未納入的新模組或既有遷移被修改時會拒絕繼續，必須先調整打包規則或新增後續遷移。測試後把 Worker 與新增 SQL 一起提交。

部署按鈕建立的獨立副本已有完整 Worker，不用執行 `refresh-source`；之後需同步上游發布的 Worker 與新增遷移，不會自動跟隨另一個獨立程式庫的提交。

Cloudflare 帳號、GitHub 授權與資料庫由你持有後，服務依 Cloudflare／Vercel 的帳號與方案運作，不依賴 Codex 工作環境是否開啟。

官方說明：

- [Workers 免費方案及價格](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 免費額度及超額行為](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1 大小與查詢限制](https://developers.cloudflare.com/d1/platform/limits/)
- [部署按鈕](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [Wrangler 資源配置](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)
- [Workers Builds 設定](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [D1 遷移命令](https://developers.cloudflare.com/workers/wrangler/commands/d1/)
