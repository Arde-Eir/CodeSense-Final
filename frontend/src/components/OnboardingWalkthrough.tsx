/** First-use tour, persisted in localStorage and replayable from the profile menu. */
import React, { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { OnboardingDialog } from './OnboardingDialog'
import './OnboardingWalkthrough.css'

export const ONBOARD_KEY = 'cs-onboarded-v1'
export const ONBOARD_ACTIVE_KEY = 'cs-onboard-active-v1'
export const ONBOARD_STEP_KEY = 'cs-onboard-step-v1'
export const ONBOARD_VIEW_KEY = 'cs-onboard-view-v1'

interface Step {
  icon: string
  title: string
  kicker: string
  body: React.ReactNode
  takeaways: string[]
  action?: { label: string; path: string }
}

type TourView = 'guide' | 'exploring' | 'minimized'
interface TourProgress { idx: number; view: TourView }
interface TourState { progress: TourProgress | null; error: string | null }

const storageErrorMessage = (error: Error): string => `Welcome tour progress could not be saved or restored: ${error.message}. Allow site storage, then retry.`

const readInitialProgress = (stepCount: number): TourState => {
  try {
    const idx = Number(localStorage.getItem(ONBOARD_STEP_KEY) ?? '0')
    const view = localStorage.getItem(ONBOARD_VIEW_KEY) ?? 'guide'
    if (!Number.isInteger(idx) || idx < 0 || idx >= stepCount) throw new RangeError('The saved tour step is invalid; restart the tour')
    if (view !== 'guide' && view !== 'exploring' && view !== 'minimized') throw new RangeError('The saved tour view is invalid; restart the tour')
    return { progress: { idx, view }, error: null }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { progress: null, error: storageErrorMessage(error) }
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
          Opening a feature shrinks the tour into a small guide so you can try the
          page. Review the same step or continue when you are ready.
        </p>
      </>
    ),
    takeaways: ['Replay anytime from the profile menu', 'Open features and try them as you learn', 'Minimize to pause; End tour finishes it'],
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
          code that fired, the line, and a human-readable explanation.
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
  backgroundRef: RefObject<HTMLDivElement | null>
  startError: string | null
  onFinish: () => void
}> = ({ isAdmin, isGuest, backgroundRef, startError, onFinish }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const steps = STEPS(isAdmin, isGuest)
  const [state, setState] = useState<TourState>(() => startError
    ? { progress: null, error: startError }
    : readInitialProgress(steps.length))
  const resumeRef = useRef<HTMLButtonElement>(null)
  const reviewRef = useRef<HTMLButtonElement>(null)
  const view = state.progress?.view

  useEffect(() => {
    if (view === 'minimized') resumeRef.current?.focus()
    if (view === 'exploring') reviewRef.current?.focus()
  }, [view])

  const changeProgress = (progress: TourProgress): boolean => {
    try {
      localStorage.setItem(ONBOARD_STEP_KEY, String(progress.idx))
      localStorage.setItem(ONBOARD_VIEW_KEY, progress.view)
      localStorage.setItem(ONBOARD_ACTIVE_KEY, 'true')
    } catch (error) {
      if (!(error instanceof Error)) throw error
      setState(previous => ({ ...previous, error: storageErrorMessage(error) }))
      return false
    }
    setState({ progress, error: null })
    return true
  }

  const finish = (): void => {
    try {
      localStorage.setItem(ONBOARD_KEY, 'done')
      localStorage.removeItem(ONBOARD_ACTIVE_KEY)
      localStorage.removeItem(ONBOARD_STEP_KEY)
      localStorage.removeItem(ONBOARD_VIEW_KEY)
    } catch (error) {
      if (!(error instanceof Error)) throw error
      setState(previous => ({ ...previous, error: storageErrorMessage(error) }))
      return
    }
    onFinish()
  }

  if (!state.progress || state.error) return createPortal(
    <section className="cs-tour-error" role="alert" data-testid="welcome-tour-error">
      <h2>Welcome tour paused</h2>
      <p>{state.error}</p>
      <button type="button" data-testid="welcome-tour-retry" onClick={() => changeProgress(state.progress ?? { idx: 0, view: 'guide' })}>
        {state.progress ? 'Retry saving progress' : 'Restart tour'}
      </button>
      <button type="button" data-testid="welcome-tour-close-error" onClick={onFinish}>Close without saving</button>
    </section>, document.body,
  )

  const { idx } = state.progress
  const step = steps[idx]
  const action = step.action
  const isLast = idx === steps.length - 1
  const counter = `Welcome tour · ${idx + 1} / ${steps.length}`
  const minimize = (): void => { changeProgress({ idx, view: 'minimized' }) }
  const review = (): void => { changeProgress({ idx, view: 'guide' }) }
  const next = (): void => {
    if (isLast) finish()
    else changeProgress({ idx: idx + 1, view: 'guide' })
  }
  const openFeature = (path: string): void => {
    if (changeProgress({ idx, view: 'exploring' })) navigate(path)
  }

  if (view === 'minimized') return createPortal(
    <button ref={resumeRef} type="button" className="cs-tour-resume" data-testid="welcome-tour-resume" onClick={review}>
      <span aria-hidden="true">🗺️</span> Resume tour · {idx + 1}/{steps.length}
    </button>, document.body,
  )

  if (view === 'exploring') return createPortal(
    <section className="cs-tour-dock" aria-label="Welcome tour guide" data-testid="welcome-tour-dock">
      <div className="cs-tour-dock-heading">
        <div className="cs-tour-counter">{counter}</div>
        <button type="button" data-testid="welcome-tour-minimize" onClick={minimize}>Minimize</button>
      </div>
      <h2>{step.icon} {step.title}</h2>
      <p>Try this page freely. Your place is saved; continue when you are ready.</p>
      <div className="cs-tour-dock-actions">
        <button ref={reviewRef} type="button" data-testid="welcome-tour-review" onClick={review}>Review step</button>
        <button type="button" className="cs-tour-primary" data-testid="welcome-tour-next" onClick={next}>{isLast ? 'Finish tour' : 'Next step →'}</button>
        {action && location.pathname !== action.path && <button type="button" data-testid="welcome-tour-open-feature" onClick={() => openFeature(action.path)}>{action.label}</button>}
      </div>
      <button type="button" className="cs-tour-end" data-testid="welcome-tour-end" onClick={finish}>End tour</button>
    </section>, document.body,
  )

  return (
    <OnboardingDialog backgroundRef={backgroundRef} onPause={minimize} stepIndex={idx}>
      <header className="cs-tour-header">
        <span className="cs-tour-counter">{counter}</span>
        <div className="cs-tour-header-actions">
          <button type="button" data-testid="welcome-tour-minimize" onClick={minimize}>Pause</button>
          <button type="button" data-testid="welcome-tour-end" onClick={finish}>End tour</button>
        </div>
      </header>
      <div className="cs-tour-progress" role="progressbar" aria-label="Tour progress" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={idx + 1}>
        <div style={{ width: `${((idx + 1) / steps.length) * 100}%` }} />
      </div>
      <div key={idx} className="cs-tour-content" data-testid="welcome-tour-content">
        <div className="cs-tour-title">
          <span className="cs-tour-icon" aria-hidden="true">{step.icon}</span>
          <div>
            <div className="cs-tour-kicker">{step.kicker}</div>
            <h2 id="codesense-tour-title" data-testid="welcome-tour-title">{step.title}</h2>
          </div>
        </div>
        <div className="cs-tour-body">{step.body}</div>
        <ul className="cs-tour-takeaways">
          {step.takeaways.map(takeaway => <li key={takeaway}><span aria-hidden="true">✓</span>{takeaway}</li>)}
        </ul>
        {action && <>
          <button type="button" className="cs-tour-action" data-testid="welcome-tour-open-feature" onClick={() => openFeature(action.path)}>{action.label}</button>
          <p className="cs-tour-action-note">The guide will shrink so you can explore. This step stays saved until you continue.</p>
        </>}
      </div>
      <footer className="cs-tour-footer">
        <label className="cs-tour-step-picker">Jump to a step
          <select data-testid="welcome-tour-step" value={idx} onChange={event => {
            const selected = Number(event.target.value)
            if (!Number.isInteger(selected) || selected < 0 || selected >= steps.length) throw new RangeError(`Invalid welcome-tour step: ${event.target.value}`)
            changeProgress({ idx: selected, view: 'guide' })
          }}>
            {steps.map((item, index) => <option key={item.title} value={index}>{index + 1}. {item.title}</option>)}
          </select>
        </label>
        <div className="cs-tour-page-controls">
          <button type="button" data-testid="welcome-tour-back" disabled={idx === 0} onClick={() => changeProgress({ idx: idx - 1, view: 'guide' })}>← Back</button>
          <button type="button" className="cs-tour-primary" data-testid="welcome-tour-next" onClick={next}>{isLast ? '🚀 Start exploring' : 'Next →'}</button>
        </div>
      </footer>
    </OnboardingDialog>
  )
}

export default OnboardingWalkthrough
