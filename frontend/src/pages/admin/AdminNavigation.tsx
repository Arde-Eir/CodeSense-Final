import { useEffect, useId, useRef, useState, type FC } from 'react'
import { Link } from 'react-router-dom'
import type { Tab } from '@/admin/adminPanelModel'

export interface AdminNavigationItem {
  id: Tab
  icon: string
  label: string
}

export const AdminNavigation: FC<{
  items: readonly AdminNavigationItem[]
  selectedTab: Tab
  onSelectTab: (tab: Tab) => void
}> = ({ items, selectedTab, onSelectTab }) => {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const navId = useId()

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  return (
    <aside ref={containerRef} className="admin-navigation" data-open={open} data-testid="admin-navigation"
      onKeyDown={event => {
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          setOpen(false)
          toggleRef.current?.focus()
        }
      }}>
      <div className="admin-navigation-top">
        <div className="admin-brand"><span aria-hidden="true">🧠</span> CodeSense Admin</div>
        <button ref={toggleRef} type="button" className="admin-menu-toggle" data-testid="admin-menu-toggle"
          aria-expanded={open} aria-controls={navId} onClick={() => setOpen(value => !value)}>
          {open ? '✕ Close' : '☰ Menu'}
        </button>
      </div>
      <nav id={navId} className="admin-navigation-links" aria-label="Admin sections">
        <div className="admin-navigation-items">
          {items.map(item => (
            <button key={item.id} type="button" className="admin-nav-item" data-testid={`admin-nav-${item.id}`}
              aria-current={selectedTab === item.id ? 'page' : undefined}
              onClick={() => { onSelectTab(item.id); setOpen(false); toggleRef.current?.focus() }}>
              <i className={item.icon} aria-hidden="true" />{item.label}
            </button>
          ))}
        </div>
        <Link className="admin-return-link" to="/home" data-testid="admin-return-home">← Back to App</Link>
      </nav>
    </aside>
  )
}
