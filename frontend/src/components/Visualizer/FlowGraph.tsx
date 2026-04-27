/**
 * FlowGraph.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Interactive flowchart canvas built on React Flow + ELK auto-layout.
 *
 * TABLE OF CONTENTS
 * ─────────────────
 *  §1  Imports & types
 *  §2  Constants  (colors, sizes, default labels, palette items)
 *  §3  Shared node helpers  (useNodeAppearance, BaseNode, NodeLabel, badges)
 *  §4  ISO 5807 node components  (Terminator → Database)
 *  §5  Overlay UI components  (NodePalette, FlowchartLegend, GameStats,
 *                               GenerateCodePanel)
 *  §6  Modal editors  (NodeEditor, EdgeLabelEditor)
 *  §7  Main FlowGraph component  (state, handlers, ReactFlow render)
 */

// ─────────────────────────────────────────────────────────────────────────────
// §1  IMPORTS & TYPES
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ReactFlow, Background, Controls, MarkerType,
  Handle, Position, applyNodeChanges, applyEdgeChanges, addEdge,
  useReactFlow, ReactFlowProvider,
} from '@xyflow/react';
import type { Connection, Edge, Node, NodeProps, NodeChange, EdgeChange } from '@xyflow/react';
import ELK from 'elkjs/lib/elk.bundled.js';
import '@xyflow/react/dist/style.css';
import type { CFG, SafetyCheck, ControlFlowNode } from '../../types';
import { generateCppFromGraph } from '../../services/CodeGenerator';
import { validateGraph } from '../../services/GraphValidator';
import { ValidationPanel } from './ValidationPanel';

// ── Data attached to every node ──────────────────────────────────────────────
interface ExtendedNodeData extends ControlFlowNode {
  violation?: boolean;
  visited?:   boolean;
  onHover?:   (msg: string | null) => void;
  onEdit?:    (id: string) => void;
}

// ── Component props ───────────────────────────────────────────────────────────
interface Props {
  cfg?:             CFG;
  safetyChecks?:    SafetyCheck[];
  onNodeClick?:     (line: number) => void;
  isDrawerOpen?:    boolean;
  onGraphChange?:   (nodes: Node<ExtendedNodeData>[], edges: Edge[]) => void;
  onCodeGenerated?: (code: string) => void;
}

// ── Modal state shapes ────────────────────────────────────────────────────────
interface EditState     { nodeId: string; label: string; code: string; type: string; }
interface EdgeEditState { edgeId: string; label: string; x: number; y: number; }

// ── Union of all valid node type keys ────────────────────────────────────────
type FlowNodeType =
  | 'terminator' | 'process'    | 'decision' | 'io'
  | 'predefined' | 'connector'  | 'off_page_connector' | 'document'
  | 'manual_input' | 'delay'   | 'database'
  | 'junction';

// ─────────────────────────────────────────────────────────────────────────────
// §2  CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const elk = new ELK();
let _nodeIdCounter = 1000;
const newNodeId = () => `user-node-${++_nodeIdCounter}`;

