import { useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface SafetyCheck {
  status: 'UNSAFE' | 'SAFE' | 'WARNING';
  line: number;
  operation: string;
  message: string;
}

interface SymbolicEntry {
  expression: string;
  value: string | number;
}

interface MathTabProps {
  safetyChecks?: SafetyCheck[];
  symbolicExecution?: SymbolicEntry[];
}

// ─── Risk level config ────────────────────────────────────────────────────────
const RISK_INFO: Record<string, { icon: string; color: string; bg: string; border: string; label: string; badge: string }> = {
  UNSAFE: {
    icon: '💀', color: '#f85149', bg: 'rgba(248,81,73,0.06)',
    border: 'rgba(248,81,73,0.25)', label: 'CRITICAL RISK', badge: 'rgba(248,81,73,0.15)',
  },
  WARNING: {
    icon: '⚠️', color: '#e3b341', bg: 'rgba(227,179,65,0.06)',
    border: 'rgba(227,179,65,0.25)', label: 'WARNING', badge: 'rgba(227,179,65,0.15)',
  },
  SAFE: {
    icon: '✅', color: '#3fb950', bg: 'rgba(63,185,80,0.06)',
    border: 'rgba(63,185,80,0.25)', label: 'SAFE', badge: 'rgba(63,185,80,0.15)',
  },
};

// ─── Friendly explanations for error types ────────────────────────────────────
function explainOperation(op: string, message: string): { what: string; why: string; fix: string } {
  const msg = message.toLowerCase();

  if (op === 'arithmetic' || msg.includes('division') || msg.includes('zero')) {
    return {
      what: '➗ Division by Zero',
      why: 'Your code attempts to divide a number by zero. In C++, this causes undefined behaviour — your program will crash or produce garbage results.',
      fix: 'Add a check before dividing: if (divisor != 0) { result = a / b; }',
    };
  }
  if (op === 'array' || msg.includes('array') || msg.includes('bounds') || msg.includes('index')) {
    return {
      what: '📦 Array Out of Bounds',
      why: 'You are accessing an array at an index that doesn\'t exist. This corrupts memory and can crash the program silently.',
      fix: 'Make sure your index is between 0 and (array size - 1). Example: if (i >= 0 && i < size)',
    };
  }
  if (msg.includes('infinite') || msg.includes('loop')) {
    return {
      what: '🔁 Infinite Loop',
      why: 'This loop\'s condition never becomes false, so it will run forever and freeze your program.',
      fix: 'Make sure your loop variable changes each iteration in a way that eventually makes the condition false.',
    };
  }
  if (msg.includes('null') || msg.includes('pointer')) {
    return {
      what: '💣 Null Pointer',
      why: 'You are trying to use a pointer that points to nothing. This will crash your program immediately.',
      fix: 'Check the pointer before using it: if (ptr != nullptr) { ... }',
    };
  }
  if (msg.includes('uninit')) {
    return {
      what: '🫙 Uninitialized Variable',
      why: 'You\'re reading a variable that was never given a value. In C++, it contains random garbage from memory.',
      fix: 'Always initialize variables when you declare them: int x = 0;',
    };
  }
  return {
    what: `⚡ ${op}`,
    why: message,
    fix: 'Review the logic around this line carefully.',
  };
}

// ─── Single safety card ───────────────────────────────────────────────────────
const SafetyCard: React.FC<{ check: SafetyCheck; index: number }> = ({ check, index }) => {
  const [expanded, setExpanded] = useState(check.status === 'UNSAFE');
  const cfg = RISK_INFO[check.status] ?? RISK_INFO.WARNING;
  const { what, why, fix } = explainOperation(check.operation, check.message);

  return (
    <div style={{
      border: `1px solid ${cfg.border}`,
      borderRadius: '12px',
      background: cfg.bg,
      overflow: 'hidden',
      transition: 'all 0.2s',
    }}>
      {/* Header row */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '12px 14px', cursor: 'pointer',
        }}
      >
        {/* Index bubble */}
        <div style={{
          width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0,
          background: cfg.badge, border: `1px solid ${cfg.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '10px', fontWeight: '700', color: cfg.color,
          fontFamily: 'IBM Plex Mono, monospace',
        }}>
          {index + 1}
        </div>

        <span style={{ fontSize: '14px', flexShrink: 0 }}>{cfg.icon}</span>

        {/* What */}
        <span style={{ flex: 1, fontSize: '12px', fontWeight: '700', color: cfg.color, fontFamily: 'IBM Plex Mono, monospace' }}>
          {what}
        </span>

        {/* Line badge */}
        <span style={{
          fontSize: '10px', color: cfg.color, background: cfg.badge,
          padding: '2px 8px', borderRadius: '4px', flexShrink: 0,
          fontFamily: 'IBM Plex Mono, monospace', fontWeight: '700',
        }}>
          L{check.line}
        </span>

        {/* Status badge */}
        <span style={{
          fontSize: '9px', fontWeight: '800', letterSpacing: '0.8px',
          color: cfg.color, background: cfg.badge,
          padding: '2px 7px', borderRadius: '4px', flexShrink: 0,
          fontFamily: 'IBM Plex Mono, monospace',
        }}>
          {cfg.label}
        </span>

        <span style={{ color: '#484f58', fontSize: '11px', flexShrink: 0 }}>{expanded ? '▾' : '▸'}</span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${cfg.border}`, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* Raw message */}
          <div style={{
            background: 'rgba(0,0,0,0.3)', borderRadius: '7px',
            padding: '10px 12px', fontFamily: 'IBM Plex Mono, monospace',
            fontSize: '11px', color: '#c9d1d9', lineHeight: '1.6',
          }}>
            <span style={{ color: '#484f58' }}>engine says → </span>{check.message}
          </div>

          {/* Why */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <div style={{
              width: '24px', height: '24px', borderRadius: '6px', flexShrink: 0,
              background: 'rgba(88,166,255,0.1)', border: '1px solid rgba(88,166,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px',
            }}>🧠</div>
            <div>
              <div style={{ fontSize: '10px', fontWeight: '700', color: '#58a6ff', fontFamily: 'IBM Plex Mono, monospace', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Why this is dangerous</div>
              <div style={{ fontSize: '12px', color: '#8b949e', lineHeight: '1.7' }}>{why}</div>
            </div>
          </div>

          {/* Fix */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <div style={{
              width: '24px', height: '24px', borderRadius: '6px', flexShrink: 0,
              background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px',
            }}>🔧</div>
            <div>
              <div style={{ fontSize: '10px', fontWeight: '700', color: '#3fb950', fontFamily: 'IBM Plex Mono, monospace', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>How to fix it</div>
              <div style={{ fontSize: '12px', color: '#8b949e', lineHeight: '1.7', fontFamily: 'IBM Plex Mono, monospace' }}>{fix}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Symbolic trace row ───────────────────────────────────────────────────────
const TraceRow: React.FC<{ entry: SymbolicEntry; index: number }> = ({ entry, index }) => {
  const isUnknown = String(entry.value) === 'unknown' || String(entry.value) === 'uninitialized';
  const isType = typeof entry.value === 'string' && ['int', 'float', 'double', 'char', 'bool', 'string'].includes(entry.value);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '9px 12px', borderRadius: '8px',
      background: index % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
      border: '1px solid transparent',
      transition: 'all 0.15s',
    }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = index % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent'}
    >
      {/* Step number */}
      <span style={{ fontSize: '10px', color: '#2d333b', fontFamily: 'IBM Plex Mono, monospace', flexShrink: 0, width: '20px' }}>
        {String(index + 1).padStart(2, '0')}
      </span>

      {/* Expression */}
      <span style={{ flex: 1, fontSize: '12px', color: '#c9d1d9', fontFamily: 'IBM Plex Mono, monospace' }}>
        {entry.expression}
      </span>

      {/* Value */}
      <span style={{
        fontSize: '11px', fontWeight: '700', fontFamily: 'IBM Plex Mono, monospace',
        padding: '2px 10px', borderRadius: '5px',
        color: isUnknown ? '#484f58' : isType ? '#8b949e' : '#3fb950',
        background: isUnknown ? 'rgba(72,79,88,0.15)' : isType ? 'rgba(139,148,158,0.1)' : 'rgba(63,185,80,0.12)',
        border: `1px solid ${isUnknown ? '#21262d' : isType ? 'rgba(139,148,158,0.2)' : 'rgba(63,185,80,0.25)'}`,
      }}>
        {isUnknown ? '?' : String(entry.value)}
      </span>
    </div>
  );
};

// ─── Score ring ───────────────────────────────────────────────────────────────
const ScoreRing: React.FC<{ safe: number; total: number }> = ({ safe, total }) => {
  if (total === 0) return null;
  const pct = Math.round((safe / total) * 100);
  const color = pct === 100 ? '#3fb950' : pct >= 70 ? '#e3b341' : '#f85149';
  const r = 22, circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  // PDF #9: at 100%, the dasharray-based stroke + round linecap leave a
  // visible seam at 12 o'clock where the two round caps meet — it reads as
  // "not a full circle". Render a plain unbroken ring at 100%.
  const isFull = pct >= 100;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', background: 'rgba(255,255,255,0.02)', border: '1px solid #21262d', borderRadius: '10px' }}>
      <svg width="56" height="56" style={{ flexShrink: 0 }}>
        <circle cx="28" cy="28" r={r} fill="none" stroke="#21262d" strokeWidth="4" />
        {isFull ? (
          <circle cx="28" cy="28" r={r} fill="none" stroke={color} strokeWidth="4" />
        ) : (
          <circle cx="28" cy="28" r={r} fill="none" stroke={color} strokeWidth="4"
            strokeDasharray={`${dash} ${circ}`} strokeDashoffset={circ / 4}
            strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.6s ease' }} />
        )}
        <text x="28" y="33" textAnchor="middle" fontSize="12" fontWeight="700" fill={color} fontFamily="IBM Plex Mono, monospace">{pct}%</text>
      </svg>
      <div>
        <div style={{ fontSize: '13px', fontWeight: '700', color: color, fontFamily: 'IBM Plex Mono, monospace' }}>
          {pct === 100 ? '🛡️ All checks passed' : pct >= 70 ? '⚠️ Some risks found' : '💀 Critical issues'}
        </div>
        <div style={{ fontSize: '11px', color: '#484f58', marginTop: '3px' }}>
          {safe} of {total} safety checks passed
        </div>
      </div>
    </div>
  );
};

// ─── Main MathTab ─────────────────────────────────────────────────────────────
export const MathTab: React.FC<MathTabProps> = ({ safetyChecks = [], symbolicExecution = [] }) => {
  const [activeView, setActiveView] = useState<'safety' | 'trace'>('safety');

  const unsafe  = safetyChecks.filter(c => c.status === 'UNSAFE');
  const warning = safetyChecks.filter(c => c.status === 'WARNING');
  const safe    = safetyChecks.filter(c => c.status === 'SAFE');
  const hasAny  = safetyChecks.length > 0 || symbolicExecution.length > 0;

  if (!hasAny) {
    return (
      <div className="placeholder-text">
        <div style={{ fontSize: '28px', marginBottom: '10px', opacity: 0.2 }}>🔢</div>
        <div style={{ color: '#484f58' }}>No mathematical data yet.</div>
        <div style={{ color: '#2d333b', fontSize: '12px', marginTop: '4px' }}>Run analysis to see symbolic execution results.</div>
      </div>
    );
  }

  const btnStyle = (active: boolean, color = '#58a6ff') => ({
    padding: '5px 14px', borderRadius: '7px', border: 'none', cursor: 'pointer',
    fontSize: '11px', fontWeight: '700', fontFamily: 'IBM Plex Mono, monospace',
    background: active ? `${color}18` : 'transparent',
    color: active ? color : '#484f58',
    boxShadow: active ? `inset 0 0 0 1px ${color}40` : 'none',
    transition: 'all 0.15s',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* Score summary */}
      <ScoreRing safe={safe.length + warning.length} total={safetyChecks.length} />

      {/* Tab switcher */}
      {symbolicExecution.length > 0 && (
        <div style={{ display: 'flex', gap: '4px', background: '#0d1117', border: '1px solid #21262d', borderRadius: '8px', padding: '3px', alignSelf: 'flex-start' }}>
          <button style={btnStyle(activeView === 'safety', unsafe.length > 0 ? '#f85149' : '#3fb950')} onClick={() => setActiveView('safety')}>
            {unsafe.length > 0 ? '💀' : '🛡️'} Safety ({safetyChecks.length})
          </button>
          <button style={btnStyle(activeView === 'trace', '#79c0ff')} onClick={() => setActiveView('trace')}>
            🔢 Value Trace ({symbolicExecution.length})
          </button>
        </div>
      )}

      {/* ── Safety view ── */}
      {activeView === 'safety' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

          {/* Critical */}
          {unsafe.length > 0 && (
            <div>
              <div style={{ fontSize: '10px', fontWeight: '700', color: '#f85149', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px', paddingLeft: '2px' }}>
                💀 Critical — {unsafe.length} issue{unsafe.length > 1 ? 's' : ''}
              </div>
              {unsafe.map((c, i) => <SafetyCard key={i} check={c} index={i} />)}
            </div>
          )}

          {/* Warnings */}
          {warning.length > 0 && (
            <div>
              <div style={{ fontSize: '10px', fontWeight: '700', color: '#e3b341', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px', marginTop: unsafe.length > 0 ? '8px' : '0', paddingLeft: '2px' }}>
                ⚠️ Warnings — {warning.length}
              </div>
              {warning.map((c, i) => <SafetyCard key={i} check={c} index={i} />)}
            </div>
          )}

          {/* Safe */}
          {safe.length > 0 && (
            <div>
              <div style={{ fontSize: '10px', fontWeight: '700', color: '#3fb950', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px', marginTop: (unsafe.length + warning.length) > 0 ? '8px' : '0', paddingLeft: '2px' }}>
                ✅ Passed — {safe.length}
              </div>
              {safe.map((c, i) => <SafetyCard key={i} check={c} index={i} />)}
            </div>
          )}
        </div>
      )}

      {/* ── Value trace view ── */}
      {activeView === 'trace' && symbolicExecution.length > 0 && (
        <div>
          <div style={{ fontSize: '10px', fontWeight: '700', color: '#484f58', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '8px', paddingLeft: '2px' }}>
            🔢 Variable Value Trace
          </div>
          <div style={{ background: '#010409', border: '1px solid #21262d', borderRadius: '10px', padding: '8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {/* Header */}
            <div style={{ display: 'flex', gap: '12px', padding: '6px 12px', borderBottom: '1px solid #21262d', marginBottom: '4px' }}>
              <span style={{ width: '20px', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: '9px', fontWeight: '700', color: '#484f58', fontFamily: 'IBM Plex Mono, monospace', textTransform: 'uppercase', letterSpacing: '1px' }}>Expression</span>
              <span style={{ fontSize: '9px', fontWeight: '700', color: '#484f58', fontFamily: 'IBM Plex Mono, monospace', textTransform: 'uppercase', letterSpacing: '1px' }}>Value</span>
            </div>
            {symbolicExecution.map((e, i) => <TraceRow key={i} entry={e} index={i} />)}
          </div>
        </div>
      )}
    </div>
  );
};