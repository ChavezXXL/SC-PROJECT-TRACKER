import { hhmmToMinutes, inQuietHours, isTvQuiet, tvQuietUntil, resumeLabel, msUntilDailyRefresh, describeDevice, shopClock, describePrevSession, startTvSession, setTvExitReason, tvEvent, readPrevTvLog, deviceModel, isUnplannedExit, takeInputCounts } from '../utils/tvRuntime';

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

// ── 12 AM refresh on the night clocks fall back (was a reload loop) ──
{
  const LA = 'America/Los_Angeles';
  // Nov 1 2026: clocks fall back at 2 AM; the day is 25 hours long.
  const tenAm = Date.UTC(2026, 10, 1, 18, 0);          // 10:00 AM PST
  ok('fall-back day, 12 AM refresh, 10 AM → 14 h (next midnight)', msUntilDailyRefresh(0, tenAm, LA) === 14 * HOUR);
  const justAfterMidnight = Date.UTC(2026, 10, 1, 7, 10); // 12:10 AM PDT
  const wait = msUntilDailyRefresh(0, justAfterMidnight, LA);
  ok('fall-back day, 12:10 AM → tomorrow midnight (25 h day)', wait === 24 * HOUR + 50 * 60_000);
  for (const h of [0, 3, 12, 23]) {
    let positive = true;
    for (let t = Date.UTC(2026, 10, 1, 7, 0); t < Date.UTC(2026, 10, 2, 9, 0); t += 20 * 60_000) {
      if (msUntilDailyRefresh(h, t, LA) < 30 * 60_000) positive = false;
    }
    ok(`refresh hour ${h}: never sooner than 30 min across the fall-back day`, positive);
  }
  // Device-clock path (no shop timezone) — same rule from the calendar.
  const local = new Date(2026, 10, 1, 10, 0).getTime();
  const when = new Date(local + msUntilDailyRefresh(0, local));
  ok('device clock: 12 AM refresh lands on the next calendar day at 0:00', when.getDate() === 2 && when.getHours() === 0);
}

// ── Quiet hours run on SHOP time, not the TV's clock setting ──────
{
  const fri7pmNY = Date.UTC(2026, 9, 16, 23, 0);   // Fri 7 PM in New York (EDT)
  ok('shopClock: New York minutes + weekday', shopClock(fri7pmNY, 'America/New_York').minutes === 19 * 60 && shopClock(fri7pmNY, 'America/New_York').day === 5);
  ok('shopClock: Tokyo is already Saturday 8 AM', shopClock(fri7pmNY, 'Asia/Tokyo').day === 6 && shopClock(fri7pmNY, 'Asia/Tokyo').minutes === 8 * 60);
  ok('shopClock: unknown timezone falls back to the device clock', Number.isFinite(shopClock(fri7pmNY, 'Not/AZone').minutes));
  const nightly = { enabled: true, start: '18:00', end: '05:00' };
  ok('7 PM shop time is quiet', isTvQuiet(nightly, new Date(fri7pmNY), 'America/New_York'));
  ok('noon shop time is not quiet', !isTvQuiet(nightly, new Date(Date.UTC(2026, 9, 16, 16, 0)), 'America/New_York'));
  const back = tvQuietUntil({ ...nightly, days: [0, 6] }, new Date(fri7pmNY), 'America/New_York');
  ok('weekend quiet in New York → back Monday 5:00 AM New York time', !!back && back.getTime() === Date.UTC(2026, 9, 19, 9, 0));
}

// ── How the previous TV session ended (office health line) ────────
{
  const t = new Date(2026, 9, 15, 11, 8).getTime();
  ok('first start → nothing to report', describePrevSession(null) === '');
  ok('unreadable record → nothing to report', describePrevSession('{oops') === '');
  ok('planned reload names its reason', describePrevSession(JSON.stringify({ startedAt: t - 3600_000, lastBeat: t, exit: 'nightly refresh', exitAt: t })).startsWith('nightly refresh ('));
  const crash = describePrevSession(JSON.stringify({ startedAt: t - 3600_000, lastBeat: t }));
  ok('no exit stamp → stopped without closing', crash.startsWith('stopped without closing'));
  ok('…with the last time it was alive', crash.includes('last alive'));
  ok('screensaver/home screen is mentioned when the page was hidden', describePrevSession(JSON.stringify({ startedAt: t - 3600_000, lastBeat: t, hiddenAt: t - 60_000 })).includes('screen hidden since'));
  ok('a pop-up in front before the stop is a clue too', describePrevSession(JSON.stringify({ startedAt: t - 3600_000, lastBeat: t, blurAt: t - 30_000 })).includes('pop-up or menu came up'));
  ok('unplanned endings', isUnplannedExit('stopped without closing — x') && isUnplannedExit('screen error (x)') && !isUnplannedExit('app update (x)') && !isUnplannedExit('') && !isUnplannedExit(undefined));
}

