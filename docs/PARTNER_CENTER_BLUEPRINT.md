# 夥伴中心 架構藍圖 v1

> 目標：在**同一個 App**（construction-pm）內，做一個給**所有夥伴**使用的內部入口：找到內外場所需資料 + 360 評鑑（基層最重要）+ 遊戲化（闖關/投票）+ 內部點數/獎勵兌換 + 回饋。
> 原則：同 App、同後端（一個 D 哥讀得到全部、一套登入）；但**專屬模組**（不套工程版外觀）；敏感/多人資料一律**正規資料表 + 真實登入 + RLS**（不塞 JSON 大包）。

---

## 0. 全局定位

| | 工程專案 / 團隊工作（現有） | 夥伴中心（新） |
|---|---|---|
| 對象 | 管理層（PM） | **全體夥伴（基層為主）** |
| 模型 | 大項→細項→工序→成本 | 人、評鑑、點數、獎勵、知識庫 |
| 畫面 | 現有共用元件 | **全新專屬頁面** |
| 資料 | `pm_documents` JSON 包（沿用） | **正規資料表（新）** |
| 登入 | 輕量（選名字） | **真實 Supabase Auth** |

- 加一個空間「**夥伴中心**」（id 建議 `crew`）到現有切換器。
- 它的分頁是專屬的：`首頁 / 資料庫 / 360評鑑 / 闖關任務 / 投票 / 點數錢包 / 獎勵商城 / 回饋`。
- 共用：空間切換器、登入、D 哥助理。**不共用**工程版的總覽/工序/成本。

---

## 1. 地基：登入與身分（一定要先做）

### Supabase Auth
- 採用 Supabase Auth（email + 密碼起手）。基層夥伴若無 email：可由管理員建帳號（email + 臨時密碼），或之後加 LINE 登入（進階，先不做）。
- 前端改用 `supabase.auth`（signIn/out、session、onAuthStateChange）。

### `profiles` 表（每個使用者一列）
```sql
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  role        text not null default 'staff',   -- staff | lead | manager | admin
  department  text,                              -- 內場 | 外場 | 管理 | ...
  store       text,                              -- 分店（未來多店用）
  avatar_url  text,
  line_user_id text,                             -- 綁 LINE → D 哥認得人
  active      boolean default true,
  created_at  timestamptz default now()
);
```
- **角色**：`staff`(基層) / `lead`(組長) / `manager`(店長/管理) / `admin`(你)。權限以此為據。

### 安全清理（順手）
- 把目前寫死在前端的 `LINE_API_KEY` 移到後端（webhook 已是後端，App 不該帶）。
- service role 金鑰只在後端，永不進前端/git。

---

## 2. 各功能資料表（一筆一列，正規化）

> 全部開在 Supabase（不進 `pm_documents`）。檔案類放 Supabase Storage。

### 2.1 資料庫 / 知識庫（最先做，最快見效）
```sql
create table kb_docs (
  id bigint generated always as identity primary key,
  category   text,            -- 內場 | 外場 | 通用 | 教育訓練 ...
  title      text not null,
  kind       text,            -- file | link | text | video
  url        text,            -- 檔案/連結
  content    text,            -- kind=text 時的內文
  tags       text[],
  pinned     boolean default false,
  updated_by uuid references profiles(id),
  updated_at timestamptz default now()
);
```
- 用途：SOP、手冊、教學影片、表單。**全員可讀、管理可編**。

### 2.2 360 評鑑（核心）
```sql
create table review_cycles (              -- 一輪評鑑（例：2026 Q2）
  id bigint generated always as identity primary key,
  name text, period_start date, period_end date,
  status text default 'draft',            -- draft | open | closed
  min_reviewers int default 3,            -- 少於此人數不顯示結果(保護匿名)
  created_at timestamptz default now()
);
create table review_dimensions (          -- 評分面向（可調）
  id bigint generated always as identity primary key,
  cycle_id bigint references review_cycles(id),
  label text, weight numeric default 1, sort int default 0
);
create table reviews (                    -- 一筆「誰評誰」
  id bigint generated always as identity primary key,
  cycle_id bigint references review_cycles(id),
  reviewer_id uuid references profiles(id),
  reviewee_id uuid references profiles(id),
  relation text,                          -- self | peer | lead | subordinate
  submitted_at timestamptz,
  unique (cycle_id, reviewer_id, reviewee_id)
);
create table review_scores (              -- 各面向分數+評語
  id bigint generated always as identity primary key,
  review_id bigint references reviews(id) on delete cascade,
  dimension_id bigint references review_dimensions(id),
  score int,                              -- 1..5
  comment text
);
```

