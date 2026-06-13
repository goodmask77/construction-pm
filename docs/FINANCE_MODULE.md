# 財務內帳模組（給接手開發的財務負責人）

這個「財務內帳」空間的程式**獨立成一個資料夾**：`src/finance/`。
你要改/優化財務功能，**原則上只動這個資料夾**，碰不到工程/總覽，不會把別的弄壞。

## 檔案
- `src/finance/Finance.jsx` — 整個財務空間的 UI 與邏輯（總覽 / 帳戶 / 交易明細）。
- 共用工具：金額格式 `fmt` 從 `src/lib/cost.js` import；憑證上傳元件 `ReceiptUploader`、確認框 `confirm`、是否可編輯 `canEdit`、儲存 key 函式 `K` 由 App 以 props 傳入。

## 資料結構（照內帳藍圖）
- **帳戶 accounts**（存 `pm_fin_accounts`，依空間前綴）：`{ id, name, type, opening, note, active }`，type＝bank/company/cash/petty/loan。
- **交易 ledger**（存 `pm_fin_ledger`）：`{ id, date, kind, amount, from, to, category, vendor, invoiceNo, note, receipts }`，kind＝expense(支出)/transfer(轉帳)/income(收入)。
- **餘額** = 期初 opening + Σ(到本帳戶) − Σ(從本帳戶)。
- 觀念：**轉帳＝資金搬家、不算成本**；**支出＝費用（標 category 科目/工種）**；**收入＝錢進帳**。

## 怎麼開放給人用 / 接手開發
1. **用資料**：到 設定→帳號，給對方帳號＋勾「財務內帳」空間的「可見/可編輯/看金額」。他登入就能編。
2. **接手開發**：把他加進 GitHub repo + Vercel；他用自己的 Claude Code 改 `src/finance/`。約定**走分支＋PR**，正式上線前互看一眼。金鑰一律放 Vercel 環境變數，別寫進程式。

## v1 已做
帳戶 CRUD、交易明細表（新增/編輯/刪除/搜尋/篩選類型與帳戶/依日期排序/憑證）、財務總覽（各帳戶餘額、資產/貸款/淨額）、受「看金額」權限控管。

## 待做（路線圖）
- **Gmail 自動入帳**：抓銀行轉帳通知 email → AI 解析 → 用批號去重 → 對應帳戶 → 產生「待確認」分錄 → 一鍵入帳。詳見 docs/LEDGER_BLUEPRINT.md。
- 月報/對帳、把「報價單已付」也納入 ledger 統一資金來源、科目自動歸類（D哥）。
