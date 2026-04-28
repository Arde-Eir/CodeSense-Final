/**
 * Bulletproof Symbolic Execution Engine for CodeSense
 */

import {
  ASTNode,
  SafetyCheck,
  BinaryOpNode,
  VariableDeclNode,
  AssignmentNode,
  FunctionDeclNode,
  WhileLoopNode,
  IfStatementNode,
  ReturnStatementNode,
  ArrayAccessNode,
  SwitchStatementNode,
  UnaryOpNode,
  DoWhileLoopNode,
  InitializerListNode,
  GlobalAccessNode,
  LoopControlNode,
  SymbolTable,
  ConditionalExpressionNode,
  CastExpressionNode,
  SizeofExpressionNode,
  LambdaExpressionNode,
  ParameterNode,
  ForLoopNode,
  FunctionCallNode,
} from '../types';

export type SymbolicValue =
| { type: 'concrete'; value: number; arraySize?: number; arraySizes?: number[] }
| { type: 'symbolic'; name: string; constraints: Constraint[]; arraySize?: number; arraySizes?: number[] }
| { type: 'unknown'; arraySize?: number; arraySizes?: number[] }
| { type: 'pointer'; target?: string; offset: number; isNull?: boolean; isFreed?: boolean; arraySize?: number; arraySizes?: number[] }
| { type: 'nullptr'; arraySize?: number; arraySizes?: number[] }

interface Constraint {
  variable: string;
  operator: string;
  value: number | string;
}

interface SymbolicState {
  variables: Map<string, SymbolicValue>;
  pathConditions: Constraint[];
  initialized: Set<string>;
  allocatedPointers: Map<string, { line: number; freed: boolean; size?: number; varName: string }>;
  freedPointers: Set<string>;
}

export class SymbolicExecutor {
  private safetyChecks: SafetyCheck[] = [];
  private state!: SymbolicState;
  private symbolTable: SymbolTable;

  private currentFunction: string = '';

  private readonly INT_MAX = 2147483647;
  private readonly INT_MIN = -2147483648;

  private emittedKeys: Set<string> = new Set();

  // Rich value trace for the Math tab
  public valueTrace: Array<{ expression: string; value: string | number; line?: number }> = [];

  constructor(symbolTable: SymbolTable) {
    this.symbolTable = symbolTable;
    this.resetState();
  }

  private resetState(): void {
    this.state = {
      variables: new Map(),
      pathConditions: [],
      initialized: new Set(),
      allocatedPointers: new Map(),
      freedPointers: new Set(),
    };
  }

  // ==========================================================================
  // CORE EXECUTION
  // ==========================================================================

  public execute(ast: ASTNode): SafetyCheck[] {
    this.safetyChecks = [];
    this.emittedKeys.clear();
    this.valueTrace = [];
    this.resetState();

    try {
      this.initializeStandardLibrary();
      this.initializeGlobals();
      this.visit(ast);
      this.checkForMemoryLeaks();
    } catch (error: any) {
      this.addSafetyCheck(0, 'executor', 'WARNING', `Analysis halted: ${error.message}`);
    }

    return this.safetyChecks;
  }

  private initializeStandardLibrary(): void {
    ['cout', 'cin', 'cerr', 'endl', 'string'].forEach(symbol => {
      this.state.initialized.add(symbol);
      this.state.variables.set(symbol, { type: 'symbolic', name: symbol, constraints: [] });
    });
  }

  private initializeGlobals(): void {
    Object.entries(this.symbolTable).forEach(([_, symbol]) => {
      if (symbol.scope === 'global') {
        if (symbol.initialized) this.state.initialized.add(symbol.name);
        if (symbol.dimensions?.length) {
          this.state.variables.set(symbol.name, {
            type: 'concrete', value: 0, arraySize: symbol.dimensions[0],
          });
        }
      } else {
        // Pre-seed local arrays too so bounds checks work even before decl is visited
        if (symbol.dimensions?.length) {
          this.state.variables.set(symbol.name, {
  type: 'concrete', value: 0,
  arraySize: symbol.dimensions[0],
  arraySizes: symbol.dimensions,   // store ALL dims
});
        }
      }
    });
  }

  // ==========================================================================
  // VISITOR DISPATCH
  // ==========================================================================

  private visit(node: ASTNode | null | string | undefined): SymbolicValue {
    if (!node) return { type: 'unknown' as const };

    // Grammar's Identifier rule returns a raw string (not an object).
    // Treat any bare string as an identifier lookup against state.variables.
    if (typeof node === 'string') {
      const val = this.state.variables.get(node);
      return val ?? { type: 'unknown' as const };
    }

    if ((node as any).type === 'Identifier') {
      return this.visitIdentifier(node);
    }

    const methodName = `visit${(node as any).type}`;
    if (typeof (this as any)[methodName] === 'function') {
      return (this as any)[methodName](node);
    }

    // Generic fallback for containers
    const anyNode = node as any;
    if (anyNode.body && Array.isArray(anyNode.body)) {
      anyNode.body.forEach((child: ASTNode) => this.visit(child));
    } else if (anyNode.statements && Array.isArray(anyNode.statements)) {
      anyNode.statements.forEach((child: ASTNode) => this.visit(child));
    }

    return { type: 'unknown' as const };
  }

  // ==========================================================================
  // LITERAL VISITORS
  // ==========================================================================

  private visitInteger(node: any): SymbolicValue {
    return { type: 'concrete', value: Number(node.value) };
  }

  private visitFloat(node: any): SymbolicValue {
    return { type: 'concrete', value: Number(node.value) };
  }

  private visitLiteral(node: any): SymbolicValue {
    if (node.value === true)  return { type: 'concrete', value: 1 };
    if (node.value === false) return { type: 'concrete', value: 0 };
    return { type: 'concrete', value: Number(node.value) };
  }

  private visitBooleanLiteral(node: any): SymbolicValue {
    return { type: 'concrete', value: node.value === true ? 1 : 0 };
  }

  private visitChar(node: any): SymbolicValue {
    if (typeof node.value === 'string' && node.value.length === 1) {
      return { type: 'concrete', value: node.value.charCodeAt(0) };
    }
    return { type: 'symbolic', name: node.value, constraints: [] };
  }

