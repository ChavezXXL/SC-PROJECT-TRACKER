// ═════════════════════════════════════════════════════════════════
// Date utilities — all date formatting + comparison helpers live here.
// Dates in this app are stored in MM/DD/YYYY (string). ISO YYYY-MM-DD
// inputs are also tolerated (e.g. from <input type="date">).
// ═════════════════════════════════════════════════════════════════

// Parsing lives in utils/dueDates.ts — ONE parser for every format, so the
// helpers below can no longer disagree about the same string (dateNum used to
// return 0 for an ISO date, making it "always overdue", while the server cron
// treated the same string as never overdue).
import { canonicalDue, dueNum, dueDateObj } from './dueDates';

/** Format a date string for display as MM/DD/YYYY. Returns '' for nullish;
 *  unreadable text passes through unchanged so nothing silently disappears. */
export function fmt(d?: string | null): string {
  if (!d) return '';
  return canonicalDue(d) || d;
}

/** Today as MM/DD/YYYY. */
export function todayFmt(): string {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Normalize an incoming date to canonical MM/DD/YYYY (zero-padded).
 *  Unreadable input is returned trimmed rather than dropped or guessed — the
 *  old Date() fallback turned "Sep 20" into 09/20/2001. */
export function normDate(raw: string | null | undefined): string {
  if (!raw) return '';
  const s = raw.trim();
  return canonicalDue(s) || s;
}

/** Due date → YYYYMMDD number for comparisons; 0 when missing/unreadable.
 *  Prefer dueState()/isOverdue() from utils/dueDates for lateness — a raw
 *  `dateNum(d) < today` check treats unreadable dates (0) as overdue. */
export function dateNum(raw: string): number {
  return dueNum(raw);
}

/** Due date → Date at local noon on that day (display/calendar placement).
 *  Never compare it to Date.now() for lateness — that made jobs "overdue" at
 *  noon on their due day. Use utils/dueDates. Returns null when unreadable. */
export function parseDueDate(raw?: string | null): Date | null {
  return dueDateObj(raw);
}

/** Format a timestamp as `YYYY-MM-DDTHH:MM` for <input type="datetime-local">. */
export function toDateTimeLocal(ts: number | undefined | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Format minutes as "Xh Ym" or "Ym". Returns "Running..." for nullish.
 *  Rounds to the nearest whole minute first so fractional inputs (e.g. 59.8)
 *  never produce the impossible "60m" display. */
export function formatDuration(mins: number | undefined): string {
  if (mins === undefined || mins === null) return 'Running...';
  const total = Math.round(mins);   // integer minutes — prevents "60m" edge case
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Compute accurate duration minutes from a log's actual timestamps,
 *  subtracting any paused time.
 *
 *  Priority order:
 *   1. `durationSeconds` (stored at clock-out with Math.floor — most precise)
 *   2. Fall back to raw timestamp diff (Math.round to match stopTimeLog)
 *
 *  Using Math.round (not Math.ceil) keeps display numbers consistent with
 *  what was stored: a 61-second session is "1m" everywhere, not "2m". */
export function getLogDurationMins(log: {
  startTime: number;
  endTime?: number | null;
  totalPausedMs?: number;
  durationMinutes?: number | null;
  durationSeconds?: number;
}): number | undefined {
  if (!log.endTime) return undefined;
  // Use stored durationSeconds when available — it was set at clock-out with
  // Math.floor(workingMs/1000) so it's the most accurate figure we have.
  if (log.durationSeconds != null && log.durationSeconds >= 0) {
    return Math.round(log.durationSeconds / 60);
  }
  const wallMs = log.endTime - log.startTime;
  const pausedMs = log.totalPausedMs || 0;
  const workingMs = Math.max(0, wallMs - pausedMs);
  return Math.round(workingMs / 1000 / 60);
}
