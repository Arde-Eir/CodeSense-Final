/**
 * GraphValidator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates a flowchart graph (nodes + edges) BEFORE code generation.
 *
 * Usage:
 *   import { validateGraph } from './GraphValidator';
 *   const result = validateGraph(nodes, edges);
 *   if (!result.isValid) { // show errors, block generation }
 */

import type { Node, Edge } from '@xyflow/react';

// ─── Public types ─────────────────────────────────────────────────────────────

export type Severity = 'error' | 'warning';

export interface ValidationIssue {
  severity:  Severity;
  code:      string;       // machine key e.g. "NO_START_NODE"
  message:   string;       // shown to user
  nodeIds?:  string[];     // nodes to highlight
  edgeIds?:  string[];     // edges to highlight
}

export interface ValidationResult {
  isValid:  boolean;       // false = at least one error → block generation
  errors:   ValidationIssue[];
  warnings: ValidationIssue[];
  all:      ValidationIssue[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const str = (v: unknown): string => String(v ?? '').trim();

const isTrueLabel  = (l: string) => l === 'true'  || l === 'yes';
const isFalseLabel = (l: string) => l === 'false' || l === 'no';
const isBranchLabel = (l: string) => isTrueLabel(l) || isFalseLabel(l);

/** BFS from startId, returns all reachable node ids. */
function reachableFrom(startId: string, edges: Edge[]): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  const visited = new Set<string>([startId]);
  const queue   = [startId];
  while (queue.length) {
    for (const next of adj.get(queue.shift()!) ?? []) {
      if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
  }
  return visited;
}

function finish(issues: ValidationIssue[]): ValidationResult {
  const errors   = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  return { isValid: errors.length === 0, errors, warnings, all: issues };
}

// ─── Main validator ───────────────────────────────────────────────────────────

export function validateGraph(nodes: Node[], edges: Edge[]): ValidationResult {
  const issues: ValidationIssue[] = [];

  const push = (
    severity: Severity, code: string, message: string,
    extra: { nodeIds?: string[]; edgeIds?: string[] } = {}
  ) => issues.push({ severity, code, message, ...extra });

  // Build quick-lookup maps
  const nodeMap  = new Map(nodes.map(n => [n.id, n]));
  const outEdges = new Map<string, Edge[]>(nodes.map(n => [n.id, []]));
  for (const e of edges) {
    if (!outEdges.has(e.source)) outEdges.set(e.source, []);
    outEdges.get(e.source)!.push(e);
  }
  const connectedIds = new Set([...edges.map(e => e.source), ...edges.map(e => e.target)]);
  const inEdges = new Map<string, Edge[]>(nodes.map(n => [n.id, []]));
  for (const e of edges) {
    if (!inEdges.has(e.target)) inEdges.set(e.target, []);
    inEdges.get(e.target)!.push(e);
  }

  // ── 1. Empty canvas ────────────────────────────────────────────────────────
  if (nodes.length === 0) {
    push('error', 'EMPTY_GRAPH',
      'Canvas is empty. Add at least a Start terminator, some nodes, and an End terminator.');
    return finish(issues);
  }

  // ── 2. Start terminator ────────────────────────────────────────────────────
  const startNodes = nodes.filter(
    n => n.type === 'terminator' && str(n.data?.label).toLowerCase() === 'start'
  );
  if (startNodes.length === 0) {
    push('error', 'NO_START_NODE',
      'No "Start" terminator found. Add a Start node — it is the required entry point for code generation.');
  } else if (startNodes.length > 1) {
    push('error', 'MULTIPLE_START_NODES',
      `Found ${startNodes.length} "Start" terminators. There must be exactly one.`,
      { nodeIds: startNodes.map(n => n.id) });
  }

  // ── 3. End terminator ──────────────────────────────────────────────────────
  // A proper End terminator: type=terminator AND label is NOT "start".
  // We do NOT require the label to be exactly "end" — any non-start terminator counts.
  const endNodes = nodes.filter(
    n => n.type === 'terminator' && str(n.data?.label).toLowerCase() !== 'start'
  );
  if (endNodes.length === 0) {
    push('error', 'NO_END_NODE',
      'No "End" terminator found. Add an End node so the program has a defined exit point.');
  }

  // ── 4. Isolated nodes (zero edges) ────────────────────────────────────────
  const isolated = nodes.filter(n => !connectedIds.has(n.id));
  if (isolated.length > 0) {
    push('error', 'ISOLATED_NODES',
      `${isolated.length} node(s) have no connections and will be ignored by the generator: ` +
      isolated.map(n => `"${str(n.data?.label) || n.type}"`).join(', ') + '. Connect or delete them.',
      { nodeIds: isolated.map(n => n.id) });
  }

  // ── 5. Unreachable from Start ──────────────────────────────────────────────
  if (startNodes.length === 1) {
    const reachable   = reachableFrom(startNodes[0].id, edges);
    const unreachable = nodes.filter(n => !reachable.has(n.id));
    if (unreachable.length > 0) {
      push('error', 'UNREACHABLE_NODES',
        `${unreachable.length} node(s) cannot be reached from Start and will never execute: ` +
        unreachable.map(n => `"${str(n.data?.label) || n.type}"`).join(', ') +
        '. Check your connections — every node must form a continuous path from Start.',
        { nodeIds: unreachable.map(n => n.id) });
    }
  }

  // ── 6. Start node must have at least one outgoing edge ────────────────────
  if (startNodes.length === 1) {
    const startOut = outEdges.get(startNodes[0].id) ?? [];
    if (startOut.length === 0) {
      push('error', 'START_NOT_CONNECTED',
        'The Start node has no outgoing connection. Draw an edge from Start to your first step.',
        { nodeIds: [startNodes[0].id] });
    }
  }

  // ── 7. End node validation ────────────────────────────────────────────────
  //   7a. Must have at least one INCOMING edge (something flows into it)
  //   7b. Must NOT have any OUTGOING edges (End is a terminal — nothing flows out)
  const targetIds = new Set(edges.map(e => e.target));
  for (const end of endNodes) {
    const endLbl = str(end.data?.label) || 'End';

    if (!targetIds.has(end.id)) {
      push('error', 'END_NOT_CONNECTED',
        `"${endLbl}" terminator has no incoming connection. Connect at least one path into it.`,
        { nodeIds: [end.id] });
    }

    const endOut = outEdges.get(end.id) ?? [];
    if (endOut.length > 0) {
      const targets = endOut.map(e => {
        const t = nodes.find(n => n.id === e.target);
        return '"' + (str(t?.data?.label) || t?.type || e.target) + '"';
      }).join(', ');
      push('error', 'END_HAS_OUTGOING_EDGE',
        `"${endLbl}" terminator has ${endOut.length} outgoing edge(s) to ${targets}. ` +
        'End nodes must not connect to anything — they are the final exit point. ' +
        'Delete the edge(s) coming out of it.',
        { nodeIds: [end.id], edgeIds: endOut.map(e => e.id) });
    }
  }

  // ── 8. Decision node validation ───────────────────────────────────────────
  const decisionNodes = nodes.filter(n => n.type === 'decision');
  for (const d of decisionNodes) {
    const out = outEdges.get(d.id) ?? [];
    const lbl = str(d.data?.label) || 'unnamed Decision';

    // 8a. No outgoing edges at all
    if (out.length === 0) {
      push('error', 'DECISION_NO_EDGES',
        `Decision "${lbl}" has no outgoing edges. ` +
        'Connect it to a "true" branch (and optionally a "false" branch).',
        { nodeIds: [d.id] });
      continue; // remaining checks require edges
    }

    // 8b. Only one outgoing edge
    if (out.length === 1) {
      push('warning', 'DECISION_SINGLE_EDGE',
        `Decision "${lbl}" has only one outgoing edge — it will generate an if (…) with no else branch. ` +
        'Add a second edge and label them "true" / "false" if you need both branches.',
        { nodeIds: [d.id] });
    }

    // 8c. Two+ edges but none labelled true/false
    if (out.length >= 2) {
      const labelled   = out.filter(e => isBranchLabel(str(e.label).toLowerCase()));
      const unlabelled = out.filter(e => !isBranchLabel(str(e.label).toLowerCase()));

      if (labelled.length === 0) {
        push('error', 'DECISION_UNLABELLED_EDGES',
          `Decision "${lbl}" has ${out.length} outgoing edges but none are labelled "true" or "false". ` +
          'Double-click each edge and label them — the generator cannot tell which branch is which.',
          { nodeIds: [d.id], edgeIds: out.map(e => e.id) });
      } else if (unlabelled.length > 0) {
        push('warning', 'DECISION_PARTIALLY_LABELLED',
          `Decision "${lbl}" has ${unlabelled.length} unlabelled edge(s). ` +
          'Label all outgoing edges "true" / "false" to avoid incorrect code generation.',
          { nodeIds: [d.id], edgeIds: unlabelled.map(e => e.id) });
      }

      // 8d. Duplicate true / false labels
      const trueEdges  = out.filter(e => isTrueLabel(str(e.label).toLowerCase()));
      const falseEdges = out.filter(e => isFalseLabel(str(e.label).toLowerCase()));
      if (trueEdges.length > 1) {
        push('error', 'DECISION_DUPLICATE_TRUE',
          `Decision "${lbl}" has ${trueEdges.length} edges labelled "true". Only one "true" branch is allowed.`,
          { nodeIds: [d.id], edgeIds: trueEdges.map(e => e.id) });
      }
      if (falseEdges.length > 1) {
        push('error', 'DECISION_DUPLICATE_FALSE',
          `Decision "${lbl}" has ${falseEdges.length} edges labelled "false". Only one "false" branch is allowed.`,
          { nodeIds: [d.id], edgeIds: falseEdges.map(e => e.id) });
      }
    }

    // 8e. Empty / default condition
    // A decision is considered "unconfigured" only when BOTH label AND code are
    // placeholder/empty. If the user set code (e.g. "hp > 0") but left the
    // label as "Condition", that is fine — the code field is what gets emitted.
    const dCode  = str(d.data?.code);
    const dLabel = str(d.data?.label);
    const hasRealCondition = dCode || (dLabel && dLabel !== 'Condition');
    if (!hasRealCondition) {
      push('warning', 'DECISION_EMPTY_CONDITION',
        'Decision node has no condition set. Double-click it and enter a C++ condition like "hp > 0" or "i < n".',
        { nodeIds: [d.id] });
    }
  }

  // ── 9. Non-decision nodes with no outgoing edge (dead ends) ───────────────
  const deadEnds = nodes.filter(n => {
    if (n.type === 'terminator') return false; // End nodes are intentional dead ends
    const out = outEdges.get(n.id) ?? [];
    return out.length === 0 && connectedIds.has(n.id); // connected but no output
  });
  if (deadEnds.length > 0) {
    push('error', 'DEAD_END_NODES',
      `${deadEnds.length} non-terminator node(s) have no outgoing edge — execution gets stuck: ` +
      deadEnds.map(n => `"${str(n.data?.label) || n.type}"`).join(', ') +
      '. Connect each one to the next step or to the End node.',
      { nodeIds: deadEnds.map(n => n.id) });
  }

  // ── 10. Dangling edges (point to deleted nodes) ────────────────────────────
  const dangling = edges.filter(e => !nodeMap.has(e.source) || !nodeMap.has(e.target));
  if (dangling.length > 0) {
    push('error', 'DANGLING_EDGES',
      `${dangling.length} edge(s) point to nodes that no longer exist. ` +
      'Select and delete them with Backspace.',
      { edgeIds: dangling.map(e => e.id) });
  }

  // ── 10b. Junction / Offset-shape structural checks ────────────────────────
  const junctionNodes = nodes.filter(n => n.type === 'junction');
  for (const j of junctionNodes) {
    const inCount = (inEdges.get(j.id) ?? []).length;
    const outCount = (outEdges.get(j.id) ?? []).length;

    if (inCount === 0 || outCount === 0) {
      push(
        'error',
        'JUNCTION_INCOMPLETE',
        `Junction "${str(j.data?.label) || '⬡'}" must have at least one incoming and one outgoing edge.`,
        { nodeIds: [j.id] },
      );
      continue;
    }

    if (outCount > 1) {
      push(
        'warning',
        'JUNCTION_MULTI_OUT',
        `Junction "${str(j.data?.label) || '⬡'}" has ${outCount} outgoing edges. Code generation follows the first path only; use a Decision node to branch.`,
        { nodeIds: [j.id], edgeIds: (outEdges.get(j.id) ?? []).map(e => e.id) },
      );
    }
  }

  // ── 11. Placeholder nodes with no real code ───────────────────────────────
  const PLACEHOLDERS = new Set(['Process', 'Output', 'Function Call', 'Input',
                                 'Delay', 'Data Store', 'Document', 'Condition']);
  const placeholder = nodes.filter(n => {
    if (['terminator', 'connector', 'junction', 'decision'].includes(n.type ?? '')) return false;
    return PLACEHOLDERS.has(str(n.data?.label)) && !str(n.data?.code);
  });
  if (placeholder.length > 0) {
    push('warning', 'PLACEHOLDER_NODES',
      `${placeholder.length} node(s) still have default labels and no C++ code — ` +
      '"// TODO" comments will appear in the output. Double-click them to add real code.',
      { nodeIds: placeholder.map(n => n.id) });
  }

  return finish(issues);
}