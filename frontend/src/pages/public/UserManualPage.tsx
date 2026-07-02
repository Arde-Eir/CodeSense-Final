import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/components/AuthContext'
import { resolveTier, tierColor, tierLabel } from '@/services/Roles'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ManualSection {
  id: string
  icon: string
  title: string
  summary: string
  content: React.ReactNode
}

// ─── Rule table (defined FIRST so SECTIONS can reference it) ─────────────────

const RULES: { code: string; severity: 'UNSAFE' | 'WARNING' | 'SAFE'; desc: string }[] = [
  { code: 'UNINITIALIZED_READ',     severity: 'UNSAFE',  desc: 'Variable read before a value is assigned in every reachable path.' },
  { code: 'ARRAY_OOB',              severity: 'UNSAFE',  desc: 'Array index provably exceeds the declared size (constant bounds).' },
  { code: 'NULL_DEREF',             severity: 'UNSAFE',  desc: 'Pointer dereferenced after being assigned NULL / nullptr.' },
  { code: 'DIV_BY_ZERO',            severity: 'UNSAFE',  desc: 'Divisor is a literal 0 or an expression proven to evaluate to 0.' },
  { code: 'USE_AFTER_FREE',         severity: 'UNSAFE',  desc: 'Memory accessed after delete / free on the same control flow path.' },
  { code: 'MEMORY_LEAK',            severity: 'WARNING', desc: 'new / malloc with no matching delete / free on at least one exit path.' },
  { code: 'UNUSED_VARIABLE',        severity: 'WARNING', desc: 'Variable declared and assigned but never read.' },
  { code: 'SHADOWED_IDENTIFIER',    severity: 'WARNING', desc: 'Inner scope redeclares an identifier from an outer scope.' },
  { code: 'IMPLICIT_NARROWING',     severity: 'WARNING', desc: 'Wider type assigned to a narrower type without an explicit cast.' },
  { code: 'UNREACHABLE_CODE',       severity: 'WARNING', desc: 'Statement follows return/break/continue with no label in between.' },
  { code: 'RECURSIVE_NO_BASE_CASE', severity: 'WARNING', desc: 'Recursion detected but every path recurses — likely stack overflow.' },
  { code: 'SAFE_LOOP_BOUND',        severity: 'SAFE',    desc: 'Loop bound is a constant or provably finite expression.' },
]

const RuleTable: React.FC = () => (
  <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, background: 'rgba(255,255,255,0.02)', borderRadius: 8, overflow: 'hidden' }}>
    <thead>
      <tr>
        <th style={{ textAlign: 'left', padding: '8px 12px', color: '#484f58', fontSize: 10, letterSpacing: 1, borderBottom: '1px solid #21262d' }}>RULE CODE</th>
        <th style={{ textAlign: 'left', padding: '8px 12px', color: '#484f58', fontSize: 10, letterSpacing: 1, borderBottom: '1px solid #21262d' }}>SEVERITY</th>
        <th style={{ textAlign: 'left', padding: '8px 12px', color: '#484f58', fontSize: 10, letterSpacing: 1, borderBottom: '1px solid #21262d' }}>FIRES WHEN</th>
      </tr>
    </thead>
    <tbody>
      {RULES.map(r => (
        <tr key={r.code}>
          <td style={{ padding: '8px 12px', color: '#e6edf3', borderBottom: '1px solid #161b22', whiteSpace: 'nowrap' }}>{r.code}</td>
          <td style={{ padding: '8px 12px', borderBottom: '1px solid #161b22' }}>
            <span style={{
              display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
              background: r.severity === 'UNSAFE' ? 'rgba(248,81,73,0.12)' : r.severity === 'WARNING' ? 'rgba(255,167,38,0.12)' : 'rgba(76,175,80,0.12)',
              color:      r.severity === 'UNSAFE' ? '#f85149' : r.severity === 'WARNING' ? '#ffa726' : '#4caf50',
              border:    `1px solid ${r.severity === 'UNSAFE' ? 'rgba(248,81,73,0.35)' : r.severity === 'WARNING' ? 'rgba(255,167,38,0.35)' : 'rgba(76,175,80,0.35)'}`,
            }}>{r.severity}</span>
          </td>
          <td style={{ padding: '8px 12px', color: '#8b949e', borderBottom: '1px solid #161b22' }}>{r.desc}</td>
        </tr>
      ))}
    </tbody>
  </table>
)

// ─── Roles access matrix (defined BEFORE SECTIONS) ───────────────────────────

const ROLES_MATRIX: { feature: string; tiers: Record<string, boolean> }[] = [
  { feature: 'Sandbox + CFG',                   tiers: { Guest: true,  Student: true,  Professional: true,  Admin: true  } },
  { feature: 'Tutorials',                       tiers: { Guest: true,  Student: true,  Professional: true,  Admin: true  } },
  { feature: 'User Manual',                     tiers: { Guest: true,  Student: true,  Professional: true,  Admin: true  } },
  { feature: 'Campaign quests',                 tiers: { Guest: false, Student: true,  Professional: true,  Admin: true  } },
  { feature: 'Progress report',                 tiers: { Guest: false, Student: true,  Professional: true,  Admin: true  } },
  { feature: 'Leaderboard',                     tiers: { Guest: false, Student: true,  Professional: true,  Admin: true  } },
  { feature: 'Profile settings',                tiers: { Guest: false, Student: true,  Professional: true,  Admin: true  } },
  { feature: 'Admin Panel (ban / impersonate)', tiers: { Guest: false, Student: false, Professional: false, Admin: true  } },
  { feature: 'System metrics',                  tiers: { Guest: false, Student: false, Professional: false, Admin: true  } },
  { feature: 'Global user data',                tiers: { Guest: false, Student: false, Professional: false, Admin: true  } },
]

