-- DD 搬家 7c-2（2026-10-17）：對話紀錄原子追加（正本留 GD；所有寫入點都走這裡的函式）
--   pm_chat_append：同一個對話一把列鎖（pm_chat_rev）；事件收據去重（同事件同角色同內容＝dup、內容不同＝conflict 不寫）；追加到 pm_bot_chat_<conv>
--     新鍵還沒有時從舊整包 pm_bot_chats[conv] 懶遷移；超過 60 則不在這裡裁——回傳要摘要的最舊幾則（overflow）
--     這個對話還有待補寫的紀錄＝驗完格式與收據後，在同一把鎖內把這則排進補寫佇列（回 queued，維持接受順序）
--   pm_chat_sum_put：摘要算好後才裁：只有「最舊那幾則的雜湊」與「舊摘要的雜湊」都沒變才同時寫摘要＋裁掉，否則不動
--   pm_chat_get：同一個快照讀清單＋摘要＋版本
--   pm_chat_retry_put／pm_chat_retry_drain：補寫佇列（暫時失敗或對話有待補時排隊；一次補一個對話、各自提交，失敗就停在那個對話並退避）
--   pm_chat_sum_take：摘要待辦領取（即時與排程共用同一個節流）
--   守門觸發器：pm_bot_chat_*／pm_bot_chatsum_* 只能經上面兩個寫入函式寫（擋部署交接期舊版 GD 的整包覆寫；不是防有資料庫權限的人）
--   只給 service_role（GD 伺服器）呼叫
create table if not exists public.pm_chat_rev (conv text primary key, rev bigint not null default 0, at timestamptz not null default now(),
  retry_until timestamptz, retry_fails int not null default 0, -- 補寫領取：領走後 2 分鐘內別人不領；整次呼叫失敗（例如逾時被取消）也留得住，下一輪先補別的對話
  sum_next_at timestamptz); -- 摘要節流：同一個對話兩次叫模型至少隔 10 分鐘（跟待辦分開存，刪待辦不會重置）
alter table public.pm_chat_rev add column if not exists retry_until timestamptz;
alter table public.pm_chat_rev add column if not exists retry_fails int not null default 0;
alter table public.pm_chat_rev add column if not exists sum_next_at timestamptz;
create table if not exists public.pm_chat_receipts (conv text not null, event_id text not null, role text not null check (role in ('user', 'assistant')), hash text not null, at timestamptz not null default now(), primary key (conv, event_id, role));
create table if not exists public.pm_chat_retry (id bigserial primary key, conv text not null, event_id text not null, p_user jsonb, p_assistant jsonb, hash text not null, tries int not null default 0, dead boolean not null default false, next_at timestamptz not null default now(), at timestamptz not null default now(), last_err text, unique (conv, event_id));
create index if not exists pm_chat_retry_live_idx on public.pm_chat_retry(conv, id) where not dead;
-- 摘要待辦（耐久）：追加後超過 60 則就登記；摘要提交成功才刪；保溫排程限量領取（每個對話至少隔 10 分鐘才再領，模型失敗不會狂叫）
create table if not exists public.pm_chat_sumq (conv text primary key, at timestamptz not null default now(), next_at timestamptz not null default now());
alter table public.pm_chat_sumq enable row level security;
alter table public.pm_chat_rev enable row level security;
alter table public.pm_chat_receipts enable row level security;
alter table public.pm_chat_retry enable row level security;

