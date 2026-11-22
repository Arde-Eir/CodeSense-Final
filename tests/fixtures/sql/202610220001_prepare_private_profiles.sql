-- Apply before deploying the private-profile login changes.
-- Then configure SUPABASE_URL and SUPABASE_SECRET_KEY on the backend, enable
-- Supabase Auth IP Address Forwarding, and deploy the backend and frontend.
-- Verify player-name sign-in before applying 202610220002_restrict_private_profiles.sql.
begin;
lock table public.users in share row exclusive mode;
grant usage on schema codesense_private to authenticated;

-- Player-name sign-in is case-insensitive; database uniqueness must agree.
do $$
begin
  if exists (select 1 from public.users group by lower(playername) having count(*) > 1) then
    raise exception 'Resolve player names that differ only by case before preparing private-profile login.';
  end if;
end;
$$;
create unique index users_playername_casefold_key on public.users (lower(playername));

create or replace function codesense_private.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and is_admin and not coalesce(is_banned, false)
  );
$$;

-- Reading users inside its own RLS expression recurses after broad SELECT
-- policies are removed. The fixed-path helper reads the existing flag safely.
create function codesense_private.profile_admin_flag_allowed(p_is_admin boolean)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select codesense_private.is_current_user_admin()
    or p_is_admin is not distinct from (select is_admin from public.users where id = auth.uid());
$$;
revoke all on function codesense_private.profile_admin_flag_allowed(boolean) from public, anon, authenticated;
grant execute on function codesense_private.profile_admin_flag_allowed(boolean) to authenticated;
alter policy "block self-admin grant" on public.users
using (codesense_private.profile_admin_flag_allowed(is_admin))
with check (codesense_private.profile_admin_flag_allowed(is_admin));

-- Publish only the fields already shown on public player cards. Keep contact
-- information and account privileges in users, outside this public read model.
create table public.player_profiles as
select id, playername, totalxp, currentlevel, sandbox_runs, quests_completed,
       createdat, lastactive, charactertype, user_type, displayed_title, badges,
       isactive, is_banned
from public.users
where isactive = true and not coalesce(is_banned, false);

alter table public.player_profiles add primary key (id);
alter table public.player_profiles add foreign key (id) references public.users(id) on update cascade on delete cascade;
alter table public.player_profiles enable row level security;
revoke all on public.player_profiles from public, anon, authenticated;
grant select on public.player_profiles to anon, authenticated;
create policy public_player_cards on public.player_profiles for select to anon, authenticated using (true);

create function codesense_private.sync_public_player_profile()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.player_profiles where id = old.id;
    return old;
  end if;
  if new.isactive = true and not coalesce(new.is_banned, false) then
    insert into public.player_profiles (
      id, playername, totalxp, currentlevel, sandbox_runs, quests_completed,
      createdat, lastactive, charactertype, user_type, displayed_title, badges, isactive, is_banned
    ) values (
      new.id, new.playername, new.totalxp, new.currentlevel, new.sandbox_runs, new.quests_completed,
      new.createdat, new.lastactive, new.charactertype, new.user_type, new.displayed_title, new.badges, new.isactive, new.is_banned
    ) on conflict (id) do update set
      playername = excluded.playername, totalxp = excluded.totalxp, currentlevel = excluded.currentlevel,
      sandbox_runs = excluded.sandbox_runs, quests_completed = excluded.quests_completed,
      createdat = excluded.createdat, lastactive = excluded.lastactive, charactertype = excluded.charactertype,
      user_type = excluded.user_type, displayed_title = excluded.displayed_title, badges = excluded.badges,
      isactive = excluded.isactive, is_banned = excluded.is_banned;
  else
    delete from public.player_profiles where id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function codesense_private.sync_public_player_profile() from public, anon, authenticated;
create trigger sync_public_player_profile after insert or update or delete on public.users
for each row execute function codesense_private.sync_public_player_profile();
alter publication supabase_realtime add table public.player_profiles;

create function codesense_private.guard_profile_insert()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not codesense_private.is_current_user_admin()
     and (coalesce(new.is_admin, false) or coalesce(new.is_banned, false)
          or new.ban_reason is not null or new.banned_at is not null) then
    raise exception 'Only an active administrator may assign account access fields.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function codesense_private.guard_profile_insert() from public, anon, authenticated;
create trigger guard_profile_insert before insert on public.users
for each row execute function codesense_private.guard_profile_insert();

-- Shared, short-lived login counters contain HMACs, never player names or IPs.
create table codesense_private.player_login_attempts (
  bucket text primary key,
  attempts integer not null check (attempts > 0),
  expires_at timestamptz not null
);
create index on codesense_private.player_login_attempts (expires_at);
alter table codesense_private.player_login_attempts enable row level security;
revoke all on codesense_private.player_login_attempts from public, anon, authenticated;

create function public.consume_player_login_attempt(p_ip_bucket text, p_player_bucket text)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  attempt_time timestamptz := clock_timestamp();
  current_bucket codesense_private.player_login_attempts;
begin
  if p_ip_bucket is null or p_ip_bucket !~ '^ip:[a-f0-9]{64}$'
     or p_player_bucket is null or p_player_bucket !~ '^player:[a-f0-9]{64}$' then
    raise exception 'Login rate-limit buckets must be server-generated HMACs.' using errcode = '22023';
  end if;

  delete from codesense_private.player_login_attempts
  where bucket in (
    select bucket from codesense_private.player_login_attempts
    where expires_at <= attempt_time
    order by expires_at, bucket limit 100 for update skip locked
  );

  insert into codesense_private.player_login_attempts as stored (bucket, attempts, expires_at)
  values (p_ip_bucket, 1, attempt_time + interval '60 seconds')
  on conflict (bucket) do update set
    attempts = case when stored.expires_at <= attempt_time then 1 else stored.attempts + 1 end,
    expires_at = case when stored.expires_at <= attempt_time
      then excluded.expires_at else stored.expires_at end
  returning * into current_bucket;
  if current_bucket.attempts > 60 then
    return greatest(1, ceil(extract(epoch from current_bucket.expires_at - attempt_time))::integer);
  end if;

  insert into codesense_private.player_login_attempts as stored (bucket, attempts, expires_at)
  values (p_player_bucket, 1, attempt_time + interval '60 seconds')
  on conflict (bucket) do update set
    attempts = case when stored.expires_at <= attempt_time then 1 else stored.attempts + 1 end,
    expires_at = case when stored.expires_at <= attempt_time
      then excluded.expires_at else stored.expires_at end
  returning * into current_bucket;
  if current_bucket.attempts > 10 then
    return greatest(1, ceil(extract(epoch from current_bucket.expires_at - attempt_time))::integer);
  end if;
  return 0;
end;
$$;
revoke all on function public.consume_player_login_attempt(text, text) from public, anon, authenticated;
grant execute on function public.consume_player_login_attempt(text, text) to service_role;

commit;
