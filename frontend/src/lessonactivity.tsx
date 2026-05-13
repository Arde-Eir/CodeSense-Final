// frontend/src/lessonactivity.tsx
// Lesson player. Loads a quest by id, walks the user through theory → games,
// awards XP, and handles retakes. Uses the extracted games (`games/*.tsx`),
// the extracted theory renderer (`components/TheorySection`), and shared
// types from `types/campaign`.
//
// Completion model:
//   • Each game tab calls onComplete(score, total). We add the tab to
//     mission_progress.completed_activities and award the tab's share of
//     basexp (or a small replay bonus if the user already finished it once).
//   • When ALL available tabs (computed from what data the quest carries)
//     are in completed_activities, we mark mission_progress.status='completed'
//     AND set first_completed_at via the patched RPC. That timestamp is the
//     durable signal CampaignInside reads to unlock the next quest.
//   • Retake calls reset_quest_for_retake. The RPC sets status='active' and
//     clears completedat — but `first_completed_at` is preserved (RPC doesn't
//     touch it; trigger blocks NULLing). So the next quest stays unlocked.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from './components/AuthScreen';
import { supabase } from './services/supabase';
import { calculateLevel } from './types';

import { DragDropGame  } from './games/DragDropGame';
import { CodeFillGame  } from './games/CodeFillGame';
import { OrderingGame  } from './games/OrderingGame';
import { MCGame        } from './games/MCGame';
import { BalloonPopGame } from './games/BalloonPopGame';

import TheorySectionBlock from './components/TheorySection';
import type { ActivityTab, HintItem, Quest, TheorySection } from './types/campaign';
import { composeHints } from './campaign/composeHints';
import {
  computeActivityXP, persistedXpGained, levelXpCapForPhase,
  FIRST_COMPLETION_XP, RETAKE_COMPLETION_XP,
} from './campaign/retakeXp';

// ─── Constants ────────────────────────────────────────────────────────────
const FETCH_TIMEOUT_MS   = 10_000;

// ─── Tab metadata ─────────────────────────────────────────────────────────
const TAB_LABEL: Record<ActivityTab, string> = {
  drag:      '🃏 Drag & Drop',
  code_fill: '💻 Code Fill',
  balloon:   '🎈 Balloon Pop',
  ordering:  '🔢 Ordering',
  mc:        '🧠 Quiz',
};

const TAB_TITLE: Record<ActivityTab, string> = {
  drag:      'DRAG & DROP GAME',
  code_fill: 'CODE FILL-IN-THE-BLANK',
  balloon:   'POP THE BALLOON GAME',
  ordering:  'ORDERING GAME',
  mc:        'MULTIPLE CHOICE QUIZ',
};

const TAB_SUBTITLE: Record<ActivityTab, string> = {
  drag:      'Drag each term to its matching description',
  code_fill: 'Fill in the blanks to complete the code',
  balloon:   'Click the balloon with the correct answer',
  ordering:  'Drag the steps into the correct order',
  mc:        'Pick the correct answer for each question',
};

/** Compute which tabs this quest should show.
 *  All activities that have backing data are shown.
 *  question_type identifies the PRIMARY tab — it appears first so the user
 *  lands on the designated activity by default. Other populated activities
 *  are still accessible as additional tabs.
 *  Exception: mc_questions backs EITHER 'balloon' or 'mc' — never both.
 *  'pop_balloon' → balloon tab only. Everything else with mc_questions → mc tab only.
 *  (If you genuinely want both, set two separate question entries in the DB.) */
function computeAvailableTabs(quest: Quest | null): ActivityTab[] {
  if (!quest) return [];
  const qt = (quest.question_type ?? '').trim().toLowerCase();
  const isBalloon = qt === 'pop_balloon';
  const isMC =
    qt === 'multiple_choice' || qt === 'multiple-choice' ||
    qt === 'mc' || qt === 'mcq' || qt === 'quiz';

  // Identify the designated primary tab (may be null if question_type is unset).
  let primary: ActivityTab | null = null;
  if      (qt === 'drag_drop')   primary = 'drag';
  else if (qt === 'code_fill')   primary = 'code_fill';
  else if (qt === 'ordering')    primary = 'ordering';
  else if (qt === 'pop_balloon') primary = 'balloon';
  else if (isMC)                 primary = 'mc';

  // Collect all activities that have data.
  // mc_questions backs EITHER balloon OR mc — determined by question_type.
  // Default (no question_type set) falls through to mc.
  const all: ActivityTab[] = [];
  if (quest.game_items?.length && quest.drop_zones?.length) all.push('drag');
  if (quest.code_fill_items?.length)                        all.push('code_fill');
  if (quest.ordering_items?.length)                         all.push('ordering');
  if (quest.mc_questions?.length) {
    const hasMode = quest.mc_questions.some(q => q.mode === 'balloon' || q.mode === 'mc');
    if (hasMode) {
      if (quest.mc_questions.some(q => q.mode === 'balloon')) all.push('balloon');
      if (quest.mc_questions.some(q => q.mode !== 'balloon'))  all.push('mc');
    } else {
      // Legacy rows without a mode field: route by question_type.
      all.push(isBalloon ? 'balloon' : 'mc');
    }
  }

  if (all.length === 0) return [];

  // Put the designated primary tab first so it's the default active tab.
  if (primary && all.includes(primary)) {
    return [primary, ...all.filter(t => t !== primary)];
  }
  return all;
}

