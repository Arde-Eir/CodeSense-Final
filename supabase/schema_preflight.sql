-- Read-only checks for the deployed CodeSense schema. Run in the Supabase SQL editor.
-- This file does not create, update, or delete database objects or user data.
-- Run one SELECT at a time and export each result set; review function source before sharing.
-- SQL Editor results do not prove what an anon or learner session can access through RLS.

select to_regclass('public.support_sessions') as support_sessions,
       to_regclass('public.support_actions') as support_actions,
       to_regclass('realtime.messages') as realtime_messages;

select n.nspname as schema_name,
       c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
       has_table_privilege('anon', c.oid, 'INSERT') as anon_insert,
       has_table_privilege('anon', c.oid, 'UPDATE') as anon_update,
       has_table_privilege('anon', c.oid, 'DELETE') as anon_delete,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select,
       has_table_privilege('authenticated', c.oid, 'INSERT') as authenticated_insert,
       has_table_privilege('authenticated', c.oid, 'UPDATE') as authenticated_update,
       has_table_privilege('authenticated', c.oid, 'DELETE') as authenticated_delete
from pg_class as c
join pg_namespace as n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and (n.nspname = 'public'
    or (n.nspname = 'realtime' and c.relname = 'messages')
    or (n.nspname = 'storage' and c.relname in ('buckets', 'objects')))
order by n.nspname, c.relname;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  or (schemaname = 'realtime' and tablename = 'messages')
  or (schemaname = 'storage' and tablename in ('buckets', 'objects'))
order by schemaname, tablename, policyname;

select table_name, ordinal_position, column_name, udt_schema, udt_name,
       is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

select n.nspname as schema_name, c.relname as table_name,
       con.conname as constraint_name, pg_get_constraintdef(con.oid, true) as definition
from pg_constraint as con
join pg_class as c on c.oid = con.conrelid
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public'
order by c.relname, con.conname;

select table_name, column_name, grantee, privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and table_name in ('users', 'admin_audit_log', 'mission_progress', 'reports')
  and grantee in ('anon', 'authenticated')
order by table_name, column_name, grantee, privilege_type;

select a.attname as column_name,
       has_column_privilege('anon', 'public.users', a.attname, 'SELECT') as anon_select,
       has_column_privilege('anon', 'public.users', a.attname, 'UPDATE') as anon_update,
       has_column_privilege('authenticated', 'public.users', a.attname, 'SELECT') as authenticated_select,
       has_column_privilege('authenticated', 'public.users', a.attname, 'UPDATE') as authenticated_update
from pg_attribute as a
where a.attrelid = 'public.users'::regclass
  and a.attnum > 0
  and not a.attisdropped
  and a.attname in ('email', 'is_admin', 'is_banned', 'ban_reason', 'totalxp',
                    'currentlevel', 'quests_completed', 'badges', 'user_type')
order by a.attname;

select n.nspname as schema_name, c.relname as table_name,
       a.attname as column_name, format_type(a.atttypid, a.atttypmod) as column_type
from pg_attribute as a
join pg_class as c on c.oid = a.attrelid
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('users', 'quests', 'mission_progress', 'reports')
  and a.attname in ('charactertype', 'difficulty', 'status', 'type')
  and a.attnum > 0
  and not a.attisdropped
order by c.relname, a.attname;

select n.nspname as schema_name, c.relname as table_name,
       t.tgname as trigger_name, pg_get_triggerdef(t.oid, true) as definition
from pg_trigger as t
join pg_class as c on c.oid = t.tgrelid
join pg_namespace as n on n.oid = c.relnamespace
where not t.tgisinternal
  and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname = 'users'))
order by n.nspname, c.relname, t.tgname;

select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer,
       p.proconfig as function_settings,
       p.proacl as function_grants,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- Review the source for embedded credentials before sharing this result.
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_functiondef(p.oid) as definition
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('is_admin', 'is_current_user_admin', 'complete_campaign_quest',
                    'increment_xp', 'increment_sandbox_runs', 'deduct_hint_xp',
                    'reset_quest_for_retake',
                    'handle_new_user', 'sync_user_level', 'sync_quests_completed',
                    'protect_first_completed_at', 'log_quest_activity',
                    'log_sandbox_run', 'log_campaign_report',
                    'trg_refresh_leaderboard_fn')
