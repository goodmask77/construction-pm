-- 帶寫入期限的版本比對寫／只新增（2026-10-16，關卡 3 inline 第八輪：GD 正本時同樣由資料庫時鐘強制拒絕逾期舊寫入）
--   只新增函式、不改既有 pm_doc_cas；寫入後才過期＝raise 整筆撤回
create or replace function public.pm_doc_cas_dl(p_id text, p_rev bigint, p_data jsonb, p_editor text, p_deadline timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if p_deadline is null then raise exception 'ABGD_BAD_ARG: 缺寫入期限'; end if;
  if clock_timestamp() > p_deadline then raise exception 'ABGD_LEASE_EXPIRED: 這筆寫入已過期限'; end if;
  r := public.pm_doc_cas(p_id, p_rev, p_data, p_editor);
  if clock_timestamp() > p_deadline then raise exception 'ABGD_LEASE_EXPIRED: 這筆寫入已過期限'; end if;
  return r;
end $$;
create or replace function public.pm_doc_insert_dl(p_id text, p_data jsonb, p_editor text, p_deadline timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_deadline is null then raise exception 'ABGD_BAD_ARG: 缺寫入期限'; end if;
  if clock_timestamp() > p_deadline then raise exception 'ABGD_LEASE_EXPIRED: 這筆寫入已過期限'; end if;
  insert into public.pm_documents(id, data, editor, updated_at) values (p_id, p_data, left(coalesce(p_editor, 'insert'), 60), now()) on conflict (id) do nothing;
  get diagnostics n = row_count;
  if clock_timestamp() > p_deadline then raise exception 'ABGD_LEASE_EXPIRED: 這筆寫入已過期限'; end if;
  if n <> 1 then return jsonb_build_object('ok', false, 'conflict', true); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.pm_doc_cas_dl(text, bigint, jsonb, text, timestamptz) from public, anon, authenticated;
revoke all on function public.pm_doc_insert_dl(text, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.pm_doc_cas_dl(text, bigint, jsonb, text, timestamptz) to service_role;
grant execute on function public.pm_doc_insert_dl(text, jsonb, text, timestamptz) to service_role;