const NODE_COLORS: Record<FlowNodeType, string> = {
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

const DEFAULT_LABELS: Record<FlowNodeType, string> = {
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
  database:           'Data Store',
  junction:           '⬡',
};

const NODE_SIZES: Record<FlowNodeType, { width: number; height: number }> = {
  terminator:         { width: 160, height: 50  },
  process:            { width: 180, height: 90  },
  decision:           { width: 140, height: 140 },
  io:                 { width: 185, height: 70  },
  predefined:         { width: 180, height: 90  },
  connector:          { width: 60,  height: 60  },
  off_page_connector: { width: 70,  height: 70  },
  document:           { width: 185, height: 90  },
  manual_input:       { width: 185, height: 75  },
  delay:              { width: 185, height: 70  },
  database:           { width: 175, height: 95  },
  junction:           { width: 36,  height: 36  },
};

const EDITOR_ACCENT: Record<string, string> = {
  terminator:         '#42a5f5', process:      '#4caf50',
  decision:           '#ffa726', io:           '#64b5f6',
  predefined:         '#ab47bc', connector:    '#26c6da',
  off_page_connector: '#ffca28',
  document:           '#ef5350', manual_input: '#ff7043',
  delay:              '#78909c', database:     '#66bb6a',
  junction:           '#e040fb',
};

const EDITOR_TITLE: Record<string, string> = {
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
  database:           'Database / Data Store',
  junction:           'Junction (Offset / Merge Point)',
};

const CODE_PLACEHOLDER: Record<string, string> = {
  process:            'e.g.  hp = hp - 10;',
  decision:           'e.g.  hp > 0',
  io:                 'e.g.  cout << hp << endl;',
  predefined:         'e.g.  calculateDamage(hp, atk);',
  connector:          '',
  off_page_connector: '',
  document:           'e.g.  label or filename',
  manual_input:       'e.g.  cin >> name;',
  delay:              'e.g.  sleep(1000);',
  database:           'e.g.  scores[i]',
  terminator:         '',
  junction:           '',
};

const PALETTE_ITEMS: {
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
    type: 'predefined', label: 'Function Call', iso: 'ISO: Predefined',
    shape: (
      <div style={{ position: 'relative', width: 48, height: 20, background: 'linear-gradient(135deg,#18091f,#271040)', border: '2px solid #ab47bc', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, color: 'white', fontWeight: 700, flexShrink: 0 }}>
        <div style={{ position: 'absolute', left: 5,  top: 0, bottom: 0, width: 1.5, background: '#ab47bc' }} />
        <div style={{ position: 'absolute', left: 9,  top: 0, bottom: 0, width: 1.5, background: '#ab47bc' }} />
        <div style={{ position: 'absolute', right: 5, top: 0, bottom: 0, width: 1.5, background: '#ab47bc' }} />
        <div style={{ position: 'absolute', right: 9, top: 0, bottom: 0, width: 1.5, background: '#ab47bc' }} />
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
        {/* Home-plate / pentagon: flat top + sides, point at bottom */}
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
    type: 'database', label: 'Database / Store', iso: 'ISO: Stored Data',
    shape: (
      <svg width={36} height={22} viewBox="0 0 36 22" style={{ flexShrink: 0 }}>
        <rect x="2" y="5" width="32" height="14" fill="#050d05" stroke="#66bb6a" strokeWidth="1.5" />
        <ellipse cx="18" cy="19" rx="16" ry="4" fill="#050d05" stroke="#66bb6a" strokeWidth="1.5" />
        <ellipse cx="18" cy="5"  rx="16" ry="4" fill="#0d220d" stroke="#66bb6a" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    type: 'junction', label: 'Junction (Offset)', iso: 'ISO: Junction / Merge',
    shape: (
      <svg width={28} height={28} viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
        {/* Offset shape: like a small rotated square shifted slightly — used as a merge/split point */}
        <polygon points="14,3 25,14 14,25 3,14" fill="#1a0820" stroke="#e040fb" strokeWidth="1.5" />
        <circle cx="14" cy="14" r="3.5" fill="#e040fb" opacity="0.85" />
      </svg>
    ),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// §3  SHARED NODE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function useNodeAppearance(type: FlowNodeType, data: ExtendedNodeData) {
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

const handleStyle = (color: string): React.CSSProperties => ({
  background: color,
  width:      '11px',
  height:     '11px',
  border:     '2px solid #0d1117',
  boxShadow:  `0 0 8px ${color}`,
});

const BaseNode: React.FC<{
  data:       ExtendedNodeData;
  selected?:  boolean;
  style?:     React.CSSProperties;
  className?: string;
  children:   React.ReactNode;
}> = ({ data, selected, style, className = '', children }) => (
  <div
    className={`flow-node editable-node ${className}`}
    onMouseEnter={() => data.onHover?.(data.tutorExplanation ?? null)}
    onMouseLeave={() => data.onHover?.(null)}
    onDoubleClick={() => data.onEdit?.(String(data.id ?? ''))}
    style={{
      position:  'relative',
      cursor:    'pointer',
      animation: selected ? 'nodePulse 1.5s ease-in-out infinite' : 'none',
      transition: 'all 0.25s ease',
      ...style,
    }}
  >
    {children}
  </div>
);

/** Small "double-click to edit" tooltip shown on node hover. */
const EditHint = () => (
  <div
    className="edit-hint"
    style={{
      position: 'absolute', top: -22, left: '50%',
      transform: 'translateX(-50%)',
      fontSize: 9, color: '#8b949e', whiteSpace: 'nowrap',
      background: 'rgba(13,17,23,0.92)', border: '1px solid #30363d',
      borderRadius: 4, padding: '2px 7px',
      pointerEvents: 'none', opacity: 0, transition: 'opacity 0.2s', zIndex: 10,
    }}
  >
    ✏️ Double-click to edit
  </div>
);

/** Warning badge shown above nodes that have a safety violation. */
const ViolationBadge = () => (
  <div
    style={{
      position: 'absolute', top: -16, left: '50%',
      transform: 'translateX(-50%)',
      fontSize: 16, animation: 'bounce 1s ease-in-out infinite', zIndex: 10,
    }}
    title="Safety violation detected on this node"
  >
    ⚠️
  </div>
);

/** Label block rendered inside rectangular/box-type nodes. */
const NodeLabel: React.FC<{ data: ExtendedNodeData }> = ({ data }) => (
  <div style={{ pointerEvents: 'none', userSelect: 'none', textAlign: 'center' }}>
    <strong style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'white', letterSpacing: '0.3px', textShadow: '0 2px 3px rgba(0,0,0,0.6)' }}>
      {String(data.label ?? '')}
    </strong>
    {data.code && (
      <code style={{ display: 'block', fontSize: 10, marginTop: 5, fontFamily: "'JetBrains Mono','Fira Code',monospace", background: 'rgba(0,0,0,0.4)', padding: '4px 6px', borderRadius: 4, color: 'rgba(255,255,255,0.9)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.4 }}>
        {String(data.code)}
      </code>
    )}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// §4  ISO 5807 NODE COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. TERMINATOR — rounded pill ─────────────────────────────────────────────
const TerminatorNode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const { color, bg } = useNodeAppearance('terminator', data);
  const background = bg ?? 'linear-gradient(135deg,#0d47a1,#1565c0)';
  return (
    <BaseNode data={data} selected={selected} style={{ width: 160, height: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background, border: `2.5px solid ${color}`, borderRadius: 999, boxShadow: `0 4px 20px ${color}55` }}>
      <EditHint />
      {data.violation && <ViolationBadge />}
      <Handle type="target" position={Position.Top}    style={{ ...handleStyle(color), top: -6 }} />
      <span style={{ pointerEvents: 'none', userSelect: 'none', fontSize: 12, fontWeight: 700, color: 'white', letterSpacing: '0.5px', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>
        {String(data.label ?? '')}
      </span>
      <Handle type="source" position={Position.Bottom} style={{ ...handleStyle(color), bottom: -6 }} />
    </BaseNode>
  );
};

// ── 2. PROCESS — plain rectangle ─────────────────────────────────────────────
const ProcessNode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const { color, bg } = useNodeAppearance('process', data);
  const background = bg ?? 'linear-gradient(135deg,#141a14,#1e271e)';
  return (
    <BaseNode data={data} selected={selected} style={{ padding: '14px 16px', minWidth: 160, maxWidth: 210, background, border: `2.5px solid ${color}`, borderRadius: 4, boxShadow: `0 3px 14px ${color}33` }}>
      <EditHint />
      {data.violation && <ViolationBadge />}
      <Handle type="target" position={Position.Top}    style={handleStyle(color)} />
      <NodeLabel data={data} />
      <Handle type="source" position={Position.Bottom} style={handleStyle(color)} />
    </BaseNode>
  );
};

// ── 3. DECISION — true diamond via SVG ───────────────────────────────────────
const DecisionNode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const W = 140, H = 140;
  const { color } = useNodeAppearance('decision', data);
  const fill = data.violation ? '#2d0a0a' : data.visited ? '#0d2010' : '#1a1608';
  const points = `${W/2},4 ${W-4},${H/2} ${W/2},${H-4} 4,${H/2}`;
  return (
    <BaseNode data={data} selected={selected} style={{ width: W, height: H }}>
      <EditHint />
      {data.violation && <ViolationBadge />}
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', top: 0, left: 0, filter: `drop-shadow(0 4px 14px ${color}44)` }}>
        <polygon points={points} fill={fill} stroke={color} strokeWidth={selected ? 3 : 2.5} strokeLinejoin="round" />
      </svg>
      <Handle type="target" position={Position.Top}    style={{ ...handleStyle(color), top: 0, left: '50%', transform: 'translateX(-50%)' }} />
      <Handle type="source" position={Position.Bottom} style={{ ...handleStyle(color), bottom: 0, left: '50%', transform: 'translateX(-50%)' }} />
      <Handle type="source" id="right" position={Position.Right} style={{ ...handleStyle(color), right: 0, top: '50%', transform: 'translateY(-50%)' }} />
      <Handle type="source" id="left"  position={Position.Left}  style={{ ...handleStyle(color), left: 0,  top: '50%', transform: 'translateY(-50%)' }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'white', textAlign: 'center', maxWidth: 80, lineHeight: 1.3, textShadow: '0 2px 4px rgba(0,0,0,0.7)' }}>
          {String(data.label ?? 'Condition')}
        </span>
      </div>
    </BaseNode>
  );
};

// ── 4. I/O — parallelogram ───────────────────────────────────────────────────
const IONode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const W = 180, H = 65, SKEW = 20;
  const { color } = useNodeAppearance('io', data);
  const fill = data.violation ? '#2d0a0a' : data.visited ? '#0d2010' : '#081c33';
  const points = `${SKEW},2 ${W-2},2 ${W-SKEW-2},${H-2} 2,${H-2}`;
  return (
    <BaseNode data={data} selected={selected} style={{ width: W, height: H }}>
      <EditHint />
      {data.violation && <ViolationBadge />}
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, filter: `drop-shadow(0 3px 12px ${color}44)` }}>
        <polygon points={points} fill={fill} stroke={color} strokeWidth={selected ? 3 : 2} strokeLinejoin="round" />
      </svg>
      <Handle type="target" position={Position.Top}    style={{ ...handleStyle(color), zIndex: 5, left: W - SKEW / 2 }} />
      <Handle type="source" position={Position.Bottom} style={{ ...handleStyle(color), zIndex: 5, left: W / 2 - SKEW / 2 }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1, paddingLeft: SKEW / 2 }}>
        <NodeLabel data={data} />
      </div>
    </BaseNode>
  );
};

// ── 5. PREDEFINED — rectangle with ISO double side bars ──────────────────────
const PredefinedNode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const { color, bg } = useNodeAppearance('predefined', data);
  const background = bg ?? 'linear-gradient(135deg,#18091f,#271040)';
  const bar = (side: 'left' | 'right', offset: number) => (
    <div style={{ position: 'absolute', [side]: offset, top: 2, bottom: 2, width: 2, background: color, opacity: 0.9, borderRadius: 1 }} />
  );
  return (
    <BaseNode data={data} selected={selected} style={{ padding: '14px 30px', minWidth: 160, maxWidth: 210, background, border: `2.5px solid ${color}`, borderRadius: 4, boxShadow: `0 3px 14px ${color}33` }}>
      {bar('left',  10)} {bar('left',  16)}
      {bar('right', 10)} {bar('right', 16)}
      <EditHint />
      {data.violation && <ViolationBadge />}
      <Handle type="target" position={Position.Top}    style={handleStyle(color)} />
      <NodeLabel data={data} />
      <Handle type="source" position={Position.Bottom} style={handleStyle(color)} />
    </BaseNode>
  );
};

// ── 6. CONNECTOR — small circle ──────────────────────────────────────────────
const ConnectorNode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const { color, bg } = useNodeAppearance('connector', data);
  const background = bg ?? 'linear-gradient(135deg,#042a2e,#073540)';
  return (
    <BaseNode data={data} selected={selected} style={{ width: 60, height: 60, borderRadius: '50%', background, border: `2.5px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 3px 16px ${color}55` }}>
      <EditHint />
      {data.violation && <ViolationBadge />}
      <Handle type="target" position={Position.Top}    style={handleStyle(color)} />
      <span style={{ color: 'white', fontSize: 14, fontWeight: 800, pointerEvents: 'none' }}>
        {String(data.label ?? 'A')}
      </span>
      <Handle type="source" position={Position.Bottom} style={handleStyle(color)} />
    </BaseNode>
  );
};

