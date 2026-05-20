/**
 * Shop Brain pure helpers — given a job + history, return what the
 * tracker should "remember" about similar past runs.
 *
 * Why these are pure functions (no React state): the print pipeline
 * needs to look up memory for jobs that may have been saved BEFORE the
 * `expectedHours` field started persisting. Without an inference step,
 * the traveler shows "—" forever on legacy data. With it, the value
 * appears as soon as the print happens — no re-saving required.
 */

import type { Job, TimeLog } from '../types';

/** Sum minutes logged against a single job id. */
function totalMinutesFor(jobId: string, allLogs: TimeLog[]): number {
  return allLogs
    .filter(l => l.jobId === jobId)
    .reduce((a, l) => a + (l.durationMinutes || 0), 0);
}

/**
 * Find prior runs of the same customer + part number and compute a
 * sensible expected-hours value:
 *   1. Average hours across completed runs (best signal — most recent
 *      typical performance, ignores in-progress runs that haven't logged
 *      everything yet)
 *   2. Last run's logged hours (fallback when nothing is completed)
 *
 * Returns null if no prior runs are found or no hours were logged.
 */
export function inferExpectedHours(
  job: Pick<Job, 'id' | 'customer' | 'partNumber'>,
  jobs: Job[],
  allLogs: TimeLog[]
): number | null {
  const cust = (job.customer || '').trim().toLowerCase();
  const part = (job.partNumber || '').trim().toLowerCase();
  if (!cust || !part) return null;

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

  // No completed runs — fall back to the most recent run regardless of status
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
