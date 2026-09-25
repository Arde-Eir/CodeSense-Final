import type { RealtimeChannel } from '@supabase/supabase-js'
import type { SupportSession } from './liveSupport'
import { parseSupportChatText, type SupportChatMessage, type SupportControl, type SupportMessage } from './supportProtocol'
import { closeSupportChannel, openSupportChannel, sendSupportMessage } from './supportTransport'
import { createSupportVideoPlayer, startSupportVideo, type SupportVideoPlayer } from './supportVideo'

export interface SupportPublisher {
  close: () => Promise<void>
  sendChat: (text: string) => Promise<SupportChatMessage>
}
export interface SupportViewer extends SupportPublisher { sendControl: (command: SupportControl) => Promise<void> }
type ConnectionSession = Pick<SupportSession, 'id' | 'adminId' | 'learnerId' | 'expiresAt'>

const sendSupportChat = async (
  channel: RealtimeChannel, senderId: string, streamId: string, text: string,
): Promise<SupportChatMessage> => {
  const message = { id: crypto.randomUUID(), senderId, text: parseSupportChatText(text) }
  await sendSupportMessage(channel, { ...message, kind: 'chat', streamId })
  return message
}

/** The learner owns capture and control; closing disables both before any network work. */
export const connectSupportPublisher = async (
  session: ConnectionSession,
  stream: MediaStream,
  applyControl: (command: SupportControl) => void,
  onChat: (message: SupportChatMessage) => void,
  onError: (error: Error) => void,
): Promise<SupportPublisher> => {
  let channel: RealtimeChannel | null = null
  let closed = false
  let viewerId = ''
  let streamId = ''
  let lastReady = Date.now()
  let lastControlSequence = 0
  let stopVideo: (() => void) | null = null
  let timer: number | null = null
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    stopVideo?.()
    if (timer !== null) window.clearInterval(timer)
    const current = channel
    channel = null
    if (current) {
      try {
        if (streamId && current.state === 'joined') await sendSupportMessage(current, { kind: 'ended', senderId: session.learnerId, streamId })
      } finally {
        await closeSupportChannel(current)
      }
    }
  }
  const fail = (error: Error): void => {
    if (closed) return
    void close().catch(onError)
    onError(error)
  }
  const receive = async (message: SupportMessage): Promise<void> => {
    if (closed || !channel || message.senderId !== session.adminId) return
    if (message.kind === 'ready') {
      lastReady = Date.now()
      if (viewerId !== message.viewerId) {
        viewerId = message.viewerId
        streamId = crypto.randomUUID()
        lastControlSequence = 0
        stopVideo?.()
        const nextStreamId = streamId
        await sendSupportMessage(channel, { kind: 'started', senderId: session.learnerId, viewerId, streamId })
        if (closed || streamId !== nextStreamId) return
        stopVideo = startSupportVideo(stream, async (sequence, data) => {
          if (closed || streamId !== nextStreamId || !channel) return
          await sendSupportMessage(channel, { kind: 'video', senderId: session.learnerId, streamId: nextStreamId, sequence, data })
        }, fail)
      } else {
        await sendSupportMessage(channel, { kind: 'heartbeat', senderId: session.learnerId, streamId })
      }
      return
    }
    if (message.streamId !== streamId) return
    if (message.kind === 'chat') {
      if (Date.parse(session.expiresAt) <= Date.now()) throw new Error('The live-help session expired.')
      onChat(message)
      return
    }
    if (message.kind !== 'control') return
    // Retrying a broadcast must never click a button or advance a dropdown twice.
    if (message.sequence <= lastControlSequence) return
    if (Date.now() - lastReady > 10_000 || Date.parse(session.expiresAt) <= Date.now()) {
      throw new Error('Live help control expired or the administrator disconnected.')
    }
    lastControlSequence = message.sequence
    try {
      applyControl(message.command)
    } catch (error) {
      await sendSupportMessage(channel, {
        kind: 'control-error', senderId: session.learnerId, streamId,
        message: (error instanceof Error ? error.message : String(error)).slice(0, 300),
      })
    }
  }
  channel = await openSupportChannel(session.id, message => { void receive(message).catch(fail) }, fail)
  if (closed) { await closeSupportChannel(channel); throw new Error('The learner connection closed during setup.') }
  timer = window.setInterval(() => {
    if (Date.parse(session.expiresAt) <= Date.now()) fail(new Error('The live-help session expired.'))
    else if (Date.now() - lastReady > 15_000) fail(new Error('The administrator disconnected. Tab sharing has stopped.'))
  }, 1000)
  return {
    close,
    sendChat: async text => {
      if (closed || !channel || !streamId || Date.now() - lastReady > 10_000 || Date.parse(session.expiresAt) <= Date.now()) {
        throw new Error('Chat is disconnected. Wait for the administrator to connect before sending a message.')
      }
      return sendSupportChat(channel, session.learnerId, streamId, text)
    },
  }
}

