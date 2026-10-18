import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'

const rootPath = fileURLToPath(new URL('../', import.meta.url))
const server = await createServer({ root: rootPath, server: { middlewareMode: true }, appType: 'custom' })
after(() => server.close())
const { generateQuestDraftFromText } = await server.ssrLoadModule('/src/admin/questAutoGenerator.ts')
const { defaultQF, questPreviewFromForm } = await server.ssrLoadModule('/src/admin/adminPanelModel.ts')
const { validateQuestBuilderForm, serializeHints, loadHintsForEdit } = await server.ssrLoadModule('/src/admin/adminHelpers.ts')
const { extractCodeExcerpts } = await server.ssrLoadModule('/src/admin/questCodeSource.ts')
const { TheoryProse } = await server.ssrLoadModule('/src/components/TheoryProse.tsx')
const { BalloonPopGame } = await server.ssrLoadModule('/src/games/BalloonPopGame.tsx')
const { composeHints } = await server.ssrLoadModule('/src/campaign/composeHints.ts')
const { generateAutoHints } = await server.ssrLoadModule('/src/campaign/generateAutoHints.ts')
const { generateQuestHintRows } = await server.ssrLoadModule('/src/admin/questHints.ts')

const richTopics = [
  { heading: 'Values and Types', definitions: ['An integer is a data type for whole numbers.', 'A decimal is a numeric value with a fractional part.', 'A boolean is a data type with true or false values.', 'A character is a single text symbol.'], code: 'int score = 10;' },
  { heading: 'Arrays and Positions', definitions: ['An array is a collection of values with the same data type.', 'An element is one value stored in an array.', 'An index is the position of an element in an array.', 'A capacity is the number of elements available in a collection.'], code: 'int values[4] = {2, 4, 6, 8};', steps: ['Declare the array.', 'Initialize its elements.', 'Read an element by index.'] },
  { heading: 'Memory and Addresses', definitions: ['A pointer is a variable that stores a memory address.', 'A reference is an alias for an existing variable.', 'An address is a location of an object in memory.', 'A dereference is an operation that accesses a value through an address.'], code: 'int offset = 0;' },
  { heading: 'Loops and Conditions', definitions: ['A loop is a control structure that repeats a block of code.', 'A condition is an expression with a true or false result.', 'A counter is a variable that tracks repetitions.', 'An iteration is one execution of a repeated block.'], code: 'void repeat() {\n  for (int i = 0; i < 4; i++) {\n    cout << i;\n  }\n}' },
  { heading: 'Functions and Calls', definitions: ['A function is a reusable group of instructions.', 'A parameter is an input named in a function declaration.', 'An argument is a value supplied to a function call.', 'A return value is a result sent back to the caller.'], code: 'int add(int left, int right) { return left + right; }', steps: ['Declare the function.', 'Supply the arguments.', 'Read its result.'] },
  { heading: 'Input and Output', definitions: ['An input is data supplied to a program.', 'An output is data produced by a program.', 'A stream is a sequence of data transferred between a program and a device.', 'A buffer is a temporary area for transferred data.'], code: 'cout << score;' },
  { heading: 'Expressions and Statements', definitions: ['An assignment is an operation that gives a variable a value.', 'A comparison is an operation that tests a relation between values.', 'An expression is a combination of values and operations that produces a result.', 'A statement is a complete instruction in a program.'], code: 'int total = 2 + 3;' },
  { heading: 'Scope and Names', definitions: ['A scope is a region where a name can be used.', 'A variable is a named storage location whose value can change.', 'A constant is a value that remains unchanged during execution.', 'A namespace is a named group of related identifiers.'], code: 'const int maxCount = 6;' },
]
const richLesson = `Programming Review\n${richTopics.map(topic => `${topic.heading}\n${topic.definitions.map(definition => `• ${definition}`).join('\n')}\n${(topic.steps ?? []).map((step, index) => `${index + 1}. ${step}`).join('\n')}\n${topic.code}`).join('\n\n')}`

const arrayLesson = `Arrays Tutorial
Overview
• An array is a collection of values with the same data type.
• An element is one value stored in an array.
• An index is the position of an element in an array.
• A pointer is a variable that stores a memory address.
Syntax (Structure)
int numbers[3] = {10, 20, 30};
Accessing Array Elements
The first element is accessed with index zero.
cout << numbers[0];
Function Example
void display(int values[3]) {
  for (int i = 0; i < 3; i++) {
    cout << values[i] << "; // preserve this string";
  }
}
Summary
Arrays store related values together. Use an index to read an element.`

