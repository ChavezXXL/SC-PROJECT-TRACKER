// netlify/functions/shift-push-cron.ts
// ═════════════════════════════════════════════════════════════════════
// Runs every 5 minutes, 24/7:
//
//   0. Auto clock-out    — close timers at the configured clock-out time or
//                          the 14 h safety net (needs no push keys)
//   A. Shift alarms      — broadcast to every device at alarm time
//   C. Missed clock-in   — remind workers after the shift starts, admin
//                          summary, one escalation email at reminder #3
//   D. Long timer        — admin push when a timer passes 5 h
//   F. Over estimate     — admin + worker push when a timer passes its
//                          operation's estimate
//   E. Job notes         — new notes → admins + workers on that job
//   G. Idle between jobs — nudge workers who finished a job and haven't
//                          started another (work hours)
//
// READ BUDGET — the free Spark plan allows 50,000 document reads a day for
// every screen AND every cron, and this runs 288 times a day, so anything read
// on every run is multiplied by 288:
//   • Every run: settings (1) + open timers (1 each, min 1) + new notes (min 1)
//     + during work hours the logs that ended inside the idle window.
//   • Job docs: only the jobs of running timers — one batchGet, once per run.
//   • users / push_subscriptions: at most once per run, and only when
//     something is actually being sent.
//   Never list a whole collection on every run.
//
// At the END of every run it writes push_meta/cron-heartbeat with what the run
// did (pushes sent / failed, errors, reads). The Timekeeping Health panel shows
// a dead engine (stale heartbeat) or a run that reported failures.
//
// Required Netlify env vars:
//   VITE_FIREBASE_API_KEY / FIREBASE_API_KEY
//   VITE_FIREBASE_PROJECT_ID  (default: sc-job-tracker)
//   VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY
//   VAPID_SUBJECT             (default: mailto:hello@fabtrack.io)
//   RESEND_API_KEY / RESEND_FROM (escalation email — optional)
// ═════════════════════════════════════════════════════════════════════

import type { Config } from '@netlify/functions';
import type { ShiftAlarm, SystemSettings } from '../../types';
import { shopLocalTimeMs, shopDayOfWeek } from '../../utils/timezone';
import { finalizeDuration } from '../../utils/timeLogEdit';
import { lunchWindow, alarmOnDay } from '../../utils/shiftRules';
import { createFirestoreRest, type FirestoreRest, type FsDoc } from '../../utils/firestoreRest';
import {
  USER_FIELDS, isActiveUser, isAdminUser, activeAdmins, activeWorkers, parseHHMM, shopDateStr, shopDayStartMs,
  lastShopTimeAtOrBefore, clockedInUserIds, LATE_REMINDER_MAX, LATE_REMINDER_GAP_MS, shouldEscalateLateClockIn,
  IDLE_NUDGE_MAX, IDLE_RENUDGE_MS, idleScanSinceMs, idleCandidates, runningJobIds, escHtml,
} from '../../utils/cronHelpers';
import { HEARTBEAT_COLLECTION, HEARTBEAT_DOC, type CronHeartbeat } from '../../utils/cronHeartbeat';
import { createResendSender, DEFAULT_EMAIL_FROM, type EmailSender } from '../../utils/cronEmail';
import { createWebPushSender, subsByUserId, type PushSender } from '../../utils/cronPush';

export const config: Config = {
  schedule: '*/5 * * * *',   // every 5 minutes
};

const TAG = '[shift-push-cron]';

/** Fields of a job doc the push sections read (batchGet mask). */
const JOB_FIELDS = ['checklist', 'jobIdsDisplay', 'partNumber'];
/** Fields of an ended log the clock-in / idle checks read (query select). */
const ENDED_LOG_FIELDS = ['userId', 'startTime', 'endTime', 'isSample'];
const NOTES_WINDOW_MS = 6 * 60_000;
const LONG_TIMER_MS = 5 * 3_600_000;

// ── Dependencies (real ones in the handler at the bottom; tests pass fakes) ──

export interface ShiftCronDeps {
  fs: FirestoreRest;
  /** null = no (usable) VAPID keys: auto clock-out still runs, pushes don't. */
  push: PushSender | null;
  /** null = no Resend key: the escalation email is skipped. */
  sendEmail: EmailSender | null;
  /** A setup problem to report in the heartbeat (e.g. bad VAPID keys). */
  setupError?: string;
  /** Fixed clock for tests. */
  now?: number;
}

// ── Time helpers ──────────────────────────────────────────────────────

/** "HH:MM" (24 h) of `ms` in the shop timezone. */
function hhmmIn(tz: string, ms: number): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ms)).replace(/^24:/, '00:');
}

/** True if alarmTime (HH:MM) falls within a ±4-min window of now. */
function isWithinWindow(alarmTime: string, nowHHMM: string): boolean {
  const [ah, am] = alarmTime.split(':').map(Number);
  const [nh, nm] = nowHHMM.split(':').map(Number);
  const alarmTotal = ah * 60 + am;
  const nowTotal   = nh * 60 + nm;
  const diff = Math.abs(alarmTotal - nowTotal);
  return Math.min(diff, 1440 - diff) <= 4;
}

/**
 * True if now is between graceMinutes and 120 minutes AFTER alarmTime.
 * Used to find shift-start alarms where the grace period has elapsed.
 */
function isAfterGracePeriod(alarmTime: string, nowHHMM: string, graceMinutes: number): boolean {
  const [ah, am] = alarmTime.split(':').map(Number);
  const [nh, nm] = nowHHMM.split(':').map(Number);
  const alarmTotal = ah * 60 + am;
  const nowTotal   = nh * 60 + nm;
  let diff = nowTotal - alarmTotal;
  if (diff < -720) diff += 1440; // wrap past midnight
  return diff >= graceMinutes && diff < 120;
}

