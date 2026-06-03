// netlify/functions/notify-clockin.ts
// ═════════════════════════════════════════════════════════════════════
// Called by the client the INSTANT a worker clocks in or out.
// Reads ALL admin push subscriptions from Firestore via the Admin SDK
// (bypasses security rules — server-to-server call) and delivers a
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
//   VAPID_PUBLIC_KEY         BFVc1-acJaLfgl4rxEYtQ-... (matches client utils/vapid.ts)
//   VAPID_PRIVATE_KEY        6dgjDw-u6OhV_4WdRDzFq...  (secret — never in source)
//   VAPID_SUBJECT            mailto:hello@fabtrack.io   (or your domain)
//   FIREBASE_SERVICE_ACCOUNT Full service-account JSON string (from Firebase Console →
//                            Project Settings → Service Accounts → Generate new key)
// ═════════════════════════════════════════════════════════════════════

import type { Handler } from '@netlify/functions';
import webpush from 'web-push';
import * as admin from 'firebase-admin';

const JSON_H = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── Firebase Admin helpers ────────────────────────────────────────────

function getFirestore(): admin.firestore.Firestore {
  if (admin.apps.length === 0) {
    const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!svcJson) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT env var not set — see function header for setup instructions');
    }
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(svcJson)),
    });
  }
  return admin.firestore();
}

/** Fetch all push subscription docs (Admin SDK bypasses security rules). */
async function fetchAllSubs(): Promise<any[]> {
  const db = getFirestore();
  const snap = await db.collection('push_subscriptions').get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/** Delete a stale push subscription doc. */
async function deleteSub(id: string): Promise<void> {
  const db = getFirestore();
  await db.collection('push_subscriptions').doc(id).delete().catch(() => {});
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

  // Read all push subscriptions via Admin SDK (bypasses Firestore security rules)
  let allSubs: any[];
  try {
    allSubs = await fetchAllSubs();
  } catch (e: any) {
    console.error('[notify-clockin] Failed to fetch subscriptions:', e?.message);
    return { statusCode: 500, headers: JSON_H, body: JSON.stringify({ error: 'Failed to fetch subscriptions: ' + e?.message }) };
  }

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
      await webpush.sendNotification(sub.subscription, payload, { TTL: 300 }); // 5-min TTL
      sent++;
    } catch (e: any) {
      const code = e?.statusCode || 0;
      if (code === 404 || code === 410) {
        await deleteSub(sub.id);
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