test('an array lesson generates all five valid activities with code beside its explanation', () => {
  const draft = generateQuestDraftFromText(arrayLesson, 'arrays.pdf')
  assert.deepEqual([draft.act_mc, draft.act_balloon, draft.act_drag, draft.act_ordering, draft.act_codefill], [true, true, true, true, true])
  assert.deepEqual(validateQuestBuilderForm({ ...defaultQF(), ...draft }), { ok: true, errors: [] })
  const sections = draft.theory_sections
  const declaration = sections.findIndex(section => section.code.startsWith('int numbers'))
  const explanation = sections.findIndex(section => section.body.includes('index zero'))
  assert.ok(declaration > 0 && declaration < explanation)
  assert.ok(sections.some(section => section.code.includes('"; // preserve this string"')))
  for (const item of draft.code_fill_items) {
    assert.ok(sections.some(section => section.code === item.code_lines.replace('___', item.answers)))
  }
  for (const question of draft.balloon_questions) {
    assert.deepEqual(question.correctAnswers, [question.correct])
    assert.ok(arrayLesson.includes(question.explanation))
  }
  assert.equal(draft.drag_problems[0].items.filter(item => /^arrays?$/i.test(item.label)).length, 1)
})

test('numbered lesson lists generate ordering without a special procedure heading', () => {
  const source = `${arrayLesson}\nPractice\n1. Declare the array.\n2. Initialize the values.\n3. Read a value by index.`
  const draft = generateQuestDraftFromText(source, 'arrays.pdf')
  assert.deepEqual(draft.ordering_problems[0].items.map(item => item.label), ['Declare the array.', 'Initialize the values.', 'Read a value by index.'])
})

test('prose lessons generate the supported games without fabricating code or question-word definitions', () => {
  const source = `Array Basics\n${arrayLesson.split('Overview\n')[1].split('Syntax (Structure)')[0]}\nWhat is the position of an element?\nWhich of the following is an array?`
  const draft = generateQuestDraftFromText(source, 'arrays.pdf')
  assert.equal(draft.act_balloon, true)
  assert.equal(draft.act_ordering, true)
  assert.equal(draft.act_codefill, false)
  assert.deepEqual(draft.code_fill_items, [])
  assert.ok(draft.drag_problems[0].items.every(item => !/^(?:what|which)\b/i.test(item.label)))
})

test('code extraction handles short examples, standalone functions, and literal punctuation', () => {
  const source = 'The program\'s declarations\n• string names[2] = {"a; // b", "c"}; • int count = 2;\nExplanation stays here.\nvoid show() { cout << "{}"; }\nMore explanation.'
  const excerpts = extractCodeExcerpts(source)
  assert.deepEqual(excerpts.map(item => item.code), ['string names[2] = {"a; // b", "c"};', 'int count = 2;', 'void show() { cout << "{}"; }'])
  assert.ok(excerpts.every(item => source.slice(item.start, item.end).trim() === item.code))
  assert.throws(() => extractCodeExcerpts('int main() { cout << "text";'), /incomplete/)
})

test('theory rendering creates lists, paragraphs, and safe inline code from imported text', () => {
  const html = renderToStaticMarkup(React.createElement(TheoryProse, { text: 'An array stores related values.\n\n• Use `numbers[0]`. • Keep the index in range.\n\n1. Declare it.\n2. Read it.\n\n<script>alert(1)</script>' }))
  const dom = new JSDOM(html)
  assert.equal(dom.window.document.querySelectorAll('ul li').length, 2)
  assert.equal(dom.window.document.querySelectorAll('ol li').length, 2)
  assert.equal(dom.window.document.querySelector('code').textContent, 'numbers[0]')
  assert.equal(dom.window.document.querySelectorAll('p').length, 2)
  assert.equal(dom.window.document.querySelector('script'), null)
  dom.window.close()
})

