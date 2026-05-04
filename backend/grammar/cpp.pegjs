{
  function loc() {
    return {
      line: location().start.line,
      column: location().start.column
    };
  }
}

// ============================================================================
// Program Entry Point
// ============================================================================

Program
  = _ directives:Preprocessor* _ namespace:Namespace? _
    body:(Function / VariableDeclaration)+ _ {
      return {
        type: 'Program',
        directives,
        namespace: namespace || null,
        body: body.flatMap(item =>
          item.type === 'MultipleVariableDecl' ? item.declarations : [item]
        ),
        ...loc()
      };
    }

// ============================================================================
// Preprocessor Directives
// FIXES:
//   - #include now accepts + in names (e.g. "c++") via [a-zA-Z0-9_/.+]
//   - #define value defaults to null (not undefined) when absent
//   - #line filename is null (not undefined) when absent
// ============================================================================

Preprocessor
  = "#include" _ "<" name:$[a-zA-Z0-9_/.+]+ ">" _ {
      return { type: 'Include', name, isSystem: true, ...loc() };
    }
  / "#include" _ "\"" name:$[a-zA-Z0-9_/.+]+ "\"" _ {
      return { type: 'Include', name, isSystem: false, ...loc() };
    }
  / "#define" _ name:Identifier _ value:MacroValue? _ {
      return { type: 'Define', name, value: value || null, ...loc() };
    }
  / "#undef" _ name:Identifier _ {
      return { type: 'Undef', name, ...loc() };
    }
  / "#ifdef" _ name:Identifier _ {
      return { type: 'IfDef', name, ...loc() };
    }
  / "#ifndef" _ name:Identifier _ {
      return { type: 'IfNDef', name, ...loc() };
    }
  / "#if" _ condition:PreprocessorCondition _ {
      return { type: 'If', condition, ...loc() };
    }
  / "#elif" _ condition:PreprocessorCondition _ {
      return { type: 'ElIf', condition, ...loc() };
    }
  / "#else" _ {
      return { type: 'Else', ...loc() };
    }
  / "#endif" _ {
      return { type: 'EndIf', ...loc() };
    }
  / "#pragma" _ directive:PragmaDirective _ {
      return { type: 'Pragma', directive, ...loc() };
    }
  / "#error" _ message:$[^\n]* _ {
      return { type: 'Error', message: message.trim(), ...loc() };
    }
  / "#warning" _ message:$[^\n]* _ {
      return { type: 'Warning', message: message.trim(), ...loc() };
    }
  / "#line" _ lineNum:Integer _ file:String? _ {
      return { type: 'Line', lineNumber: lineNum.value, filename: file ? file.value : null, ...loc() };
    }

MacroValue
  = expr:Expression { return expr; }
  / text:$[^\n]+ { return { type: 'MacroText', value: text.trim() }; }

PreprocessorCondition
  = "defined" _ "(" _ name:Identifier _ ")" { return { type: 'Defined', name }; }
  / "defined" __ name:Identifier             { return { type: 'Defined', name }; }
  / expr:LogicalOr                            { return expr; }

PragmaDirective
  = "once"                                     { return { type: 'PragmaOnce' }; }
  / "pack" _ "(" _ value:Integer _ ")"        { return { type: 'PragmaPack', value: value.value }; }
  / text:$[^\n]+                               { return { type: 'PragmaGeneric', value: text.trim() }; }

GlobalAccess
  = "::" _ name:Identifier {
      return { type: 'GlobalAccess', name, ...loc() };
    }

Namespace
  = "using" __ "namespace" __ name:Identifier _ ";" _ {
      return { type: 'Namespace', name, ...loc() };
    }

// ============================================================================
// Functions
// ============================================================================

