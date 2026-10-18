export type TheoryTextBlock =
  | { type: 'paragraph' | 'heading' | 'code'; text: string }
  | { type: 'list'; items: string[]; start: number | null }

/** Recover readable paragraphs and lists without interpreting lesson text as HTML. */
export const parseTheoryText = (text: string): TheoryTextBlock[] => {
  const blocks: TheoryTextBlock[] = []
  let paragraph: string[] = []
  let list: { items: string[]; start: number | null } | null = null
  let code: string[] | null = null
  const flush = (): void => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
    if (list) blocks.push({ type: 'list', ...list })
    paragraph = []
    list = null
  }
  for (const sourceLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*```/.test(sourceLine)) {
      flush()
      if (code === null) code = []
      else { blocks.push({ type: 'code', text: code.join('\n') }); code = null }
      continue
    }
    if (code !== null) { code.push(sourceLine); continue }
    for (const line of sourceLine.replace(/[ \t]+[•●▪]\s*/g, '\n• ').split('\n')) {
      const value = line.trim()
      if (!value) { flush(); continue }
      const bullet = /^(?:[•●▪*-]\s+|\d+[.)]\s+)(.+)$/.exec(value)
      if (bullet) {
        if (paragraph.length) { blocks.push({ type: 'paragraph', text: paragraph.join(' ') }); paragraph = [] }
        const number = /^(\d+)[.)]/.exec(value)
        const start = number ? Number(number[1]) : null
        if (list && (list.start === null) !== (start === null)) flush()
        if (!list) list = { items: [], start }
        list.items.push(bullet[1])
      } else if (/^(?:#{1,4}\s+.+|[^.!?;{}]{3,70}:)$/.test(value)) {
        flush()
        blocks.push({ type: 'heading', text: value.replace(/^#{1,4}\s+|:$/g, '') })
      } else {
        if (list) list.items[list.items.length - 1] += ` ${value}`
        else {
          paragraph.push(value)
          if (/[.!?]$/.test(value) && paragraph.join(' ').length >= 180) flush()
        }
      }
    }
  }
  flush()
  if (code !== null) blocks.push({ type: 'code', text: code.join('\n') })
  return blocks
}
