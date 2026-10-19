import { useEffect, useRef, type ButtonHTMLAttributes, type CSSProperties, type PointerEvent, type ReactElement } from 'react'
import './MagneticButton.css'

interface MagneticButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  faceClassName?: string
  faceStyle?: CSSProperties
}

/** Animate the visual face while keeping native focus, activation, and hit bounds steady. */
export function MagneticButton({ children, className, faceClassName, faceStyle, disabled, type,
  onPointerMove, onPointerLeave, onPointerCancel, onPointerDown, onFocus, onBlur, ...props
}: MagneticButtonProps): ReactElement {
  const faceRef = useRef<HTMLSpanElement>(null)

  const resetMotion = (): void => {
    const face = faceRef.current
    if (!face) return
    face.style.removeProperty('--magnetic-x')
    face.style.removeProperty('--magnetic-y')
    face.style.removeProperty('--magnetic-rx')
    face.style.removeProperty('--magnetic-ry')
  }

  useEffect(() => { if (disabled) resetMotion() }, [disabled])

  const move = (event: PointerEvent<HTMLButtonElement>): void => {
    onPointerMove?.(event)
    const button = event.currentTarget
    if (event.defaultPrevented || button.disabled || event.pointerType !== 'mouse' || event.buttons !== 0
      || button.matches(':focus-visible') || getComputedStyle(button).getPropertyValue('--magnetic-enabled').trim() !== '1') {
      resetMotion()
      return
    }
    const bounds = button.getBoundingClientRect()
    const x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width - 0.5) * 2))
    const y = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height - 0.5) * 2))
    const face = faceRef.current
    if (!face) return
    face.style.setProperty('--magnetic-x', `${x * 6}px`)
    face.style.setProperty('--magnetic-y', `${y * 4}px`)
    face.style.setProperty('--magnetic-rx', `${-y * 4}deg`)
    face.style.setProperty('--magnetic-ry', `${x * 4}deg`)
  }

  return <button {...props} type={type ?? 'button'} disabled={disabled}
    className={`magnetic-button ${className ?? ''}`} onPointerMove={move}
    onPointerLeave={event => { resetMotion(); onPointerLeave?.(event) }}
    onPointerCancel={event => { resetMotion(); onPointerCancel?.(event) }}
    onPointerDown={event => { resetMotion(); onPointerDown?.(event) }}
    onFocus={event => { resetMotion(); onFocus?.(event) }}
    onBlur={event => { resetMotion(); onBlur?.(event) }}>
    <span ref={faceRef} className={`magnetic-button-face ${faceClassName ?? ''}`} style={faceStyle}>{children}</span>
  </button>
}
