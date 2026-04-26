/**
 * CodeSense Shared Type Definitions
 * * These types are used across both frontend and backend to ensure
 * type safety and consistent data structures.
 */

// ============================================================================
// AST (Abstract Syntax Tree) Node Types
// ============================================================================

export type ASTNode =
  | ProgramNode | FunctionDeclNode | VariableDeclNode | ParameterNode | FunctionPrototypeNode
  | IntegerNode | FloatNode | CharNode | StringNode | IdentifierNode 
  | BinaryOpNode | WhileLoopNode | DoWhileLoopNode | ForLoopNode 
  | IfStatementNode | SwitchStatementNode | ReturnStatementNode | AssignmentNode
  | ArrayAccessNode | InitializerListNode | FunctionCallNode
  | UnaryOpNode | GlobalAccessNode | LoopControlNode
  | BlockNode | ExpressionStatementNode | StreamStatementNode
  | NewExpressionNode | DeleteStatementNode 
  | PreprocessorNode | CastExpressionNode | SizeofExpressionNode 
  | ConditionalExpressionNode | LambdaExpressionNode
  | RangeBasedForNode | TryStatementNode | CatchClauseNode
  | ThrowStatementNode;


export interface FunctionPrototypeNode extends BaseNode {
  type: 'FunctionPrototype';
  returnType: string;
  name: string;
  params: ParameterNode[];
  // Note: No body here, just like the C++ syntax
}

export interface BaseNode {
  type: string;
  line?: number;
  column?: number;
}

export interface ProgramNode extends BaseNode {
  type: 'Program';
  directives: PreprocessorNode[]; // Fixed: Added directives
  body: ASTNode[];
}

// ============================================================================
// Preprocessor Types (UPDATED: Full support)
// ============================================================================

export type PreprocessorNode = 
  | IncludeNode | DefineNode | UndefNode
  | IfDefNode | IfNDefNode | IfNode | ElIfNode | ElseNode | EndIfNode
  | PragmaNode | ErrorNode | WarningNode | LineNode;

export interface IncludeNode extends BaseNode {
  type: 'Include';
  name: string;
  isSystem?: boolean; // true for <>, false for ""
}

export interface DefineNode extends BaseNode {
  type: 'Define';
  name: string;
  value?: ASTNode | MacroTextNode;
}

export interface UndefNode extends BaseNode {
  type: 'Undef';
  name: string;
}

export interface IfDefNode extends BaseNode {
  type: 'IfDef';
  name: string;
}

export interface IfNDefNode extends BaseNode {
  type: 'IfNDef';
  name: string;
}

export interface IfNode extends BaseNode {
  type: 'If';
  condition: ASTNode;
}

export interface ElIfNode extends BaseNode {
  type: 'ElIf';
  condition: ASTNode;
}

export interface ElseNode extends BaseNode {
  type: 'Else';
}

export interface EndIfNode extends BaseNode {
  type: 'EndIf';
}

export interface PragmaNode extends BaseNode {
  type: 'Pragma';
  directive: PragmaDirectiveNode;
}

export interface ErrorNode extends BaseNode {
  type: 'Error';
  message: string;
}

export interface WarningNode extends BaseNode {
  type: 'Warning';
  message: string;
}

export interface NewExpressionNode extends BaseNode {
  type: 'NewExpression';
  baseType: string;
  size?: ASTNode; // For dynamic arrays: new int[n]
}

export interface DeleteStatementNode extends BaseNode {
  type: 'DeleteStatement';
  target: string;   // The name of the pointer being deleted
  isArray?: boolean; // For delete[]
}

export interface LineNode extends BaseNode {
  type: 'Line';
  lineNumber: number;
  filename?: string;
}

// Helper types for preprocessor
export interface MacroTextNode extends BaseNode {
  type: 'MacroText';
  value: string;
}

export interface DefinedNode extends BaseNode {
  type: 'Defined';
  name: string;
}

