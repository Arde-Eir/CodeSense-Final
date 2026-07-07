// frontend/src/CampaignInside.tsx
// Per-level dashboard. One screen handles all three phases (beginner /
// intermediate / advanced) — replaces the old per-level dashboards.
//
// Gating model (linear, exploit-proof):
//   • A quest is `completed` when mission_progress.status === 'completed'.
//   • A quest is `active` when the previous quest in sortorder has been
//     finished at least once (mission_progress.first_completed_at IS NOT NULL).
//   • Otherwise `locked`.
//
// `first_completed_at` survives retakes (RPC uses COALESCE, trigger blocks
// NULLing — see migration_mission_progress_v2.sql), so retaking never closes
// the gate on later quests.
//
// Replay XP cannot grind unlocks because gating is decoupled from XP — only
// real "first finish" timestamps move the gate.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/components/AuthContext';
import { supabase } from '@/services/supabase';
import type {
  Phase, Quest, MissionProgress, QuestRow,
  LevelInfo, LevelStats,
} from '@/types/campaign';
import { defaultLevelInfoForPhase, isCampaignPhase, levelForPhase, phaseForLevel } from '@/types/campaign';
import { buildQuests } from '@/campaign/buildQuests';
import { FIRST_COMPLETION_XP, RETAKE_COMPLETION_XP, levelXpCapForPhase } from '@/campaign/retakeXp';

// ─── Visual constants ──────────────────────────────────────────────────────
const ACTIVITY_ICON: Record<string, string> = {
  drag_drop:       '🃏',
  code_fill:       '💻',
  ordering:        '🔢',
  multiple_choice: '🧠',
  pop_balloon:     '🎈',
};

const ACTIVITY_LABEL: Record<string, string> = {
  drag_drop:       'Drag & Drop',
  code_fill:       'Code Fill',
  ordering:        'Ordering',
  multiple_choice: 'Quiz',
  pop_balloon:     'Balloon Pop',
};

const ACTIVITY_DESC: Record<string, string> = {
  drag_drop:       'Match terms to definitions',
  code_fill:       'Fill in the missing code',
  ordering:        'Arrange steps in sequence',
  multiple_choice: 'Pick the right answer',
  pop_balloon:     'Pop the correct balloon',
};

const questTypeLabel = (t: string | null): string =>
  (t && ACTIVITY_LABEL[t]) ?? 'Lesson';

const isMultipleChoiceType = (t: string | null | undefined): boolean => {
  const n = String(t ?? '').trim().toLowerCase();
  return n === 'multiple_choice' || n === 'multiple-choice' || n === 'mc' || n === 'mcq' || n === 'quiz';
};

const activityTypesForQuest = (q: QuestRow): string[] => {
  const types: string[] = [];
  if (q.game_items?.length && q.drop_zones?.length) types.push('drag_drop');
  if (q.code_fill_items?.length)                    types.push('code_fill');
  if (q.ordering_items?.length)                     types.push('ordering');
  if (q.mc_questions?.length) {
    const hasMode = q.mc_questions.some(item => item.mode === 'balloon' || item.mode === 'mc');
    if (hasMode) {
      if (q.mc_questions.some(item => item.mode === 'balloon')) types.push('pop_balloon');
      if (q.mc_questions.some(item => item.mode !== 'balloon'))  types.push('multiple_choice');
    } else {
      types.push(isMultipleChoiceType(q.question_type) ? 'multiple_choice' : 'pop_balloon');
    }
  }
  return types;
};

const lessonPathForQuest = (quest: QuestRow): string => `/lesson/${quest.id}`;

