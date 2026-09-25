import type { Node, Edge } from '@xyflow/react';
import { detectRequiredHeaders } from '../PreprocessorDependencies';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NodeData {
  label?: unknown;
  code?: unknown;
  [key: string]: unknown;
}

export const FLOWCHART_CODE_TOPICS = [
  'Friendly sentence commands such as "ask for age", "display hello", and "set score to zero"',
  'Variables, constants, assignment, and arithmetic',
  'cin input and cout output',
  'single-branch if decisions and two-branch if / else decisions',
  'while-style loops from branches that return to a Decision',
  'arrays and basic indexed storage',
  'helper function calls, including call name to action helper definitions',
  'raw C++ snippets only when they stay inside the same CP1/selected-CP2 foundations scope',
];

// ─── Grammar-Aligned Reserved Words ──────────────────────────────────────────

export const RESERVED_WORDS = new Set([
  'if', 'else', 'while', 'for', 'return', 'int', 'float', 'double',
  'char', 'bool', 'void', 'using', 'namespace', 'auto', 'const',
  'static', 'extern', 'unsigned', 'signed', 'sizeof', 'switch',
  'case', 'default', 'break', 'continue', 'do', 'long', 'string',
  'volatile', 'inline', 'virtual', 'public', 'private', 'protected',
  'class', 'struct', 'enum', 'typedef', 'typename', 'template',
  'this', 'new', 'delete', 'nullptr', 'try', 'catch', 'throw',
  'override', 'final', 'true', 'false',
]);

// ─── Grammar-Aligned Types ────────────────────────────────────────────────────

export const BASE_TYPES = [
  'long long', 'long double', 'unsigned int',
  'int', 'float', 'double', 'char', 'bool', 'void', 'string', 'auto',
];

export const TYPE_MODIFIERS = [
  'const', 'static', 'extern', 'volatile', 'unsigned', 'signed',
  'inline',
];

export const INCLUDE_ORDER = [
  'iostream', 'fstream', 'string', 'cmath', 'cstdlib', 'climits', 'iomanip',
];

export const str = (v: unknown): string => String(v ?? '').trim();

export function isCallConnectorEdge(edge: Edge): boolean {
  return str(edge.label).toLowerCase() === 'calls';
}

export type FlowchartInstructionKind =
  | 'process'
  | 'decision'
  | 'io'
  | 'manual_input'
  | 'predefined'
  | 'document'
  | 'delay'
  | 'database';

export function toIdentifier(value: string, fallback = 'value'): string {
  const words = value
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-zA-Z0-9_]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(w => !['a', 'an', 'the', 'variable', 'named', 'called'].includes(w.toLowerCase()));

  const camel = words
    .map((word, i) => {
      const clean = word.replace(/^[0-9]+/, '');
      if (!clean) return '';
      return i === 0
        ? clean.charAt(0).toLowerCase() + clean.slice(1)
        : clean.charAt(0).toUpperCase() + clean.slice(1);
    })
    .join('');

  return isValidIdentifier(camel) ? camel : fallback;
}

