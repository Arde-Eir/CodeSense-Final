// frontend/src/games/OrderingGame.tsx
// Drag rows up/down until their correct_order matches the visual position.

import React from 'react';
import type { OrderItem } from '../types/campaign';

interface Props {
  items:       OrderItem[];
  onComplete:  (score: number, total: number) => void;
  resetSignal: number;
}

const OrderingGameInner: React.FC<{ rawItems: OrderItem[]; onComplete: (score: number, total: number) => void; resetSignal: number; question?: string }> = ({ rawItems, onComplete, resetSignal, question }) => {
  const [shuffleSeed, setShuffleSeed] = React.useState(0);
  const seededShuffle = React.useCallback((items: OrderItem[], seed: number) => {
    if (items.length <= 1) return [...items];
    let s = Math.max(1, seed | 0);
    const nextRand = () => {
      // Linear congruential generator (deterministic, render-safe).
      s = (1664525 * s + 1013904223) >>> 0;
      return s / 0x100000000;
    };
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(nextRand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    // If the result happens to be in the correct order, swap the first two
    // items to guarantee the puzzle is not trivially solved on load.
    const alreadyCorrect = arr.every((item, i) => item.correct_order === i + 1);
    if (alreadyCorrect && arr.length >= 2) {
      [arr[0], arr[1]] = [arr[1], arr[0]];
    }
    return arr;
  }, []);

  const seedBase = React.useMemo(
    () =>
      rawItems.reduce((acc, item) => {
        const id = typeof item.id === 'string' ? item.id : String(item.id);
        for (let i = 0; i < id.length; i++) acc = (acc * 31 + id.charCodeAt(i)) >>> 0;
        return acc;
      }, 17),
    [rawItems],
  );
  const shuffled = React.useMemo(
    () => seededShuffle(rawItems, seedBase + resetSignal + shuffleSeed + rawItems.length),
    [rawItems, seedBase, resetSignal, shuffleSeed, seededShuffle],
  );

  const [order,     setOrder]     = React.useState<OrderItem[]>(shuffled);
  const [dragging,  setDragging]  = React.useState<number | null>(null);
  const [checked,   setChecked]   = React.useState(false);
  const [correct,   setCorrect]   = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);

  const doCheck = () => {
    const isCorrect = order.every((item, i) => item.correct_order === i + 1);
    setChecked(true); setCorrect(isCorrect);
    if (isCorrect) {
      setSubmitted(true);
      setTimeout(() => onComplete(1, 1), 700);
    }
  };

  const handleDragStart = (i: number) => setDragging(i);
  const handleDrop = (i: number) => {
    if (dragging === null || dragging === i || submitted) return;
    const next = [...order];
    [next[dragging], next[i]] = [next[i], next[dragging]];
    setOrder(next); setDragging(null); setChecked(false);
  };

  if (!rawItems.length) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#484f58', fontSize: 13, fontFamily: 'Inter,sans-serif', textAlign: 'center', padding: 24 }}>
      No ordering items configured.<br />Add <code>ordering_items</code> to this quest in the DB.
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ background: 'rgba(163,113,247,0.08)', border: '1px solid rgba(163,113,247,0.25)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#8b949e', fontFamily: 'Inter,sans-serif' }}>
        🔢 {question?.trim() || 'Drag the steps into the correct order'}
      </div>
      {order.map((item, i) => {
        const rowCorrect = checked ? item.correct_order === i + 1 : null;
        return (
        <div key={item.id} draggable={!submitted}
          onDragStart={() => handleDragStart(i)}
          onDragOver={e => e.preventDefault()}
          onDrop={() => handleDrop(i)}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 8, border: `1px solid ${checked ? rowCorrect ? '#238636' : '#da3633' : dragging === i ? '#a371f7' : '#30363d'}`, background: checked ? rowCorrect ? 'rgba(35,134,54,0.07)' : 'rgba(218,54,51,0.07)' : dragging === i ? 'rgba(163,113,247,0.08)' : '#0d1117', cursor: submitted ? 'default' : 'grab', transition: 'all .15s', userSelect: 'none' }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(163,113,247,0.15)', border: '1px solid rgba(163,113,247,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#a371f7', fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>{i + 1}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: '#e6edf3', fontFamily: 'Inter,sans-serif', fontWeight: 600 }}>{item.label}</div>
            {item.description && <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2, fontFamily: 'Inter,sans-serif' }}>{item.description}</div>}
          </div>
          {checked && <span style={{ fontSize: 16 }}>{rowCorrect ? '✅' : '❌'}</span>}
        </div>
        );
      })}
      {checked && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: correct ? 'rgba(35,134,54,0.1)' : 'rgba(218,54,51,0.09)', border: `1px solid ${correct ? 'rgba(35,134,54,0.4)' : 'rgba(218,54,51,0.35)'}`, fontSize: 13, textAlign: 'center', fontFamily: 'Inter,sans-serif', color: correct ? '#3fb950' : '#f85149' }}>
          {correct ? '🎉 Perfect order!' : '❌ Not quite — try rearranging the steps.'}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        {!submitted && <button onClick={() => {
          setShuffleSeed(v => {
            const next = v + 1;
            setOrder(seededShuffle(rawItems, seedBase + resetSignal + next + rawItems.length));
            return next;
          });
          setChecked(false);
        }} style={{ padding: '11px 20px', borderRadius: 8, border: '2px solid #da3633', background: 'rgba(218,54,51,0.12)', color: '#f85149', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>Shuffle</button>}
        {!submitted && <button onClick={doCheck} style={{ flex: 1, padding: '11px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#a371f7,#8350d4)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>Check Order</button>}
      </div>
    </div>
  );
};

interface OrderProblem {
  id: string;
  question?: string;
  items: OrderItem[];
}

function buildOrderProblems(items: OrderItem[]): OrderProblem[] {
  const map = new Map<string, OrderProblem>();
  for (const item of items as Array<OrderItem & { problem_id?: string; question?: string }>) {
    const id = item.problem_id ?? 'default';
    const problem = map.get(id) ?? { id, question: item.question, items: [] };
    if (!problem.question && item.question) problem.question = item.question;
    problem.items.push(item);
    map.set(id, problem);
  }
  return Array.from(map.values()).map(problem => ({
    ...problem,
    items: [...problem.items].sort((a, b) => (a.correct_order ?? 0) - (b.correct_order ?? 0)),
  }));
}

const MultiProblemOrderingGame: React.FC<Props> = ({ items, onComplete, resetSignal }) => {
  const problems = React.useMemo(() => buildOrderProblems(items), [items]);
  const [idx, setIdx] = React.useState(0);
  const scoreRef = React.useRef(0);

  React.useEffect(() => {
    setIdx(0);
    scoreRef.current = 0;
  }, [resetSignal, problems.length]);

  const current = problems[idx];
  if (!current) {
    return <OrderingGameInner rawItems={[]} onComplete={onComplete} resetSignal={resetSignal} />;
  }

  const completeProblem = (score: number) => {
    scoreRef.current += score;
    if (idx >= problems.length - 1) {
      onComplete(scoreRef.current, problems.length);
    } else {
      setIdx(i => i + 1);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {problems.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 5, background: '#21262d', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${(idx / problems.length) * 100}%`, height: '100%', background: '#a371f7', transition: 'width .25s ease' }} />
          </div>
          <span style={{ fontSize: 11, color: '#484f58', fontFamily: "'JetBrains Mono',monospace" }}>
            {idx + 1}/{problems.length}
          </span>
        </div>
      )}
      <OrderingGameInner
        key={`${current.id}-${resetSignal}`}
        rawItems={current.items}
        question={current.question}
        onComplete={completeProblem}
        resetSignal={resetSignal}
      />
    </div>
  );
};

export const OrderingGame: React.FC<Props> = (props) => <MultiProblemOrderingGame {...props} />;

export default OrderingGame;