### 2.3 闖關 / 任務（遊戲化）
```sql
create table quests (
  id bigint generated always as identity primary key,
  title text, description text,
  kind text,                  -- checklist | training | milestone
  points int default 0,       -- 完成可得點數
  active boolean default true,
  created_by uuid references profiles(id)
);
create table quest_progress (
  id bigint generated always as identity primary key,
  quest_id bigint references quests(id),
  user_id uuid references profiles(id),
  status text default 'in_progress',   -- in_progress | submitted | approved | rejected
  evidence jsonb,                       -- 文字/照片
  approved_by uuid references profiles(id),
  completed_at timestamptz,
  unique (quest_id, user_id)            -- 同一關不能重複領
);
```

### 2.4 投票
```sql
create table polls (
  id bigint generated always as identity primary key,
  title text, description text,
  kind text default 'single',   -- single | multi | ranking
  options jsonb,                 -- [{id,label}]
  starts timestamptz, ends timestamptz,
  anonymous boolean default true,
  eligible_roles text[],         -- 誰能投
  reward_points int default 0    -- 投票可得點數(鼓勵參與)
);
create table votes (
  id bigint generated always as identity primary key,
  poll_id bigint references polls(id),
  voter_id uuid references profiles(id),
  choice jsonb, ts timestamptz default now(),
  unique (poll_id, voter_id)     -- 一人一票(防灌票)
);
```

### 2.5 點數（內部金流）—— 防作弊核心
```sql
create table point_ledger (        -- 只新增、不修改不刪除(可稽核)
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id),
  delta int not null,              -- +得分 / -扣點
  reason text,
  ref_type text,                   -- quest | poll | review | redeem | manual
  ref_id bigint,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);
-- 餘額 = select sum(delta) from point_ledger where user_id = ?
```
- **防作弊四原則**：
  1. **帳本只進不出**：永不 update/delete，更正＝再記一筆相反方向（RLS 禁止 client update/delete）。
  2. **發點只走伺服器邏輯**：client 不能直接 insert 加點；經 Supabase RPC / Edge Function（`SECURITY DEFINER`）驗證後才發（例：闖關要組長核可、非自核）。
  3. **每筆都有來源**：`ref_type/ref_id` → 可追到是哪關/哪票/哪次兌換，且**同來源不可重複領**（唯一鍵）。
  4. **人工調整要 admin + 理由**，自動入帳本留痕；定期對帳 `餘額 == sum(帳本)`。

### 2.6 獎勵商城 + 兌換
```sql
create table rewards (
  id bigint generated always as identity primary key,
  name text, description text, cost_points int,
  stock int, active boolean default true, image_url text
);
create table redemptions (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id),
  reward_id bigint references rewards(id),
  cost_points int, status text default 'requested', -- requested|approved|fulfilled|rejected
  requested_at timestamptz default now(),
  handled_by uuid references profiles(id)
);
```
- 兌換＝一個 RPC 內**原子操作**：檢查餘額足夠 → insert redemption → insert point_ledger(-cost)。餘額不足直接拒。

### 2.7 回饋
```sql
create table feedback (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id),   -- 可為 null = 匿名
  category text, content text,
  status text default 'new',              -- new | reviewing | done
  response text, created_at timestamptz default now()
);
```

---

## 3. 權限 / 角色（RLS 重點）

| 能力 | staff 基層 | lead 組長 | manager 管理 | admin |
|---|---|---|---|---|
| 讀資料庫 | ✓ | ✓ | ✓ | ✓ |
| 編資料庫 | – | 部分 | ✓ | ✓ |
| 寫自己的評鑑 | ✓ | ✓ | ✓ | ✓ |
| 看「別人評我」的彙總 | ✓(自己) | ✓(團隊) | ✓(範圍) | ✓ |
| 看評鑑原始(含評分者) | – | – | – | ✓(查弊用,留痕) |
| 闖關/投票 | ✓ | ✓ | ✓ | ✓ |
| 核可闖關、發小點數 | – | ✓ | ✓ | ✓ |
| 開評鑑輪/任務/投票/獎勵 | – | – | ✓ | ✓ |
| 看自己點數/帳本 | ✓ | ✓ | ✓ | ✓ |
| 人工調點數 | – | – | – | ✓ |

- RLS 範例原則：
  - `reviews/review_scores`：只有 `reviewer_id = auth.uid()`（自己寫的）或 admin 能讀原始列。
  - **彙總**給 reviewee 看時，透過 **view / RPC** 回傳「各面向平均 + 匿名評語」，**不帶評分者身分**。
  - `point_ledger`：只有 `user_id = auth.uid()` 或 admin 能讀；**無人可 update/delete**。
  - 發點/兌換：client 無 insert 權，只能呼叫 RPC。

---

## 4. 360 評鑑：流程與匿名設計

1. **管理開一輪**（period + 面向 + 誰評誰）。誰評誰可自動產生：每人評「同組同事 + 自己(self) + 直屬主管(lead)」，主管加評「下屬(subordinate)」。
2. **每人收到待評清單** → 逐人、逐面向打分(1–5) + 留言。
3. **匿名**：系統**存評分者身分**（用於追蹤誰還沒交、防濫用），但對 reviewee **完全隱藏**。reviewee 只看到：
   - 各面向**平均分** + **分佈**；
   - **匿名評語**（可依關係分組顯示：來自同事 / 主管）。
