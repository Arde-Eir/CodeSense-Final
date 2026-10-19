import type { CSSProperties, ReactElement, ReactNode } from 'react'

export function AdminRecordCell({ label, children, className, style }: {
  label: string
  children: ReactNode
  className?: string
  style?: CSSProperties
}): ReactElement {
  return (
    <td role="cell" data-label={label} className={className} style={style}>
      <span className="admin-record-label" aria-hidden="true">{label}</span>
      <div className="admin-record-value">{children}</div>
    </td>
  )
}
