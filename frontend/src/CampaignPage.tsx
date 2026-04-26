// frontend/src/CampaignPage.tsx
// Campaign mode entry — three level cards (Beginner / Intermediate / Advanced).
//
// Gating model: linear, driven by `mission_progress.first_completed_at`.
//   • Level 1 is always unlocked.
//   • Level 2 unlocks once every Level 1 quest has `first_completed_at` set.
//   • Level 3 unlocks once every Level 2 quest has `first_completed_at` set.
//
// `first_completed_at` survives retakes (RPC uses COALESCE; trigger blocks
// accidental NULLing — see migration_mission_progress_v2.sql), so playing
// through the level once unlocks the next one and never gets undone.

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './components/AuthScreen';
import { supabase } from './services/supabase';
import type { Phase } from './types/campaign';

// ─── Visual config (level cards' look, not gameplay) ───────────────────────
interface LevelCardConfig {
  id:        1 | 2 | 3;
  phase:     Phase;
  title:     string;
  subtitle:  string;
  color:     string;
  glowColor: string;
  icon:      string;
}

const LEVELS: LevelCardConfig[] = [
  { id: 1, phase: 'beginner',     title: 'LEVEL 1', subtitle: 'Beginner',     color: '#3fb950', glowColor: 'rgba(63,185,80,0.35)',  icon: '🌱' },
  { id: 2, phase: 'intermediate', title: 'LEVEL 2', subtitle: 'Intermediate', color: '#e3b341', glowColor: 'rgba(227,179,65,0.35)', icon: '⚔️' },
  { id: 3, phase: 'advanced',     title: 'LEVEL 3', subtitle: 'Advanced',     color: '#f85149', glowColor: 'rgba(248,81,73,0.35)',  icon: '🔥' },
];

const CAMPAIGN_STARTED_KEY = 'cs-campaign-started';

interface PhaseProgress {
  total:     number;
  finished:  number;  // count of quests with first_completed_at set
}

