import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from './supabase'
import {
  canonicalNotificationId,
  readLocalNotificationPreferences,
  removeImportedNotificationPreferences,
  type NotificationReceipt,
} from '@/components/dashboard/notificationState'

interface ReceiptResult { data: unknown; error: PostgrestError | null; status: number }
type ReceiptOperation = 'observe_notifications' | 'mark_notifications_read' | 'dismiss_notifications'

function requireTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`Notification receipt returned an invalid ${field}.`)
  }
  return value
}

export function parseNotificationReceipts(value: unknown): NotificationReceipt[] {
  if (!Array.isArray(value)) throw new TypeError('Notification receipts must be an array.')
  return value.map((row: unknown): NotificationReceipt => {
    if (typeof row !== 'object' || row === null || !('notification_id' in row) || typeof row.notification_id !== 'string'
      || !('observed_at' in row) || !('read_at' in row) || !('dismissed_at' in row)) {
      throw new TypeError('Notification receipt is missing its ID or timestamps.')
    }
    const id = canonicalNotificationId(row.notification_id)
    if (id !== row.notification_id) throw new TypeError(`Notification receipt returned a noncanonical ID: ${row.notification_id}`)
    if (row.read_at !== null) requireTimestamp(row.read_at, 'read_at')
    if (row.dismissed_at !== null) requireTimestamp(row.dismissed_at, 'dismissed_at')
    return { id, observedAt: requireTimestamp(row.observed_at, 'observed_at'), read: row.read_at !== null, dismissed: row.dismissed_at !== null }
  })
}

async function requestReceipts(operation: ReceiptOperation, userId: string, ids: readonly string[]): Promise<NotificationReceipt[]> {
  const canonicalIds = Array.from(new Set(ids.map(canonicalNotificationId)))
  const receipts: NotificationReceipt[] = []
  for (let offset = 0; offset < canonicalIds.length; offset += 500) {
    const parameters = { p_owner_id: userId, p_notification_ids: canonicalIds.slice(offset, offset + 500) }
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const result: ReceiptResult = await supabase.rpc(operation, parameters)
        if (result.error) {
          throw new Error(`Notification ${operation} failed (HTTP ${result.status}, code=${result.error.code}, params=${JSON.stringify(parameters)}): ${JSON.stringify(result.error)}. Apply the notification receipts migration in Supabase SQL Editor if the RPC is missing.`)
        }
        const rows = parseNotificationReceipts(result.data)
        const returned = new Set(rows.map(row => row.id))
        if (returned.size !== parameters.p_notification_ids.length || parameters.p_notification_ids.some(id => !returned.has(id))) {
          throw new Error(`Notification ${operation} returned incomplete receipts for ${JSON.stringify(parameters)}.`)
        }
        receipts.push(...rows)
        break
      } catch (error) {
        console.warn('Notification receipt request failed', { operation, parameters, attempt, error })
        if (attempt === 2) throw error
      }
    }
  }
  return receipts
}

export function markAccountNotificationsRead(userId: string, ids: readonly string[]): Promise<NotificationReceipt[]> {
  return requestReceipts('mark_notifications_read', userId, ids)
}

export function dismissAccountNotifications(userId: string, ids: readonly string[]): Promise<NotificationReceipt[]> {
  return requestReceipts('dismiss_notifications', userId, ids)
}

/** Upload this browser's existing choices before loading account receipts on any device. */
export async function loadAccountNotificationReceipts(userId: string, ids: readonly string[]): Promise<NotificationReceipt[]> {
  const local = readLocalNotificationPreferences(localStorage, userId)
  if (local.seen.length > 0 || local.dismissed.length > 0) {
    await markAccountNotificationsRead(userId, local.seen)
    await dismissAccountNotifications(userId, local.dismissed)
    removeImportedNotificationPreferences(localStorage, userId, local)
  }
  return requestReceipts('observe_notifications', userId, ids)
}
