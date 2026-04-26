import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './components/AuthScreen'

// ─── Tutorial data ───────────────────────────────────────────────────────────

interface Step {
  title: string
  instruction: string
  hint?: string
  /** Optional code snippet the user should try. */
  code?: string
  /** Optional expected-finding explanation to show in the "Why" panel. */
  why?: string
}

type Category = 'Getting Started' | 'Sandbox' | 'Campaign' | 'Build Mode' | 'Admin'

interface Tutorial {
  id: string
  icon: string
  title: string
  tagline: string
  category: Category
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced'
  estMinutes: number
  adminOnly?: boolean
  steps: Step[]
}

const TUTORIALS: Tutorial[] = [
  {
    id: 'first-analysis',
    icon: '🧭',
    title: 'Your First Analysis',
    tagline: 'Walk through a clean C++ snippet and read every panel CodeSense produces.',
    category: 'Sandbox',
    difficulty: 'Beginner',
    estMinutes: 5,
    steps: [
      {
        title: 'Open the Sandbox',
        instruction: 'From the dashboard, click the Sandbox tile. You\'ll see the editor on the left and the analyser tabs on the right.',
      },
      {
        title: 'Paste the starter snippet',
        instruction: 'Use the code below. It\'s intentionally safe — no rules should fire.',
        code: `int main() {
  int n = 5;
  int total = 0;
  for (int i = 1; i <= n; i++) {
    total += i;
  }
  return total;
}`,
      },
      {
        title: 'Click ANALYZE',
        instruction: 'The yellow ANALYZE button kicks off the deterministic pipeline: lex → parse → AST → CFG → rule engine.',
      },
      {
        title: 'Read the tabs',
        instruction: 'Open TOKENS, AST, SYMBOLS, CFG, and LOGS one at a time. Each shows a snapshot from a specific stage.',
        hint: 'The CFG tab is where most debugging happens — click a node to jump to its source line.',
      },
    ],
  },
  {
    id: 'catch-uninit',
    icon: '🐛',
    title: 'Catch an Uninitialised Read',
    tagline: 'See exactly how the UNINITIALIZED_READ rule fires and where it points.',
    category: 'Sandbox',
    difficulty: 'Beginner',
    estMinutes: 6,
    steps: [
      {
        title: 'Paste the broken snippet',
        instruction: 'Drop this into the editor and hit ANALYZE.',
        code: `int main() {
  int x;              // declared but never assigned
  int y = x + 1;      // read before init
  return y;
}`,
        why: 'The analyser walks every control flow path between declaration and read. If at least one path lacks an assignment, UNINITIALIZED_READ fires on the read site.',
      },
      {
        title: 'Find the red edge in the CFG',
        instruction: 'The CFG tab will show the read node outlined in red. Click it — the editor highlights line 3.',
      },
      {
        title: 'Fix it',
        instruction: 'Change `int x;` to `int x = 0;`. Re-run ANALYZE. The verdict flips to SAFE and the red edge clears.',
        hint: 'You can keep ANALYZE-ing in a loop — every run is deterministic, so if the warning persists your fix didn\'t address the exact rule.',
      },
    ],
  },
  {
    id: 'array-oob',
    icon: '📏',
    title: 'Spot an Out-of-Bounds Access',
    tagline: 'ARRAY_OOB fires on provable bounds violations — no speculation.',
    category: 'Sandbox',
    difficulty: 'Intermediate',
    estMinutes: 7,
    steps: [
      {
        title: 'Paste the snippet',
        instruction: '',
        code: `int main() {
  int arr[3] = {1, 2, 3};
  return arr[5];        // index 5 vs declared size 3
}`,
        why: 'Because both the declared size and the index are constants, the symbol table proves the access is out of range. ARRAY_OOB is emitted with the exact line.',
      },
      {
        title: 'Observe the rule code',
        instruction: 'The logs tab shows `ARRAY_OOB` with the line number. No vagueness — that specific code fired, nothing else.',
      },
      {
        title: 'Watch what happens with a variable index',
        instruction: 'Change `arr[5]` to `arr[i]` where `i` is a runtime value. The rule switches off — the analyser cannot prove the bound without symbolic execution on that path.',
        hint: 'Deterministic means provable. When proof isn\'t possible, the rule stays silent rather than guessing.',
      },
    ],
  },
  {
    id: 'build-mode',
    icon: '🧩',
    title: 'Draw a Flowchart, Generate C++',
    tagline: 'Reverse the pipeline: the visualiser becomes your source of truth.',
    category: 'Build Mode',
    difficulty: 'Intermediate',
    estMinutes: 10,
    steps: [
      {
        title: 'Switch to Build mode',
        instruction: 'In the Sandbox, toggle to Build mode. The node palette appears on the right.',
      },
      {
        title: 'Lay out a simple loop',
        instruction: 'Drag: Start → Process (int i = 0;) → Decision (i < 5) → Process (i++) → back to the Decision. Add a false-edge → End.',
        hint: 'Double-click the decision\'s outgoing edges and label them `true` / `false`. The generator relies on those labels.',
      },
      {
        title: 'Hit GENERATE C++',
        instruction: 'The CodeGenerator service walks your graph and emits a `for`/`while` equivalent. If the ValidationPanel blocks you, it tells you exactly which rule failed.',
      },
      {
        title: 'Run ANALYZE on the generated code',
        instruction: 'You\'ve just proved the round-trip: flowchart → C++ → AST → CFG → back to a renderable graph. Congratulations.',
      },
    ],
  },
  {
    id: 'large-graph',
    icon: '🕸',
    title: 'Navigating a Large CFG',
    tagline: 'Locking, zoom, and the 200-node performance threshold.',
    category: 'Sandbox',
    difficulty: 'Advanced',
    estMinutes: 5,
    steps: [
      {
        title: 'Paste any large snippet',
        instruction: 'Anything with deeply nested loops will work — we want ~30+ nodes in the CFG.',
      },
      {
        title: 'Click the 🔓 UNLOCKED badge (bottom-left)',
        instruction: 'It flips to 🔒 LOCKED. Node drag and canvas pan are frozen.',
        why: 'Lock is deliberately scoped: it prevents accidental reshaping while you inspect, but leaves zoom (wheel / pinch / ± controls) enabled so you can still navigate.',
      },
      {
        title: 'Zoom around',
        instruction: 'Scroll-wheel zooms into the cursor. The built-in Controls (bottom-right) still offer fit-view / center. With 200+ nodes you\'ll see a yellow performance banner at the top — that\'s your cue to stay locked while exploring.',
      },
    ],
  },

  // ─── Getting Started — the grand tour ────────────────────────────────────
  {
    id: 'getting-started',
    icon: '🧭',
    title: 'Getting Started — The Grand Tour',
    tagline: 'Everything the system does and offers, in one guided sweep.',
    category: 'Getting Started',
    difficulty: 'Beginner',
    estMinutes: 12,
    steps: [
      {
        title: 'Welcome',
        instruction: 'CodeSense is a deterministic C++ analyzer wrapped in a gamified learning environment. This tour sweeps across every feature so you know what\'s available.',
        why: 'If you already saw the Welcome Tour modal on first login, this is the deeper, self-paced version you can replay any time.',
      },
      {
        title: 'The Dashboard',
        instruction: 'Head to /home. Five zones live there: global search, the 🔔 notification bell, two mode cards (Sandbox + Campaign), the Command Center, and a mini leaderboard.',
        hint: 'The Command Center\'s Quick Start button reloads your most recent snippet into the Sandbox so you can pick up where you left off.',
      },
      {
        title: 'The Sandbox',
        instruction: 'Click "Sandbox" on the dashboard. You get a Monaco editor on the left and seven analyzer tabs on the right: Tokens, AST, Symbols, CFG, Math, Logs, Validation.',
        why: 'Each tab corresponds to one pipeline stage. Syntax errors show in Logs; the rule verdicts show in the CFG as red edges.',
      },
      {
        title: 'The Campaign',
        instruction: 'Back on the dashboard, click "Campaign Mode". You\'ll see quests grouped by phase (Beginner → Intermediate → Advanced). Each quest has objectives and earns XP.',
        hint: 'Ranks unlock at 1,000 / 4,000 / 10,000 / 25,000 XP — Squire → Knight → Lord → Duke → King.',
      },
      {
        title: 'The Leaderboard',
        instruction: 'Open /leaderboard. Sort by XP/Level/Activity/Join date, filter by Student vs Professional, click any row to see that player\'s detail card, and share your rank.',
      },
      {
        title: 'Your Profile',
        instruction: 'Avatar (profile menu) → Profile Image. Five tabs: Overview, Achievements, Activity, Settings, Learn. Upload an avatar (circular crop), pick your displayed title from unlocked ranks, change password, etc.',
      },
      {
        title: 'Notifications',
        instruction: 'The 🔔 bell in the top-right header aggregates five streams: announcements, quest completions, achievements, rank-ups, admin actions on your account. Filter by kind with the pill row.',
      },
      {
        title: 'Tutorials & Manual',
        instruction: 'You\'re here. The User Manual (📘 in the profile menu) is the complete reference — 19 sections, every rule, every shortcut. Tutorials (here) are step-by-step practice like this one.',
        hint: 'Both pages persist your progress in localStorage — you can close the tab and resume.',
      },
      {
        title: 'Ready',
        instruction: 'You\'ve seen every surface of the system. Pick any tutorial from the list to go deep, or just hit the Sandbox and start experimenting.',
      },
    ],
  },

  // ─── Campaign Mode — navigation ─────────────────────────────────────────
  {
    id: 'campaign-tour',
    icon: '⚔️',
    title: 'Campaign Mode — How to Navigate',
    tagline: 'Phases, quests, hints, and how XP actually accrues.',
    category: 'Campaign',
    difficulty: 'Beginner',
    estMinutes: 8,
    steps: [
      {
        title: 'Open Campaign',
        instruction: 'Dashboard → Campaign Mode card (orange). The landing page shows three phases laid out horizontally: Beginner, Intermediate, Advanced.',
        why: 'Phases gate difficulty. You unlock the next phase after completing a threshold of quests in the current one.',
      },
      {
        title: 'Pick a phase',
        instruction: 'Click a phase card. You\'ll see the list of quests for that phase, each with a title, short description, and base XP reward.',
      },
      {
        title: 'Open a quest',
        instruction: 'Click any quest row. The Lesson Activity view loads: starter code on the left, objectives panel on the right.',
        hint: 'Objectives are concrete rules — e.g. "no UNSAFE checks" or "output must equal X". Rule-based, not vibes.',
      },
      {
        title: 'Edit and ANALYZE',
        instruction: 'Modify the starter code to satisfy the objectives. Hit the yellow ANALYZE button. If every objective passes, the quest is marked complete and XP is awarded.',
      },
      {
        title: 'Using hints',
        instruction: 'Stuck? Each quest exposes a ladder of hints with increasing XP cost (shown next to the hint). Using a hint subtracts from your final reward — no hint = full XP.',
        why: 'Hints are optional. The leaderboard factors in hint usage indirectly via earned XP.',
      },
      {
        title: 'Check your XP climb',
        instruction: 'Dashboard → Leaderboard mini, or Profile → Overview. Your rank updates in realtime; cross a threshold (1k / 4k / 10k / 25k) and a rank-up notification appears in the 🔔 bell.',
        hint: 'You can wear any unlocked title — a Duke can still display "Squire" if they want. Set it in Profile → Settings → Displayed Title.',
      },
      {
        title: 'Track history',
        instruction: 'Profile → Activity tab merges every analysis and every completed quest into one timeline, sorted by date.',
      },
    ],
  },

  // ─── Reading CFG colour cues ─────────────────────────────────────────────
  {
    id: 'cfg-cues',
    icon: '🎨',
    title: 'Reading the CFG Colour Cues',
    tagline: 'What every arrow and node colour means at a glance.',
    category: 'Sandbox',
    difficulty: 'Beginner',
    estMinutes: 4,
    steps: [
      {
        title: 'Start with anything',
        instruction: 'Paste a short program and hit ANALYZE. Open the CFG tab.',
      },
      {
        title: 'Blue = default flow',
        instruction: 'Default, unvisited edges are blue. Nothing alarming.',
      },
      {
        title: 'Green animated = you\'ve been here',
        instruction: 'Click any node. Its incoming edge pulses green — that means you marked it visited. The Nodes-Explored counter at top-left reflects coverage.',
        why: 'This is interactive exploration — it doesn\'t mean "safe", it means "you\'ve clicked it".',
      },
      {
        title: 'Red pulsing = rule fired',
        instruction: 'Any edge pointing to a node where a rule fired will pulse red. Click the node — the editor jumps to the source line.',
        hint: 'Red edges are the whole reason CFG-based analysis is better than raw logs: you literally see the control path that leads to the bug.',
      },
      {
        title: 'Orange diamonds = decisions',
        instruction: 'Conditions are diamond-shaped. Their true/false outgoing edges are labelled. If they\'re unlabelled, the GraphValidator in Build Mode will complain.',
      },
    ],
  },

  // ─── Admin Panel (admins only) ───────────────────────────────────────────
  {
    id: 'admin-basics',
    icon: '🛡',
    title: 'Admin Panel — Moderation Basics',
    tagline: 'Ban, unban, toggle admin, and preview users safely.',
    category: 'Admin',
    difficulty: 'Intermediate',
    estMinutes: 6,
    adminOnly: true,
    steps: [
      {
        title: 'Open /admin',
        instruction: 'Profile menu → 🛡 Admin Panel (admins only). The panel loads Tabler UI from CDN on mount. Five tabs: Dashboard, Users, Audit Logs, Maintenance, Announcements.',
      },
      {
        title: 'Dashboard at a glance',
        instruction: '4 KPI cards — Total / Active / Banned / Admins — plus a recent-activity table sourced from admin_audit_log.',
      },
      {
        title: 'Ban flow',
        instruction: 'Users tab → pick a user → Ban. You\'ll be prompted for a reason. The write happens via an adminUpdate helper that checks .select(\'id\') returned rows — if RLS silently denies, you\'ll see "Update silently blocked" instead of a fake success.',
        why: 'The frontend cannot trust .update() alone because Supabase returns no error when RLS filters to zero rows. The select() round-trip is how we verify.',
      },
      {
        title: 'Preview (impersonation)',
        instruction: 'Click Preview on any user — you\'re now viewing the app as them. A persistent orange banner at the top tells you so. Your admin powers are suspended (isAdmin evaluates to false while impersonating).',
        hint: 'Click Exit Preview on the banner to restore your admin session.',
      },
      {
        title: 'Maintenance mode',
        instruction: 'Maintenance tab → toggle + custom message. Backed by the system_settings table with onConflict: \'key\'. Banner appears across the app for everyone until you toggle off.',
      },
      {
        title: 'Announcements',
        instruction: 'Create announcements with priority + pin. They appear in every user\'s 🔔 bell within seconds via Supabase realtime.',
      },
    ],
  },
]

