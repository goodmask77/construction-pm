# pm_documents RLS 設定（資料庫上鎖）

策略：**沒登入也能「看」（anon SELECT），只有登入者能「改」（authenticated 寫入）**。
D哥 webhook 用 service_role → 自動繞過 RLS，不受影響。

前置（已完成）：前端寫入已改走帶 session 的 client（commit「RLS 準備(步驟1)」）。

## 開啟 RLS（在 Supabase → SQL Editor 貼上執行）

```sql
-- 開啟 Row Level Security
alter table public.pm_documents enable row level security;

-- 讀取：任何人都可 SELECT（含未登入訪客瀏覽）
drop policy if exists pmdoc_read_all on public.pm_documents;
create policy pmdoc_read_all on public.pm_documents
  for select using (true);

-- 寫入：只有登入者(authenticated)可 新增/修改/刪除
drop policy if exists pmdoc_insert_auth on public.pm_documents;
create policy pmdoc_insert_auth on public.pm_documents
  for insert to authenticated with check (true);

drop policy if exists pmdoc_update_auth on public.pm_documents;
create policy pmdoc_update_auth on public.pm_documents
  for update to authenticated using (true) with check (true);

drop policy if exists pmdoc_delete_auth on public.pm_documents;
create policy pmdoc_delete_auth on public.pm_documents
  for delete to authenticated using (true);
```

## 如果出問題，一鍵關掉 RLS（回到原狀）

```sql
alter table public.pm_documents disable row level security;
```

## 驗收

1. 登入 → 改個小東西 → 重新整理 → 有存住（authenticated 寫入 OK）。
2. 另開無痕視窗（沒登入）→ 看得到資料、但不能改（anon 只能讀）。
3. D哥 LINE 操作仍可寫（service_role 繞過 RLS）。
