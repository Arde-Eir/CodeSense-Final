import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import React, { act, useRef, useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' })
after(() => server.close())
const { TourController } = await server.ssrLoadModule('/src/components/TourController.tsx')
const { AuthContext } = await server.ssrLoadModule('/src/components/AuthContext.ts')
const { AccountRoute, AdminRoute, ProtectedRoute } = await server.ssrLoadModule('/src/routes/guards.tsx')
const { ONBOARD_KEY, ONBOARD_ACTIVE_KEY, ONBOARD_STEP_KEY, ONBOARD_VIEW_KEY } = await server.ssrLoadModule('/src/components/OnboardingWalkthrough.tsx')

async function createEnvironment(entries) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/home', storageQuota: 1024 })
  const globals = {
    window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
    Node: dom.window.Node, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
  }
  const previousGlobals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  for (const [key, value] of entries) localStorage.setItem(key, value)
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.getElementById('root'))
  const select = id => document.querySelector(`[data-testid="${id}"]`)
  const click = async id => {
    const element = select(id)
    assert.ok(element, `Expected ${id} to be available`)
    await act(async () => element.click())
  }
  const chooseStep = async index => {
    const control = select('welcome-tour-step')
    assert.ok(control, 'Expected the tour step picker to be available')
    await act(async () => {
      control.value = String(index)
      control.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
  }
  const key = async (value, shift) => {
    await act(async () => document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, shiftKey: shift, bubbles: true, cancelable: true })))
  }
  const destroy = async () => {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
  return { dom, root, select, click, chooseStep, key, destroy }
}

function PageFixture() {
  const location = useLocation()
  const navigate = useNavigate()
  const [clicks, setClicks] = useState(0)
  return React.createElement('main', null,
    React.createElement('output', { 'data-testid': 'tour-page-path' }, location.pathname),
    React.createElement('output', { 'data-testid': 'tour-page-clicks' }, clicks),
    React.createElement('button', { type: 'button', 'data-testid': 'tour-page-action', onClick: () => setClicks(value => value + 1) }, 'Use this page'),
    React.createElement('button', { type: 'button', 'data-testid': 'tour-page-replay', onClick: () => window.dispatchEvent(new window.CustomEvent('cs-replay-tour')) }, 'Replay tour'),
    React.createElement('button', { type: 'button', 'data-testid': 'tour-page-admin', onClick: () => navigate('/admin') }, 'Admin route'))
}

function TourFixture({ isGuest, isAdmin, initialPath }) {
  const backgroundRef = useRef(null)
  const auth = { user: isGuest ? null : { id: 'learner' }, isGuest, isAdmin, isAuthenticated: !isGuest }
  const page = React.createElement(PageFixture)
  const protectedPage = React.createElement(ProtectedRoute, null, page)
  const accountPage = React.createElement(AccountRoute, null, page)
  return React.createElement(MemoryRouter, { initialEntries: [initialPath] },
    React.createElement(AuthContext.Provider, { value: auth },
      React.createElement(TourController, { backgroundRef }),
      React.createElement('div', { ref: backgroundRef, 'data-testid': 'tour-page-background' },
        React.createElement(Routes, null,
          React.createElement(Route, { path: '/home', element: protectedPage }),
          React.createElement(Route, { path: '/sandbox', element: protectedPage }),
          React.createElement(Route, { path: '/campaign', element: accountPage }),
          React.createElement(Route, { path: '/profile', element: accountPage }),
          React.createElement(Route, { path: '/progress', element: accountPage }),
          React.createElement(Route, { path: '/admin', element: React.createElement(AdminRoute, null, page) }),
          ...['/signup', '/login', '/leaderboard', '/tutorials'].map(path => React.createElement(Route, { key: path, path, element: page }))))))
}