  private visitString(node: any): SymbolicValue {
    return { type: 'symbolic', name: String(node.value), constraints: [] };
  }

  // ==========================================================================
  // FIX 11: visitProgram — iterate directives + body explicitly
  // ==========================================================================
  private visitProgram(node: any): SymbolicValue {
    (node.directives || []).forEach((d: ASTNode) => this.visit(d));
    (node.body || []).forEach((stmt: ASTNode) => this.visit(stmt));
    return { type: 'unknown' as const };
  }

  // ==========================================================================
  // VISITOR IMPLEMENTATIONS
  // ==========================================================================

  private visitFunctionDecl(node: FunctionDeclNode): SymbolicValue {
    const prevFunc = this.currentFunction;
    this.currentFunction = node.name;

    const entryState = this.cloneState();

    node.params.forEach((param: ParameterNode) => {
      if (!param.name) return;
      const isPtr = param.varType.includes('*');
      this.state.variables.set(param.name, isPtr
        ? { type: 'pointer', offset: 0, isNull: false }
        : { type: 'symbolic', name: param.name, constraints: [] });
      this.state.initialized.add(param.name);
    });

    node.body?.forEach(stmt => this.visit(stmt));

    // Check for local memory leaks before exiting function scope
    this.state.allocatedPointers.forEach((info, ptr) => {
      if (!info.freed && !entryState.allocatedPointers.has(ptr)) {
        this.addSafetyCheck(
          info.line, info.varName, 'WARNING',
          `Memory leak in '${node.name}': '${info.varName}' allocated with 'new' but never freed with 'delete'.`,
        );
      }
    });

    this.currentFunction = prevFunc;
    return { type: 'unknown' as const };
  }

  private visitFunctionPrototype(_node: any): SymbolicValue {
    return { type: 'unknown' as const };
  }

 private visitVariableDecl(node: VariableDeclNode): SymbolicValue {
  let size: number | undefined;

  // 1. Handle array dimensions
  if (node.dimensions && node.dimensions.length > 0) {
    const dimResult = this.visit(node.dimensions[0]);
    if (dimResult.type === 'concrete') size = dimResult.value;
  }

  // 2. Resolve the initializer value
  let val: SymbolicValue = node.value
    ? this.visit(node.value)
    : { type: 'unknown' as const };

  // 3. FIX: Handle Reference Aliasing (&)
  // If the type is a reference (e.g., int&), it must point to the target variable's identity.
  const isReference = node.varType.includes('&');
  if (isReference && node.value) {
    const targetName = typeof node.value === 'string' 
      ? node.value 
      : (node.value as any).name;
      
    if (targetName) {
      // Treat the reference as a pointer to the target variable's name
      val = { type: 'pointer', target: targetName, offset: 0 };
    }
  }

  // 4. Standard pointer initialization (nullptr logic)
  if (!node.value && node.varType && node.varType.includes('*')) {
    val = { type: 'pointer', offset: 0, isNull: true };
  }

  // 5. Finalize value and array sizes
  const allDims: number[] = [];
  if (node.dimensions) {
    node.dimensions.forEach((d: any) => {
      const v = d?.value;
      if (typeof v === 'number') allDims.push(v);
    });
  }

  const finalVal: SymbolicValue = allDims.length > 0
    ? { ...val, arraySize: allDims[0], arraySizes: allDims }
    : val;

  // 6. Update state
  this.state.variables.set(node.name, finalVal);
  
  // References are always considered initialized at declaration in C++
  if (isReference || node.value) {
    this.state.initialized.add(node.name);
  }

  // 7. Emit to rich Math tab trace
  if (node.value) {
    const tracedLabel = isReference ? `(reference to ${this.expressionToString(node.value)})` : '';
    const tracedVal = finalVal.type === 'concrete'
      ? (finalVal as any).value
      : `${node.varType} ${tracedLabel}`;

    this.valueTrace.push({
      expression: `${node.varType} ${node.name} = ${this.expressionToString(node.value)}`,
      value: tracedVal,
      line: (node as any).line,
    });

    // Handle dynamic memory allocation tracking
    if ((node.value as any)?.type === 'NewExpression') {
      this.state.allocatedPointers.set(node.name, {
        line: (node as any).line || 0,
        freed: false,
        size,
        varName: node.name,
      });
    }
  }

  return finalVal;
}

  private visitAssignment(node: AssignmentNode): SymbolicValue {
    const value = this.visit(node.value);

    if (typeof node.target === 'string') {
      if (node.operator !== '=') {
        const current = this.state.variables.get(node.target);
        if (current?.type === 'concrete' && value.type === 'concrete') {
          const computed = this.applyCompoundOp(node.operator, current.value, value.value);
          this.state.variables.set(node.target, computed);
          this.state.initialized.add(node.target);
          return computed;
        }
      }
      this.state.variables.set(node.target, value);
      this.state.initialized.add(node.target);

      // Emit concrete assignment to Math tab trace
      if (value.type === 'concrete') {
        this.valueTrace.push({
          expression: `${node.target} ${node.operator} ${this.expressionToString(node.value)}`,
          value: (value as any).value,
          line: (node as any).line,
        });
      }

      // FIX 12: track new-assigned via assignment (e.g. ptr = new int[n])
      if ((node.value as any)?.type === 'NewExpression') {
        this.state.allocatedPointers.set(node.target, {
          line: (node as any).line || 0,
          freed: false,
          varName: node.target,
        });
      }
    } else if ((node.target as ASTNode).type === 'ArrayAccess') {
      this.visit(node.target as ASTNode); // triggers bounds check on LHS
    }

    return value;
  }

  private applyCompoundOp(op: string, lv: number, rv: number): SymbolicValue {
    switch (op) {
      case '+=': return { type: 'concrete', value: lv + rv };
      case '-=': return { type: 'concrete', value: lv - rv };
      case '*=': return { type: 'concrete', value: lv * rv };
      case '/=': return rv !== 0 ? { type: 'concrete', value: Math.trunc(lv / rv) } : { type: 'unknown' };
      case '%=': return rv !== 0 ? { type: 'concrete', value: lv % rv } : { type: 'unknown' };
      default:   return { type: 'unknown' };
    }
  }

