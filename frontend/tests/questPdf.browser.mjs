import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

// Native PDF upload -> PDF.js worker -> generator -> existing save validation.
// Chromium creates real text and image-only PDFs; no extraction/worker mocks.
const server = await createServer({ configFile: false, appType: 'custom', root: fileURLToPath(new URL('..', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 0 }, optimizeDeps: { noDiscovery: true, include: ['pdfjs-dist'] } })
server.middlewares.use('/quest-pdf-test', (_request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end(`<input id="pdf-file" type="file" accept="application/pdf"><script type="module">
    import { extractTextFromPdf, generateQuestDraftFromText } from '/src/admin/questAutoGenerator.ts';
    import { validateQuestBuilderForm } from '/src/admin/adminHelpers.ts';
    document.getElementById('pdf-file').onchange = async event => {
      window.pdfResult = null;
      try {
        const file = event.target.files[0];
        const text = await extractTextFromPdf(file);
        const draft = generateQuestDraftFromText(text, file.name);
        window.pdfResult = { text, draft, validation: validateQuestBuilderForm({ ...draft, basexp: 100, requiredxp: 0 }) };
      } catch (error) { window.pdfResult = { error: error.message }; }
      event.target.value = '';
    };
    window.pdfReady = true;
  </script>`)
})
let browser
try {
  await server.listen()
  const address = server.httpServer.address()
  assert(address && typeof address !== 'string')
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const code = '#include <iostream>\nint main() {\n  for (int i = 0; i < 3; i++) {\n    if (i > 0) {\n      std::cout << "http://test.local; { }";\n    }\n  }\n  return 0;\n}'
  const escapedCode = code.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  await page.setContent(`<style>body { font: 15px Arial; } h1 { font-size:24px } pre { font:14px monospace; white-space:pre } .page { break-before: page }</style>
    <h1>C++ Input and Output</h1>
    <p>Input:</p><p>Input is data received by the program from a user or another source.</p>
    <p>Output:</p><p>Output is information the program displays to the user.</p>
    <p>Variables:</p><p>A variable is named storage for a value used by the program.</p>
    <p>Operators:</p><p>An operator is a symbol that performs an operation on values.</p>
    <section class="page"><h1>C++ Example</h1><pre>${escapedCode}</pre>
    <p>Correct order:</p><div>1. Initialize the result to 0</div><div>2. Read 2 input values</div><div>3. Display the result</div>
    <p>Final note: This content from the last page must remain in the generated lesson.</p></section>`)
  const pdf = await page.pdf({ format: 'A4', margin: { top: '30px', bottom: '30px', left: '30px', right: '30px' } })
  await page.setContent('<canvas id="scan" width="600" height="300"></canvas>')
  await page.evaluate(() => { const context = document.getElementById('scan').getContext('2d'); context.font = '24px sans-serif'; context.fillText('Scanned lesson text stored as pixels', 20, 50) })
  const scan = await page.pdf({ format: 'A4' })
  const origin = `http://127.0.0.1:${address.port}`
  await page.route('**/*', route => {
    assert.equal(new URL(route.request().url()).origin, origin, 'PDF generation contacted an external service')
    return route.continue()
  })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/quest-pdf-test`)
  await page.waitForFunction(() => window.pdfReady, undefined, { timeout: 15000 })
  const upload = async (name, buffer) => {
    await page.evaluate(() => { window.pdfResult = null })
    await page.locator('#pdf-file').setInputFiles({ name, mimeType: 'application/pdf', buffer })
    await page.waitForFunction(() => window.pdfResult, undefined, { timeout: 20000 })
    return page.evaluate(() => window.pdfResult)
  }
  const generated = await upload('lesson.pdf', pdf)
  assert(!generated.error, generated.error)
  assert.deepEqual(generated.validation, { ok: true, errors: [] })
  assert.equal(generated.draft.title, 'C++ Input and Output')
  assert.equal(generated.draft.mc_questions.length, 4)
  assert.equal(generated.draft.code_fill_items.length, 1)
  const restored = generated.draft.code_fill_items[0].code_lines.replace('___', generated.draft.code_fill_items[0].answers)
  assert.equal(restored.replace(/\s+/g, ' '), code.replace(/\s+/g, ' '))
  assert.equal(generated.draft.ordering_problems[0].items.length, 3)
  assert(generated.draft.theory_sections.some(section => section.body.includes('content from the last page')))
  const scanned = await upload('scanned.pdf', scan)
  assert.match(scanned.error, /OCR/)
  const damaged = await upload('damaged.pdf', Buffer.from('%PDF-1.7\nThis is damaged'))
  assert.match(damaged.error, /invalid|damaged/i)
  const tooLarge = await upload('too-large.pdf', Buffer.alloc(10 * 1024 * 1024 + 1))
  assert.match(tooLarge.error, /10 MB/)
  const repeated = await upload('lesson.pdf', pdf)
  assert.deepEqual(repeated.draft, generated.draft, 'Re-upload should produce the same answer keys without leftover worker state')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ realPdfUpload: true, pages: 2, quizzes: generated.draft.mc_questions.length, nestedCppPreserved: true, sourceOrdering: true, scannedRejected: true, malformedRejected: true, sizeLimit: true, repeatable: true }))
} finally {
  if (browser) await browser.close()
  await server.close()
}
