# 程式代理指引

- 先讀 `README.md`、`AI_EDIT_GUIDE.md` 和相關模組；共用 repo：https://github.com/LYL8021/oil-flow-studio 。
- 從最新 `main` 建立工作分支，透過 PR 合併；保留其他人工作，不要強制推送或覆蓋提交。
- 原生 HTML/CSS/JS，發布完整 `dist/`；免依賴安裝、免框架建置、免 API 金鑰。保留 `dist/vendor/ocr/` 以及 PDF.js 6.4.299 的完整 `dist/vendor/pdf/`（renderer、worker、CMap、字型、WASM 及授權），不可改用外站上傳圖紙。
- 預覽：`python3 -m http.server 4173 --directory dist`，開啟 `http://localhost:4173`；Windows 可用 `py -3`。`npm run dev` 也是 Python 預覽。
- Node.js 測試：`npm test`；相關測試可用 `node --test tests/flow.test.mjs` 或 `node --test tests/pipes.test.mjs`。按改動執行必要檢查，畫面／互動需預覽；未驗證處明說。
- 同步離線下載版：`python3 scripts/package-offline.py`；提交更新的既有 `dist/oil-flow-studio.zip`，不用提交產生的 `portable/`。離線單檔版保留元件幾何及已轉成底圖的 PDF 頁面，直接上傳 PDF 與 OCR 請使用線上版，介面須清楚說明。
- 保留既有 JSON 匯入相容性與瀏覽器存檔。燃料油橘色、柴油淺藍色、汽油淺綠色，多種同時可達用對應的雙色／三色條紋，不計算混油比例。
- 關閥後重新計算有效油源可達性；上游保留顏色，下游若有旁通或其他有效來源仍顯色。三通／四通內部連通，管線交叉不自動連接，盲封僅一個接管端，直油管兩端可留空。
- 保留自由斜走、任意角度、轉折點、跨管、地下管、主題及匯入匯出。跨管／地下管顯示不改變連通；不虛構壓力、流量或殘油量，流量計只隨油源顯色。
- 圖片辨識候選需人工確認，不自動接線或新增有效供油來源；維持瀏覽器內處理方式。
- PNG／JPG／WebP／PDF 上傳限 15 MB；PDF 僅在瀏覽器以本地 PDF.js 資源渲染選定頁面，可切頁與 90° 轉向。套用底圖須提供保留／不保留目前元件與油管，預設保留；不保留時清掉舊作業及工作圖面身分，但不能刪除儲存區記錄。辨識草稿需人工確認；TK／TC 油槽候選預設不供油。
- 不得提交憑證、token、環境秘密、私人 PDF／參考圖／草稿、瀏覽器資料、原 `.git` 或原 Sites 的 `.openai/hosting.json` 等部署身分。
- 自動部署需先接妥，合併 `main` 後等部署成功再刷新；原 Sites 網址和各自瀏覽器油路圖不自動同步。未確認推送／部署成功，勿聲稱已上線。
- 出／入土端使用 `ground` 單一 `port`，`flowMode` 可為 source／receive／idle，與 rise／sink 圖示獨立；顯式模式優先，舊圖無此欄位才由 `enabled === true` 推定 source，否則 receive。idle 端及相連管段須灰色、無動畫，不可被其他油源反向亮起；預設新出土 source、新入土 receive。
- 文字標記 `text` 無接管點，不供油、不改變閥位作業相容性；保留多行、字級、字色、旋轉與 JSON／SVG 匯出。元件名稱與編號可空白，畫布只顯示一般元件編號。
- 管線 `.layer` 僅控制交叉顯示，必須保存並沿用到拆管；立管閥的中心視覺接點仍對應兩個隔離的邏輯端點。編修畫布不顯示開關標籤。
- 元件 `scale` 預設 1；油槽範圍 .25～30（25%～3000%），其他一般元件 .25～4，接管點固定 1。`maxNodeScale()` 是上限的共同來源；`component-geometry.js` 統一旋轉、縮放與接點位置，顯示及接管須一致。編修選取框提供旋轉圓柄及縮放方角，Shift 旋轉對齊 15°，作業模式鎖定幾何；保存、復原及 JSON／SVG 匯出須保留這些設定。
- 油槽 A／B 保留實體 ID `in`／`out`、`inAngle`／`outAngle`；第三口 C 為 `out2`／`out2Angle`（預設90°），僅 `portCount===3` 啟用。缺少口數或兩口時沿用舊 A／B 外觀與資料格式；新油槽預設三口、一進兩出。`source-settings.js` 的 `tankPortCount`／`tankPortIds` 是實際接點共同來源，幾何、通油、接管、磁吸、複製、存檔與後端須一致。每口用途均可 inlet／outlet／closed，槽內不直接連通。切回兩口須先移除 C 的連線，不能靜默遺失接管。三口與兩口作業拓樸不可混套；舊兩口作業簽章保持相容。
- 底圖縮放範圍 25%～1000%，最大顯示尺寸 30000；底圖位置、元件與轉折點座標範圍 ±40000，接管、拖曳、存檔與匯入檢查須一致。同步調整超限應原子拒絕，不可靜默截斷或部分修改。
- 動畫方向由每個啟用油源的接點距離判斷，與拉管順序無關；多源方向衝突或等距時只顯示通油顏色。關閉閥門本體保持灰色，上游管線與接點仍依可達油源顯色。
- 「修改建議」與「共用圖面」使用免登入的雲端服務；本機圖面與工作草稿仍留在個別瀏覽器，僅明確儲存共用圖面時上傳。前端 `dist/feedback.js`、`dist/cloud-project-store.js` 與 `dist/project-library.js`；後端維護與部署見 `server/README.md`，不可改用 localStorage 假裝共用或把維護金鑰放入前端。
- 共用圖面使用 D1 存名稱、版本及歷史索引。原 Sites 服務仍用 R2 快照；自有 Cloudflare 採不綁卡的 Workers Free＋D1，`d1-snapshots.js` 將完整快照分成安全 UTF-8 文字塊，不能直接放入單一過大資料列。存在 `BUCKET` 時優先沿用 R2；無此綁定才使用 D1 轉接器。更新須帶 expectedRevision，409 衝突保留目前畫布並提供另存；requestId 讓重試不重複新增。不得靜默覆蓋其他人的版本或自動上傳本機存檔。閥門操作僅本機生效，明確儲存作業後才更新共用配置；復原歷史版本先載入畫布，明確儲存才建立新版。
- `server/cloudflare/` 是可獨立部署至擁有人 Cloudflare 帳號的後端副本；共同來源仍是 `server/feedback-worker.js`／`drawings-worker.js`／`d1-snapshots.js`，變更後先執行 `node server/cloudflare/refresh-source.mjs` 並驗證打包。已有遷移不可改寫。資料搬移須保留 ID、時間、所有版本及底圖，私有備份存於程式庫之外；先備份、暫停來源寫入、匯入並核對目標，最後才切換前端。準備好部署檔不代表已搬移，未驗證前不得切換或停用舊服務。
- 費用限制為不綁卡、不開通計費服務，不得重新加入 R2 或升級 Workers 付費方案。Cloudflare bootstrap 可使用建置環境的授權一次匯入舊服務資料；完成標記後的日常部署不可再依賴 Sites。最終切換前在舊服務設定 `SHARED_READ_ONLY=1` 暫停共用寫入並重新核對來源與目標；讀取保留，搬移期間不得切換到較舊的資料副本。

