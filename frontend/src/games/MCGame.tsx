import React from 'react';
import type { MCQ } from '@/types/campaign';
import { normalizeMCQList } from './normalizeMCQ';

interface Props {
  questions:   MCQ[];
  onComplete:  (score: number, total: number) => void;
  resetSignal: number;
  /** Reports the active question for the side-panel hint. */
  onItemChange?: (index: number) => void;
}

const MCGameInner: React.FC<{ questions: MCQ[]; onComplete: (score: number, total: number) => void; onItemChange?: (index: number) => void }> = ({ questions, onComplete, onItemChange }) => {
  const [qIdx,     setQIdx]     = React.useState(0);
  const [finalScore, setFinalScore] = React.useState(0);

  React.useEffect(() => { onItemChange?.(qIdx); }, [qIdx, onItemChange]);

  const [selected, setSelected] = React.useState<number | null>(null);
  const [revealed, setRevealed] = React.useState(false);
  const [done,     setDone]     = React.useState(false);
  // The ref keeps the final score available before React commits the state update.
  const scoreRef = React.useRef(0);
  const completionTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => {
    if (completionTimer.current !== null) clearTimeout(completionTimer.current);
  }, []);

  const retry = () => {
    setQIdx(0);
    setFinalScore(0);
    setSelected(null);
    setRevealed(false);
    setDone(false);
    scoreRef.current = 0;
  };

  if (!questions.length) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#484f58', fontSize: 13, fontFamily: 'Inter,sans-serif', textAlign: 'center', padding: 24 }}>
      No questions configured.<br />Add <code>mc_questions</code> to this quest in the DB.
    </div>
  );

  // Completion can advance qIdx past the last question.
  if (done) return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <div style={{ fontSize: 48 }}>🎓</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#facc15', fontFamily: 'Inter,sans-serif' }}>
        {finalScore}/{questions.length} correct
      </div>
      <div style={{ fontSize: 13, color: '#8b949e', fontFamily: 'Inter,sans-serif' }}>
        {finalScore === questions.length
          ? '🏆 Perfect score!'
          : finalScore === 0
            ? 'Better luck next time.'
            : `${Math.round((finalScore / questions.length) * 100)}% accuracy`}
      </div>
      {finalScore < questions.length && (
        <button data-testid="mc-retry" onClick={retry} style={{ padding: '12px 24px', borderRadius: 8, border: 'none', background: '#a371f7', color: '#fff', fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
          Try Again ↺
        </button>
      )}
    </div>
  );

  const q      = questions[qIdx];
  const isLast = qIdx === questions.length - 1;

  const pick = (i: number) => {
    if (revealed) return;
    setSelected(i);
    setRevealed(true);
    if (i === q.correct) {
      scoreRef.current += 1;
    }
  };

  const next = () => {
    if (isLast) {
      const score = scoreRef.current;
      setFinalScore(score);
      setDone(true);
      if (score === questions.length) {
        // Small delay lets the "Finish" button feedback register visually.
        completionTimer.current = setTimeout(() => {
          completionTimer.current = null;
          onComplete(score, questions.length);
        }, 400);
      }
      return;
    }
    setQIdx(v => v + 1);
    setSelected(null);
    setRevealed(false);
  };

  const progressPct = revealed && isLast
    ? 100
    : ((qIdx + (revealed ? 1 : 0)) / questions.length) * 100;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, height: 5, background: '#21262d', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${progressPct}%`, height: '100%', background: '#a371f7', transition: 'width .4s ease' }} />
        </div>
        <span style={{ fontSize: 11, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>
          {qIdx + 1}/{questions.length}
        </span>
      </div>

      <div style={{ background: 'rgba(163,113,247,0.07)', border: '1px solid rgba(163,113,247,0.25)', borderRadius: 10, padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: '#a371f7', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>
          Q{qIdx + 1}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#e6edf3', lineHeight: 1.5, fontFamily: 'Inter,sans-serif' }}>
          {q.question}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {q.options.map((opt, i) => {
          const isSelected = selected === i;
          const isRight    = i === q.correct;
          const wasWrong   = revealed && isSelected && !isRight;
          const isCorrectReveal = revealed && isRight;

          let bg     = '#0d1117';
          let border = '#30363d';
          let color  = '#c9d1d9';
          if (revealed) {
            if (isCorrectReveal) { bg = 'rgba(35,134,54,0.1)';    border = '#238636'; color = '#3fb950'; }
            if (wasWrong)        { bg = 'rgba(218,54,51,0.1)';    border = '#da3633'; color = '#f85149'; }
          } else if (isSelected) { bg = 'rgba(163,113,247,0.12)'; border = '#a371f7'; color = '#a371f7'; }

          const icon = revealed
            ? isRight && isSelected  ? '✅'
            : isRight && !isSelected ? '💡'
            : wasWrong               ? '❌'
            : null
            : null;

          return (
            <button
              key={i}
              data-testid={`mc-option-${i}`}
              onClick={() => pick(i)}
              disabled={revealed}
              style={{
                padding: '12px 14px', borderRadius: 9, textAlign: 'left',
                border: `1.5px solid ${border}`, background: bg, color,
                fontSize: 13,
                cursor: revealed ? 'default' : 'pointer',
                transition: 'all .15s',
                display: 'flex', alignItems: 'center', gap: 10,
                fontFamily: 'Inter,sans-serif',
                fontWeight: isCorrectReveal ? 700 : 400,
                // Keep a consistent height so options don't shift when icons appear
                minHeight: 44,
              }}
            >
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 800, minWidth: 20, fontSize: 11, flexShrink: 0 }}>
                {String.fromCharCode(65 + i)}.
              </span>
              <span style={{ flex: 1 }}>{opt}</span>
              {icon && <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 15 }}>{icon}</span>}
            </button>
          );
        })}
      </div>

      {revealed && (
        <>
          {q.explanation?.trim() && (
            <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid #21262d', fontSize: 12, color: '#8b949e', lineHeight: 1.6, fontFamily: 'Inter,sans-serif' }}>
              💡 {q.explanation}
            </div>
          )}
          <button
            data-testid={isLast ? 'mc-finish' : 'mc-next'}
            onClick={next}
            style={{ marginTop: 10, padding: '12px', borderRadius: 8, border: 'none', background: isLast ? '#facc15' : '#238636', color: '#000', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}
          >
            {isLast ? 'Finish ✓' : 'Next →'}
          </button>
        </>
      )}
    </div>
  );
};

export const MCGame: React.FC<Props> = ({ questions, onComplete, resetSignal, onItemChange }) => {
  const playableQuestions = React.useMemo(() => normalizeMCQList(questions), [questions]);
  return <MCGameInner key={resetSignal} questions={playableQuestions} onComplete={onComplete} onItemChange={onItemChange} />;
};

export default MCGame;
