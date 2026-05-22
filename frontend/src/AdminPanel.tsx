// AdminPanel.tsx — Tabler-based admin dashboard
// Loads Tabler CSS from CDN on mount, removes it on unmount to avoid style bleed.
import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './components/AuthScreen'
import { supabase } from './services/supabase'
import type { ExplorerProfile } from './types'
import {
  computeUserStats, filterUsers, levelToPhase,
  patchMCQuestions, parseCodeFillAnswers,
  normalizeMCQuestionOptions, normalizeMCQuestions,
  loadHintsForEdit, serializeHints, HINT_ACTIVITY_OPTIONS,
  type HintFormRow,
} from './admin/adminHelpers'
import { extractTextFromPdf, generateQuestDraftFromText } from './admin/questAutoGenerator'
import { generateAutoHints } from './campaign/generateAutoHints'
import type { ActivityTab, Quest } from './types/campaign'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Subset of the quests table returned by fetchExistingQuests */
interface ExistingQuest {
  id: string
  title: string
  level: 1 | 2 | 3 | null
  difficulty: string | null
  basexp: number
  requiredxp?: number
  sortorder: number
  isactive: boolean
  phase: string | null
  question_type: string | null
  description: string | null
  tutorial_title: string | null
  tutorial_body: string | null
  theory_sections: unknown[] | null
  objectives: string[] | null
  hints: unknown[] | null
  mc_questions: unknown[] | null
  game_items: unknown[] | null
  drop_zones: unknown[] | null
  ordering_items: unknown[] | null
  code_fill_items: unknown[] | null
}

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

interface QFormTheory    { id: string; type: string; heading: string; body: string; code: string; language: string; table_headers: string[]; table_rows: string[][] }
interface QFormMCQ       { id: string; question: string; options: [string,string,string,string]; correct: number; correctAnswers?: number[]; explanation: string; hint: string }
interface QFormDragItem  { id: string; label: string; color: string }
interface QFormDropZone  { id: string; label: string; accepted: string }
interface QFormCodeFill  { id: string; code_lines: string; language: string; answers: string; hint: string; caption: string }

// Multi-problem types
interface QFormDragProblem  { id: string; question: string; items: QFormDragItem[]; drop_zones: QFormDropZone[] }
interface QFormOrderItem    { id: string; label: string; description: string }
interface QFormOrderProblem { id: string; question: string; items: QFormOrderItem[] }

interface QuestFormState {
  title: string; description: string
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert'; level: 1 | 2 | 3
  basexp: number; requiredxp: number; sortorder: number; isactive: boolean
  tutorial_title: string; tutorial_body: string
  theory_sections: QFormTheory[]; objectives: string[]
  act_mc: boolean; act_drag: boolean; act_balloon: boolean; act_ordering: boolean; act_codefill: boolean
  mc_questions: QFormMCQ[]
  balloon_questions: QFormMCQ[]
  drag_problems: QFormDragProblem[]
  ordering_problems: QFormOrderProblem[]
  code_fill_items: QFormCodeFill[]
  // Dynamic hints — round-tripped from quests.hints JSONB. Preserves
  // SQL-authored extras (e.g. `image: true`) via each row's `_extra`.
  hints: HintFormRow[]
  // legacy flat fields kept for DB compat — built from problems on save
  game_items: QFormDragItem[]; drop_zones: QFormDropZone[]
}

const newDragProblem = (): QFormDragProblem => ({
  id: `dp_${Date.now()}`, question: '', items: [], drop_zones: [],
})
const newOrderProblem = (): QFormOrderProblem => ({
  id: `op_${Date.now()}`, question: '', items: [],
})