  private visitIfStatement(node: IfStatementNode): SymbolicValue {
    const condAny = node.condition as any;
    if (condAny?.type === 'Assignment' && condAny.operator === '=') {
      this.addSafetyCheck(
        (condAny as any).line || (node as any).line || 0,
        'condition',
        'WARNING',
        `Suspicious assignment in condition: use '==' for comparison instead of '='.`,
      );
    }

    this.visit(node.condition);
    const preBranchState = this.cloneState();

    this.applyPathConstraint(node.condition, false);
    node.thenBranch.forEach(s => this.visit(s));
    const thenState = this.cloneState();

    this.state = preBranchState;
    this.applyPathConstraint(node.condition, true);
    node.elseBranch?.forEach(s => this.visit(s));
    const elseState = this.cloneState();

    this.state = this.mergeStates(thenState, elseState);
    return { type: 'unknown' as const };
  }

  private visitWhileLoop(node: WhileLoopNode): SymbolicValue {
    this.detectInfiniteLoop(node);

    // FIX #6: ALWAYS_FALSE — evaluate the condition with the current concrete
    // variable state. If it resolves to a concrete false at entry, the body
    // will never execute, which is almost certainly a bug.
    const condValue = this.evalConcreteCondition(node.condition);
    if (condValue === false) {
      this.addSafetyCheck(
        (node as any).line || 0, 'loop', 'WARNING',
        `Unreachable loop body: the condition '${this.expressionToString(node.condition)}' ` +
        `is false on entry — the while loop will never execute. ` +
        `Check your variable values or the comparison operator.`,
      );
    }

    const condVars = this.extractVariables(node.condition);
    condVars.forEach(v => this.checkLoopBodyForZeroRisk(node.body, v));

    const preState = this.cloneState();
    node.body.forEach(s => this.visit(s));
    this.state = this.mergeStates(preState, this.cloneState());

    return { type: 'unknown' as const };
  }

  /**
   * FIX #6 helper: evaluate a condition AST using the current concrete state.
   * Returns true/false when the outcome is provably concrete, or null when
   * the condition depends on unknown/symbolic values and we can't decide.
   */
  private evalConcreteCondition(cond: any): boolean | null {
    if (!cond) return null;
    // Literal booleans
    if (cond.type === 'Boolean' || cond.type === 'Literal') return !!cond.value;
    if (cond.type === 'Integer' || cond.type === 'Float')   return cond.value !== 0;
    // Bare identifier — the parser emits identifiers as plain strings inside
    // BinaryOp / etc., so check that case before the structural Identifier.
    if (typeof cond === 'string') {
      const v = this.state.variables.get(cond);
      if (v?.type === 'concrete') return !!v.value;
      return null;
    }
    if (cond.type === 'Identifier') {
      const v = this.state.variables.get(cond.name);
      if (v?.type === 'concrete') return !!v.value;
      return null;
    }
    // Binary comparison
    if (cond.type === 'BinaryOp' && ['<','>','<=','>=','==','!='].includes(cond.operator)) {
      const l = this.resolveConcrete(cond.left);
      const r = this.resolveConcrete(cond.right);
      if (l === null || r === null) return null;
      switch (cond.operator) {
        case '<':  return l <  r;
        case '>':  return l >  r;
        case '<=': return l <= r;
        case '>=': return l >= r;
        case '==': return l === r;
        case '!=': return l !== r;
      }
    }
    return null;
  }

  private resolveConcrete(node: any): number | null {
    if (node == null) return null;
    // Bare-string identifier (parser emits identifiers as raw strings inside
    // BinaryOp.left / right). Without this branch, `while (x < 5)` couldn't
    // see x's concrete value and the always-false check never fired.
    if (typeof node === 'string') {
      const v = this.state.variables.get(node);
      if (v?.type === 'concrete' && typeof v.value === 'number') return v.value;
      return null;
    }
    if (node.type === 'Integer' || node.type === 'Float') return node.value;
    if (node.type === 'Boolean' || node.type === 'Literal') {
      return node.value ? 1 : 0;
    }
    if (node.type === 'Identifier') {
      const v = this.state.variables.get(node.name);
      if (v?.type === 'concrete' && typeof v.value === 'number') return v.value;
    }
    return null;
  }

  private visitDoWhileLoop(node: DoWhileLoopNode): SymbolicValue {
    const preState = this.cloneState();
    node.body.forEach(s => this.visit(s));
    this.state = this.mergeStates(preState, this.cloneState());

    const condVars = this.extractVariables(node.condition);
    const modified = this.extractModifiedVariables(node.body);
    if (condVars.size > 0 && ![...condVars].some(v => modified.has(v))) {
      this.addSafetyCheck(
        (node as any).line || 0, 'loop', 'WARNING',
        'Infinite loop: do-while condition variables never change in the body.',
      );
    }

    this.visit(node.condition);
    return { type: 'unknown' as const };
  }

  private visitForLoop(node: ForLoopNode): SymbolicValue {
    if (node.init) this.visit(node.init as ASTNode);

    if (node.condition) {
      const condVars = this.extractVariables(node.condition);
      const bodyModified = this.extractModifiedVariables(node.body);
      const updateModified = node.update
        ? this.extractModifiedVariables([node.update as ASTNode])
        : new Set<string>();
      const allModified = new Set([...bodyModified, ...updateModified]);

      if (condVars.size > 0 && ![...condVars].some(v => allModified.has(v))) {
        this.addSafetyCheck(
          (node as any).line || 0, 'loop', 'WARNING',
          'Potential infinite loop: for-loop condition variable(s) are never modified.',
        );
      }
    }

    const preState = this.cloneState();
    if (node.condition) this.visit(node.condition);
    node.body.forEach(s => this.visit(s));
    if (node.update) this.visit(node.update as ASTNode);
    this.state = this.mergeStates(preState, this.cloneState());

    return { type: 'unknown' as const };
  }

  private visitSwitchStatement(node: SwitchStatementNode): SymbolicValue {
    this.visit(node.condition);
    const preState = this.cloneState();
    const caseStates: SymbolicState[] = [];

    node.cases.forEach((c: any) => {
      this.state = this.cloneState();
      this.visit(c as unknown as ASTNode);
      caseStates.push(this.cloneState());
    });

    if (caseStates.length > 0) {
      this.state = caseStates.reduce((a, b) => this.mergeStates(a, b));
    } else {
      this.state = preState;
    }
    return { type: 'unknown' as const };
  }

