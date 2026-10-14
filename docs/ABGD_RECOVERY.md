# ABGD 切換／回切 人工恢復手冊（一頁）

> 對象：值班的人（CC 或之後的工程夥伴）。所有指令都打新殼的切換口（要 CRON_SECRET）：
> `POST https://ab-gd.vercel.app/api/core/switch?key=<CRON_SECRET>`，body 見各步。
> 看狀態：`GET 同一網址`（回 domains／feature_routes／最近 20 筆 switch_ops）。
> 看 GD 鎖：GD 資料庫 `select prefix, owner, epoch from pm_domain_lock where domain='<域>'`。
> 2026-10-14 立（回饋 F17 關卡 3 第六輪三家要求），演練 7、8 已照本手冊走過。

## 狀態怎麼讀
| 新殼 domains | GD 各前綴 | 意思 | 誰能寫 |
|---|---|---|---|
| gd/gd | gd | 舊殼正常 | GD |
| abgd/abgd | abgd | 已切新殼 | 新殼（反推回 GD） |
| abgd/frozen，manual_required=false | abgd | 回切失敗的「保持同步隔離」 | 都不能寫；反推還會把剩下的推回 GD |
| */frozen，manual_required=true | frozen（部分可能 abgd） | 需人工對帳 | 都不能寫；一般回切／切換會被拒 |
| switch_ops 有 status=unknown | 不確定 | 開寫結果不明或隔離確認不了 | 先照「狀況 C」 |

## 狀況 A：看門狗私訊「死信 N 筆」或「修改超過 10 分鐘沒推回 GD」
1. 先確認 GD 能連（`/api/core/sync/push?key=…` 回 ok、errors 0）。
2. GD 恢復後重放：body `{"op":"replay","domain":"<域>","by":"<你的名字>","reason":"<原因>"}` → 回 `n`＝放回佇列筆數。
3. 等一分鐘（或手動打 push）→ `dirty=0、dead=0`。
4. 若域是 abgd/frozen（保持同步隔離）→ 可以再走一般回切：`{"op":"rollback","domain":"<域>","by":"…","reason":"…"}`。

## 狀況 B：回切失敗、域被標「需人工對帳」（manual_required=true）
代表某個 GD 前綴曾經可能被解鎖（GD 那段時間可能有人寫入），系統不再自動處理。
1. 確認 GD 所有前綴都不是 gd（是 frozen 或 abgd）。若還有 gd → 先請 CC 用 pm_domain_set2 凍結（CAS，預期值＝目前值，epoch+1）。
2. 對帳：`node scripts/reconcile.mjs <功能>`（abgd repo）比新殼組回 vs GD 原文。
   - 差 0：GD 那段沒有新寫入，直接到第 3 步。
   - 有差：逐筆看 GD 版本是否是解鎖期間的新寫入（看 GD pm_documents.editor／updated_at）。要保留的，先在新殼以同樣內容補寫（或把新殼投影重設後重投 GD 版本），再對帳到 0。
3. 清旗標（要寫 10 字以上結論）：`{"op":"manual_clear","domain":"<域>","by":"<你的名字>","note":"<核對了什麼、GD 新寫入怎麼處理>"}`。
4. 一般回切：`{"op":"rollback",…}`；或確定新殼正常、要續留新殼 → 找 CC（需另外的開寫程序，不手改資料庫）。

## 狀況 C：switch_ops 有 unknown（看門狗私訊「切換操作未解決」）
1. 讀兩端狀態（新殼 domains、GD pm_domain_lock）。
2. 新殼 abgd/abgd 且 GD 全 abgd、epoch 一致 → 切換其實成功：把該筆 switch_ops 標 done（記處理人），不用其他動作。
3. 其他組合 → 兩端應已被隔離（frozen、新世代）；照狀況 B 對帳後處理。讀不到狀態就先不要動，找 CC。
4. 不要只手改 switch_ops.status；要記處理人與結論（switch_ops.log 補一筆）。

## 永遠不要做
- 不要直接 `update pm_domain_lock` 或 `core.domains`（繞過 CAS 與世代）；一律用 pm_domain_set2／core.domain_set2 或切換口。
- 不要把 epoch 改小。
- 不要在 GD 還有前綴是 gd 時清 manual_required。
