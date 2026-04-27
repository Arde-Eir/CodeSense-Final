import type { Node, Edge } from '@xyflow/react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NodeData {
  label?: unknown;
  code?: unknown;
  [key: string]: unknown;
}

// ─── Grammar-Aligned Reserved Words ──────────────────────────────────────────

const RESERVED_WORDS = new Set([
  'if', 'else', 'while', 'for', 'return', 'int', 'float', 'double',
  'char', 'bool', 'void', 'using', 'namespace', 'auto', 'const',
  'static', 'extern', 'unsigned', 'signed', 'sizeof', 'switch',
  'case', 'default', 'break', 'continue', 'do', 'long', 'string',
  'volatile', 'inline', 'virtual', 'public', 'private', 'protected',
  'class', 'struct', 'enum', 'typedef', 'typename', 'template',
  'this', 'new', 'delete', 'nullptr', 'try', 'catch', 'throw',
  'override', 'final', 'true', 'false',
]);

// ─── Grammar-Aligned Types ────────────────────────────────────────────────────

const BASE_TYPES = [
  'long long', 'long double', 'unsigned int',
  'int', 'float', 'double', 'char', 'bool', 'void', 'string', 'auto',
  'typename', 'class', 'struct', 'enum',
];

const TYPE_MODIFIERS = [
  'const', 'static', 'extern', 'volatile', 'unsigned', 'signed',
  'inline', 'virtual', 'public', 'private', 'protected', 'override', 'final',
];

// ─── Auto-Include Detection ───────────────────────────────────────────────────

const CPP_INCLUDES: Record<string, string> = {
  'cout':          'iostream',
  'cin':           'iostream',
  'endl':          'iostream',
  'cerr':          'iostream',
  'string':        'string',
  'getline':       'string',
  'stoi':          'string',
  'stod':          'string',
  'stof':          'string',
  'to_string':     'string',
  'vector':        'vector',
  'array':         'array',
  'map':           'map',
  'unordered_map': 'unordered_map',
  'set':           'set',
  'unordered_set': 'unordered_set',
  'stack':         'stack',
  'queue':         'queue',
  'deque':         'deque',
  'list':          'list',
  'pair':          'utility',
  'make_pair':     'utility',
  'sqrt':          'cmath',
  'pow':           'cmath',
  'abs':           'cmath',
  'floor':         'cmath',
  'ceil':          'cmath',
  'round':         'cmath',
  'log':           'cmath',
  'exp':           'cmath',
  'sin':           'cmath',
  'cos':           'cmath',
  'tan':           'cmath',
  'rand':          'cstdlib',
  'srand':         'cstdlib',
  'exit':          'cstdlib',
  'sleep':         'cstdlib',   // delay nodes
  'printf':        'cstdio',
  'scanf':         'cstdio',
  'sprintf':       'cstdio',
  'strlen':        'cstring',
  'strcpy':        'cstring',
  'strcmp':        'cstring',
  'sort':          'algorithm',
  'reverse':       'algorithm',
  'find':          'algorithm',
  'min':           'algorithm',
  'max':           'algorithm',
  'fill':          'algorithm',
  'count':         'algorithm',
  'accumulate':    'numeric',
  'iota':          'numeric',
  'INT_MAX':       'climits',
  'INT_MIN':       'climits',
  'FLT_MAX':       'cfloat',
  'setw':          'iomanip',
  'setprecision':  'iomanip',
  'fixed':         'iomanip',
  'fstream':       'fstream',   // document nodes
  'ofstream':      'fstream',
  'ifstream':      'fstream',
  'chrono':        'chrono',    // delay nodes (std::chrono)
};

const INCLUDE_ORDER = [
  'iostream', 'fstream', 'string', 'vector', 'array', 'map', 'unordered_map',
  'set', 'unordered_set', 'stack', 'queue', 'deque', 'list',
  'utility', 'algorithm', 'numeric', 'cmath', 'cstdlib',
  'cstdio', 'cstring', 'climits', 'cfloat', 'iomanip', 'chrono',
];

const str = (v: unknown): string => String(v ?? '').trim();

