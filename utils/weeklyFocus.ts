/**
 * weeklyFocus.ts — "what should the owner do this week?"
 * ─────────────────────────────────────────────────────────────────────────
 * One pure function that reads the shop's already-computed brains and returns
 * a short, ranked list of the few things that actually move money this week.
 * Shared by the full Weekly Owner Report and the dashboard's focus strip so
 * the two can never say different things.
 *
 * No React, no Firebase — takes brain results in, returns plain data out.
 */
import type { ShopTrends } from './shopTrends';
import type { CustomerIntel } from './customerIntel';
import type { PriceDoctorResult } from './priceDoctor';
import type { TimekeepingHealth } from './timekeepingHealth';
import type { ShopAction } from '../types';
import { fmtMoneyK } from './format';

export type FocusTone = 'red' | 'amber' | 'emerald';
export type FocusIcon =
  | 'revenue-down' | 'concentration' | 'quiet' | 'money' | 'health' | 'actions' | 'rework' | 'all-clear';

export interface FocusItem {
  /** Stable-ish key for React lists. */
  key: string;
  icon: FocusIcon;
  tone: FocusTone;
  /** Higher = more urgent; list is returned already sorted desc. */
  weight: number;
  text: string;
}

export interface FocusInput {
  trends: ShopTrends;
  intel: CustomerIntel;
  doctor: PriceDoctorResult;
  health: TimekeepingHealth;
  openActions: ShopAction[];
  now: number;
}

const isOverdue = (a: ShopAction, todayYmd: number): boolean => {
  const m = (a.dueDate || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return !!m && (+m[3] * 10000 + +m[1] * 100 + +m[2]) < todayYmd;
};

/**
 * Synthesize the week's focus list. Returns [] only when there is genuinely
 * no data; otherwise always returns at least the "all clear" item so the UI
 * has something honest to show.
 */
export function computeWeeklyFocus(input: FocusInput): FocusItem[] {
  const { trends, intel, doctor, health, openActions, now } = input;
  const out: FocusItem[] = [];

  const rev = trends.metrics.find(m => m.key === 'revenue');
  if (rev && rev.deltaPct !== null && rev.deltaPct <= -10) {
    out.push({
      key: 'revenue', icon: 'revenue-down', tone: rev.deltaPct <= -25 ? 'red' : 'amber',
      weight: 90 + Math.min(9, Math.abs(rev.deltaPct) / 5),
      text: `Revenue is down ${Math.abs(rev.deltaPct).toFixed(0)}% vs your recent average — line up work to refill the week.`,
    });
  }

  if (intel.topSharePct !== null && intel.topSharePct >= 40 && intel.topShareName) {
    out.push({
      key: 'concentration', icon: 'concentration', tone: intel.topSharePct >= 60 ? 'red' : 'amber',
      weight: intel.topSharePct >= 60 ? 85 : 70,
      text: `${intel.topShareName} is ${intel.topSharePct.toFixed(0)}% of revenue — one customer. Pull work from a second account to de-risk.`,
    });
  }

  for (const p of intel.profiles.filter(p => p.goingQuiet).slice(0, 4)) {
    out.push({
      key: `quiet-${p.key}`, icon: 'quiet', tone: 'amber',
      weight: 60 + Math.min(15, p.daysQuiet / 4),
      text: `${p.name} has gone quiet (${p.daysQuiet}d). A quick check-in call often re-opens the tap.`,
    });
  }

  if (doctor.totalLeft90d > 500) {
    const n = doctor.parts.filter(p => p.verdict === 'underpriced' || p.verdict === 'thin').length;
    out.push({
      key: 'pricing', icon: 'money', tone: 'amber',
      weight: 50 + Math.min(20, doctor.totalLeft90d / 1000),
      text: `~${fmtMoneyK(doctor.totalLeft90d)} left on the table over 90 days from underpriced parts — requote the top ${Math.min(n, 3)}.`,
    });
  }

  if (health.criticalCount > 0) {
    out.push({
      key: 'health', icon: 'health', tone: 'red', weight: 75,
      text: `${health.criticalCount} timekeeping issue${health.criticalCount > 1 ? 's' : ''} ${health.criticalCount > 1 ? 'need' : 'needs'} a look — your labor numbers depend on clean clock data.`,
    });
  }

  const t = new Date(now);
  const todayYmd = t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate();
  const overdue = openActions.filter(a => isOverdue(a, todayYmd)).length;
  if (overdue > 0) {
    out.push({
      key: 'actions', icon: 'actions', tone: 'red', weight: 65,
      text: `${overdue} action${overdue > 1 ? 's are' : ' is'} overdue on your list — close them or move the date.`,
    });
  }

  const rework = trends.metrics.find(m => m.key === 'rework');
  if (rework && rework.current > 0 && rework.deltaPct !== null && rework.deltaPct >= 25) {
    out.push({
      key: 'rework', icon: 'rework', tone: 'amber', weight: 55,
      text: `Rework is up ${rework.deltaPct.toFixed(0)}% — check the parts bouncing back before they eat the margin.`,
    });
  }

  out.sort((a, b) => b.weight - a.weight);

  if (out.length === 0) {
    out.push({
      key: 'all-clear', icon: 'all-clear', tone: 'emerald', weight: 0,
      text: 'No red flags this week — revenue steady, one-customer risk in check, pricing healthy. Keep the pipeline full.',
    });
  }
  return out;
}