// ─── Page ──────────────────────────────────────────────────────────────────
export const CampaignPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Persist "started" so coming back from a level keeps the cards interactive.
  const [started, setStarted] = useState<boolean>(() => {
    try { return sessionStorage.getItem(CAMPAIGN_STARTED_KEY) === '1'; } catch { return false; }
  });
  const [visible,      setVisible]      = useState(false);
  const [hoveredLevel, setHoveredLevel] = useState<number | null>(null);
  const [progress,     setProgress]     = useState<Record<Phase, PhaseProgress>>({
    beginner:     { total: 0, finished: 0 },
    intermediate: { total: 0, finished: 0 },
    advanced:     { total: 0, finished: 0 },
  });

  const [particles,   setParticles]   = useState<{ x: number; y: number; id: number }[]>([]);
  const [bgParticles, setBgParticles] = useState<{ x: number; y: number; id: number }[]>([]);
  const bannerRef  = useRef<HTMLDivElement>(null);
  const particleId = useRef(0);

  const userXP = user?.totalXP ?? 0;

  // ── Body styling: enable scrolling on this page ──────────────────────────
  useEffect(() => {
    const els = [document.documentElement, document.body, document.getElementById('root')];
    els.forEach(el => { if (el) { el.style.overflow = 'auto'; el.style.height = 'auto'; } });
    setTimeout(() => setVisible(true), 50);
    return () => {
      els.forEach(el => { if (el) { el.style.overflow = ''; el.style.height = ''; } });
    };
  }, []);

  // ── Fetch quests + this user's progress to compute unlock state ──────────
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    const fetchProgress = async () => {
      // 1. Every active campaign quest, grouped by phase
      const { data: quests } = await supabase
        .from('quests')
        .select('id, phase')
        .eq('isactive', true)
        .eq('mode', 'campaign');
      if (cancelled || !quests) return;

      const questIdsByPhase: Record<Phase, string[]> = {
        beginner: [], intermediate: [], advanced: [],
      };
      for (const q of quests) {
        const phase = q.phase as Phase | null;
        if (phase && phase in questIdsByPhase) questIdsByPhase[phase].push(q.id);
      }

      // 2. This user's mission_progress for the campaign quests
      const allIds = quests.map(q => q.id);
      const { data: mp } = allIds.length
        ? await supabase
            .from('mission_progress')
            .select('questid, first_completed_at')
            .eq('userid', user.id)
            .in('questid', allIds)
        : { data: [] as { questid: string; first_completed_at: string | null }[] };
      if (cancelled) return;

      const finishedIds = new Set(
        (mp ?? [])
          .filter(r => r.first_completed_at != null)
          .map(r => r.questid)
      );

      const next: Record<Phase, PhaseProgress> = {
        beginner:     { total: 0, finished: 0 },
        intermediate: { total: 0, finished: 0 },
        advanced:     { total: 0, finished: 0 },
      };
      (Object.keys(questIdsByPhase) as Phase[]).forEach(phase => {
        const ids = questIdsByPhase[phase];
        next[phase] = {
          total:    ids.length,
          finished: ids.filter(id => finishedIds.has(id)).length,
        };
      });

      setProgress(next);
    };

    fetchProgress();
    return () => { cancelled = true; };
  }, [user?.id]);

  // ── Unlock = previous level fully completed (or is level 1) ──────────────
  const isLevelUnlocked = (id: 1 | 2 | 3): boolean => {
    if (id === 1) return true;
    const prevPhase = LEVELS[id - 2].phase;
    const prev = progress[prevPhase];
    return prev.total > 0 && prev.finished >= prev.total;
  };

  const isLevelComplete = (phase: Phase): boolean => {
    const p = progress[phase];
    return p.total > 0 && p.finished >= p.total;
  };

  // ── Click handlers ────────────────────────────────────────────────────────
  const handlePageClick = (e: React.MouseEvent) => {
    const id = particleId.current++;
    setBgParticles(p => [...p, { x: e.clientX, y: e.clientY, id }]);
    setTimeout(() => setBgParticles(p => p.filter(pt => pt.id !== id)), 900);
  };

  const handleLevelClick = (level: LevelCardConfig) => {
    if (!started || !isLevelUnlocked(level.id)) return;
    navigate(`/campaign/inside/${level.phase}`);
  };

  const handleBannerClick = (e: React.MouseEvent) => {
    const rect = bannerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const id = particleId.current++;
    setParticles(p => [...p, { x, y, id }]);
    setTimeout(() => setParticles(p => p.filter(pt => pt.id !== id)), 800);
    setStarted(true);
    try { sessionStorage.setItem(CAMPAIGN_STARTED_KEY, '1'); } catch { /* quota */ }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{STYLE_CSS}</style>

      <div className="campaign-bg">
        <div className="grid" />
        <div className="scanline" />
      </div>

      {/* Click particles (page-wide overlay) */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none', overflow: 'hidden' }}>
        {bgParticles.map(p => (
          <div key={p.id} style={{
            position: 'absolute', left: p.x, top: p.y,
            width: 70, height: 70, borderRadius: '50%',
            border: '2px solid rgba(227,179,65,0.7)',
            animation: 'bg-particle-burst 0.9s ease-out forwards',
            pointerEvents: 'none',
          }} />
        ))}
      </div>

      <div
        className="campaign-root campaign-content"
        style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.4s ease' }}
        onClick={handlePageClick}
      >
        <Header userXP={userXP} onExit={() => navigate('/home')} />

        <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px 60px' }}>
          <HeroBanner
            ref={bannerRef}
            started={started}
            particles={particles}
            onClick={handleBannerClick}
          />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            {LEVELS.map((level, i) => (
              <LevelCard
                key={level.id}
                config={level}
                index={i}
                started={started}
                unlocked={isLevelUnlocked(level.id)}
                completed={isLevelComplete(level.phase)}
                progress={progress[level.phase]}
                hovered={hoveredLevel === level.id}
                onHover={hover => setHoveredLevel(hover ? level.id : null)}
                onClick={() => handleLevelClick(level)}
              />
            ))}
          </div>

          {!started && (
            <p style={{
              textAlign: 'center', marginTop: 32, color: '#484f58',
              fontSize: 13, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.5px',
            }}>
              Press the banner above to begin your journey
            </p>
          )}
        </div>
      </div>
    </>
  );
};