order by p.proname, pg_get_function_identity_arguments(p.oid);

select n.nspname as schema_name, t.typname as enum_type, e.enumlabel as allowed_value
from pg_type as t
join pg_namespace as n on n.oid = t.typnamespace
join pg_enum as e on e.enumtypid = t.oid
where n.nspname = 'public'
order by t.typname, e.enumsortorder;

select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;

select schemaname, viewname as object_name, definition, 'view' as object_type
from pg_views
where schemaname = 'public'
union all
select schemaname, matviewname as object_name, definition, 'materialized view' as object_type
from pg_matviews
where schemaname = 'public'
order by object_name;

select pubname, schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by schemaname, tablename;

select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
order by id;

select count(*) as duplicate_progress_pairs
from (
  select userid, questid
  from public.mission_progress
  group by userid, questid
  having count(*) > 1
) as duplicates;

select count(*) as profile_auth_email_mismatches
from public.users as profile
join auth.users as account on account.id = profile.id
where profile.email is distinct from account.email;

-- Campaign release gate: inspect every overload, not only the function name.
-- Export these results privately; function source may contain sensitive logic.
select p.oid::regprocedure as exact_signature,
       pg_get_function_result(p.oid) as return_type,
       pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer,
       p.proconfig as function_settings,
       p.proacl as explicit_grants,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       pg_get_functiondef(p.oid) as definition
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('complete_campaign_quest', 'reset_quest_for_retake',
                    'deduct_hint_xp', 'increment_xp', 'increment_sandbox_runs')
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- Campaign and profile triggers can change XP, completion timestamps, and level.
-- Review the trigger function bodies before replacing an RPC or narrowing grants.
select c.relname as table_name,
       t.tgname as trigger_name,
       pg_get_triggerdef(t.oid, true) as trigger_definition,
       p.oid::regprocedure as function_signature,
       p.prosecdef as security_definer,
       p.proconfig as function_settings,
       pg_get_functiondef(p.oid) as function_definition
from pg_trigger as t
join pg_class as c on c.oid = t.tgrelid
join pg_namespace as n on n.oid = c.relnamespace
join pg_proc as p on p.oid = t.tgfoid
where n.nspname = 'public'
  and c.relname in ('mission_progress', 'users', 'quests')
  and not t.tgisinternal
order by c.relname, t.tgname;

-- Table-level UPDATE grants imply effective UPDATE access to every column.
-- A row-level policy alone cannot protect XP or administrative columns.
select c.relname as table_name,
       a.attname as column_name,
       has_column_privilege('anon', c.oid, a.attname, 'INSERT') as anon_insert,
       has_column_privilege('anon', c.oid, a.attname, 'UPDATE') as anon_update,
       has_column_privilege('authenticated', c.oid, a.attname, 'INSERT') as authenticated_insert,
       has_column_privilege('authenticated', c.oid, a.attname, 'UPDATE') as authenticated_update
from pg_class as c
join pg_namespace as n on n.oid = c.relnamespace
join pg_attribute as a on a.attrelid = c.oid
where n.nspname = 'public'
  and c.relname in ('users', 'mission_progress', 'activity_log')
  and a.attnum > 0
  and not a.attisdropped
order by c.relname, a.attnum;

-- Aggregate integrity checks disclose no individual learner IDs.
select count(*) as progress_rows,
       count(*) filter (where status = 'completed' and first_completed_at is null)
         as completed_without_first_completed_at,
       count(*) filter (where status = 'completed' and completedat is null)
         as completed_without_completedat,
       count(*) filter (where completed_activities is null
                         or jsonb_typeof(completed_activities) <> 'array')
         as invalid_completed_activities,
       count(*) filter (where xp_gained is null or xp_gained < 0)
         as invalid_xp_gained
from public.mission_progress;

select q.mode, q.phase, q.level,
       count(*) as quest_count,
       count(*) filter (where q.isactive = true) as active_quest_count,
       count(*) filter (where q.isactive = true and q.question_type is null)
         as active_quests_without_question_type
from public.quests as q
group by q.mode, q.phase, q.level
order by q.mode, q.phase, q.level;
