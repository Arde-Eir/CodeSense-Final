-- ============================================================================
-- backfill_user_levels.sql — one-time fix for stale users.currentlevel
-- ============================================================================
-- The old `complete_campaign_quest` overload used `1 + (totalxp / 500)` for
-- the level number, which mismatches the frontend's XP_LEVELS table. Anyone
-- who earned XP under the old RPC has a wrong currentlevel right now.
--
-- This migration recomputes currentlevel from totalxp using the canonical
-- thresholds shared with the frontend:
--   • 1 (Squire) at 0–999
--   • 2 (Knight) at 1000–3999
--   • 3 (Lord)   at 4000–9999
--   • 4 (Duke)   at 10000–24999
--   • 5 (King)   at 25000+
--
-- Run AFTER rpc_patch_v2.sql so future writes also use the right math. This
-- migration is idempotent — re-running it never changes a row that's already
-- consistent.
-- ============================================================================

UPDATE public.users
SET    currentlevel = CASE
         WHEN totalxp >= 25000 THEN 5
         WHEN totalxp >= 10000 THEN 4
         WHEN totalxp >=  4000 THEN 3
         WHEN totalxp >=  1000 THEN 2
         ELSE                        1
       END,
       updatedat   = now()
WHERE  currentlevel IS DISTINCT FROM CASE
         WHEN totalxp >= 25000 THEN 5
         WHEN totalxp >= 10000 THEN 4
         WHEN totalxp >=  4000 THEN 3
         WHEN totalxp >=  1000 THEN 2
         ELSE                        1
       END;

-- Sanity check (run after):
--   SELECT id, playername, totalxp, currentlevel
--   FROM users
--   WHERE currentlevel <> CASE
--           WHEN totalxp >= 25000 THEN 5
--           WHEN totalxp >= 10000 THEN 4
--           WHEN totalxp >=  4000 THEN 3
--           WHEN totalxp >=  1000 THEN 2
--           ELSE 1 END;
--   -- should return 0 rows.
