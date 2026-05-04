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

import React, { useEffect, useMemo, useState } from 'react';
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
  blurb:     string;
  color:     string;
  glowColor: string;
  icon:      string;
}

const LEVELS: LevelCardConfig[] = [
  {
    id: 1, phase: 'beginner', title: 'LEVEL 1', subtitle: 'Beginner',
    blurb: 'Variables, I/O, basic control flow.',
    color: '#3fb950', glowColor: 'rgba(63,185,80,0.35)', icon: '🌱',
  },
  {
    id: 2, phase: 'intermediate', title: 'LEVEL 2', subtitle: 'Intermediate',
    blurb: 'Loops, functions, arrays, references.',
    color: '#e3b341', glowColor: 'rgba(227,179,65,0.35)', icon: '⚔️',
  },
  {
    id: 3, phase: 'advanced', title: 'LEVEL 3', subtitle: 'Advanced',
    blurb: 'Pointers, recursion, dynamic memory.',
    color: '#f85149', glowColor: 'rgba(248,81,73,0.35)', icon: '🔥',
  },
];

interface PhaseProgress {
  total:    number;
  finished: number;  // count of quests with first_completed_at set
}

type LevelStatus = 'locked' | 'next' | 'in-progress' | 'complete';

const EMPTY_PROGRESS: Record<Phase, PhaseProgress> = {
  beginner:     { total: 0, finished: 0 },
  intermediate: { total: 0, finished: 0 },
  advanced:     { total: 0, finished: 0 },
};

// ─── DB level info row ─────────────────────────────────────────────────────
interface LevelInfoRow {
  phase:        string;
  title:        string;
  subtitle:     string | null;
  description:  string | null;
  accent_color: string | null;
  banner_url:   string | null;
}

function hexToRgba(hex: string, alpha: number): string {
  const c = hex.replace('#', '');
  return `rgba(${parseInt(c.slice(0,2),16)},${parseInt(c.slice(2,4),16)},${parseInt(c.slice(4,6),16)},${alpha})`;
}

