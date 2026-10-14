# ABGD 切換／回切 人工恢復手冊（一頁）v2

> 2026-10-14 立；v2 依回饋 F17 關卡 3 第七輪三家意見改：每一步都是切換口的一個指令＋要讀回確認的結果，不手寫 SQL。
> 指令：`POST https://ab-gd.vercel.app/api/core/switch?key=<CRON_SECRET>`，body 見各步（`by` 填你的名字）。
> 看狀態：`GET` 同網址 → `domains`（writer／state／epoch／manual_required）、`ops`（最近 20 筆，含 running／unknown）。
> 看 GD 鎖：每個指令的回應都會附，或 `freeze` 回應的 `gd` 欄。
> 演練：7（部分解鎖→需人工對帳→清旗標→回切）、8（死信重放）、9（GD 真寫入→採用 GD 版本→對齊→回切）、10（平台中止→凍結→結案→恢復 GD）。

## 先判斷是哪種狀況
| 看到 | 狀況 |
|---|---|
| ops 有 `unknown`，或 `running` 超過 6 分鐘 | **C：操作卡住／結果不明**（含平台中止） |
| domains `manual_required=true` | **B：需人工對帳** |
| 看門狗私訊「死信」或「超過 10 分鐘沒推回 GD」，manual_required=false | **A：反推卡住** |

## A：反推卡住（manual_required=false）
1. 確認 GD 真的連得上：`GET /api/core/health?domain=<域>`（帶 Authorization: Bearer CRON_SECRET）回 ok；**不要只看 push 的 errors=0**（全是死信時 push 根本不會呼叫 GD）。
2. `{"op":"replay","domain":"<域>","by":"…","reason":"<原因>"}` → 回 `n` 與事件 id 清單。
3. 等一分鐘 → `GET` 看 sync 積壓歸零（看門狗積壓告警消失）。
4. 若域是 `abgd/frozen`（回切失敗的同步隔離）→ `{"op":"rollback","domain":"…","by":"…","reason":"…"}`。

## B：需人工對帳（manual_required=true）
1. `{"op":"freeze","domain":"<域>","by":"…","reason":"…"}` → 回 `state:"frozen"`，且 `gd` 每個前綴都不是 gd、世代號一樣（freeze 一定把兩端推到同一個新世代）。
2. 對帳：abgd repo `node scripts/reconcile.mjs <功能>`。
   - 差 0 → 第 4 步。
   - 有差 → 看差的鍵在 GD 那邊是不是解鎖期間的新寫入（GD pm_documents.editor／updated_at）。要保留 GD 的 → 第 3 步；要保留新殼的 → 不用動（之後反推會把新殼版本送回 GD）。
3. `{"op":"adopt_gd","domain":"<域>","by":"…","keys":["<鍵>",…]}` → 回 `adopted`；再對帳一次確認那些鍵差 0。
4. `{"op":"manual_clear","domain":"<域>","by":"…","note":"<核對了什麼、怎麼處理，至少 10 字>"}` → 回 ok（程式先驗：新殼 frozen、GD 每個前綴有鎖列、不是 gd、世代號與新殼相同）。
5. `{"op":"align","domain":"<域>","by":"…"}` → writer=abgd 時 GD 前綴回 abgd（新世代，反推恢復）；writer=gd 時 GD 前綴維持 frozen。
6. 收尾：
   - writer=abgd（新殼曾是正本）→ 等積壓推完（狀況 A 第 3 步）→ `{"op":"rollback",…}`（或要續留新殼找 CC）。
   - writer=gd（新殼從沒開寫）→ `{"op":"restore_gd","domain":"…","by":"…","note":"<結論>"}` → 回 ok；GD 前綴全 gd、新殼 gd/gd。

## C：操作卡住／結果不明（含平台中止）
**不要假設已經隔離**（平台中止時程式的隔離步驟可能沒跑）。
1. `{"op":"freeze","domain":"<域>","by":"…","reason":"操作卡住"}` → 兩端凍結、標需人工對帳；卡住的 running 會改成 unknown。
2. 結案：`{"op":"resolve_op","id":"<ops 裡那筆 id>","by":"…","note":"<結論>"}` → 程式驗兩端：「確認成功」（切換：新殼 abgd/abgd 且 GD 全 abgd）或「確認安全隔離」（新殼 frozen 且 GD 沒有 gd）才會結案（status＋finished_at＋紀錄同交易）。
3. 接著走 **B**（從第 2 步對帳開始）。

## 永遠不要做
- 不要手寫 SQL 改 `pm_domain_lock`、`core.domains`、`switch_ops`；舊的非 CAS 函式（pm_domain_set、core.domain_set）已停用。
- 不要把世代號改小；不要在 GD 還有前綴是 gd 時清旗標。
- 回切取消排隊通知只取消「提醒類」（meet_remind、meet_nudge_group，GD 會自己重算）；已成立的通知（例如新會議私訊）照送，因為 GD 不會補發。
