import { parseSupportControl, type SupportControl } from './supportProtocol'

const blockedTarget = (target: Element): boolean => {
  if (target.closest('[data-support-private], [data-support-ui]')) return true
  const input = target.closest('input, textarea, select')
  const label = target.closest('label[for]')
  if (label instanceof HTMLLabelElement && label.control && label.control !== target && blockedTarget(label.control)) return true
  if (input instanceof HTMLInputElement) {
    if (['password', 'file', 'hidden'].includes(input.type)) return true
  }
  if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
    const identity = `${input.name} ${input.id} ${input.placeholder}`.toLowerCase()
    if (/password|secret|token|credential|api.?key|recovery/.test(identity)) return true
  }
  if (input instanceof HTMLSelectElement && /password|secret|token|credential|api.?key|recovery/.test(`${input.name} ${input.id}`.toLowerCase())) return true
  const link = target.closest('a[href]')
  if (link instanceof HTMLAnchorElement && link.origin !== window.location.origin) return true
  return false
}

const targetAt = (x: number, y: number): Element | null =>
  document.elementFromPoint(x * window.innerWidth, y * window.innerHeight)

export const applySupportControl = (value: unknown): { x: number; y: number } | null => {
  const command: SupportControl = parseSupportControl(value)
  if (command.kind === 'selectNext' || command.kind === 'selectPrevious') {
    const target = document.activeElement
    if (!(target instanceof HTMLSelectElement) || blockedTarget(target)) {
      throw new Error('Focus a non-sensitive dropdown in the learner tab first.')
    }
    const change = command.kind === 'selectNext' ? 1 : -1
    const nextIndex = Math.max(0, Math.min(target.options.length - 1, target.selectedIndex + change))
    target.selectedIndex = nextIndex
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
    return null
  }
  if (command.kind === 'text') {
    const target = document.activeElement
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) || blockedTarget(target)) {
      throw new Error('Focus a non-sensitive text field in the learner tab before sending text.')
    }
    if (target.closest('.monaco-editor')) {
      window.dispatchEvent(new CustomEvent('codesense:support-editor-text', { detail: command.value }))
      return null
    }
    const prototype = target instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    if (!setter) throw new Error('Could not set the active text field during live help.')
    setter.call(target, command.value)
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
    return null
  }

  const target = targetAt(command.x, command.y)
  if (command.kind === 'pointer') return { x: command.x, y: command.y }
  if (!target) throw new Error('No control target exists at this cursor position.')
  if (blockedTarget(target)) throw new Error('This field or link cannot be controlled remotely.')

  if (command.kind === 'scroll') {
    const scrollTarget = target.closest('[data-support-scroll], .overflow-auto, .table-responsive')
    if (scrollTarget) scrollTarget.scrollBy({ top: command.deltaY, behavior: 'smooth' })
    else window.scrollBy({ top: command.deltaY, behavior: 'smooth' })
    return { x: command.x, y: command.y }
  }

  const clickable = target instanceof HTMLElement ? target : target.closest('button, a, label, [role="button"]')
  if (clickable instanceof HTMLElement && clickable.matches('input, textarea, select, button, [tabindex]')) {
    clickable.focus({ preventScroll: true })
  }
  const coordinates = { bubbles: true, cancelable: true, clientX: command.x * window.innerWidth, clientY: command.y * window.innerHeight }
  const pointer = { ...coordinates, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 }
  target.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons: 1 }))
  target.dispatchEvent(new MouseEvent('mousedown', { ...coordinates, button: 0, buttons: 1 }))
  target.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0 }))
  target.dispatchEvent(new MouseEvent('mouseup', { ...coordinates, button: 0, buttons: 0 }))
  if (clickable instanceof HTMLElement) clickable.click()
  else target.dispatchEvent(new MouseEvent('click', coordinates))
  return { x: command.x, y: command.y }
}
