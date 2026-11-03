# 搬到自己的 Cloudflare 帳號

這份設定把共用圖面與修改建議後端部署到你自己的 Cloudflare，主網站保留在 https://oil-flow-studio.vercel.app/ 。目前前端仍使用原服務，部署新服務後還需搬移資料並切換網址，才算完成。

## 首次部署：按鈕方式

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/LYL8021/oil-flow-studio/tree/main/server/cloudflare)

1. 先登入要長期管理此專案的 Cloudflare 帳號，再按上面的按鈕。
2. 依畫面連接你的 GitHub。Cloudflare 會將這個獨立後端範本複製為你帳號內的新程式庫，並接上自動建置；原本的油路工坊程式庫與 Vercel 網址保留。
3. 保留程式要求的 `DB`（D1 資料庫）與 `BUCKET`（R2 儲存桶）綁定；可以接受 Cloudflare 建議的資源名稱。部署按鈕流程會先建立資源，再執行資料表遷移與 Worker 發布。若 Cloudflare 要求啟用 R2 或確認帳務，需由帳號擁有人在 Cloudflare 完成。
4. 部署成功後，保存 Cloudflare 顯示的實際 `https://oil-flow-shared.<帳號子網域>.workers.dev` 網址，供後續核對與搬移。不要自行猜測子網域。

整個登入與授權都在 Cloudflare／GitHub 進行，不需要把密碼或 API Token 貼進聊天。服務費用依 Cloudflare 當時的方案及用量決定，這份程式不保證永久免費。

此資料夾是可獨立部署的範本，已附 `worker.js`、設定與遷移，不需要讀取上層原始碼。`npm run deploy` 會先以 `DB` 綁定套用未執行的遷移，再發布 Worker。發布程式或看到空清單，均不代表原有資料已搬移。

## 搬移既有圖面、歷史與留言

新服務與原本服務使用相同的 `DB`／`BUCKET` 綁定和資料格式。需保留圖面 ID、所有歷史版本、留言 ID、時間與重試識別碼，避免既有瀏覽器草稿失去圖面身分。

1. 暫停舊服務寫入，或安排短暫維護時段；先保存可還原的完整備份，避免搬移時同仁新增版本或留言。
2. 從原服務匯出所有留言、圖面目前版本、所有歷史索引與 JSON 快照，搬至新 D1 與 R2。不能只用一般「儲存新圖面」操作冒充完整搬移。
3. 比較留言總數、圖面數、各圖版本數及 JSON 快照，確認元件、油管、底圖、油品、接點與作業配置均完整。
4. 驗證新服務的 `/api/feedback`、`/api/drawings`、圖面讀寫、歷史版本、版本衝突與跨來源回應。
5. 資料與 API 確認無誤後，再將正式網站的共用圖面、留言服務網址指向新服務，更新模組快取版本、同步離線 ZIP，經 PR 發布到 Vercel。主網站維持原網址。
6. 以兩個獨立瀏覽器確認既有圖面、儲存更新、歷史版本與留言。通過後才考慮停止舊服務；回復時也需保留切換後新增的資料。

本目錄的 SQL 只建立結構，不含使用者圖面或留言。私人備份、搬移檔、密碼與 Token 不得提交到 GitHub。`FEEDBACK_ADMIN_KEY` 必須設為 Cloudflare Worker 執行時的 Secret，才可執行管理清理；一般訪客不需要此金鑰。建置時的 Secret 與 Worker 執行時的 Secret 是不同設定。

## 命令列部署

完整程式庫需要 Node.js 20 以上與 npm：

```sh
cd server/cloudflare
npx --yes wrangler@4 login
npx --yes wrangler@4 whoami
npm run provision
npm run db:migrate
npm run deploy
```

登入時選擇自己的 Cloudflare 帳號，`whoami` 可確認帳號。設定未填 D1 ID／R2 名稱，Wrangler 4.45 以上的 `deploy` 會自動建立缺少的資源並將實際 ID 寫回設定；日後部署須沿用相同資源。首次 `provision` 到資料表建立完成之間，API 可能暫時無法使用，正式網站此時仍指向舊服務。

`npm run check` 可驗證本機打包；它不會發布。`npm run db:migrate:local` 僅套用到本機測試資料庫。日後正常更新用 `npm run deploy`，已套用的 SQL 不得修改，資料結構變更需新增後續遷移。

若要直接連接完整的既有程式庫至 Workers Builds，可設定：

| 欄位 | 設定 |
| --- | --- |
| GitHub 程式庫 | `LYL8021/oil-flow-studio` |
| 正式分支 | `main` |
| Root directory | `server/cloudflare` |
| Build command | 留白 |
| Deploy command | `npm run deploy` |

直接 Git 連線前，先完成資源建立與綁定；網頁建置工作目錄是暫時的，不能把裡面自動產生的 ID 當成已存進 GitHub。使用部署按鈕建立的獨立範本會由 Cloudflare 完成首次資源配置。

## 維護上游原始碼

後端的共同來源是上層 `feedback-worker.js` 和 `drawings-worker.js`。在完整的油路工坊程式庫修改後，執行：

```sh
cd server/cloudflare
npm run refresh-source
```

此指令把兩個模組封裝為 `worker.js`，並核對既有遷移與共同來源一致。新增匯入模組或修改既有遷移時會拒絕繼續，須先調整打包規則或新增後續遷移。修改、測試並提交 `worker.js` 與新增 SQL，部署按鈕才會取得同一份程式。

獨立部署副本已附 `worker.js`，不用執行 `refresh-source`。若後續仍使用獨立副本維護，需同步上游發布的 Worker 與新增遷移；不要期待原始程式庫的提交自動更新另一個獨立程式庫。

Cloudflare 的帳號、GitHub 授權、資料庫與儲存桶由你持有後，服務依 Cloudflare／Vercel 的帳號與方案運作，不依賴 Codex 工作環境是否開啟。

官方說明：

- [部署按鈕及資源配置](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [Wrangler 自動建立儲存資源](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)
- [Workers Builds 的 GitHub 設定](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [D1 遷移命令](https://developers.cloudflare.com/workers/wrangler/commands/d1/)
