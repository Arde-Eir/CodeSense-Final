/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { basename } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { generateQuestDraftFromText } from '../questAutoGenerator'

const DEFAULT_PDF_TEXT_FIXTURE = `
  C++ Input and Output Fundamentals
  Overview:
  C++ programs communicate with users by reading input and displaying output. A program often begins in the main function, where statements execute in order and return a final status code when the task is complete.

  Input:
  Input is data received by the program from a user or another source. The standard input stream cin reads values into variables so that the program can work with information supplied during execution.

  Output:
  Output is information the program displays to the user. The standard output stream cout presents results, instructions, and feedback so that a user understands what the program has done.

  Variables:
  A variable is named storage for a value used by the program. Variables should be declared with an appropriate data type before input is stored or calculations are performed.

  Operators:
  An operator is a symbol that performs an operation on values. The stream extraction operator reads input with cin, while the stream insertion operator sends output with cout.

  Example: int score = 10;
  Example: cout << score;

  Condition:
  A condition decides whether a code block executes, allowing a program to respond differently when the stored input changes.
`

const extractPdfTextInNode = async (pdfPath: string): Promise<string> => {
  ;(globalThis as any).DOMMatrix ??= class DOMMatrix {}
  ;(globalThis as any).ImageData ??= class ImageData {}
  ;(globalThis as any).Path2D ??= class Path2D {}

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(readFileSync(pdfPath))
  const pdf = await pdfjs.getDocument({ data, disableWorker: true } as any).promise
  const pages: string[] = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    pages.push(content.items.map((item: any) => item.str ?? '').join(' '))
  }

  return pages.join('\n\n').replace(/\s+/g, ' ').trim()
}

describe('generateQuestDraftFromText', () => {
  it('keeps generated games concise and avoids turning prose into code-fill blocks', () => {
    const text = `
      C++ Basic Input / Output (M4 Tutorial Guide)
      C++ Basic Input and Output focus on how a program communicates with the user.
      Input is data received by a program, commonly read with cin.
      Output is information displayed by a program, commonly written with cout.
      Operators use symbols such as >> for input and << for output.
      Every program starts from a special function called main().
      Examples include: int, float, if, else, return, while. They are case-sensitive and must be written correctly.
      Example: int x = 10; Important rules: Must be declared before use and should be initialized.
      This is normal lesson prose that mentions cout << "Hello World"; but should not become a full paragraph code block.
    `

    const draft = generateQuestDraftFromText(text, 'm4-input-output.pdf')
    const allMcText = draft.mc_questions
      .flatMap(q => [q.question, q.explanation, q.hint, ...q.options])
      .join(' ')
    const dragLabels = draft.drag_problems[0].drop_zones.map(zone => zone.label)

    expect(draft.act_ordering).toBe(false)
    expect(draft.code_fill_items).toHaveLength(1)
    expect(draft.code_fill_items[0].code_lines).toBe('___ x = 10;')
    expect(allMcText).not.toContain('Tutorial Guide C++ Basic Input')
    expect(new Set(draft.mc_questions[0].options).size).toBe(4)
    expect(dragLabels.every(label => label.length <= 150)).toBe(true)
    expect(dragLabels).toContain('Data read by the program, usually with cin.')
    expect(dragLabels).toContain('Information displayed by the program, usually with cout.')
  })

  it(
    'generates organized quest content from lesson fixture text or a provided PDF fixture',
    async () => {
      const externalPdf = process.env.CODESENSE_PDF_FIXTURE
      const useExternalPdf = Boolean(externalPdf && existsSync(externalPdf))
      const text = useExternalPdf
        ? await extractPdfTextInNode(externalPdf!)
        : DEFAULT_PDF_TEXT_FIXTURE
      const filename = useExternalPdf ? basename(externalPdf!) : 'input-output-fundamentals.pdf'
      const draft = generateQuestDraftFromText(text, filename)
      const mcOptionSets = draft.mc_questions.map(q => new Set(q.options).size)
      const codeFillText = draft.code_fill_items.map(item => item.code_lines).join('\n')
      const dragLabels = draft.drag_problems[0]?.drop_zones.map(zone => zone.label) ?? []

      expect(text.length).toBeGreaterThan(500)
      expect(draft.mc_questions.length).toBeGreaterThan(0)
      expect(mcOptionSets.every(size => size === 4)).toBe(true)
      expect(dragLabels.every(label => label.length <= 150)).toBe(true)
      expect(codeFillText).not.toMatch(/Tutorial Guide C\+\+.*powerful programming language/i)
    },
  )
})
