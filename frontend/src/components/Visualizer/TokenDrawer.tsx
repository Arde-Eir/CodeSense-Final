import React, { useState } from 'react';
import type { Token } from '@/types';

interface TokenDrawerProps {
  tokens: Token[];
  isOpen: boolean;
  onClose: () => void;
}

export const TokenDrawer: React.FC<TokenDrawerProps> = ({ tokens, isOpen, onClose }) => {
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) return null;
  const drawerZIndex = 5001;

  // --- 1. DOWNLOAD LOGIC ---
  const handleExportJSON = () => {
    if (!tokens || tokens.length === 0) return;
    const jsonString = JSON.stringify(tokens, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lexical_tokens_${new Date().getTime()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // --- 2. FILTER & GROUPING LOGIC ---
  const filteredTokens = tokens.filter(t => {
    if (!t) return false;
    const val = (t.value || '').toLowerCase();
    const type = (t.type || '').toLowerCase();
    const query = searchQuery.toLowerCase();
    return val.includes(query) || type.includes(query);
  });

  const getLiteralSubtype = (token: Token) => {
    const type = (token.type || '').toUpperCase();
    const value = String(token.value || '');

    if (type.includes('STRING')) return 'String';
    if (type.includes('NUMBER') || type.includes('INT') || type.includes('FLOAT')) return 'Numeric';
    if (type.includes('BOOL')) return 'Boolean';

    if (!isNaN(Number(value))) return 'Numeric';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return 'String';
    if (value === 'true' || value === 'false') return 'Boolean';

    return 'Generic';
  };
  const groupedTokens = {
    Keywords: filteredTokens.filter(t => t.type?.toUpperCase().includes('KEYWORD')),
    Identifiers: filteredTokens.filter(t => t.type?.toUpperCase() === 'IDENTIFIER'),
    Literals: filteredTokens.filter(t => {
        const type = t.type?.toUpperCase() || '';
        return ['NUMBER', 'STRING', 'BOOLEAN', 'LITERAL'].includes(type) || type.includes('LITERAL');
    }),
    Operators: filteredTokens.filter(t => t.type?.toUpperCase().includes('OPERATOR')),
    Separators: filteredTokens.filter(t => {
        const type = t.type?.toUpperCase() || '';
        return ['PUNCTUATION', 'SEPARATOR', 'BRACKET'].some(k => type.includes(k));
    }),
    Others: filteredTokens.filter(t => {
        const type = t.type?.toUpperCase() || '';
        const isKeyword = type.includes('KEYWORD');
        const isIdent = type === 'IDENTIFIER';
        const isLiteral = ['NUMBER', 'STRING', 'BOOLEAN', 'LITERAL'].some(k => type.includes(k));
        const isOp = type.includes('OPERATOR');
        const isSep = ['PUNCTUATION', 'SEPARATOR', 'BRACKET'].some(k => type.includes(k));
        
        return !isKeyword && !isIdent && !isLiteral && !isOp && !isSep;
    })
  };

  return (
    <>
      {/* Backdrop Overlay */}
      <div 
        onClick={onClose}
        style={{ 
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', 
          backdropFilter: 'blur(4px)', zIndex: drawerZIndex - 1, animation: 'fadeIn 0.3s ease'
        }} 
      />

      {/* Slide-out Panel */}
      <div role="dialog" aria-modal="true" aria-label="Lexical analysis token drawer" style={{ 
        position: 'fixed', top: 0, right: 0, bottom: 0, height: '100dvh', width: 'min(420px, 100vw)', 
        maxWidth: '100vw', boxSizing: 'border-box',
        backgroundColor: '#0d1117', color: '#e6edf3', zIndex: drawerZIndex, 
        boxShadow: '-10px 0 30px rgba(0,0,0,0.5)', display: 'flex', 
        flexDirection: 'column', borderLeft: '1px solid #30363d',
        animation: 'slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
      }}>
        
        {/* Header */}
        <div style={{ 
          padding: '24px 24px 12px 24px', display: 'flex', 
          justifyContent: 'space-between', alignItems: 'center', background: 'rgba(22, 27, 34, 0.95)',
          position: 'relative', zIndex: 1
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Lexical Analysis</h2>
            <span style={{ fontSize: '12px', color: '#7d8590' }}>{tokens.length} total tokens</span>
          </div>
          <button onClick={onClose} aria-label="Close token drawer" className="close-btn" style={{
            background: '#21262d', border: '1px solid #30363d', color: '#8b949e',
            borderRadius: '6px', width: '32px', height: '32px', cursor: 'pointer', fontSize: '16px',
          }}>&times;</button>
        </div>

        {/* Search Bar Section */}
        <div style={{ padding: '0 24px 16px 24px', background: 'rgba(22, 27, 34, 0.95)', borderBottom: '1px solid #30363d', position: 'relative', zIndex: 1 }}>
          <div style={{ position: 'relative' }}>
            <input 
              type="text"
              placeholder="Filter by value or type..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                paddingLeft: '32px',
                backgroundColor: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: '6px',
                color: 'white',
                fontSize: '13px',
                outline: 'none'
              }}
            />
            <span aria-hidden="true" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>🔍</span>
          </div>
        </div>

       <div className="custom-scroll" style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
  {filteredTokens.length === 0 ? (
    <div style={{ textAlign: 'center', color: '#7d8590', marginTop: '40px' }}>
      No tokens match your search.
    </div>
  ) : (
    Object.entries(groupedTokens).map(([groupName, groupList]) => (
      groupList.length > 0 && (
        <div key={groupName} style={{ marginBottom: '24px' }}>
          <h3 style={{ 
            fontSize: '11px', textTransform: 'uppercase', color: '#7d8590', 
            letterSpacing: '1px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px'
          }}>
            {groupName} <span style={{ fontSize: '10px', color: '#484f58' }}>({groupList.length})</span>
            <div style={{ height: '1px', flex: 1, background: '#30363d' }} />
          </h3>
          
          {groupList.map((token, idx) => (
            <div key={idx} className="token-card" style={{ 
              backgroundColor: '#161b22', marginBottom: '8px', padding: '12px', 
              borderRadius: '8px', border: '1px solid #30363d', display: 'flex', 
              justifyContent: 'space-between', alignItems: 'center'
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {/* Token Type Badge */}
                  <span style={{ fontSize: '9px', fontWeight: 'bold', color: getTokenColor(token.type) }}>
                    {token.type}
                  </span>

                  {/* SPECIFY LITERAL TYPE HERE */}
                  {groupName === 'Literals' && (
                    <span style={{ 
                      fontSize: '9px', 
                      color: '#8b949e', 
                      backgroundColor: '#21262d', 
                      padding: '2px 6px', 
                      borderRadius: '4px',
                      fontStyle: 'italic',
                      border: '1px solid #30363d'
                    }}>
                      {getLiteralSubtype(token)}
                    </span>
                  )}
                </div>

                <code style={{ fontFamily: '"JetBrains Mono", monospace', color: '#ffa657', fontSize: '13px' }}>
                  {token.value}
                </code>
              </div>
              <div style={{ fontSize: '10px', color: '#484f58', textAlign: 'right' }}>
                <div>LN {token.line}</div>
                <div>COL {token.column}</div>
              </div>
            </div>
          ))}
        </div>
      )
    ))
  )}
</div>

        {/* Footer */}
        <div style={{ padding: '16px 20px', borderTop: '1px solid #30363d', background: '#0d1117' }}>
          <button onClick={handleExportJSON} style={{ 
            width: '100%', padding: '12px', borderRadius: '6px', border: 'none', 
            background: '#238636', color: 'white', cursor: 'pointer', fontWeight: 600, fontSize: '14px',
            display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px'
          }}>
            <span>📥</span> Download JSON Report
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .token-card:hover { border-color: #79c0ff !important; transform: translateX(-4px); transition: all 0.2s; }
        .custom-scroll::-webkit-scrollbar { width: 6px; }
        .custom-scroll::-webkit-scrollbar-thumb { background: #30363d; border-radius: 10px; }
        input:focus { border-color: #58a6ff !important; box-shadow: 0 0 0 3px rgba(88,166,255,0.15); }
      `}</style>
    </>
  );
};

const getTokenColor = (type: string) => {
  const types: Record<string, string> = {
    KEYWORD: '#ff7b72', IDENTIFIER: '#d2a8ff', STRING: '#a5d6ff',
    NUMBER: '#79c0ff', OPERATOR: '#7ee787', COMMENT: '#8b949e', PUNCTUATION: '#79c0ff'
  };
  return types[type.toUpperCase()] || '#e6edf3';
};
