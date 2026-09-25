// AdminPanel.tsx — Tabler-based admin dashboard
// Loads Tabler CSS from CDN on mount, removes it on unmount to avoid style bleed.
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/components/AuthContext'
import { supabase } from '@/services/supabase'
import { endSupportSession, requestSupportSession, type SupportSession } from '@/services/liveSupport'
import { assertSupportVideoPlayback } from '@/services/supportVideo'
import { getAvatarUrlMap, type ProfileImageUrls } from '@/services/ProfileImages'
import {
  levelToPhase,
  patchMCQuestions, parseCodeFillAnswers,
  normalizeMCQuestions,
  loadHintsForEdit, serializeHints, HINT_ACTIVITY_OPTIONS,
  validateQuestBuilderForm,
  type HintActivityScope,
  type HintFormRow,
} from '@/admin/adminHelpers'
import { extractTextFromPdf, generateQuestDraftFromText } from '@/admin/questAutoGenerator'
import { generateAutoHints } from '@/campaign/generateAutoHints'
import { isCampaignPhase, levelForPhase, phaseForLevel } from '@/types/campaign'
import {
  AdminAnnouncementsTab,
  AdminAuditTab,
  AdminDashboardTab,
  AdminMaintenanceTab,
  AdminUsersTab,
} from './AdminCoreTabs'
import { AdminLiveSupport } from './AdminLiveSupport'

import {
  campaignDifficultyFromForm,
  campaignDifficultyToForm,
  defaultLevelAccent,
  defaultQF,
  errorMessage,
  lessonTextToSections,
  levelBadgeColor,
  levelName,
  levelOptionLabel,
  newDragProblem,
  newOrderProblem,
  newTheorySection,
  parseHintLines,
  parseLineList,
  questActivityLabels,
  questPreviewFromForm,
  selectedTabsForForm,
  settingStringValue,
  storedChoiceQuestionToForm,
  tabHasContent,
  tabLabel,
  writeAuditLog,
  type AdminUserChanges,
  type AdminUser,
  type Announcement,
  type AuditEntry,
  type ExistingQuest,
  type QuestFormState,
  type QuestActivityFlag,
  type QuestDifficulty,
  type QFormDragProblem,
  type QFormOrderProblem,
  type Tab,
} from '@/admin/adminPanelModel'

// ─── Main component ───────────────────────────────────────────────────────────

const loadAdminQuestDraft = (userId: string): { form: QuestFormState; replaceTarget: string | null; error: string | null } => {
  try {
    const stored = localStorage.getItem(`codesense-admin-quest-draft:${userId}`)
    if (!stored) return { form: defaultQF(), replaceTarget: '', error: null }
    const parsed: unknown = JSON.parse(stored)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      typeof (parsed as QuestFormState).title !== 'string' ||
      !Array.isArray((parsed as QuestFormState).mc_questions) ||
      !Array.isArray((parsed as QuestFormState).theory_sections)) {
      throw new TypeError('The saved quest draft is malformed.')
    }
    const form = parsed as QuestFormState
    if (!('replaceTarget' in parsed)) {
      // Legacy drafts contain the form but cannot identify the original quest.
      // Null requires an explicit editing target or confirmation to create one.
      return { form, replaceTarget: null, error: null }
    }
    if (parsed.replaceTarget !== null && typeof parsed.replaceTarget !== 'string') {
      throw new TypeError('The saved quest draft has an invalid editing target.')
    }
    return { form, replaceTarget: parsed.replaceTarget, error: null }
  } catch (caught: unknown) {
    return { form: defaultQF(), replaceTarget: '', error: `Could not restore your local quest draft: ${errorMessage(caught)}. The saved data has not been deleted.` }
  }
}

