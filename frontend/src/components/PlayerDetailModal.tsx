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
import { getProfileImageUrls } from '@/services/ProfileImages'
import { getLevelProgress, getXPToNextLevel, getRank } from '@/types'

interface PlayerRow {
  id: string
  playername: string
  totalxp: number
  sandbox_runs: number
  quests_completed: number
  isactive: boolean | null
  is_banned: boolean
  createdat: string | null
  lastactive: string | null
  charactertype: string | null
  user_type: 'student' | 'professional' | null
}

interface ReportInsight {
  id: string
  type: string | null
  createdat: string | null
  mode_context: string | null
  cognitive_complexity: number | null
}

interface QuestInsight {
  questid: string | null
  status: string | null
  attempts: number | null
  hintsused: number | null
  xp_gained: number | null
  completed_activities: string[] | null
  startedat: string | null
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
  bannerUrl: string | null
}

const parsePlayerRow = (value: unknown, userId: string): PlayerRow => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`Learner ${userId} has an invalid profile record.`)
  }
  const row = value as Record<string, unknown>
  if (row.id !== userId || typeof row.playername !== 'string' || row.playername.length === 0) {
    throw new TypeError(`Learner ${userId} has an invalid ID or player name.`)
  }
  for (const field of ['totalxp', 'sandbox_runs', 'quests_completed'] as const) {
    if (typeof row[field] !== 'number' || !Number.isFinite(row[field])) {
      throw new TypeError(`Learner ${userId} has a null or invalid ${field} value. Repair the users row before previewing it.`)
    }
  }
  if (row.createdat !== null && (typeof row.createdat !== 'string' || !Number.isFinite(Date.parse(row.createdat)))) {
    throw new TypeError(`Learner ${userId} has an invalid createdat value.`)
  }
  if (row.lastactive !== null && typeof row.lastactive !== 'string') {
    throw new TypeError(`Learner ${userId} has an invalid lastactive value.`)
  }
  if (row.charactertype !== null && typeof row.charactertype !== 'string') {
    throw new TypeError(`Learner ${userId} has an invalid charactertype value.`)
  }
  if (row.user_type !== 'student' && row.user_type !== 'professional') {
    throw new TypeError(`Learner ${userId} has an invalid user_type value.`)
  }
  if ((row.isactive !== null && typeof row.isactive !== 'boolean') || typeof row.is_banned !== 'boolean') {
    throw new TypeError(`Learner ${userId} has an invalid account status value.`)
  }
  return {
    id: row.id,
    playername: row.playername,
    totalxp: row.totalxp as number,
    sandbox_runs: row.sandbox_runs as number,
    quests_completed: row.quests_completed as number,
    isactive: row.isactive,
    is_banned: row.is_banned,
    createdat: row.createdat as string | null,
    lastactive: row.lastactive as string | null,
    charactertype: row.charactertype as string | null,
    user_type: row.user_type,
  }
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

const loadQuestProgress = async (userId: string, allRows: boolean): Promise<QuestInsight[]> => {
  const rows: QuestInsight[] = []
  const pageSize = allRows ? 500 : 50
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase.from('mission_progress')
      .select('questid, status, attempts, hintsused, xp_gained, completed_activities, startedat, completedat, first_completed_at, updatedat, completion_time_seconds, quests(title)')
      .eq('userid', userId).order('updatedat', { ascending: false }).range(start, start + pageSize - 1)
    if (error) throw new Error(`Could not load quest progress for ${userId}: ${error.message}`)
    const page = (data ?? []) as unknown as QuestInsight[]
    for (const row of page) {
      if (row.completed_activities !== null &&
        (!Array.isArray(row.completed_activities) || row.completed_activities.some(activity => typeof activity !== 'string'))) {
        throw new TypeError(`Learner ${userId} has invalid completed activities for quest ${row.questid}. Expected a JSON array of activity names.`)
      }
    }
    rows.push(...page)
    if (!allRows || page.length < pageSize) return rows
  }
}

const loadReportHistory = async (userId: string, allRows: boolean): Promise<ReportInsight[]> => {
  const rows: ReportInsight[] = []
  const pageSize = allRows ? 500 : 50
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase.from('reports')
      .select('id, type, createdat, mode_context, cognitive_complexity')
      .eq('userid', userId).order('createdat', { ascending: false }).range(start, start + pageSize - 1)
    if (error) throw new Error(`Could not load analysis reports for ${userId}: ${error.message}`)
    const page = (data ?? []) as ReportInsight[]
    rows.push(...page)
    if (!allRows || page.length < pageSize) return rows
  }
}

const loadActivityHistory = async (userId: string, allRows: boolean): Promise<ActivityInsight[]> => {
  const rows: ActivityInsight[] = []
  const pageSize = allRows ? 500 : 8
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase.from('activity_log')
      .select('id, type, title, description, xp_gained, createdat')
      .eq('userid', userId).order('createdat', { ascending: false }).range(start, start + pageSize - 1)
    if (error) throw new Error(`Could not load activity history for ${userId}: ${error.message}`)
    const page = (data ?? []) as ActivityInsight[]
    rows.push(...page)
    if (!allRows || page.length < pageSize) return rows
  }
}

