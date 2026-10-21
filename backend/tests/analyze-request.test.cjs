const assert = require('node:assert/strict');
const { once } = require('node:events');
const { after, test } = require('node:test');
const app = require('../dist/server.js').default;

const server = app.listen(0, '127.0.0.1');
const analysisUrl = once(server, 'listening').then(() => {
  const address = server.address();
  assert.ok(address && typeof address === 'object', 'The backend must listen on a TCP port.');
  return `http://127.0.0.1:${address.port}/api/analyze`;
});

after(() => new Promise((resolve, reject) => {
  server.close(error => {
    if (error) reject(error);
    else resolve();
  });
}));

test('analysis rejects missing or invalid request bodies with HTTP 400', async () => {
  const url = await analysisUrl;
  const requests = [
    { method: 'POST' },
    { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'invalid body' },
    ...[{}, [], { sourceCode: null }, { sourceCode: 42 }, { sourceCode: '' }, { sourceCode: ' \t\n' }]
      .map(body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
  ];

  for (const request of requests) {
    const response = await fetch(url, request);
    const result = await response.json();
    assert.equal(response.status, 400, `Invalid analysis request must be rejected: ${JSON.stringify(request)}`);
    assert.equal(result.success, false);
    assert.ok(Array.isArray(result.errors) && result.errors.length > 0);
  }
});

test('analysis accepts valid source code and optional request metadata', async () => {
  const url = await analysisUrl;
  const sourceCode = 'int main() { return 0; }';

  for (const body of [{ sourceCode }, { sourceCode, hintsUsed: 1, currentLevel: 2, extraField: 'ignored' }]) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.success, true);
    assert.ok(result.tokens.length > 0);
    assert.equal(result.ast.type, 'Program');
    assert.ok(result.cfg.nodes.length > 0);
  }
});

test('C++ syntax errors remain analysis results', async () => {
  const response = await fetch(await analysisUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceCode: 'int main( {' }),
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.success, false);
  assert.ok(result.errors.some(error => error.type === 'syntactic'));
});
