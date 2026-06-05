import { useState } from 'react';


function flattenStreamChain(node: any): string {
  if (!node) return '';
  // If it's a nested BinaryOp (the new structure), recurse through both sides
  if (node.type === 'BinaryOp' && (node.operator === '<<' || node.operator === '>>')) {
    return `${flattenStreamChain(node.left)} ${node.operator} ${describeValue(node.right)}`;
  }
  // Otherwise, it's the leaf (like cout or a variable), describe it normally
  return describeValue(node);
}

// ─── Friendly label maps ──────────────────────────────────────────────────────
const NODE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  Program:             { label: 'Program',            icon: '📄', color: '#58a6ff' },
  FunctionDecl:        { label: 'Function',           icon: '⚙️', color: '#a371f7' },
  FunctionPrototype:   { label: 'Function Prototype', icon: '📋', color: '#a371f7' },
  VariableDecl:        { label: 'Variable',           icon: '📦', color: '#3fb950' },
  MultipleVariableDecl:{ label: 'Variables',          icon: '📦', color: '#3fb950' },
  IfStatement:         { label: 'If / Else',          icon: '🔀', color: '#e3b341' },
  WhileLoop:           { label: 'While Loop',         icon: '🔁', color: '#e3b341' },
  ForLoop:             { label: 'For Loop',           icon: '🔁', color: '#e3b341' },
  DoWhileLoop:         { label: 'Do-While Loop',      icon: '🔁', color: '#e3b341' },
  RangeBasedFor:       { label: 'For-Each Loop',      icon: '🔁', color: '#e3b341' },
  ReturnStatement:     { label: 'Return',             icon: '↩️', color: '#f0883e' },
  Assignment:          { label: 'Assignment',         icon: '✏️', color: '#79c0ff' },
  BinaryOp:            { label: 'Operation',          icon: '🔢', color: '#79c0ff' },
  UnaryOp:             { label: 'Unary Op',           icon: '🔢', color: '#79c0ff' },
  FunctionCall:        { label: 'Function Call',      icon: '📞', color: '#d2a8ff' },
  MethodCall:          { label: 'Method Call',        icon: '📞', color: '#d2a8ff' },
  CoutStatement:       { label: 'Print Output',       icon: '🖨️', color: '#39d353' },
  CinStatement:        { label: 'Read Input',         icon: '⌨️', color: '#39d353' },
  ArrayAccess:         { label: 'Array Access',       icon: '📋', color: '#79c0ff' },
  SwitchStatement:     { label: 'Switch',             icon: '🔀', color: '#e3b341' },
  TryStatement:        { label: 'Try / Catch',        icon: '🛡️', color: '#f0883e' },
  Block:               { label: 'Block',              icon: '📁', color: '#8b949e' },
  ExpressionStatement: { label: 'Expression',        icon: '💬', color: '#8b949e' },
  LoopControl:         { label: 'Break / Continue',  icon: '⏹️', color: '#f85149' },
  DeleteStatement:     { label: 'Delete Memory',     icon: '🗑️', color: '#f85149' },
  NewExpression:       { label: 'Allocate Memory',   icon: '🆕', color: '#f0883e' },
  StructDecl:          { label: 'Struct',            icon: '🏗️', color: '#a371f7' },
  ClassDecl:           { label: 'Class',             icon: '🏛️', color: '#a371f7' },
  MethodDecl:          { label: 'Method',            icon: '⚙️', color: '#a371f7' },
  Integer:             { label: 'Number',            icon: '🔢', color: '#79c0ff' },
  Float:               { label: 'Decimal',           icon: '🔢', color: '#79c0ff' },
  String:              { label: 'Text',              icon: '💬', color: '#a5d6ff' },
  Char:                { label: 'Character',         icon: '🔤', color: '#a5d6ff' },
  Literal:             { label: 'Boolean',           icon: '⚡', color: '#e3b341' },
  Identifier:          { label: 'Variable Name',    icon: '🏷️', color: '#79c0ff' },
  Include:             { label: 'Include Header',   icon: '📎', color: '#8b949e' },
  Namespace:           { label: 'Namespace',        icon: '🌐', color: '#8b949e' },
};

function getNodeInfo(type: string) {
  return NODE_LABELS[type] ?? { label: type, icon: '🔹', color: '#8b949e' };
}

