import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { generateCppFromGraph } from '@/services/CodeGenerator';

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
  it('generates C++ from the same ISO shapes used by code-to-flowchart CFG output', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('db', 'database', 'Stored Data', 'int scores[5];'),
      makeNode('doc', 'document', 'File Stream', 'ofstream reportFile("report.txt");'),
      makeNode('out', 'io', 'Output (cout)', 'cout << "Enter student name: ";'),
      makeNode('in', 'manual_input', 'Input (cin)', 'cin >> name;'),
      makeNode('call', 'predefined', 'Call: showSummary', 'showSummary(total);'),
      makeNode('fileOut', 'document', 'Document Output', 'reportFile << "Average: " << total << endl;'),
      makeNode('delay', 'delay', 'Delay / Wait', 'wait 1 second'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'db'),
      makeEdge('e2', 'db', 'doc'),
      makeEdge('e3', 'doc', 'out'),
      makeEdge('e4', 'out', 'in'),
      makeEdge('e5', 'in', 'call'),
      makeEdge('e6', 'call', 'fileOut'),
      makeEdge('e7', 'fileOut', 'delay'),
      makeEdge('e8', 'delay', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toContain('#include <fstream>');
    expect(code).toContain('int scores[5];');
    expect(code).toContain('ofstream reportFile("report.txt");');
    expect(code).toContain('cout << "Enter student name: ";');
    expect(code).toContain('cin >> name;');
    expect(code).toContain('showSummary(total);');
    expect(code).toContain('reportFile << "Average: " << total << endl;');
    expect(code).toContain('// wait 1 second(s)');
  });

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

  it('keeps named off-page connectors as routing comments, not function calls', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('o', 'off_page_connector', 'Calculate total'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'o'),
      makeEdge('e2', 'o', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toContain('// Off-page connector: Calculate total');
    expect(code).not.toContain('calculateTotal();');
  });

  it('uses predefined process for helper calls instead of connectors', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('fn', 'predefined', 'Calculate total', 'call calculate total with score'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'fn'),
      makeEdge('e2', 'fn', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toContain('calculateTotal(score);');
  });

  it('generates a manual helper function section connected by a calls edge', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('call', 'predefined', 'Call show failed', 'showFailedMessage()'),
      makeNode('fn', 'predefined', 'Function: showFailedMessage', 'void showFailedMessage()'),
      makeNode('out', 'io', 'Output', 'display failed'),
      makeNode('fnEnd', 'terminator', 'End: showFailedMessage'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'call'),
      makeEdge('e2', 'call', 'e'),
      makeEdge('e3', 'call', 'fn', 'calls'),
      makeEdge('e4', 'fn', 'out'),
      makeEdge('e5', 'out', 'fnEnd'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toMatch(/void showFailedMessage\(\) \{\n {4}cout << "failed" << endl;\n\}/);
    expect(code).toContain('showFailedMessage();');
    expect(code).not.toMatch(/showFailedMessage\(\);\n\s*\/\/ Function definition emitted above main/);
  });

  it('keeps includes inside the analyzer-supported header set', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('p1', 'process', 'assignment', 'maximum = 10;'),
      makeNode('p2', 'process', 'array setup', 'int values[3];'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'p1'),
      makeEdge('e2', 'p1', 'p2'),
      makeEdge('e3', 'p2', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).not.toContain('#include <vector>');
    expect(code).not.toContain('#include <algorithm>');
    expect(code).toContain('int values[3];');
  });

  it('adds the same required preprocessor directives used by code analysis', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('p1', 'process', 'Format output', 'cout << fixed << setprecision(2) << total;'),
      makeNode('p2', 'process', 'Math', 'double root = sqrt(total);'),
      makeNode('p3', 'process', 'Random', 'int roll = rand();'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'p1'),
      makeEdge('e2', 'p1', 'p2'),
      makeEdge('e3', 'p2', 'p3'),
      makeEdge('e4', 'p3', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toContain('#include <iostream>');
    expect(code).toContain('#include <iomanip>');
    expect(code).toContain('#include <cmath>');
    expect(code).toContain('#include <cstdlib>');
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

  it('generates a one-arm if for single-path decisions', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('d', 'decision', 'score is at least passing score'),
      makeNode('p', 'io', 'Print passed', 'display passed'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'd'),
      makeEdge('e2', 'd', 'p'),
      makeEdge('e3', 'p', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toContain('if (score >= passingScore) {');
    expect(code).toContain('cout << "passed" << endl;');
    expect(code).not.toContain('else');
  });

  it('negates the condition when a single decision path is labelled false', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('d', 'decision', 'valid == true'),
      makeNode('p', 'io', 'Print invalid', 'display invalid'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'd'),
      makeEdge('e2', 'd', 'p', 'false'),
      makeEdge('e3', 'p', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toContain('if (!(valid == true)) {');
    expect(code).toContain('cout << "invalid" << endl;');
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
    expect(code).toContain('cout << "allowed" << endl;');
    expect(code).toContain('cout << "too young" << endl;');
  });

  it('declares variables read from simple input nodes', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('p', 'process', 'Enter number'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'p'),
      makeEdge('e2', 'p', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toMatch(/int main\(\) \{\n {4}int number;\n\n {4}cin >> number;/);
  });

  it('turns a bare process variable name into a typed declaration', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('p', 'process', 'Process', 'age'),
      makeNode('d', 'decision', 'Condition', 'age > 17'),
      makeNode('t', 'io', 'Output', 'Adult'),
      makeNode('f', 'predefined', 'Function Call', 'call showWrongInput to display wrong input'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'p'),
      makeEdge('e2', 'p', 'd'),
      makeEdge('e3', 'd', 't', 'true'),
      makeEdge('e4', 'd', 'f', 'false'),
      makeEdge('e5', 't', 'e'),
      makeEdge('e6', 'f', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toMatch(/void showWrongInput\(\) \{\n {4}cout << "wrong input" << endl;\n\}/);
    expect(code).toMatch(/int main\(\) \{\n {4}int age;\n {4}if \(age > 17\) \{\n {8}cout << "Adult" << endl;\n {4}\} else \{\n {8}showWrongInput\(\);/);
    expect(code).not.toContain('    age;\n');
  });

  it('does not redeclare input variables that already exist', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('d', 'process', 'Declare number', 'int number;'),
      makeNode('i', 'manual_input', 'Enter number'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'd'),
      makeEdge('e2', 'd', 'i'),
      makeEdge('e3', 'i', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code.match(/\bint number;/g)).toHaveLength(1);
    expect(code).toContain('cin >> number;');
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

  it('accepts literal sentences, command-style steps, and pseudocode without AI or compilation', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('p1', 'process', 'Start score', 'score starts at zero'),
      makeNode('p2', 'process', 'Add point', 'add one to score'),
      makeNode('p3', 'process', 'Multiply', 'multiply score by two'),
      makeNode('p4', 'process', 'Total', 'total gets price plus tax'),
      makeNode('i', 'manual_input', 'Age', 'enter age'),
      makeNode('o1', 'io', 'Message', 'hello beginner'),
      makeNode('o2', 'io', 'Show total', 'show the value of total'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'p1'),
      makeEdge('e2', 'p1', 'p2'),
      makeEdge('e3', 'p2', 'p3'),
      makeEdge('e4', 'p3', 'p4'),
      makeEdge('e5', 'p4', 'i'),
      makeEdge('e6', 'i', 'o1'),
      makeEdge('e7', 'o1', 'o2'),
      makeEdge('e8', 'o2', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toContain('int score = 0;');
    expect(code).toContain('score += 1;');
    expect(code).toContain('score *= 2;');
    expect(code).toContain('total = price + tax;');
    expect(code).toContain('cin >> age;');
    expect(code).toContain('cout << "hello beginner" << endl;');
    expect(code).toContain('cout << total << endl;');
  });

  it('turns beginner array storage wording into indexed assignment', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('db', 'database', 'Create scores', 'create an array of scores'),
      makeNode('p', 'process', 'Store first score', 'store score at index zero of scores'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'db'),
      makeEdge('e2', 'db', 'p'),
      makeEdge('e3', 'p', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toContain('int scores[10];');
    expect(code).toContain('scores[0] = score;');
  });

  it('generates 2D arrays from friendly flowchart wording', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('db', 'database', 'Create grid', 'create a 2D array of scores with two rows and three columns'),
      makeNode('p', 'process', 'Store score', 'store score at row one column two of scores'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'db'),
      makeEdge('e2', 'db', 'p'),
      makeEdge('e3', 'p', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toContain('int scores[2][3];');
    expect(code).toContain('scores[1][2] = score;');
  });

  it('generates 3D arrays from friendly flowchart wording', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('db', 'database', 'Create cube', 'create a 3D array of cubes with two layers and three rows and four columns'),
      makeNode('p', 'process', 'Store value', 'store value at layer one row two column three of cubes'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'db'),
      makeEdge('e2', 'db', 'p'),
      makeEdge('e3', 'p', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toContain('int cubes[2][3][4];');
    expect(code).toContain('cubes[1][2][3] = value;');
  });

  it('generates friendly snippets for arrays, helper calls, and wait comments', () => {
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

    expect(code).not.toContain('#include <vector>');
    expect(code).toContain('int scores[10];');
    expect(code).toContain('calculateResult(score, passingScore);');
    expect(code).toContain('// wait 2 second(s)');
  });

  it('turns document and note-style flowchart text into valid C++ or comments', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('doc', 'document', 'Report', 'write report.txt'),
      makeNode('note', 'process', 'Summary', 'note: total has been saved'),
      makeNode('e', 'terminator', 'End'),
    ];
    const edges = [
      makeEdge('e1', 's', 'doc'),
      makeEdge('e2', 'doc', 'note'),
      makeEdge('e3', 'note', 'e'),
    ];

    const code = generateCppFromGraph(nodes, edges);

    expect(code).toContain('#include <fstream>');
    expect(code).toContain('ofstream reportFile("report.txt");');
    expect(code).toContain('// total has been saved');
    expect(code).not.toContain('write report.txt;');
  });

  it('can generate a helper function body from a function-call node', () => {
    const nodes = [
      makeNode('s', 'terminator', 'Start'),
      makeNode('i', 'manual_input', 'Ask age', 'ask the user for their age'),
      makeNode('d', 'decision', 'age > 17', 'age > 17'),
      makeNode('t', 'io', 'Adult', 'display adult'),
      makeNode('f', 'predefined', 'Show wrong input', 'call showWrongInput to display wrong input/minor'),
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

    expect(code).toMatch(/void showWrongInput\(\) \{\n {4}cout << "wrong input\/minor" << endl;\n\}/);
    expect(code).toMatch(/int main\(\)[\s\S]+showWrongInput\(\);/);
  });

  it('emits complete helper functions above main but leaves class snippets inside main for validator rejection', () => {
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

    expect(code).not.toMatch(/class Student[\s\S]+};[\s\S]+int main/);
    expect(code).toMatch(/int add\(int a, int b\)[\s\S]+int main/);
    expect(code).toContain('class Student {');
    expect(code).toContain('int total = add(1, 2);');
  });
});
