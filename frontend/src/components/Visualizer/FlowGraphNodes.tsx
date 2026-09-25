import React from 'react'
import { Handle, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
import type { ExtendedNodeData } from './flowGraphTypes'
import {
  handleStyle,
  useNodeAppearance,
} from './FlowGraphNodeConfig'

export const BaseNode: React.FC<{
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
export const EditHint = () => (
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
export const ViolationBadge = () => (
  <div
    role="img"
    aria-label="Safety violation detected on this node"
    style={{
      position: 'absolute', top: -20, left: '50%',
      transform: 'translateX(-50%)',
      fontSize: 16, animation: 'bounce 1s ease-in-out infinite', zIndex: 10,
    }}
    title="Safety violation detected on this node"
  >
    ⚠️
  </div>
);

/** Label block rendered inside rectangular/box-type nodes. */
export const NodeLabel: React.FC<{ data: ExtendedNodeData }> = ({ data }) => (
  <div style={{ pointerEvents: 'none', userSelect: 'none', textAlign: 'center', width: '100%', minWidth: 0 }}>
    <strong style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'white', letterSpacing: '0.3px', textShadow: '0 2px 3px rgba(0,0,0,0.6)', overflowWrap: 'anywhere', lineHeight: 1.25 }}>
      {String(data.label ?? '')}
    </strong>
    {data.code && (
      <code style={{ display: 'block', fontSize: 10, marginTop: 5, fontFamily: "'JetBrains Mono','Fira Code',monospace", background: 'rgba(0,0,0,0.4)', padding: '5px 7px', borderRadius: 4, color: 'rgba(255,255,255,0.9)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word', lineHeight: 1.45, maxWidth: '100%', boxSizing: 'border-box' }}>
        {String(data.code)}
      </code>
    )}
  </div>
);

function isReturnLikeNode(data: ExtendedNodeData): boolean {
  const label = String(data.label ?? '').trim().toLowerCase();
  const code = String(data.code ?? '').trim().toLowerCase();
  return label === 'return' || code === 'return' || code.startsWith('return ');
}

// ─────────────────────────────────────────────────────────────────────────────
// §4  ISO 5807 NODE COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. TERMINATOR — rounded pill ─────────────────────────────────────────────
export const TerminatorNode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const returnLike = isReturnLikeNode(data);
  const { color, bg } = useNodeAppearance(returnLike ? 'process' : 'terminator', data);
  const background = bg ?? (returnLike
    ? 'linear-gradient(135deg,#141a14,#1e271e)'
    : 'linear-gradient(135deg,#0d47a1,#1565c0)');
  if (returnLike) {
    return (
      <BaseNode data={data} selected={selected} style={{ padding: '16px 18px', minWidth: 190, maxWidth: 260, background, border: `2.5px solid ${color}`, borderRadius: 4, boxShadow: `0 3px 14px ${color}33` }}>
        <EditHint />
        {data.violation && <ViolationBadge />}
        <Handle type="target" position={Position.Top}    style={handleStyle(color)} />
        <NodeLabel data={data} />
        <Handle type="source" id="bottom" position={Position.Bottom} style={handleStyle(color)} />
      </BaseNode>
    );
  }

  return (
    <BaseNode data={data} selected={selected} style={{ width: 200, minHeight: 56, padding: '8px 18px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', background, border: `2.5px solid ${color}`, borderRadius: 999, boxShadow: `0 4px 20px ${color}55` }}>
      <EditHint />
      {data.violation && <ViolationBadge />}
      <Handle type="target" position={Position.Top}    style={{ ...handleStyle(color), top: -6 }} />
      <span style={{ pointerEvents: 'none', userSelect: 'none', fontSize: 12, fontWeight: 700, color: 'white', letterSpacing: '0.5px', textShadow: '0 2px 4px rgba(0,0,0,0.5)', overflowWrap: 'anywhere', textAlign: 'center', lineHeight: 1.25 }}>
        {String(data.label ?? '')}
      </span>
      <Handle type="source" id="bottom" position={Position.Bottom} style={{ ...handleStyle(color), bottom: -6 }} />
    </BaseNode>
  );
};