function detectIncludes(allCode: string[]): string[] {
  const needed = new Set<string>(['iostream']);
  const combined = allCode.join(' ');

  for (const [keyword, header] of Object.entries(CPP_INCLUDES)) {
    if (combined.includes(keyword)) needed.add(header);
  }
  if (/\bvector\s*</.test(combined))   needed.add('vector');
  if (/\bmap\s*</.test(combined))      needed.add('map');
  if (/\bset\s*</.test(combined))      needed.add('set');
  if (/\bstack\s*</.test(combined))    needed.add('stack');
  if (/\bqueue\s*</.test(combined))    needed.add('queue');
  if (/\bpair\s*</.test(combined))     needed.add('utility');
  if (/\bofstream\b|\bifstream\b/.test(combined)) needed.add('fstream');

  const sorted = INCLUDE_ORDER.filter(h => needed.has(h));
  const rest = [...needed].filter(h => !INCLUDE_ORDER.includes(h)).sort();
  return [...sorted, ...rest];
}

// ─── Variable Declaration Parser ──────────────────────────────────────────────

interface VarDecl {
  modifiers: string[];
  varType: string;
  name: string;
  value?: string;
  isArray: boolean;
  arraySize?: string;
}

function isValidIdentifier(name: string): boolean {
  if (RESERVED_WORDS.has(name)) return false;
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

function parseVarDecl(code: string): VarDecl | null {
  const clean = code.replace(/;\s*$/, '').trim();
  const modifiers: string[] = [];
  let rest = clean;

  for (const mod of TYPE_MODIFIERS) {
    const modRe = new RegExp(`^${mod}\\s+`);
    if (modRe.test(rest)) {
      modifiers.push(mod);
      rest = rest.replace(modRe, '').trim();
    }
  }

  let matchedType: string | null = null;
  for (const bt of BASE_TYPES) {
    const typeRe = new RegExp(`^${bt.replace(' ', '\\s+')}\\s+`);
    if (typeRe.test(rest)) {
      matchedType = bt;
      rest = rest.replace(typeRe, '').trim();
      break;
    }
  }

  if (!matchedType) return null;

  let ptrSuffix = '';
  const ptrMatch = rest.match(/^([*&]+)\s*/);
  if (ptrMatch) {
    ptrSuffix = ptrMatch[1];
    rest = rest.slice(ptrMatch[0].length).trim();
  }

  const arrayMatch = rest.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\[([^\]]*)\](?:\s*=\s*(.+))?$/);
  if (arrayMatch) {
    const name = arrayMatch[1];
    if (!isValidIdentifier(name)) return null;
    return {
      modifiers,
      varType: matchedType + ptrSuffix,
      name, isArray: true,
      arraySize: arrayMatch[2].trim(),
      value: arrayMatch[3]?.trim(),
    };
  }

  const assignMatch = rest.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*=\s*(.+))?$/);
  if (assignMatch) {
    const name = assignMatch[1];
    if (!isValidIdentifier(name)) return null;
    return {
      modifiers,
      varType: matchedType + ptrSuffix,
      name, isArray: false,
      value: assignMatch[2]?.trim(),
    };
  }

  return null;
}

// ─── Statement Normalizer ─────────────────────────────────────────────────────

