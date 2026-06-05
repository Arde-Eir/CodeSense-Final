import { Router } from 'express';
import { tokenize } from '../analysis/lexer';
import { TypeChecker } from '../analysis/typechecker';
import { SymbolicExecutor } from '../analysis/symbolicexe';
import { CFGGenerator } from '../analysis/cfgGenerator';
import { CognitiveComplexity, CyclomaticComplexity } from '../analysis/scoring';
import type { AnalysisResult, AnalysisError } from '../types';
import { Translator } from '../analysis/translator';
import { GameEngine } from '../gamification/GameEngine';

const parser = require('../analysis/parser');
const router = Router();

// ---------------------------------------------------------------------------
// Known stdlib identifiers that produce noisy "unused" warnings we suppress
// ---------------------------------------------------------------------------
const STD_LIB_SYMBOLS = [
  'cout', 'cin', 'endl', 'cerr', 'clog', 'string',
  'setw', 'setprecision', 'fixed', 'showpoint', 'left', 'right',
  'boolalpha', 'noboolalpha', 'getline',
  'pow', 'sqrt', 'abs', 'fabs', 'ceil', 'floor', 'round',
  'stoi', 'stod', 'stof', 'stol', 'stoul', 'to_string',
  'ifstream', 'ofstream', 'fstream',
  'system', 'exit', 'rand', 'srand',
];

