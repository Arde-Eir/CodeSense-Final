import type { HintFormRow } from './adminHelpers'

export interface GeneratedQuestDraft {
  title: string
  description: string
  tutorial_title: string
  tutorial_body: string
  theory_sections: {
    id: string
    type: string
    heading: string
    body: string
    code: string
    language: string
    table_headers: string[]
    table_rows: string[][]
  }[]
  objectives: string[]
  act_mc: boolean
  act_drag: boolean
  act_balloon: boolean
  act_ordering: boolean
  act_codefill: boolean
  mc_questions: {
    id: string
    question: string
    options: [string, string, string, string]
    correct: number
    explanation: string
    hint: string
  }[]
  balloon_questions: {
    id: string
    question: string
    options: [string, string, string, string]
    correct: number
    correctAnswers: number[]
    explanation: string
    hint: string
  }[]
  drag_problems: {
    id: string
    question: string
    items: { id: string; label: string; color: string }[]
    drop_zones: { id: string; label: string; accepted: string }[]
  }[]
  ordering_problems: {
    id: string
    question: string
    items: { id: string; label: string; description: string }[]
  }[]
  code_fill_items: {
    id: string
    code_lines: string
    language: string
    answers: string
    hint: string
    caption: string
  }[]
  hints: HintFormRow[]
}

interface Concept {
  term: string
  definition: string
  sentence: string
}

interface OrderingItemDraft {
  label: string
  description: string
}

interface Section {
  heading: string
  body: string
  generated?: boolean
}

const uid = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

