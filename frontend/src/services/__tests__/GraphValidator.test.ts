import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { validateGraph } from '../GraphValidator';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeNode(id: string, type: string, label: string, extra: Record<string, unknown> = {}): Node {
  return { id, type, position: { x: 0, y: 0 }, data: { label, ...extra } };
}

function makeEdge(id: string, source: string, target: string, label?: string): Edge {
  return { id, source, target, ...(label !== undefined ? { label } : {}) };
}

/** Minimal valid graph: Start → process → End */
function minimalGraph(): { nodes: Node[]; edges: Edge[] } {
  const nodes = [
    makeNode('s', 'terminator', 'Start'),
    makeNode('p', 'process', 'Process', { code: 'x = 1;' }),
    makeNode('e', 'terminator', 'End'),
  ];
  const edges = [
    makeEdge('e1', 's', 'p'),
    makeEdge('e2', 'p', 'e'),
  ];
  return { nodes, edges };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('validateGraph', () => {
  // Rule 1 — empty canvas
  it('returns EMPTY_GRAPH error on empty node list', () => {
    const result = validateGraph([], []);
    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('EMPTY_GRAPH');
  });

  it('returns early (no further checks) when canvas is empty', () => {
    const result = validateGraph([], []);
    // Only the one EMPTY_GRAPH issue exists
    expect(result.all).toHaveLength(1);
  });

  // Rule 2 — Start terminator
  it('reports NO_START_NODE when no Start terminator exists', () => {
    const nodes = [makeNode('e', 'terminator', 'End')];
    const result = validateGraph(nodes, []);
    expect(result.errors.some(e => e.code === 'NO_START_NODE')).toBe(true);
  });

  it('reports MULTIPLE_START_NODES when two Start terminators exist', () => {
    const nodes = [
      makeNode('s1', 'terminator', 'Start'),
      makeNode('s2', 'terminator', 'Start'),
      makeNode('e',  'terminator', 'End'),
    ];
    const result = validateGraph(nodes, []);
    expect(result.errors.some(e => e.code === 'MULTIPLE_START_NODES')).toBe(true);
    // nodeIds should list both start nodes
    const issue = result.errors.find(e => e.code === 'MULTIPLE_START_NODES')!;
    expect(issue.nodeIds).toEqual(expect.arrayContaining(['s1', 's2']));
  });

  // Rule 3 — End terminator
  it('reports NO_END_NODE when only a Start terminator exists', () => {
    const nodes = [makeNode('s', 'terminator', 'Start')];
    const result = validateGraph(nodes, []);
    expect(result.errors.some(e => e.code === 'NO_END_NODE')).toBe(true);
  });

  // Rule 4 — Isolated nodes
  it('reports ISOLATED_NODES for nodes with zero edges', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('p', 'process',    'Process'),  // isolated
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [makeEdge('e1', 's', 'e')]; // p is not connected
    const result = validateGraph(nodes, edges);
    expect(result.errors.some(err => err.code === 'ISOLATED_NODES')).toBe(true);
    const issue = result.errors.find(err => err.code === 'ISOLATED_NODES')!;
    expect(issue.nodeIds).toContain('p');
  });

  // Rule 5 — Unreachable from Start
  it('reports UNREACHABLE_NODES for nodes not reachable from Start', () => {
    const nodes = [
      makeNode('s',  'terminator', 'Start'),
      makeNode('p',  'process',    'Process'),
      makeNode('e',  'terminator', 'End'),
      makeNode('u',  'process',    'Unreachable'),
    ];
    const edges = [
      makeEdge('e1', 's', 'p'),
      makeEdge('e2', 'p', 'e'),
      makeEdge('e3', 'u', 'e'),  // u connects TO e but nothing connects TO u
    ];
    const result = validateGraph(nodes, edges);
    expect(result.errors.some(err => err.code === 'UNREACHABLE_NODES')).toBe(true);
    const issue = result.errors.find(err => err.code === 'UNREACHABLE_NODES')!;
    expect(issue.nodeIds).toContain('u');
  });

  // Rule 6 — Start not connected
  it('reports START_NOT_CONNECTED when Start has no outgoing edge', () => {
    // Remove the edge so Start is connected only through the End (reversed)
    const noEdgeResult = validateGraph(
      [makeNode('s', 'terminator', 'Start'), makeNode('e', 'terminator', 'End')],
      [makeEdge('e1', 'e', 's')], // edge goes FROM end TO start — unusual
    );
    // Start has an incoming edge here but no outgoing — START_NOT_CONNECTED expected
    expect(noEdgeResult.errors.some(err => err.code === 'START_NOT_CONNECTED')).toBe(true);
  });

  it('reports START_HAS_INCOMING_EDGE when anything points into Start', () => {
    const result = validateGraph(
      [makeNode('s', 'terminator', 'Start'), makeNode('e', 'terminator', 'End')],
      [makeEdge('e1', 'e', 's')],
    );
    expect(result.errors.some(err => err.code === 'START_HAS_INCOMING_EDGE')).toBe(true);
  });

  it('reports START_MULTIPLE_OUTGOING when Start branches directly', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('p1', 'process', 'A'),
      makeNode('p2', 'process', 'B'),
      makeNode('e', 'terminator', 'End'),
    ];
    const result = validateGraph(nodes, [
      makeEdge('e1', 's', 'p1'),
      makeEdge('e2', 's', 'p2'),
      makeEdge('e3', 'p1', 'e'),
      makeEdge('e4', 'p2', 'e'),
    ]);
    expect(result.errors.some(err => err.code === 'START_MULTIPLE_OUTGOING')).toBe(true);
  });

  it('does NOT report START_NOT_CONNECTED on valid minimal graph', () => {
    const { nodes, edges } = minimalGraph();
    const result = validateGraph(nodes, edges);
    expect(result.errors.some(err => err.code === 'START_NOT_CONNECTED')).toBe(false);
  });

  // Rule 7 — End node validation
  it('reports END_NOT_CONNECTED when End has no incoming edge', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('e', 'terminator', 'End'),
    ];
    // swap source/target so End has no incoming
    const result = validateGraph(nodes, [makeEdge('e1', 'e', 's')]); // End → Start
    // The End node is isolated from incoming
    expect(result.errors.some(err => err.code === 'END_NOT_CONNECTED')).toBe(true);
  });

  it('reports END_HAS_OUTGOING_EDGE when End has an outgoing edge', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('p', 'process',    'Process'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'p'),
      makeEdge('e2', 'p', 'e'),
      makeEdge('e3', 'e', 'p'), // End → Process — illegal
    ];
    const result = validateGraph(nodes, edges);
    expect(result.errors.some(err => err.code === 'END_HAS_OUTGOING_EDGE')).toBe(true);
  });

  // Rule 8 — Decision node validation
  it('reports DECISION_NO_EDGES when a decision node has no outgoing edges', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('d', 'decision',   'x > 0'),
      makeNode('e', 'terminator', 'End'),
    ];
    // Remove outgoing from d
    const result = validateGraph(nodes, [makeEdge('e1', 's', 'd')]);
    expect(result.errors.some(err => err.code === 'DECISION_NO_EDGES')).toBe(true);
  });

  it('reports DECISION_REQUIRES_TWO_BRANCHES when decision has exactly one outgoing edge', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('d', 'decision',   'x > 0'),
      makeNode('p', 'process',    'Process'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'd'),
      makeEdge('e2', 'd', 'p', 'true'),
      makeEdge('e3', 'p', 'e'),
    ];
    const result = validateGraph(nodes, edges);
    expect(result.errors.some(err => err.code === 'DECISION_REQUIRES_TWO_BRANCHES')).toBe(true);
    expect(result.errors.some(err => err.code === 'DECISION_MISSING_FALSE')).toBe(true);
  });

  it('reports DECISION_UNLABELLED_EDGES when two+ edges have no true/false labels', () => {
    const nodes = [
      makeNode('s',  'terminator', 'Start'),
      makeNode('d',  'decision',   'x > 0'),
      makeNode('p1', 'process',    'A'),
      makeNode('p2', 'process',    'B'),
      makeNode('e',  'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's',  'd'),
      makeEdge('e2', 'd',  'p1'),  // no label
      makeEdge('e3', 'd',  'p2'),  // no label
      makeEdge('e4', 'p1', 'e'),
      makeEdge('e5', 'p2', 'e'),
    ];
    const result = validateGraph(nodes, edges);
    expect(result.errors.some(err => err.code === 'DECISION_UNLABELLED_EDGES')).toBe(true);
  });

  it('reports DECISION_DUPLICATE_TRUE when two edges are labelled true', () => {
    const nodes = [
      makeNode('s',  'terminator', 'Start'),
      makeNode('d',  'decision',   'x > 0'),
      makeNode('p1', 'process',    'A'),
      makeNode('p2', 'process',    'B'),
      makeNode('e',  'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's',  'd'),
      makeEdge('e2', 'd',  'p1', 'true'),
      makeEdge('e3', 'd',  'p2', 'true'),  // duplicate true
      makeEdge('e4', 'p1', 'e'),
      makeEdge('e5', 'p2', 'e'),
    ];
    const result = validateGraph(nodes, edges);
    expect(result.errors.some(err => err.code === 'DECISION_DUPLICATE_TRUE')).toBe(true);
  });

  it('reports DECISION_EMPTY_CONDITION for an unconfigured decision node', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('d', 'decision',   'Condition'),  // default placeholder label, no code
      makeNode('p', 'process',    'Process'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'd'),
      makeEdge('e2', 'd', 'p', 'true'),
      makeEdge('e3', 'd', 'e', 'false'),
      makeEdge('e4', 'p', 'e'),
    ];
    const result = validateGraph(nodes, edges);
    expect(result.errors.some(err => err.code === 'DECISION_EMPTY_CONDITION')).toBe(true);
  });

  // Rule 9 — Dead end nodes
  it('reports DEAD_END_NODES for non-terminator nodes with no outgoing edge', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('p', 'process',    'Process'),  // dead end (no outgoing)
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'p'),
      makeEdge('e2', 's', 'e'),
    ];
    const result = validateGraph(nodes, edges);
    expect(result.errors.some(err => err.code === 'DEAD_END_NODES')).toBe(true);
    const issue = result.errors.find(err => err.code === 'DEAD_END_NODES')!;
    expect(issue.nodeIds).toContain('p');
  });

  // Rule 10 — Dangling edges
  it('reports DANGLING_EDGES for edges pointing to non-existent nodes', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'e'),
      makeEdge('e2', 's', 'ghost'),  // ghost does not exist
    ];
    const result = validateGraph(nodes, edges);
    expect(result.errors.some(err => err.code === 'DANGLING_EDGES')).toBe(true);
    const issue = result.errors.find(err => err.code === 'DANGLING_EDGES')!;
    expect(issue.edgeIds).toContain('e2');
  });

  it('reports SELF_LOOP_EDGES for edges that target their own source node', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('p', 'process', 'Process'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'p'),
      makeEdge('e2', 'p', 'p'),
      makeEdge('e3', 'p', 'e'),
    ];
    const result = validateGraph(nodes, edges);
    expect(result.errors.some(err => err.code === 'SELF_LOOP_EDGES')).toBe(true);
    expect(result.errors.find(err => err.code === 'SELF_LOOP_EDGES')?.edgeIds).toContain('e2');
  });

  it('reports DUPLICATE_EDGES for repeated identical flow lines', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('p', 'process', 'Process'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'p'),
      makeEdge('e2', 'p', 'e'),
      makeEdge('e3', 'p', 'e'),
    ];
    const result = validateGraph(nodes, edges);
    expect(result.errors.some(err => err.code === 'DUPLICATE_EDGES')).toBe(true);
    expect(result.errors.find(err => err.code === 'DUPLICATE_EDGES')?.edgeIds).toEqual(expect.arrayContaining(['e2', 'e3']));
  });

  // Rule 10b — Junction nodes
  it('reports JUNCTION_INCOMPLETE when junction has no incoming edge', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('j', 'junction',   '⬡'),
      makeNode('e', 'terminator', 'End'),
    ];
    // j has outgoing but no incoming
    const edges = [
      makeEdge('e1', 's', 'e'),
      makeEdge('e2', 'j', 'e'),
    ];
    const result = validateGraph(nodes, edges);
    expect(result.errors.some(err => err.code === 'JUNCTION_INCOMPLETE')).toBe(true);
  });

  it('reports JUNCTION_MULTI_OUT when junction has multiple outgoing edges', () => {
    const nodes = [
      makeNode('s',  'terminator', 'Start'),
      makeNode('p1', 'process',    'A'),
      makeNode('j',  'junction',   '⬡'),
      makeNode('p2', 'process',    'B'),
      makeNode('p3', 'process',    'C'),
      makeNode('e',  'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's',  'p1'),
      makeEdge('e2', 'p1', 'j'),
      makeEdge('e3', 'j',  'p2'),  // two outgoing
      makeEdge('e4', 'j',  'p3'),
      makeEdge('e5', 'p2', 'e'),
      makeEdge('e6', 'p3', 'e'),
    ];
    const result = validateGraph(nodes, edges);
    expect(result.errors.some(err => err.code === 'JUNCTION_MULTI_OUT')).toBe(true);
  });

  it('reports LINEAR_NODE_MULTIPLE_OUTGOING when a process branches directly', () => {
    const nodes = [
      makeNode('s',  'terminator', 'Start'),
      makeNode('p',  'process',    'x = 1', { code: 'x = 1;' }),
      makeNode('p1', 'process',    'A'),
      makeNode('p2', 'process',    'B'),
      makeNode('e',  'terminator', 'End'),
    ];
    const result = validateGraph(nodes, [
      makeEdge('e1', 's', 'p'),
      makeEdge('e2', 'p', 'p1'),
      makeEdge('e3', 'p', 'p2'),
      makeEdge('e4', 'p1', 'e'),
      makeEdge('e5', 'p2', 'e'),
    ]);
    expect(result.errors.some(err => err.code === 'LINEAR_NODE_MULTIPLE_OUTGOING')).toBe(true);
  });

  it('reports DECISION_EMPTY_CONDITION for malformed decision text', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('d', 'decision', "hp > 0 or 'i < n"),
      makeNode('p', 'process', 'A', { code: 'hp--;' }),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'd'),
      makeEdge('e2', 'd', 'p', 'true'),
      makeEdge('e3', 'd', 'e', 'false'),
      makeEdge('e4', 'p', 'e'),
    ];
    const result = validateGraph(nodes, edges);
    expect(result.errors.some(err => err.code === 'DECISION_EMPTY_CONDITION')).toBe(true);
  });

  // Rule 11 — Required executable node code
  it('emits MISSING_NODE_CODE error for executable nodes with default label and no code', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('p', 'process',    'Process'),  // default placeholder label
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'p'),
      makeEdge('e2', 'p', 'e'),
    ];
    const result = validateGraph(nodes, edges);
    expect(result.errors.some(w => w.code === 'MISSING_NODE_CODE')).toBe(true);
  });

  // Happy path
  it('returns isValid true and no errors for a correct fully-labelled graph', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('p', 'process',    'x = 1', { code: 'x = 1;' }),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'p'),
      makeEdge('e2', 'p', 'e'),
    ];
    const result = validateGraph(nodes, edges);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // Structural helpers
  it('result.all contains both errors and warnings', () => {
    // Graph that triggers an error (dead end) and a warning (placeholder)
    const nodes = [
      makeNode('s',  'terminator', 'Start'),
      makeNode('p',  'process',    'Process'),  // placeholder warning + dead end error
      makeNode('e',  'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'p'),
      makeEdge('e2', 's', 'e'),
    ];
    const result = validateGraph(nodes, edges);
    expect(result.all.length).toBeGreaterThan(0);
    expect(result.errors.every(i => i.severity === 'error')).toBe(true);
    expect(result.warnings.every(i => i.severity === 'warning')).toBe(true);
  });
});