test('rich material increases practice across all games and covers the last topics as well as the first', () => {
  const short = generateQuestDraftFromText(arrayLesson, 'arrays.pdf')
  const rich = generateQuestDraftFromText(richLesson, 'review.pdf')
  assert.ok(rich.mc_questions.length > short.mc_questions.length)
  assert.ok(rich.balloon_questions.length > short.balloon_questions.length)
  assert.ok(rich.drag_problems.length > short.drag_problems.length)
  assert.ok(rich.ordering_problems.length > short.ordering_problems.length)
  assert.ok(rich.code_fill_items.length > short.code_fill_items.length)
  assert.deepEqual(validateQuestBuilderForm({ ...defaultQF(), ...rich }), { ok: true, errors: [] })
  for (const topic of richTopics) {
    assert.ok(rich.mc_questions.some(question => question.question.includes(topic.heading)), topic.heading)
    assert.ok(rich.balloon_questions.some(question => question.question.includes(topic.heading)), topic.heading)
  }
  assert.equal(new Set(rich.mc_questions.map(question => question.question)).size, rich.mc_questions.length)
  assert.ok(rich.mc_questions.some(question => question.question.includes('situation')))
  assert.ok(rich.mc_questions.some(question => question.question.includes('___') && question.question.includes('int ')))
  assert.ok(rich.mc_questions.length <= 48 && rich.balloon_questions.length <= 32 && rich.code_fill_items.length <= 40)
})

test('code practice targets different roles and every answer restores an unchanged source example', () => {
  const draft = generateQuestDraftFromText(richLesson, 'review.pdf')
  const arrayItems = draft.code_fill_items.filter(item => item.code_lines.includes('values['))
  assert.ok(arrayItems.length >= 3)
  assert.ok(new Set(arrayItems.map(item => item.answers)).size >= 3)
  for (const item of draft.code_fill_items) {
    assert.equal(item.code_lines.split('___').length - 1, 1)
    assert.ok(richLesson.includes(item.code_lines.replace('___', item.answers)))
    assert.ok(item.hint.trim().length > 50)
  }
})

test('generated hints remain scoped and distinct through admin serialization and learner composition', () => {
  const draft = generateQuestDraftFromText(richLesson, 'review.pdf')
  const stored = serializeHints(draft.hints)
  assert.deepEqual(serializeHints(loadHintsForEdit(stored)), stored)
  const target = draft.mc_questions.findIndex(question => question.question.includes(richTopics.at(-1).heading))
  assert.ok(target >= 0)
  const hints = composeHints(stored, 'mc', draft.mc_questions[target].hint, target)
  assert.equal(hints.length, 3)
  assert.equal(new Set(hints.map(hint => hint.body)).size, 3)
  assert.ok(hints.every(hint => hint.item_index === undefined || hint.item_index === target))
  assert.ok(stored.some(hint => hint.activity === 'mc' && hint.item_index === draft.mc_questions.length - 1))
  assert.ok(stored.some(hint => hint.activity === 'balloon' && hint.item_index === draft.balloon_questions.length - 1))
})

test('the hint action handles every puzzle and uses the current drag and ordering groups', () => {
  const draft = generateQuestDraftFromText(richLesson, 'review.pdf')
  const form = { ...defaultQF(), ...draft }
  const preview = questPreviewFromForm(form)
  const rows = generateQuestHintRows(form, 'test_hint')
  for (const [activity, count] of [['mc', draft.mc_questions.length], ['balloon', draft.balloon_questions.length], ['drag', draft.drag_problems.length], ['ordering', draft.ordering_problems.length], ['code_fill', draft.code_fill_items.length]]) {
    for (let index = 0; index < count; index++) assert.equal(rows.filter(row => row.activity === activity && row._extra.item_index === index).length, 3)
  }
  const dragHints = generateAutoHints(preview, 'drag', 1)
  assert.ok(dragHints.every(hint => hint.item_index === 1))
  assert.ok(dragHints.some(hint => hint.body.includes(draft.drag_problems[1].items[0].label)))
  assert.notDeepEqual(dragHints.map(hint => hint.body), generateAutoHints(preview, 'drag', 0).map(hint => hint.body))
  const orderingHints = generateAutoHints(preview, 'ordering', 1)
  const items = draft.ordering_problems[1].items
  const middle = Math.floor(items.length / 2)
  const anchor = orderingHints.at(-1).body
  assert.ok(anchor.indexOf(items[middle - 1].label) < anchor.indexOf(items[middle].label))
  assert.ok(orderingHints.every(hint => hint.item_index === 1))
})

