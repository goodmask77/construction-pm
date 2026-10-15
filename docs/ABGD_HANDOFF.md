# abgd 搬家交接（2026-10-14 22:30，Opus 5.5）

> 下一個 session 開工：先讀這份 → docs/ABGD_MIGRATION_ORDER.md（張良指令全文）→ docs/ABGD_RECOVERY.md（恢復手冊 v12）→ docs/FEATURE_MAP.md（進度表＋5.2 SOP 刻意差異）→ docs/ABGD_3AI_LOG.md（關卡紀錄）。
> 授權（張良 10-14）：不等確認、一功能一功能搬完；新表不用先問；**取名字一律先問**；abgd 自己合併部署；GD 改動走 PR、檢查過自己合併並從 origin/main 部署。每個功能：真表→搬資料→對帳差 0→畫面→速度（P95 ≤ 0.5 秒）→關卡 3 三家（分 A 阻擋／B 程序，取較安全）→才切入口。**一律繁體中文回覆**（全域 CLAUDE.md 鐵則）。

## 一、目前狀態
| 功能 | 狀態 | 資料域（GD 前綴） |
|---|---|---|
| 登入／身分 F34 | ✅ 第 0 波 | — |
| 文件庫 F21 | ✅ 已切（epoch 4） | library |
| 會議 F14 | ✅ 已切（epoch 5） | meet |
| 回饋 F17 | ✅ 已切 17:30（epoch 38；關卡 3 共 14 輪） | feedback |
| SOP F02＋問題回報 F33 | ✅ 已切 20:45（epoch 1；9 輪） | sop（sp_finance_pm_sop_） |
| 班表 F15 第 A 段（班表主檔） | ✅ 已切 21:50（epoch 1；3 輪） | shift（只有 sp_finance_pm_shift_g） |
| 物料卡 F11 | ✅ 10-14 23:47 已切（epoch 1，關卡 3 四輪；GD 成本待辦合併經命令轉新殼，必帶操作編號） | matcard |
| 耗損 F09 | ✅ 10-15 01:26 已切（epoch 1，關卡 3 兩輪；當班驗收 15 項全過） | waste |
| 成本總覽 F13 | ✅ 10-15 03:22 已切（epoch 1，關卡 3 六輪；冒煙 24 項全過；03:27 拆驗收閘門） | cost |
| 食譜 F10 | ✅ 10-15 04:15 已切（epoch 1，關卡 3 兩輪；冒煙 21 項全過；04:17 拆驗收閘門） | recipe |
| 菜單成本 F12 | ✅ 10-15 04:53 已切（從 menu 拆出 pricing 域；關卡 3 兩輪；冒煙 12 項＋正式回切演練 10 項；epoch 2；04:57 拆驗收閘門） | pricing |
| 菜單 F18（菜單本體＋出圖版面） | ✅ 10-15 12:20 已切（關卡 3 三輪；冒煙 24 項＋正式回切演練 12 項；epoch 2；12:25 拆驗收閘門） | menu（只剩 sp_finance_pm_menu 前綴） |
| 盤點 F05／包材 F06／採購 F07 | ✅ 10-15 14:48 已切（關卡 3 五輪；冒煙 13 項＋正式回切演練 10 項；epoch 2；14:52 拆驗收閘門；低水位排程改新殼 /api/ops/cron/inv-low 11:05／11:20／11:35） | inv（sp_finance_pm_inv、sp_finance_pm_buy） |
| 物料庫 F08（分類） | ✅ 10-15 16:12 已切（關卡 3 兩輪；當班 27 項含成本讀者與回切演練；epoch 2；16:20 拆閘門） | matlib（只有 sp_finance_pm_boss_matcat） |
| 銷售設定（F29 人改四份） | ✅ 10-15 17:08 已切（關卡 3：OpenAI 七輪、Gemini 兩輪、Claude 一輪；GD 真實入口端到端；17:16 拆閘門） | posmeta（pos_hidden／alias／prices／costs；入口仍在 GD，經命令橋） |
| 聊天室 F22 | ✅ 10-15 18:27 已切（關卡 3：OpenAI 九輪、Gemini 六輪、Claude 一輪；當班兩次回切演練；epoch 3；19:50 拆閘門、30 分鐘監看乾淨） | chat（pm_chat_rooms、pm_chatm_、pm_chat_read_） |
| 錯誤日誌（App 錯誤自動回報，F33 下半） | ✅ 10-15 20:17 已切（關卡 3：OpenAI 兩輪、Gemini 三輪、Claude 一輪；當班＋回切演練；epoch 2；20:23 拆閘門） | issues（只剩 sp_finance_pm_errlog；pm_issues 改歸 dd 域；沒有入口，GD ?errlog 經命令橋） |
| 工時成本試算＋AB 模組班表（F15 第 B 段） | ✅ 10-15 21:1x 已切（關卡 3：OpenAI 五輪、Gemini 六輪、Claude 一輪；當班 19 項含 GD 下游、主 App／DD 欄位不變、回切演練；epoch 2；拆閘門後 30 分鐘監看乾淨）。**班表回切前要先回切 shiftplan**（畫面只掛在新殼班表頁） | shiftplan（sp_finance_pm_labor、sp_finance_pm_abmod；主 App 已停寫 labor） |
| 法規薪資 F41 | ✅ 10-15 22:26 已切（關卡 3：OpenAI 三輪、Gemini 兩輪、Claude 兩輪；當班 18 項含核准後 56 秒 GD 每日掃描讀得到、首次建立費率回切再切、違規通知只私訊張良送達；epoch 2；拆閘門）。入口 pay→/finance/payroll（**GD 側欄沒有這分頁**：新殼班表頁「違規清單／法規／薪資／違規」按鈕、GD 舊頁五個入口與 LINE 違規通知 #vio= 都先轉新版；沒登入跳提示） | payroll（只 sp_finance_pm_payrates、sp_finance_pm_vio_res） |
| 信箱中樞 F40 | ✅ 10-15 23:30 已切（B 模式：IMAP 與 MAIL_ENC_KEY 留 GD、資料歸新殼；GD 讀走 /api/core/gdread、寫走命令橋 put 帶版本號；新殼頁 /ops/mailhub 驗主管後呼叫 GD 代發口 mailhub_op；關卡 3：OpenAI 四輪、Gemini 六輪；**獨立 Claude 審查因子代理服務異常未能執行，待補**；當班 14 項含真的連系統信箱試算、驗收中搬信被擋、回切演練；epoch 2） | mailhub（sp_finance_pm_mailhub＋_scan_<id>） |
| 團隊任務 F03 | ✅ 10-16 02:0x 已切（關卡 3：OpenAI 四輪、Gemini 四輪；獨立 Claude 子代理卡住三次，改 CC 自查補出漏登記投影；第一次切換後看門狗因健康口誤判「引擎已刪的測試文件」02:01 自動退回（資料沒動），修健康口 v0.4.130 後 epoch 2 再切；冒煙 16 項；02:10 拆閘門；30 分鐘監看 6 次全一致）。GD 端 DD 團隊任務動作、kvproxy、提醒排程都經 _abgdkv.js 依歸屬選路 | tasks（sp_team_pm_task_、sp_team_pm_data、ptscfg、ownerord、tasks_v2；工程任務 pm_task_ 與活動紀錄留 GD） |
| 收件匣 F23 | ✅ 10-16 05:06 已切（B 模式：LINE 收發、AI、提醒留 GD；資料歸新殼。關卡 3：OpenAI 十二輪、Gemini 四輪；第一次切換追平超過 240 秒預算自動退回 → 控制器改同時 10 鍵（v0.4.139）＋跳過已是最新的鍵（v0.4.142）後 65 秒切完；冒煙 10 項＋回切演練 9 項；epoch 7；05:08 拆閘門，佇列 0、30 分鐘監看）。讀列表／讀對話新殼原生讀（P95 0.20 秒），圖片載入時才簽 | inbox（pm_inbox_；待補存佇列 pm_ibq_／送出標記 pm_ibsend_／通知工作 pm_ibnote_ 留 GD） |
| 其餘 | 待搬 | 見 FEATURE_MAP |

