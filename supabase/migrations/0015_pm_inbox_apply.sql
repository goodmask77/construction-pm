-- 收件匣「訊息＋對話一次套用」GD 版（關卡 3 inbox 第二輪 OpenAI A2）：規則同新殼 ops.inbox_apply（兩邊要一起改）
--   GD 原表模式（還沒切、或回切後）也是一個交易：鎖對話 → 訊息已存在＝dup（不改對話）→ 對話依規則改 → 新增訊息
--   搬家閘門觸發器照樣檢查（收件匣已搬到新殼時這裡會被擋）
create or replace function public.pm_inbox_apply(p_conv_key text, p_msg_key text, p_msg jsonb, p_conv0 jsonb, p_patch jsonb, p_editor text) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_conv jsonb; v_raw jsonb; k text; v_g jsonb; v_t text; v_inc int;
begin
  if p_conv_key !~ '^pm_inbox_c_[a-z]{2}_[A-Za-z0-9]{1,64}$' then raise exception '對話鍵不對：%', p_conv_key; end if;
  if p_msg_key is not null and p_msg_key !~ ('^pm_inbox_m_' || substr(p_conv_key, 12) || '_[A-Za-z0-9]{1,40}$') then raise exception '訊息鍵不對：%', p_msg_key; end if;
  perform pg_advisory_xact_lock(hashtext('ib:' || p_conv_key));
  select data into v_raw from public.pm_documents where id = p_conv_key for update;
  v_conv := case when v_raw is null then null else (v_raw->>'v')::jsonb end;
  if p_msg_key is not null and exists (select 1 from public.pm_documents where id = p_msg_key) then return jsonb_build_object('ok', true, 'dup', true, 'conv', v_conv); end if;
  if v_conv is null then v_conv := coalesce(p_conv0, '{}'::jsonb); end if;
  v_conv := v_conv || coalesce(p_patch->'set', '{}'::jsonb);
  for k in select jsonb_array_elements_text(coalesce(p_patch->'unset', '[]'::jsonb)) loop v_conv := v_conv - k; end loop;
  for k, v_g in select * from jsonb_each(coalesce(p_patch->'ifEmpty', '{}'::jsonb)) loop
    if coalesce(v_conv->>k, '') = '' then v_conv := v_conv || v_g; end if;
  end loop;
  v_t := coalesce(p_patch->>'t', '');
  if v_t >= coalesce(v_conv->>'lastT', '') then
    if p_patch ? 'last' then v_conv := v_conv || (p_patch->'last'); end if;
    for k in select jsonb_array_elements_text(coalesce(p_patch->'lastUnset', '[]'::jsonb)) loop v_conv := v_conv - k; end loop;
  end if;
  if p_patch ? 'ifTok' and coalesce(v_conv->>'replyToken', '') = coalesce(p_patch->'ifTok'->>'tok', '') then v_conv := v_conv || coalesce(p_patch->'ifTok'->'set', '{}'::jsonb); end if;
  v_inc := coalesce((p_patch->>'inc')::int, 0);
  if v_inc <> 0 then v_conv := jsonb_set(v_conv, '{unread}', to_jsonb(greatest(0, coalesce((v_conv->>'unread')::int, 0) + v_inc))); end if;
  if coalesce((p_patch->>'reopen')::boolean, false) and coalesce(v_conv->>'status', '') in ('done', 'wait') and v_t > coalesce(v_conv->>'statusT', '') then
    v_conv := v_conv || '{"status":"new","waitUntil":""}'::jsonb;
  end if;
  insert into public.pm_documents(id, data, editor, updated_at) values (p_conv_key, jsonb_build_object('v', v_conv::text), left(coalesce(p_editor, '收件匣'), 40), now())
    on conflict (id) do update set data = excluded.data, editor = excluded.editor, updated_at = now();
  if p_msg_key is not null then
    insert into public.pm_documents(id, data, editor, updated_at) values (p_msg_key, jsonb_build_object('v', p_msg::text), left(coalesce(p_editor, '收件匣'), 40), now());
  end if;
  return jsonb_build_object('ok', true, 'dup', false, 'conv', v_conv);
end $$;
revoke all on function public.pm_inbox_apply(text, text, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.pm_inbox_apply(text, text, jsonb, jsonb, jsonb, text) to service_role;