// ── 6b. OFF-PAGE CONNECTOR — pentagon / home-plate ───────────────────────────
// ISO 5807 "Off-page Reference": flat top + sides, point at bottom — used to
// jump flow to/from another page (cross-page reference). Distinct from the
// on-page Connector circle: the home-plate shape signals an off-page link.
const OffPageConnectorNode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const W = 70, H = 70;
  const { color } = useNodeAppearance('off_page_connector', data);
  const fill = data.violation ? '#2d0a0a' : data.visited ? '#1a2e1a' : '#2a2008';
  const points = `4,4 ${W-4},4 ${W-4},${H*0.6} ${W/2},${H-4} 4,${H*0.6}`;
  return (
    <BaseNode data={data} selected={selected} style={{ width: W, height: H }}>
      <EditHint />
      {data.violation && <ViolationBadge />}
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, filter: `drop-shadow(0 3px 14px ${color}55)` }}>
        <polygon points={points} fill={fill} stroke={color} strokeWidth={selected ? 3 : 2.5} strokeLinejoin="round" />
      </svg>
      <Handle type="target" position={Position.Top}    style={{ ...handleStyle(color), top: 0, zIndex: 5 }} />
      <div style={{ position: 'absolute', top: '38%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 1, pointerEvents: 'none', userSelect: 'none' }}>
        <span style={{ color: 'white', fontSize: 14, fontWeight: 800, textShadow: '0 2px 4px rgba(0,0,0,0.6)' }}>
          {String(data.label ?? '1')}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ ...handleStyle(color), bottom: 0, zIndex: 5 }} />
    </BaseNode>
  );
};

// ── 7. DOCUMENT — rectangle with wavy bottom ─────────────────────────────────
const DocumentNode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const W = 185, H = 90;
  const { color } = useNodeAppearance('document', data);
  const fill = data.violation ? '#2d0a0a' : data.visited ? '#0d2010' : '#180303';
  const path = `M 3,3 L ${W-3},3 L ${W-3},${H-20}
    Q ${W*0.875},${H-3}  ${W*0.75},${H-20}
    Q ${W*0.625},${H-37} ${W*0.5}, ${H-20}
    Q ${W*0.375},${H-3}  ${W*0.25},${H-20}
    Q ${W*0.125},${H-37} 3,${H-20} Z`;
  return (
    <BaseNode data={data} selected={selected} style={{ width: W, height: H }}>
      <EditHint />
      {data.violation && <ViolationBadge />}
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, filter: `drop-shadow(0 3px 12px ${color}44)` }}>
        <path d={path} fill={fill} stroke={color} strokeWidth={selected ? 3 : 2} strokeLinejoin="round" />
      </svg>
      <Handle type="target" position={Position.Top}    style={{ ...handleStyle(color), zIndex: 5 }} />
      <div style={{ position: 'absolute', top: '28%', left: '50%', transform: 'translate(-50%,-50%)', width: 150, zIndex: 1 }}>
        <NodeLabel data={data} />
      </div>
      <Handle type="source" position={Position.Bottom} style={{ ...handleStyle(color), bottom: 10, zIndex: 5 }} />
    </BaseNode>
  );
};

// ── 8. MANUAL INPUT — trapezoid, higher on left ──────────────────────────────
const ManualInputNode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const W = 185, H = 72, SLOPE = 18;
  const { color } = useNodeAppearance('manual_input', data);
  const fill = data.violation ? '#2d0a0a' : data.visited ? '#0d2010' : '#180b00';
  const points = `2,${SLOPE} ${W-2},2 ${W-2},${H-2} 2,${H-2}`;
  return (
    <BaseNode data={data} selected={selected} style={{ width: W, height: H }}>
      <EditHint />
      {data.violation && <ViolationBadge />}
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, filter: `drop-shadow(0 3px 12px ${color}44)` }}>
        <polygon points={points} fill={fill} stroke={color} strokeWidth={selected ? 3 : 2} strokeLinejoin="round" />
      </svg>
      <Handle type="target" position={Position.Top}    style={{ ...handleStyle(color), top: SLOPE / 2, zIndex: 5 }} />
      <div style={{ position: 'absolute', top: '55%', left: '50%', transform: 'translate(-50%,-50%)', width: 145, zIndex: 1 }}>
        <NodeLabel data={data} />
      </div>
      <Handle type="source" position={Position.Bottom} style={{ ...handleStyle(color), zIndex: 5 }} />
    </BaseNode>
  );
};

// ── 9. DELAY — D-shape: flat left, semicircle right ──────────────────────────
const DelayNode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const W = 185, H = 68;
  const R = H / 2 - 2;
  const { color } = useNodeAppearance('delay', data);
  const fill = data.violation ? '#2d0a0a' : data.visited ? '#1a2e1a' : '#0e1418';
  const path = `M 3,3 L ${W-R-2},3 A ${R},${R} 0 0 1 ${W-R-2},${H-3} L 3,${H-3} Z`;
  return (
    <BaseNode data={data} selected={selected} style={{ width: W, height: H }}>
      <EditHint />
      {data.violation && <ViolationBadge />}
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, filter: `drop-shadow(0 3px 14px ${color}33)` }}>
        <path d={path} fill={fill} stroke={color} strokeWidth={selected ? 3 : 2} strokeLinejoin="round" />
      </svg>
      <Handle type="target" position={Position.Top}    style={{ ...handleStyle(color), zIndex: 5 }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1, paddingRight: R / 2 }}>
        <NodeLabel data={data} />
      </div>
      <Handle type="source" position={Position.Bottom} style={{ ...handleStyle(color), zIndex: 5 }} />
    </BaseNode>
  );
};

// ── 10. DATABASE — cylinder ───────────────────────────────────────────────────
const DatabaseNode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const W = 175, H = 95;
  const rx = (W - 6) / 2, ry = 14;
  const { color } = useNodeAppearance('database', data);
  const fillTop  = data.violation ? '#2d0a0a' : data.visited ? '#0d220d' : '#071407';
  const fillBody = data.violation ? '#1a0808' : data.visited ? '#0a1a0a' : '#050d05';
  return (
    <BaseNode data={data} selected={selected} style={{ width: W, height: H }}>
      <EditHint />
      {data.violation && <ViolationBadge />}
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, filter: `drop-shadow(0 3px 14px ${color}44)` }}>
        <rect    x={3} y={ry} width={W-6} height={H-ry-3} fill={fillBody} stroke={color} strokeWidth={selected ? 3 : 2} />
        <ellipse cx={W/2} cy={H-ry-2} rx={rx} ry={ry} fill={fillBody} stroke={color} strokeWidth={selected ? 3 : 2} />
        <ellipse cx={W/2} cy={ry+1}   rx={rx} ry={ry} fill={fillTop}  stroke={color} strokeWidth={selected ? 3 : 2} />
        <ellipse cx={W/2} cy={ry+1} rx={rx-6} ry={ry-5} fill="none" stroke={color} strokeWidth="1" opacity="0.3" />
      </svg>
      <Handle type="target" position={Position.Top}    style={{ ...handleStyle(color), top: 4, zIndex: 5 }} />
      <div style={{ position: 'absolute', top: '55%', left: '50%', transform: 'translate(-50%,-50%)', width: W-20, zIndex: 1 }}>
        <NodeLabel data={data} />
      </div>
      <Handle type="source" position={Position.Bottom} style={{ ...handleStyle(color), zIndex: 5 }} />
    </BaseNode>
  );
};

