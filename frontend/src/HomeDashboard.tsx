// src/HomeDashboard.tsx
import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './components/AuthScreen';
import { supabase } from './services/supabase';
import { getLevelProgress, getXPToNextLevel, getLevelName } from './types'

/* ── Global smooth interaction styles injected once ── */
const GLOBAL_STYLES = `
  * { box-sizing: border-box; }

  @keyframes fadeSlideDown {
    from { opacity: 0; transform: translateY(-8px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0)   scale(1);    }
  }
  @keyframes fadeSlideUp {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0);   }
  }
  @keyframes modalFadeIn {
    from { opacity: 0; transform: scale(0.95) translateY(12px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes overlayFadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.5; }
  }

  .cs-btn {
    position: relative; overflow: hidden;
    transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.2s ease, filter 0.15s ease;
    cursor: pointer;
  }
  .cs-btn:hover  { transform: translateY(-1px); }
  .cs-btn:active { transform: scale(0.97) translateY(0); }

  .cs-card {
    transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
    cursor: pointer;
  }
  .cs-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 16px 40px rgba(0,0,0,0.45);
  }
  .cs-card:active { transform: translateY(-1px) scale(0.99); }

  .cs-icon-btn {
    transition: color 0.15s ease, transform 0.15s ease, background 0.15s ease;
    border-radius: 8px;
  }
  .cs-icon-btn:hover  { color: #e6edf3 !important; transform: scale(1.12); background: rgba(255,255,255,0.07) !important; }
  .cs-icon-btn:active { transform: scale(0.92); }

  .cs-avatar-btn {
    transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.2s ease;
  }
  .cs-avatar-btn:hover  { transform: scale(1.08); box-shadow: 0 0 0 3px rgba(76,175,80,0.35) !important; }
  .cs-avatar-btn:active { transform: scale(0.94); }

  .cs-menu-item {
    transition: background 0.12s ease, padding-left 0.15s ease;
  }
  .cs-menu-item:hover { background: rgba(255,255,255,0.08) !important; padding-left: 22px !important; }
  .cs-menu-item:active { background: rgba(255,255,255,0.14) !important; }

  .cs-menu-danger {
    transition: background 0.12s ease, padding-left 0.15s ease;
  }
  .cs-menu-danger:hover { background: rgba(248,81,73,0.1) !important; padding-left: 22px !important; }
  .cs-menu-danger:active { background: rgba(248,81,73,0.18) !important; }

  .cs-leaderboard-row {
    transition: background 0.15s ease, transform 0.15s ease;
    border-radius: 8px;
    cursor: default;
  }
  .cs-leaderboard-row:hover {
    background: rgba(255,255,255,0.05) !important;
    transform: translateX(4px);
  }

  .cs-search-result-btn {
    transition: background 0.12s ease, padding-left 0.15s ease;
  }
  .cs-search-result-btn:hover { background: rgba(76,175,80,0.08) !important; padding-left: 22px !important; }
  .cs-search-result-btn:active { background: rgba(76,175,80,0.15) !important; }

  .cs-outline-btn {
    transition: background 0.18s ease, box-shadow 0.18s ease, transform 0.15s ease;
  }
  .cs-outline-btn:hover {
    background: rgba(100,181,246,0.1) !important;
    box-shadow: 0 0 0 3px rgba(100,181,246,0.15) !important;
    transform: translateY(-2px) !important;
  }
  .cs-outline-btn:active { transform: scale(0.98) !important; }

  .cs-gold-btn {
    transition: background 0.18s ease, box-shadow 0.18s ease, transform 0.15s ease;
  }
  .cs-gold-btn:hover {
    background: rgba(255,193,7,0.1) !important;
    box-shadow: 0 0 0 3px rgba(255,193,7,0.18) !important;
    transform: translateY(-2px) !important;
  }
  .cs-gold-btn:active { transform: scale(0.98) !important; }

  .cs-progress-btn {
    transition: background 0.18s ease, box-shadow 0.18s ease, transform 0.15s ease;
  }
  .cs-progress-btn:hover {
    background: rgba(76,175,80,0.1) !important;
    box-shadow: 0 0 0 3px rgba(76,175,80,0.18) !important;
    transform: translateY(-2px) !important;
  }
  .cs-progress-btn:active { transform: scale(0.98) !important; }

  .cs-signup-btn {
    transition: background 0.18s ease, transform 0.15s ease, box-shadow 0.18s ease;
  }
  .cs-signup-btn:hover {
    background: #43a047 !important;
    transform: translateY(-2px) !important;
    box-shadow: 0 8px 24px rgba(76,175,80,0.4) !important;
  }
  .cs-signup-btn:active { transform: scale(0.96) !important; }

  .cs-explore-btn:hover {
    filter: brightness(1.18) !important;
    box-shadow: 0 8px 24px rgba(76,175,80,0.45) !important;
  }

  .cs-learn-btn:hover {
    filter: brightness(1.18) !important;
    box-shadow: 0 8px 24px rgba(255,167,38,0.45) !important;
  }

  .cs-dropdown {
    animation: fadeSlideDown 0.2s cubic-bezier(0.16,1,0.3,1) forwards;
  }

  .cs-search-bar {
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }
  .cs-search-bar:focus-within {
    border-color: rgba(76,175,80,0.55) !important;
    box-shadow: 0 0 0 3px rgba(76,175,80,0.1) !important;
  }

  .cs-stat-box {
    transition: background 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
  }
  .cs-stat-box:hover {
    background: rgba(255,255,255,0.07) !important;
    transform: translateY(-3px) !important;
    box-shadow: 0 8px 20px rgba(0,0,0,0.3) !important;
  }

  .cs-announcement-card {
    transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
  }
  .cs-announcement-card:hover {
    background: rgba(255,255,255,0.04) !important;
    transform: translateX(3px);
  }

  .cs-modal-close:hover {
    background: rgba(255,255,255,0.12) !important;
    transform: scale(1.1);
  }
  .cs-modal-close { transition: background 0.15s ease, transform 0.15s ease; }
`

