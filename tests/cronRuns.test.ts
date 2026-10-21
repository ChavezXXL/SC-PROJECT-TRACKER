// The three scheduled functions, run end-to-end through the real Firestore
// REST client against an in-memory emulator (tests/fakeFirestore.ts) with fake
// push / email senders. Checks behavior AND what each run reads — the shop is
// on the free plan (50,000 reads/day for everything).
import { createFakeFirestore, type FakeFirestore, type FakeCall } from './fakeFirestore';
import { createFirestoreRest, type FsDoc } from '../utils/firestoreRest';
import { runShiftPushCron } from '../netlify/functions/shift-push-cron';
import { runDailyBriefingCron } from '../netlify/functions/daily-briefing-cron';
import { runDailyRecapCron } from '../netlify/functions/daily-recap-cron';
import { shopLocalTimeMs } from '../utils/timezone';
import { shopDayStartMs, runningLogsAsOf } from '../utils/cronHelpers';
import { parseHeartbeat, heartbeatIssue } from '../utils/cronHeartbeat';
import { buildRecapData, buildRecapHtml } from '../utils/sendDailyRecap';
import type { EmailMessage } from '../utils/cronEmail';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

const TZ = 'America/Los_Angeles';
const MIN = 60_000, HOUR = 3_600_000, DAY = 24 * HOUR;
const TUE = Date.UTC(2026, 9, 20, 19, 0);   // Tue Oct 20 2026, 12:00 PDT
const MON = Date.UTC(2026, 9, 19, 19, 0);   // Mon Oct 19 2026
const at = (h: number, m = 0, day = TUE) => shopLocalTimeMs(day, TZ, h, m);
const hm = (s: string, day = TUE) => { const [h, m] = s.split(':').map(Number); return at(h, m, day); };

/** Keep the crons' console chatter out of the test output. */
async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const saved = [console.log, console.warn, console.error] as const;
  console.log = console.warn = console.error = () => {};
  try { return await fn(); } finally { [console.log, console.warn, console.error] = saved; }
}

function fakePush(failSubs: string[] = []) {
  const sent: { sub: string; user: string; title: string; tag: string; body: string }[] = [];
  const push = async (sub: FsDoc, payload: string) => {
    if (failSubs.includes(sub.id)) return 'failed' as const;
    const p = JSON.parse(payload);
    sent.push({ sub: sub.id, user: String(sub.userId || ''), title: p.title, tag: p.tag, body: p.body });
    return 'sent' as const;
  };
  return { push, sent, tagged: (prefix: string) => sent.filter(s => String(s.tag).startsWith(prefix)) };
}

function fakeEmail(results: boolean[] = []) {
  const emails: EmailMessage[] = [];
  const send = async (msg: EmailMessage) => {
    emails.push(msg);
    const good = results.length ? results.shift()! : true;
    return good ? { ok: true, id: `e${emails.length}` } : { ok: false, error: 'Resend 500: boom' };
  };
  return { send, emails };
}

// ── A small shop: 10 people, 325 jobs, 1,600 old time logs ────────────

const USERS = [
  { id: 'boss', name: 'Bo Boss', role: 'admin', isActive: true, pin: '1111' },
  { id: 'mgr', name: 'Mo Manager', role: 'manager', pin: '2222' },
  { id: 'oldboss', name: 'Old Boss', role: 'admin', isActive: false, pin: '3333' },
  ...[1, 2, 3, 4, 5, 6].map(i => ({ id: `w${i}`, name: `Worker ${i}`, role: 'employee', isActive: true, pin: '0000' })),
  { id: 'gone', name: 'Gone Worker', role: 'employee', isActive: false, pin: '9999' },
];
const nameOf = (id: string) => USERS.find(u => u.id === id)?.name || id;

const ALARMS = [
  { id: 'start', label: 'Shift Start', time: '06:30', enabled: true, clockIn: true, sendPush: true, days: [1, 2, 3, 4, 5] },
  { id: 'lunch', label: 'Lunch', time: '11:30', enabled: true, sendPush: true },
  { id: 'end', label: 'Shift End', time: '17:30', enabled: true, clockOut: true, sendPush: true, days: [1, 2, 3, 4, 5] },
];

function seedShop(fake: FakeFirestore, settings: Record<string, any> = {}) {
  fake.set('settings', 'system', {
    companyName: 'Test Shop', recapTimezone: TZ, autoClockOutEnabled: true, autoClockOutTime: '17:30',
    shiftAlarmsEnabled: true, shiftAlarms: ALARMS, recapEmail: 'owner@shop.test', shopRate: 50, ...settings,
  });
  for (const u of USERS) {
    fake.set('users', u.id, u);
    fake.set('push_subscriptions', `sub-${u.id}`, { userId: u.id, subscription: { endpoint: `https://push.test/${u.id}` } });
  }
  fake.set('push_subscriptions', 'sub-tv', { subscription: { endpoint: 'https://push.test/tv' } });   // shop TV, no worker
  for (let i = 1; i <= 325; i++) {
    const done = i <= 300;
    fake.set('jobs', `job-${i}`, {
      poNumber: `PO-${i}`, jobIdsDisplay: `J${i}`, partNumber: `P-${i % 40}`, customer: `Cust ${i % 7}`, quantity: 100,
      status: done ? 'completed' : 'in-progress', ...(done ? { completedAt: TUE - (301 - i) * 4 * HOUR - 2 * DAY } : {}),
      dueDate: '2026-12-01', checklist: [{ label: 'Deburr', estimatedMinutes: 600 }],
    });
  }
  for (let i = 0; i < 1600; i++) {   // history from 2–61 days back (yesterday is left to each test)
    const s = shopDayStartMs(TUE, TZ) - ((i % 60) + 2) * DAY + 8 * HOUR;
    fake.set('logs', `old-${i}`, {
      jobId: `job-${(i % 325) + 1}`, userId: `w${(i % 6) + 1}`, userName: nameOf(`w${(i % 6) + 1}`), operation: 'Deburr',
      startTime: s, endTime: s + HOUR, durationSeconds: 3600, durationMinutes: 60, status: 'completed', pausedAt: null, totalPausedMs: 0,
    });
  }
}

