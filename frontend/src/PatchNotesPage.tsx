import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './services/supabase';

interface PatchNote {
  id:            string;
  version:       string;
  title:         string;
  releasedate:   string;
  changes:       unknown[];
  ishighlighted: boolean;
}

type ChangeItem = string | { type?: string; text?: string; [k: string]: unknown };

const TYPE_COLOR: Record<string, string> = {
  feature:     '#58a6ff',
  fix:         '#3fb950',
  improvement: '#e3b341',
  breaking:    '#f85149',
  security:    '#a371f7',
};

const TYPE_LABEL: Record<string, string> = {
  feature:     'Feature',
  fix:         'Fix',
  improvement: 'Improvement',
  breaking:    'Breaking',
  security:    'Security',
};

function renderChange(item: ChangeItem, idx: number) {
  if (typeof item === 'string') {
    return (
      <li key={idx} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 0', borderBottom: '1px solid #21262d' }}>
        <span style={{ color: '#3fb950', flexShrink: 0, marginTop: 1 }}>•</span>
        <span style={{ fontSize: 13, color: '#c9d1d9', lineHeight: 1.55 }}>{item}</span>
      </li>
    );
  }
  const type  = typeof item.type === 'string' ? item.type.toLowerCase() : '';
  const text  = typeof item.text === 'string' ? item.text : JSON.stringify(item);
  const color = TYPE_COLOR[type] ?? '#8b949e';
  const label = TYPE_LABEL[type] ?? type;
  return (
    <li key={idx} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 0', borderBottom: '1px solid #21262d' }}>
      {label && (
        <span style={{
          flexShrink: 0, marginTop: 2,
          fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase',
          color, background: `${color}18`, border: `1px solid ${color}44`,
          borderRadius: 4, padding: '2px 6px',
        }}>{label}</span>
      )}
      <span style={{ fontSize: 13, color: '#c9d1d9', lineHeight: 1.55 }}>{text}</span>
    </li>
  );
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

export const PatchNotesPage: React.FC = () => {
  const navigate = useNavigate();
  const [notes,   setNotes]   = useState<PatchNote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('patch_notes')
      .select('id, version, title, releasedate, changes, ishighlighted')
      .order('releasedate', { ascending: false })
      .then(({ data }) => {
        setNotes((data ?? []) as PatchNote[]);
        setLoading(false);
      });
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#080c11', color: '#e6edf3', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 10,
        height: 56, background: 'rgba(13,17,23,0.97)',
        borderBottom: '1px solid #21262d',
        display: 'flex', alignItems: 'center', gap: 12, padding: '0 24px',
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
            color: '#e6edf3', cursor: 'pointer', fontSize: 17,
            width: 36, height: 36, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >←</button>
        <span style={{ fontSize: 11, color: '#484f58', fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '1px', textTransform: 'uppercase' }}>
          CodeSense
        </span>
        <span style={{ color: '#30363d' }}>›</span>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Patch Notes</span>
      </header>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 80px' }}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: '-0.5px' }}>What's New</h1>
          <p style={{ margin: '8px 0 0', fontSize: 14, color: '#8b949e' }}>
            Release history and change log for CodeSense.
          </p>
        </div>

        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[1, 2, 3].map(n => (
              <div key={n} style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 12, padding: 24, animation: 'fadeUp 0.4s ease both' }}>
                <div style={{ width: 80, height: 12, background: '#21262d', borderRadius: 6, marginBottom: 12 }} />
                <div style={{ width: '60%', height: 16, background: '#21262d', borderRadius: 6, marginBottom: 8 }} />
                <div style={{ width: '90%', height: 10, background: '#161b22', borderRadius: 6 }} />
              </div>
            ))}
          </div>
        )}

        {!loading && notes.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#484f58' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 14 }}>No patch notes published yet.</div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {notes.map((note, i) => (
            <div
              key={note.id}
              style={{
                background: note.ishighlighted ? 'rgba(88,166,255,0.04)' : '#0d1117',
                border: `1px solid ${note.ishighlighted ? 'rgba(88,166,255,0.3)' : '#21262d'}`,
                borderRadius: 12,
                overflow: 'hidden',
                animation: `fadeUp 0.4s ease ${i * 60}ms both`,
              }}
            >
              {/* Card header */}
              <div style={{
                padding: '18px 24px 14px',
                borderBottom: '1px solid #21262d',
                background: note.ishighlighted ? 'rgba(88,166,255,0.04)' : 'rgba(22,27,34,0.5)',
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              }}>
                <span style={{
                  fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 13,
                  color: note.ishighlighted ? '#58a6ff' : '#a371f7',
                  background: note.ishighlighted ? 'rgba(88,166,255,0.12)' : 'rgba(163,113,247,0.1)',
                  border: `1px solid ${note.ishighlighted ? 'rgba(88,166,255,0.3)' : 'rgba(163,113,247,0.25)'}`,
                  borderRadius: 6, padding: '3px 10px',
                }}>{note.version}</span>
                {note.ishighlighted && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: '#58a6ff',
                    background: 'rgba(88,166,255,0.12)', border: '1px solid rgba(88,166,255,0.3)',
                    borderRadius: 4, padding: '2px 8px', letterSpacing: '0.5px', textTransform: 'uppercase',
                  }}>Latest</span>
                )}
                <div style={{ marginLeft: 'auto', fontSize: 11, color: '#484f58' }}>{fmt(note.releasedate)}</div>
              </div>

              {/* Card body */}
              <div style={{ padding: '16px 24px 20px' }}>
                <h2 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700, color: '#e6edf3' }}>
                  {note.title}
                </h2>

                {Array.isArray(note.changes) && note.changes.length > 0 ? (
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                    {note.changes.map((c, ci) => renderChange(c as ChangeItem, ci))}
                  </ul>
                ) : (
                  <div style={{ fontSize: 12, color: '#484f58', fontStyle: 'italic' }}>No changes listed.</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};

export default PatchNotesPage;
