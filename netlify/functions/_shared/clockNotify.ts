// netlify/functions/_shared/clockNotify.ts
// ═════════════════════════════════════════════════════════════════════
// Pure rules behind notify-clockin: which events exist, whether a stored time
// log really is in the state an event describes, who receives the push, and
// the exact notification text. The caller supplies only { eventType, logId };
// every word of the notification comes from the stored log (and its job).
// ═════════════════════════════════════════════════════════════════════

import { safeSubscription, type SafeSubscription } from './pushSafety';

export type AdminNotifyEvent = 'clock-in' | 'clock-out' | 'over-estimate';
export const ADMIN_NOTIFY_EVENTS: readonly AdminNotifyEvent[] = ['clock-in', 'clock-out', 'over-estimate'];

export function isAdminNotifyEvent(v: unknown): v is AdminNotifyEvent {
  return typeof v === 'string' && (ADMIN_NOTIFY_EVENTS as readonly string[]).includes(v);
}

/** A time-log id as the app writes them (`lq3x5k_ab12cd`, `bf_1700000000000`, digits). */
export function isLogId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
}

/** Any id that is safe to use as a single Firestore document id. */
export function isDocId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 256 && !v.includes('/')
    && v !== '.' && v !== '..' && !/^__.*__$/.test(v);
}

/** A clock-in / clock-out is only announced while it's fresh: the log must have
 *  been written (server clock) within this window. Older logs never trigger. */
export const CLOCK_EVENT_MAX_AGE_MS = 10 * 60_000;

/** Stops the system makes — auto clock-out, sweeps, alarms, admin force-stop,
 *  job switch. Never pushed (the same rule the app applied before). */
export const ROUTINE_STOP = /^(sweep:|alarm:|admin:|auto:)/;

/** The fields of a stored time log this module reads. */
export interface NotifyLog {
  userName?: unknown;
  operation?: unknown;
  partNumber?: unknown;
  customer?: unknown;
  jobId?: unknown;
  status?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  pausedAt?: unknown;
  totalPausedMs?: unknown;
  stopReason?: unknown;
}

/** Server-side write times of the log document (Firestore createTime / updateTime). */
export interface LogWriteTimes { createdMs: number; updatedMs: number }

export type EventCheck =
  | { ok: true }
  /** retry = the log may simply not have reached the server yet — the client asks again. */
  | { ok: false; retry: boolean; reason: string };

/** Does the stored log match a clock-in / clock-out that just happened? */
export function checkClockEvent(
  eventType: 'clock-in' | 'clock-out',
  log: NotifyLog,
  written: LogWriteTimes,
  nowMs: number,
): EventCheck {
  if (eventType === 'clock-in') {
    // A clock-in creates the log. (It may already be stopped again by the time
    // the request lands — a quick in-and-out still announces both.)
    if (!(written.createdMs > 0) || nowMs - written.createdMs > CLOCK_EVENT_MAX_AGE_MS) {
      return { ok: false, retry: false, reason: 'stale' };
    }
    return { ok: true };
  }
  if (!log.endTime) return { ok: false, retry: true, reason: 'still-running' };
  if (ROUTINE_STOP.test(typeof log.stopReason === 'string' ? log.stopReason : '')) {
    return { ok: false, retry: false, reason: 'routine-stop' };
  }
  if (!(written.updatedMs > 0) || nowMs - written.updatedMs > CLOCK_EVENT_MAX_AGE_MS) {
    return { ok: false, retry: false, reason: 'stale' };
  }
  return { ok: true };
}

export interface OverEstimate { poNumber: string; expectedHours: number; elapsedHours: number }

/** Is this timer running right now AND past its job's expected-hours budget?
 *  (Same test as the floor monitor: working time = wall time − paused time.) */
