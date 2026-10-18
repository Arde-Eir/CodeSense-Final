import type { QFormDragProblem, QFormMCQ, QFormTheory } from './adminPanelModel'
import { lessonSentences } from './questTheory'

export interface LessonConcept {
  term: string
  heading: string
  sentence: string
  prompt: string
  verb: string
  predicate: string
}

export interface PracticeQuestion {
  heading: string
  kind: 'definition' | 'application' | 'code'
  question: QFormMCQ
}

export interface ChoiceSource {
  heading: string
  kind: PracticeQuestion['kind']
  question: string
  answer: string
  distractors: string[]
  explanation: string
  hint: string
}

export const conceptKey = (term: string): string => term.toLowerCase().replace(/([^s])s$/, '$1')

/** Keep distinct facts from every topic while excluding questions and ambiguous cloze prompts. */
export const extractLessonConcepts = (sections: QFormTheory[]): LessonConcept[] => {
  const concepts: LessonConcept[] = []
  const seen = new Set<string>()
  for (const section of sections) {
    for (const sentence of lessonSentences(section.body)) {
      if (sentence.length > 450 || /[{};?]|#include/.test(sentence)) continue
      const match = /^(?:(?:A|An|The)\s+)?([A-Za-z][A-Za-z0-9_:+#/-]*(?:\s+[A-Za-z][A-Za-z0-9_+#/-]*){0,4}?)\s+(is|are|means|refers? to|stores?|holds?|represents?|allows?|contains?|repeats?|checks?|selects?|combines?|performs?|uses?)\s+(.+)$/i.exec(sentence)
      if (!match || match[1].length > 55 || /^(?:this|that|these|those|it|they|we|you|there|here|following|what|which|who|where|when|how)\b/i.test(match[1])) continue
      if (/\b(?:not|never|isn't|aren't)\b/i.test(sentence)) continue
      const key = `${conceptKey(match[1])}:${match[3].toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      const offset = sentence.toLowerCase().indexOf(match[1].toLowerCase())
      concepts.push({
        term: match[1], heading: section.heading, sentence,
        prompt: sentence.slice(0, offset) + '___' + sentence.slice(offset + match[1].length),
        verb: match[2].toLowerCase(), predicate: match[3].replace(/[.!]$/, ''),
      })
    }
  }
  return concepts.filter(concept => !concepts.some(other => conceptKey(other.term) !== conceptKey(concept.term) && other.prompt.toLowerCase() === concept.prompt.toLowerCase()))
}

export const distinctConcepts = (concepts: LessonConcept[]): LessonConcept[] => concepts.filter((concept, index) =>
  concepts.findIndex(other => conceptKey(other.term) === conceptKey(concept.term)) === index
)

/** Distribute practice across the whole upload instead of stopping in its first chapters. */
export const spreadAcrossTopics = <T extends { heading: string }>(items: T[], limit: number): T[] => {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const heading = item.heading.replace(/\s*\(Code \d+\)$/, '')
    groups.set(heading, [...(groups.get(heading) ?? []), item])
  }
  const result: T[] = []
  for (let index = 0; result.length < Math.min(limit, items.length); index++) {
    for (const group of groups.values()) {
      if (group[index] && result.length < limit) result.push(group[index])
    }
  }
  return result
}

/** Balance small puzzles so a final one-item group is never created. */
export const practiceGroups = <T,>(items: T[], maxSize: number): T[][] => {
  const count = Math.ceil(items.length / maxSize)
  return Array.from({ length: count }, (_, index) => items.slice(
    Math.floor(index * items.length / count), Math.floor((index + 1) * items.length / count)
  ))
}

export const interleavePractice = <T,>(groups: T[][]): T[] => Array.from(
  { length: Math.max(0, ...groups.map(group => group.length)) },
  (_, index) => groups.flatMap(group => group[index] ? [group[index]] : [])
).flat()

export const buildChoiceQuestion = (source: ChoiceSource, index: number): PracticeQuestion => {
  const distractors = [...new Set(source.distractors)].filter(value => value.trim() && value.toLowerCase() !== source.answer.toLowerCase()).slice(0, 3)
  if (!distractors.length) throw new Error(`Cannot generate answer choices for "${source.answer}" in "${source.heading}": no distinct alternatives were provided.`)
  const correct = index % (distractors.length + 1)
  const options = [...distractors.slice(0, correct), source.answer, ...distractors.slice(correct), '', '', ''].slice(0, 4) as QFormMCQ['options']
  return { heading: source.heading, kind: source.kind, question: {
    id: `auto_choice_${index + 1}`, question: source.question,
    options, correct, explanation: source.explanation, hint: source.hint,
  } }
}

const conceptClue = (concept: LessonConcept): string => {
  const detail = concept.predicate.toLowerCase()
  if (/memory address|memory location/.test(detail)) return 'Distinguish a memory location from the value stored there. Focus on which concept keeps track of the location.'
  if (/same (?:data )?type/.test(detail) && /collection|values|elements/.test(detail)) return 'Look for both requirements together: several related values and a shared data type. A single value does not satisfy both.'
  if (/position|index/.test(detail)) return 'Separate the value of an element from its position in the collection. Decide which of those the statement describes.'
  if (/repeat|iteration/.test(detail)) return 'Identify what repeats and what stops that repetition. Compare that behavior with the role of each choice.'
  if (/condition|true|false/.test(detail)) return 'Locate the yes/no test in the description. Distinguish testing a condition from performing the action that follows it.'
  return `In "${concept.heading}", focus on the role described by "${concept.predicate}". Compare what each option does, rather than choosing a term merely because it is familiar.`
}

const applicationRequirement = (concept: LessonConcept): string | null => {
  if (/^(?:is|are)$/.test(concept.verb)) {
    if (/^used to /i.test(concept.predicate)) return `to ${concept.predicate.slice(8)}`
    if (/^(?:a|an) /i.test(concept.predicate)) return concept.predicate
    return null
  }
  const actions: Record<string, string> = {
    store: 'store', stores: 'store', hold: 'hold', holds: 'hold', repeat: 'repeat', repeats: 'repeat',
    check: 'check', checks: 'check', select: 'select', selects: 'select', combine: 'combine', combines: 'combine',
    perform: 'perform', performs: 'perform', contain: 'contain', contains: 'contain', use: 'use', uses: 'use',
  }
  return actions[concept.verb] ? `to ${actions[concept.verb]} ${concept.predicate}` : null
}

export const conceptPractice = (concepts: LessonConcept[]): PracticeQuestion[] => {
  const terms = distinctConcepts(concepts)
  if (terms.length < 2) return []
  return concepts.flatMap((concept, index) => {
    const alternatives = terms.filter(other => conceptKey(other.term) !== conceptKey(concept.term))
    const nearby = [...alternatives.filter(other => other.heading === concept.heading), ...alternatives.filter(other => other.heading !== concept.heading)]
    const distractors = [...nearby.slice(index % nearby.length), ...nearby.slice(0, index % nearby.length)].map(other => other.term)
    const evidence = { heading: concept.heading, answer: concept.term, distractors, explanation: concept.sentence, hint: conceptClue(concept) }
    const definition = buildChoiceQuestion({ ...evidence, kind: 'definition', question: `Which term completes this statement from "${concept.heading}"?\n“${concept.prompt}”` }, index * 2)
    const requirement = applicationRequirement(concept)
    return requirement ? [definition, buildChoiceQuestion({
      ...evidence,
      kind: 'application',
      question: `A program needs ${requirement}. Based on the description in "${concept.heading}", which concept fits this situation?`,
    }, index * 2 + 1)] : [definition]
  })
}

export const dragPractice = (concepts: LessonConcept[], limit: number): QFormDragProblem[] => {
  const groups = new Map<string, LessonConcept[]>()
  for (const concept of distinctConcepts(concepts)) groups.set(concept.heading, [...(groups.get(concept.heading) ?? []), concept])
  const candidates = [...groups].flatMap(([heading, values]) => values.length >= 2
    ? practiceGroups(values, 6).map(items => ({ heading, items })) : [])
  const review = [...groups.values()].filter(values => values.length === 1).flat()
  if (review.length >= 2) candidates.push(...practiceGroups(review, 6).map(items => ({ heading: 'Topic review', items })))
  return spreadAcrossTopics(candidates, limit).map((group, index) => ({
    id: `auto_drag_${index + 1}`, question: `Match the terms to their descriptions from "${group.heading}".`,
    items: group.items.map((concept, itemIndex) => ({ id: `auto_term_${index}_${itemIndex}`, label: concept.term, color: ['#4caf50', '#58a6ff', '#e3b341'][itemIndex % 3] })),
    drop_zones: group.items.map((concept, itemIndex) => ({ id: `auto_zone_${index}_${itemIndex}`, label: concept.prompt, accepted: `auto_term_${index}_${itemIndex}` })),
  }))
}
