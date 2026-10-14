# ABGD 切換／回切 人工恢復手冊（一頁）v7

> 2026-10-14 立；v2 依回饋 F17 關卡 3 第七輪三家意見改：每一步都是切換口的一個指令＋要讀回確認的結果，不手寫 SQL。
> v5（第十輪）：清旗標後立刻 align、B 收尾等 dirty=0 且 dead=0、GD 探測帶 domain、freeze 回應列出全部未結案操作、接管瞬間 GD 可能被舊程序動過的說法改準確；入口發布有版本圍欄（舊快照晚到 GD 回 409）。
> v6（第十一輪）：補投影改用 `op=reproject`（只在 GD 正本 gd/gd 時跑，凍結中不能補）；新增 D 入口隔離；B 第 1 步驗收不過就停；`reproject_required=true` 超過 10 分鐘看門狗會私訊。
> v7（第十二輪）：C 第 1 步與 B 第 1 步用同一份 freeze 驗收；控制器「控制權查不到」不再當成被接管（會隔離、留 unknown、私訊）；**正式環境的演練一律在演練專用資料域 `drill`（鍵 sp_finance_pm_zzdrill，沒有功能使用）做，不拿真功能試**。
> 指令：`POST https://ab-gd.vercel.app/api/core/switch?key=<CRON_SECRET>`，body 見各步（`by` 填你的名字）。
> **看狀態（只讀）**：`GET 同網址&domain=<域>` → `abgd`（writer／state／epoch／manual_required）、`gd_locks`（每個前綴 owner／epoch，`missing` 要是空的）、`open_ops`（全部 running／unknown）、`sync`（dirty／dead／oldestDirty）、`routes`。任一欄是 `unavailable`＝那項查不到，不要當正常。
> **GD 連得上嗎**：`GET /api/core/health?gd=1&domain=<域>`（標頭 Authorization: Bearer CRON_SECRET）回 `gd:true`——這支真的去查 GD 該域的鎖列；`/api/core/health?domain=` 只驗新殼自己。
> 演練：7（部分解鎖→需人工對帳→清旗標→回切）、8（死信重放）、9（GD 真寫入→採用 GD 版本→對齊→回切）、10（平台中止→凍結→結案→恢復 GD）、11（切換中人工 freeze→舊程序自己停手不解鎖）、12（無待推但 GD 不同→決議保留新殼版本→推回 GD→回切）、13（舊回切被接管後人工恢復全做完，舊程序醒來也不改任何狀態）。

## 先判斷是哪種狀況
| 看到 | 狀況 |
|---|---|
| ops 有 `unknown`，或 `running` 超過 6 分鐘 | **C：操作卡住／結果不明**（含平台中止） |
| domains `manual_required=true` | **B：需人工對帳** |
| 看門狗私訊「死信」或「超過 10 分鐘沒推回 GD」，manual_required=false | **A：反推卡住** |

## A：反推卡住（manual_required=false；標了需人工對帳的域反推會自動暫停，走 B）
1. 確認 GD 真的連得上：`GET /api/core/health?gd=1&domain=<域>` 回 `gd:true`；**不要只看 push 的 errors=0**（全是死信時 push 根本不會呼叫 GD）。
2. `{"op":"replay","domain":"<域>","by":"…","reason":"<原因>"}` → 回 `n` 與事件 id 清單。
3. 等一分鐘 → `GET …&domain=<域>` 看 `sync.dirty=0、sync.dead=0`（不要拿告警消失當依據，告警每小時才發一次）。
4. 若域是 `abgd/frozen`（回切失敗的同步隔離）→ `{"op":"rollback","domain":"…","by":"…","reason":"…"}`。

## B：需人工對帳（manual_required=true）
1. `{"op":"freeze","domain":"<域>","by":"…","reason":"…"}` → **驗收**：`gdFrozen:true`、`domain.state:"frozen"`、`gd` 每個前綴 owner=frozen 且世代＝domain.epoch、`openOps` 是陣列（是 `unavailable…` 字串＝讀不到，不要繼續）。驗收不過就停、找 CC，不准採用或清旗標。`openOps` 有任何一筆 → 先走 C 第 2 步逐筆結案，才能採用／清旗標。
2. 對帳：abgd repo `node scripts/reconcile.mjs <功能>`。
   - 差 0 → 第 4 步。
   - 有差 → 看差的鍵在 GD 那邊是不是解鎖期間的新寫入（GD pm_documents.editor／updated_at），逐鍵決定保留哪一邊：
3. 決議（每個差異鍵擇一）：
   - 保留 GD 版本：`{"op":"adopt_gd","domain":"<域>","by":"…","keys":["<鍵>",…]}` → 回 `adopted`（含 GD 來源版本與摘要）；再對帳確認那些鍵差 0。要求 GD 全 frozen 且世代一致（第 1 步 freeze 已做到）。
   - 保留新殼版本：`{"op":"keep_abgd","domain":"<域>","by":"…","keys":["<鍵>",…],"note":"<為什麼，至少 10 字>"}` → 回 `n`；會補待推事件，第 5 步 align 之後由反推送回 GD（**不做這一步，新殼版本不會自己推回去**）。
