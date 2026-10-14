-- abgd 關卡 3 回饋第三輪（OpenAI／Gemini）：
-- 1) 舊版無圍欄 pm_kv_project 停用（新殼已全面改 pm_kv_project2；舊 worker／在途請求不能再繞過圍欄）
-- 2) pm_kv_project2 讀資料域鎖改 FOR SHARE：解鎖／換 owner（pm_domain_set 是 UPDATE）會等在途反推交易結束，不會穿插
create or replace function public.pm_kv_project(p_event_id uuid, p_key text, p_v text, p_epoch integer, p_delete boolean default false)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  raise exception 'ABGD_DEPRECATED: 舊版反推已停用，請用 pm_kv_project2（帶圍欄序號）';
end $function$;

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
  select * into hit from public.pm_domain_lock l where left(p_key, length(l.prefix)) = l.prefix order by length(l.prefix) desc limit 1 for share;
  if not found or hit.owner <> 'abgd' or hit.epoch <> p_epoch then
    raise exception 'ABGD_FENCED: owner=% epoch=%', coalesce(hit.owner, 'gd'), coalesce(hit.epoch, 0);
  end if;
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
