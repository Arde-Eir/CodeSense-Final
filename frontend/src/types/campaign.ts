// ============================================================================
// frontend/src/types/campaign.ts
// Single source of truth for all campaign-mode types.
// Replaces the duplicated/divergent interfaces previously in:
//   • CampaignPage.tsx
//   • CampaignInside.tsx
//   • levelonedashboard.tsx
//   • lessonactivity.tsx
// ============================================================================

// ─── Phase / Level ──────────────────────────────────────────────────────────
export type Phase = 'beginner' | 'intermediate' | 'advanced';

export const PHASE_TO_LEVEL: Record<Phase, 1 | 2 | 3> = {
  beginner:     1,
  intermediate: 2,
  advanced:     3,
};

export const LEVEL_TO_PHASE: Record<1 | 2 | 3, Phase> = {
  1: 'beginner',
  2: 'intermediate',
  3: 'advanced',
};

// ─── Activity tabs (mini-games inside a quest) ──────────────────────────────
export type ActivityTab = 'drag' | 'code_fill' | 'balloon' | 'ordering' | 'mc';

// ─── Hint (per-activity guidance shown in the side panel) ──────────────────
export interface HintItem {
  icon?: string;
  title: string;
  body: string;
  image?: boolean;
  /** Optional — restricts this hint to a single activity tab. Untagged hints
   *  show on every tab as a fallback. */
  activity?: ActivityTab;
}

// ─── Mini-game data shapes (one per ActivityTab) ───────────────────────────
export interface GameItem  { id: string; label: string; color: string; }
export interface DropZone  { id: string; label: string; accepted: string; }
export interface OrderItem { id: string; label: string; description?: string; correct_order: number; }
export interface MCQ       { id: string; question: string; options: string[]; correct: number; explanation: string; }

export interface CodeFillItem {
  id: string;
  /** Each line may contain `___` (three underscores) which become input boxes
   *  in left-to-right order. Their answers come from `answers` in matching order. */
  code_lines: string[];
  language?: string;
  answers: string[];
  hint?: string;
  caption?: string;
}

// ─── Theory (the lesson's reading material before the games) ───────────────
export interface TheorySection {
  type?: 'default' | 'code' | 'did_you_know' | 'mistake' | 'diagram' | 'tip' | 'summary';
  heading?: string;
  body?: string;
  items?: { term: string; definition: string }[];
  language?: string;
  code?: string;
  code_caption?: string;
  diagram?: string;
  diagram_caption?: string;
  mistakes?: { wrong: string; right: string; explanation: string }[];
  tips?: { icon?: string; title: string; body: string }[];
  bullets?: string[];
}

// ─── Quest (one row from the `quests` table) ───────────────────────────────
/** Mirrors the `quests` table's columns. Activity-content fields are nullable
 *  because quizzes only have mc_questions, lessons have several at once, etc. */
export interface Quest {
  id: string;
  title: string;
  description: string | null;
  difficulty:     'easy' | 'medium' | 'hard' | null;
  level:          1 | 2 | 3 | null;
  phase:          Phase | null;
  basexp:         number;
  requiredxp:     number;
  sortorder:      number;
  isactive:       boolean;
  question_type:  'drag_drop' | 'pop_balloon' | 'ordering' | 'multiple_choice' | 'code_fill' | null;
  objectives:     string[] | null;
  hints:          HintItem[] | null;

  // Activity payloads
  game_items:      GameItem[]      | null;
  drop_zones:      DropZone[]      | null;
  ordering_items:  OrderItem[]     | null;
  mc_questions:    MCQ[]           | null;
  code_fill_items: CodeFillItem[]  | null;

  // Theory & tutorial
  tutorial_title:  string | null;
  tutorial_body:   string | null;
  tutorial_image:  string | null;
  theory_sections: TheorySection[] | null;
}

// ─── Mission progress (one row per (userid, questid)) ──────────────────────
/** Mirrors the `mission_progress` table after migration v2.
 *  `first_completed_at` is the durable "ever-finished" stamp — it is set
 *  ONCE on the user's first full completion of a quest and is preserved
 *  across retakes by both the RPC's COALESCE and a DB trigger. */
export interface MissionProgress {
  id:                   string;
  userid:               string;
  questid:              string;
  status:               'active' | 'completed' | 'locked';
  attempts:             number;
  hintsused:            number;
  startedat:            string | null;
  completedat:          string | null;
  first_completed_at:   string | null;
  updatedat:            string | null;
  xp_gained:                number;
  completed_activities:     ActivityTab[] | null;
  completion_time_seconds?: number | null;
}

// ─── Computed UI state for the dashboard ───────────────────────────────────
/** Status of a quest as shown on the dashboard.
 *   completed → finished (green; offers Review/Retake)
 *   active    → unlocked, not yet finished (yellow; offers Start)
 *   locked    → previous quest hasn't been completed yet (gray; not clickable) */
export type QuestUIStatus = 'completed' | 'active' | 'locked';

export interface QuestRow extends Quest {
  uiStatus: QuestUIStatus;
  /** `mission_progress.xp_gained` for this user — falls back to 0. */
  xpGained: number;
  /** True iff `mission_progress.first_completed_at` is set. Drives the next
   *  quest's unlock decision. Survives retakes. */
  everCompleted: boolean;
  /** True iff `mission_progress.status === 'completed'` right now. Used by
   *  the lesson page to decide whether to show LockedBanner. */
  currentlyCompleted: boolean;
}

// ─── Phase-level metadata (banner copy / colors) ───────────────────────────
export interface LevelInfo {
  title:        string;
  subtitle:     string;
  description:  string | null;
  banner_url:   string | null;
  accent_color: string;
}

export const PHASE_DEFAULTS: Record<Phase, LevelInfo> = {
  beginner: {
    title:        'The Core of Programming',
    subtitle:     'Beginner · Level 1',
    description:  null,
    banner_url:   null,
    accent_color: '#3fb950',
  },
  intermediate: {
    title:        'Control & Functions',
    subtitle:     'Intermediate · Level 2',
    description:  null,
    banner_url:   null,
    accent_color: '#e3b341',
  },
  advanced: {
    title:        'Recursion & Arrays',
    subtitle:     'Advanced · Level 3',
    description:  null,
    banner_url:   null,
    accent_color: '#f85149',
  },
};

// ─── Aggregate stats shown in the level dashboard sidebar ──────────────────
export interface LevelStats {
  finished: number;
  total:    number;
  xpEarned: number;
  xpTotal:  number;
  streak:   number;
}