// ─── Header ────────────────────────────────────────────────────────────────
const Header: React.FC<{ userXP: number; onExit: () => void }> = ({ userXP, onExit }) => (
  <div style={{
    height: 58, background: 'rgba(8,11,16,0.6)', backdropFilter: 'blur(12px)',
    borderBottom: '1px solid #2d333b',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 24px', position: 'sticky', top: 0, zIndex: 100,
    boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 18 }}>🎯</span>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 15, letterSpacing: '-0.3px' }}>
        CodeSense Journey
      </span>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.25)',
        borderRadius: 8, padding: '5px 12px',
      }}>
        <span style={{ fontSize: 12 }}>⚡</span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: '#3fb950', fontWeight: 700 }}>
          {userXP.toLocaleString()} XP
        </span>
      </div>
      <button
        onClick={onExit}
        style={{
          background: 'transparent', border: '1px solid #444c56', color: '#8b949e',
          padding: '7px 14px', borderRadius: 6, fontWeight: 600, fontSize: 11, letterSpacing: '0.5px',
          cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace", transition: 'all 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = '#f85149'; e.currentTarget.style.color = '#f85149'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = '#444c56'; e.currentTarget.style.color = '#8b949e'; }}
      >
        ← EXIT
      </button>
    </div>
  </div>
);

// ─── Hero banner ───────────────────────────────────────────────────────────
const HeroBanner = React.forwardRef<
  HTMLDivElement,
  { started: boolean; particles: { x: number; y: number; id: number }[]; onClick: (e: React.MouseEvent) => void }
>(({ started, particles, onClick }, ref) => (
  <div
    ref={ref}
    onClick={onClick}
    style={{
      position: 'relative', borderRadius: 16, overflow: 'hidden', height: 220, marginBottom: 28,
      background: 'linear-gradient(135deg, #1a1500 0%, #241c00 50%, #0d1117 100%)',
      border: '1px solid rgba(227,179,65,0.2)',
      cursor: started ? 'default' : 'pointer',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    }}
  >
    <div style={{ position: 'absolute', inset: 0, opacity: 0.12, backgroundImage: 'linear-gradient(rgba(227,179,65,0.6) 1px,transparent 1px),linear-gradient(90deg,rgba(227,179,65,0.6) 1px,transparent 1px)', backgroundSize: '40px 40px' }} />
    <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 30% 50%, rgba(227,179,65,0.08), transparent 60%)' }} />
    <div style={{ position: 'relative', zIndex: 1, padding: '32px 36px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div style={{ fontSize: 11, color: '#e3b341', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', marginBottom: 12 }}>
        Choose Your Path
      </div>
      <h1 style={{ fontSize: 32, fontWeight: 800, color: '#f0f6fc', letterSpacing: '-0.8px', lineHeight: 1.1, margin: 0 }}>
        Three levels.
      </h1>
      <h1 style={{ fontSize: 32, fontWeight: 800, color: '#e3b341', letterSpacing: '-0.8px', lineHeight: 1.1, margin: '4px 0 0', fontStyle: 'italic' }}>
        One programmer.
      </h1>
      {!started && (
        <button
          className="press-btn"
          style={{
            position: 'absolute', bottom: 24, right: 32,
            padding: '10px 18px', borderRadius: 8,
            background: 'linear-gradient(135deg, #e3b341, #c69835)', color: '#080b10',
            border: 'none', fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 12, fontWeight: 800, letterSpacing: '1px', cursor: 'pointer',
          }}
        >
          ▶ PRESS TO BEGIN
        </button>
      )}
    </div>
    {particles.map(p => (
      <div key={p.id} style={{
        position: 'absolute', left: p.x, top: p.y, width: 60, height: 60, borderRadius: '50%',
        border: '2px solid rgba(227,179,65,0.6)', pointerEvents: 'none',
        animation: 'particle-burst 0.8s ease-out forwards',
      }} />
    ))}
  </div>
));
HeroBanner.displayName = 'HeroBanner';

// ─── Level card ────────────────────────────────────────────────────────────
const LevelCard: React.FC<{
  config:    LevelCardConfig;
  index:     number;
  started:   boolean;
  unlocked:  boolean;
  completed: boolean;
  progress:  PhaseProgress;
  hovered:   boolean;
  onHover:   (hover: boolean) => void;
  onClick:   () => void;
}> = ({ config, index, started, unlocked, completed, progress, hovered, onHover, onClick }) => {
  const active = started && unlocked;
  const accent = completed ? '#3fb950' : config.color;

  return (
    <div
      className="level-card"
      onClick={onClick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{
        animationDelay: `${index * 0.1 + 0.2}s`,
        background: active
          ? 'linear-gradient(160deg, #161b22 0%, #1c2128 100%)'
          : '#0d1117',
        border: `1px solid ${active ? accent + '55' : '#21262d'}`,
        borderRadius: 16, padding: '28px 24px',
        cursor: active ? 'pointer' : 'not-allowed',
        transition: 'all 0.25s ease', position: 'relative', overflow: 'hidden',
        boxShadow: hovered && active
          ? `0 8px 32px ${config.glowColor}, inset 0 0 20px ${accent}08`
          : '0 4px 12px rgba(0,0,0,0.3)',
        transform: hovered && active ? 'translateY(-4px)' : 'none',
        opacity: !started ? 0.7 : unlocked ? 1 : 0.5,
        minHeight: 240,
      }}
    >
      {active && hovered && (
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 16,
          background: `radial-gradient(circle at 50% 0%, ${accent}0a 0%, transparent 60%)`,
          pointerEvents: 'none',
        }} />
      )}

      {/* Top accent line */}
      <div style={{
        position: 'absolute', top: 0, left: 24, right: 24, height: 2,
        background: active ? `linear-gradient(90deg, transparent, ${accent}, transparent)` : 'transparent',
        borderRadius: '0 0 2px 2px', transition: 'background 0.3s',
      }} />

      {/* Status badge (top-right) */}
      {active && (
        <div style={{
          position: 'absolute', top: 14, right: 14,
          background: `${accent}22`, border: `1px solid ${accent}44`,
          borderRadius: 6, padding: '3px 8px',
          fontSize: 10, fontWeight: 700, color: accent,
          fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.5px',
        }}>
          {completed ? '✓ COMPLETE' : 'UNLOCKED'}
        </div>
      )}

      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ color: active ? accent : '#444c56', fontSize: 14, fontWeight: 700, transition: 'color 0.3s' }}>▶</span>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontWeight: 700, fontSize: 17, letterSpacing: '0.5px',
          color: active ? '#e6edf3' : '#484f58',
        }}>
          {config.title}
        </span>
      </div>
      <div style={{
        fontSize: 14, color: active ? '#8b949e' : '#30363d',
        marginBottom: 22, marginLeft: 24, transition: 'color 0.3s',
      }}>
        {config.subtitle}
      </div>

      {/* Quest count + progress bar */}
      {active && progress.total > 0 && (
        <div style={{ marginLeft: 24, marginBottom: 16 }}>
          <div style={{
            fontSize: 11, color: accent, fontFamily: "'IBM Plex Mono', monospace",
            marginBottom: 6, letterSpacing: '0.5px',
          }}>
            {progress.finished}/{progress.total} {progress.total === 1 ? 'quest' : 'quests'} done
          </div>
          <div style={{ height: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              width: `${(progress.finished / progress.total) * 100}%`,
              height: '100%', background: accent, transition: 'width 0.6s ease',
            }} />
          </div>
        </div>
      )}

      {/* Big icon */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 56, marginTop: 'auto' }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: active ? `${accent}18` : 'rgba(255,255,255,0.03)',
          border: `1px solid ${active ? accent + '44' : '#21262d'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, transition: 'all 0.3s',
        }}>
          {unlocked ? (active ? config.icon : '🔓') : '🔒'}
        </div>
      </div>

      {/* Lock hint */}
      {!unlocked && (
        <div style={{
          textAlign: 'center', marginTop: 10, fontSize: 11, color: '#484f58',
          fontFamily: "'IBM Plex Mono', monospace",
        }}>
          Finish Level {(config.id - 1)} first
        </div>
      )}
    </div>
  );
};

// ─── Page styles (kept inline so the page is self-contained) ──────────────
const STYLE_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');

  @keyframes scanline   { 0% { transform: translateY(-100%); } 100% { transform: translateY(100vh); } }
  @keyframes flicker    { 0%, 95%, 100% { opacity: 1; } 96% { opacity: 0.4; } 97% { opacity: 1; } 98% { opacity: 0.6; } }
  @keyframes drift      { 0% { transform: translate(0,0) scale(1); } 33% { transform: translate(12px,-8px) scale(1.04); } 66% { transform: translate(-8px,12px) scale(0.97); } 100% { transform: translate(0,0) scale(1); } }
  @keyframes particle-burst    { 0% { transform: translate(-50%,-50%) scale(0); opacity: 1; } 100% { transform: translate(-50%,-50%) scale(4); opacity: 0; } }
  @keyframes bg-particle-burst { 0% { transform: translate(-50%,-50%) scale(0); opacity: 0.8; } 60% { opacity: 0.5; } 100% { transform: translate(-50%,-50%) scale(6); opacity: 0; } }
  @keyframes card-in    { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes press-pulse{ 0%,100% { box-shadow: 0 0 0 0 rgba(227,179,65,0.6); } 50% { box-shadow: 0 0 0 12px rgba(227,179,65,0); } }
  @keyframes lock-shake { 0%,100% { transform: translateX(0); } 20% { transform: translateX(-4px); } 40% { transform: translateX(4px); } 60% { transform: translateX(-3px); } 80% { transform: translateX(3px); } }

  .campaign-root {
    position: relative; min-height: 100vh; width: 100%;
    background: transparent; font-family: 'IBM Plex Sans', system-ui, sans-serif;
    color: #e6edf3; overflow-x: hidden;
  }
  .campaign-bg {
    position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden;
    background: #080b10;
  }
  .campaign-bg .grid {
    position: absolute; inset: 0; opacity: 0.25;
    background-image:
      linear-gradient(rgba(227,179,65,0.5) 1px, transparent 1px),
      linear-gradient(90deg, rgba(227,179,65,0.5) 1px, transparent 1px);
    background-size: 50px 50px; animation: drift 20s ease-in-out infinite;
  }
  .campaign-bg .scanline {
    position: absolute; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, transparent, rgba(227,179,65,0.2), transparent);
    animation: scanline 6s linear infinite;
  }
  .campaign-content { position: relative; z-index: 1; }
  .level-card { animation: card-in 0.5s ease both; }
  .press-btn  { animation: flicker 5s ease-in-out infinite, press-pulse 2s ease-in-out infinite; transition: transform 0.2s ease; }
  .press-btn:hover { transform: scale(1.06); }
`;

export default CampaignPage;
