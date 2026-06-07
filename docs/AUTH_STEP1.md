# 階段 1 操作單（你在 Supabase 後台做，我在旁邊給指令）

> 登入方式已定：**假信箱 + 密碼**（例：`zhang@ground.local`）。
> 這階段做完，下一步我就把 App 的登入改成真帳號密碼。

## 你要做的 3 件事

### ① 開啟 Email 登入、關掉開放註冊
Supabase 後台 → **Authentication** → **Sign In / Providers**：
- 開啟 **Email**。
- 關閉 **Allow new users to sign up**（只有你能建帳號，外人不能自己註冊）。
- 若有 **Confirm email** 選項，關掉（假信箱收不到驗證信）。

### ② 建立每位夥伴的帳號
Supabase 後台 → **Authentication** → **Users** → **Add user**：
- Email：用 `名字@ground.local`（例：`zhang@ground.local`）
- Password：自訂（之後可改）
- **勾選 Auto Confirm User**（不寄驗證信）
- 每位夥伴重複一次。

### ③ 建 profiles 表 + 寫入角色
Supabase 後台 → **SQL Editor** → New query → 貼上下面整段 → Run。

```sql
-- 1) 建帳號資料表（uid ↔ 顯示名稱/角色/部門/可否看金額）
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  display_name text not null,
  role text not null default 'staff',   -- admin | manager | staff | viewer
  dept text,
  pages text[] default '{}',
  can_view_money boolean default false,
  active boolean default true,
  created_at timestamptz default now()
);

-- 2) 把剛剛建的 auth 帳號，對應到角色（請依你的名單修改下面 values）
insert into profiles (id, email, display_name, role, dept, can_view_money)
select u.id, u.email, x.display_name, x.role, x.dept, x.can_view_money
from auth.users u
join (values
  ('zhang@ground.local', '張良', 'admin',   '管理', true),
  ('lw@ground.local',    'LW',   'manager', '工務', true),
  ('wayne@ground.local', 'Wayne','staff',   '設計', false),
  ('toby@ground.local',  'Toby', 'staff',   '採購', false)
  -- ↑ 照你的實際名單增刪；email 要和步驟②建的完全一致
) as x(email, display_name, role, dept, can_view_money)
  on u.email = x.email
on conflict (id) do update set
  display_name = excluded.display_name, role = excluded.role,
  dept = excluded.dept, can_view_money = excluded.can_view_money;

-- 3) 確認結果
select email, display_name, role, dept, can_view_money from profiles order by role;
```

## 帳號對照表（你填，我幫你把上面 SQL 改好）
| 顯示名稱 | 假信箱（登入帳號） | 密碼 | 角色 | 部門 | 看金額 |
|---|---|---|---|---|---|
| 張良 | zhang@ground.local | （你定） | admin | 管理 | 是 |
|  |  |  |  |  |  |

> 角色：admin=全權／manager=看金額改進度／staff=看不到金額／viewer=唯讀
> 把這張表填好給我，我就把 SQL 的 values 區塊改成你的名單，你貼上就好。
