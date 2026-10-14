-- abgd 關卡 3 回饋（OpenAI／Claude）：資料域前綴比對改「開頭完全相符」（LIKE 的底線＝任一字元、百分號會被當萬用字元）
-- 只改比對式，其他邏輯照正式庫現行定義
CREATE OR REPLACE FUNCTION public.pm_kv_project(p_event_id uuid, p_key text, p_v text, p_epoch integer, p_delete boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare hit record; r bigint; inserted int;
begin
  -- 先佔 event_id（唯一鍵＝併發時第二個交易會等第一個提交後拿到衝突→dup）
  insert into public.pm_sync_applied(event_id, key, epoch) values (p_event_id, p_key, p_epoch) on conflict (event_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    select rev into r from public.pm_rev where key = p_key; return jsonb_build_object('ok', true, 'dup', true, 'rev', r);
  end if;
  select * into hit from public.pm_domain_lock l where left(p_key, length(l.prefix)) = l.prefix order by length(l.prefix) desc limit 1;
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
end $function$;

CREATE OR REPLACE FUNCTION public.pm_lock_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare k text; hit record; ep int;
begin
  if tg_op = 'DELETE' then k := old.id; else k := new.id; end if;
  select * into hit from public.pm_domain_lock l where l.owner <> 'gd' and left(k, length(l.prefix)) = l.prefix order by length(l.prefix) desc limit 1;
  if not found then return coalesce(new, old); end if;
  if current_setting('abgd.sync', true) = '1' then
    ep := nullif(current_setting('abgd.epoch', true), '')::int;
    if hit.owner = 'abgd' and ep = hit.epoch then return coalesce(new, old); end if;
  end if;
  raise exception 'ABGD_LOCKED: % 已由新殼接管（owner=% epoch=% %）', hit.domain, hit.owner, hit.epoch, coalesce(hit.reason, '');
end $function$;