function normalizeStatement(code: string): string {
  const s = code.trim();
  if (!s) return '';
  if (s.endsWith(';') || s.endsWith('}')) return s;
  if (s === 'break' || s === 'continue') return s + ';';
  if (/^return(\s|$)/.test(s)) return s.endsWith(';') ? s : s + ';';
  if (/^(break|continue)\s/.test(s)) return s.endsWith(';') ? s : s + ';';
  if (/^(if|else|while|for|do|switch)\s*[\s({]/.test(s)) return s;
  if (s === 'else' || s === 'do') return s;
  return s + ';';
}

// ─── Node-type specific code emitters ────────────────────────────────────────
// Each matches the grammar construct for that ISO 5807 shape.

/** io node → grammar StreamStatement (cout) */
function emitIO(label: string, code: string): string {
  const c = code.trim();
  const l = label.toLowerCase();

  if (!c) {
    if (l.includes('output') || l.includes('print') || l.includes('display')
     || l.includes('show') || l.includes('write')) {
      return `cout << "" << endl;`;
    }
    if (l.includes('input') || l.includes('read') || l.includes('get') || l.includes('enter')) {
      return `cin >> variable;`;
    }
    return `// I/O: ${label}`;
  }

  if (c.includes('cout') || c.includes('cin') || c.includes('printf') || c.includes('scanf')) {
    return normalizeStatement(c);
  }
  if (l.includes('output') || l.includes('print') || l.includes('display') || l.includes('write')) {
    const val = c.includes('"') ? c : `${c} << endl`;
    return `cout << ${val};`;
  }
  if (l.includes('input') || l.includes('read') || l.includes('enter')) {
    return `cin >> ${c};`;
  }
  return `cout << ${c} << endl;`;
}

/** manual_input node → grammar StreamStatement (cin) */
function emitManualInput(label: string, code: string): string {
  const c = code.trim();
  const l = label.toLowerCase();

  if (!c) {
    // Derive variable name from label if possible
    const words = l.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    const varName = words.find(w => !['input', 'enter', 'read', 'get', 'cin', 'the', 'a', 'an'].includes(w)) ?? 'value';
    return `cin >> ${varName};`;
  }

  // Already a cin/scanf statement
  if (c.includes('cin') || c.includes('scanf')) {
    return normalizeStatement(c);
  }

  // Treat code as the variable to read into
  return `cin >> ${c.replace(/;$/, '')};`;
}

/** predefined node → grammar FunctionCall (predefined process) */
function emitPredefined(label: string, code: string): string {
  const c = code.trim();
  const l = label.trim();

  if (!c) {
    // Convert label like "Calculate Damage" → calculateDamage()
    const words = l.split(/\s+/);
    const camel = words
      .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('');
    if (isValidIdentifier(camel)) return `${camel}();`;
    return `// Call: ${l}`;
  }

  // Already looks like a function call
  if (/\w+\s*\(/.test(c)) return normalizeStatement(c);

  // Wrap in a call if just an identifier was typed
  if (isValidIdentifier(c.replace(/;$/, ''))) return `${c.replace(/;$/, '')}();`;

  return normalizeStatement(c);
}

/** document node → grammar (file I/O comment or ofstream block) */
function emitDocument(label: string, code: string): string {
  const c = code.trim();
  const l = label.trim();

  if (!c) {
    // Descriptive comment — document nodes often represent output files/reports
    return `// Document: ${l}`;
  }

  // If the user wrote actual fstream code, emit as-is
  if (c.includes('ofstream') || c.includes('ifstream') || c.includes('fstream')) {
    return normalizeStatement(c);
  }

  // If it looks like a filename, wrap in a comment
  if (/\.txt|\.csv|\.json|\.xml|\.log/.test(c)) {
    return `// Write to: ${c}`;
  }

  return normalizeStatement(c);
}

/** delay node → grammar ExpressionStatement (sleep / pause) */
function emitDelay(label: string, code: string): string {
  const c = code.trim();
  const l = label.toLowerCase();

  if (!c) {
    // Try to extract a duration from the label
    const msMatch = l.match(/(\d+)\s*ms/);
    const sMatch  = l.match(/(\d+)\s*s/);
    if (msMatch) return `sleep(${msMatch[1]});  // ${msMatch[1]}ms delay`;
    if (sMatch)  return `sleep(${sMatch[1]});`;
    return `sleep(1);  // Delay / Wait`;
  }

  if (c.includes('sleep') || c.includes('usleep') || c.includes('this_thread')) {
    return normalizeStatement(c);
  }

  // Bare number → treat as seconds
  if (/^\d+$/.test(c)) return `sleep(${c});`;

  return normalizeStatement(c);
}

/** database node → grammar VariableDeclaration or ExpressionStatement */
function emitDatabase(label: string, code: string): string {
  const c = code.trim();
  const l = label.trim();

  if (!c) {
    // Suggest a vector declaration based on label
    const words = l.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    const varName = words
      .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('') || 'dataStore';
    if (isValidIdentifier(varName)) return `// Data Store: ${varName}`;
    return `// Database / Store: ${l}`;
  }

  return normalizeStatement(c);
}

// ─── Graph Helpers ────────────────────────────────────────────────────────────

function buildAdjacency(edges: Edge[], nodeIds: Set<string>): Map<string, Edge[]> {
  const adj = new Map<string, Edge[]>();
  for (const e of edges) {
    // HARDENING: skip dangling edges — edges referencing a node that was
    // deleted but whose ref lingers in state. Without this, traverse() can
    // dereference a missing node and emit malformed code.
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e);
  }
  for (const [, outEdges] of adj) {
    outEdges.sort((a, b) => {
      const aL = str(a.label).toLowerCase();
      const bL = str(b.label).toLowerCase();
      const aTrue = aL === 'true' || aL === 'yes';
      const bTrue = bL === 'true' || bL === 'yes';
      return aTrue === bTrue ? 0 : aTrue ? -1 : 1;
    });
  }
  return adj;
}

function findStartNode(nodes: Node<NodeData>[], edges: Edge[]): Node<NodeData> | undefined {
  const explicit = nodes.find(
    n => n.type === 'terminator' && str(n.data.label).toLowerCase() === 'start'
  );
  if (explicit) return explicit;
  const targetIds = new Set(edges.map(e => e.target));
  return nodes.find(n => !targetIds.has(n.id));
}

function resolveCode(node: Node<NodeData>): string {
  const code = str(node.data.code);
  const label = str(node.data.label);
  return code || label;
}

function collectAllCode(nodes: Node<NodeData>[]): string[] {
  return nodes
    // Structural routing nodes don't emit C++ statements
    .filter(n => !['terminator', 'connector', 'off_page_connector', 'junction'].includes(String(n.type ?? '')))
    .map(n => resolveCode(n))
    .filter(Boolean);
}

function findMergeNode(
  aId: string | undefined,
  bId: string | undefined,
  adj: Map<string, Edge[]>
): string | undefined {
  if (!aId || !bId) return undefined;
  if (aId === bId) return aId;

  const aReachable = new Set<string>();
  const queue = [aId];
  while (queue.length) {
    const id = queue.shift()!;
    if (aReachable.has(id)) continue;
    aReachable.add(id);
    for (const e of adj.get(id) ?? []) queue.push(e.target);
  }

  const bQueue = [bId];
  const bVisited = new Set<string>();
  while (bQueue.length) {
    const id = bQueue.shift()!;
    if (bVisited.has(id)) continue;
    bVisited.add(id);
    if (aReachable.has(id)) return id;
    for (const e of adj.get(id) ?? []) bQueue.push(e.target);
  }
  return undefined;
}

// ─── Loop Detection ───────────────────────────────────────────────────────────

function reachesNode(startId: string, targetId: string, adj: Map<string, Edge[]>): boolean {
  if (startId === targetId) return true;
  const visited = new Set<string>();
  const queue: string[] = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    if (id === targetId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const e of adj.get(id) ?? []) {
      if (!visited.has(e.target)) queue.push(e.target);
    }
  }
  return false;
}

/**
 * A decision node represents a loop only when EXACTLY ONE branch loops back to
 * it. If both branches eventually loop back, the decision is an `if` nested
 * inside an outer loop (the outer loop is what makes both branches return).
 * If neither branch loops back, it's a plain `if`.
 */
function detectLoop(
  nodeId: string,
  trueEdge: Edge | undefined,
  falseEdge: Edge | undefined,
  adj: Map<string, Edge[]>
): { isLoop: boolean; bodyEdge?: Edge; exitEdge?: Edge } {
  const trueLoops  = !!(trueEdge  && reachesNode(trueEdge.target,  nodeId, adj));
  const falseLoops = !!(falseEdge && reachesNode(falseEdge.target, nodeId, adj));

  if (trueLoops && !falseLoops) return { isLoop: true,  bodyEdge: trueEdge,  exitEdge: falseEdge };
  if (falseLoops && !trueLoops) return { isLoop: true,  bodyEdge: falseEdge, exitEdge: trueEdge  };
  return { isLoop: false };
}

// ─── Main Traversal ───────────────────────────────────────────────────────────

function traverse(
  nodeId: string,
  nodeMap: Map<string, Node<NodeData>>,
  adj: Map<string, Edge[]>,
  visited: Set<string>,
  indent: string,
  stopAt: Set<string>,
  declaredVars: Set<string>
): string {
  let output = '';
  let currentId: string | undefined = nodeId;

  while (currentId && !visited.has(currentId) && !stopAt.has(currentId)) {
    const node = nodeMap.get(currentId);
    if (!node) break;

    visited.add(currentId);
    const outEdges: Edge[] = adj.get(currentId) ?? [];

    // ── Terminator (Start / End) — no emitted code ────────────────────────────
    if (node.type === 'terminator') {
      currentId = outEdges[0]?.target;
      continue;
    }

    // ── Connector / Off-page / Junction — structural only, no emitted code ─
    if (node.type === 'connector' || node.type === 'off_page_connector') {
      currentId = outEdges[0]?.target;
      continue;
    }
    if (node.type === 'junction') {
      currentId = outEdges[0]?.target;
      continue;
    }

    // ── Decision → IfStatement or WhileLoop ──────────────────────────────────
    if (node.type === 'decision') {
      const rawCondition = resolveCode(node);
      const condition = rawCondition
        .replace(/^[({[\s]+|[)}\]\s]+$/g, '')
        .trim() || '/* condition */';

      const trueEdge = outEdges.find(e => {
        const l = str(e.label).toLowerCase();
        return l === 'true' || l === 'yes';
      }) ?? outEdges[0];

      const falseEdge: Edge | undefined = outEdges.find(e => {
        const l = str(e.label).toLowerCase();
        return l === 'false' || l === 'no';
      }) ?? outEdges[1];

      const loopInfo = detectLoop(currentId, trueEdge, falseEdge, adj);

      if (loopInfo.isLoop) {
        // The body is the branch that loops back to the decision; the exit is
        // the other branch (where execution continues after the loop). If the
        // looping branch is the FALSE branch, we negate the condition so the
        // emitted while reads naturally.
        const bodyEdge = loopInfo.bodyEdge;
        const exitEdge = loopInfo.exitEdge;
        const negate   = bodyEdge === falseEdge;
        const whileCondition = negate ? `!(${condition})` : condition;

        output += `${indent}while (${whileCondition}) {\n`;
        if (bodyEdge) {
          // Body must terminate when it reaches back to the decision — pass
          // the decision node id as a stop so we don't re-emit it.
          const stopAtBody = new Set([currentId]);
          output += traverse(bodyEdge.target, nodeMap, adj, new Set(visited), indent + '    ', stopAtBody, declaredVars);
        }
        output += `${indent}}\n`;

        currentId = exitEdge?.target;
        continue;
      }

      // Plain if / if-else
      const mergeNode = findMergeNode(trueEdge?.target, falseEdge?.target, adj);
      const mergeSet  = mergeNode ? new Set([mergeNode]) : new Set<string>();

      output += `${indent}if (${condition}) {\n`;
      if (trueEdge && trueEdge.target !== mergeNode) {
        output += traverse(trueEdge.target, nodeMap, adj, new Set(visited), indent + '    ', mergeSet, declaredVars);
      }
      output += `${indent}}`;
      if (falseEdge && falseEdge.target !== mergeNode) {
        output += ` else {\n`;
        output += traverse(falseEdge.target, nodeMap, adj, new Set(visited), indent + '    ', mergeSet, declaredVars);
        output += `${indent}}`;
      }
      output += '\n';

      currentId = mergeNode;
      continue;
    }

    // ── I/O (cout) ────────────────────────────────────────────────────────────
    if (node.type === 'io') {
      output += `${indent}${emitIO(str(node.data.label), str(node.data.code))}\n`;
      currentId = outEdges[0]?.target;
      continue;
    }

    // ── Manual Input (cin) ────────────────────────────────────────────────────
    if (node.type === 'manual_input') {
      output += `${indent}${emitManualInput(str(node.data.label), str(node.data.code))}\n`;
      currentId = outEdges[0]?.target;
      continue;
    }

    // ── Predefined Process (function call) ────────────────────────────────────
    if (node.type === 'predefined') {
      output += `${indent}${emitPredefined(str(node.data.label), str(node.data.code))}\n`;
      currentId = outEdges[0]?.target;
      continue;
    }

    // ── Document (file output / report) ──────────────────────────────────────
    if (node.type === 'document') {
      output += `${indent}${emitDocument(str(node.data.label), str(node.data.code))}\n`;
      currentId = outEdges[0]?.target;
      continue;
    }

    // ── Delay (sleep / wait) ─────────────────────────────────────────────────
    if (node.type === 'delay') {
      output += `${indent}${emitDelay(str(node.data.label), str(node.data.code))}\n`;
      currentId = outEdges[0]?.target;
      continue;
    }

    // ── Database / Store (data container) ────────────────────────────────────
    if (node.type === 'database') {
      output += `${indent}${emitDatabase(str(node.data.label), str(node.data.code))}\n`;
      currentId = outEdges[0]?.target;
      continue;
    }

    // ── Process node → VariableDeclaration or ExpressionStatement ────────────
    {
      const rawCode = resolveCode(node);
      const label = str(node.data.label);

      if (!rawCode || rawCode === 'Process' || (rawCode === label && !rawCode.includes('=') && !rawCode.includes('('))) {
        if (label && label !== 'Process' && label.length < 80) {
          output += `${indent}// ${label}\n`;
        } else {
          output += `${indent}// TODO: implement this step\n`;
        }
      } else {
        const decl = parseVarDecl(rawCode);
        if (decl) {
          if (declaredVars.has(decl.name)) {
            if (decl.value !== undefined) {
              output += `${indent}${decl.name} = ${decl.value};\n`;
            }
          } else {
            declaredVars.add(decl.name);
            const modPart = decl.modifiers.length ? decl.modifiers.join(' ') + ' ' : '';
            if (decl.isArray) {
              const init = decl.value ? ` = ${decl.value}` : '';
              output += `${indent}${modPart}${decl.varType} ${decl.name}[${decl.arraySize}]${init};\n`;
            } else {
              const init = decl.value !== undefined ? ` = ${decl.value}` : '';
              output += `${indent}${modPart}${decl.varType} ${decl.name}${init};\n`;
            }
          }
        } else {
          if (rawCode.includes('\n') || rawCode.trimEnd().endsWith('}')) {
            output += rawCode.split('\n').map(l => `${indent}${l}`).join('\n') + '\n';
          } else {
            output += `${indent}${normalizeStatement(rawCode)}\n`;
          }
        }
      }

      currentId = outEdges[0]?.target;
    }
  }

  return output;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const generateCppFromGraph = (nodes: Node[], edges: Edge[]): string => {
  if (nodes.length === 0) {
    return [
      '#include <iostream>',
      'using namespace std;',
      '',
      'int main() {',
      '    // No nodes yet — use ADD NODE to build your flowchart',
      '    return 0;',
      '}',
      '',
    ].join('\n');
  }

  const typedNodes = nodes as Node<NodeData>[];
  const nodeMap = new Map(typedNodes.map(n => [n.id, n]));
  const nodeIdSet = new Set(nodeMap.keys());
  const adj = buildAdjacency(edges, nodeIdSet);

  const startNode = findStartNode(typedNodes, edges);
  if (!startNode) {
    return [
      '#include <iostream>',
      'using namespace std;',
      '',
      'int main() {',
      '    // No Start node found — add a Start terminator to your flowchart',
      '    return 0;',
      '}',
      '',
    ].join('\n');
  }

  const allCode = collectAllCode(typedNodes);
  const includes = detectIncludes(allCode);
  const declaredVars = new Set<string>();

  const bodyLines = traverse(
    startNode.id,
    nodeMap,
    adj,
    new Set(),
    '    ',
    new Set(),
    declaredVars
  );

  return [
    ...includes.map(h => `#include <${h}>`),
    'using namespace std;',
    '',
    'int main() {',
    bodyLines.trimEnd() || '    // Empty graph — connect your nodes',
    '    return 0;',
    '}',
    '',
  ].join('\n');
};