-- 夥伴名冊拆分（2026-10-16 張良選 A：這次只搬人資月檔＋打卡＋補卡）：留 GD 的三份先登記「擁有者＝GD」（寫入鎖最長鍵頭；crew 域切到新殼後照常在 GD 寫）；只新增
--   名冊（角色／停權／LINE 綁定＝GD 每個請求的權限判斷）、身分證欄名單、DD 收入職文件 15 分鐘情境
insert into public.pm_domain_lock(prefix, domain, owner, epoch, reason) values
  ('sp_crew_kb_roster', 'crewapp', 'gd', 0, '名冊留 GD（權限判斷；等新殼有自己的登入時跟權限／身分一起搬）'),
  ('sp_finance_pm_hr_idlock', 'crewapp', 'gd', 0, '身分證欄名單留 GD（權限）'),
  ('pm_hrdoc_pending', 'crewapp', 'gd', 0, 'DD 收入職文件 15 分鐘情境留 GD')
on conflict (prefix) do nothing;
