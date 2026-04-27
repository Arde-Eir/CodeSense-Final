import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import './layout.css';
import { CodeEditor } from './components/Editor/CodeEditor';
import { analyzeCode } from './services/api';
import { FlowGraph } from './components/Visualizer/FlowGraph';
import { TokenDrawer } from './components/Visualizer/TokenDrawer';
import { TokenChart } from './components/Visualizer/TokenChart';
import { useAuth } from './components/AuthScreen';
import { DataIsolationService } from './Dataisolationservice';
import { DatabaseService } from './services/DatabaseService';
import { supabase } from './services/supabase';
import { getLevelProgress, getXPToNextLevel, getRank } from './types';
import type { AnalysisResult, SymbolInfo } from './types';
import { ASTViewer } from './components/Visualizer/Astviewer';
import { MathTab } from './components/Visualizer/MathTab';
import { LogsTab } from './components/Visualizer/LogsTab';

type AppMode = 'analyze' | 'build';

interface LiveStats {
  totalXP: number;
  currentLevel: 1 | 2 | 3 | 4 | 5;
  sandboxRuns: number;
  rankName: string;
}

// ─── Rank config ──────────────────────────────────────────────────────────────
const RANK_CONFIG = {
  1: { color: '#8b949e', icon: '🛡️', label: 'Squire' },
  2: { color: '#58a6ff', icon: '⚔️', label: 'Knight' },
  3: { color: '#a371f7', icon: '🌟', label: 'Lord'   },
  4: { color: '#e3b341', icon: '👑', label: 'Duke'   },
  5: { color: '#ffd700', icon: '🔱', label: 'King'   },
} as const;

// ─── Player HUD ───────────────────────────────────────────────────────────────
const PlayerHUD: React.FC<{
  user: { id: string; playerName: string } | null;
  isGuest: boolean;
  liveStats: LiveStats | null;
  runFlash: boolean;
}> = ({ user, isGuest, liveStats, runFlash }) => {
  if (isGuest) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', background: 'rgba(139,148,158,0.06)', border: '1px solid #2d333b', borderRadius: '8px' }}>
      <span style={{ fontSize: '15px' }}>👤</span>
      <div>
        <div style={{ color: '#8b949e', fontSize: '11px', fontWeight: '700', letterSpacing: '0.5px', fontFamily: 'IBM Plex Mono, monospace' }}>GUEST</div>
        <div style={{ color: '#484f58', fontSize: '10px' }}>Sign up to save progress</div>
      </div>
    </div>
  );

  if (!user || !liveStats) return (
    <div style={{ width: '180px', height: '36px', background: '#1c2128', border: '1px solid #2d333b', borderRadius: '8px', display: 'flex', alignItems: 'center', padding: '0 12px' }}>
      <div style={{ width: '100%', height: '6px', background: '#2d333b', borderRadius: '3px', animation: 'shimmer 1.2s ease-in-out infinite' }} />
    </div>
  );

  const rank = RANK_CONFIG[liveStats.currentLevel];
  const progress = getLevelProgress(liveStats.totalXP);
  const xpToNext = getXPToNextLevel(liveStats.totalXP);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '6px 12px 6px 8px',
      background: 'rgba(13,17,23,0.8)',
      border: `1px solid ${rank.color}33`,
      borderRadius: '10px',
      position: 'relative',
    }}>
      <div style={{
        width: '34px', height: '34px', borderRadius: '8px', flexShrink: 0,
        background: `${rank.color}18`, border: `1px solid ${rank.color}44`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px',
      }}>
        {rank.icon}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '110px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ color: '#e6edf3', fontSize: '12px', fontWeight: '700', maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.playerName}
          </span>
          <span style={{ color: rank.color, fontSize: '9px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', fontFamily: 'IBM Plex Mono, monospace' }}>
            {rank.label}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ flex: 1, height: '3px', background: 'rgba(255,255,255,0.07)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: rank.color, borderRadius: '2px', transition: 'width 0.6s ease' }} />
          </div>
          <span style={{ color: '#484f58', fontSize: '9px', whiteSpace: 'nowrap', fontFamily: 'IBM Plex Mono, monospace' }}>
            {xpToNext === null ? 'MAX' : `${liveStats.totalXP} XP`}
          </span>
        </div>
      </div>

      <div style={{ width: '1px', height: '28px', background: '#2d333b', flexShrink: 0 }} />

      <div style={{ textAlign: 'center', flexShrink: 0 }}>
        <div style={{ color: '#3fb950', fontSize: '16px', fontWeight: '700', lineHeight: 1, fontFamily: 'IBM Plex Mono, monospace' }}>
          {liveStats.sandboxRuns}
        </div>
        <div style={{ color: '#484f58', fontSize: '9px', letterSpacing: '0.5px', textTransform: 'uppercase', fontFamily: 'IBM Plex Mono, monospace' }}>RUNS</div>
      </div>

      {/* Run flash indicator — no XP, just shows analysis ran */}
      {runFlash && (
        <div style={{ position: 'absolute', top: '-28px', right: '6px', color: '#58a6ff', fontSize: '11px', fontWeight: '700', animation: 'xpFloat 1.8s ease-out forwards', pointerEvents: 'none', whiteSpace: 'nowrap', fontFamily: 'IBM Plex Mono, monospace' }}>
          🔬 analyzed
        </div>
      )}
    </div>
  );
};

