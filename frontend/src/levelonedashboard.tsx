// src/LevelOneDashboard.tsx
// FIXES:
//   1. Removed hardcoded curriculumSubTopics dictionary — sub-topics now come
//      from quest.objectives (already fetched) with a sensible fallback
//   2. Real-time XP subscription via Supabase postgres_changes
//   3. Real-time mission_progress subscription — quest statuses update live
//   4. All stats computed from live DB data — no hardcoded values
//   5. Correct phase filtering for quests
//   6. XP bar and streak computed from actual progress records
//   7. Loading states for each section to avoid flash of empty content
//   8. Error boundary for failed fetches

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './components/AuthScreen';
import { supabase } from './services/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────
interface DBQuest {
  id: string;
  title: string;
  description: string | null;
  difficulty: 'easy' | 'medium' | 'hard' | null;
  basexp: number;
  requiredxp: number;
  sortorder: number;
  phase: string;
  isactive: boolean;
  question_type: string | null;
  objectives: string[] | null;       // used for sub-topics
}

interface MissionProgress {
  questid: string;
  status: 'active' | 'completed' | 'locked';
  hintsused: number;
  xp_gained: number;
}

interface QuestRow extends DBQuest {
  uiStatus: 'completed' | 'active' | 'locked';
  xpGained: number;
}

interface LevelInfo {
  title: string;
  subtitle: string;
  description: string | null;
  banner_url: string | null;
  accent_color: string;
}

interface LevelStats {
  finished: number;
  total: number;
  xpEarned: number;    // actual XP from mission_progress records
  xpTotal: number;     // sum of basexp for all quests
  streak: number;      // consecutive completed from start
}

// ─── Constants ────────────────────────────────────────────────────────────────
const DIFF_COLOR: Record<string, string> = {
  easy: '#3fb950', medium: '#e3b341', hard: '#f85149',
};

const ACTIVITY_ICON: Record<string, string> = {
  drag_drop:       '🃏',
  ordering:        '🔢',
  multiple_choice: '❓',
  pop_balloon:     '🎈',
  manual_input:    '📝',
};

