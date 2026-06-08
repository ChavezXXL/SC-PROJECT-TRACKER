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
 * Sum of per-operation minutes-per-piece for a single sample.
 * Groups sessions by operation first (so paused-then-resumed doesn't
 * double-count) then sums across operations.
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
  minPerPc: number;    // buffered minutes per piece for this operation
  rawMinPerPc: number; // raw (un-buffered) minutes per piece
  totalSec: number;    // raw seconds timed across all sessions for this op
  qty: number;         // total pieces timed across all samples for this op
  sampleCount: number; // how many samples contributed data for this op
}

export interface SampleEstimate {
  sample: Sample;
  minPerPc: number;             // total time-per-piece across all timed operations
  operations: number;           // how many distinct operations contributed
  breakdown: SampleOpBreakdown[]; // per-operation detail, sorted by minPerPc desc
}

/** Build the per-operation breakdown from a single sample (no buffer). */
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
      rawMinPerPc: (sec / 60) / qty,
      totalSec: sec,
      qty,
      sampleCount: 1,
    }))
    .sort((a, b) => b.minPerPc - a.minPerPc);
}

/**
 * Find the best sample-based estimate for a part number (case-insensitive).
 * Legacy single-sample picker — used internally; prefer getAggregatedSampleEstimate.
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

// ─────────────────────────────────────────────────────────────────────
// SMART AGGREGATION — averages ALL samples for a part, weighted by
// piece count, applies rateBuffer. This is the preferred entry point
// for anything that needs a production-ready estimate.
// ─────────────────────────────────────────────────────────────────────

export type SampleConfidence = 'low' | 'medium' | 'high';

export interface AggregatedSampleEstimate {
  /** Buffered total min/pc (apply this to job qty for expectedHours) */
  minPerPc: number;
  /** Raw min/pc before buffer */
  rawMinPerPc: number;
  /** Buffer multiplier applied (from shopSettings.rateBuffer, default 1.0 for samples) */
  rateBuffer: number;
  /** Per-operation breakdown, sorted by minPerPc desc */
  breakdown: SampleOpBreakdown[];
  /** How many distinct samples contributed */
  sampleCount: number;
  /** Total pieces timed across all samples (higher = more trustworthy) */
  totalPieces: number;
  /** confidence: low (<5 pcs or 1 sample), medium (2 samples or 5-20 pcs), high (3+ samples or 20+ pcs) */
  confidence: SampleConfidence;
  /** All samples for this part, newest first */
  allSamples: Sample[];
}

/**
 * Aggregate timing data from ALL samples for a part number.
 *
 * Algorithm:
 *  1. Collect every (operation, session) entry across all matching samples.
 *  2. Group by operation — pool all seconds and all pieces.
 *  3. Compute weighted min/pc per operation (more pieces = more weight naturally).
 *  4. Sum across operations for total min/pc.
 *  5. Apply rateBuffer so estimates aren't dangerously tight.
 *
 * Why pooling beats averaging individual sample totals:
 *   Sample A ran 2 pcs in 4 min → 2 min/pc.
 *   Sample B ran 8 pcs in 14 min → 1.75 min/pc.
 *   Simple avg: 1.875.  Pooled (10 pcs in 18 min): 1.8 min/pc — correct.
 *   The larger batch tells us more, and pooling reflects that automatically.
 */
export function getAggregatedSampleEstimate(
  partNumber: string,
  samples: Sample[],
  rateBuffer = 1.0,
): AggregatedSampleEstimate | null {
  if (!partNumber?.trim()) return null;
  const pn = partNumber.trim().toLowerCase();

  const matching = samples
    .filter(s => s.partNumber?.trim().toLowerCase() === pn)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); // newest first

  if (matching.length === 0) return null;

  // Pool all sessions by operation across every sample
  const byOp = new Map<string, { totalSec: number; totalQty: number; sampleIds: Set<string> }>();

  for (const s of matching) {
    for (const e of s.workEntries || []) {
      if (!e.operation || !e.durationSeconds || e.durationSeconds <= 0 || !e.qty || e.qty <= 0) continue;
      const cur = byOp.get(e.operation) || { totalSec: 0, totalQty: 0, sampleIds: new Set() };
      cur.totalSec += e.durationSeconds;
      cur.totalQty += e.qty;
      cur.sampleIds.add(s.id);
      byOp.set(e.operation, cur);
    }
  }

  if (byOp.size === 0) return null;

  // Build breakdown — raw first, then apply buffer
  const breakdown: SampleOpBreakdown[] = [...byOp.entries()]
    .filter(([, { totalQty }]) => totalQty > 0)
    .map(([operation, { totalSec, totalQty, sampleIds }]) => {
      const raw = (totalSec / 60) / totalQty;
      return {
        operation,
        rawMinPerPc: raw,
        minPerPc: raw * rateBuffer,
        totalSec,
        qty: totalQty,
        sampleCount: sampleIds.size,
      };
    })
    .sort((a, b) => b.minPerPc - a.minPerPc);

  const rawMinPerPc  = breakdown.reduce((a, b) => a + b.rawMinPerPc, 0);
  const minPerPc     = rawMinPerPc * rateBuffer;
  const totalPieces  = [...byOp.values()].reduce((a, v) => a + v.totalQty, 0);

  const confidence: SampleConfidence =
    matching.length >= 3 || totalPieces >= 20 ? 'high' :
    matching.length >= 2 || totalPieces >= 5  ? 'medium' : 'low';

  return {
    minPerPc,
    rawMinPerPc,
    rateBuffer,
    breakdown,
    sampleCount: matching.length,
    totalPieces,
    confidence,
    allSamples: matching,
  };
}

/** Suggested expectedHours using the aggregated estimate. */
export function suggestHoursFromAggregated(est: AggregatedSampleEstimate, qty: number): number {
  if (qty <= 0) return 0;
  return Math.round((est.minPerPc * qty / 60) * 10) / 10; // round to 0.1h
}

/**
 * Get the previous rate for a SPECIFIC operation across all samples for a part.
 * Used in StartWorkModal to show workers their target rate.
 */
export function getPreviousOpRate(
  partNumber: string,
  operation: string,
  samples: Sample[],
): { minPerPc: number; totalPieces: number; sessionCount: number } | null {
  if (!partNumber?.trim() || !operation?.trim()) return null;
  const pn  = partNumber.trim().toLowerCase();
  const op  = operation.trim().toLowerCase();
  let totalSec = 0, totalQty = 0, sessionCount = 0;
  for (const s of samples) {
    if (s.partNumber?.trim().toLowerCase() !== pn) continue;
    for (const e of s.workEntries || []) {
      if ((e.operation || '').trim().toLowerCase() !== op) continue;
      if (!e.durationSeconds || e.durationSeconds <= 0 || !e.qty || e.qty <= 0) continue;
      totalSec   += e.durationSeconds;
      totalQty   += e.qty;
      sessionCount += 1;
    }
  }
  if (totalQty === 0) return null;
  return { minPerPc: (totalSec / 60) / totalQty, totalPieces: totalQty, sessionCount };
}
