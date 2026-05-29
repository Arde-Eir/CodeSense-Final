/**
 * Advanced Type Checker (Semantic Analysis)
 * Validates type compatibility and semantic correctness of C++ code.
 * Phase 2 (Logic & Meaning) – Step 1 of the analysis pipeline.
 */

import {
  ASTNode,
  SymbolTable,
  SymbolInfo,
  AnalysisError,
  BinaryOpNode,
  VariableDeclNode,
  AssignmentNode,
  FunctionDeclNode,
  FunctionPrototypeNode,
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
  ForLoopNode,
  FunctionCallNode,
  BlockNode,
  ExpressionStatementNode,
  CaseNode,
  ConditionalExpressionNode,
  CastExpressionNode,
  LambdaExpressionNode,
  SizeofExpressionNode,
  ParameterNode,
} from '../types';

// ---------------------------------------------------------------------------
// Extended SymbolInfo with const flag and param count (added non-breakingly)
// ---------------------------------------------------------------------------
interface ExtendedSymbolInfo extends SymbolInfo {
  isConst?: boolean;
  paramCount?: number;
  minParamCount?: number; // params without default values (minimum required)
  paramTypes?: string[];  // declared type of each param, for call-site checking
  paramDimensions?: number[][];
}

export class TypeChecker {

  // =========================================================================
  // State
  // =========================================================================
  private symbolTable: SymbolTable = {};
  private errors: AnalysisError[] = [];
  private currentScope: string = 'global';
  private scopeStack: string[] = ['global'];
  private currentFunction: { name: string; returnType: string } | null = null;

  private returnDepth: number = 0;
  private functionHasTopLevelReturn: boolean = false;

  private loopDepth: number = 0;
  private switchDepth: number = 0;

  private usageTracker: Map<string, number> = new Map();
  private dirtyAssignment: Map<string, { line: number; overwritten: boolean }> = new Map();

  // =========================================================================
  // Entry point
  // =========================================================================
  check(ast: ASTNode): { symbolTable: SymbolTable; errors: AnalysisError[] } {
    this.symbolTable = {};
    this.errors = [];
    this.usageTracker.clear();
    this.dirtyAssignment.clear();
    this.includedHeaders = new Set();
    this.currentScope = 'global';
    this.scopeStack = ['global'];
    this.currentFunction = null;
    this.functionHasTopLevelReturn = false;
    this.returnDepth = 0;
    this.loopDepth = 0;
    this.switchDepth = 0;
    this.gotoTargets.clear();
    this.definedLabels.clear();

    this.initializeStandardLibrary();
    this.preScanFunctions(ast);
    this.visit(ast);
    this.validateCalledFunctionDefinitions();
    this.performDeadCodeAnalysis();

    return { symbolTable: this.symbolTable, errors: this.errors };
  }

  // =========================================================================
  // Standard library pre-registration
  // =========================================================================
  // =========================================================================
  // Header requirements map — which header must be included for which symbols
  // =========================================================================
  private readonly HEADER_REQUIREMENTS: Record<string, string> = {
    pow: 'cmath', sqrt: 'cmath', abs: 'cmath', fabs: 'cmath',
    ceil: 'cmath', floor: 'cmath', round: 'cmath', fmod: 'cmath',
    log: 'cmath', log2: 'cmath', log10: 'cmath', exp: 'cmath',
    sin: 'cmath', cos: 'cmath', tan: 'cmath',
    asin: 'cmath', acos: 'cmath', atan: 'cmath', atan2: 'cmath',
    setw: 'iomanip', setprecision: 'iomanip', setfill: 'iomanip',
    fixed: 'iomanip', showpoint: 'iomanip', left: 'iomanip', right: 'iomanip',
    boolalpha: 'iomanip', noboolalpha: 'iomanip',
    string: 'string',
    stoi: 'string', stod: 'string', stof: 'string',
    stol: 'string', stoul: 'string', to_string: 'string',
    ifstream: 'fstream', ofstream: 'fstream', fstream: 'fstream',
    getline: 'string',
    rand: 'cstdlib', srand: 'cstdlib', exit: 'cstdlib', system: 'cstdlib',
  };

  private includedHeaders: Set<string> = new Set();

  private initializeStandardLibrary(): void {
    const ioSymbols: Array<[string, string]> = [
      ['cout', 'ostream'], ['cin', 'istream'], ['cerr', 'ostream'],
      ['clog', 'ostream'], 
    ];
    ioSymbols.forEach(([name, type]) => {
      this.symbolTable[`global::${name}`] = {
        name, type, line: 0, scope: 'global', initialized: true, isDefined: true, kind: 'variable',
      };
    });

    this.symbolTable['global::endl'] = {
    name: 'endl', 
    type: 'ostream', 
    line: 0, 
    scope: 'global', 
    initialized: true, 
    isDefined: true, 
    kind: 'variable',
  };

    ['setw', 'setprecision', 'setfill', 'fixed', 'showpoint', 'left', 'right',
      'boolalpha', 'noboolalpha'].forEach(m => {
      this.symbolTable[`global::${m}`] = {
        name: m, type: 'manipulator', line: 0, scope: 'global',
        initialized: true, isDefined: true, kind: 'variable',
      };
    });

    ['pow', 'sqrt', 'abs', 'fabs', 'ceil', 'floor', 'round', 'fmod',
      'log', 'log2', 'log10', 'exp', 'sin', 'cos', 'tan',
      'asin', 'acos', 'atan', 'atan2'].forEach(f => {
      this.symbolTable[`global::${f}`] = {
        name: f, type: 'double', line: 0, scope: 'global',
        initialized: true, isDefined: true, kind: 'function',
      };
    });

    ['system', 'exit', 'rand', 'srand'].forEach(f => {
      this.symbolTable[`global::${f}`] = {
        name: f, type: 'int', line: 0, scope: 'global',
        initialized: true, isDefined: true, kind: 'function',
      };
    });

    this.symbolTable['global::getline'] = {
      name: 'getline', type: 'istream', line: 0, scope: 'global',
      initialized: true, isDefined: true, kind: 'function',
    };

    ['stoi', 'stol', 'stoul'].forEach(f => {
      this.symbolTable[`global::${f}`] = {
        name: f, type: 'int', line: 0, scope: 'global',
        initialized: true, isDefined: true, kind: 'function',
      };
    });
    ['stod', 'stof'].forEach(f => {
      this.symbolTable[`global::${f}`] = {
        name: f, type: 'double', line: 0, scope: 'global',
        initialized: true, isDefined: true, kind: 'function',
      };
    });
    this.symbolTable['global::to_string'] = {
      name: 'to_string', type: 'string', line: 0, scope: 'global',
      initialized: true, isDefined: true, kind: 'function',
    };

    ['ifstream', 'ofstream', 'fstream'].forEach(cls => {
      this.symbolTable[`global::${cls}`] = {
        name: cls, type: 'class', line: 0, scope: 'global',
        initialized: true, isDefined: true, kind: 'variable',
      };
    });

    this.symbolTable['global::string'] = {
      name: 'string', type: 'class', line: 0, scope: 'global',
      initialized: true, isDefined: true, kind: 'variable',
    };

    // nullptr is a keyword-literal — pre-register so undeclared-id doesn't fire
    this.symbolTable['global::nullptr'] = {
      name: 'nullptr', type: 'nullptr_t', line: 0, scope: 'global',
      initialized: true, isDefined: true, kind: 'variable',
    };
  }

  // =========================================================================
  // Pre-scan: register all top-level function declarations before the main
  // pass so that functions defined BELOW their call site (no forward
  // prototype) are still found at the call site without an error.
  // =========================================================================
  private preScanFunctions(ast: ASTNode): void {
    const prog = ast as any;
    const scanBody = (nodes: any[]) => {
      for (const node of nodes) {
        if (node?.type !== 'FunctionDecl' && node?.type !== 'FunctionPrototype') continue;
        const func = node as FunctionDeclNode | FunctionPrototypeNode;
        const key = `global::${func.name}`;
        if (this.symbolTable[key]) continue; // already registered by stdlib
        const entry: ExtendedSymbolInfo = {
          name: func.name,
          type: func.returnType,
          line: func.line || 0,
          scope: 'global',
          initialized: true,
          isDefined: false, // full pass sets this to true
          kind: 'function',
          paramCount:    func.params.length,
          minParamCount: func.params.filter((p: ParameterNode) => !p.defaultValue).length,
          paramTypes:    func.params.map((p: ParameterNode) => p.varType),
          paramDimensions: func.params.map((p: ParameterNode) => this.getDimensionSizes(p.dimensions)),
        };
        this.symbolTable[key] = entry as SymbolInfo;
      }
    };
    if (Array.isArray(prog.body)) scanBody(prog.body);
    // also scan inside namespace blocks (e.g. namespace { ... })
    if (prog.namespace && Array.isArray(prog.namespace.body)) scanBody(prog.namespace.body);
  }

  // =========================================================================
  // Visitor dispatch
  // =========================================================================
  private visit(node: ASTNode | null | string | undefined): string | null {
    if (!node) return null;
    if (typeof node === 'string') {
      return this.visitIdentifier({ type: 'Identifier', name: node } as any);
    }

    const nodeType = (node as any).type as string;

    if (nodeType === 'NewExpression')   return this.visitNewExpression(node);
    if (nodeType === 'DeleteStatement') return this.visitDeleteStatement(node);

    // FIX 14: Handle UnaryOp '-', '!', '~' which the grammar emits as
    // { type: 'UnaryOp', operator: '-'|'!'|'~', operand: ... }
    if (nodeType === 'UnaryOp') return this.visitGenericUnaryOp(node);

    const method = `visit${nodeType}`;
    if (typeof (this as any)[method] === 'function') {
      return (this as any)[method](node);
    }
    return null;
  }

