import type { QFormOrderProblem, QFormTheory } from './adminPanelModel'
import { distinctConcepts, practiceGroups, spreadAcrossTopics, type LessonConcept } from './questPractice'

interface SourceSequence { heading: string; question: string; items: string[] }

/** Preserve every usable procedure, then add clearly labeled topic and definition sequence reviews. */
export const orderingPractice = (sections: QFormTheory[], concepts: LessonConcept[], limit: number): QFormOrderProblem[] => {
  const candidates: SourceSequence[] = []
  for (const section of sections) {
    const lines = section.body.split('\n')
    for (let index = 0; index < lines.length; index++) {
      if (!/^\s*1[.)]\s+/.test(lines[index])) continue
      const items: string[] = []
      let next = index
      for (; next < lines.length; next++) {
        if (!lines[next].trim()) continue
        const step = /^\s*(\d+)[.)]\s+(.+)$/.exec(lines[next])
        if (!step || Number(step[1]) !== items.length + 1) break
        items.push(step[2].trim())
      }
      index = Math.max(index, next - 1)
      if (items.length >= 3 && new Set(items).size === items.length && items.every(item => !item.includes('?'))) {
        candidates.push(...practiceGroups(items, 6).map(group => ({
          heading: section.heading, question: `Arrange these items in the numbered sequence shown in "${section.heading}".`, items: group,
        })))
      }
    }
  }
  const headings = [...new Set(sections.filter(section => section.type !== 'code' && section.heading !== 'Overview').map(section => section.heading))]
  if (headings.length >= 3) candidates.push(...practiceGroups(headings, 6).map(items => ({
    heading: 'Lesson outline', question: 'Arrange these lesson topics in the order they are introduced in the theory.', items,
  })))
  const definitions = new Map<string, LessonConcept[]>()
  for (const concept of distinctConcepts(concepts)) definitions.set(concept.heading, [...(definitions.get(concept.heading) ?? []), concept])
  const review: LessonConcept[] = []
  for (const [heading, values] of definitions) {
    if (values.length >= 3) candidates.push(...practiceGroups(values, 6).map(group => ({
      heading, question: `Arrange these terms in the order their definitions appear in "${heading}" in the theory.`, items: group.map(concept => concept.term),
    })))
    else review.push(...values)
  }
  if (review.length >= 3) candidates.push(...practiceGroups(review, 6).map(group => ({
    heading: 'Definition review', question: 'Arrange these terms in the order their definitions appear in the theory.', items: group.map(concept => concept.term),
  })))
  const sequences = candidates.filter((sequence, index) => candidates.findIndex(other =>
    JSON.stringify(other.items.map(item => item.toLowerCase())) === JSON.stringify(sequence.items.map(item => item.toLowerCase()))
  ) === index)
  return spreadAcrossTopics(sequences, limit).map((sequence, index) => ({
    id: `auto_order_${index + 1}`, question: sequence.question,
    items: sequence.items.map((label, itemIndex) => ({ id: `auto_step_${index}_${itemIndex}`, label, description: '' })),
  }))
}
