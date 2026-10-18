export interface CodeExcerpt { start: number; end: number; code: string }

/** Mask in one pass so comment markers inside literals cannot swallow real code. */
const maskLiterals = (code: string): string => code.replace(
  /(?:u8|u|U|L)?R"([^\s()\\]{0,16})\([\s\S]*?\)\1"|"(?:\\[\s\S]|[^"\\\r\n])*"|(?<![A-Za-z0-9_])'(?:\\[\s\S]|[^'\\\r\n])*'|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
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
  for (const match of masked.matchAll(/(?:^[ \t]*#include[^\n]*\n\s*)*(?:using\s+namespace\s+std\s*;\s*)?(?:void|int|double|float|char|bool|auto|(?:std::)?string)\s+[A-Za-z_]\w*\s*\([^;{}]*\)\s*\{/gm)) {
    if (excerpts.some(item => match.index >= item.start && match.index < item.end)) continue
    let depth = 1
    let end = match.index + match[0].length
    for (; end < masked.length && depth > 0; end++) {
      if (masked[end] === '{') depth++
      if (masked[end] === '}') depth--
    }
    const code = text.slice(match.index, end).trim()
    if (depth !== 0 || !balanced(code)) throw new Error('A C++ function example is incomplete. Check its closing brackets in the PDF.')
    excerpts.push({ start: match.index, end, code })
  }
  for (const match of masked.matchAll(/(?:^|\n|[•●▪])[ \t]*((?:(?:const|static|unsigned|signed)\s+)*(?:void|int|double|float|char|bool|auto|(?:std::)?string)\s+[A-Za-z_]\w*\s*(?:\[|=|;|\()|(?:std::)?(?:cout\s*<<|cin\s*>>)|[A-Za-z_]\w*\s*\[[^\]\n]+\]\s*=)/gm)) {
    const start = match.index + match[0].indexOf(match[1])
    if (excerpts.some(item => start >= item.start && start < item.end)) continue
    const end = masked.indexOf(';', start) + 1
    if (end <= start) continue
    const code = text.slice(start, end).trim()
    if (balanced(code)) excerpts.push({ start, end, code })
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
  return excerpts.sort((a, b) => a.start - b.start).filter((item, index, sorted) =>
    !sorted.slice(0, index).some(previous => item.start >= previous.start && item.end <= previous.end)
  )
}

export type CodeBlankKind = 'type' | 'control' | 'stream' | 'operator' | 'number'
export interface CodeBlank { code: string; answer: string; kind: CodeBlankKind }

/** Exercise different roles in an example without blanking comments or string contents. */
export const makeCodeBlanks = (code: string): CodeBlank[] => {
  if (code.includes('___')) return []
  const masked = maskLiterals(code)
  const candidates = new Map<CodeBlankKind, CodeBlank[]>()
  const seen = new Set<string>()
  for (const token of masked.matchAll(/\b(?:void|auto|const|static|unsigned|signed|int|double|float|char|bool|string|for|while|if|else|return|break|continue|cout|cin|\d+(?:\.\d+)?)\b|\+\+|--|<<|>>|<=|>=|==|!=|&&|\|\||[=+*/%<>-]/g)) {
    const lineStart = masked.lastIndexOf('\n', token.index) + 1
    if (masked.slice(lineStart, token.index).trimStart().startsWith('#')) continue
    const answer = token[0]
    const kind: CodeBlankKind = /^(?:void|auto|const|static|unsigned|signed|int|double|float|char|bool|string)$/.test(answer) ? 'type'
      : /^(?:cout|cin)$/.test(answer) ? 'stream'
      : /^\d/.test(answer) ? 'number'
      : /^\w/.test(answer) ? 'control' : 'operator'
    const key = `${kind}:${answer}`
    if (seen.has(key)) continue
    seen.add(key)
    const blank = { kind, answer, code: `${code.slice(0, token.index)}___${code.slice(token.index + answer.length)}` }
    candidates.set(kind, [...(candidates.get(kind) ?? []), blank])
  }
  const result: CodeBlank[] = []
  const limit = code.split('\n').length > 3 ? 4 : 3
  for (const group of candidates.values()) {
    if (result.length < limit) result.push(group[0])
  }
  return result
}
