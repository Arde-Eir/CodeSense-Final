// frontend/src/games/DragDropGame.tsx
// Drag a term card into the matching description row. All items must be
// matched correctly to complete. Extracted verbatim from the original
// implementation in lessonactivity.tsx — only the imports changed.

import React from 'react';
import type { GameItem, DropZone } from '../types/campaign';

interface Props {
  items:       GameItem[];
  zones:       DropZone[];
  onComplete:  (score: number, total: number) => void;
  resetSignal: number;
}

const DragDropGameInner: React.FC<{ items: GameItem[]; zones: DropZone[]; onComplete: (score: number, total: number) => void }> = ({ items, zones, onComplete }) => {
  const [dropped,       setDropped]       = React.useState<Record<string, string>>({});
  const [dragOver,      setDragOver]      = React.useState<string | null>(null);
  const [dragging,      setDragging]      = React.useState<string | null>(null);
  const [checked,       setChecked]       = React.useState(false);
  const [results,       setResults]       = React.useState<Record<string, boolean>>({});
  const [submitted,     setSubmitted]     = React.useState(false);
  // Shuffle term cards once on mount so each attempt has a randomized order.
  const [shuffledItems] = React.useState(() => [...items].sort(() => Math.random() - 0.5));

  const usedIds   = new Set(Object.values(dropped));
  const allFilled = Object.keys(dropped).length >= zones.length;

  const doCheck = () => {
    if (submitted) return;
    const r: Record<string, boolean> = {};
    zones.forEach(z => { r[z.id] = dropped[z.id] === z.accepted; });
    setResults(r); setChecked(true);
    const score = Object.values(r).filter(Boolean).length;
    if (score === zones.length) {
      setSubmitted(true);
      setTimeout(() => onComplete(score, zones.length), 700);
    }
  };
  const doReset = () => { if (!submitted) { setDropped({}); setChecked(false); setResults({}); } };

  if (!items.length || !zones.length) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#484f58', fontSize: 13, fontFamily: 'Inter,sans-serif', textAlign: 'center', padding: 24 }}>
      No drag-drop data yet.<br />Add <code>game_items</code> and <code>drop_zones</code> to this quest in the DB.
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ background: 'rgba(56,139,253,0.08)', border: '1px solid rgba(56,139,253,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#8b949e', fontFamily: 'Inter,sans-serif' }}>
        🧩 Drag each term to its matching description
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <div style={{ width: 130, fontSize: 10, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1.5px', textTransform: 'uppercase' }}>TERMS</div>
        <div style={{ flex: 1, fontSize: 10, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1.5px', textTransform: 'uppercase' }}>DESCRIPTIONS</div>
      </div>
      <div style={{ display: 'flex', gap: 14, flex: 1, minHeight: 0, alignItems: 'flex-start' }}>
        <div style={{ width: 130, display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
          {shuffledItems.map(item => {
            const used = usedIds.has(item.id);
            return (
              <div key={item.id} draggable={!used && !submitted}
                onDragStart={() => { if (!used && !submitted) setDragging(item.id); }}
                onDragEnd={() => setDragging(null)}
                style={{ padding: '10px 6px', borderRadius: 7, textAlign: 'center', border: `2px solid ${used ? '#2d333b' : item.color}`, background: used ? 'rgba(255,255,255,0.02)' : `${item.color}18`, color: used ? '#2d333b' : item.color, fontFamily: 'Inter,sans-serif', fontSize: 13, fontWeight: 700, cursor: used || submitted ? 'not-allowed' : 'grab', opacity: used ? 0.3 : dragging === item.id ? 0.4 : 1, userSelect: 'none', transition: 'all .15s' }}>
                {item.label}
              </div>
            );
          })}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {zones.map(zone => {
            const droppedItem = items.find(i => i.id === dropped[zone.id]);
            const isOver  = dragOver === zone.id;
            const correct = results[zone.id];
            let borderColor = '#30363d';
            if (isOver) borderColor = '#388bfd';
            else if (checked && dropped[zone.id]) borderColor = correct ? '#238636' : '#da3633';
            return (
              <div key={zone.id}
                onDragOver={e => { e.preventDefault(); setDragOver(zone.id); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={e => {
                  e.preventDefault();
                  if (dragging && !submitted) {
                    setDropped(p => ({ ...p, [zone.id]: dragging }));
                    setDragOver(null); setChecked(false);
                  }
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 8, border: `1px solid ${borderColor}`, background: isOver ? 'rgba(56,139,253,0.08)' : checked && dropped[zone.id] ? correct ? 'rgba(35,134,54,0.07)' : 'rgba(218,54,51,0.07)' : '#0d1117', transition: 'all .15s', minHeight: 52 }}>
                <div style={{ width: 80, height: 36, borderRadius: 6, flexShrink: 0, border: `1.5px solid ${droppedItem ? droppedItem.color + '66' : '#2d333b'}`, background: droppedItem ? `${droppedItem.color}12` : '#161b22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter,sans-serif', fontSize: 12, fontWeight: 700, color: droppedItem ? droppedItem.color : '#30363d', transition: 'all .15s' }}>
                  {droppedItem?.label ?? '?'}
                </div>
                <span style={{ flex: 1, fontSize: 13, color: '#c9d1d9', lineHeight: 1.4, fontFamily: 'Inter,sans-serif' }}>{zone.label}</span>
                {checked && dropped[zone.id] && <span style={{ fontSize: 16, flexShrink: 0 }}>{correct ? '✅' : '❌'}</span>}
              </div>
            );
          })}
        </div>
      </div>
      {checked && (
        <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: Object.values(results).every(Boolean) ? 'rgba(35,134,54,0.1)' : 'rgba(218,54,51,0.09)', border: `1px solid ${Object.values(results).every(Boolean) ? 'rgba(35,134,54,0.4)' : 'rgba(218,54,51,0.35)'}`, fontSize: 13, textAlign: 'center', fontFamily: 'Inter,sans-serif', color: Object.values(results).every(Boolean) ? '#3fb950' : '#f85149' }}>
          {Object.values(results).every(Boolean) ? '🎉 Perfect! All matched correctly.' : `${Object.values(results).filter(Boolean).length}/${zones.length} correct — try again!`}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button onClick={doReset} disabled={submitted} style={{ padding: '11px 20px', borderRadius: 8, border: '2px solid #da3633', background: submitted ? 'rgba(72,79,88,0.1)' : 'rgba(218,54,51,0.12)', color: submitted ? '#484f58' : '#f85149', fontWeight: 700, fontSize: 13, cursor: submitted ? 'not-allowed' : 'pointer', fontFamily: 'Inter,sans-serif' }}>Reset</button>
        <button onClick={doCheck} disabled={!allFilled || submitted} style={{ flex: 1, padding: '11px 20px', borderRadius: 8, border: 'none', background: !allFilled || submitted ? 'rgba(72,79,88,0.2)' : 'linear-gradient(135deg,#238636,#196127)', color: !allFilled || submitted ? '#484f58' : '#fff', fontWeight: 700, fontSize: 13, cursor: !allFilled || submitted ? 'not-allowed' : 'pointer', fontFamily: 'Inter,sans-serif' }}>
          {submitted ? '✅ Submitted' : 'Check Answers'}
        </button>
      </div>
    </div>
  );
};

export const DragDropGame: React.FC<Props> = ({ items, zones, onComplete, resetSignal }) => {
  return (
    <DragDropGameInner
      key={resetSignal}
      items={items}
      zones={zones}
      onComplete={onComplete}
    />
  );
};

export default DragDropGame;
