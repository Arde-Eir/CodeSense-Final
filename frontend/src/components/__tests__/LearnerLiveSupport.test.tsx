import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { LearnerLiveSupport } from '@/components/LearnerLiveSupport'
import type { SupportSession } from '@/services/liveSupport'

const { getLearnerOpenSession, endSupportSession } = vi.hoisted(() => ({
  getLearnerOpenSession: vi.fn<(userId: string) => Promise<SupportSession | null>>(),
  endSupportSession: vi.fn<(sessionId: string) => Promise<SupportSession>>(),
}))

// Isolate the remote service; each render still owns its actual React refs,
// polling interval and cleanup, just as an independent browser tab would.
vi.mock('@/components/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'learner' }, isGuest: false, isAdmin: false }),
}))
vi.mock('@/services/liveSupport', () => ({ getLearnerOpenSession, endSupportSession }))
vi.mock('@/services/supportConnection', () => ({}))
vi.mock('@/services/supportControl', () => ({}))

const activeSession: SupportSession = {
  id: 'session', adminId: 'admin', adminName: 'Administrator', learnerId: 'learner',
  status: 'active', requestedAt: '2026-09-24T00:00:00Z',
  acceptedAt: '2026-09-24T00:01:00Z', endedAt: null,
  expiresAt: '2026-09-24T01:01:00Z',
}

describe('live support in another learner tab', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('VITE_SUPPORT_ENABLED', 'true')
    getLearnerOpenSession.mockReset().mockResolvedValue(activeSession)
    endSupportSession.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('leaves an already active session running on poll and tab close', async () => {
    const tab = await act(async () => render(<LearnerLiveSupport />))
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(getLearnerOpenSession).toHaveBeenCalledTimes(3)
    expect(screen.queryByTestId('learner-stop-live-help')).not.toBeInTheDocument()
    tab.unmount()
    expect(endSupportSession).not.toHaveBeenCalled()
  })

  it('dismisses a pending prompt when a different tab accepts without ending it', async () => {
    getLearnerOpenSession.mockResolvedValueOnce({ ...activeSession, status: 'requested', acceptedAt: null })
    const tab = await act(async () => render(<LearnerLiveSupport />))
    expect(screen.getByTestId('learner-accept-live-help')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(screen.queryByTestId('learner-accept-live-help')).not.toBeInTheDocument()
    expect(screen.queryByTestId('learner-stop-live-help')).not.toBeInTheDocument()
    tab.unmount()
    expect(endSupportSession).not.toHaveBeenCalled()
  })
})