4. **360 洞察**：把「自評」對比「他評平均」→ 看到自我認知落差（這就是 360 的價值）。
5. **保護匿名**：評分人數 < `min_reviewers`（預設3）→ 不顯示結果，避免被反推是誰。
6. **查弊**：只有 admin 能去匿名，且去匿名動作留痕（記到稽核）。

---

## 5. 分階段路線圖（先地基、再長功能）

| 階段 | 內容 | 產出 |
|---|---|---|
| **P0 地基** | Supabase Auth + `profiles`/角色 + 登入 UI + RLS 底線；移除前端寫死金鑰 | 全員能登入、權限有底 |
| **P1 資料庫** | `kb_docs` + 知識庫頁（分類/搜尋/上傳/釘選） | 大家馬上有東西用、最快見效 |
| **P2 360評鑑** | cycles/dimensions/reviews/scores + 填寫頁 + 匿名彙總頁 | 基層最重要的制度上線 |
| **P3 點數+闖關** | `point_ledger`(RPC發點) + quests + 錢包頁 | 內部金流地基 + 遊戲化起步 |
| **P4 投票+獎勵** | polls/votes + rewards/redemptions(原子兌換) | 參與感 + 兌換閉環 |
| **P5 回饋 + D哥整合** | feedback + 讓 D 哥讀「彙總(非敏感原始)」做提醒 | 回饋機制 + 智能助理串起來 |

- 每階段＝自己的表 + 頁面 + RLS，**獨立上線**、可逐步驗收。

---

## 6. 技術注意
- 這些表用 **supabase-js 直接查**（新的資料層），跟現有 `window.storage`（JSON 包）並存、互不影響。工程版照舊。
- **行動優先**：基層都用手機，頁面以手機為主要版型。
- **D 哥**：只讀**彙總/非敏感**資料做提醒（如「本週闖關完成率」「評鑑未交名單」），不直接讀個別敏感評語。
- 多店未來：`profiles.store` 已預留，之後用 RLS 依分店隔離。

---

## 7. 待你拍板的設計決策
1. **登入方式**：先 email+密碼（管理建帳號）？還是要等做 LINE 登入？
2. **角色層級**：staff/lead/manager/admin 這四層夠嗎？要不要「跨店督導」？
3. **360 對象**：同組互評的「組」怎麼定義（用 department？還是另設 team）？
4. **匿名強度**：評語完全匿名，還是主管看得到下屬是誰？
5. **點數來源與匯率**：哪些行為給幾點？多少點換什麼？（先抓個草案再調）

> 決定 1～5 後，就從 **P0 地基（Auth + profiles + RLS）** 開工。

---

## 8. 回饋制度（核心精神：用系統解決人性）v1.1 追加

> 痛點：互相理解很難、正向有建設性的回饋太少、人性會忘記/懶得做。
> 解法：**靠機制不靠意志力**，把回饋變輕量、可累積、有正向循環與排名。

### 回饋型態
- **系統週期性回饋**：定期觸發（每週/每月）提醒互評。
- **主動回饋（具名 / 匿名）**：隨時可給。
- **選擇誰對誰**：避免立場衝突/不方便時，可指定對象或迴避。
- **情境式提問**：系統依近期事件自動出題（「上週那個提案，你覺得○○的表達？」）降低空白焦慮。

### 輕量化
- **快速貼標**：不打字，直接選標籤（正向：服務暖心/救火英雄/執行力強…；建設性：多確認細節/提早備料…）。
- **+1 時刻**：看到好事 30 秒記下，累積成回饋素材。

### 正向循環（Meta 層）
- **回饋的回饋**：收到的人按「這有幫到我 👍」→ **給予者得積分** → 形成循環、產生「回饋王」。
- **回饋品質分**：不是給就有分，要「有建設性/被按讚」才高分，避免灌水。

### 遊戲化強化
- **連續回饋 streak**：連續 N 天有給回饋 → 額外獎勵。
- **配對解鎖**：互相給過回饋 → 解鎖「互相理解」成就，關係可視化。

### 排行榜
- 回饋王（給出最多被肯定的回饋）、人氣王（收到最多）、各項投票王、積分王。

### 積分草案（可調）
- 給一則回饋 +2、收到一則 +1、你的回饋被按「幫到我」+5、被選為某週/某項王 +獎勵。
- 積分 → 兌換獎勵（P4 商城）。

### 分波實作順序
1. **回饋制度 + 積分 + 排行榜**（核心，先做）
2. 闖關任務
3. 投票（含各項投票王）
4. 兌換商城（rewards/redemptions）
5. 情境提問 / streak / 配對解鎖 / 品質分（強化）