let seq = 0;
/** A time log: completed when `end` is given, else running (or paused at `pausedAt`). */
function addLog(fake: FakeFirestore, o: { user: string; job: string; start: number; end?: number; paused?: number; pausedAt?: number; op?: string; qty?: number; id?: string }) {
  const id = o.id || `L${++seq}`;
  const base = { jobId: o.job, userId: o.user, userName: nameOf(o.user), operation: o.op || 'Deburr', startTime: o.start, totalPausedMs: o.paused || 0 };
  if (o.end) {
    const sec = Math.floor((o.end - o.start - (o.paused || 0)) / 1000);
    fake.set('logs', id, { ...base, endTime: o.end, durationSeconds: sec, durationMinutes: Math.round((sec / 60) * 100) / 100, status: 'completed', pausedAt: null, ...(o.qty ? { sessionQty: o.qty } : {}) });
  } else {
    fake.set('logs', id, { ...base, endTime: null, status: o.pausedAt ? 'paused' : 'in_progress', pausedAt: o.pausedAt ?? null });
  }
  return id;
}

const restFor = (fake: FakeFirestore) => createFirestoreRest({ apiKey: 'k', projectId: fake.projectId, fetchImpl: fake.fetch, label: 'test' });
/** How many times a whole collection was listed (first pages only — 325 jobs is 2 pages). */
const listed = (calls: FakeCall[], col: string) => calls.filter(c => c.kind === 'list' && c.col === col && !c.detail).length;

async function shiftRun(fake: FakeFirestore, now: number, push = fakePush(), email = fakeEmail()) {
  const from = fake.calls.length;
  const fs = restFor(fake);
  const hb = await quiet(() => runShiftPushCron({ fs, push: push.push, sendEmail: email.send, now }));
  return { hb, calls: fake.callsSince(from), reads: fake.reads(from), push, email, fs };
}

