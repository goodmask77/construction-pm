# 搬家／災難復原清單（construction-pm）

> 2026-09-15 張良問「複製 App 為什麼會少東西」後建立。
> 原則：App＝分住六個家的東西，搬家＝照這份清單逐項搬＋逐項驗收，沒有神祕失蹤這回事。

## 一、六個家的盤點

| # | 東西 | 住在哪 | 搬法 |
|---|------|--------|------|
| 1 | 程式碼 | 本機 `~/Documents/Claude/Projects/construction-pm`（**以本機 git 為準**，origin/main 落後一百多 commit 別信） | 整個資料夾複製即可 |
| 2 | 部署平台 | Vercel project `construction-pm`（prj_i307L7SJ8LXvQpVeRf0YBNmYAjGx），網域 ground-pm.vercel.app | 新家 `vercel deploy --prod`；**網域要跟著搬**（搬走網域＝LINE webhook 免改） |
| 3 | 排程 | `vercel.json` 的 crons（5 條）——**寫在程式碼裡，部署即生效，不用手動設** | 隨 #1 自動搬 ✅ |
| 4 | 資料庫 | Supabase project `nfzaorkffvyldcbqagte`：表 `pm_documents`（所有業務資料）、`profiles`＋Auth（帳號） | Supabase 後台匯出/備份 → 新專案匯入 → **對筆數** |
| 5 | 檔案 | Supabase Storage：`photos` 桶（公開，相簿/檔案庫）＋私密桶（人事文件，見 `_onboard.js` BUCKET） | Storage 整桶下載 → 上傳新家 → 抽查連結 |
| 6 | 外部指向 | LINE Developers 後台（bot「DD」）：webhook 指向 `https://ground-pm.vercel.app/api/line-webhook` | 網域沒變＝免改；變了才去 LINE 後台改一行 |

## 二、金鑰清單（值讀不回來＝正常，去原發行處重領）

| 環境變數 | 去哪重領 |
|---|---|
| SUPABASE_URL | 非機密：`https://nfzaorkffvyldcbqagte.supabase.co` |
| SUPABASE_SERVICE_ROLE_KEY | Supabase 後台 → Settings → API Keys（Legacy service_role），張良登入複製 |
| ANTHROPIC_API_KEY | Anthropic Console |
| LINE_CHANNEL_ACCESS_TOKEN | LINE Developers → DD channel → Messaging API（複製現成的，別 Reissue） |
| LINE_CHANNEL_SECRET | 同上 → Basic settings |
| BOT_OP_CODE / BOT_VAULT_KEY | 自訂值；VAULT_KEY 換掉＝舊密碼庫解不開，**必須沿用原值**（張良保管） |
| MAIL_USER / MAIL_PASS | Gmail 應用程式密碼（mail-sync 收 POS 日結信用） |
| JOYA_* / EATS_* | POS 後台帳密（張良保管） |
| VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY | Supabase 後台（前端用，非高機密） |

設定方式：Vercel 專案 → Settings → Environment Variables（標 Sensitive）。

## 三、搬完的驗收（全綠才算搬好）

1. `npm run selftest` 全過（41+ 條）
2. 資料筆數：新舊 `pm_documents` 行數一致
3. `curl https://api.line.me/v2/bot/channel/webhook/endpoint`（帶 LINE token）→ 指向正確網址
4. 跟 DD 私訊講一句話 → 有回、資料齊
5. 打 `/api/cron-daily?dry=1&mode=morning` → 回得出任務簡報
6. App 登入 → 相簿圖片正常顯示（抽查 3 張）
