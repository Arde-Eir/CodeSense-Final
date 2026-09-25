import {
  levelToPhase,
  normalizeMCQuestionOptions,
  parseCodeFillAnswers,
  type HintFormRow,
  type MCQuestionLite,
} from './adminHelpers'
import { supabase } from '@/services/supabase'
import type { ActivityTab, Quest } from '@/types/campaign'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Subset of the quests table returned by fetchExistingQuests */
export interface ExistingQuest {
  id: string
  title: string
  level: number | null
  difficulty: string | null
  basexp: number
  requiredxp?: number
  sortorder: number
  isactive: boolean
  phase: string | null
  question_type: string | null
  description: string | null
  tutorial_title?: string | null
  tutorial_body?: string | null
  theory_sections?: StoredTheorySection[] | null
  objectives?: string[] | null
  hints?: unknown[] | null
  mc_questions?: StoredChoiceQuestion[] | null
  game_items?: StoredDragItem[] | null
  drop_zones?: StoredDropZone[] | null
  ordering_items?: StoredOrderItem[] | null
  code_fill_items?: StoredCodeFillItem[] | null
}

export interface StoredTheorySection {
  type?: string
  heading?: string
  body?: string
  code?: string
  language?: string
  table_headers?: string[]
  table_rows?: string[][]
}

export interface StoredChoiceQuestion extends MCQuestionLite {
  id?: string
  mode?: 'mc' | 'balloon'
  explanation?: string
  hint?: string
}

export interface StoredDragItem {
  id?: string
  label?: string
  color?: string
  problem_id?: string
  question?: string
}

export interface StoredDropZone {
  id?: string
  label?: string
  accepted?: string
  problem_id?: string
  question?: string
}

export interface StoredOrderItem {
  id?: string
  label?: string
  description?: string
  correct_order?: number
  problem_id?: string
  question?: string
}

export interface StoredCodeFillItem {
  id?: string
  code_lines?: string[] | string
  language?: string
  answers?: string[] | string
  hint?: string
  caption?: string
}