// ─── Describe a node in plain English ────────────────────────────────────────
function describeNode(node: any): string {
  if (!node || typeof node !== 'object') return '';
  switch (node.type) {
    case 'FunctionDecl':
      return `defines a function called "${node.name}" that returns ${node.returnType}${node.params?.length ? ` with ${node.params.length} parameter(s)` : ' with no parameters'}`;
    case 'VariableDecl': {
      const dims = formatDimensions(node.dimensions);
      const kind = dims ? 'array' : 'variable';
      return `creates a ${node.varType} ${kind} named "${node.name}${dims}"${node.value ? ` set to ${describeValue(node.value)}` : ' (not initialized)'}`;
    }
    case 'Assignment':
      return `sets "${typeof node.target === 'string' ? node.target : node.target?.name ?? '?'}" to ${describeValue(node.value)}`;
    case 'IfStatement':
      return `checks a condition — runs one block if true${node.elseBranch?.length ? ', another if false' : ''}`;
    case 'WhileLoop':
      return `repeats a block of code while ${describeValue(node.condition)} is true`;
    case 'ForLoop':
      return `repeats a block of code a set number of times`;
    case 'ReturnStatement':
      return node.value ? `exits the function and returns ${describeValue(node.value)}` : `exits the function`;
    case 'CoutStatement':
      return `prints ${flattenStreamChain(node.values)} to the screen`;
    case 'CinStatement':
      return `reads input from the user`;
    case 'FunctionCall':
      return `calls the function "${node.name}" with ${node.arguments?.length ?? 0} argument(s)`;
    case 'BinaryOp':
      return `performs ${describeOp(node.operator)} on ${describeValue(node.left)} and ${describeValue(node.right)}`;
    case 'Include':
      return `includes the "${node.name}" library`;
    case 'Namespace':
      return `uses the "${node.name}" namespace (so you can write cout instead of std::cout)`;
    default:
      return '';
  }
}

function describeOp(op: string): string {
  const ops: Record<string, string> = {
    '+': 'addition', '-': 'subtraction', '*': 'multiplication', '/': 'division',
    '%': 'modulo (remainder)', '==': 'equality check', '!=': 'not-equal check',
    '<': 'less-than check', '>': 'greater-than check', '<=': 'less-or-equal check',
    '>=': 'greater-or-equal check', '&&': 'AND logic', '||': 'OR logic',
  };
  return ops[op] ?? `"${op}" operation`;
}

function describeValue(val: any): string {
  if (val === null || val === undefined) return '?';
  if (typeof val === 'string') return `"${val}"`;
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return String(val);
  if (!val.type) return JSON.stringify(val);
  switch (val.type) {
    case 'Integer': return String(val.value);
    case 'Float':   return String(val.value);
    case 'String':  return `"${val.value}"`;
    case 'Char':    return `'${val.value}'`;
    case 'Literal': return String(val.value);
    case 'BinaryOp': return `(${describeValue(val.left)} ${val.operator} ${describeValue(val.right)})`;
    case 'UnaryOp': return `${val.operator}${describeValue(val.operand)}`;
    case 'Identifier': return val.name ?? '?';
    case 'ArrayAccess':
      return `${val.name}${(val.indices ?? []).map((i: any) => `[${describeValue(i)}]`).join('')}`;
    case 'InitializerList':
      return `{${(val.values ?? []).map((v: any) => describeValue(v)).join(', ')}}`;
    default: return val.name ?? val.type ?? '?';
  }
}

function formatDimensions(dimensions?: any[]): string {
  return (dimensions ?? []).map(d => `[${describeValue(d)}]`).join('');
}

// ─── Summary builder ──────────────────────────────────────────────────────────
function buildSummary(ast: any): Array<{ icon: string; color: string; text: string; line?: number }> {
  const items: Array<{ icon: string; color: string; text: string; line?: number }> = [];
  if (!ast) return items;

  // Headers
  (ast.directives ?? []).forEach((d: any) => {
    if (d.type === 'Include') items.push({ icon: '📎', color: '#8b949e', text: `Includes the <${d.name}> library`, line: d.line });
  });
  if (ast.namespace) items.push({ icon: '🌐', color: '#8b949e', text: `Uses namespace "${ast.namespace.name}"`, line: ast.namespace.line });

  // Body
  (ast.body ?? []).forEach((node: any) => {
    if (node.type === 'FunctionDecl') {
      items.push({ icon: '⚙️', color: '#a371f7', text: `Defines function "${node.name}" (returns ${node.returnType}, ${node.params?.length ?? 0} param(s))`, line: node.line });
      (node.body ?? []).forEach((stmt: any) => {
        const desc = describeNode(stmt);
        if (desc) {
          const info = getNodeInfo(stmt.type);
          items.push({ icon: info.icon, color: info.color, text: desc, line: stmt.line });
        }
      });
    } else if (node.type === 'StructDecl') {
      items.push({ icon: '🏗️', color: '#a371f7', text: `Defines a struct called "${node.name}" with ${node.members?.length ?? 0} member(s)`, line: node.line });
    } else {
      const desc = describeNode(node);
      if (desc) {
        const info = getNodeInfo(node.type);
        items.push({ icon: info.icon, color: info.color, text: desc, line: node.line });
      }
    }
  });

  return items;
}

