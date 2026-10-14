-- GD 資料庫（restaurant-pm）同步橋地基 v4（關卡 2 第二輪後）：只加不改，pm_documents 本體與既有程式都不動
-- 修正：①閘門不信任 editor 欄位，改用「可信同步上下文」（只有 security definer RPC 會設）②lock 有 owner/epoch 做 fencing
--      ③outbox 領取用 lease token＋CAS done ④一致讀取函式回 (key, current_rev, payload, deleted) ⑤反向改整包投影 RPC＋event_id 冪等

create table if not exists public.pm_rev (
  key text primary key,
  rev bigint not null default 0,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.pm_outbox (
  id bigserial primary key,
  key text not null,
  op text not null check (op in ('I','U','D')),
  rev bigint not null,
  editor text,
  origin text not null default 'gd',
  state text not null default 'new' check (state in ('new','claimed','done','error')),
  at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  worker text,
  done_at timestamptz,
  error text
);
create index if not exists pm_outbox_state_id_idx on public.pm_outbox(state, id);
create index if not exists pm_outbox_key_idx on public.pm_outbox(key, id);

-- 資料域寫入閘門（owner/epoch＝fencing）
create table if not exists public.pm_domain_lock (
  prefix text primary key,
  domain text not null,
  owner text not null default 'gd' check (owner in ('gd','abgd','frozen')),
  epoch int not null default 0,
  reason text,
  updated_at timestamptz not null default now()
);

-- 反向同步已套用事件（冪等）
create table if not exists public.pm_sync_applied (
  event_id uuid primary key,
  key text not null,
  epoch int not null,
  applied_at timestamptz not null default now()
);

-- 可信同步上下文：只有下面的 security definer RPC 會在交易內設 abgd.sync=1；一般角色設了也沒用（RPC 之外的寫入在 trigger 裡會再查 current_user）
create or replace function public.pm_outbox_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text; r bigint; o text; e text; del boolean;
begin
  if tg_op = 'DELETE' then k := old.id; e := old.editor; del := true; else k := new.id; e := new.editor; del := false; end if;
  if k like 'sp_finance_pm_inline_ph3_%' or k like 'sp_finance_pm_inline_cs_%' then return null; end if; -- 衍生索引不同步
  o := case when current_setting('abgd.sync', true) = '1' then 'abgd' else 'gd' end;
  insert into public.pm_rev(key, rev, deleted, updated_at) values (k, 1, del, now())
    on conflict (key) do update set rev = pm_rev.rev + 1, deleted = del, updated_at = now()
    returning rev into r;
  insert into public.pm_outbox(key, op, rev, editor, origin) values (k, left(tg_op, 1), r, e, o);
  return null;
end $$;

create or replace function public.pm_lock_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text; hit record; ep int;
begin
  if tg_op = 'DELETE' then k := old.id; else k := new.id; end if;
  select * into hit from public.pm_domain_lock l where l.owner <> 'gd' and k like l.prefix || '%' order by length(l.prefix) desc limit 1;
  if not found then return coalesce(new, old); end if;
  if current_setting('abgd.sync', true) = '1' then
    ep := nullif(current_setting('abgd.epoch', true), '')::int;
    if hit.owner = 'abgd' and ep = hit.epoch then return coalesce(new, old); end if;
  end if;
  raise exception 'ABGD_LOCKED: % 已由新殼接管（owner=% epoch=% %）', hit.domain, hit.owner, hit.epoch, coalesce(hit.reason, '');
end $$;

drop trigger if exists pm_documents_outbox on public.pm_documents;
create trigger pm_documents_outbox after insert or update or delete on public.pm_documents
  for each row execute function public.pm_outbox_trg();
drop trigger if exists pm_documents_lock on public.pm_documents;
create trigger pm_documents_lock before insert or update or delete on public.pm_documents
  for each row execute function public.pm_lock_trg();

-- 領取：lease token＋期限；同鍵只領最早一筆（同鍵序列化）
create or replace function public.pm_outbox_claim(p_worker text, p_limit int, p_lease_sec int)
returns setof public.pm_outbox language plpgsql security definer set search_path = public as $$
declare tok uuid := gen_random_uuid();
begin
  -- 逾時的 claimed 先回收
  update public.pm_outbox set state = 'new', lease_token = null, lease_until = null, worker = null where state = 'claimed' and lease_until < now();
  return query
  update public.pm_outbox o set state = 'claimed', lease_token = tok, lease_until = now() + make_interval(secs => p_lease_sec), worker = p_worker
  where o.id in (
    select x.id from public.pm_outbox x
    where x.id in (select min(id) from public.pm_outbox where state = 'new' group by key)
      and x.key not in (select key from public.pm_outbox where state = 'claimed')
    order by x.id limit p_limit
    for update skip locked
  ) returning o.*;
end $$;

-- 確認：CAS 比對 lease token，舊 worker 不能把新 worker 的工作標 done
create or replace function public.pm_outbox_done(p_ids bigint[], p_token uuid, p_error text default null)
returns int language sql security definer set search_path = public as $$
  with u as (
    update public.pm_outbox set state = case when p_error is null then 'done' else 'error' end, done_at = now(), error = p_error, lease_token = null, lease_until = null
    where id = any(p_ids) and state = 'claimed' and lease_token = p_token returning 1
  ) select count(*)::int from u;
$$;

-- 一致讀取：同一語句回 (key, current_rev, payload, deleted)，worker 以 current_rev 套用（事件只是喚醒）
create or replace function public.pm_read_current(p_keys text[])
returns table(key text, rev bigint, deleted boolean, editor text, updated_at timestamptz, v text)
language sql security definer set search_path = public stable as $$
  select r.key, r.rev, r.deleted, d.editor, d.updated_at, d.data->>'v'
  from public.pm_rev r left join public.pm_documents d on d.id = r.key
  where r.key = any(p_keys);
$$;

-- 一致快照（初始匯入）：單一語句同時帶 rev；之後不以 max id 截斷，所有 outbox 事件照 rev 去重處理
create or replace function public.pm_snapshot()
returns table(key text, rev bigint, deleted boolean, editor text, updated_at timestamptz, v text)
language sql security definer set search_path = public stable as $$
  select r.key, r.rev, r.deleted, d.editor, d.updated_at, d.data->>'v'
  from public.pm_rev r left join public.pm_documents d on d.id = r.key;
$$;

-- 反向：整包投影（abgd 真表算好完整 v）＋event_id 冪等＋epoch fencing；在同一交易內設可信上下文
create or replace function public.pm_kv_project(p_event_id uuid, p_key text, p_v text, p_epoch int, p_delete boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare hit record; r bigint; inserted int;
begin
  -- 先佔 event_id（唯一鍵＝併發時第二個交易會等第一個提交後拿到衝突→dup）
  insert into public.pm_sync_applied(event_id, key, epoch) values (p_event_id, p_key, p_epoch) on conflict (event_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    select rev into r from public.pm_rev where key = p_key; return jsonb_build_object('ok', true, 'dup', true, 'rev', r);
  end if;
  select * into hit from public.pm_domain_lock l where p_key like l.prefix || '%' order by length(l.prefix) desc limit 1;
  if not found or hit.owner <> 'abgd' or hit.epoch <> p_epoch then
    -- 用例外回滾，applied 列不留下
    raise exception 'ABGD_FENCED: owner=% epoch=%', coalesce(hit.owner, 'gd'), coalesce(hit.epoch, 0);
  end if;
  perform set_config('abgd.sync', '1', true);
  perform set_config('abgd.epoch', p_epoch::text, true);
  if p_delete then
    delete from public.pm_documents where id = p_key;
  else
    insert into public.pm_documents(id, data, editor, updated_at)
      values (p_key, jsonb_build_object('v', p_v), 'abgd-sync', now())
      on conflict (id) do update set data = excluded.data, editor = 'abgd-sync', updated_at = now();
  end if;
  select rev into r from public.pm_rev where key = p_key;
  return jsonb_build_object('ok', true, 'rev', r);
end $$;

-- 切換控制器用：鎖／解鎖域（owner、epoch）
create or replace function public.pm_domain_set(p_prefix text, p_domain text, p_owner text, p_epoch int, p_reason text)
returns void language sql security definer set search_path = public as $$
  insert into public.pm_domain_lock(prefix, domain, owner, epoch, reason, updated_at) values (p_prefix, p_domain, p_owner, p_epoch, p_reason, now())
  on conflict (prefix) do update set domain = excluded.domain, owner = excluded.owner, epoch = excluded.epoch, reason = excluded.reason, updated_at = now();
$$;

alter table public.pm_rev enable row level security;
alter table public.pm_outbox enable row level security;
alter table public.pm_domain_lock enable row level security;
alter table public.pm_sync_applied enable row level security;
revoke all on function public.pm_outbox_claim(text, int, int) from public, anon, authenticated;
revoke all on function public.pm_outbox_done(bigint[], uuid, text) from public, anon, authenticated;
revoke all on function public.pm_read_current(text[]) from public, anon, authenticated;
revoke all on function public.pm_snapshot() from public, anon, authenticated;
revoke all on function public.pm_kv_project(uuid, text, text, int, boolean) from public, anon, authenticated;
revoke all on function public.pm_domain_set(text, text, text, int, text) from public, anon, authenticated;
grant execute on function public.pm_outbox_claim(text,int,int), public.pm_outbox_done(bigint[],uuid,text), public.pm_read_current(text[]), public.pm_snapshot(), public.pm_kv_project(uuid,text,text,int,boolean), public.pm_domain_set(text,text,text,int,text) to service_role;
grant select, insert, update, delete on public.pm_rev, public.pm_outbox, public.pm_domain_lock, public.pm_sync_applied to service_role;
-- 不開任何 policy：只有 service role 讀寫得到