版本：新殼 v0.4.142（main）、GD v4.71.131（main，已部署）。

## 二、第 2 波順序（10-14 盤點結論）
 ~~成本總覽~~（10-15 已切；菜商報價排程改新殼 /api/ops/cron/cost-veg 每小時:05；快照灌入腳本已改打新殼維護口）→ ~~食譜~~（10-15 已切；成本快照改新殼 /api/ops/cron/recipe-snap 每小時:12；?gdfive 已停用）→ ~~菜單成本 F12~~（10-15 已切，pricing 域）→ ~~菜單 F18~~（10-15 12:20 已切；POS 牌價／成本／改名／隱藏四鍵移到 pos 域，跟銷售數據一起搬；主 App 已停用這些寫入 v4.71.81）→ ~~盤點／包材／採購~~（10-15 14:48 已切；**平日 10:55～11:40 不切入也不回切**；回切前查有沒有排隊中的 low_stock 通知）→ ~~物料庫分類~~（10-15 16:12 已切 matlib 域）→ boss 同步資料＋異常通知 F16＋銷售數據 pos 一起（boss-sync 會寫 AB 營收；boss_inc_ 歸 incidents；切 boss 域時比對要排除已拆出的 boss_matcat／boss_inc_）（最難：joya-intraday／mail-sync／eats-rhythm／boss-sync／inline-sync 五個排程＋主 App Finance.jsx、Supply.jsx 用 anon 直接寫且吞錯誤）。