// ── 2. PROCESS — plain rectangle ─────────────────────────────────────────────
export const ProcessNode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const { color, bg } = useNodeAppearance('process', data);
  const background = bg ?? 'linear-gradient(135deg,#141a14,#1e271e)';
  return (
    <BaseNode data={data} selected={selected} style={{ padding: '16px 18px', minWidth: 190, maxWidth: 260, background, border: `2.5px solid ${color}`, borderRadius: 4, boxShadow: `0 3px 14px ${color}33` }}>
      <EditHint />
      {data.violation && <ViolationBadge />}
      <Handle type="target" position={Position.Top}    style={handleStyle(color)} />
      <NodeLabel data={data} />
      <Handle type="source" id="bottom" position={Position.Bottom} style={handleStyle(color)} />
    </BaseNode>
  );
};

// ── 3. DECISION — true diamond via SVG ───────────────────────────────────────
export const DecisionNode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const W = 170, H = 170;
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
      <Handle type="source" id="bottom" position={Position.Bottom} style={{ ...handleStyle(color), bottom: 0, left: '50%', transform: 'translateX(-50%)' }} />
      <Handle type="source" id="right" position={Position.Right} style={{ ...handleStyle(color), right: 0, top: '50%', transform: 'translateY(-50%)' }} />
      <Handle type="source" id="left"  position={Position.Left}  style={{ ...handleStyle(color), left: 0,  top: '50%', transform: 'translateY(-50%)' }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'white', textAlign: 'center', maxWidth: 112, lineHeight: 1.35, textShadow: '0 2px 4px rgba(0,0,0,0.7)', overflowWrap: 'anywhere' }}>
          {String(data.label ?? 'Condition')}
        </span>
      </div>
    </BaseNode>
  );
};

// ── 4. I/O — parallelogram ───────────────────────────────────────────────────
export const IONode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const W = 260, H = 92, SKEW = 26;
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
      <Handle type="source" id="bottom" position={Position.Bottom} style={{ ...handleStyle(color), zIndex: 5, left: W / 2 - SKEW / 2 }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1, padding: `10px ${SKEW + 12}px 10px ${SKEW}px`, boxSizing: 'border-box' }}>
        <NodeLabel data={data} />
      </div>
    </BaseNode>
  );
};

// ── 5. PREDEFINED — rectangle with ISO side bars ─────────────────────────────
export const PredefinedNode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const { color, bg } = useNodeAppearance('predefined', data);
  const background = bg ?? 'linear-gradient(135deg,#18091f,#271040)';
  return (
    <BaseNode data={data} selected={selected} style={{ padding: '16px 36px', minWidth: 220, maxWidth: 285, background, border: `2.5px solid ${color}`, borderRadius: 4, boxShadow: `0 3px 14px ${color}33` }}>
      <div style={{ position: 'absolute', left: 16, top: 2, bottom: 2, width: 2, background: color, opacity: 0.9, borderRadius: 1 }} />
      <div style={{ position: 'absolute', right: 16, top: 2, bottom: 2, width: 2, background: color, opacity: 0.9, borderRadius: 1 }} />
      <EditHint />
      {data.violation && <ViolationBadge />}
      <Handle type="target" position={Position.Top}    style={handleStyle(color)} />
      <NodeLabel data={data} />
      <Handle type="source" id="bottom" position={Position.Bottom} style={handleStyle(color)} />
    </BaseNode>
  );
};

// ── 6. CONNECTOR — small circle ──────────────────────────────────────────────
export const ConnectorNode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const { color, bg } = useNodeAppearance('connector', data);
  const background = bg ?? 'linear-gradient(135deg,#042a2e,#073540)';
  return (
    <BaseNode data={data} selected={selected} style={{ width: 76, height: 76, borderRadius: '50%', background, border: `2.5px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 3px 16px ${color}55`, padding: 8, boxSizing: 'border-box' }}>
      <EditHint />
      {data.violation && <ViolationBadge />}
      <Handle type="target" position={Position.Top}    style={handleStyle(color)} />
      <span style={{ color: 'white', fontSize: 13, fontWeight: 800, pointerEvents: 'none', textAlign: 'center', overflowWrap: 'anywhere', lineHeight: 1.2 }}>
        {String(data.label ?? 'A')}
      </span>
      <Handle type="source" id="bottom" position={Position.Bottom} style={handleStyle(color)} />
    </BaseNode>
  );
};

