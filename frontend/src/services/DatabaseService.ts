// src/services/DatabaseService.ts
import { supabase } from './supabase'
import type { ExplorerProfile } from '@/types'

export const DatabaseService = {

  // ── AUTHENTICATION ──────────────────────────────────────────────────────────

  async updateLastActive(userId: string): Promise<void> {
    try {
      await supabase
        .from('users')
        .update({ lastactive: new Date().toISOString() })
        .eq('id', userId)
    } catch (error) {
      console.warn('Last-active update failed:', error)
    }
  },

  async login(playerName: string, secretCode: string): Promise<ExplorerProfile> {
    try {
      const { data: userRow, error: lookupError } = await supabase
        .from('users')
        .select('email')
        .ilike('playername', playerName.trim())
        .limit(1)
        .maybeSingle()

      if (lookupError || !userRow?.email) {
        throw new Error('INVALID_CREDENTIALS')
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: userRow.email,
        password: secretCode,
      })

      if (error || !data.user) {
        throw new Error('INVALID_CREDENTIALS')
      }

      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('*')
        .eq('id', data.user.id)
        .single()

      if (profileError || !profile) {
        throw new Error('PROFILE_NOT_FOUND')
      }

      if (profile.is_banned) {
        await supabase.auth.signOut()
        const reason = profile.ban_reason ? `: ${profile.ban_reason}` : ''
        throw new Error(`ACCOUNT_BANNED${reason}`)
      }

      await DatabaseService.updateLastActive(data.user.id)

      return mapProfile(profile)

    } catch (error) {
      console.error('Login error:', error)
      throw error
    }
  },

  async signUp(
    playerName: string,
    secretCode: string,
    email: string,
    userType: 'student' | 'professional' = 'student'
  ): Promise<ExplorerProfile> {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password: secretCode,
        options: {
          data: {
            playername: playerName,
            user_type: userType,
            // charactertype omitted: trigger enum cast fails; set via update after auth succeeds
          },
        },
      })

      if (error) {
        const msg  = error.message.toLowerCase()
        const code = (error as any).code ?? ''

        // ── EMAIL_TAKEN: all known Supabase variants ──────────────────────────
        if (
          code === 'user_already_exists'  ||
          code === 'email_exists'         ||
          msg.includes('already registered')      ||
          msg.includes('already been registered') ||
          msg.includes('email address is already') ||
          msg.includes('user already exists')
        ) {
          // FIX Bug 1: Check whether a users-table profile exists for this email.
          // If it does NOT, the auth account is a zombie (trigger failed on a
          // previous attempt). We surface a friendlier error so the user knows
          // to contact support or try a different email, rather than being
          // silently blocked by a phantom account.
          const { data: existingProfile } = await supabase
            .from('users')
            .select('id')
            .ilike('email', email.trim())
            .maybeSingle()

          if (!existingProfile) {
            // Orphan auth account: public.users was deleted but auth.users still
            // holds this email (e.g. manually deleted from the dashboard).
            // Try to sign in with the supplied credentials — if it works we can
            // recover by re-inserting the missing profile row.
            const { data: recoveryData, error: recoveryErr } = await supabase.auth.signInWithPassword({
              email,
              password: secretCode,
            })

            if (!recoveryErr && recoveryData?.user) {
              // Password matched — re-create the public.users profile.
              const recoveredId = recoveryData.user.id
              const { data: newProfile, error: insertErr } = await supabase
                .from('users')
                .insert({
                  id:            recoveredId,
                  playername:    playerName,
                  email:         email,
                  charactertype: 'squire',
                  user_type:     userType,
                  totalxp:       0,
                  currentlevel:  1,
                  createdat:     new Date().toISOString(),
                  lastactive:    new Date().toISOString(),
                })
                .select()
                .single()

              if (insertErr) {
                await supabase.auth.signOut()
                throw new Error('SERVER_ERROR')
              }

              return {
                id:            recoveredId,
                playerName,
                email,
                secretCode:    '***',
                characterType: 'squire',
                userType,
                totalXP:       0,
                currentLevel:  1,
                createdAt:     new Date(newProfile?.createdat ?? Date.now()),
                lastActive:    new Date(),
              } as ExplorerProfile
            }

            // Password didn't match — orphan belongs to someone else.
            throw new Error('EMAIL_ORPHANED')
          }
          throw new Error('EMAIL_TAKEN')
        }

        // ── USERNAME_TAKEN ────────────────────────────────────────────────────
        // FIX Bug 2: also catch generic 'duplicate key' messages that don't
        // name the column explicitly.
        if (
          code === '23505'                         ||
          msg.includes('playername')               ||
          msg.includes('username')                 ||
          msg.includes('duplicate key value')      ||
          msg.includes('unique constraint')
        ) {
          throw new Error('USERNAME_TAKEN')
        }

        if (msg.includes('database error saving new user') || msg.includes('unexpected_failure')) {
          throw new Error('SERVER_ERROR')
        }
        if (msg.includes('error sending confirmation email') || msg.includes('confirmation email')) {
          throw new Error('CONFIRMATION_EMAIL_FAILED')
        }
        if (isProfilePolicyError(error)) {
          throw new Error('PROFILE_SETUP_BLOCKED')
        }
        throw new Error(error.message)
      }

      if (!data.user) {
        throw new Error('SIGNUP_FAILED')
      }

      const userId = data.user.id

      // FIX Bug 3: Poll up to 5 times (1 s apart) for the DB trigger to create
      // the profile row. If the row already exists when we attempt the fallback
      // INSERT we treat that as success (not USERNAME_TAKEN).
      let profile: any = null
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise(r => setTimeout(r, 1000))
        const { data: row, error: rowErr } = await supabase
          .from('users')
          .select('*')
          .eq('id', userId)
          .maybeSingle()

        if (!rowErr && row) { profile = row; break }
      }

      if (!profile) {
        const { data: inserted, error: insertErr } = await supabase
          .from('users')
          .insert({
            id:            userId,
            playername:    playerName,
            email:         email,
            charactertype: 'squire',
            user_type:     userType,
            totalxp:       0,
            currentlevel:  1,
            createdat:     new Date().toISOString(),
            lastactive:    new Date().toISOString(),
          })
          .select()
          .single()

        if (insertErr) {
          // FIX Bug 3b: if the row appeared between our last poll and the INSERT
          // (race condition), fetch it instead of throwing USERNAME_TAKEN.
          if (insertErr.code === '23505') {
            const { data: racedRow } = await supabase
              .from('users')
              .select('*')
              .eq('id', userId)
              .maybeSingle()
            if (racedRow) {
              profile = racedRow
            } else {
              // Truly a duplicate playername from another account
              throw new Error('USERNAME_TAKEN')
            }
          } else {
            if (isProfilePolicyError(insertErr)) {
              throw new Error('PROFILE_SETUP_BLOCKED')
            }
            throw new Error('SERVER_ERROR')
          }
        } else {
          profile = inserted
        }
      }

      const { error: updateErr } = await supabase
        .from('users')
        .update({
          charactertype: 'squire',
          user_type:     userType,
          playername:    playerName,
          totalxp:       0,
          currentlevel:  1,
        })
        .eq('id', userId)
      if (updateErr) console.warn('Profile update after signup failed (non-fatal):', updateErr.message)

      return {
        id:            userId,
        playerName,
        email,
        secretCode:    '***',
        characterType: 'squire',
        userType,
        totalXP:       0,
        currentLevel:  1,
        createdAt:     new Date(profile?.createdat ?? Date.now()),
        lastActive:    new Date(),
      } as ExplorerProfile

    } catch (error) {
      console.error('SignUp error:', error)
      throw error
    }
  },

  async loginAsGuest(): Promise<ExplorerProfile> {
    return {
      id:            `guest_${Date.now()}`,
      playerName:    `Explorer_${Math.floor(Math.random() * 999)}`,
      secretCode:    'GUEST-SESSION',
      characterType: 'squire',
      totalXP:       0,
      currentLevel:  1,
      createdAt:     new Date(),
      lastActive:    new Date(),
    } as ExplorerProfile
  },

  async logout(): Promise<void> {
    await supabase.auth.signOut()
  },

  async restoreSession(): Promise<ExplorerProfile | null> {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return null

      const { data: profile, error: profileErr } = await supabase
        .from('users')
        .select('*')
        .eq('id', session.user.id)
        .single()

      if (profileErr || !profile) return null
      return mapProfile(profile)

    } catch (error) {
      console.error('Restore session error:', error)
      return null
    }
  },

  // ── PROGRESS SYSTEM ─────────────────────────────────────────────────────────

  async addXP(userId: string, xpEarned: number): Promise<ExplorerProfile | null> {
    try {
      const { data: current, error: currentErr } = await supabase
        .from('users')
        .select('totalxp, currentlevel, playername, charactertype, createdat')
        .eq('id', userId)
        .single()

      if (currentErr || !current) return null

      const newTotal = (current.totalxp || 0) + xpEarned
      let newLevel: 1 | 2 | 3 | 4 | 5 = 1
      if      (newTotal >= 250000) newLevel = 5
      else if (newTotal >= 75000)  newLevel = 4
      else if (newTotal >= 20000)  newLevel = 3
      else if (newTotal >= 5000)   newLevel = 2

      const { data: updated } = await supabase
        .from('users')
        .update({
          totalxp:      newTotal,
          currentlevel: newLevel,
          lastactive:   new Date().toISOString(),
        })
        .eq('id', userId)
        .select()
        .single()

      if (!updated) return null
      return mapProfile(updated)

    } catch (error) {
      console.error('Update XP error:', error)
      throw error
    }
  },

  // ── SANDBOX ─────────────────────────────────────────────────────────────────
  // NOTE: Sandbox runs ONLY increment the sandbox_runs counter.
  // They do NOT award any XP — sandbox is a free exploration mode.

  async logSandboxRun(
    userId: string,
    sourceCode: string,
    cognitiveComplexity: number,
    symbolTable: object
  ): Promise<void> {
    try {
      await supabase.from('reports').insert({
        userid:               userId,
        type:                 'summary',
        sourcecode:           sourceCode,
        mode_context:         'sandbox',
        cognitive_complexity: cognitiveComplexity,
        symbol_table:         symbolTable,
        createdat:            new Date().toISOString(),
      })

      await supabase.from('activity_log').insert({
        userid:      userId,
        type:        'sandbox_run',
        title:       'Sandbox analysis',
        description: cognitiveComplexity > 0 ? `Complexity score: ${cognitiveComplexity}` : '',
        xp_gained:   0,
        meta:        { cognitive_complexity: cognitiveComplexity },
      })

      const { error: rpcError } = await supabase.rpc('increment_sandbox_runs', { p_userid: userId })
      if (rpcError) {
        const { data } = await supabase
          .from('users')
          .select('sandbox_runs')
          .eq('id', userId)
          .single()
        if (data) {
          await supabase
            .from('users')
            .update({ sandbox_runs: (data.sandbox_runs ?? 0) + 1 })
            .eq('id', userId)
        }
      }
      await DatabaseService.updateLastActive(userId)
    } catch (error) {
      console.error('Sandbox log failed (non-critical):', error)
    }
  },

  // ── CAMPAIGN ────────────────────────────────────────────────────────────────

  async getQuests(phase: 'beginner' | 'intermediate' | 'advanced') {
    const { data, error } = await supabase
      .from('quests')
      .select('*')
      .eq('mode', 'campaign')
      .eq('phase', phase)
      .eq('isactive', true)
      .order('sortorder', { ascending: true })

    if (error) throw error
    return data
  },

  async getMissionProgress(userId: string) {
    const { data, error } = await supabase
      .from('mission_progress')
      .select('*, quests(*)')
      .eq('userid', userId)

    if (error) throw error
    return data
  },

  async getLeaderboard(limit = 10) {
    const { data, error } = await supabase
      .from('leaderboard')
      .select('*')
      .order('rank', { ascending: true })
      .limit(limit)

    if (error) throw error
    return data
  },

  // ── REPORTS ─────────────────────────────────────────────────────────────────

  async saveAnalysisReport(
    userId: string,
    code: string,
    narrative: string[],
    modeContext: 'sandbox' | 'campaign' = 'sandbox',
    cognitiveComplexity?: number,
    symbolTable?: object
  ): Promise<void> {
    try {
      await supabase.from('reports').insert({
        userid:               userId,
        type:                 modeContext === 'sandbox' ? 'summary' : 'progress',
        sourcecode:           code,
        narrative,
        mode_context:         modeContext,
        cognitive_complexity: cognitiveComplexity ?? null,
        symbol_table:         symbolTable ?? null,
      })
    } catch (error) {
      console.error('Failed to save report (non-critical):', error)
    }
  },
}

// ── HELPER ───────────────────────────────────────────────────────────────────
function mapProfile(profile: any): ExplorerProfile {
  return {
    id:            profile.id,
    playerName:    profile.playername,
    secretCode:    '***',
    email:         profile.email,
    characterType: profile.charactertype,
    userType:      profile.user_type ?? 'student',
    isAdmin:       profile.is_admin ?? false,
    isBanned:      profile.is_banned ?? false,
    banReason:     profile.ban_reason ?? undefined,
    totalXP:       profile.totalxp,
    currentLevel:  profile.currentlevel,
    createdAt:     new Date(profile.createdat),
    lastActive:    new Date(profile.lastactive),
  } as ExplorerProfile
}

function isProfilePolicyError(error: any): boolean {
  const msg = String(error?.message ?? '').toLowerCase()
  return (
    error?.code === '42501' ||
    msg.includes('row-level security') ||
    msg.includes('violates row-level security policy') ||
    msg.includes('permission denied')
  )
}
