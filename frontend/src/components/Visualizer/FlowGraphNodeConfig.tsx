/* eslint-disable react-refresh/only-export-components -- shared SVG-backed flowchart configuration */
import { MarkerType } from '@xyflow/react'
import type { CSSProperties } from 'react'
import type { Edge, Node } from '@xyflow/react'
import type { SafetyCheck } from '@/types'
import type { ExtendedNodeData, FlowNodeType } from './flowGraphTypes'

let _nodeIdCounter = 1000;
export const newNodeId = () => `user-node-${++_nodeIdCounter}`;

// FIX: stable empty array — never re-creates a new reference on each render,
// which would cause the useEffect([cfg, safetyChecks]) to fire every render
// and produce an infinite setEdges → re-render loop.
export const EMPTY_SAFETY_CHECKS: SafetyCheck[] = [];

export const NODE_COLORS: Record<FlowNodeType, string> = {
  terminator:         '#42a5f5',
  process:            '#4caf50',
  decision:           '#ffa726',
  io:                 '#64b5f6',
  predefined:         '#ab47bc',
  connector:          '#26c6da',
  off_page_connector: '#ffca28',
  document:           '#ef5350',
  manual_input:       '#ff7043',
  delay:              '#78909c',
  database:           '#66bb6a',
  junction:           '#e040fb',
};

export const DEFAULT_LABELS: Record<FlowNodeType, string> = {
  terminator:         'Start',
  process:            'Process',
  decision:           'Condition',
  io:                 'Output',
  predefined:         'Function Call',
  connector:          'A',
  off_page_connector: '1',
  document:           'Document',
  manual_input:       'Input',
  delay:              'Delay',
  database:           'Stored Data',
  junction:           '⬡',
};


export const EDITOR_ACCENT: Record<string, string> = {
  terminator:         '#42a5f5', process:      '#4caf50',
  decision:           '#ffa726', io:           '#64b5f6',
  predefined:         '#ab47bc', connector:    '#26c6da',
  off_page_connector: '#ffca28',
  document:           '#ef5350', manual_input: '#ff7043',
  delay:              '#78909c', database:     '#66bb6a',
  junction:           '#e040fb',
};

export const EDITOR_TITLE: Record<string, string> = {
  terminator:         'Start / End',
  process:            'Process',
  decision:           'Decision',
  io:                 'Output (cout)',
  predefined:         'Predefined Process (Function Call)',
  connector:          'Connector (On-page Reference)',
  off_page_connector: 'Off-page Connector (Cross-page Reference)',
  document:           'Document / Output File',
  manual_input:       'Manual Input (cin)',
  delay:              'Delay / Wait',
  database:           'Stored Data',
  junction:           'Junction / Merge Point',
};

export const CODE_PLACEHOLDER: Record<string, string> = {
  process:            'Type a simple sentence, e.g. score starts at zero',
  decision:           'Type a condition, e.g. if age is greater than 17',
  io:                 'Type what to show, e.g. display hello world',
  predefined:         'Type a helper call, e.g. call showWrongInput to display wrong input',
  connector:          '',
  off_page_connector: '',
  document:           'Type a file step, e.g. write report.txt',
  manual_input:       'Type what to read, e.g. ask the user for their name',
  delay:              'Type a wait step, e.g. wait 2 seconds',
  database:           'Type a data step, e.g. create a 2D array of scores',
  terminator:         '',
  junction:           '',
};

