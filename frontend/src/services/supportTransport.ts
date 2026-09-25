import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { parseSupportMessage, type SupportMessage } from './supportProtocol'

const subscribeOnce = async (
  sessionId: string,
  onMessage: (message: SupportMessage) => void,
  onError: (error: Error) => void,
): Promise<RealtimeChannel> => {
  await supabase.realtime.setAuth()
  const channel = supabase.channel(`support:${sessionId}`, {
    config: { private: true, broadcast: { ack: true, self: false } },
  })
  channel.on('broadcast', { event: 'live-help-video' }, ({ payload }) => {
    try {
      onMessage(parseSupportMessage(payload))
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)))
    }
  })
  try {
    await new Promise<void>((resolve, reject) => {
      let subscribed = false
      const timeout = window.setTimeout(() => reject(new Error('Private live-help channel did not connect within 15 seconds. Check Supabase Realtime access policies.')), 15_000)
      channel.subscribe(status => {
        if (status === 'SUBSCRIBED') {
          subscribed = true
          window.clearTimeout(timeout)
          resolve()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          window.clearTimeout(timeout)
          const error = new Error(`Private live-help channel ${status}. Check your connection and Supabase Realtime limits.`)
          if (subscribed) onError(error)
          else reject(error)
        }
      })
    })
    return channel
  } catch (error) {
    await supabase.removeChannel(channel)
    throw error
  }
}

export const openSupportChannel = async (
  sessionId: string,
  onMessage: (message: SupportMessage) => void,
  onError: (error: Error) => void,
): Promise<RealtimeChannel> => {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await subscribeOnce(sessionId, onMessage, onError)
    } catch (error) {
      console.warn('Live help channel connection failed', { sessionId, attempt, error })
      if (attempt === 2) throw error
    }
  }
  throw new Error(`Live help connection attempts exhausted for session ${sessionId}.`)
}

export const sendSupportMessage = async (channel: RealtimeChannel, message: SupportMessage): Promise<void> => {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (channel.state !== 'joined') throw new Error('The private live-help channel is disconnected. Start a new help session.')
    const response = await channel.send({ type: 'broadcast', event: 'live-help-video', payload: message }, { timeout: 3000 })
    if (response === 'ok') return
    console.warn('Live help message failed', { kind: message.kind, attempt, response })
    if (attempt === 2) throw new Error(`Could not send live-help ${message.kind}: ${response}.`)
  }
}

export const closeSupportChannel = async (channel: RealtimeChannel): Promise<void> => {
  const response = await supabase.removeChannel(channel)
  if (response !== 'ok') throw new Error(`Could not close the private live-help channel: ${response}.`)
}
