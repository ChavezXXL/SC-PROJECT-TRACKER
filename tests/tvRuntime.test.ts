import { hhmmToMinutes, inQuietHours, isTvQuiet, tvQuietUntil, resumeLabel, msUntilDailyRefresh, describeDevice } from '../utils/tvRuntime';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };
const at = (h: number, m = 0, d = 15) => new Date(2026, 9, d, h, m, 0, 0).getTime();   // Oct 2026
const HOUR = 3_600_000;

// ── Clock strings ─────────────────────────────────────────────────
ok('17:30 → 1050', hhmmToMinutes('17:30') === 1050);
ok('5:05 → 305', hhmmToMinutes('5:05') === 305);
ok('24:00 rejected', hhmmToMinutes('24:00') === null);
ok('garbage rejected', hhmmToMinutes('5pm') === null && hhmmToMinutes('') === null && hhmmToMinutes(undefined) === null);

// ── Quiet hours ───────────────────────────────────────────────────
ok('overnight window: 23:00 inside 18:00→05:00', inQuietHours(23 * 60, '18:00', '05:00'));
ok('overnight window: 02:00 inside', inQuietHours(2 * 60, '18:00', '05:00'));
ok('overnight window: 05:00 is the end (not inside)', !inQuietHours(5 * 60, '18:00', '05:00'));
ok('overnight window: noon outside', !inQuietHours(12 * 60, '18:00', '05:00'));
ok('same-day window: 13:00 inside 12:00→14:00', inQuietHours(13 * 60, '12:00', '14:00'));
ok('same-day window: 15:00 outside', !inQuietHours(15 * 60, '12:00', '14:00'));
ok('start == end → never quiet', !inQuietHours(600, '06:00', '06:00'));
ok('unreadable times → never quiet (never blank the board by accident)', !inQuietHours(600, 'x', '05:00'));

// ── Quiet days + "resumes Monday at 5:00 AM" ──────────────────────
{
  const nightly = { enabled: true, start: '18:00', end: '05:00' };
  const weekends = { ...nightly, days: [0, 6] };
  const d = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m, 0, 0);   // Oct 2026: 16 = Fri, 17 = Sat, 19 = Mon
  ok('fixture: Oct 16 2026 is a Friday', d(16, 12).getDay() === 5);
  ok('switched off → never quiet', !isTvQuiet({ ...weekends, enabled: false }, d(17, 12)));
  ok('missing settings → never quiet', !isTvQuiet(undefined, d(17, 12)) && tvQuietUntil(undefined, d(17, 12)) === null);
  ok('Saturday noon is quiet (quiet day)', isTvQuiet(weekends, d(17, 12)));
  ok('Friday noon is not quiet', !isTvQuiet(weekends, d(16, 12)));
  ok('not quiet → no resume time', tvQuietUntil(weekends, d(16, 12)) === null);
  const fri = tvQuietUntil(weekends, d(16, 19));
  ok('Friday 7 PM → back Monday 5:00 AM (skips the weekend)', !!fri && fri.getDay() === 1 && fri.getHours() === 5 && fri.getMinutes() === 0);
  const tue = tvQuietUntil(nightly, d(13, 22));
  ok('Tuesday 10 PM → back Wednesday 5:00 AM', !!tue && tue.getDate() === 14 && tue.getHours() === 5);
  const satOnly = tvQuietUntil({ enabled: true, start: '06:00', end: '06:00', days: [6] }, d(17, 10));
  ok('quiet day with no nightly window → back at midnight', !!satOnly && satOnly.getDate() === 18 && satOnly.getHours() === 0);
  ok('every day quiet → no resume time', tvQuietUntil({ ...nightly, days: [0, 1, 2, 3, 4, 5, 6] }, d(16, 12)) === null);
  ok('overnight label is just the time', resumeLabel(d(14, 5), d(13, 22)) === 'at 5:00 AM');
  ok('weekend label names the day', resumeLabel(d(19, 5), d(16, 19)) === 'Monday at 5:00 AM');
}

// ── Daily refresh (default 3 AM) ──────────────────────────────────
ok('2 PM → refresh tonight at 3 AM (13 h)', msUntilDailyRefresh(3, at(14)) === 13 * HOUR);
ok('1 AM → refresh at 3 AM today (2 h)', msUntilDailyRefresh(3, at(1)) === 2 * HOUR);
ok('2:45 AM (<30 min away) → skip to tomorrow', msUntilDailyRefresh(3, at(2, 45)) === 24 * HOUR + 15 * 60_000);
ok('just started at 3:00 → tomorrow, not now', msUntilDailyRefresh(3, at(3)) === 24 * HOUR);
ok('never mid-shift: 9 AM-5 PM all land at the night hour', [9, 10, 12, 15, 17].every(h => new Date(at(h) + msUntilDailyRefresh(3, at(h))).getHours() === 3));
ok('bad hour falls back to 3 AM', new Date(at(14) + msUntilDailyRefresh(NaN, at(14))).getHours() === 3);
ok('hour clamped to 0-23', new Date(at(14) + msUntilDailyRefresh(99, at(14))).getHours() === 23);
{
  // US DST ends Sun Nov 1 2026 (clocks 2:00 → 1:00). Refresh must still land at 3:00.
  const sat = new Date(2026, 9, 31, 22, 0, 0).getTime();
  const when = new Date(sat + msUntilDailyRefresh(3, sat));
  ok('DST change night still refreshes at 3:00 local', when.getHours() === 3 && when.getDate() === 1);
}

// ── Device names for the office list ──────────────────────────────
ok('Samsung', describeDevice('Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36') === 'Samsung TV (Tizen)');
ok('LG', describeDevice('Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36') === 'LG TV (webOS)');
ok('Fire TV', describeDevice('Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7233) Silk/90') === 'Amazon Fire TV');
ok('Windows', describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120') === 'Windows PC');

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