  private visitCase(node: any): SymbolicValue {
    if (node.value) this.visit(node.value);
    (node.statements || []).forEach((s: ASTNode) => this.visit(s));
    return { type: 'unknown' as const };
  }

  private visitDefaultCase(node: any): SymbolicValue {
    return this.visitCase(node);
  }

  private visitBinaryOp(node: BinaryOpNode): SymbolicValue {

    if (node.operator === '<<' || node.operator === '>>') {
        this.visit(node.left);
        this.visit(node.right);
        return { type: 'unknown' as const };
    }
    const leftRaw  = this.visit(node.left);
    const rightRaw = this.visit(node.right);

    // Resolve unknown values — handles both {type:'Identifier',name} objects AND raw strings
    const resolveUnknown = (raw: SymbolicValue, operand: any): SymbolicValue => {
      if (raw.type !== 'unknown') return raw;
      const name = typeof operand === 'string' ? operand : operand?.name;
      if (name) return this.state.variables.get(name) ?? raw;
      return raw;
    };

    const left  = resolveUnknown(leftRaw,  node.left);
    const right = resolveUnknown(rightRaw, node.right);

    // FIX #5: UNINITIALIZED_READ — if a binary op uses a variable that has
    // been declared but never assigned a value, emit a loud safety warning.
    // Garbage memory reads are a classic C++ bug that the user must see.
    const checkUninit = (operand: any, resolved: SymbolicValue) => {
      if (resolved.type !== 'unknown') return;
      const name = typeof operand === 'string' ? operand : operand?.name;
      if (!name) return;
      // The symbol exists but has never been added to initialized set.
      if (this.state.variables.has(name) && !this.state.initialized.has(name)) {
        this.addSafetyCheck(
          (node as any).line || 0, 'uninitialized', 'WARNING',
          `Uninitialized read: variable '${name}' is used before being assigned a value — ` +
          `this reads whatever garbage happens to be in memory. Initialize it at declaration (e.g. int ${name} = 0;).`,
        );
      }
    };
    checkUninit(node.left,  leftRaw);
    checkUninit(node.right, rightRaw);

    if (node.operator === '/' || node.operator === '%') {
      // FIX #7: use operator-specific phrasing so Modulo-by-zero is reported
      // as "Modulo by zero" (not the generic "Division by zero").
      const opName = node.operator === '%' ? 'Modulo by zero' : 'Division by zero';
      const opType = node.operator === '%' ? 'modulo'        : 'arithmetic';
      // Concrete zero check
      if (right?.type === 'concrete' && right.value === 0) {
        this.addSafetyCheck(
          (node as any).line || 0, opType, 'UNSAFE',
          `${opName}: '${this.expressionToString(node.right)}' evaluates to 0`,
        );
      }
      // Variable resolving to zero check — e.g. int b = 0; a / b;
      else if (right?.type !== 'concrete') {
        const rightName = typeof node.right === 'string' ? node.right : (node.right as any)?.name;
        if (rightName) {
          const resolvedRight = this.state.variables.get(rightName);
          if (resolvedRight?.type === 'concrete' && resolvedRight.value === 0) {
            this.addSafetyCheck(
              (node as any).line || 0, opType, 'UNSAFE',
              `${opName}: variable '${rightName}' is 0`,
            );
          }
          // Runtime-input/symbolic values can still become zero.
          if (resolvedRight?.type === 'symbolic' || resolvedRight?.type === 'unknown') {
            this.addSafetyCheck(
              (node as any).line || 0, opType, 'WARNING',
              `Possible ${opName.toLowerCase()}: variable '${rightName}' is not concretely known and may become 0 at runtime.`,
            );
          }
        }
      }
    }

    if (left.type === 'concrete' && right.type === 'concrete') {
      const res = this.evaluateConcrete(node.operator, left.value, right.value);
      if (res.type === 'concrete' && ['+', '-', '*'].includes(node.operator)) {
        if (res.value > this.INT_MAX || res.value < this.INT_MIN) {
          this.addSafetyCheck(
            (node as any).line || 0, 'overflow', 'WARNING',
            `Integer overflow: result ${res.value} exceeds 32-bit integer range.`,
          );
        }
      }
      return res;
    }

    const arraySize = (left as any).arraySize ?? (right as any).arraySize;
    if (arraySize !== undefined) {
      return { type: 'unknown', arraySize } as SymbolicValue;
    }

    return { type: 'unknown' as const };
  }

  // FIX 13: visitAddressOf / visitDereference properly delegated
  private visitAddressOf(node: UnaryOpNode): SymbolicValue {
    const name = typeof node.operand === 'string' ? node.operand : (node.operand as any)?.name;
    const val = name ? this.state.variables.get(name) : undefined;
    return val ? { type: 'pointer', offset: 0, isNull: false, target: name } : { type: 'unknown' };
  }

  private visitDereference(node: UnaryOpNode): SymbolicValue {
    return this.visitUnaryOp(node);
  }

  private visitUnaryOp(node: UnaryOpNode): SymbolicValue {
    const operandNode = node.operand as any;
    const name = typeof node.operand === 'string' ? node.operand : operandNode?.name;
    const val = name ? this.state.variables.get(name) : undefined;

    // FIX: arithmetic unary minus — resolve operand concretely first
    if ((node as any).operator === '-') {
      // Try to get concrete value from operand node directly
      const operandVal = this.visit(operandNode);
      if (operandVal.type === 'concrete') {
        return { type: 'concrete', value: -operandVal.value };
      }
      // Fallback: variable lookup
      if (val?.type === 'concrete') {
        return { type: 'concrete', value: -val.value };
      }
      return { type: 'unknown' };
    }

    // Logical NOT — propagate concrete bool
    if ((node as any).operator === '!') {
      const operandVal = this.visit(operandNode);
      if (operandVal.type === 'concrete') {
        return { type: 'concrete', value: operandVal.value === 0 ? 1 : 0 };
      }
      return { type: 'unknown' };
    }

    if (node.type === 'Dereference') {
      if (!val || (val.type === 'pointer' && val.isNull)) {
        this.addSafetyCheck(
          (node as any).line || 0, 'deref', 'UNSAFE',
          `Null pointer dereference: '${name}'`,
        );
      }
      if (name && this.state.freedPointers.has(name)) {
        this.addSafetyCheck(
          (node as any).line || 0, 'deref', 'UNSAFE',
          `Use-after-free: '${name}' was already deleted`,
        );
      }
    }
    return val ?? { type: 'unknown' as const };
  }