const RolesMatrix: React.FC = () => (
  <div style={{ overflowX: 'auto' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: 'rgba(255,255,255,0.02)', borderRadius: 8, overflow: 'hidden' }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left', padding: '10px 14px', color: '#484f58', fontSize: 10, letterSpacing: 1, borderBottom: '1px solid #21262d' }}>FEATURE</th>
          {['Guest', 'Student', 'Professional', 'Admin'].map(t => (
            <th key={t} style={{ textAlign: 'center', padding: '10px 14px', color: '#484f58', fontSize: 10, letterSpacing: 1, borderBottom: '1px solid #21262d' }}>{t}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ROLES_MATRIX.map(r => (
          <tr key={r.feature}>
            <td style={{ padding: '10px 14px', color: '#e6edf3', borderBottom: '1px solid #161b22' }}>{r.feature}</td>
            {['Guest', 'Student', 'Professional', 'Admin'].map(t => (
              <td key={t} style={{ textAlign: 'center', padding: '10px 14px', borderBottom: '1px solid #161b22' }}>
                {r.tiers[t]
                  ? <span style={{ color: '#4caf50', fontWeight: 700 }}>✓</span>
                  : <span style={{ color: '#484f58' }}>—</span>}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

// ─── Shared UI helpers ───────────────────────────────────────────────────────

const Callout: React.FC<{ color: string; icon: string; title: string; children: React.ReactNode }> = ({ color, icon, title, children }) => (
  <div style={{
    background: `${color}0F`, border: `1px solid ${color}44`,
    borderLeft: `3px solid ${color}`, borderRadius: 8,
    padding: '12px 14px', margin: '10px 0', fontSize: 13, lineHeight: 1.7, color: '#c9d1d9',
  }}>
    <b style={{ color }}>{icon} {title}</b>{' '}{children}
  </div>
)

const DataTable: React.FC<{ headers: string[]; rows: (React.ReactNode)[][] }> = ({ headers, rows }) => (
  <div style={{ overflowX: 'auto', margin: '10px 0' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: 'rgba(255,255,255,0.02)', borderRadius: 8, overflow: 'hidden' }}>
      <thead>
        <tr>{headers.map(h => (
          <th key={h} style={{ textAlign: 'left', padding: '9px 12px', color: '#484f58', fontSize: 10, letterSpacing: 1, borderBottom: '1px solid #21262d' }}>{h}</th>
        ))}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => (
            <td key={j} style={{ padding: '9px 12px', color: '#c9d1d9', borderBottom: '1px solid #161b22' }}>{c}</td>
          ))}</tr>
        ))}
      </tbody>
    </table>
  </div>
)

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd style={{
    background: '#21262d', border: '1px solid #30363d', borderBottom: '2px solid #30363d',
    borderRadius: 4, padding: '1px 6px', fontSize: 11, fontFamily: "'IBM Plex Mono', monospace",
    color: '#e6edf3',
  }}>{children}</kbd>
)

// ─── Manual sections (defined AFTER shared components) ───────────────────────

const SECTIONS: ManualSection[] = [
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'what-is',
    icon: '🧭',
    title: 'What CodeSense Is',
    summary: 'One paragraph. No buzzwords.',
    content: (
      <>
        <p>
          CodeSense is a <b>deterministic, rule-based C++ analyzer</b> wrapped
          in a gamified learning environment. It does <u>not</u> run your code,
          does <u>not</u> call an LLM, and does <u>not</u> use heuristics. Every
          verdict — <span style={{ color: '#4caf50' }}>SAFE</span>,{' '}
          <span style={{ color: '#ffa726' }}>WARNING</span>,{' '}
          <span style={{ color: '#f85149' }}>UNSAFE</span> — comes from a fixed
          set of rules applied to the AST and CFG of your program. Same input →
          same output. Always.
        </p>
        <p>
          On top of the analyzer sit: a <b>flowchart-to-C++ Build Mode</b>, a{' '}
          <b>Campaign</b> of XP-earning quests, a <b>Leaderboard</b>, an{' '}
          <b>Admin Panel</b> (ban / impersonate / maintenance), a{' '}
          <b>Notification bell</b> for system announcements, and tier-based{' '}
          <b>Roles &amp; Access</b> control.
        </p>
        <Callout color="#4caf50" icon="✓" title="The promise:">
          If a rule flags your code, you can trace exactly which rule fired, on
          which line, and why. No black box.
        </Callout>
      </>
    ),
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'quick-start',
    icon: '🚀',
    title: 'Quick Start (60 seconds)',
    summary: 'The shortest path from zero to your first verdict.',
    content: (
      <>
        <ol style={{ paddingLeft: 20, lineHeight: 2 }}>
          <li>Open <b>Dashboard → Sandbox</b>. Monaco loads with a starter snippet.</li>
          <li>Click the yellow <b>ANALYZE</b> button (top of the editor).</li>
          <li>
            Inspect the seven tabs on the right: <b>Tokens, AST, Symbols, CFG,
            Math, Logs, Validation</b>. Each one shows a snapshot of a specific
            pipeline stage.
          </li>
          <li>
            Click any node in the <b>CFG</b> tab — the editor highlights the
            source line. Red edges mean a rule fired there.
          </li>
        </ol>
        <Callout color="#58a6ff" icon="💡" title="Tip:">
          The Dashboard's <b>Command Center → Quick Start</b> card restores your
          last analyzed snippet into the Sandbox editor, so you can resume
          mid-thought.
        </Callout>
      </>
    ),
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'pipeline',
    icon: '⚙️',
    title: 'The Analysis Pipeline',
    summary: 'Five deterministic stages from source text to verdict.',
    content: (
      <>
        <DataTable
          headers={['#', 'STAGE', 'WHAT IT DOES', 'FAILS IF…']}
          rows={[
            ['1', <b>Lexer</b>,       'Splits source into tokens: keywords, identifiers, literals, operators.', 'Unterminated string / invalid char.'],
            ['2', <b>Parser</b>,      'Builds the AST. Every statement becomes a typed node.',                    'Unbalanced braces / missing semicolon → error with exact line + column.'],
            ['3', <b>Symbol table</b>,'Records every variable, function, and parameter with type + scope.',       'Duplicate declaration / use before declare (collected as WARNING).'],
            ['4', <b>CFG</b>,         'Connects statements by execution order. Loops become back-edges, if/else become branches.', 'Skipped if parser failed.'],
            ['5', <b>Rule engine</b>, 'Walks AST + CFG and fires each rule. Output: SafetyCheck[] with line numbers.', 'Never — it only reports; it does not crash your program.'],
          ]}
        />
        <Callout color="#a371f7" icon="ℹ" title="On top of the 5 stages:">
          The backend also computes <b>cognitive complexity</b> and{' '}
          <b>cyclomatic complexity</b> scores (shown in the Math tab and saved
          with every report).
        </Callout>
      </>
    ),
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'tabs',
    icon: '🔍',
    title: 'The Seven Analyzer Tabs',
    summary: 'What each tab shows and when to look at it.',
    content: (
      <>
        <DataTable
          headers={['TAB', 'WHAT IT SHOWS', 'LOOK HERE WHEN…']}
          rows={[
            [<b>🔤 Tokens</b>,     'Lexer output: every token with type, value, line, column.',         '…you suspect a typo changed a keyword into an identifier.'],
            [<b>🌳 AST</b>,        'JSON tree of the parsed structure. Collapsible nodes.',             '…the parser ran but the code "looks wrong" — the AST shows what was actually parsed.'],
            [<b>🔣 Symbols</b>,    'Symbol table: declared type, scope, initialized flag.',             '…you need to confirm a variable\'s declared type or scope reach.'],
            [<b>🕸 CFG</b>,         'Interactive flowchart of execution order (ReactFlow + ELK).',       '…you want to see which paths the rule engine walked.'],
            [<b>Σ Math</b>,        'Cognitive + cyclomatic complexity, plus symbolic execution values.', '…you want hard metrics on code maintainability.'],
            [<b>📟 Logs</b>,       'Lexical, syntactic, semantic errors + warnings.',                   '…CFG is empty — parser failed; read the errors here first.'],
            [<b>✓ Validation</b>,  'Build Mode: blocking issues before C++ codegen.',                   '…GENERATE C++ is disabled and you need to know why.'],
          ]}
        />
      </>
    ),
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'rules',
    icon: '📜',
    title: 'All Safety Rules',
    summary: 'Every rule that can fire, with severity and trigger condition.',
    content: (
      <>
        <p style={{ color: '#8b949e', fontSize: 13 }}>
          If your code isn't flagged, <b>none of the rules below matched</b>.
          That's the deterministic guarantee — silence means clean, not
          "probably fine".
        </p>
        <RuleTable />
        <Callout color="#f85149" icon="⚠" title="UNSAFE blocks merge. WARNING lets it through.">
          In Campaign quests, any UNSAFE rule firing fails the objective. A
          WARNING drops the XP bonus but still counts as a completion.
        </Callout>
      </>
    ),
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'cfg',
    icon: '🕸',
    title: 'Control Flow Graph — Zoom, Pan, Lock',
    summary: 'How to navigate the graph and what the visual cues mean.',
    content: (
      <>
        <p>
          Every executable statement becomes a <b>node</b>. Conditions get two
          outgoing edges (<span style={{ color: '#4caf50' }}>true</span> /{' '}
          <span style={{ color: '#ff6b6b' }}>false</span>). Loops draw a
          back-edge to their condition. Recursion shows up as a cycle.
        </p>
        <DataTable
          headers={['VISUAL', 'MEANING']}
          rows={[
            [<span style={{ color: '#42a5f5' }}>● Blue terminator</span>,        'Start / End node — always exactly one Start in a valid graph.'],
            [<span style={{ color: '#ffa726' }}>◆ Orange diamond</span>,        'Decision — will have true/false outgoing edges.'],
            [<span style={{ color: '#e040fb' }}>◇ Purple diamond (Junction)</span>, 'Merge point after if / switch / try-catch branches — auto-generated.'],
            [<span style={{ color: '#26c6da' }}>● Teal circle (Connector)</span>,   'On-page reference — auto-generated for break / continue statements.'],
            [<span style={{ color: '#ffca28' }}>⬠ Yellow pentagon (Off-page)</span>,'Cross-page continuation/reference, not a function-call shape.'],
            [<span style={{ color: '#ab47bc' }}>▭ Purple rectangle (Predefined)</span>,'Function/subroutine/helper call — auto-generated from C++ call expressions.'],
            [<span style={{ color: '#4caf50' }}>Green edge (animated)</span>,   'Path you have already visited by clicking its source node.'],
            [<span style={{ color: '#ff4444' }}>Red pulsing edge</span>,        'A rule fired on the target node — click it to jump to the source line.'],
            [<span style={{ color: '#64b5f6' }}>Blue edge</span>,                'Default, unvisited path.'],
          ]}
        />
        <h4 style={{ color: '#e6edf3', fontSize: 14, marginTop: 18, marginBottom: 6 }}>Canvas controls</h4>
        <DataTable
          headers={['ACTION', 'HOW']}
          rows={[
            ['Zoom in / out',    <>Mouse-wheel · pinch · <Kbd>+</Kbd> / <Kbd>−</Kbd> in the bottom-right control strip.</>],
            ['Pan the canvas',   'Click + drag on empty space (disabled when Locked).'],
            ['Move a node',      'Click + drag the node (disabled when Locked, or always in Analyze mode).'],
            ['Fit all to view',  'Bottom-right Controls → the centering icon.'],
            ['Lock / Unlock',    <>Bottom-left <b>🔓 UNLOCKED ↔ 🔒 LOCKED</b> pill. Freezes drag + pan; <b>zoom still works</b>.</>],
            ['Edit a node',      'Double-click (Build Mode only).'],
            ['Label an edge',    'Double-click the edge — useful for decision true/false.'],
            ['Delete selection', <><Kbd>Backspace</Kbd> while a node or edge is selected (Build Mode only).</>],
          ]}
        />
        <Callout color="#e3b341" icon="⚠" title="Large-graph guardrails:">
          The visualiser warns at <b>200+ nodes</b> (yellow banner) and hard-caps
          at <b>1,000 rendered nodes</b>. Duplicate IDs are deduplicated and
          edges pointing to deleted nodes are dropped before rendering, so a
          malformed CFG payload will degrade gracefully instead of crashing.
        </Callout>
      </>
    ),
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'build-mode',
    icon: '🧩',
    title: 'Build Mode — Flowchart → C++',
    summary: 'A canvas-first workspace for drawing logic and generating readable C++.',
    content: (
      <>
        <p>
          Toggle <b>Build Flowchart</b> in the Sandbox header. The canvas becomes
          the main workspace, and the generated output/manual sit in the side
          rail. Collapse that rail when you want maximum drawing room.
        </p>
        <Callout color="#58a6ff" icon="?" title="Quick in-canvas help:">
          Use the <b>? GUIDE</b> button inside the canvas for a small tutorial,
          sentence examples, and a shape cheat sheet without leaving Build Mode.
        </Callout>

        <h4 style={{ color: '#e6edf3', fontSize: 14, marginTop: 14, marginBottom: 6 }}>Recommended workflow</h4>
        <DataTable
          headers={['STEP', 'ACTION', 'WHY IT HELPS']}
          rows={[
            ['1', 'Add Start, then the main steps, then End.', 'The validator needs one clear entry and exit.'],
            ['2', 'Use Process for variables/math, Input for cin, Output for cout, Decision for conditions.', 'Shape choice tells the generator what kind of C++ to emit.'],
            ['3', 'Double-click each node and type C++ or a simple sentence.', 'The generator accepts beginner-friendly English for common actions.'],
            ['4', 'Connect each node in execution order.', 'Code generation follows the connected path from Start.'],
            ['5', 'Let decision edges auto-label true/false, or double-click an edge to edit it.', 'Branch labels decide which block becomes if and else.'],
            ['6', 'Click Generate C++, then Load & Analyze.', 'This sends the produced code through the normal analyzer tabs.'],
          ]}
        />

        <h4 style={{ color: '#e6edf3', fontSize: 14, marginTop: 18, marginBottom: 6 }}>Human sentences the generator understands</h4>
        <DataTable
          headers={['TYPE THIS', 'C++ GENERATED']}
          rows={[
            [<code>create integer age equals 18</code>, <code>int age = 18;</code>],
            [<code>create text full name equals Ada Lovelace</code>, <code>string fullName = "Ada Lovelace";</code>],
            [<code>set total to price plus tax</code>, <code>total = price + tax;</code>],
            [<code>increase score by 10</code>, <code>score += 10;</code>],
            [<code>ask for user age</code>, <code>cin &gt;&gt; userAge;</code>],
            [<code>print too young</code>, <code>cout &lt;&lt; "too young" &lt;&lt; endl;</code>],
            [<code>if user age is greater than 17</code>, <code>if (userAge &gt; 17)</code>],
          ]}
        />

        <h4 style={{ color: '#e6edf3', fontSize: 14, marginTop: 14, marginBottom: 6 }}>The twelve ISO 5807 shapes</h4>
        <DataTable
          headers={['SHAPE', 'NAME', 'USED FOR / AUTO-GENERATED FROM']}
          rows={[
            [<span style={{ color: '#42a5f5' }}>◯</span>, 'Terminator',        'Start / End. Every graph needs exactly one Start and at least one End.'],
            [<span style={{ color: '#4caf50' }}>▭</span>, 'Process',           'Assignments, expressions, general statements.'],
            [<span style={{ color: '#ffa726' }}>◆</span>, 'Decision',          'if / while / for conditions. Must have true/false outgoing edges.'],
            [<span style={{ color: '#64b5f6' }}>▱</span>, 'I/O',               'Generic output — defaults to cout.'],
            [<span style={{ color: '#ab47bc' }}>▭</span>, 'Predefined',        'Function/subroutine/helper call. Auto-generated from C++ function-call expressions.'],
            [<span style={{ color: '#26c6da' }}>●</span>, 'Connector',         'On-page reference. Auto-generated for break / continue statements.'],
            [<span style={{ color: '#ffca28' }}>⬠</span>, 'Off-page Connector','Cross-page continuation/reference, not a function-call shape.'],
            [<span style={{ color: '#ef5350' }}>▭</span>, 'Document',          'Write to file / generate a report.'],
            [<span style={{ color: '#ff7043' }}>▱</span>, 'Manual Input',      'cin / user input.'],
            [<span style={{ color: '#78909c' }}>◗</span>, 'Delay',             'sleep_for / wait.'],
            [<span style={{ color: '#66bb6a' }}>⚉</span>, 'Database',          'Array / vector / map access.'],
            [<span style={{ color: '#e040fb' }}>◇</span>, 'Junction',          'Merge point after if/switch/try branches. Auto-generated from analysis.'],
          ]}
        />

        <h4 style={{ color: '#e6edf3', fontSize: 14, marginTop: 18, marginBottom: 6 }}>Validator rules (all 11)</h4>
        <p style={{ color: '#8b949e', fontSize: 12 }}>
          The validator runs before code generation. Errors block output because
          the graph structure is ambiguous. Warnings still allow generation and
          usually mean the generator will use a label, default, or safe comment.
        </p>
        <DataTable
          headers={['CODE', 'SEVERITY', 'TRIGGER']}
          rows={[
            ['EMPTY_GRAPH',               'error',   'Canvas has no nodes.'],
            ['NO_START_NODE',             'error',   'No terminator labelled Start.'],
            ['MULTIPLE_START_NODES',      'error',   'More than one Start — ambiguous entry.'],
            ['NO_END_NODE',               'error',   'No terminator that isn\'t Start.'],
            ['ISOLATED_NODES',            'error',   'Nodes with zero edges — dropped by the generator.'],
            ['UNREACHABLE_NODES',         'error',   'Nodes not reachable from Start via forward traversal.'],
            ['START_NOT_CONNECTED',       'error',   'Start has no outgoing edge.'],
            ['END_NOT_CONNECTED / END_HAS_OUTGOING_EDGE', 'error', 'End has no inbound, or has outbound edges.'],
            ['DECISION_NO_EDGES / SINGLE / UNLABELLED / DUPLICATE', 'error', 'Decision missing both branches, or labels not "true" / "false".'],
            ['DEAD_END_NODES',            'error',   'Non-terminator node with no outgoing edge — execution stuck.'],
            ['DANGLING_EDGES',            'error',   'Edge points to a node that was deleted.'],
            ['DECISION_EMPTY_CONDITION', 'error', 'Decision text is empty, placeholder, or malformed.'],
            ['MISSING_NODE_CODE / NODE_CODE_FROM_LABEL', 'warning', 'Executable node has no code field; generation uses the label, default statement, or safe comment.'],
          ]}
        />
      </>
    ),
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'campaign',
    icon: '⚔️',
    title: 'Campaign, Quests & XP',
    summary: 'How gamification works — and where your XP actually comes from.',
    content: (
      <>
        <p>
          Campaign is a sequence of <b>quests</b> grouped by phase:{' '}
          <b>beginner → intermediate → advanced</b>. Each quest has objectives,
          starter code, and a list of hints with an XP cost per hint used.
        </p>
        <DataTable
          headers={['EARN XP BY', 'AMOUNT']}
          rows={[
            ['Completing a quest',              'Base XP defined on the quest (varies).'],
            ['Completing without hints',        'Full bonus.'],
            ['Using one or more hints',         'XP minus each hint\'s cost.'],
            ['Running a sandbox analysis',      'Tracked as activity (no XP, but counts toward achievements).'],
          ]}
        />
        <Callout color="#ffa726" icon="⚔" title="Quest flow:">
          Campaign page → pick phase → pick quest → Lesson Activity loads the
          starter code into Monaco → you edit → click ANALYZE → if the rule
          engine returns no UNSAFE hits, the quest is marked complete and XP
          is awarded.
        </Callout>
      </>
    ),
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'ranks',
    icon: '🏆',
    title: 'Ranks, Titles & Unlocks',
    summary: 'Five ranks. XP unlocks the title; you choose which one to display.',
    content: (
      <>
        <DataTable
          headers={['LEVEL', 'RANK', 'XP NEEDED', 'ICON']}
          rows={[
            ['1', <span style={{ color: '#8b949e', fontWeight: 700 }}>Squire</span>, '0',       '🛡️'],
            ['2', <span style={{ color: '#58a6ff', fontWeight: 700 }}>Knight</span>, '5,000',   '⚔️'],
            ['3', <span style={{ color: '#a371f7', fontWeight: 700 }}>Lord</span>,   '20,000',  '🌟'],
            ['4', <span style={{ color: '#e3b341', fontWeight: 700 }}>Duke</span>,   '75,000',  '👑'],
            ['5', <span style={{ color: '#ffd700', fontWeight: 700 }}>King</span>,   '250,000', '🔱'],
          ]}
        />
        <Callout color="#4caf50" icon="🎨" title="Cosmetic, not locked:">
          Everyone starts as Squire. As you cross an XP threshold, the next
          title unlocks. You can display any already-unlocked title — pick it
          in <b>Profile → Settings → Displayed Title</b>. A level-5 King can
          still wear the Squire title if they want to throw off the
          leaderboard.
        </Callout>
      </>
    ),
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'achievements',
    icon: '🏅',
    title: 'Achievement Badges',
    summary: 'Twelve badges across four rarities. Criteria are explicit.',
    content: (
      <>
        <DataTable
          headers={['BADGE', 'RARITY', 'REQUIREMENT']}
          rows={[
            ['🌱 First Boot',        <span style={{ color: '#8b949e' }}>Common</span>,    'Join CodeSense.'],
            ['🔬 First Analysis',    <span style={{ color: '#8b949e' }}>Common</span>,    'Run 1 sandbox analysis.'],
            ['⚗️ Lab Regular',       <span style={{ color: '#8b949e' }}>Common</span>,    'Run 10 sandbox analyses.'],
            ['🧪 Code Scientist',    <span style={{ color: '#58a6ff' }}>Rare</span>,     'Run 25 sandbox analyses.'],
            ['🔭 Master Analyst',    <span style={{ color: '#a371f7' }}>Epic</span>,     'Run 50 sandbox analyses.'],
            ['⚔️ First Quest',       <span style={{ color: '#8b949e' }}>Common</span>,    'Complete 1 quest.'],
            ['🛡️ Quest Knight',      <span style={{ color: '#58a6ff' }}>Rare</span>,     'Complete 5 quests.'],
            ['🏆 Quest Champion',    <span style={{ color: '#a371f7' }}>Epic</span>,     'Complete 10 quests.'],
            ['⚔️ Rising Knight',     <span style={{ color: '#8b949e' }}>Common</span>,    'Earn 1,000 XP.'],
            ['🌟 Noble Lord',        <span style={{ color: '#58a6ff' }}>Rare</span>,     'Earn 4,000 XP.'],
            ['👑 Grand Duke',        <span style={{ color: '#a371f7' }}>Epic</span>,     'Earn 10,000 XP.'],
            ['🔱 Legendary King',    <span style={{ color: '#ffc107' }}>Legendary</span>, 'Earn 25,000 XP.'],
          ]}
        />
      </>
    ),
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'profile',
    icon: '👤',
    title: 'Profile Settings',
    summary: 'Five tabs, avatar crop, password change, and the danger zone.',
    content: (
      <>
        <DataTable
          headers={['TAB', 'CONTAINS']}
          rows={[
            [<b>📋 Overview</b>,    'Animated XP progress bar, 4 stat chips (XP, analyses, quests, rank), About (member since, email).'],
            [<b>🏅 Achievements</b>, 'All 12 badges with rarity + progress bar. Locked badges are dimmed.'],
            [<b>📈 Activity</b>,    'Merged timeline of recent reports + completed quests, sorted by date. Click the icon to see details.'],
            [<b>⚙️ Settings</b>,    'Displayed title picker (unlocked titles only), user type, password change, danger zone.'],
            [<b>📚 Learn</b>,       '5-step rank progression path + how-to-earn-XP cheat sheet.'],
          ]}
        />
        <h4 style={{ color: '#e6edf3', fontSize: 14, marginTop: 16, marginBottom: 6 }}>Avatar & banner</h4>
        <ul style={{ paddingLeft: 20, lineHeight: 1.9 }}>
          <li>Click the banner to replace it. JPG/PNG/WEBP under <b>2 MB</b>.</li>
          <li>Click the avatar → circular crop modal. Drag to position, scroll or use the slider to zoom, hit <b>✓ Apply</b>.</li>
          <li>Avatars are stored as <b>WebP at 92% quality</b> in the Supabase <code>Avatars</code> bucket under <code>{`{userId}/avatar.webp`}</code>.</li>
        </ul>
        <h4 style={{ color: '#e6edf3', fontSize: 14, marginTop: 16, marginBottom: 6 }}>Password change</h4>
        <ul style={{ paddingLeft: 20, lineHeight: 1.9 }}>
          <li>Runs via <code>supabase.auth.updateUser()</code>. No plaintext ever leaves the browser.</li>
          <li>Minimum 8 characters, confirmed with a match field.</li>
        </ul>
        <Callout color="#f85149" icon="⚠" title="Danger Zone (Delete Account):">
          You must type your <b>exact player name</b> into the confirmation box
          before the Confirm Delete button activates. Deletion logs you out and
          redirects to the landing page.
        </Callout>
      </>
    ),
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'leaderboard',
    icon: '🎖',
    title: 'Leaderboard',
    summary: 'Sorts, filters, player detail modal, realtime updates.',
    content: (
      <>
        <p>
          The leaderboard subscribes to the <b>users</b> table via Supabase
          realtime, so rank changes reflect within seconds — no refresh needed.
        </p>
        <DataTable
          headers={['CONTROL', 'BEHAVIOUR']}
          rows={[
            ['Stats strip',      'Total players, average XP, top XP, active today (last 24h).'],
            ['Sort dropdown',    'Highest XP · Highest Level · Most Active · Recently Joined.'],
            ['Filter chips',     'Everyone · 🎓 Students · 💼 Professionals (uses user_type column).'],
            ['Podium',           'Top 3 visual (only when sorted by XP, page 0, no filter). Click any avatar → detail modal.'],
            ['Search',           'Debounced 300ms, case-insensitive, ilike match on playername.'],
            ['Row click',        'Opens a player detail modal: XP progress bar, 3 stat cards, last-active time, online indicator (< 30 min).'],
            ['Share Rank',       'Copies a formatted rank card to the clipboard.'],
            ['Pagination',       '20 per page with first/prev/5-numbered/next/last controls (disabled during search).'],
          ]}
        />
      </>
    ),
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'dashboard',
    icon: '🏠',
    title: 'Home Dashboard & Command Center',
    summary: 'The layout map of your hub.',
    content: (
      <>
        <DataTable
          headers={['ZONE', 'WHAT IT DOES']}
          rows={[
            ['🔍 Search bar',          'Unified search across actions, players, quests, and your own reports (300ms debounce, AbortController-guarded).'],
            ['🔔 Bell',                'Notification dropdown with unread badge (pulsing). See §🔔 Notifications.'],
            ['👤 Profile dropdown',    'Profile Image · Announcements · Progress · Tutorials · User Manual · About · (Admin Panel if admin) · Log Out.'],
            ['Hero',                   'Personalised greeting with your current rank.'],
            ['Mode Cards',             'Sandbox · Campaign Mode (Campaign is locked for guests).'],
            ['🎯 Command Center',      'Quick Start (reloads last snippet) · Tutorials link · 3 stat chips · Recent Project History · User Manual / Progress shortcuts.'],
            ['🏆 Leaderboard mini',    'Top 10 by XP with your rank highlighted; button to full leaderboard.'],
          ]}
        />
      </>
    ),
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'notifications',
    icon: '🔔',
    title: 'Notifications & Announcements',
    summary: 'How the bell and the announcements system talk to each other.',
    content: (
      <>
        <ul style={{ paddingLeft: 20, lineHeight: 1.9 }}>
          <li>The bell fetches the <b>10 most recent</b> announcements and subscribes to realtime changes (new inserts appear without refresh).</li>
          <li>A red pulsing badge shows unread count (capped at 99).</li>
          <li>Clicking the bell marks shown items as seen. "Mark all read" clears everything.</li>
          <li>Seen IDs persist in <code>localStorage</code> under key <code>cs-seen-announcements-v1</code> — survives refresh.</li>
          <li>"View all announcements →" opens a full modal with the complete history.</li>
        </ul>
        <DataTable
          headers={['PRIORITY', 'COLOUR', 'USED FOR']}
          rows={[
            [<span style={{ color: '#64b5f6' }}>ℹ️ Info</span>,       'Blue',   'General news, new features.'],
            [<span style={{ color: '#4caf50' }}>✅ Success</span>,     'Green',  'Resolved incidents, launches.'],
            [<span style={{ color: '#ffa726' }}>⚠️ Warning</span>,     'Orange', 'Upcoming maintenance, degraded service.'],
            [<span style={{ color: '#f85149' }}>🚨 Critical</span>,    'Red',    'Immediate issues — you should read this now.'],
          ]}
        />
      </>
    ),
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'admin',
    icon: '🛡',
    title: 'Admin Panel & Moderation',
    summary: 'What admins can do — and what guardrails protect against mistakes.',
    content: (
      <>
        <p>
          The Admin Panel (<code>/admin</code>) uses Bootstrap-based Tabler UI
          on a white theme, loaded from CDN only while the panel is open.
        </p>
        <DataTable
          headers={['TAB', 'DOES']}
          rows={[
            [<b>Dashboard</b>,     '4 KPI cards (Total / Active / Banned / Admins) + last 10 audit entries.'],
            [<b>Users</b>,         'Full user list with search + filter (All / Active / Banned / Admins). Per-row actions: Ban (with reason) · Unban · Make/Revoke Admin · Preview.'],
            [<b>Audit Logs</b>,   'Every admin action ever taken, with admin name, target, details, timestamp. FK-joined when possible, plain-select fallback otherwise.'],
            [<b>Maintenance</b>,  'Toggle maintenance banner site-wide + edit the message. Live preview card beside it.'],
            [<b>Announcements</b>,'Create / delete announcements with priority + pin. Appears instantly in the notification bell.'],
          ]}
        />
        <h4 style={{ color: '#e6edf3', fontSize: 14, marginTop: 16, marginBottom: 6 }}>Preview (Impersonation)</h4>
        <ul style={{ paddingLeft: 20, lineHeight: 1.9 }}>
          <li>Click <b>Preview</b> on any user → loads their profile and routes you to <code>/home</code>.</li>
          <li>A persistent orange banner pins to the top: "👁️ Admin preview — viewing as X (impersonating real admin: Y)". Body gets 40px top padding so no page content is hidden.</li>
          <li>While impersonating, <b>isAdmin evaluates to false</b> — you have no admin powers as the target, which prevents accidental destructive actions "as them".</li>
          <li>Click <b>Exit Preview</b> to restore your admin session.</li>
        </ul>
        <Callout color="#f85149" icon="🔐" title="Schema health:">
          If a table or column is missing in your Supabase DB, a red banner at
          the top of the Admin Panel lists the exact problem. Writes also
          verify <code>.select('id')</code> returns a row — a silent 0-row
          result (typical RLS failure) is surfaced as an error toast instead of
          a fake "success".
        </Callout>
      </>
    ),
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'maintenance',
    icon: '🚧',
    title: 'Maintenance Mode',
    summary: 'DB-driven flag that shows a global banner to every user.',
    content: (
      <>
        <ul style={{ paddingLeft: 20, lineHeight: 1.9 }}>
          <li>Backed by the <code>system_settings</code> table (keys <code>maintenance_mode</code> and <code>maintenance_message</code>).</li>
          <li>When ON, every authenticated page shows an orange banner with your custom message.</li>
          <li><b>Logins still work</b> — the site isn't locked; only the banner appears.</li>
          <li>Admins see a "Disable Maintenance" button directly on the banner.</li>
          <li>Upsert uses <code>onConflict: 'key'</code> so the toggle actually updates in place instead of inserting duplicates.</li>
        </ul>
      </>
    ),
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'tiers',
    icon: '🔐',
    title: 'Roles & Access Matrix',
    summary: 'Tier-based feature gating — exactly what each tier can see.',
    content: (
      <>
        <p>
          Tiers are computed once in <code>services/Roles.ts</code> via{' '}
          <code>resolveTier()</code>. Admin wins over all other tiers.
        </p>
        <RolesMatrix />
      </>
    ),
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'security',
    icon: '🔒',
    title: 'Signup, CAPTCHA & Ban Handling',
    summary: 'How the system keeps bots out and bad actors out.',
    content: (
      <>
        <h4 style={{ color: '#e6edf3', fontSize: 14, marginTop: 4, marginBottom: 6 }}>Signup bot defences (three layers)</h4>
        <DataTable
          headers={['LAYER', 'WHAT IT DOES']}
          rows={[
            ['Math CAPTCHA',    'Random a + b where each is 1–9. Regenerates on every mount.'],
            ['Honeypot',        'A hidden text field positioned at left: -9999px. Humans never see it; bots auto-fill it → blocked.'],
            ['Timing gate',     'Submissions within 4 seconds of form mount are rejected as automated.'],
          ]}
        />
        <h4 style={{ color: '#e6edf3', fontSize: 14, marginTop: 16, marginBottom: 6 }}>Privacy (Philippine DPA / RA 10173)</h4>
        <ul style={{ paddingLeft: 20, lineHeight: 1.9 }}>
          <li>Four-checkbox consent modal (collection · processing · rights · retention) gates the Create Account button.</li>
          <li>Lists every piece of data collected, third parties, retention period, and your eight data-subject rights.</li>
          <li>Appeal email: <code>privacy@codesense.app</code>.</li>
        </ul>
        <h4 style={{ color: '#e6edf3', fontSize: 14, marginTop: 16, marginBottom: 6 }}>Ban behaviour</h4>
        <ul style={{ paddingLeft: 20, lineHeight: 1.9 }}>
          <li>Admin bans set <code>is_banned=true</code>, <code>ban_reason</code>, <code>banned_at</code>.</li>
          <li>Login detects the ban, signs the session out immediately, and throws <code>ACCOUNT_BANNED: {`<reason>`}</code>.</li>
          <li>The login page parses that error and opens a <b>formal suspension modal</b> with icon, reason, and appeal instructions — no generic "invalid credentials" leak.</li>
        </ul>
        <Callout color="#a371f7" icon="🛡" title="Row Level Security (RLS):">
          The <code>users</code> table needs three policies for admin actions to
          work: <code>authenticated_can_read_all</code> (SELECT),{' '}
          <code>users_update_own</code> (UPDATE where auth.uid()=id), and{' '}
          <code>admins_update_any</code> (UPDATE where is_admin=true). Without
          these, Ban / Make Admin / Preview silently fail (the frontend now
          detects and reports this).
        </Callout>
      </>
    ),
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'tutorials',
    icon: '🎓',
    title: 'Tutorials (Interactive Quests)',
    summary: 'The five guided walkthroughs built into the app.',
    content: (
      <>
        <DataTable
          headers={['#', 'TUTORIAL', 'DIFFICULTY', 'MINUTES']}
          rows={[
            ['1', 'Your First Analysis',           <span style={{ color: '#4caf50' }}>Beginner</span>,     '5'],
            ['2', 'Catch an Uninitialised Read',   <span style={{ color: '#4caf50' }}>Beginner</span>,     '6'],
            ['3', 'Spot an Out-of-Bounds Access',  <span style={{ color: '#ffa726' }}>Intermediate</span>, '7'],
            ['4', 'Draw a Flowchart, Generate C++',<span style={{ color: '#ffa726' }}>Intermediate</span>,'10'],
            ['5', 'Navigating a Large CFG',        <span style={{ color: '#f85149' }}>Advanced</span>,     '5'],
          ]}
        />
        <Callout color="#58a6ff" icon="💾" title="Progress persists:">
          Step completion is stored in <code>localStorage</code> key{' '}
          <code>cs-tutorial-progress-v1</code>. You can close the tab and come
          back; the dashboard card shows <i>IN PROGRESS</i> vs <i>✓ DONE</i>.
        </Callout>
      </>
    ),
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'shortcuts',
    icon: '⌨️',
    title: 'Keyboard Shortcuts & Tips',
    summary: 'Fastest paths through common tasks.',
    content: (
      <>
        <DataTable
          headers={['ACTION', 'SHORTCUT / TIP']}
          rows={[
            ['Close a modal',              <><Kbd>Esc</Kbd></>],
            ['Search the dashboard',       <>Click the search bar, type anything. Results fade in without scrolling.</>],
            ['Delete a node or edge',      <><Kbd>Backspace</Kbd> with it selected (Build Mode only).</>],
            ['Multi-select nodes',         <>Hold <Kbd>Shift</Kbd> while clicking.</>],
            ['Zoom without moving nodes',  <>Click 🔒 <b>LOCK</b> first, then scroll-wheel.</>],
            ['Resume last snippet',        'Dashboard → Command Center → Quick Start.'],
            ['Copy your rank card',        'Leaderboard → Your Rank banner → "📋 Share Rank".'],
            ['Mark all notifications read','🔔 dropdown → top-right link.'],
          ]}
        />
      </>
    ),
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'troubleshooting',
    icon: '🛠',
    title: 'Troubleshooting',
    summary: "Things that look like bugs but usually aren't.",
    content: (
      <>
        <DataTable
          headers={['SYMPTOM', 'CAUSE / FIX']}
          rows={[
            [<b>CFG tab is empty after ANALYZE</b>,                          'Parser failed. Read the LOGS tab — a syntax error will be listed with line + column.'],
            [<b>"Analysis timed out"</b>,                                    'Request took &gt; 30 s or the tunnel cold-started. Retry — previous request is cancelled via AbortController.'],
            [<b>"Lock 🔒 froze my zoom"</b>,                                  'It doesn\'t. Lock only freezes node drag + pan. Scroll-wheel and ± controls still zoom.'],
            [<b>Generated C++ missing a branch</b>,                          'Your decision\'s outgoing edges aren\'t labelled. Double-click each edge and type "true" or "false".'],
            [<b>Ban succeeds but nothing happens</b>,                        'Supabase RLS silently denied the UPDATE. Admin Panel now catches this — see §🔒 Security for the required policies.'],
            [<b>Bell always shows 0 unread</b>,                              'No announcements table, or RLS blocks reads. The Admin Panel shows a red schema-issues banner when this happens.'],
            [<b>Impersonation banner covers header</b>,                      'Already handled — body gets 40 px top padding while active. If yours doesn\'t, hard-refresh to reload App.tsx.'],
            [<b>Avatar upload fails silently</b>,                            'File &gt; 2 MB or Supabase Storage bucket Avatars missing / misconfigured.'],
            [<b>"invalid login credentials" on a known account</b>,          'Either the password changed, or the account is banned (a formal suspension modal appears instead of this message).'],
            [<b>My rank isn\'t changing on leaderboard</b>,                   'Realtime subscription requires the Supabase Realtime extension + RLS allowing SELECT on users. Refresh forces a re-read.'],
          ]}
        />
      </>
    ),
  },
]

// ─── Main page ───────────────────────────────────────────────────────────────

export const UserManualPage: React.FC = () => {
  const navigate = useNavigate()
  const { user, isGuest, isAuthenticated } = useAuth()
  const tier = resolveTier({ user, isGuest, isAuthenticated })
  const [openId, setOpenId] = useState<string>(SECTIONS[0].id)

  useEffect(() => {
    const els = [document.documentElement, document.body, document.getElementById('root')]
    // Save original values before overriding
    const originals = els.map(el => el?.style.overflow ?? '')
    els.forEach(el => { if (el) el.style.overflow = 'auto' })
    return () => {
      els.forEach((el, i) => { if (el) el.style.overflow = originals[i] })
    }
  }, [])

  return (
    <>
    <style>{`
      @keyframes um-fadein { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @media (max-width: 768px) {
        .um-header { padding: 12px 14px !important; flex-wrap: wrap; gap: 8px; }
        .um-header-title { order: -1; width: 100%; justify-content: center; }
        .um-header-title span:last-child { font-size: 15px !important; }
        .um-grid { grid-template-columns: 1fr !important; gap: 14px !important; padding: 16px 14px !important; }
        .um-sidebar { position: static !important; display: flex; flex-wrap: wrap; gap: 6px; flex-direction: row; }
        .um-sidebar button { width: auto !important; flex: 0 0 auto; padding: 8px 12px !important; font-size: 11px !important; }
        .um-content { overflow-x: auto; }
        .um-content table { min-width: 500px; }
      }
    `}</style>
    <div style={{
      minHeight: '100vh', width: '100%',
      background: 'linear-gradient(135deg, #0d1117 0%, #1a1f2e 100%)',
      color: 'white', fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    }}>
      {/* Header */}
      <header className="um-header" style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '16px 32px', background: 'rgba(22,27,34,0.95)',
        borderBottom: '1px solid #21262d', position: 'sticky', top: 0, zIndex: 10,
        backdropFilter: 'blur(8px)',
      }}>
        <button onClick={() => navigate(isAuthenticated || isGuest ? '/home' : '/')} style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 14 }}>
          ← Back
        </button>
        <div className="um-header-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>📘</span>
          <span style={{ color: '#e6edf3', fontSize: 18, fontWeight: 700 }}>User Manual</span>
        </div>
        <span style={{
          background: `${tierColor(tier)}18`, border: `1px solid ${tierColor(tier)}55`,
          color: tierColor(tier), padding: '4px 10px', borderRadius: 10,
          fontSize: 10, fontWeight: 800, letterSpacing: 1.2,
          fontFamily: "'IBM Plex Mono', monospace",
        }}>
          {tierLabel(tier)}
        </span>
      </header>

      <div className="um-grid" style={{
        maxWidth: 920, margin: '0 auto', padding: '32px 24px',
        display: 'grid', gridTemplateColumns: '220px 1fr', gap: 24,
      }}>
        {/* Sidebar nav */}
        <nav className="um-sidebar" style={{ position: 'sticky', top: 80, alignSelf: 'start' }}>
          <div style={{ color: '#484f58', fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10, padding: '0 8px' }}>
            Contents
          </div>
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => setOpenId(s.id)}
              style={{
                width: '100%', textAlign: 'left',
                background: openId === s.id ? 'rgba(76,175,80,0.1)' : 'transparent',
                border: 'none', borderLeft: `3px solid ${openId === s.id ? '#4caf50' : 'transparent'}`,
                color: openId === s.id ? '#4caf50' : '#8b949e',
                padding: '9px 14px',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
                transition: 'all 0.15s',
              }}
            >
              <span style={{ fontSize: 14 }}>{s.icon}</span>
              <span>{s.title}</span>
            </button>
          ))}
        </nav>

        {/* Content — FIX: conditionally render only the open section so the
            fade-in animation actually fires on each tab switch. Previously,
            sections used display:none which prevented CSS animations from
            playing because the element was never repainted. */}
        <main className="um-content">
          {SECTIONS.map(s => {
            if (s.id !== openId) return null
            return (
              <section
                key={s.id}
                id={s.id}
                style={{
                  background: 'rgba(22,27,34,0.9)', border: '1px solid #21262d',
                  borderRadius: 14, padding: '22px 24px', marginBottom: 16,
                  animation: 'um-fadein 0.25s ease',
                }}
              >
                <h2 style={{ color: '#e6edf3', fontSize: 20, fontWeight: 800, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 22 }}>{s.icon}</span>{s.title}
                </h2>
                <div style={{ color: '#8b949e', fontSize: 12, marginBottom: 18, fontStyle: 'italic' }}>{s.summary}</div>
                <div style={{ color: '#c9d1d9', fontSize: 14, lineHeight: 1.75 }}>
                  {s.content}
                </div>
              </section>
            )
          })}
        </main>
      </div>

    </div>
    </>
  )
}

export default UserManualPage
