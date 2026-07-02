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
 * Only counts logs that have `sessionQty` AND a duration (durationSeconds
 * preferred, durationMinutes as fallback) — older logs without sessionQty
 * can't be converted to a per-piece rate.
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
    (l as any).durationAnomaly !== true &&   // never learn from a clamped/corrupt log
    ((typeof l.durationSeconds === 'number' && l.durationSeconds > 0) ||
      (typeof l.durationMinutes === 'number' && l.durationMinutes > 0)) &&
    typeof l.sessionQty === 'number' && l.sessionQty > 0
  );

  // Bucket by lowercased operation. Keep each session's per-piece rate so we can
  // drop outliers (a mistyped sessionQty — 3 instead of 300 — would otherwise
  // poison the learned rate for the whole part).
  type Sess = { mins: number; qty: number; rate: number; jobId: string };
  type Acc = { sessions: Sess[]; displayName: string };
  const byOp = new Map<string, Acc>();

  for (const l of relevant) {
    const key = l.operation.trim().toLowerCase();
    if (!key) continue;
    const e = byOp.get(key) || { sessions: [], displayName: l.operation.trim() };
    // durationSeconds-first (sub-minute precision), legacy durationMinutes as fallback
    const mins = typeof l.durationSeconds === 'number' && l.durationSeconds > 0 ? l.durationSeconds / 60 : l.durationMinutes!;
    e.sessions.push({ mins, qty: l.sessionQty!, rate: mins / l.sessionQty!, jobId: l.jobId });
    e.displayName = l.operation.trim();
    byOp.set(key, e);
  }

  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  const rates = new Map<string, OperationRate>();
  for (const [, e] of byOp.entries()) {
    let sessions = e.sessions;
    // With ≥4 samples, drop any session whose per-piece rate is wildly off the
    // median (>4× or <¼×) — that's a data-entry error, not a real cycle time.
    if (sessions.length >= 4) {
      const med = median(sessions.map(s => s.rate));
      if (med > 0) sessions = sessions.filter(s => s.rate <= med * 4 && s.rate >= med / 4);
    }
    if (sessions.length === 0) continue;
    const totalMins = sessions.reduce((a, s) => a + s.mins, 0);
    const totalQty  = sessions.reduce((a, s) => a + s.qty, 0);
    if (totalQty <= 0) continue;
    rates.set(e.displayName, {
      operation: e.displayName,
      ratePerPiece: totalMins / totalQty,
      totalPieces: totalQty,
      totalMinutes: totalMins,
      runCount: new Set(sessions.map(s => s.jobId)).size,
      sampleCount: sessions.length,
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
