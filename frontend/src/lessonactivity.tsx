// src/LessonActivity.tsx
// ─── FIXES APPLIED (v3) ───────────────────────────────────────────────────────
//  All v2 fixes preserved, plus:
//  7. handleComplete — requiredGames now derived from ALL_TABS.filter(t=>t.hasData)
//     instead of quest.question_type alone. This means the quest only marks as
//     complete after EVERY visible activity tab is finished, not just the first.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from './components/AuthScreen';
import { supabase } from './services/supabase';
import { BalloonPopGame } from './BalloonPopGame';

// ─── Constants ────────────────────────────────────────────────────────────────
const XP_PER_HINT       = 2;
const REPEAT_XP_FRACTION = 0.10;
const REPEAT_XP_MIN      = 1;
const FETCH_TIMEOUT_MS   = 10_000;

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

// ─── XP Toast ─────────────────────────────────────────────────────────────────
const XPToast: React.FC<{
  visible: boolean;
  xpGained: number;
  isRepeat: boolean;
  questTitle: string;
  levelledUp?: boolean;
  newLevel?: number;
}> = ({ visible, xpGained, isRepeat, questTitle, levelledUp, newLevel }) => (
  <div style={{
    position: 'fixed', top: 68, left: '50%',
    transform: `translateX(-50%) translateY(${visible ? 0 : -20}px)`,
    opacity: visible ? 1 : 0, transition: 'all .3s ease',
    background: '#161b22', border: `1px solid ${levelledUp ? 'rgba(163,113,247,.5)' : isRepeat ? 'rgba(88,166,255,.4)' : 'rgba(250,204,21,.5)'}`,
    borderRadius: 12, padding: '12px 20px', zIndex: 9998,
    minWidth: 300, pointerEvents: 'none',
    boxShadow: `0 8px 32px rgba(0,0,0,.5)`,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: levelledUp ? '#a371f7' : isRepeat ? '#58a6ff' : '#facc15', fontFamily: 'Inter,sans-serif' }}>
        {levelledUp ? `🎊 Level Up! → Level ${newLevel}` : isRepeat ? '🔄 Quest Replayed' : '🎉 Quest Completed!'}
      </span>
      <span style={{ fontSize: 10, color: '#484f58', fontFamily: 'Inter,sans-serif' }}>just now</span>
    </div>
    <div style={{ fontSize: 18, fontWeight: 900, color: levelledUp ? '#a371f7' : isRepeat ? '#58a6ff' : '#facc15', marginBottom: 3, fontFamily: "'JetBrains Mono',monospace" }}>
      +{xpGained} XP
    </div>
    <div style={{ fontSize: 12, color: '#8b949e', fontFamily: 'Inter,sans-serif', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {isRepeat
        ? `Bonus XP for replaying "${questTitle}"`
        : `First completion of "${questTitle}"`}
    </div>
  </div>
);

// ─── Hint Toast ────────────────────────────────────────────────────────────────
const HintToast: React.FC<{ visible: boolean; hintsUsed: number; xpCost: number }> = ({ visible, hintsUsed, xpCost }) => (
  <div style={{
    position: 'fixed', top: 68, right: 24,
    transform: `translateX(${visible ? 0 : 20}px)`,
    opacity: visible ? 1 : 0, transition: 'all .3s ease',
    background: '#161b22', border: '1px solid rgba(88,166,255,.4)',
    borderRadius: 12, padding: '12px 20px', zIndex: 9997,
    minWidth: 260, pointerEvents: 'none',
    boxShadow: '0 8px 32px rgba(0,0,0,.5)',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#58a6ff', fontFamily: 'Inter,sans-serif' }}>💡 Hint Used</span>
      <span style={{ fontSize: 10, color: '#484f58', fontFamily: 'Inter,sans-serif' }}>#{hintsUsed}</span>
    </div>
    <div style={{ fontSize: 13, fontWeight: 700, color: '#f85149', marginBottom: 3, fontFamily: 'Inter,sans-serif' }}>
      -{xpCost} XP deducted
    </div>
    <div style={{ fontSize: 12, color: '#8b949e', fontFamily: 'Inter,sans-serif' }}>
      Hints reduce your final XP reward.
    </div>
  </div>
);

// ─── PERMANENTLY LOCKED BANNER ────────────────────────────────────────────────
const LockedBanner: React.FC<{ earnedXP: number; title: string; onRetake: () => void }> = ({ earnedXP, title, onRetake }) => (
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
      🔒 Full XP was awarded on your first completion.<br />
      Replaying quests gives a small bonus XP reward only.
    </div>
    <button
      onClick={onRetake}
      style={{
        padding: '11px 32px', borderRadius: 9, border: '1px solid rgba(88,166,255,0.4)',
        background: 'rgba(88,166,255,0.08)', color: '#58a6ff',
        fontWeight: 700, fontSize: 13, cursor: 'pointer',
        fontFamily: 'Inter,sans-serif', transition: 'all .15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(88,166,255,0.18)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(88,166,255,0.08)'; }}
    >
      🔄 Retake Quest (bonus XP only)
    </button>
  </div>
);

// ─── DRAG & DROP ──────────────────────────────────────────────────────────────
const DragDropGame: React.FC<{
  items: GameItem[]; zones: DropZone[];
  onComplete: (score: number, total: number) => void;
  resetSignal: number;
}> = ({ items, zones, onComplete, resetSignal }) => {
  const [dropped,   setDropped]   = React.useState<Record<string, string>>({});
  const [dragOver,  setDragOver]  = React.useState<string | null>(null);
  const [dragging,  setDragging]  = React.useState<string | null>(null);
  const [checked,   setChecked]   = React.useState(false);
  const [results,   setResults]   = React.useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = React.useState(false);

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
        <button onClick={doCheck} disabled={!allFilled || submitted} style={{ flex: 1, padding: '11px 20px', borderRadius: 8, border: 'none', background: !allFilled || submitted ? 'rgba(72,79,88,0.2)' : 'linear-gradient(135deg,#238636,#196127)', color: !allFilled || submitted ? '#484f58' : '#fff', fontWeight: 700, fontSize: 13, cursor: !allFilled || submitted ? 'not-allowed' : 'pointer', fontFamily: 'Inter,sans-serif' }}>
          {submitted ? '✅ Submitted' : 'Check Answers'}
        </button>
      </div>
    </div>
  );
};

// ─── CODE FILL ────────────────────────────────────────────────────────────────
const CodeFillGame: React.FC<{
  items: CodeFillItem[];
  onComplete: (score: number, total: number) => void;
  resetSignal: number;
}> = ({ items, onComplete, resetSignal }) => {
  const [idx,       setIdx]       = React.useState(0);
  const [answers,   setAnswers]   = React.useState<string[]>([]);
  const [checked,   setChecked]   = React.useState(false);
  const [results,   setResults]   = React.useState<boolean[]>([]);

  const scoreRef = React.useRef(0);

  useEffect(() => {
    if (resetSignal > 0) { setIdx(0); setAnswers([]); setChecked(false); setResults([]); scoreRef.current = 0; }
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
    const res = item.answers.map((a, i) => (answers[i] ?? '').trim().toLowerCase() === a.trim().toLowerCase());
    setResults(res); setChecked(true);
    const allCorrect = res.every(Boolean);
    if (allCorrect) scoreRef.current += 1;
    if (allCorrect && isLast) { setTimeout(() => onComplete(scoreRef.current, items.length), 700); }
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
      <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 10, padding: '16px 18px', flex: 1, overflowY: 'auto' }}>
        {rendered}
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

// ─── ORDERING GAME ────────────────────────────────────────────────────────────
const OrderingGame: React.FC<{
  items: OrderItem[];
  onComplete: (score: number, total: number) => void;
  resetSignal: number;
}> = ({ items: rawItems, onComplete, resetSignal }) => {
  const shuffled = React.useMemo(() => [...rawItems].sort(() => Math.random() - 0.5), [rawItems]);
  const [order,     setOrder]     = React.useState<OrderItem[]>(shuffled);
  const [dragging,  setDragging]  = React.useState<number | null>(null);
  const [checked,   setChecked]   = React.useState(false);
  const [correct,   setCorrect]   = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);

  useEffect(() => {
    if (resetSignal > 0) { setOrder([...rawItems].sort(() => Math.random() - 0.5)); setChecked(false); setCorrect(false); setSubmitted(false); setDragging(null); }
  }, [resetSignal, rawItems]);

  const doCheck = () => {
    const isCorrect = order.every((item, i) => item.correct_order === i + 1);
    setChecked(true); setCorrect(isCorrect);
    if (isCorrect) { setSubmitted(true); setTimeout(() => onComplete(1, 1), 700); }
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

// ─── MC GAME ──────────────────────────────────────────────────────────────────
const MCGame: React.FC<{
  questions: MCQ[];
  onComplete: (score: number, total: number) => void;
  resetSignal: number;
}> = ({ questions, onComplete, resetSignal }) => {
  const [qIdx,     setQIdx]     = React.useState(0);
  const [selected, setSelected] = React.useState<number | null>(null);
  const [revealed, setRevealed] = React.useState(false);
  const [done,     setDone]     = React.useState(false);
  const scoreRef = React.useRef(0);

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
    if (isLast) { setDone(true); setTimeout(() => onComplete(scoreRef.current, questions.length), 400); return; }
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

// ─── THEORY SECTION RENDERER ──────────────────────────────────────────────────
const TheorySectionBlock: React.FC<{ sec: TheorySection; idx: number }> = ({ sec }) => {
  const type = sec.type ?? 'default';
  if (type === 'code') return (
    <div style={{ marginBottom: 16, borderRadius: 10, overflow: 'hidden', border: '1px solid #30363d' }}>
      <div style={{ background: '#161b22', padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #21262d' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {['#f85149', '#e3b341', '#3fb950'].map((c, i) => <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />)}
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><span style={{ fontSize: 18 }}>🤔</span><span style={{ fontSize: 10, fontWeight: 800, color: '#a371f7', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '2px', textTransform: 'uppercase' }}>DID YOU KNOW?</span></div>
      {sec.heading && <div style={{ fontSize: 14, fontWeight: 700, color: '#c9d1d9', marginBottom: 6, fontFamily: 'Inter,sans-serif' }}>{sec.heading}</div>}
      {sec.body && <p style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.75, margin: 0, fontFamily: 'Inter,sans-serif' }}>{sec.body}</p>}
    </div>
  );
  return (
    <div style={{ marginBottom: 16, borderRadius: 10, padding: '16px 18px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      {sec.heading && <div style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3', marginBottom: 8, fontFamily: 'Inter,sans-serif' }}>{sec.heading}</div>}
      {sec.body && <p style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.75, margin: 0, fontFamily: 'Inter,sans-serif' }}>{sec.body}</p>}
      {sec.bullets && <ul style={{ paddingLeft: 18, margin: '8px 0 0' }}>{sec.bullets.map((b, i) => <li key={i} style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.7, fontFamily: 'Inter,sans-serif' }}>{b}</li>)}</ul>}
    </div>
  );
};

// ─── TUTORIAL PHASE ────────────────────────────────────────────────────────────
const TutorialLearnPhase: React.FC<{ quest: DBQuest; onStartGame: () => void }> = ({ quest, onStartGame }) => {
  const sections: TheorySection[] = Array.isArray(quest.theory_sections) ? quest.theory_sections : [];
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 28px' }}>
        {quest.tutorial_title && <h2 style={{ fontSize: 20, fontWeight: 800, color: '#e6edf3', marginBottom: 8, fontFamily: 'Inter,sans-serif' }}>{quest.tutorial_title}</h2>}
        {quest.tutorial_body  && <p  style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.8, marginBottom: 20, fontFamily: 'Inter,sans-serif' }}>{quest.tutorial_body}</p>}
        {sections.map((sec, i) => <TheorySectionBlock key={i} sec={sec} idx={i} />)}
      </div>
      <div style={{ padding: '14px 28px', borderTop: '1px solid #21262d', flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onStartGame} style={{ padding: '12px 32px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#238636,#196127)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'Inter,sans-serif', boxShadow: '0 4px 18px rgba(35,134,54,0.35)' }}>
          Start Activity 🎮
        </button>
      </div>
    </div>
  );
};

// ─── GAME SIDE PANEL ──────────────────────────────────────────────────────────
const GameSidePanel: React.FC<{
  quest: DBQuest;
  hintsUsed: number;
  maxHints: number;
  earnedXP: number;
  isCompleted: boolean;
  isRepeatAttempt: boolean;
  onTakeHint: () => void;
}> = ({ quest, hintsUsed, maxHints, earnedXP, isCompleted, isRepeatAttempt, onTakeHint }) => {
  const [activeHint, setActiveHint] = React.useState<number | null>(null);
  const hints = quest.hints ?? [];
  const allHintsUsed = hintsUsed >= maxHints;
  const unlockedHints = hints.slice(0, hintsUsed);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', borderLeft: '1px solid #21262d', background: '#0d1117' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
        <div style={{ fontSize: 9, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 10 }}>OBJECTIVES</div>
        {(quest.objectives ?? []).map((obj, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
            <span style={{ color: '#3fb950', fontSize: 11, marginTop: 1, flexShrink: 0 }}>✦</span>
            <span style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.5, fontFamily: 'Inter,sans-serif' }}>{obj}</span>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
        <div style={{ fontSize: 9, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 10 }}>HINTS</div>
        {unlockedHints.length === 0 && (
          <div style={{ fontSize: 12, color: '#484f58', fontFamily: 'Inter,sans-serif', fontStyle: 'italic' }}>
            Take a hint below to unlock guidance.
          </div>
        )}
        {unlockedHints.map((hint, i) => (
          <div key={i} style={{ marginBottom: 10, borderRadius: 8, border: '1px solid rgba(88,166,255,0.2)', background: 'rgba(88,166,255,0.05)', overflow: 'hidden' }}>
            <button onClick={() => setActiveHint(activeHint === i ? null : i)} style={{ width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: 14 }}>{hint.icon ?? '💡'}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#58a6ff', fontFamily: 'Inter,sans-serif', flex: 1 }}>{hint.title}</span>
              <span style={{ fontSize: 10, color: '#484f58' }}>{activeHint === i ? '▲' : '▼'}</span>
            </button>
            {activeHint === i && (
              <div style={{ padding: '0 12px 12px', fontSize: 12, color: '#8b949e', lineHeight: 1.6, fontFamily: 'Inter,sans-serif' }}>{hint.body}</div>
            )}
          </div>
        ))}
      </div>
      <div style={{ padding: '14px 18px', borderTop: '1px solid #21262d', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 10, color: '#484f58', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '1px' }}>XP REWARD</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: isRepeatAttempt ? '#58a6ff' : '#facc15', fontFamily: "'JetBrains Mono',monospace" }}>{earnedXP} XP</span>
        </div>
        <button onClick={onTakeHint} disabled={allHintsUsed || isCompleted} style={{ flex: 1, width: '100%', padding: '9px 10px', borderRadius: 9, border: 'none', background: allHintsUsed || isCompleted ? 'rgba(72,79,88,0.2)' : 'linear-gradient(135deg,#06b6d4,#0891b2)', color: allHintsUsed || isCompleted ? '#484f58' : '#000', fontWeight: 700, fontSize: 11, cursor: allHintsUsed || isCompleted ? 'not-allowed' : 'pointer', fontFamily: 'Inter,sans-serif', boxShadow: allHintsUsed || isCompleted ? 'none' : '0 4px 14px rgba(6,182,212,.35)', transition: 'all .15s' }}>
          {allHintsUsed ? 'No more hints' : `TAKE A HINT (${maxHints - hintsUsed} left)`}
        </button>
      </div>
    </div>
  );
};

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export const LessonActivity: React.FC = () => {
  const navigate    = useNavigate();
  const { questId } = useParams<{ questId: string }>();
  const { user }    = useAuth();

  const completedGamesRef      = useRef<string[]>([]);
  const previouslyCompletedRef = useRef<string[]>([]);
  const cumulativeXPRef        = useRef<number>(0);
  const hintsUsedRef           = useRef<number>(0);

  const [quest,           setQuest]           = useState<DBQuest | null>(null);
  const [loading,         setLoading]         = useState(true);
  const [fetchError,      setFetchError]      = useState<string | null>(null);
  const [hintsUsed,       setHintsUsed]       = useState(0);
  const [progressId,      setProgressId]      = useState<string | null>(null);
  const [userXP,          setUserXP]          = useState(0);
  const [userLevel,       setUserLevel]       = useState(1);
  const [isCompleted,     setIsCompleted]     = useState(false);
  const [earnedXP,        setEarnedXP]        = useState(0);

  const [xpToastVisible,   setXpToastVisible]   = useState(false);
  const [xpToastAmount,    setXpToastAmount]    = useState(0);
  const [xpToastRepeat,    setXpToastRepeat]    = useState(false);
  const [xpToastLevelUp,   setXpToastLevelUp]   = useState(false);
  const [xpToastNewLevel,  setXpToastNewLevel]  = useState<number | undefined>(undefined);
  const [hintToastVisible, setHintToastVisible] = useState(false);

  const [activeTab,   setActiveTab]   = useState<'drag' | 'code_fill' | 'balloon' | 'ordering' | 'mc'>('drag');
  const [appPhase,    setAppPhase]    = useState<'tutorial' | 'game'>('tutorial');
  const [resetSignal, setResetSignal] = useState(0);

  const xpToastTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const questPhase     = useRef<string>('beginner');

  const maxHints   = Math.max(quest?.hints?.length ?? 0, 1);
  const levelNum   = quest?.level ?? 1;
  const phaseLabel = quest?.phase ? `${quest.phase.charAt(0).toUpperCase() + quest.phase.slice(1)} · Level ${levelNum}` : `Level ${levelNum}`;
  const baseXP     = quest?.basexp ?? 0;

  const isRepeatAttempt = previouslyCompletedRef.current.includes(activeTab);
  const repeatBonusXP   = Math.max(REPEAT_XP_MIN, Math.round(baseXP * REPEAT_XP_FRACTION));
  const displayXP = isCompleted
    ? earnedXP
    : isRepeatAttempt
      ? repeatBonusXP
      : Math.max(1, baseXP - hintsUsed * XP_PER_HINT);

  // AFTER
const withTimeout = <T,>(thenable: PromiseLike<T>, ms = FETCH_TIMEOUT_MS): Promise<T> => {
  return Promise.race([
    Promise.resolve(thenable),          // ← wraps thenable into a real Promise
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
};

  // ── Initial fetch ────────────────────────────────────────────────────────────
  const doFetch = useCallback(async () => {
    if (!questId || !user?.id) {
      if (!questId) setFetchError('No quest ID in URL. Make sure you navigate with a valid quest UUID.');
      setLoading(false);
      return;
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(questId)) {
      setFetchError(`"${questId}" is not a valid quest UUID.`);
      setLoading(false);
      return;
    }

    setLoading(true);
    setFetchError(null);

    try {
      const { data: q, error: qErr } = await withTimeout(
        supabase
          .from('quests')
          .select('id,title,description,basexp,objectives,hints,question_type,game_items,drop_zones,ordering_items,mc_questions,code_fill_items,tutorial_title,tutorial_body,tutorial_image,theory_sections,phase,level')
          .eq('id', questId)
          .single()
      );

      if (qErr) { setFetchError(`DB error: ${qErr.message}`); setLoading(false); return; }
      if (!q)   { setFetchError(`Quest "${questId}" was not found.`); setLoading(false); return; }

      setQuest(q);
      questPhase.current = q.phase ?? 'beginner';

      const firstTab = (() => {
        if (q.game_items?.length)      return 'drag';
        if (q.code_fill_items?.length) return 'code_fill';
        if (q.mc_questions?.length)    return 'balloon';
        if (q.ordering_items?.length)  return 'ordering';
        return 'drag';
      })() as 'drag' | 'code_fill' | 'balloon' | 'ordering' | 'mc';
      setActiveTab(firstTab);

      const { data: ud } = await withTimeout(
        supabase.from('users').select('totalxp,currentlevel').eq('id', user.id).single()
      );
      if (ud) {
        setUserXP(ud.totalxp ?? 0);
        setUserLevel(ud.currentlevel ?? 1);
      }

      const { data: ex } = await withTimeout(
        supabase
          .from('mission_progress')
          .select('id,hintsused,status,xp_gained,completed_activities')
          .eq('userid', user.id)
          .eq('questid', questId)
          .order('startedat', { ascending: false })
          .limit(1)
          .maybeSingle()
      );

      if (ex) {
        setProgressId(ex.id);
        setHintsUsed(ex.hintsused ?? 0);
        hintsUsedRef.current = ex.hintsused ?? 0;

        const alreadyDone: string[] = Array.isArray(ex.completed_activities) ? ex.completed_activities : [];
        completedGamesRef.current      = alreadyDone;
        previouslyCompletedRef.current = alreadyDone;
        cumulativeXPRef.current        = ex.xp_gained ?? 0;

        if (ex.status === 'completed') {
          setIsCompleted(true);
          setEarnedXP(ex.xp_gained ?? q?.basexp ?? 0);
          setAppPhase('game');
        }
      } else {
        const { data: ins, error: insErr } = await withTimeout(
          supabase
            .from('mission_progress')
            .upsert({
              userid: user.id, questid: questId, status: 'active',
              attempts: 0, hintsused: 0, completed_activities: [],
              startedat: new Date().toISOString(),
            }, { onConflict: 'userid,questid' })
            .select('id').single()
        );
        if (insErr) console.error('Initial progress upsert failed:', insErr);
        if (ins) { setProgressId(ins.id); cumulativeXPRef.current = 0; }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred while loading the quest.';
      console.error('[LessonActivity] Fetch error:', err);
      setFetchError(msg);
    } finally {
      setLoading(false);
    }
  }, [questId, user?.id]);

  useEffect(() => { doFetch(); }, [doFetch]);

  // ── Realtime: users XP + mission_progress state ───────────────────────────
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`lesson-realtime-${user.id}-${questId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${user.id}` },
        payload => {
          const newXP    = payload.new?.totalxp;
          const newLevel = payload.new?.currentlevel;
          if (typeof newXP    === 'number') setUserXP(newXP);
          if (typeof newLevel === 'number') setUserLevel(newLevel);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE', schema: 'public', table: 'mission_progress',
          filter: `userid=eq.${user.id}`,
        },
        payload => {
          if (payload.new?.questid !== questId) return;
          const newStatus     = payload.new?.status;
          const newXPGained   = payload.new?.xp_gained;
          const newActivities = payload.new?.completed_activities;

          if (Array.isArray(newActivities)) {
            completedGamesRef.current = newActivities;
          }
          if (newStatus === 'completed' && !isCompleted) {
            setIsCompleted(true);
            setEarnedXP(newXPGained ?? 0);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id, questId, isCompleted]);

  // ── Hint handler ─────────────────────────────────────────────────────────────
  const handleTakeHint = useCallback(async () => {
    if (hintsUsed >= maxHints || !quest || !user?.id || isCompleted || !progressId) return;

    const next = hintsUsed + 1;

    setUserXP(prev => Math.max(0, prev - XP_PER_HINT));
    setHintsUsed(next);
    hintsUsedRef.current = next;

    if (hintToastTimer.current) clearTimeout(hintToastTimer.current);
    setHintToastVisible(true);
    hintToastTimer.current = setTimeout(() => setHintToastVisible(false), 3500);

    try {
      const { data, error } = await supabase.rpc('deduct_hint_xp', {
        p_user_id:     user.id,
        p_progress_id: progressId,
        p_xp_cost:     XP_PER_HINT,
      });

      if (error) throw new Error(`deduct_hint_xp failed: ${error.message}`);

      if (typeof data?.new_totalxp === 'number') setUserXP(data.new_totalxp);
      if (typeof data?.hints_used  === 'number') setHintsUsed(data.hints_used);

    } catch (err) {
      console.error('hint deduct:', err);
      setUserXP(prev => prev + XP_PER_HINT);
      setHintsUsed(prev => { hintsUsedRef.current = Math.max(0, prev - 1); return hintsUsedRef.current; });
    }
  }, [hintsUsed, maxHints, progressId, quest, user, isCompleted]);

  // ── Tab definitions — single source of truth ─────────────────────────────────
  // Defined BEFORE handleComplete so the callback can reference ALL_TABS directly.
  const ALL_TABS = [
    { id: 'drag'      as const, label: '🃏 Drag & Drop', hasData: !!(quest?.game_items?.length) },
    { id: 'code_fill' as const, label: '💻 Code Fill',   hasData: !!(quest?.code_fill_items?.length) },
    { id: 'balloon'   as const, label: '🎈 Balloon Pop', hasData: !!(quest?.mc_questions?.length) },
    { id: 'ordering'  as const, label: '🔢 Ordering',    hasData: !!(quest?.ordering_items?.length) },
    { id: 'mc'        as const, label: '🧠 Quiz',        hasData: !!(quest?.mc_questions?.length) },
  ];
  const TABS = ALL_TABS.filter(t => t.hasData);

  // ── Completion handler ────────────────────────────────────────────────────────
  const handleComplete = useCallback(async (score: number, total: number) => {
    if (!user?.id || !quest) return;
    if (completedGamesRef.current.includes(activeTab)) return;

    const wasAlreadyDone = previouslyCompletedRef.current.includes(activeTab);

    // FIX v3: derive required tabs from what data actually exists on the quest,
    // using the same ALL_TABS list that drives the tab bar — they can never
    // get out of sync. The old code only looked at quest.question_type (one tab),
    // so completing any single tab immediately completed the whole quest.
    const uniqueRequired = ALL_TABS
      .filter(t => t.hasData)
      .map(t => t.id);

    const newFinished = [...new Set([...completedGamesRef.current, activeTab])];
    completedGamesRef.current = newFinished;

    let xpGainedNow: number;
    if (wasAlreadyDone) {
      xpGainedNow = Math.max(REPEAT_XP_MIN, Math.round(quest.basexp * REPEAT_XP_FRACTION));
    } else {
      const xpPerGame   = Math.floor(quest.basexp / (uniqueRequired.length || 1));
      const ratio       = total > 0 ? score / total : 1;
      const hintPenalty = Math.round(hintsUsedRef.current * XP_PER_HINT / (uniqueRequired.length || 1));
      xpGainedNow       = Math.max(1, Math.round(xpPerGame * ratio) - hintPenalty);
    }

    cumulativeXPRef.current += xpGainedNow;

    const allActivitiesDone     = uniqueRequired.every(g => newFinished.includes(g));
    const isFirstFullCompletion = allActivitiesDone && !isCompleted;

    try {
      const { data: rpcResult, error: rpcErr } = await supabase.rpc('complete_campaign_quest', {
        p_userid:               user.id,
        p_questid:              quest.id,
        p_xp_gained:            cumulativeXPRef.current,
        p_xp_delta:             xpGainedNow,
        p_completed_activities: JSON.stringify(newFinished),
        p_hintsused:            hintsUsedRef.current,
        p_is_full_completion:   isFirstFullCompletion,
      });

      if (rpcErr) throw new Error(`complete_campaign_quest RPC failed: ${rpcErr.message}`);

      const newTotal   = rpcResult?.new_totalxp;
      const newLevel   = rpcResult?.new_level;
      const levelledUp = rpcResult?.levelled_up === true;

      if (typeof newTotal === 'number') setUserXP(newTotal);
      if (typeof newLevel === 'number') setUserLevel(newLevel);

      if (isFirstFullCompletion) {
        setIsCompleted(true);
        setEarnedXP(cumulativeXPRef.current);
      }

      setXpToastAmount(xpGainedNow);
      setXpToastRepeat(wasAlreadyDone);
      setXpToastLevelUp(levelledUp);
      setXpToastNewLevel(levelledUp ? newLevel : undefined);
      if (xpToastTimer.current) clearTimeout(xpToastTimer.current);
      setXpToastVisible(true);
      xpToastTimer.current = setTimeout(() => setXpToastVisible(false), 4500);

    } catch (err) {
      completedGamesRef.current  = completedGamesRef.current.filter(g => g !== activeTab);
      cumulativeXPRef.current   -= xpGainedNow;
      console.error('XP Award Error:', err);
    }
  }, [activeTab, quest, user, hintsUsed, isCompleted]);

  const handleReset  = () => setResetSignal(s => s + 1);
  const handleGoBack = () => setAppPhase('tutorial');

  // ── Retake ───────────────────────────────────────────────────────────────────
  const handleRetake = useCallback(async () => {
    if (!user?.id || !quest) return;

    try {
      const { error } = await supabase.rpc('reset_quest_for_retake', {
        p_userid:  user.id,
        p_questid: quest.id,
      });
      if (error) throw new Error(`reset_quest_for_retake failed: ${error.message}`);
    } catch (err) {
      console.error('Retake reset error:', err);
      return;
    }

    previouslyCompletedRef.current = completedGamesRef.current;
    completedGamesRef.current      = [];
    cumulativeXPRef.current        = 0;
    setIsCompleted(false);
    setHintsUsed(0);
    hintsUsedRef.current = 0;
    setResetSignal(s => s + 1);

    const firstTab = (() => {
      if (quest.game_items?.length)      return 'drag';
      if (quest.code_fill_items?.length) return 'code_fill';
      if (quest.mc_questions?.length)    return 'balloon';
      if (quest.ordering_items?.length)  return 'ordering';
      return 'drag';
    })() as 'drag' | 'code_fill' | 'balloon' | 'ordering' | 'mc';
    setActiveTab(firstTab);
    setAppPhase('tutorial');
  }, [user?.id, quest]);

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
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(163,113,247,0.1)', border: '1px solid rgba(163,113,247,0.3)', borderRadius: 6, padding: '4px 11px' }}>
              <span style={{ fontSize: 11 }}>🏅</span>
              <span style={{ fontSize: 12, color: '#a371f7', fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>Lv.{userLevel}</span>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {isRepeatAttempt && !isCompleted && (
                <div style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(88,166,255,0.08)', border: '1px solid rgba(88,166,255,0.25)', fontSize: 11, color: '#58a6ff', fontFamily: 'Inter,sans-serif' }}>
                  🔄 Replay
                </div>
              )}
              <div style={{ padding: '5px 14px', borderRadius: 9, background: isCompleted ? 'rgba(63,185,80,0.12)' : isRepeatAttempt ? 'rgba(88,166,255,0.08)' : 'rgba(250,204,21,0.08)', border: `1px solid ${isCompleted ? 'rgba(63,185,80,0.5)' : isRepeatAttempt ? 'rgba(88,166,255,0.3)' : 'rgba(250,204,21,0.3)'}`, fontSize: 13, fontWeight: 800, color: isCompleted ? '#3fb950' : isRepeatAttempt ? '#58a6ff' : '#facc15', fontFamily: "'JetBrains Mono',monospace" }}>
                {isCompleted ? `🔒 +${earnedXP} XP earned` : `+${displayXP} XP available`}
              </div>
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
              <div style={{ fontSize: 18, fontWeight: 800, color: '#f85149', fontFamily: 'Inter,sans-serif' }}>
                {fetchError.includes('timed out') ? 'Connection Timed Out' : 'Quest Not Found'}
              </div>
              <div style={{ fontSize: 13, color: '#8b949e', fontFamily: 'Inter,sans-serif', maxWidth: 480, lineHeight: 1.7, background: 'rgba(218,54,51,0.07)', border: '1px solid rgba(218,54,51,0.2)', borderRadius: 10, padding: '14px 18px' }}>{fetchError}</div>
              <div style={{ display: 'flex', gap: 10 }}>
                {fetchError.includes('timed out') || fetchError.includes('error') ? (
                  <button onClick={doFetch} style={{ padding: '10px 24px', borderRadius: 8, border: '1px solid rgba(63,185,80,0.4)', background: 'rgba(63,185,80,0.08)', color: '#3fb950', fontSize: 13, cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 700 }}>↺ Retry</button>
                ) : null}
                <button onClick={() => navigate(-1)} style={{ padding: '10px 24px', borderRadius: 8, border: '1px solid #30363d', background: 'transparent', color: '#8b949e', fontSize: 13, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>← Go Back</button>
              </div>
            </div>
          ) : !quest ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#484f58', fontSize: 13, fontFamily: 'Inter,sans-serif' }}>Quest not found.</div>
          ) : appPhase === 'tutorial' ? (
            <TutorialLearnPhase quest={quest} onStartGame={() => setAppPhase('game')} />
          ) : (
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 300px', minHeight: 0, overflow: 'hidden' }}>
              {/* LEFT: game panel */}
              <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                <div style={{ padding: '14px 22px 10px', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h1 style={{ fontSize: 22, fontWeight: 900, color: '#e6edf3', letterSpacing: '0.3px', fontFamily: 'Inter,sans-serif', textTransform: 'uppercase' }}>
                      {isCompleted ? '🏆 QUEST COMPLETED' : tabTitle(activeTab)}
                    </h1>
                    {isCompleted && <div style={{ padding: '4px 12px', borderRadius: 6, background: 'rgba(63,185,80,0.12)', border: '1px solid rgba(63,185,80,0.3)', fontSize: 11, color: '#3fb950', fontFamily: 'Inter,sans-serif' }}>🔒 Locked · {earnedXP} XP earned</div>}
                    {!isCompleted && isRepeatAttempt && <div style={{ padding: '4px 12px', borderRadius: 6, background: 'rgba(88,166,255,0.08)', border: '1px solid rgba(88,166,255,0.25)', fontSize: 11, color: '#58a6ff', fontFamily: 'Inter,sans-serif' }}>🔄 Replay — +{repeatBonusXP} XP bonus</div>}
                  </div>
                  {!isCompleted && <p style={{ fontSize: 11, color: '#484f58', marginTop: 3, fontFamily: "'JetBrains Mono',monospace" }}>{tabSubtitle(activeTab)}</p>}
                </div>

                {/* Tab row */}
                {!isCompleted && (
                  <div style={{ display: 'flex', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
                    {TABS.map(tab => {
                      const isDoneTab  = completedGamesRef.current.includes(tab.id);
                      const isSelected = activeTab === tab.id;
                      return (
                        <button key={tab.id} disabled={isDoneTab}
                          onClick={() => { setActiveTab(tab.id); handleReset(); }}
                          style={{ flex: 1, padding: '9px 6px', border: 'none', borderBottom: `2px solid ${isSelected ? '#58a6ff' : 'transparent'}`, background: isSelected ? 'rgba(56,139,253,0.07)' : 'transparent', color: isDoneTab ? '#3fb950' : isSelected ? '#58a6ff' : '#484f58', cursor: isDoneTab ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 10, fontFamily: "'JetBrains Mono',monospace", opacity: isDoneTab ? 0.6 : 1, transition: 'all .15s', position: 'relative' }}>
                          {tab.label}
                          {isDoneTab && <span style={{ position: 'absolute', top: 4, right: 4, fontSize: 8, color: '#3fb950' }}>✓ DONE</span>}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Game content */}
                <div style={{ flex: 1, padding: (!isCompleted && activeTab === 'balloon') ? '0' : '16px 22px', display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                  {isCompleted ? (
                    <LockedBanner earnedXP={earnedXP} title={quest.title} onRetake={handleRetake} />
                  ) : completedGamesRef.current.includes(activeTab) ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#3fb950' }}>
                      <span style={{ fontSize: 40 }}>✅</span>
                      <span style={{ fontWeight: 700 }}>Activity Secured</span>
                      <span style={{ color: '#8b949e', fontSize: 12 }}>You have finished this part. Please complete the remaining tabs.</span>
                    </div>
                  ) : (
                    <>
                      {activeTab === 'drag'      && <DragDropGame items={quest.game_items ?? []} zones={quest.drop_zones ?? []} onComplete={handleComplete} resetSignal={resetSignal} />}
                      {activeTab === 'code_fill' && <CodeFillGame items={quest.code_fill_items ?? []} onComplete={handleComplete} resetSignal={resetSignal} />}
                      {activeTab === 'balloon'   && (
                        quest.mc_questions && quest.mc_questions.length > 0
                          ? <BalloonPopGame questions={quest.mc_questions} onComplete={handleComplete} />
                          : <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#484f58', fontFamily: 'Inter,sans-serif', fontSize: 13, textAlign: 'center', padding: 24 }}>
                              <span style={{ fontSize: 40 }}>🎈</span>
                              <span>No <code>mc_questions</code> found for this quest.</span>
                            </div>
                      )}
                      {activeTab === 'ordering'  && <OrderingGame items={quest.ordering_items ?? []} onComplete={handleComplete} resetSignal={resetSignal} />}
                      {activeTab === 'mc'        && <MCGame questions={quest.mc_questions ?? []} onComplete={handleComplete} resetSignal={resetSignal} />}
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
                  isRepeatAttempt={isRepeatAttempt}
                  onTakeHint={handleTakeHint}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <XPToast
        visible={xpToastVisible}
        xpGained={xpToastAmount}
        isRepeat={xpToastRepeat}
        questTitle={quest?.title ?? ''}
        levelledUp={xpToastLevelUp}
        newLevel={xpToastNewLevel}
      />
      <HintToast visible={hintToastVisible} hintsUsed={hintsUsed} xpCost={XP_PER_HINT} />
    </>
  );
};

export default LessonActivity;