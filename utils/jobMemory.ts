/**
 * Shop Brain pure helpers — given a job + history, return what the
 * tracker should "remember" about similar past runs.
 *
 * Why these are pure functions (no React state): the print pipeline
 * needs to look up memory for jobs that may have been saved BEFORE the
 * `expectedHours` field started persisting. Without an inference step,
 * the traveler shows "—" forever on legacy data. With it, the value
 * appears as soon as the print happens — no re-saving required.
 *
 * Inference strategy (best signal first):
 *   1. RATE-BASED — sum minutes & pieces from past TimeLogs that have
 *      sessionQty, divide for a min/pc rate, multiply by current qty.
 *      Scales correctly when the new order is larger or smaller than
 *      past runs. THIS IS THE PREFERRED PATH.
 *   2. JOB-LEVEL AVG — average total job hours across completed runs.
 *      Used when no sessionQty data exists (legacy logs).
 *   3. LAST RUN — single most recent run's total hours.
 *      Used when nothing is completed yet.
 */

import type { Job, TimeLog } from '../types';
import { computeOperationRates, estimateJobMinutes, getRateBreakdownForJob } from './rateLearning';

/** Sum minutes logged against a single job id. */
function totalMinutesFor(jobId: string, allLogs: TimeLog[]): number {
  return allLogs
    .filter(l => l.jobId === jobId)
    .reduce((a, l) => a + (l.durationMinutes || 0), 0);
}

/**
 * Compute the expected hours for a job using the best available signal.
 * Pass the new job's `quantity` so the rate-based path can scale.
 */
export function inferExpectedHours(
  job: Pick<Job, 'id' | 'customer' | 'partNumber' | 'quantity'>,
  jobs: Job[],
  allLogs: TimeLog[],
  buffer: number = 1
): number | null {
  const part = (job.partNumber || '').trim().toLowerCase();
  if (!part) return null;

  // ── 1. Rate-based estimate (best signal — scales with new qty, keyed by partNumber)
  const qty = job.quantity || 0;
  if (qty > 0) {
    const rates = computeOperationRates(allLogs, job.partNumber || '');
    if (rates.size > 0) {
      const est = estimateJobMinutes(qty, rates, buffer);
      if (est.hasData && est.totalHours > 0) {
        return parseFloat(est.totalHours.toFixed(1));
      }
    }
  }

  // ── 2. Per-piece job-level estimate from completed runs of this part
  //      (partNumber-only — same physical part has same cycle regardless
  //      of which customer it ships to). Scales by current quantity.
  const completedSamePart = jobs.filter(j =>
    j.id !== job.id &&
    j.status === 'completed' &&
    (j.partNumber || '').trim().toLowerCase() === part &&
    (j.quantity || 0) > 0,
  );
  if (completedSamePart.length > 0 && qty > 0) {
    const totalUnits = completedSamePart.reduce((a, j) => a + (j.quantity || 0), 0);
    const totalMins  = completedSamePart.reduce((a, j) => a + totalMinutesFor(j.id, allLogs), 0);
    if (totalUnits > 0 && totalMins > 0) {
      const hrsPerUnit = (totalMins / 60) / totalUnits;
      const scaled = hrsPerUnit * qty * buffer;
      if (scaled > 0) return parseFloat(scaled.toFixed(1));
    }
  }

  // ── 3. Last run total of this part (no completed runs with qty — fallback)
  const samePart = jobs.filter(j =>
    j.id !== job.id &&
    (j.partNumber || '').trim().toLowerCase() === part,
  );
  if (samePart.length === 0) return null;
  const recent = [...samePart].sort(
    (a, b) => (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt),
  )[0];
  const hrs = totalMinutesFor(recent.id, allLogs) / 60;
  return hrs > 0 ? parseFloat(hrs.toFixed(1)) : null;
}

/**
 * Returns a copy of the job with `expectedHours` filled in from memory
 * if the saved value is missing. Used by the traveler print so legacy
 * jobs (created before expectedHours was saving) still show an Est. Time.
 *
 * If the saved value already exists, the job is returned unchanged.
 */
export function enrichJobForPrint(
  job: Job,
  jobs: Job[],
  allLogs: TimeLog[],
  buffer: number = 1,
): Job {
  if ((job.expectedHours || 0) > 0) return job;
  const inferred = inferExpectedHours(job, jobs, allLogs, buffer);
  if (inferred === null) return job;
  return { ...job, expectedHours: inferred };
}

/** Re-export the rate breakdown helper so callers only need one import path. */
export { getRateBreakdownForJob };

// ────────────────────────────────────────────────────────────────────────
//  Backfill — give the rate engine retroactive data
// ────────────────────────────────────────────────────────────────────────

/**
 * For completed jobs that have logs but no sessionQty anywhere, we can
 * reasonably assume the worker(s) finished the full job quantity across
 * the session(s) they logged. This function plans those backfills.
 *
 * Strategy per job:
 *   • Skip jobs that already have ANY log with sessionQty set
 *     (don't double-count or override real data)
 *   • Skip jobs without a quantity (can't distribute what we don't know)
 *   • For the rest: distribute job.quantity across the job's logs
 *     proportional to each log's durationMinutes (a longer session
 *     finished more pieces). This is a heuristic but a much better
 *     starting point than "no data."
 *
 * Returns a list of patches the caller can write back to the DB. The
 * function is pure — no I/O — so it's safe to dry-run.
 */
export interface BackfillPatch {
  logId: string;
  sessionQty: number;
  jobId: string;
  reason: 'distributed-from-job-qty';
}

export function planSessionQtyBackfill(jobs: Job[], allLogs: TimeLog[]): BackfillPatch[] {
  const patches: BackfillPatch[] = [];

  for (const job of jobs) {
    if (job.status !== 'completed') continue;
    if (!job.quantity || job.quantity <= 0) continue;

    const jobLogs = allLogs.filter(l =>
      l.jobId === job.id &&
      typeof l.durationMinutes === 'number' && l.durationMinutes > 0
    );
    if (jobLogs.length === 0) continue;

    // Skip if ANY log already has sessionQty — assume the worker entered real data
    const hasAnyQty = jobLogs.some(l => typeof l.sessionQty === 'number' && l.sessionQty > 0);
    if (hasAnyQty) continue;

    const totalMins = jobLogs.reduce((a, l) => a + (l.durationMinutes || 0), 0);
    if (totalMins <= 0) continue;

    // Distribute job.quantity proportional to each log's time. Round to
    // whole pieces; absorb any rounding remainder into the LONGEST log
    // so the total still sums to job.quantity exactly.
    const longest = [...jobLogs].sort((a, b) => (b.durationMinutes || 0) - (a.durationMinutes || 0))[0];
    let assigned = 0;
    const rawAssignments: { log: TimeLog; qty: number }[] = [];

    for (const l of jobLogs) {
      if (l.id === longest.id) continue; // skip — we'll absorb remainder here
      const share = Math.round(((l.durationMinutes || 0) / totalMins) * job.quantity);
      rawAssignments.push({ log: l, qty: share });
      assigned += share;
    }
    const remainder = Math.max(1, job.quantity - assigned);
    rawAssignments.push({ log: longest, qty: remainder });

    for (const a of rawAssignments) {
      if (a.qty <= 0) continue;
      patches.push({
        logId: a.log.id,
        sessionQty: a.qty,
        jobId: job.id,
        reason: 'distributed-from-job-qty',
      });
    }
  }

  return patches;
}
