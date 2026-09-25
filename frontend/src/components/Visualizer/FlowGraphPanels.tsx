import React, { useEffect, useRef, useState } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { FLOWCHART_CODE_TOPICS, generateCppFromGraph } from '@/services/CodeGenerator'
import { validateGraph } from '@/services/GraphValidator'
import type { ValidationResult } from '@/services/GraphValidator'
import { ValidationPanel } from './ValidationPanel'
import {
  BUILD_PALETTE_ITEMS,
  CODE_PLACEHOLDER,
  DEFAULT_LABELS,
  EDITOR_ACCENT,
  EDITOR_TITLE,
  NODE_COLORS,
  NODE_TEMPLATES,
  PALETTE_ITEMS,
  SHAPE_CHEAT_SHEET,
} from './FlowGraphNodeConfig'
import type {
  EditState,
  EdgeEditState,
  ExtendedNodeData,
  FlowNodeType,
} from './flowGraphTypes'

// ─────────────────────────────────────────────────────────────────────────────
// §5  OVERLAY UI COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

// ── NodePalette ───────────────────────────────────────────────────────────────
export const NodePalette: React.FC<{
  onAddNode:        (type: FlowNodeType) => void;
  onClearCanvas:    () => void;
  hasGeneratePanel?: boolean;
}> = ({ onAddNode, onClearCanvas, hasGeneratePanel = false }) => {
  const [expanded, setExpanded] = useState(true);
  const listMaxHeight = hasGeneratePanel ? 'calc(100vh - 470px)' : 'calc(100vh - 100px)';

  return (
    <div style={{ background: 'linear-gradient(135deg,rgba(13,17,23,0.98),rgba(22,27,34,0.98))', border: '2px solid #30363d', borderRadius: 12, padding: expanded ? 16 : '12px 16px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)', transition: 'all 0.3s ease', flexShrink: 0 }}>

      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded(v => !v)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); } }}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none', marginBottom: expanded ? 12 : 0 }}
        title={expanded ? 'Collapse node palette' : 'Expand node palette'}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: '#58a6ff', letterSpacing: '0.5px' }}>➕ ADD NODE</div>
        <div style={{ fontSize: 13, color: '#58a6ff', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s', marginLeft: 8 }}>▼</div>
      </div>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: listMaxHeight, overflowY: 'auto' }}>
          {BUILD_PALETTE_ITEMS.map(({ type, label, iso, shape }) => {
            const color = NODE_COLORS[type];
            return (
              <button
                key={type}
                onClick={() => onAddNode(type)}
                title={`Add a ${label} node (${iso})`}
                style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 58, background: 'rgba(255,255,255,0.02)', border: `1px solid ${color}33`, borderRadius: 8, padding: '9px 12px', cursor: 'pointer', transition: 'all 0.2s', textAlign: 'left' }}
                onMouseEnter={e => { const b = e.currentTarget; b.style.background = `${color}14`; b.style.borderColor = `${color}88`; b.style.transform = 'translateX(-2px)'; }}
                onMouseLeave={e => { const b = e.currentTarget; b.style.background = 'rgba(255,255,255,0.02)'; b.style.borderColor = `${color}33`; b.style.transform = 'none'; }}
              >
                <div style={{ width: 58, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{shape}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: '#c9d1d9', fontWeight: 700, lineHeight: 1.25, overflowWrap: 'anywhere' }}>{label}</div>
                  <div style={{ fontSize: 11, color: '#6e7681', marginTop: 2, lineHeight: 1.25, overflowWrap: 'anywhere' }}>{iso}</div>
                </div>
              </button>
            );
          })}

          <div style={{ height: 1, background: '#21262d', margin: '4px 0' }} />

          <button
            onClick={onClearCanvas}
            title="Remove all nodes and edges from the canvas"
            style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,68,68,0.04)', border: '1px solid rgba(255,68,68,0.25)', borderRadius: 8, padding: '10px 12px', cursor: 'pointer', transition: 'all 0.2s' }}
            onMouseEnter={e => { const b = e.currentTarget; b.style.background = 'rgba(255,68,68,0.12)'; b.style.borderColor = '#ff4444'; }}
            onMouseLeave={e => { const b = e.currentTarget; b.style.background = 'rgba(255,68,68,0.04)'; b.style.borderColor = 'rgba(255,68,68,0.25)'; }}
          >
            <span style={{ fontSize: 14 }}>🗑️</span>
            <span style={{ fontSize: 13, color: '#ff6b6b', fontWeight: 700 }}>Clear Canvas</span>
          </button>

          <div style={{ padding: '8px 4px', fontSize: 11, color: '#6e7681', lineHeight: 1.65, borderTop: '1px solid #21262d', marginTop: 2 }}>
            <strong style={{ color: '#3d444d' }}>Tips:</strong> Double-click a node to edit it · Double-click an edge to label it · Press <kbd style={{ background: '#1c2128', border: '1px solid #30363d', borderRadius: 3, padding: '0 3px', fontSize: 8 }}>Backspace</kbd> to delete the selected item · <strong style={{ color: '#e040fb' }}>Alt+click</strong> an edge to insert a Junction at that point
          </div>
        </div>
      )}
    </div>
  );
};