// ─── Page ──────────────────────────────────────────────────────────────────
export const CampaignPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [visible,   setVisible]   = useState(false);
  const [progress,  setProgress]  = useState<Record<Phase, PhaseProgress>>(EMPTY_PROGRESS);
  const [levelInfo, setLevelInfo] = useState<Record<string, LevelInfoRow>>({});

  useEffect(() => {
    supabase
      .from('level_info')
      .select('phase, title, subtitle, description, accent_color, banner_url')
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, LevelInfoRow> = {};
        for (const row of data) map[row.phase] = row as LevelInfoRow;
        setLevelInfo(map);
      });
  }, []);

  const userXP = user?.totalXP ?? 0;

  // ── Body styling: enable scrolling on this page ──────────────────────────
  useEffect(() => {
    const els = [document.documentElement, document.body, document.getElementById('root')];
    els.forEach(el => { if (el) { el.style.overflow = 'auto'; el.style.height = 'auto'; } });
    const t = setTimeout(() => setVisible(true), 30);
    return () => {
      clearTimeout(t);
      els.forEach(el => { if (el) { el.style.overflow = ''; el.style.height = ''; } });
    };
  }, []);

  // ── Fetch quests + this user's progress to compute unlock state ──────────
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    const fetchProgress = async () => {
      const { data: quests } = await supabase
        .from('quests')
        .select('id, phase')
        .eq('isactive', true)
        .eq('mode', 'campaign');
      if (cancelled || !quests) return;

      const idsByPhase: Record<Phase, string[]> = { beginner: [], intermediate: [], advanced: [] };
      for (const q of quests) {
        const phase = q.phase as Phase | null;
        if (phase && phase in idsByPhase) idsByPhase[phase].push(q.id);
      }

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
        (mp ?? []).filter(r => r.first_completed_at != null).map(r => r.questid)
      );

      const next: Record<Phase, PhaseProgress> = { ...EMPTY_PROGRESS };
      (Object.keys(idsByPhase) as Phase[]).forEach(phase => {
        const ids = idsByPhase[phase];
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

  // ── Status derivation ───────────────────────────────────────────────────
  const isLevelComplete = (phase: Phase): boolean => {
    const p = progress[phase];
    return p.total > 0 && p.finished >= p.total;
  };
  const isLevelUnlocked = (id: 1 | 2 | 3): boolean => {
    if (id === 1) return true;
    return isLevelComplete(LEVELS[id - 2].phase);
  };

  // The "next up" level is the first unlocked-but-not-complete level. It gets
  // a subtle pulse-glow so the user can see at a glance where to continue.
  const nextLevelId: 1 | 2 | 3 | null = useMemo(() => {
    for (const lvl of LEVELS) {
      if (isLevelUnlocked(lvl.id) && !isLevelComplete(lvl.phase)) return lvl.id;
    }
    return null;
  }, [progress]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusFor = (lvl: LevelCardConfig): LevelStatus => {
    if (!isLevelUnlocked(lvl.id))      return 'locked';
    if (isLevelComplete(lvl.phase))    return 'complete';
    if (lvl.id === nextLevelId)        return 'next';
    return 'in-progress';
  };

  // ── Click handlers ────────────────────────────────────────────────────────
  const handleLevelClick = (lvl: LevelCardConfig, el: HTMLElement) => {
    if (!isLevelUnlocked(lvl.id)) {
      // Replay the shake by reflowing — re-adding the class on an already-
      // shaking element wouldn't restart the animation otherwise.
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
      return;
    }
    navigate(`/campaign/inside/${lvl.phase}`);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{STYLE_CSS}</style>

      <div className="campaign-bg">
        <div className="grid" />
        <div className="scanline" />
      </div>

      <div
        className="campaign-root"
        style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.4s ease' }}
      >
        <Header userXP={userXP} onExit={() => navigate('/home')} />

        <main className="campaign-main">
          <HeroBanner />

          <div className="level-grid">
            {LEVELS.map((level, i) => {
              const db = levelInfo[level.phase];
              const color = db?.accent_color ?? level.color;
              const merged: LevelCardConfig = {
                ...level,
                subtitle:  db?.title        ?? level.subtitle,
                blurb:     db?.description  ?? level.blurb,
                color,
                glowColor: db?.accent_color ? hexToRgba(color, 0.35) : level.glowColor,
              };
              return (
                <LevelCard
                  key={level.id}
                  config={merged}
                  index={i}
                  status={statusFor(level)}
                  progress={progress[level.phase]}
                  onClick={(el) => handleLevelClick(level, el)}
                />
              );
            })}
          </div>
        </main>
      </div>
    </>
  );
};

// ─── Header ────────────────────────────────────────────────────────────────
const Header: React.FC<{ userXP: number; onExit: () => void }> = ({ userXP, onExit }) => (
  <div className="campaign-header">
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 18 }}>🎯</span>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 15, letterSpacing: '-0.3px' }}>
        CodeSense Journey
      </span>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div className="xp-pill">
        <span style={{ fontSize: 12 }}>⚡</span>
        <span>{userXP.toLocaleString()} XP</span>
      </div>
      <button className="exit-btn" onClick={onExit}>← EXIT</button>
    </div>
  </div>
);

// ─── Hero banner ───────────────────────────────────────────────────────────
const HeroBanner: React.FC = () => (
  <div className="hero">
    <div className="hero-grid-overlay" />
    <div className="hero-glow" />
    <div className="hero-text">
      <div className="hero-eyebrow">Choose Your Path</div>
      <h1 className="hero-title">Three levels.</h1>
      <h1 className="hero-title hero-title--accent">One programmer.</h1>
    </div>
  </div>
);

