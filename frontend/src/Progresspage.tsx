// src/ProgressPage.tsx
import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './components/AuthScreen';
import { supabase } from './services/supabase';
import { getLevelProgress, getXPToNextLevel, getLevelName, XP_LEVELS } from './types'

// ── Types ────────────────────────────────────────────────────────────────────

interface Report {
  id: string
  type: string
  sourcecode: string
  mode_context: 'sandbox' | 'campaign'
  cognitive_complexity: number
  createdat: string
}

interface MissionProgress {
  id: string
  status: string
  attempts: number
  hintsused: number
  completedat: string
  questid: {
    title: string
    phase: string
    basexp: number
  } | null
}

interface FullStats {
  totalXP: number
  currentLevel: number
  sandboxRuns: number
  questsCompleted: number
  levelProgress: number
  xpToNextLevel: number | null
  reports: Report[]
  missions: MissionProgress[]
  leaderboardRank: number | null
}

// ── Animated counter (counts up on mount) ────────────────────────────────────

const AnimatedNumber: React.FC<{ value: number | string; suffix?: string }> = ({ value, suffix = '' }) => {
  const [display, setDisplay] = useState(0)
  const numeric = typeof value === 'number' ? value : parseInt(String(value).replace(/[^\d]/g, '')) || 0
  const isNumeric = typeof value === 'number' || /^\d/.test(String(value))

  useEffect(() => {
    if (!isNumeric) return
    const duration = 700, start = performance.now()
    let frame: number
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      // easeOut for smoother finish
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(numeric * eased))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [numeric, isNumeric])

  if (!isNumeric) return <>{value}</>
  return <>{display.toLocaleString()}{suffix}</>
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getWeeklyDistribution(dates: string[]) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const counts = [0, 0, 0, 0, 0, 0, 0]
  const now = new Date()
  const startOfWeek = new Date(now)
  startOfWeek.setHours(0, 0, 0, 0)
  startOfWeek.setDate(now.getDate() - now.getDay())
  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 7)

  dates.forEach(dateStr => {
    if (!dateStr) return
    const d = new Date(dateStr)
    if (d >= startOfWeek && d < endOfWeek) {
      counts[d.getDay()]++
    }
  })
  return { counts: days.map((name, i) => ({ name, count: counts[i] })), startOfWeek }
}

