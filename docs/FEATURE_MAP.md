# FEATURE_MAP：GD → abgd 功能對照表（搬遷鐵則第三節；唯一進度表）v4

> 開工 2026-10-14（Fable 5.1）。依 docs/ABGD_MIGRATION_ORDER.md 第 1 步盤點。
> 規則：改任何功能前先查這張表；搬完、切入口當天就更新。狀態：`待搬` → `搬遷中` → `並行比對` → `已切入口` → `只改新殼`；`不搬` 要寫原因。
> 「GD 位置」＝construction-pm；「新殼位置」＝abgd（Next.js）。資料鍵都在 GD 大表 `pm_documents`（id, data.v=JSON 字串, editor, updated_at），3,025 筆／18 MB／573 個鍵家族（2026-10-14 實查）。

## 0. 規模（實查，不是估）

| 項目 | 數字 |
|---|---|
| 側欄分頁按鈕 | 30（26 個功能頁＋首頁／設定／問題回報＋物料庫） |
| 前端檔 | public/ops 36 個 js＋index.html＋menu-poster／menu-tv，共 2.1 MB；另 liff／member／order／menu-ground 四個獨立頁 |
| 後端檔 | api/ 61 個檔、21,487 行；mail-sync.js 6,467 行、480 個查詢口；line-webhook.js（DD）3,108 行 |
| 排程 | vercel.json 18 條 cron |
| 資料 | pm_documents 3,025 筆／18 MB／573 鍵家族；真表 members 2、member_identities 2、member_slots 500、profiles 10、auth.users 10；舊工程表 projects 1／tasks 1 |
| 檔案 | Storage：photos（公開）516 檔 384 MB、ground-private 27 檔 7 MB、bo-archive 0 |
| 身分 | 名冊 32 人、GD 綁定 token 14、權限名單 12 人（mode=approve） |
| 外部串接 | 喬亞 POS、Eats365、inline、NUEiP、阿桑 boss-api、小夏 EM API、LINE 官方帳號 ×4（DD／GROUN:D／A Beach／104招募）＋LIFF ×2、Meta FB/IG、Gmail IMAP、Pinterest、綠界、LINE Pay、Google 試算表、Open-Meteo、農業部行情、Web Push |

## 1. 功能表（側欄每一頁）

