// ═════════════════════════════════════════════════════════════════════
// useConfirm — promise-based confirmation dialog hook.
//
// Replaces native `confirm()` browser prompts (which look amateur and
// can get hidden behind modals) with a real, styled, portaled dialog.
//
// Usage:
//   const { confirm, ConfirmHost } = useConfirm();
//
//   const handleDelete = async () => {
//     if (!await confirm({ title: 'Delete this?', message: '…', tone: 'danger' })) return;
//     await DB.deleteThing(id);
//   };
//
//   return <>{...your UI...}{ConfirmHost}</>;
//
// The dialog:
//   • Portals to document.body (escapes any parent stacking context)
//   • Sits at z-[400] so it stacks ABOVE every modal in the app
//   • Esc cancels, Enter confirms (focuses the destructive button by default)
//   • Backdrop click cancels
// ═════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Destructive UI (red button + warning icon). Default true. */
  tone?: 'danger' | 'info' | 'warning';
  confirmLabel?: string;  // default "Confirm"
  cancelLabel?: string;   // default "Cancel"
}

interface PendingState {
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

export function useConfirm() {
  const [pending, setPending] = useState<PendingState | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setPending({ options, resolve });
    });
  }, []);

  const close = useCallback((ok: boolean) => {
    if (!pending) return;
    pending.resolve(ok);
    setPending(null);
  }, [pending]);

  // Esc / Enter shortcuts
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      else if (e.key === 'Enter') { e.preventDefault(); close(true); }
    };
    window.addEventListener('keydown', onKey);
    // Lock page scroll
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Auto-focus the destructive button so Enter confirms
    setTimeout(() => confirmBtnRef.current?.focus(), 50);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [pending, close]);

  const ConfirmHost: React.ReactNode = pending
    ? createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          className="fixed inset-0 z-[400] overflow-y-auto bg-zinc-950/90 backdrop-blur-md animate-fade-in"
          onClick={() => close(false)}
        >
          <div className="min-h-full flex items-center justify-center p-4">
            <div
              className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-2xl p-5 sm:p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3 mb-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                  pending.options.tone === 'info'
                    ? 'bg-blue-500/15 border-blue-500/30'
                    : pending.options.tone === 'warning'
                    ? 'bg-amber-500/15 border-amber-500/30'
                    : 'bg-red-500/15 border-red-500/30'
                }`}>
                  <AlertTriangle className={`w-4 h-4 ${
                    pending.options.tone === 'info' ? 'text-blue-400'
                    : pending.options.tone === 'warning' ? 'text-amber-400'
                    : 'text-red-400'
                  }`} aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 id="confirm-title" className="text-base font-bold text-white leading-snug">
                    {pending.options.title}
                  </h3>
                  {pending.options.message && (
                    <p className="text-sm text-zinc-400 mt-1 leading-relaxed">{pending.options.message}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => close(false)}
                  aria-label="Close"
                  className="text-zinc-500 hover:text-white p-1 rounded -mt-1 -mr-1"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => close(false)}
                  className="text-zinc-400 hover:text-white text-sm font-semibold px-3 sm:px-4 py-2"
                >
                  {pending.options.cancelLabel || 'Cancel'}
                </button>
                <button
                  ref={confirmBtnRef}
                  type="button"
                  onClick={() => close(true)}
                  className={`text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg ${
                    pending.options.tone === 'info'
                      ? 'bg-blue-600 hover:bg-blue-500 shadow-blue-900/20'
                      : pending.options.tone === 'warning'
                      ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-900/20'
                      : 'bg-red-600 hover:bg-red-500 shadow-red-900/20'
                  }`}
                >
                  {pending.options.confirmLabel || 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return { confirm, ConfirmHost };
}