// Use `_` instead of `__` between Type and the identifier — Type may already
// end with `*` or `&` (pointer / reference), in which case there is no
// whitespace before the name. BaseType / TypeModifier carry their own
// word-boundary guard (`!IdentChar`) so this still rejects e.g. `intx`.
Function
  = returnType:Type _ name:Identifier _ "(" _ params:ParameterList? _ ")" _
    body:("{" _ Statement* _ "}" / ";") _ {
      return {
        type: body === ";" ? 'FunctionPrototype' : 'FunctionDecl',
        returnType,
        name,
        params: params || [],
        body: body === ";" ? null : body[2],
        ...loc()
      };
    }

FunctionCall
  = name:Identifier _ "(" _ args:ArgumentList? _ ")" {
      return { type: 'FunctionCall', name, arguments: args || [], ...loc() };
    }

ArgumentList
  = first:Expression rest:(_ "," _ Expression)* {
      return [first, ...rest.map(r => r[3])];
    }

ArrayAccess
  = name:Identifier dims:(_ "[" _ Expression _ "]")+ {
      return { type: 'ArrayAccess', name, indices: dims.map(d => d[3]), ...loc() };
    }

ParameterList
  = first:Parameter rest:(_ "," _ Parameter)* {
      return [first, ...rest.map(r => r[3])];
    }

// `_` (zero-or-more whitespace) is correct here: Type can end with `*`/`&`,
// in which case there is no whitespace before the parameter name. BaseType
// has a `!IdentChar` guard so `intn` / `floatx` won't be silently accepted.
Parameter
  = type:Type _ name:Identifier dims:ArrayDimension* _ init:("=" _ Expression)? {
      return {
        type: 'Parameter',
        varType: type,
        name,
        dimensions: dims,
        defaultValue: init ? init[2] : null,
        ...loc()
      };
    }
  / type:Type dims:ArrayDimension+ {
      return { type: 'Parameter', varType: type, name: null, dimensions: dims, defaultValue: null, ...loc() };
    }
  / type:Type {
      return { type: 'Parameter', varType: type, name: null, dimensions: [], defaultValue: null, ...loc() };
    }

ArrayDimension
  = _ "[" _ size:Expression? _ "]" { return size || null; }

// ============================================================================
// Statements
// FIXES:
//   - LoopControlStatement now carries a loopDepth placeholder so the
//     TypeChecker can verify break/continue appear inside a loop/switch.
//   - DeleteStatement supports both `delete ptr` and `delete[] arr`.
// ============================================================================

Statement
  = VariableDeclaration
  / StreamStatement
  / ReturnStatement
  / IfStatement
  / WhileLoop
  / RangeBasedFor
  / ForLoop
  / DoWhileLoop
  / SwitchStatement
  / LoopControlStatement
  / GotoStatement
  / LabelStatement
  / DeleteStatement
  / TryStatement
  / ThrowStatement
  / ExpressionStatement
  / Block

Block
  = "{" _ statements:Statement* _ "}" _ {
      return { type: 'Block', statements, ...loc() };
    }

// ============================================================================
// Switch / Case
// FIXES:
//   - Case and DefaultCase now emit a consistent `isDefault` flag.
//   - DefaultCase is a distinct type so TypeChecker can detect its presence.
// ============================================================================

SwitchStatement
  = "switch" _ "(" _ cond:Expression _ ")" _ "{" _ cases:CaseBlock* _ "}" _ {
      return { type: 'SwitchStatement', condition: cond, cases, ...loc() };
    }

CaseBlock
  = "case" __ val:Expression _ ":" _ statements:CaseStatement* {
      return { type: 'Case', value: val, isDefault: false, statements, ...loc() };
    }
  / "default" _ ":" _ statements:CaseStatement* {
      return { type: 'DefaultCase', value: null, isDefault: true, statements, ...loc() };
    }

CaseStatement
  = VariableDeclaration
  / StreamStatement
  / LoopControlStatement
  / GotoStatement
  / LabelStatement
  / IfStatement
  / WhileLoop
  / RangeBasedFor
  / ForLoop
  / DoWhileLoop
  / ReturnStatement
  / ExpressionStatement
  / Block

