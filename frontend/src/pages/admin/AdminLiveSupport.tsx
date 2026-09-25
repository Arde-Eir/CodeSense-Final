import React, { useCallback, useEffect, useRef, useState } from 'react'
import { endSupportSession, getSupportSession, recordSupportClick, recordSupportSelection, recordSupportText, type SupportSession } from '@/services/liveSupport'
import { connectSupportViewer, type SupportViewer } from '@/services/supportConnection'
import { appendSupportChatMessage, type SupportChatMessage, type SupportControl } from '@/services/supportProtocol'
import { SupportChat } from '@/components/SupportChat'
import { SupportVideoView } from '@/components/SupportVideoView'
import '@/components/LiveSupport.css'

interface Props {
  session: SupportSession
  learnerName: string
  onClose: () => void
}

export const AdminLiveSupport: React.FC<Props> = ({ session: initialSession, learnerName, onClose }) => {
  const [session, setSession] = useState(initialSession)
  const [error, setError] = useState<string | null>(null)
  const [textValue, setTextValue] = useState('')
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<SupportChatMessage[]>([])
  const [chatVisible, setChatVisible] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const connectionRef = useRef<SupportViewer | null>(null)
  const actionQueueRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    let mounted = true
    const poll = async () => {
      try {
        const latest = await getSupportSession(initialSession.id)
        if (!mounted) return
        if (!latest) throw new Error('The help session no longer exists.')
        setSession(latest)
        if (latest.status === 'ended' || latest.status === 'declined' || new Date(latest.expiresAt).getTime() <= Date.now()) {
          void connectionRef.current?.close().catch(caught => setError(String(caught)))
          setConnected(false)
        }
      } catch (caught: unknown) {
        if (mounted) {
          void connectionRef.current?.close().catch(caught => setError(String(caught)))
          setConnected(false)
          setError(caught instanceof Error ? caught.message : String(caught))
        }
      }
    }
    void poll()
    const interval = window.setInterval(() => { void poll() }, 5_000)
    return () => { mounted = false; window.clearInterval(interval) }
  }, [initialSession.id])

  useEffect(() => {
    if (session.status !== 'active' || !videoRef.current) return
    let disposed = false
    void connectSupportViewer({ id: session.id, adminId: session.adminId, learnerId: session.learnerId, expiresAt: session.expiresAt }, videoRef.current,
      value => { if (!disposed) setConnected(value) },
      message => { if (!disposed) setMessages(current => appendSupportChatMessage(current, message)) },
      failure => { if (!disposed) setError(failure.message) },
    ).then(async connection => {
      if (disposed) { await connection.close(); return }
      connectionRef.current = connection
    }).catch(caught => { if (!disposed) setError(String(caught)) })
    return () => {
      disposed = true
      const connection = connectionRef.current
      connectionRef.current = null
      if (connection) void connection.close().catch(console.error)
    }
  }, [session.status, session.id, session.adminId, session.learnerId, session.expiresAt])

  const sendControl = useCallback(async (control: SupportControl): Promise<void> => {
    const queuedAt = Date.now()
    const connection = connectionRef.current
    const work = async (): Promise<void> => {
      if (!connection || !connected || connectionRef.current !== connection) {
        setError('Live control is not connected yet. Wait for the shared tab to appear.')
        return
      }
      try {
        if (Date.now() - queuedAt > 2000) throw new Error('This action is too old to apply safely. Wait for the connection to catch up and try again.')
        if (control.kind === 'click') await recordSupportClick(session.id, control.x, control.y)
        if (control.kind === 'text') await recordSupportText(session.id, control.value.length)
        if (control.kind === 'selectNext' || control.kind === 'selectPrevious') await recordSupportSelection(session.id)
        if (connectionRef.current !== connection) throw new Error('The learner disconnected before the action could be sent.')
        await connection.sendControl(control)
        if (control.kind !== 'pointer') setError(null)
      } catch (caught: unknown) {
        setError(`Live control was not sent: ${caught instanceof Error ? caught.message : String(caught)}`)
      }
    }
    actionQueueRef.current = actionQueueRef.current.then(work)
    await actionQueueRef.current
  }, [connected, session.id])

  const end = async () => {
    setBusy(true)
    setConnected(false)
    const connection = connectionRef.current
    connectionRef.current = null
    try {
      const results = await Promise.allSettled([
        connection?.close(),
        session.status === 'requested' || session.status === 'active' ? endSupportSession(session.id) : Promise.resolve(),
      ])
      const failures = results.filter(result => result.status === 'rejected')
      if (failures.length) throw new Error(failures.map(result => String(result.reason)).join(' '))
      onClose()
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const sendChat = async (text: string): Promise<void> => {
    const connection = connectionRef.current
    if (!connection) throw new Error('Chat is still connecting. Wait for the learner to connect.')
    const message = await connection.sendChat(text)
    setMessages(current => appendSupportChatMessage(current, message))
  }

  useEffect(() => {
    const changed = (): void => setFullscreen(document.fullscreenElement === dialogRef.current)
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])

  const toggleFullscreen = async (): Promise<void> => {
    try {
      if (document.fullscreenElement === dialogRef.current) await document.exitFullscreen()
      else {
        if (!dialogRef.current?.requestFullscreen) throw new Error('Fullscreen is unavailable in this browser. Use View size to enlarge the shared tab.')
        await dialogRef.current.requestFullscreen()
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return <div ref={dialogRef} className="support-workspace" data-testid="admin-live-help" role="dialog" aria-modal="true" aria-label={`Live help for ${learnerName}`}>
    <header className="support-header">
      <div><h2>Live help: {learnerName}</h2>
        <p>{session.status === 'requested' ? 'Waiting for the learner to approve tab sharing and control…' : session.status === 'active' ? connected ? 'Connected to the learner’s real tab.' : 'Connecting to the learner’s tab…' : `Session ${session.status}.`}</p></div>
      <div className="support-header-actions">
        <button type="button" data-testid="support-toggle-chat" aria-expanded={chatVisible} onClick={() => setChatVisible(value => !value)}>{chatVisible ? 'Hide chat' : `Show chat (${messages.length})`}</button>
        <button type="button" data-testid="support-fullscreen" onClick={() => { void toggleFullscreen() }}>{fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</button>
        <button type="button" data-testid="admin-end-live-help" className="support-end" disabled={busy} onClick={() => { void end() }}>End session</button>
      </div>
    </header>
    {error && <p role="alert" className="support-error">{error}</p>}
    <div className="support-body">
      <SupportVideoView videoRef={videoRef} connected={connected} onControl={sendControl} />
      {chatVisible && <SupportChat id="admin-support-chat" peerName={learnerName} userId={session.adminId} messages={messages}
        disabled={session.status !== 'active' || busy} onSend={sendChat} />}
    </div>
    <details className="support-field-controls" data-testid="support-field-controls">
      <summary>Edit a field on the learner’s page</summary>
      <div className="support-field-controls-content">
        <label htmlFor="support-text">Replace the focused field:</label>
        <textarea id="support-text" rows={2} value={textValue} onChange={event => setTextValue(event.target.value)} maxLength={8000} disabled={!connected} />
        <button type="button" data-testid="admin-send-live-help-text" disabled={!connected} onClick={() => { void sendControl({ kind: 'text', value: textValue }) }}>Apply to field</button>
        <button type="button" disabled={!connected} onClick={() => { void sendControl({ kind: 'selectPrevious' }) }}>Dropdown ↑</button>
        <button type="button" disabled={!connected} onClick={() => { void sendControl({ kind: 'selectNext' }) }}>Dropdown ↓</button>
      </div>
      <p className="support-muted">Click a field in the shared tab before editing it. Passwords, secret codes, file inputs, and external links cannot be controlled remotely.</p>
    </details>
  </div>
}