  // =========================================================================
  // Program / Block
  // =========================================================================
  private visitProgram(node: ASTNode): string | null {
    const prog = node as any;
    (prog.directives || []).forEach((d: ASTNode) => this.visit(d));
    if (prog.namespace) this.visit(prog.namespace);
    (prog.body || []).forEach((stmt: ASTNode) => this.visit(stmt));
    return null;
  }

  private visitBlock(node: ASTNode): string | null {
    const block = node as BlockNode;
    this.enterScope('block');
    let returnSeen = false;
    block.statements.forEach((s: ASTNode) => {
      if (returnSeen) {
        this.addError(s, `Unreachable code after 'return' statement`, 'warning');
      }
      // Flatten MultipleVariableDecl inside blocks
      if ((s as any).type === 'MultipleVariableDecl') {
        ((s as any).declarations || []).forEach((d: ASTNode) => this.visit(d));
      } else {
        this.visit(s);
      }
      if ((s as any).type === 'ReturnStatement') returnSeen = true;
    });
    this.exitScope();
    return null;
  }

  private visitExpressionStatement(node: ASTNode): string | null {
    return this.visit((node as ExpressionStatementNode).expression);
  }

  // =========================================================================
  // Function Prototype
  // FIX 15: Store param count so definition mismatch can be detected.
  // =========================================================================
  private visitFunctionPrototype(node: ASTNode): string | null {
    const proto = node as FunctionPrototypeNode;
    const key = `${this.currentScope}::${proto.name}`;
    if (!this.symbolTable[key]) {
      this.addSymbol(proto.name, proto.returnType, proto.line || 0, true, undefined, false, 'function');
    }
    const entry = this.symbolTable[key] as ExtendedSymbolInfo;
    if (entry) {
      entry.paramCount = proto.params.length;
      entry.minParamCount = proto.params.filter((p: ParameterNode) => !p.defaultValue).length;
      entry.paramTypes = proto.params.map((p: ParameterNode) => p.varType);
      entry.paramDimensions = proto.params.map((p: ParameterNode) => this.getDimensionSizes(p.dimensions));
    }
    return proto.returnType;
  }

  // =========================================================================
  // Function Declaration
  // =========================================================================
  private visitFunctionDecl(node: ASTNode): string | null {
    const func = node as FunctionDeclNode;
    const key = `${this.currentScope}::${func.name}`;
    const existing = this.symbolTable[key] as ExtendedSymbolInfo | undefined;

    if (existing) {
      if (existing.isDefined) {
        this.addError(node, `Function '${func.name}' already defined`, 'error');
        return func.returnType;
      }
      if (existing.type !== func.returnType) {
        this.addError(
          node,
          `Function '${func.name}': definition return type '${func.returnType}' does not match prototype '${existing.type}'`,
          'error',
        );
      }
      // FIX 12: param-count mismatch
      if (
        existing.paramCount !== undefined &&
        existing.paramCount !== func.params.length
      ) {
        this.addError(
          node,
          `Function '${func.name}': prototype declared ${existing.paramCount} parameter(s) but definition has ${func.params.length}`,
          'error',
        );
      }
      const definitionParamTypes = func.params.map((p: ParameterNode) => p.varType);
      const definitionParamDimensions = func.params.map((p: ParameterNode) => this.getDimensionSizes(p.dimensions));
      (existing.paramTypes || []).forEach((paramType, i) => {
        if (definitionParamTypes[i] && paramType !== definitionParamTypes[i]) {
          this.addError(
            node,
            `Function '${func.name}': parameter ${i + 1} type '${definitionParamTypes[i]}' does not match prototype '${paramType}'`,
            'error',
          );
        }
      });
      (existing.paramDimensions || []).forEach((paramDims, i) => {
        const defDims = definitionParamDimensions[i] || [];
        if (!this.arrayDimensionsCompatible(paramDims, defDims, true)) {
          this.addError(
            node,
            `Function '${func.name}': parameter ${i + 1} array dimensions do not match prototype`,
            'error',
          );
        }
      });
      existing.paramTypes = definitionParamTypes;
      existing.paramDimensions = definitionParamDimensions;
      existing.minParamCount = func.params.filter((p: ParameterNode) => !p.defaultValue).length;
      existing.isDefined = true;
    } else {
      this.addSymbol(func.name, func.returnType, func.line || 0, true, undefined, true, 'function');
      const newEntry = this.symbolTable[key] as ExtendedSymbolInfo;
      if (newEntry) {
        newEntry.paramCount    = func.params.length;
        newEntry.minParamCount = func.params.filter((p: ParameterNode) => !p.defaultValue).length;
        newEntry.paramTypes    = func.params.map((p: ParameterNode) => p.varType);
        newEntry.paramDimensions = func.params.map((p: ParameterNode) => this.getDimensionSizes(p.dimensions));
      }
    }

    this.currentFunction = { name: func.name, returnType: func.returnType };
    this.functionHasTopLevelReturn = false;
    this.returnDepth = 0;

    this.enterScope(func.name);

    func.params.forEach((param: ParameterNode) => {
  if (!param.name) {
    this.addError(node, `Function '${func.name}': unnamed parameters are not allowed in definitions`, 'error');
    return;
  }

  // 1. Register the symbol as a parameter
  this.addSymbol(param.name, param.varType, param.line || 0, true, this.getDimensionSizes(param.dimensions), true, 'parameter');

  // 2. Track the initial "Write" from the caller. 
  // We don't call markRead yet because the function body hasn't actually used it.
  const fullKey = `${this.currentScope}::${param.name}`;
  
  // We set 'overwritten: false' to indicate it has a value from the caller, 
  // but it hasn't been replaced by an internal assignment yet.
  this.dirtyAssignment.set(fullKey, { 
    line: param.line || func.line || 0, 
    overwritten: false 
  });
});

    const executableMainStatements = (func.body || []).filter((s: ASTNode) => {
      const t = (s as any)?.type;
      if (t === 'ReturnStatement') return false;
      if (t === 'Block' && Array.isArray((s as any)?.statements) && (s as any).statements.length === 0) return false;
      return true;
    }).length;

    if (Array.isArray(func.body)) {
      let returnSeen = false;
      func.body.forEach((s: ASTNode) => {
        if (returnSeen) {
          this.addError(s, `Unreachable code after 'return' statement`, 'warning');
        }
        this.visit(s);
        if ((s as any).type === 'ReturnStatement') returnSeen = true;
      });
    }

    // Return enforcement — main and non-void functions are checked separately
    if (func.name === 'main') {
      if (executableMainStatements === 0) {
        this.addError(
          node,
          `No executable logic found in 'main' (only return/empty statements). Add at least one meaningful statement.`,
          'warning',
        );
      }
      if (func.returnType !== 'int') {
        this.addError(node, "C++ Standard: 'main' must have return type 'int'", 'error');
      }
      if (!this.functionHasTopLevelReturn && !this.allPathsReturn(func.body || [])) {
        this.addError(node, "Strict Error: 'main' must explicitly 'return 0;'", 'error');
      }
    } else if (func.returnType !== 'void') {
      if (!this.functionHasTopLevelReturn && !this.allPathsReturn(func.body || [])) {
        this.addError(
          node,
          `Semantic Error: Not all paths in function '${func.name}' return a value (expects '${func.returnType}').`,
          'error',
        );
      }
    }

    this.resolveGotoTargets();
    this.exitScope();
    this.currentFunction = null;
    this.functionHasTopLevelReturn = false;
    this.returnDepth = 0;
    return func.returnType;
  }

