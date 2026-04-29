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

type Tab = 'dashboard' | 'users' | 'audit' | 'maintenance' | 'announcements' | 'quests'

// ─── Quest form types ─────────────────────────────────────────────────────────

interface QFormTheory    { id: string; type: string; heading: string; body: string; code: string; language: string }
interface QFormMCQ       { id: string; question: string; options: [string,string,string,string]; correct: number; explanation: string }
interface QFormDragItem  { id: string; label: string; color: string }
interface QFormDropZone  { id: string; label: string; accepted: string }
interface QFormOrderItem { id: string; label: string; description: string }
interface QFormCodeFill  { id: string; code_lines: string; language: string; answers: string; hint: string; caption: string }

interface QuestFormState {
  title: string; description: string
  difficulty: 'easy' | 'medium' | 'hard'; level: 1 | 2 | 3
  basexp: number; requiredxp: number; sortorder: number; isactive: boolean
  tutorial_title: string; tutorial_body: string
  theory_sections: QFormTheory[]; objectives: string[]
  act_mc: boolean; act_drag: boolean; act_balloon: boolean; act_ordering: boolean; act_codefill: boolean
  mc_questions: QFormMCQ[]; game_items: QFormDragItem[]; drop_zones: QFormDropZone[]
  ordering_items: QFormOrderItem[]; code_fill_items: QFormCodeFill[]
  balloon_items: QFormDragItem[]
}

