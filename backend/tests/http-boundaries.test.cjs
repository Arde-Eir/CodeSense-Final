const assert = require('node:assert/strict');
const { once } = require('node:events');
const { after, test } = require('node:test');

process.env.RATE_LIMIT_WINDOW_MS = '10000';
process.env.RATE_LIMIT_MAX_REQUESTS = '100';
process.env.RATE_LIMIT_MAX_ANALYZE_REQUESTS = '2';
const app = require('../dist/server.js').default;
const server = app.listen(0, '127.0.0.1');
const origin = once(server, 'listening').then(() => {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
});

after(() => new Promise((resolve, reject) => {
  server.closeAllConnections();
  server.close(error => error ? reject(error) : resolve());
}));

test('the server permits its local frontend and rejects an unrelated browser origin', async () => {
  const url = `${await origin}/`;
  const local = await fetch(url, { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(local.status, 200);
  assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const blocked = await fetch(url, { headers: { Origin: 'https://untrusted.example.invalid' } });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).success, false);
});

test('rapid repeated analysis reaches the configured limit with an accurate retry window', async () => {
  const url = `${await origin}/api/analyze`;
  const results = [];
  for (let count = 0; count < 3; count += 1) {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceCode: 'int main(){return 0;}' }),
    });
    results.push({ status: response.status, body: await response.json() });
  }
  assert.deepEqual(results.map(result => result.status), [200, 200, 429]);
  assert.match(results[2].body.errors[0].message, /Wait 10 seconds/);
});