export type PragmaDirectiveNode = 
  | { type: 'PragmaOnce' }
  | { type: 'PragmaPack'; value: number }
  | { type: 'PragmaGeneric'; value: string };

// ============================================================================
// Structural Nodes
// ============================================================================

export interface BlockNode extends BaseNode {
  type: 'Block';
  statements: ASTNode[];
}

export interface FunctionDeclNode extends BaseNode {
  type: 'FunctionDecl';
  returnType: string;
  name: string;
  params: ParameterNode[]; // Fixed: Uses ParameterNode now
  body: ASTNode[];
}

export interface VariableDeclNode extends BaseNode {
  type: 'VariableDecl';
  varType: string;
  name: string;
  // FIX: Valid AST uses Nodes (e.g., [5] is an IntegerNode), not raw numbers
  dimensions?: ASTNode[]; 
  value?: ASTNode;
  modifiers?: string[];
}

// New: Distinct from VariableDecl to handle default values in function headers
export interface ParameterNode extends BaseNode {
  type: 'Parameter';
  varType: string;
  name: string;
  defaultValue?: ASTNode;
}

export interface ArrayAccessNode extends BaseNode {
  type: 'ArrayAccess';
  name: string;
  indices: ASTNode[]; 
}

export interface InitializerListNode extends BaseNode {
  type: 'InitializerList';
  values: ASTNode[]; 
}

// ============================================================================
// Literals
// ============================================================================

export interface IntegerNode extends BaseNode {
  type: 'Integer';
  value: number;
}

export interface FloatNode extends BaseNode {
  type: 'Float';
  value: number;
}

export interface CharNode extends BaseNode {
  type: 'Char';
  value: string;
}

export interface StringNode extends BaseNode {
  type: 'String';
  value: string;
}

export interface IdentifierNode extends BaseNode {
  type: 'Identifier';
  name: string;
}

// ============================================================================
// Statements & Control Flow
// ============================================================================

export interface FunctionCallNode extends BaseNode {
  type: 'FunctionCall';
  name: string;
  arguments: ASTNode[];
}

export interface GlobalAccessNode extends BaseNode {
  type: 'GlobalAccess';
  name: string;
}

export interface LoopControlNode extends BaseNode {
  type: 'LoopControl';
  value: 'break' | 'continue';
}

export interface BinaryOpNode extends BaseNode {
  type: 'BinaryOp';
  operator: string; // generalized to string to support bitwise if needed
  left: ASTNode;
  right: ASTNode;
}

export interface WhileLoopNode extends BaseNode {
  type: 'WhileLoop';
  condition: ASTNode;
  body: ASTNode[];
}

export interface DoWhileLoopNode extends BaseNode {
  type: 'DoWhileLoop';
  condition: ASTNode;
  body: ASTNode[];
}

export interface ForLoopNode extends BaseNode {
  type: 'ForLoop';
  init?: ASTNode;
  condition?: ASTNode;
  update?: ASTNode;
  body: ASTNode[];
}

export interface SwitchStatementNode extends BaseNode {
  type: 'SwitchStatement';
  condition: ASTNode;
  cases: CaseNode[];
}

export interface CaseNode extends BaseNode {
  type: 'Case' | 'DefaultCase';
  value?: ASTNode;
  statements: ASTNode[];
}

export interface IfStatementNode extends BaseNode {
  type: 'IfStatement';
  condition: ASTNode;
  thenBranch: ASTNode[];
  elseBranch?: ASTNode[];
}

export interface ReturnStatementNode extends BaseNode {
  type: 'ReturnStatement';
  value?: ASTNode;
}

export interface AssignmentNode extends BaseNode {
  type: 'Assignment';
  operator: string;
  // FIXED: Target can be a simple name (string) OR an array access (ASTNode)
  target: string | ASTNode; 
  value: ASTNode;
}

