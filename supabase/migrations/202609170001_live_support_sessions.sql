-- Apply with the Supabase migration owner before enabling live support.
-- No service-role key is exposed to the browser or analysis backend.

begin;

create table if not exists public.support_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.users(id),
  admin_name text not null,
  learner_id uuid not null references public.users(id),
  status text not null default 'requested'
    check (status in ('requested', 'active', 'declined', 'ended')),
  requested_at timestamptz not null default now(),
  accepted_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  check (admin_id <> learner_id)
);

create unique index if not exists support_one_open_session_per_learner
  on public.support_sessions (learner_id)
  where status in ('requested', 'active');

create index if not exists support_sessions_admin_recent
  on public.support_sessions (admin_id, requested_at desc);

create or replace function public.support_admin_is_eligible(p_admin_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select u.is_admin and not coalesce(u.is_banned, false)
      from public.users as u where u.id = p_admin_id),
    false
  );
$$;

revoke all on function public.support_admin_is_eligible(uuid) from public;
grant execute on function public.support_admin_is_eligible(uuid) to authenticated;

create or replace function public.support_learner_is_eligible(p_learner_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select not coalesce(u.is_banned, false) and not coalesce(u.is_admin, false)
      from public.users as u where u.id = p_learner_id),
    false
  );
$$;

revoke all on function public.support_learner_is_eligible(uuid) from public;
grant execute on function public.support_learner_is_eligible(uuid) to authenticated;

create table if not exists public.support_actions (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.support_sessions(id),
  admin_id uuid not null references public.users(id),
  kind text not null check (kind in ('click', 'text', 'select')),
  position_x numeric,
  position_y numeric,
  text_length integer,
  created_at timestamptz not null default now()
);

create index if not exists support_actions_session_recent
  on public.support_actions (session_id, created_at desc);

alter table public.support_actions enable row level security;
revoke all on public.support_actions from anon, authenticated;
grant select on public.support_actions to authenticated;

drop policy if exists "support participants read actions" on public.support_actions;
create policy "support participants read actions"
  on public.support_actions for select to authenticated
  using (exists (
    select 1 from public.support_sessions as s
    where s.id = session_id
      and (s.admin_id = (select auth.uid()) or s.learner_id = (select auth.uid()))
  ));

alter table public.support_sessions enable row level security;
revoke all on public.support_sessions from anon, authenticated;
grant select on public.support_sessions to authenticated;

drop policy if exists "support participants read session" on public.support_sessions;
create policy "support participants read session"
  on public.support_sessions for select to authenticated
  using (
    public.support_admin_is_eligible(admin_id)
    and public.support_learner_is_eligible(learner_id)
    and (admin_id = (select auth.uid()) or learner_id = (select auth.uid()))
  );

create or replace function public.support_is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.support_admin_is_eligible((select auth.uid()));
$$;

revoke all on function public.support_is_admin() from public;
grant execute on function public.support_is_admin() to authenticated;

drop policy if exists "admins preview learner progress" on public.mission_progress;
create policy "admins preview learner progress"
  on public.mission_progress for select to authenticated
  using (public.support_is_admin());

drop policy if exists "admins preview learner reports" on public.reports;
create policy "admins preview learner reports"
  on public.reports for select to authenticated
  using (public.support_is_admin());

drop policy if exists "admins preview learner activity" on public.activity_log;
create policy "admins preview learner activity"
  on public.activity_log for select to authenticated
  using (public.support_is_admin());

create or replace function public.request_support_session(p_learner_id uuid)
returns public.support_sessions
language plpgsql security definer
set search_path = ''
as $$
declare
  current_session public.support_sessions;
begin
  if (select auth.uid()) is null or not public.support_is_admin() then
    raise exception 'Only an authenticated administrator can request live help.' using errcode = '42501';
  end if;
  if p_learner_id is null or p_learner_id = (select auth.uid()) then
    raise exception 'Choose a learner account other than your own.' using errcode = '22023';
  end if;
  if not public.support_learner_is_eligible(p_learner_id) then
    raise exception 'Live help is only available for non-banned learner accounts.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.support_sessions
    where learner_id = p_learner_id
      and status = 'declined' and ended_at > now() - interval '15 minutes'
  ) then
    raise exception 'The learner declined live help. Wait 15 minutes before requesting again.' using errcode = '22023';
  end if;

  update public.support_sessions
    set status = 'ended', ended_at = now()
    where learner_id = p_learner_id
      and status in ('requested', 'active')
      and (expires_at <= now() or not public.support_admin_is_eligible(admin_id));

  select * into current_session
    from public.support_sessions
    where learner_id = p_learner_id and status in ('requested', 'active')
    for update;
  if found then
    if current_session.admin_id = (select auth.uid()) then
      return current_session;
    end if;
    raise exception 'Another administrator already has a pending or active help session for this learner.'
      using errcode = '23505';
  end if;

  insert into public.support_sessions (admin_id, admin_name, learner_id)
    select u.id, u.playername, p_learner_id
      from public.users as u where u.id = (select auth.uid())
    returning * into current_session;
  return current_session;
end;
$$;

create or replace function public.accept_support_session(p_session_id uuid)
returns public.support_sessions
language plpgsql security definer
set search_path = ''
as $$
declare
  current_session public.support_sessions;
