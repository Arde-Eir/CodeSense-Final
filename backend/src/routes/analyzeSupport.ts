import type {
  ASTNode,
  AnalysisError,
  FunctionDeclNode,
  FunctionPrototypeNode,
  ProgramNode,
  SymbolicEntry,
  SymbolTable,
} from '../types'


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

export function filterUserSymbols(symbolTable: SymbolTable): SymbolTable {
  const result: SymbolTable = {};
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
export function buildSymbolicTrace(
  symbolTable: SymbolTable,
): SymbolicEntry[] {
  const entries: SymbolicEntry[] = [];
  for (const [key, sym] of Object.entries(symbolTable)) {
    if ((sym.line ?? 0) === 0) continue;      // skip stdlib
    if (sym.kind === 'function') continue;
    const label = key.split('::').slice(1).join('::') || sym.name;
    const dimensions = Array.isArray(sym.dimensions) && sym.dimensions.length
      ? sym.dimensions.map(dimension => `[${dimension}]`).join('')
      : '';
    entries.push({
      expression: `${sym.type} ${label}${dimensions}`,
      value: sym.initialized ? sym.type : 'uninitialized',
    });
  }
  return entries;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function numericLine(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function getSyntaxErrorLocation(error: unknown): { line: number; column: number } {
  if (!isRecord(error) || !isRecord(error.location) || !isRecord(error.location.start)) {
    return { line: 1, column: 1 };
  }

  return {
    line: numericLine(error.location.start.line) || 1,
    column: numericLine(error.location.start.column) || 1,
  };
}

export function getNamespaceName(ast: ASTNode): string | null {
  const parsedAst = ast as ASTNode & { namespace?: unknown }
  if (!isRecord(parsedAst.namespace) || typeof parsedAst.namespace.name !== 'string') {
    return null
  }
  return parsedAst.namespace.name
}

export function getCleanAST<Value>(node: Value): Value {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    return node.map(item => getCleanAST(item)) as Value;
  }
  const copy: Record<string, unknown> = { ...(node as Record<string, unknown>) };
  delete copy.parent;
  for (const key of Object.keys(copy)) {
    copy[key] = getCleanAST(copy[key]);
  }
  return copy as Value;
}


export function collectAstBeginnerWarnings(ast: ASTNode): AnalysisError[] {
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

  const visit = (value: unknown): void => {
    if (!isRecord(value)) return;
    const node = value;

    if (node.type === 'IfStatement') {
      const cond = node.condition;
      if (isRecord(cond) && cond.type === 'Assignment' && cond.operator === '=') {
        pushWarning(
          numericLine(cond.line) || numericLine(node.line),
          `Suspicious assignment in condition: use '==' for comparison instead of '='.`,
        );
      }
    }

    if (node.type === 'FunctionDecl' && node.name === 'main') {
      const body = Array.isArray(node.body) ? node.body : [];
      const hasLogic = body.some(statement => {
        if (!isRecord(statement)) return false;
        if (statement.type === 'ReturnStatement') return false;
        if (statement.type === 'Block' && Array.isArray(statement.statements) && statement.statements.length === 0) return false;
        return true;
      });
      if (!hasLogic) {
        pushWarning(
          numericLine(node.line),
          `No executable logic found in 'main' (only return/empty statements). Add at least one meaningful statement.`,
        );
      }
    }

    const candidates = [node.body, node.statements, node.thenBranch, node.elseBranch, node.cases, node.handlers];
    candidates.forEach(candidate => {
      if (Array.isArray(candidate)) candidate.forEach(visit);
    });
    if (node.condition) visit(node.condition);
  };

  visit(ast);
  return warnings;
}

export function dedupeWarnings(warnings: AnalysisError[]): AnalysisError[] {
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

export function formatWarningExplanation(warning: AnalysisError): string {
  const guidance = getWarningGuidance(warning.message);
  const suffix = guidance
    ? `\n   Why: ${guidance.why}\n   Try this: ${guidance.suggestion}`
    : `\n   Why: The analyzer found something that may be confusing, risky, or outside the expected beginner pattern.\n   Try this: Review the highlighted line and make the intent explicit.`;
  return `⚠️ **WARNING (L${warning.line}):** ${warning.message}${suffix}`;
}

export function getWarningGuidance(message: string): { why: string; suggestion: string } | null {
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

export function detectFunctionOverloads(ast: ASTNode): AnalysisError[] {
  const signaturesByName = new Map<string, Set<string>>();
  const firstLineByName = new Map<string, number>();
  const errors: AnalysisError[] = [];

  const scan = (nodes: ASTNode[]) => {
    nodes.forEach(node => {
      if (node.type !== 'FunctionDecl' && node.type !== 'FunctionPrototype') return;
      const functionNode = node as FunctionDeclNode | FunctionPrototypeNode;
      const params = functionNode.params;
      const signature = params
        .map(param => normalizeTypeForSignature(param.varType))
        .join(',');
      const known = signaturesByName.get(functionNode.name) || new Set<string>();
      const firstLine = firstLineByName.get(functionNode.name) || functionNode.line || 0;

      if (known.size > 0 && !known.has(signature)) {
        errors.push({
          type: 'semantic',
          severity: 'error',
          message: `Unsupported feature: Function overloading is not included in the CP1/CP2 foundations scope. '${functionNode.name}' was already declared with a different parameter list on line ${firstLine}.`,
          line: functionNode.line || 0,
          column: functionNode.column || 0,
        });
      }

      known.add(signature);
      signaturesByName.set(functionNode.name, known);
      if (!firstLineByName.has(functionNode.name)) {
        firstLineByName.set(functionNode.name, functionNode.line || 0);
      }
    });
  };

  if (ast.type === 'Program') scan((ast as ProgramNode).body);
  const astRecord = ast as ASTNode & { namespace?: { body?: ASTNode[] } };
  if (Array.isArray(astRecord.namespace?.body)) scan(astRecord.namespace.body);
  return errors;
}

export function normalizeTypeForSignature(type: string): string {
  return String(type).replace(/\s+/g, ' ').trim();
}

export function stripCommentsAndLiterals(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, match => ' '.repeat(match.length))
    .replace(/\/\/[^\n\r]*/g, match => ' '.repeat(match.length))
    .replace(/(?:u8|u|U|L)?R"([^(]*)\([\s\S]*?\)\1"/g, match => ' '.repeat(match.length))
    .replace(/(?:u8|u|U|L)?"(?:\\[\s\S]|[^"\\])*"/g, match => ' '.repeat(match.length))
    .replace(/(?:u|U|L)?'(?:\\[\s\S]|[^'\\])*'/g, match => ' '.repeat(match.length));
}

export function normalizePastedSourceCode(source: string): string {
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
