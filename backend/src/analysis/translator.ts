/**
 * CodeSense Mentor (Translator) 
 * Explains C++ code in simple, student-friendly language.
 * Uses metaphors, real-world examples, and step-by-step breakdowns.
 */

import {
  ASTNode,
  VariableDeclNode,
  IfStatementNode,
  WhileLoopNode,
  ForLoopNode,
  AssignmentNode,
  FunctionDeclNode,
  FunctionPrototypeNode,
  ReturnStatementNode,
  ProgramNode,
  FunctionCallNode,
  DoWhileLoopNode,
  SwitchStatementNode,
  ExpressionStatementNode,
  ConditionalExpressionNode,
  CastExpressionNode,
  SizeofExpressionNode,
  UnaryOpNode,
  ArrayAccessNode,
  InitializerListNode,
  BinaryOpNode,
} from '../types';

export class Translator {
  private explanations: string[] = [];
  private indentLevel: number = 0;
  private currentFunctionName: string = '';
  /**
   * FIX (user bug #4): Many "💡 Mentor Tip" phrases were emitted once per
   * occurrence of their parent statement, so an else-if chain repeated the
   * same "Like choosing a path at a crossroads" line for every branch.
   * This set holds the text of every 💡 tip already emitted in the current
   * translate() call; pushTipOnce() uses it to skip duplicates.
   */
  private emittedTips: Set<string> = new Set();

  /** Push a tip (anything with 💡), but only the first time its text is seen
   *  within a single translate() call. Indentation is ignored for the key. */
  private pushTipOnce(line: string): void {
    const key = line.trim();
    if (this.emittedTips.has(key)) return;
    this.emittedTips.add(key);
    this.explanations.push(line);
  }

  private cleanName(name: any): string {
  if (!name) return 'unknown';
  if (typeof name === 'string') return name;
  if (name.type === 'Identifier') return name.name;
  if (Array.isArray(name)) return name.map(n => this.cleanName(n)).join('');
  return String(name);
}

  private indent(): string {
    return '  '.repeat(this.indentLevel);
  }

  translate(ast: ASTNode): string[] {
    this.explanations = [];
    this.indentLevel = 0;
    this.emittedTips = new Set(); // FIX #4: reset the tip-dedupe set per call
    this.visit(ast);
    return this.explanations;
  }

  private visit(node: ASTNode | null | string | undefined): void {
    // 1. Basic safety check
    if (!node || typeof node === 'string') return;

    // 2. Handle known edge cases where types might be weirdly formatted
    // (This ensures Cout and Cin are always caught)
    if (node.type === 'CoutStatement') return this.visitCoutStatement(node as any);
    if (node.type === 'CinStatement')  return this.visitCinStatement(node as any);

    // 3. Dynamic Dispatch: Try to find visitIfStatement, visitWhileLoop, etc.
    const methodName = `visit${node.type}`;
    
    if (typeof (this as any)[methodName] === 'function') {
        (this as any)[methodName](node);
    } 
    else {
        // 4. Fallback: If no specific visitor exists, look for children to continue the walk.
        // C++ ASTs often use 'body', 'statements', or 'declarations'
        const children = (node as any).body || (node as any).statements || (node as any).declarations;

        if (Array.isArray(children)) {
            children.forEach((stmt: ASTNode) => this.visit(stmt));
        } else if (children && typeof children === 'object') {
            // Handle cases where body is a single node instead of an array
            this.visit(children);
        }
    }
}

  // =========================================================================
  //  PROGRAM STRUCTURE
  // =========================================================================

