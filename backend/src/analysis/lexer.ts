/**
 * Lexical Analyzer (Tokenizer)
 * Converts raw C++ source code into a stream of tokens using regex patterns.
 * Phase 1 (Structure) – Step 1 of the analysis pipeline.
 *
 * FIXES vs original:
 *  - Raw string literals  R"(...)"  R"TAG(...)TAG"
 *  - Unicode/wide char/string literals  L"..." u"..." U"..." u8"..."
 *  - Macro expansion for #define IDENTIFIER value tokens
 *  - Long-long / unsigned-long-long integer suffixes
 *  - Binary literal 0b… / 0B…
 *  - Octal literals 0[0-7]+
 *  - nullptr_t token
 */

import { Token } from '../types';

export interface LexerResult {
  tokens: Token[];
  errors: Array<{ message: string; line: number; column: number }>;
}

// ---------------------------------------------------------------------------
// Token pattern table — ORDER IS CRITICAL (first match wins, loop breaks)
// ---------------------------------------------------------------------------
const TOKEN_PATTERNS: Array<{ type: Token['type']; pattern: RegExp }> = [
  { type: 'Comment',    pattern: /\/\*[\s\S]*?\*\//y },
  { type: 'Comment',    pattern: /\/\/[^\n]*/y },
  { type: 'Keyword',    pattern: /#\s*(include|define|undef|ifdef|ifndef|endif|elif|if|else|pragma|error|warning|line)\b/y },
  { type: 'Keyword',    pattern: /(auto|bool|break|case|catch|char|class|const|constexpr|continue|default|delete|do|double|else|enum|explicit|extern|false|final|float|for|friend|goto|if|inline|int|long|mutable|namespace|new|nullptr|operator|override|private|protected|public|register|return|short|signed|sizeof|static|string|struct|switch|template|this|throw|true|try|typedef|typename|union|unsigned|using|virtual|void|volatile|while)\b/y },
  { type: 'Literal',    pattern: /(?:u8|u|U|L)?R"([^(]*)\([\s\S]*?\)\1"/y },
  { type: 'Literal',    pattern: /(?:u8|u|U|L)"(\\(?:[abfnrtvx\\'"?\n0]|[0-7]{1,3}|x[0-9a-fA-F]{1,2})|[^"\\])*"/y },
  { type: 'Literal',    pattern: /(?:u|U|L)'(\\(?:[abfnrtvx\\'"?0]|[0-7]{1,3}|x[0-9a-fA-F]{1,2})|[^'\\])'/y },
  { type: 'Literal',    pattern: /0[bB][01]+[uUlL]{0,3}/y },
  { type: 'Literal',    pattern: /0[xX][0-9a-fA-F]+[uUlL]{0,3}/y },
  { type: 'Literal',    pattern: /0[0-7]+[uUlL]{0,3}/y },
  { type: 'Literal',    pattern: /(?:[0-9]*\.[0-9]+|[0-9]+\.)(?:[eE][+-]?[0-9]+)?[fFlL]?|[0-9]+[eE][+-]?[0-9]+[fFlL]?/y },
  { type: 'Literal',    pattern: /[0-9]+[uU]?[lL]{0,2}/y },
  { type: 'Literal',    pattern: /'(\\(?:[abfnrtvx\\'"?0]|[0-7]{1,3}|x[0-9a-fA-F]{1,2})|[^'\\])'/y },
  { type: 'Literal',    pattern: /"(\\(?:[abfnrtvx\\'"?\n0]|[0-7]{1,3}|x[0-9a-fA-F]{1,2})|[^"\\])*"/y },
  { type: 'Identifier', pattern: /(cout|cin|cerr|clog|endl|getline|fixed|setprecision|setw|setfill|showpoint|left|right|boolalpha|noboolalpha|pow|sqrt|abs|fabs|ceil|floor|round|fmod|log|log2|log10|exp|sin|cos|tan|asin|acos|atan|atan2|system|exit|rand|srand|stoi|stod|stof|stol|stoul|to_string|ifstream|ofstream|fstream|size_t|nullptr_t)\b/y },
  { type: 'Identifier', pattern: /[a-zA-Z_][a-zA-Z0-9_]*/y },
  { type: 'Operator',   pattern: /(<<=|>>=)/y },
  { type: 'Operator',   pattern: /(->|::|==|!=|<=|>=|&&|\|\||\+\+|--|<<|>>|\+=|-=|\*=|\/=|%=|&=|\|=|\^=)/y },
  { type: 'Operator',   pattern: /[+\-*\/%=<>!&|^~?:.]/y },
  { type: 'Separator',  pattern: /[(){}\[\];,]/y },
];

// ---------------------------------------------------------------------------
// Simple #define macro table built during tokenization
// ---------------------------------------------------------------------------
type MacroTable = Map<string, string>;

function buildMacroTable(sourceCode: string): MacroTable {
  const macros: MacroTable = new Map();
  // Match:  #define IDENT   value_until_end_of_line
  const re = /^[ \t]*#[ \t]*define[ \t]+([A-Za-z_][A-Za-z0-9_]*)(?:[ \t]+([^\n]*))?/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sourceCode)) !== null) {
    const name = m[1];
    const value = (m[2] || '').trim();
    // Only track simple object-like macros (no parentheses = not a function-like macro)
    if (!value.startsWith('(') && name !== value) {
      macros.set(name, value);
    }
  }
  return macros;
}

// ---------------------------------------------------------------------------
// Expand macro occurrences in source (one level deep, guarded against cycles)
// ---------------------------------------------------------------------------
function expandMacros(sourceCode: string, macros: MacroTable): string {
  if (macros.size === 0) return sourceCode;
  // Remove #define lines first so we don't re-expand inside them
  let expanded = sourceCode.replace(/^[ \t]*#[ \t]*define[^\n]*/gm, match => ' '.repeat(match.length));
  macros.forEach((value, name) => {
    // Word-boundary replacement; skip if replacement would be circular
    if (value === name) return;
    try {
      const re = new RegExp(`\\b${name}\\b`, 'g');
      expanded = expanded.replace(re, value);
    } catch (_) {
      // malformed macro name — skip safely
    }
  });
  return expanded;
}

// ---------------------------------------------------------------------------
// Main tokenize function
// ---------------------------------------------------------------------------

const wsRegex = /[ \t]+/y;

export function tokenize(sourceCode: string): LexerResult {
  const tokens: Token[] = [];
  const errors: Array<{ message: string; line: number; column: number }> = [];

  // Phase 0: collect and expand macros
  const macros = buildMacroTable(sourceCode);
  const workingSource = expandMacros(sourceCode, macros);
  let line   = 1;
  let column = 1;
  let pos    = 0;

  while (pos < workingSource.length) {

    // Horizontal whitespace

    wsRegex.lastIndex = pos;
    const wsMatch = wsRegex.exec(workingSource);
    
    if (wsMatch) {
      column += wsMatch[0].length;
      pos += wsMatch[0].length;
      continue;
    }

    // CRLF or LF newlines
    if (workingSource[pos] === '\r') {
      pos++;
      if (workingSource[pos] === '\n') pos++;
      line++;
      column = 1;
      continue;
    }
    if (workingSource[pos] === '\n') {
      line++;
      column = 1;
      pos++;
      continue;
    }

    // Try every token pattern in order
    // Replace your entire for...of loop and the "Nothing matched" block with this:
    let matched = false;

    for (const { type, pattern } of TOKEN_PATTERNS) {
      // 1. Point the regex to look exactly at the current position
      pattern.lastIndex = pos;

      // 2. Use .exec() instead of .match(). 
      // Because of the 'y' flag, it only checks the string at exactly 'pos'
      const match = pattern.exec(workingSource);

      if (!match) continue;

      const value = match[0];

      // 3. Keep your original logic for Comments
      if (type !== 'Comment') {
        tokens.push({ type, value, line, column });
      }

      // 4. Efficiently handle multi-line tokens (raw strings, block comments)
      const parts = value.split('\n');
      if (parts.length > 1) {
        line += parts.length - 1;
        column = parts[parts.length - 1].length + 1;
      } else {
        column += value.length;
      }

      // 5. Update the master position
      pos += value.length;
      matched = true;
      break;
    }

    // 6. Error handling for unknown characters
    if (!matched) {
      const ch = workingSource[pos];
      errors.push({
        message: `Unexpected character '${ch}' (code: ${ch.charCodeAt(0)})`,
        line,
        column,
      });
      pos++;
      column++;
    }
  }
  return { tokens, errors }; 
} 

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

export function formatTokens(tokens: Token[]): string {
  if (tokens.length === 0) return '(no tokens)';
  const maxType  = Math.max(...tokens.map(t => t.type.length));
  const maxValue = Math.max(...tokens.map(t => t.value.length));
  const header   = `${'Type'.padEnd(maxType)} | ${'Value'.padEnd(maxValue)} | Location`;
  const sep      = '-'.repeat(header.length);
  const rows     = tokens.map(t =>
    `${t.type.padEnd(maxType)} | ${t.value.padEnd(maxValue)} | L${t.line}:C${t.column}`
  );
  return [header, sep, ...rows].join('\n');
}

export function extractKeywords(tokens: Token[]): string[] {
  return tokens.filter(t => t.type === 'Keyword').map(t => t.value);
}

export function extractIdentifiers(tokens: Token[]): Set<string> {
  return new Set(tokens.filter(t => t.type === 'Identifier').map(t => t.value));
}

export function hasConstruct(tokens: Token[], keyword: string): boolean {
  return tokens.some(t => t.type === 'Keyword' && t.value === keyword);
}

export function countOperators(tokens: Token[]): Record<string, number> {
  const counts: Record<string, number> = {};
  tokens
    .filter(t => t.type === 'Operator')
    .forEach(t => { counts[t.value] = (counts[t.value] || 0) + 1; });
  return counts;
}

export function tokenSummary(tokens: Token[]): Record<string, number> {
  const summary: Record<string, number> = {};
  tokens.forEach(t => { summary[t.type] = (summary[t.type] || 0) + 1; });
  return summary;
}