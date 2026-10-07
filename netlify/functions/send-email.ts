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

/** The shop's saved recap recipients (settings/system: recapEmail + recapEmailCC),
 *  lowercased. null when settings can't be read — callers fail closed. */
async function allowedRecapRecipients(): Promise<Set<string> | null> {
  const apiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || 'AIzaSyChOewBMJeW3oAM4KYn6ergrGIV9bPHTC8';
  const projectId = process.env.FIREBASE_PROJECT_ID || 'sc-job-tracker';
  try {
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/settings/system?key=${apiKey}`);
    if (!res.ok) return null;
    const doc = await res.json() as any;
    const str = (f: string) => (doc?.fields?.[f]?.stringValue || '') as string;
    const list = [str('recapEmail'), ...str('recapEmailCC').split(',')]
      .map(s => s.trim().toLowerCase())
      .filter(s => s.includes('@'));
    return new Set(list);
  } catch {
    return null;
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

  // Callers holding EMAIL_RELAY_SECRET (trusted server code) may send anywhere.
  // Everyone else — i.e. the browser — may only email the shop's OWN recap
  // recipients from Settings. This endpoint used to send any subject/HTML to
  // any address from the shop's verified sender, with no login: an open relay
  // anyone could use to phish the shop's customers in the shop's name.
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
  if (!trusted) {
    const allowed = await allowedRecapRecipients();
    if (!allowed) {
      return { statusCode: 503, headers: JSON_HEADERS, body: JSON.stringify({ error: "Couldn't load the shop's email settings — try again." }) };
    }
    const blocked = recipients.filter(r => !allowed.has(r.toLowerCase()));
    if (blocked.length) {
      return {
        statusCode: 403,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: 'Recaps can only go to the recap email addresses saved in Settings. Save the address there first.' }),
      };
    }
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
