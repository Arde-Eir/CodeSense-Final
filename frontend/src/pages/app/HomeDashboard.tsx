// src/HomeDashboard.tsx
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/components/AuthContext';
import { supabase } from '@/services/supabase';
import { getProfileImageUrlMap, getProfileImageUrls } from '@/services/ProfileImages';
import { getLevelProgress, getXPToNextLevel, getRank } from '@/types'
import { PlayerDetailModal } from '@/components/PlayerDetailModal'

const isCompletedMissionRow = (row: { first_completed_at?: string | null; status?: string | null }) =>
  Boolean(row.first_completed_at || row.status === 'completed')

const missionDoneAt = (row: { first_completed_at?: string | null; completedat?: string | null }) =>
  row.first_completed_at ?? row.completedat ?? null

const countUniqueCompletedQuests = (rows: { questid?: string | null; id?: string | null; first_completed_at?: string | null; status?: string | null }[]) =>
  new Set(rows.filter(isCompletedMissionRow).map(row => row.questid ?? row.id)).size

// ── Maintenance Banner ─────────────────────────────────────────────────────────
const MaintenanceBanner: React.FC<{ message: string; isAdmin: boolean; onDisable?: () => void }> = ({ message, isAdmin, onDisable }) => (
  <div style={{
    background: 'linear-gradient(90deg, rgba(180,83,9,0.15), rgba(180,83,9,0.08))',
    border: '1px solid rgba(180,83,9,0.4)', borderRadius: '10px',
    padding: '12px 18px', marginBottom: '16px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <span style={{ fontSize: '18px' }}>🔧</span>
      <div>
        <div style={{ color: '#fbbf24', fontSize: '13px', fontWeight: '700' }}>Scheduled Maintenance</div>
        <div style={{ color: '#d97706', fontSize: '12px', marginTop: '2px' }}>{message}</div>
      </div>
    </div>
    {isAdmin && onDisable && (
      <button onClick={onDisable} style={{
        background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.4)',
        color: '#fbbf24', borderRadius: '6px', padding: '5px 12px',
        fontSize: '11px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
        Disable Maintenance
      </button>
    )}
  </div>
)

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

  /* ── Mobile responsive ── */
  @media (max-width: 768px) {
    .cs-home-header {
      padding: 12px 16px !important;
      margin: 10px 0 16px !important;
      gap: 10px !important;
      flex-wrap: wrap !important;
    }
    .cs-home-search {
      width: 100% !important;
      order: 3;
    }
    .cs-home-grid {
      grid-template-columns: 1fr !important;
      gap: 16px !important;
      width: 100% !important;
      padding: 0 14px !important;
      box-sizing: border-box !important;
    }
    .cs-home-qa-grid {
      grid-template-columns: 1fr !important;
      gap: 16px !important;
    }
    .cs-home-hero {
      min-height: 0 !important;
      padding: 22px 18px !important;
    }
    .hero-name {
      font-size: 26px !important;
    }
    .hero-quote {
      font-size: 14px !important;
      margin: 14px auto 16px !important;
      max-width: 100% !important;
    }
    .hero-stat-chip {
      font-size: 13px !important;
      padding: 8px 14px !important;
    }
    .hero-rank-badge {
      font-size: 13px !important;
      padding: 5px 14px !important;
    }
    .mc-card {
      padding: 20px 18px !important;
    }
    .mc-cta {
      width: 100% !important;
      justify-content: center !important;
      font-size: 14px !important;
      padding: 14px 20px !important;
      min-height: 44px !important;
      margin-top: 4px !important;
    }
    .mc-chip {
      font-size: 12px !important;
      padding: 5px 10px !important;
    }
    .cs-home-modal {
      width: 95vw !important;
      max-width: 95vw !important;
      margin: 10px !important;
      max-height: 85vh !important;
      overflow-y: auto !important;
    }
  }
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

const NOTIF_SEEN_KEY      = 'cs-seen-notifs-v2'
const NOTIF_DISMISSED_KEY = 'cs-dismissed-notifs-v1'
const MILESTONE_TS_KEY    = 'cs-milestone-ts-v1'
const NOTIF_LIMIT = 25

const scopedStorageKey = (baseKey: string, ownerKey: string): string =>
  `${baseKey}:${ownerKey}`

/** Return the ISO timestamp for when this milestone was first observed.
 *  Stable across refreshes — written once to localStorage. */
function getMilestoneTimestamp(id: string, ownerKey: string): string {
  try {
    const key = scopedStorageKey(MILESTONE_TS_KEY, ownerKey)
    const stored: Record<string, string> = JSON.parse(localStorage.getItem(key) ?? localStorage.getItem(MILESTONE_TS_KEY) ?? '{}')
    if (stored[id]) return stored[id]
    const now = new Date().toISOString()
    stored[id] = now
    localStorage.setItem(key, JSON.stringify(stored))
    return now
  } catch {
    return new Date().toISOString()
  }
}

type NotifKind = 'announcement' | 'quest' | 'achievement' | 'rank' | 'admin'

interface NotifItem {
  id: string
  kind: NotifKind
  icon: string
  color: string
  title: string
  body: string
  timestamp: string
  onClick?: () => void
}

const parseStoredIds = (storageKey: string): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

const getScopedIds = (baseKey: string, ownerKey: string): string[] => {
  const key = scopedStorageKey(baseKey, ownerKey)
  if (localStorage.getItem(key) !== null) return parseStoredIds(key)
  const legacy = parseStoredIds(baseKey)
  if (legacy.length > 0) {
    try {
      localStorage.setItem(key, JSON.stringify(legacy.slice(0, 500)))
      localStorage.removeItem(baseKey)
    } catch { /* quota */ }
  }
  return legacy
}

const setScopedIds = (baseKey: string, ownerKey: string, ids: string[]) => {
  try {
    localStorage.setItem(scopedStorageKey(baseKey, ownerKey), JSON.stringify(ids.slice(0, 500)))
    localStorage.removeItem(baseKey)
  } catch { /* quota */ }
}

const getSeenIds = (ownerKey: string): string[] => {
  return getScopedIds(NOTIF_SEEN_KEY, ownerKey)
}
const setSeenIds = (ownerKey: string, ids: string[]) => {
  setScopedIds(NOTIF_SEEN_KEY, ownerKey, ids)
}
const getDismissedIds = (ownerKey: string): string[] => {
  return getScopedIds(NOTIF_DISMISSED_KEY, ownerKey)
}
const setDismissedIds = (ownerKey: string, ids: string[]) => {
  setScopedIds(NOTIF_DISMISSED_KEY, ownerKey, ids)
}

interface Derived {
  check: (stats: { totalxp: number; sandboxRuns: number; quests: number }) => boolean
  id: string; icon: string; color: string; title: string; body: string
}

const XP_MILESTONES: Derived[] = [
  { id: 'rank:knight', icon: '⚔️', color: '#58a6ff', title: 'Knight rank reached!',   body: 'You\'ve crossed 5,000 XP — you can now display the Knight title.',    check: s => s.totalxp >= 5000 },
  { id: 'rank:lord',   icon: '🌟', color: '#a371f7', title: 'Lord rank reached!',     body: 'You\'ve crossed 20,000 XP — the Lord title is unlocked.',             check: s => s.totalxp >= 20000 },
  { id: 'rank:duke',   icon: '👑', color: '#e3b341', title: 'Duke rank reached!',     body: 'You\'ve crossed 75,000 XP — the Duke title is unlocked.',             check: s => s.totalxp >= 75000 },
  { id: 'rank:king',   icon: '🔱', color: '#ffd700', title: 'KING rank reached!',     body: 'You\'ve crossed 250,000 XP — the highest title in the realm is yours.', check: s => s.totalxp >= 250000 },
]

const RUN_MILESTONES: Derived[] = [
  { id: 'ach:run1',   icon: '🔬', color: '#4caf50', title: 'First Analysis',     body: 'You ran your first sandbox analysis. Welcome to the lab.',   check: s => s.sandboxRuns >= 1 },
  { id: 'ach:run10',  icon: '⚗️', color: '#4caf50', title: 'Lab Regular',         body: 'Ten sandbox analyses completed.',                            check: s => s.sandboxRuns >= 10 },
  { id: 'ach:run25',  icon: '🧪', color: '#58a6ff', title: 'Code Scientist',     body: 'Twenty-five analyses — you\'re getting serious.',             check: s => s.sandboxRuns >= 25 },
  { id: 'ach:run50',  icon: '🔭', color: '#a371f7', title: 'Master Analyst',     body: 'Fifty analyses. Epic badge unlocked.',                        check: s => s.sandboxRuns >= 50 },
]

const QUEST_MILESTONES: Derived[] = [
  { id: 'ach:q1',  icon: '⚔️', color: '#ffa726', title: 'First Quest',      body: 'Your first campaign quest is complete.',          check: s => s.quests >= 1 },
  { id: 'ach:q5',  icon: '🛡️', color: '#58a6ff', title: 'Quest Knight',     body: 'Five quests completed — you earned the Rare badge.', check: s => s.quests >= 5 },
  { id: 'ach:q10', icon: '🏆', color: '#a371f7', title: 'Quest Champion',   body: 'Ten quests — Epic achievement unlocked.',         check: s => s.quests >= 10 },
]

const NotificationBell: React.FC<{ userId: string | undefined; onViewAllAnnouncements: () => void }> = ({ userId, onViewAllAnnouncements }) => {
  const navigate = useNavigate()
  const notificationOwnerKey = userId ?? 'guest'
  const [items, setItems] = useState<NotifItem[]>([])
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState<string[]>(() => getSeenIds(notificationOwnerKey))
  const [dismissed, setDismissed] = useState<string[]>(() => getDismissedIds(notificationOwnerKey))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)
  const bellRef = useRef<HTMLDivElement>(null)
  const onViewAllRef = useRef(onViewAllAnnouncements)
  const refreshRunRef = useRef(0)
  useEffect(() => { onViewAllRef.current = onViewAllAnnouncements }, [onViewAllAnnouncements])
  const [activeFilter, setActiveFilter] = useState<'all' | NotifKind>('all')

  useEffect(() => {
    setSeen(getSeenIds(notificationOwnerKey))
    setDismissed(getDismissedIds(notificationOwnerKey))
    setItems([])
    setActiveFilter('all')
  }, [notificationOwnerKey])

  const refresh = useCallback(async () => {
    const runId = refreshRunRef.current + 1
    refreshRunRef.current = runId
    const out: NotifItem[] = []
    setLoading(true)
    setError(null)

    try {
      const { data: anns, error: annError } = await supabase
        .from('announcements')
        .select('id, title, body, createdat, priority, author, ispinned')
        .order('ispinned', { ascending: false })
        .order('createdat', { ascending: false })
        .limit(10)
      if (annError) throw new Error(`Announcements failed: ${annError.message}`)
      if (anns) {
        for (const a of anns as Announcement[]) {
          const cfg = PRIORITY_CONFIG[a.priority] ?? PRIORITY_CONFIG.info
          out.push({
            id: `announcement:${a.id}`, kind: 'announcement',
            icon: cfg.icon, color: cfg.color,
            title: a.ispinned ? `📌 ${a.title}` : a.title,
            body: a.body, timestamp: a.createdat,
            onClick: () => onViewAllRef.current(),
          })
        }
      }

      if (userId) {
        const { data: quests, error: questError } = await supabase
          .from('mission_progress')
          .select('questid, status, completedat, first_completed_at, updatedat, hintsused, quests(title)')
          .eq('userid', userId)
          .order('updatedat', { ascending: false })
          .limit(30)
        if (questError) throw new Error(`Quest notifications failed: ${questError.message}`)
        const completedQuests = ((quests ?? []) as any[])
          .filter(isCompletedMissionRow)
          .filter(q => Boolean(missionDoneAt(q)))
          .sort((a, b) => new Date(missionDoneAt(b)!).getTime() - new Date(missionDoneAt(a)!).getTime())
          .slice(0, 10)
        for (const q of completedQuests) {
          const completedAt = missionDoneAt(q)!
          const title = Array.isArray(q.quests) ? q.quests[0]?.title : q.quests?.title
          out.push({
            id: `quest:${q.questid}:${completedAt}`, kind: 'quest',
            icon: '⚔️', color: '#ffa726',
            title: `Quest completed: ${title ?? 'Unknown'}`,
            body: q.hintsused > 0 ? `Used ${q.hintsused} hint${q.hintsused > 1 ? 's' : ''}.` : 'No hints used. Clean clear.',
            timestamp: completedAt,
            onClick: () => navigate('/campaign'),
          })
        }

        const { data: adminEvents, error: adminError } = await supabase
          .from('admin_audit_log')
          .select('id, action, details, created_at')
          .eq('target_user_id', userId)
          .order('created_at', { ascending: false })
          .limit(10)
        if (adminError) throw new Error(`Admin notifications failed: ${adminError.message}`)
        for (const e of (adminEvents ?? []) as any[]) {
          const meta = ADMIN_ACTION_META[e.action] ?? { icon: '🛡', color: '#58a6ff', title: e.action }
          out.push({
            id: `admin:${e.id}`, kind: 'admin',
            icon: meta.icon, color: meta.color,
            title: meta.title,
            body: typeof e.details?.reason === 'string' ? `Reason: ${e.details.reason}` : 'Account activity recorded.',
            timestamp: e.created_at,
            onClick: () => navigate('/profile'),
          })
        }

        const { data: profile, error: profileError } = await supabase
          .from('users').select('totalxp, sandbox_runs').eq('id', userId).maybeSingle()
        if (profileError) throw new Error(`Profile notification stats failed: ${profileError.message}`)
        const { data: progressRows, error: progressError } = await supabase
          .from('mission_progress')
          .select('id, questid, status, first_completed_at')
          .eq('userid', userId)
        if (progressError) throw new Error(`Progress notification stats failed: ${progressError.message}`)

        if (profile) {
          const stats = {
            totalxp: profile.totalxp ?? 0,
            sandboxRuns: profile.sandbox_runs ?? 0,
            quests: countUniqueCompletedQuests((progressRows ?? []) as any[]),
          }
          for (const m of [...XP_MILESTONES, ...RUN_MILESTONES, ...QUEST_MILESTONES]) {
            if (!m.check(stats)) continue
            out.push({
              id: m.id, kind: m.id.startsWith('rank:') ? 'rank' : 'achievement',
              icon: m.icon, color: m.color,
              title: m.title, body: m.body,
              timestamp: getMilestoneTimestamp(m.id, notificationOwnerKey),
              onClick: () => navigate('/profile'),
            })
          }
        }
      }

      const dismissedSet = new Set(getDismissedIds(notificationOwnerKey))
      const visible = out.filter(n => !dismissedSet.has(n.id))
      visible.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      if (refreshRunRef.current !== runId) return
      setItems(visible.slice(0, NOTIF_LIMIT))
      setLastUpdatedAt(new Date().toISOString())
    } catch (err) {
      if (refreshRunRef.current !== runId) return
      const message = err instanceof Error ? err.message : 'Failed to load notifications'
      console.error('[NotificationBell]', err)
      setError(message)
    } finally {
      if (refreshRunRef.current === runId) setLoading(false)
    }
  }, [userId, navigate, notificationOwnerKey])

  useEffect(() => {
    const initialRefresh = setTimeout(refresh, 0)
    const channel = supabase.channel('notif-bell-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () => refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mission_progress' }, () => refresh())
      .subscribe()
    const poll = setInterval(refresh, 90_000)
    return () => { clearTimeout(initialRefresh); supabase.removeChannel(channel); clearInterval(poll) }
  }, [refresh])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const markIdsRead = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    setSeen(prev => {
      const merged = Array.from(new Set([...prev, ...ids])).slice(0, 500)
      if (merged.length === prev.length) return prev
      setSeenIds(notificationOwnerKey, merged)
      return merged
    })
  }, [notificationOwnerKey])

  // Auto-mark the current snapshot as seen when the dropdown opens. New
  // realtime notifications that arrive while it is already open stay unread.
  useEffect(() => {
    if (!open) return
    const idsToMark = items.map(i => i.id)
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      markIdsRead(idsToMark)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const filtered = activeFilter === 'all' ? items : items.filter(i => i.kind === activeFilter)
  const unread = items.filter(i => !seen.includes(i.id))
  const unreadCount = Math.min(unread.length, 99)
  const unreadFiltered = filtered.filter(i => !seen.includes(i.id)).length

  const toggle = () => setOpen(o => !o)

  const markAllRead = () => {
    markIdsRead(items.map(i => i.id))
  }

  const clearRead = () => {
    const readIds = items.filter(i => seen.includes(i.id)).map(i => i.id)
    if (readIds.length === 0) return
    const mergedDismissed = Array.from(new Set([...dismissed, ...readIds]))
    setDismissed(mergedDismissed); setDismissedIds(notificationOwnerKey, mergedDismissed)
    setItems(prev => prev.filter(i => !readIds.includes(i.id)))
    if (activeFilter !== 'all' && filtered.length === readIds.filter(id => filtered.some(i => i.id === id)).length) {
      setActiveFilter('all')
    }
  }

  const dismissItem = (id: string) => {
    const mergedDismissed = Array.from(new Set([...dismissed, id]))
    setDismissed(mergedDismissed); setDismissedIds(notificationOwnerKey, mergedDismissed)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const readCount = items.filter(i => seen.includes(i.id)).length
  const countByKind = (k: NotifKind) => items.filter(i => i.kind === k).length

  return (
    <div ref={bellRef} style={{ position: 'relative' }}>
      <button
        onClick={toggle}
        className="cs-icon-btn"
        style={{
          background: 'transparent', border: 'none', color: open ? '#e6edf3' : '#8b949e',
          fontSize: '18px', cursor: 'pointer', padding: '8px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
        }}
        aria-label="Notifications"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        🔔
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: '3px', right: '2px',
            minWidth: '16px', height: '16px', padding: '0 4px', boxSizing: 'border-box',
            borderRadius: '10px', background: '#f85149', color: 'white',
            fontSize: '10px', fontWeight: '800', lineHeight: '16px', textAlign: 'center',
            border: '2px solid #161b22', animation: 'pulse 2s ease infinite',
          }}>{unreadCount}</span>
        )}
      </button>

      {open && (
        <div
          className="cs-dropdown"
          style={{
            position: 'absolute', top: 'calc(100% + 10px)', right: 0,
            background: '#161b22', border: '1px solid #30363d', borderRadius: '14px',
            minWidth: '380px', maxWidth: '420px', maxHeight: '540px', overflow: 'hidden',
            boxShadow: '0 20px 50px rgba(0,0,0,0.6)', zIndex: 1000,
            display: 'flex', flexDirection: 'column',
            animation: 'fadeSlideDown 0.18s ease',
          }}
        >
          <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #21262d' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
              <div>
                <div style={{ color: '#e6edf3', fontSize: '13px', fontWeight: '700' }}>
                  🔔 Inbox{unread.length > 0 ? ` · ${unread.length} new` : ''}
                </div>
                <div style={{ color: '#6e7681', fontSize: '10px', marginTop: 2 }}>
                  {loading ? 'Refreshing notifications...' : lastUpdatedAt ? `Updated ${timeAgo(lastUpdatedAt)}` : 'Ready'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button onClick={() => refresh()}
                  disabled={loading}
                  title="Refresh notifications"
                  style={{ background: 'transparent', border: 'none', color: loading ? '#484f58' : '#58a6ff', fontSize: '10px', cursor: loading ? 'wait' : 'pointer', padding: 0, textDecoration: 'underline' }}>
                  Refresh
                </button>
                {unread.length > 0 && (
                  <button onClick={markAllRead}
                    style={{ background: 'transparent', border: 'none', color: '#8b949e', fontSize: '10px', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                    Mark all read
                  </button>
                )}
                {readCount > 0 && (
                  <button onClick={clearRead}
                    title="Remove read notifications to free up space"
                    style={{ background: 'transparent', border: 'none', color: '#f85149', fontSize: '10px', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                    Clear read ({readCount})
                  </button>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, overflowX: 'auto', scrollbarWidth: 'none' }}>
              {[
                { key: 'all',          label: 'All',          count: items.length },
                { key: 'announcement', label: '📢',           count: countByKind('announcement') },
                { key: 'quest',        label: '⚔️ Quests',    count: countByKind('quest') },
                { key: 'achievement',  label: '🏅 Badges',    count: countByKind('achievement') },
                { key: 'rank',         label: '👑 Ranks',     count: countByKind('rank') },
                { key: 'admin',        label: '🛡 Admin',    count: countByKind('admin') },
              ].map(f => {
                const active = activeFilter === f.key
                return (
                  <button
                    key={f.key}
                    onClick={() => setActiveFilter(f.key as any)}
                    disabled={f.count === 0 && f.key !== 'all'}
                    style={{
                      background: active ? 'rgba(88,166,255,0.15)' : 'transparent',
                      border: `1px solid ${active ? 'rgba(88,166,255,0.4)' : '#21262d'}`,
                      color: active ? '#58a6ff' : f.count === 0 && f.key !== 'all' ? '#30363d' : '#8b949e',
                      padding: '3px 8px', borderRadius: 8, fontSize: 10, fontWeight: 700,
                      cursor: f.count === 0 && f.key !== 'all' ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap', flexShrink: 0,
                    }}
                  >
                    {f.label}{f.count > 0 && ` ${f.count}`}
                  </button>
                )
              })}
            </div>
            {error && (
              <div style={{
                marginTop: 10,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid rgba(248,81,73,0.35)',
                background: 'rgba(248,81,73,0.08)',
                color: '#ffb4ae',
                fontSize: 11,
                lineHeight: 1.4,
              }}>
                {error}
              </div>
            )}
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading && items.length === 0 ? (
              <div style={{ padding: '36px 20px', textAlign: 'center', color: '#8b949e' }}>
                <div style={{ fontSize: '28px', marginBottom: '8px', animation: 'pulse 1.5s ease infinite' }}>🔔</div>
                <div style={{ fontSize: '12px' }}>Loading notifications...</div>
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: '36px 20px', textAlign: 'center', color: '#484f58' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>📭</div>
                <div style={{ fontSize: '12px' }}>
                  {activeFilter === 'all' ? 'No notifications yet' : `Nothing in ${activeFilter}`}
                </div>
              </div>
            ) : (
              filtered.map(n => {
                const isUnread = !seen.includes(n.id)
                return (
                  <div
                    key={n.id}
                    className="cs-menu-item"
                    style={{
                      background: isUnread ? `${n.color}0A` : 'transparent',
                      borderBottom: '1px solid #21262d',
                      borderLeft: `3px solid ${isUnread ? n.color : 'transparent'}`,
                      display: 'flex', gap: '10px', alignItems: 'flex-start',
                      padding: '12px 16px',
                    }}
                  >
                    <button
                      onClick={() => { setOpen(false); n.onClick?.() }}
                      style={{
                        flex: 1, minWidth: 0, background: 'transparent', border: 'none',
                        padding: 0, cursor: 'pointer', textAlign: 'left',
                        display: 'flex', gap: '10px', alignItems: 'flex-start',
                      }}
                    >
                      <span style={{ fontSize: '18px', flexShrink: 0, marginTop: '1px' }}>{n.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: '#e6edf3', fontSize: '13px', fontWeight: isUnread ? '700' : '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {n.title}
                        </div>
                        <div style={{ color: '#8b949e', fontSize: '11px', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', marginTop: 2 }}>
                          {n.body}
                        </div>
                        <div style={{ color: n.color, fontSize: '10px', marginTop: '4px', fontWeight: 600, letterSpacing: 0.3 }}>
                          {n.kind.toUpperCase()} · {timeAgo(n.timestamp)}
                          {isUnread && <span style={{ color: '#f85149', marginLeft: 6 }}>NEW</span>}
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); dismissItem(n.id) }}
                      title="Dismiss"
                      style={{
                        background: 'transparent', border: 'none', color: '#484f58',
                        fontSize: '14px', cursor: 'pointer', padding: '2px 4px',
                        flexShrink: 0, lineHeight: 1, alignSelf: 'center',
                      }}
                    >×</button>
                  </div>
                )
              })
            )}
          </div>

          <button
            onClick={() => { setOpen(false); onViewAllRef.current() }}
            style={{
              border: 'none', borderTop: '1px solid #21262d',
              background: 'transparent', color: '#58a6ff',
              padding: '12px', fontSize: '12px', fontWeight: '600',
              cursor: 'pointer', textAlign: 'center', width: '100%',
            }}
          >
            {activeFilter === 'all'
              ? `View full announcement history${unreadFiltered > 0 ? ` · ${unreadFiltered} unread shown` : ''} →`
              : `${filtered.length} ${activeFilter} notification${filtered.length === 1 ? '' : 's'} shown →`}
          </button>
        </div>
      )}
    </div>
  )
}

const timeAgo = (iso: string) => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1)    return 'just now'
  if (mins < 60)   return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  return `${Math.floor(mins / 1440)}d ago`
}

