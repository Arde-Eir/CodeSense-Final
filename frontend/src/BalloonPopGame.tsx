// src/BalloonPopGame.tsx
// ✅ FIXED:
//   1. Canvas properly sized via ResizeObserver before first draw
//   2. Hit detection uses canvas pixel coords (not %) consistently
//   3. Physics uses canvas pixel coords — no mixed % / px bugs
//   4. loadQuestion stable ref — no infinite loop in useEffect
//   5. Particles use pixel coords throughout
//   6. Correct balloon removed from balloons array only after pop animation
//   7. Game Over / Done overlays work properly
//   8. onComplete called exactly once

import React, { useEffect, useRef, useState, useCallback } from 'react';

export interface MCQ {
  id: string;
  question: string;
  options: string[];
  correct: number;
  explanation: string;
}

interface FloatingBalloon {
  uid: string;
  optionIndex: number;
  label: string;
  x: number;         // px
  y: number;         // px
  vx: number;        // px/s
  vy: number;        // px/s
  rx: number;        // radius x px
  ry: number;        // radius y px
  color: string;
  shineColor: string;
  stringColor: string;
  wobble: number;
  wobbleSpeed: number;
  wobbleAmp: number; // px
  state: 'floating' | 'popped' | 'wrong';
  wrongTimer: number;
  particles: Particle[];
}