// ── FlowchartLegend ───────────────────────────────────────────────────────────
export const FlowchartLegend: React.FC<{
  isBuildMode: boolean;
  graphNodes:  Node<ExtendedNodeData>[];
  isDrawerOpen?: boolean;
}> = ({ isBuildMode, graphNodes, isDrawerOpen = false }) => {
  const [expanded, setExpanded] = useState(false);
  const visibleNodeTypes = new Set(graphNodes.map(node => String(node.type ?? '')));
  const analysisItems = PALETTE_ITEMS.filter(item => visibleNodeTypes.has(item.type));
  const legendItems = isBuildMode
    ? BUILD_PALETTE_ITEMS
    : analysisItems.length > 0
    ? analysisItems
    : PALETTE_ITEMS.filter(item => item.type === 'terminator');
  const legendTitle = isBuildMode ? 'BUILD LEGEND' : 'LEGEND';
  const legendNote = isBuildMode
    ? 'Build Mode shows the shapes currently supported by Generate C++. Use the full ISO shapes only when they are enabled in the tools panel.'
    : 'Analysis Mode shows only the shape types currently present in this CFG.';
  const legendPosition: React.CSSProperties = isBuildMode
    ? { bottom: 12, left: 12 }
    : { top: 12, right: 12 };
  const legendMaxHeight = isBuildMode ? 'calc(100vh - 200px)' : '260px';
  return (
    <div style={{
      position: 'absolute', zIndex: 1000,
      ...legendPosition,
      background: 'linear-gradient(135deg,rgba(13,17,23,0.98),rgba(22,27,34,0.98))',
      border: '2px solid #30363d', borderRadius: 12,
      padding: expanded ? 14 : '10px 14px',
      width: expanded ? (isBuildMode ? 270 : 245) : 'auto',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)',
      transition: 'all 0.3s ease',
      opacity: isDrawerOpen ? 0.25 : 1,
      filter:  isDrawerOpen ? 'blur(2px)' : 'none',
      pointerEvents: isDrawerOpen ? 'none' : 'auto',
    }}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded(v => !v)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); } }}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
        title={expanded ? 'Hide legend' : 'Show ISO 5807 shape legend'}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: '#58a6ff', letterSpacing: '0.5px' }}>📊 {legendTitle}</div>
        <div style={{ fontSize: 12, color: '#58a6ff', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s', marginLeft: 8 }}>▼</div>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, borderTop: '1px solid #21262d', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 7, maxHeight: legendMaxHeight, overflowY: 'auto', overflowX: 'hidden' }}>
          <div style={{ fontSize: 10, color: '#6e7681', lineHeight: 1.5, paddingBottom: 4 }}>
            {legendNote}
          </div>
          {legendItems.map(({ type, label, iso, shape }) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{shape}</div>
              <div>
                <div style={{ fontSize: 10, color: 'white', fontWeight: 600 }}>{label}</div>
                <div style={{ fontSize: 9,  color: '#484f58' }}>{iso}</div>
              </div>
            </div>
          ))}
          {isBuildMode && (
            <div style={{ marginTop: 4, padding: '5px 4px', fontSize: 9, color: '#484f58', lineHeight: 1.7, borderTop: '1px solid #21262d' }}>
              💡 One decision edge creates a single-arm <strong>if</strong>; label two-way decisions <strong style={{ color: '#4caf50' }}>true</strong> / <strong style={{ color: '#ff6b6b' }}>false</strong>. Validation errors include a <strong style={{ color: '#ff6b6b' }}>Fix</strong> helper.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── GameStats ─────────────────────────────────────────────────────────────────
export const GameStats: React.FC<{
  visitedNodes:  Set<string>;
  totalNodes:    number;
  safeNodes:     number;
  isDrawerOpen?: boolean;
}> = ({ visitedNodes, totalNodes, safeNodes, isDrawerOpen = false }) => {
  const [expanded, setExpanded] = useState(true);
  const allSafe   = safeNodes === totalNodes;
  const safeColor = allSafe ? '#4caf50' : '#ff4444';

  const cardBase: React.CSSProperties = {
    background: 'linear-gradient(135deg,rgba(13,17,23,0.95),rgba(22,27,34,0.95))',
    borderRadius: 12, padding: expanded ? '12px 14px' : '9px 12px',
    minWidth: 185, transition: 'all 0.3s ease',
  };

  return (
    <div style={{
      position: 'absolute', top: 12, left: 12, zIndex: 1000,
      display: 'flex', flexDirection: 'column', gap: 8,
      opacity: isDrawerOpen ? 0.25 : 1,
      filter:  isDrawerOpen ? 'blur(2px)' : 'none',
      transition: 'all 0.3s ease',
      pointerEvents: isDrawerOpen ? 'none' : 'auto',
    }}>

      <div style={{ ...cardBase, border: '2px solid #4caf50', boxShadow: '0 4px 20px rgba(76,175,80,0.25)' }}>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          onClick={() => setExpanded(v => !v)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); } }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
          title="Nodes visited so far"
        >
          <div style={{ fontSize: 10, color: '#4caf50', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>📍 Exploration</div>
          <div style={{ fontSize: 12, color: '#4caf50', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s' }}>▼</div>
        </div>
        <div style={{ fontSize: 15, color: 'white', fontWeight: 600, marginTop: 5 }}>
          {visitedNodes.size} / {totalNodes}
          <span style={{ fontSize: 10, color: '#484f58', marginLeft: 6 }}>nodes visited</span>
        </div>
        {expanded && (
          <>
            <div style={{ width: '100%', height: 5, background: 'rgba(76,175,80,0.15)', borderRadius: 3, overflow: 'hidden', border: '1px solid rgba(76,175,80,0.3)', marginTop: 7 }}>
              <div style={{ width: `${totalNodes ? (visitedNodes.size / totalNodes) * 100 : 0}%`, height: '100%', background: 'linear-gradient(90deg,#4caf50,#66bb6a)', transition: 'width 0.4s ease' }} />
            </div>
            {visitedNodes.size === totalNodes && totalNodes > 0 && (
              <div style={{ fontSize: 10, color: '#4caf50', marginTop: 5, fontWeight: 600 }}>✓ All nodes visited!</div>
            )}
          </>
        )}
      </div>

      <div style={{ ...cardBase, border: `2px solid ${safeColor}`, boxShadow: `0 4px 20px ${allSafe ? 'rgba(76,175,80,0.25)' : 'rgba(255,68,68,0.25)'}` }}>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          onClick={() => setExpanded(v => !v)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); } }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
          title="Safety check results"
        >
          <div style={{ fontSize: 10, color: safeColor, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>🛡️ Safety</div>
          <div style={{ fontSize: 12, color: safeColor, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s' }}>▼</div>
        </div>
        <div style={{ fontSize: 15, color: 'white', fontWeight: 600, marginTop: 5 }}>
          {safeNodes} / {totalNodes}
          <span style={{ fontSize: 10, color: '#484f58', marginLeft: 6 }}>safe nodes</span>
        </div>
        {expanded && (
          <div style={{ fontSize: 10, color: safeColor, fontWeight: 600, marginTop: 5 }}>
            {allSafe
              ? '✓ All nodes are safe'
              : `⚠ ${totalNodes - safeNodes} node${totalNodes - safeNodes > 1 ? 's have' : ' has'} a safety issue`}
          </div>
        )}
      </div>
    </div>
  );
};

export const FlowchartQuickGuide: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <aside style={{
    position: 'absolute', top: 52, left: 12, zIndex: 1000,
    width: 'min(420px, calc(100% - 32px))',
    maxHeight: 'calc(100dvh - 180px)',
    background: 'linear-gradient(135deg,rgba(13,17,23,0.98),rgba(22,27,34,0.98))',
    border: '1px solid rgba(88,166,255,0.28)',
    borderRadius: 10,
    boxShadow: '0 16px 44px rgba(0,0,0,0.45)',
    overflow: 'hidden auto',
    color: '#c9d1d9',
    fontSize: 11,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid #21262d', background: 'rgba(88,166,255,0.06)' }}>
      <strong style={{ color: '#58a6ff', fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', fontFamily: "'IBM Plex Mono', monospace", flex: 1 }}>Quick Flowchart Manual</strong>
      <button onClick={onClose} title="Hide quick guide" style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>x</button>
    </div>
    <div style={{ padding: 12, display: 'grid', gap: 10, lineHeight: 1.55 }}>
      <div>
        <div style={{ color: '#e6edf3', fontWeight: 700, marginBottom: 4 }}>Best workflow</div>
        <ol style={{ paddingLeft: 18, margin: 0 }}>
          <li>Add Start, actions, decisions, then End. New shapes auto-wire from the current loose endpoint.</li>
          <li>Double-click each shape and type one simple sentence, command, or pseudocode step.</li>
          <li>Connect handles from top to bottom; decision edges auto-label true/false.</li>
          <li>Click Generate C++ and fix the validation messages. This does not compile or run the code.</li>
        </ol>
      </div>
      <div>
        <div style={{ color: '#e6edf3', fontWeight: 700, marginBottom: 4 }}>Human inputs that work</div>
        <code style={{ display: 'block', background: '#010409', border: '1px solid #21262d', borderRadius: 6, padding: 8, color: '#9ecbff', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
{`create integer age equals 18
ask for user age
if user age is greater than 17
print too young
score starts at zero
add one to score`}
        </code>
      </div>
      <div>
        <div style={{ color: '#e6edf3', fontWeight: 700, marginBottom: 4 }}>Supported generation topics</div>
        <div style={{ display: 'grid', gap: 3, color: '#8b949e' }}>
          {FLOWCHART_CODE_TOPICS.slice(0, 6).map(topic => (
            <span key={topic}>- {topic}</span>
          ))}
        </div>
      </div>
      <div>
        <div style={{ color: '#e6edf3', fontWeight: 700, marginBottom: 4 }}>Shape cheat sheet</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '4px 10px', color: '#8b949e' }}>
          <span><b style={{ color: '#42a5f5' }}>Start/End</b> entry and exit</span>
          <span><b style={{ color: '#4caf50' }}>Process</b> variables and math</span>
          <span><b style={{ color: '#ffa726' }}>Decision</b> if/while checks</span>
          <span><b style={{ color: '#64b5f6' }}>Output</b> print text/value</span>
          <span><b style={{ color: '#ff7043' }}>Input</b> ask/read value</span>
          <span><b style={{ color: '#ab47bc' }}>Function</b> helper calls</span>
          <span><b style={{ color: '#66bb6a' }}>Stored Data</b> arrays/storage</span>
          <span><b style={{ color: '#e040fb' }}>Junction</b> merge paths</span>
        </div>
      </div>
      <div>
        <div style={{ color: '#e6edf3', fontWeight: 700, marginBottom: 4 }}>Examples</div>
        <div style={{ display: 'grid', gap: 6 }}>
          <details style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid #21262d', borderRadius: 6, padding: '7px 8px' }}>
            <summary style={{ cursor: 'pointer', color: '#9ecbff', fontWeight: 700 }}>Straight-line input to output</summary>
            <code style={{ display: 'block', marginTop: 7, background: '#010409', border: '1px solid #21262d', borderRadius: 6, padding: 8, color: '#c9d1d9', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
{`Start
-> Manual Input: ask the user for age
-> Process: int nextAge = age + 1;
-> Output: display nextAge
-> End

C++ result:
int age;
cin >> age;
int nextAge = age + 1;
cout << nextAge << endl;`}
            </code>
          </details>
          <details style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid #21262d', borderRadius: 6, padding: '7px 8px' }}>
            <summary style={{ cursor: 'pointer', color: '#9ecbff', fontWeight: 700 }}>Decision with merge</summary>
            <code style={{ display: 'block', marginTop: 7, background: '#010409', border: '1px solid #21262d', borderRadius: 6, padding: 8, color: '#c9d1d9', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
{`Start
-> Manual Input: ask the user for score
-> Decision: score >= 75
   true  -> Output: display passed
   false -> Output: display try again
-> Junction: merge
-> End

C++ result:
int score;
cin >> score;
if (score >= 75) {
    cout << "passed" << endl;
} else {
    cout << "try again" << endl;
}`}
            </code>
          </details>
          <details style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid #21262d', borderRadius: 6, padding: '7px 8px' }}>
            <summary style={{ cursor: 'pointer', color: '#9ecbff', fontWeight: 700 }}>Loop with connector</summary>
            <code style={{ display: 'block', marginTop: 7, background: '#010409', border: '1px solid #21262d', borderRadius: 6, padding: 8, color: '#c9d1d9', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
{`Start
-> Process: int i = 0;
-> Decision: i < 5
   true  -> Process: i++;
         -> Decision: i % 2 == 0
            true  -> Connector: continue
            false -> Output: display i
         -> back to Decision i < 5
   false -> End

C++ result:
int i = 0;
while (i < 5) {
    i++;
    if (i % 2 == 0) {
        continue;
    }
    cout << i << endl;
}`}
            </code>
          </details>
          <details style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid #21262d', borderRadius: 6, padding: '7px 8px' }}>
            <summary style={{ cursor: 'pointer', color: '#9ecbff', fontWeight: 700 }}>Storage, helper, file, delay, reference</summary>
            <code style={{ display: 'block', marginTop: 7, background: '#010409', border: '1px solid #21262d', borderRadius: 6, padding: 8, color: '#c9d1d9', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
{`Start
-> Stored Data: int scores[3];
-> Process: int total = 0;
-> Manual Input: ask for first score
-> Process: scores[0] = firstScore;
-> Predefined Process: call show summary with total
-> Document: ofstream reportFile("report.txt");
-> Document: reportFile << "Total: " << total << endl;
-> Delay: wait 1 second
-> Off-page Connector: Report page 2
-> Output: display total
-> End

C++ result:
int scores[3];
int total = 0;
cin >> firstScore;
scores[0] = firstScore;
showSummary(total);
ofstream reportFile("report.txt");
reportFile << "Total: " << total << endl;
// wait 1 second(s)
// Off-page connector: Report page 2
cout << total << endl;`}
            </code>
          </details>
        </div>
      </div>
    </div>
  </aside>
);

// ── GenerateCodePanel ─────────────────────────────────────────────────────────
function generationFailureResult(error: unknown): ValidationResult {
  const message = error instanceof Error ? error.message : String(error);
  const issue = {
    severity: 'error' as const,
    code: 'CODE_GENERATION_FAILED',
    message: `Code generation failed: ${message}`,
  };
  return {
    isValid: false,
    errors: [issue],
    warnings: [],
    all: [issue],
  };
}

function isGenerationFailureResult(result: ValidationResult | null): boolean {
  return result?.errors.some(issue => issue.code === 'CODE_GENERATION_FAILED') ?? false;
}

export const GenerateCodePanel: React.FC<{
  nodes:             Node[];
  edges:             Edge[];
  onCodeGenerated?:  (code: string) => void;
  isDirty?:          boolean;
  onMarkClean?:      () => void;
}> = ({ nodes, edges, onCodeGenerated, isDirty = false, onMarkClean }) => {
  const [expanded,         setExpanded]         = useState(true);
  const [generatedCode,    setGeneratedCode]    = useState<string | null>(null);
  const [copied,           setCopied]           = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [showValidation,   setShowValidation]   = useState(false);

  const handleGenerate = () => {
    const result = validateGraph(nodes, edges);
    setValidationResult(result);
    setShowValidation(true);
    if (!result.isValid) return;

    try {
      const code = generateCppFromGraph(nodes, edges);
      setGeneratedCode(code);
      onCodeGenerated?.(code);
      onMarkClean?.();
    } catch (err) {
      console.error('Code generation failed:', err);
      setValidationResult(generationFailureResult(err));
      setShowValidation(true);
    }
  };

  const liveValidation = showValidation && !isGenerationFailureResult(validationResult)
    ? validateGraph(nodes, edges)
    : null;

  const handleCopy = () => {
    if (!generatedCode) return;
    navigator.clipboard.writeText(generatedCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = generatedCode;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const handleExport = () => {
    if (!generatedCode) return;
    try {
      const blob = new Blob([generatedCode], { type: 'text/plain' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = 'generated.cpp'; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  const activeValidation = liveValidation ?? validationResult;
  const hasErrors   = (activeValidation?.errors.length  ?? 0) > 0;
  const hasWarnings = (activeValidation?.warnings.length ?? 0) > 0;
  const hasIssues   = (activeValidation?.all.length      ?? 0) > 0;
  const canGenerate = nodes.length > 0 && !hasErrors;

  const borderColor = hasErrors
    ? '#ff4444'
    : isDirty && generatedCode
    ? '#ffa726'
    : hasWarnings
    ? '#ffa726'
    : '#a855f7';

  const generateLabel = nodes.length === 0
    ? 'Add nodes to the canvas first'
    : hasErrors
    ? `🚫 Fix ${activeValidation!.errors.length} error${activeValidation!.errors.length > 1 ? 's' : ''} before generating`
    : `⚡ Generate from ${nodes.length} node${nodes.length !== 1 ? 's' : ''}`;

  return (
    <div style={{
      background:     'linear-gradient(135deg,rgba(13,17,23,0.98),rgba(22,27,34,0.98))',
      border:         `2px solid ${borderColor}`,
      borderRadius:   12,
      padding:        expanded ? 18 : '12px 16px',
      boxShadow:      `0 8px 32px ${hasErrors ? 'rgba(255,68,68,0.25)' : isDirty && generatedCode ? 'rgba(255,167,38,0.3)' : 'rgba(168,85,247,0.3)'}`,
      backdropFilter: 'blur(10px)',
      transition:     'all 0.3s ease',
      flexShrink:     0,
    }}>

      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded(v => !v)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); } }}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer', userSelect: 'none', marginBottom: expanded ? 14 : 0 }}
        title={expanded ? 'Collapse code generator' : 'Expand code generator'}
      >
        <div style={{ fontSize: 14, fontWeight: 800, color: borderColor, letterSpacing: '0.5px', lineHeight: 1.25 }}>
          ⚡ GENERATE C++{' '}
          {hasErrors                ? '— fix errors first' :
           isDirty && generatedCode ? '— graph changed, regenerate to update' : ''}
        </div>
        <div style={{ fontSize: 13, color: '#a855f7', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s', flexShrink: 0 }}>▼</div>
      </div>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {showValidation && activeValidation && hasIssues && (
            <ValidationPanel
              result={activeValidation}
              onDismiss={() => setShowValidation(false)}
            />
          )}

          {(!showValidation || !hasIssues) && !isDirty && (
            <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.55, padding: '10px 12px', background: 'rgba(168,85,247,0.06)', borderRadius: 8, border: '1px solid rgba(168,85,247,0.2)' }}>
              Type simple sentence steps. No AI, no compilation. For two-way decisions, label edges{' '}
              <strong style={{ color: '#4caf50' }}>true</strong> /{' '}
              <strong style={{ color: '#ff6b6b' }}>false</strong>{' '}
              → click Generate
            </div>
          )}

          <details style={{ fontSize: 12, color: '#8b949e', background: 'rgba(255,255,255,0.025)', border: '1px solid #21262d', borderRadius: 8, padding: '9px 11px' }}>
            <summary style={{ cursor: 'pointer', color: '#c9d1d9', fontWeight: 700 }}>Supported topics</summary>
            <div style={{ display: 'grid', gap: 5, marginTop: 8, lineHeight: 1.5 }}>
              {FLOWCHART_CODE_TOPICS.map(topic => (
                <span key={topic}>- {topic}</span>
              ))}
            </div>
          </details>

          {!hasErrors && isDirty && generatedCode && (
            <div style={{ fontSize: 12, color: '#ffa726', padding: '9px 11px', background: 'rgba(255,167,38,0.08)', border: '1px solid rgba(255,167,38,0.3)', borderRadius: 8, lineHeight: 1.45 }}>
              ⚠️ The graph has changed since the last generation — click Generate to update the output.
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={nodes.length === 0}
            title={hasErrors ? 'Fix the errors shown above before generating code' : 'Generate C++ code from the current flowchart'}
            style={{
              width: '100%', padding: '13px 14px', borderRadius: 8, border: 'none',
              background:
                nodes.length === 0       ? 'rgba(168,85,247,0.15)' :
                hasErrors                ? 'rgba(255,68,68,0.2)'   :
                isDirty && generatedCode ? 'linear-gradient(135deg,#ffa726cc,#ff8f00cc)' :
                                           'linear-gradient(135deg,#a855f7cc,#7c3aedcc)',
              color:
                nodes.length === 0 ? '#6b21a8' :
                hasErrors          ? '#ff8888' :
                                     'white',
              fontWeight: 800, fontSize: 14,
              cursor: nodes.length === 0 ? 'not-allowed' : 'pointer',
              letterSpacing: '0.5px', lineHeight: 1.25, transition: 'all 0.2s',
              opacity: hasErrors ? 0.7 : 1,
            }}
            onMouseEnter={e => { if (canGenerate) e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none'; }}
          >
            {generateLabel}
          </button>

          {generatedCode && !hasErrors && (
            <>
              <div style={{ background: '#0d1117', border: `1px solid ${isDirty ? 'rgba(255,167,38,0.3)' : 'rgba(168,85,247,0.3)'}`, borderRadius: 8, padding: 12, maxHeight: 180, overflowY: 'auto' }}>
                <pre style={{ margin: 0, fontSize: 12, color: isDirty ? '#8b949e' : '#c9d1d9', fontFamily: "'JetBrains Mono','Fira Code',monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.65, opacity: isDirty ? 0.6 : 1 }}>
                  {generatedCode}
                </pre>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleCopy}
                  title="Copy generated code to clipboard"
                  style={{ flex: 1, padding: '10px 8px', borderRadius: 7, border: '1px solid rgba(168,85,247,0.5)', background: copied ? 'rgba(76,175,80,0.2)' : 'rgba(168,85,247,0.1)', color: copied ? '#4caf50' : '#a855f7', fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}
                >
                  {copied ? '✓ Copied!' : '📋 Copy'}
                </button>
                <button
                  onClick={handleExport}
                  title="Download as generated.cpp"
                  style={{ flex: 1, padding: '10px 8px', borderRadius: 7, border: '1px solid rgba(168,85,247,0.5)', background: 'rgba(168,85,247,0.1)', color: '#a855f7', fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}
                >
                  💾 Export .cpp
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// §6  MODAL EDITORS
// ─────────────────────────────────────────────────────────────────────────────

// ── NodeEditor ────────────────────────────────────────────────────────────────
export const NodeEditor: React.FC<{
  editState: EditState;
  onSave:    (label: string, code: string) => void;
  onCancel:  () => void;
}> = ({ editState, onSave, onCancel }) => {
  const [label, setLabel] = useState(editState.label);
  const [code,  setCode]  = useState(editState.code);
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => { labelRef.current?.focus(); labelRef.current?.select(); }, []);

  const accent    = EDITOR_ACCENT[editState.type] ?? '#58a6ff';
  const title     = EDITOR_TITLE[editState.type]  ?? 'Node';
  const noCode    =
    editState.type === 'terminator' ||
    editState.type === 'connector' ||
    editState.type === 'off_page_connector' ||
    editState.type === 'junction';
  const fieldLabel =
    editState.type === 'decision'           ? 'Condition / Label'   :
    editState.type === 'connector'          ? 'Reference Letter'    :
    editState.type === 'off_page_connector' ? 'Page / Reference ID' :
    editState.type === 'junction'           ? 'Junction Label'      :
    'Label';
  const placeholder =
    editState.type === 'connector'          ? 'e.g. A, B, 1'                  :
    editState.type === 'off_page_connector' ? 'e.g. P2, page-2, 1' :
    `e.g. ${DEFAULT_LABELS[editState.type as FlowNodeType] ?? 'Label'}`;
  const templates = NODE_TEMPLATES[editState.type] ?? [];
  const cheatSheet = SHAPE_CHEAT_SHEET[editState.type];

  const inputBase: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    background: '#0d1117', border: '1px solid #2d333b', borderRadius: 8,
    padding: '10px 13px', color: '#e6edf3', outline: 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  };
  const onFocusInput = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = accent;
    e.target.style.boxShadow   = `0 0 0 3px ${accent}22`;
  };
  const onBlurInput = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = '#2d333b';
    e.target.style.boxShadow   = 'none';
  };

  const handleSave = () => {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      labelRef.current?.focus();
      return;
    }
    onSave(trimmedLabel, code.trim());
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${title}`}
    >
      <div
        onKeyDown={e => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter' && e.ctrlKey) handleSave();
        }}
        style={{ background: '#13181f', border: `1px solid ${accent}44`, borderTop: `3px solid ${accent}`, borderRadius: 14, width: 'min(560px, calc(100vw - 32px))', maxHeight: 'calc(100dvh - 32px)', boxShadow: `0 24px 64px rgba(0,0,0,0.85), 0 0 0 1px ${accent}18`, animation: 'editorSlideIn 0.18s ease-out', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 20px', background: `${accent}0c`, borderBottom: `1px solid ${accent}1e` }}>
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: accent, boxShadow: `0 0 8px ${accent}bb`, flexShrink: 0 }} />
          <div style={{ fontSize: 11, fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '1.2px', fontFamily: "'IBM Plex Mono', monospace", flex: 1 }}>{title}</div>
          <div style={{ fontSize: 10, color: '#3d444d', fontFamily: "'IBM Plex Mono', monospace" }}>Ctrl+Enter to save · Esc to cancel</div>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
          {cheatSheet && (
            <div style={{
              border: `1px solid ${accent}33`,
              background: `${accent}0f`,
              borderRadius: 8,
              padding: '10px 12px',
              display: 'grid',
              gap: 7,
              fontSize: 11,
              lineHeight: 1.55,
              color: '#8b949e',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <strong style={{ color: accent, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 0.6, textTransform: 'uppercase', fontSize: 10 }}>
                  Shape Cheat Sheet
                </strong>
                <span style={{ color: '#3d444d', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10 }}>
                  Use this shape like CFG
                </span>
              </div>
              <div><b style={{ color: '#c9d1d9' }}>Use:</b> {cheatSheet.use}</div>
              <div><b style={{ color: '#c9d1d9' }}>Input:</b> {cheatSheet.type}</div>
              <div style={{ display: 'grid', gap: 4 }}>
                <b style={{ color: '#c9d1d9' }}>Examples:</b>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {cheatSheet.examples.map(example => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => {
                        if (noCode) setLabel(example);
                        else setCode(example);
                      }}
                      style={{
                        border: '1px solid #30363d',
                        background: '#0d1117',
                        color: '#9ecbff',
                        borderRadius: 6,
                        padding: '4px 7px',
                        fontSize: 10,
                        cursor: 'pointer',
                        fontFamily: "'IBM Plex Mono', monospace",
                      }}
                      title={noCode ? 'Use as label' : 'Use as instruction'}
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
              {cheatSheet.avoid && (
                <div style={{ color: '#ffa726' }}><b>Avoid:</b> {cheatSheet.avoid}</div>
              )}
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 7, fontFamily: "'IBM Plex Mono', monospace" }}>
              {fieldLabel}
            </label>
            <input
              ref={labelRef}
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder={placeholder}
              style={{ ...inputBase, fontSize: 14, fontFamily: "'IBM Plex Mono', monospace" }}
              onFocus={onFocusInput}
              onBlur={onBlurInput}
            />
          </div>

          {!noCode && (
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.8px', fontFamily: "'IBM Plex Mono', monospace" }}>
                  Simple instruction
                </label>
                <span style={{ fontSize: 10, color: '#3d444d', fontFamily: "'IBM Plex Mono', monospace" }}>
                  — sentence, command, or pseudocode; one step only
                </span>
              </div>
              <textarea
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder={CODE_PLACEHOLDER[editState.type] ?? ''}
                rows={3}
                style={{ ...inputBase, fontSize: 12, fontFamily: "'JetBrains Mono','Fira Code',monospace", resize: 'vertical', lineHeight: 1.7, minHeight: 78, maxHeight: 160 }}
                onFocus={onFocusInput}
                onBlur={onBlurInput}
              />
            </div>
          )}

          {!noCode && templates.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {templates.map(template => (
                <button
                  key={`${template.label}:${template.code}`}
                  type="button"
                  onClick={() => {
                    setLabel(template.label);
                    setCode(template.code);
                  }}
                  style={{
                    border: `1px solid ${accent}55`,
                    background: `${accent}14`,
                    color: accent,
                    borderRadius: 7,
                    padding: '6px 9px',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                  title={`Use ${template.code}`}
                >
                  {template.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, padding: '14px 20px', background: '#0d1117', borderTop: '1px solid #1e242c' }}>
          <button
            onClick={handleSave}
            style={{ flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none', background: `linear-gradient(135deg,${accent},${accent}aa)`, color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', letterSpacing: '0.5px', fontFamily: "'IBM Plex Mono', monospace", boxShadow: `0 4px 14px ${accent}44`, transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = `0 6px 20px ${accent}66`; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = `0 4px 14px ${accent}44`; }}
          >
            ✓ Save
          </button>
          <button
            onClick={onCancel}
            style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #2d333b', background: 'transparent', color: '#6e7681', fontWeight: 600, fontSize: 12, cursor: 'pointer', transition: 'all 0.15s' }}
            onMouseEnter={e => { const b = e.currentTarget; b.style.borderColor = '#444c56'; b.style.color = '#8b949e'; }}
            onMouseLeave={e => { const b = e.currentTarget; b.style.borderColor = '#2d333b'; b.style.color = '#6e7681'; }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

// ── EdgeLabelEditor ───────────────────────────────────────────────────────────
export const EdgeLabelEditor: React.FC<{
  editState: EdgeEditState;
  onSave:    (label: string) => void;
  onCancel:  () => void;
}> = ({ editState, onSave, onCancel }) => {
  const [label, setLabel] = useState(editState.label);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  const QUICK_LABELS = ['true', 'false', 'yes', 'no'] as const;
  const isPositive = (l: string) => l === 'true' || l === 'yes';

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(3px)' }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Edit edge label"
    >
      <div
        onKeyDown={e => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter') onSave(label.trim() || label);
        }}
        style={{ background: 'linear-gradient(135deg,#0d1117,#161b22)', border: '2px solid #64b5f6', borderRadius: 14, padding: 20, width: 320, boxShadow: '0 20px 60px rgba(0,0,0,0.85), 0 0 30px rgba(100,181,246,0.2)', animation: 'editorSlideIn 0.18s ease-out' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#64b5f6', boxShadow: '0 0 8px #64b5f6' }} />
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64b5f6', textTransform: 'uppercase', letterSpacing: '1px' }}>Label This Edge</div>
          <div style={{ marginLeft: 'auto', fontSize: 10, color: '#484f58' }}>Enter to save · Esc to cancel</div>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {QUICK_LABELS.map(ql => (
            <button
              key={ql}
              onClick={() => onSave(ql)}
              title={`Label this edge as "${ql}"`}
              style={{ flex: 1, padding: 7, borderRadius: 6, border: `1px solid ${isPositive(ql) ? '#4caf5066' : '#ff444466'}`, background: isPositive(ql) ? 'rgba(76,175,80,0.1)' : 'rgba(255,68,68,0.1)', color: isPositive(ql) ? '#4caf50' : '#ff6b6b', fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; }}
            >
              {ql}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={inputRef}
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="Or type a custom label…"
            style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid #64b5f666', borderRadius: 8, padding: '9px 12px', color: 'white', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
            onFocus={e => { e.target.style.borderColor = '#64b5f6'; }}
            onBlur={e  => { e.target.style.borderColor = '#64b5f666'; }}
          />
          <button
            onClick={() => onSave(label.trim() || label)}
            title="Save label"
            style={{ padding: '9px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#64b5f6cc,#42a5f5cc)', color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
          >
            ✓
          </button>
          <button
            onClick={onCancel}
            title="Cancel"
            style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #30363d', background: 'transparent', color: '#8b949e', fontSize: 12, cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        <div style={{ fontSize: 9, color: '#484f58', marginTop: 10, lineHeight: 1.6 }}>
          💡 One outgoing decision edge generates a single-arm <code style={{ fontSize: 8, background: '#1c2128', padding: '1px 4px', borderRadius: 3 }}>if</code>. Label two-way branches <strong style={{ color: '#4caf50' }}>true</strong> / <strong style={{ color: '#ff6b6b' }}>false</strong> for <code style={{ fontSize: 8, background: '#1c2128', padding: '1px 4px', borderRadius: 3 }}>if</code> / <code style={{ fontSize: 8, background: '#1c2128', padding: '1px 4px', borderRadius: 3 }}>while</code>.
        </div>
      </div>
    </div>
  );
};