  // =========================================================================
  // Variable Declaration
  // =========================================================================
  private visitVariableDecl(node: ASTNode): string | null {
    const varNode = node as VariableDeclNode;
    const mods: string[] = Array.isArray((varNode as any).modifiers) ? (varNode as any).modifiers : [];
    const isConst     = mods.includes('const') || mods.includes('constexpr');
    const isConstExpr = mods.includes('constexpr');

    let arrayDimensions: number[] | undefined;
    if (varNode.dimensions && varNode.dimensions.length > 0) {
      arrayDimensions = varNode.dimensions.map((d: ASTNode) =>
        (d as any).value !== undefined ? (d as any).value : 0,
      );
    }

    const initialized = varNode.value !== null && varNode.value !== undefined;

    // constexpr must always be initialized
    if (isConstExpr && !initialized) {
      this.addError(node, `'constexpr' variable '${varNode.name}' must be initialized at declaration.`, 'error');
    }

    this.validateHeaderForType(varNode.varType, node);

    // ── auto type inference ─────────────────────────────────────────────────
    if (varNode.varType === 'auto') {
      if (!initialized) {
        this.addError(node, `'auto' variable '${varNode.name}' must have an initializer for type inference.`, 'error');
        this.addSymbol(varNode.name, 'auto', varNode.line || 0, false, arrayDimensions, true, 'variable', isConst);
        return 'auto';
      }
      const inferredType = this.visit(varNode.value) || 'auto';
      this.addSymbol(varNode.name, inferredType, varNode.line || 0, true, arrayDimensions, true, 'variable', isConst);
      this.markWrite(varNode.name, varNode.line || 0);
      return inferredType;
    }

    this.addSymbol(
      varNode.name, varNode.varType, varNode.line || 0,
      initialized, arrayDimensions, true, 'variable', isConst,
    );

    if (initialized) {
      const valueType = this.visit(varNode.value);
      this.markWrite(varNode.name, varNode.line || 0);

      // ── REFERENCE DECLARATIONS are always type-compatible ──────────────
      const normalizedDeclType = varNode.varType.replace(/\s+/g, '');
      const isReferenceDecl = normalizedDeclType.includes('&');

      if (!isReferenceDecl && valueType && !this.isTypeCompatible(varNode.varType, valueType, varNode.value)) {
        this.addError(node, `Type mismatch: cannot assign '${valueType}' to '${varNode.varType}'`);
      } else if (isReferenceDecl && valueType) {
        const baseTarget = normalizedDeclType.replace(/&+$/, '').replace(/^const/, '').replace(/\s+/g, '');
        const baseSource = valueType.replace(/&+$/, '').replace(/^const/, '').replace(/\s+/g, '');
        const numWeight: Record<string, number> = {
          char: 1, short: 1.5, int: 2, long: 2.5, float: 3, double: 4,
        };
        if (baseTarget !== baseSource &&
            numWeight[baseTarget] !== undefined &&
            numWeight[baseSource] !== undefined &&
            numWeight[baseTarget] < numWeight[baseSource]) {
          this.addError(node, `Possible data loss: binding '${valueType}' to reference '${varNode.varType}' (narrowing conversion).`, 'warning');
        }
      }
    }
    return varNode.varType;
  }

  // Multi-declaration support (e.g., int x, y, z;)
  private visitMultipleVariableDecl(node: any): string | null {
    let lastType: string | null = null;
    (node.declarations || []).forEach((decl: ASTNode) => {
      lastType = this.visitVariableDecl(decl);
    });
    return lastType;
  }

  // =========================================================================
  // Array Access
  // =========================================================================

  private visitArrayAccess(node: ASTNode): string | null {
    const arr = node as ArrayAccessNode;
    const symbol = this.lookupSymbol(arr.name);

    if (!symbol) {
      this.addError(node, `Undeclared array '${arr.name}'`);
      return null;
    }
    this.markRead(arr.name);

    arr.indices.forEach((idxNode: ASTNode, i: number) => {
      const idxType = this.visit(idxNode);
      if (idxType && idxType !== 'int' && idxType !== 'long') {
        this.addError(idxNode, `Array index must be an integer, got '${idxType}'`);
      }
      const idxAny = idxNode as any;
      if (idxAny.type === 'Integer' && symbol.dimensions && symbol.dimensions[i] !== undefined && symbol.dimensions[i] > 0) {
        if (idxAny.value < 0) {
          this.addError(idxNode, `Array index ${idxAny.value} is negative`);
        } else if (idxAny.value >= symbol.dimensions[i]) {
          this.addError(
            idxNode,
            `Index ${idxAny.value} out of bounds for array '${arr.name}' (size ${symbol.dimensions[i]}, valid: 0–${symbol.dimensions[i] - 1})`,
          );
        }
      }
    });
    let resultingType = symbol.type;
  for (let i = 0; i < arr.indices.length; i++) {
    if (resultingType.endsWith('*')) {
      resultingType = resultingType.slice(0, -1).trim();
    } else if (resultingType.endsWith(']')) {
      // Handle cases where type might be stored as 'int[10]'
      resultingType = resultingType.split('[')[0].trim();
    }
  }
    return resultingType;
  }

  // =========================================================================
  // CP2: new / delete
  // =========================================================================
  private visitNewExpression(node: any): string | null {
    if (node.size) {
      const sizeType = this.visit(node.size);
      if (sizeType && sizeType !== 'int' && sizeType !== 'long') {
        this.addError(node.size, `Array allocation size must be an integer, got '${sizeType}'`);
      }
    }
    return `${node.baseType}*`;
  }

  private visitDeleteStatement(node: any): string | null {
    const symbol = this.lookupSymbol(node.target);
    if (symbol) {
      if (!symbol.type.endsWith('*')) {
        this.addError(
          node,
          `'delete' can only be applied to pointer types; '${node.target}' is '${symbol.type}'`,
          'error',
        );
      }
      this.markRead(node.target);
    } else {
      this.addError(node, `Undeclared identifier '${node.target}' in delete expression`);
    }
    return 'void';
  }

  // =========================================================================
  // Initializer List
  // =========================================================================
  private visitInitializerList(node: ASTNode): string | null {
    const initList = node as InitializerListNode;
    let detectedType: string | null = null;
    for (const val of initList.values) {
      const t = this.visit(val);
      if (!detectedType) {
        detectedType = t;
      } else if (t && !this.isTypeCompatible(detectedType, t)) {
        this.addError(node, `Inconsistent types in initializer list: '${detectedType}' and '${t}'`);
      }
    }
    return detectedType;
  }

  // =========================================================================
  // Loops & Control Flow
  // FIX 16: Infinite-loop detection integrated into while / for visitors.
  // =========================================================================
  private visitWhileLoop(node: ASTNode): string | null {
    const w = node as WhileLoopNode;
    const condType = this.visit(w.condition);
    if (condType && !this.isContextuallyConvertibleToBool(condType)) {
      this.addError(w.condition, `While condition must be boolean-convertible, got '${condType}'`);
    }

    // PDF #6: Constant-false condition detection. `while (false)` / `while (0)`
    // never executes the body — surface a beginner-friendly warning so the
    // user understands the loop body is dead code.
    const cond = w.condition as any;
    if ((cond?.type === 'Literal' && cond.value === false) ||
        (cond?.type === 'Integer' && cond.value === 0)) {
      this.addError(
        node,
        `Loop never runs: condition is always false — the body is unreachable.`,
        'warning',
      );
    }
    // Compile-time constant-false comparison, e.g. `while (10 < 5)` or
    // an initial-state comparison like `int x = 10; while (x < 5)` where x
    // is never modified between init and the loop. Use the same const-fold
    // helper the symbolic executor would use; here a lightweight literal
    // check covers the most common beginner case from the bug report.
    if (cond?.type === 'BinaryOp' &&
        (cond.left?.type === 'Integer'  || cond.left?.type === 'Float') &&
        (cond.right?.type === 'Integer' || cond.right?.type === 'Float')) {
      const lv = cond.left.value, rv = cond.right.value;
      const result =
        cond.operator === '<'  ? lv <  rv :
        cond.operator === '<=' ? lv <= rv :
        cond.operator === '>'  ? lv >  rv :
        cond.operator === '>=' ? lv >= rv :
        cond.operator === '==' ? lv === rv :
        cond.operator === '!=' ? lv !== rv :
        null;
      if (result === false) {
        this.addError(
          node,
          `Loop never runs: condition '${lv} ${cond.operator} ${rv}' is always false — the body is unreachable.`,
          'warning',
        );
      }
    }

    // FIX 16: Infinite-loop detection (only when body is non-empty and no exit statement)
    const condVars = this.extractVariablesFromNode(w.condition);
    const modified = this.extractModifiedVariables(w.body);
    const hasExit = this.bodyHasExit(w.body);
    if (condVars.size > 0 && ![...condVars].some(v => modified.has(v)) && !hasExit) {
      this.addError(
        node,
        `Potential infinite loop: condition variable(s) [${[...condVars].join(', ')}] are never modified in the loop body`,
        'warning',
      );
    }

    this.loopDepth++;
    this.enterScope('while');
    w.body.forEach((s: ASTNode) => this.visit(s));
    this.exitScope();
    this.loopDepth--;
    return null;
  }

  private visitDoWhileLoop(node: ASTNode): string | null {
    const dw = node as DoWhileLoopNode;
    this.loopDepth++;
    this.enterScope('do-while');
    dw.body.forEach((s: ASTNode) => this.visit(s));
    this.exitScope();
    this.loopDepth--;
    const condType = this.visit(dw.condition);
    if (condType && !this.isContextuallyConvertibleToBool(condType)) {
      this.addError(dw.condition, `Do-while condition must be boolean-convertible, got '${condType}'`);
    }
    return null;
  }

  private visitForLoop(node: ASTNode): string | null {
    const f = node as ForLoopNode;
    this.loopDepth++;
    this.enterScope('for');
    if (f.init) this.visit(f.init);
    if (f.condition) {
      const ct = this.visit(f.condition);
      if (ct && !this.isContextuallyConvertibleToBool(ct)) {
        this.addError(f.condition, `For-loop condition must be boolean-convertible, got '${ct}'`);
      }
      // FIX 16: Infinite-loop detection for for-loops (no update expression)
      if (!f.update) {
        const condVars = this.extractVariablesFromNode(f.condition);
        const modified = this.extractModifiedVariables(f.body);
        if (condVars.size > 0 && ![...condVars].some(v => modified.has(v))) {
          this.addError(
            node,
            `Potential infinite loop: for-loop has no update expression and condition variable(s) [${[...condVars].join(', ')}] are never modified`,
            'warning',
          );
        }
      }
    }
    if (f.update) this.visit(f.update);
    f.body.forEach((s: ASTNode) => this.visit(s));
    this.exitScope();
    this.loopDepth--;
    return null;
  }

