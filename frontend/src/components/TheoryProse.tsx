import React from 'react'
import { parseTheoryText } from '@/campaign/theoryText'

const inlineText = (text: string): React.ReactNode => text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, index) => {
  if (part.startsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
  if (part.startsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
  return part
})

export const TheoryProse: React.FC<{ text: string }> = ({ text }) => (
  <div className="theory-prose">
    {parseTheoryText(text).map((block, index) => {
      if (block.type === 'list') {
        const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{inlineText(item)}</li>)
        return block.start === null ? <ul key={index}>{items}</ul> : <ol key={index} start={block.start}>{items}</ol>
      }
      if (block.type === 'heading') return <h4 key={index}>{inlineText(block.text)}</h4>
      if (block.type === 'code') return <pre key={index}><code>{block.text}</code></pre>
      return <p key={index}>{inlineText(block.text)}</p>
    })}
  </div>
)
