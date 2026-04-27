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

// ─── Constants ────────────────────────────────────────────────────────────
const XP_PER_HINT        = 2;
const REPEAT_XP_FRACTION = 0.10;
const REPEAT_XP_MIN      = 1;
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

/** Compute which tabs this quest actually has data for. The user must finish
 *  all of these for the quest to be marked completed. */
function computeAvailableTabs(quest: Quest | null): ActivityTab[] {
  if (!quest) return [];
  const out: ActivityTab[] = [];
  const normalizedType = String(quest.question_type ?? '').trim().toLowerCase();
  const isMC =
    normalizedType === 'multiple_choice' ||
    normalizedType === 'multiple-choice' ||
    normalizedType === 'mc' ||
    normalizedType === 'mcq' ||
    normalizedType === 'quiz';
  if (quest.game_items?.length && quest.drop_zones?.length) out.push('drag');
  if (quest.code_fill_items?.length)                         out.push('code_fill');
  if (quest.ordering_items?.length)                          out.push('ordering');
  if (quest.mc_questions?.length) {
    if (isMC) out.push('mc');
    else                                            out.push('balloon');
  }
  return out;
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
const HintToast: React.FC<{ visible: boolean; hintsUsed: number; xpCost: number }> = ({ visible, hintsUsed, xpCost }) => (
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
    <div style={{ fontSize: 13, fontWeight: 700, color: '#f85149', marginBottom: 3, fontFamily: 'Inter,sans-serif' }}>
      −{xpCost} XP deducted
    </div>
    <div style={{ fontSize: 12, color: '#8b949e', fontFamily: 'Inter,sans-serif' }}>
      Hints reduce your final XP reward.
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
      Replaying gives a small bonus only.
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
  hintsUsed:       number;
  maxHints:        number;
  earnedXP:        number;
  isCompleted:     boolean;
  onTakeHint:      () => void;
  activeTab:       ActivityTab;
}> = ({ quest, hintsUsed, maxHints, earnedXP, isCompleted, onTakeHint, activeTab }) => {
  const [activeHint, setActiveHint] = useState<number | null>(null);
  const tabHints = (quest.hints ?? []).filter(h => !h.activity || h.activity === activeTab);
  const allHintsUsed = hintsUsed >= maxHints;
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
            Take a hint below to unlock guidance.
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
        <button onClick={onTakeHint} disabled={allHintsUsed || isCompleted} style={{
          width: '100%', padding: '9px 10px', borderRadius: 9, border: 'none',
          background: allHintsUsed || isCompleted ? 'rgba(72,79,88,0.2)' : 'linear-gradient(135deg,#06b6d4,#0891b2)',
          color: allHintsUsed || isCompleted ? '#484f58' : '#000',
          fontWeight: 700, fontSize: 11,
          cursor: allHintsUsed || isCompleted ? 'not-allowed' : 'pointer',
          fontFamily: 'Inter,sans-serif',
          boxShadow: allHintsUsed || isCompleted ? 'none' : '0 4px 14px rgba(6,182,212,.35)',
          transition: 'all .15s',
        }}>
          {allHintsUsed ? 'No more hints' : `TAKE A HINT (${maxHints - hintsUsed} left)`}
        </button>
      </div>
    </div>
  );
};

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
  const [hintsUsed,    setHintsUsed]    = useState(0);
  const [isCompleted,  setIsCompleted]  = useState(false);
  const [earnedXP,     setEarnedXP]     = useState(0);

  const [xpToast, setXpToast] = useState({ visible: false, amount: 0, repeat: false, levelUp: false, newLevel: undefined as number | undefined });
  const [hintToast, setHintToast] = useState({ visible: false });

  // Refs for values used inside async callbacks (avoid stale closures).
  const completedActivitiesRef = useRef<ActivityTab[]>([]);
  const everCompletedRef       = useRef<ActivityTab[]>([]);  // tabs completed in any prior session
  const cumulativeXPRef        = useRef(0);
  const hintsUsedRef           = useRef(0);
  const xpToastTimer           = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintToastTimer         = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load quest + this user's mission_progress row ─────────────────────
  const doFetch = useCallback(async () => {
    if (!user?.id || !questId) return;
    setLoading(true); setFetchError(null);
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
        everCompletedRef.current       = done;
        cumulativeXPRef.current        = ex.xp_gained ?? 0;

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
        cumulativeXPRef.current = 0;
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
  const tabHints = useMemo(
    () => (quest?.hints ?? []).filter(h => !h.activity || h.activity === activeTab),
    [quest?.hints, activeTab]
  );
  const maxHints = Math.max(tabHints.length, 1);

  // First-time vs repeat completion of this specific tab.
  const isRepeatTab = everCompletedRef.current.includes(activeTab);

  // Display XP for the side panel (best estimate of what'll be awarded next).
  const baseXP = quest?.basexp ?? 0;
  const displayXP = isCompleted
    ? earnedXP
    : isRepeatTab
      ? Math.max(REPEAT_XP_MIN, Math.round(baseXP * REPEAT_XP_FRACTION))
      : Math.max(1, baseXP - hintsUsed * XP_PER_HINT);

  // ── Take a hint ──────────────────────────────────────────────────────
  const handleTakeHint = useCallback(async () => {
    if (!user?.id || !quest || !progressId || isCompleted) return;
    if (hintsUsed >= maxHints) return;

    const next = hintsUsed + 1;
    setHintsUsed(next);
    hintsUsedRef.current = next;

    // Best-effort persist (we don't block on it — toast is instant).
    supabase
      .from('mission_progress')
      .update({ hintsused: next })
      .eq('id', progressId)
      .then(({ error }) => { if (error) console.warn('hintsused update failed', error); });

    setHintToast({ visible: true });
    if (hintToastTimer.current) clearTimeout(hintToastTimer.current);
    hintToastTimer.current = setTimeout(() => setHintToast({ visible: false }), 3500);
  }, [user?.id, quest, progressId, isCompleted, hintsUsed, maxHints]);

  // ── Complete current activity ────────────────────────────────────────
  const handleComplete = useCallback(async (score: number, total: number) => {
    if (!user?.id || !quest) return;
    // Ignore re-completion of a tab already finished IN THIS SESSION.
    if (completedActivitiesRef.current.includes(activeTab)) return;

    const wasAlreadyDone = everCompletedRef.current.includes(activeTab);
    const newFinished    = [...new Set([...completedActivitiesRef.current, activeTab])] as ActivityTab[];
    completedActivitiesRef.current = newFinished;

    // XP for this event.
    let xpGainedNow: number;
    if (wasAlreadyDone) {
      xpGainedNow = Math.max(REPEAT_XP_MIN, Math.round(quest.basexp * REPEAT_XP_FRACTION));
    } else {
      const xpPerTab    = Math.floor(quest.basexp / Math.max(availableTabs.length, 1));
      const ratio       = total > 0 ? score / total : 1;
      const hintPenalty = Math.round(hintsUsedRef.current * XP_PER_HINT / Math.max(availableTabs.length, 1));
      xpGainedNow       = Math.max(1, Math.round(xpPerTab * ratio) - hintPenalty);
    }
    cumulativeXPRef.current += xpGainedNow;

    const allDone           = availableTabs.every(t => newFinished.includes(t));
    const isFirstFullFinish = allDone && !isCompleted && !everCompletedRef.current.length;

    try {
      let rpcResult: any = null;
      const { data, error: rpcErr } = await supabase.rpc('complete_campaign_quest', {
        p_userid:               user.id,
        p_questid:              quest.id,
        p_xp_gained:            cumulativeXPRef.current,
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
            xp_gained:            cumulativeXPRef.current,
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
        setEarnedXP(cumulativeXPRef.current);
        // Add tabs that we just completed to the everCompleted list so the
        // post-retake UI knows what was historically done.
        everCompletedRef.current = [...new Set([...everCompletedRef.current, ...newFinished])];
      }

      // XP toast
      setXpToast({
        visible:  true,
        amount:   xpGainedNow,
        repeat:   wasAlreadyDone,
        levelUp:  levelledUp && isFirstFullFinish,
        newLevel: levelledUp && isFirstFullFinish ? newLevel : undefined,
      });
      if (xpToastTimer.current) clearTimeout(xpToastTimer.current);
      xpToastTimer.current = setTimeout(() => setXpToast(t => ({ ...t, visible: false })), 4500);

    } catch (err) {
      // Roll back local state on failure.
      completedActivitiesRef.current = completedActivitiesRef.current.filter(g => g !== activeTab);
      cumulativeXPRef.current        -= xpGainedNow;
      console.error('complete_campaign_quest failed', err);
      setFetchError(err instanceof Error ? err.message : 'Could not save your progress');
    }
  }, [user?.id, quest, activeTab, availableTabs, isCompleted]);

  // ── Retake ───────────────────────────────────────────────────────────
  const handleRetake = useCallback(async () => {
    if (!user?.id || !quest) return;
    try {
      const resetPayload = {
        status: 'active',
        completedat: null,
        completed_activities: [],
        xp_gained: 0,
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
    // so the next quest stays unlocked.
    everCompletedRef.current       = [...completedActivitiesRef.current];
    completedActivitiesRef.current = [];
    cumulativeXPRef.current        = 0;
    setIsCompleted(false);
    setHintsUsed(0);
    hintsUsedRef.current = 0;
    setResetSignal(s => s + 1);

    const tabs = computeAvailableTabs(quest);
    if (tabs.length > 0) setActiveTab(tabs[0]);
    setAppPhase('tutorial');

    // Re-sync from DB so UI state can't get stuck on stale completed status.
    await doFetch();
  }, [user?.id, quest, doFetch]);

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
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#080c11', color: '#e6edf3', overflow: 'hidden' }}>
      <style>{ANIM_CSS}</style>

      {/* Header */}
      <header style={{ height: 56, background: 'rgba(13,17,23,0.97)', borderBottom: '1px solid #21262d', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => navigate(-1)} style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 14 }}>←</button>
          <span style={{ fontSize: 11, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1px' }}>{phaseLabel}</span>
          <span style={{ color: '#21262d' }}>›</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 480 }}>{quest.title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {appPhase === 'game' && !isCompleted && availableTabs.length > 0 && (
            <button onClick={handleGoBack} style={{ background: 'transparent', border: '1px solid #30363d', color: '#8b949e', padding: '5px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace" }}>📖 Theory</button>
          )}
          {appPhase === 'game' && !isCompleted && (
            <button onClick={handleReset} style={{ background: 'transparent', border: '1px solid rgba(218,54,51,0.3)', color: '#f85149', padding: '5px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace" }}>↺ Reset</button>
          )}
        </div>
      </header>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
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
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              {!isCompleted && availableTabs.length > 1 && (
                <div style={{ display: 'flex', gap: 4, padding: '10px 22px 0', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
                  {availableTabs.map(t => {
                    const isDoneTab  = completedActivitiesRef.current.includes(t);
                    const isSelected = activeTab === t;
                    return (
                      <button key={t}
                        onClick={() => setActiveTab(t)}
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

              <div style={{ flex: 1, padding: !isCompleted && activeTab === 'balloon' ? 0 : '16px 22px', display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                {isCompleted ? (
                  <LockedBanner
                    earnedXP={earnedXP}
                    title={quest.title}
                    onRetake={handleRetake}
                    onBack={() => navigate(-1)}
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
                    {activeTab === 'code_fill' && <CodeFillGame   items={quest.code_fill_items ?? []} onComplete={handleComplete} resetSignal={resetSignal} />}
                    {activeTab === 'balloon'   && <BalloonPopGame questions={quest.mc_questions ?? []} onComplete={handleComplete} resetSignal={resetSignal} />}
                    {activeTab === 'ordering'  && <OrderingGame   items={quest.ordering_items ?? []} onComplete={handleComplete} resetSignal={resetSignal} />}
                    {activeTab === 'mc'        && <MCGame         questions={quest.mc_questions ?? []} onComplete={handleComplete} resetSignal={resetSignal} />}
                  </>
                )}
              </div>
            </div>

            {/* Right: side panel */}
            <div style={{ width: 280, flexShrink: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <GameSidePanel
                quest={quest}
                hintsUsed={hintsUsed}
                maxHints={maxHints}
                earnedXP={displayXP}
                isCompleted={isCompleted}
                onTakeHint={handleTakeHint}
                activeTab={activeTab}
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
      <HintToast visible={hintToast.visible} hintsUsed={hintsUsed} xpCost={XP_PER_HINT} />
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
`;

export default LessonActivity;
