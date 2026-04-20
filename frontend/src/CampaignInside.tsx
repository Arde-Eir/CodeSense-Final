import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from './components/AuthScreen';
import { supabase } from './services/supabase';

// ─── Types matching your real schema ─────────────────────────────────────────

interface DBQuest {
  id: string;
  title: string;
  description: string | null;
  difficulty: 'easy' | 'medium' | 'hard' | null;
  level: number | null;
  phase: 'beginner' | 'intermediate' | 'advanced' | null;
  basexp: number;
  requiredxp: number;
  hints: { icon?: string; title: string; body: string; image?: boolean }[] | null;
  startercode: string | null;
  expectedoutput: string | null;
  objectives: string[] | null;
  sortorder: number;
  isactive: boolean;
}

interface MissionProgress {
  id: string;
  questid: string;
  status: 'active' | 'completed' | 'locked';
  attempts: number;
  hintsused: number;
  startedat: string | null;
  completedat: string | null;
}

interface Quest extends DBQuest {
  uiStatus: 'completed' | 'active' | 'locked';
  progressId: string | null;
  attempts: number;
}

// ─── Phase config ─────────────────────────────────────────────────────────────

interface PhaseConfig {
  label: string;
  subtitle: string;
  color: string;
  glow: string;
  bg: string;
  icon: string;
}

const PHASE_CONFIG: Record<string, PhaseConfig> = {
  beginner: {
    label: 'History of C++',
    subtitle: 'Beginner · Level 1',
    color: '#4ade80',
    glow: 'rgba(74,222,128,0.3)',
    bg: 'linear-gradient(135deg,#0a1f12,#0d2a18)',
    icon: '🌱',
  },
  intermediate: {
    label: 'Core Mechanics',
    subtitle: 'Intermediate · Level 2',
    color: '#facc15',
    glow: 'rgba(250,204,21,0.3)',
    bg: 'linear-gradient(135deg,#1a1400,#241c00)',
    icon: '⚔️',
  },
  advanced: {
    label: 'Safety Mastery',
    subtitle: 'Advanced · Level 3',
    color: '#f87171',
    glow: 'rgba(248,113,113,0.3)',
    bg: 'linear-gradient(135deg,#1a0808,#240d0d)',
    icon: '🔥',
  },
};

// ─── Drag & Drop data ─────────────────────────────────────────────────────────

interface DragItem { id: string; label: string; color: string; }
interface DropZone { id: string; label: string; accepted: string; }

const DRAG_ITEMS: DragItem[] = [
  { id: 'd_int',    label: 'int',    color: '#58a6ff' },
  { id: 'd_float',  label: 'float',  color: '#a371f7' },
  { id: 'd_char',   label: 'char',   color: '#f0883e' },
  { id: 'd_string', label: 'string', color: '#3fb950' },
  { id: 'd_bool',   label: 'bool',   color: '#e3b341' },
  { id: 'd_void',   label: 'void',   color: '#f85149' },
];

const DROP_ZONES: DropZone[] = [
  { id: 'z1', label: 'stores whole numbers',      accepted: 'd_int'   },
  { id: 'z2', label: 'stores decimal values',     accepted: 'd_float' },
  { id: 'z3', label: 'stores a single character', accepted: 'd_char'  },
];

const DEFAULT_STARTER_CODE = `#include <iostream>
using namespace std;

int main() {
    int x = 10;
    float y = 3.14;
    char c = 'A';
    
    cout << x << endl;
    cout << y << endl;
    cout << c << endl;
    return 0;
}`;

