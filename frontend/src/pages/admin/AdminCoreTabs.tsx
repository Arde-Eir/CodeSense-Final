import React, { useState } from 'react'
import type { ProfileImageUrls } from '@/services/ProfileImages'
import { PlayerDetailModal } from '@/components/PlayerDetailModal'
import {
  fmt,
  type AdminUser,
  type Announcement,
  type AuditEntry,
} from '@/admin/adminPanelModel'

interface AdminStats {
  total: number
  active: number
  banned: number
  admins: number
}

type UserFilter = 'all' | 'active' | 'banned' | 'admin'

interface AnnouncementDraft {
  title: string
  body: string
  priority: Announcement['priority']
  ispinned: boolean
}

const PRIORITY_COLOR: Record<Announcement['priority'], string> = {
  info: 'blue',
  warning: 'orange',
  success: 'green',
  critical: 'red',
}

const parseUserFilter = (value: string): UserFilter => {
  if (value === 'active' || value === 'banned' || value === 'admin') return value
  return 'all'
}

const parseAnnouncementPriority = (value: string): Announcement['priority'] => {
  if (value === 'warning' || value === 'success' || value === 'critical') return value
  return 'info'
}

export const AdminDashboardTab: React.FC<{
  stats: AdminStats
  auditLogs: AuditEntry[]
}> = ({ stats, auditLogs }) => (
<>
                  <div className="row row-cards">
                    {[
                      { label: 'Total Users',  value: stats.total,  icon: 'ti ti-users',         color: 'blue'   },
                      { label: 'Not Banned',   value: stats.active, icon: 'ti ti-user-check',    color: 'green'  },
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
                                  <td><span className={`badge bg-${
                                    log.action.includes('ban')         ? 'red'    :
                                    log.action.includes('admin')       ? 'purple' :
                                    log.action.includes('maintenance') ? 'orange' :
                                    log.action.includes('impersonat')  ? 'yellow' : 'blue'
                                  }-lt`}>{log.action}</span></td>
                                  <td>{log.admin?.playername ?? log.admin_id?.slice(0, 8)}</td>
                                  <td>{log.target?.playername ?? (log.target_user_id ? log.target_user_id.slice(0, 8) : '—')}</td>
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
)

export const AdminUsersTab: React.FC<{
  userSearch: string
  setUserSearch: (value: string) => void
  userFilter: UserFilter
  setUserFilter: (value: UserFilter) => void
  filteredUsers: AdminUser[]
  userImages: Map<string, ProfileImageUrls>
  loading: boolean
  page: number
  resultCount: number
  setPage: (page: number) => void
  saving: boolean
  currentUserId: string | undefined
  userCount: number
  banUser: (user: AdminUser, reason: string) => Promise<void>
  unbanUser: (user: AdminUser) => Promise<void>
  toggleAdmin: (user: AdminUser) => Promise<void>
  requestLiveHelp: (user: AdminUser) => Promise<void>
}> = ({
  userSearch, setUserSearch, userFilter, setUserFilter, filteredUsers,
  userImages, loading, page, resultCount, setPage, saving, currentUserId, userCount, banUser, unbanUser,
  toggleAdmin, requestLiveHelp,
}) => {
  const [previewUserId, setPreviewUserId] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<{ kind: 'ban' | 'unban' | 'admin'; user: AdminUser } | null>(null)
  const [banReason, setBanReason] = useState('')
  const confirmAction = async () => {
    if (!pendingAction) return
    if (pendingAction.kind === 'ban') {
      if (!banReason.trim()) return
      await banUser(pendingAction.user, banReason.trim())
    } else if (pendingAction.kind === 'unban') {
      await unbanUser(pendingAction.user)
    } else {
      await toggleAdmin(pendingAction.user)
    }
    setPendingAction(null)
    setBanReason('')
  }

  return (
<>
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
                        onChange={e => setUserFilter(parseUserFilter(e.target.value))} style={{ width: '130px' }}>
                        <option value="all">All Users</option>
                        <option value="active">Not banned</option>
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
                          <th>Status</th><th>Joined</th><th>Last Active</th><th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUsers.map(u => {
                          const avatarUrl = userImages.get(u.id)?.avatarUrl ?? null
                          return (
                          <tr key={u.id}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#206bc4', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: '700', fontSize: '14px', flexShrink: 0, overflow: 'hidden' }}>
                                  {avatarUrl
                                    ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    : u.playername.charAt(0).toUpperCase()}
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
                                : <span className="badge bg-green">Not banned</span>
                              }
                            </td>
                            <td className="text-muted" style={{ fontSize: '11px' }}>{fmt(u.createdat)}</td>
                            <td className="text-muted" style={{ fontSize: '11px' }}>{u.lastactive ? fmt(u.lastactive) : '—'}</td>
                            <td>
                              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                {u.is_banned ? (
                                  <button className="btn btn-sm btn-success" disabled={saving}
                                    onClick={() => setPendingAction({ kind: 'unban', user: u })}>Unban</button>
                                ) : (
                                  <button className="btn btn-sm btn-danger" disabled={saving || u.id === currentUserId}
                                    onClick={() => setPendingAction({ kind: 'ban', user: u })}>Ban</button>
                                )}
                                {u.id !== currentUserId && (
                                  <button className="btn btn-sm btn-warning" disabled={saving}
                                    onClick={() => setPendingAction({ kind: 'admin', user: u })}>
                                    {u.is_admin ? 'Revoke Admin' : 'Make Admin'}
                                  </button>
                                )}
                                <button className="btn btn-sm btn-secondary" data-testid={`admin-progress-${u.id}`} disabled={saving}
                                  onClick={() => setPreviewUserId(u.id)}>
                                  Progress Snapshot
                                </button>
                                <button className="btn btn-sm btn-outline-primary" data-testid={`admin-live-help-${u.id}`} disabled={saving || u.is_banned || u.is_admin || u.id === currentUserId}
                                  onClick={() => requestLiveHelp(u)}>
                                  Live Preview & Help
                                </button>
                              </div>
                            </td>
                          </tr>
                        )})}
                        {filteredUsers.length === 0 && (
                          <tr><td colSpan={9} className="text-center text-muted py-4">{loading ? 'Loading users…' : 'No users found'}</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="card-footer text-muted d-flex justify-content-between align-items-center" style={{ fontSize: '12px' }}>
                    <span>{resultCount === 0 ? 0 : page * 25 + 1}–{Math.min((page + 1) * 25, resultCount)} of {resultCount} matching users ({userCount} total)</span>
                    <span className="d-flex gap-2">
                      <button type="button" className="btn btn-sm" disabled={loading || page === 0} onClick={() => setPage(page - 1)}>Previous</button>
                      <button type="button" className="btn btn-sm" disabled={loading || (page + 1) * 25 >= resultCount} onClick={() => setPage(page + 1)}>Next</button>
                    </span>
                  </div>
                </div>
  {previewUserId && (
    <PlayerDetailModal
      userId={previewUserId}
      currentUserId={currentUserId}
      showAllProgress={true}
      onClose={() => setPreviewUserId(null)}
    />
  )}
  {pendingAction && <div role="dialog" aria-modal="true" aria-labelledby="admin-user-action-title"
    onKeyDown={event => { if (event.key === 'Escape') setPendingAction(null) }}
    style={{ position: 'fixed', inset: 0, zIndex: 20000, background: '#0009', display: 'grid', placeItems: 'center', padding: 16 }}>
    <div className="card" style={{ width: 'min(100%, 460px)' }}>
      <div className="card-body">
        <h3 id="admin-user-action-title">{pendingAction.kind === 'ban' ? 'Ban' : pendingAction.kind === 'unban' ? 'Unban' : pendingAction.user.is_admin ? 'Revoke admin access from' : 'Grant admin access to'} {pendingAction.user.playername}?</h3>
        <p className="text-muted">{pendingAction.kind === 'ban'
          ? 'This prevents the learner from signing in until unbanned.'
          : pendingAction.kind === 'unban'
            ? 'This restores account access.'
            : pendingAction.user.is_admin
              ? 'This removes access to all administrator controls.'
              : 'This grants full administrator controls, including user management.'}</p>
        {pendingAction.kind === 'ban' && <label className="form-label" htmlFor="admin-ban-reason">Reason required
          <textarea id="admin-ban-reason" className="form-control" autoFocus value={banReason}
            onChange={event => setBanReason(event.target.value)} rows={3} maxLength={500} />
        </label>}
        <div className="d-flex justify-content-end gap-2 mt-3">
          <button type="button" className="btn" disabled={saving} onClick={() => { setPendingAction(null); setBanReason('') }}>Cancel</button>
          <button type="button" className="btn btn-danger" disabled={saving || (pendingAction.kind === 'ban' && !banReason.trim())}
            onClick={() => { void confirmAction() }}>Confirm</button>
        </div>
      </div>
    </div>
  </div>}
</>
  )
}

export const AdminAuditTab: React.FC<{
  auditLogs: AuditEntry[]
  fetchAuditLogs: () => Promise<void>
}> = ({ auditLogs, fetchAuditLogs }) => (
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
                                log.action.includes('impersonat')  ? 'yellow' :
                                log.action.includes('announcement') ? 'teal'   : 'blue'
                              }-lt`}>
                                {log.action}
                              </span>
                            </td>
                            <td>{log.admin?.playername ?? '—'}</td>
                            <td>{log.target?.playername ?? (log.target_user_id ? `…${log.target_user_id.slice(-6)}` : '—')}</td>
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
)

export const AdminMaintenanceTab: React.FC<{
  maintenanceOn: boolean
  setMaintenanceOn: (value: boolean) => void
  maintenanceMsg: string
  setMaintenanceMsg: (value: string) => void
  saving: boolean
  saveMaintenance: () => Promise<void>
}> = ({
  maintenanceOn, setMaintenanceOn, maintenanceMsg, setMaintenanceMsg,
  saving, saveMaintenance,
}) => (
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
                            When enabled, non-admin users cannot use the app. The sign-in page remains available for administrators.
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
                            <strong>Warning:</strong> When this setting is saved, non-admin users will see the maintenance screen.
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
)

export const AdminAnnouncementsTab: React.FC<{
  newAnn: AnnouncementDraft
  setNewAnn: React.Dispatch<React.SetStateAction<AnnouncementDraft>>
  announcements: Announcement[]
  createAnnouncement: () => Promise<void>
  deleteAnnouncement: (id: string, title: string) => Promise<void>
}> = ({ newAnn, setNewAnn, announcements, createAnnouncement, deleteAnnouncement }) => (
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
                            onChange={e => setNewAnn(p => ({ ...p, priority: parseAnnouncementPriority(e.target.value) }))}>
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
)
