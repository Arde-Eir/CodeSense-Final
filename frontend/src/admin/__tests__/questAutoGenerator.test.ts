/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { basename } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { generateQuestDraftFromText } from '../questAutoGenerator'

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

  it.runIf(process.env.CODESENSE_PDF_FIXTURE && existsSync(process.env.CODESENSE_PDF_FIXTURE))(
    'generates organized quest content from the provided PDF fixture',
    async () => {
      const pdfPath = process.env.CODESENSE_PDF_FIXTURE!
      const text = await extractPdfTextInNode(pdfPath)
      const draft = generateQuestDraftFromText(text, basename(pdfPath))
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
