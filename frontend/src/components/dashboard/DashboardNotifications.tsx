import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/services/supabase'
import {
  countUniqueCompletedQuests,
  isCompletedMissionRow,
  missionDoneAt,
  type CompletedMissionRow,
} from './dashboardMetrics'

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

interface QuestNotificationRow extends CompletedMissionRow {
  hintsused?: number | null
  quests?: { title?: string | null } | Array<{ title?: string | null }> | null
}

interface AdminNotificationRow {
  id: string
  action: string
  details: unknown
  created_at: string
}

interface NotificationFilter {
  key: 'all' | NotifKind
  label: string
  count: number
}

const detailReason = (details: unknown): string | null => {
  if (typeof details !== 'object' || details === null || !('reason' in details)) return null
  return typeof details.reason === 'string' ? details.reason : null
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

export const NotificationBell: React.FC<{ userId: string | undefined; onViewAllAnnouncements: () => void }> = ({ userId, onViewAllAnnouncements }) => {
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
        const completedQuests = ((quests ?? []) as QuestNotificationRow[])
          .filter(isCompletedMissionRow)
          .filter(q => Boolean(missionDoneAt(q)))
          .sort((a, b) => new Date(missionDoneAt(b)!).getTime() - new Date(missionDoneAt(a)!).getTime())
          .slice(0, 10)
        for (const q of completedQuests) {
          const completedAt = missionDoneAt(q)!
          const title = Array.isArray(q.quests) ? q.quests[0]?.title : q.quests?.title
          const hintsUsed = q.hintsused ?? 0
          out.push({
            id: `quest:${q.questid}:${completedAt}`, kind: 'quest',
            icon: '⚔️', color: '#ffa726',
            title: `Quest completed: ${title ?? 'Unknown'}`,
            body: hintsUsed > 0 ? `Used ${hintsUsed} hint${hintsUsed > 1 ? 's' : ''}.` : 'No hints used. Clean clear.',
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
        for (const e of (adminEvents ?? []) as AdminNotificationRow[]) {
          const meta = ADMIN_ACTION_META[e.action] ?? { icon: '🛡', color: '#58a6ff', title: e.action }
          const reason = detailReason(e.details)
          out.push({
            id: `admin:${e.id}`, kind: 'admin',
            icon: meta.icon, color: meta.color,
            title: meta.title,
            body: reason ? `Reason: ${reason}` : 'Account activity recorded.',
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
            quests: countUniqueCompletedQuests((progressRows ?? []) as CompletedMissionRow[]),
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
    } catch (err: unknown) {
      if (refreshRunRef.current !== runId) return
      const message = err instanceof Error ? err.message : 'Failed to load notifications'
      console.error('Notification refresh failed', { userId, error: message })
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
  const filters: NotificationFilter[] = [
    { key: 'all', label: 'All', count: items.length },
    { key: 'announcement', label: '📢', count: countByKind('announcement') },
    { key: 'quest', label: '⚔️ Quests', count: countByKind('quest') },
    { key: 'achievement', label: '🏅 Badges', count: countByKind('achievement') },
    { key: 'rank', label: '👑 Ranks', count: countByKind('rank') },
    { key: 'admin', label: '🛡 Admin', count: countByKind('admin') },
  ]

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
              {filters.map(f => {
                const active = activeFilter === f.key
                return (
                  <button
                    key={f.key}
                    onClick={() => setActiveFilter(f.key)}
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
export const AnnouncementsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
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
      } catch (error: unknown) {
        setError(error instanceof Error ? error.message : 'Failed to load announcements')
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