- **前綴注意**：pos_prices／costs／alias／hidden 目前登記在 menu 域，建議移到 pos 域；絕不登記裸前綴 sp_finance_pm_ab；未歸屬鍵要先登記：sp_finance_pm_stale、sp_finance_pm_prep_act_、sp_supply_pm_*。
- 班表剩下：shiftplan 域（labor＋abmod；labor 主 App Finance.jsx 也整份寫，要先拆鍵）、NUEiP 班表（crew 域，等 hr.js 拆段 F42）。

## 三、搬一個功能的標準做法（照抄 SOP／班表）
1. abgd：migration 拆／登記資料域（core.domains、feature_domains、feature_routes enabled=false）→ 兩庫套用（scratchpad gdsql.mjs <ref> -f；abgd-prod=cvxfraewzuspajectpir、abgd-test=xyrciaevkchhazdpwhyy、GD=nfzaorkffvyldcbqagte）。
2. 子代理寫 lib/ops/<功能>.ts（gdTxn＋assertWriter＋canEdit 照 GD permWho）、app/api/ops/<功能>/route.ts、components、讀取合成一次 RPC（ops.<x>_view）＋authSub 並行；GD_DOC_KEYS 登記；scripts/reconcile.mjs 加功能。
3. 合併部署（scratchpad prmerge.mjs：檢查全過才合；剛 push 等 20 秒）→ POST /api/core/sync/project?key=CRON_SECRET 補投影 → reconcile 差 0 → GD 讀取 vs 新殼讀取逐欄比（不計鍵順序）→ 速度 perf2.mjs（驗 200＋大小）。
4. GD 端：所有寫該前綴的口 owner≠gd 回 409（不分方法）；跨功能寫入改 abgdCmd 轉新殼命令（新殼 /api/core/commands：佔位＋內容雜湊＋收據 core.cmd_receipts 與業務同交易）；舊頁按鈕走權限鎖門器唯讀；?legacy=1 不導新殼。
5. 關卡 3：OpenAI／Gemini 用 scratchpad ai3b.mjs，獨立 Claude 用子代理；要求分 A／B；GD 程式段用 grep -F 找行號貼進題目。
6. 切換：**先查 core.feature_domains 該域有沒有入口對照（種子資料預先登記了很多，沒有新頁面的域要刪掉）** → 可切清單 SWITCH_ALLOW（lib/core/switch.ts）加域 → 安靜時段 → POST /api/core/switch?key=CRON_SECRET {"op":"switch","domain":...} → 切後驗收（GD 寫口 409、新殼寫一筆看 1 分鐘內反推到 GD、對帳）→ 30 分鐘監看（scratchpad monshift.sh 樣板，每個請求要有逾時）。
7. 記錄：ABGD_3AI_LOG、FEATURE_MAP、記憶 abgd-shell.md；私訊張良（GD ?dmsend=MENU_PROBE_KEY）。

