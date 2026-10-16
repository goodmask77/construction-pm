-- 權限／身分 B 模式搬家準備（2026-10-16，abgd 第三階段）：先登記「擁有者＝GD」（切換時由新殼控制器改歸屬）；DD 收入職文件情境改歸 crewgd（留 GD，不跟名冊一起切）；只新增／改標籤
insert into public.pm_domain_lock(prefix, domain, owner, epoch, reason) values
  ('sp_finance_pm_prep_perm', 'perm', 'gd', 0, '權限名單（B 模式準備）'),
  ('sp_finance_pm_prep_tabs', 'perm', 'gd', 0, '分頁名稱（B 模式準備）'),
  ('sp_finance_pm_prep_fav', 'perm', 'gd', 0, '常用清單（B 模式準備）'),
  ('sp_finance_pm_prep_hide', 'perm', 'gd', 0, '預做隱藏（B 模式準備）'),
  ('sp_finance_pm_prep_animpref', 'perm', 'gd', 0, '動畫偏好（B 模式準備）'),
  ('sp_finance_pm_prep_bind', 'identity', 'gd', 0, 'GD 綁定 token（B 模式準備）'),
  ('sp_finance_pm_prep_logincode', 'identity', 'gd', 0, '4 位數登入碼（B 模式準備）')
on conflict (prefix) do nothing;
update public.pm_domain_lock set domain = 'crewgd', reason = 'DD 收入職文件 15 分鐘情境：留 GD（不跟名冊切）' where prefix = 'pm_hrdoc_pending' and owner = 'gd';