const defaultQF = (): QuestFormState => ({
  title: '', description: '', difficulty: 'easy',
  level: 1, basexp: 100, requiredxp: 0, sortorder: 99, isactive: true,
  tutorial_title: '', tutorial_body: '',
  theory_sections: [], objectives: [''],
  act_mc: true, act_drag: false, act_balloon: false, act_ordering: false, act_codefill: false,
  mc_questions: [{ id: '1', question: '', options: ['', '', '', ''], correct: 0, explanation: '' }],
  game_items: [], drop_zones: [], ordering_items: [], code_fill_items: [], balloon_items: [],
})

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

  // Quest generator
  const [questForm,      setQuestForm]      = useState<QuestFormState>(defaultQF)
  const [existingQuests, setExistingQuests] = useState<any[]>([])
  const [replaceTarget,  setReplaceTarget]  = useState('')
  const [questSaving,    setQuestSaving]    = useState(false)
  const [questSubTab,    setQuestSubTab]    = useState<'create' | 'manage'>('create')
  const qSet = (patch: Partial<QuestFormState>) => setQuestForm(p => ({ ...p, ...patch }))

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

  const fetchExistingQuests = useCallback(async () => {
    const { data, error } = await supabase
      .from('quests')
      .select('id, title, level, difficulty, basexp, sortorder, isactive, phase, question_type, description, tutorial_title, tutorial_body, theory_sections, objectives, mc_questions, game_items, drop_zones, ordering_items, code_fill_items')
      .eq('mode', 'campaign')
      .order('level', { ascending: true })
      .order('sortorder', { ascending: true })
    if (error) { console.warn('[fetchExistingQuests]', error.message); return }
    if (data) setExistingQuests(data)
  }, [])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      await Promise.all([fetchUsers(), fetchAuditLogs(), fetchMaintenance(), fetchAnnouncements()])
      setLoading(false)
    }
    load()
  }, [fetchUsers, fetchAuditLogs, fetchMaintenance, fetchAnnouncements])

  useEffect(() => {
    if (tab === 'quests') fetchExistingQuests()
  }, [tab, fetchExistingQuests])

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
        { key: 'maintenance_mode',    value: maintenanceOn,              updated_by: user.id },
        { onConflict: 'key' }
      ),
      supabase.from('system_settings').upsert(
        { key: 'maintenance_message', value: maintenanceMsg || '',        updated_by: user.id },
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
    const { error } = await supabase.from('announcements').delete().eq('id', id)
    if (error) { showToast(`Delete failed: ${error.message}`, 'error'); return }
    await writeAuditLog(user.id, 'announcement_delete', undefined, { title })
    showToast('Announcement deleted')
    await fetchAnnouncements()
  }

  // ── Quest actions ──────────────────────────────────────────────────────────
  const resetQuestForm = () => { setQuestForm(defaultQF()); setReplaceTarget('') }

  const saveQuest = async (replaceId?: string) => {
    if (!user || !questForm.title.trim()) { showToast('Title is required', 'error'); return }
    const phase = questForm.level === 1 ? 'beginner' : questForm.level === 2 ? 'intermediate' : 'advanced'
    const qTypeMap: Record<string, string> = {
      act_mc: 'multiple_choice', act_drag: 'drag_drop', act_balloon: 'pop_balloon',
      act_ordering: 'ordering', act_codefill: 'code_fill',
    }
    const firstActive = (['act_mc', 'act_drag', 'act_balloon', 'act_ordering', 'act_codefill'] as const)
      .find(k => questForm[k])
    const question_type = firstActive ? qTypeMap[firstActive] : null

    const theory_sections = questForm.theory_sections
      .map(({ id: _id, ...s }) => ({
        type: s.type || 'default',
        heading: s.heading || undefined,
        body: s.body || undefined,
        code: s.code || undefined,
        language: s.language || undefined,
      }))
      .filter(s => s.body || s.code)

    const mc_questions = questForm.act_mc && questForm.mc_questions.length > 0
      ? questForm.mc_questions.map((q, i) => ({
          id: `mc_${i + 1}`, question: q.question, options: q.options,
          correct: q.correct, explanation: q.explanation,
        }))
      : null

    const game_items = (() => {
      if (questForm.act_drag && questForm.game_items.length > 0)
        return questForm.game_items.map(g => ({ id: g.id, label: g.label, color: g.color }))
      if (questForm.act_balloon && questForm.balloon_items.length > 0)
        return questForm.balloon_items.map(g => ({ id: g.id, label: g.label, color: g.color }))
      return null
    })()

    const drop_zones = questForm.act_drag && questForm.drop_zones.length > 0
      ? questForm.drop_zones.map(z => ({ id: z.id, label: z.label, accepted: z.accepted }))
      : null

    const ordering_items = questForm.act_ordering && questForm.ordering_items.length > 0
      ? questForm.ordering_items.map((o, i) => ({
          id: o.id, label: o.label, description: o.description || undefined, correct_order: i + 1,
        }))
      : null

    const code_fill_items = questForm.act_codefill && questForm.code_fill_items.length > 0
      ? questForm.code_fill_items.map(c => ({
          id: c.id,
          code_lines: c.code_lines.split('\n'),
          language: c.language || 'c',
          answers: c.answers.split(',').map((a: string) => a.trim()).filter(Boolean),
          hint: c.hint || undefined,
          caption: c.caption || undefined,
        }))
      : null

    const questData = {
      title: questForm.title.trim(), description: questForm.description.trim() || null,
      difficulty: questForm.difficulty, level: questForm.level, phase, mode: 'campaign',
      basexp: questForm.basexp, requiredxp: questForm.requiredxp,
      sortorder: questForm.sortorder, isactive: questForm.isactive,
      question_type,
      objectives: questForm.objectives.filter(Boolean).length > 0 ? questForm.objectives.filter(Boolean) : null,
      hints: null,
      tutorial_title: questForm.tutorial_title.trim() || null,
      tutorial_body: questForm.tutorial_body.trim() || null,
      tutorial_image: null,
      theory_sections: theory_sections.length > 0 ? theory_sections : null,
      mc_questions, game_items, drop_zones, ordering_items, code_fill_items,
    }

    setQuestSaving(true)
    try {
      if (replaceId) {
        const { error } = await supabase.from('quests').update(questData).eq('id', replaceId)
        if (error) throw error
        await writeAuditLog(user.id, 'quest_update', undefined, { title: questForm.title, id: replaceId })
        showToast('Quest updated successfully')
      } else {
        const { error } = await supabase.from('quests').insert(questData)
        if (error) throw error
        await writeAuditLog(user.id, 'quest_create', undefined, { title: questForm.title, level: questForm.level })
        showToast('Quest created successfully')
      }
      await fetchExistingQuests()
      resetQuestForm()
    } catch (err: any) {
      showToast(`Failed: ${err.message}`, 'error')
    }
    setQuestSaving(false)
  }

  const loadQuestForEdit = (q: any) => {
    setQuestForm({
      title: q.title ?? '', description: q.description ?? '',
      difficulty: q.difficulty ?? 'easy', level: q.level ?? 1,
      basexp: q.basexp ?? 100, requiredxp: q.requiredxp ?? 0,
      sortorder: q.sortorder ?? 99, isactive: q.isactive ?? true,
      tutorial_title: q.tutorial_title ?? '', tutorial_body: q.tutorial_body ?? '',
      theory_sections: (q.theory_sections ?? []).map((s: any, i: number) => ({
        id: String(i), type: s.type ?? 'default', heading: s.heading ?? '',
        body: s.body ?? '', code: s.code ?? '', language: s.language ?? 'c',
      })),
      objectives: q.objectives?.length ? q.objectives : [''],
      act_mc: !!q.mc_questions?.length,
      act_drag: !!(q.game_items?.length && q.drop_zones?.length),
      act_balloon: !!(q.game_items?.length && !q.drop_zones?.length),
      act_ordering: !!q.ordering_items?.length,
      act_codefill: !!q.code_fill_items?.length,
      mc_questions: (q.mc_questions ?? []).map((m: any) => ({
        id: m.id ?? String(Math.random()), question: m.question ?? '',
        options: m.options ?? ['', '', '', ''], correct: m.correct ?? 0, explanation: m.explanation ?? '',
      })),
      game_items: q.drop_zones?.length
        ? (q.game_items ?? []).map((g: any) => ({ id: g.id ?? String(Math.random()), label: g.label ?? '', color: g.color ?? '#58a6ff' }))
        : [],
      drop_zones: (q.drop_zones ?? []).map((z: any) => ({ id: z.id ?? String(Math.random()), label: z.label ?? '', accepted: z.accepted ?? '' })),
      ordering_items: (q.ordering_items ?? []).map((o: any) => ({ id: o.id ?? String(Math.random()), label: o.label ?? '', description: o.description ?? '' })),
      code_fill_items: (q.code_fill_items ?? []).map((c: any) => ({
        id: c.id ?? String(Math.random()),
        code_lines: Array.isArray(c.code_lines) ? c.code_lines.join('\n') : (c.code_lines ?? ''),
        language: c.language ?? 'c',
        answers: Array.isArray(c.answers) ? c.answers.join(', ') : (c.answers ?? ''),
        hint: c.hint ?? '', caption: c.caption ?? '',
      })),
      balloon_items: q.drop_zones?.length
        ? []
        : (q.game_items ?? []).map((g: any) => ({ id: g.id ?? String(Math.random()), label: g.label ?? '', color: g.color ?? '#3fb950' })),
    })
    setReplaceTarget(q.id)
    setQuestSubTab('create')
    showToast(`Loaded "${q.title}" for editing`)
  }

  const toggleQuestActive = async (q: any) => {
    if (!user) return
    const { error } = await supabase.from('quests').update({ isactive: !q.isactive }).eq('id', q.id)
    if (error) { showToast(`Failed: ${error.message}`, 'error'); return }
    await writeAuditLog(user.id, q.isactive ? 'quest_deactivate' : 'quest_activate', undefined, { title: q.title })
    showToast(`Quest ${q.isactive ? 'deactivated' : 'activated'}`)
    await fetchExistingQuests()
  }

  const deleteQuest = async (q: any) => {
    if (!user) return
    if (!window.confirm(`Delete quest "${q.title}"? This cannot be undone.`)) return
    const { error } = await supabase.from('quests').delete().eq('id', q.id)
    if (error) { showToast(`Failed: ${error.message}`, 'error'); return }
    await writeAuditLog(user.id, 'quest_delete', undefined, { title: q.title, id: q.id })
    showToast('Quest deleted')
    if (replaceTarget === q.id) setReplaceTarget('')
    await fetchExistingQuests()
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
    { id: 'quests',        icon: 'ti ti-sword',          label: 'Quest Builder' },
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
                                  <td><span className={`badge bg-${
                                    log.action.includes('ban')         ? 'red'    :
                                    log.action.includes('admin')       ? 'purple' :
                                    log.action.includes('maintenance') ? 'orange' :
                                    log.action.includes('impersonat')  ? 'yellow' : 'blue'
                                  }-lt`}>{log.action}</span></td>
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
                          <th>Status</th><th>Joined</th><th>Last Active</th><th>Actions</th>
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
                            <td className="text-muted" style={{ fontSize: '11px' }}>{u.lastactive ? fmt(u.lastactive) : '—'}</td>
                            <td>
                              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                {u.is_banned ? (
                                  <button className="btn btn-sm btn-success" disabled={saving}
                                    onClick={() => unbanUser(u)}>Unban</button>
                                ) : (
                                  <button className="btn btn-sm btn-danger" disabled={saving || u.id === user?.id}
                                    onClick={() => {
                                      const reason = window.prompt(`Ban reason for ${u.playername}:`)
                                      if (reason !== null && reason.trim() !== '') banUser(u, reason.trim())
                                      else if (reason !== null) alert('A ban reason is required.')
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
                          <tr><td colSpan={9} className="text-center text-muted py-4">No users found</td></tr>
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
                                log.action.includes('impersonat')  ? 'yellow' :
                                log.action.includes('announcement') ? 'teal'   : 'blue'
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
                        <span id="maintenance-unsaved" style={{ fontSize: '11px', color: '#f76707', marginLeft: '10px', display: 'none' }}>
                          ● Unsaved changes
                        </span>
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

              {/* ── QUEST BUILDER ── */}
              {tab === 'quests' && (
                <>
                  {/* Sub-tab toggle */}
                  <div className="d-flex gap-2 mb-3">
                    <button className={`btn btn-sm ${questSubTab === 'create' ? 'btn-primary' : 'btn-outline-secondary'}`}
                      onClick={() => setQuestSubTab('create')}>+ Create / Edit Quest</button>
                    <button className={`btn btn-sm ${questSubTab === 'manage' ? 'btn-primary' : 'btn-outline-secondary'}`}
                      onClick={() => setQuestSubTab('manage')}>Manage Existing</button>
                  </div>

                  {questSubTab === 'create' && (
                    <div className="row">
                      {/* ── Left: config ── */}
                      <div className="col-md-5">

                        {/* Basic Info */}
                        <div className="card mb-3">
                          <div className="card-header"><h3 className="card-title">Basic Info</h3></div>
                          <div className="card-body">
                            <div className="mb-2">
                              <label className="form-label">Title *</label>
                              <input className="form-control" value={questForm.title} onChange={e => qSet({ title: e.target.value })} placeholder="Quest title" />
                            </div>
                            <div className="mb-2">
                              <label className="form-label">Description</label>
                              <textarea className="form-control" rows={2} value={questForm.description} onChange={e => qSet({ description: e.target.value })} placeholder="Short description shown on the quest card" />
                            </div>
                            <div className="row g-2 mb-2">
                              <div className="col-4">
                                <label className="form-label">Level</label>
                                <select className="form-select" value={questForm.level} onChange={e => qSet({ level: Number(e.target.value) as 1|2|3 })}>
                                  <option value={1}>1 – Beginner</option>
                                  <option value={2}>2 – Intermediate</option>
                                  <option value={3}>3 – Advanced</option>
                                </select>
                              </div>
                              <div className="col-4">
                                <label className="form-label">Difficulty</label>
                                <select className="form-select" value={questForm.difficulty} onChange={e => qSet({ difficulty: e.target.value as any })}>
                                  <option value="easy">Easy</option>
                                  <option value="medium">Medium</option>
                                  <option value="hard">Hard</option>
                                </select>
                              </div>
                              <div className="col-4">
                                <label className="form-label">Sort Order</label>
                                <input type="number" className="form-control" value={questForm.sortorder} onChange={e => qSet({ sortorder: Number(e.target.value) })} />
                              </div>
                            </div>
                            <div className="row g-2 mb-2">
                              <div className="col-6">
                                <label className="form-label">XP Reward</label>
                                <input type="number" className="form-control" value={questForm.basexp} min={0} onChange={e => qSet({ basexp: Number(e.target.value) })} />
                              </div>
                              <div className="col-6">
                                <label className="form-label">Required XP to Unlock</label>
                                <input type="number" className="form-control" value={questForm.requiredxp} min={0} onChange={e => qSet({ requiredxp: Number(e.target.value) })} />
                              </div>
                            </div>
                            <label className="form-check">
                              <input type="checkbox" className="form-check-input" checked={questForm.isactive} onChange={e => qSet({ isactive: e.target.checked })} />
                              <span className="form-check-label">Active (visible to users)</span>
                            </label>
                          </div>
                        </div>

                        {/* Learning Material */}
                        <div className="card mb-3">
                          <div className="card-header"><h3 className="card-title">Learning Material</h3></div>
                          <div className="card-body">
                            <div className="mb-2">
                              <label className="form-label">Lesson Title</label>
                              <input className="form-control" value={questForm.tutorial_title} onChange={e => qSet({ tutorial_title: e.target.value })} placeholder="e.g. Introduction to Variables" />
                            </div>
                            <div className="mb-2">
                              <label className="form-label">Lesson Overview</label>
                              <textarea className="form-control" rows={3} value={questForm.tutorial_body} onChange={e => qSet({ tutorial_body: e.target.value })} placeholder="Brief overview shown before activities begin..." />
                            </div>
                            <div className="d-flex justify-content-between align-items-center mb-1">
                              <label className="form-label mb-0" style={{ fontSize: '13px' }}>Theory Sections</label>
                              <button className="btn btn-xs btn-outline-primary" onClick={() => qSet({
                                theory_sections: [...questForm.theory_sections, { id: Date.now().toString(), type: 'default', heading: '', body: '', code: '', language: 'c' }]
                              })}>+ Add Section</button>
                            </div>
                            {questForm.theory_sections.map((sec, i) => (
                              <div key={sec.id} className="border rounded p-2 mb-2" style={{ fontSize: '12px' }}>
                                <div className="d-flex justify-content-between mb-1">
                                  <select className="form-select form-select-sm" style={{ width: '140px' }}
                                    value={sec.type} onChange={e => { const s = [...questForm.theory_sections]; s[i] = { ...s[i], type: e.target.value }; qSet({ theory_sections: s }) }}>
                                    <option value="default">Text</option>
                                    <option value="code">Code Block</option>
                                    <option value="tip">Tip</option>
                                    <option value="did_you_know">Did You Know</option>
                                    <option value="mistake">Common Mistake</option>
                                    <option value="summary">Summary</option>
                                  </select>
                                  <button className="btn btn-xs btn-ghost-danger" onClick={() => qSet({ theory_sections: questForm.theory_sections.filter((_, j) => j !== i) })}>✕</button>
                                </div>
                                <input className="form-control form-control-sm mb-1" placeholder="Heading (optional)" value={sec.heading}
                                  onChange={e => { const s = [...questForm.theory_sections]; s[i] = { ...s[i], heading: e.target.value }; qSet({ theory_sections: s }) }} />
                                {sec.type === 'code' ? (
                                  <>
                                    <textarea className="form-control form-control-sm mb-1" rows={3} placeholder="Code content" style={{ fontFamily: 'monospace' }}
                                      value={sec.code} onChange={e => { const s = [...questForm.theory_sections]; s[i] = { ...s[i], code: e.target.value }; qSet({ theory_sections: s }) }} />
                                    <input className="form-control form-control-sm" placeholder="Language (c, cpp, python…)" value={sec.language}
                                      onChange={e => { const s = [...questForm.theory_sections]; s[i] = { ...s[i], language: e.target.value }; qSet({ theory_sections: s }) }} />
                                  </>
                                ) : (
                                  <textarea className="form-control form-control-sm" rows={2} placeholder="Section content"
                                    value={sec.body} onChange={e => { const s = [...questForm.theory_sections]; s[i] = { ...s[i], body: e.target.value }; qSet({ theory_sections: s }) }} />
                                )}
                              </div>
                            ))}
                            {questForm.theory_sections.length === 0 && <div className="text-muted" style={{ fontSize: '12px' }}>No theory sections yet</div>}
                          </div>
                        </div>

                        {/* Learning Objectives */}
                        <div className="card mb-3">
                          <div className="card-header d-flex justify-content-between align-items-center">
                            <h3 className="card-title mb-0">Learning Objectives</h3>
                            <button className="btn btn-xs btn-outline-primary" onClick={() => qSet({ objectives: [...questForm.objectives, ''] })}>+ Add</button>
                          </div>
                          <div className="card-body">
                            {questForm.objectives.map((obj, i) => (
                              <div key={i} className="d-flex gap-1 mb-1">
                                <input className="form-control form-control-sm" value={obj} placeholder={`Objective ${i + 1}`}
                                  onChange={e => { const o = [...questForm.objectives]; o[i] = e.target.value; qSet({ objectives: o }) }} />
                                <button className="btn btn-sm btn-ghost-danger" onClick={() => qSet({ objectives: questForm.objectives.filter((_, j) => j !== i) })}>✕</button>
                              </div>
                            ))}
                            {questForm.objectives.length === 0 && <div className="text-muted" style={{ fontSize: '12px' }}>No objectives added</div>}
                          </div>
                        </div>
                      </div>

                      {/* ── Right: Activities ── */}
                      <div className="col-md-7">

                        {/* Activity type selector */}
                        <div className="card mb-3">
                          <div className="card-header"><h3 className="card-title">Activity Types</h3></div>
                          <div className="card-body">
                            <div className="row g-2">
                              {([
                                { key: 'act_mc',       label: 'Multiple Choice', icon: '🔘' },
                                { key: 'act_drag',     label: 'Drag & Drop',     icon: '🎯' },
                                { key: 'act_balloon',  label: 'Balloon Pop',     icon: '🎈' },
                                { key: 'act_ordering', label: 'Ordering',        icon: '📋' },
                                { key: 'act_codefill', label: 'Code Fill',       icon: '💻' },
                              ] as const).map(act => (
                                <div key={act.key} className="col-auto">
                                  <label className="form-check form-check-inline">
                                    <input type="checkbox" className="form-check-input"
                                      checked={questForm[act.key] as boolean}
                                      onChange={e => qSet({ [act.key]: e.target.checked } as any)} />
                                    <span className="form-check-label">{act.icon} {act.label}</span>
                                  </label>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* MC Questions */}
                        {questForm.act_mc && (
                          <div className="card mb-3">
                            <div className="card-header d-flex justify-content-between align-items-center">
                              <h3 className="card-title mb-0">Multiple Choice Questions</h3>
                              <button className="btn btn-xs btn-outline-primary" onClick={() => qSet({
                                mc_questions: [...questForm.mc_questions, { id: Date.now().toString(), question: '', options: ['', '', '', ''], correct: 0, explanation: '' }]
                              })}>+ Add Q</button>
                            </div>
                            <div className="card-body" style={{ maxHeight: '380px', overflowY: 'auto' }}>
                              {questForm.mc_questions.map((q, qi) => (
                                <div key={q.id} className="border rounded p-2 mb-2" style={{ fontSize: '12px' }}>
                                  <div className="d-flex justify-content-between mb-1">
                                    <strong style={{ fontSize: '11px', color: '#6b7280' }}>Q{qi + 1}</strong>
                                    <button className="btn btn-xs btn-ghost-danger" onClick={() => qSet({ mc_questions: questForm.mc_questions.filter((_, j) => j !== qi) })}>✕</button>
                                  </div>
                                  <textarea className="form-control form-control-sm mb-1" rows={2} placeholder="Question text" value={q.question}
                                    onChange={e => { const qs = [...questForm.mc_questions]; qs[qi] = { ...qs[qi], question: e.target.value }; qSet({ mc_questions: qs }) }} />
                                  {q.options.map((opt, oi) => (
                                    <div key={oi} className="d-flex align-items-center gap-1 mb-1">
                                      <input type="radio" name={`correct_${q.id}`} checked={q.correct === oi} title="Mark as correct"
                                        onChange={() => { const qs = [...questForm.mc_questions]; qs[qi] = { ...qs[qi], correct: oi }; qSet({ mc_questions: qs }) }} />
                                      <input className="form-control form-control-sm" placeholder={`Option ${oi + 1}`} value={opt}
                                        onChange={e => {
                                          const qs = [...questForm.mc_questions]
                                          const opts = [...qs[qi].options] as [string,string,string,string]
                                          opts[oi] = e.target.value; qs[qi] = { ...qs[qi], options: opts }; qSet({ mc_questions: qs })
                                        }} />
                                    </div>
                                  ))}
                                  <input className="form-control form-control-sm" placeholder="Explanation (shown after answer)" value={q.explanation}
                                    onChange={e => { const qs = [...questForm.mc_questions]; qs[qi] = { ...qs[qi], explanation: e.target.value }; qSet({ mc_questions: qs }) }} />
                                </div>
                              ))}
                              {questForm.mc_questions.length === 0 && <div className="text-muted" style={{ fontSize: '12px' }}>No questions yet</div>}
                            </div>
                          </div>
                        )}

                        {/* Drag & Drop */}
                        {questForm.act_drag && (
                          <div className="card mb-3">
                            <div className="card-header"><h3 className="card-title">Drag & Drop</h3></div>
                            <div className="card-body">
                              <div className="row g-2">
                                <div className="col-6">
                                  <div className="d-flex justify-content-between align-items-center mb-1">
                                    <label className="form-label mb-0" style={{ fontSize: '12px' }}>Draggable Items</label>
                                    <button className="btn btn-xs btn-outline-primary" onClick={() => qSet({ game_items: [...questForm.game_items, { id: `item_${Date.now()}`, label: '', color: '#58a6ff' }] })}>+</button>
                                  </div>
                                  {questForm.game_items.map((item, i) => (
                                    <div key={item.id} className="d-flex gap-1 mb-1">
                                      <input type="color" value={item.color} style={{ width: '30px', padding: '1px 2px', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer' }}
                                        onChange={e => { const g = [...questForm.game_items]; g[i] = { ...g[i], color: e.target.value }; qSet({ game_items: g }) }} />
                                      <input className="form-control form-control-sm" placeholder={`Item ${i + 1}`} value={item.label}
                                        onChange={e => { const g = [...questForm.game_items]; g[i] = { ...g[i], label: e.target.value }; qSet({ game_items: g }) }} />
                                      <button className="btn btn-xs btn-ghost-danger" onClick={() => qSet({ game_items: questForm.game_items.filter((_, j) => j !== i) })}>✕</button>
                                    </div>
                                  ))}
                                </div>
                                <div className="col-6">
                                  <div className="d-flex justify-content-between align-items-center mb-1">
                                    <label className="form-label mb-0" style={{ fontSize: '12px' }}>Drop Zones</label>
                                    <button className="btn btn-xs btn-outline-primary" onClick={() => qSet({ drop_zones: [...questForm.drop_zones, { id: `zone_${Date.now()}`, label: '', accepted: '' }] })}>+</button>
                                  </div>
                                  {questForm.drop_zones.map((zone, i) => (
                                    <div key={zone.id} className="mb-2">
                                      <div className="d-flex gap-1 mb-1">
                                        <input className="form-control form-control-sm" placeholder={`Zone ${i + 1} label`} value={zone.label}
                                          onChange={e => { const z = [...questForm.drop_zones]; z[i] = { ...z[i], label: e.target.value }; qSet({ drop_zones: z }) }} />
                                        <button className="btn btn-xs btn-ghost-danger" onClick={() => qSet({ drop_zones: questForm.drop_zones.filter((_, j) => j !== i) })}>✕</button>
                                      </div>
                                      <select className="form-select form-select-sm" value={zone.accepted}
                                        onChange={e => { const z = [...questForm.drop_zones]; z[i] = { ...z[i], accepted: e.target.value }; qSet({ drop_zones: z }) }}>
                                        <option value="">— Accepts which item? —</option>
                                        {questForm.game_items.map(gi => (
                                          <option key={gi.id} value={gi.id}>{gi.label || gi.id}</option>
                                        ))}
                                      </select>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Balloon Pop */}
                        {questForm.act_balloon && (
                          <div className="card mb-3">
                            <div className="card-header d-flex justify-content-between align-items-center">
                              <h3 className="card-title mb-0">Balloon Pop Items</h3>
                              <button className="btn btn-xs btn-outline-primary" onClick={() => qSet({ balloon_items: [...questForm.balloon_items, { id: `b_${Date.now()}`, label: '', color: '#3fb950' }] })}>+ Add</button>
                            </div>
                            <div className="card-body">
                              {questForm.balloon_items.map((item, i) => (
                                <div key={item.id} className="d-flex gap-1 mb-1">
                                  <input type="color" value={item.color} style={{ width: '30px', padding: '1px 2px', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer' }}
                                    onChange={e => { const b = [...questForm.balloon_items]; b[i] = { ...b[i], color: e.target.value }; qSet({ balloon_items: b }) }} />
                                  <input className="form-control form-control-sm" placeholder={`Balloon ${i + 1} label`} value={item.label}
                                    onChange={e => { const b = [...questForm.balloon_items]; b[i] = { ...b[i], label: e.target.value }; qSet({ balloon_items: b }) }} />
                                  <button className="btn btn-xs btn-ghost-danger" onClick={() => qSet({ balloon_items: questForm.balloon_items.filter((_, j) => j !== i) })}>✕</button>
                                </div>
                              ))}
                              {questForm.balloon_items.length === 0 && <div className="text-muted" style={{ fontSize: '12px' }}>No items yet</div>}
                            </div>
                          </div>
                        )}

                        {/* Ordering */}
                        {questForm.act_ordering && (
                          <div className="card mb-3">
                            <div className="card-header d-flex justify-content-between align-items-center">
                              <h3 className="card-title mb-0">Ordering Items</h3>
                              <button className="btn btn-xs btn-outline-primary" onClick={() => qSet({ ordering_items: [...questForm.ordering_items, { id: `o_${Date.now()}`, label: '', description: '' }] })}>+ Add</button>
                            </div>
                            <div className="card-body">
                              <div className="text-muted mb-2" style={{ fontSize: '11px' }}>Add items in the correct order — top = first.</div>
                              {questForm.ordering_items.map((item, i) => (
                                <div key={item.id} className="d-flex gap-1 align-items-start mb-2">
                                  <span className="badge bg-secondary mt-1" style={{ minWidth: '22px' }}>{i + 1}</span>
                                  <div style={{ flex: 1 }}>
                                    <input className="form-control form-control-sm mb-1" placeholder="Item label" value={item.label}
                                      onChange={e => { const o = [...questForm.ordering_items]; o[i] = { ...o[i], label: e.target.value }; qSet({ ordering_items: o }) }} />
                                    <input className="form-control form-control-sm" placeholder="Description (optional)" value={item.description}
                                      onChange={e => { const o = [...questForm.ordering_items]; o[i] = { ...o[i], description: e.target.value }; qSet({ ordering_items: o }) }} />
                                  </div>
                                  <button className="btn btn-xs btn-ghost-danger mt-1" onClick={() => qSet({ ordering_items: questForm.ordering_items.filter((_, j) => j !== i) })}>✕</button>
                                </div>
                              ))}
                              {questForm.ordering_items.length === 0 && <div className="text-muted" style={{ fontSize: '12px' }}>No items yet</div>}
                            </div>
                          </div>
                        )}

                        {/* Code Fill */}
                        {questForm.act_codefill && (
                          <div className="card mb-3">
                            <div className="card-header d-flex justify-content-between align-items-center">
                              <h3 className="card-title mb-0">Code Fill Items</h3>
                              <button className="btn btn-xs btn-outline-primary" onClick={() => qSet({ code_fill_items: [...questForm.code_fill_items, { id: `cf_${Date.now()}`, code_lines: '', language: 'c', answers: '', hint: '', caption: '' }] })}>+ Add</button>
                            </div>
                            <div className="card-body">
                              <div className="text-muted mb-2" style={{ fontSize: '11px' }}>Use <code>___</code> in code for blanks. Answers: comma-separated, matching blank order.</div>
                              {questForm.code_fill_items.map((item, i) => (
                                <div key={item.id} className="border rounded p-2 mb-2">
                                  <div className="d-flex justify-content-between mb-1">
                                    <small className="text-muted">Item {i + 1}</small>
                                    <button className="btn btn-xs btn-ghost-danger" onClick={() => qSet({ code_fill_items: questForm.code_fill_items.filter((_, j) => j !== i) })}>✕</button>
                                  </div>
                                  <div className="row g-1 mb-1">
                                    <div className="col-4">
                                      <input className="form-control form-control-sm" placeholder="Language (c, cpp…)" value={item.language}
                                        onChange={e => { const c = [...questForm.code_fill_items]; c[i] = { ...c[i], language: e.target.value }; qSet({ code_fill_items: c }) }} />
                                    </div>
                                    <div className="col-8">
                                      <input className="form-control form-control-sm" placeholder="Caption (optional)" value={item.caption}
                                        onChange={e => { const c = [...questForm.code_fill_items]; c[i] = { ...c[i], caption: e.target.value }; qSet({ code_fill_items: c }) }} />
                                    </div>
                                  </div>
                                  <textarea className="form-control form-control-sm mb-1" rows={4}
                                    placeholder={'int main() {\n    ___ x = 5;\n    return 0;\n}'}
                                    style={{ fontFamily: 'monospace', fontSize: '11px' }} value={item.code_lines}
                                    onChange={e => { const c = [...questForm.code_fill_items]; c[i] = { ...c[i], code_lines: e.target.value }; qSet({ code_fill_items: c }) }} />
                                  <input className="form-control form-control-sm mb-1" placeholder="Answers: int, x" value={item.answers}
                                    onChange={e => { const c = [...questForm.code_fill_items]; c[i] = { ...c[i], answers: e.target.value }; qSet({ code_fill_items: c }) }} />
                                  <input className="form-control form-control-sm" placeholder="Hint (optional)" value={item.hint}
                                    onChange={e => { const c = [...questForm.code_fill_items]; c[i] = { ...c[i], hint: e.target.value }; qSet({ code_fill_items: c }) }} />
                                </div>
                              ))}
                              {questForm.code_fill_items.length === 0 && <div className="text-muted" style={{ fontSize: '12px' }}>No items yet</div>}
                            </div>
                          </div>
                        )}

                        {/* Save / Replace */}
                        <div className="card">
                          <div className="card-body">
                            {replaceTarget && (
                              <div className="alert alert-warning py-2 mb-2" style={{ fontSize: '12px' }}>
                                Editing: <strong>{existingQuests.find(q => q.id === replaceTarget)?.title ?? replaceTarget}</strong>
                                <button className="btn btn-xs btn-ghost-secondary ms-2" onClick={() => setReplaceTarget('')}>Clear</button>
                              </div>
                            )}
                            <div className="d-flex gap-2 align-items-center flex-wrap">
                              {replaceTarget ? (
                                <button className="btn btn-warning" disabled={questSaving || !questForm.title.trim()}
                                  onClick={() => {
                                    if (window.confirm(`Update "${existingQuests.find(q => q.id === replaceTarget)?.title}"?`)) saveQuest(replaceTarget)
                                  }}>
                                  {questSaving ? 'Saving…' : '✓ Update Quest'}
                                </button>
                              ) : (
                                <button className="btn btn-primary" disabled={questSaving || !questForm.title.trim()} onClick={() => saveQuest()}>
                                  {questSaving ? 'Saving…' : '✓ Save as New Quest'}
                                </button>
                              )}
                              <div className="d-flex gap-1 align-items-center">
                                <select className="form-select form-select-sm" style={{ width: '220px' }} value={replaceTarget}
                                  onChange={e => setReplaceTarget(e.target.value)}>
                                  <option value="">— Or load existing to edit —</option>
                                  {existingQuests.filter(q => q.level === questForm.level).map(q => (
                                    <option key={q.id} value={q.id}>{q.title}</option>
                                  ))}
                                </select>
                                {replaceTarget && (
                                  <button className="btn btn-sm btn-outline-secondary" onClick={() => {
                                    const quest = existingQuests.find(q => q.id === replaceTarget)
                                    if (quest) loadQuestForEdit(quest)
                                  }}>
                                    Load
                                  </button>
                                )}
                              </div>
                              <button className="btn btn-ghost-secondary ms-auto" onClick={resetQuestForm}>Reset</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Manage tab */}
                  {questSubTab === 'manage' && (
                    <div className="card">
                      <div className="card-header">
                        <h3 className="card-title">All Campaign Quests</h3>
                        <div className="card-options">
                          <button className="btn btn-sm btn-outline-primary" onClick={fetchExistingQuests}><i className="ti ti-refresh me-1" />Refresh</button>
                        </div>
                      </div>
                      <div className="table-responsive">
                        <table className="table table-vcenter card-table table-striped">
                          <thead>
                            <tr><th>Title</th><th>Level</th><th>Difficulty</th><th>XP</th><th>Order</th><th>Status</th><th>Actions</th></tr>
                          </thead>
                          <tbody>
                            {existingQuests.map(q => (
                              <tr key={q.id}>
                                <td><strong style={{ fontSize: '13px' }}>{q.title}</strong></td>
                                <td><span className={`badge bg-${q.level === 1 ? 'green' : q.level === 2 ? 'yellow' : 'red'}-lt`}>Level {q.level}</span></td>
                                <td className="text-muted" style={{ fontSize: '12px' }}>{q.difficulty ?? '—'}</td>
                                <td>{q.basexp}</td>
                                <td>{q.sortorder}</td>
                                <td>{q.isactive ? <span className="badge bg-green">Active</span> : <span className="badge bg-secondary">Inactive</span>}</td>
                                <td>
                                  <div className="d-flex gap-1">
                                    <button className="btn btn-sm btn-outline-secondary" onClick={() => { loadQuestForEdit(q); }}>Edit</button>
                                    <button className="btn btn-sm btn-outline-warning" onClick={() => toggleQuestActive(q)}>
                                      {q.isactive ? 'Deactivate' : 'Activate'}
                                    </button>
                                    <button className="btn btn-sm btn-ghost-danger" onClick={() => deleteQuest(q)}>Delete</button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                            {existingQuests.length === 0 && (
                              <tr><td colSpan={7} className="text-center text-muted py-4">No quests found</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}

            </div>
          </div>
        </div>
      </div>
    </div>
  )
}