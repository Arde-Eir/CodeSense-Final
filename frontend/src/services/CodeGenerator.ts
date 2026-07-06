import type { Node, Edge } from '@xyflow/react';
import { detectRequiredHeaders } from './PreprocessorDependencies';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NodeData {
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

const RESERVED_WORDS = new Set([
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

const BASE_TYPES = [
  'long long', 'long double', 'unsigned int',
  'int', 'float', 'double', 'char', 'bool', 'void', 'string', 'auto',
];

const TYPE_MODIFIERS = [
  'const', 'static', 'extern', 'volatile', 'unsigned', 'signed',
  'inline',
];

const INCLUDE_ORDER = [
  'iostream', 'fstream', 'string', 'cmath', 'cstdlib', 'climits', 'iomanip',
];

const str = (v: unknown): string => String(v ?? '').trim();

function isCallConnectorEdge(edge: Edge): boolean {
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

function toIdentifier(value: string, fallback = 'value'): string {
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

function cleanHumanTarget(value: string): string {
  return value
    .trim()
    .replace(/\?+$/g, '')
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/^(?:their|his|her|my|your|its|the)\s+/i, '')
    .replace(/^(?:value|variable|number|text|string|answer)\s+(?:of|for)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeVariableName(value: string, fallback = 'value'): string {
  return toIdentifier(cleanHumanTarget(value), fallback);
}

function normalizeTypeWord(value: string): string | null {
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

function looksLikeCpp(code: string): boolean {
  return /[;{}()]|<<|>>|==|!=|<=|>=|\+\+|--|\b(int|float|double|char|bool|string|auto|return|cout|cin)\b/.test(code);
}

function quoteIfPlainText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '""';
  if (/^["'].*["']$/.test(trimmed)) return trimmed;
  if (/^(true|false|nullptr)$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  if (/^[a-zA-Z_][a-zA-Z0-9_]*(\s*[-+*/%]\s*[a-zA-Z0-9_]+)*$/.test(trimmed)) return trimmed;
  return JSON.stringify(trimmed);
}

function quoteOutputValue(value: string): string {
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

function normalizeEnglishExpression(value: string): string {
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

function pluralizeIdentifier(name: string): string {
  return name.endsWith('s') ? name : `${name}s`;
}

function normalizeDimensionSize(value: string | undefined, fallback = '10'): string {
  if (!value) return fallback;
  const normalized = normalizeEnglishExpression(value).trim();
  return /^-?\d+$/.test(normalized) ? normalized : fallback;
}

function normalizeArrayIndex(value: string): string {
  return normalizeEnglishExpression(value).trim();
}

function normalizeConditionOperand(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^(true|false)$/i.test(trimmed) || /^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  if (/^["'].*["']$/.test(trimmed)) return trimmed;
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) return trimmed;
  return normalizeVariableName(trimmed);
}

function normalizeConditionOperands(value: string): string {
  return value.replace(
    /([^<>=!&|]+?)\s*(==|!=|>=|<=|>|<)\s*([^&|]+?)(?=\s*(?:&&|\|\||$))/g,
    (_match, left: string, op: string, right: string) =>
      `${normalizeConditionOperand(left)} ${op} ${normalizeConditionOperand(right)}`
  );
}

function normalizeEnglishCondition(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/^(if|when|while|repeat while|loop while|as long as|check if|decide if)\s+/i, '')
    .replace(/\?+$/g, '');
  const normalized = normalizeConditionOperands(normalizeEnglishExpression(cleaned))
    .replace(/\s*(&&|\|\|)\s*/g, ' $1 ');
  return /[<>=!]=?|&&|\|\|/.test(normalized) ? normalized : null;
}

function normalizeHumanStatement(text: string, nodeType = 'process'): string | null {
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

function detectIncludes(allCode: string[]): string[] {
  const needed = new Set<string>(['iostream']);
  const combined = allCode.join(' ');

  detectRequiredHeaders(combined).forEach(header => needed.add(header));
  if (/\bINT_(?:MAX|MIN)\b/.test(combined)) needed.add('climits');

  const sorted = INCLUDE_ORDER.filter(h => needed.has(h));
  const rest = [...needed].filter(h => !INCLUDE_ORDER.includes(h)).sort();
  return [...sorted, ...rest];
}

// ─── Variable Declaration Parser ──────────────────────────────────────────────

interface VarDecl {
  modifiers: string[];
  varType: string;
  name: string;
  value?: string;
  isArray: boolean;
  arraySize?: string;
}

function isValidIdentifier(name: string): boolean {
  if (RESERVED_WORDS.has(name)) return false;
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

function parseVarDecl(code: string): VarDecl | null {
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

function normalizeStatement(code: string): string {
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

function isBareIdentifierStatement(code: string): boolean {
  return isValidIdentifier(code.trim().replace(/;$/, ''));
}

function isTopLevelDeclaration(code: string): boolean {
  const s = code.trim();
  if (/^(template\s*<[\s\S]+>\s*)?(class|struct|enum)\s+\w[\s\S]*};?\s*$/.test(s)) return false;
  return /^[\w:<>,\s*&]+?\s+\w+\s*\([^;]*\)\s*\{[\s\S]*\}\s*$/.test(s);
}

function normalizeTopLevelDeclaration(code: string): string {
  const s = code.trim();
  return s;
}

interface ParsedHumanCall {
  fnName: string;
  args: string;
  argNames: string[];
  helperBody?: string;
}

function parseHumanCallInstruction(code: string): ParsedHumanCall | null {
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

function normalizeCondition(code: string): string {
  return (normalizeEnglishCondition(code) ?? code)
    .replace(/^[({[\s]+|[)}\]\s]+$/g, '')
    .replace(/\band\b/g, '&&')
    .replace(/\bor\b/g, '||')
    .trim() || '/* condition */';
}

// ─── Node-type specific code emitters ────────────────────────────────────────
// Each matches the grammar construct for that ISO 5807 shape.

/** io node → grammar StreamStatement (cout) */
function emitIO(label: string, code: string): string {
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
function emitManualInput(label: string, code: string): string {
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
function emitPredefined(label: string, code: string): string {
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
function emitDocument(label: string, code: string): string {
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
function emitDelay(label: string, code: string): string {
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
function emitDatabase(label: string, code: string): string {
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

function buildAdjacency(edges: Edge[], nodeIds: Set<string>): Map<string, Edge[]> {
  const adj = new Map<string, Edge[]>();
  for (const e of edges) {
    if (isCallConnectorEdge(e)) continue;
    // HARDENING: skip dangling edges — edges referencing a node that was
    // deleted but whose ref lingers in state. Without this, traverse() can
    // dereference a missing node and emit malformed code.
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e);
  }
  for (const [, outEdges] of adj) {
    outEdges.sort((a, b) => {
      const aL = str(a.label).toLowerCase();
      const bL = str(b.label).toLowerCase();
      const aTrue = aL === 'true' || aL === 'yes';
      const bTrue = bL === 'true' || bL === 'yes';
      return aTrue === bTrue ? 0 : aTrue ? -1 : 1;
    });
  }
  return adj;
}

function findStartNode(nodes: Node<NodeData>[], edges: Edge[]): Node<NodeData> | undefined {
  const explicit = nodes.find(
    n => n.type === 'terminator' && str(n.data.label).toLowerCase() === 'start'
  );
  if (explicit) return explicit;
  const targetIds = new Set(edges.map(e => e.target));
  return nodes.find(n => !targetIds.has(n.id));
}

function resolveCode(node: Node<NodeData>): string {
  const code = str(node.data.code);
  const label = str(node.data.label);
  return code || label;
}

function collectAllCode(nodes: Node<NodeData>[]): string[] {
  return nodes
    // Pure structural routing nodes don't emit C++ statements
    .filter(n => !['terminator', 'connector', 'junction'].includes(String(n.type ?? '')))
    .map(n => resolveCode(n))
    .filter(Boolean);
}

function collectTopLevelDeclarations(nodes: Node<NodeData>[]): string[] {
  const seen = new Set<string>();
  const declarations: string[] = [];
  for (const node of nodes) {
    if (node.type === 'terminator' || node.type === 'junction' || node.type === 'connector') continue;
    const raw = resolveCode(node);
    if (!isTopLevelDeclaration(raw)) continue;
    const normalized = normalizeTopLevelDeclaration(raw);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    declarations.push(normalized);
  }
  return declarations;
}

function collectGeneratedHelperDeclarations(nodes: Node<NodeData>[]): string[] {
  const seen = new Set<string>();
  const declarations: string[] = [];

  for (const node of nodes) {
    if (node.type !== 'predefined' && node.type !== 'off_page_connector') continue;
    const call = parseHumanCallInstruction(resolveCode(node));
    if (!call?.helperBody || seen.has(call.fnName)) continue;

    const body = normalizeHumanStatement(call.helperBody, 'process')
      ?? normalizeHumanStatement(call.helperBody, 'io')
      ?? normalizeStatement(call.helperBody);

    seen.add(call.fnName);
    const params = call.argNames.map(name => `int ${name}`).join(', ');

    declarations.push([
      `void ${call.fnName}(${params}) {`,
      `    ${body}`,
      '}',
    ].join('\n'));
  }

  return declarations;
}

function collectDeclaredVariables(code: string): Set<string> {
  const declarations = new Set<string>();
  for (const line of code.split('\n')) {
    const decl = parseVarDecl(line.trim());
    if (decl) declarations.add(decl.name);
  }
  return declarations;
}

function inferInputType(name: string): string {
  if (/(?:name|text|word|sentence|message|title|address|email)$/i.test(name)) return 'string';
  if (/^(?:is|has|can|should)[A-Z_]/.test(name) || /(?:flag|valid|active|done|finished|allowed)$/i.test(name)) return 'bool';
  if (/(?:price|amount|average|total|grade|score|rate|height|weight|temperature|distance)$/i.test(name)) return 'double';
  return 'int';
}

function buildMissingInputDeclarations(bodyCode: string): string[] {
  const declared = collectDeclaredVariables(bodyCode);
  const declarations: string[] = [];
  const seen = new Set<string>();
  const inputPattern = /\bcin\s*>>\s*([A-Za-z_][A-Za-z0-9_]*)\s*;/g;

  for (const match of bodyCode.matchAll(inputPattern)) {
    const name = match[1];
    if (declared.has(name) || seen.has(name)) continue;
    seen.add(name);
    declarations.push(`${inferInputType(name)} ${name};`);
  }

  return declarations;
}

function findMergeNode(
  aId: string | undefined,
  bId: string | undefined,
  adj: Map<string, Edge[]>
): string | undefined {
  if (!aId || !bId) return undefined;
  if (aId === bId) return aId;

  const aReachable = new Set<string>();
  const queue = [aId];
  while (queue.length) {
    const id = queue.shift()!;
    if (aReachable.has(id)) continue;
    aReachable.add(id);
    for (const e of adj.get(id) ?? []) queue.push(e.target);
  }

  const bQueue = [bId];
  const bVisited = new Set<string>();
  while (bQueue.length) {
    const id = bQueue.shift()!;
    if (bVisited.has(id)) continue;
    bVisited.add(id);
    if (aReachable.has(id)) return id;
    for (const e of adj.get(id) ?? []) bQueue.push(e.target);
  }
  return undefined;
}

// ─── Loop Detection ───────────────────────────────────────────────────────────

function reachesNode(startId: string, targetId: string, adj: Map<string, Edge[]>): boolean {
  if (startId === targetId) return true;
  const visited = new Set<string>();
  const queue: string[] = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    if (id === targetId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const e of adj.get(id) ?? []) {
      if (!visited.has(e.target)) queue.push(e.target);
    }
  }
  return false;
}

/**
 * A decision node represents a loop only when EXACTLY ONE branch loops back to
 * it. If both branches eventually loop back, the decision is an `if` nested
 * inside an outer loop (the outer loop is what makes both branches return).
 * If neither branch loops back, it's a plain `if`.
 */
function detectLoop(
  nodeId: string,
  trueEdge: Edge | undefined,
  falseEdge: Edge | undefined,
  adj: Map<string, Edge[]>
): { isLoop: boolean; bodyEdge?: Edge; exitEdge?: Edge } {
  const trueLoops  = !!(trueEdge  && reachesNode(trueEdge.target,  nodeId, adj));
  const falseLoops = !!(falseEdge && reachesNode(falseEdge.target, nodeId, adj));

  if (trueLoops && !falseLoops) return { isLoop: true,  bodyEdge: trueEdge,  exitEdge: falseEdge };
  if (falseLoops && !trueLoops) return { isLoop: true,  bodyEdge: falseEdge, exitEdge: trueEdge  };
  return { isLoop: false };
}

// ─── Main Traversal ───────────────────────────────────────────────────────────

function traverse(
  nodeId: string,
  nodeMap: Map<string, Node<NodeData>>,
  adj: Map<string, Edge[]>,
  visited: Set<string>,
  indent: string,
  stopAt: Set<string>
): string {
  let output = '';
  let currentId: string | undefined = nodeId;

  while (currentId && !visited.has(currentId) && !stopAt.has(currentId)) {
    const node = nodeMap.get(currentId);
    if (!node) break;

    visited.add(currentId);
    const outEdges: Edge[] = adj.get(currentId) ?? [];

    // ── Terminator (Start / End) — no emitted code ────────────────────────────
    if (node.type === 'terminator') {
      currentId = outEdges[0]?.target;
      continue;
    }

    // ── Junction (merge point) — structural only, no emitted code ────────────
    if (node.type === 'junction') {
      currentId = outEdges[0]?.target;
      continue;
    }

    // ── On-page connector (break / continue) ─────────────────────────────────
    if (node.type === 'connector') {
      const code = str(node.data.code).toLowerCase();
      const label = str(node.data.label).toLowerCase();
      if (code === 'break' || label === 'break') {
        output += `${indent}break;\n`;
        break;
      }
      if (code === 'continue' || label === 'continue') {
        output += `${indent}continue;\n`;
        break;
      }
      currentId = outEdges[0]?.target;
      continue;
    }

    // ── Off-page connector (cross-page routing/reference) ─────────────────────
    if (node.type === 'off_page_connector') {
      const label = str(node.data.label);
      output += `${indent}// Off-page connector: ${label || 'reference'}\n`;
      currentId = outEdges[0]?.target;
      continue;
    }

    // ── Decision → IfStatement or WhileLoop ──────────────────────────────────
    if (node.type === 'decision') {
      const rawCondition = resolveCode(node);
      const condition = normalizeCondition(rawCondition);

      const labelledTrueEdge = outEdges.find(e => {
        const l = str(e.label).toLowerCase();
        return l === 'true' || l === 'yes';
      });

      const labelledFalseEdge: Edge | undefined = outEdges.find(e => {
        const l = str(e.label).toLowerCase();
        return l === 'false' || l === 'no';
      });

      const trueEdge = labelledTrueEdge ?? (!labelledFalseEdge ? outEdges[0] : undefined);
      const falseEdge = labelledFalseEdge ?? (labelledTrueEdge ? outEdges.find(e => e !== labelledTrueEdge) : undefined);

      const loopInfo = detectLoop(currentId, trueEdge, falseEdge, adj);

      if (loopInfo.isLoop) {
        // The body is the branch that loops back to the decision; the exit is
        // the other branch (where execution continues after the loop). If the
        // looping branch is the FALSE branch, we negate the condition so the
        // emitted while reads naturally.
        const bodyEdge = loopInfo.bodyEdge;
        const exitEdge = loopInfo.exitEdge;
        const negate   = bodyEdge === falseEdge;
        const whileCondition = negate ? `!(${condition})` : condition;

        output += `${indent}while (${whileCondition}) {\n`;
        if (bodyEdge) {
          // Body must terminate when it reaches back to the decision — pass
          // the decision node id as a stop so we don't re-emit it.
          const stopAtBody = new Set([currentId]);
          output += traverse(bodyEdge.target, nodeMap, adj, new Set(visited), indent + '    ', stopAtBody);
        }
        output += `${indent}}\n`;

        currentId = exitEdge?.target;
        continue;
      }

      // Single-exit decisions are valid flowchart shorthand for a one-arm if.
      if ((trueEdge && !falseEdge) || (falseEdge && !trueEdge)) {
        const branchEdge = trueEdge ?? falseEdge;
        const branchCondition = falseEdge && !trueEdge ? `!(${condition})` : condition;
        output += `${indent}if (${branchCondition}) {\n`;
        if (branchEdge) {
          output += traverse(branchEdge.target, nodeMap, adj, new Set(visited), indent + '    ', new Set());
        }
        output += `${indent}}\n`;
        break;
      }

      // Plain if / if-else
      const mergeNode = findMergeNode(trueEdge?.target, falseEdge?.target, adj);
      const mergeSet  = mergeNode ? new Set([mergeNode]) : new Set<string>();

      output += `${indent}if (${condition}) {\n`;
      if (trueEdge && trueEdge.target !== mergeNode) {
        output += traverse(trueEdge.target, nodeMap, adj, new Set(visited), indent + '    ', mergeSet);
      }
      output += `${indent}}`;
      if (falseEdge && falseEdge.target !== mergeNode) {
        output += ` else {\n`;
        output += traverse(falseEdge.target, nodeMap, adj, new Set(visited), indent + '    ', mergeSet);
        output += `${indent}}`;
      }
      output += '\n';

      currentId = mergeNode;
      continue;
    }

    // ── I/O (cout) ────────────────────────────────────────────────────────────
    if (node.type === 'io') {
      output += `${indent}${emitIO(str(node.data.label), str(node.data.code))}\n`;
      currentId = outEdges[0]?.target;
      continue;
    }

    // ── Manual Input (cin) ────────────────────────────────────────────────────
    if (node.type === 'manual_input') {
      output += `${indent}${emitManualInput(str(node.data.label), str(node.data.code))}\n`;
      currentId = outEdges[0]?.target;
      continue;
    }

    // ── Predefined Process (function call) ────────────────────────────────────
    if (node.type === 'predefined') {
      const rawCode = resolveCode(node);
      if (isTopLevelDeclaration(rawCode)) {
        output += `${indent}// Function definition emitted above main: ${str(node.data.label) || 'helper'}\n`;
      } else {
        output += `${indent}${emitPredefined(str(node.data.label), str(node.data.code))}\n`;
      }
      currentId = outEdges[0]?.target;
      continue;
    }

    // ── Document (file output / report) ──────────────────────────────────────
    if (node.type === 'document') {
      output += `${indent}${emitDocument(str(node.data.label), str(node.data.code))}\n`;
      currentId = outEdges[0]?.target;
      continue;
    }

    // ── Delay (sleep / wait) ─────────────────────────────────────────────────
    if (node.type === 'delay') {
      output += `${indent}${emitDelay(str(node.data.label), str(node.data.code))}\n`;
      currentId = outEdges[0]?.target;
      continue;
    }

    // ── Stored Data (data container) ─────────────────────────────────────────
    if (node.type === 'database') {
      output += `${indent}${emitDatabase(str(node.data.label), str(node.data.code))}\n`;
      currentId = outEdges[0]?.target;
      continue;
    }

    // ── Process node → VariableDeclaration or ExpressionStatement ────────────
    {
      const rawCode = resolveCode(node);
      const label = str(node.data.label);
      const humanStatement = normalizeHumanStatement(rawCode, 'process');

      if (isTopLevelDeclaration(rawCode)) {
        output += `${indent}// Top-level declaration emitted above main: ${label || 'custom C++'}\n`;
      } else if (humanStatement) {
        output += `${indent}${humanStatement}\n`;
      } else if (isBareIdentifierStatement(rawCode)) {
        output += `${indent}int ${rawCode.trim().replace(/;$/, '')};\n`;
      } else if (!rawCode || rawCode === 'Process' || (rawCode === label && !rawCode.includes('=') && !rawCode.includes('('))) {
        if (label && label !== 'Process' && label.length < 80) {
          output += `${indent}// ${label}\n`;
        } else {
          output += `${indent}// TODO: implement this step\n`;
        }
      } else {
        const decl = parseVarDecl(rawCode);
        if (decl) {
          const modPart = decl.modifiers.length ? decl.modifiers.join(' ') + ' ' : '';
          if (decl.isArray) {
            const init = decl.value ? ` = ${decl.value}` : '';
            output += `${indent}${modPart}${decl.varType} ${decl.name}[${decl.arraySize}]${init};\n`;
          } else {
            const init = decl.value !== undefined ? ` = ${decl.value}` : '';
            output += `${indent}${modPart}${decl.varType} ${decl.name}${init};\n`;
          }
        } else {
          if (rawCode.includes('\n') || rawCode.trimEnd().endsWith('}')) {
            output += rawCode.split('\n').map(l => `${indent}${l}`).join('\n') + '\n';
          } else {
            output += `${indent}${normalizeStatement(rawCode)}\n`;
          }
        }
      }

      currentId = outEdges[0]?.target;
    }
  }

  return output;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const generateCppFromGraph = (nodes: Node[], edges: Edge[]): string => {
  if (nodes.length === 0) {
    return [
      '#include <iostream>',
      'using namespace std;',
      '',
      'int main() {',
      '    // No nodes yet — use ADD NODE to build your flowchart',
      '    return 0;',
      '}',
      '',
    ].join('\n');
  }

  const typedNodes = nodes as Node<NodeData>[];
  const nodeMap = new Map(typedNodes.map(n => [n.id, n]));
  const nodeIdSet = new Set(nodeMap.keys());
  const adj = buildAdjacency(edges, nodeIdSet);

  const startNode = findStartNode(typedNodes, edges);
  if (!startNode) {
    return [
      '#include <iostream>',
      'using namespace std;',
      '',
      'int main() {',
      '    // No Start node found — add a Start terminator to your flowchart',
      '    return 0;',
      '}',
      '',
    ].join('\n');
  }

  const bodyLines = traverse(
    startNode.id,
    nodeMap,
    adj,
    new Set(),
    '    ',
    new Set()
  );
  const allCode = collectAllCode(typedNodes);
  const topLevelDeclarations = collectTopLevelDeclarations(typedNodes);
  const generatedHelperDeclarations = collectGeneratedHelperDeclarations(typedNodes);
  const declarations = [...topLevelDeclarations, ...generatedHelperDeclarations];
  const includes = detectIncludes([...allCode, ...generatedHelperDeclarations, bodyLines]);
  const missingInputDeclarations = buildMissingInputDeclarations(bodyLines);
  const mainBody = [
    ...missingInputDeclarations.map(line => `    ${line}`),
    ...(missingInputDeclarations.length && bodyLines.trimEnd() ? [''] : []),
    bodyLines.trimEnd() || '    // Empty graph — connect your nodes',
  ].join('\n');

  return [
    ...includes.map(h => `#include <${h}>`),
    'using namespace std;',
    '',
    ...(declarations.length
      ? [
          ...declarations.flatMap(block => [block, '']),
        ]
      : []),
    'int main() {',
    mainBody,
    '    return 0;',
    '}',
    '',
  ].join('\n');
};
