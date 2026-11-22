const assert = require('node:assert/strict');
const { once } = require('node:events');
const { after, test } = require('node:test');

process.env.RATE_LIMIT_MAX_REQUESTS = '1000';
process.env.RATE_LIMIT_MAX_ANALYZE_REQUESTS = '1000';
const app = require('../dist/server.js').default;
const server = app.listen(0, '127.0.0.1');
const endpoint = once(server, 'listening').then(() => {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}/api/analyze`;
});

after(() => new Promise((resolve, reject) => {
  server.closeAllConnections();
  server.close(error => error ? reject(error) : resolve());
}));

async function analyze(body) {
  const response = await fetch(await endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, result: await response.json() };
}

test('comments and string contents do not trigger unsupported-language or header errors', async () => {
  const programs = [
    '// class Example {}\nint main(){return 0;}',
    '/* template <class T> */\nint main(){return 0;}',
    '#include <iostream>\nint main(){std::cout << "template <class T>";return 0;}',
    '#include <iostream>\nint main(){std::cout << "https://example.invalid/string";return 0;}',
    '#include <iostream>\nint main(){std::cout << "/* example */";return 0;}',
  ];
  for (const sourceCode of programs) {
    const { status, result } = await analyze({ sourceCode });
    assert.equal(status, 200);
    assert.equal(result.success, true, JSON.stringify(result.errors));
  }
});

test('ordinary C++ literals and leading source locations survive paste normalization', async () => {
  const sourceCode = '\n\n#include <iostream>\nint main(){std::cout << "<p>hello</p> &lt;";return 0;}';
  const { result } = await analyze({ sourceCode });
  assert.equal(result.success, true);
  const literal = result.tokens.find(token => token.value === '"<p>hello</p> &lt;"');
  assert.ok(literal);
  assert.equal(literal.line, 4);
  const invalid = await analyze({ sourceCode: '\n\nint main(){\nreturn @;\n}' });
  assert.equal(invalid.result.errors[0].line, 4);
  assert.equal(invalid.result.errors[0].column, 8);
});

test('supported pasted wrappers remain usable without rewriting plain source', async () => {
  for (const sourceCode of ['```cpp\nint main(){return 0;}\n```', '<pre>int main(){return 0;}</pre>']) {
    const { result } = await analyze({ sourceCode });
    assert.equal(result.success, true, JSON.stringify(result.errors));
  }
});

test('ordinary literals reject unescaped newlines but accept an escaped newline sequence', async () => {
  for (const sourceCode of [
    '#include <iostream>\nint main(){std::cout << "broken\ntext";return 0;}',
    "int main(){char value='\n';return 0;}",
  ]) {
    const { result } = await analyze({ sourceCode });
    assert.equal(result.success, false);
    assert.ok(result.errors.some(error => /literal/.test(error.message)));
  }
  const valid = await analyze({ sourceCode: '#include <iostream>\nint main(){std::cout << "valid\\ntext";return 0;}' });
  assert.equal(valid.result.success, true);
});

test('unsupported code and undeclared identifiers identify their actual location', async () => {
  const unsupported = await analyze({ sourceCode: '\nclass Example {};\nint main(){return 0;}' });
  assert.equal(unsupported.result.success, false);
  assert.equal(unsupported.result.errors[0].line, 2);
  assert.equal(unsupported.result.errors[0].column, 1);
  const undeclared = await analyze({ sourceCode: 'int main(){\nreturn missing;\n}' });
  assert.equal(undeclared.result.success, false);
  assert.equal(undeclared.result.errors[0].line, 2);
  assert.equal(undeclared.result.errors[0].column, 8);
});

test('unexecuted while bodies and short-circuited operands do not produce runtime hazards', async () => {
  for (const sourceCode of [
    'int main(){while(false){int x=5/0;}return 0;}',
    'int main(){bool x=false && (5/0);return 0;}',
    'int main(){bool x=true || (5/0);return 0;}',
    'int main(){if(false){int x=5/0;}return 0;}',
    'int main(){int x=false ? 5/0 : 2;return x;}',
    'int main(){int x=true ? 2 : 5/0;return x;}',
    'int main(){if(true){return 0;int x=5/0;}return 0;}',
  ]) {
    const { result } = await analyze({ sourceCode });
    assert.equal(result.success, true, JSON.stringify(result.errors));
    assert.equal(result.safetyChecks.some(check => check.status === 'UNSAFE'), false);
    assert.equal(result.safetyChecks.some(check => /Infinite loop/.test(check.message)), false);
  }
  for (const sourceCode of [
    'int main(){bool x=true && (5/0);return 0;}',
    'int main(){bool x=false || (5/0);return 0;}',
    'int main(){int x=5%0;return x;}',
    'int main(){while(5/0){break;}return 0;}',
  ]) {
    const { result } = await analyze({ sourceCode });
    assert.ok(result.safetyChecks.some(check => check.status === 'UNSAFE'));
  }
});

test('a return in one symbolic branch does not hide hazards reachable through the other branch', async () => {
  const { result } = await analyze({ sourceCode: 'int example(int input){if(input){return 0;}int x=5/0;return x;}int main(){return 0;}' });
  assert.equal(result.success, true, JSON.stringify(result.errors));
  assert.ok(result.safetyChecks.some(check => check.status === 'UNSAFE' && /zero/.test(check.message)));
});

test('simple object macros retain original tokens and have usable numeric types and values', async () => {
  const sourceCode = '#define LIMIT 3\nint main(){int x=LIMIT;return x;}';
  const { result } = await analyze({ sourceCode });
  assert.equal(result.success, true, JSON.stringify(result.errors));
  assert.ok(result.tokens.some(token => token.value === 'LIMIT' && token.line === 2));
  assert.ok(result.symbolicExecution.some(entry => entry.value === 3));
  const text = await analyze({ sourceCode: '#define LIMIT 3\n#include <iostream>\nint main(){std::cout << "LIMIT";return 0;}' });
  assert.ok(text.result.tokens.some(token => token.value === '"LIMIT"'));
});

test('local names do not become standard manipulators and nonintegral shifts are rejected', async () => {
  const valid = await analyze({ sourceCode: 'int main(){int left=1;return left;}' });
  assert.equal(valid.result.success, true, JSON.stringify(valid.result.errors));
  const invalid = await analyze({ sourceCode: 'int main(){int x=1.5<<1;return x;}' });
  assert.equal(invalid.result.success, false);
  assert.ok(invalid.result.errors.some(error => /integral/.test(error.message)));
});

test('array boundaries and uninitialized reads are reported without treating valid endpoints as hazards', async () => {
  for (const index of [0, 2]) {
    const { result } = await analyze({ sourceCode: `int main(){int a[3]={1,2,3};return a[${index}];}` });
    assert.equal(result.success, true);
    assert.equal(result.safetyChecks.some(check => check.status === 'UNSAFE'), false);
  }
  const beyond = await analyze({ sourceCode: 'int main(){int a[3]={1,2,3};return a[3];}' });
  assert.equal(beyond.result.success, false);
  const negative = await analyze({ sourceCode: 'int main(){int a[3]={1,2,3};return a[-1];}' });
  assert.ok(negative.result.safetyChecks.some(check => check.status === 'UNSAFE'));
  const uninitialized = await analyze({ sourceCode: 'int main(){int x;return x;}' });
  assert.ok(uninitialized.result.safetyChecks.some(check => /initializ/.test(check.message)));
});

test('numeric traces distinguish floating-point division from integer division and conversions', async () => {
  for (const [sourceCode, expected] of [
    ['int main(){double x=5.0/2.0;return 0;}', 2.5],
    ['int main(){double a=5;double x=a/2;return 0;}', 2.5],
    ['int main(){int x=5/2;return x;}', 2],
    ['int main(){double x=5/2;return 0;}', 2],
    ['int main(){int x=5.0/2.0;return x;}', 2],
    ['int main(){double x=-5.0/2.0;return 0;}', -2.5],
    ['int main(){double a=5;a=7;double x=a/2;return 0;}', 3.5],
    ['int main(){double a=5;a/=2;double x=a;return 0;}', 2.5],
    ['int main(){int x=2<<1;return x;}', 4],
    ['#include <cmath>\nint main(){double x=sqrt(9)/2;return 0;}', 1.5],
  ]) {
    const { result } = await analyze({ sourceCode });
    assert.equal(result.success, true, JSON.stringify(result.errors));
    assert.equal(result.symbolicExecution.find(entry => /^(?:int|double) x =/.test(entry.expression))?.value, expected, sourceCode);
  }
  const zero = await analyze({ sourceCode: 'int main(){int x=5;x/=0;return x;}' });
  assert.ok(zero.result.safetyChecks.some(check => check.status === 'UNSAFE' && /zero/.test(check.message)));
});

test('target-dependent sizeof is identified as symbolic instead of reporting a fabricated constant', async () => {
  const { result } = await analyze({ sourceCode: 'int main(){double value=0;int size=sizeof(value);return size;}' });
  assert.equal(result.success, true, JSON.stringify(result.errors));
  assert.ok(result.safetyChecks.some(check => check.type === 'sizeof' || /sizeof/.test(check.message)));
  assert.equal(result.symbolicExecution.find(entry => /^int size/.test(entry.expression))?.value, 'int');
});

test('existing boolean scalars participate in integral promotion and return conversion', async () => {
  for (const sourceCode of [
    'int main(){bool value=true;return value;}',
    'int main(){bool value=true;int total=value+2;return total;}',
  ]) {
    const { result } = await analyze({ sourceCode });
    assert.equal(result.success, true, JSON.stringify(result.errors));
  }
});

test('invalid reward metadata cannot inflate XP or serialize nonfinite rewards', async () => {
  for (const hintsUsed of [-1, 0.5, 'bad', {}, null, Number.MAX_SAFE_INTEGER + 1]) {
    const { status, result } = await analyze({ sourceCode: 'int main(){return 0;}', hintsUsed });
    assert.equal(status, 400);
    assert.equal(result.success, false);
  }
});

test('malformed and oversized JSON are rejected and repeated input remains deterministic', async () => {
  const malformed = await fetch(await endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  const large = await analyze({ sourceCode: ' '.repeat(1024 * 1024) });
  assert.equal(large.status, 413);
  const body = { sourceCode: 'int main(){int total=0;for(int i=0;i<3;i++){total+=i;}return total;}' };
  const first = await analyze(body);
  for (let repeat = 0; repeat < 3; repeat += 1) assert.deepEqual(await analyze(body), first);
});