/** Days of week this alarm should fire (empty = every day), in shop time. */
function alarmActiveToday(alarm: ShiftAlarm, tz: string, nowMs: number): boolean {
  const dow = shopDayOfWeek(tz, nowMs);
  return alarmOnDay(alarm.days, dow >= 0 ? dow : new Date(nowMs).getDay());
}

/** Format elapsed ms as "Xh Ym" or "Ym" */
function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const firstName = (u: any, fallback: string) => String(u?.name || u?.email || fallback).split(' ')[0];
const norm = (s: unknown) => String(s ?? '').toLowerCase().trim();
const jobLabel = (job: FsDoc | undefined, log: FsDoc): string =>
  job?.jobIdsDisplay || job?.partNumber || log.jobIdsDisplay || log.partNumber || log.jobId;

// ── Run bookkeeping ───────────────────────────────────────────────────

interface RunStats {
  pushesSent: number;
  pushesFailed: number;
  pushesRemoved: number;
  autoClockedOut: number;
  errors: number;
  lastError: string;
}

function noteError(run: RunStats, where: string, e: unknown) {
  const msg = String((e as any)?.message || e || 'unknown error');
  run.errors++;
  run.lastError = `${where}: ${msg}`.slice(0, 300);
  console.error(`${TAG} ${where} failed:`, msg);
}

interface ClockInCheck { alarm: ShiftAlarm; shiftStart: number; dayStart: number }
interface IdlePlan { workStart: number; idleMin: number; since: number }

/** Everything the sections share. The lazy loaders read Firestore at most once per run. */
interface Ctx {
  fs: FirestoreRest;
  push: PushSender;
  sendEmail: EmailSender | null;
  settings: SystemSettings & Record<string, any>;
  tz: string;
  shopName: string;
  now: number;
  nowHHMM: string;
  today: string;
  alarms: ShiftAlarm[];
  /** Open timers (running + paused) minus any this run just auto-closed. */
  openLogs: FsDoc[];
  /** Running timers (status in_progress) — a subset of openLogs. */
  activeLogs: FsDoc[];
  clockInChecks: ClockInCheck[];
  idlePlan: IdlePlan | null;
  run: RunStats;
  /** Everyone (name/email/role/isActive only). null = couldn't be read. */
  users: () => Promise<FsDoc[] | null>;
  /** Every push subscription. null = couldn't be read. */
  subs: () => Promise<FsDoc[] | null>;
  subsOf: (userId: string) => Promise<FsDoc[]>;
  /** Job docs of the running timers (one batchGet). */
  runningJobs: () => Promise<Map<string, FsDoc>>;
  /** Logs that ended at/after `since` (userId/startTime/endTime only). null = query failed. */
  logsEndedSince: (since: number) => Promise<FsDoc[] | null>;
  /** Push to these devices (6 at a time); returns how many went through. */
  pushTo: (subs: FsDoc[], payload: string, ttlSec: number) => Promise<number>;
}

// ── Main ──────────────────────────────────────────────────────────────

/** One full run. Exported for tests — the scheduled handler is the default export. */
export async function runShiftPushCron(deps: ShiftCronDeps): Promise<CronHeartbeat> {
  const startedMs = deps.now ?? Date.now();
  const run: RunStats = { pushesSent: 0, pushesFailed: 0, pushesRemoved: 0, autoClockedOut: 0, errors: 0, lastError: '' };
  if (deps.setupError) noteError(run, 'setup', deps.setupError);

  try {
    await runSections(deps, startedMs, run);
  } catch (e) {
    noteError(run, 'run', e);
  }

  // Heartbeat LAST, so it reports how the run went — not just that it started.
  const endMs = deps.now ?? Date.now();
  const io = deps.fs.stats;
  const hb: CronHeartbeat = {
    lastRunMs: endMs,
    startedMs,
    durationMs: endMs - startedMs,
    pushesSent: run.pushesSent,
    pushesFailed: run.pushesFailed,
    pushesRemoved: run.pushesRemoved,
    autoClockedOut: run.autoClockedOut,
    errors: run.errors + io.errors,
    lastError: io.lastError || run.lastError,
    docsRead: io.reads,
  };
  const ok = await deps.fs.write(HEARTBEAT_COLLECTION, HEARTBEAT_DOC, { ...hb });
  if (!ok) console.error(`${TAG} heartbeat write failed`);
  console.log(`${TAG} done — sent:${hb.pushesSent} failed:${hb.pushesFailed} removed:${hb.pushesRemoved} clocked-out:${hb.autoClockedOut} errors:${hb.errors} reads:${hb.docsRead}`);
  return hb;
}

