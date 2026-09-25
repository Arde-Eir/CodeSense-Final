import type { QuestFormState, QFormTheory, QFormMCQ } from './adminPanelModel'
import { MAX_PDF_TEXT_LENGTH } from './pdfText'
import { extractCodeExcerpts, makeCodeBlank } from './questCodeSource'
export { extractTextFromPdf } from './pdfText'

export type GeneratedQuestDraft = Pick<QuestFormState,
  'title' | 'description' | 'tutorial_title' | 'tutorial_body' | 'theory_sections' | 'objectives' |
  'act_mc' | 'act_drag' | 'act_balloon' | 'act_ordering' | 'act_codefill' |
  'mc_questions' | 'balloon_questions' | 'drag_problems' | 'ordering_problems' | 'code_fill_items' | 'hints'>

interface Concept { term: string; sentence: string; prompt: string }
interface Section { heading: string; body: string }

const compact = (text: string): string => text.replace(/\s+/g, ' ').trim()
const cleanText = (text: string): string => text.replace(/\r\n?/g, '\n').replaceAll(String.fromCharCode(0), '').trim()
const excerpt = (text: string, max: number): string => {
  const value = compact(text)
  return value.length <= max ? value : `${value.slice(0, max).replace(/\s+\S*$/, '')}…`
}
const sentences = (text: string): string[] => text.split(/\n\s*\n|(?<=[.!?])\s+/).map(compact).filter(Boolean)
const headingPattern = /^(?:#{1,3}\s+.+|[A-Z][A-Za-z0-9 +#/()&-]{3,}:|\d+[.)]\s+[A-Z][^.!?;]{2,70})$/

const sectionsFromText = (text: string): Section[] => {
  const sections: Section[] = []
  let heading = 'Overview'
  let lines: string[] = []
  const sourceLines = text.split('\n')
  for (let index = 0; index < sourceLines.length; index++) {
    const line = sourceLines[index]
    const trimmed = line.trim()
    const following = (sourceLines[index + 1] ?? '').trim().replace(/^(?:A|An|The)\s+/i, '').toLowerCase()
    const definitionHeading = /^[A-Za-z][A-Za-z +#/-]{2,60}$/.test(trimmed) && following.startsWith(`${trimmed.toLowerCase()} `)
    if (headingPattern.test(trimmed) || definitionHeading || TERMS.some(term => new RegExp(`^${term}s?$`, 'i').test(trimmed))) {
      if (lines.some(item => item.trim())) sections.push({ heading, body: lines.join('\n').trim() })
      heading = trimmed.replace(/^#{1,3}\s+|^\d+[.)]\s+/g, '').replace(/:$/, '')
      lines = []
    } else lines.push(line)
  }
  if (lines.some(item => item.trim())) sections.push({ heading, body: lines.join('\n').trim() })
  return sections
}

const TERMS = [
  'variable', 'data type', 'input', 'output', 'operator', 'condition', 'loop',
  'function', 'array', 'pointer', 'reference', 'memory', 'string', 'boolean',
  'integer', 'floating point', 'parameter', 'return value', 'scope', 'syntax',
  'algorithm', 'debugging', 'validation', 'initialization', 'comparison',
  'assignment', 'expression', 'statement', 'control flow',
]

/** Only explicit source definitions become answer keys; a mention is insufficient. */
const conceptsFromSections = (sections: Section[]): Concept[] => {
  const concepts: Concept[] = []
  for (const section of sections) {
    for (const sentence of sentences(section.body)) {
      if (sentence.length > 350 || /[{};]|#include/.test(sentence)) continue
      const match = /^(?:(?:A|An|The)\s+)?([A-Za-z][A-Za-z0-9_:+#/-]*(?:\s+[A-Za-z][A-Za-z0-9_+#/-]*){0,3}?)\s+(?:is|are|means|refers? to|stores?|holds?|represents?)\b/i.exec(sentence)
      if (!match || /^(?:this|that|these|those|it|they|we|you|there|here|following)\b/i.test(match[1])) continue
      // Negated definitions do not establish what the term means.
      if (/\b(?:not|never|isn't|aren't)\b/i.test(sentence)) continue
      const term = match[1]
      if (concepts.some(concept => concept.term.toLowerCase() === term.toLowerCase())) continue
      const offset = match[0].toLowerCase().indexOf(term.toLowerCase())
      const prompt = sentence.slice(0, offset) + '___' + sentence.slice(offset + term.length)
      concepts.push({ term, sentence, prompt })
    }
  }
  // Identical prompts for different terms would create ambiguous answer keys.
  return concepts.filter(concept => concepts.filter(item => item.prompt.toLowerCase() === concept.prompt.toLowerCase()).length === 1)
}

/** Only explicitly ordered, consecutive numbered steps establish a solution. */
const orderingFromText = (text: string): string[] => {
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index++) {
    if (!/^\s*(?:correct\s+(?:flow|order)|answer\s+key|steps|procedure)\s*:\s*$/i.test(lines[index])) continue
    const items: string[] = []
    let consecutive = true
    for (let next = index + 1; next < lines.length; next++) {
      if (!lines[next].trim()) { if (items.length) break; else continue }
      const match = /^\s*(\d+)[.)]\s+(.+)$/.exec(lines[next])
      if (!match) break
      if (Number(match[1]) !== items.length + 1) { consecutive = false; break }
      items.push(match[2].trim())
    }
    if (consecutive && items.length >= 3 && new Set(items).size === items.length) return items
  }
  return []
}

const quizFromConcepts = (concepts: Concept[]): QFormMCQ[] => {
  if (concepts.length < 4) return []
  return concepts.slice(0, 8).map((concept, index) => {
    const distractors = concepts.filter(item => item.term !== concept.term).slice(0, 3).map(item => item.term)
    const correct = index % 4
    const options = [...distractors.slice(0, correct), concept.term, ...distractors.slice(correct)] as QFormMCQ['options']
    return {
      id: `auto_mc_${index + 1}`,
      question: `Which term completes this statement from the PDF?\n“${concept.prompt}”`,
      options, correct, explanation: concept.sentence,
      hint: 'Find the matching definition in the lesson.',
    }
  })
}

/** Build an editable, source-based draft. Unsupported content is never invented. */
export function generateQuestDraftFromText(text: string, fileName: string): GeneratedQuestDraft {
  const source = cleanText(text)
  if (source.length < 120) throw new Error('The PDF contains too little readable lesson text. Upload a text-based lesson PDF.')
  if (source.length > MAX_PDF_TEXT_LENGTH) throw new Error('The lesson exceeds 120,000 text characters. Split it into smaller lessons; no content has been imported.')
  const titleLine = source.split('\n').find(line => line.trim().length >= 6 && line.trim().length <= 100 && !/[{};]/.test(line))
  const title = (titleLine ?? fileName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ')).replace(/^#+\s*/, '').trim()
  const codeExcerpts = extractCodeExcerpts(source)
  // Keep prose outside extracted code intact, including material after examples.
  let prose = ''
  let offset = 0
  for (const block of codeExcerpts) {
    prose += source.slice(offset, block.start) + '\n\n'
    offset = block.end
  }
  prose += source.slice(offset)
  const sections = sectionsFromText(prose)
  const concepts = conceptsFromSections(sections)
  const overview = sections.map(section => section.body).join('\n\n')
  const theorySections: QFormTheory[] = sections.map((section, index) => ({
    id: `auto_theory_${index + 1}`, type: 'default', ...section,
    code: '', language: 'cpp', table_headers: [], table_rows: [],
  }))
  codeExcerpts.forEach((block, index) => theorySections.push({
    id: `auto_code_${index + 1}`, type: 'code', heading: `Code Example ${index + 1}`,
    body: '', code: block.code, language: 'cpp', table_headers: [], table_rows: [],
  }))
  const codeFill = codeExcerpts.flatMap((block, index) => {
    if (codeExcerpts.findIndex(item => item.code === block.code) !== index) return []
    const blank = makeCodeBlank(block.code)
    return blank ? [{
      id: `auto_cf_${index + 1}`, code_lines: blank.code, language: 'cpp', answers: blank.answer,
      hint: `Review Code Example ${index + 1} in the lesson.`,
      caption: 'Restore the missing token exactly as it appears in the PDF example.',
    }] : []
  })
  const mcQuestions = quizFromConcepts(concepts)
  const matches = concepts.slice(0, 6)
  const ordering = orderingFromText(source)
  if (mcQuestions.length === 0 && matches.length < 2 && ordering.length === 0 && codeFill.length === 0) {
    throw new Error('No reliable activities could be generated. Include explicit concept definitions, a numbered procedure/answer key, or a complete C++ example in the PDF. The existing draft has been kept.')
  }
  const objectives = concepts.slice(0, 6).map(concept => `Identify ${concept.term.toLowerCase()} from its definition in the lesson.`)
  if (ordering.length) objectives.push('Follow the numbered procedure from the lesson in its stated order.')
  if (codeFill.length) objectives.push('Complete the C++ examples using the tokens shown in the lesson.')
  return {
    title, description: excerpt(overview, 150), tutorial_title: title, tutorial_body: excerpt(overview, 360),
    theory_sections: theorySections, objectives,
    act_mc: mcQuestions.length > 0, act_drag: matches.length >= 2, act_balloon: false,
    act_ordering: ordering.length >= 3, act_codefill: codeFill.length > 0,
    mc_questions: mcQuestions, balloon_questions: [],
    drag_problems: matches.length >= 2 ? [{
      id: 'auto_drag', question: 'Match each term to the statement from the PDF with that term removed.',
      items: matches.map((concept, index) => ({ id: `auto_term_${index}`, label: concept.term, color: ['#4caf50', '#58a6ff', '#e3b341'][index % 3] })),
      drop_zones: matches.map((concept, index) => ({ id: `auto_zone_${index}`, label: concept.prompt, accepted: `auto_term_${index}` })),
    }] : [],
    ordering_problems: ordering.length >= 3 ? [{
      id: 'auto_order', question: 'Arrange the steps in the order stated in the PDF procedure or answer key.',
      items: ordering.map((label, index) => ({ id: `auto_step_${index}`, label, description: '' })),
    }] : [],
    code_fill_items: codeFill,
    hints: objectives.map((objective, index) => ({ id: `auto_hint_${index}`, title: `Objective ${index + 1}`, body: objective, icon: '', activity: 'all', _extra: {} })),
  }
}
