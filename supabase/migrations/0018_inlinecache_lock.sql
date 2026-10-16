-- inline 衍生快取留 GD（2026-10-16，abgd 搬家 inline 域 B 模式）：衍生快取的鍵頭先登記「擁有者＝GD」
--   寫入鎖觸發器 pm_lock_trg 用最長鍵頭；inline 域（sp_finance_pm_inline）切到新殼後，這些更長的鍵頭仍歸 GD，GD 排程照常重算寫入
--   只新增、已存在就不動
insert into public.pm_domain_lock(prefix, domain, owner, epoch, reason) values
  ('sp_finance_pm_inline_cs_', 'inlinecache', 'gd', 0, 'inline 衍生快取留 GD（顧客分段）'),
  ('sp_finance_pm_inline_nr_', 'inlinecache', 'gd', 0, 'inline 衍生快取留 GD（新回名單）'),
  ('sp_finance_pm_inline_insights', 'inlinecache', 'gd', 0, 'inline 衍生快取留 GD（洞察）'),
  ('sp_finance_pm_inline_custidx', 'inlinecache', 'gd', 0, 'inline 衍生快取留 GD（顧客庫索引）'),
  ('sp_finance_pm_inline_ph3_', 'inlinecache', 'gd', 0, 'inline 衍生快取留 GD（電話索引）'),
  ('sp_finance_pm_inline_ph_', 'inlinecache', 'gd', 0, 'inline 衍生快取留 GD（舊版電話索引，重建時清）'),
  ('sp_finance_pm_inline_outlook', 'inlinecache', 'gd', 0, 'inline 衍生快取留 GD（近期展望快照）'),
  ('sp_finance_pm_inline_alerts', 'inlinecache', 'gd', 0, 'inline 衍生快取留 GD（提醒去重紀錄）')
on conflict (prefix) do nothing;
