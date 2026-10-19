// netlify/functions/timer-action.ts
// ─────────────────────────────────────────────────────────────────────
// POST /.netlify/functions/timer-action
// Body: { action: 'pause' | 'resume' | 'stop', logId: string, userId: string }
//
// Called by the Service Worker when a user taps a notification action button
// while the app is CLOSED (background). Directly updates the Firestore log.
// Validates ownership before touching any data.
//
// 200 { ok: true, message } ONLY once Firestore has accepted the write —
// the service worker shows `message` ("⏹ Stopped — 3h 12m") on the lock
// screen, so it must never be sent for a write that didn't happen.
// 409 { ok: false } the timer changed after it was read (stopped in the app,
//     auto clock-out) — nothing is overwritten.
// 502 { ok: false } Firestore couldn't be read or refused the write.
// ─────────────────────────────────────────────────────────────────────

import type { Handler } from '@netlify/functions';

const JSON_H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

// ── Firestore REST helpers ────────────────────────────────────────────

function fsVal(v: any): any {
  if (v == null) return null;
  if ('stringValue'    in v) return v.stringValue;
  if ('integerValue'   in v) return Number(v.integerValue);
  if ('doubleValue'    in v) return v.doubleValue;
  if ('booleanValue'   in v) return v.booleanValue;
  if ('nullValue'      in v) return null;
  if ('timestampValue' in v) return new Date(v.timestampValue).getTime();
  if ('arrayValue'     in v) return (v.arrayValue.values || []).map(fsVal);
  if ('mapValue'       in v) {
    const obj: any = {};
    for (const [k, vv] of Object.entries(v.mapValue.fields || {})) obj[k] = fsVal(vv as any);
    return obj;
  }
  return undefined;
}

function fsDoc(raw: any): any {
  const parts = (raw.name || '').split('/');
  const out: any = { id: parts[parts.length - 1], _name: raw.name };
  for (const [k, v] of Object.entries(raw.fields || {})) out[k] = fsVal(v as any);
  return out;
}