4. `{"op":"manual_clear","domain":"<域>","by":"…","note":"<核對了什麼、怎麼處理，至少 10 字>"}` → 回 ok（程式先驗：新殼 frozen、GD 每個前綴有鎖列、不是 gd、世代號與新殼相同）。**清完旗標後立刻做第 5 步**（中間不要去處理別的；align 被拒「還有未結案的操作」→ 先走 C 第 2 步結案再 align）。manual_clear 自己被拒「還有操作握控制權」＝有 unknown 的操作（常是之前失敗的 freeze）→ 先走 C 第 2 步 resolve_op 再清。
5. `{"op":"align","domain":"<域>","by":"…"}` → writer=abgd 時 GD 前綴回 abgd（新世代，反推恢復）；writer=gd 時 GD 前綴維持 frozen。
6. 收尾：
   - writer=abgd（新殼曾是正本）→ 等 `sync.dirty=0` **且 `sync.dead=0`**（dead>0 → 照 A 第 2 步 replay 再等）→ 再對帳一次差 0 → `{"op":"rollback",…}`（或要續留新殼找 CC）。
   - writer=gd（新殼從沒開寫）→ `{"op":"restore_gd","domain":"…","by":"…","note":"<結論>"}` → 回 ok；GD 前綴全 gd、新殼 gd/gd。

## C：操作卡住／結果不明（含平台中止）
**不要假設已經隔離**（平台中止時程式的隔離步驟可能沒跑）。
1. `{"op":"freeze","domain":"<域>","by":"…","reason":"操作卡住"}` → **驗收同 B 第 1 步**（gdFrozen:true、state frozen、每個前綴 owner=frozen 且世代＝domain.epoch、openOps 是陣列；任一不符或 unavailable 就停、找 CC）。freeze 在新殼一個交易內接管控制權：原本 running 的操作改 unknown＝撤銷、標需人工對帳、世代+1。撤銷後舊程序在**新殼端**的控制寫入（狀態、入口、追平投影、採用、補投影標記）都會被資料庫拒絕；但 **GD 端可能在接管瞬間被舊程序改過**，所以接管後一律走 B 對帳。
2. 結案（openOps 每一筆都要做）：`{"op":"resolve_op","id":"<ops 裡那筆 id>","by":"…","note":"<結論>"}` → 程式驗兩端：「確認成功」（切換：新殼 abgd/abgd 且 GD 全 abgd）或「確認安全隔離」（新殼 frozen 且 GD 沒有 gd）才會結案（status＋finished_at＋紀錄同交易）。
3. 接著走 **B**（從第 2 步對帳開始）。
   - 若被中止的是回切／restore_gd（GD 已恢復正本），新殼影子表可能停在舊內容（狀態口 `reproject_required:true`）：等 B 走完、域回到 gd/gd 後 → `{"op":"reproject","domain":"<域>","by":"…"}` → 回 ok 並清掉 reproject_required → 再對帳到 0（GD 是正本，只修新殼影子，不動 GD）。凍結中補不了（投影在凍結時一律跳過）。
4. align／restore_gd 要求該域沒有未結案操作；看到「還有未結案的操作」就先做第 2 步。

## D：入口被看門狗隔離（GD 看門狗私訊「已把入口切回舊版並隔離」）
- 意思：新殼健康檢查連續失敗，GD 把該功能從側欄入口拿掉並記在隔離清單；之後任何切換／發布都**不會**把它加回去，要切那個功能會回「GD 入口被看門狗隔離中」。資料庫鎖沒動。
1. 先確認新殼恢復：`GET /api/core/health` 回 ok，且該域狀態口沒有 open_ops、sync dirty／dead 都是 0。
2. 解除：`{"op":"routes_unquarantine","keys":["<功能代碼，例 fb>"],"by":"…","reason":"<確認了什麼，至少 10 字>"}` → 回 `routes`（實際入口）與剩下的 `quarantine`。
3. 如果該域當時是新殼正本（writer=abgd），解除後入口會回到新殼；如果要改回 GD，走一般 rollback。

## 永遠不要做
- 不要手寫 SQL 改 `pm_domain_lock`、`core.domains`、`switch_ops`；舊的非 CAS 函式（pm_domain_set、core.domain_set）已停用。
- 不要把世代號改小；不要在 GD 還有前綴是 gd 時清旗標。
- 回切取消排隊通知只取消「提醒類」（meet_remind、meet_nudge_group，GD 會自己重算）；已成立的通知（例如新會議私訊）照送，因為 GD 不會補發。
