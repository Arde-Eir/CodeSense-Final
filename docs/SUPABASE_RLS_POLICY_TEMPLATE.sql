-- CodeSense RLS policy template
--
-- Review this file against the real staging schema before applying it. It assumes
-- UUID ownership columns named `id` on users and `userid` on user-owned tables.
-- Run it as a migration owner, never from the browser.
--
-- MIGRATION NOTE: the restricted users-column grants below intentionally reject
-- the app's current direct browser writes to protected admin/progression fields.
-- Move those writes to validated SECURITY DEFINER RPCs before applying this
-- template in production, then test every role in SUPABASE_RLS_CHECKLIST.md.
-- Existing policies are OR-combined with these policies. Audit and remove any
-- broader legacy policy separately; creating these policies does not narrow it.
-- This is not a deployable Campaign Mode fix: the owner INSERT/UPDATE/DELETE
-- policies for mission_progress below still permit direct client progress
-- writes. Replace them with the verified server-owned RPC design described
-- in SUPABASE_RLS_CHECKLIST.md before a production rollout.

begin;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.is_admin from public.users as u where u.id = auth.uid()),
    false
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

alter table public.users enable row level security;
alter table public.mission_progress enable row level security;
alter table public.reports enable row level security;
alter table public.activity_log enable row level security;
alter table public.quests enable row level security;
alter table public.level_info enable row level security;
alter table public.patch_notes enable row level security;
alter table public.announcements enable row level security;
alter table public.system_settings enable row level security;
alter table public.admin_audit_log enable row level security;

-- Users: this intentionally does not add a broad public SELECT policy. Expose
-- leaderboard fields through a restricted view/RPC, and resolve the current
-- username-login caveat before production.
drop policy if exists "users read own profile" on public.users;
create policy "users read own profile"
on public.users for select
to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists "users insert own profile" on public.users;
create policy "users insert own profile"
on public.users for insert
to authenticated
with check (id = auth.uid() and coalesce(is_admin, false) = false);

-- Column-level grants are required because a row policy alone cannot prevent a
-- user from changing privilege/XP columns on their own row.
revoke update on public.users from authenticated;
grant update (playername, email, charactertype, user_type, lastactive)
on public.users to authenticated;

drop policy if exists "users update own profile" on public.users;
create policy "users update own profile"
on public.users for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "admins manage users" on public.users;
create policy "admins manage users"
on public.users for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Repeatable ownership policies for private user data.
drop policy if exists "owners read mission progress" on public.mission_progress;
create policy "owners read mission progress" on public.mission_progress
for select to authenticated using (userid = auth.uid() or public.is_admin());
drop policy if exists "owners insert mission progress" on public.mission_progress;
create policy "owners insert mission progress" on public.mission_progress
for insert to authenticated with check (userid = auth.uid());
drop policy if exists "owners update mission progress" on public.mission_progress;
create policy "owners update mission progress" on public.mission_progress
for update to authenticated using (userid = auth.uid()) with check (userid = auth.uid());
drop policy if exists "owners delete mission progress" on public.mission_progress;
create policy "owners delete mission progress" on public.mission_progress
for delete to authenticated using (userid = auth.uid());

drop policy if exists "owners read reports" on public.reports;
create policy "owners read reports" on public.reports
for select to authenticated using (userid = auth.uid() or public.is_admin());
drop policy if exists "owners insert reports" on public.reports;
create policy "owners insert reports" on public.reports
for insert to authenticated with check (userid = auth.uid());
drop policy if exists "owners update reports" on public.reports;
create policy "owners update reports" on public.reports
for update to authenticated using (userid = auth.uid()) with check (userid = auth.uid());
drop policy if exists "owners delete reports" on public.reports;
create policy "owners delete reports" on public.reports
for delete to authenticated using (userid = auth.uid());

drop policy if exists "owners read activity" on public.activity_log;
create policy "owners read activity" on public.activity_log
for select to authenticated using (userid = auth.uid() or public.is_admin());
drop policy if exists "owners insert activity" on public.activity_log;
create policy "owners insert activity" on public.activity_log
for insert to authenticated with check (userid = auth.uid());

-- Public content is readable; only administrators may mutate it. Add an
-- `isactive`/publication predicate where the real table supports one.
drop policy if exists "read quests" on public.quests;
create policy "read quests" on public.quests for select to anon, authenticated
using (isactive = true or public.is_admin());
drop policy if exists "admins manage quests" on public.quests;
create policy "admins manage quests" on public.quests for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read level info" on public.level_info;
create policy "read level info" on public.level_info for select to anon, authenticated using (true);
drop policy if exists "admins manage level info" on public.level_info;
create policy "admins manage level info" on public.level_info for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read patch notes" on public.patch_notes;
create policy "read patch notes" on public.patch_notes for select to anon, authenticated using (true);
drop policy if exists "admins manage patch notes" on public.patch_notes;
create policy "admins manage patch notes" on public.patch_notes for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read announcements" on public.announcements;
create policy "read announcements" on public.announcements for select to anon, authenticated using (true);
drop policy if exists "admins manage announcements" on public.announcements;
create policy "admins manage announcements" on public.announcements for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read public settings" on public.system_settings;
create policy "read public settings" on public.system_settings for select to anon, authenticated
using (key in ('maintenance_mode', 'maintenance_message'));
drop policy if exists "admins manage settings" on public.system_settings;
create policy "admins manage settings" on public.system_settings for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins read audit log" on public.admin_audit_log;
create policy "admins read audit log" on public.admin_audit_log for select to authenticated
using (public.is_admin());
drop policy if exists "admins insert own audit events" on public.admin_audit_log;
create policy "admins insert own audit events" on public.admin_audit_log for insert to authenticated
with check (public.is_admin() and admin_id = auth.uid());

-- Storage object ownership. The bucket itself must already exist.
drop policy if exists "public reads avatars" on storage.objects;
create policy "public reads avatars" on storage.objects for select to anon, authenticated
using (bucket_id = 'Avatars');

drop policy if exists "owners insert avatars" on storage.objects;
create policy "owners insert avatars" on storage.objects for insert to authenticated
with check (bucket_id = 'Avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "owners update avatars" on storage.objects;
create policy "owners update avatars" on storage.objects for update to authenticated
using (bucket_id = 'Avatars' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'Avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "owners delete avatars" on storage.objects;
create policy "owners delete avatars" on storage.objects for delete to authenticated
using (bucket_id = 'Avatars' and (storage.foldername(name))[1] = auth.uid()::text);

commit;