const ADMIN_ACTION_META: Record<string, { icon: string; color: string; title: string }> = {
  ban:           { icon: '🚫', color: '#f85149', title: 'Your account was banned' },
  unban:         { icon: '✅', color: '#4caf50', title: 'Your account was unbanned' },
  grant_admin:   { icon: '🛡', color: '#a371f7', title: 'You were granted admin access' },
  revoke_admin:  { icon: '🔓', color: '#8b949e', title: 'Your admin access was revoked' },
  impersonate:   { icon: '👁️', color: '#e3b341', title: 'An admin previewed your account' },
}

/* ── Announcements Modal ── */
const AnnouncementsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountTime = useRef(Date.now())

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
      onMouseDown={(e) => {
        if (Date.now() - mountTime.current < 200) return
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'overlayFadeIn 0.2s ease',
      }}
    >
      <div
        className="cs-home-modal"
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
                    {ann.ispinned && (
                      <div style={{
                        position: 'absolute', top: '10px', right: '12px',
                        fontSize: '11px', color: cfg.color,
                        background: cfg.bg, border: `1px solid ${cfg.border}`,
                        borderRadius: '6px', padding: '2px 8px', fontWeight: '700',
                        letterSpacing: '0.5px',
                      }}>📌 PINNED</div>
                    )}

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

                    <p style={{
                      color: '#8b949e', fontSize: '13px', lineHeight: '1.65',
                      margin: '0 0 10px 0', whiteSpace: 'pre-wrap',
                    }}>{ann.body}</p>

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

