import { describe, expect, it } from 'vitest'
import { generateQuestDraftFromText } from '@/admin/questAutoGenerator'
import { validateQuestBuilderForm } from '@/admin/adminHelpers'

const lesson = `C++ Input and Output Fundamentals
Overview:
C++ programs communicate with users by reading input and displaying output.
Input:
Input is data received by the program from a user or another source.
Output:
Output is information the program displays to the user.
Variables:
A variable is named storage for a value used by the program.
Operators:
An operator is a symbol that performs an operation on values.
`

const validate = (draft: ReturnType<typeof generateQuestDraftFromText>) =>
  validateQuestBuilderForm({ ...draft, basexp: 100, requiredxp: 0 })

describe('PDF quest generation', () => {
  it('uses source definitions, distinct source terms and correctly indexed answers', () => {
    const draft = generateQuestDraftFromText(lesson, 'lesson.pdf')
    expect(validate(draft)).toEqual({ ok: true, errors: [] })
    expect(draft.mc_questions).toHaveLength(4)
    expect(draft.mc_questions.map(question => question.correct)).toEqual([0, 1, 2, 3])
    for (const question of draft.mc_questions) {
      expect(lesson).toContain(question.explanation)
      expect(new Set(question.options).size).toBe(4)
      expect(question.explanation.toLowerCase()).toContain(question.options[question.correct].toLowerCase())
    }
    expect(draft.drag_problems[0].drop_zones[0].label).toBe('___ is data received by the program from a user or another source.')
    expect(draft.act_ordering).toBe(false)
    expect(draft.act_codefill).toBe(false)
  })

  it('keeps nested C++ and punctuation inside literals unchanged, and blanks a real token', () => {
    const code = `#include <iostream>
// int is mentioned in a comment, not a blank candidate.
int main() {
  for (int i = 0; i < 3; i++) {
    if (i > 0) {
      std::cout << "http://example.test; { int }";
    }
  }
  return 0;
}`
    const draft = generateQuestDraftFromText(`${lesson}\n${code}\nFinal note: Keep this explanation after the example.`, 'nested.pdf')
    expect(draft.code_fill_items).toHaveLength(1)
    expect(draft.code_fill_items[0].code_lines.replace('___', draft.code_fill_items[0].answers)).toBe(code)
    expect(draft.code_fill_items[0].code_lines).toContain('// int is mentioned')
    expect(draft.theory_sections.find(section => section.type === 'code')?.code).toBe(code)
    expect(draft.theory_sections.map(section => section.body).join('\n')).toContain('Keep this explanation after the example.')
    expect(validate(draft).ok).toBe(true)
  })

  it('preserves prose after inline examples and does not treat ordinary prose as code', () => {
    const draft = generateQuestDraftFromText(`${lesson}
Example: int score = 10; Important rules: Declare variables before use.
This prose mentions cout << "Hello"; without declaring a code example.`, 'inline.pdf')
    expect(draft.code_fill_items).toHaveLength(1)
    expect(draft.code_fill_items[0].code_lines).toBe('___ score = 10;')
    expect(draft.theory_sections.map(section => section.body).join('\n')).toContain('Important rules: Declare variables before use.')
  })

  it('uses explicit ordered steps with numeric values without guessing an answer from shuffled items', () => {
    const shuffled = generateQuestDraftFromText(`${lesson}\nArrange:\n- Print the result\n- Read the value\n- Initialize\nCorrect order:`, 'shuffled.pdf')
    expect(shuffled.act_ordering).toBe(false)
    const draft = generateQuestDraftFromText(`${lesson}\nCorrect order:\n1. Initialize score to 0.5\n2. Read 2 input values\n3. Print the result\n`, 'steps.pdf')
    expect(draft.ordering_problems[0].items.map(item => item.label)).toEqual(['Initialize score to 0.5', 'Read 2 input values', 'Print the result'])
    expect(validate(draft).ok).toBe(true)
  })

  it('keeps late-page content beyond the old 24,000-character cutoff', () => {
    const tail = 'A pointer stores the memory address of another object.'
    const draft = generateQuestDraftFromText(`${lesson}\n${'Additional reading about the lesson. '.repeat(800)}\n\nPointers:\n${tail}`, 'long.pdf')
    expect(draft.theory_sections.some(section => section.body.includes(tail))).toBe(true)
    expect(draft.mc_questions.some(question => question.explanation === tail)).toBe(true)
  })

  it('recognizes plain PDF headings and excludes ambiguous or incomplete answer keys', () => {
    const draft = generateQuestDraftFromText(`${lesson.replaceAll(':', '')}\nPointer:\nA pointer stores the address of a value.\nReference:\nA reference stores the address of a value.\nSteps:\n1. Read data\n2. Process data\n3. Print data\n5. End the program`, 'headings.pdf')
    expect(draft.mc_questions).toHaveLength(4)
    expect(draft.mc_questions.some(question => question.options.includes('Pointer') || question.options.includes('Reference'))).toBe(false)
    expect(draft.act_ordering).toBe(false)
    expect(validate(draft).ok).toBe(true)
  })

  it('learns explicitly defined topics outside a fixed keyword list and preserves plural terms', () => {
    const draft = generateQuestDraftFromText('Recursive Programming\nRecursion\nRecursion is a technique in which a function calls itself to solve a smaller problem.\n\nVectors\nVectors are containers that store a sequence of values and can grow during execution.', 'recursion.pdf')
    expect(draft.drag_problems[0].items.map(item => item.label)).toEqual(['Recursion', 'Vectors'])
    expect(draft.drag_problems[0].drop_zones[1].label).toContain('___ are containers')
    expect(validate(draft).ok).toBe(true)
  })

  it('rejects unreadable, oversized or unsupported material without inventing activities', () => {
    expect(() => generateQuestDraftFromText('Title only', 'short.pdf')).toThrow(/too little/)
    expect(() => generateQuestDraftFromText(lesson.repeat(1000), 'large.pdf')).toThrow(/120,000/)
    expect(() => generateQuestDraftFromText('This document mentions variables, input, output and operators but does not define any of them. '.repeat(3), 'mentions.pdf')).toThrow(/No reliable activities/)
    expect(() => generateQuestDraftFromText(`${lesson}\nint main() { if (true) { return 0; }`, 'broken-code.pdf')).toThrow(/incomplete/)
    const twoConcepts = generateQuestDraftFromText('Lesson Definitions\n\nInput is data received by the program from a user or another source.\n\nOutput is information the program displays to the user.', 'two.pdf')
    expect(twoConcepts.act_mc).toBe(false)
    expect(twoConcepts.mc_questions).toEqual([])
    expect(twoConcepts.act_drag).toBe(true)
    expect(validate(twoConcepts).ok).toBe(true)
  })
})
