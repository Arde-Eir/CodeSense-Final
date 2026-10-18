import { defaultQF, type QuestFormState } from './adminPanelModel'
import { MAX_PDF_TEXT_LENGTH } from './pdfText'
import { extractCodeExcerpts } from './questCodeSource'
import { codeExercises, codePractice } from './questCodePractice'
import { buildQuestTheory } from './questTheory'
import { conceptPractice, distinctConcepts, dragPractice, extractLessonConcepts, interleavePractice, spreadAcrossTopics } from './questPractice'
import { orderingPractice } from './questOrderingPractice'
import { generateQuestHintRows } from './questHints'
export { extractTextFromPdf } from './pdfText'

export type GeneratedQuestDraft = Pick<QuestFormState,
  'title' | 'description' | 'tutorial_title' | 'tutorial_body' | 'theory_sections' | 'objectives' |
  'act_mc' | 'act_drag' | 'act_balloon' | 'act_ordering' | 'act_codefill' |
  'mc_questions' | 'balloon_questions' | 'drag_problems' | 'ordering_problems' | 'code_fill_items' | 'hints'>

const excerpt = (text: string, max: number): string => {
  const value = text.replace(/\s+/g, ' ').trim()
  return value.length <= max ? value : `${value.slice(0, max).replace(/\s+\S*$/, '')}…`
}

/** Scale practice to distinct source content, with topic coverage and bounded game lengths. */
export function generateQuestDraftFromText(text: string, fileName: string): GeneratedQuestDraft {
  const source = text.replace(/\r\n?/g, '\n').replaceAll(String.fromCharCode(0), '').trim()
  if (source.length < 120) throw new Error('The PDF contains too little readable lesson text. Upload a text-based lesson PDF.')
  if (source.length > MAX_PDF_TEXT_LENGTH) throw new Error('The lesson exceeds 120,000 text characters. Split it into smaller lessons; no content has been imported.')
  const firstLine = source.split('\n')[0].trim()
  const titleLine = firstLine.length >= 3 && firstLine.length <= 100 && !/[{};.!?]|^[•●▪]/.test(firstLine) ? firstLine : null
  const title = (titleLine ?? fileName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ')).replace(/^#+\s*/, '').trim()
  const lessonSource = titleLine ? source.replace(titleLine, '') : source
  const sections = buildQuestTheory(lessonSource, extractCodeExcerpts(lessonSource))
  const concepts = extractLessonConcepts(sections)
  const terms = distinctConcepts(concepts)
  const exercises = codeExercises(sections)
  const choices = [...conceptPractice(concepts), ...codePractice(exercises)]
  const definitions = choices.filter(choice => choice.kind === 'definition')
  const applications = choices.filter(choice => choice.kind === 'application')
  const codeQuestions = choices.filter(choice => choice.kind === 'code')
  const mcQuestions = spreadAcrossTopics(interleavePractice([definitions, applications, codeQuestions]), 48)
    .map((choice, index) => ({ ...choice.question, id: `auto_mc_${index + 1}` }))
  const balloonQuestions = spreadAcrossTopics(interleavePractice([applications, codeQuestions, definitions])
    .filter(choice => choice.question.options.every(option => option.length <= 40)), 32)
    .map((choice, index) => ({ ...choice.question, id: `auto_bp_${index + 1}`, correctAnswers: [choice.question.correct] }))
  const dragProblems = dragPractice(terms, 12)
  const orderingProblems = orderingPractice(sections, terms, 12)
  const codeFill = spreadAcrossTopics(exercises, 40).map(exercise => exercise.item)
  if (!mcQuestions.length && !balloonQuestions.length && !dragProblems.length && !orderingProblems.length && !codeFill.length) {
    throw new Error('No reliable activities could be generated. Include explicit concept definitions, a numbered procedure, or a complete C++ example in the PDF. The existing draft has been kept.')
  }
  const objectives = spreadAcrossTopics(terms, 12).map(concept => `Explain the role of ${concept.term.toLowerCase()} using the material in "${concept.heading}".`)
  if (applications.length) objectives.push('Apply the concepts to the requirements and situations described by the lesson.')
  if (orderingProblems.length) objectives.push('Recall the order of the topics or steps presented in the lesson.')
  if (codeFill.length) objectives.push('Restore the types, values, operators, and control flow used in the C++ examples.')
  const draft: GeneratedQuestDraft = {
    title, description: excerpt(sections.map(section => section.body).join('\n\n'), 150), tutorial_title: title, tutorial_body: '',
    theory_sections: sections, objectives,
    act_mc: mcQuestions.length > 0, act_balloon: balloonQuestions.length > 0, act_drag: dragProblems.length > 0,
    act_ordering: orderingProblems.length > 0, act_codefill: codeFill.length > 0,
    mc_questions: mcQuestions, balloon_questions: balloonQuestions,
    drag_problems: dragProblems, ordering_problems: orderingProblems, code_fill_items: codeFill, hints: [],
  }
  return { ...draft, hints: generateQuestHintRows({ ...defaultQF(), ...draft }, 'auto_hint') }
}