export const NODE_TEMPLATES: Record<string, { label: string; code: string }[]> = {
  process: [
    { label: 'Start score', code: 'score starts at zero' },
    { label: 'Update score', code: 'set score to score plus 10' },
    { label: 'Count one more', code: 'add one to counter' },
    { label: 'Store answer', code: 'store 75 in passing score' },
    { label: 'Calculate total', code: 'set total to price plus tax' },
  ],
  decision: [
    { label: 'Age is adult', code: 'if age is greater than 17' },
    { label: 'Keep looping', code: 'repeat while score is below 75' },
    { label: 'Passing score', code: 'if score is at least passing score' },
  ],
  io: [
    { label: 'Display value', code: 'display the value of score' },
    { label: 'Display message', code: 'display hello world' },
    { label: 'Show result', code: 'show the result' },
  ],
  manual_input: [
    { label: 'Ask name', code: 'ask the user for their name' },
    { label: 'Ask age', code: 'ask the user for their age' },
  ],
  predefined: [
    { label: 'Call calculate', code: 'call calculate result' },
    { label: 'Call validate', code: 'call validate input' },
    { label: 'Call warning', code: 'call showWrongInput to display wrong input' },
    { label: 'Call display', code: 'call display summary with total' },
  ],
  delay: [
    { label: 'Wait one second', code: 'wait one second' },
  ],
  database: [
    { label: 'Create array', code: 'create an array of scores' },
    { label: 'Create 2D array', code: 'create a 2D array of scores' },
    { label: 'Create 3D array', code: 'create a 3D array of cubes' },
    { label: 'Store score', code: 'store score in scores' },
    { label: 'Store in 2D', code: 'store score at row zero column one of scores' },
  ],
  document: [
    { label: 'Write report', code: 'report.txt' },
  ],
};

export const SHAPE_CHEAT_SHEET: Record<string, { use: string; type: string; examples: string[]; avoid?: string }> = {
  terminator: {
    use: 'Use only for Start and End.',
    type: 'No code needed.',
    examples: ['Start', 'End'],
  },
  process: {
    use: 'Use for variables, assignments, arithmetic, and ordinary steps.',
    type: 'Type one action, not input/output/file work.',
    examples: ['score starts at zero', 'set total to price plus tax', 'count++'],
    avoid: 'Do not put cin, cout, file streams, waits, or function calls here.',
  },
  decision: {
    use: 'Use for if and loop conditions.',
    type: 'Type only the condition. Label two outgoing edges true/false. One outgoing edge becomes a single-arm if.',
    examples: ['age > 17', 'score is below 75', 'repeat while count < 5'],
    avoid: 'Do not type a whole if statement with braces.',
  },
  io: {
    use: 'Use for output only.',
    type: 'Type what should be displayed with cout.',
    examples: ['display hello world', 'show the value of total', 'cout << total << endl;'],
    avoid: 'Do not use this for cin/read input.',
  },
  manual_input: {
    use: 'Use for user input only.',
    type: 'Type what variable should be read with cin.',
    examples: ['ask the user for age', 'enter name', 'cin >> score;'],
    avoid: 'Do not use this for cout/display output.',
  },
  predefined: {
    use: 'Use for function/subroutine/helper calls.',
    type: 'Type one function call, or use "call name to action" to generate a small helper body above main.',
    examples: ['call showWrongInput to display wrong input', 'call calculate result', 'showSummary(total);'],
    avoid: 'Do not use on-page or off-page connectors for function calls.',
  },
  connector: {
    use: 'Use as an on-page reference or routing marker.',
    type: 'Type a short reference letter/number only.',
    examples: ['A', 'B', '1'],
    avoid: 'Do not put C++ statements here except break/continue connector labels when modeling loop jumps.',
  },
  off_page_connector: {
    use: 'Use as a cross-page continuation/reference.',
    type: 'Type a page/reference ID only.',
    examples: ['P2', 'page-2', '1'],
    avoid: 'This is not a function-call shape.',
  },
  document: {
    use: 'Use for files, reports, and document output.',
    type: 'Type a filename, file stream, or file write step.',
    examples: ['write report.txt', 'ofstream reportFile("report.txt");', 'reportFile << total << endl;'],
    avoid: 'Do not use generic Process for file streams.',
  },
  delay: {
    use: 'Use for wait/pause/delay steps.',
    type: 'Type the wait duration or a wait sentence.',
    examples: ['wait 2 seconds', 'pause 1 second', '5'],
    avoid: 'This shape emits a structural wait comment for CP1/CP2, not threaded C++.',
  },
  database: {
    use: 'Use for arrays, stored data, and simple storage.',
    type: 'Type an array/stored-data declaration or storage step.',
    examples: ['create an array of scores', 'int scores[5];', 'store score in scores'],
    avoid: 'Do not use STL containers like vector/map.',
  },
  junction: {
    use: 'Use only to merge or route paths.',
    type: 'No code needed.',
    examples: ['Merge', 'After decision'],
    avoid: 'Do not put executable code here.',
  },
};

