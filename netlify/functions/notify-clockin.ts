// netlify/functions/notify-clockin.ts
// ═════════════════════════════════════════════════════════════════════
// Called by the client the INSTANT a worker clocks in or out.
// Reads ALL admin push subscriptions from Firestore and delivers a
// Web Push to every admin device — even when their browser is closed.
//
// POST body:
//   {
//     eventType:  'clock-in' | 'clock-out'
//     workerName: string
//     operation:  string
//     jobLabel:   string   // partNumber · customer
//   }
//
// Required Netlify env vars:
//   VAPID_PUBLIC_KEY    BFVc1-acJaLfgl4rxEYtQ-... (matches client utils/vapid.ts)
//   VAPID_PRIVATE_KEY   6dgjDw-u6OhV_4WdRDzFq...  (secret — never in source)
//   VAPID_SUBJECT       mailto:hello@fabtrack.io   (or your domain)
// ═════════════════════════════════════════════════════════════════════

import type { Handler } from '@netlify/functions';
import webpush from 'web-push';

const JSON_H = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── Firestore REST helpers ────────────────────────────────────────────

function fsVal(v: any): any {
  if (!v) return null;
  if ('stringValue'  in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue'  in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue'    in v) return null;
  if ('mapValue'     in v) {
    const obj: any = {};
    for (const [k, vv] of Object.entries(v.mapValue.fields || {})) obj[k] = fsVal(vv);
    return obj;
  }
  if ('arrayValue'   in v) return (v.arrayValue.values || []).map(fsVal);
  return null;
}

function fsDoc(raw: any): any {
  const parts = (raw.name || '').split('/');
  const out: any = { id: parts[parts.length - 1] };
  for (const [k, v] of Object.entries(raw.fields || {})) out[k] = fsVal(v as any);
  return out;
}

async function fetchCollection(col: string, apiKey: string, projectId: string): Promise<any[]> {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${col}`;
  const docs: any[] = [];
  let pageToken: string | undefined;
  do {
    const url = `${base}?key=${apiKey}&pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res  = await fetch(url);
    if (!res.ok) break;
    const data: any = await res.json();
    (data.documents || []).forEach((d: any) => docs.push(fsDoc(d)));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return docs;
}

/** Delete a stale push subscription doc. */
async function deleteSub(id: string, apiKey: string, projectId: string) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/push_subscriptions/${id}?key=${apiKey}`;
  await fetch(url, { method: 'DELETE' }).catch(() => {});
}

// ── Handler ───────────────────────────────────────────────────────────

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: JSON_H, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: JSON_H, body: JSON.stringify({ error: 'POST only' }) };
  }

  const vapidPub  = process.env.VAPID_PUBLIC_KEY;
  const vapidPriv = process.env.VAPID_PRIVATE_KEY;
  const vapidSubj = process.env.VAPID_SUBJECT || 'mailto:hello@fabtrack.io';

  if (!vapidPub || !vapidPriv) {
    console.error('[notify-clockin] VAPID keys not set — configure VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Netlify env vars');
    return { statusCode: 500, headers: JSON_H, body: JSON.stringify({ error: 'VAPID keys not configured' }) };
  }

  let body: any;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: JSON_H, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { eventType, workerName, operation, jobLabel } = body as {
    eventType?: string; workerName?: string; operation?: string; jobLabel?: string;
  };

  if (!eventType || !workerName) {
    return { statusCode: 400, headers: JSON_H, body: JSON.stringify({ error: 'eventType and workerName required' }) };
  }

  const apiKey    = process.env.FIREBASE_API_KEY    || process.env.VITE_FIREBASE_API_KEY    || 'AIzaSyChOewBMJeW3oAM4KYn6ergrGIV9bPHTC8';
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'sc-job-tracker';

  // Read all push subscriptions (flat collection — SC Deburring legacy path)
  const allSubs = await fetchCollection('push_subscriptions', apiKey, projectId);

  // Filter to admin/manager subscriptions only
  const adminSubs = allSubs.filter(s => {
    const role = (s.role || '').toLowerCase();
    return role === 'admin' || role === 'manager' || role === 'owner' || role === 'unknown' || !role; // notify all if role not stored
  });

  if (adminSubs.length === 0) {
    console.log('[notify-clockin] No admin subscriptions found');
    return { statusCode: 200, headers: JSON_H, body: JSON.stringify({ ok: true, sent: 0, note: 'no admin subs' }) };
  }

  webpush.setVapidDetails(vapidSubj, vapidPub, vapidPriv);

  const isIn   = eventType === 'clock-in';
  const title  = isIn ? `🟢 ${workerName} clocked in` : `🔴 ${workerName} clocked out`;
  const detail = [operation, jobLabel].filter(Boolean).join('  ·  ');
  const payload = JSON.stringify({
    title,
    body: detail || (isIn ? 'Timer started' : 'Timer stopped'),
    tag:  `${eventType}-${workerName}-${Date.now()}`,
    url:  '/',
    icon: '/brand/ftio-icon.png',
    requireInteraction: false,
  });

  let sent = 0, failed = 0, removed = 0;
  for (const sub of adminSubs) {
    if (!sub.subscription?.endpoint) continue;
    try {
      await webpush.sendNotification(sub.subscription, payload, { TTL: 300 }); // 5-min TTL — stale = don't deliver
      sent++;
    } catch (e: any) {
      const code = e?.statusCode || 0;
      if (code === 404 || code === 410) {
        await deleteSub(sub.id, apiKey, projectId);
        removed++;
      } else {
        failed++;
        console.warn(`[notify-clockin] Push failed for sub ${sub.id}: ${e?.message}`);
      }
    }
  }

  console.log(`[notify-clockin] ${eventType} ${workerName} → sent:${sent} failed:${failed} removed:${removed}`);
  return { statusCode: 200, headers: JSON_H, body: JSON.stringify({ ok: true, sent, failed, removed }) };
};
