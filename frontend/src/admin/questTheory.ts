import type { QFormTheory } from './adminPanelModel'
import type { CodeExcerpt } from './questCodeSource'
import { parseTheoryText } from '@/campaign/theoryText'

const isHeading = (line: string): boolean => {
  if (/^#{1,4}\s+.+|^[A-Za-z][^.!?;{}]{2,70}:$/.test(line)) return true
  const title = line.replace(/^\d+[.)]\s+/, '')
  if (!/^[A-Za-z][A-Za-z0-9 +#/:()&-]{2,74}$/.test(title)) return false
  const words = title.split(/\s+/)
  return words.length <= 9 && words.every(word => /^[A-Z0-9(]/.test(word) || /^(?:a|an|and|at|by|for|from|in|of|on|or|the|to|with)$/.test(word))
}

/** Keep code examples beside their explanation and preserve the PDF's reading order. */
export const buildQuestTheory = (source: string, excerpts: CodeExcerpt[]): QFormTheory[] => {
  let text = ''
  let offset = 0
  for (const block of excerpts) {
    text += source.slice(offset, block.start) + `\n\n\`\`\`cpp\n${block.code}\n\`\`\`\n\n`
    offset = block.end
  }
  text += source.slice(offset)
  const sections: QFormTheory[] = []
  let heading = 'Overview'
  let lines: string[] = []
  let code: string[] | null = null
  let codeIndex = 0
  const flush = (): void => {
    const body = lines.join('\n').trim()
    if (body) sections.push({
      id: `auto_theory_${sections.length + 1}`,
      type: /\b(?:note|remember|tip|important)\b/i.test(heading) ? 'tip'
        : /\b(?:summary|recap|takeaways)\b/i.test(heading) ? 'summary' : 'default',
      heading, body, code: '', language: 'cpp', table_headers: [], table_rows: [],
    })
    lines = []
  }
  for (const line of text.split('\n')) {
    const value = line.trim()
    if (/^```/.test(value)) {
      flush()
      if (code === null) code = []
      else {
        codeIndex += 1
        sections.push({
          id: `auto_code_${codeIndex}`, type: 'code',
          heading: heading === 'Overview' ? `Code Example ${codeIndex}` : `${heading} (Code ${codeIndex})`,
          body: '', code: code.join('\n').trim(), language: 'cpp', table_headers: [], table_rows: [],
        })
        code = null
      }
    } else if (code !== null) code.push(line)
    else if (isHeading(value)) {
      flush()
      heading = value.replace(/^#{1,4}\s+|^\d+[.)]\s+/g, '').replace(/:$/, '')
    } else if (!/^[•●▪]$/.test(value)) lines.push(line)
  }
  if (code !== null) throw new Error('A lesson code block is missing its closing fence.')
  flush()
  return sections
}

/** Rejoin wrapped PDF lines before finding complete, source-backed statements. */
export const lessonSentences = (text: string): string[] => parseTheoryText(text).flatMap(block => {
  const paragraphs = block.type === 'list' ? block.items : block.type === 'paragraph' ? [block.text] : []
  return paragraphs.flatMap(paragraph => paragraph.split(/(?<=[.!?])\s+(?=[A-Z])/))
}).map(sentence => sentence.replace(/\s+/g, ' ').trim()).filter(Boolean)
