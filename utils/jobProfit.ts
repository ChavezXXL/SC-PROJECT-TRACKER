/**
 * jobProfit.ts — Single source of truth for job profitability.
 *
 * Accounts for:
 *   • Labor cost  — actual hours × per-worker rate (falls back to shopRate)
 *   • Overhead    — monthlyOverhead ÷ monthlyWorkHours, applied per labor-hour
 *   • Materials   — job.materialCost (admin-entered at close-out)
 *   • Outsourcing — sum of PO totals linked to this job
 *
 * Returns a locked snapshot object ready to be written to Firestore.
 */

import type { Job, TimeLog, User, SystemSettings, PurchaseOrder } from '../types';

export interface JobProfitBreakdown {
  revenue:        number;
  laborCost:      number;
  materialCost:   number;
  outsourcedCost: number;
  totalCost:      number;
  profit:         number;
  marginPct:      number;   // 0-100 (can be negative)
  laborHours:     number;
  revenuePerHour: number;
  grade:          'great' | 'good' | 'tight' | 'loss';
  // Per-worker breakdown for the tooltip
  workerLines: { name: string; hours: number; cost: number }[];
}

/** Margin thresholds — tweak to match your shop's expectations */
const GRADE_GREAT  = 35;   // ≥ 35% margin
const GRADE_GOOD   = 15;   // ≥ 15%
const GRADE_TIGHT  = 0;    // ≥ 0% (making money, barely)
                           // < 0% → loss

function grade(marginPct: number): JobProfitBreakdown['grade'] {
  if (marginPct >= GRADE_GREAT) return 'great';
  if (marginPct >= GRADE_GOOD)  return 'good';
  if (marginPct >= GRADE_TIGHT) return 'tight';
  return 'loss';
}

/**
 * Calculate the full profit breakdown for a job.
 * Pass all time logs (completed + in-progress) — function filters by jobId.
 */
export function calcJobProfit(
  job:      Job,
  allLogs:  TimeLog[],
  allUsers: User[],
  settings: SystemSettings,
  allPOs:   PurchaseOrder[],
): JobProfitBreakdown {
  const shopRate   = settings.shopRate        ?? 0;
  const ohMonthly  = settings.monthlyOverhead ?? 0;
  // Floor the divisor at 1 so a 0 / blank / NaN monthlyWorkHours can't make
  // ohPerHour Infinity and turn labor cost / margin into Infinity/NaN.
  const ohHours    = Math.max(1, Number(settings.monthlyWorkHours) || 160);
  const ohPerHour  = ohMonthly > 0 ? ohMonthly / ohHours : 0;

  // Build userId → rate map
  const rateMap = new Map<string, number>();
  for (const u of allUsers) {
    rateMap.set(u.id, (u as any).hourlyRate ?? shopRate);
  }

  // Aggregate labor by worker
  const jobLogs = allLogs.filter(l => l.jobId === job.id && !l.isSample);
  const workerHours = new Map<string, { name: string; minutes: number }>();
  for (const log of jobLogs) {
    // Seconds-first (matches shopIntelligence, partHistory, sendDailyRecap) so
    // labor cost here agrees with every other report instead of compounding the
    // per-session round-up that durationMinutes-only produced.
    const mins = log.durationSeconds != null && log.durationSeconds >= 0
      ? log.durationSeconds / 60
      : (log.durationMinutes || 0);
    if (mins <= 0) continue;
    const existing = workerHours.get(log.userId) ?? { name: log.userName || log.userId, minutes: 0 };
    existing.minutes += mins;
    workerHours.set(log.userId, existing);
  }

  let laborCost  = 0;
  let laborHours = 0;
  const workerLines: JobProfitBreakdown['workerLines'] = [];

  for (const [uid, { name, minutes }] of workerHours) {
    const hrs  = minutes / 60;
    const rate = rateMap.get(uid) ?? shopRate;
    const cost = hrs * (rate + ohPerHour);
    laborCost  += cost;
    laborHours += hrs;
    workerLines.push({ name, hours: hrs, cost });
  }

  const materialCost   = job.materialCost ?? 0;
  const outsourcedCost = allPOs
    .filter(po => po.linkedJobIds?.includes(job.id))
    .reduce((sum, po) => sum + (po.total ?? 0), 0);

  const revenue   = job.quoteAmount ?? 0;
  const totalCost = laborCost + materialCost + outsourcedCost;
  const profit    = revenue - totalCost;
  const marginPct = revenue > 0 ? (profit / revenue) * 100 : (profit < 0 ? -100 : 0);
  const revenuePerHour = laborHours > 0 ? revenue / laborHours : 0;

  return {
    revenue, laborCost, materialCost, outsourcedCost,
    totalCost, profit, marginPct, laborHours, revenuePerHour,
    grade: grade(marginPct),
    workerLines,
  };
}

/**
 * Build the immutable snapshot to write to job.profitSnapshot on completion.
 */
export function buildProfitSnapshot(
  breakdown: JobProfitBreakdown,
): NonNullable<Job['profitSnapshot']> {
  return {
    revenue:        breakdown.revenue,
    laborCost:      breakdown.laborCost,
    materialCost:   breakdown.materialCost,
    outsourcedCost: breakdown.outsourcedCost,
    totalCost:      breakdown.totalCost,
    profit:         breakdown.profit,
    marginPct:      breakdown.marginPct,
    laborHours:     breakdown.laborHours,
    snappedAt:      Date.now(),
  };
}

/** Format a dollar amount. */
export function fmtDollar(n: number): string {
  const abs = Math.abs(n);
  const str = abs >= 1000
    ? `$${(abs / 1000).toFixed(1)}k`
    : `$${abs.toFixed(0)}`;
  return n < 0 ? `-${str}` : str;
}

/** Grade → Tailwind colour classes */
export const GRADE_COLORS = {
  great: { bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', text: 'text-emerald-400', badge: 'bg-emerald-500/20 text-emerald-300' },
  good:  { bg: 'bg-blue-500/15',    border: 'border-blue-500/30',    text: 'text-blue-400',    badge: 'bg-blue-500/20 text-blue-300'       },
  tight: { bg: 'bg-yellow-500/15',  border: 'border-yellow-500/30',  text: 'text-yellow-400',  badge: 'bg-yellow-500/20 text-yellow-300'   },
  loss:  { bg: 'bg-red-500/15',     border: 'border-red-500/30',     text: 'text-red-400',     badge: 'bg-red-500/20 text-red-300'         },
} as const;

export const GRADE_LABELS = {
  great: '🟢 Great',
  good:  '🔵 Good',
  tight: '🟡 Tight',
  loss:  '🔴 Loss',
} as const;
