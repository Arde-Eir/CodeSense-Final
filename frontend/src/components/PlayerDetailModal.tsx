/**
 * PlayerDetailModal.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared player-detail card. Accepts a userId, fetches the full row from
 * Supabase, and renders avatar + rank progress + stats + online indicator.
 *
 * Used by:
 *   - LeaderboardPage (click any row or podium avatar)
 *   - HomeDashboard   (click a player in the global search dropdown)
 *
 * Previously HomeDashboard navigated to /profile on click, which always showed
 * the current user's own profile instead of the clicked user's.
 */
import React, { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { getLevelProgress, getXPToNextLevel, getRank } from '../types'

interface PlayerRow {
  id: string
  playername: string
  totalxp: number
  currentlevel: number
  sandbox_runs: number
  createdat: string
  lastactive: string | null
  charactertype: string | null
  user_type: 'student' | 'professional' | null
}

const timeAgo = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1)    return 'active now'
  if (mins < 60)   return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  const days = Math.floor(mins / 1440)
  if (days < 30)   return `${days}d ago`
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

const isRecentlyActive = (iso: string | null | undefined): boolean => {
  if (!iso) return false
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000) < 30
}

export const PlayerDetailModal: React.FC<{
  userId: string
  currentUserId?: string
  onClose: () => void
}> = ({ userId, currentUserId, onClose }) => {
  const [player, setPlayer] = useState<PlayerRow | null>(null)
  const [questsCompleted, setQuestsCompleted] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const fetchAll = async () => {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('users')
        .select('id, playername, totalxp, currentlevel, sandbox_runs, createdat, lastactive, charactertype, user_type')
        .eq('id', userId)
        .maybeSingle()
      if (cancelled) return
      if (err || !data) {
        setError(err?.message ?? 'Could not load profile — likely blocked by RLS SELECT policy on users table.')
        setLoading(false)
        return
      }
      setPlayer(data as PlayerRow)
      const { count } = await supabase
        .from('mission_progress').select('*', { count: 'exact', head: true })
        .eq('userid', userId).eq('status', 'completed')
      if (cancelled) return
      setQuestsCompleted(count ?? 0)
      setLoading(false)
    }
    fetchAll()
    return () => { cancelled = true }
  }, [userId])

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const isMe = currentUserId === userId
  // Rank from XP (not stale `currentlevel`) — see types/index.ts getRank().
  const rank     = player ? getRank(player.totalxp ?? 0) : null
  const progress = player ? getLevelProgress(player.totalxp) : 0
  const xpToNext = player ? getXPToNextLevel(player.totalxp) : null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(6px)',
        zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px', animation: 'pdFadeIn 0.2s ease',
      }}
    >
      <style>{`
        @keyframes pdFadeIn  { from{opacity:0} to{opacity:1} }
        @keyframes pdSlideUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
      `}</style>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'linear-gradient(160deg, #161b22 0%, #0d1117 100%)',
          border: '1px solid #30363d', borderRadius: '18px',
          width: '100%', maxWidth: '440px', padding: '28px',
          boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
          animation: 'pdSlideUp 0.25s ease-out',
          fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
          minHeight: 200,
        }}
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#8b949e' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>⏳</div>
            Loading profile…
          </div>
        ) : error ? (
          <>
            <div style={{ color: '#f85149', fontSize: 22, marginBottom: 10 }}>⚠ Couldn't load</div>
            <div style={{ color: '#c9d1d9', fontSize: 13, lineHeight: 1.6, marginBottom: 18 }}>{error}</div>
            <button onClick={onClose} style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid #30363d', color: '#e6edf3', padding: '11px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              Close
            </button>
          </>
        ) : player && (
          <>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '22px' }}>
              <div style={{
                width: '68px', height: '68px', borderRadius: '50%', flexShrink: 0,
                background: isMe ? 'linear-gradient(135deg,#4caf50,#2d7a2d)' : 'linear-gradient(135deg,#64b5f6,#1976d2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '28px', fontWeight: '800', color: 'white',
                border: '3px solid rgba(255,255,255,0.08)',
              }}>
                {player.playername.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#e6edf3', fontSize: '20px', fontWeight: '800', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {player.playername}
                  {isMe && <span style={{ fontSize: '11px', color: '#4caf50', marginLeft: '6px', fontWeight: '700' }}>(you)</span>}
                </div>
                <div style={{ color: '#8b949e', fontSize: '12px', marginTop: '4px' }}>
                  {rank?.name ?? 'Squire'} · Joined {new Date(player.createdat).toLocaleDateString([], { month: 'short', year: 'numeric' })}
                </div>
                <div style={{ marginTop: '6px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {player.user_type && (
                    <span style={{
                      fontSize: '10px', padding: '2px 8px', borderRadius: '10px', fontWeight: '700',
                      background: player.user_type === 'professional' ? 'rgba(100,181,246,0.12)' : 'rgba(76,175,80,0.12)',
                      color: player.user_type === 'professional' ? '#64b5f6' : '#4caf50',
                      border: `1px solid ${player.user_type === 'professional' ? 'rgba(100,181,246,0.3)' : 'rgba(76,175,80,0.3)'}`,
                    }}>
                      {player.user_type === 'professional' ? '💼 Professional' : '🎓 Student'}
                    </span>
                  )}
                  {player.charactertype && (
                    <span style={{
                      fontSize: '10px', padding: '2px 8px', borderRadius: '10px', fontWeight: '700',
                      background: 'rgba(255,193,7,0.1)', color: '#ffc107',
                      border: '1px solid rgba(255,193,7,0.25)', textTransform: 'capitalize',
                    }}>
                      ⭐ {player.charactertype}
                    </span>
                  )}
                  {isRecentlyActive(player.lastactive) && (
                    <span style={{
                      fontSize: '10px', padding: '2px 8px', borderRadius: '10px', fontWeight: '700',
                      background: 'rgba(76,175,80,0.12)', color: '#4caf50',
                      border: '1px solid rgba(76,175,80,0.3)',
                    }}>
                      🟢 Online
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* XP Progress */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid #21262d', borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#e6edf3', fontSize: '12px', fontWeight: '700' }}>Rank Progress</span>
                <span style={{ color: '#ffc107', fontSize: '12px', fontWeight: '700' }}>{progress}%</span>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '6px', height: '8px', overflow: 'hidden', marginBottom: '6px' }}>
                <div style={{ width: `${progress}%`, height: '100%', background: 'linear-gradient(90deg,#4caf50,#66bb6a)', borderRadius: '6px', transition: 'width 0.8s ease' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '10px', color: '#484f58' }}>{player.totalxp.toLocaleString()} XP</span>
                <span style={{ fontSize: '10px', color: '#ffc107' }}>
                  {xpToNext === null ? '🌟 Max rank' : `${xpToNext.toLocaleString()} to next`}
                </span>
              </div>
            </div>

            {/* Stats grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '18px' }}>
              {[
                { icon: '⭐', value: player.totalxp.toLocaleString(), label: 'Total XP',      color: '#ffc107' },
                { icon: '🔬', value: player.sandbox_runs,             label: 'Analyses',      color: '#4caf50' },
                { icon: '⚔️', value: questsCompleted ?? '…',           label: 'Quests done',   color: '#ffa726' },
              ].map(s => (
                <div key={s.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid #21262d', borderRadius: '10px', padding: '10px 6px', textAlign: 'center' }}>
                  <div style={{ fontSize: '18px', marginBottom: '3px' }}>{s.icon}</div>
                  <div style={{ color: s.color, fontSize: '15px', fontWeight: '800' }}>{s.value}</div>
                  <div style={{ color: '#484f58', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '2px' }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Activity line */}
            <div style={{ padding: '10px 14px', background: 'rgba(88,166,255,0.04)', border: '1px solid rgba(88,166,255,0.15)', borderRadius: '10px', fontSize: '12px', color: '#8b949e', marginBottom: '18px' }}>
              🕒 Last active <b style={{ color: '#c9d1d9' }}>{timeAgo(player.lastactive)}</b>
            </div>

            <button
              onClick={onClose}
              style={{
                width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid #30363d',
                color: '#e6edf3', padding: '11px', borderRadius: '9px', fontSize: '13px',
                fontWeight: '700', cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default PlayerDetailModal
