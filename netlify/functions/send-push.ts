// netlify/functions/send-push.ts
// ═════════════════════════════════════════════════════════════════════
// Web Push test endpoint — Settings → Push Notifications → "Register This
// Device" calls it right after subscribing, to prove server push reaches the
// device. (Scheduled pushes go out from the cron functions directly.)
//
// Request (POST JSON):
//   { subscription: PushSubscription (toJSON()) }
//
// The notification is always the fixed test message below — no caller text
// is ever forwarded — and it is delivered only to a subscription on a real
// browser push service (see _shared/pushSafety.ts); anything else is refused
// before any request leaves the server.
//
// Response:
//   200 { ok: true } on success
//   400 { error } on malformed input / a subscription that isn't on a push service
//   410 { error, gone: true } when the subscription has expired (caller
//       should remove it from storage)
//   502 { error } when the push service didn't accept it
//   500 { error } when push isn't configured
//
// Env vars required in Netlify dashboard:
//   VAPID_PUBLIC_KEY   — must match the client's VAPID_KEY constant
//   VAPID_PRIVATE_KEY  — paired secret from `npx web-push generate-vapid-keys`
//   VAPID_SUBJECT      — "mailto:you@example.com" or your site URL
// ═════════════════════════════════════════════════════════════════════

import type { Handler } from '@netlify/functions';
import webpush from 'web-push';
import { PUSH_TIMEOUT_MS, isGonePushError, safeSubscription } from './_shared/pushSafety';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** The one notification this endpoint sends. */
const TEST_PUSH = {
  title: '🚀 Server Push Works',
  body: 'This notification came from the Netlify function — works when app is closed.',
  tag: 'server-push-test',
  url: '/',
  requireInteraction: false,
};

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
  const subject = process.env.VAPID_SUBJECT || 'mailto:hello@fabtrack.io';
  if (!pub || !priv) {
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        error: 'VAPID keys not configured. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT in Netlify env.',
      }),
    };
  }

  let body: any;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const subscription = safeSubscription(body?.subscription);
  if (!subscription) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: 'Not a browser push subscription' }),
    };
  }

  webpush.setVapidDetails(subject, pub, priv);

  try {
    await webpush.sendNotification(subscription, JSON.stringify(TEST_PUSH), { TTL: 60 * 60, timeout: PUSH_TIMEOUT_MS }); // 1h TTL
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };
  } catch (e: any) {
    // 404 / 410 → subscription has been unregistered by the push service.
    // Caller should delete it from storage so we stop trying.
    if (isGonePushError(e)) {
      return {
        statusCode: 410,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: 'Subscription gone', gone: true }),
      };
    }
    // Never echo the underlying error (connection details, push-service body).
    console.warn(`[send-push] delivery failed: ${e?.statusCode || e?.code || 'error'}`);
    return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Push delivery failed' }) };
  }
};