export function cleanHumanTarget(value: string): string {
  return value
    .trim()
    .replace(/\?+$/g, '')
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/^(?:their|his|her|my|your|its|the)\s+/i, '')
    .replace(/^(?:value|variable|number|text|string|answer)\s+(?:of|for)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeVariableName(value: string, fallback = 'value'): string {
  return toIdentifier(cleanHumanTarget(value), fallback);
}

export function normalizeTypeWord(value: string): string | null {
  const lower = value.toLowerCase().trim();
  const typeMap: Record<string, string> = {
    integer: 'int',
    int: 'int',
    number: 'int',
    whole: 'int',
    decimal: 'double',
    double: 'double',
    float: 'float',
    text: 'string',
    string: 'string',
    word: 'string',
    sentence: 'string',
    character: 'char',
    char: 'char',
    boolean: 'bool',
    bool: 'bool',
  };
  return typeMap[lower] ?? null;
}

export function looksLikeCpp(code: string): boolean {
  return /[;{}()]|<<|>>|==|!=|<=|>=|\+\+|--|\b(int|float|double|char|bool|string|auto|return|cout|cin)\b/.test(code);
}

export function quoteIfPlainText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '""';
  if (/^["'].*["']$/.test(trimmed)) return trimmed;
  if (/^(true|false|nullptr)$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  if (/^[a-zA-Z_][a-zA-Z0-9_]*(\s*[-+*/%]\s*[a-zA-Z0-9_]+)*$/.test(trimmed)) return trimmed;
  return JSON.stringify(trimmed);
}

export function quoteOutputValue(value: string): string {
  const cleaned = cleanHumanTarget(value).replace(/^(?:message|text)\s+/i, '').trim();
  const normalized = normalizeEnglishExpression(cleaned);
  if (/^(?:the\s+)?(?:value|variable|number|text|string|answer|result)\s+(?:of|for)\s+/i.test(value)) {
    return normalizeVariableName(value.replace(/^(?:the\s+)?(?:value|variable|number|text|string|answer|result)\s+(?:of|for)\s+/i, ''));
  }
  if (/^(?:value|variable)\s+[A-Za-z_][A-Za-z0-9_\s]*$/i.test(value)) {
    return normalizeVariableName(value.replace(/^(?:value|variable)\s+/i, ''));
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized) && /(?:result|total|score|age|count|counter|name|price|amount|grade|average|sum|difference|product|quotient|remainder)$/i.test(normalized)) {
    return normalized;
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
    return JSON.stringify(normalized);
  }
  return quoteIfPlainText(normalized);
}

export function normalizeEnglishExpression(value: string): string {
  return value
    .trim()
    .replace(/\bzero\b/gi, '0')
    .replace(/\bone\b/gi, '1')
    .replace(/\btwo\b/gi, '2')
    .replace(/\bthree\b/gi, '3')
    .replace(/\bfour\b/gi, '4')
    .replace(/\bfive\b/gi, '5')
    .replace(/\bsix\b/gi, '6')
    .replace(/\bseven\b/gi, '7')
    .replace(/\beight\b/gi, '8')
    .replace(/\bnine\b/gi, '9')
    .replace(/\bten\b/gi, '10')
    .replace(/\bis equal to\b/gi, '==')
    .replace(/\bequals\b/gi, '==')
    .replace(/\bis\b(?=\s+(?:not|greater|less|above|below|at least|at most))/gi, '')
    .replace(/\bis not equal to\b/gi, '!=')
    .replace(/\bnot equal to\b/gi, '!=')
    .replace(/\bis greater than or equal to\b/gi, '>=')
    .replace(/\bgreater than or equal to\b/gi, '>=')
    .replace(/\bis greater or equal to\b/gi, '>=')
    .replace(/\bgreater or equal to\b/gi, '>=')
    .replace(/\bat least\b/gi, '>=')
    .replace(/\bis less than or equal to\b/gi, '<=')
    .replace(/\bless than or equal to\b/gi, '<=')
    .replace(/\bis less or equal to\b/gi, '<=')
    .replace(/\bless or equal to\b/gi, '<=')
    .replace(/\bat most\b/gi, '<=')
    .replace(/\bis greater than\b/gi, '>')
    .replace(/\bgreater than\b/gi, '>')
    .replace(/\bis less than\b/gi, '<')
    .replace(/\bless than\b/gi, '<')
    .replace(/\bis above\b/gi, '>')
    .replace(/\bis below\b/gi, '<')
    .replace(/\babove\b/gi, '>')
    .replace(/\bbelow\b/gi, '<')
    .replace(/\band\b/gi, '&&')
    .replace(/\bor\b/gi, '||')
    .replace(/\bplus\b/gi, '+')
    .replace(/\bminus\b/gi, '-')
    .replace(/\btimes\b/gi, '*')
    .replace(/\bmultiplied by\b/gi, '*')
    .replace(/\bdivided by\b/gi, '/')
    .replace(/\bmodulo\b|\bmod\b/gi, '%')
    .replace(/\s+/g, ' ')
    .trim();
}

export function pluralizeIdentifier(name: string): string {
  return name.endsWith('s') ? name : `${name}s`;
}

export function normalizeDimensionSize(value: string | undefined, fallback = '10'): string {
  if (!value) return fallback;
  const normalized = normalizeEnglishExpression(value).trim();
  return /^-?\d+$/.test(normalized) ? normalized : fallback;
}

export function normalizeArrayIndex(value: string): string {
  return normalizeEnglishExpression(value).trim();
}

export function normalizeConditionOperand(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^(true|false)$/i.test(trimmed) || /^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  if (/^["'].*["']$/.test(trimmed)) return trimmed;
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) return trimmed;
  return normalizeVariableName(trimmed);
}

export function normalizeConditionOperands(value: string): string {
  return value.replace(
    /([^<>=!&|]+?)\s*(==|!=|>=|<=|>|<)\s*([^&|]+?)(?=\s*(?:&&|\|\||$))/g,
    (_match, left: string, op: string, right: string) =>
      `${normalizeConditionOperand(left)} ${op} ${normalizeConditionOperand(right)}`
  );
}

export function normalizeEnglishCondition(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/^(if|when|while|repeat while|loop while|as long as|check if|decide if)\s+/i, '')
    .replace(/\?+$/g, '');
  const normalized = normalizeConditionOperands(normalizeEnglishExpression(cleaned))
    .replace(/\s*(&&|\|\|)\s*/g, ' $1 ');
  return /[<>=!]=?|&&|\|\|/.test(normalized) ? normalized : null;
}

export function normalizeHumanStatement(text: string, nodeType = 'process'): string | null {
  const source = text.trim().replace(/\.$/, '');
  if (!source || looksLikeCpp(source)) return null;

  const lower = source.toLowerCase();

  const note = source.match(/^(?:note|notes|summary|comment|remark)\s*:?\s+(.+)$/i);
  if (note) {
    return `// ${note[1].trim()}`;
  }

  const sized3dArray = source.match(/^(?:create|declare|make|set up)\s+(?:a\s+|an\s+|the\s+)?(?:3d|three dimensional|three-dimensional)\s+(?:array|table|grid|cube)\s+(?:of\s+)?(.+?)(?:\s+with\s+(.+?)\s+(?:layers?|depth)\s+and\s+(.+?)\s+rows?\s+and\s+(.+?)\s+columns?)?$/i);
  if (sized3dArray) {
    const name = pluralizeIdentifier(normalizeVariableName(sized3dArray[1].replace(/s$/i, ''), 'items'));
    const depth = normalizeDimensionSize(sized3dArray[2]);
    const rows = normalizeDimensionSize(sized3dArray[3]);
    const columns = normalizeDimensionSize(sized3dArray[4]);
    return `int ${name}[${depth}][${rows}][${columns}];`;
  }

  const sized2dArray = source.match(/^(?:create|declare|make|set up)\s+(?:a\s+|an\s+|the\s+)?(?:2d|two dimensional|two-dimensional)\s+(?:array|table|grid|matrix)\s+(?:of\s+)?(.+?)(?:\s+with\s+(.+?)\s+rows?\s+and\s+(.+?)\s+columns?)?$/i);
  if (sized2dArray) {
    const name = pluralizeIdentifier(normalizeVariableName(sized2dArray[1].replace(/s$/i, ''), 'items'));
    const rows = normalizeDimensionSize(sized2dArray[2]);
    const columns = normalizeDimensionSize(sized2dArray[3]);
    return `int ${name}[${rows}][${columns}];`;
  }

  const listDeclaration = source.match(/^(?:create|declare|make|set up)\s+(?:a\s+|an\s+|the\s+)?(?:list|array|collection)\s+(?:of\s+)?(.+)$/i);
  if (listDeclaration) {
    const name = normalizeVariableName(listDeclaration[1].replace(/s$/i, ''), 'items');
    const pluralName = pluralizeIdentifier(name);
    return `int ${pluralName}[10];`;
  }

  const declaration = source.match(/^(?:create|declare|make|initialize|init|set up|let)\s+(?:a\s+|an\s+|the\s+)?(?:(integer|int|number|whole|decimal|double|float|text|string|word|sentence|character|char|boolean|bool)\s+)?(?:variable\s+)?(?:named\s+|called\s+)?(.+?)(?:\s+(?:equal to|equals|with value|as|to|be)\s+(.+))?$/i);
  if (declaration) {
    const explicitType = normalizeTypeWord(declaration[1] ?? '');
    const name = normalizeVariableName(declaration[2]);
    const rawValue = declaration[3]?.trim();
    const normalizedValue = rawValue ? normalizeEnglishExpression(rawValue) : '';
    const inferredType = rawValue
      ? /^["'].*["']$/.test(normalizedValue) || /\s/.test(normalizedValue) && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(normalizedValue)
        ? 'string'
        : /^(true|false)$/i.test(normalizedValue)
        ? 'bool'
        : /^-?\d+$/.test(normalizedValue)
        ? 'int'
        : /^-?\d+\.\d+$/.test(normalizedValue)
        ? 'double'
        : 'auto'
      : 'int';
    const type = explicitType ?? inferredType;
    const value = rawValue ? ` = ${quoteIfPlainText(normalizedValue)}` : '';
    return `${type} ${name}${value};`;
  }

  const startsAt = source.match(/^(.+?)\s+(?:starts?\s+(?:at|as|with)|begins?\s+(?:at|as|with))\s+(.+)$/i);
  if (startsAt) {
    const name = normalizeVariableName(startsAt[1]);
    const value = normalizeEnglishExpression(startsAt[2]);
    const type = /^["'].*["']$/.test(value) || /\s/.test(value) && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)
      ? 'string'
      : /^(true|false)$/i.test(value)
      ? 'bool'
      : /^-?\d+$/.test(value)
      ? 'int'
      : /^-?\d+\.\d+$/.test(value)
      ? 'double'
      : 'auto';
    return `${type} ${name} = ${quoteIfPlainText(value)};`;
  }

  const assignment = source.match(/^(?:set|change|update|put|make)\s+(.+?)\s+(?:to|as|equal to|equals|be|get|gets|become|becomes)\s+(.+)$/i);
  if (assignment) {
    return `${normalizeVariableName(assignment[1])} = ${quoteIfPlainText(normalizeEnglishExpression(assignment[2]))};`;
  }

  const plainAssignment = source.match(/^(.+?)\s+(?:gets|becomes|is now)\s+(.+)$/i);
  if (plainAssignment) {
    return `${normalizeVariableName(plainAssignment[1])} = ${quoteIfPlainText(normalizeEnglishExpression(plainAssignment[2]))};`;
  }

  const storeIn = source.match(/^(?:store|save|put)\s+(.+?)\s+in(?:to)?\s+(.+)$/i);
  if (storeIn) {
    return `${normalizeVariableName(storeIn[2])} = ${quoteIfPlainText(normalizeEnglishExpression(storeIn[1]))};`;
  }

  const store3d = source.match(/^(?:set|store|save|put)\s+(.+?)\s+(?:at|in)\s+(?:layer|depth)\s+(.+?)\s+(?:row)\s+(.+?)\s+(?:column|col)\s+(.+?)\s+(?:of|in)\s+(.+)$/i);
  if (store3d) {
    return `${normalizeVariableName(store3d[5])}[${normalizeArrayIndex(store3d[2])}][${normalizeArrayIndex(store3d[3])}][${normalizeArrayIndex(store3d[4])}] = ${quoteIfPlainText(normalizeEnglishExpression(store3d[1]))};`;
  }

  const store2d = source.match(/^(?:set|store|save|put)\s+(.+?)\s+(?:at|in)\s+(?:row)\s+(.+?)\s+(?:column|col)\s+(.+?)\s+(?:of|in)\s+(.+)$/i);
  if (store2d) {
    return `${normalizeVariableName(store2d[4])}[${normalizeArrayIndex(store2d[2])}][${normalizeArrayIndex(store2d[3])}] = ${quoteIfPlainText(normalizeEnglishExpression(store2d[1]))};`;
  }

  const arrayStore = source.match(/^(?:set|store|save|put)\s+(.+?)\s+(?:at|in)\s+(?:index|position)\s+(.+?)\s+(?:of|in)\s+(.+)$/i);
  if (arrayStore) {
    return `${normalizeVariableName(arrayStore[3])}[${normalizeEnglishExpression(arrayStore[2])}] = ${quoteIfPlainText(normalizeEnglishExpression(arrayStore[1]))};`;
  }

  const calculate = source.match(/^(?:calculate|compute|find)\s+(.+?)\s+(?:as|by|from|with)\s+(.+)$/i);
  if (calculate) {
    return `${normalizeVariableName(calculate[1])} = ${quoteIfPlainText(normalizeEnglishExpression(calculate[2]))};`;
  }

  const addTo = source.match(/^(?:add|increase)\s+(.+?)\s+by\s+(.+)$/i);
  if (addTo) return `${normalizeVariableName(addTo[1])} += ${normalizeEnglishExpression(addTo[2])};`;

  const addValueTo = source.match(/^add\s+(.+?)\s+to\s+(.+)$/i);
  if (addValueTo) return `${normalizeVariableName(addValueTo[2])} += ${normalizeEnglishExpression(addValueTo[1])};`;

  const subtractFrom = source.match(/^(?:subtract|decrease|reduce)\s+(.+?)\s+by\s+(.+)$/i);
  if (subtractFrom) return `${normalizeVariableName(subtractFrom[1])} -= ${normalizeEnglishExpression(subtractFrom[2])};`;

  const subtractValueFrom = source.match(/^subtract\s+(.+?)\s+from\s+(.+)$/i);
  if (subtractValueFrom) return `${normalizeVariableName(subtractValueFrom[2])} -= ${normalizeEnglishExpression(subtractValueFrom[1])};`;

  const multiplyBy = source.match(/^(?:multiply|times)\s+(.+?)\s+by\s+(.+)$/i);
  if (multiplyBy) return `${normalizeVariableName(multiplyBy[1])} *= ${normalizeEnglishExpression(multiplyBy[2])};`;

  const divideBy = source.match(/^divide\s+(.+?)\s+by\s+(.+)$/i);
  if (divideBy) return `${normalizeVariableName(divideBy[1])} /= ${normalizeEnglishExpression(divideBy[2])};`;

  const increment = source.match(/^(?:increment|increase)\s+(.+)$/i);
  if (increment) return `${normalizeVariableName(increment[1])}++;`;

  const decrement = source.match(/^(?:decrement|decrease)\s+(.+)$/i);
  if (decrement) return `${normalizeVariableName(decrement[1])}--;`;

  const inputMatch = source.match(/^(?:ask(?:\s+(?:the\s+)?(?:user|student|player|customer|person))?\s+for|get|read|input|enter)\s+(.+)$/i);
  if (inputMatch || nodeType === 'manual_input') {
    const target = inputMatch ? inputMatch[1] : source;
    return `cin >> ${normalizeVariableName(target)};`;
  }

  const output = source.match(/^(?:print|show|display|output|write|tell(?:\s+(?:the\s+)?(?:user|student|player|customer|person))?)\s+(.+)$/i);
  if (output || nodeType === 'io') {
    return `cout << ${quoteOutputValue(output ? output[1] : source)} << endl;`;
  }

  if (lower.startsWith('return ')) {
    return `return ${normalizeEnglishExpression(source.replace(/^return\s+/i, ''))};`;
  }

  return null;
}

export function translateFlowchartInstruction(
  text: string,
  nodeType: FlowchartInstructionKind = 'process',
): string | null {
  return normalizeHumanStatement(text, nodeType);
}

export function detectIncludes(allCode: string[]): string[] {
  const needed = new Set<string>(['iostream']);
  const combined = allCode.join(' ');

  detectRequiredHeaders(combined).forEach(header => needed.add(header));
  if (/\bINT_(?:MAX|MIN)\b/.test(combined)) needed.add('climits');

  const sorted = INCLUDE_ORDER.filter(h => needed.has(h));
  const rest = [...needed].filter(h => !INCLUDE_ORDER.includes(h)).sort();
  return [...sorted, ...rest];
}

// ─── Variable Declaration Parser ──────────────────────────────────────────────

export interface VarDecl {
  modifiers: string[];
  varType: string;
  name: string;
  value?: string;
  isArray: boolean;
  arraySize?: string;
}

export function isValidIdentifier(name: string): boolean {
  if (RESERVED_WORDS.has(name)) return false;
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

export function parseVarDecl(code: string): VarDecl | null {
  const clean = code.replace(/;\s*$/, '').trim();
  const modifiers: string[] = [];
  let rest = clean;

  for (const mod of TYPE_MODIFIERS) {
    const modRe = new RegExp(`^${mod}\\s+`);
    if (modRe.test(rest)) {
      modifiers.push(mod);
      rest = rest.replace(modRe, '').trim();
    }
  }

  let matchedType: string | null = null;
  for (const bt of BASE_TYPES) {
    const typeRe = new RegExp(`^${bt.replace(' ', '\\s+')}\\s+`);
    if (typeRe.test(rest)) {
      matchedType = bt;
      rest = rest.replace(typeRe, '').trim();
      break;
    }
  }

  if (!matchedType) return null;

  let ptrSuffix = '';
  const ptrMatch = rest.match(/^([*&]+)\s*/);
  if (ptrMatch) {
    ptrSuffix = ptrMatch[1];
    rest = rest.slice(ptrMatch[0].length).trim();
  }

  const arrayMatch = rest.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\[([^\]]*)\](?:\s*=\s*(.+))?$/);
  if (arrayMatch) {
    const name = arrayMatch[1];
    if (!isValidIdentifier(name)) return null;
    return {
      modifiers,
      varType: matchedType + ptrSuffix,
      name, isArray: true,
      arraySize: arrayMatch[2].trim(),
      value: arrayMatch[3]?.trim(),
    };
  }

  const assignMatch = rest.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*=\s*(.+))?$/);
  if (assignMatch) {
    const name = assignMatch[1];
    if (!isValidIdentifier(name)) return null;
    return {
      modifiers,
      varType: matchedType + ptrSuffix,
      name, isArray: false,
      value: assignMatch[2]?.trim(),
    };
  }

  return null;
}

// ─── Statement Normalizer ─────────────────────────────────────────────────────

export function normalizeStatement(code: string): string {
  const s = code.trim();
  if (!s) return '';
  if (s.endsWith(';') || s.endsWith('}')) return s;
  if (s === 'break' || s === 'continue') return s + ';';
  if (/^return(\s|$)/.test(s)) return s.endsWith(';') ? s : s + ';';
  if (/^(break|continue)\s/.test(s)) return s.endsWith(';') ? s : s + ';';
  if (/^(if|else|while|for|do|switch)\s*[\s({]/.test(s)) return s;
  if (s === 'else' || s === 'do') return s;
  return s + ';';
}

export function isBareIdentifierStatement(code: string): boolean {
  return isValidIdentifier(code.trim().replace(/;$/, ''));
}

export function isTopLevelDeclaration(code: string): boolean {
  const s = code.trim();
  if (/^(template\s*<[\s\S]+>\s*)?(class|struct|enum)\s+\w[\s\S]*};?\s*$/.test(s)) return false;
  return /^[\w:<>,\s*&]+?\s+\w+\s*\([^;]*\)\s*\{[\s\S]*\}\s*$/.test(s);
}

export function normalizeTopLevelDeclaration(code: string): string {
  const s = code.trim();
  return s;
}

export interface ParsedHumanCall {
  fnName: string;
  args: string;
  argNames: string[];
  helperBody?: string;
}

export interface ParsedFunctionDefinition {
  returnType: string;
  fnName: string;
  params: string;
}

export function parseHumanCallInstruction(code: string): ParsedHumanCall | null {
  const c = code.trim();
  const callWithBody = c.match(/^(?:call|run|use|execute)\s+(.+?)\s+to\s+(.+?)(?:\s+with\s+(.+))?$/i);
  if (callWithBody) {
    const argNames = callWithBody[3]
      ? callWithBody[3].split(/\s*(?:,|and)\s*/).map(arg => normalizeVariableName(arg))
      : [];
    return {
      fnName: normalizeVariableName(callWithBody[1], 'helper'),
      args: argNames.join(', '),
      argNames,
      helperBody: callWithBody[2].trim(),
    };
  }

  const humanCall = c.match(/^(?:call|run|use|execute)\s+(.+?)(?:\s+with\s+(.+))?$/i);
  if (!humanCall) return null;

  const argNames = humanCall[2]
    ? humanCall[2].split(/\s*(?:,|and)\s*/).map(arg => normalizeVariableName(arg))
    : [];

  return {
    fnName: normalizeVariableName(humanCall[1], 'helper'),
    args: argNames.join(', '),
    argNames,
  };
}

export function parseFunctionDefinitionInstruction(node: Node<NodeData>): ParsedFunctionDefinition | null {
  const label = str(node.data.label);
  const code = str(node.data.code);
  const source = code || label;
  const definition = source.match(/^(void|int|double|float|char|bool|string)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^{};]*)\)\s*;?$/);

  if (definition) {
    return {
      returnType: definition[1],
      fnName: definition[2],
      params: definition[3].trim(),
    };
  }

  const labelDefinition = label.match(/^Function:\s*([A-Za-z_][A-Za-z0-9_]*)$/i);
  if (!labelDefinition) return null;

  return {
    returnType: 'void',
    fnName: labelDefinition[1],
    params: '',
  };
}

