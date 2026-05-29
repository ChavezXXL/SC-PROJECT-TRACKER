/**
 * Operation-level rate learning — "this operation takes X minutes per piece"
 * ─────────────────────────────────────────────────────────────────────────
 * Reads TimeLog history (each log already snapshots operation + sessionQty +
 * duration + customer + partNumber) and produces a rate-per-piece for each
 * operation that's ever been performed on a given (customer, partNumber).
 *
 * Why operation-level (not just job-level)?
 *   The shop owner's example: "30 samples take 20 minutes for deburr. So
 *   1000 parts should take ~11 hours of deburr." Job-level totals can't do
 *   that math because total job time mixes wash, QC, packing, etc.
 *
 * Why weighted average?
 *   A 1000-piece run is a stronger signal than a 30-piece sample. Summing
 *   minutes and pieces across all runs and dividing gives bigger runs more
 *   weight automatically — no arbitrary weighting factor needed.
 *
 * Why partNumber-keyed (not customer-keyed)?
 *   Same part across customers usually has the same rate. The customer
 *   match in `inferExpectedHours` (jobMemory.ts) handles the broader memory
 *   case; this module is purely about cycle time per operation.
 */

import type { TimeLog } from '../types';

export interface OperationRate {
  operation: string;
  ratePerPiece: number;   // minutes per piece (weighted across runs)
  totalPieces: number;    // total qty across all contributing sessions
  totalMinutes: number;   // total minutes across all contributing sessions
  runCount: number;       // # of distinct jobs that contributed
  sampleCount: number;    // # of individual log sessions
}

export interface RateBreakdownRow {
  operation: string;
  ratePerPiece: number;
  estimatedMinutes: number;
  runCount: number;
  sampleCount: number;
}

export interface RateEstimate {
  breakdown: RateBreakdownRow[];
  totalMinutes: number;
  totalHours: number;
  basedOnRuns: number;     // max runCount across operations
  hasData: boolean;
}

/**
 * Build per-operation rate map for a given part number.
 *
 * Keyed by partNumber (not customer + part) because the user's request:
 * "part numbers are mainly the same, PO is unique." A part has the same
 * physical cycle time regardless of which customer it ships to, so
 * pooling data across customers gives stronger signal faster.
 *
 * Only counts logs that have `sessionQty` AND `durationMinutes` — older
 * logs without sessionQty can't be converted to a per-piece rate.
 * Admin-entered samples (isSample=true) are included by design — that's
 * how the rate engine gets its seed data in this product.
 */
export function computeOperationRates(
  logs: TimeLog[],
  partNumber: string
): Map<string, OperationRate> {
  const part = (partNumber || '').trim().toLowerCase();
  if (!part) return new Map();

  const relevant = logs.filter(l =>
    (l.partNumber || '').trim().toLowerCase() === part &&
    !!l.operation &&
    typeof l.durationMinutes === 'number' && l.durationMinutes > 0 &&
    typeof l.sessionQty === 'number' && l.sessionQty > 0
  );

  // Bucket by lowercased operation so "Polish" / "polish" / "POLISH" merge.
  // We remember the most recent display casing for friendly output.
  type Acc = { totalMins: number; totalQty: number; runIds: Set<string>; sampleCount: number; displayName: string };
  const byOp = new Map<string, Acc>();

  for (const l of relevant) {
    const key = l.operation.trim().toLowerCase();
    if (!key) continue;
    const e = byOp.get(key) || { totalMins: 0, totalQty: 0, runIds: new Set<string>(), sampleCount: 0, displayName: l.operation.trim() };
    e.totalMins += l.durationMinutes!;
    e.totalQty += l.sessionQty!;
    e.runIds.add(l.jobId);
    e.sampleCount += 1;
    // Prefer Title Case or whatever the latest entry used (most likely current convention)
    e.displayName = l.operation.trim();
    byOp.set(key, e);
  }

  const rates = new Map<string, OperationRate>();
  for (const [, e] of byOp.entries()) {
    if (e.totalQty <= 0) continue;
    rates.set(e.displayName, {
      operation: e.displayName,
      ratePerPiece: e.totalMins / e.totalQty,
      totalPieces: e.totalQty,
      totalMinutes: e.totalMins,
      runCount: e.runIds.size,
      sampleCount: e.sampleCount,
    });
  }
  return rates;
}

/**
 * For a given quantity, project each operation's expected minutes and the
 * total. Operations are sorted by descending estimated time so the longest
 * bottleneck appears first on the traveler.
 */
export function estimateJobMinutes(
  quantity: number,
  rates: Map<string, OperationRate>,
  buffer: number = 1
): RateEstimate {
  const rows: RateBreakdownRow[] = [];
  let totalMinutes = 0;
  let maxRuns = 0;

  const safeBuffer = Number.isFinite(buffer) && buffer > 0 ? buffer : 1;

  for (const r of rates.values()) {
    const minutes = quantity * r.ratePerPiece * safeBuffer;
    rows.push({
      operation: r.operation,
      ratePerPiece: r.ratePerPiece,
      estimatedMinutes: minutes,
      runCount: r.runCount,
      sampleCount: r.sampleCount,
    });
    totalMinutes += minutes;
    if (r.runCount > maxRuns) maxRuns = r.runCount;
  }
  rows.sort((a, b) => b.estimatedMinutes - a.estimatedMinutes);

  return {
    breakdown: rows,
    totalMinutes,
    totalHours: totalMinutes / 60,
    basedOnRuns: maxRuns,
    hasData: rows.length > 0 && quantity > 0,
  };
}

/**
 * Convenience: rate breakdown for a specific job (uses job.customer +
 * job.partNumber + job.quantity). Returns null if no rate data exists.
 */
export function getRateBreakdownForJob(
  job: { partNumber?: string; quantity?: number },
  logs: TimeLog[],
  buffer: number = 1
): RateEstimate | null {
  const qty = job.quantity || 0;
  if (!qty || qty <= 0) return null;
  const rates = computeOperationRates(logs, job.partNumber || '');
  if (rates.size === 0) return null;
  return estimateJobMinutes(qty, rates, buffer);
}

/** Format helper: "0.45 min/pc" or "27 sec/pc" depending on magnitude. */
export function formatRate(minPerPiece: number): string {
  if (minPerPiece >= 1) return `${minPerPiece.toFixed(2)} min/pc`;
  const sec = minPerPiece * 60;
  if (sec >= 1) return `${sec.toFixed(1)} sec/pc`;
  return `${(sec * 1000).toFixed(0)} ms/pc`;
}