DeleteStatement
  = "delete" _ isArray:"[]"? _ target:Identifier _ ";" _ {
      return { type: 'DeleteStatement', target, isArray: !!isArray, ...loc() };
    }

DoWhileLoop
  = "do" _ body:Statement _ "while" _ "(" _ condition:Expression _ ")" _ ";" _ {
      return {
        type: 'DoWhileLoop',
        condition,
        body: body.type === 'Block' ? body.statements : [body],
        ...loc()
      };
    }


// ============================================================================
// Exception Handling  (try / catch / throw)
// ============================================================================
TryStatement
  = "try" _ body:Block _ handlers:CatchClause+ {
      return { type: 'TryStatement', body: body.statements, handlers, ...loc() };
    }

CatchClause
  = "catch" _ "(" _ param:CatchParam _ ")" _ body:Block {
      return { type: 'CatchClause', param, body: body.statements, ...loc() };
    }

// `_` so `catch (Error &e)` parses (Type ends with `&`, no whitespace before `e`).
CatchParam
  = "..." { return { type: 'CatchAll' }; }
  / type:Type _ name:Identifier { return { type: 'CatchParam', varType: type, name }; }
  / type:Type { return { type: 'CatchParam', varType: type, name: null }; }

ThrowStatement
  = "throw" __ expr:Expression _ ";" _ { return { type: 'ThrowStatement', value: expr, ...loc() }; }
  / "throw" _ ";" _ { return { type: 'ThrowStatement', value: null, ...loc() }; }

// FIX: LoopControlStatement now records 'break' vs 'continue' in `value`
//      and the surrounding context can be verified in the TypeChecker.
LoopControlStatement
  = ctrl:("break" / "continue") _ ";" _ {
      return { type: 'LoopControl', value: ctrl, ...loc() };
    }

GotoStatement
  = "goto" __ label:$([a-zA-Z_][a-zA-Z0-9_]*) _ ";" _ {
      return { type: 'GotoStatement', label, ...loc() };
    }

// LabelStatement: `myLabel:` optionally followed by a statement.
// The `!":"` lookahead prevents matching `::` (scope resolution).
LabelStatement
  = label:$([a-zA-Z_][a-zA-Z0-9_]*) _ ":" !":" _ stmt:Statement? {
      return { type: 'LabelStatement', label, statement: stmt || null, ...loc() };
    }

// ============================================================================
// Variable Declarations
// ============================================================================

VariableDeclaration
  = mods:TypeModifier* _ type:Type _ first:VariableDeclarator
    rest:(_ "," _ VariableDeclarator)* _ ";" _ {
      const declarations = [first, ...rest.map(r => r[3])];
      if (declarations.length === 1) {
        return {
          type: 'VariableDecl',
          modifiers: mods,
          varType: type,
          name: declarations[0].name,
          dimensions: declarations[0].dimensions,
          value: declarations[0].value,
          initStyle: declarations[0].initStyle,
          ...loc()
        };
      }
      return {
        type: 'MultipleVariableDecl',
        modifiers: mods,
        varType: type,
        declarations: declarations.map(d => ({
          type: 'VariableDecl',
          modifiers: mods,
          varType: type,
          name: d.name,
          dimensions: d.dimensions,
          value: d.value,
          initStyle: d.initStyle,
          ...loc()
        })),
        ...loc()
      };
    }

VariableDeclarator
  = name:Identifier
    dims:(_ "[" _ Expression _ "]")*
    value:(
      (_ "=" _ Expression)       // assignment style:   int x = 5;
      / (_ "(" _ Expression _ ")") // constructor style:  int x(5);
    )? {
      return {
        name,
        dimensions: dims.map(d => d[3]),
        value: value ? value[3] : null,
        initStyle: value ? (value[1] === "=" ? "assignment" : "constructor") : "none"
      };
    }

// ============================================================================
// Stream Statements (cin / cout)
// ============================================================================

