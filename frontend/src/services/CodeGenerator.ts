import type { Node, Edge } from '@xyflow/react'
import {
  detectIncludes,
  emitDatabase,
  emitDelay,
  emitDocument,
  emitIO,
  emitManualInput,
  emitPredefined,
  isBareIdentifierStatement,
  isCallConnectorEdge,
  isTopLevelDeclaration,
  normalizeCondition,
  normalizeHumanStatement,
  normalizeStatement,
  normalizeTopLevelDeclaration,
  parseFunctionDefinitionInstruction,
  parseHumanCallInstruction,
  parseVarDecl,
  str,
  type NodeData,
} from './codeGeneration/instructions'
export {
  FLOWCHART_CODE_TOPICS,
  translateFlowchartInstruction,
} from './codeGeneration/instructions'
export type { FlowchartInstructionKind } from './codeGeneration/instructions'

function buildAdjacency(edges: Edge[], nodeIds: Set<string>): Map<string, Edge[]> {
  const adj = new Map<string, Edge[]>();
  for (const e of edges) {
    if (isCallConnectorEdge(e)) continue;
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
    // Pure structural routing nodes don't emit C++ statements
    .filter(n => !['terminator', 'connector', 'junction'].includes(String(n.type ?? '')))
    .map(n => resolveCode(n))
    .filter(Boolean);
}

function collectTopLevelDeclarations(nodes: Node<NodeData>[]): string[] {
  const seen = new Set<string>();
  const declarations: string[] = [];
  for (const node of nodes) {
    if (node.type === 'terminator' || node.type === 'junction' || node.type === 'connector') continue;
    const raw = resolveCode(node);
    if (!isTopLevelDeclaration(raw)) continue;
    const normalized = normalizeTopLevelDeclaration(raw);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    declarations.push(normalized);
  }
  return declarations;
}

function collectGeneratedHelperDeclarations(nodes: Node<NodeData>[]): string[] {
  const seen = new Set<string>();
  const declarations: string[] = [];

  for (const node of nodes) {
    if (node.type !== 'predefined' && node.type !== 'off_page_connector') continue;
    const call = parseHumanCallInstruction(resolveCode(node));
    if (!call?.helperBody || seen.has(call.fnName)) continue;

    const body = normalizeHumanStatement(call.helperBody, 'process')
      ?? normalizeHumanStatement(call.helperBody, 'io')
      ?? normalizeStatement(call.helperBody);

    seen.add(call.fnName);
    const params = call.argNames.map(name => `int ${name}`).join(', ');

    declarations.push([
      `void ${call.fnName}(${params}) {`,
      `    ${body}`,
      '}',
    ].join('\n'));
  }

  return declarations;
}

function collectManualHelperDeclarations(
  nodes: Node<NodeData>[],
  adj: Map<string, Edge[]>,
): string[] {
  const seen = new Set<string>();
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const declarations: string[] = [];

  for (const node of nodes) {
    if (node.type !== 'predefined') continue;

    const definition = parseFunctionDefinitionInstruction(node);
    if (!definition || definition.fnName === 'main' || seen.has(definition.fnName)) continue;

    const firstBodyEdge = adj.get(node.id)?.[0];
    const body = firstBodyEdge
      ? traverse(
          firstBodyEdge.target,
          nodeMap,
          adj,
          new Set([node.id]),
          '    ',
          new Set(),
        ).trimEnd()
      : '';

    seen.add(definition.fnName);
    declarations.push([
      `${definition.returnType} ${definition.fnName}(${definition.params}) {`,
      body || '    // Empty helper function',
      '}',
    ].join('\n'));
  }

  return declarations;
}

function collectDeclaredVariables(code: string): Set<string> {
  const declarations = new Set<string>();
  for (const line of code.split('\n')) {
    const decl = parseVarDecl(line.trim());
    if (decl) declarations.add(decl.name);
  }
  return declarations;
}

function inferInputType(name: string): string {
  if (/(?:name|text|word|sentence|message|title|address|email)$/i.test(name)) return 'string';
  if (/^(?:is|has|can|should)[A-Z_]/.test(name) || /(?:flag|valid|active|done|finished|allowed)$/i.test(name)) return 'bool';
  if (/(?:price|amount|average|total|grade|score|rate|height|weight|temperature|distance)$/i.test(name)) return 'double';
  return 'int';
}

function buildMissingInputDeclarations(bodyCode: string): string[] {
  const declared = collectDeclaredVariables(bodyCode);
  const declarations: string[] = [];
  const seen = new Set<string>();
  const inputPattern = /\bcin\s*>>\s*([A-Za-z_][A-Za-z0-9_]*)\s*;/g;

  for (const match of bodyCode.matchAll(inputPattern)) {
    const name = match[1];
    if (declared.has(name) || seen.has(name)) continue;
    seen.add(name);
    declarations.push(`${inferInputType(name)} ${name};`);
  }

  return declarations;
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
  stopAt: Set<string>
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

    // ── Junction (merge point) — structural only, no emitted code ────────────
    if (node.type === 'junction') {
      currentId = outEdges[0]?.target;
      continue;
    }

    // ── On-page connector (break / continue) ─────────────────────────────────
    if (node.type === 'connector') {
      const code = str(node.data.code).toLowerCase();
      const label = str(node.data.label).toLowerCase();
      if (code === 'break' || label === 'break') {
        output += `${indent}break;\n`;
        break;
      }
      if (code === 'continue' || label === 'continue') {
        output += `${indent}continue;\n`;
        break;
      }
      currentId = outEdges[0]?.target;
      continue;
    }

    // ── Off-page connector (cross-page routing/reference) ─────────────────────
    if (node.type === 'off_page_connector') {
      const label = str(node.data.label);
      output += `${indent}// Off-page connector: ${label || 'reference'}\n`;
      currentId = outEdges[0]?.target;
      continue;
    }

    // ── Decision → IfStatement or WhileLoop ──────────────────────────────────
    if (node.type === 'decision') {
      const rawCondition = resolveCode(node);
      const condition = normalizeCondition(rawCondition);

      const labelledTrueEdge = outEdges.find(e => {
        const l = str(e.label).toLowerCase();
        return l === 'true' || l === 'yes';
      });

      const labelledFalseEdge: Edge | undefined = outEdges.find(e => {
        const l = str(e.label).toLowerCase();
        return l === 'false' || l === 'no';
      });

      const trueEdge = labelledTrueEdge ?? (!labelledFalseEdge ? outEdges[0] : undefined);
      const falseEdge = labelledFalseEdge ?? (labelledTrueEdge ? outEdges.find(e => e !== labelledTrueEdge) : undefined);

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
          output += traverse(bodyEdge.target, nodeMap, adj, new Set(visited), indent + '    ', stopAtBody);
        }
        output += `${indent}}\n`;

        currentId = exitEdge?.target;
        continue;
      }

      // Single-exit decisions are valid flowchart shorthand for a one-arm if.
      if ((trueEdge && !falseEdge) || (falseEdge && !trueEdge)) {
        const branchEdge = trueEdge ?? falseEdge;
        const branchCondition = falseEdge && !trueEdge ? `!(${condition})` : condition;
        output += `${indent}if (${branchCondition}) {\n`;
        if (branchEdge) {
          output += traverse(branchEdge.target, nodeMap, adj, new Set(visited), indent + '    ', new Set());
        }
        output += `${indent}}\n`;
        break;
      }

      // Plain if / if-else
      const mergeNode = findMergeNode(trueEdge?.target, falseEdge?.target, adj);
      const mergeSet  = mergeNode ? new Set([mergeNode]) : new Set<string>();

      output += `${indent}if (${condition}) {\n`;
      if (trueEdge && trueEdge.target !== mergeNode) {
        output += traverse(trueEdge.target, nodeMap, adj, new Set(visited), indent + '    ', mergeSet);
      }
      output += `${indent}}`;
      if (falseEdge && falseEdge.target !== mergeNode) {
        output += ` else {\n`;
        output += traverse(falseEdge.target, nodeMap, adj, new Set(visited), indent + '    ', mergeSet);
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
      const rawCode = resolveCode(node);
      if (isTopLevelDeclaration(rawCode)) {
        output += `${indent}// Function definition emitted above main: ${str(node.data.label) || 'helper'}\n`;
      } else {
        output += `${indent}${emitPredefined(str(node.data.label), str(node.data.code))}\n`;
      }
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

    // ── Stored Data (data container) ─────────────────────────────────────────
    if (node.type === 'database') {
      output += `${indent}${emitDatabase(str(node.data.label), str(node.data.code))}\n`;
      currentId = outEdges[0]?.target;
      continue;
    }

    // ── Process node → VariableDeclaration or ExpressionStatement ────────────
    {
      const rawCode = resolveCode(node);
      const label = str(node.data.label);
      const humanStatement = normalizeHumanStatement(rawCode, 'process');

      if (isTopLevelDeclaration(rawCode)) {
        output += `${indent}// Top-level declaration emitted above main: ${label || 'custom C++'}\n`;
      } else if (humanStatement) {
        output += `${indent}${humanStatement}\n`;
      } else if (isBareIdentifierStatement(rawCode)) {
        output += `${indent}int ${rawCode.trim().replace(/;$/, '')};\n`;
      } else if (!rawCode || rawCode === 'Process' || (rawCode === label && !rawCode.includes('=') && !rawCode.includes('('))) {
        if (label && label !== 'Process' && label.length < 80) {
          output += `${indent}// ${label}\n`;
        } else {
          output += `${indent}// TODO: implement this step\n`;
        }
      } else {
        const decl = parseVarDecl(rawCode);
        if (decl) {
          const modPart = decl.modifiers.length ? decl.modifiers.join(' ') + ' ' : '';
          if (decl.isArray) {
            const init = decl.value ? ` = ${decl.value}` : '';
            output += `${indent}${modPart}${decl.varType} ${decl.name}[${decl.arraySize}]${init};\n`;
          } else {
            const init = decl.value !== undefined ? ` = ${decl.value}` : '';
            output += `${indent}${modPart}${decl.varType} ${decl.name}${init};\n`;
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

  const bodyLines = traverse(
    startNode.id,
    nodeMap,
    adj,
    new Set(),
    '    ',
    new Set()
  );
  const allCode = collectAllCode(typedNodes);
  const topLevelDeclarations = collectTopLevelDeclarations(typedNodes);
  const manualHelperDeclarations = collectManualHelperDeclarations(typedNodes, adj);
  const generatedHelperDeclarations = collectGeneratedHelperDeclarations(typedNodes);
  const declarations = [...topLevelDeclarations, ...manualHelperDeclarations, ...generatedHelperDeclarations];
  const includes = detectIncludes([...allCode, ...manualHelperDeclarations, ...generatedHelperDeclarations, bodyLines]);
  const missingInputDeclarations = buildMissingInputDeclarations(bodyLines);
  const mainBody = [
    ...missingInputDeclarations.map(line => `    ${line}`),
    ...(missingInputDeclarations.length && bodyLines.trimEnd() ? [''] : []),
    bodyLines.trimEnd() || '    // Empty graph — connect your nodes',
  ].join('\n');

  return [
    ...includes.map(h => `#include <${h}>`),
    'using namespace std;',
    '',
    ...(declarations.length
      ? [
          ...declarations.flatMap(block => [block, '']),
        ]
      : []),
    'int main() {',
    mainBody,
    '    return 0;',
    '}',
    '',
  ].join('\n');
};
