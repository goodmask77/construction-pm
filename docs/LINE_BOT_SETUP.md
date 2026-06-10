# LINE bot（D哥）搬進本 repo — 啟用步驟

D哥的後端已重建在本專案（不再依賴外部 `ground-pm-webhook`）：

| 檔案 | 作用 |
|---|---|
| `api/line-webhook.js` | 收 LINE 群組訊息 → 登記群組、依「唯一真相快照」回答問題（D哥的大腦） |
| `api/push.js` | 主動推播訊息到 LINE（通知/速報用） |
| `src/lib/snapshot.js` | App 存檔時把權威資料寫進 `pm_bot_context`，bot 只讀這一個 → 數字永遠跟畫面一致 |

## 需要設定的環境變數（Vercel → 本專案 → Settings → Environment Variables）
只有 **2 個是新的**，其餘本專案已經有：

| 變數 | 新? | 從哪拿 |
|---|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | ✅ 新 | LINE Developers → 你的 Messaging API channel → Issue/long-lived token（或從舊的 ground-pm-webhook 專案複製） |
| `LINE_CHANNEL_SECRET` | ✅ 新 | 同上 channel 的 Basic settings |
| `ANTHROPIC_API_KEY` | 已有 | 本專案已設（AI 顧問在用） |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | 已有 | 本專案已設（帳號管理在用） |

## LINE 後台設定
1. Messaging API → **Webhook URL** 設成： `https://ground-pm.vercel.app/api/line-webhook`（本專案正式網域）
2. 開啟「Use webhook」。
3. 關閉「自動回應訊息」、開啟「Webhook」回應模式。
4. 把 D哥加進工地群組。

## 切換主動推播到本專案（設好 token 後）
App 內 `LINE_PUSH_URL` 目前仍指向舊外部 push（仍可動）。設好 `LINE_CHANNEL_ACCESS_TOKEN` 後，把它改成 `"/api/push"` 即切到本專案。

## 待測/加固（接好 keys 後一起做）
- 確認 Vercel 是否把 webhook 的「原始 body」交給函式（簽章驗證需要）。若平台先解析掉 body，會走 fallback、暫時略過嚴格驗章 → 上線測試時補強（例如改用 edge/raw 讀取）。
- D哥目前只在訊息含關鍵字（D哥/進度/未付/餘額/報告…）或問號時回話，避免洗版。可再調。
- 每日速報/週報＝之後加 Vercel Cron 打 `api/push`。
