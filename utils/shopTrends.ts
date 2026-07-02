/**
 * shopTrends.ts — the Shop Brain's MEMORY.
 * ─────────────────────────────────────────────────────────────────────────
 * Everything else in the brain looks at a snapshot ("this job is over
 * budget"). This module looks at DIRECTION: it buckets the shop's history
 * into Mon–Sun weeks and compares the last complete week against the
 * average of the prior weeks, so the owner sees "revenue is up 18% and
 * on-time slipped 9 points" instead of raw numbers.
 *
 * Pure functions only — no React, no Firebase — safe to unit-test and to
 * import from the Netlify weekly-digest cron (type-only deps, like
 * poOrganizer).
 */

import type { Job, TimeLog, ReworkEntry } from '../types';

const WEEK_MS = 7 * 86400000;

/** Monday 00:00 (local time) on/before the given ms. */
export function weekStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();                 // 0=Sun … 6=Sat
  const back = dow === 0 ? 6 : dow - 1;   // Monday-based week
  return d.getTime() - back * 86400000;
}

/** MM/DD/YYYY → comparable yyyymmdd number (0 = unparseable). */
function dueNum(due?: string): number {
  const m = (due || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return 0;
  const mo = +m[1], da = +m[2];
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return 0;
  return (+m[3]) * 10000 + mo * 100 + da;
}
function msToYmd(ms: number): number {
  const d = new Date(ms);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

const logMins = (l: TimeLog): number =>
  l.durationSeconds != null && l.durationSeconds >= 0
    ? l.durationSeconds / 60
    : (l.durationMinutes || 0);

export interface WeekBucket {
  startMs: number;          // Monday 00:00
  revenue: number;          // $ of jobs completed this week
  jobsCompleted: number;
  laborHours: number;       // real (non-sample) logged hours
  onTimeDone: number;       // completed jobs w/ dueDate that shipped on time
  dueDone: number;          // completed jobs w/ a parseable dueDate
  marginSum: number;        // Σ marginPct over jobs with a profitSnapshot
  marginCount: number;
  reworkCount: number;
}

export type TrendDirection = 'up' | 'down' | 'flat';

export interface TrendMetric {
  key: string;
  label: string;
  /** Last complete week's value. */
  current: number;
  /** Average of the baseline weeks before it. */
  baseline: number;
  /** % change vs baseline (null when baseline ≈ 0 — no meaningful compare). */
  deltaPct: number | null;
  direction: TrendDirection;
  /** Is this movement good news? (revenue up = yes, rework up = no) */
  good: boolean | null;
  /** 'money' | 'hours' | 'pct' | 'count' — how to format. */
  unit: 'money' | 'hours' | 'pct' | 'count';
  /** Oldest→newest weekly values, for sparklines (baseline weeks + current). */
  series: number[];
}

export interface CustomerMover {
  customer: string;
  current: number;          // last-week revenue $
  baseline: number;         // avg weekly revenue over baseline weeks
  deltaPct: number | null;
}

export interface ShopTrends {
  hasData: boolean;         // false until ≥2 complete weeks have activity
  weeks: WeekBucket[];      // oldest → newest COMPLETE weeks (excludes current)
  metrics: TrendMetric[];   // ranked: biggest movers first
  risingCustomers: CustomerMover[];
  fallingCustomers: CustomerMover[];
  /** Current (partial) week so far — context, never compared. */
  thisWeek: { revenue: number; laborHours: number; jobsCompleted: number };
}

function direction(deltaPct: number | null, flatBandPct = 5): TrendDirection {
  if (deltaPct === null) return 'flat';
  if (deltaPct > flatBandPct) return 'up';
  if (deltaPct < -flatBandPct) return 'down';
  return 'flat';
}

/**
 * Compute week-over-week trends. `weeksBack` = complete weeks to consider
 * (last one is "current", the rest form the baseline average).
 */
export function computeShopTrends(
  jobs: Job[],
  logs: TimeLog[],
  rework: ReworkEntry[] = [],
  now: number = Date.now(),
  weeksBack = 5,
): ShopTrends {
  const thisWeekStart = weekStart(now);
  const firstStart = thisWeekStart - weeksBack * WEEK_MS;

  // ── Bucket the complete weeks ──────────────────────────────────────────
  const buckets: WeekBucket[] = Array.from({ length: weeksBack }, (_, i) => ({
    startMs: firstStart + i * WEEK_MS,
    revenue: 0, jobsCompleted: 0, laborHours: 0,
    onTimeDone: 0, dueDone: 0, marginSum: 0, marginCount: 0, reworkCount: 0,
  }));
  const bucketFor = (ms?: number): WeekBucket | null => {
    if (!ms || ms < firstStart || ms >= thisWeekStart) return null;
    return buckets[Math.floor((ms - firstStart) / WEEK_MS)] || null;
  };

  const thisWeek = { revenue: 0, laborHours: 0, jobsCompleted: 0 };

  for (const j of jobs) {
    if (j.status !== 'completed' || !j.completedAt) continue;
    const rev = j.profitSnapshot?.revenue ?? (j.quoteAmount || 0);
    if (j.completedAt >= thisWeekStart) {
      if (j.completedAt <= now) { thisWeek.revenue += rev; thisWeek.jobsCompleted++; }
      continue;
    }
    const b = bucketFor(j.completedAt);
    if (!b) continue;
    b.revenue += rev;
    b.jobsCompleted++;
    const due = dueNum(j.dueDate);
    if (due > 0) {
      b.dueDone++;
      if (msToYmd(j.completedAt) <= due) b.onTimeDone++;
    }
    if (j.profitSnapshot && Number.isFinite(j.profitSnapshot.marginPct)) {
      b.marginSum += j.profitSnapshot.marginPct;
      b.marginCount++;
    }
  }

  for (const l of logs) {
    if (!l.endTime || l.isSample) continue;
    if (l.endTime >= thisWeekStart) { thisWeek.laborHours += logMins(l) / 60; continue; }
    const b = bucketFor(l.endTime);
    if (b) b.laborHours += logMins(l) / 60;
  }

  for (const r of rework) {
    const ts = (r as any).timestamp || (r as any).createdAt || 0;
    const b = bucketFor(ts);
    if (b) b.reworkCount++;
  }

  // Need at least 2 complete weeks with any activity for a meaningful trend.
  const activeWeeks = buckets.filter(b => b.revenue > 0 || b.laborHours > 0 || b.jobsCompleted > 0);
  const hasData = activeWeeks.length >= 2 &&
    (buckets[buckets.length - 1].revenue > 0 || buckets[buckets.length - 1].laborHours > 0 || buckets[buckets.length - 1].jobsCompleted > 0);

  const cur = buckets[buckets.length - 1];
  const base = buckets.slice(0, -1);
  // Baseline averages ignore fully-dead weeks (shop closed / pre-history) so
  // one vacation week doesn't fake a "revenue doubled!" trend.
  const liveBase = base.filter(b => b.revenue > 0 || b.laborHours > 0 || b.jobsCompleted > 0);
  const nBase = Math.max(1, liveBase.length);
  const avg = (f: (b: WeekBucket) => number) => liveBase.reduce((a, b) => a + f(b), 0) / nBase;

  const pct = (curV: number, baseV: number): number | null =>
    baseV > 0.0001 ? ((curV - baseV) / baseV) * 100 : (curV > 0 ? null : 0);

  const onTimeRate = (b: WeekBucket) => (b.dueDone > 0 ? (b.onTimeDone / b.dueDone) * 100 : NaN);
  const marginAvg = (b: WeekBucket) => (b.marginCount > 0 ? b.marginSum / b.marginCount : NaN);

  const mk = (
    key: string, label: string, unit: TrendMetric['unit'],
    curV: number, baseV: number, upIsGood: boolean | null,
    series: number[], usePointDelta = false,
  ): TrendMetric => {
    // Rates (%) compare in POINTS, not relative % (92% → 80% is “−12 pts”).
    const deltaPct = usePointDelta
      ? (Number.isFinite(curV) && Number.isFinite(baseV) ? curV - baseV : null)
      : pct(curV, baseV);
    const dir = direction(deltaPct, usePointDelta ? 3 : 5);
    return {
      key, label, unit,
      current: Number.isFinite(curV) ? curV : 0,
      baseline: Number.isFinite(baseV) ? baseV : 0,
      deltaPct, direction: dir,
      good: dir === 'flat' || upIsGood === null ? null : (dir === 'up') === upIsGood,
      series,
    };
  };

  const metrics: TrendMetric[] = [
    mk('revenue', 'Revenue / wk', 'money', cur.revenue, avg(b => b.revenue), true, buckets.map(b => b.revenue)),
    mk('hours', 'Labor hours / wk', 'hours', cur.laborHours, avg(b => b.laborHours), null, buckets.map(b => b.laborHours)),
    mk('jobs', 'Jobs shipped / wk', 'count', cur.jobsCompleted, avg(b => b.jobsCompleted), true, buckets.map(b => b.jobsCompleted)),
    mk('ontime', 'On-time rate', 'pct', onTimeRate(cur), avg(b => (Number.isFinite(onTimeRate(b)) ? onTimeRate(b) : 0)), true, buckets.map(b => (Number.isFinite(onTimeRate(b)) ? onTimeRate(b) : 0)), true),
    mk('margin', 'Avg margin', 'pct', marginAvg(cur), avg(b => (Number.isFinite(marginAvg(b)) ? marginAvg(b) : 0)), true, buckets.map(b => (Number.isFinite(marginAvg(b)) ? marginAvg(b) : 0)), true),
    mk('rework', 'Rework / wk', 'count', cur.reworkCount, avg(b => b.reworkCount), false, buckets.map(b => b.reworkCount)),
  ];
  // Biggest movement first; flat metrics sink.
  metrics.sort((a, b) => Math.abs(b.deltaPct ?? 0) - Math.abs(a.deltaPct ?? 0));

  // ── Customer movers (revenue last week vs baseline avg) ────────────────
  const custWeek = new Map<string, number[]>(); // customer → per-week revenue
  for (const j of jobs) {
    if (j.status !== 'completed' || !j.completedAt) continue;
    const b = bucketFor(j.completedAt);
    if (!b) continue;
    const c = (j.customer || '').trim();
    if (!c) continue;
    const idx = Math.floor((j.completedAt - firstStart) / WEEK_MS);
    const arr = custWeek.get(c) || new Array(weeksBack).fill(0);
    arr[idx] += j.profitSnapshot?.revenue ?? (j.quoteAmount || 0);
    custWeek.set(c, arr);
  }
  const movers: CustomerMover[] = [];
  custWeek.forEach((arr, customer) => {
    const c = arr[arr.length - 1];
    const bAvg = arr.slice(0, -1).reduce((a, v) => a + v, 0) / Math.max(1, arr.length - 1);
    if (c < 50 && bAvg < 50) return;                 // noise floor
    movers.push({ customer, current: c, baseline: bAvg, deltaPct: pct(c, bAvg) });
  });
  const rising = movers.filter(m => (m.deltaPct ?? (m.current > 0 ? 999 : 0)) > 20)
    .sort((a, b) => (b.current - b.baseline) - (a.current - a.baseline)).slice(0, 3);
  const falling = movers.filter(m => m.deltaPct !== null && m.deltaPct < -20)
    .sort((a, b) => (a.current - a.baseline) - (b.current - b.baseline)).slice(0, 3);

  return { hasData, weeks: buckets, metrics, risingCustomers: rising, fallingCustomers: falling, thisWeek };
}

/** "$4.2k" / "37.5h" / "92%" / "14" */
export function fmtTrendValue(v: number, unit: TrendMetric['unit']): string {
  if (unit === 'money') return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`;
  if (unit === 'hours') return `${v >= 100 ? Math.round(v) : v.toFixed(1)}h`;
  if (unit === 'pct') return `${Math.round(v)}%`;
  return `${Math.round(v)}`;
}

/** "+18%" / "−12 pts" / "—" */
export function fmtTrendDelta(m: TrendMetric): string {
  if (m.deltaPct === null) return 'new';
  const pts = m.unit === 'pct';
  const v = Math.round(Math.abs(m.deltaPct));
  if (v === 0) return '±0';
  return `${m.deltaPct > 0 ? '+' : '−'}${v}${pts ? ' pts' : '%'}`;
}
