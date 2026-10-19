// send-email: the browser may only ask for the server-built recap; the
// "Send now" rate stamp; the recap helpers.
//
// NO NETWORK: global fetch is replaced (never wrapped) by an in-memory fake
// of Firestore REST + Resend before any handler runs, and the env points at a
// fake project — a stray request throws instead of reaching anything real.
globalThis.fetch = (() => { throw new Error('fetch is stubbed in this test'); }) as any;
process.env.FIREBASE_API_KEY = 'test-key';
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.RESEND_API_KEY = 'test-resend-key';
process.env.RESEND_FROM = 'Shop <recap@shop.example>';
process.env.EMAIL_RELAY_SECRET = 'relay-secret';

import { handler } from '../netlify/functions/send-email';
import {
  recapRecipients, decideRecapNow, recapNowRefusal, classifyEmailRequest, shopDayKey, shopDayStart,
  recapTimezone, RECAP_NOW_GAP_MS, RECAP_NOW_DAILY_CAP,
} from '../netlify/functions/_shared/recapEmail';
import { recapSubject, buildRecapHtml, buildRecapText, type RecapData } from '../utils/sendDailyRecap';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

// ── Pure helpers ─────────────────────────────────────────────────────
ok('recipients: primary + CC, trimmed, de-duplicated, junk dropped',
  recapRecipients({ recapEmail: ' Owner@Shop.example ', recapEmailCC: 'boss@shop.example, owner@shop.example,, not-an-email, x@y' })
    .join('|') === 'Owner@Shop.example|boss@shop.example');
ok('recipients: none saved → empty', recapRecipients({}).length === 0 && recapRecipients(null).length === 0);
ok('recipients: header-ish junk refused', recapRecipients({ recapEmail: 'a@b.com>\r\nBcc: c@d.com' }).length === 0);
ok('recipients: at most 10', recapRecipients({ recapEmailCC: Array.from({ length: 15 }, (_, i) => `u${i}@shop.example`).join(',') }).length === 10);

const today = '2026-10-19';
const t0 = Date.UTC(2026, 9, 19, 18, 0, 0);
const first = decideRecapNow(null, t0, today);
ok('first send of the day allowed', first.ok === true && first.next.count === 1 && first.next.day === today && first.next.lastSentAt === t0);
const soon = decideRecapNow({ lastSentAt: t0, day: today, count: 1 }, t0 + RECAP_NOW_GAP_MS - 60_000, today);
ok('within 10 minutes refused', soon.ok === false && soon.reason === 'too-soon');
ok('refusal says when to retry', soon.ok === false && recapNowRefusal(soon) === 'A recap was sent in the last 10 minutes — try again in 1 min.');
ok('after 10 minutes allowed', decideRecapNow({ lastSentAt: t0, day: today, count: 1 }, t0 + RECAP_NOW_GAP_MS, today).ok === true);
const capped = decideRecapNow({ lastSentAt: t0, day: today, count: RECAP_NOW_DAILY_CAP }, t0 + 3_600_000, today);
ok('daily cap enforced', capped.ok === false && capped.reason === 'daily-cap');
const nextDay = decideRecapNow({ lastSentAt: t0, day: today, count: RECAP_NOW_DAILY_CAP }, t0 + 86_400_000, '2026-10-20');
ok('cap resets on a new shop day', nextDay.ok === true && nextDay.next.count === 1);
ok('junk stamp does not block', decideRecapNow({ lastSentAt: 'x', day: 7, count: 'many' }, t0, today).ok === true);
ok('a stamp far in the future does not lock "Send now" out', decideRecapNow({ lastSentAt: t0 + 86_400_000 }, t0, today).ok === true);

ok('browser may ask for the recap', classifyEmailRequest({ kind: 'daily-recap' }, false).kind === 'daily-recap');
for (const body of [
  { to: 'owner@shop.example', subject: 'Invoice overdue', html: '<a href="https://evil.example">pay</a>' },
  { subject: 'x', html: 'y' },
  { kind: 'other', html: 'y' },
  {},
]) {
  const r = classifyEmailRequest(body, false);
  ok(`untrusted ${JSON.stringify(body).slice(0, 50)} refused 403`, r.kind === 'refused' && r.status === 403);
}
const mixed = classifyEmailRequest({ kind: 'daily-recap', subject: 'Phish', html: '<b>x</b>' }, false);
ok('recap request carrying content refused', mixed.kind === 'refused' && mixed.status === 400);
ok('relay secret keeps the general path', classifyEmailRequest({ to: 'a@b.co', subject: 's', html: 'h' }, true).kind === 'relay');