// ─── Stat bar ─────────────────────────────────────────────────────────────────
const StatBar: React.FC<{
  icon: string; label: string; current: number; total: number; color: string;
}> = ({ icon, label, current, total, color }) => {
  const pct = total > 0 ? Math.min((current / total) * 100, 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0' }}>
      <span style={{ fontSize: 18, flexShrink: 0, width: 24, textAlign: 'center' }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ fontSize: 11, color: '#c9d1d9', fontWeight: 600, fontFamily: "'Syne', sans-serif" }}>{label}</span>
          <span style={{ fontSize: 11, color, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace" }}>{current}/{total}</span>
        </div>
        <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg,${color}cc,${color})`, borderRadius: 3, transition: 'width 0.9s cubic-bezier(0.4,0,0.2,1)' }} />
        </div>
      </div>
    </div>
  );
};

// ─── Sub-topic Item Component ──────────────────────────────────────────────
const SubTopicItem: React.FC<{ title: string; isDone: boolean }> = ({ title, isDone }) => (
  <div style={{ 
    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
    borderBottom: '1px solid rgba(255,255,255,0.03)' 
  }}>
    <div style={{ 
      width: 16, height: 16, borderRadius: 4, 
      border: `1.5px solid ${isDone ? '#3fb950' : '#484f58'}`,
      background: isDone ? '#3fb95033' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10
    }}>
      {isDone && '✓'}
    </div>
    <span style={{ fontSize: 11, color: isDone ? '#8b949e' : '#e6edf3', fontFamily: "'Inter', sans-serif" }}>
      {title}
    </span>
  </div>
);

// ─── Quest card ───────────────────────────────────────────────────────────────
const QuestCard: React.FC<{ quest: QuestRow; index: number; onClick: () => void }> = ({ quest, index, onClick }) => {
  const [isOpen, setIsOpen] = useState(false);
  const isDone   = quest.uiStatus === 'completed';
  const isLocked = quest.uiStatus === 'locked';
  const isActive = quest.uiStatus === 'active';
  const accent   = isDone ? '#3fb950' : isActive ? '#e3b341' : '#484f58';

  // FIX: Sub-topics come from quest.objectives (stored in DB).
  // Falls back to the quest description split into a single item, then a
  // generic placeholder — never hardcoded per quest title.
  const subTopics: string[] = (() => {
    if (quest.objectives && quest.objectives.length > 0) return quest.objectives;
    if (quest.description) return [quest.description];
    return ['Foundational concepts covered in this lesson'];
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 12, opacity: isLocked ? 0.5 : 1 }}>
      <div
        onClick={() => !isLocked && setIsOpen(!isOpen)}
        style={{ 
          display: 'flex', alignItems: 'center', gap: 14, padding: '15px 20px', 
          background: 'rgba(255,255,255,0.02)', 
          border: `1.5px solid ${isOpen ? `${accent}66` : 'rgba(255,255,255,0.06)'}`,
          borderLeft: `4px solid ${accent}`, borderRadius: isOpen ? '12px 12px 0 0' : '12px',
          cursor: isLocked ? 'not-allowed' : 'pointer', transition: 'all 0.2s'
        }}
      >
        <div style={{ width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.2)', border: `1px solid ${accent}`, color: accent, fontWeight: 800, fontSize: 12 }}>
          {isLocked ? '🔒' : String(index + 1).padStart(2, '0')}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3' }}>{quest.title}</div>
          <div style={{ fontSize: 10, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>{quest.difficulty}</div>
        </div>
        <div style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: '0.3s', opacity: 0.5 }}>▼</div>
      </div>

      {isOpen && (
        <div style={{ padding: '20px', background: 'rgba(13,17,23,0.6)', border: '1.5px solid rgba(255,255,255,0.06)', borderTop: 'none', borderRadius: '0 0 12px 12px' }}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#484f58', textTransform: 'uppercase', marginBottom: 10, letterSpacing: '1px' }}>Topics covered</div>
            {subTopics.map((topic, i) => (
              <SubTopicItem key={i} title={topic} isDone={isDone} />
            ))}
          </div>
          <button 
            onClick={onClick}
            style={{ width: '100%', padding: '12px', borderRadius: 8, background: accent, color: '#080c11', fontWeight: 900, fontSize: 12, cursor: 'pointer', border: 'none', boxShadow: `0 4px 12px ${accent}33` }}
          >
            {isDone ? 'Review Lesson' : `Start Final Quest +${quest.basexp} XP`}
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────
export const LevelOneDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user }  = useAuth();

  const [quests,    setQuests]    = useState<QuestRow[]>([]);
  const [levelInfo, setLevelInfo] = useState<LevelInfo>({ title: 'The Core of Programming', subtitle: 'Beginner | Level 1', description: null, banner_url: null, accent_color: '#3fb950' });
  const [stats,     setStats]     = useState<LevelStats>({ finished: 0, total: 0, xpEarned: 0, xpTotal: 0, streak: 0 });
  const [userXP,    setUserXP]    = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  const questIds = useRef<string[]>([]);

  // ── Compute merged quests + stats from raw DB data ─────────────────────────
  const buildQuests = useCallback((
    qData: DBQuest[],
    pData: MissionProgress[],
  ): { rows: QuestRow[]; stats: LevelStats } => {
    const pMap: Record<string, MissionProgress> = {};
    pData.forEach(p => { pMap[p.questid] = p; });

    let foundActive = false;

    const seenTitles = new Set<string>();

    const rows: QuestRow[] = qData
    .filter(q => {
      if (seenTitles.has(q.title)) return false;
      seenTitles.add(q.title);
      return true;
    })
    .map(q => {
      const p = pMap[q.id];
      let uiStatus: QuestRow['uiStatus'];

      if (p?.status === 'completed') {
        uiStatus = 'completed';
      } else if (!foundActive) {
        // This is the first quest that isn't 'completed', so it's 'active'
        uiStatus = 'active'; 
        foundActive = true;
      } else {
        // Anything after the first non-completed quest is 'locked'
        uiStatus = 'locked';
      }
      return { ...q, uiStatus, xpGained: p?.xp_gained ?? 0 };
    });

    const done     = rows.filter(q => q.uiStatus === 'completed');
    const xpEarned = done.reduce((s, q) => s + q.xpGained, 0);
    const xpTotal  = rows.reduce((s, q) => s + q.basexp, 0);
    let streak = 0;
    for (const q of rows) { if (q.uiStatus === 'completed') streak++; else break; }

    return {
      rows,
      stats: { finished: done.length, total: rows.length, xpEarned, xpTotal, streak },
    };
  }, []);

  // ── Fetch everything ───────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true); setError(null);
    try {
      const { data: ud, error: uErr } = await supabase.from('users').select('totalxp').eq('id', user.id).single();
      if (uErr) throw uErr;
      if (ud) setUserXP(ud.totalxp ?? 0);

      const { data: lm } = await supabase.from('level_info').select('*').eq('phase', 'beginner').maybeSingle();
      if (lm) setLevelInfo({
        title:        lm.title        ?? 'The Core of Programming',
        subtitle:     lm.subtitle     ?? 'Beginner | Level 1',
        description:  lm.description  ?? null,
        banner_url:   lm.banner_url   ?? null,
        accent_color: lm.accent_color ?? '#3fb950',
      });

      // FIX: include `objectives` in the select so sub-topics render from DB
      const { data: qData, error: qErr } = await supabase
        .from('quests')
        .select('id,title,description,difficulty,basexp,requiredxp,sortorder,phase,isactive,question_type,objectives')
        .eq('level', 1)
        .eq('isactive', true)
        .eq('mode', 'campaign')
        .order('sortorder', { ascending: true })
        .limit(6);
      if (qErr) throw qErr;
      if (!qData?.length) { setQuests([]); setLoading(false); return; }

      questIds.current = qData.map((q: DBQuest) => q.id);

      const { data: pData, error: pErr } = await supabase
        .from('mission_progress')
        .select('questid,status,hintsused,xp_gained')
        .eq('userid', user.id)
        .in('questid', questIds.current);
      if (pErr) throw pErr;

      const { rows, stats } = buildQuests(qData as DBQuest[], (pData ?? []) as MissionProgress[]);
      setQuests(rows);
      setStats(stats);
    } catch (err: any) {
      console.error('LevelOneDashboard fetch error:', err);
      setError(err?.message ?? 'Failed to load level data');
    } finally {
      setLoading(false);
    }
  }, [user?.id, buildQuests]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Real-time: user XP ────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    const ch = supabase
      .channel(`lvl1-user-${user.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${user.id}`,
      }, payload => {
        const newXP = payload.new?.totalxp;
        if (typeof newXP === 'number') setUserXP(newXP);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id]);

  // ── Real-time: mission progress ───────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    const ch = supabase
      .channel(`lvl1-progress-${user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'mission_progress', filter: `userid=eq.${user.id}`,
      }, () => {
        fetchAll();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id, fetchAll]);

  const nextQuest = quests.find(q => q.uiStatus === 'active');
  const pctDone   = stats.total > 0 ? Math.round((stats.finished / stats.total) * 100) : 0;
  const AC        = levelInfo.accent_color;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800;900&family=JetBrains+Mono:wght@400;600;700&display=swap');
        @keyframes questIn   { from{opacity:0;transform:translateX(-10px)} to{opacity:1;transform:translateX(0)} }
        @keyframes heroIn    { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimPulse { 0%,100%{opacity:.35} 50%{opacity:.7} }
        @keyframes scan      { 0%{transform:translateY(-80%);opacity:0} 20%{opacity:1} 80%{opacity:1} 100%{transform:translateY(300%);opacity:0} }
        *{box-sizing:border-box;margin:0;padding:0}
        .lvl1-root{min-height:100vh;background:#080c11;font-family:'Syne',sans-serif;color:#e6edf3}
        ::-webkit-scrollbar{width:5px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#21262d;border-radius:3px}
      `}</style>

      <div className="lvl1-root">

        {/* Header */}
        <header style={{ height: 56, background: 'rgba(13,17,23,0.97)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', position: 'sticky', top: 0, zIndex: 100, backdropFilter: 'blur(14px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 17 }}>🗺️</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 13 }}>CodeSense Journey</span>
            <span style={{ color: '#21262d' }}>›</span>
            <span style={{ fontSize: 10, color: AC, fontFamily: "'JetBrains Mono', monospace", background: `${AC}11`, border: `1px solid ${AC}2e`, padding: '2px 9px', borderRadius: 5 }}>Level 1 · Beginner</span>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(227,179,65,0.09)', border: '1px solid rgba(227,179,65,0.22)', borderRadius: 7, padding: '5px 12px' }}>
              <span style={{ fontSize: 11 }}>⚡</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#e3b341', fontWeight: 700 }}>{userXP.toLocaleString()} XP</span>
            </div>
            <button onClick={() => navigate('/campaign')} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: '#8b949e', padding: '5px 13px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace", transition: 'all .15s' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#f85149'; e.currentTarget.style.borderColor = 'rgba(248,81,73,.35)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#8b949e'; e.currentTarget.style.borderColor = 'rgba(255,255,255,.08)'; }}>
              ← Back
            </button>
          </div>
        </header>

        <main style={{ maxWidth: 1000, margin: '0 auto', padding: '26px 20px 60px' }}>

          {/* Error banner */}
          {error && (
            <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(218,54,51,0.1)', border: '1px solid rgba(218,54,51,0.3)', color: '#f85149', fontSize: 13, fontFamily: "'JetBrains Mono',monospace", marginBottom: 18 }}>
              ⚠️ {error} — <button onClick={fetchAll} style={{ background: 'none', border: 'none', color: '#58a6ff', cursor: 'pointer', fontSize: 13, fontFamily: "'JetBrains Mono',monospace" }}>retry</button>
            </div>
          )}

          {/* Hero banner */}
          <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', height: 162, marginBottom: 26, background: levelInfo.banner_url ? `url(${levelInfo.banner_url}) center/cover no-repeat` : 'linear-gradient(135deg,#0c1f10 0%,#101d28 55%,#0d1117 100%)', border: '1px solid rgba(255,255,255,0.07)', boxShadow: '0 12px 48px rgba(0,0,0,.55)', animation: 'heroIn 0.5s ease' }}>
            <div style={{ position: 'absolute', inset: 0, opacity: 0.055, backgroundImage: `linear-gradient(${AC}99 1px,transparent 1px),linear-gradient(90deg,${AC}99 1px,transparent 1px)`, backgroundSize: '38px 38px' }} />
            <div style={{ position: 'absolute', left: 0, right: 0, height: '30%', opacity: 0.08, background: `linear-gradient(transparent,${AC}80,transparent)`, animation: 'scan 5s ease-in-out infinite', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg,rgba(8,12,17,.88) 0%,rgba(8,12,17,.35) 55%,transparent 100%)' }} />
            <div style={{ position: 'relative', zIndex: 1, padding: '22px 28px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              <div style={{ fontSize: 9, color: AC, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, letterSpacing: '2.5px', textTransform: 'uppercase', marginBottom: 8, opacity: 0.9 }}>{levelInfo.subtitle}</div>
              <h1 style={{ fontSize: 'clamp(20px,2.8vw,28px)', fontWeight: 900, color: '#f0f6fc', letterSpacing: '-0.5px', lineHeight: 1.1, fontFamily: "'Syne',sans-serif" }}>{levelInfo.title}</h1>
              {levelInfo.description && <p style={{ fontSize: 11, color: 'rgba(240,246,252,.5)', marginTop: 7, maxWidth: 460, lineHeight: 1.6, fontFamily: "'Syne',sans-serif" }}>{levelInfo.description}</p>}
            </div>
            <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
              <button onClick={() => navigate('/campaign/inside/intermediate')} style={{ padding: '7px 16px', borderRadius: 7, background: 'transparent', border: `1.5px solid ${AC}`, color: AC, fontSize: 11, fontWeight: 800, cursor: 'pointer', letterSpacing: '0.4px', fontFamily: "'JetBrains Mono',monospace", backdropFilter: 'blur(8px)', transition: 'all .2s' }}
                onMouseEnter={e => { e.currentTarget.style.background = `${AC}18`; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                Next Level →
              </button>
              <div style={{ fontSize: 10, color: 'rgba(240,246,252,.45)', fontFamily: "'JetBrains Mono',monospace", background: 'rgba(8,12,17,.6)', padding: '3px 10px', borderRadius: 5, backdropFilter: 'blur(6px)' }}>
                {loading ? '…' : `${pctDone}% complete`}
              </div>
            </div>
          </div>

          {/* 2-col layout */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 252px', gap: 18, alignItems: 'start' }}>

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
                      No lessons found.<br />Add quests with <code>level=1</code> and <code>mode='campaign'</code> in Supabase.
                    </span>
                  </div>
                : quests.map((q, i) => (
                    <QuestCard key={q.id} quest={q} index={i} onClick={() => navigate(`/lesson/${q.id}`)} />
                  ))
              }
            </div>

            {/* Sidebar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Progress */}
              <div style={{ background: 'rgba(255,255,255,.02)', border: '1.5px solid rgba(255,255,255,.06)', borderRadius: 13, padding: '18px 16px', animation: 'questIn .5s ease .15s both' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#484f58', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 14, fontFamily: "'JetBrains Mono',monospace" }}>
                  Your Progress
                  <span style={{ marginLeft: 8, display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#3fb950', boxShadow: '0 0 6px #3fb950', verticalAlign: 'middle' }} title="Live" />
                </div>
                <StatBar icon="🎒" label="Lessons Done"  current={stats.finished} total={stats.total}   color="#58a6ff" />
                <div style={{ height: 1, background: 'rgba(255,255,255,.04)', margin: '3px 0' }} />
                <StatBar icon="⚡" label="XP Earned"     current={stats.xpEarned} total={stats.xpTotal} color="#e3b341" />
                <div style={{ height: 1, background: 'rgba(255,255,255,.04)', margin: '3px 0' }} />
                <StatBar icon="🔥" label="Streak"        current={stats.streak}   total={stats.total}   color="#f0883e" />
              </div>

              {/* Activity types */}
              <div style={{ background: 'rgba(255,255,255,.02)', border: '1.5px solid rgba(255,255,255,.06)', borderRadius: 13, padding: '14px 16px', animation: 'questIn .5s ease .22s both' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#484f58', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 12, fontFamily: "'JetBrains Mono',monospace" }}>Activity Types in this Level</div>
                {loading
                  ? <div style={{ color: '#484f58', fontSize: 11, fontFamily: 'Inter,sans-serif' }}>Loading…</div>
                  : (() => {
                      const types = [...new Set(quests.map(q => q.question_type).filter(Boolean))] as string[];
                      const typeLabels: Record<string, { label: string; desc: string }> = {
                        drag_drop:       { label: 'Drag & Drop',    desc: 'Match terms to definitions' },
                        ordering:        { label: 'Ordering',       desc: 'Arrange steps in sequence' },
                        multiple_choice: { label: 'Multiple Choice',desc: 'Pick the right answer' },
                        pop_balloon:     { label: 'Balloon Pop',    desc: 'Pop the correct balloon' },
                        manual_input:    { label: 'Manual Input',   desc: 'Type your answer' },
                      };
                      return types.length > 0 ? types.map(t => {
                        const info = typeLabels[t] ?? { label: t.replace(/_/g, ' '), desc: '' };
                        return (
                          <div key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginBottom: 9 }}>
                            <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{ACTIVITY_ICON[t] ?? '🎮'}</span>
                            <div>
                              <div style={{ fontSize: 11, color: '#c9d1d9', fontWeight: 600, fontFamily: "'Syne',sans-serif" }}>{info.label}</div>
                              <div style={{ fontSize: 10, color: '#484f58', fontFamily: "'Syne',sans-serif" }}>{info.desc}</div>
                            </div>
                          </div>
                        );
                      }) : <div style={{ fontSize: 11, color: '#484f58', fontFamily: 'Inter,sans-serif' }}>No activities yet.</div>;
                    })()
                }
              </div>

              {/* Difficulty legend */}
              <div style={{ background: 'rgba(255,255,255,.02)', border: '1.5px solid rgba(255,255,255,.06)', borderRadius: 13, padding: '14px 16px', animation: 'questIn .5s ease .3s both' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#484f58', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 10, fontFamily: "'JetBrains Mono',monospace" }}>Difficulty</div>
                {Object.entries(DIFF_COLOR).map(([d, c]) => (
                  <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />
                    <span style={{ fontSize: 11, color: '#8b949e', textTransform: 'capitalize', fontFamily: "'Syne',sans-serif" }}>{d}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: '#484f58', fontFamily: "'JetBrains Mono',monospace" }}>
                      {quests.filter(q => q.difficulty === d).length} quest{quests.filter(q => q.difficulty === d).length !== 1 ? 's' : ''}
                    </span>
                  </div>
                ))}
              </div>

              {/* CTA */}
              {!loading && nextQuest && (
                <button onClick={() => navigate(`/lesson/${nextQuest.id}`)} style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg,${AC},${AC}cc)`, color: '#080c11', fontSize: 12, fontWeight: 900, cursor: 'pointer', letterSpacing: '.3px', fontFamily: "'Syne',sans-serif", boxShadow: `0 4px 18px ${AC}40`, transition: 'all .2s', animation: 'questIn .5s ease .38s both' }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 26px ${AC}55`; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = `0 4px 18px ${AC}40`; }}>
                  ▶ Continue — {nextQuest.title.length > 22 ? nextQuest.title.slice(0, 22) + '…' : nextQuest.title}
                </button>
              )}

              {!loading && stats.finished > 0 && stats.finished === stats.total && (
                <div style={{ padding: '12px 14px', borderRadius: 10, textAlign: 'center', background: 'rgba(63,185,80,.08)', border: '1px solid rgba(63,185,80,.3)', animation: 'questIn .5s ease .38s both' }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>🏆</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#3fb950', fontFamily: "'Syne',sans-serif" }}>Level 1 Complete!</div>
                  <div style={{ fontSize: 10, color: '#484f58', marginTop: 4, fontFamily: "'JetBrains Mono',monospace" }}>Total XP earned: {stats.xpEarned}</div>
                  <button onClick={() => navigate('/campaign/inside/intermediate')} style={{ marginTop: 10, width: '100%', padding: '9px', borderRadius: 8, border: 'none', background: '#3fb950', color: '#000', fontWeight: 800, fontSize: 12, cursor: 'pointer', fontFamily: "'Syne',sans-serif" }}>Head to Level 2 →</button>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  );
};

export default LevelOneDashboard;