StreamStatement
  = ("std::" _)? "cout" _ items:CoutChain _ ";" _ {
      return { type: 'CoutStatement', values: items, ...loc() };
    }
  / ("std::" _)? "cin" _ items:CinChain _ ";" _ {
      return { type: 'CinStatement', targets: items, ...loc() };
    }

CoutChain
  = "<<" _ first:Expression rest:(_ "<<" _ Expression)* {
      return rest.reduce((acc, r) => ({
        type: 'BinaryOp', 
        operator: '<<', 
        left: acc, 
        right: r[3], 
        ...loc()
      }), first);
    }

CinChain
  = ">>" _ first:CinTarget rest:(_ ">>" _ CinTarget)* {
      return rest.reduce((acc, r) => ({
        type: 'BinaryOp', 
        operator: '>>', 
        left: acc, 
        right: r[3], 
        ...loc()
      }), first);
    }

// FIX: CinTarget tries ArrayAccess before plain Identifier so `cin >> arr[i]`
//      is correctly parsed as an ArrayAccess node, not just the name "arr".
CinTarget
  = name:Identifier dims:(_ "[" _ Expression _ "]")+ {
      return { type: 'ArrayAccess', name, indices: dims.map(d => d[3]), ...loc() };
    }
  / Identifier

// ============================================================================
// Control Flow
// ============================================================================

ReturnStatement
  = "return" __ value:Expression _ ";" _ { return { type: 'ReturnStatement', value, ...loc() }; }
  / "return" _ ";" _                     { return { type: 'ReturnStatement', value: null, ...loc() }; }

IfStatement
  = "if" _ "(" _ condition:Expression _ ")" _ thenBranch:Statement
    elseBranch:(_ "else" _ Statement)? _ {
      return {
        type: 'IfStatement',
        condition,
        thenBranch: thenBranch.type === 'Block' ? thenBranch.statements : [thenBranch],
        elseBranch: elseBranch
          ? (elseBranch[3].type === 'Block' ? elseBranch[3].statements : [elseBranch[3]])
          : null,
        ...loc()
      };
    }

WhileLoop
  = "while" _ "(" _ condition:Expression _ ")" _ body:Statement {
      return {
        type: 'WhileLoop',
        condition,
        body: body.type === 'Block' ? body.statements : [body],
        ...loc()
      };
    }


// ============================================================================
// Range-Based For Loop  (C++11)
// for ( Type name : expr ) Statement
// ============================================================================
// `_` between Type and name — Type may end with `*`/`&` (e.g. `for (auto& x : v)`).
RangeBasedFor
  = "for" _ "(" _ type:Type _ name:Identifier _ ":" _ range:Expression _ ")" _ body:Statement {
      return {
        type: 'RangeBasedFor',
        varType: type,
        name,
        range,
        body: body.type === 'Block' ? body.statements : [body],
        ...loc()
      };
    }

// FIX: ForLoop init now tries VariableDeclaration first (handles `int i = 0;`)
//      then falls back to ExpressionStatement-style (handles `i = 0;`).
//      The update expression is also captured properly.
ForLoop
  = "for" _ "(" _
    init:(VariableDeclaration / (expr:Expression _ ";" _ { return { type: 'ExpressionStatement', expression: expr, ...loc() }; }) / (_ ";" _ { return null; }))?
    condition:Expression? _ ";" _
    update:Expression? _ ")" _
    body:Statement {
      return {
        type: 'ForLoop',
        init: init || null,
        condition: condition || null,
        update: update || null,
        body: body.type === 'Block' ? body.statements : [body],
        ...loc()
      };
    }

ExpressionStatement
  = expr:Expression _ ";" _ {
      return { type: 'ExpressionStatement', expression: expr, ...loc() };
    }

// ============================================================================
// Expressions
// ============================================================================

Expression = Assignment / InitializerList

