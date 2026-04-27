import { useState, useEffect, useRef, useMemo } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface LogsTabProps {
  explanations?: string[];
  errors?: Array<{ type: string; message: string; line?: number; severity?: string }>;
  warnings?: Array<{ type: string; message: string; line?: number; severity?: string }>;
  success?: boolean;
  cognitiveComplexity?: number;
  cyclomaticComplexity?: { score: number; rating: string; interpretation: string };
}

// ─── Parse a raw explanation string into structured log entry ─────────────────
type LogLevel = 'error' | 'warning' | 'info' | 'success' | 'system' | 'hint';

interface LogEntry {
  level: LogLevel;
  phase: string;
  message: string;
  raw: string;
}

const LEVEL_STYLE: Record<LogLevel, { color: string; bg: string; border: string; icon: string; label: string }> = {
  error:   { color: '#f85149', bg: 'rgba(248,81,73,0.07)',   border: 'rgba(248,81,73,0.2)',   icon: '✗', label: 'ERROR'   },
  warning: { color: '#e3b341', bg: 'rgba(227,179,65,0.07)',  border: 'rgba(227,179,65,0.2)',  icon: '⚠', label: 'WARN'    },
  success: { color: '#3fb950', bg: 'rgba(63,185,80,0.07)',   border: 'rgba(63,185,80,0.2)',   icon: '✓', label: 'OK'      },
  info:    { color: '#79c0ff', bg: 'rgba(121,192,255,0.05)', border: 'rgba(121,192,255,0.15)',icon: 'i', label: 'INFO'    },
  system:  { color: '#484f58', bg: 'transparent',            border: 'transparent',           icon: '·', label: 'SYS'     },
  hint:    { color: '#a371f7', bg: 'rgba(163,113,247,0.07)', border: 'rgba(163,113,247,0.2)', icon: '→', label: 'HINT'    },
};

function parseEntry(raw: string, index: number): LogEntry {
  const level: LogLevel =
    raw.includes('❌') || raw.includes('🚨') || raw.includes('Error') ? 'error' :
    raw.includes('⚠️') || raw.includes('WARNING') ? 'warning' :
    raw.includes('✅') || raw.includes('success') || raw.includes('Successful') ? 'success' :
    raw.includes('💡') || raw.includes('→') || raw.includes('Hint') ? 'hint' :
    raw.includes('Status') || raw.includes('Phase') ? 'system' : 'info';

  // Strip emoji/markdown bold markers for clean display
  const clean = raw
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/❌|✅|⚠️|🚨|💡|🔧|📍|🔬|🛰|🔤/gu, '')
    .trim();

  const phaseMatch = clean.match(/^(Status|Phase\s*\d*|Error|Warning|Line\s*\d+|L\d+)[:\s–-]/i);
  const phase = phaseMatch ? phaseMatch[1].trim() : `LOG ${String(index + 1).padStart(2, '0')}`;
  const message = phaseMatch ? clean.slice(phaseMatch[0].length).trim() : clean;

  return { level, phase, message, raw };
}

// ─── Animated typing cursor ───────────────────────────────────────────────────
const Cursor: React.FC = () => (
  <span style={{
    display: 'inline-block', width: '7px', height: '13px',
    background: '#3fb950', borderRadius: '1px', marginLeft: '3px',
    verticalAlign: 'middle',
    animation: 'cursorBlink 1.1s step-end infinite',
  }} />
);

// ─── Single log line ──────────────────────────────────────────────────────────
const LogLine: React.FC<{ entry: LogEntry; delay: number; visible: boolean }> = ({ entry, delay, visible }) => {
  const [shown, setShown] = useState(false);
  const style = LEVEL_STYLE[entry.level];

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(t);
  }, [visible, delay]);

  if (!shown) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '0',
      borderLeft: `2px solid ${entry.level === 'system' ? '#21262d' : style.border}`,
      padding: '7px 10px 7px 12px',
      borderRadius: '0 7px 7px 0',
      background: style.bg,
      marginBottom: '2px',
      animation: 'fadeSlideIn 0.2s ease-out',
    }}>
      {/* Level badge */}
      <span style={{
        fontSize: '9px', fontWeight: '800', letterSpacing: '0.8px',
        color: style.color, background: `${style.color}18`,
        padding: '1px 6px', borderRadius: '3px', flexShrink: 0,
        fontFamily: 'IBM Plex Mono, monospace', marginRight: '10px',
        marginTop: '1px', minWidth: '42px', textAlign: 'center',
      }}>
        {style.label}
      </span>

      {/* Phase */}
      <span style={{
        fontSize: '10px', color: '#484f58', fontFamily: 'IBM Plex Mono, monospace',
        flexShrink: 0, marginRight: '10px', marginTop: '1px', minWidth: '60px',
      }}>
        {entry.phase}
      </span>

      {/* Message */}
      <span style={{
        fontSize: '12px', color: entry.level === 'system' ? '#484f58' : style.color === '#484f58' ? '#8b949e' : style.color,
        fontFamily: 'IBM Plex Mono, monospace', lineHeight: '1.6', flex: 1,
        opacity: entry.level === 'system' ? 0.6 : 1,
      }}>
        {entry.message}
      </span>
    </div>
  );
};



