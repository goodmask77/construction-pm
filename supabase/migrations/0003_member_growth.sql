-- 🚀 GROUN:D 會員 第四批：任務闖關／一層推薦／跨店（GD↔AB）折抵與結算／問卷（v4.70.95，2026-10-12 張良「幹吧」）
-- 執行方式同前：Supabase → SQL Editor 貼上按 Run（可重跑）。

alter table member_visits  add column if not exists store text not null default 'gd';   -- 在哪家店消費（gd／ab／之後的聯盟店代號）
alter table member_pts     add column if not exists store text not null default 'gd';   -- 這筆點數在哪家店發生（earn＝發點店、spend＝用點店）
alter table member_coupons add column if not exists store text;                          -- 在哪家店核銷
alter table members        add column if not exists ref_by uuid references members(id); -- 推薦人（一層，只能綁一次）
create index if not exists member_visits_store on member_visits (store, created_at desc);
create index if not exists member_pts_store on member_pts (store, created_at desc);

-- 推薦：被推薦人一人只能被綁一次；完成＝被推薦人第一筆有效消費
create table if not exists member_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references members(id),
  referee_id uuid not null unique references members(id),
  status text not null default 'pending',           -- pending | done | void
  first_visit_id uuid,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists member_referrals_referrer on member_referrals (referrer_id, status);

-- 任務完成紀錄（同一人同一任務同一期間只算一次）
create table if not exists member_missions_done (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id),
  mission_id text not null,
  period text not null default '',                  -- 月任務＝YYYY-MM；一次性＝''；滾動 30 天＝起算日
  idem_key text not null unique,                    -- m:<mission>:<member>:<period>
  pts integer not null default 0,
  coupon_id uuid,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists member_missions_done_member on member_missions_done (member_id, created_at desc);

-- 用餐問卷（好評壞評一樣給點）
create table if not exists member_surveys (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id),
  store text not null default 'gd',
  score integer,
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists member_surveys_member on member_surveys (member_id, created_at desc);

alter table member_referrals enable row level security;
alter table member_missions_done enable row level security;
alter table member_surveys enable row level security;