// FIX: Assignment now includes |= ^= &= <<= >>= (bitwise compound operators).
// AssignTarget allows `*p = ...` (dereference) in addition to plain Primaries
// like identifiers and array accesses, so pointer-assignment statements parse.
Assignment
  = target:AssignTarget _ op:("=" / "+=" / "-=" / "*=" / "/=" / "%=" / "&=" / "|=" / "^=" / "<<=" / ">>=") _ value:Expression {
      return { type: 'Assignment', operator: op, target, value, ...loc() };
    }
  / Conditional

AssignTarget
  = "*" _ operand:Primary { return { type: 'Dereference', operand, ...loc() }; }
  / Primary

Conditional
  = condition:LogicalOr _ "?" _ trueExpr:Expression _ ":" _ falseExpr:Conditional {
      return {
        type: 'ConditionalExpression',
        condition,
        trueExpression: trueExpr,
        falseExpression: falseExpr,
        ...loc()
      };
    }
  / LogicalOr

LogicalOr
  = left:LogicalAnd rest:(_ "||" _ LogicalAnd)* {
      return rest.reduce((acc, r) => ({
        type: 'BinaryOp', operator: '||', left: acc, right: r[3], ...loc()
      }), left);
    }

LogicalAnd
  = left:BitwiseOr rest:(_ "&&" _ BitwiseOr)* {
      return rest.reduce((acc, r) => ({
        type: 'BinaryOp', operator: '&&', left: acc, right: r[3], ...loc()
      }), left);
    }

// FIX: Added full bitwise operator precedence chain (|, ^, &) between
//      logical AND and equality — matches the C++ standard precedence table.
BitwiseOr
  = left:BitwiseXor rest:(_ "|" !"|" _ BitwiseXor)* {
      return rest.reduce((acc, r) => ({
        type: 'BinaryOp', operator: '|', left: acc, right: r[3], ...loc()
      }), left);
    }

BitwiseXor
  = left:BitwiseAnd rest:(_ "^" _ BitwiseAnd)* {
      return rest.reduce((acc, r) => ({
        type: 'BinaryOp', operator: '^', left: acc, right: r[3], ...loc()
      }), left);
    }

BitwiseAnd
  = left:Equality rest:(_ "&" !"&" _ Equality)* {
      return rest.reduce((acc, r) => ({
        type: 'BinaryOp', operator: '&', left: acc, right: r[3], ...loc()
      }), left);
    }

Equality
  = left:Relational rest:(_ ("==" / "!=") _ Relational)* {
      return rest.reduce((acc, r) => ({
        type: 'BinaryOp', operator: r[1], left: acc, right: r[3], ...loc()
      }), left);
    }

Relational
  = left:Shift rest:(_ ("<=" / ">=" / "<" / ">") _ Shift)* {
      return rest.reduce((acc, r) => ({
        type: 'BinaryOp', operator: r[1], left: acc, right: r[3], ...loc()
      }), left);
    }

// FIX: Added Shift level (<<, >>) between Relational and Additive.
Shift
  = left:Additive rest:(_ ("<<" / ">>") _ Additive)* {
      return rest.reduce((acc, r) => ({
        type: 'BinaryOp', operator: r[1], left: acc, right: r[3], ...loc()
      }), left);
    }

Additive
  = left:Multiplicative rest:(_ ("+" / "-") _ Multiplicative)* {
      return rest.reduce((acc, r) => ({
        type: 'BinaryOp', operator: r[1], left: acc, right: r[3], ...loc()
      }), left);
    }

Multiplicative
  = left:Unary rest:(_ ("*" / "/" / "%") _ Unary)* {
      return rest.reduce((acc, r) => ({
        type: 'BinaryOp', operator: r[1], left: acc, right: r[3], ...loc()
      }), left);
    }

