// ═════════════════════════════════════════════════════════════════════
// <Overlay> — the lightweight backdrop primitive.
//
// Use this for modals that need custom chrome and can't fit the shared
// <Modal> component's header/footer/body API (photo lightboxes, custom
// pickers, edit dialogs with unique layouts). You get:
//
//   • Portal to document.body — escapes parent stacking contexts
//   • Scroll-lock on the page behind while open
//   • Esc-to-close (unless `dismissable={false}`)
//   • Backdrop-click closes (unless `dismissable={false}`)
//   • Natural-height pattern — outer backdrop scrolls, inner card
//     stays centered. Header and footer never clip on tall forms /
//     short viewports.
//   • 100dvh fallback — iOS Safari URL bar doesn't crop content
//   • Mobile full-bleed by default, tablet+ centered
//
// Why this exists: ~15 inline `fixed inset-0 z-[N] flex items-center…`
// patterns across the app each had subtle bugs (z-index chaos, parent
// transform traps, tall-form clipping). Centralizing the backdrop so
// fixes land everywhere at once.
// ═════════════════════════════════════════════════════════════════════

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface OverlayProps {
  open: boolean;
  onClose: () => void;
  /** When true, backdrop click + Esc are ignored (forces explicit action). */
  dismissable?: boolean;
  /** Stacking z-index. Defaults to 200. Bump for nested overlays. */
  zIndex?: number;
  /** Alignment on desktop. Mobile always top-aligns so headers stay visible. */
  align?: 'center' | 'start';
  /** Padding around the card on tablet+. Default "p-4". */
  padding?: string;
  /** Backdrop color+blur utility classes. */
  backdrop?: string;
  /** ARIA label for screen readers — defaults to "Dialog". */
  ariaLabel?: string;
  className?: string;
  children: React.ReactNode;
}

export const Overlay: React.FC<OverlayProps> = ({
  open,
  onClose,
  dismissable = true,
  zIndex = 200,
  align = 'center',
  padding = 'p-4',
  backdrop = 'bg-zinc-950',
  ariaLabel = 'Dialog',
  className = '',
  children,
}) => {
  const backdropRef = useRef<HTMLDivElement>(null);

  // Esc to close — only attached while open.
  useEffect(() => {
    if (!open || !dismissable) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, dismissable, onClose]);

  // Lock page scroll while open so background doesn't move on iOS.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const onBackdropClick = (e: React.MouseEvent) => {
    if (!dismissable) return;
    if (e.target === backdropRef.current) onClose();
  };

  if (!open) return null;

  // Mobile always top-aligns to keep sticky headers visible on short screens;
  // tablet+ respects the caller's chosen alignment.
  const alignClass = align === 'center' ? 'sm:items-center' : 'sm:items-start';

  return createPortal(
    <div
      ref={backdropRef}
      onClick={onBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      className={`fixed inset-0 overflow-y-auto animate-fade-in ${backdrop} ${className}`}
      style={{ zIndex }}
    >
      <div className={`min-h-full flex items-start ${alignClass} justify-center ${padding}`}>
        {children}
      </div>
    </div>,
    document.body,
  );
};
