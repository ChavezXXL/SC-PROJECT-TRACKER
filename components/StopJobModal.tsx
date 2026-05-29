/**
 * StopJobModal — captures pieces-completed when a worker stops a timer.
 *
 * This is the missing piece for rate learning: without sessionQty on each
 * log, the rate engine has no per-piece data to learn from.
 *
 * UX priorities:
 *   • Pre-fill with the job's quantity (most common case is a single-session job)
 *   • Input focused + selected so worker just hits Enter to confirm
 *   • Escape cancels (timer stays running — no data loss)
 *   • "Skip" button as escape hatch — stop without qty, no rate data, but unblocked
 *   • Renders in a portal so it overlays any active modal
 */

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, X, Clock } from 'lucide-react';
import type { Job, TimeLog } from '../types';

interface Props {
  log: TimeLog;
  job: Job | null;
  onConfirm: (sessionQty: number | undefined) => void | Promise<void>;
  onCancel: () => void;
}

function formatElapsed(startTime: number): string {
  const mins = Math.floor((Date.now() - startTime) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export const StopJobModal: React.FC<Props> = ({ log, job, onConfirm, onCancel }) => {
  // Pre-fill with the job's total quantity — the common case is a single-
  // session job, in which case "pieces this session" == "job qty".
  const defaultQty = job?.quantity || 0;
  const [qtyText, setQtyText] = useState(defaultQty > 0 ? String(defaultQty) : '');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus + select on open so worker can just hit Enter or type over
  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
    return () => clearTimeout(t);
  }, []);

  // Escape cancels (timer stays running)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const submitQty = async (qty: number | undefined) => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm(qty);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseInt(qtyText.trim(), 10);
    void submitQty(!isNaN(n) && n > 0 ? n : undefined);
  };

  const handleSkip = () => void submitQty(undefined);

  const partLabel = job?.partNumber || log.partNumber || '—';
  const poLabel   = job?.poNumber || log.jobIdsDisplay || '—';

  const modal = (
    <div
      className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Stop job — record pieces completed"
      onClick={busy ? undefined : onCancel}
    >
      <form
        onSubmit={handleSave}
        onClick={e => e.stopPropagation()}
        className="bg-zinc-900 border border-white/10 w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-white/[0.07]">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-black text-white flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-400" aria-hidden="true" /> Finish Session
            </h3>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              aria-label="Cancel — keep timer running"
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors disabled:opacity-40"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-zinc-500 mt-1.5 font-mono">
            <strong className="text-white">{poLabel}</strong> · {partLabel} · {log.operation}
          </p>
          <p className="text-[10px] text-zinc-600 mt-1 flex items-center gap-1.5">
            <Clock className="w-3 h-3" aria-hidden="true" /> Session time: {formatElapsed(log.startTime)}
          </p>
        </div>

        {/* Body — qty input */}
        <div className="px-5 py-5 space-y-3">
          <label className="block">
            <span className="text-xs font-black text-zinc-300 uppercase tracking-wider">
              How many pieces did you finish?
            </span>
            <p className="text-[10px] text-zinc-600 mt-0.5 font-normal normal-case tracking-normal">
              FabTrack uses this to learn cycle time per operation. Skip if you don't know.
            </p>
            <div className="relative mt-2.5">
              <input
                ref={inputRef}
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                value={qtyText}
                onChange={e => setQtyText(e.target.value)}
                placeholder="0"
                disabled={busy}
                className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3.5 text-white font-mono text-2xl text-center outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-50"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600 text-sm font-bold pointer-events-none">pcs</span>
            </div>
          </label>

          {/* Quick chips for common values when job qty is known */}
          {defaultQty > 0 && (
            <div className="flex gap-2 flex-wrap">
              {[defaultQty, Math.round(defaultQty / 2), Math.round(defaultQty / 4)]
                .filter((n, i, arr) => n > 0 && arr.indexOf(n) === i) // dedupe + drop zeros
                .map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setQtyText(String(n))}
                    disabled={busy}
                    className="text-xs font-bold text-zinc-400 hover:text-white bg-zinc-800/80 hover:bg-zinc-700 border border-white/10 rounded-lg px-2.5 py-1 transition-colors disabled:opacity-40"
                  >
                    {n}
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-1 flex flex-col-reverse sm:flex-row gap-2">
          <button
            type="button"
            onClick={handleSkip}
            disabled={busy}
            className="flex-1 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-sm transition-colors disabled:opacity-40"
          >
            Skip & Stop
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex-1 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm transition-colors disabled:opacity-40"
          >
            {busy ? 'Stopping…' : 'Save & Stop'}
          </button>
        </div>
      </form>
    </div>
  );

  return createPortal(modal, document.body);
};