const logUrl = (logId: string, projectId: string) =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/logs/${encodeURIComponent(logId)}`;

type LogRead =
  | { kind: 'found'; log: any; updateTime?: string }
  | { kind: 'missing' }
  | { kind: 'error' };

/** Fetch the log — telling "doesn't exist" apart from "couldn't read it". */
async function getLog(logId: string, apiKey: string, projectId: string): Promise<LogRead> {
  try {
    const res = await fetch(`${logUrl(logId, projectId)}?key=${apiKey}`);
    if (res.status === 404) return { kind: 'missing' };
    if (!res.ok) return { kind: 'error' };
    const raw: any = await res.json();
    if (!raw || raw.error) return { kind: 'error' };
    return { kind: 'found', log: fsDoc(raw), updateTime: typeof raw.updateTime === 'string' ? raw.updateTime : undefined };
  } catch {
    return { kind: 'error' };
  }
}

/**
 * Partial-update the log using field masks (supports null values), only if it
 * is still exactly the version we read (`updateTime` precondition) — so a
 * timer stopped in the app or by auto clock-out in the meantime is never
 * overwritten. Resolves 'ok' only when Firestore accepted the write.
 */
async function patchLog(
  logId: string,
  updates: Record<string, string | number | boolean | null>,
  readUpdateTime: string | undefined,
  apiKey: string,
  projectId: string,
): Promise<'ok' | 'conflict' | 'error'> {
  const fieldPaths = Object.keys(updates)
    .map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join('&');
  const precondition = readUpdateTime
    ? `currentDocument.updateTime=${encodeURIComponent(readUpdateTime)}`
    : 'currentDocument.exists=true';
  const url = `${logUrl(logId, projectId)}?key=${apiKey}&${fieldPaths}&${precondition}`;

  const fields: any = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v === null)            fields[k] = { nullValue: null };
    else if (typeof v === 'string')  fields[k] = { stringValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    // Keep decimals (e.g. 1.5-minute durations) — the app's own writes store them as doubles.
    else                             fields[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }

  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    if (res.ok) return 'ok';
    const err: any = await res.json().catch(() => null);
    const status = String(err?.error?.status || '');
    console.warn(`[timer-action] write rejected for logId=${logId}: ${res.status} ${status}`);
    return status === 'FAILED_PRECONDITION' || status === 'NOT_FOUND' ? 'conflict' : 'error';
  } catch {
    return 'error';
  }
}

/** Format ms as "Xh Ym" or "Ym". */
function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Handler ───────────────────────────────────────────────────────────

export const handler: Handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: JSON_H, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: JSON_H, body: JSON.stringify({ error: 'POST only' }) };
  }

  let body: any;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: JSON_H, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { action, logId, userId } = body as { action?: string; logId?: string; userId?: string };

  if (!action || !logId || !userId) {
    return { statusCode: 400, headers: JSON_H, body: JSON.stringify({ error: 'action, logId, userId required' }) };
  }
  if (!['pause', 'resume', 'stop'].includes(action)) {
    return { statusCode: 400, headers: JSON_H, body: JSON.stringify({ error: 'Invalid action — must be pause | resume | stop' }) };
  }
  // Log ids are short [A-Za-z0-9_-] strings — anything else never names a log.
  if (typeof logId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(logId)) {
    return { statusCode: 400, headers: JSON_H, body: JSON.stringify({ error: 'Invalid logId' }) };
  }

  const apiKey    = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || 'AIzaSyChOewBMJeW3oAM4KYn6ergrGIV9bPHTC8';
  const projectId = process.env.FIREBASE_PROJECT_ID || 'sc-job-tracker';

  // Fetch the log
  const read = await getLog(logId, apiKey, projectId);
  if (read.kind === 'missing') {
    return { statusCode: 404, headers: JSON_H, body: JSON.stringify({ ok: false, error: 'Log not found' }) };
  }
  if (read.kind === 'error') {
    return { statusCode: 502, headers: JSON_H, body: JSON.stringify({ ok: false, error: "Couldn't reach the timer — open FabTrack" }) };
  }
  const log = read.log;

  // Ownership check — only the worker who owns the log can act on it
  if (String(log.userId) !== String(userId)) {
    return { statusCode: 403, headers: JSON_H, body: JSON.stringify({ error: 'Not your timer' }) };
  }

  // Must be an open log — running OR paused (the app writes status 'paused'
  // while paused; only accepting 'in_progress' made Stop / Resume from the lock
  // screen do nothing for a paused timer).
  if (log.endTime || (log.status !== 'in_progress' && log.status !== 'paused')) {
    return { statusCode: 400, headers: JSON_H, body: JSON.stringify({ error: 'Timer is not running', status: log.status }) };
  }

  const now = Date.now();
  let updates: Record<string, string | number | boolean | null> = {};
  let message = '';

  if (action === 'pause') {
    if (log.pausedAt) {
      return { statusCode: 400, headers: JSON_H, body: JSON.stringify({ error: 'Already paused' }) };
    }
    const elapsed = now - log.startTime - (log.totalPausedMs || 0);
    // Same fields the app writes, so the lunch-end auto-resume treats this as
    // the worker's own pause (never auto-resumed).
    updates = {
      pausedAt:    now,
      pauseReason: 'manual',
      status:      'paused',
      updatedAt:   now,
    };
    message = `⏸ Paused at ${fmt(elapsed)}`;

  } else if (action === 'resume') {
    if (!log.pausedAt) {
      return { statusCode: 400, headers: JSON_H, body: JSON.stringify({ error: 'Timer is not paused' }) };
    }
    const thisBreakMs = now - log.pausedAt;
    updates = {
      pausedAt:      null,
      pauseReason:   null,
      status:        'in_progress',
      totalPausedMs: (log.totalPausedMs || 0) + Math.max(0, thisBreakMs),
      updatedAt:     now,
    };
    message = `▶ Resumed`;

  } else if (action === 'stop') {
    // If paused when stopped, close out the current pause period first
    const totalPaused = (log.totalPausedMs || 0) + (log.pausedAt ? now - log.pausedAt : 0);
    const durationMs  = Math.max(0, now - log.startTime - totalPaused);
    // Same rounding as the app's stopTimeLog (2-decimal minutes).
    const durationSeconds = Math.floor(durationMs / 1000);

    updates = {
      endTime:         now,
      status:          'completed',
      durationMinutes: Math.round((durationSeconds / 60) * 100) / 100,
      durationSeconds,
      totalPausedMs:   totalPaused,
      pausedAt:        null,
      pauseReason:     null,
      updatedAt:       now,
      // The worker's own action — the app shows no "your timer was stopped" note.
      stopReason:      'sw:notification',
    };
    message = `⏹ Stopped — ${fmt(durationMs)}`;
  }

  const written = await patchLog(logId, updates, read.updateTime, apiKey, projectId);
  if (written === 'conflict') {
    return { statusCode: 409, headers: JSON_H, body: JSON.stringify({ ok: false, error: 'Timer changed — open FabTrack' }) };
  }
  if (written !== 'ok') {
    return { statusCode: 502, headers: JSON_H, body: JSON.stringify({ ok: false, error: "Couldn't save — open FabTrack" }) };
  }

  console.log(`[timer-action] ${action} → logId=${logId} userId=${userId} result="${message}"`);

  return {
    statusCode: 200,
    headers: JSON_H,
    body: JSON.stringify({ ok: true, action, message }),
  };
};
