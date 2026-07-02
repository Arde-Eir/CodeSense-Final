// frontend/src/components/TheorySection.tsx
// Renders one theory_sections[] entry. Handles every documented `type`:
//   default · code · did_you_know · mistake · tip · diagram · summary · table
// Each type has its own visual signature so the lesson reads like a
// well-organized study guide rather than a wall of text.

import React from 'react';
import type { TheorySection } from '@/types/campaign';

export const TheorySectionBlock: React.FC<{ sec: TheorySection }> = ({ sec }) => {
  const type = sec.type ?? 'default';

  // ── Code block ────────────────────────────────────────────────────────────
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

  // ── Did-You-Know callout (purple) ────────────────────────────────────────
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

  // ── Common Mistakes (red) ────────────────────────────────────────────────
  if (type === 'mistake') return (
    <div style={{ marginBottom: 16, borderRadius: 10, padding: '16px 18px', background: 'rgba(248,81,73,0.06)', border: '1px solid rgba(248,81,73,0.25)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>⚠️</span>
        <span style={{ fontSize: 10, fontWeight: 800, color: '#f85149', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '2px', textTransform: 'uppercase' }}>WATCH OUT</span>
      </div>
      {sec.heading && <div style={{ fontSize: 14, fontWeight: 700, color: '#c9d1d9', marginBottom: 10, fontFamily: 'Inter,sans-serif' }}>{sec.heading}</div>}
      {sec.body && <p style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.75, margin: '0 0 10px', fontFamily: 'Inter,sans-serif' }}>{sec.body}</p>}
      {sec.mistakes?.map((m, i) => (
        <div key={i} style={{ marginBottom: 10, padding: '10px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: '#f85149', fontWeight: 700, flexShrink: 0, fontFamily: 'Inter,sans-serif' }}>✗</span>
            <pre style={{ fontSize: 12, color: '#f85149', margin: 0, fontFamily: "'JetBrains Mono',monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6, flex: 1 }}>{m.wrong}</pre>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: '#3fb950', fontWeight: 700, flexShrink: 0, fontFamily: 'Inter,sans-serif' }}>✓</span>
            <pre style={{ fontSize: 12, color: '#3fb950', margin: 0, fontFamily: "'JetBrains Mono',monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6, flex: 1 }}>{m.right}</pre>
          </div>
          {m.explanation && <div style={{ fontSize: 12, color: '#8b949e', marginTop: 6, lineHeight: 1.6, fontFamily: 'Inter,sans-serif' }}>💡 {m.explanation}</div>}
        </div>
      ))}
    </div>
  );

  // ── Tips (yellow card grid) ──────────────────────────────────────────────
  if (type === 'tip') return (
    <div style={{ marginBottom: 16, borderRadius: 10, padding: '16px 18px', background: 'rgba(250,204,21,0.06)', border: '1px solid rgba(250,204,21,0.25)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>💡</span>
        <span style={{ fontSize: 10, fontWeight: 800, color: '#facc15', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '2px', textTransform: 'uppercase' }}>TIPS</span>
      </div>
      {sec.heading && <div style={{ fontSize: 14, fontWeight: 700, color: '#c9d1d9', marginBottom: 10, fontFamily: 'Inter,sans-serif' }}>{sec.heading}</div>}
      {sec.body && <p style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.75, margin: '0 0 10px', fontFamily: 'Inter,sans-serif' }}>{sec.body}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
        {sec.tips?.map((t, i) => (
          <div key={i} style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              {t.icon && <span style={{ fontSize: 14 }}>{t.icon}</span>}
              <span style={{ fontSize: 12, fontWeight: 700, color: '#facc15', fontFamily: 'Inter,sans-serif' }}>{t.title}</span>
            </div>
            <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.6, fontFamily: 'Inter,sans-serif' }}>{t.body}</div>
          </div>
        ))}
      </div>
    </div>
  );

  // ── Diagram (image + caption) ────────────────────────────────────────────
  if (type === 'diagram') return (
    <div style={{ marginBottom: 16, borderRadius: 10, padding: '16px 18px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      {sec.heading && <div style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3', marginBottom: 10, fontFamily: 'Inter,sans-serif' }}>{sec.heading}</div>}
      {sec.diagram && <img src={sec.diagram} alt={sec.heading ?? 'diagram'} style={{ display: 'block', maxWidth: '100%', borderRadius: 8, border: '1px solid #30363d' }} />}
      {sec.diagram_caption && <div style={{ fontSize: 12, color: '#8b949e', marginTop: 8, fontStyle: 'italic', fontFamily: 'Inter,sans-serif' }}>{sec.diagram_caption}</div>}
    </div>
  );

  // ── Summary (green-tinted recap card) ────────────────────────────────────
  if (type === 'summary') return (
    <div style={{ marginBottom: 16, borderRadius: 10, padding: '16px 18px', background: 'rgba(63,185,80,0.06)', border: '1px solid rgba(63,185,80,0.25)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>⚡</span>
        <span style={{ fontSize: 10, fontWeight: 800, color: '#3fb950', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '2px', textTransform: 'uppercase' }}>QUICK RECAP</span>
      </div>
      {sec.heading && <div style={{ fontSize: 14, fontWeight: 700, color: '#c9d1d9', marginBottom: 8, fontFamily: 'Inter,sans-serif' }}>{sec.heading}</div>}
      {sec.body && <p style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.75, margin: '0 0 8px', fontFamily: 'Inter,sans-serif' }}>{sec.body}</p>}
      {sec.bullets && (
        <ul style={{ paddingLeft: 4, margin: '4px 0 0', listStyle: 'none' }}>
          {sec.bullets.map((b, i) => (
            <li key={i} style={{ fontSize: 13, color: '#c9d1d9', lineHeight: 1.7, fontFamily: 'Inter,sans-serif', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ color: '#3fb950', flexShrink: 0 }}>✓</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  // ── Table ────────────────────────────────────────────────────────────────
  if (type === 'table') {
    const headers = sec.table_headers ?? [];
    const rows    = sec.table_rows    ?? [];
    return (
      <div style={{ marginBottom: 16, borderRadius: 10, overflow: 'hidden', border: '1px solid #30363d' }}>
        {sec.heading && (
          <div style={{ background: '#161b22', padding: '10px 14px', fontSize: 13, fontWeight: 700, color: '#e6edf3', fontFamily: 'Inter,sans-serif', borderBottom: '1px solid #30363d' }}>
            {sec.heading}
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Inter,sans-serif' }}>
            {headers.length > 0 && (
              <thead>
                <tr style={{ background: '#161b22' }}>
                  {headers.map((h, i) => (
                    <th key={i} style={{ padding: '9px 14px', fontSize: 11, fontWeight: 700, color: '#58a6ff', textTransform: 'uppercase', letterSpacing: '0.8px', textAlign: 'left', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} style={{ background: ri % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{ padding: '8px 14px', fontSize: 13, color: ci === 0 ? '#c9d1d9' : '#8b949e', borderBottom: '1px solid rgba(255,255,255,0.04)', fontFamily: ci === 0 ? "'JetBrains Mono',monospace" : 'Inter,sans-serif', lineHeight: 1.6 }}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sec.body && <div style={{ padding: '10px 14px', fontSize: 12, color: '#8b949e', fontFamily: 'Inter,sans-serif', borderTop: '1px solid #30363d', lineHeight: 1.6 }}>{sec.body}</div>}
      </div>
    );
  }

  // ── Default — heading + body + bullets + items (term/definition rows) ────
  return (
    <div style={{ marginBottom: 16, borderRadius: 10, padding: '16px 18px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      {sec.heading && <div style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3', marginBottom: 8, fontFamily: 'Inter,sans-serif' }}>{sec.heading}</div>}
      {sec.body && <p style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.75, margin: 0, fontFamily: 'Inter,sans-serif' }}>{sec.body}</p>}
      {sec.bullets && <ul style={{ paddingLeft: 18, margin: '8px 0 0' }}>{sec.bullets.map((b, i) => <li key={i} style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.7, fontFamily: 'Inter,sans-serif' }}>{b}</li>)}</ul>}
      {sec.items && sec.items.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sec.items.map((it, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 30%) 1fr', gap: 12, padding: '8px 10px', borderRadius: 6, background: 'rgba(0,0,0,0.18)', border: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#58a6ff', fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.5, wordBreak: 'break-word' }}>{it.term}</span>
              <span style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.6, fontFamily: 'Inter,sans-serif' }}>{it.definition}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TheorySectionBlock;
