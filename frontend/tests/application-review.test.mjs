import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer as createHttpServer } from 'node:http'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url))
backendRequire('ts-node').register({ project: fileURLToPath(new URL('../../backend/tsconfig.json', import.meta.url)) })
process.env.SENTRY_DSN = ''
process.env.RATE_LIMIT_MAX_REQUESTS = '1000'
process.env.RATE_LIMIT_MAX_ANALYZE_REQUESTS = '1000'
const backend = backendRequire('./src/server.ts').default.listen(0, '127.0.0.1')
await once(backend, 'listening')
const backendUrl = `http://127.0.0.1:${backend.address().port}`
const delays = new Set()
const proxy = createHttpServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = Buffer.concat(chunks).toString('utf8')
  const forward = async () => {
    const upstream = await fetch(`${backendUrl}${request.url}`, {
      method: request.method, headers: { 'Content-Type': 'application/json' }, body,
    })
    const text = await upstream.text()
    if (!response.destroyed) {
      response.writeHead(upstream.status, { 'Content-Type': 'application/json' })
      response.end(text)
    }
  }
  if (body.includes('review_delay')) {
    const timer = setTimeout(() => { delays.delete(timer); void forward() }, 180)
    delays.add(timer)
  } else {
    await forward()
  }
})
proxy.listen(0, '127.0.0.1')
await once(proxy, 'listening')
process.env.VITE_API_BASE_URL = `http://127.0.0.1:${proxy.address().port}`
process.env.VITE_SUPABASE_URL = 'https://example.invalid'
process.env.VITE_SUPABASE_ANON_KEY = 'review-public-placeholder'
process.env.VITE_SENTRY_DSN = ''

// The browser-only editor and graph are replaced; application state and HTTP processing remain real.
const server = await createServer({
  root: fileURLToPath(new URL('../', import.meta.url)),
  cacheDir: fileURLToPath(new URL(`../node_modules/.vite/application-review-${process.pid}`, import.meta.url)),
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true }, appType: 'custom',
  plugins: [{
    name: 'review-browser-surfaces', enforce: 'pre',
    load(id) {
      const path = id.replaceAll('\\', '/')
      if (path.endsWith('/src/components/Editor/CodeEditor.tsx')) return `import React from 'react'; export function CodeEditor({code,onChange}) { return React.createElement('textarea', {'data-testid':'review-editor',value:code,onInput:event=>onChange(event.target.value),onChange:()=>{}}) }`
      if (path.endsWith('/src/components/Visualizer/FlowGraph.tsx')) return `import React from 'react'; export function FlowGraph({cfg}) { return React.createElement('output', {'data-testid':'review-graph'}, cfg ? String(cfg.nodes.length) : 'empty') }`
    },
  }],
})
const { LoginPage } = await server.ssrLoadModule('/src/pages/public/Loginpage.tsx')
const { SignupPage } = await server.ssrLoadModule('/src/pages/public/Signuppage.tsx')
const { SandboxPage } = await server.ssrLoadModule('/src/pages/app/SandboxPage.tsx')
const { AuthContext } = await server.ssrLoadModule('/src/components/AuthContext.ts')
const { analyzeCode, cancelAnalysis } = await server.ssrLoadModule('/src/services/api.ts')
const { findPreprocessorDependencyErrors } = await server.ssrLoadModule('/src/services/PreprocessorDependencies.ts')
const { validateGraph } = await server.ssrLoadModule('/src/services/GraphValidator.ts')
const { generateCppFromGraph } = await server.ssrLoadModule('/src/services/CodeGenerator.ts')

after(async () => {
  cancelAnalysis()
  for (const timer of delays) clearTimeout(timer)
  await server.close()
  proxy.closeAllConnections()
  backend.closeAllConnections()
  await Promise.all([new Promise(resolve => proxy.close(resolve)), new Promise(resolve => backend.close(resolve))])
})

