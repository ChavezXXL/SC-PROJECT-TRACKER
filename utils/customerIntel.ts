/**
 * customerIntel.ts — per-customer intelligence.
 * ─────────────────────────────────────────────────────────────────────────
 * "Your lowest-cost growth is inside customers already buying." This module
 * turns raw jobs/logs into a per-customer profile the owner can act on:
 * revenue trend, parts run, on-time rate, margin, recency ("going quiet"),
 * and shop-level concentration risk (how dependent revenue is on one shop).
 *
 * Pure functions — no React, no Firebase. Shares conventions with
 * shopTrends.ts / poOrganizer.ts so the cron can import it too.
 */

import type { Job, TimeLog } from '../types';
import { customerKey } from './customers';

const WEEK_MS = 7 * 86400000;

const dueNum = (due?: string): number => {
  const m = (due || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return 0;
  const mo = +m[1], da = +m[2];
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return 0;
  return (+m[3]) * 10000 + mo * 100 + da;
};
const msYmd = (ms: number): number => {
  const d = new Date(ms);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
};
const logMins = (l: TimeLog): number =>
  l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0);

export interface CustomerProfile {
  key: string;                // normalized key
  name: string;               // display name (first-seen casing)
  // Money
  revenue90d: number;         // completed revenue, last 90 days
  revenueAll: number;         // completed revenue, all time
  sharePct: number;           // % of shop's 90d revenue (concentration)
  avgMarginPct: number | null;// avg profitSnapshot margin (quoted+snapshotted jobs)
  // Volume
  jobsOpen: number;
  jobsCompleted90d: number;
  jobsCompletedAll: number;
  parts: string[];            // distinct part numbers (most recent first, cap 12)
  laborHours90d: number;
  // Reliability
  onTimeRate: number | null;  // % of completed-with-due jobs shipped on time (all time)
  lateCount: number;
  // Recency
  lastActivity: number;       // last completedAt / log end / job createdAt
  daysQuiet: number;          // days since lastActivity
  goingQuiet: boolean;        // had regular work, now silent ≥ 21 days
  // Trend: weekly completed revenue, oldest → newest (8 weeks)
  weeklyRevenue: number[];
}

export interface CustomerIntel {
  profiles: CustomerProfile[];        // ranked by revenue90d desc
  totalRevenue90d: number;
  /** Top customer's share of 90d revenue — concentration risk. */
  topSharePct: number | null;
  topShareName: string | null;
}