// ── A reload keeps its reason (pagehide fires BEFORE visibility → hidden) ──
{
  const store = new Map<string, string>();
  const handlers: Record<string, ((e: any) => void)[]> = {};
  const on = (scope: string) => ({
    addEventListener: (t: string, f: (e: any) => void) => { (handlers[scope + t] ||= []).push(f); },
    removeEventListener: () => {},
  });
  const fire = (key: string, e: any = {}) => (handlers[key] || []).forEach(f => f(e));
  const g = globalThis as any;
  const saved = { localStorage: g.localStorage, window: g.window, document: g.document };
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, String(v)); } };
  g.window = { ...on('w'), setInterval: () => 0, clearInterval: () => {} };
  g.document = { ...on('d'), visibilityState: 'visible' };

  const s1 = startTvSession(1000);
  ok('first session has nothing to report', s1.previous === '');
  setTvExitReason('app update');
  fire('wpagehide');
  g.document.visibilityState = 'hidden';
  fire('dvisibilitychange');
  const s2 = startTvSession(2000);
  ok('reload: the reason survives the hidden event after pagehide', s2.previous.startsWith('app update'));

  // Screen covered (screensaver / home) and then killed: no pagehide.
  setTvExitReason('');
  g.document.visibilityState = 'hidden';
  fire('dvisibilitychange');
  const s3 = startTvSession(3000);
  ok('killed while covered → stopped without closing + screen hidden', s3.previous.startsWith('stopped without closing') && s3.previous.includes('screen hidden since'));

  // Flight recorder: what the killed session was doing comes back at the next start.
  tvEvent('slide Open Jobs');
  tvEvent('photos ready 19', true);
  const s4 = startTvSession(4000);
  ok('previous session log is reported', s4.previousLog.includes('slide Open Jobs') && s4.previousLog.includes('photos ready 19'));
  ok('…and the new session starts a fresh log', readPrevTvLog(store.get('fabtrack_tv_log') ?? null).includes('start') && !readPrevTvLog(store.get('fabtrack_tv_log') ?? null).includes('Open Jobs'));
  ok('log keeps only the last lines', (() => { for (let i = 0; i < 60; i++) tvEvent(`e${i}`, true); return JSON.parse(store.get('fabtrack_tv_log') || '[]').length === 40; })());
  ok('readPrevTvLog survives junk', readPrevTvLog('{bad') === '' && readPrevTvLog(null) === '');
  setTvExitReason('');
  s4.stop();
  const s5 = startTvSession(5000);
  ok('closing the board normally is a clean exit, not a crash', s5.previous.startsWith('board closed'));
  s5.stop();

  // The last unplanned stop is kept through the planned restarts after it
  // (an app update a few seconds in used to bury the one useful report).
  ok('a stop without closing is kept as the last crash', !!s3.crash && s3.crash.text.startsWith('stopped without closing'));
  ok('…and survives a planned restart after it, with its log', !!s5.crash && s5.crash.text.startsWith('stopped without closing') && s5.crash.log.includes('Open Jobs'));

  // Input reaching the TV (does a mouse jiggler get through?), and focus.
  for (const k of Object.keys(handlers)) delete handlers[k];   // only the next session listens
  setTvExitReason('');
  const s6 = startTvSession(6000);
  fire('wmousemove'); fire('wmousemove'); fire('wmousemove'); fire('wkeydown');
  ok('input: counts mouse moves and key presses', takeInputCounts().startsWith('3 mouse moves, 1 key press in'));
  ok('input: starts over after each check-in', takeInputCounts().startsWith('0 mouse moves, 0 key presses in'));
  ok('input: the first mouse move is noted in the flight recorder', (store.get('fabtrack_tv_log') || '').includes('mouse movement reaches this TV'));
  fire('wblur');
  const s7 = startTvSession(7000);   // s6 never closed: it went away after a pop-up came up
  ok('a pop-up before the stop is reported', s6.previous.startsWith('board closed') && s7.previous.startsWith('stopped without closing') && s7.previous.includes('pop-up or menu came up'));
  ok('…and becomes the kept crash', !!s7.crash && s7.crash.text.includes('pop-up or menu came up'));
  s7.stop();

  g.localStorage = saved.localStorage; g.window = saved.window; g.document = saved.document;
}

// ── Device names for the office list ──────────────────────────────
ok('Samsung', describeDevice('Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36') === 'Samsung TV (Tizen)');
ok('LG', describeDevice('Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36') === 'LG TV (webOS)');
ok('Fire TV', describeDevice('Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7233) Silk/90') === 'Amazon Fire TV');
ok('Windows', describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120') === 'Windows PC');
ok('Fire TV model named from its code', deviceModel('Mozilla/5.0 (Linux; Android 9; AFTSSS Build/PS7633) Silk/112') === 'Fire TV Stick (3rd gen) · AFTSSS');
ok('unknown Fire TV code shown as-is', deviceModel('Mozilla/5.0 (Linux; Android 9; AFTEU011 Build/PS7) Silk/112') === 'AFTEU011');
ok('not a Fire TV → no model', deviceModel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120') === '');

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
