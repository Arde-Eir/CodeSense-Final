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
   * (return / throw / goto / break / continue) ends the current linear flow. Any
   * sibling statements after it in the same block are UNREACHABLE and must
   * NOT be wired into the CFG — otherwise we get visible arrows from
   * "Return" to the next line, which is wrong in C++ semantics.
   */
  private isTerminator(stmt: ASTNode | undefined | null): boolean {
    if (!stmt) return false;
    const t = (stmt as any).type;
    if (t === 'ReturnStatement' || t === 'ThrowStatement' || t === 'GotoStatement') return true;
    if (t === 'LoopControl') {
      const v = (stmt as any).value;
      return v === 'break' || v === 'continue';
    }
    return false;
  }

  // ── FIX 4: Track current function entry node and name for recursion back-edges
  private currentFunctionEntry: ControlFlowNode | null = null;
  private currentFunctionName: string = '';
  private currentContinueTarget: ControlFlowNode | null = null;
  private currentBreakTarget: ControlFlowNode | null = null;

  // Pre-collected user-defined function names for recursion back-edges.
  private definedFunctions = new Set<string>();
  private functionDeclarations = new Map<string, FunctionDeclNode>();
  private inlineCallStack: string[] = [];
  private readonly maxInlineFunctionDepth = 4;
  private nextEdgeLabel: string | null = null;

  private preCollectFunctions(ast: any): void {
    this.definedFunctions.clear();
    this.functionDeclarations.clear();
    const walk = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'FunctionDecl' && node.name) {
        this.definedFunctions.add(node.name);
        this.functionDeclarations.set(node.name, node as FunctionDeclNode);
      }
      for (const key of Object.keys(node)) {
        const v = node[key];
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') walk(v);
      }
    };
    walk(ast);
  }

  // ── PDF #3 fix: track the current function's EXIT node so a `return` inside
  // a nested control-flow construct (if / while / switch / try) jumps straight
  // to the function end, not to the local block-merge node. Without this, the
  // `exit` parameter passed through the visitor is whatever the surrounding
  // construct chose as its local merge — wiring a Return into the merge made
  // the CFG show flow continuing into unreachable code (which the user
  // reported as bug #3 in the bug report).
  private currentFunctionExit: ControlFlowNode | null = null;

  generate(ast: ASTNode): CFG {
    this.nodes = [];
    this.edges = [];
    this.currentNodeId = 0;
    this.preCollectFunctions(ast);

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
    return layers.filter((layer): layer is ControlFlowNode[] => Array.isArray(layer) && layer.length > 0);
  }

  private minimizeCrossings(layers: ControlFlowNode[][]): void {
    for (let i = 1; i < layers.length; i++) {
      const currentLayer = layers[i];
      const prevLayer    = layers[i - 1];
      if (!currentLayer || !prevLayer) continue;
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
    // Per-type heights mirror the ReactFlow NODE_SIZES defined in FlowGraph.tsx.
    const NODE_H: Record<string, number> = {
      start: 60, end: 60,        // terminator pill
      decision: 170,             // diamond
      junction: 36,              // small routing merge point
      connector: 80,             // circle
      off_page_connector: 90,
      document: 120,
      delay: 90,
      database: 120,
      output: 95, input: 95,
      predefined: 105,
      process: 105,
    };
    const NODE_W: Record<string, number> = {
      start: 200, end: 200,
      decision: 170,
      junction: 36,
      connector: 80,
      off_page_connector: 100,
      document: 260,
      delay: 240,
      database: 240,
      output: 260, input: 240,
      predefined: 285,
      process: 260,
    };

    const V_GAP = 96; // minimum vertical breathing room between layers
    const H_GAP = 76; // minimum horizontal breathing room between siblings

    // Compute per-layer widths and the tallest node in each layer.
    const layerWidths = layers.map(layer =>
      layer.reduce((sum, n) => sum + (NODE_W[n.type] ?? 180) + H_GAP, -H_GAP),
    );
    const layerMaxH = layers.map(layer =>
      Math.max(...layer.map(n => NODE_H[n.type] ?? 90)),
    );

    // All layers are centred on the same axis (the widest layer defines the canvas).
    const canvasWidth = Math.max(...layerWidths) + 160; // 80 px margin each side

    let y = 80;
    layers.forEach((layer, li) => {
      const layerWidth = layerWidths[li];
      const startX = (canvasWidth - layerWidth) / 2;
      let x = startX;
      layer.forEach(node => {
        const w = NODE_W[node.type] ?? 180;
        node.x = x;
        node.y = y;
        x += w + H_GAP;
      });
      y += layerMaxH[li] + V_GAP;
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
        tutorExplanation = this.mentor.translateBrief(astNode);
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
    const edgeLabel = label ?? this.nextEdgeLabel ?? undefined;
    this.nextEdgeLabel = null;
    this.edges.push({ from: from.id, to: to.id, label: edgeLabel });
    from.children.push(to.id);
  }

  private isArrayDecl(node: any): boolean {
    return Array.isArray(node?.dimensions) && node.dimensions.length > 0;
  }

  private isFileStreamType(type: string | undefined): boolean {
    return /\b(?:fstream|ofstream|ifstream)\b/.test(String(type ?? ''));
  }

  private isDelayCall(node: any): boolean {
    const name = String(node?.name ?? '').toLowerCase();
    return /^(?:sleep|usleep|delay|wait|pause)$/.test(name) || name.includes('sleep_for');
  }

  private functionCallToString(node: any): string {
    const args = Array.isArray(node?.arguments)
      ? node.arguments.map((arg: any) => this.nodeToString(arg)).join(', ')
      : '';
    return `${node?.name ?? 'function'}(${args})`;
  }

  private functionSignatureToString(node: FunctionDeclNode): string {
    const params = Array.isArray((node as any).params)
      ? (node as any).params.map((param: any) => {
          const type = param.varType ?? param.typeName ?? param.paramType ?? 'auto';
          const name = param.name ? ` ${param.name}` : '';
          return `${type}${name}`;
        }).join(', ')
      : '';
    return `${(node as any).returnType ?? 'void'} ${node.name}(${params})`;
  }

  private buildFunctionDefinitionGraph(node: FunctionDeclNode): void {
    const fnStart = this.createNode(
      'predefined',
      `Function: ${node.name}`,
      this.functionSignatureToString(node),
      (node as any).line,
      node,
    );
    const fnEnd = this.createNode('predefined', `End: ${node.name}`);

    const prevEntry = this.currentFunctionEntry;
    const prevName  = this.currentFunctionName;
    const prevExit  = this.currentFunctionExit;

    this.currentFunctionEntry = fnStart;
    this.currentFunctionName  = node.name;
    this.currentFunctionExit  = fnEnd;

    let lastNode: ControlFlowNode = fnStart;
    let bodyTerminated = false;
    if (Array.isArray(node.body)) {
      for (const stmt of node.body) {
        lastNode = this.visit(stmt, lastNode, fnEnd);
        if (this.isTerminator(stmt)) { bodyTerminated = true; break; }
      }
    }

    if (!bodyTerminated) this.connect(lastNode, fnEnd);

    this.currentFunctionEntry = prevEntry;
    this.currentFunctionName  = prevName;
    this.currentFunctionExit  = prevExit;
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
    const body = (node.body || []) as ASTNode[];
    const mainFunction = body.find((stmt: any) => stmt?.type === 'FunctionDecl' && stmt.name === 'main') as FunctionDeclNode | undefined;

    if (mainFunction) {
      for (const stmt of body) {
        if ((stmt as any)?.type === 'FunctionDecl' && (stmt as any).name !== 'main') {
          this.buildFunctionDefinitionGraph(stmt as FunctionDeclNode);
        }
      }

      let lastNode = current;

      for (const stmt of body) {
        if ((stmt as any)?.type === 'FunctionDecl' || (stmt as any)?.type === 'FunctionPrototype') continue;
        lastNode = this.visit(stmt, lastNode, exit);
        if (this.isTerminator(stmt)) break;
      }

      const prevEntry = this.currentFunctionEntry;
      const prevName  = this.currentFunctionName;
      const prevExit  = this.currentFunctionExit;

      this.currentFunctionEntry = current;
      this.currentFunctionName  = 'main';
      this.currentFunctionExit  = exit;

      let bodyNode = lastNode;
      let bodyTerminated = false;
      if (Array.isArray(mainFunction.body)) {
        for (const stmt of mainFunction.body) {
          bodyNode = this.visit(stmt, bodyNode, exit);
          if (this.isTerminator(stmt)) { bodyTerminated = true; break; }
        }
      }

      this.currentFunctionEntry = prevEntry;
      this.currentFunctionName  = prevName;
      this.currentFunctionExit  = prevExit;

      return bodyTerminated ? exit : bodyNode;
    }

    let lastNode = current;
    for (const stmt of body) {
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
    const merge = this.createNode('junction', 'Merge');
    this.connect(current, decision);

    let truePath = decision;
    let trueReturned = false;
    this.nextEdgeLabel = 'True';
    for (const stmt of (node.thenBranch || [])) {
      truePath = this.visit(stmt, truePath, merge);
      if (this.isTerminator(stmt)) { trueReturned = true; break; } // FIX #3
    }
    // Only connect to merge if the branch didn't already terminate
    if (!trueReturned) this.connect(truePath, merge);

    if (node.elseBranch && node.elseBranch.length > 0) {
      let falsePath = decision;
      let falseReturned = false;
      this.nextEdgeLabel = 'False';
      for (const stmt of node.elseBranch) {
        falsePath = this.visit(stmt, falsePath, merge);
        if (this.isTerminator(stmt)) { falseReturned = true; break; } // FIX #3
      }
      if (!falseReturned) this.connect(falsePath, merge);
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
      'decision', `Switch (${this.nodeToString(node.condition)})`,
      this.nodeToString(node.condition), (node as any).line, node,
    );
    this.connect(current, switchNode);

    const merge = this.createNode('junction', 'End Switch');
    const prevBreakTarget = this.currentBreakTarget;
    this.currentBreakTarget = merge;

    // All cases branch in parallel from the switch decision node.
    (node.cases || []).forEach((caseNode: any) => {
      const caseLabel = caseNode.value
        ? `Case ${this.nodeToString(caseNode.value)}`
        : 'Default';
      const caseStart = this.createNode('process', caseLabel);
      this.connect(switchNode, caseStart, caseLabel);

      let casePath: ControlFlowNode = caseStart;
      let caseTerminated = false;
      for (const stmt of (caseNode.statements || []) as ASTNode[]) {
        casePath = this.visit(stmt, casePath, merge);
        if (this.isTerminator(stmt) || (stmt as any).type === 'LoopControl') {
          caseTerminated = true;
          break;
        }
      }
      // Only add fallthrough edge when the case didn't end with break/return
      if (!caseTerminated) this.connect(casePath, merge, 'fallthrough');
    });

    // If no cases matched (or no default), flow continues past the switch
    this.connect(switchNode, merge, 'no match');
    this.currentBreakTarget = prevBreakTarget;
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

    const afterLoop = this.createNode('process', 'Exit Loop');
    this.connect(decision, afterLoop, 'False');

    let bodyNode = decision;
    let bodyTerminated = false;
    const prevContinueTarget = this.currentContinueTarget;
    const prevBreakTarget = this.currentBreakTarget;
    this.currentContinueTarget = decision;
    this.currentBreakTarget = afterLoop;
    for (const stmt of (node.body || [])) {
      bodyNode = this.visit(stmt, bodyNode, afterLoop);
      if (this.isTerminator(stmt)) { bodyTerminated = true; break; }
    }
    this.currentContinueTarget = prevContinueTarget;
    this.currentBreakTarget = prevBreakTarget;
    if (!bodyTerminated) this.connect(bodyNode, decision, 'Loop');

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
    const prevContinueTarget = this.currentContinueTarget;
    const prevBreakTarget = this.currentBreakTarget;
    this.currentContinueTarget = loopStart;
    this.currentBreakTarget = exit;
    (node.body || []).forEach(stmt => {
      bodyNode = this.visit(stmt, bodyNode, exit);
    });
    this.currentContinueTarget = prevContinueTarget;
    this.currentBreakTarget = prevBreakTarget;

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

    const afterLoop = this.createNode('process', 'Exit Loop');
    this.connect(decision, afterLoop, 'False');

    let bodyNode = decision;
    let bodyTerminated = false;
    const updateNode = node.update
      ? this.createNode('process', 'Update', this.nodeToString(node.update))
      : null;
    const prevContinueTarget = this.currentContinueTarget;
    const prevBreakTarget = this.currentBreakTarget;
    this.currentContinueTarget = updateNode ?? decision;
    this.currentBreakTarget = afterLoop;
    for (const stmt of (node.body || [])) {
      bodyNode = this.visit(stmt, bodyNode, afterLoop);
      if (this.isTerminator(stmt)) { bodyTerminated = true; break; }
    }
    this.currentContinueTarget = prevContinueTarget;
    this.currentBreakTarget = prevBreakTarget;

    if (!bodyTerminated) {
      if (updateNode) {
        this.connect(bodyNode, updateNode);
        this.connect(updateNode, decision, 'Loop');
      } else {
        this.connect(bodyNode, decision, 'Loop');
      }
    }

    return afterLoop;
  }

  // ── Variable / Assignment ─────────────────────────────────────────────────
  private visitVariableDecl(node: any, current: ControlFlowNode): ControlFlowNode {
    // Build actual C++ declaration so flowchart → code round-trips correctly.
    const dims = Array.isArray(node.dimensions) && node.dimensions.length
      ? node.dimensions.map((d: any) => `[${this.nodeToString(d)}]`).join('')
      : '';
    const hasInitializer = node.value !== undefined && node.value !== null;
    const init = hasInitializer && node.initStyle === 'constructor'
      ? `(${this.nodeToString(node.value)})`
      : hasInitializer
      ? ` = ${this.nodeToString(node.value)}`
      : '';
    const code = `${node.varType} ${node.name}${dims}${init}`;
    const type = this.isFileStreamType(node.varType)
      ? 'document'
      : this.isArrayDecl(node)
      ? 'database'
      : 'process';
    const label = type === 'document'
      ? 'File Stream'
      : type === 'database'
      ? 'Stored Data'
      : 'Declare';
    const step = this.createNode(type, label, code, node.line, node);
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
    if (node.expression?.type === 'FunctionCall') {
      return this.visitFunctionCall(node.expression, current);
    }
    const code = this.nodeToString(node.expression);
    const rootStream = this.getLeftmostIdentifier(node.expression);
    const isStreamOutput = this.containsOperator(node.expression, '<<');
    const isStreamInput = this.containsOperator(node.expression, '>>');
    const type = isStreamInput && rootStream === 'cin'
      ? 'input'
      : isStreamOutput && rootStream === 'cout'
      ? 'output'
      : isStreamOutput
      ? 'document'
      : 'process';
    const label = type === 'input'
      ? 'Input (cin)'
      : type === 'output'
      ? 'Output (cout)'
      : type === 'document'
      ? 'Document Output'
      : 'Expression';
    const step = this.createNode(type, label, code, node.line, node.expression);
    this.connect(current, step);
    return step;
  }

  // ── FIX 4: visitFunctionCall — draw a labeled recursive back-edge when
  //   the call target matches the function we are currently inside.
  private visitFunctionCall(node: any, current: ControlFlowNode): ControlFlowNode {
    const functionName = String(node?.name ?? '');
    const callType = this.definedFunctions.has(String(node?.name ?? ''))
      ? 'predefined'
      : this.isDelayCall(node)
      ? 'delay'
      : 'predefined';
    const label = callType === 'delay' ? 'Delay / Wait' : `Call: ${node.name}`;
    const step = this.createNode(callType, label, this.functionCallToString(node), node.line, node);
    this.connect(current, step);

    // If this call targets the current function, add a "Recursive" back-edge
    // to its entry node so the graph visually shows the self-loop.
    if (functionName === this.currentFunctionName && this.currentFunctionEntry) {
      this.connect(step, this.currentFunctionEntry, 'Recursive');
      return step;
    }

    return step;
  }

  // ── I/O ───────────────────────────────────────────────────────────────────
  private visitCoutStatement(node: any, current: ControlFlowNode): ControlFlowNode {
    // Grammar emits `values` as a left-associative BinaryOp tree (via CoutChain reduce),
    // so nodeToString handles it correctly as "a << b << c".
    const chain = this.nodeToString(node.values ?? node.value);
    const code = chain ? `cout << ${chain}` : 'cout << ""';
    const step = this.createNode('output', 'Output (cout)', code, node.line, node);
    this.connect(current, step);
    return step;
  }

  private visitCinStatement(node: any, current: ControlFlowNode): ControlFlowNode {
    // Grammar emits `targets` as a left-associative BinaryOp tree (via CinChain reduce).
    const chain = this.nodeToString(node.targets ?? node.target);
    const code = chain ? `cin >> ${chain}` : 'cin >> variable';
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
    // Save outer function context before overwriting (supports nested functions)
    const prevEntry = this.currentFunctionEntry;
    const prevName  = this.currentFunctionName;
    const prevExit  = this.currentFunctionExit;

    // Point to this function's entry/exit so visitFunctionCall and
    // visitReturnStatement can find them through any nesting depth.
    this.currentFunctionEntry = current;
    this.currentFunctionName  = node.name;
    this.currentFunctionExit  = exit;

    let lastNode = current;
    let bodyTerminated = false;
    if (Array.isArray(node.body)) {
      for (const stmt of node.body) {
        lastNode = this.visit(stmt, lastNode, exit);
        if (this.isTerminator(stmt)) { bodyTerminated = true; break; }
      }
    }

    // Restore the outer function context (important for nested declarations)
    this.currentFunctionEntry = prevEntry;
    this.currentFunctionName  = prevName;
    this.currentFunctionExit  = prevExit;

    return bodyTerminated ? exit : lastNode;
  }

  private visitFunctionPrototype(node: any, current: ControlFlowNode): ControlFlowNode {
    const protoNode = this.createNode(
      'predefined', `Prototype: ${node.name}`,
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
    const returnValue = this.nodeToString((node as any).value);
    const returnCode = returnValue ? `return ${returnValue}` : 'return';
    const ret = this.createNode('process', 'Return', returnCode, (node as any).line, node);
    this.connect(current, ret);
    // PDF #3: route to the FUNCTION exit, not whatever local merge node the
    // surrounding control-flow construct passed as `exit`. A return jumps to
    // the function end, full stop — it must not appear to fall through into
    // a sibling if-merge / loop-exit, etc. Fall back to `exit` only when
    // we somehow find ourselves outside any function (defensive).
    const target = this.currentFunctionExit ?? exit;
    this.connect(ret, target);
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
    const step = this.createNode('connector', label, node.value, node.line);
    this.connect(current, step);
    // For break, connect to exit so the graph reflects the jump
    if (node.value === 'break') {
      this.connect(step, this.currentBreakTarget ?? exit, 'break');
    } else if (node.value === 'continue' && this.currentContinueTarget) {
      this.connect(step, this.currentContinueTarget, 'continue');
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
    const afterLoop = this.createNode('process', 'Exit Range-For');
    this.connect(loopNode, afterLoop, 'Done');

    let bodyNode = loopNode;
    let bodyTerminated = false;
    for (const stmt of (node.body || []) as ASTNode[]) {
      bodyNode = this.visit(stmt, bodyNode, afterLoop);
      if (this.isTerminator(stmt)) { bodyTerminated = true; break; }
    }
    if (!bodyTerminated) this.connect(bodyNode, loopNode, 'Next');

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

    const merge = this.createNode('junction', 'After Try-Catch');
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

  // ── Goto / Label ─────────────────────────────────────────────────────────
  private visitGotoStatement(node: any, current: ControlFlowNode): ControlFlowNode {
    const step = this.createNode('connector', `goto ${node.label}`, `goto ${node.label}`, node.line, node);
    this.connect(current, step);
    return step;
  }

  private visitLabelStatement(node: any, current: ControlFlowNode, exit: ControlFlowNode): ControlFlowNode {
    const step = this.createNode('process', `Label: ${node.label}`, `${node.label}:`, node.line, node);
    this.connect(current, step);
    return node.statement ? this.visit(node.statement, step, exit) : step;
  }

  // ── CP2: Dynamic Memory ───────────────────────────────────────────────────
  private visitNewExpression(node: any, current: ControlFlowNode): ControlFlowNode {
    const label = node.size
      ? `Alloc: new ${node.baseType}[...]`
      : `Alloc: new ${node.baseType}`;
    const step = this.createNode('database', label, label, node.line, node);
    this.connect(current, step);
    return step;
  }

  private visitDeleteStatement(node: any, current: ControlFlowNode): ControlFlowNode {
    const label = node.isArray ? `Free: delete[] ${node.target}` : `Free: delete ${node.target}`;
    const step = this.createNode('database', label, label, node.line, node);
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
      case 'FunctionCall':  return this.functionCallToString(node);
      case 'CastExpression': return `(${node.targetType})${this.nodeToString(node.operand)}`;
      case 'SizeofExpression': return `sizeof(${this.nodeToString(node.value)})`;
      case 'ConditionalExpression':
        return `${this.nodeToString(node.condition)} ? ... : ...`;
      case 'NewExpression':
        return node.size
          ? `new ${node.baseType}[${this.nodeToString(node.size)}]`
          : `new ${node.baseType}`;
      case 'VariableDecl': {
        const dims = Array.isArray(node.dimensions) && node.dimensions.length
          ? node.dimensions.map((d: any) => `[${this.nodeToString(d)}]`).join('')
          : '';
        const hasInitializer = node.value !== undefined && node.value !== null;
        const init = hasInitializer && node.initStyle === 'constructor'
          ? `(${this.nodeToString(node.value)})`
          : hasInitializer
          ? ` = ${this.nodeToString(node.value)}`
          : '';
        return `${node.varType} ${node.name}${dims}${init}`;
      }
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

  private containsOperator(node: any, operator: string): boolean {
    if (!node || typeof node !== 'object') return false;
    if (node.type === 'BinaryOp' && node.operator === operator) return true;
    return this.containsOperator(node.left, operator) || this.containsOperator(node.right, operator);
  }

  private getLeftmostIdentifier(node: any): string | null {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'Identifier') return node.name ?? null;
    if (typeof node.name === 'string' && node.type !== 'FunctionCall') return node.name;
    if (node.left) return this.getLeftmostIdentifier(node.left);
    return null;
  }
}
