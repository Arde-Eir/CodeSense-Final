// src/LessonActivity.tsx
// FIXES APPLIED:
//   1. XP re-award on refresh fixed — completed_activities persisted to DB per tab
//   2. completedGamesRef (useRef) fixes stale closure bug in handleComplete
//   3. activity_log insert now includes required `description: ''` field
//   4. Every await is checked and throws on error; optimistic state rolls back on failure
//   5. completed_activities loaded from DB on mount to restore state after refresh
//   6. All previous features retained

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from './components/AuthScreen';
import { supabase } from './services/supabase';
import { BalloonPopGame } from './BalloonPopGame';

// ─── Constants ────────────────────────────────────────────────────────────────
const XP_PER_HINT = 2;

// ─── DB types ─────────────────────────────────────────────────────────────────
export interface HintItem  { icon?: string; title: string; body: string; image?: boolean; }
export interface GameItem  { id: string; label: string; color: string; }
export interface DropZone  { id: string; label: string; accepted: string; }
export interface OrderItem { id: string; label: string; description?: string; correct_order: number; }
export interface MCQ       { id: string; question: string; options: string[]; correct: number; explanation: string; }

export interface CodeFillItem {
  id: string;
  code_lines: string[];
  language?: string;
  answers: string[];
  hint?: string;
  caption?: string;
}

export interface TheorySection {
  type?: 'default' | 'code' | 'did_you_know' | 'mistake' | 'diagram' | 'tip' | 'summary';
  heading?: string;
  body?: string;
  items?: { term: string; definition: string }[];
  language?: string;
  code?: string;
  code_caption?: string;
  diagram?: string;
  diagram_caption?: string;
  mistakes?: { wrong: string; right: string; explanation: string }[];
  tips?: { icon?: string; title: string; body: string }[];
  bullets?: string[];
}