// ── 6b. OFF-PAGE CONNECTOR — pentagon / home-plate ───────────────────────────
export const OffPageConnectorNode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const W = 96, H = 88;
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
        <span style={{ color: 'white', fontSize: 12, fontWeight: 800, textShadow: '0 2px 4px rgba(0,0,0,0.6)', display: 'block', maxWidth: W - 24, textAlign: 'center', overflowWrap: 'anywhere', lineHeight: 1.2 }}>
          {String(data.label ?? '1')}
        </span>
      </div>
      <Handle type="source" id="bottom" position={Position.Bottom} style={{ ...handleStyle(color), bottom: 0, zIndex: 5 }} />
    </BaseNode>
  );
};

// ── 7. DOCUMENT — rectangle with wavy bottom ─────────────────────────────────
export const DocumentNode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const W = 260, H = 118;
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
      <div style={{ position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%,-50%)', width: W - 46, zIndex: 1 }}>
        <NodeLabel data={data} />
      </div>
      <Handle type="source" id="bottom" position={Position.Bottom} style={{ ...handleStyle(color), bottom: 10, zIndex: 5 }} />
    </BaseNode>
  );
};

// ── 8. MANUAL INPUT — trapezoid, top slopes upward left-to-right ─────────────
export const ManualInputNode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const W = 240, H = 92, SLOPE = 22;
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
      <div style={{ position: 'absolute', top: '55%', left: '50%', transform: 'translate(-50%,-50%)', width: W - 46, zIndex: 1 }}>
        <NodeLabel data={data} />
      </div>
      <Handle type="source" id="bottom" position={Position.Bottom} style={{ ...handleStyle(color), zIndex: 5 }} />
    </BaseNode>
  );
};

// ── 9. DELAY — D-shape: flat left, semicircle right ──────────────────────────
export const DelayNode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const W = 240, H = 88;
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
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1, padding: `10px ${R}px 10px 16px`, boxSizing: 'border-box' }}>
        <NodeLabel data={data} />
      </div>
      <Handle type="source" id="bottom" position={Position.Bottom} style={{ ...handleStyle(color), zIndex: 5 }} />
    </BaseNode>
  );
};

// ── 10. DATABASE — cylinder ───────────────────────────────────────────────────
export const DatabaseNode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const W = 240, H = 118;
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
      <Handle type="source" id="bottom" position={Position.Bottom} style={{ ...handleStyle(color), zIndex: 5 }} />
    </BaseNode>
  );
};

// ── 11. JUNCTION — small routing connector / merge point ─────────────────────
export const JunctionNode = ({ data, selected }: NodeProps<Node<ExtendedNodeData>>) => {
  const S = 36;
  const { color } = useNodeAppearance('junction', data);
  const fill = data.violation ? '#2d0820' : data.visited ? '#1a0d2e' : '#1a0820';
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
        <circle
          cx={S / 2}
          cy={S / 2}
          r={S / 2 - 4}
          fill={fill}
          stroke={color}
          strokeWidth={selected ? 2.5 : 2}
        />
        <circle cx={S/2} cy={S/2} r={4} fill={color} opacity={0.9} />
      </svg>
      <Handle type="target" position={Position.Top}    id="t" style={{ ...handleStyle(color), top: -2,    left: '50%', transform: 'translateX(-50%)' }} />
      <Handle type="target" position={Position.Left}   id="l" style={{ ...handleStyle(color), left: -2,   top: '50%',  transform: 'translateY(-50%)' }} />
      <Handle type="source" position={Position.Bottom} id="b" style={{ ...handleStyle(color), bottom: -2, left: '50%', transform: 'translateX(-50%)' }} />
      <Handle type="source" position={Position.Right}  id="r" style={{ ...handleStyle(color), right: -2,  top: '50%',  transform: 'translateY(-50%)' }} />
    </BaseNode>
  );
};
