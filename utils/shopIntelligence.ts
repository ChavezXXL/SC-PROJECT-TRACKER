/**
 * shopIntelligence.ts — Shop Brain
 *
 * Pure computation engine. Takes live data, returns typed ShopInsight[].
 * Zero side effects — safe to call on every render if memoized.
 *
 * Insight types:
 *   underquoted      — open job already burned past its quote in labor alone
 *   repeat_loss      — part number consistently loses money (≥2 runs, avg margin < 0)
 *   customer_risk    — customer has ≥3 jobs and is consistently tight/loss
 *   revenue_drop     — this month's revenue is >25% below last month
 *   capacity_risk    — jobs due this week will need more hours than available
 *   stale_job        — open job with no activity for 5+ days (escalation of the 48h version)
 *   great_customer   — customer generating the most margin, positive reinforcement
 *   worker_anomaly   — a worker's avg time per job is running significantly above their baseline
 *   quote_gap        — open jobs with no quote set (can't track profitability)
 *   hero_part        — a part number that consistently runs at great margins
 */

import type { Job, TimeLog, User, SystemSettings, PurchaseOrder } from '../types';
import { calcJobProfit } from './jobProfit';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type InsightType =
  | 'underquoted'
  | 'repeat_loss'
  | 'customer_risk'
  | 'revenue_drop'
  | 'capacity_risk'
  | 'stale_job'
  | 'great_customer'
  | 'worker_anomaly'
  | 'quote_gap'
  | 'hero_part';

export type InsightSeverity = 'critical' | 'warning' | 'info' | 'positive';

export interface ShopInsight {
  id: string;
  type: InsightType;
  severity: InsightSeverity;
  title: string;
  body: string;
  /** Optional CTA label shown as a button */
  action?: string;
  /** Route/view to navigate to when action is clicked */
  actionView?: string;
  /** Raw data for callers that want to render custom UI */
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  const s = abs >= 1000 ? `$${(abs / 1000).toFixed(1)}k` : `$${abs.toFixed(0)}`;
  return n < 0 ? `-${s}` : s;
}

function jobLaborMinutes(job: Job, allLogs: TimeLog[]): number {
  return allLogs
    .filter(l => l.jobId === job.id && !l.isSample)
    .reduce((a, l) => {
      if (l.durationSeconds != null && l.durationSeconds >= 0) return a + l.durationSeconds / 60;
      return a + (l.durationMinutes || 0);
    }, 0);
}

// ─────────────────────────────────────────────────────────────
// Main function
// ─────────────────────────────────────────────────────────────

