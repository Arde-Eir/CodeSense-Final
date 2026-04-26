// AdminPanel.tsx — Tabler-based admin dashboard
// Loads Tabler CSS from CDN on mount, removes it on unmount to avoid style bleed.
import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './components/AuthScreen'
import { supabase } from './services/supabase'
import type { ExplorerProfile } from './types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminUser {
  id: string
  playername: string
  email: string
  totalxp: number
  currentlevel: number
  charactertype: string
  user_type: string | null
  is_admin: boolean
  is_banned: boolean
  ban_reason: string | null
  createdat: string
  lastactive: string
  sandbox_runs: number
}

interface AuditEntry {
  id: string
  admin_id: string
  target_user_id: string | null
  action: string
  details: any
  created_at: string
  admin?: { playername: string }
  target?: { playername: string }
}

interface Announcement {
  id: string
  title: string
  body: string
  priority: 'info' | 'warning' | 'success' | 'critical'
  author: string
  ispinned: boolean
  createdat: string
}

type Tab = 'dashboard' | 'users' | 'audit' | 'maintenance' | 'announcements'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

async function writeAuditLog(
  adminId: string,
  action: string,
  targetUserId?: string,
  details?: object
) {
  const { error } = await supabase.from('admin_audit_log').insert({
    admin_id: adminId,
    target_user_id: targetUserId ?? null,
    action,
    details: details ?? null,
  })
  if (error) console.warn('[audit log]', action, error.message)
}

// ─── Main component ───────────────────────────────────────────────────────────

