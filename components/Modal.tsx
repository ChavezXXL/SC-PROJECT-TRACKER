// ═════════════════════════════════════════════════════════════════════
// Shared Modal primitive.
//
// One component every modal in the app should use. Guarantees:
//   • Header is always visible — sticky at top, never clipped on tall forms
//   • Footer is always reachable — sticky at bottom, actions never hide
//   • Backdrop click closes (unless `dismissable={false}`)
//   • Esc key closes
//   • Mobile: full-screen (no side margins, rounded top only)
//   • Desktop: centered, max-width, rounded, 4px top/bottom margin
//   • Content scrolls naturally inside the modal, viewport never jumps
//   • Backdrop scroll-locked so the page behind doesn't move
//
// Why this exists: the codebase had ~15 modals each with their own
// variant of `fixed inset-0 flex items-center` + `max-h-[...]` combos.
// Many had the "header clipped on tall forms" bug. This centralizes the
// pattern so fixes land everywhere at once.
// ═════════════════════════════════════════════════════════════════════

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Text in the header. Optional — pass a custom `header` prop for complex layouts. */
  title?: React.ReactNode;
  /** Subtitle beneath the title (truncated to one line on mobile). */
  subtitle?: React.ReactNode;
  /** Replace the entire header. When provided, `title` / `subtitle` are ignored. */
  header?: React.ReactNode;
  /** Footer node — stays sticky at the bottom. Usually action buttons. */
  footer?: React.ReactNode;
  /** Icon shown before the title. */
  icon?: React.ReactNode;
  /** Tailwind max-width class for the modal card. Default "max-w-2xl". */
  maxWidth?: string;
  /** When true, clicking the backdrop does NOT close the modal. */
  dismissable?: boolean;
  /** Extra class on the modal card. */
  className?: string;
  children: React.ReactNode;
  /** Stacking z-index. Default 200. Bump if nesting modals. */
  zIndex?: number;
}

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  subtitle,
  header,
  footer,
  icon,
  maxWidth = 'sm:max-w-2xl',
  dismissable = true,
  className = '',
  children,
  zIndex = 200,
}) => {
  // Esc to close — only attach while open so multiple modals don't fight
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose, dismissable]);

  // Lock body scroll while open — otherwise the background page scrolls
  // behind the modal on some mobile browsers.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const backdropRef = useRef<HTMLDivElement>(null);
  const onBackdropClick = (e: React.MouseEvent) => {
    if (!dismissable) return;
    // Only close when the actual backdrop was clicked, not something inside.
    if (e.target === backdropRef.current) onClose();
  };

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      onClick={onBackdropClick}
      className="fixed inset-0 overflow-y-auto bg-zinc-950/95 backdrop-blur-sm animate-fade-in"
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
    >
      {/* Flex wrapper centers on desktop, top-aligns on mobile so the header
          never scrolls off-screen on tall forms. */}
      <div className="min-h-full flex items-start justify-center p-0 sm:p-4">
        <div
          className={`relative w-full ${maxWidth} bg-zinc-900 border border-white/10 rounded-none sm:rounded-2xl shadow-2xl my-0 sm:my-4 ${className}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header — sticks to top of viewport as body scrolls */}
          {(header || title) && (
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3 sticky top-0 bg-zinc-900/95 backdrop-blur z-10 rounded-t-none sm:rounded-t-2xl">
              {header || (
                <div className="flex items-center gap-2 min-w-0">
                  {icon && <span className="shrink-0">{icon}</span>}
                  <div className="min-w-0">
                    <h2 className="text-sm sm:text-base font-black text-white truncate">{title}</h2>
                    {subtitle && <p className="text-[11px] text-zinc-500 truncate">{subtitle}</p>}
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 shrink-0"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Body — natural flow, no max-height, outer container handles scroll */}
          <div className="p-4 space-y-4">
            {children}
          </div>

          {/* Footer — sticks to bottom of viewport for always-reachable actions */}
          {footer && (
            <div className="px-4 py-3 border-t border-white/10 bg-zinc-950/95 backdrop-blur sticky bottom-0 rounded-b-none sm:rounded-b-2xl z-10 flex items-center gap-2">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
