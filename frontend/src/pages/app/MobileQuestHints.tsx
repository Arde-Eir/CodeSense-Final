import { useEffect, useId, useRef, type FC, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import './MobileQuestHints.css';

export const MobileQuestHints: FC<{
  children: ReactNode;
  backgroundRef: RefObject<HTMLDivElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}> = ({ children, backgroundRef, triggerRef, onClose }) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();

  useEffect(() => {
    const background = backgroundRef.current;
    const trigger = triggerRef.current;
    const previousInert = background?.inert;
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    if (background) background.inert = true;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    closeRef.current?.focus();
    const closeOnDesktop = (): void => { if (window.innerWidth > 1024) onClose(); };
    window.addEventListener('resize', closeOnDesktop);
    return () => {
      window.removeEventListener('resize', closeOnDesktop);
      if (background) background.inert = previousInert === true;
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [backgroundRef, triggerRef, onClose]);

  return createPortal(
    <div className="quest-hints-overlay" data-testid="mobile-hints-overlay">
      <button className="quest-hints-backdrop" type="button" tabIndex={-1} aria-label="Close quest help" data-testid="mobile-hints-backdrop" onClick={onClose} />
      <section ref={panelRef} id="campaign-hints-panel" className="quest-hints-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}
        data-testid="mobile-hints-dialog" onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
          if (event.key !== 'Tab') return;
          const controls = panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]');
          if (!controls?.length) return;
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}>
        <header className="quest-hints-heading">
          <h2 id={titleId}>Hints &amp; objectives</h2>
          <button ref={closeRef} type="button" data-testid="mobile-hints-close" onClick={onClose}>Close ✕</button>
        </header>
        <div className="quest-hints-content">{children}</div>
      </section>
    </div>, document.body,
  );
};
