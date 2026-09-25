import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

// Exercise the actual UI, connection protocol, WebM video and DOM controls in two
// browsers tabs. Only the external Supabase service is replaced by a local relay;
// production Auth/RLS and Internet delivery still require a deployed session.
const session = {
  id: 'browser-test', adminId: 'admin', learnerId: 'learner', adminName: 'Administrator',
  status: 'active', requestedAt: new Date().toISOString(), acceptedAt: new Date().toISOString(),
  endedAt: null, expiresAt: new Date(Date.now() + 180_000).toISOString(),
}
const relay = `
  import { parseSupportMessage } from '/src/services/supportProtocol.ts';
  export async function openSupportChannel(id, receive, onError) {
    const bus = new BroadcastChannel(id);
    bus.onmessage = event => { try { receive(parseSupportMessage(JSON.parse(event.data))); } catch (error) { onError(error); } };
    return { state: 'joined', bus };
  }
  export async function closeSupportChannel(channel) { channel.state = 'closed'; channel.bus.close(); }
  export async function sendSupportMessage(channel, message) {
    if (channel.state !== 'joined') throw new Error('Test relay disconnected');
    channel.bus.postMessage(JSON.stringify(message));
    if (message.kind === 'chat') channel.bus.postMessage(JSON.stringify(message));
    await new Promise(resolve => setTimeout(resolve, 200));
  }
`
const rpc = `
  export const session = ${JSON.stringify(session)};
  export async function getSupportSession() { return session; }
  export async function endSupportSession() { session.status = 'ended'; return session; }
  export async function recordSupportClick() { await new Promise(resolve => setTimeout(resolve, 250)); }
  export async function recordSupportSelection() {}
  export async function recordSupportText() {}
`
const entry = `
  import React, { useEffect, useRef, useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { AdminLiveSupport } from '/src/pages/admin/AdminLiveSupport.tsx';
  import { SupportChat } from '/src/components/SupportChat.tsx';
  import { connectSupportPublisher } from '/src/services/supportConnection.ts';
  import { appendSupportChatMessage } from '/src/services/supportProtocol.ts';
  import { applySupportControl } from '/src/services/supportControl.ts';
  import { session } from '/__support-rpc.js';
  window.testErrors = [];
  function Learner() {
    const [messages, setMessages] = useState([]);
    const connection = useRef(null);
    useEffect(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280; canvas.height = 720;
      const context = canvas.getContext('2d');
      let frame = 0;
      const animate = setInterval(() => {
        if (window.pauseDrawing) return;
        context.fillStyle = '#0d1625'; context.fillRect(0, 0, 1280, 720);
        context.fillStyle = '#f3f4f6'; context.font = '32px sans-serif';
        context.fillText('CodeSense — learner tab', 50, 70);
        context.font = '22px monospace';
        ['#include <iostream>', 'int main() {', '    int score = 10;', '    std::cout << score;', '    return 0;', '}'].forEach((line, i) => context.fillText(line, 50, 150 + i * 42));
        context.fillStyle = '#3b82f6'; context.fillRect(50 + (frame++ % 50), 520, 220, 80);
      }, 1000 / 24);
      const stream = canvas.captureStream(24);
      let disposed = false;
      connectSupportPublisher(session, stream, applySupportControl,
        message => setMessages(current => appendSupportChatMessage(current, message)),
        error => window.testErrors.push(error.message),
      ).then(async active => {
        if (disposed) { await active.close(); return; }
        connection.current = active; window.publisherReady = true;
      }).catch(error => window.testErrors.push(error.message));
      return () => { disposed = true; clearInterval(animate); stream.getTracks().forEach(track => track.stop()); connection.current?.close(); };
    }, []);
    const send = async text => {
      const message = await connection.current.sendChat(text);
      setMessages(current => appendSupportChatMessage(current, message));
    };
    return <>
      <div id="nested" style={{ position: 'fixed', left: 20, top: 80, width: 240, height: 180, overflowY: 'auto', background: '#243247' }}>
        <div style={{ height: 1200 }}>Nested learner panel</div>
      </div>
      <button id="target" style={{ position: 'fixed', left: '45%', top: '45%', width: '10%', height: '10%' }} onClick={() => { window.targetClicks = (window.targetClicks || 0) + 1; window.pauseDrawing = false; }}>Learner action</button>
      <div style={{ height: 2200, padding: 20 }}>Learner page scroll area</div>
      <div data-support-ui style={{ position: 'fixed', right: 16, bottom: 16, width: 300, height: 350 }}>
        <SupportChat id="learner-support-chat" peerName="Administrator" userId="learner" messages={messages} disabled={false} onSend={send} />
      </div>
    </>;
  }
  createRoot(document.getElementById('root')).render(location.search === '?learner'
    ? <Learner /> : <AdminLiveSupport session={session} learnerName="Test Learner" onClose={() => { window.adminClosed = true; }} />);
`
const server = await createServer({
  configFile: false,
  appType: 'custom',
  root: fileURLToPath(new URL('..', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  plugins: [react(), {
    name: 'local-support-relay',
    enforce: 'pre',
    resolveId(id) {
      if (id === './supportTransport') return '/__support-relay.js'
      if (id === '@/services/liveSupport' || /\/src\/services\/liveSupport(?:\.ts)?$/.test(id.replaceAll('\\', '/'))) return '/__support-rpc.js'
      if (id.startsWith('/__support-')) return id
    },
    load(id) {
      if (id === '/__support-relay.js') return relay
      if (id === '/__support-rpc.js') return rpc
      if (id === '/__support-entry.tsx') return entry
    },
  }],
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
  server: { host: '127.0.0.1', port: 0 },
})
server.middlewares.use('/support-controls', async (_request, response, next) => {
  try {
    response.setHeader('Content-Type', 'text/html')
    response.end(await server.transformIndexHtml('/support-controls', '<html><head><title>Live help test</title><style>html,body,#root{height:100%;overflow:auto;margin:0;font-family:Arial}*{box-sizing:border-box}.support-chat{height:100%}</style></head><body><div id="root"></div><script type="module" src="/__support-entry.tsx"></script></body></html>'))
  } catch (error) { next(error) }
})
let browser
try {
  await server.listen()
  const address = server.httpServer.address()
  assert(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}/support-controls`
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== new URL(base).origin) throw new Error(`Unexpected external request in local test: ${new URL(route.request().url()).origin}`)
    return route.continue()
  })
  const learner = await context.newPage()
  const admin = await context.newPage()
  const browserErrors = []
  for (const page of [learner, admin]) page.on('pageerror', error => browserErrors.push(error.message))
  await learner.goto(`${base}?learner`)
  await learner.waitForFunction(() => window.publisherReady, undefined, { timeout: 15000 })
  await admin.goto(base)
  await admin.waitForFunction(() => document.querySelector('[data-testid="support-scroll-down"]')?.disabled === false, undefined, { timeout: 15000 })

  // Static screen capture runs out of future frames. It still has a current
  // image and a live session, so chat, scrolling and navigation must remain usable.
  await learner.evaluate(() => { window.pauseDrawing = true })
  await admin.waitForFunction(() => document.querySelector('video')?.readyState === HTMLMediaElement.HAVE_CURRENT_DATA)
  assert.equal(await admin.getByTestId('support-scroll-down').isDisabled(), false, 'Buffering disabled controls on a still page')

  await admin.getByTestId('admin-support-chat-input').fill('Hello learner <b>literal text</b>')
  await admin.getByTestId('admin-support-chat-send').click()
  await learner.getByTestId('learner-support-chat-messages').locator('[data-sender="peer"]').waitFor()
  assert.equal(await learner.getByTestId('learner-support-chat-messages').locator('[data-sender="peer"]').count(), 1)
  assert.equal(await learner.getByTestId('learner-support-chat-messages').locator('b').count(), 0)
  await learner.getByTestId('learner-support-chat-input').fill('Hello administrator')
  await learner.getByTestId('learner-support-chat-send').click()
  await admin.getByTestId('admin-support-chat-messages').locator('[data-sender="peer"]').waitFor()

  await admin.getByTestId('support-scroll-down').click()
  await learner.waitForFunction(() => document.getElementById('root').scrollTop > 0)
  await admin.getByTestId('support-scroll-up').click()
  await learner.waitForFunction(() => document.getElementById('root').scrollTop === 0)

  const viewport = admin.getByTestId('support-video-viewport')
  const before = await viewport.boundingBox()
  await admin.getByTestId('support-toggle-chat').click()
  const enlarged = await viewport.boundingBox()
  assert(enlarged.width > before.width + 250, 'Hiding chat did not enlarge the viewer')
  await admin.getByTestId('support-video-zoom').selectOption('2')
  assert(await viewport.evaluate(element => element.scrollWidth > element.clientWidth && element.scrollHeight > element.clientHeight), 'Zoom did not provide a pannable view')
  await viewport.evaluate(element => { element.scrollLeft = element.clientWidth / 2; element.scrollTop = element.clientHeight / 2 })
  const videoBox = await admin.getByTestId('admin-live-help-video').boundingBox()
  const clickStarted = Date.now()
  await admin.mouse.click(videoBox.x + videoBox.width / 2, videoBox.y + videoBox.height / 2)
  await learner.waitForFunction(() => window.targetClicks === 1)
  const clickLatencyMs = Date.now() - clickStarted
  assert(clickLatencyMs < 1500, 'Click waited behind old control messages')
  await admin.waitForFunction(() => document.querySelector('video')?.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA)

  await admin.getByTestId('support-video-zoom').selectOption('1')
  await viewport.evaluate(element => { element.scrollLeft = 0; element.scrollTop = 0 })
  const point = await admin.getByTestId('admin-live-help-video').evaluate(video => {
    const box = video.getBoundingClientRect()
    const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight)
    const width = video.videoWidth * scale, height = video.videoHeight * scale
    return { x: box.x + (box.width - width) / 2 + width * .1, y: box.y + (box.height - height) / 2 + height * .2 }
  })
  await admin.mouse.move(point.x, point.y)
  await admin.mouse.wheel(0, 220)
  await learner.waitForFunction(() => document.getElementById('nested').scrollTop > 0)
  assert.equal(await learner.locator('#root').evaluate(element => element.scrollTop), 0)
  assert.equal(await admin.getByTestId('admin-live-help').evaluate(element => element.scrollTop), 0)
  await admin.mouse.wheel(0, -220)
  await learner.waitForFunction(() => document.getElementById('nested').scrollTop === 0)

  await admin.getByTestId('support-fullscreen').click()
  await admin.waitForFunction(() => document.fullscreenElement?.getAttribute('data-testid') === 'admin-live-help')
  await admin.getByTestId('support-fullscreen').click()
  await admin.waitForFunction(() => !document.fullscreenElement)
  await admin.getByTestId('support-toggle-chat').click()
  await admin.setViewportSize({ width: 1024, height: 700 })
  const screenshot = join(tmpdir(), 'codesense-live-help-controls.png')
  await admin.screenshot({ path: screenshot })
  const layout = await admin.getByTestId('support-video-viewport').boundingBox()
  assert(layout.height > 400, 'Viewer is too short on a small monitor')
  assert(await admin.getByTestId('admin-end-live-help').isVisible())
  assert(await admin.getByTestId('admin-support-chat-send').isVisible())
  assert.deepEqual(browserErrors, [])
  assert.deepEqual(await learner.evaluate(() => window.testErrors), [])
  await admin.getByTestId('admin-end-live-help').click()
  await admin.waitForFunction(() => window.adminClosed === true)
  console.log(JSON.stringify({ stillScreenControls: true, clickLatencyMs, chatBothDirections: true, retryDeduplication: true, rootAndNestedScrolling: true, zoomedClick: true, fullscreen: true, smallMonitorViewer: layout, screenshot }))
} catch (error) {
  if (browser) {
    for (const page of browser.contexts()[0].pages()) {
      console.error(JSON.stringify({ url: page.url(), diagnostic: await page.evaluate(() => ({ errors: window.testErrors, clicks: window.targetClicks, alerts: [...document.querySelectorAll('[role="alert"]')].map(element => element.textContent), rootScroll: document.getElementById('root')?.scrollTop, center: document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.outerHTML.slice(0, 350) })) }))
    }
  }
  throw error
} finally {
  if (browser) await browser.close()
  await server.close()
}