// ─── Level card ────────────────────────────────────────────────────────────
const LevelCard: React.FC<{
  config:   LevelCardConfig;
  index:    number;
  status:   LevelStatus;
  progress: PhaseProgress;
  onClick:  (el: HTMLElement) => void;
}> = ({ config, index, status, progress, onClick }) => {
  const unlocked = status !== 'locked';
  const accent   = status === 'complete' ? '#3fb950' : config.color;

  // ── Hover tilt: soft 3D effect on unlocked cards (resets on leave) ──────
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!unlocked) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const rx = ((y / rect.height) - 0.5) * -6;
    const ry = ((x / rect.width)  - 0.5) *  6;
    e.currentTarget.style.transform =
      `perspective(800px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(0)`;
  };
  const resetTilt = (e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.transform = '';
  };

  const badge: Record<LevelStatus, { label: string; bg: string; fg: string }> = {
    locked:        { label: '🔒 LOCKED',     bg: 'rgba(72,79,88,0.18)',  fg: '#6e7681' },
    next:          { label: '▶ NEXT UP',     bg: `${accent}26`,          fg: accent     },
    'in-progress': { label: '◐ IN PROGRESS', bg: `${accent}22`,          fg: accent     },
    complete:      { label: '✓ COMPLETE',    bg: 'rgba(63,185,80,0.18)', fg: '#3fb950' },
  };

  const cta: Record<LevelStatus, string> = {
    locked:        `Finish Level ${config.id - 1} to unlock`,
    next:          progress.finished === 0 ? `Begin Level ${config.id} →` : `Continue Level ${config.id} →`,
    'in-progress': `Continue Level ${config.id} →`,
    complete:      'Replay quests',
  };

  return (
    <div
      className={`level-card status-${status}`}
      style={{
        // CSS variable lets the keyframes / hover effects pick up the level's
        // accent without prop-drilling colors into every selector.
        ['--accent' as any]: accent,
        ['--glow' as any]:   config.glowColor,
        animationDelay: `${index * 80}ms`,
      }}
      onClick={(e) => onClick(e.currentTarget)}
      onMouseMove={handleMouseMove}
      onMouseLeave={resetTilt}
      role="button"
      aria-disabled={!unlocked}
      aria-label={`${config.title} — ${config.subtitle}, ${badge[status].label.replace(/^[^\w]+/, '').trim()}`}
    >
      {/* Top accent stripe */}
      <div className="level-card-accent" />

      {/* Status badge */}
      <div className="level-card-badge" style={{ background: badge[status].bg, color: badge[status].fg }}>
        {badge[status].label}
      </div>

      {/* Header row: title + icon */}
      <div className="level-card-head">
        <div>
          <div className="level-card-title">
            <span className="level-card-arrow">▶</span>
            {config.title}
          </div>
          <div className="level-card-subtitle">{config.subtitle}</div>
          <div className="level-card-blurb">{config.blurb}</div>
        </div>
        <div className="level-card-icon-slot" aria-hidden>{unlocked ? config.icon : '🔒'}</div>
      </div>

      {/* Footer: quest count + CTA */}
      <div className="level-card-foot">
        <div className="level-card-quest-count">
          {progress.total > 0 ? (
            <>
              <span className="level-card-icon-mini" aria-hidden>{unlocked ? config.icon : '🔒'}</span>
              <span>
                <strong>{progress.finished}</strong>
                <span style={{ color: '#6e7681' }}> / {progress.total}</span> quests
              </span>
            </>
          ) : (
            <span style={{ color: '#6e7681' }}>Loading quests…</span>
          )}
        </div>
        <div className="level-card-cta" style={{ color: unlocked ? accent : '#6e7681' }}>
          {cta[status]}
        </div>
      </div>
    </div>
  );
};

