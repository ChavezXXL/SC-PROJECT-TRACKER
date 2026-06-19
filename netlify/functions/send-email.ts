// netlify/functions/send-email.ts
// ═════════════════════════════════════════════════════════════════════
// Transactional email endpoint — powered by Resend.
//
// Used for:
//   • Daily shop recap (worker hours, completed jobs, revenue, rework)
//   • Test email from Settings
//
// Request (POST JSON):
//   {
//     to: string,           // recipient address
//     subject: string,
//     html: string,         // full HTML body
//     text?: string         // plain-text fallback (optional)
//   }
//
// Response:
//   200 { ok: true, id: string }    — delivered to Resend
//   400 { error }                   — bad input
//   500 { error }                   — Resend error or missing config
//
// Env vars required in Netlify dashboard:
//   RESEND_API_KEY   — from https://resend.com (free tier: 100 emails/day)
//   RESEND_FROM      — verified sender, e.g. "FabTrack IO <recap@yourdomain.com>"
//                      Or use Resend's default: "onboarding@resend.dev" (sandbox only)
// ═════════════════════════════════════════════════════════════════════

import type { Handler } from '@netlify/functions';

// Only our own app origins may call this from a browser. Add custom domains via
// the ALLOWED_ORIGINS env var (comma-separated). A curl attacker ignores CORS,
// so this is paired with an optional shared-secret gate below.
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

  // Optional shared-secret gate: when EMAIL_RELAY_SECRET is set in Netlify, every
  // caller must send a matching x-fabtrack-key header. Off by default so existing
  // flows keep working; turn it on to fully lock the relay to trusted callers.
  const relaySecret = process.env.EMAIL_RELAY_SECRET;
  if (relaySecret) {
    const provided = (event.headers?.['x-fabtrack-key'] || event.headers?.['X-Fabtrack-Key']) as string | undefined;
    if (provided !== relaySecret) {
      return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
  }

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

  const { to, subject, html, text } = body;
  if (!to || !subject || !html) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: 'Missing required fields: to, subject, html' }),
    };
  }
  // Cap recipients + payload so a single call can't fan out into a spam blast.
  const recipients = Array.isArray(to) ? to : [to];
  if (recipients.length > 10) {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Too many recipients (max 10)' }) };
  }
  if (String(html).length > 500_000) {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Body too large' }) };
  }

  const from = process.env.RESEND_FROM || 'FabTrack IO <onboarding@resend.dev>';

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(to) ? to : [to],
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