  private visitProgram(node: ProgramNode): void {
    this.explanations.push('🎬 **Your Program Starts Here**');
    this.explanations.push('');

    if (node.directives && node.directives.length > 0) {
      this.explanations.push("📚 **Libraries You're Using:**");
      node.directives.forEach(d => {
        const dn = d as any;
        if (dn.type === 'Include') {
          const name = dn.name as string;
          const desc = HEADER_DESCRIPTIONS[name] || name;
          this.explanations.push(`   • <${name}> — ${desc}`);
        }
      });
      this.explanations.push('');
    }

    if ((node as any).namespace) {
      this.explanations.push("🌐 **Namespace:** using namespace std;");
      this.explanations.push("   (Lets you write 'cout' instead of 'std::cout')");
      this.explanations.push('');
    }

    this.explanations.push('📖 **Step-by-Step Walkthrough:**');
    this.explanations.push('');

    node.body.forEach(stmt => this.visit(stmt));

    this.explanations.push('');
    this.explanations.push('✅ **Program Complete!**');
  }

  // =========================================================================
  //  Multiple Variable Declarations  int x=1, y=2;
  // =========================================================================
  private visitMultipleVariableDecl(node: any): void {
    (node.declarations || []).forEach((d: any) => this.visitVariableDecl(d));
  }

  // =========================================================================
  //  VARIABLES - The Storage Boxes
  // =========================================================================

  private visitVariableDecl(node: VariableDeclNode): void {
    const name = this.cleanName(node.name);
    const isConst = Array.isArray((node as any).modifiers) && (node as any).modifiers.includes('const');
    const isPtr   = node.varType.includes('*');
    const isArray = node.dimensions && node.dimensions.length > 0;

    // 1. Identify the "Storage Type"
    if (isConst) {
      this.explanations.push(`${this.indent()}❄️ **Constant (Frozen): '${name}'** (type: ${node.varType})`);
      this.explanations.push(`${this.indent()}   This value is locked! It cannot be changed after this line.`);
    } else if (isPtr) {
      this.explanations.push(`${this.indent()}📌 **Pointer: '${name}'** (type: ${node.varType})`);
      this.explanations.push(`${this.indent()}   This doesn't store data directly; it stores a **memory address** (like a GPS coordinate) pointing to data elsewhere.`);
    } else if (isArray) {
      const size = node.dimensions?.[0] ? this.formatExpr(node.dimensions[0]) : '?';
      this.explanations.push(`${this.indent()}📦 **Array: '${name}[${size}]'** (element type: ${node.varType})`);
      this.explanations.push(`${this.indent()}   Like a row of ${size} numbered lockers, each holding one ${node.varType}.`);
      this.pushTipOnce(`${this.indent()}   💡 *Mentor Tip: Remember that C++ starts counting at locker [0]!*`);
    } else {
      this.explanations.push(`${this.indent()}📦 **Variable: '${name}'** (type: ${node.varType})`);
    }

    // 2. Handle Initialization (The "Value" part)
    if (node.value) {
      const valueStr = this.formatExpr(node.value);
      this.explanations.push(`${this.indent()}   ✨ **Initialization:** The box is starting with the value: ${valueStr}`);
    } else {
      // Logic for uninitialized variables - a major source of C++ bugs
      this.explanations.push(`${this.indent()}   ⚠️ **Warning: Uninitialized!**`);
      this.explanations.push(`${this.indent()}   The box '${name}' is currently empty. In C++, it will contain "garbage data" (random leftovers in memory) until you assign it a value.`);
      
      if (isPtr) {
        this.explanations.push(`${this.indent()}   🛑 **DANGER:** Uninitialized pointers are risky. It's safer to set this to 'nullptr'!`);
      }
    }

    this.explanations.push('');
  }

  private visitAssignment(node: AssignmentNode): void {
    const target = typeof node.target === 'string'
      ? this.cleanName(node.target)
      : this.formatExpr(node.target as any);
    const value = this.formatExpr(node.value);
    const opLabel = COMPOUND_OP_LABELS[node.operator] || 'update';

    this.explanations.push(`${this.indent()}✏️  **${opLabel}: '${target}'**`);
    this.explanations.push(`${this.indent()}   New value: ${value}`);
    this.explanations.push('');
  }

