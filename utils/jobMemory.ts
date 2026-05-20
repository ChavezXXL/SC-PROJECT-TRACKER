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
  allLogs: TimeLog[]
): number | null {
  const cust = (job.customer || '').trim().toLowerCase();
  const part = (job.partNumber || '').trim().toLowerCase();
  if (!cust || !part) return null;

  // ── 1. Rate-based estimate (best signal — scales with new qty)
  const qty = job.quantity || 0;
  if (qty > 0) {
    const rates = computeOperationRates(allLogs, job.customer || '', job.partNumber || '');
    if (rates.size > 0) {
      const est = estimateJobMinutes(qty, rates);
      if (est.hasData && est.totalHours > 0) {
        return parseFloat(est.totalHours.toFixed(1));
      }
    }
  }

  // ── 2. Job-level average across completed runs (legacy fallback)
  const matches = jobs.filter(j =>
    j.id !== job.id &&
    (j.customer || '').trim().toLowerCase() === cust &&
    (j.partNumber || '').trim().toLowerCase() === part
  );
  if (!matches.length) return null;

  const completed = matches.filter(j => j.status === 'completed');
  if (completed.length > 0) {
    const totalMins = completed.reduce((sum, j) => sum + totalMinutesFor(j.id, allLogs), 0);
    const avgHrs = totalMins / completed.length / 60;
    if (avgHrs > 0) return parseFloat(avgHrs.toFixed(1));
  }

  // ── 3. Last run total (no completed runs yet)
  const recent = [...matches].sort(
    (a, b) => (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt)
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
export function enrichJobForPrint(job: Job, jobs: Job[], allLogs: TimeLog[]): Job {
  if ((job.expectedHours || 0) > 0) return job;
  const inferred = inferExpectedHours(job, jobs, allLogs);
  if (inferred === null) return job;
  return { ...job, expectedHours: inferred };
}

/** Re-export the rate breakdown helper so callers only need one import path. */
export { getRateBreakdownForJob };
