// frontend/src/admin/adminHelpers.ts
// Pure helpers extracted from AdminPanel.tsx for unit testing. Each function
// mirrors behavior used inline in the panel — no DB calls, no React.

// ─── Types (minimal — only what helpers touch) ─────────────────────────────
export interface AdminUserLite {
  id:          string;
  playername:  string;
  email:       string;
  is_admin:    boolean;
  is_banned:   boolean;
}

export type UserFilter = 'all' | 'active' | 'banned' | 'admin';

export interface UserStats {
  total:  number;
  active: number;
  banned: number;
  admins: number;
}

export interface MCQuestionLite {
  question:    string;
  mode?:       'mc' | 'balloon';
  options?:    unknown;
  correct?:    unknown;
  correctAnswers?: unknown;
  correct_answers?: unknown;
  correct_indices?: unknown;
  // extra fields ignored
  [k: string]: unknown;
}

export type Level = number;
export type Phase = 'beginner' | 'intermediate' | 'advanced' | `level_${number}`;

// ─── User stats ────────────────────────────────────────────────────────────
export function computeUserStats<U extends AdminUserLite>(users: U[]): UserStats {
  return {
    total:  users.length,
    active: users.filter(u => !u.is_banned).length,
    banned: users.filter(u =>  u.is_banned).length,
    admins: users.filter(u =>  u.is_admin).length,
  };
}

// ─── User filtering (filter dropdown + search box) ─────────────────────────
export function filterUsers<U extends AdminUserLite>(
  users:  U[],
  filter: UserFilter,
  search: string,
): U[] {
  let list = users;
  if (filter === 'active') list = list.filter(u => !u.is_banned);
  if (filter === 'banned') list = list.filter(u =>  u.is_banned);
  if (filter === 'admin')  list = list.filter(u =>  u.is_admin);

  const q = search.trim().toLowerCase();
  if (q) {
    list = list.filter(u =>
      u.playername.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q)
    );
  }
  return list;
}

// ─── Level → phase mapping (used when saving a quest) ──────────────────────
export function levelToPhase(level: Level): Phase {
  if (level === 1) return 'beginner';
  if (level === 2) return 'intermediate';
  if (level === 3) return 'advanced';
  return `level_${Math.max(1, Math.trunc(level))}` as `level_${number}`;
}

// ─── Balloon-pop language patcher ───────────────────────────────────────────
// Rewrites legacy "Pop the…" phrasing in MC questions to language that fits
// non-balloon Multiple Choice quizzes. Returns the patched question text.
export function fixPopLanguageInQuestion(orig: string): string {
  return orig
    .replace(/^Pop the item(s)? that\b/gi, 'Which item$1')
    .replace(/^Pop the item(s)?\s+/gi,     'Select the item$1 ')
    .replace(/^Pop\s+/gi,                  'Select ');
}

// ─── Patch an MC-question array (used by the fix-pop bulk action) ──────────
export interface PopFixResult {
  patched: MCQuestionLite[];
  /** Number of questions that changed (per call). */
  changed: number;
}

export function patchMCQuestions(qs: MCQuestionLite[]): PopFixResult {
  let changed = 0;
  const patched = qs.map(q => {
    const orig    = q.question ?? '';
    const updated = fixPopLanguageInQuestion(orig);
    if (updated !== orig) { changed++; return { ...q, question: updated }; }
    return q;
  });
  return { patched, changed };
}

// ─── MC/balloon split (used when loading an existing quest for edit) ───────
// New rows have a `mode` field on each MCQ. Legacy rows have no mode — the
// whole array is one bucket determined by question_type.
export interface MCSplit {
  mc:      MCQuestionLite[];
  balloon: MCQuestionLite[];
}

export function splitMCQuestions(
  all:           MCQuestionLite[],
  question_type: string | null,
): MCSplit {
  const hasMode = all.some(m => m.mode === 'balloon' || m.mode === 'mc');
  if (hasMode) {
    return {
      mc:      all.filter(m => m.mode !== 'balloon'),
      balloon: all.filter(m => m.mode === 'balloon'),
    };
  }
  if (question_type === 'pop_balloon') {
    return { mc: [], balloon: all };
  }
  return { mc: all, balloon: [] };
}

// ─── MC option normalization ───────────────────────────────────────────────
// Admin forms display up to four option inputs, but a valid question may have
// only three choices. Before saving or rendering, drop blank choices and move
// the correct index to the matching non-empty option.
export function normalizeMCQuestionOptions<T extends MCQuestionLite>(q: T): T {
  const rawOptions = Array.isArray(q.options) ? q.options : [];
  const compactOptions = rawOptions
    .map((option, originalIndex) => ({
      originalIndex,
      value: typeof option === 'string' ? option.trim() : String(option ?? '').trim(),
    }))
    .filter(option => option.value.length > 0);

  const readIndices = (value: unknown): number[] => {
    const values = Array.isArray(value) ? value : [value];
    return values
      .map(v => typeof v === 'number' ? v : Number(v))
      .filter(v => Number.isInteger(v) && v >= 0);
  };

  const rawCorrectIndices = [
    ...readIndices(q.correctAnswers),
    ...readIndices(q.correct_answers),
    ...readIndices(q.correct_indices),
    ...readIndices(q.correct),
  ];
  const uniqueRawCorrectIndices = Array.from(new Set(rawCorrectIndices.length ? rawCorrectIndices : [0]));

  const nextCorrectAnswers = uniqueRawCorrectIndices
    .map(rawCorrect => {
      const correctValue = rawOptions[rawCorrect];
      return compactOptions.findIndex(option =>
        option.originalIndex === rawCorrect ||
        option.value === (typeof correctValue === 'string' ? correctValue.trim() : String(correctValue ?? '').trim())
      );
    })
    .filter((idx, pos, arr) => idx >= 0 && arr.indexOf(idx) === pos);

  const fallbackCorrect = compactOptions.length > 0 ? 0 : -1;
  const correctAnswers = nextCorrectAnswers.length > 0 ? nextCorrectAnswers : (fallbackCorrect >= 0 ? [fallbackCorrect] : []);

  return {
    ...q,
    options: compactOptions.map(option => option.value),
    correct: correctAnswers[0] ?? 0,
    correctAnswers,
  };
}