  // =========================================================================
  //  FUNCTIONS - The Tasks
  // =========================================================================

  private visitFunctionPrototype(node: FunctionPrototypeNode): void {
    const name   = this.cleanName(node.name);
    const params = node.params.map((p: any) =>
      p.name ? `${p.varType} ${p.name}` : p.varType,
    ).join(', ');

    this.explanations.push(`${this.indent()}📢 **Function Announcement: '${name}'**`);
    this.explanations.push(`${this.indent()}   Parameters: ${params || 'none'}`);
    this.explanations.push(`${this.indent()}   Returns: ${node.returnType}`);
    this.explanations.push(`${this.indent()}   💡 This is a forward declaration — the full code comes later.`);
    this.explanations.push('');
  }

  private visitFunctionDecl(node: FunctionDeclNode): void {
    const name = this.cleanName(node.name);
    const prevFunctionName = this.currentFunctionName;
    this.currentFunctionName = name;
    const isMain = name === 'main';

    if (isMain) {
        this.explanations.push('🚀 **MAIN FUNCTION**');
        this.explanations.push('This is the entry point of your program.');
    } else {
        const params = (node.params || []).map((p: any) =>
            `${p.varType} ${p.name || '?'}`
        ).join(', ');
        this.explanations.push(`🔧 **FUNCTION: ${name}**`);
        this.explanations.push(`• **Inputs:** ${params || 'none'}`);
        this.explanations.push(`• **Returns:** ${node.returnType}`);
    }

    this.explanations.push(''); 
    this.explanations.push('📖 **Walkthrough:**');
    
    this.indentLevel++;
    // Check if body is an array or a single block object
    const statements = Array.isArray(node.body) ? node.body : (node.body as any)?.statements || [];
    
    if (statements.length > 0) {
        statements.forEach((stmt: ASTNode) => {
            // This will call visitVariableDecl, visitWhileLoop, etc.
            // Each of those will add their own emoji-led line.
            this.visit(stmt); 
        });
    } else {
        this.explanations.push(`${this.indent()}*(Empty function)*`);
    }
    this.indentLevel--;

    this.currentFunctionName = prevFunctionName;
}

  private visitFunctionCall(node: FunctionCallNode): void {
    const name     = this.cleanName(node.name);
    const argCount = node.arguments?.length || 0;

     if (name === this.currentFunctionName) {
    this.explanations.push(`${this.indent()}🔁 **Recursive Call: '${name}'**`);
    this.explanations.push(`${this.indent()}   This function is calling ITSELF.`);
    this.explanations.push(`${this.indent()}   ⚠️ Make sure there is a base case, or this will loop forever.`);
    if (argCount > 0) {
      const args = node.arguments.map(a => this.formatExpr(a)).join(', ');
      this.explanations.push(`${this.indent()}   Arguments passed: ${args}`);
    }
    this.explanations.push('');
    return;
  }

  this.explanations.push(`${this.indent()}📞 **Call: '${name}'**`);
  if (argCount > 0) {
    const args = node.arguments.map(a => this.formatExpr(a)).join(', ');
    this.explanations.push(`${this.indent()}   Arguments: ${args}`);
  }
  this.explanations.push('');
}

  private visitReturnStatement(node: ReturnStatementNode): void {
    if (node.value) {
      const value = this.formatExpr(node.value);
      this.explanations.push(`${this.indent()}↩️  **Return: ${value}**`);
      this.explanations.push(`${this.indent()}   Task complete! Handing back the result.`);
    } else {
      this.explanations.push(`${this.indent()}↩️  **Return** (void — no value handed back)`);
    }
    this.explanations.push('');
  }

  // =========================================================================
  //  CONTROL FLOW - Making Decisions
  // =========================================================================