const newTheorySection = (type = 'default', patch: Partial<QFormTheory> = {}): QFormTheory => ({
  id: `th_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  type,
  heading: '',
  body: '',
  code: '',
  language: 'c',
  table_headers: [],
  table_rows: [[]],
  ...patch,
})

const parseLineList = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)

const lessonTextToSections = (text: string): QFormTheory[] =>
  text
    .split(/\n\s*\n/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
      const first = lines[0] ?? ''
      const markdownHeading = first.match(/^#{1,3}\s+(.+)$/)
      const colonHeading = lines.length > 1 && first.length <= 72 && first.endsWith(':')
      if (markdownHeading || colonHeading) {
        return newTheorySection('default', {
          heading: markdownHeading?.[1] ?? first.replace(/:$/, ''),
          body: lines.slice(1).join('\n'),
        })
      }
      return newTheorySection('default', { body: lines.join('\n') })
    })

const parseHintLines = (text: string): HintFormRow[] =>
  parseLineList(text).map((line, i) => {
    const match = line.match(/^(.{1,48}?)(?:\s+-\s+|\s+:\s+)(.+)$/)
    return {
      id: `h_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      title: match ? match[1].trim() : 'Helpful hint',
      body: match ? match[2].trim() : line,
      icon: '',
      activity: 'all',
      _extra: {},
    }
  })

const hasText = (value: unknown): boolean =>
  String(value ?? '').trim().length > 0

const selectedTabsForForm = (form: QuestFormState): ActivityTab[] => {
  const tabs: ActivityTab[] = []
  if (form.act_drag) tabs.push('drag')
  if (form.act_codefill) tabs.push('code_fill')
  if (form.act_ordering) tabs.push('ordering')
  if (form.act_balloon) tabs.push('balloon')
  if (form.act_mc) tabs.push('mc')
  return tabs
}

const tabHasContent = (form: QuestFormState, tab: ActivityTab): boolean => {
  if (tab === 'mc') {
    return form.mc_questions.some(q =>
      hasText(q.question) || q.options.some(hasText) || hasText(q.explanation)
    )
  }

  if (tab === 'balloon') {
    return form.balloon_questions.some(q =>
      hasText(q.question) || q.options.some(hasText) || hasText(q.explanation)
    )
  }

  if (tab === 'code_fill') {
    return form.code_fill_items.some(item =>
      hasText(item.caption) || hasText(item.code_lines) || hasText(item.answers)
    )
  }

  if (tab === 'ordering') {
    return form.ordering_problems.some(problem =>
      hasText(problem.question) ||
      problem.items.some(item => hasText(item.label) || hasText(item.description))
    )
  }

  if (tab === 'drag') {
    return form.drag_problems.some(problem =>
      hasText(problem.question) ||
      problem.items.some(item => hasText(item.label)) ||
      problem.drop_zones.some(zone => hasText(zone.label) || hasText(zone.accepted))
    )
  }

  return false
}

const tabLabel = (tab: ActivityTab): string => {
  if (tab === 'code_fill') return 'Code Fill'
  if (tab === 'mc') return 'Quiz'
  if (tab === 'drag') return 'Drag & Drop'
  if (tab === 'balloon') return 'Balloon Pop'
  return 'Ordering'
}

const campaignDifficultyFromForm = (
  difficulty: QuestFormState['difficulty']
): Quest['difficulty'] => {
  if (difficulty === 'beginner') return 'easy'
  if (difficulty === 'intermediate') return 'medium'
  return 'hard'
}