  private visitSwitchStatement(node: ASTNode): string | null {
    const sw = node as SwitchStatementNode;
    const ct = this.visit(sw.condition);
    if (ct && !['int', 'char', 'long', 'short'].includes(ct)) {
      this.addError(sw.condition, `Switch condition must be an integral type, got '${ct}'`);
    }
    this.switchDepth++;
    this.enterScope('switch');
    sw.cases.forEach((c: CaseNode) => this.visit(c as unknown as ASTNode));
    this.exitScope();
    this.switchDepth--;
    return null;
  }

  private visitCase(node: ASTNode): string | null {
    const c = node as unknown as CaseNode;
    if (c.value) this.visit(c.value);
    c.statements.forEach((s: ASTNode) => this.visit(s));
    return null;
  }

  private visitDefaultCase(node: ASTNode): string | null {
    return this.visitCase(node);
  }

  private visitIfStatement(node: ASTNode): string | null {
    const ifn = node as IfStatementNode;
    const condNode = ifn.condition as any;
    if (condNode?.type === 'Assignment' && condNode.operator === '=') {
      this.addError(
        ifn.condition as any,
        `Suspicious assignment in condition: use '==' for comparison instead of '='.`,
        'warning',
      );
    }
    const ct = this.visit(ifn.condition);
    if (ct && !this.isContextuallyConvertibleToBool(ct)) {
      this.addError(ifn.condition, `If condition must be boolean-convertible, got '${ct}'`);
    }

    // ── Logical contradiction / tautology detection ───────────────────────
    const cond = ifn.condition as any;
    if (cond) {
      // if (false) or if (0)
      if ((cond.type === 'Literal' && cond.value === false) ||
          (cond.type === 'Integer' && cond.value === 0)) {
        this.addError(node, `Logical contradiction: condition is always false — then-branch is unreachable`, 'warning');
      }
      // if (true) or if (1) with an else
      if ((cond.type === 'Literal' && cond.value === true) ||
          (cond.type === 'Integer' && cond.value === 1)) {
        if (ifn.elseBranch && ifn.elseBranch.length > 0) {
          this.addError(node, `Logical tautology: condition is always true — else-branch is unreachable`, 'warning');
        }
      }
      // if (x != x), if (x == x), if (x > x), if (x < x)
      if (cond.type === 'BinaryOp') {
        const lName = (cond.left as any)?.name ?? (cond.left as any)?.value;
        const rName = (cond.right as any)?.name ?? (cond.right as any)?.value;
        if (lName !== undefined && rName !== undefined && String(lName) === String(rName)) {
          if (cond.operator === '!=' || cond.operator === '>' || cond.operator === '<') {
            this.addError(node, `Logical contradiction: '${lName} ${cond.operator} ${rName}' is always false`, 'warning');
          } else if (cond.operator === '==' || cond.operator === '>=' || cond.operator === '<=') {
            if (ifn.elseBranch && ifn.elseBranch.length > 0) {
              this.addError(node, `Logical tautology: '${lName} ${cond.operator} ${rName}' is always true`, 'warning');
            }
          }
        }
      }
    }

    this.returnDepth++;
    this.enterScope('if');
    ifn.thenBranch.forEach((s: ASTNode) => this.visit(s));
    this.exitScope();
    if (ifn.elseBranch) {
      this.enterScope('else');
      ifn.elseBranch.forEach((s: ASTNode) => this.visit(s));
      this.exitScope();
    }
    this.returnDepth--;
    return null;
  }

  private visitLoopControl(node: ASTNode): string | null {
    const ctrl = node as LoopControlNode;
    if (ctrl.value === 'break' && this.loopDepth === 0 && this.switchDepth === 0) {
      this.addError(node, "'break' statement is not inside a loop or switch", 'error');
    }
    if (ctrl.value === 'continue' && this.loopDepth === 0) {
      this.addError(node, "'continue' statement is not inside a loop", 'error');
    }
    return null;
  }

  // =========================================================================
  // Goto / Labels
  // =========================================================================
  private gotoTargets:   Set<string> = new Set();
  private definedLabels: Set<string> = new Set();

  private visitGotoStatement(node: any): string | null {
    if (!this.currentFunction) {
      this.addError(node, `'goto' is only valid inside a function.`, 'error');
      return null;
    }
    if (node.label) this.gotoTargets.add(node.label);
    return null;
  }

  private visitLabelStatement(node: any): string | null {
    if (this.definedLabels.has(node.name)) {
      this.addError(node, `Duplicate label '${node.name}' in the same function.`, 'error');
    } else {
      this.definedLabels.add(node.name);
    }
    if (node.statement) this.visit(node.statement);
    return null;
  }

  private resolveGotoTargets(): void {
    this.gotoTargets.forEach(target => {
      if (!this.definedLabels.has(target)) {
        this.errors.push({
          type: 'semantic', severity: 'error',
          message: `Undefined goto target: label '${target}' does not exist in this function.`,
          line: 0, column: 0,
        });
      }
    });
    this.gotoTargets.clear();
    this.definedLabels.clear();
  }

  // =========================================================================
  // Member access  (.field  /  ->field)
  // Member type cannot be resolved without a class schema, so we return
  // 'unknown' which is compatible with everything in isTypeCompatible.
  // =========================================================================
  private visitMemberAccess(node: any): string | null {
    this.visit(node.object ?? node.left ?? node.target);
    return 'unknown';
  }
  private visitArrowAccess(node: any): string | null {
    const obj = node.object ?? node.left ?? node.target;
    const sym = obj?.name ? this.lookupSymbol(obj.name) : null;
    if (sym && !sym.type.endsWith('*') && sym.type !== 'unknown') {
      this.addError(node, `'${obj.name}' is not a pointer; use '.' instead of '->'`, 'warning');
    }
    this.visit(obj);
    return 'unknown';
  }
  // Handles obj.method(args) and ptr->method(args)
  private visitMethodCall(node: any): string | null {
    this.visit(node.object ?? node.target);
    (node.arguments || []).forEach((arg: ASTNode) => this.visit(arg));
    return 'unknown';
  }
  // Some parsers emit MemberCallExpression for chained calls
  private visitMemberCallExpression(node: any): string | null { return this.visitMethodCall(node); }
  private visitChainedCall(node: any):           string | null { return this.visitMethodCall(node); }

  // =========================================================================
  // Comma operator — (expr1, expr2, ...) — left side for side effects,
  // right-most (or last) type is the result type.
  // =========================================================================
  private visitCommaExpression(node: any): string | null {
    let lastType: string | null = null;
    (node.expressions || node.operands || []).forEach((e: ASTNode) => { lastType = this.visit(e); });
    return lastType;
  }
  private visitCommaOp(node: any):         string | null { return this.visitCommaExpression(node); }
  private visitSequenceExpression(node: any): string | null { return this.visitCommaExpression(node); }

  private visitGlobalAccess(node: ASTNode): string | null {
    const g = node as GlobalAccessNode;
    const symbol = this.symbolTable[`global::${g.name}`];
    if (!symbol) {
      this.addError(node, `Undeclared global '${g.name}'`);
      return null;
    }
    if (!symbol.initialized) {
      this.addError(node, `Global '${g.name}' used before initialization`, 'warning');
    }
    this.markRead(g.name);
    return symbol.type;
  }

  // =========================================================================
  // Function Call
  // =========================================================================
  private visitFunctionCall(node: ASTNode): string | null {
    const call = node as FunctionCallNode;
    this.markRead(call.name);

    if (this.currentFunction && call.name === this.currentFunction.name) {
    this.addError(
      node,
      `Recursive call detected: '${call.name}' calls itself. Ensure a base case exists to prevent infinite recursion.`,
      'warning',
    );
  }

    const argTypes: (string | null)[] = (call.arguments || []).map((arg: ASTNode) => this.visit(arg));

    const symbol = this.lookupSymbol(call.name);
    if (symbol) {
      this.validateHeaderForSymbol(call.name, node);

      const ext = symbol as ExtendedSymbolInfo;
      if (ext.paramCount !== undefined && symbol.kind === 'function') {
        const provided = call.arguments?.length || 0;
        const min = ext.minParamCount ?? ext.paramCount;
        const max = ext.paramCount;
        if (provided < min) {
          this.addError(node,
            `Too few arguments to '${call.name}': expected ${min === max ? max : `${min}–${max}`}, got ${provided}.`, 'error');
        } else if (provided > max) {
          this.addError(node,
            `Too many arguments to '${call.name}': expected ${max}, got ${provided}.`, 'error');
        }

        // Per-argument pass-by-reference and pass-by-pointer checks
        (ext.paramTypes || []).forEach((paramType: string, i: number) => {
          const arg = (call.arguments || [])[i] as any;
          if (!arg) return;
          const argType = argTypes[i];
          const normParam = paramType.replace(/\s+/g, '');
          const paramDims = ext.paramDimensions?.[i] || [];

          // Pass-by-non-const-reference: arg must be an lvalue
          const isNonConstRef = normParam.includes('&') && !normParam.startsWith('const');
          if (isNonConstRef) {
            const isLvalue = typeof arg === 'string' ||
              arg.type === 'Identifier' ||
              arg.type === 'ArrayAccess' ||
              arg.type === 'Dereference';
            if (!isLvalue) {
              this.addError(arg,
                `Argument ${i + 1} to '${call.name}': cannot bind a temporary or literal to non-const reference parameter '${paramType}'.`, 'error');
            }
          }

          // Pass-by-pointer: arg must already be a pointer or address-of expression
          const isPtrParam = normParam.endsWith('*') && !normParam.includes('&');
          if (isPtrParam && argType && !argType.endsWith('*') && argType !== 'nullptr_t') {
            if (arg.type !== 'AddressOf') {
              this.addError(arg,
                `Argument ${i + 1} to '${call.name}': expected pointer '${paramType}' but got '${argType}' — did you mean '&${typeof arg === 'string' ? arg : arg.name ?? 'var'}'?`, 'error');
            }
          }

          if (paramDims.length > 0) {
            const argName = typeof arg === 'string'
              ? arg
              : arg?.type === 'Identifier'
              ? arg.name
              : '';
            const argSymbol = argName ? this.lookupSymbol(argName) : null;
            if (!argSymbol?.dimensions?.length) {
              this.addError(arg,
                `Argument ${i + 1} to '${call.name}': expected array parameter but got '${argType ?? 'unknown'}'.`, 'error');
            } else if (!this.arrayDimensionsCompatible(paramDims, argSymbol.dimensions, false)) {
              this.addError(arg,
                `Argument ${i + 1} to '${call.name}': array dimensions [${argSymbol.dimensions.join('][')}] are incompatible with parameter [${paramDims.join('][')}].`, 'error');
            }
          }
        });
      }

      return symbol.type;
    }

    this.addError(
      node,
      `Undeclared function '${call.name}' — did you forget to declare or include it?`,
      'error',
    );
    return 'unknown';
  }