  private visitIfStatement(node: IfStatementNode): void {
    const condition = this.formatExpr(node.condition);
    this.explanations.push(`${this.indent()}🤔 **Decision: Is ${condition} true?**`);
    this.explanations.push('');

    this.explanations.push(`${this.indent()}✅ **If YES:**`);
    this.indentLevel++;
    (node.thenBranch || []).forEach(stmt => this.visit(stmt));
    this.indentLevel--;

    if (node.elseBranch && node.elseBranch.length > 0) {
      this.explanations.push(`${this.indent()}❌ **If NO:**`);
      this.indentLevel++;
      node.elseBranch.forEach(stmt => this.visit(stmt));
      this.indentLevel--;
    }
    this.pushTipOnce(`${this.indent()}💡 Like choosing a path at a crossroads.`);
    this.explanations.push('');
  }

  private visitBinaryOp(node: BinaryOpNode): void {
    const expr = this.formatExpr(node);
    // Only add an explanation if it's a significant calculation (not just a simple assignment)
    if (this.indentLevel > 0) {
        this.explanations.push(`${this.indent()}🧮 **Calculating:** ${expr}`);
    }
  this.visit(node.left);
  this.visit(node.right);
}

  private visitWhileLoop(node: WhileLoopNode): void {
    const condition = this.formatExpr(node.condition);
    this.explanations.push(`${this.indent()}🔁 **The "Loop-De-Loop" (While Loop)**`);
    this.explanations.push(`${this.indent()}   1. First, I check: Is **${condition}** true?`);
    this.explanations.push(`${this.indent()}   2. If YES, I run the code inside.`);
    this.explanations.push(`${this.indent()}   3. Then I come right back here to check again!`);

    this.indentLevel++;
    // Defensive check: handle both Block nodes and raw arrays
    const statements = (node.body as any)?.statements || node.body;
    if (Array.isArray(statements)) {
        statements.forEach(stmt => this.visit(stmt));
    } else {
        this.visit(statements);
    }
    this.indentLevel--;
    
    this.explanations.push(`${this.indent()}   ↑ Then check condition again...`);
    this.explanations.push('');
}

  private visitDoWhileLoop(node: DoWhileLoopNode): void {
    const condition = this.formatExpr(node.condition);
    this.explanations.push(`${this.indent()}🔁 **Do-While Loop** (runs at least once)`);
    this.explanations.push('');

    this.explanations.push(`${this.indent()}🔄 **First, do these steps:**`);
    this.indentLevel++;
    (node.body || []).forEach(stmt => this.visit(stmt));
    this.indentLevel--;

    this.explanations.push(`${this.indent()}❓ **Repeat?** Check: ${condition}`);
    this.explanations.push(`${this.indent()}   If true → go back; If false → continue`);
    this.explanations.push('');
  }

  private visitForLoop(node: ForLoopNode): void {
    this.explanations.push(`${this.indent()}🔢 **For Loop (Counting Loop)**`);

    if (node.init)      this.explanations.push(`${this.indent()}   1️⃣  Start:      ${this.formatExpr(node.init)}`);
    if (node.condition) this.explanations.push(`${this.indent()}   2️⃣  While:      ${this.formatExpr(node.condition)}`);
    if (node.update)    this.explanations.push(`${this.indent()}   3️⃣  Each round: ${this.formatExpr(node.update)}`);
    this.explanations.push('');

    this.explanations.push(`${this.indent()}🔄 **Repeat:**`);
    this.indentLevel++;
    (node.body || []).forEach(stmt => this.visit(stmt));
    this.indentLevel--;
    this.explanations.push('');
  }

  private visitSwitchStatement(node: SwitchStatementNode): void {
    const condition = this.formatExpr(node.condition);
    this.explanations.push(`${this.indent()}🎯 **Switch (Menu Selection)**`);
    this.explanations.push(`${this.indent()}   Looking at the value of: ${condition}`);
    this.explanations.push('');

    node.cases.forEach((c, i) => {
      const label = c.value
        ? `If ${condition} == ${this.formatExpr(c.value)}`
        : 'Default (otherwise)';
      this.explanations.push(`${this.indent()}${i + 1}. **${label}:**`);
      this.indentLevel++;
      if (c.statements && c.statements.length > 0) {
        c.statements.forEach(stmt => this.visit(stmt));
      } else {
        this.explanations.push(`${this.indent()}(do nothing)`);
      }
      this.indentLevel--;
    });
    this.explanations.push('');
  }