export interface ExpressionStatementNode extends BaseNode {
  type: 'ExpressionStatement';
  expression: ASTNode;
}

export interface StreamStatementNode extends BaseNode {
  type: 'CoutStatement' | 'CinStatement';
  // UPDATED: Support for chaining multiple items
  values?: ASTNode[];  // For cout: array of expressions (cout << a << b << c)
  targets?: (string | ASTNode)[]; // For cin: array of identifiers or ArrayAccess nodes (cin >> x >> arr[i])
  // DEPRECATED (kept for backward compatibility)
  value?: ASTNode; 
  target?: string; 
}

// ============================================================================
// Advanced Expressions (NEW)
// ============================================================================

export interface UnaryOpNode extends BaseNode {
  type: 'PreIncrement' | 'PostIncrement' | 'PreDecrement' | 'PostDecrement' | 'AddressOf' | 'Dereference';
  operand: string | ASTNode;
}

export interface CastExpressionNode extends BaseNode {
  type: 'CastExpression';
  targetType: string;
  operand: ASTNode;
}

export interface SizeofExpressionNode extends BaseNode {
  type: 'SizeofExpression';
  value: ASTNode;
}

export interface ConditionalExpressionNode extends BaseNode {
  type: 'ConditionalExpression'; // Ternary ? :
  condition: ASTNode;
  trueExpression: ASTNode;
  falseExpression: ASTNode;
}

export interface LambdaExpressionNode extends BaseNode {
  type: 'LambdaExpression';
  capture: string;
  body: ASTNode[];
}

// ============================================================================
// Lexical Tokens
// ============================================================================

export interface Token {
  type: 'Keyword' | 'Identifier' | 'Separator' | 'Operator' | 'Literal' | 'Comment';
  value: string;
  line?: number;
  column?: number;
}

// ============================================================================
// Symbol Table
// ============================================================================

export interface SymbolInfo {
 name: string;
  type: string;
  line: number;
  scope: string;
  initialized: boolean;
  isDefined?: boolean;
  kind: 'variable' | 'function' | 'parameter';
  dimensions?: number[];
}

export interface SymbolTable {
  [varName: string]: SymbolInfo;
}

// ============================================================================
// Analysis Results (UPDATED FOR FRONTEND INTEGRATION)
// ============================================================================

export interface SafetyCheck {
  line: number;
  operation: string;
  status: 'SAFE' | 'UNSAFE' | 'WARNING';
  message: string; // Removed '?' to ensure strictness in Table
  variable?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
}

export interface CFG {
  nodes: ControlFlowNode[];
  edges: GraphEdge[];
}

export interface SymbolicEntry {
  expression: string;
  value: string | number;
}

export interface AnalysisResult {
  success: boolean;
  
  // Phase 1
  tokens: Token[];
  ast: ASTNode | null;
  
  // Phase 2
  symbolTable?: SymbolInfo[] | Record<string, SymbolInfo>;
  safetyChecks: SafetyCheck[];
  explanations: string[]; 
  errors: AnalysisError[];
  
  // Phase 3
  cfg: CFG; 
  cognitiveComplexity: number;
  cyclomaticComplexity?: CyclomaticMetrics;

  // Phase 4: ADDED FOR MATH TAB
  symbolicExecution?: SymbolicEntry[];
  
  // Phase 5: Gamification
  gamification?: {
    xpEarned: number;
    levelTitle: string;
    qualityBonus: number;
  };
}

export interface AnalysisError {
  type: 'lexical' | 'syntactic' | 'semantic';
  message: string;
  line: number;
  column?: number;
  severity: 'error' | 'warning';
}

// ============================================================================
// Control Flow Graph
// ============================================================================

export interface ControlFlowNode {
  id: string;
  type: 'start' | 'end' | 'process' | 'decision' | 'input' | 'output';
  label: string;
  code?: string;
  line?: number;
  children: string[]; 
  tutorExplanation?: string;
  x: number; // FIXED: Made mandatory for Visualizer
  y: number; // FIXED: Made mandatory for Visualizer
  [key: string]: any;
}

