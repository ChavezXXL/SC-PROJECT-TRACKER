// ═════════════════════════════════════════════════════════════════════
// "Can We Take It?" — answer a customer on the phone in 10 seconds.
//
// Part # + qty + need-by date → estimates the new job's hours (learned
// rates → sample data → manual entry), stacks it against everything
// already queued, and compares to real capacity until that date.
//
// Verdict: ✅ YES (≥1 workday spare) · 🟡 TIGHT (fits, no slack) ·
//          🔴 NO (short by Xh — shows exactly what it would take).
// ═════════════════════════════════════════════════════════════════════

import React, { useState, useMemo } from 'react';
import { X, PhoneCall, Calculator } from 'lucide-react';

import type { Job, TimeLog, User, SystemSettings, Sample } from '../types';
import * as DB from '../services/mockDb';
import { computeOperationRates, estimateJobMinutes } from '../utils/rateLearning';
import { getAggregatedSampleEstimate, suggestHoursFromAggregated } from '../utils/sampleEstimate';
import { computeJobETA } from '../utils/jobETA';
import { getPartHistory } from '../utils/partHistory';

const WORKDAY_HOURS = 8;

/** Count Mon–Fri workdays from today through `end` (inclusive). Min 1 when end >= today. */
function workdaysUntil(end: Date): number {
  const cur = new Date(); cur.setHours(0, 0, 0, 0);
  const target = new Date(end); target.setHours(0, 0, 0, 0);
  if (target < cur) return 0;
  let days = 0;
  while (cur <= target) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) days++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(1, days);
}

interface Props {
  jobs: Job[];
  allLogs: TimeLog[];      // completed logs (endTime set)
  activeLogs: TimeLog[];   // currently running
  workers: User[];
  settings: SystemSettings;
  samples: Sample[];
  onClose: () => void;
}