// FIX: Unary now includes bitwise NOT (~) and logical NOT (!) as separate cases.
Unary
  = "(" _ type:Type _ ")" _ operand:Unary { return { type: 'CastExpression', targetType: type, operand, ...loc() }; }
  / "sizeof" _ "(" _ expr:Expression _ ")" { return { type: 'SizeofExpression', value: expr, ...loc() }; }
  / "-"  _ operand:Unary { return { type: 'UnaryOp', operator: '-',  operand, ...loc() }; }
  / "!"  _ operand:Unary { return { type: 'UnaryOp', operator: '!',  operand, ...loc() }; }
  / "~"  _ operand:Unary { return { type: 'UnaryOp', operator: '~',  operand, ...loc() }; }
  / "*"  _ operand:Unary { return { type: 'Dereference',  operand, ...loc() }; }
  / "&"  _ operand:Unary { return { type: 'AddressOf',    operand, ...loc() }; }
  / "++" _ name:Identifier { return { type: 'PreIncrement',  operand: name, ...loc() }; }
  / "--" _ name:Identifier { return { type: 'PreDecrement',  operand: name, ...loc() }; }
  / name:Identifier _ "++" { return { type: 'PostIncrement', operand: name, ...loc() }; }
  / name:Identifier _ "--" { return { type: 'PostDecrement', operand: name, ...loc() }; }
  / Primary

Primary
  = "(" _ expr:Expression _ ")" { return expr; }
  / BooleanLiteral
  / LambdaExpression
  / Float          // Float BEFORE Integer (greedy on the decimal point)
  / Integer
  / Char
  / String
  / InitializerList
  / NewExpression
  / ArrayAccess
  / FunctionCall
  / GlobalAccess
  / "nullptr" { return { type: 'Identifier', name: 'nullptr', ...loc() }; }
  / "std::" name:Identifier { return { type: 'Identifier', name: "std::" + name, ...loc() }; }
  / Identifier

// FIX: Identifier guard checks ReservedWord with a proper word-boundary look-ahead
//      so keywords like "int" don't match as the start of "integer".
Identifier
  = !ReservedWord chars:$([a-zA-Z_][a-zA-Z0-9_]*) {
      return chars;
    }

NewExpression
  = "new" __ baseType:BaseType _ size:("[" _ Expression _ "]")? {
      return { type: 'NewExpression', baseType, size: size ? size[2] : null, ...loc() };
    }

LambdaExpression
  = capture:LambdaCapture _ params:("(" _ ParameterList? _ ")")? _ "{" _ body:Statement* _ "}" {
      return {
        type: 'LambdaExpression',
        capture,
        params: params ? (params[2] || []) : [],
        body,
        ...loc()
      };
    }

LambdaCapture
  = "[" _ captureList:$[^\]]* _ "]" { return captureList; }

InitializerList
  = "{" _ first:(Expression / InitializerList) rest:(_ "," _ (Expression / InitializerList))* _ "}" {
      return { type: 'InitializerList', values: [first, ...rest.map(r => r[3])], ...loc() };
    }

// ============================================================================
// Literals
// ============================================================================

BooleanLiteral
  = value:("true" / "false") !([a-zA-Z0-9_]) {
      return { type: 'Literal', value: value === "true", ...loc() };
    }

Integer
  = "0x" hex:$([0-9a-fA-F]+) suffix:$([uUlL]*) {
      return { type: 'Integer', value: parseInt(hex, 16), ...loc() };
    }
  / "0b" bin:$([01]+) suffix:$([uUlL]*) {
      return { type: 'Integer', value: parseInt(bin, 2), ...loc() };
    }
  / "0" oct:$([0-7]+) suffix:$([uUlL]*) {
      return { type: 'Integer', value: parseInt(oct, 8), ...loc() };
    }
  / value:$([0-9]+) !("." [0-9]) suffix:$([uUlL]*) {
      return { type: 'Integer', value: parseInt(value, 10), ...loc() };
    }

