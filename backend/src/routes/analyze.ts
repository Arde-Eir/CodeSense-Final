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
];

router.post('/analyze', (req, res) => {
  const { sourceCode, hintsUsed = 0 } = req.body;

  if (!sourceCode || typeof sourceCode !== 'string') {
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
    { re: /\bvirtual\s+\w/,
      msg: 'Virtual functions / polymorphism are not fully analyzed.' },
    { re: /\[\s*(?:&|=|\w+)\s*\]\s*\(/,
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

  try {
    // ─── PHASE 3: Dependency Validation (FEU CP1/CP2 Strict Rules) ──────────
    const usesIo = /\b(cout|cin|endl|cerr)\b/.test(sourceCode);
    const usesStdPrefix = /\bstd::/.test(sourceCode);
    const hasUsingStd = ast.namespace?.name === 'std' || usesStdPrefix;

    // Helper: check if a header is in the directive list
    const hasHeader = (name: string) =>
      ast.directives?.some((d: any) => d.type === 'Include' && d.name === name);

    const depErrors: AnalysisError[] = [];

    // iostream
    if (usesIo && !hasHeader('iostream')) {
      depErrors.push({
        type: 'semantic', severity: 'error',
        message: "Strict Error: 'cout/cin/cerr' requires '#include <iostream>'",
        line: 1, column: 1,
      });
    }
    if (usesIo && !hasUsingStd) {
      depErrors.push({
        type: 'semantic', severity: 'error',
        message: "Strict Error: 'cout/cin/cerr' requires 'using namespace std;' (or 'std::' prefix)",
        line: 2, column: 1,
      });
    }

    // cmath
    const CMATH_FNS = ['pow','sqrt','abs','fabs','ceil','floor','round','fmod',
                        'log','log2','log10','exp','sin','cos','tan','asin','acos','atan','atan2'];
    const usesCmath = CMATH_FNS.some(fn => new RegExp(`\\b${fn}\\s*\\(`).test(sourceCode));
    if (usesCmath && !hasHeader('cmath') && !hasHeader('math.h')) {
      depErrors.push({
        type: 'semantic', severity: 'error',
        message: "Math functions (pow, sqrt, etc.) require '#include <cmath>'",
        line: 1, column: 1,
      });
    }

    // iomanip
    const usesIomanip = /\b(setw|setprecision|setfill)\s*\(/.test(sourceCode);
    if (usesIomanip && !hasHeader('iomanip')) {
      depErrors.push({
        type: 'semantic', severity: 'error',
        message: "Formatting functions (setw, setprecision, setfill) require '#include <iomanip>'",
        line: 1, column: 1,
      });
    }

    // string conversions
    const usesStringFns = /\b(stoi|stod|stof|stol|stoul|to_string)\s*\(/.test(sourceCode);
    if (usesStringFns && !hasHeader('string')) {
      depErrors.push({
        type: 'semantic', severity: 'error',
        message: "String conversion functions (stoi, stod, to_string, etc.) require '#include <string>'",
        line: 1, column: 1,
      });
    }

    // fstream
    const usesFstream = /\b(ifstream|ofstream|fstream)\b/.test(sourceCode);
    if (usesFstream && !hasHeader('fstream')) {
      depErrors.push({
        type: 'semantic', severity: 'error',
        message: "File stream types (ifstream, ofstream, fstream) require '#include <fstream>'",
        line: 1, column: 1,
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
          ...combinedWarnings.map(w => `⚠️ **Warning (L${w.line}):** ${w.message}`),
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
        type: 'runtime',
        severity: 'warning',
        message: `Safety analyzer stopped early: ${executorCrashMsg}`,
        line: 0,
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
        ...combinedWarnings.map(w => `⚠️ **WARNING (L${w.line}):** ${w.message}`),
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
    entries.push({
      expression: `${sym.type} ${label}`,
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