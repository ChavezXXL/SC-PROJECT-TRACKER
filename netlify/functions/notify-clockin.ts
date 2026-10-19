// netlify/functions/notify-clockin.ts
// ═════════════════════════════════════════════════════════════════════
// Called by the app the INSTANT a worker clocks in or out. Delivers a Web
// Push to every admin device — even when their browser is closed.
//
// POST body (same-origin only — no CORS):
//   { eventType: 'clock-in' | 'clock-out' | 'over-estimate', logId: string }
//
// Nothing else from the request is used. The function reads that time log
// itself (Admin SDK) and writes the notification from the log's own fields,
// only for an event that really just happened to that log:
//   clock-in       the log was created within the last 10 minutes
//   clock-out      the log was stopped (not by the system) within 10 minutes
//   over-estimate  the timer is running and past its job's expected hours
// Each (event, log) is pushed at most once: an atomic create of
// push_meta/notify_{eventType}_{logId} claims it; a repeat returns 200 and
// sends nothing.
//
// Responses: 200 { ok, sent, failed, removed } | { ok, sent: 0, skipped|duplicate }
//            409 { retry: true } — the log isn't on the server in that state yet
//                (a slow connection can leave the app's write in flight); the
//                app asks again a few seconds later.
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
import { PUSH_TIMEOUT_MS, isGonePushError } from './_shared/pushSafety';
import {
  adminPushTargets, buildAdminPush, checkClockEvent, checkOverEstimate,
  isActiveAdmin, isAdminNotifyEvent, isDocId, isLogId,
  type NotifyLog, type OverEstimate, type StoredSub, type StoredUser,
} from './_shared/clockNotify';

const JSON_H = { 'Content-Type': 'application/json' };
const reply = (statusCode: number, body: Record<string, unknown>, extra: Record<string, string> = {}) =>
  ({ statusCode, headers: { ...JSON_H, ...extra }, body: JSON.stringify(body) });

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

/** Firestore's "document already exists" error (gRPC ALREADY_EXISTS = 6). */
function isAlreadyExists(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown } | null;
  return err?.code === 6 || /ALREADY_EXISTS/i.test(String(err?.message ?? ''));
}

// ── Handler ───────────────────────────────────────────────────────────

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'POST only' }, { Allow: 'POST' });
  }
  // The app calls this from its own pages. A page on another site can still
  // fire a plain form POST at it; browsers label those, so turn them away.
  const fetchSite = String(event.headers?.['sec-fetch-site'] || event.headers?.['Sec-Fetch-Site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') {
    return reply(403, { error: 'Forbidden' });
  }

  const vapidPub  = process.env.VAPID_PUBLIC_KEY;
  const vapidPriv = process.env.VAPID_PRIVATE_KEY;
  const vapidSubj = process.env.VAPID_SUBJECT || 'mailto:hello@fabtrack.io';
  if (!vapidPub || !vapidPriv) {
    console.error('[notify-clockin] VAPID keys not set — configure VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Netlify env vars');
    return reply(500, { error: 'Push is not configured' });
  }

  let body: any;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'Invalid JSON' }); }

  const eventType = body?.eventType;
  const logId = body?.logId;
  if (!isAdminNotifyEvent(eventType) || !isLogId(logId)) {
    return reply(400, { error: 'eventType and logId required' });
  }

  try {
    const db = getFirestore();
    const now = Date.now();

    // 1. The log itself — the only source of the notification text.
    const logSnap = await db.collection('logs').doc(logId).get();
    if (!logSnap.exists) {
      return reply(409, { ok: false, retry: true, error: 'Log not found' });
    }
    const log = (logSnap.data() || {}) as NotifyLog;

    // 2. Only an event that really just happened to this log.
    let over: OverEstimate | undefined;
    if (eventType === 'over-estimate') {
      const jobId = log.jobId;
      const jobSnap = isDocId(jobId) ? await db.collection('jobs').doc(jobId).get() : null;
      const check = checkOverEstimate(log, jobSnap?.exists ? jobSnap.data() : null, now);
      if (check.ok === false) return reply(200, { ok: true, sent: 0, skipped: check.reason });
      over = check.over;
    } else {
      const check = checkClockEvent(eventType, log, {
        createdMs: logSnap.createTime?.toMillis() ?? 0,
        updatedMs: logSnap.updateTime?.toMillis() ?? 0,
      }, now);
      if (check.ok === false) {
        return check.retry
          ? reply(409, { ok: false, retry: true, error: check.reason })
          : reply(200, { ok: true, sent: 0, skipped: check.reason });
      }
    }

    // 3. At most one push per (event, log): whoever creates the marker sends.
    try {
      await db.collection('push_meta').doc(`notify_${eventType}_${logId}`).create({ eventType, logId, at: now });
    } catch (e) {
      if (isAlreadyExists(e)) return reply(200, { ok: true, sent: 0, duplicate: true });
      throw e;
    }

    // 4. Recipients: still-active admins / managers / owners (role from the
    //    users collection, never from the subscription doc), then their push
    //    subscriptions — read once ('in' takes up to 30 ids per query).
    const userSnap = await db.collection('users').get();
    const usersById = new Map<string, StoredUser>(userSnap.docs.map(d => [d.id, (d.data() || {}) as StoredUser]));
    const adminIds = [...usersById].filter(([, u]) => isActiveAdmin(u)).map(([id]) => id);
    const subs: StoredSub[] = [];
    for (let i = 0; i < adminIds.length; i += 30) {
      const snap = await db.collection('push_subscriptions').where('userId', 'in', adminIds.slice(i, i + 30)).get();
      snap.docs.forEach(d => subs.push({ ...(d.data() as Omit<StoredSub, 'id'>), id: d.id }));
    }
    const targets = adminPushTargets(subs, usersById);
    if (targets.length === 0) {
      console.log('[notify-clockin] No admin subscriptions found');
      return reply(200, { ok: true, sent: 0, note: 'no admin subs' });
    }

    // 5. Send — in parallel, each request capped by PUSH_TIMEOUT_MS.
    webpush.setVapidDetails(vapidSubj, vapidPub, vapidPriv);
    const payload = JSON.stringify(buildAdminPush(eventType, log, logId, over));
    const results = await Promise.all(targets.map(async (t): Promise<'sent' | 'failed' | 'removed'> => {
      try {
        await webpush.sendNotification(t.sub, payload, { TTL: 300, timeout: PUSH_TIMEOUT_MS }); // 5-min TTL
        return 'sent';
      } catch (e: any) {
        if (isGonePushError(e)) {
          await Promise.all(t.ids.map(id => db.collection('push_subscriptions').doc(id).delete().catch(() => {})));
          return 'removed';
        }
        console.warn(`[notify-clockin] Push failed for sub ${t.ids[0]}: ${e?.statusCode || e?.code || 'error'}`);
        return 'failed';
      }
    }));
    const sent = results.filter(r => r === 'sent').length;
    const failed = results.filter(r => r === 'failed').length;
    const removed = results.filter(r => r === 'removed').length;

    console.log(`[notify-clockin] ${eventType} ${logId} → sent:${sent} failed:${failed} removed:${removed}`);
    return reply(200, { ok: true, sent, failed, removed });
  } catch (e: any) {
    console.error('[notify-clockin] failed:', e?.message || e);
    return reply(500, { error: 'Notification failed' });
  }
};