interface HomeLeaderboardPlayer {
  id: string;
  playername: string;
  totalxp: number;
  currentlevel: number;
  avatarUrl?: string | null;
}

const MAX_SEARCH_LENGTH = 100

function sanitizeSearchQuery(q: string): string {
  return q.slice(0, MAX_SEARCH_LENGTH).trim()
}

const RANK_ICONS: Record<string, { icon: string; color: string }> = {
  Squire: { icon: '🛡️', color: '#8b949e' },
  Knight: { icon: '⚔️', color: '#58a6ff' },
  Lord:   { icon: '🌟', color: '#a371f7' },
  Duke:   { icon: '👑', color: '#e3b341' },
  King:   { icon: '🔱', color: '#ffd700' },
}

const MOTIVATIONAL_QUOTES = [
  'Every bug you catch is a lesson the compiler never taught.',
  'Deterministic code rewards patience — patience rewards mastery.',
  'The best programmers read more than they write. Open that CFG.',
  'Small, safe steps beat big, clever leaps. Iterate.',
  'A quiet rule engine is the loudest compliment to your code.',
  'Clarity today, velocity tomorrow.',
  'Your future self will thank you for that extra comment.',
  'Debug like a detective — follow the control flow.',
]

function useRotatingIndex(max: number, intervalMs: number): number {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % max), intervalMs)
    return () => clearInterval(t)
  }, [max, intervalMs])
  return idx
}