export const PALETTE_ITEMS: {
  type: FlowNodeType; label: string; iso: string; shape: React.ReactNode
}[] = [
  {
    type: 'terminator', label: 'Start / End', iso: 'ISO: Terminal',
    shape: <div style={{ width: 48, height: 20, background: 'linear-gradient(135deg,#0d47a1,#1565c0)', border: '2px solid #42a5f5', borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, color: 'white', fontWeight: 700, flexShrink: 0 }}>START</div>,
  },
  {
    type: 'process', label: 'Process', iso: 'ISO: Process',
    shape: <div style={{ width: 48, height: 20, background: 'linear-gradient(135deg,#141a14,#1e271e)', border: '2px solid #4caf50', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, color: 'white', fontWeight: 700, flexShrink: 0 }}>PROC</div>,
  },
  {
    type: 'decision', label: 'Decision', iso: 'ISO: Decision',
    shape: (
      <svg width={24} height={24} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
        <polygon points="12,2 22,12 12,22 2,12" fill="#1a1608" stroke="#ffa726" strokeWidth="1.5" />
        <text x="12" y="16" textAnchor="middle" fontSize="6" fill="white" fontWeight="700">IF</text>
      </svg>
    ),
  },
  {
    type: 'io', label: 'Output (cout)', iso: 'ISO: Data',
    shape: (
      <svg width={48} height={20} viewBox="0 0 48 20" style={{ flexShrink: 0 }}>
        <polygon points="6,2 46,2 42,18 2,18" fill="#081c33" stroke="#64b5f6" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    type: 'predefined', label: 'Function Call', iso: 'ISO: Predefined Process',
    shape: (
      <div style={{ position: 'relative', width: 48, height: 20, background: 'linear-gradient(135deg,#18091f,#271040)', border: '2px solid #ab47bc', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, color: 'white', fontWeight: 700, flexShrink: 0 }}>
        <div style={{ position: 'absolute', left: 8,  top: 0, bottom: 0, width: 1.5, background: '#ab47bc' }} />
        <div style={{ position: 'absolute', right: 8, top: 0, bottom: 0, width: 1.5, background: '#ab47bc' }} />
        FUNC
      </div>
    ),
  },
  {
    type: 'connector', label: 'Connector', iso: 'ISO: On-page Reference',
    shape: <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'linear-gradient(135deg,#042a2e,#073540)', border: '2px solid #26c6da', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: 'white', fontWeight: 800, flexShrink: 0 }}>A</div>,
  },
  {
    type: 'off_page_connector', label: 'Off-page Connector', iso: 'ISO: Off-page Reference',
    shape: (
      <svg width={26} height={24} viewBox="0 0 26 24" style={{ flexShrink: 0 }}>
        <polygon points="2,2 24,2 24,14 13,22 2,14" fill="#2a2008" stroke="#ffca28" strokeWidth="1.5" strokeLinejoin="round" />
        <text x="13" y="13" textAnchor="middle" fontSize="7" fill="white" fontWeight="800">1</text>
      </svg>
    ),
  },
  {
    type: 'document', label: 'Document', iso: 'ISO: Document',
    shape: (
      <svg width={48} height={22} viewBox="0 0 48 22" style={{ flexShrink: 0 }}>
        <path d="M 2,2 L 46,2 L 46,14 Q 40,22 34,14 Q 28,6 22,14 Q 16,22 10,14 Q 6,8 2,14 Z" fill="#180303" stroke="#ef5350" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    type: 'manual_input', label: 'Manual Input (cin)', iso: 'ISO: Manual Input',
    shape: (
      <svg width={48} height={20} viewBox="0 0 48 20" style={{ flexShrink: 0 }}>
        <polygon points="2,6 46,2 46,18 2,18" fill="#180b00" stroke="#ff7043" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    type: 'delay', label: 'Delay / Wait', iso: 'ISO: Delay',
    shape: (
      <svg width={48} height={20} viewBox="0 0 48 20" style={{ flexShrink: 0 }}>
        <path d="M 2,2 L 38,2 A 9,9 0 0 1 38,18 L 2,18 Z" fill="#0e1418" stroke="#78909c" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    type: 'database', label: 'Stored Data', iso: 'ISO: Stored Data',
    shape: (
      <svg width={36} height={22} viewBox="0 0 36 22" style={{ flexShrink: 0 }}>
        <rect x="2" y="5" width="32" height="14" fill="#050d05" stroke="#66bb6a" strokeWidth="1.5" />
        <ellipse cx="18" cy="19" rx="16" ry="4" fill="#050d05" stroke="#66bb6a" strokeWidth="1.5" />
        <ellipse cx="18" cy="5"  rx="16" ry="4" fill="#0d220d" stroke="#66bb6a" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    type: 'junction', label: 'Junction / Merge', iso: 'Routing: merge point',
    shape: (
      <svg width={28} height={28} viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
        <circle cx="14" cy="14" r="9" fill="#1a0820" stroke="#e040fb" strokeWidth="1.5" />
        <circle cx="14" cy="14" r="3.5" fill="#e040fb" opacity="0.9" />
      </svg>
    ),
  },
];

export const BUILD_PALETTE_ITEMS = PALETTE_ITEMS.filter(
  item => item.type !== 'document' && item.type !== 'delay',
);

export function isEndTerminator(node: Node<ExtendedNodeData>): boolean {
  return node.type === 'terminator' && String(node.data?.label ?? '').toLowerCase() !== 'start';
}

export function findLooseEndpoint(nodes: Node<ExtendedNodeData>[], edges: Edge[]): Node<ExtendedNodeData> | null {
  const sourceIds = new Set(edges.map(edge => edge.source));
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (sourceIds.has(node.id)) continue;
    if (isEndTerminator(node)) continue;
    if (node.type === 'decision') continue;
    return node;
  }
  return null;
}

export function flowEdge(source: string, target: string, label?: string): Edge {
  const isTrue = label === 'true';
  const isFalse = label === 'false';
  const edgeColor = isTrue ? '#4caf50' : isFalse ? '#ff4444' : '#64b5f6';
  return {
    id: `edge-${source}-${target}-${Date.now()}`,
    source,
    target,
    label,
    type: 'default',
    markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor },
    style: { stroke: edgeColor, strokeWidth: 2 },
    labelStyle: { fill: isTrue ? '#4caf50' : isFalse ? '#ff6b6b' : '#ffffff', fontSize: '11px', fontWeight: '700' },
    labelBgStyle: { fill: '#0d1117', fillOpacity: 0.9 },
    labelBgPadding: [5, 8] as [number, number],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §3  SHARED NODE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function useNodeAppearance(type: FlowNodeType, data: ExtendedNodeData) {
  const color = data.violation ? '#ff4444'
    : data.visited  ? '#4caf50'
    : NODE_COLORS[type];

  const bg = data.violation
    ? 'linear-gradient(135deg,#2d0a0a,#4a1515)'
    : data.visited
    ? 'linear-gradient(135deg,#1a2e1a,#2d4a2d)'
    : null;

  return { color, bg };
}

export const handleStyle = (color: string): CSSProperties => ({
  background: color,
  width:      '11px',
  height:     '11px',
  border:     '2px solid #0d1117',
  boxShadow:  `0 0 8px ${color}`,
});