// ============================================================================
// Gamification System
// ============================================================================

export interface ExplorerProfile {
  id: string;
  playerName: string;
  secretCode: string; 
  totalXP: number;
  currentLevel: 1 | 2 | 3 | 4 ;
  characterType: 'squire' | 'knight' | 'duke' | 'lord';
  createdAt: Date;
  lastActive: Date;
}

export interface QuestDefinition {
  id: string;
  level: 1 | 2 | 3;
  title: string;
  description: string;
  objectives: string[];
  starterCode?: string;
  expectedOutput?: string;
  hints: TutorialHint[];
  baseXP: number;
  requiredXP: number; 
}

export interface TutorialHint {
  errorCode: string; 
  clue: string;
  explanation: string;
  xpCost: number;
}

export interface MissionProgress {
  questId: string;
  status: 'active' | 'completed' | 'locked';
  attempts: number;
  hintsUsed: number;
  completedAt?: Date;
}

export interface LeaderboardEntry {
  playerName: string;
  totalXP: number;
  level: number;
  accuracy: number; 
  rank: number;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface AnalyzeCodeRequest {
  sourceCode: string;
  mode: 'sandbox' | 'campaign';
  questId?: string;
  userId?: string;
}

export interface AnalyzeCodeResponse {
  success: boolean;
  analysis?: AnalysisResult;
  questFeedback?: {
    isCorrect: boolean;
    xpEarned: number;
    qualityBonus: number;
    nextLevel?: boolean;
  };
  tutorialHint?: TutorialHint;
  error?: string;
}

export interface LoginRequest {
  playerName: string;
  secretCode: string;
}

export interface LoginResponse {
  success: boolean;
  token?: string;
  profile?: ExplorerProfile;
  error?: string;
}

export interface SignupRequest {
  playerName: string;
  secretCode: string;
  characterType: 'squire' | 'knight' | 'duke' | 'lord';
}

// ============================================================================
// Cognitive Complexity Metric
// ============================================================================

export interface ComplexityMetrics {
  totalScore: number;
  nestingDepth: number;
  controlFlowCount: number;
  maintainabilityRating: 'excellent' | 'good' | 'fair' | 'poor';
  suggestions: string[];
}

// ============================================================================
// CFG Layout (Sugiyama Framework)
// ============================================================================



export interface LayeredGraph {
  layers: ControlFlowNode[][];
  edges: GraphEdge[];
  width: number;
  height: number;
}

// ============================================================================
// NEW AST Node Types (Phase 2 grammar extensions)
// ============================================================================

export interface RangeBasedForNode extends BaseNode {
  type: 'RangeBasedFor';
  varType: string;
  name: string;
  range: ASTNode;
  body: ASTNode[];
}

export interface TryStatementNode extends BaseNode {
  type: 'TryStatement';
  body: ASTNode[];
  handlers: CatchClauseNode[];
}

export interface CatchClauseNode extends BaseNode {
  type: 'CatchClause';
  param: CatchParamNode | CatchAllNode;
  body: ASTNode[];
}

export interface CatchParamNode extends BaseNode {
  type: 'CatchParam';
  varType: string;
  name: string | null;
}

export interface CatchAllNode extends BaseNode {
  type: 'CatchAll';
}

export interface ThrowStatementNode extends BaseNode {
  type: 'ThrowStatement';
  value?: ASTNode;
}

// ============================================================================
// Cyclomatic Complexity (added to AnalysisResult)
// ============================================================================
export interface CyclomaticMetrics {
  score: number;           // V(G) = edges - nodes + 2*connected_components
  edges: number;
  nodes: number;
  rating: 'low' | 'moderate' | 'high' | 'very high';
  interpretation: string;
}