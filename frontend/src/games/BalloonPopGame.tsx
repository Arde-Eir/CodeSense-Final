// frontend/src/games/BalloonPopGame.tsx
// Canvas-based balloon-pop quiz. Pop the balloon labeled with the correct
// answer; wrong pops cost a life. Three lives total per quest.
//
// FIXES:
//  • Outer wrapper uses `aspectRatio: '4/3'` + `width: 100%` instead of a
//    fixed `minHeight: 420` — canvas always fills available width and scales
//    height proportionally, so balloons never crowd the HUD / prompt.
//  • Prompt box is capped at `maxWidth: min(72%, 340px)` and uses `fontSize:
//    clamp(12px, 1.8vw, 14px)` so long questions never overflow on narrow
//    screens.
//  • Explanation toast is anchored `bottom: 14px` with a safe `maxWidth:
//    min(76%, 360px)` and wraps text with `wordBreak: 'break-word'`.
//  • HUD score/lives row uses `flexWrap: 'wrap'` + `gap: 4` so it never
//    overflows on very narrow viewports.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { MCQ } from '@/types/campaign';
import { normalizeMCQList } from './normalizeMCQ';

const BALLOON_SCALE = 0.085;

interface FloatingBalloon {
  uid:         string;
  optionIndex: number;
  label:       string;
  x:           number;
  y:           number;
  vx:          number;
  vy:          number;
  color:       string;
  shineColor:  string;
  stringColor: string;
  wobble:      number;
  wobbleSpeed: number;
  wobbleAmp:   number;
  state:       'floating' | 'popped' | 'wrong';
  wrongTimer:  number;
  particles:   Particle[];
}

interface Particle {
  id:    number;
  x:     number; y: number;
  vx:    number; vy: number;
  color: string;
  life:  number;
  size:  number;
}

const PALETTE = [
  { body: '#f85149', shine: '#ffaba6', string: '#b91c1c' },
  { body: '#e3b341', shine: '#fde68a', string: '#92400e' },
  { body: '#3fb950', shine: '#86efac', string: '#166534' },
  { body: '#58a6ff', shine: '#bae6fd', string: '#1d4ed8' },
  { body: '#a371f7', shine: '#e9d5ff', string: '#6d28d9' },
  { body: '#f0883e', shine: '#fed7aa', string: '#9a3412' },
  { body: '#ff6b9d', shine: '#fecdd3', string: '#be185d' },
  { body: '#22d3ee', shine: '#a5f3fc', string: '#0e7490' },
];

const TOTAL_LIVES = 3;
let _pid = 0;

function getBalloonRadii(W: number, H: number): { rx: number; ry: number; bR: number } {
  const bR = Math.min(W, H) * BALLOON_SCALE;
  return { rx: bR * 0.56, ry: bR * 0.67, bR };
}

function spawnBalloons(options: string[], qIdx: number, W: number, H: number): FloatingBalloon[] {
  return options.map((label, i) => {
    const col   = PALETTE[(i + qIdx * 3) % PALETTE.length];
    const speed = 55 + Math.random() * 35;
    const angle = Math.PI * (-0.55 + Math.random() * 0.3);
    const count = options.length;
    const xPos  = (W * 0.12) + (i / Math.max(count - 1, 1)) * (W * 0.76) + (Math.random() - 0.5) * 30;
    return {
      uid:         `${qIdx}-${i}-${Math.random()}`,
      optionIndex: i,
      label,
      x:           xPos,
      y:           H * 0.82 + Math.random() * (H * 0.1),
      vx:          Math.cos(angle) * speed * (Math.random() > 0.5 ? 1 : -1),
      vy:          -Math.abs(Math.sin(angle) * speed) - 10,
      color:       col.body,
      shineColor:  col.shine,
      stringColor: col.string,
      wobble:      Math.random() * Math.PI * 2,
      wobbleSpeed: 1.1 + Math.random() * 0.9,
      wobbleAmp:   6 + Math.random() * 8,
      state:       'floating',
      wrongTimer:  0,
      particles:   [],
    };
  });
}