test('replaying, opening features, exploring, and pausing preserve the current tour step and page state', async () => {
  const env = await createEnvironment([[ONBOARD_KEY, 'done']])
  try {
    document.body.style.overflow = 'auto'
    document.documentElement.style.overflow = 'scroll'
    await act(async () => env.root.render(React.createElement(TourFixture, { isGuest: false, isAdmin: false, initialPath: '/home' })))
    assert.equal(env.select('welcome-tour-dialog'), null)
    await env.click('tour-page-replay')
    const background = env.select('tour-page-background')
    assert.equal(background.inert, true)
    assert.equal(document.documentElement.style.overflow, 'hidden')
    assert.equal(document.activeElement, env.select('welcome-tour-dialog'))
    await env.click('welcome-tour-backdrop')
    assert.ok(env.select('welcome-tour-dialog'))
    assert.equal(localStorage.getItem(ONBOARD_STEP_KEY), '0')
    await env.key('Tab', true)
    assert.equal(document.activeElement, env.select('welcome-tour-next'))
    await env.key('Tab', false)
    assert.equal(document.activeElement, env.select('welcome-tour-minimize'))
    await env.key('Escape', false)
    assert.equal(env.select('welcome-tour-dialog'), null)
    assert.equal(background.inert, false)
    assert.equal(localStorage.getItem(ONBOARD_ACTIVE_KEY), 'true')
    assert.equal(localStorage.getItem(ONBOARD_VIEW_KEY), 'minimized')
    assert.equal(document.body.style.overflow, 'auto')
    assert.equal(document.documentElement.style.overflow, 'scroll')
    assert.equal(document.activeElement, env.select('welcome-tour-resume'))
    await env.click('welcome-tour-resume')
    await env.chooseStep(2)
    await env.click('welcome-tour-open-feature')
    assert.equal(env.select('tour-page-path').textContent, '/sandbox')
    assert.ok(env.select('welcome-tour-dock'))
    assert.equal(env.select('welcome-tour-dialog'), null)
    assert.equal(localStorage.getItem(ONBOARD_STEP_KEY), '2', 'Opening a feature must not advance the tour')
    assert.equal(localStorage.getItem(ONBOARD_VIEW_KEY), 'exploring')
    assert.equal(background.inert, false)
    await env.click('tour-page-action')
    assert.equal(env.select('tour-page-clicks').textContent, '1')
    await env.click('welcome-tour-review')
    assert.equal(env.select('welcome-tour-step').value, '2')
    await env.click('welcome-tour-backdrop')
    assert.equal(env.select('welcome-tour-step').value, '2')
    await env.click('welcome-tour-open-feature')
    assert.equal(env.select('tour-page-clicks').textContent, '1')
    await env.click('welcome-tour-minimize')
    await env.click('tour-page-action')
    assert.equal(env.select('tour-page-clicks').textContent, '2')
    await env.click('welcome-tour-resume')
    await env.click('welcome-tour-next')
    assert.equal(env.select('welcome-tour-step').value, '3')
    assert.equal(env.select('tour-page-path').textContent, '/sandbox')
    await env.click('welcome-tour-back')
    assert.equal(env.select('welcome-tour-step').value, '2')
    await env.click('welcome-tour-end')
    assert.equal(env.select('welcome-tour-dialog'), null)
    assert.equal(background.inert, false)
    assert.equal(localStorage.getItem(ONBOARD_ACTIVE_KEY), null)
    assert.equal(localStorage.getItem(ONBOARD_VIEW_KEY), null)
    assert.equal(localStorage.getItem(ONBOARD_STEP_KEY), null)
    assert.equal(env.select('tour-page-path').textContent, '/sandbox')
    await env.click('tour-page-replay')
    assert.equal(env.select('welcome-tour-step').value, '0')
    await env.click('welcome-tour-end')
  } finally {
    await env.destroy()
  }
})

