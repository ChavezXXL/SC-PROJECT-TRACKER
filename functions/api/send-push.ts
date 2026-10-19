/// <reference types="@cloudflare/workers-types" />
// ═════════════════════════════════════════════════════════════════════
// /api/send-push — Cloudflare Pages Function
//
// Cloudflare copy of netlify/functions/send-push.ts (the live one), kept in
// step with it: Settings → Push Notifications → "Register This Device" calls
// it right after subscribing, to prove server push reaches the device.
//
// Request (POST JSON): { subscription: PushSubscription (toJSON()) }
//
// The notification is always the fixed test message below — no caller text
// is forwarded — and it is delivered only to a subscription on a real
// browser push service (netlify/functions/_shared/pushSafety.ts). This copy
// used to forward any title/body to any URL the caller supplied, so the
// server could be made to POST to internal or arbitrary hosts.
//
// Uses the `web-push` npm package via Cloudflare's `nodejs_compat` flag.
//
// Env vars (set via dashboard or `wrangler pages secret put`):
//   VAPID_PUBLIC_KEY   — must match client's VAPID_KEY constant
//   VAPID_PRIVATE_KEY  — paired secret from `npx web-push generate-vapid-keys`
//   VAPID_SUBJECT      — "mailto:you@example.com" or your site URL
// ═════════════════════════════════════════════════════════════════════

import webpush from 'web-push';
import { PUSH_TIMEOUT_MS, isGonePushError, safeSubscription } from '../../netlify/functions/_shared/pushSafety';

interface Env {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** The one notification this endpoint sends. */
const TEST_PUSH = {
  title: '🚀 Server Push Works',
  body: 'This notification came from the server — works when app is closed.',
  tag: 'server-push-test',
  url: '/',
  requireInteraction: false,
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...JSON_HEADERS, 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
  }
  if (request.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const pub = env.VAPID_PUBLIC_KEY;
  const priv = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT || 'mailto:hello@fabtrack.io';
  if (!pub || !priv) {
    return json(500, { error: 'Push is not configured on the server.' });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const subscription = safeSubscription(body?.subscription);
  if (!subscription) {
    return json(400, { error: 'Not a browser push subscription' });
  }

  webpush.setVapidDetails(subject, pub, priv);
  try {
    await webpush.sendNotification(subscription, JSON.stringify(TEST_PUSH), { TTL: 60 * 60, timeout: PUSH_TIMEOUT_MS });
    return json(200, { ok: true });
  } catch (e: any) {
    if (isGonePushError(e)) return json(410, { error: 'Subscription gone', gone: true });
    return json(502, { error: 'The push service did not accept the message' });
  }
};
