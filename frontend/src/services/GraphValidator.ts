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
import { translateFlowchartInstruction } from './CodeGenerator';

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
const EXECUTABLE_PLACEHOLDERS = new Set([
  'process',
  'output',
  'input',
  'function call',
  'document',
  'delay',
  'data store',
]);

function isStartTerminator(node: Node): boolean {
  return node.type === 'terminator' && str(node.data?.label).toLowerCase() === 'start';
}

function isReturnTerminator(node: Node): boolean {
  const label = str(node.data?.label).toLowerCase();
  const code = str(node.data?.code).toLowerCase();
  return node.type === 'terminator' && (label === 'return' || code === 'return' || code.startsWith('return '));
}

function isEndTerminator(node: Node): boolean {
  return node.type === 'terminator' && !isStartTerminator(node) && !isReturnTerminator(node);
}

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

function hasUsableLabel(node: Node): boolean {
  const label = str(node.data?.label).toLowerCase();
  if (!label) return false;
  return !EXECUTABLE_PLACEHOLDERS.has(label);
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

const PSEUDOCODE_NODE_TYPES = new Set([
  'process',
  'io',
  'manual_input',
  'predefined',
  'document',
  'delay',
  'database',
]);

const OUT_OF_SCOPE_CPP_PATTERNS: Array<{ code: string; re: RegExp; message: string }> = [
  {
    code: 'UNSUPPORTED_TEMPLATE',
    re: /\btemplate\s*</,
    message: 'Templates are outside the CP1/CP2 flowchart scope. Use basic functions, arrays, decisions, loops, and I/O instead.',
  },
  {
    code: 'UNSUPPORTED_STL',
    re: /#include\s*<(?:vector|map|unordered_map|set|list|deque|queue|stack|algorithm|utility|tuple|array|functional|memory|optional|variant|bitset|numeric|iterator|ranges)>|\bstd::(?:vector|map|unordered_map|set|unordered_set|list|deque|queue|stack|pair|tuple|array)\b|\b(?:vector|map|set|queue|stack|list|deque|pair)\s*</,
    message: 'STL containers and advanced STL headers are outside the CP1/CP2 flowchart scope. Use basic arrays instead.',
  },
  {
    code: 'UNSUPPORTED_OOP',
    re: /\b(class|struct)\s+[A-Za-z_][A-Za-z0-9_]*\s*(?::[^{]+)?\{|\b(public|private|protected)\s*:|\bthis\s*(?:->|\.)/,
    message: 'OOP/class-style code is outside the CP1/CP2 flowchart scope.',
  },
  {
    code: 'UNSUPPORTED_OPERATOR_OVERLOAD',
    re: /\boperator\s*(==|!=|<=|>=|<|>|\+|-|\*|\/|%|<<|>>|\[\]|\(\)|=|\+=|-=|\*=|\/=)/,
    message: 'Operator overloading is outside the CP1/CP2 flowchart scope.',
  },
  {
    code: 'UNSUPPORTED_LAMBDA',
    re: /\[\s*(?:[&=]|\w+)?(?:\s*,\s*(?:[&=]|\w+))*\s*\]\s*\(/,
    message: 'Lambda expressions are outside the CP1/CP2 flowchart scope.',
  },
  {
    code: 'UNSUPPORTED_COROUTINE',
    re: /\bco_await\b|\bco_yield\b|\bco_return\b/,
    message: 'Coroutines are outside the CP1/CP2 flowchart scope.',
  },
  {
    code: 'UNSUPPORTED_CONCEPTS',
    re: /\bconcept\b|\brequires\b/,
    message: 'C++20 concepts/requires are outside the CP1/CP2 flowchart scope.',
  },
  {
    code: 'UNSUPPORTED_VIRTUAL',
    re: /\bvirtual\s+\w/,
    message: 'Virtual functions and polymorphism are outside the CP1/CP2 flowchart scope.',
  },
  {
    code: 'NO_COMPILATION_REQUEST',
    re: /\b(?:compile|build|run|execute)\s+(?:the\s+)?(?:code|program|cpp|c\+\+)\b/i,
    message: 'Flowchart-to-code does not compile or run programs.',
  },
];

function getInstruction(node: Node): string {
  return str(node.data?.code) || str(node.data?.label);
}

function looksLikeRawCpp(value: string): boolean {
  return /[;{}]|<<|>>|\b(cout|cin|printf|scanf|return|int|float|double|char|bool|string|vector)\b|\b(?:while|for|if|switch)\s*\(/.test(value);
}

function rawInstruction(node: Node): string {
  return [str(node.data?.code), str(node.data?.label)].filter(Boolean).join('\n');
}

function detectUnsupportedCpp(node: Node): ValidationIssue[] {
  const instruction = rawInstruction(node);
  if (!instruction) return [];
  const preprocessorIssues: ValidationIssue[] = /#\s*include\b/.test(instruction)
    ? [{
        severity: 'error',
        code: 'FLOWCHART_MANUAL_INCLUDE',
        message: 'Do not place #include directives inside flowchart nodes. Flowchart-to-code adds the required preprocessor directives automatically from the generated C++.',
        nodeIds: [node.id],
      }]
    : [];

  return preprocessorIssues.concat(OUT_OF_SCOPE_CPP_PATTERNS
    .filter(pattern => pattern.re.test(instruction))
    .map(pattern => ({
      severity: 'error' as const,
      code: pattern.code,
      message: pattern.message,
      nodeIds: [node.id],
    })));
}

function normalizeSignatureType(type: string): string {
  return type.replace(/\s+/g, ' ').trim();
}

function detectFunctionOverloadNodes(nodes: Node[]): ValidationIssue[] {
  const seen = new Map<string, { signatures: Set<string>; nodeId: string }>();
  const issues: ValidationIssue[] = [];

  for (const node of nodes) {
    const instruction = rawInstruction(node);
    const matches = instruction.matchAll(/\b([A-Za-z_][A-Za-z0-9_:<>\s*&]+?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^;{}]*)\)\s*(?:\{|;)/g);
    for (const match of matches) {
      const returnType = match[1].trim();
      const name = match[2];
      if (['if', 'while', 'for', 'switch'].includes(returnType) || name === 'main') continue;
      const params = match[3].trim()
        ? match[3].split(',').map(param => normalizeSignatureType(param.replace(/\b[A-Za-z_][A-Za-z0-9_]*\s*$/, '').trim())).join(',')
        : '';
      const known = seen.get(name);
      if (known && !known.signatures.has(params)) {
        issues.push({
          severity: 'error',
          code: 'UNSUPPORTED_FUNCTION_OVERLOADING',
          message: `Function overloading is outside the CP1/CP2 flowchart scope. "${name}" appears with multiple parameter lists.`,
          nodeIds: [known.nodeId, node.id],
        });
      }
      if (!known) {
        seen.set(name, { signatures: new Set([params]), nodeId: node.id });
      } else {
        known.signatures.add(params);
      }
    }
  }

  return issues;
}

function startsLikePseudocode(value: string, starters: RegExp): boolean {
  const cleaned = value.trim().replace(/^\s*(?:then|next|finally)\s+/i, '');
  return starters.test(cleaned);
}

function shapeMismatchIssue(node: Node): string | null {
  const type = String(node.type ?? '');
  const instruction = getInstruction(node);
  if (!instruction || EXECUTABLE_PLACEHOLDERS.has(instruction.toLowerCase())) {
    return null;
  }

  const cleaned = instruction.trim().replace(/^\s*(?:then|next|finally)\s+/i, '');
  const lower = cleaned.toLowerCase();
  const rawInput = /\b(?:cin\s*>>|scanf\s*\()/.test(lower);
  const rawOutput = /\b(?:cout\s*<<|printf\s*\()/.test(lower);
  const rawFile = /\b(?:fstream|ofstream|ifstream)\b/.test(lower);
  const rawData = /\bnew\s+\w|\bdelete(?:\s*\[\])?\b|\w+\s*\[[^\]]+\]/.test(lower);
  const rawCallMatch = cleaned.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\([^;{}]*\)\s*;?$/);
  const rawCall = !!rawCallMatch && !['if', 'while', 'for', 'switch', 'return', 'sizeof'].includes(rawCallMatch[1]);

  if (type !== 'manual_input' && rawInput) {
    return 'This raw C++ reads input. Use Manual Input for cin/read steps.';
  }
  if (type !== 'io' && rawOutput) {
    return 'This raw C++ writes output. Use Output for cout/display steps.';
  }
  if ((type === 'process' || type === 'io' || type === 'manual_input') && rawFile) {
    return 'File/document steps are outside this simplified flowchart-to-code palette. Keep build-mode graphs to variables, input, output, decisions, arrays, and helper calls.';
  }
  if (type !== 'database' && rawData && !rawInput && !rawOutput) {
    return 'This raw C++ represents array/storage or dynamic memory work. Use the Stored Data shape.';
  }
  if (type !== 'predefined' && type !== 'off_page_connector' && rawCall && !rawInput && !rawOutput) {
    return 'This raw C++ is a helper/function call. Use the Predefined Process shape. On-page and off-page connectors are routing references, not function-call shapes.';
  }
  if (type === 'off_page_connector' && rawCall && !rawInput && !rawOutput) {
    return 'Off-page connectors are cross-page references, not function calls. Use the Predefined Process shape for helper/function calls.';
  }

  if (looksLikeRawCpp(instruction)) {
    return null;
  }

  const isInput = /^(ask|read|get|input|enter)\b/i.test(cleaned);
  const isOutput = /^(display|show|print|output|tell)\b/i.test(cleaned);
  const isFile = /^(write|save|open|read|create|load)\b/i.test(cleaned) && /\.(?:txt|csv|json|xml|log)\b/i.test(cleaned);
  const isDelay = /^(wait|pause|delay)\b/i.test(cleaned);
  const isCall = /^(call|run|use|execute)\b/i.test(cleaned) || /^[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(cleaned);
  const isData = /\b(array|list|table|grid|matrix|cube|data store|database)\b/i.test(cleaned)
    || /\b(?:index|position|row|column|col|layer|depth)\b/i.test(cleaned);

  if (type !== 'manual_input' && isInput) {
    return 'This is an input step. Use Manual Input for cin/read steps.';
  }
  if (type !== 'io' && isOutput) {
    return 'This is an output step. Use Output for cout/display steps.';
  }
  if ((type === 'process' || type === 'io' || type === 'manual_input') && isFile) {
    return 'File/document steps are outside this simplified flowchart-to-code palette. Keep build-mode graphs to variables, input, output, decisions, arrays, and helper calls.';
  }
  if (type !== 'delay' && isDelay) {
    return 'Wait/delay steps are outside this simplified flowchart-to-code palette. Model the next meaningful program step instead.';
  }
  if (type !== 'predefined' && type !== 'off_page_connector' && isCall) {
    return 'This is a helper/function call. Use the Predefined Process shape. On-page and off-page connectors are routing references, not function-call shapes.';
  }
  if (type === 'off_page_connector' && isCall) {
    return 'Off-page connectors are cross-page references, not function calls. Use the Predefined Process shape for helper/function calls.';
  }
  if (type !== 'database' && isData && !isFile) {
    return 'This is a stored-data/array step. Use the Stored Data shape.';
  }
  if (type === 'predefined' && (isInput || isOutput || isFile || isDelay || isData)) {
    return 'This shape is for a helper/function call. Use the matching input, output, or stored-data shape instead.';
  }
  if (type === 'delay' && (isInput || isOutput || isFile || isCall || isData)) {
    return 'This shape is for a wait/delay step. Use the matching shape for this instruction.';
  }

  return null;
}

function pseudocodeStyleIssue(node: Node): string | null {
  const type = String(node.type ?? '');
  if (!PSEUDOCODE_NODE_TYPES.has(type)) return null;

  const instruction = getInstruction(node);
  if (!instruction || EXECUTABLE_PLACEHOLDERS.has(instruction.toLowerCase())) return null;
  if (looksLikeRawCpp(instruction)) {
    return 'This works, but friendly wording is easier here. Try "set score to score plus 10" instead of "score = score + 10;".';
  }

  const generated = translateFlowchartInstruction(instruction, type as Parameters<typeof translateFlowchartInstruction>[1]);
  if (generated) {
    return null;
  }

  switch (type) {
    case 'manual_input':
      return startsLikePseudocode(instruction, /^(ask|read|get|input|enter)\b/i)
        ? null
        : 'Input shapes should say what to read. Example: "ask the user for their name" or just "enter age".';
    case 'io':
      return startsLikePseudocode(instruction, /^(display|show|print|output|tell|write)\b/i)
        ? null
        : 'Output shapes should say what to show. Example: "display hello world" or "show the value of total".';
    case 'decision':
      return null;
    case 'predefined':
      return startsLikePseudocode(instruction, /^(call|run|use|execute)\b/i)
        ? null
        : 'Function-call shapes should name one helper call. Example: "call calculate result with score".';
    case 'delay':
      return startsLikePseudocode(instruction, /^(wait|pause|delay)\b/i)
        ? null
        : 'Delay shapes should read like a wait step. Example: "wait 2 seconds".';
    case 'document':
      return startsLikePseudocode(instruction, /^(write|save|open|read|create|load)\b/i)
        ? null
        : 'Document shapes should describe file or report work. Example: "write report.txt".';
    case 'database':
      return startsLikePseudocode(instruction, /^(create|store|save|load|read|update|set up|make)\b/i)
        ? null
        : 'Stored Data shapes should describe stored data. Example: "create a list of scores" or "store 75 in score".';
    default:
      return 'Process shapes should describe one simple step. Examples: "score starts at zero", "add 1 to score", or "set total to price plus tax".';
  }
}

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

  const unsupportedCppIssues = [
    ...nodes.flatMap(detectUnsupportedCpp),
    ...detectFunctionOverloadNodes(nodes),
  ];
  unsupportedCppIssues.forEach(issue => issues.push(issue));

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
  const startNodes = nodes.filter(isStartTerminator);
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
  const returnTerminators = nodes.filter(isReturnTerminator);
  if (returnTerminators.length > 0) {
    push('error', 'RETURN_USES_TERMINATOR_SHAPE',
      'Return is an executable C++ statement, not a Start/End terminator. Use a Process node with code like "return 0;" instead.',
      { nodeIds: returnTerminators.map(n => n.id) });
  }

  const endNodes = nodes.filter(isEndTerminator);
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

    // 8b. Decision exits:
    // One exit is a valid one-arm if. Two exits produce if/else. More than two
    // is ambiguous and would be silently truncated by the generator.
    if (out.length > 2) {
      push('error', 'DECISION_REQUIRES_TWO_BRANCHES',
        `Decision "${lbl}" has ${out.length} outgoing edge(s). Use one outgoing edge for a one-arm if, or exactly two edges labelled "true" and "false" for if/else.`,
        { nodeIds: [d.id], edgeIds: out.map(e => e.id) });
    }

    // 8c. Two-way decisions must be labelled true/false. A one-way decision may
    // be unlabelled; the generator treats it as the condition being true.
    if (out.length > 1) {
      const unlabelled = out.filter(e => !isBranchLabel(str(e.label).toLowerCase()));

      if (unlabelled.length > 0) {
        push('error', 'DECISION_UNLABELLED_EDGES',
          `Decision "${lbl}" has ${unlabelled.length} outgoing edge(s) without a "true" or "false" label. ` +
          'Label each decision edge so code generation can map the branches correctly.',
          { nodeIds: [d.id], edgeIds: unlabelled.map(e => e.id) });
      }
    }

    if (out.length > 0) {
      const trueEdges  = out.filter(e => isTrueLabel(str(e.label).toLowerCase()));
      const falseEdges = out.filter(e => isFalseLabel(str(e.label).toLowerCase()));
      if (out.length > 1 && trueEdges.length === 0) {
        push('error', 'DECISION_MISSING_TRUE',
          `Decision "${lbl}" is missing a "true" branch.`,
          { nodeIds: [d.id] });
      } else if (trueEdges.length > 1) {
        push('error', 'DECISION_DUPLICATE_TRUE',
          `Decision "${lbl}" has ${trueEdges.length} edges labelled "true". Only one "true" branch is allowed.`,
          { nodeIds: [d.id], edgeIds: trueEdges.map(e => e.id) });
      }
      if (out.length > 1 && falseEdges.length === 0) {
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
        'Decision node needs one clear condition. You can type friendly wording like "if age is greater than 17" or C++ like "age > 17".',
        { nodeIds: [d.id] });
    }
  }

  // ── 9. Non-decision nodes with no outgoing edge (dead ends) ───────────────
  const reachableFromStart = startNodes.length === 1
    ? reachableFrom(startNodes[0].id, edges)
    : null;

  const deadEnds = nodes.filter(n => {
    if (n.type === 'terminator') return false; // End nodes are intentional dead ends
    if (reachableFromStart && !reachableFromStart.has(n.id)) return false; // already reported by reachability
    const out = outEdges.get(n.id) ?? [];
    return out.length === 0 && connectedIds.has(n.id); // connected but no output
  });
  if (deadEnds.length > 0) {
    push('error', 'DEAD_END_NODES',
      `${deadEnds.length} reachable non-terminator node(s) have no outgoing edge — execution gets stuck on that path: ` +
      deadEnds.map(n => `"${str(n.data?.label) || n.type}"`).join(', ') +
      '. Connect each one to the next step, a merge point, or the End node.',
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

  // ── 11. Pseudocode-style guidance ─────────────────────────────────────────
  const shapeMismatches = nodes
    .map(node => ({ node, message: shapeMismatchIssue(node) }))
    .filter((entry): entry is { node: Node; message: string } => !!entry.message);

  if (shapeMismatches.length > 0) {
    push(
      'error',
      'FLOWCHART_SHAPE_MISMATCH',
      `${shapeMismatches.length} node(s) use the wrong flowchart shape. ${shapeMismatches[0].message}`,
      { nodeIds: shapeMismatches.map(entry => entry.node.id) },
    );
  }

  const pseudocodeIssues = nodes
    .map(node => ({ node, message: pseudocodeStyleIssue(node) }))
    .filter((entry): entry is { node: Node; message: string } => !!entry.message);

  if (pseudocodeIssues.length > 0) {
    push(
      'warning',
      'PSEUDOCODE_STYLE_GUIDANCE',
      `${pseudocodeIssues.length} node(s) should be rewritten in pseudocode style. ${pseudocodeIssues[0].message}`,
      { nodeIds: pseudocodeIssues.map(entry => entry.node.id) },
    );
  }

  // ── 12. Placeholder nodes with no real code ───────────────────────────────
  const REQUIRED_CODE_NODE_TYPES = new Set(['process', 'io', 'manual_input', 'predefined',
                                            'delay', 'database', 'document']);
  const missingCode = nodes.filter(n => {
    if (!REQUIRED_CODE_NODE_TYPES.has(String(n.type ?? ''))) return false;
    return !str(n.data?.code);
  });
  if (missingCode.length > 0) {
    const placeholders = missingCode.filter(n => !hasUsableLabel(n));
    const labelled = missingCode.filter(n => hasUsableLabel(n));

    if (placeholders.length > 0) {
      push('error', 'MISSING_NODE_CODE',
        `${placeholders.length} executable node(s) still use a placeholder and have no instruction. Add the missing step text before generating, for example "set score to zero", "ask for age", or "display hello".`,
        { nodeIds: placeholders.map(n => n.id) });
    }

    if (labelled.length > 0) {
      push('warning', 'NODE_CODE_FROM_LABEL',
        `${labelled.length} executable node(s) have no separate instruction, so generation will use the label text. Add a simple sentence if the label is only a title.`,
        { nodeIds: labelled.map(n => n.id) });
    }
  }

  const structuralLabelsOnly = nodes.filter(n => {
    if (REQUIRED_CODE_NODE_TYPES.has(String(n.type ?? ''))) return false;
    if (n.type === 'decision' || n.type === 'terminator') return false;
    return !str(n.data?.code) && hasUsableLabel(n);
  });
  if (structuralLabelsOnly.length > 0) {
    push('warning', 'STRUCTURAL_LABEL_ONLY',
      `${structuralLabelsOnly.length} routing node(s) have labels but no code. They will be treated as flowchart structure, not C++ statements.`,
      { nodeIds: structuralLabelsOnly.map(n => n.id) });
  }

  return finish(issues);
}
