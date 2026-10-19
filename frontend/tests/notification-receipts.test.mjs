import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' })
after(() => server.close())
const {
  canonicalNotificationId, readLocalNotificationPreferences, markLocalNotificationsRead,
  dismissLocalNotifications, removeImportedNotificationPreferences,
  mergeNotificationPreferences, preferencesFromReceipts,
} = await server.ssrLoadModule('/src/components/dashboard/notificationState.ts')
const { parseNotificationReceipts } = await server.ssrLoadModule('/src/services/notificationReceipts.ts')
const migration = await readFile(new URL('../../supabase/migrations/202610190001_notification_receipts.sql', import.meta.url), 'utf8')
const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create publication supabase_realtime;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to authenticated, anon;
    insert into auth.users values ('${owner}'), ('${other}');
  `)
  await db.exec(migration)
  return db
}

async function signIn(db, id) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
  await db.exec('set role authenticated')
}

const receiptRows = result => parseNotificationReceipts(result.rows[0].receipts ?? [])

test('account receipts survive fresh-browser reloads, repeated observations, and later read updates without reviving dismissed items', async () => {
  const db = await createDatabase()
  const firstBrowser = new JSDOM('', { url: 'https://first.example' })
  const secondBrowser = new JSDOM('', { url: 'https://second.example' })
  try {
    await signIn(db, owner)
    const ids = ['rank:lord', 'announcement:welcome', 'quest:arrays']
    const initial = receiptRows(await db.query('select json_agg(receipt) as receipts from public.observe_notifications($1, $2::text[]) receipt', [owner, ids]))
    assert.equal(initial.length, 3)
    assert.ok(initial.every(receipt => !receipt.read && !receipt.dismissed))
    await db.query('select * from public.mark_notifications_read($1, $2::text[])', [owner, ids])
    await db.query('select * from public.dismiss_notifications($1, $2::text[])', [owner, ['rank:lord', 'quest:arrays']])
    await db.query('select * from public.mark_notifications_read($1, $2::text[])', [owner, ids])
    const fresh = receiptRows(await db.query('select json_agg(receipt) as receipts from public.observe_notifications($1, $2::text[]) receipt', [owner, ids]))
    assert.equal(firstBrowser.window.localStorage.length, 0)
    assert.equal(secondBrowser.window.localStorage.length, 0)
    assert.ok(fresh.every(receipt => receipt.read))
    assert.deepEqual(new Set(preferencesFromReceipts(fresh).dismissed), new Set(['rank:lord', 'quest:arrays']))
    assert.equal(fresh.find(receipt => receipt.id === 'rank:lord').observedAt, initial.find(receipt => receipt.id === 'rank:lord').observedAt)
    const stale = mergeNotificationPreferences(preferencesFromReceipts(fresh), preferencesFromReceipts(initial))
    assert.deepEqual(new Set(stale.dismissed), new Set(['rank:lord', 'quest:arrays']))
  } finally {
    firstBrowser.window.close()
    secondBrowser.window.close()
    await db.close()
  }
})

test('legacy completion timestamps and more than 500 read or cleared choices migrate without dropping recent receipts', async () => {
  const db = await createDatabase()
  const browser = new JSDOM('', { url: 'https://first.example' })
  const storage = browser.window.localStorage
  try {
    const oldQuestId = 'quest:arrays:2026-10-18T12:00:00.000Z'
    storage.setItem(`cs-seen-notifs-v2:${owner}`, JSON.stringify(['rank:lord', oldQuestId]))
    storage.setItem(`cs-dismissed-notifs-v1:${owner}`, JSON.stringify([oldQuestId]))
    for (let batch = 0; batch < 3; batch++) {
      const ids = Array.from({ length: 200 }, (_, index) => `announcement:item-${batch * 200 + index}`)
      markLocalNotificationsRead(storage, owner, ids)
      dismissLocalNotifications(storage, owner, ids)
    }
    const local = readLocalNotificationPreferences(storage, owner)
    assert.equal(local.seen.length, 602)
    assert.equal(local.dismissed.length, 601)
    assert.ok(local.seen.includes('announcement:item-599'))
    assert.ok(local.dismissed.includes('announcement:item-599'))
    assert.ok(local.dismissed.includes('quest:arrays'))
    assert.equal(canonicalNotificationId('quest:arrays:2026-10-19T18:00:00Z'), 'quest:arrays')
    await signIn(db, owner)
    await db.query('select * from public.mark_notifications_read($1, $2::text[])', [owner, local.seen])
    await db.query('select * from public.dismiss_notifications($1, $2::text[])', [owner, local.dismissed])
    removeImportedNotificationPreferences(storage, owner, local)
    assert.deepEqual(readLocalNotificationPreferences(storage, owner), { seen: [], dismissed: [] })
    const synced = receiptRows(await db.query('select json_agg(receipt) as receipts from public.observe_notifications($1, $2::text[]) receipt', [owner, ['quest:arrays', 'announcement:item-599']]))
    assert.ok(synced.every(receipt => receipt.read && receipt.dismissed))
    const count = await db.query('select count(*)::integer as count from public.notification_receipts')
    assert.equal(count.rows[0].count, 602)
  } finally {
    browser.window.close()
    await db.close()
  }
})

test('receipt permissions isolate accounts, reject mismatched or unauthenticated callers, and disallow direct rewrites', async () => {
  const db = await createDatabase()
  try {
    await signIn(db, owner)
    await db.query('select * from public.dismiss_notifications($1, $2::text[])', [owner, ['rank:lord']])
    await signIn(db, other)
    assert.equal((await db.query('select * from public.notification_receipts')).rows.length, 0)
    await assert.rejects(db.query('select * from public.dismiss_notifications($1, $2::text[])', [owner, ['rank:lord']]), /Sign in/)
    await assert.rejects(db.query("update public.notification_receipts set dismissed_at = null"), /permission denied/)
    const own = receiptRows(await db.query('select json_agg(receipt) as receipts from public.observe_notifications($1, $2::text[]) receipt', [other, ['rank:lord']]))
    assert.equal(own[0].read, false)
    assert.equal(own[0].dismissed, false)
    await assert.rejects(db.query('select * from public.mark_notifications_read($1, $2::text[])', [other, ['quest:arrays:changed-timestamp']]), /canonical identifier/)
    await assert.rejects(db.query('select * from public.observe_notifications($1, $2::text[])', [other, Array.from({ length: 1001 }, (_, index) => `quest:q-${index}`)]), /at most 1000/)
    await signIn(db, owner)
    assert.ok(receiptRows(await db.query('select json_agg(receipt) as receipts from public.observe_notifications($1, $2::text[]) receipt', [owner, ['rank:lord']]))[0].dismissed)
    await db.exec('reset role; set role anon')
    await assert.rejects(db.query('select * from public.observe_notifications($1, $2::text[])', [owner, ['rank:lord']]), /permission denied/)
  } finally {
    await db.close()
  }
})

test('local receipt updates merge the latest saved choices and surface invalid data and quota errors', () => {
  const browser = new JSDOM('', { url: 'https://first.example', storageQuota: 1000 })
  const storage = browser.window.localStorage
  try {
    markLocalNotificationsRead(storage, 'guest', ['announcement:first'])
    dismissLocalNotifications(storage, 'guest', ['announcement:first'])
    markLocalNotificationsRead(storage, 'guest', ['announcement:second'])
    dismissLocalNotifications(storage, 'guest', ['announcement:second'])
    const current = readLocalNotificationPreferences(storage, 'guest')
    assert.deepEqual(current.seen, ['announcement:first', 'announcement:second'])
    assert.deepEqual(current.dismissed, ['announcement:first', 'announcement:second'])
    assert.deepEqual(readLocalNotificationPreferences(storage, 'other'), { seen: [], dismissed: [] })
    markLocalNotificationsRead(storage, 'guest', ['announcement:arrived-during-import'])
    dismissLocalNotifications(storage, 'guest', ['announcement:arrived-during-import'])
    removeImportedNotificationPreferences(storage, 'guest', current)
    const remaining = readLocalNotificationPreferences(storage, 'guest')
    assert.deepEqual(remaining.seen, ['announcement:arrived-during-import'])
    assert.deepEqual(remaining.dismissed, ['announcement:arrived-during-import'])
    assert.throws(() => dismissLocalNotifications(storage, 'guest', Array.from({ length: 200 }, (_, index) => `announcement:extra-${index}`)), /quota/i)
    assert.deepEqual(readLocalNotificationPreferences(storage, 'guest'), remaining)
    storage.setItem('cs-seen-notifs-v2:guest', '{invalid')
    assert.throws(() => readLocalNotificationPreferences(storage, 'guest'), /invalid JSON/)
  } finally { browser.window.close() }
})
