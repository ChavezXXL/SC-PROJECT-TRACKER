// netlify/functions/test-recap.ts
// ═════════════════════════════════════════════════════════════════════
// Manual trigger endpoint for the daily recap email.
//
// Hit this URL from your browser to send a test recap RIGHT NOW:
//   https://your-site.netlify.app/.netlify/functions/test-recap?key=…
//   (or on Netlify alias: https://app.fabtrack.io/.netlify/functions/test-recap?key=…)
//
// Returns JSON with { ok, details } so you can see exactly what happened.
// The recap is built by _shared/recapEmail.ts — the same server-side builder
// behind Settings → "Send now" (send-email { kind: 'daily-recap' }).
//
// Same env vars as daily-recap-cron:
//   VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID
//   RESEND_API_KEY, RESEND_FROM
// ═════════════════════════════════════════════════════════════════════

import type { Handler } from '@netlify/functions';
import type { SystemSettings } from '../../types';
import { buildServerRecap, fetchDoc, fsRestFromEnv } from './_shared/recapEmail';

const JSON_H = { 'Content-Type': 'application/json' };

// ── Handler ────────────────────────────────────────────────────────────

export const handler: Handler = async (event) => {
  // Debug endpoint: emails the full shop recap and echoes the recipient/CC
  // addresses. It was open to anyone with the URL. Now it only runs with ?key=
  // matching FABTRACK_ADMIN_KEY — and is invisible (404) when that isn't set.
  const adminKey = process.env.FABTRACK_ADMIN_KEY;
  if (!adminKey || event.queryStringParameters?.key !== adminKey) {
    return { statusCode: 404, headers: JSON_H, body: JSON.stringify({ error: 'Not found' }) };
  }
  // Only allow GET (browser visit)
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: JSON_H, body: JSON.stringify({ error: 'GET only' }) };
  }

  const log: string[] = [];
  const warn = (msg: string) => { console.warn('[test-recap]', msg); log.push('⚠️  ' + msg); };
  const info = (msg: string) => { console.log('[test-recap]', msg);  log.push('✓  ' + msg); };
  const fail = (msg: string) => { console.error('[test-recap]', msg); log.push('✗  ' + msg); };

  // 1. Check env vars
  const fs        = fsRestFromEnv();
  const resendKey = process.env.RESEND_API_KEY;
  const from      = process.env.RESEND_FROM || 'FabTrack IO <noreply@scprecisiondeburring.com>';

  if (!fs.apiKey) { fail('VITE_FIREBASE_API_KEY not set in Netlify env'); }
  else { info(`Firebase project: ${fs.projectId}`); }

  if (!resendKey) { fail('RESEND_API_KEY not set in Netlify env'); }
  else { info('RESEND_API_KEY present'); }

  if (!fs.apiKey || !resendKey) {
    return {
      statusCode: 500,
      headers: JSON_H,
      body: JSON.stringify({ ok: false, log, hint: 'Add missing env vars in Netlify → Site config → Environment variables' }),
    };
  }

  // 2. Load settings
  const settings = await fetchDoc(fs, 'settings', 'system').catch(() => null) as SystemSettings | null;
  if (!settings) {
    fail('settings/system doc not found in Firestore');
    return { statusCode: 500, headers: JSON_H, body: JSON.stringify({ ok: false, log }) };
  }
  info('Settings loaded');
  info(`recapEmailEnabled: ${(settings as any).recapEmailEnabled}`);
  info(`recapEmail: ${settings.recapEmail || '(not set)'}`);
  info(`recapTime: ${settings.recapTime || '(not set)'}`);
  info(`recapLastSentDate: ${(settings as any).recapLastSentDate || '(never)'}`);

  if (!settings.recapEmail?.trim()) {
    warn('No recapEmail configured — set it in Settings → Schedule');
    return { statusCode: 400, headers: JSON_H, body: JSON.stringify({ ok: false, log, hint: 'Set a recap email address in Settings → Schedule → Daily Email Recap' }) };
  }

  // 3. Load data + build the recap (shared server-side builder)
  let recap: Awaited<ReturnType<typeof buildServerRecap>>;
  try {
    recap = await buildServerRecap(fs, settings);
  } catch (e: any) {
    fail(`Couldn't load shop data: ${e?.message}`);
    return { statusCode: 500, headers: JSON_H, body: JSON.stringify({ ok: false, log }) };
  }
  const { counts } = recap;
  info(`Loaded ${counts.jobs} jobs, ${counts.logs} logs, ${counts.users} users, ${counts.openRework} open rework`);

  const subject = `[TEST] ${recap.shopName} — Daily Recap · ${recap.dateLabel}`;
  const to = recap.to;
  if (to.length === 0) {
    warn('The saved recap address does not look like an email address');
    return { statusCode: 400, headers: JSON_H, body: JSON.stringify({ ok: false, log }) };
  }

  info(`Sending test recap to: ${to.join(', ')}`);
  info(`Subject: ${subject}`);

  // 4. Send via Resend
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html: recap.html, text: recap.text }),
    });
    const result: any = await res.json();
    if (!res.ok) {
      fail(`Resend error (${res.status}): ${result?.message || result?.name || JSON.stringify(result)}`);
      return {
        statusCode: res.status,
        headers: JSON_H,
        body: JSON.stringify({ ok: false, log, resendError: result }),
      };
    }
    info(`✅ Email sent! Resend id=${result.id} — check ${to.join(', ')}`);
    return {
      statusCode: 200,
      headers: JSON_H,
      body: JSON.stringify({
        ok: true,
        log,
        sentTo: to,
        resendId: result.id,
        stats: {
          workers: recap.data.activeWorkersToday,
          jobsDone: recap.data.completedToday.length,
          jobInsights: recap.data.jobInsights.length,
        },
      }),
    };
  } catch (e: any) {
    fail(`Fetch error: ${e?.message}`);
    return { statusCode: 500, headers: JSON_H, body: JSON.stringify({ ok: false, log }) };
  }
};
