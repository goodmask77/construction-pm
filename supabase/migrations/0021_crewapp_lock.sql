-- 夥伴名冊 DD 對話暫存留 GD（2026-10-16）：先登記「擁有者＝GD」（寫入鎖最長鍵頭；crew 域切到新殼後 DD 收入職文件照常）；只新增
insert into public.pm_domain_lock(prefix, domain, owner, epoch, reason) values
  ('pm_hrdoc_pending', 'crewapp', 'gd', 0, 'DD 收入職文件 15 分鐘情境留 GD')
on conflict (prefix) do nothing;
