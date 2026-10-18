import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import React, { act, useCallback, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' })
after(() => server.close())
const { CampaignHeader } = await server.ssrLoadModule('/src/pages/app/CampaignHeader.tsx')
const { GameSidePanel } = await server.ssrLoadModule('/src/pages/app/GameSidePanel.tsx')
const { MobileQuestHints } = await server.ssrLoadModule('/src/pages/app/MobileQuestHints.tsx')
const { DragDropGame } = await server.ssrLoadModule('/src/games/DragDropGame.tsx')

function createEnvironment() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, writable: true, value: 390 })
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
  const key = async (value, shiftKey) => {
    await act(async () => dom.window.document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true })))
  }
  const destroy = async () => {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }
  return { dom, root, select, click, key, destroy }
}

const items = [{ id: 'array', label: 'Array', color: '#58a6ff' }, { id: 'index', label: 'Index', color: '#a371f7' }]
const zones = [{ id: 'collection', label: 'A collection of values', accepted: 'array' }, { id: 'position', label: 'A position in a collection', accepted: 'index' }]
const hints = [{ title: 'First hint', body: 'An array stores related values.' }, { title: 'Second hint', body: 'An index selects a position.' }]
const quest = { id: 'arrays', title: 'Arrays', objectives: Array.from({ length: 20 }, (_, index) => `Objective ${index + 1}: explain and apply this array concept in a longer C++ example.`) }

function QuestFixture() {
  const backgroundRef = useRef(null)
  const triggerRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [hintsUsed, setHintsUsed] = useState(0)
  const close = useCallback(() => setOpen(false), [])
  return React.createElement('div', { ref: backgroundRef, 'data-testid': 'quest-background' },
    React.createElement('button', { ref: triggerRef, type: 'button', 'data-testid': 'hints-trigger', 'aria-expanded': open, onClick: () => setOpen(true) }, 'Hints'),
    React.createElement(DragDropGame, { items, zones, onComplete: () => {}, resetSignal: 0 }),
    open && React.createElement(MobileQuestHints, { backgroundRef, triggerRef, onClose: close },
      React.createElement(GameSidePanel, {
        quest, tabHints: hints, hintsUsed, totalHintsUsed: hintsUsed, maxHints: hints.length,
        earnedXP: 900 - hintsUsed * 25, rewardBaseXP: 900, rewardPenaltyXP: hintsUsed * 25,
        rewardPenaltyCapped: false, isCompleted: false, onTakeHint: () => setHintsUsed(count => count + 1),
        activeTab: 'drag', hasNextQuest: false, onNextQuest: () => {},
      })))
}

test('campaign Exit is a real Home link and navigates with the campaign header', async () => {
  const env = createEnvironment()
  try {
    await act(async () => env.root.render(React.createElement(MemoryRouter, { initialEntries: ['/campaign'] },
      React.createElement(Routes, null,
        React.createElement(Route, { path: '/campaign', element: React.createElement(CampaignHeader, { userXP: 20700 }) }),
        React.createElement(Route, { path: '/home', element: React.createElement('main', { 'data-testid': 'home-destination' }) })))))
    assert.equal(env.select('campaign-exit-home').tagName, 'A')
    assert.equal(env.select('campaign-exit-home').getAttribute('href'), '/home')
    await env.click('campaign-exit-home')
    assert.ok(env.select('home-destination'))
  } finally {
    await env.destroy()
  }
})

test('quest help opens outside the game, traps focus, reveals hints, and dismisses without resetting answers', async () => {
  const env = createEnvironment()
  try {
    await act(async () => env.root.render(React.createElement(QuestFixture)))
    await env.click('drag-item-array')
    const selected = env.select('drag-item-array')
    await env.click('hints-trigger')
    const background = env.select('quest-background')
    const sheet = env.select('mobile-hints-dialog')
    assert.equal(background.contains(sheet), false, 'The mobile sheet must escape the scrolling game container')
    assert.equal(background.inert, true)
    assert.equal(env.dom.window.document.documentElement.style.overflow, 'hidden')
    assert.equal(env.dom.window.document.activeElement, env.select('mobile-hints-close'))
    await env.key('Tab', true)
    assert.equal(env.dom.window.document.activeElement, env.select('take-hint'))
    await env.key('Tab', false)
    assert.equal(env.dom.window.document.activeElement, env.select('mobile-hints-close'))
    await env.click('take-hint')
    assert.equal(env.select('hint-toggle-0').getAttribute('aria-expanded'), 'true')
    assert.ok(env.select('hint-body-0'))
    await env.click('hint-toggle-0')
    assert.equal(env.select('hint-body-0'), null)
    await env.click('hint-toggle-0')
    assert.ok(env.select('hint-body-0'))
    await env.click('take-hint')
    assert.ok(env.select('hint-body-1'))
    assert.equal(env.select('take-hint').disabled, true)
    await env.click('mobile-hints-close')
    assert.equal(env.select('mobile-hints-dialog'), null)
    assert.equal(background.inert, false)
    assert.equal(env.dom.window.document.body.style.overflow, '')
    assert.equal(env.dom.window.document.documentElement.style.overflow, '')
    assert.equal(env.dom.window.document.activeElement, env.select('hints-trigger'))
    assert.equal(env.select('drag-item-array'), selected)
    assert.equal(selected.getAttribute('aria-pressed'), 'true')
    await env.click('drop-zone-collection')
    assert.equal(selected.disabled, true)

    await env.click('hints-trigger')
    assert.equal(env.select('take-hint').disabled, true, 'Reopening help must preserve the hint limit')
    await env.click('mobile-hints-backdrop')
    assert.equal(env.select('mobile-hints-dialog'), null)
    await env.click('hints-trigger')
    await env.key('Escape', false)
    assert.equal(env.select('mobile-hints-dialog'), null)
    assert.equal(env.dom.window.document.activeElement, env.select('hints-trigger'))
  } finally {
    await env.destroy()
  }
})

test('resizing to desktop and leaving an open mobile sheet both release focus and scrolling restrictions', async () => {
  const env = createEnvironment()
  try {
    env.dom.window.document.body.style.overflow = 'auto'
    env.dom.window.document.documentElement.style.overflow = 'scroll'
    await act(async () => env.root.render(React.createElement(QuestFixture)))
    await env.click('hints-trigger')
    await act(async () => {
      env.dom.window.innerWidth = 1200
      env.dom.window.dispatchEvent(new env.dom.window.Event('resize'))
    })
    assert.equal(env.select('mobile-hints-dialog'), null)
    assert.equal(env.select('quest-background').inert, false)
    assert.equal(env.dom.window.document.body.style.overflow, 'auto')
    assert.equal(env.dom.window.document.documentElement.style.overflow, 'scroll')
    env.dom.window.innerWidth = 390
    await env.click('hints-trigger')
    await act(async () => env.root.render(null))
    assert.equal(env.select('mobile-hints-overlay'), null)
    assert.equal(env.dom.window.document.body.style.overflow, 'auto')
    assert.equal(env.dom.window.document.documentElement.style.overflow, 'scroll')
  } finally {
    await env.destroy()
  }
})