// ─── Complexity badge row ─────────────────────────────────────────────────────
const ComplexityRow: React.FC<{ cognitive?: number; cyclomatic?: { score: number; rating: string } }> = ({ cognitive, cyclomatic }) => {
  if (cognitive === undefined && !cyclomatic) return null;

  const cogColor = (cognitive ?? 0) <= 3 ? '#3fb950' : (cognitive ?? 0) <= 7 ? '#e3b341' : '#f85149';
  const cycColor = (cyclomatic?.score ?? 1) <= 5 ? '#3fb950' : (cyclomatic?.score ?? 1) <= 10 ? '#e3b341' : '#f85149';

  return (
    <div style={{
      display: 'flex', gap: '8px', padding: '10px 0 4px 0',
      borderTop: '1px solid #21262d', marginTop: '8px',
    }}>
      {cognitive !== undefined && (
        <div style={{
          flex: 1, padding: '8px 12px', borderRadius: '8px',
          background: `${cogColor}0d`, border: `1px solid ${cogColor}25`,
          display: 'flex', flexDirection: 'column', gap: '3px',
        }}>
          <div style={{ fontSize: '9px', color: '#484f58', fontFamily: 'IBM Plex Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Cognitive</div>
          <div style={{ fontSize: '18px', fontWeight: '700', color: cogColor, fontFamily: 'IBM Plex Mono, monospace', lineHeight: 1 }}>{cognitive}</div>
          <div style={{ fontSize: '10px', color: '#484f58' }}>
            {cognitive <= 3 ? 'Simple ✓' : cognitive <= 7 ? 'Moderate' : 'Complex ⚠'}
          </div>
        </div>
      )}
      {cyclomatic && (
        <div style={{
          flex: 1, padding: '8px 12px', borderRadius: '8px',
          background: `${cycColor}0d`, border: `1px solid ${cycColor}25`,
          display: 'flex', flexDirection: 'column', gap: '3px',
        }}>
          <div style={{ fontSize: '9px', color: '#484f58', fontFamily: 'IBM Plex Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Cyclomatic</div>
          <div style={{ fontSize: '18px', fontWeight: '700', color: cycColor, fontFamily: 'IBM Plex Mono, monospace', lineHeight: 1 }}>{cyclomatic.score}</div>
          <div style={{ fontSize: '10px', color: '#484f58' }}>{cyclomatic.rating}</div>
        </div>
      )}
    </div>
  );
};

// ─── Main LogsTab ─────────────────────────────────────────────────────────────
export const LogsTab: React.FC<LogsTabProps> = ({
  explanations = [], 
  success, cognitiveComplexity, cyclomaticComplexity,
}) => {
  const visible = explanations.length > 0;
  const [filter, setFilter] = useState<LogLevel | 'all'>('all');
  const bottomRef = useRef<HTMLDivElement>(null);

  const entries: LogEntry[] = useMemo(
    () => explanations.map((e, i) => parseEntry(e, i)),
    [explanations],
  );
  const hasContent = entries.length > 0;

  useEffect(() => {
    if (visible) {
      const t = setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), entries.length * 40 + 200);
      return () => clearTimeout(t);
    }
  }, [visible, entries.length]);

  const filtered = filter === 'all' ? entries : entries.filter(e => e.level === filter);
  const counts = {
    error:   entries.filter(e => e.level === 'error').length,
    warning: entries.filter(e => e.level === 'warning').length,
    success: entries.filter(e => e.level === 'success').length,
    info:    entries.filter(e => e.level === 'info').length,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '0' }}>

      {/* Terminal header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 12px',
        background: '#010409',
        border: '1px solid #21262d',
        borderBottom: 'none',
        borderRadius: '10px 10px 0 0',
        flexShrink: 0,
      }}>
        {/* Traffic lights */}
        <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
          {['#f85149', '#e3b341', '#3fb950'].map((c, i) => (
            <div key={i} style={{ width: '9px', height: '9px', borderRadius: '50%', background: c, opacity: 0.8 }} />
          ))}
        </div>
        <span style={{ fontSize: '11px', color: '#484f58', fontFamily: 'IBM Plex Mono, monospace', flex: 1, textAlign: 'center' }}>
          codesense — analysis.log
        </span>
        {/* Status dot */}
        {hasContent && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: success ? '#3fb950' : '#f85149',
              animation: visible ? 'none' : 'pulse 1s ease-in-out infinite',
            }} />
            <span style={{ fontSize: '10px', color: success ? '#3fb950' : '#f85149', fontFamily: 'IBM Plex Mono, monospace', fontWeight: '700' }}>
              {success ? 'PASS' : 'FAIL'}
            </span>
          </div>
        )}
      </div>

      {/* Filter pills */}
      {hasContent && (
        <div style={{
          display: 'flex', gap: '4px', padding: '6px 10px',
          background: '#0a0e14', border: '1px solid #21262d',
          borderBottom: 'none', flexShrink: 0, flexWrap: 'wrap',
        }}>
          {([
            { id: 'all' as const,     label: `ALL ${entries.length}`,           color: '#8b949e' },
            counts.error   > 0 && { id: 'error' as const,   label: `✗ ${counts.error}`,   color: '#f85149' },
            counts.warning > 0 && { id: 'warning' as const, label: `⚠ ${counts.warning}`, color: '#e3b341' },
            counts.success > 0 && { id: 'success' as const, label: `✓ ${counts.success}`, color: '#3fb950' },
            counts.info    > 0 && { id: 'info' as const,    label: `i ${counts.info}`,    color: '#79c0ff' },
          ].filter(Boolean) as Array<{ id: LogLevel | 'all'; label: string; color: string }>).map(({ id, label, color }) => (
            <button key={id} onClick={() => setFilter(id)} style={{
              padding: '3px 9px', borderRadius: '5px', border: 'none', cursor: 'pointer',
              fontSize: '10px', fontWeight: '700', fontFamily: 'IBM Plex Mono, monospace',
              background: filter === id ? `${color}20` : 'transparent',
              color: filter === id ? color : '#484f58',
              boxShadow: filter === id ? `inset 0 0 0 1px ${color}40` : 'none',
              transition: 'all 0.15s',
            }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Terminal body */}
      <div style={{
        flex: 1, overflow: 'auto', padding: '10px 10px 12px',
        background: '#010409',
        border: '1px solid #21262d',
        borderRadius: '0 0 10px 10px',
        fontFamily: 'IBM Plex Mono, monospace',
        minHeight: '180px',
      }}>
        {!hasContent ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '120px', gap: '8px' }}>
            <div style={{ color: '#21262d', fontSize: '28px' }}>⬡</div>
            <div style={{ color: '#2d333b', fontSize: '11px' }}>System idle — waiting for analysis</div>
            <Cursor />
          </div>
        ) : (
          <>
            {/* Boot line */}
            <div style={{ color: '#2d333b', fontSize: '10px', marginBottom: '10px', paddingBottom: '8px', borderBottom: '1px solid #21262d' }}>
              $ codesense analyze --verbose --strict<br />
              <span style={{ color: '#21262d' }}>initializing engine... phases: lexical → syntactic → semantic → symbolic → cfg</span>
            </div>

            {/* Log entries with staggered animation */}
            {filtered.map((entry, i) => (
              <LogLine key={i} entry={entry} delay={i * 35} visible={visible} />
            ))}

            {/* Complexity at bottom */}
            {visible && (cognitiveComplexity !== undefined || cyclomaticComplexity) && (
              <ComplexityRow cognitive={cognitiveComplexity} cyclomatic={cyclomaticComplexity} />
            )}

            {/* Blinking cursor at end */}
            {visible && (
              <div style={{ marginTop: '10px', color: '#2d333b', fontSize: '11px' }}>
                $ <Cursor />
              </div>
            )}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateX(-6px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes cursorBlink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.4; transform: scale(0.85); }
        }
      `}</style>
    </div>
  );
};