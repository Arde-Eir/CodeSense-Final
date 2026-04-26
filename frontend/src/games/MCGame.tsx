// frontend/src/games/MCGame.tsx
// Multiple-choice quiz. One question at a time, immediate feedback +
// explanation reveal, advance through all of them.

import React, { useEffect } from 'react';
import type { MCQ } from '../types/campaign';

interface Props {
  questions:   MCQ[];
  onComplete:  (score: number, total: number) => void;
  resetSignal: number;
}

export const MCGame: React.FC<Props> = ({ questions, onComplete, resetSignal }) => {
  const [qIdx,     setQIdx]     = React.useState(0);
  const [selected, setSelected] = React.useState<number | null>(null);
  const [revealed, setRevealed] = React.useState(false);
  const [done,     setDone]     = React.useState(false);
  const scoreRef = React.useRef(0);

  useEffect(() => {
    if (resetSignal > 0) {
      setQIdx(0); setSelected(null); setRevealed(false); setDone(false);
      scoreRef.current = 0;
    }
  }, [resetSignal]);

  if (!questions.length) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#484f58', fontSize: 13, fontFamily: 'Inter,sans-serif', textAlign: 'center', padding: 24 }}>
      No questions configured.<br />Add <code>mc_questions</code> to this quest in the DB.
    </div>
  );

  const q      = questions[qIdx];
  const isLast = qIdx === questions.length - 1;

  const pick = (i: number) => {
    if (revealed) return;
    setSelected(i); setRevealed(true);
    if (i === q.correct) scoreRef.current += 1;
  };

  const next = () => {
    if (isLast) {
      setDone(true);
      setTimeout(() => onComplete(scoreRef.current, questions.length), 400);
      return;
    }
    setQIdx(v => v + 1); setSelected(null); setRevealed(false);
  };

  if (done) return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <div style={{ fontSize: 48 }}>🎓</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#facc15', fontFamily: 'Inter,sans-serif' }}>{scoreRef.current}/{questions.length} correct</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, height: 5, background: '#21262d', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${(qIdx / questions.length) * 100}%`, height: '100%', background: '#a371f7', transition: 'width .4s ease' }} />
        </div>
        <span style={{ fontSize: 11, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>{qIdx + 1}/{questions.length}</span>
      </div>
      <div style={{ background: 'rgba(163,113,247,0.07)', border: '1px solid rgba(163,113,247,0.25)', borderRadius: 10, padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: '#a371f7', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>Q{qIdx + 1}</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#e6edf3', lineHeight: 1.5, fontFamily: 'Inter,sans-serif' }}>{q.question}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        {q.options.map((opt, i) => {
          const isSelected = selected === i, isRight = i === q.correct;
          let bg = '#0d1117', border = '#30363d', color = '#c9d1d9';
          if (revealed) {
            if (isRight)                       { bg = 'rgba(35,134,54,0.1)';  border = '#238636'; color = '#3fb950'; }
            if (isSelected && !isRight)        { bg = 'rgba(218,54,51,0.1)';  border = '#da3633'; color = '#f85149'; }
          } else if (isSelected)               { bg = 'rgba(163,113,247,0.12)'; border = '#a371f7'; color = '#a371f7'; }
          return (
            <button key={i} onClick={() => pick(i)} style={{ padding: '12px 14px', borderRadius: 9, textAlign: 'left', border: `1.5px solid ${border}`, background: bg, color, fontSize: 13, cursor: revealed ? 'default' : 'pointer', transition: 'all .15s', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'Inter,sans-serif', fontWeight: isRight && revealed ? 700 : 400 }}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 800, minWidth: 20, fontSize: 11 }}>{String.fromCharCode(65 + i)}.</span>
              {opt}
              {revealed && isRight  && <span style={{ marginLeft: 'auto' }}>✅</span>}
              {revealed && isSelected && !isRight && <span style={{ marginLeft: 'auto' }}>❌</span>}
            </button>
          );
        })}
      </div>
      {revealed && (
        <>
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid #21262d', fontSize: 12, color: '#8b949e', lineHeight: 1.6, fontFamily: 'Inter,sans-serif' }}>💡 {q.explanation}</div>
          <button onClick={next} style={{ marginTop: 10, padding: '12px', borderRadius: 8, border: 'none', background: isLast ? '#facc15' : '#238636', color: '#000', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
            {isLast ? 'Finish ✓' : 'Next →'}
          </button>
        </>
      )}
    </div>
  );
};

export default MCGame;
