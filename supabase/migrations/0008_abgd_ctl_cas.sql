-- abgd 關卡 3 回饋第四輪（OpenAI／Gemini）：
-- 1) 控制命令改「預期原狀態才改」（CAS）：pm_domain_set2(prefix, domain, owner, epoch, reason, expect_owner, expect_epoch)
--    目前 owner／epoch 不是預期值就丟錯（零列＝丟錯）；epoch 只能持平或往上。逾時後才到的舊命令遇到已被補償改過的狀態會被拒，不會改回舊階段。
--    第一次建立該前綴（還沒有列）時 expect_owner 要給 null。
-- 2) pm_kv_project2：先驗資料域鎖（FOR SHARE）再佔投遞 id（重複 id 不能繞過 owner／epoch 檢查）
create or replace function public.pm_domain_set2(p_prefix text, p_domain text, p_owner text, p_epoch integer, p_reason text, p_expect_owner text, p_expect_epoch integer)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare cur record; n int;
begin
  if p_owner not in ('gd', 'abgd', 'frozen') then raise exception 'ABGD_CTL: owner 不合法 %', p_owner; end if;
  select * into cur from public.pm_domain_lock where prefix = p_prefix for update;
  if not found then
    if p_expect_owner is not null then raise exception 'ABGD_CTL: % 沒有鎖列，預期 %/%', p_prefix, p_expect_owner, p_expect_epoch; end if;
    insert into public.pm_domain_lock(prefix, domain, owner, epoch, reason, updated_at) values (p_prefix, p_domain, p_owner, p_epoch, p_reason, now());
    return jsonb_build_object('ok', true, 'owner', p_owner, 'epoch', p_epoch, 'created', true);
  end if;
  if cur.owner is distinct from p_expect_owner or cur.epoch is distinct from p_expect_epoch then
    raise exception 'ABGD_CTL: % 現在是 %/%，預期 %/%（命令過時被拒）', p_prefix, cur.owner, cur.epoch, p_expect_owner, p_expect_epoch;
  end if;
  if p_epoch < cur.epoch then raise exception 'ABGD_CTL: epoch 不能倒退 % → %', cur.epoch, p_epoch; end if;
  update public.pm_domain_lock set domain = p_domain, owner = p_owner, epoch = p_epoch, reason = p_reason, updated_at = now() where prefix = p_prefix;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ABGD_CTL: 更新 % 列', n; end if;
  return jsonb_build_object('ok', true, 'owner', p_owner, 'epoch', p_epoch);
end $function$;
revoke all on function public.pm_domain_set2(text, text, text, integer, text, text, integer) from public, anon, authenticated;
grant execute on function public.pm_domain_set2(text, text, text, integer, text, text, integer) to service_role;

create or replace function public.pm_kv_project2(p_event_id uuid, p_key text, p_v text, p_epoch integer, p_delete boolean, p_fence bigint)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare hit record; r bigint; inserted int; f bigint;
begin
  if p_fence is null or p_fence <= 0 then raise exception 'ABGD_STALE: 缺圍欄序號'; end if;
  select * into hit from public.pm_domain_lock l where left(p_key, length(l.prefix)) = l.prefix order by length(l.prefix) desc limit 1 for share;
  if not found or hit.owner <> 'abgd' or hit.epoch <> p_epoch then
    raise exception 'ABGD_FENCED: owner=% epoch=%', coalesce(hit.owner, 'gd'), coalesce(hit.epoch, 0);
  end if;
  insert into public.pm_sync_applied(event_id, key, epoch) values (p_event_id, p_key, p_epoch) on conflict (event_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    select rev into r from public.pm_rev where key = p_key; return jsonb_build_object('ok', true, 'dup', true, 'rev', r);
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
