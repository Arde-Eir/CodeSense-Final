import { useEffect, useRef, type FC, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/** Keep the page inert only while the expanded welcome guide is open. */
export const OnboardingDialog: FC<{
  children: ReactNode
  backgroundRef: RefObject<HTMLDivElement | null>
  onPause: () => void
  stepIndex: number
}> = ({ children, backgroundRef, onPause, stepIndex }) => {
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const background = backgroundRef.current
    const previousInert = background?.inert
    const previousBodyOverflow = document.body.style.overflow
    const previousRootOverflow = document.documentElement.style.overflow
    const trigger = document.activeElement
    if (background) background.inert = true
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    dialogRef.current?.focus()
    return () => {
      if (background) background.inert = previousInert === true
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousRootOverflow
      if (trigger instanceof HTMLElement && trigger.isConnected && !trigger.closest('[inert]')) trigger.focus()
    }
  }, [backgroundRef])

  useEffect(() => { dialogRef.current?.focus() }, [stepIndex])

  return createPortal(
    <div className="cs-tour-overlay" data-testid="welcome-tour-backdrop">
      <section ref={dialogRef} className="cs-tour-card" role="dialog" aria-modal="true"
        aria-labelledby="codesense-tour-title" tabIndex={-1} data-testid="welcome-tour-dialog"
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onPause()
          }
          if (event.key !== 'Tab') return
          const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], select:not([disabled]), [tabindex="0"]')
          if (!controls?.length) return
          const first = controls[0]
          const last = controls[controls.length - 1]
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
            event.preventDefault()
            last.focus()
          }
          if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
            event.preventDefault()
            first.focus()
          }
        }}>
        {children}
      </section>
    </div>, document.body,
  )
}
