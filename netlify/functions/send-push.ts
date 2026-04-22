// netlify/functions/send-push.ts
// ═════════════════════════════════════════════════════════════════════
// Web Push delivery endpoint.
//
// Called from the client when a device registers, and (later) by a
// scheduled function that walks stored subscriptions and fires reminders.
//
// Request (POST JSON):
//   {
//     subscription: PushSubscription (toJSON()),
//     title: string,
//     body: string,
//     tag?: string,
//     url?: string,                     // where tapping the notification opens
//     actions?: NotificationAction[],   // lock-screen buttons
//     logId?: string,                   // for TIMER_ACTION messages
//     requireInteraction?: boolean
//   }
//
// Response:
//   200 { ok: true } on success
//   400 with { error } on malformed input
//   410 with { error, gone: true } when subscription has expired (caller
//       should remove it from storage)
//   500 with { error } on internal failure
//
// Env vars required in Netlify dashboard:
//   VAPID_PUBLIC_KEY   — must match the client's VAPID_KEY constant
//   VAPID_PRIVATE_KEY  — paired secret from `npx web-push generate-vapid-keys`
//   VAPID_SUBJECT      — "mailto:you@example.com" or your site URL
// ═════════════════════════════════════════════════════════════════════

import type { Handler } from '@netlify/functions';
// @ts-expect-error — web-push has no first-party types; shape matches upstream docs.
import webpush from 'web-push';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const handler: Handler = async (event) => {
  // CORS preflight — also used by the client's backend-presence probe.
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: { ...JSON_HEADERS, 'Access-Control-Allow-Methods': 'POST, OPTIONS' },
      body: JSON.stringify({ ok: true }),
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@sc-tracker.app';
  if (!pub || !priv) {
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        error: 'VAPID keys not configured. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT in Netlify env.',
      }),
    };
  }

  webpush.setVapidDetails(subject, pub, priv);

  let body: any;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { subscription, title, body: msgBody, tag, url, actions, logId, requireInteraction } = body;
  if (!subscription || !subscription.endpoint) {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Missing subscription.endpoint' }) };
  }

  const payload = JSON.stringify({
    title: title || 'SC Deburring',
    body: msgBody || '',
    tag,
    url,
    actions,
    logId,
    requireInteraction: !!requireInteraction,
  });

  try {
    await webpush.sendNotification(subscription, payload, { TTL: 60 * 60 }); // 1h TTL
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };
  } catch (e: any) {
    const status = e?.statusCode || 500;
    // 404 / 410 → subscription has been unregistered by the push service.
    // Caller should delete it from storage so we stop trying.
    if (status === 404 || status === 410) {
      return {
        statusCode: 410,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: 'Subscription gone', gone: true }),
      };
    }
    return {
      statusCode: status >= 400 && status < 600 ? status : 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: e?.message || 'Push delivery failed' }),
    };
  }
};