ok('timezone fallback', recapTimezone({}) === 'America/Los_Angeles' && recapTimezone({ recapTimezone: 'Nowhere/Fake' }) === 'America/Los_Angeles'
  && recapTimezone({ recapTimezone: 'America/Chicago' }) === 'America/Chicago');
ok('shop day key in the shop timezone', shopDayKey('America/Los_Angeles', new Date('2026-10-20T03:00:00Z')) === '2026-10-19');
ok('shop day start = local midnight', shopDayStart('America/Los_Angeles', new Date('2026-10-20T03:00:00Z')) === Date.parse('2026-10-19T07:00:00Z'));
ok('just after midnight stays on the new day', shopDayStart('America/Los_Angeles', new Date('2026-10-19T07:00:30Z')) === Date.parse('2026-10-19T07:00:00Z'));

const data = {
  shopName: 'SC Deburring', date: Date.parse('2026-10-20T03:00:00Z'),
  workerSummaries: [{ name: 'Ana' }, { name: 'Luis\r\nBcc: x@y.z' }],
} as unknown as RecapData;
ok('subject in the shop timezone', recapSubject(data, 'America/Los_Angeles') === 'Daily Recap — SC Deburring — Oct 19 · Ana, Luis Bcc: x@y.z');

// Built on a UTC server at 6 pm Pacific — the recap must still say today.
const evening = {
  shopName: 'SC Deburring', date: Date.parse('2026-10-20T01:00:00Z'), workerSummaries: [], completedToday: [],
  totalMins: 0, totalRevenue: 0, totalLaborCost: 0, weekLaborCost: 0, shopRate: 0, openReworkCount: 0,
  activeWorkersToday: 0, jobInsights: [], timeZone: 'America/Los_Angeles',
} as RecapData;
ok('evening recap dated in the shop timezone (text)', buildRecapText(evening).includes('Monday, October 19, 2026'));
ok('evening recap dated in the shop timezone (html)', buildRecapHtml(evening).includes('Monday, October 19, 2026'));
ok('evening recap dated in the shop timezone (subject)', recapSubject(evening) === 'Daily Recap — SC Deburring — Oct 19');

// ── send-email handler, against a fake Firestore + Resend ─────────────
type Fake = { status: number; body?: unknown };
const BASE = 'https://firestore.googleapis.com/v1/projects/test-project/databases/(default)/documents';
let stamp: { fields: any; updateTime: string } | null = null;
let stampWrites = 0;
let resendCalls: any[] = [];
let resendStatus = 200;
let fetchCalls = 0;
const settingsDoc = {
  name: 'projects/test-project/databases/(default)/documents/settings/system',
  fields: {
    recapEmail: { stringValue: 'owner@shop.example' },
    recapEmailCC: { stringValue: 'boss@shop.example' },
    companyName: { stringValue: 'SC Deburring' },
    recapTimezone: { stringValue: 'America/Los_Angeles' },
  },
};
const res = (f: Fake) => ({ ok: f.status >= 200 && f.status < 300, status: f.status, json: async () => f.body ?? {} });

globalThis.fetch = (async (input: any, init: any = {}) => {
  fetchCalls++;
  const url = String(input);
  const method = (init.method || 'GET').toUpperCase();
  if (url.startsWith('https://api.resend.com/emails') && method === 'POST') {
    resendCalls.push(JSON.parse(init.body));
    return res(resendStatus === 200 ? { status: 200, body: { id: `email_${resendCalls.length}` } } : { status: resendStatus, body: { name: 'validation_error', message: 'secret account detail' } });
  }
  if (!url.startsWith(BASE + '/') || !url.includes('key=test-key')) throw new Error('unexpected fetch ' + url);
  const path = url.slice(BASE.length + 1).split('?')[0];
  const query = new URLSearchParams(url.split('?')[1] || '');
  if (path === 'settings/system' && method === 'GET') return res({ status: 200, body: settingsDoc });
  if (path === 'push_meta/recap-now') {
    if (method === 'GET') {
      return stamp ? res({ status: 200, body: { name: 'x/push_meta/recap-now', fields: stamp.fields, updateTime: stamp.updateTime } }) : res({ status: 404 });
    }
    // Enforce the same preconditions Firestore does.
    if (query.get('currentDocument.exists') === 'false' && stamp) return res({ status: 409, body: { error: { status: 'ALREADY_EXISTS' } } });
    const want = query.get('currentDocument.updateTime');
    if (want && (!stamp || stamp.updateTime !== want)) return res({ status: 400, body: { error: { status: 'FAILED_PRECONDITION' } } });
    if (method === 'DELETE') { stamp = null; return res({ status: 200 }); }
    if (method === 'PATCH') {
      stampWrites++;
      stamp = { fields: JSON.parse(init.body).fields, updateTime: `2026-10-19T18:00:00.${String(stampWrites).padStart(6, '0')}Z` };
      return res({ status: 200, body: { updateTime: stamp.updateTime } });
    }
  }
  if (['jobs', 'logs', 'users', 'rework'].includes(path) && method === 'GET') return res({ status: 200, body: { documents: [] } });
  throw new Error('unexpected fetch ' + method + ' ' + url);
}) as any;