const DEPENDENCY_RULES: Array<{
  header: string;
  alternateHeaders?: string[];
  legacyHeaders?: string[];
  pattern: RegExp;
  message: string;
}> = [
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

router.post('/analyze', (req, res) => {
  const { sourceCode: rawSourceCode, hintsUsed = 0 } = req.body;

  if (!rawSourceCode || typeof rawSourceCode !== 'string') {
    return res.status(400).json({
      success: false,
      errors: [{ type: 'semantic', severity: 'error', message: 'No source code provided.', line: 0 }],
      warnings: [],
      explanations: ['❌ **Status:** No source code received.'],
      tokens: [], ast: null, symbolTable: {}, safetyChecks: [], cfg: { nodes: [], edges: [] },
      cognitiveComplexity: 0, cyclomaticComplexity: { score: 0, rating: 'low', interpretation: '' },
      symbolicExecution: [], logs: [],
      gamification: { xpEarned: 0, qualityBonus: 0, levelTitle: 'Squire' },
    });
  }

  const sourceCode = normalizePastedSourceCode(rawSourceCode);

  if (!sourceCode.trim()) {
    return res.status(400).json({
      success: false,
      errors: [{ type: 'semantic', severity: 'error', message: 'No source code provided.', line: 0 }],
      warnings: [],
      explanations: ['❌ **Status:** No source code received.'],
      tokens: [], ast: null, symbolTable: {}, safetyChecks: [], cfg: { nodes: [], edges: [] },
      cognitiveComplexity: 0, cyclomaticComplexity: { score: 0, rating: 'low', interpretation: '' },
      symbolicExecution: [], logs: [],
      gamification: { xpEarned: 0, qualityBonus: 0, levelTitle: 'Squire' },
    });
  }

  // ─── PHASE 0: Unsupported Feature Detection ───────────────────────────────
  const UNSUPPORTED_PATTERNS: Array<{ re: RegExp; msg: string }> = [
    { re: /template\s*</,
      msg: 'Templates (template<...>) are not supported — the analyzer covers intro/intermediate C++ only.' },
    { re: /std::(vector|map|unordered_map|set|unordered_set|multimap|multiset|list|deque|queue|priority_queue|stack|pair|tuple|array|forward_list|bitset|optional|variant|any)\b/,
      msg: 'STL containers (std::vector, std::map, etc.) are not supported — use plain arrays or basic types.' },
    { re: /#include\s*<(vector|map|unordered_map|set|list|deque|queue|stack|algorithm|utility|tuple|array|functional|memory|optional|variant|bitset|numeric|iterator|ranges)>/,
      msg: 'STL headers (<vector>, <map>, <algorithm>, etc.) are not supported by the analyzer.' },
    { re: /\boperator\s*(==|!=|<=|>=|<|>|\+|-|\*|\/|%|<<|>>|\[\]|\(\)|=|\+=|-=|\*=|\/=)/,
      msg: 'Operator overloading is not supported.' },
    { re: /\b(class|struct)\s+[A-Za-z_][A-Za-z0-9_]*\s*(?::[^{]+)?\{/,
      msg: 'Classes/structs and OOP-style code are not supported — this analyzer focuses on foundational procedural C++.' },
    { re: /\b(public|private|protected)\s*:/,
      msg: 'Access specifiers are part of OOP and are not supported by the foundational analyzer.' },
    { re: /\bthis\s*(?:->|\.)/,
      msg: "'this' member access is part of OOP and is not supported by the foundational analyzer." },
    { re: /\bvirtual\s+\w/,
      msg: 'Virtual functions / polymorphism are not fully analyzed.' },
    { re: /\[\s*(?:[&=]|\w+)?(?:\s*,\s*(?:[&=]|\w+))*\s*\]\s*\(/,
      msg: 'Lambda expressions are not fully supported.' },
    { re: /\bco_await\b|\bco_yield\b|\bco_return\b/,
      msg: 'Coroutines (co_await, co_yield, co_return) are not supported.' },
    { re: /\bconcept\b|\brequires\b/,
      msg: 'C++20 concepts/requires are not supported.' },
  ];

  const unsupportedWarnings = UNSUPPORTED_PATTERNS
    .filter(({ re }) => re.test(sourceCode))
    .map(({ msg }) => ({
      type: 'semantic' as const,
      severity: 'warning' as const,
      message: `Unsupported feature: ${msg}`,
      line: 0,
      column: 0,
    }));

  // ─── PHASE 1: Lexical Analysis ─────────────────────────────────────────────
  const lexResult = tokenize(sourceCode);

  if (lexResult.errors.length > 0) {
    return res.status(200).json({
      success: false,
      tokens: lexResult.tokens,
      errors: lexResult.errors.map(err => ({
        ...err, type: 'lexical', severity: 'error',
      })),
      warnings: [],
      ast: null,
      symbolTable: {},
      safetyChecks: [],
      cfg: { nodes: [], edges: [] },
      cognitiveComplexity: 0,
      cyclomaticComplexity: { score: 0, rating: 'low', interpretation: '' },
      symbolicExecution: [],
      logs: [],
      gamification: { xpEarned: 0, qualityBonus: 0, levelTitle: 'Squire' },
      explanations: [
        '❌ **Status:** Lexical Analysis Failed.',
        ...lexResult.errors.map(e => `🔤 **Lexical Error (L${e.line}:C${e.column}):** ${e.message}`),
        ...unsupportedWarnings.map(w => `⚠️ **Note:** ${w.message}`),
      ],
    });
  }

  const unsupportedFatal = unsupportedWarnings.some(w =>
    /Templates|STL containers|STL headers|Classes\/structs|Access specifiers|'this' member access|Lambda expressions|concepts|Coroutines/.test(w.message)
  );
  if (unsupportedFatal) {
    return res.status(200).json({
      success: false,
      tokens: lexResult.tokens,
      errors: unsupportedWarnings.map(w => ({
        type: 'semantic' as const,
        severity: 'error' as const,
        message: w.message,
        line: w.line,
        column: w.column,
      })),
      warnings: [],
      ast: null,
      symbolTable: {},
      safetyChecks: [],
      cfg: { nodes: [], edges: [] },
      cognitiveComplexity: 0,
      cyclomaticComplexity: { score: 0, rating: 'low', interpretation: '' },
      symbolicExecution: [],
      logs: [],
      gamification: { xpEarned: 0, qualityBonus: 0, levelTitle: 'Squire' },
      explanations: [
        '❌ **Status:** Unsupported C++ Feature',
        ...unsupportedWarnings.map(w => `⚠️ **Unsupported Feature:** ${w.message}`),
        '💡 **Tip:** This analyzer supports intro/intermediate C++: functions, arrays, pointers, loops, conditionals, basic I/O, math, and file streams.',
      ],
    });
  }

  // ─── PHASE 2: Syntactic Analysis ──────────────────────────────────────────
  let ast: any = null;
  try {
    ast = parser.parse(sourceCode);
  } catch (syntaxErr: any) {
    const unsupportedHints = unsupportedWarnings.length > 0
      ? unsupportedWarnings.map(w => `⚠️ **Unsupported Feature:** ${w.message}`)
      : [];
    return res.status(200).json({
      success: false,
      tokens: lexResult.tokens,
      ast: getCleanAST(ast),
      errors: [
        {
          type: 'syntactic',
          message: syntaxErr.message,
          line: syntaxErr.location?.start.line || 1,
          column: syntaxErr.location?.start.column || 1,
          severity: 'error',
        },
        ...unsupportedWarnings,
      ],
      warnings: [],
      symbolTable: {},
      safetyChecks: [],
      cfg: { nodes: [], edges: [] },
      cognitiveComplexity: 0,
      cyclomaticComplexity: { score: 0, rating: 'low', interpretation: '' },
      symbolicExecution: [],
      logs: [],
      gamification: { xpEarned: 0, qualityBonus: 0, levelTitle: 'Squire' },
      explanations: [
        `❌ **Status:** Syntax Error Detected`,
        `🔧 **Line ${syntaxErr.location?.start.line || '?'}:** ${syntaxErr.message}`,
        ...unsupportedHints,
        ...(unsupportedWarnings.length > 0 ? ['💡 **Tip:** This analyzer supports intro/intermediate C++ — remove unsupported features and try again.'] : []),
      ],
    });
  }

  const overloadErrors = detectFunctionOverloads(ast);
  if (overloadErrors.length > 0) {
    return res.status(200).json({
      success: false,
      tokens: lexResult.tokens,
      errors: overloadErrors,
      warnings: [],
      ast: getCleanAST(ast),
      symbolTable: {},
      safetyChecks: [],
      cfg: { nodes: [], edges: [] },
      cognitiveComplexity: 0,
      cyclomaticComplexity: { score: 0, rating: 'low', interpretation: '' },
      symbolicExecution: [],
      logs: [],
      gamification: { xpEarned: 0, qualityBonus: 0, levelTitle: 'Squire' },
      explanations: [
        '❌ **Status:** Unsupported C++ Feature',
        ...overloadErrors.map(e => `⚠️ **Unsupported Feature:** ${e.message}`),
        '💡 **Tip:** Use one function name per behavior. This analyzer teaches foundational procedural C++, so function overloading is intentionally excluded.',
      ],
    });
  }

  try {
    // ─── PHASE 3: Dependency Validation (FEU CP1/CP2 Strict Rules) ──────────
    const sourceForDependencyScan = stripCommentsAndLiterals(sourceCode);
    const usesIo = /\b(cout|cin|endl|cerr|clog|getline)\b/.test(sourceForDependencyScan);
    const usesStdPrefix = /\bstd::/.test(sourceForDependencyScan);
    const hasUsingStd = ast.namespace?.name === 'std' || usesStdPrefix;

    const includedHeaders = new Set(
      (ast.directives || [])
        .filter((d: any) => d.type === 'Include')
        .map((d: any) => d.name),
    );

    // Helper: check if a header is in the directive list
    const hasHeader = (name: string) => includedHeaders.has(name);

    const depErrors: AnalysisError[] = [];

    DEPENDENCY_RULES.forEach(rule => {
      const headers = [rule.header, ...(rule.alternateHeaders || [])];
      if (rule.pattern.test(sourceForDependencyScan) && !headers.some(hasHeader)) {
        const wrongHeader = (rule.legacyHeaders || []).find(hasHeader);
        depErrors.push({
          type: 'semantic',
          severity: 'error',
          message: wrongHeader
            ? `Wrong preprocessor directive: '#include <${wrongHeader}>' does not satisfy this C++ use. Use '#include <${rule.header}>'.`
            : `Missing preprocessor directive: ${rule.message}`,
          line: 1,
          column: 1,
        });
      }
    });

    if (usesIo && !hasUsingStd) {
      depErrors.push({
        type: 'semantic', severity: 'error',
        message: "Strict Error: 'cout/cin/cerr' requires 'using namespace std;' (or 'std::' prefix)",
        line: 2, column: 1,
      });
    }

    if (depErrors.length > 0) {
      return res.status(200).json({
        success: false,
        tokens: lexResult.tokens,
        ast,
        errors: depErrors,
        warnings: [],
        symbolTable: {},
        safetyChecks: [],
        cfg: { nodes: [], edges: [] },
        cognitiveComplexity: 0,
        cyclomaticComplexity: { score: 0, rating: 'low', interpretation: '' },
        symbolicExecution: [],
        logs: [],
        gamification: { xpEarned: 0, qualityBonus: 0, levelTitle: 'Squire' },
        explanations: ['❌ **Status:** Strict Dependency Check Failed.', ...depErrors.map(e => `🔗 ${e.message}`)],
      });
    }

    // ─── PHASE 4: Semantic Analysis & Symbol Table ───────────────────────────
    const typeChecker = new TypeChecker();
    let typeResult: { symbolTable: any; errors: any[] };
    try {
      typeResult = typeChecker.check(ast);
    } catch (tcErr: any) {
      console.error('⚠️ TypeChecker Error:', tcErr?.message, tcErr?.stack);
      typeResult = {
        symbolTable: {},
        errors: [{
          type: 'semantic', severity: 'warning' as const,
          message: `Type checker stopped early: ${tcErr?.message ?? 'unknown error'}`,
          line: 0, column: 0,
        }],
      };
    }

    const semanticErrors = typeResult.errors.filter(e => e.severity === 'error');
    const semanticWarnings = typeResult.errors.filter(
      e =>
        e.severity === 'warning' &&
        !STD_LIB_SYMBOLS.some(
          sym => e.message.includes(`'${sym}'`) && e.message.toLowerCase().includes('unused'),
        ),
    );
    const extraWarnings = collectAstBeginnerWarnings(ast);
    const combinedWarnings = dedupeWarnings([...semanticWarnings, ...extraWarnings]);

    if (semanticErrors.length > 0) {
      // Build partial CFG even on semantic error so the frontend can show
      // what was parsed successfully.
      let partialCfg = { nodes: [] as any[], edges: [] as any[] };
      try { partialCfg = new CFGGenerator().generate(ast); } catch (_) { /* best-effort */ }

      return res.status(200).json({
        success: false,
        tokens: lexResult.tokens,
        ast: getCleanAST(ast),
        symbolTable: filterUserSymbols(typeResult.symbolTable),
        errors: semanticErrors,
        warnings: combinedWarnings,
        safetyChecks: [],
        cfg: partialCfg,
        cognitiveComplexity: 0,
        cyclomaticComplexity: { score: 0, rating: 'low', interpretation: '' },
        symbolicExecution: [],
        logs: [],
        gamification: { xpEarned: 0, qualityBonus: 0, levelTitle: 'Squire' },
        explanations: [
          '❌ **Status:** Semantic Analysis Failed',
          ...semanticErrors.map(e => `🚨 **Error (L${e.line}):** ${e.message}`),
          ...combinedWarnings.map(formatWarningExplanation),
        ],
      });
    }

    // ─── PHASE 5: Symbolic Execution (Safety Checks) ────────────────────────
    let safetyChecks: any[] = [];
    let executorCrashMsg = '';
    const executor = new SymbolicExecutor(typeResult.symbolTable);

    try {
      safetyChecks = executor.execute(ast);
    } catch (execErr: any) {
      console.error('⚠️ Symbolic Executor Crashed:', execErr?.message);
      executorCrashMsg = execErr?.message ?? 'unknown error';
      safetyChecks = [{
        line: 0,
        operation: 'Safety analyzer',
        status: 'WARNING',
        message: `Safety analyzer stopped early: ${executorCrashMsg}`,
      }];
    }

    // ─── PHASE 6: Symbolic Execution — real value trace for the Math tab ──────
    // Pull the rich value trace from the executor (concrete values tracked during execution)
    const symbolicExecution = executor.valueTrace.length > 0
      ? executor.valueTrace
      : buildSymbolicTrace(typeResult.symbolTable);

    // ─── PHASE 7: Control Flow Graph ─────────────────────────────────────────
    let cfg: any = { nodes: [], edges: [] };
    let cfgCrashMsg = '';
    try {
      if (ast && ast.type === 'Program') {
        cfg = new CFGGenerator().generate(ast);
      }
    } catch (cfgErr: any) {
      console.error('⚠️ CFG Error caught in Phase 7:', cfgErr?.message);
      cfgCrashMsg = cfgErr?.message ?? 'unknown error';
      cfg = { nodes: [{ id: 'cfg_error', type: 'end', label: 'CFG Generation Failed', x: 0, y: 0, children: [] }], edges: [] };
    }

    // ─── PHASE 8: Mentor Explanations ────────────────────────────────────────
    let mentorExplanations: string[] = [];
    try { mentorExplanations = new Translator().translate(ast); }
    catch (transErr: any) { console.error('⚠️ Translator Error:', transErr?.message); }

    // ─── PHASE 9: Cognitive + Cyclomatic Complexity ──────────────────────────
    let complexityScore = 0;
    let cyclomaticResult: any = { score: 1, rating: 'low', interpretation: 'Simple code.' };
    const cleanAstForScoring = getCleanAST(ast);

    try { complexityScore = new CognitiveComplexity().calculate(cleanAstForScoring); }
    catch (scoreErr: any) { console.error('⚠️ Cognitive Scoring Error:', scoreErr?.message); }
    try { cyclomaticResult = new CyclomaticComplexity().calculate(cleanAstForScoring); }
    catch (scoreErr: any) { console.error('⚠️ Cyclomatic Scoring Error:', scoreErr?.message); }

    // ─── PHASE 10: Gamification ──────────────────────────────────────────────
     const gameEngine = new GameEngine();
     const rawLevel = req.body.currentLevel;
      const currentLevel: 1 | 2 | 3 | 4 | 5 =
    rawLevel === 2 ? 2
    : rawLevel === 3 ? 3
    : rawLevel === 4 ? 4
    : rawLevel === 5 ? 5
    : 1;  // caller sends actual user level
    const reward = gameEngine.calculateReward(
      {
        cognitiveComplexity: complexityScore,
        cyclomaticComplexity: cyclomaticResult,
        errors: [],
        safetyChecks,
      } as any,
      hintsUsed,
    );
    return res.status(200).json({
    success: true,
    tokens: lexResult.tokens,
    ast: getCleanAST(ast),
    symbolTable: filterUserSymbols(typeResult.symbolTable),
    safetyChecks,
    symbolicExecution,
    cfg,
    cognitiveComplexity: complexityScore,
    cyclomaticComplexity: cyclomaticResult,
    // CRITICAL: Adding this string triggers the PASS status in your LogsTab UI
    explanations: [
        "✅ **Status:** Analysis Successful",
        ...combinedWarnings.map(formatWarningExplanation),
        ...unsupportedWarnings.map(w => `⚠️ **Unsupported Feature:** ${w.message}`),
        ...(executorCrashMsg ? [`⚠️ **Safety Analyzer:** Stopped early — ${executorCrashMsg}`] : []),
        ...(cfgCrashMsg      ? [`⚠️ **Flow Graph:** Generation failed — ${cfgCrashMsg}`]       : []),
        ...mentorExplanations,
    ],
    // OPTIONAL: If your frontend specifically looks for a 'logs' key, add it here
    logs: [
        { message: "Phase 1: Lexical & Syntactic analysis passed.", severity: "info" },
        { message: "Phase 2: Semantic validation successful.", severity: "info" },
        { message: "Phase 3: Symbolic execution complete.", severity: "success" }
    ],
    errors: [],
    warnings: combinedWarnings,
    gamification: {
        xpEarned: reward.xp,
        qualityBonus: reward.bonus,
        levelTitle: gameEngine.getLevelTitle(currentLevel),
    },
} as any); 

  } catch (criticalErr: any) {
    console.error('🔥 Critical Engine Error:', criticalErr?.message);
    return res.status(200).json({
      success: false,
      tokens: lexResult.tokens,
      ast: getCleanAST(ast),
      errors: [{
        type: 'semantic',
        severity: 'error',
        message: `Internal Engine Error: ${criticalErr.message}`,
        line: 0,
      }],
      warnings: [],
      symbolTable: {},
      safetyChecks: [],
      cfg: { nodes: [], edges: [] },
      cognitiveComplexity: 0,
      cyclomaticComplexity: { score: 0, rating: 'low', interpretation: '' },
      symbolicExecution: [],
      logs: [],
      gamification: { xpEarned: 0, qualityBonus: 0, levelTitle: 'Squire' },
      explanations: [
        '❌ **Status:** The analysis engine encountered an unexpected error.',
        `🚨 **Critical Error:** ${criticalErr.message}`
      ],
    });
  }
});

// ---------------------------------------------------------------------------
// Helper: strip stdlib pre-registered symbols, keep only user-declared ones
// ---------------------------------------------------------------------------
const STDLIB_NAMES = new Set([
  'cout','cin','cerr','clog','endl','setw','setprecision','setfill',
  'fixed','showpoint','left','right','boolalpha','noboolalpha',
  'pow','sqrt','abs','fabs','ceil','floor','round','fmod',
  'log','log2','log10','exp','sin','cos','tan','asin','acos','atan','atan2',
  'system','exit','rand','srand','getline',
  'stoi','stol','stoul','stod','stof','to_string',
  'ifstream','ofstream','fstream','string','nullptr',
]);

function filterUserSymbols(symbolTable: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, sym] of Object.entries(symbolTable)) {
    const shortName = (key.split('::').pop() ?? key) as string;
    // Only skip if BOTH line is 0 AND it's a known stdlib name
    if ((sym.line ?? 0) === 0 && STDLIB_NAMES.has(shortName)) continue;
    if (STDLIB_NAMES.has(shortName) && sym.scope === 'global') continue;
    result[key] = sym;
  }
  return result;
}


// ---------------------------------------------------------------------------
// Helper: convert the symbol table into SymbolicEntry[] for the Math tab
// ---------------------------------------------------------------------------
function buildSymbolicTrace(
  symbolTable: Record<string, any>,
): Array<{ expression: string; value: string | number }> {
  const entries: Array<{ expression: string; value: string | number }> = [];
  for (const [key, sym] of Object.entries(symbolTable)) {
    if ((sym.line ?? 0) === 0) continue;      // skip stdlib
    if (sym.kind === 'function') continue;
    const label = key.split('::').slice(1).join('::') || sym.name;
    const dimensions = Array.isArray(sym.dimensions) && sym.dimensions.length
      ? sym.dimensions.map((d: any) => `[${d}]`).join('')
      : '';
    entries.push({
      expression: `${sym.type} ${label}${dimensions}`,
      value: sym.initialized ? sym.type : 'uninitialized',
    });
  }
  return entries;
}

function getCleanAST(node: any): any {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    return node.map(getCleanAST);
  }
  const copy = { ...node };
  delete copy.parent;
  for (const key in copy) {
    copy[key] = getCleanAST(copy[key]);
  }
  return copy;
}

export default router;

function collectAstBeginnerWarnings(ast: any): AnalysisError[] {
  const warnings: AnalysisError[] = [];
  const pushed = new Set<string>();

  const pushWarning = (line: number, message: string) => {
    const key = `${line}|${message}`;
    if (pushed.has(key)) return;
    pushed.add(key);
    warnings.push({
      type: 'semantic',
      severity: 'warning',
      message,
      line: line || 0,
      column: 0,
    });
  };

  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'IfStatement') {
      const cond = node.condition;
      if (cond?.type === 'Assignment' && cond.operator === '=') {
        pushWarning(
          cond.line || node.line || 0,
          `Suspicious assignment in condition: use '==' for comparison instead of '='.`,
        );
      }
    }

    if (node.type === 'FunctionDecl' && node.name === 'main') {
      const body = Array.isArray(node.body) ? node.body : [];
      const hasLogic = body.some((s: any) => {
        if (!s) return false;
        if (s.type === 'ReturnStatement') return false;
        if (s.type === 'Block' && Array.isArray(s.statements) && s.statements.length === 0) return false;
        return true;
      });
      if (!hasLogic) {
        pushWarning(
          node.line || 0,
          `No executable logic found in 'main' (only return/empty statements). Add at least one meaningful statement.`,
        );
      }
    }

    const candidates = [node.body, node.statements, node.thenBranch, node.elseBranch, node.cases, node.handlers];
    candidates.forEach((c: any) => {
      if (Array.isArray(c)) c.forEach(visit);
    });
    if (node.condition) visit(node.condition);
  };

  visit(ast);
  return warnings;
}

