# DESIGN_SPEC.md — UI 設計語言

> 目標風格：Linear / Vercel / Stripe dashboard 那一派的乾淨 B2B 儀表板美學。
> 技術：React + Tailwind，建議搭 shadcn/ui 元件庫、lucide-react 圖示。
> 核心原則：**克制**。這個 look 的乾淨來自「刪掉」，不是「加上」。有疑慮時，減法。

---

## 1. 色彩（最重要，也最容易做壞）

- **中性色是主體**，彩色是點綴。整個頁面 90% 是白 + 灰。
- **只用一個主色**。全站一種強調色（藍或青綠，二選一），不要每個區塊換色。
- 語意色只在「狀態」出現，而且面積要小（通常只是一個小圓點 + 文字）。

| 用途 | Tailwind | 說明 |
|---|---|---|
| 頁面背景 | `bg-white` / `bg-neutral-50` | |
| 主要文字 | `text-neutral-900` | 近黑，不要純黑 |
| 次要文字 | `text-neutral-500` | 說明、副標 |
| 小標籤 | `text-neutral-400` | 大寫、加字距的欄位標題 |
| 邊框/分隔線 | `border-neutral-200` | 一律 1px |
| 主色（強調） | `blue-600` 或 `teal-600` | 全站擇一 |
| 成功/正常 | `green-600` | 多半以 `●` 小圓點呈現 |
| 警示/風險 | `amber-600` | At Risk 那種 |
| 逾期/嚴重 | `red-600` | 只給真正緊急的事 |

飽和度壓低，不要螢光色。狀態用「灰底 + 彩色圓點」比「整塊彩色」更像這個風格。

## 2. 字體與階層

- 字體：Inter 或系統 sans-serif。
- 大標粗體（`font-semibold`）、內文 regular。不要到處 bold。
- **欄位標題用小號、大寫、加字距**：`text-xs uppercase tracking-wide text-neutral-400`
  （就是圖裡 ORKSTREAM / PROGRESS / OWNER / STATUS 那種）
- 標籤下面配一行灰色小字說明（如 Product → "Shipping great software"）——這是這個風格的招牌手法。

## 3. 間距與版面

- **留白優先**。卡片內距 `p-6`，區塊間距 `gap-6`。寧可空，不要擠。
- 卡片分區：白底 + `border border-neutral-200` + `rounded-lg`（8px）。
- 分隔線 1px、淺灰，不要粗線。
- 主內容 + 右側窄欄（放「Needs Attention / 待辦」次要資訊）的兩欄結構，很符合這個風格。

## 4. 元件語彙（直接用這些詞跟它講）

- **圓環進度**（circular progress ring）：如 "82% Ready"
- **線性進度條**（linear progress bar）：細、圓角、灰軌 + 主色填充
- **狀態徽章**（status pill）：`● On Track` — 小圓點 + 文字，別用大色塊
- **頭像縮寫圓**（avatar initials）：淺色底 + 兩字縮寫（AR、JM）
- **資料表格**：欄位對齊、列高寬鬆、無斑馬紋或極淡、`hover:bg-neutral-50`
- **水平時間軸**：節點 + 勾選 + "You are here" 標記
- 圖示一律用 **lucide-react 線性圖示**，細線、不填色。

## 5. 負面清單（做到這些，一半就對了）

- ❌ 不要 drop shadow（最多 `shadow-sm`）
- ❌ 不要漸層（圖表的信賴區間淡色填充例外）
- ❌ 不要第二個強調色
- ❌ 不要粗邊框（一律 1px）
- ❌ 不要 emoji 當圖示（用 lucide）
- ❌ 不要高飽和/螢光色
- ❌ 不要大圓角的「軟糖感」（卡片 8px 就好）
- ❌ 不要塞滿——留白是這個風格的一部分，不是浪費

## 6. 狀態處理（demo 好看、上線就崩的分水嶺）

那兩張參考圖是**行銷 mockup**，資料都是喬好的。你接 Supabase 真資料後，一定會遇到 demo 沒有的狀況。要求 Claude Code 用**同樣克制的風格**處理：

- **空狀態（empty）**：淺灰圖示 + 一行 `text-neutral-500` 說明，不要空白一片
- **載入中（loading）**：用 skeleton（淺灰佔位塊），不要轉圈 spinner
- **文字過長**：`truncate` 或限制行數，不要撐爆版面
- **數字對齊**：表格數字用 `tabular-nums` 右對齊
- **RWD**：右側窄欄在手機上收到主內容下方

> 沒處理這些，你的 app 會「截圖很美、實際用起來很亂」。這是這種風格最常見的翻車點。

---

## 給 Claude Code 的起手 prompt 範本

> 依 DESIGN_SPEC.md 建這個頁面。用 shadcn/ui + Tailwind + lucide-react，走 Linear / Stripe dashboard 風格。
> 中性色為主、單一主色（[藍色/青綠]）、語意色只用在狀態小圓點。
> 卡片式分區、1px 淺灰邊框、大量留白、欄位標題用大寫小標。
> 一併處理 empty / loading / 文字溢出 / RWD，維持同樣克制的風格。
