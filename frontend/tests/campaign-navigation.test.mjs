import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' })
after(() => server.close())
const { LessonNavigation } = await server.ssrLoadModule('/src/pages/app/LessonNavigation.tsx')

const Location = () => React.createElement('output', { 'data-testid': 'current-route' }, useLocation().pathname)

test('campaign navigation chooses explicit routes, dismisses without navigating, and waits for progress saves', async () => {
  const dom = new JSDOM('<div id="root"></div><button data-testid="outside">Outside</button>', { url: 'http://localhost' })
  const globals = { window: dom.window, document: dom.window.document, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true }
  const previousGlobals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const root = createRoot(dom.window.document.getElementById('root'))
  const select = id => dom.window.document.querySelector(`[data-testid="${id}"]`)
  const click = async id => {
    const element = select(id)
    assert.ok(element, `Expected ${id} to be available`)
    await act(async () => element.click())
  }
  const previousQuest = { id: 'previous', title: 'Earlier quest' }
  const render = async (key, previous, saving) => {
    await act(async () => root.render(React.createElement(MemoryRouter, { key, initialEntries: ['/home', '/lesson/current'], initialIndex: 1 },
      React.createElement(LessonNavigation, { phase: 'intermediate', previousQuest: previous, savingProgress: saving }),
      React.createElement(Location))))
  }

  try {
    for (const [id, expected] of [
      ['navigate-level-dashboard', '/campaign/inside/intermediate'],
      ['navigate-campaign-overview', '/campaign'],
      ['navigate-home', '/home'],
      ['navigate-previous-quest', '/lesson/previous'],
    ]) {
      await render(id, previousQuest, false)
      await click('campaign-navigation-toggle')
      assert.equal(dom.window.document.activeElement, select('navigate-level-dashboard'))
      await click(id)
      assert.equal(select('current-route').textContent, expected)
      assert.equal(select('campaign-navigation-panel'), null)
    }

    await render('touch-focus', previousQuest, false)
    await click('campaign-navigation-toggle')
    await act(async () => dom.window.document.activeElement.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true, relatedTarget: null })))
    assert.ok(select('campaign-navigation-panel'), 'Touch focus loss must not remove a destination before its click completes')
    await click('navigate-home')
    assert.equal(select('current-route').textContent, '/home')

    await render('dismiss', previousQuest, false)
    await click('campaign-navigation-toggle')
    await act(async () => dom.window.document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert.equal(select('campaign-navigation-panel'), null)
    assert.equal(dom.window.document.activeElement, select('campaign-navigation-toggle'))
    assert.equal(select('current-route').textContent, '/lesson/current')
    await click('campaign-navigation-toggle')
    await act(async () => select('outside').dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true })))
    assert.equal(select('campaign-navigation-panel'), null)

    await render('first', null, false)
    await click('campaign-navigation-toggle')
    assert.equal(select('navigate-previous-quest'), null)
    assert.equal(select('previous-quest-unavailable').getAttribute('aria-disabled'), 'true')

    await render('saving', previousQuest, true)
    await click('campaign-navigation-toggle')
    assert.equal(select('campaign-navigation-toggle').disabled, true)
    assert.equal(select('campaign-navigation-panel'), null)
    assert.equal(select('current-route').textContent, '/lesson/current')
    await render('saving', previousQuest, false)
    await click('campaign-navigation-toggle')
    assert.ok(select('campaign-navigation-panel'))
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
