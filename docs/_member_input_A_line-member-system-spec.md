# LINE 會員系統（自建版）開發規格 — 給 Claude Code

> 目的：取代購買 12CM Echoss VIP，用自有 app + LINE 官方帳號自建會員系統，資料留在自家 Supabase。
> 適用品牌：GROUN:D（內湖店，宏匯瑞光辦公大樓）為主，資料結構從第一天支援多品牌（A Beach 之後接入）。
> 技術棧：React + Vite、Supabase（Postgres / Auth / Edge Functions / pg_cron）、Vercel、LINE Messaging API + LIFF。

---

## 0. 開工前必讀（給 CC 的工作規則）

1. **先盤點現有程式碼再動手**：找出現有的 LINE Bot（阿D／DD）、統一收件匣、OPS app 各自用哪個 LINE channel、哪個 Supabase 專案、webhook 指向哪裡。把盤點結果與實作計畫回報給用戶，確認後才開始寫。
2. **不要假設 POS**：第 4 節的消費記錄有三種模式，POS 品牌未確認前只實作「模式 A：店員掃會員 QR」，並把 POS 串接做成可替換的 adapter 介面。
3. **Webhook 衝突**：一個 LINE 官方帳號只能設一個 webhook URL。若會員 OA 與統一收件匣／DD 共用同一個 OA，必須做單一 webhook router 分派事件，不可直接覆蓋現有 webhook 設定。
4. **Migration**：所有 schema 變更放 `supabase/migrations/`，可重跑、可回滾。不直接在 dashboard 改表。
5. **PR 規則**：只動文件的 PR 可直接 merge 後回報；動到程式碼的 PR 先附 Vercel preview 連結，等用戶回覆「merge」才合併。
6. **範圍紀律**：只做本文件 P0。P1/P2 與「不做」清單中的項目，未經用戶同意不得順手加入。
7. 文件中若需要顯示公司名稱，先問用戶，不要自行填 GROUN:D 或其他名稱。

---

## 1. 設計原則

- **主循環優先**：認得客人 → 記錄消費 → 給回購理由 → 提醒回來。不在這條循環上的功能一律延後。
- **資料主權**：會員、消費、點數全部在自家 Supabase，任何外部服務（POS、金流）只是資料來源，不是資料主人。
- **點數用帳本（ledger）不用餘額欄位**：只追加、不修改；餘額由加總算出（可加 materialized view 或快取欄位，但以 ledger 為準）。
- **冪等**：所有消費寫入以 `(source, external_ref)` 唯一鍵去重，重送不重複給點。
- **多品牌**：所有業務表帶 `brand_id`。會員本體跨品牌共用（同一個 LINE UID 一個人），品牌關係另表。
- **不信任前端**：LINE UID 一律由後端驗證 LIFF ID token 取得，前端傳來的 UID 不採信。

---

## 2. 範圍

### P0（本次開發）
| # | 功能 | 驗收重點 |
|---|---|---|
| 1 | 會員綁定（LIFF） | 取得 UID、手機、姓名、生日；同 UID 不重複建檔 |
| 2 | 消費記錄 | 模式 A（店員掃會員動態 QR）可用；POS adapter 介面定義完成 |
| 3 | 集點／兌點 | 依消費金額給點；可用點數兌換優惠券；ledger 可追溯 |
| 4 | 入會禮、生日禮 | 綁定完成自動發券；生日券每日排程自動發 |
| 5 | 優惠券 | 範本 → 發放 → 核銷；記錄核銷門市與核銷人；防重複核銷 |
| 6 | 標籤＋分眾推播 | 自動標籤（來源、消費頻次、沉睡）＋手動標籤；依標籤組合推播並記錄發送數 |
| 7 | 數據儀表板 | 會員數、綁定率、回購率、平均消費間隔、券核銷率、點數流通量 |

### P1（下一階段，先不做）
- 問卷（填完送點數／券）
- LINE 預點餐、自取（需申請金流）
- 會員等級自動升降等（累積 2–3 個月實際消費資料後再定門檻）

### P2（需法規確認後才做）
- 訂閱制、預售餐券（付費票券涉及履約保證要求，用戶確認法規方案前不實作）

### 不做
- 互動遊戲（輪盤／刮刮樂／扭蛋）— 辦公客群回購動機不在此，且有贈獎額度法規負擔
- 點數互贈、禮包組合、三層權限（沿用現有權限系統）、智慧印章（以動態 QR 替代）、LINE MINI App（LIFF 已足夠）
- LINE 禮物上架 — 需官方夥伴資格，未來若需要另外購買

---