-- 讀既有對話清單（內部用）：新鍵存在＝必須是 {v: "{list:[...]}"}，缺 v／list 或不是陣列＝丟錯（不當成空的）；新鍵不存在＝舊整包（對話不在＝空、在但不是陣列＝丟錯）
create or replace function public.pm_chat_list_i(p_conv text, p_lock boolean) returns jsonb language plpgsql set search_path = 'public' as $$
declare v_doc jsonb; v_in jsonb; v_list jsonb; v_old jsonb;
begin
  if p_lock then select data into v_doc from pm_documents where id = 'pm_bot_chat_' || p_conv for update;
  else select data into v_doc from pm_documents where id = 'pm_bot_chat_' || p_conv; end if;
  if found then
    if v_doc is null or jsonb_typeof(v_doc->'v') is distinct from 'string' then raise exception '既有對話紀錄格式不對（缺 v），不動資料'; end if;
    v_in := (v_doc->>'v')::jsonb;
    if jsonb_typeof(v_in) is distinct from 'object' or jsonb_typeof(v_in->'list') is distinct from 'array' then raise exception '既有對話紀錄格式不對（不是陣列），不動資料'; end if;
    return v_in->'list';
  end if;
  select data into v_old from pm_documents where id = 'pm_bot_chats';
  if not found then return '[]'::jsonb; end if; -- 舊整包不存在＝沒有舊紀錄
  if v_old is null or jsonb_typeof(v_old->'v') is distinct from 'string' then raise exception '舊整包對話紀錄格式不對（缺 v），不動資料'; end if;
  v_in := (v_old->>'v')::jsonb;
  if jsonb_typeof(v_in) is distinct from 'object' then raise exception '舊整包對話紀錄格式不對（不是物件），不動資料'; end if;
  if not (v_in ? p_conv) then return '[]'::jsonb; end if; -- 舊整包裡沒有這個對話
  v_list := v_in->p_conv;
  if jsonb_typeof(v_list) is distinct from 'array' then raise exception '舊整包裡這個對話的紀錄格式不對，不動資料'; end if;
  return v_list;
end $$;
-- 讀既有摘要（內部用）：新鍵存在＝必須有字串 text（缺＝丟錯）；不存在＝舊整包（沒有＝空字串）
create or replace function public.pm_chat_sum_i(p_conv text, p_lock boolean) returns text language plpgsql set search_path = 'public' as $$
declare v_doc jsonb; v_in jsonb; v_old jsonb;
begin
  if p_lock then select data into v_doc from pm_documents where id = 'pm_bot_chatsum_' || p_conv for update;
  else select data into v_doc from pm_documents where id = 'pm_bot_chatsum_' || p_conv; end if;
  if found then
    if v_doc is null or jsonb_typeof(v_doc->'v') is distinct from 'string' then raise exception '既有摘要格式不對，不動資料'; end if;
    v_in := (v_doc->>'v')::jsonb;
    if jsonb_typeof(v_in) is distinct from 'object' or jsonb_typeof(v_in->'text') is distinct from 'string' then raise exception '既有摘要格式不對，不動資料'; end if;
    return v_in->>'text';
  end if;
  select data into v_old from pm_documents where id = 'pm_bot_chatsum';
  if not found then return ''; end if;
  if v_old is null or jsonb_typeof(v_old->'v') is distinct from 'string' then raise exception '舊整包摘要格式不對（缺 v），不動資料'; end if;
  v_in := (v_old->>'v')::jsonb;
  if jsonb_typeof(v_in) is distinct from 'object' then raise exception '舊整包摘要格式不對（不是物件），不動資料'; end if;
  if not (v_in ? p_conv) then return ''; end if;
  if jsonb_typeof(v_in->p_conv) is distinct from 'string' then raise exception '舊整包裡這個對話的摘要格式不對，不動資料'; end if;
  return v_in->>p_conv;
end $$;

-- 入列（內部，呼叫前必須已持有這個對話的鎖）：新排＝ok；已排且內容相同且還活著＝ok dup；已排但已 dead＝不接受（dead）；內容不同＝conflict
create or replace function public.pm_chat_enq_i(p_conv text, p_event text, p_user jsonb, p_assistant jsonb, p_err text) returns jsonb language plpgsql set search_path = 'public' as $$
declare v_h text := md5(coalesce(p_user::text, '') || '|' || coalesce(p_assistant::text, '')); r record;
begin
  insert into pm_chat_retry(conv, event_id, p_user, p_assistant, hash, last_err) values (p_conv, p_event, p_user, p_assistant, v_h, left(p_err, 120)) on conflict (conv, event_id) do nothing;
  if found then return jsonb_build_object('ok', true, 'queued', true); end if;
  select hash, dead into r from pm_chat_retry where conv = p_conv and event_id = p_event;
  if r.hash is distinct from v_h then return jsonb_build_object('ok', false, 'conflict', true); end if;
  if r.dead then return jsonb_build_object('ok', false, 'dead', true); end if; -- 已放棄的：不假裝排進去了
  return jsonb_build_object('ok', true, 'queued', true, 'dup', true);
