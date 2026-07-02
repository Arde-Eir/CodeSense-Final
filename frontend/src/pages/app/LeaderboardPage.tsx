// src/LeaderboardPage.tsx
import React, { useCallback, useEffect, useState, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/components/AuthContext'
import { supabase } from '@/services/supabase'
import { getRank } from '@/types'
import { PlayerDetailModal } from '@/components/PlayerDetailModal'

interface Player {
  id: string
  playername: string
  totalxp: number
  currentlevel: number
  sandbox_runs: number
  quests_completed: number
  createdat: string
  lastactive: string | null
  charactertype: string | null
  user_type: 'student' | 'professional' | null
}

interface SpeedRecord {
  userid: string
  questid: string
  completion_time_seconds: number
  users: Player | null
  quests: { title: string } | null
}

const isCompletedMissionRow = (row: { first_completed_at?: string | null; status?: string | null }) =>
  Boolean(row.first_completed_at || row.status === 'completed')

const completedQuestCountsByUser = (rows: { userid: string; questid?: string | null; id?: string | null; first_completed_at?: string | null; status?: string | null }[]) => {
  const byUser = new Map<string, Set<string>>()
  for (const row of rows.filter(isCompletedMissionRow)) {
    if (!byUser.has(row.userid)) byUser.set(row.userid, new Set())
    byUser.get(row.userid)!.add(row.questid ?? row.id ?? '')
  }
  return byUser
}

const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

type SortKey = 'xp' | 'level' | 'sandbox_runs' | 'recent' | 'quests'
type FilterKey = 'all' | 'student' | 'professional'

const PAGE_SIZE = 20

const SORT_OPTIONS: { key: SortKey; label: string; column: string; ascending: boolean }[] = [
  { key: 'xp',            label: 'Highest XP',        column: 'totalxp',         ascending: false },
  { key: 'level',         label: 'Highest Level',     column: 'currentlevel',    ascending: false },
  { key: 'sandbox_runs',  label: 'Most Active',       column: 'sandbox_runs',    ascending: false },
  { key: 'quests',        label: 'Most Quests',       column: 'quests_completed', ascending: false },
  { key: 'recent',        label: 'Recently Joined',   column: 'createdat',       ascending: false },
]

const FILTER_OPTIONS: { key: FilterKey; label: string; icon: string }[] = [
  { key: 'all',          label: 'Everyone',      icon: '🌐' },
  { key: 'student',      label: 'Students',      icon: '🎓' },
  { key: 'professional', label: 'Professionals', icon: '💼' },
]

// ─── Relative time helper ────────────────────────────────────────────────────
const validActivityTime = (iso: string | null | undefined): number | null => {
  const raw = iso
  if (!raw) return null
  const time = new Date(raw).getTime()
  if (!Number.isFinite(time)) return null
  const fiveMinutesAhead = Date.now() + 5 * 60_000
  return time > fiveMinutesAhead ? null : time
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
  const mins = Math.floor((Date.now() - time) / 60000)
  return mins < 30
}

// ─── Main Leaderboard Page ───────────────────────────────────────────────────
export const LeaderboardPage: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [players, setPlayers] = useState<Player[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [myRank, setMyRank] = useState<number | null>(null)
  const [myPlayer, setMyPlayer] = useState<Player | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('xp')
  const [filterKey, setFilterKey] = useState<FilterKey>('all')
  const [detailPlayer, setDetailPlayer] = useState<Player | null>(null)
  const [statsSummary, setStatsSummary] = useState({ totalPlayers: 0, avgXP: 0, topXP: 0, activeToday: 0 })
  const [shareMsg, setShareMsg] = useState('')
  const [speedRecords, setSpeedRecords] = useState<SpeedRecord[]>([])
  const [speedLoading, setSpeedLoading] = useState(false)
  const [speedView, setSpeedView] = useState<'all' | 'best'>('best')
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Override overflow:hidden from layout.css
  useEffect(() => {
    const els = [document.documentElement, document.body, document.getElementById('root')]
    els.forEach(el => { if (el) el.style.overflow = 'auto' })
    return () => { els.forEach(el => { if (el) el.style.overflow = '' }) }
  }, [])

  const fetchSpeedRecords = useCallback(async () => {
    setSpeedLoading(true)
    try {
      const { data } = await supabase
        .from('mission_progress')
        .select('userid, questid, completion_time_seconds, users(id, playername, totalxp, currentlevel, sandbox_runs, createdat, lastactive, charactertype, user_type), quests(title)')
        .not('completion_time_seconds', 'is', null)
        .order('completion_time_seconds', { ascending: true })
        .limit(50)
      setSpeedRecords((data as any[]) ?? [])
    } catch (e) {
      console.error('Speed records fetch error:', e)
    } finally {
      setSpeedLoading(false)
    }
  }, [])

  const fetchStatsSummary = useCallback(async () => {
    const since = new Date(Date.now() - 86400_000).toISOString()
    const [usersRes, reportsRes, activityRes, progressRes] = await Promise.all([
      supabase.from('users').select('id, totalxp, lastactive').eq('isactive', true),
      supabase.from('reports').select('userid, createdat').gte('createdat', since).limit(1000),
      supabase.from('activity_log').select('userid, createdat').gte('createdat', since).limit(1000),
      supabase.from('mission_progress').select('userid, updatedat').gte('updatedat', since).limit(1000),
    ])
    const data = usersRes.data
    if (!data) return
    const totalPlayers = data.length
    const avgXP = totalPlayers === 0 ? 0 : Math.round(data.reduce((s, p) => s + (p.totalxp ?? 0), 0) / totalPlayers)
    const topXP = data.reduce((m, p) => Math.max(m, p.totalxp ?? 0), 0)
    const dayAgo = Date.now() - 86400_000
    const activeIds = new Set<string>()
    for (const player of data) {
      const activeAt = validActivityTime(player.lastactive)
      if (activeAt != null && activeAt >= dayAgo) activeIds.add(player.id)
    }
    for (const row of (reportsRes.data ?? []) as any[]) activeIds.add(row.userid)
    for (const row of (activityRes.data ?? []) as any[]) activeIds.add(row.userid)
    for (const row of (progressRes.data ?? []) as any[]) activeIds.add(row.userid)
    const activeToday = activeIds.size
    setStatsSummary({ totalPlayers, avgXP, topXP, activeToday })
  }, [])

  const fetchPlayers = useCallback(async () => {
    setLoading(true)
    try {
      const sortCfg = SORT_OPTIONS.find(s => s.key === sortKey) ?? SORT_OPTIONS[0]
      let query = supabase
        .from('users')
        .select('id, playername, totalxp, currentlevel, sandbox_runs,  quests_completed, createdat, lastactive, charactertype, user_type', { count: 'exact' })
        .eq('isactive', true)

      if (filterKey !== 'all') {
        query = query.eq('user_type', filterKey)
      }

      if (sortKey === 'recent') {
        query = query.order('createdat', { ascending: false })
      } else {
        query = query.order(sortCfg.column, { ascending: sortCfg.ascending })
      }
      if (searchQuery.trim()) {
        query = query.ilike('playername', `%${searchQuery.trim()}%`)
      } else {
        query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      }

      const { data, count } = await query
      const basePlayers = (data ?? []) as Player[]
      const ids = basePlayers.map(player => player.id)
      let hydratedPlayers = basePlayers
      if (ids.length > 0) {
        const [progressRes, reportRes, activityRes] = await Promise.all([
          supabase
            .from('mission_progress')
            .select('id, userid, questid, status, first_completed_at, completedat, updatedat')
            .in('userid', ids),
          supabase
            .from('reports')
            .select('userid, createdat')
            .in('userid', ids)
            .order('createdat', { ascending: false })
            .limit(300),
          supabase
            .from('activity_log')
            .select('userid, createdat')
            .in('userid', ids)
            .order('createdat', { ascending: false })
            .limit(300),
        ])
        const progressRows = (progressRes.data ?? []) as any[]
        const counts = completedQuestCountsByUser((progressRows ?? []) as any[])
        const activityByUser = new Map<string, string[]>()
        const addActivity = (userid: string | null | undefined, iso: string | null | undefined) => {
          if (!userid || !iso) return
          if (!activityByUser.has(userid)) activityByUser.set(userid, [])
          activityByUser.get(userid)!.push(iso)
        }
        for (const row of progressRows) {
          addActivity(row.userid, row.updatedat)
          addActivity(row.userid, row.first_completed_at)
          addActivity(row.userid, row.completedat)
        }
        for (const row of (reportRes.data ?? []) as any[]) addActivity(row.userid, row.createdat)
        for (const row of (activityRes.data ?? []) as any[]) addActivity(row.userid, row.createdat)

        hydratedPlayers = basePlayers.map(player => ({
          ...player,
          quests_completed: counts.get(player.id)?.size ?? 0,
          lastactive: latestActivityIso([player.lastactive, ...(activityByUser.get(player.id) ?? [])]),
        }))
        if (sortKey === 'quests') {
          hydratedPlayers = hydratedPlayers.sort((a, b) => b.quests_completed - a.quests_completed || b.totalxp - a.totalxp)
        }
      }
      setPlayers(hydratedPlayers)
      setTotal(count ?? 0)
    } catch (e) {
      console.error('Leaderboard fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [filterKey, page, searchQuery, sortKey])

  const fetchMyRank = useCallback(async () => {
    if (!user) return
    const { data: me } = await supabase
      .from('users').select('id, playername, totalxp, currentlevel, sandbox_runs, quests_completed, createdat, lastactive, charactertype, user_type')
      .eq('id', user.id).single()
    if (me) {
      setMyPlayer(me as Player)
      const { count } = await supabase
        .from('users').select('*', { count: 'exact', head: true })
        .eq('isactive', true).gt('totalxp', me.totalxp)
      setMyRank((count ?? 0) + 1)
    }
  }, [user])

  useEffect(() => { fetchSpeedRecords() }, [fetchSpeedRecords])

  useEffect(() => {
    fetchPlayers()
  }, [fetchPlayers])

  useEffect(() => {
    if (!user) return
    fetchMyRank()
    fetchStatsSummary()

    const channel = supabase.channel('lb-page-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
        fetchPlayers(); fetchMyRank(); fetchStatsSummary()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mission_progress' }, () => {
        fetchPlayers()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchMyRank, fetchPlayers, fetchStatsSummary, user])

  const handleSearchChange = (val: string) => {
    setSearchInput(val)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => {
      setSearchQuery(val); setPage(0)
    }, 300)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const rankIcon = (rank: number) =>
    rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`

  const rankColor = (rank: number) =>
    rank === 1 ? '#ffd700' : rank === 2 ? '#c0c0c0' : rank === 3 ? '#cd7f32' : '#8b949e'

  // When sorting by something other than XP, we don't show a global rank number
  const globalRank = (i: number) => (searchQuery || sortKey !== 'xp') ? null : page * PAGE_SIZE + i + 1

  const shareMyRank = () => {
    if (!myPlayer || !myRank) return
    const txt = `🏆 CodeSense Leaderboard\nRank #${myRank} · ${myPlayer.playername}\n⭐ ${myPlayer.totalxp} XP · ${getRank(myPlayer.totalxp ?? 0).name} · 🔬 ${myPlayer.sandbox_runs} analyses`
    navigator.clipboard?.writeText(txt).then(() => {
      setShareMsg('Copied to clipboard!')
      setTimeout(() => setShareMsg(''), 2500)
    })
  }

  // Memo: show podium only for XP-sort, first page, no search
  const showPodium = !searchQuery && page === 0 && sortKey === 'xp' && filterKey === 'all' && players.length >= 3

  // "Best per quest" view: one entry per quest — the fastest time (data already sorted ASC).
  const speedByQuest = useMemo(() => {
    const seen = new Set<string>()
    return speedRecords.filter(r => {
      if (seen.has(r.questid)) return false
      seen.add(r.questid)
      return true
    })
  }, [speedRecords])

  const statChips = useMemo(() => ([
    { icon: '👥', value: statsSummary.totalPlayers.toLocaleString(),          label: 'Players',      color: '#64b5f6' },
    { icon: '📊', value: statsSummary.avgXP.toLocaleString(),                 label: 'Average XP',   color: '#4caf50' },
    { icon: '👑', value: statsSummary.topXP.toLocaleString(),                 label: 'Top XP',       color: '#ffc107' },
    { icon: '🟢', value: statsSummary.activeToday.toLocaleString(),           label: 'Active today', color: '#a371f7' },
  ]), [statsSummary])

  return (
    <div style={{
      minHeight: '100vh', width: '100%',
      background: 'linear-gradient(135deg, #0d1117 0%, #1a1f2e 100%)',
      color: 'white', fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
      boxSizing: 'border-box' as const
    }}>
      <style>{`
        @media (max-width: 768px) {
          .lb-header {
            padding: 12px 16px !important;
          }
          .lb-header-back {
            font-size: 13px !important;
            min-height: 40px !important;
            display: flex !important;
            align-items: center !important;
          }
          .lb-content {
            padding: 16px 12px !important;
          }
          .lb-stats-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
          .lb-thead, .lb-row {
            grid-template-columns: 44px 1fr 76px 80px !important;
            padding: 12px 14px !important;
          }
          .lb-col-level, .lb-col-runs {
            display: none !important;
          }
          .lb-row-player-name {
            font-size: 14px !important;
          }
          .lb-row-player-sub {
            display: none !important;
          }
        }
      `}</style>

      {/* Header */}
      <header className="lb-header" style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '16px 32px', background: 'rgba(22,27,34,0.95)',
        borderBottom: '1px solid #21262d', position: 'sticky', top: 0, zIndex: 100,
        backdropFilter: 'blur(8px)'
      }}>
        <button className="lb-header-back" onClick={() => navigate('/home')} style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '14px' }}>
          ← Back to Dashboard
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '22px' }}>🏆</span>
          <span style={{ color: '#e6edf3', fontSize: '18px', fontWeight: '700' }}>Leaderboard</span>
        </div>
        <div style={{ color: '#8b949e', fontSize: '12px' }}>
          {total > 0 && `${total} player${total !== 1 ? 's' : ''}`}
        </div>
      </header>

      <div className="lb-content" style={{ maxWidth: '960px', margin: '0 auto', padding: '28px 24px', boxSizing: 'border-box' as const }}>

        {/* ── Stats summary strip ── */}
        <div className="lb-stats-grid" style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px',
          marginBottom: '22px',
        }}>
          {statChips.map(c => (
            <div key={c.label} style={{
              background: 'rgba(22,27,34,0.9)', border: '1px solid #21262d',
              borderRadius: '12px', padding: '14px 10px', textAlign: 'center',
              transition: 'border-color 0.15s, transform 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = c.color + '55'; e.currentTarget.style.transform = 'translateY(-2px)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#21262d'; e.currentTarget.style.transform = 'translateY(0)' }}
            >
              <div style={{ fontSize: '20px', marginBottom: '4px' }}>{c.icon}</div>
              <div style={{ color: c.color, fontSize: '18px', fontWeight: '800' }}>{c.value}</div>
              <div style={{ color: '#484f58', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.6px', marginTop: '2px' }}>{c.label}</div>
            </div>
          ))}
        </div>

        {/* My rank banner */}
        {myPlayer && myRank && !searchQuery && (
          <div style={{
            background: 'rgba(76,175,80,0.08)', border: '1px solid rgba(76,175,80,0.3)',
            borderRadius: '14px', padding: '16px 20px', marginBottom: '20px',
            display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap'
          }}>
            <div style={{ fontSize: '28px', minWidth: '36px', textAlign: 'center' }}>
              {rankIcon(myRank)}
            </div>
            <div style={{
              width: '42px', height: '42px', borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, #4caf50, #2d7a2d)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <span style={{ fontSize: '18px', fontWeight: '700', color: 'white' }}>
                {myPlayer.playername.charAt(0).toUpperCase()}
              </span>
            </div>
            <div style={{ flex: 1, minWidth: '180px' }}>
              <div style={{ color: '#4caf50', fontSize: '14px', fontWeight: '700' }}>
                {myPlayer.playername} <span style={{ fontSize: '11px', opacity: 0.7 }}>(you)</span>
              </div>
              <div style={{ color: '#8b949e', fontSize: '12px', marginTop: '2px' }}>
                {getRank(myPlayer.totalxp ?? 0).name} · {myPlayer.totalxp.toLocaleString()} XP · {myPlayer.sandbox_runs} sandbox runs
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#8b949e', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px' }}>Your Rank</div>
              <div style={{ color: '#4caf50', fontSize: '24px', fontWeight: '800' }}>#{myRank}</div>
            </div>
            <button onClick={shareMyRank}
              style={{
                background: 'rgba(76,175,80,0.15)', border: '1px solid rgba(76,175,80,0.3)',
                color: '#4caf50', padding: '7px 14px', borderRadius: '8px',
                fontSize: '11px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(76,175,80,0.25)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(76,175,80,0.15)' }}
            >
              {shareMsg || '📋 Share Rank'}
            </button>
          </div>
        )}

        {/* Top 3 podium */}
        {showPodium && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: '16px', marginBottom: '32px' }}>
            {/* 2nd */}
            <div onClick={() => setDetailPlayer(players[1])} style={{ textAlign: 'center', flex: 1, cursor: 'pointer' }}>
              <div style={{ fontSize: '28px', marginBottom: '8px' }}>🥈</div>
              <div style={{
                width: '56px', height: '56px', borderRadius: '50%', margin: '0 auto 8px',
                background: 'linear-gradient(135deg, #9e9e9e, #616161)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '3px solid #c0c0c0', fontSize: '22px', fontWeight: '800', color: 'white'
              }}>
                {players[1].playername.charAt(0).toUpperCase()}
              </div>
              <div style={{ color: '#e6edf3', fontSize: '13px', fontWeight: '600', marginBottom: '2px' }}>{players[1].playername}</div>
              <div style={{ color: '#ffc107', fontSize: '12px', fontWeight: '700' }}>{players[1].totalxp.toLocaleString()} XP</div>
              <div style={{ height: '60px', background: 'rgba(192,192,192,0.15)', border: '1px solid rgba(192,192,192,0.3)', borderRadius: '8px 8px 0 0', marginTop: '8px' }} />
            </div>
            {/* 1st */}
            <div onClick={() => setDetailPlayer(players[0])} style={{ textAlign: 'center', flex: 1, cursor: 'pointer' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>🥇</div>
              <div style={{
                width: '68px', height: '68px', borderRadius: '50%', margin: '0 auto 8px',
                background: 'linear-gradient(135deg, #ffc107, #ff8f00)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '3px solid #ffd700', fontSize: '28px', fontWeight: '800', color: 'white',
                boxShadow: '0 0 20px rgba(255,193,7,0.4)'
              }}>
                {players[0].playername.charAt(0).toUpperCase()}
              </div>
              <div style={{ color: '#e6edf3', fontSize: '14px', fontWeight: '700', marginBottom: '2px' }}>{players[0].playername}</div>
              <div style={{ color: '#ffc107', fontSize: '13px', fontWeight: '700' }}>{players[0].totalxp.toLocaleString()} XP</div>
              <div style={{ height: '80px', background: 'rgba(255,193,7,0.1)', border: '1px solid rgba(255,193,7,0.3)', borderRadius: '8px 8px 0 0', marginTop: '8px' }} />
            </div>
            {/* 3rd */}
            <div onClick={() => setDetailPlayer(players[2])} style={{ textAlign: 'center', flex: 1, cursor: 'pointer' }}>
              <div style={{ fontSize: '28px', marginBottom: '8px' }}>🥉</div>
              <div style={{
                width: '56px', height: '56px', borderRadius: '50%', margin: '0 auto 8px',
                background: 'linear-gradient(135deg, #a1887f, #6d4c41)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '3px solid #cd7f32', fontSize: '22px', fontWeight: '800', color: 'white'
              }}>
                {players[2].playername.charAt(0).toUpperCase()}
              </div>
              <div style={{ color: '#e6edf3', fontSize: '13px', fontWeight: '600', marginBottom: '2px' }}>{players[2].playername}</div>
              <div style={{ color: '#ffc107', fontSize: '12px', fontWeight: '700' }}>{players[2].totalxp.toLocaleString()} XP</div>
              <div style={{ height: '44px', background: 'rgba(205,127,50,0.15)', border: '1px solid rgba(205,127,50,0.3)', borderRadius: '8px 8px 0 0', marginTop: '8px' }} />
            </div>
          </div>
        )}

        {/* Search + Sort + Filter controls */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
          {/* Search */}
          <div style={{
            flex: 1, minWidth: '220px',
            background: 'rgba(22,27,34,0.9)', border: '1px solid #21262d',
            borderRadius: '12px', padding: '10px 14px',
            display: 'flex', alignItems: 'center', gap: '10px'
          }}>
            <span style={{ fontSize: '16px', opacity: 0.5 }}>🔍</span>
            <input
              value={searchInput}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search players..."
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: '#e6edf3', fontSize: '14px'
              }}
            />
            {searchInput && (
              <button onClick={() => { setSearchInput(''); setSearchQuery(''); setPage(0) }}
                style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '18px', padding: 0 }}>×</button>
            )}
          </div>

          {/* Sort dropdown */}
          <select
            value={sortKey}
            onChange={e => { setSortKey(e.target.value as SortKey); setPage(0) }}
            style={{
              background: 'rgba(22,27,34,0.9)', border: '1px solid #21262d',
              borderRadius: '12px', padding: '10px 14px', color: '#e6edf3',
              fontSize: '13px', cursor: 'pointer', outline: 'none', minWidth: '160px',
              fontFamily: 'inherit', appearance: 'none',
              backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%238b949e'><path d='M7 10l5 5 5-5z'/></svg>")`,
              backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', backgroundSize: '16px',
              paddingRight: '32px',
            }}
          >
            {SORT_OPTIONS.map(s => (
              <option key={s.key} value={s.key}>📶 {s.label}</option>
            ))}
          </select>
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {FILTER_OPTIONS.map(f => {
            const active = filterKey === f.key
            return (
              <button
                key={f.key}
                onClick={() => { setFilterKey(f.key); setPage(0) }}
                style={{
                  background: active ? 'rgba(76,175,80,0.15)' : 'rgba(22,27,34,0.8)',
                  border: `1px solid ${active ? 'rgba(76,175,80,0.4)' : '#21262d'}`,
                  color: active ? '#4caf50' : '#8b949e',
                  padding: '7px 14px', borderRadius: '10px',
                  fontSize: '12px', fontWeight: '700', cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'rgba(22,27,34,0.8)' }}
              >
                {f.icon} {f.label}
              </button>
            )
          })}
        </div>

        {searchQuery && (
          <div style={{ color: '#8b949e', fontSize: '12px', marginBottom: '10px' }}>
            Found <b style={{ color: '#e6edf3' }}>{players.length}</b> result{players.length !== 1 ? 's' : ''} for "{searchQuery}"
          </div>
        )}

        {/* Players table */}
        <div style={{ background: 'rgba(22,27,34,0.9)', border: '1px solid #21262d', borderRadius: '14px', overflow: 'hidden' }}>
          {/* Table header */}
          <div className="lb-thead" style={{
            display: 'grid', gridTemplateColumns: '52px 1fr 110px 110px 90px 110px',
            padding: '10px 20px', borderBottom: '1px solid #21262d',
            background: 'rgba(255,255,255,0.02)'
          }}>
            {[
              { label: 'RANK',        cls: '' },
              { label: 'PLAYER',      cls: '' },
              { label: 'LEVEL',       cls: 'lb-col-level' },
              { label: 'XP',          cls: '' },
              { label: 'RUNS',        cls: 'lb-col-runs' },
              { label: 'LAST ACTIVE', cls: '' },
            ].map(h => (
              <div key={h.label} className={h.cls} style={{ color: '#484f58', fontSize: '10px', fontWeight: '700', letterSpacing: '1.2px' }}>{h.label}</div>
            ))}
          </div>

          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#8b949e', fontSize: '13px' }}>
              Loading players...
            </div>
          ) : players.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#484f58', fontSize: '13px' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>😶</div>
              No players found{searchQuery ? ` for "${searchQuery}"` : ''}
            </div>
          ) : (
            players.map((player, i) => {
              const rank = globalRank(i)
              const isMe = player.id === user?.id
              const online = isRecentlyActive(player.lastactive)
              return (
                <div key={player.id} className="lb-row" onClick={() => setDetailPlayer(player)} style={{
                  display: 'grid', gridTemplateColumns: '52px 1fr 110px 110px 90px 110px',
                  padding: '14px 20px', borderBottom: '1px solid #21262d',
                  background: isMe ? 'rgba(76,175,80,0.07)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                  transition: 'background 0.15s', cursor: 'pointer',
                  borderLeft: isMe ? '3px solid #4caf50' : '3px solid transparent',
                  alignItems: 'center',
                }}
                  onMouseEnter={e => { if (!isMe) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)' }}
                  onMouseLeave={e => { if (!isMe) (e.currentTarget as HTMLElement).style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}
                >
                  {/* Rank */}
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    {rank ? (
                      <span style={{ fontSize: rank <= 3 ? '18px' : '13px', fontWeight: '700', color: rankColor(rank) }}>
                        {rankIcon(rank)}
                      </span>
                    ) : (
                      <span style={{ color: '#8b949e', fontSize: '12px' }}>—</span>
                    )}
                  </div>

                  {/* Player */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <div style={{
                      position: 'relative',
                      width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
                      background: isMe
                        ? 'linear-gradient(135deg, #4caf50, #2d7a2d)'
                        : rank && rank <= 3
                          ? ['linear-gradient(135deg,#ffc107,#ff8f00)', 'linear-gradient(135deg,#9e9e9e,#616161)', 'linear-gradient(135deg,#a1887f,#6d4c41)'][rank - 1]
                          : 'rgba(100,181,246,0.15)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: isMe ? '2px solid rgba(76,175,80,0.5)' : '2px solid transparent'
                    }}>
                      <span style={{ fontSize: '14px', fontWeight: '700', color: isMe ? 'white' : '#64b5f6' }}>
                        {player.playername.charAt(0).toUpperCase()}
                      </span>
                      {online && (
                        <span style={{
                          position: 'absolute', bottom: 0, right: 0,
                          width: '10px', height: '10px', borderRadius: '50%',
                          background: '#4caf50', border: '2px solid #0d1117',
                        }} title="Active now" />
                      )}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="lb-row-player-name" style={{ color: isMe ? '#4caf50' : '#e6edf3', fontSize: '13px', fontWeight: isMe ? '700' : '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {player.playername}
                        {isMe && <span style={{ fontSize: '10px', color: '#4caf50', marginLeft: '6px', opacity: 0.8 }}>(you)</span>}
                        {player.user_type === 'professional' && <span style={{ fontSize: '9px', marginLeft: '6px', opacity: 0.7 }}>💼</span>}
                      </div>
                      <div className="lb-row-player-sub" style={{ color: '#484f58', fontSize: '11px' }}>
                        Joined {new Date(player.createdat).toLocaleDateString([], { month: 'short', year: 'numeric' })}
                      </div>
                    </div>
                  </div>

                  {/* Level */}
                  <div className="lb-col-level" style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ color: '#64b5f6', fontSize: '12px', fontWeight: '600' }}>
                      {getRank(player.totalxp ?? 0).name}
                    </span>
                  </div>

                  {/* XP */}
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ color: '#ffc107', fontSize: '13px', fontWeight: '700' }}>{player.totalxp.toLocaleString()}</span>
                    <span style={{ color: '#484f58', fontSize: '10px', marginLeft: '3px' }}>XP</span>
                  </div>

                  {/* Sandbox runs */}
                  <div className="lb-col-runs" style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ color: '#4caf50', fontSize: '12px', fontWeight: '600' }}>{player.sandbox_runs}</span>
                  </div>

                  {/* Last active */}
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ color: online ? '#4caf50' : '#8b949e', fontSize: '11px', fontWeight: online ? '700' : '400' }}>
                      {timeAgo(player.lastactive)}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Pagination — only when not searching */}
        {!searchQuery && totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginTop: '20px' }}>
            <button
              onClick={() => setPage(0)} disabled={page === 0}
              style={{ ...pageBtnStyle, opacity: page === 0 ? 0.3 : 1 }}>«</button>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              style={{ ...pageBtnStyle, opacity: page === 0 ? 0.3 : 1 }}>‹</button>

            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const start = Math.max(0, Math.min(page - 2, totalPages - 5))
              const p = start + i
              return (
                <button key={p} onClick={() => setPage(p)} style={{
                  ...pageBtnStyle,
                  background: p === page ? '#4caf50' : 'transparent',
                  color: p === page ? 'white' : '#8b949e',
                  border: p === page ? '1px solid #4caf50' : '1px solid #30363d',
                  fontWeight: p === page ? '700' : '400'
                }}>{p + 1}</button>
              )
            })}

            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              style={{ ...pageBtnStyle, opacity: page >= totalPages - 1 ? 0.3 : 1 }}>›</button>
            <button
              onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
              style={{ ...pageBtnStyle, opacity: page >= totalPages - 1 ? 0.3 : 1 }}>»</button>

            <span style={{ color: '#484f58', fontSize: '12px', marginLeft: '8px' }}>
              Page {page + 1} of {totalPages}
            </span>
          </div>
        )}

        {/* ── Speed Records ── */}
        <div style={{ marginTop: '36px' }}>
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
              <span style={{ fontSize: '22px' }}>⚡</span>
              <span style={{ color: '#e6edf3', fontSize: '18px', fontWeight: '800' }}>Speed Records</span>
              {!speedLoading && speedRecords.length > 0 && (
                <span style={{ fontSize: '12px', color: '#484f58' }}>· {speedView === 'best' ? `${speedByQuest.length} quests` : `${speedRecords.length} runs`}</span>
              )}
            </div>
            {/* View toggle */}
            <div style={{ display: 'flex', background: 'rgba(22,27,34,0.9)', border: '1px solid #21262d', borderRadius: '10px', padding: '3px', gap: '2px' }}>
              {([{ key: 'best', label: '🏅 Best Per Quest' }, { key: 'all', label: '📋 All Runs' }] as const).map(v => {
                const active = speedView === v.key
                return (
                  <button key={v.key} onClick={() => setSpeedView(v.key)} style={{
                    padding: '6px 14px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                    background: active ? 'rgba(63,185,80,0.18)' : 'transparent',
                    color: active ? '#3fb950' : '#8b949e',
                    fontSize: '12px', fontWeight: 700, transition: 'all 0.15s', fontFamily: 'inherit',
                  }}>
                    {v.label}
                  </button>
                )
              })}
            </div>
          </div>

          {speedLoading ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#8b949e', fontSize: '13px', background: 'rgba(22,27,34,0.9)', borderRadius: '14px', border: '1px solid #21262d' }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>⏱</div>Loading records…
            </div>
          ) : speedRecords.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#484f58', fontSize: '13px', background: 'rgba(22,27,34,0.9)', borderRadius: '14px', border: '1px solid #21262d' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>⏱</div>
              No speed records yet — complete quests to appear here!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {(speedView === 'best' ? speedByQuest : speedRecords).map((record, i) => {
                const p = record.users as Player | null
                const isMe = p?.id === user?.id
                const timeColor = i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : '#3fb950'
                const leftAccent = i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : isMe ? '#3fb950' : 'transparent'
                return (
                  <div key={`${record.userid}-${record.questid}-${i}`}
                    onClick={() => p && setDetailPlayer(p)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '14px',
                      padding: '14px 18px', borderRadius: '12px',
                      background: isMe ? 'rgba(63,185,80,0.07)' : 'rgba(22,27,34,0.9)',
                      border: `1px solid ${isMe ? 'rgba(63,185,80,0.3)' : '#21262d'}`,
                      borderLeft: `3px solid ${leftAccent}`,
                      cursor: p ? 'pointer' : 'default',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { if (p) (e.currentTarget as HTMLElement).style.background = isMe ? 'rgba(63,185,80,0.13)' : 'rgba(255,255,255,0.05)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isMe ? 'rgba(63,185,80,0.07)' : 'rgba(22,27,34,0.9)' }}
                  >
                    {/* Rank */}
                    <div style={{ minWidth: 34, textAlign: 'center', flexShrink: 0 }}>
                      {i < 3
                        ? <span style={{ fontSize: '22px' }}>{(['🥇', '🥈', '🥉'] as const)[i]}</span>
                        : <span style={{ fontSize: '13px', fontWeight: 700, color: '#484f58', fontFamily: "'JetBrains Mono',monospace" }}>#{i + 1}</span>}
                    </div>

                    {/* Avatar */}
                    <div style={{
                      width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                      background: isMe ? 'linear-gradient(135deg,#4caf50,#2d7a2d)' : 'rgba(100,181,246,0.15)',
                      border: `2px solid ${isMe ? 'rgba(76,175,80,0.5)' : 'rgba(100,181,246,0.2)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '15px', fontWeight: 700, color: isMe ? 'white' : '#64b5f6',
                    }}>
                      {p?.playername?.charAt(0).toUpperCase() ?? '?'}
                    </div>

                    {/* Player + Quest info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                        <span style={{ color: isMe ? '#4caf50' : '#e6edf3', fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p?.playername ?? '—'}
                        </span>
                        {isMe && <span style={{ fontSize: '10px', color: '#4caf50', fontWeight: 700, flexShrink: 0 }}>(you)</span>}
                        {p?.user_type === 'professional' && <span style={{ fontSize: '10px', flexShrink: 0 }}>💼</span>}
                      </div>
                      <div style={{ color: '#484f58', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        📋 {(record.quests as any)?.title ?? record.questid}
                      </div>
                    </div>

                    {/* Time */}
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: '18px', fontFamily: "'JetBrains Mono',monospace", color: timeColor, fontWeight: 800, letterSpacing: '-0.5px' }}>
                        {formatTime(record.completion_time_seconds)}
                      </div>
                      <div style={{ fontSize: '10px', color: '#484f58', marginTop: '1px' }}>
                        {record.completion_time_seconds}s total
                      </div>
                    </div>

                    {p && <span style={{ fontSize: '12px', color: '#484f58', flexShrink: 0 }}>›</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {detailPlayer && (
        <PlayerDetailModal
          userId={detailPlayer.id}
          currentUserId={user?.id}
          onClose={() => setDetailPlayer(null)}
        />
      )}
    </div>
  )
}

const pageBtnStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid #30363d', color: '#8b949e',
  width: '34px', height: '34px', borderRadius: '8px', cursor: 'pointer',
  fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center',
  transition: 'all 0.15s'
}
