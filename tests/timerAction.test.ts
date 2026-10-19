// timer-action (lock-screen Pause / Resume / Stop): "Stopped — 3h 12m" may
// only be reported once Firestore has really accepted the write.
//
// NO NETWORK: global fetch is replaced (never wrapped) by an in-memory fake of
// the Firestore REST API, and the env points at a fake project — a stray
// request throws instead of reaching anything real.
globalThis.fetch = (() => { throw new Error('fetch is stubbed in this test'); }) as any;
process.env.FIREBASE_API_KEY = 'test-key';
process.env.FIREBASE_PROJECT_ID = 'test-project';

import { handler } from '../netlify/functions/timer-action';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

const BASE = 'https://firestore.googleapis.com/v1/projects/test-project/databases/(default)/documents';
const READ_TIME = '2026-10-19T18:00:00.123456Z';
const start = Date.now() - (3 * 3600 + 12 * 60) * 1000;

let logDoc: any = null;
let readStatus = 200;
let patchMode: 'ok' | 'denied' | 'changed' | 'network' = 'ok';
let patches: string[] = [];
let calls = 0;

const res = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

globalThis.fetch = (async (input: any, init: any = {}) => {
  calls++;
  const url = String(input);
  const method = (init.method || 'GET').toUpperCase();
  if (!url.startsWith(`${BASE}/logs/log1?`) || !url.includes('key=test-key')) throw new Error('unexpected fetch ' + url);
  if (method === 'GET') {
    if (readStatus !== 200) return res(readStatus, { error: { status: 'UNAVAILABLE' } });
    return logDoc ? res(200, logDoc) : res(404, { error: { status: 'NOT_FOUND' } });
  }
  if (method === 'PATCH') {
    patches.push(url);
    if (patchMode === 'network') throw new TypeError('fetch failed');
    if (patchMode === 'denied') return res(403, { error: { status: 'PERMISSION_DENIED' } });
    if (patchMode === 'changed') return res(400, { error: { status: 'FAILED_PRECONDITION' } });
    return res(200, { updateTime: '2026-10-19T18:00:01Z' });
  }
  throw new Error('unexpected fetch ' + method + ' ' + url);
}) as any;

const freshLog = () => ({
  name: 'projects/test-project/databases/(default)/documents/logs/log1',
  fields: {
    userId: { stringValue: 'u1' },
    status: { stringValue: 'in_progress' },
    startTime: { integerValue: String(start) },
    totalPausedMs: { integerValue: '0' },
  },
  updateTime: READ_TIME,
});

const call = async (body: unknown) => {
  const r = await (handler as any)({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) }, {});
  return { status: r.statusCode as number, json: JSON.parse(r.body || '{}') };
};
const stop = { action: 'stop', logId: 'log1', userId: 'u1' };

(async () => {
  // Saved → success message
  logDoc = freshLog(); patchMode = 'ok'; patches = [];
  const done = await call(stop);
  ok('stop saved → 200 ok', done.status === 200 && done.json.ok === true);
  ok('lock-screen message shows the worked time', /^⏹ Stopped — 3h 1[12]m$/.test(done.json.message));
  ok('write only applies to the version that was read',
    patches.length === 1 && patches[0].includes(`currentDocument.updateTime=${encodeURIComponent(READ_TIME)}`));
  ok('write carries the stop fields', patches[0].includes('updateMask.fieldPaths=endTime') && patches[0].includes('updateMask.fieldPaths=stopReason'));

  // Firestore refuses the write → no success message
  logDoc = freshLog(); patchMode = 'denied';
  const denied = await call(stop);
  ok('rejected write → 5xx, ok:false', denied.status >= 500 && denied.json.ok === false);
  ok('…and no "Stopped" message', !('message' in denied.json));

  // Timer changed between read and write (stopped in the app / auto clock-out)
  logDoc = freshLog(); patchMode = 'changed';
  const changed = await call(stop);
  ok('timer changed meanwhile → 409, ok:false', changed.status === 409 && changed.json.ok === false);

  // Network failure on the write
  logDoc = freshLog(); patchMode = 'network';
  const offline = await call(stop);
  ok('write never reached Firestore → 5xx, ok:false', offline.status >= 500 && offline.json.ok === false);

  // Firestore unreadable → not "not found", and nothing written
  logDoc = freshLog(); patchMode = 'ok'; readStatus = 503; patches = [];
  const unreadable = await call(stop);
  ok('unreadable log → 5xx, nothing written', unreadable.status >= 500 && unreadable.json.ok === false && patches.length === 0);
  readStatus = 200;

  // Missing log / someone else's timer / already stopped → refused, nothing written
  logDoc = null; patches = [];
  ok('missing log → 404', (await call(stop)).status === 404);
  logDoc = freshLog();
  ok('not your timer → 403', (await call({ ...stop, userId: 'someone-else' })).status === 403);
  logDoc = freshLog(); logDoc.fields.status = { stringValue: 'completed' }; logDoc.fields.endTime = { integerValue: String(Date.now()) };
  ok('already stopped → 400', (await call(stop)).status === 400);
  ok('no write for any refused request', patches.length === 0);

  // Pause / resume still work
  logDoc = freshLog(); patchMode = 'ok';
  const paused = await call({ ...stop, action: 'pause' });
  ok('pause saved → 200', paused.status === 200 && /^⏸ Paused at /.test(paused.json.message));
  logDoc = freshLog(); logDoc.fields.status = { stringValue: 'paused' }; logDoc.fields.pausedAt = { integerValue: String(Date.now() - 60_000) };
  const resumed = await call({ ...stop, action: 'resume' });
  ok('resume saved → 200', resumed.status === 200 && resumed.json.message === '▶ Resumed');

  // Path-like ids never reach Firestore
  calls = 0;
  const odd = await call({ ...stop, logId: '../settings/system' });
  ok('path-like logId refused before any request', odd.status === 400 && calls === 0);

  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})().catch(e => { console.log('FAIL: crashed', e); process.exit(1); });
