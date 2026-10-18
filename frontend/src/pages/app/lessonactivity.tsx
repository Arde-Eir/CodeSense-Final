// Campaign RPCs own progress and XP updates; first_completed_at keeps later quests unlocked during retakes.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/components/AuthContext';
import { supabase } from '@/services/supabase';

import { DragDropGame  } from '@/games/DragDropGame';
import { CodeFillGame  } from '@/games/CodeFillGame';
import { OrderingGame  } from '@/games/OrderingGame';
import { MCGame        } from '@/games/MCGame';
import { BalloonPopGame } from '@/games/BalloonPopGame';

import TheorySectionBlock from '@/components/TheorySection';
import { TheoryProse } from '@/components/TheoryProse';
import type { ActivityTab, Quest, TheorySection } from '@/types/campaign';
import { isCampaignPhase, levelForPhase, phaseForLevel } from '@/types/campaign';
import { composeHints, type ItemHintInput } from '@/campaign/composeHints';
import { generateAutoHints } from '@/campaign/generateAutoHints';
import {
  computeActivityXP, computeHintPenalty, persistedXpGained, requireXpAmount,
  RETAKE_COMPLETION_XP, HINT_XP_COST, HINT_PENALTY_CAP_RATIO,
} from '@/campaign/retakeXp';
import { readLevelXpCap } from '@/services/campaignXpSettings';
import { LessonNavigation } from './LessonNavigation';
import { GameSidePanel } from './GameSidePanel';
import { MobileQuestHints } from './MobileQuestHints';

const FETCH_TIMEOUT_MS   = 10_000;

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

/** Show populated activities with the designated question_type first. */
function computeAvailableTabs(quest: Quest | null): ActivityTab[] {
  if (!quest) return [];
  const qt = (quest.question_type ?? '').trim().toLowerCase();
  const isBalloon = qt === 'pop_balloon';
  const isMC =
    qt === 'multiple_choice' || qt === 'multiple-choice' ||
    qt === 'mc' || qt === 'mcq' || qt === 'quiz';

  let primary: ActivityTab | null = null;
  if      (qt === 'drag_drop')   primary = 'drag';
  else if (qt === 'code_fill')   primary = 'code_fill';
  else if (qt === 'ordering')    primary = 'ordering';
  else if (qt === 'pop_balloon') primary = 'balloon';
  else if (isMC)                 primary = 'mc';

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

  if (primary && all.includes(primary)) {
    return [primary, ...all.filter(t => t !== primary)];
  }
  return all;
}

