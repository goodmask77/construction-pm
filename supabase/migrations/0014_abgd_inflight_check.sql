-- abgd 切換控制器硬檢查（2026-10-15，關卡 3 posmeta OpenAI 建議）：追平前確認 GD 沒有「凍結前就開始、還沒結束」的交易，也沒有預備交易
-- 取代「固定等 30 秒＝在途交易已結束」的推論；只讀系統檢視，不碰業務資料
create or replace function public.pm_inflight_before(p_ts timestamptz) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'old_xacts', (select count(*) from pg_stat_activity where backend_type = 'client backend' and pid <> pg_backend_pid() and xact_start is not null and xact_start < p_ts),
    'prepared', (select count(*) from pg_prepared_xacts),
    'max_prepared', current_setting('max_prepared_transactions')::int,
    'now', now()
  )
$$;
revoke all on function public.pm_inflight_before(timestamptz) from public, anon, authenticated;
grant execute on function public.pm_inflight_before(timestamptz) to service_role;
