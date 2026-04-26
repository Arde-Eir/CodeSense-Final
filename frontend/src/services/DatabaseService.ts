// src/services/DatabaseService.ts
import { supabase } from './supabase'
import type { ExplorerProfile } from '../types'

export const DatabaseService = {

  // ── AUTHENTICATION ──────────────────────────────────────────────────────────

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

      await supabase
        .from('users')
        .update({ lastactive: new Date().toISOString() })
        .eq('id', data.user.id)

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
            // charactertype omitted: trigger enum cast fails; set via update after auth succeeds
          },
        },
      })

      if (error) {
        const msg = error.message.toLowerCase()
        const code = (error as any).code ?? ''
        if (
          code === 'user_already_exists' ||
          code === 'email_exists' ||
          msg.includes('already registered') ||
          msg.includes('already been registered')
        ) {
          throw new Error('EMAIL_TAKEN')
        }
        if (code === '23505' || msg.includes('playername') || msg.includes('username')) {
          throw new Error('USERNAME_TAKEN')
        }
        throw new Error(error.message)
      }

      if (!data.user) {
        throw new Error('SIGNUP_FAILED')
      }

      const userId = data.user.id

      // Poll up to 3 times (1s apart) for the trigger to create the row
      let profile: any = null
      for (let attempt = 0; attempt < 3; attempt++) {
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
          if (insertErr.message.toLowerCase().includes('playername') ||
              insertErr.code === '23505') {
            throw new Error('USERNAME_TAKEN')
          }
          throw new Error(insertErr.message)
        }

        profile = inserted
      }

      await supabase
        .from('users')
        .update({
          charactertype: 'squire',
          user_type:     userType,
          playername:    playerName,
          totalxp:       0,
          currentlevel:  1,
        })
        .eq('id', userId)

      return {
        id:            userId,
        playerName,
        secretCode:    '***',
        characterType: 'squire',
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

      const { data: profile } = await supabase
        .from('users')
        .select('*')
        .eq('id', session.user.id)
        .single()

      if (!profile) return null
      return mapProfile(profile)

    } catch (error) {
      console.error('Restore session error:', error)
      return null
    }
  },

  // ── PROGRESS SYSTEM ─────────────────────────────────────────────────────────

  async addXP(userId: string, xpEarned: number): Promise<ExplorerProfile | null> {
    try {
      const { data: current } = await supabase
        .from('users')
        .select('totalxp, currentlevel, playername, charactertype, createdat')
        .eq('id', userId)
        .single()

      if (!current) return null

      const newTotal = (current.totalxp || 0) + xpEarned
      let newLevel: 1 | 2 | 3 | 4 = 1
      if      (newTotal >= 600) newLevel = 4
      else if (newTotal >= 300) newLevel = 3
      else if (newTotal >= 100) newLevel = 2

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
