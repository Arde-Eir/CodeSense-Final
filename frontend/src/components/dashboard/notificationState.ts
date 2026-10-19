export interface NotificationPreferences {
  seen: string[]
  dismissed: string[]
}

export interface NotificationReceipt {
  id: string
  observedAt: string
  read: boolean
  dismissed: boolean
}

const SEEN_KEY = 'cs-seen-notifs-v2'
const DISMISSED_KEY = 'cs-dismissed-notifs-v1'

/** Old quest IDs included a completion timestamp that changes during retakes. */
export function canonicalNotificationId(id: string): string {
  const canonical = id.startsWith('quest:') ? id.split(':').slice(0, 2).join(':') : id
  if (canonical.length > 256 || !/^(announcement|quest|admin|ach|rank):[a-zA-Z0-9_-]+$/.test(canonical)) {
    throw new TypeError(`Invalid notification ID: ${id}`)
  }
  return canonical
}

function readIds(storage: Storage, baseKey: string, ownerKey: string): string[] {
  const key = `${baseKey}:${ownerKey}`
  const raw = storage.getItem(key) ?? storage.getItem(baseKey)
  if (raw === null) return []
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw new SyntaxError(`Notification preferences contain invalid JSON (key=${key}): ${error.message}`)
  }
  if (!Array.isArray(parsed) || !parsed.every((id): id is string => typeof id === 'string')) {
    throw new TypeError(`Notification preferences must contain an array of IDs (key=${key}).`)
  }
  return Array.from(new Set(parsed.map(canonicalNotificationId)))
}

export function readLocalNotificationPreferences(storage: Storage, ownerKey: string): NotificationPreferences {
  return { seen: readIds(storage, SEEN_KEY, ownerKey), dismissed: readIds(storage, DISMISSED_KEY, ownerKey) }
}

export function markLocalNotificationsRead(storage: Storage, ownerKey: string, ids: readonly string[]): NotificationPreferences {
  const current = readLocalNotificationPreferences(storage, ownerKey)
  const seen = Array.from(new Set([...current.seen, ...ids.map(canonicalNotificationId)]))
  storage.setItem(`${SEEN_KEY}:${ownerKey}`, JSON.stringify(seen))
  return { ...current, seen }
}

export function dismissLocalNotifications(storage: Storage, ownerKey: string, ids: readonly string[]): NotificationPreferences {
  const current = readLocalNotificationPreferences(storage, ownerKey)
  const dismissed = Array.from(new Set([...current.dismissed, ...ids.map(canonicalNotificationId)]))
  storage.setItem(`${DISMISSED_KEY}:${ownerKey}`, JSON.stringify(dismissed))
  return { ...current, dismissed }
}

/** Remove imported receipts only after both account writes have succeeded. */
export function removeImportedNotificationPreferences(storage: Storage, ownerKey: string, imported: NotificationPreferences): void {
  const current = readLocalNotificationPreferences(storage, ownerKey)
  const importedSeen = new Set(imported.seen)
  const importedDismissed = new Set(imported.dismissed)
  storage.setItem(`${SEEN_KEY}:${ownerKey}`, JSON.stringify(current.seen.filter(id => !importedSeen.has(id))))
  storage.setItem(`${DISMISSED_KEY}:${ownerKey}`, JSON.stringify(current.dismissed.filter(id => !importedDismissed.has(id))))
  storage.removeItem(SEEN_KEY)
  storage.removeItem(DISMISSED_KEY)
}

export function preferencesFromReceipts(receipts: readonly NotificationReceipt[]): NotificationPreferences {
  return {
    seen: receipts.filter(receipt => receipt.read || receipt.dismissed).map(receipt => receipt.id),
    dismissed: receipts.filter(receipt => receipt.dismissed).map(receipt => receipt.id),
  }
}

export function mergeNotificationPreferences(current: NotificationPreferences, incoming: NotificationPreferences): NotificationPreferences {
  return {
    seen: Array.from(new Set([...current.seen, ...incoming.seen])),
    dismissed: Array.from(new Set([...current.dismissed, ...incoming.dismissed])),
  }
}