// ─── Mode Toggle ──────────────────────────────────────────────────────────────
const ModeToggle: React.FC<{ mode: AppMode; onChange: (m: AppMode) => void }> = ({ mode, onChange }) => (
  <div style={{
    display: 'flex', gap: 0,
    background: '#0d1117',
    border: '1px solid #2d333b',
    borderRadius: '10px', padding: '3px',
  }}>
    {([
      { id: 'analyze' as AppMode, label: '🔍 Analyze Code',    color: '#3fb950' },
      { id: 'build'   as AppMode, label: '🎨 Build Flowchart', color: '#a371f7' },
    ]).map(({ id, label, color }) => (
      <button key={id} onClick={() => onChange(id)} style={{
        padding: '7px 18px', borderRadius: '8px', border: 'none',
        fontSize: '12px', fontWeight: '700', cursor: 'pointer',
        letterSpacing: '0.3px', transition: 'all 0.2s',
        fontFamily: 'IBM Plex Sans, sans-serif',
        background: mode === id ? `${color}22` : 'transparent',
        color: mode === id ? color : '#484f58',
        boxShadow: mode === id ? `inset 0 0 0 1px ${color}55` : 'none',
      }}>
        {label}
      </button>
    ))}
  </div>
);

// ─── Safety Banner ────────────────────────────────────────────────────────────
const SafetyBanner: React.FC<{ total: number; unsafe: number }> = ({ total, unsafe }) => {
  if (total === 0) return null;
  const allSafe = unsafe === 0;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '8px 16px',
      background: allSafe ? 'rgba(63,185,80,0.07)' : 'rgba(248,81,73,0.07)',
      borderBottom: `1px solid ${allSafe ? 'rgba(63,185,80,0.2)' : 'rgba(248,81,73,0.2)'}`,
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <span style={{ fontSize: '11px' }}>📍</span>
        <span style={{ color: '#8b949e', fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace' }}>Nodes</span>
        <span style={{ color: '#e6edf3', fontSize: '13px', fontWeight: '700', fontFamily: 'IBM Plex Mono, monospace' }}>{total}</span>
      </div>
      <div style={{ width: '1px', height: '16px', background: '#2d333b' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <span style={{ fontSize: '11px' }}>{allSafe ? '✅' : '⚠️'}</span>
        <span style={{ color: '#8b949e', fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace' }}>Safety</span>
        <span style={{ color: allSafe ? '#3fb950' : '#f85149', fontSize: '13px', fontWeight: '700', fontFamily: 'IBM Plex Mono, monospace' }}>
          {allSafe ? 'All clear' : `${unsafe} issue${unsafe > 1 ? 's' : ''}`}
        </span>
      </div>
      <div style={{ flex: 1, height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden', maxWidth: '160px', marginLeft: 'auto' }}>
        <div style={{ width: `${((total - unsafe) / total) * 100}%`, height: '100%', background: allSafe ? '#3fb950' : '#f0883e', borderRadius: '2px', transition: 'width 0.5s ease' }} />
      </div>
    </div>
  );
};

// ─── Generated Code Viewer ────────────────────────────────────────────────────
const GeneratedCodeViewer: React.FC<{
  code: string;
  onLoadInEditor: (code: string) => void;
}> = ({ code, onLoadInEditor }) => {
  const [copied, setCopied] = useState(false);

  if (!code) return (
    <div className="placeholder-text">
      <div style={{ fontSize: '28px', marginBottom: '12px', opacity: 0.15 }}>⚡</div>
      <div style={{ color: '#484f58', marginBottom: '6px' }}>No code generated yet</div>
      <div style={{ color: '#2d333b', fontSize: '12px' }}>
        Build a flowchart → click <span style={{ color: '#a371f7' }}>⚡ GENERATE C++</span>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 2px' }}>
        <span style={{ fontSize: '11px', color: '#a371f7', fontWeight: '700', letterSpacing: '0.5px', textTransform: 'uppercase', fontFamily: 'IBM Plex Mono, monospace' }}>⚡ Generated C++</span>
        <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#484f58' }}>from flowchart</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', background: '#010409', border: '1px solid rgba(163,113,247,0.2)', borderRadius: '8px', padding: '14px' }}>
        <pre style={{ margin: 0, fontSize: '12px', color: '#c9d1d9', fontFamily: 'IBM Plex Mono, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.8' }}>
          {code}
        </pre>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
        <button
          onClick={() => { navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }); }}
          style={{ flex: 1, padding: '9px', borderRadius: '8px', border: `1px solid ${copied ? 'rgba(63,185,80,0.5)' : 'rgba(163,113,247,0.4)'}`, background: copied ? 'rgba(63,185,80,0.1)' : 'rgba(163,113,247,0.08)', color: copied ? '#3fb950' : '#a371f7', fontSize: '12px', fontWeight: '700', cursor: 'pointer', transition: 'all 0.2s' }}>
          {copied ? '✓ Copied!' : '📋 Copy'}
        </button>
        <button
          onClick={() => onLoadInEditor(code)}
          style={{ flex: 1, padding: '9px', borderRadius: '8px', border: '1px solid rgba(63,185,80,0.4)', background: 'rgba(63,185,80,0.08)', color: '#3fb950', fontSize: '12px', fontWeight: '700', cursor: 'pointer', transition: 'all 0.2s' }}>
          🔍 Load &amp; Analyze
        </button>
      </div>
    </div>
  );
};

// ─── Accordion Panel ──────────────────────────────────────────────────────────
interface AccordionPanelProps {
  label: string;
  icon: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  height?: number;
  accentColor?: string;
  badge?: React.ReactNode;
}

const HEADER_H = 46;

const AccordionPanel: React.FC<AccordionPanelProps> = ({
  label, icon, isOpen, onToggle, children, height, accentColor = '#3fb950', badge
}) => {
  const outerStyle: React.CSSProperties = isOpen
    ? height != null
      ? { height: `${height}px`, flexShrink: 0, flexGrow: 0 }
      : { flex: '1 1 0', minHeight: 120, overflow: 'hidden' }
    : { flexShrink: 0 };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      background: '#0d1117',
      border: `1px solid ${isOpen ? `${accentColor}30` : '#1c2128'}`,
      borderRadius: '10px',
      overflow: 'hidden',
      transition: 'border-color 0.2s, box-shadow 0.2s',
      boxShadow: isOpen ? `0 0 0 1px ${accentColor}10, 0 4px 24px rgba(0,0,0,0.3)` : 'none',
      ...outerStyle,
    }}>
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '0 16px',
          height: `${HEADER_H}px`,
          background: isOpen
            ? `linear-gradient(90deg, ${accentColor}0d 0%, transparent 100%)`
            : 'transparent',
          border: 'none',
          borderBottom: isOpen ? `1px solid ${accentColor}20` : '1px solid transparent',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
          transition: 'background 0.2s',
          flexShrink: 0,
        }}
      >
        <div style={{ width: '3px', height: '18px', borderRadius: '2px', background: isOpen ? accentColor : '#2d333b', transition: 'background 0.2s', flexShrink: 0 }} />
        <span style={{ fontSize: '14px', flexShrink: 0 }}>{icon}</span>
        <span style={{ color: isOpen ? '#e6edf3' : '#8b949e', fontSize: '12px', fontWeight: '700', letterSpacing: '0.4px', fontFamily: 'IBM Plex Mono, monospace', textTransform: 'uppercase', flex: 1, transition: 'color 0.2s' }}>
          {label}
        </span>
        {badge && <div style={{ marginRight: '4px' }}>{badge}</div>}
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.25s ease', flexShrink: 0 }}>
          <path d="M3 5L7 9L11 5" stroke={isOpen ? accentColor : '#484f58'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {isOpen && (
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {children}
        </div>
      )}
    </div>
  );
};

// ─── Resize Handle ────────────────────────────────────────────────────────────
const ResizeHandle: React.FC<{ onDrag: (dy: number) => void; disabled?: boolean }> = ({ onDrag, disabled }) => {
  const dragging = useRef(false);
  const lastY = useRef(0);
  const [hovered, setHovered] = useState(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled) return;
    e.preventDefault();
    dragging.current = true;
    lastY.current = e.clientY;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      onDrag(ev.clientY - lastY.current);
      lastY.current = ev.clientY;
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [onDrag, disabled]);

  if (disabled) return <div style={{ height: '8px' }} />;

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: '16px',
        cursor: 'row-resize',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        position: 'relative',
        zIndex: 10,
      }}
    >
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '3px',
        padding: '4px 20px',
        borderRadius: '6px',
        background: hovered ? 'rgba(88,166,255,0.08)' : 'transparent',
        border: hovered ? '1px solid rgba(88,166,255,0.2)' : '1px solid transparent',
        transition: 'all 0.15s',
      }}>
        {[0, 1].map(i => (
          <div key={i} style={{
            width: '32px',
            height: '2px',
            borderRadius: '1px',
            background: hovered ? '#58a6ff' : '#2d333b',
            transition: 'background 0.15s',
          }} />
        ))}
      </div>
    </div>
  );
};

