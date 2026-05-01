// frontend/src/games/DragDropGame.tsx
// Drag a term card into the matching description row. All items must be
// matched correctly to complete.
//
// FIXES:
//  • Term column is now `minWidth: 110, maxWidth: 150` + auto height so long
//    labels never overflow into the description column.
//  • Drop zones use `minHeight: 56` (not fixed height) so wrapping labels
//    never get clipped.
//  • Outer container no longer sets `flex: 1 / minHeight: 0` on the scroll
//    area — it scrolls internally instead of fighting a parent fixed height.
//  • Term cards use `wordBreak: 'break-word'` + `whiteSpace: 'normal'` so
//    long text wraps inside the card rather than overflowing.

import React from 'react';
import type { GameItem, DropZone } from '../types/campaign';

interface Props {
  items:       GameItem[];
  zones:       DropZone[];
  onComplete:  (score: number, total: number) => void;
  resetSignal: number;
}

const DragDropGameInner: React.FC<{
  items:      GameItem[];
  zones:      DropZone[];
  onComplete: (score: number, total: number) => void;
}> = ({ items, zones, onComplete }) => {
  const [dropped,       setDropped]       = React.useState<Record<string, string>>({});
  const [dragOver,      setDragOver]      = React.useState<string | null>(null);
  const [dragging,      setDragging]      = React.useState<string | null>(null);
  const [checked,       setChecked]       = React.useState(false);
  const [results,       setResults]       = React.useState<Record<string, boolean>>({});
  const [submitted,     setSubmitted]     = React.useState(false);
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

  const doReset = () => {
    if (!submitted) { setDropped({}); setChecked(false); setResults({}); }
  };

  if (!items.length || !zones.length) return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#484f58', fontSize: 13, fontFamily: 'Inter,sans-serif',
      textAlign: 'center', padding: 24,
    }}>
      No drag-drop data yet.<br />
      Add <code>game_items</code> and <code>drop_zones</code> to this quest in the DB.
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Instruction banner */}
      <div style={{
        background: 'rgba(56,139,253,0.08)', border: '1px solid rgba(56,139,253,0.2)',
        borderRadius: 8, padding: '10px 14px',
        fontSize: 13, color: '#8b949e', fontFamily: 'Inter,sans-serif',
      }}>
        🧩 Drag each term to its matching description
      </div>

      {/* Column headers */}
      <div style={{ display: 'flex', gap: 14 }}>
        <div style={{
          width: 130, flexShrink: 0,
          fontSize: 10, color: '#484f58',
          fontFamily: "'JetBrains Mono',monospace",
          letterSpacing: '1.5px', textTransform: 'uppercase',
        }}>TERMS</div>
        <div style={{
          flex: 1,
          fontSize: 10, color: '#484f58',
          fontFamily: "'JetBrains Mono',monospace",
          letterSpacing: '1.5px', textTransform: 'uppercase',
        }}>DESCRIPTIONS</div>
      </div>

      {/* Main layout: term cards (left) + drop zones (right) */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>

        {/* ── Term cards ─────────────────────────────────────────────── */}
        <div style={{
          width: 130, flexShrink: 0,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {shuffledItems.map(item => {
            const used = usedIds.has(item.id);
            return (
              <div
                key={item.id}
                draggable={!used && !submitted}
                onDragStart={() => { if (!used && !submitted) setDragging(item.id); }}
                onDragEnd={() => setDragging(null)}
                style={{
                  // ↓ key fix: allow height to grow with content
                  padding: '10px 8px',
                  borderRadius: 7,
                  textAlign: 'center',
                  border: `2px solid ${used ? '#2d333b' : item.color}`,
                  background: used ? 'rgba(255,255,255,0.02)' : `${item.color}18`,
                  color: used ? '#2d333b' : item.color,
                  fontFamily: 'Inter,sans-serif',
                  fontSize: 12,
                  fontWeight: 700,
                  // ↓ key fix: wrap long labels instead of overflowing
                  wordBreak: 'break-word',
                  whiteSpace: 'normal',
                  lineHeight: 1.35,
                  cursor: used || submitted ? 'not-allowed' : 'grab',
                  opacity: used ? 0.3 : dragging === item.id ? 0.4 : 1,
                  userSelect: 'none',
                  transition: 'all .15s',
                }}
              >
                {item.label}
              </div>
            );
          })}
        </div>

        {/* ── Drop zones ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {zones.map(zone => {
            const droppedItem = items.find(i => i.id === dropped[zone.id]);
            const isOver  = dragOver === zone.id;
            const correct = results[zone.id];

            let borderColor = '#30363d';
            if (isOver) borderColor = '#388bfd';
            else if (checked && dropped[zone.id]) borderColor = correct ? '#238636' : '#da3633';

            return (
              <div
                key={zone.id}
                onDragOver={e => { e.preventDefault(); setDragOver(zone.id); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={e => {
                  e.preventDefault();
                  if (dragging && !submitted) {
                    setDropped(prev => {
                      // If the target zone already holds a different term, the
                      // displaced item automatically returns to the unplaced pool
                      // (it just won't be in `dropped` anymore — no extra step needed).
                      const next = { ...prev };
                      // Remove the dragged item from any zone it was already in.
                      for (const zid of Object.keys(next)) {
                        if (next[zid] === dragging) { delete next[zid]; break; }
                      }
                      next[zone.id] = dragging;
                      return next;
                    });
                    setDragOver(null); setChecked(false);
                  }
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px',
                  borderRadius: 8,
                  border: `1px solid ${borderColor}`,
                  background: isOver
                    ? 'rgba(56,139,253,0.08)'
                    : checked && dropped[zone.id]
                      ? correct ? 'rgba(35,134,54,0.07)' : 'rgba(218,54,51,0.07)'
                      : '#0d1117',
                  transition: 'all .15s',
                  // ↓ key fix: min-height instead of fixed height
                  minHeight: 56,
                }}
              >
                {/* Dropped chip */}
                <div style={{
                  width: 80, flexShrink: 0,
                  // ↓ key fix: min-height so chip grows with label text
                  minHeight: 36,
                  borderRadius: 6,
                  border: `1.5px solid ${droppedItem ? droppedItem.color + '66' : '#2d333b'}`,
                  background: droppedItem ? `${droppedItem.color}12` : '#161b22',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  // ↓ key fix: wrap text inside chip
                  fontFamily: 'Inter,sans-serif',
                  fontSize: 11,
                  fontWeight: 700,
                  color: droppedItem ? droppedItem.color : '#30363d',
                  wordBreak: 'break-word',
                  whiteSpace: 'normal',
                  textAlign: 'center',
                  lineHeight: 1.3,
                  padding: '4px 6px',
                  transition: 'all .15s',
                }}>
                  {droppedItem?.label ?? '?'}
                </div>

                {/* Description */}
                <span style={{
                  flex: 1,
                  fontSize: 13, color: '#c9d1d9', lineHeight: 1.45,
                  fontFamily: 'Inter,sans-serif',
                  // ↓ key fix: allow text to wrap naturally
                  wordBreak: 'break-word',
                }}>
                  {zone.label}
                </span>

                {checked && dropped[zone.id] && (
                  <span style={{ fontSize: 16, flexShrink: 0 }}>
                    {correct ? '✅' : '❌'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Result banner */}
      {checked && (
        <div style={{
          padding: '10px 14px', borderRadius: 8,
          background: Object.values(results).every(Boolean)
            ? 'rgba(35,134,54,0.1)' : 'rgba(218,54,51,0.09)',
          border: `1px solid ${Object.values(results).every(Boolean)
            ? 'rgba(35,134,54,0.4)' : 'rgba(218,54,51,0.35)'}`,
          fontSize: 13, textAlign: 'center',
          fontFamily: 'Inter,sans-serif',
          color: Object.values(results).every(Boolean) ? '#3fb950' : '#f85149',
        }}>
          {Object.values(results).every(Boolean)
            ? '🎉 Perfect! All matched correctly.'
            : `${Object.values(results).filter(Boolean).length}/${zones.length} correct — try again!`}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={doReset}
          disabled={submitted}
          style={{
            padding: '11px 20px', borderRadius: 8,
            border: '2px solid #da3633',
            background: submitted ? 'rgba(72,79,88,0.1)' : 'rgba(218,54,51,0.12)',
            color: submitted ? '#484f58' : '#f85149',
            fontWeight: 700, fontSize: 13,
            cursor: submitted ? 'not-allowed' : 'pointer',
            fontFamily: 'Inter,sans-serif',
          }}
        >
          Reset
        </button>
        <button
          onClick={doCheck}
          disabled={!allFilled || submitted}
          style={{
            flex: 1, padding: '11px 20px', borderRadius: 8, border: 'none',
            background: !allFilled || submitted
              ? 'rgba(72,79,88,0.2)'
              : 'linear-gradient(135deg,#238636,#196127)',
            color: !allFilled || submitted ? '#484f58' : '#fff',
            fontWeight: 700, fontSize: 13,
            cursor: !allFilled || submitted ? 'not-allowed' : 'pointer',
            fontFamily: 'Inter,sans-serif',
          }}
        >
          {submitted ? '✅ Submitted' : 'Check Answers'}
        </button>
      </div>
    </div>
  );
};

export const DragDropGame: React.FC<Props> = ({ items, zones, onComplete, resetSignal }) => (
  <DragDropGameInner
    key={resetSignal}
    items={items}
    zones={zones}
    onComplete={onComplete}
  />
);

export default DragDropGame;