test('duplicating source pages does not create duplicate practice content', () => {
  const procedure = `${arrayLesson}\nPractice\n1. Declare the array.\n2. Initialize the values.\n3. Read a value by index.`
  for (const source of [richLesson, procedure]) {
    const original = generateQuestDraftFromText(source, 'review.pdf')
    const repeated = generateQuestDraftFromText(`${source}\n${source}`, 'review.pdf')
    for (const key of ['mc_questions', 'balloon_questions', 'drag_problems', 'ordering_problems', 'code_fill_items']) assert.equal(repeated[key].length, original[key].length, key)
    for (const key of ['drag_problems', 'ordering_problems']) {
      assert.equal(new Set(repeated[key].map(problem => JSON.stringify(problem.items.map(item => item.label)))).size, repeated[key].length)
    }
  }
})

test('Balloon Pop keeps progress through rerenders and resize, completes once with the latest callback, and resets explicitly', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const frames = new Map()
  const observers = new Set()
  let frameId = 0
  let now = performance.now()
  let width = 400
  let origin = { x: 0, y: 0 }
  let centers = []
  const stack = []
  const gradient = { addColorStop() {} }
  // Only the graphics surface is substituted; React state, effects, events, and completion run together.
  const context = {
    setTransform() {}, clearRect() { centers = [] }, createLinearGradient() { return gradient }, createRadialGradient() { return gradient },
    fillRect() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, quadraticCurveTo() {}, stroke() {}, fillText() {},
    measureText(value) { return { width: value.length * 5 } },
    save() { stack.push({ ...origin }) }, restore() { origin = stack.pop() },
    translate(x, y) { origin = { x: origin.x + x, y: origin.y + y } },
    ellipse() { centers.push({ ...origin }) },
  }
  const previousGlobals = new Map()
  const globals = {
    window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId },
    cancelAnimationFrame(id) { frames.delete(id) },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback }
      observe() { observers.add(this) }
      disconnect() { observers.delete(this) }
    },
  }
  for (const [key, value] of Object.entries(globals)) {
    previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  Object.defineProperties(dom.window.HTMLCanvasElement.prototype, {
    getContext: { value: () => context },
    offsetWidth: { get: () => width }, offsetHeight: { get: () => 300 },
  })
  const root = createRoot(dom.window.document.getElementById('root'))
  const questions = [
    { id: 'q1', question: 'Choose both correct answers.', options: ['Array', 'Element', 'Loop', 'Function'], correct: 0, correctAnswers: [0, 1], explanation: 'Both match the lesson.' },
    { id: 'q2', question: 'Choose the position term.', options: ['Index', 'Loop'], correct: 0, explanation: 'An index is a position.' },
  ]
  const initialCompletions = []
  const latestCompletions = []
  const advance = (count) => {
    for (let index = 0; index < count; index++) {
      now += 50
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach(callback => callback(now))
    }
  }
  const clickBalloon = (index) => {
    const center = centers[index]
    assert.ok(center, `Balloon ${index} must be drawn before selecting it.`)
    dom.window.document.querySelector('[data-testid="balloon-canvas"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: center.x, clientY: center.y }))
  }
  try {
    await act(async () => root.render(React.createElement(BalloonPopGame, { questions, resetSignal: 1, onComplete: (...result) => initialCompletions.push(result) })))
    await act(async () => advance(2))
    await act(async () => { clickBalloon(1); advance(1) })
    assert.equal(centers.length, 3)
    width = 600
    await act(async () => { observers.forEach(observer => observer.callback()); advance(1) })
    assert.equal(centers.length, 3, 'Resizing must not respawn a popped answer.')
    await act(async () => { clickBalloon(0); advance(60) })
    assert.equal(dom.window.document.querySelector('[data-testid="balloon-game"]').dataset.questionIndex, '1')
    await act(async () => root.render(React.createElement(BalloonPopGame, { questions: structuredClone(questions), resetSignal: 1, onComplete: (...result) => latestCompletions.push(result) })))
    assert.equal(dom.window.document.querySelector('[data-testid="balloon-game"]').dataset.questionIndex, '1')
    await act(async () => { advance(1); clickBalloon(0); advance(60); await new Promise(resolve => setTimeout(resolve, 450)) })
    assert.deepEqual(initialCompletions, [])
    assert.deepEqual(latestCompletions, [[2, 2]])
    await act(async () => advance(80))
    assert.deepEqual(latestCompletions, [[2, 2]])
    await act(async () => root.render(React.createElement(BalloonPopGame, { questions, resetSignal: 2, onComplete: (...result) => latestCompletions.push(result) })))
    await act(async () => advance(2))
    const game = dom.window.document.querySelector('[data-testid="balloon-game"]')
    assert.equal(game.dataset.questionIndex, '0')
    assert.equal(game.dataset.phase, 'playing')
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
