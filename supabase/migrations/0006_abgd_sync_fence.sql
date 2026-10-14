-- abgd 關卡 3 回饋第二輪（OpenAI）：反向同步「圍欄序號」（fencing token）
-- 每次反推的 worker 拿一個只增不減的序號；GD 每個鍵記住看過的最大序號，比它小的寫入（卡住後晚到的舊請求）直接拒絕，
-- 不會把新版蓋回舊版。新函式另取名 pm_kv_project2（舊的 5 參數版保留，避免 PostgREST 同名多載選不到）。
create table if not exists public.pm_sync_fence (key text primary key, fence bigint not null, updated_at timestamptz not null default now());
alter table public.pm_sync_fence enable row level security;

create or replace function public.pm_kv_project2(p_event_id uuid, p_key text, p_v text, p_epoch integer, p_delete boolean, p_fence bigint)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare hit record; r bigint; inserted int; f bigint;
begin
  if p_fence is null or p_fence <= 0 then raise exception 'ABGD_STALE: 缺圍欄序號'; end if;
  insert into public.pm_sync_applied(event_id, key, epoch) values (p_event_id, p_key, p_epoch) on conflict (event_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    select rev into r from public.pm_rev where key = p_key; return jsonb_build_object('ok', true, 'dup', true, 'rev', r);
  end if;
  select * into hit from public.pm_domain_lock l where left(p_key, length(l.prefix)) = l.prefix order by length(l.prefix) desc limit 1;
  if not found or hit.owner <> 'abgd' or hit.epoch <> p_epoch then
    raise exception 'ABGD_FENCED: owner=% epoch=%', coalesce(hit.owner, 'gd'), coalesce(hit.epoch, 0);
  end if;
  -- 圍欄：同鍵序號只能持平或往上；晚到的舊請求整筆回滾（applied 列也不留）
  insert into public.pm_sync_fence(key, fence) values (p_key, 0) on conflict (key) do nothing;
  select fence into f from public.pm_sync_fence where key = p_key for update;
  if p_fence < f then raise exception 'ABGD_STALE: % 圍欄 % < 已寫過 %', p_key, p_fence, f; end if;
  update public.pm_sync_fence set fence = p_fence, updated_at = now() where key = p_key;
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
end $function$;
revoke all on function public.pm_kv_project2(uuid, text, text, integer, boolean, bigint) from public, anon, authenticated;
grant execute on function public.pm_kv_project2(uuid, text, text, integer, boolean, bigint) to service_role;
