// ═════════════════════════════════════════════════════════════════════
// usePrompt — promise-based text-input dialog hook.
//
// Drop-in replacement for the native `prompt()` browser dialog (which is
// blocked in iframes, looks ugly, and has no styling). Same shape as
// useConfirm so wiring it into a component is symmetric.
//
// Usage:
//   const { prompt, PromptHost } = usePrompt();
//
//   const onClick = async () => {
//     const name = await prompt({ title: 'Name this view', placeholder: 'My filter' });
//     if (!name) return;
//     saveView(name);
//   };
//
//   return <>{...UI...}{PromptHost}</>;
//
// Resolves to the typed string (trimmed). Resolves to null on cancel.
// Empty/whitespace-only input is treated as cancel — saves the caller a
// `if (!s.trim()) return;` line.
// ═════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export interface PromptOptions {
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string; // default "Save"
  cancelLabel?: string;  // default "Cancel"
  /** Optional validation — return error string to display, or null to allow. */
  validate?: (value: string) => string | null;
}

interface PendingState {
  options: PromptOptions;
  resolve: (value: string | null) => void;
}

export function usePrompt() {
  const [pending, setPending] = useState<PendingState | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const prompt = useCallback((options: PromptOptions): Promise<string | null> => {
    return new Promise<string | null>((resolve) => {
      setValue(options.defaultValue || '');
      setError(null);
      setPending({ options, resolve });
    });
  }, []);

  const close = useCallback((submitted: string | null) => {
    if (!pending) return;
    pending.resolve(submitted);
    setPending(null);
    setValue('');
    setError(null);
  }, [pending]);

  const submit = useCallback(() => {
    if (!pending) return;
    const trimmed = value.trim();
    if (!trimmed) { close(null); return; } // empty == cancel
    if (pending.options.validate) {
      const err = pending.options.validate(trimmed);
      if (err) { setError(err); return; }
    }
    close(trimmed);
  }, [pending, value, close]);

  // Esc cancels, Enter submits, autofocus the input on open
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 50);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [pending, close]);

  const PromptHost: React.ReactNode = pending
    ? createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="prompt-title"
          className="fixed inset-0 z-[400] overflow-y-auto bg-zinc-950/90 backdrop-blur-md animate-fade-in"
          onClick={() => close(null)}
        >
          <div className="min-h-full flex items-center justify-center p-4">
            <form
              className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-2xl p-5 sm:p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => { e.preventDefault(); submit(); }}
            >
              <div className="flex items-start gap-3 mb-3">
                <div className="flex-1 min-w-0">
                  <h3 id="prompt-title" className="text-base font-bold text-white leading-snug">
                    {pending.options.title}
                  </h3>
                  {pending.options.message && (
                    <p className="text-sm text-zinc-400 mt-1 leading-relaxed">{pending.options.message}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => close(null)}
                  aria-label="Close"
                  className="text-zinc-500 hover:text-white p-1 rounded -mt-1 -mr-1"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
                placeholder={pending.options.placeholder}
                className={`w-full bg-black/40 border rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 ${error ? 'border-red-500/40 focus:ring-red-500/30' : 'border-white/10 focus:ring-blue-500/40'}`}
              />
              {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
              <div className="flex justify-end gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => close(null)}
                  className="text-zinc-400 hover:text-white text-sm font-semibold px-3 sm:px-4 py-2"
                >
                  {pending.options.cancelLabel || 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={!value.trim()}
                  className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-blue-900/20"
                >
                  {pending.options.confirmLabel || 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )
    : null;

  return { prompt, PromptHost };
}
