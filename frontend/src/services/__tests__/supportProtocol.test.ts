import { describe, expect, it } from 'vitest'
import { parseSupportMessage, SUPPORT_VIDEO_PACKET_BYTES } from '@/services/supportProtocol'

describe('private live-help messages', () => {
  it('rejects oversized media and invalid packet sequences before decoding', () => {
    const packet = { kind: 'video', senderId: 'learner', streamId: 'stream', sequence: 1, data: 'AAAA' }
    expect(() => parseSupportMessage({ ...packet, data: 'A'.repeat(SUPPORT_VIDEO_PACKET_BYTES * 4 / 3 + 4) })).toThrow('oversized')
    expect(() => parseSupportMessage({ ...packet, sequence: -1 })).toThrow('sequence')
    expect(() => parseSupportMessage({ ...packet, sequence: 1.5 })).toThrow('sequence')
    expect(() => parseSupportMessage({ ...packet, data: '<script>' })).toThrow('video packet')
  })

  it('validates control messages and requires a stream identity', () => {
    const packet = { kind: 'control', senderId: 'admin', streamId: 'stream', sequence: 1, command: { kind: 'click', x: 0.5, y: 0.25 } }
    expect(parseSupportMessage(packet)).toEqual(packet)
    expect(() => parseSupportMessage({ ...packet, streamId: '' })).toThrow('streamId')
    expect(() => parseSupportMessage({ ...packet, command: { kind: 'click', x: 2, y: 0 } })).toThrow('coordinate')
    expect(() => parseSupportMessage({ ...packet, command: { kind: 'text', value: 'x'.repeat(8001) } })).toThrow('8,000')
  })
})
