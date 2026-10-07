/**
 * ONE set of due-date rules for every screen, report, push and the customer
 * portal. Before this, three cutoffs coexisted — noon on the due day, the next
 * morning, and end of day — so the TV called a job "due today" AND "overdue"
 * after lunch, and screens disagreed about the same job.
 *
 * The rules, all compared as whole calendar days (no clock times, so no
 * noon/UTC/off-by-one surprises):
 *   • A job is on time through the END of its due day.
 *   • Overdue  = still open and today is after the due day.
 *   • Due today / due soon (within `soonDays`, default 3) / later.
 *   • Closed jobs (completed, or sitting in a shipped/complete stage) are
 *     never overdue — a shipped job must not show "OVERDUE" to a customer.
 *   • Shipped on time = the day it left the shop ≤ the due day. "Left the
 *     shop" is shippedAt when recorded, otherwise completedAt (the old
 *     behavior, which records when someone clicked Complete).
 *
 * Pure — no React, no Firebase. Server crons pass the shop timezone; the
 * browser defaults to the device clock (shop devices live in the shop).
 */
import type { Job, JobStage } from '../types';

export interface Ymd { y: number; m: number; d: number }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();
const valid = (y: number, m: number, d: number): Ymd | null =>
  y >= 2000 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m) ? { y, m, d } : null;

/**
 * Parse a due date. Accepts MM/DD/YYYY, M/D/YYYY, M/D/YY, YYYY-MM-DD(Thh:mm…),
 * MM-DD-YYYY and "Sep 20, 2026". Range-checked: 13/45/2026 is rejected, not
 * rolled into next year. A month name WITHOUT a year is rejected (the old
 * Date() fallback turned "Sep 20" into 09/20/2001).
 */
export function parseYmd(raw?: string | null): Ymd | null {
  const s = (raw || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return valid(+m[3], +m[1], +m[2]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) return valid(2000 + +m[3], +m[1], +m[2]);
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return valid(+m[3], +m[1], +m[2]);
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    return mi < 0 ? null : valid(+m[3], mi + 1, +m[2]);
  }
  return null;
}

export const ymdNum = (p: Ymd): number => p.y * 10000 + p.m * 100 + p.d;

/** YYYYMMDD of a due-date string, or 0 when missing/unreadable. */
export function dueNum(raw?: string | null): number {
  const p = parseYmd(raw);
  return p ? ymdNum(p) : 0;
}

/** Value for an <input type="date"> ("YYYY-MM-DD"), or '' when missing/unreadable. */
export function toDateInput(raw?: string | null): string {
  const p = parseYmd(raw);
  return p ? `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}` : '';
}

/** Canonical stored form "MM/DD/YYYY", or '' when missing/unreadable. */
export function canonicalDue(raw?: string | null): string {
  const p = parseYmd(raw);
  return p ? `${String(p.m).padStart(2, '0')}/${String(p.d).padStart(2, '0')}/${p.y}` : '';
}

/** The calendar day (YYYYMMDD) an instant falls on — in `tz` if given, else device-local. */
export function dayNum(ms: number, tz?: string): number {
  if (tz) {
    const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(ms)).split('-').map(Number);
    return y * 10000 + m * 100 + d;
  }
  const dt = new Date(ms);
  return dt.getFullYear() * 10000 + (dt.getMonth() + 1) * 100 + dt.getDate();
}

const numToUtc = (n: number) => Date.UTC(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100);
/** Whole calendar days from `fromNum` to `toNum` (both YYYYMMDD). */
export const daysBetween = (fromNum: number, toNum: number): number => Math.round((numToUtc(toNum) - numToUtc(fromNum)) / 86400000);

/** Days until due: 0 = due today, negative = days late, null = no/unreadable due date. */
export function daysUntilDue(raw: string | null | undefined, now: number = Date.now(), tz?: string): number | null {
  const n = dueNum(raw);
  return n ? daysBetween(dayNum(now, tz), n) : null;
}

/** Date at local noon on the due day (calendar placement / display only — never
 *  compare it to "now" for lateness; use dueState/daysUntilDue). */
export function dueDateObj(raw?: string | null): Date | null {
  const p = parseYmd(raw);
  return p ? new Date(p.y, p.m - 1, p.d, 12, 0, 0) : null;
}

/** A stage the job can't be "late" in any more: complete, or a shipped stage. */
export function isClosedStage(stage?: Pick<JobStage, 'id' | 'label' | 'isComplete'> | null): boolean {
  if (!stage) return false;
  return !!stage.isComplete || stage.id === 'shipped' || /^ship(ped)?$/i.test((stage.label || '').trim());
}