## 四、已知坑
- effects.state 只允許 pending／sending／sent／dry／failed／cancelled（寫 processing 會整個失敗）。
- iCloud 副本「* 2」「* 3」會讓型別檢查失敗：`find . -not -path "./node_modules/*" -name "* [0-9]*" -delete`。
- abgd 工作樹用 node_modules 捷徑無法 build（Turbopack）——在主目錄 build。
- 速度量測：登入 15 分鐘過期會量到 401，要先 curl -b cj.txt -c cj.txt 刷新，用 perf2.mjs。
- GD 鎖觸發器已改「先取最長前綴」（0013）。
- 正式環境測拒絕路徑用無害內容；演練只在 drill 域（手冊 E）。

## 五、待張良
- 實測：LINE 問題回報三顆按鈕、GD 首頁「等確認發布」、排行榜評星、新版 SOP 打勾拍照、新版班表排班。
- 回饋切換後第一筆真實給分還沒核對。
- 命名待回：core.memberships、sp_finance_pm_prep_routes、「abgd 集團（暫名）」、sp_finance_pm_sopsum_outbox、sp_finance_pm_pipub_log（已不用）。
- GD repo 改私有。

## 10-14 物料卡學到的（下一個功能照做）
- 速度看 PERF_RULES 原文：API 是「伺服器端」P95 ≤ 0.5 秒（看 server-timing），台灣端到端另一個門檻 ≤ 1 秒，冷啟動另記不算。scratchpad perf3.mjs 兩種一起量。
- 列表只帶畫面真的用到的欄位；明細點開再抓。
- 寫入要防物件原型名稱（constructor、isPrototypeOf…）：鍵驗真實格式＋查詢只認自有屬性；GD 讀反推文件也要防。
- 會建立東西的操作（合併）要「操作編號必帶＋收據綁內容雜湊＋不改資料的成功也留收據」，只看「現在狀態一樣」不算冪等（OpenAI 第二、三輪抓到）。
- 同類 bug 要全庫掃：月份往回推 setUTCMonth 從「今天」推，29～31 號溢位，GD 共 12 處（已全修）。
- 切換當班在正式環境實測：GD 所有寫入 op 409、命令轉發同編號重送、網頁收據各情境，用主檔沒有的測試代碼、結束拆回。

## 待張良（10-15 新增）
- **新殼自動檢查設定（.github/workflows/ci.yml）要改**：main 推送時的機密掃描放在建置之後，會掃到 node_modules／.next 快取 → 每次都誤報 8 筆（repo 檔案本身掃描 0 筆，已在本機用同版 gitleaks 確認）。修法已寫好（掃描移到最前面），但 CC 用的 GitHub 金鑰沒有 workflow 權限、推不上去。要張良把金鑰加 workflow 權限，或照修法在 GitHub 網頁改。

## 10-15 耗損學到的
- 子代理（獨立 Claude）可能整個卡住沒產出：連 2 次就改用 model: sonnet 的子代理，只給「一份含完整程式的送審檔」、不准跑指令。
- 檢查 GD 端所有 kvPut 有沒有看回傳值：切換後資料庫閘門會擋，沒檢查就會「假成功」。新搬的功能開工先 grep 該模組的 kvPut。
- 送 AI 的照片：上傳前就擋總量、壞照片不上傳不問 AI；代發口量實際位元組。

## 10-15 成本總覽學到的（下一個功能照做）
- 大模組可以「GD 算法原檔逐字搬＋只換 kvGet／kvPut 轉接層」，讀取口逐欄比對差 0 就證明算法一致；轉接層要測：新鍵同時建立、拿舊版本寫、同操作讀到兩版、寫後沒重讀再寫。
- 切換驗收閘門（core.settings <域>_smoke_only＝{user}）：切換前上、冒煙全過才拆；閘門要三態（沒有／有效／壞掉），壞掉一律拒寫，任何例外旗標都不能放行。維護口、排程、GET 都要受管。
- 排程判斷寫入者用白名單：影子期狀態是 gd/shadow（不是 gd/gd）——先查兩個庫的 core.domains 實際值再寫。
- 測試期間改測試庫的域狀態要「先記原值、finally 還原、讀回比對」，還原失敗要非零退出。
- 提交前確認 git user 是 goodmask77（暫存區複本沒設會被 Vercel 擋：GitHub couldn't verify an account）。
- iCloud 主資料夾的 git 推送會卡住：文件改動也在暫存區複本做。

