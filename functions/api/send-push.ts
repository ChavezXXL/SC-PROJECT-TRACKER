// ═════════════════════════════════════════════════════════════════════
// /api/send-push — Cloudflare Pages Function
//
// Web push delivery endpoint, ported from the old Netlify function.
// Same request/response shape so the client (Settings push panel + future
// scheduled cron) requires no changes.
//
// Uses the `web-push` npm package via Cloudflare's `nodejs_compat` flag.
//
// Env vars (set via dashboard or `wrangler pages secret put`):
//   VAPID_PUBLIC_KEY   — must match client's VAPID_KEY constant
//   VAPID_PRIVATE_KEY  — paired secret from `npx web-push generate-vapid-keys`
//   VAPID_SUBJECT      — "mailto:you@example.com" or your site URL
// ═════════════════════════════════════════════════════════════════════

// @ts-expect-error — web-push has no first-party types; runs via nodejs_compat.
import webpush from 'web-push';

interface Env {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADERS });
  }
  if (request.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const pub = env.VAPID_PUBLIC_KEY;
  const priv = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT || 'mailto:admin@fabtrack.io';

  if (!pub || !priv) {
    return json(500, {
      error:
        'VAPID keys not configured. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT in Cloudflare → Pages → Settings → Environment Variables.',
    });
  }

  webpush.setVapidDetails(subject, pub, priv);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { subscription, title, body: msgBody, tag, url, actions, logId, requireInteraction } = body;
  if (!subscription || !subscription.endpoint) {
    return json(400, { error: 'Missing subscription.endpoint' });
  }

  const payload = JSON.stringify({
    title: title || 'FabTrack IO',
    body: msgBody || '',
    tag,
    url,
    actions,
    logId,
    requireInteraction: !!requireInteraction,
  });

  try {
    await webpush.sendNotification(subscription, payload, { TTL: 60 * 60 });
    return json(200, { ok: true });
  } catch (e: any) {
    const status = e?.statusCode || 500;
    if (status === 404 || status === 410) {
      return json(410, { error: 'Subscription gone', gone: true });
    }
    return json(status >= 400 && status < 600 ? status : 500, {
      error: e?.message || 'Push delivery failed',
    });
  }
};