export function normalizeCondition(code: string): string {
  return (normalizeEnglishCondition(code) ?? code)
    .replace(/^[({[\s]+|[)}\]\s]+$/g, '')
    .replace(/\band\b/g, '&&')
    .replace(/\bor\b/g, '||')
    .trim() || '/* condition */';
}

// ─── Node-type specific code emitters ────────────────────────────────────────
// Each matches the grammar construct for that ISO 5807 shape.

/** io node → grammar StreamStatement (cout) */
export function emitIO(label: string, code: string): string {
  const c = code.trim();
  const l = label.toLowerCase();
  const human = normalizeHumanStatement(c || label, 'io');

  if (!c) {
    if (human) return human;
    if (l.includes('output') || l.includes('print') || l.includes('display')
     || l.includes('show') || l.includes('write')) {
      return `cout << "" << endl;`;
    }
    if (l.includes('input') || l.includes('read') || l.includes('get') || l.includes('enter')) {
      return `cin >> variable;`;
    }
    return `// I/O: ${label}`;
  }

  if (human) return human;

  if (c.includes('cout') || c.includes('cin')) {
    return normalizeStatement(c);
  }
  if (l.includes('output') || l.includes('print') || l.includes('display') || l.includes('write')) {
    const value = c.replace(/;$/, '').trim();
    if (value.includes('<<')) return `cout << ${value};`;
    return `cout << ${value} << endl;`;
  }
  if (l.includes('input') || l.includes('read') || l.includes('enter')) {
    return `cin >> ${c};`;
  }
  return `cout << ${c} << endl;`;
}

