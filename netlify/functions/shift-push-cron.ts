// netlify/functions/shift-push-cron.ts
// ═════════════════════════════════════════════════════════════════════
// Runs every 5 minutes. For every ShiftAlarm with sendPush:true that
// matches the current local shop time, blasts a Web Push notification
// to every subscribed worker device — works even when the browser is closed.
//
// Required Netlify env vars:
//   VITE_FIREBASE_API_KEY
//   VITE_FIREBASE_PROJECT_ID  (default: sc-job-tracker)
//   VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY
//   VAPID_SUBJECT             (default: mailto:hello@fabtrack.io)
// ═════════════════════════════════════════════════════════════════════

import type { Config } from '@netlify/functions';
import webpush from 'web-push';
import type { ShiftAlarm, SystemSettings } from '../../types';

export const config: Config = {
  schedule: '*/5 * * * *',   // every 5 minutes
};

// ── Firestore REST helpers ────────────────────────────────────────────

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

/** Delete a Firestore doc (used to remove stale/expired push subscriptions). */
async function deleteDoc(col: string, id: string, apiKey: string, projectId: string): Promise<void> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${col}/${id}?key=${apiKey}`;
  await fetch(url, { method: 'DELETE' });
}

// ── Time helpers ──────────────────────────────────────────────────────

/** Current hour:minute in a given IANA timezone, formatted as "HH:MM". */
function currentHHMM(tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date()).replace(/^24:/, '00:');
}

/** True if alarmTime (HH:MM) falls within a ±5-min window of now. */
function isWithinWindow(alarmTime: string, nowHHMM: string): boolean {
  const [ah, am] = alarmTime.split(':').map(Number);
  const [nh, nm] = nowHHMM.split(':').map(Number);
  const alarmTotalMins = ah * 60 + am;
  const nowTotalMins   = nh * 60 + nm;
  const diff = Math.abs(alarmTotalMins - nowTotalMins);
  // Wrap-around midnight
  const diffWrapped = Math.min(diff, 1440 - diff);
  return diffWrapped <= 4; // within 4 minutes (safe for 5-min cron with jitter)
}

/** Days of week this alarm should fire (empty = every day). */
function alarmActiveToday(alarm: ShiftAlarm, tz: string): boolean {
  if (!alarm.days || alarm.days.length === 0) return true;
  const dow = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())).getDay();
  // Intl en-CA gives YYYY-MM-DD which Date() parses as UTC midnight — may be off by 1 day.
  // Use a more direct approach:
  const dayNum = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date())
      .replace(/Sun.*/, '0').replace(/Mon.*/, '1').replace(/Tue.*/, '2')
      .replace(/Wed.*/, '3').replace(/Thu.*/, '4').replace(/Fri.*/, '5').replace(/Sat.*/, '6'),
    10,
  );
  return alarm.days.includes(isNaN(dayNum) ? dow : dayNum);
}

// ── Main handler ──────────────────────────────────────────────────────

export default async function handler() {
  const apiKey    = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || 'AIzaSyChOewBMJeW3oAM4KYn6ergrGIV9bPHTC8';
  const projectId = process.env.FIREBASE_PROJECT_ID || 'sc-job-tracker';
  const vapidPub  = process.env.VAPID_PUBLIC_KEY;
  const vapidPriv = process.env.VAPID_PRIVATE_KEY;
  const vapidSub  = process.env.VAPID_SUBJECT || 'mailto:hello@fabtrack.io';

  if (!apiKey || !vapidPub || !vapidPriv) {
    console.log('[shift-push-cron] Missing env vars — skipping');
    return;
  }

  // 1. Read shop settings
  const settings = await fetchDoc('settings', 'system', apiKey, projectId) as SystemSettings | null;
  if (!settings) { console.log('[shift-push-cron] No settings doc'); return; }

  const alarms: ShiftAlarm[] = settings.shiftAlarms || [];
  if (alarms.length === 0) { console.log('[shift-push-cron] No alarms configured'); return; }

  const tz      = (settings as any).recapTimezone || 'America/Los_Angeles';
  const shopName = settings.companyName || 'FabTrack IO';
  const nowHHMM = currentHHMM(tz);

  // 2. Find alarms that should fire right now
  const toFire = alarms.filter(a =>
    a.enabled &&
    a.sendPush &&
    isWithinWindow(a.time, nowHHMM) &&
    alarmActiveToday(a, tz),
  );

  if (toFire.length === 0) {
    console.log(`[shift-push-cron] No push alarms firing at ${nowHHMM} (${tz})`);
    return;
  }

  console.log(`[shift-push-cron] ${toFire.length} alarm(s) firing at ${nowHHMM}: ${toFire.map(a => a.label).join(', ')}`);

  // 3. Load all push subscriptions from Firestore
  // Subscriptions are stored under tenants/{tenantId}/push_subscriptions/
  // We fetch from the top-level collection path used by mockDb: push_subscriptions
  const subDocs = await fetchCollection('push_subscriptions', apiKey, projectId);
  if (subDocs.length === 0) {
    console.log('[shift-push-cron] No push subscriptions found');
    return;
  }
  console.log(`[shift-push-cron] Found ${subDocs.length} push subscription(s)`);

  // 4. Configure webpush
  webpush.setVapidDetails(vapidSub, vapidPub, vapidPriv);

  // 5. For each alarm × each subscription, send push
  for (const alarm of toFire) {
    const isClockIn  = alarm.clockIn  || alarm.label.toLowerCase().includes('clock in') || alarm.label.toLowerCase().includes('shift start');
    const isClockOut = alarm.clockOut || alarm.label.toLowerCase().includes('clock out') || alarm.label.toLowerCase().includes('shift end');

    const title = isClockIn
      ? `⏰ Time to Clock In — ${shopName}`
      : isClockOut
        ? `🏁 Shift Ending — ${shopName}`
        : `🔔 ${alarm.label} — ${shopName}`;

    const body = isClockIn
      ? `Shift starts at ${alarm.time}. Open FabTrack IO and clock in.`
      : isClockOut
        ? `Time to wrap up and clock out for the day.`
        : `${alarm.label} at ${alarm.time}.`;

    const payload = JSON.stringify({
      title,
      body,
      tag:  `shift-alarm-${alarm.id}`,
      url:  '/',
      requireInteraction: isClockIn, // clock-in reminder stays until dismissed
    });

    let sent = 0, failed = 0, removed = 0;

    for (const subDoc of subDocs) {
      const subscription = subDoc.subscription;
      if (!subscription?.endpoint) continue;

      try {
        await webpush.sendNotification(subscription, payload, { TTL: 15 * 60 }); // 15 min TTL
        sent++;
      } catch (e: any) {
        const code = e?.statusCode || 0;
        if (code === 404 || code === 410) {
          // Subscription expired — clean it up so we stop trying
          await deleteDoc('push_subscriptions', subDoc.id, apiKey, projectId).catch(() => {});
          removed++;
        } else {
          console.warn(`[shift-push-cron] Push failed for sub ${subDoc.id}: ${e?.message}`);
          failed++;
        }
      }
    }

    console.log(`[shift-push-cron] "${alarm.label}" → sent:${sent} failed:${failed} removed:${removed}`);
  }
}