  // FIX 16: inc/dec marks variable as symbolically changed even when unknown
  private visitPreIncrement(node: any):  SymbolicValue { return this.applyIncDec(node,  1, true);  }
  private visitPostIncrement(node: any): SymbolicValue { return this.applyIncDec(node,  1, false); }
  private visitPreDecrement(node: any):  SymbolicValue { return this.applyIncDec(node, -1, true);  }
  private visitPostDecrement(node: any): SymbolicValue { return this.applyIncDec(node, -1, false); }

  private applyIncDec(node: any, delta: number, pre: boolean): SymbolicValue {
    const name    = typeof node.operand === 'string' ? node.operand : node.operand?.name;
    const current = name ? this.state.variables.get(name) : undefined;
    const oldVal  = current ?? { type: 'unknown' as const };

    if (name && current?.type === 'concrete') {
      const newVal: SymbolicValue = { type: 'concrete', value: current.value + delta };
      this.state.variables.set(name, newVal);
      return pre ? newVal : oldVal;
    }
    if (name) {
      // Mark variable as symbolically changed even when not concrete
      this.state.variables.set(name, { type: 'symbolic', name, constraints: [] });
    }
    return { type: 'unknown' as const };
  }

  private visitArrayAccess(node: ArrayAccessNode): SymbolicValue {
    const arr = this.state.variables.get(node.name);

    if (arr && arr.type === 'pointer') {
    if (arr.isNull) {
      this.addSafetyCheck(
        (node as any).line || 0, 'bounds', 'UNSAFE',
        `Null pointer '${node.name}' used as array — will cause segfault`
      );
      return { type: 'unknown' as const };
    }
    if (arr.isFreed) {
      this.addSafetyCheck(
        (node as any).line || 0, 'bounds', 'UNSAFE',
        `Use-after-free: '${node.name}' was deleted and then accessed`
      );
      return { type: 'unknown' as const };
    }
  }
  
    if (arr?.arraySize !== undefined) {
      node.indices.forEach((indexNode: ASTNode, dim: number) => {
        const idxRaw = this.visit(indexNode);
        // Resolve: handles raw string identifiers, {type:'Identifier'} objects, and unknown
        const resolvedIdx = (() => {
          if (idxRaw.type === 'concrete') return idxRaw;
          // Try name-based lookup from state
          const idxName = typeof indexNode === 'string'
            ? indexNode
            : (indexNode as any)?.name;
          if (idxName) {
            const stateVal = this.state.variables.get(idxName);
            if (stateVal?.type === 'concrete') return stateVal;
          }
          return idxRaw;
        })();

        if (resolvedIdx?.type === 'concrete') {
          const sizeForDim = arr.arraySizes
  ? arr.arraySizes[dim]
  : (dim === 0 ? arr.arraySize : undefined);
          if (sizeForDim !== undefined) {
            if (resolvedIdx.value < 0) {
              this.addSafetyCheck(
                (node as any).line || 0, 'bounds', 'UNSAFE',
                `Negative array index: index ${resolvedIdx.value} on '${node.name}' (must be >= 0)`,
              );
            } else if (resolvedIdx.value >= sizeForDim) {
              this.addSafetyCheck(
                (node as any).line || 0, 'bounds', 'UNSAFE',
                `Out of bounds: index ${resolvedIdx.value} on '${node.name}' of size ${sizeForDim} (valid: 0–${sizeForDim - 1})`,
              );
            }
          }
        }
      });
    }

    return { type: 'unknown' as const };
  }

  private visitReturnStatement(node: ReturnStatementNode): SymbolicValue {
    const val = node.value ? this.visit(node.value) : { type: 'unknown' as const };
    if (val.type === 'pointer' && 'target' in val && val.target) {
      const info = this.state.allocatedPointers.get(val.target);
      if (info) info.freed = true; // pointer escapes function — not a leak
    }
    return val;
  }

  // FIX 12: visitNewExpression — register in allocatedPointers
  private visitNewExpression(node: any): SymbolicValue {
    let size: number | undefined;
    if (node.size) {
      const sv = this.visit(node.size);
      if (sv.type === 'concrete') size = sv.value;
    }
    return { type: 'pointer', offset: 0, isNull: false, arraySize: size };
  }

  private visitDeleteStatement(node: any): SymbolicValue {
    const ptr = this.state.variables.get(node.target);

    if (ptr?.type === 'pointer') {
      if (ptr.isNull) {
        this.addSafetyCheck(
          node.line || 0, 'delete', 'WARNING',
          `Deleting a null pointer '${node.target}' — may indicate a logic error.`,
        );
      }
      if (this.state.freedPointers.has(node.target)) {
        this.addSafetyCheck(
          node.line || 0, 'delete', 'UNSAFE',
          `Double-free: '${node.target}' has already been deleted.`,
        );
      }
    } else if (!ptr) {
      this.addSafetyCheck(
        node.line || 0, 'delete', 'WARNING',
        `Deleting '${node.target}' which was not tracked as an allocated pointer.`,
      );
    }

    const info = this.state.allocatedPointers.get(node.target);
    if (info) info.freed = true;
    this.state.freedPointers.add(node.target);
    this.state.variables.set(node.target, { type: 'pointer', offset: 0, isNull: true, isFreed: true });

    return { type: 'unknown' as const };
  }

  private visitCastExpression(node: CastExpressionNode): SymbolicValue {
    return this.visit(node.operand);
  }

  private visitSizeofExpression(_node: SizeofExpressionNode): SymbolicValue {
    return { type: 'concrete', value: 4 };
  }

  private visitConditionalExpression(node: ConditionalExpressionNode): SymbolicValue {
    this.visit(node.condition);
    const t = this.visit(node.trueExpression);
    const f = this.visit(node.falseExpression);
    if (JSON.stringify(t) === JSON.stringify(f)) return t;
    return { type: 'unknown' as const };
  }