const DIFF_STYLE: Record<Tutorial['difficulty'], { color: string; bg: string }> = {
  Beginner:     { color: '#4caf50', bg: 'rgba(76,175,80,0.12)'  },
  Intermediate: { color: '#ffa726', bg: 'rgba(255,167,38,0.12)' },
  Advanced:     { color: '#f85149', bg: 'rgba(248,81,73,0.12)'  },
}

// ─── localStorage-backed completion state ───────────────────────────────────

const PROGRESS_KEY = 'cs-tutorial-progress-v1'

function loadProgress(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}') } catch { return {} }
}

function saveProgress(p: Record<string, number>) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)) } catch { /* quota */ }
}

// ─── Tutorial detail view ───────────────────────────────────────────────────

const TutorialView: React.FC<{
  tutorial: Tutorial
  stepIdx: number
  onStep: (i: number) => void
  onComplete: () => void
  onBack: () => void
}> = ({ tutorial, stepIdx, onStep, onComplete, onBack }) => {
  const step = tutorial.steps[stepIdx]
  const isLast = stepIdx === tutorial.steps.length - 1
  const [copied, setCopied] = useState(false)

  const copyCode = () => {
    if (!step.code) return
    navigator.clipboard?.writeText(step.code).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <button onClick={onBack} style={{ background: 'transparent', border: 'none', color: '#8b949e', fontSize: 13, cursor: 'pointer', marginBottom: 16, padding: 0 }}>
        ← Back to tutorials
      </button>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
        <span style={{ fontSize: 30 }}>{tutorial.icon}</span>
        <div>
          <h1 style={{ color: '#e6edf3', fontSize: 22, fontWeight: 800, margin: 0 }}>{tutorial.title}</h1>
          <div style={{ color: '#8b949e', fontSize: 13, marginTop: 2 }}>{tutorial.tagline}</div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 6, height: 6, marginBottom: 6, overflow: 'hidden' }}>
        <div style={{
          width: `${((stepIdx + 1) / tutorial.steps.length) * 100}%`,
          height: '100%', background: 'linear-gradient(90deg,#4caf50,#66bb6a)',
          transition: 'width 0.3s ease',
        }} />
      </div>
      <div style={{ color: '#8b949e', fontSize: 11, marginBottom: 22, textAlign: 'right' }}>
        Step {stepIdx + 1} of {tutorial.steps.length}
      </div>

      {/* Step card */}
      <div style={{ background: 'rgba(22,27,34,0.9)', border: '1px solid #21262d', borderRadius: 14, padding: '22px 24px', marginBottom: 18 }}>
        <div style={{ color: '#484f58', fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>
          Step {stepIdx + 1}
        </div>
        <h2 style={{ color: '#e6edf3', fontSize: 18, fontWeight: 700, margin: '0 0 14px' }}>{step.title}</h2>
        {step.instruction && (
          <p style={{ color: '#c9d1d9', fontSize: 14, lineHeight: 1.75, margin: '0 0 14px' }}>{step.instruction}</p>
        )}

        {step.code && (
          <div style={{ position: 'relative', marginBottom: 14 }}>
            <pre style={{
              background: '#010409', border: '1px solid #21262d', borderRadius: 8,
              padding: 14, fontSize: 12, lineHeight: 1.7,
              fontFamily: "'IBM Plex Mono', monospace", color: '#c9d1d9',
              overflowX: 'auto', margin: 0,
            }}>{step.code}</pre>
            <button onClick={copyCode} style={{
              position: 'absolute', top: 8, right: 8,
              background: copied ? 'rgba(76,175,80,0.2)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${copied ? '#4caf50' : '#30363d'}`,
              color: copied ? '#4caf50' : '#8b949e',
              padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
              fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
              fontFamily: "'IBM Plex Mono', monospace",
            }}>
              {copied ? '✓ COPIED' : '📋 COPY'}
            </button>
          </div>
        )}

        {step.hint && (
          <div style={{
            background: 'rgba(255,167,38,0.06)', border: '1px solid rgba(255,167,38,0.25)',
            borderLeft: '3px solid #ffa726', padding: '10px 14px', borderRadius: 6,
            fontSize: 12, color: '#c9d1d9', marginBottom: step.why ? 10 : 0,
          }}>
            <b style={{ color: '#ffa726' }}>💡 Hint:</b> {step.hint}
          </div>
        )}

        {step.why && (
          <div style={{
            background: 'rgba(100,181,246,0.06)', border: '1px solid rgba(100,181,246,0.25)',
            borderLeft: '3px solid #64b5f6', padding: '10px 14px', borderRadius: 6,
            fontSize: 12, color: '#c9d1d9',
          }}>
            <b style={{ color: '#64b5f6' }}>🔎 Why:</b> {step.why}
          </div>
        )}
      </div>

      {/* Nav buttons */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <button onClick={() => onStep(Math.max(0, stepIdx - 1))} disabled={stepIdx === 0}
          style={{
            padding: '10px 18px', background: 'transparent',
            border: '1px solid #30363d', color: '#8b949e',
            borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: stepIdx === 0 ? 'not-allowed' : 'pointer',
            opacity: stepIdx === 0 ? 0.4 : 1, letterSpacing: 0.5,
          }}>
          ← Previous
        </button>
        <button onClick={isLast ? onComplete : () => onStep(stepIdx + 1)} style={{
          padding: '10px 22px', background: isLast ? '#4caf50' : '#58a6ff',
          border: 'none', color: 'white', borderRadius: 8,
          fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5,
        }}>
          {isLast ? '✓ Mark Complete' : 'Next →'}
        </button>
      </div>
    </div>
  )
}

// ─── Main Tutorials page ────────────────────────────────────────────────────

export const TutorialsPage: React.FC = () => {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [stepIdx, setStepIdx]   = useState(0)
  const [progress, setProgress] = useState<Record<string, number>>(() => loadProgress())
  const [search, setSearch]     = useState('')
  const [catFilter, setCatFilter] = useState<Category | 'All'>('All')
  const [diffFilter, setDiffFilter] = useState<Tutorial['difficulty'] | 'All'>('All')

  useEffect(() => {
    const els = [document.documentElement, document.body, document.getElementById('root')]
    els.forEach(el => { if (el) el.style.overflow = 'auto' })
    return () => { els.forEach(el => { if (el) el.style.overflow = '' }) }
  }, [])

  const active = activeId ? TUTORIALS.find(t => t.id === activeId) ?? null : null

  const open = (id: string) => {
    setActiveId(id)
    setStepIdx(progress[id] && progress[id] < (TUTORIALS.find(t => t.id === id)?.steps.length ?? 99) ? progress[id] : 0)
  }

  const onStep = (i: number) => {
    setStepIdx(i)
    if (activeId) {
      const next = { ...progress, [activeId]: i }
      setProgress(next); saveProgress(next)
    }
  }

  const onComplete = () => {
    if (!activeId || !active) return
    const next = { ...progress, [activeId]: active.steps.length }
    setProgress(next); saveProgress(next)
    setActiveId(null)
  }

  // Hide admin-only tutorials from non-admins
  const visibleAll = TUTORIALS.filter(t => !t.adminOnly || isAdmin)

  // Apply category / difficulty / search filters
  const q = search.trim().toLowerCase()
  const visible = visibleAll.filter(t => {
    if (catFilter !== 'All' && t.category !== catFilter) return false
    if (diffFilter !== 'All' && t.difficulty !== diffFilter) return false
    if (q && !(t.title.toLowerCase().includes(q) || t.tagline.toLowerCase().includes(q))) return false
    return true
  })

  const completedCount = visibleAll.filter(t => (progress[t.id] ?? 0) >= t.steps.length).length
  const pctDone = Math.round((completedCount / Math.max(visibleAll.length, 1)) * 100)

  const CATEGORIES: (Category | 'All')[] = ['All', 'Getting Started', 'Sandbox', 'Build Mode', 'Campaign', ...(isAdmin ? ['Admin' as Category] : [])]
  const DIFFS: (Tutorial['difficulty'] | 'All')[] = ['All', 'Beginner', 'Intermediate', 'Advanced']

  return (
    <div style={{
      minHeight: '100vh', width: '100%',
      background: 'linear-gradient(135deg, #0d1117 0%, #1a1f2e 100%)',
      color: 'white', fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    }}>
      {/* Header */}
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '16px 32px', background: 'rgba(22,27,34,0.95)',
        borderBottom: '1px solid #21262d', position: 'sticky', top: 0, zIndex: 10,
        backdropFilter: 'blur(8px)',
      }}>
        <button onClick={() => navigate('/home')} style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 14 }}>
          ← Back to Dashboard
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>🎓</span>
          <span style={{ color: '#e6edf3', fontSize: 18, fontWeight: 700 }}>Tutorials</span>
        </div>
        <span style={{ color: '#8b949e', fontSize: 12 }}>
          {completedCount}/{visibleAll.length} completed
        </span>
      </header>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
        {active ? (
          <TutorialView
            tutorial={active}
            stepIdx={stepIdx}
            onStep={onStep}
            onComplete={onComplete}
            onBack={() => setActiveId(null)}
          />
        ) : (
          <>
            {/* Summary card */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(76,175,80,0.1), rgba(100,181,246,0.06))',
              border: '1px solid rgba(76,175,80,0.25)',
              borderRadius: 14, padding: '20px 24px', marginBottom: 22,
              display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
            }}>
              <div style={{ fontSize: 46 }}>🏁</div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ color: '#4caf50', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
                  Your progress
                </div>
                <div style={{ color: '#e6edf3', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
                  {completedCount === 0
                    ? 'New here? Start with "Getting Started — The Grand Tour".'
                    : completedCount === visibleAll.length
                      ? 'All tutorials complete — you\'re ready for the real thing. 🎉'
                      : `${completedCount} of ${visibleAll.length} tutorials complete (${pctDone}%).`}
                </div>
                <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 6, height: 8, overflow: 'hidden' }}>
                  <div style={{ width: `${pctDone}%`, height: '100%', background: 'linear-gradient(90deg,#4caf50,#66bb6a)', transition: 'width 0.5s ease' }} />
                </div>
              </div>
            </div>

            {/* ── Filter controls ── */}
            <div style={{
              background: 'rgba(22,27,34,0.9)', border: '1px solid #21262d',
              borderRadius: 12, padding: 14, marginBottom: 14,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              {/* Search */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'rgba(255,255,255,0.03)', border: '1px solid #30363d',
                borderRadius: 8, padding: '8px 12px',
              }}>
                <span style={{ fontSize: 14, opacity: 0.5 }}>🔍</span>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search tutorials..."
                  style={{
                    flex: 1, background: 'transparent', border: 'none', outline: 'none',
                    color: '#e6edf3', fontSize: 13,
                  }}
                />
                {search && (
                  <button onClick={() => setSearch('')}
                    style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
                )}
              </div>

              {/* Category chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <span style={{ color: '#484f58', fontSize: 10, fontWeight: 700, letterSpacing: 1, alignSelf: 'center', marginRight: 4 }}>CATEGORY</span>
                {CATEGORIES.map(c => {
                  const active = catFilter === c
                  const count = c === 'All' ? visibleAll.length : visibleAll.filter(t => t.category === c).length
                  return (
                    <button
                      key={c}
                      onClick={() => setCatFilter(c)}
                      disabled={count === 0 && c !== 'All'}
                      style={{
                        background: active ? 'rgba(76,175,80,0.15)' : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${active ? 'rgba(76,175,80,0.4)' : '#30363d'}`,
                        color: active ? '#4caf50' : count === 0 && c !== 'All' ? '#30363d' : '#8b949e',
                        padding: '4px 10px', borderRadius: 8,
                        fontSize: 11, fontWeight: 700, cursor: count === 0 && c !== 'All' ? 'not-allowed' : 'pointer',
                        letterSpacing: 0.3,
                      }}
                    >
                      {c}{count > 0 && c !== 'All' && ` ${count}`}
                    </button>
                  )
                })}
              </div>

              {/* Difficulty chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <span style={{ color: '#484f58', fontSize: 10, fontWeight: 700, letterSpacing: 1, alignSelf: 'center', marginRight: 4 }}>DIFFICULTY</span>
                {DIFFS.map(d => {
                  const active = diffFilter === d
                  const tone = d === 'All' ? { c: '#8b949e', bg: 'rgba(139,148,158,0.1)' } :
                               d === 'Beginner' ? { c: '#4caf50', bg: 'rgba(76,175,80,0.1)' } :
                               d === 'Intermediate' ? { c: '#ffa726', bg: 'rgba(255,167,38,0.1)' } :
                               { c: '#f85149', bg: 'rgba(248,81,73,0.1)' }
                  return (
                    <button
                      key={d}
                      onClick={() => setDiffFilter(d)}
                      style={{
                        background: active ? tone.bg : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${active ? tone.c + '66' : '#30363d'}`,
                        color: active ? tone.c : '#8b949e',
                        padding: '4px 10px', borderRadius: 8,
                        fontSize: 11, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.3,
                      }}
                    >
                      {d}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* ── Tutorial grid ── */}
            {visible.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '40px 20px',
                color: '#484f58', fontSize: 13,
                background: 'rgba(22,27,34,0.6)', border: '1px dashed #30363d', borderRadius: 12,
              }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🕳</div>
                No tutorials match those filters. Try clearing them.
              </div>
            ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
              {visible.map(t => {
                const done = (progress[t.id] ?? 0) >= t.steps.length
                const inProgress = (progress[t.id] ?? 0) > 0 && !done
                const diff = DIFF_STYLE[t.difficulty]
                return (
                  <button
                    key={t.id}
                    onClick={() => open(t.id)}
                    style={{
                      textAlign: 'left', background: 'rgba(22,27,34,0.9)',
                      border: `1px solid ${done ? 'rgba(76,175,80,0.45)' : '#21262d'}`,
                      borderRadius: 14, padding: 20,
                      cursor: 'pointer', transition: 'all 0.18s',
                      display: 'flex', flexDirection: 'column', gap: 8,
                      position: 'relative',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 10px 30px rgba(0,0,0,0.4)' }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' }}
                  >
                    {done && (
                      <span style={{ position: 'absolute', top: 14, right: 14, background: 'rgba(76,175,80,0.15)', color: '#4caf50', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 800, letterSpacing: 0.5 }}>
                        ✓ DONE
                      </span>
                    )}
                    {inProgress && (
                      <span style={{ position: 'absolute', top: 14, right: 14, background: 'rgba(88,166,255,0.12)', color: '#58a6ff', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 800, letterSpacing: 0.5 }}>
                        ↻ IN PROGRESS
                      </span>
                    )}
                    <div style={{ fontSize: 30 }}>{t.icon}</div>
                    <div style={{ color: '#e6edf3', fontSize: 15, fontWeight: 700 }}>{t.title}</div>
                    <div style={{ color: '#8b949e', fontSize: 12, lineHeight: 1.5, minHeight: 40 }}>{t.tagline}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <span style={{
                        background: diff.bg, color: diff.color, padding: '2px 8px',
                        borderRadius: 10, fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
                      }}>{t.difficulty}</span>
                      <span style={{
                        background: 'rgba(255,255,255,0.05)', color: '#8b949e',
                        padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                      }}>⏱ {t.estMinutes} min</span>
                      <span style={{
                        background: 'rgba(255,255,255,0.05)', color: '#8b949e',
                        padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                      }}>{t.steps.length} steps</span>
                    </div>
                  </button>
                )
              })}
            </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default TutorialsPage