test('campaign and profile open visibly and refresh restores both the saved step and minimized view', async () => {
  const env = await createEnvironment([[ONBOARD_KEY, 'done']])
  const fixture = path => React.createElement(TourFixture, { isGuest: false, isAdmin: false, initialPath: path })
  try {
    await act(async () => env.root.render(fixture('/home')))
    await env.click('tour-page-replay')
    for (const [step, path] of [[4, '/campaign'], [7, '/profile']]) {
      await env.chooseStep(step)
      await env.click('welcome-tour-open-feature')
      assert.equal(env.select('tour-page-path').textContent, path)
      assert.equal(env.select('welcome-tour-dialog'), null)
      assert.ok(env.select('welcome-tour-dock'))
      await env.click('welcome-tour-review')
      assert.equal(env.select('welcome-tour-step').value, String(step))
    }
    await env.click('welcome-tour-open-feature')
    await act(async () => env.root.render(null))
    await act(async () => env.root.render(fixture('/profile')))
    assert.ok(env.select('welcome-tour-dock'))
    assert.equal(env.select('welcome-tour-dialog'), null)
    assert.equal(localStorage.getItem(ONBOARD_STEP_KEY), '7')
    await env.click('welcome-tour-minimize')
    await act(async () => env.root.render(null))
    await act(async () => env.root.render(fixture('/profile')))
    assert.ok(env.select('welcome-tour-resume'))
    assert.equal(env.select('welcome-tour-dialog'), null)
    await env.click('welcome-tour-resume')
    assert.equal(env.select('welcome-tour-step').value, '7')
    const last = env.select('welcome-tour-step').options.length - 1
    await env.chooseStep(last)
    await env.click('welcome-tour-next')
    assert.equal(localStorage.getItem(ONBOARD_KEY), 'done')
    assert.equal(localStorage.getItem(ONBOARD_ACTIVE_KEY), null)
    assert.equal(env.select('welcome-tour-dialog'), null)
  } finally {
    await env.destroy()
  }
})

test('tour exploration respects the actual guest, account, and administrator route guards', async () => {
  const env = await createEnvironment([[ONBOARD_KEY, 'done']])
  try {
    await act(async () => env.root.render(React.createElement(TourFixture, { isGuest: true, isAdmin: false, initialPath: '/home' })))
    await env.click('tour-page-replay')
    for (const step of [4, 6]) {
      await env.chooseStep(step)
      await env.click('welcome-tour-open-feature')
      assert.equal(env.select('tour-page-path').textContent, '/signup')
      assert.ok(env.select('welcome-tour-dock'))
      await env.click('welcome-tour-review')
      assert.equal(env.select('welcome-tour-step').value, String(step))
    }
    await env.chooseStep(2)
    await env.click('welcome-tour-open-feature')
    assert.equal(env.select('tour-page-path').textContent, '/sandbox')
    await env.click('welcome-tour-minimize')
    await env.click('tour-page-admin')
    assert.equal(env.select('tour-page-path').textContent, '/login')
    await env.click('welcome-tour-resume')
    await env.click('welcome-tour-end')
    await act(async () => env.root.render(null))
    await act(async () => env.root.render(React.createElement(TourFixture, { isGuest: false, isAdmin: false, initialPath: '/admin' })))
    assert.equal(env.select('tour-page-path').textContent, '/home')
    await env.click('tour-page-replay')
    await env.click('welcome-tour-end')
    await act(async () => env.root.render(null))
    await act(async () => env.root.render(React.createElement(TourFixture, { isGuest: false, isAdmin: true, initialPath: '/home' })))
    await env.click('tour-page-replay')
    await env.chooseStep(9)
    await env.click('welcome-tour-open-feature')
    assert.equal(env.select('tour-page-path').textContent, '/admin')
    assert.ok(env.select('welcome-tour-dock'))
    await env.click('welcome-tour-end')
  } finally {
    await env.destroy()
  }
})

test('first-use tour opens under Strict Mode and unmounting restores page interaction and scrolling', async () => {
  const env = await createEnvironment([])
  try {
    await act(async () => env.root.render(React.createElement(React.StrictMode, null,
      React.createElement(TourFixture, { isGuest: false, isAdmin: false, initialPath: '/home' }))))
    await act(async () => new Promise(resolve => setTimeout(resolve, 850)))
    assert.ok(env.select('welcome-tour-dialog'))
    assert.equal(env.select('welcome-tour-step').value, '0')
    const background = env.select('tour-page-background')
    assert.equal(background.inert, true)
    await act(async () => env.root.render(null))
    assert.equal(background.inert, false)
    assert.equal(document.body.style.overflow, '')
    assert.equal(document.documentElement.style.overflow, '')
    assert.equal(env.select('welcome-tour-dialog'), null)
  } finally {
    await env.destroy()
  }
})

