# GROUN:D Partner API v1 — 給阿桑（A Beach OPS）的唯讀互通 API

> 2026-10-03 張良拍板：兩店系統互通。這是我們這邊（ground-pm）出的對等 API，風格刻意跟你的 boss-api 一致，方便你照你自己的套路串。

## 基本

- Base URL：`https://ground-pm.vercel.app/partner/v1`
- 驗證：`Authorization: Bearer <金鑰>`（或 `x-api-key: <金鑰>` 標頭）。金鑰由張良轉交。
- 只有 `GET`，沒有任何寫入端點。無 CORS（server-to-server 專用，瀏覽器直打會失敗）。
- `GET /ping` → `{"ok":true,"scopes":[...],"rate_limit_per_min":60}` 驗金鑰。
- 回應外殼：`{"data":[...],"count":N,"next":"<游標或null>","from":"...","to":"..."}`。
- 分頁：`limit` 預設 100、最大 500；`next` 非 null 就帶 `cursor=<next>` 續抓（不透明字串，原樣帶回）。
- `from`/`to`：`YYYY-MM-DD`，含頭含尾，台北時間。各端點有預設窗與區間上限（見下表）。
- 錯誤一律 `{"error":"..."}`：400 參數錯、401 金鑰錯、404 端點不存在、500 伺服器錯。
- 請求請循序、每分鐘 <60 次（目前沒硬擋，但請照這個節奏）。

## 端點總覽

| 端點 | 內容 | 預設窗 | 區間上限 | 主鍵（upsert 用） |
|---|---|---|---|---|
| `/revenue/daily` | 每日營收（GD 喬亞＋AB Eats365 都有，`store=ground\|abeach` 可濾） | 31 天 | 366 天 | `date`＋`store` |
| `/revenue/items` | 每日品項明細（攤平：分類/品項/數量/金額；含付款方式、時段表） | 31 天 | 92 天 | `date`＋`store`＋`sheet`＋`section`＋`name` |
| `/orders` | GD 叫貨單（單頭含 `items` 明細與驗收狀態） | 全部 | — | `order_id` |
| `/orders/prices` | GD 進價流水（日期/廠商/品項/單價/數量） | 31 天 | 366 天 | 無穩定主鍵，整窗覆蓋 |
| `/reservations` | AB inline 訂位逐筆（全史 2021-02 起，14 萬筆） | 31 天 | 92 天 | `reservation_id` |
| `/reservations/summary` | 訂位全史月彙總（每月筆數/人次） | — | — | 整份覆蓋 |
| `/hr/schedule` | GD 班表（日期/人/起訖/休息） | 前 7 天 | 366 天 | `date`＋`name`＋`start` |
| `/hr/staff` | 夥伴名冊（動態欄位；**不含**薪資/身分證/銀行/保險等機密欄） | — | — | `staff_id` |
| `/sop/defs` | GD 每日 SOP 定義（站別/項目/時限） | — | — | `sop_id` |
| `/sop/daily` | SOP 每日完成紀錄（誰、幾點、照片連結） | 7 天 | 31 天 | `date`＋`sop_id` |
| `/sop/issues` | 看板問題回報（內容/狀態/認領/照片） | 全部 | — | `issue_id` |

## 語意與陷阱

- **null＝沒資料不是 0**；某天整列不存在＝那天沒資料（例如公休不入庫），不是營收 0。
- `/revenue/daily`：`net_sales`＝淨營收（我們兩店 KPI 口徑）；`kiosk` 是「通路」維度，跟 `cash/card/linepay` 付款別**交疊、不能加總**；GD `guests` 無資料（喬亞不給來客數）。GD 自動值從 2026-08 起、AB 從 2026-04 起。
- `/revenue/items`：`section="總結"` 是分類彙總列，**別跟單品重複加總**；「付款方式」「時段」sheet 也原樣攤平在裡面，拿品項時建議濾 `sheet` 開頭是「總銷售額」的。
- `/orders`：來源是叫貨頁，滾動保留約 600 筆（更早的看 `/orders/prices` 流水）；`items[].check` 是驗收結果（null＝還沒驗）。
- `/reservations`：`status`＝`confirmed / cancelled / seated / no_show`；`guests` 人數含取消的列自己濾。回填自 inline 官方後台，歷史空日＝店休/疫情，本來就沒訂位。
- `/hr/schedule` 是**排班**不是打卡。
- `/sop/daily` 的 `photo` 是圖片連結（部分舊資料可能是 `(photo)` 佔位）。
- 同步建議跟你 boss-api 的 SKILL 同一套：固定主鍵 upsert、增量窗整段重拉覆蓋、翻頁全成功才做刪除、每週大範圍重拉一次。

## 範例

```bash
curl -H "Authorization: Bearer $KEY" "https://ground-pm.vercel.app/partner/v1/ping"
curl -H "Authorization: Bearer $KEY" "https://ground-pm.vercel.app/partner/v1/revenue/daily?from=2026-09-01&to=2026-09-30&store=ground"
curl -H "Authorization: Bearer $KEY" "https://ground-pm.vercel.app/partner/v1/reservations?from=2026-10-01&to=2026-10-31&limit=500"
```

有缺資料域或想加欄位，跟張良講一聲就能加。