## 10-15 食譜學到的（下一個功能照做）
- **上閘門和切換不能用 `&&` 串在有 `| grep` 的指令後面**：管線的結束碼是 grep 的，閘門腳本失敗也會繼續切換（10-15 04:15 就這樣切了、7 秒後才補上閘門，期間 0 筆寫入）。改成：上閘門→讀回確認有值→才切換，分兩個指令做。
- 本機比對結果要用 `LC_ALL=en_US.UTF-8`：算法裡 `localeCompare` 依系統語系排中文，本機 zh-TW 與 Vercel en-US 排法不同，會誤判「順序不同」。
- 草稿類（多人編輯同一份）要有「草稿記號」：編輯／發布／捨棄都要帶開畫面時的記號，對不上 409；畫面在開始編輯時就鎖定記號（跟表單同一份快照）。
- AI 匯入抓網址只收白名單（Google 試算表／文件本體），其他網站請截圖——字串檢查擋不了轉址與 DNS 指內網。
- 步驟媒體、連結類欄位：伺服器端只收私有桶路徑或 http(s)，畫面也只把 http(s) 做成連結（擋 javascript:）。
- 冒煙腳本寫在新規則之前要更新（這次第一跑漏帶草稿記號，留下一份測試草稿，已用正確記號捨棄）。

## 10-15 菜單成本學到的（下一個功能照做）
- 一個域裡有難搬的鍵時，先把好搬的鍵拆成獨立域（migration 附後置條件查核：涵蓋該鍵的域只剩一個、原域其他鍵與狀態不變、入口對應各自一個）。
- 版本記號不能用時間戳或會被刪掉的欄位：用每個項目「只增不減、刪除也加」的版本號（doc.gen[key]），否則刪除後舊畫面能把內容寫回（ABA）。
- 畫面編輯框的初值要從「原設定」讀，不能從計算結果反推（GD 套餐池原本每次從空白開始、一存就清掉；加價從計算結果來，池子空時變 0）。
- 回切演練可以在正式環境、拆閘門前做：回切→新殼被擋、GD 可寫（用沒設定過的品項寫了再清）→其他域不變→再切回→版本號保留＋GD 期間的寫入讀得到→GD 再被擋。scratchpad cost-test/prdrill.mjs 是樣板。

## 10-15 菜單學到的（下一個功能照做）
- **「主 App」和「GD」是兩套**：主 App＝ground-pm.vercel.app 首頁那套（src/，張良 10-15 確認不要了、不搬）；GD＝/prep（public/ops/）。兩邊共用同一個資料庫，所以主 App 要「關掉寫入」而不是搬；講話不要把主 App 當成要保留的東西。
- 一個鍵的「修改入口在哪個頁面」決定它跟哪個功能一起搬：POS 隱藏／改名／牌價的入口在銷售數據頁，先搬會讓 GD 那頁壞掉。
- 版本記號優先用**引擎修訂號 rev**（GD 影子期投影、回切再切都會推進），不要自己在文件裡加計數器（GD 寫入不會幫你加）。
- 非草稿操作（換圖）不能把新版本號交給拿著舊草稿的畫面：只有「送來的版本號＝讀到的 rev」才回新號，否則回 stale。
- 兩份文件要一起變（版本存檔→菜單頂端圖）：用「發布序號只增不減＋補同步只套更新的」，失敗下次自動補，不叫人重按；建立類操作帶操作編號 rid。
- 冒煙比對用逐欄比（jsonb 會重排欄位順序，字串比會誤判）。
- 送審附 diff 要附完整 hunk（含檔名），只 grep 改動行會讓審查者看錯檔。

