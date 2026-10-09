import { supabase } from '@/services/supabase'

type AuditValue = string | number | boolean | null | AuditValue[] | { [key: string]: AuditValue }

export interface AuditEntry {
  id: string
  admin_id: string | null
  target_user_id: string | null
  action: string
  details: AuditValue
  created_at: string | null
  admin: { playername: string } | null
  target: { playername: string } | null
}

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`Audit log returned an invalid ${field}.`)
  }
  return value
}

const parseName = (value: unknown, field: string): { playername: string } | null => {
  if (value === null) return null
  if (typeof value !== 'object' || !value || !('playername' in value)) {
    throw new TypeError(`Audit log returned an invalid ${field} profile.`)
  }
  return { playername: requireString(value.playername, `${field}.playername`) }
}

const parseValue = (value: unknown): AuditValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(parseValue)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, parseValue(item)]))
  }
  throw new TypeError('Audit log returned details that are not valid JSON.')
}

export const parseAuditEntries = (value: unknown): AuditEntry[] => {
  if (!Array.isArray(value)) throw new TypeError('Audit log returned an invalid list of entries.')
  return value.map((row: unknown) => {
    if (!row || typeof row !== 'object' || !('id' in row) || !('admin_id' in row) ||
      !('target_user_id' in row) || !('action' in row) || !('details' in row) ||
      !('created_at' in row) || !('admin' in row) || !('target' in row)) {
      throw new TypeError('Audit log entry is missing required fields.')
    }
    const createdAt = row.created_at === null ? null : requireString(row.created_at, 'created_at')
    if (createdAt !== null && !Number.isFinite(Date.parse(createdAt))) throw new TypeError('Audit log returned an invalid timestamp.')
    return {
      id: requireString(row.id, 'id'),
      admin_id: row.admin_id === null ? null : requireString(row.admin_id, 'admin_id'),
      target_user_id: row.target_user_id === null ? null : requireString(row.target_user_id, 'target_user_id'),
      action: requireString(row.action, 'action'),
      details: parseValue(row.details),
      created_at: createdAt,
      admin: parseName(row.admin, 'admin'),
      target: parseName(row.target, 'target'),
    }
  })
}

export const readAuditLogs = async (): Promise<AuditEntry[]> => {
  await assertAdminAuditReady()
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await supabase.from('admin_audit_log')
        .select('id, admin_id, target_user_id, action, details, created_at, admin:admin_id(playername), target:target_user_id(playername)')
        .order('created_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
        .limit(100)
      if (result.error) {
        throw new Error(`Reading the latest 100 audit entries failed (HTTP ${result.status}, ${result.error.code}): ${result.error.message}. ${result.error.details} ${result.error.hint}`.trim())
      }
      return parseAuditEntries(result.data)
    } catch (caught: unknown) {
      console.warn('Admin audit log read failed', { attempt, error: caught })
      if (attempt === 2) throw caught
    }
  }
  throw new Error('Audit log read ended without a response.')
}

/** Prevents admin saves against a database that cannot record their audit entries atomically. */
export const assertAdminAuditReady = async (): Promise<void> => {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await supabase.rpc('admin_audit_ready')
      if (result.error) {
        throw new Error(`Admin audit setup check failed (HTTP ${result.status}, ${result.error.code}): ${result.error.message}. Apply scripts/sql/admin_audit.sql in Supabase before saving admin changes. ${result.error.details} ${result.error.hint}`.trim())
      }
      if (result.data !== 1) throw new Error('Admin audit setup returned an unsupported version. Apply scripts/sql/admin_audit.sql in Supabase before saving admin changes.')
      return
    } catch (caught: unknown) {
      console.warn('Admin audit setup check failed', { attempt, error: caught })
      if (attempt === 2) throw caught
    }
  }
}
