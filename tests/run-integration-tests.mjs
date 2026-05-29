/**
 * CodeSense Backend Integration Tests
 *
 * Mirrors the Cypress spec (backend-api.cy.ts) using Node.js built-ins:
 *   - native fetch (Node 18+) for HTTP requests
 *   - node:test runner for test structure
 *   - node:assert for assertions
 *
 * Covers the same 14 suites as the Cypress spec.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'http://localhost:3000';
const API = `${BASE}/api/analyze`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function post(sourceCode, extra = {}) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceCode, hintsUsed: 0, ...extra }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

function expectBaseShape(body) {
  assert.equal(typeof body.success, 'boolean', 'body.success must be boolean');
  assert.ok(Array.isArray(body.errors), 'body.errors must be array');
  assert.ok(Array.isArray(body.tokens), 'body.tokens must be array');
  assert.ok(Array.isArray(body.safetyChecks), 'body.safetyChecks must be array');
  assert.ok(Array.isArray(body.explanations), 'body.explanations must be array');
  assert.ok(body.cfg && typeof body.cfg === 'object', 'body.cfg must be object');
  assert.ok(body.gamification && typeof body.gamification === 'object', 'body.gamification must be object');
}

// ---------------------------------------------------------------------------
// Suite 1 – Input Validation
// ---------------------------------------------------------------------------
describe('Suite 1 – Input Validation', () => {
  test('returns HTTP 400 when body is missing sourceCode', async () => {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    assert.equal(res.status, 400, `Expected 400, got ${res.status}`);
    assert.equal(body.success, false);
  });

  test('returns HTTP 400 when sourceCode is not a string', async () => {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceCode: 42 }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.success, false);
  });

  test('returns HTTP 200 for valid code', async () => {
    const { status } = await post('int main() { return 0; }');
    assert.equal(status, 200);
  });

  test('accepts code pasted with markdown/html formatting', async () => {
    const pasted = 'cpp<br>#include &lt;iostream&gt;<br>using namespace std;<br><br>int main() {<br>    cout &lt;&lt; "Hello, CodeSense!" &lt;&lt; endl;<br>    return 0;<br>}';
    const { status, body } = await post(pasted);
    assert.equal(status, 200);
    assert.equal(body.success, true);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 – Response Shape Contract
// ---------------------------------------------------------------------------
describe('Suite 2 – Response Shape', () => {
  test('success response has all required fields', async () => {
    const { status, body } = await post('int main() { int x = 10; return 0; }');
    assert.equal(status, 200);
    expectBaseShape(body);
    assert.equal(body.success, true);
    assert.ok(body.ast !== undefined, 'ast must be present');
    assert.equal(typeof body.cognitiveComplexity, 'number');
    assert.ok(body.cyclomaticComplexity && typeof body.cyclomaticComplexity === 'object');
    assert.equal(typeof body.gamification.xpEarned, 'number');
    assert.equal(typeof body.gamification.qualityBonus, 'number');
  });

  test('error response has all required fields', async () => {
    const { status, body } = await post('int main() { int x = @; }');
    assert.equal(status, 200);
    expectBaseShape(body);
    assert.equal(body.success, false);
  });
});

// ---------------------------------------------------------------------------
// Suite 3 – Phase 1: Lexical Analysis
// ---------------------------------------------------------------------------
describe('Suite 3 – Lexical Analysis', () => {
  test('detects invalid symbol @', async () => {
    const { body } = await post('int main() { int x = @; }');
    assert.equal(body.success, false);
    const hasLex = body.errors.some(e => e.type === 'lexical');
    assert.ok(hasLex, 'Should have a lexical error');
  });

  test('detects invalid symbol $ in expression', async () => {
    const { body } = await post('int main() { int x = $10; }');
    assert.equal(body.success, false);
    const hasLex = body.errors.some(e => e.type === 'lexical');
    assert.ok(hasLex, 'Should have a lexical error for $');
  });

  test('returns tokens array on lexical error', async () => {
    const { body } = await post('int main() { int x = @; }');
    assert.ok(Array.isArray(body.tokens));
  });
});

// ---------------------------------------------------------------------------
// Suite 4 – Phase 2: Syntactic Analysis
// ---------------------------------------------------------------------------
describe('Suite 4 – Syntactic Analysis', () => {
  test('detects missing semicolon', async () => {
    const { body } = await post('int main() { int x = 10\n return 0; }');
    assert.equal(body.success, false);
    const hasSyn = body.errors.some(e => e.type === 'syntactic');
    assert.ok(hasSyn, 'Should have syntactic error');
  });

  test('detects unmatched brace', async () => {
    const { body } = await post('int main() { int x = 10; ');
    assert.equal(body.success, false);
    const hasErr = body.errors.some(e => e.type === 'syntactic' || e.type === 'lexical');
    assert.ok(hasErr, 'Should have a syntax or lex error');
  });

  test('syntactic error includes line number', async () => {
    const { body } = await post('int main() { int x = 10\n return 0; }');
    assert.equal(body.success, false);
    const synErr = body.errors.find(e => e.type === 'syntactic');
    if (synErr) {
      assert.equal(typeof synErr.line, 'number');
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 5 – Phase 3: Semantic Analysis
// ---------------------------------------------------------------------------
describe('Suite 5 – Semantic Analysis', () => {
  test('detects variable redeclaration', async () => {
    const { body } = await post('int main() { int x = 10; int x = 20; return 0; }');
    assert.equal(body.success, false);
    const hasSem = body.errors.some(e => e.type === 'semantic');
    assert.ok(hasSem, 'Should detect redeclaration as semantic error');
  });

  test('detects undefined variable usage', async () => {
    const { body } = await post('int main() { y = 10; return 0; }');
    assert.equal(body.success, false);
    const hasSem = body.errors.some(e => e.type === 'semantic');
    assert.ok(hasSem, 'Should detect undefined var as semantic error');
  });

  test('detects scope-shadowing conflict', async () => {
    const { body } = await post('int main() { int x = 5; if(true) { int x = 10; } return 0; }');
    const hasSem = body.errors.some(e => e.type === 'semantic');
    assert.ok(hasSem, 'Should detect scope shadowing as semantic error');
  });

  test('response shape holds on semantic error', async () => {
    const { body } = await post('int main() { int x = 10; int x = 20; return 0; }');
    expectBaseShape(body);
  });
});

// ---------------------------------------------------------------------------
// Suite 6 – Phase 4: Dependency Validation
// ---------------------------------------------------------------------------
describe('Suite 6 – Dependency Validation', () => {
  test('flags cout without #include <iostream>', async () => {
    const { body } = await post('int main() { cout << "hello"; return 0; }');
    assert.equal(body.success, false);
    const hasDepErr = body.errors.some(
      e => e.type === 'semantic' && e.message.includes('iostream'),
    );
    assert.ok(hasDepErr, 'Should require iostream');
  });

  test('flags string variables without #include <string>', async () => {
    const code = '#include <iostream>\nusing namespace std;\nint main() { string name = "Ada"; cout << name; return 0; }';
    const { body } = await post(code);
    assert.equal(body.success, false);
    const hasStringErr = body.errors.some(
      e => e.type === 'semantic' && e.message.includes('<string>'),
    );
    assert.ok(hasStringErr, 'Should require string header for string type usage');
  });

  test('flags formatting manipulators without #include <iomanip>', async () => {
    const code = '#include <iostream>\nusing namespace std;\nint main() { cout << fixed << setprecision(2) << 3.14; return 0; }';
    const { body } = await post(code);
    assert.equal(body.success, false);
    const hasIomanipErr = body.errors.some(
      e => e.type === 'semantic' && e.message.includes('<iomanip>'),
    );
    assert.ok(hasIomanipErr, 'Should require iomanip for fixed/setprecision');
  });

  test('flags utility functions without #include <cstdlib>', async () => {
    const code = '#include <iostream>\nusing namespace std;\nint main() { int value = rand(); cout << value; return 0; }';
    const { body } = await post(code);
    assert.equal(body.success, false);
    const hasCstdlibErr = body.errors.some(
      e => e.type === 'semantic' && e.message.includes('<cstdlib>'),
    );
    assert.ok(hasCstdlibErr, 'Should require cstdlib for rand');
  });

  test('flags wrong legacy preprocessor directive for string', async () => {
    const code = '#include <iostream>\n#include <string.h>\nusing namespace std;\nint main() { string name = "Ada"; cout << name; return 0; }';
    const { body } = await post(code);
    assert.equal(body.success, false);
    const hasWrongDirective = body.errors.some(
      e => e.type === 'semantic' && e.message.includes('Wrong preprocessor directive') && e.message.includes('<string>'),
    );
    assert.ok(hasWrongDirective, 'Should explain that string.h is wrong for C++ string');
  });

  test('flags wrong preprocessor directive for cout', async () => {
    const code = '#include <cstdio>\nusing namespace std;\nint main() { cout << "hello"; return 0; }';
    const { body } = await post(code);
    assert.equal(body.success, false);
    const hasWrongDirective = body.errors.some(
      e => e.type === 'semantic' && e.message.includes('Wrong preprocessor directive') && e.message.includes('<iostream>'),
    );
    assert.ok(hasWrongDirective, 'Should explain that cstdio is wrong for cout');
  });

  test('passes code with proper includes and using namespace std', async () => {
    const code = '#include <iostream>\nusing namespace std;\nint main() { cout << "hello"; return 0; }';
    const { body } = await post(code);
    assert.equal(body.success, true);
  });

  test('passes file stream declarations with #include <fstream>', async () => {
    const code = '#include <fstream>\nusing namespace std;\nint main() { ifstream input; ofstream output; fstream file; return 0; }';
    const { body } = await post(code);
    assert.equal(body.success, true);
  });
});

// ---------------------------------------------------------------------------
// Suite 7 – Phase 5: Symbolic Execution (Safety Checks)
// ---------------------------------------------------------------------------
describe('Suite 7 – Symbolic Execution', () => {
  test('detects basic division by zero', async () => {
    const { body } = await post('int main() { int x = 10; int y = 0; int z = x / y; return 0; }');
    assert.equal(body.success, true);
    assert.ok(body.safetyChecks.length > 0, 'Should have safety checks');
    const hasDivZero = body.safetyChecks.some(
      s => s.message && s.message.toLowerCase().includes('divis'),
    );
    assert.ok(hasDivZero, 'Should detect division by zero');
  });

  test('detects cross-variable math propagation (derived zero divisor)', async () => {
    const { body } = await post('int main() { int x = 5; int y = x - 5; int z = 100 / y; return 0; }');
    assert.equal(body.success, true);
    assert.ok(body.safetyChecks.length > 0, 'Should detect derived zero divisor');
  });

  test('detects infinite loop via static analysis', async () => {
    const { body } = await post('int main() { int x = 5; while(x > 0) { x = 5; } return 0; }');
    assert.equal(body.success, true);
    const hasLoop = body.safetyChecks.some(
      s => s.message && (
        s.message.toLowerCase().includes('infinite') ||
        s.message.toLowerCase().includes('loop') ||
        s.message.toLowerCase().includes('condition never changes')
      ),
    );
    assert.ok(hasLoop, 'Should detect infinite loop');
  });

  test('detects negative array index', async () => {
    const { body } = await post('int main() { int arr[5]; int x = -1; arr[x] = 10; return 0; }');
    assert.equal(body.success, true);
    const hasOOB = body.safetyChecks.some(
      s => s.message && (
        s.message.toLowerCase().includes('negative') ||
        s.message.toLowerCase().includes('bound') ||
        s.message.toLowerCase().includes('index')
      ),
    );
    assert.ok(hasOOB, 'Should detect negative array index');
  });

  test('detects out-of-bounds array access via variable', async () => {
    const { body } = await post('int main() { int arr[3]; int idx = 5; arr[idx] = 10; return 0; }');
    assert.equal(body.success, true);
    const hasOOB = body.safetyChecks.some(
      s => s.message && (
        s.message.toLowerCase().includes('bound') ||
        s.message.toLowerCase().includes('index') ||
        s.message.toLowerCase().includes('exceed')
      ),
    );
    assert.ok(hasOOB, 'Should detect out-of-bounds index');
  });

  test('safetyChecks has no UNSAFE items for provably safe code', async () => {
    const { body } = await post('int main() { int x = 10; int y = 2; int z = x / y; return 0; }');
    assert.equal(body.success, true);
    const unsafe = body.safetyChecks.filter(s => s.status === 'UNSAFE' || s.severity === 'error');
    assert.equal(unsafe.length, 0, `Expected no UNSAFE checks, got ${unsafe.length}`);
  });
});

// ---------------------------------------------------------------------------
// Suite 8 – Phase 6: CFG Generation
// ---------------------------------------------------------------------------
describe('Suite 8 – CFG Generation', () => {
  test('returns cfg with nodes and edges on success', async () => {
    const { body } = await post('int main() { int x = 10; return 0; }');
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.cfg.nodes));
    assert.ok(Array.isArray(body.cfg.edges));
    assert.ok(body.cfg.nodes.length > 0, 'CFG should have nodes');
  });

  test('returns partial cfg on semantic error', async () => {
    const { body } = await post('int main() { int x = 10; int x = 20; return 0; }');
    assert.equal(body.success, false);
    assert.ok(Array.isArray(body.cfg.nodes));
    assert.ok(Array.isArray(body.cfg.edges));
  });

  test('cfg has more than one node for if-statement code', async () => {
    const { body } = await post('int main() { int x = 5; if(x > 0) { x = 1; } return 0; }');
    assert.equal(body.success, true);
    assert.ok(body.cfg.nodes.length > 1, `Expected >1 CFG nodes, got ${body.cfg.nodes.length}`);
  });
});

// ---------------------------------------------------------------------------
// Suite 9 – Phase 7: Mentor Explanations
// ---------------------------------------------------------------------------
describe('Suite 9 – Mentor Explanations', () => {
  test('explanations contain success status on valid code', async () => {
    const { body } = await post('int main() { int x = 10; return 0; }');
    assert.equal(body.success, true);
    const hasSuccess = body.explanations.some(
      e => e.includes('✅') || e.toLowerCase().includes('success'),
    );
    assert.ok(hasSuccess, 'Should have success status explanation');
  });

  test('explanations describe variable declaration', async () => {
    const { body } = await post('int main() { int heroHealth = 100; return 0; }');
    assert.equal(body.success, true);
    const hasVarDecl = body.explanations.some(
      e => e.includes('heroHealth') || e.toLowerCase().includes('declare'),
    );
    assert.ok(hasVarDecl, 'Should describe variable declaration');
  });

  test('explanations reference frozen/constant metaphor for const variables', async () => {
    const { body } = await post('int main() { const float gravity = 9.8; return 0; }');
    assert.equal(body.success, true);
    const inExplanations = body.explanations.some(
      e => e.toLowerCase().includes('frozen') || e.toLowerCase().includes('constant'),
    );
    const inCFG = body.cfg?.nodes?.some(
      n => n.tutorExplanation && (
        n.tutorExplanation.toLowerCase().includes('frozen') ||
        n.tutorExplanation.toLowerCase().includes('constant')
      ),
    );
    assert.ok(inExplanations || inCFG, 'Should contain frozen/constant metaphor');
  });
});

// ---------------------------------------------------------------------------
// Suite 10 – Phase 8: Gamification
// ---------------------------------------------------------------------------
describe('Suite 10 – Gamification', () => {
  test('awards at least 25 XP for simple correct code', async () => {
    const { body } = await post('int main() { int x = 10; return 0; }');
    assert.equal(body.success, true);
    assert.ok(body.gamification.xpEarned >= 25, `Expected ≥25 XP, got ${body.gamification.xpEarned}`);
  });

  test('awards 0 XP when code has errors', async () => {
    const { body } = await post('int main() { int x = 10; int x = 20; return 0; }');
    assert.equal(body.success, false);
    assert.equal(body.gamification.xpEarned, 0);
  });

  test('hint penalty reduces XP', async () => {
    const { body: noHintBody } = await post('int main() { int x = 10; return 0; }', { hintsUsed: 0 });
    const { body: hintBody } = await post('int main() { int x = 10; return 0; }', { hintsUsed: 2 });
    assert.ok(
      noHintBody.gamification.xpEarned > hintBody.gamification.xpEarned,
      `No-hint XP (${noHintBody.gamification.xpEarned}) should exceed hinted XP (${hintBody.gamification.xpEarned})`,
    );
  });

  test('includes levelTitle "Squire" for level 1', async () => {
    const { body } = await post('int main() { int x = 10; return 0; }', { currentLevel: 1 });
    assert.equal(body.success, true);
    assert.equal(typeof body.gamification.levelTitle, 'string');
    assert.equal(body.gamification.levelTitle, 'Squire');
  });

  test('levelTitle is Knight for level 2', async () => {
    const { body } = await post('int main() { int x = 10; return 0; }', { currentLevel: 2 });
    assert.equal(body.success, true);
    assert.equal(body.gamification.levelTitle, 'Knight');
  });
});

// ---------------------------------------------------------------------------
// Suite 11 – Phase 9: Path Analysis (Dead Code / Logical Contradiction)
// ---------------------------------------------------------------------------
describe('Suite 11 – Path Analysis', () => {
  test('passes code where division by zero is post-return (unreachable)', async () => {
    const { body } = await post('int main() { return 0; int x = 10 / 0; }');
    assert.equal(body.success, true);
    const unsafeErrors = body.safetyChecks.filter(
      s => s.status === 'UNSAFE' || s.severity === 'error',
    );
    assert.equal(unsafeErrors.length, 0, 'Post-return dead code should not raise UNSAFE');
  });

  test('passes code where logical contradiction makes error path dead', async () => {
    const { body } = await post(
      'int main() { int x = 5; if (x > 10 && x < 2) { int y = 1 / 0; } return 0; }',
    );
    assert.equal(body.success, true);
    const unsafeErrors = body.safetyChecks.filter(
      s => s.status === 'UNSAFE' || s.severity === 'error',
    );
    assert.equal(unsafeErrors.length, 0, 'Logically dead path should not raise UNSAFE');
  });
});

// ---------------------------------------------------------------------------
// Suite 12 – Health Check
// ---------------------------------------------------------------------------
describe('Suite 12 – Health Check', () => {
  test('GET / returns 200', async () => {
    const res = await fetch(`${BASE}/`);
    assert.equal(res.status, 200);
  });
});

// ---------------------------------------------------------------------------
// Suite 13 – Unsupported Feature Detection
// ---------------------------------------------------------------------------
describe('Suite 13 – Unsupported Feature Detection', () => {
  test('warns about template usage', async () => {
    const { body } = await post(
      'template<typename T> T add(T a, T b) { return a + b; } int main() { return 0; }',
    );
    const mentionsTemplate =
      body.errors?.some(e => e.message?.toLowerCase().includes('template')) ||
      body.explanations?.some(e => e.toLowerCase().includes('template'));
    assert.ok(mentionsTemplate, 'Should mention unsupported template feature');
  });

  test('rejects lambda expressions, including empty capture lists', async () => {
    const { body } = await post('int main() { auto f = []() { return 1; }; return 0; }');
    assert.equal(body.success, false);
    const mentionsLambda =
      body.errors?.some(e => e.message?.toLowerCase().includes('lambda')) ||
      body.explanations?.some(e => e.toLowerCase().includes('lambda'));
    assert.ok(mentionsLambda, 'Should mention unsupported lambda feature');
  });

  test('rejects function overloading as outside foundations scope', async () => {
    const { body } = await post('int add(int a) { return a; } double add(double a) { return a; } int main() { return 0; }');
    assert.equal(body.success, false);
    const mentionsOverloading =
      body.errors?.some(e => e.message?.toLowerCase().includes('overloading')) ||
      body.explanations?.some(e => e.toLowerCase().includes('overloading'));
    assert.ok(mentionsOverloading, 'Should mention unsupported function overloading');
  });

  test('rejects class-based OOP input', async () => {
    const { body } = await post('class Player { public: int hp; }; int main() { return 0; }');
    assert.equal(body.success, false);
    const mentionsOop =
      body.errors?.some(e => e.message?.toLowerCase().includes('oop') || e.message?.toLowerCase().includes('class')) ||
      body.explanations?.some(e => e.toLowerCase().includes('oop') || e.toLowerCase().includes('class'));
    assert.ok(mentionsOop, 'Should mention unsupported OOP/class input');
  });
});

// ---------------------------------------------------------------------------
// Suite 14 – Complexity Metrics
// ---------------------------------------------------------------------------
describe('Suite 14 – Complexity Metrics', () => {
  test('cognitiveComplexity = 0 for trivial code', async () => {
    const { body } = await post('int main() { return 0; }');
    assert.equal(body.success, true);
    assert.equal(body.cognitiveComplexity, 0);
  });

  test('cognitiveComplexity > 0 for nested control flow', async () => {
    const { body } = await post(
      'int main() { int x = 5; if(x > 0) { if(x < 10) { x = 1; } } return 0; }',
    );
    assert.equal(body.success, true);
    assert.ok(body.cognitiveComplexity > 0, `Expected >0 cognitive complexity, got ${body.cognitiveComplexity}`);
  });

  test('cyclomaticComplexity score is at least 1', async () => {
    const { body } = await post('int main() { return 0; }');
    assert.equal(body.success, true);
    assert.ok(body.cyclomaticComplexity.score >= 1);
  });

  test('cyclomaticComplexity increases with branches', async () => {
    const { body: simpleBody } = await post('int main() { return 0; }');
    const { body: branchBody } = await post(
      'int main() { int x = 5; if(x > 0) { return 1; } return 0; }',
    );
    assert.ok(
      branchBody.cyclomaticComplexity.score > simpleBody.cyclomaticComplexity.score,
      `Branch score (${branchBody.cyclomaticComplexity.score}) should exceed simple score (${simpleBody.cyclomaticComplexity.score})`,
    );
  });
});
