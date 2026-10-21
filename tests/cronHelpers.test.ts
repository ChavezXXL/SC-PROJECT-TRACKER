// Pure decisions behind the scheduled functions + the Firestore REST client's
// wire format and read accounting (scripted fetch — no network).
import {
  parseHHMM, isActiveUser, isAdminUser, activeAdmins, activeWorkers, runningWorkedMs, runningLogsAsOf, loggedMinutes,
  clockedInUserIds, shouldEscalateLateClockIn, LATE_ESCALATION_REMINDER, idleScanSinceMs, idleCandidates,
  IDLE_NUDGE_MAX, IDLE_RENUDGE_MS, runningJobIds, recapDue, recapRetryAllowed, RECAP_MAX_ATTEMPTS, scorecardTimeFor,
  lastShopTimeAtOrBefore, shopDayStartMs, shopDateStr, recapInsightJobIds, escHtml,
} from '../utils/cronHelpers';
import { parseHeartbeat, heartbeatIssue, heartbeatHasFailures } from '../utils/cronHeartbeat';
import { createFirestoreRest, toFsValue, fromFsValue, buildWhereQuery } from '../utils/firestoreRest';
import { createResendSender } from '../utils/cronEmail';
import { shopLocalTimeMs } from '../utils/timezone';
import { weeklyShiftHours, workdayHours } from '../utils/shiftRules';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

const TZ = 'America/Los_Angeles';
const MIN = 60_000, HOUR = 3_600_000;
const TUE = Date.UTC(2026, 9, 20, 19, 0);              // Tue Oct 20 2026, 12:00 PDT
const at = (h: number, m = 0, day = TUE) => shopLocalTimeMs(day, TZ, h, m);

