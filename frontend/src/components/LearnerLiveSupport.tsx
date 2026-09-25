import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from './AuthContext'
import { applySupportControl } from '@/services/supportControl'
import {
  acceptSupportSession,
  declineSupportSession,
  endSupportSession,
  getLearnerOpenSession,
  type SupportSession,
} from '@/services/liveSupport'
import { connectSupportPublisher, type SupportPublisher } from '@/services/supportConnection'
import { assertSupportVideoCapture } from '@/services/supportVideo'

export const LearnerLiveSupport: React.FC = () => {
  const { user, isGuest, isAdmin } = useAuth()
  const [session, setSession] = useState<SupportSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const connectionRef = useRef<SupportPublisher | null>(null)
  const captureAttemptRef = useRef(0)
  const sessionRef = useRef<SupportSession | null>(null)
  const ownedSessionIdRef = useRef<string | null>(null)
  const stoppingRef = useRef(false)

  const releaseConnection = useCallback(async (): Promise<void> => {
    captureAttemptRef.current += 1
    const connection = connectionRef.current
    connectionRef.current = null
    if (connection) await connection.close()
  }, [])

  useEffect(() => { sessionRef.current = session }, [session])

  useEffect(() => {
    if (import.meta.env.VITE_SUPPORT_ENABLED !== 'true' || !user?.id || isGuest || isAdmin) return
    let mounted = true
    const poll = async () => {
      try {
        const latest = await getLearnerOpenSession(user.id)
        if (!mounted) return
        if (latest?.status === 'active' && !streamRef.current) {
          // An active session can belong to another tab of the same account.
          if (ownedSessionIdRef.current === latest.id) {
            await endSupportSession(latest.id)
            ownedSessionIdRef.current = null
          }
          if (mounted) setSession(null)
          return
        }
        const current = sessionRef.current
        if (current?.status === 'active' && latest?.id !== current.id) {
          ownedSessionIdRef.current = null
          streamRef.current?.getTracks().forEach(track => track.stop())
          streamRef.current = null
          void releaseConnection().catch(caught => setError(String(caught)))
          setCursor(null)
        }
        if (!current || current.status !== 'active' || latest?.id !== current.id) setSession(latest)
      } catch (caught: unknown) {
        if (mounted) {
          streamRef.current?.getTracks().forEach(track => track.stop())
          streamRef.current = null
          void releaseConnection().catch(error => setError(String(error)))
          setCursor(null)
          setError(caught instanceof Error ? caught.message : String(caught))
        }
      }
    }
    void poll()
    const interval = window.setInterval(() => { void poll() }, 5_000)
    return () => { mounted = false; window.clearInterval(interval) }
  }, [user?.id, isGuest, isAdmin, releaseConnection])

  useEffect(() => () => {
    const ownedSessionId = ownedSessionIdRef.current
    ownedSessionIdRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    void releaseConnection().catch(console.error)
    if (ownedSessionId) void endSupportSession(ownedSessionId).catch(console.error)
  }, [releaseConnection])

  useEffect(() => {
    const stopOnPageExit = () => {
      streamRef.current?.getTracks().forEach(track => track.stop())
      void releaseConnection().catch(console.error)
    }
    window.addEventListener('pagehide', stopOnPageExit)
    return () => window.removeEventListener('pagehide', stopOnPageExit)
  }, [releaseConnection])

  useEffect(() => {
    if (user?.id && !isGuest && !isAdmin) return
    const ownedSessionId = ownedSessionIdRef.current
    ownedSessionIdRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    void releaseConnection().catch(caught => setError(String(caught)))
    if (ownedSessionId) void endSupportSession(ownedSessionId).catch(console.error)
    setSession(null)
    setCursor(null)
  }, [user?.id, isGuest, isAdmin, releaseConnection])

  const stop = async () => {
    const ownedSessionId = ownedSessionIdRef.current
    if (!ownedSessionId || stoppingRef.current) return
    stoppingRef.current = true
    setBusy(true)
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    const closing = releaseConnection()
    setCursor(null)
    try {
      const results = await Promise.allSettled([closing, endSupportSession(ownedSessionId)])
      if (results[1].status === 'fulfilled') {
        ownedSessionIdRef.current = null
        setSession(null)
      }
      const failures = results.filter(result => result.status === 'rejected')
      if (failures.length) throw new Error(failures.map(result => String(result.reason)).join(' '))
      setError(null)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      stoppingRef.current = false
      setBusy(false)
    }
  }

  const accept = async () => {
    if (!session || busy) return
    setBusy(true)
    setError(null)
    let stream: MediaStream | null = null
    let accepted = false
    const attempt = ++captureAttemptRef.current
    try {
      assertSupportVideoCapture()
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('This browser does not support tab sharing. Open CodeSense over HTTPS in a current browser.')
      }
      const captureOptions: DisplayMediaStreamOptions & { preferCurrentTab: boolean; selfBrowserSurface: 'include' } = {
        video: { displaySurface: 'browser', width: { ideal: 1280, max: 1920 }, frameRate: { ideal: 24, max: 24 } },
        audio: false,
        // Chrome can omit the requesting tab unless it is explicitly included.
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
      }
      stream = await navigator.mediaDevices.getDisplayMedia(captureOptions)
      const track = stream.getVideoTracks()[0]
      if (!track || track.getSettings().displaySurface !== 'browser') {
        throw new Error('Select the CodeSense browser tab, not a window or your entire screen.')
      }
      if (!window.confirm(`You selected "${track.label}". Share it only if this is your CodeSense tab. Allow ${session.adminName} to view and control it?`)) {
        throw new Error('Live help was not approved. Your tab is not being shared.')
      }
      if (attempt !== captureAttemptRef.current) throw new Error('Tab sharing was cancelled.')
      streamRef.current = stream
      const active = await acceptSupportSession(session.id)
      accepted = true
      ownedSessionIdRef.current = active.id
      if (attempt !== captureAttemptRef.current) throw new Error('Tab sharing was cancelled.')
      setSession(active)
      track.addEventListener('ended', () => { void stop() }, { once: true })
      const connection = await connectSupportPublisher(active, stream, command => {
        if (streamRef.current !== stream || ownedSessionIdRef.current !== active.id || track.readyState !== 'live') {
          throw new Error('The learner has stopped sharing this tab.')
        }
        const position = applySupportControl(command)
        if (position) setCursor(position)
      }, failure => {
        void stop().then(() => setError(failure.message))
      })
      if (attempt !== captureAttemptRef.current || track.readyState !== 'live') {
        await connection.close()
        throw new Error('Tab sharing stopped while the connection was being established.')
      }
      connectionRef.current = connection
    } catch (caught: unknown) {
      stream?.getTracks().forEach(track => track.stop())
      if (streamRef.current === stream) streamRef.current = null
      let message = caught instanceof Error ? caught.message : String(caught)
      try { await releaseConnection() }
      catch (closeError) { message += ` Closing the connection failed: ${String(closeError)}` }
      if (accepted) {
        try {
          await endSupportSession(session.id)
          ownedSessionIdRef.current = null
          setSession(null)
        }
        catch (endError: unknown) { message += ` The failed session could not be ended: ${String(endError)}` }
      }
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const decline = async () => {
    if (!session) return
    setBusy(true)
    try {
      await declineSupportSession(session.id)
      setSession(null)
      setError(null)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  if (!session && !error) return null

  return <>
    {cursor && session?.status === 'active' && <div aria-hidden="true" data-support-ui style={{
      position: 'fixed', left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%`, zIndex: 2147483646,
      pointerEvents: 'none', color: '#f97316', fontSize: 25, textShadow: '0 1px 4px #000',
    }}>➤</div>}
    <aside data-support-ui role="status" style={{
      position: 'fixed', right: 16, bottom: 16, zIndex: 2147483645, maxWidth: 360,
      padding: 16, borderRadius: 12, background: '#111827', color: '#fff',
      boxShadow: '0 8px 32px #0008', fontFamily: 'system-ui, sans-serif',
    }}>
      {session?.status === 'requested' && <>
        <strong>{session.adminName} requests live help</strong>
        <p style={{ margin: '8px 0' }}>If you accept, share this CodeSense tab. The administrator can see the tab and use a visible cursor to navigate and change your account settings or content. You can stop at any time.</p>
        <button type="button" data-testid="learner-accept-live-help" disabled={busy} onClick={() => { void accept() }}>Share this tab</button>{' '}
        <button type="button" data-testid="learner-decline-live-help" disabled={busy} onClick={() => { void decline() }}>Decline</button>
      </>}
      {session?.status === 'active' && <>
        <strong>Live help with {session.adminName}</strong>
        <p style={{ margin: '8px 0' }}>This tab is being shared. The orange cursor shows the administrator’s actions.</p>
        <button type="button" data-testid="learner-stop-live-help" disabled={busy} onClick={() => { void stop() }}>Stop sharing and control</button>
      </>}
      {error && <p role="alert" style={{ margin: '8px 0', color: '#fca5a5' }}>{error}</p>}
      {!session && error && <button type="button" onClick={() => setError(null)}>Dismiss</button>}
    </aside>
  </>
}