  // =========================================================================
  //  CP2: Dynamic Memory
  // =========================================================================

  private visitNewExpression(node: any): void {
    const baseType = node.baseType;
    if (node.size) {
      const size = this.formatExpr(node.size);
      this.explanations.push(`${this.indent()}🆕 **Dynamic Array Allocation**`);
      this.explanations.push(`${this.indent()}   Reserves space for ${size} ${baseType} values on the heap.`);
      this.explanations.push(`${this.indent()}   ⚠️  Must be freed later with 'delete[]'!`);
    } else {
      this.explanations.push(`${this.indent()}🆕 **Dynamic Object Allocation (new ${baseType})**`);
      this.explanations.push(`${this.indent()}   Creates one ${baseType} object on the heap.`);
      this.explanations.push(`${this.indent()}   ⚠️  Must be freed later with 'delete'!`);
    }
    this.explanations.push('');
  }

  private visitDeleteStatement(node: any): void {
    const target = this.cleanName(node.target);
    if (node.isArray) {
      this.explanations.push(`${this.indent()}🗑️  **Free Dynamic Array: delete[] ${target}**`);
      this.explanations.push(`${this.indent()}   Returns all memory used by the array back to the system.`);
    } else {
      this.explanations.push(`${this.indent()}🗑️  **Free Dynamic Object: delete ${target}**`);
      this.explanations.push(`${this.indent()}   Returns memory for the single object back to the system.`);
    }
    this.pushTipOnce(`${this.indent()}   💡 After delete, the pointer is dangling — don't use it!`);
    this.explanations.push('');
  }

  // =========================================================================
  //  ARRAYS
  // =========================================================================

  private visitArrayAccess(node: ArrayAccessNode): void {
    const name    = this.cleanName(node.name);
    const indices = node.indices.map(i => this.formatExpr(i)).join('][');
    this.explanations.push(`${this.indent()}🔍 **Read Array Element: ${name}[${indices}]**`);
    this.explanations.push(`${this.indent()}   Accessing box number ${indices} inside '${name}'.`);
    this.pushTipOnce(`${this.indent()}   💡 Remember: C++ counts from **0**. So [0] is the 1st element, and [1] is the 2nd!`);
    this.explanations.push('');
  }

  private visitInitializerList(node: InitializerListNode): void {
    const values = (node.values || []).map(v => this.formatExpr(v)).join(', ');
    this.explanations.push(`${this.indent()}📋 **Initializer List: { ${values} }**`);
    this.explanations.push(`${this.indent()}   Fills multiple boxes at once with these values.`);
    this.explanations.push('');
  }

  // =========================================================================
  //  LOOP CONTROL
  // =========================================================================

  private visitLoopControl(node: any): void {
    if (node.value === 'break') {
      this.explanations.push(`${this.indent()}🛑 **break** — Exit the loop immediately`);
      this.explanations.push(`${this.indent()}   💡 Like pulling an emergency stop cord.`);
    } else if (node.value === 'continue') {
      this.explanations.push(`${this.indent()}⏭️  **continue** — Skip to the next loop iteration`);
      this.explanations.push(`${this.indent()}   💡 Like skipping a song and going to the next one.`);
    }
    this.explanations.push('');
  }

  // =========================================================================
  //  INPUT/OUTPUT - Talking to the User
  // =========================================================================