| # | 功能（側欄名） | GD 前端 | GD 後端口（mail-sync 除非另註） | 資料鍵家族 | 外部 | 其他寫入者（DD／排程／舊主 App） | 風險 | 新殼位置（路徑／schema.table） | 狀態 |
|---|---|---|---|---|---|---|---|---|---|
| F01 | 首頁（今日／九大卡／回報待發布／退單紀錄） | index.html＋p09／p01 | opsboard、prepact、custoutlook、voids | pm_pos_*、pm_inline_outlook、pm_pos_void_、pm_sop_issues | — | joya-intraday（退單） | 中（聚合多功能，最後真切） | app/(shell)/page.tsx；讀 ops.* view | 待搬 |
| F02 | SOP（每日 SOP、站別、階段、建議、評分、問題回報） | p02-sop、p03-sopedit | sop／sopdone／sopset／sopst／sopsug／sopsugset／soprate／sopissue／sopresolve／sopreport／sophist／sopfull／sopsign／sopseed | pm_sop_def、pm_sop_g_(日檔)、pm_sop_issues、pm_sop_sugs、pm_sop_outbox | 照片→Storage photos/sop | DD（sop_issues）、joya-intraday（超時推播）、sop-summary | **高（食安）** | app/ops/sop；ops.sop_stations／sop_items／sop_done／sop_issues／sop_suggestions | ✅ **已切新殼（10-14 20:45，epoch 1）**；關卡 3 共 9 輪通過；API P95 0.25 秒／頁面 0.28 秒；刻意差異與已知風險見 5.2；GD SOP 改只在新殼 |
| F03 | 任務（任務中心卡片、積分特效、提醒） | tasks.js、tier-effects.js | kvproxy、tasknotify、tngroups、taskadmin、taskfill、taskmove；api/task-remind.js | sp_team_pm_task_*、sp_team_pm_task_mq、sp_team_pm_ptscfg、pm_task_* | LINE 群通知 | DD 10 個動作、inline-sync／cron-daily／task-remind 建任務、主 App TaskCenter iframe（kvproxy） | **高（寫入者最多）** | app/ops/tasks；ops.tasks／task_events | 待搬 |
| F04 | 排行榜（積分榜、兌換商城、存摺） | p03-sopedit（lb 段） | lb、pointscfg、redeem、redeemlog、rewardset；api/_points.js | pm_points、pm_points_cfg、pm_rewards、pm_redeem | — | 積分 7 動作（打卡／回饋／SOP／簽收／回報／日誌／盤點） | **高（點數）** | app/ops/points；ops.points_ledger／points_rules／rewards／redemptions | 待搬（最後一波） |
| F05 | 盤點 | p04-inv-meet | inv、invcount、invset | pm_inv（物料庫脊椎） | — | joya-intraday（低水位 notified） | 中 | app/ops/inventory；ops.materials／stock_counts | 待搬 |
| F06 | 包材 | p04-inv-meet | inv（kind=pack） | pm_inv | — | — | 低 | 同 F05 | 待搬 |
| F07 | 採購 | p04-inv-meet | buy、buyadd、buyop | pm_buy | — | — | **高（明天沒食材）** | app/ops/purchase；ops.purchase_orders | 待搬 |
| F08 | 物料庫（boss 叫貨進價波動／叫貨單） | p16-matlib | matlib、matcat、matord、matseed | pm_boss_ord_／ordi_／gord_／gordi_／matcat／prod／sup | 阿桑 boss-api | boss-sync 每小時 | **高（阿桑 API）** | app/ops/matlib；ops.boss_orders／boss_order_items／supplier_cats | 待搬 |
| F09 | 耗損 | p18-waste | waste、wasteimg；api/_waste.js | pm_waste_(月檔)、pm_waste_cfg | AI 讀秤 | — | 中 | app/ops/waste；ops.waste_logs | 待搬 |
| F10 | 食譜（食譜庫＋AI 匯入） | p20-recipe、p20b-rcpimport | recipes、rcpimg；api/_recipe.js、_rcpimport.js | pm_recipebook、pm_recipecost_snap | AI | — | 中 | app/ops/recipes；ops.recipes／recipe_items | 待搬 |
| F11 | 物料卡 | p19-matcard | matcard、mcard、mcphoto；api/_matcard.js | pm_matcard（獨立 matcard 域）、讀 boss／recipe／menu | — | — | 中 | app/ops/matcard；通用 gd_docs 引擎（ops.matcard_view／matcard_ver） | **影子**（10-14：讀取對帳卡 1172／供應品 1172 全欄位相同，同日多單 3 處差異已由 GD v4.71.61 同步算法消除，見 5.3；P95 0.37～0.43 秒；GD v4.71.60 閘門＋合併轉發已上線；關卡 3 審查中） |
| F12 | 菜單成本（定價） | p22-pricing | pricing、priceset；api/_menu.js | pm_pricing、pm_pos_prices、pm_pos_costs、pm_menu | — | — | 中 | app/ops/pricing；ops.menu_items／menu_prices | 待搬 |
| F13 | 成本總覽（含廠商月帳、菜商比價、員餐分析、偵錯待辦） | p21-costdash、p21b-vegcmp、p17-costtodo | costdash、costsnap、costtodo、vendor、vegcmp、vegimport；api/_costdash.js、_cost.js、_vegquote.js | pm_cost_snap_*、pm_cost_todo、pm_cost_cfg、pm_veg_quotes、pm_veg_market、pm_vendor_recon_ | 農業部行情、Google 試算表 | mail-sync 排程（菜商報價／試算表） | **高（月帳對帳）** | app/ops/cost；ops.cost_snapshots／veg_quotes／veg_market | 待搬 |
| F14 | 會議（宣達簽收） | p04-inv-meet | meet、meetset、meetping | pm_meet | LINE 提醒 | joya-intraday（宣達追提醒） | 低 | app/ops/meetings；ops.meetings／meeting_acks | ✅ **已切入口 2026-10-14 晚**（epoch 5；關卡 3 四輪；通知走 GD 代發口 api/abgd-fx.js；追提醒改新殼排程）→ 只改新殼 |
| F15 | 班表（整月網格＋AB 班表＋訂位網格＋人力時數配置） | p05-shift、p06-shift2、p07-labor | shift、shiftset、shiftcolor、shiftfill、shiftoff、shiftdedup、labor、laborset | pm_shift_g、sp_crew_pm_hr_sched_、pm_labor | NUEiP | hr 排程（NUEiP） | **高（人力／薪資連動）** | app/ops/shifts；ops.shifts／shift_plans／labor_plans | ✅ **第 A 段（班表主檔）已切新殼（10-14 21:50，epoch 1）**；關卡 3 三輪；NUEiP 班表（crew 域，等 hr.js 拆段）、人力時數配置＋AB 模組（shiftplan 域，labor 要先拆主 App 寫入）、法規薪資違規（payroll）還在 GD，新殼班表頁有「到舊版處理」（?legacy=1） |
| F16 | 異常通知（boss 異常＋AB 停售） | p10-perm-init（inc 段） | absinc、abmod、abmodset | pm_boss_inc_、pm_absoldout、pm_abmod | 阿桑 boss-api | boss-sync | 中 | app/ops/alerts；ops.incidents | 待搬 |
| F17 | 回饋（指派制互評） | p08-menu-misc（fb 段） | fb、fbset、fbassign、fbdims、fbj | pm_fb、pm_fb_assign、pm_fb_dims、pm_fbj | — | — | 低 | app/ops/feedback；ops.gd_docs／gd_items（通用清單引擎） | ✅ **已切新殼（10-14 17:30，epoch 38）**；關卡 3 共 14 輪通過；API P95 0.36 秒／頁面 0.39～0.44 秒；GD 回饋改只在新殼 |
| F18 | 菜單（菜單建檔、圖匯出 v15、電視圖、AI 圖、存版本） | p08-menu-misc、menu-ai.js、menu-poster.html、menu-tv.html | menu、menuset、menuimgset、menuocr、menuai、menuaisave、menuassets、menuassetset、menuen、menumv、menunote、menuprobe | pm_menu、pm_menu_assets | AI 生圖、字型檔 | — | 中 | app/ops/menu；ops.menus／menu_assets；出圖頁 app/ops/menu/poster、/tv | 待搬 |
| F19 | 行銷大師（FB/IG 成效、AI 文案、素材庫、靈感庫、Pinterest、LINE OA 成長） | p14-social | api/social.js、social-oauth.js、social-collect.js、social-publish.js、_pinterest.js、lineoa-sync.js | pm_social_*、pm_pinterest、pm_lineoa_*、pm_lineoa_sum | Meta、Pinterest、LINE Insight | social-collect／publish、lineoa-sync、pinterest-sync | **高（公開發文／授權）** | app/ops/marketing；ops.social_accounts／posts／metrics／assets／slogans／lineoa_daily | 待搬 |
| F20 | inline（顧客資料庫：洞察首頁、顧客資料、近期展望） | p09（cust 段） | custfind、custact、custnr、custholcopy、custoutlook；api/inline-sync.js、_inline.js | pm_inline、pm_inline_(月檔 142k 筆)、pm_inline_cs_*、pm_inline_ph3_*、pm_inline_nr_、insights、notes、outlook、alerts | inline、Open-Meteo | inline-sync 每小時（含建任務） | 中（個資） | app/ops/customers；ops.reservations／customers／customer_notes | 待搬 |
| F21 | 文件庫 | p15-library | libget、libfold、libup、liburl、libfile | pm_library | Storage ground-private | DD（存到文件庫） | 中（機密檔） | app/ops/library；ops.library_folders／files | ✅ **已切入口 2026-10-14 15:20**（epoch 4；關卡 3 六輪；對帳差 0）→ 只改新殼 |
| F22 | 聊天室 | p23-chat | chat；api/_chat.js | pm_chat_rooms、pm_chatm_*、pm_chat_read_* | @DD | — | 中 | app/ops/chat；ops.chat_rooms／chat_messages／chat_reads | 待搬 |
| F23 | 收件匣（四官方帳號客服、分類、提醒、問 AI、讀檔、匯入舊紀錄） | p24-inbox | inbox、inboxcc、inboxperf、inboxremindtest；api/_inbox.js、inbox-webhook.js | pm_inbox_c_*、pm_inbox_m_*、pm_inbox_cfg、pm_inbox_acct_* | LINE ×4 webhook、AI | inbox-webhook／line-webhook relay、DD | **高（對外客服）** | app/ops/inbox；ops.inbox_conversations／inbox_messages／inbox_settings | 待搬 |
| F24 | 團體訂餐（建單、客人點餐頁、核價出圖、LINE Pay、綠界、發票） | p25-grporder、grporder-calc.js、public/order.html | grporder、gorder、ecpay*、pay*；api/_grporder.js、_linepay.js、_ecpay.js | pm_grpord_*、pm_grpord_cfg、pm_grpord_idx | LINE Pay、綠界、LIFF | 客人頁 order.html、LINE Pay／綠界回呼 | **高（金流）** | app/ops/group-orders；ops.group_orders／group_order_lines／payments／invoices；客人頁 app/order/[code] | 待搬（金流最後） |
| F25 | 會員（會員卡、入點、兌換、轉盤、任務、推薦、問卷、等級、生日禮） | p26-member、public/member.html | member；api/_member.js、_ddmember.js | 真表 members／member_*（10 張） | LIFF | 客人頁 member.html、DD 代查 | **高（點數）** | app/ops/members；ops.members／member_*（照原表搬） | 待搬（最後一波） |
| F26 | 夥伴名冊（人資、出勤、文件、身分證鎖） | p12-roster | hrmaster、hrmasterup、hrmasterset、hrdocup、hrdocdel、hrdocurl、hridlock、hrmpendset、gdrole、gdstaff；api/hr.js | sp_crew_kb_roster、sp_crew_pm_hr_master、hr_att_、hr_staff、hr_notif、pm_hrdoc_pending | NUEiP | DD（名冊／hr_master／hrdoc_pending）、hr 排程、入職 onboard.js | **高（個資）** | app/ops/crew；ops.crew／crew_docs／attendance | 待搬 |
| F27 | 入職（LINE 自助入職、契約、審核） | p13-onboard | onboard*；api/onboard.js、_onboard.js | pm_onboard（名冊 pending） | LINE、Storage 私桶 | — | **高（個資）** | app/ops/onboarding | 待搬 |
| F28 | 信箱（多信箱 IMAP、規則、每日自動） | p25-mailhub | mailhub、mailhubrun；api/_mailhub.js | pm_mailhub、pm_mailhub_scan_ | Gmail IMAP（密碼 AES） | — | **高（信箱機密）** | app/ops/mailhub；ops.mailboxes／mail_rules | 待搬 |
| F29 | 銷售數據（GD 喬亞／AB Eats365：KPI、每日、時段熱力圖、品項、付款別、Uber、預做節奏、預測） | p01-core、p10、p11 部分 | opsboard、ingest、delday、eatsday、fixpay、dinefill、slotex、poshide、heathide、aliasget／set、fc*、revprobe；api/joya-intraday.js、_joya.js、_eats.js、eats-rhythm.js、_fc.js、_voids.js | pm_pos、pm_pos_d_、pos_tx_、pos_hh_、pos_q_、pos_q_ab_、ab_hh_、ab_hhrev_、pos_void_、pos_alias、pos_hidden、pos_prices、pos_costs、pos_flags、pos_slotex、pos_idlecfg、pm_fc_、fc_cfg、ablive、pm_ichef(退役) | 喬亞、Eats365 | joya-intraday 每 15 分、mail-sync（Eats365 日結信）、boss-sync（AB） | **高（營收修正）** | app/ops/sales；ops.pos_days／pos_hours／pos_items／pos_tx／pos_voids／forecasts | 待搬 |
| F30 | 法規與薪資（勞基、違規、分潤頁、打卡補登） | p11-law-pay | payset、viomgrs、vionotify、vioresset、abatt、punch*；api/punch.js | pm_payrates、pm_vio_res、pm_vionotif、pm_punch_makeup、sp_crew_pm_hr_pay | — | — | **高（薪資）** | app/finance/payroll（財務區）；finance.pay_rates／violations／punches | 待搬（最後一波） |
| F31 | 設定（分頁名稱排序、權限矩陣、DD 自動訊息、DD 群、AI 路由、通知、安靜時段、AB 帳） | p09、p10 | tabcfg、tabset、prepperm、preppermset、prepapply、ddmsg、ddmsgset、ddgrpset、aicfg、aicfgset、aimodels、aitest、aiab、notifycfg、notifyset、webpushcfg、abmod | pm_prep_tabs、pm_prep_perm、pm_ddmsg、pm_ddgrp、pm_ai_cfg、pm_notify、pm_ai_usage_、pm_push_subs | — | DD（prep_perm／prep_bind／logincode） | **高（權限）** | app/(shell)/settings；core.settings／core.permissions | 待搬（地基一起） |
| F32 | 通知中心（鈴鐺、歷史、Web Push、App 角標） | p09 | ntf、ntfread、ntfseen、ntfpin、ntfping、pushsub；api/_webpush.js | pm_prep_ntf、pm_push_subs | Web Push | 全站 wpPush、_qpatch | 中（跨網域重訂閱） | app/(shell)/notifications；core.notifications | 待搬（地基一起） |
| F33 | 問題回報（審核發布） | p10 | errs、errlog、issuecat | pm_issues、pm_errlog | — | — | 低 | app/ops/issues | ✅ 隨 SOP 一起切（sop_issues 在 SOP 資料域；GD 首頁發布、LINE 審核、排行榜評星改轉新殼命令） |
| F34 | 登入／身分（4 位數登入碼、個人連結 ?me=、LIFF 認人、模擬檢視 &as=、個人化 manifest） | p01、liff/index.html | bind、bindcode、bindcard、liffauth、whoami、manifest | pm_prep_bind、pm_prep_logincode、名冊 lineUserId | LINE Login／LIFF | DD 發登入碼、LIFF | **高（地基）** | proxy.ts＋app/api/core/auth；core.users／core.sessions／core.line_identities | ✅ 第 0 波已上線 2026-10-14（Supabase 原生 session＋GD 橋接票 e2e 驗過；LINE Login 下一步） |
| F35 | 工作日誌／打卡站／積分 7 動作 | p04／p10／tasks | punchme、punchstat、punchadmin；日誌走 DD | pm_worklog、sp_crew_pch、pm_points | DD | — | **高（點數／打卡）** | 併入 F26／F04 | 待搬 |
| F36 | 零用金、財務 ledger、對帳中心（舊主 App 遺留，DD 動作仍寫） | （主 App） | ledger、sheet-sync.js | pm_petty、pm_fin_*、pm_bank、pm_ctbc、pm_sheet | Google 試算表 | DD（add_finance_tx／add_petty_spend）、sheet-sync、舊主 App 直寫 pm_petty | **高（錢）** | app/finance（Belle 財務到了一起規劃） | 待搬（最後一波） |
| F37 | 舊主 App（src/App.jsx 工程專案管理） | src/ | api/ai.js、admin-users.js | pm_data、pm_tasks、projects／tasks 真表 | — | 瀏覽器寫 pm_bot_context、打卡站前端、零用金／日誌直寫 | **高** | 拆三段：①工程專案資料＝不搬，新殼 app/(shell)/archive 唯讀查閱；②**pm_bot_context 改由伺服器端產生**（abgd 投影層算好寫回 GD，第 0 波）；③打卡站（iPad QR）、零用金、日誌→排進 F35／F36 的波次 | 待搬（①不搬） |

