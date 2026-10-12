-- 🪪 GROUN:D 自建會員 第一批（v4.70.83，2026-10-12）｜docs/MEMBER_PLAN_v1.md
-- 三家 AI 共識：會員／消費／點數／券開「真表」（不走 pm_documents KV），點數只追加＋冪等鍵，餘額用 view。
-- 執行方式：Supabase → SQL Editor 貼上整段按 Run（可重跑：全部 if not exists / or replace）。
-- 權限：全部開 RLS 且不建任何 policy＝只有伺服器的 service role 能讀寫；客人（LIFF）與店員都經 api/_member.js 驗身分後代為讀寫。

create extension if not exists pgcrypto;

create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  brand text not null default 'gd',
  mno text unique,                                 -- 會員號碼（6 碼，店員手輸用）
  name text,
  phone text,
  pic text,
  birthday date,
  src text,                                        -- line | staff
  consent_ver text,
  consent_at timestamptz,
  status text not null default 'active',           -- active | left | blocked
  note text,                                       -- 店家內部備註（客人看不到）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists members_brand_phone on members (brand, phone);
create index if not exists members_brand_name on members (brand, name);

create table if not exists member_identities (
  provider text not null,                          -- line:<channel>（同 Provider 的 LINE userId）
  line_uid text not null,
  member_id uuid not null references members(id),
  created_at timestamptz not null default now(),
  primary key (provider, line_uid)
);
create index if not exists member_identities_member on member_identities (member_id);

create table if not exists member_visits (
  id uuid primary key default gen_random_uuid(),
  brand text not null default 'gd',
  member_id uuid references members(id),
  amount integer not null check (amount >= 0),
  source text not null,                            -- staff | grporder | pos | receipt
  external_ref text,                               -- 冪等：pos:<單號> / req:<店員請求id> / grp:<訂單id>:<pid>
  by_name text,
  note text,
  created_at timestamptz not null default now(),
  unique (source, external_ref)
);
create index if not exists member_visits_member on member_visits (member_id, created_at desc);

create table if not exists member_pts (
  id bigint generated always as identity primary key,
  brand text not null default 'gd',
  member_id uuid not null references members(id),
  kind text not null,                              -- earn | spend | reverse | adjust | game | welcome
  pts integer not null,
  amount integer,
  ref text,
  idem_key text unique,                            -- 同一來源只入一次
  by_name text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists member_pts_member on member_pts (member_id, created_at desc);

create table if not exists member_coupons (
  id uuid primary key default gen_random_uuid(),
  brand text not null default 'gd',
  member_id uuid not null references members(id),
  kind text not null,                              -- reward | welcome | game
  name text not null,                              -- 名稱與價值在發放時快照，之後改設定不影響
  value integer,
  pts_cost integer,
  status text not null default 'issued',           -- issued | redeemed | expired | void
  issue_key text unique,
  expires_at timestamptz,
  redeemed_at timestamptz,
  redeemed_by text,
  order_ref text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists member_coupons_member on member_coupons (member_id, status);

create or replace view member_balance as
  select member_id, coalesce(sum(pts), 0)::int as balance,
         coalesce(sum(case when pts > 0 then pts else 0 end), 0)::int as earned,
         coalesce(sum(case when pts < 0 then -pts else 0 end), 0)::int as used
  from member_pts group by member_id;

-- 兌換（櫃檯當場扣點＋發券＝直接核銷）：同一交易內鎖會員、驗餘額、寫流水、寫券；重送同 idem 回原結果
create or replace function member_redeem(p_member uuid, p_name text, p_value integer, p_pts integer, p_idem text, p_by text)
returns json language plpgsql security definer as $$
declare v_bal int; v_coupon uuid; v_exist record;
begin
  perform pg_advisory_xact_lock(hashtext(p_member::text));
  select * into v_exist from member_pts where idem_key = p_idem;
  if found then
    select id into v_coupon from member_coupons where issue_key = p_idem;
    return json_build_object('ok', true, 'dup', true, 'couponId', v_coupon);
  end if;
  select coalesce(sum(pts),0) into v_bal from member_pts where member_id = p_member;
  if v_bal < p_pts then return json_build_object('ok', false, 'error', '點數不足（目前 ' || v_bal || ' 點）'); end if;
  insert into member_pts (member_id, kind, pts, ref, idem_key, by_name, note) values (p_member, 'spend', -p_pts, 'redeem', p_idem, p_by, p_name);
  insert into member_coupons (member_id, kind, name, value, pts_cost, status, issue_key, redeemed_at, redeemed_by)
    values (p_member, 'reward', p_name, p_value, p_pts, 'redeemed', p_idem, now(), p_by) returning id into v_coupon;
  return json_build_object('ok', true, 'couponId', v_coupon, 'balance', v_bal - p_pts);
end $$;

alter table members enable row level security;
alter table member_identities enable row level security;
alter table member_visits enable row level security;
alter table member_pts enable row level security;
alter table member_coupons enable row level security;
