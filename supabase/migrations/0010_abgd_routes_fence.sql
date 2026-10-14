-- abgd 關卡 3 回饋第十輪（OpenAI 高 2）：GD 入口（側欄導新殼）發布加版本圍欄
-- pm_routes_set：鎖住入口文件那一列，版本（快照當下的毫秒時間）比已存的新才寫；舊快照晚到直接拒絕（不覆蓋人工恢復後的入口）
-- GD 看門狗清入口也走這裡（版本＝GD 現在時間）
create or replace function public.pm_routes_set(p_routes jsonb, p_ver bigint, p_by text, p_reason text) returns jsonb
 language plpgsql security definer set search_path to 'public' as $function$
declare cur jsonb; cv bigint; lg jsonb;
begin
  insert into public.pm_documents(id, data, editor, updated_at) values ('sp_finance_pm_prep_routes', jsonb_build_object('v', '{"routes":{},"log":[],"ver":0}'), 'abgd-routes', now()) on conflict (id) do nothing;
  select (data->>'v')::jsonb into cur from public.pm_documents where id = 'sp_finance_pm_prep_routes' for update;
  cv := coalesce((cur->>'ver')::bigint, 0);
  if p_ver <= cv then return jsonb_build_object('ok', false, 'stale', true, 'ver', cv); end if;
  lg := coalesce(cur->'log', '[]'::jsonb);
  if jsonb_array_length(lg) >= 50 then lg := (select coalesce(jsonb_agg(e order by o), '[]'::jsonb) from jsonb_array_elements(lg) with ordinality t(e, o) where o > jsonb_array_length(lg) - 49); end if;
  lg := lg || jsonb_build_array(jsonb_build_object('ts', now(), 'by', left(coalesce(p_by, ''), 40), 'reason', left(coalesce(p_reason, ''), 120), 'keys', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(coalesce(p_routes, '{}'::jsonb)) k), 'ver', p_ver));
  update public.pm_documents set data = jsonb_build_object('v', jsonb_build_object('routes', coalesce(p_routes, '{}'::jsonb), 'log', lg, 'ver', p_ver)::text), editor = 'abgd-routes', updated_at = now() where id = 'sp_finance_pm_prep_routes';
  return jsonb_build_object('ok', true, 'ver', p_ver);
end $function$;
revoke all on function public.pm_routes_set(jsonb, bigint, text, text) from public, anon, authenticated;
grant execute on function public.pm_routes_set(jsonb, bigint, text, text) to service_role;