test('invalid saved tour progress shows an actionable error and restarts only on request', async () => {
  const env = await createEnvironment([[ONBOARD_ACTIVE_KEY, 'true'], [ONBOARD_STEP_KEY, 'invalid']])
  try {
    await act(async () => env.root.render(React.createElement(TourFixture, { isGuest: false, isAdmin: false, initialPath: '/home' })))
    assert.ok(env.select('welcome-tour-error'))
    assert.equal(env.select('welcome-tour-dialog'), null)
    assert.equal(localStorage.getItem(ONBOARD_STEP_KEY), 'invalid')
    await env.click('welcome-tour-retry')
    assert.equal(env.select('welcome-tour-step').value, '0')
    assert.equal(localStorage.getItem(ONBOARD_STEP_KEY), '0')
    await env.click('welcome-tour-end')
  } finally {
    await env.destroy()
  }
})

test('a delayed first-use start cannot overwrite an already replayed or ended tour', async () => {
  const env = await createEnvironment([])
  try {
    await act(async () => env.root.render(React.createElement(TourFixture, { isGuest: false, isAdmin: false, initialPath: '/home' })))
    await env.click('tour-page-replay')
    await env.chooseStep(2)
    await env.click('welcome-tour-open-feature')
    await act(async () => new Promise(resolve => setTimeout(resolve, 850)))
    assert.equal(localStorage.getItem(ONBOARD_STEP_KEY), '2')
    assert.equal(localStorage.getItem(ONBOARD_VIEW_KEY), 'exploring')
    assert.ok(env.select('welcome-tour-dock'))
    await env.click('welcome-tour-end')
    await act(async () => env.root.render(null))
    localStorage.clear()
    await act(async () => env.root.render(React.createElement(TourFixture, { isGuest: false, isAdmin: false, initialPath: '/home' })))
    await env.click('tour-page-replay')
    await env.click('welcome-tour-end')
    await act(async () => new Promise(resolve => setTimeout(resolve, 850)))
    assert.equal(env.select('welcome-tour-dialog'), null)
    assert.equal(localStorage.getItem(ONBOARD_ACTIVE_KEY), null)
    assert.equal(localStorage.getItem(ONBOARD_KEY), 'done')
  } finally {
    await env.destroy()
  }
})

test('full browser storage reports the failed save and prevents hidden feature navigation until retried', async () => {
  const env = await createEnvironment([[ONBOARD_ACTIVE_KEY, 'true'], [ONBOARD_STEP_KEY, '2'], [ONBOARD_VIEW_KEY, 'guide']])
  try {
    await act(async () => env.root.render(React.createElement(TourFixture, { isGuest: false, isAdmin: false, initialPath: '/home' })))
    let used = 0
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      used += key.length + localStorage.getItem(key).length
    }
    localStorage.setItem('quota-fill', 'x'.repeat(1024 - used - 'quota-fill'.length))
    await env.click('welcome-tour-open-feature')
    assert.ok(env.select('welcome-tour-error'))
    assert.equal(env.select('welcome-tour-dialog'), null)
    assert.equal(env.select('tour-page-path').textContent, '/home')
    assert.equal(env.select('tour-page-background').inert, false)
    assert.equal(localStorage.getItem(ONBOARD_STEP_KEY), '2')
    localStorage.removeItem('quota-fill')
    await env.click('welcome-tour-retry')
    assert.equal(env.select('welcome-tour-step').value, '2')
    await env.click('welcome-tour-open-feature')
    assert.equal(env.select('tour-page-path').textContent, '/sandbox')
    assert.ok(env.select('welcome-tour-dock'))
    await env.click('welcome-tour-end')
  } finally {
    await env.destroy()
  }
})
