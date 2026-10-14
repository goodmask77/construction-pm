-- abgd 關卡 3 回饋第七輪：舊的非 CAS 控制函式 pm_domain_set 停用（新殼已全面改 pm_domain_set2；不能再繞過預期值檢查）
create or replace function public.pm_domain_set(p_prefix text, p_domain text, p_owner text, p_epoch integer, p_reason text)
 returns void language plpgsql security definer set search_path to 'public' as $function$
begin raise exception 'ABGD_DEPRECATED: 請用 pm_domain_set2（CAS）'; end $function$;