end $$;

-- 共用檢查（內部，呼叫前必須已持有對話鎖）：①同事件在補寫表：內容不同＝conflict、已 dead＝dead ②訊息格式（不對＝丟錯）③逐角色比對收據：不同＝conflict、相同＝略過
--   回 {ok:true, add:[這次真的要加的訊息], dup:相同的則數}；add 空＝整件都寫過了
create or replace function public.pm_chat_chk_i(p_conv text, p_event text, p_user jsonb, p_assistant jsonb, p_skip_retry boolean) returns jsonb language plpgsql set search_path = 'public' as $$
declare r record; v_old text; v_add jsonb := '[]'::jsonb; v_dup int := 0; q record;
begin
  if not p_skip_retry then
    select hash, dead into q from pm_chat_retry where conv = p_conv and event_id = p_event;
    if found then
      if q.hash is distinct from md5(coalesce(p_user::text, '') || '|' || coalesce(p_assistant::text, '')) then return jsonb_build_object('ok', false, 'conflict', true); end if;
      if q.dead then return jsonb_build_object('ok', false, 'dead', true); end if; -- 已放棄的不能經重送偷偷復活
    end if;
  end if;
  for r in select * from (values ('user', p_user), ('assistant', p_assistant)) t(role, msg) loop
    if r.msg is null then continue; end if;
    if jsonb_typeof(r.msg) is distinct from 'object' or (r.msg->>'role') is distinct from r.role or jsonb_typeof(r.msg->'content') is distinct from 'string' then raise exception '紀錄格式不對（%）', r.role; end if;
    select hash into v_old from pm_chat_receipts where conv = p_conv and event_id = p_event and role = r.role;
    if found then
      if v_old = md5(r.msg::text) then v_dup := v_dup + 1; continue; end if;
      return jsonb_build_object('ok', false, 'conflict', true, 'role', r.role);
    end if;
    v_add := v_add || jsonb_build_array(r.msg);
  end loop;
  return jsonb_build_object('ok', true, 'add', v_add, 'dup', v_dup);
end $$;

create or replace function public.pm_chat_append_i(p_conv text, p_event text, p_user jsonb, p_assistant jsonb, p_drain boolean) returns jsonb
language plpgsql set search_path = 'public' as $$
declare
  v_key text := 'pm_bot_chat_' || p_conv; v_rev bigint; v_list jsonb; v_add jsonb; v_dup int; v_chk jsonb;
  r record; v_n int; v_over jsonb := '[]'::jsonb;
