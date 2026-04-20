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
    characterType: 'squire' | 'knight' | 'duke' | 'lord'
  ): Promise<ExplorerProfile> {
    try {
      const { data: existing } = await supabase
        .from('users')
        .select('id')
        .ilike('playername', playerName.trim())
        .limit(1)
        .maybeSingle()

      if (existing) {
        throw new Error('USERNAME_TAKEN')
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password: secretCode,
        options: {
          data: { playername: playerName },
        },
      })

      if (error) {
        const msg = error.message.toLowerCase()
        if (msg.includes('already registered') || msg.includes('already been registered')) {
          throw new Error('EMAIL_TAKEN')
        }
        if (msg.includes('playername') || msg.includes('username')) {
          throw new Error('USERNAME_TAKEN')
        }
        throw new Error(error.message)
      }

      if (!data.user) {
        throw new Error('SIGNUP_FAILED')
      }

      const userId = data.user.id

      let profile: any = null
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise(r => setTimeout(r, 400))
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
            charactertype: characterType,
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
          charactertype: characterType,
          playername:    playerName,
          totalxp:       0,
          currentlevel:  1,
        })
        .eq('id', userId)

      return {
        id:            userId,
        playerName,
        secretCode:    '***',
        characterType,
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
      // Only insert a report record and increment sandbox_runs counter.
      // NO XP is awarded for sandbox runs.
      await supabase.from('reports').insert({
        userid:               userId,
        type:                 'summary',
        sourcecode:           sourceCode,
        mode_context:         'sandbox',
        cognitive_complexity: cognitiveComplexity,
        symbol_table:         symbolTable,
        createdat:            new Date().toISOString(),
      })

      // Increment sandbox_runs counter only (no XP change)
      await supabase.rpc('increment_sandbox_runs', { p_userid: userId })
        .then(({ error }) => {
          if (error) {
            // Fallback: manual increment if RPC doesn't exist
            return supabase
              .from('users')
              .select('sandbox_runs')
              .eq('id', userId)
              .single()
              .then(({ data }) => {
                if (data) {
                  return supabase
                    .from('users')
                    .update({ sandbox_runs: (data.sandbox_runs ?? 0) + 1 })
                    .eq('id', userId)
                }
              })
          }
        })
    } catch (error) {
      console.error('Sandbox log failed (non-critical):', error)
    }
  },

  // ── CAMPAIGN ────────────────────────────────────────────────────────────────

  async completeQuest(
    userId: string,
    questId: string,
    xpEarned: number,
    complexityScore: number,
    symbolTable: object,
    sourceCode: string
  ): Promise<void> {
    try {
      await supabase.rpc('complete_campaign_quest', {
        p_userid:           userId,
        p_questid:          questId,
        p_xp_earned:        xpEarned,
        p_complexity_score: complexityScore,
        p_symbol_table:     symbolTable,
        p_sourcecode:       sourceCode,
      })
    } catch (error) {
      console.error('Complete quest error:', error)
      throw error
    }
  },

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
    characterType: profile.charactertype,
    totalXP:       profile.totalxp,
    currentLevel:  profile.currentlevel,
    createdAt:     new Date(profile.createdat),
    lastActive:    new Date(profile.lastactive),
  } as ExplorerProfile
}