async function runSections(deps: ShiftCronDeps, now: number, run: RunStats): Promise<void> {
  const { fs } = deps;

  // 1. Shop settings
  const settings = await fs.get('settings', 'system') as unknown as (SystemSettings & Record<string, any>) | null;
  if (!settings) {
    if (!fs.stats.errors) noteError(run, 'settings', 'no settings/system doc');
    return;
  }
  const tz = settings.recapTimezone || 'America/Los_Angeles';
  const nowHHMM = hhmmIn(tz, now);
  const today = shopDateStr(now, tz);

  // 2. Every open timer (running or paused) — ONE query shared by every
  // section below: one read per open timer (min 1), zero full-collection scans.
  const fetchedOpen = await fs.where('logs', 'status', 'in', ['in_progress', 'paused']);
  // Defensive: never touch a log that already has an endTime.
  let openLogs = (fetchedOpen || []).filter(l => !l.endTime);

  // ── Section 0: AUTO CLOCK-OUT (server-side — the reliable path) ────────
  // The client sweep (sweepStaleLogs) only runs while a browser tab is open.
  // When the shop closes and everyone shuts the app, nothing clocks workers
  // out — they stay "running" until someone reopens the app or the 14h safety
  // net trips the next day. THAT is the "not clocking out at the time I set"
  // bug. This runs every 5 min regardless of any open tab, so timers end at
  // the configured cutoff for real. Field-for-field identical to stopTimeLog.
  if (fetchedOpen) {
    try {
      const closed = await autoClockOut(fs, settings, tz, now, nowHHMM, openLogs);
      run.autoClockedOut = closed.size;
      if (closed.size) openLogs = openLogs.filter(l => !closed.has(l.id));
    } catch (e) {
      noteError(run, 'auto clock-out', e);
    }
    try {
      await resumeLunchPauses(fs, settings, now, openLogs);
    } catch (e) {
      noteError(run, 'lunch resume', e);
    }
  }

  // ── Push gate ── everything below sends Web Push, which needs VAPID keys.
  // Auto-clock-out above does NOT, so it already ran regardless.
  if (!deps.push) {
    console.log(`${TAG} No VAPID keys — auto clock-out done, skipping push sections`);
    return;
  }

  // The master Break & Shift Alarms switch gates ALL alarm-driven pushes
  // (matches the client watcher).
  const alarms: ShiftAlarm[] = settings.shiftAlarmsEnabled !== false ? (settings.shiftAlarms || []) : [];

  // Clock-in alarms whose 20-min grace has passed (still inside the 2 h
  // window). Requires the EXPLICIT clockIn flag — naming an alarm "shift
  // start" must not silently turn it into a late-nag enforcement alarm.
  const clockInChecks: ClockInCheck[] = [];
  for (const a of alarms) {
    if (!a?.enabled || a.clockIn !== true || !alarmActiveToday(a, tz, now) || !isAfterGracePeriod(a.time, nowHHMM, 20)) continue;
    const t = parseHHMM(a.time);
    if (!t) continue;
    const shiftStart = lastShopTimeAtOrBefore(now, tz, t.h, t.m);
    clockInChecks.push({ alarm: a, shiftStart, dayStart: shopDayStartMs(shiftStart, tz) });
  }

  // Idle-gap nudges only during work hours on a workday (Mon–Sat). The hours
  // follow the shop's alarms: from today's clock-in alarm (6:00 if none) until
  // 30 min before the EARLIEST finish — an optional early finish counts, since
  // someone who left then isn't idle (and no point telling anyone to start a
  // job right before they leave).
  let idlePlan: IdlePlan | null = null;
  const dow = shopDayOfWeek(tz, now);
  const todays = alarms.filter(a => a?.enabled && alarmActiveToday(a, tz, now));
  const startAt = todays.filter(a => a.clockIn === true).map(a => parseHHMM(a.time)).filter(Boolean)
    .sort((a, b) => (a!.h * 60 + a!.m) - (b!.h * 60 + b!.m))[0] || { h: 6, m: 0 };
  const workStart = shopLocalTimeMs(now, tz, startAt.h, startAt.m);
  const finishes = [
    parseHHMM(settings.autoClockOutTime) || { h: 17, m: 30 },
    ...todays.filter(a => a.clockOut || /finish|clock.?out|shift.?end/i.test(String(a.label || ''))).map(a => parseHHMM(a.time)),
  ].filter(Boolean) as { h: number; m: number }[];
  const end = finishes.sort((a, b) => (a.h * 60 + a.m) - (b.h * 60 + b.m))[0];
  const workEnd = shopLocalTimeMs(now, tz, end.h, end.m);
  if (dow >= 1 && dow <= 6 && now >= workStart && now <= workEnd - 30 * 60_000) {
    const idleMin = Math.max(20, Number(settings.idleGapMinutes) || 75);
    idlePlan = { workStart, idleMin, since: idleScanSinceMs(workStart, now, idleMin) };
  }

  const activeLogs = openLogs.filter(l => l.status === 'in_progress');
  const c = createContext({
    deps, push: deps.push, settings, tz, now, nowHHMM, today, alarms, openLogs, activeLogs, clockInChecks, idlePlan, run,
  });

  console.log(`${TAG} ${nowHHMM} ${tz} | ${openLogs.length} open timer(s), ${activeLogs.length} running | ${clockInChecks.length} clock-in check(s) | idle scan ${idlePlan ? 'on' : 'off'}`);

  // Each section is isolated: one crashing must not stop the rest.
  const sections: [string, (c: Ctx) => Promise<void>][] = [
    ['shift alarms', sectionShiftAlarms],
    ['long timers', sectionLongTimers],
    ['over estimate', sectionOverEstimate],
    ['job notes', sectionJobNotes],
  ];
  // "Who's at work" sections need the open-timer list — if that query failed,
  // skip them rather than nag everyone.
  if (fetchedOpen) {
    sections.splice(1, 0, ['missed clock-in', sectionMissedClockIn]);
    sections.push(['idle gap', sectionIdleGap]);
  }
  for (const [name, fn] of sections) {
    try { await fn(c); } catch (e) { noteError(run, name, e); }
  }
}

