-- 銷售數據主 App 設定留 GD（2026-10-16）：先登記「擁有者＝GD」（寫入鎖最長鍵頭；pos 域切到新殼後主 App 照常能改這兩份）；只新增
insert into public.pm_domain_lock(prefix, domain, owner, epoch, reason) values
  ('sp_finance_pm_pos_flags', 'posapp', 'gd', 0, '主 App 品項標記留 GD'),
  ('sp_finance_pm_pos_idlecfg', 'posapp', 'gd', 0, '主 App 沒賣預警設定留 GD')
on conflict (prefix) do nothing;
