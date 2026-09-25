import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api'

export const MAX_PDF_TEXT_LENGTH = 120_000
const MAX_PDF_BYTES = 10 * 1024 * 1024
const MAX_PDF_PAGES = 80

/** Preserve PDF line boundaries and adjacent glyphs, especially C++ operators. */
const pageText = (items: (TextItem | TextMarkedContent)[]): string => {
  let text = ''
  let previous: TextItem | null = null
  for (const item of items) {
    if (!('str' in item)) continue
    if (previous && !text.endsWith('\n')) {
      const newLine = Math.abs(item.transform[5] - previous.transform[5]) > Math.max(2, item.height * 0.4)
      const gap = item.transform[4] - (previous.transform[4] + previous.width)
      if (newLine) text += '\n'
      else if (gap > Math.max(1, item.height * 0.15) && !/\s$/.test(text) && !/^\s/.test(item.str)) text += ' '
    }
    text += item.str
    if (item.hasEOL) text += '\n'
    previous = item
  }
  return text.trim()
}

/** Read selectable text without OCR or silently skipping unreadable pages. */
export async function extractTextFromPdf(file: File): Promise<string> {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new TypeError('Choose a PDF file containing selectable lesson text.')
  }
  if (file.size === 0) throw new Error('The PDF is empty. Upload the original lesson document.')
  if (file.size > MAX_PDF_BYTES) throw new Error('The PDF exceeds 10 MB. Split it into smaller lesson PDFs before uploading.')
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString()
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  try {
    const pdf = await task.promise
    if (pdf.numPages > MAX_PDF_PAGES) throw new Error('The PDF exceeds 80 pages. Upload one lesson at a time.')
    const pages: string[] = []
    let length = 0
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number)
      const text = pageText((await page.getTextContent()).items)
      page.cleanup()
      if (!/[A-Za-z]{3}/.test(text)) {
        throw new Error(`Page ${number} has no readable lesson text. Scanned/image-only pages need OCR first; export a PDF with selectable text.`)
      }
      length += text.length + 2
      if (length > MAX_PDF_TEXT_LENGTH) throw new Error('The PDF exceeds 120,000 text characters. Split it into smaller lessons; no content has been imported.')
      pages.push(text)
    }
    return pages.join('\n\n')
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') throw new Error('The PDF is password-protected. Upload an unlocked copy.')
    if (error instanceof Error && error.name === 'InvalidPDFException') throw new Error('The PDF is invalid or damaged. Export it again and retry.')
    throw error
  } finally {
    await task.destroy()
  }
}
