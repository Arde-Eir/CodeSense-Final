// src/LeaderboardPage.tsx
import React, { useEffect, useState, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './components/AuthScreen'
import { supabase } from './services/supabase'
import { getLevelName, getLevelProgress, getXPToNextLevel } from './types'

interface Player {
  id: string
  playername: string
  totalxp: number
  currentlevel: number
  sandbox_runs: number
  createdat: string
  lastactive: string
  charactertype: string | null
  user_type: 'student' | 'professional' | null
}

type SortKey = 'xp' | 'level' | 'sandbox_runs' | 'recent'
type FilterKey = 'all' | 'student' | 'professional'

const PAGE_SIZE = 20

const SORT_OPTIONS: { key: SortKey; label: string; column: string; ascending: boolean }[] = [
  { key: 'xp',            label: 'Highest XP',        column: 'totalxp',      ascending: false },
  { key: 'level',         label: 'Highest Level',     column: 'currentlevel', ascending: false },
  { key: 'sandbox_runs',  label: 'Most Active',       column: 'sandbox_runs', ascending: false },
  { key: 'recent',        label: 'Recently Joined',   column: 'createdat',    ascending: false },
]

const FILTER_OPTIONS: { key: FilterKey; label: string; icon: string }[] = [
  { key: 'all',          label: 'Everyone',      icon: '🌐' },
  { key: 'student',      label: 'Students',      icon: '🎓' },
  { key: 'professional', label: 'Professionals', icon: '💼' },
]

// ─── Relative time helper ────────────────────────────────────────────────────
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
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  return mins < 30
}