  // 1. Add this helper to your Translator class to handle the nested << chain
private flattenCout(node: any): string[] {
  if (!node) return [];
  
  // If it's a nested BinaryOp (the new structure from the grammar)
  if (node.type === 'BinaryOp' && node.operator === '<<') {
    return [
      ...this.flattenCout(node.left), 
      ...this.flattenCout(node.right)
    ];
  }
  
  // Base case: it's a single value (string, int, identifier)
  // Skip the actual word 'cout' or 'std::cout' so it doesn't show in the explanation
  const val = this.formatExpr(node);
  if (val === 'cout' || val === 'std::cout') return [];
  
  return [val];
}

// 2. Update the visitCoutStatement to use the helper
private visitCoutStatement(node: any): void {
  const items = this.flattenCout(node.values);
  const outputs = items.length > 0 ? items.join(' ⟩⟩ ') : 'something';
  
  this.explanations.push(`${this.indent()}🖥️  **Output to Screen**`);
  this.explanations.push(`${this.indent()}   Displays: ${outputs}`);
  this.explanations.push('');
}

  private visitCinStatement(node: any): void {
    const targetNames = node.targets
      ? node.targets.map((t: any) =>
          typeof t === 'string' ? t : this.cleanName(t.name),
        ).join(', ')
      : 'a variable';
    this.explanations.push(`${this.indent()}⌨️  **Input from User**`);
    this.explanations.push(`${this.indent()}   Waits for keyboard input → stored in: ${targetNames}`);
    this.explanations.push('');
  }

  // =========================================================================
  //  BLOCK
  // =========================================================================

  private visitBlock(node: any): void {
    (node.statements || []).forEach((s: ASTNode) => this.visit(s));
  }

  private visitExpressionStatement(node: ExpressionStatementNode): void {
    if (node.expression) this.visit(node.expression);
  }

  // =========================================================================
  //  ADVANCED OPERATORS
  // =========================================================================

  private visitPreIncrement(node: UnaryOpNode): void {
    const v = this.cleanName(node.operand);
    this.explanations.push(`${this.indent()}⬆️  **++${v}** — Add 1 to ${v} FIRST, then use it`);
    this.explanations.push('');
  }

  private visitPostIncrement(node: UnaryOpNode): void {
    const v = this.cleanName(node.operand);
    this.explanations.push(`${this.indent()}⬆️  **${v}++** — Use ${v}'s current value FIRST, then add 1`);
    this.explanations.push('');
  }

  private visitPreDecrement(node: UnaryOpNode): void {
    const v = this.cleanName(node.operand);
    this.explanations.push(`${this.indent()}⬇️  **--${v}** — Subtract 1 from ${v} FIRST, then use it`);
    this.explanations.push('');
  }

  private visitPostDecrement(node: UnaryOpNode): void {
    const v = this.cleanName(node.operand);
    this.explanations.push(`${this.indent()}⬇️  **${v}--** — Use ${v}'s current value FIRST, then subtract 1`);
    this.explanations.push('');
  }

  private visitConditionalExpression(node: ConditionalExpressionNode): void {
    const cond     = this.formatExpr(node.condition);
    const ifTrue   = this.formatExpr(node.trueExpression);
    const ifFalse  = this.formatExpr(node.falseExpression);
    this.explanations.push(`${this.indent()}❓ **Ternary: ${cond} ? ${ifTrue} : ${ifFalse}**`);
    this.explanations.push(`${this.indent()}   If ${cond} is true → use ${ifTrue}, else use ${ifFalse}`);
    this.explanations.push('');
  }

  private visitCastExpression(node: CastExpressionNode): void {
    const value = this.formatExpr(node.operand);
    this.explanations.push(`${this.indent()}🔄 **Type Cast: (${node.targetType}) ${value}**`);
    this.explanations.push(`${this.indent()}   Converts ${value} to type ${node.targetType}.`);
    this.explanations.push(`${this.indent()}   ⚠️  May lose precision when narrowing (e.g. double → int).`);
    this.explanations.push('');
  }

