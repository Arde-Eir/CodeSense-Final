-- Apply only after the backend login and player_profiles frontend are deployed.
begin;

do $$
declare
  existing_policy record;
  user_columns text;
begin
  if to_regclass('public.player_profiles') is null then
    raise exception 'Apply 202610220001_prepare_private_profiles.sql before restricting users.';
  end if;
  for existing_policy in
    select policyname from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'users' and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.users', existing_policy.policyname);
  end loop;
  select string_agg(quote_ident(attname), ', ' order by attnum) into user_columns
    from pg_catalog.pg_attribute
    where attrelid = 'public.users'::regclass and attnum > 0 and not attisdropped;
  execute format('revoke select (%s) on public.users from public, anon', user_columns);
end;
$$;

revoke all on public.users from public, anon, authenticated;
grant select, insert, update on public.users to authenticated;
grant select on public.users to service_role;
create policy users_read_own_or_admin on public.users for select to authenticated
using (id = (select auth.uid()) or (select codesense_private.is_admin()));

commit;