// ── 11. JUNCTION — small offset diamond (merge / split point) ─────────────────
// This is the "Offset Shape" from ISO 5807 / ANSI — a tiny filled diamond used
// as a junction where multiple flow lines meet or branch. It renders all four
// cardinal handles so edges can arrive/depart from any direction.
const JunctionNode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const S = 36; // overall bounding box (square)
  const { color } = useNodeAppearance('junction', data);
  const fill = data.violation ? '#2d0820' : data.visited ? '#1a0d2e' : '#1a0820';
  const points = `${S/2},3 ${S-3},${S/2} ${S/2},${S-3} 3,${S/2}`;
  return (
    <BaseNode
      data={data}
      selected={selected}
      style={{ width: S, height: S }}
    >
      <svg
        width={S} height={S}
        viewBox={`0 0 ${S} ${S}`}
        style={{ position: 'absolute', inset: 0, filter: `drop-shadow(0 2px 8px ${color}88)` }}
      >
        <polygon
          points={points}
          fill={fill}
          stroke={color}
          strokeWidth={selected ? 2.5 : 2}
          strokeLinejoin="round"
        />
        {/* Centre dot to visually signal "junction" */}
        <circle cx={S/2} cy={S/2} r={4} fill={color} opacity={0.9} />
      </svg>
      {/* Four cardinal handles — junctions accept / emit from all sides */}
      <Handle type="target" position={Position.Top}    id="t" style={{ ...handleStyle(color), top: -2,    left: '50%', transform: 'translateX(-50%)' }} />
      <Handle type="target" position={Position.Left}   id="l" style={{ ...handleStyle(color), left: -2,   top: '50%',  transform: 'translateY(-50%)' }} />
      <Handle type="source" position={Position.Bottom} id="b" style={{ ...handleStyle(color), bottom: -2, left: '50%', transform: 'translateX(-50%)' }} />
      <Handle type="source" position={Position.Right}  id="r" style={{ ...handleStyle(color), right: -2,  top: '50%',  transform: 'translateY(-50%)' }} />
    </BaseNode>
  );
};

const nodeTypes = {
  terminator:         TerminatorNode, process:      ProcessNode,
  decision:           DecisionNode,   io:           IONode,
  predefined:         PredefinedNode, connector:    ConnectorNode,
  off_page_connector: OffPageConnectorNode,
  document:           DocumentNode,   manual_input: ManualInputNode,
  delay:              DelayNode,      database:     DatabaseNode,
  junction:           JunctionNode,
};

// ─────────────────────────────────────────────────────────────────────────────
// §5  OVERLAY UI COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

// ── NodePalette ───────────────────────────────────────────────────────────────
const NodePalette: React.FC<{
  onAddNode:        (type: FlowNodeType) => void;
  onClearCanvas:    () => void;
  hasGeneratePanel?: boolean;
}> = ({ onAddNode, onClearCanvas, hasGeneratePanel = false }) => {
  const [expanded, setExpanded] = useState(true);
  const listMaxHeight = hasGeneratePanel ? 'calc(100vh - 420px)' : 'calc(100vh - 100px)';

  return (
    <div style={{ background: 'linear-gradient(135deg,rgba(13,17,23,0.98),rgba(22,27,34,0.98))', border: '2px solid #30363d', borderRadius: 12, padding: expanded ? 14 : '10px 14px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)', transition: 'all 0.3s ease', flexShrink: 0 }}>

      <div
        onClick={() => setExpanded(v => !v)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none', marginBottom: expanded ? 10 : 0 }}
        title={expanded ? 'Collapse node palette' : 'Expand node palette'}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: '#58a6ff', letterSpacing: '0.5px' }}>➕ ADD NODE</div>
        <div style={{ fontSize: 12, color: '#58a6ff', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s', marginLeft: 8 }}>▼</div>
      </div>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: listMaxHeight, overflowY: 'auto' }}>
          {PALETTE_ITEMS.map(({ type, label, iso, shape }) => {
            const color = NODE_COLORS[type];
            return (
              <button
                key={type}
                onClick={() => onAddNode(type)}
                title={`Add a ${label} node (${iso})`}
                style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'rgba(255,255,255,0.02)', border: `1px solid ${color}33`, borderRadius: 7, padding: '6px 9px', cursor: 'pointer', transition: 'all 0.2s', textAlign: 'left' }}
                onMouseEnter={e => { const b = e.currentTarget; b.style.background = `${color}14`; b.style.borderColor = `${color}88`; b.style.transform = 'translateX(-2px)'; }}
                onMouseLeave={e => { const b = e.currentTarget; b.style.background = 'rgba(255,255,255,0.02)'; b.style.borderColor = `${color}33`; b.style.transform = 'none'; }}
              >
                <div style={{ width: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{shape}</div>
                <div>
                  <div style={{ fontSize: 11, color: '#c9d1d9', fontWeight: 600, lineHeight: 1.2 }}>{label}</div>
                  <div style={{ fontSize: 9,  color: '#484f58', marginTop: 1 }}>{iso}</div>
                </div>
              </button>
            );
          })}

          <div style={{ height: 1, background: '#21262d', margin: '4px 0' }} />

          {/* Clear Canvas */}
          <button
            onClick={onClearCanvas}
            title="Remove all nodes and edges from the canvas"
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,68,68,0.04)', border: '1px solid rgba(255,68,68,0.25)', borderRadius: 7, padding: '7px 9px', cursor: 'pointer', transition: 'all 0.2s' }}
            onMouseEnter={e => { const b = e.currentTarget; b.style.background = 'rgba(255,68,68,0.12)'; b.style.borderColor = '#ff4444'; }}
            onMouseLeave={e => { const b = e.currentTarget; b.style.background = 'rgba(255,68,68,0.04)'; b.style.borderColor = 'rgba(255,68,68,0.25)'; }}
          >
            <span style={{ fontSize: 12 }}>🗑️</span>
            <span style={{ fontSize: 11, color: '#ff6b6b', fontWeight: 600 }}>Clear Canvas</span>
          </button>

          {/* Keyboard shortcut hints */}
          <div style={{ padding: '5px 4px', fontSize: 9, color: '#484f58', lineHeight: 1.7, borderTop: '1px solid #21262d', marginTop: 2 }}>
            <strong style={{ color: '#3d444d' }}>Tips:</strong> Double-click a node to edit it · Double-click an edge to label it · Press <kbd style={{ background: '#1c2128', border: '1px solid #30363d', borderRadius: 3, padding: '0 3px', fontSize: 8 }}>Backspace</kbd> to delete the selected item · <strong style={{ color: '#e040fb' }}>Alt+click</strong> an edge to insert a Junction at that point
          </div>
        </div>
      )}
    </div>
  );
};

// ── FlowchartLegend ───────────────────────────────────────────────────────────
const FlowchartLegend: React.FC<{ isDrawerOpen?: boolean }> = ({ isDrawerOpen = false }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{
      position: 'absolute', bottom: 12, left: 12, zIndex: 1000,
      background: 'linear-gradient(135deg,rgba(13,17,23,0.98),rgba(22,27,34,0.98))',
      border: '2px solid #30363d', borderRadius: 12,
      padding: expanded ? 14 : '10px 14px',
      width: expanded ? 240 : 'auto',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)',
      transition: 'all 0.3s ease',
      opacity: isDrawerOpen ? 0.25 : 1,
      filter:  isDrawerOpen ? 'blur(2px)' : 'none',
      pointerEvents: isDrawerOpen ? 'none' : 'auto',
    }}>
      <div
        onClick={() => setExpanded(v => !v)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
        title={expanded ? 'Hide legend' : 'Show ISO 5807 shape legend'}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: '#58a6ff', letterSpacing: '0.5px' }}>📊 LEGEND</div>
        <div style={{ fontSize: 12, color: '#58a6ff', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s', marginLeft: 8 }}>▼</div>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, borderTop: '1px solid #21262d', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
          {PALETTE_ITEMS.map(({ type, label, iso, shape }) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{shape}</div>
              <div>
                <div style={{ fontSize: 10, color: 'white', fontWeight: 600 }}>{label}</div>
                <div style={{ fontSize: 9,  color: '#484f58' }}>{iso}</div>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 4, padding: '5px 4px', fontSize: 9, color: '#484f58', lineHeight: 1.7, borderTop: '1px solid #21262d' }}>
            💡 Label decision edges <strong style={{ color: '#4caf50' }}>true</strong> / <strong style={{ color: '#ff6b6b' }}>false</strong> for correct code generation.
          </div>
        </div>
      )}
    </div>
  );
};

