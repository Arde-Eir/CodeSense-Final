import React, { useMemo } from 'react';
import type { Token } from '@/types';

interface TokenChartProps {
  tokens: Token[];
}

const CATEGORIES: Array<{ label: string; match: (type: string) => boolean; color: string }> = [
  { label: 'Keywords',    match: t => t.includes('KEYWORD'),                                            color: '#ff7b72' },
  { label: 'Identifiers', match: t => t === 'IDENTIFIER',                                               color: '#d2a8ff' },
  { label: 'Literals',    match: t => ['NUMBER','STRING','BOOLEAN','CHAR'].some(k => t.includes(k)) || t.includes('LITERAL'), color: '#a5d6ff' },
  { label: 'Operators',   match: t => t.includes('OPERATOR'),                                           color: '#7ee787' },
  { label: 'Separators',  match: t => ['PUNCTUATION','SEPARATOR','BRACKET'].some(k => t.includes(k)),   color: '#79c0ff' },
];

export const TokenChart: React.FC<TokenChartProps> = ({ tokens }) => {
  const stats = useMemo(() => {
    const counts = Object.fromEntries(CATEGORIES.map(c => [c.label, 0]));
    tokens.forEach(t => {
      const upper = (t.type ?? '').toUpperCase();
      for (const cat of CATEGORIES) {
        if (cat.match(upper)) { counts[cat.label]++; break; }
      }
    });
    return counts;
  }, [tokens]);

  const maxCount = Math.max(...Object.values(stats), 1);
  const total = tokens.length;

  return (
    <div style={{ marginTop: '16px', padding: '16px', background: '#0d1117', borderRadius: '10px', border: '1px solid #21262d' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <h3 style={{ margin: 0, fontSize: '11px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '1px', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700 }}>
          Lexical Distribution
        </h3>
        <span style={{ fontSize: '10px', color: '#2d333b', fontFamily: 'IBM Plex Mono, monospace' }}>
          {total} token{total !== 1 ? 's' : ''}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {CATEGORIES.map(({ label, color }) => {
          const count = stats[label];
          const pct = Math.round((count / maxCount) * 100);
          const share = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <div key={label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: '11px', color: count > 0 ? '#c9d1d9' : '#484f58', fontFamily: 'IBM Plex Mono, monospace' }}>{label}</span>
                <span style={{ fontSize: '10px', color, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace' }}>
                  {count > 0 ? `${count} (${share}%)` : '—'}
                </span>
              </div>
              <div style={{ height: '6px', background: '#21262d', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: count > 0 ? color : 'transparent',
                  borderRadius: '3px',
                  transition: 'width 0.5s ease-out',
                  opacity: count > 0 ? 0.85 : 0,
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
