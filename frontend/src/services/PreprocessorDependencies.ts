import type { AnalysisError } from '@/types';

export type DependencyRule = {
  header: string;
  alternateHeaders?: string[];
  legacyHeaders?: string[];
  pattern: RegExp;
  message: string;
};

export const STRICT_DEPENDENCY_RULES: DependencyRule[] = [
  {
    header: 'iostream',
    legacyHeaders: ['iostream.h', 'stdio.h', 'cstdio'],
    pattern: /\b(?:std::)?(cout|cin|cerr|clog|endl)\b/,
    message: "I/O objects/manipulators (cout, cin, cerr, endl, etc.) require '#include <iostream>'",
  },
  {
    header: 'iomanip',
    legacyHeaders: ['iomanip.h'],
    pattern: /\b(?:std::)?(setw|setprecision|setfill|fixed|showpoint|left|right|boolalpha|noboolalpha)\b/,
    message: "Formatting manipulators (setw, setprecision, fixed, etc.) require '#include <iomanip>'",
  },
  {
    header: 'string',
    legacyHeaders: ['string.h', 'cstring'],
    pattern: /\b(?:std::)?string\b|\b(?:std::)?(getline|stoi|stod|stof|stol|stoul|to_string)\s*\(/,
    message: "String types/functions (string, getline, stoi, to_string, etc.) require '#include <string>'",
  },
  {
    header: 'cmath',
    alternateHeaders: ['math.h'],
    pattern: /\b(?:std::)?(pow|sqrt|abs|fabs|ceil|floor|round|fmod|log|log2|log10|exp|sin|cos|tan|asin|acos|atan|atan2)\s*\(/,
    message: "Math functions (pow, sqrt, etc.) require '#include <cmath>'",
  },
  {
    header: 'fstream',
    legacyHeaders: ['fstream.h'],
    pattern: /\b(?:std::)?(ifstream|ofstream|fstream)\b/,
    message: "File stream types (ifstream, ofstream, fstream) require '#include <fstream>'",
  },
  {
    header: 'cstdlib',
    legacyHeaders: ['stdlib.h'],
    pattern: /\b(?:std::)?(rand|srand|exit|system)\s*\(/,
    message: "C standard utility functions (rand, srand, exit, system) require '#include <cstdlib>'",
  },
];

export function stripCommentsAndLiterals(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, match => ' '.repeat(match.length))
    .replace(/\/\/[^\n\r]*/g, match => ' '.repeat(match.length))
    .replace(/(?:u8|u|U|L)?R"([^(]*)\([\s\S]*?\)\1"/g, match => ' '.repeat(match.length))
    .replace(/(?:u8|u|U|L)?"(?:\\[\s\S]|[^"\\])*"/g, match => ' '.repeat(match.length))
    .replace(/(?:u|U|L)?'(?:\\[\s\S]|[^'\\])*'/g, match => ' '.repeat(match.length));
}

export function includedHeaders(source: string): Set<string> {
  const headers = new Set<string>();
  for (const match of source.matchAll(/#include\s*<([^>]+)>/g)) {
    headers.add(match[1].trim());
  }
  return headers;
}

export function detectRequiredHeaders(source: string): string[] {
  const scanSource = stripCommentsAndLiterals(source);
  return STRICT_DEPENDENCY_RULES
    .filter(rule => rule.pattern.test(scanSource))
    .map(rule => rule.header);
}

export function findPreprocessorDependencyErrors(sourceCode: string): AnalysisError[] {
  const headers = includedHeaders(sourceCode);
  const scanSource = stripCommentsAndLiterals(sourceCode);

  return STRICT_DEPENDENCY_RULES.flatMap(rule => {
    const acceptableHeaders = [rule.header, ...(rule.alternateHeaders ?? [])];
    if (!rule.pattern.test(scanSource) || acceptableHeaders.some(header => headers.has(header))) {
      return [];
    }

    const wrongHeader = (rule.legacyHeaders ?? []).find(header => headers.has(header));
    return [{
      type: 'semantic' as const,
      severity: 'error' as const,
      message: wrongHeader
        ? `Wrong preprocessor directive: '#include <${wrongHeader}>' does not satisfy this C++ use. Use '#include <${rule.header}>'.`
        : `Missing preprocessor directive: ${rule.message}`,
      line: 1,
      column: 1,
    }];
  });
}
