-- Run once in Supabase SQL Editor before deploying the notification client.
begin;

create table public.notification_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_id text not null check (
    length(notification_id) <= 256
    and notification_id ~ '^(announcement|quest|admin|ach|rank):[[:alnum:]_-]+$'
  ),
  observed_at timestamptz not null default now(),
  read_at timestamptz,
  dismissed_at timestamptz,
  constraint notification_receipts_pkey primary key (user_id, notification_id)
);

comment on table public.notification_receipts is
  'Account-owned notification receipts. Dismissal and reading are monotonic; no browser-specific retention limit.';

alter table public.notification_receipts enable row level security;
revoke all on public.notification_receipts from public, anon, authenticated;
grant select on public.notification_receipts to authenticated;
create policy notification_receipts_read_own on public.notification_receipts
  for select to authenticated using (user_id = (select auth.uid()));

create schema if not exists private;
create function private.notification_receipt_ids(p_notification_ids text[])
returns setof text language plpgsql immutable set search_path = '' as $$
begin
  if p_notification_ids is null or cardinality(p_notification_ids) > 1000 then
    raise exception using errcode = '22023', message = 'Provide at most 1000 notification IDs per request.';
  end if;
  if exists (
    select 1 from unnest(p_notification_ids) as ids(id)
    where id is null or length(id) > 256
      or id !~ '^(announcement|quest|admin|ach|rank):[[:alnum:]_-]+$'
  ) then
    raise exception using errcode = '22023', message = 'Notification IDs must have a supported kind and a nonempty canonical identifier.';
  end if;
  return query select distinct id from unnest(p_notification_ids) as ids(id);
end;
$$;
revoke all on function private.notification_receipt_ids(text[]) from public, anon, authenticated;

create function public.observe_notifications(p_owner_id uuid, p_notification_ids text[])
returns table (notification_id text, observed_at timestamptz, read_at timestamptz, dismissed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null or p_owner_id is distinct from owner_id then
    raise exception using errcode = '42501', message = 'Sign in to load notification receipts.';
  end if;
  insert into public.notification_receipts (user_id, notification_id)
    select owner_id, id from private.notification_receipt_ids(p_notification_ids) as ids(id)
    on conflict on constraint notification_receipts_pkey do nothing;
  return query select stored.notification_id, stored.observed_at, stored.read_at, stored.dismissed_at
    from public.notification_receipts as stored
    where stored.user_id = owner_id and stored.notification_id = any(p_notification_ids);
end;
$$;

create function public.mark_notifications_read(p_owner_id uuid, p_notification_ids text[])
returns table (notification_id text, observed_at timestamptz, read_at timestamptz, dismissed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null or p_owner_id is distinct from owner_id then
    raise exception using errcode = '42501', message = 'Sign in to mark notifications read.';
  end if;
  return query insert into public.notification_receipts as stored (user_id, notification_id, read_at)
    select owner_id, id, now() from private.notification_receipt_ids(p_notification_ids) as ids(id)
    on conflict on constraint notification_receipts_pkey do update
      set read_at = coalesce(stored.read_at, excluded.read_at)
    returning stored.notification_id, stored.observed_at, stored.read_at, stored.dismissed_at;
end;
$$;

create function public.dismiss_notifications(p_owner_id uuid, p_notification_ids text[])
returns table (notification_id text, observed_at timestamptz, read_at timestamptz, dismissed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null or p_owner_id is distinct from owner_id then
    raise exception using errcode = '42501', message = 'Sign in to dismiss notifications.';
  end if;
  return query insert into public.notification_receipts as stored (user_id, notification_id, read_at, dismissed_at)
    select owner_id, id, now(), now() from private.notification_receipt_ids(p_notification_ids) as ids(id)
    on conflict on constraint notification_receipts_pkey do update
      set read_at = coalesce(stored.read_at, excluded.read_at),
          dismissed_at = coalesce(stored.dismissed_at, excluded.dismissed_at)
    returning stored.notification_id, stored.observed_at, stored.read_at, stored.dismissed_at;
end;
$$;

revoke all on function public.observe_notifications(uuid, text[]) from public, anon, authenticated;
revoke all on function public.mark_notifications_read(uuid, text[]) from public, anon, authenticated;
revoke all on function public.dismiss_notifications(uuid, text[]) from public, anon, authenticated;
grant execute on function public.observe_notifications(uuid, text[]) to authenticated;
grant execute on function public.mark_notifications_read(uuid, text[]) to authenticated;
grant execute on function public.dismiss_notifications(uuid, text[]) to authenticated;

alter publication supabase_realtime add table public.notification_receipts;
notify pgrst, 'reload schema';
commit;