  private visitLambdaExpression(node: LambdaExpressionNode): SymbolicValue {
    node.body.forEach((s: ASTNode) => this.visit(s));
    return { type: 'symbolic', name: 'lambda', constraints: [] };
  }

  private visitInitializerList(node: InitializerListNode): SymbolicValue {
    (node.values || []).forEach(v => this.visit(v));
    return { type: 'unknown' as const };
  }

  private visitGlobalAccess(node: GlobalAccessNode): SymbolicValue {
    return this.state.variables.get(node.name) ?? { type: 'unknown' as const };
  }

  private visitFunctionCall(node: FunctionCallNode): SymbolicValue {
  if (node.name === this.currentFunction) {
    this.addSafetyCheck(
      (node as any).line || 0,
      'recursion',
      'WARNING',
      `Recursive call to '${node.name}' detected. Verify a base case exists to prevent a stack overflow.`,
    );
  }
  (node.arguments || []).forEach((arg: ASTNode) => this.visit(arg));
  return { type: 'unknown' as const };
}

  private visitMultipleVariableDecl(node: any): SymbolicValue {
    (node.declarations || []).forEach((decl: ASTNode) => this.visit(decl));
    return { type: 'unknown' as const };
  }

  private visitBlock(node: any): SymbolicValue {
    (node.statements || []).forEach((s: ASTNode) => this.visit(s));
    return { type: 'unknown' as const };
  }

  private visitExpressionStatement(node: any): SymbolicValue {
    return this.visit(node.expression);
  }

  private visitLoopControl(_node: LoopControlNode): SymbolicValue {
    return { type: 'unknown' as const };
  }

  // =========================================================================
  // Range-Based For
  // =========================================================================
  private visitRangeBasedFor(node: any): SymbolicValue {
    this.visit(node.range);
    // Treat the loop variable as symbolic (value comes from range)
    this.state.variables.set(node.name, { type: 'symbolic', name: node.name, constraints: [] });
    this.state.initialized.add(node.name);
    const preState = this.cloneState();
    (node.body || []).forEach((s: any) => this.visit(s));
    this.state = this.mergeStates(preState, this.cloneState());
    return { type: 'unknown' as const };
  }

  // =========================================================================
  // Exception Handling
  // =========================================================================
  private visitTryStatement(node: any): SymbolicValue {
    const preState = this.cloneState();
    (node.body || []).forEach((s: any) => this.visit(s));
    const tryState = this.cloneState();
    // Each catch handler starts from pre-try state (exception may skip body)
    (node.handlers || []).forEach((h: any) => {
      this.state = this.cloneState(preState);
      if (h.param?.name) {
        this.state.variables.set(h.param.name, { type: 'symbolic', name: h.param.name, constraints: [] });
        this.state.initialized.add(h.param.name);
      }
      (h.body || []).forEach((s: any) => this.visit(s));
    });
    this.state = this.mergeStates(tryState, this.cloneState());
    return { type: 'unknown' as const };
  }

  private visitThrowStatement(node: any): SymbolicValue {
    if (node.value) this.visit(node.value);
    return { type: 'unknown' as const };
  }

  // Grammar structure no-ops
  private visitCatchClause(_n: any): SymbolicValue { return { type: 'unknown' as const }; }
  private visitCatchParam(_n: any):  SymbolicValue { return { type: 'unknown' as const }; }
  private visitCatchAll(_n: any):    SymbolicValue { return { type: 'unknown' as const }; }


  // Preprocessor no-ops
  private visitInclude(_n: any):   SymbolicValue { return { type: 'unknown' as const }; }
  private visitDefine(_n: any):    SymbolicValue { return { type: 'unknown' as const }; }
  private visitNamespace(_n: any): SymbolicValue { return { type: 'unknown' as const }; }

  private visitCinStatement(node: any): SymbolicValue {
    // Flatten `cin >> a >> b` chains: the parser may emit a leaf, an array,
    // or a BinaryOp tree. Marking only the root would leave the inner
    // identifiers symbolic but uninitialized, masking real bugs and surfacing
    // false "uninitialized" warnings later.
    const flatten = (n: any): any[] => {
      if (n == null) return [];
      if (Array.isArray(n)) return n.flatMap(flatten);
      if (typeof n === 'string') return [n];
      if (n.type === 'BinaryOp' && (n.operator === '>>' || n.operator === '<<')) {
        return [...flatten(n.left), ...flatten(n.right)];
      }
      return [n];
    };
    const targets = node.targets
      ? flatten(node.targets)
      : (node.target ? [node.target] : []);
    targets.forEach(t => {
      const name = typeof t === 'string' ? t : t.name;
      if (name) {
        this.state.initialized.add(name);
        this.state.variables.set(name, { type: 'symbolic', name, constraints: [] });
      }
    });
    return { type: 'unknown' as const };
  }

  private visitCoutStatement(node: any): SymbolicValue {
    // node.values is now the root of the BinaryOp tree (e.g., cout << "hello")
    if (node.values) {
        this.visit(node.values);
    }
    return { type: 'unknown' as const };
}

  // ==========================================================================
  // FIX 15: visitIdentifier — check initialized set for uninitialized access
  // ==========================================================================
  private visitIdentifier(node: any): SymbolicValue {
    const val = this.state.variables.get(node.name);

    if (!val && !this.state.initialized.has(node.name)) {
      const stdSymbols = new Set([
        'cout', 'cin', 'endl', 'cerr', 'clog', 'string',
        'true', 'false', 'nullptr',
        'setw', 'setprecision', 'setfill', 'fixed', 'showpoint',
        'left', 'right', 'boolalpha', 'noboolalpha',
        'pow', 'sqrt', 'abs', 'fabs', 'ceil', 'floor', 'round',
        'stoi', 'stod', 'stof', 'stol', 'stoul', 'to_string',
        'ifstream', 'ofstream', 'fstream',
        'rand', 'srand', 'exit', 'system', 'getline',
        'INT_MAX', 'INT_MIN', 'LLONG_MAX', 'LLONG_MIN',
        'EOF', 'NULL',
      ]);
      if (!stdSymbols.has(node.name)) {
        this.addSafetyCheck(
          (node as any).line || 0,
          'uninitialized',
          'WARNING',
          `Variable '${node.name}' may be used before initialization`
        );
      }
    }

    return val ?? { type: 'unknown' as const };
  }

