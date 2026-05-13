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

const CONDITION_PLACEHOLDERS = new Set(['condition', 'if condition', 'decision']);

function hasOddCount(value: string, needle: string): boolean {
  return value.split(needle).length % 2 === 0;
}

function isInvalidCondition(value: string): boolean {
  const condition = str(value);
  if (!condition) return true;
  const lowered = condition.toLowerCase();
  if (CONDITION_PLACEHOLDERS.has(lowered)) return true;
  if (lowered.includes('e.g.') || lowered.includes('example')) return true;
  if (hasOddCount(condition, "'") || hasOddCount(condition, '"')) return true;
  if (/[{};]/.test(condition)) return true;
  return false;
}

const LINEAR_NODE_TYPES = new Set([
  'process',
  'io',
  'manual_input',
  'predefined',
  'document',
  'delay',
  'database',
  'connector',
  'off_page_connector',
]);

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

  const selfLoops = edges.filter(e => e.source === e.target);
  if (selfLoops.length > 0) {
    push('error', 'SELF_LOOP_EDGES',
      `${selfLoops.length} edge(s) loop directly back to the same node. Flowchart steps must connect to a different next step; use a Decision node with a loop branch for repetition.`,
      { nodeIds: [...new Set(selfLoops.map(e => e.source))], edgeIds: selfLoops.map(e => e.id) });
  }

  const seenConnections = new Map<string, Edge[]>();
  for (const e of edges) {
    const key = `${e.source}->${e.target}:${str(e.label).toLowerCase()}`;
    const matches = seenConnections.get(key) ?? [];
    matches.push(e);
    seenConnections.set(key, matches);
  }
  const duplicateEdges = [...seenConnections.values()].filter(matches => matches.length > 1).flat();
  if (duplicateEdges.length > 0) {
    push('error', 'DUPLICATE_EDGES',
      `${duplicateEdges.length} duplicate edge(s) repeat the same connection and label. Delete duplicate flow lines so code generation follows one clear path.`,
      { edgeIds: duplicateEdges.map(e => e.id) });
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
    const reachable    = reachableFrom(startNodes[0].id, edges);
    const isolatedSet  = new Set(isolated.map(n => n.id)); // already reported in rule 4
    const unreachable  = nodes.filter(n => !reachable.has(n.id) && !isolatedSet.has(n.id));
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
    const startIn  = inEdges.get(startNodes[0].id) ?? [];
    const startOut = outEdges.get(startNodes[0].id) ?? [];
    if (startIn.length > 0) {
      push('error', 'START_HAS_INCOMING_EDGE',
        'The Start terminator must not have incoming edges. It is the single entry point of the flowchart.',
        { nodeIds: [startNodes[0].id], edgeIds: startIn.map(e => e.id) });
    }
    if (startOut.length === 0) {
      push('error', 'START_NOT_CONNECTED',
        'The Start node has no outgoing connection. Draw an edge from Start to your first step.',
        { nodeIds: [startNodes[0].id] });
    } else if (startOut.length > 1) {
      push('error', 'START_MULTIPLE_OUTGOING',
        `The Start terminator has ${startOut.length} outgoing edges. Use exactly one outgoing flow line from Start.`,
        { nodeIds: [startNodes[0].id], edgeIds: startOut.map(e => e.id) });
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

    // 8b. ISO-style code generation supports exactly two decision exits:
    // true/yes and false/no. Anything else is ambiguous and used to be silently
    // truncated by the generator.
    if (out.length !== 2) {
      push('error', 'DECISION_REQUIRES_TWO_BRANCHES',
        `Decision "${lbl}" has ${out.length} outgoing edge(s). Use exactly two outgoing edges: one labelled "true" and one labelled "false".`,
        { nodeIds: [d.id], edgeIds: out.map(e => e.id) });
    }

    // 8c. Edges must be labelled true/false
    if (out.length > 0) {
      const unlabelled = out.filter(e => !isBranchLabel(str(e.label).toLowerCase()));

      if (unlabelled.length > 0) {
        push('error', 'DECISION_UNLABELLED_EDGES',
          `Decision "${lbl}" has ${unlabelled.length} outgoing edge(s) without a "true" or "false" label. ` +
          'Label each decision edge so code generation can map the branches correctly.',
          { nodeIds: [d.id], edgeIds: unlabelled.map(e => e.id) });
      }

      const trueEdges  = out.filter(e => isTrueLabel(str(e.label).toLowerCase()));
      const falseEdges = out.filter(e => isFalseLabel(str(e.label).toLowerCase()));
      if (trueEdges.length === 0) {
        push('error', 'DECISION_MISSING_TRUE',
          `Decision "${lbl}" is missing a "true" branch.`,
          { nodeIds: [d.id] });
      } else if (trueEdges.length > 1) {
        push('error', 'DECISION_DUPLICATE_TRUE',
          `Decision "${lbl}" has ${trueEdges.length} edges labelled "true". Only one "true" branch is allowed.`,
          { nodeIds: [d.id], edgeIds: trueEdges.map(e => e.id) });
      }
      if (falseEdges.length === 0) {
        push('error', 'DECISION_MISSING_FALSE',
          `Decision "${lbl}" is missing a "false" branch.`,
          { nodeIds: [d.id] });
      } else if (falseEdges.length > 1) {
        push('error', 'DECISION_DUPLICATE_FALSE',
          `Decision "${lbl}" has ${falseEdges.length} edges labelled "false". Only one "false" branch is allowed.`,
          { nodeIds: [d.id], edgeIds: falseEdges.map(e => e.id) });
      }
    }

    // 8d. Empty / default condition
    // A decision is considered "unconfigured" only when BOTH label AND code are
    // placeholder/empty. If the user set code (e.g. "hp > 0") but left the
    // label as "Condition", that is fine — the code field is what gets emitted.
    const dCode  = str(d.data?.code);
    const dLabel = str(d.data?.label);
    const condition = dCode || dLabel;
    if (isInvalidCondition(condition)) {
      push('error', 'DECISION_EMPTY_CONDITION',
        'Decision node needs a valid C++ condition. Double-click it and enter only the expression, for example: hp > 0 || i < n.',
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
        'error',
        'JUNCTION_MULTI_OUT',
        `Junction "${str(j.data?.label) || '⬡'}" has ${outCount} outgoing edges. Junctions are routing-only and must have exactly one outgoing path; use a Decision node to branch.`,
        { nodeIds: [j.id], edgeIds: (outEdges.get(j.id) ?? []).map(e => e.id) },
      );
    }
  }

  // ── 10c. ISO linear shape cardinality ─────────────────────────────────────
  // All supported non-decision action/data/reference shapes are deterministic
  // sequence steps. They must not branch. Older generator behavior followed
  // the first outgoing edge and silently ignored the rest.
  const linearViolations = nodes.filter(n => LINEAR_NODE_TYPES.has(String(n.type ?? ''))).flatMap(n => {
    const out = outEdges.get(n.id) ?? [];
    if (out.length <= 1) return [];
    return [{ node: n, out }];
  });
  for (const { node, out } of linearViolations) {
    push(
      'error',
      'LINEAR_NODE_MULTIPLE_OUTGOING',
      `"${str(node.data?.label) || node.type}" has ${out.length} outgoing edges. Only Decision nodes may branch; use exactly one outgoing path from this shape.`,
      { nodeIds: [node.id], edgeIds: out.map(e => e.id) },
    );
  }

  // ── 11. Placeholder nodes with no real code ───────────────────────────────
  const REQUIRED_CODE_NODE_TYPES = new Set(['process', 'io', 'manual_input', 'predefined',
                                            'delay', 'database', 'document']);
  const missingCode = nodes.filter(n => {
    if (!REQUIRED_CODE_NODE_TYPES.has(String(n.type ?? ''))) return false;
    return !str(n.data?.code);
  });
  if (missingCode.length > 0) {
    push('error', 'MISSING_NODE_CODE',
      `${missingCode.length} executable node(s) have no C++ code. Double-click each highlighted node and add the statement/expression it should generate.`,
      { nodeIds: missingCode.map(n => n.id) });
  }

  return finish(issues);
}
