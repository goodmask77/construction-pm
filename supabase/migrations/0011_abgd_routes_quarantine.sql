-- abgd 關卡 3 回饋第十一輪（OpenAI 高 1／中 2）：
-- 1) 版本＝新殼持久化全域序號（不再是時鐘）；同版本＋同內容＝冪等成功；文件沒有版本＝拒絕（不讓第一筆任何請求都贏）
-- 2) 看門狗不再用版本覆寫，改「隔離清單 quarantine」：被隔離的功能從實際入口拿掉，之後任何發布都不能把它加回去，只有人工解除
--    文件形狀：{ routes＝實際入口（want 扣掉 quarantine）, want＝新殼最後發布的期望入口, quarantine:[功能], ver, log }
create or replace function public.pm_routes_set(p_routes jsonb, p_ver bigint, p_by text, p_reason text) returns jsonb
 language plpgsql security definer set search_path to 'public' as $function$
declare cur jsonb; cv bigint; lg jsonb; q jsonb; eff jsonb;
begin
  select (data->>'v')::jsonb into cur from public.pm_documents where id = 'sp_finance_pm_prep_routes' for update;
  if cur is null or cur->'ver' is null then raise exception 'ROUTES_UNINIT: 入口文件沒有版本，先人工初始化'; end if;
  cv := (cur->>'ver')::bigint;
  q := coalesce(cur->'quarantine', '[]'::jsonb);
  if p_ver < cv or (p_ver = cv and coalesce(cur->'want', cur->'routes') is distinct from coalesce(p_routes, '{}'::jsonb)) then return jsonb_build_object('ok', false, 'stale', true, 'ver', cv); end if;
  eff := (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(coalesce(p_routes, '{}'::jsonb)) t(k, v) where not (q ? k));
  if p_ver = cv then return jsonb_build_object('ok', true, 'ver', cv, 'routes', eff, 'quarantine', q, 'same', true); end if;
  lg := coalesce(cur->'log', '[]'::jsonb);
  if jsonb_array_length(lg) >= 50 then lg := (select coalesce(jsonb_agg(e order by o), '[]'::jsonb) from jsonb_array_elements(lg) with ordinality t(e, o) where o > jsonb_array_length(lg) - 49); end if;
  lg := lg || jsonb_build_array(jsonb_build_object('ts', now(), 'by', left(coalesce(p_by, ''), 40), 'reason', left(coalesce(p_reason, ''), 120), 'keys', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(eff) k), 'ver', p_ver));
  update public.pm_documents set data = jsonb_build_object('v', (cur || jsonb_build_object('routes', eff, 'want', coalesce(p_routes, '{}'::jsonb), 'quarantine', q, 'log', lg, 'ver', p_ver))::text), editor = 'abgd-routes', updated_at = now() where id = 'sp_finance_pm_prep_routes';
  return jsonb_build_object('ok', true, 'ver', p_ver, 'routes', eff, 'quarantine', q);
end $function$;

-- 隔離（看門狗）：加進 quarantine、從實際入口拿掉；不比版本（不受時鐘影響）
create or replace function public.pm_routes_quarantine(p_keys jsonb, p_by text, p_reason text) returns jsonb
 language plpgsql security definer set search_path to 'public' as $function$
declare cur jsonb; q jsonb; eff jsonb; lg jsonb;
begin
  select (data->>'v')::jsonb into cur from public.pm_documents where id = 'sp_finance_pm_prep_routes' for update;
  if cur is null then raise exception 'ROUTES_UNINIT'; end if;
  q := (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from (select jsonb_array_elements_text(coalesce(cur->'quarantine', '[]'::jsonb)) x union select jsonb_array_elements_text(coalesce(p_keys, '[]'::jsonb))) s);
  eff := (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(coalesce(cur->'routes', '{}'::jsonb)) t(k, v) where not (q ? k));
  lg := coalesce(cur->'log', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('ts', now(), 'by', left(coalesce(p_by, ''), 40), 'reason', '隔離：' || left(coalesce(p_reason, ''), 110), 'keys', p_keys));
  update public.pm_documents set data = jsonb_build_object('v', (cur || jsonb_build_object('routes', eff, 'quarantine', q, 'log', lg))::text), editor = 'gd-watchdog', updated_at = now() where id = 'sp_finance_pm_prep_routes';
  return jsonb_build_object('ok', true, 'routes', eff, 'quarantine', q);
end $function$;

-- 解除隔離（人工）：從 quarantine 拿掉，實際入口＝want 扣掉剩下的隔離
create or replace function public.pm_routes_unquarantine(p_keys jsonb, p_by text, p_reason text) returns jsonb
 language plpgsql security definer set search_path to 'public' as $function$
declare cur jsonb; q jsonb; eff jsonb; lg jsonb;
begin
  if length(coalesce(p_reason, '')) < 10 then raise exception '要寫原因（至少 10 字）'; end if;
  select (data->>'v')::jsonb into cur from public.pm_documents where id = 'sp_finance_pm_prep_routes' for update;
  if cur is null then raise exception 'ROUTES_UNINIT'; end if;
  q := (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(coalesce(cur->'quarantine', '[]'::jsonb)) x where not (coalesce(p_keys, '[]'::jsonb) ? x));
  eff := (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(coalesce(cur->'want', cur->'routes', '{}'::jsonb)) t(k, v) where not (q ? k));
  lg := coalesce(cur->'log', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('ts', now(), 'by', left(coalesce(p_by, ''), 40), 'reason', '解除隔離：' || left(p_reason, 110), 'keys', p_keys));
  update public.pm_documents set data = jsonb_build_object('v', (cur || jsonb_build_object('routes', eff, 'quarantine', q, 'log', lg))::text), editor = 'abgd-routes', updated_at = now() where id = 'sp_finance_pm_prep_routes';
  return jsonb_build_object('ok', true, 'routes', eff, 'quarantine', q);
end $function$;
revoke all on function public.pm_routes_quarantine(jsonb, text, text), public.pm_routes_unquarantine(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.pm_routes_quarantine(jsonb, text, text), public.pm_routes_unquarantine(jsonb, text, text) to service_role;