export const PlayerDetailModal: React.FC<{
  userId: string
  currentUserId?: string
  showAllProgress: boolean
  onClose: () => void
}> = ({ userId, currentUserId, showAllProgress, onClose }) => {
  const [detail, setDetail] = useState<PlayerProfileDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reportCode, setReportCode] = useState<{ id: string; sourceCode: string | null } | null>(null)
  const [reportCodeError, setReportCodeError] = useState<string | null>(null)
  const [reportCodeLoading, setReportCodeLoading] = useState<string | null>(null)
  const [visibleReports, setVisibleReports] = useState(50)
  const [visibleActivity, setVisibleActivity] = useState(50)

  useEffect(() => {
    let cancelled = false
    const fetchAll = async () => {
      setLoading(true)
      setError(null)
      setReportCode(null)
      setReportCodeError(null)
      setVisibleReports(50)
      setVisibleActivity(50)

      const { data, error: err } = await supabase
        .from('users')
        .select('id, playername, totalxp, sandbox_runs, quests_completed, isactive, is_banned, createdat, lastactive, charactertype, user_type')
        .eq('id', userId)
        .maybeSingle()

      if (cancelled) return

      if (err || !data) {
        setError(err?.message ?? 'Could not load profile — likely blocked by RLS SELECT policy on users table.')
        setLoading(false)
        return
      }
      const selectedPlayer = parsePlayerRow(data, userId)

      const [reports, activity, quests, rankRes, profileImages] = await Promise.all([
        loadReportHistory(userId, showAllProgress),
        loadActivityHistory(userId, showAllProgress),
        loadQuestProgress(userId, showAllProgress),
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('isactive', true).eq('is_banned', false).gt('totalxp', selectedPlayer.totalxp),
        getProfileImageUrls(userId),
      ])

      if (rankRes.error) throw new Error(`Could not load leaderboard rank: ${rankRes.error.message}`)

      const latestQuest = quests[0]
      const completedCount = showAllProgress
        ? countUniqueCompletedQuests(quests)
        : selectedPlayer.quests_completed
      setDetail({
        player: {
        ...selectedPlayer,
          quests_completed: completedCount,
          lastactive: latestActivityIso([
            selectedPlayer.lastactive,
            reports[0]?.createdat,
            activity[0]?.createdat,
            latestQuest?.updatedat,
            latestQuest?.first_completed_at,
            latestQuest?.completedat,
          ]),
        },
        rankPosition: selectedPlayer.isactive === true && !selectedPlayer.is_banned ? (rankRes.count ?? 0) + 1 : null,
        reports,
        quests,
        activity,
        avatarUrl: profileImages.avatarUrl,
        bannerUrl: profileImages.bannerUrl,
      })
      setLoading(false)
    }
    fetchAll().catch(fetchError => {
      if (cancelled) return
      setError(fetchError instanceof Error ? fetchError.message : 'Could not load profile details.')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [userId, showAllProgress])

  const openReportCode = async (reportId: string): Promise<void> => {
    setReportCodeLoading(reportId)
    setReportCodeError(null)
    try {
      const { data, error: reportError } = await supabase.from('reports')
        .select('sourcecode').eq('id', reportId).eq('userid', userId).maybeSingle()
      if (reportError || !data) throw new Error(`Could not load saved code for report ${reportId}: ${reportError?.message ?? 'report not found'}`)
      if (data.sourcecode !== null && typeof data.sourcecode !== 'string') {
        throw new TypeError(`Report ${reportId} has an invalid sourcecode field.`)
      }
      setReportCode({ id: reportId, sourceCode: data.sourcecode })
    } catch (caught: unknown) {
      setReportCodeError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setReportCodeLoading(null)
    }
  }

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const isMe = currentUserId === userId
  const player = detail?.player ?? null
  const bannerUrl = detail?.bannerUrl ?? null
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
      role="dialog"
      aria-modal="true"
      aria-label="Learner profile and progress snapshot"
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
            {bannerUrl && (
              <div style={{
                height: 136,
                margin: '-28px -28px 0',
                background: `linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.55)), url(${bannerUrl}) center/cover no-repeat`,
                borderBottom: '1px solid #30363d',
              }} />
            )}

            {/* Header */}
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '18px',
              marginBottom: '22px',
              marginTop: bannerUrl ? '-48px' : 0,
              position: 'relative',
              zIndex: 1,
            }}>
              <div style={{
                width: '92px', height: '92px', borderRadius: '50%', flexShrink: 0,
                background: isMe ? 'linear-gradient(135deg,#4caf50,#2d7a2d)' : 'linear-gradient(135deg,#64b5f6,#1976d2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '30px', fontWeight: '800', color: 'white',
                border: '4px solid #161b22',
                boxShadow: '0 0 0 2px rgba(76,175,80,0.75)',
                overflow: 'hidden',
              }}>
                {detail?.avatarUrl
                  ? <img src={detail.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : player.playername.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0, paddingTop: bannerUrl ? 54 : 0 }}>
                <div style={{ color: '#e6edf3', fontSize: '20px', fontWeight: '800', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {player.playername}
                  {isMe && <span style={{ fontSize: '11px', color: '#4caf50', marginLeft: '6px', fontWeight: '700' }}>(you)</span>}
                </div>
                <div style={{ color: '#8b949e', fontSize: '12px', marginTop: '4px' }}>
                  {rank?.name ?? 'Squire'} · {detail?.rankPosition === null ? 'Unranked' : `#${detail?.rankPosition ?? '?'} leaderboard`} · Joined {player.createdat ? new Date(player.createdat).toLocaleDateString([], { month: 'short', year: 'numeric' }) : 'unknown'}
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

            {showAllProgress && <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 10, color: '#8b949e', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8, fontWeight: 800 }}>
                All quest progress ({detail?.quests.length ?? 0})
              </div>
              <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid #30363d', borderRadius: 8 }}>
                {(detail?.quests.length ?? 0) === 0
                  ? <p style={{ color: '#8b949e', padding: 12 }}>No quest progress yet.</p>
                  : detail?.quests.map((quest, index) => <div key={`${quest.questid}-${index}`} style={{ padding: '9px 12px', borderBottom: '1px solid #30363d', fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span style={{ color: '#e6edf3' }}>{questTitle(quest)}</span>
                      <span style={{ color: '#8b949e', whiteSpace: 'nowrap' }}>{quest.status ?? 'Not started'}</span>
                    </div>
                    <div style={{ color: '#8b949e', marginTop: 4 }}>
                      {quest.attempts ?? 0} attempts · {quest.hintsused ?? 0} hints · {quest.xp_gained ?? 0} XP
                      {quest.completed_activities?.length ? ` · ${quest.completed_activities.join(', ')}` : ''}
                      {quest.first_completed_at ? ` · First completed ${new Date(quest.first_completed_at).toLocaleDateString()}` : quest.startedat ? ` · Started ${new Date(quest.startedat).toLocaleDateString()}` : ''}
                    </div>
                  </div>)}
              </div>
            </div>}

            {showAllProgress && <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 10, color: '#8b949e', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8, fontWeight: 800 }}>
                Analysis reports ({detail?.reports.length ?? 0})
              </div>
              <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid #30363d', borderRadius: 8 }}>
                {detail?.reports.length === 0
                  ? <p style={{ color: '#8b949e', padding: 12 }}>No saved analysis reports yet.</p>
                  : detail?.reports.slice(0, visibleReports).map(report => <div key={report.id} style={{ padding: '9px 12px', borderBottom: '1px solid #30363d', fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                      <span style={{ color: '#e6edf3' }}>{report.mode_context ?? report.type ?? 'Analysis'} · {report.createdat ? new Date(report.createdat).toLocaleString() : 'Date unknown'} · complexity {report.cognitive_complexity ?? '—'}</span>
                      <button type="button" data-testid={`preview-report-${report.id}`} disabled={reportCodeLoading !== null} onClick={() => { void openReportCode(report.id) }}>
                        {reportCodeLoading === report.id ? 'Loading…' : 'View code'}
                      </button>
                    </div>
                    {reportCode?.id === report.id && <pre style={{ color: '#c9d1d9', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 220, overflow: 'auto', margin: '8px 0 0' }}>
                      {reportCode.sourceCode ?? 'No source code saved with this report.'}
                    </pre>}
                  </div>)}
              </div>
              {(detail?.reports.length ?? 0) > visibleReports && <button type="button" onClick={() => setVisibleReports(count => count + 50)}>Show 50 more reports</button>}
              {reportCodeError && <p role="alert" style={{ color: '#f85149', fontSize: 12 }}>{reportCodeError}</p>}
            </div>}

            {showAllProgress && <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 10, color: '#8b949e', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8, fontWeight: 800 }}>
                Activity history ({detail?.activity.length ?? 0})
              </div>
              <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid #30363d', borderRadius: 8 }}>
                {detail?.activity.length === 0
                  ? <p style={{ color: '#8b949e', padding: 12 }}>No activity recorded yet.</p>
                  : detail?.activity.slice(0, visibleActivity).map(item => <div key={item.id} style={{ padding: '9px 12px', borderBottom: '1px solid #30363d', fontSize: 12 }}>
                    <div style={{ color: '#e6edf3' }}>{item.title} · {new Date(item.createdat).toLocaleString()}</div>
                    <div style={{ color: '#8b949e', marginTop: 4 }}>{item.description || item.type}{item.xp_gained ? ` · +${item.xp_gained} XP` : ''}</div>
                  </div>)}
              </div>
              {(detail?.activity.length ?? 0) > visibleActivity && <button type="button" onClick={() => setVisibleActivity(count => count + 50)}>Show 50 more activities</button>}
            </div>}

            {!showAllProgress && (detail?.activity.length ?? 0) > 0 && (
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
