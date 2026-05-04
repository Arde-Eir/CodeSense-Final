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

  /** True when a type string is a reference (& but not &&). */
  private isRefType(t: string): boolean {
    return t.includes('&') && !t.includes('&&');
  }

  /** True when a type string is a pointer. */
  private isPtrType(t: string): boolean {
    return t.includes('*');
  }

  /**
   * Describes one function parameter in plain English, noting how it's passed.
   * Copy, pass-by-reference, and pass-by-pointer all get different wording.
   */
  private describeParam(p: any): string {
    const t    = String(p.varType || '');
    const name = p.name || '?';
    const def  = p.defaultValue ? ` (default: ${this.formatExpr(p.defaultValue)})` : '';
    if (this.isRefType(t))
      return `${t} ${name} — passed by reference (changes you make affect the caller's variable!)${def}`;
    if (this.isPtrType(t))
      return `${t} ${name} — passed as a pointer (you get its memory address, can modify the original)${def}`;
    return `${t} ${name} — passed by value (your own private copy; changes stay local)${def}`;
  }

  /** One-word label for use in compact param lists. */
  private shortParamTag(t: string): string {
    if (this.isRefType(t)) return 'by ref!';
    if (this.isPtrType(t)) return 'by ptr';
    return 'copy';
  }

  /** True when a value node is nullptr / NULL — not plain integer 0, which is ambiguous. */
  private isNullptr(node: any): boolean {
    if (!node) return false;
    if (node.type === 'Identifier') return node.name === 'nullptr' || node.name === 'NULL';
    return false;
  }

  private indent(): string {
    return '  '.repeat(this.indentLevel);
  }

  translate(ast: ASTNode): string[] {
    this.explanations = [];
    this.indentLevel = 0;
    this.emittedTips = new Set();
    this.visit(ast);
    return this.explanations;
  }

  /**
   * One friendly sentence per CFG node — emoji, plain English, a tiny metaphor.
   * Does NOT recurse into children.
   */
  translateBrief(node: ASTNode | null | undefined): string {
    if (!node) return '';
    const n = node as any;

    switch (node.type) {

      // ── Functions ───────────────────────────────────────────────────────────
      case 'FunctionDecl': {
        if (n.name === 'main')
          return '🚀 Your program wakes up here — this is where everything begins!';
        const paramTags = (n.params || [])
          .map((p: any) => `${p.varType} ${p.name || '?'} [${this.shortParamTag(String(p.varType || ''))}]`)
          .join(', ');
        const gives = n.returnType === 'void' ? 'gives nothing back' : `gives back a ${n.returnType}`;
        return `🔧 A reusable task called "${n.name}" — takes ${paramTags || 'nothing'} and ${gives}.`;
      }
      case 'FunctionPrototype': {
        const paramTags = (n.params || [])
          .map((p: any) => `${p.varType} ${p.name || '?'} [${this.shortParamTag(String(p.varType || ''))}]`)
          .join(', ');
        return `📢 Early announcement: "${n.name}" exists and takes ${paramTags || 'nothing'} — the full code comes later.`;
      }
      case 'FunctionCall': {
        const args = (n.arguments || []).map((a: any) => this.formatExpr(a)).join(', ');
        return args
          ? `📞 Ask "${n.name}" to do its job with: ${args}`
          : `📞 Ask "${n.name}" to do its job.`;
      }
      case 'ReturnStatement':
        return n.value
          ? `↩️ Done! Hand back the result: ${this.formatExpr(n.value)}`
          : `↩️ All done here — exit this function.`;

      // ── Variables ───────────────────────────────────────────────────────────
      case 'VariableDecl': {
        const mods: string[] = Array.isArray(n.modifiers) ? n.modifiers : [];
        const isConst = mods.includes('const') || mods.includes('constexpr');
        const vt      = String(n.varType || '');
        const isRef   = this.isRefType(vt);
        const isPtr   = this.isPtrType(vt);
        const isArr   = n.dimensions && n.dimensions.length > 0;
        const name    = this.cleanName(n.name);
        if (isConst) {
          const val = n.value ? this.formatExpr(n.value) : '?';
          return `❄️ Locked box "${name}" = ${val} — this value can never be changed.`;
        }
        if (isRef) {
          return n.value
            ? `🔗 "${name}" is an alias for ${this.formatExpr(n.value)} — same variable, different name. Changes affect the original!`
            : `🔗 Reference "${name}" (${vt}) — another name for an existing variable. Must be bound at creation.`;
        }
        if (isPtr) {
          if (n.value && this.isNullptr(n.value))
            return `📌 Pointer "${name}" — set to nullptr right away (safe — it points at nothing for now).`;
          return n.value
            ? `📌 Pointer "${name}" — stores a memory address, currently pointing at ${this.formatExpr(n.value)}.`
            : `📌 Pointer "${name}" — stores a memory address (like a GPS pin), currently unset!`;
        }
        if (isArr) {
          const size = n.dimensions[0] ? this.formatExpr(n.dimensions[0]) : '?';
          return `📦 Row of ${size} boxes called "${name}" — like ${size} numbered lockers side by side.`;
        }
        return n.value
          ? `📦 Box "${name}" created and filled with ${this.formatExpr(n.value)}.`
          : `⚠️ Empty box "${name}" created — it holds random garbage until you put something in it!`;
      }
      case 'Assignment': {
        const tgt = typeof n.target === 'string' ? n.target : this.formatExpr(n.target);
        if (n.operator === '=' && this.isNullptr(n.value))
          return `📌 Set pointer "${tgt}" to null — it now safely points at nothing.`;
        const val = this.formatExpr(n.value);
        const opFriendly: Record<string, string> = {
          '=': 'Replace', '+=': 'Add to', '-=': 'Subtract from',
          '*=': 'Multiply', '/=': 'Divide', '%=': 'Modulo update',
        };
        const verb = opFriendly[n.operator] || 'Update';
        return `✏️ ${verb} "${tgt}" — new value becomes ${val}.`;
      }
      case 'ArrayAccess': {
        const idx = (n.indices || []).map((i: any) => this.formatExpr(i)).join(', ');
        return `🔍 Reach into box "${n.name}" and grab item at slot [${idx}].`;
      }

      // ── Decisions ───────────────────────────────────────────────────────────
      case 'IfStatement': {
        const cond = this.formatExpr(n.condition);
        return `🤔 Decision: is ${cond}? If yes, go one way; if no, go another — like a fork in the road.`;
      }
      case 'SwitchStatement': {
        const count = (n.cases || []).length;
        return `🎯 Check "${this.formatExpr(n.condition)}" and jump to the matching option — like a ${count}-item menu.`;
      }
      case 'ConditionalExpression': {
        const cond  = this.formatExpr(n.condition);
        const yes   = this.formatExpr(n.trueExpression);
        const no    = this.formatExpr(n.falseExpression);
        return `❓ Quick pick: if ${cond} then ${yes}, otherwise ${no}.`;
      }

      // ── Loops ────────────────────────────────────────────────────────────────
      case 'WhileLoop':
        return `🔁 Keep looping as long as "${this.formatExpr(n.condition)}" stays true — stops the moment it's false.`;
      case 'DoWhileLoop':
        return `🔄 Do the work first, then ask: "${this.formatExpr(n.condition)}" — always runs at least once.`;
      case 'ForLoop': {
        const cond = n.condition ? this.formatExpr(n.condition) : 'forever';
        const upd  = n.update    ? `, stepping by ${this.formatExpr(n.update)}` : '';
        return `🔢 Count loop — keep going while ${cond}${upd}.`;
      }
      case 'RangeBasedFor':
        return `🔁 Walk through every item in "${this.formatExpr(n.range)}", calling each one "${n.name}".`;
      case 'LoopControl':
        return n.value === 'break'
          ? '🛑 Emergency exit! Jump out of the loop right now.'
          : '⏭️ Skip the rest of this round and jump straight to the next one.';

      // ── I/O ──────────────────────────────────────────────────────────────────
      case 'CoutStatement': {
        const items = this.flattenCout(n.values)
          .filter(s => s !== 'cout' && s !== 'std::cout').join(', ');
        return `🖥️ Print to the screen: ${items || 'a blank line'}.`;
      }
      case 'CinStatement': {
        const flatten = (x: any): any[] => {
          if (!x) return [];
          if (x.type === 'BinaryOp' && x.operator === '>>') return [...flatten(x.left), ...flatten(x.right)];
          return [x];
        };
        const names = flatten(n.targets ?? n.target)
          .map((t: any) => typeof t === 'string' ? t : this.cleanName(t.name ?? t))
          .filter((s: string) => s !== 'cin' && s !== 'std::cin');
        return `⌨️ Pause and wait for the user to type — save what they enter into "${names.join('", "') || 'a variable'}".`;
      }

      // ── Memory ───────────────────────────────────────────────────────────────
      case 'NewExpression':
        return n.size
          ? `🆕 Reserve fresh memory for ${this.formatExpr(n.size)} ${n.baseType} values — remember to free it when done!`
          : `🆕 Create a brand-new ${n.baseType} in memory — remember to free it when done!`;
      case 'DeleteStatement':
        return n.isArray
          ? `🗑️ Release the whole array "${this.cleanName(n.target)}" back to the system — it's gone!`
          : `🗑️ Free "${this.cleanName(n.target)}" from memory — don't touch that pointer anymore!`;

      // ── Errors ───────────────────────────────────────────────────────────────
      case 'TryStatement':
        return '🛡️ Risky zone — if anything crashes here, the catch block swoops in to handle it.';
      case 'ThrowStatement': {
        const val = n.value ? this.formatExpr(n.value) : 'the current error';
        return `🚀 Toss the error "${val}" — the nearest catch block will catch it.`;
      }

      // ── Type ops ─────────────────────────────────────────────────────────────
      case 'CastExpression':
        return `🔄 Convert "${this.formatExpr(n.operand)}" into type ${n.targetType} — like converting miles to km.`;
      case 'SizeofExpression':
        return `📏 How many bytes does "${this.formatExpr(n.value)}" take up in memory?`;

      // ── Pointers ─────────────────────────────────────────────────────────────
      case 'AddressOf':
        return `📍 Find where "${this.cleanName(n.operand)}" lives in memory — returns its GPS address.`;
      case 'Dereference':
        return `🎯 Follow the pointer "${this.cleanName(n.operand)}" and read the value it's pointing at.`;
      case 'PreIncrement':
        return `⬆️ Add 1 to "${this.cleanName(n.operand)}" first, then use the new value.`;
      case 'PostIncrement':
        return `⬆️ Use "${this.cleanName(n.operand)}" as-is right now, then add 1 to it afterward.`;
      case 'PreDecrement':
        return `⬇️ Subtract 1 from "${this.cleanName(n.operand)}" first, then use the new value.`;
      case 'PostDecrement':
        return `⬇️ Use "${this.cleanName(n.operand)}" as-is right now, then subtract 1 afterward.`;

      // ── Goto / Labels ─────────────────────────────────────────────────────────
      case 'GotoStatement':
        return `🏃 Jump straight to the marker called "${n.label}".`;
      case 'LabelStatement':
        return `🏷️ Marker "${n.label}" — a landing spot that goto can jump to.`;

      // ── Expressions ──────────────────────────────────────────────────────────
      case 'BinaryOp':
        return `🧮 Calculate: ${this.formatExpr(node)}`;
      case 'ExpressionStatement':
        return `▶️ Run: ${this.formatExpr(n.expression)}`;
      case 'InitializerList': {
        const vals = (n.values || []).map((v: any) => this.formatExpr(v)).join(', ');
        return `📋 Fill all slots at once with: { ${vals} }`;
      }

      // ── Structure ─────────────────────────────────────────────────────────────
      case 'Block':
        return `📂 A grouped block of statements — they run together as a unit.`;
      case 'LambdaExpression': {
        const cap = n.capture ? `captures [${n.capture}]` : 'captures nothing';
        return `🎭 Inline mini-function (lambda) — ${cap}, defined right here on the spot.`;
      }
      case 'GlobalAccess':
        return `🌐 Access "${n.name}" from the global scope.`;
      case 'CatchClause': {
        const param = n.param?.type === 'CatchAll'
          ? 'any error'
          : `${n.param?.varType ?? ''} ${n.param?.name ?? ''}`.trim();
        return `🪤 Catch block — handles errors of type: ${param}.`;
      }

      default:
        return node.type.replace(/([A-Z])/g, ' $1').trim();
    }
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
    const isRef   = this.isRefType(node.varType);
    const isPtr   = this.isPtrType(node.varType);
    const isArray = node.dimensions && node.dimensions.length > 0;

    // 1. Identify the "Storage Type"
    if (isConst) {
      this.explanations.push(`${this.indent()}❄️ **Constant (Frozen): '${name}'** (type: ${node.varType})`);
      this.explanations.push(`${this.indent()}   This value is locked! It cannot be changed after this line.`);
    } else if (isRef) {
      this.explanations.push(`${this.indent()}🔗 **Reference Alias: '${name}'** (type: ${node.varType})`);
      this.explanations.push(`${this.indent()}   This is just another name for the same variable — like a nickname. Changing '${name}' changes the original!`);
      this.pushTipOnce(`${this.indent()}   💡 References must be bound when declared and can never be rebound to another variable.`);
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

    if (node.operator === '=' && this.isNullptr(node.value)) {
      this.explanations.push(`${this.indent()}📌 **Null Out Pointer: '${target}'**`);
      this.explanations.push(`${this.indent()}   Setting '${target}' to nullptr — it now safely points at nothing.`);
      this.pushTipOnce(`${this.indent()}   💡 Always null out a pointer after deleting it to avoid accidental reuse.`);
    } else {
      this.explanations.push(`${this.indent()}✏️  **${opLabel}: '${target}'**`);
      this.explanations.push(`${this.indent()}   New value: ${value}`);
    }
    this.explanations.push('');
  }

  // =========================================================================
  //  FUNCTIONS - The Tasks
  // =========================================================================

  private visitFunctionPrototype(node: FunctionPrototypeNode): void {
    const name = this.cleanName(node.name);

    this.explanations.push(`${this.indent()}📢 **Function Announcement: '${name}'**`);
    if (node.params.length > 0) {
      this.explanations.push(`${this.indent()}   Parameters:`);
      node.params.forEach((p: any) => {
        this.explanations.push(`${this.indent()}     • ${this.describeParam(p)}`);
      });
    } else {
      this.explanations.push(`${this.indent()}   Parameters: none`);
    }
    this.explanations.push(`${this.indent()}   Returns: ${node.returnType}`);
    this.pushTipOnce(`${this.indent()}   💡 This is a forward declaration — the full code comes later.`);
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
        this.explanations.push(`🔧 **FUNCTION: ${name}**`);
        if ((node.params || []).length > 0) {
          this.explanations.push('• **Inputs:**');
          (node.params || []).forEach((p: any) => {
            this.explanations.push(`    – ${this.describeParam(p)}`);
          });
        } else {
          this.explanations.push('• **Inputs:** none');
        }
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
    // formatExpr already renders the full expression tree — no need to recurse.
    if (this.indentLevel > 0) {
      this.explanations.push(`${this.indent()}🧮 **Calculating:** ${expr}`);
      this.explanations.push('');
    }
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
      this.pushTipOnce(`${this.indent()}   💡 Like pulling an emergency stop cord.`);
    } else if (node.value === 'continue') {
      this.explanations.push(`${this.indent()}⏭️  **continue** — Skip to the next loop iteration`);
      this.pushTipOnce(`${this.indent()}   💡 Like skipping a song and going to the next one.`);
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
    // `node.targets` may be an array, a leaf (Identifier string / ArrayAccess),
    // or a BinaryOp tree from chained `cin >> a >> b`. Flatten to a list.
    const flatten = (n: any): any[] => {
      if (n == null) return [];
      if (Array.isArray(n)) return n.flatMap(flatten);
      if (typeof n === 'string') return [n];
      if (n.type === 'BinaryOp' && (n.operator === '>>' || n.operator === '<<')) {
        return [...flatten(n.left), ...flatten(n.right)];
      }
      return [n];
    };
    const items = node.targets ? flatten(node.targets) : (node.target ? [node.target] : []);
    const targetNames = items.length
      ? items.map((t: any) => typeof t === 'string' ? t : this.cleanName(t.name)).join(', ')
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
    this.explanations.push('');
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

  // =========================================================================
  //  GOTO / LABELS
  // =========================================================================

  private visitGotoStatement(node: any): void {
    this.explanations.push(`${this.indent()}🏃 **goto ${node.label}** — Jumps directly to the '${node.label}' marker`);
    this.pushTipOnce(`${this.indent()}   💡 goto can make code hard to follow — modern C++ rarely needs it.`);
    this.explanations.push('');
  }

  private visitLabelStatement(node: any): void {
    this.explanations.push(`${this.indent()}🏷️ **Label: '${node.label}'** — a named landing spot`);
    this.explanations.push(`${this.indent()}   Execution can jump here via 'goto ${node.label}'.`);
    if (node.statement) this.visit(node.statement);
    this.explanations.push('');
  }

  // =========================================================================
  //  LAMBDA EXPRESSIONS
  // =========================================================================

  private visitLambdaExpression(node: any): void {
    const capture = node.capture ? `[${node.capture}]` : '[]';
    this.explanations.push(`${this.indent()}🎭 **Lambda (Inline Function):** ${capture}`);
    this.explanations.push(`${this.indent()}   A mini function defined right here, not at the top level.`);
    if (node.capture && node.capture !== '') {
      this.explanations.push(`${this.indent()}   Captures from outer scope: ${node.capture}`);
    }
    this.explanations.push('');
    this.indentLevel++;
    (node.body || []).forEach((stmt: any) => this.visit(stmt));
    this.indentLevel--;
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