// ═════════════════════════════════════════════════════════════════════
// Timekeeping Health — the watchdog brain for payroll-sensitive time data.
//
// Pure function: give it the logs/jobs/users/settings and it returns a ranked
// list of concrete problems in plain English. No side effects, safe to run on
// every render (memoize it). Every check here maps to a real corruption mode
// found in the time-tracking audit — the point is that bad data gets SEEN and
// called out, instead of silently flowing into payroll and rate-learning.
//
// It also watches the server cron's heartbeat, so if the 24/7 auto-clock-out
// ever stops running, that itself becomes a loud, visible issue.
// ═════════════════════════════════════════════════════════════════════

import type { Job, TimeLog, User, SystemSettings } from '../types';
import { shopLocalTimeMs, shopDayOfWeek } from './timezone';

export type HealthSeverity = 'critical' | 'warning' | 'info';

export interface TimekeepingIssue {
  id: string;
  severity: HealthSeverity;
  category: string;       // short tag, e.g. "Overlap", "Orphan", "Cron"
  title: string;          // one-line headline
  detail: string;         // plain-English explanation with names/counts
  count: number;          // how many records/workers affected
  logIds?: string[];      // affected log ids (for drill-down)
}

export interface TimekeepingHealth {
  issues: TimekeepingIssue[];
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  checkedLogs: number;
  cronAlive: boolean | null;   // null = unknown (no heartbeat data passed)
  generatedAt: number;
}

const HOUR = 3600000;
const logMins = (l: TimeLog): number =>
  l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0);
const firstName = (n?: string) => (n || '').split(' ')[0] || 'Someone';
/** Join up to `max` names, then "+N more". */
const nameList = (names: string[], max = 4): string => {
  const uniq = [...new Set(names)];
  if (uniq.length <= max) return uniq.join(', ');
  return `${uniq.slice(0, max).join(', ')} +${uniq.length - max} more`;
};

export interface HealthInput {
  logs: TimeLog[];
  jobs: Job[];
  users: User[];
  settings: SystemSettings;
  now?: number;
  /** push_meta/cron-heartbeat lastRunMs — pass null/undefined if unknown. */
  cronLastRunMs?: number | null;
  /** How many days back to scan completed logs for patterns (default 45). */
  windowDays?: number;
}