export const AdminPanel: React.FC = () => {
  const navigate = useNavigate()
  const { user, startImpersonation, refreshMaintenanceMode } = useAuth()

  const [tab, setTab] = useState<Tab>('dashboard')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [filteredUsers, setFilteredUsers] = useState<AdminUser[]>([])
  const [userSearch, setUserSearch] = useState('')
  const [userFilter, setUserFilter] = useState<'all' | 'active' | 'banned' | 'admin'>('all')
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [maintenanceOn, setMaintenanceOn] = useState(false)
  const [maintenanceMsg, setMaintenanceMsg] = useState('')
  const [stats, setStats] = useState({ total: 0, active: 0, banned: 0, admins: 0 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // New announcement form
  const [newAnn, setNewAnn] = useState({ title: '', body: '', priority: 'info' as Announcement['priority'], ispinned: false })

  // ── Tabler CSS injection ──
  useEffect(() => {
    const CSS_ID = 'tabler-admin-css'
    const ICON_ID = 'tabler-admin-icons'
    const addLink = (id: string, href: string) => {
      if (!document.getElementById(id)) {
        const link = document.createElement('link')
        link.id = id; link.rel = 'stylesheet'; link.href = href
        document.head.appendChild(link)
      }
    }
    addLink(CSS_ID, 'https://cdn.jsdelivr.net/npm/@tabler/core@1.0.0-beta20/dist/css/tabler.min.css')
    addLink(ICON_ID, 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css')
    return () => {
      [CSS_ID, ICON_ID].forEach(id => document.getElementById(id)?.remove())
    }
  }, [])

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  // Schema health — lets the UI tell the user which tables/columns are missing
  const [schemaIssues, setSchemaIssues] = useState<string[]>([])
  const addIssue = (msg: string) =>
    setSchemaIssues(prev => prev.includes(msg) ? prev : [...prev, msg])

  // ── Data fetchers ──────────────────────────────────────────────────────────
  const fetchUsers = useCallback(async () => {
    const { data, error } = await supabase
      .from('users')
      .select('id, playername, email, totalxp, currentlevel, charactertype, user_type, is_admin, is_banned, ban_reason, createdat, lastactive, sandbox_runs')
      .order('createdat', { ascending: false })
    if (error) {
      console.warn('[fetchUsers]', error.message)
      addIssue(`users table: ${error.message}`)
      return
    }
    if (data) {
      setUsers(data as AdminUser[])
      setStats({
        total:   data.length,
        active:  data.filter(u => !u.is_banned).length,
        banned:  data.filter(u => u.is_banned).length,
        admins:  data.filter(u => u.is_admin).length,
      })
    }
  }, [])

  const fetchAuditLogs = useCallback(async () => {
    // Try with FK joins first; fall back to plain select if the joins aren't set up.
    let { data, error } = await supabase
      .from('admin_audit_log')
      .select('*, admin:admin_id(playername), target:target_user_id(playername)')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) {
      const plain = await supabase
        .from('admin_audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)
      if (plain.error) {
        console.warn('[fetchAuditLogs]', plain.error.message)
        addIssue(`admin_audit_log table: ${plain.error.message}`)
        return
      }
      data = plain.data
    }
    if (data) setAuditLogs(data as AuditEntry[])
  }, [])

  const fetchMaintenance = useCallback(async () => {
    const { data, error } = await supabase
      .from('system_settings')
      .select('key, value')
      .in('key', ['maintenance_mode', 'maintenance_message'])
    if (error) {
      console.warn('[fetchMaintenance]', error.message)
      addIssue(`system_settings table: ${error.message}`)
      return
    }
    if (data) {
      for (const row of data) {
        if (row.key === 'maintenance_mode') setMaintenanceOn(row.value === true || row.value === 'true')
        if (row.key === 'maintenance_message') setMaintenanceMsg(
          typeof row.value === 'string' ? row.value.replace(/^"|"$/g, '') : ''
        )
      }
    }
  }, [])

  const fetchAnnouncements = useCallback(async () => {
    const { data, error } = await supabase
      .from('announcements')
      .select('*')
      .order('createdat', { ascending: false })
    if (error) {
      console.warn('[fetchAnnouncements]', error.message)
      addIssue(`announcements table: ${error.message}`)
      return
    }
    if (data) setAnnouncements(data as Announcement[])
  }, [])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      await Promise.all([fetchUsers(), fetchAuditLogs(), fetchMaintenance(), fetchAnnouncements()])
      setLoading(false)
    }
    load()
  }, [fetchUsers, fetchAuditLogs, fetchMaintenance, fetchAnnouncements])

  // ── User filtering ─────────────────────────────────────────────────────────
  useEffect(() => {
    let list = users
    if (userFilter === 'active')  list = list.filter(u => !u.is_banned)
    if (userFilter === 'banned')  list = list.filter(u => u.is_banned)
    if (userFilter === 'admin')   list = list.filter(u => u.is_admin)
    if (userSearch.trim()) {
      const q = userSearch.toLowerCase()
      list = list.filter(u => u.playername.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q))
    }
    setFilteredUsers(list)
  }, [users, userFilter, userSearch])

  // ── Actions ────────────────────────────────────────────────────────────────
  // Helper: returns count of rows actually changed — detects silent RLS denial.
  const adminUpdate = async (targetId: string, changes: Record<string, any>): Promise<{ ok: boolean; msg: string }> => {
    const { data, error } = await supabase
      .from('users').update(changes).eq('id', targetId).select('id')
    if (error) return { ok: false, msg: error.message }
    if (!data || data.length === 0) {
      return { ok: false, msg: 'Update silently blocked — likely missing an admin RLS UPDATE policy on the users table.' }
    }
    return { ok: true, msg: '' }
  }

  const banUser = async (target: AdminUser, reason: string) => {
    if (!user) return
    setSaving(true)
    const res = await adminUpdate(target.id, { is_banned: true, ban_reason: reason, banned_at: new Date().toISOString() })
    if (!res.ok) {
      console.warn('[banUser]', res.msg)
      showToast(`Ban failed: ${res.msg}`, 'error')
    } else {
      await writeAuditLog(user.id, 'ban', target.id, { reason, playername: target.playername })
      showToast(`${target.playername} has been banned`)
      await fetchUsers()
      await fetchAuditLogs()
    }
    setSaving(false)
  }

  const unbanUser = async (target: AdminUser) => {
    if (!user) return
    setSaving(true)
    const res = await adminUpdate(target.id, { is_banned: false, ban_reason: null, banned_at: null })
    if (!res.ok) {
      console.warn('[unbanUser]', res.msg)
      showToast(`Unban failed: ${res.msg}`, 'error')
    } else {
      await writeAuditLog(user.id, 'unban', target.id, { playername: target.playername })
      showToast(`${target.playername} has been unbanned`)
      await fetchUsers()
      await fetchAuditLogs()
    }
    setSaving(false)
  }

  const toggleAdmin = async (target: AdminUser) => {
    if (!user || target.id === user.id) return
    setSaving(true)
    const next = !target.is_admin
    const res = await adminUpdate(target.id, { is_admin: next })
    if (!res.ok) {
      console.warn('[toggleAdmin]', res.msg)
      showToast(`Failed: ${res.msg}`, 'error')
    } else {
      await writeAuditLog(user.id, next ? 'grant_admin' : 'revoke_admin', target.id, { playername: target.playername })
      showToast(`${target.playername} admin status ${next ? 'granted' : 'revoked'}`)
      await fetchUsers()
    }
    setSaving(false)
  }

  const handleImpersonate = async (target: AdminUser) => {
    if (!user) return
    const { data: profileRow, error } = await supabase.from('users').select('*').eq('id', target.id).maybeSingle()
    if (error) {
      console.warn('[handleImpersonate]', error.message)
      showToast(`Preview failed: ${error.message}`, 'error'); return
    }
    if (!profileRow) {
      showToast('Preview failed: target profile not returned — likely blocked by RLS SELECT policy.', 'error'); return
    }
    const targetProfile: ExplorerProfile = {
      id: profileRow.id, playerName: profileRow.playername, secretCode: '***',
      email: profileRow.email, totalXP: profileRow.totalxp,
      currentLevel: (profileRow.currentlevel ?? 1) as 1 | 2 | 3 | 4 | 5,
      characterType: (profileRow.charactertype ?? 'squire') as ExplorerProfile['characterType'],
      userType: (profileRow.user_type ?? 'student') as 'student' | 'professional',
      isAdmin: false, isBanned: profileRow.is_banned ?? false,
      createdAt: new Date(profileRow.createdat), lastActive: new Date(profileRow.lastactive),
    }
    await writeAuditLog(user.id, 'impersonate', target.id, { playername: target.playername })
    startImpersonation(targetProfile)
    navigate('/home')
  }

  const saveMaintenance = async () => {
    if (!user) return
    setSaving(true)
    const [r1, r2] = await Promise.all([
      supabase.from('system_settings').upsert(
        { key: 'maintenance_mode',    value: String(maintenanceOn) },
        { onConflict: 'key' }
      ),
      supabase.from('system_settings').upsert(
        { key: 'maintenance_message', value: maintenanceMsg },
        { onConflict: 'key' }
      ),
    ])
    if (r1.error || r2.error) {
      const msg = r1.error?.message ?? r2.error?.message ?? 'unknown'
      console.warn('[saveMaintenance]', msg)
      showToast(`Failed to save maintenance: ${msg}`, 'error')
    } else {
      await writeAuditLog(user.id, maintenanceOn ? 'maintenance_on' : 'maintenance_off', undefined, { message: maintenanceMsg })
      await refreshMaintenanceMode()
      showToast(`Maintenance mode ${maintenanceOn ? 'enabled' : 'disabled'}`)
    }
    setSaving(false)
  }

  const createAnnouncement = async () => {
    if (!user || !newAnn.title.trim() || !newAnn.body.trim()) {
      showToast('Title and body are required', 'error'); return
    }
    const { error } = await supabase.from('announcements').insert({
      title: newAnn.title.trim(), body: newAnn.body.trim(),
      priority: newAnn.priority, ispinned: newAnn.ispinned,
      author: user.playerName,
    })
    if (error) { showToast(`Failed: ${error.message}`, 'error') }
    else {
      await writeAuditLog(user.id, 'announcement_create', undefined, { title: newAnn.title })
      setNewAnn({ title: '', body: '', priority: 'info', ispinned: false })
      showToast('Announcement published')
      await fetchAnnouncements()
    }
  }

  const deleteAnnouncement = async (id: string, title: string) => {
    if (!user) return
    if (!window.confirm(`Delete "${title}"?`)) return
    await supabase.from('announcements').delete().eq('id', id)
    await writeAuditLog(user.id, 'announcement_delete', undefined, { title })
    showToast('Announcement deleted')
    await fetchAnnouncements()
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b949e' }}>
        Loading admin panel...
      </div>
    )
  }

  const PRIORITY_COLOR: Record<string, string> = {
    info: 'blue', warning: 'yellow', success: 'green', critical: 'red',
  }

  const tabItems: { id: Tab; icon: string; label: string }[] = [
    { id: 'dashboard',     icon: 'ti ti-dashboard',      label: 'Dashboard'     },
    { id: 'users',         icon: 'ti ti-users',          label: 'Users'         },
    { id: 'audit',         icon: 'ti ti-clipboard-list', label: 'Audit Logs'    },
    { id: 'maintenance',   icon: 'ti ti-settings',       label: 'Maintenance'   },
    { id: 'announcements', icon: 'ti ti-speakerphone',   label: 'Announcements' },
  ]

  return (
    <div className="antialiased" style={{ minHeight: '100vh', background: '#f0f4f8' }}>

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          background: toast.type === 'success' ? '#2fb344' : '#d63939',
          color: 'white', padding: '12px 20px', borderRadius: '8px',
          fontSize: '13px', fontWeight: '600', boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
          animation: 'fadeSlideDown 0.2s ease',
        }}>
          {toast.type === 'success' ? '✓ ' : '⚠ '}{toast.msg}
        </div>
      )}

      <div className="wrapper">
        {/* ── Sidebar ── */}
        <aside className="navbar navbar-vertical navbar-expand-lg navbar-dark" style={{ background: '#1a2233' }}>
          <div className="container-fluid">
            <button className="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbar-menu">
              <span className="navbar-toggler-icon" />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 0' }}>
              <span style={{ fontSize: '22px' }}>🧠</span>
              <span style={{ color: 'white', fontWeight: '700', fontSize: '16px' }}>CodeSense Admin</span>
            </div>

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '8px 0', padding: '12px 0' }}>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', padding: '0 8px 6px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Navigation
              </div>
              {tabItems.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '10px 12px', background: tab === t.id ? 'rgba(255,255,255,0.12)' : 'transparent',
                    border: 'none', borderRadius: '6px', color: tab === t.id ? 'white' : 'rgba(255,255,255,0.65)',
                    fontSize: '13px', fontWeight: tab === t.id ? '700' : '400',
                    cursor: 'pointer', marginBottom: '2px', textAlign: 'left',
                    transition: 'all 0.15s',
                  }}
                >
                  <i className={t.icon} style={{ fontSize: '18px', width: '20px' }} />
                  {t.label}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px' }}>
              <button onClick={() => navigate('/home')}
                style={{ width: '100%', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: '12px', cursor: 'pointer', textAlign: 'left', padding: '8px 12px' }}>
                ← Back to App
              </button>
            </div>
          </div>
        </aside>

        {/* ── Main content ── */}
        <div className="page-wrapper">
          <div className="page-header">
            <div className="container-xl">
              <div className="row align-items-center">
                <div className="col-auto">
                  <h2 className="page-title">
                    {tabItems.find(t => t.id === tab)?.label}
                  </h2>
                  <div className="text-muted mt-1" style={{ fontSize: '12px' }}>
                    Logged in as <strong>{user?.playerName}</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="page-body">
            <div className="container-xl">

              {/* ── Schema health banner (shown when DB is missing tables/columns) ── */}
              {schemaIssues.length > 0 && (
                <div style={{
                  background: 'rgba(214, 57, 57, 0.08)',
                  border: '1px solid rgba(214, 57, 57, 0.3)',
                  borderRadius: '8px', padding: '12px 16px', marginBottom: '16px',
                }}>
                  <div style={{ fontWeight: '700', color: '#d63939', fontSize: '13px', marginBottom: '6px' }}>
                    ⚠️ Database schema issues detected — some features won't work until you run the migration SQL:
                  </div>
                  <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px', fontSize: '12px', color: '#6b7280' }}>
                    {schemaIssues.map((i, idx) => <li key={idx}>{i}</li>)}
                  </ul>
                </div>
              )}

              {/* ── DASHBOARD ── */}
              {tab === 'dashboard' && (
                <>
                  <div className="row row-cards">
                    {[
                      { label: 'Total Users',  value: stats.total,  icon: 'ti ti-users',         color: 'blue'   },
                      { label: 'Active Users', value: stats.active, icon: 'ti ti-user-check',    color: 'green'  },
                      { label: 'Banned Users', value: stats.banned, icon: 'ti ti-user-off',      color: 'red'    },
                      { label: 'Admins',       value: stats.admins, icon: 'ti ti-shield-check',  color: 'purple' },
                    ].map(s => (
                      <div key={s.label} className="col-sm-6 col-lg-3">
                        <div className="card">
                          <div className="card-body">
                            <div className="d-flex align-items-center">
                              <div className={`me-3 text-${s.color}`}>
                                <i className={s.icon} style={{ fontSize: '32px' }} />
                              </div>
                              <div>
                                <div style={{ fontSize: '28px', fontWeight: '700', color: '#1a2233' }}>{s.value}</div>
                                <div className="text-muted" style={{ fontSize: '12px' }}>{s.label}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="row mt-3">
                    <div className="col-12">
                      <div className="card">
                        <div className="card-header"><h3 className="card-title">Recent Activity</h3></div>
                        <div className="table-responsive">
                          <table className="table table-vcenter card-table">
                            <thead>
                              <tr>
                                <th>Action</th><th>Admin</th><th>Target</th><th>Time</th>
                              </tr>
                            </thead>
                            <tbody>
                              {auditLogs.slice(0, 10).map(log => (
                                <tr key={log.id}>
                                  <td><span className="badge bg-blue-lt">{log.action}</span></td>
                                  <td>{(log.admin as any)?.playername ?? log.admin_id?.slice(0, 8)}</td>
                                  <td>{(log.target as any)?.playername ?? (log.target_user_id ? log.target_user_id.slice(0, 8) : '—')}</td>
                                  <td className="text-muted">{fmt(log.created_at)}</td>
                                </tr>
                              ))}
                              {auditLogs.length === 0 && (
                                <tr><td colSpan={4} className="text-center text-muted py-3">No audit entries yet</td></tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* ── USERS ── */}
              {tab === 'users' && (
                <div className="card">
                  <div className="card-header">
                    <h3 className="card-title">User Management</h3>
                    <div className="card-options" style={{ gap: '8px', display: 'flex', alignItems: 'center' }}>
                      <input
                        type="text" className="form-control form-control-sm"
                        placeholder="Search users..." value={userSearch}
                        onChange={e => setUserSearch(e.target.value)}
                        style={{ width: '200px' }}
                      />
                      <select className="form-select form-select-sm" value={userFilter}
                        onChange={e => setUserFilter(e.target.value as any)} style={{ width: '130px' }}>
                        <option value="all">All Users</option>
                        <option value="active">Active</option>
                        <option value="banned">Banned</option>
                        <option value="admin">Admins</option>
                      </select>
                    </div>
                  </div>
                  <div className="table-responsive">
                    <table className="table table-vcenter card-table table-striped">
                      <thead>
                        <tr>
                          <th>Player</th><th>Email</th><th>Type</th><th>Level</th><th>XP</th>
                          <th>Status</th><th>Joined</th><th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUsers.map(u => (
                          <tr key={u.id}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#206bc4', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: '700', fontSize: '14px', flexShrink: 0 }}>
                                  {u.playername.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <strong>{u.playername}</strong>
                                  {u.is_admin && <span className="badge bg-purple-lt ms-1" style={{ fontSize: '10px' }}>admin</span>}
                                </div>
                              </div>
                            </td>
                            <td className="text-muted" style={{ fontSize: '12px' }}>{u.email}</td>
                            <td>
                              <span className={`badge bg-${u.user_type === 'professional' ? 'azure' : 'teal'}-lt`} style={{ textTransform: 'capitalize' }}>
                                {u.user_type ?? 'student'}
                              </span>
                            </td>
                            <td>{u.currentlevel}</td>
                            <td>{u.totalxp}</td>
                            <td>
                              {u.is_banned
                                ? <span className="badge bg-red">Banned</span>
                                : <span className="badge bg-green">Active</span>
                              }
                            </td>
                            <td className="text-muted" style={{ fontSize: '11px' }}>{fmt(u.createdat)}</td>
                            <td>
                              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                {u.is_banned ? (
                                  <button className="btn btn-sm btn-success" disabled={saving}
                                    onClick={() => unbanUser(u)}>Unban</button>
                                ) : (
                                  <button className="btn btn-sm btn-danger" disabled={saving || u.id === user?.id}
                                    onClick={() => {
                                      const reason = window.prompt(`Ban reason for ${u.playername}:`)
                                      if (reason !== null) banUser(u, reason)
                                    }}>Ban</button>
                                )}
                                {u.id !== user?.id && (
                                  <button className="btn btn-sm btn-warning" disabled={saving}
                                    onClick={() => toggleAdmin(u)}>
                                    {u.is_admin ? 'Revoke Admin' : 'Make Admin'}
                                  </button>
                                )}
                                <button className="btn btn-sm btn-secondary" disabled={saving || u.id === user?.id}
                                  onClick={() => handleImpersonate(u)}>
                                  Preview
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {filteredUsers.length === 0 && (
                          <tr><td colSpan={8} className="text-center text-muted py-4">No users found</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="card-footer text-muted" style={{ fontSize: '12px' }}>
                    {filteredUsers.length} of {users.length} users
                  </div>
                </div>
              )}

              {/* ── AUDIT LOGS ── */}
              {tab === 'audit' && (
                <div className="card">
                  <div className="card-header">
                    <h3 className="card-title">Admin Audit Log</h3>
                    <div className="card-options">
                      <button className="btn btn-sm btn-outline-primary" onClick={fetchAuditLogs}>
                        <i className="ti ti-refresh me-1" />Refresh
                      </button>
                    </div>
                  </div>
                  <div className="table-responsive">
                    <table className="table table-vcenter card-table">
                      <thead>
                        <tr>
                          <th>Action</th><th>Admin</th><th>Target User</th><th>Details</th><th>Timestamp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLogs.map(log => (
                          <tr key={log.id}>
                            <td>
                              <span className={`badge bg-${
                                log.action.includes('ban') ? 'red' :
                                log.action.includes('admin') ? 'purple' :
                                log.action.includes('maintenance') ? 'orange' :
                                log.action.includes('impersonat') ? 'yellow' : 'blue'
                              }-lt`}>
                                {log.action}
                              </span>
                            </td>
                            <td>{(log.admin as any)?.playername ?? '—'}</td>
                            <td>{(log.target as any)?.playername ?? (log.target_user_id ? `…${log.target_user_id.slice(-6)}` : '—')}</td>
                            <td className="text-muted" style={{ fontSize: '11px', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {log.details ? JSON.stringify(log.details) : '—'}
                            </td>
                            <td className="text-muted" style={{ fontSize: '11px' }}>{fmt(log.created_at)}</td>
                          </tr>
                        ))}
                        {auditLogs.length === 0 && (
                          <tr><td colSpan={5} className="text-center text-muted py-4">No audit entries yet</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── MAINTENANCE ── */}
              {tab === 'maintenance' && (
                <div className="row">
                  <div className="col-md-6">
                    <div className="card">
                      <div className="card-header"><h3 className="card-title">Maintenance Mode</h3></div>
                      <div className="card-body">
                        <div className="mb-3">
                          <label className="form-check form-switch">
                            <input className="form-check-input" type="checkbox" role="switch"
                              checked={maintenanceOn} onChange={e => setMaintenanceOn(e.target.checked)} />
                            <span className="form-check-label">
                              {maintenanceOn
                                ? <span className="text-danger fw-bold">Maintenance mode is ON</span>
                                : <span className="text-success fw-bold">System is operational</span>}
                            </span>
                          </label>
                          <div className="text-muted mt-1" style={{ fontSize: '12px' }}>
                            When enabled, a banner is shown to all non-admin users. Logins are still permitted.
                          </div>
                        </div>

                        <div className="mb-3">
                          <label className="form-label">Maintenance Message</label>
                          <textarea className="form-control" rows={3} value={maintenanceMsg}
                            onChange={e => setMaintenanceMsg(e.target.value)}
                            placeholder="Message shown to users during maintenance..." />
                        </div>

                        {maintenanceOn && (
                          <div className="alert alert-warning">
                            <i className="ti ti-alert-triangle me-2" />
                            <strong>Warning:</strong> Maintenance mode is currently active. All non-admin users will see a maintenance banner.
                          </div>
                        )}

                        <button className="btn btn-primary" disabled={saving} onClick={saveMaintenance}>
                          {saving ? 'Saving…' : 'Save Settings'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="col-md-6">
                    <div className="card">
                      <div className="card-header"><h3 className="card-title">Preview</h3></div>
                      <div className="card-body">
                        <div style={{
                          padding: '14px 18px', borderRadius: '8px',
                          background: maintenanceOn ? 'rgba(255, 167, 38, 0.12)' : 'rgba(76,175,80,0.1)',
                          border: `1px solid ${maintenanceOn ? 'rgba(255,167,38,0.4)' : 'rgba(76,175,80,0.3)'}`,
                        }}>
                          <div style={{ fontSize: '14px', fontWeight: '700', marginBottom: '6px', color: maintenanceOn ? '#b45309' : '#166534' }}>
                            {maintenanceOn ? '🔧 System Maintenance' : '✅ System Operational'}
                          </div>
                          <div style={{ fontSize: '13px', color: '#6b7280' }}>
                            {maintenanceOn
                              ? (maintenanceMsg || 'System is temporarily offline for scheduled maintenance.')
                              : 'All systems are running normally.'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── ANNOUNCEMENTS ── */}
              {tab === 'announcements' && (
                <div className="row">
                  <div className="col-md-5">
                    <div className="card">
                      <div className="card-header"><h3 className="card-title">New Announcement</h3></div>
                      <div className="card-body">
                        <div className="mb-3">
                          <label className="form-label">Title</label>
                          <input type="text" className="form-control" value={newAnn.title}
                            onChange={e => setNewAnn(p => ({ ...p, title: e.target.value }))}
                            placeholder="Announcement title" maxLength={120} />
                        </div>
                        <div className="mb-3">
                          <label className="form-label">Body</label>
                          <textarea className="form-control" rows={4} value={newAnn.body}
                            onChange={e => setNewAnn(p => ({ ...p, body: e.target.value }))}
                            placeholder="Announcement content..." />
                        </div>
                        <div className="mb-3">
                          <label className="form-label">Priority</label>
                          <select className="form-select" value={newAnn.priority}
                            onChange={e => setNewAnn(p => ({ ...p, priority: e.target.value as any }))}>
                            <option value="info">ℹ️ Info</option>
                            <option value="success">✅ Success</option>
                            <option value="warning">⚠️ Warning</option>
                            <option value="critical">🚨 Critical</option>
                          </select>
                        </div>
                        <div className="mb-3">
                          <label className="form-check">
                            <input type="checkbox" className="form-check-input" checked={newAnn.ispinned}
                              onChange={e => setNewAnn(p => ({ ...p, ispinned: e.target.checked }))} />
                            <span className="form-check-label">📌 Pin to top</span>
                          </label>
                        </div>
                        <button className="btn btn-primary w-100" onClick={createAnnouncement}>
                          Publish Announcement
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="col-md-7">
                    <div className="card">
                      <div className="card-header"><h3 className="card-title">Published Announcements</h3></div>
                      <div className="list-group list-group-flush">
                        {announcements.map(ann => (
                          <div key={ann.id} className="list-group-item">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                  {ann.ispinned && <span style={{ fontSize: '11px' }}>📌</span>}
                                  <span className={`badge bg-${PRIORITY_COLOR[ann.priority]}-lt`}>{ann.priority}</span>
                                  <strong style={{ fontSize: '13px' }}>{ann.title}</strong>
                                </div>
                                <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 4px', lineHeight: 1.5 }}>
                                  {ann.body.slice(0, 120)}{ann.body.length > 120 ? '…' : ''}
                                </p>
                                <small className="text-muted">{fmt(ann.createdat)} · {ann.author}</small>
                              </div>
                              <button className="btn btn-sm btn-ghost-danger ms-3"
                                onClick={() => deleteAnnouncement(ann.id, ann.title)}>
                                <i className="ti ti-trash" />
                              </button>
                            </div>
                          </div>
                        ))}
                        {announcements.length === 0 && (
                          <div className="text-center text-muted py-4" style={{ fontSize: '13px' }}>
                            No announcements published yet
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