  // =========================================================================
  // Unary Operators
  // =========================================================================
  private visitPreIncrement(node: ASTNode): string | null  { return this.visitUnaryMutate(node); }
  private visitPostIncrement(node: ASTNode): string | null { return this.visitUnaryMutate(node); }
  private visitPreDecrement(node: ASTNode): string | null  { return this.visitUnaryMutate(node); }
  private visitPostDecrement(node: ASTNode): string | null { return this.visitUnaryMutate(node); }

  // FIX 14: Generic UnaryOp for '-', '!', '~'
  private visitGenericUnaryOp(node: ASTNode): string | null {
    const u = node as any;
    const operandType = this.visit(u.operand);
    switch (u.operator) {
      case '-':
        if (operandType && !this.isNumericType(operandType)) {
          this.addError(node, `Unary '-' requires a numeric operand, got '${operandType}'`);
        }
        return operandType;
      case '!':
        if (operandType && !this.isContextuallyConvertibleToBool(operandType)) {
          this.addError(node, `Logical NOT '!' requires a boolean-convertible operand, got '${operandType}'`);
        }
        return 'bool';
      case '~':
        if (operandType && !this.isIntegralType(operandType)) {
          this.addError(node, `Bitwise NOT '~' requires an integral operand, got '${operandType}'`);
        }
        return operandType || 'int';
      default:
        return operandType;
    }
  }

  private visitAddressOf(node: ASTNode): string | null {
    const u = node as UnaryOpNode;
    const name = this.operandName(u);
    const symbol = this.lookupSymbol(name);
    if (!symbol) { this.addError(node, `Undeclared variable '${name}'`); return null; }
    this.markRead(name);
    return `${symbol.type}*`;
  }

  private visitDereference(node: ASTNode): string | null {
    return this.visitUnaryOp(node);
  }

  private visitUnaryMutate(node: ASTNode): string | null {
    const u = node as UnaryOpNode;
    const name = this.operandName(u);
    const symbol = this.lookupSymbol(name) as ExtendedSymbolInfo | null;
    if (!symbol) { this.addError(node, `Undeclared variable '${name}'`); return null; }
    if (symbol.isConst) {
      this.addError(node, `Cannot modify const variable '${name}'`, 'error');
    }
    if (!this.isNumericType(symbol.type)) {
      this.addError(node, `Cannot apply ${node.type} to non-numeric type '${symbol.type}'`);
    }
    this.markRead(name);
    this.markWrite(name, (node as any).line || 0);
    return symbol.type;
  }

  private visitUnaryOp(node: ASTNode): string | null {
    const u = node as UnaryOpNode;
    const name = this.operandName(u);
    if (name) {
      const symbol = this.lookupSymbol(name);
      if (!symbol) { this.addError(node, `Undeclared variable '${name}'`); return null; }
      this.markRead(name);
      if (node.type === 'Dereference' && symbol.type.endsWith('*')) {
        return symbol.type.slice(0, -1);
      }
      return symbol.type;
    }
    return this.visit(u.operand as ASTNode);
  }

  private operandName(u: UnaryOpNode): string {
    if (typeof u.operand === 'string') return u.operand;
    if ((u.operand as any)?.name) return (u.operand as any).name;
    return '';
  }

  // =========================================================================
  // Ternary / Cast / Sizeof / Lambda
  // =========================================================================
  private visitConditionalExpression(node: ASTNode): string | null {
    const t = node as ConditionalExpressionNode;
    const ct = this.visit(t.condition);
    if (ct && !this.isContextuallyConvertibleToBool(ct)) {
      this.addError(t.condition, `Ternary condition must be boolean-convertible, got '${ct}'`);
    }
    const trueT = this.visit(t.trueExpression);
    const falseT = this.visit(t.falseExpression);
    if (trueT && falseT) {
      if (this.isTypeCompatible(trueT, falseT)) return trueT;
      if (this.isTypeCompatible(falseT, trueT)) return falseT;
      this.addError(node, `Ternary branches have incompatible types: '${trueT}' and '${falseT}'`);
      return trueT;
    }
    return trueT || falseT;
  }

  private visitCastExpression(node: ASTNode): string | null {
    this.visit((node as CastExpressionNode).operand);
    return (node as CastExpressionNode).targetType;
  }

  private visitSizeofExpression(node: ASTNode): string | null {
    this.visit((node as SizeofExpressionNode).value);
    return 'int';
  }

  private visitLambdaExpression(node: ASTNode): string | null {
    const lam = node as LambdaExpressionNode;
    this.enterScope('lambda');
    lam.body.forEach((s: ASTNode) => this.visit(s));
    this.exitScope();
    return 'lambda';
  }

  // =========================================================================
  // Assignment (FIX 10: const mutation detection)
  // =========================================================================
  private visitAssignment(node: ASTNode): string | null {
    const assign = node as AssignmentNode;
    let targetType: string | null = null;
    let targetName = '';

    if (typeof assign.target === 'string') {
      targetName = assign.target;
      const symbol = this.lookupSymbol(targetName) as ExtendedSymbolInfo | null;
      if (!symbol) {
        this.addError(node, `Undeclared variable '${targetName}'`);
        return null;
      }
      if (symbol.isConst) {
        this.addError(node, `Cannot assign to const variable '${targetName}'`, 'error');
      }
      if (assign.operator !== '=') {
        this.markRead(targetName);
        if (!symbol.initialized) {
          this.addError(
            node,
            `Variable '${targetName}' used (via ${assign.operator}) before initialization`,
            'warning',
          );
        }
      }
      symbol.initialized = true;
      targetType = symbol.type;
    } else {
      targetType = this.visit(assign.target);
      if ((assign.target as any).name) {
        targetName = (assign.target as any).name;
        const targetSymbol = this.lookupSymbol(targetName) as ExtendedSymbolInfo | null;
        if (targetSymbol) targetSymbol.initialized = true;
      }
    }

    const valueType = this.visit(assign.value);
    if (targetName) this.markWrite(targetName, (assign as any).line || 0);

    if (targetType && valueType && !this.isTypeCompatible(targetType, valueType, assign.value)) {
      this.addError(node, `Type mismatch: cannot assign '${valueType}' to '${targetType}'`);
    }
    return targetType;
  }

