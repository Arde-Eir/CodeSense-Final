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

  it('detects includes from real C++ tokens instead of substring matches', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('p1', 'process', 'assignment', 'maximum = 10;'),
      makeNode('p2', 'process', 'vector setup', 'vector<int> values;'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'p1'),
      makeEdge('e2', 'p1', 'p2'),
      makeEdge('e3', 'p2', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toContain('#include <vector>');
    expect(code).not.toContain('#include <algorithm>');
  });

  it('emits output expressions with endl and normalizes text conditions', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('d', 'decision', 'hp > 0 or i < n', 'hp > 0 or i < n'),
      makeNode('t', 'io', 'Print message', '"alive"'),
      makeNode('f', 'io', 'Print message', '"done"'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'd'),
      makeEdge('e2', 'd', 't', 'true'),
      makeEdge('e3', 'd', 'f', 'false'),
      makeEdge('e4', 't', 'e'),
      makeEdge('e5', 'f', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toContain('if (hp > 0 || i < n)');
    expect(code).toContain('cout << "alive" << endl;');
    expect(code).toContain('cout << "done" << endl;');
  });

  it('turns simple English process text into C++ declarations and updates', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('p1', 'process', 'Create integer age equals 18'),
      makeNode('p2', 'process', 'increase age by 1'),
      makeNode('p3', 'process', 'create text full name equals Ada Lovelace'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'p1'),
      makeEdge('e2', 'p1', 'p2'),
      makeEdge('e3', 'p2', 'p3'),
      makeEdge('e4', 'p3', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toContain('#include <string>');
    expect(code).toContain('int age = 18;');
    expect(code).toContain('age += 1;');
    expect(code).toContain('string fullName = "Ada Lovelace";');
  });

  it('turns simple English input, output, and decision text into C++', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('i', 'manual_input', 'Ask for user age'),
      makeNode('d', 'decision', 'if user age is greater than 17'),
      makeNode('t', 'io', 'print allowed'),
      makeNode('f', 'io', 'print too young'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'i'),
      makeEdge('e2', 'i', 'd'),
      makeEdge('e3', 'd', 't', 'true'),
      makeEdge('e4', 'd', 'f', 'false'),
      makeEdge('e5', 't', 'e'),
      makeEdge('e6', 'f', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toContain('cin >> userAge;');
    expect(code).toContain('if (userAge > 17)');
    expect(code).toContain('cout << allowed << endl;');
    expect(code).toContain('cout << "too young" << endl;');
  });

  it('accepts more conversational English in flowchart nodes', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('p1', 'process', 'Let score be zero'),
      makeNode('p2', 'process', 'store 75 in passing score'),
      makeNode('i', 'manual_input', 'Ask for name', 'ask the user for their name'),
      makeNode('d', 'decision', 'repeat while score is below passing score'),
      makeNode('t', 'io', 'Display hello', 'display hello world'),
      makeNode('u', 'process', 'Add points', 'set score to score plus 10'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'p1'),
      makeEdge('e2', 'p1', 'p2'),
      makeEdge('e3', 'p2', 'i'),
      makeEdge('e4', 'i', 'd'),
      makeEdge('e5', 'd', 't', 'true'),
      makeEdge('e6', 't', 'u'),
      makeEdge('e7', 'u', 'd'),
      makeEdge('e8', 'd', 'e', 'false'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toContain('int score = 0;');
    expect(code).toContain('passingScore = 75;');
    expect(code).toContain('cin >> name;');
    expect(code).toContain('while (score < passingScore)');
    expect(code).toContain('cout << "hello world" << endl;');
    expect(code).toContain('score = score + 10;');
  });

  it('generates friendly snippets for lists, helper calls, and wait instructions', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('db', 'database', 'Create scores', 'create a list of scores'),
      makeNode('fn', 'predefined', 'Calculate', 'call calculate result with score and passing score'),
      makeNode('w', 'delay', 'Wait', 'wait two seconds'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'db'),
      makeEdge('e2', 'db', 'fn'),
      makeEdge('e3', 'fn', 'w'),
      makeEdge('e4', 'w', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toContain('#include <vector>');
    expect(code).toContain('vector<int> scores;');
    expect(code).toContain('calculateResult(score, passingScore);');
    expect(code).toContain('sleep(2);');
  });

  it('emits complete classes and helper functions above main', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('cls', 'process', 'Student class', 'class Student {\npublic:\n    string name;\n};'),
      makeNode('fn', 'predefined', 'Helper', 'int add(int a, int b) {\n    return a + b;\n}'),
      makeNode('p', 'process', 'Use helper', 'int total = add(1, 2);'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'cls'),
      makeEdge('e2', 'cls', 'fn'),
      makeEdge('e3', 'fn', 'p'),
      makeEdge('e4', 'p', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toMatch(/class Student[\s\S]+};[\s\S]+int main/);
    expect(code).toMatch(/int add\(int a, int b\)[\s\S]+int main/);
    expect(code).toContain('// Top-level declaration emitted above main: Student class');
    expect(code).toContain('int total = add(1, 2);');
  });
});
