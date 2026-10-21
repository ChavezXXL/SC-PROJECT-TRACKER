/**
 * Shift alarm rules that don't touch the browser — shared by the app
 * (services/shiftAlarms) and the server cron, so both read lunch and the
 * active alarms the same way.
 */
import type { ShiftAlarm, SystemSettings } from '../types';

/**
 * An alarm's weekdays as numbers (0 = Sunday … 6 = Saturday). The shop's
 * saved alarms have them as TEXT ("1", "2"…) — written by an older screen —
 * and every check compared them to a number, so no alarm with days set ever
 * fired: no shift-end reminder push, no in-app bell, no day-gated cut-off.
 * Empty = every day.
 */
export function alarmDays(days: unknown): number[] {
  if (!Array.isArray(days)) return [];
  return days.map(d => Number(d)).filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
}

/** Does an alarm with these days apply on weekday `dow`? */
export const alarmOnDay = (days: unknown, dow: number) => { const d = alarmDays(days); return d.length === 0 || d.includes(dow); };

/**
 * The lunch break, as the alarms define it: the first enabled "Pause Timers"
 * alarm to the first enabled "Resume Timers" alarm after it. ONE source for
 * every screen — the shared floor/TV screens used a separate hidden
 * 12:00–12:30 window, so moving the lunch alarms paused people twice (an
 * hour off for a 30-minute lunch) or resumed them mid-lunch. Null when the
 * alarms are off or no lunch is set.
 */
export function lunchWindow(settings: SystemSettings): { start: string; end: string; ms: number } | null {
  const alarms = getActiveAlarms(settings).filter(a => a.enabled !== false && /^\d{1,2}:\d{2}$/.test(a.time || ''));
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const pause = alarms.filter(a => a.pauseTimers).sort((a, b) => toMin(a.time) - toMin(b.time))[0];
  if (!pause) return null;
  const resume = alarms.filter(a => a.resumeTimers && toMin(a.time) > toMin(pause.time)).sort((a, b) => toMin(a.time) - toMin(b.time))[0];
  if (!resume) return null;
  const pad = (t: string) => t.padStart(5, '0');
  return { start: pad(pause.time), end: pad(resume.time), ms: (toMin(resume.time) - toMin(pause.time)) * 60_000 };
}

/**
 * Hours in the shop's working week, from its own alarms: clock-in to
 * clock-out each day both apply, minus the lunch break. The 2026-10 schedule
 * (5:00 → 3:00, 9:30–10:00 break, Mon–Fri) gives 47.5. An optional early
 * finish is a reminder, not a clock-out, so it doesn't shorten the day.
 * Null when the alarms don't say when the day starts and ends.
 */
export function weeklyShiftHours(settings: SystemSettings): number | null {
  const mins = shiftMinutesByDay(settings).reduce((a, m) => a + m, 0);
  return mins > 0 ? Math.round(mins / 30) / 2 : null;
}

/** Hours in one working day (9.5 for 5:00–3:00 with a half-hour break). Null when unknown. */
export function workdayHours(settings: SystemSettings): number | null {
  const days = shiftMinutesByDay(settings).filter(m => m > 0);
  return days.length ? Math.round(days.reduce((a, m) => a + m, 0) / days.length / 30) / 2 : null;
}

/** Paid minutes of each weekday (0 = Sunday), from the alarms; 0 = no shift. */
function shiftMinutesByDay(settings: SystemSettings): number[] {
  const toMin = (t?: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
  const alarms = getActiveAlarms(settings).filter(a => a.enabled !== false && toMin(a.time) !== null);
  const lunch = lunchWindow(settings);
  return [0, 1, 2, 3, 4, 5, 6].map(dow => {
    const today = alarms.filter(a => alarmOnDay(a.days, dow));
    const start = Math.min(...today.filter(a => a.clockIn).map(a => toMin(a.time)!));
    const end = Math.max(...today.filter(a => a.clockOut).map(a => toMin(a.time)!));
    if (!isFinite(start) || !isFinite(end) || end <= start) return 0;
    return Math.max(0, end - start - (lunch ? lunch.ms / 60_000 : 0));
  });
}

export function getActiveAlarms(settings: SystemSettings): ShiftAlarm[] {
  // Master switch — when off, nothing fires.
  if (settings.shiftAlarmsEnabled === false) return [];
  // Prefer explicit shiftAlarms array. When absent, synthesize from legacy fields.
  if (settings.shiftAlarms && settings.shiftAlarms.length > 0) return settings.shiftAlarms;
  const legacy: ShiftAlarm[] = [];
  if (settings.autoLunchPauseEnabled) {
    if (settings.lunchStart) legacy.push({ id: 'legacy-lunch-start', label: 'Lunch starts', time: settings.lunchStart, enabled: true, sound: 'bell', pauseTimers: true });
    if (settings.lunchEnd)   legacy.push({ id: 'legacy-lunch-end',   label: 'Back to work', time: settings.lunchEnd,   enabled: true, sound: 'chime', resumeTimers: true });
  }
  if (settings.autoClockOutEnabled && settings.autoClockOutTime) {
    legacy.push({ id: 'legacy-clockout', label: 'Shift ends — clock out', time: settings.autoClockOutTime, enabled: true, sound: 'bell', clockOut: true });
  }
  return legacy;
}
