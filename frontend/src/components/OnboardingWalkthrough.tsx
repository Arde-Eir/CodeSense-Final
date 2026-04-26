/**
 * OnboardingWalkthrough.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Optional first-time tour that runs after a user registers. Shown once only
 * (gated by localStorage). Explains every surface of the app in 9 steps, with
 * "Skip", "Back", and "Next / Got it" controls. Each step can deep-link to
 * the feature it describes so users can try it immediately.
 *
 * Trigger: the Home dashboard mounts, sees the user is authenticated AND
 * `localStorage['cs-onboarded-v1'] !== 'done'`, and renders this component.
 * Users can also replay it from Profile → Help (if we add a button there).
 */
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export const ONBOARD_KEY = 'cs-onboarded-v1'

interface Step {
  icon: string
  title: string
  body: React.ReactNode
  /** Optional action: either navigate somewhere or run a callback. */
  action?: { label: string; path?: string; onClick?: () => void }
}

const STEPS = (isAdmin: boolean): Step[] => [
  {
    icon: '👋',
    title: 'Welcome to CodeSense',
    body: (
      <>
        <p>
          CodeSense is a <b>deterministic C++ analyzer</b> wrapped in a gamified
          learning environment. This quick tour takes about <b>90 seconds</b>{' '}
          and shows you every surface of the app.
        </p>
        <p style={{ color: '#8b949e', fontSize: 12 }}>
          You can <b>Skip</b> at any time — this tour is optional and won't
          reappear unless you ask for it.
        </p>
      </>
    ),
  },
  {
    icon: '🏠',
    title: 'Home Dashboard',
    body: (
      <>
        <p>The hub. You'll see five zones:</p>
        <ul style={{ paddingLeft: 20, lineHeight: 1.9, color: '#c9d1d9', fontSize: 13 }}>
          <li><b>Search bar</b> — finds players, quests, your reports, actions.</li>
          <li><b>🔔 Notification bell</b> — system announcements, quest completions, achievements, rank-ups, admin actions on you.</li>
          <li><b>Mode cards</b> — Sandbox and Campaign.</li>
          <li><b>Command Center</b> — Quick Start to your last snippet + recent analyses.</li>
          <li><b>Leaderboard mini</b> — top 10 by XP with your rank highlighted.</li>
        </ul>
      </>
    ),
  },
  {
    icon: '🔬',
    title: 'Sandbox — Experiment Freely',
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
    action: { label: 'Open Sandbox →', path: '/sandbox' },
  },
  {
    icon: '🧩',
    title: 'Build Mode — Flowchart to C++',
    body: (
      <>
        <p>
          Toggle <b>Build Mode</b> inside the Sandbox. Drag ISO 5807 shapes
          (Start, Decision, Process, I/O, …) onto the canvas, wire them, then
          hit <b>⚡ GENERATE C++</b>. The generator walks your graph and emits
          compilable code.
        </p>
        <p>
          Before emit, the <b>GraphValidator</b> runs eleven rules (missing
          Start, unreachable nodes, unlabelled decisions, …). Any blocker shows
          up in the Validation Panel.
        </p>
      </>
    ),
  },
  {
    icon: '⚔️',
    title: 'Campaign — Earn XP',
    body: (
      <>
        <p>
          Campaign turns learning into quests grouped by phase (<b>Beginner →
          Intermediate → Advanced</b>). Each quest has objectives, starter
          code, and hints with an XP cost.
        </p>
        <p>
          XP unlocks titles — <b>Squire · Knight · Lord · Duke · King</b> — at
          1,000 / 4,000 / 10,000 / 25,000 XP. Displayed title is cosmetic:
          pick any unlocked one in Profile → Settings.
        </p>
      </>
    ),
    action: { label: 'Open Campaign →', path: '/campaign' },
  },
  {
    icon: '🏆',
    title: 'Leaderboard & Achievements',
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
    action: { label: 'View Leaderboard →', path: '/leaderboard' },
  },
  {
    icon: '👤',
    title: 'Profile Settings',
    body: (
      <>
        <p>
          <b>Profile → Overview / Achievements / Activity / Settings / Learn</b>
          {' '}— five tabs for everything personal. Upload an avatar (circular
          crop) and banner, pick your displayed title from unlocked ranks,
          change your password, and (carefully) use the Danger Zone to delete
          your account.
        </p>
      </>
    ),
    action: { label: 'Go to Profile →', path: '/profile' },
  },
  {
    icon: '📘',
    title: 'Tutorials & User Manual',
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
    action: { label: 'Open Tutorials →', path: '/tutorials' },
  },
  ...(isAdmin
    ? [
        {
          icon: '🛡',
          title: 'Admin Panel (You Have Access)',
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
          action: { label: 'Open Admin Panel →', path: '/admin' },
        } as Step,
      ]
    : []),
  {
    icon: '🎉',
    title: "You're all set",
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
  },
]

export const OnboardingWalkthrough: React.FC<{
  isAdmin: boolean
  onFinish: () => void
}> = ({ isAdmin, onFinish }) => {
  const navigate = useNavigate()
  const steps = STEPS(isAdmin)
  const [idx, setIdx] = useState(0)
  const step = steps[idx]
  const isLast = idx === steps.length - 1

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finish = () => {
    try { localStorage.setItem(ONBOARD_KEY, 'done') } catch { /* quota */ }
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
      finish()
      navigate(step.action.path)
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
    }}>
      <style>{`
        @keyframes obFadeIn  { from{opacity:0} to{opacity:1} }
        @keyframes obSlideUp { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      <div style={{
        background: 'linear-gradient(155deg, #161b22 0%, #0d1117 100%)',
        border: '1px solid #30363d', borderRadius: 18,
        maxWidth: 540, width: '100%', padding: 0,
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
        <div style={{ padding: '28px 28px 24px', flex: 1 }}>
          <div style={{ fontSize: 44, marginBottom: 10 }}>{step.icon}</div>
          <h2 style={{
            color: '#e6edf3', fontSize: 22, fontWeight: 800,
            margin: '0 0 12px',
          }}>
            {step.title}
          </h2>
          <div style={{ color: '#c9d1d9', fontSize: 14, lineHeight: 1.75 }}>
            {step.body}
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
        <div style={{
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
          <div style={{ display: 'flex', gap: 6 }}>
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
