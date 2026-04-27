/**
 * Control Flow Graph Generator
 * Implements the Sugiyama Framework for Hierarchical Graph Layout
 * Phase 3 (Output) — Step 1 of the analysis pipeline.
 */

import {
  ASTNode,
  IfStatementNode,
  WhileLoopNode,
  DoWhileLoopNode,
  ForLoopNode,
  FunctionDeclNode,
  ReturnStatementNode,
  BlockNode,
  ControlFlowNode,
  SwitchStatementNode,
} from '../types';
import { Translator } from './translator';

interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  isReversed?: boolean;
}

interface CFG {
  nodes: ControlFlowNode[];
  edges: GraphEdge[];
}

export class CFGGenerator {
  private nodes: ControlFlowNode[] = [];
  private edges: GraphEdge[] = [];
  private currentNodeId = 0;
  private mentor = new Translator();

  /**
   * FIX (user bug #3): A statement that unconditionally transfers control
   * (return / throw / break / continue) ends the current linear flow. Any
   * sibling statements after it in the same block are UNREACHABLE and must
   * NOT be wired into the CFG — otherwise we get visible arrows from
   * "Return" to the next line, which is wrong in C++ semantics.
   */
  private isTerminator(stmt: ASTNode | undefined | null): boolean {
    if (!stmt) return false;
    const t = (stmt as any).type;
    if (t === 'ReturnStatement' || t === 'ThrowStatement') return true;
    if (t === 'LoopControl') {
      const v = (stmt as any).value;
      return v === 'break' || v === 'continue';
    }
    return false;
  }

  // ── FIX 4: Track current function entry node and name for recursion back-edges
  private currentFunctionEntry: ControlFlowNode | null = null;
  private currentFunctionName: string = '';

  generate(ast: ASTNode): CFG {
    this.nodes = [];
    this.edges = [];
    this.currentNodeId = 0;

    const startNode = this.createNode('start', 'Start');
    const endNode   = this.createNode('end', 'End');

    // The visit method returns the last logical node processed in the AST
    const lastNode = this.visit(ast, startNode, endNode);

    // Final safety connection: Ensures the graph doesn't have "dangling" end statements
    if (lastNode && lastNode.id !== endNode.id) {
      const alreadyConnected = this.edges.some(
        e => e.from === lastNode.id && e.to === endNode.id
      );
      
      if (!alreadyConnected) {
        this.connect(lastNode, endNode);
      }
    }

    this.applySugiyamaLayout();

    return { nodes: this.nodes, edges: this.edges };
  }

  // =========================================================================
  //  SUGIYAMA FRAMEWORK
  // =========================================================================

  private applySugiyamaLayout(): void {
    this.breakCycles();
    const layers = this.assignLayers();
    this.minimizeCrossings(layers);
    this.calculateCoordinates(layers);
    this.restoreCycles();
  }