// ─── Small UI bits ─────────────────────────────────────────────────────────
const StatBar: React.FC<{
  icon: string; label: string; current: number; total: number; color: string; maxed?: boolean;
}> = ({ icon, label, current, total, color, maxed }) => {
  const pct = total > 0 ? Math.min((current / total) * 100, 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0' }}>
      <span style={{ fontSize: 18, flexShrink: 0, width: 24, textAlign: 'center' }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
          <span style={{ fontSize: 11, color: '#c9d1d9', fontWeight: 600, fontFamily: "'Syne', sans-serif" }}>{label}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {maxed && (
              <span style={{ fontSize: 9, fontWeight: 800, color: '#e3b341', background: 'rgba(227,179,65,0.15)', border: '1px solid rgba(227,179,65,0.4)', borderRadius: 4, padding: '1px 5px', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '0.5px' }}>MAX</span>
            )}
            <span style={{ fontSize: 11, color, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace" }}>{current}/{total}</span>
          </div>
        </div>
        <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: maxed ? 'linear-gradient(90deg,#e3b341,#facc15)' : `linear-gradient(90deg,${color}cc,${color})`, borderRadius: 3, transition: 'width 0.9s cubic-bezier(0.4,0,0.2,1)' }} />
        </div>
      </div>
    </div>
  );
};

const SubTopicItem: React.FC<{ title: string; isDone: boolean }> = ({ title, isDone }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
    borderBottom: '1px solid rgba(255,255,255,0.03)',
  }}>
    <div style={{
      width: 16, height: 16, borderRadius: 4,
      border: `1.5px solid ${isDone ? '#3fb950' : '#484f58'}`,
      background: isDone ? '#3fb95033' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10,
    }}>
      {isDone && '✓'}
    </div>
    <span style={{ fontSize: 11, color: isDone ? '#8b949e' : '#e6edf3', fontFamily: "'Inter', sans-serif" }}>
      {title}
    </span>
  </div>
);

