// Time-log duration rules, shared by stopping a timer and editing a log — one
// place, so the two paths can never record different durations for the same
// session. Pure (no Firebase), so it's tested directly.
import type { TimeLog } from '../types';

/** A single session never counts more than this (a forgotten timer). */
export const MAX_SESSION_MS = 14 * 3600000;

/**
 * Final paused/working time for a session ending at `endTime`:
 *   • a pause still open at the end counts as paused up to the end
 *   • totalPausedMs is clamped to [0, wall time]
 *   • working time is clamped to [0, MAX_SESSION_MS] (no absurd multi-day durations)
 */
export function finalizeDuration(
  log: { startTime: number; pausedAt?: number | null; totalPausedMs?: number },
  endTime: number,
): { totalPausedMs: number; durationSeconds: number; durationMinutes: number; anomaly: boolean } {
  const startTime = log.startTime || 0;
  let totalPausedMs = log.totalPausedMs || 0;
  if (log.pausedAt && log.pausedAt < endTime) totalPausedMs += endTime - log.pausedAt;
  const wallMs = endTime - startTime;
  // endTime before startTime (clock skew / bad edit) → anomaly, clamp to 0
  const anomaly = wallMs < 0 || totalPausedMs < 0 || totalPausedMs > Math.max(0, wallMs) || wallMs - totalPausedMs > MAX_SESSION_MS;
  totalPausedMs = Math.min(Math.max(0, totalPausedMs), Math.max(0, wallMs));
  const workingMs = Math.min(Math.max(0, wallMs - totalPausedMs), MAX_SESSION_MS);
  const durationSeconds = Math.floor(workingMs / 1000);
  // 2-decimal minutes — short sample sessions (90s for 2 pc) need sub-minute
  // precision or per-piece rate learning is off by 30%+.
  const durationMinutes = Math.round((durationSeconds / 60) * 100) / 100;
  return { totalPausedMs, durationSeconds, durationMinutes, anomaly };
}

// The live pause state belongs to the worker's timer: an editor's copy of it
// is stale the moment the editor opens (they may pause or resume meanwhile).
// Only sample logs — built from a finished sample entry — bring their own.
const PAUSE_FIELDS = new Set(['pausedAt', 'pauseReason', 'totalPausedMs']);
// Always worked out here, never copied from the editor (its copy can be stale
// or plain wall-clock time).
const DERIVED = new Set(['id', 'updatedAt', 'durationSeconds', 'durationMinutes', 'status']);

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * What to write when someone edits a log: only the fields that changed.
 * `set` holds new values; `clear` lists fields to delete — a field emptied in
 * the editor, e.g. End Time cleared to put the timer back on the clock.
 * Durations always follow the start/end times and the pauses.
 */
export function timeLogEditPatch(
  cur: TimeLog, next: Partial<TimeLog>, now: number,
  // The copy the editor OPENED with. Fields the user didn't change from it are
  // skipped: an editor opened on a running timer used to send End = empty,
  // which cleared a clock-out the worker made meanwhile and restarted it.
  original?: Partial<TimeLog>,
): { set: Record<string, unknown>; clear: string[] } {
  const set: Record<string, unknown> = {};
  const clear: string[] = [];
  const isEmpty = (x: unknown) => x === undefined || x === null || x === '';
  for (const k of Object.keys(next)) {
    if (DERIVED.has(k) || (PAUSE_FIELDS.has(k) && !next.isSample)) continue;
    const v = (next as Record<string, unknown>)[k];
    if (original) {
      const o = (original as Record<string, unknown>)[k];
      if ((isEmpty(v) && isEmpty(o)) || same(v, o)) continue;   // untouched in the editor
    }
    const was = (cur as unknown as Record<string, unknown>)[k];
    if (v === undefined || v === null || v === '') {
      if (was !== undefined && was !== null && was !== '') clear.push(k);
    } else if (!same(v, was)) {
      set[k] = v;
    }
  }

  const startTime = (set.startTime ?? cur.startTime) as number;
  const endCleared = clear.includes('endTime');
  const endTime = endCleared ? undefined : ((set.endTime ?? cur.endTime) as number | undefined);
  const timesChanged = 'startTime' in set || 'endTime' in set || endCleared;
  const pausedMs = next.isSample && typeof next.totalPausedMs === 'number' ? next.totalPausedMs : (cur.totalPausedMs || 0);

  if (endTime) {
    const pauseChanged = pausedMs !== (cur.totalPausedMs || 0);
    if (timesChanged || pauseChanged || cur.durationSeconds == null || cur.status !== 'completed') {
      // Ending a running (maybe paused) log here: an open pause counts as
      // paused up to the end, the same as pressing Stop.
      const closingOpen = !cur.endTime;
      const f = finalizeDuration({ startTime, pausedAt: closingOpen ? cur.pausedAt : null, totalPausedMs: pausedMs }, endTime);
      set.durationSeconds = f.durationSeconds;
      set.durationMinutes = f.durationMinutes;
      set.totalPausedMs = f.totalPausedMs;
      set.status = 'completed';
      if (cur.pausedAt) set.pausedAt = null;
      if (cur.pauseReason) set.pauseReason = null;
      if (f.anomaly) set.durationAnomaly = true;
    }
  } else if (endCleared) {
    // End time removed: the timer is running again from its start.
    for (const k of ['durationSeconds', 'durationMinutes', 'stopReason'] as const) {
      if (cur[k] !== undefined && cur[k] !== null && !clear.includes(k)) clear.push(k);
    }
    // endTime is written as null, not deleted: "open timer" lookups query
    // endTime == null, which never matches a missing field — a reopened log
    // was invisible to them (it could run alongside the worker's next timer,
    // paid twice, and the sweep never closed it).
    clear.splice(clear.indexOf('endTime'), 1);
    set.endTime = null;
    set.status = 'in_progress';
  }
  set.updatedAt = now;
  return { set, clear };
}

/** A log being written for the first time: durations worked out from its times. */
export function newTimeLogRecord(log: TimeLog, now: number): TimeLog {
  // A running record carries endTime: null so the open-timer queries find it.
  if (!log.endTime) return { ...log, endTime: null as any, status: 'in_progress', updatedAt: now };
  const f = finalizeDuration({ startTime: log.startTime, totalPausedMs: log.totalPausedMs || 0 }, log.endTime);
  return {
    ...log,
    durationSeconds: f.durationSeconds,
    durationMinutes: f.durationMinutes,
    totalPausedMs: f.totalPausedMs,
    status: 'completed',
    updatedAt: now,
    ...(f.anomaly ? { durationAnomaly: true } : {}),
  };
}
