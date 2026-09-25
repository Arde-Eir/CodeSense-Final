# Supabase RLS checklist

Use this checklist against the actual Supabase project. A checked box should represent a verified SQL policy and a real request made with the indicated role, not merely a UI test.

## Project-wide controls

- [ ] RLS is enabled on every table reachable through the Data API.
- [ ] No browser or Express environment contains the service-role key.
- [ ] The `anon` and `authenticated` roles have only the required table and column grants.
- [ ] Administrator policies derive identity from `auth.uid()` and `public.users.is_admin`; no request parameter can grant admin access.
- [ ] Security-definer functions set an explicit `search_path`, validate ownership, and revoke execution from roles that do not need it.
- [ ] Realtime publication contains only tables whose RLS policies have been tested.
- [ ] Auth redirect URLs contain only the production site and intentional local-development URLs.
- [ ] Email confirmation and SMTP settings match the signup behavior shown by the UI.

## `public.users`

- [ ] A user can read and update their own profile.
- [ ] A user cannot change protected fields such as `id`, `is_admin`, `is_banned`, `ban_reason`, XP, level, counters, or another user's profile.
- [ ] Only an administrator can ban a user or change administrator status.
- [ ] Public leaderboard access exposes only non-sensitive columns.
- [ ] Email addresses are not exposed by a broad public leaderboard policy.
- [ ] The username-login design described in [SECURITY_AND_ACCESS.md](./SECURITY_AND_ACCESS.md) has been resolved deliberately.

## User-owned data

For `mission_progress`, `reports`, and `activity_log`:

- [ ] Authenticated users can read only rows where `userid = auth.uid()`.
- [ ] Inserts require `userid = auth.uid()`.
- [ ] Updates and deletes require ownership in both `USING` and `WITH CHECK` clauses.
- [ ] An administrator can read rows only if that access is required by the admin UI.
- [ ] User A cannot read or change User B's rows in direct REST tests.

## Content tables

For `quests`, `level_info`, `patch_notes`, and `announcements`:

- [ ] Anonymous/authenticated read access is limited to content intended for display.
- [ ] Draft or inactive content is not exposed unless intentionally public.
- [ ] Only administrators can insert, update, or delete content.

For `system_settings`:

- [ ] Public readers can access only settings required before authentication, such as maintenance state/message.
- [ ] Only administrators can write settings.
- [ ] No secret value is stored in this browser-readable table.

For `admin_audit_log`:

- [ ] Only administrators can read audit records.
- [ ] Inserts identify the acting administrator as `auth.uid()`; callers cannot forge `admin_id`.
- [ ] Normal users cannot update or delete audit records.

## Functions

- [ ] `increment_sandbox_runs` ignores caller-supplied identity or rejects any identity other than `auth.uid()`.
- [ ] `complete_campaign_quest` derives the user from `auth.uid()`, validates quest state, awards XP transactionally, and cannot award the same first-completion XP twice.
- [ ] Any quest-reset function requires ownership and cannot reduce another user's progress.
- [ ] Function execution grants are explicit; `PUBLIC` execution is revoked unless intentionally required.
- [ ] Concurrency tests confirm counters and XP cannot lose updates or be duplicated.

### Campaign release gate

The app requires `complete_campaign_quest` and `reset_quest_for_retake` to persist progress. Apply `supabase/migrations/202609240001_campaign_completion_time.sql` before deploying this frontend: it adds the eight-argument completion overload based on the supplied deployed seven-argument function. Completion time, progress, XP, and the first-completion activity event are saved in the same transaction. The older overloads remain available. This timing migration preserves SECURITY INVOKER (which obeys RLS) and the existing client-reported XP contract; it does not implement the separate reward and permission hardening below. Test against the actual policies and triggers before production.

