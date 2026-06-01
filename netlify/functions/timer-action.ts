// netlify/functions/timer-action.ts
// ─────────────────────────────────────────────────────────────────────
// POST /.netlify/functions/timer-action
// Body: { action: 'pause' | 'resume' | 'stop', logId: string, userId: string }
//
// Called by the Service Worker when a user taps a notification action button
// while the app is CLOSED (background). Directly updates the Firestore log.
// Validates ownership before touching any data.
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

/** Fetch a single Firestore document. */
async function getLog(logId: string, apiKey: string, projectId: string): Promise<any | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/logs/${logId}?key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const raw: any = await res.json();
  if (raw.error) return null;
  return fsDoc(raw);
}

/** Partial-update a Firestore document using field masks. Supports null values. */
async function patchLog(
  logId: string,
  updates: Record<string, string | number | boolean | null>,
  apiKey: string,
  projectId: string,
): Promise<void> {
  const fieldPaths = Object.keys(updates)
    .map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/logs/${logId}?key=${apiKey}&${fieldPaths}`;

  const fields: any = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v === null)            fields[k] = { nullValue: null };
    else if (typeof v === 'string')  fields[k] = { stringValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else                             fields[k] = { integerValue: String(Math.round(v)) };
  }

  await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
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

  const apiKey    = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || 'AIzaSyChOewBMJeW3oAM4KYn6ergrGIV9bPHTC8';
  const projectId = process.env.FIREBASE_PROJECT_ID || 'sc-job-tracker';

  // Fetch the log
  const log = await getLog(logId, apiKey, projectId);
  if (!log) {
    return { statusCode: 404, headers: JSON_H, body: JSON.stringify({ error: 'Log not found' }) };
  }

  // Ownership check — only the worker who owns the log can act on it
  if (String(log.userId) !== String(userId)) {
    return { statusCode: 403, headers: JSON_H, body: JSON.stringify({ error: 'Not your timer' }) };
  }

  // Must be an active log
  if (log.status !== 'in_progress') {
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
    updates = {
      pausedAt:  now,
      updatedAt: now,
    };
    message = `⏸ Paused at ${fmt(elapsed)}`;

  } else if (action === 'resume') {
    if (!log.pausedAt) {
      return { statusCode: 400, headers: JSON_H, body: JSON.stringify({ error: 'Timer is not paused' }) };
    }
    const thisBreakMs = now - log.pausedAt;
    updates = {
      pausedAt:      null,
      totalPausedMs: (log.totalPausedMs || 0) + thisBreakMs,
      updatedAt:     now,
    };
    message = `▶ Resumed`;

  } else if (action === 'stop') {
    // If paused when stopped, close out the current pause period first
    const totalPaused = (log.totalPausedMs || 0) + (log.pausedAt ? now - log.pausedAt : 0);
    const durationMs  = Math.max(0, now - log.startTime - totalPaused);
    const durationMin = durationMs / 60_000;

    updates = {
      endTime:         now,
      status:          'completed',
      durationMinutes: durationMin,
      durationSeconds: Math.round(durationMs / 1000),
      totalPausedMs:   totalPaused,
      pausedAt:        null,
      updatedAt:       now,
      stopReason:      'notification_action',
    };
    message = `⏹ Stopped — ${fmt(durationMs)}`;
  }

  await patchLog(logId, updates, apiKey, projectId);

  console.log(`[timer-action] ${action} → logId=${logId} userId=${userId} result="${message}"`);

  return {
    statusCode: 200,
    headers: JSON_H,
    body: JSON.stringify({ ok: true, action, message }),
  };
};
