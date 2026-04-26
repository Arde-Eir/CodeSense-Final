// frontend/src/games/OrderingGame.tsx
// Drag rows up/down until their correct_order matches the visual position.

import React, { useEffect } from 'react';
import type { OrderItem } from '../types/campaign';

interface Props {
  items:       OrderItem[];
  onComplete:  (score: number, total: number) => void;
  resetSignal: number;
}

export const OrderingGame: React.FC<Props> = ({ items: rawItems, onComplete, resetSignal }) => {
  const shuffled = React.useMemo(
    () => [...rawItems].sort(() => Math.random() - 0.5),
    [rawItems]
  );

  const [order,     setOrder]     = React.useState<OrderItem[]>(shuffled);
  const [dragging,  setDragging]  = React.useState<number | null>(null);
  const [checked,   setChecked]   = React.useState(false);
  const [correct,   setCorrect]   = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);

  useEffect(() => {
    if (resetSignal > 0) {
      setOrder([...rawItems].sort(() => Math.random() - 0.5));
      setChecked(false); setCorrect(false); setSubmitted(false); setDragging(null);
    }
  }, [resetSignal, rawItems]);

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
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 10 }}>
      <div style={{ background: 'rgba(163,113,247,0.08)', border: '1px solid rgba(163,113,247,0.25)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#8b949e', fontFamily: 'Inter,sans-serif' }}>
        🔢 Drag the steps into the correct order
      </div>
      {order.map((item, i) => (
        <div key={item.id} draggable={!submitted}
          onDragStart={() => handleDragStart(i)}
          onDragOver={e => e.preventDefault()}
          onDrop={() => handleDrop(i)}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 8, border: `1px solid ${checked ? correct ? '#238636' : '#da3633' : dragging === i ? '#a371f7' : '#30363d'}`, background: checked ? correct ? 'rgba(35,134,54,0.07)' : 'rgba(218,54,51,0.07)' : dragging === i ? 'rgba(163,113,247,0.08)' : '#0d1117', cursor: submitted ? 'default' : 'grab', transition: 'all .15s', userSelect: 'none' }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(163,113,247,0.15)', border: '1px solid rgba(163,113,247,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#a371f7', fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>{i + 1}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: '#e6edf3', fontFamily: 'Inter,sans-serif', fontWeight: 600 }}>{item.label}</div>
            {item.description && <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2, fontFamily: 'Inter,sans-serif' }}>{item.description}</div>}
          </div>
          {checked && <span style={{ fontSize: 16 }}>{correct ? '✅' : '❌'}</span>}
        </div>
      ))}
      {checked && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: correct ? 'rgba(35,134,54,0.1)' : 'rgba(218,54,51,0.09)', border: `1px solid ${correct ? 'rgba(35,134,54,0.4)' : 'rgba(218,54,51,0.35)'}`, fontSize: 13, textAlign: 'center', fontFamily: 'Inter,sans-serif', color: correct ? '#3fb950' : '#f85149' }}>
          {correct ? '🎉 Perfect order!' : '❌ Not quite — try rearranging the steps.'}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        {!submitted && <button onClick={() => { setOrder([...rawItems].sort(() => Math.random() - 0.5)); setChecked(false); }} style={{ padding: '11px 20px', borderRadius: 8, border: '2px solid #da3633', background: 'rgba(218,54,51,0.12)', color: '#f85149', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>Shuffle</button>}
        {!submitted && <button onClick={doCheck} style={{ flex: 1, padding: '11px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#a371f7,#8350d4)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>Check Order</button>}
      </div>
    </div>
  );
};

export default OrderingGame;
