import { useEffect, useId, useRef, useState, type FC } from 'react';
import { Link } from 'react-router-dom';
import type { Phase, Quest } from '@/types/campaign';
import './LessonNavigation.css';

export const LessonNavigation: FC<{
  phase: Phase;
  previousQuest: Pick<Quest, 'id' | 'title'> | null;
  savingProgress: boolean;
}> = ({ phase, previousQuest, savingProgress }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const menuId = useId();
  const isOpen = open && !savingProgress;

  useEffect(() => {
    if (!isOpen) return;
    firstLinkRef.current?.focus();
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [isOpen]);

  const close = (): void => setOpen(false);

  return (
    <div ref={containerRef} className="la-navigation"
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}
      onKeyDown={event => {
        if (event.key === 'Escape' && isOpen) {
          event.preventDefault();
          close();
          buttonRef.current?.focus();
        }
      }}>
      <button ref={buttonRef} type="button" data-testid="campaign-navigation-toggle"
        className="la-navigation-toggle" title="Campaign navigation" aria-label="Campaign navigation"
        aria-expanded={isOpen} aria-controls={menuId} disabled={savingProgress}
        onClick={() => setOpen(previous => !previous)}>←</button>
      {isOpen && (
        <nav id={menuId} className="la-navigation-panel" aria-label="Campaign destinations" data-testid="campaign-navigation-panel">
          <div className="la-navigation-heading">Go to</div>
          <Link ref={firstLinkRef} to={`/campaign/inside/${phase}`} onClick={close} data-testid="navigate-level-dashboard">
            <span aria-hidden="true">▦</span> Level dashboard
          </Link>
          <Link to="/campaign" onClick={close} data-testid="navigate-campaign-overview">
            <span aria-hidden="true">🗺️</span> All campaign levels
          </Link>
          <Link to="/home" onClick={close} data-testid="navigate-home">
            <span aria-hidden="true">⌂</span> Home
          </Link>
          {previousQuest ? (
            <Link to={`/lesson/${previousQuest.id}`} onClick={close} className="la-navigation-previous" data-testid="navigate-previous-quest">
              <span aria-hidden="true">↶</span>
              <span>Previous quest<small>{previousQuest.title}</small></span>
            </Link>
          ) : (
            <div className="la-navigation-previous la-navigation-unavailable" aria-disabled="true" data-testid="previous-quest-unavailable">
              <span aria-hidden="true">↶</span>
              <span>Previous quest<small>You're at the first quest</small></span>
            </div>
          )}
        </nav>
      )}
    </div>
  );
};