// ─── Quest card ────────────────────────────────────────────────────────────
const QuestCard: React.FC<{
  quest: QuestRow; index: number; onClick: () => void;
}> = ({ quest, index, onClick }) => {
  const [isOpen, setIsOpen] = useState(false);
  const isDone   = quest.uiStatus === 'completed';
  const isLocked = quest.uiStatus === 'locked';
  const isActive = quest.uiStatus === 'active';
  const accent   = isDone ? '#3fb950' : isActive ? '#e3b341' : '#484f58';

  const subTopics: string[] = (() => {
    if (quest.objectives && quest.objectives.length > 0) return quest.objectives;
    if (quest.description) return [quest.description];
    return ['Foundational concepts covered in this lesson'];
  })();

  const cta = isDone
    ? 'Review / Retake'
    : quest.everCompleted
      ? `Resume Quest +${RETAKE_COMPLETION_XP} XP`
      : `Start Quest +${FIRST_COMPLETION_XP} XP`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 12, opacity: isLocked ? 0.5 : 1 }}>
      <div
        onClick={() => !isLocked && setIsOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 14, padding: '15px 20px',
          background: 'rgba(255,255,255,0.02)',
          borderTop:    `1.5px solid ${isOpen ? `${accent}66` : 'rgba(255,255,255,0.06)'}`,
          borderRight:  `1.5px solid ${isOpen ? `${accent}66` : 'rgba(255,255,255,0.06)'}`,
          borderBottom: `1.5px solid ${isOpen ? `${accent}66` : 'rgba(255,255,255,0.06)'}`,
          borderLeft:   `4px solid ${accent}`,
          borderRadius: isOpen ? '12px 12px 0 0' : 12,
          cursor: isLocked ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
        }}
      >
        <div style={{ width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.2)', border: `1px solid ${accent}`, color: accent, fontWeight: 800, fontSize: 12 }}>
          {isLocked ? '🔒' : isDone ? '✓' : String(index + 1).padStart(2, '0')}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{quest.title}</div>
          <div style={{ fontSize: 10, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>
            {quest.everCompleted ? RETAKE_COMPLETION_XP : FIRST_COMPLETION_XP} XP · {questTypeLabel(quest.question_type)}
            {quest.everCompleted && !isDone && <span style={{ color: '#3fb950', marginLeft: 8 }}>· FIRST FINISH ✓</span>}
          </div>
        </div>
        <div style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: '0.3s', opacity: 0.5 }}>▼</div>
      </div>

      {isOpen && !isLocked && (
        <div style={{ padding: 20, background: 'rgba(13,17,23,0.6)', border: '1.5px solid rgba(255,255,255,0.06)', borderTop: 'none', borderRadius: '0 0 12px 12px' }}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#484f58', textTransform: 'uppercase', marginBottom: 10, letterSpacing: '1px' }}>Topics covered</div>
            {subTopics.map((topic, i) => (
              <SubTopicItem key={i} title={topic} isDone={isDone} />
            ))}
          </div>
          <button
            onClick={onClick}
            style={{ width: '100%', padding: 12, borderRadius: 8, background: accent, color: '#080c11', fontWeight: 900, fontSize: 12, cursor: 'pointer', border: 'none', boxShadow: `0 4px 12px ${accent}33` }}
          >
            {cta}
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Sidebar panels ───────────────────────────────────────────────────────
const ProgressPanel: React.FC<{ stats: LevelStats; phase: string }> = ({ stats, phase }) => {
  const xpMaxed = stats.xpTotal > 0 && stats.xpEarned >= stats.xpTotal;
  return (
    <div style={{ background: 'rgba(255,255,255,.02)', border: '1.5px solid rgba(255,255,255,.06)', borderRadius: 13, padding: '18px 16px', animation: 'questIn .5s ease .15s both' }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: '#484f58', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 14, fontFamily: "'JetBrains Mono',monospace" }}>
        Your Progress
        <span style={{ marginLeft: 8, display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#3fb950', boxShadow: '0 0 6px #3fb950', verticalAlign: 'middle' }} title="Live" />
      </div>
      <StatBar icon="🎒" label="Lessons Done" current={stats.finished} total={stats.total}   color="#58a6ff" />
      <div style={{ height: 1, background: 'rgba(255,255,255,.04)', margin: '3px 0' }} />
      <StatBar icon="⚡" label="XP Earned"    current={stats.xpEarned} total={stats.xpTotal} color="#e3b341" maxed={xpMaxed} />
      <div style={{ height: 1, background: 'rgba(255,255,255,.04)', margin: '3px 0' }} />
      <StatBar icon="🔥" label="Streak"       current={stats.streak}   total={stats.total}   color="#f0883e" />
      {xpMaxed && (
        <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(227,179,65,0.08)', border: '1px solid rgba(227,179,65,0.3)', fontSize: 11, color: '#e3b341', fontFamily: "'Syne',sans-serif", textAlign: 'center', lineHeight: 1.5 }}>
          ⚡ Level XP maxed!{phase !== 'advanced' ? ' Advance to the next level to earn more.' : ' You\'ve mastered all levels!'}
        </div>
      )}
    </div>
  );
};

const ActivityTypesPanel: React.FC<{ quests: QuestRow[] }> = ({ quests }) => {
  const counts: Record<string, number> = {};
  const bump = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };
  for (const q of quests) activityTypesForQuest(q).forEach(bump);
  const ORDER = ['drag_drop', 'code_fill', 'ordering', 'pop_balloon', 'multiple_choice'];
  const present = ORDER.filter(t => counts[t]);

  return (
    <div style={{ background: 'rgba(255,255,255,.02)', border: '1.5px solid rgba(255,255,255,.06)', borderRadius: 13, padding: '14px 16px', animation: 'questIn .5s ease .22s both' }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: '#484f58', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 12, fontFamily: "'JetBrains Mono',monospace" }}>Activity Types</div>
      {present.length === 0
        ? <div style={{ fontSize: 11, color: '#484f58', fontFamily: 'Inter,sans-serif' }}>No activities yet.</div>
        : present.map(t => (
          <div key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginBottom: 9 }}>
            <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{ACTIVITY_ICON[t] ?? '🎮'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 11, color: '#c9d1d9', fontWeight: 600, fontFamily: "'Syne',sans-serif" }}>{ACTIVITY_LABEL[t] ?? t}</span>
                <span style={{ fontSize: 9, color: '#484f58', fontFamily: "'JetBrains Mono',monospace" }}>×{counts[t]}</span>
              </div>
              <div style={{ fontSize: 10, color: '#484f58', fontFamily: "'Syne',sans-serif" }}>{ACTIVITY_DESC[t] ?? ''}</div>
            </div>
          </div>
        ))
      }
    </div>
  );
};

const QuestMixRow: React.FC<{ icon: string; label: string; value: string | number }> = ({ icon, label, value }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
    <span style={{ fontSize: 13, width: 18, textAlign: 'center' }}>{icon}</span>
    <span style={{ fontSize: 11, color: '#c9d1d9', fontFamily: "'Syne',sans-serif" }}>{label}</span>
    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#e6edf3', fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{value}</span>
  </div>
);

