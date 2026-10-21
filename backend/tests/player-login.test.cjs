const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { after, test } = require('node:test');

// Isolate configuration so these HTTP checks never contact a real account.
const child = spawn(process.execPath, ['-e', `
  const app = require('./dist/server.js').default;
  const server = app.listen(0, '127.0.0.1', () => process.send(server.address().port));
  process.on('message', () => server.close(() => process.exit(0)));
`], {
  cwd: path.resolve(__dirname, '..'),
  env: { ...process.env, SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', SENTRY_DSN: '' },
  stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  windowsHide: true,
});
const loginUrl = once(child, 'message').then(([port]) => `http://127.0.0.1:${port}/api/auth/login`);

after(async () => {
  const exited = once(child, 'exit');
  child.send('shutdown');
  await exited;
});

test('player login rejects malformed credentials before contacting Supabase', async () => {
  for (const body of [null, [], {}, { playerName: 'Player' }, { playerName: '%', secretCode: 12 },
    { playerName: ' ', secretCode: 'password' }, { playerName: 'x'.repeat(257), secretCode: 'password' },
    { playerName: 'Player', secretCode: 'x'.repeat(1025) }]) {
    const response = await fetch(await loginUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(typeof (await response.json()).error, 'string');
  }
});

test('player login fails closed when its backend-only configuration is missing', async () => {
  const response = await fetch(await loginUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerName: 'Player', secretCode: 'password' }),
  });
  const result = await response.json();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(result.error, /Contact an administrator/);
  assert.equal(result.access_token, undefined);
  assert.equal(result.refresh_token, undefined);
});

test('player login rejects oversized JSON without accepting credentials', async () => {
  const response = await fetch(await loginUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerName: 'Player', secretCode: 'x'.repeat(9000) }),
  });
  assert.equal(response.status, 413);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