1. [ ] Make a production backup and test the rollout against a staging copy. Run the read-only `supabase/schema_preflight.sql` queries one at a time in the intended project. Record the project reference and export the exact signatures, return types, grants, function bodies, and `mission_progress`/`users` trigger bodies privately. Never run the pasted schema dump as a migration.
2. [ ] Review every `complete_campaign_quest` overload. The frontend calls parameters `p_userid`, `p_questid`, `p_xp_gained`, `p_xp_delta`, `p_completed_activities`, `p_hintsused`, `p_is_full_completion`, and `p_completion_time_seconds`. The last parameter is a non-negative integer for a full completion and null for partial progress. Confirm an exact matching callable signature, an actionable error on failure, and a result compatible with `levelled_up`/`new_level`. Remove or deny unintended overloads only after reviewing their callers.
3. [ ] Make the completion RPC the sole authority for progress and XP: require `auth.uid() = p_userid`, reject inactive/non-campaign/locked quests and banned accounts, validate the tab set against the quest, derive the reward and phase cap on the server, serialize concurrent attempts, upsert a unique `(userid, questid)` row, and update progress plus user XP in one transaction. Do not trust `p_xp_gained`, `p_xp_delta`, or `p_is_full_completion` as proof of earned XP. Preserve `first_completed_at` once set and ensure the triggers do not duplicate an award or undo the RPC result.
4. [ ] Decide how correctness is verified server-side. A browser-reported score or completed-tab list alone cannot prove a learner solved a game; if completion must be cheat-resistant, submit answers for validation in a trusted RPC/service before awarding XP. Check hint persistence and penalties as part of the same contract; disabling direct hint writes otherwise makes `hintsused` only a client-reported value. Completion time is also client-reported; test its persistence and confirm that existing triggers do not duplicate the completion RPC's activity event.
5. [ ] Verify `reset_quest_for_retake(p_userid uuid, p_questid uuid)` exists and returns normally. It must require the caller to own the row, reject other users, preserve `xp_gained` and `first_completed_at`, and reset only attempt-scoped fields. Test a first completion, retake, concurrent duplicate completion, and a forced failure to confirm no partial XP/progress write.
6. [ ] Only after replacing all direct browser writes, remove the legacy permissive policies and revoke broad table/column `INSERT`/`UPDATE`/`DELETE` grants on protected `users` and `mission_progress` fields. Policies with `PERMISSIVE` combine with OR, so adding a narrow policy does not cancel an old `USING (true)` policy. Column grants still permit protected writes even when a self-update row policy is present. Provide an admin-only RPC before revoking the grants used by the Admin Panel's direct profile edits.
7. [ ] In staging, test anonymous, owner, unrelated learner, and administrator API requests directly. Verify direct XP/admin/ban/progress writes fail; the owner can still complete and retake through RPC; an unrelated caller cannot pass another user's `p_userid`; invalid quest IDs, wrong phase, inactive quests, replay, and concurrent requests do not bypass gates or caps. Repeat these tests on production after deployment.

Deploy the verified database RPCs before the frontend that requires them. Coordinate grant/policy tightening with the frontend and administrator-write changes in a maintenance window; otherwise either the old client remains vulnerable or a legitimate workflow breaks. If any preflight result differs from the expected schema, stop and revise the migration against that result rather than applying a guessed replacement function.

## Storage bucket `Avatars`

- [ ] Object reads are public only if profile images are intentionally public.
- [ ] Authenticated users can insert/update/delete only objects whose first path segment equals `auth.uid()`.
- [ ] Allowed paths are `{userId}/avatar.webp` and `{userId}/banner/...`.
- [ ] MIME type and file-size restrictions are configured and enforced.
- [ ] User A cannot overwrite or delete User B's objects.

## Verification matrix

Run each operation directly through Supabase using separate sessions:

| Operation | Anonymous | Owner | Other user | Admin |
| --- | --- | --- | --- | --- |
| Read public quest | Allow | Allow | Allow | Allow |
| Write quest | Deny | Deny | Deny | Allow |
| Read private progress | Deny | Allow | Deny | Allow only if required |
| Change own display profile | Deny | Allow | Deny | Allow |
| Change XP/admin/ban fields directly | Deny | Deny | Deny | Allow only through intended admin path |
| Write own avatar path | Deny | Allow | Deny | Deliberate policy |
| Read audit log | Deny | Deny | Deny | Allow |

Record the date, project reference, tester, and SQL migration version used for the completed review.