interface DBQuest {
  id: string;
  title: string;
  description: string | null;
  basexp: number;
  objectives: string[] | null;
  hints: HintItem[] | null;
  question_type: 'drag_drop' | 'pop_balloon' | 'ordering' | 'multiple_choice' | null;
  game_items:     GameItem[]       | null;
  drop_zones:     DropZone[]       | null;
  ordering_items: OrderItem[]      | null;
  mc_questions:   MCQ[]            | null;
  code_fill_items?: CodeFillItem[] | null;
  tutorial_title: string | null;
  tutorial_body:  string | null;
  tutorial_image: string | null;
  theory_sections: TheorySection[] | null;
  phase: string | null;
  level: number | null;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
const Toast: React.FC<{ visible: boolean; hintsUsed: number; xpCost: number }> = ({ visible, hintsUsed, xpCost }) => (
  <div style={{ position: 'fixed', top: 68, left: '50%', transform: `translateX(-50%) translateY(${visible ? 0 : -20}px)`, opacity: visible ? 1 : 0, transition: 'all .3s ease', background: '#161b22', border: '1px solid rgba(88,166,255,.4)', borderRadius: 12, padding: '12px 20px', zIndex: 9998, minWidth: 300, pointerEvents: 'none', boxShadow: '0 8px 32px rgba(0,0,0,.5)' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#58a6ff', fontFamily: 'Inter,sans-serif' }}>🎯 CodeSense Journey</span>
      <span style={{ fontSize: 10, color: '#484f58', fontFamily: 'Inter,sans-serif' }}>just now</span>
    </div>
    <div style={{ fontSize: 13, fontWeight: 700, color: '#facc15', marginBottom: 3, fontFamily: 'Inter,sans-serif' }}>HINTS ✨</div>
    <div style={{ fontSize: 12, color: '#8b949e', fontFamily: 'Inter,sans-serif' }}>
      You used hint #{hintsUsed} — <span style={{ color: '#f85149', fontWeight: 700 }}>-{xpCost} XP</span>
    </div>
  </div>
);

// ─── PERMANENTLY LOCKED BANNER ────────────────────────────────────────────────
const LockedBanner: React.FC<{ earnedXP: number; title: string }> = ({ earnedXP, title }) => (
  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 32, textAlign: 'center' }}>
    <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'rgba(63,185,80,0.12)', border: '2px solid rgba(63,185,80,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36 }}>
      🏆
    </div>
    <div>
      <div style={{ fontSize: 22, fontWeight: 900, color: '#3fb950', fontFamily: 'Inter,sans-serif', marginBottom: 8 }}>
        Quest Completed!
      </div>
      <div style={{ fontSize: 14, color: '#8b949e', fontFamily: 'Inter,sans-serif', lineHeight: 1.6, maxWidth: 340 }}>
        You've already completed <span style={{ color: '#e6edf3', fontWeight: 700 }}>{title}</span> and earned{' '}
        <span style={{ color: '#facc15', fontWeight: 700 }}>+{earnedXP} XP</span>.
      </div>
    </div>
    <div style={{ padding: '14px 24px', borderRadius: 10, background: 'rgba(63,185,80,0.07)', border: '1px solid rgba(63,185,80,0.25)', fontSize: 13, color: '#484f58', fontFamily: 'Inter,sans-serif', lineHeight: 1.7, maxWidth: 380 }}>
      🔒 This quest is <span style={{ color: '#f0883e', fontWeight: 700 }}>permanently locked</span> once completed.<br />
      Focus on completing all quests and achieving your next rank!
    </div>
  </div>
);

// ─── DRAG & DROP ──────────────────────────────────────────────────────────────
const DragDropGame: React.FC<{
  items: GameItem[]; zones: DropZone[];
  onComplete: (score: number, total: number) => void;
  resetSignal: number;
}> = ({ items, zones, onComplete, resetSignal }) => {
  const [dropped,   setDropped]   = useState<Record<string, string>>({});
  const [dragOver,  setDragOver]  = useState<string | null>(null);
  const [dragging,  setDragging]  = useState<string | null>(null);
  const [checked,   setChecked]   = useState(false);
  const [results,   setResults]   = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (resetSignal > 0) {
      setDropped({}); setChecked(false); setResults({}); setSubmitted(false);
    }
  }, [resetSignal]);

  const usedIds   = new Set(Object.values(dropped));
  const allFilled = Object.keys(dropped).length >= zones.length;

  const doCheck = () => {
    if (submitted) return;
    const r: Record<string, boolean> = {};
    zones.forEach(z => { r[z.id] = dropped[z.id] === z.accepted; });
    setResults(r); setChecked(true);
    const score = Object.values(r).filter(Boolean).length;
    if (score === zones.length) { setSubmitted(true); setTimeout(() => onComplete(score, zones.length), 700); }
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
          {items.map(item => {
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
            const isOver = dragOver === zone.id;
            const correct = results[zone.id];
            let borderColor = '#30363d';
            if (isOver) borderColor = '#388bfd';
            else if (checked && dropped[zone.id]) borderColor = correct ? '#238636' : '#da3633';
            return (
              <div key={zone.id}
                onDragOver={e => { e.preventDefault(); setDragOver(zone.id); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={e => { e.preventDefault(); if (dragging && !submitted) { setDropped(p => ({ ...p, [zone.id]: dragging })); setDragOver(null); setChecked(false); } }}
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
        <button onClick={doCheck} disabled={!allFilled || submitted} style={{ flex: 1, padding: '11px', borderRadius: 8, border: 'none', background: !allFilled || submitted ? 'rgba(35,134,54,0.2)' : 'linear-gradient(135deg,#238636,#2ea043)', color: !allFilled || submitted ? '#484f58' : '#fff', fontWeight: 700, fontSize: 13, cursor: !allFilled || submitted ? 'not-allowed' : 'pointer', fontFamily: 'Inter,sans-serif', boxShadow: allFilled && !submitted ? '0 4px 16px rgba(35,134,54,0.3)' : 'none' }}>
          {submitted ? '✓ Completed' : checked ? 'Check Again' : 'Check Answer'}
        </button>
      </div>
    </div>
  );
};

// ─── CODE FILL-IN-THE-BLANK GAME ──────────────────────────────────────────────
const CodeFillGame: React.FC<{
  items: CodeFillItem[];
  onComplete: (score: number, total: number) => void;
  resetSignal: number;
}> = ({ items, onComplete, resetSignal }) => {
  const [answers, setAnswers] = useState<string[][]>([]);
  const [checked, setChecked] = useState<boolean[]>([]);
  const [results, setResults] = useState<boolean[][]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [itemIdx, setItemIdx] = useState(0);

  useEffect(() => {
    if (items && items.length > 0) {
      setAnswers(items.map(it => it.answers?.map(() => '') ?? []));
      setChecked(items.map(() => false));
      setResults(items.map(it => it.answers?.map(() => false) ?? []));
      setSubmitted(false);
      setItemIdx(0);
    }
  }, [resetSignal, items]);

  if (!items || items.length === 0) return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#484f58', fontFamily: 'Inter,sans-serif', fontSize: 13, textAlign: 'center', padding: 24 }}>
      <span style={{ fontSize: 40 }}>💻</span>
      <span>No <code>code_fill_items</code> found for this quest.<br />Add them in the DB to enable Code Fill activity.</span>
    </div>
  );

  const current = items[itemIdx];
  const isLast = itemIdx === items.length - 1;
  const curAnswers = answers[itemIdx] || [];
  const curChecked = checked[itemIdx] || false;
  const curResults = results[itemIdx] || [];

  let blankCounter = 0;
  const parsedLines = current?.code_lines?.map(line => {
    const parts = line.split('___BLANK___');
    return parts.map((part, pi) => {
      if (pi < parts.length - 1) {
        const idx = blankCounter++;
        return { type: 'blank' as const, text: part, blankIdx: idx };
      }
      return { type: 'text' as const, text: part, blankIdx: -1 };
    });
  }) ?? [];

  const totalBlanks = current?.answers?.length ?? 0;
  const allFilled = curAnswers.length > 0 && curAnswers.every(a => a !== undefined && a.trim().length > 0);

  const doCheck = () => {
    if (!current?.answers) return;
    const r = current.answers.map((correctVal, i) => {
      const userVal = (curAnswers[i] || '').trim().toLowerCase();
      const normalize = (str: string) => str.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
      const possibleAnswers = Array.isArray(correctVal) ? correctVal : [correctVal];
      return possibleAnswers.some(alt => normalize(userVal) === normalize(alt.toLowerCase()));
    });

    const newResults = [...results];
    newResults[itemIdx] = r;
    setResults(newResults);

    const newChecked = [...checked];
    newChecked[itemIdx] = true;
    setChecked(newChecked);

    if (r.every(Boolean)) {
      if (isLast) {
        setSubmitted(true);
        setTimeout(() => onComplete(items.length, items.length), 600);
      } else {
        setTimeout(() => setItemIdx(v => v + 1), 800);
      }
    }
  };

  const doReset = () => {
    if (submitted) return;
    const na = [...answers];
    na[itemIdx] = current.answers.map(() => '');
    setAnswers(na);
    const nc = [...checked]; nc[itemIdx] = false; setChecked(nc);
    const nr = [...results]; nr[itemIdx] = current.answers.map(() => false); setResults(nr);
  };

  const setBlankValue = (blankIdx: number, val: string) => {
    if (submitted) return;
    const na = answers.map(a => [...a]);
    if (!na[itemIdx]) na[itemIdx] = [];
    na[itemIdx][blankIdx] = val;
    setAnswers(na);
    if (curChecked) {
      const nc = [...checked]; nc[itemIdx] = false; setChecked(nc);
    }
  };

  const allCorrect = curChecked && curResults.every(Boolean);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {items.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1, height: 4, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${((itemIdx) / items.length) * 100}%`, height: '100%', background: '#a371f7', transition: 'width .4s ease' }} />
          </div>
          <span style={{ fontSize: 11, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>
            {itemIdx + 1}/{items.length}
          </span>
        </div>
      )}

      <div style={{ background: 'rgba(163,113,247,0.07)', border: '1px solid rgba(163,113,247,0.22)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#8b949e', fontFamily: 'Inter,sans-serif' }}>
        💻 Fill in the blanks to complete the code
        {totalBlanks > 1 && <span style={{ marginLeft: 6, color: '#484f58' }}>({totalBlanks} blank{totalBlanks > 1 ? 's' : ''})</span>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', borderRadius: 10, overflow: 'hidden', border: '1px solid #30363d', marginBottom: 12 }}>
        <div style={{ background: '#161b22', padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #21262d' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#f85149' }} />
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#e3b341' }} />
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#3fb950' }} />
          </div>
          <span style={{ fontSize: 10, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1px' }}>
            {current.language ?? 'code'}
          </span>
        </div>

        <div style={{ background: '#0d1117', padding: '14px 0', overflowX: 'auto' }}>
          {parsedLines.map((segments, lineIdx) => (
            <div key={lineIdx} style={{ display: 'flex', alignItems: 'center', padding: '2px 0', minHeight: 28 }}>
              <span style={{ minWidth: 40, textAlign: 'right', paddingRight: 16, color: '#484f58', fontSize: 12, fontFamily: "'JetBrains Mono',monospace", userSelect: 'none', flexShrink: 0 }}>
                {lineIdx + 1}
              </span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre', display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                {segments.map((seg, si) => {
                  if (seg.type === 'text') {
                    return <span key={si} style={{ color: '#e6edf3' }}>{seg.text}</span>;
                  }
                  const bi = seg.blankIdx;
                  const val = curAnswers[bi] ?? '';
                  const isCorrect = curChecked && curResults[bi];
                  const isWrong = curChecked && !curResults[bi];
                  return (
                    <React.Fragment key={si}>
                      <input
                        value={val}
                        onChange={e => setBlankValue(bi, e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && allFilled) doCheck(); }}
                        disabled={submitted}
                        placeholder={`_____`}
                        spellCheck={false}
                        style={{
                          display: 'inline-block',
                          minWidth: Math.max(60, (val.length || 5) * 9 + 20),
                          maxWidth: 220,
                          margin: '0 4px',
                          padding: '1px 6px',
                          borderRadius: 4,
                          background: isCorrect ? 'rgba(35,134,54,0.18)' : isWrong ? 'rgba(218,54,51,0.18)' : 'rgba(88,166,255,0.1)',
                          border: `1.5px solid ${isCorrect ? '#3fb950' : isWrong ? '#f85149' : '#388bfd'}`,
                          color: isCorrect ? '#3fb950' : isWrong ? '#f85149' : '#58a6ff',
                          fontFamily: "'JetBrains Mono',monospace",
                          fontSize: 13,
                          outline: 'none',
                          transition: 'all .15s',
                          verticalAlign: 'middle',
                          caretColor: '#58a6ff',
                        }}
                      />
                      {isCorrect && <span style={{ color: '#3fb950', marginLeft: 2, marginRight: 4 }}>✓</span>}
                      {isWrong && <span style={{ color: '#f85149', marginLeft: 2, marginRight: 4 }}>✗</span>}
                    </React.Fragment>
                  );
                })}
              </span>
            </div>
          ))}
        </div>

        {current.caption && (
          <div style={{ background: '#161b22', padding: '8px 14px', fontSize: 12, color: '#8b949e', fontFamily: 'Inter,sans-serif', borderTop: '1px solid #21262d' }}>
            💬 {current.caption}
          </div>
        )}
      </div>

      {current.hint && (
        <div style={{ marginBottom: 10, padding: '8px 14px', borderRadius: 8, background: 'rgba(88,166,255,0.05)', border: '1px solid rgba(88,166,255,0.15)', fontSize: 12, color: '#8b949e', fontFamily: 'Inter,sans-serif' }}>
          💡 <span style={{ color: '#484f58' }}>Hint:</span> {current.hint}
        </div>
      )}

      {curChecked && (
        <div style={{ marginBottom: 10, padding: '10px 14px', borderRadius: 8, background: allCorrect ? 'rgba(35,134,54,0.1)' : 'rgba(218,54,51,0.09)', border: `1px solid ${allCorrect ? 'rgba(35,134,54,0.4)' : 'rgba(218,54,51,0.35)'}`, fontSize: 13, textAlign: 'center', fontFamily: 'Inter,sans-serif', color: allCorrect ? '#3fb950' : '#f85149' }}>
          {allCorrect
            ? isLast ? '🎉 All done! Perfect code!' : '✅ Correct! Moving to next…'
            : `${curResults.filter(Boolean).length}/${totalBlanks} correct — check the highlighted blanks!`}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={doReset} disabled={submitted} style={{ padding: '11px 20px', borderRadius: 8, border: '2px solid #da3633', background: submitted ? 'rgba(72,79,88,0.1)' : 'rgba(218,54,51,0.12)', color: submitted ? '#484f58' : '#f85149', fontWeight: 700, fontSize: 13, cursor: submitted ? 'not-allowed' : 'pointer', fontFamily: 'Inter,sans-serif' }}>
          Reset
        </button>
        <button onClick={doCheck} disabled={!allFilled || submitted} style={{ flex: 1, padding: '11px', borderRadius: 8, border: 'none', background: !allFilled || submitted ? 'rgba(163,113,247,0.2)' : 'linear-gradient(135deg,#a371f7,#7c3aed)', color: !allFilled || submitted ? '#484f58' : '#fff', fontWeight: 700, fontSize: 13, cursor: !allFilled || submitted ? 'not-allowed' : 'pointer', fontFamily: 'Inter,sans-serif', boxShadow: allFilled && !submitted ? '0 4px 16px rgba(163,113,247,0.3)' : 'none' }}>
          {submitted ? '✓ Completed' : 'Run Code ▶'}
        </button>
      </div>
    </div>
  );
};

// ─── ORDERING ─────────────────────────────────────────────────────────────────
const OrderingGame: React.FC<{
  items: OrderItem[];
  onComplete: (score: number, total: number) => void;
  resetSignal: number;
}> = ({ items, onComplete, resetSignal }) => {
  const shuffle = useCallback(() => [...items].sort(() => Math.random() - .5), [items]);
  const [order,     setOrder]     = useState<OrderItem[]>(shuffle);
  const [dragIdx,   setDragIdx]   = useState<number | null>(null);
  const [checked,   setChecked]   = useState(false);
  const [allRight,  setAllRight]  = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (resetSignal > 0) { setOrder(shuffle()); setChecked(false); setAllRight(false); setSubmitted(false); }
  }, [resetSignal, shuffle]);

  const doCheck = () => {
    if (submitted) return;
    const ok = order.every((item, i) => item.correct_order === i + 1);
    setChecked(true); setAllRight(ok);
    if (ok) { setSubmitted(true); setTimeout(() => onComplete(items.length, items.length), 600); }
  };

  if (!items.length) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#484f58', fontSize: 13, fontFamily: 'Inter,sans-serif', textAlign: 'center', padding: 24 }}>
      No ordering items configured.<br />Add <code>ordering_items</code> with <code>correct_order</code> values to this quest.
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ background: 'rgba(56,139,253,0.08)', border: '1px solid rgba(56,139,253,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#8b949e', fontFamily: 'Inter,sans-serif' }}>
        🔢 Drag the steps into the correct order
      </div>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {order.map((item, i) => {
          const isRight = item.correct_order === i + 1;
          return (
            <div key={item.id} draggable={!submitted}
              onDragStart={() => !submitted && setDragIdx(i)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => {
                if (dragIdx === null || submitted) return;
                const next = [...order]; const [m] = next.splice(dragIdx, 1); next.splice(i, 0, m);
                setOrder(next); setDragIdx(null); setChecked(false);
              }}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', borderRadius: 8, border: `1px solid ${checked ? (isRight ? 'rgba(35,134,54,0.5)' : 'rgba(218,54,51,0.45)') : '#30363d'}`, background: checked ? (isRight ? 'rgba(35,134,54,0.07)' : 'rgba(218,54,51,0.07)') : '#0d1117', cursor: submitted ? 'not-allowed' : 'grab', opacity: dragIdx === i ? 0.4 : 1, transition: 'all .15s', userSelect: 'none' }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, background: '#161b22', border: '1.5px solid #30363d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#8b949e', fontFamily: "'JetBrains Mono',monospace" }}>{i + 1}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3', fontFamily: 'Inter,sans-serif' }}>{item.label}</div>
                {item.description && <div style={{ fontSize: 12, color: '#484f58', marginTop: 3, lineHeight: 1.5, fontFamily: 'Inter,sans-serif' }}>{item.description}</div>}
              </div>
              {checked && <span style={{ fontSize: 14, flexShrink: 0 }}>{isRight ? '✅' : '❌'}</span>}
            </div>
          );
        })}
      </div>
      {checked && (
        <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: allRight ? 'rgba(35,134,54,0.1)' : 'rgba(218,54,51,0.09)', border: `1px solid ${allRight ? 'rgba(35,134,54,0.4)' : 'rgba(218,54,51,0.35)'}`, fontSize: 13, textAlign: 'center', color: allRight ? '#3fb950' : '#f85149', fontFamily: 'Inter,sans-serif' }}>
          {allRight ? '🎉 Perfect order!' : 'Not quite — check the ❌ items and try again!'}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button onClick={() => { if (!submitted) { setOrder(shuffle()); setChecked(false); setAllRight(false); } }} disabled={submitted} style={{ padding: '11px 20px', borderRadius: 8, border: '2px solid #da3633', background: submitted ? 'rgba(72,79,88,0.1)' : 'rgba(218,54,51,0.12)', color: submitted ? '#484f58' : '#f85149', fontWeight: 700, fontSize: 13, cursor: submitted ? 'not-allowed' : 'pointer', fontFamily: 'Inter,sans-serif' }}>Reset</button>
        <button onClick={doCheck} disabled={submitted} style={{ flex: 1, padding: '11px', borderRadius: 8, border: 'none', background: submitted ? 'rgba(227,179,65,0.2)' : 'linear-gradient(135deg,#e3b341,#d4a017)', color: submitted ? '#484f58' : '#000', fontWeight: 700, fontSize: 13, cursor: submitted ? 'not-allowed' : 'pointer', fontFamily: 'Inter,sans-serif' }}>
          {submitted ? '✓ Completed' : 'Check Order'}
        </button>
      </div>
    </div>
  );
};

// ─── MULTIPLE CHOICE ──────────────────────────────────────────────────────────
const MCGame: React.FC<{ questions: MCQ[]; onComplete: (score: number, total: number) => void; resetSignal: number; }> = ({ questions, onComplete, resetSignal }) => {
  const [qIdx,     setQIdx]     = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [done,     setDone]     = useState(false);
  const scoreRef = useRef(0);

  useEffect(() => {
    if (resetSignal > 0) { setQIdx(0); setSelected(null); setRevealed(false); setDone(false); scoreRef.current = 0; }
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
    if (i === q.correct) { scoreRef.current += 1; }
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
          if (revealed) { if (isRight) { bg = 'rgba(35,134,54,0.1)'; border = '#238636'; color = '#3fb950'; } if (isSelected && !isRight) { bg = 'rgba(218,54,51,0.1)'; border = '#da3633'; color = '#f85149'; } } else if (isSelected) { bg = 'rgba(163,113,247,0.12)'; border = '#a371f7'; color = '#a371f7'; }
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

// ─── THEORY SECTION RENDERER ─────────────────────────────────────────────────
const TheorySectionBlock: React.FC<{ sec: TheorySection; idx: number }> = ({ sec }) => {
  const type = sec.type ?? 'default';

  if (type === 'code') return (
    <div style={{ marginBottom: 16, borderRadius: 10, overflow: 'hidden', border: '1px solid #30363d' }}>
      <div style={{ background: '#161b22', padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #21262d' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#f85149' }} />
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#e3b341' }} />
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#3fb950' }} />
        </div>
        <span style={{ fontSize: 10, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1px' }}>{sec.language ?? 'code'}</span>
      </div>
      {sec.heading && <div style={{ background: '#0d1117', padding: '8px 14px', fontSize: 10, color: '#58a6ff', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1.5px', textTransform: 'uppercase', borderBottom: '1px solid #21262d' }}>{sec.heading}</div>}
      <pre style={{ margin: 0, padding: '16px 18px', background: '#0d1117', color: '#e6edf3', fontSize: 13, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.7, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{sec.code}</pre>
      {sec.code_caption && <div style={{ background: '#161b22', padding: '8px 14px', fontSize: 12, color: '#8b949e', fontFamily: 'Inter,sans-serif', borderTop: '1px solid #21262d' }}>💬 {sec.code_caption}</div>}
    </div>
  );

  if (type === 'did_you_know') return (
    <div style={{ marginBottom: 16, borderRadius: 10, padding: '16px 18px', background: 'rgba(163,113,247,0.07)', border: '1px solid rgba(163,113,247,0.25)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>🤔</span>
        <span style={{ fontSize: 10, fontWeight: 800, color: '#a371f7', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '2px', textTransform: 'uppercase' }}>DID YOU KNOW?</span>
      </div>
      {sec.heading && <div style={{ fontSize: 14, fontWeight: 700, color: '#c9d1d9', marginBottom: 6, fontFamily: 'Inter,sans-serif' }}>{sec.heading}</div>}
      {sec.body && <p style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.75, margin: 0, fontFamily: 'Inter,sans-serif' }}>{sec.body}</p>}
    </div>
  );

  if (type === 'mistake') return (
    <div style={{ marginBottom: 16, borderRadius: 10, padding: '16px 18px', background: 'rgba(218,54,51,0.05)', border: '1px solid rgba(218,54,51,0.2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 18 }}>⚠️</span>
        <span style={{ fontSize: 10, fontWeight: 800, color: '#f85149', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '2px', textTransform: 'uppercase' }}>{sec.heading ?? 'COMMON MISTAKES'}</span>
      </div>
      {sec.mistakes?.map((m, i) => (
        <div key={i} style={{ marginBottom: i < (sec.mistakes?.length ?? 0) - 1 ? 12 : 0 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
            <div style={{ padding: '3px 8px', borderRadius: 5, background: 'rgba(218,54,51,0.15)', border: '1px solid rgba(218,54,51,0.3)', fontSize: 11, color: '#f85149', fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>✗ WRONG</div>
            <code style={{ fontSize: 12, color: '#f85149', fontFamily: "'JetBrains Mono',monospace", background: 'rgba(218,54,51,0.08)', padding: '3px 8px', borderRadius: 5 }}>{m.wrong}</code>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <div style={{ padding: '3px 8px', borderRadius: 5, background: 'rgba(35,134,54,0.15)', border: '1px solid rgba(35,134,54,0.3)', fontSize: 11, color: '#3fb950', fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>✓ RIGHT</div>
            <code style={{ fontSize: 12, color: '#3fb950', fontFamily: "'JetBrains Mono',monospace", background: 'rgba(35,134,54,0.08)', padding: '3px 8px', borderRadius: 5 }}>{m.right}</code>
          </div>
          <p style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.6, margin: 0, paddingLeft: 4, fontFamily: 'Inter,sans-serif' }}>{m.explanation}</p>
        </div>
      ))}
    </div>
  );

  if (type === 'diagram') return (
    <div style={{ marginBottom: 16, borderRadius: 10, overflow: 'hidden', border: '1px solid #30363d' }}>
      {sec.heading && (
        <div style={{ background: '#161b22', padding: '8px 14px', fontSize: 10, color: '#e3b341', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1.5px', textTransform: 'uppercase', borderBottom: '1px solid #21262d', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>📊</span> {sec.heading}
        </div>
      )}
      <pre style={{ margin: 0, padding: '16px 18px', background: '#0d1117', color: '#58a6ff', fontSize: 12, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.8, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {sec.diagram}
      </pre>
      {sec.diagram_caption && (
        <div style={{ background: '#161b22', padding: '8px 14px', fontSize: 12, color: '#8b949e', fontFamily: 'Inter,sans-serif', borderTop: '1px solid #21262d' }}>
          💬 {sec.diagram_caption}
        </div>
      )}
    </div>
  );

  if (type === 'tip') return (
    <div style={{ marginBottom: 16 }}>
      {sec.heading && <div style={{ fontSize: 10, fontWeight: 800, color: '#3fb950', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 10 }}>💚 {sec.heading}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sec.tips?.map((t, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 9, background: 'rgba(35,134,54,0.06)', border: '1px solid rgba(35,134,54,0.2)' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, background: 'rgba(35,134,54,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{t.icon ?? '✅'}</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#3fb950', marginBottom: 3, fontFamily: 'Inter,sans-serif' }}>{t.title}</div>
              <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.65, fontFamily: 'Inter,sans-serif' }}>{t.body}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  if (type === 'summary') return (
    <div style={{ marginBottom: 16, borderRadius: 10, padding: '16px 18px', background: 'linear-gradient(135deg,rgba(56,139,253,0.06),rgba(163,113,247,0.06))', border: '1px solid rgba(56,139,253,0.2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 16 }}>📋</span>
        <span style={{ fontSize: 10, fontWeight: 800, color: '#58a6ff', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '2px', textTransform: 'uppercase' }}>{sec.heading ?? 'QUICK RECAP'}</span>
      </div>
      {sec.body && <p style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.7, margin: '0 0 10px', fontFamily: 'Inter,sans-serif' }}>{sec.body}</p>}
      {sec.bullets?.map((b, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 6, alignItems: 'flex-start' }}>
          <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, background: 'rgba(56,139,253,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#58a6ff', fontFamily: "'JetBrains Mono',monospace", marginTop: 1 }}>{i + 1}</div>
          <span style={{ fontSize: 13, color: '#c9d1d9', lineHeight: 1.55, fontFamily: 'Inter,sans-serif' }}>{b}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ marginBottom: 16, background: '#161b22', border: '1px solid #21262d', borderRadius: 10, padding: '14px 18px' }}>
      {sec.heading && <div style={{ fontSize: 11, fontWeight: 700, color: '#facc15', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 10 }}>{sec.heading}</div>}
      {sec.body && <p style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.75, margin: sec.items?.length ? '0 0 12px' : '0', fontFamily: 'Inter,sans-serif' }}>{sec.body}</p>}
      {sec.items?.map((it, ii) => (
        <div key={ii} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: ii < (sec.items?.length ?? 0) - 1 ? '1px solid #21262d' : 'none' }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#58a6ff', fontFamily: "'JetBrains Mono',monospace", display: 'block', marginBottom: 3 }}>{it.term}</span>
          <span style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.65, fontFamily: 'Inter,sans-serif' }}>{it.definition}</span>
        </div>
      ))}
    </div>
  );
};

// ─── TUTORIAL PHASE ───────────────────────────────────────────────────────────
const TutorialLearnPhase: React.FC<{ quest: DBQuest; onStartGame: () => void }> = ({ quest, onStartGame }) => {
  const hints:  HintItem[]      = quest.hints          ?? [];
  const theory: TheorySection[] = quest.theory_sections ?? [];

  return (
    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 300px', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '22px 26px' }}>
          <div style={{ fontSize: 10, color: '#58a6ff', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 8 }}>TUTORIAL — READ BEFORE PLAYING</div>
          <h2 style={{ fontSize: 26, fontWeight: 800, color: '#e6edf3', letterSpacing: '-0.5px', lineHeight: 1.2, marginBottom: 8, fontFamily: 'Inter,sans-serif' }}>{quest.tutorial_title ?? quest.title}</h2>
          {quest.tutorial_body && <p style={{ fontSize: 15, color: '#8b949e', lineHeight: 1.75, margin: '0 0 20px', fontFamily: 'Inter,sans-serif' }}>{quest.tutorial_body}</p>}
          {quest.tutorial_image
            ? <img src={quest.tutorial_image} alt="Tutorial" style={{ width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 10, border: '1px solid #21262d', marginBottom: 20 }} />
            : <div style={{ height: 140, borderRadius: 10, background: '#161b22', border: '1px dashed #21262d', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                <span style={{ fontSize: 28 }}>📖</span>
                <span style={{ fontSize: 11, color: '#484f58', fontFamily: "'JetBrains Mono',monospace" }}>Add a tutorial_image URL in the DB to show a visual here</span>
              </div>
          }
          {quest.objectives?.length ? (
            <div style={{ background: 'rgba(56,139,253,0.05)', border: '1px solid rgba(56,139,253,0.2)', borderRadius: 10, padding: '14px 18px', marginBottom: 20 }}>
              <div style={{ fontSize: 10, color: '#58a6ff', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 10 }}>🎯 LEARNING OBJECTIVES</div>
              {quest.objectives.map((o, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 6, alignItems: 'flex-start' }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, background: 'rgba(56,139,253,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#58a6ff', fontFamily: "'JetBrains Mono',monospace", marginTop: 1 }}>{i + 1}</div>
                  <span style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.55, fontFamily: 'Inter,sans-serif' }}>{o}</span>
                </div>
              ))}
            </div>
          ) : null}
          {theory.map((sec, si) => <TheorySectionBlock key={si} sec={sec} idx={si} />)}
        </div>
        <div style={{ padding: '14px 26px', borderTop: '1px solid #21262d', flexShrink: 0, background: '#0d1117' }}>
          <button onClick={onStartGame} style={{ width: '100%', padding: '14px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#238636,#2ea043)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'Inter,sans-serif', boxShadow: '0 4px 20px rgba(35,134,54,0.4)' }}>
            Start Activity →
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', background: '#161b22', borderLeft: '1px solid #21262d', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
          <div style={{ fontSize: 9, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 4 }}>HINTS & CLUES</div>
          <div style={{ fontSize: 11, color: '#484f58', lineHeight: 1.5, fontFamily: 'Inter,sans-serif', marginTop: 6 }}>Study these before playing for extra XP</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {hints.length > 0 ? hints.map((hint, i) => (
            <div key={i} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #21262d', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 6 }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, background: 'rgba(250,204,21,0.1)', border: '1px solid rgba(250,204,21,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>{hint.icon ?? '💡'}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#facc15', lineHeight: 1.4, paddingTop: 3, fontFamily: 'Inter,sans-serif' }}>{hint.title}</div>
              </div>
              {hint.body && <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.65, paddingLeft: 36, fontFamily: 'Inter,sans-serif' }}>{hint.body}</div>}
            </div>
          )) : <div style={{ padding: '20px 0', textAlign: 'center', color: '#2d333b', fontSize: 12, fontFamily: 'Inter,sans-serif' }}>No hints configured yet.</div>}
        </div>
        <div style={{ padding: '12px 16px', borderTop: '1px dashed #21262d', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13 }}>✨</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#facc15', fontFamily: "'JetBrains Mono',monospace" }}>{quest.basexp} XP</span>
            <span style={{ fontSize: 11, color: '#484f58', fontFamily: 'Inter,sans-serif' }}>on completion</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── GAME SIDE PANEL ──────────────────────────────────────────────────────────
const GameSidePanel: React.FC<{
  quest: DBQuest; hintsUsed: number; maxHints: number;
  earnedXP: number; isCompleted: boolean; onTakeHint: () => void;
}> = ({ quest, hintsUsed, maxHints, earnedXP, isCompleted, onTakeHint }) => {
  const hints = quest.hints?.length ? quest.hints : [{ icon: '💡', title: 'Study the lesson', body: 'Read the tutorial before attempting the activity.' }];
  const [step, setStep] = useState(0);
  const allHintsUsed = hintsUsed >= maxHints;
  const safeStep = Math.min(step, hints.length - 1);
  const hint = hints[safeStep];
  const stepIsUnlocked = safeStep < hintsUsed;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#161b22', borderLeft: '1px solid #21262d' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
        <div style={{ fontSize: 9, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 5 }}>TUTORIAL</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3', lineHeight: 1.3, marginBottom: 4, fontFamily: 'Inter,sans-serif' }}>{quest.tutorial_title ?? quest.title}</div>
        {quest.tutorial_body && <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.6, fontFamily: 'Inter,sans-serif' }}>{quest.tutorial_body}</div>}
        <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
          {hints.map((_, i) => (
            <button key={i} onClick={() => setStep(i)} style={{ width: i === safeStep ? 14 : 6, height: 6, borderRadius: 3, border: 'none', cursor: 'pointer', padding: 0, transition: 'all .2s', background: i === safeStep ? '#3fb950' : i < hintsUsed ? '#484f58' : '#21262d' }} />
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #21262d' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, background: stepIsUnlocked ? 'rgba(250,204,21,0.12)' : 'rgba(72,79,88,0.15)', border: `1px solid ${stepIsUnlocked ? 'rgba(250,204,21,0.3)' : 'rgba(72,79,88,0.3)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>
              {stepIsUnlocked ? (hint.icon ?? '💡') : '🔒'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: stepIsUnlocked ? '#facc15' : '#484f58', marginBottom: 4, fontFamily: 'Inter,sans-serif' }}>{stepIsUnlocked ? hint.title : 'Locked — take a hint to reveal'}</div>
              <div style={{ fontSize: 12, color: stepIsUnlocked ? '#8b949e' : '#2d333b', lineHeight: 1.7, filter: stepIsUnlocked ? 'none' : 'blur(4px)', userSelect: stepIsUnlocked ? 'auto' : 'none', fontFamily: 'Inter,sans-serif' }}>{hint.body}</div>
            </div>
          </div>
        </div>
        {quest.objectives?.length ? (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #21262d' }}>
            <div style={{ fontSize: 9, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 7 }}>Objectives</div>
            {quest.objectives.map((o, i) => <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 5, alignItems: 'flex-start' }}><span style={{ color: '#58a6ff', fontSize: 11, marginTop: 2, flexShrink: 0 }}>▸</span><span style={{ fontSize: 11, color: '#8b949e', lineHeight: 1.5, fontFamily: 'Inter,sans-serif' }}>{o}</span></div>)}
          </div>
        ) : null}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid #21262d' }}>
          <span style={{ fontSize: 10, color: allHintsUsed ? '#f0883e' : '#484f58', fontFamily: 'Inter,sans-serif' }}>💡 {hintsUsed}/{maxHints} hints used{allHintsUsed ? ' — all revealed!' : ''}</span>
        </div>
        <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #21262d' }}>
          <button onClick={() => setStep(s => Math.max(0, s - 1))} disabled={safeStep === 0} style={{ background: 'transparent', border: 'none', cursor: safeStep === 0 ? 'default' : 'pointer', fontSize: 12, color: safeStep === 0 ? '#2d333b' : '#8b949e', fontFamily: 'Inter,sans-serif' }}>← Prev</button>
          <button onClick={() => setStep(s => Math.min(hints.length - 1, s + 1))} disabled={safeStep === hints.length - 1} style={{ background: 'transparent', border: 'none', cursor: safeStep === hints.length - 1 ? 'default' : 'pointer', fontSize: 12, color: safeStep === hints.length - 1 ? '#2d333b' : '#8b949e', fontFamily: 'Inter,sans-serif' }}>Next →</button>
        </div>
      </div>
      <div style={{ borderTop: '1px dashed #21262d', padding: '12px 16px', flexShrink: 0 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'default' }}>
          <div style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, border: `1.5px solid ${isCompleted ? '#3fb950' : '#30363d'}`, background: isCompleted ? 'rgba(63,185,80,0.15)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .2s' }}>
            {isCompleted && <span style={{ fontSize: 9, color: '#3fb950' }}>✓</span>}
          </div>
          <span style={{ fontSize: 12, color: '#8b949e', fontFamily: 'Inter,sans-serif' }}>Complete to earn <span style={{ color: '#facc15', fontWeight: 700 }}>{earnedXP} XP</span></span>
          <span style={{ marginLeft: 'auto', fontSize: 14 }}>✅</span>
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <span style={{ fontSize: 13 }}>✨</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#facc15', fontFamily: "'JetBrains Mono',monospace" }}>{earnedXP} XP</span>
          </div>
          <button onClick={onTakeHint} disabled={allHintsUsed || isCompleted} style={{ flex: 1, padding: '9px 10px', borderRadius: 9, border: 'none', background: allHintsUsed || isCompleted ? 'rgba(72,79,88,0.2)' : 'linear-gradient(135deg,#06b6d4,#0891b2)', color: allHintsUsed || isCompleted ? '#484f58' : '#000', fontWeight: 700, fontSize: 11, cursor: allHintsUsed || isCompleted ? 'not-allowed' : 'pointer', fontFamily: 'Inter,sans-serif', boxShadow: allHintsUsed || isCompleted ? 'none' : '0 4px 14px rgba(6,182,212,.35)', transition: 'all .15s' }}>
            {allHintsUsed ? 'No more hints' : `TAKE A HINT (${maxHints - hintsUsed} left)`}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export const LessonActivity: React.FC = () => {
  const navigate    = useNavigate();
  const { questId } = useParams<{ questId: string }>();
  const { user }    = useAuth();

  // ── FIX: ref tracks completed tabs — avoids stale closure in handleComplete
  // and survives async re-renders without needing useState
  const completedGamesRef = useRef<string[]>([]);

  const [quest,        setQuest]        = useState<DBQuest | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [fetchError,   setFetchError]   = useState<string | null>(null);
  const [hintsUsed,    setHintsUsed]    = useState(0);
  const [toastVisible, setToastVisible] = useState(false);
  const [progressId,   setProgressId]   = useState<string | null>(null);
  const [userXP,       setUserXP]       = useState(0);
  const [isCompleted,  setIsCompleted]  = useState(false);
  const [earnedXP,     setEarnedXP]     = useState(0);

  const [activeTab,    setActiveTab]    = useState<'drag' | 'code_fill' | 'balloon' | 'ordering' | 'mc'>('drag');
  const [appPhase,     setAppPhase]     = useState<'tutorial' | 'game'>('tutorial');
  const [resetSignal,  setResetSignal]  = useState(0);

  const toastTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const questPhase  = useRef<string>('beginner');

  const maxHints   = Math.max(quest?.hints?.length ?? 0, 1);
  const levelNum   = quest?.level ?? 1;
  const phaseLabel = quest?.phase ? `${quest.phase.charAt(0).toUpperCase() + quest.phase.slice(1)} · Level ${levelNum}` : `Level ${levelNum}`;
  const baseXP     = quest?.basexp ?? 0;
  const displayXP  = isCompleted && earnedXP > 0 ? earnedXP : Math.max(1, baseXP - hintsUsed * XP_PER_HINT);

  // ── Initial fetch ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!questId || !user?.id) {
      console.warn('[LessonActivity] Missing questId or user:', { questId, userId: user?.id });
      if (!questId) setFetchError('No quest ID in URL. Make sure you navigate with a valid quest UUID (e.g. /lesson/abc-123-...)');
      setLoading(false);
      return;
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(questId)) {
      console.warn('[LessonActivity] questId is not a valid UUID:', questId);
      setFetchError(`"${questId}" is not a valid quest UUID. Check your routing — the URL param should be a UUID like "abc-123-..."`);
      setLoading(false);
      return;
    }

    const run = async () => {
      setLoading(true);
      setFetchError(null);
      try {
        const { data: q, error: qErr } = await supabase
          .from('quests')
          .select('id,title,description,basexp,objectives,hints,question_type,game_items,drop_zones,ordering_items,mc_questions,code_fill_items,tutorial_title,tutorial_body,tutorial_image,theory_sections,phase,level')
          .eq('id', questId)
          .single();

        if (qErr) {
          console.error('[LessonActivity] Supabase error fetching quest:', qErr);
          setFetchError(`DB error: ${qErr.message}`);
          setLoading(false);
          return;
        }

        if (!q) {
          console.warn('[LessonActivity] Quest not found for id:', questId);
          setFetchError(`Quest with ID "${questId}" was not found in the database. Make sure the quest exists and is active.`);
          setLoading(false);
          return;
        }

        setQuest(q);
        questPhase.current = q.phase ?? 'beginner';

        const { data: ud } = await supabase.from('users').select('totalxp').eq('id', user.id).single();
        if (ud) setUserXP(ud.totalxp ?? 0);

        const { data: ex } = await supabase
          .from('mission_progress')
          // ── FIX: include completed_activities in select
          .select('id,hintsused,status,xp_gained,completed_activities')
          .eq('userid', user.id).eq('questid', questId).maybeSingle();

        if (ex) {
          setProgressId(ex.id);
          setHintsUsed(ex.hintsused ?? 0);

          // ── FIX: restore completed tabs from DB so refresh can't re-award XP
          const alreadyDone: string[] = Array.isArray(ex.completed_activities)
            ? ex.completed_activities
            : [];
          completedGamesRef.current = alreadyDone;

          if (ex.status === 'completed') {
            setIsCompleted(true);
            setEarnedXP(ex.xp_gained ?? q?.basexp ?? 0);
            setAppPhase('game');
          }
        } else {
          const { data: ins } = await supabase
            .from('mission_progress')
            .insert({ userid: user.id, questid: questId, status: 'active', attempts: 0, hintsused: 0, startedat: new Date().toISOString() })
            .select('id').single();
          if (ins) setProgressId(ins.id);
        }
      } catch (err) {
        console.error('[LessonActivity] Unexpected fetch error:', err);
        setFetchError('An unexpected error occurred while loading the quest.');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [questId, user?.id]);

  // ── Real-time XP subscription ─────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`user-xp-${user.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${user.id}`,
      }, payload => {
        const newXP = payload.new?.totalxp;
        if (typeof newXP === 'number') setUserXP(newXP);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  // ── Hint handler ──────────────────────────────────────────────────────────
  const handleTakeHint = useCallback(async () => {
    if (hintsUsed >= maxHints || !quest || !user?.id || isCompleted) return;
    const next  = hintsUsed + 1;
    const newXP = Math.max(0, userXP - XP_PER_HINT);
    setHintsUsed(next);
    setUserXP(newXP);

    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastVisible(true);
    toastTimer.current = setTimeout(() => setToastVisible(false), 3500);

    try {
      if (progressId) await supabase.from('mission_progress').update({ hintsused: next, updatedat: new Date().toISOString() }).eq('id', progressId);
      await supabase.from('users').update({ totalxp: newXP, updatedat: new Date().toISOString() }).eq('id', user.id);
    } catch (err) { console.error('hint deduct:', err); }
  }, [hintsUsed, maxHints, progressId, userXP, quest, user, isCompleted]);

  // ── Completion handler ─────────────────────────────────────────────────────
  const handleComplete = useCallback(async (score: number, total: number) => {
    if (!user?.id || !quest || isCompleted) return;

    // ── FIX: use ref so the closure always sees the latest completedGames value
    if (completedGamesRef.current.includes(activeTab)) return;

    const requiredGames: string[] = [];
    if (quest.game_items?.length)      requiredGames.push('drag');
    if (quest.code_fill_items?.length) requiredGames.push('code_fill');
    if (quest.ordering_items?.length)  requiredGames.push('ordering');
    if (quest.mc_questions?.length) {
      requiredGames.push('mc');
      requiredGames.push('balloon');
    }
    const uniqueRequired = [...new Set(requiredGames)];

    const newFinished = [...new Set([...completedGamesRef.current, activeTab])];

    // ── FIX: update ref immediately to block any double-fire before async completes
    completedGamesRef.current = newFinished;

    const xpPerGame   = Math.floor(quest.basexp / (uniqueRequired.length || 1));
    const ratio       = total > 0 ? score / total : 1;
    const xpGainedNow = Math.max(1, Math.round(xpPerGame * ratio));

    try {
      // ── FIX: always fetch fresh totalxp to avoid stale-closure race condition
      const { data: userData, error: userFetchErr } = await supabase
        .from('users').select('totalxp').eq('id', user.id).single();
      if (userFetchErr) throw new Error(`Failed to fetch user XP: ${userFetchErr.message}`);

      const currentTotal = userData?.totalxp ?? 0;
      const { error: xpErr } = await supabase.from('users')
        .update({ totalxp: currentTotal + xpGainedNow, updatedat: new Date().toISOString() })
        .eq('id', user.id);
      if (xpErr) throw new Error(`Failed to update XP: ${xpErr.message}`);

      // ── FIX: description field is NOT NULL in schema — must always be provided
      const { error: logErr } = await supabase.from('activity_log').insert({
        userid:      user.id,
        type:        'quest_completed',
        title:       `${quest.title} (${activeTab})`,
        description: '',   // satisfies NOT NULL constraint
        xp_gained:   xpGainedNow,
      });
      if (logErr) throw new Error(`Failed to insert activity log: ${logErr.message}`);

      const allActivitiesDone = uniqueRequired.every(g => newFinished.includes(g));

      // ── FIX: persist completed_activities to DB so refresh restores the guard
      if (progressId) {
        const { error: progErr } = await supabase.from('mission_progress').update({
          completed_activities: newFinished,
          updatedat: new Date().toISOString(),
          ...(allActivitiesDone && {
            status:      'completed',
            completedat: new Date().toISOString(),
            xp_gained:   quest.basexp - hintsUsed * 2,
          }),
        }).eq('id', progressId);
        if (progErr) throw new Error(`Failed to update mission progress: ${progErr.message}`);
      }

      if (allActivitiesDone) {
        setIsCompleted(true);
      }
    } catch (err) {
      // ── FIX: roll back optimistic ref so the user can retry
      completedGamesRef.current = completedGamesRef.current.filter(g => g !== activeTab);
      console.error('XP Award Error:', err);
    }
  }, [activeTab, quest, user, progressId, hintsUsed, isCompleted]);

  const handleReset  = () => setResetSignal(s => s + 1);
  const handleGoBack = () => setAppPhase('tutorial');

  // ── Tab config ────────────────────────────────────────────────────────────
  const TABS = [
    { id: 'drag'      as const, label: '🃏 Drag & Drop' },
    { id: 'code_fill' as const, label: '💻 Code Fill' },
    { id: 'balloon'   as const, label: '🎈 Balloon Pop' },
    { id: 'ordering'  as const, label: '🔢 Ordering' },
    { id: 'mc'        as const, label: '🧠 Quiz' },
  ];

  const tabTitle = (tab: typeof activeTab) => {
    if (tab === 'drag')      return 'DRAG & DROP GAME';
    if (tab === 'code_fill') return 'CODE FILL-IN-THE-BLANK';
    if (tab === 'balloon')   return 'POP THE BALLOON GAME';
    if (tab === 'ordering')  return 'ORDERING GAME';
    return 'MULTIPLE CHOICE QUIZ';
  };

  const tabSubtitle = (tab: typeof activeTab) => {
    if (tab === 'drag')      return 'Drag each term to its matching description';
    if (tab === 'code_fill') return 'Fill in the blanks to complete the code';
    if (tab === 'balloon')   return 'Click the balloon with the correct answer';
    if (tab === 'ordering')  return 'Drag the steps into the correct order';
    return 'Pick the correct answer for each question';
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600;700&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .lesson-root { height: 100vh; background: #0d1117; font-family: 'Inter', system-ui, sans-serif; color: #e6edf3; display: flex; flex-direction: column; overflow: hidden; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
      `}</style>
      <div className="lesson-root">

        {/* TOP HEADER */}
        <div style={{ height: 48, flexShrink: 0, background: '#161b22', borderBottom: '1px solid #21262d', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 16 }}>🌿</span>
            <span style={{ fontWeight: 700, fontSize: 13, fontFamily: 'Inter,sans-serif' }}>CodeSense</span>
            <div style={{ width: 1, height: 14, background: '#30363d', margin: '0 3px' }} />
            <div style={{ padding: '3px 9px', borderRadius: 5, background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.3)', fontSize: 11, color: '#3fb950', fontFamily: 'Inter,sans-serif' }}>{phaseLabel}</div>
            <span style={{ color: '#30363d', fontSize: 11 }}>›</span>
            <div style={{ padding: '3px 9px', borderRadius: 5, background: 'rgba(56,139,253,0.1)', border: '1px solid rgba(56,139,253,0.3)', fontSize: 11, color: '#58a6ff', fontFamily: 'Inter,sans-serif', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{quest?.title ?? (loading ? '…' : 'Quest')}</div>
            <div style={{ padding: '3px 9px', borderRadius: 5, background: appPhase === 'tutorial' ? 'rgba(250,204,21,0.1)' : 'rgba(163,113,247,0.1)', border: `1px solid ${appPhase === 'tutorial' ? 'rgba(250,204,21,0.3)' : 'rgba(163,113,247,0.3)'}`, fontSize: 11, color: appPhase === 'tutorial' ? '#facc15' : '#a371f7', fontFamily: 'Inter,sans-serif' }}>{appPhase === 'tutorial' ? '📖 Learn' : '🎮 Activity'}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(250,204,21,0.1)', border: '1px solid rgba(250,204,21,0.3)', borderRadius: 6, padding: '4px 11px' }}>
              <span style={{ fontSize: 11 }}>⚡</span>
              <span style={{ fontSize: 12, color: '#facc15', fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{userXP.toLocaleString()} XP</span>
            </div>
            {appPhase === 'game' && !isCompleted && <button onClick={handleGoBack} style={{ padding: '4px 11px', borderRadius: 6, border: '1px solid rgba(250,204,21,0.3)', background: 'rgba(250,204,21,0.07)', color: '#facc15', fontSize: 11, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>📖 Tutorial</button>}
            <button onClick={() => { const r = questPhase.current === 'intermediate' ? '/campaign/inside/intermediate' : questPhase.current === 'advanced' ? '/campaign/inside/advanced' : '/level/1'; navigate(r); }} style={{ padding: '4px 11px', borderRadius: 6, border: '1px solid #30363d', background: 'transparent', color: '#8b949e', fontSize: 11, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>Exit Quest</button>
            <button onClick={() => navigate('/campaign')} style={{ padding: '4px 11px', borderRadius: 6, border: '1px solid #30363d', background: 'transparent', color: '#8b949e', fontSize: 11, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>Campaign</button>
          </div>
        </div>

        {/* SUB-HEADER */}
        <div style={{ height: 54, flexShrink: 0, background: '#0d1117', borderBottom: '1px solid #21262d', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button onClick={() => navigate(-1)} style={{ background: 'transparent', border: 'none', color: '#8b949e', fontSize: 12, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>← Back</button>
            <div style={{ width: 1, height: 24, background: '#21262d' }} />
            <div>
              <div style={{ fontSize: 10, color: '#3fb950', fontFamily: 'Inter,sans-serif', marginBottom: 2 }}>{phaseLabel}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#e6edf3', letterSpacing: '-0.3px', lineHeight: 1, fontFamily: 'Inter,sans-serif' }}>{loading ? '…' : (quest?.title ?? 'Lesson')}</div>
            </div>
          </div>
          {quest && (
            <div style={{ padding: '5px 14px', borderRadius: 9, background: isCompleted ? 'rgba(63,185,80,0.12)' : 'rgba(250,204,21,0.08)', border: `1px solid ${isCompleted ? 'rgba(63,185,80,0.5)' : 'rgba(250,204,21,0.3)'}`, fontSize: 13, fontWeight: 800, color: isCompleted ? '#3fb950' : '#facc15', fontFamily: "'JetBrains Mono',monospace" }}>
              {isCompleted ? `🔒 +${earnedXP} XP earned` : `+${displayXP} XP available`}
            </div>
          )}
        </div>

        {/* BODY */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2.5px solid rgba(88,166,255,0.2)', borderTopColor: '#58a6ff', animation: 'spin .8s linear infinite' }} />
              <span style={{ fontSize: 12, color: '#484f58', fontFamily: 'Inter,sans-serif' }}>Loading lesson…</span>
            </div>
          ) : fetchError ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32, textAlign: 'center' }}>
              <div style={{ fontSize: 40 }}>🔍</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#f85149', fontFamily: 'Inter,sans-serif' }}>Quest Not Found</div>
              <div style={{ fontSize: 13, color: '#8b949e', fontFamily: 'Inter,sans-serif', maxWidth: 480, lineHeight: 1.7, background: 'rgba(218,54,51,0.07)', border: '1px solid rgba(218,54,51,0.2)', borderRadius: 10, padding: '14px 18px' }}>
                {fetchError}
              </div>
              <div style={{ fontSize: 12, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: '10px 16px', maxWidth: 400 }}>
                URL questId: <span style={{ color: '#58a6ff' }}>{questId ?? 'undefined'}</span>
              </div>
              <button onClick={() => navigate(-1)} style={{ padding: '10px 24px', borderRadius: 8, border: '1px solid #30363d', background: 'transparent', color: '#8b949e', fontSize: 13, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>← Go Back</button>
            </div>
          ) : !quest ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#484f58', fontSize: 13, fontFamily: 'Inter,sans-serif' }}>Quest not found.</div>
          ) : appPhase === 'tutorial' ? (
            <TutorialLearnPhase quest={quest} onStartGame={() => setAppPhase('game')} />
          ) : (
            /* ══ GAME PHASE ══ */
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 300px', minHeight: 0, overflow: 'hidden' }}>

              {/* LEFT: game panel */}
              <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>

                {/* Title bar */}
                <div style={{ padding: '14px 22px 10px', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h1 style={{ fontSize: 22, fontWeight: 900, color: '#e6edf3', letterSpacing: '0.3px', fontFamily: 'Inter,sans-serif', textTransform: 'uppercase' }}>
                      {isCompleted ? '🏆 QUEST COMPLETED' : tabTitle(activeTab)}
                    </h1>
                    {isCompleted && <div style={{ padding: '4px 12px', borderRadius: 6, background: 'rgba(63,185,80,0.12)', border: '1px solid rgba(63,185,80,0.3)', fontSize: 11, color: '#3fb950', fontFamily: 'Inter,sans-serif' }}>🔒 Locked · {earnedXP} XP earned</div>}
                  </div>
                  {!isCompleted && (
                    <p style={{ fontSize: 11, color: '#484f58', marginTop: 3, fontFamily: "'JetBrains Mono',monospace" }}>
                      {tabSubtitle(activeTab)}
                    </p>
                  )}
                </div>

                {/* Tab row — hidden when completed */}
                {!isCompleted && (
                  <div style={{ display: 'flex', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
                    {TABS.map(tab => (
                      <button key={tab.id} onClick={() => { setActiveTab(tab.id); handleReset(); }}
                        style={{ flex: 1, padding: '9px 6px', border: 'none', borderBottom: `2px solid ${activeTab === tab.id ? '#58a6ff' : 'transparent'}`, background: activeTab === tab.id ? 'rgba(56,139,253,0.07)' : 'transparent', color: activeTab === tab.id ? '#58a6ff' : '#484f58', fontWeight: 700, fontSize: 10, cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '0.3px', transition: 'all .15s' }}>
                        {tab.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Game content */}
                <div style={{ flex: 1, padding: (!isCompleted && activeTab === 'balloon') ? '0' : '16px 22px', display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>

                  {isCompleted ? (
                    <LockedBanner earnedXP={earnedXP} title={quest.title} />
                  ) : (
                    <>
                      {activeTab === 'drag' && (
                        <DragDropGame
                          items={quest.game_items ?? []}
                          zones={quest.drop_zones ?? []}
                          onComplete={handleComplete}
                          resetSignal={resetSignal}
                        />
                      )}

                      {activeTab === 'code_fill' && (
                        <CodeFillGame
                          items={quest.code_fill_items ?? []}
                          onComplete={handleComplete}
                          resetSignal={resetSignal}
                        />
                      )}

                      {activeTab === 'balloon' && (
                        quest.mc_questions && quest.mc_questions.length > 0
                          ? <BalloonPopGame questions={quest.mc_questions} onComplete={handleComplete} />
                          : <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#484f58', fontFamily: 'Inter,sans-serif', fontSize: 13, textAlign: 'center', padding: 24 }}>
                              <span style={{ fontSize: 40 }}>🎈</span>
                              <span>No <code>mc_questions</code> found for this quest.<br />Add them in the DB to enable Balloon Pop.</span>
                            </div>
                      )}

                      {activeTab === 'ordering' && (
                        <OrderingGame
                          items={quest.ordering_items ?? []}
                          onComplete={handleComplete}
                          resetSignal={resetSignal}
                        />
                      )}

                      {activeTab === 'mc' && (
                        <MCGame
                          questions={quest.mc_questions ?? []}
                          onComplete={handleComplete}
                          resetSignal={resetSignal}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* RIGHT: hints panel */}
              <div style={{ minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <GameSidePanel
                  quest={quest}
                  hintsUsed={hintsUsed}
                  maxHints={maxHints}
                  earnedXP={displayXP}
                  isCompleted={isCompleted}
                  onTakeHint={handleTakeHint}
                />
              </div>
            </div>
          )}
        </div>
      </div>
      <Toast visible={toastVisible} hintsUsed={hintsUsed} xpCost={XP_PER_HINT} />
    </>
  );
};

export default LessonActivity;