  private breakCycles(): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const dfs = (nodeId: string) => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      const outgoing = this.edges.filter(e => e.from === nodeId);
      for (const edge of outgoing) {
        if (recursionStack.has(edge.to)) {
          const temp = edge.from;
          edge.from = edge.to;
          edge.to = temp;
          edge.isReversed = true;
        } else if (!visited.has(edge.to)) {
          dfs(edge.to);
        }
      }
      recursionStack.delete(nodeId);
    };
    if (this.nodes.length > 0) dfs(this.nodes[0].id);
  }

  private assignLayers(): ControlFlowNode[][] {
    const layers: ControlFlowNode[][] = [];
    const ranks = new Map<string, number>();
    this.nodes.forEach(n => ranks.set(n.id, 0));
    let changed = true;
    let iterations = 0;
    while (changed && iterations < this.nodes.length + 2) {
      changed = false;
      this.edges.forEach(edge => {
        const fromRank = ranks.get(edge.from) || 0;
        const toRank   = ranks.get(edge.to)   || 0;
        if (toRank <= fromRank) {
          ranks.set(edge.to, fromRank + 1);
          changed = true;
        }
      });
      iterations++;
    }
    ranks.forEach((rank, nodeId) => {
      if (!layers[rank]) layers[rank] = [];
      const node = this.nodes.find(n => n.id === nodeId);
      if (node) layers[rank].push(node);
    });
    return layers;
  }

  private minimizeCrossings(layers: ControlFlowNode[][]): void {
    for (let i = 1; i < layers.length; i++) {
      const currentLayer = layers[i];
      const prevLayer    = layers[i - 1];
      const nodeWeights  = currentLayer.map(node => {
        const parents = this.edges
          .filter(e => e.to === node.id && !e.isReversed)
          .map(e => e.from);
        if (parents.length === 0) return { node, weight: 0 };
        let sum = 0, count = 0;
        parents.forEach(parentId => {
          const idx = prevLayer.findIndex(n => n.id === parentId);
          if (idx !== -1) { sum += idx; count++; }
        });
        return { node, weight: count === 0 ? 0 : sum / count };
      });
      nodeWeights.sort((a, b) => a.weight - b.weight);
      layers[i] = nodeWeights.map(nw => nw.node);
    }
  }

  private calculateCoordinates(layers: ControlFlowNode[][]): void {
    const layerHeight  = 100;
    const nodeSpacing  = 150;
    const canvasWidth  = 900;
    layers.forEach((layer, layerIndex) => {
      const layerWidth = layer.length * nodeSpacing;
      const startX     = (canvasWidth - layerWidth) / 2;
      layer.forEach((node, index) => {
        node.y = 50 + layerIndex * layerHeight;
        node.x = startX + index * nodeSpacing;
      });
    });
  }

  private restoreCycles(): void {
    this.edges.forEach(edge => {
      if (edge.isReversed) {
        const temp = edge.from;
        edge.from = edge.to;
        edge.to = temp;
        delete edge.isReversed;
      }
    });
  }

  // =========================================================================
  //  GRAPH CONSTRUCTION
  // =========================================================================

  private createNode(
    type: ControlFlowNode['type'],
    label: string,
    code?: string,
    line?: number,
    astNode?: ASTNode,
  ): ControlFlowNode {
    let tutorExplanation = '';
    if (astNode) {
      try {
        const lines = this.mentor.translate(astNode);
        tutorExplanation = lines.join(' ').replace(/\*\*/g, '');
      } catch (_) {
        // best-effort — never crash the CFG for a translation error
      }
    }

    const node: ControlFlowNode = {
      id: `node_${this.currentNodeId++}`,
      type,
      label,
      code,
      line,
      tutorExplanation,
      children: [],
      x: 0,
      y: 0,
    };
    this.nodes.push(node);
    return node;
  }

  private connect(from: ControlFlowNode, to: ControlFlowNode, label?: string): void {
    this.edges.push({ from: from.id, to: to.id, label });
    from.children.push(to.id);
  }

  private visit(node: ASTNode, current: ControlFlowNode, exit: ControlFlowNode): ControlFlowNode {
  if (!node) return current;

  if (node.type === 'CoutStatement') return this.visitCoutStatement(node as any, current);
  if (node.type === 'CinStatement')  return this.visitCinStatement(node as any, current);

  const methodName = `visit${node.type}`;
  if (typeof (this as any)[methodName] === 'function') {
    return (this as any)[methodName](node, current, exit);
  }

  // Fallback — but ONLY if no method matched (prevents double-visit)
  const anyNode = node as any;
  let lastNode = current;
  const siblings: ASTNode[] = Array.isArray(anyNode.body) ? anyNode.body
                           : Array.isArray(anyNode.statements) ? anyNode.statements
                           : [];
  for (const stmt of siblings) {
    lastNode = this.visit(stmt, lastNode, exit);
    if (this.isTerminator(stmt)) break; // FIX #3
  }
  return lastNode;
}

  // ── Program ───────────────────────────────────────────────────────────────
  private visitProgram(node: any, current: ControlFlowNode, exit: ControlFlowNode): ControlFlowNode {
    let lastNode = current;
    for (const stmt of (node.body || []) as ASTNode[]) {
      lastNode = this.visit(stmt, lastNode, exit);
      if (this.isTerminator(stmt)) break; // FIX #3
    }
    return lastNode;
  }

  // ── If ────────────────────────────────────────────────────────────────────
  private visitIfStatement(
    node: IfStatementNode,
    current: ControlFlowNode,
    exit: ControlFlowNode,
  ): ControlFlowNode {
    const decision = this.createNode(
      'decision', 'Condition', this.nodeToString(node.condition), node.line, node,
    );
    const merge = this.createNode('process', 'Merge');
    this.connect(current, decision);

    let truePath = decision;
    let trueReturned = false;
    for (const stmt of (node.thenBranch || [])) {
      truePath = this.visit(stmt, truePath, merge);
      if (this.isTerminator(stmt)) { trueReturned = true; break; } // FIX #3
    }
    // Only connect to merge if the branch didn't already terminate
    if (!trueReturned) this.connect(truePath, merge, 'True');

    if (node.elseBranch && node.elseBranch.length > 0) {
      let falsePath = decision;
      let falseReturned = false;
      for (const stmt of node.elseBranch) {
        falsePath = this.visit(stmt, falsePath, merge);
        if (this.isTerminator(stmt)) { falseReturned = true; break; } // FIX #3
      }
      if (!falseReturned) this.connect(falsePath, merge, 'False');
    } else {
      this.connect(decision, merge, 'False');
    }
    return merge;
  }

  // ── Switch ────────────────────────────────────────────────────────────────
  private visitSwitchStatement(
    node: SwitchStatementNode,
    current: ControlFlowNode,
    exit: ControlFlowNode,
  ): ControlFlowNode {
    const switchNode = this.createNode(
      'decision', 'Switch', this.nodeToString(node.condition), (node as any).line, node,
    );
    this.connect(current, switchNode);

    const merge = this.createNode('process', 'End Switch');
    let prevDecision = switchNode;

    (node.cases || []).forEach((caseNode: any, i: number) => {
      const caseLabel = caseNode.value
        ? `Case ${this.nodeToString(caseNode.value)}`
        : 'Default';
      const caseDecision = this.createNode('decision', caseLabel);
      this.connect(prevDecision, caseDecision, i === 0 ? undefined : 'else');

      let casePath: ControlFlowNode = caseDecision;
      (caseNode.statements || []).forEach((stmt: ASTNode) => {
        casePath = this.visit(stmt, casePath, merge);
      });
      this.connect(casePath, merge, 'break');
      prevDecision = caseDecision;
    });

    // Last case's "no match" edge goes to merge (default fallthrough)
    this.connect(prevDecision, merge, 'else');
    return merge;
  }

  // ── While ─────────────────────────────────────────────────────────────────
  private visitWhileLoop(
    node: WhileLoopNode,
    current: ControlFlowNode,
    exit: ControlFlowNode,
  ): ControlFlowNode {
    const decision = this.createNode(
      'decision', 'While Loop', this.nodeToString(node.condition), (node as any).line, node,
    );
    this.connect(current, decision);

    let bodyNode = decision;
    (node.body || []).forEach(stmt => {
      bodyNode = this.visit(stmt, bodyNode, decision);
    });
    this.connect(bodyNode, decision, 'Loop');

    const afterLoop = this.createNode('process', 'Exit Loop');
    this.connect(decision, afterLoop, 'False');
    return afterLoop;
  }

  // ── Do-While ──────────────────────────────────────────────────────────────
  private visitDoWhileLoop(
    node: DoWhileLoopNode,
    current: ControlFlowNode,
    exit: ControlFlowNode,
  ): ControlFlowNode {
    const loopStart = this.createNode('process', 'Do-While Body', '', (node as any).line, node);
    this.connect(current, loopStart);

    let bodyNode = loopStart;
    (node.body || []).forEach(stmt => {
      bodyNode = this.visit(stmt, bodyNode, exit);
    });

    const decision = this.createNode(
      'decision', 'Condition', this.nodeToString(node.condition), (node as any).line,
    );
    this.connect(bodyNode, decision);
    this.connect(decision, loopStart, 'True');

    const afterLoop = this.createNode('process', 'Exit Loop');
    this.connect(decision, afterLoop, 'False');
    return afterLoop;
  }

  // ── For ───────────────────────────────────────────────────────────────────
  private visitForLoop(
    node: ForLoopNode,
    current: ControlFlowNode,
    exit: ControlFlowNode,
  ): ControlFlowNode {
    let lastNode = current;
    if (node.init) {
      const initNode = this.createNode(
        'process', 'Init', this.nodeToString(node.init), undefined, node.init as any,
      );
      this.connect(lastNode, initNode);
      lastNode = initNode;
    }

    const decision = this.createNode(
      'decision', 'For Condition',
      node.condition ? this.nodeToString(node.condition) : 'true',
      (node as any).line, node,
    );
    this.connect(lastNode, decision);

    let bodyNode = decision;
    (node.body || []).forEach(stmt => {
      bodyNode = this.visit(stmt, bodyNode, decision);
    });

    if (node.update) {
      const updateNode = this.createNode('process', 'Update', this.nodeToString(node.update));
      this.connect(bodyNode, updateNode);
      this.connect(updateNode, decision, 'Loop');
    } else {
      this.connect(bodyNode, decision, 'Loop');
    }

    const afterLoop = this.createNode('process', 'Exit Loop');
    this.connect(decision, afterLoop, 'False');
    return afterLoop;
  }

  // ── Variable / Assignment ─────────────────────────────────────────────────
  private visitVariableDecl(node: any, current: ControlFlowNode): ControlFlowNode {
    // Build actual C++ declaration so flowchart → code round-trips correctly.
    const dims = Array.isArray(node.dimensions) && node.dimensions.length
      ? node.dimensions.map((d: any) => `[${this.nodeToString(d)}]`).join('')
      : '';
    const init = node.value !== undefined && node.value !== null
      ? ` = ${this.nodeToString(node.value)}`
      : '';
    const code = `${node.varType} ${node.name}${dims}${init}`;
    const step = this.createNode('process', 'Declare', code, node.line, node);
    this.connect(current, step);
    return step;
  }

  private visitAssignment(node: any, current: ControlFlowNode): ControlFlowNode {
    const target = typeof node.target === 'string'
      ? node.target
      : this.nodeToString(node.target);
    const value = this.nodeToString(node.value);
    const step = this.createNode('process', 'Assign', `${target} ${node.operator} ${value}`, node.line, node);
    this.connect(current, step);
    return step;
  }

  // ── Expressions ──────────────────────────────────────────────────────────
  private visitExpressionStatement(node: any, current: ControlFlowNode, exit: ControlFlowNode): ControlFlowNode {
    const code = this.nodeToString(node.expression);
    const step = this.createNode('process', 'Expression', code, node.line, node.expression);
    this.connect(current, step);
    return step;
  }

  // ── FIX 4: visitFunctionCall — draw a labeled recursive back-edge when
  //   the call target matches the function we are currently inside.
  private visitFunctionCall(node: any, current: ControlFlowNode): ControlFlowNode {
    const step = this.createNode('process', `Call: ${node.name}`, `${node.name}(...)`, node.line, node);
    this.connect(current, step);

    // If this call targets the current function, add a "Recursive" back-edge
    // to its entry node so the graph visually shows the self-loop.
    if (node.name === this.currentFunctionName && this.currentFunctionEntry) {
      this.connect(step, this.currentFunctionEntry, 'Recursive');
    }

    return step;
  }

  // ── I/O ───────────────────────────────────────────────────────────────────
  private visitCoutStatement(node: any, current: ControlFlowNode): ControlFlowNode {
    // Reconstruct the actual cout chain so flowchart → code preserves it.
    // Prefer `values` (chained cout << a << b), fall back to legacy `value`.
    const items: any[] = Array.isArray(node.values) && node.values.length
      ? node.values
      : node.value !== undefined && node.value !== null
        ? [node.value]
        : [];
    const code = items.length
      ? `cout << ${items.map(v => this.nodeToString(v)).join(' << ')}`
      : 'cout << ""';
    const step = this.createNode('output', 'Output (cout)', code, node.line, node);
    this.connect(current, step);
    return step;
  }

  private visitCinStatement(node: any, current: ControlFlowNode): ControlFlowNode {
    // Reconstruct the actual cin chain. Prefer `targets`, fall back to `target`.
    const items: any[] = Array.isArray(node.targets) && node.targets.length
      ? node.targets
      : node.target !== undefined && node.target !== null
        ? [node.target]
        : [];
    const code = items.length
      ? `cin >> ${items.map(t => this.nodeToString(t)).join(' >> ')}`
      : 'cin >> variable';
    const step = this.createNode('input', 'Input (cin)', code, node.line, node);
    this.connect(current, step);
    return step;
  }

  // ── Functions ─────────────────────────────────────────────────────────────

  // ── FIX 4: visitFunctionDecl — save/restore currentFunctionEntry and
  //   currentFunctionName so nested function declarations don't clobber
  //   each other, and recursive calls in the body can find the entry node.
  private visitFunctionDecl(
    node: FunctionDeclNode,
    current: ControlFlowNode,
    exit: ControlFlowNode,
  ): ControlFlowNode {
    const funcStart = this.createNode(
      'start',
      `Func: ${node.name}`,
      `${(node as any).returnType} ${node.name}(...)`,
      (node as any).line,
      node,
    );
    const funcEnd = this.createNode('end', `End: ${node.name}`);

    // Save outer function context before overwriting (supports nested functions)
    const prevEntry = this.currentFunctionEntry;
    const prevName  = this.currentFunctionName;

    // Point to this function's entry so visitFunctionCall can find it
    this.currentFunctionEntry = funcStart;
    this.currentFunctionName  = node.name;

    // Functions are self-contained — connect program flow around them
    // but also build their internal graph from funcStart → funcEnd
    this.connect(current, funcStart);
    let lastNode = funcStart;
    if (Array.isArray(node.body)) {
      for (const stmt of node.body) {
        lastNode = this.visit(stmt, lastNode, funcEnd);
        if (this.isTerminator(stmt)) break; // FIX #3
      }
    }
    // If the function body doesn't explicitly return, connect to funcEnd
    if (lastNode !== funcEnd) {
      this.connect(lastNode, funcEnd);
    }

    // Restore the outer function context (important for nested declarations)
    this.currentFunctionEntry = prevEntry;
    this.currentFunctionName  = prevName;

    return funcEnd;
  }

  private visitFunctionPrototype(node: any, current: ControlFlowNode): ControlFlowNode {
    const protoNode = this.createNode(
      'process', `Prototype: ${node.name}`,
      `${node.returnType} ${node.name}(...)`, node.line, node,
    );
    this.connect(current, protoNode);
    return protoNode;
  }

  private visitReturnStatement(
    node: ReturnStatementNode,
    current: ControlFlowNode,
    exit: ControlFlowNode,
  ): ControlFlowNode {
    const ret = this.createNode('end', 'Return', '', (node as any).line, node);
    this.connect(current, ret);
    this.connect(ret, exit);
    return ret;
  }

  private visitBlock(
    node: BlockNode,
    current: ControlFlowNode,
    exit: ControlFlowNode,
  ): ControlFlowNode {
    let lastNode = current;
    for (const stmt of (node.statements || [])) {
      lastNode = this.visit(stmt, lastNode, exit);
      if (this.isTerminator(stmt)) break; // FIX #3: unreachable code — stop
    }
    return lastNode;
  }

  // ── Loop Control ─────────────────────────────────────────────────────────
  private visitLoopControl(node: any, current: ControlFlowNode, exit: ControlFlowNode): ControlFlowNode {
    const label = node.value === 'break' ? '🛑 Break' : '⏭️ Continue';
    const step = this.createNode('process', label, node.value, node.line);
    this.connect(current, step);
    // For break, connect to exit so the graph reflects the jump
    if (node.value === 'break') {
      this.connect(step, exit, 'break');
    }
    return step;
  }

  // ── Range-Based For ──────────────────────────────────────────────────────
  private visitRangeBasedFor(
    node: any,
    current: ControlFlowNode,
    exit: ControlFlowNode,
  ): ControlFlowNode {
    const loopNode = this.createNode(
      'decision',
      `For-each: ${node.name} in ${this.nodeToString(node.range)}`,
      `for (${node.varType} ${node.name} : ...)`,
      node.line,
      node,
    );
    this.connect(current, loopNode);
    let bodyNode = loopNode;
    (node.body || []).forEach((stmt: ASTNode) => {
      bodyNode = this.visit(stmt, bodyNode, loopNode);
    });
    this.connect(bodyNode, loopNode, 'Next');
    const afterLoop = this.createNode('process', 'Exit Range-For');
    this.connect(loopNode, afterLoop, 'Done');
    return afterLoop;
  }

  // ── Try / Catch ───────────────────────────────────────────────────────────
  private visitTryStatement(
    node: any,
    current: ControlFlowNode,
    exit: ControlFlowNode,
  ): ControlFlowNode {
    const tryStart = this.createNode('process', '🛡 Try Block', 'try {', node.line, node);
    this.connect(current, tryStart);

    let lastTry = tryStart;
    (node.body || []).forEach((stmt: ASTNode) => {
      lastTry = this.visit(stmt, lastTry, exit);
    });

    const merge = this.createNode('process', 'After Try-Catch');
    this.connect(lastTry, merge);

    (node.handlers || []).forEach((handler: any) => {
      const paramLabel = handler.param?.type === 'CatchAll'
        ? 'catch(...)'
        : `catch(${handler.param?.varType ?? ''} ${handler.param?.name ?? ''})`;
      const catchNode = this.createNode('decision', `⚠️ ${paramLabel}`, paramLabel, handler.line, handler);
      // Exception edge from try block to catch handler
      this.connect(tryStart, catchNode, 'exception');
      let lastCatch = catchNode;
      (handler.body || []).forEach((stmt: ASTNode) => {
        lastCatch = this.visit(stmt, lastCatch, exit);
      });
      this.connect(lastCatch, merge);
    });

    return merge;
  }

  private visitThrowStatement(
    node: any,
    current: ControlFlowNode,
    exit: ControlFlowNode,
  ): ControlFlowNode {
    const throwNode = this.createNode('end', '🚀 Throw', 'throw ...', node.line, node);
    this.connect(current, throwNode);
    this.connect(throwNode, exit, 'throw');
    return throwNode;
  }

  // ── CP2: Dynamic Memory ───────────────────────────────────────────────────
  private visitNewExpression(node: any, current: ControlFlowNode): ControlFlowNode {
    const label = node.size
      ? `Alloc: new ${node.baseType}[...]`
      : `Alloc: new ${node.baseType}`;
    const step = this.createNode('process', label, label, node.line, node);
    this.connect(current, step);
    return step;
  }

  private visitDeleteStatement(node: any, current: ControlFlowNode): ControlFlowNode {
    const label = node.isArray ? `Free: delete[] ${node.target}` : `Free: delete ${node.target}`;
    const step = this.createNode('process', label, label, node.line, node);
    this.connect(current, step);
    return step;
  }

  // =========================================================================
  //  NODE TO STRING
  // =========================================================================

  private nodeToString(node: any): string {
    if (!node) return '';
    if (typeof node === 'string') return node;

    switch (node.type) {
      case 'Identifier':    return node.name || '';
      case 'Integer':
      case 'Float':
      case 'Literal':       return String(node.value);
      case 'Char':          return `'${node.value}'`;
      case 'String':        return `"${node.value}"`;
      case 'BinaryOp':
        return `${this.nodeToString(node.left)} ${node.operator} ${this.nodeToString(node.right)}`;
      case 'UnaryOp':
        return `${node.operator}${this.nodeToString(node.operand)}`;
      case 'PreIncrement':  return `++${this.nodeToString(node.operand)}`;
      case 'PostIncrement': return `${this.nodeToString(node.operand)}++`;
      case 'PreDecrement':  return `--${this.nodeToString(node.operand)}`;
      case 'PostDecrement': return `${this.nodeToString(node.operand)}--`;
      case 'AddressOf':     return `&${this.nodeToString(node.operand)}`;
      case 'Dereference':   return `*${this.nodeToString(node.operand)}`;
      case 'ArrayAccess': {
        const indices = (node.indices || []).map((i: any) => `[${this.nodeToString(i)}]`).join('');
        return `${node.name}${indices}`;
      }
      case 'Assignment':
        return `${this.nodeToString(node.target)} ${node.operator} ${this.nodeToString(node.value)}`;
      case 'FunctionCall':  return `${node.name}(...)`;
      case 'CastExpression': return `(${node.targetType})${this.nodeToString(node.operand)}`;
      case 'SizeofExpression': return `sizeof(${this.nodeToString(node.value)})`;
      case 'ConditionalExpression':
        return `${this.nodeToString(node.condition)} ? ... : ...`;
      case 'NewExpression':
        return node.size
          ? `new ${node.baseType}[${this.nodeToString(node.size)}]`
          : `new ${node.baseType}`;
      case 'VariableDecl':  return `${node.varType} ${node.name}`;
      case 'ExpressionStatement': return this.nodeToString(node.expression);
      case 'InitializerList':
        return `{${(node.values || []).map((v: any) => this.nodeToString(v)).join(', ')}}`;
      default:
        // Use `??` (nullish coalescing) — the previous `||` chain mis-handled
        // valid string-zero or empty-string `name` fields and also leaked
        // `String(undefined)` when `name` was truthy.
        if (node.name) return String(node.name);
        if (node.value !== undefined && node.value !== null) return String(node.value);
        return node.type ?? '';
    }
  }
}