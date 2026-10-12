-- 🎡 GROUN:D 會員 第二批：轉盤（v4.70.84，2026-10-12）｜docs/MEMBER_PLAN_v1.md 分歧 G～K 照 CC 建議
-- 伺服器抽獎、固定獎池槽位（一槽一列，抽到就扣，缺貨不補）、資格＝唯一鍵（入會 1 抽 join:<member>、每次入點 1 抽 visit:<visit>）、
-- 同一資格重送回原結果、獎品只給點數／券、每人全年中獎市值上限（cfg，預設 900）超過就只給銘謝惠顧。
-- 執行方式同 0001：Supabase → SQL Editor 貼上按 Run（可重跑）。

create table if not exists member_campaigns (
  id uuid primary key default gen_random_uuid(),
  brand text not null default 'gd',
  name text not null,
  type text not null default 'wheel',              -- wheel | slot（拉霸之後當第二種皮膚）
  status text not null default 'draft',            -- draft | active | paused | ended
  start_at timestamptz,
  end_at timestamptz,
  rules jsonb not null default '{}'::jsonb,        -- { joinDraw:true, visitDraw:true, minAmount:0, couponDays:30, note:'活動說明' }
  prizes jsonb not null default '[]'::jsonb,       -- 建立時的獎項快照 [{idx,name,kind:pts|coupon|none,pts,value,count}]
  version integer not null default 1,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists member_slots (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references member_campaigns(id),
  pidx integer not null,                           -- 對應 prizes[].idx（前端轉盤格子）
  taken_by uuid references members(id),
  taken_at timestamptz
);
create index if not exists member_slots_free on member_slots (campaign_id) where taken_by is null;
create table if not exists member_draws (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references member_campaigns(id),
  member_id uuid not null references members(id),
  right_key text not null unique,                  -- join:<member> / visit:<visit>
  pidx integer,
  prize jsonb,                                     -- 抽到的獎項快照（含 capped:true＝超過全年上限改銘謝惠顧）
  coupon_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists member_draws_member on member_draws (member_id, created_at desc);
alter table member_campaigns enable row level security;
alter table member_slots enable row level security;
alter table member_draws enable row level security;

-- 抽一次：鎖會員 → 資格沒用過 → 活動進行中 → 隨機拿一個空槽鎖住 → 全年上限檢查 → 寫 draw、發點數／券 → 回結果；重送同 right_key 回原結果
create or replace function member_draw(p_member uuid, p_campaign uuid, p_right text, p_year_cap integer)
returns json language plpgsql security definer as $$
declare c record; s record; d record; pz jsonb; v_year int; v_coupon uuid; v_capped boolean := false; v_days int;
begin
  perform pg_advisory_xact_lock(hashtext(p_member::text));
  select * into d from member_draws where right_key = p_right;
  if found then return json_build_object('ok', true, 'dup', true, 'drawId', d.id, 'pidx', d.pidx, 'prize', d.prize); end if;
  select * into c from member_campaigns where id = p_campaign;
  if not found or c.status <> 'active' then return json_build_object('ok', false, 'error', '活動不在進行中'); end if;
  if (c.start_at is not null and now() < c.start_at) or (c.end_at is not null and now() >= c.end_at) then return json_build_object('ok', false, 'error', '不在活動期間'); end if;
  select * into s from member_slots where campaign_id = p_campaign and taken_by is null order by random() limit 1 for update skip locked;
  if not found then return json_build_object('ok', false, 'error', '獎池已經抽完了'); end if;
  select p into pz from jsonb_array_elements(c.prizes) p where (p->>'idx')::int = s.pidx limit 1;
  if pz is null then pz := '{"name":"銘謝惠顧","kind":"none"}'::jsonb; end if;
  -- 全年中獎市值上限（機會中獎 ≤1,000 免列單；系統壓 900）
  select coalesce(sum((prize->>'value')::int), 0) into v_year from member_draws where member_id = p_member and created_at >= date_trunc('year', now()) and (prize->>'kind') <> 'none';
  if (pz->>'kind') <> 'none' and v_year + coalesce((pz->>'value')::int, 0) > p_year_cap then
    v_capped := true; pz := jsonb_build_object('name', '銘謝惠顧', 'kind', 'none', 'capped', true, 'orig', pz->>'name');
  else
    update member_slots set taken_by = p_member, taken_at = now() where id = s.id;
  end if;
  insert into member_draws (campaign_id, member_id, right_key, pidx, prize) values (p_campaign, p_member, p_right, s.pidx, pz) returning * into d;
  if (pz->>'kind') = 'pts' and coalesce((pz->>'pts')::int, 0) > 0 then
    insert into member_pts (member_id, kind, pts, ref, idem_key, note) values (p_member, 'game', (pz->>'pts')::int, d.id::text, 'draw:' || d.id, c.name || '：' || (pz->>'name'));
  elsif (pz->>'kind') = 'coupon' then
    v_days := coalesce((c.rules->>'couponDays')::int, 30);
    insert into member_coupons (member_id, kind, name, value, status, issue_key, expires_at, note)
      values (p_member, 'game', pz->>'name', coalesce((pz->>'value')::int, 0), 'issued', 'draw:' || d.id, now() + (v_days || ' days')::interval, c.name) returning id into v_coupon;
    update member_draws set coupon_id = v_coupon where id = d.id;
  end if;
  return json_build_object('ok', true, 'drawId', d.id, 'pidx', d.pidx, 'prize', pz, 'couponId', v_coupon, 'capped', v_capped);
end $$;

-- 券核銷（店員）：條件更新，兩台同時只有一台成功
create or replace function member_coupon_use(p_coupon uuid, p_by text, p_ref text)
returns json language plpgsql security definer as $$
declare r record;
begin
  update member_coupons set status = 'redeemed', redeemed_at = now(), redeemed_by = p_by, order_ref = p_ref
    where id = p_coupon and status = 'issued' and (expires_at is null or expires_at > now()) returning * into r;
  if not found then
    select * into r from member_coupons where id = p_coupon;
    if not found then return json_build_object('ok', false, 'error', '找不到這張券'); end if;
    return json_build_object('ok', false, 'error', case when r.status = 'redeemed' then '這張券已經用過了（' || to_char(r.redeemed_at at time zone 'Asia/Taipei', 'MM/DD HH24:MI') || ' ' || coalesce(r.redeemed_by, '') || '）' when r.expires_at <= now() then '這張券已過期' else '這張券不能用（' || r.status || '）' end);
  end if;
  return json_build_object('ok', true, 'name', r.name, 'memberId', r.member_id);
end $$;
