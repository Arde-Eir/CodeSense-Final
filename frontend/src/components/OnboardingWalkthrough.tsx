/**
 * OnboardingWalkthrough.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Optional first-time tour that runs after a user registers. Shown once only
 * (gated by localStorage). Explains every surface of the app, with
 * "Skip", "Back", and "Next / Got it" controls. Each step can deep-link to
 * the feature it describes so users can try it immediately.
 *
 * Trigger: the Home dashboard mounts, sees the user is authenticated AND
 * `localStorage['cs-onboarded-v1'] !== 'done'`, and renders this component.
 * Users can also replay it from the profile menu.
 */
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export const ONBOARD_KEY = 'cs-onboarded-v1'
export const ONBOARD_ACTIVE_KEY = 'cs-onboard-active-v1'
export const ONBOARD_STEP_KEY = 'cs-onboard-step-v1'

interface Step {
  icon: string
  title: string
  kicker: string
  body: React.ReactNode
  takeaways: string[]
  /** Optional action: either navigate somewhere or run a callback. */
  action?: { label: string; path?: string; onClick?: () => void }
}

const readInitialStep = (stepCount: number): number => {
  try {
    const raw = Number(localStorage.getItem(ONBOARD_STEP_KEY) ?? '0')
    return Number.isInteger(raw) ? Math.max(0, Math.min(stepCount - 1, raw)) : 0
  } catch {
    return 0
  }
}