function createContext(o: {
  deps: ShiftCronDeps; push: PushSender; settings: SystemSettings & Record<string, any>; tz: string; now: number;
  nowHHMM: string; today: string; alarms: ShiftAlarm[]; openLogs: FsDoc[]; activeLogs: FsDoc[];
  clockInChecks: ClockInCheck[]; idlePlan: IdlePlan | null; run: RunStats;
}): Ctx {
  const { fs } = o.deps;
  const once = <T>(load: () => Promise<T>): (() => Promise<T>) => {
    let p: Promise<T> | undefined;
    return () => (p ??= load());
  };

  const users = once(() => fs.list('users', { mask: USER_FIELDS }));
  const subs = once(() => fs.list('push_subscriptions'));
  const subsByUser = once(async () => subsByUserId((await subs()) || []));
  const runningJobs = once(async () =>
    (await fs.getMany('jobs', runningJobIds(o.activeLogs), { mask: JOB_FIELDS })) || new Map<string, FsDoc>());

  // One query for "logs that ended since X", shared by the clock-in check and
  // the idle scan: fetched once from the earliest point either needs.
  const floor = Math.min(
    ...o.clockInChecks.map(x => x.shiftStart),
    o.idlePlan ? o.idlePlan.since : Infinity,
  );
  const ended = once(() => fs.where('logs', 'endTime', '>=', Math.floor(floor), { select: ENDED_LOG_FIELDS }));
  const logsEndedSince = async (since: number): Promise<FsDoc[] | null> => {
    if (!(since >= floor)) return fs.where('logs', 'endTime', '>=', Math.floor(since), { select: ENDED_LOG_FIELDS });
    const all = await ended();
    return all ? all.filter(l => typeof l.endTime === 'number' && l.endTime >= since) : null;
  };

  const pushTo = async (targets: FsDoc[], payload: string, ttlSec: number): Promise<number> => {
    const queue = [...new Map(targets.map(s => [s.id, s])).values()];
    let sent = 0;
    const worker = async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        const r = await o.push(s, payload, ttlSec);
        if (r === 'sent') { sent++; o.run.pushesSent++; }
        else if (r === 'removed') o.run.pushesRemoved++;
        else o.run.pushesFailed++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
    return sent;
  };

  return {
    fs, push: o.push, sendEmail: o.deps.sendEmail, settings: o.settings, tz: o.tz,
    shopName: o.settings.companyName || 'FabTrack IO',
    now: o.now, nowHHMM: o.nowHHMM, today: o.today, alarms: o.alarms,
    openLogs: o.openLogs, activeLogs: o.activeLogs, clockInChecks: o.clockInChecks, idlePlan: o.idlePlan, run: o.run,
    users, subs,
    subsOf: async (userId: string) => (await subsByUser()).get(String(userId)) || [],
    runningJobs, logsEndedSince, pushTo,
  };
}

// ── Section 0: auto clock-out ─────────────────────────────────────────

/** Closes every open timer past its cutoff; returns the ids it closed. */
async function autoClockOut(
  fs: FirestoreRest, settings: SystemSettings & Record<string, any>, tz: string, nowMs: number, nowHHMM: string, openLogs: FsDoc[],
): Promise<Set<string>> {
  const cutoffs: { h: number; m: number; days?: number[] }[] = [];
  if (settings.autoClockOutEnabled) {
    const mm = (settings.autoClockOutTime || '17:30').match(/^(\d{1,2}):(\d{2})$/);
    if (mm) cutoffs.push({ h: +mm[1], m: +mm[2] });
  }
  // Any "Shift Ends" style alarm flagged as a clock-out alarm also counts —
  // matches the client sweep so the user only configures one place.
  // alarmActiveToday gates the alarm's days[] so a Mon–Fri clock-out alarm
  // does NOT force a clock-out on a Saturday overtime shift.
  // Alarm-driven cutoffs only count when the master Break & Shift Alarms
  // switch is on. (The dedicated autoClockOutEnabled path above is independent.)
  if (settings.shiftAlarmsEnabled !== false) {
    for (const a of (settings.shiftAlarms || []) as any[]) {
      // Days are checked against the day of each cutoff (below), not today:
      // a Friday shift still open on Saturday skipped its Mon–Fri clock-out
      // and ran to the 14 h net.
      if (!a?.clockOut || a.enabled === false) continue;
      const mm = (a.time || '').match(/^(\d{1,2}):(\d{2})$/);
      if (mm) cutoffs.push({ h: +mm[1], m: +mm[2], days: a.days });
    }
  }

  const SAFETY_MS = 14 * 3600 * 1000;
  const closed = new Set<string>();
  for (const log of openLogs) {
    // Corrupt log with no usable startTime — force-close it so it can't live
    // forever (the safety-net check below would NaN-skip it otherwise).
    if (typeof log.startTime !== 'number' || !log.startTime) {
      const ok0 = await fs.write('logs', log.id, {
        endTime: nowMs, durationMinutes: 0, durationSeconds: 0, status: 'completed',
        updatedAt: nowMs, pausedAt: null, stopReason: 'sweep:corrupt-no-starttime',
        isAutoClosed: true, durationAnomaly: true,
      }, { merge: true });
      if (ok0) closed.add(log.id);
      continue;
    }

    // Earliest qualifying cutoff for this log (shop timezone), so a timer is
    // closed at the right wall-clock time even across midnight.
    let stopAt: number | null = null;
    for (const c of cutoffs) {
      let cutoffMs = shopLocalTimeMs(log.startTime, tz, c.h, c.m);
      // Overnight shift: an early-morning (AM) cutoff for an evening clock-in
      // lands BEFORE the clock-in → roll to the next morning. Only for genuine
      // AM cutoffs: a PM cutoff already passed (clock back in 6pm after a
      // 5:30pm cutoff) must NOT roll ~24h — let the safety net handle it.
      // DST-safe roll: startTime+24h can land on the wrong shop-calendar day
      // across a spring-forward/fall-back boundary (23h/25h days). Anchor at
      // the SAME day's noon instead — noon+24h shifted ±1h by DST is always
      // inside the next calendar day — then rebuild the cutoff on that day.
      if (cutoffMs <= log.startTime && c.h < 12) {
        const noonSameDay = shopLocalTimeMs(log.startTime, tz, 12, 0);
        cutoffMs = shopLocalTimeMs(noonSameDay + 86400000, tz, c.h, c.m);
      }
      const cutoffDow = shopDayOfWeek(tz, cutoffMs);
      if (!alarmOnDay(c.days, cutoffDow >= 0 ? cutoffDow : new Date(cutoffMs).getDay())) continue;
      if (log.startTime < cutoffMs && nowMs > cutoffMs) {
        if (stopAt === null || cutoffMs < stopAt) stopAt = cutoffMs;
      }
    }

    // 14h safety net — always on, even with no cutoffs configured.
    const forced = (nowMs - log.startTime) > SAFETY_MS;
    const reason = stopAt !== null ? 'sweep:auto-clockout' : (forced ? 'sweep:14h-safety' : '');
    if (!reason) continue;
    const endTime = stopAt !== null ? stopAt : log.startTime + SAFETY_MS;

    // Finalize an active pause (only if it began before the cutoff — a pause
    // started after the cutoff doesn't reduce pre-cutoff work). Then compute
    // working duration exactly like stopTimeLog so records are consistent.
    // The app's own rule (utils/timeLogEdit) — whole-minute rounding here and
    // 2-decimal minutes in the app made the same session read differently.
    const { totalPausedMs, durationSeconds, durationMinutes, anomaly } = finalizeDuration(
      { startTime: log.startTime, pausedAt: log.pausedAt && log.pausedAt < endTime ? log.pausedAt : null, totalPausedMs: log.totalPausedMs || 0 },
      endTime,
    );

    const ok = await fs.write('logs', log.id, {
      endTime,
      durationMinutes,
      durationSeconds,
      status: 'completed',
      updatedAt: nowMs,
      pausedAt: null,
      totalPausedMs,
      pauseReason: null,
      stopReason: reason,
      isAutoClosed: true,
      ...(anomaly ? { durationAnomaly: true } : {}),
    }, { merge: true });
    if (ok) closed.add(log.id);
  }
  if (closed.size > 0) console.log(`${TAG} auto clock-out: ended ${closed.size} timer(s) — ${nowHHMM} ${tz}`);
  return closed;
}

