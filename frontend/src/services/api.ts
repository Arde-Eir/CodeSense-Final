// frontend/src/services/api.ts
import type { AnalysisResult } from '../types';

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ??
  import.meta.env.VITE_API_URL ??
  ''
).trim().replace(/\/+$/, '');
const TIMEOUT_MS = 30_000;
const IS_PROD = import.meta.env.PROD;
const ANALYZE_URL = API_BASE_URL
  ? `${API_BASE_URL}/api/analyze`
  : '/api/analyze';

interface AnalyzeCodeOptions {
  currentLevel?: number;
  hintsUsed?: number;
}

// Cancel any in-flight request when a new one is submitted
let _activeController: AbortController | null = null;

export const analyzeCode = async (
  sourceCode: string,
  options: AnalyzeCodeOptions | number = {}
): Promise<AnalysisResult> => {
  const { currentLevel, hintsUsed = 0 } =
    typeof options === 'number' ? { currentLevel: options, hintsUsed: 0 } : options;

  if (IS_PROD && !API_BASE_URL) {
    throw new Error('Missing VITE_API_BASE_URL in production build');
  }
  // Abort the previous request if still pending
  if (_activeController) {
    _activeController.abort();
  }

  const controller = new AbortController();
  _activeController = controller;

  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(ANALYZE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tunnel-Skip-AntiPhishing-Page': 'true',
      },
      body: JSON.stringify({ sourceCode, hintsUsed, currentLevel }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(`Backend returned status: ${response.status}`);
      throw new Error('Analysis failed');
    }

    const result = await response.json();
    return enforceStrictPreprocessorDependencies(sourceCode, result);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Analysis timed out or was cancelled');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (_activeController === controller) {
      _activeController = null;
    }
  }
};

type DependencyRule = {
  header: string;
  alternateHeaders?: string[];
  legacyHeaders?: string[];
  pattern: RegExp;
  message: string;
};

const STRICT_DEPENDENCY_RULES: DependencyRule[] = [
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

function stripCommentsAndLiterals(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, match => ' '.repeat(match.length))
    .replace(/\/\/[^\n\r]*/g, match => ' '.repeat(match.length))
    .replace(/(?:u8|u|U|L)?R"([^(]*)\([\s\S]*?\)\1"/g, match => ' '.repeat(match.length))
    .replace(/(?:u8|u|U|L)?"(?:\\[\s\S]|[^"\\])*"/g, match => ' '.repeat(match.length))
    .replace(/(?:u|U|L)?'(?:\\[\s\S]|[^'\\])*'/g, match => ' '.repeat(match.length));
}

function includedHeaders(source: string): Set<string> {
  const headers = new Set<string>();
  for (const match of source.matchAll(/#include\s*<([^>]+)>/g)) {
    headers.add(match[1].trim());
  }
  return headers;
}

function enforceStrictPreprocessorDependencies(
  sourceCode: string,
  result: AnalysisResult,
): AnalysisResult {
  const headers = includedHeaders(sourceCode);
  const scanSource = stripCommentsAndLiterals(sourceCode);
  const errors = STRICT_DEPENDENCY_RULES.flatMap(rule => {
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

  if (errors.length === 0) return result;

  return {
    ...result,
    success: false,
    errors: [...(result.errors ?? []), ...errors],
    safetyChecks: [],
    cfg: { nodes: [], edges: [] },
    gamification: result.gamification
      ? { ...result.gamification, xpEarned: 0, qualityBonus: 0 }
      : result.gamification,
    explanations: [
      '❌ **Status:** Strict Dependency Check Failed.',
      ...errors.map(error => `🔗 ${error.message}`),
      ...(result.explanations ?? []).filter(entry => !entry.includes('Analysis Successful')),
    ],
  };
}