const STEPS = (isAdmin: boolean, isGuest: boolean): Step[] => [
  {
    icon: '👋',
    title: 'Welcome to CodeSense',
    kicker: 'Fast orientation',
    body: (
      <>
        <p>
          CodeSense is a <b>deterministic C++ analyzer</b> wrapped in a learning
          workspace. This replay gives you the shortest path through analysis,
          quests, progress, and profile tools.
        </p>
        <p style={{ color: '#8b949e', fontSize: 12, marginTop: 10 }}>
          It saves your current step while you move around, so opening a feature
          from the tour will not lose your place.
        </p>
      </>
    ),
    takeaways: ['Replay anytime from the profile menu', 'Use feature buttons to jump around', 'Skip finishes the tour cleanly'],
  },
  {
    icon: '🏠',
    title: 'Home Dashboard',
    kicker: 'Your command center',
    body: (
      <>
        <p>The dashboard is built for quick recovery: find what changed, jump to
          the right workspace, and pick up where you left off.</p>
        <ul style={{ paddingLeft: 20, lineHeight: 1.9, color: '#c9d1d9', fontSize: 13 }}>
          <li><b>Global search</b> finds players, quests, reports, and actions.</li>
          <li><b>Notifications</b> collect announcements, completions, rank-ups, and account events.</li>
          <li><b>Command Center</b> restores your latest snippet and recent analyses.</li>
          <li><b>Leaderboard mini</b> shows the current top players and your rank context.</li>
        </ul>
      </>
    ),
    takeaways: ['Search is the fastest navigation', 'Recent work lives in Command Center', 'Announcements are also in the profile menu'],
  },
  {
    icon: '🔬',
    title: 'Sandbox — Experiment Freely',
    kicker: 'Analyze real C++',
    body: (
      <>
        <p>
          The Sandbox is where you paste or write C++ and press{' '}
          <b style={{ color: '#e3b341' }}>ANALYZE</b>. The analyser runs five
          deterministic stages — lexer → parser → AST → CFG → rule engine —
          and returns verdicts across seven tabs.
        </p>
        <p>
          Each verdict is <b>SAFE · WARNING · UNSAFE</b> with the exact rule
          code that fired, the line, and a human-readable explanation. No LLM,
          no guessing.
        </p>
      </>
    ),
    takeaways: ['Verdicts are deterministic', 'Rule codes explain every warning', 'Reports feed your progress history'],
    action: { label: 'Open Sandbox →', path: '/sandbox' },
  },
  {
    icon: '🧩',
    title: 'Build Mode — Flowchart to C++',
    kicker: 'Visual logic builder',
    body: (
      <>
        <p>
          Toggle <b>Build Mode</b> inside the Sandbox. Click <b>☰ TOOLS</b> (top-right of
          the canvas) to open the shape palette — pick from 12 ISO 5807 shapes
          (Terminator, Decision, Process, I/O, Junction, Connector, and more),
          wire them, then hit <b>⚡ GENERATE C++</b>. When you run Analyze Code
          first, the CFG is auto-generated with the correct shapes (merge points
          become Junctions, break/continue become On-page Connectors, etc.).
        </p>
        <p>
          Before emit, the <b>GraphValidator</b> runs eleven rules (missing
          Start, unreachable nodes, unlabelled decisions, …). Any blocker shows
          up in the Validation Panel.
        </p>
      </>
    ),
    takeaways: ['Use ISO 5807 shapes', 'Validation blocks broken graphs', 'Generate only after required paths connect'],
  },
  {
    icon: '⚔️',
    title: 'Campaign — Earn XP',
    kicker: 'Structured practice',
    body: (
      <>
        <p>
          Campaign turns learning into quests grouped by phase (<b>Beginner →
          Intermediate → Advanced</b>). Each quest has objectives, starter
          code, and hints with an XP cost.
        </p>
        <p>
          XP unlocks titles — <b>Squire · Knight · Lord · Duke · King</b> — at
          5,000 / 20,000 / 75,000 / 250,000 XP. Ranks are intentionally hard
          to earn. Displayed title is cosmetic: pick any unlocked one in Profile → Settings.
        </p>
      </>
    ),
    takeaways: ['Quests are grouped by phase', 'Hints trade XP for help', 'Unlocked titles can be displayed in Profile'],
    action: isGuest
      ? { label: 'Create account for Campaign →', path: '/signup' }
      : { label: 'Open Campaign →', path: '/campaign' },
  },
  ...(!isGuest
    ? [
        {
          icon: '📊',
          title: 'Progress Report',
          kicker: 'Your learning signal',
          body: (
            <>
              <p>
                Progress Report turns your activity into readable trends:
                XP growth, quest completion, analysis volume, streaks, recent
                work, and campaign movement.
              </p>
              <p>
                Use it when you want to know whether you are practicing broadly
                or only repeating one comfortable path.
              </p>
            </>
          ),
          takeaways: ['Track XP and level movement', 'Review recent analyses', 'Spot gaps before your next quest'],
          action: { label: 'Open Progress →', path: '/progress' },
        } as Step,
      ]
    : []),
  {
    icon: '🏆',
    title: 'Leaderboard & Achievements',
    kicker: 'Community context',
    body: (
      <>
        <p>
          The Leaderboard ranks every player in realtime. You can sort by XP,
          level, activity, or join date; filter by Student / Professional;
          click any row to see that player's detail card; and share your rank.
        </p>
        <p>
          <b>12 achievement badges</b> across 4 rarities track your activity —
          see them all in <b>Profile → Achievements</b>.
        </p>
      </>
    ),
    takeaways: ['Compare by XP and activity', 'Open public player detail cards', 'Achievements show long-term habits'],
    action: { label: 'View Leaderboard →', path: '/leaderboard' },
  },
  {
    icon: '👤',
    title: 'Profile Settings',
    kicker: 'Your public identity',
    body: (
      <>
        <p>
          <b>Profile → Overview / Achievements / Activity / Settings / Learn</b>
          {' '}— five tabs for everything personal. Upload an avatar (circular
          crop) and banner, pick your displayed title from unlocked ranks,
          change your password, and tune how other players see your profile.
        </p>
      </>
    ),
    takeaways: ['Avatar and banner personalize your card', 'Unlocked titles are cosmetic', 'Settings affect account details'],
    action: isGuest
      ? { label: 'Create account for Profile →', path: '/signup' }
      : { label: 'Go to Profile →', path: '/profile' },
  },
  {
    icon: '📘',
    title: 'Tutorials & User Manual',
    kicker: 'Reference and practice',
    body: (
      <>
        <p>
          Stuck? Two places to learn:
        </p>
        <ul style={{ paddingLeft: 20, lineHeight: 1.9, color: '#c9d1d9', fontSize: 13 }}>
          <li><b>Tutorials</b> — multi-step interactive quests (progress auto-saves).</li>
          <li><b>User Manual</b> — 19 sections covering every feature, every rule code, every keyboard shortcut.</li>
        </ul>
        <p style={{ color: '#8b949e', fontSize: 12 }}>
          Both are always reachable from the 👤 Profile dropdown (top right).
        </p>
      </>
    ),
    takeaways: ['Tutorials save progress', 'Manual explains rule codes', 'Patch notes show what recently changed'],
    action: { label: 'Open Tutorials →', path: '/tutorials' },
  },
  ...(isAdmin
    ? [
        {
          icon: '🛡',
          title: 'Admin Panel (You Have Access)',
          kicker: 'Operations tools',
          body: (
            <>
              <p>
                As an admin you can reach <b>/admin</b> via the profile
                dropdown. Five tabs: <b>Dashboard · Users · Audit Logs ·
                Maintenance · Announcements</b>.
              </p>
              <p>
                The <b>Preview</b> action impersonates a user (read-only — your
                admin powers are suspended while previewing). Ban / Unban /
                Toggle-Admin all require RLS policies — see the User Manual
                section "Signup, CAPTCHA & Ban Handling" for the SQL.
              </p>
            </>
          ),
          takeaways: ['Preview users without keeping admin powers', 'Review audit logs', 'Publish announcements'],
          action: { label: 'Open Admin Panel →', path: '/admin' },
        } as Step,
      ]
    : []),
  {
    icon: '🎉',
    title: "You're all set",
    kicker: 'Tour complete',
    body: (
      <>
        <p>That's the full tour. You can always reach:</p>
        <ul style={{ paddingLeft: 20, lineHeight: 1.9, color: '#c9d1d9', fontSize: 13 }}>
          <li><b>Tutorials</b> — step-by-step practice</li>
          <li><b>User Manual</b> — complete reference</li>
          <li>Profile dropdown → any of the above</li>
        </ul>
        <p style={{ color: '#8b949e', fontSize: 12, marginTop: 10 }}>
          Ready? Click <b>Start exploring</b> below to finish the tour.
        </p>
      </>
    ),
    takeaways: ['Start in Sandbox for experiments', 'Use Campaign for guided XP', 'Replay this tour whenever the app changes'],
  },
]

