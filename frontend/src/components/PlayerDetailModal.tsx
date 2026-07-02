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
import { supabase } from '@/services/supabase'
import { getLevelProgress, getXPToNextLevel, getRank } from '@/types'

interface PlayerRow {
  id: string
  playername: string
  totalxp: number
  currentlevel: number
  sandbox_runs: number
  quests_completed: number   // ← pulled directly from users table
  createdat: string
  lastactive: string | null
  charactertype: string | null
  user_type: 'student' | 'professional' | null
}

interface ReportInsight {
  id: string
  type: string | null
  createdat: string
  mode_context: string | null
  cognitive_complexity: number | null
}

interface QuestInsight {
  questid: string | null
  status: string | null
  hintsused: number | null
  completedat: string | null
  first_completed_at: string | null
  updatedat: string | null
  completion_time_seconds: number | null
  quests: { title: string } | { title: string }[] | null
}

interface ActivityInsight {
  id: string
  type: string
  title: string
  description: string | null
  xp_gained: number | null
  createdat: string
}

interface PlayerProfileDetail {
  player: PlayerRow
  rankPosition: number | null
  reports: ReportInsight[]
  quests: QuestInsight[]
  activity: ActivityInsight[]
  avatarUrl: string | null
}

const questTitle = (quest: QuestInsight): string => {
  const row = Array.isArray(quest.quests) ? quest.quests[0] : quest.quests
  return row?.title ?? quest.questid ?? 'Unknown Quest'
}