/* ── Announcement types ── */
interface Announcement {
  id: string
  title: string
  body: string
  createdat: string
  priority: 'info' | 'warning' | 'success' | 'critical'
  author: string
  ispinned: boolean
}

const PRIORITY_CONFIG: Record<Announcement['priority'], { color: string; bg: string; border: string; icon: string; label: string }> = {
  info:     { color: '#64b5f6', bg: 'rgba(100,181,246,0.08)', border: 'rgba(100,181,246,0.25)', icon: 'ℹ️',  label: 'Info'     },
  warning:  { color: '#ffa726', bg: 'rgba(255,167,38,0.08)',  border: 'rgba(255,167,38,0.25)',  icon: '⚠️',  label: 'Warning'  },
  success:  { color: '#4caf50', bg: 'rgba(76,175,80,0.08)',   border: 'rgba(76,175,80,0.25)',   icon: '✅',  label: 'Success'  },
  critical: { color: '#f85149', bg: 'rgba(248,81,73,0.08)',   border: 'rgba(248,81,73,0.25)',   icon: '🚨',  label: 'Critical' },
}

/* ── Announcements Modal ── */
const AnnouncementsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchAnnouncements = async () => {
      try {
        const { data, error: err } = await supabase
          .from('announcements')
          .select('*')
          .order('ispinned', { ascending: false })
          .order('createdat', { ascending: false })
        if (err) throw err
        setAnnouncements(data ?? [])
      } catch (e: any) {
        setError(e.message ?? 'Failed to load announcements')
      } finally {
        setLoading(false)
      }
    }
    fetchAnnouncements()
  }, [])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'overlayFadeIn 0.2s ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '560px', margin: '20px',
          background: '#0d1117',
          border: '1px solid #30363d',
          borderRadius: '20px',
          boxShadow: '0 32px 80px rgba(0,0,0,0.8)',
          overflow: 'hidden',
          animation: 'modalFadeIn 0.25s cubic-bezier(0.16,1,0.3,1)',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px',
          borderBottom: '1px solid #21262d',
          background: 'rgba(22,27,34,0.8)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: '10px',
              background: 'rgba(100,181,246,0.12)', border: '1px solid rgba(100,181,246,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px',
            }}>📢</div>
            <div>
              <div style={{ color: '#e6edf3', fontSize: '16px', fontWeight: '700' }}>System Announcements</div>
              <div style={{ color: '#8b949e', fontSize: '11px' }}>Latest updates from the CodeSense team</div>
            </div>
          </div>
          <button
            className="cs-modal-close"
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid #30363d',
              borderRadius: '8px', color: '#8b949e', fontSize: '14px',
              cursor: 'pointer', width: '32px', height: '32px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >✕</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 24px' }}>
          {loading && (
            <div style={{ padding: '40px 0', textAlign: 'center' }}>
              <div style={{ fontSize: '28px', marginBottom: '12px', animation: 'pulse 1.5s ease infinite' }}>📡</div>
              <div style={{ color: '#8b949e', fontSize: '13px' }}>Loading announcements...</div>
            </div>
          )}

          {!loading && error && (
            <div style={{ padding: '40px 0', textAlign: 'center' }}>
              <div style={{ fontSize: '28px', marginBottom: '12px' }}>⚠️</div>
              <div style={{ color: '#f85149', fontSize: '13px' }}>{error}</div>
            </div>
          )}

          {!loading && !error && announcements.length === 0 && (
            <div style={{ padding: '40px 0', textAlign: 'center' }}>
              <div style={{ fontSize: '36px', marginBottom: '12px' }}>📭</div>
              <div style={{ color: '#8b949e', fontSize: '14px', fontWeight: '600' }}>No announcements yet</div>
              <div style={{ color: '#484f58', fontSize: '12px', marginTop: '4px' }}>Check back later for updates!</div>
            </div>
          )}

          {!loading && !error && announcements.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {announcements.map((ann) => {
                const cfg = PRIORITY_CONFIG[ann.priority] ?? PRIORITY_CONFIG.info
                return (
                  <div
                    key={ann.id}
                    className="cs-announcement-card"
                    style={{
                      background: ann.ispinned ? cfg.bg : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${ann.ispinned ? cfg.border : '#21262d'}`,
                      borderRadius: '12px',
                      padding: '14px 16px',
                      position: 'relative',
                    }}
                  >
                    {/* Pinned indicator */}
                    {ann.ispinned && (
                      <div style={{
                        position: 'absolute', top: '10px', right: '12px',
                        fontSize: '11px', color: cfg.color,
                        background: cfg.bg, border: `1px solid ${cfg.border}`,
                        borderRadius: '6px', padding: '2px 8px', fontWeight: '700',
                        letterSpacing: '0.5px',
                      }}>📌 PINNED</div>
                    )}

                    {/* Priority badge + title */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', paddingRight: ann.ispinned ? '80px' : '0' }}>
                      <span style={{ fontSize: '15px' }}>{cfg.icon}</span>
                      <span style={{
                        fontSize: '10px', fontWeight: '700', letterSpacing: '1px',
                        textTransform: 'uppercase', color: cfg.color,
                        background: cfg.bg, border: `1px solid ${cfg.border}`,
                        borderRadius: '5px', padding: '2px 7px',
                      }}>{cfg.label}</span>
                      <span style={{ color: '#e6edf3', fontSize: '14px', fontWeight: '600' }}>{ann.title}</span>
                    </div>

                    {/* Body */}
                    <p style={{
                      color: '#8b949e', fontSize: '13px', lineHeight: '1.65',
                      margin: '0 0 10px 0', whiteSpace: 'pre-wrap',
                    }}>{ann.body}</p>

                    {/* Footer */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: '#484f58', fontSize: '11px' }}>
                        By <span style={{ color: '#8b949e', fontWeight: '600' }}>{ann.author}</span>
                      </span>
                      <span style={{ color: '#484f58', fontSize: '11px' }}>{formatDate(ann.createdat)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px',
          borderTop: '1px solid #21262d',
          background: 'rgba(13,17,23,0.8)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        }}>
          <span style={{ color: '#484f58', fontSize: '11px' }}>
            {announcements.length} announcement{announcements.length !== 1 ? 's' : ''}
          </span>
          <button
            className="cs-btn"
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid #30363d',
              borderRadius: '8px', color: '#8b949e', fontSize: '12px',
              cursor: 'pointer', padding: '7px 16px', fontWeight: '600',
            }}
          >Close</button>
        </div>
      </div>
    </div>
  )
}

interface DashboardStats {
  sandboxRuns: number
  questsCompleted: number
  xpToNextLevel: number | null
  levelProgress: number
}

export const HomeDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, isGuest, logout } = useAuth();

  const [stats, setStats] = useState<DashboardStats>({ sandboxRuns: 0, questsCompleted: 0, xpToNextLevel: null, levelProgress: 0 })
  const [statsLoading, setStatsLoading] = useState(true)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [leaderboard, setLeaderboard] = useState<{ id: string; playername: string; totalxp: number; currentlevel: number }[]>([])
  const [myRank, setMyRank] = useState<number | null>(null)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement>(null)

  // ── NEW: announcements modal state ──
  const [announcementsOpen, setAnnouncementsOpen] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchResults, setSearchResults] = useState<{
    actions: { label: string; icon: string; desc: string; path: string }[]
    players: { id: string; playername: string; totalxp: number; currentlevel: number }[]
    quests: { id: string; title: string; phase: string; difficulty: string; basexp: number }[]
    reports: { id: string; type: string; createdat: string; mode_context: string }[]
  }>({ actions: [], players: [], quests: [], reports: [] })
  const [searchLoading, setSearchLoading] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const id = 'cs-global-styles'
    if (!document.getElementById(id)) {
      const tag = document.createElement('style')
      tag.id = id; tag.textContent = GLOBAL_STYLES
      document.head.appendChild(tag)
    }
  }, [])

  useEffect(() => {
    if (!user) { setStatsLoading(false); return }
    fetchStats()
    const channel = supabase.channel('leaderboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => fetchLeaderboard())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user?.id])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) setProfileMenuOpen(false)
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults({ actions: [], players: [], quests: [], reports: [] }); setSearchOpen(false); return }
    setSearchOpen(true)
    const timer = setTimeout(() => runSearch(searchQuery.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery('') } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const QUICK_ACTIONS = [
    { label: 'Sandbox Mode',         icon: '🔬', desc: 'Experiment freely with code',      path: '/sandbox',  keywords: ['sandbox','experiment','code','run','free'] },
    { label: 'Campaign Mode',        icon: '⚔️', desc: 'Complete quests and earn XP',      path: '/campaign', keywords: ['campaign','quest','mission','learn','level'] },
    { label: 'Progress Report',      icon: '📊', desc: 'View your stats and activity',     path: '/progress', keywords: ['progress','report','stats','activity','xp','chart'] },
    { label: 'Profile Settings',     icon: '👤', desc: 'Edit your profile and avatar',     path: '/profile',  keywords: ['profile','avatar','settings','edit','account','image'] },
    { label: 'Leaderboard',          icon: '🏆', desc: 'See top players ranking',          path: '/progress', keywords: ['leaderboard','rank','ranking','top','players'] },
    { label: 'System Announcements', icon: '📢', desc: 'View latest updates and notices',  path: '',          keywords: ['announcement','announcements','news','update','notice','system'] },
  ]

  const runSearch = async (q: string) => {
    setSearchLoading(true)
    const ql = q.toLowerCase()
    try {
      const { data: players } = await supabase.from('users').select('id, playername, totalxp, currentlevel').ilike('playername', `%${q}%`).limit(5)
      const [t, ph, d] = await Promise.all([
        supabase.from('quests').select('id, title, phase, difficulty, basexp').ilike('title',       `%${q}%`).eq('isactive', true).limit(5),
        supabase.from('quests').select('id, title, phase, difficulty, basexp').ilike('phase',       `%${q}%`).eq('isactive', true).limit(5),
        supabase.from('quests').select('id, title, phase, difficulty, basexp').ilike('description', `%${q}%`).eq('isactive', true).limit(5),
      ])
      const questMap = new Map()
      ;[...(t.data ?? []), ...(ph.data ?? []), ...(d.data ?? [])].forEach((item: any) => questMap.set(item.id, item))
      let reportsData: any[] = []
      if (user) {
        const modeMatch = ['sandbox', 'campaign'].find(m => m.includes(ql) || ql.includes(m))
        const [byMode, byCode] = await Promise.all([
          modeMatch ? supabase.from('reports').select('id, type, createdat, mode_context').eq('userid', user.id).eq('mode_context', modeMatch).order('createdat', { ascending: false }).limit(5) : Promise.resolve({ data: [] }),
          supabase.from('reports').select('id, type, createdat, mode_context').eq('userid', user.id).ilike('sourcecode', `%${q}%`).order('createdat', { ascending: false }).limit(5),
        ])
        const rm = new Map()
        ;[...((byMode as any).data ?? []), ...((byCode as any).data ?? [])].forEach((r: any) => rm.set(r.id, r))
        reportsData = Array.from(rm.values()).slice(0, 5)
      }
      // Include announcements action if search matches
      const matchedActions = QUICK_ACTIONS.filter(a =>
        a.keywords.some(k => k.includes(ql) || ql.includes(k)) || a.label.toLowerCase().includes(ql)
      )
      setSearchResults({ actions: matchedActions, players: players ?? [], quests: Array.from(questMap.values()).slice(0, 5), reports: reportsData })
    } catch (e) { console.error('Search error:', e) }
    finally { setSearchLoading(false) }
  }

  const fetchLeaderboard = async () => {
    if (!user) return
    try {
      const { data: lb } = await supabase.from('users').select('id, playername, totalxp, currentlevel').eq('isactive', true).order('totalxp', { ascending: false }).limit(10)
      if (lb) {
        setLeaderboard(lb)
        const myPos = lb.findIndex(u => u.id === user.id)
        if (myPos !== -1) { setMyRank(myPos + 1) }
        else {
          const { count } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('isactive', true).gt('totalxp', user.totalXP ?? 0)
          setMyRank((count ?? 0) + 1)
        }
      }
    } catch (e) { console.error('Leaderboard fetch error:', e) }
  }

  const fetchStats = async () => {
    if (!user) return
    try {
      const { data: profile } = await supabase.from('users').select('totalxp, currentlevel, sandbox_runs').eq('id', user.id).single()
      const { count: questsCompleted } = await supabase.from('mission_progress').select('*', { count: 'exact', head: true }).eq('userid', user.id).eq('status', 'completed')
      if (profile) setStats({ sandboxRuns: profile.sandbox_runs ?? 0, questsCompleted: questsCompleted ?? 0, xpToNextLevel: getXPToNextLevel(profile.totalxp ?? 0), levelProgress: getLevelProgress(profile.totalxp ?? 0) })
      const { data: avatarFiles } = await supabase.storage.from('Avatars').list(user.id, { limit: 1 })
      if (avatarFiles && avatarFiles.length > 0) {
        const { data: urlData } = supabase.storage.from('Avatars').getPublicUrl(`${user.id}/${avatarFiles[0].name}`)
        setAvatarUrl(urlData.publicUrl + '?t=' + Date.now())
      }
      await fetchLeaderboard()
    } catch (error) { console.error('Failed to fetch stats:', error) }
    finally { setStatsLoading(false) }
  }

  const handleExit = async () => {
    if (isGuest) { sessionStorage.removeItem('guestMode'); navigate('/', { replace: true }) }
    else { logout(); await new Promise(r => setTimeout(r, 50)); navigate('/', { replace: true }) }
  }

  const currentLevelName = user ? getLevelName((user.currentLevel as 1 | 2 | 3 | 4) || 1) : 'Squire'

  // Handler for search action clicks — announcements open modal, others navigate
  const handleSearchActionClick = (action: Pick<typeof QUICK_ACTIONS[0], 'label' | 'path'>) => {
    setSearchOpen(false)
    setSearchQuery('')
    if (action.label === 'System Announcements') {
      setAnnouncementsOpen(true)
    } else {
      navigate(action.path)
    }
  }

  return (
    <div style={{ minHeight: '100vh', width: '100%', background: 'linear-gradient(135deg, #0d1117 0%, #1a1f2e 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingBottom: '40px' }}>

      {/* ── ANNOUNCEMENTS MODAL ── */}
      {announcementsOpen && <AnnouncementsModal onClose={() => setAnnouncementsOpen(false)} />}

      {/* ── HEADER ── */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 32px', background: 'rgba(22,27,34,0.95)', backdropFilter: 'blur(12px)', borderRadius: '14px', margin: '20px 0 30px 0', border: '1px solid #30363d', width: '95%', maxWidth: '1280px', boxSizing: 'border-box', gap: '16px' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <span style={{ fontSize: '22px' }}>🧠</span>
          <h1 style={{ color: 'white', margin: 0, fontSize: '20px', fontWeight: '700', letterSpacing: '-0.3px' }}>CodeSense</h1>
        </div>

        <div style={{ flex: 1 }} />

        {/* Search */}
        <div ref={searchRef} style={{ position: 'relative', width: '200px' }}>
          <div className="cs-search-bar" style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(48,54,61,0.8)', borderRadius: '10px', padding: '8px 12px' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#484f58" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input ref={searchInputRef} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onFocus={() => { if (searchQuery.trim()) setSearchOpen(true) }}
              placeholder="Search..." style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#e6edf3', fontSize: '13px', minWidth: 0 }} />
            {searchQuery && (
              <button className="cs-btn" onClick={() => { setSearchQuery(''); setSearchOpen(false) }}
                style={{ background: 'rgba(255,255,255,0.08)', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '11px', padding: '2px 5px', lineHeight: 1, borderRadius: '4px' }}>✕</button>
            )}
          </div>

          {searchOpen && searchQuery && (
            <div className="cs-dropdown" style={{ position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0, background: '#161b22', border: '1px solid #30363d', borderRadius: '14px', boxShadow: '0 20px 50px rgba(0,0,0,0.6)', zIndex: 1000, overflow: 'hidden' }}>
              <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
                {searchLoading && <div style={{ padding: '20px', textAlign: 'center', color: '#8b949e', fontSize: '13px' }}>Searching...</div>}
                {!searchLoading && !searchResults.actions.length && !searchResults.players.length && !searchResults.quests.length && !searchResults.reports.length && (
                  <div style={{ padding: '24px 16px', textAlign: 'center', color: '#484f58', fontSize: '13px' }}>
                    <div style={{ fontSize: '28px', marginBottom: '8px' }}>😶</div>No results for "{searchQuery}"
                  </div>
                )}
                {searchResults.actions.length > 0 && (<div>
                  <div style={{ padding: '8px 16px 4px', color: '#8b949e', fontSize: '10px', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Quick Actions</div>
                  {searchResults.actions.map(a => (
                    <button key={a.label} className="cs-search-result-btn" onClick={() => handleSearchActionClick(a)}
                      style={{ width: '100%', background: 'transparent', border: 'none', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', textAlign: 'left' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(76,175,80,0.12)', border: '1px solid rgba(76,175,80,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <span style={{ fontSize: '16px' }}>{a.icon}</span>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: '#e6edf3', fontSize: '13px', fontWeight: '600' }}>{a.label}</div>
                        <div style={{ color: '#8b949e', fontSize: '11px' }}>{a.desc}</div>
                      </div>
                      <span style={{ color: '#4caf50', fontSize: '11px' }}>→</span>
                    </button>
                  ))}
                </div>)}
                {searchResults.players.length > 0 && (<div>
                  <div style={{ padding: '8px 16px 4px', color: '#8b949e', fontSize: '10px', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Players</div>
                  {searchResults.players.map(p => (
                    <button key={p.id} className="cs-search-result-btn" onClick={() => { setSearchOpen(false); setSearchQuery(''); navigate('/profile') }}
                      style={{ width: '100%', background: 'transparent', border: 'none', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', textAlign: 'left' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'linear-gradient(135deg,#4caf50,#2d7a2d)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <span style={{ color: 'white', fontSize: '13px', fontWeight: '700' }}>{p.playername.charAt(0).toUpperCase()}</span>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: '#e6edf3', fontSize: '13px', fontWeight: '600' }}>{p.playername}</div>
                        <div style={{ color: '#8b949e', fontSize: '11px' }}>{getLevelName(p.currentlevel as 1|2|3|4)} · {p.totalxp} XP</div>
                      </div>
                      <span style={{ color: '#484f58', fontSize: '11px' }}>👤</span>
                    </button>
                  ))}
                </div>)}
                {searchResults.quests.length > 0 && (<div style={{ borderTop: searchResults.players.length > 0 ? '1px solid #21262d' : 'none' }}>
                  <div style={{ padding: '8px 16px 4px', color: '#8b949e', fontSize: '10px', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Quests</div>
                  {searchResults.quests.map((q: any) => {
                    const pc = q.phase === 'beginner' ? '#4caf50' : q.phase === 'intermediate' ? '#ffa726' : '#f44336'
                    return (
                      <button key={q.id} className="cs-search-result-btn" onClick={() => { setSearchOpen(false); setSearchQuery(''); navigate('/campaign') }}
                        style={{ width: '100%', background: 'transparent', border: 'none', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', textAlign: 'left' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: `${pc}22`, border: `1px solid ${pc}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <span style={{ fontSize: '16px' }}>⚔️</span>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: '#e6edf3', fontSize: '13px', fontWeight: '600' }}>{q.title}</div>
                          <div style={{ color: '#8b949e', fontSize: '11px', textTransform: 'capitalize' }}>{q.phase} · {q.difficulty} · {q.basexp} XP</div>
                        </div>
                        <span style={{ color: pc, fontSize: '10px', fontWeight: '700', background: `${pc}22`, padding: '2px 8px', borderRadius: '8px', textTransform: 'capitalize' }}>{q.phase}</span>
                      </button>
                    )
                  })}
                </div>)}
                {searchResults.reports.length > 0 && (<div style={{ borderTop: (searchResults.players.length > 0 || searchResults.quests.length > 0) ? '1px solid #21262d' : 'none' }}>
                  <div style={{ padding: '8px 16px 4px', color: '#8b949e', fontSize: '10px', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Your Reports</div>
                  {searchResults.reports.map((r: any) => (
                    <button key={r.id} className="cs-search-result-btn" onClick={() => { setSearchOpen(false); setSearchQuery(''); navigate('/progress') }}
                      style={{ width: '100%', background: 'transparent', border: 'none', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', textAlign: 'left' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(100,181,246,0.1)', border: '1px solid rgba(100,181,246,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <span style={{ fontSize: '16px' }}>📋</span>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: '#e6edf3', fontSize: '13px', fontWeight: '600', textTransform: 'capitalize' }}>{r.type} Analysis</div>
                        <div style={{ color: '#8b949e', fontSize: '11px' }}>{r.mode_context} · {new Date(r.createdat).toLocaleDateString()}</div>
                      </div>
                      <span style={{ color: '#484f58', fontSize: '11px' }}>📊</span>
                    </button>
                  ))}
                </div>)}
              </div>
              {!searchLoading && (
                <div style={{ padding: '10px 16px', borderTop: '1px solid #21262d', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#484f58', fontSize: '11px' }}>{searchResults.actions.length + searchResults.players.length + searchResults.quests.length + searchResults.reports.length} result(s)</span>
                  <span style={{ color: '#484f58', fontSize: '11px' }}>Esc to close</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right icons */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0 }}>
          <button className="cs-icon-btn" style={{ background: 'transparent', border: 'none', color: '#8b949e', fontSize: '18px', cursor: 'pointer', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🔔</button>

          <div ref={profileMenuRef} style={{ position: 'relative' }}>
            <button className="cs-avatar-btn" onClick={() => setProfileMenuOpen(p => !p)}
              style={{ background: 'transparent', border: profileMenuOpen ? '2px solid #4caf50' : '2px solid transparent', borderRadius: '50%', cursor: 'pointer', padding: '2px', width: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {avatarUrl ? <img src={avatarUrl} alt="avatar" style={{ width: '30px', height: '30px', borderRadius: '50%', objectFit: 'cover' }} /> : <span style={{ fontSize: '20px' }}>👤</span>}
            </button>

            {profileMenuOpen && (
              <div className="cs-dropdown" style={{ position: 'absolute', top: 'calc(100% + 10px)', right: 0, background: '#161b22', border: '1px solid #30363d', borderRadius: '14px', minWidth: '210px', boxShadow: '0 20px 50px rgba(0,0,0,0.6)', zIndex: 1000, overflow: 'hidden' }}>
                <div style={{ padding: '14px 16px', borderBottom: '1px solid #21262d', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '38px', height: '38px', borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: avatarUrl ? 'transparent' : 'linear-gradient(135deg,#4caf50,#2d7a2d)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {avatarUrl ? <img src={avatarUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: 'white', fontWeight: '700', fontSize: '16px' }}>{user?.playerName?.charAt(0).toUpperCase()}</span>}
                  </div>
                  <div>
                    <div style={{ color: '#e6edf3', fontSize: '13px', fontWeight: '600' }}>{user?.playerName ?? 'Guest'}</div>
                    <div style={{ color: '#8b949e', fontSize: '11px' }}>{currentLevelName}</div>
                  </div>
                </div>
                {[
                  { icon: '🖼️', label: 'Profile Image',          action: () => { navigate('/profile');  setProfileMenuOpen(false) } },
                  // ── CHANGED: "Details Information" → "System Announcements" ──
                  { icon: '📢', label: 'System Announcements',   action: () => { setProfileMenuOpen(false); setAnnouncementsOpen(true) } },
                  { icon: '📊', label: 'Progress Report',         action: () => { navigate('/progress'); setProfileMenuOpen(false) } },
                  { icon: 'ℹ️', label: 'About',                  action: () => { navigate('/profile');  setProfileMenuOpen(false) } },
                ].map(item => (
                  <button key={item.label} className="cs-menu-item" onClick={item.action}
                    style={{ width: '100%', background: 'transparent', border: 'none', color: '#e6edf3', padding: '11px 16px', fontSize: '13px', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '15px' }}>{item.icon}</span>{item.label}
                  </button>
                ))}
                <div style={{ borderTop: '1px solid #21262d' }}>
                  <button className="cs-menu-danger" onClick={() => { setProfileMenuOpen(false); handleExit() }}
                    style={{ width: '100%', background: 'transparent', border: 'none', color: '#f85149', padding: '11px 16px', fontSize: '13px', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '15px' }}>🚪</span>{isGuest ? 'Exit Guest' : 'Log Out'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── MAIN GRID ── */}
      <div style={{ width: '95%', maxWidth: '1280px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', margin: '0 auto', boxSizing: 'border-box', alignItems: 'stretch' }}>

        {/* LEFT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', minWidth: 0, height: '100%' }}>

          {/* Hero */}
          <div style={{ ...heroSectionStyle, flex: 1 }}>
            <div style={radialOverlayStyle} />
            <div style={{ position: 'relative', textAlign: 'center', zIndex: 1, animation: 'fadeSlideUp 0.5s ease' }}>
              <div style={{ fontSize: '48px', marginBottom: '20px' }}>🚀</div>
              <h2 style={heroTitleStyle}>{isGuest ? 'Welcome, Guest!' : `Welcome back, ${user?.playerName || 'Explorer'}!`}</h2>
              <p style={{ color: '#8b949e', fontSize: '16px', margin: 0 }}>
                {isGuest ? 'Explore the sandbox freely. Sign up to save your progress!' : `Continue your journey to master code safety as a ${currentLevelName}.`}
              </p>
            </div>
          </div>

          {/* Mode Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="cs-card" style={modeCardStyle('#4caf50')} onClick={() => navigate('/sandbox')}>
              <h3 style={cardTitleStyle}>Sandbox</h3>
              <p style={cardParaStyle}>Experiment freely with code. No rules, just logic.</p>
              <button className="cs-btn cs-explore-btn" style={cardBtnStyle('#4caf50')}>EXPLORE</button>
            </div>
            <div className={isGuest ? '' : 'cs-card'} style={isGuest ? lockedCardStyle : modeCardStyle('#ffa726')} onClick={() => !isGuest && navigate('/campaign')}>
              <h3 style={cardTitleStyle}>Campaign Mode</h3>
              <p style={cardParaStyle}>Start your journey. Complete missions to level up.</p>
              <button disabled={isGuest} className={isGuest ? '' : 'cs-btn cs-learn-btn'} style={cardBtnStyle(isGuest ? '#30363d' : '#ffa726')}>
                {isGuest ? 'LOCKED' : 'LEARN'}
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', minWidth: 0 }}>

          {/* Leaderboard */}
          <div style={sidebarCardStyle}>
            <h3 style={sidebarTitleStyle}><span>🏆</span> USER LEADERBOARD</h3>
            {isGuest ? (
              <div style={guestPlaceholderStyle}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔒</div>
                <p>Sign up to see the leaderboard</p>
                <button className="cs-btn cs-signup-btn" onClick={() => navigate('/signup')} style={signupBtnStyle}>Sign Up</button>
              </div>
            ) : statsLoading ? (
              <div style={{ color: '#8b949e', fontSize: '13px', textAlign: 'center', padding: '20px' }}>Loading...</div>
            ) : leaderboard.length === 0 ? (
              <div style={{ color: '#484f58', fontSize: '12px', textAlign: 'center', padding: '20px' }}>No players yet</div>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                  {leaderboard.map((player, i) => {
                    const isMe = player.id === user?.id
                    const rank = i + 1
                    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null
                    return (
                      <div key={player.id} className="cs-leaderboard-row" style={{
                        display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px',
                        background: isMe ? 'rgba(76,175,80,0.1)' : i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                        border: isMe ? '1px solid rgba(76,175,80,0.3)' : '1px solid transparent',
                      }}>
                        <span style={{ fontSize: medal ? '16px' : '11px', minWidth: '24px', textAlign: 'center', color: '#8b949e', fontWeight: '700' }}>{medal ?? `#${rank}`}</span>
                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0, background: isMe ? 'linear-gradient(135deg,#4caf50,#2d7a2d)' : 'rgba(100,181,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ fontSize: '12px', fontWeight: '700', color: isMe ? 'white' : '#64b5f6' }}>{player.playername.charAt(0).toUpperCase()}</span>
                        </div>
                        <span style={{ flex: 1, fontSize: '12px', color: isMe ? '#4caf50' : '#e6edf3', fontWeight: isMe ? '700' : '400', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {player.playername}{isMe && <span style={{ fontSize: '10px', color: '#4caf50', marginLeft: '4px', opacity: 0.8 }}>(you)</span>}
                        </span>
                        <span style={{ fontSize: '11px', color: '#ffc107', fontWeight: '600', whiteSpace: 'nowrap' }}>{player.totalxp} XP</span>
                      </div>
                    )
                  })}
                  {myRank && myRank > 10 && (
                    <div style={{ marginTop: '4px', padding: '7px 10px', borderRadius: '8px', background: 'rgba(76,175,80,0.08)', border: '1px solid rgba(76,175,80,0.2)', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '11px', color: '#4caf50' }}>Your rank: #{myRank}</span>
                      <span style={{ fontSize: '11px', color: '#ffc107' }}>{user?.totalXP ?? 0} XP</span>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <button className="cs-btn cs-gold-btn" onClick={() => navigate('/leaderboard')} style={{ ...fullProfileBtnStyle, color: '#ffc107', borderColor: '#ffc107' }}>
                    🏆 View Full Leaderboard
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Progress Report */}
          <div style={sidebarCardStyle}>
            <h3 style={sidebarTitleStyle}><span>📊</span> PROGRESS REPORT</h3>
            {isGuest ? (
              <div style={guestPlaceholderStyle}><p>Sign up to track progress</p></div>
            ) : statsLoading ? (
              <div style={{ color: '#8b949e', fontSize: '13px', textAlign: 'center', padding: '20px' }}>Loading progress...</div>
            ) : (
              <div>
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ color: '#8b949e', fontSize: '12px' }}>XP to next rank</span>
                    <span style={{ color: 'white', fontSize: '12px', fontWeight: '600' }}>
                      {stats.xpToNextLevel === null ? 'MAX RANK 👑' : `${stats.xpToNextLevel} XP remaining`}
                    </span>
                  </div>
                  <div style={progressBarContainerStyle}>
                    <div style={{ width: `${stats.levelProgress}%`, height: '100%', background: 'linear-gradient(90deg,#4caf50 0%,#66bb6a 100%)', transition: 'width 0.9s cubic-bezier(0.4,0,0.2,1)', borderRadius: '4px' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                    <span style={{ color: '#484f58', fontSize: '10px' }}>Lvl {user?.currentLevel}</span>
                    <span style={{ color: '#484f58', fontSize: '10px' }}>{stats.levelProgress}%</span>
                    <span style={{ color: '#484f58', fontSize: '10px' }}>Lvl {Math.min((user?.currentLevel ?? 1) + 1, 4)}</span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                  {[
                    { icon: '🔬', value: stats.sandboxRuns,     label: 'Sandbox Runs' },
                    { icon: '⚔️', value: stats.questsCompleted, label: 'Quests Done'  },
                  ].map(s => (
                    <div key={s.label} className="cs-stat-box"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid #30363d', borderRadius: '8px', padding: '12px', textAlign: 'center', cursor: 'default' }}>
                      <div style={{ fontSize: '18px', marginBottom: '4px' }}>{s.icon}</div>
                      <div style={{ color: 'white', fontWeight: '700', fontSize: '16px' }}>{s.value}</div>
                      <div style={{ color: '#8b949e', fontSize: '10px' }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                <button className="cs-btn cs-progress-btn" onClick={() => navigate('/progress')}
                  style={{ width: '100%', background: 'transparent', color: '#4caf50', border: '1px solid #4caf50', borderRadius: '8px', padding: '10px', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>
                  📊 View Full Progress Report
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};

const heroSectionStyle: React.CSSProperties = { background: 'linear-gradient(135deg, rgba(22,27,34,0.9) 0%, rgba(30,36,47,0.9) 100%)', borderRadius: '16px', padding: '80px 40px', border: '1px solid #30363d', position: 'relative', overflow: 'hidden', minHeight: '380px', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const radialOverlayStyle: React.CSSProperties = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'radial-gradient(circle at 50% 50%, rgba(100,181,246,0.1) 0%, transparent 70%)' };
const heroTitleStyle: React.CSSProperties = { color: 'white', fontSize: '32px', fontWeight: '700', marginBottom: '12px', background: 'linear-gradient(135deg, #64b5f6 0%, #42a5f5 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' };
const modeCardStyle = (color: string): React.CSSProperties => ({ background: `linear-gradient(135deg, ${color}26 0%, ${color}0D 100%)`, border: `2px solid ${color}`, borderRadius: '16px', padding: '36px 24px', cursor: 'pointer' });
const lockedCardStyle: React.CSSProperties = { background: 'rgba(139,148,158,0.05)', border: '2px solid #30363d', borderRadius: '16px', padding: '36px 24px', cursor: 'not-allowed', opacity: 0.6 };
const cardTitleStyle: React.CSSProperties = { color: 'white', fontSize: '22px', fontWeight: '600', marginBottom: '12px' };
const cardParaStyle: React.CSSProperties = { color: '#8b949e', fontSize: '14px', marginBottom: '20px', lineHeight: '1.6' };
const cardBtnStyle = (bg: string): React.CSSProperties => ({ background: bg, color: 'white', border: 'none', borderRadius: '8px', padding: '10px 24px', fontWeight: '600', cursor: 'pointer' });
const sidebarCardStyle: React.CSSProperties = { background: 'rgba(22,27,34,0.9)', border: '1px solid #30363d', borderRadius: '16px', padding: '24px' };
const sidebarTitleStyle: React.CSSProperties = { color: 'white', fontSize: '16px', fontWeight: '600', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' };
const guestPlaceholderStyle: React.CSSProperties = { textAlign: 'center', padding: '20px', color: '#8b949e' };
const signupBtnStyle: React.CSSProperties = { background: '#4caf50', color: 'white', border: 'none', borderRadius: '8px', padding: '10px 24px', fontWeight: '600', cursor: 'pointer', marginTop: '10px' };
const fullProfileBtnStyle: React.CSSProperties = { width: '100%', background: 'transparent', color: '#64b5f6', border: '1px solid #64b5f6', borderRadius: '8px', padding: '10px', fontWeight: '600', cursor: 'pointer' };
const progressBarContainerStyle: React.CSSProperties = { width: '100%', height: '8px', background: 'rgba(100,181,246,0.2)', borderRadius: '4px', overflow: 'hidden' };