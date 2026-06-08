# 內帳藍圖（乙）：帳戶 + 交易明細（多銀行/貸款/零用金互串）

> 目標：之後做財務內帳時，多個帳戶（銀行、貸款、零用金、現金…）能互相轉帳、各自有餘額、又不會把「資金移動」誤算成「工程成本」。
> 原則：**分開「資金流（帳戶間移動）」與「費用歸屬（成本分類）」**。

## 核心觀念
一筆錢動，先分類型：
| 類型 | 例子 | 算工程成本？ | 影響帳戶 |
|---|---|---|---|
| 轉帳 transfer | 公司帳戶→零用金；銀行→還貸款 | ❌ 只是搬家 | 從 A 扣、進 B |
| 支出 expense | 零用金付油漆、銀行付廠商 | ✅ 算（標工種/科目） | 從某帳戶扣 |
| 收入 income | 業主撥款進公司帳戶 | — | 進某帳戶 |

## 資料結構（兩張表）
```sql
accounts（帳戶）
  id, name, type('bank'|'loan'|'petty'|'cash'|'company'),
  opening_balance, currency='TWD', active

ledger（交易明細）— 一筆一列
  id, date,
  kind('transfer'|'expense'|'income'),
  amount,
  from_account_id,   -- 出（expense/transfer 用）
  to_account_id,     -- 進（income/transfer 用）
  category,          -- 費用科目/工種（expense 用）
  cat_id,            -- 對應工程大項（expense → 滾進總覽成本）
  vendor, invoice_no, note,
  receipts jsonb,    -- 憑證（沿用共用 ReceiptUploader 格式）
  is_cost boolean    -- 是否計入工程成本（transfer=false, expense=true）
```

## 每個帳戶餘額怎麼算
`餘額 = opening_balance + Σ(進本帳戶) − Σ(出本帳戶)`
（income.to、transfer.to = 進；expense.from、transfer.from = 出）

## 零用金如何自然融入
- 「零用金」就是一個 `account(type='petty')`。
- 目前的「撥款紀錄」＝ `transfer`：公司帳戶 → 零用金。
- 目前的「花費明細」＝ `expense`：from=零用金帳戶、cat_id=工種、is_cost=true。
- → 零用金頁其實就是「篩選 from/to = 零用金帳戶」的帳本視圖。

## 貸款怎麼處理
- `account(type='loan')`，餘額為負代表欠款。
- 動撥＝transfer 貸款→銀行；還款＝transfer 銀行→貸款（本金）；利息＝expense（算財務費用，非工程成本）。

## 工程成本怎麼滾
- 工程實際成本 ＝ Σ ledger 中 `is_cost=true` 的 expense，依 cat_id 歸到各工程大項。
- 「報價單已付」可逐步改成也走 ledger（expense, from=公司/銀行帳戶, cat_id=該大項），全部統一。

## 分階段
1. **甲（已做）**：零用金花費帶「零用金帳戶」概念，實支併進儀表板「工程實際成本」。
2. 乙-1：建 accounts 表 + 帳戶管理頁（新增銀行/貸款/現金，設期初餘額）。
3. 乙-2：建統一 ledger（交易明細）＋各帳戶餘額＋轉帳介面；零用金頁改成 ledger 的一個篩選視圖。
4. 乙-3：把「報價單付款」也納入 ledger（統一資金來源），對帳/月報。

## 注意
- 介面要把「轉帳」跟「支出」清楚分開（顏色/標籤），避免老闆誤把撥款看成花費。
- 沿用既有共用元件：日期＝DateField、憑證＝ReceiptUploader。
- 金額一律 fmt()＋tabular-nums；可編輯表格沿用零用金花費明細那套（搜尋/篩選/排序/拖曳/勾選批次/AI歸類）。
