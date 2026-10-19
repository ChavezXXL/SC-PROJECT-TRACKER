// ═════════════════════════════════════════════════════════════════════
// push_meta/cron-heartbeat — what the 5-minute background run (shift-push-cron)
// reports about itself. Written ONCE at the END of every run, so it carries the
// run's outcome, not just "it started". The Timekeeping Health panel listens to
// it: a stale lastRunMs means the engine is down, failures in the last run show
// as a warning. Pure module — shared by the cron (writer) and the panel (reader).
// ═════════════════════════════════════════════════════════════════════

import type { TimekeepingIssue } from './timekeepingHealth';

export const HEARTBEAT_COLLECTION = 'push_meta';
export const HEARTBEAT_DOC = 'cron-heartbeat';

export interface CronHeartbeat {
  /** When the run FINISHED (the health brain's "is it alive" clock). */
  lastRunMs: number;
  startedMs: number;
  durationMs: number;
  pushesSent: number;
  /** Pushes that didn't go through (after retries). */
  pushesFailed: number;
  /** Dead devices cleaned up (404/410) — housekeeping, not a failure. */
  pushesRemoved: number;
  /** Timers the run closed at the configured clock-out time / 14h safety net. */
  autoClockedOut: number;
  /** Steps that failed: database requests, a section that crashed, an email. */
  errors: number;
  lastError: string;
  /** Firestore document reads the run cost (free plan: 50,000/day total). */
  docsRead: number;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Read the doc's data. Tolerates the old shape ({ lastRunMs } only). */
export function parseHeartbeat(raw: any): CronHeartbeat | null {
  if (!raw || typeof raw.lastRunMs !== 'number' || !Number.isFinite(raw.lastRunMs)) return null;
  return {
    lastRunMs: raw.lastRunMs,
    startedMs: num(raw.startedMs),
    durationMs: num(raw.durationMs),
    pushesSent: num(raw.pushesSent),
    pushesFailed: num(raw.pushesFailed),
    pushesRemoved: num(raw.pushesRemoved),
    autoClockedOut: num(raw.autoClockedOut),
    errors: num(raw.errors),
    lastError: typeof raw.lastError === 'string' ? raw.lastError : '',
    docsRead: num(raw.docsRead),
  };
}

/** True when the last run reported anything that didn't work. */
export const heartbeatHasFailures = (hb: CronHeartbeat | null | undefined): boolean =>
  !!hb && (hb.pushesFailed > 0 || hb.errors > 0);

/**
 * Health-panel warning for a last run that reported failures, else null.
 * (A run that hasn't happened in 20+ min is the health brain's own critical
 * "engine down" issue — this one is about a run that DID happen.)
 */
export function heartbeatIssue(hb: CronHeartbeat | null | undefined, tz = 'America/Los_Angeles'): TimekeepingIssue | null {
  if (!hb || !heartbeatHasFailures(hb)) return null;
  const parts: string[] = [];
  if (hb.pushesFailed > 0) parts.push(`${hb.pushesFailed} notification${hb.pushesFailed > 1 ? 's' : ''} didn't go through`);
  if (hb.errors > 0) parts.push(`${hb.errors} step${hb.errors > 1 ? 's' : ''} failed`);
  let at = '';
  try { at = new Date(hb.lastRunMs).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }); } catch { /* bad tz */ }
  const why = hb.lastError ? ` Last error: "${hb.lastError}".` : '';
  return {
    id: 'cron-run-failures',
    severity: 'warning',
    category: 'System',
    title: `Background run had problems — ${parts.join(', ')}`,
    detail: `The 24/7 service (auto clock-out, shift alarms, reminders) reported trouble on its run${at ? ` at ${at}` : ''}.${why} `
      + `Failed notifications usually mean a phone is offline or blocked notifications; failed steps usually mean the database refused a request (e.g. the daily read limit ran out). `
      + `It tries again every 5 minutes — if this stays, check the Netlify function log for shift-push-cron.`,
    count: hb.pushesFailed + hb.errors,
  };
}