| F38 | 檔案搬家（過渡期雙向存取：GD 新上傳仍進舊桶，abgd 正向同步看到新檔路徑就背景抄到新桶；abgd 讀不到就回舊桶取並快取；敏感檔（簽名／證件）先分類、立即移私桶撤公開）（三套檔案庫：文件庫／入職 hrmLib／DD pm_photos＋pm_photo_folders；桶 photos 公開 516 檔、ground-private 27 檔） | — | 上傳走 storage/v1/object/upload/sign/photos | pm_library、pm_photos、pm_photo_folders、hrdoc | Storage | 全站上傳口 | **高（簽名／證件在公開桶）** | 新殼一律私桶＋簽名網址；舊公開檔過渡期保留，引用驗證後才撤 | 🟡 本機備份完成（543 檔 391 MB＋sha256）；搬新桶與中繼待做 |
| F39 | 短網址 /v/:code | vercel.json rewrite | vgo | pm_shortlinks | 已發出去的 LINE 訊息 | — | 中 | 舊網域永久保留轉址到新殼 | 第 7 波 |
| F40 | 反向 partner-api（給阿桑 12 端點：hr/schedule、hr/staff、orders、orders/prices、ping、reservations、reservations/summary、revenue/daily、revenue/items、sop/daily、sop/defs、sop/issues） | api/partner-api.js | /partner/v1/* | 讀 GD 大表 | 阿桑系統 | — | **高（阿桑拿到停更資料）** | 過渡期靠反向同步保證 GD 大表是最新；新殼開同款 app/api/ops/partner；阿桑進 abgd 後退役 | 隨資料域 |
| F41 | 公開靜態頁：public/salary（A Beach 360 分潤制度）、public/menu-ground.html（客人菜單 3.6 MB）、public/sw.js（Service Worker，scope 蓋 /prep） | public/ | — | — | — | — | 中（舊 SW 殘留） | salary／menu-ground 照搬 app/(public)；SW 換網域要重做＋舊訂閱失效 | 第 5 波 |
| F42 | 排程拆單一職責（GD 端重構，純搬段落不改行為）：joya-intraday 拆 pos／sop／inv／meet 四段可開關；cron-daily 拆速報／任務提醒／生日；**hr.js 拆 班表（F15）／出勤名冊（F26）／薪資（F30）三段** | api/joya-intraday.js、cron-daily.js | — | — | — | — | 中 | 每段隨功能波次切；第 7 波只剩 DD | 第 0 波 |

## 2. DD（LINE 機器人 api/line-webhook.js 3,108 行）

| 項目 | 內容 | 新殼位置 | 狀態 |
|---|---|---|---|
| **寫入＋代查 adapter（第 0 波）** | line-webhook.js 動作層每個動作先查資料域 owner（讀 GD 表 pm_domain_lock，不經 CDN）：owner＝abgd 的改打新殼命令 API（帶冪等鍵），其餘寫舊表；**代查同樣路由**：owner＝abgd 的改讀新殼唯讀 API。pm_bot_context（衍生快照，不是正本）第 0 波改由 **GD 端 cron** 產生取代舊主 App 瀏覽器，第 7 波才移交新殼 | api/line-webhook.js（GD 端小改） | 第 0 波 |
| 代查 9 種 | query_boss／fin／grporder／hr／member／orders／pos_day／resv／section | app/api/ops/dd（同一支 webhook 改接新表 view） | 待搬（關卡 4 最後切） |
| 動作 16 種 | add_task／update_task／delete_task／add_category／delete_category／set_category_status／add_item／set_item／set_item_status／delete_item／add_log／add_todo／add_conclusion／add_finance_tx／add_payment／add_petty_spend | 同上；錢的動作最後 | 待搬 |
| 資料快照 pm_bot_context（唯一真相）、記憶、去重、健康頁、互動卡片、翻譯、摘要、自動訊息、群設定、額度尾巴 | _ddcards／_ddhealth／_ddcoverage／_ddmsg／_qpatch／push.js／line-quota.js | 同上 | 待搬 |

## 3. 排程（vercel.json 18 條）

| 路徑 | 時間（UTC） | 做什麼 | 屬於哪個功能／哪波切 | 新殼位置 | 狀態 |
|---|---|---|---|---|---|
| /api/em-sync | 每小時 :40 | 小夏 EM 包場同步 | EM（小夏進來時） | app/api/em/sync（em 區） | 待搬 |
| /api/task-remind | 每小時整點 | 任務定期提醒 | F03／DD 改接那波 | app/api/ops/cron/task-remind | 待搬 |
| /api/cron-daily | 00:00／09:30／13:00(週日~四) | 每日速報、任務提醒、生日、SOP 超時… | 拆：速報（DD 第 7）、任務提醒（F03）、生日（F25）（SOP 超時不在這支，在 joya-intraday） | app/api/ops/cron/daily | 待搬 |
| /api/mail-sync | 13:30／14:30／15:30 | 收 Eats365 日結信、菜商報價、Belle 試算表 | F29（Eats365 日結）、F13（菜商／試算表）第 2 波 | app/api/ops/cron/mail | 待搬 |
| /api/joya-intraday | 每 15 分 03~13 時 | 喬亞盤中快照、退單偵測、SOP 超時 | 拆四段：pos（F29 第 2）、sop（F02 第 1）、inv（F05 第 2）、meet（F14 第 1） | app/api/ops/cron/joya | 待搬 |
| /api/sop-summary | 12:05 | SOP 每日收班彙整 | F02 第 1 波 | app/api/ops/cron/sop-summary | 待搬 |
| /api/boss-sync | 每小時 :07 | 阿桑 boss-api 入庫 | F08／F16／F29（AB）第 2 波 | app/api/ops/cron/boss | 待搬 |
| /api/eats-rhythm | 13:50 | AB 預做節奏表 | F29 第 2 波 | app/api/ops/cron/eats-rhythm | 待搬 |
| /api/inline-sync | 每小時 :25 | inline 訂位滾動窗同步 | F20 第 3 波（建任務段→F03） | app/api/ops/cron/inline | 待搬 |
| /api/line-webhook?warm=1 | 每 5 分 | DD 暖機 | DD 第 7 波 | 關卡 4 | 待搬 |
| /api/hr | 14:40；每 20 分 01~13 時 | NUEiP 出勤／班表 | F15／F26 第 1 波（班表段） | app/api/ops/cron/hr | 待搬 |
| /api/social-collect | 每 3 小時 | FB/IG 成效 | F19 第 3 波 | app/api/ops/cron/social-collect | 待搬 |
| /api/social-publish | 每 15 分 | 定時發文 | F19 第 3 波（影子期 dry-run） | app/api/ops/cron/social-publish | 待搬 |
| /api/lineoa-sync | 每小時 :50 | LINE OA 成長數據 | F19 第 3 波 | app/api/ops/cron/lineoa | 待搬 |
| /api/pinterest-sync | 每小時 :35 | Pinterest 圖版 | F19 第 3 波 | app/api/ops/cron/pinterest | 待搬 |

（mail-manage.js 已全域暫停，不搬。）

## 4. 外部串接（關卡 4 最後統一切）

| 串接 | 用在 | 金鑰（Vercel env 名） | 切換動作 |
|---|---|---|---|
| LINE 官方帳號 DD（Messaging＋webhook） | DD、推播、收件匣 relay | LINE_CHANNEL_ACCESS_TOKEN／SECRET、LINE_OA_DD_* | LINE Developers 改 webhook URL → 新殼；30 分出錯自動改回 |
| LINE 官方帳號 GROUN:D／A Beach／104招募 | 收件匣 | LINE_OA_GD／AB／HR_* | 同上（同一支 inbox-webhook） |
| LIFF ×2（GROUN:D LIFE 客人、DD LIFE 員工） | 認人中繼、會員卡、團訂 | LIFF_ID、LIFF_STAFF_ID | LIFF endpoint 改新殼 /liff |
| LINE Pay、綠界 | 團體訂餐金流／發票 | LINEPAY_*、ECPAY_*（尚未填正式） | 回傳網址改新殼；測試商家先驗 |
| 喬亞 POS（mobile-report.wixtar.com） | GD 營收 | JOYA_* | 排程搬過去即切 |
| Eats365 商家後台 | AB 營收／即時 | EATS_*（裝置 cookie 30 天） | 同上 |
| inline（host.inline.app） | 訂位 | INLINE_EMAIL／PASS | 同上 |
| NUEiP | 出勤／班表 | NUEIP_* | 同上 |
| 阿桑 boss-api／反向 partner-api | 叫貨、AB 營運 | BOSS_API_*、PARTNER_API_KEY | 阿桑那邊改網址（他的系統之後也進 abgd） |
| 小夏 EM API | 包場 | EM_API_KEY | 同上 |
| Meta FB/IG | 行銷大師 | META_APP_ID／SECRET、SOCIAL_SCOPES | OAuth 回呼網址改新殼、重新授權 |
| Gmail IMAP | 信箱中樞、日結信 | MAIL_USER／PASS、MAIL_ENC_KEY | 排程搬過去即切 |
| Web Push | 通知 | WEBPUSH_PUB／PRIV | 訂閱要重新訂（金鑰沿用） |
| AI 三家 | 全站 | ANTHROPIC／OPENAI／GEMINI_API_KEY | 搬 _ai.js 即切 |
| Google 試算表、Open-Meteo、農業部 | 對帳、天氣、行情 | 無金鑰 | 排程搬過去即切 |

### 4.1 環境變數（api/ 實查 64 個，每個要在 abgd 設定；標 ★＝切換時只能一邊跑）
ANTHROPIC_API_KEY、OPENAI_API_KEY、GEMINI_API_KEY｜SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、VITE_SUPABASE_URL、VITE_SUPABASE_ANON_KEY｜LINE_CHANNEL_ACCESS_TOKEN、LINE_CHANNEL_SECRET、LINE_OA_DD／GD／AB／HR_SECRET／TOKEN、LINE_PUSH_KEY、LINE_LOGIN_CHANNEL_ID、LINE_BOSS_USER、LINE_DEFAULT_GROUP、LINE_SIG_STRICT、LIFF_ID、LIFF_STAFF_ID、LIFF_MEMBER_ID、LIFF_ORDER_ID｜JOYA_COMPANY／USER／PASS、EATS_USER／PASS、★EATS_DEVICE_COOKIE（30 天滾動，兩邊同時續期會互踢）、INLINE_EMAIL／PASS、NUEIP_COMPANY／USER／PASS／FUNCPASS、BOSS_API_BASE_URL／KEY、PARTNER_API_KEY、EM_API_KEY｜META_APP_ID／SECRET、META_GRAPH_VERSION、SOCIAL_SCOPES、SOCIAL_REDIRECT、SOCIAL_DRY_RUN｜MAIL_USER／PASS、MAIL_USER2／PASS2、MAIL_ENC_KEY、FIN_SHEET_ID／TAB｜WEBPUSH_PUB／PRIV｜MENU_PROBE_KEY、OPS_BOARD_KEY、CC_AGENT_KEY、BOT_OP_CODE、BOT_VAULT_KEY、CRON_SECRET、DD_LEAN｜LINEPAY_*、ECPAY_*／ECPAY_INV_*（正式未填）。

### 4.1.1 地基硬規則（關卡 1 第二輪）
- 所有 Vercel→Supabase 連線走 Supavisor 6543 transaction 池；RLS 身分用交易內 set_config 注入；禁止未池化直連。
- 入口切換設定（GD tabcfg routes）一律 `Cache-Control: no-store`，不經 CDN、不被 Service Worker 攔。
- 初始匯入走「一致快照→批次匯入」，增量才用 outbox 領取（每批 200）。
- 域所有權正本：docs/ABGD_DOMAINS.md；寫入者機器清單：docs/ABGD_WRITERS.gen.md。

### 4.2 必須張良親手（不能自動化）
Meta OAuth 重新授權、綠界特約商店申請、LINE Pay 回呼白名單、GD repo 改私有、身分對照表有重名／缺 LINE id 時裁決、對外名字。

## 5. 搬遷順序 v2（關卡 1 兩家意見後修正；低風險先、錢和點數最後轉正；每波過關卡 3）

| 波 | 內容 | 為什麼 |
|---|---|---|
| 0 地基 | **GD 端先做**：大表加 rev＋outbox＋tombstone trigger、排程拆單一職責 F42、DD 寫入 adapter、pm_bot_context 改伺服器端產生；**abgd 端**：登入 F34（GD 橋接票＋LINE＋登入碼）、公司／店／角色／開通清單、側欄框架、設定 F31（只做新殼權限＋唯讀設定）、通知中心 F32（只顯示）、**主檔唯讀影子**（名冊 F26 身分欄、物料／供應商／商品）、**同步橋**（GD outbox→abgd）、**入口切換狀態機＋writer owner**、**DD 命令路由**（owner＝abgd 的動作改打新殼）、Storage 搬遷、每小時備份、對帳腳本框架 | 兩家共識：RLS 靠人、主檔 ID 先定才不返工、寫入權按資料域不按頁 |
| 0.5 演練 | 用文件庫 F21（最孤立）做一次完整「切入口→注入錯誤→自動切回→對帳差 0」演練，過了才開第 1 波 | 三家都要求先演練 |
| 1 現場低風險 | 會議 F14（joya 宣達段一起拆）、問題回報 F33、回饋 F17、SOP F02（joya sop 段＋sop-summary 一起；食安＝高風險驗收）、班表＋人力 F15（hr 排程一起；abmod 歸 F15）。異常通知 F16 改隨 boss 域第 2 波 | 真正孤立的先；任務 F03 移到 DD 改接那波（第 4） |
| 2 食材成本＋銷售數據 | 盤點／包材／採購 F05~07、物料庫 F08、異常通知 F16、物料卡 F11、食譜 F10、菜單成本 F12＋菜單 F18（同 menu 域同波）、成本總覽 F13、耗損 F09、**銷售數據 F29**（含喬亞／Eats365 排程隨域交接） | 成本總覽要營收算毛利，Gemini 指出不能拆開；pm_inv 脊椎一起 |
| 3 數據 | inline F20（2021~2025 冷資料只匯入不同步）、行銷大師 F19（Meta／Pinterest 回呼先登記） | 量大，先做索引與加總 view |
| 4 溝通／人資／任務 | 任務 F03（DD 10 個動作＋3 支排程＋kvproxy 同日改接）、收件匣 F23、聊天室 F22、信箱 F28、入職 F27、夥伴名冊 F26 完整版、打卡站（F35） | 任務是寫入者最多的資料，等 DD adapter 穩定才切；webhook 關卡 4 才切 |
| 5 客人面 | 會員 F25（照表搬；點數影子）、團體訂餐 F24（金流影子、舊回呼保留到交易結清）、公開頁 F41 | LIFF／金流回呼一起驗（關卡 4） |
| 6 錢與點數轉正 | 排行榜／積分 F04、法規薪資 F30、零用金／財務 F36、團訂金流、會員點數：**影子計算在第 2 波資料到齊就起跑（只算不發）**，連續差 0 跑完一個完整月結才轉正 | OpenAI：起跑太晚月底驗不到 |
| 7 收尾 | DD 主程式代查改讀新表；剩餘排程；關同步橋 → 關卡 5 | DD 讀全部資料域，最後 |

## 5.1 第 0 波進度（2026-10-14 10:50）
| 項目 | 狀態 |
|---|---|
| GD 大表同步橋（rev／outbox／閘門／RPC） | ✅ 正式庫已套 0004；現場寫入正常；18/18 驗證 |
| 鏡像層 legacy.pm_documents | ✅ 3,097 筆對齊；每分鐘增量；0 錯誤 |
| 登入（橋接票／登入碼→Supabase session） | ✅ e2e 驗過；未登入導 /login |
| 身分匯入 | ✅ 14 人＋28 身分對照＋59 權限例外＋perm mode |
| GD 端：tabcfg.routes（no-store）／routesset／bridge／kvPut 可見錯誤 | ✅ v4.71.27 上線 |
| GD 端：DD 寫入 adapter 骨架、kvSet 不假存檔 | ✅ v4.71.28 上線 |
| 切換控制器（切／切回／凍結）＋命令路由骨架 | ✅ 程式上線（未切任何域） |
| 資料域種子（30 域）／功能路由（31，全關） | ✅ 兩庫已套 |
| 每小時備份排程 | ✅ 每小時 :07 |
| 側欄分組第 2 版＋登入者 | ✅ v0.2.1 |
| 主檔唯讀影子（名冊人資欄／物料／商品） | ❌ 下一步 |
| 投影層框架＋文件庫 F21 演練（0.5 波） | ✅ 演練全過（切→擋→寫回→注錯→自動切回→對帳差 0）；GD 看門狗 v4.71.29 |
| LINE Login／LIFF 登入 | ❌ 之後 |
| Storage 搬新桶＋/f/ 中繼 | ❌ 之後 |

## 5.2 SOP F02＋F33 刻意差異與已知風險（關卡 3 具名接受，2026-10-14）
**刻意跟 GD 不同（新殼較嚴或修了 GD 原洞）**
- 對範本裡不存在的動作／子項打勾＝擋（GD 會照收）。
- 審核人名單設成空＝沒人能審（GD 同；新殼原本誤用預設已修）。
- 單動作編輯依「正本裡原本的站」驗權限，跨站另驗新站（GD 原洞：可改別站）。標準照也依站權限（GD：有頁面編輯權即可）。
- 編輯動作沒帶標準照＝保留原本的（GD 原洞：會清掉）；「更換」＝換第一張。
- 刪動作會從別人的前置拿掉；前置指到已刪／回收站的動作不算（GD 原洞：永遠打不了勾）。
- 一筆回報只發布一次（網頁、LINE、GD 首頁共用冪等鍵）；送審通知只在變成待審時發一次；已核准完成不能再按「已解決」。
- 必拍項目後端也擋（GD 只擋前端）；有送照片但上傳失敗＝回錯，不默默完成；照片唯一檔名不覆寫。
- 舊整站／總編輯、嚴格模式開關、舊「分類」操作停用（GD 前端早已不用）。
- 歷史查詢用正確日檔鍵（GD 去掉連字號＝永遠查不到）。
- DD 命令（LINE 審核、首頁發布、排行榜評星、核銷人）有命令收據：同一命令只提交一次。

**已知、接受（同 GD 或極端情況）**
- 範本與完成紀錄／問題卡是兩份文件：以「這次提交嘗試讀到的範本與審核人」為準，目標文件衝突就重讀重算（不是跨文件原子）。
- 回報、建議、交接、checklist 新增重按會多一筆；checklist 勾選重送會反轉（同 GD）。
- 交接任何登入者都能刪（同 GD）。
- 沒有業務寫入的命令結果（找不到、未授權…）允許重新判斷，極端並行時回覆文字可能不同。
- 通知中心（prep_ntf）整份寫，多寫者並行可能蓋掉一筆歷史（GD 既有；只是歷史紀錄，主通道是 LINE）。F32 搬家時改原子 append。
- 孤兒照片（規則拒絕、並行完成、交易失敗、程序死亡）：之後補「上傳紀錄＋寬限期引用核對」清理排程。
- 命令紀錄、收據、發布嘗試紀錄要訂清理期限（配合重播與備份）。
- 問題回報發布（第七輪定案）：「發布中」記在那筆回報本身 pubTry {入口, 時間, 人, 固定鍵}，GD 用整數版本 CAS（pm_doc_cas，0012）寫入、新殼用 gdTxn；凍結後記不進去＝不會開始新的外發。規則：已發布不再發；之前有嘗試且走別的入口或超過 23 小時＝不重發，標已發布＋pubNote「未確認，請到群組核對」（問題卡上會顯示）；同入口 23 小時內固定鍵重送（LINE 24 小時去重）；代發口收到超過 23 小時的發布事件不送。發布中不能刪除、不能改保留。一案只發一個群（先按的入口決定）。
- 已知：若 LINE 其實沒收到、又剛好換入口或隔天才按，這筆會標「未確認」而不會進群——要靠人看到註記補發（刻意選「寧可漏發待核對、不要重複發」）。

## 5.3 物料卡 F11 差異與修正（2026-10-14，關卡 3 第一輪）

**已消除（GD v4.71.61 同步改成同一套算法）**
- 同日多張單「最後叫貨」：原本 GD 照阿桑 API 回傳順序（新單在前）只按日期排，取到當天較早那張（實例 G\|GDS-0083、G\|RNG004、G\|RNG005 數量不同）。現在兩邊都依「日期→下單時間」全域排（跨廠商也一起排），手動價格紀錄排在同日叫貨之後。
- 合併卡沒指定主要來源：兩邊都先把供應品依鍵排序再挑（原本看主檔列順序，兩邊可能不同）。同名卡列表依卡 ID 排。
- GD 舊 bug：每月 29～31 號「往回 13 個月」會重複當月、漏最舊一月（叫貨數量變兩倍）。GD 11 處月份產生器一律從當月 1 號往回推。

**新殼比 GD 嚴格（刻意，GD 的讀者不受影響）**

| 項目 | GD | 新殼 |
|---|---|---|
| 卡 ID／供應品鍵 | 不驗 | 卡 ID 只收 `mc_…`／`auto:…`；拒絕 `constructor`、`__proto__` 等保留字；讀取一律只認自有屬性 |
| 重按合併 | 每次都建新卡 | 這組代碼＝某張人建卡的全部供應品時，回那張卡、不重做（回 noop） |
| 數值／日期 | `Number()>0`（Infinity 會過）、日期只驗外形 | 有限數字；日期要真的存在（2026-02-30 拒絕） |
| edit 紀錄 after | 原樣記送來的 fields | 記實際寫入的值（截字、跳過非法值之後） |
| 照片 | 任何 image/*、時間檔名、可覆寫 | 驗檔頭 JPG／PNG／WebP、隨機檔名、不覆寫 |

## 6. 三家關卡紀錄

見 docs/ABGD_3AI_LOG.md。關卡 1：OpenAI 暫不通過＋Gemini 有條件 → 已依共識改成 v2（風險、順序、地基內容）；獨立 Claude 與第二輪待補。
