// useShipDate — "when did it actually ship?" asked at the moment a job is
// completed (single, bulk, or a board drag).
//
// On-time used to be judged by when someone clicked Complete. Half the shop's
// jobs get closed out in bulk ~3 days after the work is done, so 42 jobs that
// were finished before their due date were counted late. This records the real
// ship date instead. Same promise-based shape as usePrompt / useConfirm:
//
//   const { askShipDate, ShipDateHost } = useShipDate();
//   const choice = await askShipDate({ count: 1, label: 'PO 116456', lastWorkMs });
//   if (!choice) return;                       // cancelled
//   const shippedAt = await resolveShipAt(choice, () => DB.lastWorkEndForJob(id));

import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Truck } from 'lucide-react';

export type ShipChoice =
  | { mode: 'today' }
  | { mode: 'lastWork' }
  | { mode: 'date'; at: number };

export interface ShipDateOptions {
  /** How many jobs are being completed. */
  count: number;
  /** e.g. "PO 116456" for a single job. */
  label?: string;
  /** Single job only: when work on it last ended (shows the actual date). */
  lastWorkMs?: number | null;
}

const fmtDay = (ms: number) => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const isoDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Turn a choice into a timestamp for one job. lastWork falls back to now when
 *  the job has no logged work. A picked day is stored as local noon (the
 *  on-time rule compares calendar days, so the hour never matters). */
export async function resolveShipAt(choice: ShipChoice, lastWork: () => Promise<number | null>): Promise<number> {
  if (choice.mode === 'today') return Date.now();
  if (choice.mode === 'date') return choice.at;
  return (await lastWork()) ?? Date.now();
}

export function useShipDate() {
  const [pending, setPending] = useState<{ opts: ShipDateOptions; resolve: (c: ShipChoice | null) => void } | null>(null);
  const [mode, setMode] = useState<ShipChoice['mode']>('today');
  const [picked, setPicked] = useState('');

  const askShipDate = useCallback((opts: ShipDateOptions) => new Promise<ShipChoice | null>(resolve => {
    setMode('today');
    setPicked('');
    setPending({ opts, resolve });
  }), []);

  const close = useCallback((c: ShipChoice | null) => {
    pending?.resolve(c);
    setPending(null);
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, close]);

  const confirm = () => {
    if (mode === 'date') {
      const m = picked.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return;
      close({ mode: 'date', at: new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0).getTime() });
    } else {
      close({ mode });
    }
  };

  const ShipDateHost: React.ReactNode = pending ? createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="ship-title"
      className="fixed inset-0 z-[400] overflow-y-auto bg-zinc-950/90 backdrop-blur-md animate-fade-in"
      onClick={() => close(null)}>
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-2xl p-5 sm:p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="flex items-start gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
              <Truck className="w-4 h-4 text-emerald-400" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 id="ship-title" className="text-base font-bold text-white leading-snug">
                When did {pending.opts.count === 1 ? (pending.opts.label || 'it') : `these ${pending.opts.count} jobs`} ship?
              </h3>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">On-time is measured by this date — not by when you clicked Complete.</p>
            </div>
            <button type="button" onClick={() => close(null)} aria-label="Close" className="text-zinc-500 hover:text-white p-1 rounded -mt-1 -mr-1">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-2" role="radiogroup" aria-label="Ship date">
            <Choice checked={mode === 'today'} onSelect={() => setMode('today')} title="Today" hint={fmtDay(Date.now())} />
            {(pending.opts.count > 1 || pending.opts.lastWorkMs) && (
              <Choice checked={mode === 'lastWork'} onSelect={() => setMode('lastWork')}
                title="Day the work finished"
                hint={pending.opts.count > 1 ? "Each job's last day of logged work" : `${fmtDay(pending.opts.lastWorkMs!)} — last time logged`} />
            )}
            <Choice checked={mode === 'date'} onSelect={() => setMode('date')} title="Another day">
              {mode === 'date' && (
                <input type="date" value={picked} max={isoDay(Date.now())} autoFocus
                  onChange={e => setPicked(e.target.value)}
                  onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
                  aria-label="Ship date"
                  className="mt-2 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white [color-scheme:dark]" />
              )}
            </Choice>
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <button type="button" onClick={() => close(null)} className="text-zinc-400 hover:text-white text-sm font-semibold px-3 sm:px-4 py-2">Cancel</button>
            <button type="button" onClick={confirm} disabled={mode === 'date' && !picked}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-4 py-2 rounded-lg text-sm font-bold">
              Mark complete
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  return { askShipDate, ShipDateHost };
}

function Choice({ checked, onSelect, title, hint, children }: { checked: boolean; onSelect: () => void; title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div role="radio" aria-checked={checked} tabIndex={0}
      onClick={onSelect}
      onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onSelect(); } }}
      className={`rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${checked ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-white/10 hover:border-white/20'}`}>
      <div className="flex items-center gap-2.5">
        <span className={`w-4 h-4 rounded-full border-2 shrink-0 ${checked ? 'border-emerald-400 bg-emerald-400' : 'border-zinc-600'}`} />
        <span className="text-sm font-bold text-white">{title}</span>
        {hint && <span className="text-xs text-zinc-500 ml-auto text-right">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
