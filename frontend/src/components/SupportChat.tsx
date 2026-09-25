import { useEffect, useRef, useState } from 'react'
import { SUPPORT_CHAT_MAX_LENGTH, type SupportChatMessage } from '@/services/supportProtocol'
import './LiveSupport.css'

interface Props {
  id: string
  peerName: string
  userId: string
  messages: SupportChatMessage[]
  disabled: boolean
  onSend: (text: string) => Promise<void>
}

export const SupportChat = ({ id, peerName, userId, messages, disabled, onSend }: Props) => {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [messages])

  const send = async (): Promise<void> => {
    if (sending || disabled || !draft.trim()) return
    setSending(true)
    setError(null)
    try {
      await onSend(draft)
      setDraft('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSending(false)
    }
  }

  return <section className="support-chat" data-support-ui aria-label={`Chat with ${peerName}`} data-testid={id}>
    <h3>Chat with {peerName}</h3>
    <div className="support-chat-log" ref={logRef} role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions" data-testid={`${id}-messages`}>
      {messages.length === 0 && <p className="support-muted">Send a message here to talk during live help.</p>}
      {messages.map(message => <div className="support-chat-message" data-sender={message.senderId === userId ? 'self' : 'peer'} key={message.id}>
        <strong>{message.senderId === userId ? 'You' : peerName}</strong>
        <p>{message.text}</p>
      </div>)}
    </div>
    <form onSubmit={event => { event.preventDefault(); void send() }}>
      <label htmlFor={`${id}-input`}>Message</label>
      <textarea id={`${id}-input`} data-testid={`${id}-input`} rows={2} maxLength={SUPPORT_CHAT_MAX_LENGTH}
        value={draft} onChange={event => setDraft(event.target.value)} disabled={disabled || sending} placeholder={`Message ${peerName}…`} />
      {error && <p className="support-error" role="alert">{error}</p>}
      <button type="submit" data-testid={`${id}-send`} disabled={disabled || sending || !draft.trim()}>{sending ? 'Sending…' : 'Send message'}</button>
    </form>
    <small className="support-muted">Chat clears when this session closes.</small>
  </section>
}