export function computeCustomerIntel(
  jobs: Job[],
  logs: TimeLog[],
  now: number = Date.now(),
): CustomerIntel {
  const d90 = now - 90 * 86400000;
  const weeks = 8;
  const weekStart0 = now - weeks * WEEK_MS;

  type Acc = {
    name: string;
    revenue90d: number; revenueAll: number;
    marginSum: number; marginCount: number;
    jobsOpen: number; jobsCompleted90d: number; jobsCompletedAll: number;
    onTimeDone: number; dueDone: number;
    lastActivity: number;
    parts: Map<string, number>;       // part → last-seen ts
    weekly: number[];
    jobIds: Set<string>;
    firstActivity: number;
  };
  const acc = new Map<string, Acc>();
  const get = (rawName: string): Acc => {
    const key = customerKey(rawName) || rawName.trim().toLowerCase();
    let a = acc.get(key);
    if (!a) {
      a = {
        name: rawName.trim(),
        revenue90d: 0, revenueAll: 0, marginSum: 0, marginCount: 0,
        jobsOpen: 0, jobsCompleted90d: 0, jobsCompletedAll: 0,
        onTimeDone: 0, dueDone: 0, lastActivity: 0,
        parts: new Map(), weekly: new Array(weeks).fill(0),
        jobIds: new Set(), firstActivity: Number.MAX_SAFE_INTEGER,
      };
      acc.set(key, a);
    }
    return a;
  };

  for (const j of jobs) {
    const c = (j.customer || '').trim();
    if (!c) continue;
    const a = get(c);
    a.jobIds.add(j.id);
    const ts = j.completedAt || j.createdAt || 0;
    if (ts > a.lastActivity) a.lastActivity = ts;
    if (j.createdAt && j.createdAt < a.firstActivity) a.firstActivity = j.createdAt;
    if (j.partNumber?.trim()) {
      const p = j.partNumber.trim();
      if (ts > (a.parts.get(p) || 0)) a.parts.set(p, ts);
    }

    if (j.status === 'completed' && j.completedAt) {
      const rev = j.profitSnapshot?.revenue ?? (j.quoteAmount || 0);
      a.revenueAll += rev;
      a.jobsCompletedAll++;
      if (j.completedAt >= d90) { a.revenue90d += rev; a.jobsCompleted90d++; }
      const wi = Math.floor((j.completedAt - weekStart0) / WEEK_MS);
      if (wi >= 0 && wi < weeks) a.weekly[wi] += rev;
      const due = dueNum(j.dueDate);
      if (due > 0) {
        a.dueDone++;
        if (msYmd(j.completedAt) <= due) a.onTimeDone++;
      }
      if (j.profitSnapshot && Number.isFinite(j.profitSnapshot.marginPct)) {
        a.marginSum += j.profitSnapshot.marginPct;
        a.marginCount++;
      }
    } else if (j.status !== 'completed') {
      a.jobsOpen++;
    }
  }

  // Labor hours + activity recency from logs (a customer with an active timer
  // today is NOT quiet even if nothing completed lately).
  const hours90 = new Map<string, number>();   // jobId → mins (then joined via job)
  const jobById = new Map(jobs.map(j => [j.id, j]));
  for (const l of logs) {
    if (l.isSample) continue;
    const j = jobById.get(l.jobId);
    const c = (l.customer || j?.customer || '').trim();
    if (!c) continue;
    const a = get(c);
    const t = l.endTime || l.startTime;
    if (t > a.lastActivity) a.lastActivity = t;
    if (l.endTime && l.endTime >= d90) {
      hours90.set(a.name, (hours90.get(a.name) || 0) + logMins(l));
    }
  }

  const totalRevenue90d = [...acc.values()].reduce((s, a) => s + a.revenue90d, 0);

  const profiles: CustomerProfile[] = [...acc.entries()].map(([key, a]) => {
    const daysQuiet = a.lastActivity > 0 ? Math.floor((now - a.lastActivity) / 86400000) : 9999;
    // "Going quiet": a real customer (≥3 jobs ever) whose history spans more
    // than 6 weeks but who has been silent ≥21 days.
    const tenureMs = a.lastActivity - (a.firstActivity === Number.MAX_SAFE_INTEGER ? a.lastActivity : a.firstActivity);
    const goingQuiet = a.jobsCompletedAll + a.jobsOpen >= 3 && tenureMs > 6 * WEEK_MS && daysQuiet >= 21 && daysQuiet < 9999;
    return {
      key,
      name: a.name,
      revenue90d: a.revenue90d,
      revenueAll: a.revenueAll,
      sharePct: totalRevenue90d > 0 ? (a.revenue90d / totalRevenue90d) * 100 : 0,
      avgMarginPct: a.marginCount > 0 ? a.marginSum / a.marginCount : null,
      jobsOpen: a.jobsOpen,
      jobsCompleted90d: a.jobsCompleted90d,
      jobsCompletedAll: a.jobsCompletedAll,
      parts: [...a.parts.entries()].sort((x, y) => y[1] - x[1]).map(([p]) => p).slice(0, 12),
      laborHours90d: (hours90.get(a.name) || 0) / 60,
      onTimeRate: a.dueDone > 0 ? (a.onTimeDone / a.dueDone) * 100 : null,
      lateCount: a.dueDone - a.onTimeDone,
      lastActivity: a.lastActivity,
      daysQuiet,
      goingQuiet,
      weeklyRevenue: a.weekly,
    };
  }).sort((x, y) => y.revenue90d - x.revenue90d || y.revenueAll - x.revenueAll);

  const top = profiles.find(p => p.revenue90d > 0) || null;
  return {
    profiles,
    totalRevenue90d,
    topSharePct: top && totalRevenue90d > 0 ? top.sharePct : null,
    topShareName: top ? top.name : null,
  };
}
