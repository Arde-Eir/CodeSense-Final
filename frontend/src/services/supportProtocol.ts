export type SupportControl =
  | { kind: 'pointer' | 'click'; x: number; y: number }
  | { kind: 'scroll'; x: number; y: number; deltaY: number }
  | { kind: 'text'; value: string }
  | { kind: 'selectNext' }
  | { kind: 'selectPrevious' }

export interface SupportChatMessage { id: string; senderId: string; text: string }
export const SUPPORT_CHAT_MAX_LENGTH = 2000

export const parseSupportChatText = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > SUPPORT_CHAT_MAX_LENGTH) {
    throw new TypeError(`Chat messages must contain 1–${SUPPORT_CHAT_MAX_LENGTH} characters.`)
  }
  return value.trim()
}

/** Keep the latest 100 messages in session memory and deduplicate broadcast retries. */
export const appendSupportChatMessage = (messages: SupportChatMessage[], message: SupportChatMessage): SupportChatMessage[] =>
  messages.some(item => item.id === message.id) ? messages : [...messages, message].slice(-100)

export type SupportMessage = { senderId: string } & (
  | { kind: 'ready'; viewerId: string }
  | { kind: 'started'; viewerId: string; streamId: string }
  | { kind: 'video'; streamId: string; sequence: number; data: string }
  | { kind: 'heartbeat' | 'ended'; streamId: string }
  | { kind: 'control'; streamId: string; sequence: number; command: SupportControl }
  | { kind: 'control-error'; streamId: string; message: string }
  | { kind: 'chat'; streamId: string; id: string; text: string }
)

// 48 KB of binary video becomes 64 KB of base64, below Realtime's 256 KB limit.
export const SUPPORT_VIDEO_PACKET_BYTES = 48_000

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Live help received a malformed message.')
  }
  return value as Record<string, unknown>
}

const nonemptyString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 300) {
    throw new TypeError(`Live help message is missing ${field}.`)
  }
  return value
}

const sequenceNumber = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError('Live help received an invalid sequence number.')
  }
  return value
}

export const parseSupportMessage = (value: unknown): SupportMessage => {
  const message = record(value)
  const senderId = nonemptyString(message.senderId, 'senderId')
  if (message.kind === 'ready') return { kind: 'ready', senderId, viewerId: nonemptyString(message.viewerId, 'viewerId') }
  const streamId = nonemptyString(message.streamId, 'streamId')
  if (message.kind === 'started') return { kind: 'started', senderId, streamId, viewerId: nonemptyString(message.viewerId, 'viewerId') }
  if (message.kind === 'heartbeat' || message.kind === 'ended') return { kind: message.kind, senderId, streamId }
  if (message.kind === 'control-error') return { kind: 'control-error', senderId, streamId, message: nonemptyString(message.message, 'message') }
  if (message.kind === 'chat') return {
    kind: 'chat', senderId, streamId, id: nonemptyString(message.id, 'id'), text: parseSupportChatText(message.text),
  }
  const sequence = sequenceNumber(message.sequence)
  if (message.kind === 'control') return { kind: 'control', senderId, streamId, sequence, command: parseSupportControl(message.command) }
  if (message.kind === 'video') {
    if (typeof message.data !== 'string' || message.data.length === 0 || message.data.length > SUPPORT_VIDEO_PACKET_BYTES * 4 / 3 ||
      message.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(message.data)) {
      throw new TypeError('Live help received an invalid or oversized video packet.')
    }
    return { kind: 'video', senderId, streamId, sequence, data: message.data }
  }
  throw new TypeError(`Live help received an unsupported message kind: ${String(message.kind)}.`)
}

const unitCoordinate = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`Live help message has an invalid ${field} coordinate.`)
  }
  return value
}

export const parseSupportControl = (value: unknown): SupportControl => {
  const message = record(value)
  if (message.kind === 'pointer' || message.kind === 'click') {
    return {
      kind: message.kind,
      x: unitCoordinate(message.x, 'x'),
      y: unitCoordinate(message.y, 'y'),
    }
  }
  if (message.kind === 'scroll') {
    if (typeof message.deltaY !== 'number' || !Number.isFinite(message.deltaY)) {
      throw new TypeError('Live help scroll message has an invalid deltaY.')
    }
    return {
      kind: 'scroll',
      x: unitCoordinate(message.x, 'x'),
      y: unitCoordinate(message.y, 'y'),
      deltaY: Math.max(-1200, Math.min(1200, message.deltaY)),
    }
  }
  if (message.kind === 'text') {
    if (typeof message.value !== 'string' || message.value.length > 8000) {
      throw new TypeError('Live help text must be at most 8,000 characters.')
    }
    return { kind: 'text', value: message.value }
  }
  if (message.kind === 'selectNext') return { kind: 'selectNext' }
  if (message.kind === 'selectPrevious') return { kind: 'selectPrevious' }
  throw new TypeError(`Live help received an unsupported control kind: ${String(message.kind)}.`)
}

