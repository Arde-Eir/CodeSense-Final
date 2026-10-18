import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' })
after(() => server.close())
const { DragDropGame } = await server.ssrLoadModule('/src/games/DragDropGame.tsx')
const { OrderingGame } = await server.ssrLoadModule('/src/games/OrderingGame.tsx')

test('matching and ordering can be corrected and completed with taps instead of dragging', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
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
  const completions = []
  const onComplete = (score, total) => completions.push([score, total])

  try {
    await act(async () => root.render(React.createElement(DragDropGame, {
      items: [{ id: 'array', label: 'Array', color: '#58a6ff' }, { id: 'index', label: 'Index', color: '#a371f7' }],
      zones: [{ id: 'collection', label: 'A collection of values', accepted: 'array' }, { id: 'position', label: 'A position in a collection', accepted: 'index' }],
      onComplete, resetSignal: 0,
    })))
    assert.equal(select('drag-check').disabled, true)
    await click('drag-item-array')
    assert.equal(select('drag-item-array').getAttribute('aria-pressed'), 'true')
    await click('drop-zone-position')
    assert.equal(select('drag-item-array').disabled, true)
    await click('drag-item-index')
    await click('drop-zone-position')
    assert.equal(select('drag-item-array').disabled, false, 'Replacing a match must release the displaced term')
    await click('drag-item-array')
    await click('drop-zone-collection')
    assert.equal(select('drag-check').disabled, false)
    await click('drag-check')
    await act(async () => new Promise(resolve => setTimeout(resolve, 750)))
    assert.deepEqual(completions, [[2, 2]])
    assert.equal(select('drop-zone-collection').disabled, true)

    const items = [
      { id: 'declare', label: 'Declare the array', correct_order: 1 },
      { id: 'initialize', label: 'Initialize the elements', correct_order: 2 },
      { id: 'access', label: 'Access an element', correct_order: 3 },
    ]
    await act(async () => root.render(React.createElement(OrderingGame, { items, onComplete, resetSignal: 0 })))
    const order = () => [...dom.window.document.querySelectorAll('[data-testid^="ordering-row-"]')].map(row => row.dataset.testid.replace('ordering-row-', ''))
    assert.equal(select(`ordering-up-${order()[0]}`).disabled, true)
    assert.equal(select(`ordering-down-${order().at(-1)}`).disabled, true)
    const first = order()[0]
    await click(`ordering-down-${first}`)
    assert.equal(order()[1], first)
    for (const [position, item] of items.entries()) {
      while (order().indexOf(item.id) > position) await click(`ordering-up-${item.id}`)
    }
    assert.deepEqual(order(), items.map(item => item.id))
    await click('ordering-check')
    await act(async () => new Promise(resolve => setTimeout(resolve, 750)))
    assert.deepEqual(completions, [[2, 2], [1, 1]])
    assert.ok(items.every(item => select(`ordering-up-${item.id}`).disabled && select(`ordering-down-${item.id}`).disabled))
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
