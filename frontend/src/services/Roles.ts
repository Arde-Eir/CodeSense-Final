/**
 * Roles.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for role-based visibility rules across the frontend.
 *
 * Tiers:
 *  - guest       : unauthenticated / guest-session user. Sandbox + Tutorials only.
 *  - student     : authenticated user with user_type=student (default).
 *  - professional: authenticated user with user_type=professional.
 *  - admin       : any user with is_admin=true. Can see system metrics & global user data.
 *
 * Use `canAccess()` in route guards and `canSee()` in UI components to decide
 * what to render per-user. Never inline `isAdmin` checks elsewhere — update this
 * module so permission rules stay consolidated.
 */
import type { ExplorerProfile } from '@/types'

export type UserTier = 'guest' | 'student' | 'professional' | 'admin'

export interface TierContext {
  user: ExplorerProfile | null
  isGuest: boolean
  isAuthenticated: boolean
}

/** Resolve the tier from auth context. Admin takes precedence. */
export function resolveTier(ctx: TierContext): UserTier {
  if (ctx.user?.isAdmin) return 'admin'
  if (!ctx.isAuthenticated || ctx.isGuest) return 'guest'
  if (ctx.user?.userType === 'professional') return 'professional'
  return 'student'
}

/** Feature keys — add to this union when gating a new feature. */
export type Feature =
  | 'sandbox'           // Code editor + CFG
  | 'tutorials'         // Tutorial quests
  | 'user-manual'       // Deterministic-logic docs
  | 'campaign'          // Gamified mission mode
  | 'progress-report'   // Personal analytics
  | 'leaderboard'       // Global ranking
  | 'profile'           // Profile settings
  | 'admin-panel'       // Full admin tools
  | 'system-metrics'    // System-wide stats
  | 'global-user-data'  // Read all users (for dashboards)

const ALLOW: Record<Feature, UserTier[]> = {
  'sandbox':           ['guest', 'student', 'professional', 'admin'],
  'tutorials':         ['guest', 'student', 'professional', 'admin'],
  'user-manual':       ['guest', 'student', 'professional', 'admin'],
  'campaign':          ['student', 'professional', 'admin'],
  'progress-report':   ['student', 'professional', 'admin'],
  'leaderboard':       ['student', 'professional', 'admin'],
  'profile':           ['student', 'professional', 'admin'],
  'admin-panel':       ['admin'],
  'system-metrics':    ['admin'],
  'global-user-data':  ['admin'],
}

export function canSee(feature: Feature, ctx: TierContext): boolean {
  return ALLOW[feature].includes(resolveTier(ctx))
}

/** Humanised tier label for UI (e.g. "STUDENT", "ADMIN"). */
export function tierLabel(tier: UserTier): string {
  return tier.toUpperCase()
}

/** Tier colour for pills / badges. */
export function tierColor(tier: UserTier): string {
  switch (tier) {
    case 'admin':        return '#a371f7'
    case 'professional': return '#58a6ff'
    case 'student':      return '#4caf50'
    case 'guest':        return '#8b949e'
  }
}