const cleanText = (text: string): string =>
  text
    .replace(/\u0000/g, ' ')
    .replace(/[•●▪]/g, '\n- ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const compact = (text: string): string =>
  text.replace(/\s+/g, ' ').trim()

const uniqueBy = <T,>(items: T[], keyOf: (item: T) => string): T[] => {
  const seen = new Set<string>()
  return items.filter(item => {
    const key = keyOf(item).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const sentenceSplit = (text: string): string[] =>
  cleanText(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => s.length >= 45 && s.length <= 260)

const titleCase = (value: string): string =>
  value
    .replace(/[-_]+/g, ' ')
    .replace(/\.[^.]+$/, '')
    .trim()
    .split(/\s+/)
    .map(word => word ? `${word[0].toUpperCase()}${word.slice(1)}` : word)
    .join(' ')

const stripToSentence = (value: string, max = 170): string => {
  const cleaned = compact(value)
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, max).replace(/\s+\S*$/, '')}...`
}

const isNoisySentence = (sentence: string): boolean => {
  const s = sentence.toLowerCase()
  return (
    s.length < 35 ||
    s.includes('tutorial guide') ||
    s.includes('learning material') ||
    s.startsWith('examples include') ||
    s.startsWith('example:') ||
    s.includes('m3 tutorial') ||
    s.includes('m4 tutorial') ||
    (sentence.match(/[<>#{};]/g)?.length ?? 0) >= 4
  )
}

const conciseDefinition = (term: string, sentence: string): string => {
  const fallbackDefinitions: Record<string, string> = {
    variable: 'Named storage for a value used by the program.',
    'data type': 'Tells C++ what kind of value a variable stores.',
    input: 'Data read by the program, usually with cin.',
    output: 'Information displayed by the program, usually with cout.',
    operator: 'A symbol that performs an operation on values.',
    condition: 'An expression that decides whether code runs.',
    loop: 'Repeats a block of code while a rule allows it.',
    function: 'A reusable named block of code.',
    array: 'Stores multiple same-type values under one name.',
    pointer: 'Stores the memory address of another value.',
    string: 'Stores a sequence of text characters.',
    integer: 'Stores whole-number values.',
    initialization: 'Gives a variable its starting value.',
    statement: 'A complete instruction C++ can execute.',
    expression: 'Produces a value from variables, values, or operators.',
  }

  const key = term.toLowerCase()
  if (fallbackDefinitions[key]) return fallbackDefinitions[key]

  const cleaned = stripToSentence(sentence, 130)
  if (!cleaned || isNoisySentence(cleaned)) {
    return `${term} is a key concept covered by this lesson material.`
  }
  return cleaned
}

const firstUsefulLine = (text: string, fileName: string): string => {
  const line = cleanText(text)
    .split('\n')
    .map(l => l.trim())
    .find(l => l.length >= 6 && l.length <= 90 && !/^\d+$/.test(l))
  return line ? titleCase(line.replace(/^#+\s*/, '')) : titleCase(fileName)
}

const extractCodeBlocks = (text: string): string[] => {
  const fenced = [...text.matchAll(/```(?:cpp|c\+\+|c)?\s*([\s\S]*?)```/gi)]
    .map(match => match[1].trim())
  const source = compact(text)
  const mainBlocks = [...source.matchAll(/(?:#include\s*<[^>]+>\s*)?(?:using\s+namespace\s+std;\s*)?int\s+main\s*\(\s*\)\s*\{[^}]{20,500}\}/gi)]
    .map(match => match[0].trim())
  const statements = [...source.matchAll(/(?:Example|Code|Snippet)\s*:\s*((?:int|double|float|char|bool|string)\s+[A-Za-z_]\w*(?:\s*=\s*[^;]{1,60})?;|(?:cout\s*<<|cin\s*>>)[^;]{1,90};|return\s+[^;]{1,60};)/gi)]
    .map(match => match[1].trim())
  return [...fenced, ...mainBlocks, ...statements]
    .map(block => block.replace(/\s*([{};])\s*/g, '$1\n').replace(/\n{2,}/g, '\n').trim())
    .filter(block => block.length >= 8 && block.length <= 520)
    .filter(block => /;|#include|int\s+main\s*\(/.test(block))
    .filter((block, index, arr) => arr.indexOf(block) === index)
    .slice(0, 2)
}

const splitIntoSections = (text: string): Section[] => {
  const lines = cleanText(text).split('\n').map(line => line.trim())
  const sections: Section[] = []
  let current: { heading: string; body: string[] } | null = null

  for (const line of lines) {
    if (!line) continue
    const looksHeading =
      line.length <= 80 &&
      (/^#{1,3}\s+/.test(line) || /^[A-Z][A-Za-z0-9 +#/()&-]{3,}:$/.test(line) || /^[0-9]+[.)]\s+[A-Z]/.test(line))

    if (looksHeading) {
      if (current && current.body.join(' ').trim()) {
        sections.push({ heading: current.heading, body: current.body.join('\n') })
      }
      current = { heading: line.replace(/^#{1,3}\s+/, '').replace(/:$/, '').replace(/^[0-9]+[.)]\s+/, ''), body: [] }
    } else if (current) {
      current.body.push(line)
    } else {
      current = { heading: 'Overview', body: [line] }
    }
  }

  if (current && current.body.join(' ').trim()) {
    sections.push({ heading: current.heading, body: current.body.join('\n') })
  }

  if (sections.length >= 2) return sections.slice(0, 6)

  const sentences = sentenceSplit(text)
  const chunks: Section[] = []
  for (let i = 0; i < sentences.length; i += 3) {
    const body = sentences.slice(i, i + 3).join(' ')
    if (body) chunks.push({ heading: i === 0 ? 'Overview' : `Key Idea ${chunks.length + 1}`, body, generated: true })
  }
  return chunks.slice(0, 6)
}

const CANDIDATE_TERMS = [
  'variable', 'data type', 'input', 'output', 'operator', 'condition', 'loop',
  'function', 'array', 'pointer', 'reference', 'memory', 'string', 'boolean',
  'integer', 'floating point', 'parameter', 'return value', 'scope', 'syntax',
  'algorithm', 'debugging', 'validation', 'initialization', 'comparison',
  'assignment', 'expression', 'statement', 'control flow',
]

const extractConcepts = (text: string): Concept[] => {
  const sentences = sentenceSplit(text).filter(sentence => !isNoisySentence(sentence))
  const concepts: Concept[] = []

  for (const term of CANDIDATE_TERMS) {
    const sentence = sentences.find(s => new RegExp(`\\b${term.replace(/\s+/g, '\\s+')}s?\\b`, 'i').test(s))
    if (sentence) {
      concepts.push({
        term: titleCase(term),
        sentence,
        definition: conciseDefinition(term, sentence),
      })
    }
  }

  const headingTerms = splitIntoSections(text)
    .filter(s => !s.generated)
    .map(s => s.heading)
    .filter(h => h.length >= 4 && h.length <= 36 && !/^overview$/i.test(h))

  for (const heading of headingTerms) {
    if (concepts.some(c => c.term.toLowerCase() === heading.toLowerCase())) continue
    const sentence = sentences.find(s => s.toLowerCase().includes(heading.toLowerCase().split(/\s+/)[0])) ?? ''
    concepts.push({
      term: titleCase(heading),
      sentence,
      definition: conciseDefinition(heading, sentence),
    })
  }

  return uniqueBy(concepts, concept => concept.term).slice(0, 8)
}

const makeDistractors = (correct: string, concepts: Concept[]): [string, string, string, string] => {
  const pool = uniqueBy([
    ...concepts.map(c => c.definition).filter(d => d !== correct && d.length <= 150),
    'It is only used to change the visual layout of source code.',
    'It disables all compiler checks for the current program.',
    'It is unrelated to how the program stores, evaluates, or controls data.',
    'It is a fixed rule that never depends on the surrounding code.',
  ].filter(Boolean), value => value)

  const options = [correct, ...pool].slice(0, 4)
  while (options.length < 4) options.push('It is a secondary detail, not the main concept described here.')
  return options as [string, string, string, string]
}

const extractOrderingItems = (text: string): OrderingItemDraft[] => {
  const source = compact(text)
  const flowMatch = source.match(/(?:correct\s+flow|correct\s+order|answer\s+key|steps?)\s*:?\s*((?:\d+[.)]\s*[^0-9]{2,80}\s*){3,8})/i)
  const flowText = flowMatch?.[1] ?? ''
  const numberedItems = [...flowText.matchAll(/\d+[.)]\s*([^0-9.]{2,80})(?=\s+\d+[.)]|$)/g)]
    .map(match => match[1].replace(/[-–—]\s*$/, '').trim())
    .filter(Boolean)

  if (numberedItems.length >= 3) {
    return uniqueBy(numberedItems, item => item)
      .slice(0, 5)
      .map(item => ({
        label: stripToSentence(item, 44),
        description: 'Step from the PDF answer key.',
      }))
  }

  const arrangeMatch = source.match(/Arrange\s*:?\s*((?:[-–—]\s*[^-–—]{2,60}\s*){3,8})/i)
  const arrangeText = arrangeMatch?.[1] ?? ''
  const arranged = [...arrangeText.matchAll(/[-–—]\s*([^-–—]{2,60})/g)]
    .map(match => match[1].trim())
    .filter(Boolean)

  if (arranged.length >= 3 && /correct\s+flow|correct\s+order/i.test(source)) {
    return uniqueBy(arranged, item => item)
      .slice(0, 5)
      .map(item => ({
        label: stripToSentence(item, 44),
        description: 'Ordered item from the PDF activity.',
      }))
  }

  return []
}

const makeCodeFill = (code: string) => {
  const candidates = ['int', 'double', 'float', 'char', 'bool', 'string', 'for', 'while', 'if', 'return', 'cout', 'cin']
  let answer = candidates.find(token => new RegExp(`\\b${token}\\b`).test(code))
  if (!answer) answer = code.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/)?.[0]
  if (!answer) return null
  return {
    id: uid('cf'),
    code_lines: code.replace(new RegExp(`\\b${answer}\\b`), '___'),
    language: 'cpp',
    answers: answer,
    hint: `Look for the token that completes the ${answer === 'return' ? 'program result' : 'C++ statement'}.`,
    caption: 'Complete the C++ snippet from the uploaded material',
  }
}

export async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
  ).toString()

  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data }).promise
  const pages: string[] = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    pages.push(content.items.map((item: any) => item.str ?? '').join(' '))
  }

  return cleanText(pages.join('\n\n'))
}

export function generateQuestDraftFromText(text: string, fileName: string): GeneratedQuestDraft {
  const source = cleanText(text).slice(0, 24000)
  const title = firstUsefulLine(source, fileName)
  const sections = splitIntoSections(source)
  const concepts = extractConcepts(source)
  const codeBlocks = extractCodeBlocks(source)
  const summarySentences = sentenceSplit(source).slice(0, 2)
  const overview = summarySentences.join(' ') || sections[0]?.body || `Generated from ${fileName}.`

  const objectives = (concepts.length ? concepts.slice(0, 4) : sections.slice(0, 4)).map(item => {
    const term = 'term' in item ? item.term : item.heading
    return `Explain ${term.toLowerCase()} using the uploaded learning material`
  })

  const theorySections = sections.map(section => ({
    id: uid('th'),
    type: 'default',
    heading: section.heading,
    body: stripToSentence(section.body, 620),
    code: '',
    language: 'cpp',
    table_headers: [],
    table_rows: [[]],
  }))

  for (const code of codeBlocks) {
    theorySections.push({
      id: uid('th_code'),
      type: 'code',
      heading: 'Code Example',
      body: '',
      code,
      language: 'cpp',
      table_headers: [],
      table_rows: [[]],
    })
  }

  const quizConcepts = concepts.length >= 3 ? concepts.slice(0, 5) : [
    ...concepts,
    ...sections.slice(0, 5).map(section => ({
      term: section.heading,
      definition: stripToSentence(section.body, 145),
      sentence: section.body,
    })),
  ].slice(0, 5)

  const mcQuestions = quizConcepts.map((concept, index) => ({
    id: `auto_mc_${index + 1}`,
    question: `Based on the uploaded material, which statement best describes ${concept.term}?`,
    options: makeDistractors(concept.definition, concepts),
    correct: 0,
    explanation: concept.definition,
    hint: `Review the section or sentence that mentions ${concept.term}.`,
  }))

  const dragConcepts = quizConcepts.slice(0, 4)
  const dragItems = dragConcepts.map((concept, index) => ({
    id: `auto_drag_${index + 1}`,
    label: concept.term,
    color: ['#4caf50', '#58a6ff', '#e3b341', '#f85149'][index % 4],
  }))
  const dropZones = dragConcepts.map((concept, index) => ({
    id: `auto_zone_${index + 1}`,
    label: concept.definition,
    accepted: dragItems[index]?.id ?? '',
  }))

  const orderingSourceItems = extractOrderingItems(source)
  const orderingItems = orderingSourceItems.map((item, sectionIndex) => ({
    id: `auto_order_${sectionIndex + 1}`,
    label: item.label,
    description: item.description,
  }))

  const codeFill = codeBlocks
    .map(makeCodeFill)
    .filter((item): item is NonNullable<ReturnType<typeof makeCodeFill>> => Boolean(item))

  const hints: HintFormRow[] = [
    ...objectives.slice(0, 2).map((objective, index) => ({
      id: uid('h'),
      title: `Objective ${index + 1}`,
      body: objective,
      icon: '',
      activity: 'all' as const,
      _extra: {},
    })),
    ...quizConcepts.slice(0, 2).map(concept => ({
      id: uid('h_mc'),
      title: concept.term,
      body: concept.definition,
      icon: '',
      activity: 'mc' as const,
      _extra: {},
    })),
  ]

  return {
    title,
    description: stripToSentence(overview, 150),
    tutorial_title: title,
    tutorial_body: stripToSentence(overview, 360),
    theory_sections: theorySections.length ? theorySections : [{
      id: uid('th'),
      type: 'default',
      heading: 'Overview',
      body: stripToSentence(source, 620),
      code: '',
      language: 'cpp',
      table_headers: [],
      table_rows: [[]],
    }],
    objectives: objectives.length ? objectives : [`Understand the key ideas from ${title}`],
    act_mc: mcQuestions.length > 0,
    act_drag: dragItems.length >= 2,
    act_balloon: false,
    act_ordering: orderingItems.length >= 3,
    act_codefill: codeFill.length > 0,
    mc_questions: mcQuestions.length ? mcQuestions : [{
      id: 'auto_mc_1',
      question: `What is the main idea of ${title}?`,
      options: [
        stripToSentence(overview, 120),
        'The material is unrelated to C++ programming.',
        'The material only describes user interface styling.',
        'The material only lists random terms without meaning.',
      ],
      correct: 0,
      explanation: stripToSentence(overview, 160),
      hint: 'Use the lesson overview from the uploaded PDF.',
    }],
    balloon_questions: [{ id: 'b1', question: '', options: ['', '', '', ''], correct: 0, correctAnswers: [0], explanation: '', hint: '' }],
    drag_problems: [{
      id: uid('dp'),
      question: 'Match each concept from the PDF to the best description.',
      items: dragItems,
      drop_zones: dropZones,
    }],
    ordering_problems: [{
      id: uid('op'),
      question: 'Arrange the lesson ideas in the order they appear in the uploaded material.',
      items: orderingItems,
    }],
    code_fill_items: codeFill,
    hints,
  }
}
