// ═════════════════════════════════════════════════════════════════════
// Job ETA Engine — the intelligence layer.
//
// Predicts finish time for every open job based on:
//   • Hours already logged (finished + currently running)
//   • Expected total hours (from job.expectedHours or part history)
//   • Current pace (active workers + their logged progress)
//   • Days remaining until due date
//
// Outputs a risk level for every job:
//   critical  — already overdue or will definitely miss due date
//   at-risk   — pace says it'll be late
//   watch     — due very soon (≤ 2 days) or more than 80% of expected time used
//   on-track  — looks fine
//   no-data   — no expected hours and no part history; can't predict
//
// Also computes shop-wide CapacityForecast:
//   how many total hours of work remain vs available worker-hours this week.
// ═════════════════════════════════════════════════════════════════════

import type { Job, TimeLog } from '../types';
import type { PartHistory } from './partHistory';
import { parseDueDate } from './date';

export type JobRiskLevel = 'critical' | 'at-risk' | 'watch' | 'on-track' | 'no-data';

export interface JobETA {
  jobId: string;
  loggedHours: number;       // actual hours finished + currently running
  expectedHours: number | null;
  pctComplete: number;       // 0-100 (null-safe: 0 when no expected)
  remainingHours: number | null;
  daysUntilDue: number | null; // null = no due date; negative = overdue
  isOverdue: boolean;
  riskLevel: JobRiskLevel;
  riskReason: string;        // short human-readable reason shown on UI
}

export interface CapacityForecast {
  totalRemainingHours: number;
  weeklyCapacityHours: number;  // workers × workdayHours × workdaysLeft
  capacityPct: number;          // remaining / capacity * 100 (>100 = overloaded)
  overloaded: boolean;
  jobsAtRisk: number;
  jobsCritical: number;
  workdaysLeft: number;
  activeWorkers: number;
}

/** Working hours per day assumption (adjustable via settings in future). */
const WORKDAY_HOURS = 8;

/** Days considered "watch" range when no ETA data available. */
const WATCH_DAYS = 2;

// ── Core ETA for a single job ─────────────────────────────────────────

/**
 * Compute ETA + risk level for one job.
 *
 * @param job          The open job
 * @param allLogs      All completed time logs (used to total logged hours)
 * @param activeLogs   Currently-running logs (add their live elapsed time)
 * @param history      Optional part history (used as fallback for expectedHours)
 * @param getElapsedMs Function to get working elapsed ms from an active log
 *                     (pass DB.getWorkingElapsedMs or equivalent)
 */
export function computeJobETA(
  job: Job,
  allLogs: TimeLog[],
  activeLogs: TimeLog[],
  history: PartHistory | null,
  getElapsedMs: (log: TimeLog) => number,
): JobETA {
  const now = Date.now();

  // ── Logged hours (finished)
  // Prefer durationSeconds (most precise) over rounded durationMinutes.
  const finishedHours = allLogs
    .filter(l => l.jobId === job.id && l.endTime)
    .reduce((a, l) => {
      const mins = l.durationSeconds != null && l.durationSeconds >= 0
        ? l.durationSeconds / 60
        : (l.durationMinutes || 0);
      return a + mins / 60;
    }, 0);

  // ── Active log hours (live, mid-run)
  const activeHours = activeLogs
    .filter(l => l.jobId === job.id)
    .reduce((a, l) => a + getElapsedMs(l) / 3_600_000, 0);

  const loggedHours = finishedHours + activeHours;

  // ── Expected hours — job.expectedHours wins, part history is fallback
  let expectedHours: number | null = job.expectedHours && job.expectedHours > 0
    ? job.expectedHours
    : null;
  if (!expectedHours && history && history.avgHoursPerUnit > 0 && job.quantity > 0) {
    expectedHours = history.avgHoursPerUnit * job.quantity;
  }

  // ── Due date
  const dueDate = parseDueDate(job.dueDate);
  const daysUntilDue = dueDate
    ? (dueDate.getTime() - now) / 86_400_000
    : null;
  const isOverdue = dueDate ? dueDate.getTime() < now : false;

  // ── Derived metrics
  const pctComplete = expectedHours && expectedHours > 0
    ? Math.min(100, Math.round((loggedHours / expectedHours) * 100))
    : 0;
  const remainingHours = expectedHours !== null
    ? Math.max(0, expectedHours - loggedHours)
    : null;

  // ── Risk scoring
  let riskLevel: JobRiskLevel;
  let riskReason: string;

  /** Format a days-remaining value as a human string. Sub-1-day = "today". */
  const fmtDue = (d: number) => d < 1 ? 'today' : `in ${Math.ceil(d)}d`;

  if (isOverdue) {
    riskLevel = 'critical';
    const daysLate = Math.abs(daysUntilDue!);
    riskReason = daysLate < 1 ? 'Overdue (today)' : `${Math.ceil(daysLate)}d overdue`;
  } else if (daysUntilDue !== null && daysUntilDue <= WATCH_DAYS && expectedHours === null) {
    // No prediction data but due very soon
    riskLevel = 'watch';
    riskReason = `Due ${fmtDue(daysUntilDue)}`;
  } else if (remainingHours !== null && daysUntilDue !== null) {
    // We have enough data to predict
    const daysNeeded = remainingHours / WORKDAY_HOURS;
    const buffer = daysUntilDue - daysNeeded;

    if (buffer < -0.5) {
      // Will definitely miss by more than half a day
      riskLevel = 'critical';
      const overByDays = Math.abs(buffer);
      riskReason = `~${overByDays.toFixed(1)}d behind pace`;
    } else if (buffer < 1) {
      // Very tight
      riskLevel = 'at-risk';
      riskReason = buffer <= 0
        ? `No buffer — due ${fmtDue(daysUntilDue)}`
        : `Only ${(buffer * WORKDAY_HOURS).toFixed(1)}h margin`;
    } else if (daysUntilDue <= WATCH_DAYS || pctComplete > 80) {
      riskLevel = 'watch';
      riskReason = daysUntilDue <= WATCH_DAYS
        ? `Due ${fmtDue(daysUntilDue)}`
        : `${pctComplete}% of est. time used`;
    } else {
      riskLevel = 'on-track';
      riskReason = `${buffer.toFixed(1)}d buffer`;
    }
  } else if (daysUntilDue !== null) {
    // Have due date, no expected hours — can't predict pace
    if (daysUntilDue <= WATCH_DAYS) {
      riskLevel = 'watch';
      riskReason = `Due ${fmtDue(Math.max(0, daysUntilDue))} — no estimate`;
    } else {
      riskLevel = 'no-data';
      riskReason = 'No time estimate set';
    }
  } else {
    riskLevel = 'no-data';
    riskReason = 'No due date or estimate';
  }

  return {
    jobId: job.id,
    loggedHours,
    expectedHours,
    pctComplete,
    remainingHours,
    daysUntilDue,
    isOverdue,
    riskLevel,
    riskReason,
  };
}