## 10-15 盤點學到的（下一個功能照做）
- 對帳時「權限類欄位」（審核人、可編輯）要用同一個真人身分比，測試替身身分比出來的不一樣不算數。
- 會改到多筆資料的操作（分類改名／刪除）要連帶推進每筆的版本記號，否則舊表單能把舊值寫回。
- 排程類（每日提醒）：計算放進交易裡、通知分通道各一筆 effects、標記跟入列同交易；排程跑多次（時窗內）＋同日只排一次，不要只跑一次。
- GD 舊排程的「標記」寫法：先條件認領再發，失敗收回；寫入 pm_documents 的條件寫入用 updated_at（GD kvPut 每次都更新它）。
- 回切演練不能發真訊息時：測試庫用真 worker＋真佇列＋代發口替身（cost-test/fxstub.ts、invfxdrill.mjs），停在 sending 再回切；GD 端把要驗的段落拆成依賴注入的小模組（_invlow.js）用替身跑。
- Next 16 預先產生頁面時，元件初始 state 不能呼叫 Date.now()／Math.random()（CI 建置會失敗）；改在事件裡產生。
- Mac 睡眠會讓背景 sleep 暫停：監看腳本用 `caffeinate -i` 包起來。

## 10-15 物料庫學到的
- 外部同步來的大資料（阿桑 boss_*）跟人改的小設定（分類）放同一個前綴時，只拆人改的那份先搬；外部資料留到它的同步排程一起搬。
- GD 算法要搬時先在 GD 裡原樣抽成獨立檔（_matlib.js），用「本機跑新檔讀 GD 正式庫 vs 線上舊程式」證明抽檔沒改到行為，再逐字複製到新殼。
- 讀阿桑月檔這類「列順序影響結果」的算法，GD 讀取一律包 orderedKvGet（jsonb 鍵順序），否則跟新殼讀鏡像對不上。
- 跨域讀者（成本模組讀分類）要在閘門期間實測：改值→反推追平→兩邊比→改回→再比；回切演練也要跑一次成本比對。
- Gemini 連續連線失敗時，獨立 Claude＋OpenAI 都通過即可放行，失敗要記在紀錄。

## 10-15 銷售設定學到的
- 沒有新殼畫面的域也能切：修改入口留在 GD，切後 GD 驗權限再經命令橋寫；GD 頁面讀反推鏡像會慢幾秒 → 命令成功後立刻觸發反推（被佔就重試），GD 頁面晚 3／10 秒重讀。
- 命令橋的閘門擋下要「丟例外」＝暫時錯誤，不能存成永久收據（否則同一命令編號永遠失敗）。
- 外部輸入的數字要明確：Number(null)／Number('')＝0，0 在牌價代表「不顯示價格」→ 只收數字或數字字串。
- 證明切換沒有在途舊交易：控制器紀錄（凍結時間）＋GD 連線 statement_timeout＋pm_outbox（同交易寫入紀錄）＋pg_stat_activity＋pg_prepared_xacts；之後做成控制器硬檢查。
- **10-15 起切換控制器第 3 步有在途交易硬檢查**（GD 0014 pm_inflight_before）：之後切換的紀錄第 3 步會寫「GD 凍結前開始的交易 0、預備交易 0」，送審時直接附這行即可，不用再人工查 pg_stat_activity／pm_outbox。


## 10-16 團隊任務＋收件匣學到的（下一個功能照做）
- **B 模式通用讀寫 api/_abgdkv.js**：GD 端還在跑的功能（DD、排程、舊頁）讀寫已搬走的域，一律 `abgdKv({domain, lockKey})`；撞版本只看 `e.code === 'stale'` 重試。下一個對外功能（會員、團訂）直接沿用。
- **切換大域（上千鍵）**：控制器已改同時 10 鍵＋跳過「鏡像版本＋雜湊＋投影版本都已是最新」的鍵，仍全部做落後檢查＋雙向比對。切換前若 reproject_required＝先跑 op=reproject。演練寫入會讓「等同步排空」多花約 1 分鐘，預算仍夠。
- **健康口要認得引擎已刪的文件**（任務域第一次切換被看門狗誤判退回）。
- **有外部副作用的寫入（LINE 送出、通知）**：先寫標記再呼叫外部、結果分三態（成功／失敗／不明），不明不自動重送、轉人工核對；通知工作用固定編號＋版本比對轉狀態。收件匣十二輪大多在修這些。
- **速度**：跨區（新殼 hnd1 ↔ GD 孟買）的動作不要放在讀取路徑；圖片改「載入時才簽」後讀對話 P95 0.8→0.2 秒。
- **驗收腳本**：鍵名格式先查程式（收件匣是 pm_inbox_c_<帳號>_<客人>，不是冒號）；本機沒有的正式金鑰（CC_AGENT_KEY）不要拿，改由測試庫涵蓋。
