// netlify/functions/test-recap.ts
// ═════════════════════════════════════════════════════════════════════
// Manual trigger endpoint for the daily recap email.
//
// Hit this URL from your browser to send a test recap RIGHT NOW:
//   https://your-site.netlify.app/.netlify/functions/test-recap
//   (or on Netlify alias: https://app.fabtrack.io/.netlify/functions/test-recap)
//
// Returns JSON with { ok, details } so you can see exactly what happened.
//
// Same env vars as daily-recap-cron:
//   VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID
//   RESEND_API_KEY, RESEND_FROM
// ═════════════════════════════════════════════════════════════════════

import type { Handler } from '@netlify/functions';
import type { Job, TimeLog, User, SystemSettings } from '../../types';
import { buildRecapData, buildRecapHtml, buildRecapText } from '../../utils/sendDailyRecap';

const JSON_H = { 'Content-Type': 'application/json' };

// ── Firestore REST helpers ─────────────────────────────────────────────

function fsVal(v: any): any {
  if (v == null) return null;
  if ('stringValue'    in v) return v.stringValue;
  if ('integerValue'   in v) return Number(v.integerValue);
  if ('doubleValue'    in v) return v.doubleValue;
  if ('booleanValue'   in v) return v.booleanValue;
  if ('nullValue'      in v) return null;
  if ('timestampValue' in v) return new Date(v.timestampValue).getTime();
  if ('arrayValue'     in v) return (v.arrayValue.values || []).map(fsVal);
  if ('mapValue'       in v) {
    const obj: any = {};
    for (const [k, vv] of Object.entries(v.mapValue.fields || {})) obj[k] = fsVal(vv as any);
    return obj;
  }
  return undefined;
}

function fsDoc(raw: any): any {
  const parts = (raw.name || '').split('/');
  const out: any = { id: parts[parts.length - 1] };
  for (const [k, v] of Object.entries(raw.fields || {})) out[k] = fsVal(v as any);
  return out;
}

async function fetchDoc(col: string, id: string, apiKey: string, projectId: string): Promise<any | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${col}/${id}?key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return fsDoc(await res.json());
}

async function fetchCollection(col: string, apiKey: string, projectId: string): Promise<any[]> {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${col}`;
  const docs: any[] = [];
  let pageToken: string | undefined;
  do {
    const url = `${base}?key=${apiKey}&pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url);
    const data: any = await res.json();
    if (!res.ok) break;
    (data.documents || []).forEach((d: any) => docs.push(fsDoc(d)));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return docs;
}

// ── Handler ────────────────────────────────────────────────────────────

export const handler: Handler = async (event) => {
  // Only allow GET (browser visit)
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: JSON_H, body: JSON.stringify({ error: 'GET only' }) };
  }

  const log: string[] = [];
  const warn = (msg: string) => { console.warn('[test-recap]', msg); log.push('⚠️  ' + msg); };
  const info = (msg: string) => { console.log('[test-recap]', msg);  log.push('✓  ' + msg); };
  const fail = (msg: string) => { console.error('[test-recap]', msg); log.push('✗  ' + msg); };

  // 1. Check env vars
  const apiKey    = process.env.VITE_FIREBASE_API_KEY;
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID || 'sc-job-tracker';
  const resendKey = process.env.RESEND_API_KEY;
  const from      = process.env.RESEND_FROM || 'FabTrack IO <noreply@scprecisiondeburring.com>';

  if (!apiKey) { fail('VITE_FIREBASE_API_KEY not set in Netlify env'); }
  else { info(`Firebase project: ${projectId}`); }

  if (!resendKey) { fail('RESEND_API_KEY not set in Netlify env'); }
  else { info('RESEND_API_KEY present'); }

  if (!apiKey || !resendKey) {
    return {
      statusCode: 500,
      headers: JSON_H,
      body: JSON.stringify({ ok: false, log, hint: 'Add missing env vars in Netlify → Site config → Environment variables' }),
    };
  }

  // 2. Load settings
  const settings = await fetchDoc('settings', 'system', apiKey, projectId) as SystemSettings | null;
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

  // 3. Load data
  const tz = (settings as any).recapTimezone || 'America/Los_Angeles';
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const now = new Date();
  const parts = dtf.formatToParts(now);
  const get = (t: string) => parseInt(parts.find((p: any) => p.type === t)?.value ?? '0', 10);
  const msFromMidnight = (get('hour') * 3600 + get('minute') * 60 + get('second')) * 1000 + now.getMilliseconds();
  const todayStart = now.getTime() - msFromMidnight;

  const [allJobs, logs, users, reworkDocs] = await Promise.all([
    fetchCollection('jobs',   apiKey, projectId) as Promise<Job[]>,
    fetchCollection('logs',   apiKey, projectId) as Promise<TimeLog[]>,
    fetchCollection('users',  apiKey, projectId) as Promise<User[]>,
    fetchCollection('rework', apiKey, projectId),
  ]);

  const openReworkCount = reworkDocs.filter((r: any) => r.status !== 'resolved').length;
  info(`Loaded ${allJobs.length} jobs, ${logs.length} logs, ${users.length} users, ${openReworkCount} open rework`);

  const shopName = settings.companyName || 'FabTrack IO';
  const ccEmails = (settings.recapEmailCC || '').split(',').map((e: string) => e.trim()).filter(Boolean);

  const data = buildRecapData({
    to: settings.recapEmail.trim(),
    ccEmails,
    logs,
    allJobs,
    users,
    shopName,
    shopRate: settings.shopRate,
    openReworkCount,
    todayStart,
  });

  const html = buildRecapHtml(data);
  const text = buildRecapText(data);

  const dateLabel = new Date(todayStart + 12 * 3_600_000).toLocaleDateString('en-US', {
    timeZone: tz, weekday: 'long', month: 'long', day: 'numeric',
  });
  const subject = `[TEST] ${shopName} — Daily Recap · ${dateLabel}`;
  const to = [settings.recapEmail.trim(), ...ccEmails];

  info(`Sending test recap to: ${to.join(', ')}`);
  info(`Subject: ${subject}`);

  // 4. Send via Resend
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html, text }),
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
          workers: data.activeWorkersToday,
          jobsDone: data.completedToday.length,
          jobInsights: data.jobInsights.length,
        },
      }),
    };
  } catch (e: any) {
    fail(`Fetch error: ${e?.message}`);
    return { statusCode: 500, headers: JSON_H, body: JSON.stringify({ ok: false, log }) };
  }
};
