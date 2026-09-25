-- Apply before deploying the frontend that sends p_completion_time_seconds.
-- This overload follows the existing seven-argument completion contract supplied
-- from the deployed database. Older overloads and table policies are unchanged.
-- SECURITY INVOKER preserves the caller's RLS and column permissions.

begin;

create or replace function public.complete_campaign_quest(
  p_userid uuid,
  p_questid uuid,
  p_xp_gained integer,
  p_xp_delta integer,
  p_completed_activities jsonb,
  p_hintsused integer,
  p_is_full_completion boolean,
  p_completion_time_seconds integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old_xp integer;
  v_old_level integer;
  v_new_xp integer;
  v_new_level integer;
  v_first_completed_at timestamptz;
  v_status public.mission_progress.status%type;
begin
  if auth.uid() is null or auth.uid() is distinct from p_userid then
    raise exception 'Unauthorized: you may only update your own quest progress'
      using errcode = '42501';
  end if;
  if p_is_full_completion is null then
    raise exception 'p_is_full_completion is required' using errcode = '22023';
  end if;
  if p_is_full_completion and (p_completion_time_seconds is null or p_completion_time_seconds < 0) then
    raise exception 'A completed quest requires a non-negative completion time in seconds'
      using errcode = '22023';
  end if;
  if not p_is_full_completion and p_completion_time_seconds is not null then
    raise exception 'Partial quest progress must not include a completion time'
      using errcode = '22023';
  end if;

  -- Anchor the enum to the column instead of resolving an unqualified type
  -- under the deliberately empty search_path.
  if p_is_full_completion then v_status := 'completed';
  else v_status := 'active';
  end if;

  select first_completed_at into v_first_completed_at
    from public.mission_progress
    where userid = p_userid and questid = p_questid;

  insert into public.mission_progress as progress (
    userid, questid, status, xp_gained, completed_activities,
    hintsused, completedat, first_completed_at, updatedat, startedat,
    attempts, completion_time_seconds
  ) values (
    p_userid, p_questid, v_status, p_xp_gained, p_completed_activities,
    p_hintsused,
    case when p_is_full_completion then now() else null end,
    case when p_is_full_completion then coalesce(v_first_completed_at, now()) else null end,
    now(), now(), 1, p_completion_time_seconds
  )
  on conflict (userid, questid) do update set
    status = case when p_is_full_completion then v_status else progress.status end,
    xp_gained = p_xp_gained,
    completed_activities = p_completed_activities,
    hintsused = p_hintsused,
    completedat = case when p_is_full_completion then now() else progress.completedat end,
    first_completed_at = case
      when p_is_full_completion and progress.first_completed_at is null then now()
      else progress.first_completed_at end,
    completion_time_seconds = case when p_is_full_completion
      then p_completion_time_seconds else progress.completion_time_seconds end,
    attempts = progress.attempts + 1,
    updatedat = now();

  select totalxp, currentlevel into v_old_xp, v_old_level
    from public.users where id = p_userid;

  v_new_xp := coalesce(v_old_xp, 0) + p_xp_delta;
  v_new_level := case
    when v_new_xp >= 250000 then 5
    when v_new_xp >= 75000 then 4
    when v_new_xp >= 20000 then 3
    when v_new_xp >= 5000 then 2
    else 1 end;

  update public.users
    set totalxp = v_new_xp, currentlevel = v_new_level, lastactive = now()
    where id = p_userid;

  if p_is_full_completion and v_first_completed_at is null then
    insert into public.activity_log (userid, type, title, description, xp_gained)
      values (p_userid, 'quest_completed', 'Quest Completed', 'Finished a campaign quest', p_xp_delta);
  end if;

  return jsonb_build_object(
    'levelled_up', v_new_level > coalesce(v_old_level, 1),
    'new_level', v_new_level,
    'total_xp', v_new_xp
  );
end;
$$;

revoke all on function public.complete_campaign_quest(uuid, uuid, integer, integer, jsonb, integer, boolean, integer) from public;
grant execute on function public.complete_campaign_quest(uuid, uuid, integer, integer, jsonb, integer, boolean, integer) to authenticated;

commit;