export function checkOverEstimate(
  log: NotifyLog,
  job: { expectedHours?: unknown; poNumber?: unknown } | null | undefined,
  nowMs: number,
): { ok: true; over: OverEstimate } | { ok: false; reason: string } {
  if (log.endTime || (log.status !== 'in_progress' && log.status !== 'paused')) return { ok: false, reason: 'not-running' };
  if (log.pausedAt) return { ok: false, reason: 'paused' };
  const expectedHours = Number(job?.expectedHours);
  if (!job || !Number.isFinite(expectedHours) || expectedHours <= 0) return { ok: false, reason: 'no-budget' };
  const start = Number(log.startTime);
  if (!Number.isFinite(start) || start <= 0) return { ok: false, reason: 'bad-log' };
  const elapsedMs = nowMs - start - (Number(log.totalPausedMs) || 0);
  if (elapsedMs <= expectedHours * 3_600_000) return { ok: false, reason: 'within-budget' };
  return { ok: true, over: { poNumber: cleanText(job.poNumber, 40), expectedHours, elapsedHours: elapsedMs / 3_600_000 } };
}

/** Control characters, bidi marks / overrides and line / paragraph separators —
 *  invisible or layout-changing in a notification, so they become spaces. */
function isInvisibleChar(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
    || code === 0x200e || code === 0x200f || code === 0x2028 || code === 0x2029
    || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
}

/** One line of plain text from a stored field: invisible characters become
 *  spaces, whitespace collapses, length is capped. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  const s = Array.from(String(v), ch => (isInvisibleChar(ch.codePointAt(0) ?? 0) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

export interface AdminPush {
  title: string;
  body: string;
  tag: string;
  url: string;
  icon: string;
  requireInteraction: boolean;
}

/** The notification, worded exactly as the app has always worded it. */
export function buildAdminPush(eventType: AdminNotifyEvent, log: NotifyLog, logId: string, over?: OverEstimate): AdminPush {
  const worker = cleanText(log.userName, 40) || 'A worker';
  const operation = cleanText(log.operation, 60);
  const jobLabel = [cleanText(log.partNumber, 60), cleanText(log.customer, 60)].filter(Boolean).join(' · ');
  const base = { tag: `${eventType}-${logId}`, url: '/', icon: '/brand/ftio-icon.png' };

  if (eventType === 'over-estimate') {
    const o = over || { poNumber: '', expectedHours: 0, elapsedHours: 0 };
    const what = operation || 'A job';
    const po = o.poNumber ? ` on PO ${o.poNumber}` : '';
    const budget = cleanText(String(o.expectedHours), 12);
    return {
      ...base,
      title: `⚠️ Over estimate — ${worker}`,
      body: `${what}${po} passed its ${budget}h budget (now ${o.elapsedHours.toFixed(1)}h). Check in with them.`,
      requireInteraction: true, // stays on screen until the owner acts
    };
  }

  const isIn = eventType === 'clock-in';
  return {
    ...base,
    title: isIn ? `🟢 ${worker} clocked in` : `🔴 ${worker} clocked out`,
    body: [operation, jobLabel].filter(Boolean).join('  ·  ') || (isIn ? 'Timer started' : 'Timer stopped'),
    requireInteraction: false,
  };
}

const ADMIN_ROLES = new Set(['admin', 'manager', 'owner']);

export interface StoredSub { id: string; userId?: unknown; subscription?: unknown }
export interface StoredUser { role?: unknown; isActive?: unknown }

/** An admin / manager / owner account that hasn't been deactivated. */
export function isActiveAdmin(user: StoredUser | null | undefined): boolean {
  return !!user && user.isActive !== false && ADMIN_ROLES.has(String(user.role ?? '').toLowerCase());
}

export interface PushTarget {
  /** push_subscriptions doc ids sharing this endpoint (all deleted if it's gone). */
  ids: string[];
  sub: SafeSubscription;
}

/** Subscriptions owned by a still-active admin / manager / owner (role read from
 *  the users collection, not from the subscription doc), on a known push
 *  service, one target per device even if it's registered more than once. */
export function adminPushTargets(subs: StoredSub[], usersById: Map<string, StoredUser>): PushTarget[] {
  const byEndpoint = new Map<string, PushTarget>();
  for (const s of subs) {
    if (!isActiveAdmin(usersById.get(String(s.userId ?? '')))) continue;
    const sub = safeSubscription(s.subscription);
    if (!sub) continue;
    const hit = byEndpoint.get(sub.endpoint);
    if (hit) hit.ids.push(s.id);
    else byEndpoint.set(sub.endpoint, { ids: [s.id], sub });
  }
  return [...byEndpoint.values()];
}