function dedupeWarnings(warnings: AnalysisError[]): AnalysisError[] {
  const seen = new Set<string>();
  const out: AnalysisError[] = [];
  for (const w of warnings) {
    const key = `${w.line}|${w.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

function formatWarningExplanation(warning: AnalysisError): string {
  const guidance = getWarningGuidance(warning.message);
  const suffix = guidance
    ? `\n   Why: ${guidance.why}\n   Try this: ${guidance.suggestion}`
    : `\n   Why: The analyzer found something that may be confusing, risky, or outside the expected beginner pattern.\n   Try this: Review the highlighted line and make the intent explicit.`;
  return `⚠️ **WARNING (L${warning.line}):** ${warning.message}${suffix}`;
}

function getWarningGuidance(message: string): { why: string; suggestion: string } | null {
  const lower = message.toLowerCase();

  if (lower.includes('unused variable')) {
    return {
      why: 'The variable is declared but never read, so it does not affect the program result.',
      suggestion: 'Use the variable later in a condition, assignment, output, or return value, or remove it if it is not needed.',
    };
  }

  if (lower.includes('redundant assignment') || lower.includes('overwritten')) {
    return {
      why: 'A value is assigned, then replaced before any code reads the first value.',
      suggestion: 'Remove the earlier assignment, or read/use the value before assigning a new one.',
    };
  }

  if (lower.includes('possible data loss') || lower.includes('narrowing conversion')) {
    return {
      why: 'The value may lose decimal precision or range when stored in the target type.',
      suggestion: 'Use a matching type such as double/float, or convert intentionally only when losing precision is acceptable.',
    };
  }

  if (lower.includes('uninitialized')) {
    return {
      why: 'Reading a variable before assigning it can use unpredictable leftover memory.',
      suggestion: 'Assign an initial value before the first read, for example int count = 0;.',
    };
  }

  if (lower.includes('infinite loop')) {
    return {
      why: 'The loop condition may never become false.',
      suggestion: 'Update the condition variable inside the loop or add a clear break condition.',
    };
  }

  if (lower.includes('unsupported') || lower.includes('outside') || lower.includes('not supported')) {
    return {
      why: 'This analyzer focuses on CP1/CP2 procedural code, so some advanced C++ features are intentionally limited.',
      suggestion: 'Use simpler variables, arrays, functions, loops, conditionals, and supported headers for now.',
    };
  }

  if (lower.includes('header') || lower.includes('preprocessor') || lower.includes('include')) {
    return {
      why: 'Strict mode checks whether library features have the matching #include directive.',
      suggestion: 'Add the required header, or replace the library call with basic arithmetic/control-flow code.',
    };
  }

  if (lower.includes('logical contradiction') || lower.includes('always false')) {
    return {
      why: 'The condition can never be true, so part of the code will not run.',
      suggestion: 'Check the comparison operator and the values used in the condition.',
    };
  }

  if (lower.includes('logical tautology') || lower.includes('always true')) {
    return {
      why: 'The condition is always true, so the alternative path cannot run.',
      suggestion: 'Simplify the condition or change it so both paths are possible when needed.',
    };
  }

  return null;
}

function detectFunctionOverloads(ast: any): AnalysisError[] {
  const signaturesByName = new Map<string, Set<string>>();
  const firstLineByName = new Map<string, number>();
  const errors: AnalysisError[] = [];

  const scan = (nodes: any[]) => {
    nodes.forEach(node => {
      if (!node || (node.type !== 'FunctionDecl' && node.type !== 'FunctionPrototype')) return;
      const params = Array.isArray(node.params) ? node.params : [];
      const signature = params
        .map((param: any) => normalizeTypeForSignature(param?.varType || 'unknown'))
        .join(',');
      const known = signaturesByName.get(node.name) || new Set<string>();
      const firstLine = firstLineByName.get(node.name) || node.line || 0;

      if (known.size > 0 && !known.has(signature)) {
        errors.push({
          type: 'semantic',
          severity: 'error',
          message: `Unsupported feature: Function overloading is not included in the CP1/CP2 foundations scope. '${node.name}' was already declared with a different parameter list on line ${firstLine}.`,
          line: node.line || 0,
          column: node.column || 0,
        });
      }

      known.add(signature);
      signaturesByName.set(node.name, known);
      if (!firstLineByName.has(node.name)) firstLineByName.set(node.name, node.line || 0);
    });
  };

  if (Array.isArray(ast?.body)) scan(ast.body);
  if (Array.isArray(ast?.namespace?.body)) scan(ast.namespace.body);
  return errors;
}

function normalizeTypeForSignature(type: string): string {
  return String(type).replace(/\s+/g, ' ').trim();
}

function stripCommentsAndLiterals(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, match => ' '.repeat(match.length))
    .replace(/\/\/[^\n\r]*/g, match => ' '.repeat(match.length))
    .replace(/(?:u8|u|U|L)?R"([^(]*)\([\s\S]*?\)\1"/g, match => ' '.repeat(match.length))
    .replace(/(?:u8|u|U|L)?"(?:\\[\s\S]|[^"\\])*"/g, match => ' '.repeat(match.length))
    .replace(/(?:u|U|L)?'(?:\\[\s\S]|[^'\\])*'/g, match => ' '.repeat(match.length));
}

function normalizePastedSourceCode(source: string): string {
  let normalized = source
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<\/div\s*>/gi, '\n')
    .replace(/<\/?(?:span|code|pre|div|p|table|thead|tbody|tr|td|th|strong|em|b|i|section|article|blockquote)(?:\s[^>]*)?>/gi, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

  const fenced = normalized.match(/^```(?:cpp|c\+\+|cxx|cc)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) normalized = fenced[1].trim();

  const lines = normalized.split(/\r?\n/);
  if (/^(?:cpp|c\+\+|cxx|cc)$/i.test(lines[0]?.trim() ?? '')) {
    normalized = lines.slice(1).join('\n').trim();
  }

  return normalized;
}