export function normalizeMCQuestions<T extends MCQuestionLite>(questions: T[]): T[] {
  return questions
    .map(normalizeMCQuestionOptions)
    .filter(q => String(q.question ?? '').trim().length > 0 || (Array.isArray(q.options) && q.options.length > 0));
}

// ─── Hint editor (admin form ↔ DB JSONB round-trip) ───────────────────────
// `quests.hints` is a JSONB array of objects shaped like:
//   { title, body, icon?, activity?, image?, ...future fields }
//
// The admin form exposes title/body/icon/activity. To stay compatible with
// hints authored via raw SQL — which may carry fields the panel doesn't
// understand (e.g. `image: true`) — we keep the original DB object on each
// row as `_extra` and merge it back on save so unknown fields survive.

/** Activity tabs a hint can be scoped to. 'all' is the form's representation
 *  of an *untagged* hint (no `activity` field in the DB). */
export type HintActivityScope = 'all' | 'drag' | 'code_fill' | 'balloon' | 'ordering' | 'mc';

export const HINT_ACTIVITY_OPTIONS: { value: HintActivityScope; label: string }[] = [
  { value: 'all',       label: 'All tabs (fallback)' },
  { value: 'drag',      label: 'Drag & Drop' },
  { value: 'code_fill', label: 'Code Fill' },
  { value: 'ordering',  label: 'Ordering' },
  { value: 'mc',        label: 'Multiple Choice' },
  { value: 'balloon',   label: 'Balloon Pop' },
];

export interface HintFormRow {
  id:       string;            // form-only stable key for React lists
  title:    string;
  body:     string;
  icon:     string;            // empty string = use default 💡 in UI
  activity: HintActivityScope;
  /** Original DB object (minus the editable fields). Preserved so SQL-set
   *  extras like `image: true` survive a round-trip through the form. */
  _extra:   Record<string, unknown>;
}

const KNOWN_HINT_KEYS = new Set(['title', 'body', 'icon', 'activity']);

/** Load a JSONB hints array (e.g. from `quests.hints`) into form rows.
 *  Tolerates null/undefined/non-array input. Untagged hints become activity='all'. */
export function loadHintsForEdit(raw: unknown): HintFormRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((h, i) => {
    const obj = (h && typeof h === 'object') ? (h as Record<string, unknown>) : {};
    const extra: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) {
      if (!KNOWN_HINT_KEYS.has(k)) extra[k] = obj[k];
    }
    const activity = obj.activity;
    const scope: HintActivityScope =
      activity === 'drag' || activity === 'code_fill' || activity === 'balloon' ||
      activity === 'ordering' || activity === 'mc'
        ? activity
        : 'all';
    return {
      id:       `h_${i}_${Math.random().toString(36).slice(2, 8)}`,
      title:    typeof obj.title === 'string' ? obj.title : '',
      body:     typeof obj.body  === 'string' ? obj.body  : '',
      icon:     typeof obj.icon  === 'string' ? obj.icon  : '',
      activity: scope,
      _extra:   extra,
    };
  });
}

/** Serialize form rows back to the JSONB shape stored in `quests.hints`.
 *  - Empty rows (no title AND no body) are dropped.
 *  - activity='all' is encoded as omitting the `activity` key (untagged hint).
 *  - icon='' is encoded as omitting `icon` (UI falls back to the 💡 default).
 *  - `_extra` is merged back in first so it can't shadow edited fields.
 *  Returns null when the result would be an empty array — matches the
 *  convention used for other optional JSONB columns in this panel. */
export function serializeHints(rows: HintFormRow[]): Record<string, unknown>[] | null {
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    const title = r.title.trim();
    const body  = r.body.trim();
    if (!title && !body) continue;
    const obj: Record<string, unknown> = { ...r._extra, title, body };
    const icon = r.icon.trim();
    if (icon) obj.icon = icon;
    if (r.activity !== 'all') obj.activity = r.activity;
    out.push(obj);
  }
  return out.length > 0 ? out : null;
}

// ─── Code-fill CSV parser ──────────────────────────────────────────────────
// The admin form stores comma-separated answers as a single string. On save,
// we split on commas, trim, drop empties.
export function parseCodeFillAnswers(csv: string): string[] {
  return csv.split(',').map(a => a.trim()).filter(Boolean);
}
