import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import React, { act, useState } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' })
after(() => server.close())
const { MagneticButton } = await server.ssrLoadModule('/src/components/MagneticButton.tsx')
const { LandingPage } = await server.ssrLoadModule('/src/pages/public/Landingpage.tsx')
const { WelcomePage } = await server.ssrLoadModule('/src/pages/public/WelcomePage.tsx')
const { AuthContext } = await server.ssrLoadModule('/src/components/AuthContext.ts')
const magneticCss = await readFile(new URL('../src/components/MagneticButton.css', import.meta.url), 'utf8')

async function createEnvironment() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const style = dom.window.document.createElement('style')
  style.textContent = magneticCss
  dom.window.document.head.append(style)
  const globals = {
    window: dom.window, document: dom.window.document, Node: dom.window.Node,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  }
  const previousGlobals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.getElementById('root'))
  const select = id => document.querySelector(`[data-testid="${id}"]`)
  const click = async id => {
    const element = select(id)
    assert.ok(element, `Expected ${id} to be available`)
    await act(async () => element.click())
  }
  const destroy = async () => {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
  return { dom, root, select, click, destroy }
}

function ActionsFixture() {
  const [runs, setRuns] = useState(0)
  const [busy, setBusy] = useState(false)
  const [submissions, setSubmissions] = useState(0)
  const [moves, setMoves] = useState(0)
  return React.createElement('form', { onSubmit: event => { event.preventDefault(); setSubmissions(value => value + 1) } },
    React.createElement('output', { 'data-testid': 'analysis-count' }, runs),
    React.createElement('output', { 'data-testid': 'form-submit-count' }, submissions),
    React.createElement('output', { 'data-testid': 'pointer-move-count' }, moves),
    React.createElement(MagneticButton, {
      'data-testid': 'analysis-action', 'aria-label': 'Analyze code', 'aria-busy': busy, disabled: busy,
      faceClassName: 'analyze-btn', onPointerMove: () => setMoves(value => value + 1),
      onClick: () => { setRuns(value => value + 1); setBusy(true) },
    }, busy ? 'Analyzing' : 'Analyze code'),
    React.createElement('button', { type: 'button', 'data-testid': 'analysis-complete', onClick: () => setBusy(false) }, 'Complete'),
    React.createElement(MagneticButton, { type: 'submit', 'data-testid': 'submit-action' }, 'Submit'))
}

test('magnetic actions preserve native touch activation, focus, disabled states, event callbacks, and explicit form submission', async () => {
  const env = await createEnvironment()
  try {
    await act(async () => env.root.render(React.createElement(ActionsFixture)))
    const button = env.select('analysis-action')
    assert.equal(button.tagName, 'BUTTON')
    assert.equal(button.type, 'button')
    assert.equal(button.getAttribute('aria-label'), 'Analyze code')
    for (const pointerType of ['touch', 'pen', 'mouse']) {
      await act(async () => {
        button.dispatchEvent(new env.dom.window.PointerEvent('pointermove', { pointerType, clientX: 50, clientY: 30, bubbles: true }))
      })
    }
    assert.equal(env.select('pointer-move-count').textContent, '3')
    assert.equal(env.select('analysis-count').textContent, '0', 'Pointer motion must never activate an action')
    await act(async () => button.focus())
    assert.equal(document.activeElement, button)
    await act(async () => {
      button.dispatchEvent(new env.dom.window.PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }))
      button.dispatchEvent(new env.dom.window.PointerEvent('pointerup', { pointerType: 'touch', bubbles: true }))
      button.click()
    })
    assert.equal(env.select('analysis-count').textContent, '1')
    assert.equal(button.disabled, true)
    assert.equal(button.getAttribute('aria-busy'), 'true')
    await env.click('analysis-action')
    assert.equal(env.select('analysis-count').textContent, '1')
    assert.equal(env.select('form-submit-count').textContent, '0')
    await env.click('analysis-complete')
    await env.click('analysis-action')
    assert.equal(env.select('analysis-count').textContent, '2')
    await env.click('submit-action')
    assert.equal(env.select('form-submit-count').textContent, '1')
  } finally {
    await env.destroy()
  }
})

test('the selected public-page buttons retain account, sign-in, and welcome navigation', async () => {
  const env = await createEnvironment()
  const auth = { isAuthenticated: false, isGuest: true, user: null }
  const renderPage = async path => {
    await act(async () => env.root.render(React.createElement(MemoryRouter, { key: path, initialEntries: [path] },
      React.createElement(AuthContext.Provider, { value: auth },
        React.createElement(Routes, null,
          React.createElement(Route, { path: '/', element: React.createElement(LandingPage) }),
          React.createElement(Route, { path: '/welcome', element: React.createElement(WelcomePage) }),
          ...['/signup', '/login', '/home'].map(destination => React.createElement(Route, { key: destination, path: destination,
            element: React.createElement('main', { 'data-testid': `destination-${destination.slice(1)}` }) })))))))
  }
  try {
    await renderPage('/')
    await env.click('landing-create-account')
    assert.ok(env.select('destination-signup'))
    await act(async () => env.root.render(null))
    await renderPage('/')
    await env.click('landing-sign-in')
    assert.ok(env.select('destination-login'))
    await renderPage('/welcome')
    await env.click('welcome-start')
    await act(async () => new Promise(resolve => setTimeout(resolve, 550)))
    assert.ok(env.select('destination-home'))
  } finally {
    await env.destroy()
  }
})
