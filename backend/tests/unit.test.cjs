const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

require('ts-node/register/transpile-only');

const { tokenize, extractKeywords, extractIdentifiers } = require('../src/analysis/lexer.ts');
const parser = require('../src/analysis/parser.js');
const { CFGGenerator } = require('../src/analysis/cfgGenerator.ts');
const { GameEngine } = require('../src/gamification/GameEngine.ts');
const { SymbolicExecutor } = require('../src/analysis/symbolicexe.ts');

describe('Backend unit tests', () => {
  const valuesByType = (tokens, type) => tokens.filter((token) => token.type === type).map((token) => token.value);

  it('UT-01 Tokenizer detects C++ keywords', () => {
    const { tokens, errors } = tokenize('int main() { return 0; }');

    assert.equal(errors.length, 0);
    assert.ok(extractKeywords(tokens).includes('int'));
    assert.ok(extractKeywords(tokens).includes('return'));
  });

  it('UT-02 Tokenizer detects identifiers', () => {
    const { tokens, errors } = tokenize('int main() { int score = 10; return score; }');

    assert.equal(errors.length, 0);
    assert.ok(extractIdentifiers(tokens).has('main'));
    assert.ok(extractIdentifiers(tokens).has('score'));
  });

  it('Tokenizer recognizes multi-character C++ operators before single-character fallbacks', () => {
    const { tokens, errors } = tokenize('int main() { value += 1; ptr->field++; scope::call(); if (a <= b && b != c) return value; }');
    const operators = valuesByType(tokens, 'Operator');

    assert.equal(errors.length, 0);
    assert.ok(operators.includes('+='));
    assert.ok(operators.includes('->'));
    assert.ok(operators.includes('++'));
    assert.ok(operators.includes('::'));
    assert.ok(operators.includes('<='));
    assert.ok(operators.includes('&&'));
    assert.ok(operators.includes('!='));
  });

  it('Tokenizer recognizes common C++ literal forms', () => {
    const source = String.raw`
      int main() {
        auto binary = 0b1010ULL;
        auto hex = 0xFFu;
        auto octal = 0755;
        auto floating = 3.14f;
        auto raw = R"TAG(line\ntext)TAG";
        auto wide = L'A';
        auto utf8 = u8"hello";
      }
    `;
    const { tokens, errors } = tokenize(source);
    const literals = valuesByType(tokens, 'Literal');

    assert.equal(errors.length, 0);
    assert.ok(literals.includes('0b1010ULL'));
    assert.ok(literals.includes('0xFFu'));
    assert.ok(literals.includes('0755'));
    assert.ok(literals.includes('3.14f'));
    assert.ok(literals.includes('R"TAG(line\\ntext)TAG"'));
    assert.ok(literals.includes("L'A'"));
    assert.ok(literals.includes('u8"hello"'));
  });

  it('Tokenizer skips comments while preserving following token positions', () => {
    const { tokens, errors } = tokenize('int main() {\n  // ignored\n  int score = 1; /* also ignored */\n  return score;\n}');

    assert.equal(errors.length, 0);
    assert.equal(tokens.some((token) => token.type === 'Comment'), false);
    assert.ok(tokens.some((token) => token.type === 'Keyword' && token.value === 'return' && token.line === 4));
  });

  it('Tokenizer expands simple object-like macros once', () => {
    const { tokens, errors } = tokenize('#define LIMIT 10\nint main() { int score = LIMIT; return score; }');
    const literals = valuesByType(tokens, 'Literal');
    const identifiers = valuesByType(tokens, 'Identifier');

    assert.equal(errors.length, 0);
    assert.ok(literals.includes('10'));
    assert.equal(identifiers.includes('LIMIT'), false);
  });

  it('Tokenizer reports unexpected characters with source location', () => {
    const { tokens, errors } = tokenize('int main() {\n  int value = @;\n}');

    assert.ok(tokens.length > 0);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /Unexpected character '@'/);
    assert.equal(errors[0].line, 2);
    assert.equal(errors[0].column, 15);
  });

  it('UT-03 Parser generates an AST', () => {
    const ast = parser.parse('int main() { int score = 10; return score; }');

    assert.equal(ast.type, 'Program');
    assert.ok(Array.isArray(ast.body));
    assert.ok(ast.body.some((node) => node.type === 'FunctionDecl' && node.name === 'main'));
  });

  it('UT-04 CFG Generator creates graph nodes and edges', () => {
    const ast = parser.parse('int main() { int score = 10; if (score > 0) { score = 20; } return score; }');
    const cfg = new CFGGenerator().generate(ast);

    assert.ok(cfg.nodes.length > 0);
    assert.ok(cfg.edges.length > 0);
    assert.ok(cfg.nodes.some((node) => node.label === 'Condition'));
  });

  it('CFG Generator renders return statements as executable process nodes', () => {
    const ast = parser.parse(`
      void showSummary(int total) {
        return;
      }

      int main() {
        showSummary(10);
        return 0;
      }
    `);
    const cfg = new CFGGenerator().generate(ast);
    const returnNodes = cfg.nodes.filter((node) => node.label === 'Return');
    const functionEnd = cfg.nodes.find((node) => node.label === 'End: showSummary');

    assert.ok(returnNodes.length >= 2);
    assert.ok(returnNodes.every((node) => node.type === 'process'));
    assert.equal(functionEnd?.type, 'predefined');
  });

  it('Symbolic executor does not flag while loop when cin updates the condition variable', () => {
    const ast = parser.parse(`
      #include <iostream>
      using namespace std;

      int main() {
        int choice;

        choice = 1;

        while (choice == 1) {
          cout << "Process another student? Enter 1 for yes or 0 for no: ";
          cin >> choice;
        }

        return 0;
      }
    `);
    const safetyChecks = new SymbolicExecutor().execute(ast);
    const loopWarnings = safetyChecks.filter((check) => (
      check.type === 'loop'
      && /Infinite loop: condition variables \[choice\] never change in the while body/.test(check.message)
    ));

    assert.equal(loopWarnings.length, 0);
  });

  it('UT-05 XP System awards XP for clean analysis', () => {
    const reward = new GameEngine().calculateReward({
      cognitiveComplexity: 0,
      cyclomaticComplexity: { score: 1 },
      errors: [],
      safetyChecks: [],
    }, 0);

    assert.ok(reward.xp >= 25);
    assert.ok(reward.bonus >= 15);
  });
});