/**
 * Lunch backstop. Timers paused for lunch are resumed by whichever shop
 * screen is open at lunch end; with none open (or a Wi-Fi blip then) they
 * stayed paused all afternoon and the hours were lost. Once lunch is well
 * over, resume any still paused for lunch, counting the pause as the lunch
 * length — the same rule the screens use.
 */
async function resumeLunchPauses(fs: FirestoreRest, settings: SystemSettings, nowMs: number, openLogs: FsDoc[]): Promise<number> {
  const lunch = lunchWindow(settings);
  if (!lunch) return 0;
  const GRACE_MS = 10 * 60_000;   // let the screens do it first
  let resumed = 0;
  for (const log of openLogs) {
    if (log.status !== 'paused' || log.pauseReason !== 'auto-lunch' || typeof log.pausedAt !== 'number' || log.endTime) continue;
    const lunchEndsAt = log.pausedAt + lunch.ms;
    if (nowMs < lunchEndsAt + GRACE_MS) continue;
    const ok = await fs.write('logs', log.id, {
      pausedAt: null,
      pauseReason: null,
      totalPausedMs: (log.totalPausedMs || 0) + lunch.ms,
      status: 'in_progress',
      updatedAt: nowMs,
    }, { merge: true });
    if (ok) { resumed++; log.status = 'in_progress'; log.pausedAt = null; }
  }
  if (resumed) console.log(`${TAG} lunch backstop: resumed ${resumed} timer(s)`);
  return resumed;
}

// ── Section A: shift alarm pushes — broadcast to every device ─────────

async function sectionShiftAlarms(c: Ctx): Promise<void> {
  const toFire = c.alarms.filter(a =>
    a?.enabled && a.sendPush && typeof a.time === 'string' &&
    isWithinWindow(a.time, c.nowHHMM) && alarmActiveToday(a, c.tz, c.now));

  for (const alarm of toFire) {
    // Once-per-day dedup: the cron runs every 5 min with a ±4-min window, so an
    // alarm can match two ticks. Atomic create-if-absent — a plain fetch-then-
    // write check lets two overlapping runs both send; only one can win this.
    const metaId = `shift-alarm-${alarm.id}-${c.today}`;
    if (!await c.fs.write('push_meta', metaId, { sentAt: c.now }, { mustNotExist: true })) continue;

    const [subs, users] = await Promise.all([c.subs(), c.users()]);
    if (!subs) {
      // Couldn't load the devices — release the claim so the next tick (still
      // inside the ±4-min window) sends it.
      await c.fs.remove('push_meta', metaId);
      continue;
    }
    // Deactivated people's devices don't get alarms. A device with no worker
    // on it (shop TV, kiosk) still does. If users can't be read, everyone does.
    const inactive = new Set((users || []).filter(u => !isActiveUser(u)).map(u => String(u.id)));
    const targets = subs.filter(s => !s.userId || !inactive.has(String(s.userId)));

    const label = String(alarm.label || '');
    const isClockIn  = alarm.clockIn === true;
    const isClockOut = alarm.clockOut || label.toLowerCase().includes('clock out') || label.toLowerCase().includes('shift end');

    const title = isClockIn  ? `⏰ Time to Clock In — ${c.shopName}`
                : isClockOut ? `🏁 Shift Ending — ${c.shopName}`
                             : `🔔 ${label} — ${c.shopName}`;
    const body  = isClockIn  ? `Shift starts at ${alarm.time}. Open FabTrack IO and clock in.`
                : isClockOut ? `Time to wrap up and clock out for the day.`
                             : `${label} at ${alarm.time}.`;

    const payload = JSON.stringify({
      title, body,
      tag: `shift-alarm-${alarm.id}`,
      url: '/',
      requireInteraction: isClockIn,
    });

    const before = { failed: c.run.pushesFailed, removed: c.run.pushesRemoved };
    const sent = await c.pushTo(targets, payload, 15 * 60);
    console.log(`${TAG} alarm "${label}" → sent:${sent} failed:${c.run.pushesFailed - before.failed} removed:${c.run.pushesRemoved - before.removed} (skipped ${subs.length - targets.length} deactivated)`);
  }
}

// ── Section C: missed clock-in — remind workers, admin summary ────────

