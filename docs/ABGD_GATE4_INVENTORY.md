# abgd 關卡 4：排程與外部串接盤點（2026-10-18）

> 來源：CC 子代理讀 GD vercel.json 與 api/*、新殼 app/api 與 migrations；獨立 Claude 對照程式複核。設計審查紀錄：scratchpad gate4/（OpenAI 兩輪、獨立 Claude 一輪）。

## 一、關鍵卡點：新殼沒有外部金鑰
- 新殼正式環境變數只有：BRIDGE_SECRET、CRON_SECRET、GD_BASE_URL、GD_OPS_BOARD_KEY、GD_PROBE_KEY、GD_SB_KEY、GD_SB_URL、SUPABASE_*、SIDE_EFFECTS。
- 外部服務金鑰全部只在 GD 專案（Vercel construction-pm）。規則：AI 不經手正式金鑰（Vercel 機密變數本來也拉不下來）→ **要搬一支排程，得先由張良把該排程的金鑰複製到新殼專案（Vercel abgd）**。
- 例外：只靠 DD 發 LINE 的排程——新殼一律經 GD 代發口（abgd-fx）發 LINE，不需要 LINE 金鑰 → 可先搬。

## 二、各排程要的金鑰（只列名稱）
| 排程 | 要複製到新殼的環境變數 | 備註 |
|---|---|---|
| lineoa-sync（LINE 官方帳號統計） | LINE_OA_AB_TOKEN、LINE_OA_GD_TOKEN、LINE_OA_HR_TOKEN、LINE_OA_DD_TOKEN（各帳號 _SECRET 也一起） | 收件匣 webhook 搬時也要 |
| social-collect／social-publish（FB／IG） | META_APP_ID、META_APP_SECRET、META_GRAPH_VERSION、SOCIAL_DRY_RUN | 另：Meta App 後台加新網址 Redirect URI |
| pinterest-sync | （公開網頁，不用金鑰）；但圖檔目前存 GD 儲存桶 photos | 圖片網址要不要換網域待定 |
| em-sync（小夏 EM） | EM_API_KEY | |
| boss-sync（阿桑） | BOSS_API_BASE_URL、BOSS_API_KEY、PARTNER_API_KEY | |
| inline-sync | INLINE_EMAIL、INLINE_PASS | |
| hr（NUEiP） | NUEIP_USER、NUEIP_PASS、NUEIP_COMPANY、NUEIP_FUNCPASS | 新殼跑東京、GD 跑孟買：IP 地區不同可能被擋，先試 |
| joya-intraday／mail-sync 夜間（喬亞、Eats365、Gmail） | JOYA_USER、JOYA_PASS、JOYA_COMPANY、EATS_USER、EATS_PASS、EATS_DEVICE_COOKIE、MAIL_USER、MAIL_PASS（MAIL_USER2／PASS2 屬 finance 已取消可不搬）、WEBPUSH_PUB、WEBPUSH_PRIV | Eats 裝置 cookie 只能一邊用，搬那天交接 |
| task-remind、cron-daily 簡報、sop-summary | 不需要（經 GD 代發口） | **可先搬** |

## 三、19 支排程（GD vercel.json）
em-sync（每小時:40）、task-remind（每小時）、cron-daily（08:00／17:30／21:00）、mail-sync（21:30／22:30／23:30）、joya-intraday（11:00–21:45 每 15 分）、sop-summary（20:05）、boss-sync（每小時:07）、eats-rhythm（21:50）、inline-sync（每小時:25）、line-webhook 保溫（每 5 分，跟 DD 一起搬）、hr（22:40；09:00–21:40 每 20 分）、social-collect（每 3 小時）、social-publish（每 15 分）、lineoa-sync（每小時:50）、pinterest-sync（每小時:35）、mail-sync 看門狗 abgdwatch（每 5 分，GD 退役時一起拔）。
- 新殼已有替身、GD 自動跳過：菜商報價、低水位、會議提醒、食譜成本快照。
- 可停：sheet-sync 與中信信件（finance 取消不搬）、會員生日禮（會員暫停）。
- 已知問題：信箱每日整理寫 07:00 跑，但排程沒有這個時段＝從沒自動跑過。

## 四、外部入口（最後一次請張良改外部後台）
LINE Developers：DD＋三個官方帳號的 Webhook URL；員工 LIFF Endpoint；Meta App Redirect URI；iPad 打卡站網址；通知阿桑換 partner-api 網址；舊網域 ground-pm 保留轉址（/v/ 短網址、入職簽約連結、/liff、menu-ground.html；先暫時轉址、確認後才永久）；sw.js 推播換網域要重新訂閱。

## 五、控制面設計（審查中）
- 採獨立 Claude 建議的簡化版：新殼 ops.cron_ctl 單一權威（runner＝gd｜abgd）＋執行租約＝排程執行上限＋60 秒（只准延後不准縮短）＋所有業務寫入沿用命令橋既有的寫入期限（deadline＝租約到期）＋所有入口（排程、手動、頁面「立即同步」）都在函式本體取租約。
- 通知去重要逐支寫規格（觸發條件、標記、冪等鍵、同交易寫標記＋排通知）；GD 舊路徑「先發後寫」在切換那一刻仍可能重發一則（殘餘風險）。