function environment(storageQuota) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', storageQuota })
  const globals = {
    window: dom.window, document: dom.window.document, Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement, sessionStorage: dom.window.sessionStorage,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true,
  }
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const root = createRoot(dom.window.document.getElementById('root'))
  return { dom, root, async close() {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  } }
}

function context() {
  return {
    user: null, isGuest: true, isAuthenticated: false, isAdmin: false,
    maintenanceMode: false, maintenanceMessage: '', setUser() {},
    async login() {}, async signup() {}, logout() {}, continueAsGuest() {}, goBack() {}, async refreshMaintenanceMode() {},
  }
}

test('the API client preserves HTTP failure details and supports a corrected retry against the real backend', async () => {
  await assert.rejects(analyzeCode('int main(){return 0;}', { hintsUsed: -1 }), /HTTP 400.*hintsUsed/)
  const result = await analyzeCode('int main(){int left=1;return left;}', {})
  assert.equal(result.success, true)
  assert.ok(result.cfg.nodes.length > 0)
})

test('dependency scans distinguish quoted comment markers and commented-out include directives', () => {
  assert.equal(findPreprocessorDependencyErrors('#include <iostream>\nint main(){std::cout<<"https://example.invalid/string";}').length, 0)
  assert.equal(findPreprocessorDependencyErrors('// #include <iostream>\nint main(){std::cout<<1;}').length, 1)
  assert.equal(findPreprocessorDependencyErrors('int main(){int left=1;return left;}').length, 0)
})

test('editing code clears old results and a cancelled response cannot replace the current sandbox result', async () => {
  const env = environment(10_000_000)
  const select = id => env.dom.window.document.querySelector(`[data-testid="${id}"]`)
  const update = async value => {
    const editor = select('review-editor')
    assert.ok(editor)
    await act(async () => {
      Object.getOwnPropertyDescriptor(env.dom.window.HTMLTextAreaElement.prototype, 'value').set.call(editor, value)
      editor.dispatchEvent(new env.dom.window.Event('input', { bubbles: true }))
      editor.dispatchEvent(new env.dom.window.Event('change', { bubbles: true }))
    })
  }
  const finish = async () => {
    for (let attempt = 0; attempt < 100 && select('sandbox-analyze').disabled; attempt += 1) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    }
    assert.equal(select('sandbox-analyze').disabled, false)
  }
  try {
    await act(async () => env.root.render(React.createElement(MemoryRouter, null,
      React.createElement(AuthContext.Provider, { value: context() }, React.createElement(SandboxPage)))))
    await act(async () => select('sandbox-analyze').click())
    await finish()
    assert.notEqual(select('review-graph')?.textContent, 'empty')
    await update('int main(){return 0;} // review_delay')
    assert.equal(select('review-graph'), null)
    await act(async () => select('sandbox-analyze').click())
    await update('int main(){return 1;}')
    await act(async () => select('sandbox-analyze').click())
    await finish()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)) })
    assert.ok(select('review-graph'))
    assert.ok(!env.dom.window.document.body.textContent.includes('timed out or was cancelled'))
    assert.equal(select('review-editor').value, 'int main(){return 1;}')
  } finally { await env.close() }
})

