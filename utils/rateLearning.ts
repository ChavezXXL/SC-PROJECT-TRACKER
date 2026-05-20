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
 * Build per-operation rate map for a given customer + part.
 * Only counts logs that have `sessionQty` AND `durationMinutes` — older
 * logs without sessionQty can't be converted to a per-piece rate.
 */
export function computeOperationRates(
  logs: TimeLog[],
  customer: string,
  partNumber: string
): Map<string, OperationRate> {
  const cust = (customer || '').trim().toLowerCase();
  const part = (partNumber || '').trim().toLowerCase();
  if (!cust || !part) return new Map();

  const relevant = logs.filter(l =>
    (l.partNumber || '').trim().toLowerCase() === part &&
    (l.customer || '').trim().toLowerCase() === cust &&
    !!l.operation &&
    typeof l.durationMinutes === 'number' && l.durationMinutes > 0 &&
    typeof l.sessionQty === 'number' && l.sessionQty > 0
  );

  type Acc = { totalMins: number; totalQty: number; runIds: Set<string>; sampleCount: number };
  const byOp = new Map<string, Acc>();

  for (const l of relevant) {
    const op = l.operation;
    const e = byOp.get(op) || { totalMins: 0, totalQty: 0, runIds: new Set<string>(), sampleCount: 0 };
    e.totalMins += l.durationMinutes!;
    e.totalQty += l.sessionQty!;
    e.runIds.add(l.jobId);
    e.sampleCount += 1;
    byOp.set(op, e);
  }

  const rates = new Map<string, OperationRate>();
  for (const [op, e] of byOp.entries()) {
    if (e.totalQty <= 0) continue;
    rates.set(op, {
      operation: op,
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
  rates: Map<string, OperationRate>
): RateEstimate {
  const rows: RateBreakdownRow[] = [];
  let totalMinutes = 0;
  let maxRuns = 0;

  for (const r of rates.values()) {
    const minutes = quantity * r.ratePerPiece;
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
  job: { customer?: string; partNumber?: string; quantity?: number },
  logs: TimeLog[]
): RateEstimate | null {
  const qty = job.quantity || 0;
  if (!qty || qty <= 0) return null;
  const rates = computeOperationRates(logs, job.customer || '', job.partNumber || '');
  if (rates.size === 0) return null;
  return estimateJobMinutes(qty, rates);
}

/** Format helper: "0.45 min/pc" or "27 sec/pc" depending on magnitude. */
export function formatRate(minPerPiece: number): string {
  if (minPerPiece >= 1) return `${minPerPiece.toFixed(2)} min/pc`;
  const sec = minPerPiece * 60;
  if (sec >= 1) return `${sec.toFixed(1)} sec/pc`;
  return `${(sec * 1000).toFixed(0)} ms/pc`;
}
