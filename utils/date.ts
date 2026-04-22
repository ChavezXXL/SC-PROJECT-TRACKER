// ═════════════════════════════════════════════════════════════════
// Date utilities — all date formatting + comparison helpers live here.
// Dates in this app are stored in MM/DD/YYYY (string). ISO YYYY-MM-DD
// inputs are also tolerated (e.g. from <input type="date">).
// ═════════════════════════════════════════════════════════════════

/** Format a date string for display. Converts ISO YYYY-MM-DD → MM/DD/YYYY.
 *  Returns '' for nullish, passes through anything already MM/DD/YYYY. */
export function fmt(d?: string | null): string {
  if (!d) return '';
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  return d;
}

/** Today as MM/DD/YYYY. */
export function todayFmt(): string {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Normalize any incoming date string to MM/DD/YYYY.
 *  Accepts MM/DD/YYYY, YYYY-MM-DD, or anything Date() understands. */
export function normDate(raw: string | null | undefined): string {
  if (!raw) return '';
  const s = raw.trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return s;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[2] + '/' + iso[3] + '/' + iso[1];
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') + '/' + d.getFullYear();
  }
  return s;
}

/** Convert MM/DD/YYYY → numeric YYYYMMDD for safe comparisons.
 *  (String comparison of MM/DD/YYYY is broken: "04/05/2026" < "12/31/2025".) */
export function dateNum(mmddyyyy: string): number {
  const m = mmddyyyy.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return 0;
  return parseInt(m[3]) * 10000 + parseInt(m[1]) * 100 + parseInt(m[2]);
}

/** Parse a due-date string (MM/DD/YYYY or YYYY-MM-DD) into a real Date at noon.
 *  Returns null for invalid/missing. */
export function parseDueDate(raw?: string | null): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const d = new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]), 12, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Format a timestamp as `YYYY-MM-DDTHH:MM` for <input type="datetime-local">. */
export function toDateTimeLocal(ts: number | undefined | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Format minutes as "Xh Ym" or "Ym". Returns "Running..." for nullish. */
export function formatDuration(mins: number | undefined): string {
  if (mins === undefined || mins === null) return 'Running...';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Compute accurate duration minutes from a log's actual timestamps,
 *  subtracting any paused time. */
export function getLogDurationMins(log: {
  startTime: number;
  endTime?: number | null;
  totalPausedMs?: number;
  durationMinutes?: number | null;
}): number | undefined {
  if (!log.endTime) return undefined;
  const wallMs = log.endTime - log.startTime;
  const pausedMs = log.totalPausedMs || 0;
  const workingMs = Math.max(0, wallMs - pausedMs);
  return Math.ceil(workingMs / 1000 / 60);
}
