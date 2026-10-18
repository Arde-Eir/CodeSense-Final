import type { QFormCodeFill, QFormTheory } from './adminPanelModel'
import { makeCodeBlanks, type CodeBlank, type CodeBlankKind } from './questCodeSource'
import { buildChoiceQuestion, type PracticeQuestion } from './questPractice'

export interface CodeExercise {
  heading: string
  source: string
  blank: CodeBlank
  item: QFormCodeFill
}

const blankClue = (blank: CodeBlank): string => {
  const lines = blank.code.split('\n')
  const line = lines.find(value => value.includes('___'))
  if (!line) throw new Error('Cannot create a code hint: the exercise has no blank.')
  if (blank.kind === 'type') return blank.answer === 'void'
    ? 'Check whether this function sends a value back to its caller. The missing type must match that behavior.'
    : 'Look at the declaration around the blank and the values being stored. The missing token describes the data or a qualifier on its declaration.'
  if (blank.kind === 'control') return /\breturn\b/.test(blank.answer)
    ? 'This statement sends a result back to the caller. Distinguish that action from displaying a value or repeating a block.'
    : 'Follow the surrounding parentheses and braces. Decide whether this statement starts repetition, makes a decision, or changes the flow inside a block.'
  if (blank.kind === 'stream') return 'Follow the direction of the arrows beside the blank. Decide whether the statement sends a value out or reads a value into a variable.'
  if (blank.kind === 'number' && /\[\s*___\s*\]/.test(line)) return /\b(?:int|double|float|char|bool|string)\b/.test(line)
    ? 'The number in this declaration sets the capacity of the array. Compare the source example and any initializer values; capacity and the last valid index are different.'
    : 'The number inside brackets selects a position, not the value stored there. Trace which position the source example accesses.'
  if (blank.kind === 'number') return 'Find the role of the number on this line: an initial value, a comparison bound, or a returned result. Keep that role consistent with the original example.'
  if (/[<>]=?|==|!=/.test(blank.answer) && /\b(?:for|while|if)\b/.test(line)) return 'Test the condition against the values used in the example. Check which comparison keeps the intended iterations or decision in range.'
  if (blank.answer === '=' || blank.answer === '==') return 'Decide whether the statement stores a new value or tests whether two values are equal. Those operations use different operators.'
  if (blank.answer === '++' || blank.answer === '--') return 'Trace how the loop variable changes after one iteration. The missing token must move it in the direction shown by the example.'
  return 'Read the expressions on both sides of the blank. Identify the operation joining them, then compare that operation with the original code.'
}

const codeDistractors = (blank: CodeBlank): string[] => {
  if (blank.kind === 'number') {
    const number = Number(blank.answer)
    return [number + 1, Math.max(0, number - 1), number + 2, number + 3].filter(value => value !== number).map(String)
  }
  const choices: Record<Exclude<CodeBlankKind, 'number'>, string[]> = {
    type: ['int', 'double', 'float', 'char', 'bool', 'string', 'void', 'auto'],
    control: ['for', 'while', 'if', 'return', 'break', 'continue'],
    stream: ['cin', 'cout', 'cerr', 'clog'],
    operator: ['=', '==', '!=', '<', '<=', '>', '>=', '++', '--', '+', '-', '<<', '>>'],
  }
  return choices[blank.kind].filter(choice => choice !== blank.answer)
}

export const codeExercises = (sections: QFormTheory[]): CodeExercise[] => sections.flatMap((section, sectionIndex) => {
  if (!section.code || sections.findIndex(other => other.code === section.code) !== sectionIndex) return []
  return makeCodeBlanks(section.code).map((blank, index) => ({
    heading: section.heading, source: section.code, blank,
    item: {
      id: `auto_cf_${sectionIndex}_${index}`, code_lines: blank.code, language: 'cpp', answers: blank.answer,
      hint: blankClue(blank), caption: `Restore the missing ${blank.kind === 'type' ? 'declaration token' : blank.kind === 'number' ? 'value' : blank.kind} from "${section.heading}".`,
    },
  }))
})

export const codePractice = (exercises: CodeExercise[]): PracticeQuestion[] => exercises.map((exercise, index) => {
  const lines = exercise.blank.code.split('\n')
  const blankLine = lines.findIndex(line => line.includes('___'))
  const context = lines.slice(Math.max(0, blankLine - 2), blankLine + 3).join('\n')
  return buildChoiceQuestion({
    heading: exercise.heading,
    kind: 'code',
    question: `The program must keep the operation shown in "${exercise.heading}". Which token restores this excerpt from the learning material?\n${context}`,
    answer: exercise.blank.answer, distractors: codeDistractors(exercise.blank),
    explanation: exercise.source, hint: exercise.item.hint,
  }, index)
})