const DEFAULT_HINTS = [
  {
    icon: '🎯', title: 'What is a Data Type?',
    body: 'A data type tells C++ what kind of value a variable will hold. Think of it as the shape of a container — an int holds whole numbers, a float holds decimals.',
    image: true,
  },
  {
    icon: '🔢', title: 'Numeric Types',
    body: 'int stores integers. float stores 32-bit decimals. double stores 64-bit decimals for higher precision. Use int for counting, float/double for measurements.',
    image: false,
  },
  {
    icon: '💡', title: 'Tip: Type Matching',
    body: 'Always match your type to your data. Assigning 3.14 to an int silently truncates it to 3 — a very common source of bugs.',
    image: false,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const diffColor = (d: string | null) =>
  d === 'easy' ? '#3fb950' : d === 'medium' ? '#e3b341' : d === 'hard' ? '#f85149' : '#484f58';

// ─── XP Burst ─────────────────────────────────────────────────────────────────

// FIX: accepts the actual xpEarned value so the toast always shows what was
// really awarded, not the quest's basexp ceiling.
const XPBurst: React.FC<{ xp: number; visible: boolean }> = ({ xp, visible }) =>
  visible ? (
    <div style={{
      position: 'fixed', top: '50%', left: '50%',
      transform: 'translate(-50%,-50%)',
      zIndex: 9999, pointerEvents: 'none',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      animation: 'xpBurstIn 0.4s ease-out',
    }}>
      <div style={{ fontSize: 56 }}>⭐</div>
      <div style={{
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 28, fontWeight: 800, color: '#facc15',
        textShadow: '0 0 20px rgba(250,204,21,0.8)',
      }}>+{xp} XP</div>
    </div>
  ) : null;

// ─── Drag & Drop Activity ─────────────────────────────────────────────────────

const DragDropActivity: React.FC<{ onComplete: (score: number) => void }> = ({ onComplete }) => {
  const [dropped, setDropped] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [results, setResults] = useState<Record<string, boolean>>({});

  const handleDrop = (zoneId: string, itemId: string) => {
    setDropped(prev => ({ ...prev, [zoneId]: itemId }));
    setDragOver(null);
    setChecked(false);
  };

  const handleCheck = () => {
    const r: Record<string, boolean> = {};
    DROP_ZONES.forEach(z => { r[z.id] = dropped[z.id] === z.accepted; });
    setResults(r);
    setChecked(true);
    const score = Object.values(r).filter(Boolean).length;
    if (score === DROP_ZONES.length) setTimeout(() => onComplete(score), 800);
  };

  const usedItems = new Set(Object.values(dropped));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      <div style={{
        background: 'rgba(88,166,255,0.06)', border: '1px solid rgba(88,166,255,0.2)',
        borderRadius: 10, padding: '10px 14px',
        fontSize: 12, color: '#8b949e', lineHeight: 1.6,
        fontFamily: "'IBM Plex Mono', monospace",
      }}>
        🧩 Drag each C++ data type to its matching description
      </div>

      <div style={{ display: 'flex', gap: 20, flex: 1, minHeight: 0 }}>
        <div style={{ width: 130, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 9, color: '#484f58', fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Types</div>
          {DRAG_ITEMS.map(item => {
            const isUsed = usedItems.has(item.id);
            return (
              <div
                key={item.id}
                draggable={!isUsed}
                onDragStart={() => !isUsed && setDragging(item.id)}
                onDragEnd={() => setDragging(null)}
                style={{
                  padding: '8px 12px', borderRadius: 8,
                  border: `1.5px solid ${isUsed ? '#21262d' : item.color + '66'}`,
                  background: isUsed ? 'rgba(255,255,255,0.02)' : `${item.color}12`,
                  color: isUsed ? '#484f58' : item.color,
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 13, fontWeight: 700,
                  cursor: isUsed ? 'not-allowed' : 'grab',
                  opacity: isUsed ? 0.35 : dragging === item.id ? 0.5 : 1,
                  transition: 'all 0.15s', userSelect: 'none', textAlign: 'center',
                  transform: dragging === item.id ? 'scale(0.95)' : 'scale(1)',
                }}
              >{item.label}</div>
            );
          })}
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 9, color: '#484f58', fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Descriptions</div>
          {DROP_ZONES.map(zone => {
            const droppedItem = DRAG_ITEMS.find(i => i.id === dropped[zone.id]);
            const isOver = dragOver === zone.id;
            const isCorrect = results[zone.id];
            let borderColor = isOver ? '#58a6ff' : '#21262d';
            if (checked && dropped[zone.id]) borderColor = isCorrect ? '#3fb950' : '#f85149';

            return (
              <div
                key={zone.id}
                onDragOver={e => { e.preventDefault(); setDragOver(zone.id); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={e => { e.preventDefault(); if (dragging) handleDrop(zone.id, dragging); }}
                style={{
                  flex: 1, border: `2px dashed ${borderColor}`,
                  borderRadius: 10, padding: '10px 14px',
                  display: 'flex', alignItems: 'center', gap: 12,
                  background: isOver ? 'rgba(88,166,255,0.06)'
                    : checked && dropped[zone.id]
                    ? isCorrect ? 'rgba(63,185,80,0.05)' : 'rgba(248,81,73,0.05)'
                    : 'rgba(255,255,255,0.02)',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{
                  minWidth: 72, height: 34,
                  border: `1.5px solid ${droppedItem ? droppedItem.color + '66' : '#21262d'}`,
                  borderRadius: 7,
                  background: droppedItem ? `${droppedItem.color}12` : 'rgba(255,255,255,0.02)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 700,
                  color: droppedItem ? droppedItem.color : '#2d333b',
                }}>
                  {droppedItem ? droppedItem.label : '?'}
                </div>
                <span style={{ flex: 1, fontSize: 12, color: '#8b949e', lineHeight: 1.4 }}>{zone.label}</span>
                {checked && dropped[zone.id] && (
                  <span style={{ fontSize: 16 }}>{isCorrect ? '✅' : '❌'}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={() => { setDropped({}); setChecked(false); setResults({}); }} style={{
          padding: '9px 18px', borderRadius: 8, border: '1px solid #f85149',
          background: 'rgba(248,81,73,0.08)', color: '#f85149', fontWeight: 700, fontSize: 12,
          cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace",
        }}>Reset</button>
        <button onClick={handleCheck} disabled={Object.keys(dropped).length < DROP_ZONES.length} style={{
          flex: 1, padding: '9px 18px', borderRadius: 8, border: 'none',
          background: Object.keys(dropped).length < DROP_ZONES.length ? 'rgba(63,185,80,0.2)' : '#3fb950',
          color: Object.keys(dropped).length < DROP_ZONES.length ? '#484f58' : '#000',
          fontWeight: 700, fontSize: 12,
          cursor: Object.keys(dropped).length < DROP_ZONES.length ? 'not-allowed' : 'pointer',
          fontFamily: "'IBM Plex Mono', monospace",
        }}>
          {checked ? 'Check Again' : 'Check Answer'}
        </button>
      </div>

      {checked && (
        <div style={{
          padding: '10px 14px', borderRadius: 8,
          background: Object.values(results).every(Boolean) ? 'rgba(63,185,80,0.1)' : 'rgba(248,81,73,0.08)',
          border: `1px solid ${Object.values(results).every(Boolean) ? 'rgba(63,185,80,0.4)' : 'rgba(248,81,73,0.3)'}`,
          fontSize: 12, color: Object.values(results).every(Boolean) ? '#3fb950' : '#f85149',
          fontFamily: "'IBM Plex Mono', monospace", textAlign: 'center',
        }}>
          {Object.values(results).every(Boolean)
            ? '🎉 Perfect! All types matched correctly.'
            : `${Object.values(results).filter(Boolean).length}/${DROP_ZONES.length} correct — try again!`}
        </div>
      )}
    </div>
  );
};

// ─── Manual Input Activity ────────────────────────────────────────────────────

const ManualInputActivity: React.FC<{
  starterCode: string;
  expectedOutput: string | null;
  onComplete: (score: number) => void;
}> = ({ starterCode, expectedOutput, onComplete }) => {
  const [code, setCode] = useState(starterCode);
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [sandboxResult, setSandboxResult] = useState<'pass' | 'fail' | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setSandboxResult(null);
    await new Promise(r => setTimeout(r, 900));
    const hasInt   = code.includes('int')   && !code.trim().startsWith('//');
    const hasFloat = code.includes('float') || code.includes('double');
    const hasCout  = code.includes('cout');
    if (hasCout) {
      const lines: string[] = [];
      if (hasInt)   lines.push('10');
      if (hasFloat) lines.push('3.14');
      lines.push('A');
      const result = lines.join('\n');
      setOutput(result);
      const passed = expectedOutput ? result.trim() === expectedOutput.trim() : true;
      setSandboxResult(passed ? 'pass' : 'fail');
      if (passed) setTimeout(() => onComplete(3), 600);
    } else {
      setOutput('No output statement found.');
      setSandboxResult('fail');
    }
    setRunning(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, height: '100%' }}>
      <div style={{
        background: 'rgba(163,113,247,0.06)', border: '1px solid rgba(163,113,247,0.2)',
        borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#8b949e',
        lineHeight: 1.6, fontFamily: "'IBM Plex Mono', monospace",
      }}>
        ⌨️ Modify the code to declare all three types and print them with cout
      </div>

      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        border: '1px solid #21262d', borderRadius: 10, overflow: 'hidden',
        background: '#010409', minHeight: 0,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 12px', background: '#0d1117', borderBottom: '1px solid #21262d',
        }}>
          <div style={{ display: 'flex', gap: 5 }}>
            {['#f85149', '#e3b341', '#3fb950'].map((c, i) => (
              <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: c, opacity: 0.7 }} />
            ))}
          </div>
          <span style={{ flex: 1, textAlign: 'center', fontSize: 10, color: '#484f58', fontFamily: "'IBM Plex Mono', monospace" }}>main.cpp</span>
          {sandboxResult && (
            <span style={{ fontSize: 9, fontWeight: 700, color: sandboxResult === 'pass' ? '#3fb950' : '#f85149', fontFamily: "'IBM Plex Mono', monospace" }}>
              {sandboxResult === 'pass' ? '● PASS' : '● FAIL'}
            </span>
          )}
        </div>
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ width: 36, padding: '12px 0', background: '#010409', borderRight: '1px solid #1c2128', textAlign: 'right' }}>
            {code.split('\n').map((_, i) => (
              <div key={i} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, lineHeight: '20px', paddingRight: 8, color: '#2d333b' }}>{i + 1}</div>
            ))}
          </div>
          <textarea
            value={code}
            onChange={e => setCode(e.target.value)}
            spellCheck={false}
            style={{
              flex: 1, padding: '12px', resize: 'none',
              background: 'transparent', border: 'none', outline: 'none',
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: '#c9d1d9', lineHeight: '20px',
            }}
          />
        </div>
      </div>

      {output && (
        <div style={{
          padding: '10px 14px', background: '#010409', border: '1px solid #1c2128', borderRadius: 8,
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 12,
          color: sandboxResult === 'pass' ? '#3fb950' : '#f85149', whiteSpace: 'pre',
        }}>
          <div style={{ fontSize: 9, color: '#484f58', marginBottom: 6, letterSpacing: 1 }}>OUTPUT</div>
          {output}
        </div>
      )}

      <button onClick={handleRun} disabled={running} style={{
        padding: '10px 18px', borderRadius: 8, border: 'none',
        background: running ? 'rgba(163,113,247,0.2)' : 'linear-gradient(135deg,#a371f7,#7c3aed)',
        color: running ? '#6b21a8' : 'white', fontWeight: 700, fontSize: 12,
        cursor: running ? 'not-allowed' : 'pointer', fontFamily: "'IBM Plex Mono', monospace",
        boxShadow: running ? 'none' : '0 4px 14px rgba(163,113,247,0.3)',
      }}>
        {running ? '⟳  Running...' : '▶  Run Sandbox'}
      </button>
    </div>
  );
};

// ─── Hint Panel ───────────────────────────────────────────────────────────────

const HintPanel: React.FC<{
  quest: Quest;
  phaseColor: string;
  hintsUsed: number;
  onTakeHint: () => void;
  hintUnlocked: boolean;
}> = ({ quest, phaseColor, hintsUsed, onTakeHint, hintUnlocked }) => {
  const hints = (quest.hints && quest.hints.length > 0) ? quest.hints : DEFAULT_HINTS;
  const [hintStep, setHintStep] = useState(0);
  const hint = hints[Math.min(hintStep, hints.length - 1)];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: '14px 16px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: '#484f58', fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>TUTORIAL</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3', lineHeight: 1.3 }}>{quest.title}</div>
          {quest.description && (
            <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4, lineHeight: 1.5 }}>{quest.description}</div>
          )}
          {quest.objectives && quest.objectives.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 9, color: '#484f58', fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Objectives</div>
              {quest.objectives.map((obj, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
                  <span style={{ color: phaseColor, fontSize: 10, marginTop: 2, flexShrink: 0 }}>▸</span>
                  <span style={{ fontSize: 11, color: '#8b949e', lineHeight: 1.5 }}>{obj}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            {hints.map((_, i) => (
              <button key={i} onClick={() => setHintStep(i)} style={{
                width: 8, height: 8, borderRadius: '50%', border: 'none',
                cursor: 'pointer', padding: 0,
                background: i === hintStep ? phaseColor : '#21262d',
              }} />
            ))}
          </div>
        </div>

        <div style={{ padding: '14px 16px', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{
              width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
              background: 'rgba(227,179,65,0.15)', border: '1px solid rgba(227,179,65,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
            }}>{hint.icon ?? '💡'}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#e3b341', marginBottom: 6 }}>{hint.title}</div>
              <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.7 }}>{hint.body}</div>
            </div>
          </div>
        </div>

        {hint.image && (
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
            <div style={{
              height: 120, borderRadius: 10, background: 'linear-gradient(135deg,#1c2128,#0d1117)',
              border: '1px solid #21262d', display: 'flex', alignItems: 'center',
              justifyContent: 'center', position: 'relative', overflow: 'hidden',
            }}>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#2d333b', textAlign: 'left', padding: 14, lineHeight: 1.7 }}>
                <span style={{ color: '#58a6ff' }}>int</span> age = <span style={{ color: '#a5d6ff' }}>25</span>;<br />
                <span style={{ color: '#58a6ff' }}>float</span> pi = <span style={{ color: '#a5d6ff' }}>3.14</span>;<br />
                <span style={{ color: '#58a6ff' }}>char</span> grade = <span style={{ color: '#a5d6ff' }}>'A'</span>;<br />
                <span style={{ color: '#8b949e' }}>// Data types in C++</span>
              </div>
              <div style={{ position: 'absolute', bottom: 8, right: 10, fontSize: 9, color: '#2d333b', fontFamily: "'IBM Plex Mono', monospace" }}>Illustration</div>
            </div>
          </div>
        )}

        {hintsUsed > 0 && (
          <div style={{ padding: '8px 16px', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
            <div style={{ fontSize: 10, color: '#484f58', fontFamily: "'IBM Plex Mono', monospace" }}>
              💡 {hintsUsed} hint{hintsUsed > 1 ? 's' : ''} used this session
            </div>
          </div>
        )}

        <div style={{ padding: '10px 16px', display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={() => setHintStep(s => Math.max(0, s - 1))} disabled={hintStep === 0} style={{
            flex: 1, padding: '7px 0', borderRadius: 7, border: '1px solid #21262d',
            background: 'transparent', color: hintStep === 0 ? '#2d333b' : '#8b949e',
            fontSize: 11, cursor: hintStep === 0 ? 'default' : 'pointer', fontFamily: "'IBM Plex Mono', monospace",
          }}>← Prev</button>
          <button onClick={() => setHintStep(s => Math.min(hints.length - 1, s + 1))} disabled={hintStep === hints.length - 1} style={{
            flex: 1, padding: '7px 0', borderRadius: 7, border: '1px solid #21262d',
            background: 'transparent', color: hintStep === hints.length - 1 ? '#2d333b' : '#8b949e',
            fontSize: 11, cursor: hintStep === hints.length - 1 ? 'default' : 'pointer', fontFamily: "'IBM Plex Mono', monospace",
          }}>Next →</button>
        </div>
      </div>

      <div style={{ borderTop: '1px dashed #21262d', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 16, height: 16, borderRadius: 4, border: '1.5px solid #21262d',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {hintUnlocked && <span style={{ fontSize: 10, color: '#3fb950' }}>✓</span>}
          </div>
          <span style={{ fontSize: 11, color: '#8b949e' }}>
            Complete to earn <span style={{ color: '#facc15', fontWeight: 700 }}>{quest.basexp} XP</span>
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 14 }}>✅</span>
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14 }}>✨</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#facc15', fontFamily: "'IBM Plex Mono', monospace" }}>{quest.basexp} XP</span>
          </div>
          <button onClick={onTakeHint} style={{
            flex: 1, padding: '9px 14px', borderRadius: 8, border: 'none',
            background: 'linear-gradient(135deg,#26c6da,#00acc1)',
            color: '#000', fontWeight: 700, fontSize: 11, cursor: 'pointer',
            fontFamily: "'IBM Plex Mono', monospace", boxShadow: '0 3px 12px rgba(38,198,218,0.3)',
          }}>TAKE A HINT</button>
        </div>
      </div>
    </div>
  );
};

// ─── Quest List Screen ────────────────────────────────────────────────────────

const QuestList: React.FC<{
  phase: string;
  quests: Quest[];
  userXP: number;
  loading: boolean;
  onSelectQuest: (quest: Quest) => void;
}> = ({ phase, quests, userXP, loading, onSelectQuest }) => {
  const config = PHASE_CONFIG[phase] ?? PHASE_CONFIG.beginner;
  const [hovered, setHovered] = useState<string | null>(null);

  const completedCount    = quests.filter(q => q.uiStatus === 'completed').length;
  const totalXPAvailable  = quests.reduce((s, q) => s + q.basexp, 0);

  const stats = [
    { icon: '🎒', label: 'Completed',     value: `${completedCount}/${quests.length}`, fill: quests.length ? (completedCount / quests.length) * 100 : 0, color: '#58a6ff' },
    { icon: '⚡', label: 'Total XP',      value: `${userXP}`,           fill: Math.min((userXP / 1000) * 100, 100), color: '#e3b341' },
    { icon: '🏆', label: 'Phase XP Pool', value: `${totalXPAvailable}`, fill: Math.min((totalXPAvailable / 300) * 100, 100), color: '#f0883e' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        flexShrink: 0, height: 140,
        background: config.bg + ', #0d1117',
        border: `1px solid ${config.color}33`, borderRadius: 14, margin: '0 0 16px',
        position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'flex-end',
      }}>
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.06,
          backgroundImage: `linear-gradient(${config.color}80 1px, transparent 1px), linear-gradient(90deg, ${config.color}80 1px, transparent 1px)`,
          backgroundSize: '32px 32px',
        }} />
        <div style={{ padding: '0 24px 20px', position: 'relative', zIndex: 1 }}>
          <div style={{ fontSize: 10, color: '#484f58', fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 1, marginBottom: 4 }}>{config.subtitle}</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#e6edf3', letterSpacing: '-0.5px', fontFamily: "'IBM Plex Sans', sans-serif" }}>
            {config.icon} {config.label}
          </div>
        </div>
        <div style={{
          position: 'absolute', top: 16, right: 16,
          background: `${config.color}22`, border: `1px solid ${config.color}44`,
          borderRadius: 8, padding: '4px 12px',
          fontSize: 11, color: config.color, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700,
        }}>
          {completedCount}/{quests.length} done
        </div>
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 220px', gap: 16, minHeight: 0, overflow: 'hidden' }}>
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 160, gap: 12 }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%',
                border: `2px solid ${config.color}33`, borderTopColor: config.color,
                animation: 'spin 0.8s linear infinite',
              }} />
              <span style={{ fontSize: 12, color: '#484f58', fontFamily: "'IBM Plex Mono', monospace" }}>Loading quests...</span>
            </div>
          ) : quests.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 160, gap: 8 }}>
              <span style={{ fontSize: 32 }}>📭</span>
              <span style={{ fontSize: 13, color: '#484f58', fontFamily: "'IBM Plex Mono', monospace" }}>No quests available yet.</span>
            </div>
          ) : (
            quests.map(quest => {
              const isLocked    = quest.uiStatus === 'locked';
              const isCompleted = quest.uiStatus === 'completed';
              const isHov       = hovered === quest.id;

              return (
                <div
                  key={quest.id}
                  onMouseEnter={() => !isLocked && setHovered(quest.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => !isLocked && onSelectQuest(quest)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '14px 16px', borderRadius: 10,
                    border: `1px solid ${isHov ? config.color + '55' : '#21262d'}`,
                    background: isHov ? `${config.color}08` : 'rgba(13,17,23,0.6)',
                    cursor: isLocked ? 'not-allowed' : 'pointer',
                    opacity: isLocked ? 0.45 : 1, transition: 'all 0.15s',
                    transform: isHov && !isLocked ? 'translateX(2px)' : 'none',
                  }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                    background: isCompleted ? 'rgba(63,185,80,0.15)'
                      : quest.uiStatus === 'active' ? `${config.color}15` : 'rgba(255,255,255,0.03)',
                    border: `1.5px solid ${
                      isCompleted ? 'rgba(63,185,80,0.5)'
                      : quest.uiStatus === 'active' ? `${config.color}66` : '#21262d'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
                  }}>
                    {isCompleted ? '✓' : quest.uiStatus === 'active' ? '▶' : '🔒'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 600, marginBottom: 3,
                      color: isCompleted ? '#8b949e' : '#e6edf3',
                      fontFamily: "'IBM Plex Sans', sans-serif",
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{quest.title}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: diffColor(quest.difficulty) }} />
                      <span style={{ fontSize: 10, color: '#484f58', fontFamily: "'IBM Plex Mono', monospace", textTransform: 'capitalize' }}>
                        {quest.difficulty ?? 'unknown'}
                      </span>
                      {quest.requiredxp > 0 && (
                        <>
                          <span style={{ fontSize: 10, color: '#2d333b' }}>·</span>
                          <span style={{ fontSize: 10, color: '#484f58', fontFamily: "'IBM Plex Mono', monospace" }}>Req. {quest.requiredxp} XP</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div style={{
                    padding: '3px 10px', borderRadius: 6, flexShrink: 0,
                    background: isCompleted ? 'rgba(63,185,80,0.1)'
                      : quest.uiStatus === 'active' ? `${config.color}15` : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${
                      isCompleted ? 'rgba(63,185,80,0.4)'
                      : quest.uiStatus === 'active' ? `${config.color}44` : '#21262d'}`,
                    fontSize: 11, fontWeight: 700,
                    color: isCompleted ? '#3fb950' : quest.uiStatus === 'active' ? config.color : '#2d333b',
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}>
                    {isLocked ? '???' : `+${quest.basexp}XP`}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ background: 'rgba(22,27,34,0.7)', border: '1px solid #21262d', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {stats.map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>{s.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 11, color: '#8b949e' }}>{s.label}</span>
                    <span style={{ fontSize: 11, color: s.color, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }}>{s.value}</span>
                  </div>
                  <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(s.fill, 100)}%`, height: '100%', background: s.color, borderRadius: 3, transition: 'width 0.6s ease' }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ background: 'rgba(22,27,34,0.7)', border: '1px solid #21262d', borderRadius: 12, padding: 16, textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#484f58', fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 1, marginBottom: 6 }}>YOUR XP</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#facc15', fontFamily: "'IBM Plex Mono', monospace" }}>{userXP.toLocaleString()}</div>
            <div style={{ fontSize: 10, color: '#484f58', marginTop: 3 }}>total earned</div>
          </div>
          <div style={{ background: 'rgba(22,27,34,0.7)', border: '1px solid #21262d', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 9, color: '#484f58', fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 1, marginBottom: 10, textTransform: 'uppercase' }}>Difficulty</div>
            {[{ label: 'Easy', color: '#3fb950' }, { label: 'Medium', color: '#e3b341' }, { label: 'Hard', color: '#f85149' }].map(d => (
              <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: d.color }} />
                <span style={{ fontSize: 11, color: '#8b949e' }}>{d.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Quest Activity Screen ────────────────────────────────────────────────────

const QuestActivity: React.FC<{
  quest: Quest;
  phase: string;
  hintsUsed: number;
  onBack: () => void;
  onComplete: (xpEarned: number) => void;
  onHintUsed: () => void;
}> = ({ quest, phase, hintsUsed, onBack, onComplete, onHintUsed }) => {
  const config = PHASE_CONFIG[phase] ?? PHASE_CONFIG.beginner;
  const [mode, setMode] = useState<'drag' | 'manual'>('drag');
  const [hintUnlocked, setHintUnlocked] = useState(false);
  // FIX: track the actual xpEarned so XPBurst shows the real value
  const [earnedXP, setEarnedXP] = useState(0);
  const [xpBurst, setXpBurst] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  const handleTakeHint = () => {
    setNotification('💡 Hints revealed! Study them carefully.');
    setHintUnlocked(true);
    onHintUsed();
    setTimeout(() => setNotification(null), 3000);
  };

  const handleComplete = (score: number) => {
    const xpEarned = Math.round(quest.basexp * (score / DROP_ZONES.length));
    setEarnedXP(xpEarned);
    setXpBurst(true);
    setTimeout(() => { setXpBurst(false); onComplete(xpEarned); }, 1800);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 0 16px', borderBottom: '1px solid #21262d', marginBottom: 16,
      }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: '1px solid #21262d', color: '#8b949e',
          padding: '7px 14px', borderRadius: 7, fontWeight: 600, fontSize: 11,
          cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace",
        }}>← Back</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: config.color, fontFamily: "'IBM Plex Mono', monospace", marginBottom: 2 }}>{config.subtitle}</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#e6edf3', letterSpacing: '-0.3px', fontFamily: "'IBM Plex Sans', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {quest.title}
          </div>
        </div>
        <div style={{
          padding: '5px 14px', borderRadius: 8, flexShrink: 0,
          background: `${config.color}18`, border: `1px solid ${config.color}44`,
          fontSize: 12, fontWeight: 700, color: config.color, fontFamily: "'IBM Plex Mono', monospace",
        }}>+{quest.basexp} XP</div>
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16, minHeight: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexDirection: 'column', background: 'rgba(22,27,34,0.7)', border: '1px solid #21262d', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px 10px', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#e6edf3', textAlign: 'center', fontFamily: "'IBM Plex Sans', sans-serif" }}>🎈 Activity Challenge</div>
            <div style={{ fontSize: 11, color: '#484f58', textAlign: 'center', marginTop: 4, fontFamily: "'IBM Plex Mono', monospace" }}>{quest.title}</div>
          </div>
          <div style={{ display: 'flex', padding: '10px 18px', gap: 8, borderBottom: '1px solid #21262d', flexShrink: 0 }}>
            {(['drag', 'manual'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
                background: mode === m
                  ? m === 'drag' ? 'linear-gradient(135deg,rgba(88,166,255,0.25),rgba(88,166,255,0.15))' : 'linear-gradient(135deg,rgba(163,113,247,0.25),rgba(163,113,247,0.15))'
                  : 'rgba(255,255,255,0.03)',
                color: mode === m ? (m === 'drag' ? '#58a6ff' : '#a371f7') : '#484f58',
                fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace",
                boxShadow: mode === m ? `inset 0 0 0 1px ${m === 'drag' ? 'rgba(88,166,255,0.4)' : 'rgba(163,113,247,0.4)'}` : 'inset 0 0 0 1px #21262d',
              }}>
                {m === 'drag' ? '🎯 Drag & Drop' : '⌨️ Manual Input'}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, padding: 18, overflow: 'hidden', minHeight: 0 }}>
            {mode === 'drag'
              ? <DragDropActivity onComplete={handleComplete} />
              : <ManualInputActivity starterCode={quest.startercode ?? DEFAULT_STARTER_CODE} expectedOutput={quest.expectedoutput} onComplete={handleComplete} />
            }
          </div>
        </div>

        <div style={{ background: 'rgba(22,27,34,0.7)', border: '1px solid #21262d', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <HintPanel quest={quest} phaseColor={config.color} hintsUsed={hintsUsed} onTakeHint={handleTakeHint} hintUnlocked={hintUnlocked} />
        </div>
      </div>

      {/* FIX: pass earnedXP (actual awarded value) not quest.basexp */}
      <XPBurst xp={earnedXP} visible={xpBurst} />
      {notification && (
        <div style={{
          position: 'fixed', top: 70, right: 24,
          background: 'rgba(13,17,23,0.97)', border: '1px solid rgba(227,179,65,0.4)',
          borderRadius: 12, padding: '14px 18px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          zIndex: 9998, maxWidth: 280, animation: 'slideInRight 0.3s ease-out',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#e3b341', fontFamily: "'IBM Plex Mono', monospace", marginBottom: 4 }}>HINTS ✨</div>
          <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.5, fontFamily: "'IBM Plex Sans', sans-serif" }}>{notification}</div>
        </div>
      )}
    </div>
  );
};

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function CampaignInside() {
  const navigate = useNavigate();
  const { phase = 'beginner' } = useParams<{ phase: string }>();
  const { user } = useAuth();

  const [userXP, setUserXP]               = useState(0);
  const [loadingXP, setLoadingXP]         = useState(true);
  const [quests, setQuests]               = useState<Quest[]>([]);
  const [loadingQuests, setLoadingQuests] = useState(true);
  const [view, setView]                   = useState<'list' | 'quest'>('list');
  const [activeQuest, setActiveQuest]     = useState<Quest | null>(null);
  const [hintsUsed, setHintsUsed]         = useState(0);

  // ── Background click particles ────────────────────────────────────────────
  const [bgParticles, setBgParticles] = useState<{ x: number; y: number; id: number }[]>([]);
  const particleId = useRef(0);

  const handlePageClick = useCallback((e: React.MouseEvent) => {
    const id = particleId.current++;
    setBgParticles(p => [...p, { x: e.clientX, y: e.clientY, id }]);
    setTimeout(() => setBgParticles(p => p.filter(pt => pt.id !== id)), 900);
  }, []);

  const config = PHASE_CONFIG[phase] ?? PHASE_CONFIG.beginner;

  // ── Fetch XP + real-time subscription ─────────────────────────────────────
  useEffect(() => {
    if (!user?.id) { setLoadingXP(false); return; }
    const fetchXP = async () => {
      try {
        const { data } = await supabase.from('users').select('totalxp').eq('id', user.id).single();
        if (data) setUserXP(data.totalxp ?? 0);
      } catch (e) { console.error(e); }
      finally { setLoadingXP(false); }
    };
    fetchXP();

    const ch = supabase.channel(`xp-${user.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${user.id}` }, p => {
        if (p.new && 'totalxp' in p.new) setUserXP((p.new as any).totalxp ?? 0);
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id]);

  // ── Fetch quests + mission_progress ───────────────────────────────────────
  const fetchQuests = useCallback(async () => {
    if (!user?.id) return;
    setLoadingQuests(true);
    try {
      const { data: qData, error } = await supabase
        .from('quests')
        .select('id,title,description,difficulty,level,phase,basexp,requiredxp,hints,startercode,expectedoutput,objectives,sortorder,isactive')
        .eq('phase', phase)
        .eq('isactive', true)
        .eq('mode', 'campaign')
        .order('sortorder', { ascending: true });

      if (error) throw error;
      if (!qData || qData.length === 0) { setQuests([]); return; }

      const { data: pData } = await supabase
        .from('mission_progress')
        .select('id,questid,status,attempts,hintsused,startedat,completedat')
        .eq('userid', user.id)
        .in('questid', qData.map((q: DBQuest) => q.id));

      const pMap: Record<string, MissionProgress> = {};
      (pData ?? []).forEach((p: MissionProgress) => { pMap[p.questid] = p; });

      let foundActive = false;
      const merged: Quest[] = qData.map((q: DBQuest) => {
        const p = pMap[q.id];
        let uiStatus: Quest['uiStatus'];
        if (p?.status === 'completed') {
          uiStatus = 'completed';
        } else if (p?.status === 'active') {
          uiStatus = 'active';
          foundActive = true;
        } else {
          uiStatus = foundActive ? 'locked' : 'active';
          if (!foundActive) foundActive = true;
        }
        return { ...q, uiStatus, progressId: p?.id ?? null, attempts: p?.attempts ?? 0 };
      });

      setQuests(merged);
    } catch (e) { console.error(e); setQuests([]); }
    finally { setLoadingQuests(false); }
  }, [phase, user?.id]);

  useEffect(() => { fetchQuests(); }, [fetchQuests]);

  // ── Select quest ──────────────────────────────────────────────────────────
  const handleSelectQuest = useCallback(async (quest: Quest) => {
    if (!user?.id) return;
    setActiveQuest(quest);
    setHintsUsed(0);
    setView('quest');
    try {
      if (!quest.progressId) {
        await supabase.from('mission_progress').insert({
          userid: user.id, questid: quest.id, status: 'active',
          attempts: 0, hintsused: 0, startedat: new Date().toISOString(),
        });
      }
      // FIX: explicit description using the phase label, not a variable that
      // might not have been updated yet
      const phaseLabel = PHASE_CONFIG[phase]?.label ?? phase;
      await supabase.from('activity_log').insert({
        userid: user.id, type: 'quest_started', title: quest.title,
        description: `Started "${quest.title}" in ${phaseLabel} phase`,
        xp_gained: 0,
        meta: { questid: quest.id, phase },
      });
    } catch (e) { console.error(e); }
  }, [user?.id, phase]);

  // ── Hint used ─────────────────────────────────────────────────────────────
  const handleHintUsed = useCallback(async () => {
    const next = hintsUsed + 1;
    setHintsUsed(next);
    if (!user?.id || !activeQuest?.progressId) return;
    try {
      await supabase.from('mission_progress')
        .update({ hintsused: next, updatedat: new Date().toISOString() })
        .eq('id', activeQuest.progressId);
    } catch (e) { console.error(e); }
  }, [user?.id, activeQuest, hintsUsed]);

  // ── Quest complete ────────────────────────────────────────────────────────
  const handleQuestComplete = useCallback(async (xpEarned: number) => {
    if (!user?.id || !activeQuest) return;

    // FIX: replay protection — do NOT award XP if the quest was already
    // completed. The mission_progress status check happens before the RPC call.
    // We re-read the current DB status rather than trusting cached uiStatus.
    try {
      const phaseLabel = PHASE_CONFIG[phase]?.label ?? phase;

      // Check current DB status to prevent double-awarding
      const { data: currentProgress } = await supabase
        .from('mission_progress')
        .select('status')
        .eq('userid', user.id)
        .eq('questid', activeQuest.id)
        .maybeSingle();

      const alreadyCompleted = currentProgress?.status === 'completed';

      if (activeQuest.progressId) {
        await supabase.from('mission_progress').update({
          status: 'completed',
          completedat: new Date().toISOString(),
          updatedat: new Date().toISOString(),
          attempts: activeQuest.attempts + 1,
        }).eq('id', activeQuest.progressId);
      } else {
        await supabase.from('mission_progress').insert({
          userid: user.id, questid: activeQuest.id, status: 'completed',
          attempts: 1, hintsused: hintsUsed,
          startedat: new Date().toISOString(), completedat: new Date().toISOString(),
        });
      }

      // FIX: only call increment_xp for genuinely new completions
      if (!alreadyCompleted && xpEarned > 0) {
        await supabase.rpc('increment_xp', { user_id: user.id, xp_to_add: xpEarned });
      }

      // FIX: activity log uses phaseLabel and xpEarned (0 if repeat)
      await supabase.from('activity_log').insert({
        userid: user.id, type: 'quest_completed', title: activeQuest.title,
        description: `Completed "${activeQuest.title}" in ${phaseLabel} phase`,
        xp_gained: alreadyCompleted ? 0 : xpEarned,
        meta: { questid: activeQuest.id, phase, hintsused: hintsUsed, repeat: alreadyCompleted },
      });

      await fetchQuests();
    } catch (e) { console.error('Quest complete error:', e); }
    setTimeout(() => { setView('list'); setActiveQuest(null); }, 2200);
  }, [user?.id, activeQuest, hintsUsed, phase, fetchQuests]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700;800&family=IBM+Plex+Sans:wght@400;500;600;700;800&display=swap');

        @keyframes xpBurstIn {
          from { opacity:0; transform:translate(-50%,-50%) scale(0.5); }
          to   { opacity:1; transform:translate(-50%,-50%) scale(1); }
        }
        @keyframes slideInRight {
          from { opacity:0; transform:translateX(20px); }
          to   { opacity:1; transform:translateX(0); }
        }
        @keyframes spin { to { transform:rotate(360deg); } }

        @keyframes ci-drift {
          0%   { transform: translate(0,0) scale(1); }
          33%  { transform: translate(12px,-8px) scale(1.04); }
          66%  { transform: translate(-8px,12px) scale(0.97); }
          100% { transform: translate(0,0) scale(1); }
        }
        @keyframes ci-scanline {
          0%   { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        @keyframes ci-particle-burst {
          0%   { transform: translate(-50%,-50%) scale(0); opacity: 0.8; }
          60%  { opacity: 0.5; }
          100% { transform: translate(-50%,-50%) scale(6); opacity: 0; }
        }

        * { box-sizing:border-box; margin:0; padding:0; }

        .ci-bg {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          overflow: hidden;
          background: #080b10;
        }
        .ci-bg .ci-grid {
          position: absolute;
          inset: 0;
          opacity: 0.25;
          background-image:
            linear-gradient(rgba(227,179,65,0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(227,179,65,0.5) 1px, transparent 1px);
          background-size: 50px 50px;
          animation: ci-drift 20s ease-in-out infinite;
        }
        .ci-bg .ci-scanline {
          position: absolute;
          left: 0; right: 0;
          height: 2px;
          background: linear-gradient(90deg, transparent, rgba(227,179,65,0.2), transparent);
          animation: ci-scanline 6s linear infinite;
        }

        .ci-root {
          position: relative;
          z-index: 1;
          font-family: 'IBM Plex Sans', system-ui, sans-serif;
          color: #e6edf3;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: transparent;
        }

        ::-webkit-scrollbar { width:5px; height:5px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:#21262d; border-radius:3px; }
      `}</style>

      <div className="ci-bg">
        <div className="ci-grid" />
        <div className="ci-scanline" />
      </div>

      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none', overflow: 'hidden' }}>
        {bgParticles.map(p => (
          <div key={p.id} style={{
            position: 'absolute', left: p.x, top: p.y,
            width: '70px', height: '70px', borderRadius: '50%',
            border: '2px solid rgba(227,179,65,0.7)',
            animation: 'ci-particle-burst 0.9s ease-out forwards',
            pointerEvents: 'none',
          }} />
        ))}
      </div>

      <div className="ci-root" onClick={handlePageClick}>
        <header style={{
          height: 56, flexShrink: 0,
          background: 'rgba(22,27,34,0.6)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid #21262d',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px', position: 'relative', zIndex: 100,
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>{config.icon}</span>
            <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, fontSize: 13 }}>CodeSense</span>
            <span style={{ color: '#30363d' }}>›</span>
            <span style={{
              padding: '3px 10px', borderRadius: 5,
              background: `${config.color}18`, border: `1px solid ${config.color}33`,
              fontSize: 11, color: config.color, fontFamily: "'IBM Plex Mono',monospace",
            }}>{config.label}</span>
            {view === 'quest' && activeQuest && (
              <>
                <span style={{ color: '#30363d' }}>›</span>
                <span style={{
                  padding: '3px 10px', borderRadius: 5,
                  background: 'rgba(88,166,255,0.1)', border: '1px solid rgba(88,166,255,0.25)',
                  fontSize: 11, color: '#58a6ff', fontFamily: "'IBM Plex Mono',monospace",
                  maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{activeQuest.title}</span>
              </>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(250,204,21,0.1)', border: '1px solid rgba(250,204,21,0.25)',
              borderRadius: 7, padding: '4px 11px',
              opacity: loadingXP ? 0.5 : 1, transition: 'opacity 0.3s',
            }}>
              <span style={{ fontSize: 11 }}>⚡</span>
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: '#facc15', fontWeight: 700 }}>{userXP.toLocaleString()} XP</span>
            </div>
            {view === 'quest' && (
              <button onClick={() => { setView('list'); setActiveQuest(null); }} style={{
                background: 'transparent', border: '1px solid #30363d', color: '#8b949e',
                padding: '5px 12px', borderRadius: 6, fontWeight: 600, fontSize: 11,
                cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace",
              }}>← Exit Quest</button>
            )}
            <button onClick={() => navigate('/campaign')} style={{
              background: 'transparent', border: '1px solid #30363d', color: '#8b949e',
              padding: '5px 12px', borderRadius: 6, fontWeight: 600, fontSize: 11,
              cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace",
            }}>← Campaign</button>
          </div>
        </header>

        <div style={{ flex: 1, padding: 20, overflow: 'hidden', minHeight: 0 }}>
          {view === 'list' ? (
            <QuestList phase={phase} quests={quests} userXP={userXP} loading={loadingQuests} onSelectQuest={handleSelectQuest} />
          ) : (
            activeQuest && (
              <QuestActivity
                quest={activeQuest} phase={phase} hintsUsed={hintsUsed}
                onBack={() => { setView('list'); setActiveQuest(null); }}
                onComplete={handleQuestComplete}
                onHintUsed={handleHintUsed}
              />
            )
          )}
        </div>
      </div>
    </>
  );
}