export const AdminPanel: React.FC = () => {
  const navigate = useNavigate()
  const { user, refreshMaintenanceMode } = useAuth()

  const [tab, setTab] = useState<Tab>('dashboard')
  const [navOpen, setNavOpen] = useState(false)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [userImages, setUserImages] = useState<Map<string, ProfileImageUrls>>(new Map())
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [userSearch, setUserSearch] = useState('')
  const [debouncedUserSearch, setDebouncedUserSearch] = useState('')
  const [userFilter, setUserFilter] = useState<'all' | 'active' | 'banned' | 'admin'>('all')
  const [userPage, setUserPage] = useState(0)
  const [userResultCount, setUserResultCount] = useState(0)
  const [usersLoading, setUsersLoading] = useState(false)
  const userFetchSequence = useRef(0)
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [maintenanceOn, setMaintenanceOn] = useState(false)
  const [maintenanceMsg, setMaintenanceMsg] = useState('')
  const [stats, setStats] = useState({ total: 0, active: 0, banned: 0, admins: 0 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const toastTimer = useRef<number | null>(null)
  const [liveHelp, setLiveHelp] = useState<{ session: SupportSession; learnerName: string } | null>(null)
  const liveHelpRef = useRef<SupportSession | null>(null)
  useEffect(() => { liveHelpRef.current = liveHelp?.session ?? null }, [liveHelp])
  useEffect(() => () => {
    const activeSession = liveHelpRef.current
    if (activeSession) void endSupportSession(activeSession.id).catch(caught => {
      console.error('Could not end help session on admin panel exit', { sessionId: activeSession.id, error: errorMessage(caught) })
    })
  }, [])

  // New announcement form
  const [newAnn, setNewAnn] = useState({ title: '', body: '', priority: 'info' as Announcement['priority'], ispinned: false })

  // Quest generator
  const savedQuestDraft = useMemo(() => loadAdminQuestDraft(user?.id ?? ''), [user?.id])
  const [questForm,      setQuestForm]      = useState<QuestFormState>(savedQuestDraft.form)
  const [questDraftError, setQuestDraftError] = useState<string | null>(savedQuestDraft.error)
  const invalidSavedDraft = useRef(Boolean(savedQuestDraft.error))
  const questDraftReady = useRef(false)
  const [existingQuests, setExistingQuests] = useState<ExistingQuest[]>([])
  const [questLevelInfoPhases, setQuestLevelInfoPhases] = useState<string[]>([])
  const [replaceTarget,  setReplaceTarget]  = useState(savedQuestDraft.replaceTarget)
  const [questSaving,    setQuestSaving]    = useState(false)
  const [questSubTab,    setQuestSubTab]    = useState<'create' | 'manage'>('create')
  const [objectiveDraft, setObjectiveDraft] = useState('')
  const [lessonDraft,    setLessonDraft]    = useState('')
  const [hintDraft,      setHintDraft]      = useState('')
  const [questsLoading,  setQuestsLoading]  = useState(false)
  const [questActionId,  setQuestActionId]  = useState<string | null>(null)
  const [questSearch,    setQuestSearch]    = useState('')
  const [questLevelFilter, setQuestLevelFilter] = useState<string>('all')
  const [questStatusFilter, setQuestStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [customLevelDraft, setCustomLevelDraft] = useState('')
  const [fixingPop,      setFixingPop]      = useState(false)
  const [fixPopResult,   setFixPopResult]   = useState<string | null>(null)
  const [autoQuestLoading, setAutoQuestLoading] = useState(false)
  const [autoQuestResult, setAutoQuestResult] = useState<string | null>(null)
  const qSet = (patch: Partial<QuestFormState>) => setQuestForm(p => ({ ...p, ...patch }))
  const setQuestActivity = (activity: QuestActivityFlag, checked: boolean) => {
    setQuestForm(previous => ({ ...previous, [activity]: checked }))
  }

  const hasQuestContent = (form: QuestFormState): boolean => Boolean(
    form.title.trim() || form.description.trim() || form.tutorial_title.trim() ||
    form.tutorial_body.trim() || form.theory_sections.length ||
    form.level !== 1 || form.difficulty !== 'beginner' || form.basexp !== 100 ||
    form.requiredxp !== 0 || form.sortorder !== 99 || !form.isactive ||
    !form.act_mc || form.act_drag || form.act_balloon || form.act_ordering || form.act_codefill ||
    form.objectives.some(value => value.trim()) ||
    form.mc_questions.some(question => question.question.trim()) ||
    form.balloon_questions.some(question => question.question.trim()) ||
    form.code_fill_items.length || form.hints.length ||
    form.drag_problems.some(problem => problem.question.trim()) ||
    form.ordering_problems.some(problem => problem.question.trim())
  )

  useEffect(() => {
    if (!user?.id) return
    if (invalidSavedDraft.current) return
    if (!questDraftReady.current) { questDraftReady.current = true; return }
    try {
      const key = `codesense-admin-quest-draft:${user.id}`
      if (hasQuestContent(questForm) || replaceTarget) localStorage.setItem(key, JSON.stringify({ ...questForm, replaceTarget }))
      else localStorage.removeItem(key)
      setQuestDraftError(null)
    } catch (caught: unknown) {
      setQuestDraftError(`Could not save the local quest draft: ${errorMessage(caught)}`)
    }
  }, [questForm, replaceTarget, user?.id])

  useEffect(() => {
    if (!hasQuestContent(questForm)) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [questForm])

  const questLevelOptions = useMemo(() => {
    const levels = new Set<number>([1, 2, 3, questForm.level])
    for (const quest of existingQuests) {
      if (typeof quest.level === 'number' && Number.isFinite(quest.level)) {
        levels.add(quest.level)
      }
    }
    for (const phase of questLevelInfoPhases) {
      if (isCampaignPhase(phase)) levels.add(levelForPhase(phase))
    }
    return Array.from(levels).sort((a, b) => a - b)
  }, [existingQuests, questForm.level, questLevelInfoPhases])

  const nextQuestLevel = useMemo(
    () => Math.max(3, ...questLevelOptions) + 1,
    [questLevelOptions]
  )

  const addCustomLevel = (level = Number(customLevelDraft)) => {
    if (!Number.isInteger(level) || level < 1) {
      showToast('Enter a whole level number, like 4', 'error')
      return
    }
    qSet({ level, difficulty: level <= 1 ? 'beginner' : level === 2 ? 'intermediate' : level === 3 ? 'advanced' : 'expert' })
    setQuestLevelFilter(String(level))
    setCustomLevelDraft('')
    setQuestSubTab('create')
    showToast(`Level ${level} is ready. Add learning material and quests, then save.`)
  }

  const ensureLevelInfoForLevel = async (level: number) => {
    const phase = phaseForLevel(level)
    const row = {
      phase,
      title: levelName(level),
      subtitle: `Level ${level}`,
      description: level <= 3 ? null : 'New learning material and quests.',
      accent_color: defaultLevelAccent(level),
      banner_url: null,
    }
    const { error } = await supabase
      .from('level_info')
      .upsert(row, { onConflict: 'phase', ignoreDuplicates: true })
    if (error) throw new Error(`Level metadata failed: ${error.message}`)
  }

  const removeCustomLevel = async (level: number) => {
    if (level <= 3) {
      showToast('Default Levels 1-3 cannot be removed', 'error')
      return
    }
    const attachedQuests = existingQuests.filter(q => q.level === level)
    if (attachedQuests.length > 0) {
      showToast(`Move or delete ${attachedQuests.length} quest(s) in Level ${level} before removing it`, 'error')
      return
    }
    if (!window.confirm(`Remove Level ${level}? This removes its dashboard metadata only.`)) return

    try {
      const { error } = await supabase
        .from('level_info')
        .delete()
        .eq('phase', phaseForLevel(level))
      if (error) throw error
      setQuestLevelInfoPhases(prev => prev.filter(phase => phase !== phaseForLevel(level)))
      if (questForm.level === level) qSet({ level: 1, difficulty: 'beginner' })
      if (questLevelFilter === String(level)) setQuestLevelFilter('all')
      showToast(`Level ${level} removed`)
    } catch (error: unknown) {
      showToast(`Failed to remove level: ${errorMessage(error)}`, 'error')
    }
  }

  const addObjectivesFromDraft = (replace = false) => {
    const items = parseLineList(objectiveDraft)
    if (!items.length) { showToast('Paste at least one objective first', 'error'); return }
    qSet({ objectives: replace ? items : [...questForm.objectives.filter(Boolean), ...items] })
    setObjectiveDraft('')
  }

  const addLessonSectionsFromDraft = (replace = false) => {
    const sections = lessonTextToSections(lessonDraft)
    if (!sections.length) { showToast('Paste lesson material first', 'error'); return }
    qSet({ theory_sections: replace ? sections : [...questForm.theory_sections, ...sections] })
    setLessonDraft('')
  }

  const addHintsFromDraft = (replace = false) => {
    const rows = parseHintLines(hintDraft)
    if (!rows.length) { showToast('Paste at least one hint first', 'error'); return }
    qSet({ hints: replace ? rows : [...questForm.hints, ...rows] })
    setHintDraft('')
  }
  const generateQuestHints = (replace = false) => {
    const selectedTabs = selectedTabsForForm(questForm)
    if (!selectedTabs.length) {
      showToast('Select at least one activity before generating hints', 'error')
      return
    }

    const tabs = selectedTabs.filter(tab => tabHasContent(questForm, tab))
    const emptyTabs = selectedTabs.filter(tab => !tabHasContent(questForm, tab))

    if (!tabs.length) {
      showToast('Add activity content before generating hints', 'error')
      return
    }

    const previewQuest = questPreviewFromForm(questForm)
    const rows: HintFormRow[] = tabs.flatMap(tab =>
      generateAutoHints(previewQuest, tab).map((hint, i) => ({
        id: `h_auto_${tab}_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        title: hint.title,
        body: hint.body,
        icon: hint.icon ?? '',
        activity: tab,
        _extra: {},
      }))
    )

    qSet({ hints: replace ? rows : [...questForm.hints, ...rows] })
    const skipped = emptyTabs.length ? ` Skipped empty: ${emptyTabs.map(tabLabel).join(', ')}.` : ''
    showToast(`${replace ? 'Generated' : 'Added'} ${rows.length} editable hints for ${tabs.map(tabLabel).join(', ')}.${skipped}`, 'success')
  }

  const generateQuestFromPdf = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      showToast('Please upload a PDF file', 'error')
      return
    }
    if (hasQuestContent(questForm) && !window.confirm('Replace the current unsaved quest draft with the PDF-generated draft?')) return

    setAutoQuestLoading(true)
    setAutoQuestResult(null)
    try {
      const text = await extractTextFromPdf(file)
      if (text.trim().length < 120) {
        throw new Error('Could not extract enough readable text from this PDF.')
      }

      const draft = generateQuestDraftFromText(text, file.name)
      setQuestForm(prev => ({
        ...defaultQF(),
        ...draft,
        level: prev.level,
        difficulty: prev.difficulty,
        basexp: prev.basexp,
        requiredxp: prev.requiredxp,
        sortorder: prev.sortorder,
        isactive: prev.isactive,
        game_items: [],
        drop_zones: [],
      }))
      setReplaceTarget('')
      setAutoQuestResult(
        `Generated ${draft.theory_sections.length} theory section(s), ${draft.objectives.length} objective(s), ${draft.mc_questions.length} quiz question(s), ${draft.drag_problems[0]?.items.length ?? 0} drag match(es), ${draft.ordering_problems[0]?.items.length ?? 0} ordering item(s), and ${draft.code_fill_items.length} code-fill item(s).`
      )
      showToast('PDF quest draft generated. Review it, then save.', 'success')
    } catch (error: unknown) {
      const message = errorMessage(error)
      setAutoQuestResult(message)
      showToast(message, 'error')
    } finally {
      setAutoQuestLoading(false)
    }
  }

  const managedQuests = useMemo(() => {
    const q = questSearch.trim().toLowerCase()
    return existingQuests.filter(quest => {
      if (questLevelFilter !== 'all' && quest.level !== Number(questLevelFilter)) return false
      if (questStatusFilter === 'active' && !quest.isactive) return false
      if (questStatusFilter === 'inactive' && quest.isactive) return false
      if (!q) return true
      return [
        quest.title,
        quest.description ?? '',
        quest.difficulty ?? '',
        quest.question_type ?? '',
      ].some(value => value.toLowerCase().includes(q))
    })
  }, [existingQuests, questLevelFilter, questSearch, questStatusFilter])

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
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    setToast({ msg, type })
    toastTimer.current = window.setTimeout(() => setToast(null), type === 'error' ? 8000 : 4000)
  }

  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current) }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedUserSearch(userSearch), 300)
    return () => window.clearTimeout(timer)
  }, [userSearch])

  // Schema health — lets the UI tell the user which tables/columns are missing
  const [schemaIssues, setSchemaIssues] = useState<string[]>([])
  const addIssue = (msg: string) =>
    setSchemaIssues(prev => prev.includes(msg) ? prev : [...prev, msg])

  // ── Data fetchers ──────────────────────────────────────────────────────────
  const fetchUserStats = useCallback(async () => {
    const [total, notBanned, banned, admins] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact', head: true }),
      supabase.from('users').select('id', { count: 'exact', head: true }).or('is_banned.eq.false,is_banned.is.null'),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('is_banned', true),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('is_admin', true),
    ])
    for (const result of [total, notBanned, banned, admins]) {
      if (result.error) { addIssue(`users count: ${result.error.message}`); return }
    }
    setStats({ total: total.count ?? 0, active: notBanned.count ?? 0, banned: banned.count ?? 0, admins: admins.count ?? 0 })
  }, [])

  const fetchUsers = useCallback(async () => {
    const sequence = ++userFetchSequence.current
    setUsersLoading(true)
    let query = supabase
      .from('users')
      .select('id, playername, email, totalxp, currentlevel, charactertype, user_type, is_admin, is_banned, ban_reason, createdat, lastactive, sandbox_runs', { count: 'exact' })
    if (userFilter === 'active') query = query.or('is_banned.eq.false,is_banned.is.null')
    if (userFilter === 'banned') query = query.eq('is_banned', true)
    if (userFilter === 'admin') query = query.eq('is_admin', true)
    const search = debouncedUserSearch.trim().replace(/[^a-zA-Z0-9@._ -]/g, '')
    if (search) query = query.or(`playername.ilike.%${search}%,email.ilike.%${search}%`)
    const { data, error, count } = await query
      .order('createdat', { ascending: false })
      .range(userPage * 25, userPage * 25 + 24)
    if (sequence !== userFetchSequence.current) return
    setUsersLoading(false)
    if (error) {
      addIssue(`users table: ${error.message}`)
      return
    }
    if (data) {
      setUsers(data as AdminUser[])
      setUserResultCount(count ?? 0)
      try {
        const images = await getAvatarUrlMap((data as AdminUser[]).map(row => row.id))
        if (sequence === userFetchSequence.current) { setUserImages(images); setAvatarError(null) }
      } catch (err: unknown) {
        if (sequence === userFetchSequence.current) setAvatarError(`User avatars could not be loaded: ${errorMessage(err)}`)
      }
    }
  }, [debouncedUserSearch, userFilter, userPage])

  const fetchAuditLogs = useCallback(async () => {
    // Try with FK joins first; fall back to plain select if the joins aren't set up.
    const joined = await supabase
      .from('admin_audit_log')
      .select('*, admin:admin_id(playername), target:target_user_id(playername)')
      .order('created_at', { ascending: false })
      .limit(100)
    let data = joined.data
    const error = joined.error
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
        if (row.key === 'maintenance_message') setMaintenanceMsg(settingStringValue(row.value))
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
    setQuestsLoading(true)
    try {
      const { data, error } = await supabase
        .from('quests')
        .select('id, title, level, difficulty, basexp, sortorder, isactive, phase, question_type, description')
        .eq('mode', 'campaign')
        .order('level', { ascending: true })
        .order('sortorder', { ascending: true })
      if (error) {
        console.warn('[fetchExistingQuests]', error.message)
        addIssue(`quests table: ${error.message}`)
        showToast(`Failed to load quests: ${error.message}`, 'error')
        return
      }
      setExistingQuests(data ?? [])
      const { data: levels, error: levelErr } = await supabase
        .from('level_info')
        .select('phase')
      if (levelErr) {
        console.warn('[fetchQuestLevelInfo]', levelErr.message)
      } else {
        setQuestLevelInfoPhases((levels ?? []).map(row => row.phase).filter(Boolean))
      }
    } finally {
      setQuestsLoading(false)
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      await Promise.all([fetchUserStats(), fetchAuditLogs(), fetchMaintenance(), fetchAnnouncements()])
      setLoading(false)
    }
    load()
  }, [fetchUserStats, fetchAuditLogs, fetchMaintenance, fetchAnnouncements])

  useEffect(() => { void fetchUsers() }, [fetchUsers])

  useEffect(() => {
    if (tab === 'quests') fetchExistingQuests()
  }, [tab, fetchExistingQuests])

  // ── Actions ────────────────────────────────────────────────────────────────
  // Helper: returns count of rows actually changed — detects silent RLS denial.
  const adminUpdate = async (targetId: string, changes: AdminUserChanges): Promise<{ ok: boolean; msg: string }> => {
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
    try {
      const res = await adminUpdate(target.id, { is_banned: true, ban_reason: reason, banned_at: new Date().toISOString() })
      if (!res.ok) {
        showToast(`Ban failed: ${res.msg}`, 'error')
        return
      }
      await fetchUsers()
      await fetchUserStats()
      try {
        await writeAuditLog(user.id, 'ban', target.id, { reason, playername: target.playername })
        await fetchAuditLogs()
        showToast(`${target.playername} has been banned`)
      } catch (auditError: unknown) {
        showToast(`${target.playername} was banned, but the audit entry failed: ${errorMessage(auditError)}`, 'error')
      }
    } catch (error: unknown) {
      showToast(`Ban may have succeeded, but confirmation failed: ${errorMessage(error)}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const unbanUser = async (target: AdminUser) => {
    if (!user) return
    setSaving(true)
    try {
      const res = await adminUpdate(target.id, { is_banned: false, ban_reason: null, banned_at: null })
      if (!res.ok) {
        showToast(`Unban failed: ${res.msg}`, 'error')
        return
      }
      await fetchUsers()
      await fetchUserStats()
      try {
        await writeAuditLog(user.id, 'unban', target.id, { playername: target.playername })
        await fetchAuditLogs()
        showToast(`${target.playername} has been unbanned`)
      } catch (auditError: unknown) {
        showToast(`${target.playername} was unbanned, but the audit entry failed: ${errorMessage(auditError)}`, 'error')
      }
    } catch (error: unknown) {
      showToast(`Unban may have succeeded, but confirmation failed: ${errorMessage(error)}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const toggleAdmin = async (target: AdminUser) => {
    if (!user || target.id === user.id) return
    setSaving(true)
    try {
      const next = !target.is_admin
      const res = await adminUpdate(target.id, { is_admin: next })
      if (!res.ok) {
        showToast(`Failed to change admin status: ${res.msg}`, 'error')
        return
      }
      await fetchUsers()
      await fetchUserStats()
      try {
        await writeAuditLog(user.id, next ? 'grant_admin' : 'revoke_admin', target.id, { playername: target.playername })
        await fetchAuditLogs()
        showToast(`${target.playername} admin status ${next ? 'granted' : 'revoked'}`)
      } catch (auditError: unknown) {
        showToast(`${target.playername} admin status changed, but the audit entry failed: ${errorMessage(auditError)}`, 'error')
      }
    } catch (error: unknown) {
      showToast(`Admin status may have changed, but confirmation failed: ${errorMessage(error)}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const requestLiveHelp = async (target: AdminUser): Promise<void> => {
    if (import.meta.env.VITE_SUPPORT_ENABLED !== 'true') {
      showToast('Live help is not enabled. Apply the support migration, set VITE_SUPPORT_ENABLED=true in Netlify, and redeploy the frontend.', 'error')
      return
    }
    try {
      assertSupportVideoPlayback()
      const session = await requestSupportSession(target.id)
      setLiveHelp({ session, learnerName: target.playername })
    } catch (caught: unknown) {
      showToast(`Could not request live help: ${errorMessage(caught)}`, 'error')
    }
  }

  const saveMaintenance = async () => {
    if (!user) return
    setSaving(true)
    try {
      const [modeResult, messageResult] = await Promise.all([
        supabase.from('system_settings').upsert(
          { key: 'maintenance_mode', value: maintenanceOn, updated_by: user.id },
          { onConflict: 'key' }
        ),
        supabase.from('system_settings').upsert(
          { key: 'maintenance_message', value: maintenanceMsg || '', updated_by: user.id },
          { onConflict: 'key' }
        ),
      ])
      if (modeResult.error) throw modeResult.error
      if (messageResult.error) throw messageResult.error
      await refreshMaintenanceMode()
      try {
        await writeAuditLog(user.id, maintenanceOn ? 'maintenance_on' : 'maintenance_off', undefined, { message: maintenanceMsg })
        showToast(`Maintenance mode ${maintenanceOn ? 'enabled' : 'disabled'}`)
      } catch (auditError: unknown) {
        showToast(`Maintenance settings saved, but the audit entry failed: ${errorMessage(auditError)}`, 'error')
      }
    } catch (error: unknown) {
      showToast(`Maintenance settings may have changed; verify them before retrying: ${errorMessage(error)}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const createAnnouncement = async () => {
    if (!user || !newAnn.title.trim() || !newAnn.body.trim()) {
      showToast('Title and body are required', 'error'); return
    }
    try {
      const { data, error } = await supabase.from('announcements').insert({
        title: newAnn.title.trim(), body: newAnn.body.trim(),
        priority: newAnn.priority, ispinned: newAnn.ispinned,
        author: user.playerName,
      }).select('id')
      if (error) throw error
      if (data?.length !== 1) throw new Error('Announcement insert returned no row. Check admin INSERT and SELECT policies.')
      await fetchAnnouncements()
      setNewAnn({ title: '', body: '', priority: 'info', ispinned: false })
      try {
        await writeAuditLog(user.id, 'announcement_create', undefined, { title: newAnn.title })
        showToast('Announcement published')
      } catch (auditError: unknown) {
        showToast(`Announcement published, but the audit entry failed: ${errorMessage(auditError)}`, 'error')
      }
    } catch (error: unknown) {
      showToast(`Announcement may have been published; verify before retrying: ${errorMessage(error)}`, 'error')
    }
  }

  const deleteAnnouncement = async (id: string, title: string) => {
    if (!user) return
    if (!window.confirm(`Delete "${title}"?`)) return
    try {
      const { data, error } = await supabase.from('announcements').delete().eq('id', id).select('id')
      if (error) throw error
      if (data?.length !== 1) throw new Error(`Announcement ${id} was not deleted. Check that it still exists and admin DELETE policy allows this action.`)
      await fetchAnnouncements()
      try {
        await writeAuditLog(user.id, 'announcement_delete', undefined, { title })
        showToast('Announcement deleted')
      } catch (auditError: unknown) {
        showToast(`Announcement deleted, but the audit entry failed: ${errorMessage(auditError)}`, 'error')
      }
    } catch (error: unknown) {
      showToast(`Announcement may have been deleted; verify before retrying: ${errorMessage(error)}`, 'error')
    }
  }

  // ── Quest actions ──────────────────────────────────────────────────────────
  const resetQuestForm = () => {
    if (hasQuestContent(questForm) && !window.confirm('Discard this unsaved quest draft?')) return
    setQuestForm(defaultQF())
    setReplaceTarget('')
    setObjectiveDraft('')
    setLessonDraft('')
    setHintDraft('')
  }

  const fixPopLanguage = async () => {
    if (!user) return
    if (!window.confirm(
      'Scan all campaign quests and replace balloon-pop phrasing ("Pop the item…", "Pop the…") ' +
      'in Multiple Choice questions with MC-appropriate language. Continue?'
    )) return
    setFixingPop(true)
    setFixPopResult(null)
    try {
      const { data, error } = await supabase
        .from('quests')
        .select('id, title, mc_questions')
        .eq('mode', 'campaign')
        .not('mc_questions', 'is', null)
      if (error) throw error
      if (!data?.length) { setFixPopResult('No quests with MC questions found.'); setFixingPop(false); return }

      let fixedQuests = 0
      let fixedQs = 0
      for (const quest of data) {
        if (!Array.isArray(quest.mc_questions) || quest.mc_questions.length === 0) continue
        const { patched, changed } = patchMCQuestions(quest.mc_questions)
        fixedQs += changed
        if (changed > 0) {
          const { data: updated, error: ue } = await supabase
            .from('quests')
            .update({ mc_questions: patched })
            .eq('id', quest.id)
            .select('id')
          if (ue) throw ue
          if (!updated?.length) throw new Error(`Update was blocked for "${quest.title}". Check quest update permissions.`)
          fixedQuests++
        }
      }
      const msg = fixedQs > 0
        ? `Fixed ${fixedQs} question(s) across ${fixedQuests} quest(s).`
        : 'No balloon-pop language found in any MC questions.'
      setFixPopResult(msg)
      if (fixedQuests > 0) {
        await writeAuditLog(user.id, 'quest_bulk_fix', undefined, { action: 'fix_pop_language', fixedQuests, fixedQs })
        await fetchExistingQuests()
      }
    } catch (error: unknown) {
      setFixPopResult(`Error: ${errorMessage(error)}`)
    }
    setFixingPop(false)
  }

  const saveQuest = async (replaceId?: string) => {
    if (!user || !questForm.title.trim()) { showToast('Title is required', 'error'); return }
    const validation = validateQuestBuilderForm(questForm)
    if (!validation.ok) {
      showToast(validation.errors.slice(0, 3).join(' '), 'error')
      setAutoQuestResult(`Fix before saving: ${validation.errors.join(' ')}`)
      return
    }
    const phase = levelToPhase(questForm.level)
    const qTypeMap: Record<string, string> = {
      act_drag: 'drag_drop', act_balloon: 'pop_balloon', act_mc: 'multiple_choice',
      act_ordering: 'ordering', act_codefill: 'code_fill',
    }
    const firstActive = (['act_drag', 'act_balloon', 'act_mc', 'act_ordering', 'act_codefill'] as const)
      .find(k => questForm[k])
    const question_type = firstActive ? qTypeMap[firstActive] : null

    const theory_sections = questForm.theory_sections
      .map(({ id: _id, ...s }) => ({
        type: s.type || 'default',
        heading: s.heading || undefined,
        body: s.body || undefined,
        code: s.code || undefined,
        language: s.language || undefined,
        table_headers: s.table_headers?.length ? s.table_headers : undefined,
        table_rows: s.table_rows?.length ? s.table_rows : undefined,
      }))
      .filter(s => s.body || s.code || (s.type === 'table' && s.table_headers?.length))

    // Per-question hint is dropped from the payload when blank so JSONB stays
    // clean. Empty-string `hint` would otherwise pollute every MC row.
    const mc_questions_arr = [
      ...(questForm.act_mc ? normalizeMCQuestions(questForm.mc_questions).map((q, i) => ({
          id: `mc_${i + 1}`, question: q.question.trim(), options: q.options,
          correct: q.correct, explanation: q.explanation, mode: 'mc' as const,
          ...(q.hint.trim() ? { hint: q.hint.trim() } : {}),
        })) : []),
      ...(questForm.act_balloon ? normalizeMCQuestions(questForm.balloon_questions).map((q, i) => ({
          id: `bp_${i + 1}`, question: q.question.trim(), options: q.options,
          correct: q.correct,
          correctAnswers: (q.correctAnswers?.length ? q.correctAnswers : [q.correct])
            .filter(idx => Number.isInteger(idx) && idx >= 0 && idx < q.options.length),
          explanation: q.explanation, mode: 'balloon' as const,
          ...(q.hint.trim() ? { hint: q.hint.trim() } : {}),
        })) : []),
    ]
    const mc_questions = mc_questions_arr.length > 0 ? mc_questions_arr : null

    // Drag & Drop only (balloon no longer uses game_items)
    const game_items = (() => {
      if (questForm.act_drag && questForm.drag_problems.length > 0) {
        const all: Array<{
          id: string
          label: string
          color: string
          problem_id: string
          question: string
        }> = []
        questForm.drag_problems.forEach(p => {
          const validIds = new Set(p.items.filter(g => g.label.trim()).map(g => g.id))
          const hasValidZone = p.drop_zones.some(z => z.label.trim() && validIds.has(z.accepted))
          if (!hasValidZone) return
          p.items
            .filter(g => g.label.trim())
            .forEach(g => all.push({ id: g.id, label: g.label.trim(), color: g.color, problem_id: p.id, question: p.question.trim() }))
        })
        return all.length > 0 ? all : null
      }
      return null
    })()

    const drop_zones_final = questForm.act_drag && questForm.drag_problems.length > 0
        ? (() => {
          const all: Array<{
            id: string
            label: string
            accepted: string
            problem_id: string
          }> = []
          questForm.drag_problems.forEach(p => {
            const validIds = new Set(p.items.filter(g => g.label.trim()).map(g => g.id))
            p.drop_zones
              .filter(z => z.label.trim() && validIds.has(z.accepted))
              .forEach(z => all.push({ id: z.id, label: z.label.trim(), accepted: z.accepted, problem_id: p.id }))
          })
          return all.length > 0 ? all : null
        })()
      : null

    const ordering_items = questForm.act_ordering && questForm.ordering_problems.length > 0
        ? (() => {
          const all: Array<{
            id: string
            label: string
            description: string | undefined
            correct_order: number
            problem_id: string
            question: string
          }> = []
          questForm.ordering_problems.forEach(p =>
            p.items
            .filter(o => o.label.trim())
            .forEach((o, i) => all.push({
              id: o.id, label: o.label.trim(), description: o.description.trim() || undefined,
              correct_order: i + 1, problem_id: p.id, question: p.question,
            }))
          )
          return all.length > 0 ? all : null
        })()
      : null

    const code_fill_items = questForm.act_codefill && questForm.code_fill_items.length > 0
      ? questForm.code_fill_items.filter(c => c.code_lines.trim() && parseCodeFillAnswers(c.answers).length > 0).map(c => ({
          id: c.id,
          code_lines: c.code_lines.split('\n'),
          language: c.language || 'c',
          answers: parseCodeFillAnswers(c.answers),
          hint: c.hint || undefined,
          caption: c.caption || undefined,
        }))
      : null

    const questData = {
      title: questForm.title.trim(), description: questForm.description.trim() || null,
      difficulty: campaignDifficultyFromForm(questForm.difficulty), level: questForm.level, phase, mode: 'campaign',
      basexp: questForm.basexp, requiredxp: questForm.requiredxp,
      sortorder: questForm.sortorder, isactive: questForm.isactive,
      question_type,
      objectives: questForm.objectives.filter(Boolean).length > 0 ? questForm.objectives.filter(Boolean) : null,
      hints: serializeHints(questForm.hints),
      tutorial_title: questForm.tutorial_title.trim() || null,
      tutorial_body: questForm.tutorial_body.trim() || null,
      theory_sections: theory_sections.length > 0 ? theory_sections : null,
      mc_questions, game_items, drop_zones: drop_zones_final, ordering_items, code_fill_items,
    }

    setQuestSaving(true)
    try {
      await ensureLevelInfoForLevel(questForm.level)
      if (replaceId) {
        const { data, error } = await supabase.from('quests').update(questData).eq('id', replaceId).select('id')
        if (error) throw error
        if (data?.length !== 1) throw new Error(`Quest ${replaceId} was not updated. Check that it still exists and that admin UPDATE policy allows this action.`)
      } else {
        const { data, error } = await supabase.from('quests').insert(questData).select('id')
        if (error) throw error
        if (data?.length !== 1) throw new Error('Quest insert returned no row. Check admin INSERT and SELECT policies before retrying.')
      }
      await fetchExistingQuests()
      try {
        localStorage.removeItem(`codesense-admin-quest-draft:${user.id}`)
      } catch (storageError: unknown) {
        setQuestDraftError(`Quest saved, but the local draft could not be cleared: ${errorMessage(storageError)}`)
      }
      setQuestForm(defaultQF())
      setReplaceTarget('')
      setObjectiveDraft('')
      setLessonDraft('')
      setHintDraft('')
      try {
        await writeAuditLog(user.id, replaceId ? 'quest_update' : 'quest_create', undefined, {
          title: questForm.title, level: questForm.level, id: replaceId ?? null,
        })
        showToast(`Quest ${replaceId ? 'updated' : 'created'} successfully`)
      } catch (auditError: unknown) {
        showToast(`Quest ${replaceId ? 'updated' : 'created'}, but the audit entry failed: ${errorMessage(auditError)}`, 'error')
      }
    } catch (error: unknown) {
      showToast(`Failed: ${errorMessage(error)}`, 'error')
    }
    setQuestSaving(false)
  }

  const loadQuestForEdit = async (summary: ExistingQuest): Promise<void> => {
    if (hasQuestContent(questForm) && !window.confirm('Replace your current unsaved quest draft with this quest?')) return
    setQuestActionId(summary.id)
    try {
      const { data, error } = await supabase.from('quests')
        .select('id, title, level, difficulty, basexp, requiredxp, sortorder, isactive, phase, question_type, description, tutorial_title, tutorial_body, theory_sections, objectives, hints, mc_questions, game_items, drop_zones, ordering_items, code_fill_items')
        .eq('id', summary.id).maybeSingle()
      if (error || !data) throw new Error(`Quest ${summary.id} could not be loaded: ${error?.message ?? 'row not found'}`)
      applyQuestForEdit(data as ExistingQuest)
    } catch (caught: unknown) {
      showToast(`Could not load quest for editing: ${errorMessage(caught)}`, 'error')
    } finally {
      setQuestActionId(null)
    }
  }

  const applyQuestForEdit = (q: ExistingQuest) => {
    const isDrag = q.question_type === 'drag_drop' || !!(q.game_items?.length && q.drop_zones?.length)

    // Split mc_questions into balloon and MC buckets.
    // New rows have a `mode` field; legacy rows without mode use question_type.
    const allMCQs = q.mc_questions ?? []
    const hasMode = allMCQs.some(m => m.mode === 'balloon' || m.mode === 'mc')
    const balloonQsDB = hasMode
      ? allMCQs.filter(m => m.mode === 'balloon')
      : q.question_type === 'pop_balloon' ? allMCQs : []
    const mcQsDB = hasMode
      ? allMCQs.filter(m => m.mode !== 'balloon')
      : q.question_type === 'pop_balloon' ? [] : allMCQs

    // Reconstruct drag problems from flat game_items + drop_zones (grouped by problem_id)
    const dragProblems: QFormDragProblem[] = (() => {
      if (!isDrag || !q.game_items?.length || !q.drop_zones?.length) return [newDragProblem()]
      const problemMap = new Map<string, QFormDragProblem>()
      q.game_items.forEach(g => {
        const pid = g.problem_id ?? 'default'
        if (!problemMap.has(pid)) problemMap.set(pid, { id: pid, question: g.question ?? '', items: [], drop_zones: [] })
        problemMap.get(pid)!.items.push({ id: g.id ?? String(Math.random()), label: g.label ?? '', color: g.color ?? '#58a6ff' })
      })
      q.drop_zones.forEach(z => {
        const pid = z.problem_id ?? 'default'
        if (!problemMap.has(pid)) problemMap.set(pid, { id: pid, question: z.question ?? '', items: [], drop_zones: [] })
        problemMap.get(pid)!.drop_zones.push({ id: z.id ?? String(Math.random()), label: z.label ?? '', accepted: z.accepted ?? '' })
      })
      return problemMap.size > 0 ? Array.from(problemMap.values()) : [newDragProblem()]
    })()

    // Reconstruct ordering problems from flat ordering_items (grouped by problem_id)
    const orderingProblems: QFormOrderProblem[] = (() => {
      if (!q.ordering_items?.length) return [newOrderProblem()]
      const problemMap = new Map<string, QFormOrderProblem>()
      q.ordering_items
        .slice().sort((a, b) => (a.correct_order ?? 0) - (b.correct_order ?? 0))
        .forEach(o => {
          const pid = o.problem_id ?? 'default'
          if (!problemMap.has(pid)) problemMap.set(pid, { id: pid, question: o.question ?? '', items: [] })
          problemMap.get(pid)!.items.push({ id: o.id ?? String(Math.random()), label: o.label ?? '', description: o.description ?? '' })
        })
      return problemMap.size > 0 ? Array.from(problemMap.values()) : [newOrderProblem()]
    })()

    setQuestForm({
      title: q.title ?? '', description: q.description ?? '',
      difficulty: campaignDifficultyToForm(q.difficulty), level: Number(q.level ?? 1),
      basexp: q.basexp ?? 100, requiredxp: q.requiredxp ?? 0,
      sortorder: q.sortorder ?? 99, isactive: q.isactive ?? true,
      tutorial_title: q.tutorial_title ?? '', tutorial_body: q.tutorial_body ?? '',
      theory_sections: (q.theory_sections ?? []).map((s, i) => ({
        id: String(i), type: s.type ?? 'default', heading: s.heading ?? '',
        body: s.body ?? '', code: s.code ?? '', language: s.language ?? 'c',
        table_headers: s.table_headers ?? [], table_rows: s.table_rows ?? [[]],
      })),
      objectives: q.objectives?.length ? q.objectives : [''],
      act_mc:       mcQsDB.length > 0,
      act_drag:     isDrag,
      act_balloon:  balloonQsDB.length > 0,
      act_ordering: !!q.ordering_items?.length,
      act_codefill: !!q.code_fill_items?.length,
      mc_questions: mcQsDB.length > 0
        ? mcQsDB.map((question, index) => storedChoiceQuestionToForm(question, `mc_${index + 1}`))
        : [{ id: '1', question: '', options: ['', '', '', ''], correct: 0, explanation: '', hint: '' }],
      balloon_questions: balloonQsDB.length > 0
        ? balloonQsDB.map((question, index) => storedChoiceQuestionToForm(question, `bp_${index + 1}`))
        : [{ id: 'b1', question: '', options: ['', '', '', ''], correct: 0, correctAnswers: [0], explanation: '', hint: '' }],
      drag_problems: dragProblems,
      ordering_problems: orderingProblems,
      code_fill_items: (q.code_fill_items ?? []).map(c => ({
        id: c.id ?? String(Math.random()),
        code_lines: Array.isArray(c.code_lines) ? c.code_lines.join('\n') : (c.code_lines ?? ''),
        language: c.language ?? 'c',
        answers: Array.isArray(c.answers) ? c.answers.join(', ') : (c.answers ?? ''),
        hint: c.hint ?? '', caption: c.caption ?? '',
      })),
      hints: loadHintsForEdit(q.hints),
      game_items: [], drop_zones: [],
    })
    setReplaceTarget(q.id)
    setQuestSubTab('create')
    showToast(`Loaded "${q.title}" for editing`)
  }

  const toggleQuestActive = async (q: ExistingQuest) => {
    if (!user) return
    setQuestActionId(q.id)
    try {
      const { data, error } = await supabase
        .from('quests')
        .update({ isactive: !q.isactive })
        .eq('id', q.id)
        .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('No quest row was updated. Check quest update permissions.')
      await fetchExistingQuests()
      try {
        await writeAuditLog(user.id, q.isactive ? 'quest_deactivate' : 'quest_activate', undefined, { title: q.title })
        showToast(`Quest ${q.isactive ? 'deactivated' : 'activated'}`)
      } catch (auditError: unknown) {
        showToast(`Quest ${q.isactive ? 'deactivated' : 'activated'}, but the audit entry failed: ${errorMessage(auditError)}`, 'error')
      }
    } catch (error: unknown) {
      showToast(`Failed: ${errorMessage(error)}`, 'error')
    } finally {
      setQuestActionId(null)
    }
  }

  const deleteQuest = async (q: ExistingQuest) => {
    if (!user) return
    setQuestActionId(q.id)
    try {
      const { count, error: progressError } = await supabase.from('mission_progress')
        .select('id', { count: 'exact', head: true }).eq('questid', q.id)
      if (progressError || count === null) {
        throw new Error(`Could not check learner progress for quest ${q.id}: ${progressError?.message ?? 'no count returned'}`)
      }
      if (count > 0) {
        throw new Error(`This quest has ${count} learner progress record(s). Deactivate it instead of deleting it so that progress is preserved.`)
      }
      if (!window.confirm(`Delete quest "${q.title}"? This cannot be undone.`)) return
      const { data, error } = await supabase
        .from('quests')
        .delete()
        .eq('id', q.id)
        .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('No quest row was deleted. Check quest delete permissions.')
      if (replaceTarget === q.id) setReplaceTarget('')
      await fetchExistingQuests()
      try {
        await writeAuditLog(user.id, 'quest_delete', undefined, { title: q.title, id: q.id })
        showToast('Quest deleted')
      } catch (auditError: unknown) {
        showToast(`Quest deleted, but the audit entry failed: ${errorMessage(auditError)}`, 'error')
      }
    } catch (error: unknown) {
      showToast(`Failed: ${errorMessage(error)}`, 'error')
    } finally {
      setQuestActionId(null)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b949e' }}>
        Loading admin panel...
      </div>
    )
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
        <div role={toast.type === 'error' ? 'alert' : 'status'} style={{
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
            <button className="navbar-toggler" type="button" aria-label="Toggle admin navigation" aria-controls="admin-nav" aria-expanded={navOpen} onClick={() => setNavOpen(open => !open)}>
              <span className="navbar-toggler-icon" />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 0' }}>
              <span style={{ fontSize: '22px' }}>🧠</span>
              <span style={{ color: 'white', fontWeight: '700', fontSize: '16px' }}>CodeSense Admin</span>
            </div>

            <div id="admin-nav" className={`collapse navbar-collapse${navOpen ? ' show' : ''}`} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '8px 0', padding: '12px 0' }}>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', padding: '0 8px 6px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Navigation
              </div>
              {tabItems.map(t => (
                <button key={t.id} onClick={() => { setTab(t.id); setNavOpen(false) }} aria-current={tab === t.id ? 'page' : undefined}
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
                    ⚠️ Admin data could not be loaded. Check database access, policies, and connectivity:
                  </div>
                  <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px', fontSize: '12px', color: '#6b7280' }}>
                    {schemaIssues.map((i, idx) => <li key={idx}>{i}</li>)}
                  </ul>
                </div>
              )}
              {questDraftError && <div className="alert alert-danger d-flex justify-content-between align-items-center" role="alert">
                <span>{questDraftError}</span>
                {invalidSavedDraft.current && <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => {
                  try {
                    localStorage.removeItem(`codesense-admin-quest-draft:${user?.id}`)
                    invalidSavedDraft.current = false
                    questDraftReady.current = true
                    setQuestDraftError(null)
                    setQuestForm(previous => ({ ...previous }))
                  } catch (caught: unknown) {
                    setQuestDraftError(`Could not discard the saved quest draft: ${errorMessage(caught)}`)
                  }
                }}>Discard damaged draft</button>}
              </div>}
              {avatarError && tab === 'users' && <div className="alert alert-warning" role="alert">{avatarError}</div>}

{/* ── DASHBOARD ── */}
              {tab === 'dashboard' && <AdminDashboardTab stats={stats} auditLogs={auditLogs} />}

{/* ── USERS ── */}
              {tab === 'users' && (
                <AdminUsersTab
                  userSearch={userSearch}
                  setUserSearch={value => { setUserSearch(value); setUserPage(0) }}
                  userFilter={userFilter}
                  setUserFilter={value => { setUserFilter(value); setUserPage(0) }}
                  filteredUsers={users}
                  userImages={userImages}
                  loading={usersLoading}
                  page={userPage}
                  resultCount={userResultCount}
                  setPage={setUserPage}
                  saving={saving}
                  currentUserId={user?.id}
                  userCount={stats.total}
                  banUser={banUser}
                  unbanUser={unbanUser}
                  toggleAdmin={toggleAdmin}
                  requestLiveHelp={requestLiveHelp}
                />
              )}

{/* ── AUDIT LOGS ── */}
              {tab === 'audit' && <AdminAuditTab auditLogs={auditLogs} fetchAuditLogs={fetchAuditLogs} />}

{/* ── MAINTENANCE ── */}
              {tab === 'maintenance' && (
                <AdminMaintenanceTab
                  maintenanceOn={maintenanceOn}
                  setMaintenanceOn={setMaintenanceOn}
                  maintenanceMsg={maintenanceMsg}
                  setMaintenanceMsg={setMaintenanceMsg}
                  saving={saving}
                  saveMaintenance={saveMaintenance}
                />
              )}

{/* ── ANNOUNCEMENTS ── */}
              {tab === 'announcements' && (
                <AdminAnnouncementsTab
                  newAnn={newAnn}
                  setNewAnn={setNewAnn}
                  announcements={announcements}
                  createAnnouncement={createAnnouncement}
                  deleteAnnouncement={deleteAnnouncement}
                />
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

                        {/* Automated PDF generator */}
                        <div className="card mb-3">
                          <div className="card-header">
                            <div>
                              <h3 className="card-title mb-1">Quest Automated Generated</h3>
                              <div className="text-muted" style={{ fontSize: '12px' }}>Upload learning material and fill the quest builder automatically.</div>
                            </div>
                          </div>
                          <div className="card-body">
                            <label className="form-label">PDF Learning Material</label>
                            <input
                              type="file"
                              className="form-control"
                              accept="application/pdf,.pdf"
                              disabled={autoQuestLoading}
                              onChange={generateQuestFromPdf}
                            />
                            <div className="d-flex align-items-center gap-2 mt-2 flex-wrap">
                              <span className="text-muted" style={{ fontSize: '11px' }}>
                                {autoQuestLoading
                                  ? 'Reading PDF and generating editable quest content...'
                                  : 'Generated content replaces the current draft, but keeps level, XP, sort order, and active status.'}
                              </span>
                            </div>
                            {autoQuestResult && (
                              <div className={`alert ${autoQuestResult.toLowerCase().includes('failed') || autoQuestResult.toLowerCase().includes('could not') ? 'alert-danger' : 'alert-success'} py-2 mt-2 mb-0`} style={{ fontSize: '12px' }}>
                                {autoQuestResult}
                              </div>
                            )}
                          </div>
                        </div>

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
                                <select className="form-select" value={questForm.level} onChange={e => qSet({ level: Number(e.target.value) })}>
                                  {questLevelOptions.map(level => (
                                    <option key={level} value={level}>{levelOptionLabel(level)}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="col-4">
                                <label className="form-label">Difficulty</label>
                                <select className="form-select" value={questForm.difficulty} onChange={e => qSet({ difficulty: e.target.value as QuestDifficulty })}>
                                  <option value="beginner">Beginner</option>
                                  <option value="intermediate">Intermediate</option>
                                  <option value="advanced">Advanced</option>
                                  <option value="expert">Expert</option>
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
                            <div className="border rounded p-2 mt-3" style={{ background: '#f8fafc' }}>
                              <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                                <div>
                                  <div style={{ fontSize: '13px', fontWeight: 700 }}>Level Dashboard Generator</div>
                                  <div className="text-muted" style={{ fontSize: '12px' }}>
                                    Create another level bucket, then add learning material and quest activities for it below.
                                  </div>
                                </div>
                                <span className={`badge bg-${levelBadgeColor(questForm.level)}-lt`}>Current: Level {questForm.level}</span>
                              </div>
                              <div className="row g-2 mt-2 align-items-end">
                                <div className="col-6">
                                  <label className="form-label" style={{ fontSize: '12px' }}>New level number</label>
                                  <input
                                    type="number"
                                    min={1}
                                    step={1}
                                    className="form-control form-control-sm"
                                    value={customLevelDraft}
                                    onChange={e => setCustomLevelDraft(e.target.value)}
                                    placeholder={`Next: Level ${nextQuestLevel}`}
                                  />
                                </div>
                                <div className="col-6 d-flex gap-2">
                                  <button className="btn btn-sm btn-outline-primary flex-fill" onClick={() => addCustomLevel(nextQuestLevel)}>
                                    + Add Level {nextQuestLevel}
                                  </button>
                                  <button className="btn btn-sm btn-primary flex-fill" onClick={() => addCustomLevel()}>
                                    Use Number
                                  </button>
                                </div>
                              </div>
                              {questForm.level > 3 && (
                                <div className="d-flex align-items-center justify-content-between gap-2 mt-2 flex-wrap">
                                  <span className="text-muted" style={{ fontSize: '11px' }}>
                                    {existingQuests.filter(q => q.level === questForm.level).length > 0
                                      ? `${existingQuests.filter(q => q.level === questForm.level).length} quest(s) are assigned to this level.`
                                      : 'No saved quests are assigned to this level yet.'}
                                  </span>
                                  <button className="btn btn-sm btn-outline-danger" onClick={() => removeCustomLevel(questForm.level)}>
                                    Remove Level {questForm.level}
                                  </button>
                                </div>
                              )}
                            </div>
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
                            <div className="mb-2">
                              <label className="form-label">Paste Lesson Material</label>
                              <textarea className="form-control form-control-sm" rows={5} value={lessonDraft}
                                onChange={e => setLessonDraft(e.target.value)}
                                placeholder={'Paste notes here. Separate sections with a blank line.\nUse "# Heading" or "Heading:" as the first line to create a section heading.'} />
                              <div className="d-flex gap-2 mt-2 flex-wrap">
                                <button className="btn btn-xs btn-primary" onClick={() => addLessonSectionsFromDraft(false)}>Add as Sections</button>
                                <button className="btn btn-xs btn-outline-secondary" onClick={() => addLessonSectionsFromDraft(true)}>Replace Sections</button>
                                <span className="text-muted" style={{ fontSize: '11px', alignSelf: 'center' }}>Best for quick copy-paste from lesson notes.</span>
                              </div>
                            </div>
                            <div className="d-flex justify-content-between align-items-center mb-1">
                              <label className="form-label mb-0" style={{ fontSize: '13px' }}>Theory Sections</label>
                              <div className="d-flex gap-1 flex-wrap justify-content-end">
                                <button className="btn btn-xs btn-outline-primary" onClick={() => qSet({ theory_sections: [...questForm.theory_sections, newTheorySection('default', {})] })}>+ Text</button>
                                <button className="btn btn-xs btn-outline-secondary" onClick={() => qSet({ theory_sections: [...questForm.theory_sections, newTheorySection('tip', {})] })}>+ Tip</button>
                                <button className="btn btn-xs btn-outline-secondary" onClick={() => qSet({ theory_sections: [...questForm.theory_sections, newTheorySection('code', {})] })}>+ Code</button>
                                <button className="btn btn-xs btn-outline-secondary" onClick={() => qSet({ theory_sections: [...questForm.theory_sections, newTheorySection('table', { table_headers: ['Term', 'Meaning'], table_rows: [['', '']] })] })}>+ Table</button>
                              </div>
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
                                    <option value="table">Table</option>
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
                                ) : sec.type === 'table' ? (
                                  <div>
                                    {/* Column headers */}
                                    <div className="d-flex align-items-center gap-1 mb-1" style={{ flexWrap: 'wrap' }}>
                                      {sec.table_headers.map((h, ci) => (
                                        <div key={ci} className="d-flex align-items-center gap-1">
                                          <input className="form-control form-control-sm" style={{ width: '100px' }} placeholder={`Col ${ci + 1}`} value={h}
                                            onChange={e => { const s = [...questForm.theory_sections]; const hds = [...s[i].table_headers]; hds[ci] = e.target.value; s[i] = { ...s[i], table_headers: hds }; qSet({ theory_sections: s }) }} />
                                          <button className="btn btn-xs btn-ghost-danger" onClick={() => { const s = [...questForm.theory_sections]; const hds = s[i].table_headers.filter((_, j) => j !== ci); const rws = s[i].table_rows.map(r => r.filter((_, j) => j !== ci)); s[i] = { ...s[i], table_headers: hds, table_rows: rws }; qSet({ theory_sections: s }) }}>✕</button>
                                        </div>
                                      ))}
                                      <button className="btn btn-xs btn-outline-secondary" onClick={() => { const s = [...questForm.theory_sections]; s[i] = { ...s[i], table_headers: [...s[i].table_headers, ''], table_rows: s[i].table_rows.map(r => [...r, '']) }; qSet({ theory_sections: s }) }}>+ Col</button>
                                    </div>
                                    {/* Data rows */}
                                    {sec.table_rows.map((row, ri) => (
                                      <div key={ri} className="d-flex align-items-center gap-1 mb-1" style={{ flexWrap: 'wrap' }}>
                                        {row.map((cell, ci) => (
                                          <input key={ci} className="form-control form-control-sm" style={{ width: '100px' }} placeholder={sec.table_headers[ci] ?? `Col ${ci + 1}`} value={cell}
                                            onChange={e => { const s = [...questForm.theory_sections]; const rws = s[i].table_rows.map((r, j) => j === ri ? r.map((c, k) => k === ci ? e.target.value : c) : r); s[i] = { ...s[i], table_rows: rws }; qSet({ theory_sections: s }) }} />
                                        ))}
                                        <button className="btn btn-xs btn-ghost-danger" onClick={() => { const s = [...questForm.theory_sections]; s[i] = { ...s[i], table_rows: s[i].table_rows.filter((_, j) => j !== ri) }; qSet({ theory_sections: s }) }}>✕</button>
                                      </div>
                                    ))}
                                    <button className="btn btn-xs btn-outline-secondary" onClick={() => { const s = [...questForm.theory_sections]; s[i] = { ...s[i], table_rows: [...s[i].table_rows, s[i].table_headers.map(() => '')] }; qSet({ theory_sections: s }) }}>+ Row</button>
                                    <textarea className="form-control form-control-sm mt-1" rows={1} placeholder="Caption (optional)" value={sec.body}
                                      onChange={e => { const s = [...questForm.theory_sections]; s[i] = { ...s[i], body: e.target.value }; qSet({ theory_sections: s }) }} />
                                  </div>
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
                            <div className="mb-3">
                              <label className="form-label">Paste Objectives</label>
                              <textarea className="form-control form-control-sm" rows={4} value={objectiveDraft}
                                onChange={e => setObjectiveDraft(e.target.value)}
                                placeholder={'One objective per line, for example:\n- Identify valid C++ variable names\n- Use cin and cout for input and output'} />
                              <div className="d-flex gap-2 mt-2 flex-wrap">
                                <button className="btn btn-xs btn-primary" onClick={() => addObjectivesFromDraft(false)}>Add Objectives</button>
                                <button className="btn btn-xs btn-outline-secondary" onClick={() => addObjectivesFromDraft(true)}>Replace List</button>
                              </div>
                            </div>
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

                        {/* Quest Hints */}
                        <div className="card mb-3">
                          <div className="card-header d-flex justify-content-between align-items-center">
                            <h3 className="card-title mb-0">Quest Hints</h3>
                            <button className="btn btn-xs btn-outline-primary" onClick={() => qSet({
                              hints: [...questForm.hints, { id: `h_${Date.now()}`, title: '', body: '', icon: '', activity: 'all', _extra: {} }]
                            })}>+ Add Hint</button>
                          </div>
                          <div className="card-body">
                            <div className="mb-3">
                              <label className="form-label">Paste Hints</label>
                              <textarea className="form-control form-control-sm" rows={4} value={hintDraft}
                                onChange={e => setHintDraft(e.target.value)}
                                placeholder={'One hint per line. Optional title format:\nLoop clue - Check the loop condition.\nRemember to initialize variables before using them.'} />
                              <div className="d-flex gap-2 mt-2 flex-wrap">
                                <button className="btn btn-xs btn-primary" onClick={() => addHintsFromDraft(false)}>Add Hints</button>
                                <button className="btn btn-xs btn-outline-secondary" onClick={() => addHintsFromDraft(true)}>Replace Hints</button>
                                <button className="btn btn-xs btn-outline-primary" onClick={() => generateQuestHints(false)}>Generate Hints</button>
                                <button className="btn btn-xs btn-outline-secondary" onClick={() => generateQuestHints(true)}>Replace with Generated</button>
                              </div>
                            </div>
                            <div className="text-muted mb-2" style={{ fontSize: '11px' }}>Use activity scope when a hint should appear only for one game tab. Generated hints are copied into this form for every selected activity that already has content; empty activities are skipped.</div>
                            {questForm.hints.map((h, i) => (
                              <div key={h.id} className="border rounded p-2 mb-2" style={{ fontSize: '12px' }}>
                                <div className="row g-1 mb-1">
                                  <div className="col-7">
                                    <input className="form-control form-control-sm" placeholder="Hint title" value={h.title}
                                      onChange={e => { const rows = [...questForm.hints]; rows[i] = { ...rows[i], title: e.target.value }; qSet({ hints: rows }) }} />
                                  </div>
                                  <div className="col-4">
                                    <select className="form-select form-select-sm" value={h.activity}
                                      onChange={e => { const rows = [...questForm.hints]; rows[i] = { ...rows[i], activity: e.target.value as HintActivityScope }; qSet({ hints: rows }) }}>
                                      {HINT_ACTIVITY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                    </select>
                                  </div>
                                  <div className="col-1 d-flex justify-content-end">
                                    <button className="btn btn-xs btn-ghost-danger" onClick={() => qSet({ hints: questForm.hints.filter((_, j) => j !== i) })}>✕</button>
                                  </div>
                                </div>
                                <textarea className="form-control form-control-sm" rows={2} placeholder="Hint body" value={h.body}
                                  onChange={e => { const rows = [...questForm.hints]; rows[i] = { ...rows[i], body: e.target.value }; qSet({ hints: rows }) }} />
                              </div>
                            ))}
                            {questForm.hints.length === 0 && <div className="text-muted" style={{ fontSize: '12px' }}>No quest hints added</div>}
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
                                      checked={questForm[act.key]}
                                      onChange={e => setQuestActivity(act.key, e.target.checked)} />
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
                                mc_questions: [...questForm.mc_questions, { id: Date.now().toString(), question: '', options: ['', '', '', ''], correct: 0, explanation: '', hint: '' }]
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
                                  <input className="form-control form-control-sm mt-1" placeholder="💡 Per-question hint (optional, shown in side panel while answering)" value={q.hint}
                                    onChange={e => { const qs = [...questForm.mc_questions]; qs[qi] = { ...qs[qi], hint: e.target.value }; qSet({ mc_questions: qs }) }} />
                                </div>
                              ))}
                              {questForm.mc_questions.length === 0 && <div className="text-muted" style={{ fontSize: '12px' }}>No questions yet</div>}
                            </div>
                          </div>
                        )}

                        {/* Drag & Drop */}
                        {questForm.act_drag && (
                          <div className="card mb-3">
                            <div className="card-header d-flex justify-content-between align-items-center">
                              <h3 className="card-title mb-0">🎯 Drag & Drop Problems</h3>
                              <button className="btn btn-xs btn-outline-primary" onClick={() => qSet({ drag_problems: [...questForm.drag_problems, newDragProblem()] })}>+ Add Problem</button>
                            </div>
                            <div className="card-body" style={{ maxHeight: '500px', overflowY: 'auto' }}>
                              {questForm.drag_problems.map((prob, pi) => (
                                <div key={prob.id} className="border rounded p-2 mb-3" style={{ background: '#f8fafc' }}>
                                  <div className="d-flex justify-content-between align-items-center mb-2">
                                    <strong style={{ fontSize: '12px', color: '#374151' }}>Problem {pi + 1}</strong>
                                    {questForm.drag_problems.length > 1 && (
                                      <button className="btn btn-xs btn-ghost-danger" onClick={() => qSet({ drag_problems: questForm.drag_problems.filter((_, j) => j !== pi) })}>✕ Remove</button>
                                    )}
                                  </div>
                                  <div className="mb-2">
                                    <input className="form-control form-control-sm" placeholder="Question / instruction (e.g. Match each keyword to its meaning)" value={prob.question}
                                      onChange={e => { const dp = [...questForm.drag_problems]; dp[pi] = { ...dp[pi], question: e.target.value }; qSet({ drag_problems: dp }) }} />
                                  </div>
                                  <div className="row g-2">
                                    <div className="col-6">
                                      <div className="d-flex justify-content-between align-items-center mb-1">
                                        <label className="form-label mb-0" style={{ fontSize: '11px', fontWeight: 600 }}>Draggable Items</label>
                                        <button className="btn btn-xs btn-outline-secondary" onClick={() => {
                                          const dp = [...questForm.drag_problems]
                                          dp[pi] = { ...dp[pi], items: [...dp[pi].items, { id: `item_${Date.now()}`, label: '', color: '#58a6ff' }] }
                                          qSet({ drag_problems: dp })
                                        }}>+</button>
                                      </div>
                                      {prob.items.map((item, ii) => (
                                        <div key={item.id} className="d-flex gap-1 mb-1">
                                          <input type="color" value={item.color} style={{ width: '28px', padding: '1px 2px', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer' }}
                                            onChange={e => { const dp = [...questForm.drag_problems]; dp[pi].items[ii] = { ...dp[pi].items[ii], color: e.target.value }; qSet({ drag_problems: dp }) }} />
                                          <input className="form-control form-control-sm" placeholder={`Item ${ii + 1}`} value={item.label}
                                            onChange={e => { const dp = [...questForm.drag_problems]; dp[pi].items[ii] = { ...dp[pi].items[ii], label: e.target.value }; qSet({ drag_problems: dp }) }} />
                                          <button className="btn btn-xs btn-ghost-danger" onClick={() => { const dp = [...questForm.drag_problems]; dp[pi].items = dp[pi].items.filter((_, j) => j !== ii); qSet({ drag_problems: dp }) }}>✕</button>
                                        </div>
                                      ))}
                                      {prob.items.length === 0 && <div className="text-muted" style={{ fontSize: '11px' }}>No items yet</div>}
                                    </div>
                                    <div className="col-6">
                                      <div className="d-flex justify-content-between align-items-center mb-1">
                                        <label className="form-label mb-0" style={{ fontSize: '11px', fontWeight: 600 }}>Drop Zones</label>
                                        <button className="btn btn-xs btn-outline-secondary" onClick={() => {
                                          const dp = [...questForm.drag_problems]
                                          dp[pi] = { ...dp[pi], drop_zones: [...dp[pi].drop_zones, { id: `zone_${Date.now()}`, label: '', accepted: '' }] }
                                          qSet({ drag_problems: dp })
                                        }}>+</button>
                                      </div>
                                      {prob.drop_zones.map((zone, zi) => (
                                        <div key={zone.id} className="mb-2">
                                          <div className="d-flex gap-1 mb-1">
                                            <input className="form-control form-control-sm" placeholder={`Zone ${zi + 1} label`} value={zone.label}
                                              onChange={e => { const dp = [...questForm.drag_problems]; dp[pi].drop_zones[zi] = { ...dp[pi].drop_zones[zi], label: e.target.value }; qSet({ drag_problems: dp }) }} />
                                            <button className="btn btn-xs btn-ghost-danger" onClick={() => { const dp = [...questForm.drag_problems]; dp[pi].drop_zones = dp[pi].drop_zones.filter((_, j) => j !== zi); qSet({ drag_problems: dp }) }}>✕</button>
                                          </div>
                                          <select className="form-select form-select-sm" value={zone.accepted}
                                            onChange={e => { const dp = [...questForm.drag_problems]; dp[pi].drop_zones[zi] = { ...dp[pi].drop_zones[zi], accepted: e.target.value }; qSet({ drag_problems: dp }) }}>
                                            <option value="">— Accepts which item? —</option>
                                            {prob.items.map(gi => (
                                              <option key={gi.id} value={gi.id}>{gi.label || gi.id}</option>
                                            ))}
                                          </select>
                                        </div>
                                      ))}
                                      {prob.drop_zones.length === 0 && <div className="text-muted" style={{ fontSize: '11px' }}>No zones yet</div>}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Balloon Pop */}
                        {questForm.act_balloon && (
                          <div className="card mb-3">
                            <div className="card-header d-flex justify-content-between align-items-center">
                              <h3 className="card-title mb-0">🎈 Balloon Pop Questions</h3>
                              <button className="btn btn-xs btn-outline-primary" onClick={() => qSet({
                                balloon_questions: [...questForm.balloon_questions, { id: Date.now().toString(), question: '', options: ['', '', '', ''], correct: 0, correctAnswers: [0], explanation: '', hint: '' }]
                              })}>+ Add Q</button>
                            </div>
                            <div className="card-body" style={{ maxHeight: '380px', overflowY: 'auto' }}>
                              <div className="text-muted mb-2" style={{ fontSize: '11px' }}>Add 3-4 balloon labels, then tick every correct answer. Players must pop all correct balloons for that question. Keep option text short (under 25 chars).</div>
                              {questForm.balloon_questions.map((bq, qi) => (
                                <div key={bq.id} className="border rounded p-2 mb-2" style={{ fontSize: '12px' }}>
                                  <div className="d-flex justify-content-between mb-1">
                                    <strong style={{ fontSize: '11px', color: '#6b7280' }}>Q{qi + 1}</strong>
                                    <button className="btn btn-xs btn-ghost-danger" onClick={() => qSet({ balloon_questions: questForm.balloon_questions.filter((_, j) => j !== qi) })}>✕</button>
                                  </div>
                                  <textarea className="form-control form-control-sm mb-1" rows={2} placeholder="Question text (e.g. Pop the correct data type for a decimal number)" value={bq.question}
                                    onChange={e => { const qs = [...questForm.balloon_questions]; qs[qi] = { ...qs[qi], question: e.target.value }; qSet({ balloon_questions: qs }) }} />
                                  {bq.options.map((opt, oi) => (
                                    <div key={oi} className="d-flex align-items-center gap-1 mb-1">
                                      <input type="checkbox" checked={(bq.correctAnswers?.length ? bq.correctAnswers : [bq.correct]).includes(oi)} title="Mark as a correct balloon"
                                        onChange={e => {
                                          const qs = [...questForm.balloon_questions]
                                          const current = bq.correctAnswers?.length ? bq.correctAnswers : [bq.correct]
                                          const next = e.target.checked
                                            ? Array.from(new Set([...current, oi])).sort((a, b) => a - b)
                                            : current.filter(idx => idx !== oi)
                                          const safeNext = next.length ? next : [oi]
                                          qs[qi] = { ...qs[qi], correct: safeNext[0], correctAnswers: safeNext }
                                          qSet({ balloon_questions: qs })
                                        }} />
                                      <input className="form-control form-control-sm" placeholder={`Option ${oi + 1} (keep short!)`} value={opt}
                                        onChange={e => {
                                          const qs = [...questForm.balloon_questions]
                                          const opts = [...qs[qi].options] as [string,string,string,string]
                                          opts[oi] = e.target.value; qs[qi] = { ...qs[qi], options: opts }; qSet({ balloon_questions: qs })
                                        }} />
                                    </div>
                                  ))}
                                  <input className="form-control form-control-sm" placeholder="Explanation (shown after pop)" value={bq.explanation}
                                    onChange={e => { const qs = [...questForm.balloon_questions]; qs[qi] = { ...qs[qi], explanation: e.target.value }; qSet({ balloon_questions: qs }) }} />
                                  <input className="form-control form-control-sm mt-1" placeholder="💡 Per-question hint (optional, shown in side panel while answering)" value={bq.hint}
                                    onChange={e => { const qs = [...questForm.balloon_questions]; qs[qi] = { ...qs[qi], hint: e.target.value }; qSet({ balloon_questions: qs }) }} />
                                </div>
                              ))}
                              {questForm.balloon_questions.length === 0 && <div className="text-muted" style={{ fontSize: '12px' }}>No questions yet</div>}
                            </div>
                          </div>
                        )}

                        {/* Ordering */}
                        {questForm.act_ordering && (
                          <div className="card mb-3">
                            <div className="card-header d-flex justify-content-between align-items-center">
                              <h3 className="card-title mb-0">📋 Ordering Problems</h3>
                              <button className="btn btn-xs btn-outline-primary" onClick={() => qSet({ ordering_problems: [...questForm.ordering_problems, newOrderProblem()] })}>+ Add Problem</button>
                            </div>
                            <div className="card-body" style={{ maxHeight: '500px', overflowY: 'auto' }}>
                              <div className="text-muted mb-2" style={{ fontSize: '11px' }}>Add items in the correct order — top = first. Each problem has its own question.</div>
                              {questForm.ordering_problems.map((prob, pi) => (
                                <div key={prob.id} className="border rounded p-2 mb-3" style={{ background: '#f8fafc' }}>
                                  <div className="d-flex justify-content-between align-items-center mb-2">
                                    <strong style={{ fontSize: '12px', color: '#374151' }}>Problem {pi + 1}</strong>
                                    {questForm.ordering_problems.length > 1 && (
                                      <button className="btn btn-xs btn-ghost-danger" onClick={() => qSet({ ordering_problems: questForm.ordering_problems.filter((_, j) => j !== pi) })}>✕ Remove</button>
                                    )}
                                  </div>
                                  <div className="mb-2">
                                    <input className="form-control form-control-sm" placeholder="Question (e.g. Arrange these steps in order)" value={prob.question}
                                      onChange={e => { const op = [...questForm.ordering_problems]; op[pi] = { ...op[pi], question: e.target.value }; qSet({ ordering_problems: op }) }} />
                                  </div>
                                  <div className="d-flex justify-content-between align-items-center mb-1">
                                    <label className="form-label mb-0" style={{ fontSize: '11px', fontWeight: 600 }}>Items (correct order, top = first)</label>
                                    <button className="btn btn-xs btn-outline-secondary" onClick={() => {
                                      const op = [...questForm.ordering_problems]
                                      op[pi] = { ...op[pi], items: [...op[pi].items, { id: `o_${Date.now()}`, label: '', description: '' }] }
                                      qSet({ ordering_problems: op })
                                    }}>+ Add Item</button>
                                  </div>
                                  {prob.items.map((item, ii) => (
                                    <div key={item.id} className="d-flex gap-1 align-items-start mb-2">
                                      <span className="badge bg-secondary mt-1" style={{ minWidth: '22px', fontSize: '11px' }}>{ii + 1}</span>
                                      <div style={{ flex: 1 }}>
                                        <input className="form-control form-control-sm mb-1" placeholder="Item label" value={item.label}
                                          onChange={e => { const op = [...questForm.ordering_problems]; op[pi].items[ii] = { ...op[pi].items[ii], label: e.target.value }; qSet({ ordering_problems: op }) }} />
                                        <input className="form-control form-control-sm" placeholder="Description (optional)" value={item.description}
                                          onChange={e => { const op = [...questForm.ordering_problems]; op[pi].items[ii] = { ...op[pi].items[ii], description: e.target.value }; qSet({ ordering_problems: op }) }} />
                                      </div>
                                      <button className="btn btn-xs btn-ghost-danger mt-1" onClick={() => { const op = [...questForm.ordering_problems]; op[pi].items = op[pi].items.filter((_, j) => j !== ii); qSet({ ordering_problems: op }) }}>✕</button>
                                    </div>
                                  ))}
                                  {prob.items.length === 0 && <div className="text-muted" style={{ fontSize: '11px' }}>No items yet</div>}
                                </div>
                              ))}
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
                            {replaceTarget === null && (
                              <div className="alert alert-warning" role="alert">
                                This restored draft has no saved editing target. Select the original quest below to update it, or confirm saving it as a new quest.
                              </div>
                            )}
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
                                <button className="btn btn-primary" disabled={questSaving || !questForm.title.trim()} onClick={() => {
                                  if (replaceTarget === null && !window.confirm('This draft has no saved editing target. Create a new quest? Cancel and select the original quest if you intended to update it.')) return
                                  saveQuest()
                                }}>
                                  {questSaving ? 'Saving…' : '✓ Save as New Quest'}
                                </button>
                              )}
                              <div className="d-flex gap-1 align-items-center">
                                <select className="form-select form-select-sm" style={{ width: '220px' }} value={replaceTarget ?? ''}
                                  onChange={e => setReplaceTarget(e.target.value)}>
                                  <option value="">— Or load existing to edit —</option>
                                  {existingQuests.filter(q => q.level === questForm.level).map(q => (
                                    <option key={q.id} value={q.id}>{q.title}</option>
                                  ))}
                                </select>
                                {replaceTarget && (
                                  <button className="btn btn-sm btn-outline-secondary" onClick={() => {
                                    const quest = existingQuests.find(q => q.id === replaceTarget)
                                    if (quest) void loadQuestForEdit(quest)
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
                    <>
                    {/* ── Data Tools ── */}
                    <div className="card mb-3">
                      <div className="card-header">
                        <div>
                          <h3 className="card-title mb-1">🔧 Data Tools</h3>
                          <div className="text-muted" style={{ fontSize: '12px' }}>Bulk repairs for quest content</div>
                        </div>
                      </div>
                      <div className="card-body">
                        <div
                          className="border rounded p-3"
                          style={{
                            maxWidth: 760,
                            background: '#f8fafc',
                            borderColor: '#dbe2ea',
                          }}
                        >
                          <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap">
                            <div style={{ minWidth: 260, flex: '1 1 420px' }}>
                              <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: 4 }}>Fix MC Question Language</div>
                              <div className="text-muted" style={{ fontSize: '12px', lineHeight: 1.55 }}>
                                Replaces balloon-pop wording in Multiple Choice questions with clearer MC wording, like <em>Select...</em> or <em>Which item...</em>.
                              </div>
                            </div>
                            <button
                              className="btn btn-sm btn-warning"
                              disabled={fixingPop}
                              onClick={fixPopLanguage}
                              style={{ whiteSpace: 'nowrap' }}
                            >
                              {fixingPop ? 'Scanning...' : 'Run Fix'}
                            </button>
                          </div>
                        </div>
                        {fixPopResult && (
                          <div className={`alert alert-${fixPopResult.startsWith('Error') ? 'danger' : 'success'} py-2 mt-2 mb-0`} style={{ fontSize: '12px' }}>
                            {fixPopResult}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="card">
                      <div className="card-header">
                        <div>
                          <h3 className="card-title mb-1">All Campaign Quests</h3>
                          <div className="text-muted" style={{ fontSize: '12px' }}>
                            Showing {managedQuests.length} of {existingQuests.length} quest{existingQuests.length === 1 ? '' : 's'}
                          </div>
                        </div>
                        <div className="card-options">
                          <button className="btn btn-sm btn-outline-primary" disabled={questsLoading} onClick={fetchExistingQuests}>
                            <i className="ti ti-refresh me-1" />{questsLoading ? 'Refreshing...' : 'Refresh'}
                          </button>
                        </div>
                      </div>
                      <div className="card-body border-bottom">
                        <div className="row g-2 align-items-end">
                          <div className="col-md-6">
                            <label className="form-label">Search quests</label>
                            <input
                              className="form-control form-control-sm"
                              value={questSearch}
                              onChange={e => setQuestSearch(e.target.value)}
                              placeholder="Search title, description, difficulty, or type"
                            />
                          </div>
                          <div className="col-6 col-md-2">
                            <label className="form-label">Level</label>
                            <select className="form-select form-select-sm" value={questLevelFilter} onChange={e => setQuestLevelFilter(e.target.value)}>
                              <option value="all">All levels</option>
                              {questLevelOptions.map(level => (
                                <option key={level} value={String(level)}>Level {level}</option>
                              ))}
                            </select>
                          </div>
                          <div className="col-6 col-md-2">
                            <label className="form-label">Status</label>
                            <select className="form-select form-select-sm" value={questStatusFilter} onChange={e => setQuestStatusFilter(e.target.value as typeof questStatusFilter)}>
                              <option value="all">All status</option>
                              <option value="active">Active</option>
                              <option value="inactive">Inactive</option>
                            </select>
                          </div>
                          <div className="col-md-2">
                            <button
                              className="btn btn-sm btn-outline-secondary w-100"
                              onClick={() => { setQuestSearch(''); setQuestLevelFilter('all'); setQuestStatusFilter('all') }}
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="table-responsive">
                        <table className="table table-vcenter card-table table-striped">
                          <thead>
                            <tr><th>Title</th><th>Level</th><th>Primary activity</th><th>XP</th><th>Order</th><th>Status</th><th className="text-end">Actions</th></tr>
                          </thead>
                          <tbody>
                            {questsLoading && existingQuests.length === 0 && (
                              <tr><td colSpan={7} className="text-center text-muted py-4">Loading quests...</td></tr>
                            )}
                            {!questsLoading && managedQuests.map(q => {
                              const activities = questActivityLabels(q)
                              const isBusy = questActionId === q.id
                              return (
                              <tr key={q.id}>
                                <td>
                                  <strong style={{ fontSize: '13px' }}>{q.title}</strong>
                                  {q.description && <div className="text-muted" style={{ fontSize: '11px', maxWidth: 420 }}>{q.description}</div>}
                                </td>
                                <td><span className={`badge bg-${levelBadgeColor(q.level ?? 0)}-lt`}>Level {q.level ?? 'n/a'}</span></td>
                                <td>
                                  <div className="d-flex gap-1 flex-wrap">
                                    {activities.length ? activities.map(label => <span key={label} className="badge bg-blue-lt">{label}</span>) : <span className="text-muted" style={{ fontSize: '12px' }}>No activities</span>}
                                  </div>
                                </td>
                                <td>{q.basexp}</td>
                                <td>{q.sortorder}</td>
                                <td>{q.isactive ? <span className="badge bg-green">Active</span> : <span className="badge bg-secondary">Inactive</span>}</td>
                                <td className="text-end">
                                  <div className="d-flex gap-1 justify-content-end flex-wrap">
                                    <button className="btn btn-sm btn-outline-primary" disabled={!!questActionId} onClick={() => { void loadQuestForEdit(q) }}>Edit</button>
                                    <button className="btn btn-sm btn-outline-warning" disabled={!!questActionId} onClick={() => toggleQuestActive(q)}>
                                      {isBusy ? 'Working...' : q.isactive ? 'Deactivate' : 'Activate'}
                                    </button>
                                    <button className="btn btn-sm btn-ghost-danger" disabled={!!questActionId} onClick={() => deleteQuest(q)}>Delete</button>
                                  </div>
                                </td>
                              </tr>
                            )})}
                            {!questsLoading && existingQuests.length === 0 && (
                              <tr><td colSpan={7} className="text-center text-muted py-4">No quests found</td></tr>
                            )}
                            {!questsLoading && existingQuests.length > 0 && managedQuests.length === 0 && (
                              <tr><td colSpan={7} className="text-center text-muted py-4">No quests match the current filters</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                  )}
                </>
              )}

            </div>
          </div>
        </div>
      </div>
      {liveHelp && <AdminLiveSupport key={liveHelp.session.id} session={liveHelp.session} learnerName={liveHelp.learnerName} onClose={() => setLiveHelp(null)} />}
    </div>
  )
}
