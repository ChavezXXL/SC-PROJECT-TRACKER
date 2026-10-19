// ═════════════════════════════════════════════════════════════════════
// Pure decisions shared by the scheduled functions (shift-push-cron,
// daily-briefing-cron, daily-recap-cron). No I/O — everything here is unit
// tested in tests/cronHelpers.test.ts. All wall-clock math goes through the
// shop-timezone helpers so it stays DST-safe.
// ═════════════════════════════════════════════════════════════════════

import { shopLocalTimeMs } from './timezone';

// ── People ────────────────────────────────────────────────────────────

export interface CronUser { id: string; name?: string; email?: string; role?: string; isActive?: boolean }

const ADMIN_ROLES = new Set(['admin', 'manager', 'owner']);

/** Deactivated people get no pushes, nags, briefings or scorecards. Only an
 *  explicit `isActive: false` counts — a missing flag means active. */
export const isActiveUser = (u: { id?: unknown; isActive?: unknown } | null | undefined): boolean =>
  !!u && u.isActive !== false;

export const isAdminUser = (u: { id?: unknown; role?: unknown } | null | undefined): boolean =>
  !!u && ADMIN_ROLES.has(String(u.role || ''));

/** The crons' long-standing "worker" test: employee/worker role, or no role. */
export const isWorkerUser = (u: { id?: unknown; role?: unknown } | null | undefined): boolean =>
  !!u && (u.role === 'employee' || u.role === 'worker' || (!u.role && !!u.id));

export const activeAdmins = <T extends CronUser>(users: T[]): T[] => users.filter(u => isActiveUser(u) && isAdminUser(u));
export const activeWorkers = <T extends CronUser>(users: T[]): T[] => users.filter(u => isActiveUser(u) && isWorkerUser(u));

/** Only these user fields are needed by the crons (pins etc. are never pulled). */
export const USER_FIELDS = ['name', 'email', 'role', 'isActive'];

// ── Clock ─────────────────────────────────────────────────────────────

export function parseHHMM(s: unknown): { h: number; m: number } | null {
  const mm = String(s ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!mm) return null;
  const h = +mm[1], m = +mm[2];
  return h <= 23 && m <= 59 ? { h, m } : null;
}

/** "YYYY-MM-DD" of `ms` in the shop timezone. */
export const shopDateStr = (ms: number, tz: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ms));

/** Shop-local midnight of the day `ms` falls on. */
export const shopDayStartMs = (ms: number, tz: string): number => shopLocalTimeMs(ms, tz, 0, 0);

/** The most recent HH:MM (shop time) at or before `nowMs` — today's, or
 *  yesterday's when today's hasn't come yet (an alarm just before midnight
 *  checked just after it). DST-safe: steps back a day from noon. */
export function lastShopTimeAtOrBefore(nowMs: number, tz: string, h: number, m: number): number {
  const today = shopLocalTimeMs(nowMs, tz, h, m);
  if (today <= nowMs) return today;
  const noon = shopLocalTimeMs(nowMs, tz, 12, 0);
  return shopLocalTimeMs(noon - 86_400_000, tz, h, m);
}

// ── Time on the clock ─────────────────────────────────────────────────

export interface LogTimes {
  id?: string;
  startTime?: number | null;
  endTime?: number | null;
  pausedAt?: number | null;
  totalPausedMs?: number | null;
}

const MAX_SESSION_MS = 14 * 3_600_000;

/**
 * Worked time of a RUNNING timer as of `atMs`: wall time minus finished pauses
 * (totalPausedMs) minus the pause in progress (pausedAt). Same fields and the
 * same clamps the app uses when a timer is stopped (finalizeDuration).
 */
export function runningWorkedMs(log: LogTimes, atMs: number): number {
  const start = typeof log.startTime === 'number' ? log.startTime : 0;
  if (!start) return 0;
  const wall = atMs - start;
  let paused = log.totalPausedMs || 0;
  if (log.pausedAt && log.pausedAt < atMs) paused += atMs - log.pausedAt;
  paused = Math.min(Math.max(0, paused), Math.max(0, wall));
  return Math.min(Math.max(0, wall - paused), MAX_SESSION_MS);
}

/**
 * Running timers as completed-looking copies that end at `atMs` and carry
 * their worked time so far — so "hours today" totals include work still on
 * the clock. Only timers started on/after `sinceMs` (a timer left running
 * from an earlier day is a forgotten clock-out, not today's work).
 */