// ─── withTimeout — abort hung Supabase calls ──────────────────────────────
function withTimeout<T>(thenable: PromiseLike<T>, ms = FETCH_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    Promise.resolve(thenable),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

// ─── XP Toast ─────────────────────────────────────────────────────────────
const XPToast: React.FC<{
  visible:    boolean;
  xpGained:   number;
  isRepeat:   boolean;
  questTitle: string;
  levelledUp: boolean;
  newLevel?:  number;
}> = ({ visible, xpGained, isRepeat, questTitle, levelledUp, newLevel }) => (
  <div style={{
    position: 'fixed', top: 68, left: '50%',
    transform: `translateX(-50%) translateY(${visible ? 0 : -20}px)`,
    opacity: visible ? 1 : 0, transition: 'all .3s ease',
    background: '#161b22',
    border: `1px solid ${levelledUp ? 'rgba(163,113,247,.5)' : isRepeat ? 'rgba(88,166,255,.4)' : 'rgba(250,204,21,.5)'}`,
    borderRadius: 12, padding: '12px 20px', zIndex: 9998,
    minWidth: 300, pointerEvents: 'none', boxShadow: '0 8px 32px rgba(0,0,0,.5)',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: levelledUp ? '#a371f7' : isRepeat ? '#58a6ff' : '#facc15', fontFamily: 'Inter,sans-serif' }}>
        {levelledUp ? `🎊 Level Up! → Level ${newLevel}` : isRepeat ? '🔄 Replay Bonus' : '🎉 +XP Earned!'}
      </span>
      <span style={{ fontSize: 10, color: '#484f58', fontFamily: 'Inter,sans-serif' }}>just now</span>
    </div>
    <div style={{ fontSize: 18, fontWeight: 900, color: levelledUp ? '#a371f7' : isRepeat ? '#58a6ff' : '#facc15', marginBottom: 3, fontFamily: "'JetBrains Mono',monospace" }}>
      +{xpGained} XP
    </div>
    <div style={{ fontSize: 12, color: '#8b949e', fontFamily: 'Inter,sans-serif', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {isRepeat ? `Bonus XP for replaying "${questTitle}"` : `Activity finished in "${questTitle}"`}
    </div>
  </div>
);

// ─── Hint Toast ───────────────────────────────────────────────────────────
const HintToast: React.FC<{ visible: boolean; hintsUsed: number }> = ({ visible, hintsUsed }) => (
  <div style={{
    position: 'fixed', top: 68, right: 24,
    transform: `translateX(${visible ? 0 : 20}px)`,
    opacity: visible ? 1 : 0, transition: 'all .3s ease',
    background: '#161b22', border: '1px solid rgba(88,166,255,.4)',
    borderRadius: 12, padding: '12px 20px', zIndex: 9997,
    minWidth: 260, pointerEvents: 'none', boxShadow: '0 8px 32px rgba(0,0,0,.5)',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#58a6ff', fontFamily: 'Inter,sans-serif' }}>💡 Hint Used</span>
      <span style={{ fontSize: 10, color: '#484f58', fontFamily: 'Inter,sans-serif' }}>#{hintsUsed}</span>
    </div>
    <div style={{ fontSize: 13, fontWeight: 700, color: '#58a6ff', marginBottom: 3, fontFamily: 'Inter,sans-serif' }}>
      Guidance unlocked
    </div>
    <div style={{ fontSize: 12, color: '#8b949e', fontFamily: 'Inter,sans-serif' }}>
      Campaign XP is fixed by completion status and level cap.
    </div>
  </div>
);

// ─── Locked Banner (after first full completion — offers retake) ─────────
const LockedBanner: React.FC<{
  earnedXP: number; title: string; onRetake: () => void; onBack: () => void;
}> = ({ earnedXP, title, onRetake, onBack }) => (
  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 32, textAlign: 'center' }}>
    <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'rgba(63,185,80,0.12)', border: '2px solid rgba(63,185,80,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36 }}>
      🏆
    </div>
    <div>
      <div style={{ fontSize: 22, fontWeight: 900, color: '#3fb950', fontFamily: 'Inter,sans-serif', marginBottom: 8 }}>
        Quest Completed!
      </div>
      <div style={{ fontSize: 14, color: '#8b949e', fontFamily: 'Inter,sans-serif', lineHeight: 1.6, maxWidth: 340 }}>
        You finished <span style={{ color: '#e6edf3', fontWeight: 700 }}>{title}</span> and earned{' '}
          <span style={{ color: '#facc15', fontWeight: 700 }}>+{earnedXP} XP</span>.
      </div>
    </div>
    <div style={{ padding: '14px 24px', borderRadius: 10, background: 'rgba(63,185,80,0.07)', border: '1px solid rgba(63,185,80,0.25)', fontSize: 13, color: '#484f58', fontFamily: 'Inter,sans-serif', lineHeight: 1.7, maxWidth: 380 }}>
      🔒 Full XP was awarded on your first completion.<br />
      Replaying gives +{RETAKE_COMPLETION_XP} XP only, until the level cap is reached.
    </div>
    <div style={{ display: 'flex', gap: 12 }}>
      <button onClick={onBack}
        style={{ padding: '11px 28px', borderRadius: 9, border: '1px solid rgba(139,148,158,0.3)', background: 'transparent', color: '#8b949e', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
        ← Back to Level
      </button>
      <button onClick={onRetake}
        style={{ padding: '11px 28px', borderRadius: 9, border: '1px solid rgba(88,166,255,0.4)', background: 'rgba(88,166,255,0.08)', color: '#58a6ff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
        🔄 Retake
      </button>
    </div>
  </div>
);

// ─── Tutorial / Theory phase ──────────────────────────────────────────────
const TutorialLearnPhase: React.FC<{ quest: Quest; onStartGame: () => void }> = ({ quest, onStartGame }) => {
  const sections: TheorySection[] = Array.isArray(quest.theory_sections) ? quest.theory_sections : [];
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 28px' }}>
        {quest.tutorial_title && <h2 style={{ fontSize: 20, fontWeight: 800, color: '#e6edf3', marginBottom: 8, fontFamily: 'Inter,sans-serif' }}>{quest.tutorial_title}</h2>}
        {quest.tutorial_body  && <p  style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.8, marginBottom: 20, fontFamily: 'Inter,sans-serif' }}>{quest.tutorial_body}</p>}
        {sections.map((sec, i) => <TheorySectionBlock key={i} sec={sec} />)}
      </div>
      <div style={{ padding: '14px 28px', borderTop: '1px solid #21262d', flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onStartGame} style={{ padding: '12px 32px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#238636,#196127)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'Inter,sans-serif', boxShadow: '0 4px 18px rgba(35,134,54,0.35)' }}>
          Start Activity 🎮
        </button>
      </div>
    </div>
  );
};

// ─── Side Panel (objectives + hints + XP reward) ──────────────────────────
const GameSidePanel: React.FC<{
  quest:           Quest;
  /** Hints visible for the current tab + current question. Composed by the
   *  parent via composeHints() so the panel doesn't refilter — keeps the
   *  per-question hint in sync with what the player is looking at. */
  tabHints:        HintItem[];
  hintsUsed:       number;
  maxHints:        number;
  earnedXP:        number;
  isCompleted:     boolean;
  onTakeHint:      () => void;
  activeTab:       ActivityTab;
  // When the quest is completed, the bottom button switches from "Take a
  // Hint" to "Next Quest". `hasNextQuest=false` means this is the last quest
  // in the phase — we still show a button, but it returns to the level page.
  hasNextQuest:    boolean;
  onNextQuest:     () => void;
}> = ({ quest, tabHints, hintsUsed, maxHints, earnedXP, isCompleted, onTakeHint, activeTab: _activeTab, hasNextQuest, onNextQuest }) => {
  const [activeHint, setActiveHint] = useState<number | null>(null);
  const noHintsAvailable = tabHints.length === 0;
  const allHintsUsed     = !noHintsAvailable && hintsUsed >= maxHints;
  const buttonDisabled   = noHintsAvailable || allHintsUsed || isCompleted;
  const unlocked: HintItem[] = tabHints.slice(0, hintsUsed);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', borderLeft: '1px solid #21262d', background: '#0d1117' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
        <div style={{ fontSize: 9, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 10 }}>OBJECTIVES</div>
        {(quest.objectives ?? []).map((obj, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
            <span style={{ color: '#3fb950', fontSize: 11, marginTop: 1, flexShrink: 0 }}>✦</span>
            <span style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.5, fontFamily: 'Inter,sans-serif' }}>{obj}</span>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
        <div style={{ fontSize: 9, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 10 }}>HINTS</div>
        {unlocked.length === 0 && (
          <div style={{ fontSize: 12, color: '#484f58', fontFamily: 'Inter,sans-serif', fontStyle: 'italic' }}>
            {noHintsAvailable
              ? 'No hints have been authored for this activity.'
              : 'Take a hint below to unlock guidance.'}
          </div>
        )}
        {unlocked.map((hint, i) => (
          <div key={i} style={{ marginBottom: 10, borderRadius: 8, border: '1px solid rgba(88,166,255,0.2)', background: 'rgba(88,166,255,0.05)', overflow: 'hidden' }}>
            <button onClick={() => setActiveHint(activeHint === i ? null : i)} style={{ width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: 14 }}>{hint.icon ?? '💡'}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#58a6ff', fontFamily: 'Inter,sans-serif', flex: 1 }}>{hint.title}</span>
              <span style={{ fontSize: 10, color: '#484f58' }}>{activeHint === i ? '▲' : '▼'}</span>
            </button>
            {activeHint === i && (
              <div style={{ padding: '0 12px 12px', fontSize: 12, color: '#8b949e', lineHeight: 1.6, fontFamily: 'Inter,sans-serif' }}>{hint.body}</div>
            )}
          </div>
        ))}
      </div>
      <div style={{ padding: '14px 18px', borderTop: '1px solid #21262d', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 10, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1px' }}>XP REWARD</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: '#facc15', fontFamily: "'JetBrains Mono',monospace" }}>{earnedXP} XP</span>
        </div>
        {isCompleted ? (
          // Quest finished — replace the hint button with a "Next Quest"
          // CTA. If there's no next quest in this phase, the button becomes
          // "Back to Level" and routes to the phase page instead.
          <button onClick={onNextQuest} style={{
            width: '100%', padding: '9px 10px', borderRadius: 9, border: 'none',
            background: 'linear-gradient(135deg,#3fb950,#2ea043)',
            color: '#fff',
            fontWeight: 800, fontSize: 11, letterSpacing: 0.4,
            cursor: 'pointer',
            fontFamily: 'Inter,sans-serif',
            boxShadow: '0 4px 14px rgba(63,185,80,0.35)',
            transition: 'all .15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'none'; }}
          >
            {hasNextQuest ? 'NEXT QUEST →' : '✓ BACK TO LEVEL'}
          </button>
        ) : (
          <button onClick={onTakeHint} disabled={buttonDisabled} style={{
            width: '100%', padding: '9px 10px', borderRadius: 9, border: 'none',
            background: buttonDisabled ? 'rgba(72,79,88,0.2)' : 'linear-gradient(135deg,#06b6d4,#0891b2)',
            color: buttonDisabled ? '#484f58' : '#000',
            fontWeight: 700, fontSize: 11,
            cursor: buttonDisabled ? 'not-allowed' : 'pointer',
            fontFamily: 'Inter,sans-serif',
            boxShadow: buttonDisabled ? 'none' : '0 4px 14px rgba(6,182,212,.35)',
            transition: 'all .15s',
          }}>
            {noHintsAvailable
              ? 'No hints available'
              : allHintsUsed
                ? 'No more hints'
                : `TAKE A HINT (${maxHints - hintsUsed} left)`}
          </button>
        )}
      </div>
    </div>
  );
};

// ─── Resizable side-panel width (persists in localStorage) ───────────────
// Defaults to 280px. Drag handle clamps within [SIDE_MIN, SIDE_MAX]. Width is
// remembered across sessions per-user via a single key.
const SIDE_DEFAULT = 280;
const SIDE_MIN     = 220;
const SIDE_MAX     = 520;
const SIDE_STORAGE = 'codesense:lesson:sidePanelWidth';

function useResizableSidePanel(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return SIDE_DEFAULT;
    const raw = window.localStorage.getItem(SIDE_STORAGE);
    const n = raw ? Number(raw) : NaN;
    if (!Number.isFinite(n)) return SIDE_DEFAULT;
    return Math.min(SIDE_MAX, Math.max(SIDE_MIN, n));
  });
  const [isResizing, setIsResizing] = useState(false);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const onMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      // Side panel is on the right — width is distance from cursor to right edge.
      const next = Math.min(SIDE_MAX, Math.max(SIDE_MIN, rect.right - e.clientX));
      setWidth(next);
    };
    const onUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    // Block text selection / change cursor globally while dragging
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor     = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor     = 'col-resize';

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor     = prevCursor;
    };
  }, [isResizing, containerRef]);

  // Persist after the drag settles.
  useEffect(() => {
    if (isResizing) return;
    try { window.localStorage.setItem(SIDE_STORAGE, String(width)); } catch {/* ignore quota */}
  }, [width, isResizing]);

  const resetWidth = useCallback(() => setWidth(SIDE_DEFAULT), []);

  return { width, isResizing, onResizeStart, resetWidth };
}

// ─── Main page ────────────────────────────────────────────────────────────
export const LessonActivity: React.FC = () => {
  const navigate = useNavigate();
  const { questId } = useParams<{ questId: string }>();
  const { user } = useAuth();

  const [quest,       setQuest]       = useState<Quest | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [fetchError,  setFetchError]  = useState<string | null>(null);

  const [appPhase,     setAppPhase]     = useState<'tutorial' | 'game'>('tutorial');
  const [activeTab,    setActiveTab]    = useState<ActivityTab>('drag');
  const [resetSignal,  setResetSignal]  = useState(0);

  const [progressId,   setProgressId]   = useState<string | null>(null);
  // `hintsUsed` is the UI counter (which reveal cards are open). Resets to 0
  // when the player moves to a new question — see handleItemChange.
  const [hintsUsed,           setHintsUsed]           = useState(0);
  const [isCompleted,  setIsCompleted]  = useState(false);
  const [earnedXP,     setEarnedXP]     = useState(0);
  // Current item index inside the active tab (0 = first question / item).
  // Reported up by MCGame / BalloonPopGame / CodeFillGame via onItemChange.
  // Ordering and DragDrop don't have a meaningful "current item" so they
  // leave this at 0 and the side panel falls back to the per-tab pool.
  const [currentItemIdx, setCurrentItemIdx] = useState(0);

  // Next quest in the same phase (by sortorder). Used to power the
  // "Next Quest" button that replaces "Take a Hint" once the quest is fully
  // completed. `null` once we know there's no next quest in this phase.
  const [nextQuestId, setNextQuestId] = useState<string | null | undefined>(undefined);

  const [xpToast, setXpToast] = useState({ visible: false, amount: 0, repeat: false, levelUp: false, newLevel: undefined as number | undefined });
  const [hintToast, setHintToast] = useState({ visible: false });

  // Stopwatch: counts up from when the user enters the game phase.
  // The final elapsed seconds are saved to the DB on quest completion and
  // shown on leaderboards and profiles.
  const [elapsed,        setElapsed]        = useState(0);
  const gameStartedAtRef = useRef<number | null>(null);

  // Refs for values used inside async callbacks (avoid stale closures).
  const completedActivitiesRef = useRef<ActivityTab[]>([]);
  const everCompletedRef       = useRef<ActivityTab[]>([]);  // tabs completed in any prior session
  const hintsUsedRef           = useRef(0);
  // mission_progress.xp_gained as it stood when this quest was loaded. Used
  // to keep the row monotonic and prevent reloads from reopening phase-cap
  // headroom.
  const priorXpGainedRef       = useRef(0);
  // True once this quest has been fully completed at least once (any session).
  // Drives celebration suppression on subsequent retakes.
  const hasEverFullyCompletedRef = useRef(false);
  const levelXpCapRef          = useRef(0);  // sum of basexp for all quests in this phase
  const levelXpEarnedRef       = useRef(0);  // total xp_gained for this user in this phase
  const xpToastTimer           = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintToastTimer         = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resizable hint side-panel: bodyRef anchors the drag-clamp to the
  // content row (so width math is independent of the page chrome).
  const bodyRef = useRef<HTMLDivElement>(null);
  const {
    width: sidePanelWidth,
    isResizing: isSideResizing,
    onResizeStart,
    resetWidth: resetSidePanelWidth,
  } = useResizableSidePanel(bodyRef);

  // Mobile: hint panel is hidden by default and toggled by a button
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);

  // ── Load quest + this user's mission_progress row ─────────────────────
  const doFetch = useCallback(async () => {
    if (!user?.id || !questId) return;
    setLoading(true); setFetchError(null);

    // RESET per-quest state — `/lesson/:questId` keeps the same component
    // instance when the route param changes (e.g. "Next Quest" button), so
    // without an explicit reset, isCompleted / hintsUsed / completedActivities
    // from the previous quest leak into the new one. That made the Next-Quest
    // button still appear on the freshly loaded quest, letting the user
    // chain-click forward and skip quests they never finished.
    setQuest(null);
    setIsCompleted(false);
    setEarnedXP(0);
    setHintsUsed(0);
    setProgressId(null);
    setNextQuestId(undefined);
    setAppPhase('tutorial');
    completedActivitiesRef.current   = [];
    everCompletedRef.current         = [];
    priorXpGainedRef.current         = 0;
    hasEverFullyCompletedRef.current = false;
    hintsUsedRef.current           = 0;
    levelXpCapRef.current          = 0;
    levelXpEarnedRef.current       = 0;
    setElapsed(0);
    gameStartedAtRef.current       = null;

    try {
      const { data: q, error: qErr } = await withTimeout(
        supabase
          .from('quests')
          .select('id,title,description,difficulty,level,phase,basexp,requiredxp,sortorder,isactive,question_type,objectives,hints,game_items,drop_zones,ordering_items,mc_questions,code_fill_items,tutorial_title,tutorial_body,tutorial_image,theory_sections')
          .eq('id', questId)
          .single()
      );
      if (qErr || !q) throw new Error(qErr?.message ?? 'Quest not found');
      const quest = q as unknown as Quest;
      setQuest(quest);

      // Look up the next active quest in the same phase by sortorder. Used by
      // the side-panel "Next Quest" button after completion. We don't fail the
      // whole page if this query errors — just fall back to "no next quest".
      try {
        const { data: nextRow } = await withTimeout(
          supabase
            .from('quests')
            .select('id')
            .eq('phase', quest.phase)
            .eq('mode', 'campaign')
            .eq('isactive', true)
            .gt('sortorder', quest.sortorder ?? 0)
            .order('sortorder', { ascending: true })
            .limit(1)
            .maybeSingle()
        );
        setNextQuestId(nextRow?.id ?? null);
      } catch (e) {
        console.warn('[LessonActivity] next-quest lookup failed', e);
        setNextQuestId(null);
      }

      // Fetch fixed phase XP cap and how much XP this user has already earned
      // in the phase, so capped levels award 0 XP.
      if (quest.phase) {
        try {
          const [phQRes, phPRes] = await Promise.all([
            withTimeout(supabase.from('quests').select('id').eq('phase', quest.phase).eq('mode', 'campaign').eq('isactive', true)),
            withTimeout(supabase.from('mission_progress').select('questid,xp_gained').eq('userid', user.id)),
          ]);
          const phaseIds = new Set((phQRes.data ?? []).map((r: any) => r.id));
          levelXpCapRef.current    = levelXpCapForPhase(quest.phase);
          levelXpEarnedRef.current = (phPRes.data ?? []).filter((r: any) => phaseIds.has(r.questid)).reduce((s: number, r: any) => s + (r.xp_gained ?? 0), 0);
        } catch (e) {
          console.warn('[LessonActivity] level XP cap fetch failed', e);
        }
      }

      // Pick the first available tab for this quest as the default.
      const tabs = computeAvailableTabs(quest);
      if (tabs.length > 0) setActiveTab(tabs[0]);

      // Load existing mission_progress (with first_completed_at).
      const { data: ex } = await withTimeout(
        supabase
          .from('mission_progress')
          .select('id,hintsused,status,xp_gained,completed_activities,first_completed_at')
          .eq('userid', user.id)
          .eq('questid', questId)
          .maybeSingle()
      );

      if (ex) {
        setProgressId(ex.id);
        setHintsUsed(ex.hintsused ?? 0);
        hintsUsedRef.current = ex.hintsused ?? 0;

        const done = (Array.isArray(ex.completed_activities) ? ex.completed_activities : []) as ActivityTab[];
        completedActivitiesRef.current = done;
        // If the quest was fully completed in the past, every available tab
        // is a retake even when completed_activities is currently partial
        // because the user reloaded mid-retake.
        everCompletedRef.current       = ex.first_completed_at ? tabs : done;
        // Lifetime row max — locked in by persistedXpGained() so retakes can
        // never push it below this value.
        priorXpGainedRef.current       = ex.xp_gained ?? 0;
        // first_completed_at is the durable "ever finished" stamp. If it's
        // set, this is a retake run — suppress the celebration on completion.
        hasEverFullyCompletedRef.current = !!ex.first_completed_at;
        if (ex.status === 'completed') {
          setIsCompleted(true);
          setEarnedXP(ex.xp_gained ?? quest.basexp ?? 0);
          setAppPhase('game');  // show LockedBanner inside the game area
        }
      } else {
        // Seed an empty progress row so subsequent UPDATEs find it.
        const { data: ins } = await withTimeout(
          supabase
            .from('mission_progress')
            .upsert({
              userid: user.id, questid: questId, status: 'active',
              attempts: 0, hintsused: 0, completed_activities: [],
              startedat: new Date().toISOString(),
            }, { onConflict: 'userid,questid' })
            .select('id')
            .single()
        );
        if (ins) setProgressId(ins.id);
        priorXpGainedRef.current         = 0;
        hasEverFullyCompletedRef.current = false;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load lesson';
      console.error('[LessonActivity] fetch error', err);
      setFetchError(msg);
    } finally {
      setLoading(false);
    }
  }, [user?.id, questId]);

  useEffect(() => { doFetch(); }, [doFetch]);

  // ── Realtime mission_progress sync (e.g. completion from another tab) ─
  useEffect(() => {
    if (!user?.id || !questId) return;
    const ch = supabase
      .channel(`lesson-${user.id}-${questId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'mission_progress',
        filter: `userid=eq.${user.id}`,
      }, payload => {
        if (payload.new?.questid !== questId) return;
        const newStatus = payload.new?.status;
        const acts     = Array.isArray(payload.new?.completed_activities)
          ? payload.new.completed_activities as ActivityTab[]
          : null;
        if (acts) completedActivitiesRef.current = acts;
        if (newStatus === 'completed' && !isCompleted) {
          setIsCompleted(true);
          setEarnedXP(payload.new?.xp_gained ?? quest?.basexp ?? 0);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id, questId, isCompleted, quest?.basexp]);

  // ── Derived: available tabs + hints scoped to current tab ─────────────
  const availableTabs = useMemo(() => computeAvailableTabs(quest), [quest]);

  const balloonQs = useMemo(() => {
    if (!quest?.mc_questions?.length) return [];
    const hasMode = quest.mc_questions.some(q => q.mode === 'balloon' || q.mode === 'mc');
    if (hasMode) return quest.mc_questions.filter(q => q.mode === 'balloon');
    return (quest.question_type ?? '').toLowerCase() === 'pop_balloon' ? quest.mc_questions : [];
  }, [quest?.mc_questions, quest?.question_type]);

  const mcQs = useMemo(() => {
    if (!quest?.mc_questions?.length) return [];
    const hasMode = quest.mc_questions.some(q => q.mode === 'balloon' || q.mode === 'mc');
    if (hasMode) return quest.mc_questions.filter(q => q.mode !== 'balloon');
    return (quest.question_type ?? '').toLowerCase() === 'pop_balloon' ? [] : quest.mc_questions;
  }, [quest?.mc_questions, quest?.question_type]);

  // Per-question hint for the active item (MC / balloon / code-fill only).
  // Ordering and DragDrop don't surface a current-item index — their hint
  // is always undefined so the side panel falls back to the per-tab pool.
  const currentItemHint = useMemo<string | undefined>(() => {
    if (!quest) return undefined;
    if (activeTab === 'mc')        return mcQs[currentItemIdx]?.hint ?? undefined;
    if (activeTab === 'balloon')   return balloonQs[currentItemIdx]?.hint ?? undefined;
    if (activeTab === 'code_fill') return quest.code_fill_items?.[currentItemIdx]?.hint ?? undefined;
    return undefined;
  }, [quest, activeTab, currentItemIdx, mcQs, balloonQs]);

  const tabHints = useMemo(
    () => composeHints(quest?.hints, activeTab, currentItemHint),
    [quest?.hints, activeTab, currentItemHint]
  );
  // Was: Math.max(tabHints.length, 1) — that floor let users click "Take a
  // hint" on a tab with zero hints, charging XP and revealing nothing. The
  // real cap is exactly the number of hints available for this tab.
  const maxHints = tabHints.length;

  // First-time vs repeat completion of this specific tab.
  const isRepeatTab = everCompletedRef.current.includes(activeTab);

  // Display XP for the side panel (best estimate of what'll be awarded next).
  const levelRemaining = Math.max(0, levelXpCapRef.current - levelXpEarnedRef.current);
  const displayXP = isCompleted
    ? earnedXP
    : isRepeatTab
      ? Math.min(RETAKE_COMPLETION_XP, levelRemaining)
      : Math.min(FIRST_COMPLETION_XP, levelRemaining);

  // ── Active item index reported by MC / Balloon / CodeFill games ─────────
  // Resets `hintsUsed` to 0 on every item transition so each question has
  // its own reveal budget. hintsUsedRef remains cumulative for analytics.
  const handleItemChange = useCallback((idx: number) => {
    setCurrentItemIdx(prev => {
      if (prev === idx) return prev;       // same item — no reset
      setHintsUsed(0);                     // collapse reveals for the new question
      return idx;
    });
  }, []);

  // ── Navigate to next quest (or back to phase page if this was the last) ─
  const handleNextQuest = useCallback(() => {
    if (nextQuestId) {
      navigate(`/lesson/${nextQuestId}`);
    } else {
      // Last quest in the phase — go back to the level overview.
      // Prefer the explicit phase route over navigate(-1) so direct-URL
      // arrivals don't get sent back to an unrelated page.
      const dest = quest?.phase ? `/campaign/inside/${quest.phase}` : '/campaign';
      navigate(dest);
    }
  }, [nextQuestId, quest?.phase, navigate]);

  // ── Take a hint ──────────────────────────────────────────────────────
  const handleTakeHint = useCallback(async () => {
    if (!user?.id || !quest || !progressId || isCompleted) return;
    if (hintsUsed >= maxHints) return;

    const nextPerQ        = hintsUsed + 1;
    const nextCumulative  = hintsUsedRef.current + 1;
    setHintsUsed(nextPerQ);
    hintsUsedRef.current = nextCumulative;

    // Best-effort persist of the cumulative count for analytics/progress UI.
    supabase
      .from('mission_progress')
      .update({ hintsused: nextCumulative })
      .eq('id', progressId)
      .then(({ error }) => { if (error) console.warn('hintsused update failed', error); });

    setHintToast({ visible: true });
    if (hintToastTimer.current) clearTimeout(hintToastTimer.current);
    hintToastTimer.current = setTimeout(() => setHintToast({ visible: false }), 3500);
  }, [user?.id, quest, progressId, isCompleted, hintsUsed, maxHints]);

  // ── Complete current activity ────────────────────────────────────────
  const handleComplete = useCallback(async (_score: number, _total: number) => {
    if (!user?.id || !quest) return;
    // Ignore re-completion of a tab already finished IN THIS SESSION.
    if (completedActivitiesRef.current.includes(activeTab)) return;

    const wasAlreadyDone = everCompletedRef.current.includes(activeTab);
    const newFinished    = [...new Set([...completedActivitiesRef.current, activeTab])] as ActivityTab[];
    completedActivitiesRef.current = newFinished;

    const allDone = availableTabs.every(t => newFinished.includes(t));
    // XP is only awarded on full quest completion. Use the durable
    // is-completed flag (`first_completed_at` loaded into this ref) to choose
    // 200 XP first-time vs 20 XP retake, then clamp by the fixed level cap.
    const xpGainedNow = computeActivityXP({
      isCompleted:    hasEverFullyCompletedRef.current,
      isFullCompletion: allDone,
      levelRemaining,
    });
    levelXpEarnedRef.current += xpGainedNow;

    // What we'll write to mission_progress.xp_gained. This row is the durable
    // cap-accounting source and must be monotonic.
    const xpRowValue     = persistedXpGained({
      levelCap:      levelXpCapRef.current,
      priorXpGained: priorXpGainedRef.current,
      xpDelta:       xpGainedNow,
    });

    // Snapshot the "is this the lifetime-first full completion" flag BEFORE
    // we later flip hasEverFullyCompletedRef. Drives celebration suppression
    // (level-up flash + activity log) on the XP toast far below.
    const isLifetimeFirstFinish = allDone && !hasEverFullyCompletedRef.current;
    // True only when this specific handleComplete call is what tips the quest
    // to fully done for the first time. isCompleted is the React state from
    // the previous render — still false here if we haven't called setIsCompleted yet.
    const isFirstFullFinish = allDone && !isCompleted;

    try {
      let rpcResult: any = null;
      const { data, error: rpcErr } = await supabase.rpc('complete_campaign_quest', {
        p_userid:               user.id,
        p_questid:              quest.id,
        p_xp_gained:            xpRowValue,
        p_xp_delta:             xpGainedNow,
        p_completed_activities: newFinished,
        p_hintsused:            hintsUsedRef.current,
        p_is_full_completion:   allDone,
      });

      if (rpcErr) {
        let firstCompletedAt: string | null = null;
        if (allDone) {
          const { data: existingProgress } = await supabase
            .from('mission_progress')
            .select('first_completed_at')
            .eq('userid', user.id)
            .eq('questid', quest.id)
            .maybeSingle();
          firstCompletedAt = existingProgress?.first_completed_at ?? new Date().toISOString();
        }
        const { error: fallbackProgressErr } = await supabase
          .from('mission_progress')
          .upsert({
            userid:               user.id,
            questid:              quest.id,
            status:               allDone ? 'completed' : 'active',
            xp_gained:            xpRowValue,
            completed_activities: newFinished,
            hintsused:            hintsUsedRef.current,
            completedat:          allDone ? firstCompletedAt : null,
            first_completed_at:   allDone ? firstCompletedAt : null,
            updatedat:            new Date().toISOString(),
          }, { onConflict: 'userid,questid' });
        if (fallbackProgressErr) throw new Error(fallbackProgressErr.message);

        const { data: userRow, error: userFetchErr } = await supabase
          .from('users')
          .select('totalxp')
          .eq('id', user.id)
          .single();
        if (userFetchErr) throw new Error(userFetchErr.message);
        const totalXP = (userRow?.totalxp ?? 0) + xpGainedNow;
        const { error: userUpdateErr } = await supabase
          .from('users')
          .update({
            totalxp: totalXP,
            currentlevel: calculateLevel(totalXP),
            lastactive: new Date().toISOString(),
          })
          .eq('id', user.id);
        if (userUpdateErr) throw new Error(userUpdateErr.message);

        rpcResult = { levelled_up: false };
      } else {
        rpcResult = data;
      }

      // Some RPC deployments return success but don't persist first_completed_at.
      // Campaign unlock logic depends on this field, so enforce it on full finish.
      if (allDone) {
        const { data: progressRow, error: progressFetchErr } = await supabase
          .from('mission_progress')
          .select('first_completed_at')
          .eq('userid', user.id)
          .eq('questid', quest.id)
          .maybeSingle();
        if (progressFetchErr) throw new Error(progressFetchErr.message);

        if (!progressRow?.first_completed_at) {
          const firstCompletedAt = new Date().toISOString();
          const { error: enforceCompletionErr } = await supabase
            .from('mission_progress')
            .update({
              status: 'completed',
              completedat: firstCompletedAt,
              first_completed_at: firstCompletedAt,
              updatedat: firstCompletedAt,
            })
            .eq('userid', user.id)
            .eq('questid', quest.id);
          if (enforceCompletionErr) throw new Error(enforceCompletionErr.message);
        }
      }

      const levelledUp = rpcResult?.levelled_up === true;
      const newLevel   = rpcResult?.new_level;

      if (allDone) {
        // RPC already set status='completed' and first_completed_at on first
        // full completion. Reflect locally.
        setIsCompleted(true);
        // Show the durable row value in the post-completion banner, not the
        // smaller retake event delta.
        setEarnedXP(xpRowValue);
        priorXpGainedRef.current = xpRowValue;
        // Add tabs that we just completed to the everCompleted list so the
        // post-retake UI knows what was historically done.
        everCompletedRef.current = [...new Set([...everCompletedRef.current, ...newFinished])];

        // Skip activity-feed spam and level-up flashes on retakes — the
        // first full completion is the milestone. We still mark the quest
        // completed locally; the retake just earns a small XP toast.
        if (!hasEverFullyCompletedRef.current) {
          // Fire-and-forget: write to activity_log for the activity feed.
          supabase.from('activity_log').insert({
            userid:      user.id,
            type:        'quest_completed',
            title:       `Quest completed: ${quest.title}`,
            description: hintsUsedRef.current > 0
              ? `${hintsUsedRef.current} hint${hintsUsedRef.current > 1 ? 's' : ''} used`
              : 'No hints used',
            xp_gained:   xpRowValue,
            meta:        { questid: quest.id, phase: quest.phase },
          }).then(({ error }) => { if (error) console.warn('activity_log write failed', error); });
        }
        // From this point on within the session, any further completions
        // (retakes triggered without leaving the page) are retake runs.
        hasEverFullyCompletedRef.current = true;

        // Fire-and-forget: record how long the user took to finish the quest.
        if (gameStartedAtRef.current !== null) {
          const totalSeconds = Math.round((Date.now() - gameStartedAtRef.current) / 1000);
          supabase
            .from('mission_progress')
            .update({ completion_time_seconds: totalSeconds })
            .eq('userid', user.id)
            .eq('questid', quest.id)
            .then(({ error }) => { if (error) console.warn('completion_time save failed', error); });
        }
      }

      // XP toast — only show when XP was actually earned.
      // Level-up flash is suppressed on retakes (isLifetimeFirstFinish=false)
      // so a small retake bonus that happens to cross a level threshold
      // doesn't re-trigger the celebration the user already saw.
      if (xpGainedNow > 0) {
        setXpToast({
          visible:  true,
          amount:   xpGainedNow,
          repeat:   wasAlreadyDone,
          levelUp:  levelledUp && isFirstFullFinish && isLifetimeFirstFinish,
          newLevel: levelledUp && isFirstFullFinish && isLifetimeFirstFinish ? newLevel : undefined,
        });
        if (xpToastTimer.current) clearTimeout(xpToastTimer.current);
        xpToastTimer.current = setTimeout(() => setXpToast(t => ({ ...t, visible: false })), 4500);
      }

    } catch (err) {
      // Roll back local state on failure.
      completedActivitiesRef.current = completedActivitiesRef.current.filter(g => g !== activeTab);
      levelXpEarnedRef.current       -= xpGainedNow;
      console.error('complete_campaign_quest failed', err);
      setFetchError(err instanceof Error ? err.message : 'Could not save your progress');
    }
  }, [user?.id, quest, activeTab, availableTabs, isCompleted, levelRemaining]);

  // ── Quest-level stopwatch ─────────────────────────────────────────────
  // Counts up from when the user first enters the game phase. Stops when
  // the quest is marked completed. The final value is saved to the DB and
  // surfaced on leaderboards and user profiles.
  useEffect(() => {
    if (appPhase !== 'game' || isCompleted) return;
    if (gameStartedAtRef.current === null) gameStartedAtRef.current = Date.now();
    const id = window.setInterval(() => {
      setElapsed(Math.round((Date.now() - gameStartedAtRef.current!) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [appPhase, isCompleted]);

  // ── Retake ───────────────────────────────────────────────────────────
  const handleRetake = useCallback(async () => {
    if (!user?.id || !quest) return;
    try {
      // IMPORTANT: do NOT reset xp_gained here. It is the durable amount of
      // campaign XP already credited for this quest and drives phase-cap
      // accounting across reloads. persistedXpGained() keeps it monotonic.
      // We also preserve first_completed_at so the campaign-gating UI
      // doesn't briefly think this quest is locked again mid-retake.
      const resetPayload = {
        status: 'active',
        completedat: null,
        completed_activities: [],
        hintsused: 0,
        updatedat: new Date().toISOString(),
      };

      // Do not rely on reset_quest_for_retake RPC: if the function is broken
      // (e.g. "control reached end of function without RETURN"), direct table
      // reset keeps retake working.
      const { error: resetErr } = await supabase
        .from('mission_progress')
        .update(resetPayload)
        .eq('userid', user.id)
        .eq('questid', quest.id);
      if (resetErr) throw new Error(resetErr.message);

      // Ensure a row exists for this quest after retake.
      const { error: upsertErr } = await supabase
        .from('mission_progress')
        .upsert({
          userid: user.id,
          questid: quest.id,
          ...resetPayload,
        }, { onConflict: 'userid,questid' });
      if (upsertErr) throw new Error(upsertErr.message);

      // Verify we really moved out of completed state.
      const { data: verifyRows, error: verifyErr } = await supabase
        .from('mission_progress')
        .select('status')
        .eq('userid', user.id)
        .eq('questid', quest.id)
        .limit(1);
      if (verifyErr) throw new Error(verifyErr.message);
      if (!verifyRows?.length || verifyRows[0].status !== 'active') {
        throw new Error('Retake reset did not persist status=active.');
      }
    } catch (err) {
      console.error('reset_quest_for_retake failed', err);
      setFetchError(err instanceof Error ? err.message : 'Could not reset for retake');
      return;
    }

    // Local reset. Note: everCompletedRef is preserved (used for replay-XP
    // detection). first_completed_at on the row is also preserved by the RPC,
    // so the next quest stays unlocked. priorXpGainedRef is also preserved —
    // it carries the lifetime row max forward so the next complete writes
    // max(prior, session) and never drops xp_gained below its lock.
    everCompletedRef.current         = [...completedActivitiesRef.current];
    completedActivitiesRef.current   = [];
    // The user just finished this quest at least once — every subsequent
    // completion in this session is a retake. Suppress the celebration.
    hasEverFullyCompletedRef.current = true;
    setIsCompleted(false);
    setHintsUsed(0);
    hintsUsedRef.current = 0;
    setElapsed(0);
    gameStartedAtRef.current = null;
    setResetSignal(s => s + 1);

    const tabs = computeAvailableTabs(quest);
    if (tabs.length > 0) setActiveTab(tabs[0]);
    setAppPhase('tutorial');
    // Do NOT call doFetch() here — it would overwrite everCompletedRef with the
    // DB's completed_activities (which was just cleared to []), destroying the
    // replay-XP context we set above. The quest data is already in state.
  }, [user?.id, quest]);

  const handleReset  = () => setResetSignal(s => s + 1);
  const handleGoBack = () => setAppPhase('tutorial');

  // ── Render ───────────────────────────────────────────────────────────
  if (loading) return <FullPageMessage>Loading lesson…</FullPageMessage>;
  if (fetchError && !quest) return (
    <FullPageMessage>
      <div style={{ color: '#f85149', marginBottom: 12 }}>⚠️ {fetchError}</div>
      <button onClick={() => navigate(-1)} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #30363d', background: 'transparent', color: '#8b949e', cursor: 'pointer' }}>← Go back</button>
    </FullPageMessage>
  );
  if (!quest) return <FullPageMessage>Lesson not found.</FullPageMessage>;

  const phaseLabel = quest.phase
    ? `${quest.phase[0].toUpperCase() + quest.phase.slice(1)} · Level ${quest.level ?? 1}`
    : `Level ${quest.level ?? 1}`;

  return (
    <div style={{ minHeight: '100vh', height: '100vh', display: 'flex', flexDirection: 'column', background: '#080c11', color: '#e6edf3', overflow: 'hidden' }}>
      <style>{ANIM_CSS}</style>

      {/* Header */}
      <header className="la-header" style={{ height: 56, background: 'rgba(13,17,23,0.97)', borderBottom: '1px solid #21262d', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <button
            onClick={() => navigate(-1)}
            title="Back to level"
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.25)',
              color: '#e6edf3',
              cursor: 'pointer',
              fontSize: 18,
              width: 38, height: 38,
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              transition: 'all .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.2)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.45)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)'; }}
          >←</button>
          <span className="la-phase-label" style={{ fontSize: 11, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1px', flexShrink: 0 }}>{phaseLabel}</span>
          <span className="la-phase-label" style={{ color: '#21262d', flexShrink: 0 }}>›</span>
          <span className="la-quest-title" style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 480 }}>{quest.title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {appPhase === 'game' && !isCompleted && availableTabs.length > 0 && (
            <button className="la-theory-btn" onClick={handleGoBack} style={{ background: 'transparent', border: '1px solid #30363d', color: '#8b949e', padding: '5px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace" }}>
              📖 <span className="la-btn-label">Theory</span>
            </button>
          )}
          {appPhase === 'game' && !isCompleted && (
            <button className="la-reset-btn" onClick={handleReset} style={{ background: 'transparent', border: '1px solid rgba(218,54,51,0.3)', color: '#f85149', padding: '5px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace" }}>
              ↺ <span className="la-btn-label">Reset</span>
            </button>
          )}
          {appPhase === 'game' && (
            <button
              className="la-mobile-hint-btn"
              onClick={() => setMobilePanelOpen(p => !p)}
              style={{ background: mobilePanelOpen ? 'rgba(88,166,255,0.15)' : 'transparent', border: `1px solid ${mobilePanelOpen ? 'rgba(88,166,255,0.4)' : '#30363d'}`, color: mobilePanelOpen ? '#58a6ff' : '#8b949e', padding: '5px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace", alignItems: 'center', gap: 4 }}
            >💡 Hints</button>
          )}
        </div>
      </header>

      {/* Body — overflowY:auto lets the layout scroll at high browser zoom
           instead of clipping the bottom action bar */}
      <div ref={bodyRef} className="la-body" style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {appPhase === 'tutorial' ? (
          <TutorialLearnPhase
            quest={quest}
            onStartGame={() => {
              if (isCompleted) return;
              setAppPhase('game');
            }}
          />
        ) : (
          <>
            {/* Left: tab bar + active game */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflowY: 'auto' }}>
              {!isCompleted && availableTabs.length > 1 && (
                <div className="la-tab-bar" style={{ display: 'flex', gap: 4, padding: '10px 22px 0', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
                  {availableTabs.map(t => {
                    const isDoneTab  = completedActivitiesRef.current.includes(t);
                    const isSelected = activeTab === t;
                    return (
                      <button key={t}
                        onClick={() => {
                          if (t === activeTab) return;
                          // Reset the per-question index + hint reveals so the
                          // side panel doesn't carry a stale "Q3" hint into a
                          // tab whose first item is index 0.
                          setActiveTab(t);
                          setCurrentItemIdx(0);
                          setHintsUsed(0);
                        }}
                        style={{
                          padding: '9px 14px', borderRadius: '8px 8px 0 0',
                          border: 'none', borderBottom: `2px solid ${isSelected ? '#facc15' : 'transparent'}`,
                          background: isSelected ? 'rgba(250,204,21,0.05)' : 'transparent',
                          color: isSelected ? '#facc15' : isDoneTab ? '#3fb950' : '#8b949e',
                          fontSize: 12, fontWeight: isSelected ? 700 : 500, cursor: 'pointer',
                          fontFamily: 'Inter,sans-serif',
                        }}>
                        {TAB_LABEL[t]}{isDoneTab && ' ✓'}
                      </button>
                    );
                  })}
                </div>
              )}

              {!isCompleted && (
                <div style={{ padding: '14px 22px 6px' }}>
                  <h3 style={{ fontSize: 14, fontWeight: 800, color: '#e6edf3', fontFamily: 'Inter,sans-serif' }}>{TAB_TITLE[activeTab]}</h3>
                  <p style={{ fontSize: 11, color: '#484f58', marginTop: 3, fontFamily: "'JetBrains Mono',monospace" }}>{TAB_SUBTITLE[activeTab]}</p>
                </div>
              )}

              {/* ── Stopwatch ── */}
              {!isCompleted && (
                <div style={{ padding: '0 22px 8px', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 7, border: '1px solid #21262d' }}>
                    <span style={{ fontSize: 11, flexShrink: 0 }}>⏱</span>
                    <span style={{ flex: 1, fontSize: 10, color: '#484f58', fontFamily: 'Inter,sans-serif' }}>Quest time</span>
                    <span style={{ fontSize: 12, minWidth: 48, textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", color: '#8b949e', fontWeight: 600 }}>
                      {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
                    </span>
                  </div>
                </div>
              )}

              <div className="la-game-area" style={{ flex: 1, padding: !isCompleted && activeTab === 'balloon' ? 0 : '16px 22px', display: 'flex', flexDirection: 'column', overflowY: 'auto', minHeight: 0 }}>
                {isCompleted ? (
                  <LockedBanner
                    earnedXP={earnedXP}
                    title={quest.title}
                    onRetake={handleRetake}
                    onBack={() => {
                      const dest = quest.phase ? `/campaign/inside/${quest.phase}` : '/campaign';
                      navigate(dest);
                    }}
                  />
                ) : completedActivitiesRef.current.includes(activeTab) ? (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
                    <div style={{ fontSize: 42 }}>✅</div>
                    <div style={{ fontSize: 14, color: '#3fb950', fontWeight: 700, fontFamily: 'Inter,sans-serif' }}>
                      {TAB_LABEL[activeTab]} done!
                    </div>
                    <div style={{ fontSize: 12, color: '#8b949e', fontFamily: 'Inter,sans-serif' }}>Pick another tab above to continue.</div>
                  </div>
                ) : (
                  <>
                    {activeTab === 'drag'      && <DragDropGame   items={quest.game_items ?? []} zones={quest.drop_zones ?? []} onComplete={handleComplete} resetSignal={resetSignal} />}
                    {activeTab === 'code_fill' && <CodeFillGame   items={quest.code_fill_items ?? []} onComplete={handleComplete} resetSignal={resetSignal} onItemChange={handleItemChange} />}
                    {activeTab === 'balloon'   && <BalloonPopGame questions={balloonQs} onComplete={handleComplete} resetSignal={resetSignal} onItemChange={handleItemChange} />}
                    {activeTab === 'ordering'  && <OrderingGame   items={quest.ordering_items ?? []} onComplete={handleComplete} resetSignal={resetSignal} />}
                    {activeTab === 'mc'        && <MCGame         questions={mcQs} onComplete={handleComplete} resetSignal={resetSignal} onItemChange={handleItemChange} />}
                  </>
                )}
              </div>
            </div>

            {/* Drag handle: thin column-resizer between the game pane and the
                side panel. Highlights on hover and while dragging. Double-click
                to reset to the default width. */}
            <div
              className="la-resize-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize hint panel"
              title="Drag to resize · Double-click to reset"
              onMouseDown={onResizeStart}
              onDoubleClick={resetSidePanelWidth}
              style={{
                width: 6, flexShrink: 0, cursor: 'col-resize',
                background: isSideResizing ? 'rgba(88,166,255,0.45)' : 'transparent',
                borderLeft: '1px solid #21262d',
                transition: isSideResizing ? 'none' : 'background 0.15s',
              }}
              onMouseEnter={e => { if (!isSideResizing) e.currentTarget.style.background = 'rgba(88,166,255,0.18)'; }}
              onMouseLeave={e => { if (!isSideResizing) e.currentTarget.style.background = 'transparent'; }}
            />

            {/* Mobile overlay — tap outside the side panel to close it */}
            {mobilePanelOpen && (
              <div
                onClick={() => setMobilePanelOpen(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 199, background: 'rgba(0,0,0,0.72)' }}
                className="la-mobile-overlay"
              />
            )}

            {/* Right: side panel — width is user-resizable, persisted to localStorage. */}
            <div className={`la-side-panel${mobilePanelOpen ? ' open' : ''}`} style={{ width: sidePanelWidth, flexShrink: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <GameSidePanel
                quest={quest}
                tabHints={tabHints}
                hintsUsed={hintsUsed}
                maxHints={maxHints}
                earnedXP={displayXP}
                isCompleted={isCompleted}
                onTakeHint={handleTakeHint}
                activeTab={activeTab}
                hasNextQuest={!!nextQuestId}
                onNextQuest={handleNextQuest}
              />
            </div>
          </>
        )}
      </div>

      {/* Toasts */}
      <XPToast
        visible={xpToast.visible}
        xpGained={xpToast.amount}
        isRepeat={xpToast.repeat}
        questTitle={quest.title}
        levelledUp={xpToast.levelUp}
        newLevel={xpToast.newLevel}
      />
      <HintToast visible={hintToast.visible} hintsUsed={hintsUsed} />
    </div>
  );
};

const FullPageMessage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#080c11', color: '#8b949e', fontSize: 14, fontFamily: 'Inter,sans-serif', flexDirection: 'column', gap: 12 }}>
    {children}
  </div>
);

const ANIM_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap');
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #21262d; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: #30363d; }

  .la-mobile-hint-btn { display: none !important; }
  .la-mobile-overlay  { display: none !important; }

  @media (max-width: 768px) {
    .la-mobile-hint-btn { display: flex !important; }
    .la-mobile-overlay  { display: block !important; }
    .la-resize-handle   { display: none !important; }
    .la-header { padding: 0 14px !important; }
    .la-phase-label { display: none !important; }
    .la-quest-title { max-width: 140px !important; font-size: 12px !important; }
    .la-btn-label { display: none !important; }
    .la-theory-btn { padding: 6px 8px !important; font-size: 14px !important; }
    .la-reset-btn  { padding: 6px 8px !important; font-size: 14px !important; }
    .la-tab-bar  { padding: 10px 14px 0 !important; }
    .la-game-area { padding: 12px 14px !important; }
    .la-side-panel {
      position: fixed !important;
      right: 0 !important; top: 56px !important; bottom: 0 !important;
      width: 92vw !important; max-width: 400px !important; z-index: 200;
      box-shadow: -6px 0 32px rgba(0,0,0,0.8) !important;
      transform: translateX(100%);
      transition: transform 0.28s cubic-bezier(0.4,0,0.2,1);
      overflow-y: auto;
    }
    .la-side-panel.open {
      transform: translateX(0) !important;
    }
    .la-body {
      overflow-y: auto !important;
      overflow-x: hidden !important;
    }
  }
`;

export default LessonActivity;