// ─── SandboxPage ──────────────────────────────────────────────────────────────
export const SandboxPage = () => {
  const navigate = useNavigate();
  const { user, isGuest } = useAuth();
  const editorRef = useRef<any>(null);

  const [mode, setMode] = useState<AppMode>('analyze');
  // Quick Start restore: if the dashboard handed us a snippet via sessionStorage,
  // load it as the initial editor content. Falls back to the default demo.
  const [code, setCode] = useState<string>(() => {
    try {
      const restored = sessionStorage.getItem('cs-sandbox-restore');
      if (restored && restored.trim().length > 0) {
        sessionStorage.removeItem('cs-sandbox-restore');
        return restored;
      }
    } catch { /* sessionStorage may be unavailable */ }
    return `#include <iostream>
using namespace std;

int main() {
    int hp = 100;
    int damage = 0;
    cout<<"Hello,World!";
    // Safety Risk: Division by Zero
    int risk = hp / damage;
    while (hp > 0) {
        hp = hp - 10;
    }
    return 0;
}`;
  });

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [isTokenDrawerOpen, setIsTokenDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('lexical');
  const [tabFullscreen, setTabFullscreen] = useState(false);
  const [editorFullscreen, setEditorFullscreen] = useState(false);
  const [builtCode, setBuiltCode] = useState('');
  const [liveStats, setLiveStats] = useState<LiveStats | null>(null);
  // runFlash: shows "analyzed" indicator without any XP implication
  const [runFlash, setRunFlash] = useState(false);

  const [openPanels, setOpenPanels] = useState<{ editor: boolean; tabs: boolean }>({
    editor: true,
    tabs: false,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const [editorHeight, setEditorHeight] = useState<number | null>(null);
  const [tabsHeight, setTabsHeight] = useState<number | null>(null);

  const bothOpen = openPanels.editor && openPanels.tabs;

  const togglePanel = (panel: 'editor' | 'tabs') => {
    setEditorHeight(null);
    setTabsHeight(null);
    setOpenPanels(prev => ({ ...prev, [panel]: !prev[panel] }));
  };

  const handleDrag = useCallback((dy: number) => {
    const container = containerRef.current;
    if (!container) return;
    const available = container.clientHeight - 24 - (HEADER_H * 2) - 16;

    setEditorHeight(prev => {
      const current = prev ?? Math.round(available * 0.35);
      const next = Math.max(80, Math.min(available - 120, current + dy));
      setTabsHeight(available - next);
      return next;
    });
  }, []);

  const fetchLiveStats = async () => {
    if (!user?.id) return;
    try {
      const { data } = await supabase.from('users').select('totalxp, sandbox_runs').eq('id', user.id).single();
      if (data) {
        // Rank derived from XP, not from `currentlevel` (which can be stale).
        const rank = getRank(data.totalxp ?? 0);
        setLiveStats({ totalXP: data.totalxp ?? 0, currentLevel: rank.level, sandboxRuns: data.sandbox_runs ?? 0, rankName: rank.name });
      }
    } catch (err) { console.error('Failed to fetch live stats:', err); }
  };

  useEffect(() => { fetchLiveStats(); }, [user?.id]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (tabFullscreen) setTabFullscreen(false);
        if (editorFullscreen) setEditorFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [tabFullscreen, editorFullscreen]);

  const handleNodeClick = (line: number) => {
    if (!editorRef.current) return;
    const model = editorRef.current.getModel();
    if (model) {
      const len = model.getLineContent(line).length;
      editorRef.current.setSelection({ startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: len + 1 });
      editorRef.current.revealLineInCenterIfOutsideViewport(line);
      editorRef.current.focus();
    }
  };

  const handleAnalyze = async () => {
    if (!user && !isGuest) return;
    DataIsolationService.saveSandboxCode(isGuest ? null : user?.id || null, code, 'main.cpp');
    setIsAnalyzing(true);
    try {
      const data = await analyzeCode(code);
      setResult(data);

      // Sandbox: log run (NO XP awarded) and update run counter only
      if (data.success && user) {
        await DatabaseService.logSandboxRun(user.id, code, data.cognitiveComplexity ?? 0, data.symbolTable ?? {});
        await fetchLiveStats();
        // Show "analyzed" flash — NOT an XP gain notification
        setRunFlash(true);
        setTimeout(() => setRunFlash(false), 2200);
      }
      if (data.success && isGuest) DataIsolationService.saveGuestProgress({ sandboxProgress: { lastCode: code } });
    } catch (err) { console.error('Analysis failed:', err); }
    finally { setIsAnalyzing(false); }
  };

  const getSymbolList = (): SymbolInfo[] => {
    if (!result?.symbolTable) return [];
    return Array.isArray(result.symbolTable) ? result.symbolTable : Object.values(result.symbolTable);
  };
  const symbols = getSymbolList();

  const totalNodes = result?.cfg?.nodes?.length ?? 0;
  const unsafeCount = result?.safetyChecks?.filter(c => c.status === 'UNSAFE').length ?? 0;

  const TABS = [
    { id: 'lexical',   label: 'Lexical'   },
    { id: 'syntactic', label: 'Syntactic' },
    { id: 'symbols',   label: 'Symbols'   },
    { id: 'math',      label: 'Math'      },
    { id: 'logs',      label: 'Logs'      },
  ];

  return (
    <div className="app-container">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="app-header">
        <div className="header-brand" onClick={() => navigate('/home')} title="Return to Dashboard">
          <span className="brand-icon">📦</span>
          <span className="brand-text">CodeSense</span>
        </div>

        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
          <ModeToggle mode={mode} onChange={setMode} />
        </div>

        <div className="header-actions">
          {/* Sandbox mode badge — make clear no XP is earned here */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            padding: '4px 10px', borderRadius: '6px',
            background: 'rgba(88,166,255,0.08)', border: '1px solid rgba(88,166,255,0.2)',
            fontSize: '10px', color: '#58a6ff', fontFamily: 'IBM Plex Mono, monospace',
            fontWeight: '700',
          }}>
            🔬 FREE SANDBOX — No XP
          </div>
          <PlayerHUD user={user} isGuest={isGuest} liveStats={liveStats} runFlash={runFlash} />
          <button className="exit-btn" onClick={() => navigate('/home')}>EXIT ⎋</button>
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <main className="main-layout">

        {/* ══════════════════ ANALYZE MODE ══════════════════════════════ */}
        {mode === 'analyze' && (<>
          <div
            ref={containerRef}
            className="left-column"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0px',
              padding: '12px 10px 12px 12px',
              overflow: 'hidden',
              minHeight: 0,
            }}
          >
            <AccordionPanel
              label="Source Code"
              icon="📝"
              isOpen={openPanels.editor}
              onToggle={() => togglePanel('editor')}
              accentColor="#3fb950"
              height={bothOpen && editorHeight != null ? editorHeight : undefined}
              badge={
                <span style={{
                  fontSize: '9px',
                  fontFamily: 'IBM Plex Mono, monospace',
                  color: '#484f58',
                  background: '#1c2128',
                  border: '1px solid #2d333b',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  letterSpacing: '0.4px',
                }}>
                  main.cpp
                </span>
              }
            >
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '12px', minHeight: 0 }}>
                <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
                  <div className="editor-container" style={{ height: '100%' }}>
                    <CodeEditor code={code} onChange={setCode} onEditorMount={e => (editorRef.current = e)} />
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditorFullscreen(true)}
                    title="Fullscreen Editor"
                    style={{
                      position: 'absolute', bottom: '8px', right: '8px', zIndex: 10,
                      padding: '4px 10px', borderRadius: '6px',
                      border: '1px solid rgba(63,185,80,0.3)', background: 'rgba(13,17,23,0.85)',
                      color: '#3fb950', fontSize: '11px', fontWeight: '700', cursor: 'pointer',
                      fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.4px',
                      display: 'flex', alignItems: 'center', gap: '5px',
                      backdropFilter: 'blur(4px)', transition: 'all 0.2s',
                    }}
                  >
                    ⛶ FULL
                  </button>
                </div>
                <div className="action-bar" style={{ marginTop: '10px', flexShrink: 0 }}>
                  <button onClick={handleAnalyze} disabled={isAnalyzing} className="analyze-btn">
                    {isAnalyzing ? '⟳  Analyzing…' : 'ANALYZE CODE'}
                  </button>
                </div>
              </div>
            </AccordionPanel>

            <ResizeHandle onDrag={handleDrag} disabled={!bothOpen} />

            <AccordionPanel
              label="Analysis"
              icon="🔬"
              isOpen={openPanels.tabs}
              onToggle={() => togglePanel('tabs')}
              accentColor="#58a6ff"
              height={bothOpen && tabsHeight != null ? tabsHeight : undefined}
              badge={
                result && (
                  <span style={{
                    fontSize: '9px',
                    fontFamily: 'IBM Plex Mono, monospace',
                    color: unsafeCount > 0 ? '#f85149' : '#3fb950',
                    background: unsafeCount > 0 ? 'rgba(248,81,73,0.1)' : 'rgba(63,185,80,0.1)',
                    border: `1px solid ${unsafeCount > 0 ? 'rgba(248,81,73,0.3)' : 'rgba(63,185,80,0.3)'}`,
                    borderRadius: '4px',
                    padding: '2px 6px',
                  }}>
                    {unsafeCount > 0 ? `⚠ ${unsafeCount} issue${unsafeCount > 1 ? 's' : ''}` : '✓ clear'}
                  </span>
                )
              }
            >
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                <div className="tab-headers">
                  {TABS.map(({ id, label }) => (
                    <button key={id} onClick={() => setActiveTab(id)} className={activeTab === id ? 'tab-link active' : 'tab-link'}>
                      {label}
                    </button>
                  ))}
                  {result && (
                    <button
                      onClick={() => setTabFullscreen(true)}
                      title="View Fullscreen"
                      style={{
                        marginLeft: 'auto', marginRight: '8px',
                        padding: '4px 10px', borderRadius: '6px',
                        border: '1px solid rgba(88,166,255,0.3)', background: 'rgba(88,166,255,0.08)',
                        color: '#58a6ff', fontSize: '11px', fontWeight: '700', cursor: 'pointer',
                        fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.4px',
                        display: 'flex', alignItems: 'center', gap: '5px',
                        flexShrink: 0, whiteSpace: 'nowrap', transition: 'all 0.2s',
                      }}
                    >
                      ⛶ FULL
                    </button>
                  )}
                </div>

                <div className="tab-content" style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                  {activeTab === 'lexical' && (
                    <div className="tab-view-scroll">
                      {result?.tokens ? (
                        <div className="token-integration">
                          <TokenChart tokens={result.tokens} />
                          <div className="token-action-footer">
                            <button onClick={() => setIsTokenDrawerOpen(true)} className="view-all-tokens-btn">
                              Open Token Drawer →
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="placeholder-text">Run analysis to view token distribution.</div>
                      )}
                    </div>
                  )}
                  {activeTab === 'syntactic' && (
                    <div className="tab-view-scroll">
                      {result?.ast ? <ASTViewer ast={result.ast} /> : <div className="placeholder-text">Run analysis to view AST.</div>}
                    </div>
                  )}
                  {activeTab === 'symbols' && (
                    <div className="tab-view-scroll">
                      {symbols.length > 0 ? (
                        <table className="symbol-table">
                          <thead><tr><th>Type</th><th>Variable</th><th style={{ textAlign: 'right' }}>Line</th></tr></thead>
                          <tbody>
                            {symbols.map((s, i) => (
                              <tr key={i}>
                                <td className="symbol-type">{s.type}</td>
                                <td className="symbol-name">{s.name}</td>
                                <td className="symbol-line">{s.line}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : <div className="placeholder-text">No symbols detected.</div>}
                    </div>
                  )}
                  {activeTab === 'math' && (
                    <div className="tab-view-scroll">
                      <MathTab safetyChecks={result?.safetyChecks} symbolicExecution={result?.symbolicExecution} />
                    </div>
                  )}
                  {activeTab === 'logs' && (
                    <div className="tab-view-scroll" style={{ height: '100%' }}>
                      <LogsTab
                        explanations={result?.explanations}
                        errors={result?.errors}
                        warnings={result?.warnings}
                        success={result?.success}
                        cognitiveComplexity={result?.cognitiveComplexity}
                        cyclomaticComplexity={result?.cyclomaticComplexity}
                      />
                    </div>
                  )}
                </div>
              </div>
            </AccordionPanel>
          </div>

          <div className="right-column">
            <div className="section-title cfg-title">Control Flow Graph</div>
            {result?.success && result.cfg && (
              <SafetyBanner total={totalNodes} unsafe={unsafeCount} />
            )}
            <div className="visualizer-container">
              {result?.success && result.cfg ? (
                <FlowGraph cfg={result.cfg} safetyChecks={result.safetyChecks} onNodeClick={handleNodeClick} isDrawerOpen={isTokenDrawerOpen} />
              ) : (
                <div className="placeholder-msg">
                  Run ANALYZE CODE to generate<br />the Control Flow Graph
                </div>
              )}
            </div>
          </div>
        </>)}

        {/* ══════════════════ BUILD MODE ════════════════════════════════ */}
        {mode === 'build' && (<>
          <div className="left-column">
            <section className="editor-section" style={{ flex: 1 }}>
              <div className="section-title build-title">Generated C++ Output</div>
              <div className="editor-container" style={{ padding: '16px', display: 'flex', flexDirection: 'column' }}>
                <GeneratedCodeViewer code={builtCode} onLoadInEditor={c => { setCode(c); setMode('analyze'); setResult(null); }} />
              </div>
            </section>
            <div style={{
              padding: '14px 16px', background: 'rgba(163,113,247,0.05)',
              border: '1px solid rgba(163,113,247,0.2)', borderRadius: '10px',
              fontSize: '12px', color: '#8b949e', lineHeight: '1.8', flexShrink: 0,
            }}>
              <div style={{ color: '#a371f7', fontWeight: '700', marginBottom: '6px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'IBM Plex Mono, monospace' }}>
                🎨 How to build
              </div>
              <div>1. Use <strong style={{ color: '#58a6ff' }}>ADD NODE</strong> on the canvas to place shapes</div>
              <div>2. Double-click nodes to write C++ code inside them</div>
              <div>3. Connect nodes with edges (drag from handle to handle)</div>
              <div>4. Label decision edges <strong style={{ color: '#3fb950' }}>true</strong> / <strong style={{ color: '#f85149' }}>false</strong></div>
              <div>5. Hit <strong style={{ color: '#a371f7' }}>⚡ GENERATE C++</strong> in the canvas panel</div>
              <div style={{ marginTop: '8px', color: '#484f58' }}>Then use <strong style={{ color: '#3fb950' }}>🔍 Load &amp; Analyze</strong> to send to the analyzer.</div>
            </div>
          </div>
          <div className="right-column">
            <div className="section-title build-title">Flowchart Canvas</div>
            <div className="visualizer-container">
              <FlowGraph onCodeGenerated={setBuiltCode} />
            </div>
          </div>
        </>)}
      </main>

      {mode === 'analyze' && (
        <TokenDrawer tokens={result?.tokens || []} isOpen={isTokenDrawerOpen} onClose={() => setIsTokenDrawerOpen(false)} />
      )}

      {/* ── Tab Fullscreen Modal ── */}
      {tabFullscreen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(1,4,9,0.92)', backdropFilter: 'blur(6px)', display: 'flex', flexDirection: 'column', padding: '24px' }}
          onClick={(e) => { if (e.target === e.currentTarget) setTabFullscreen(false); }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0d1117', border: '1px solid rgba(88,166,255,0.25)', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 0 0 1px rgba(88,166,255,0.1), 0 32px 80px rgba(0,0,0,0.6)', minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '0 16px', height: '52px', borderBottom: '1px solid rgba(88,166,255,0.15)', background: 'linear-gradient(90deg, rgba(88,166,255,0.06) 0%, transparent 100%)', flexShrink: 0, gap: '6px' }}>
              <div style={{ width: '3px', height: '18px', borderRadius: '2px', background: '#58a6ff', flexShrink: 0 }} />
              <span style={{ fontSize: '14px', flexShrink: 0 }}>🔬</span>
              <div style={{ display: 'flex', gap: '2px', flex: 1, overflowX: 'auto' }}>
                {TABS.map(({ id, label }) => (
                  <button key={id} onClick={() => setActiveTab(id)} style={{ padding: '5px 14px', borderRadius: '6px', border: activeTab === id ? '1px solid rgba(88,166,255,0.45)' : '1px solid transparent', background: activeTab === id ? 'rgba(88,166,255,0.14)' : 'transparent', color: activeTab === id ? '#58a6ff' : '#484f58', fontSize: '11px', fontWeight: '700', cursor: 'pointer', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.4px', whiteSpace: 'nowrap', transition: 'all 0.15s', flexShrink: 0 }}>
                    {label}
                  </button>
                ))}
              </div>
              <span style={{ fontSize: '10px', fontFamily: 'IBM Plex Mono, monospace', color: result?.success ? '#3fb950' : '#f85149', background: result?.success ? 'rgba(63,185,80,0.1)' : 'rgba(248,81,73,0.1)', border: `1px solid ${result?.success ? 'rgba(63,185,80,0.3)' : 'rgba(248,81,73,0.3)'}`, borderRadius: '5px', padding: '3px 8px', flexShrink: 0 }}>
                {result?.success ? '● PASS' : '● FAIL'}
              </span>
              <button type="button" onMouseDown={(e) => { e.stopPropagation(); setTabFullscreen(false); }} style={{ padding: '6px 16px', borderRadius: '7px', border: '1px solid rgba(248,81,73,0.4)', background: 'rgba(248,81,73,0.1)', color: '#f85149', fontSize: '12px', fontWeight: '700', cursor: 'pointer', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.3px', flexShrink: 0 }}>
                ✕ CLOSE
              </button>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, padding: '16px' }}>
              <div style={{ flex: 1, overflow: 'auto', minHeight: 0, height: '100%' }}>
                {activeTab === 'lexical' && (result?.tokens ? <div className="token-integration"><TokenChart tokens={result.tokens} /><div className="token-action-footer"><button onClick={() => { setTabFullscreen(false); setIsTokenDrawerOpen(true); }} className="view-all-tokens-btn">Open Token Drawer →</button></div></div> : <div className="placeholder-text">Run analysis to view token distribution.</div>)}
                {activeTab === 'syntactic' && (result?.ast ? <ASTViewer ast={result.ast} /> : <div className="placeholder-text">Run analysis to view AST.</div>)}
                {activeTab === 'symbols' && (symbols.length > 0 ? <table className="symbol-table"><thead><tr><th>Type</th><th>Variable</th><th style={{ textAlign: 'right' }}>Line</th></tr></thead><tbody>{symbols.map((s, i) => <tr key={i}><td className="symbol-type">{s.type}</td><td className="symbol-name">{s.name}</td><td className="symbol-line">{s.line}</td></tr>)}</tbody></table> : <div className="placeholder-text">No symbols detected.</div>)}
                {activeTab === 'math' && <MathTab safetyChecks={result?.safetyChecks} symbolicExecution={result?.symbolicExecution} />}
                {activeTab === 'logs' && <LogsTab explanations={result?.explanations} errors={result?.errors} warnings={result?.warnings} success={result?.success} cognitiveComplexity={result?.cognitiveComplexity} cyclomaticComplexity={result?.cyclomaticComplexity} />}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Editor Fullscreen Modal ── */}
      {editorFullscreen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(1,4,9,0.92)', backdropFilter: 'blur(6px)', display: 'flex', flexDirection: 'column', padding: '24px' }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditorFullscreen(false); }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0d1117', border: '1px solid rgba(63,185,80,0.25)', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 0 0 1px rgba(63,185,80,0.1), 0 32px 80px rgba(0,0,0,0.6)', minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '0 16px', height: '52px', borderBottom: '1px solid rgba(63,185,80,0.15)', background: 'linear-gradient(90deg, rgba(63,185,80,0.06) 0%, transparent 100%)', flexShrink: 0, gap: '10px' }}>
              <div style={{ width: '3px', height: '18px', borderRadius: '2px', background: '#3fb950', flexShrink: 0 }} />
              <span style={{ fontSize: '14px' }}>📝</span>
              <span style={{ color: '#e6edf3', fontSize: '12px', fontWeight: '700', letterSpacing: '0.5px', fontFamily: 'IBM Plex Mono, monospace', textTransform: 'uppercase', flex: 1 }}>Source Code — Full View</span>
              <span style={{ fontSize: '10px', fontFamily: 'IBM Plex Mono, monospace', color: '#8b949e', background: '#1c2128', border: '1px solid #2d333b', borderRadius: '5px', padding: '3px 8px', flexShrink: 0 }}>main.cpp</span>
              <button type="button" onMouseDown={(e) => { e.stopPropagation(); setEditorFullscreen(false); }} style={{ padding: '6px 16px', borderRadius: '7px', border: '1px solid rgba(248,81,73,0.4)', background: 'rgba(248,81,73,0.1)', color: '#f85149', fontSize: '12px', fontWeight: '700', cursor: 'pointer', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.3px', flexShrink: 0 }}>✕ CLOSE</button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <CodeEditor code={code} onChange={setCode} onEditorMount={e => (editorRef.current = e)} />
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(63,185,80,0.15)', background: 'rgba(13,17,23,0.8)', flexShrink: 0, display: 'flex', gap: '10px' }}>
              <button onClick={() => { setEditorFullscreen(false); handleAnalyze(); }} disabled={isAnalyzing} className="analyze-btn">
                {isAnalyzing ? '⟳  Analyzing…' : 'ANALYZE CODE'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes xpFloat {
          0%   { opacity: 1; transform: translateY(0);    }
          70%  { opacity: 1; transform: translateY(-18px);}
          100% { opacity: 0; transform: translateY(-28px);}
        }
        @keyframes shimmer {
          0%, 100% { opacity: 0.3; }
          50%       { opacity: 0.8; }
        }
      `}</style>
    </div>
  );
};