async function main() {
  // ═══ shift-push-cron ════════════════════════════════════════════════

  // 1. Timers running: job docs come from ONE batchGet of just their jobs.
  {
    const fake = createFakeFirestore();
    seedShop(fake);
    fake.set('jobs', 'job-3', { partNumber: 'P-3', jobIdsDisplay: 'J3', status: 'in-progress', checklist: [{ label: 'Quick Deburr', estimatedMinutes: 30 }] });
    const long = addLog(fake, { user: 'w1', job: 'job-1', start: at(6, 35) });                         // 5h25m → long timer
    addLog(fake, { user: 'w2', job: 'job-2', start: at(9), pausedAt: at(11, 30) });                     // paused
    addLog(fake, { user: 'w3', job: 'job-3', start: at(11), op: 'Quick Deburr' });                      // 60 min vs 30 est
    const r = await shiftRun(fake, at(12));
    const bg = r.calls.filter(c => c.kind === 'batchGet');
    ok('shift: never lists the whole jobs collection', listed(r.calls, 'jobs') === 0);
    ok('shift: one batchGet for exactly the running timers\' jobs', bg.length === 1 && bg[0].col === 'jobs' && [...bg[0].detail].sort().join() === 'job-1,job-3');
    ok('shift: users listed at most once per run', listed(r.calls, 'users') === 1);
    ok('shift: subscriptions listed at most once per run', listed(r.calls, 'push_subscriptions') === 1);
    ok('shift: no full logs scan', listed(r.calls, 'logs') === 0);
    const longPush = r.push.tagged(`admin-long-timer-${long}`);
    ok('shift: long-timer alert to active admins only', longPush.map(p => p.user).sort().join() === 'boss,mgr');
    ok('shift: over-estimate to admins + the worker', r.push.tagged('admin-over-est-').length === 2 && r.push.tagged('worker-over-est-').map(p => p.user).join() === 'w3');
    ok('shift: a paused timer gets no over-estimate / long alerts', !r.push.sent.some(p => p.body.includes('Worker 2')));
    ok('shift: run costs a handful of reads', r.reads < 40);
    const hbDoc = fake.get('push_meta', 'cron-heartbeat');
    const last = r.calls[r.calls.length - 1];
    ok('heartbeat: written LAST', last.kind === 'write' && last.col === 'push_meta' && last.id === 'cron-heartbeat');
    ok('heartbeat: run outcome recorded', !!hbDoc && hbDoc.lastRunMs === at(12) && hbDoc.pushesSent === r.push.sent.length && hbDoc.pushesFailed === 0 && hbDoc.errors === 0);
    ok('heartbeat: reads reported = reads billed', hbDoc?.docsRead === r.reads && r.hb.docsRead === r.reads);

    const r2 = await shiftRun(fake, at(12, 5));
    ok('shift: next tick sends nothing twice', r2.push.sent.length === 0);
    ok('shift: quiet tick reads no users/subs at all', listed(r2.calls, 'users') === 0 && listed(r2.calls, 'push_subscriptions') === 0);
    ok('shift: quiet tick with 3 timers ≈ 10 reads', r2.reads <= 10);
  }

  // 2. Nothing else firing (no timers, no alarms) — job notes and idle nudges still run.
  {
    const fake = createFakeFirestore();
    seedShop(fake);
    addLog(fake, { user: 'w4', job: 'job-4', start: at(7), end: at(9) });           // idle 90 min at 10:30
    fake.set('notes', 'n1', { jobId: 'job-7', jobLabel: 'J7', text: 'Parts are on cart 3', userId: 'w5', userName: 'Worker 5', timestamp: at(10, 28) });
    fake.set('notes', 'n0', { jobId: 'job-7', jobLabel: 'J7', text: 'old', userId: 'w5', userName: 'Worker 5', timestamp: at(9) });
    const r = await shiftRun(fake, at(10, 30));
    ok('notes: new note pushed to active admins, not the author', r.push.tagged('job-note-n1').map(p => p.user).sort().join() === 'boss,mgr');
    ok('notes: older notes ignored', r.push.tagged('job-note-n0').length === 0);
    ok('idle: worker nudged with no timers running anywhere', r.push.tagged('idle-gap-w4').map(p => p.user).join() === 'w4');
    ok('idle: admin summary to active admins', r.push.tagged('admin-idle-gap-').map(p => p.user).sort().join() === 'boss,mgr');
    const r2 = await shiftRun(fake, at(10, 35));
    ok('notes + idle: not repeated next tick', r2.push.sent.length === 0);
    const r3 = await shiftRun(fake, at(11, 20));
    ok('idle: re-nudged 45+ min later', r3.push.tagged('idle-gap-w4').length === 1);
  }

  // 3. Shift alarms skip deactivated people's devices.
  {
    const fake = createFakeFirestore();
    seedShop(fake);
    const r = await shiftRun(fake, at(11, 30));
    const got = r.push.tagged('shift-alarm-lunch').map(p => p.sub).sort();
    ok('alarm: broadcast to every active device + the shop TV', got.includes('sub-tv') && got.includes('sub-w1') && got.includes('sub-boss') && got.length === 9);
    ok('alarm: deactivated people\'s devices skipped', !got.includes('sub-gone') && !got.includes('sub-oldboss'));
    const r2 = await shiftRun(fake, at(11, 33));
    ok('alarm: once a day even if two ticks match', r2.push.tagged('shift-alarm-lunch').length === 0);
  }

  // 4. Missed clock-in: who counts as in, and the escalation email exactly once.
  {
    const fake = createFakeFirestore();
    seedShop(fake);
    addLog(fake, { user: 'w1', job: 'job-301', start: at(6, 35), end: at(6, 48) });   // in, now between jobs
    addLog(fake, { user: 'w2', job: 'job-302', start: at(6, 32) });                    // running
    addLog(fake, { user: 'w3', job: 'job-303', start: at(5, 30), end: at(6, 40) });    // early bird, on at 06:30
    addLog(fake, { user: 'w4', job: 'job-304', start: at(17) - DAY, end: at(18) - DAY }); // yesterday only
    addLog(fake, { user: 'w6', job: 'job-306', start: at(6), end: at(6, 20) });        // left before the shift
    const push = fakePush(), email = fakeEmail();
    const runs: number[] = [];
    for (const [h, m] of [[6, 45], [6, 50], [7, 0], [7, 20], [7, 50], [8, 20], [8, 30]]) {
      const before = push.tagged('clockin-reminder-').length;
      await shiftRun(fake, at(h, m), push, email);
      runs.push(push.tagged('clockin-reminder-').length - before);
    }
    ok('clock-in: no check before the 20-min grace', runs[0] === 0);
    ok('clock-in: reminders at +20/+50/+80/+110 min, 30 min apart', runs.join() === '0,3,0,3,3,3,0');
    const nagged = [...new Set(push.tagged('clockin-reminder-').map(p => p.user))].sort().join();
    ok('clock-in: only people with no log since shift start (and not on at start)', nagged === 'w4,w5,w6');
    ok('clock-in: deactivated worker never nagged', !push.tagged('clockin-reminder-').some(p => p.user === 'gone'));
    ok('clock-in: admin summary to active admins each reminder', push.tagged('admin-late-clockin-start').filter(p => p.user === 'boss').length === 4
      && !push.tagged('admin-late-clockin-start').some(p => p.user === 'oldboss'));
    ok('clock-in: escalation email exactly once (reminder #3)', email.emails.length === 1 && email.emails[0].html.includes('reminder #3'));
    ok('clock-in: email names the missing workers', email.emails[0].html.includes('Worker 4') && email.emails[0].html.includes('Worker 6') && !email.emails[0].html.includes('Worker 1'));
    ok('clock-in: email says how late', email.emails[0].html.includes('approximately 80 minutes ago'));
    ok('clock-in: meta counts the reminders', fake.get('push_meta', 'late-clockin-start-2026-10-20')?.sentCount === 4);
  }

  // 5. Heartbeat reports a run's failures (and the panel turns that into a warning).
  {
    const fake = createFakeFirestore();
    seedShop(fake);
    addLog(fake, { user: 'w1', job: 'job-1', start: at(6, 35) });
    fake.failWhen(c => c.kind === 'query' && c.col === 'notes');
    const r = await shiftRun(fake, at(12), fakePush(['sub-boss']));
    const hb = parseHeartbeat(fake.get('push_meta', 'cron-heartbeat'));
    ok('heartbeat: failed push counted', !!hb && hb.pushesFailed === 1 && hb.pushesSent === 1);
    ok('heartbeat: failed Firestore request counted with detail', !!hb && hb.errors === 1 && hb.lastError.includes('notes') && hb.lastError.includes('503'));
    ok('heartbeat: still written last after failures', r.calls[r.calls.length - 1].id === 'cron-heartbeat');
    const issue = heartbeatIssue(hb, TZ);
    ok('panel: last run with failures → warning', !!issue && issue.severity === 'warning' && issue.title.includes('1 notification'));
  }

  // 6. Open-timer query fails → never nag people who may be at work.
  {
    const fake = createFakeFirestore();
    seedShop(fake);
    addLog(fake, { user: 'w4', job: 'job-4', start: at(5), end: at(5, 30) });
    fake.failWhen(c => c.kind === 'query' && c.col === 'logs' && c.detail === 'status IN');
    const r = await shiftRun(fake, at(7, 0));
    ok('safety: no clock-in nags when open timers are unknown', r.push.tagged('clockin-reminder-').length === 0 && r.push.tagged('admin-late-clockin').length === 0);
    ok('safety: no idle nudges when open timers are unknown', r.push.tagged('idle-gap-').length === 0);
    ok('safety: the failure shows in the heartbeat', r.hb.errors >= 1);
  }

  // 7. Recipients unreadable → the claim is released and the alert retried.
  {
    const fake = createFakeFirestore();
    seedShop(fake);
    const long = addLog(fake, { user: 'w1', job: 'job-1', start: at(6) });
    fake.failWhen(c => c.kind === 'list' && c.col === 'users');
    const r1 = await shiftRun(fake, at(12));
    ok('retry: no alert while users unreadable', r1.push.tagged('admin-long-timer-').length === 0 && !fake.get('push_meta', `long-timer-${long}-2026-10-20`));
    fake.failWhen(null);
    const r2 = await shiftRun(fake, at(12, 5));
    ok('retry: alert goes out on the next tick', r2.push.tagged(`admin-long-timer-${long}`).length === 2);
  }

  // 8. No VAPID keys → auto clock-out still runs, heartbeat still written.
  {
    const fake = createFakeFirestore();
    seedShop(fake);
    const stale = addLog(fake, { user: 'w1', job: 'job-1', start: at(8) });
    const fs = restFor(fake);
    const hb = await quiet(() => runShiftPushCron({ fs, push: null, sendEmail: null, now: at(17, 40) }));
    const closed = fake.get('logs', stale)!;
    ok('auto clock-out: closed at the cutoff without push keys', closed.status === 'completed' && closed.endTime === at(17, 30) && closed.stopReason === 'sweep:auto-clockout');
    ok('auto clock-out: counted in the heartbeat', hb.autoClockedOut === 1 && fake.get('push_meta', 'cron-heartbeat')?.autoClockedOut === 1);
    ok('auto clock-out: untouched fields kept (partial update)', closed.operation === 'Deburr' && closed.userName === 'Worker 1');
  }

  // 8a. The shop's saved alarms hold their days as TEXT ("1"…"5"). The
  // shift-end reminder must still go out on a weekday (it never did).
  {
    const fake = createFakeFirestore();
    seedShop(fake, { shiftAlarms: [
      { id: 'end-txt', label: 'Shift ends — clock out', time: '15:30', enabled: true, clockOut: true, sendPush: true, days: ['5', '4', '3', '2', '1'] },
    ] });
    const r = await shiftRun(fake, at(15, 31));   // Tuesday
    ok('text weekdays: the shift-end reminder is sent', r.push.tagged('shift-alarm-end-txt').length > 0);
    const sat = await shiftRun(createFakeFirestore(), at(15, 31, TUE + 4 * DAY));
    ok('text weekdays: an empty shop sends nothing', sat.push.sent.length === 0);
  }

  // 8a2. Idle nudges follow the alarms: they start at the clock-in alarm and
  // stop 30 min before the EARLIEST finish (an optional early finish counts —
  // people who left at 1:30 are home, not idle).
  {
    const sched = { autoClockOutTime: '15:00', shiftAlarms: [
      { id: 'in', label: 'Shift starts — clock in', time: '05:00', enabled: true, clockIn: true, days: [1, 2, 3, 4, 5] },
      { id: 'early', label: 'Early finish (optional) — stop your timer if leaving', time: '13:30', enabled: true, sendPush: true, days: [1, 2, 3, 4, 5] },
      { id: 'out', label: 'Shift ends — clock out', time: '15:00', enabled: true, clockOut: true, days: [1, 2, 3, 4, 5] },
    ] };
    const f1 = createFakeFirestore();
    seedShop(f1, sched);
    addLog(f1, { user: 'w1', job: 'job-301', start: at(5), end: at(11) });
    const r1 = await shiftRun(f1, at(12, 40));
    ok('idle window: nudges before the early finish', r1.push.tagged('idle-gap-').length > 0);
    const f2 = createFakeFirestore();
    seedShop(f2, sched);
    addLog(f2, { user: 'w1', job: 'job-301', start: at(5), end: at(11, 50) });
    const r2 = await shiftRun(f2, at(13, 10));
    ok('idle window: no nudges after it (people may have gone home)', r2.push.tagged('idle-gap-').length === 0);
  }

  // 8b. Lunch backstop: a timer still paused for lunch (no screen resumed it)
  // is resumed by the cron once lunch is well over, counting just the lunch.
  {
    const fake = createFakeFirestore();
    seedShop(fake, { shiftAlarms: [
      ...ALARMS.filter(a => a.id !== 'lunch'),
      { id: 'l-start', label: 'Lunch Starts', time: '12:00', enabled: true, pauseTimers: true },
      { id: 'l-end', label: 'Lunch Ends', time: '12:30', enabled: true, resumeTimers: true },
    ] });
    const lunchLog = addLog(fake, { user: 'w1', job: 'job-301', start: at(7), pausedAt: at(12) });
    fake.set('logs', lunchLog, { ...fake.get('logs', lunchLog), pauseReason: 'auto-lunch' });
    const ownPause = addLog(fake, { user: 'w2', job: 'job-302', start: at(7), pausedAt: at(12) });
    fake.set('logs', ownPause, { ...fake.get('logs', ownPause), pauseReason: 'manual' });
    await shiftRun(fake, at(12, 35));
    ok('lunch backstop: waits for the screens first', fake.get('logs', lunchLog)!.status === 'paused');
    await shiftRun(fake, at(12, 45));
    const l = fake.get('logs', lunchLog)!;
    ok('lunch backstop: resumed after lunch', l.status === 'in_progress' && l.pausedAt === null && l.pauseReason === null);
    ok('lunch backstop: only the lunch length is unpaid', l.totalPausedMs === 30 * MIN);
    ok("lunch backstop: a worker's own pause is left alone", fake.get('logs', ownPause)!.status === 'paused');
  }

  // 9. A whole simulated Tuesday, every 5 minutes — the read budget.
  {
    const fake = createFakeFirestore();
    seedShop(fake);
    const sessions: [string, string, string, string, [string, string][]?][] = [
      ['w1', 'job-301', '06:32', '09:45'], ['w1', 'job-302', '10:00', '11:30'], ['w1', 'job-303', '12:00', '17:30'],
      ['w2', 'job-304', '06:40', '11:30'], ['w2', 'job-304', '12:00', '15:00'], ['w2', 'job-305', '16:30', '17:30'],
      ['w3', 'job-306', '06:30', '17:30', [['11:30', '12:00']]],
      ['w4', 'job-307', '07:10', '12:00'], ['w4', 'job-308', '12:30', '17:30'],
      ['w5', 'job-309', '06:31', '10:00'], ['w5', 'job-310', '11:00', '17:30'],
      ['w6', 'job-311', '06:35', '12:00'],
    ];
    const notes: [string, string, string][] = [['08:00', 'w1', 'job-301'], ['10:15', 'boss', 'job-306'], ['14:20', 'w4', 'job-308']];
    const push = fakePush(), email = fakeEmail();
    const from = fake.calls.length;
    let runs = 0;
    for (let t = shopDayStartMs(TUE, TZ); t < shopDayStartMs(TUE, TZ) + DAY; t += 5 * MIN) {
      sessions.forEach(([user, job, s, e, pauses = []], i) => {
        const id = `day-${i}`;
        const start = hm(s), end = hm(e);
        if (start > t) { fake.remove('logs', id); return; }
        let paused = 0, pausedAt: number | undefined;
        for (const [ps, pe] of pauses) {
          const a = hm(ps), b = hm(pe);
          if (b <= Math.min(t, end)) paused += b - a;
          else if (a <= t && t < end) pausedAt = a;
        }
        addLog(fake, { id, user, job, start, ...(end <= t ? { end, paused } : { paused, pausedAt }) });
      });
      notes.forEach(([time, user, job], i) => {
        if (hm(time) <= t) fake.set('notes', `note-${i}`, { jobId: job, jobLabel: job, text: 'heads up', userId: user, userName: nameOf(user), timestamp: hm(time) });
      });
      await shiftRun(fake, t, push, email);
      runs++;
    }
    const all = fake.callsSince(from);
    const reads = fake.reads(from);
    console.log(`   simulated Tuesday: ${runs} runs, ${reads} reads, ${push.sent.length} pushes (${listed(all, 'users')} user lists, ${listed(all, 'push_subscriptions')} subscription lists)`);
    ok('day: 288 runs', runs === 288);
    ok('day: never lists jobs or logs', listed(all, 'jobs') === 0 && listed(all, 'logs') === 0);
    ok('day: whole day under 6,000 reads (was ~50,000+)', reads < 6000);
    ok('day: alarms went out (start, lunch, end)', ['start', 'lunch', 'end'].every(a => push.tagged(`shift-alarm-${a}`).length > 0));
    ok('day: late worker nagged, on-time workers not', push.tagged('clockin-reminder-w4').length >= 1 && !push.tagged('clockin-reminder-w1').length);
    ok('day: long timer alert for the all-day job', push.tagged('admin-long-timer-day-6').length === 2);
    ok('day: 3 notes pushed', new Set(push.tagged('job-note-').map(p => p.tag)).size === 3);
    ok('day: idle part-timer nudged at most 4 times', push.tagged('idle-gap-w6').length === 4);
    ok('day: idle gap between jobs nudged', push.tagged('idle-gap-w2').length >= 1);
    ok('day: worker back on a job within 75 min not nudged', push.tagged('idle-gap-w5').length === 0);
    ok('day: no escalation email (late worker showed up)', email.emails.length === 0);
  }

  // ═══ daily-briefing-cron ════════════════════════════════════════════

  async function briefingRun(fake: FakeFirestore, now: number, push = fakePush(), email = fakeEmail()) {
    const from = fake.calls.length;
    await quiet(() => runDailyBriefingCron({ fs: restFor(fake), push: push.push, sendEmail: email.send, now }));
    return { calls: fake.callsSince(from), reads: fake.reads(from), push, email };
  }

  // 1. Morning: jobs read once, after the once-a-day claim; second tick reads nothing heavy.
  {
    const fake = createFakeFirestore();
    seedShop(fake);
    fake.set('customer_pos', 'cpo1', { poNumber: 'PO-5', customerName: 'Acme', invoiceStatus: 'not-invoiced' });
    fake.set('customer_pos', 'cpo2', { poNumber: 'PO-6', customerName: 'Beta', invoiceStatus: 'invoiced' });
    addLog(fake, { user: 'w1', job: 'job-301', start: at(8) - DAY, end: at(12) - DAY });
    const r = await briefingRun(fake, at(6, 55));
    ok('briefing: jobs listed exactly once (briefing + invoice share it)', listed(r.calls, 'jobs') === 1);
    ok('briefing: users / subscriptions once', listed(r.calls, 'users') === 1 && listed(r.calls, 'push_subscriptions') === 1);
    ok('briefing: pushed to active admins only', r.push.tagged('briefing-').map(p => p.user).sort().join() === 'boss,mgr');
    ok('briefing: yesterday\'s hours in the push', r.push.tagged('briefing-')[0].body.includes('Yesterday: 4h 0m logged · $200 labor'));
    ok('invoice: ready PO pushed + emailed', r.push.tagged('invoice-reminder-').length === 2 && r.email.emails.length === 1 && r.email.emails[0].html.includes('Acme') && !r.email.emails[0].html.includes('Beta'));
    ok('invoice: stamp records the count', fake.get('push_meta', 'invoice-reminder-2026-10-20')?.count === 1);
    const r2 = await briefingRun(fake, at(7, 0));
    ok('briefing: 2nd tick in the window reads only settings', r2.reads === 1 && !r2.calls.some(c => c.kind === 'list' || c.kind === 'query'));
    ok('briefing: nothing sent twice', r2.push.sent.length === 0 && r2.email.emails.length === 0);
    const r3 = await briefingRun(fake, at(9, 0));
    ok('briefing: outside the windows → 1 read', r3.reads === 1);
  }

  // 2. Invoice check stamped even when nothing is ready.
  {
    const fake = createFakeFirestore();
    seedShop(fake);
    fake.set('customer_pos', 'cpo2', { poNumber: 'PO-6', customerName: 'Beta', invoiceStatus: 'paid' });
    await briefingRun(fake, at(6, 55));
    ok('invoice: stamp written with count 0', fake.get('push_meta', 'invoice-reminder-2026-10-20')?.count === 0);
    const r2 = await briefingRun(fake, at(7, 0));
    ok('invoice: not re-checked on the next tick', listed(r2.calls, 'customer_pos') === 0 && listed(r2.calls, 'jobs') === 0);
  }

  // 3. Monday: briefing + invoice + weekly pulse still read jobs once.
  {
    const fake = createFakeFirestore();
    seedShop(fake);
    fake.set('customer_pos', 'cpo1', { poNumber: 'PO-5', customerName: 'Acme', invoiceStatus: 'not-invoiced' });
    const r = await briefingRun(fake, at(6, 55, MON));
    ok('monday: weekly pulse claimed', !!fake.get('push_meta', 'weekly-digest-2026-10-19'));
    ok('monday: jobs listed exactly once', listed(r.calls, 'jobs') === 1);
  }

  // 4. Scorecard: auto clock-out time as the fallback, running timers counted, deactivated skipped.
  {
    const fake = createFakeFirestore();
    seedShop(fake, { autoClockOutTime: '17:00', shiftAlarms: ALARMS.filter(a => a.id !== 'end') });
    addLog(fake, { user: 'w1', job: 'job-301', start: at(6), end: at(10) });                                   // 4h
    addLog(fake, { user: 'w1', job: 'job-302', start: at(13), paused: 30 * MIN });                              // running: 3h30m at 17:00
    addLog(fake, { user: 'w2', job: 'job-303', start: at(12), pausedAt: at(16), paused: 0 });                   // paused at 16:00 → 4h
    addLog(fake, { user: 'w3', job: 'job-304', start: at(9) - DAY });                                            // left running since yesterday
    addLog(fake, { user: 'gone', job: 'job-305', start: at(8), end: at(10) });
    addLog(fake, { user: 'w4', job: 'job-306', start: at(9), end: at(9, 3) });                                  // 3 min
    const early = await briefingRun(fake, at(15, 30));
    ok('scorecard: not at 15:30 when auto clock-out is 17:00', early.push.sent.length === 0 && early.reads === 1);
    const r = await briefingRun(fake, at(17, 0));
    const w1 = r.push.tagged('scorecard-w1-');
    ok('scorecard: running timer\'s worked time counted', w1.length === 1 && w1[0].title === '🏁 Your Day — 7h 30m · 2 jobs');
    ok('scorecard: a paused timer counts up to its pause', r.push.tagged('scorecard-w2-')[0]?.title === '🏁 Your Day — 4h 0m · 1 job');
    ok('scorecard: yesterday\'s forgotten timer isn\'t today\'s work', r.push.tagged('scorecard-w3-').length === 0);
    ok('scorecard: deactivated worker gets none', r.push.tagged('scorecard-gone-').length === 0);
    ok('scorecard: under 5 min → none', r.push.tagged('scorecard-w4-').length === 0);
    ok('scorecard: no jobs list needed', listed(r.calls, 'jobs') === 0);
  }

  // 5. Devices unreadable → the briefing claim is released; the next tick in the window sends it.
  {
    const fake = createFakeFirestore();
    seedShop(fake);
    fake.failWhen(c => c.kind === 'list' && c.col === 'push_subscriptions');
    const r1 = await briefingRun(fake, at(6, 50));
    ok('briefing retry: nothing sent, claim given back', r1.push.sent.length === 0 && !fake.get('push_meta', 'briefing-2026-10-20'));
    fake.failWhen(null);
    const r2 = await briefingRun(fake, at(7, 0));
    ok('briefing retry: sent on the next tick in the window', r2.push.tagged('briefing-').map(p => p.user).sort().join() === 'boss,mgr');
  }

  // ═══ daily-recap-cron ═══════════════════════════════════════════════

  function seedRecapDay(fake: FakeFirestore) {
    seedShop(fake, { recapEmailEnabled: true, recapEmail: 'owner@shop.test', recapEmailCC: 'mgr@shop.test', recapTime: '17:45' });
    fake.set('rework', 'rw1', { status: 'open' });
    fake.set('rework', 'rw2', { status: 'resolved' });
    addLog(fake, { user: 'w1', job: 'job-301', start: at(6, 32), end: at(9, 45), qty: 40 });
    addLog(fake, { user: 'w2', job: 'job-302', start: at(6, 40), end: at(11, 30) });
    addLog(fake, { user: 'w4', job: 'job-305', start: at(12, 30), end: at(17, 30) });
    addLog(fake, { user: 'w3', job: 'job-303', start: at(13), paused: 30 * MIN });          // still on the clock
    addLog(fake, { user: 'w5', job: 'job-301', start: at(9) - 3 * DAY, end: at(12) - 3 * DAY });  // earlier work on today's job
    const j = fake.get('jobs', 'job-302')!;
    fake.set('jobs', 'job-302', { ...j, status: 'completed', completedAt: at(15), quoteAmount: 1200 });
  }
  async function recapRun(fake: FakeFirestore, now: number, email: ReturnType<typeof fakeEmail> | null) {
    const from = fake.calls.length;
    const outcome = await quiet(() => runDailyRecapCron({ fs: restFor(fake), sendEmail: email ? email.send : null, now }));
    return { outcome, calls: fake.callsSince(from), reads: fake.reads(from) };
  }

  // 1. Sends on the first run at/after HH:MM, once; only the logs it needs.
  {
    const fake = createFakeFirestore();
    seedRecapDay(fake);
    const email = fakeEmail();
    const r1700 = await recapRun(fake, at(17, 0), email);
    const r1740 = await recapRun(fake, at(17, 40), email);
    ok('recap: not sent at 17:00 for a 17:45 recap', r1700.outcome === 'not-due' && r1740.outcome === 'not-due' && email.emails.length === 0);
    ok('recap: waiting runs read only settings', r1700.reads === 1 && r1740.reads === 1);
    const r = await recapRun(fake, at(17, 50), email);
    ok('recap: sent on the first run after 17:45', r.outcome === 'sent' && email.emails.length === 1);
    ok('recap: to the owner + CC', email.emails[0].to.join() === 'owner@shop.test,mgr@shop.test');
    ok('recap: stamped once per day', fake.get('settings', 'system')?.recapLastSentDate === '2026-10-20');
    ok('recap: never lists the whole log history', listed(r.calls, 'logs') === 0);
    const oldReads = 325 + fake.all('logs').length + USERS.length + fake.all('rework').length;
    console.log(`   recap send run: ${r.reads} reads (reading every log like before: ${oldReads})`);
    ok('recap: far fewer reads than the full history', r.reads < oldReads - 1000);
    ok('recap: running timer counted (Worker 3 in the breakdown)', email.emails[0].html.includes('Worker 3'));
    ok('recap: subject has the shop date', email.emails[0].subject.includes('Tuesday, October 20'));
    ok('recap: header date is the shop day, not UTC tomorrow', email.emails[0].html.includes('Tuesday, October 20, 2026'));
    const again = await recapRun(fake, at(18, 0), email);
    ok('recap: not sent twice', again.outcome === 'not-due' && email.emails.length === 1 && again.reads === 1);

    // Same email as building it from EVERY log (the old way) + running timers.
    const now = at(17, 50);
    const dayStart = shopDayStartMs(now, TZ);
    const allLogs = fake.all('logs');
    const running = runningLogsAsOf(allLogs.filter((l: any) => !l.endTime && (l.status === 'in_progress' || l.status === 'paused')), now, dayStart);
    const byId = new Map<string, any>(allLogs.map((l: any) => [l.id, l]));
    for (const l of running) byId.set(l.id, l);
    const ref = buildRecapData({
      to: 'owner@shop.test', ccEmails: ['mgr@shop.test'], logs: [...byId.values()] as any, allJobs: fake.all('jobs') as any,
      users: fake.all('users') as any, shopName: 'Test Shop', shopRate: 50, openReworkCount: 1, todayStart: dayStart,
    });
    ref.date = dayStart + 12 * HOUR;
    ok('recap: identical to the full-history build', buildRecapHtml(ref) === email.emails[0].html);
    ok('recap: job insights present (history was read)', ref.jobInsights.length > 0 && ref.jobInsights.some(i => i.totalPriorRuns > 0));
  }

  // 2. A failed send isn't stamped: the error is stored and the next run retries.
  {
    const fake = createFakeFirestore();
    seedRecapDay(fake);
    const email = fakeEmail([false, true]);
    const r1 = await recapRun(fake, at(17, 50), email);
    const s1 = fake.get('settings', 'system')!;
    ok('recap fail: not marked sent', r1.outcome === 'failed' && !s1.recapLastSentDate);
    ok('recap fail: error stored on settings', String(s1.recapLastError).includes('Resend 500') && s1.recapRetry?.failures === 1);
    const r2 = await recapRun(fake, at(18, 0), email);
    const s2 = fake.get('settings', 'system')!;
    ok('recap fail: retried and sent on the next run', r2.outcome === 'sent' && email.emails.length === 2 && s2.recapLastSentDate === '2026-10-20');
    ok('recap fail: error cleared after success', !('recapLastError' in s2) && !('recapRetry' in s2));
  }

  // 3. A permanent failure is retried a few times, not every 10 min until midnight.
  {
    const fake = createFakeFirestore();
    seedRecapDay(fake);
    const email = fakeEmail(Array(100).fill(false));
    for (let t = at(17, 50); t < at(23, 59); t += 10 * MIN) await recapRun(fake, t, email);
    const s = fake.get('settings', 'system')!;
    ok('recap fail: at most 4 tries a day', email.emails.length === 4 && s.recapRetry?.failures === 4);
    ok('recap fail: says it gave up', String(s.recapLastError).includes('gave up for today'));
    const nextDay = await recapRun(fake, at(17, 50, TUE + DAY), email);
    ok('recap fail: tries again the next day', email.emails.length === 5 && nextDay.outcome === 'failed');
  }

  // 4. No Resend key: nothing read beyond settings, error recorded once.
  {
    const fake = createFakeFirestore();
    seedRecapDay(fake);
    const r1 = await recapRun(fake, at(17, 50), null);
    ok('recap no key: no data read', r1.outcome === 'failed' && r1.reads === 1);
    ok('recap no key: error visible', String(fake.get('settings', 'system')?.recapLastError).includes('RESEND_API_KEY'));
    const r2 = await recapRun(fake, at(18, 0), null);
    ok('recap no key: settings not rewritten every run', !r2.calls.some(c => c.kind === 'write'));
  }

  // 5. Database refusing writes (2026-10-20: free daily quota used up). The
  //    recap was sent but couldn't be marked, so every run sent it again.
  //    Now nothing is read or sent until "sent today" can be saved first.
  {
    const fake = createFakeFirestore();
    seedRecapDay(fake);
    const email = fakeEmail();
    fake.failWhen(c => c.kind === 'write');
    const runs = [];
    for (let t = at(17, 50); t < at(19, 0); t += 10 * MIN) runs.push(await recapRun(fake, t, email));
    ok('recap no writes: never sent (it could not be recorded)', email.emails.length === 0 && runs.every(r => r.outcome === 'failed'));
    ok('recap no writes: reads only settings each run', runs.every(r => r.reads === 1));
    fake.failWhen(null);
    const back = await recapRun(fake, at(19, 0), email);
    const again = await recapRun(fake, at(19, 10), email);
    ok('recap no writes: sent once writes work again', back.outcome === 'sent' && again.outcome === 'not-due' && email.emails.length === 1);
  }

  // 6. A send that fails after today was marked takes the mark back off.
  {
    const fake = createFakeFirestore();
    seedRecapDay(fake);
    fake.set('settings', 'system', { ...fake.get('settings', 'system')!, recapLastSentDate: '2026-10-19' });
    const email = fakeEmail([false, true]);
    await recapRun(fake, at(17, 50), email);
    ok('recap unmark: yesterday restored after a failed send', fake.get('settings', 'system')?.recapLastSentDate === '2026-10-19');
    const r2 = await recapRun(fake, at(18, 0), email);
    ok('recap unmark: next run retries and sends', r2.outcome === 'sent' && email.emails.length === 2);
  }

  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch(e => { console.log('FAIL: crashed', e); process.exit(1); });
