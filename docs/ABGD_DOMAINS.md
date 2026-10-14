# ABGD_DOMAINS：資料域所有權表（寫入權的正本；FEATURE_MAP 只是展示）

> 2026-10-14 v1。關卡 1 三家要求：寫入權按「資料域」切，不按頁面。每個域＝一組同時被寫的鍵前綴；owner＝gd／abgd；切換以域為單位，切換時 GD 端 `pm_domain_lock(prefix)` 上鎖（資料庫 trigger 擋所有寫入路徑：DD、排程、舊主 App anon 直寫、REST）。
> 寫入者欄來自 docs/ABGD_WRITERS.gen.md（機器產生＋人工核對）。「副作用」＝切換後只能由 owner 執行的外發（LINE／推播／扣點／付款）。
> 公司／店歸屬規則：`sp_finance_pm_pos_*` 等 `days` 鍵含 `::ground／::abeach` → 店；`sp_finance_pm_ab_*`、`sp_finance_pm_boss_*`（阿桑 A Beach）→ abeach；`sp_crew_*`、`sp_team_*`、`sp_finance_pm_sop_*`、`pm_inbox_*` 等 → 公司層（store 全域 uuid）；判不出來的列進「待判」不套預設店。

| 域 | 鍵前綴（GD） | 功能 | 寫入者（GD） | 副作用 | 新殼表 | 切換波 | 狀態 |
|---|---|---|---|---|---|---|---|
| identity | sp_finance_pm_prep_bind、prep_logincode、sp_crew_kb_roster（身分欄：id/name/nick/lineUserId/gdRole/status） | F34、F26 身分 | mail-sync、line-webhook、_onboard | DD 發登入碼 | core.users／identity_links／memberships | 0（唯讀影子；GD 仍 owner 到第 4 波） | shadow |
| perm | sp_finance_pm_prep_perm、prep_tabs、prep_fav、prep_hide、prep_animpref | F31 | mail-sync、line-webhook | — | core.permissions／settings | 0（新殼建；反向投影回 JSON 給 GD 舊頁讀；GD 仍 owner 到第 4 波） | shadow |
| notify | sp_finance_pm_prep_ntf、pm_push_subs、pm_notify | F32 | mail-sync、_webpush | 推播（單一出口 GD） | core.notifications／push_subscriptions | 0（只顯示） | shadow |
| sop | sp_finance_pm_sop_def、sop_g_、sop_issues、sop_sugs、sop_outbox | F02、F33 部分 | mail-sync、line-webhook（sop_issues）、joya-intraday（超時）、sop-summary | SOP 超時推群、回報推群 | ops.sop_* | 1 | shadow |
| meet | sp_finance_pm_meet | F14 | mail-sync、joya-intraday（追提醒） | 追提醒 LINE | ops.meetings／meeting_acks | 1 | shadow |
| feedback | sp_finance_pm_fb、fb_assign、fb_dims、fbj | F17 | mail-sync | — | ops.feedback* | 1 | shadow |
| issues | pm_issues、sp_finance_pm_errlog | F33 | mail-sync | — | ops.issues | 1 | shadow |
| shift | sp_finance_pm_shift_g、sp_crew_pm_hr_sched_、sp_finance_pm_labor、sp_finance_pm_abmod | F15（abmod 歸此） | mail-sync、hr（NUEiP）、partner-api 讀 | — | ops.shifts／shift_plans／labor_plans | 1（hr 排程班表段同切） | shadow |
| incidents | sp_finance_pm_boss_inc_、absoldout | F16 | boss-sync | 異常推播 | ops.incidents | 2（隨 boss 域；v3 的第 1 波改 2） | shadow |
| library | sp_finance_pm_library、pm_photos、pm_photo_folders | F21 | mail-sync、line-webhook（存到文件庫） | — | ops.library_* | 0.5 演練＋1 | shadow |
| inv | sp_finance_pm_inv、pm_buy | F05、F06、F07、F11 讀 | mail-sync、joya-intraday（低水位 notified） | 低水位 LINE | ops.materials／stock_counts／purchase_orders | 2（整域同切） | shadow |
| boss | sp_finance_pm_boss_*（ord/ordi/gord/gordi/prod/sup/matcat/citem/gprod/gsup/sched/att/inc/rout/sett/revd/revm/staff/state/menu/prep/ot） | F08、F16、F29(AB) | boss-sync | — | ops.boss_* | 2 | shadow |
| recipe | sp_finance_pm_recipebook、recipecost_snap、matcard | F10、F11 | mail-sync、_recipe、_matcard | — | ops.recipes／material_cards | 2 | shadow |
| menu | sp_finance_pm_menu、menu_assets、pricing、pos_prices、pos_costs、pos_alias、pos_hidden | F12、F18（**同域同波**，v3 矛盾已改：F18 菜單定義與出圖移到第 2 波） | mail-sync | — | ops.menus／menu_items／menu_assets | 2 | shadow |
| cost | sp_finance_pm_cost_snap_*、cost_todo、cost_cfg、veg_quotes、veg_market、vendor_recon_ | F13 | mail-sync（含排程段） | 報價變動 LINE | ops.cost_*／veg_* | 2 | shadow |
| waste | sp_finance_pm_waste_、waste_cfg | F09 | _waste | — | ops.waste_logs | 2 | shadow |
| pos | sp_finance_pm_pos、pos_d_、pos_tx_、pos_hh_、pos_q_、pos_q_ab_、pos_void_、pos_flags、pos_slotex、pos_idlecfg、ab_hh_、ab_hhrev_、ablive、fc_、fc_cfg、eats_sess、heat_hide、twhol_ | F29、F01 | joya-intraday、mail-sync、_eats、eats-rhythm、_fc、boss-sync(AB) | 退單私訊、預測 LINE | ops.pos_* | 2（排程 pos 段同切；EATS_DEVICE_COOKIE 只一邊跑） | shadow |
| inline | sp_finance_pm_inline、inline_（月檔）、inline_nr_、inline_notes、inline_alerts、inline_outlook、inline_insights、inline_actst、inline_custidx（ph3_*／cs_* 衍生不同步） | F20 | inline-sync（**建任務段屬 tasks 域**） | 連假落後 LINE、每週摘要 | ops.reservations／customers | 3 | shadow |
| social | sp_finance_pm_social_*、pinterest、lineoa_*、lineoa_sum | F19 | social／social-collect／social-publish／_pinterest／lineoa-sync | **發文（Meta）** | ops.social_* | 3（影子 dry-run） | shadow |
| tasks | sp_team_pm_task_、task_mq、ptscfg、sp_team_pm_data、pm_task_、pm_tasks、pm_tasks_v2、sp_*_pm_activity | F03 | DD 10 動作、cron-daily、inline-sync、task-remind、mail-sync(kvproxy)、_ddcards、舊主 App TaskCenter | 指派／提醒 LINE | ops.tasks／task_events | 4 | shadow |
| inbox | pm_inbox_c_、pm_inbox_m_、pm_inbox_cfg、pm_inbox_acct_ | F23 | _inbox、line-webhook relay、inbox-webhook | **回客人（LINE reply/push）** | ops.inbox_* | 4（webhook 關卡 4） | shadow |
| chat | pm_chat_rooms、pm_chatm_、pm_chat_read_ | F22 | _chat | 鈴鐺／LINE 審核人 | ops.chat_* | 4 | shadow |
| mailhub | sp_finance_pm_mailhub、mailhub_scan_ | F28 | _mailhub | 封存／移信（IMAP） | ops.mailboxes | 4 | shadow |
| crew | sp_crew_kb_roster（人資欄）、sp_crew_pm_hr_master、hr_att_、hr_staff、hr_notif、hr_pay、pm_hrdoc_pending、hr_idlock、sp_crew_pch、punch_makeup | F26、F27、F35 打卡 | mail-sync、line-webhook、hr、_onboard、onboard、punch | 入職通知 | ops.crew／crew_private／attendance | 4 | shadow |
| grporder | pm_grpord_*、grpord_cfg、grpord_idx | F24 | _grporder、客人頁、LINE Pay／綠界回呼 | **收款、發票、傳圖** | ops.group_orders／payments／invoices | 5（金流影子→6 轉正） | shadow |
| member | 真表 members／member_*（10 張）、pm_member_cfg、member_push、member_mktout | F25 | _member、客人頁、DD 代查 | **扣點、推播** | ops.member_* | 5（照表搬；點數影子→6） | shadow |
| points | sp_finance_pm_points、points_cfg、rewards、redeem | F04、F35 | _points（7 動作：punch/fb/sop/sign/issue/log/inv）、mail-sync | **扣點、兌換通知** | ops.points_ledger／rules／rewards／redemptions | 6（影子自第 2 波資料到齊起算；完整月結） | shadow |
| payroll | sp_finance_pm_payrates、vio_res、vionotif | F30 | mail-sync | 違規通知 | finance.pay_rates／violations | 6 | shadow |
| finance | sp_finance_pm_fin_*、bank、ctbc、sheet、petty、pm_petty | F36 | line-webhook（add_finance_tx／petty）、sheet-sync、舊主 App | — | finance.ledger（Belle 到了一起規劃） | 6 | shadow |
| dd | pm_bot_*、pm_dd_*、pm_ddev_、pm_ddh_、pm_group_seen、pm_cc_inbox、sp_finance_pm_ddmsg、ddgrp、pm_ai_*、sp_finance_pm_ai_cfg、pm_shortlinks、pm_bot_context（衍生快照） | DD、F31 DD 設定、F39 | line-webhook、_ddmsg、_ddhealth、_ai、**pm_bot_context 改 GD 端 cron 產生**（取代舊主 App 瀏覽器，第 0 波） | DD 回話／推播 | abgd 第 7 波才接 | gd |
| em | sp_finance_pm_em、em_state | 小夏 EM | em-sync | 401 私訊 | em.* | 小夏進來時 | gd |
| engineering | pm_data、pm_hist_*、projects／tasks／contractors 真表、pm_conclusions、pm_estimates | F37 工程資料 | 舊主 App | — | 不搬；app/(shell)/archive 唯讀 | 不搬 | gd |