// ── Batch ETA for all open jobs ───────────────────────────────────────

/** Run ETA on every open job. Returns a Map<jobId, JobETA>. */
export function computeAllJobETAs(
  openJobs: Job[],
  allLogs: TimeLog[],
  activeLogs: TimeLog[],
  historyMap: Map<string, PartHistory | null>,
  getElapsedMs: (log: TimeLog) => number,
): Map<string, JobETA> {
  const result = new Map<string, JobETA>();
  for (const job of openJobs) {
    const history = historyMap.get(job.partNumber?.trim().toLowerCase() || '') ?? null;
    result.set(job.id, computeJobETA(job, allLogs, activeLogs, history, getElapsedMs));
  }
  return result;
}

// ── Shop-wide capacity forecast ───────────────────────────────────────

/**
 * How much work is queued vs how much capacity is left this week?
 *
 * @param etaMap       Output from computeAllJobETAs
 * @param activeWorkers Number of workers currently clocked in (or scheduled)
 * @param workerCount  Total workers to use for weekly capacity estimate
 */
export function computeCapacityForecast(
  etaMap: Map<string, JobETA>,
  workerCount: number,
  activeWorkers: number,
): CapacityForecast {
  const now = new Date();
  // Days left in the work week (Mon–Fri). If weekend, treat as 5 days.
  const day = now.getDay(); // 0=Sun, 6=Sat
  const workdaysLeft = day === 0 || day === 6
    ? 5
    : Math.max(1, 6 - day); // Mon=1 → 5 days, Fri=5 → 1 day

  const weeklyCapacityHours = Math.max(1, workerCount) * WORKDAY_HOURS * workdaysLeft;

  let totalRemainingHours = 0;
  let jobsAtRisk = 0;
  let jobsCritical = 0;

  for (const eta of etaMap.values()) {
    if (eta.remainingHours !== null) {
      totalRemainingHours += eta.remainingHours;
    }
    if (eta.riskLevel === 'at-risk') jobsAtRisk++;
    if (eta.riskLevel === 'critical') jobsCritical++;
  }

  const capacityPct = (totalRemainingHours / weeklyCapacityHours) * 100;

  return {
    totalRemainingHours,
    weeklyCapacityHours,
    capacityPct,
    overloaded: capacityPct > 100,
    jobsAtRisk,
    jobsCritical,
    workdaysLeft,
    activeWorkers,
  };
}

// ── UI helpers ────────────────────────────────────────────────────────

export const RISK_COLORS: Record<JobRiskLevel, { bg: string; border: string; text: string; dot: string; label: string }> = {
  critical: { bg: 'bg-red-500/15',    border: 'border-red-500/40',    text: 'text-red-400',    dot: 'bg-red-500',    label: 'Critical' },
  'at-risk':{ bg: 'bg-orange-500/15', border: 'border-orange-500/40', text: 'text-orange-400', dot: 'bg-orange-500', label: 'At-Risk'  },
  watch:    { bg: 'bg-amber-500/10',  border: 'border-amber-500/30',  text: 'text-amber-400',  dot: 'bg-amber-400',  label: 'Watch'   },
  'on-track':{ bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400', dot: 'bg-emerald-500', label: 'On-Track' },
  'no-data': { bg: 'bg-zinc-800/60',  border: 'border-white/10',      text: 'text-zinc-500',   dot: 'bg-zinc-600',   label: 'No Data' },
};
