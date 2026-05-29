-- Fix signup profile creation for CodeSense.
-- Run this in Supabase SQL Editor for the project used by Netlify.
--
-- Why this exists:
-- 1. Supabase Auth creates rows in auth.users.
-- 2. CodeSense expects a matching public.users profile row.
-- 3. Client-side inserts into public.users are controlled by RLS, so a missing
--    trigger/policy shows: "new row violates row-level security policy".

alter table public.users enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (
    id,
    email,
    playername,
    user_type,
    lastactive
  )
  values (
    new.id,
    new.email,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'playername', ''),
      split_part(new.email, '@', 1)
    ),
    coalesce(nullif(new.raw_user_meta_data ->> 'user_type', ''), 'student'),
    now()
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users
    where id = auth.uid()
      and is_admin = true
      and coalesce(is_banned, false) = false
  );
$$;

grant execute on function public.is_current_user_admin() to authenticated;

drop policy if exists authenticated_can_read_all on public.users;
create policy authenticated_can_read_all
on public.users
for select
to authenticated
using (true);

-- The login screen looks up an email by player name before the user has a
-- session. Keep this only if username login is required.
drop policy if exists anon_can_read_login_profiles on public.users;
create policy anon_can_read_login_profiles
on public.users
for select
to anon
using (true);

drop policy if exists users_insert_own on public.users;
create policy users_insert_own
on public.users
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists users_update_own on public.users;
create policy users_update_own
on public.users
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists admins_update_any on public.users;
create policy admins_update_any
on public.users
for update
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());