async function sectionMissedClockIn(c: Ctx): Promise<void> {
  for (const { alarm, shiftStart, dayStart } of c.clockInChecks) {
    const metaId = `late-clockin-${alarm.id}-${c.today}`;
    const meta = await c.fs.get('push_meta', metaId);
    const lastSentAt = num(meta?.lastSentAt);
    const sentCount = num(meta?.sentCount);

    if (sentCount >= LATE_REMINDER_MAX) continue;                                  // gave up for today
    if (sentCount > 0 && (c.now - lastSentAt) < LATE_REMINDER_GAP_MS) continue;   // 30 min between reminders

    // Who's missing: active workers with no open timer and no log since the
    // shift start (someone between jobs DID clock in). If either list can't be
    // read, try again next tick — never nag people who are at work.
    const [users, recent] = await Promise.all([c.users(), c.logsEndedSince(shiftStart)]);
    if (!users || !recent) {
      console.warn(`${TAG} clock-in check "${alarm.label}" skipped — couldn't read users/logs`);
      continue;
    }
    const clockedIn = clockedInUserIds(c.openLogs, recent, shiftStart, dayStart);
    const notClockedIn = activeWorkers(users).filter(u => !clockedIn.has(String(u.id)));
    const reminder = sentCount + 1;

    // Claim this reminder before sending (prevents a double send if runs
    // overlap). Reminder #1 is an atomic create-if-absent; later reminders are
    // already throttled by the 30-min gate above.
    if (!meta) {
      if (!await c.fs.write('push_meta', metaId, { lastSentAt: c.now, sentCount: 1 }, { mustNotExist: true })) continue;
    } else {
      await c.fs.write('push_meta', metaId, { lastSentAt: c.now, sentCount: reminder });
    }

    if (notClockedIn.length === 0) {
      console.log(`${TAG} clock-in check "${alarm.label}" — all workers clocked in ✓`);
      continue;
    }
    console.log(`${TAG} clock-in check "${alarm.label}" — ${notClockedIn.length} missing (reminder #${reminder})`);

    // Remind each missing worker
    for (const worker of notClockedIn) {
      const workerSubs = await c.subsOf(String(worker.id));
      if (workerSubs.length === 0) continue;
      const payload = JSON.stringify({
        title: `⏰ Don't Forget to Clock In`,
        body:  `Your shift started at ${alarm.time}. Open FabTrack IO and start your timer.`,
        tag:   `clockin-reminder-${worker.id}`,
        url:   '/',
        requireInteraction: true,
      });
      await c.pushTo(workerSubs, payload, 30 * 60);
      console.log(`${TAG} reminded worker ${worker.name || worker.id} (reminder #${reminder})`);
    }

    // Admin summary push
    const admins = activeAdmins(users);
    if (admins.length > 0) {
      const names = notClockedIn.map(u => firstName(u, u.id)).join(', ');
      const adminPayload = JSON.stringify({
        title: `⚠️ ${notClockedIn.length} Worker${notClockedIn.length > 1 ? 's' : ''} Haven't Clocked In`,
        body:  `${names} ${notClockedIn.length > 1 ? 'have' : 'has'} not started a timer. Shift was ${alarm.time}.`,
        tag:   `admin-late-clockin-${alarm.id}`,
        url:   '/',
        requireInteraction: true,
      });
      for (const admin of admins) await c.pushTo(await c.subsOf(String(admin.id)), adminPayload, 30 * 60);
      console.log(`${TAG} admin notified: ${notClockedIn.length} missing (reminder #${reminder})`);
    }

    // ── Escalation email — ONCE, at the 3rd reminder (≈ 90 min late) ────
    // Pushes can be missed (phone off, notifications blocked). Email is a
    // harder-to-ignore fallback that lands in the owner's inbox directly.
    if (shouldEscalateLateClockIn(reminder, notClockedIn.length)) {
      const toEmail = c.settings.recapEmail || c.settings.alertEmail || c.settings.companyEmail;
      if (c.sendEmail && toEmail) {
        const nameList = notClockedIn.map(u => u.name || u.id).join(', ');
        const minutesLate = Math.max(0, Math.round((c.now - shiftStart) / 60000));
        const html = `
            <div style="font-family:sans-serif;background:#09090b;color:#fff;padding:32px;border-radius:12px;max-width:480px;">
              <h2 style="color:#f87171;margin:0 0 8px;">🚨 Workers Still Not Clocked In</h2>
              <p style="color:#a1a1aa;margin:0 0 16px;">Shift started at <strong style="color:#fff;">${escHtml(alarm.time)}</strong> — approximately ${minutesLate} minutes ago.</p>
              <div style="background:#1c1c1e;border-left:4px solid #f87171;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:20px;">
                <p style="margin:0;font-size:18px;font-weight:800;color:#f87171;">${notClockedIn.length} worker${notClockedIn.length > 1 ? 's' : ''} missing</p>
                <p style="margin:4px 0 0;color:#e4e4e7;">${escHtml(nameList)}</p>
              </div>
              <p style="color:#71717a;font-size:13px;margin:0;">This is reminder #${reminder}. They have been notified ${reminder} time${reminder > 1 ? 's' : ''} via push.</p>
              <p style="color:#52525b;font-size:12px;margin:12px 0 0;">— FabTrack IO</p>
            </div>`;
        const r = await c.sendEmail({
          to: [toEmail],
          subject: `🚨 ${notClockedIn.length} Worker${notClockedIn.length > 1 ? 's' : ''} Still Not Clocked In — ${alarm.time} Shift`,
          html,
        });
        // Critical escalation (workers ~90 min late) — error level + heartbeat,
        // so it surfaces instead of vanishing.
        if (r.ok) console.log(`${TAG} escalation email sent to ${toEmail} (${notClockedIn.length} missing)`);
        else noteError(c.run, 'CRITICAL escalation email', r.error);
      }
    }
  }
}

// ── Section D: admin alert — long-running timers (> 5 hours) ──────────