export function runningLogsAsOf<T extends LogTimes & { isSample?: boolean }>(
  openLogs: T[], atMs: number, sinceMs: number,
): (T & { endTime: number; durationSeconds: number; durationMinutes: number })[] {
  return openLogs
    .filter(l => !l.endTime && !l.isSample && typeof l.startTime === 'number' && l.startTime >= sinceMs && l.startTime <= atMs)
    .map(l => {
      const sec = Math.floor(runningWorkedMs(l, atMs) / 1000);
      return { ...l, endTime: atMs, durationSeconds: sec, durationMinutes: Math.round((sec / 60) * 100) / 100 };
    });
}

/** Minutes of a finished log (precise seconds first, like every report). */
export const loggedMinutes = (l: { durationSeconds?: number | null; durationMinutes?: number | null }): number =>
  typeof l.durationSeconds === 'number' && l.durationSeconds >= 0
    ? l.durationSeconds / 60
    : (typeof l.durationMinutes === 'number' ? l.durationMinutes : 0);

// ── Missed clock-in ───────────────────────────────────────────────────

export interface ClockLog extends LogTimes { userId?: string | null; isSample?: boolean }

/**
 * Who has clocked in for a shift: anyone with an open timer now (running or
 * paused), plus anyone with a log that started since the shift start — even
 * if they've stopped it since (between jobs isn't "didn't clock in") — or
 * that started earlier that same day and was still running at the shift start.
 * `recentLogs` must include every log that ended at/after the shift start.
 */
export function clockedInUserIds(
  openLogs: ClockLog[], recentLogs: ClockLog[], shiftStartMs: number, shiftDayStartMs: number,
): Set<string> {
  const ids = new Set<string>();
  for (const l of openLogs) if (l.userId && !l.isSample) ids.add(String(l.userId));
  for (const l of recentLogs) {
    if (!l.userId || l.isSample || typeof l.startTime !== 'number') continue;
    const startedSince = l.startTime >= shiftStartMs;
    const onAtShiftStart = l.startTime >= shiftDayStartMs && typeof l.endTime === 'number' && l.endTime >= shiftStartMs;
    if (startedSince || onAtShiftStart) ids.add(String(l.userId));
  }
  return ids;
}

/** Late clock-in reminders: max per alarm per day, minutes between them, and
 *  the reminder that also emails the owner (once — never again at #4+). */
export const LATE_REMINDER_MAX = 6;
export const LATE_REMINDER_GAP_MS = 30 * 60_000;
export const LATE_ESCALATION_REMINDER = 3;
export const shouldEscalateLateClockIn = (reminderNumber: number, missingCount: number): boolean =>
  reminderNumber === LATE_ESCALATION_REMINDER && missingCount > 0;

// ── Idle between jobs ─────────────────────────────────────────────────

export const IDLE_NUDGE_MAX = 4;
export const IDLE_RENUDGE_MS = 45 * 60_000;

/**
 * Oldest log end the idle-gap scan needs to look at. After a worker's last
 * timer ends, their first nudge comes once they've been idle idleMin (or 45
 * min after an earlier nudge, whichever is later) and the rest of their
 * IDLE_NUDGE_MAX come ≥45 min apart, each at most one 5-min tick late. The
 * horizon below is longer than all of that (one spare nudge gap + 10 min), so
 * logs that ended before it can't change who gets nudged — the brute-force
 * test in tests/cronHelpers.test.ts checks this. Never earlier than work start.
 */
export function idleScanSinceMs(workStartMs: number, nowMs: number, idleMin: number): number {
  const firstNudgeMin = Math.max(idleMin, IDLE_RENUDGE_MS / 60_000) + 5;
  const horizonMin = firstNudgeMin + IDLE_NUDGE_MAX * (IDLE_RENUDGE_MS / 60_000 + 5) + 10;
  return Math.max(workStartMs, nowMs - horizonMin * 60_000);
}

/**
 * Workers who finished a job at/after `workStartMs`, have no timer open now,
 * and have been idle at least `idleMin` minutes. Longest gap first.
 */
export function idleCandidates(
  completed: { id?: string; userId?: string | null; endTime?: number | null; isSample?: boolean }[],
  busyUserIds: Set<string>,
  nowMs: number,
  idleMin: number,
  workStartMs: number,
): { id: string; lastEnd: number; gapMs: number }[] {
  const lastEnd = new Map<string, number>();
  for (const l of completed) {
    const uid = String(l.userId || '');
    if (!uid || l.isSample || typeof l.endTime !== 'number' || l.endTime <= 0) continue;
    if (l.endTime > (lastEnd.get(uid) || 0)) lastEnd.set(uid, l.endTime);
  }
  const out: { id: string; lastEnd: number; gapMs: number }[] = [];
  for (const [id, end] of lastEnd) {
    if (busyUserIds.has(id) || end < workStartMs) continue;
    const gapMs = nowMs - end;
    if (gapMs >= idleMin * 60_000) out.push({ id, lastEnd: end, gapMs });
  }
  return out.sort((a, b) => b.gapMs - a.gapMs);
}

