// Pure push rules: which endpoints the server may POST to (send-push,
// notify-clockin) and how notify-clockin decides whether / what to push.
// No network, no Firebase.
import {
  safePushEndpoint, safeSubscription, isAllowedPushHost, isGonePushError, PUSH_TIMEOUT_MS,
} from '../netlify/functions/_shared/pushSafety';
import {
  isAdminNotifyEvent, isLogId, isDocId, checkClockEvent, checkOverEstimate, buildAdminPush,
  adminPushTargets, cleanText, isActiveAdmin, CLOCK_EVENT_MAX_AGE_MS,
} from '../netlify/functions/_shared/clockNotify';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

// ── Push endpoints ───────────────────────────────────────────────────
const fcm = 'https://fcm.googleapis.com/fcm/send/cXyZ:APA91bH-abc_123';
ok('FCM endpoint accepted unchanged', safePushEndpoint(fcm) === fcm);
ok('Mozilla autopush accepted', !!safePushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk'));
ok('Windows WNS accepted', !!safePushEndpoint('https://wns2-bl2p.notify.windows.com/w/?token=BQYAAAB%2bx'));
ok('Apple web push accepted', !!safePushEndpoint('https://web.push.apple.com/QGx3'));
ok('other *.push.apple.com accepted', !!safePushEndpoint('https://api.push.apple.com/3/device/abc'));
ok('host case is normalised', safePushEndpoint('https://FCM.googleapis.com/fcm/send/x') === 'https://fcm.googleapis.com/fcm/send/x');
ok('explicit :443 allowed', !!safePushEndpoint('https://fcm.googleapis.com:443/fcm/send/x'));

const refused: unknown[] = [
  'http://fcm.googleapis.com/fcm/send/x',               // not https
  'https://fcm.googleapis.com:8443/fcm/send/x',         // other port
  'https://user:pw@fcm.googleapis.com/fcm/send/x',      // credentials
  'https://fcm.googleapis.com.evil.example/fcm/send/x', // look-alike suffix
  'https://evilfcm.googleapis.com/x',
  'https://googleapis.com/x',
  'https://push.services.mozilla.com.attacker.net/x',
  'https://notify.windows.com.attacker.net/x',
  'https://fcm.googleapis.com./x',                      // trailing-dot host
  'https://127.0.0.1/x', 'https://localhost/x', 'https://169.254.169.254/latest/meta-data',
  'https://[::1]/x', 'https://10.0.0.5:22/', 'https://internal.local/x',
  'file:///etc/passwd', 'javascript:alert(1)', 'not a url', '',
  'https://' + 'a'.repeat(3000) + '.notify.windows.com/x', // absurdly long
  42, null, undefined, { endpoint: fcm },
];
for (const r of refused) ok(`refused: ${String(r).slice(0, 60)}`, safePushEndpoint(r) === null);
ok('a bare suffix is not a push host', !isAllowedPushHost('.push.apple.com') && !isAllowedPushHost('push.apple.com'));

// ── Subscriptions ────────────────────────────────────────────────────
const keys = {
  p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
  auth: 'tBHItJI5svbpez7KI4CCXg',
};
const good = safeSubscription({ endpoint: fcm, keys, expirationTime: null, extra: 'x' });
ok('valid subscription kept', !!good && good.endpoint === fcm && good.keys.p256dh === keys.p256dh && good.keys.auth === keys.auth);
ok('only endpoint + keys are passed on', !!good && Object.keys(good).sort().join() === 'endpoint,keys'
  && Object.keys(good.keys).sort().join() === 'auth,p256dh');
ok('internal endpoint refused', safeSubscription({ endpoint: 'https://10.0.0.1/', keys }) === null);
ok('missing keys refused', safeSubscription({ endpoint: fcm }) === null);
ok('junk keys refused', safeSubscription({ endpoint: fcm, keys: { p256dh: 'short', auth: keys.auth } }) === null);
ok('non-string keys refused', safeSubscription({ endpoint: fcm, keys: { p256dh: 123, auth: keys.auth } }) === null);
ok('non-objects refused', safeSubscription(null) === null && safeSubscription('x') === null);
ok('404 / 410 = gone, others not', isGonePushError({ statusCode: 410 }) && isGonePushError({ statusCode: 404 })
  && !isGonePushError({ statusCode: 500 }) && !isGonePushError(new Error('x')) && !isGonePushError(null));
ok('push requests time out after 5 s', PUSH_TIMEOUT_MS === 5000);

// ── notify-clockin: input ────────────────────────────────────────────
ok('known events only', isAdminNotifyEvent('clock-in') && isAdminNotifyEvent('clock-out')
  && isAdminNotifyEvent('over-estimate') && !isAdminNotifyEvent('payroll') && !isAdminNotifyEvent(undefined));
ok('log ids as the app writes them', isLogId('lq3x5k_ab12cd') && isLogId('bf_1700000000000') && isLogId('1700000000000'));
ok('path-like / odd log ids refused', !isLogId('a/b') && !isLogId('../settings/system') && !isLogId('')
  && !isLogId('x'.repeat(129)) && !isLogId(12));
ok('doc ids: no slashes / dots / reserved', isDocId('job-1') && !isDocId('a/b') && !isDocId('..') && !isDocId('__x__') && !isDocId(''));

// ── notify-clockin: did the event really just happen? ────────────────
const now = Date.UTC(2026, 9, 19, 20, 0, 0);
const fresh = { createdMs: now - 5_000, updatedMs: now - 2_000 };
const running = { userName: 'Victor', operation: 'Deburr', partNumber: 'P-100', customer: 'Acme', jobId: 'j1', status: 'in_progress', startTime: now - 3_600_000 };
const stopped = { ...running, status: 'completed', endTime: now - 2_000, stopReason: 'manual' };

ok('fresh clock-in passes', checkClockEvent('clock-in', running, fresh, now).ok === true);
const oldIn = checkClockEvent('clock-in', running, { createdMs: now - CLOCK_EVENT_MAX_AGE_MS - 1, updatedMs: now }, now);
ok('old log → no clock-in push, no retry', oldIn.ok === false && oldIn.retry === false);
ok('unknown create time → no push', checkClockEvent('clock-in', running, { createdMs: 0, updatedMs: 0 }, now).ok === false);
ok('quick in-and-out still announces the clock-in', checkClockEvent('clock-in', stopped, fresh, now).ok === true);
ok('fresh manual clock-out passes', checkClockEvent('clock-out', stopped, fresh, now).ok === true);
const notYet = checkClockEvent('clock-out', running, fresh, now);
ok('clock-out for a still-running log → retry later', notYet.ok === false && notYet.retry === true);
for (const reason of ['sweep:auto-clockout', 'sweep:14h-safety', 'alarm:lunch', 'admin:force-stop', 'auto:switched-job']) {
  const r = checkClockEvent('clock-out', { ...stopped, stopReason: reason }, fresh, now);
  ok(`routine stop "${reason}" not pushed`, r.ok === false && r.retry === false);
}
ok('lock-screen stop counts as a real clock-out', checkClockEvent('clock-out', { ...stopped, stopReason: 'sw:notification' }, fresh, now).ok === true);
const oldOut = checkClockEvent('clock-out', stopped, { createdMs: now - 9e6, updatedMs: now - CLOCK_EVENT_MAX_AGE_MS - 1 }, now);
ok('old stop → no push, no retry', oldOut.ok === false && oldOut.retry === false);

const job = { expectedHours: 0.5, poNumber: 'PO-77' };
const over = checkOverEstimate(running, job, now);
ok('over budget detected', over.ok === true && over.over.poNumber === 'PO-77' && Math.abs(over.over.elapsedHours - 1) < 1e-9);
ok('within budget → no push', checkOverEstimate(running, { expectedHours: 2 }, now).ok === false);
ok('paused time is not counted', checkOverEstimate({ ...running, totalPausedMs: 3_000_000 }, job, now).ok === false);
ok('paused timer → no push', checkOverEstimate({ ...running, status: 'paused', pausedAt: now - 1_000 }, job, now).ok === false);
ok('stopped timer → no push', checkOverEstimate(stopped, job, now).ok === false);
ok('no budget / no job → no push', checkOverEstimate(running, { expectedHours: 0 }, now).ok === false
  && checkOverEstimate(running, null, now).ok === false);

// ── notify-clockin: the words (same as the app always sent) ──────────
const inPush = buildAdminPush('clock-in', running, 'log1');
ok('clock-in title', inPush.title === '🟢 Victor clocked in');
ok('clock-in body', inPush.body === 'Deburr  ·  P-100 · Acme');
ok('tag per event + log, opens the app', inPush.tag === 'clock-in-log1' && inPush.url === '/' && inPush.requireInteraction === false);
const outPush = buildAdminPush('clock-out', { userName: 'Victor' }, 'log1');
ok('clock-out title + empty-body fallback', outPush.title === '🔴 Victor clocked out' && outPush.body === 'Timer stopped');
ok('clock-in empty-body fallback', buildAdminPush('clock-in', { userName: 'V' }, 'x').body === 'Timer started');
if (over.ok === true) {
  const op = buildAdminPush('over-estimate', running, 'log1', over.over);
  ok('over-estimate title', op.title.startsWith('⚠') && op.title.endsWith(' Over estimate — Victor'));
  ok('over-estimate body', op.body === 'Deburr on PO PO-77 passed its 0.5h budget (now 1.0h). Check in with them.');
  ok('over-estimate stays on screen', op.requireInteraction === true && op.tag === 'over-estimate-log1');
}
const rlo = String.fromCharCode(0x202e);
const lineSep = String.fromCharCode(0x2028);
const hostile = buildAdminPush('clock-in', {
  userName: 'Bob\nCall 555-0100 now' + rlo, operation: 'x'.repeat(500), partNumber: 'P\r\n1' + lineSep,
}, 'l');
const shown = hostile.title + hostile.body;
ok('no line breaks / direction overrides reach the notification',
  !shown.includes('\n') && !shown.includes('\r') && !shown.includes(rlo) && !shown.includes(lineSep));
ok('long fields are capped', hostile.body.length < 200 && hostile.title.length < 80);
ok('missing name → "A worker"', buildAdminPush('clock-in', {}, 'l').title === '🟢 A worker clocked in');
ok('cleanText ignores non-text', cleanText({ toString: () => 'x' }, 10) === '' && cleanText(42, 10) === '42' && cleanText('  a   b ', 10) === 'a b');

// ── notify-clockin: recipients ───────────────────────────────────────
const users = new Map<string, any>([
  ['owner', { role: 'admin', isActive: true }],
  ['mgr', { role: 'Manager' }],                  // isActive missing = active
  ['gone', { role: 'admin', isActive: false }],
  ['worker', { role: 'employee', isActive: true }],
]);
const sub = (endpoint: string) => ({ endpoint, keys });
const targets = adminPushTargets([
  { id: 's1', userId: 'owner', subscription: sub(fcm) },
  { id: 's2', userId: 'owner', subscription: sub(fcm) },                       // same device twice
  { id: 's3', userId: 'mgr', subscription: sub('https://updates.push.services.mozilla.com/wpush/v2/m') },
  { id: 's4', userId: 'gone', subscription: sub('https://web.push.apple.com/g') },
  { id: 's5', userId: 'worker', subscription: sub('https://web.push.apple.com/w') },
  { id: 's6', userId: 'nobody', subscription: sub('https://web.push.apple.com/n') },
  { id: 's7', userId: 'owner', subscription: sub('https://169.254.169.254/latest') }, // planted internal endpoint
  { id: 's8', userId: 'owner', subscription: null },
], users);
ok('only active admins / managers, only push-service endpoints', targets.length === 2);
ok('one push per device, both docs tracked', targets.some(t => t.sub.endpoint === fcm && t.ids.join() === 's1,s2'));
ok('manager (any case) included', targets.some(t => t.ids.join() === 's3'));
ok('isActiveAdmin', isActiveAdmin({ role: 'owner' }) && !isActiveAdmin({ role: 'admin', isActive: false })
  && !isActiveAdmin({ role: 'employee' }) && !isActiveAdmin(undefined));

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