const QuestMixPanel: React.FC<{ quests: QuestRow[] }> = ({ quests }) => {
  const lessons  = quests.filter(q => activityTypesForQuest(q).some(t => t === 'drag_drop' || t === 'code_fill' || t === 'ordering')).length;
  const quizzes  = quests.filter(q => activityTypesForQuest(q).includes('multiple_choice')).length;
  const balloons = quests.filter(q => activityTypesForQuest(q).includes('pop_balloon')).length;
  const totalXP = levelXpCapForPhase(quests[0]?.phase);
  const seen    = new Set<string>();
  for (const q of quests) {
    activityTypesForQuest(q).forEach(t => seen.add(t));
  }

  return (
    <div style={{ background: 'rgba(255,255,255,.02)', border: '1.5px solid rgba(255,255,255,.06)', borderRadius: 13, padding: '14px 16px', animation: 'questIn .5s ease .3s both' }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: '#484f58', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 10, fontFamily: "'JetBrains Mono',monospace" }}>Quest Mix</div>
      <QuestMixRow icon="📚" label="Lessons"    value={lessons} />
      <QuestMixRow icon="🧠" label="Quizzes"    value={quizzes} />
      {balloons > 0 && <QuestMixRow icon="🎈" label="Balloon Pop" value={balloons} />}
      <QuestMixRow icon="⚡" label="Max XP"     value={totalXP.toLocaleString()} />
      <QuestMixRow icon="🎯" label="Activities" value={seen.size} />
    </div>
  );
};