interface Particle {
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  color: string;
  life: number; // 0..1
  size: number;
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

function spawnBalloons(options: string[], qIdx: number, W: number, H: number): FloatingBalloon[] {
  const bR = Math.min(W, H) * 0.085;
  return options.map((label, i) => {
    const col   = PALETTE[(i + qIdx * 3) % PALETTE.length];
    const speed = 55 + Math.random() * 35; // px/s
    const angle = Math.PI * (-0.55 + Math.random() * 0.3); // upward mostly
    const count = options.length;
    // spread horizontally
    const xPos  = (W * 0.12) + (i / Math.max(count - 1, 1)) * (W * 0.76) + (Math.random() - 0.5) * 30;
    return {
      uid:         `${qIdx}-${i}-${Math.random()}`,
      optionIndex: i,
      label,
      x:           xPos,
      y:           H * 0.82 + Math.random() * (H * 0.1),
      vx:          Math.cos(angle) * speed * (Math.random() > 0.5 ? 1 : -1),
      vy:          -Math.abs(Math.sin(angle) * speed) - 10,
      rx:          bR * 0.56,
      ry:          bR * 0.67,
      color:       col.body,
      shineColor:  col.shine,
      stringColor: col.string,
      wobble:      Math.random() * Math.PI * 2,
      wobbleSpeed: 1.1 + Math.random() * 0.9,
      wobbleAmp:   6 + Math.random() * 8, // px
      state:       'floating',
      wrongTimer:  0,
      particles:   [],
    };
  });
}

export const BalloonPopGame: React.FC<{
  questions:  MCQ[];
  onComplete: (score: number, total: number) => void;
}> = ({ questions, onComplete }) => {

  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const rafRef       = useRef<number>(0);
  const t0Ref        = useRef<number>(0);
  const completedRef = useRef(false);

  // Stable game state in a ref — avoids stale closure issues
  const gs = useRef({
    balloons:     [] as FloatingBalloon[],
    lives:        TOTAL_LIVES,
    qIdx:         0,
    score:        0,
    phase:        'playing' as 'playing' | 'between' | 'gameover' | 'done',
    betweenTimer: 0,
    explanation:  '',
    correctLabel: '',
    shake:        0,
    W:            0,
    H:            0,
  });

  const [ui, setUi] = useState({
    phase:        'playing' as string,
    lives:        TOTAL_LIVES,
    qIdx:         0,
    score:        0,
    total:        questions.length,
    question:     questions[0]?.question ?? '',
    explanation:  '',
    correctLabel: '',
  });

  const syncUi = useCallback(() => {
    const g = gs.current;
    setUi({
      phase:        g.phase,
      lives:        g.lives,
      qIdx:         g.qIdx,
      score:        g.score,
      total:        questions.length,
      question:     questions[Math.min(g.qIdx, questions.length - 1)]?.question ?? '',
      explanation:  g.explanation,
      correctLabel: g.correctLabel,
    });
  }, [questions]);

  // Spawn balloons using current canvas size
  const loadQuestion = useCallback((idx: number) => {
    const g = gs.current;
    g.balloons = spawnBalloons(
      questions[idx]?.options ?? [],
      idx,
      g.W || canvasRef.current?.offsetWidth  || 400,
      g.H || canvasRef.current?.offsetHeight || 400,
    );
    g.phase = 'playing';
  }, [questions]);

  // ── Click / touch hit test ─────────────────────────────────────────────────
  const hit = useCallback((clientX: number, clientY: number) => {
    const g      = gs.current;
    if (g.phase !== 'playing') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    // Map to logical (CSS) pixels
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const q  = questions[g.qIdx];
    if (!q) return;

    for (const b of g.balloons) {
      if (b.state !== 'floating') continue;
      const wx = b.x + b.wobbleAmp * Math.sin(b.wobble);
      // Ellipse hit test
      const dx = (mx - wx) / b.rx;
      const dy = (my - b.y)  / b.ry;
      if (dx * dx + dy * dy < 1.0) {
        if (b.optionIndex === q.correct) {
          // ✅ Correct
          b.state      = 'popped';
          // Confetti burst (pixel coords)
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
          g.score++;
          g.explanation  = q.explanation;
          g.correctLabel = b.label;
          g.phase        = 'between';
          g.betweenTimer = 2.6;
          // Hide other balloons
          g.balloons.forEach(ob => { if (ob.uid !== b.uid && ob.state === 'floating') ob.state = 'popped'; });
        } else {
          // ❌ Wrong
          b.state      = 'wrong';
          b.wrongTimer = 0.8;
          g.lives      = Math.max(0, g.lives - 1);
          g.shake      = 18;
          if (g.lives === 0) { g.phase = 'gameover'; }
        }
        syncUi();
        return;
      }
    }
  }, [questions, syncUi]);

  const onClick      = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => hit(e.clientX, e.clientY), [hit]);
  const onTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const t = e.touches[0];
    if (t) hit(t.clientX, t.clientY);
  }, [hit]);

  // ── Main render loop ───────────────────────────────────────────────────────
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
    };

    // Wait one frame so layout is settled
    requestAnimationFrame(() => {
      updateSize();
      loadQuestion(0);
      syncUi();
    });

    const ro = new ResizeObserver(() => {
      updateSize();
      // Re-spawn if size changed dramatically
    });
    ro.observe(canvas);

    const draw = (now: number) => {
      const dt = Math.min((now - t0Ref.current) / 1000, 0.05);
      t0Ref.current = now;
      const g  = gs.current;
      const W  = g.W || canvas.offsetWidth;
      const H  = g.H || canvas.offsetHeight;
      const bR = Math.min(W, H) * 0.085;

      ctx.clearRect(0, 0, W, H);

      // Background
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0d1117');
      bg.addColorStop(1, '#080c12');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Dot grid
      ctx.fillStyle = 'rgba(33,38,45,0.9)';
      for (let gx = 24; gx < W; gx += 24)
        for (let gy = 24; gy < H; gy += 24) {
          ctx.beginPath(); ctx.arc(gx, gy, 0.9, 0, Math.PI * 2); ctx.fill();
        }

      // Screen shake
      let didSave = false;
      if (g.shake > 0) {
        const t = g.shake / 18;
        ctx.save(); didSave = true;
        ctx.translate((Math.random() - 0.5) * 9 * t, (Math.random() - 0.5) * 6 * t);
        g.shake--;
      }

      // Between timer → advance question
      if (g.phase === 'between') {
        g.betweenTimer -= dt;
        if (g.betweenTimer <= 0) {
          const next = g.qIdx + 1;
          if (next >= questions.length) {
            g.phase = 'done';
            syncUi();
            if (!completedRef.current) {
              completedRef.current = true;
              setTimeout(() => onComplete(g.score, questions.length), 400);
            }
          } else {
            g.qIdx = next;
            g.explanation  = '';
            g.correctLabel = '';
            loadQuestion(next);
            syncUi();
          }
        }
      }

      // Update + draw all balloons
      for (const b of g.balloons) {

        // Draw + animate particles
        b.particles.forEach(p => {
          p.x  += p.vx * dt;
          p.y  += p.vy * dt;
          p.vy += 200 * dt; // gravity
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

        // Wrong flash timer
        if (b.state === 'wrong') {
          b.wrongTimer -= dt;
          if (b.wrongTimer <= 0) b.state = 'floating';
        }

        // Physics
        if (b.state === 'floating') {
          b.wobble += b.wobbleSpeed * dt;
          b.x      += b.vx * dt;
          b.y      += b.vy * dt;

          // Walls — bounce with damping
          const minX = b.rx + 4, maxX = W - b.rx - 4;
          const minY = b.ry + 4, maxY = H - b.ry - 4;
          if (b.x < minX)  { b.x  = minX;  b.vx =  Math.abs(b.vx) * 0.7; }
          if (b.x > maxX)  { b.x  = maxX;  b.vx = -Math.abs(b.vx) * 0.7; }
          if (b.y < minY)  { b.y  = minY;  b.vy =  Math.abs(b.vy) * 0.65; }
          if (b.y > maxY)  { b.y  = maxY;  b.vy = -Math.abs(b.vy) * 0.75; }
        }

        // Draw balloon
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

        // String
        ctx.strokeStyle = isWrong ? '#991b1b' : b.stringColor;
        ctx.lineWidth   = 1.3;
        ctx.beginPath();
        ctx.moveTo(0, b.ry * 0.82);
        ctx.quadraticCurveTo(b.rx * 0.3, b.ry * 1.3, 0, b.ry * 0.82 + bR * 1.0);
        ctx.stroke();

        // Balloon body (ellipse)
        const grad = ctx.createRadialGradient(-b.rx * 0.28, -b.ry * 0.22, b.rx * 0.04, 0, 0, Math.max(b.rx, b.ry) * 0.9);
        grad.addColorStop(0,    isWrong ? '#ff9090' : b.shineColor);
        grad.addColorStop(0.38, isWrong ? '#da3633' : b.color);
        grad.addColorStop(1,    (isWrong ? '#991b1b' : b.color) + '88');
        ctx.beginPath();
        ctx.ellipse(0, 0, b.rx, b.ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // Knot
        ctx.beginPath();
        ctx.arc(0, b.ry * 0.82, b.rx * 0.1, 0, Math.PI * 2);
        ctx.fillStyle = isWrong ? '#da3633' : b.color;
        ctx.fill();

        // Label text
        const fz = Math.max(9, Math.min(13, bR * 0.26));
        ctx.font         = `700 ${fz}px 'JetBrains Mono', monospace`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor  = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur   = 6;
        ctx.fillStyle    = isWrong ? '#fca5a5' : '#fff';

        const maxTW = b.rx * 1.72;
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

        // ✕ on wrong
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
  }, []); // ← run once; game state managed via gs ref

  const restart = useCallback(() => {
    completedRef.current = false;
    Object.assign(gs.current, {
      lives: TOTAL_LIVES, qIdx: 0, score: 0,
      phase: 'playing', explanation: '', correctLabel: '', shake: 0,
    });
    loadQuestion(0);
    syncUi();
  }, [loadQuestion, syncUi]);

  if (!questions.length) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#484f58', fontSize: 13, fontFamily: "'JetBrains Mono',monospace" }}>
      No questions configured for this balloon game.
    </div>
  );

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 420, borderRadius: 12, overflow: 'hidden', userSelect: 'none' }}>

      <canvas
        ref={canvasRef}
        onClick={onClick}
        onTouchStart={onTouchStart}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: ui.phase === 'playing' ? 'crosshair' : 'default', touchAction: 'none', display: 'block' }}
      />

      {/* HUD */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '10px 16px', background: 'linear-gradient(to bottom, rgba(13,17,23,0.97) 55%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', pointerEvents: 'none', zIndex: 10 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {Array.from({ length: TOTAL_LIVES }).map((_, i) => (
            <span key={i} style={{ fontSize: 20, transition: 'filter .3s,transform .3s', filter: i < ui.lives ? 'none' : 'grayscale(1) opacity(.2)', transform: i < ui.lives ? 'scale(1)' : 'scale(.75)' }}>🎈</span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          {Array.from({ length: ui.total }).map((_, i) => (
            <div key={i} style={{ width: i === ui.qIdx ? 16 : 7, height: 7, borderRadius: 4, background: i < ui.qIdx ? '#3fb950' : i === ui.qIdx ? '#facc15' : '#21262d', transition: 'all .3s' }} />
          ))}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 700, color: '#facc15' }}>
          {ui.score}<span style={{ color: '#484f58', fontWeight: 400 }}>/{ui.total}</span>
        </div>
      </div>

      {/* Prompt */}
      {(ui.phase === 'playing' || ui.phase === 'between') && (
        <div style={{ position: 'absolute', top: 52, left: '50%', transform: 'translateX(-50%)', background: 'rgba(22,27,34,0.95)', border: '1px solid rgba(88,166,255,0.28)', borderRadius: 12, padding: '11px 22px', maxWidth: '72%', minWidth: 240, textAlign: 'center', zIndex: 10, pointerEvents: 'none', backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px rgba(0,0,0,.5)' }}>
          <div style={{ fontSize: 9, color: '#58a6ff', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 5 }}>🎈 POP THE CORRECT BALLOON</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3', lineHeight: 1.5, fontFamily: 'Inter,sans-serif' }}>{ui.question}</div>
        </div>
      )}

      {/* Explanation toast after correct pop */}
      {ui.phase === 'between' && ui.explanation && (
        <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: 'rgba(13,22,13,0.97)', border: '1px solid rgba(63,185,80,.4)', borderRadius: 12, padding: '13px 22px', maxWidth: '76%', minWidth: 240, textAlign: 'center', zIndex: 10, pointerEvents: 'none', backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px rgba(0,0,0,.5)', animation: 'bpopUp .35s cubic-bezier(.34,1.56,.64,1)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#3fb950', marginBottom: 5, fontFamily: "'JetBrains Mono',monospace" }}>✅ {ui.correctLabel}</div>
          <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.65, fontFamily: 'Inter,sans-serif' }}>💡 {ui.explanation}</div>
        </div>
      )}

      {/* Red vignette when lives lost */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5, borderRadius: 12, boxShadow: ui.lives < TOTAL_LIVES && ui.phase === 'playing' ? 'inset 0 0 70px rgba(248,81,73,.45)' : 'none', transition: 'box-shadow .6s ease' }} />

      {/* Game Over */}
      {ui.phase === 'gameover' && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(13,17,23,0.94)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, backdropFilter: 'blur(8px)', animation: 'bfadeIn .4s ease' }}>
          <div style={{ fontSize: 58 }}>💥</div>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 22, fontWeight: 900, color: '#f85149' }}>All lives lost!</div>
          <div style={{ fontSize: 13, color: '#8b949e', fontFamily: "'JetBrains Mono',monospace" }}>{ui.score} / {ui.total} correct before game over</div>
          <button onClick={restart} style={{ marginTop: 6, padding: '12px 36px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#da3633,#b91c1c)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace", boxShadow: '0 4px 20px rgba(218,54,51,.45)', letterSpacing: '.5px' }}>
            TRY AGAIN ↺
          </button>
        </div>
      )}

      {/* Done */}
      {ui.phase === 'done' && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(13,17,23,0.94)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, backdropFilter: 'blur(8px)', animation: 'bfadeIn .4s ease' }}>
          <div style={{ fontSize: 60 }}>🎊</div>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 24, fontWeight: 900, color: '#facc15' }}>All done!</div>
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