## 3. 資料模型（Supabase / Postgres）

> 以下為建議結構，CC 實作時可調整命名以符合既有 repo 慣例，但需保留語意與約束。

```sql
-- 品牌與門市
create table brands (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,            -- 'ground', 'abeach'
  name text not null,
  created_at timestamptz default now()
);

create table stores (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id),
  name text not null,
  is_active boolean default true
);

-- 會員本體（跨品牌，一個 LINE UID 一人）
create table members (
  id uuid primary key default gen_random_uuid(),
  line_uid text unique not null,
  display_name text,
  name text,
  phone text,
  phone_verified boolean default false,
  birthday date,
  created_at timestamptz default now()
);

-- 會員與品牌的關係
create table member_brands (
  member_id uuid references members(id),
  brand_id uuid references brands(id),
  joined_at timestamptz default now(),
  join_source text,                     -- 來源標籤：'store_qr','fb','ig','referral'...
  status text default 'active',         -- active / blocked（使用者封鎖 OA 時更新）
  primary key (member_id, brand_id)
);

-- 消費記錄（冪等）
create table visits (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id),
  store_id uuid not null references stores(id),
  member_id uuid not null references members(id),
  amount integer not null check (amount >= 0),   -- 新台幣整數
  source text not null,                 -- 'staff_scan' | 'pos' | 'receipt_claim'
  external_ref text,                    -- POS 訂單編號或 claim token
  occurred_at timestamptz not null default now(),
  created_by uuid,                      -- 店員 user id（staff_scan 時必填）
  unique (source, external_ref)
);

-- 點數規則（每品牌一份，可版本化）
create table point_rules (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id),
  earn_per_amount integer not null,     -- 每消費 N 元得 1 點
  expire_days integer,                  -- null = 不過期
  effective_from timestamptz not null default now()
);

-- 點數帳本（只追加）
create table point_ledger (
  id bigint generated always as identity primary key,
  member_id uuid not null references members(id),
  brand_id uuid not null references brands(id),
  delta integer not null,               -- 正=得點、負=扣點
  reason text not null,                 -- 'visit','redeem','expire','adjust','survey'
  ref_type text,                        -- 'visit','coupon',...
  ref_id text,
  expires_at timestamptz,
  created_at timestamptz default now(),
  created_by uuid
);
create index on point_ledger (member_id, brand_id);

-- 優惠券範本
create table coupon_templates (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id),
  name text not null,
  kind text not null,                   -- 'amount_off' | 'percent_off' | 'free_item'
  value integer,                        -- 折抵金額或百分比
  item_note text,                       -- free_item 說明
  min_spend integer default 0,
  valid_days integer not null,          -- 發放後有效天數
  trigger text not null,                -- 'manual'|'signup'|'birthday'|'points_redeem'
  points_cost integer,                  -- trigger=points_redeem 時必填
  per_member_limit integer,             -- null = 不限
  is_active boolean default true
);

-- 已發放的券
create table coupons (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references coupon_templates(id),
  member_id uuid not null references members(id),
  brand_id uuid not null references brands(id),
  status text not null default 'issued', -- issued / redeemed / expired / void
  issued_at timestamptz default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_store_id uuid references stores(id),
  redeemed_by uuid,
  issue_ref text,                       -- 例：'birthday:2026' 用於防重複發放
  unique (template_id, member_id, issue_ref)
);

-- 標籤
create table tags (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id),
  name text not null,
  kind text not null default 'manual',  -- 'auto' | 'manual'
  unique (brand_id, name)
);
create table member_tags (
  member_id uuid references members(id),
  tag_id uuid references tags(id),
  source text,                          -- 'rule:dormant_30d','staff','import'
  created_at timestamptz default now(),
  primary key (member_id, tag_id)
);

-- 推播紀錄
create table push_campaigns (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id),
  title text not null,
  segment jsonb not null,               -- 例：{"include_tags":[...],"exclude_tags":[...]}
  message jsonb not null,               -- LINE message objects
  status text default 'draft',          -- draft / scheduled / sending / sent / failed
  scheduled_at timestamptz,
  sent_count integer default 0,
  created_by uuid,
  created_at timestamptz default now()
);
```

**RLS 原則**
- 會員端（LIFF）不直接打資料表，一律經 Edge Function／API 驗證 ID token 後代為讀寫。
- 店員端依現有權限系統的角色；店員只能為自己所屬門市寫入 `visits` 與核銷 `coupons`。
- `point_ledger` 禁止 update / delete（以 trigger 或 RLS 封鎖），更正一律寫一筆 `adjust`。

---