// ─── Page ──────────────────────────────────────────────────────────────────
// Note: pure gating logic (buildQuests) lives in ./campaign/buildQuests.ts so
// it can be unit-tested without mounting this component.
export const CampaignInside: React.FC = () => {
  const { phase: phaseParam } = useParams<{ phase: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const phase: Phase = isCampaignPhase(phaseParam)
    ? phaseParam
    : 'beginner';

  const [quests,    setQuests]    = useState<QuestRow[]>([]);
  const [stats,     setStats]     = useState<LevelStats>({ finished: 0, total: 0, xpEarned: 0, xpTotal: 0, streak: 0 });
  const [levelInfo, setLevelInfo] = useState<LevelInfo>(() => defaultLevelInfoForPhase(phase));
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [userXP,    setUserXP]    = useState(0);

  const questIdsRef = useRef<string[]>([]);

  // ── Fetch everything ────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true); setError(null);
    try {
      // 1. User XP (header)
      const { data: ud } = await supabase
        .from('users')
        .select('totalxp')
        .eq('id', user.id)
        .single();
      if (ud?.totalxp !== undefined) setUserXP(ud.totalxp ?? 0);

      // 2. Phase banner copy
      const { data: lm } = await supabase
        .from('level_info')
        .select('*')
        .eq('phase', phase)
        .maybeSingle();
      if (lm) {
        const fallback = defaultLevelInfoForPhase(phase);
        setLevelInfo({
          title:        lm.title        ?? fallback.title,
          subtitle:     lm.subtitle     ?? fallback.subtitle,
          description:  lm.description  ?? null,
          banner_url:   lm.banner_url   ?? null,
          accent_color: lm.accent_color ?? fallback.accent_color,
        });
      } else {
        setLevelInfo(defaultLevelInfoForPhase(phase));
      }

      // 3. Quests for this phase
      const { data: qData, error: qErr } = await supabase
        .from('quests')
        .select('id,title,description,difficulty,level,phase,basexp,requiredxp,sortorder,isactive,question_type,objectives,hints,game_items,drop_zones,ordering_items,mc_questions,code_fill_items,tutorial_title,tutorial_body,tutorial_image,theory_sections')
        .eq('phase', phase)
        .eq('mode', 'campaign')
        .eq('isactive', true)
        .order('sortorder', { ascending: true });
      if (qErr) throw qErr;
      const qList = (qData ?? []) as unknown as Quest[];
      questIdsRef.current = qList.map(q => q.id);

      // 4. This user's mission_progress for those quests
      let mp: MissionProgress[] = [];
      if (qList.length > 0) {
        const { data: pData, error: pErr } = await supabase
          .from('mission_progress')
          .select('id,userid,questid,status,attempts,hintsused,startedat,completedat,first_completed_at,updatedat,xp_gained,completed_activities')
          .eq('userid', user.id)
          .in('questid', questIdsRef.current);
        if (pErr) throw pErr;
        mp = (pData ?? []) as MissionProgress[];
      }

      const built = buildQuests(qList, mp);
      setQuests(built.rows);
      setStats(built.stats);
    } catch (err) {
      console.error('CampaignInside fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load level data');
    } finally {
      setLoading(false);
    }
  }, [user?.id, phase]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Real-time: re-fetch on mission_progress changes for this user ──────
  useEffect(() => {
    if (!user?.id) return;
    const ch = supabase
      .channel(`campaign-inside-${phase}-${user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'mission_progress',
        filter: `userid=eq.${user.id}`,
      }, () => { fetchAll(); })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'users',
        filter: `id=eq.${user.id}`,
      }, payload => {
        const v = payload.new?.totalxp;
        if (typeof v === 'number') setUserXP(v);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id, phase, fetchAll]);

  // ── Derived ─────────────────────────────────────────────────────────────
  const accent      = levelInfo.accent_color;
  const levelNumber = levelForPhase(phase);
  const pctDone     = stats.total > 0 ? Math.round((stats.finished / stats.total) * 100) : 0;

  // First active quest = "Continue" CTA target.
  const nextQuest = useMemo(
    () => quests.find(q => q.uiStatus === 'active'),
    [quests]
  );

  // Level fully complete = every quest has been finished at least once.
  // Also treat a phase with zero active quests as "done" so the next-level
  // button still appears and the user isn't stuck.
  const allDone = stats.total === 0 ? !loading : stats.finished >= stats.total;

  const goToNextLevel = () => {
    navigate(`/campaign/inside/${phaseForLevel(levelNumber + 1)}`);
  };

  return (
    <>
      <style>{STYLE_CSS}</style>

      <div className="ci-root">
        {/* Header */}
        <header className="ci-header" style={{ height: 56, background: 'rgba(13,17,23,0.97)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', position: 'sticky', top: 0, zIndex: 100, backdropFilter: 'blur(14px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span className="ci-header-logo" style={{ fontSize: 17, flexShrink: 0 }}>🗺️</span>
            <span className="ci-header-brand" style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>CodeSense Journey</span>
            <span className="ci-header-sep" style={{ color: '#21262d', flexShrink: 0 }}>›</span>
            <span style={{ fontSize: 10, color: accent, fontFamily: "'JetBrains Mono', monospace", background: `${accent}11`, border: `1px solid ${accent}2e`, padding: '2px 9px', borderRadius: 5, flexShrink: 0 }}>
              Level {levelNumber} · {phase[0].toUpperCase() + phase.slice(1)}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
            <div className="ci-xp-pill" style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(227,179,65,0.09)', border: '1px solid rgba(227,179,65,0.22)', borderRadius: 7, padding: '5px 12px' }}>
              <span style={{ fontSize: 11 }}>⚡</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#e3b341', fontWeight: 700 }}>{userXP.toLocaleString()} XP</span>
            </div>
            <button
              onClick={() => navigate('/campaign')}
              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: '#8b949e', padding: '5px 13px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace", transition: 'all .15s' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#f85149'; e.currentTarget.style.borderColor = 'rgba(248,81,73,.35)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#8b949e'; e.currentTarget.style.borderColor = 'rgba(255,255,255,.08)'; }}>
              ← Back
            </button>
          </div>
        </header>

        <main style={{ maxWidth: 1000, margin: '0 auto', padding: '26px 20px 60px' }}>
          {error && (
            <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(218,54,51,0.1)', border: '1px solid rgba(218,54,51,0.3)', color: '#f85149', fontSize: 13, fontFamily: "'JetBrains Mono',monospace", marginBottom: 18 }}>
              ⚠️ {error} — <button onClick={fetchAll} style={{ background: 'none', border: 'none', color: '#58a6ff', cursor: 'pointer', fontSize: 13, fontFamily: "'JetBrains Mono',monospace" }}>retry</button>
            </div>
          )}

          {/* Hero */}
          <div className="ci-hero" style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', height: 162, marginBottom: 26, background: levelInfo.banner_url ? `url(${levelInfo.banner_url}) center/cover no-repeat` : `linear-gradient(135deg,${accent}18 0%, #101d28 55%, #0d1117 100%)`, border: '1px solid rgba(255,255,255,0.07)', boxShadow: '0 12px 48px rgba(0,0,0,.55)', animation: 'heroIn 0.5s ease' }}>
            <div style={{ position: 'absolute', inset: 0, opacity: 0.055, backgroundImage: `linear-gradient(${accent}99 1px,transparent 1px),linear-gradient(90deg,${accent}99 1px,transparent 1px)`, backgroundSize: '38px 38px' }} />
            <div style={{ position: 'absolute', left: 0, right: 0, height: '30%', opacity: 0.08, background: `linear-gradient(transparent,${accent}80,transparent)`, animation: 'scan 5s ease-in-out infinite', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg,rgba(8,12,17,.88) 0%,rgba(8,12,17,.35) 55%,transparent 100%)' }} />
            <div style={{ position: 'relative', zIndex: 1, padding: '22px 28px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              <div style={{ fontSize: 9, color: accent, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, letterSpacing: '2.5px', textTransform: 'uppercase', marginBottom: 8, opacity: 0.9 }}>{levelInfo.subtitle}</div>
              <h1 style={{ fontSize: 'clamp(20px,2.8vw,28px)', fontWeight: 900, color: '#f0f6fc', letterSpacing: '-0.5px', lineHeight: 1.1, fontFamily: "'Syne',sans-serif" }}>{levelInfo.title}</h1>
              {levelInfo.description && <p style={{ fontSize: 11, color: 'rgba(240,246,252,.5)', marginTop: 7, maxWidth: 460, lineHeight: 1.6, fontFamily: "'Syne',sans-serif" }}>{levelInfo.description}</p>}
            </div>
            <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
              <div style={{ position: 'relative', height: 32, display: 'flex', alignItems: 'center' }}>
  {/* Locked badge — fades out when allDone */}
  <div style={{
    position: 'absolute', right: 0,
    padding: '7px 16px', borderRadius: 7,
    background: 'rgba(8,12,17,.55)',
    border: '1.5px solid rgba(255,255,255,0.1)',
    color: '#6e7681', fontSize: 11, fontWeight: 800,
    letterSpacing: '0.4px', fontFamily: "'JetBrains Mono',monospace",
    backdropFilter: 'blur(8px)', whiteSpace: 'nowrap',
    opacity: loading ? 0 : allDone ? 0 : 1,
    pointerEvents: allDone ? 'none' : 'auto',
    transition: 'opacity 0.4s ease, transform 0.4s ease',
    transform: allDone ? 'translateY(-6px)' : 'translateY(0)',
  }}>
    🔒 Finish all quests to advance
  </div>

  {/* Next Level button — fades in when allDone */}
  <button
    onClick={goToNextLevel}
    style={{
      position: 'absolute', right: 0,
      padding: '7px 16px', borderRadius: 7,
      background: allDone ? `${accent}18` : 'transparent',
      border: `1.5px solid ${accent}`,
      color: accent, fontSize: 11, fontWeight: 800,
      cursor: 'pointer', letterSpacing: '0.4px',
      fontFamily: "'JetBrains Mono',monospace",
      backdropFilter: 'blur(8px)', whiteSpace: 'nowrap',
      opacity: loading ? 0 : allDone ? 1 : 0,
      pointerEvents: allDone ? 'auto' : 'none',
      transition: 'opacity 0.4s ease, transform 0.4s ease, background 0.2s',
      transform: allDone ? 'translateY(0)' : 'translateY(6px)',
      boxShadow: allDone ? `0 0 18px ${accent}33` : 'none',
    }}
    onMouseEnter={e => { e.currentTarget.style.background = `${accent}30`; e.currentTarget.style.boxShadow = `0 0 24px ${accent}55`; }}
    onMouseLeave={e => { e.currentTarget.style.background = `${accent}18`; e.currentTarget.style.boxShadow = `0 0 18px ${accent}33`; }}>
    {phase === 'advanced' ? '🏠 Back to Home' : 'Next Level →'}
  </button>
</div>
              <div style={{ fontSize: 10, color: 'rgba(240,246,252,.45)', fontFamily: "'JetBrains Mono',monospace", background: 'rgba(8,12,17,.6)', padding: '3px 10px', borderRadius: 5, backdropFilter: 'blur(6px)' }}>
                {loading ? '…' : `${pctDone}% complete`}
              </div>
            </div>
          </div>

          {/* 2-col layout */}
          <div className="ci-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 252px', gap: 18, alignItems: 'start' }}>
            {/* Quest list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1px', textTransform: 'uppercase' }}>Lessons</span>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.05)' }} />
                <span style={{ fontSize: 10, color: '#484f58', fontFamily: "'JetBrains Mono',monospace" }}>
                  {loading ? '…' : `${stats.finished}/${stats.total} done`}
                </span>
              </div>

              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} style={{ height: 64, borderRadius: 10, background: 'rgba(255,255,255,.025)', border: '1.5px solid rgba(255,255,255,.04)', animation: 'shimPulse 1.2s ease-in-out infinite', animationDelay: `${i * .08}s` }} />
                  ))
                : quests.length === 0
                ? <div style={{ height: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                    <span style={{ fontSize: 34, opacity: 0.13 }}>📭</span>
                    <span style={{ fontSize: 11, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", textAlign: 'center' }}>
                      No quests yet for this level.<br />Add quests with <code>phase='{phase}'</code> in Supabase.
                    </span>
                  </div>
                : quests.map((q, i) => (
                    <QuestCard key={q.id} quest={q} index={i} onClick={() => navigate(lessonPathForQuest(q))} />
                  ))
              }
            </div>

            {/* Sidebar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <ProgressPanel      stats={stats} phase={phase} />
              <ActivityTypesPanel quests={quests} />
              <QuestMixPanel      quests={quests} />

              {/* Continue CTA */}
              {!loading && nextQuest && (
                <button onClick={() => navigate(lessonPathForQuest(nextQuest))} style={{ width: '100%', padding: 12, borderRadius: 10, border: 'none', background: `linear-gradient(135deg,${accent},${accent}cc)`, color: '#080c11', fontSize: 12, fontWeight: 900, cursor: 'pointer', letterSpacing: '.3px', fontFamily: "'Syne',sans-serif", boxShadow: `0 4px 18px ${accent}40`, transition: 'all .2s', animation: 'questIn .5s ease .38s both', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 26px ${accent}55`; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = `0 4px 18px ${accent}40`; }}>
                  <span style={{ flexShrink: 0 }}>▶ Continue —</span>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nextQuest.title}</span>
                </button>
              )}

              {/* Completion celebration */}
              {!loading && allDone && (
                <div style={{ padding: '14px 14px 12px', borderRadius: 10, textAlign: 'center', background: 'rgba(63,185,80,.08)', border: '1px solid rgba(63,185,80,.3)', animation: 'questIn .5s ease .38s both' }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>🏆</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#3fb950', fontFamily: "'Syne',sans-serif" }}>Level {levelNumber} Complete!</div>
                  <div style={{ fontSize: 10, color: '#484f58', marginTop: 4, fontFamily: "'JetBrains Mono',monospace" }}>Total XP earned: {stats.xpEarned}</div>
                  <div style={{ fontSize: 10, color: '#8b949e', marginTop: 8, fontFamily: "'Syne',sans-serif" }}>
                    Use <span style={{ color: accent, fontWeight: 700 }}>{phase === 'advanced' ? 'Back to Home' : 'Next Level →'}</span> above.
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  );
};

// ─── Page styles ───────────────────────────────────────────────────────────
const STYLE_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800;900&family=JetBrains+Mono:wght@400;600;700&display=swap');
  @keyframes questIn   { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes heroIn    { from { opacity: 0; transform: translateY(-8px); }  to { opacity: 1; transform: translateY(0); } }
  @keyframes shimPulse { 0%, 100% { opacity: .35; } 50% { opacity: .7; } }
  @keyframes scan      { 0% { transform: translateY(-80%); opacity: 0; } 20% { opacity: 1; } 80% { opacity: 1; } 100% { transform: translateY(300%); opacity: 0; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .ci-root { min-height: 100vh; background: #080c11; font-family: 'Syne',sans-serif; color: #e6edf3; }
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #21262d; border-radius: 3px; }

  @media (max-width: 768px) {
    /* Header — collapse to compact single row */
    .ci-header {
      height: auto !important;
      padding: 10px 14px !important;
      flex-wrap: wrap !important;
      gap: 8px !important;
    }
    /* Hide "CodeSense Journey ›" — keep level badge and back button */
    .ci-header-brand, .ci-header-sep { display: none !important; }
    /* XP pill compact */
    .ci-xp-pill { padding: 5px 10px !important; }
    .ci-xp-pill span:last-child { font-size: 12px !important; }

    /* Main content breathing room */
    .ci-root main {
      padding: 14px 12px 48px !important;
    }

    /* Hero banner shorter on mobile */
    .ci-hero {
      height: 110px !important;
      margin-bottom: 14px !important;
    }
    .ci-hero h1 { font-size: clamp(16px, 4vw, 22px) !important; }

    /* Quest list + sidebar stack vertically */
    .ci-two-col {
      grid-template-columns: 1fr !important;
      gap: 14px !important;
    }

    /* Quest card — comfortable tap target, no side overflow */
    .ci-root .ci-two-col > div:first-child > div {
      margin-bottom: 10px !important;
    }
  }
`;

export default CampaignInside;
