import { SUPPORT_VIDEO_PACKET_BYTES } from './supportProtocol'

export const SUPPORT_VIDEO_MIME = 'video/webm;codecs=vp8'
const MAX_QUEUED_BYTES = 1_000_000

export const assertSupportVideoPlayback = (): void => {
  if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported(SUPPORT_VIDEO_MIME)) {
    throw new Error('Live help video requires a desktop browser with WebM playback, such as current Chrome or Edge.')
  }
}

export const assertSupportVideoCapture = (): void => {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported(SUPPORT_VIDEO_MIME)) {
    throw new Error('Live help tab sharing requires a desktop browser with WebM recording, such as current Chrome or Edge.')
  }
}

/** Encodes continuous video in bounded packets; stops instead of accumulating lag. */
export const startSupportVideo = (
  stream: MediaStream,
  sendPacket: (sequence: number, data: string) => Promise<void>,
  onError: (error: Error) => void,
): (() => void) => {
  assertSupportVideoCapture()
  const recorder = new MediaRecorder(stream, { mimeType: SUPPORT_VIDEO_MIME, videoBitsPerSecond: 1_000_000 })
  let stopped = false
  let sequence = 0
  let queuedBytes = 0
  let queue = Promise.resolve()
  const stop = (): void => {
    stopped = true
    recorder.ondataavailable = null
    recorder.onerror = null
    if (recorder.state !== 'inactive') recorder.stop()
  }
  const fail = (error: Error): void => { if (!stopped) { stop(); onError(error) } }
  recorder.onerror = () => fail(new Error('The browser could not encode the shared tab. Stop sharing and start a new session.'))
  recorder.ondataavailable = event => {
    if (stopped || event.data.size === 0) return
    queuedBytes += event.data.size
    if (queuedBytes > MAX_QUEUED_BYTES) {
      fail(new Error('Live video upload cannot keep up. Check your connection and Supabase Realtime usage before trying again.'))
      return
    }
    queue = queue.then(async () => {
      try {
        const bytes = new Uint8Array(await event.data.arrayBuffer())
        for (let offset = 0; offset < bytes.length && !stopped; offset += SUPPORT_VIDEO_PACKET_BYTES) {
          const packet = bytes.subarray(offset, offset + SUPPORT_VIDEO_PACKET_BYTES)
          await sendPacket(++sequence, btoa(String.fromCharCode(...packet)))
        }
      } finally {
        queuedBytes -= event.data.size
      }
    }).catch((error: Error) => fail(error))
  }
  recorder.start(250)
  return stop
}

export interface SupportVideoPlayer {
  append: (sequence: number, data: string) => void
  close: () => void
}

/** Plays ordered WebM packets without saving a recording or retaining old video. */
export const createSupportVideoPlayer = (
  video: HTMLVideoElement,
  onPlayback: (playing: boolean) => void,
  onError: (error: Error) => void,
): SupportVideoPlayer => {
  assertSupportVideoPlayback()
  const source = new MediaSource()
  const url = URL.createObjectURL(source)
  let buffer: SourceBuffer | null = null
  let closed = false
  let sequence = 0
  let queuedBytes = 0
  let lastTrim = 0
  const queue: Uint8Array<ArrayBuffer>[] = []
  const playing = (): void => onPlayback(true)
  const waiting = (): void => onPlayback(false)

  const close = (): void => {
    if (closed) return
    closed = true
    source.removeEventListener('sourceopen', open)
    video.removeEventListener('playing', playing)
    video.removeEventListener('waiting', waiting)
    video.removeEventListener('pause', waiting)
    video.removeEventListener('error', mediaError)
    buffer?.removeEventListener('updateend', pump)
    buffer?.removeEventListener('error', mediaError)
    queue.length = 0
    video.pause()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
    onPlayback(false)
  }
  const fail = (error: Error): void => { if (!closed) { close(); onError(error) } }
  const mediaError = (): void => fail(new Error(`Live video decoding failed${video.error ? ` (code ${video.error.code}: ${video.error.message})` : ''}. Start a new help session.`))
  const pump = (): void => {
    if (closed || !buffer || buffer.updating) return
    try {
      if (video.currentTime > 6 && video.currentTime - lastTrim > 2) {
        lastTrim = video.currentTime
        buffer.remove(0, video.currentTime - 4)
        return
      }
      const packet = queue.shift()
      if (packet) {
        queuedBytes -= packet.byteLength
        buffer.appendBuffer(packet)
      }
      if (video.buffered.length > 0) {
        const end = video.buffered.end(video.buffered.length - 1)
        if (end - video.currentTime > 1.5) video.currentTime = Math.max(0, end - 0.5)
        if (video.paused) void video.play().catch((error: Error) => fail(error))
      }
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  }
  const open = (): void => {
    try {
      buffer = source.addSourceBuffer(SUPPORT_VIDEO_MIME)
      buffer.addEventListener('updateend', pump)
      buffer.addEventListener('error', mediaError)
      pump()
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  }
  source.addEventListener('sourceopen', open, { once: true })
  video.addEventListener('playing', playing)
  video.addEventListener('waiting', waiting)
  video.addEventListener('pause', waiting)
  video.addEventListener('error', mediaError)
  video.muted = true
  video.src = url

  return {
    close,
    append: (nextSequence, data): void => {
      if (closed) throw new Error('The live video player is closed.')
      // Broadcast acknowledgements may be lost; a retried packet is not appended twice.
      if (nextSequence <= sequence) return
      if (nextSequence !== sequence + 1) {
        fail(new Error('A live video packet was missed. Start a new help session to restore the video.'))
        return
      }
      try {
        const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0))
        queuedBytes += bytes.byteLength
        if (queuedBytes > MAX_QUEUED_BYTES) throw new Error('Live video playback cannot keep up with the incoming stream.')
        sequence = nextSequence
        queue.push(bytes)
        pump()
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    },
  }
}
