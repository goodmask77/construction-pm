# pm_documents 真上鎖：沒登入＝什麼都看不到（2026-07-18）

> 前置已完成（App v1.6.0）：讀取路徑已帶登入身分——登入者的每個讀取請求都附登入權杖，
> 上鎖後照常看得到；沒登入的人會直接看到「登入畫面」（不再是訪客瀏覽）。
> D哥（LINE）與信件同步等後端走 service_role，自動繞過 RLS，不受影響。
> 廠商/外部人要看 → 幫他建一個 guest 帳號（帳號分頁一鍵建立，角色設「檢視」、金額關閉）。

## 上鎖 SQL（Supabase → SQL Editor → 貼上 → Run）

```sql
-- 確保 RLS 已開啟
alter table public.pm_documents enable row level security;

-- 讀取：改成「只有登入者可讀」（移除舊的 anon 可讀政策）
drop policy if exists pmdoc_read_all on public.pm_documents;
drop policy if exists pmdoc_read_auth on public.pm_documents;
create policy pmdoc_read_auth on public.pm_documents
  for select to authenticated using (true);

-- 寫入：維持「只有登入者可寫」（重跑一次確保存在，重複執行無害）
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

## 如果出問題，一鍵回到「沒登入也能看」

```sql
drop policy if exists pmdoc_read_auth on public.pm_documents;
create policy pmdoc_read_all on public.pm_documents
  for select using (true);
```

## 驗收（貼完 SQL 後）

1. 你已登入的視窗 → 重新整理 → 資料照常都在（登入者讀取 OK）。
2. 另開「無痕視窗」→ 打開 App → 直接看到登入畫面、看不到任何資料（訪客被鎖 OK）。
3. 無痕視窗登入 guest 或自己的帳號 → 登入後資料出現。
4. LINE 裡叫 D哥 查任務/記一筆 → 照常運作（service_role 不受鎖影響）。