## 4. 消費記錄：三種模式

先定義共用介面，所有來源最後都呼叫同一個函式：

```ts
recordVisit({
  brandId, storeId, memberId,
  amount,                 // 整數，新台幣
  source,                 // 'staff_scan' | 'pos' | 'receipt_claim'
  externalRef,            // 冪等鍵
  occurredAt,
  createdBy?              // 店員 id
}) -> { visitId, pointsEarned, duplicated: boolean }
```

`recordVisit` 負責：寫入 `visits`（衝突即回傳 duplicated）、依當期 `point_rules` 計算並寫入 `point_ledger`、觸發自動標籤更新。整段在同一個 transaction（用 Postgres function 實作）。

| 模式 | 流程 | 何時用 |
|---|---|---|
| **A. 店員掃會員 QR**（P0 必做） | 會員 LIFF 顯示動態 QR（簽章 token，60 秒失效）→ 店員 app 掃描 → 輸入金額（或選擇 POS 單號）→ `recordVisit` | POS 未串接前的預設方案 |
| **B. POS 串接** | POS webhook／定時拉單 → 以手機或會員碼對應會員 → `recordVisit`（externalRef = POS 訂單號） | POS 品牌確認且有 API 時 |
| **C. 收據 QR 自助領點** | POS 收據印出含訂單號＋HMAC 的 QR → 客人用 LIFF 掃 → 驗簽、一次性 → `recordVisit` | POS 能自訂收據 QR 但沒有會員對應 API 時 |

**動態 QR 規格（模式 A）**
- Payload：`{ mid, bid, iat, exp, nonce }`，以伺服器私鑰簽 JWT（HS256 可，密鑰存 Vercel/Supabase secrets）。
- `exp - iat = 60s`；LIFF 每 30 秒自動刷新。
- 店員端驗簽、檢查過期、記錄 nonce 防重放（nonce 表保留 10 分鐘即可）。
- 金額異常防護：單筆金額超過門檻（預設 3,000）需二次確認；同會員 10 分鐘內第二筆跳警示。

**POS adapter（模式 B／C）**：只定義介面與一個 `mock` 實作，等用戶確認 POS 後再寫真正的 adapter。

```ts
interface PosAdapter {
  name: string;
  fetchOrders(since: Date): Promise<PosOrder[]>;   // 或改由 webhook 推送
  resolveMember(order: PosOrder): Promise<string | null>; // 回傳 member_id
}
```

---

## 5. 會員端（LIFF）頁面

| 路由 | 內容 |
|---|---|
| `/join` | LIFF 登入 → 後端驗 ID token 取 UID → 表單（姓名、手機、生日、同意條款）→ 建檔 → 觸發入會禮 → 寫入 `join_source`（從 URL 參數 `?src=` 取得） |
| `/card` | 會員動態 QR、點數餘額、即將到期點數 |
| `/coupons` | 可用券列表（含到期日）、已使用／已過期分頁；點券顯示核銷用 QR |
| `/redeem` | 點數兌換券（列出 `trigger=points_redeem` 的範本） |
| `/history` | 消費與點數紀錄 |

- 手機驗證（SMS OTP）**P0 不做**，`phone_verified=false`；是否要做由用戶決定（見第 10 節）。
- 生日一經填寫，會員端不可自行修改（防止反覆領生日券），需由店員端修改並留紀錄。
- 優惠券核銷：會員出示券 QR（同樣為短效簽章 token，含 coupon_id），店員掃描核銷；server 端以 `update ... where status='issued'` 條件更新確保不重複核銷。

---

## 6. 店員端（整合進既有內部 app）

- 掃描頁：自動判斷 QR 種類（會員卡 → 記消費；優惠券 → 核銷）。
- 會員查詢：以手機末碼／姓名查詢，看點數、券、最近消費、標籤；可手動加標籤、手動調整點數（必填原因，寫 `adjust`）。
- 所有店員操作記錄 `created_by` / `redeemed_by`。

---

## 7. 排程任務（pg_cron 或 Vercel Cron）

| 任務 | 頻率 | 說明 |
|---|---|---|
| 生日券發放 | 每日 09:00（Asia/Taipei） | 當日生日的會員發券，`issue_ref = 'birthday:YYYY'` 防重複 |
| 點數到期 | 每日 03:00 | 到期點數寫負數 ledger（reason=`expire`） |
| 優惠券過期 | 每日 03:00 | `issued` 且已過期改 `expired` |
| 自動標籤 | 每日 04:00 | 見下表 |
| 封鎖同步 | 即時（webhook `unfollow` 事件） | `member_brands.status='blocked'`，推播時排除 |