  // =========================================================================
  // Binary Operations
  // =========================================================================
  private visitBinaryOp(node: ASTNode): string | null {
  const bin = node as BinaryOpNode;
  const leftType = this.visit(bin.left);
  const rightType = this.visit(bin.right);

  if (!leftType || !rightType) return null;

  // ─── ARITHMETIC OPERATORS ───────────────────────────────────────────────
  if (['+', '-', '*', '/', '%'].includes(bin.operator)) {
    if (bin.operator === '+' && leftType === 'string' && rightType === 'string') {
      return 'string';
    }
    if (bin.operator === '+' && (leftType === 'string' || rightType === 'string')) {
      this.addError(
        node,
        `Cannot use '+' between '${leftType}' and '${rightType}'. ` +
        `Use std::to_string() to convert numbers to strings.`,
        'error',
      );
      return 'string';
    }

    // ── Pointer arithmetic ────────────────────────────────────────────────
    const leftIsPtr  = leftType.endsWith('*');
    const rightIsPtr = rightType.endsWith('*');
    if (leftIsPtr || rightIsPtr) {
      if (['*', '/', '%'].includes(bin.operator)) {
        this.addError(node,
          `Invalid pointer arithmetic: '${bin.operator}' cannot be applied to pointer — only '+' and '-' are valid.`,
          'error');
        return null;
      }
      if (bin.operator === '+') {
        if (leftIsPtr && rightIsPtr) {
          this.addError(node, `Cannot add two pointer types '${leftType}' and '${rightType}'.`, 'error');
          return null;
        }
        if (leftIsPtr  && this.isNumericType(rightType)) return leftType;
        if (rightIsPtr && this.isNumericType(leftType))  return rightType;
        this.addError(node, `Cannot add '${leftType}' and '${rightType}'.`, 'error');
        return null;
      }
      if (bin.operator === '-') {
        if (leftIsPtr && rightIsPtr) {
          if (leftType !== rightType) {
            this.addError(node,
              `Cannot subtract incompatible pointer types '${leftType}' and '${rightType}'.`, 'error');
          }
          return 'ptrdiff_t';
        }
        if (leftIsPtr && this.isNumericType(rightType)) return leftType;
        this.addError(node,
          `Cannot subtract pointer '${rightType}' from non-pointer '${leftType}'.`, 'error');
        return null;
      }
    }

    if (!this.isNumericType(leftType) || !this.isNumericType(rightType)) {
      this.addError(
        node,
        `Operator '${bin.operator}' requires numeric operands, got '${leftType}' and '${rightType}'`,
      );
      return null;
    }
    if (bin.operator === '%') {
      if (!this.isIntegralType(leftType) || !this.isIntegralType(rightType)) {
        this.addError(
          node,
          `Operator '%' is only valid for integer types, got '${leftType}' and '${rightType}'`,
          'error',
        );
      }
      return 'int';
    }
    return this.promoteType(leftType, rightType);
  }

  // ─── COMPARISON OPERATORS ───────────────────────────────────────────────
  if (['<', '>', '<=', '>=', '==', '!='].includes(bin.operator)) {
    if (!this.isComparable(leftType, rightType)) {
      this.addError(node, `Cannot compare '${leftType}' with '${rightType}'`);
    }
    return 'bool';
  }

  // ─── LOGICAL OPERATORS ──────────────────────────────────────────────────
  if (['&&', '||'].includes(bin.operator)) {
    if (!this.isContextuallyConvertibleToBool(leftType) || !this.isContextuallyConvertibleToBool(rightType)) {
      this.addError(node, `Operator '${bin.operator}' requires boolean-convertible operands`);
    }
    return 'bool';
  }

  // ─── BITWISE & STREAM OPERATORS ─────────────────────────────────────────
 // backend/src/analysis/typechecker.ts -> visitBinaryOp
// backend/src/analysis/typechecker.ts -> visitBinaryOp

if (['&', '|', '^', '<<', '>>'].includes(bin.operator)) {
  const streamTypes = ['ostream', 'istream', 'manipulator', 'unknown', 
                       'ifstream', 'ofstream', 'fstream',
                       'string', 'int', 'float', 'double', 'char', 'bool', 'long'];
  const isStreamOp =
    (bin.operator === '<<' || bin.operator === '>>') &&
    (streamTypes.includes(leftType) || streamTypes.includes(rightType));

  if (!isStreamOp && (!this.isIntegralType(leftType) || !this.isIntegralType(rightType))) {
    this.addError(
      node,
      `Bitwise operator '${bin.operator}' requires integral operands, got '${leftType}' and '${rightType}'`,
      'error',
    );
  }
  return isStreamOp ? leftType : this.promoteType(leftType, rightType);
}
  return null;
}
  // =========================================================================
  // Identifier
  // =========================================================================
 private visitIdentifier(node: ASTNode): string | null {
  let name = (node as any).name;

  // 1. Handle Keywords/Literals
  if (name === 'true' || name === 'false') return 'bool';
  if (name === 'nullptr') return 'nullptr_t';

  // 2. Handle std:: prefix (e.g., std::cout)
  // Strip the prefix for lookup if your symbolTable uses plain 'cout' 
  // or handle it as a pass-through.
  if (typeof name === 'string' && name.startsWith('std::')) {
    const plainName = name.replace('std::', '');
    const stdSymbol = this.lookupSymbol(plainName);
    if (stdSymbol) {
      this.validateHeaderForSymbol(plainName, node);
      this.markRead(plainName);
      return stdSymbol.type;
    }
    return 'unknown'; 
  }

  // 3. Regular Lookup
  const symbol = this.lookupSymbol(name);

  if (!symbol) {
    this.addError(node, `Undeclared identifier '${name}'`);
    return null;
  }

  // 4. Initialization Check
  // We don't warn for functions or symbols marked as initialized (like cout/cin)
  if (!symbol.initialized && symbol.kind !== 'function') {
    this.addError(node, `Variable '${name}' used before initialization`, 'warning');
  }

  // 5. Usage Tracking
  this.validateHeaderForSymbol(name, node);
  this.markRead(name);

  return symbol.type;
}

  // =========================================================================
  // Return Statement (FIX 9)
  // =========================================================================
  // =========================================================================
  // Helper: does every possible execution path in stmts end with a return?
  // =========================================================================
  private allPathsReturn(stmts: ASTNode[]): boolean {
    for (let i = stmts.length - 1; i >= 0; i--) {
      const s = stmts[i] as any;
      if (s.type === 'ReturnStatement') return true;
      if (s.type === 'ThrowStatement')  return true;
      if (s.type === 'IfStatement') {
        if (
          s.elseBranch && s.elseBranch.length > 0 &&
          this.allPathsReturn(s.thenBranch) &&
          this.allPathsReturn(s.elseBranch)
        ) return true;
      }
      if (s.type === 'SwitchStatement') {
        const cases: any[] = s.cases || [];
        const hasDefault = cases.some((c: any) => c.type === 'DefaultCase');
        if (hasDefault && cases.every((c: any) => this.allPathsReturn(c.statements))) return true;
      }
      if (s.type === 'TryStatement') {
        if (
          this.allPathsReturn(s.body) &&
          (s.handlers || []).every((h: any) => this.allPathsReturn(h.body))
        ) return true;
      }
    }
    return false;
  }

  private visitReturnStatement(node: ASTNode): string | null {
    const ret = node as ReturnStatementNode;
    const actualType = ret.value ? this.visit(ret.value) : 'void';

    if (this.returnDepth === 0) {
      this.functionHasTopLevelReturn = true;
    }

    if (this.currentFunction) {
      const expected = this.currentFunction.returnType;
      if (actualType && !this.isTypeCompatible(expected, actualType)) {
        this.addError(
          node,
          `Return type mismatch: function '${this.currentFunction.name}' expects '${expected}' but got '${actualType}'`,
          'error',
        );
      }
    }
    return actualType;
  }

  // =========================================================================
  // Literals
  // =========================================================================
  private visitInteger(_node: any): string { return 'int'; }
  private visitFloat(node: any): string {
    // In C++: 3.14 is double, 3.14f / 3.14F is float
    const raw = String(node.raw ?? node.suffix ?? node.value ?? '');
    return (raw.endsWith('f') || raw.endsWith('F')) ? 'float' : 'double';
  }
  private visitChar(_node: any):    string { return 'char'; }
  private visitString(_node: any):  string { return 'string'; }

  private visitLiteral(node: any): string {
    const val = String(node.value);
    if (val === 'true' || val === 'false') return 'bool';
    if (val.includes('.')) return 'float';
    return 'int';
  }

  // =========================================================================
  // Stream I/O
  // =========================================================================
  private visitCinStatement(node: ASTNode): string | null {
    const cin = node as any;

    // The grammar produces `targets` as either a single leaf (Identifier
    // string / ArrayAccess node) for `cin >> a`, or a left-folded BinaryOp
    // tree for chained `cin >> a >> b >> c`. Older code assumed it was
    // always an array and crashed with `targets.forEach is not a function`,
    // which halted the typechecker — and as a knock-on effect, swallowed
    // logs/symbols (PDF #13). Flatten any of these shapes into an array.
    const flatten = (n: any): Array<string | ASTNode> => {
      if (n == null) return [];
      if (Array.isArray(n)) return n.flatMap(flatten);
      if (typeof n === 'string') return [n];
      if (n.type === 'BinaryOp' && (n.operator === '>>' || n.operator === '<<')) {
        return [...flatten(n.left), ...flatten(n.right)];
      }
      return [n];
    };
    const targets: Array<string | ASTNode> = cin.targets
      ? flatten(cin.targets)
      : (cin.target ? [cin.target] : []);

    targets.forEach(target => {
      if (typeof target === 'string') {
        const symbol = this.lookupSymbol(target);
        if (symbol) {
          if ((symbol as ExtendedSymbolInfo).isConst) {
            this.addError(node, `Cannot read into const variable '${target}'`, 'error');
          }
          symbol.initialized = true;
          this.markWrite(target, cin.line || 0);
          this.markRead(target);
        } else {
          this.addError(node, `Undeclared variable '${target}' in cin`);
        }
      } else if ((target as ASTNode).type === 'ArrayAccess') {
        const aa = target as any;
        const symbol = this.lookupSymbol(aa.name);
        if (!symbol) {
          this.addError(node, `Undeclared array '${aa.name}' in cin`);
        } else {
          this.markWrite(aa.name, cin.line || 0);
          this.markRead(aa.name);
        }
        (aa.indices || []).forEach((idx: ASTNode) => {
          const it = this.visit(idx);
          if (it && it !== 'int' && it !== 'long') {
            this.addError(idx, `Array index must be integer, got '${it}'`);
          }
        });
      }
    });
    return null;
  }

  private visitCoutStatement(node: any): string | null {
    // Parser may emit values as a BinaryOp tree (chained <<) or as an array
    if (Array.isArray(node.values)) {
      node.values.forEach((v: ASTNode) => this.visit(v));
    } else if (node.values) {
      this.visit(node.values);
    }
    return 'ostream';
  }