  private visitSizeofExpression(node: SizeofExpressionNode): void {
    const value = this.formatExpr(node.value);
    this.explanations.push(`${this.indent()}📏 **sizeof(${value})**`);
    this.explanations.push(`${this.indent()}   Asks: "How many bytes does ${value} occupy in memory?"`);
    this.explanations.push(`${this.indent()}   Common: int=4, char=1, double=8, bool=1`);
    this.explanations.push('');
  }

  private visitAddressOf(node: UnaryOpNode): void {
  const v = this.cleanName(node.operand);
  this.explanations.push(`${this.indent()}📍 **&${v}** — Finding the Address`);
  this.explanations.push(`${this.indent()}   Instead of looking at what's inside '${v}', we are looking for its coordinates in memory (like a GPS location).`);
}

  private visitDereference(node: UnaryOpNode): void {
    const v = this.cleanName(node.operand);
    this.explanations.push(`${this.indent()}🎯 **\*${v}** — Follow the pointer '${v}' to get the stored value`);
    this.explanations.push(`${this.indent()}   Like going to the shelf address and reading the book.`);
    this.explanations.push('');
  }

  // =========================================================================
  //  HELPERS - Format expressions nicely
  // =========================================================================

  private formatExpr(node: any): string {
    if (!node) return '???';

    if (typeof node === 'string') return node;

    switch (node.type) {
      case 'BinaryOp': {
        const left = this.formatExpr(node.left);
        const right = this.formatExpr(node.right);
        let note = '';

        // 1. Map symbols to human-friendly words
        const opMap: Record<string, string> = { 
          '&&': 'AND', 
          '||': 'OR', 
          '==': 'is equal to',
          '!=': 'is NOT equal to',
          '<':  'is less than',
          '>':  'is greater than',
          '<=': 'is less than or equal to',
          '>=': 'is greater than or equal to'
        };
        const opLabel = opMap[node.operator] || node.operator;

        // 2. Check for the integer division pitfall
        if (node.operator === '/' && node.left.type === 'Integer' && node.right.type === 'Integer') {
          note = ' 💡 (Note: Integer division cuts off decimals!)';
        }

        return `(${left} ${opLabel} ${right})${note}`;
      }
      case 'Identifier':
        return node.name || node.value || node.id || 'variable';
      case 'Integer':
        return String(node.value);
      case 'Float':
        return String(node.value);
      case 'Char':
        return `'${node.value}'`;
      case 'String':
        return `"${node.value}"`;
      case 'Literal':
        return String(node.value);
      case 'ArrayAccess': {
        const indices = (node.indices || []).map((i: any) => `[${this.formatExpr(i)}]`).join('');
        return `${node.name}${indices}`;
      }
      case 'VariableDecl':
        return this.cleanName(node.name);
      case 'Assignment': {
        const tgt = typeof node.target === 'string'
          ? this.cleanName(node.target)
          : this.formatExpr(node.target);
        return `${tgt} ${node.operator} ${this.formatExpr(node.value)}`;
      }
      case 'ConditionalExpression': {
        const cond    = this.formatExpr(node.condition);
        const trueVal = this.formatExpr(node.trueExpression);
        const falseVal = this.formatExpr(node.falseExpression);
        return `${cond} ? ${trueVal} : ${falseVal}`;
      }
      case 'FunctionCall': {
        const args = (node.arguments || []).map((a: any) => this.formatExpr(a)).join(', ');
        return `${node.name}(${args})`;
      }
      case 'CastExpression':
        return `(${node.targetType})${this.formatExpr(node.operand)}`;
      case 'SizeofExpression':
        return `sizeof(${this.formatExpr(node.value)})`;
      case 'NewExpression':
        return node.size ? `new ${node.baseType}[${this.formatExpr(node.size)}]` : `new ${node.baseType}`;
      case 'PreIncrement':
        return `++${this.cleanName(node.operand)}`;
      case 'PostIncrement':
        return `${this.cleanName(node.operand)}++`;
      case 'PreDecrement':
        return `--${this.cleanName(node.operand)}`;
      case 'PostDecrement':
        return `${this.cleanName(node.operand)}--`;
      case 'AddressOf':
        return `&${this.formatExpr(node.operand)}`;
      case 'Dereference':
        return `*${this.formatExpr(node.operand)}`;
      case 'UnaryOp':
        return `${node.operator}${this.formatExpr(node.operand)}`;
      case 'InitializerList': {
        const vals = (node.values || []).map((v: any) => this.formatExpr(v)).join(', ');
        return `{ ${vals} }`;
      }
      default:
        return node.name || node.value || String(node);
    }
  }
  // =========================================================================
  //  RANGE-BASED FOR (C++11)
  // =========================================================================
  private visitRangeBasedFor(node: any): void {
    const range = this.formatExpr(node.range);
    this.explanations.push(
      `${this.indent()}🔁 **Range-Based For Loop:** for each **'${node.name}'** (${node.varType}) in **${range}**`,
    );
    this.explanations.push(
      `${this.indent()}   Automatically walks every element of the collection — no index needed.`,
    );
    this.explanations.push('');
    this.indentLevel++;
    (node.body || []).forEach((stmt: any) => this.visit(stmt));
    this.indentLevel--;
    this.explanations.push(`${this.indent()}   ↩️ Loop finished — all elements visited.`);
    this.explanations.push('');
  }

