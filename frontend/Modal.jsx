import React from 'react';
import { createPortal } from 'react-dom';

const stack = [];
let previousOverflow;
function syncLayers() {
  const top = stack.at(-1);
  for (const item of stack) if (item.overlay.current) item.overlay.current.inert = item !== top;
  const root = document.getElementById('root');
  if (root) root.inert = Boolean(top);
  if (top && previousOverflow === undefined) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
  if (!top && previousOverflow !== undefined) { document.body.style.overflow = previousOverflow; previousOverflow = undefined; }
}

export default function Modal({ title, onClose, children, variant = 'modal', returnFocus }) {
  const ref = React.useRef(null);
  const overlay = React.useRef(null);
  const titleId = React.useId();
  const close = React.useRef(onClose);
  close.current = onClose;
  const restore = React.useRef(returnFocus); restore.current = returnFocus;
  React.useEffect(() => {
    const previous = document.activeElement;
    const instance = { overlay, ref }; stack.push(instance); syncLayers();
    const focusable = () => [...ref.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex="0"]')].filter(element => element.getClientRects().length && !element.closest('[hidden], [inert]'));
    (ref.current.querySelector('input[type="search"], input[required]') || focusable()[0] || ref.current).focus({ preventScroll: true });
    function handleKey(event) {
      if (stack.at(-1) !== instance) return;
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      stack.splice(stack.indexOf(instance), 1); syncLayers();
      const target = restore.current?.() || previous;
      if (target?.isConnected && target.getClientRects().length && !target.closest('[inert]')) target.focus?.({ preventScroll: true });
      else (stack.at(-1)?.ref.current || document.querySelector('[data-center-person-id]'))?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<div className={`modal-overlay${variant !== 'modal' ? ' drawer-overlay' : ''}`} ref={overlay} onMouseDown={event => { if (event.target === event.currentTarget) close.current(); }}>
    <section className={`archive-modal${variant !== 'modal' ? ' workspace-drawer' : ''}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <div className="toolbar"><h2 id={titleId}>{title}</h2><button onClick={onClose} aria-label={`Close ${title}`}>Close</button></div>
      {children}
    </section>
  </div>, document.body);
}
