// netlify/functions/send-email.ts
// ═════════════════════════════════════════════════════════════════════
// Transactional email endpoint — powered by Resend.
//
// Two kinds of request (POST JSON):
//
// 1. The daily recap — Settings → "Send now" (the only thing the browser
//    may ask for; no login needed):
//      { kind: 'daily-recap' }
//    No recipients, subject or body are accepted. The server builds the
//    recap from the shop's own data (_shared/recapEmail.ts, same builder as
//    test-recap) and sends it to the recap addresses saved in Settings, at
//    most once every 10 minutes and a few times a day (atomic stamp in
//    push_meta/recap-now).
//
// 2. Relay — trusted server-to-server callers only, holding the
//    EMAIL_RELAY_SECRET (header x-fabtrack-key):
//      { to: string | string[], subject: string, html: string, text?: string }
//    Any other caller is refused (403) — subject / html never come from a browser.
//
// Response:
//   200 { ok: true, id: string }    — delivered to Resend
//   400 { error }                   — bad input / no saved recap address
//   403 { error }                   — content from an untrusted caller
//   429 { error }                   — "Send now" used too recently / too often today
//   5xx { error }                   — Resend / Firestore error or missing config
//
// Env vars required in Netlify dashboard:
//   RESEND_API_KEY   — from https://resend.com (free tier: 100 emails/day)
//   RESEND_FROM      — verified sender, e.g. "FabTrack IO <recap@yourdomain.com>"
//                      Or use Resend's default: "onboarding@resend.dev" (sandbox only)
//   EMAIL_RELAY_SECRET (optional) — enables the relay path for server code
// ═════════════════════════════════════════════════════════════════════

import type { Handler } from '@netlify/functions';
import type { SystemSettings } from '../../types';
import { recapSubject } from '../../utils/sendDailyRecap';
import {
  buildServerRecap, claimRecapNow, classifyEmailRequest, fetchDoc, fsRestFromEnv,
  recapRecipients, recapTimezone, shopDayKey,
} from './_shared/recapEmail';

// Only our own app origins may call this from a browser. Add custom domains via
// the ALLOWED_ORIGINS env var (comma-separated). A curl attacker ignores CORS,
// which is why the browser path accepts no content at all (see header).
const ALLOWED_ORIGINS = [
  'https://scprojtrac.netlify.app',
  'https://main--scprojtrac.netlify.app',
  ...((process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)),
];

function corsHeaders(origin?: string) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'Content-Type, x-fabtrack-key',
    'Vary': 'Origin',
  };
}

/** Settings → "Send now": build the recap on the server and send it to the
 *  saved recap addresses. Takes nothing from the request. */
async function sendRecapNow(resendKey: string, from: string): Promise<{ statusCode: number; body: string }> {
  const out = (statusCode: number, body: Record<string, unknown>) => ({ statusCode, body: JSON.stringify(body) });
  const fs = fsRestFromEnv();

  const settings = await fetchDoc(fs, 'settings', 'system').catch(() => null) as SystemSettings | null;
  if (!settings) return out(503, { error: "Couldn't load the shop's email settings — try again." });
  if (recapRecipients(settings as any).length === 0) {
    return out(400, { error: 'Save a recap email address in Settings first.' });
  }

  const now = new Date();
  const claim = await claimRecapNow(fs, now.getTime(), shopDayKey(recapTimezone(settings as any), now));
  if (claim.ok === false) return out(claim.status, { error: claim.error });

  try {
    const recap = await buildServerRecap(fs, settings, now);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: recap.to,
        subject: recapSubject(recap.data, recap.tz),
        html: recap.html,
        text: recap.text,
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[send-email] recap: Resend error', res.status, data?.name, data?.message);
      await claim.release();
      return out(502, {
        error: `The email service refused the recap (${res.status}${data?.name ? ` ${data.name}` : ''}) — check RESEND_API_KEY / RESEND_FROM in Netlify.`,
      });
    }
    console.log(`[send-email] recap sent (id=${data?.id}) to ${recap.to.length} address(es)`);
    return out(200, { ok: true, id: data?.id });
  } catch (e: any) {
    console.error('[send-email] recap failed:', e?.message || e);
    await claim.release();
    return out(502, { error: "Couldn't send the recap — try again in a minute." });
  }
}

export const handler: Handler = async (event) => {
  const origin = (event.headers?.origin || event.headers?.Origin) as string | undefined;
  const JSON_HEADERS = corsHeaders(origin);

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

  // Callers holding EMAIL_RELAY_SECRET (trusted server code) may send anything,
  // anywhere. Everyone else — i.e. the browser — may only ask for the recap.
  const relaySecret = process.env.EMAIL_RELAY_SECRET;
  const provided = (event.headers?.['x-fabtrack-key'] || event.headers?.['X-Fabtrack-Key']) as string | undefined;
  const trusted = !!relaySecret && provided === relaySecret;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        error: 'RESEND_API_KEY not configured. Add it to Netlify → Site settings → Environment variables.',
      }),
    };
  }

  let body: any;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const request = classifyEmailRequest(body, trusted);
  if (request.kind === 'refused') {
    return { statusCode: request.status, headers: JSON_HEADERS, body: JSON.stringify({ error: request.error }) };
  }

  const from = process.env.RESEND_FROM || 'FabTrack IO <onboarding@resend.dev>';

  if (request.kind === 'daily-recap') {
    return { headers: JSON_HEADERS, ...(await sendRecapNow(apiKey, from)) };
  }

  // ── Trusted relay (EMAIL_RELAY_SECRET) ──────────────────────────────
  const { to, subject, html, text } = body;
  if (!to || !subject || !html) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: 'Missing required fields: to, subject, html' }),
    };
  }
  // Cap recipients + payload so a single call can't fan out into a spam blast.
  const recipients: string[] = (Array.isArray(to) ? to : [to]).map((r: any) => String(r || '').trim()).filter(Boolean);
  if (recipients.length === 0 || recipients.length > 10) {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Need 1–10 recipients' }) };
  }
  if (String(html).length > 500_000) {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Body too large' }) };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject,
        html,
        ...(text ? { text } : {}),
      }),
    });

    const data = await res.json() as any;

    if (!res.ok) {
      console.error('[send-email] Resend error:', data);
      return {
        statusCode: res.status >= 400 && res.status < 600 ? res.status : 500,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: data?.message || data?.name || 'Resend API error' }),
      };
    }

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: true, id: data.id }),
    };
  } catch (e: any) {
    console.error('[send-email] fetch error:', e);
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: e?.message || 'Failed to reach Resend API' }),
    };
  }
};