Float
  = value:$([0-9]* "." [0-9]+) exp:$([eE][+-]?[0-9]+)? suffix:[fFlL]? {
      return { type: 'Float', value: parseFloat(value + (exp || '')), suffix: suffix || null, ...loc() };
    }
  / value:$([0-9]+ "." [0-9]*) &[fFlLe E] exp:$([eE][+-]?[0-9]+)? suffix:[fFlL]? {
      return { type: 'Float', value: parseFloat(value + (exp || '')), suffix: suffix || null, ...loc() };
    }
  / value:$([0-9]+) exp:$([eE][+-]?[0-9]+) suffix:[fFlL]? {
      return { type: 'Float', value: parseFloat(value + exp), suffix: suffix || null, ...loc() };
    }

// FIX: Char literal handles all standard escape sequences
Char
  = "'" ch:(("\\" .) / [^'\\]) "'" {
      const raw = Array.isArray(ch) ? ch[0] + ch[1] : ch;
      return { type: 'Char', value: raw, ...loc() };
    }

// FIX: String literal explicitly loops over escape-or-regular-char groups
String
  = prefix:$("u8" / "u" / "U" / "L")? "\"" chars:$((("\\" .) / [^"\\])*) "\"" {
      return { type: 'String', value: chars, ...loc() };
    }

// ============================================================================
// Types
// ============================================================================

Type
  = mods:TypeModifier* _ base:BaseType ptr:(_ ("*" / "&"))* {
      const modStr  = mods.length ? mods.join(' ') + ' ' : '';
      const ptrStr  = ptr.map(m => m[1]).join('');
      return modStr + base + ptrStr;
    }

// IdentChar: helper used by !IdentChar lookaheads to enforce word boundaries
// after type keywords. Without these guards, `intx` would mis-parse as
// `int x` because BaseType's literal `"int"` would match the prefix.
IdentChar = [a-zA-Z0-9_]

BaseType
  = "long" __ "long"                      !IdentChar { return "long long"; }
  / "long" __ "double"                    !IdentChar { return "long double"; }
  / "unsigned" __ "long" __ "long"        !IdentChar { return "unsigned long long"; }
  / "unsigned" __ "long"                  !IdentChar { return "unsigned long"; }
  / "unsigned" __ "int"                   !IdentChar { return "unsigned int"; }
  / "unsigned" __ "short"                 !IdentChar { return "unsigned short"; }
  / "unsigned" __ "char"                  !IdentChar { return "unsigned char"; }
  / name:("int" / "float" / "double" / "char" / "bool" / "void" / "string"
     / "auto" / "typename" / "class" / "struct" / "enum"
     / "long" / "short" / "size_t" / "ptrdiff_t") !IdentChar { return name; }

TypeModifier
  = name:("constexpr" / "const" / "static" / "extern" / "volatile"
     / "unsigned" / "signed" / "inline" / "virtual" / "public" / "private"
     / "protected" / "override" / "final" / "mutable" / "explicit") !IdentChar { return name; }

// ============================================================================
// Reserved Keywords — kept in sync with the Lexer keyword list
// ============================================================================

ReservedWord
  = ( "auto" / "bool" / "break" / "case" / "catch" / "char" / "class"
    / "const" / "continue" / "default" / "delete" / "do" / "double"
    / "else" / "enum" / "explicit" / "extern" / "false" / "final"
    / "float" / "for" / "friend" / "goto" / "if" / "inline" / "int"
    / "long" / "mutable" / "namespace" / "new" / "nullptr" / "operator"
    / "override" / "private" / "protected" / "public" / "register"
    / "return" / "short" / "signed" / "sizeof" / "static" / "string"
    / "struct" / "switch" / "template" / "this" / "throw" / "true"
    / "try" / "typedef" / "typename" / "union" / "unsigned" / "using"
    / "virtual" / "void" / "volatile" / "while"
    ) ![a-zA-Z0-9_]

// ============================================================================
// Whitespace & Comments
// ============================================================================

_  = (Whitespace / LineComment / BlockComment)*
__ = (Whitespace / LineComment / BlockComment)+

Whitespace   = [ \t\r\n]
LineComment   = "//" [^\r\n]*
BlockComment  = "/*" (!"*/" .)* "*/"