function getPastWeeklyActivity(reports: Report[], missions: MissionProgress[]) {
  const now = new Date()
  const startOfThisWeek = new Date(now)
  startOfThisWeek.setHours(0, 0, 0, 0)
  startOfThisWeek.setDate(now.getDate() - now.getDay())

  const allEntries = [
    ...reports.map(r => ({
      date: r.createdat, type: 'Sandbox Run',
      mode: r.mode_context ?? 'sandbox', detail: '',
      complexity: r.cognitive_complexity ?? 'N/A'
    })),
    ...missions
      .filter(m => m.status === 'completed' && m.completedat)
      .map(m => ({
        date: m.completedat, type: 'Quest Completed',
        mode: 'campaign', detail: m.questid?.title ?? 'Unknown Quest',
        complexity: 'N/A'
      }))
  ]

  return allEntries
    .filter(a => new Date(a.date) < startOfThisWeek)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

function buildHeatmapData(dates: string[]) {
  const map: Record<string, { count: number; times: string[] }> = {}
  dates.forEach(dateStr => {
    if (!dateStr) return
    const key = dateStr.slice(0, 10)
    if (!map[key]) map[key] = { count: 0, times: [] }
    map[key].count++
    const t = new Date(dateStr)
    map[key].times.push(t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
  })
  const cells: { date: string; count: number; times: string[]; col: number; rowIndex: number }[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - start.getDay() - 7 * 52)
  const targetDays = [0, 1, 2, 3, 4, 5, 6]
  let prevWeek = -1
  let col = 0
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const week = Math.floor((d.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000))
    if (week !== prevWeek) { col = week; prevWeek = week }
    if (targetDays.includes(d.getDay())) {
      const key = d.toISOString().slice(0, 10)
      const entry = map[key]
      cells.push({ date: key, count: entry?.count ?? 0, times: entry?.times ?? [], col, rowIndex: targetDays.indexOf(d.getDay()) })
    }
  }
  return cells
}

function getMonthLabels() {
  const labels: { label: string; col: number }[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - start.getDay() - 7 * 52)
  for (let w = 0; w < 52; w++) {
    const d = new Date(start)
    d.setDate(d.getDate() + w * 7)
    if (d.getDate() <= 7) {
      labels.push({ label: d.toLocaleString('default', { month: 'short' }), col: w })
    }
  }
  return labels
}

/** Compute current streak (days ending today with activity) + longest streak ever. */
function computeStreaks(dates: string[]): { current: number; longest: number } {
  if (dates.length === 0) return { current: 0, longest: 0 }
  const daysSet = new Set(dates.map(d => d.slice(0, 10)))
  const allDays = Array.from(daysSet).sort()

  let current = 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const cursor = new Date(today)
  while (daysSet.has(cursor.toISOString().slice(0, 10))) {
    current++
    cursor.setDate(cursor.getDate() - 1)
  }
  // Allow a one-day gap if today itself has nothing (count from yesterday)
  if (current === 0) {
    cursor.setDate(cursor.getDate() - 1)
    while (daysSet.has(cursor.toISOString().slice(0, 10))) {
      current++
      cursor.setDate(cursor.getDate() - 1)
    }
  }

  let longest = 0, run = 1
  for (let i = 1; i < allDays.length; i++) {
    const prev = new Date(allDays[i - 1])
    const curr = new Date(allDays[i])
    const diff = (curr.getTime() - prev.getTime()) / 86_400_000
    if (diff === 1) run++
    else { longest = Math.max(longest, run); run = 1 }
  }
  longest = Math.max(longest, run)
  return { current, longest }
}

/** Break activity into hour buckets to reveal the user's most active time. */
function favouriteTimeSlot(dates: string[]): { label: string; hours: [number, number] } {
  const buckets = [
    { label: 'Morning (6–12)',  range: [6, 12]  as [number, number], count: 0 },
    { label: 'Afternoon (12–18)', range: [12, 18] as [number, number], count: 0 },
    { label: 'Evening (18–24)', range: [18, 24] as [number, number], count: 0 },
    { label: 'Late Night (0–6)', range: [0, 6]   as [number, number], count: 0 },
  ]
  dates.forEach(d => {
    if (!d) return
    const h = new Date(d).getHours()
    const b = buckets.find(x => h >= x.range[0] && h < x.range[1])
    if (b) b.count++
  })
  const top = buckets.reduce((m, b) => b.count > m.count ? b : m, buckets[0])
  return { label: top.count === 0 ? '—' : top.label, hours: top.range }
}

/** Best day of week (most activity across all time). */
function favouriteWeekday(dates: string[]): string {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const counts = [0,0,0,0,0,0,0]
  dates.forEach(d => { if (d) counts[new Date(d).getDay()]++ })
  const max = Math.max(...counts)
  if (max === 0) return '—'
  return days[counts.indexOf(max)]
}

// ── Main Component ───────────────────────────────────────────────────────────

export const ProgressPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [stats, setStats] = useState<FullStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'analyses' | 'campaign' | 'badges'>('overview')
  const [tooltip, setTooltip] = useState<{ cell: { date: string; count: number; times: string[] }; x: number; y: number } | null>(null)
  const [campaignFilter, setCampaignFilter] = useState<'all' | 'beginner' | 'intermediate' | 'advanced'>('all')
  const [campaignSearch, setCampaignSearch] = useState('')
  const [shareMsg, setShareMsg] = useState('')

  useEffect(() => {
    const els = [document.documentElement, document.body, document.getElementById('root')]
    els.forEach(el => { if (el) el.style.overflow = 'auto' })
    return () => { els.forEach(el => { if (el) el.style.overflow = '' }) }
  }, [])

  const allActivityDates = useMemo(() => {
    const reportDates = (stats?.reports ?? []).map(r => r.createdat)
    const missionDates = (stats?.missions ?? [])
      .filter(m => m.status === 'completed' && m.completedat)
      .map(m => m.completedat)
    return [...reportDates, ...missionDates]
  }, [stats?.reports, stats?.missions])

  const { counts: weeklyData, startOfWeek } = useMemo(
    () => getWeeklyDistribution(allActivityDates),
    [allActivityDates]
  )
  const pastActivity = useMemo(
    () => stats ? getPastWeeklyActivity(stats.reports, stats.missions) : [],
    [stats?.reports, stats?.missions]
  )
  const heatmapCells = useMemo(() => buildHeatmapData(allActivityDates), [allActivityDates])
  const monthLabels = useMemo(() => getMonthLabels(), [])
  const streaks = useMemo(() => computeStreaks(allActivityDates), [allActivityDates])
  const favTime = useMemo(() => favouriteTimeSlot(allActivityDates), [allActivityDates])
  const favDay = useMemo(() => favouriteWeekday(allActivityDates), [allActivityDates])

  // Complexity trend (last 10 sandbox runs, reversed so oldest is left)
  const complexityTrend = useMemo(() => {
    if (!stats?.reports) return [] as { idx: number; value: number }[]
    return stats.reports
      .filter(r => r.cognitive_complexity != null)
      .slice(0, 10)
      .reverse()
      .map((r, i) => ({ idx: i, value: r.cognitive_complexity }))
  }, [stats?.reports])

  const avgComplexity = useMemo(() => {
    const nums = (stats?.reports ?? [])
      .map(r => r.cognitive_complexity)
      .filter((n): n is number => typeof n === 'number' && !isNaN(n))
    if (nums.length === 0) return null
    return Math.round((nums.reduce((s, x) => s + x, 0) / nums.length) * 10) / 10
  }, [stats?.reports])

  const fetchAll = async (isRefresh = false) => {
    if (!user) return
    if (isRefresh) setRefreshing(true)
    try {
      const { data: profile } = await supabase
        .from('users').select('totalxp, currentlevel, sandbox_runs')
        .eq('id', user.id).single()

      const { data: reports } = await supabase
        .from('reports')
        .select('id, type, sourcecode, mode_context, cognitive_complexity, createdat')
        .eq('userid', user.id).order('createdat', { ascending: false })

      const { data: missions } = await supabase
        .from('mission_progress')
        .select('id, status, attempts, hintsused, completedat, questid(title, phase, basexp)')
        .eq('userid', user.id).order('completedat', { ascending: false })

      // Compute leaderboard rank by counting users with more XP
      const { count: higherRanks } = await supabase
        .from('users').select('*', { count: 'exact', head: true })
        .eq('isactive', true).gt('totalxp', profile?.totalxp ?? 0)

      const { data: avatarData } = await supabase.storage.from('Avatars')
        .list(user.id, { limit: 1 })
      if (avatarData && avatarData.length > 0) {
        const { data: urlData } = supabase.storage.from('Avatars')
          .getPublicUrl(`${user.id}/${avatarData[0].name}`)
        setAvatarUrl(urlData.publicUrl)
      }

      const { count: questsCompleted } = await supabase
        .from('mission_progress').select('*', { count: 'exact', head: true })
        .eq('userid', user.id).eq('status', 'completed')

      const totalXP = profile?.totalxp ?? 0
      setStats({
        totalXP,
        currentLevel: profile?.currentlevel ?? 1,
        sandboxRuns: profile?.sandbox_runs ?? 0,
        questsCompleted: questsCompleted ?? 0,
        levelProgress: getLevelProgress(totalXP),
        xpToNextLevel: getXPToNextLevel(totalXP),
        reports: (reports ?? []) as Report[],
        missions: (missions ?? []) as unknown as MissionProgress[],
        leaderboardRank: (higherRanks ?? 0) + 1
      })
    } catch (error) {
      console.error('Failed to fetch progress:', error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (!user) { navigate('/login'); return }
    fetchAll()
  }, [user?.id])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b949e' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 34, marginBottom: 10, animation: 'pulse 1.5s ease infinite' }}>📊</div>
          Loading your progress…
        </div>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
      </div>
    )
  }
  if (!stats) return null

  const levelName = getLevelName((stats.currentLevel as 1|2|3|4|5))
  const maxCount = Math.max(...weeklyData.map(d => d.count), 1)

  const heatColor = (count: number) => {
    if (count === 0) return 'rgba(255,255,255,0.06)'
    if (count === 1) return '#1a4d1a'
    if (count === 2) return '#2d7a2d'
    if (count === 3) return '#3da63d'
    return '#4caf50'
  }

  const shareProgress = () => {
    const txt = [
      `📊 My CodeSense progress`,
      `🎖 ${levelName} · ⭐ ${stats.totalXP.toLocaleString()} XP · #${stats.leaderboardRank ?? '?'} ranked`,
      `🔬 ${stats.sandboxRuns} analyses · ⚔️ ${stats.questsCompleted} quests done`,
      `🔥 ${streaks.current}-day streak (best: ${streaks.longest})`,
      avgComplexity != null ? `📈 Avg cognitive complexity: ${avgComplexity}` : '',
    ].filter(Boolean).join('\n')
    navigator.clipboard?.writeText(txt).then(() => {
      setShareMsg('Copied to clipboard!')
      setTimeout(() => setShareMsg(''), 2500)
    })
  }

  // ── Campaign tab filtering ────────────────────────────────────────────────
  const filteredMissions = stats.missions.filter(m => {
    if (campaignFilter !== 'all' && m.questid?.phase !== campaignFilter) return false
    if (campaignSearch.trim()) {
      const q = campaignSearch.toLowerCase()
      return m.questid?.title?.toLowerCase().includes(q) ?? false
    }
    return true
  })

  // Phase progress rings (completed vs attempted per phase)
  const phaseProgress = (['beginner','intermediate','advanced'] as const).map(phase => {
    const total = stats.missions.filter(m => m.questid?.phase === phase).length
    const done = stats.missions.filter(m => m.questid?.phase === phase && m.status === 'completed').length
    return { phase, done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) }
  })

  const avgHintsUsed = (() => {
    const completed = stats.missions.filter(m => m.status === 'completed')
    if (completed.length === 0) return null
    return (completed.reduce((s, m) => s + (m.hintsused ?? 0), 0) / completed.length).toFixed(1)
  })()

  return (
    <div style={{
      minHeight: '100vh', width: '100%',
      background: 'linear-gradient(135deg, #0d1117 0%, #1a1f2e 100%)',
      color: 'white', fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
      boxSizing: 'border-box' as const
    }}>
      {/* ── Header ── */}
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '16px 20px', background: 'rgba(22, 27, 34, 0.95)',
        borderBottom: '1px solid #30363d', width: '100%', boxSizing: 'border-box' as const,
        position: 'sticky', top: 0, zIndex: 10, backdropFilter: 'blur(8px)',
      }}>
        <button onClick={() => navigate('/home')}
          style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 14 }}>
          ← Back to Dashboard
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>📊</span>
          <h1 style={{ color: 'white', margin: 0, fontSize: 20, fontWeight: 600 }}>Progress Report</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={shareProgress}
            style={{
              background: 'rgba(76,175,80,0.12)', border: '1px solid rgba(76,175,80,0.3)',
              color: '#4caf50', padding: '6px 12px', borderRadius: 6,
              fontSize: 12, cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(76,175,80,0.2)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(76,175,80,0.12)' }}
          >
            {shareMsg || '📋 Share Progress'}
          </button>
          <button onClick={() => fetchAll(true)} disabled={refreshing}
            style={{
              background: 'transparent', border: '1px solid #30363d',
              color: refreshing ? '#484f58' : '#8b949e',
              cursor: refreshing ? 'not-allowed' : 'pointer',
              fontSize: 12, padding: '6px 12px', borderRadius: 6,
            }}>
            {refreshing ? '⟳ Refreshing…' : '⟳ Refresh'}
          </button>
          {avatarUrl
            ? <img src={avatarUrl} alt="avatar" style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', border: '2px solid #30363d' }} />
            : <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#4caf50,#2d7a2d)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: 'white', border: '2px solid #30363d' }}>
                {user?.playerName?.charAt(0).toUpperCase()}
              </div>
          }
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px', boxSizing: 'border-box', width: '100%' }}>

        {/* ── Top Stats Row ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 24 }}>
          {[
            { label: 'RANK',        value: levelName.toUpperCase(), color: '#64b5f6', icon: '🎖️', raw: levelName },
            { label: 'TOTAL XP',    value: stats.totalXP,           color: '#ffc107', icon: '⭐', raw: stats.totalXP },
            { label: 'ANALYSES',    value: stats.sandboxRuns,       color: '#4caf50', icon: '🔬', raw: stats.sandboxRuns },
            { label: 'QUESTS DONE', value: stats.questsCompleted,   color: '#ffa726', icon: '⚔️', raw: stats.questsCompleted },
            { label: 'LEADERBOARD', value: stats.leaderboardRank ? `#${stats.leaderboardRank}` : 'N/A', color: '#a855f7', icon: '🏆', raw: stats.leaderboardRank ?? 0 },
          ].map(stat => (
            <div key={stat.label} style={{
              background: 'rgba(22, 27, 34, 0.9)', border: '1px solid #30363d',
              borderRadius: 12, padding: 18, textAlign: 'center',
              transition: 'transform 0.15s, border-color 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.borderColor = `${stat.color}55` }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = '#30363d' }}
            >
              <div style={{ fontSize: 22, marginBottom: 6 }}>{stat.icon}</div>
              <div style={{ color: stat.color, fontSize: 20, fontWeight: 800, marginBottom: 2 }}>
                <AnimatedNumber value={stat.value} />
              </div>
              <div style={{ color: '#8b949e', fontSize: 10, letterSpacing: 0.5 }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* ── Key Insights ── */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 14, marginBottom: 28,
        }}>
          {[
            {
              icon: '🔥', label: 'Current Streak', color: '#ff6b35',
              value: `${streaks.current} day${streaks.current !== 1 ? 's' : ''}`,
              sub: streaks.current === 0 ? 'Start today to begin a streak' : `Longest: ${streaks.longest} day${streaks.longest !== 1 ? 's' : ''}`,
            },
            {
              icon: '📈', label: 'Avg Complexity', color: '#58a6ff',
              value: avgComplexity !== null ? String(avgComplexity) : '—',
              sub: avgComplexity === null ? 'No analyses yet'
                 : avgComplexity < 5  ? 'Low — keep it simple ✓'
                 : avgComplexity < 15 ? 'Moderate — readable'
                 : 'High — consider refactoring',
            },
            {
              icon: '📅', label: 'Best Day',       color: '#a371f7',
              value: favDay === '—' ? '—' : favDay,
              sub: favDay === '—' ? 'No pattern yet' : 'Most active weekday',
            },
            {
              icon: '⏰', label: 'Best Time',      color: '#4caf50',
              value: favTime.label === '—' ? '—' : favTime.label.split(' ')[0],
              sub: favTime.label === '—' ? 'No pattern yet' : favTime.label,
            },
          ].map(insight => (
            <div key={insight.label} style={{
              background: `linear-gradient(135deg, ${insight.color}12, rgba(22,27,34,0.9))`,
              border: `1px solid ${insight.color}33`,
              borderRadius: 12, padding: '14px 16px',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{ fontSize: 28 }}>{insight.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#484f58', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                  {insight.label}
                </div>
                <div style={{ color: insight.color, fontSize: 17, fontWeight: 800, margin: '2px 0' }}>
                  {insight.value}
                </div>
                <div style={{ color: '#8b949e', fontSize: 11 }}>{insight.sub}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── XP Progress Bar ── */}
        <div style={{
          background: 'rgba(22, 27, 34, 0.9)', border: '1px solid #30363d',
          borderRadius: 12, padding: 24, marginBottom: 28,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <div style={{ color: 'white', fontSize: 16, fontWeight: 600 }}>Level Progression</div>
              <div style={{ color: '#8b949e', fontSize: 12, marginTop: 2 }}>
                {stats.xpToNextLevel === null
                  ? 'You have reached the maximum rank — King 🔱'
                  : `${stats.xpToNextLevel.toLocaleString()} XP needed to reach the next rank`}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#ffc107', fontSize: 24, fontWeight: 700 }}>{stats.levelProgress}%</div>
              <div style={{ color: '#8b949e', fontSize: 11 }}>to next rank</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            {[1, 2, 3, 4, 5].map((lvl) => {
              const name = getLevelName(lvl as 1|2|3|4|5)
              const threshold = XP_LEVELS[lvl as 1|2|3|4|5].minXP
              const isReached = stats.totalXP >= threshold
              const isCurrent = stats.currentLevel === lvl
              const icon = lvl === 1 ? '🛡️' : lvl === 2 ? '⚔️' : lvl === 3 ? '🌟' : lvl === 4 ? '👑' : '🔱'
              return (
                <React.Fragment key={lvl}>
                  <div style={{
                    flex: 1, textAlign: 'center', padding: 8,
                    background: isReached ? 'rgba(76,175,80,0.15)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${isCurrent ? '#4caf50' : isReached ? '#4caf5066' : '#30363d'}`,
                    borderRadius: 8,
                    boxShadow: isCurrent ? '0 0 20px rgba(76,175,80,0.25)' : 'none',
                    transition: 'all 0.3s',
                  }}>
                    <div style={{ fontSize: 16 }}>{icon}</div>
                    <div style={{ color: isReached ? '#4caf50' : '#484f58', fontSize: 11, fontWeight: 700 }}>
                      {name}
                    </div>
                    <div style={{ color: '#484f58', fontSize: 10 }}>{threshold.toLocaleString()} XP</div>
                    {isCurrent && <div style={{ color: '#4caf50', fontSize: 9, marginTop: 2 }}>CURRENT</div>}
                  </div>
                  {lvl < 5 && <div style={{ color: '#30363d', fontSize: 16 }}>→</div>}
                </React.Fragment>
              )
            })}
          </div>

          <div style={{ background: 'rgba(100,181,246,0.1)', borderRadius: 6, height: 10, overflow: 'hidden' }}>
            <div style={{
              width: `${stats.levelProgress}%`, height: '100%',
              background: 'linear-gradient(90deg, #4caf50, #66bb6a, #ffc107)',
              transition: 'width 0.9s cubic-bezier(0.4,0,0.2,1)',
              boxShadow: '0 0 12px rgba(76,175,80,0.4)',
            }} />
          </div>
        </div>

        {/* ── Tabs ── */}
        <div style={{
          display: 'flex', gap: 4, marginBottom: 22,
          background: 'rgba(22,27,34,0.9)', border: '1px solid #30363d',
          borderRadius: 10, padding: 4, width: 'fit-content',
        }}>
          {([
            { id: 'overview',  label: '📋 Overview' },
            { id: 'analyses',  label: `🔬 Analyses (${stats.reports.length})` },
            { id: 'campaign',  label: `⚔️ Campaign (${stats.questsCompleted})` },
            { id: 'badges',    label: '🏅 Badges' },
          ] as const).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                padding: '8px 18px', borderRadius: 8, border: 'none',
                background: activeTab === tab.id ? 'rgba(100,181,246,0.2)' : 'transparent',
                color: activeTab === tab.id ? '#64b5f6' : '#8b949e',
                fontWeight: activeTab === tab.id ? 700 : 400,
                cursor: 'pointer', fontSize: 13, transition: 'all 0.15s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Overview Tab ── */}
        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Weekly Distribution + Complexity Trend (side by side) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 20 }}>

              {/* Weekly Distribution */}
              <div style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div>
                    <h3 style={{ ...cardHeaderStyle, marginBottom: 2 }}>Weekly Distribution</h3>
                    <span style={{ fontSize: 11, color: '#8b949e' }}>
                      Week of {startOfWeek.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  {pastActivity.length > 0 && (
                    <button
                      onClick={() => {
                        const header = 'Date,Time,Day,Type,Mode,Quest/Detail,Cognitive Complexity\n'
                        const rows = pastActivity.map(a => {
                          const d = new Date(a.date)
                          const date = d.toLocaleDateString('en-PH', { year: 'numeric', month: '2-digit', day: '2-digit' })
                          const time = d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                          const day = d.toLocaleDateString('en-PH', { weekday: 'long' })
                          return `"${date}","${time}","${day}","${a.type}","${a.mode}","${a.detail}","${a.complexity}"`
                        }).join('\n')
                        const blob = new Blob([header + rows], { type: 'text/csv' })
                        const url = URL.createObjectURL(blob)
                        const link = document.createElement('a')
                        link.href = url; link.download = 'codesense-activity-history.csv'; link.click()
                        URL.revokeObjectURL(url)
                      }}
                      style={{
                        background: 'rgba(76,175,80,0.1)', border: '1px solid rgba(76,175,80,0.4)',
                        color: '#4caf50', cursor: 'pointer', fontSize: 11,
                        padding: '6px 12px', borderRadius: 6, whiteSpace: 'nowrap',
                      }}
                    >
                      ⬇ CSV ({pastActivity.length})
                    </button>
                  )}
                </div>
                <div style={{ width: '100%', overflowX: 'auto' }}>
                  <svg width="100%" viewBox="0 0 480 160" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
                    {(() => {
                      const step = maxCount <= 5 ? 1 : maxCount <= 10 ? 2 : Math.ceil(maxCount / 5)
                      const ticks = Array.from({ length: Math.floor(maxCount / step) + 1 }, (_, i) => i * step)
                      return ticks.map((val, i) => {
                        const y = 16 + (1 - val / maxCount) * 110
                        return (
                          <g key={i}>
                            <line x1={36} y1={y} x2={472} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
                            <text x={30} y={y + 4} textAnchor="end" fill="#8b949e" fontSize={9}>{val}</text>
                          </g>
                        )
                      })
                    })()}
                    {weeklyData.map((d, i) => {
                      const barW = 42, gap = 26
                      const x = 40 + i * (barW + gap)
                      const barH = maxCount === 0 ? 0 : (d.count / maxCount) * 110
                      const y = 16 + 110 - barH
                      const isMax = d.count === maxCount && d.count > 0
                      return (
                        <g key={i}>
                          <rect x={x} y={y} width={barW} height={Math.max(barH, 0)} rx={4} fill={isMax ? '#4caf50' : d.count > 0 ? '#2d7a2d' : 'rgba(255,255,255,0.04)'}>
                            <animate attributeName="height" from="0" to={Math.max(barH, 0)} dur="0.6s" fill="freeze" />
                            <animate attributeName="y" from="126" to={y} dur="0.6s" fill="freeze" />
                          </rect>
                          {d.count > 0 && <text x={x + barW / 2} y={y - 4} textAnchor="middle" fill="#8b949e" fontSize={9}>{d.count}</text>}
                          <text x={x + barW / 2} y={142} textAnchor="middle" fill="#8b949e" fontSize={11}>{d.name}</text>
                        </g>
                      )
                    })}
                    <line x1={36} y1={126} x2={472} y2={126} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
                  </svg>
                </div>
              </div>

              {/* Complexity Trend Line */}
              <div style={cardStyle}>
                <h3 style={{ ...cardHeaderStyle, marginBottom: 2 }}>Cognitive Complexity Trend</h3>
                <span style={{ fontSize: 11, color: '#8b949e' }}>Last {complexityTrend.length} sandbox analyses (oldest → newest)</span>
                <div style={{ marginTop: 12 }}>
                  {complexityTrend.length === 0 ? (
                    <div style={{ ...emptyStyle, padding: '40px 0' }}>No analyses yet — run one in the Sandbox.</div>
                  ) : (
                    <svg width="100%" viewBox="0 0 480 160" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
                      {(() => {
                        const maxVal = Math.max(...complexityTrend.map(p => p.value), 5)
                        const points = complexityTrend.map((p, i) => {
                          const x = 36 + (i / Math.max(complexityTrend.length - 1, 1)) * (440 - 36)
                          const y = 16 + (1 - p.value / maxVal) * 110
                          return { x, y, value: p.value }
                        })
                        const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
                        const areaD = `${pathD} L ${points[points.length - 1]?.x ?? 0} 126 L ${points[0]?.x ?? 0} 126 Z`
                        return (
                          <>
                            {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
                              <g key={i}>
                                <line x1={36} y1={16 + t * 110} x2={440} y2={16 + t * 110} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
                                <text x={30} y={16 + t * 110 + 4} textAnchor="end" fill="#8b949e" fontSize={9}>
                                  {Math.round(maxVal * (1 - t))}
                                </text>
                              </g>
                            ))}
                            <path d={areaD} fill="url(#complexGrad)" opacity={0.25} />
                            <defs>
                              <linearGradient id="complexGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#64b5f6" />
                                <stop offset="100%" stopColor="#64b5f6" stopOpacity="0" />
                              </linearGradient>
                            </defs>
                            <path d={pathD} fill="none" stroke="#64b5f6" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                            {points.map((p, i) => (
                              <g key={i}>
                                <circle cx={p.x} cy={p.y} r={4} fill="#64b5f6" stroke="#0d1117" strokeWidth={2} />
                                {points.length <= 10 && (
                                  <text x={p.x} y={p.y - 10} textAnchor="middle" fill="#8b949e" fontSize={9}>{p.value}</text>
                                )}
                              </g>
                            ))}
                            <line x1={36} y1={126} x2={440} y2={126} stroke="rgba(255,255,255,0.1)" />
                          </>
                        )
                      })()}
                    </svg>
                  )}
                </div>
              </div>
            </div>

            {/* Activity Heatmap */}
            <div style={{ ...cardStyle, position: 'relative' }}>
              {tooltip && (
                <div style={{
                  position: 'fixed', left: tooltip.x + 12, top: tooltip.y - 10,
                  background: '#1c2128', border: '1px solid #30363d', borderRadius: 8,
                  padding: '10px 14px', zIndex: 9999, pointerEvents: 'none', minWidth: 160,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                }}>
                  <div style={{ color: 'white', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                    {new Date(tooltip.cell.date + 'T12:00:00').toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </div>
                  <div style={{ color: '#4caf50', fontSize: 11, marginBottom: tooltip.cell.times.length > 0 ? 8 : 0 }}>
                    {tooltip.cell.count === 0 ? 'No activity' : `${tooltip.cell.count} submission${tooltip.cell.count !== 1 ? 's' : ''}`}
                  </div>
                  {tooltip.cell.times.length > 0 && (
                    <div style={{ borderTop: '1px solid #30363d', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div style={{ color: '#8b949e', fontSize: 10, marginBottom: 2 }}>Times:</div>
                      {tooltip.cell.times.slice(0, 5).map((t, i) => (
                        <div key={i} style={{ color: '#e6edf3', fontSize: 11, fontFamily: 'monospace' }}>🕐 {t}</div>
                      ))}
                      {tooltip.cell.times.length > 5 && <div style={{ color: '#8b949e', fontSize: 10 }}>+{tooltip.cell.times.length - 5} more</div>}
                    </div>
                  )}
                </div>
              )}
              <h3 style={{ ...cardHeaderStyle, marginBottom: 12 }}>
                Activity Heatmap <span style={{ color: '#8b949e', fontSize: 12, fontWeight: 400 }}>· past 52 weeks</span>
              </h3>
              <div style={{ position: 'relative', height: 18, marginBottom: 4, marginLeft: 32, overflow: 'hidden' }}>
                {monthLabels.map(({ label, col }) => (
                  <span key={col} style={{ position: 'absolute', left: `${(col / 53) * 100}%`, fontSize: 10, color: '#8b949e', whiteSpace: 'nowrap' }}>{label}</span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingTop: 2, minWidth: 26 }}>
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                    <div key={d} style={{ fontSize: 10, color: '#8b949e', height: 11, lineHeight: '11px' }}>{d}</div>
                  ))}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(53, minmax(0, 1fr))', gridTemplateRows: 'repeat(7, 11px)', gap: 3, width: '100%' }}>
                    {heatmapCells.map((cell, i) => (
                      <div
                        key={i}
                        onMouseEnter={e => setTooltip({ cell, x: e.clientX, y: e.clientY })}
                        onMouseMove={e => setTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                        onMouseLeave={() => setTooltip(null)}
                        style={{
                          gridColumn: cell.col + 1, gridRow: cell.rowIndex + 1,
                          width: '100%', aspectRatio: '1', borderRadius: 2,
                          background: heatColor(cell.count), cursor: cell.count > 0 ? 'pointer' : 'default',
                          transition: 'transform 0.1s',
                        }}
                        onMouseOver={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.4)' }}
                        onMouseOut={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)' }}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 10, justifyContent: 'flex-end' }}>
                <span style={{ color: '#8b949e', fontSize: 10 }}>Less</span>
                {[0, 1, 2, 3, 4].map(n => <div key={n} style={{ width: 11, height: 11, borderRadius: 2, background: heatColor(n) }} />)}
                <span style={{ color: '#8b949e', fontSize: 10 }}>More</span>
              </div>
            </div>

            {/* Campaign Summary — phase progress rings */}
            <div style={cardStyle}>
              <h3 style={cardHeaderStyle}>Campaign Summary</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                {phaseProgress.map(({ phase, done, total, pct }) => {
                  const color = phase === 'beginner' ? '#4caf50' : phase === 'intermediate' ? '#ffa726' : '#f44336'
                  return (
                    <div key={phase} style={{
                      background: `${color}10`, border: `1px solid ${color}44`,
                      borderRadius: 10, padding: 16, textAlign: 'center',
                    }}>
                      <div style={{ position: 'relative', width: 70, height: 70, margin: '0 auto 10px' }}>
                        <svg width={70} height={70} style={{ transform: 'rotate(-90deg)' }}>
                          <circle cx={35} cy={35} r={30} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={6} />
                          <circle cx={35} cy={35} r={30} fill="none" stroke={color} strokeWidth={6}
                            strokeDasharray={`${(pct / 100) * 2 * Math.PI * 30} ${2 * Math.PI * 30}`}
                            strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.8s ease' }} />
                        </svg>
                        <div style={{
                          position: 'absolute', inset: 0, display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                          color: color, fontSize: 16, fontWeight: 800,
                        }}>{pct}%</div>
                      </div>
                      <div style={{ color, fontSize: 18, fontWeight: 700 }}>{done}{total > 0 && <span style={{ color: '#484f58', fontSize: 14 }}> / {total}</span>}</div>
                      <div style={{ color: '#8b949e', fontSize: 11, textTransform: 'capitalize', marginTop: 4 }}>{phase} quests</div>
                    </div>
                  )
                })}
              </div>
              {avgHintsUsed !== null && (
                <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(88,166,255,0.05)', border: '1px solid rgba(88,166,255,0.2)', borderRadius: 8, fontSize: 12, color: '#c9d1d9' }}>
                  💡 Average hints used per completed quest: <b style={{ color: '#64b5f6' }}>{avgHintsUsed}</b>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Analyses Tab ── */}
        {activeTab === 'analyses' && (
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ ...cardHeaderStyle, marginBottom: 0 }}>Sandbox Analysis History</h3>
              <span style={{ color: '#8b949e', fontSize: 12 }}>{stats.reports.length} total</span>
            </div>
            {stats.reports.length === 0 ? (
              <div style={emptyStyle}>
                No sandbox analyses yet.<br />
                <button onClick={() => navigate('/sandbox')} style={{
                  marginTop: 14, background: 'rgba(76,175,80,0.12)', border: '1px solid rgba(76,175,80,0.3)',
                  color: '#4caf50', padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>Open Sandbox →</button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {stats.reports.slice(0, 25).map(r => {
                  const color = r.mode_context === 'campaign' ? '#ffa726' : '#4caf50'
                  const ccolor = r.cognitive_complexity == null ? '#484f58'
                               : r.cognitive_complexity < 5  ? '#4caf50'
                               : r.cognitive_complexity < 15 ? '#ffa726' : '#f85149'
                  return (
                    <div key={r.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', borderRadius: 8,
                      background: 'rgba(255,255,255,0.02)', border: '1px solid #21262d',
                      transition: 'all 0.15s',
                    }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = color + '55' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor = '#21262d' }}
                    >
                      <div style={{ width: 6, height: 36, background: color, borderRadius: 3, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: '#e6edf3', fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>
                          {r.mode_context} · {r.type}
                        </div>
                        <div style={{ color: '#484f58', fontSize: 11, marginTop: 2 }}>
                          {new Date(r.createdat).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      {r.cognitive_complexity != null && (
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ color: ccolor, fontSize: 15, fontWeight: 800 }}>{r.cognitive_complexity}</div>
                          <div style={{ color: '#484f58', fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase' }}>complexity</div>
                        </div>
                      )}
                    </div>
                  )
                })}
                {stats.reports.length > 25 && (
                  <div style={{ color: '#484f58', fontSize: 11, textAlign: 'center', padding: 10 }}>
                    Showing 25 of {stats.reports.length} — export CSV from the Overview tab for full history.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Campaign Tab ── */}
        {activeTab === 'campaign' && (
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
              <h3 style={{ ...cardHeaderStyle, marginBottom: 0 }}>Campaign Quest Log</h3>
              <input
                value={campaignSearch}
                onChange={e => setCampaignSearch(e.target.value)}
                placeholder="🔍 Search quests..."
                style={{
                  background: 'rgba(13,17,23,0.8)', border: '1px solid #30363d',
                  color: '#e6edf3', borderRadius: 8, padding: '6px 12px',
                  fontSize: 12, outline: 'none', minWidth: 180,
                }}
              />
            </div>

            {/* Phase filter chips */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
              {([
                { key: 'all',          label: 'All',          color: '#8b949e' },
                { key: 'beginner',     label: '🌱 Beginner',  color: '#4caf50' },
                { key: 'intermediate', label: '🔥 Intermediate', color: '#ffa726' },
                { key: 'advanced',     label: '💎 Advanced',  color: '#f44336' },
              ] as const).map(chip => {
                const active = campaignFilter === chip.key
                return (
                  <button
                    key={chip.key}
                    onClick={() => setCampaignFilter(chip.key)}
                    style={{
                      background: active ? `${chip.color}22` : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${active ? chip.color + '66' : '#30363d'}`,
                      color: active ? chip.color : '#8b949e',
                      padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                      cursor: 'pointer', letterSpacing: 0.3,
                    }}
                  >
                    {chip.label}
                  </button>
                )
              })}
            </div>

            {filteredMissions.length === 0 ? (
              <div style={emptyStyle}>
                {stats.missions.length === 0 ? 'No campaign quests started yet.' : 'No quests match those filters.'}
                {stats.missions.length === 0 && (
                  <div>
                    <button onClick={() => navigate('/campaign')} style={{
                      marginTop: 14, background: 'rgba(255,167,38,0.12)', border: '1px solid rgba(255,167,38,0.3)',
                      color: '#ffa726', padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>Open Campaign →</button>
                  </div>
                )}
              </div>
            ) : (
              filteredMissions.map(mission => {
                const phaseColor = mission.questid?.phase === 'beginner' ? '#4caf50'
                                  : mission.questid?.phase === 'intermediate' ? '#ffa726'
                                  : mission.questid?.phase === 'advanced' ? '#f44336' : '#8b949e'
                const statusColor = mission.status === 'completed' ? '#4caf50' : '#ffa726'
                return (
                  <div key={mission.id} style={{
                    background: 'rgba(255,255,255,0.02)', border: '1px solid #21262d',
                    borderLeft: `3px solid ${phaseColor}`, borderRadius: 8,
                    padding: 14, marginBottom: 10, transition: 'all 0.15s',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: 'white', fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                          {mission.questid?.title ?? 'Unknown Quest'}
                          {mission.questid?.basexp != null && (
                            <span style={{ marginLeft: 8, color: '#ffc107', fontSize: 11, fontWeight: 700 }}>
                              +{mission.questid.basexp} XP
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          <span style={{ color: '#8b949e', fontSize: 11 }}>
                            Phase: <span style={{ color: phaseColor, textTransform: 'capitalize' }}>{mission.questid?.phase ?? 'N/A'}</span>
                          </span>
                          <span style={{ color: '#8b949e', fontSize: 11 }}>
                            Attempts: <span style={{ color: 'white' }}>{mission.attempts}</span>
                          </span>
                          <span style={{ color: '#8b949e', fontSize: 11 }}>
                            Hints: <span style={{ color: mission.hintsused > 0 ? '#ff6b6b' : '#4caf50' }}>
                              {mission.hintsused === 0 ? '🎯 none' : mission.hintsused}
                            </span>
                          </span>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{
                          color: statusColor, fontSize: 11, fontWeight: 700,
                          background: statusColor + '20', padding: '3px 10px', borderRadius: 6,
                          textTransform: 'uppercase', letterSpacing: 0.5,
                        }}>
                          {mission.status}
                        </div>
                        {mission.completedat && (
                          <div style={{ color: '#484f58', fontSize: 10, marginTop: 4 }}>
                            {new Date(mission.completedat).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* ── Badges Tab ── */}
        {activeTab === 'badges' && (
          <div style={cardStyle}>
            <h3 style={cardHeaderStyle}>Badges Earned</h3>
            {(() => {
              // Badge definition now includes a `progress` function so we show
              // how close the user is to the locked ones.
              const allBadges = [
                { id: 'first_quest',       icon: '⚔️', name: 'First Quest',      desc: 'Complete your first campaign quest',  earned: stats.questsCompleted >= 1,       progress: () => Math.min(1, stats.questsCompleted) / 1, detail: `${Math.min(stats.questsCompleted, 1)}/1` },
                { id: 'beginner_clear',    icon: '🌱', name: 'Beginner Clear',   desc: 'Complete a beginner quest',           earned: stats.missions.filter(m => m.questid?.phase === 'beginner'    && m.status === 'completed').length >= 1, progress: () => Math.min(1, stats.missions.filter(m => m.questid?.phase === 'beginner'    && m.status === 'completed').length) / 1, detail: '' },
                { id: 'intermediate_clear',icon: '🔥', name: 'Intermediate Clear',desc: 'Complete an intermediate quest',     earned: stats.missions.filter(m => m.questid?.phase === 'intermediate' && m.status === 'completed').length >= 1, progress: () => Math.min(1, stats.missions.filter(m => m.questid?.phase === 'intermediate' && m.status === 'completed').length) / 1, detail: '' },
                { id: 'advanced_clear',    icon: '💎', name: 'Advanced Clear',   desc: 'Complete an advanced quest',          earned: stats.missions.filter(m => m.questid?.phase === 'advanced'    && m.status === 'completed').length >= 1, progress: () => Math.min(1, stats.missions.filter(m => m.questid?.phase === 'advanced'    && m.status === 'completed').length) / 1, detail: '' },
                { id: 'knight_rank',       icon: '⚔️', name: 'Knight',           desc: 'Reach Knight rank (1,000 XP)',         earned: stats.totalXP >= 1000,            progress: () => Math.min(1, stats.totalXP / 1000),    detail: `${stats.totalXP.toLocaleString()} / 1,000 XP` },
                { id: 'lord_rank',         icon: '🌟', name: 'Lord',             desc: 'Reach Lord rank (4,000 XP)',           earned: stats.totalXP >= 4000,            progress: () => Math.min(1, stats.totalXP / 4000),    detail: `${stats.totalXP.toLocaleString()} / 4,000 XP` },
                { id: 'duke_rank',         icon: '👑', name: 'Duke',             desc: 'Reach Duke rank (10,000 XP)',          earned: stats.totalXP >= 10000,           progress: () => Math.min(1, stats.totalXP / 10000),   detail: `${stats.totalXP.toLocaleString()} / 10,000 XP` },
                { id: 'king_rank',         icon: '🔱', name: 'King',             desc: 'Reach King rank (25,000 XP)',          earned: stats.totalXP >= 25000,           progress: () => Math.min(1, stats.totalXP / 25000),   detail: `${stats.totalXP.toLocaleString()} / 25,000 XP` },
                { id: 'no_hints',          icon: '🎯', name: 'Purist',           desc: 'Complete a quest without hints',       earned: stats.missions.some(m => m.status === 'completed' && m.hintsused === 0), progress: () => stats.missions.some(m => m.status === 'completed' && m.hintsused === 0) ? 1 : 0, detail: '' },
                { id: 'streak_3',          icon: '🔥', name: 'On A Roll',        desc: 'Practice 3 days in a row',             earned: streaks.longest >= 3,             progress: () => Math.min(1, streaks.longest / 3),     detail: `${streaks.longest} / 3 days` },
                { id: 'streak_7',          icon: '🏆', name: 'Week Warrior',     desc: 'Practice 7 days in a row',             earned: streaks.longest >= 7,             progress: () => Math.min(1, streaks.longest / 7),     detail: `${streaks.longest} / 7 days` },
                { id: 'analyse_50',        icon: '🔬', name: 'Lab Tech',         desc: 'Run 50 sandbox analyses',              earned: stats.sandboxRuns >= 50,          progress: () => Math.min(1, stats.sandboxRuns / 50),  detail: `${stats.sandboxRuns} / 50` },
              ]
              const earned = allBadges.filter(b => b.earned)
              const locked = allBadges.filter(b => !b.earned)
              const pct = Math.round((earned.length / allBadges.length) * 100)

              return (
                <>
                  {/* Overall progress bar */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ color: '#8b949e', fontSize: 12 }}>
                        <b style={{ color: '#4caf50' }}>{earned.length}</b> / {allBadges.length} badges earned
                      </span>
                      <span style={{ color: '#4caf50', fontSize: 12, fontWeight: 700 }}>{pct}%</span>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#4caf50,#ffc107)', transition: 'width 0.9s ease' }} />
                    </div>
                  </div>

                  {earned.length > 0 && (
                    <>
                      <div style={{ color: '#4caf50', fontSize: 12, fontWeight: 700, marginBottom: 12, letterSpacing: 0.5 }}>
                        ✅ EARNED ({earned.length})
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
                        {earned.map(b => (
                          <div key={b.id} style={{
                            background: 'rgba(76,175,80,0.08)', border: '1px solid rgba(76,175,80,0.4)',
                            borderRadius: 10, padding: 16, textAlign: 'center',
                            boxShadow: '0 0 12px rgba(76,175,80,0.15)',
                          }}>
                            <div style={{ fontSize: 28, marginBottom: 8 }}>{b.icon}</div>
                            <div style={{ color: 'white', fontSize: 13, fontWeight: 700 }}>{b.name}</div>
                            <div style={{ color: '#8b949e', fontSize: 11, marginTop: 4 }}>{b.desc}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {locked.length > 0 && (
                    <>
                      <div style={{ color: '#484f58', fontSize: 12, fontWeight: 700, marginBottom: 12, letterSpacing: 0.5 }}>
                        🔒 LOCKED ({locked.length})
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
                        {locked.map(b => {
                          const p = b.progress()
                          return (
                            <div key={b.id} style={{
                              background: 'rgba(255,255,255,0.02)', border: '1px solid #21262d',
                              borderRadius: 10, padding: 16, textAlign: 'center', opacity: 0.7,
                              position: 'relative', overflow: 'hidden',
                            }}>
                              <div style={{ fontSize: 28, marginBottom: 8, filter: 'grayscale(1)' }}>{b.icon}</div>
                              <div style={{ color: '#8b949e', fontSize: 13, fontWeight: 700 }}>{b.name}</div>
                              <div style={{ color: '#484f58', fontSize: 11, marginTop: 4 }}>{b.desc}</div>
                              {/* Progress toward unlock */}
                              <div style={{ marginTop: 10, background: 'rgba(255,255,255,0.04)', borderRadius: 3, height: 4, overflow: 'hidden' }}>
                                <div style={{
                                  width: `${Math.round(p * 100)}%`, height: '100%',
                                  background: p > 0.5 ? '#ffc107' : '#4caf50',
                                  transition: 'width 0.6s ease',
                                }} />
                              </div>
                              {b.detail && (
                                <div style={{ color: '#484f58', fontSize: 10, marginTop: 4 }}>{b.detail}</div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  );
};

const cardStyle = {
  background: 'rgba(22, 27, 34, 0.9)', border: '1px solid #30363d',
  borderRadius: 12, padding: 22,
}
const cardHeaderStyle = {
  color: 'white', fontSize: 15, fontWeight: 600,
  marginBottom: 14, marginTop: 0,
}
const emptyStyle = {
  color: '#484f58', fontSize: 13, textAlign: 'center' as const,
  padding: '32px 0', fontStyle: 'italic',
}