export interface AdminUser {
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

export interface AuditEntry {
  id: string
  admin_id: string
  target_user_id: string | null
  action: string
  details: unknown
  created_at: string
  admin?: { playername: string }
  target?: { playername: string }
}

export interface Announcement {
  id: string
  title: string
  body: string
  priority: 'info' | 'warning' | 'success' | 'critical'
  author: string
  ispinned: boolean
  createdat: string
}

export type Tab = 'dashboard' | 'users' | 'audit' | 'maintenance' | 'announcements' | 'quests'

export interface AdminUserChanges {
  is_admin?: boolean
  is_banned?: boolean
  ban_reason?: string | null
  banned_at?: string | null
}

// ─── Quest form types ─────────────────────────────────────────────────────────

export interface QFormTheory    { id: string; type: string; heading: string; body: string; code: string; language: string; table_headers: string[]; table_rows: string[][] }
export interface QFormMCQ       { id: string; question: string; options: [string,string,string,string]; correct: number; correctAnswers?: number[]; explanation: string; hint: string }
export interface QFormDragItem  { id: string; label: string; color: string }
export interface QFormDropZone  { id: string; label: string; accepted: string }
export interface QFormCodeFill  { id: string; code_lines: string; language: string; answers: string; hint: string; caption: string }

// Multi-problem types
export interface QFormDragProblem  { id: string; question: string; items: QFormDragItem[]; drop_zones: QFormDropZone[] }
export interface QFormOrderItem    { id: string; label: string; description: string }
export interface QFormOrderProblem { id: string; question: string; items: QFormOrderItem[] }

export interface QuestFormState {
  title: string; description: string
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert'; level: number
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

export type QuestDifficulty = QuestFormState['difficulty']
export type QuestActivityFlag = 'act_mc' | 'act_drag' | 'act_balloon' | 'act_ordering' | 'act_codefill'

export const newDragProblem = (): QFormDragProblem => ({
  id: `dp_${Date.now()}`, question: '', items: [], drop_zones: [],
})
export const newOrderProblem = (): QFormOrderProblem => ({
  id: `op_${Date.now()}`, question: '', items: [],
})

export const storedChoiceQuestionToForm = (
  question: StoredChoiceQuestion,
  fallbackId: string,
): QFormMCQ => {
  const normalized = normalizeMCQuestionOptions(question)
  const compactOptions = Array.isArray(normalized.options)
    ? normalized.options.map(option => String(option ?? ''))
    : []
  const paddedOptions = [...compactOptions, '', '', '', ''].slice(0, 4) as QFormMCQ['options']
  const numericCorrect = Number(normalized.correct)
  const correct = Number.isInteger(numericCorrect) && numericCorrect >= 0 ? numericCorrect : 0
  const correctAnswers = Array.isArray(normalized.correctAnswers)
    ? normalized.correctAnswers
        .map(answer => Number(answer))
        .filter(answer => Number.isInteger(answer) && answer >= 0 && answer < paddedOptions.length)
    : [correct]

  return {
    id: question.id ?? fallbackId,
    question: question.question ?? '',
    options: paddedOptions,
    correct,
    correctAnswers: correctAnswers.length > 0 ? correctAnswers : [correct],
    explanation: question.explanation ?? '',
    hint: question.hint ?? '',
  }
}

export const newTheorySection = (type: string, patch: Partial<QFormTheory>): QFormTheory => ({
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

export const parseLineList = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)

export const lessonTextToSections = (text: string): QFormTheory[] =>
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

export const parseHintLines = (text: string): HintFormRow[] =>
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

export const hasText = (value: unknown): boolean =>
  String(value ?? '').trim().length > 0

export const selectedTabsForForm = (form: QuestFormState): ActivityTab[] => {
  const tabs: ActivityTab[] = []
  if (form.act_drag) tabs.push('drag')
  if (form.act_codefill) tabs.push('code_fill')
  if (form.act_ordering) tabs.push('ordering')
  if (form.act_balloon) tabs.push('balloon')
  if (form.act_mc) tabs.push('mc')
  return tabs
}

export const tabHasContent = (form: QuestFormState, tab: ActivityTab): boolean => {
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

export const tabLabel = (tab: ActivityTab): string => {
  if (tab === 'code_fill') return 'Code Fill'
  if (tab === 'mc') return 'Quiz'
  if (tab === 'drag') return 'Drag & Drop'
  if (tab === 'balloon') return 'Balloon Pop'
  return 'Ordering'
}

export const campaignDifficultyFromForm = (
  difficulty: QuestFormState['difficulty']
): Quest['difficulty'] => {
  if (difficulty === 'beginner') return 'easy'
  if (difficulty === 'intermediate') return 'medium'
  return 'hard'
}

export const campaignDifficultyToForm = (
  difficulty: string | null | undefined
): QuestFormState['difficulty'] => {
  if (difficulty === 'easy' || difficulty === 'beginner') return 'beginner'
  if (difficulty === 'medium' || difficulty === 'intermediate') return 'intermediate'
  if (difficulty === 'hard' || difficulty === 'advanced') return 'advanced'
  return 'beginner'
}

export const questPreviewFromForm = (form: QuestFormState): Quest => {
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

export const questActivityLabels = (q: ExistingQuest): string[] => {
  const labels: string[] = []
  const mc = Array.isArray(q.mc_questions) ? q.mc_questions : []
  const itemMode = (item: unknown): unknown =>
    typeof item === 'object' && item !== null && 'mode' in item ? item.mode : null
  const hasMode = mc.some(item => itemMode(item) === 'balloon' || itemMode(item) === 'mc')
  const mcCount = hasMode
    ? mc.filter(item => itemMode(item) !== 'balloon').length
    : q.question_type === 'pop_balloon' ? 0 : mc.length
  const balloonCount = hasMode
    ? mc.filter(item => itemMode(item) === 'balloon').length
    : q.question_type === 'pop_balloon' ? mc.length : 0

  if (mcCount) labels.push(`MC ${mcCount}`)
  if (balloonCount) labels.push(`Balloon ${balloonCount}`)
  if (Array.isArray(q.game_items) && q.game_items.length) labels.push('Drag')
  if (Array.isArray(q.ordering_items) && q.ordering_items.length) labels.push('Ordering')
  if (Array.isArray(q.code_fill_items) && q.code_fill_items.length) labels.push(`Code ${q.code_fill_items.length}`)
  if (labels.length === 0 && q.question_type) {
    const primaryLabels: Record<string, string> = {
      multiple_choice: 'Multiple Choice', pop_balloon: 'Balloon Pop', drag_drop: 'Drag & Drop',
      ordering: 'Ordering', code_fill: 'Code Fill',
    }
    labels.push(primaryLabels[q.question_type] ?? q.question_type.replaceAll('_', ' '))
  }
  return labels
}

export const coreLevelNames: Record<number, string> = {
  1: 'Beginner',
  2: 'Intermediate',
  3: 'Advanced',
}

export const levelName = (level: number): string =>
  coreLevelNames[level] ?? `Custom Level ${level}`

export const levelOptionLabel = (level: number): string =>
  `${level} - ${levelName(level)}`

export const levelBadgeColor = (level: number): string => {
  if (level === 1) return 'green'
  if (level === 2) return 'yellow'
  if (level === 3) return 'red'
  return 'purple'
}

export const defaultQF = (): QuestFormState => ({
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

export const defaultLevelAccent = (level: number): string => {
  const colors = ['#3fb950', '#e3b341', '#f85149', '#a371f7', '#58a6ff', '#ff7b72'];
  return colors[Math.max(0, level - 1) % colors.length];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export const settingStringValue = (value: unknown): string => {
  if (typeof value !== 'string') return String(value ?? '')
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === 'string' ? parsed : value
  } catch {
    return value
  }
}

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export async function writeAuditLog(
  adminId: string,
  action: string,
  targetUserId: string | undefined,
  details: object | undefined
): Promise<void> {
  let lastErrorMessage = ''
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { error } = await supabase.from('admin_audit_log').insert({
      admin_id: adminId,
      target_user_id: targetUserId ?? null,
      action,
      details: details ?? null,
    })
    if (!error) return

    lastErrorMessage = error.message
    console.warn('Admin audit log write failed', {
      action,
      adminId,
      targetUserId: targetUserId ?? null,
      attempt,
      error: error.message,
    })
  }

  throw new Error(
    `Could not record admin audit action ${JSON.stringify(action)} after 2 attempts: ${lastErrorMessage}`,
  )
}
