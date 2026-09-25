import React, { useEffect, useRef, useState } from 'react'
import { endSupportSession, getSupportSession, recordSupportClick, recordSupportSelection, recordSupportText, type SupportSession } from '@/services/liveSupport'
import { connectSupportViewer, type SupportViewer } from '@/services/supportConnection'
import type { SupportControl } from '@/services/supportProtocol'

interface Props {
  session: SupportSession
  learnerName: string
  onClose: () => void
}

const videoPosition = (video: HTMLVideoElement, clientX: number, clientY: number): { x: number; y: number } | null => {
  const bounds = video.getBoundingClientRect()
  if (video.videoWidth === 0 || video.videoHeight === 0 || bounds.width === 0 || bounds.height === 0) return null
  const scale = Math.min(bounds.width / video.videoWidth, bounds.height / video.videoHeight)
  const width = video.videoWidth * scale
  const height = video.videoHeight * scale
  const left = bounds.left + (bounds.width - width) / 2
  const top = bounds.top + (bounds.height - height) / 2
  const x = (clientX - left) / width
  const y = (clientY - top) / height
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null
}

export const AdminLiveSupport: React.FC<Props> = ({ session: initialSession, learnerName, onClose }) => {
  const [session, setSession] = useState(initialSession)
  const [error, setError] = useState<string | null>(null)
  const [textValue, setTextValue] = useState('')
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const connectionRef = useRef<SupportViewer | null>(null)
  const lastPointerRef = useRef(0)
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

  const sendControl = async (control: SupportControl): Promise<void> => {
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
  }

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

  return <div role="dialog" aria-modal="true" aria-label={`Live help for ${learnerName}`} style={{
    position: 'fixed', inset: 0, zIndex: 20000, background: '#000c', display: 'grid', placeItems: 'center', padding: 16,
  }}>
    <div style={{ width: 'min(100%, 1200px)', maxHeight: '95vh', overflow: 'auto', background: '#111827', color: '#fff', borderRadius: 12, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <div><h2 style={{ margin: 0 }}>Live help: {learnerName}</h2>
          <p style={{ margin: '6px 0' }}>{session.status === 'requested' ? 'Waiting for the learner to approve tab sharing and control…' : session.status === 'active' ? connected ? 'Connected to the learner’s real tab.' : 'Connecting to the learner’s tab…' : `Session ${session.status}.`}</p></div>
        <button type="button" data-testid="admin-end-live-help" className="btn btn-danger" disabled={busy} onClick={() => { void end() }}>End session</button>
      </div>
      {error && <p role="alert" style={{ color: '#fca5a5' }}>{error}</p>}
      <video ref={videoRef} data-testid="admin-live-help-video" autoPlay playsInline muted aria-label="Learner shared tab" onClick={event => {
        const position = videoPosition(event.currentTarget, event.clientX, event.clientY)
        if (position) void sendControl({ kind: 'click', ...position })
      }} onMouseMove={event => {
        if (Date.now() - lastPointerRef.current < 150) return
        lastPointerRef.current = Date.now()
        const position = videoPosition(event.currentTarget, event.clientX, event.clientY)
        if (position && connected) void sendControl({ kind: 'pointer', ...position })
      }} onWheel={event => {
        event.preventDefault()
        const position = videoPosition(event.currentTarget, event.clientX, event.clientY)
        if (position) void sendControl({ kind: 'scroll', ...position, deltaY: event.deltaY })
      }} style={{ width: '100%', height: 'min(68vh, 700px)', objectFit: 'contain', background: '#05080e', cursor: connected ? 'crosshair' : 'default' }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 12 }}>
        <label htmlFor="support-text">Replace the focused text field:</label>
        <textarea id="support-text" className="form-control" style={{ maxWidth: 500 }} rows={2} value={textValue} onChange={event => setTextValue(event.target.value)} maxLength={8000} disabled={!connected} />
        <button type="button" data-testid="admin-send-live-help-text" className="btn btn-primary" disabled={!connected} onClick={() => { void sendControl({ kind: 'text', value: textValue }) }}>Send text</button>
        <button type="button" className="btn btn-secondary" disabled={!connected} onClick={() => { void sendControl({ kind: 'selectPrevious' }) }}>Dropdown ↑</button>
        <button type="button" className="btn btn-secondary" disabled={!connected} onClick={() => { void sendControl({ kind: 'selectNext' }) }}>Dropdown ↓</button>
      </div>
      <p style={{ color: '#9ca3af', margin: '8px 0 0' }}>Click and scroll on the shared tab, then use the text or dropdown controls for focused fields. The learner sees your cursor and can stop at any time. Passwords, secret codes, file inputs, and external links cannot be controlled remotely.</p>
    </div>
  </div>
}