// ─── Tree node component ──────────────────────────────────────────────────────
const TreeNode: React.FC<{ node: any; depth: number }> = ({ node, depth }) => {
  const [expanded, setExpanded] = useState(depth < 2);
  if (!node || typeof node !== 'object') return null;

  const info = getNodeInfo(node.type);
  const children = getChildren(node);
  const hasChildren = children.length > 0;
  const label = getShortLabel(node);

  return (
    <div style={{ marginLeft: depth === 0 ? 0 : '20px', borderLeft: depth > 0 ? '1px solid #21262d' : 'none', paddingLeft: depth > 0 ? '12px' : '0' }}>
      <div
        role={hasChildren ? 'button' : undefined}
        tabIndex={hasChildren ? 0 : undefined}
        aria-expanded={hasChildren ? expanded : undefined}
        onClick={() => hasChildren && setExpanded(e => !e)}
        onKeyDown={e => { if (hasChildren && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setExpanded(v => !v); } }}
        style={{
          display: 'flex', alignItems: 'center', gap: '7px',
          padding: '5px 8px', borderRadius: '7px', cursor: hasChildren ? 'pointer' : 'default',
          transition: 'background 0.15s',
          background: 'transparent',
        }}
        onMouseEnter={e => { if (hasChildren) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {/* Expand toggle */}
        <span style={{ width: '14px', flexShrink: 0, color: '#484f58', fontSize: '10px', fontFamily: 'IBM Plex Mono, monospace' }}>
          {hasChildren ? (expanded ? '▾' : '▸') : ' '}
        </span>

        {/* Icon + type badge */}
        <span style={{ fontSize: '13px', flexShrink: 0 }}>{info.icon}</span>
        <span style={{
          fontSize: '10px', fontWeight: '700', fontFamily: 'IBM Plex Mono, monospace',
          color: info.color, background: `${info.color}15`,
          padding: '1px 6px', borderRadius: '4px', flexShrink: 0,
          border: `1px solid ${info.color}30`,
        }}>
          {info.label}
        </span>

        {/* Short label */}
        {label && (
          <span style={{ fontSize: '11px', color: '#c9d1d9', fontFamily: 'IBM Plex Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {label}
          </span>
        )}

        {/* Line number */}
        {node.line > 0 && (
          <span style={{ fontSize: '10px', color: '#484f58', flexShrink: 0, fontFamily: 'IBM Plex Mono, monospace' }}>L{node.line}</span>
        )}
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {children.map((child, i) => (
            <TreeNode key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

function getShortLabel(node: any): string {
  switch (node.type) {
    case 'FunctionDecl':
    case 'FunctionPrototype':
    case 'MethodDecl':      return `${node.name}()`;
    case 'VariableDecl':    return `${node.varType} ${node.name}${formatDimensions(node.dimensions)}${node.value ? ` = ${describeValue(node.value)}` : ''}`;
    case 'Assignment':      return `${typeof node.target === 'string' ? node.target : node.target?.name ?? '?'} ${node.operator} ${describeValue(node.value)}`;
    case 'BinaryOp':        return `${describeValue(node.left)} ${node.operator} ${describeValue(node.right)}`;
    case 'ReturnStatement': return node.value ? `return ${describeValue(node.value)}` : 'return';
    case 'CoutStatement':   return `print: ${flattenStreamChain(node.values)}`;
    case 'FunctionCall':    return `${node.name}(${node.arguments?.length ?? 0} args)`;
    case 'WhileLoop':       return `while (${describeValue(node.condition)})`;
    case 'IfStatement':     return `if (${describeValue(node.condition)})`;
    case 'Include':         return `<${node.name}>`;
    case 'Namespace':       return `namespace ${node.name}`;
    case 'Integer':
    case 'Float':           return String(node.value);
    case 'String':          return `"${node.value}"`;
    case 'Identifier':      return node.name ?? '';
    case 'LoopControl':     return node.value;
    case 'StructDecl':
    case 'ClassDecl':       return node.name;
    default: return node.name ?? '';
  }
}

function getChildren(node: any): any[] {
  const kids: any[] = [];
  const skip = new Set(['type', 'line', 'column', 'operator', 'varType', 'returnType', 'name', 'isSystem', 'initStyle', 'modifiers', 'dimensions']);

  // Prioritize meaningful child keys
  const priority = ['directives', 'namespace', 'body', 'thenBranch', 'elseBranch', 'condition', 'value', 'left', 'right', 'operand', 'values', 'params', 'arguments', 'cases', 'statements', 'members', 'handlers'];
  const seen = new Set<any>();

  const add = (v: any) => {
    if (!v || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) v.forEach(add);
    else if (typeof v === 'object' && v.type) kids.push(v);
  };

  priority.forEach(k => { if (node[k] !== undefined) add(node[k]); });
  Object.keys(node).forEach(k => {
    if (!skip.has(k) && !priority.includes(k) && node[k] !== null && node[k] !== undefined) add(node[k]);
  });

  return kids;
}

// ─── Main ASTViewer ───────────────────────────────────────────────────────────
export const ASTViewer: React.FC<{ ast: any }> = ({ ast }) => {
  const [view, setView] = useState<'both' | 'summary' | 'tree'>('both');
  const summary = buildSummary(ast);

  const btnStyle = (active: boolean) => ({
    padding: '4px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer',
    fontSize: '11px', fontWeight: '700', fontFamily: 'IBM Plex Mono, monospace',
    background: active ? 'rgba(88,166,255,0.15)' : 'transparent',
    color: active ? '#58a6ff' : '#484f58',
    boxShadow: active ? 'inset 0 0 0 1px rgba(88,166,255,0.3)' : 'none',
    transition: 'all 0.15s',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '4px 2px' }}>

      {/* View toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#0d1117', border: '1px solid #21262d', borderRadius: '8px', padding: '3px', alignSelf: 'flex-start' }}>
        <button style={btnStyle(view === 'both')}    onClick={() => setView('both')}>Both</button>
        <button style={btnStyle(view === 'summary')} onClick={() => setView('summary')}>Summary</button>
        <button style={btnStyle(view === 'tree')}    onClick={() => setView('tree')}>Tree</button>
      </div>

      {/* ── Summary ── */}
      {(view === 'both' || view === 'summary') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ fontSize: '10px', fontWeight: '700', color: '#484f58', letterSpacing: '1px', textTransform: 'uppercase', fontFamily: 'IBM Plex Mono, monospace', marginBottom: '6px', paddingLeft: '4px' }}>
            📖 Plain English Summary
          </div>
          {summary.length === 0 && (
            <div style={{ color: '#484f58', fontSize: '12px', padding: '8px 4px' }}>Nothing to summarize yet.</div>
          )}
          {summary.map((item, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: '10px',
              padding: '8px 10px', borderRadius: '8px',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid #21262d',
              transition: 'background 0.15s',
            }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)'}
            >
              <span style={{ fontSize: '14px', flexShrink: 0, marginTop: '1px' }}>{item.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '12px', color: '#c9d1d9', lineHeight: '1.6' }}>{item.text}</span>
              </div>
              {item.line && item.line > 0 && (
                <span style={{ fontSize: '10px', color: '#484f58', flexShrink: 0, fontFamily: 'IBM Plex Mono, monospace', marginTop: '2px' }}>
                  L{item.line}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Divider ── */}
      {view === 'both' && (
        <div style={{ height: '1px', background: '#21262d', margin: '2px 0' }} />
      )}

      {/* ── Tree ── */}
      {(view === 'both' || view === 'tree') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ fontSize: '10px', fontWeight: '700', color: '#484f58', letterSpacing: '1px', textTransform: 'uppercase', fontFamily: 'IBM Plex Mono, monospace', marginBottom: '6px', paddingLeft: '4px' }}>
            🌳 Syntax Tree  <span style={{ color: '#2d333b', fontWeight: '400' }}>(click nodes to expand)</span>
          </div>
          <div style={{ background: '#010409', border: '1px solid #21262d', borderRadius: '10px', padding: '12px 8px', overflow: 'auto' }}>
            <TreeNode node={ast} depth={0} />
          </div>
        </div>
      )}
    </div>
  );
};
