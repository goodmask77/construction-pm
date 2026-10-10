# DD 穩定化｜批次 1a 交付（止血＋觀測）v4.70.39

> 溝通中樞執行檔 `docs/COMMS_PLAN.md` 第一部項目 1 的第一批。原則：**先把會掉訊息、會無聲失敗的地方堵起來，並裝上儀表**；「整包塞資料改工具查詢」（項目 1 第 1 點，最大也最有風險）另開批次 1b。
> 三家 AI 審查（`docs/COMMS_REVIEW_3AI.md`）共識：答案盡量仍走免費 reply、push 只當失敗補救；對話訊息不要一鍵擠全部。本批照此做。

## 開工前的 7 天統計（規格要求）

| 來源 | 能看到什麼 | 結果 |
| --- | --- | --- |
| Vercel 函式 log | 只保留很短時間，7 天前的已經沒有 | **無法統計**，這就是為什麼要先裝健康紀錄 |
| AI 用量儀表板（`pm_ai_usage_`，10-10 上線） | DD 路由的呼叫數、token、失敗 | 10-10 當天：5 次呼叫、0 次失敗、**平均每次輸入約 79,000 token、合計 USD 1.86**（約每題 NT$12） |
| DD 群組回話紀錄（`pm_dd_replylog`） | 只記群組、不記成敗與秒數 | 不能當失敗統計 |

結論：現有紀錄無法回答「過去 7 天失敗幾次、為什麼」；本批先裝健康紀錄，**上線 7 天後**健康頁就是這份報告。另外 79k token／題證實「整包塞資料」又慢又貴，批次 1b 要做。

## 改了什麼（程式 diff 見 PR）

| # | 問題（現況） | 改法 | 檔案 |
| --- | --- | --- | --- |
| 1 | LINE 重送（redelivery）整筆跳過＝第一次沒收到的訊息永久遺失 | 用 `webhookEventId` 去重：每個事件插入一列 `pm_ddev_<id>`（撞到＝處理過才跳；沒處理過的重送照常處理） | `api/_ddhealth.js` `ddEventOnce`、`api/line-webhook.js` 事件迴圈 |
| 2 | reply 失敗（token 逾時／已用過）只記 log，使用者看到沒反應 | `lineReply` 多一個 `fallbackTo`：reply 回 400 就改 push 給同一個人／群；健康頁記「改推播」次數（會計費，所以只在失敗時用） | `api/line-webhook.js` `lineReply`、`send` |
| 3 | 所有對話記憶擠在 `pm_bot_chats` 一鍵，兩個對話同時進來互相覆蓋 | 每個對話各自一鍵 `pm_bot_chat_<convId>`／`pm_bot_chatsum_<convId>`；舊鍵只讀不寫（第一次讀不到新鍵才讀舊鍵＝懶遷移，不用搬資料） | `api/line-webhook.js` `loadConv`/`getChatHistory`/`pushChat` |
| 4 | 驗簽結果只記 log、照樣處理（偽造事件可操作任務） | 驗簽失敗一律記健康紀錄；環境變數 `LINE_SIG_STRICT=1` 才拒絕。先觀察健康頁「驗簽失敗」是 0，再開 strict | `api/line-webhook.js` |
| 5 | 沒有任何「DD 回得怎樣」的數字 | 每則回覆記一列 `pm_ddh_<日期>_<流水>`：秒數、成敗、reply/push 結果、AI 用哪家／備援／token／截斷；例外、驗簽失敗、去重也記 | `api/_ddhealth.js` `ddHealthLog`/`ddHealthSummary` |
| 6 | 健康頁 | /prep 設定頁新按鈕「DD 健康」：近 7／14 天 KPI 磚（則數、中位秒數、>30 秒、改推播、AI 備援、截斷、平均輸入 token、驗簽失敗、重送去重、例外）＋每日表＋失敗原因＋最近失敗清單；審核人限定 | `api/mail-sync.js ?ddhealth`、`public/ops/js/p09-ntf-crew.js ddHealthOpen`、`p08` 按鈕 |
| 7 | 新紀錄會一直長 | cron-daily 每天清：去重列留 2 天、健康紀錄留 30 天 | `api/cron-daily.js`、`ddHealthCleanup` |

## 資料變更與回滾

| 新增 key | 內容 | 量 | 回滾 |
| --- | --- | --- | --- |
| `pm_ddev_<webhookEventId>` | `'1'`（只當去重用） | 每個 LINE 事件一列，2 天後自動刪 | 直接刪（`DELETE id like pm\_ddev\_%`），無副作用 |
| `pm_ddh_<YYYY-MM-DD>_<流水>` | 一筆健康紀錄 JSON | 每則回覆一列，30 天後自動刪 | 直接刪 |
| `pm_bot_chat_<convId>` / `pm_bot_chatsum_<convId>` | 該對話的逐字記憶／滾動摘要 | 每個對話一列 | 回滾程式即可：舊鍵 `pm_bot_chats`/`pm_bot_chatsum` **沒動**，舊版程式照常讀；上線後新對話只進新鍵，回滾會少掉這段期間的記憶（不影響功能） |

沒有改任何既有 key 的格式；沒有刪資料。

## 環境變數

| 變數 | 用途 | 現在 |
| --- | --- | --- |
| `LINE_SIG_STRICT` | `=1` 才拒絕驗簽失敗的請求 | 未設＝觀察模式。**上線觀察 1–2 天健康頁「驗簽失敗」為 0 後，由 CC 設為 1** |
| `OPS_BOARD_KEY` | /prep 金鑰 | 原只有 Production；本批加到 **Preview**，PR 預覽網址才開得了 /prep（之後所有 PR 都受益） |

## 使用步驟（張良）

1. /prep → 設定 → 「DD 健康」→ 看近 7 天數字（上線前是空的）。
2. 要驗證就在 DD 測試群或私訊問 DD 幾題，回來看則數、秒數有沒有長出來。

## 驗收（merge 到正式站後在 DD 測試群做）

- [ ] 連續 30 題（含兩人同時問）無遺失、無無回應
- [ ] 兩個人同時跟 DD 講話，各自的對話記憶都接得上（問「我剛剛說什麼」）
- [ ] 健康頁則數＝實際問的題數；失敗 0；秒數看得到分佈
- [ ] 健康頁「驗簽失敗」為 0（連續 1–2 天）→ CC 開 `LINE_SIG_STRICT=1` → DD 仍正常回
- [ ] 故意讓 reply 逾時（問一題很慢的）→ 答案仍以 push 送到，健康頁「改推播」+1

本機已做：`_ddhealth.js` 假資料庫單元測試 15 項全過（去重狀態對應、彙總算法、清理條件）；4 個後端檔 `node --check`、前端兩檔語法檢查、端點目錄檢查 200 口無重複。

## 未完成／下一批

- **批次 1b**：整包塞資料 → 工具查詢（項目 1 第 1 點）；同時是項目 4 快問引擎要共用的工具層。本批健康頁的「平均輸入 token」就是 1b 的前後對照指標。
- LINE 1:1 的「loading 動畫」API（免費、不耗 reply token）與 `waitUntil` 背景處理：等 1b 一起做，先看健康頁 >30 秒的比例決定急不急。
- 薪資文字 `loadSalaryText()`（目前是「分潤模型設定」不是個人薪資）要不要讓 AI 讀，屬項目 4「資料邊界」，本批不動。
- 真人測試需要 **DD 測試群**（人工待辦，張良）。
