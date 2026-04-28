// frontend/src/games/CodeFillGame.tsx
// Fill-in-the-blank style game. Each `code_lines[]` may contain three
// underscores (`___`) which become input boxes left-to-right; their answers
// come from `answers[]` in the same order.

import React, { useEffect } from 'react';
import type { CodeFillItem } from '../types/campaign';

interface Props {
  items:       CodeFillItem[];
  onComplete:  (score: number, total: number) => void;
  resetSignal: number;
}

export const CodeFillGame: React.FC<Props> = ({ items, onComplete, resetSignal }) => {
  const [idx,     setIdx]     = React.useState(0);
  const [answers, setAnswers] = React.useState<string[]>([]);
  const [checked, setChecked] = React.useState(false);
  const [results, setResults] = React.useState<boolean[]>([]);

  const scoreRef = React.useRef(0);

  useEffect(() => {
    if (resetSignal > 0) {
      setIdx(0); setAnswers([]); setChecked(false); setResults([]);
      scoreRef.current = 0;
    }
  }, [resetSignal]);

  if (!items.length) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#484f58', fontSize: 13, fontFamily: 'Inter,sans-serif', textAlign: 'center', padding: 24 }}>
      No code-fill items configured.<br />Add <code>code_fill_items</code> to this quest in the DB.
    </div>
  );

  const item   = items[idx];
  const isLast = idx === items.length - 1;

  const doCheck = () => {
    if (checked) return;
    const res = item.answers.map((a, i) =>
      (answers[i] ?? '').trim().toLowerCase() === a.trim().toLowerCase()
    );
    setResults(res); setChecked(true);
    const allCorrect = res.every(Boolean);
    if (allCorrect) scoreRef.current += 1;
    if (allCorrect && isLast) {
      setTimeout(() => onComplete(scoreRef.current, items.length), 700);
    }
  };

  const doNext = () => {
    if (isLast) { onComplete(scoreRef.current, items.length); return; }
    setIdx(i => i + 1); setAnswers([]); setChecked(false); setResults([]);
  };

  let blankIdx = 0;
  const rendered = item.code_lines.map((line, li) => {
    const parts = line.split('___');
    return (
      <div key={li} style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, lineHeight: 2, whiteSpace: 'pre-wrap' }}>
        {parts.map((part, pi) => (
          <React.Fragment key={pi}>
            <span style={{ color: '#e6edf3' }}>{part}</span>
            {pi < parts.length - 1 && (() => {
              const bi = blankIdx++;
              return (
                <input
                  key={bi}
                  value={answers[bi] ?? ''}
                  onChange={e => { const a = [...answers]; a[bi] = e.target.value; setAnswers(a); }}
                  disabled={checked}
                  placeholder="???"
                  style={{
                    width: 120, padding: '2px 8px', borderRadius: 5,
                    border: `1.5px solid ${!checked ? '#30363d' : results[bi] ? '#238636' : '#da3633'}`,
                    background: !checked ? '#21262d' : results[bi] ? 'rgba(35,134,54,0.12)' : 'rgba(218,54,51,0.12)',
                    color: !checked ? '#e6edf3' : results[bi] ? '#3fb950' : '#f85149',
                    fontFamily: "'JetBrains Mono',monospace", fontSize: 12,
                    outline: 'none', transition: 'all .15s',
                  }}
                />
              );
            })()}
          </React.Fragment>
        ))}
      </div>
    );
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 5, background: '#21262d', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${(idx / items.length) * 100}%`, height: '100%', background: '#58a6ff', transition: 'width .4s ease' }} />
        </div>
        <span style={{ fontSize: 11, color: '#484f58', fontFamily: "'JetBrains Mono',monospace" }}>{idx + 1}/{items.length}</span>
      </div>
      {item.caption && <div style={{ fontSize: 12, color: '#8b949e', fontFamily: 'Inter,sans-serif' }}>{item.caption}</div>}
      <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 10, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Language header — always C++ unless the item explicitly overrides it */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', background: '#161b22', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 5 }}>
            {['#f85149', '#e3b341', '#3fb950'].map(c => (
              <div key={c} style={{ width: 9, height: 9, borderRadius: '50%', background: c }} />
            ))}
          </div>
          <span style={{ fontSize: 10, color: '#8b949e', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '0.8px' }}>
            {item.language ?? 'C++'}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 9, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1px', textTransform: 'uppercase' }}>
            fill in the blanks
          </span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
          {rendered}
        </div>
      </div>
      {item.hint && checked && !results.every(Boolean) && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(88,166,255,0.07)', border: '1px solid rgba(88,166,255,0.2)', fontSize: 12, color: '#8b949e', fontFamily: 'Inter,sans-serif' }}>
          💡 {item.hint}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        {!checked
          ? <button onClick={doCheck} disabled={answers.filter(Boolean).length < item.answers.length} style={{ flex: 1, padding: '11px', borderRadius: 8, border: 'none', background: answers.filter(Boolean).length < item.answers.length ? 'rgba(72,79,88,0.2)' : 'linear-gradient(135deg,#238636,#196127)', color: answers.filter(Boolean).length < item.answers.length ? '#484f58' : '#fff', fontWeight: 700, fontSize: 13, cursor: answers.filter(Boolean).length < item.answers.length ? 'not-allowed' : 'pointer', fontFamily: 'Inter,sans-serif' }}>Check Answers</button>
          : results.every(Boolean)
            ? <button onClick={doNext} style={{ flex: 1, padding: '11px', borderRadius: 8, border: 'none', background: isLast ? '#facc15' : '#238636', color: '#000', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                {isLast ? 'Finish ✓' : 'Next →'}
              </button>
            : <button onClick={() => { setAnswers([]); setChecked(false); setResults([]); }} style={{ flex: 1, padding: '11px', borderRadius: 8, border: '2px solid #da3633', background: 'rgba(218,54,51,0.12)', color: '#f85149', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>Try Again</button>
        }
      </div>
    </div>
  );
};

export default CodeFillGame;
