// netlify/functions/test-push.ts
// ─────────────────────────────────────────────────────────────────────
// GET /.netlify/functions/test-push
// Sends a real Web Push notification to every subscribed device right now.
// Use to verify background push works before opening the app.
// ─────────────────────────────────────────────────────────────────────

import type { Handler } from '@netlify/functions';
import webpush from 'web-push';

const JSON_H = { 'Content-Type': 'application/json' };

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
    const res = await fetch(url);
    const data: any = await res.json();
    if (!res.ok) break;
    (data.documents || []).forEach((d: any) => docs.push(fsDoc(d)));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return docs;
}

async function deleteDoc(col: string, id: string, apiKey: string, projectId: string) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${col}/${id}?key=${apiKey}`;
  await fetch(url, { method: 'DELETE' });
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: JSON_H, body: JSON.stringify({ error: 'GET only' }) };
  }

  const apiKey    = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || 'AIzaSyChOewBMJeW3oAM4KYn6ergrGIV9bPHTC8';
  const projectId = process.env.FIREBASE_PROJECT_ID || 'sc-job-tracker';
  const vapidPub  = process.env.VAPID_PUBLIC_KEY;
  const vapidPriv = process.env.VAPID_PRIVATE_KEY;
  const vapidSub  = process.env.VAPID_SUBJECT || 'mailto:hello@fabtrack.io';

  const log: string[] = [];
  const info = (m: string) => { console.log('[test-push]', m); log.push('✓  ' + m); };
  const fail = (m: string) => { console.error('[test-push]', m); log.push('✗  ' + m); };

  if (!vapidPub || !vapidPriv) {
    fail('VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY not set');
    return { statusCode: 500, headers: JSON_H, body: JSON.stringify({ ok: false, log }) };
  }
  info(`VAPID keys present`);

  const subDocs = await fetchCollection('push_subscriptions', apiKey, projectId);
  info(`Found ${subDocs.length} push subscription(s)`);

  if (subDocs.length === 0) {
    fail('No subscriptions — open the app first and grant notification permission');
    return { statusCode: 400, headers: JSON_H, body: JSON.stringify({ ok: false, log, hint: 'Open the app, grant notification permission, then try again.' }) };
  }

  webpush.setVapidDetails(vapidSub, vapidPub, vapidPriv);

  const payload = JSON.stringify({
    title: '🔔 FabTrack IO — Push Test',
    body:  'Background push is working! You got this without the app open.',
    tag:   'push-test',
    url:   '/',
    requireInteraction: true,
  });

  let sent = 0, failed = 0, removed = 0;

  for (const subDoc of subDocs) {
    const subscription = subDoc.subscription;
    if (!subscription?.endpoint) { failed++; continue; }
    try {
      await webpush.sendNotification(subscription, payload, { TTL: 60 * 60 });
      sent++;
      info(`Sent to userId=${subDoc.userId || 'unknown'} (sub ${subDoc.id?.slice(0, 12)}...)`);
    } catch (e: any) {
      const code = e?.statusCode || 0;
      if (code === 404 || code === 410) {
        await deleteDoc('push_subscriptions', subDoc.id, apiKey, projectId).catch(() => {});
        removed++;
        log.push(`🗑  Removed expired sub ${subDoc.id?.slice(0, 12)}...`);
      } else {
        fail(`Push failed for ${subDoc.id?.slice(0, 12)}: ${e?.message}`);
        failed++;
      }
    }
  }

  info(`Done — sent:${sent} failed:${failed} removed:${removed}`);

  return {
    statusCode: 200,
    headers: JSON_H,
    body: JSON.stringify({ ok: sent > 0, log, sent, failed, removed }),
  };
};