export function computeTimekeepingHealth(input: HealthInput): TimekeepingHealth {
  const { logs, jobs, users, settings } = input;
  const now = input.now ?? Date.now();
  const windowMs = (input.windowDays ?? 45) * 24 * HOUR;
  const cutoff = now - windowMs;
  const issues: TimekeepingIssue[] = [];

  // Real worker sessions only — exclude admin-seeded rate samples.
  const real = logs.filter(l => !l.isSample);
  const open = real.filter(l => !l.endTime);
  const recentDone = real.filter(l => l.endTime && (l.endTime >= cutoff));

  const maxShiftMs = ((settings as any).maxShiftHours || 14) * HOUR;

  // ── 1. Overlapping ACTIVE timers (one worker clocked into 2 jobs now) ──
  const openByUser = new Map<string, TimeLog[]>();
  for (const l of open) {
    if (!l.userId) continue;
    (openByUser.get(l.userId) || openByUser.set(l.userId, []).get(l.userId)!).push(l);
  }
  const dblActive = [...openByUser.values()].filter(arr => arr.length > 1);
  if (dblActive.length) {
    const names = dblActive.map(arr => firstName(arr[0].userName));
    issues.push({
      id: 'overlap-active',
      severity: 'critical',
      category: 'Overlap',
      title: `${dblActive.length} worker${dblActive.length > 1 ? 's are' : ' is'} clocked into 2+ jobs at once`,
      detail: `${nameList(names)} ${dblActive.length > 1 ? 'have' : 'has'} more than one running timer right now — the same minutes are being billed to multiple jobs. Stop the extra timers.`,
      count: dblActive.length,
      logIds: dblActive.flat().map(l => l.id),
    });
  }

  // ── 2. Overlapping COMPLETED sessions for one worker (double-paid time) ──
  const overlapLogIds: string[] = [];
  const overlapNames: string[] = [];
  const doneByUser = new Map<string, TimeLog[]>();
  for (const l of recentDone) {
    if (!l.userId || !l.startTime || !l.endTime) continue;
    (doneByUser.get(l.userId) || doneByUser.set(l.userId, []).get(l.userId)!).push(l);
  }
  for (const arr of doneByUser.values()) {
    arr.sort((a, b) => a.startTime - b.startTime);
    let maxEnd = -Infinity;
    for (const l of arr) {
      if (l.startTime < maxEnd) { overlapLogIds.push(l.id); overlapNames.push(firstName(l.userName)); }
      if (l.endTime! > maxEnd) maxEnd = l.endTime!;
    }
  }
  if (overlapLogIds.length) {
    issues.push({
      id: 'overlap-done',
      severity: 'critical',
      category: 'Overlap',
      title: `${overlapLogIds.length} overlapping time entries (double-counted hours)`,
      detail: `${nameList(overlapNames)} have completed sessions whose times overlap — the same minutes are counted twice in payroll and job cost. Review and trim these in Logs.`,
      count: overlapLogIds.length,
      logIds: overlapLogIds,
    });
  }

  // ── 3. Impossible / corrupt durations on completed logs ──
  const corrupt: string[] = [];
  for (const l of recentDone) {
    const wall = (l.endTime || 0) - (l.startTime || 0);
    const paused = l.totalPausedMs || 0;
    const bad =
      (l as any).durationAnomaly === true ||
      (l.endTime! < l.startTime) ||
      (paused > Math.max(0, wall) + 1000) ||
      (l.pausedAt != null) ||                                // completed but still "paused"
      (logMins(l) === 0 && wall > 2 * 60 * 1000);            // real span recorded as 0 min
    if (bad) corrupt.push(l.id);
  }
  if (corrupt.length) {
    issues.push({
      id: 'corrupt-duration',
      severity: 'critical',
      category: 'Bad data',
      title: `${corrupt.length} time record${corrupt.length > 1 ? 's have' : ' has'} an impossible duration`,
      detail: `These logs have an end before their start, more paused time than elapsed, or a real span recorded as 0 minutes — usually a device-clock or edit error. They corrupt payroll until fixed in Logs.`,
      count: corrupt.length,
      logIds: corrupt,
    });
  }

  // ── 4. Absurdly long sessions (forgotten clock-outs / 14h safety) ──
  const absurd: string[] = [];
  let safetyClosedToday = 0;
  const todayStart = (() => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  for (const l of recentDone) {
    if (logMins(l) * 60000 > maxShiftMs) absurd.push(l.id);
    if (l.stopReason === 'sweep:14h-safety' && (l.endTime || 0) >= todayStart) safetyClosedToday++;
  }
  if (absurd.length) {
    issues.push({
      id: 'absurd-duration',
      severity: 'warning',
      category: 'Forgot clock-out',
      title: `${absurd.length} session${absurd.length > 1 ? 's' : ''} longer than ${Math.round(maxShiftMs / HOUR)}h`,
      detail: `Someone forgot to clock out. These got closed by the safety net at the maximum length, so the hours are likely overstated — verify before payroll.`,
      count: absurd.length,
      logIds: absurd,
    });
  }

  // ── 5. Orphan / stale ACTIVE timers (running way too long) ──
  const stale: string[] = [];
  const staleNames: string[] = [];
  for (const l of open) {
    if (!l.startTime) { stale.push(l.id); continue; }
    if ((now - l.startTime) > maxShiftMs) { stale.push(l.id); staleNames.push(firstName(l.userName)); }
  }
  if (stale.length) {
    issues.push({
      id: 'stale-active',
      severity: 'warning',
      category: 'Forgot clock-out',
      title: `${stale.length} timer${stale.length > 1 ? 's' : ''} running over ${Math.round(maxShiftMs / HOUR)}h right now`,
      detail: `${nameList(staleNames)} appear${staleNames.length === 1 ? 's' : ''} to still be clocked in from a previous shift. They'll be auto-closed by the safety net, but the recorded time will be wrong — clock them out manually.`,
      count: stale.length,
      logIds: stale,
    });
  }

  // ── 6. Stuck-paused timers (paused and abandoned) ──
  const paused2h: string[] = [];
  const paused6h: string[] = [];
  const pausedNames: string[] = [];
  for (const l of open) {
    if (!l.pausedAt) continue;
    const pausedFor = now - l.pausedAt;
    if (pausedFor > 6 * HOUR) { paused6h.push(l.id); pausedNames.push(firstName(l.userName)); }
    else if (pausedFor > 2 * HOUR) paused2h.push(l.id);
  }
  if (paused6h.length) {
    issues.push({
      id: 'stuck-paused',
      severity: 'warning',
      category: 'Stuck paused',
      title: `${paused6h.length} timer${paused6h.length > 1 ? 's' : ''} paused for 6+ hours`,
      detail: `${nameList(pausedNames)} paused and never resumed — likely a forgotten lunch/break pause. No time is accruing. Resume or clock them out.`,
      count: paused6h.length,
      logIds: paused6h,
    });
  } else if (paused2h.length) {
    issues.push({
      id: 'stuck-paused-2h',
      severity: 'info',
      category: 'Stuck paused',
      title: `${paused2h.length} timer${paused2h.length > 1 ? 's' : ''} paused over 2 hours`,
      detail: `Paused a while ago and not resumed — worth a glance in case it was forgotten.`,
      count: paused2h.length,
      logIds: paused2h,
    });
  }

  // ── 7. Orphan references (log points at a deleted job or unknown worker) ──
  const jobIds = new Set(jobs.map(j => j.id));
  const userIds = new Set(users.map(u => u.id));
  const orphan: string[] = [];
  for (const l of recentDone.concat(open)) {
    const jobMissing = l.jobId && !jobIds.has(l.jobId) && !String(l.jobId).startsWith('sample');
    const userMissing = l.userId && !userIds.has(l.userId) && l.userName !== 'Sample Entry';
    if (jobMissing || userMissing) orphan.push(l.id);
  }
  if (orphan.length) {
    issues.push({
      id: 'orphan-refs',
      severity: 'warning',
      category: 'Orphan',
      title: `${orphan.length} log${orphan.length > 1 ? 's' : ''} point to a deleted job or worker`,
      detail: `These hours can't be attributed to a real job/worker, so they show up in shop totals but not in any job's cost — totals won't reconcile. Reassign or remove them.`,
      count: orphan.length,
      logIds: orphan,
    });
  }

  // ── 8. Missing required fields on completed logs ──
  const missing: string[] = [];
  for (const l of recentDone) {
    if (!l.userId || !l.operation || !(l.operation || '').trim()) missing.push(l.id);
  }
  if (missing.length) {
    issues.push({
      id: 'missing-fields',
      severity: 'warning',
      category: 'Bad data',
      title: `${missing.length} log${missing.length > 1 ? 's are' : ' is'} missing a worker or operation`,
      detail: `Blank operation or worker breaks rate-learning and per-operation reporting for these sessions.`,
      count: missing.length,
      logIds: missing,
    });
  }

  // ── 9. Auto-clock-out MISSED its window (14h safety had to catch it today) ──
  if (safetyClosedToday > 0) {
    issues.push({
      id: 'cutoff-missed',
      severity: 'warning',
      category: 'Auto clock-out',
      title: `Auto clock-out missed ${safetyClosedToday} timer${safetyClosedToday > 1 ? 's' : ''} today`,
      detail: `${safetyClosedToday} session${safetyClosedToday > 1 ? 's were' : ' was'} closed by the 14-hour backstop instead of your configured clock-out time — the recorded end is wrong. Check that your auto clock-out time and timezone are set in Settings.`,
      count: safetyClosedToday,
    });
  }

  // ── 10. Timezone not configured while auto-clock-out is on ──
  const clockOutOn = settings.autoClockOutEnabled ||
    (settings.shiftAlarms || []).some((a: any) => a?.clockOut && a.enabled !== false);
  if (clockOutOn && !(settings as any).recapTimezone) {
    issues.push({
      id: 'tz-unset',
      severity: 'warning',
      category: 'Config',
      title: 'Auto clock-out is on, but no timezone is set',
      detail: `Clock-out times are being computed in Pacific time by default. If your shop isn't on Pacific, workers clock out at the wrong hour. Set your timezone in Settings → Daily Email Recap.`,
      count: 1,
    });
  }

  // ── 11. Cron heartbeat — is the 24/7 auto-clock-out actually alive? ──
  let cronAlive: boolean | null = null;
  if (input.cronLastRunMs != null) {
    const age = now - input.cronLastRunMs;
    cronAlive = age <= 20 * 60000; // 4 missed 5-min runs = dead
    if (!cronAlive) {
      const mins = Math.round(age / 60000);
      issues.push({
        id: 'cron-dead',
        severity: 'critical',
        category: 'System',
        title: `Auto clock-out engine hasn't run in ${mins >= 120 ? Math.round(mins / 60) + 'h' : mins + ' min'}`,
        detail: `The background service that clocks workers out 24/7 has gone silent. Timers will NOT auto-close until it's back. Check the Netlify deploy/credits, then re-deploy.`,
        count: 1,
      });
    }
  }

  // ── 12. PATTERN: chronic forgetters (high share of forced stops) ──
  const byWorker = new Map<string, { total: number; forced: number; name: string }>();
  for (const l of recentDone) {
    if (!l.userId) continue;
    const e = byWorker.get(l.userId) || { total: 0, forced: 0, name: firstName(l.userName) };
    e.total++;
    if (l.stopReason && /^sweep:|^alarm:|^admin:/.test(l.stopReason)) e.forced++;
    byWorker.set(l.userId, e);
  }
  const forgetters = [...byWorker.values()]
    .filter(e => e.total >= 5 && e.forced / e.total >= 0.4)
    .sort((a, b) => (b.forced / b.total) - (a.forced / a.total));
  if (forgetters.length) {
    const top = forgetters.map(e => `${e.name} (${Math.round((e.forced / e.total) * 100)}%)`);
    issues.push({
      id: 'chronic-forgetters',
      severity: 'info',
      category: 'Pattern',
      title: `${forgetters.length} worker${forgetters.length > 1 ? 's' : ''} routinely don't clock out`,
      detail: `${nameList(top)} — their timers get force-closed by the system most of the time, so their recorded hours are unreliable. Worth a conversation.`,
      count: forgetters.length,
    });
  }

  // ── 13. IDLE / GAP — worked earlier today but went quiet during work hours ──
  // Catches "did a job in the AM, stopped, hasn't started another." Only during
  // the shop's working window (Mon–Sat), so end-of-day isn't flagged.
  const tz = (settings as any).recapTimezone || 'America/Los_Angeles';
  const dow = shopDayOfWeek(tz, now);
  const dayStartShop = shopLocalTimeMs(now, tz, 0, 0);
  const minsSinceMidnight = (now - dayStartShop) / 60000;
  const coMatch = (settings.autoClockOutTime || '17:30').match(/^(\d{1,2}):(\d{2})$/);
  const workEndMin = coMatch ? (+coMatch[1] * 60 + +coMatch[2]) : 17 * 60 + 30;
  const inWorkHours = dow !== 0 && minsSinceMidnight >= 6 * 60 && minsSinceMidnight <= workEndMin;
  const idleMin = (settings as any).idleAlertMinutes || 75; // grace > a long lunch

  if (inWorkHours) {
    const openUserIds = new Set(open.map(l => l.userId));
    const lastEndToday = new Map<string, { ms: number; name: string }>();
    for (const l of real) {
      if (!l.userId || !l.endTime || l.endTime < dayStartShop) continue;
      const cur = lastEndToday.get(l.userId);
      if (!cur || l.endTime > cur.ms) lastEndToday.set(l.userId, { ms: l.endTime, name: firstName(l.userName) });
    }
    const idle: { name: string; mins: number }[] = [];
    for (const [uid, info] of lastEndToday) {
      if (openUserIds.has(uid)) continue;        // currently clocked in → not idle
      const gapMin = (now - info.ms) / 60000;
      if (gapMin >= idleMin) idle.push({ name: info.name, mins: Math.round(gapMin) });
    }
    idle.sort((a, b) => b.mins - a.mins);
    if (idle.length) {
      const labels = idle.map(i => `${i.name} (${i.mins >= 120 ? (i.mins / 60).toFixed(1) + 'h' : i.mins + 'm'})`);
      issues.push({
        id: 'idle-workers',
        severity: 'warning',
        category: 'Idle',
        title: `${idle.length} worker${idle.length > 1 ? 's' : ''} clocked in earlier but ${idle.length > 1 ? 'are' : 'is'} idle now`,
        detail: `${nameList(labels)} worked today but ${idle.length > 1 ? 'have' : 'has'} no timer running and ${idle.length > 1 ? "haven't" : "hasn't"} started another job. Gap shown per worker — check if they're between jobs or slacking.`,
        count: idle.length,
      });
    }
  }

  // ── 14. OVER-PACE — a running job is past its expected/budgeted time ──
  const overPace: { label: string; at: number; exp: number }[] = [];
  for (const l of open) {
    if (l.pausedAt) continue;
    const job = jobs.find(j => j.id === l.jobId);
    const exp = job?.expectedHours || 0;
    if (!exp || !l.startTime) continue;
    const elapsedH = Math.max(0, (now - l.startTime - (l.totalPausedMs || 0))) / HOUR;
    if (elapsedH > exp * 1.25) {
      overPace.push({ label: job?.poNumber || l.jobIdsDisplay || firstName(l.userName), at: elapsedH, exp });
    }
  }
  if (overPace.length) {
    overPace.sort((a, b) => (b.at / b.exp) - (a.at / a.exp));
    const labels = overPace.slice(0, 5).map(o => `${o.label} (${o.at.toFixed(1)}h of ${o.exp}h)`);
    issues.push({
      id: 'over-pace',
      severity: 'warning',
      category: 'Over pace',
      title: `${overPace.length} running job${overPace.length > 1 ? 's are' : ' is'} taking longer than expected`,
      detail: `${nameList(labels)} — already past the budgeted time and still running. Either the estimate was low or the job hit a snag. Check in.`,
      count: overPace.length,
    });
  }

  // Rank: critical → warning → info, then by count desc
  const order: Record<HealthSeverity, number> = { critical: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);

  return {
    issues,
    criticalCount: issues.filter(i => i.severity === 'critical').length,
    warningCount: issues.filter(i => i.severity === 'warning').length,
    infoCount: issues.filter(i => i.severity === 'info').length,
    checkedLogs: real.length,
    cronAlive,
    generatedAt: now,
  };
}