// The shop's stage list, registered once from settings (services/mockDb
// subscribeSettings) so every dueState() call recognizes custom "Shipped"
// stages without threading the list through dozens of screens.
let shopStages: JobStage[] | undefined;
export function setShopStages(stages?: JobStage[]): void { shopStages = stages?.length ? stages : undefined; }

/** A not-complete stage that means "shipped": the built-in 'shipped' id, or a
 *  custom stage named "Ship"/"Shipped" (custom ids look like stage_<ts>). */
export function isShippedStageId(stageId: string): boolean {
  if (stageId === 'shipped') return true;
  const s = shopStages?.find(x => x.id === stageId);
  return !!s && !s.isComplete && /^ship(ped)?$/i.test((s.label || '').trim());
}

/** Closed = finished from the customer's point of view: completed, or in a shipped/complete stage. */
export function isJobClosed(job: Pick<Job, 'status' | 'currentStage'>, stages?: JobStage[]): boolean {
  if (job.status === 'completed') return true;
  if (job.currentStage === 'shipped') return true;
  const list = stages ?? shopStages;
  if (job.currentStage && list?.length) return isClosedStage(list.find(s => s.id === job.currentStage));
  return false;
}

export type DueState = 'closed' | 'none' | 'overdue' | 'today' | 'soon' | 'later';

export interface DueOpts { now?: number; soonDays?: number; stages?: JobStage[]; tz?: string }

/** The single rule every screen uses to label a job's due date. */
export function dueState(job: Pick<Job, 'status' | 'currentStage' | 'dueDate'>, opts: DueOpts = {}): DueState {
  if (isJobClosed(job, opts.stages)) return 'closed';
  const days = daysUntilDue(job.dueDate, opts.now ?? Date.now(), opts.tz);
  if (days === null) return 'none';
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= (opts.soonDays ?? 3)) return 'soon';
  return 'later';
}

export const isOverdue = (job: Pick<Job, 'status' | 'currentStage' | 'dueDate'>, opts: DueOpts = {}) => dueState(job, opts) === 'overdue';

/** When the job left the shop: the recorded ship date, else when it was marked complete. */
export function shipTime(job: Pick<Job, 'shippedAt' | 'completedAt'>): number | null {
  return job.shippedAt || job.completedAt || null;
}

/**
 * Was it shipped on time? true/false, or null when it can't be judged (no
 * readable due date, or not shipped yet) — callers must leave nulls out of
 * on-time percentages instead of counting them late.
 */
export function shippedOnTime(job: Pick<Job, 'dueDate' | 'shippedAt' | 'completedAt'>, tz?: string): boolean | null {
  const due = dueNum(job.dueDate);
  const t = shipTime(job);
  if (!due || !t) return null;
  return dayNum(t, tz) <= due;
}

/** Days late (positive) or early (negative/0) for a shipped job; null if not judgeable. */
export function shippedDaysLate(job: Pick<Job, 'dueDate' | 'shippedAt' | 'completedAt'>, tz?: string): number | null {
  const due = dueNum(job.dueDate);
  const t = shipTime(job);
  if (!due || !t) return null;
  return daysBetween(due, dayNum(t, tz));
}

/** On-time % over a set of shipped jobs; null when none can be judged. */
export function onTimeRate(jobs: Pick<Job, 'dueDate' | 'shippedAt' | 'completedAt'>[], tz?: string): { pct: number | null; onTime: number; judged: number } {
  let onTime = 0, judged = 0;
  for (const j of jobs) {
    const r = shippedOnTime(j, tz);
    if (r === null) continue;
    judged++;
    if (r) onTime++;
  }
  return { pct: judged ? Math.round((onTime / judged) * 100) : null, onTime, judged };
}

/** Sort comparator: overdue first (most late first), then soonest due, undated last. */
export function compareByDue(a: Pick<Job, 'dueDate'>, b: Pick<Job, 'dueDate'>): number {
  const da = dueNum(a.dueDate) || 99991231, db = dueNum(b.dueDate) || 99991231;
  return da - db;
}

/** Short human label: "3d late", "due today", "due tomorrow", "in 5d". '' when no due date. */
export function dueLabel(raw: string | null | undefined, now: number = Date.now()): string {
  const d = daysUntilDue(raw, now);
  if (d === null) return '';
  if (d < 0) return `${-d}d late`;
  if (d === 0) return 'due today';
  if (d === 1) return 'due tomorrow';
  return `in ${d}d`;
}