// ─── Player Detail Modal ─────────────────────────────────────────────────────
const PlayerDetailModal: React.FC<{ player: Player; currentUserId?: string; onClose: () => void }> = ({ player, currentUserId, onClose }) => {
  const [questsCompleted, setQuestsCompleted] = useState<number | null>(null)

  useEffect(() => {
    const fetch = async () => {
      const { count } = await supabase
        .from('mission_progress').select('*', { count: 'exact', head: true })
        .eq('userid', player.id).eq('status', 'completed')
      setQuestsCompleted(count ?? 0)
    }
    fetch()
  }, [player.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const level = Math.min(Math.max(player.currentlevel || 1, 1), 5) as 1|2|3|4|5
  const progress = getLevelProgress(player.totalxp)
  const xpToNext = getXPToNextLevel(player.totalxp)
  const isMe = currentUserId === player.id

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(6px)',
        zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px', animation: 'lbFadeIn 0.2s ease',
      }}
    >
      <style>{`
        @keyframes lbFadeIn  { from{opacity:0} to{opacity:1} }
        @keyframes lbSlideUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
      `}</style>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'linear-gradient(160deg, #161b22 0%, #0d1117 100%)',
          border: '1px solid #30363d', borderRadius: '18px',
          width: '100%', maxWidth: '440px', padding: '28px',
          boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
          animation: 'lbSlideUp 0.25s ease-out',
          fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        }}
      >
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
              {getLevelName(level)} · Joined {new Date(player.createdat).toLocaleDateString([], { month: 'short', year: 'numeric' })}
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
      </div>
    </div>
  )
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
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Override overflow:hidden from layout.css
  useEffect(() => {
    const els = [document.documentElement, document.body, document.getElementById('root')]
    els.forEach(el => { if (el) el.style.overflow = 'auto' })
    return () => { els.forEach(el => { if (el) el.style.overflow = '' }) }
  }, [])

  useEffect(() => {
    fetchPlayers()
  }, [page, searchQuery, sortKey, filterKey])

  useEffect(() => {
    if (!user) return
    const fetchMyRank = async () => {
      const { data: me } = await supabase
        .from('users').select('id, playername, totalxp, currentlevel, sandbox_runs, createdat, lastactive, charactertype, user_type')
        .eq('id', user.id).single()
      if (me) {
        setMyPlayer(me as Player)
        const { count } = await supabase
          .from('users').select('*', { count: 'exact', head: true })
          .eq('isactive', true).gt('totalxp', me.totalxp)
        setMyRank((count ?? 0) + 1)
      }
    }
    fetchMyRank()
    fetchStatsSummary()

    const channel = supabase.channel('lb-page-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
        fetchPlayers(); fetchMyRank(); fetchStatsSummary()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user?.id])

  const fetchStatsSummary = async () => {
    const { data } = await supabase.from('users').select('totalxp, lastactive').eq('isactive', true)
    if (!data) return
    const totalPlayers = data.length
    const avgXP = totalPlayers === 0 ? 0 : Math.round(data.reduce((s, p) => s + (p.totalxp ?? 0), 0) / totalPlayers)
    const topXP = data.reduce((m, p) => Math.max(m, p.totalxp ?? 0), 0)
    const dayAgo = Date.now() - 86400_000
    const activeToday = data.filter(p => p.lastactive && new Date(p.lastactive).getTime() >= dayAgo).length
    setStatsSummary({ totalPlayers, avgXP, topXP, activeToday })
  }

  const fetchPlayers = async () => {
    setLoading(true)
    try {
      const sortCfg = SORT_OPTIONS.find(s => s.key === sortKey) ?? SORT_OPTIONS[0]
      let query = supabase
        .from('users')
        .select('id, playername, totalxp, currentlevel, sandbox_runs, createdat, lastactive, charactertype, user_type', { count: 'exact' })
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
      setPlayers((data ?? []) as Player[])
      setTotal(count ?? 0)
    } catch (e) {
      console.error('Leaderboard fetch error:', e)
    } finally {
      setLoading(false)
    }
  }

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
    const txt = `🏆 CodeSense Leaderboard\nRank #${myRank} · ${myPlayer.playername}\n⭐ ${myPlayer.totalxp} XP · ${getLevelName(myPlayer.currentlevel as 1|2|3|4|5)} · 🔬 ${myPlayer.sandbox_runs} analyses`
    navigator.clipboard?.writeText(txt).then(() => {
      setShareMsg('Copied to clipboard!')
      setTimeout(() => setShareMsg(''), 2500)
    })
  }

  // Memo: show podium only for XP-sort, first page, no search
  const showPodium = !searchQuery && page === 0 && sortKey === 'xp' && filterKey === 'all' && players.length >= 3

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
      {/* Header */}
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '16px 32px', background: 'rgba(22,27,34,0.95)',
        borderBottom: '1px solid #21262d', position: 'sticky', top: 0, zIndex: 100,
        backdropFilter: 'blur(8px)'
      }}>
        <button onClick={() => navigate('/home')} style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '14px' }}>
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

      <div style={{ maxWidth: '960px', margin: '0 auto', padding: '28px 24px', boxSizing: 'border-box' as const }}>

        {/* ── Stats summary strip ── */}
        <div style={{
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
                {getLevelName(myPlayer.currentlevel as 1|2|3|4|5)} · {myPlayer.totalxp.toLocaleString()} XP · {myPlayer.sandbox_runs} sandbox runs
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
          <div style={{
            display: 'grid', gridTemplateColumns: '52px 1fr 110px 110px 90px 110px',
            padding: '10px 20px', borderBottom: '1px solid #21262d',
            background: 'rgba(255,255,255,0.02)'
          }}>
            {['RANK', 'PLAYER', 'LEVEL', 'XP', 'RUNS', 'LAST ACTIVE'].map(h => (
              <div key={h} style={{ color: '#484f58', fontSize: '10px', fontWeight: '700', letterSpacing: '1.2px' }}>{h}</div>
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
                <div key={player.id} onClick={() => setDetailPlayer(player)} style={{
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
                      <div style={{ color: isMe ? '#4caf50' : '#e6edf3', fontSize: '13px', fontWeight: isMe ? '700' : '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {player.playername}
                        {isMe && <span style={{ fontSize: '10px', color: '#4caf50', marginLeft: '6px', opacity: 0.8 }}>(you)</span>}
                        {player.user_type === 'professional' && <span style={{ fontSize: '9px', marginLeft: '6px', opacity: 0.7 }}>💼</span>}
                      </div>
                      <div style={{ color: '#484f58', fontSize: '11px' }}>
                        Joined {new Date(player.createdat).toLocaleDateString([], { month: 'short', year: 'numeric' })}
                      </div>
                    </div>
                  </div>

                  {/* Level */}
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ color: '#64b5f6', fontSize: '12px', fontWeight: '600' }}>
                      {getLevelName(player.currentlevel as 1|2|3|4|5)}
                    </span>
                  </div>

                  {/* XP */}
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ color: '#ffc107', fontSize: '13px', fontWeight: '700' }}>{player.totalxp.toLocaleString()}</span>
                    <span style={{ color: '#484f58', fontSize: '10px', marginLeft: '3px' }}>XP</span>
                  </div>

                  {/* Sandbox runs */}
                  <div style={{ display: 'flex', alignItems: 'center' }}>
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
      </div>

      {detailPlayer && (
        <PlayerDetailModal
          player={detailPlayer}
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
