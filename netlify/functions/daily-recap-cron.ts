// netlify/functions/daily-recap-cron.ts
// ═════════════════════════════════════════════════════════════════════
// Netlify scheduled function — fires every hour and sends the daily
// shop recap email when the current local time matches the shop's
// configured send time (settings.recapTime).
//
// Uses Firestore REST API (no Admin SDK / service account needed).
// Reads data via VITE_FIREBASE_API_KEY which is already in Netlify env.
//
// Required Netlify env vars (already set):
//   VITE_FIREBASE_API_KEY  — Firebase web API key
//   VITE_FIREBASE_PROJECT_ID — Firebase project ID
//   RESEND_API_KEY         — from resend.com
//   RESEND_FROM            — verified sender address
// ═════════════════════════════════════════════════════════════════════

import type { Config } from '@netlify/functions';
import type { Job, TimeLog, User, SystemSettings } from '../../types';
import { buildRecapData, buildRecapHtml, buildRecapText } from '../../utils/sendDailyRecap';

export const config: Config = {
  schedule: '0 * * * *',
};

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
    for (const [k, vv] of Object.entries(v.mapValue.fields || {})) obj[k] = fsVal(vv);
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

async function fetchCollection(col: string, apiKey: string, projectId: string): Promise<any[]> {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${col}`;
  const docs: any[] = [];
  let pageToken: string | undefined;
  do {
    const url = `${base}?key=${apiKey}&pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url);
    const data: any = await res.json();
    if (!res.ok) { console.error(`[cron] Firestore fetch ${col} error:`, data?.error?.message); break; }
    (data.documents || []).forEach((d: any) => docs.push(fsDoc(d)));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return docs;
}

async function fetchDoc(col: string, id: string, apiKey: string, projectId: string): Promise<any | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${col}/${id}?key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return fsDoc(await res.json());
}

/** Patch a single string field on an existing Firestore document. */
async function patchStringField(col: string, id: string, field: string, value: string, apiKey: string, projectId: string): Promise<void> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${col}/${id}?updateMask.fieldPaths=${field}&key=${apiKey}`;
  await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { [field]: { stringValue: value } } }),
  });
}

// ── Timezone helpers ─────────────────────────────────────────────────

function getTodayBoundsForTz(tz: string): { start: number; end: number } {
  const now = new Date();
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const parts = dtf.formatToParts(now);
  const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? '0', 10);
  const msFromMidnight = (get('hour') * 3600 + get('minute') * 60 + get('second')) * 1000 + now.getMilliseconds();
  const start = now.getTime() - msFromMidnight;
  return { start, end: start + 86_400_000 - 1 };
}

function currentHourInTz(tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false });
  const h = parseInt(dtf.format(new Date()), 10);
  // Intl can return 24 for midnight in some runtimes — normalise to 0
  return h === 24 ? 0 : h;
}

// ── Main handler ─────────────────────────────────────────────────────

export default async function handler() {
  console.log('[daily-recap-cron] tick', new Date().toISOString());

  const apiKey    = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || 'AIzaSyChOewBMJeW3oAM4KYn6ergrGIV9bPHTC8';
  const projectId = process.env.FIREBASE_PROJECT_ID || 'sc-job-tracker';

  if (!apiKey) {
    console.error('[daily-recap-cron] VITE_FIREBASE_API_KEY not set');
    return;
  }

  // 1. Read settings
  const settings = await fetchDoc('settings', 'system', apiKey, projectId) as SystemSettings | null;
  if (!settings) { console.log('[daily-recap-cron] No settings doc — skipping'); return; }

  // 2. Guards
  if (!settings.recapEmailEnabled)  { console.log('[daily-recap-cron] recapEmailEnabled=false'); return; }
  if (!settings.recapEmail?.trim()) { console.log('[daily-recap-cron] No recapEmail set'); return; }
  if (!settings.recapTime)          { console.log('[daily-recap-cron] No recapTime set'); return; }

  // 3. Time check + sent-today guard (prevents double-send on Netlify retry)
  const tz = (settings as any).recapTimezone || 'America/Los_Angeles';
  const nowHour = currentHourInTz(tz);
  const configHour = parseInt(settings.recapTime.split(':')[0], 10);

  if (nowHour !== configHour) {
    console.log(`[daily-recap-cron] Not time yet (now=${nowHour}h, configured=${configHour}h ${tz})`);
    return;
  }

  // Guard: only send once per calendar day (idempotent against retries / jitter)
  const todayDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()); // YYYY-MM-DD
  if ((settings as any).recapLastSentDate === todayDateStr) {
    console.log(`[daily-recap-cron] Already sent today (${todayDateStr}) — skipping`);
    return;
  }

  console.log(`[daily-recap-cron] Recap time matched (${settings.recapTime} ${tz}) — fetching data…`);

  // 4. Fetch all data in parallel
  const [allJobs, logs, users, reworkDocs] = await Promise.all([
    fetchCollection('jobs',   apiKey, projectId) as Promise<Job[]>,
    fetchCollection('logs',   apiKey, projectId) as Promise<TimeLog[]>,
    fetchCollection('users',  apiKey, projectId) as Promise<User[]>,
    fetchCollection('rework', apiKey, projectId),
  ]);

  const openReworkCount = reworkDocs.filter(r => r.status !== 'resolved').length;

  console.log(`[daily-recap-cron] Loaded ${allJobs.length} jobs, ${logs.length} logs, ${users.length} users, ${openReworkCount} open rework`);

  // 5. Build recap with timezone-correct today bounds
  const { start: todayStart } = getTodayBoundsForTz(tz);
  const shopName = settings.companyName || 'FabTrack IO';
  const ccEmails = (settings.recapEmailCC || '').split(',').map(e => e.trim()).filter(Boolean);

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

  // Use noon (12h) instead of 1am so DST boundary shifts never flip the date
  const dateStr = new Date(todayStart + 12 * 3_600_000).toLocaleDateString('en-US', {
    timeZone: tz, weekday: 'long', month: 'long', day: 'numeric',
  });
  const subject = `${shopName} — Daily Recap · ${dateStr}`;

  // 6. Send via Resend
  const resendKey = process.env.RESEND_API_KEY;
  const from      = process.env.RESEND_FROM || 'FabTrack IO <noreply@scprecisiondeburring.com>';

  if (!resendKey) { console.error('[daily-recap-cron] RESEND_API_KEY not set'); return; }

  const to = [settings.recapEmail.trim(), ...ccEmails];
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html, text }),
    });
    const result: any = await res.json();
    if (!res.ok) {
      console.error('[daily-recap-cron] Resend error:', result);
    } else {
      console.log(`[daily-recap-cron] ✓ Sent (id=${result.id}) to: ${to.join(', ')}`);
      // Stamp today's date so retries/jitter won't send a second email
      await patchStringField('settings', 'system', 'recapLastSentDate', todayDateStr, apiKey, projectId);
    }
  } catch (e: any) {
    console.error('[daily-recap-cron] Resend fetch failed:', e.message);
  }
}
