/**
 * Over-budget detection — find jobs whose actual logged time has
 * exceeded their rate-learned estimate (with buffer applied).
 *
 * Used by the App-level alert engine to fire toast + email when a job
 * crosses the threshold. Tracks already-alerted jobs in localStorage so
 * we don't re-spam on every re-render or page refresh.
 */

import type { Job, TimeLog } from '../types';
import { computeOperationRates, estimateJobMinutes } from './rateLearning';

export interface OverBudgetHit {
  job: Job;
  estimatedHours: number;     // including buffer
  actualHours: number;
  overByHours: number;
  operations: string[];       // operations contributing to the estimate
}

/**
 * Walk all active (non-completed) jobs and return those that have
 * crossed their estimated time. Jobs without rate data, or with no
 * logged time yet, are skipped.
 */
export function findOverBudgetJobs(
  jobs: Job[],
  allLogs: TimeLog[],
  rateBuffer: number,
): OverBudgetHit[] {
  const hits: OverBudgetHit[] = [];
  const buffer = rateBuffer > 0 ? rateBuffer : 1;

  for (const job of jobs) {
    // Skip terminal-state jobs — we're alerting about jobs currently in flight
    if (job.status === 'completed' || job.status === 'hold') continue;
    if (!job.partNumber || !job.quantity || job.quantity <= 0) continue;

    const rates = computeOperationRates(allLogs, job.partNumber);
    if (rates.size === 0) continue;

    const est = estimateJobMinutes(job.quantity, rates, buffer);
    if (!est.hasData || est.totalHours <= 0) continue;

    const actualMins = allLogs
      .filter(l => l.jobId === job.id && !l.isSample)
      .reduce((a, l) => a + (l.durationMinutes || 0), 0);
    const actualHours = actualMins / 60;
    if (actualHours <= 0) continue;

    if (actualHours > est.totalHours) {
      hits.push({
        job,
        estimatedHours: est.totalHours,
        actualHours,
        overByHours: actualHours - est.totalHours,
        operations: est.breakdown.map(b => b.operation),
      });
    }
  }

  return hits;
}

const ALERTED_KEY = 'fabtrack_over_budget_alerted';

/** Read the set of job IDs we've already alerted about (persisted). */
export function getAlertedJobIds(): Set<string> {
  try {
    const raw = localStorage.getItem(ALERTED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter(x => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

/** Mark a job as alerted so we don't re-fire (until it's reset by the user). */
export function markJobAlerted(jobId: string): void {
  try {
    const alerted = getAlertedJobIds();
    alerted.add(jobId);
    localStorage.setItem(ALERTED_KEY, JSON.stringify(Array.from(alerted)));
  } catch { /* localStorage may be unavailable */ }
}

/** Clear all over-budget alerts — useful after the user resolves issues. */
export function clearAllAlerts(): void {
  try { localStorage.removeItem(ALERTED_KEY); } catch {}
}