  // =========================================================================
  //  EXCEPTION HANDLING
  // =========================================================================
  private visitTryStatement(node: any): void {
    this.explanations.push(`${this.indent()}🛡 **Try Block** — code that might throw an error:`);
    this.explanations.push('');
    this.indentLevel++;
    (node.body || []).forEach((stmt: any) => this.visit(stmt));
    this.indentLevel--;
    (node.handlers || []).forEach((h: any) => {
      const label = h.param?.type === 'CatchAll'
        ? 'any exception'
        : `${h.param?.varType ?? ''} ${h.param?.name ?? ''}`.trim();
      this.explanations.push(`${this.indent()}🪤 **Catch (${label})** — runs if the try block throws:`);
      this.explanations.push('');
      this.indentLevel++;
      (h.body || []).forEach((stmt: any) => this.visit(stmt));
      this.indentLevel--;
    });
    this.explanations.push('');
  }

  private visitThrowStatement(node: any): void {
    const val = node.value ? this.formatExpr(node.value) : '(rethrow)';
    this.explanations.push(`${this.indent()}🚀 **Throw:** Signals an error with value: ${val}`);
    this.explanations.push(`${this.indent()}   Execution jumps to the nearest matching catch block.`);
    this.explanations.push('');
  }

}

// ---------------------------------------------------------------------------
// Lookup tables
// ---------------------------------------------------------------------------

const HEADER_DESCRIPTIONS: Record<string, string> = {
  iostream:  'input/output (cin, cout)',
  string:    'text handling',
  cmath:     'math functions (pow, sqrt, etc.)',
  iomanip:   'output formatting (setw, setprecision)',
  vector:    'dynamic arrays',
  algorithm: 'sorting and searching utilities',
  fstream:   'file input/output',
  cstdlib:   'general utilities (rand, exit)',
  cstring:   'C-string manipulation',
  ctime:     'date and time functions',
  cassert:   'assertion checks',
  sstream:   'string streams',
};

const COMPOUND_OP_LABELS: Record<string, string> = {
  '=':   'Set',
  '+=':  'Add & Update',
  '-=':  'Subtract & Update',
  '*=':  'Multiply & Update',
  '/=':  'Divide & Update',
  '%=':  'Modulo & Update',
  '&=':  'Bitwise AND & Update',
  '|=':  'Bitwise OR & Update',
  '^=':  'Bitwise XOR & Update',
  '<<=': 'Left-shift & Update',
  '>>=': 'Right-shift & Update',

};