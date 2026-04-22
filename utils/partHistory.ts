// ═════════════════════════════════════════════════════════════════════
// Part Number History — "We've done this part before, here's how long it took"
//
// When you scan or enter a part number that the shop has produced before,
// this module looks at the historical jobs + time logs and returns:
//   • Number of previous runs
//   • Average hours per unit
//   • Best (fastest) worker
//   • Avg total time
//   • On-time delivery rate
//   • Suggested `expectedHours` for the new job's quantity
//
// Powers the "Part we've done before" suggestion card in the job modal.
// Reference: ProShop ERP's "Part History" — the killer feature for shops
// that quote repeat business and want to hold workers to known benchmarks.
// ═════════════════════════════════════════════════════════════════════

import type { Job, TimeLog } from '../types';
import { parseDueDate } from './date';

export interface PartHistory {
  partNumber: string;
  runs: PartRun[];
  totalRuns: number;
  totalUnits: number;
  totalHours: number;
  avgHoursPerUnit: number;       // most useful for estimates
  avgJobHours: number;           // avg total time per job
  bestWorker?: { userId: string; name: string; avgHoursPerUnit: number; runs: number };
  onTimeRate: number;            // 0-100, % of past runs delivered on time
  lastRun?: PartRun;
}

export interface PartRun {
  jobId: string;
  poNumber: string;
  quantity: number;
  customer?: string;
  completedAt?: number;
  dueDate?: string;
  totalHours: number;
  hoursPerUnit: number;
  onTime: boolean;
  primaryWorker?: string;        // name of the worker who logged the most time
}

/** Build the full history for a given part number.
 *  Case-insensitive match. Returns null if no prior runs exist. */
export function getPartHistory(partNumber: string, jobs: Job[], logs: TimeLog[]): PartHistory | null {
  if (!partNumber?.trim()) return null;
  const pn = partNumber.trim().toLowerCase();
  const priorJobs = jobs.filter(j => j.partNumber?.trim().toLowerCase() === pn && j.status === 'completed');
  if (priorJobs.length === 0) return null;

  const runs: PartRun[] = priorJobs.map(job => {
    const jobLogs = logs.filter(l => l.jobId === job.id && l.endTime);
    const totalMins = jobLogs.reduce((a, l) => a + (l.durationMinutes || 0), 0);
    const totalHours = totalMins / 60;
    const hoursPerUnit = job.quantity > 0 ? totalHours / job.quantity : 0;
    // On-time: completed before end-of-day on dueDate
    const due = parseDueDate(job.dueDate);
    const onTime = !!(due && job.completedAt && job.completedAt <= due.getTime() + 86400000);
    // Primary worker = user who logged the most time
    const byWorker = new Map<string, { name: string; mins: number }>();
    jobLogs.forEach(l => {
      const cur = byWorker.get(l.userId) || { name: l.userName, mins: 0 };
      cur.mins += l.durationMinutes || 0;
      byWorker.set(l.userId, cur);
    });
    let primaryWorker: string | undefined;
    let maxMins = 0;
    byWorker.forEach(v => { if (v.mins > maxMins) { maxMins = v.mins; primaryWorker = v.name; } });
    return {
      jobId: job.id,
      poNumber: job.poNumber,
      quantity: job.quantity,
      customer: job.customer,
      completedAt: job.completedAt,
      dueDate: job.dueDate,
      totalHours,
      hoursPerUnit,
      onTime,
      primaryWorker,
    };
  }).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  const runsWithTime = runs.filter(r => r.totalHours > 0);
  const totalUnits = runs.reduce((a, r) => a + r.quantity, 0);
  const totalHours = runs.reduce((a, r) => a + r.totalHours, 0);
  const avgHoursPerUnit = totalUnits > 0 ? totalHours / totalUnits : 0;
  const avgJobHours = runsWithTime.length > 0 ? totalHours / runsWithTime.length : 0;
  const onTimeRuns = runs.filter(r => r.onTime).length;
  const onTimeRate = runs.length > 0 ? Math.round((onTimeRuns / runs.length) * 100) : 0;

  // Best worker = lowest avg hours/unit across runs where they were primary
  const workerStats = new Map<string, { name: string; userId: string; totalUnits: number; totalHours: number; runs: number }>();
  runs.forEach(r => {
    if (!r.primaryWorker || r.quantity === 0 || r.totalHours === 0) return;
    const key = r.primaryWorker;
    const cur = workerStats.get(key) || { name: r.primaryWorker, userId: key, totalUnits: 0, totalHours: 0, runs: 0 };
    cur.totalUnits += r.quantity;
    cur.totalHours += r.totalHours;
    cur.runs += 1;
    workerStats.set(key, cur);
  });
  let bestWorker: PartHistory['bestWorker'];
  workerStats.forEach(w => {
    if (w.totalUnits === 0) return;
    const hpu = w.totalHours / w.totalUnits;
    if (!bestWorker || hpu < bestWorker.avgHoursPerUnit) {
      bestWorker = { userId: w.userId, name: w.name, avgHoursPerUnit: hpu, runs: w.runs };
    }
  });

  return {
    partNumber: priorJobs[0].partNumber,
    runs,
    totalRuns: runs.length,
    totalUnits,
    totalHours,
    avgHoursPerUnit,
    avgJobHours,
    bestWorker,
    onTimeRate,
    lastRun: runs[0],
  };
}

/** Calculate a suggested `expectedHours` for a new job given its quantity. */
export function suggestExpectedHours(history: PartHistory, newQty: number): number {
  if (history.avgHoursPerUnit > 0) {
    return Math.round(history.avgHoursPerUnit * newQty * 10) / 10; // round to 0.1
  }
  return Math.round(history.avgJobHours * 10) / 10;
}
