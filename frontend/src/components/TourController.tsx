import { useCallback, useEffect, useState, type FC, type RefObject } from 'react'
import { useAuth } from './AuthContext'
import { OnboardingWalkthrough, ONBOARD_ACTIVE_KEY, ONBOARD_KEY, ONBOARD_STEP_KEY, ONBOARD_VIEW_KEY } from './OnboardingWalkthrough'

interface TourSession { key: number; visible: boolean; error: string | null }
const startErrorMessage = (error: Error): string => `The welcome tour could not start: ${error.message}. Allow site storage, then restart the tour.`

const readInitialSession = (): TourSession => {
  try {
    return { key: 0, visible: localStorage.getItem(ONBOARD_ACTIVE_KEY) === 'true', error: null }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { key: 0, visible: true, error: startErrorMessage(error) }
  }
}

/** Keep the tour session outside Routes while respecting the current account access. */
export const TourController: FC<{ backgroundRef: RefObject<HTMLDivElement | null> }> = ({ backgroundRef }) => {
  const { user, isGuest, isAdmin } = useAuth()
  const userId = user?.id
  const [session, setSession] = useState<TourSession>(readInitialSession)
  const showStartError = useCallback((error: Error): void => {
    setSession(previous => ({ key: previous.key + 1, visible: true, error: startErrorMessage(error) }))
  }, [])

  useEffect(() => {
    if (!userId && !isGuest) return
    let active: boolean
    try {
      active = localStorage.getItem(ONBOARD_ACTIVE_KEY) === 'true'
      if (!active && (isGuest || localStorage.getItem(ONBOARD_KEY) === 'done')) return
    } catch (error) {
      if (!(error instanceof Error)) throw error
      const timer = setTimeout(() => showStartError(error), 0)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(() => {
      try {
        if (localStorage.getItem(ONBOARD_ACTIVE_KEY) !== 'true') {
          if (isGuest || localStorage.getItem(ONBOARD_KEY) === 'done') return
          localStorage.setItem(ONBOARD_STEP_KEY, '0')
          localStorage.setItem(ONBOARD_VIEW_KEY, 'guide')
          localStorage.setItem(ONBOARD_ACTIVE_KEY, 'true')
        }
        setSession(previous => ({ ...previous, visible: true, error: null }))
      } catch (error) {
        if (!(error instanceof Error)) throw error
        showStartError(error)
      }
    }, active ? 0 : 800)
    return () => clearTimeout(timer)
  }, [userId, isGuest, showStartError])

  useEffect(() => {
    const replay = (): void => {
      if (!userId && !isGuest) return
      try {
        localStorage.setItem(ONBOARD_STEP_KEY, '0')
        localStorage.setItem(ONBOARD_VIEW_KEY, 'guide')
        localStorage.setItem(ONBOARD_ACTIVE_KEY, 'true')
        setSession(previous => ({ key: previous.key + 1, visible: true, error: null }))
      } catch (error) {
        if (!(error instanceof Error)) throw error
        showStartError(error)
      }
    }
    window.addEventListener('cs-replay-tour', replay)
    return () => window.removeEventListener('cs-replay-tour', replay)
  }, [userId, isGuest, showStartError])

  if (!session.visible || (!userId && !isGuest)) return null
  return <OnboardingWalkthrough key={session.key} isAdmin={isAdmin} isGuest={isGuest}
    backgroundRef={backgroundRef} startError={session.error}
    onFinish={() => setSession(previous => ({ ...previous, visible: false }))} />
}
