import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { generateCppFromGraph } from '../CodeGenerator';

function makeNode(
  id: string,
  type: string,
  label: string,
  code = '',
): Node {
  return { id, type, position: { x: 0, y: 0 }, data: { label, code } };
}

function makeEdge(id: string, source: string, target: string, label?: string): Edge {
  return { id, source, target, ...(label !== undefined ? { label } : {}) };
}

describe('generateCppFromGraph', () => {
  it('preserves branch-local declarations instead of rewriting them as assignments', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('d', 'decision', 'x > 0', 'x > 0'),
      makeNode('t', 'process', 'then', 'int y = 1;'),
      makeNode('f', 'process', 'else', 'int y = 2;'),
      makeNode('j', 'junction', 'Merge'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'd'),
      makeEdge('e2', 'd', 't', 'true'),
      makeEdge('e3', 'd', 'f', 'false'),
      makeEdge('e4', 't', 'j'),
      makeEdge('e5', 'f', 'j'),
      makeEdge('e6', 'j', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toContain('if (x > 0)');
    expect(code).toContain('int y = 1;');
    expect(code).toContain('int y = 2;');
    expect(code).not.toMatch(/^\s*y = 2;$/m);
  });

  it('emits loop continue as a terminating statement for that path', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('d', 'decision', 'i < 10', 'i < 10'),
      makeNode('p', 'process', 'step', 'i++;'),
      makeNode('c', 'connector', 'Continue', 'continue'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'd'),
      makeEdge('e2', 'd', 'p', 'true'),
      makeEdge('e3', 'p', 'c'),
      makeEdge('e4', 'c', 'd'),
      makeEdge('e5', 'd', 'e', 'false'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toContain('while (i < 10)');
    expect(code).toContain('i++;');
    expect(code).toContain('continue;');
  });

  it('keeps default off-page connectors as comments instead of invalid statements', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('o', 'off_page_connector', '1'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'o'),
      makeEdge('e2', 'o', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toContain('// Off-page connector: 1');
    expect(code).not.toContain('1;');
  });
});