export const connectSupportViewer = async (
  session: ConnectionSession,
  video: HTMLVideoElement,
  onConnected: (connected: boolean) => void,
  onChat: (message: SupportChatMessage) => void,
  onError: (error: Error) => void,
): Promise<SupportViewer> => {
  let channel: RealtimeChannel | null = null
  let player: SupportVideoPlayer | null = null
  let timer: number | null = null
  let closed = false
  let streamId = ''
  let sequence = 0
  let lastMessage = Date.now()
  let sendingReady = false
  let hasPlayed = false
  const viewerId = crypto.randomUUID()
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    if (timer !== null) window.clearInterval(timer)
    player?.close()
    onConnected(false)
    const current = channel
    channel = null
    if (current) await closeSupportChannel(current)
  }
  const fail = (error: Error): void => {
    if (closed) return
    void close().catch(onError)
    onError(error)
  }
  const receive = (message: SupportMessage): void => {
    if (closed || message.senderId !== session.learnerId || message.kind === 'ready') return
    if (message.kind === 'started') {
      if (message.viewerId !== viewerId) { fail(new Error('This help session is open in another administrator tab.')); return }
      if (message.streamId === streamId) return
      player?.close()
      onConnected(false)
      streamId = message.streamId
      player = createSupportVideoPlayer(video, value => { hasPlayed = value; onConnected(value) }, fail)
    } else if (message.streamId !== streamId) return
    lastMessage = Date.now()
    if (message.kind === 'video') player?.append(message.sequence, message.data)
    if (message.kind === 'chat') onChat(message)
    if (message.kind === 'control-error') onError(new Error(`Learner tab rejected an action: ${message.message}`))
    if (message.kind === 'ended') { void close().catch(onError) }
  }
  channel = await openSupportChannel(session.id, receive, fail)
  if (closed) { await closeSupportChannel(channel); throw new Error('The administrator connection closed during setup.') }
  const sendReady = async (): Promise<void> => {
    if (closed || !channel || sendingReady) return
    sendingReady = true
    try {
      if (Date.parse(session.expiresAt) <= Date.now()) throw new Error('The live-help session expired.')
      if (Date.now() - lastMessage > 15_000) throw new Error('The shared tab disconnected. Start a new help session.')
      await sendSupportMessage(channel, { kind: 'ready', senderId: session.adminId, viewerId })
    } finally {
      sendingReady = false
    }
  }
  try { await sendReady() } catch (error) { await close(); throw error }
  timer = window.setInterval(() => { void sendReady().catch(fail) }, 2000)
  return {
    close,
    sendChat: async text => {
      if (closed || !channel || !streamId || Date.now() - lastMessage > 10_000 || Date.parse(session.expiresAt) <= Date.now()) {
        throw new Error('Chat is disconnected. Wait for the learner to connect before sending a message.')
      }
      return sendSupportChat(channel, session.adminId, streamId, text)
    },
    sendControl: async command => {
      // Decoder buffering/seeking does not revoke a live session after its first
      // frame. Liveness, expiry, pause and close still prevent disconnected control.
      if (closed || !channel || !streamId || Date.now() - lastMessage > 5000 ||
        Date.parse(session.expiresAt) <= Date.now() || video.paused || !hasPlayed) {
        throw new Error('Live control is disconnected. Wait for a current video stream before sending actions.')
      }
      await sendSupportMessage(channel, { kind: 'control', senderId: session.adminId, streamId, sequence: ++sequence, command })
    },
  }
}
