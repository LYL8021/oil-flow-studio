# 程式代理指引

- 先讀 `README.md`、`AI_EDIT_GUIDE.md` 和相關模組；共用 repo：https://github.com/LYL8021/oil-flow-studio 。
- 從最新 `main` 建立工作分支，透過 PR 合併；保留其他人工作，不要強制推送或覆蓋提交。
- 原生 HTML/CSS/JS，發布完整 `dist/`；免依賴安裝、免框架建置、免 API 金鑰。保留 `dist/vendor/ocr/` 的模型、WASM 及授權。
- 預覽：`python3 -m http.server 4173 --directory dist`，開啟 `http://localhost:4173`；Windows 可用 `py -3`。`npm run dev` 也是 Python 預覽。
- Node.js 測試：`npm test`；相關測試可用 `node --test tests/flow.test.mjs` 或 `node --test tests/pipes.test.mjs`。按改動執行必要檢查，畫面／互動需預覽；未驗證處明說。
- 同步離線下載版：`python3 scripts/package-offline.py`；提交更新的既有 `dist/oil-flow-studio.zip`，不用提交產生的 `portable/`。離線版不含完整 OCR。
- 保留既有 JSON 匯入相容性與瀏覽器存檔。燃料油橘色、柴油淺藍色、汽油淺綠色，多種同時可達用對應的雙色／三色條紋，不計算混油比例。
- 關閥後重新計算有效油源可達性；上游保留顏色，下游若有旁通或其他有效來源仍顯色。三通／四通內部連通，管線交叉不自動連接，盲封僅一個接管端，直油管兩端可留空。
- 保留自由斜走、任意角度、轉折點、跨管、地下管、主題及匯入匯出。跨管／地下管顯示不改變連通；不虛構壓力、流量或殘油量，流量計只隨油源顯色。
- 圖片辨識候選需人工確認，不自動接線或新增有效供油來源；維持瀏覽器內處理方式。
- 不得提交憑證、token、環境秘密、私人 PDF／參考圖／草稿、瀏覽器資料、原 `.git` 或原 Sites 的 `.openai/hosting.json` 等部署身分。
- 自動部署需先接妥，合併 `main` 後等部署成功再刷新；原 Sites 網址和各自瀏覽器油路圖不自動同步。未確認推送／部署成功，勿聲稱已上線。
- 出／入土端使用 `ground` 的單一 `port`；只有 `enabled === true` 才可供油，預設出土啟用、入土停用，站名只作標示。
- 文字標記 `text` 無接管點，不供油、不改變閥位作業相容性；保留多行、字級、字色、旋轉與 JSON／SVG 匯出。元件名稱與編號可空白，畫布只顯示一般元件編號。
- 管線 `.layer` 僅控制交叉顯示，必須保存並沿用到拆管；立管閥的中心視覺接點仍對應兩個隔離的邏輯端點。編修畫布不顯示開關標籤。
