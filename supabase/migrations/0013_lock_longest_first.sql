-- abgd 搬家（2026-10-14，第 2 波盤點抓到）：鎖觸發器原本「先篩掉 owner=gd 再取最長前綴」——
-- 短前綴已交新殼、較長前綴還在 GD 時（例：sp_finance_pm_pos 搬走、sp_finance_pm_pos_prices 還在 GD），長前綴的鍵會被誤鎖。
-- 改成：先取最長相符前綴（不分 owner），那一列是 gd＝放行；與 abgdOwnerOf、pm_kv_project2 判斷一致
create or replace function public.pm_lock_trg() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare k text; hit record; ep int;
begin
  if tg_op = 'DELETE' then k := old.id; else k := new.id; end if;
  select * into hit from public.pm_domain_lock l where left(k, length(l.prefix)) = l.prefix order by length(l.prefix) desc limit 1;
  if not found or hit.owner = 'gd' then return coalesce(new, old); end if;
  if current_setting('abgd.sync', true) = '1' then
    ep := nullif(current_setting('abgd.epoch', true), '')::int;
    if hit.owner = 'abgd' and ep = hit.epoch then return coalesce(new, old); end if;
  end if;
  raise exception 'ABGD_LOCKED: % 已由新殼接管（owner=% epoch=% %）', hit.domain, hit.owner, hit.epoch, coalesce(hit.reason, '');
end $function$;
