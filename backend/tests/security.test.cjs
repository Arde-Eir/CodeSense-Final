const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('ts-node/register/transpile-only');

const app = require('../src/server.ts').default;

function listen() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to bind test server to a TCP port.'));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function postAnalyze(baseUrl, sourceCode, forwardedFor) {
  return fetch(`${baseUrl}/api/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': forwardedFor,
    },
    body: JSON.stringify({ sourceCode, hintsUsed: 0 }),
  });
}

describe('Backend security controls', () => {
  let server;
  let baseUrl;

  before(async () => {
    const started = await listen();
    server = started.server;
    baseUrl = started.baseUrl;
  });

  after(async () => {
    await close(server);
  });

  it('rejects unlisted browser origins', async () => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil-preview.vercel.app',
        'X-Forwarded-For': '203.0.113.10',
      },
      body: JSON.stringify({ sourceCode: 'int main(){return 0;}' }),
    });

    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });

  it('returns explicit status codes for malformed, oversized, and missing routes', async () => {
    const malformed = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.11',
      },
      body: '{ bad json',
    });
    assert.equal(malformed.status, 400);

    const oversized = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.12',
      },
      body: JSON.stringify({ sourceCode: 'a'.repeat(1_100_000) }),
    });
    assert.equal(oversized.status, 413);

    const missing = await fetch(`${baseUrl}/not-a-route`, {
      headers: { 'X-Forwarded-For': '203.0.113.13' },
    });
    assert.equal(missing.status, 404);
  });

  it('rate limits repeated analysis requests per client address', async () => {
    const forwardedFor = '203.0.113.14';
    const requests = Array.from({ length: 21 }, () => (
      postAnalyze(baseUrl, 'int main(){return 0;}', forwardedFor)
    ));
    const responses = await Promise.all(requests);
    const statuses = responses.map((response) => response.status);

    assert.ok(statuses.includes(429));
  });
});