  // ==========================================================================
  // PATH CONSTRAINTS
  // ==========================================================================

  private applyPathConstraint(cond: ASTNode, negate: boolean): void {
    if (cond.type === 'BinaryOp') {
      const b = cond as BinaryOpNode;
      const varName = (b.left as any)?.name;
      if (varName) {
        let op = b.operator;
        const v = (b.right as any)?.value ?? (b.right as any)?.name;
        if (negate) {
          const opposites: Record<string, string> = {
            '==': '!=', '!=': '==', '>': '<=', '<': '>=', '>=': '<', '<=': '>',
          };
          op = opposites[op] || op;
        }
        this.state.pathConditions.push({ variable: varName, operator: op, value: v });
      }
    } else if (cond.type === 'Identifier') {
      const varName = (cond as any).name;
      this.state.pathConditions.push({
        variable: varName, operator: negate ? '==' : '!=', value: 0,
      });
    }
  }

  // ==========================================================================
  // STATE MERGING
  // ==========================================================================

  private mergeStates(s1: SymbolicState, s2: SymbolicState): SymbolicState {
    const merged = this.cloneState();
    const allKeys = new Set([...s1.variables.keys(), ...s2.variables.keys()]);

    allKeys.forEach(k => {
      const v1 = s1.variables.get(k);
      const v2 = s2.variables.get(k);
      if (JSON.stringify(v1) === JSON.stringify(v2)) {
        merged.variables.set(k, v1!);
      } else {
        merged.variables.set(k, {
          type: 'unknown',
          arraySize: v1?.arraySize ?? v2?.arraySize,
        } as SymbolicValue);
      }
    });

    s1.allocatedPointers.forEach((info, ptr) => {
      const info2 = s2.allocatedPointers.get(ptr);
      if (info2) {
        merged.allocatedPointers.set(ptr, { ...info, freed: info.freed && info2.freed });
      } else {
        merged.allocatedPointers.set(ptr, { ...info });
      }
    });
    s2.allocatedPointers.forEach((info, ptr) => {
      if (!merged.allocatedPointers.has(ptr)) {
        merged.allocatedPointers.set(ptr, { ...info });
      }
    });

    s1.freedPointers.forEach(p => merged.freedPointers.add(p));
    s2.freedPointers.forEach(p => merged.freedPointers.add(p));
    s1.initialized.forEach(n => merged.initialized.add(n));
    s2.initialized.forEach(n => merged.initialized.add(n));

    return merged;
  }

  // ==========================================================================
  // INFINITE LOOP DETECTION
  // ==========================================================================

  private detectInfiniteLoop(node: WhileLoopNode): void {
    const vars = this.extractVariables(node.condition);

    // Don't flag infinite loop if there's a break/return/exit that can terminate
    if (this.bodyHasExit(node.body)) return;

    // A variable is "effectively modified" only if it's changed via an expression
    // that could alter the loop condition (++/--, +=/-=, or assignment to a non-literal).
    // Assigning a constant (e.g. x = 5) inside the loop does NOT terminate it
    // if the constant still satisfies the condition.
    const effectivelyModified = this.extractEffectivelyModifiedVariables(node.body);

    // Fire if no condition variable is effectively modified toward termination
    if (vars.size === 0 || ![...vars].some(v => effectivelyModified.has(v))) {
      this.addSafetyCheck(
        (node as any).line || 0, 'loop', 'WARNING',
        `Infinite loop: condition variables [${[...vars].join(', ')}] never change in the while body`,
      );
    }
  }

  // Helper: check if any node in body has a break, return, or exit() call
  private bodyHasExit(body: ASTNode[]): boolean {
    const walk = (nodes: ASTNode[]): boolean => {
      for (const n of nodes) {
        const a = n as any;
        if (n.type === 'ReturnStatement') return true;
        if (n.type === 'ThrowStatement') return true;
        if (n.type === 'LoopControl') return true; // break or continue
        if (n.type === 'FunctionCall' && a.name === 'exit') return true;
        if (n.type === 'ExpressionStatement' && a.expression) {
          if (walk([a.expression])) return true;
        }
        if (n.type === 'IfStatement') {
          if (walk(a.thenBranch || [])) return true;
          if (walk(a.elseBranch || [])) return true;
        }
        if (['WhileLoop', 'DoWhileLoop', 'ForLoop', 'Block'].includes(n.type)) {
          if (walk(a.body || a.statements || [])) return true;
        }
      }
      return false;
    };
    return walk(body);
  }

  // Returns variables that are modified in a way that could change loop termination:
  // ++/--, +=/-=/*=/... or assignment to a non-literal expression.
  // Simple constant assignment (x = 5) is NOT considered effective modification.
  private extractEffectivelyModifiedVariables(body: ASTNode[]): Set<string> {
    const s = new Set<string>();
    const walk = (nodes: ASTNode[]) => {
      nodes.forEach(n => {
        const any = n as any;
        switch (n.type) {
          case 'Assignment': {
            const name = typeof any.target === 'string' ? any.target : any.target?.name;
            if (!name) break;
            // Only count as effective if RHS is not a pure literal constant
            const rhs = any.value as any;
            const isLiteral = rhs && (rhs.type === 'Integer' || rhs.type === 'Float' ||
                                      rhs.type === 'Literal' || rhs.type === 'Char');
            if (!isLiteral) s.add(name);
            // Compound assignment (+=, -=, etc.) always counts
            if (any.operator && any.operator !== '=') s.add(name);
            break;
          }
          case 'PreIncrement': case 'PostIncrement':
          case 'PreDecrement': case 'PostDecrement': {
            const name = typeof any.operand === 'string' ? any.operand : any.operand?.name;
            if (name) s.add(name);
            break;
          }
          case 'ExpressionStatement': {
            if (any.expression) walk([any.expression]);
            break;
          }
          case 'Block': {
            if (Array.isArray(any.statements)) walk(any.statements);
            break;
          }
          case 'IfStatement': {
            if (Array.isArray(any.thenBranch)) walk(any.thenBranch);
            if (Array.isArray(any.elseBranch)) walk(any.elseBranch);
            break;
          }
          case 'WhileLoop': case 'DoWhileLoop': case 'ForLoop': {
            if (Array.isArray(any.body)) walk(any.body);
            break;
          }
        }
      });
    };
    walk(body);
    return s;
  }

