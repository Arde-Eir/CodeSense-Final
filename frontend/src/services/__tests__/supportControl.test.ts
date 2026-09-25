import { afterEach, describe, expect, it } from 'vitest'
import { applySupportControl } from '@/services/supportControl'

afterEach(() => {
  document.body.replaceChildren()
})

describe('learner-approved live control', () => {
  it('updates a focused account field and dispatches the events used by forms', () => {
    const input = document.createElement('input')
    input.setAttribute('data-testid', 'account-field')
    document.body.append(input)
    let inputEvents = 0
    let changeEvents = 0
    input.addEventListener('input', () => { inputEvents += 1 })
    input.addEventListener('change', () => { changeEvents += 1 })
    input.focus()

    applySupportControl({ kind: 'text', value: 'Updated learner name' })

    expect(input.value).toBe('Updated learner name')
    expect(inputEvents).toBe(1)
    expect(changeEvents).toBe(1)
  })

  it('refuses remote changes to a password field', () => {
    const input = document.createElement('input')
    input.type = 'password'
    input.setAttribute('data-testid', 'password-field')
    document.body.append(input)
    input.focus()

    expect(() => applySupportControl({ kind: 'text', value: 'not allowed' })).toThrow('non-sensitive text field')
    expect(input.value).toBe('')
  })

  it('changes a focused account dropdown', () => {
    const select = document.createElement('select')
    select.setAttribute('data-testid', 'account-dropdown')
    select.append(new Option('Student', 'student'), new Option('Professional', 'professional'))
    document.body.append(select)
    select.focus()

    applySupportControl({ kind: 'selectNext' })

    expect(select.value).toBe('professional')
  })
})