// ── GameStats ─────────────────────────────────────────────────────────────────
const GameStats: React.FC<{
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

      {/* Exploration card */}
      <div style={{ ...cardBase, border: '2px solid #4caf50', boxShadow: '0 4px 20px rgba(76,175,80,0.25)' }}>
        <div
          onClick={() => setExpanded(v => !v)}
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

      {/* Safety card */}
      <div style={{ ...cardBase, border: `2px solid ${safeColor}`, boxShadow: `0 4px 20px ${allSafe ? 'rgba(76,175,80,0.25)' : 'rgba(255,68,68,0.25)'}` }}>
        <div
          onClick={() => setExpanded(v => !v)}
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

// ── GenerateCodePanel ─────────────────────────────────────────────────────────
const GenerateCodePanel: React.FC<{
  nodes:             Node[];
  edges:             Edge[];
  onCodeGenerated?:  (code: string) => void;
  isDirty?:          boolean;
  onMarkClean?:      () => void;
}> = ({ nodes, edges, onCodeGenerated, isDirty = false, onMarkClean }) => {
  const [expanded,         setExpanded]         = useState(true);
  const [generatedCode,    setGeneratedCode]    = useState<string | null>(null);
  const [copied,           setCopied]           = useState(false);
  const [validationResult, setValidationResult] = useState<import('../../services/GraphValidator').ValidationResult | null>(null);
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
    }
  };

  // Re-validate whenever the graph changes so stale errors clear automatically
  const liveValidation = showValidation ? validateGraph(nodes, edges) : null;

  const handleCopy = () => {
    if (!generatedCode) return;
    navigator.clipboard.writeText(generatedCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {
      // Fallback for environments without clipboard API
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
      padding:        expanded ? 14 : '10px 14px',
      boxShadow:      `0 8px 32px ${hasErrors ? 'rgba(255,68,68,0.25)' : isDirty && generatedCode ? 'rgba(255,167,38,0.3)' : 'rgba(168,85,247,0.3)'}`,
      backdropFilter: 'blur(10px)',
      transition:     'all 0.3s ease',
      flexShrink:     0,
    }}>

      <div
        onClick={() => setExpanded(v => !v)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none', marginBottom: expanded ? 10 : 0 }}
        title={expanded ? 'Collapse code generator' : 'Expand code generator'}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: borderColor, letterSpacing: '0.5px' }}>
          ⚡ GENERATE C++{' '}
          {hasErrors                ? '— fix errors first' :
           isDirty && generatedCode ? '— graph changed, regenerate to update' : ''}
        </div>
        <div style={{ fontSize: 12, color: '#a855f7', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s', marginLeft: 8 }}>▼</div>
      </div>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* Validation panel */}
          {showValidation && activeValidation && hasIssues && (
            <ValidationPanel
              result={activeValidation}
              onDismiss={() => setShowValidation(false)}
            />
          )}

          {/* Instruction hint */}
          {(!showValidation || !hasIssues) && !isDirty && (
            <div style={{ fontSize: 9, color: '#484f58', lineHeight: 1.6, padding: '5px 8px', background: 'rgba(168,85,247,0.06)', borderRadius: 6, border: '1px solid rgba(168,85,247,0.2)' }}>
              Build your flowchart → label decision edges{' '}
              <strong style={{ color: '#4caf50' }}>true</strong> /{' '}
              <strong style={{ color: '#ff6b6b' }}>false</strong>{' '}
              → click Generate
            </div>
          )}

          {/* Outdated notice */}
          {!hasErrors && isDirty && generatedCode && (
            <div style={{ fontSize: 9, color: '#ffa726', padding: '5px 8px', background: 'rgba(255,167,38,0.08)', border: '1px solid rgba(255,167,38,0.3)', borderRadius: 6 }}>
              ⚠️ The graph has changed since the last generation — click Generate to update the output.
            </div>
          )}

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={nodes.length === 0}
            title={hasErrors ? 'Fix the errors shown above before generating code' : 'Generate C++ code from the current flowchart'}
            style={{
              width: '100%', padding: 10, borderRadius: 8, border: 'none',
              background:
                nodes.length === 0       ? 'rgba(168,85,247,0.15)' :
                hasErrors                ? 'rgba(255,68,68,0.2)'   :
                isDirty && generatedCode ? 'linear-gradient(135deg,#ffa726cc,#ff8f00cc)' :
                                           'linear-gradient(135deg,#a855f7cc,#7c3aedcc)',
              color:
                nodes.length === 0 ? '#6b21a8' :
                hasErrors          ? '#ff8888' :
                                     'white',
              fontWeight: 700, fontSize: 12,
              cursor: nodes.length === 0 ? 'not-allowed' : 'pointer',
              letterSpacing: '0.5px', transition: 'all 0.2s',
              opacity: hasErrors ? 0.7 : 1,
            }}
            onMouseEnter={e => { if (canGenerate) e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none'; }}
          >
            {generateLabel}
          </button>

          {/* Code preview + copy/export */}
          {generatedCode && !hasErrors && (
            <>
              <div style={{ background: '#0d1117', border: `1px solid ${isDirty ? 'rgba(255,167,38,0.3)' : 'rgba(168,85,247,0.3)'}`, borderRadius: 8, padding: 10, maxHeight: 140, overflowY: 'auto' }}>
                <pre style={{ margin: 0, fontSize: 10, color: isDirty ? '#8b949e' : '#c9d1d9', fontFamily: "'JetBrains Mono','Fira Code',monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6, opacity: isDirty ? 0.6 : 1 }}>
                  {generatedCode}
                </pre>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={handleCopy}
                  title="Copy generated code to clipboard"
                  style={{ flex: 1, padding: 8, borderRadius: 7, border: '1px solid rgba(168,85,247,0.5)', background: copied ? 'rgba(76,175,80,0.2)' : 'rgba(168,85,247,0.1)', color: copied ? '#4caf50' : '#a855f7', fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}
                >
                  {copied ? '✓ Copied!' : '📋 Copy'}
                </button>
                <button
                  onClick={handleExport}
                  title="Download as generated.cpp"
                  style={{ flex: 1, padding: 8, borderRadius: 7, border: '1px solid rgba(168,85,247,0.5)', background: 'rgba(168,85,247,0.1)', color: '#a855f7', fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}
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
const NodeEditor: React.FC<{
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
    editState.type === 'off_page_connector' ? 'e.g. P2, page-2, 1'             :
    `e.g. ${DEFAULT_LABELS[editState.type as FlowNodeType] ?? 'Label'}`;

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
      return; // don't save an empty label
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
        style={{ background: '#13181f', border: `1px solid ${accent}44`, borderTop: `3px solid ${accent}`, borderRadius: 14, width: 460, boxShadow: `0 24px 64px rgba(0,0,0,0.85), 0 0 0 1px ${accent}18`, animation: 'editorSlideIn 0.18s ease-out', overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 20px', background: `${accent}0c`, borderBottom: `1px solid ${accent}1e` }}>
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: accent, boxShadow: `0 0 8px ${accent}bb`, flexShrink: 0 }} />
          <div style={{ fontSize: 11, fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '1.2px', fontFamily: "'IBM Plex Mono', monospace", flex: 1 }}>{title}</div>
          <div style={{ fontSize: 10, color: '#3d444d', fontFamily: "'IBM Plex Mono', monospace" }}>Ctrl+Enter to save · Esc to cancel</div>
        </div>

        {/* Fields */}
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
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
                  C++ Code
                </label>
                <span style={{ fontSize: 10, color: '#3d444d', fontFamily: "'IBM Plex Mono', monospace" }}>
                  — written into the generated output
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
        </div>

        {/* Footer */}
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
const EdgeLabelEditor: React.FC<{
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
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#64b5f6', boxShadow: '0 0 8px #64b5f6' }} />
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64b5f6', textTransform: 'uppercase', letterSpacing: '1px' }}>Label This Edge</div>
          <div style={{ marginLeft: 'auto', fontSize: 10, color: '#484f58' }}>Enter to save · Esc to cancel</div>
        </div>

        {/* Quick-pick buttons */}
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

        {/* Custom label input */}
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
          💡 Label decision edges <strong style={{ color: '#4caf50' }}>true</strong> / <strong style={{ color: '#ff6b6b' }}>false</strong> so the code generator can produce correct <code style={{ fontSize: 8, background: '#1c2128', padding: '1px 4px', borderRadius: 3 }}>if</code> / <code style={{ fontSize: 8, background: '#1c2128', padding: '1px 4px', borderRadius: 3 }}>while</code> statements.
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// §7  MAIN FlowGraph COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

// Safety cap — above this, we still render, but we warn the user and defer ELK
const MAX_NODES_SAFE = 200;

const FlowGraphInner: React.FC<Props> = ({
  cfg, safetyChecks = [], onNodeClick,
  isDrawerOpen = false, onGraphChange, onCodeGenerated,
}) => {
  const [nodes, setNodes]                 = useState<Node<ExtendedNodeData>[]>([]);
  const [edges, setEdges]                 = useState<Edge[]>([]);
  // Lock semantics: when true, nodes are frozen in place AND panning is disabled.
  // Zoom (wheel / pinch / +/- buttons) stays enabled so the user can still
  // inspect large graphs without accidentally moving nodes.
  const [isLocked, setIsLocked]           = useState(false);
  const [hoverInfo, setHoverInfo]         = useState<string | null>(null);
  const [mousePos,  setMousePos]          = useState({ x: 0, y: 0 });
  const [editState,     setEditState]     = useState<EditState | null>(null);
  const [edgeEditState, setEdgeEditState] = useState<EdgeEditState | null>(null);
  const [isDirty, setIsDirty]             = useState(false);

  // Used by mid-segment anchoring to convert screen → flow coordinates
  const { screenToFlowPosition } = useReactFlow();

  // ── Mid-segment anchoring ──────────────────────────────────────────────────
  // Alt+Click on any edge inserts a Junction node at the click point and splits
  // the edge: original_source → junction → original_target. The user can then
  // draw new edges from the junction to achieve edge-to-point connections.
  const handleEdgeClick = useCallback((evt: React.MouseEvent, edge: Edge) => {
    if (!evt.altKey) return; // regular click falls through to double-click handler
    evt.preventDefault();
    evt.stopPropagation();

    // Place the junction at the cursor position in flow coordinates
    const flowPos = screenToFlowPosition({ x: evt.clientX, y: evt.clientY });
    const junctionId = `junction-${Date.now()}`;

    const junctionNode: Node<ExtendedNodeData> = {
      id:   junctionId,
      type: 'junction',
      position: { x: flowPos.x - 18, y: flowPos.y - 18 }, // centre on cursor
      data: {
        id:    junctionId,
        type:  'process',
        label: '⬡',
        code:  '',
        line:  -1,
        children: [],
        x: 0,
        y: 0,
        onHover: setHoverInfo,
        onEdit:  (nodeId: string) => {
          setEditState({
            nodeId,
            label: '⬡',
            code: '',
            type: 'junction',
          });
        },
      } as ExtendedNodeData,
      draggable: true,
    };

    const edgeStyle  = { stroke: '#e040fb', strokeWidth: 2 };
    const markerEnd  = { type: MarkerType.ArrowClosed, color: '#e040fb' };
    const sharedOpts = { type: 'default', style: edgeStyle, markerEnd,
                         labelStyle: { fill: '#ffffff', fontSize: '11px', fontWeight: '600' },
                         labelBgStyle: { fill: '#0d1117', fillOpacity: 0.9 },
                         labelBgPadding: [5, 8] as [number, number] };

    // Edge A: original source → junction (inherits original label so user sees it)
    const edgeA: Edge = {
      id:     `${junctionId}-a`,
      source: edge.source,
      sourceHandle: edge.sourceHandle ?? undefined,
      target: junctionId,
      label:  edge.label ?? '',
      ...sharedOpts,
    };
    // Edge B: junction → original target (no label needed, fresh segment)
    const edgeB: Edge = {
      id:     `${junctionId}-b`,
      source: junctionId,
      target: edge.target,
      targetHandle: edge.targetHandle ?? undefined,
      ...sharedOpts,
    };

    setNodes(nds => [...nds, junctionNode]);
    setEdges(eds => {
      // Remove the original edge, insert the two replacement segments
      const next = [...eds.filter(e => e.id !== edge.id), edgeA, edgeB];
      setNodes(nds2 => { onGraphChange?.(nds2, next); return nds2; });
      return next;
    });
    setIsDirty(true);
  }, [screenToFlowPosition, onGraphChange]);

  // ── Node edit handlers ─────────────────────────────────────────────────────

  const handleOpenEdit = useCallback((nodeId: string) => {
    setNodes(current => {
      const node = current.find(n => n.id === nodeId);
      if (node) {
        setEditState({
          nodeId,
          label: String(node.data.label ?? ''),
          code:  String(node.data.code  ?? ''),
          type:  node.type ?? 'process',
        });
      }
      return current;
    });
  }, []);

  const handleSaveEdit = useCallback((newLabel: string, newCode: string) => {
    if (!editState) return;
    setNodes(current => {
      const next = current.map(n =>
        n.id !== editState.nodeId ? n
          : { ...n, data: { ...n.data, label: newLabel || n.data.label, code: newCode } }
      );
      setEdges(eds => { onGraphChange?.(next, eds); return eds; });
      return next;
    });
    setEditState(null);
    setIsDirty(true);
  }, [editState, onGraphChange]);

  // ── Edge edit handlers ─────────────────────────────────────────────────────

  const handleEdgeDoubleClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setEdgeEditState({
      edgeId: edge.id,
      label:  String(edge.label ?? ''),
      x: mousePos.x,
      y: mousePos.y,
    });
  }, [mousePos]);

  const handleSaveEdgeLabel = useCallback((newLabel: string) => {
    if (!edgeEditState) return;
    const isTrue  = newLabel === 'true'  || newLabel === 'yes';
    const isFalse = newLabel === 'false' || newLabel === 'no';
    const edgeColor = isTrue ? '#4caf50' : isFalse ? '#ff4444' : '#64b5f6';

    setEdges(current => {
      const next = current.map(e =>
        e.id !== edgeEditState.edgeId ? e : {
          ...e,
          label: newLabel,
          labelStyle:   { fill: isTrue ? '#4caf50' : isFalse ? '#ff6b6b' : '#ffffff', fontSize: '11px', fontWeight: '700' },
          style:        { ...e.style, stroke: edgeColor },
          markerEnd:    { type: MarkerType.ArrowClosed, color: edgeColor },
        }
      );
      setNodes(nds => { onGraphChange?.(nds, next); return nds; });
      return next;
    });
    setEdgeEditState(null);
    setIsDirty(true);
  }, [edgeEditState, onGraphChange]);

  // ── Canvas actions ─────────────────────────────────────────────────────────

  const handleClearCanvas = useCallback(() => {
    if (nodes.length === 0) return;
    if (!window.confirm('Clear the entire canvas? This action cannot be undone.')) return;
    setNodes([]);
    setEdges([]);
    setIsDirty(false);
    onGraphChange?.([], []);
  }, [nodes.length, onGraphChange]);

  const handleAddNode = useCallback((type: FlowNodeType) => {
    const id = newNodeId();

    setNodes(current => {
      const hasStart = current.some(
        n => n.type === 'terminator' && String(n.data.label ?? '').toLowerCase() === 'start'
      );
      const initialLabel = (type === 'terminator' && hasStart) ? 'End' : DEFAULT_LABELS[type];
      const newNode: Node<ExtendedNodeData> = {
        id, type,
        position: { x: 220 + Math.random() * 160, y: 80 + current.length * 30 },
        data: {
          id, label: initialLabel, code: '', line: -1,
          onHover: setHoverInfo,
          onEdit:  handleOpenEdit,
        } as ExtendedNodeData,
        draggable: true,
      };
      return [...current, newNode];
    });

    // Open the editor after the node is in state
    setTimeout(() => {
      setNodes(current => {
        const node = current.find(n => n.id === id);
        if (node) {
          const hasStart = current.some(
            n => n.type === 'terminator' &&
                 String(n.data.label ?? '').toLowerCase() === 'start' &&
                 n.id !== id
          );
          const lbl = (type === 'terminator' && hasStart) ? 'End' : DEFAULT_LABELS[type];
          setEditState({ nodeId: id, label: lbl, code: '', type });
        }
        return current;
      });
    }, 50);

    setIsDirty(true);
  }, [handleOpenEdit]);

  // ── React Flow change handlers ─────────────────────────────────────────────

  const onNodesChangeHandler = useCallback((changes: NodeChange<Node<ExtendedNodeData>>[]) => {
    // Structural changes (add / remove / drag-end) are the only ones that
    // should bubble up via onGraphChange + isDirty. Mid-drag position updates,
    // selection flips, and dimension recalcs must NOT round-trip state or the
    // canvas jitters on large graphs.
    const structural = changes.some((c: NodeChange<Node<ExtendedNodeData>>) =>
      c.type === 'add' ||
      c.type === 'remove' ||
      (c.type === 'position' && c.dragging === false)
    );

    setNodes(nds => {
      const next = applyNodeChanges(changes, nds);
      if (structural) {
        setEdges(eds => { onGraphChange?.(next, eds); return eds; });
        setIsDirty(true);
      }
      return next;
    });
  }, [onGraphChange]);

  const onEdgesChangeHandler = useCallback((changes: EdgeChange<Edge>[]) => {
    setEdges(eds => {
      const next = applyEdgeChanges(changes, eds);
      setNodes(nds => { onGraphChange?.(nds, next); return nds; });
      setIsDirty(true);
      return next;
    });
  }, [onGraphChange]);

  const onConnectHandler = useCallback((params: Connection) => {
    setEdges(eds => {
      const next = addEdge({
        ...params,
        type:           'default',
        markerEnd:      { type: MarkerType.ArrowClosed, color: '#64b5f6' },
        style:          { stroke: '#64b5f6', strokeWidth: 2 },
        labelStyle:     { fill: '#ffffff', fontSize: '11px', fontWeight: '600' },
        labelBgStyle:   { fill: '#0d1117', fillOpacity: 0.9 },
        labelBgPadding: [5, 8] as [number, number],
      }, eds);
      setNodes(nds => { onGraphChange?.(nds, next); return nds; });
      setIsDirty(true);
      return next;
    });
  }, [onGraphChange]);

  // ── Node click → mark as visited ──────────────────────────────────────────

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node<ExtendedNodeData>) => {
    setNodes(current =>
      current.map(n => n.id === node.id ? { ...n, data: { ...n.data, visited: true } } : n)
    );
    const cfgNode = cfg?.nodes.find(n => n.id === node.id);
    if (cfgNode?.line != null && onNodeClick) onNodeClick(cfgNode.line);
  }, [cfg, onNodeClick]);

  // ── Analysis mode: build graph from CFG with ELK layout ───────────────────

  useEffect(() => {
    if (!cfg?.nodes?.length) return;

    // New CFG starts with all nodes unexplored.

    const inferNodeType = (node: ControlFlowNode): FlowNodeType => {
      const lbl = String(node.label ?? '').toLowerCase();
      const code = String(node.code ?? '').toLowerCase();

      // Honor authoritative types from the CFG generator first — these are
      // produced by the AST visitor and are more reliable than label
      // pattern-matching, especially for `Func: main` / `Return` / etc.
      if (node.type === 'start' || node.type === 'end') return 'terminator';
      if (node.type === 'decision')                     return 'decision';
      if (node.type === 'output')                       return 'io';
      if (node.type === 'input')                        return 'manual_input';

      // Label/code-based inference for plain process nodes
      if (lbl === 'start' || lbl === 'end')                                    return 'terminator';
      if (code.includes('cin')    || code.includes('scanf')
       || lbl.includes('cin')     || lbl.includes('scanf'))                    return 'manual_input';
      if (code.includes('cout')   || code.includes('printf')
       || lbl.includes('cout')    || lbl.includes('printf')
       || lbl.includes('print')   || lbl.includes('output'))                   return 'io';
      if (lbl.includes('write')  || lbl.includes('file')
       || lbl.includes('document') || lbl.includes('report'))                  return 'document';
      if (lbl.includes('array')  || lbl.includes('vector')
       || lbl.includes('map')    || lbl.includes('database')
       || lbl.includes('store')  || lbl.includes('[]'))                        return 'database';
      if (lbl.includes('sleep')  || lbl.includes('delay')
       || lbl.includes('wait')   || lbl.includes('pause'))                     return 'delay';
      if ((lbl.includes('(') && lbl.includes(')'))
       || lbl.includes('call')   || lbl.includes('func'))                      return 'predefined';
      return 'process';
    };

    // Robustness guards before rendering:
    //  1. Dedupe node IDs (bad back-end output can produce collisions that crash React keys)
    //  2. Cap node count so massive graphs don't freeze the browser
    //  3. Drop edges referencing non-existent nodes
    const seenIds = new Set<string>();
    const safeNodes = cfg.nodes.filter(n => {
      if (!n?.id) return false;
      if (seenIds.has(n.id)) return false;
      seenIds.add(n.id);
      return true;
    });
    const hardCap = MAX_NODES_SAFE * 5; // absolute ceiling — we warn at MAX_NODES_SAFE already
    const capped = safeNodes.length > hardCap ? safeNodes.slice(0, hardCap) : safeNodes;
    const nodeIdSet = new Set(capped.map(n => n.id));

    const initialNodes: Node<ExtendedNodeData>[] = capped.map(node => ({
      id:   node.id,
      type: inferNodeType(node),
      data: {
        ...node,
        violation: safetyChecks.some(c => c.line === node.line && c.status === 'UNSAFE'),
        visited:   false,
        onHover:   setHoverInfo,
        onEdit:    handleOpenEdit,
      },
      position: { x: 0, y: 0 },
      draggable: true,
    }));

    const validCfgEdges = cfg.edges.filter(e => nodeIdSet.has(e.from) && nodeIdSet.has(e.to));
    const initialEdges: Edge[] = validCfgEdges.map((edge, i) => {
      const target       = capped.find(n => n.id === edge.to);
      const hasViolation = target && safetyChecks.some(c => c.line === target.line && c.status === 'UNSAFE');
      const isVisited    = false;
      const color = hasViolation ? '#ff4444' : isVisited ? '#4caf50' : '#64b5f6';
      return {
        id: `e-${i}`, source: edge.from, target: edge.to,
        label: edge.label, type: 'default',
        animated:       !!(hasViolation || isVisited),
        style:          { stroke: color, strokeWidth: hasViolation ? 3 : isVisited ? 2.5 : 2 },
        markerEnd:      { type: MarkerType.ArrowClosed, color, width: 20, height: 20 },
        labelStyle:     { fill: '#ffffff', fontSize: '11px', fontWeight: '600' },
        labelBgStyle:   { fill: '#0d1117', fillOpacity: 0.9, rx: 4, ry: 4 },
        labelBgPadding: [5, 8] as [number, number],
      };
    });

    elk.layout({
      id: 'root',
      layoutOptions: {
        'elk.algorithm':                             'layered',
        'elk.direction':                             'DOWN',
        'elk.spacing.nodeNode':                      '90',
        'elk.layered.spacing.nodeNodeBetweenLayers': '120',
        'elk.layered.nodePlacement.strategy':        'SIMPLE',
        'elk.edgeRouting':                           'ORTHOGONAL',
      },
      children: initialNodes.map(n => ({
        id: n.id,
        ...(NODE_SIZES[n.type as FlowNodeType] ?? NODE_SIZES.process),
      })),
      edges: initialEdges.map(e => ({
        id: e.id, sources: [e.source], targets: [e.target],
      })),
    })
      .then(layout => {
        const layouted = initialNodes.map(n => ({
          ...n,
          position: {
            x: layout.children?.find(c => c.id === n.id)?.x ?? 0,
            y: layout.children?.find(c => c.id === n.id)?.y ?? 0,
          },
        }));
        setNodes(layouted);
        setEdges(initialEdges);
        onGraphChange?.(layouted, initialEdges);
      })
      .catch(err => {
        console.error('ELK layout failed, falling back to vertical stack:', err);
        const fallback = initialNodes.map((n, i) => ({
          ...n,
          position: { x: 200, y: i * 160 },
        }));
        setNodes(fallback);
        setEdges(initialEdges);
        onGraphChange?.(fallback, initialEdges);
      });
  }, [cfg, safetyChecks]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived values ─────────────────────────────────────────────────────────

  const totalNodes = nodes.length;
  const visitedNodes = new Set(nodes.filter(n => n.data?.visited).map(n => n.id));
  const safeNodes  = nodes.filter(n => {
    const cfgNode = cfg?.nodes.find(cn => cn.id === n.id);
    return !cfgNode || !safetyChecks.some(c => c.line === cfgNode.line && c.status === 'UNSAFE');
  }).length;
  const isBuildMode = !cfg;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      onMouseMove={e => setMousePos({ x: e.clientX + 15, y: e.clientY + 15 })}
      style={{ width: '100%', height: '100%', position: 'relative', background: '#0d1117' }}
    >
      {/* Bottom-left: shape legend */}
      <FlowchartLegend isDrawerOpen={isDrawerOpen} />

      {/* Top-left: exploration + safety stats (analysis mode only) */}
      {!isBuildMode && (
        <GameStats
          visitedNodes={visitedNodes}
          totalNodes={totalNodes}
          safeNodes={safeNodes}
          isDrawerOpen={isDrawerOpen}
        />
      )}

      {/* Top-right: node palette + code generator — BUILD MODE ONLY */}
      {isBuildMode && (
        <div style={{
          position: 'absolute', top: 12, right: 12, zIndex: 1000,
          width: 230,
          display: 'flex', flexDirection: 'column', gap: 10,
          maxHeight: 'calc(100vh - 130px)',
          overflowY: 'auto', overflowX: 'visible',
          scrollbarWidth: 'thin',
          opacity:       isDrawerOpen ? 0.25 : 1,
          filter:        isDrawerOpen ? 'blur(2px)' : 'none',
          transition:    'all 0.3s ease',
          pointerEvents: isDrawerOpen ? 'none' : 'auto',
        }}>
          <NodePalette
            onAddNode={handleAddNode}
            onClearCanvas={handleClearCanvas}
            hasGeneratePanel
          />
          <GenerateCodePanel
            nodes={nodes}
            edges={edges}
            onCodeGenerated={onCodeGenerated}
            isDirty={isDirty}
            onMarkClean={() => setIsDirty(false)}
          />
        </div>
      )}

      {/* Large-graph warning banner */}
      {nodes.length > MAX_NODES_SAFE && (
        <div style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          zIndex: 50, background: 'rgba(227,179,65,0.12)', border: '1px solid rgba(227,179,65,0.4)',
          color: '#e3b341', padding: '6px 14px', borderRadius: 6,
          fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
          fontFamily: "'IBM Plex Mono', monospace",
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        }}>
          ⚠ Large graph ({nodes.length} nodes) — performance may degrade. Consider Lock + Zoom for navigation.
        </div>
      )}

      {/* Lock/Unlock toggle — bottom-right, above the React Flow zoom controls */}
      <button
        onClick={() => setIsLocked(l => !l)}
        title={isLocked ? 'Unlock — re-enable drag & pan' : 'Lock — freeze nodes & pan (zoom stays on)'}
        style={{
          position: 'absolute', bottom: 130, right: 12, zIndex: 1001,
          background: isLocked ? 'rgba(248,81,73,0.15)' : 'rgba(13,17,23,0.9)',
          border: `1px solid ${isLocked ? 'rgba(248,81,73,0.45)' : '#30363d'}`,
          color: isLocked ? '#f85149' : '#8b949e',
          padding: '7px 12px', borderRadius: 8,
          fontSize: 11, fontWeight: 700, letterSpacing: 0.6, cursor: 'pointer',
          fontFamily: "'IBM Plex Mono', monospace",
          display: 'flex', alignItems: 'center', gap: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
          transition: 'all 0.15s ease',
        }}
      >
        <span style={{ fontSize: 13 }}>{isLocked ? '🔒' : '🔓'}</span>
        {isLocked ? 'LOCKED' : 'UNLOCKED'}
      </button>

      {/* React Flow canvas */}
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={onNodesChangeHandler}
        onEdgesChange={onEdgesChangeHandler}
        onConnect={isBuildMode && !isLocked ? onConnectHandler : undefined}
        onNodeClick={handleNodeClick}
        onEdgeClick={isBuildMode && !isLocked ? handleEdgeClick : undefined}
        onEdgeDoubleClick={isBuildMode && !isLocked ? handleEdgeDoubleClick : undefined}
        fitView
        fitViewOptions={{ padding: 0.25, includeHiddenNodes: true, minZoom: 0.1, maxZoom: 1.0, duration: 800 }}
        nodesConnectable={isBuildMode && !isLocked} colorMode="dark"
        /* Lock freezes node drag + pan, but zoom stays on so users can still
           inspect large graphs. */
        nodesDraggable={isBuildMode && !isLocked}
        nodesFocusable={!isLocked}
        edgesFocusable={isBuildMode && !isLocked}
        panOnDrag={!isLocked}
        panOnScroll={false}
        selectionOnDrag={isBuildMode && !isLocked}
        selectionKeyCode={null}
        multiSelectionKeyCode="Shift"
        deleteKeyCode={isBuildMode && !isLocked ? 'Backspace' : null}
        /* Zoom always works — lock only freezes position/pan. */
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        minZoom={0.05} maxZoom={2}
        defaultEdgeOptions={{ type: 'default' }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1f2937" gap={16} size={1} style={{ opacity: 0.4 }} />
        <Controls
          showInteractive={false}
          position="bottom-right"
          style={{ background: 'rgba(13,17,23,0.9)', border: '1px solid #30363d', borderRadius: 8, bottom: 12, right: 12 }}
        />
      </ReactFlow>

      {/* Empty-canvas hint */}
      {nodes.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', gap: 12 }}>
          <div style={{ fontSize: 48, opacity: 0.12 }}>{isBuildMode ? '🗂' : '📊'}</div>
          <div style={{ fontSize: 13, color: '#484f58', textAlign: 'center', lineHeight: 1.9 }}>
            <strong style={{ color: '#30363d', display: 'block', marginBottom: 6 }}>The canvas is empty</strong>
            {isBuildMode ? (
              <>
                Use <strong style={{ color: '#58a6ff' }}>➕ ADD NODE</strong> — 11 ISO 5807 shapes are available.<br />
                Label decision edges <strong style={{ color: '#4caf50' }}>true</strong> / <strong style={{ color: '#ff6b6b' }}>false</strong>, then click <strong style={{ color: '#a855f7' }}>⚡ GENERATE C++</strong>.<br />
                <span style={{ fontSize: 10, color: '#3d444d' }}>💡 <strong style={{ color: '#e040fb' }}>Alt+click</strong> any edge to insert a Junction node at that point.</span>
              </>
            ) : (
              <>
                Run <strong style={{ color: '#4caf50' }}>ANALYZE CODE</strong> to auto-generate the Control Flow Graph from your source code.
              </>
            )}
          </div>
        </div>
      )}

      {/* Floating mentor tooltip */}
      {hoverInfo && (
        <div style={{ position: 'fixed', top: mousePos.y, left: mousePos.x, pointerEvents: 'none', zIndex: 9999, background: 'linear-gradient(135deg,#1e1e1e,#2d2d2d)', border: '2px solid #ffa726', borderRadius: 8, padding: 12, maxWidth: 300, boxShadow: '0 8px 24px rgba(0,0,0,0.6)', animation: 'fadeIn 0.2s ease-in-out' }}>
          <div style={{ color: '#ffa726', fontWeight: 'bold', fontSize: 10, textTransform: 'uppercase', marginBottom: 6, borderBottom: '1px solid #444', paddingBottom: 4 }}>💡 Mentor Tip</div>
          <div style={{ color: '#e0e0e0', fontSize: 12, lineHeight: 1.5 }}>{hoverInfo}</div>
        </div>
      )}

      {/* Modals */}
      {editState     && <NodeEditor      editState={editState}     onSave={handleSaveEdit}      onCancel={() => setEditState(null)}     />}
      {edgeEditState && <EdgeLabelEditor editState={edgeEditState} onSave={handleSaveEdgeLabel} onCancel={() => setEdgeEditState(null)} />}

      {/* Global CSS */}
      <style>{`
        @keyframes nodePulse     { 0%,100%{transform:scale(1)}      50%{transform:scale(1.04)} }
        @keyframes bounce        { 0%,100%{transform:translateY(0)}  50%{transform:translateY(-6px)} }
        @keyframes fadeIn        { from{opacity:0;transform:translateY(4px)}  to{opacity:1;transform:translateY(0)} }
        @keyframes editorSlideIn { from{opacity:0;transform:translateY(-10px) scale(0.97)} to{opacity:1;transform:none} }

        .flow-node:hover                                { transform:translateY(-2px); }
        .editable-node:hover .edit-hint                { opacity:1 !important; }
        .react-flow__node                              { cursor:grab !important; }
        .react-flow__node.dragging                     { cursor:grabbing !important; }
        .react-flow__edge-path                         { stroke-linecap:round; stroke-linejoin:round; }
        .react-flow__edge:hover .react-flow__edge-path { stroke-width:3 !important; cursor:pointer; }
      `}</style>
    </div>
  );
};

// ── Provider wrapper ──────────────────────────────────────────────────────────
// useReactFlow() (used in FlowGraphInner for mid-segment anchoring) must be
// called inside a ReactFlowProvider subtree. Wrapping here keeps the public
// API unchanged — callers still import { FlowGraph }.
export const FlowGraph: React.FC<Props> = (props) => (
  <ReactFlowProvider>
    <FlowGraphInner {...props} />
  </ReactFlowProvider>
);