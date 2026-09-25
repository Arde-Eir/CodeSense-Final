import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

// Real Chromium encoder/decoder integration; no camera, account, or external relay.
const server = await createServer({
  configFile: false,
  appType: 'custom',
  root: fileURLToPath(new URL('..', import.meta.url)),
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { host: '127.0.0.1', port: 0 },
})
server.middlewares.use('/support-video-test', (_request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end('<canvas id="source" width="1280" height="720"></canvas><video id="viewer" muted autoplay playsinline></video>')
})
let browser
try {
  await server.listen()
  const address = server.httpServer.address()
  assert(address && typeof address !== 'string')
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${address.port}/support-video-test`)
  const result = await page.evaluate(async () => {
    const { createSupportVideoPlayer, startSupportVideo } = await import('/src/services/supportVideo.ts')
    const { parseSupportMessage } = await import('/src/services/supportProtocol.ts')
    const canvas = document.getElementById('source')
    const video = document.getElementById('viewer')
    const context = canvas.getContext('2d')
    const errors = []
    let received = 0
    let maxPayloadBytes = 0
    let inFlight = 0
    let maxInFlight = 0
    let playing = false
    let drawn = 0
    const player = createSupportVideoPlayer(video, value => { playing = value }, error => errors.push(error.message))
    const stream = canvas.captureStream(24)
    const animation = setInterval(() => {
      context.fillStyle = '#112233'
      context.fillRect(0, 0, 1280, 720)
      context.fillStyle = 'white'
      context.font = '40px sans-serif'
      context.fillText(`Live tab frame ${drawn}`, 40, 60)
      // Whole-page changes exercise the larger bursts seen during navigation.
      for (let i = 0; i < 100; i++) {
        context.fillStyle = `hsl(${(i * 43 + drawn * 17) % 360},70%,50%)`
        context.fillRect((i % 10) * 128, Math.floor(i / 10) * 72, 100, 55)
      }
      context.fillStyle = '#22cc88'
      context.fillRect((drawn++ * 7) % 1100, 300, 180, 140)
    }, 1000 / 24)
    const stop = startSupportVideo(stream, async (sequence, data) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      const payload = JSON.stringify({ kind: 'video', senderId: 'learner', streamId: 'stream', sequence, data })
      maxPayloadBytes = Math.max(maxPayloadBytes, new TextEncoder().encode(payload).length)
      const message = parseSupportMessage(JSON.parse(payload))
      // Deliver in order, then delay the server acknowledgment: a 400 ms round
      // trip must not serialize the stream to fewer than four chunks per second.
      await new Promise(resolve => setTimeout(resolve, 100))
      player.append(message.sequence, message.data)
      player.append(message.sequence, message.data)
      received++
      await new Promise(resolve => setTimeout(resolve, 300))
      inFlight--
    }, error => errors.push(error.message))
    try {
      await new Promise(resolve => setTimeout(resolve, 12000))
      const quality = video.getVideoPlaybackQuality()
      const playback = { playing, seconds: video.currentTime, frames: quality.totalVideoFrames, dropped: quality.droppedVideoFrames }
      stop()
      await new Promise(resolve => setTimeout(resolve, 400))
      const afterStop = received
      await new Promise(resolve => setTimeout(resolve, 500))
      const stopped = received === afterStop
      player.close()
      const srcRemoved = !video.hasAttribute('src') && !playing
      let gapError = ''
      const brokenPlayer = createSupportVideoPlayer(video, () => {}, error => { gapError = error.message })
      brokenPlayer.append(2, 'AAAA')
      brokenPlayer.close()
      return { playback, received, maxPayloadBytes, maxInFlight, stopped, srcRemoved, gapError, errors }
    } finally {
      stop()
      player.close()
      clearInterval(animation)
      stream.getTracks().forEach(track => track.stop())
    }
  })
  assert.deepEqual(result.errors, [])
  assert(result.playback.playing, 'Native video playback never started')
  assert(result.playback.seconds > 10, 'Continuous video fell behind live capture')
  assert(result.playback.frames > 200, 'Video became choppy while waiting for network acknowledgments')
  assert(result.maxInFlight > 1 && result.maxInFlight <= 4, 'Upload must pipeline packets with a bounded window')
  assert(result.maxPayloadBytes < 256_000, 'Video exceeded Supabase Free payload limit')
  assert(result.stopped, 'Capture continued sending after Stop Sharing')
  assert(result.srcRemoved, 'Closing left the shared video attached')
  assert.match(result.gapError, /packet was missed/)
  console.log(JSON.stringify(result))
} finally {
  if (browser) await browser.close()
  await server.close()
}