// ── Job docs the push sections need ───────────────────────────────────

/** Distinct job ids of timers that are running right now (not paused) —
 *  the only jobs the long-timer and over-estimate checks look at. */
export function runningJobIds(activeLogs: { id?: string; jobId?: string | null; pausedAt?: number | null }[]): string[] {
  return [...new Set(activeLogs.filter(l => !l.pausedAt && l.jobId).map(l => String(l.jobId)))];
}

// ── Daily recap ───────────────────────────────────────────────────────

/**
 * The recap goes out on the first run at or after recapTime (shop time), once
 * per shop day. `lastSentDate` is settings.recapLastSentDate.
 */
export function recapDue(opts: { nowMs: number; tz: string; recapTime: unknown; lastSentDate?: unknown }):
  { due: boolean; today: string; sendAtMs: number | null; reason: 'bad-time' | 'already-sent' | 'not-yet' | 'due' } {
  const today = shopDateStr(opts.nowMs, opts.tz);
  const t = parseHHMM(opts.recapTime);
  if (!t) return { due: false, today, sendAtMs: null, reason: 'bad-time' };
  const sendAtMs = shopLocalTimeMs(opts.nowMs, opts.tz, t.h, t.m);
  if (opts.lastSentDate === today) return { due: false, today, sendAtMs, reason: 'already-sent' };
  if (opts.nowMs < sendAtMs) return { due: false, today, sendAtMs, reason: 'not-yet' };
  return { due: true, today, sendAtMs, reason: 'due' };
}

/**
 * Jobs whose full log history the recap's Job Insights read (see
 * buildRecapData): every job worked today that can get an insight (part
 * number + quantity), plus every COMPLETED job with the same part number (the
 * part history it's compared against). Same matching as getPartHistory.
 */
export function recapInsightJobIds(
  jobs: { id: string; partNumber?: string | null; quantity?: number | null; status?: string | null }[],
  todayJobIds: Iterable<string>,
): string[] {
  const byId = new Map(jobs.map(j => [String(j.id), j]));
  const parts = new Set<string>();
  const out = new Set<string>();
  for (const id of todayJobIds) {
    const j = byId.get(String(id));
    const pn = String(j?.partNumber || '').trim().toLowerCase();
    if (!j || !pn || !j.quantity || j.quantity <= 0) continue;
    out.add(String(j.id));
    parts.add(pn);
  }
  if (parts.size) {
    for (const j of jobs) {
      if (j.status === 'completed' && parts.has(String(j.partNumber || '').trim().toLowerCase())) out.add(String(j.id));
    }
  }
  return [...out];
}

/** A failed recap is retried on later runs: 10, 20, then 40 min apart, at
 *  most RECAP_MAX_ATTEMPTS sends a day (each attempt re-reads the day's data,
 *  so a permanent failure must not burn the read quota until midnight). */
export const RECAP_MAX_ATTEMPTS = 4;
export interface RecapRetryState { date?: string; failures?: number; lastAttemptMs?: number }
export function recapRetryAllowed(state: RecapRetryState | null | undefined, today: string, nowMs: number): boolean {
  if (!state || state.date !== today || !state.failures) return true;
  if (state.failures >= RECAP_MAX_ATTEMPTS) return false;
  const waitMs = 10 * 60_000 * Math.pow(2, state.failures - 1);
  // 1 min of slack: the cron fires every 10 min, a little jitter mustn't skip a slot.
  return nowMs - (state.lastAttemptMs || 0) >= waitMs - 60_000;
}

// ── End-of-day scorecard ──────────────────────────────────────────────

/** Scorecard send time: the setting, else the clock-out alarm, else the
 *  auto clock-out time, else 15:30. */
export function scorecardTimeFor(settings: {
  scorecardTime?: unknown;
  shiftAlarms?: { enabled?: boolean; clockOut?: boolean; label?: string; time?: string }[] | null;
  autoClockOutTime?: unknown;
}): string {
  if (parseHHMM(settings.scorecardTime)) return String(settings.scorecardTime).trim();
  const alarm = (settings.shiftAlarms || []).find(a => {
    if (!a || !a.enabled || !parseHHMM(a.time)) return false;
    const label = String(a.label || '').toLowerCase();
    return !!a.clockOut || label.includes('clock out') || label.includes('shift end');
  });
  if (alarm) return String(alarm.time).trim();
  if (parseHHMM(settings.autoClockOutTime)) return String(settings.autoClockOutTime).trim();
  return '15:30';
}

// ── Small shared formatting ───────────────────────────────────────────

/** Escape user-controlled text before it goes into an HTML email. */
export const escHtml = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