const call = async (body: unknown, headers: Record<string, string> = {}) => {
  const r = await (handler as any)({ httpMethod: 'POST', headers: { origin: 'https://scprojtrac.netlify.app', ...headers }, body: JSON.stringify(body) }, {});
  return { status: r.statusCode as number, json: JSON.parse(r.body || '{}') };
};

(async () => {
  // A phishing attempt from outside: nothing is read, nothing is sent.
  fetchCalls = 0;
  const phish = await call({ to: 'owner@shop.example', subject: 'Payroll problem', html: '<a href="https://evil.example">fix</a>' });
  ok('caller-written email refused (403)', phish.status === 403);
  ok('refused before touching Firestore or Resend', fetchCalls === 0);
  const phish2 = await call({ kind: 'daily-recap', subject: 'Payroll problem', html: '<b>x</b>' });
  ok('recap request with content refused', phish2.status === 400 && fetchCalls === 0);

  // Settings → "Send now"
  const sent = await call({ kind: 'daily-recap' });
  ok('recap sent', sent.status === 200 && sent.json.ok === true && sent.json.id === 'email_1');
  const email = resendCalls[0] || {};
  ok('recipients come from saved settings', JSON.stringify(email.to) === JSON.stringify(['owner@shop.example', 'boss@shop.example']));
  ok('subject built on the server', typeof email.subject === 'string' && email.subject.startsWith('Daily Recap — SC Deburring — '));
  ok('html + text built on the server', typeof email.html === 'string' && email.html.includes('SC Deburring') && typeof email.text === 'string');
  ok('sent from the configured sender', email.from === 'Shop <recap@shop.example>');
  ok('stamp written', !!stamp && stamp.fields.count.integerValue === '1');

  const again = await call({ kind: 'daily-recap' });
  ok('second "Send now" within 10 min refused (429)', again.status === 429 && /10 minutes/.test(again.json.error));
  ok('…and nothing sent', resendCalls.length === 1);

  // Two clicks at the same moment: exactly one email.
  stamp = null;
  resendCalls = [];
  const both = await Promise.all([call({ kind: 'daily-recap' }), call({ kind: 'daily-recap' })]);
  ok('simultaneous requests → one email', resendCalls.length === 1);
  ok('…the other gets 429', both.map(b => b.status).sort().join() === '200,429');

  // Resend refuses → the slot is given back, and no account detail leaks.
  stamp = null;
  resendCalls = [];
  resendStatus = 403;
  const failed = await call({ kind: 'daily-recap' });
  ok('Resend failure → 502', failed.status === 502);
  ok('Resend message not echoed to the browser', !String(failed.json.error).includes('secret account detail'));
  ok('slot released after a failed send', stamp === null);
  resendStatus = 200;
  const retry = await call({ kind: 'daily-recap' });
  ok('owner can retry right away after a failure', retry.status === 200);

  // Trusted server-to-server relay still works.
  resendCalls = [];
  const relay = await call({ to: 'anyone@else.example', subject: 'Server note', html: '<p>hi</p>' }, { 'x-fabtrack-key': 'relay-secret' });
  ok('relay secret: general send still works', relay.status === 200 && resendCalls[0]?.subject === 'Server note'
    && JSON.stringify(resendCalls[0]?.to) === JSON.stringify(['anyone@else.example']));
  const wrongKey = await call({ to: 'anyone@else.example', subject: 'x', html: 'y' }, { 'x-fabtrack-key': 'guess' });
  ok('wrong relay secret refused', wrongKey.status === 403);

  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})().catch(e => { console.log('FAIL: crashed', e); process.exit(1); });