export const OnboardingWalkthrough: React.FC<{
  isAdmin: boolean
  isGuest: boolean
  onFinish: () => void
}> = ({ isAdmin, isGuest, onFinish }) => {
  const navigate = useNavigate()
  const steps = STEPS(isAdmin, isGuest)
  const [idx, setIdx] = useState(() => readInitialStep(steps.length))
  const step = steps[idx]
  const isLast = idx === steps.length - 1

  // Close on Escape
  useEffect(() => {
    try { localStorage.setItem(ONBOARD_ACTIVE_KEY, 'true') } catch { /* quota */ }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') skip() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(ONBOARD_ACTIVE_KEY, 'true')
      localStorage.setItem(ONBOARD_STEP_KEY, String(idx))
    } catch { /* quota */ }
  }, [idx])

  const finish = () => {
    try {
      localStorage.setItem(ONBOARD_KEY, 'done')
      localStorage.removeItem(ONBOARD_ACTIVE_KEY)
      localStorage.removeItem(ONBOARD_STEP_KEY)
    } catch { /* quota */ }
    onFinish()
  }

  const skip = () => finish()

  const next = () => {
    if (isLast) finish()
    else setIdx(i => Math.min(steps.length - 1, i + 1))
  }

  const back = () => setIdx(i => Math.max(0, i - 1))

  const goToAction = () => {
    if (!step.action) return
    if (step.action.path) {
      const nextIdx = isLast ? idx : Math.min(steps.length - 1, idx + 1)
      try {
        localStorage.setItem(ONBOARD_ACTIVE_KEY, 'true')
        localStorage.setItem(ONBOARD_STEP_KEY, String(nextIdx))
      } catch { /* quota */ }
      navigate(step.action.path)
      // Advance to the next step so the tour continues after the navigation.
      // Do NOT call finish() — the tour is a persistent overlay at App level.
      if (!isLast) setIdx(nextIdx)
    } else {
      step.action.onClick?.()
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(3,5,9,0.85)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      animation: 'obFadeIn 0.2s ease',
    }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="codesense-tour-title"
    >
      <style>{`
        @keyframes obFadeIn  { from{opacity:0} to{opacity:1} }
        @keyframes obSlideUp { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
        @media (max-width: 620px) {
          .cs-onboard-card { max-height: calc(100vh - 28px); }
          .cs-onboard-content { padding: 22px 18px 18px !important; }
          .cs-onboard-footer { padding: 14px 18px !important; gap: 12px; }
          .cs-onboard-dots { display: none !important; }
        }
      `}</style>

      <div className="cs-onboard-card" style={{
        background: 'linear-gradient(155deg, #161b22 0%, #0d1117 100%)',
        border: '1px solid #30363d', borderRadius: 18,
        maxWidth: 620, width: '100%', padding: 0,
        maxHeight: 'calc(100vh - 48px)',
        boxShadow: '0 30px 90px rgba(0,0,0,0.8), 0 0 0 1px rgba(76,175,80,0.1)',
        animation: 'obSlideUp 0.28s ease-out',
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid #21262d',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              background: 'rgba(76,175,80,0.12)', color: '#4caf50',
              padding: '3px 10px', borderRadius: 10,
              fontSize: 10, fontWeight: 800, letterSpacing: 1.2,
              fontFamily: "'IBM Plex Mono', monospace",
            }}>
              WELCOME TOUR · {idx + 1} / {steps.length}
            </span>
          </div>
          <button onClick={skip}
            style={{
              background: 'transparent', border: 'none', color: '#8b949e',
              fontSize: 12, cursor: 'pointer', padding: 0,
              textDecoration: 'underline',
            }}>
            Skip tour
          </button>
        </div>

        {/* Progress bar */}
        <div style={{ background: '#21262d', height: 3 }}>
          <div style={{
            width: `${((idx + 1) / steps.length) * 100}%`, height: '100%',
            background: 'linear-gradient(90deg, #4caf50, #66bb6a)',
            transition: 'width 0.3s ease',
          }} />
        </div>

        {/* Content */}
        <div className="cs-onboard-content" style={{ padding: '28px 28px 24px', flex: 1, overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 12 }}>
            <div style={{
              width: 58, height: 58, borderRadius: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(227,179,65,0.12)',
              border: '1px solid rgba(227,179,65,0.24)',
              fontSize: 34,
              flexShrink: 0,
            }}>{step.icon}</div>
            <div>
              <div style={{
                color: '#e3b341',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: 1.1,
                textTransform: 'uppercase',
                marginBottom: 6,
              }}>
                {step.kicker}
              </div>
              <h2 id="codesense-tour-title" style={{
            color: '#e6edf3', fontSize: 22, fontWeight: 800,
            margin: '0 0 12px',
          }}>
            {step.title}
          </h2>
            </div>
          </div>
          <div style={{ color: '#c9d1d9', fontSize: 14, lineHeight: 1.75 }}>
            {step.body}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 10,
            marginTop: 18,
          }}>
            {step.takeaways.map(takeaway => (
              <div
                key={takeaway}
                style={{
                  background: 'rgba(22,27,34,0.88)',
                  border: '1px solid #30363d',
                  borderRadius: 10,
                  color: '#c9d1d9',
                  fontSize: 12,
                  lineHeight: 1.45,
                  padding: '10px 12px',
                }}
              >
                <span style={{ color: '#4caf50', fontWeight: 900, marginRight: 6 }}>✓</span>
                {takeaway}
              </div>
            ))}
          </div>
        </div>

        {/* Action button (if any) */}
        {step.action && (
          <div style={{ padding: '0 28px' }}>
            <button onClick={goToAction} style={{
              width: '100%', padding: '10px 16px',
              background: 'rgba(88,166,255,0.1)',
              border: '1px solid rgba(88,166,255,0.35)',
              color: '#58a6ff', borderRadius: 8,
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
              letterSpacing: 0.4, transition: 'all 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(88,166,255,0.18)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(88,166,255,0.1)' }}
            >
              {step.action.label}
            </button>
          </div>
        )}

        {/* Footer nav */}
        <div className="cs-onboard-footer" style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '18px 28px', borderTop: '1px solid #21262d', marginTop: 24,
        }}>
          <button onClick={back} disabled={idx === 0}
            style={{
              background: 'transparent', border: '1px solid #30363d',
              color: '#8b949e', padding: '8px 18px', borderRadius: 8,
              fontSize: 12, fontWeight: 700, cursor: idx === 0 ? 'not-allowed' : 'pointer',
              opacity: idx === 0 ? 0.4 : 1, letterSpacing: 0.4,
            }}
          >
            ← Back
          </button>

          {/* Dot indicators */}
          <div className="cs-onboard-dots" style={{ display: 'flex', gap: 6 }}>
            {steps.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                style={{
                  width: i === idx ? 18 : 6, height: 6,
                  borderRadius: 3,
                  background: i === idx ? '#4caf50' : i < idx ? 'rgba(76,175,80,0.4)' : '#30363d',
                  border: 'none', cursor: 'pointer', padding: 0,
                  transition: 'all 0.2s ease',
                }}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>

          <button onClick={next}
            style={{
              background: isLast ? '#4caf50' : '#238636',
              border: 'none', color: 'white', padding: '8px 22px',
              borderRadius: 8, fontSize: 12, fontWeight: 700,
              cursor: 'pointer', letterSpacing: 0.4,
            }}
          >
            {isLast ? '🚀 Start exploring' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default OnboardingWalkthrough
