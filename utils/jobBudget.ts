/**
 * jobBudget.ts — one answer to "how much of the quote has this job used?"
 * and "what did this job make?", for every screen.
 *
 * Before this, "over budget" was worked out three different ways (hours ×
 * shop rate with samples, the same without samples, per-worker rates with
 * overhead but no material/POs), so one job could be OVER BUDGET on the Jobs
 * list and fine on the dashboard. Everything now goes through calcJobProfit.
 */

import type { Job, TimeLog, User, SystemSettings, PurchaseOrder } from '../types';
import { calcJobProfit } from './jobProfit';

/** At or above this share of the quote spent, a job is "at risk". */
export const AT_RISK_PCT = 70;

export interface JobBudget {
  cost:       number;   // labor (+ overhead) + material + outside processing so far
  quote:      number;
  usedPct:    number;   // cost ÷ quote × 100 (can go past 100)
  remaining:  number;   // quote − cost (negative when over)
  overBudget: boolean;
  atRisk:     boolean;  // ≥ AT_RISK_PCT used but not over yet
}

/** Group logs by job once — calcJobProfit filters per job otherwise. */
export function groupLogsByJob(logs: TimeLog[]): Map<string, TimeLog[]> {
  const m = new Map<string, TimeLog[]>();
  for (const l of logs) {
    const list = m.get(l.jobId);
    if (list) list.push(l); else m.set(l.jobId, [l]);
  }
  return m;
}

/** Budget use for every job that has a quote. Jobs without one are left out. */
export function jobBudgets(
  jobs: Job[], logsByJob: Map<string, TimeLog[]>, users: User[], settings: SystemSettings, pos: PurchaseOrder[],
): Map<string, JobBudget> {
  const out = new Map<string, JobBudget>();
  for (const j of jobs) {
    const quote = j.quoteAmount || 0;
    if (quote <= 0) continue;
    const cost = calcJobProfit(j, logsByJob.get(j.id) || [], users, settings, pos).totalCost;
    const usedPct = (cost / quote) * 100;
    const overBudget = cost > quote;
    out.set(j.id, { cost, quote, usedPct, remaining: quote - cost, overBudget, atRisk: !overBudget && usedPct >= AT_RISK_PCT });
  }
  return out;
}

export interface JobMoney { revenue: number; totalCost: number; profit: number; laborHours: number }

/**
 * What a job made. A closed job uses the profit snapshot locked at close-out
 * (so later rate changes don't rewrite last month); anything else is live.
 */
export function jobMoney(
  job: Job, jobLogs: TimeLog[], users: User[], settings: SystemSettings, pos: PurchaseOrder[],
): JobMoney {
  const s = job.profitSnapshot;
  if (s) return { revenue: s.revenue, totalCost: s.totalCost, profit: s.profit, laborHours: s.laborHours };
  const p = calcJobProfit(job, jobLogs, users, settings, pos);
  return { revenue: p.revenue, totalCost: p.totalCost, profit: p.profit, laborHours: p.laborHours };
}
