import { useEffect, useRef, useState, type RefObject } from 'react'
import type { SupportControl } from '@/services/supportProtocol'
import './LiveSupport.css'

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>
  connected: boolean
  onControl: (command: SupportControl) => Promise<void>
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

export const SupportVideoView = ({ videoRef, connected, onControl }: Props) => {
  const [zoom, setZoom] = useState(1)
  const lastPointerRef = useRef(0)
  const pointerPendingRef = useRef(false)
  const positionRef = useRef({ x: 0.5, y: 0.5 })

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let pending: Extract<SupportControl, { kind: 'scroll' }> | null = null
    let timer: number | null = null
    let sending = false
    let disposed = false
    const flush = async (): Promise<void> => {
      timer = null
      if (!pending || disposed) return
      const command = pending
      pending = null
      sending = true
      try { await onControl(command) }
      finally {
        sending = false
        if (pending && !disposed) timer = window.setTimeout(() => { void flush() }, 100)
      }
    }
    const wheel = (event: WheelEvent): void => {
      // React's delegated wheel handler is passive; cancel local scrolling here.
      event.preventDefault()
      if (!connected || event.ctrlKey) return
      const position = videoPosition(video, event.clientX, event.clientY)
      if (!position) return
      positionRef.current = position
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? video.videoHeight : 1
      const deltaY = Math.max(-1200, Math.min(1200, (pending?.deltaY ?? 0) + event.deltaY * unit))
      pending = { kind: 'scroll', ...position, deltaY }
      if (timer === null && !sending) timer = window.setTimeout(() => { void flush() }, 100)
    }
    video.addEventListener('wheel', wheel, { passive: false })
    return () => {
      disposed = true
      video.removeEventListener('wheel', wheel)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [videoRef, connected, onControl])

  return <section className="support-viewer">
    <div className="support-viewer-toolbar">
      <label htmlFor="support-video-zoom">View size</label>
      <select id="support-video-zoom" data-testid="support-video-zoom" value={zoom} onChange={event => setZoom(Number(event.target.value))}>
        <option value={1}>Fit</option><option value={1.25}>125%</option><option value={1.5}>150%</option><option value={2}>200%</option>
      </select>
      <button type="button" data-testid="support-scroll-up" disabled={!connected} onClick={() => { void onControl({ kind: 'scroll', ...positionRef.current, deltaY: -400 }) }}>Scroll learner ↑</button>
      <button type="button" data-testid="support-scroll-down" disabled={!connected} onClick={() => { void onControl({ kind: 'scroll', ...positionRef.current, deltaY: 400 }) }}>Scroll learner ↓</button>
    </div>
    <div className="support-video-viewport" data-testid="support-video-viewport" tabIndex={0} aria-label="Shared tab viewer; use scrollbars to pan when zoomed">
      <div className="support-video-stage" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
        <video ref={videoRef} data-testid="admin-live-help-video" autoPlay playsInline muted disablePictureInPicture aria-label="Learner shared tab"
          onClick={event => {
            const position = videoPosition(event.currentTarget, event.clientX, event.clientY)
            if (position && connected) void onControl({ kind: 'click', ...position })
          }} onMouseMove={event => {
            const position = videoPosition(event.currentTarget, event.clientX, event.clientY)
            if (!position) return
            positionRef.current = position
            if (!connected || pointerPendingRef.current || Date.now() - lastPointerRef.current < 150) return
            lastPointerRef.current = Date.now()
            pointerPendingRef.current = true
            void onControl({ kind: 'pointer', ...position }).finally(() => { pointerPendingRef.current = false })
          }} style={{ cursor: connected ? 'crosshair' : 'default' }} />
      </div>
    </div>
    <small className="support-muted">Wheel over the video to scroll the learner’s page. When zoomed, use the viewer’s scrollbars to move around.</small>
  </section>
}
