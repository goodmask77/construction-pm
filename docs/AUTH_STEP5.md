# 階段 5 操作單：App 內管理帳號＋權限

> 完成後，你就能在 App 的「帳號」分頁：建帳號、設可見空間/頁面/可編輯/看金額開關。

## A. 跑一段 SQL（Supabase → SQL Editor → 貼上 → Run）
加欄位、開放管理員讀改所有帳號、新帳號自動建 profile。

```sql
alter table public.profiles
  add column if not exists spaces text[] default '{}',
  add column if not exists view_pages text[] default '{}';

create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

drop policy if exists "admin read all" on public.profiles;
create policy "admin read all" on public.profiles for select to authenticated using (public.is_admin());
drop policy if exists "admin update all" on public.profiles;
create policy "admin update all" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (new.id, new.email, split_part(new.email,'@',1), 'staff')
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
```

## B. 在 Vercel 加一把後端金鑰（讓「App 內一鍵建帳號」能運作）
1. **Supabase** → 左下 ⚙ **Project Settings** → **API** → 找到 **`service_role`**（Secret，不是 anon）→ Copy。
   - ⚠️ 這把是「最高權限金鑰」，只能放後端、絕不外流。
2. **Vercel** → 你的專案 → **Settings** → **Environment Variables** → 各加一筆（Production 勾選）：
   | Name | Value |
   |---|---|
   | `SUPABASE_SERVICE_ROLE_KEY` | （貼上剛剛的 service_role） |
   | `SUPABASE_URL` | 你的 Supabase Project URL（跟 VITE_SUPABASE_URL 一樣那串） |
3. 存檔後**跟我說一聲**，我重新部署讓金鑰生效。

## 完成後你可以做什麼
- 「帳號」分頁 → 填 顯示名稱＋登入帳號＋密碼 → 一鍵建帳號。
- 每個帳號卡片可切：可見空間、可見頁面、可編輯頁面、看金額開關、重設密碼、刪除。

> 只跑 A（不加 B）也行：你已能「編輯現有帳號的權限」，只是「App 內新增帳號」要等 B 完成；在那之前新帳號可照階段 1 在 Supabase 後台建。
