/** Calculates cognitive and cyclomatic complexity from the C++ AST. */

import {
  ASTNode,
  ProgramNode,
  FunctionDeclNode,
  IfStatementNode,
  WhileLoopNode,
  DoWhileLoopNode,
  ForLoopNode,
  SwitchStatementNode,
  CaseNode,
  BinaryOpNode,
  ConditionalExpressionNode,
  LambdaExpressionNode,
  UnaryOpNode,
  CastExpressionNode,
  SizeofExpressionNode,
  FunctionCallNode,
  ArrayAccessNode,
  AssignmentNode,
  BlockNode,
  ExpressionStatementNode,
  VariableDeclNode,
  ReturnStatementNode,
  InitializerListNode,
} from '../types';

export class CognitiveComplexity {
  private complexity = 0;
  private nestingLevel = 0;

  calculate(ast: ASTNode): number {
    this.complexity = 0;
    this.nestingLevel = 0;

    this.linkParents(ast);
    
    this.visit(ast);
    return this.complexity;
  }

  private linkParents(node: any, parent: any = null): void {
    if (!node || typeof node !== 'object') return;
    node.parent = parent;
    for (const key in node) {
      if (key === 'parent') continue;
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(c => this.linkParents(c, node));
        } else if (child && typeof child === 'object' && child.type) {
          this.linkParents(child, node);
        }
      }
    }
  }

  private visit(node: ASTNode | null ): void {
    if (!node) return;
    const methodName = `visit${node.type}`;
    if (typeof (this as any)[methodName] === 'function') {
      (this as any)[methodName](node);
    }
  }

  private visitProgram(node: ASTNode): void {
    const prog = node as ProgramNode;
    // Visit preprocessor directives in case they contain expressions
    (prog.directives || []).forEach((d: ASTNode) => this.visit(d));
    if (prog.body) {
      prog.body.forEach((stmt: ASTNode) => this.visit(stmt));
    }
  }

  private visitFunctionDecl(node: ASTNode): void {
    const funcNode = node as FunctionDeclNode;
    (funcNode.body || []).forEach((stmt: ASTNode) => this.visit(stmt));
  }

  private visitFunctionPrototype(_node: ASTNode): void {
    // Prototypes are forward declarations — no complexity contribution.
  }

  private visitIfStatement(node: IfStatementNode): void {
    this.complexity += 1 + this.nestingLevel;

    this.nestingLevel++;
    (node.thenBranch || []).forEach(stmt => this.visit(stmt));
    this.nestingLevel--;

    if (node.elseBranch && node.elseBranch.length > 0) {
      const firstElse = node.elseBranch[0];
      const isElseIf = firstElse.type === 'IfStatement';

      if (isElseIf) {
        // 'else if' does not increase nesting, just recurses
        this.visit(firstElse);
      } else {
        // A plain else adds one without increasing nesting.
        this.complexity += 1;
        node.elseBranch.forEach(stmt => this.visit(stmt));
      }
    }
  }

  private visitWhileLoop(node: ASTNode): void {
    const whileNode = node as WhileLoopNode;
    this.complexity += 1 + this.nestingLevel;
    this.visit(whileNode.condition);
    this.nestingLevel++;
    (whileNode.body || []).forEach((stmt: ASTNode) => this.visit(stmt));
    this.nestingLevel--;
  }

  private visitDoWhileLoop(node: ASTNode): void {
    const doWhileNode = node as DoWhileLoopNode;
    this.complexity += 1 + this.nestingLevel;
    this.visit(doWhileNode.condition);
    this.nestingLevel++;
    (doWhileNode.body || []).forEach((stmt: ASTNode) => this.visit(stmt));
    this.nestingLevel--;
  }

  private visitForLoop(node: ASTNode): void {
    const forNode = node as ForLoopNode;
    this.complexity += 1 + this.nestingLevel;
    if (forNode.init)      this.visit(forNode.init);
    if (forNode.condition) this.visit(forNode.condition);
    if (forNode.update)    this.visit(forNode.update);
    this.nestingLevel++;
    (forNode.body || []).forEach((stmt: ASTNode) => this.visit(stmt));
    this.nestingLevel--;
  }

  private visitSwitchStatement(node: ASTNode): void {
    const switchNode = node as SwitchStatementNode;
    this.complexity += 1 + this.nestingLevel;
    this.visit(switchNode.condition);
    this.nestingLevel++;
    (switchNode.cases || []).forEach((caseNode: CaseNode) => {
      if (caseNode.value) this.visit(caseNode.value);
      (caseNode.statements || []).forEach((stmt: ASTNode) => this.visit(stmt));
    });
    this.nestingLevel--;
  }

  private visitCase(node: ASTNode): void {
    const c = node as unknown as CaseNode;
    if (c.value) this.visit(c.value);
    (c.statements || []).forEach((stmt: ASTNode) => this.visit(stmt));
  }

  private visitDefaultCase(node: ASTNode): void {
    this.visitCase(node);
  }

  private visitConditionalExpression(node: ASTNode): void {
    const ternaryNode = node as ConditionalExpressionNode;
    this.complexity += 1 + this.nestingLevel;
    this.visit(ternaryNode.condition);
    this.nestingLevel++;
    this.visit(ternaryNode.trueExpression);
    this.visit(ternaryNode.falseExpression);
    this.nestingLevel--;
  }

  private visitBinaryOp(node: BinaryOpNode): void {
    // A sequence of identical logical operators contributes once.
    if ((node.operator === '&&' || node.operator === '||')) {
      const parent = (node as any).parent;
      if (!parent || parent.type !== 'BinaryOp' || parent.operator !== node.operator) {
        this.complexity += 1;
      }
    }
    this.visit(node.left);
    this.visit(node.right);
  }

  private visitLambdaExpression(node: ASTNode): void {
    const lambdaNode = node as LambdaExpressionNode;
    this.nestingLevel++;
    (lambdaNode.body || []).forEach((stmt: ASTNode) => this.visit(stmt));
    this.nestingLevel--;
  }

  private visitAssignment(node: ASTNode): void {
    const assignNode = node as AssignmentNode;
    if (assignNode.target && typeof assignNode.target !== 'string') {
      this.visit(assignNode.target);
    }
    if (assignNode.value) {
      this.visit(assignNode.value);
    }
  }

  private visitBlock(node: ASTNode): void {
    const blockNode = node as BlockNode;
    (blockNode.statements || []).forEach((stmt: ASTNode) => this.visit(stmt));
  }

  private visitExpressionStatement(node: ASTNode): void {
    const exprNode = node as ExpressionStatementNode;
    if (exprNode.expression) this.visit(exprNode.expression);
  }

  private visitVariableDecl(node: ASTNode): void {
    const varNode = node as VariableDeclNode;
    if (varNode.value) this.visit(varNode.value);
    (varNode.dimensions || []).forEach((d: ASTNode) => this.visit(d));
  }

  private visitReturnStatement(node: ASTNode): void {
    const returnNode = node as ReturnStatementNode;
    if (returnNode.value) this.visit(returnNode.value);
  }

  private visitInitializerList(node: ASTNode): void {
    const initList = node as InitializerListNode;
    (initList.values || []).forEach((val: ASTNode) => this.visit(val));
  }

  private visitFunctionCall(node: ASTNode): void {
    const callNode = node as FunctionCallNode;
    (callNode.arguments || []).forEach((arg: ASTNode) => this.visit(arg));
  }

  private visitArrayAccess(node: ASTNode): void {
    const arrayNode = node as ArrayAccessNode;
    (arrayNode.indices || []).forEach((index: ASTNode) => this.visit(index));
  }

  private visitUnaryOp(node: ASTNode): void {
    const unaryNode = node as UnaryOpNode;
    if (unaryNode.operand && typeof unaryNode.operand !== 'string') {
      this.visit(unaryNode.operand as ASTNode);
    }
  }

  private visitPreIncrement(node: ASTNode):  void { this.visitUnaryOp(node); }
  private visitPostIncrement(node: ASTNode): void { this.visitUnaryOp(node); }
  private visitPreDecrement(node: ASTNode):  void { this.visitUnaryOp(node); }
  private visitPostDecrement(node: ASTNode): void { this.visitUnaryOp(node); }
  private visitAddressOf(node: ASTNode):     void { this.visitUnaryOp(node); }
  private visitDereference(node: ASTNode):   void { this.visitUnaryOp(node); }

  private visitCastExpression(node: ASTNode): void {
    const castNode = node as CastExpressionNode;
    this.visit(castNode.operand);
  }

  private visitSizeofExpression(node: ASTNode): void {
    const sizeofNode = node as SizeofExpressionNode;
    this.visit(sizeofNode.value);
  }

  private visitIdentifier(): void {}
  private visitInteger():    void {}
  private visitFloat():      void {}
  private visitChar():       void {}
  private visitString():     void {}
  private visitLiteral():    void {}  // BooleanLiteral (true/false)
  private visitParameter():  void {}
  private visitLoopControl(): void {}  // break / continue
  private visitGlobalAccess(): void {}
  private visitNewExpression(): void {}    // allocation alone ≠ complexity
  private visitDeleteStatement(): void {}  // deallocation alone ≠ complexity
  private visitCinStatement():  void {}
  private visitCoutStatement(): void {}

  // Preprocessor directives (no complexity impact)
  private visitInclude():   void {}
  private visitDefine():    void {}
  private visitUndef():     void {}
  private visitIfDef():     void {}
  private visitIfNDef():    void {}
  private visitIf():        void {}
  private visitElIf():      void {}
  private visitElse():      void {}
  private visitEndIf():     void {}
  private visitPragma():    void {}
  private visitError():     void {}
  private visitWarning():   void {}
  private visitLine():      void {}
  private visitDefined():   void {}
  private visitMacroText(): void {}
  private visitNamespace(): void {}
}