const questPreviewFromForm = (form: QuestFormState): Quest => {
  const dragItems = form.drag_problems.flatMap(p => p.items)
  const dropZones = form.drag_problems.flatMap(p => p.drop_zones)
  const orderingItems = form.ordering_problems.flatMap(p =>
    p.items.map((item, index) => ({
      id: item.id,
      label: item.label,
      description: item.description,
      correct_order: index,
    }))
  )

  return {
    id: 'quest-builder-preview',
    title: form.title,
    description: form.description || null,
    difficulty: campaignDifficultyFromForm(form.difficulty),
    level: form.level,
    phase: levelToPhase(form.level),
    mode: 'campaign',
    basexp: form.basexp,
    requiredxp: form.requiredxp,
    sortorder: form.sortorder,
    isactive: form.isactive,
    question_type: form.act_balloon ? 'pop_balloon'
      : form.act_mc ? 'multiple_choice'
      : form.act_codefill ? 'code_fill'
      : form.act_ordering ? 'ordering'
      : form.act_drag ? 'drag_drop'
      : null,
    objectives: form.objectives.filter(Boolean),
    hints: null,
    game_items: form.act_drag ? dragItems : null,
    drop_zones: form.act_drag ? dropZones : null,
    ordering_items: form.act_ordering ? orderingItems : null,
    mc_questions: [
      ...(form.act_mc ? form.mc_questions.map(q => ({
        id: q.id,
        question: q.question,
        options: q.options,
        correct: q.correct,
        explanation: q.explanation,
        hint: q.hint,
        mode: 'mc' as const,
      })) : []),
      ...(form.act_balloon ? form.balloon_questions.map(q => ({
        id: q.id,
        question: q.question,
        options: q.options,
        correct: q.correct,
        correctAnswers: q.correctAnswers,
        explanation: q.explanation,
        hint: q.hint,
        mode: 'balloon' as const,
      })) : []),
    ],
    code_fill_items: form.act_codefill ? form.code_fill_items.map(item => ({
      id: item.id,
      code_lines: item.code_lines.split(/\r?\n/),
      language: item.language,
      answers: parseCodeFillAnswers(item.answers),
      hint: item.hint,
      caption: item.caption,
    })) : null,
    tutorial_title: form.tutorial_title || null,
    tutorial_body: form.tutorial_body || null,
    tutorial_image: null,
    theory_sections: null,
  }
}

const questActivityLabels = (q: ExistingQuest): string[] => {
  const labels: string[] = []
  const mc = Array.isArray(q.mc_questions) ? q.mc_questions : []
  const hasMode = mc.some((item: any) => item?.mode === 'balloon' || item?.mode === 'mc')
  const mcCount = hasMode
    ? mc.filter((item: any) => item?.mode !== 'balloon').length
    : q.question_type === 'pop_balloon' ? 0 : mc.length
  const balloonCount = hasMode
    ? mc.filter((item: any) => item?.mode === 'balloon').length
    : q.question_type === 'pop_balloon' ? mc.length : 0

  if (mcCount) labels.push(`MC ${mcCount}`)
  if (balloonCount) labels.push(`Balloon ${balloonCount}`)
  if (Array.isArray(q.game_items) && q.game_items.length) labels.push('Drag')
  if (Array.isArray(q.ordering_items) && q.ordering_items.length) labels.push('Ordering')
  if (Array.isArray(q.code_fill_items) && q.code_fill_items.length) labels.push(`Code ${q.code_fill_items.length}`)
  return labels
}

