import { Router } from 'express';
import { tokenize } from '../analysis/lexer';
import { TypeChecker } from '../analysis/typechecker';
import { SymbolicExecutor } from '../analysis/symbolicexe';
import { CFGGenerator } from '../analysis/cfgGenerator';
import { CognitiveComplexity, CyclomaticComplexity } from '../analysis/scoring';
import type {
  ASTNode,
  AnalysisError,
  IncludeNode,
  ProgramNode,
  SafetyCheck,
} from '../types';
import { Translator } from '../analysis/translator';
import { GameEngine } from '../gamification/GameEngine';
import {
  errorMessage,
  isAnalysisPhaseError,
  runAnalysisPhase,
} from '../analysis/phaseErrors';
import {
  buildSymbolicTrace,
  collectAstBeginnerWarnings,
  dedupeWarnings,
  detectFunctionOverloads,
  filterUserSymbols,
  formatWarningExplanation,
  getCleanAST,
  getNamespaceName,
  getSyntaxErrorLocation,
  normalizePastedSourceCode,
  stripCommentsAndLiterals,
} from './analyzeSupport';


type ParserModule = {
  parse(source: string): ASTNode;
};

const parser = require('../analysis/parser') as ParserModule;
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
  let ast: ASTNode | null = null;
  try {
    ast = parser.parse(sourceCode);
  } catch (syntaxError: unknown) {
    const syntaxMessage = errorMessage(syntaxError);
    const syntaxLocation = getSyntaxErrorLocation(syntaxError);
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
          message: syntaxMessage,
          line: syntaxLocation.line,
          column: syntaxLocation.column,
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
        `🔧 **Line ${syntaxLocation.line}:** ${syntaxMessage}`,
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
    const namespaceName = getNamespaceName(ast);
    const hasUsingStd = namespaceName === 'std' || usesStdPrefix;

    const directives = ast.type === 'Program' ? (ast as ProgramNode).directives : [];
    const includedHeaders = new Set(
      directives
        .filter((directive): directive is IncludeNode => directive.type === 'Include')
        .map(directive => directive.name),
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
    const typeResult = runAnalysisPhase('Type checker', () => typeChecker.check(ast));

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
      const partialCfg = runAnalysisPhase(
        'Partial control-flow graph generation',
        () => new CFGGenerator().generate(ast),
      );

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
    const executor = new SymbolicExecutor(typeResult.symbolTable);
    const safetyChecks: SafetyCheck[] = runAnalysisPhase(
      'Symbolic execution',
      () => executor.execute(ast),
    );

    // ─── PHASE 6: Symbolic Execution — real value trace for the Math tab ──────
    // Pull the rich value trace from the executor (concrete values tracked during execution)
    const symbolicExecution = executor.valueTrace.length > 0
      ? executor.valueTrace
      : buildSymbolicTrace(typeResult.symbolTable);

    // ─── PHASE 7: Control Flow Graph ─────────────────────────────────────────
    const cfg = runAnalysisPhase(
      'Control-flow graph generation',
      () => new CFGGenerator().generate(ast),
    );

    // ─── PHASE 8: Mentor Explanations ────────────────────────────────────────
    const mentorExplanations = runAnalysisPhase(
      'Mentor explanation generation',
      () => new Translator().translate(ast),
    );

    // ─── PHASE 9: Cognitive + Cyclomatic Complexity ──────────────────────────
    const cleanAstForScoring = getCleanAST(ast);
    const complexityScore = runAnalysisPhase(
      'Cognitive complexity calculation',
      () => new CognitiveComplexity().calculate(cleanAstForScoring),
    );
    const cyclomaticResult = runAnalysisPhase(
      'Cyclomatic complexity calculation',
      () => new CyclomaticComplexity().calculate(cleanAstForScoring),
    );

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
      },
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
});

  } catch (criticalError: unknown) {
    const phase = isAnalysisPhaseError(criticalError)
      ? criticalError.phase
      : 'Analysis pipeline';
    const message = errorMessage(criticalError);
    console.error('Analysis engine failure', {
      phase,
      message,
      stack: criticalError instanceof Error ? criticalError.stack : undefined,
    });
    return res.status(500).json({
      success: false,
      tokens: lexResult.tokens,
      ast: getCleanAST(ast),
      errors: [{
        type: 'semantic',
        severity: 'error',
        message: `Internal analysis failure during ${phase}.`,
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
        `🚨 **Failed phase:** ${phase}. Please retry and report this failure if it persists.`
      ],
    });
  }
});
export default router;