async function main() {
  // ── Clock ──────────────────────────────────────────────────────────
  ok('parseHHMM reads 24h times', JSON.stringify(parseHHMM('17:45')) === '{"h":17,"m":45}' && JSON.stringify(parseHHMM(' 7:05 ')) === '{"h":7,"m":5}');
  ok('parseHHMM refuses junk', parseHHMM('24:00') === null && parseHHMM('17:60') === null && parseHHMM('5pm') === null && parseHHMM(undefined) === null);
  ok('shop day start is local midnight', shopDateStr(shopDayStartMs(TUE, TZ), TZ) === '2026-10-20' && shopDateStr(shopDayStartMs(TUE, TZ) - 1, TZ) === '2026-10-19');

  const justAfterMidnight = at(0, 20, Date.UTC(2026, 9, 21, 19, 0));
  ok('last 23:50 seen from 00:20 is yesterday', lastShopTimeAtOrBefore(justAfterMidnight, TZ, 23, 50) === at(23, 50));
  ok('last 06:30 seen from noon is today', lastShopTimeAtOrBefore(TUE, TZ, 6, 30) === at(6, 30));
  const fallBack = Date.UTC(2026, 10, 2, 8, 30);        // Mon Nov 2 2026 00:30 PST (day after fall-back)
  ok('yesterday 23:50 across fall-back (DST)', lastShopTimeAtOrBefore(fallBack, TZ, 23, 50) === Date.UTC(2026, 10, 2, 7, 50));

  // ── People ─────────────────────────────────────────────────────────
  const people = [
    { id: 'a', role: 'admin' }, { id: 'a2', role: 'admin', isActive: false }, { id: 'm', role: 'manager', isActive: true },
    { id: 'o', role: 'owner' }, { id: 'w', role: 'employee' }, { id: 'w2', role: 'employee', isActive: false },
    { id: 'x', role: 'worker' }, { id: 'n' },
  ];
  ok('only isActive:false is deactivated', isActiveUser({ id: 'a' }) && isActiveUser({ id: 'a', isActive: true }) && !isActiveUser({ id: 'a', isActive: false }) && !isActiveUser(null));
  ok('admin roles', isAdminUser({ role: 'owner' }) && isAdminUser({ role: 'manager' }) && !isAdminUser({ role: 'employee' }));
  ok('active admins skip deactivated', activeAdmins(people).map(u => u.id).join() === 'a,m,o');
  ok('active workers skip deactivated (no role counts as worker)', activeWorkers(people).map(u => u.id).join() === 'w,x,n');

  // ── Time on the clock ──────────────────────────────────────────────
  const start = at(8);
  ok('running: wall time', runningWorkedMs({ startTime: start }, start + 2 * HOUR) === 2 * HOUR);
  ok('running: finished pauses come off', runningWorkedMs({ startTime: start, totalPausedMs: 30 * MIN }, start + 2 * HOUR) === 90 * MIN);
  ok('running: a pause in progress stops the clock', runningWorkedMs({ startTime: start, totalPausedMs: 10 * MIN, pausedAt: start + HOUR }, start + 2 * HOUR) === 50 * MIN);
  ok('running: a pause stamped in the future is ignored', runningWorkedMs({ startTime: start, pausedAt: start + 3 * HOUR }, start + 2 * HOUR) === 2 * HOUR);
  ok('running: never negative, never past 14h', runningWorkedMs({ startTime: start, totalPausedMs: 9 * HOUR }, start + HOUR) === 0 && runningWorkedMs({ startTime: start - 20 * HOUR }, start) === 14 * HOUR);
  ok('running: no start → 0', runningWorkedMs({}, start) === 0);

  const open = [
    { id: 'r1', userId: 'w', startTime: at(13), totalPausedMs: 30 * MIN },
    { id: 'r2', userId: 'w', startTime: at(15), pausedAt: at(16) },
    { id: 'old', userId: 'x', startTime: at(15) - 24 * HOUR },                // left running since yesterday
    { id: 'smp', userId: 'x', startTime: at(14), isSample: true },
    { id: 'done', userId: 'x', startTime: at(9), endTime: at(10) },
  ];
  const snap = runningLogsAsOf(open, at(17), shopDayStartMs(at(17), TZ));
  ok('running copies: only today\'s real open timers', snap.map(l => l.id).join() === 'r1,r2');
  ok('running copies: end at the send time with worked seconds', snap[0].endTime === at(17) && snap[0].durationSeconds === 3.5 * 3600 && snap[1].durationSeconds === 3600);
  ok('running copies: minutes like the app (2 decimals)', snap[0].durationMinutes === 210);
  ok('running copies leave the originals alone', !('durationSeconds' in open[0]));
  ok('loggedMinutes prefers seconds', loggedMinutes({ durationSeconds: 90, durationMinutes: 2 }) === 1.5 && loggedMinutes({ durationMinutes: 4 }) === 4 && loggedMinutes({}) === 0);

  // ── Missed clock-in ────────────────────────────────────────────────
  const shiftStart = at(6, 30), dayStart = shopDayStartMs(shiftStart, TZ);
  const openNow = [{ userId: 'open' }, { userId: 'sampleOnly', isSample: true }];
  const recent = [
    { userId: 'between', startTime: at(6, 35), endTime: at(6, 48) },        // clocked in, now between jobs
    { userId: 'early', startTime: at(5, 30), endTime: at(6, 40) },          // on the clock at shift start
    { userId: 'overnight', startTime: at(18) - 24 * HOUR, endTime: at(6, 40) }, // yesterday's forgotten timer
    { userId: 'leftEarly', startTime: at(5), endTime: at(6, 10) },          // ended before the shift
    { userId: 'smp', startTime: at(6, 40), endTime: at(6, 45), isSample: true },
  ];
  const inIds = clockedInUserIds(openNow, recent, shiftStart, dayStart);
  ok('clocked in: open timer', inIds.has('open'));
  ok('clocked in: a log since shift start counts even when stopped', inIds.has('between'));
  ok('clocked in: on the clock at shift start (same day)', inIds.has('early'));
  ok('not clocked in: yesterday\'s timer that ran past the shift start', !inIds.has('overnight'));
  ok('not clocked in: left before the shift started', !inIds.has('leftEarly'));
  ok('samples never count', !inIds.has('smp') && !inIds.has('sampleOnly'));
  ok('escalation email only at reminder #3', LATE_ESCALATION_REMINDER === 3 && shouldEscalateLateClockIn(3, 2)
    && !shouldEscalateLateClockIn(2, 2) && !shouldEscalateLateClockIn(4, 2) && !shouldEscalateLateClockIn(6, 2));
  ok('no escalation when nobody is missing', !shouldEscalateLateClockIn(3, 0));

  // ── Idle between jobs ──────────────────────────────────────────────
  const workStart = at(6);
  const done = [
    { userId: 'idle', endTime: at(9) }, { userId: 'idle', endTime: at(8) },
    { userId: 'busy', endTime: at(9) },
    { userId: 'fresh', endTime: at(10, 0) },
    { userId: 'night', endTime: at(5, 50) },
    { userId: 'smp', endTime: at(8), isSample: true },
  ];
  const idle = idleCandidates(done, new Set(['busy']), at(10, 30), 75, workStart);
  ok('idle: last end per worker, busy and recent excluded', idle.map(c => c.id).join() === 'idle' && idle[0].gapMs === 90 * MIN);
  ok('idle: ends before work start ignored', !idleCandidates(done, new Set(), at(10, 30), 20, workStart).some(c => c.id === 'night'));
  ok('idle scan never reaches before work start', idleScanSinceMs(workStart, at(8), 75) === workStart);
  ok('idle scan window trails in the afternoon', idleScanSinceMs(workStart, at(15), 75) > workStart && idleScanSinceMs(workStart, at(15), 75) < at(15) - 4 * HOUR);

  // Brute force the nudge rules: a nudge must never be due for someone whose
  // last log ended before the scan window (else the narrower query would miss it).
  let windowSafe = true;
  for (const idleMin of [20, 45, 75, 120]) {
    for (const phase of [0, 1, 2, 3, 4]) {
      for (const prior of [null, 1, 30, 44]) {                // a nudge from an earlier gap, N min before E
        for (const priorCount of [0, 1, 2, 3]) {
          if (prior === null && priorCount > 0) continue;
          const E = at(9) + phase * MIN;
          let count = prior === null ? 0 : priorCount, lastSent = prior === null ? 0 : E - prior * MIN;
          for (let t = at(9) + 5 * MIN; t < at(9) + 12 * HOUR; t += 5 * MIN) {
            if (t - E < idleMin * MIN || count >= IDLE_NUDGE_MAX) continue;
            if (count > 0 && t - lastSent < IDLE_RENUDGE_MS) continue;
            count++; lastSent = t;
            if (idleScanSinceMs(0, t, idleMin) > E) windowSafe = false;
          }
        }
      }
    }
  }
  ok('idle scan window always covers every nudge that can still be due', windowSafe);

  ok('running job ids: distinct, paused excluded', runningJobIds([
    { jobId: 'j1' }, { jobId: 'j1' }, { jobId: 'j2', pausedAt: 5 }, { jobId: 'j3' }, { jobId: null },
  ]).join() === 'j1,j3');

  // ── Daily recap timing ─────────────────────────────────────────────
  const r = (h: number, m: number, last?: string) => recapDue({ nowMs: at(h, m), tz: TZ, recapTime: '17:45', lastSentDate: last });
  ok('recap at 17:45 is NOT sent at 17:00 (the old hour-only bug)', !r(17, 0).due && r(17, 0).reason === 'not-yet');
  ok('recap not sent at 17:44', !r(17, 44).due);
  ok('recap sent at 17:45', r(17, 45).due && r(17, 45).today === '2026-10-20');
  ok('first run after the time still sends (17:50, 23:55)', r(17, 50).due && r(23, 55).due);
  ok('recap once a day', !r(17, 50, '2026-10-20').due && r(17, 50, '2026-10-20').reason === 'already-sent' && r(17, 50, '2026-10-19').due);
  ok('bad recap time never sends', recapDue({ nowMs: at(18, 0), tz: TZ, recapTime: '5:45pm' }).reason === 'bad-time');
  const springFwd = recapDue({ nowMs: Date.UTC(2026, 2, 9, 0, 45), tz: TZ, recapTime: '17:45' });   // Mar 8 2026 17:45 PDT
  ok('recap time right on DST start day', springFwd.due && springFwd.today === '2026-03-08' && springFwd.sendAtMs === Date.UTC(2026, 2, 9, 0, 45)
    && !recapDue({ nowMs: Date.UTC(2026, 2, 9, 0, 44), tz: TZ, recapTime: '17:45' }).due);
  const fallBk = recapDue({ nowMs: Date.UTC(2026, 10, 2, 1, 45), tz: TZ, recapTime: '17:45' });     // Nov 1 2026 17:45 PST
  ok('recap time right on DST end day', fallBk.due && fallBk.today === '2026-11-01' && fallBk.sendAtMs === Date.UTC(2026, 10, 2, 1, 45));

  const t0 = at(17, 50);
  ok('retry: no failures → go', recapRetryAllowed(undefined, '2026-10-20', t0) && recapRetryAllowed({ date: '2026-10-19', failures: 4, lastAttemptMs: 0 }, '2026-10-20', t0));
  ok('retry: 10 min after the 1st failure', !recapRetryAllowed({ date: '2026-10-20', failures: 1, lastAttemptMs: t0 }, '2026-10-20', t0 + 5 * MIN)
    && recapRetryAllowed({ date: '2026-10-20', failures: 1, lastAttemptMs: t0 }, '2026-10-20', t0 + 10 * MIN));
  ok('retry: then 20, then 40 min', !recapRetryAllowed({ date: '2026-10-20', failures: 2, lastAttemptMs: t0 }, '2026-10-20', t0 + 10 * MIN)
    && recapRetryAllowed({ date: '2026-10-20', failures: 2, lastAttemptMs: t0 }, '2026-10-20', t0 + 20 * MIN)
    && !recapRetryAllowed({ date: '2026-10-20', failures: 3, lastAttemptMs: t0 }, '2026-10-20', t0 + 30 * MIN)
    && recapRetryAllowed({ date: '2026-10-20', failures: 3, lastAttemptMs: t0 }, '2026-10-20', t0 + 40 * MIN));
  ok('retry: gives up for the day after the max', RECAP_MAX_ATTEMPTS === 4 && !recapRetryAllowed({ date: '2026-10-20', failures: 4, lastAttemptMs: t0 }, '2026-10-20', t0 + 5 * HOUR));

  const jobs = [
    { id: 'today1', partNumber: ' ABC-1 ', quantity: 100, status: 'in-progress' },
    { id: 'today2', partNumber: 'XYZ', quantity: 0, status: 'in-progress' },        // no qty → no insight
    { id: 'today3', partNumber: '', quantity: 10, status: 'in-progress' },          // no part → no insight
    { id: 'prev1', partNumber: 'abc-1', quantity: 80, status: 'completed' },
    { id: 'prev2', partNumber: 'ABC-1', quantity: 50, status: 'pending' },          // not a completed run
    { id: 'prev3', partNumber: 'XYZ', quantity: 20, status: 'completed' },          // XYZ had no insight today
    { id: 'other', partNumber: 'QQQ', quantity: 5, status: 'completed' },
  ];
  ok('recap history jobs: today\'s insight jobs + completed runs of the same part', recapInsightJobIds(jobs, ['today1', 'today2', 'today3', 'nope']).sort().join() === 'prev1,today1');
  ok('recap history jobs: nothing worked today → nothing extra', recapInsightJobIds(jobs, []).length === 0);

  // ── Scorecard time ─────────────────────────────────────────────────
  const clockOut = { enabled: true, clockOut: true, label: 'Shift End', time: '17:30' };
  ok('scorecard: the setting wins', scorecardTimeFor({ scorecardTime: '16:00', shiftAlarms: [clockOut], autoClockOutTime: '17:00' }) === '16:00');
  ok('scorecard: then the clock-out alarm', scorecardTimeFor({ shiftAlarms: [{ enabled: true, label: 'Lunch', time: '11:30' }, clockOut], autoClockOutTime: '17:00' }) === '17:30');
  ok('scorecard: a "shift end" label counts as the clock-out alarm', scorecardTimeFor({ shiftAlarms: [{ enabled: true, label: 'Shift end bell', time: '16:45' }] }) === '16:45');
  ok('scorecard: then the auto clock-out time', scorecardTimeFor({ shiftAlarms: [{ ...clockOut, enabled: false }], autoClockOutTime: '17:00' }) === '17:00');
  ok('scorecard: then 15:30', scorecardTimeFor({}) === '15:30' && scorecardTimeFor({ scorecardTime: '', autoClockOutTime: 'nope' }) === '15:30');

  ok('escHtml', escHtml('<b>"A&B"</b>') === '&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;');

  // ── Heartbeat ──────────────────────────────────────────────────────
  const oldShape = parseHeartbeat({ lastRunMs: 123 });
  ok('heartbeat: old {lastRunMs} doc still reads', !!oldShape && oldShape.lastRunMs === 123 && oldShape.pushesFailed === 0 && !heartbeatHasFailures(oldShape));
  ok('heartbeat: junk → null', parseHeartbeat(null) === null && parseHeartbeat({ lastRunMs: 'x' }) === null);
  ok('heartbeat: clean run → no warning', heartbeatIssue(parseHeartbeat({ lastRunMs: TUE, pushesSent: 9 })) === null && heartbeatIssue(null) === null);
  const issue = heartbeatIssue(parseHeartbeat({ lastRunMs: TUE, pushesFailed: 2, errors: 1, lastError: 'list users: HTTP 429 RESOURCE_EXHAUSTED' }), TZ);
  ok('heartbeat: failures → a warning', !!issue && issue.severity === 'warning' && issue.count === 3);
  ok('heartbeat: warning says what failed and when', !!issue && issue.title.includes('2 notifications') && issue.title.includes('1 step')
    && issue.detail.includes('12:00 PM') && issue.detail.includes('RESOURCE_EXHAUSTED'));

  // ── Firestore REST value encoding ──────────────────────────────────
  ok('encode: ints, doubles, null, nested', JSON.stringify(toFsValue({ a: 1, b: 1.5, c: null, d: ['x', true] })) ===
    JSON.stringify({ mapValue: { fields: { a: { integerValue: '1' }, b: { doubleValue: 1.5 }, c: { nullValue: null }, d: { arrayValue: { values: [{ stringValue: 'x' }, { booleanValue: true }] } } } } }));
  ok('decode round trip', JSON.stringify(fromFsValue(toFsValue({ a: 1, b: [2, { c: 'd' }] }))) === '{"a":1,"b":[2,{"c":"d"}]}');
  ok('decode timestamp → ms', fromFsValue({ timestampValue: '2026-10-20T19:00:00Z' }) === TUE);
  const q = buildWhereQuery('logs', 'status', 'in', ['in_progress', 'paused'], ['userId']);
  ok('query body: IN filter + select', q.from[0].collectionId === 'logs' && q.where.fieldFilter.op === 'IN'
    && q.where.fieldFilter.value.arrayValue.values.length === 2 && q.select.fields[0].fieldPath === 'userId');

  // ── Firestore REST client against a scripted fetch ─────────────────
  type Req = { url: string; method: string; body: any };
  const reqs: Req[] = [];
  let replies: (() => Response)[] = [];
  const reply = (body: any, status = 200) => () => new Response(JSON.stringify(body), { status });
  const scripted = (async (url: any, init?: any) => {
    reqs.push({ url: String(url), method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null });
    const next = replies.shift();
    if (!next) throw new Error('no scripted reply');
    return next();
  }) as unknown as typeof fetch;
  const ROOT = 'projects/p1/databases/(default)/documents';
  const fs = createFirestoreRest({ apiKey: 'k', projectId: 'p1', fetchImpl: scripted, label: 'test' });
  const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
    const w = console.warn; console.warn = () => {};
    try { return await fn(); } finally { console.warn = w; }
  };

  replies = [reply([
    { found: { name: `${ROOT}/jobs/a`, fields: { partNumber: { stringValue: 'P1' }, checklist: { arrayValue: { values: [] } } } }, readTime: 't' },
    { missing: `${ROOT}/jobs/b`, readTime: 't' },
  ])];
  const got = await fs.getMany('jobs', ['a', 'b', 'a', ''], { mask: ['partNumber', 'checklist'] });
  const bg = reqs[reqs.length - 1];
  ok('batchGet: one POST to documents:batchGet', bg.method === 'POST' && bg.url.startsWith(`https://firestore.googleapis.com/v1/${ROOT}:batchGet?key=k`));
  ok('batchGet: only the ids asked for, deduped, full names', JSON.stringify(bg.body.documents) === JSON.stringify([`${ROOT}/jobs/a`, `${ROOT}/jobs/b`]));
  ok('batchGet: field mask sent', JSON.stringify(bg.body.mask) === '{"fieldPaths":["partNumber","checklist"]}');
  ok('batchGet: found docs mapped, missing left out', !!got && got.size === 1 && got.get('a')?.partNumber === 'P1');
  ok('batchGet: every doc asked for is a read', fs.stats.reads === 2);
  ok('batchGet: no ids → no request', (await fs.getMany('jobs', [])).size === 0 && reqs.length === 1);

  const before = fs.stats.reads;
  replies = [
    reply({ documents: [{ name: `${ROOT}/users/u1`, fields: { name: { stringValue: 'Ann' } } }, { name: `${ROOT}/users/u2`, fields: {} }], nextPageToken: 'T2' }),
    reply({}),
  ];
  const users = await fs.list('users', { mask: ['name', 'isActive'] });
  ok('list: pages followed, docs decoded with ids', !!users && users.length === 2 && users[0].id === 'u1' && users[0].name === 'Ann');
  ok('list: mask + page token on the URL', reqs[reqs.length - 2].url.includes('mask.fieldPaths=name&mask.fieldPaths=isActive') && reqs[reqs.length - 1].url.includes('pageToken=T2'));
  ok('list: 1 read per doc, min 1 per page', fs.stats.reads - before === 3);

  replies = [reply([{ readTime: 't' }])];
  const none = await fs.where('logs', 'endTime', '>=', 5, { select: ['userId'] });
  ok('query: empty result is [] and still 1 read', Array.isArray(none) && none.length === 0 && fs.stats.reads - before === 4);
  ok('query: runQuery body', reqs[reqs.length - 1].url.includes(':runQuery') && reqs[reqs.length - 1].body.structuredQuery.where.fieldFilter.op === 'GREATER_THAN_OR_EQUAL');

  replies = [reply({ error: { code: 404, status: 'NOT_FOUND' } }, 404)];
  ok('get: missing doc → null, 1 read, not an error', (await fs.get('push_meta', 'x')) === null && fs.stats.reads - before === 5 && fs.stats.errors === 0);

  replies = [reply({ name: `${ROOT}/push_meta/x` })];
  await fs.write('push_meta', 'x', { a: 1, skip: undefined }, { merge: true, deleteFields: ['gone'] });
  const w1 = reqs[reqs.length - 1];
  ok('write merge: PATCH with an updateMask per field (+ deletes)', w1.method === 'PATCH' && w1.url.includes('updateMask.fieldPaths=a') && w1.url.includes('updateMask.fieldPaths=gone') && !w1.url.includes('skip'));
  ok('write merge: undefined fields dropped', JSON.stringify(w1.body.fields) === '{"a":{"integerValue":"1"}}');

  replies = [reply({ error: { code: 409, status: 'ALREADY_EXISTS', message: 'exists' } }, 409)];
  const lost = await fs.write('push_meta', 'claim', { sentAt: 1 }, { mustNotExist: true });
  ok('create-if-absent: precondition on the URL', reqs[reqs.length - 1].url.includes('currentDocument.exists=false'));
  ok('create-if-absent: losing the race → false, not an error', lost === false && fs.stats.errors === 0);

  replies = [reply({ error: { code: 503, status: 'UNAVAILABLE', message: 'try later' } }, 503)];
  const failed = await quiet(() => fs.list('jobs'));
  ok('failure: list → null + counted with detail', failed === null && fs.stats.errors === 1 && fs.stats.lastError.includes('HTTP 503 UNAVAILABLE'));
  replies = [() => { throw new Error('socket hang up'); }];
  ok('failure: network error → null, counted', (await quiet(() => fs.get('settings', 'system'))) === null && fs.stats.errors === 2 && fs.stats.lastError.includes('socket hang up'));

  // ── Resend sender ──────────────────────────────────────────────────
  let sentBody: any = null;
  const okSend = createResendSender('rk', 'Shop <a@b.c>', (async (_u: any, init: any) => { sentBody = JSON.parse(init.body); return new Response('{"id":"e1"}', { status: 200 }); }) as any);
  const res1 = await okSend({ to: ['x@y.z'], subject: 'S', html: '<p>h</p>' });
  ok('email: sent with from/to/subject', res1.ok && res1.id === 'e1' && sentBody.from === 'Shop <a@b.c>' && sentBody.to[0] === 'x@y.z' && !('text' in sentBody));
  const badSend = createResendSender('rk', undefined, (async () => new Response('{"message":"domain not verified"}', { status: 403 })) as any);
  const res2 = await badSend({ to: ['x@y.z'], subject: 'S', html: '' });
  ok('email: failure comes back with the reason', !res2.ok && String(res2.error).includes('403') && String(res2.error).includes('domain not verified'));

  // ── Weekly goal from the shop's alarms ───────────────────────────
  const wk = [1, 2, 3, 4, 5];
  const shop = { shiftAlarms: [
    { id: 'a', label: 'Shift starts', time: '05:00', enabled: true, sound: 'bell', clockIn: true, days: wk },
    { id: 'b', label: 'Lunch break starts', time: '09:30', enabled: true, sound: 'bell', pauseTimers: true, days: wk },
    { id: 'c', label: 'Break over', time: '10:00', enabled: true, sound: 'chime', resumeTimers: true, days: wk },
    { id: 'd', label: 'Early finish (optional)', time: '13:30', enabled: true, sound: 'chime', days: wk },
    { id: 'e', label: 'Shift ends', time: '15:00', enabled: true, sound: 'bell', clockOut: true, days: wk },
  ] } as any;
  ok('week: 5:00–3:00 less a 30 min break, Mon–Fri = 47.5 h', weeklyShiftHours(shop) === 47.5);
  ok('week: the optional early finish does not shorten the day', weeklyShiftHours(shop) === 47.5);
  ok('week: weekdays saved as text still count', weeklyShiftHours({ shiftAlarms: shop.shiftAlarms.map((a: any) => ({ ...a, days: a.days.map(String) })) } as any) === 47.5);
  ok('week: no clock-in alarm → unknown', weeklyShiftHours({ shiftAlarms: shop.shiftAlarms.filter((a: any) => !a.clockIn) } as any) === null);
  ok('day: one working day is 9.5 h', workdayHours(shop) === 9.5);
  ok('day: unknown without a schedule', workdayHours({} as any) === null);
  ok('week: alarms switched off → unknown', weeklyShiftHours({ ...shop, shiftAlarmsEnabled: false }) === null);

  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch(e => { console.log('FAIL: crashed', e); process.exit(1); });