const timeAgo = (iso: string | null | undefined): string => {
  const time = validActivityTime(iso)
  if (time == null) return '—'
  const mins = Math.max(0, Math.floor((Date.now() - time) / 60000))
  if (mins < 1)    return 'active now'
  if (mins < 60)   return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  const days = Math.floor(mins / 1440)
  if (days < 30)   return `${days}d ago`
  return new Date(time).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

const isRecentlyActive = (iso: string | null | undefined): boolean => {
  const time = validActivityTime(iso)
  if (time == null) return false
  return Math.floor((Date.now() - time) / 60000) < 30
}

const validActivityTime = (iso: string | null | undefined): number | null => {
  const raw = iso
  if (!raw) return null
  const time = new Date(raw).getTime()
  if (!Number.isFinite(time)) return null
  return time > Date.now() + 5 * 60_000 ? null : time
}

const latestActivityIso = (values: Array<string | null | undefined>): string | null => {
  let best: number | null = null
  for (const value of values) {
    const time = validActivityTime(value)
    if (time == null) continue
    if (best == null || time > best) best = time
  }
  return best == null ? null : new Date(best).toISOString()
}

const countUniqueCompletedQuests = (rows: { id?: string | null; questid?: string | null; first_completed_at?: string | null; status?: string | null }[]) =>
  new Set(rows.filter(row => row.first_completed_at || row.status === 'completed').map(row => row.questid ?? row.id)).size

const fmtDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

const pct = (value: number, total: number): number =>
  total <= 0 ? 0 : Math.min(100, Math.round((value / total) * 100))

export const PlayerDetailModal: React.FC<{
  userId: string
  currentUserId?: string
  onClose: () => void
}> = ({ userId, currentUserId, onClose }) => {
  const [detail, setDetail] = useState<PlayerProfileDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const fetchAll = async () => {
      setLoading(true)
      setError(null)

      // Single query — quests_completed now lives on the users row (synced by DB trigger)
      const { data, error: err } = await supabase
        .from('users')
        .select('id, playername, totalxp, currentlevel, sandbox_runs, quests_completed, createdat, lastactive, charactertype, user_type')
        .eq('id', userId)
        .maybeSingle()

      if (cancelled) return

      if (err || !data) {
        setError(err?.message ?? 'Could not load profile — likely blocked by RLS SELECT policy on users table.')
        setLoading(false)
        return
      }

      const [reportsRes, activityRes, progressRes, rankRes, avatarRes] = await Promise.all([
        supabase.from('reports').select('id, type, createdat, mode_context, cognitive_complexity').eq('userid', userId).order('createdat', { ascending: false }).limit(50),
        supabase.from('activity_log').select('id, type, title, description, xp_gained, createdat').eq('userid', userId).order('createdat', { ascending: false }).limit(8),
        supabase.from('mission_progress').select('questid, status, hintsused, completedat, first_completed_at, updatedat, completion_time_seconds, quests(title)').eq('userid', userId).order('updatedat', { ascending: false }).limit(50),
        supabase.from('users').select('*', { count: 'exact', head: true }).eq('isactive', true).gt('totalxp', data.totalxp ?? 0),
        supabase.storage.from('Avatars').list(userId, { limit: 10 }),
      ])

      if (reportsRes.error) throw new Error(`Could not load report history: ${reportsRes.error.message}`)
      if (activityRes.error) throw new Error(`Could not load activity feed: ${activityRes.error.message}`)
      if (progressRes.error) throw new Error(`Could not load quest progress: ${progressRes.error.message}`)
      if (rankRes.error) throw new Error(`Could not load leaderboard rank: ${rankRes.error.message}`)

      const reports = (reportsRes.data ?? []) as ReportInsight[]
      const quests = (progressRes.data ?? []) as unknown as QuestInsight[]
      const activity = (activityRes.data ?? []) as ActivityInsight[]
      const latestQuest = quests[0]
      const completedCount = (data as PlayerRow).quests_completed ?? countUniqueCompletedQuests(quests)
      const avatarFile = avatarRes.data?.find(file => file.id && file.name && !file.name.includes('banner') && file.metadata?.mimetype?.startsWith('image/'))
        ?? avatarRes.data?.find(file => file.id && file.name && file.name !== 'banner')
      const avatarUrl = avatarFile
        ? supabase.storage.from('Avatars').getPublicUrl(`${userId}/${avatarFile.name}`).data.publicUrl
        : null

      setDetail({
        player: {
        ...data,
          quests_completed: completedCount,
        lastactive: latestActivityIso([
          data.lastactive,
            reports[0]?.createdat,
            activity[0]?.createdat,
            latestQuest?.updatedat,
            latestQuest?.first_completed_at,
            latestQuest?.completedat,
        ]),
        } as PlayerRow,
        rankPosition: (rankRes.count ?? 0) + 1,
        reports,
        quests,
        activity,
        avatarUrl,
      })
      setLoading(false)
    }
    fetchAll().catch(fetchError => {
      if (cancelled) return
      setError(fetchError instanceof Error ? fetchError.message : 'Could not load profile details.')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [userId])

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const isMe = currentUserId === userId
  const player = detail?.player ?? null
  // Rank from XP (not stale `currentlevel`) — see types/index.ts getRank().
  const rank     = player ? getRank(player.totalxp ?? 0) : null
  const progress = player ? getLevelProgress(player.totalxp) : 0
  const xpToNext = player ? getXPToNextLevel(player.totalxp) : null
  const completedQuests = (detail?.quests ?? []).filter(quest => quest.first_completed_at || quest.status === 'completed')
  const avgComplexity = detail?.reports.length
    ? Math.round((detail.reports.reduce((sum, report) => sum + (report.cognitive_complexity ?? 0), 0) / detail.reports.filter(report => report.cognitive_complexity != null).length || 0) * 10) / 10
    : null
  const noHintRuns = completedQuests.filter(quest => (quest.hintsused ?? 0) === 0).length
  const cleanQuestPct = pct(noHintRuns, completedQuests.length)
  const sandboxShare = pct(player?.sandbox_runs ?? 0, (player?.sandbox_runs ?? 0) + (player?.quests_completed ?? 0))
  const campaignShare = 100 - sandboxShare
  const fastestQuests = completedQuests
    .filter((quest): quest is QuestInsight & { completion_time_seconds: number } => typeof quest.completion_time_seconds === 'number')
    .sort((a, b) => a.completion_time_seconds - b.completion_time_seconds)
    .slice(0, 3)
  const recentQuest = completedQuests.find(quest => quest.first_completed_at || quest.completedat)
  const signature = (() => {
    if (!player) return 'Explorer'
    if (player.quests_completed >= 10 && cleanQuestPct >= 70) return 'Precision quest finisher'
    if (player.sandbox_runs >= player.quests_completed * 5) return 'Sandbox experimenter'
    if (player.quests_completed >= player.sandbox_runs) return 'Campaign climber'
    if (isRecentlyActive(player.lastactive)) return 'Active learner'
    return 'Steady explorer'
  })()

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
          width: '100%', maxWidth: '680px', padding: '28px',
          boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
          animation: 'pdSlideUp 0.25s ease-out',
          fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
          minHeight: 200,
          maxHeight: '88vh',
          overflowY: 'auto',
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
                width: '78px', height: '78px', borderRadius: '50%', flexShrink: 0,
                background: isMe ? 'linear-gradient(135deg,#4caf50,#2d7a2d)' : 'linear-gradient(135deg,#64b5f6,#1976d2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '30px', fontWeight: '800', color: 'white',
                border: '3px solid rgba(255,255,255,0.08)',
                overflow: 'hidden',
              }}>
                {detail?.avatarUrl
                  ? <img src={detail.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : player.playername.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#e6edf3', fontSize: '20px', fontWeight: '800', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {player.playername}
                  {isMe && <span style={{ fontSize: '11px', color: '#4caf50', marginLeft: '6px', fontWeight: '700' }}>(you)</span>}
                </div>
                <div style={{ color: '#8b949e', fontSize: '12px', marginTop: '4px' }}>
                  {rank?.name ?? 'Squire'} · #{detail?.rankPosition ?? '?'} leaderboard · Joined {new Date(player.createdat).toLocaleDateString([], { month: 'short', year: 'numeric' })}
                </div>
                <div style={{ color: '#58a6ff', fontSize: '12px', marginTop: '5px', fontWeight: 700 }}>
                  {signature}
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px', marginBottom: '18px' }}>
              {[
                { icon: '⭐', value: player.totalxp.toLocaleString(), label: 'Total XP',    color: '#ffc107' },
                { icon: '🔬', value: player.sandbox_runs,             label: 'Analyses',    color: '#4caf50' },
                { icon: '⚔️', value: player.quests_completed,          label: 'Quests done', color: '#ffa726' },
                { icon: '🎯', value: `${cleanQuestPct}%`,              label: 'No-hint rate', color: '#58a6ff' },
                { icon: '🧠', value: avgComplexity ?? '—',             label: 'Avg complexity', color: '#a371f7' },
              ].map(s => (
                <div key={s.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid #21262d', borderRadius: '10px', padding: '10px 6px', textAlign: 'center' }}>
                  <div style={{ fontSize: '18px', marginBottom: '3px' }}>{s.icon}</div>
                  <div style={{ color: s.color, fontSize: '15px', fontWeight: '800' }}>{s.value}</div>
                  <div style={{ color: '#484f58', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '2px' }}>{s.label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid #21262d', borderRadius: 12, padding: 14 }}>
                <div style={{ color: '#8b949e', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, fontWeight: 800 }}>Learning Mix</div>
                <div style={{ display: 'flex', height: 9, borderRadius: 999, overflow: 'hidden', background: '#21262d', marginBottom: 8 }}>
                  <div style={{ width: `${sandboxShare}%`, background: '#4caf50' }} />
                  <div style={{ width: `${campaignShare}%`, background: '#ffa726' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#8b949e' }}>
                  <span>Sandbox {sandboxShare}%</span>
                  <span>Campaign {campaignShare}%</span>
                </div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid #21262d', borderRadius: 12, padding: 14 }}>
                <div style={{ color: '#8b949e', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, fontWeight: 800 }}>Quest Discipline</div>
                <div style={{ color: '#e6edf3', fontSize: 13, lineHeight: 1.6 }}>
                  <b style={{ color: '#58a6ff' }}>{noHintRuns}</b> clean completions<br />
                  <b style={{ color: '#ffa726' }}>{recentQuest ? questTitle(recentQuest) : 'No completed quest yet'}</b>
                </div>
              </div>
            </div>

            {/* Activity line */}
            <div style={{ padding: '10px 14px', background: 'rgba(88,166,255,0.04)', border: '1px solid rgba(88,166,255,0.15)', borderRadius: '10px', fontSize: '12px', color: '#8b949e', marginBottom: '18px' }}>
              🕒 Last active <b style={{ color: '#c9d1d9' }}>{timeAgo(player.lastactive)}</b>
            </div>

            {fastestQuests.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 10, color: '#484f58', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8, fontWeight: 800 }}>⚡ Fastest Quest Times</div>
                {fastestQuests.map((quest, index) => (
                  <div key={`${quest.questid}-${index}`} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 0', borderBottom: index < fastestQuests.length - 1 ? '1px solid #21262d' : 'none' }}>
                    <span style={{ color: '#484f58', minWidth: 20, fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>#{index + 1}</span>
                    <span style={{ flex: 1, color: '#c9d1d9', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{questTitle(quest)}</span>
                    <span style={{ color: '#3fb950', fontSize: 12, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace" }}>{fmtDuration(quest.completion_time_seconds)}</span>
                  </div>
                ))}
              </div>
            )}

            {(detail?.activity.length ?? 0) > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 10, color: '#484f58', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8, fontWeight: 800 }}>Recent Signal</div>
                {detail!.activity.slice(0, 4).map(item => (
                  <div key={item.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid #21262d' }}>
                    <span style={{ fontSize: 14 }}>{item.type === 'quest_completed' ? '⚔️' : item.type === 'level_up' ? '🏆' : '🔬'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: '#e6edf3', fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
                      <div style={{ color: '#8b949e', fontSize: 11 }}>{item.description || (item.xp_gained ? `+${item.xp_gained} XP` : timeAgo(item.createdat))}</div>
                    </div>
                    <span style={{ color: '#484f58', fontSize: 10, whiteSpace: 'nowrap' }}>{timeAgo(item.createdat)}</span>
                  </div>
                ))}
              </div>
            )}

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