function timeBasedGreeting(): { label: string; emoji: string } {
  const h = new Date().getHours()
  if (h < 5)  return { label: 'Burning the midnight oil',      emoji: '🌙' }
  if (h < 12) return { label: 'Good morning',                 emoji: '☀️' }
  if (h < 17) return { label: 'Good afternoon',               emoji: '🌤' }
  if (h < 21) return { label: 'Good evening',                 emoji: '🌇' }
  return       { label: 'Good night',                          emoji: '🌙' }
}

const LiveClock: React.FC = () => {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])
  return (
    <>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>
  )
}

interface HeroProps {
  isGuest: boolean
  playerName: string
  rankName: string
  levelProgress: number
  xpToNextLevel: number | null
  totalXP: number
  currentLevel: number
}

const AnimatedHero: React.FC<HeroProps> = ({
  isGuest, playerName, rankName, levelProgress, xpToNextLevel, totalXP, currentLevel,
}) => {
  const rank = RANK_ICONS[rankName] ?? RANK_ICONS.Squire
  const greet = timeBasedGreeting()
  const quoteIdx = useRotatingIndex(MOTIVATIONAL_QUOTES.length, 7000)
  const heroRef = useRef<HTMLDivElement>(null)
  const [tilt, setTilt] = useState<{ rx: number; ry: number }>({ rx: 0, ry: 0 })

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = heroRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top)  / r.height
    setTilt({ ry: (x - 0.5) * 12, rx: (0.5 - y) * 8 })
  }
  const onMouseLeave = () => setTilt({ rx: 0, ry: 0 })

  const R = 38, C = 2 * Math.PI * R
  const clampedLevelProgress = Math.max(0, Math.min(100, levelProgress))
  const dash = (clampedLevelProgress / 100) * C
  const heroDashOffset = clampedLevelProgress >= 100 ? 0 : C - dash

  return (
    <div
      ref={heroRef}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className="cs-home-hero"
      style={{
        position: 'relative', overflow: 'hidden',
        borderRadius: 16, padding: '36px 32px',
        border: '1px solid #30363d',
        background: 'linear-gradient(135deg, rgba(22,27,34,0.95) 0%, rgba(30,36,47,0.95) 100%)',
        transform: `perspective(1000px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
        transition: 'transform 0.18s ease, box-shadow 0.3s ease',
        boxShadow: '0 10px 40px rgba(0,0,0,0.35)',
        flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center',
        minHeight: 380,
      }}
    >
      <div className="hero-stars" />
      <div className="hero-orb"   style={{ background: `radial-gradient(circle, ${rank.color}22 0%, transparent 70%)` }} />
      <div className="hero-orb-2" style={{ background: `radial-gradient(circle, rgba(76,175,80,0.18) 0%, transparent 70%)` }} />
      <div className="hero-grid" />

      <style>{`
        @keyframes heroFloat      { 0%,100% { transform: translateY(0) rotate(-4deg); } 50% { transform: translateY(-10px) rotate(6deg); } }
        @keyframes heroPulse      { 0%,100% { transform: scale(1); box-shadow: 0 0 0 0 ${rank.color}66; } 50% { transform: scale(1.06); box-shadow: 0 0 0 10px ${rank.color}00; } }
        @keyframes heroStarDrift  { from { transform: translate3d(0,0,0); } to { transform: translate3d(-200px,-120px,0); } }
        @keyframes heroOrbSpin    { from { transform: rotate(0deg) translateX(80px) rotate(0deg); } to { transform: rotate(360deg) translateX(80px) rotate(-360deg); } }
        @keyframes heroOrbSpin2   { from { transform: rotate(360deg) translateX(60px) rotate(-360deg); } to { transform: rotate(0deg) translateX(60px) rotate(0deg); } }
        @keyframes heroGradShift  { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
        @keyframes heroGlow       { 0%,100% { filter: drop-shadow(0 0 8px ${rank.color}88); } 50% { filter: drop-shadow(0 0 22px ${rank.color}); } }
        @keyframes heroQuoteFade  { 0% { opacity: 0; transform: translateY(6px); } 10%,90% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(-6px); } }
        @keyframes heroCountUp    { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: scale(1); } }
        @keyframes heroRingFill   { from { stroke-dashoffset: ${C}; } to { stroke-dashoffset: ${heroDashOffset}; } }

        .hero-stars {
          position: absolute; inset: -100px;
          background-image:
            radial-gradient(1px 1px at 20px 30px, rgba(255,255,255,0.6), transparent),
            radial-gradient(1px 1px at 60px 80px, rgba(255,255,255,0.4), transparent),
            radial-gradient(2px 2px at 120px 120px, rgba(100,181,246,0.6), transparent),
            radial-gradient(1px 1px at 180px 50px, rgba(255,255,255,0.55), transparent),
            radial-gradient(1px 1px at 240px 180px, rgba(76,175,80,0.5), transparent),
            radial-gradient(2px 2px at 300px 100px, rgba(255,193,7,0.45), transparent),
            radial-gradient(1px 1px at 380px 220px, rgba(255,255,255,0.5), transparent);
          background-repeat: repeat;
          background-size: 400px 240px;
          animation: heroStarDrift 30s linear infinite;
          opacity: 0.55;
          pointer-events: none;
        }
        .hero-grid {
          position: absolute; inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px);
          background-size: 44px 44px;
          mask-image: radial-gradient(ellipse at center, black 30%, transparent 70%);
          pointer-events: none;
        }
        .hero-orb {
          position: absolute; width: 240px; height: 240px; border-radius: 50%;
          top: 10%; left: 70%; pointer-events: none;
          animation: heroOrbSpin 20s linear infinite;
          filter: blur(10px);
        }
        .hero-orb-2 {
          position: absolute; width: 180px; height: 180px; border-radius: 50%;
          bottom: 5%; left: 10%; pointer-events: none;
          animation: heroOrbSpin2 26s linear infinite;
          filter: blur(8px);
        }
        .hero-name {
          font-size: 34px; font-weight: 800; margin: 0;
          background: linear-gradient(90deg, #64b5f6, ${rank.color}, #4caf50, #64b5f6);
          background-size: 300% 100%;
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: heroGradShift 8s ease-in-out infinite;
          letter-spacing: -0.5px;
        }
        .hero-rank-badge {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 3px 10px; border-radius: 20px;
          background: ${rank.color}1A; border: 1px solid ${rank.color}55;
          color: ${rank.color}; font-size: 12px; font-weight: 800;
          letter-spacing: 0.4px; animation: heroPulse 3s ease-in-out infinite;
        }
        .hero-rocket  { animation: heroFloat 4s ease-in-out infinite, heroGlow 3s ease-in-out infinite; transition: transform 0.2s; cursor: default; }
        .hero-rocket:hover { animation: none; transform: scale(1.18) rotate(12deg); }
        .hero-quote { animation: heroQuoteFade 7s ease-in-out; }
        .hero-stat-chip {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 12px; border-radius: 10px;
          background: rgba(255,255,255,0.04); border: 1px solid #30363d;
          font-size: 11px; color: #8b949e; font-weight: 600;
          transition: all 0.15s;
          animation: heroCountUp 0.5s ease both;
        }
        .hero-stat-chip:hover {
          background: rgba(255,255,255,0.08); transform: translateY(-2px);
          border-color: ${rank.color}55; color: #e6edf3;
        }
      `}</style>

      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12, color: '#8b949e', fontSize: 13, fontWeight: 600, letterSpacing: 0.3 }}>
          <span>{greet.emoji}</span>
          <span>{greet.label} · <LiveClock /></span>
        </div>

        <div className="hero-rocket" style={{ fontSize: 54, marginBottom: 14, display: 'inline-block' }}>🚀</div>

        <h2 className="hero-name">
          {isGuest ? 'Welcome, Guest!' : `Welcome back, ${playerName}!`}
        </h2>

        {!isGuest && (
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="hero-rank-badge">
              {rank.icon} {rankName}
            </span>
          </div>
        )}

        <p className="hero-quote" key={quoteIdx} style={{
          color: '#c9d1d9', fontSize: 14, margin: '18px auto 22px',
          maxWidth: 420, lineHeight: 1.55, minHeight: 44, fontStyle: 'italic',
        }}>
          {isGuest
            ? 'Explore the sandbox freely. Sign up to save your progress!'
            : `"${MOTIVATIONAL_QUOTES[quoteIdx]}"`}
        </p>

        {!isGuest && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, marginBottom: 18 }}>
            <div style={{ position: 'relative', width: 90, height: 90 }}>
              <svg width={90} height={90} style={{ transform: 'rotate(-90deg)' }}>
                <circle cx={45} cy={45} r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={6} />
                <circle cx={45} cy={45} r={R} fill="none" stroke={rank.color} strokeWidth={6}
                  strokeDasharray={`${C} ${C}`} strokeDashoffset={heroDashOffset}
                  strokeLinecap={clampedLevelProgress >= 100 ? 'butt' : 'round'}
                  style={{ animation: 'heroRingFill 1.2s cubic-bezier(0.4,0,0.2,1) forwards' }} />
              </svg>
              <div style={{
                position: 'absolute', inset: 0, display: 'flex',
                flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{ color: rank.color, fontSize: 18, fontWeight: 800 }}>{clampedLevelProgress}%</div>
                <div style={{ color: '#8b949e', fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase' }}>to Lv{Math.min(currentLevel + 1, 5)}</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
              <span className="hero-stat-chip" style={{ animationDelay: '0.1s' }}>
                ⭐ <b style={{ color: '#ffc107' }}>{totalXP.toLocaleString()}</b>&nbsp;XP
              </span>
              <span className="hero-stat-chip" style={{ animationDelay: '0.2s' }}>
                {rank.icon} Level&nbsp;<b style={{ color: rank.color }}>{currentLevel}</b>
              </span>
              <span className="hero-stat-chip" style={{ animationDelay: '0.3s' }}>
                🎯 {xpToNextLevel === null ? 'Max rank' : <><b style={{ color: '#4caf50' }}>{xpToNextLevel.toLocaleString()}</b>&nbsp;to next</>}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export const HomeDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, isGuest, logout, isAdmin, maintenanceMode, maintenanceMessage, refreshMaintenanceMode } = useAuth();

  const [stats, setStats] = useState<DashboardStats>({ sandboxRuns: 0, questsCompleted: 0, xpToNextLevel: null, levelProgress: 0 })
  const [statsLoading, setStatsLoading] = useState(true)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [leaderboard, setLeaderboard] = useState<HomeLeaderboardPlayer[]>([])
  const [myRank, setMyRank] = useState<number | null>(null)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement>(null)

  const [announcementsOpen, setAnnouncementsOpen] = useState(false)
  const [lastSnippet, setLastSnippet] = useState<{ sourcecode: string; createdat: string } | null>(null)
  const [peekUserId, setPeekUserId] = useState<string | null>(null)

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
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery('') } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const QUICK_ACTIONS = useMemo(() => [
    { label: 'Sandbox Mode',         icon: '🔬', desc: 'Experiment freely with code',      path: '/sandbox',  guestOk: true,  keywords: ['sandbox','experiment','code','run','free'] },
    { label: 'Campaign Mode',        icon: '⚔️', desc: 'Complete quests and earn XP',      path: '/campaign', guestOk: false, keywords: ['campaign','quest','mission','learn','level'] },
    { label: 'Progress Report',      icon: '📊', desc: 'View your stats and activity',     path: '/progress', guestOk: false, keywords: ['progress','report','stats','activity','xp','chart'] },
    { label: 'Profile Settings',     icon: '👤', desc: 'Edit your profile and avatar',     path: '/profile',  guestOk: false, keywords: ['profile','avatar','settings','edit','account','image'] },
    { label: 'Leaderboard',          icon: '🏆', desc: 'See top players ranking',          path: '/leaderboard', guestOk: true, keywords: ['leaderboard','rank','ranking','top','players'] },
    { label: 'System Announcements', icon: '📢', desc: 'View latest updates and notices',  path: '',          guestOk: true,  keywords: ['announcement','announcements','news','update','notice','system'] },
  ].filter(a => !isGuest || a.guestOk), [isGuest])

  const searchAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort()
      searchAbortRef.current = null
    }
  }, [])

  const runSearch = useCallback(async (q: string) => {
    if (searchAbortRef.current) searchAbortRef.current.abort()
    const controller = new AbortController()
    searchAbortRef.current = controller

    setSearchLoading(true)
    const ql = q.toLowerCase()
    try {
      const { data: players } = await supabase.from('users').select('id, playername, totalxp, currentlevel').ilike('playername', `%${q}%`).limit(5)
      const [t, ph, d] = await Promise.all([
        supabase.from('quests').select('id, title, phase, difficulty, basexp').ilike('title',       `%${q}%`).eq('isactive', true).eq('mode', 'campaign').limit(5),
        supabase.from('quests').select('id, title, phase, difficulty, basexp').ilike('phase',       `%${q}%`).eq('isactive', true).eq('mode', 'campaign').limit(5),
        supabase.from('quests').select('id, title, phase, difficulty, basexp').ilike('description', `%${q}%`).eq('isactive', true).eq('mode', 'campaign').limit(5),
      ])
      const questMap = new Map()
      ;[...(t.data ?? []), ...(ph.data ?? []), ...(d.data ?? [])].forEach((item: any) => questMap.set(item.id, item))
      let reportsData: any[] = []
      if (user && !isGuest) {
        const modeMatch = ['sandbox', 'campaign'].find(m => m.includes(ql) || ql.includes(m))
        const [byMode, byCode] = await Promise.all([
          modeMatch ? supabase.from('reports').select('id, type, createdat, mode_context').eq('userid', user.id).eq('mode_context', modeMatch).order('createdat', { ascending: false }).limit(5) : Promise.resolve({ data: [] }),
          supabase.from('reports').select('id, type, createdat, mode_context').eq('userid', user.id).ilike('sourcecode', `%${q}%`).order('createdat', { ascending: false }).limit(5),
        ])
        const rm = new Map()
        ;[...((byMode as any).data ?? []), ...((byCode as any).data ?? [])].forEach((r: any) => rm.set(r.id, r))
        reportsData = Array.from(rm.values()).slice(0, 5)
      }
      const matchedActions = QUICK_ACTIONS.filter(a =>
        a.keywords.some(k => k.includes(ql) || ql.includes(k)) || a.label.toLowerCase().includes(ql)
      )

      if (searchAbortRef.current === controller) {
        setSearchResults({ actions: matchedActions, players: players ?? [], quests: Array.from(questMap.values()).slice(0, 5), reports: reportsData })
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') console.error('Search error:', e)
    } finally {
      if (searchAbortRef.current === controller) setSearchLoading(false)
    }
  }, [QUICK_ACTIONS, isGuest, user])

  const fetchLeaderboard = useCallback(async () => {
    if (!user) return
    try {
      const { data: lb } = await supabase.from('users').select('id, playername, totalxp, currentlevel').eq('isactive', true).order('totalxp', { ascending: false }).limit(10)
      if (lb) {
        const imageMap = await getProfileImageUrlMap(lb.map(player => player.id))
        setLeaderboard(lb.map(player => ({ ...player, ...imageMap.get(player.id) })))
        const myPos = lb.findIndex(u => u.id === user.id)
        if (myPos !== -1) { setMyRank(myPos + 1) }
        else {
          const { count } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('isactive', true).gt('totalxp', user.totalXP ?? 0)
          setMyRank((count ?? 0) + 1)
        }
      }
    } catch (e) { console.error('Leaderboard fetch error:', e) }
  }, [user])

  const fetchAvatar = useCallback(async (cancelled?: { current: boolean }) => {
    if (!user?.id) return
    try {
      setAvatarUrl(null)
      const profileImages = await getProfileImageUrls(user.id)
      if (cancelled?.current) return
      setAvatarUrl(profileImages.avatarUrl)
    } catch (e) { console.error('Avatar fetch error:', e) }
  }, [user?.id])

  const fetchStats = useCallback(async () => {
    if (!user) return
    try {
      const { data: profile } = await supabase.from('users').select('totalxp, currentlevel, sandbox_runs').eq('id', user.id).single()
      const { data: progressRows } = await supabase
        .from('mission_progress')
        .select('id, questid, status, first_completed_at')
        .eq('userid', user.id)
      if (profile) setStats({ sandboxRuns: profile.sandbox_runs ?? 0, questsCompleted: countUniqueCompletedQuests((progressRows ?? []) as any[]), xpToNextLevel: getXPToNextLevel(profile.totalxp ?? 0), levelProgress: getLevelProgress(profile.totalxp ?? 0) })
      const { data: snippet } = await supabase
        .from('reports')
        .select('sourcecode, createdat')
        .eq('userid', user.id)
        .order('createdat', { ascending: false })
        .limit(1)
        .maybeSingle()
      setLastSnippet(snippet?.sourcecode ? { sourcecode: snippet.sourcecode, createdat: snippet.createdat } : null)
      await fetchLeaderboard()
    } catch (error) { console.error('Failed to fetch stats:', error) }
    finally { setStatsLoading(false) }
  }, [fetchLeaderboard, user])

  useEffect(() => {
    if (!user) { setStatsLoading(false); return }
    const initialStats = setTimeout(fetchStats, 0)
    const channel = supabase.channel('leaderboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => fetchLeaderboard())
      .subscribe()
    return () => { clearTimeout(initialStats); supabase.removeChannel(channel) }
  }, [fetchLeaderboard, fetchStats, user])

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults({ actions: [], players: [], quests: [], reports: [] });
      setSearchOpen(false);
      return
    }
    setSearchOpen(true)
    const timer = setTimeout(() => runSearch(sanitizeSearchQuery(searchQuery)), 300)
    return () => clearTimeout(timer)
  }, [runSearch, searchQuery])

  useEffect(() => {
    if (!user?.id) return
    const cancelled = { current: false }
    fetchAvatar(cancelled)
    return () => { cancelled.current = true }
  }, [fetchAvatar, user?.id])

  const handleExit = async () => {
    if (isGuest) { sessionStorage.removeItem('guestMode'); navigate('/', { replace: true }) }
    else { logout(); await new Promise(r => setTimeout(r, 50)); navigate('/', { replace: true }) }
  }

  // Derive rank name from XP, NOT from `currentlevel` — legacy rows can have
  // a stale level number (the old RPC used `1 + xp/500`). XP is the source of truth.
  const currentLevelName = user ? getRank(user.totalXP ?? 0).name : 'Squire'

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

      {announcementsOpen && <AnnouncementsModal onClose={() => setAnnouncementsOpen(false)} />}

      {/* ── PROFILE MENU BACKDROP — rendered at root level outside all stacking contexts ── */}
      {profileMenuOpen && (
        <div
          onMouseDown={(e) => { e.preventDefault(); setProfileMenuOpen(false); }}
          style={{ position: 'fixed', inset: 0, zIndex: 998 }}
        />
      )}

      {peekUserId && (
        <PlayerDetailModal
          userId={peekUserId}
          currentUserId={user?.id}
          onClose={() => setPeekUserId(null)}
        />
      )}

      {/* ── HEADER — no backdropFilter so it doesn't create a stacking context ── */}
      <header className="cs-home-header" style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '16px 32px',
        background: 'rgba(22,27,34,0.95)',
        borderRadius: '14px', margin: '20px 0 30px 0',
        border: '1px solid #30363d',
        width: '95%', maxWidth: '1280px', boxSizing: 'border-box', gap: '16px',
        position: 'relative',
        zIndex: 999,
      }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <span style={{ fontSize: '22px' }}>🧠</span>
          <h1 style={{ color: 'white', margin: 0, fontSize: '20px', fontWeight: '700', letterSpacing: '-0.3px' }}>CodeSense</h1>
        </div>

        <div style={{ flex: 1 }} />

        {/* Search */}
        <div ref={searchRef} className="cs-home-search" style={{ position: 'relative', width: '200px' }}>
          <div className="cs-search-bar" style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(48,54,61,0.8)', borderRadius: '10px', padding: '8px 12px' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#484f58" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value.slice(0, MAX_SEARCH_LENGTH))}
              onFocus={() => { if (searchQuery.trim()) setSearchOpen(true) }}
              placeholder="Search..."
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#e6edf3', fontSize: '13px', minWidth: 0 }}
            />
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
                    <button key={p.id} className="cs-search-result-btn" onClick={() => {
                      setSearchOpen(false); setSearchQuery('');
                      if (p.id === user?.id) navigate('/profile')
                      else                   setPeekUserId(p.id)
                    }}
                      style={{ width: '100%', background: 'transparent', border: 'none', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', textAlign: 'left' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'linear-gradient(135deg,#4caf50,#2d7a2d)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <span style={{ color: 'white', fontSize: '13px', fontWeight: '700' }}>{p.playername.charAt(0).toUpperCase()}</span>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: '#e6edf3', fontSize: '13px', fontWeight: '600' }}>{p.playername}</div>
                        <div style={{ color: '#8b949e', fontSize: '11px' }}>{getRank(p.totalxp ?? 0).name} · {p.totalxp} XP</div>
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
                      <button key={q.id} className="cs-search-result-btn" onClick={() => { setSearchOpen(false); setSearchQuery(''); navigate(isGuest ? '/signup' : '/campaign') }}
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
          <NotificationBell userId={user?.id} onViewAllAnnouncements={() => setAnnouncementsOpen(true)} />

          <div ref={profileMenuRef} style={{ position: 'relative', zIndex: 1000 }}>
            <button
              className="cs-avatar-btn"
              onMouseDown={(e) => { e.preventDefault(); setProfileMenuOpen(p => !p); }}
              style={{ background: 'transparent', border: profileMenuOpen ? '2px solid #4caf50' : '2px solid transparent', borderRadius: '50%', cursor: 'pointer', padding: '2px', width: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
            >
              {avatarUrl ? <img src={avatarUrl} alt="avatar" style={{ width: '30px', height: '30px', borderRadius: '50%', objectFit: 'cover' }} /> : <span style={{ fontSize: '20px' }}>👤</span>}
            </button>

            {profileMenuOpen && (
              <div className="cs-dropdown" style={{
                position: 'absolute', top: 'calc(100% + 10px)', right: 0,
                background: '#0d1117',
                border: '1px solid #30363d', borderRadius: '14px', minWidth: '240px',
                boxShadow: '0 20px 50px rgba(0,0,0,0.95)',
                zIndex: 1000, overflow: 'hidden',
              }}>
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
                  ...(!isGuest ? [{
                    icon: '⚡', tint: '#facc15',
                    label: lastSnippet ? 'Quick Start — Last Snippet' : 'Quick Start — Fresh Sandbox',
                    sublabel: lastSnippet
                      ? `Resume ${Math.max(1, Math.floor((Date.now() - new Date(lastSnippet.createdat).getTime()) / 60000))}-min-old analysis`
                      : 'Open the sandbox with a clean editor',
                    action: () => {
                      if (lastSnippet?.sourcecode) {
                        try { sessionStorage.setItem('cs-sandbox-restore', lastSnippet.sourcecode) } catch { /* quota */ }
                      }
                      navigate('/sandbox'); setProfileMenuOpen(false)
                    },
                  }] : []),
                  ...(!isGuest ? [{ icon: '🖼️', tint: '#58a6ff', label: 'Profile Image',    action: () => { navigate('/profile');   setProfileMenuOpen(false) } }] : []),
                  { icon: '📢', tint: '#ffa726', label: 'System Announcements',  action: () => { setProfileMenuOpen(false); setAnnouncementsOpen(true) } },
                  ...(!isGuest ? [{ icon: '📊', tint: '#3fb950', label: 'Progress Report', action: () => { navigate('/progress');  setProfileMenuOpen(false) } }] : []),
                  { icon: '🎓', tint: '#a371f7', label: 'Tutorials',              action: () => { navigate('/tutorials'); setProfileMenuOpen(false) } },
                  { icon: '📘', tint: '#26c6da', label: 'User Manual',            action: () => { navigate('/manual');       setProfileMenuOpen(false) } },
                  { icon: '📋', tint: '#8b949e', label: 'Patch Notes',            action: () => { navigate('/patch-notes'); setProfileMenuOpen(false) } },
                  { icon: '🗺️', tint: '#e3b341', label: isGuest ? 'Start Welcome Tour' : 'Replay Welcome Tour', action: () => { setProfileMenuOpen(false); window.dispatchEvent(new CustomEvent('cs-replay-tour')) } },
                  ...(isAdmin ? [{ icon: '🛡️', tint: '#f85149', label: 'Admin Panel', action: () => { navigate('/admin'); setProfileMenuOpen(false) } }] : []),
                ].map((item: any) => (
                  <button key={item.label} className="cs-menu-item" onClick={item.action}
                    style={{ width: '100%', background: 'transparent', border: 'none', color: '#e6edf3', padding: '10px 14px', fontSize: '13px', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{
                      width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14,
                      background: `${item.tint}1a`,
                      border: `1px solid ${item.tint}33`,
                    }}>{item.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</div>
                      {item.sublabel && (
                        <div style={{ fontSize: '10px', color: '#8b949e', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.sublabel}
                        </div>
                      )}
                    </div>
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

      {/* ── MAINTENANCE BANNER ── */}
      {maintenanceMode && (
        <div style={{ width: '95%', maxWidth: '1280px', marginBottom: '0' }}>
          <MaintenanceBanner
            message={maintenanceMessage}
            isAdmin={isAdmin}
            onDisable={isAdmin ? async () => {
              await supabase.from('system_settings').upsert({ key: 'maintenance_mode', value: false })
              await refreshMaintenanceMode()
            } : undefined}
          />
        </div>
      )}

      {/* ── MAIN GRID ── */}
      <div className="cs-home-grid" style={{ width: '95%', maxWidth: '1280px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', margin: '0 auto', boxSizing: 'border-box', alignItems: 'stretch' }}>

        {/* LEFT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', minWidth: 0, height: '100%' }}>

          <AnimatedHero
            isGuest={isGuest}
            playerName={user?.playerName || 'Explorer'}
            rankName={currentLevelName}
            levelProgress={stats.levelProgress}
            xpToNextLevel={stats.xpToNextLevel}
            totalXP={user?.totalXP ?? 0}
            currentLevel={user?.currentLevel ?? 1}
          />

          <style>{`
            @keyframes mcShimmer { 0%,100%{opacity:0.35;transform:translateX(-20%)} 50%{opacity:0.6;transform:translateX(20%)} }
            @keyframes mcPulse   { 0%,100%{transform:scale(1)} 50%{transform:scale(1.08)} }
            @keyframes mcFloat   { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
            .mc-card { position:relative; overflow:hidden; cursor:pointer; border-radius:16px; padding:26px 24px; border:2px solid; transition:transform 0.2s ease, box-shadow 0.25s ease, border-color 0.2s ease; }
            .mc-card:hover { transform:translateY(-5px) scale(1.01); }
            .mc-card .mc-shimmer { position:absolute; inset:0; background:linear-gradient(120deg, transparent 30%, currentColor 50%, transparent 70%); opacity:0; pointer-events:none; transition:opacity 0.3s; }
            .mc-card:hover .mc-shimmer { animation:mcShimmer 2s ease-in-out infinite; }
            .mc-card .mc-emoji { display:inline-block; animation:mcFloat 3s ease-in-out infinite; }
            .mc-card:hover .mc-emoji { animation:mcPulse 0.8s ease-in-out infinite; }
            .mc-chip { display:inline-flex; align-items:center; gap:4px; padding:3px 9px; border-radius:12px; font-size:10px; font-weight:700; letter-spacing:0.3px; }
            .mc-cta { display:inline-flex; align-items:center; gap:6px; padding:9px 18px; border-radius:10px; font-size:12px; font-weight:800; letter-spacing:0.8px; border:none; cursor:pointer; transition:all 0.2s; }
            .mc-cta:hover:not(:disabled) { transform:translateX(3px); }
            .mc-cta:disabled { opacity:0.5; cursor:not-allowed; }
          `}</style>

          <div className="cs-home-qa-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            {/* ── SANDBOX ── */}
            <div
              className="mc-card"
              onClick={() => navigate('/sandbox')}
              style={{
                background: 'linear-gradient(135deg, rgba(76,175,80,0.18) 0%, rgba(76,175,80,0.04) 100%)',
                borderColor: '#4caf50', color: '#4caf50',
                boxShadow: '0 0 0 rgba(76,175,80,0)',
              }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 12px 40px rgba(76,175,80,0.25)' }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 0 0 rgba(76,175,80,0)' }}
            >
              <div className="mc-shimmer" />
              <div style={{ position: 'relative', zIndex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <span className="mc-emoji" style={{ fontSize: 40 }}>🔬</span>
                  {!isGuest && stats.sandboxRuns > 0 && (
                    <span className="mc-chip" style={{ background: 'rgba(76,175,80,0.2)', color: '#4caf50', border: '1px solid rgba(76,175,80,0.4)' }}>
                      {stats.sandboxRuns} run{stats.sandboxRuns !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <h3 style={{ color: 'white', fontSize: 22, fontWeight: 800, margin: '0 0 6px', letterSpacing: -0.2 }}>Sandbox</h3>
                <p style={{ color: '#8b949e', fontSize: 13, lineHeight: 1.55, margin: '0 0 18px' }}>
                  Experiment freely with C++. Run the analyser, inspect the CFG, no rules.
                </p>
                <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                  <span className="mc-chip" style={{ background: 'rgba(255,255,255,0.05)', color: '#8b949e' }}>🔤 7 analyzer tabs</span>
                  <span className="mc-chip" style={{ background: 'rgba(255,255,255,0.05)', color: '#8b949e' }}>🧩 Build Mode</span>
                </div>
                <button className="mc-cta" style={{ background: '#4caf50', color: 'white' }}>
                  EXPLORE <span>→</span>
                </button>
              </div>
            </div>

            {/* ── CAMPAIGN ── */}
            <div
              className="mc-card"
              onClick={() => !isGuest && navigate('/campaign')}
              style={{
                background: isGuest
                  ? 'linear-gradient(135deg, rgba(139,148,158,0.08) 0%, rgba(139,148,158,0.02) 100%)'
                  : 'linear-gradient(135deg, rgba(255,167,38,0.18) 0%, rgba(255,167,38,0.04) 100%)',
                borderColor: isGuest ? '#30363d' : '#ffa726',
                color: isGuest ? '#484f58' : '#ffa726',
                cursor: isGuest ? 'not-allowed' : 'pointer',
                boxShadow: '0 0 0 rgba(255,167,38,0)',
              }}
              onMouseEnter={e => { if (!isGuest) e.currentTarget.style.boxShadow = '0 12px 40px rgba(255,167,38,0.25)' }}
              onMouseLeave={e => { if (!isGuest) e.currentTarget.style.boxShadow = '0 0 0 rgba(255,167,38,0)' }}
            >
              <div className="mc-shimmer" />
              <div style={{ position: 'relative', zIndex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <span className="mc-emoji" style={{ fontSize: 40, filter: isGuest ? 'grayscale(1)' : 'none' }}>⚔️</span>
                  {!isGuest && stats.questsCompleted > 0 && (
                    <span className="mc-chip" style={{ background: 'rgba(255,167,38,0.2)', color: '#ffa726', border: '1px solid rgba(255,167,38,0.4)' }}>
                      {stats.questsCompleted} quest{stats.questsCompleted !== 1 ? 's' : ''} done
                    </span>
                  )}
                  {isGuest && (
                    <span className="mc-chip" style={{ background: 'rgba(139,148,158,0.1)', color: '#8b949e', border: '1px solid #30363d' }}>
                      🔒 LOCKED
                    </span>
                  )}
                </div>
                <h3 style={{ color: isGuest ? '#8b949e' : 'white', fontSize: 22, fontWeight: 800, margin: '0 0 6px', letterSpacing: -0.2 }}>
                  Campaign Mode
                </h3>
                <p style={{ color: '#8b949e', fontSize: 13, lineHeight: 1.55, margin: '0 0 18px' }}>
                  {isGuest
                    ? 'Sign up to unlock quests, earn XP, and climb the ranks.'
                    : 'Complete guided quests, earn XP, and climb from Squire to King.'}
                </p>
                <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                  <span className="mc-chip" style={{ background: 'rgba(255,255,255,0.05)', color: '#8b949e' }}>🌱 3 phases</span>
                  <span className="mc-chip" style={{ background: 'rgba(255,255,255,0.05)', color: '#8b949e' }}>⭐ XP rewards</span>
                  <span className="mc-chip" style={{ background: 'rgba(255,255,255,0.05)', color: '#8b949e' }}>🏅 Badges</span>
                </div>
                <button
                  disabled={isGuest}
                  className="mc-cta"
                  style={{
                    background: isGuest ? 'transparent' : '#ffa726',
                    color: isGuest ? '#484f58' : 'white',
                    border: isGuest ? '1px solid #30363d' : 'none',
                  }}
                >
                  {isGuest ? '🔒 LOCKED' : <>LEARN <span>→</span></>}
                </button>
              </div>
            </div>
          </div>

        </div>

        {/* RIGHT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', minWidth: 0 }}>

          {/* ── Leaderboard (mini) ── */}
          <style>{`
            @keyframes lbCrown      { 0%,100%{transform:translateY(0) rotate(-5deg)} 50%{transform:translateY(-3px) rotate(5deg)} }
            @keyframes lbGoldGlow   { 0%,100%{box-shadow:0 0 0 rgba(255,215,0,0.4)} 50%{box-shadow:0 0 20px rgba(255,215,0,0.6)} }
            .lb-row { transition: all 0.15s ease; position: relative; }
            .lb-row:hover:not(.lb-me) { transform: translateX(3px); }
            .lb-row.top1 { animation: lbGoldGlow 3s ease-in-out infinite; }
            .lb-crown { display: inline-block; animation: lbCrown 2.4s ease-in-out infinite; }
          `}</style>
          <div style={sidebarCardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ ...sidebarTitleStyle, marginBottom: 0 }}><span>🏆</span> LEADERBOARD</h3>
              {!isGuest && myRank && (
                <span style={{
                  background: myRank <= 3 ? 'rgba(255,193,7,0.15)' : 'rgba(100,181,246,0.15)',
                  border: `1px solid ${myRank <= 3 ? 'rgba(255,193,7,0.4)' : 'rgba(100,181,246,0.4)'}`,
                  color: myRank <= 3 ? '#ffc107' : '#64b5f6',
                  padding: '3px 10px', borderRadius: 10,
                  fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
                  fontFamily: "'IBM Plex Mono', monospace",
                }}>
                  YOU · #{myRank}
                </span>
              )}
            </div>

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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '14px' }}>
                  {leaderboard.map((player, i) => {
                    const isMe = player.id === user?.id
                    const rank = i + 1
                    const isTop3 = rank <= 3
                    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null
                    const medalColor = rank === 1 ? '#ffd700' : rank === 2 ? '#c0c0c0' : rank === 3 ? '#cd7f32' : '#8b949e'
                    return (
                      <div key={player.id}
                        className={`lb-row ${isMe ? 'lb-me' : ''} ${rank === 1 ? 'top1' : ''}`}
                        onClick={() => { if (isMe) navigate('/profile'); else setPeekUserId(player.id) }}
                        title={isMe ? 'Open your profile' : `View ${player.playername}'s profile`}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 10px',
                          background: isMe ? 'linear-gradient(90deg, rgba(76,175,80,0.15), rgba(76,175,80,0.05))'
                                    : isTop3 ? `linear-gradient(90deg, ${medalColor}18, transparent)`
                                    : i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                          border: isMe ? '1px solid rgba(76,175,80,0.4)'
                                 : rank === 1 ? '1px solid rgba(255,215,0,0.25)'
                                 : '1px solid transparent',
                          cursor: 'pointer', borderRadius: 8,
                          borderLeft: isTop3 ? `3px solid ${medalColor}` : (isMe ? '3px solid #4caf50' : '3px solid transparent'),
                        }}
                      >
                        <span style={{ fontSize: medal ? 18 : 11, minWidth: 24, textAlign: 'center', color: medalColor, fontWeight: 700 }}>
                          {medal ?? `#${rank}`}
                        </span>
                        <div style={{
                          width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                          background: isMe ? 'linear-gradient(135deg,#4caf50,#2d7a2d)'
                                     : rank === 1 ? 'linear-gradient(135deg,#ffd700,#ff8f00)'
                                     : rank === 2 ? 'linear-gradient(135deg,#c0c0c0,#9e9e9e)'
                                     : rank === 3 ? 'linear-gradient(135deg,#cd7f32,#8b5a2b)'
                                     : 'rgba(100,181,246,0.15)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          border: rank === 1 ? '2px solid #ffd700' : '2px solid transparent',
                          overflow: 'hidden',
                        }}>
                          {player.avatarUrl
                            ? <img src={player.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <span style={{ fontSize: 13, fontWeight: 800, color: isTop3 || isMe ? 'white' : '#64b5f6' }}>
                                {player.playername.charAt(0).toUpperCase()}
                              </span>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, color: isMe ? '#4caf50' : '#e6edf3', fontWeight: (isMe || isTop3) ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {player.playername}
                            {rank === 1 && <span className="lb-crown" style={{ marginLeft: 4 }}>👑</span>}
                            {isMe && <span style={{ fontSize: 10, color: '#4caf50', marginLeft: 5, opacity: 0.85 }}>(you)</span>}
                          </div>
                          <div style={{ fontSize: 10, color: '#484f58', marginTop: 1 }}>
                            {getRank(player.totalxp ?? 0).name}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 12, color: '#ffc107', fontWeight: 700 }}>{player.totalxp.toLocaleString()}</div>
                          <div style={{ fontSize: 9, color: '#484f58', letterSpacing: 0.3 }}>XP</div>
                        </div>
                      </div>
                    )
                  })}
                  {myRank && myRank > 10 && (
                    <div style={{
                      marginTop: 6, padding: '8px 10px', borderRadius: 8,
                      background: 'linear-gradient(90deg, rgba(76,175,80,0.12), rgba(76,175,80,0.04))',
                      border: '1px solid rgba(76,175,80,0.3)',
                      borderLeft: '3px solid #4caf50',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, color: '#4caf50', fontWeight: 700 }}>#{myRank}</span>
                        <span style={{ fontSize: 11, color: '#e6edf3' }}>{user?.playerName}</span>
                        <span style={{ fontSize: 10, color: '#4caf50', fontWeight: 600 }}>(you)</span>
                      </div>
                      <span style={{ fontSize: 11, color: '#ffc107', fontWeight: 700 }}>{(user?.totalXP ?? 0).toLocaleString()} XP</span>
                    </div>
                  )}
                </div>
                <button className="cs-btn cs-gold-btn" onClick={() => navigate('/leaderboard')}
                  style={{
                    width: '100%', background: 'linear-gradient(90deg, rgba(255,193,7,0.1), rgba(255,193,7,0.04))',
                    color: '#ffc107', border: '1px solid rgba(255,193,7,0.4)',
                    borderRadius: 8, padding: 10, fontWeight: 700, cursor: 'pointer', fontSize: 12,
                    letterSpacing: 0.4, transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(90deg, rgba(255,193,7,0.2), rgba(255,193,7,0.08))' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(90deg, rgba(255,193,7,0.1), rgba(255,193,7,0.04))' }}
                >
                  🏆 View Full Leaderboard →
                </button>
              </>
            )}
          </div>

          {/* ── Progress Report ── */}
          <style>{`
            @keyframes prRingFill    { from { stroke-dashoffset: 226; } }
            @keyframes prFadeIn      { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes prCountUp     { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
            .pr-stat {
              background: rgba(255,255,255,0.03); border: 1px solid #30363d;
              border-radius: 10px; padding: 10px 12px; cursor: pointer;
              transition: all 0.18s ease;
              animation: prFadeIn 0.4s ease both;
            }
            .pr-stat:hover { transform: translateY(-3px); background: rgba(255,255,255,0.06); }
          `}</style>
          <div style={sidebarCardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ ...sidebarTitleStyle, marginBottom: 0 }}><span>📊</span> PROGRESS</h3>
              {!isGuest && !statsLoading && (
                <span style={{
                  fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
                  color: '#4caf50', background: 'rgba(76,175,80,0.12)',
                  border: '1px solid rgba(76,175,80,0.3)',
                  padding: '3px 9px', borderRadius: 10,
                  fontFamily: "'IBM Plex Mono', monospace",
                }}>
                  {currentLevelName.toUpperCase()}
                </span>
              )}
            </div>

            {isGuest ? (
              <div style={guestPlaceholderStyle}><p>Sign up to track progress</p></div>
            ) : statsLoading ? (
              <div style={{ color: '#8b949e', fontSize: 13, textAlign: 'center', padding: 20 }}>Loading progress…</div>
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
                  <div style={{ position: 'relative', width: 80, height: 80, flexShrink: 0 }}>
                    <svg width={80} height={80} style={{ transform: 'rotate(-90deg)' }}>
                      <circle cx={40} cy={40} r={36} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={6} />
                      <circle cx={40} cy={40} r={36} fill="none" stroke="#4caf50" strokeWidth={6}
                        strokeDasharray={`${2 * Math.PI * 36} ${2 * Math.PI * 36}`}
                        strokeDashoffset={
                          Math.max(0, Math.min(100, stats.levelProgress)) >= 100
                            ? 0
                            : (2 * Math.PI * 36) - (Math.max(0, Math.min(100, stats.levelProgress)) / 100) * (2 * Math.PI * 36)
                        }
                        strokeLinecap={Math.max(0, Math.min(100, stats.levelProgress)) >= 100 ? 'butt' : 'round'}
                        style={{ transition: 'stroke-dashoffset 1s ease' }} />
                    </svg>
                    <div style={{
                      position: 'absolute', inset: 0, display: 'flex',
                      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <div style={{ color: '#4caf50', fontSize: 16, fontWeight: 800 }}>{Math.max(0, Math.min(100, stats.levelProgress))}%</div>
                      <div style={{ color: '#484f58', fontSize: 8, letterSpacing: 0.4, textTransform: 'uppercase' }}>to Lv{Math.min((user?.currentLevel ?? 1) + 1, 5)}</div>
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#e6edf3', fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                      {stats.xpToNextLevel === null ? '🌟 MAX RANK' : 'Next rank in'}
                    </div>
                    <div style={{ color: '#ffc107', fontSize: 20, fontWeight: 800, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: -0.5 }}>
                      {stats.xpToNextLevel === null ? 'KING 🔱' : `${stats.xpToNextLevel.toLocaleString()}`}
                    </div>
                    {stats.xpToNextLevel !== null && (
                      <div style={{ color: '#8b949e', fontSize: 10, marginTop: 2 }}>XP remaining</div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
                  {[
                    { icon: '🔬', value: stats.sandboxRuns,     label: 'Analyses', color: '#4caf50', path: '/sandbox' },
                    { icon: '⚔️', value: stats.questsCompleted, label: 'Quests',   color: '#ffa726', path: '/campaign' },
                    { icon: '🏆', value: myRank ? `#${myRank}` : '—', label: 'Rank', color: '#ffc107', path: '/leaderboard' },
                  ].map((s, i) => (
                    <button
                      key={s.label}
                      className="pr-stat"
                      onClick={() => navigate(s.path)}
                      style={{ animationDelay: `${i * 0.08}s`, textAlign: 'center' }}
                      title={`Open ${s.label}`}
                    >
                      <div style={{ fontSize: 16, marginBottom: 3 }}>{s.icon}</div>
                      <div style={{ color: s.color, fontWeight: 800, fontSize: 16, animation: 'prCountUp 0.5s ease' }}>{s.value}</div>
                      <div style={{ color: '#8b949e', fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase' }}>{s.label}</div>
                    </button>
                  ))}
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ background: 'rgba(100,181,246,0.1)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                    <div style={{
                      width: `${stats.levelProgress}%`, height: '100%',
                      background: 'linear-gradient(90deg,#4caf50 0%,#66bb6a 50%,#ffc107 100%)',
                      transition: 'width 0.9s cubic-bezier(0.4,0,0.2,1)', borderRadius: 4,
                      boxShadow: '0 0 8px rgba(76,175,80,0.4)',
                    }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    <span style={{ color: '#484f58', fontSize: 9, letterSpacing: 0.3 }}>Lvl {user?.currentLevel}</span>
                    <span style={{ color: '#484f58', fontSize: 9 }}>{(user?.totalXP ?? 0).toLocaleString()} XP</span>
                    <span style={{ color: '#484f58', fontSize: 9, letterSpacing: 0.3 }}>Lvl {Math.min((user?.currentLevel ?? 1) + 1, 5)}</span>
                  </div>
                </div>

                <button onClick={() => navigate('/progress')}
                  style={{
                    width: '100%',
                    background: 'linear-gradient(90deg, rgba(76,175,80,0.1), rgba(76,175,80,0.04))',
                    color: '#4caf50', border: '1px solid rgba(76,175,80,0.4)',
                    borderRadius: 8, padding: 10, fontWeight: 700, cursor: 'pointer', fontSize: 12,
                    letterSpacing: 0.4, transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(90deg, rgba(76,175,80,0.2), rgba(76,175,80,0.08))' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(90deg, rgba(76,175,80,0.1), rgba(76,175,80,0.04))' }}
                >
                  📊 View Full Progress Report →
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};

const sidebarCardStyle: React.CSSProperties = { background: 'rgba(22,27,34,0.9)', border: '1px solid #30363d', borderRadius: '16px', padding: '24px' };
const sidebarTitleStyle: React.CSSProperties = { color: 'white', fontSize: '16px', fontWeight: '600', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' };
const guestPlaceholderStyle: React.CSSProperties = { textAlign: 'center', padding: '20px', color: '#8b949e' };
const signupBtnStyle: React.CSSProperties = { background: '#4caf50', color: 'white', border: 'none', borderRadius: '8px', padding: '10px 24px', fontWeight: '600', cursor: 'pointer', marginTop: '10px' };
