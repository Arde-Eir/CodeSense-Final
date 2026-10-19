import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import React, { act, useState } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' })
after(() => server.close())
const { AdminNavigation } = await server.ssrLoadModule('/src/pages/admin/AdminNavigation.tsx')
const { AdminUsersTab, AdminAuditTab } = await server.ssrLoadModule('/src/pages/admin/AdminCoreTabs.tsx')

const items = [
  { id: 'dashboard', label: 'Dashboard', icon: 'ti ti-dashboard' },
  { id: 'users', label: 'Users', icon: 'ti ti-users' },
  { id: 'audit', label: 'Audit Logs', icon: 'ti ti-clipboard-list' },
  { id: 'maintenance', label: 'Maintenance', icon: 'ti ti-settings' },
  { id: 'announcements', label: 'Announcements', icon: 'ti ti-speakerphone' },
  { id: 'quests', label: 'Quest Builder', icon: 'ti ti-sword' },
]

async function createEnvironment() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/admin' })
  const globals = { window: dom.window, document: dom.window.document, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true }
  const previousGlobals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(dom.window.document.getElementById('root'))
  const select = id => dom.window.document.querySelector(`[data-testid="${id}"]`)
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

function NavigationFixture() {
  const [tab, setTab] = useState('dashboard')
  return React.createElement('div', { className: 'admin-shell' },
    React.createElement(AdminNavigation, { items, selectedTab: tab, onSelectTab: setTab }),
    React.createElement('output', { 'data-testid': 'selected-section' }, tab),
    React.createElement('button', { type: 'button', 'data-testid': 'outside-navigation' }, 'Content'))
}

test('admin navigation opens, selects every section, dismisses, and returns to the app', async () => {
  const env = await createEnvironment()
  try {
    await act(async () => env.root.render(React.createElement(MemoryRouter, { initialEntries: ['/admin'] },
      React.createElement(Routes, null,
        React.createElement(Route, { path: '/admin', element: React.createElement(NavigationFixture) }),
        React.createElement(Route, { path: '/home', element: React.createElement('main', { 'data-testid': 'home-destination' }) })))))
    for (const item of items) {
      assert.equal(env.select('admin-menu-toggle').getAttribute('aria-expanded'), 'false')
      await env.click('admin-menu-toggle')
      assert.equal(env.select('admin-navigation').getAttribute('data-open'), 'true')
      await env.click(`admin-nav-${item.id}`)
      assert.equal(env.select('selected-section').textContent, item.id)
      assert.equal(env.select(`admin-nav-${item.id}`).getAttribute('aria-current'), 'page')
      assert.equal(env.select('admin-navigation').getAttribute('data-open'), 'false')
    }
    await env.click('admin-menu-toggle')
    await act(async () => env.select('admin-nav-users').dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert.equal(env.select('admin-menu-toggle').getAttribute('aria-expanded'), 'false')
    assert.equal(env.dom.window.document.activeElement, env.select('admin-menu-toggle'))
    await env.click('admin-menu-toggle')
    await act(async () => env.select('outside-navigation').dispatchEvent(new env.dom.window.MouseEvent('pointerdown', { bubbles: true })))
    assert.equal(env.select('admin-navigation').getAttribute('data-open'), 'false')
    assert.equal(env.select('selected-section').textContent, 'quests')
    await env.click('admin-menu-toggle')
    assert.equal(env.select('admin-return-home').getAttribute('href'), '/home')
    await env.click('admin-return-home')
    assert.ok(env.select('home-destination'))
  } finally {
    await env.destroy()
  }
})

const exampleUser = {
  id: 'learner', playername: 'Test learner with a longer display name',
  email: 'a-long-email-address-for-a-narrow-screen@example.com',
  totalxp: 20700, currentlevel: 5, charactertype: 'lord', user_type: 'student',
  is_admin: false, is_banned: false, ban_reason: null,
  createdat: '2026-10-19T02:00:00Z', lastactive: '2026-10-19T02:10:00Z', sandbox_runs: 10,
}

function UsersFixture() {
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const unexpectedAccountAction = async () => { throw new Error('Filtering or pagination must not change an account') }
  return React.createElement('div', { className: 'admin-shell' },
    React.createElement('output', { 'data-testid': 'user-filter-state' }, filter),
    React.createElement('output', { 'data-testid': 'user-page-state' }, page),
    React.createElement(AdminUsersTab, {
      userSearch: '', setUserSearch: () => {}, userFilter: filter, setUserFilter: setFilter,
      filteredUsers: [exampleUser], userImages: new Map(), loading: false, page, resultCount: 61, setPage,
      saving: false, currentUserId: 'admin', userCount: 61, banUser: unexpectedAccountAction,
      unbanUser: unexpectedAccountAction, toggleAdmin: unexpectedAccountAction, requestLiveHelp: unexpectedAccountAction,
    }))
}

test('user filters and pagination remain usable with the responsive table and toolbar', async () => {
  const env = await createEnvironment()
  try {
    await act(async () => env.root.render(React.createElement(UsersFixture)))
    const record = env.select('admin-user-record-learner')
    assert.ok(record.textContent.includes(exampleUser.email))
    await env.click('admin-ban-learner')
    assert.ok(env.select('admin-user-action-dialog'))
    await env.click('admin-user-action-cancel')
    assert.equal(env.select('admin-user-action-dialog'), null)
    assert.equal(env.select('admin-user-record-learner'), record)
    assert.equal(exampleUser.is_banned, false)
    env.select('admin-users-table-scroll').focus()
    assert.equal(env.dom.window.document.activeElement, env.select('admin-users-table-scroll'))
    for (const value of ['banned', 'active', 'admin', 'all']) {
      await act(async () => {
        env.select('admin-user-filter').value = value
        env.select('admin-user-filter').dispatchEvent(new env.dom.window.Event('change', { bubbles: true }))
      })
      assert.equal(env.select('user-filter-state').textContent, value)
    }
    assert.equal(env.select('admin-users-previous').disabled, true)
    await env.click('admin-users-next')
    assert.equal(env.select('user-page-state').textContent, '1')
    await env.click('admin-users-next')
    assert.equal(env.select('user-page-state').textContent, '2')
    assert.equal(env.select('admin-users-next').disabled, true)
    await env.click('admin-users-previous')
    assert.equal(env.select('user-page-state').textContent, '1')
  } finally {
    await env.destroy()
  }
})

test('audit record details expand and collapse while retaining long entry data', async () => {
  const env = await createEnvironment()
  const entry = {
    id: 'audit-example', admin_id: 'admin', target_user_id: 'learner', action: 'quest_update',
    details: { title: 'A long lesson title that must remain readable on a narrow screen', description: 'array_definition_'.repeat(40) },
    created_at: '2026-10-19T02:00:00Z', admin: { playername: 'Administrator' }, target: { playername: exampleUser.playername },
  }
  try {
    await act(async () => env.root.render(React.createElement('div', { className: 'admin-shell' },
      React.createElement(AdminAuditTab, { auditLogs: [entry], auditLoading: false, auditError: null, fetchAuditLogs: async () => {} }))))
    const record = env.select('admin-audit-record-audit-example')
    const details = env.select('admin-audit-details-audit-example')
    assert.equal(details.open, false)
    await env.click('admin-audit-summary-audit-example')
    assert.equal(details.open, true)
    assert.ok(record.textContent.includes(entry.details.description))
    assert.ok(record.textContent.includes(exampleUser.playername))
    await env.click('admin-audit-summary-audit-example')
    assert.equal(details.open, false)
    assert.equal(env.select('admin-audit-record-audit-example'), record)
  } finally {
    await env.destroy()
  }
})