// ─── Page styles (kept inline so the page is self-contained) ──────────────
const STYLE_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');

  @keyframes scanline    { 0% { transform: translateY(-100%); } 100% { transform: translateY(100vh); } }
  @keyframes drift       { 0% { transform: translate(0,0) scale(1); } 33% { transform: translate(12px,-8px) scale(1.04); } 66% { transform: translate(-8px,12px) scale(0.97); } 100% { transform: translate(0,0) scale(1); } }
  @keyframes card-in     { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes lock-shake  { 0%,100% { transform: translateX(0); } 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(4px); } }
  @keyframes pulse-glow  {
    0%,100% { box-shadow: 0 4px 16px rgba(0,0,0,0.35), 0 0 0 0 var(--glow); }
    50%     { box-shadow: 0 4px 16px rgba(0,0,0,0.35), 0 0 0 10px transparent; }
  }

  /* ── Layout ───────────────────────────────────────────────────────────── */
  .campaign-root {
    position: relative; z-index: 1; min-height: 100vh; width: 100%;
    background: transparent; font-family: 'IBM Plex Sans', system-ui, sans-serif;
    color: #e6edf3; overflow-x: hidden;
  }
  .campaign-bg {
    position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden;
    background: #080b10;
  }
  .campaign-bg .grid {
    position: absolute; inset: 0; opacity: 0.2;
    background-image:
      linear-gradient(rgba(227,179,65,0.5) 1px, transparent 1px),
      linear-gradient(90deg, rgba(227,179,65,0.5) 1px, transparent 1px);
    background-size: 50px 50px; animation: drift 20s ease-in-out infinite;
  }
  .campaign-bg .scanline {
    position: absolute; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, transparent, rgba(227,179,65,0.18), transparent);
    animation: scanline 6s linear infinite;
  }
  .campaign-main {
    max-width: 1400px; margin: 0 auto;
    padding: 28px clamp(16px, 4vw, 48px) 60px;
  }

  /* ── Header ──────────────────────────────────────────────────────────── */
  .campaign-header {
    height: 58px; background: rgba(8,11,16,0.65); backdrop-filter: blur(12px);
    border-bottom: 1px solid #2d333b;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 24px; position: sticky; top: 0; z-index: 100;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  }
  .xp-pill {
    display: flex; align-items: center; gap: 8px;
    background: rgba(63,185,80,0.1); border: 1px solid rgba(63,185,80,0.25);
    border-radius: 8px; padding: 5px 12px;
    font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #3fb950; font-weight: 700;
  }
  .exit-btn {
    background: transparent; border: 1px solid #444c56; color: #8b949e;
    padding: 7px 14px; border-radius: 6px; font-weight: 600; font-size: 11px;
    letter-spacing: 0.5px; cursor: pointer;
    font-family: 'IBM Plex Mono', monospace; transition: color 0.15s, border-color 0.15s;
  }
  .exit-btn:hover { border-color: #f85149; color: #f85149; }

  /* ── Hero banner ─────────────────────────────────────────────────────── */
  .hero {
    position: relative; border-radius: 16px; overflow: hidden;
    margin-bottom: 28px; padding: 28px clamp(20px, 3vw, 36px);
    display: flex; align-items: center;
    background: linear-gradient(135deg, #1a1500 0%, #241c00 50%, #0d1117 100%);
    border: 1px solid rgba(227,179,65,0.2);
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    min-height: 140px;
  }
  .hero-grid-overlay {
    position: absolute; inset: 0; opacity: 0.1; pointer-events: none;
    background-image:
      linear-gradient(rgba(227,179,65,0.6) 1px, transparent 1px),
      linear-gradient(90deg, rgba(227,179,65,0.6) 1px, transparent 1px);
    background-size: 40px 40px;
  }
  .hero-glow {
    position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(circle at 28% 50%, rgba(227,179,65,0.1), transparent 60%);
  }
  .hero-text { position: relative; z-index: 1; min-width: 0; }
  .hero-eyebrow {
    font-size: 11px; color: #e3b341; font-family: 'IBM Plex Mono', monospace;
    font-weight: 700; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 12px;
  }
  .hero-title {
    font-size: clamp(24px, 3vw, 32px); font-weight: 800; color: #f0f6fc;
    letter-spacing: -0.8px; line-height: 1.1; margin: 0;
  }
  .hero-title--accent { color: #e3b341; font-style: italic; margin-top: 4px; }

  /* ── Level grid ──────────────────────────────────────────────────────── */
  .level-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 20px;
  }

  /* ── Level card ──────────────────────────────────────────────────────── */
  .level-card {
    --accent: #3fb950;
    --glow:   rgba(63,185,80,0.35);
    position: relative; border-radius: 16px; padding: 22px 22px 18px;
    background: linear-gradient(160deg, #161b22 0%, #1c2128 100%);
    border: 1px solid #21262d;
    cursor: pointer; overflow: hidden;
    min-height: 220px;
    display: flex; flex-direction: column; justify-content: space-between;
    transform-style: preserve-3d;
    transition: transform 0.18s ease, box-shadow 0.25s ease, border-color 0.25s ease;
    box-shadow: 0 4px 16px rgba(0,0,0,0.35);
    animation: card-in 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  .level-card.status-locked {
    cursor: not-allowed; opacity: 0.55;
    background: #0d1117; border-color: #21262d;
  }
  .level-card.status-next {
    border-color: var(--accent);
    animation: card-in 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both,
               pulse-glow 2.6s ease-in-out 0.6s infinite;
  }
  .level-card:not(.status-locked):hover {
    border-color: color-mix(in srgb, var(--accent) 60%, transparent);
    box-shadow: 0 12px 40px var(--glow), inset 0 0 24px rgba(255,255,255,0.02);
  }
  .level-card.shake { animation: lock-shake 0.42s ease; }

  .level-card-accent {
    position: absolute; top: 0; left: 18px; right: 18px; height: 2px;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    border-radius: 0 0 2px 2px;
    opacity: 0; transition: opacity 0.25s;
  }
  .level-card:not(.status-locked) .level-card-accent { opacity: 0.85; }

  .level-card-badge {
    position: absolute; top: 12px; right: 12px;
    border-radius: 6px; padding: 3px 8px; font-size: 10px; font-weight: 700;
    letter-spacing: 0.6px; font-family: 'IBM Plex Mono', monospace;
    border: 1px solid currentColor;
  }

  .level-card-head {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 14px; margin-top: 18px;
  }
  .level-card-title {
    display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 700; font-size: 16px; letter-spacing: 0.3px;
    color: #e6edf3;
  }
  .level-card.status-locked .level-card-title { color: #484f58; }
  .level-card-arrow { color: var(--accent); font-size: 13px; }
  .level-card.status-locked .level-card-arrow { color: #3d444d; }
  .level-card-subtitle {
    font-size: 13px; color: #8b949e; margin-left: 21px;
  }
  .level-card-blurb {
    font-size: 11px; color: #6e7681; margin-left: 21px; margin-top: 8px; line-height: 1.5;
    max-width: 240px;
  }
  .level-card-icon-slot {
    width: 56px; height: 56px; border-radius: 14px;
    display: flex; align-items: center; justify-content: center;
    font-size: 26px; flex-shrink: 0;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .level-card:not(.status-locked):hover .level-card-icon-slot {
    transform: rotate(-6deg) scale(1.1);
  }
  .level-card.status-locked .level-card-icon-slot {
    background: rgba(255,255,255,0.02); border-color: #21262d;
  }

  .level-card-foot {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; margin-top: 18px; padding-top: 14px;
    border-top: 1px solid rgba(255,255,255,0.04);
  }
  .level-card-quest-count {
    display: flex; align-items: center; gap: 8px;
    font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #8b949e;
  }
  .level-card-quest-count strong { color: var(--accent); font-weight: 700; }
  .level-card-icon-mini {
    width: 22px; height: 22px; border-radius: 6px; font-size: 12px;
    display: flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .level-card-cta {
    font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 700;
    letter-spacing: 0.5px;
    transition: transform 0.2s ease;
  }
  .level-card:not(.status-locked):hover .level-card-cta { transform: translateX(3px); }

  /* ── Mobile ──────────────────────────────────────────────────────────── */
  @media (max-width: 768px) {
    .campaign-header {
      height: auto !important;
      padding: 12px 16px !important;
      flex-wrap: wrap !important;
      gap: 8px !important;
      min-height: 56px !important;
    }
    .campaign-main {
      padding: 16px 14px 40px !important;
    }
    .hero {
      flex-direction: column !important;
      align-items: flex-start !important;
      padding: 20px 18px !important;
      min-height: 0 !important;
      gap: 10px !important;
    }
    .hero-eyebrow {
      font-size: 10px !important;
      letter-spacing: 2px !important;
      margin-bottom: 8px !important;
    }
    .hero-title {
      font-size: clamp(22px, 6vw, 28px) !important;
    }
    .xp-pill {
      padding: 8px 14px !important;
      font-size: 13px !important;
      min-height: 40px !important;
    }
    .exit-btn {
      padding: 8px 14px !important;
      font-size: 12px !important;
      min-height: 40px !important;
    }
    .level-grid {
      grid-template-columns: 1fr !important;
      gap: 16px !important;
    }
    .level-card {
      padding: 20px 18px 16px !important;
      min-height: 0 !important;
    }
    .level-card-title {
      font-size: 15px !important;
    }
    .level-card-subtitle {
      font-size: 13px !important;
    }
    .level-card-blurb {
      font-size: 12px !important;
      max-width: 100% !important;
    }
    .level-card-icon-slot {
      width: 48px !important;
      height: 48px !important;
      font-size: 22px !important;
    }
    .level-card-foot {
      flex-direction: column !important;
      align-items: flex-start !important;
      gap: 10px !important;
    }
    .level-card-quest-count {
      font-size: 13px !important;
    }
    .level-card-cta {
      font-size: 12px !important;
      word-break: break-word !important;
    }
    .hero-title {
      font-size: clamp(20px, 5vw, 26px) !important;
    }
    .level-card-head {
      gap: 10px !important;
    }
  }
`;

export default CampaignPage;