begin
  select * into current_session
    from public.support_sessions where id = p_session_id for update;
  if not found or current_session.learner_id <> (select auth.uid()) then
    raise exception 'This help request is not addressed to your account.' using errcode = '42501';
  end if;
  if current_session.status = 'active' and current_session.expires_at > now() then
    return current_session;
  end if;
  if current_session.status <> 'requested' or current_session.expires_at <= now() then
    raise exception 'This help request is no longer available.' using errcode = '22023';
  end if;
  if not public.support_admin_is_eligible(current_session.admin_id) then
    raise exception 'The requesting administrator no longer has permission to provide live help.' using errcode = '42501';
  end if;
  if not public.support_learner_is_eligible(current_session.learner_id) then
    raise exception 'This learner account is no longer eligible for live help.' using errcode = '42501';
  end if;

  update public.support_sessions
    set status = 'active', accepted_at = now(), expires_at = now() + interval '60 minutes'
    where id = p_session_id returning * into current_session;
  return current_session;
end;
$$;

create or replace function public.decline_support_session(p_session_id uuid)
returns public.support_sessions
language plpgsql security definer
set search_path = ''
as $$
declare
  current_session public.support_sessions;
begin
  select * into current_session
    from public.support_sessions where id = p_session_id for update;
  if not found or current_session.learner_id <> (select auth.uid()) then
    raise exception 'This help request is not addressed to your account.' using errcode = '42501';
  end if;
  if current_session.status = 'declined' then
    return current_session;
  end if;
  if current_session.status <> 'requested' then
    raise exception 'Only a pending help request can be declined.' using errcode = '22023';
  end if;

  update public.support_sessions
    set status = 'declined', ended_at = now()
    where id = p_session_id returning * into current_session;
  return current_session;
end;
$$;

create or replace function public.end_support_session(p_session_id uuid)
returns public.support_sessions
language plpgsql security definer
set search_path = ''
as $$
declare
  current_session public.support_sessions;
begin
  select * into current_session
    from public.support_sessions where id = p_session_id for update;
  if not found or (
    current_session.admin_id <> (select auth.uid())
    and current_session.learner_id <> (select auth.uid())
  ) then
    raise exception 'You are not a participant in this help session.' using errcode = '42501';
  end if;
  if current_session.status in ('ended', 'declined') then
    return current_session;
  end if;

  update public.support_sessions
    set status = 'ended', ended_at = now()
    where id = p_session_id returning * into current_session;
  return current_session;
end;
$$;

create or replace function public.record_support_action(
  p_session_id uuid,
  p_kind text,
  p_position_x numeric,
  p_position_y numeric,
  p_text_length integer
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  current_session public.support_sessions;
begin
  select * into current_session
    from public.support_sessions where id = p_session_id for update;
  if not found or current_session.admin_id <> (select auth.uid())
    or not public.support_is_admin()
    or not public.support_learner_is_eligible(current_session.learner_id)
    or current_session.status <> 'active' or current_session.expires_at <= now() then
    raise exception 'Only the assigned administrator can control an active help session.' using errcode = '42501';
  end if;
  if p_kind not in ('click', 'text', 'select') then
    raise exception 'Only click, text, and select actions can be recorded.' using errcode = '22023';
  end if;
  if p_kind = 'click' and (p_position_x is null or p_position_y is null
    or p_position_x < 0 or p_position_x > 1 or p_position_y < 0 or p_position_y > 1) then
    raise exception 'Click coordinates must be between zero and one.' using errcode = '22023';
  end if;
  if p_kind = 'text' and (p_text_length is null or p_text_length < 0 or p_text_length > 8000) then
    raise exception 'Text length must be between zero and 8000.' using errcode = '22023';
  end if;
  insert into public.support_actions (session_id, admin_id, kind, position_x, position_y, text_length)
    values (p_session_id, current_session.admin_id, p_kind, p_position_x, p_position_y, p_text_length);
end;
$$;

revoke all on function public.request_support_session(uuid) from public;
revoke all on function public.accept_support_session(uuid) from public;
revoke all on function public.decline_support_session(uuid) from public;
revoke all on function public.end_support_session(uuid) from public;
revoke all on function public.record_support_action(uuid, text, numeric, numeric, integer) from public;
grant execute on function public.request_support_session(uuid) to authenticated;
grant execute on function public.accept_support_session(uuid) to authenticated;
grant execute on function public.decline_support_session(uuid) to authenticated;
grant execute on function public.end_support_session(uuid) to authenticated;
grant execute on function public.record_support_action(uuid, text, numeric, numeric, integer) to authenticated;

drop policy if exists "support participants receive broadcast" on realtime.messages;
create policy "support participants receive broadcast"
  on realtime.messages for select to authenticated
  using (
    extension = 'broadcast'
    and exists (
      select 1 from public.support_sessions as s
      where (select realtime.topic()) = 'support:' || s.id::text
        and s.status = 'active'
        and s.expires_at > now()
        and (s.admin_id = (select auth.uid()) or s.learner_id = (select auth.uid()))
    )
  );

drop policy if exists "support participants send broadcast" on realtime.messages;
create policy "support participants send broadcast"
  on realtime.messages for insert to authenticated
  with check (
    extension = 'broadcast'
    and exists (
      select 1 from public.support_sessions as s
      where (select realtime.topic()) = 'support:' || s.id::text
        and s.status = 'active'
        and s.expires_at > now()
        and (s.admin_id = (select auth.uid()) or s.learner_id = (select auth.uid()))
    )
  );

commit;
