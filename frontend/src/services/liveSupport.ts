import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type SupportStatus = 'requested' | 'active' | 'declined' | 'ended'

export interface SupportSession {
  id: string
  adminId: string
  adminName: string
  learnerId: string
  status: SupportStatus
  requestedAt: string
  acceptedAt: string | null
  endedAt: string | null
  expiresAt: string
}

interface SupabaseResult {
  data: unknown
  error: PostgrestError | null
  status: number
}

const requireRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Live help returned a malformed session record.')
  }
  return value as Record<string, unknown>
}

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Live help session is missing a valid ${field}.`)
  }
  return value
}

const optionalString = (value: unknown, field: string): string | null => {
  if (value === null) return null
  return requireString(value, field)
}

const parseStatus = (value: unknown): SupportStatus => {
  if (value === 'requested' || value === 'active' || value === 'declined' || value === 'ended') {
    return value
  }
  throw new TypeError(`Live help session has an invalid status: ${String(value)}.`)
}

export const parseSupportSession = (value: unknown): SupportSession => {
  const row = requireRecord(value)
  return {
    id: requireString(row.id, 'id'),
    adminId: requireString(row.admin_id, 'admin_id'),
    adminName: requireString(row.admin_name, 'admin_name'),
    learnerId: requireString(row.learner_id, 'learner_id'),
    status: parseStatus(row.status),
    requestedAt: requireString(row.requested_at, 'requested_at'),
    acceptedAt: optionalString(row.accepted_at, 'accepted_at'),
    endedAt: optionalString(row.ended_at, 'ended_at'),
    expiresAt: requireString(row.expires_at, 'expires_at'),
  }
}

const requestResult = async (
  operation: string,
  parameters: Record<string, string>,
  call: () => PromiseLike<SupabaseResult>,
): Promise<unknown> => {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await call()
      if (!result.error) return result.data

      lastError = new Error(
        `${operation} failed (HTTP ${result.status}, code ${result.error.code}): ` +
        `${result.error.message}. ${result.error.details} ${result.error.hint}`.trim(),
      )
      console.warn('Live help request failed', {
        operation,
        parameters,
        attempt,
        status: result.status,
        code: result.error.code,
        details: result.error.details,
        hint: result.error.hint,
      })
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error))
      console.warn('Live help transport failed', {
        operation,
        parameters,
        attempt,
        error: lastError.message,
      })
    }
  }

  throw new Error(
    `${operation} failed after 2 attempts with ${JSON.stringify(parameters)}: ${lastError?.message ?? 'no response'}`,
  )
}

const requireSession = (value: unknown, operation: string): SupportSession => {
  if (value === null) throw new Error(`${operation} returned no help session.`)
  return parseSupportSession(value)
}

export const requestSupportSession = async (learnerId: string): Promise<SupportSession> =>
  requireSession(
    await requestResult('request_support_session', { learnerId }, () =>
      supabase.rpc('request_support_session', { p_learner_id: learnerId })
    ),
    'request_support_session',
  )

export const acceptSupportSession = async (sessionId: string): Promise<SupportSession> =>
  requireSession(
    await requestResult('accept_support_session', { sessionId }, () =>
      supabase.rpc('accept_support_session', { p_session_id: sessionId })
    ),
    'accept_support_session',
  )

export const declineSupportSession = async (sessionId: string): Promise<SupportSession> =>
  requireSession(
    await requestResult('decline_support_session', { sessionId }, () =>
      supabase.rpc('decline_support_session', { p_session_id: sessionId })
    ),
    'decline_support_session',
  )

export const endSupportSession = async (sessionId: string): Promise<SupportSession> =>
  requireSession(
    await requestResult('end_support_session', { sessionId }, () =>
      supabase.rpc('end_support_session', { p_session_id: sessionId })
    ),
    'end_support_session',
  )

export const recordSupportClick = async (sessionId: string, x: number, y: number): Promise<void> => {
  await requestResult('record_support_action', { sessionId, kind: 'click' }, () =>
    supabase.rpc('record_support_action', {
      p_session_id: sessionId, p_kind: 'click', p_position_x: x, p_position_y: y, p_text_length: null,
    })
  )
}

export const recordSupportText = async (sessionId: string, length: number): Promise<void> => {
  await requestResult('record_support_action', { sessionId, kind: 'text', length: String(length) }, () =>
    supabase.rpc('record_support_action', {
      p_session_id: sessionId, p_kind: 'text', p_position_x: null, p_position_y: null, p_text_length: length,
    })
  )
}

export const recordSupportSelection = async (sessionId: string): Promise<void> => {
  await requestResult('record_support_action', { sessionId, kind: 'select' }, () =>
    supabase.rpc('record_support_action', {
      p_session_id: sessionId, p_kind: 'select', p_position_x: null, p_position_y: null, p_text_length: null,
    })
  )
}

export const getSupportSession = async (sessionId: string): Promise<SupportSession | null> => {
  const result = await requestResult('read support session', { sessionId }, () =>
    supabase.from('support_sessions').select('*').eq('id', sessionId).maybeSingle()
  )
  return result === null ? null : parseSupportSession(result)
}

export const getLearnerOpenSession = async (learnerId: string): Promise<SupportSession | null> => {
  const result = await requestResult('read learner help requests', { learnerId }, () =>
    supabase.from('support_sessions')
      .select('*')
      .eq('learner_id', learnerId)
      .in('status', ['requested', 'active'])
      .gt('expires_at', new Date().toISOString())
      .order('requested_at', { ascending: false })
      .limit(1)
  )
  if (!Array.isArray(result)) {
    throw new TypeError('Live help returned a malformed request list.')
  }
  return result.length === 0 ? null : parseSupportSession(result[0])
}
