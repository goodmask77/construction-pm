-- DD 批 3（2026-10-17）：CC 收件匣 pm_cc_inbox 登記「擁有者＝GD」（ddcc 域；切換時由新殼控制器改歸屬）；只新增
insert into public.pm_domain_lock(prefix, domain, owner, epoch, reason) values
  ('pm_cc_inbox', 'ddcc', 'gd', 0, 'CC 收件匣（B 模式準備）')
on conflict (prefix) do nothing;
