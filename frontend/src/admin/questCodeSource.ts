export interface CodeExcerpt { start: number; end: number; code: string }

/** Mask in one pass so comment markers inside literals cannot swallow real code. */
const maskLiterals = (code: string): string => code.replace(
  /(?:u8|u|U|L)?R"([^\s()\\]{0,16})\([\s\S]*?\)\1"|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
  match => match.replace(/[^\r\n]/g, ' '),
)

const balanced = (code: string): boolean => {
  const stack: string[] = []
  const closing: Record<string, string> = { ')': '(', '}': '{', ']': '[' }
  for (const character of maskLiterals(code)) {
    if ('({['.includes(character)) stack.push(character)
    else if (')}]'.includes(character) && stack.pop() !== closing[character]) return false
  }
  return stack.length === 0
}

/** Extract complete snippets; never reformat punctuation inside strings or loops. */
export const extractCodeExcerpts = (text: string): CodeExcerpt[] => {
  if ((text.match(/```/g)?.length ?? 0) % 2 !== 0) throw new Error('A code block is missing its closing fence. Correct the lesson text before importing it.')
  const excerpts: CodeExcerpt[] = []
  for (const match of text.matchAll(/```(?:cpp|c\+\+|c)?[ \t]*\n([\s\S]*?)```/gi)) {
    const code = match[1].trim()
    if (!balanced(code)) throw new Error('A C++ code block has unmatched brackets. Correct the source PDF before generating code activities.')
    excerpts.push({ start: match.index, end: match.index + match[0].length, code })
  }
  const masked = maskLiterals(text)
  for (const match of masked.matchAll(/(?:^[ \t]*#include[^\n]*\n\s*)*(?:using\s+namespace\s+std\s*;\s*)?int\s+main\s*\([^)]*\)\s*\{/gm)) {
    if (excerpts.some(item => match.index >= item.start && match.index < item.end)) continue
    let depth = 1
    let end = match.index + match[0].length
    for (; end < masked.length && depth > 0; end++) {
      if (masked[end] === '{') depth++
      if (masked[end] === '}') depth--
    }
    const code = text.slice(match.index, end).trim()
    if (depth !== 0 || !balanced(code)) throw new Error('A C++ main() example is incomplete. Check its closing brackets in the PDF.')
    excerpts.push({ start: match.index, end, code })
  }
  for (const match of text.matchAll(/(?:^|\n)[ \t]*(?:Example|Code|Snippet)\s*:[ \t]*([^\n]+)/gi)) {
    if (excerpts.some(item => match.index >= item.start && match.index < item.end)) continue
    const candidate = match[1]
    const scan = maskLiterals(candidate)
    const end = scan.indexOf(';')
    if (end < 0 || !/^(?:(?:const\s+)?(?:int|double|float|char|bool|(?:std::)?string)\s+|(?:std::)?(?:cout\s*<<|cin\s*>>)|return\b)/.test(scan)) continue
    const code = candidate.slice(0, end + 1)
    if (balanced(code)) excerpts.push({ start: match.index, end: match.index + match[0].indexOf(candidate) + end + 1, code })
  }
  return excerpts.sort((a, b) => a.start - b.start)
}

export const makeCodeBlank = (code: string): { code: string; answer: string } | null => {
  if (code.includes('___')) return null
  const token = /\b(?:int|double|float|char|bool|string|for|while|if|return|cout|cin)\b/.exec(maskLiterals(code))
  if (!token) return null
  return { code: `${code.slice(0, token.index)}___${code.slice(token.index + token[0].length)}`, answer: token[0] }
}