- `component-labels.js` 統一旋轉／縮放後編號及作業徽章排位；編號16px粗體，SVG匯出須保留paint-order。出／入土端的實際接點為±16，畫法與 `component-geometry.js` 須一致。
- `component-clipboard.js` 的元件／油管複製貼上需新ID、非空編號唯一，不複製原接管或自動接通重疊管線。編修模式啟用Ctrl/Command+C/V，文字欄位與對話框保留原本行為。點元件庫新增以目前view中心精確擺放；拖曳新增沿用指定落點。
- 新圖面僅重置工作畫布，解除已命名圖面身分、清除底圖與舊作業；儲存區記錄不得變更，支援復原。底圖套用選項透過 `drawing-actions.js` 原子建立新狀態，取消不修改原圖。

- `source-settings.js` 統一槽口用途、出／入土端模式與有效供油口；`flow.js`、屬性介面與作業須共用同一規則。新作業的 optional `sources` 保存 tank enabled／portModes、ground enabled／flowMode；舊作業無 sources 時只套用閥位。作業不得改變油品、幾何或實體接點，這些模式不影響拓樸相容性。
- 管端磁吸在放開時以約14螢幕像素判斷，必須建立實際圖形接管並保留復原；僅吸附合法未占用目標，不可靠座標重疊假裝接通。獨立直管長度可含小數，幾何計算不可四捨五入，以免磁吸後另一端偏移。
- `pipe-visuals.js`／`.css` 僅修正顯示：共享接管點附近裁掉外框底線，交叉處遮罩與層級照常；閥門管端採 butt 平口。一般閥門法蘭接點為±29，過濾器與流量計仍±36，立管閥仍中心點，符號、接點與編號邊界須一致。

- 油槽槽身半徑46，A／B／C實際接點半徑由 `TANK_PORT_RADIUS` 統一為46+4/3，短管外露長度是舊版三分之一；渲染、引導柄與磁吸必須共用幾何。A／B／C引導線約縮至三分之一，控制點仍需避開縮放及旋轉柄。
- 元件庫僅保留一個「出／入土端」入口，屬性可切 rise／sink；此圖示類型與 source／receive／idle 運轉模式獨立。保留舊圖類型、單一 port 及已接管線，不因切換圖示擅自反轉來油模式。
