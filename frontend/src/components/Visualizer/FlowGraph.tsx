/**
 FlowGraph.tsx
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ReactFlow, Background, Controls, ConnectionMode, MarkerType,
  applyNodeChanges, applyEdgeChanges, addEdge,
  useReactFlow, ReactFlowProvider,
} from '@xyflow/react';
import type { Connection, Edge, Node, NodeChange, EdgeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { CFG, SafetyCheck, ControlFlowNode } from '@/types';
import type { EditState, EdgeEditState, ExtendedNodeData, FlowNodeType } from './flowGraphTypes';
import {
  BUILD_PALETTE_ITEMS,
  DEFAULT_LABELS,
  EMPTY_SAFETY_CHECKS,
  findLooseEndpoint,
  flowEdge,
  newNodeId,
} from './FlowGraphNodeConfig'
import { nodeTypes } from './FlowGraphNodeRegistry'
import {
  EdgeLabelEditor,
  FlowchartLegend,
  FlowchartQuickGuide,
  GameStats,
  GenerateCodePanel,
  NodeEditor,
  NodePalette,
} from './FlowGraphPanels'

// ── Component props ───────────────────────────────────────────────────────────
interface Props {
  cfg?:             CFG;
  safetyChecks?:    SafetyCheck[];
  onNodeClick?:     (line: number) => void;
  isDrawerOpen?:    boolean;
  onGraphChange?:   (nodes: Node<ExtendedNodeData>[], edges: Edge[]) => void;
  onCodeGenerated?: (code: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// §7  MAIN FlowGraph COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

const MAX_NODES_SAFE = 200;

const FlowGraphInner: React.FC<Props> = ({
  cfg,
  // FIX: do NOT use = [] here — that creates a new array reference on every
  // render, causing the useEffect([cfg, safetyChecks]) dependency to always
  // fire, which calls setEdges, which triggers another render, infinite loop.
  // Instead we resolve to EMPTY_SAFETY_CHECKS (stable module-level constant).
  safetyChecks,
  onNodeClick,
  isDrawerOpen = false,
  onGraphChange,
  onCodeGenerated,
}) => {
  // Resolve to stable empty array if prop is undefined/null
  const stableSafetyChecks = safetyChecks ?? EMPTY_SAFETY_CHECKS;

  const [nodes, setNodes]                 = useState<Node<ExtendedNodeData>[]>([]);
  const [edges, setEdges]                 = useState<Edge[]>([]);
  const [isLocked, setIsLocked]           = useState(false);
  const [showPanel, setShowPanel]         = useState(true);
  const [showGuide, setShowGuide]         = useState(false);
  const [hoverInfo, setHoverInfo]         = useState<string | null>(null);
  const [mousePos,  setMousePos]          = useState({ x: 0, y: 0 });
  const [editState,     setEditState]     = useState<EditState | null>(null);
  const [edgeEditState, setEdgeEditState] = useState<EdgeEditState | null>(null);
  const [isDirty, setIsDirty]             = useState(false);

  const { screenToFlowPosition } = useReactFlow();

  // ── Mid-segment anchoring ──────────────────────────────────────────────────
  const handleEdgeClick = useCallback((evt: React.MouseEvent, edge: Edge) => {
    if (!evt.altKey) return;
    evt.preventDefault();
    evt.stopPropagation();

    const flowPos = screenToFlowPosition({ x: evt.clientX, y: evt.clientY });
    const junctionId = `junction-${Date.now()}`;

    const junctionNode: Node<ExtendedNodeData> = {
      id:   junctionId,
      type: 'junction',
      position: { x: flowPos.x - 18, y: flowPos.y - 18 },
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

    const edgeA: Edge = {
      id:     `${junctionId}-a`,
      source: edge.source,
      sourceHandle: edge.sourceHandle ?? undefined,
      target: junctionId,
      label:  edge.label ?? '',
      ...sharedOpts,
    };
    const edgeB: Edge = {
      id:     `${junctionId}-b`,
      source: junctionId,
      target: edge.target,
      targetHandle: edge.targetHandle ?? undefined,
      ...sharedOpts,
    };

    setNodes(nds => [...nds, junctionNode]);
    setEdges(eds => {
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
    const rawLabel = newLabel.trim();
    const lowerLabel = rawLabel.toLowerCase();
    const normalizedLabel = ['true', 'yes', 'false', 'no'].includes(lowerLabel) ? lowerLabel : rawLabel;
    const isTrue  = normalizedLabel === 'true'  || normalizedLabel === 'yes';
    const isFalse = normalizedLabel === 'false' || normalizedLabel === 'no';
    const edgeColor = isTrue ? '#4caf50' : isFalse ? '#ff4444' : '#64b5f6';

    setEdges(current => {
      const next = current.map(e =>
        e.id !== edgeEditState.edgeId ? e : {
          ...e,
          label: normalizedLabel,
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
    const autoSource = findLooseEndpoint(nodes, edges);
    const hasStart = nodes.some(
      n => n.type === 'terminator' && String(n.data.label ?? '').toLowerCase() === 'start'
    );
    const initialLabel = (type === 'terminator' && hasStart) ? 'End' : DEFAULT_LABELS[type];
    const position = autoSource
      ? { x: autoSource.position.x, y: autoSource.position.y + 150 }
      : { x: 220 + Math.random() * 160, y: 80 + nodes.length * 30 };

    setNodes(current => {
      const newNode: Node<ExtendedNodeData> = {
        id, type,
        position,
        data: {
          id, label: initialLabel, code: '', line: -1,
          onHover: setHoverInfo,
          onEdit:  handleOpenEdit,
        } as ExtendedNodeData,
        draggable: true,
      };
      return [...current, newNode];
    });
    if (autoSource) {
      setEdges(current => {
        const next = [...current, flowEdge(autoSource.id, id)];
        setNodes(nds => { onGraphChange?.(nds, next); return nds; });
        return next;
      });
    }

    setTimeout(() => {
      setNodes(current => {
        const node = current.find(n => n.id === id);
        if (node) {
          setEditState({ nodeId: id, label: initialLabel, code: '', type });
        }
        return current;
      });
    }, 50);

    setIsDirty(true);
  }, [edges, handleOpenEdit, nodes, onGraphChange]);

  // ── React Flow change handlers ─────────────────────────────────────────────

  const onNodesChangeHandler = useCallback((changes: NodeChange<Node<ExtendedNodeData>>[]) => {
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
    if (!params.source || !params.target || params.source === params.target) return;
    setEdges(eds => {
      const alreadyExists = eds.some(edge =>
        edge.source === params.source &&
        edge.target === params.target &&
        (edge.sourceHandle ?? null) === (params.sourceHandle ?? null) &&
        (edge.targetHandle ?? null) === (params.targetHandle ?? null)
      );
      if (alreadyExists) return eds;

      const sourceNode = nodes.find(n => n.id === params.source);
      const targetNode = nodes.find(n => n.id === params.target);
      const outgoingFromSource = eds.filter(edge => edge.source === params.source);
      const isDecisionEdge = sourceNode?.type === 'decision';
      const isFunctionCallEdge = sourceNode?.type === 'predefined' && targetNode?.type === 'predefined';
      let edgeLabel: string | undefined;

      if (isDecisionEdge) {
        const labels = new Set(outgoingFromSource.map(edge => String(edge.label ?? '').toLowerCase()));
        if (params.sourceHandle === 'left') {
          edgeLabel = 'false';
        } else if (params.sourceHandle === 'right') {
          edgeLabel = 'true';
        } else {
          edgeLabel = labels.has('true') || labels.has('yes') ? 'false' : 'true';
        }

        if ((edgeLabel === 'true' && (labels.has('true') || labels.has('yes'))) ||
            (edgeLabel === 'false' && (labels.has('false') || labels.has('no')))) {
          edgeLabel = labels.has('true') || labels.has('yes') ? 'false' : 'true';
        }
      } else if (isFunctionCallEdge) {
        edgeLabel = 'calls';
      }

      const isTrue = edgeLabel === 'true';
      const isFalse = edgeLabel === 'false';
      const edgeColor = isTrue ? '#4caf50' : isFalse ? '#ff4444' : '#64b5f6';
      const next = addEdge({
        ...params,
        targetHandle:   isFunctionCallEdge ? 'bottom' : params.targetHandle,
        label:          edgeLabel,
        type:           'default',
        markerEnd:      { type: MarkerType.ArrowClosed, color: edgeColor },
        style:          { stroke: edgeColor, strokeWidth: 2 },
        labelStyle:     { fill: isTrue ? '#4caf50' : isFalse ? '#ff6b6b' : '#ffffff', fontSize: '11px', fontWeight: '700' },
        labelBgStyle:   { fill: '#0d1117', fillOpacity: 0.9 },
        labelBgPadding: [5, 8] as [number, number],
      }, eds);
      setNodes(nds => { onGraphChange?.(nds, next); return nds; });
      setIsDirty(true);
      return next;
    });
  }, [nodes, onGraphChange]);

  // ── Node click → mark as visited ──────────────────────────────────────────

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node<ExtendedNodeData>) => {
    setNodes(current =>
      current.map(n => n.id === node.id ? { ...n, data: { ...n.data, visited: true } } : n)
    );
    // FIX: use stableSafetyChecks (not the raw prop) so this closure stays stable
    const cfgNode = cfg?.nodes.find(n => n.id === node.id);
    if (cfgNode?.line != null && onNodeClick) onNodeClick(cfgNode.line);
  }, [cfg, onNodeClick]);

  // ── Analysis mode: build graph from CFG with ELK layout ───────────────────

  useEffect(() => {
    let cancelled = false;
    const applyGraph = (nextNodes: Node<ExtendedNodeData>[], nextEdges: Edge[]) => {
      queueMicrotask(() => {
        if (cancelled) return;
        setNodes(nextNodes);
        setEdges(nextEdges);
        onGraphChange?.(nextNodes, nextEdges);
      });
    };

    if (!cfg?.nodes?.length) {
      applyGraph([], []);
      return () => { cancelled = true; };
    }

    const inferNodeType = (node: ControlFlowNode): FlowNodeType => {
      const lbl  = String(node.label ?? '').toLowerCase();
      const code = String(node.code  ?? '').toLowerCase();
      const isReturnStatement = lbl === 'return' || code.startsWith('return');
      const isFunctionBoundary = lbl.startsWith('function:') || lbl.startsWith('end:');

      if (isReturnStatement)                         return 'process';
      if (isFunctionBoundary)                        return 'predefined';
      if (node.type === 'start' || node.type === 'end') return 'terminator';
      if (node.type === 'decision')                     return 'decision';
      if (node.type === 'output')                       return 'io';
      if (node.type === 'input')                        return 'manual_input';
      if (node.type === 'process')                      return 'process';
      if (node.type === 'junction')                     return 'junction';
      if (node.type === 'connector')                    return 'connector';
      if (node.type === 'off_page_connector')           return 'off_page_connector';
      if (node.type === 'predefined')                   return 'predefined';
      if (node.type === 'document')                     return 'document';
      if (node.type === 'delay')                        return 'delay';
      if (node.type === 'database')                     return 'database';

      if (lbl === 'start' || lbl === 'end')                                    return 'terminator';
      if (code.includes('cin')    || code.includes('scanf')
       || lbl.includes('cin')     || lbl.includes('scanf'))                    return 'manual_input';
      if (code.includes('cout')   || code.includes('printf')
       || lbl.includes('cout')    || lbl.includes('printf')
       || lbl.includes('print')   || lbl.includes('output'))                   return 'io';
      if (code.includes('ofstream') || code.includes('ifstream') || code.includes('fstream')
       || lbl.includes('write')  || lbl.includes('file')
       || lbl.includes('document') || lbl.includes('report'))                  return 'document';
      if (code.includes('new ') || code.includes('delete') || /\[[^\]]*\]/.test(code)
       || lbl.includes('array')  || lbl.includes('vector')
       || lbl.includes('map')    || lbl.includes('database')
       || lbl.includes('store')  || lbl.includes('[]'))                        return 'database';
      if (code.includes('sleep') || code.includes('sleep_for')
       || lbl.includes('sleep')  || lbl.includes('delay')
       || lbl.includes('wait')   || lbl.includes('pause'))                     return 'delay';
      if ((lbl.includes('(') && lbl.includes(')'))
       || lbl.includes('call')   || lbl.includes('func'))                      return 'predefined';
      return 'process';
    };

    const seenIds = new Set<string>();
    const safeNodes = cfg.nodes.filter(n => {
      if (!n?.id) return false;
      if (seenIds.has(n.id)) return false;
      seenIds.add(n.id);
      return true;
    });
    const hardCap = MAX_NODES_SAFE * 5;
    const capped = safeNodes.length > hardCap ? safeNodes.slice(0, hardCap) : safeNodes;
    const nodeIdSet = new Set(capped.map(n => n.id));

    // Use Sugiyama x/y computed by the backend's CFGGenerator directly.
    // The backend runs the full Sugiyama pipeline (break cycles → assign layers
    // → minimize crossings → compute coordinates → restore cycles) and stores
    // the result in node.x / node.y.  We trust those coordinates here instead
    // of running a second layout pass in the browser.
    const initialNodes: Node<ExtendedNodeData>[] = capped.map(node => ({
      id:   node.id,
      type: inferNodeType(node),
      data: {
        ...node,
        violation: stableSafetyChecks.some(c => c.line === node.line && c.status === 'UNSAFE'),
        visited:   false,
        onHover:   setHoverInfo,
        onEdit:    handleOpenEdit,
      },
      // node.x / node.y come from the backend Sugiyama layout.
      // Fall back to a simple vertical stack only when coordinates are missing.
      position: (node.x != null && node.y != null)
        ? { x: node.x, y: node.y }
        : { x: 200, y: capped.indexOf(node) * 220 },
      draggable: true,
    }));

    const validCfgEdges = cfg.edges.filter(e => nodeIdSet.has(e.from) && nodeIdSet.has(e.to));
    const nodeTypeById = new Map(initialNodes.map(node => [node.id, node.type]));
    const initialEdges: Edge[] = validCfgEdges.map((edge, i) => {
      const target       = capped.find(n => n.id === edge.to);
      const hasViolation = target && stableSafetyChecks.some(c => c.line === target.line && c.status === 'UNSAFE');
      const label = String(edge.label ?? '').trim().toLowerCase();
      const isTrueEdge = label === 'true' || label === 'yes';
      const isFalseEdge = label === 'false' || label === 'no';
      const isCallsEdge = label === 'calls'
        && nodeTypeById.get(edge.from) === 'predefined'
        && nodeTypeById.get(edge.to) === 'predefined';
      const color = hasViolation
        ? '#ff4444'
        : isTrueEdge
        ? '#4caf50'
        : isFalseEdge
        ? '#ff4444'
        : '#64b5f6';
      const labelColor = isTrueEdge
        ? '#4caf50'
        : isFalseEdge
        ? '#ff6b6b'
        : '#ffffff';
      return {
        id: `e-${i}`, source: edge.from, target: edge.to,
        sourceHandle: isCallsEdge ? 'bottom' : undefined,
        targetHandle: isCallsEdge ? 'bottom' : undefined,
        label: edge.label, type: 'default',
        animated:       !!hasViolation,
        style:          { stroke: color, strokeWidth: hasViolation ? 3 : 2 },
        markerEnd:      { type: MarkerType.ArrowClosed, color, width: 20, height: 20 },
        labelStyle:     { fill: labelColor, fontSize: '11px', fontWeight: '700' },
        labelBgStyle:   { fill: '#0d1117', fillOpacity: 0.9, rx: 4, ry: 4 },
        labelBgPadding: [5, 8] as [number, number],
      };
    });

    applyGraph(initialNodes, initialEdges);
    return () => { cancelled = true; };
  // FIX: depend on stableSafetyChecks (stable ref) instead of safetyChecks (new [] each render)
  }, [cfg, handleOpenEdit, stableSafetyChecks, onGraphChange]);

  // ── Derived values ─────────────────────────────────────────────────────────

  const totalNodes   = nodes.length;
  const visitedNodes = new Set(nodes.filter(n => n.data?.visited).map(n => n.id));
  const safeNodes    = nodes.filter(n => {
    const cfgNode = cfg?.nodes.find(cn => cn.id === n.id);
    // FIX: use stableSafetyChecks consistently
    return !cfgNode || !stableSafetyChecks.some(c => c.line === cfgNode.line && c.status === 'UNSAFE');
  }).length;
  const isBuildMode = !cfg;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      onMouseMove={e => setMousePos({ x: e.clientX + 15, y: e.clientY + 15 })}
      style={{ width: '100%', height: '100%', position: 'relative', background: '#0d1117' }}
    >
      <FlowchartLegend isBuildMode={isBuildMode} graphNodes={nodes} isDrawerOpen={isDrawerOpen} />

      {!isBuildMode && (
        <GameStats
          visitedNodes={visitedNodes}
          totalNodes={totalNodes}
          safeNodes={safeNodes}
          isDrawerOpen={isDrawerOpen}
        />
      )}

      {isBuildMode && (
        <>
          <button
            onClick={() => setShowGuide(v => !v)}
            title={showGuide ? 'Hide quick flowchart manual' : 'Show quick flowchart manual'}
            style={{
              position: 'absolute', top: 12, left: 12, zIndex: 1001,
              background: showGuide ? 'rgba(88,166,255,0.16)' : 'rgba(13,17,23,0.9)',
              border: `1px solid ${showGuide ? 'rgba(88,166,255,0.45)' : '#30363d'}`,
              color: showGuide ? '#58a6ff' : '#8b949e',
              padding: '7px 12px', borderRadius: 8,
              fontSize: 11, fontWeight: 700, letterSpacing: 0.6, cursor: 'pointer',
              fontFamily: "'IBM Plex Mono', monospace",
              boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
              opacity:       isDrawerOpen ? 0.25 : 1,
              filter:        isDrawerOpen ? 'blur(2px)' : 'none',
              pointerEvents: isDrawerOpen ? 'none' : 'auto',
            }}
          >
            ? GUIDE
          </button>
          {showGuide && !isDrawerOpen && <FlowchartQuickGuide onClose={() => setShowGuide(false)} />}

          {/* Single toggle — always visible, controls the whole panel */}
          <button
            onClick={() => setShowPanel(v => !v)}
            title={showPanel ? 'Hide tools panel' : 'Show tools panel'}
            style={{
              position: 'absolute', top: 12, right: 12, zIndex: 1001,
              background: 'linear-gradient(135deg,rgba(13,17,23,0.98),rgba(22,27,34,0.98))',
              border: '2px solid #30363d',
              color: '#58a6ff',
              padding: '7px 14px', borderRadius: 10,
              fontSize: 11, fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer',
              fontFamily: "'IBM Plex Mono', monospace",
              display: 'flex', alignItems: 'center', gap: 7,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              transition: 'all 0.2s ease',
              opacity:       isDrawerOpen ? 0.25 : 1,
              filter:        isDrawerOpen ? 'blur(2px)' : 'none',
              pointerEvents: isDrawerOpen ? 'none' : 'auto',
            }}
          >
            <span style={{ fontSize: 13 }}>☰</span>
            TOOLS
            <span style={{ fontSize: 9, transition: 'transform 0.25s', transform: showPanel ? 'rotate(180deg)' : 'none' }}>▼</span>
          </button>

          {/* Collapsible tools panel */}
          {showPanel && (
            <div style={{
              position: 'absolute', top: 52, right: 12, zIndex: 1000,
              width: 'min(340px, calc(100vw - 32px))',
              display: 'flex', flexDirection: 'column', gap: 10,
              maxHeight: 'calc(100vh - 170px)',
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
        </>
      )}

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

      <button
        onClick={() => setIsLocked(l => !l)}
        title={isLocked ? 'Unlock — re-enable drag & pan' : 'Lock — freeze nodes & pan (zoom stays on)'}
        style={{
          position: 'absolute',
          ...(isBuildMode ? { top: 12, left: 92 } : { bottom: 70, left: 12 }),
          zIndex: 1001,
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

      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        onNodesChange={onNodesChangeHandler}
        onEdgesChange={onEdgesChangeHandler}
        onConnect={isBuildMode && !isLocked ? onConnectHandler : undefined}
        onNodeClick={handleNodeClick}
        onEdgeClick={isBuildMode && !isLocked ? handleEdgeClick : undefined}
        onEdgeDoubleClick={isBuildMode && !isLocked ? handleEdgeDoubleClick : undefined}
        fitView
        fitViewOptions={{ padding: 0.25, includeHiddenNodes: true, minZoom: 0.1, maxZoom: 1.0, duration: 800 }}
        nodesConnectable={isBuildMode && !isLocked} colorMode="dark"
        nodesDraggable={isBuildMode && !isLocked}
        nodesFocusable={!isLocked}
        edgesFocusable={isBuildMode && !isLocked}
        panOnDrag={!isLocked}
        panOnScroll={false}
        panActivationKeyCode={null}
        selectionOnDrag={isBuildMode && !isLocked}
        selectionKeyCode={null}
        multiSelectionKeyCode="Shift"
        deleteKeyCode={isBuildMode && !isLocked ? 'Backspace' : null}
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

      {nodes.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', gap: 12 }}>
          <div style={{ fontSize: 48, opacity: 0.12 }}>{isBuildMode ? '🗂' : '📊'}</div>
          <div style={{ fontSize: 13, color: '#484f58', textAlign: 'center', lineHeight: 1.9 }}>
            <strong style={{ color: '#30363d', display: 'block', marginBottom: 6 }}>The canvas is empty</strong>
            {isBuildMode ? (
              <>
                Use <strong style={{ color: '#58a6ff' }}>➕ ADD NODE</strong> — {BUILD_PALETTE_ITEMS.length} Generate C++ shapes are available.<br />
                Use one decision edge for a single-arm <strong>if</strong>, or label two branches <strong style={{ color: '#4caf50' }}>true</strong> / <strong style={{ color: '#ff6b6b' }}>false</strong>, then click <strong style={{ color: '#a855f7' }}>⚡ GENERATE C++</strong>.<br />
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

      {hoverInfo && (
        <div style={{ position: 'fixed', top: mousePos.y, left: mousePos.x, pointerEvents: 'none', zIndex: 9999, background: 'linear-gradient(135deg,#1e1e1e,#2d2d2d)', border: '2px solid #ffa726', borderRadius: 8, padding: 12, maxWidth: 300, boxShadow: '0 8px 24px rgba(0,0,0,0.6)', animation: 'fadeIn 0.2s ease-in-out' }}>
          <div style={{ color: '#ffa726', fontWeight: 'bold', fontSize: 10, textTransform: 'uppercase', marginBottom: 6, borderBottom: '1px solid #444', paddingBottom: 4 }}>💡 Mentor Tip</div>
          <div style={{ color: '#e0e0e0', fontSize: 12, lineHeight: 1.5 }}>{hoverInfo}</div>
        </div>
      )}

      {editState     && <NodeEditor      editState={editState}     onSave={handleSaveEdit}      onCancel={() => setEditState(null)}     />}
      {edgeEditState && <EdgeLabelEditor editState={edgeEditState} onSave={handleSaveEdgeLabel} onCancel={() => setEdgeEditState(null)} />}

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
export const FlowGraph: React.FC<Props> = (props) => (
  <ReactFlowProvider>
    <FlowGraphInner {...props} />
  </ReactFlowProvider>
);