  // =========================================================================
  // Preprocessor node visitors
  // =========================================================================
  private visitInclude(node: any): string | null {
    const name = node.name as string;
    // Track for header-requirement validation (Phase 4)
    if (name) this.includedHeaders.add(name);
    if (name && /^(iostream|iomanip|string|cmath|fstream|vector|algorithm)\.h$/.test(name)) {
      this.addError(node, `Use <${name.replace('.h', '')}> instead of <${name}> in modern C++.`, 'warning');
    }
    const validHeaders =
      /^(iostream|string|vector|cmath|algorithm|iomanip|cstdio|cstdlib|cstring|fstream|ctime|climits|cctype|cassert|numeric|sstream|stdexcept)$/;
    if (name && node.isSystem && !validHeaders.test(name)) {
      this.addError(node, `Header <${name}> is not in the standard CP1/CP2 syllabus.`, 'warning');
    }
    if (name === 'math.h') {
      // math.h is also acceptable for cmath — add both so functions pass
      this.includedHeaders.add('cmath');
      this.addError(node, 'Prefer <cmath> over <math.h> in C++.', 'warning');
    }
    return null;
  }

  private visitDefine(node: any): string | null {
    if (
      node.value &&
      typeof node.value === 'string' &&
      (node.value.includes('=') || node.value.includes(';'))
    ) {
      this.addError(node, "#define macros must not contain '=' or ';'.", 'error');
    }
    if (node.name && node.name !== node.name.toUpperCase()) {
      this.addError(node, 'Convention: macro names should be ALL_CAPS.', 'warning');
    }
    this.addSymbol(node.name, 'macro', node.line || 0, true, undefined, true, 'variable');
    return null;
  }

  private visitNamespace(node: any): string | null {
    if (node.name !== 'std') {
      this.addError(
        node,
        `Unexpected namespace '${node.name}'. Only 'std' is expected in CP1/CP2.`,
        'warning',
      );
    }
    return null;
  }



  // =========================================================================
  // Header-usage validation — fires after symbol lookup
  // =========================================================================
  private validateHeaderForSymbol(name: string, node: any): void {
    const required = this.HEADER_REQUIREMENTS[name];
    if (!required) return;
    if (!this.includedHeaders.has(required)) {
      this.addError(
        node,
        `Missing preprocessor directive: '${name}' requires '#include <${required}>'`,
        'error',
      );
    }
  }

  private validateHeaderForType(type: string, node: any): void {
    const baseType = type
      .replace(/\b(const|constexpr|static|extern|volatile|unsigned|signed|inline|virtual)\b/g, '')
      .replace(/[*&]/g, '')
      .trim();
    if (baseType) this.validateHeaderForSymbol(baseType, node);
  }

  // =========================================================================
  // Exception Handling  (try / catch / throw)
  // =========================================================================
  private visitTryStatement(node: any): string | null {
    this.enterScope('try');
    (node.body || []).forEach((s: any) => this.visit(s));
    this.exitScope();
    (node.handlers || []).forEach((h: any) => this.visitCatchClause(h));
    return null;
  }

  private visitCatchClause(node: any): string | null {
    this.enterScope('catch');
    if (node.param?.type === 'CatchParam' && node.param.name) {
      this.addSymbol(node.param.name, node.param.varType, node.line || 0, true, undefined, true, 'parameter');
    }
    (node.body || []).forEach((s: any) => this.visit(s));
    this.exitScope();
    return null;
  }

  private visitThrowStatement(node: any): string | null {
    if (node.value) this.visit(node.value);
    return 'void';
  }

  // =========================================================================
  // Range-Based For Loop  (C++11)
  // =========================================================================
  private visitRangeBasedFor(node: any): string | null {
  this.visit(node.range);
  this.loopDepth++;
  this.enterScope('range-for');
  this.addSymbol(node.name, node.varType, node.line || 0, true, undefined, true, 'variable');
  this.markRead(node.name); // ADD THIS LINE — the range loop implicitly uses the var
  (node.body || []).forEach((s: any) => this.visit(s));
  this.exitScope();
  this.loopDepth--;
  return null;
}

  // Preprocessor no-ops
  private visitUndef(_n: any):    string | null { return null; }
  private visitIfDef(_n: any):    string | null { return null; }
  private visitIfNDef(_n: any):   string | null { return null; }
  private visitIf(node: any):     string | null { if (node.condition) this.visit(node.condition); return null; }
  private visitElIf(node: any):   string | null { if (node.condition) this.visit(node.condition); return null; }
  private visitElse(_n: any):     string | null { return null; }
  private visitEndIf(_n: any):    string | null { return null; }
  private visitPragma(_n: any):   string | null { return null; }
  private visitError(node: any):  string | null { this.addError(node, `Preprocessor error: ${node.message}`, 'error'); return null; }
  private visitWarning(node: any): string | null { this.addError(node, `Preprocessor warning: ${node.message}`, 'warning'); return null; }
  private visitLine(_n: any):     string | null { return null; }
  private visitDefined(_n: any):  string | null { return 'bool'; }
  private visitMacroText(_n: any): string | null { return 'unknown'; }
  private visitFunctionPrototypeNode(_n: any): string | null { return null; } // alias safety

  // =========================================================================
  // Redundant-assignment & usage tracking
  // =========================================================================
  private markWrite(name: string, line: number): void {
  const full = this.getFullyScopedName(name);
  if (!full) return;
  
  const sym = this.symbolTable[full];
  const isParameter = sym && (sym as any).kind === 'parameter';

  if (this.dirtyAssignment.has(full)) {
    const prev = this.dirtyAssignment.get(full)!;
    this.addError(
      { line } as any,
      `Redundant assignment: Value in '${name}' ${isParameter ? '(passed as argument) ' : ''}was overwritten on line ${line} before being used.`,
      'warning',
    );
  }
  
  this.dirtyAssignment.set(full, { line, overwritten: true });
}

  private markRead(name: string): void {
    const full = this.getFullyScopedName(name);
    if (!full) return;
    this.dirtyAssignment.delete(full);
    this.usageTracker.set(full, (this.usageTracker.get(full) || 0) + 1);
  }

  // FIX 13: Skip parameter entries — they receive implicit usage credits
  private performDeadCodeAnalysis(): void {
    Object.keys(this.symbolTable).forEach(fullName => {
      const symbol = this.symbolTable[fullName];
      if (symbol.name === 'main') return;
      if (symbol.scope === 'global') return;
      if (symbol.kind === 'parameter') return;

      const uses = this.usageTracker.get(fullName) || 0;
      if (uses === 0) {
        const label = symbol.kind.charAt(0).toUpperCase() + symbol.kind.slice(1);
        this.addError(
          { line: symbol.line } as any,
          `Unused ${label}: '${symbol.name}' is declared but never used`,
          'warning',
        );
      }
    });
  }

  private validateCalledFunctionDefinitions(): void {
    Object.entries(this.symbolTable).forEach(([fullName, symbol]) => {
      if (symbol.kind !== 'function') return;
      if (symbol.name === 'main') return;
      if ((symbol as ExtendedSymbolInfo).isDefined !== false) return;
      const uses = this.usageTracker.get(fullName) || 0;
      if (uses === 0) return;
      this.addError(
        { line: symbol.line } as any,
        `Function '${symbol.name}' is declared as a prototype but has no definition.`,
        'error',
      );
    });
  }

  private getFullyScopedName(name: string): string | null {
  for (let i = this.scopeStack.length - 1; i >= 0; i--) {
    const scope = this.scopeStack.slice(0, i + 1).join('::');
    const key = `${scope}::${name}`;
    if (this.symbolTable[key]) return key;
  }
  
  // NEW: Check global if not found in current stacks
  const globalKey = `global::${name}`;
  if (this.symbolTable[globalKey]) return globalKey;

  return null;
}

  // =========================================================================
  // Scope helpers
  // =========================================================================
  private enterScope(name: string): void {
    this.scopeStack.push(name);
    this.currentScope = this.scopeStack.join('::');
  }

  private exitScope(): void {
    this.scopeStack.pop();
    this.currentScope = this.scopeStack.join('::');
  }

  // =========================================================================
  // Symbol table helpers
  // =========================================================================
  private addSymbol(
    name: string,
    type: string,
    line: number,
    initialized: boolean,
    dimensions?: number[],
    isDefined: boolean = true,
    kind: 'function' | 'variable' | 'parameter' = 'variable',
    isConst: boolean = false,
  ): void {
    if (name === 'true' || name === 'false') {
      this.addError({ line } as any, `Cannot use reserved keyword '${name}' as an identifier`);
      return;
    }

    const scopedName = `${this.currentScope}::${name}`;

    if (this.symbolTable[scopedName]) {
      const existing = this.symbolTable[scopedName];
      if (existing.isDefined === false && isDefined) {
        existing.isDefined = true;
        return;
      }
      this.addError(
        { line, type: 'VariableDecl' } as any,
        `${isDefined ? 'Redefinition' : 'Redeclaration'} of '${name}' (previously on line ${existing.line})`,
      );
      return;
    }

    // Scope shadowing is a hard ERROR (prevents confusing bugs)
    for (let i = this.scopeStack.length - 2; i >= 0; i--) {
      const parent = this.scopeStack.slice(0, i + 1).join('::');
      const parentKey = `${parent}::${name}`;
      if (this.symbolTable[parentKey]) {
        this.addError(
          { line, type: 'VariableDecl' } as any,
          `Variable '${name}' shadows a declaration from an outer scope (line ${this.symbolTable[parentKey].line})`,
          'error',
        );
        break;
      }
    }

    const entry: ExtendedSymbolInfo = {
      name, type, line, scope: this.currentScope,
      initialized, dimensions, isDefined, kind, isConst,
    };
    this.symbolTable[scopedName] = entry as SymbolInfo;
  }