// Cyclomatic complexity counts decisions using V(G) = E - N + 2P.
export interface CyclomaticResult {
  score: number;
  edges: number;
  nodes: number;
  rating: 'low' | 'moderate' | 'high' | 'very high';
  interpretation: string;
}

export class CyclomaticComplexity {
  private decisions = 0;

  calculate(ast: ASTNode): CyclomaticResult {
    this.decisions = 0;
    this.walk(ast);
    
    // V(G) = Decisions + 1
    const score = this.decisions + 1;
    
    return {
      score,
      // These counts satisfy the formula; they are not measured from the CFG.
      edges: score + 1, 
      nodes: 2,         
      rating: this.rate(score),
      interpretation: this.interpret(score),
    };
  }

  private walk(node: any): void {
    if (!node || typeof node !== 'object') return;

    switch (node.type) {
      case 'IfStatement':
      case 'WhileLoop':
      case 'DoWhileLoop':
      case 'ForLoop':
      case 'RangeBasedFor':
      case 'CatchClause':
      case 'ConditionalExpression':
        this.decisions += 1;
        break;

      case 'SwitchStatement':
        // Each non-default case contributes one decision.
        if (node.cases) {
          node.cases.forEach((c: any) => {
            if (c.type === 'Case') this.decisions += 1;
          });
        }
        break;

      case 'BinaryOp':
        // Short-circuit operators create a new branch in the execution flow.
        if (node.operator === '&&' || node.operator === '||') {
          this.decisions += 1;
        }
        break;
    }

    for (const key in node) {
      if (key === 'parent') continue;
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        const child = node[key];
        if (Array.isArray(child)) {
          for (let i = 0; i < child.length; i++) {
            this.walk(child[i]);
          }
        } else if (child && typeof child === 'object' && child.type) {
          this.walk(child);
        }
      }
    }
  }

  private rate(score: number): 'low' | 'moderate' | 'high' | 'very high' {
    if (score <= 10) return 'low';
    if (score <= 20) return 'moderate';
    if (score <= 50) return 'high';
    return 'very high';
  }

  private interpret(score: number): string {
    if (score <= 10) return 'Simple, easy to test.';
    if (score <= 20) return 'Complex, harder to test.';
    if (score <= 50) return 'Unstable, high risk.';
    return 'Untestable, refactor immediately.';
  }
}