export const CanWeTakeIt: React.FC<Props> = ({ jobs, allLogs, activeLogs, workers, settings, samples, onClose }) => {
  const [part, setPart] = useState('');
  const [qty, setQty] = useState<number>(0);
  const [needBy, setNeedBy] = useState('');       // YYYY-MM-DD from <input type=date>
  const [manualHours, setManualHours] = useState<number>(0);

  // Known part numbers for the datalist — jobs + samples, deduped
  const knownParts = useMemo(() => {
    const s = new Set<string>();
    jobs.forEach(j => { if (j.partNumber?.trim()) s.add(j.partNumber.trim()); });
    samples.forEach(sm => { if (sm.partNumber?.trim()) s.add(sm.partNumber.trim()); });
    return [...s].sort();
  }, [jobs, samples]);

  // Hours already committed — remaining estimate across every open job
  const queueHours = useMemo(() => {
    const open = jobs.filter(j => j.status !== 'completed' && j.status !== 'hold');
    let total = 0;
    for (const job of open) {
      const history = getPartHistory(job.partNumber || '', jobs, allLogs);
      const eta = computeJobETA(job, allLogs, activeLogs, history, DB.getWorkingElapsedMs);
      if (eta.remainingHours !== null) total += eta.remainingHours;
    }
    return total;
  }, [jobs, allLogs, activeLogs]);

  const workerCount = useMemo(
    () => Math.max(1, workers.filter(w => w.isActive !== false && w.role !== 'admin').length || workers.length || 1),
    [workers],
  );

  const result = useMemo(() => {
    if (!part.trim() || qty <= 0 || !needBy) return null;
    const due = new Date(needBy + 'T00:00:00');
    if (isNaN(due.getTime())) return null;

    const buffer = settings.rateBuffer && settings.rateBuffer > 0 ? settings.rateBuffer : 1.15;

    // ── Estimate this job's hours: learned rates → samples → manual ──
    let estHours = 0;
    let source = '';
    let opCount = 0;
    const rates = computeOperationRates(allLogs, part);
    const rateEst = estimateJobMinutes(qty, rates, buffer);
    if (rateEst.hasData && rateEst.totalHours > 0) {
      estHours = rateEst.totalHours;
      opCount = rateEst.breakdown.length;
      source = `learned rates — ${rateEst.basedOnRuns} previous run${rateEst.basedOnRuns !== 1 ? 's' : ''}, ${opCount} op${opCount !== 1 ? 's' : ''}`;
    } else {
      const agg = getAggregatedSampleEstimate(part, samples, buffer);
      if (agg) {
        estHours = suggestHoursFromAggregated(agg, qty);
        opCount = agg.breakdown.length;
        source = `${agg.sampleCount} sample${agg.sampleCount !== 1 ? 's' : ''} — ${agg.totalPieces} pcs timed, ${agg.confidence} confidence`;
      }
    }
    if (manualHours > 0) {
      estHours = manualHours;
      source = 'manual estimate';
    }

    const days = workdaysUntil(due);
    const capacityHours = workerCount * WORKDAY_HOURS * days;
    const availableHours = capacityHours - queueHours;
    const hasEstimate = estHours > 0;
    const spare = availableHours - estHours;

    let verdict: 'yes' | 'tight' | 'no' | 'no-data';
    if (!hasEstimate) verdict = 'no-data';
    else if (days === 0) verdict = 'no';
    else if (spare >= WORKDAY_HOURS) verdict = 'yes';
    else if (spare >= 0) verdict = 'tight';
    else verdict = 'no';

    // What it would take when the answer is NO
    const extraDays = spare < 0 ? Math.ceil(Math.abs(spare) / (workerCount * WORKDAY_HOURS)) : 0;

    return { estHours, source, days, capacityHours, availableHours, spare, verdict, extraDays, hasEstimate };
  }, [part, qty, needBy, manualHours, allLogs, samples, settings.rateBuffer, workerCount, queueHours]);

  const V = result?.verdict;
  const verdictStyle =
    V === 'yes'   ? { ring: 'border-emerald-500/40 bg-emerald-500/10', big: 'text-emerald-400', label: '✅ YES — take it' } :
    V === 'tight' ? { ring: 'border-amber-500/40 bg-amber-500/10',     big: 'text-amber-400',   label: '🟡 TIGHT — fits, zero slack' } :
    V === 'no'    ? { ring: 'border-red-500/40 bg-red-500/10',         big: 'text-red-400',     label: '🔴 NO — not by that date' } :
                    { ring: 'border-white/10 bg-zinc-800/40',          big: 'text-zinc-400',    label: 'No rate data for this part' };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-zinc-950 border border-white/10 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between sticky top-0 bg-zinc-950/95 backdrop-blur-xl rounded-t-2xl">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center">
              <PhoneCall className="w-4.5 h-4.5 text-blue-400" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-base font-black text-white tracking-tight">Can We Take It?</h3>
              <p className="text-[11px] text-zinc-500">Answer while they're still on the phone</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Part Number</label>
              <input
                list="cwt-parts"
                value={part}
                onChange={e => setPart(e.target.value)}
                placeholder="e.g. MS21907W20"
                autoFocus
                className="mt-1 w-full bg-zinc-900/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-blue-500/50"
              />
              <datalist id="cwt-parts">
                {knownParts.map(p => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div>
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Quantity</label>
              <input
                type="number" min={1}
                value={qty || ''}
                onChange={e => setQty(parseInt(e.target.value, 10) || 0)}
                placeholder="5000"
                className="mt-1 w-full bg-zinc-900/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-blue-500/50 tabular"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Need By</label>
              <input
                type="date"
                value={needBy}
                onChange={e => setNeedBy(e.target.value)}
                className="mt-1 w-full bg-zinc-900/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500/50 [color-scheme:dark]"
              />
            </div>
            {/* Manual override — for parts we've never run */}
            <div className="col-span-2">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                Manual Hours <span className="text-zinc-600 normal-case font-semibold">(optional — overrides learned estimate)</span>
              </label>
              <input
                type="number" min={0} step={0.5}
                value={manualHours || ''}
                onChange={e => setManualHours(parseFloat(e.target.value) || 0)}
                placeholder="Leave blank to use learned rates"
                className="mt-1 w-full bg-zinc-900/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-blue-500/50 tabular"
              />
            </div>
          </div>

          {/* Verdict */}
          {result && (
            <div className={`rounded-2xl border p-4 ${verdictStyle.ring}`}>
              <p className={`text-xl font-black tracking-tight ${verdictStyle.big}`}>{verdictStyle.label}</p>

              {result.verdict === 'no-data' && (
                <p className="text-[12px] text-zinc-400 mt-1.5 leading-relaxed">
                  No learned rates or samples for "{part.trim()}". Enter manual hours above, or run a timed sample first.
                </p>
              )}

              {result.hasEstimate && (
                <>
                  {result.verdict === 'yes' && (
                    <p className="text-[12px] text-zinc-300 mt-1.5">
                      Fits with <span className="font-black text-emerald-400">{result.spare.toFixed(1)}h to spare</span> after everything already queued.
                    </p>
                  )}
                  {result.verdict === 'tight' && (
                    <p className="text-[12px] text-zinc-300 mt-1.5">
                      Only <span className="font-black text-amber-400">{result.spare.toFixed(1)}h of slack</span> — one bad day and it's late. Quote conservatively.
                    </p>
                  )}
                  {result.verdict === 'no' && (
                    <p className="text-[12px] text-zinc-300 mt-1.5">
                      Short by <span className="font-black text-red-400">{Math.abs(result.spare).toFixed(1)}h</span>.
                      Need <span className="font-black text-white">~{result.extraDays} more workday{result.extraDays !== 1 ? 's' : ''}</span>, overtime, or push another job.
                    </p>
                  )}

                  {/* The math — so the verdict is trustworthy, not magic */}
                  <div className="mt-3 pt-3 border-t border-white/10 space-y-1.5 text-[11px] tabular">
                    <div className="flex justify-between"><span className="text-zinc-500">This job needs</span><span className="font-black text-white">{result.estHours.toFixed(1)}h</span></div>
                    <div className="flex justify-between gap-4"><span className="text-zinc-500 truncate">Based on</span><span className="font-semibold text-zinc-300 text-right">{result.source}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-500">Already queued</span><span className="font-black text-white">{queueHours.toFixed(1)}h</span></div>
                    <div className="flex justify-between"><span className="text-zinc-500">Capacity by then</span><span className="font-black text-white">{result.capacityHours.toFixed(0)}h <span className="text-zinc-500 font-semibold">({workerCount} worker{workerCount !== 1 ? 's' : ''} × {WORKDAY_HOURS}h × {result.days}d)</span></span></div>
                    <div className="flex justify-between"><span className="text-zinc-500">Free after queue</span><span className={`font-black ${result.availableHours >= 0 ? 'text-white' : 'text-red-400'}`}>{result.availableHours.toFixed(1)}h</span></div>
                  </div>
                </>
              )}
            </div>
          )}

          {!result && (
            <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center">
              <Calculator className="w-6 h-6 text-zinc-700 mx-auto mb-2" aria-hidden="true" />
              <p className="text-[12px] text-zinc-500">Fill in part, quantity, and date — the verdict appears instantly.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CanWeTakeIt;