  private getDimensionSizes(dimensions?: ASTNode[]): number[] {
    if (!Array.isArray(dimensions)) return [];
    return dimensions.map((dim: any) => {
      if (!dim) return 0;
      if (typeof dim.value === 'number') return dim.value;
      const literal = Number(dim.value);
      return Number.isFinite(literal) ? literal : 0;
    });
  }

  private arrayDimensionsCompatible(expected: number[], actual: number[], definitionCheck: boolean): boolean {
    if (expected.length !== actual.length) return false;
    return expected.every((expectedSize, index) => {
      const actualSize = actual[index] ?? 0;
      if (expectedSize === 0 || actualSize === 0) return true;
      if (!definitionCheck && index === 0) return true;
      return expectedSize === actualSize;
    });
  }

  private lookupSymbol(name: string): SymbolInfo | null {
  // 1. Search up the scope stack (local variables, parameters, etc.)
  for (let i = this.scopeStack.length - 1; i >= 0; i--) {
    const scope = this.scopeStack.slice(0, i + 1).join('::');
    const key = `${scope}::${name}`;
    if (this.symbolTable[key]) return this.symbolTable[key];
  }

  // 2. NEW: Explicitly check the global standard library namespace
  const globalKey = `global::${name}`;
  if (this.symbolTable[globalKey]) return this.symbolTable[globalKey];

  return null;
}
  // =========================================================================
  // FIX 16 helper — checks if a body has any break / return / exit() call
  // that could terminate the loop, preventing a false-positive infinite-loop warning
  // =========================================================================
  private bodyHasExit(body: ASTNode[]): boolean {
    const walk = (nodes: ASTNode[]): boolean => {
      for (const n of nodes) {
        const a = n as any;
        if (n.type === 'ReturnStatement' || n.type === 'ThrowStatement') return true;
        if (n.type === 'LoopControl' && a.value === 'break') return true;
        if (n.type === 'FunctionCall' && a.name === 'exit') return true;
        if (n.type === 'ExpressionStatement' && a.expression) {
          if (walk([a.expression])) return true;
        }
        if (n.type === 'IfStatement') {
          if (walk(a.thenBranch || [])) return true;
          if (walk(a.elseBranch || [])) return true;
        }
        if (['WhileLoop','DoWhileLoop','ForLoop','Block'].includes(n.type)) {
          if (walk(a.body || a.statements || [])) return true;
        }
      }
      return false;
    };
    return walk(body);
  }

  // =========================================================================
  // FIX 16 helper — extract variable names from a condition expression
  // =========================================================================
  private extractVariablesFromNode(node: any): Set<string> {
    const vars = new Set<string>();
    const walk = (n: any) => {
      if (!n) return;
      if (n.type === 'Identifier') vars.add(n.name);
      if (n.left) walk(n.left);
      if (n.right) walk(n.right);
      if (n.operand) walk(n.operand);
    };
    walk(node);
    return vars;
  }

  // FIX 16 helper — extract all variables modified in a statement list
  private extractModifiedVariables(body: ASTNode[]): Set<string> {
    const s = new Set<string>();
    const walk = (nodes: ASTNode[]) => {
      nodes.forEach(n => {
        const any = n as any;
        switch (n.type) {
          case 'Assignment':
            if (typeof any.target === 'string') s.add(any.target);
            else if (any.target?.name) s.add(any.target.name);
            break;
          case 'PreIncrement': case 'PostIncrement':
          case 'PreDecrement': case 'PostDecrement': {
            const nm = typeof any.operand === 'string' ? any.operand : any.operand?.name;
            if (nm) s.add(nm);
            break;
          }
          case 'ExpressionStatement':
            if (any.expression) walk([any.expression]);
            break;
          case 'Block':
            if (Array.isArray(any.statements)) walk(any.statements);
            break;
          case 'IfStatement':
            if (Array.isArray(any.thenBranch)) walk(any.thenBranch);
            if (Array.isArray(any.elseBranch)) walk(any.elseBranch);
            break;
          case 'WhileLoop': case 'DoWhileLoop': case 'ForLoop':
            if (Array.isArray(any.body)) walk(any.body);
            break;
        }
      });
    };
    walk(body);
    return s;
  }

  // =========================================================================
  // Type compatibility & promotion helpers
  // =========================================================================
private isTypeCompatible(target: string, source: string, sourceNode?: any): boolean {
  // Step 1: Strip ALL whitespace, then normalize references and const
  const stripRef = (t: string) =>
    t.replace(/\s+/g, '')       // remove all spaces first: "int &" → "int&"
     .replace(/&+$/, '')        // remove trailing &:        "int&"  → "int"
     .replace(/^const/, '');    // remove leading const:     "constint" → "int"

  const tBase = stripRef(target);
  const sBase = stripRef(source);

  // Step 2: Fast path — normalized bases match
  if (tBase === sBase) return true;

  // Step 3: unknown is always compatible
  if (tBase === 'unknown' || sBase === 'unknown') return true;

  // Step 4: Pointer compatibility
  if (tBase.endsWith('*')) {
    if (sBase === 'nullptr_t') return true;
    if (sBase === 'int' && sourceNode?.type === 'Integer' && sourceNode.value === 0) return true;
    if (tBase === 'void*' && sBase.endsWith('*')) return true;
  }

  // Step 5: Bool contextual conversion
  if (tBase === 'bool') return this.isContextuallyConvertibleToBool(sBase);

  // Step 6: Numeric promotion / narrowing (use normalized bases)
  const numWeight: Record<string, number> = {
    char: 1, short: 1.5, int: 2, long: 2.5, float: 3, double: 4,
  };
  if (numWeight[tBase] !== undefined && numWeight[sBase] !== undefined) {
    if (numWeight[tBase] >= numWeight[sBase]) return true;
    this.addError(
      sourceNode,
      `Possible data loss: assigning '${source}' to '${target}' (narrowing conversion).`,
      'warning',
    );
    return true;
  }

  return false;
}
  private isContextuallyConvertibleToBool(type: string): boolean {
    if (['bool', 'int', 'char', 'long', 'short', 'float', 'double'].includes(type)) return true;
    if (type.endsWith('*') || type === 'nullptr_t') return true;
    if (type.startsWith('enum:')) return true;
    return false;
  }

  private isNumericType(type: string): boolean {
    if (!type) return false;
    // Strip reference / pointer / cv qualifiers — `int&`, `const int`,
    // `unsigned int` should all be considered numeric for arithmetic checks.
    // Without this, parameters declared `int &n` mis-flag `n++` as
    // "non-numeric" because the underlying type carries the `&` suffix.
    const base = type
      .replace(/[*&\s]+$/g, '')             // trailing *, &, whitespace
      .replace(/^(const|static|volatile|unsigned|signed|mutable|extern|inline)\s+/g, '')
      .trim();
    return ['int', 'float', 'double', 'char', 'long', 'short',
            'long long', 'unsigned int', 'unsigned long', 'unsigned long long',
            'size_t', 'ptrdiff_t'].includes(base);
  }

  private isIntegralType(type: string): boolean {
    if (!type) return false;
    const base = type
      .replace(/[*&\s]+$/g, '')
      .replace(/^(const|static|volatile|unsigned|signed|mutable|extern|inline)\s+/g, '')
      .trim();
    return ['int', 'char', 'long', 'short', 'bool', 'long long', 'size_t', 'ptrdiff_t'].includes(base);
  }

  private isComparable(left: string, right: string): boolean {
    if (this.isNumericType(left) && this.isNumericType(right)) return true;
    if (left === right) return true;
    if (left === 'string' && right === 'string') return true;
    if (
      (left.endsWith('*') && right === 'nullptr_t') ||
      (right.endsWith('*') && left === 'nullptr_t')
    ) return true;
    // Pointer types are comparable to numeric types and to each other (C/C++ pointer arithmetic).
    // This also gracefully handles the grammar artifact where "&&" can be mis-parsed
    // as bitwise-& + address-of, producing 'int*' on the left of a comparison.
    if (left.endsWith('*') && (this.isNumericType(right) || right.endsWith('*'))) return true;
    if (right.endsWith('*') && (this.isNumericType(left) || left.endsWith('*'))) return true;
    return false;
  }

  private promoteType(left: string, right: string): string {
    if (left === 'double' || right === 'double') return 'double';
    if (left === 'float' || right === 'float') return 'float';
    if (left === 'long' || right === 'long') return 'long';
    return 'int';
  }

  // =========================================================================
  // Error helper
  // =========================================================================
  private addError(node: any, message: string, severity: 'error' | 'warning' = 'error'): void {
    this.errors.push({
      type: 'semantic',
      message,
      line: node?.line || node?.location?.start?.line || 0,
      column: node?.column || node?.location?.start?.column || 0,
      severity,
    });
  }
}
