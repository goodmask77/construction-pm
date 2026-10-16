-- DD 批 2（2026-10-17）：記事本 pm_bot_memory 登記「擁有者＝GD」（ddmem 域；切換時由新殼控制器改歸屬）；只新增
insert into public.pm_domain_lock(prefix, domain, owner, epoch, reason) values
  ('pm_bot_memory', 'ddmem', 'gd', 0, 'DD 長期記事本（B 模式準備）')
on conflict (prefix) do nothing;