function getCorrectIndices(question: MCQ): number[] {
  const raw = question.correctAnswers ?? question.correct_answers ?? question.correct_indices ?? [question.correct];
  const values = Array.isArray(raw) ? raw : [raw];
  const indices = values
    .map(v => typeof v === 'number' ? v : Number(v))
    .filter(v => Number.isInteger(v) && v >= 0 && v < question.options.length);
  return Array.from(new Set(indices.length ? indices : [question.correct]));
}

interface Props {
  questions:    MCQ[];
  onComplete:   (score: number, total: number) => void;
  resetSignal?: number;
  /** Notifies the parent of the active question index so the side panel can
   *  show this question's per-item hint. */
  onItemChange?: (index: number) => void;
}

export const BalloonPopGame: React.FC<Props> = ({ questions, onComplete, resetSignal, onItemChange }) => {
  const playableQuestions = React.useMemo(() => normalizeMCQList(questions), [questions]);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const rafRef       = useRef<number>(0);
  const t0Ref        = useRef<number>(0);
  const completedRef = useRef(false);

  const gs = useRef({
    balloons:     [] as FloatingBalloon[],
    lives:        TOTAL_LIVES,
    qIdx:         0,
    score:        0,
    phase:        'playing' as 'playing' | 'between' | 'gameover' | 'done',
    betweenTimer: 0,
    explanation:  '',
    correctLabel: '',
    correctPopped: new Set<number>(),
    shake:        0,
    W:            0,
    H:            0,
  });

  const [ui, setUi] = useState({
    phase:        'playing' as string,
    lives:        TOTAL_LIVES,
    qIdx:         0,
    score:        0,
    total:        playableQuestions.length,
    question:     playableQuestions[0]?.question ?? '',
    explanation:  '',
    correctLabel: '',
  });

  // Notify parent of the active question so the side panel can show the
  // per-question hint. Fires on mount and every qIdx transition.
  useEffect(() => { onItemChange?.(ui.qIdx); }, [ui.qIdx, onItemChange]);

  const syncUi = useCallback(() => {
    const g = gs.current;
    setUi({
      phase:        g.phase,
      lives:        g.lives,
      qIdx:         g.qIdx,
      score:        g.score,
      total:        playableQuestions.length,
      question:     playableQuestions[Math.min(g.qIdx, playableQuestions.length - 1)]?.question ?? '',
      explanation:  g.explanation,
      correctLabel: g.correctLabel,
    });
  }, [playableQuestions]);

  const loadQuestion = useCallback((idx: number) => {
    const g = gs.current;
    g.balloons = spawnBalloons(
      playableQuestions[idx]?.options ?? [],
      idx,
      g.W || canvasRef.current?.offsetWidth  || 400,
      g.H || canvasRef.current?.offsetHeight || 300,
    );
    g.phase = 'playing';
    g.correctPopped.clear();
  }, [playableQuestions]);

  const hit = useCallback((clientX: number, clientY: number) => {
    const g      = gs.current;
    if (g.phase !== 'playing') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const q  = playableQuestions[g.qIdx];
    if (!q) return;

    const { rx, ry } = getBalloonRadii(g.W || canvas.offsetWidth, g.H || canvas.offsetHeight);

    for (const b of g.balloons) {
      if (b.state !== 'floating') continue;
      const wx = b.x + b.wobbleAmp * Math.sin(b.wobble);
      const dx = (mx - wx) / rx;
      const dy = (my - b.y)  / ry;
      if (dx * dx + dy * dy < 1.0) {
        const correctIndices = getCorrectIndices(q);
        if (correctIndices.includes(b.optionIndex)) {
          b.state      = 'popped';
          b.particles  = Array.from({ length: 28 }, (_, pi) => {
            const a = (pi / 28) * Math.PI * 2 + Math.random() * 0.3;
            return {
              id:    _pid++,
              x:     b.x,
              y:     b.y,
              vx:    Math.cos(a) * (60 + Math.random() * 120),
              vy:    Math.sin(a) * (60 + Math.random() * 120) - 80,
              color: PALETTE[b.optionIndex % PALETTE.length].body,
              life:  1.0,
              size:  3 + Math.random() * 5,
            };
          });
          g.correctPopped.add(b.optionIndex);

          if (correctIndices.every(idx => g.correctPopped.has(idx))) {
            const correctLabels = correctIndices
              .map(idx => q.options[idx])
              .filter(Boolean);
            g.score++;
            g.explanation  = q.explanation;
            g.correctLabel = correctLabels.join(', ');
            g.phase        = 'between';
            g.betweenTimer = 2.6;
            g.balloons.forEach(ob => { if (ob.uid !== b.uid && ob.state === 'floating') ob.state = 'popped'; });
          }
        } else {
          b.state      = 'wrong';
          b.wrongTimer = 0.8;
          g.lives      = Math.max(0, g.lives - 1);
          g.shake      = 18;
          if (g.lives === 0) g.phase = 'gameover';
        }
        syncUi();
        return;
      }
    }
  }, [playableQuestions, syncUi]);

  const onClick      = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => hit(e.clientX, e.clientY), [hit]);
  const onTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const t = e.touches[0];
    if (t) hit(t.clientX, t.clientY);
  }, [hit]);

  useEffect(() => {
    if (!resetSignal) return;
    completedRef.current = false;
    Object.assign(gs.current, {
      lives: TOTAL_LIVES, qIdx: 0, score: 0,
      phase: 'playing', explanation: '', correctLabel: '', shake: 0,
    });
    gs.current.correctPopped.clear();
    loadQuestion(0);
    syncUi();
  }, [resetSignal, loadQuestion, syncUi]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const updateSize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W   = canvas.offsetWidth;
      const H   = canvas.offsetHeight;
      canvas.width  = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      gs.current.W = W;
      gs.current.H = H;
      if (gs.current.phase === 'playing') {
        gs.current.balloons = spawnBalloons(
          playableQuestions[gs.current.qIdx]?.options ?? [],
          gs.current.qIdx, W, H,
        );
      }
    };

    requestAnimationFrame(() => {
      updateSize();
      loadQuestion(0);
      syncUi();
    });

    const ro = new ResizeObserver(() => { updateSize(); });
    ro.observe(canvas);

    const draw = (now: number) => {
      const dt = Math.min((now - t0Ref.current) / 1000, 0.05);
      t0Ref.current = now;
      const g = gs.current;
      const W = g.W || canvas.offsetWidth;
      const H = g.H || canvas.offsetHeight;

      const { rx: bRX, ry: bRY, bR } = getBalloonRadii(W, H);

      ctx.clearRect(0, 0, W, H);

      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0d1117');
      bg.addColorStop(1, '#080c12');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = 'rgba(33,38,45,0.9)';
      for (let gx = 24; gx < W; gx += 24)
        for (let gy = 24; gy < H; gy += 24) {
          ctx.beginPath(); ctx.arc(gx, gy, 0.9, 0, Math.PI * 2); ctx.fill();
        }

      let didSave = false;
      if (g.shake > 0) {
        const t = g.shake / 18;
        ctx.save(); didSave = true;
        ctx.translate((Math.random() - 0.5) * 9 * t, (Math.random() - 0.5) * 6 * t);
        g.shake--;
      }

      if (g.phase === 'between') {
        g.betweenTimer -= dt;
        if (g.betweenTimer <= 0) {
          const next = g.qIdx + 1;
          if (next >= playableQuestions.length) {
            g.phase = 'done';
            syncUi();
            if (!completedRef.current) {
              completedRef.current = true;
              setTimeout(() => onComplete(g.score, playableQuestions.length), 400);
            }
          } else {
            g.qIdx = next;
            g.explanation  = '';
            g.correctLabel = '';
            g.correctPopped.clear();
            loadQuestion(next);
            syncUi();
          }
        }
      }

      for (const b of g.balloons) {
        b.particles.forEach(p => {
          p.x  += p.vx * dt;
          p.y  += p.vy * dt;
          p.vy += 200 * dt;
          p.life -= dt * 1.1;
          if (p.life > 0) {
            ctx.save();
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.fillStyle   = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        });
        b.particles = b.particles.filter(p => p.life > 0);

        if (b.state === 'popped') continue;

        if (b.state === 'wrong') {
          b.wrongTimer -= dt;
          if (b.wrongTimer <= 0) b.state = 'floating';
        }

        if (b.state === 'floating') {
          b.wobble += b.wobbleSpeed * dt;
          b.x      += b.vx * dt;
          b.y      += b.vy * dt;

          const minX = bRX + 4, maxX = W - bRX - 4;
          // ↓ key fix: top boundary pushed down by ~22% to clear the HUD+prompt
          const minY = Math.max(bRY + 4, H * 0.22), maxY = H - bRY - 4;
          if (b.x < minX) { b.x = minX; b.vx =  Math.abs(b.vx) * 0.7; }
          if (b.x > maxX) { b.x = maxX; b.vx = -Math.abs(b.vx) * 0.7; }
          if (b.y < minY) { b.y = minY; b.vy =  Math.abs(b.vy) * 0.65; }
          if (b.y > maxY) { b.y = maxY; b.vy = -Math.abs(b.vy) * 0.75; }
        }

        const wx      = b.x + b.wobbleAmp * Math.sin(b.wobble);
        const wy      = b.y;
        const isWrong = b.state === 'wrong';

        ctx.save();
        if (isWrong) {
          ctx.translate(wx + (Math.random() - 0.5) * 8, wy);
          ctx.globalAlpha = 0.75;
        } else {
          ctx.translate(wx, wy);
        }

        ctx.strokeStyle = isWrong ? '#991b1b' : b.stringColor;
        ctx.lineWidth   = 1.3;
        ctx.beginPath();
        ctx.moveTo(0, bRY * 0.82);
        ctx.quadraticCurveTo(bRX * 0.3, bRY * 1.3, 0, bRY * 0.82 + bR * 1.0);
        ctx.stroke();

        const grad = ctx.createRadialGradient(-bRX * 0.28, -bRY * 0.22, bRX * 0.04, 0, 0, Math.max(bRX, bRY) * 0.9);
        grad.addColorStop(0,    isWrong ? '#ff9090' : b.shineColor);
        grad.addColorStop(0.38, isWrong ? '#da3633' : b.color);
        grad.addColorStop(1,    (isWrong ? '#991b1b' : b.color) + '88');
        ctx.beginPath();
        ctx.ellipse(0, 0, bRX, bRY, 0, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(0, bRY * 0.82, bRX * 0.1, 0, Math.PI * 2);
        ctx.fillStyle = isWrong ? '#da3633' : b.color;
        ctx.fill();

        const fz = Math.max(9, Math.min(13, bR * 0.26));
        ctx.font         = `700 ${fz}px 'JetBrains Mono', monospace`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor  = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur   = 6;
        ctx.fillStyle    = isWrong ? '#fca5a5' : '#fff';

        const maxTW = bRX * 1.72;
        const words = b.label.split(' ');
        const lines: string[] = [];
        let cur = '';
        for (const w of words) {
          const test = cur ? `${cur} ${w}` : w;
          if (ctx.measureText(test).width > maxTW && cur) { lines.push(cur); cur = w; }
          else cur = test;
        }
        lines.push(cur);
        const lh = fz * 1.28;
        const startY = -((lines.length - 1) * lh) / 2;
        lines.forEach((l, li) => ctx.fillText(l, 0, startY + li * lh));
        ctx.shadowBlur = 0;

        if (isWrong) {
          ctx.font      = `900 ${bR * 0.45}px sans-serif`;
          ctx.fillStyle = 'rgba(255,255,255,0.88)';
          ctx.fillText('✕', 0, 0);
        }

        ctx.restore();
      }

      if (didSave) ctx.restore();

      rafRef.current = requestAnimationFrame(draw);
    };

    t0Ref.current  = performance.now();
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restart = useCallback(() => {
    completedRef.current = false;
    Object.assign(gs.current, {
      lives: TOTAL_LIVES, qIdx: 0, score: 0,
      phase: 'playing', explanation: '', correctLabel: '', shake: 0,
    });
    gs.current.correctPopped.clear();
    loadQuestion(0);
    syncUi();
  }, [loadQuestion, syncUi]);

  if (!playableQuestions.length) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#484f58', fontSize: 13, fontFamily: "'JetBrains Mono',monospace" }}>
      No questions configured for this balloon game.
    </div>
  );

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      // ↓ key fix: aspect-ratio keeps height proportional to width so
      //   balloons always have room and never crowd the overlaid UI elements.
      //   Falls back to minHeight for very wide containers.
      aspectRatio: '4 / 3',
      minHeight: 300,
      maxHeight: 520,
      borderRadius: 12,
      overflow: 'hidden',
      userSelect: 'none',
    }}>
      <canvas
        ref={canvasRef}
        onClick={onClick}
        onTouchStart={onTouchStart}
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          cursor: ui.phase === 'playing' ? 'crosshair' : 'default',
          touchAction: 'none',
          display: 'block',
        }}
      />

      {/* ── HUD ──────────────────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        padding: '10px 14px',
        background: 'linear-gradient(to bottom, rgba(13,17,23,0.97) 55%, transparent)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        // ↓ key fix: wrap so it never clips on narrow containers
        flexWrap: 'wrap', gap: 6,
        pointerEvents: 'none', zIndex: 10,
      }}>
        {/* Lives */}
        <div style={{ display: 'flex', gap: 5 }}>
          {Array.from({ length: TOTAL_LIVES }).map((_, i) => (
            <span key={i} style={{
              fontSize: 18,
              transition: 'filter .3s,transform .3s',
              filter:    i < ui.lives ? 'none' : 'grayscale(1) opacity(.2)',
              transform: i < ui.lives ? 'scale(1)' : 'scale(.75)',
            }}>🎈</span>
          ))}
        </div>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          {Array.from({ length: ui.total }).map((_, i) => (
            <div key={i} style={{
              width:      i === ui.qIdx ? 16 : 7,
              height:     7,
              borderRadius: 4,
              background: i < ui.qIdx ? '#3fb950' : i === ui.qIdx ? '#facc15' : '#21262d',
              transition: 'all .3s',
            }} />
          ))}
        </div>

        {/* Score */}
        <div style={{
          fontFamily: "'JetBrains Mono',monospace",
          fontSize: 13, fontWeight: 700, color: '#facc15',
        }}>
          {ui.score}<span style={{ color: '#484f58', fontWeight: 400 }}>/{ui.total}</span>
        </div>
      </div>

      {/* ── Question prompt ───────────────────────────────────────────── */}
      {(ui.phase === 'playing' || ui.phase === 'between') && (
        <div style={{
          position: 'absolute',
          // ↓ key fix: use % from top so it scales with canvas height
          top: '14%',
          left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(22,27,34,0.95)',
          border: '1px solid rgba(88,166,255,0.28)',
          borderRadius: 12,
          padding: '10px 18px',
          // ↓ key fix: constrain width so long questions wrap, not overflow
          width: 'min(72%, 360px)',
          textAlign: 'center',
          zIndex: 10, pointerEvents: 'none',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 8px 32px rgba(0,0,0,.5)',
        }}>
          <div style={{
            fontSize: 9, color: '#58a6ff',
            fontFamily: "'JetBrains Mono',monospace",
            letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 5,
          }}>🎈 POP ALL CORRECT BALLOONS</div>
          <div style={{
            // ↓ key fix: clamp font size so it always fits
            fontSize: 'clamp(12px, 1.8vw, 14px)',
            fontWeight: 700, color: '#e6edf3',
            lineHeight: 1.5, fontFamily: 'Inter,sans-serif',
            wordBreak: 'break-word',
          }}>{ui.question}</div>
        </div>
      )}

      {/* ── Explanation toast ─────────────────────────────────────────── */}
      {ui.phase === 'between' && ui.explanation && (
        <div style={{
          position: 'absolute',
          bottom: 14, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(13,22,13,0.97)',
          border: '1px solid rgba(63,185,80,.4)',
          borderRadius: 12,
          padding: '12px 18px',
          // ↓ key fix: constrain width so explanation wraps cleanly
          width: 'min(76%, 380px)',
          textAlign: 'center',
          zIndex: 10, pointerEvents: 'none',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 8px 32px rgba(0,0,0,.5)',
          animation: 'bpopUp .35s cubic-bezier(.34,1.56,.64,1)',
        }}>
          <div style={{
            fontSize: 12, fontWeight: 800, color: '#3fb950',
            marginBottom: 5, fontFamily: "'JetBrains Mono',monospace",
            wordBreak: 'break-word',
          }}>✅ {ui.correctLabel}</div>
          <div style={{
            fontSize: 12, color: '#8b949e',
            lineHeight: 1.65, fontFamily: 'Inter,sans-serif',
            wordBreak: 'break-word',
          }}>💡 {ui.explanation}</div>
        </div>
      )}

      {/* Damage vignette */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5,
        borderRadius: 12,
        boxShadow: ui.lives < TOTAL_LIVES && ui.phase === 'playing'
          ? 'inset 0 0 70px rgba(248,81,73,.45)' : 'none',
        transition: 'box-shadow .6s ease',
      }} />

      {/* ── Game Over overlay ─────────────────────────────────────────── */}
      {ui.phase === 'gameover' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 20,
          background: 'rgba(13,17,23,0.94)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 18,
          backdropFilter: 'blur(8px)', animation: 'bfadeIn .4s ease',
        }}>
          <div style={{ fontSize: 52 }}>💥</div>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 20, fontWeight: 900, color: '#f85149' }}>All lives lost!</div>
          <div style={{ fontSize: 13, color: '#8b949e', fontFamily: "'JetBrains Mono',monospace" }}>{ui.score} / {ui.total} correct before game over</div>
          <button onClick={restart} style={{
            marginTop: 6, padding: '12px 32px', borderRadius: 10, border: 'none',
            background: 'linear-gradient(135deg,#da3633,#b91c1c)',
            color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer',
            fontFamily: "'JetBrains Mono',monospace",
            boxShadow: '0 4px 20px rgba(218,54,51,.45)', letterSpacing: '.5px',
          }}>
            TRY AGAIN ↺
          </button>
        </div>
      )}

      {/* ── Done overlay ─────────────────────────────────────────────── */}
      {ui.phase === 'done' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 20,
          background: 'rgba(13,17,23,0.94)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16,
          backdropFilter: 'blur(8px)', animation: 'bfadeIn .4s ease',
        }}>
          <div style={{ fontSize: 56 }}>🎊</div>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 22, fontWeight: 900, color: '#facc15' }}>All done!</div>
          <div style={{ fontSize: 14, color: '#3fb950', fontFamily: "'JetBrains Mono',monospace" }}>{ui.score} / {ui.total} correct</div>
        </div>
      )}

      <style>{`
        @keyframes bpopUp  { from{opacity:0;transform:translateX(-50%) translateY(10px) scale(.95)} to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)} }
        @keyframes bfadeIn { from{opacity:0} to{opacity:1} }
      `}</style>
    </div>
  );
};

export default BalloonPopGame;