## 跨域命令／事件矩陣（誰產生、誰消費、冪等鍵）
| 事件 | 產生域 | 消費域 | 冪等鍵 | 影子期 | 切換後 |
|---|---|---|---|---|---|
| 完成 SOP 項目 → 積分 | sop | points（owner=gd 到第 6 波） | (user, station, item, date) | 新殼寫 ops.sop_done，**不發積分**；反向同步回 GD 後由 GD `_points.awardPts` 照舊入帳 | points 轉正後改新殼入帳 |
| 回饋／簽收／回報／日誌／盤點／打卡 → 積分 | feedback／meet／issues／tasks／inv／crew | points | 同上各自然鍵 | 同上 | 同上 |
| 任務指派／審核 → LINE 通知 | tasks | notify | task_id＋event | GD 發 | abgd 經 effects.ts 發（GD 停發） |
| 收件匣回覆 → LINE 客人 | inbox | — | line message id | 不發（effect_log） | abgd 發 |
| 團訂付款回呼 | 外部 | grporder | 供應商交易 ID | 舊回呼網址保留到交易結清 | 新殼網址 |
| 會員入點／兌換 | member | points | (member, visit/redeem id) | 新殼只算 | 轉正後新殼扣 |

## 切換驗收案例（每域都要過）
1. 舊頁（GD）在域切換後嘗試寫入 → 收到 ABGD_LOCKED，畫面提示「請用新版」。
2. DD 對該域的動作 → 走 adapter 打新殼，回覆一致；代查讀新殼 view。
3. 排程段只在一邊有副作用（另一邊 dry-run 比對輸出）。
4. 反向同步 60 秒內 GD 大表更新，GD 其他未搬頁讀得到。
5. 對帳差 0（來源 vs 目的實存＋算法）。
6. 自動切回演練：注入錯誤 → 封寫 → 排空 → 解鎖 GD → 資料不丟。