**P0 自動標籤規則**（每品牌各自計算）
| 標籤 | 規則 |
|---|---|
| `新會員` | 加入 ≤ 14 天 |
| `常客` | 近 30 天消費 ≥ 4 次 |
| `沉睡_30` | 曾消費、但近 30 天無消費 |
| `沉睡_60` | 曾消費、但近 60 天無消費 |
| `未首購` | 已綁定但從未消費 |
| `來源:<src>` | 依 `join_source` |

門檻值寫成設定，不要寫死在程式裡。

---

## 8. 分眾推播

- 後台建立 campaign：選品牌 → 標籤組合（include／exclude）→ 預覽人數 → 編輯訊息 → 立即或排程發送。
- 發送用 Messaging API multicast（每次最多 500 個 UID，分批發送），自動排除 `blocked` 會員。
- **推播會消耗 LINE OA 的訊息額度**：送出前顯示預計消耗則數，超過設定門檻需二次確認。
- 記錄 `sent_count` 與失敗明細。

---

## 9. 數據儀表板（P0 指標）

| 指標 | 定義 |
|---|---|
| 會員總數／本週新增 | `member_brands` 計數 |
| 綁定轉換率 | 綁定會員數 ÷ OA 好友數（好友數由 Messaging API 統計取得） |
| 首購率 | 有 ≥1 筆消費的會員 ÷ 會員總數 |
| 30 天回購率 | 近 30 天消費 ≥2 次的會員 ÷ 近 30 天有消費的會員 |
| 平均回訪間隔 | 同會員相鄰兩次消費的天數中位數 |
| 券核銷率 | 依範本分別計算：已核銷 ÷ 已發放 |
| 點數流通 | 本期發出／兌換／到期 |
| 會員消費占比 | 會員消費金額 ÷ 門市總營收（需 POS 或手動輸入營收） |

---

## 10. 待用戶決定（CC 遇到時停下來問，不要自行決定）

1. **POS 品牌與是否有 API**：決定模式 B／C 是否可行。
2. **會員系統放在哪個 LINE 官方帳號**：GROUN:D 客服 OA？與統一收件匣、DD 是否共用 channel？
3. **集點比例與點數效期**：每消費多少元得 1 點？點數是否會過期？
4. **入會禮、生日禮內容**：券種與面額。
5. **手機 OTP 驗證**：要不要做？（SMS 每則有成本，但可以防止假資料與重複帳號）
6. **A Beach 何時接入**：P0 只開 GROUN:D，或兩個品牌同時上線。

---

## 11. 法規備註（P1/P2 前必須確認，CC 不得自行實作）

- **付費預售餐券／訂閱制**：餐飲業販售預付型禮券通常需要提供履約保證（信託、銀行保證等）。須經會計師或律師確認方案後才能開發。免費發放的優惠券不受此限制。
- **抽獎類活動**：須符合公平交易委員會對贈品、贈獎額度的規範。此為本期不做遊戲的原因之一。
- **個資**：綁定頁必須有個資蒐集告知與同意勾選，並提供會員刪除資料的管道。

---

## 12. 驗收清單（P0 完成定義）

- [ ] 新客從掃門市 QR 到完成綁定 ≤ 30 秒，並自動收到入會禮券
- [ ] 店員掃會員 QR 記消費 ≤ 10 秒；同一 token 重掃會被拒絕
- [ ] 同一筆消費重送兩次只給一次點數
- [ ] 優惠券在兩台裝置同時核銷，只有一台成功
- [ ] 生日券每人每年只發一次
- [ ] 點數到期正確寫入 ledger，餘額與 ledger 加總一致
- [ ] 封鎖 OA 的會員不會收到推播
- [ ] 儀表板數字可以從原始表手動 SQL 重算驗證
- [ ] 所有 migration 可在乾淨的 Supabase 專案上從零跑完
- [ ] 每一個 API 端點都有驗證 LINE ID token 或店員身分

---

## 13. 建議的開發順序

1. 盤點既有 repo、LINE channel、webhook → 回報用戶並取得確認
2. Schema migration ＋ RLS ＋ `recordVisit` Postgres function ＋ 單元測試
3. LIFF `/join`、`/card`（動態 QR）
4. 店員端掃描 → 記消費（模式 A）
5. 優惠券範本／發放／核銷 ＋ 入會禮
6. 點數兌換、`/history`
7. 排程（生日、到期、自動標籤）
8. 推播後台
9. 儀表板
10. 驗收清單逐項測試 → PR（附 Vercel preview，等用戶回覆「merge」）