export function computeInsights(
  jobs: Job[],
  allLogs: TimeLog[],
  users: User[],
  settings: SystemSettings,
  allPOs: PurchaseOrder[],
): ShopInsight[] {
  const insights: ShopInsight[] = [];
  const now = Date.now();
  const shopRate = settings.shopRate ?? 0;
  const ohPerHour = (settings.monthlyOverhead ?? 0) / Math.max(1, settings.monthlyWorkHours ?? 160);

  // ─── 1. UNDERQUOTED open jobs ──────────────────────────────
  // Jobs where labor already burned through more than the quote
  if (shopRate > 0) {
    const openJobs = jobs.filter(j => j.status !== 'completed' && (j.quoteAmount ?? 0) > 0);
    for (const job of openJobs) {
      const mins = jobLaborMinutes(job, allLogs);
      const laborCost = (mins / 60) * (shopRate + ohPerHour);
      const quote = job.quoteAmount ?? 0;
      if (laborCost > quote * 1.1) {
        // Already burned more than 110% of the quote
        const overBy = laborCost - quote;
        insights.push({
          id: `underquoted_${job.id}`,
          type: 'underquoted',
          severity: laborCost > quote * 1.5 ? 'critical' : 'warning',
          title: `"${job.poNumber}" is over budget`,
          body: `Labor alone is ${fmtMoney(laborCost)} on a ${fmtMoney(quote)} quote — ${fmtMoney(overBy)} over. ${
            job.customer ? `Customer: ${job.customer}.` : ''
          } Consider adjusting the quote or flagging for review.`,
          action: 'View Job',
          actionView: 'admin-jobs',
          metadata: { jobId: job.id, laborCost, quote, overBy },
        });
      }
    }
  }

  // ─── 2. REPEAT LOSS parts ──────────────────────────────────
  // Part numbers with ≥2 completed runs where avg margin is negative
  const completedJobs = jobs.filter(j => j.status === 'completed');
  // Margin maps include ONLY quoted jobs — a quote-less job has revenue 0 and a
  // synthetic -100% margin that would falsely drag parts/customers into "loses
  // money" alerts. Unquoted jobs are surfaced separately by the quote_gap insight.
  const quotedCompleted = completedJobs.filter(j => (j.quoteAmount ?? 0) > 0);
  const byPart = new Map<string, Job[]>();
  for (const j of quotedCompleted) {
    const pn = (j.partNumber || '').trim().toLowerCase();
    if (!pn) continue;
    if (!byPart.has(pn)) byPart.set(pn, []);
    byPart.get(pn)!.push(j);
  }
  byPart.forEach((partJobs, pn) => {
    if (partJobs.length < 2) return;
    const margins = partJobs.map(j => {
      if (j.profitSnapshot) return j.profitSnapshot.marginPct;
      const b = calcJobProfit(j, allLogs, users, settings, allPOs);
      return b.marginPct;
    });
    const avgMargin = margins.reduce((a, m) => a + m, 0) / margins.length;
    const lossRuns = margins.filter(m => m < 0).length;
    if (avgMargin < -5 && lossRuns >= 2) {
      const displayPn = partJobs[0].partNumber || pn;
      insights.push({
        id: `repeat_loss_${pn}`,
        type: 'repeat_loss',
        severity: avgMargin < -20 ? 'critical' : 'warning',
        title: `Part "${displayPn}" consistently loses money`,
        body: `${partJobs.length} completed runs, avg margin ${avgMargin.toFixed(0)}%. You're losing money every time you run this part. Re-quote or find a way to cut cost.`,
        action: 'View Reports',
        actionView: 'admin-reports',
        metadata: { partNumber: displayPn, runs: partJobs.length, avgMargin },
      });
    }
  });

  // ─── 3. CUSTOMER RISK ─────────────────────────────────────
  // Customers with ≥3 completed jobs where average margin is consistently poor
  const byCust = new Map<string, Job[]>();
  for (const j of quotedCompleted) {
    const c = (j.customer || '').trim();
    if (!c) continue;
    if (!byCust.has(c)) byCust.set(c, []);
    byCust.get(c)!.push(j);
  }
  byCust.forEach((custJobs, customer) => {
    if (custJobs.length < 3) return;
    const margins = custJobs.map(j => {
      if (j.profitSnapshot) return j.profitSnapshot.marginPct;
      const b = calcJobProfit(j, allLogs, users, settings, allPOs);
      return b.marginPct;
    });
    const avgMargin = margins.reduce((a, m) => a + m, 0) / margins.length;
    const tightOrLoss = margins.filter(m => m < 15).length;
    if (avgMargin < 10 && tightOrLoss / margins.length >= 0.7) {
      const revenue = custJobs.reduce((a, j) => a + (j.quoteAmount ?? 0), 0);
      insights.push({
        id: `customer_risk_${customer.replace(/\W+/g, '_')}`,
        type: 'customer_risk',
        severity: avgMargin < 0 ? 'critical' : 'warning',
        title: `${customer} is a low-margin customer`,
        body: `${custJobs.length} jobs, avg margin ${avgMargin.toFixed(0)}% (${tightOrLoss} of ${margins.length} runs were tight or a loss). Total revenue: ${fmtMoney(revenue)}. Worth re-quoting next order.`,
        action: 'View Reports',
        actionView: 'admin-reports',
        metadata: { customer, runs: custJobs.length, avgMargin, revenue },
      });
    }
  });

  // ─── 4. REVENUE DROP ─────────────────────────────────────
  // This month's revenue is >25% below last month
  const thisMonthStart = new Date(); thisMonthStart.setDate(1); thisMonthStart.setHours(0, 0, 0, 0);
  const lastMonthEnd = thisMonthStart.getTime() - 1;
  const lastMonthStart = new Date(thisMonthStart); lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);
  const thisMonthRevenue = completedJobs
    .filter(j => j.completedAt && j.completedAt >= thisMonthStart.getTime())
    .reduce((a, j) => a + (j.quoteAmount ?? 0), 0);
  const lastMonthRevenue = completedJobs
    .filter(j => j.completedAt && j.completedAt >= lastMonthStart.getTime() && j.completedAt <= lastMonthEnd)
    .reduce((a, j) => a + (j.quoteAmount ?? 0), 0);
  // Only fire if we're past the 7th of the month (enough data to compare)
  const dayOfMonth = new Date().getDate();
  if (dayOfMonth >= 7 && lastMonthRevenue > 500 && thisMonthRevenue < lastMonthRevenue * 0.6) {
    const dropPct = Math.round(((lastMonthRevenue - thisMonthRevenue) / lastMonthRevenue) * 100);
    insights.push({
      id: 'revenue_drop',
      type: 'revenue_drop',
      severity: dropPct > 50 ? 'critical' : 'warning',
      title: `Revenue is down ${dropPct}% vs last month`,
      body: `This month: ${fmtMoney(thisMonthRevenue)} completed. Last month: ${fmtMoney(lastMonthRevenue)}. Possible causes: fewer jobs, longer cycle times, or lost customers.`,
      action: 'View Reports',
      actionView: 'admin-reports',
      metadata: { thisMonthRevenue, lastMonthRevenue, dropPct },
    });
  }

  // ─── 5. STALE JOBS (deep stale — 5+ days, escalation of the 48h banner) ───
  const STALE_MS = 5 * 24 * 3600000; // 5 days
  const lastLogMs = new Map<string, number>();
  allLogs.forEach(l => {
    if (l.endTime && l.endTime > (lastLogMs.get(l.jobId) || 0)) lastLogMs.set(l.jobId, l.endTime);
  });
  const openJobs5d = jobs.filter(j => j.status !== 'completed' && j.status !== 'hold');
  const staleJobs = openJobs5d.filter(j => {
    const last = lastLogMs.get(j.id) || j.createdAt;
    return (now - last) > STALE_MS;
  });
  if (staleJobs.length > 0) {
    const worst = staleJobs.sort((a, b) => {
      const aLast = lastLogMs.get(a.id) || a.createdAt;
      const bLast = lastLogMs.get(b.id) || b.createdAt;
      return aLast - bLast; // oldest first
    })[0];
    const worstDays = Math.floor((now - (lastLogMs.get(worst.id) || worst.createdAt)) / 86400000);
    insights.push({
      id: 'stale_jobs',
      type: 'stale_job',
      severity: staleJobs.length >= 3 ? 'critical' : 'warning',
      title: `${staleJobs.length} job${staleJobs.length > 1 ? 's' : ''} haven't been touched in 5+ days`,
      body: `"${worst.poNumber}" is the oldest — no activity for ${worstDays} days.${worst.dueDate ? ` It's due ${worst.dueDate}.` : ''} These jobs may be forgotten or blocked.`,
      action: 'View Jobs',
      actionView: 'admin-jobs',
      metadata: { count: staleJobs.length, worstJobId: worst.id, worstDays },
    });
  }

  // ─── 6. GREAT CUSTOMER (positive) ────────────────────────
  // The customer generating the best margins — positive reinforcement
  if (completedJobs.length >= 5) {
    let bestCust: { name: string; profit: number; margin: number; runs: number } | null = null;
    byCust.forEach((custJobs, customer) => {
      if (custJobs.length < 2) return;
      const profits = custJobs.map(j => {
        if (j.profitSnapshot) return { profit: j.profitSnapshot.profit, margin: j.profitSnapshot.marginPct };
        const b = calcJobProfit(j, allLogs, users, settings, allPOs);
        return { profit: b.profit, margin: b.marginPct };
      });
      const totalProfit = profits.reduce((a, p) => a + p.profit, 0);
      const avgMargin = profits.reduce((a, p) => a + p.margin, 0) / profits.length;
      if (avgMargin >= 30 && totalProfit > 0) {
        if (!bestCust || totalProfit > bestCust.profit) {
          bestCust = { name: customer, profit: totalProfit, margin: avgMargin, runs: custJobs.length };
        }
      }
    });
    if (bestCust) {
      const bc = bestCust as { name: string; profit: number; margin: number; runs: number };
      insights.push({
        id: `great_customer_${bc.name.replace(/\W+/g, '_')}`,
        type: 'great_customer',
        severity: 'positive',
        title: `${bc.name} is your best customer`,
        body: `${bc.runs} jobs at avg ${bc.margin.toFixed(0)}% margin, ${fmtMoney(bc.profit)} total profit. Do more work for them — they're worth it.`,
        metadata: { customer: bc.name, totalProfit: bc.profit, avgMargin: bc.margin, runs: bc.runs },
      });
    }
  }

  // ─── 7. WORKER ANOMALY ────────────────────────────────────
  // A worker's recent jobs are taking significantly longer than their own baseline
  if (users.length > 0 && completedJobs.length >= 10) {
    const thirtyDaysAgo = now - 30 * 86400000;
    const sixtyDaysAgo  = now - 60 * 86400000;

    for (const worker of users) {
      if (worker.role === 'admin') continue;
      // baseline = 30–60 days ago logs
      const baseLogs = allLogs.filter(l =>
        l.userId === worker.id && l.endTime &&
        l.endTime >= sixtyDaysAgo && l.endTime < thirtyDaysAgo && !l.isSample
      );
      const recentLogs = allLogs.filter(l =>
        l.userId === worker.id && l.endTime &&
        l.endTime >= thirtyDaysAgo && !l.isSample
      );
      if (baseLogs.length < 5 || recentLogs.length < 5) continue;

      const avgMins = (ls: TimeLog[]) => {
        const total = ls.reduce((a, l) => {
          if (l.durationSeconds != null && l.durationSeconds >= 0) return a + l.durationSeconds / 60;
          return a + (l.durationMinutes || 0);
        }, 0);
        return total / ls.length;
      };

      const baseAvg   = avgMins(baseLogs);
      const recentAvg = avgMins(recentLogs);

      if (baseAvg > 0 && recentAvg > baseAvg * 1.5 && recentAvg - baseAvg > 30) {
        const pctIncrease = Math.round(((recentAvg - baseAvg) / baseAvg) * 100);
        insights.push({
          id: `worker_anomaly_${worker.id}`,
          type: 'worker_anomaly',
          severity: 'warning',
          title: `${worker.name}'s sessions are running ${pctIncrease}% longer lately`,
          body: `Avg session: ${Math.round(recentAvg)}min (past 30 days) vs ${Math.round(baseAvg)}min (30–60 days ago). Could be harder jobs, distractions, or a training opportunity.`,
          action: 'View Live',
          actionView: 'admin-live',
          metadata: { userId: worker.id, workerName: worker.name, baseAvg, recentAvg, pctIncrease },
        });
      }
    }
  }

  // ─── 8. QUOTE GAP ────────────────────────────────────────
  // Many open jobs without a quote — you can't track profitability
  const noQuoteOpen = jobs.filter(j => j.status !== 'completed' && !(j.quoteAmount && j.quoteAmount > 0));
  if (noQuoteOpen.length >= 3) {
    insights.push({
      id: 'quote_gap',
      type: 'quote_gap',
      severity: noQuoteOpen.length >= 6 ? 'warning' : 'info',
      title: `${noQuoteOpen.length} open jobs have no quote amount`,
      body: `Without a quote you can't track margins or profitability. Add quote amounts to jobs so the Shop Brain can help you spot problems early.`,
      action: 'View Jobs',
      actionView: 'admin-jobs',
      metadata: { count: noQuoteOpen.length },
    });
  }

  // ─── 9. HERO PART (positive) ─────────────────────────────
  // A part number with ≥3 runs and consistently great margins
  byPart.forEach((partJobs, pn) => {
    if (partJobs.length < 3) return;
    const margins = partJobs.map(j => {
      if (j.profitSnapshot) return j.profitSnapshot.marginPct;
      const b = calcJobProfit(j, allLogs, users, settings, allPOs);
      return b.marginPct;
    });
    const avgMargin = margins.reduce((a, m) => a + m, 0) / margins.length;
    const greatRuns = margins.filter(m => m >= 35).length;
    if (avgMargin >= 35 && greatRuns >= 3) {
      const displayPn = partJobs[0].partNumber || pn;
      const totalProfit = partJobs.reduce((a, j) => {
        if (j.profitSnapshot) return a + j.profitSnapshot.profit;
        const b = calcJobProfit(j, allLogs, users, settings, allPOs);
        return a + b.profit;
      }, 0);
      insights.push({
        id: `hero_part_${pn}`,
        type: 'hero_part',
        severity: 'positive',
        title: `Part "${displayPn}" is a winner`,
        body: `${partJobs.length} runs at avg ${avgMargin.toFixed(0)}% margin, ${fmtMoney(totalProfit)} total profit. Chase more of this work.`,
        metadata: { partNumber: displayPn, runs: partJobs.length, avgMargin, totalProfit },
      });
    }
  });

  // ─── Sort: critical → warning → info → positive ────────
  const order: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2, positive: 3 };
  insights.sort((a, b) => order[a.severity] - order[b.severity]);

  return insights;
}