  private checkLoopBodyForZeroRisk(body: ASTNode[], varName: string): void {
    const walk = (n: any) => {
      if (n?.type === 'BinaryOp' && (n.operator === '/' || n.operator === '%')) {
        if (this.extractVariables(n.right).has(varName)) {
          this.addSafetyCheck(
            n.line || 0, 'arithmetic', 'UNSAFE',
            `Loop variable '${varName}' used as divisor — may reach 0.`,
          );
        }
      }
      if (Array.isArray(n))  n.forEach(walk);
      else if (n?.body)       walk(n.body);
      else if (n?.statements) walk(n.statements);
    };
    walk(body);
  }

  private extractModifiedVariables(body: ASTNode[]): Set<string> {
    const s = new Set<string>();
    const walk = (nodes: ASTNode[]) => {
      nodes.forEach(n => {
        const any = n as any;
        switch (n.type) {
          case 'Assignment': {
            if (typeof any.target === 'string') s.add(any.target);
            break;
          }
          case 'PreIncrement': case 'PostIncrement':
          case 'PreDecrement': case 'PostDecrement': {
            const name = typeof any.operand === 'string' ? any.operand : any.operand?.name;
            if (name) s.add(name);
            break;
          }
          case 'ExpressionStatement': {
            if (any.expression) walk([any.expression]);
            break;
          }
          case 'Block': {
            if (Array.isArray(any.statements)) walk(any.statements);
            break;
          }
          case 'IfStatement': {
            if (Array.isArray(any.thenBranch)) walk(any.thenBranch);
            if (Array.isArray(any.elseBranch)) walk(any.elseBranch);
            break;
          }
          case 'WhileLoop': case 'DoWhileLoop': case 'ForLoop': {
            if (Array.isArray(any.body)) walk(any.body);
            break;
          }
        }
      });
    };
    walk(body);
    return s;
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  private extractVariables(node: any): Set<string> {
    const s = new Set<string>();
    const walk = (n: any) => {
      if (!n) return;
      if (typeof n === 'string') { s.add(n); return; } // raw string identifier
      if (n.type === 'Identifier') s.add(n.name || n.value);
      if (n.left)      walk(n.left);
      if (n.right)     walk(n.right);
      if (n.operand)   walk(n.operand);
      if (n.condition) walk(n.condition);
      if (Array.isArray(n.arguments)) n.arguments.forEach(walk);
    };
    walk(node);
    return s;
  }

  private expressionToString(node: any): string {
    if (!node) return '';
    if (typeof node === 'string') return node;
    switch (node.type) {
      case 'BinaryOp':
        return `${this.expressionToString(node.left)} ${node.operator} ${this.expressionToString(node.right)}`;
      case 'Identifier':
        return node.name || node.value || '?';
      case 'Integer': case 'Float': case 'Literal':
        return String(node.value);
      case 'ArrayAccess': {
        const idxStr = node.indices.map((i: any) => `[${this.expressionToString(i)}]`).join('');
        return `${node.name}${idxStr}`;
      }
      case 'PostIncrement': return `${node.operand}++`;
      case 'PreIncrement':  return `++${node.operand}`;
      case 'PostDecrement': return `${node.operand}--`;
      case 'PreDecrement':  return `--${node.operand}`;
      default: return 'expr';
    }
  }

  private evaluateConcrete(op: string, l: number, r: number): SymbolicValue {
    switch (op) {
      case '+':  return { type: 'concrete', value: l + r };
      case '-':  return { type: 'concrete', value: l - r };
      case '*':  return { type: 'concrete', value: l * r };
      case '/':  return r !== 0 ? { type: 'concrete', value: Math.trunc(l / r) } : { type: 'unknown' };
      case '%':  return r !== 0 ? { type: 'concrete', value: l % r }             : { type: 'unknown' };
      case '&':  return { type: 'concrete', value: l & r };
      case '|':  return { type: 'concrete', value: l | r };
      case '^':  return { type: 'concrete', value: l ^ r };
      case '<<': return { type: 'concrete', value: l << r };
      case '>>': return { type: 'concrete', value: l >> r };
      case '==': return { type: 'concrete', value: l === r ? 1 : 0 };
      case '!=': return { type: 'concrete', value: l !== r ? 1 : 0 };
      case '<':  return { type: 'concrete', value: l <   r ? 1 : 0 };
      case '<=': return { type: 'concrete', value: l <=  r ? 1 : 0 };
      case '>':  return { type: 'concrete', value: l >   r ? 1 : 0 };
      case '>=': return { type: 'concrete', value: l >=  r ? 1 : 0 };
      default:   return { type: 'unknown' as const };
    }
  }

  private checkForMemoryLeaks(): void {
    this.state.allocatedPointers.forEach((info, _ptr) => {
      if (!info.freed) {
        this.addSafetyCheck(
          info.line, info.varName, 'WARNING',
          `Memory leak: '${info.varName}' was allocated with 'new' but never freed with 'delete'.`,
        );
      }
    });
  }

  private cloneState(source?: SymbolicState): SymbolicState {
    const s = source ?? this.state;
    const clonedPtrs: Map<string, { line: number; freed: boolean; size?: number; varName: string }> = new Map();
    s.allocatedPointers.forEach((v, k) => clonedPtrs.set(k, { ...v }));
    return {
      variables:         new Map(s.variables),
      pathConditions:    [...s.pathConditions],
      initialized:       new Set(s.initialized),
      allocatedPointers: clonedPtrs,
      freedPointers:     new Set(s.freedPointers),
    };
  }

  private addSafetyCheck(
    line: number,
    op: string,
    status: 'SAFE' | 'UNSAFE' | 'WARNING',
    message: string,
  ): void {
    const key = `${line}|${status}|${message}`;
    if (this.emittedKeys.has(key)) return;
    this.emittedKeys.add(key);
    this.safetyChecks.push({ line, operation: op, status, message });
  }
}