begin
  if p_conv is null or p_conv !~ '^(dm_U[0-9a-f]{32}|g_[CR][0-9a-f]{32})$' then raise exception '對話編號格式不對'; end if;
  if p_event is null or length(p_event) < 4 or length(p_event) > 120 then raise exception '事件編號格式不對'; end if;
  insert into pm_chat_rev(conv) values (p_conv) on conflict (conv) do nothing;
  select rev into v_rev from pm_chat_rev where conv = p_conv for update; -- 同一對話的追加、裁剪、補寫都排隊
  v_chk := pm_chat_chk_i(p_conv, p_event, p_user, p_assistant, p_drain); -- 補寫本身＝佇列裡那列就是自己，不比對補寫表，只比收據
  if (v_chk->>'ok') is distinct from 'true' then return v_chk; end if; -- conflict／dead：不寫、不排
  v_add := v_chk->'add'; v_dup := (v_chk->>'dup')::int;
  if jsonb_array_length(v_add) = 0 then return jsonb_build_object('ok', true, 'dup', true, 'rev', v_rev); end if; -- 整件都寫過了：不用排隊
  -- 這個對話還有待補寫的（不是補寫本身）＝驗完後在同一把鎖內排進佇列（不插隊）
  if not p_drain and exists (select 1 from pm_chat_retry where conv = p_conv and not dead) then return pm_chat_enq_i(p_conv, p_event, p_user, p_assistant, 'pending'); end if;
  v_list := pm_chat_list_i(p_conv, true) || v_add; -- 讀壞＝丟錯（整筆不寫、收據也不留）
  for r in select * from jsonb_array_elements(v_add) t(msg) loop
    insert into pm_chat_receipts(conv, event_id, role, hash) values (p_conv, p_event, r.msg->>'role', md5(r.msg::text));
  end loop;
  perform set_config('dd.chatfn', '1', true); -- 守門觸發器放行
  insert into pm_documents(id, data, editor, updated_at) values (v_key, jsonb_build_object('v', jsonb_build_object('list', v_list, 'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text), 'DD', now())
    on conflict (id) do update set data = excluded.data, editor = excluded.editor, updated_at = excluded.updated_at;
  perform set_config('dd.chatfn', '', true); -- 寫完立刻關（同交易後面的直接寫入照樣被擋）
  update pm_chat_rev set rev = rev + 1, at = now() where conv = p_conv returning rev into v_rev;
  v_n := jsonb_array_length(v_list);
  if v_n > 60 then -- 60＝摘要觸發門檻（不是上限）；一次最多摘最舊 60 則（分批，積壓很多時不一次吃完）
    select coalesce(jsonb_agg(e order by i), '[]'::jsonb) into v_over from jsonb_array_elements(v_list) with ordinality t(e, i) where i <= least(v_n - 48, 60);
    insert into pm_chat_sumq(conv) values (p_conv) on conflict (conv) do nothing; -- 耐久摘要待辦（摘要成功才刪）
  end if;
  return jsonb_build_object('ok', true, 'rev', v_rev, 'n', v_n, 'dup', v_dup > 0, 'overflow', v_over, 'overflow_hash', case when jsonb_array_length(v_over) > 0 then md5(v_over::text) else null end);
end $$;
-- 暫時性錯誤（子交易接得住、重試會好）：序列化失敗／死鎖（40 類）、資源不足（53 類）、等鎖逾時（55P03）
--   查詢被取消（57014，含 statement_timeout）與連線中斷接不住——整個呼叫失敗，由 GD 依錯誤碼決定排隊（見 pushChat）
create or replace function public.pm_chat_transient(p_state text) returns boolean language sql immutable as $$
  select left(p_state, 2) in ('40', '53') or p_state = '55P03'
$$;
-- 對外追加：先在外層拿對話鎖，內部追加放子交易；子交易遇到暫時性錯誤＝鎖還在手上就把這則排進補寫佇列（同一把鎖內完成，後面的追加看得到 pending，不會插隊）
--   確定性錯誤（格式不對、既有資料壞）＝照樣丟給呼叫端（不排隊）
create or replace function public.pm_chat_append(p_conv text, p_event text, p_user jsonb, p_assistant jsonb) returns jsonb
language plpgsql security definer set search_path = 'public' as $$
declare v jsonb;
begin
  if p_conv is null or p_conv !~ '^(dm_U[0-9a-f]{32}|g_[CR][0-9a-f]{32})$' then raise exception '對話編號格式不對'; end if;
  if p_event is null or length(p_event) < 4 or length(p_event) > 120 then raise exception '事件編號格式不對'; end if;
  insert into pm_chat_rev(conv) values (p_conv) on conflict (conv) do nothing;
  perform 1 from pm_chat_rev where conv = p_conv for update;
  begin
    v := pm_chat_append_i(p_conv, p_event, p_user, p_assistant, false);
  exception when others then
    if not pm_chat_transient(sqlstate) then raise; end if;
    return pm_chat_enq_i(p_conv, p_event, p_user, p_assistant, sqlstate || ' ' || sqlerrm); -- 鎖還在手上
  end;
  return v;
end $$;

create or replace function public.pm_chat_sum_put(p_conv text, p_drop_n int, p_drop_hash text, p_oldsum_hash text, p_text text) returns jsonb
language plpgsql security definer set search_path = 'public' as $$
declare v_key text := 'pm_bot_chat_' || p_conv; v_skey text := 'pm_bot_chatsum_' || p_conv; v_list jsonb; v_head jsonb; v_old text; v_rev bigint;
begin
  if p_conv is null or p_conv !~ '^(dm_U[0-9a-f]{32}|g_[CR][0-9a-f]{32})$' then raise exception '對話編號格式不對'; end if;
  if p_drop_n is null or p_drop_n < 1 or p_text is null or length(p_text) > 3000 or regexp_replace(p_text, '[[:space:]　 ​﻿]', '', 'g') = '' then raise exception '摘要參數不對'; end if; -- 空白（含換行、Tab、全形空白）＝不收
  if p_drop_hash is null or p_drop_hash !~ '^[0-9a-f]{32}$' or p_oldsum_hash is null or p_oldsum_hash !~ '^[0-9a-f]{32}$' then raise exception '雜湊格式不對'; end if; -- 空值不能繞過比對
  insert into pm_chat_rev(conv) values (p_conv) on conflict (conv) do nothing;
  select rev into v_rev from pm_chat_rev where conv = p_conv for update;
  if not exists (select 1 from pm_documents where id = v_key) then return jsonb_build_object('ok', false, 'stale', true); end if; -- 還沒有新鍵＝還沒追加過，不裁
  v_list := pm_chat_list_i(p_conv, true);
  if jsonb_array_length(v_list) < p_drop_n then return jsonb_build_object('ok', false, 'stale', true); end if;
  select coalesce(jsonb_agg(e order by i), '[]'::jsonb) into v_head from jsonb_array_elements(v_list) with ordinality t(e, i) where i <= p_drop_n;
  if md5(v_head::text) is distinct from p_drop_hash then return jsonb_build_object('ok', false, 'stale', true); end if;
  v_old := pm_chat_sum_i(p_conv, true); -- 同 pm_chat_get：新鍵沒有時讀舊整包
  if md5(v_old) is distinct from p_oldsum_hash then return jsonb_build_object('ok', false, 'stale', true); end if;
  select coalesce(jsonb_agg(e order by i), '[]'::jsonb) into v_list from jsonb_array_elements(v_list) with ordinality t(e, i) where i > p_drop_n;
  perform set_config('dd.chatfn', '1', true);
  insert into pm_documents(id, data, editor, updated_at) values (v_skey, jsonb_build_object('v', jsonb_build_object('text', p_text, 'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text), 'DD', now())
    on conflict (id) do update set data = excluded.data, editor = excluded.editor, updated_at = excluded.updated_at;
  update pm_documents set data = jsonb_build_object('v', jsonb_build_object('list', v_list, 'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text), editor = 'DD', updated_at = now() where id = v_key;
  perform set_config('dd.chatfn', '', true);
  update pm_chat_rev set rev = rev + 1, at = now() where conv = p_conv returning rev into v_rev;
  if jsonb_array_length(v_list) <= 60 then delete from pm_chat_sumq where conv = p_conv; end if; -- 摘要完成＝待辦清掉
  return jsonb_build_object('ok', true, 'rev', v_rev);
end $$;

-- 一致讀清單＋摘要＋版本（含舊整包懶讀）：先對這個對話的版本列加共享鎖——寫入（追加／摘要裁剪／補寫）都要獨占鎖，
--   所以讀的這段期間沒有人能寫＝清單與摘要一定是同一個狀態（不靠快照）；格式壞＝丟錯（不回空清單）
create or replace function public.pm_chat_get(p_conv text) returns jsonb language plpgsql security definer set search_path = 'public' as $$
declare v_rev bigint;
begin
  if p_conv is null or p_conv !~ '^(dm_U[0-9a-f]{32}|g_[CR][0-9a-f]{32})$' then raise exception '對話編號格式不對'; end if;
  insert into pm_chat_rev(conv) values (p_conv) on conflict (conv) do nothing;
  select rev into v_rev from pm_chat_rev where conv = p_conv for share;
  return jsonb_build_object('list', pm_chat_list_i(p_conv, false), 'sum', pm_chat_sum_i(p_conv, false), 'rev', v_rev,
    'pending', exists (select 1 from pm_chat_retry where conv = p_conv and not dead));
end $$;

-- 領摘要待辦（p_conv 給了＝只領那個對話：追加後的即時摘要也走這裡）：節流存在 pm_chat_rev.sum_next_at（同對話至少隔 10 分鐘才再叫模型；刪待辦不重置）
--   每個對話先拿對話鎖（鎖順序同追加：對話鎖→待辦），回最舊一批（最多 60 則）＋雜湊；已不超過 60＝刪待辦
create or replace function public.pm_chat_sum_take(p_limit int, p_conv text) returns jsonb language plpgsql security definer set search_path = 'public' as $$
declare c record; v_list jsonb; v_n int; v_over jsonb; v_out jsonb := '[]'::jsonb;
begin
  -- 候選查詢直接對版本列 for update skip locked：被鎖住的對話不算進名額、也不等（排在後面、可處理的照樣領得到）；只鎖版本列、不鎖待辦列（鎖順序同追加）
  for c in select q.conv from pm_chat_sumq q join pm_chat_rev v on v.conv = q.conv
           where (v.sum_next_at is null or v.sum_next_at <= clock_timestamp()) and (p_conv is null or q.conv = p_conv)
           order by q.at limit greatest(1, least(coalesce(p_limit, 1), 10)) for update of v skip locked loop
    update pm_chat_rev set sum_next_at = clock_timestamp() + interval '10 minutes' where conv = c.conv;
    begin
      v_list := pm_chat_list_i(c.conv, false); v_n := jsonb_array_length(v_list);
    exception when others then continue; -- 紀錄壞：待辦留著（10 分鐘後再看）
    end;
    if v_n <= 60 then delete from pm_chat_sumq where conv = c.conv; continue; end if;
    -- 積壓多（超過 120 則＝一批摘不完）：節流縮成 1 分鐘加速清（每分鐘最多摘 60 則；正常 10 分鐘摘一批＝平均每分鐘 6 則）
    if v_n > 120 then update pm_chat_rev set sum_next_at = clock_timestamp() + interval '1 minute' where conv = c.conv; end if;
    select coalesce(jsonb_agg(e order by i), '[]'::jsonb) into v_over from jsonb_array_elements(v_list) with ordinality t(e, i) where i <= least(v_n - 48, 60);
    v_out := v_out || jsonb_build_array(jsonb_build_object('conv', c.conv, 'overflow', v_over, 'overflow_hash', md5(v_over::text), 'n', v_n));
  end loop;
  return v_out;
end $$;

-- 補寫排隊：同對話同事件只排一次；已排過且內容相同＝ok，內容不同＝conflict
create or replace function public.pm_chat_retry_put(p_conv text, p_event text, p_user jsonb, p_assistant jsonb, p_err text) returns jsonb language plpgsql security definer set search_path = 'public' as $$
declare v_chk jsonb;
begin
  if p_conv is null or p_conv !~ '^(dm_U[0-9a-f]{32}|g_[CR][0-9a-f]{32})$' then raise exception '對話編號格式不對'; end if;
  if p_event is null or length(p_event) < 4 or length(p_event) > 120 then raise exception '事件編號格式不對'; end if;
  insert into pm_chat_rev(conv) values (p_conv) on conflict (conv) do nothing;
  perform 1 from pm_chat_rev where conv = p_conv for update; -- 跟追加同一把鎖
  v_chk := pm_chat_chk_i(p_conv, p_event, p_user, p_assistant, false); -- 格式不對丟錯；收據衝突／已 dead／內容不同＝不排
  if (v_chk->>'ok') is distinct from 'true' then return v_chk; end if;
  if jsonb_array_length(v_chk->'add') = 0 then return jsonb_build_object('ok', true, 'dup', true); end if; -- 已經寫進去了（例如上次回應遺失）：不用排
  return pm_chat_enq_i(p_conv, p_event, p_user, p_assistant, p_err);
end $$;
-- 補寫第一步：領一個對話（短交易、立刻提交）：挑「隊首不在退避中、也沒被領走（retry_until 過了）」裡隊首最舊的；領走＝retry_until 推到 2 分鐘後、retry_fails +1。
--   第二步 pm_chat_retry_drain 正常結束才把 retry_fails 歸零、放掉領取。drain 被取消並回滾（例如 statement_timeout）時，先前已提交的領取仍保留＝下一次先補別的對話；
--   drain 已提交只是回應遺失時，領取已清掉（正常），重送靠收據去重。
--   同一個對話連續 12 次領走都沒正常結束＝把它的隊首標 dead（內容留存），後面的接著補
create or replace function public.pm_chat_retry_claim() returns jsonb language plpgsql security definer set search_path = 'public' as $$
declare c record;
begin
  for c in
    select v.conv, v.retry_fails, h.id from (select distinct on (conv) conv, id, next_at from pm_chat_retry where not dead order by conv, id) h
    join pm_chat_rev v on v.conv = h.conv
    where h.next_at <= clock_timestamp() and (v.retry_until is null or v.retry_until < clock_timestamp())
    order by h.id limit 5 for update of v skip locked
  loop
    if c.retry_fails >= 12 then
      update pm_chat_retry set dead = true, last_err = left('補寫連續 12 次沒有正常結束；' || coalesce(last_err, ''), 120) where id = c.id;
      update pm_chat_rev set retry_fails = 0, retry_until = null where conv = c.conv;
      return jsonb_build_object('conv', null, 'dead', 1);
    end if;
    update pm_chat_rev set retry_until = clock_timestamp() + interval '2 minutes', retry_fails = retry_fails + 1 where conv = c.conv;
    return jsonb_build_object('conv', c.conv);
  end loop;
  return jsonb_build_object('conv', null);
end $$;
-- 補寫第二步：補這個對話（拿對話鎖；等鎖最多 2 秒＝55P03 可接住）；依入列順序最多 20 則（每則都重寫整份清單，限量）；某則失敗＝停下：
--   暫時性錯誤不計次、退避 60～90 秒；確定性錯誤計次＋退避（5 分鐘起倍增、最多 2 小時），第 12 次標 dead（內容留存）後面的接著補；正常結束＝放掉領取
create or replace function public.pm_chat_retry_drain(p_conv text) returns jsonb language plpgsql security definer set search_path = 'public' as $$
declare r record; v jsonb; n int := 0; d int := 0;
begin
  if p_conv is null or p_conv !~ '^(dm_U[0-9a-f]{32}|g_[CR][0-9a-f]{32})$' then raise exception '對話編號格式不對'; end if;
  perform set_config('lock_timeout', '2s', true);
  perform 1 from pm_chat_rev where conv = p_conv for update;
  for r in select * from pm_chat_retry where conv = p_conv and not dead order by id limit 20 loop
    if r.next_at > clock_timestamp() then exit; end if;
    begin
      v := pm_chat_append_i(r.conv, r.event_id, r.p_user, r.p_assistant, true);
      if (v->>'ok') = 'true' then delete from pm_chat_retry where id = r.id; n := n + 1;
      else update pm_chat_retry set dead = true, last_err = 'conflict' where id = r.id; d := d + 1; end if; -- 同事件不同內容：重試也不會好（後面的照常補）
    exception when others then
      if pm_chat_transient(sqlstate) then
        update pm_chat_retry set last_err = left(sqlstate || ' ' || sqlerrm, 120), next_at = clock_timestamp() + interval '60 seconds' + random() * interval '30 seconds' where id = r.id; exit;
      else
        update pm_chat_retry set tries = tries + 1, last_err = left(sqlstate || ' ' || sqlerrm, 120), dead = (tries + 1 >= 12),
          next_at = clock_timestamp() + least(interval '2 hours', interval '5 minutes' * power(2, tries)) where id = r.id;
        if r.tries + 1 >= 12 then d := d + 1; else exit; end if;
      end if;
    end;
  end loop;
  update pm_chat_rev set retry_until = null, retry_fails = 0 where conv = p_conv; -- 正常結束：放掉領取
  return jsonb_build_object('done', n, 'dead', d);
end $$;

-- 守門：對話紀錄鍵只能經 pm_chat_append_i／pm_chat_sum_put 寫（那兩個函式寫之前開、寫完立刻關交易內變數 dd.chatfn）；
--   舊整包 pm_bot_chats／pm_bot_chatsum 從此唯讀（v4.70.39 起程式就不寫了；擋住舊版或工具誤寫）
create or replace function public.pm_chat_guard_trg() returns trigger language plpgsql set search_path = 'public' as $$
declare k text;
begin
  if tg_op = 'DELETE' then k := old.id; else k := new.id; end if;
  if current_setting('dd.chatfn', true) is distinct from '1' then
    raise exception 'DD_CHAT_GUARD: 對話紀錄只能經 pm_chat_append 寫（%）', k;
  end if;
  return coalesce(new, old);
end $$;
-- 只在碰到對話紀錄鍵時才觸發（WHEN 條件，其他鍵的寫入不跑函式）
drop trigger if exists pm_documents_chat_guard_i on public.pm_documents;
drop trigger if exists pm_documents_chat_guard_u on public.pm_documents;
drop trigger if exists pm_documents_chat_guard_d on public.pm_documents;
create trigger pm_documents_chat_guard_i before insert on public.pm_documents for each row
  when (left(new.id, 12) = 'pm_bot_chat_' or left(new.id, 15) = 'pm_bot_chatsum_' or new.id in ('pm_bot_chats', 'pm_bot_chatsum')) execute function public.pm_chat_guard_trg();
create trigger pm_documents_chat_guard_u before update on public.pm_documents for each row
  when (left(new.id, 12) = 'pm_bot_chat_' or left(new.id, 15) = 'pm_bot_chatsum_' or left(old.id, 12) = 'pm_bot_chat_' or left(old.id, 15) = 'pm_bot_chatsum_' or new.id in ('pm_bot_chats', 'pm_bot_chatsum') or old.id in ('pm_bot_chats', 'pm_bot_chatsum')) execute function public.pm_chat_guard_trg();
create trigger pm_documents_chat_guard_d before delete on public.pm_documents for each row
  when (left(old.id, 12) = 'pm_bot_chat_' or left(old.id, 15) = 'pm_bot_chatsum_' or old.id in ('pm_bot_chats', 'pm_bot_chatsum')) execute function public.pm_chat_guard_trg();

revoke all on function public.pm_chat_list_i(text, boolean), public.pm_chat_sum_i(text, boolean), public.pm_chat_append_i(text, text, jsonb, jsonb, boolean), public.pm_chat_enq_i(text, text, jsonb, jsonb, text), public.pm_chat_chk_i(text, text, jsonb, jsonb, boolean) from public, anon, authenticated, service_role;
revoke all on function public.pm_chat_append(text, text, jsonb, jsonb), public.pm_chat_sum_put(text, int, text, text, text), public.pm_chat_get(text), public.pm_chat_retry_put(text, text, jsonb, jsonb, text), public.pm_chat_retry_claim(), public.pm_chat_retry_drain(text), public.pm_chat_sum_take(int, text) from public, anon, authenticated;
grant execute on function public.pm_chat_append(text, text, jsonb, jsonb), public.pm_chat_sum_put(text, int, text, text, text), public.pm_chat_get(text), public.pm_chat_retry_put(text, text, jsonb, jsonb, text), public.pm_chat_retry_claim(), public.pm_chat_retry_drain(text), public.pm_chat_sum_take(int, text) to service_role;
revoke all on public.pm_chat_rev, public.pm_chat_receipts, public.pm_chat_retry, public.pm_chat_sumq from anon, authenticated;
