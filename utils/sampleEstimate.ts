// ═════════════════════════════════════════════════════════════════════
// Sample-derived estimates — turn timed sample work into a job estimate.
//
// When you run a physical sample (a small batch or single piece) through
// one or more operations and time each, we learn a minutes-per-piece rate
// PER operation. Summed across operations, that's the time-per-piece for
// the part. Multiply by a real job's quantity → a suggested expectedHours.
//
// This is the bridge from the Samples library → real job estimating, so a
// part you've sampled but never run a full job for can still be estimated.
// ═════════════════════════════════════════════════════════════════════

import type { Sample } from '../types';

/**
 * Sum of per-operation minutes-per-piece for a sample.
 * Only counts completed sessions that logged BOTH a duration and a qty.
 * Sessions for the same operation are grouped first so a paused-then-resumed
 * operation doesn't double-count its per-piece rate.
 */
export function sampleMinPerPiece(sample: Sample): number {
  const byOp = new Map<string, { sec: number; qty: number }>();
  for (const e of sample.workEntries || []) {
    if (!e.operation || !e.durationSeconds || e.durationSeconds <= 0 || !e.qty || e.qty <= 0) continue;
    const cur = byOp.get(e.operation) || { sec: 0, qty: 0 };
    cur.sec += e.durationSeconds;
    cur.qty += e.qty;
    byOp.set(e.operation, cur);
  }
  let total = 0;
  for (const { sec, qty } of byOp.values()) {
    if (qty > 0) total += (sec / 60) / qty;
  }
  return total;
}

/** Per-operation breakdown for displaying inside the job modal. */
export interface SampleOpBreakdown {
  operation: string;
  minPerPc: number;   // minutes per piece for this operation
  totalSec: number;   // raw seconds timed across all sessions for this op
  qty: number;        // pieces timed
}

export interface SampleEstimate {
  sample: Sample;
  minPerPc: number;          // total time-per-piece across all timed operations
  operations: number;        // how many distinct operations contributed
  breakdown: SampleOpBreakdown[]; // per-operation detail, sorted by minPerPc desc
}

/** Build the per-operation breakdown from a single sample. */
export function getSampleOpBreakdown(sample: Sample): SampleOpBreakdown[] {
  const byOp = new Map<string, { sec: number; qty: number }>();
  for (const e of sample.workEntries || []) {
    if (!e.operation || !e.durationSeconds || e.durationSeconds <= 0 || !e.qty || e.qty <= 0) continue;
    const cur = byOp.get(e.operation) || { sec: 0, qty: 0 };
    cur.sec += e.durationSeconds;
    cur.qty += e.qty;
    byOp.set(e.operation, cur);
  }
  return [...byOp.entries()]
    .filter(([, { qty }]) => qty > 0)
    .map(([operation, { sec, qty }]) => ({
      operation,
      minPerPc: (sec / 60) / qty,
      totalSec: sec,
      qty,
    }))
    .sort((a, b) => b.minPerPc - a.minPerPc);
}

/**
 * Find the best sample-based estimate for a part number (case-insensitive).
 * If multiple samples exist for the part, picks the one with the highest
 * minutes-per-piece (the most conservative / complete estimate).
 */
export function getSampleEstimateForPart(partNumber: string, samples: Sample[]): SampleEstimate | null {
  if (!partNumber?.trim()) return null;
  const pn = partNumber.trim().toLowerCase();
  let best: SampleEstimate | null = null;
  for (const s of samples) {
    if (s.partNumber?.trim().toLowerCase() !== pn) continue;
    const minPerPc = sampleMinPerPiece(s);
    if (minPerPc <= 0) continue;
    const breakdown = getSampleOpBreakdown(s);
    const operations = breakdown.length;
    if (!best || minPerPc > best.minPerPc) best = { sample: s, minPerPc, operations, breakdown };
  }
  return best;
}

/** Suggested expectedHours for a job given a sample estimate and the job quantity. */
export function suggestHoursFromSample(est: SampleEstimate, qty: number): number {
  if (qty <= 0) return 0;
  return Math.round((est.minPerPc * qty / 60) * 10) / 10; // round to 0.1h
}