const defaultQF = (): QuestFormState => ({
  title: '', description: '', difficulty: 'beginner',
  level: 1, basexp: 100, requiredxp: 0, sortorder: 99, isactive: true,
  tutorial_title: '', tutorial_body: '',
  theory_sections: [], objectives: [''],
  act_mc: true, act_drag: false, act_balloon: false, act_ordering: false, act_codefill: false,
  mc_questions: [{ id: '1', question: '', options: ['', '', '', ''], correct: 0, explanation: '', hint: '' }],
  balloon_questions: [{ id: 'b1', question: '', options: ['', '', '', ''], correct: 0, correctAnswers: [0], explanation: '', hint: '' }],
  drag_problems: [newDragProblem()],
  ordering_problems: [newOrderProblem()],
  code_fill_items: [],
  hints: [],
  game_items: [], drop_zones: [],
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
  const [existingQuests, setExistingQuests] = useState<ExistingQuest[]>([])
  const [replaceTarget,  setReplaceTarget]  = useState('')
  const [questSaving,    setQuestSaving]    = useState(false)
  const [questSubTab,    setQuestSubTab]    = useState<'create' | 'manage'>('create')
  const [objectiveDraft, setObjectiveDraft] = useState('')
  const [lessonDraft,    setLessonDraft]    = useState('')
  const [hintDraft,      setHintDraft]      = useState('')
  const [questsLoading,  setQuestsLoading]  = useState(false)
  const [questActionId,  setQuestActionId]  = useState<string | null>(null)
  const [questSearch,    setQuestSearch]    = useState('')
  const [questLevelFilter, setQuestLevelFilter] = useState<'all' | '1' | '2' | '3'>('all')
  const [questStatusFilter, setQuestStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [fixingPop,      setFixingPop]      = useState(false)
  const [fixPopResult,   setFixPopResult]   = useState<string | null>(null)
  const [autoQuestLoading, setAutoQuestLoading] = useState(false)
  const [autoQuestResult, setAutoQuestResult] = useState<string | null>(null)
  const qSet = (patch: Partial<QuestFormState>) => setQuestForm(p => ({ ...p, ...patch }))

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
    } catch (err: any) {
      const message = err?.message ?? 'PDF quest generation failed'
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
      setStats(computeUserStats(data as AdminUser[]))
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
    setQuestsLoading(true)
    try {
      const { data, error } = await supabase
        .from('quests')
        .select('id, title, level, difficulty, basexp, sortorder, isactive, phase, question_type, description, tutorial_title, tutorial_body, theory_sections, objectives, hints, mc_questions, game_items, drop_zones, ordering_items, code_fill_items')
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
    } finally {
      setQuestsLoading(false)
    }
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
    setFilteredUsers(filterUsers(users, userFilter, userSearch))
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
        { key: 'maintenance_mode',    value: maintenanceOn,                          updated_by: user.id },
        { onConflict: 'key' }
      ),
      supabase.from('system_settings').upsert(
        // The `value` column is jsonb — wrap the string so Supabase doesn't
        // try to parse a bare string as a JSON object and throw a parse error.
        { key: 'maintenance_message', value: JSON.stringify(maintenanceMsg || ''),   updated_by: user.id },
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
  const resetQuestForm = () => {
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
    } catch (err: any) {
      setFixPopResult(`Error: ${err.message}`)
    }
    setFixingPop(false)
  }

  const saveQuest = async (replaceId?: string) => {
    if (!user || !questForm.title.trim()) { showToast('Title is required', 'error'); return }
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
      ...(questForm.act_mc ? (normalizeMCQuestions(questForm.mc_questions as any[]) as QFormMCQ[]).map((q, i) => ({
          id: `mc_${i + 1}`, question: q.question.trim(), options: q.options,
          correct: q.correct, explanation: q.explanation, mode: 'mc' as const,
          ...(q.hint.trim() ? { hint: q.hint.trim() } : {}),
        })) : []),
      ...(questForm.act_balloon ? (normalizeMCQuestions(questForm.balloon_questions as any[]) as QFormMCQ[]).map((q, i) => ({
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
        const all: any[] = []
        questForm.drag_problems.forEach(p =>
          p.items.forEach(g => all.push({ id: g.id, label: g.label, color: g.color, problem_id: p.id, question: p.question }))
        )
        return all.length > 0 ? all : null
      }
      return null
    })()

    const drop_zones_final = questForm.act_drag && questForm.drag_problems.length > 0
      ? (() => {
          const all: any[] = []
          questForm.drag_problems.forEach(p =>
            p.drop_zones.forEach(z => all.push({ id: z.id, label: z.label, accepted: z.accepted, problem_id: p.id }))
          )
          return all.length > 0 ? all : null
        })()
      : null

    const ordering_items = questForm.act_ordering && questForm.ordering_problems.length > 0
      ? (() => {
          const all: any[] = []
          questForm.ordering_problems.forEach(p =>
            p.items.forEach((o, i) => all.push({
              id: o.id, label: o.label, description: o.description || undefined,
              correct_order: i + 1, problem_id: p.id, question: p.question,
            }))
          )
          return all.length > 0 ? all : null
        })()
      : null

    const code_fill_items = questForm.act_codefill && questForm.code_fill_items.length > 0
      ? questForm.code_fill_items.map(c => ({
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
      difficulty: questForm.difficulty, level: questForm.level, phase, mode: 'campaign',
      basexp: questForm.basexp, requiredxp: questForm.requiredxp,
      sortorder: questForm.sortorder, isactive: questForm.isactive,
      question_type,
      objectives: questForm.objectives.filter(Boolean).length > 0 ? questForm.objectives.filter(Boolean) : null,
      hints: serializeHints(questForm.hints),
      tutorial_title: questForm.tutorial_title.trim() || null,
      tutorial_body: questForm.tutorial_body.trim() || null,
      tutorial_image: null,
      theory_sections: theory_sections.length > 0 ? theory_sections : null,
      mc_questions, game_items, drop_zones: drop_zones_final, ordering_items, code_fill_items,
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

  // q is typed as any because the function body uses internal casts against
  // the DB shape, which diverges from the ExistingQuest interface in places.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loadQuestForEdit = (q: any) => {
    const isDrag = q.question_type === 'drag_drop' || !!(q.game_items?.length && q.drop_zones?.length)

    // Split mc_questions into balloon and MC buckets.
    // New rows have a `mode` field; legacy rows without mode use question_type.
    const allMCQs: any[] = q.mc_questions ?? []
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
      ;(q.game_items as any[]).forEach(g => {
        const pid = g.problem_id ?? 'default'
        if (!problemMap.has(pid)) problemMap.set(pid, { id: pid, question: g.question ?? '', items: [], drop_zones: [] })
        problemMap.get(pid)!.items.push({ id: g.id ?? String(Math.random()), label: g.label ?? '', color: g.color ?? '#58a6ff' })
      })
      ;(q.drop_zones as any[]).forEach(z => {
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
      ;(q.ordering_items as any[])
        .slice().sort((a: any, b: any) => (a.correct_order ?? 0) - (b.correct_order ?? 0))
        .forEach((o: any) => {
          const pid = o.problem_id ?? 'default'
          if (!problemMap.has(pid)) problemMap.set(pid, { id: pid, question: o.question ?? '', items: [] })
          problemMap.get(pid)!.items.push({ id: o.id ?? String(Math.random()), label: o.label ?? '', description: o.description ?? '' })
        })
      return problemMap.size > 0 ? Array.from(problemMap.values()) : [newOrderProblem()]
    })()

    setQuestForm({
      title: q.title ?? '', description: q.description ?? '',
      difficulty: q.difficulty ?? 'beginner', level: q.level ?? 1,
      basexp: q.basexp ?? 100, requiredxp: q.requiredxp ?? 0,
      sortorder: q.sortorder ?? 99, isactive: q.isactive ?? true,
      tutorial_title: q.tutorial_title ?? '', tutorial_body: q.tutorial_body ?? '',
      theory_sections: (q.theory_sections ?? []).map((s: any, i: number) => ({
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
      mc_questions: mcQsDB.length > 0 ? mcQsDB.map((m: any) => {
        const normalized = normalizeMCQuestionOptions(m)
        return ({
        id: m.id ?? String(Math.random()), question: m.question ?? '',
        options: [...(normalized.options as string[]), '', '', '', ''].slice(0, 4) as [string, string, string, string],
        correct: normalized.correct as number, explanation: m.explanation ?? '',
        hint: m.hint ?? '',
      })}) : [{ id: '1', question: '', options: ['', '', '', ''], correct: 0, explanation: '', hint: '' }],
      balloon_questions: balloonQsDB.length > 0 ? balloonQsDB.map((m: any) => {
        const normalized = normalizeMCQuestionOptions(m)
        return ({
        id: m.id ?? String(Math.random()), question: m.question ?? '',
        options: [...(normalized.options as string[]), '', '', '', ''].slice(0, 4) as [string, string, string, string],
        correct: normalized.correct as number,
        correctAnswers: Array.isArray((normalized as any).correctAnswers) ? (normalized as any).correctAnswers : [normalized.correct as number],
        explanation: m.explanation ?? '',
        hint: m.hint ?? '',
      })}) : [{ id: 'b1', question: '', options: ['', '', '', ''], correct: 0, correctAnswers: [0], explanation: '', hint: '' }],
      drag_problems: dragProblems,
      ordering_problems: orderingProblems,
      code_fill_items: (q.code_fill_items ?? []).map((c: any) => ({
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

  const toggleQuestActive = async (q: any) => {
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
      await writeAuditLog(user.id, q.isactive ? 'quest_deactivate' : 'quest_activate', undefined, { title: q.title })
      showToast(`Quest ${q.isactive ? 'deactivated' : 'activated'}`)
      await fetchExistingQuests()
    } catch (err: any) {
      showToast(`Failed: ${err.message}`, 'error')
    } finally {
      setQuestActionId(null)
    }
  }

  const deleteQuest = async (q: any) => {
    if (!user) return
    if (!window.confirm(`Delete quest "${q.title}"? This cannot be undone.`)) return
    setQuestActionId(q.id)
    try {
      const { data, error } = await supabase
        .from('quests')
        .delete()
        .eq('id', q.id)
        .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('No quest row was deleted. Check quest delete permissions.')
      await writeAuditLog(user.id, 'quest_delete', undefined, { title: q.title, id: q.id })
      showToast('Quest deleted')
      if (replaceTarget === q.id) setReplaceTarget('')
      await fetchExistingQuests()
    } catch (err: any) {
      showToast(`Failed: ${err.message}`, 'error')
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
                                <select className="form-select" value={questForm.level} onChange={e => qSet({ level: Number(e.target.value) as 1|2|3 })}>
                                  <option value={1}>1 – Beginner</option>
                                  <option value={2}>2 – Intermediate</option>
                                  <option value={3}>3 – Advanced</option>
                                </select>
                              </div>
                              <div className="col-4">
                                <label className="form-label">Difficulty</label>
                                <select className="form-select" value={questForm.difficulty} onChange={e => qSet({ difficulty: e.target.value as any })}>
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
                                <button className="btn btn-xs btn-outline-primary" onClick={() => qSet({ theory_sections: [...questForm.theory_sections, newTheorySection('default')] })}>+ Text</button>
                                <button className="btn btn-xs btn-outline-secondary" onClick={() => qSet({ theory_sections: [...questForm.theory_sections, newTheorySection('tip')] })}>+ Tip</button>
                                <button className="btn btn-xs btn-outline-secondary" onClick={() => qSet({ theory_sections: [...questForm.theory_sections, newTheorySection('code')] })}>+ Code</button>
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
                                      onChange={e => { const rows = [...questForm.hints]; rows[i] = { ...rows[i], activity: e.target.value as any }; qSet({ hints: rows }) }}>
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
                            <select className="form-select form-select-sm" value={questLevelFilter} onChange={e => setQuestLevelFilter(e.target.value as any)}>
                              <option value="all">All levels</option>
                              <option value="1">Level 1</option>
                              <option value="2">Level 2</option>
                              <option value="3">Level 3</option>
                            </select>
                          </div>
                          <div className="col-6 col-md-2">
                            <label className="form-label">Status</label>
                            <select className="form-select form-select-sm" value={questStatusFilter} onChange={e => setQuestStatusFilter(e.target.value as any)}>
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
                            <tr><th>Title</th><th>Level</th><th>Activities</th><th>XP</th><th>Order</th><th>Status</th><th className="text-end">Actions</th></tr>
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
                                <td><span className={`badge bg-${q.level === 1 ? 'green' : q.level === 2 ? 'yellow' : 'red'}-lt`}>Level {q.level}</span></td>
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
                                    <button className="btn btn-sm btn-outline-primary" disabled={!!questActionId} onClick={() => { loadQuestForEdit(q); }}>Edit</button>
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
    </div>
  )
}