/** manual_input node → grammar StreamStatement (cin) */
export function emitManualInput(label: string, code: string): string {
  const c = code.trim();
  const l = label.toLowerCase();
  const human = normalizeHumanStatement(c || label, 'manual_input');

  if (!c) {
    if (human) return human;
    // Derive variable name from label if possible
    const words = l.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    const varName = words.find(w => !['input', 'enter', 'read', 'get', 'cin', 'the', 'a', 'an'].includes(w)) ?? 'value';
    return `cin >> ${varName};`;
  }

  // Already a cin/scanf statement
  if (c.includes('cin') || c.includes('scanf')) {
    return normalizeStatement(c);
  }

  if (human) return human;

  // Treat code as the variable to read into
  return `cin >> ${c.replace(/;$/, '')};`;
}

/** predefined node → grammar FunctionCall (predefined process) */
export function emitPredefined(label: string, code: string): string {
  const c = code.trim();
  const l = label.trim();

  if (!c) {
    // Convert label like "Calculate Damage" → calculateDamage()
    const words = l.split(/\s+/);
    const camel = words
      .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('');
    if (isValidIdentifier(camel)) return `${camel}();`;
    return `// Call: ${l}`;
  }

  const humanCall = parseHumanCallInstruction(c);
  if (humanCall) {
    return `${humanCall.fnName}(${humanCall.args});`;
  }

  // Already looks like a function call
  if (/\w+\s*\(/.test(c)) return normalizeStatement(c);

  // Wrap in a call if just an identifier was typed
  if (isValidIdentifier(c.replace(/;$/, ''))) return `${c.replace(/;$/, '')}();`;

  return normalizeStatement(c);
}

/** document node → grammar (file I/O comment or ofstream block) */
export function emitDocument(label: string, code: string): string {
  const c = code.trim();
  const l = label.trim();
  const source = c || l;

  if (!c) {
    const human = normalizeHumanStatement(l, 'document');
    if (human) return human;
  }

  // If the user wrote actual fstream code, emit as-is
  if (c.includes('ofstream') || c.includes('ifstream') || c.includes('fstream')) {
    return normalizeStatement(c);
  }

  const fileMatch = source.match(/(?:write|save|create|open|load|read)?\s*(?:to|from)?\s*["']?([^"'\s]+\.(?:txt|csv|json|xml|log))["']?/i);
  if (fileMatch) {
    const filename = fileMatch[1];
    const variableName = normalizeVariableName(filename.replace(/\.[^.]+$/, ''), 'file');
    const streamName = `${variableName}File`;
    if (/^(?:read|load|open\s+from)/i.test(source)) {
      return `ifstream ${streamName}("${filename}");`;
    }
    return `ofstream ${streamName}("${filename}");`;
  }

  const human = normalizeHumanStatement(c, 'document');
  if (human) return human;
  return `// Document: ${source}`;
}

/** delay node → grammar ExpressionStatement (sleep / pause) */
export function emitDelay(label: string, code: string): string {
  const c = code.trim();
  const source = (c || label).toLowerCase();

  if (!c) {
    // Try to extract a duration from the label
    const msMatch = source.match(/(\d+)\s*(?:ms|millisecond|milliseconds)/);
    const sMatch  = source.match(/(\d+)\s*(?:s|sec|second|seconds)/);
    if (msMatch) return `// wait ${msMatch[1]}ms`;
    if (sMatch)  return `// wait ${sMatch[1]} second(s)`;
    return `// Delay / Wait`;
  }

  if (c.includes('sleep') || c.includes('usleep') || c.includes('this_thread')) {
    return `// ${c.replace(/;$/, '')}`;
  }

  const naturalDelay = normalizeEnglishExpression(c).match(/(?:wait|pause|delay)\s+(\d+)\s*(?:s|sec|second|seconds)?/i);
  if (naturalDelay) return `// wait ${naturalDelay[1]} second(s)`;

  // Bare number → treat as seconds
  if (/^\d+$/.test(c)) return `// wait ${c} second(s)`;

  return normalizeStatement(c);
}

/** database node → grammar VariableDeclaration or ExpressionStatement */
export function emitDatabase(label: string, code: string): string {
  const c = code.trim();
  const l = label.trim();
  const human = normalizeHumanStatement(c || label, 'database');

    if (!c) {
      if (human) return human;
    // Suggest a fixed-size array declaration based on label. STL containers are
    // intentionally outside the foundational analyzer scope.
    const words = l.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    const varName = words
      .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('') || 'dataStore';
    if (isValidIdentifier(varName)) return `int ${varName}[10];`;
    return `// Stored Data: ${l}`;
  }

  if (human) return human;
  return normalizeStatement(c);
}

// ─── Graph Helpers ────────────────────────────────────────────────────────────

