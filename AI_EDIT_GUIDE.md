# 用各自的 GPT／Claude 共用開發

共用程式庫：https://github.com/LYL8021/oil-flow-studio

每人使用自己的 GitHub 帳號及程式助理，並取得這個程式庫的寫入權。Codex、Claude Code 或其他可操作程式庫的助理需各自連接此專案；只把網站網址貼進聊天視窗，不會取得修改權限。

## 共用流程

以下以 GitHub 權限及 Git 自動部署已接妥為前提；本文件不代表上傳或部署已完成。

1. 從最新 `main` 建立本次修改的分支，先讀 `AGENTS.md` 及相關程式。
2. 修改、預覽並檢查，提交後推送分支，建立 Pull Request（PR）。
3. 檢查並合併 PR 至 `main`，由已接妥的部署服務發布。
4. 等部署成功，大家重新整理同一個正式網址，即可看到更新。

這不是逐字即時同步。同時修改相同檔案可能需要處理合併衝突，請每項修改使用不同分支，保留彼此的工作。

原 ChatGPT Sites 網址不會自動跟隨此程式庫更新；請使用接妥自動部署後的正式網址。各自瀏覽器內的油路圖也不會同步，要分享某張圖請匯出／匯入專案 JSON。

## 檔案與命令

- `dist/index.html`：頁面；`dist/app.js`：操作與存檔；`dist/*.css`：外觀。
- `dist/flow.js`：通油；`dist/pipes.js`：管線幾何；`dist/symbols.js`：元件圖示。
- `dist/component-clipboard.js`：單元件與單段油管複製貼上；`dist/component-labels.js`：貼近圖示的編號排位；`dist/drawing-actions.js`：新圖面及保留／不保留元件的底圖套用。
- `dist/component-geometry.js`：元件縮放、旋轉及接點位置；油槽入口／出口各自調角度，進口不會經槽內直接連到出口。改動時須保留舊圖出口方位與供油開關的意義。
- `dist/pipe-runs.js`：連續畫管及明確接管；`dist/pipe-order.js`：交叉層級；`dist/text-marks.js`：文字標記；`dist/operations.js`：閥位作業相容。
- `dist/image-draft.js`、`dist/vendor/ocr/`：圖片候選辨識、模型與 WASM；保留完整資源及授權。候選須人工確認，不會自動接好管線。
- `dist/pdf-import.js`、`dist/vendor/pdf/`：瀏覽器內 PDF 選頁、轉向與渲染，內附 PDF.js 6.4.299 的 renderer、worker、CMap、字型、WASM 及授權；發布時完整保留，不使用外站處理私人 PDF。`dist/reference-layout.js` 接受 25%～1000% 的底圖縮放，最大尺寸 30000；底圖位置、元件與油管轉折點座標支援 ±40000，各處幾何與匯入檢查須一致。
- `tests/`：通油與管線測試；`scripts/package-offline.py`：更新離線下載成品。
- `dist/feedback.js`、`dist/feedback.css`：共用修改建議介面；`server/`：匿名留言後端與 D1 遷移，獨立於 Vercel 靜態部署，維護前先讀 `server/README.md`。

在專案根目錄執行：

```bash
python3 -m http.server 4173 --directory dist
```

開啟 http://localhost:4173，修改後重新整理；Windows 可改用 `py -3`。Node.js 測試用 `npm test`，不需安裝套件。若需同步離線下載版，執行 `python3 scripts/package-offline.py`，它會產生忽略於 Git 的 `portable/`，並更新既有 `dist/oil-flow-studio.zip`。離線單檔版支援元件旋轉、縮放、油槽雙接點與含 PDF 底圖的專案 JSON；原始 PDF 上傳及文字辨識請使用線上版。

靜態部署選擇 `main`，輸出目錄為 `dist`，不需安裝依賴或框架建置。本機預覽命令不是部署建置命令。

## 可貼給程式助理的需求

```text
請修改 https://github.com/LYL8021/oil-flow-studio。
先讀 AGENTS.md、README.md 和 AI_EDIT_GUIDE.md，從最新 main 建立工作分支。
我要修改：【描述預期行為】。
保留既有存檔、JSON 相容性與通油規則，完成相關檢查，提交並建立 PR。
回報改動、驗證結果及限制，不要覆蓋別人的工作。
不要提交憑證、私人圖紙／草稿或原 Sites 部署身分。
```