function withTimeout<T>(thenable: PromiseLike<T>, ms = FETCH_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    Promise.resolve(thenable),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

const XPToast: React.FC<{
  visible:    boolean;
  xpGained:   number;
  isRepeat:   boolean;
  questTitle: string;
  levelledUp: boolean;
  newLevel?:  number;
}> = ({ visible, xpGained, isRepeat, questTitle, levelledUp, newLevel }) => (
  <div className="la-toast" style={{
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

const HintToast: React.FC<{ visible: boolean; hintsUsed: number }> = ({ visible, hintsUsed }) => (
  <div className="la-toast" style={{
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
      Campaign reward is reduced by {HINT_XP_COST} XP per hint, up to {Math.round(HINT_PENALTY_CAP_RATIO * 100)}%.
    </div>
  </div>
);

const LockedBanner: React.FC<{
  earnedXP: number; title: string; onRetake: () => void; onBack: () => void;
}> = ({ earnedXP, title, onRetake, onBack }) => (
  <div className="la-completion" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 32, textAlign: 'center' }}>
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
    <div className="la-completion-actions" style={{ display: 'flex', gap: 12 }}>
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

const TutorialLearnPhase: React.FC<{ quest: Quest; onStartGame: () => void }> = ({ quest, onStartGame }) => {
  const sections: TheorySection[] = Array.isArray(quest.theory_sections) ? quest.theory_sections : [];
  return (
    <div className="la-reading-phase" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, minHeight: 0 }}>
      <div className="la-reading-scroll" style={{ flex: 1, overflowY: 'auto', padding: '22px 28px' }}>
        <article className="lesson-reading" data-testid="lesson-theory">
          <header className="lesson-reading-header">
            <div className="lesson-reading-eyebrow">Learn before you play</div>
            <h2>{quest.tutorial_title || quest.title}</h2>
            {quest.tutorial_body && <TheoryProse text={quest.tutorial_body} />}
            {sections.length > 1 && (
              <nav className="lesson-contents" aria-label="Lesson sections">
                {sections.map((sec, index) => sec.heading && <a key={index} href={`#lesson-section-${index}`} data-testid={`lesson-section-link-${index}`}>{sec.heading}</a>)}
              </nav>
            )}
          </header>
          {sections.map((sec, index) => <section key={index} id={`lesson-section-${index}`} data-testid={`lesson-section-${index}`}><TheorySectionBlock sec={sec} /></section>)}
        </article>
      </div>
      <div className="la-reading-actions" style={{ padding: '14px 28px', borderTop: '1px solid #21262d', flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onStartGame} style={{ padding: '12px 32px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#238636,#196127)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'Inter,sans-serif', boxShadow: '0 4px 18px rgba(35,134,54,0.35)' }}>
          Start Activity 🎮
        </button>
      </div>
    </div>
  );
};

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

  useEffect(() => {
    if (isResizing) return;
    try { window.localStorage.setItem(SIDE_STORAGE, String(width)); } catch {/* ignore quota */}
  }, [width, isResizing]);

  const resetWidth = useCallback(() => setWidth(SIDE_DEFAULT), []);

  return { width, isResizing, onResizeStart, resetWidth };
}

export const LessonActivity: React.FC = () => {
  const navigate = useNavigate();
  const { questId } = useParams<{ questId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const shouldStartFreshRetake = searchParams.get('retake') === '1';

  const [quest,       setQuest]       = useState<Quest | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [fetchError,  setFetchError]  = useState<string | null>(null);
  const [savingProgress, setSavingProgress] = useState(false);
  const [failedCompletion, setFailedCompletion] = useState<{ activity: ActivityTab; score: number; total: number } | null>(null);

  const [appPhase,     setAppPhase]     = useState<'tutorial' | 'game'>('tutorial');
  const [activeTab,    setActiveTab]    = useState<ActivityTab>('drag');
  const [resetSignal,  setResetSignal]  = useState(0);

  // `hintsUsed` is the UI counter (which reveal cards are open). Resets to 0
  // when the player moves to a new question — see handleItemChange.
  const [hintsUsed,           setHintsUsed]           = useState(0);
  const [isCompleted,  setIsCompleted]  = useState(false);
  const [earnedXP,     setEarnedXP]     = useState(0);
  const [completedActivities, setCompletedActivities] = useState<ActivityTab[]>([]);
  // Current item index inside the active tab (0 = first question / item).
  // Reported up by MCGame / BalloonPopGame / CodeFillGame via onItemChange.
  // Ordering and DragDrop report the current puzzle index.
  const [currentItemIdx, setCurrentItemIdx] = useState(0);

  const [nextQuestId, setNextQuestId] = useState<string | null | undefined>(undefined);
  const [previousQuest, setPreviousQuest] = useState<Pick<Quest, 'id' | 'title'> | null>(null);

  const [xpToast, setXpToast] = useState({ visible: false, amount: 0, repeat: false, levelUp: false, newLevel: undefined as number | undefined });
  const [hintToast, setHintToast] = useState({ visible: false });

  const [elapsed,        setElapsed]        = useState(0);
  const gameStartedAtRef = useRef<number | null>(null);

  // Refs for values used inside async callbacks (avoid stale closures).
  const completedActivitiesRef = useRef<ActivityTab[]>([]);
  const completionPendingRef = useRef(false);
  const loadEpochRef = useRef(0);
  const everCompletedRef       = useRef<ActivityTab[]>([]);
  const hintsUsedRef           = useRef(0);
  // mission_progress.xp_gained as it stood when this quest was loaded. Used
  // to keep the row monotonic and prevent reloads from reopening phase-cap
  // headroom.
  const priorXpGainedRef       = useRef(0);
  const hasEverFullyCompletedRef = useRef(false);
  const levelXpCapRef          = useRef(0);
  const levelXpEarnedRef       = useRef(0);
  const xpToastTimer           = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintToastTimer         = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncCompletedActivities = useCallback((activities: ActivityTab[]) => {
    const uniqueActivities = [...new Set(activities)] as ActivityTab[];
    completedActivitiesRef.current = uniqueActivities;
    setCompletedActivities(uniqueActivities);
  }, []);

  const bodyRef = useRef<HTMLDivElement>(null);
  const lessonRef = useRef<HTMLDivElement>(null);
  const {
    width: sidePanelWidth,
    isResizing: isSideResizing,
    onResizeStart,
    resetWidth: resetSidePanelWidth,
  } = useResizableSidePanel(bodyRef);

  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const mobileHintsButtonRef = useRef<HTMLButtonElement>(null);
  const closeMobilePanel = useCallback((): void => setMobilePanelOpen(false), []);

  const doFetch = useCallback(async () => {
    if (!user?.id || !questId) return;
    const loadEpoch = ++loadEpochRef.current;
    completionPendingRef.current = false;
    setSavingProgress(false);
    setFailedCompletion(null);
    setLoading(true); setFetchError(null);

    // Route changes reuse this component, so reset progress and hints for each quest.
    setQuest(null);
    setIsCompleted(false);
    setEarnedXP(0);
    setHintsUsed(0);
    setNextQuestId(undefined);
    setPreviousQuest(null);
    setMobilePanelOpen(false);
    setAppPhase('tutorial');
    syncCompletedActivities([]);
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
          .select('id,title,description,difficulty,level,phase,mode,basexp,requiredxp,sortorder,isactive,question_type,objectives,hints,game_items,drop_zones,ordering_items,mc_questions,code_fill_items,tutorial_title,tutorial_body,tutorial_image,theory_sections')
          .eq('id', questId)
          .single()
      );
      if (loadEpoch !== loadEpochRef.current) return;
      if (qErr || !q) throw new Error(qErr?.message ?? 'Quest not found');
      const quest = q as unknown as Quest;
      if (quest.mode !== 'campaign' || !quest.isactive || !isCampaignPhase(quest.phase)) {
        throw new Error('This lesson is not an active Campaign quest.');
      }
      requireXpAmount(quest.basexp, `XP Reward for quest ${quest.id}`);

      const { data: phaseQuests, error: phaseError } = await withTimeout(
        supabase
          .from('quests')
          .select('id,title,sortorder,isactive')
          .eq('phase', quest.phase)
          .eq('mode', 'campaign')
          .order('sortorder', { ascending: true })
          .order('id', { ascending: true })
      );
      if (loadEpoch !== loadEpochRef.current) return;
      if (phaseError) throw new Error(`Could not load Campaign quest order: ${phaseError.message}`);
      if (!phaseQuests) throw new Error('The Campaign quest order query returned no data.');
      const activeQuests = phaseQuests.filter(row => row.isactive);
      const questIndex = activeQuests.findIndex(row => row.id === quest.id);
      if (questIndex < 0) throw new Error('This Campaign quest is no longer available.');
      let previousQuest: Pick<Quest, 'id' | 'title'> | null = activeQuests[questIndex - 1] ?? null;

      const phaseIds = phaseQuests.map(row => row.id);
      const { data: phaseProgress, error: phaseProgressError } = await withTimeout(
        supabase
          .from('mission_progress')
          .select('questid,hintsused,status,xp_gained,completed_activities,first_completed_at')
          .eq('userid', user.id)
          .in('questid', phaseIds)
      );
      if (loadEpoch !== loadEpochRef.current) return;
      if (phaseProgressError) throw new Error(`Could not load Campaign progress: ${phaseProgressError.message}`);
      if (!phaseProgress) throw new Error('The Campaign progress query returned no data.');
      const progressByQuest = new Map(phaseProgress.map(row => [row.questid, row]));
      if (activeQuests.slice(0, questIndex).some(row => !progressByQuest.get(row.id)?.first_completed_at)) {
        throw new Error('Finish the earlier quests in this level before opening this lesson.');
      }

      const level = levelForPhase(quest.phase);
      if (level > 1) {
        const previousPhase = phaseForLevel(level - 1);
        const { data: previousQuests, error: previousError } = await withTimeout(
          supabase
            .from('quests')
            .select('id,title')
            .eq('phase', previousPhase)
            .eq('mode', 'campaign')
            .eq('isactive', true)
            .order('sortorder', { ascending: false })
            .order('id', { ascending: false })
        );
        if (loadEpoch !== loadEpochRef.current) return;
        if (previousError) throw new Error(`Could not check the previous level: ${previousError.message}`);
        if (!previousQuests?.length) throw new Error('The previous Campaign level has no active quests.');
        const { data: previousProgress, error: previousProgressError } = await withTimeout(
          supabase
            .from('mission_progress')
            .select('questid,first_completed_at')
            .eq('userid', user.id)
            .in('questid', previousQuests.map(row => row.id))
        );
        if (loadEpoch !== loadEpochRef.current) return;
        if (previousProgressError) throw new Error(`Could not check previous-level progress: ${previousProgressError.message}`);
        if (!previousProgress) throw new Error('The previous-level progress query returned no data.');
        const finishedPrevious = new Set(previousProgress
          .filter(row => row.first_completed_at)
          .map(row => row.questid));
        if (previousQuests.some(row => !finishedPrevious.has(row.id))) {
          throw new Error('Finish the previous Campaign level before opening this lesson.');
        }
        if (questIndex === 0) previousQuest = previousQuests[0];
      }

      if (previousQuest && (typeof previousQuest.id !== 'string' || !previousQuest.id ||
        typeof previousQuest.title !== 'string' || !previousQuest.title.trim())) {
        throw new TypeError(`The previous Campaign quest for ${quest.id} has an invalid id or title.`);
      }
      setPreviousQuest(previousQuest ? { id: previousQuest.id, title: previousQuest.title } : null);

      const levelXpCap = await withTimeout(readLevelXpCap(quest.phase));
      if (loadEpoch !== loadEpochRef.current) return;
      levelXpCapRef.current = levelXpCap;
      levelXpEarnedRef.current = phaseProgress.reduce((sum, row) => sum + (row.xp_gained ?? 0), 0);
      setNextQuestId(activeQuests[questIndex + 1]?.id ?? null);

      const tabs = computeAvailableTabs(quest);
      if (tabs.length > 0) setActiveTab(tabs[0]);

      const ex = progressByQuest.get(quest.id);

      if (ex) {
        // `hintsused` from the DB is cumulative for XP/leaderboard accounting.
        // The visible hint cards are per activity/question and must stay hidden
        // until the player pays for one with the bottom hint button.
        setHintsUsed(0);
        hintsUsedRef.current = ex.hintsused ?? 0;

        let done = (Array.isArray(ex.completed_activities) ? ex.completed_activities : []) as ActivityTab[];
        let loadedStatus = ex.status;
        if (shouldStartFreshRetake && ex.first_completed_at) {
          const { error: retakeResetErr } = await supabase.rpc('reset_quest_for_retake', {
            p_userid: user.id,
            p_questid: quest.id,
          });
          if (loadEpoch !== loadEpochRef.current) return;
          if (retakeResetErr) throw new Error(`Failed to start retake for quest ${questId}: ${retakeResetErr.message}`);
          done = [];
          loadedStatus = 'active';
          hintsUsedRef.current = 0;
          setSearchParams({}, { replace: true });
        }
        syncCompletedActivities(done);
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
        if (loadedStatus === 'completed') {
          setIsCompleted(true);
          setEarnedXP(ex.xp_gained ?? quest.basexp ?? 0);
          setAppPhase('game');
        }
      }
      setQuest(quest);
    } catch (err) {
      if (loadEpoch !== loadEpochRef.current) return;
      const msg = err instanceof Error ? err.message : 'Failed to load lesson';
      console.error('[LessonActivity] fetch error', err);
      setFetchError(msg);
    } finally {
      if (loadEpoch === loadEpochRef.current) setLoading(false);
    }
  }, [user?.id, questId, shouldStartFreshRetake, setSearchParams, syncCompletedActivities]);

  useEffect(() => { doFetch(); }, [doFetch]);

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
        if (acts) syncCompletedActivities([...completedActivitiesRef.current, ...acts]);
        if (newStatus === 'completed' && !isCompleted) {
          setIsCompleted(true);
          setEarnedXP(payload.new?.xp_gained ?? quest?.basexp ?? 0);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id, questId, isCompleted, quest?.basexp, syncCompletedActivities]);

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

  // Authored question hints are combined with hints scoped to the current puzzle.
  const currentItemHint = useMemo<ItemHintInput>(() => {
    if (!quest) return undefined;
    if (activeTab === 'mc')        return mcQs[currentItemIdx]?.hint ?? undefined;
    if (activeTab === 'balloon')   return balloonQs[currentItemIdx]?.hint ?? undefined;
    if (activeTab === 'code_fill') return quest.code_fill_items?.[currentItemIdx]?.hint ?? undefined;
    return undefined;
  }, [quest, activeTab, currentItemIdx, mcQs, balloonQs]);

  const authoredHints = useMemo(
    () => composeHints(quest?.hints, activeTab, currentItemHint, currentItemIdx),
    [quest?.hints, activeTab, currentItemHint, currentItemIdx]
  );
  const tabHints = useMemo(
    () => authoredHints.length > 0
      ? authoredHints
      : generateAutoHints(quest, activeTab, currentItemIdx),
    [authoredHints, quest, activeTab, currentItemIdx]
  );

  useEffect(() => {
    setCurrentItemIdx(0);
    setHintsUsed(0);
  }, [activeTab, quest?.id]);
  // The reveal limit equals the available hints to avoid charging for an empty reveal.
  const maxHints = tabHints.length;

  const isRepeatTab = everCompletedRef.current.includes(activeTab);

  const levelRemaining = Math.max(0, levelXpCapRef.current - levelXpEarnedRef.current);
  const displayXP = isCompleted
    ? earnedXP
    : isRepeatTab
      ? computeActivityXP({
          baseXp: quest?.basexp ?? 0,
          isCompleted: true,
          isFullCompletion: true,
          levelRemaining,
          hintsUsed: hintsUsedRef.current,
        })
      : computeActivityXP({
          baseXp: quest?.basexp ?? 0,
          isCompleted: false,
          isFullCompletion: true,
          levelRemaining,
          hintsUsed: hintsUsedRef.current,
        });
  const rewardDetails = computeHintPenalty({
    baseXp: quest?.basexp ?? 0,
    isCompleted: isRepeatTab,
    hintsUsed: hintsUsedRef.current,
  });

  // Resets `hintsUsed` to 0 on every item transition so each question has
  // its own reveal budget. hintsUsedRef remains cumulative for analytics.
  const handleItemChange = useCallback((idx: number) => {
    setCurrentItemIdx(prev => {
      if (prev === idx) return prev;
      setHintsUsed(0);
      return idx;
    });
  }, []);

  const handleNextQuest = useCallback(() => {
    if (nextQuestId) {
      navigate(`/lesson/${nextQuestId}`);
    } else {
      // Use the phase route so direct lesson links return to the level overview.
      const dest = quest?.phase ? `/campaign/inside/${quest.phase}` : '/campaign';
      navigate(dest);
    }
  }, [nextQuestId, quest?.phase, navigate]);

  const handleTakeHint = useCallback(() => {
    if (!user?.id || !quest || isCompleted) return;
    if (hintsUsed >= maxHints) return;

    const nextPerQ        = hintsUsed + 1;
    const nextCumulative  = hintsUsedRef.current + 1;
    setHintsUsed(nextPerQ);
    hintsUsedRef.current = nextCumulative;

    setHintToast({ visible: true });
    if (hintToastTimer.current) clearTimeout(hintToastTimer.current);
    hintToastTimer.current = setTimeout(() => setHintToast({ visible: false }), 3500);
  }, [user?.id, quest, isCompleted, hintsUsed, maxHints]);

  const saveActivityCompletion = useCallback(async (activity: ActivityTab, score: number, total: number) => {
    if (!user?.id || !quest) return;
    if (total < 1 || score !== total || completionPendingRef.current) return;
    if (completedActivitiesRef.current.includes(activity)) {
      setFailedCompletion(null);
      setFetchError(null);
      return;
    }
    completionPendingRef.current = true;
    setSavingProgress(true);
    const loadEpoch = loadEpochRef.current;
    setFetchError(null);

    const wasAlreadyDone = everCompletedRef.current.includes(activity);
    const newFinished    = [...new Set([...completedActivitiesRef.current, activity])] as ActivityTab[];

    const allDone = availableTabs.every(t => newFinished.includes(t));
    // XP is only awarded on full quest completion. Use the durable
    // is-completed flag (`first_completed_at` loaded into this ref) to choose
    // saved quest reward vs 20 XP retake, then clamp by the saved level cap.
    const xpGainedNow = computeActivityXP({
      baseXp: quest.basexp,
      isCompleted:    hasEverFullyCompletedRef.current,
      isFullCompletion: allDone,
      levelRemaining,
      hintsUsed: hintsUsedRef.current,
    });

    // Persisted xp_gained must stay monotonic for level-cap accounting.
    const xpRowValue     = persistedXpGained({
      levelCap:      levelXpCapRef.current,
      priorXpGained: priorXpGainedRef.current,
      xpDelta:       xpGainedNow,
    });

    const isLifetimeFirstFinish = allDone && !hasEverFullyCompletedRef.current;
    // This flag records a first completion before the React state update.
    const isFirstFullFinish = allDone && !isCompleted;

    try {
      let completionTimeSeconds: number | null = null;
      if (allDone) {
        const startedAt = gameStartedAtRef.current;
        if (startedAt === null) throw new Error('The quest timer has not started. Reopen the lesson before completing it.');
        completionTimeSeconds = Math.round((Date.now() - startedAt) / 1000);
      }
      const { data: rpcResult, error: rpcErr } = await supabase.rpc('complete_campaign_quest', {
        p_userid:               user.id,
        p_questid:              quest.id,
        p_xp_gained:            xpRowValue,
        p_xp_delta:             xpGainedNow,
        p_completed_activities: newFinished,
        p_hintsused:            hintsUsedRef.current,
        p_is_full_completion:   allDone,
        p_completion_time_seconds: completionTimeSeconds,
      });
      if (loadEpoch !== loadEpochRef.current) return;
      if (rpcErr) throw new Error(`Could not save Campaign quest ${quest.id}, activity ${activity} (${rpcErr.code}): ${rpcErr.message}. ${rpcErr.details} ${rpcErr.hint}`.trim());
      setFailedCompletion(null);
      syncCompletedActivities([...completedActivitiesRef.current, ...newFinished]);
      levelXpEarnedRef.current += xpGainedNow;

      const levelledUp = rpcResult?.levelled_up === true;
      const newLevel   = rpcResult?.new_level;

      if (allDone) {
        setIsCompleted(true);
        if (completionTimeSeconds !== null) setElapsed(completionTimeSeconds);
        // Show the durable row value in the post-completion banner, not the
        // smaller retake event delta.
        setEarnedXP(xpRowValue);
        priorXpGainedRef.current = xpRowValue;
        everCompletedRef.current = [...new Set([...everCompletedRef.current, ...newFinished])];

        hasEverFullyCompletedRef.current = true;

      }

      // Celebrate level changes only on the first lifetime completion.
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
      if (loadEpoch !== loadEpochRef.current) return;
      console.error('Campaign progress save failed', { questId: quest.id, activity, score, total, error: err });
      setFetchError(err instanceof Error ? err.message : 'Could not save your progress');
      setFailedCompletion({ activity, score, total });
    } finally {
      if (loadEpoch === loadEpochRef.current) {
        completionPendingRef.current = false;
        setSavingProgress(false);
      }
    }
  }, [user?.id, quest, availableTabs, isCompleted, levelRemaining, syncCompletedActivities]);

  const handleComplete = useCallback((score: number, total: number) => {
    void saveActivityCompletion(activeTab, score, total);
  }, [activeTab, saveActivityCompletion]);

  useEffect(() => {
    if (appPhase !== 'game' || isCompleted) return;
    if (gameStartedAtRef.current === null) gameStartedAtRef.current = Date.now();
    const id = window.setInterval(() => {
      setElapsed(Math.round((Date.now() - gameStartedAtRef.current!) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [appPhase, isCompleted]);

  const handleRetake = useCallback(async () => {
    if (!user?.id || !quest) return;
    setFetchError(null);
    try {
      const { error: resetErr } = await supabase.rpc('reset_quest_for_retake', {
        p_userid: user.id,
        p_questid: quest.id,
      });
      if (resetErr) throw new Error(`Could not reset Campaign quest ${quest.id}: ${resetErr.message}`);

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

    // The RPC preserves first_completed_at and previously credited XP.
    everCompletedRef.current         = [...completedActivitiesRef.current];
    syncCompletedActivities([]);
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
    // Refetching would replace the retained retake history with the cleared activity list.
  }, [user?.id, quest, syncCompletedActivities]);

  const handleReset = () => {
    setFailedCompletion(null);
    setFetchError(null);
    setResetSignal(s => s + 1);
  };
  const handleGoBack = () => setAppPhase('tutorial');

  if (loading) return <FullPageMessage>Loading lesson…</FullPageMessage>;
  if (fetchError && !quest) return (
    <FullPageMessage>
      <div style={{ color: '#f85149', marginBottom: 12 }}>⚠️ {fetchError}</div>
      <button onClick={() => navigate(-1)} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #30363d', background: 'transparent', color: '#8b949e', cursor: 'pointer' }}>← Go back</button>
    </FullPageMessage>
  );
  if (!quest) return <FullPageMessage>Lesson not found.</FullPageMessage>;

  const helpPanel = (
    <GameSidePanel
      quest={quest}
      tabHints={tabHints}
      hintsUsed={hintsUsed}
      totalHintsUsed={hintsUsedRef.current}
      maxHints={maxHints}
      earnedXP={displayXP}
      rewardBaseXP={rewardDetails.baseReward}
      rewardPenaltyXP={rewardDetails.penalty}
      rewardPenaltyCapped={rewardDetails.capped}
      isCompleted={isCompleted}
      onTakeHint={handleTakeHint}
      activeTab={activeTab}
      hasNextQuest={!!nextQuestId}
      onNextQuest={handleNextQuest}
    />
  );
  const phaseLabel = quest.phase
    ? `${quest.phase[0].toUpperCase() + quest.phase.slice(1)} · Level ${quest.level ?? 1}`
    : `Level ${quest.level ?? 1}`;

  return (
    <div ref={lessonRef} className="la-root" style={{ display: 'flex', flexDirection: 'column', background: '#080c11', color: '#e6edf3', overflow: 'hidden' }}>
      <style>{ANIM_CSS}</style>

      <header className="la-header" style={{ height: 56, background: 'rgba(13,17,23,0.97)', borderBottom: '1px solid #21262d', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', flexShrink: 0 }}>
        <div className="la-header-context" style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <LessonNavigation key={quest.id} phase={quest.phase!} previousQuest={previousQuest} savingProgress={savingProgress} />
          <span className="la-phase-label" style={{ fontSize: 11, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1px', flexShrink: 0 }}>{phaseLabel}</span>
          <span className="la-phase-label" style={{ color: '#21262d', flexShrink: 0 }}>›</span>
          <span className="la-quest-title" style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 480 }}>{quest.title}</span>
        </div>
        <div className="la-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {appPhase === 'game' && !isCompleted && availableTabs.length > 0 && (
            <button type="button" className="la-theory-btn" aria-label="Read lesson theory" onClick={handleGoBack} style={{ background: 'transparent', border: '1px solid #30363d', color: '#8b949e', padding: '5px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace" }}>
              📖 <span className="la-btn-label">Theory</span>
            </button>
          )}
          {appPhase === 'game' && !isCompleted && (
            <button type="button" className="la-reset-btn" aria-label="Reset current activity" onClick={handleReset} disabled={savingProgress} style={{ background: 'transparent', border: '1px solid rgba(218,54,51,0.3)', color: '#f85149', padding: '5px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace" }}>
              ↺ <span className="la-btn-label">Reset</span>
            </button>
          )}
          {appPhase === 'game' && (
            <button
              ref={mobileHintsButtonRef}
              type="button"
              className="la-mobile-hint-btn"
              data-testid="mobile-hints-toggle"
              aria-expanded={mobilePanelOpen}
              aria-controls="campaign-hints-panel"
              onClick={() => setMobilePanelOpen(p => !p)}
              style={{ background: mobilePanelOpen ? 'rgba(88,166,255,0.15)' : 'transparent', border: `1px solid ${mobilePanelOpen ? 'rgba(88,166,255,0.4)' : '#30363d'}`, color: mobilePanelOpen ? '#58a6ff' : '#8b949e', padding: '5px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace", alignItems: 'center', gap: 4 }}
            >💡 Hints</button>
          )}
        </div>
      </header>

      {fetchError && (
        <div role="alert" style={{ padding: '10px 24px', background: 'rgba(248,81,73,0.12)', borderBottom: '1px solid rgba(248,81,73,0.35)', color: '#ffaba8', fontSize: 12 }}>
          Could not save or load Campaign progress: {fetchError}
          {failedCompletion ? (
            <button data-testid="retry-activity-save" disabled={savingProgress} onClick={() => void saveActivityCompletion(failedCompletion.activity, failedCompletion.score, failedCompletion.total)} style={{ marginLeft: 12, border: '1px solid currentColor', borderRadius: 5, background: 'transparent', color: 'inherit', cursor: 'pointer', padding: '3px 8px' }}>Retry saving progress</button>
          ) : (
            <button onClick={doFetch} style={{ marginLeft: 12, border: '1px solid currentColor', borderRadius: 5, background: 'transparent', color: 'inherit', cursor: 'pointer', padding: '3px 8px' }}>Reload progress</button>
          )}
        </div>
      )}

      {/* Vertical scrolling keeps the action bar accessible at high zoom. */}
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
            <div className="la-activity-column" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
              {!isCompleted && availableTabs.length > 1 && (
                <div className="la-tab-bar" style={{ display: 'flex', gap: 4, padding: '10px 22px 0', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
                  {availableTabs.map(t => {
                    const isDoneTab  = completedActivities.includes(t);
                    const isSelected = activeTab === t;
                    return (
                      <button key={t} data-testid={`activity-tab-${t}`} aria-pressed={isSelected}
                        disabled={savingProgress || failedCompletion !== null}
                        onClick={() => {
                          if (t === activeTab) return;
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

              <div className={`la-game-area${!isCompleted && activeTab === 'balloon' ? ' la-balloon-area' : ''}`} style={{ flex: 1, padding: !isCompleted && activeTab === 'balloon' ? 0 : '16px 22px', display: 'flex', flexDirection: 'column', overflowY: 'auto', minHeight: 0 }}>
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
                ) : completedActivities.includes(activeTab) ? (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
                    <div style={{ fontSize: 42 }}>✅</div>
                    <div style={{ fontSize: 14, color: '#3fb950', fontWeight: 700, fontFamily: 'Inter,sans-serif' }}>
                      {TAB_LABEL[activeTab]} done!
                    </div>
                    <div style={{ fontSize: 12, color: '#8b949e', fontFamily: 'Inter,sans-serif' }}>Pick another tab above to continue.</div>
                  </div>
                ) : (
                  <>
                    {activeTab === 'drag'      && <DragDropGame   items={quest.game_items ?? []} zones={quest.drop_zones ?? []} onComplete={handleComplete} resetSignal={resetSignal} onItemChange={handleItemChange} />}
                    {activeTab === 'code_fill' && <CodeFillGame   items={quest.code_fill_items ?? []} onComplete={handleComplete} resetSignal={resetSignal} onItemChange={handleItemChange} />}
                    {activeTab === 'balloon'   && <BalloonPopGame questions={balloonQs} onComplete={handleComplete} resetSignal={resetSignal} onItemChange={handleItemChange} />}
                    {activeTab === 'ordering'  && <OrderingGame   items={quest.ordering_items ?? []} onComplete={handleComplete} resetSignal={resetSignal} onItemChange={handleItemChange} />}
                    {activeTab === 'mc'        && <MCGame         questions={mcQs} onComplete={handleComplete} resetSignal={resetSignal} onItemChange={handleItemChange} />}
                  </>
                )}
              </div>
            </div>

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

            <div className="la-side-panel" style={{ width: sidePanelWidth, flexShrink: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {helpPanel}
            </div>
            {mobilePanelOpen && <MobileQuestHints backgroundRef={lessonRef} triggerRef={mobileHintsButtonRef} onClose={closeMobilePanel}>{helpPanel}</MobileQuestHints>}
          </>
        )}
      </div>

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
  <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#080c11', color: '#8b949e', fontSize: 14, fontFamily: 'Inter,sans-serif', flexDirection: 'column', gap: 12 }}>
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
  .la-root { min-height: 100dvh; height: 100dvh; }
  .la-header { position: relative; z-index: 100; }
  .la-tab-bar { overflow-x: auto; }
  .la-tab-bar > button { flex-shrink: 0; }
  .la-side-scroll { overscroll-behavior: contain; scrollbar-gutter: stable; scrollbar-width: thin; scrollbar-color: #6e7681 #161b22; }
  .la-side-scroll::-webkit-scrollbar { width: 8px; }
  .la-side-scroll::-webkit-scrollbar-track { background: #161b22; }
  .la-side-scroll::-webkit-scrollbar-thumb { background: #6e7681; border-radius: 4px; }
  .la-side-scroll:focus-visible { outline: 2px solid #58a6ff; outline-offset: -2px; }

  @media (max-width: 1024px) {
    .la-root { height: auto; overflow: visible !important; }
    .la-mobile-hint-btn { display: flex !important; }
    .la-resize-handle   { display: none !important; }
    .la-side-panel { display: none !important; }
    .la-header { position: sticky; top: 0; height: auto !important; min-height: 56px; padding: calc(8px + env(safe-area-inset-top)) 12px 8px !important; flex-wrap: wrap; gap: 8px; }
    .la-header-context { flex: 1 1 100%; }
    .la-header-actions { flex: 1 1 100%; display: grid !important; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .la-header-actions > button { justify-content: center; width: 100%; }
    .la-phase-label { display: none !important; }
    .la-quest-title { min-width: 0; max-width: none !important; white-space: normal !important; overflow-wrap: anywhere; font-size: 14px !important; line-height: 1.4; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .la-root button { min-height: 44px; touch-action: manipulation; }
    .la-root input { min-height: 44px; font-size: 16px !important; }
    .la-theory-btn { padding: 6px 8px !important; font-size: 14px !important; }
    .la-reset-btn  { padding: 6px 8px !important; font-size: 14px !important; }
    .la-body, .la-reading-phase, .la-reading-scroll, .la-activity-column, .la-game-area { flex: none !important; overflow: visible !important; min-width: 0; }
    .la-body { display: block !important; }
    .la-tab-bar  { padding: 8px 12px 0 !important; overscroll-behavior-x: contain; }
    .la-tab-bar > button { flex: 0 0 auto; white-space: nowrap; font-size: 14px !important; }
    .la-game-area { padding: 12px 14px !important; overflow-wrap: anywhere; }
    .la-balloon-area { padding: 0 !important; }
    .la-reading-scroll { padding: 16px 14px !important; min-width: 0; }
    .la-reading-actions { padding: 12px 14px calc(12px + env(safe-area-inset-bottom)) !important; }
    .la-reading-actions > button { width: 100%; }
    .la-completion { padding: 20px 0 !important; }
    .la-completion-actions { flex-direction: column; width: 100%; }
    .la-completion-actions > button { width: 100%; }
    .la-toast { min-width: 0 !important; max-width: calc(100vw - 24px); }
  }
`;

export default LessonActivity;
