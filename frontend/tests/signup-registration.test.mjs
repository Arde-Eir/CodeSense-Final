import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { once } from 'node:events'
import { createServer as createHttpServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// Exercise the real Supabase client over HTTP without creating hosted accounts.
const requests = []
const auth = createHttpServer(async (request, response) => {
  requests.push({ method: request.method, path: request.url })
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  response.setHeader('Content-Type', 'application/json')
  response.setHeader('X-Supabase-Api-Version', '2024-01-01')
  if (request.method !== 'POST' || request.url !== '/auth/v1/signup') {
    response.writeHead(500).end(JSON.stringify({ message: 'Unexpected account operation' }))
    return
  }
  const { email } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (email === 'existing@example.invalid') {
    response.writeHead(422).end(JSON.stringify({ code: 'user_already_exists', msg: 'User already registered' }))
    return
  }
  if (email === 'email-code@example.invalid') {
    response.writeHead(422).end(JSON.stringify({ code: 'email_exists', msg: 'Email in use' }))
    return
  }
  const user = {
    id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated',
    email, created_at: '2026-11-23T00:00:00Z', app_metadata: {}, user_metadata: {},
    identities: email === 'hidden-existing@example.invalid' ? [] : [{
      id: '22222222-2222-4222-8222-222222222222', user_id: '11111111-1111-4111-8111-111111111111',
      identity_id: '33333333-3333-4333-8333-333333333333', provider: 'email', identity_data: { email },
      created_at: '2026-11-23T00:00:00Z', updated_at: '2026-11-23T00:00:00Z',
    }],
  }
  response.end(JSON.stringify(user))
})
auth.listen(0, '127.0.0.1')
await once(auth, 'listening')
process.env.VITE_SUPABASE_URL = `http://127.0.0.1:${auth.address().port}`
process.env.VITE_SUPABASE_ANON_KEY = 'signup-test-public-placeholder'
process.env.VITE_SENTRY_DSN = ''
const server = await createServer({
  root: fileURLToPath(new URL('../', import.meta.url)),
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true }, appType: 'custom',
})
const { DatabaseService } = await server.ssrLoadModule('/src/services/DatabaseService.ts')
const { supabase } = await server.ssrLoadModule('/src/services/supabase.ts')

after(async () => {
  await server.close()
  auth.closeAllConnections()
  await new Promise(resolve => auth.close(resolve))
})

for (const email of ['existing@example.invalid', 'email-code@example.invalid', 'hidden-existing@example.invalid']) {
  test(`signup rejects ${email} without signing in or writing profile data`, async () => {
    requests.length = 0
    await assert.rejects(
      DatabaseService.signUp('NewPlayer', 'test-only-password', email, 'student', 'local-test-token'),
      { message: 'EMAIL_TAKEN' },
    )
    assert.deepEqual(requests, [{ method: 'POST', path: '/auth/v1/signup' }])
    assert.equal((await supabase.auth.getSession()).data.session, null)
  })
}

test('a new unconfirmed account gets confirmation guidance rather than a duplicate warning', async () => {
  requests.length = 0
  await assert.rejects(
    DatabaseService.signUp('NewPlayer', 'test-only-password', 'new@example.invalid', 'student', 'local-test-token'),
    { message: 'Check your inbox for the confirmation link, then sign in after confirming your email.' },
  )
  assert.deepEqual(requests, [{ method: 'POST', path: '/auth/v1/signup' }])
  assert.equal((await supabase.auth.getSession()).data.session, null)
})
