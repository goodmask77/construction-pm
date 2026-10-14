-- abgd 關卡 3 SOP 第七輪（OpenAI 1）：GD 文件真正的版本 CAS——用 pm_rev.rev（每次寫入由觸發器 +1 的整數版本），不用時間戳
-- pm_doc_get：同一語句讀 data＋rev；pm_doc_cas：鎖住該鍵的版本列、比對、寫入（搬家閘門觸發器照樣檢查），同一交易
create or replace function public.pm_doc_get(p_id text) returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('data', d.data, 'rev', coalesce(r.rev, 0)) from public.pm_documents d left join public.pm_rev r on r.key = d.id where d.id = p_id
$$;
create or replace function public.pm_doc_cas(p_id text, p_rev bigint, p_data jsonb, p_editor text) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare cur bigint; n int;
begin
  perform 1 from public.pm_documents where id = p_id for update; -- 先鎖文件列（寫入也會鎖它；避免與一般 kvSet 交錯時版本判斷過時）
  select rev into cur from public.pm_rev where key = p_id for update;
  if coalesce(cur, 0) <> p_rev then return jsonb_build_object('ok', false, 'conflict', true, 'rev', coalesce(cur, 0)); end if;
  update public.pm_documents set data = p_data, editor = left(coalesce(p_editor, 'cas'), 40), updated_at = now() where id = p_id;
  get diagnostics n = row_count;
  if n <> 1 then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'rev', (select rev from public.pm_rev where key = p_id));
end $$;
revoke all on function public.pm_doc_get(text), public.pm_doc_cas(text, bigint, jsonb, text) from public, anon, authenticated;
grant execute on function public.pm_doc_get(text), public.pm_doc_cas(text, bigint, jsonb, text) to service_role;