async function sectionLongTimers(c: Ctx): Promise<void> {
  const longRunning = c.activeLogs.filter(log =>
    !log.pausedAt && typeof log.startTime === 'number' &&             // ignore paused timers
    c.now - log.startTime - (log.totalPausedMs || 0) >= LONG_TIMER_MS);

  for (const log of longRunning) {
    // Atomic create-if-absent — only one overlapping run gets to send.
    const metaId = `long-timer-${log.id}-${c.today}`;
    if (!await c.fs.write('push_meta', metaId, { sentAt: c.now }, { mustNotExist: true })) continue;

    const users = await c.users();
    if (!users) { await c.fs.remove('push_meta', metaId); continue; }   // no recipients — retry next tick
    const job = (await c.runningJobs()).get(String(log.jobId));
    const elapsed = c.now - log.startTime - (log.totalPausedMs || 0);

    const adminPayload = JSON.stringify({
      title: `⏱ Long Timer — ${fmtElapsed(elapsed)}`,
      body:  `${log.userName || 'A worker'} has been running on ${jobLabel(job, log)} for ${fmtElapsed(elapsed)}. Might need attention.`,
      tag:   `admin-long-timer-${log.id}`,
      url:   '/',
      requireInteraction: true,
    });
    for (const admin of activeAdmins(users)) await c.pushTo(await c.subsOf(String(admin.id)), adminPayload, 60 * 60);
    console.log(`${TAG} admin alerted: long timer for ${log.userName || log.id} (${fmtElapsed(elapsed)})`);
  }
}

// ── Section F: over-estimate — running session past its operation estimate ──
// Fires once per active log session (deduped). Compares elapsed time to
// job.checklist[operation].estimatedMinutes × rateBuffer (default 1.15).
// Both admin AND the worker get a push — admin to act, worker as a heads-up.

async function sectionOverEstimate(c: Ctx): Promise<void> {
  const running = c.activeLogs.filter(l => !l.pausedAt && typeof l.startTime === 'number');   // skip paused timers
  if (running.length === 0) return;
  const rateBuffer: number = c.settings.rateBuffer ?? 1.15;
  const jobs = await c.runningJobs();

  for (const log of running) {
    const job = jobs.get(String(log.jobId));
    if (!job) continue;

    // Match log.operation to a checklist item with an estimatedMinutes
    const checklist: any[] = Array.isArray(job.checklist) ? job.checklist : [];
    const item = checklist.find((ci: any) => norm(ci?.label) === norm(log.operation));
    if (!item?.estimatedMinutes) continue;

    const elapsed  = c.now - log.startTime - (log.totalPausedMs || 0);
    const budgetMs = item.estimatedMinutes * rateBuffer * 60_000;
    if (elapsed <= budgetMs) continue; // still within estimate

    // Dedup — only fire once per active session (atomic create-if-absent)
    const metaId = `over-est-${log.id}`;
    if (!await c.fs.write('push_meta', metaId, { sentAt: c.now }, { mustNotExist: true })) continue;
    const users = await c.users();
    if (!users) { await c.fs.remove('push_meta', metaId); continue; }   // no recipients — retry next tick

    const label    = jobLabel(job, log);
    const overBy   = fmtElapsed(elapsed - budgetMs);
    const estLabel = `${item.estimatedMinutes}min`;

    // Admin push
    const adminPayload = JSON.stringify({
      title: `🚨 Over Estimate — ${log.operation}`,
      body:  `${log.userName || 'A worker'} on ${label} is ${overBy} past the ${estLabel} estimate for ${log.operation}.`,
      tag:   `admin-over-est-${log.id}`,
      url:   '/',
      requireInteraction: true,
    });
    for (const admin of activeAdmins(users)) await c.pushTo(await c.subsOf(String(admin.id)), adminPayload, 60 * 60);

    // Worker push (gentler — give them a heads-up, not a reprimand)
    const worker = users.find(u => String(u.id) === String(log.userId));
    if (!worker || isActiveUser(worker)) {
      const workerPayload = JSON.stringify({
        title: `⏱ Time Check — ${log.operation}`,
        body:  `You're ${overBy} past the estimated time on ${label}. Give your supervisor a heads up.`,
        tag:   `worker-over-est-${log.id}`,
        url:   '/',
        requireInteraction: false,
      });
      await c.pushTo(await c.subsOf(String(log.userId)), workerPayload, 60 * 60);
    }

    console.log(`${TAG} over-estimate: ${log.userName} on ${label}/${log.operation} (${fmtElapsed(elapsed)} vs ${estLabel})`);
  }
}

// ── Section E: new job notes → admins + workers on that job ───────────
// Every run, check for notes posted in the last 6 min (filtered query — one
// read per new note, min 1). Dedup per note id. Never notifies the author.

async function sectionJobNotes(c: Ctx): Promise<void> {
  const recentNotes = await c.fs.where('notes', 'timestamp', '>', Math.round(c.now - NOTES_WINDOW_MS));
  if (!recentNotes || recentNotes.length === 0) return;

  for (const note of recentNotes) {
    // Dedup — only notify once per note (atomic create-if-absent)
    const metaId = `note-notified-${note.id}`;
    if (!await c.fs.write('push_meta', metaId, { sentAt: c.now }, { mustNotExist: true })) continue;
    const users = await c.users();
    if (!users) { await c.fs.remove('push_meta', metaId); continue; }   // no recipients — retry next tick

    const preview = (note.text || '').length > 80
      ? (note.text as string).slice(0, 77) + '…'
      : note.text || '';

    const notePayload = JSON.stringify({
      title: `📝 ${note.userName || 'Someone'} left a note`,
      body:  `${note.jobLabel || note.jobId}: "${preview}"`,
      tag:   `job-note-${note.id}`,
      url:   '/',
      requireInteraction: false,
    });

    // Everyone to notify — admins + workers clocked into this job, minus the
    // author and anyone deactivated.
    const authorId = String(note.userId || '');
    const inactive = new Set(users.filter(u => !isActiveUser(u)).map(u => String(u.id)));
    const recipientIds = new Set<string>();
    for (const admin of activeAdmins(users)) {
      if (String(admin.id) !== authorId) recipientIds.add(String(admin.id));
    }
    for (const log of c.activeLogs) {
      const uid = String(log.userId || '');
      if (log.jobId === note.jobId && uid && uid !== authorId && !inactive.has(uid)) recipientIds.add(uid);
    }

    let notified = 0;
    for (const uid of recipientIds) notified += await c.pushTo(await c.subsOf(uid), notePayload, 60 * 60);
    console.log(`${TAG} note on ${note.jobLabel || note.jobId} by ${note.userName} → ${notified} notified (${recipientIds.size} recipient(s))`);
  }
}