test('login labels and keyboard registration link are available and repeated submissions stay single-flight', async () => {
  const env = environment(10_000_000)
  const state = context()
  let submissions = 0
  let rejectLogin
  state.login = () => {
    submissions += 1
    return new Promise((resolve, reject) => { rejectLogin = reject })
  }
  try {
    await act(async () => env.root.render(React.createElement(MemoryRouter, null,
      React.createElement(AuthContext.Provider, { value: state }, React.createElement(LoginPage)))))
    const form = env.dom.window.document.querySelector('[data-testid="login-form"]')
    const player = env.dom.window.document.getElementById('login-player-name')
    const secret = env.dom.window.document.getElementById('login-secret-code')
    assert.equal(player.labels.length, 1)
    assert.equal(secret.labels.length, 1)
    assert.ok(env.dom.window.document.querySelector('a[href="/signup"]'))
    await act(async () => {
      form.dispatchEvent(new env.dom.window.Event('submit', { bubbles: true, cancelable: true }))
      form.dispatchEvent(new env.dom.window.Event('submit', { bubbles: true, cancelable: true }))
    })
    assert.equal(submissions, 1)
    assert.equal(env.dom.window.document.querySelector('[data-testid="login-guest"]').disabled, true)
    await act(async () => { rejectLogin(new Error('INVALID_CREDENTIALS')); await Promise.resolve() })
    assert.equal(env.dom.window.document.querySelector('[data-testid="login-error"]').getAttribute('role'), 'alert')
    assert.equal(env.dom.window.document.querySelector('[data-testid="login-guest"]').disabled, false)
  } finally { await env.close() }
})

test('flowchart generation validates connected paths and the emitted C++ passes the real analyzer', async () => {
  const nodes = [
    { id: 'start', type: 'terminator', data: { label: 'Start' }, position: { x: 0, y: 0 } },
    { id: 'value', type: 'process', data: { label: 'Set value', code: 'int value = 3;' }, position: { x: 0, y: 100 } },
    { id: 'output', type: 'io', data: { label: 'Print value', code: 'cout << value;' }, position: { x: 0, y: 200 } },
    { id: 'end', type: 'terminator', data: { label: 'End' }, position: { x: 0, y: 300 } },
  ]
  const edges = [
    { id: 'a', source: 'start', target: 'value' },
    { id: 'b', source: 'value', target: 'output' },
    { id: 'c', source: 'output', target: 'end' },
  ]
  assert.equal(validateGraph([], []).isValid, false)
  assert.equal(validateGraph(nodes, edges.slice(1)).isValid, false)
  const validation = validateGraph(nodes, edges)
  assert.equal(validation.isValid, true, JSON.stringify(validation.errors))
  const result = await analyzeCode(generateCppFromGraph(nodes, edges), {})
  assert.equal(result.success, true, JSON.stringify(result.errors))
  assert.ok(result.cfg.nodes.length >= 3)
})

test('signup fields have labels and empty submission fails before external registration', async () => {
  const env = environment(10_000_000)
  let submissions = 0
  const state = context()
  state.signup = async () => { submissions += 1 }
  try {
    await act(async () => env.root.render(React.createElement(MemoryRouter, null,
      React.createElement(AuthContext.Provider, { value: state }, React.createElement(SignupPage)))))
    for (const id of ['signup-username', 'signup-email', 'signup-password', 'signup-confirm-password']) {
      assert.equal(env.dom.window.document.getElementById(id).labels.length, 1)
    }
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 4100)) })
    await act(async () => env.dom.window.document.getElementById('signup-form')
      .dispatchEvent(new env.dom.window.Event('submit', { bubbles: true, cancelable: true })))
    assert.equal(submissions, 0)
    assert.ok(env.dom.window.document.querySelectorAll('[role="alert"]').length >= 4)
  } finally { await env.close() }
})

test('a full browser storage quota displays an analysis error and releases the loading state without losing code', async () => {
  const env = environment(64)
  try {
    await act(async () => env.root.render(React.createElement(MemoryRouter, null,
      React.createElement(AuthContext.Provider, { value: context() }, React.createElement(SandboxPage)))))
    const editor = env.dom.window.document.querySelector('[data-testid="review-editor"]')
    const source = editor.value
    await act(async () => env.dom.window.document.querySelector('[data-testid="sandbox-analyze"]').click())
    assert.equal(env.dom.window.document.querySelector('[data-testid="sandbox-analyze"]').disabled, false)
    assert.equal(editor.value, source)
    assert.equal(env.dom.window.document.querySelector('[data-testid="sandbox-analysis-status"]').dataset.status, 'error')
    assert.ok(/quota/i.test(env.dom.window.document.body.textContent))
  } finally { await env.close() }
})