// ── Section G: idle / gap nudge — finished a job but hasn't started another ──
// The "did a job in the AM, stopped, and never clocked back in" gap. During
// work hours, find any worker whose last timer ENDED ≥ idleMin ago with no
// timer now running (or paused). Nudge the worker, summarize for the admin.

async function sectionIdleGap(c: Ctx): Promise<void> {
  const plan = c.idlePlan;
  if (!plan) return;
  const ended = await c.logsEndedSince(plan.since);
  if (!ended) return;   // query failed (counted in the heartbeat) — next tick

  // Anyone with ANY open timer (running OR paused) is not idle.
  const busy = new Set(c.openLogs.map(l => String(l.userId || '')));
  const candidates = idleCandidates(ended, busy, c.now, plan.idleMin, plan.workStart);
  if (candidates.length === 0) return;

  // Cheap gate first — each person's nudge record for today (1 read each).
  // Escalating dedup: re-nudge every 45 min, max IDLE_NUDGE_MAX a day.
  const due: { id: string; gapMs: number; metaId: string; hasMeta: boolean; sentCount: number }[] = [];
  for (const cand of candidates) {
    const metaId = `idle-gap-${cand.id}-${c.today}`;
    const meta = await c.fs.get('push_meta', metaId);
    const sentCount = num(meta?.sentCount);
    if (sentCount >= IDLE_NUDGE_MAX) continue;
    if (sentCount > 0 && (c.now - num(meta?.lastSentAt)) < IDLE_RENUDGE_MS) continue;
    due.push({ id: cand.id, gapMs: cand.gapMs, metaId, hasMeta: !!meta, sentCount });
  }
  if (due.length === 0) return;

  const users = await c.users();
  if (!users) return;   // can't tell admins / deactivated people apart — next tick
  const userById = new Map(users.map(u => [String(u.id), u]));

  const nudgedNames: string[] = [];
  for (const d of due) {
    const worker = userById.get(d.id);
    // Admins/owners, deactivated and deleted people are never nudged. Mark them
    // done for today so later ticks stop at the cheap check above instead of
    // reloading the user list every 5 minutes.
    if (!worker || isAdminUser(worker) || !isActiveUser(worker)) {
      await c.fs.write('push_meta', d.metaId, { lastSentAt: c.now, sentCount: IDLE_NUDGE_MAX, skipped: true }, { mustNotExist: !d.hasMeta });
      continue;
    }

    // First nudge of the day: atomic create-if-absent so two overlapping
    // runs can't both fire it; re-nudges are throttled 45 min apart.
    if (!d.hasMeta) {
      if (!await c.fs.write('push_meta', d.metaId, { lastSentAt: c.now, sentCount: 1 }, { mustNotExist: true })) continue;
    } else {
      await c.fs.write('push_meta', d.metaId, { lastSentAt: c.now, sentCount: d.sentCount + 1 });
    }
    nudgedNames.push(firstName(worker, d.id));

    const wPayload = JSON.stringify({
      title: `⏱ Start Your Next Job`,
      body:  `You finished a job ${fmtElapsed(d.gapMs)} ago and no timer is running. Open FabTrack IO and clock into your next job.`,
      tag:   `idle-gap-${d.id}`,
      url:   '/',
      requireInteraction: true,
    });
    await c.pushTo(await c.subsOf(d.id), wPayload, 30 * 60);
    console.log(`${TAG} idle-gap nudge: ${worker.name || d.id} idle ${fmtElapsed(d.gapMs)} (#${d.sentCount + 1})`);
  }

  // Admin summary — only when we actually nudged someone this run.
  if (nudgedNames.length > 0) {
    const aPayload = JSON.stringify({
      title: `😴 ${nudgedNames.length} Worker${nudgedNames.length > 1 ? 's' : ''} Idle Between Jobs`,
      body:  `${nudgedNames.join(', ')} ${nudgedNames.length > 1 ? 'have' : 'has'} no timer running. They've been reminded to clock into their next job.`,
      tag:   `admin-idle-gap-${c.today}`,
      url:   '/',
      requireInteraction: false,
    });
    for (const admin of activeAdmins(users)) await c.pushTo(await c.subsOf(String(admin.id)), aPayload, 30 * 60);
  }
}

// ── Scheduled entry point ─────────────────────────────────────────────

export default async function handler() {
  const apiKey    = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || 'AIzaSyChOewBMJeW3oAM4KYn6ergrGIV9bPHTC8';
  const projectId = process.env.FIREBASE_PROJECT_ID || 'sc-job-tracker';
  const resendKey = process.env.RESEND_API_KEY;

  const fs = createFirestoreRest({ apiKey, projectId, label: 'shift-push-cron' });
  // Auto clock-out only needs Firestore. Push needs VAPID too — a shop that
  // never set up push still gets reliable auto clock-out.
  const { push, error: setupError } = createWebPushSender({
    fs,
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT || 'mailto:hello@fabtrack.io',
    label: 'shift-push-cron',
  });
  const sendEmail = resendKey ? createResendSender(resendKey, process.env.RESEND_FROM || DEFAULT_EMAIL_FROM) : null;

  await runShiftPushCron({ fs, push, sendEmail, setupError });
}
