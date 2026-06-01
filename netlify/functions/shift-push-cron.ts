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

// ── Firestore structured query — active logs only ────────────────────
// Much cheaper than fetching all logs: returns only status='in_progress' docs.
async function fetchActiveLogs(apiKey: string, projectId: string): Promise<any[]> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'logs' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'EQUAL',
          value: { stringValue: 'in_progress' },
        },
      },
    },
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const rows: any[] = await res.json();
    return rows.filter(r => r.document).map(r => fsDoc(r.document));
  } catch { return []; }
}

/** Format elapsed ms as "Xh Ym" or "Ym" */
function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Send one push, delete sub on 404/410. Returns true on success. */
async function sendPush(
  subDoc: any,
  payload: string,
  ttl: number,
  apiKey: string,
  projectId: string,
): Promise<'sent' | 'failed' | 'removed'> {
  const subscription = subDoc.subscription;
  if (!subscription?.endpoint) return 'failed';
  try {
    await webpush.sendNotification(subscription, payload, { TTL: ttl });
    return 'sent';
  } catch (e: any) {
    const code = e?.statusCode || 0;
    if (code === 404 || code === 410) {
      await deleteDoc('push_subscriptions', subDoc.id, apiKey, projectId).catch(() => {});
      return 'removed';
    }
    console.warn(`[shift-push-cron] Push failed for sub ${subDoc.id}: ${e?.message}`);
    return 'failed';
  }
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

  const tz       = (settings as any).recapTimezone || 'America/Los_Angeles';
  const shopName = settings.companyName || 'FabTrack IO';
  const nowHHMM  = currentHHMM(tz);

  // 2. Find alarms that should fire right now
  const alarms: ShiftAlarm[] = settings.shiftAlarms || [];
  const toFire = alarms.filter(a =>
    a.enabled &&
    a.sendPush &&
    isWithinWindow(a.time, nowHHMM) &&
    alarmActiveToday(a, tz),
  );

  // 3. Fetch active timer logs (only in_progress — cheap structured query)
  const activeLogs = await fetchActiveLogs(apiKey, projectId);

  // Nothing to push at all — bail early
  if (toFire.length === 0 && activeLogs.length === 0) {
    console.log(`[shift-push-cron] No alarms firing and no active timers at ${nowHHMM} — done`);
    return;
  }

  // 4. Load push subscriptions
  const subDocs = await fetchCollection('push_subscriptions', apiKey, projectId);
  if (subDocs.length === 0) {
    console.log('[shift-push-cron] No push subscriptions — nothing to send');
    return;
  }
  console.log(`[shift-push-cron] ${subDocs.length} subscription(s) | ${toFire.length} alarm(s) | ${activeLogs.length} active timer(s)`);

  // 5. Configure webpush
  webpush.setVapidDetails(vapidSub, vapidPub, vapidPriv);

  // 6. Shift alarm pushes — broadcast to ALL subscribed devices
  for (const alarm of toFire) {
    const isClockIn  = alarm.clockIn  || alarm.label.toLowerCase().includes('clock in') || alarm.label.toLowerCase().includes('shift start');
    const isClockOut = alarm.clockOut || alarm.label.toLowerCase().includes('clock out') || alarm.label.toLowerCase().includes('shift end');

    const title = isClockIn  ? `⏰ Time to Clock In — ${shopName}`
                : isClockOut ? `🏁 Shift Ending — ${shopName}`
                             : `🔔 ${alarm.label} — ${shopName}`;
    const body  = isClockIn  ? `Shift starts at ${alarm.time}. Open FabTrack IO and clock in.`
                : isClockOut ? `Time to wrap up and clock out for the day.`
                             : `${alarm.label} at ${alarm.time}.`;

    const payload = JSON.stringify({
      title, body,
      tag: `shift-alarm-${alarm.id}`,
      url: '/',
      requireInteraction: isClockIn,
    });

    let sent = 0, failed = 0, removed = 0;
    for (const subDoc of subDocs) {
      const r = await sendPush(subDoc, payload, 15 * 60, apiKey, projectId);
      if (r === 'sent') sent++;
      else if (r === 'removed') removed++;
      else failed++;
    }
    console.log(`[shift-push-cron] alarm "${alarm.label}" → sent:${sent} failed:${failed} removed:${removed}`);
  }

  // 7. Timer heartbeat — send live-timer push to each worker with an active log.
  //    Runs every 5 min regardless of alarms, so the background notification
  //    stays fresh (like Strava / iPhone timer in the notification tray).
  //    TTL = 4 min so a stale push never shows up after the next tick.
  if (activeLogs.length > 0) {
    // Fetch jobs for labels (only if there are active timers)
    const allJobs = await fetchCollection('jobs', apiKey, projectId);
    const jobMap = new Map(allJobs.map((j: any) => [j.id, j]));

    // Build userId → subscriptions map for fast lookup
    const subsByUser = new Map<string, any[]>();
    for (const sub of subDocs) {
      if (!sub.userId) continue;
      const arr = subsByUser.get(sub.userId) || [];
      arr.push(sub);
      subsByUser.set(sub.userId, arr);
    }

    const now = Date.now();
    let timerSent = 0;

    for (const log of activeLogs) {
      if (!log.userId || !log.jobId) continue;
      const userSubs = subsByUser.get(log.userId);
      if (!userSubs || userSubs.length === 0) continue;

      const job: any = jobMap.get(log.jobId);
      const jobLabel = job?.jobIdsDisplay || job?.partNumber || log.jobId;
      const isPaused = !!log.pausedAt;
      const elapsedMs = isPaused
        ? Math.max(0, (log.pausedAt - log.startTime) - (log.totalPausedMs || 0))
        : Math.max(0, (now - log.startTime) - (log.totalPausedMs || 0));

      const payload = JSON.stringify({
        title:  isPaused ? `⏸ Paused — ${fmtElapsed(elapsedMs)}` : `⏱ ${fmtElapsed(elapsedMs)} — Running`,
        body:   `${jobLabel} · ${log.operation || ''}`.trim(),
        tag:    `live-timer-${log.id}`,
        logId:  log.id,
        url:    '/',
        requireInteraction: false,
        actions: isPaused
          ? [{ action: 'resume', title: '▶ Resume' }, { action: 'stop', title: '⏹ Stop' }]
          : [{ action: 'pause',  title: '⏸ Pause'  }, { action: 'stop', title: '⏹ Stop' }],
      });

      for (const subDoc of userSubs) {
        const r = await sendPush(subDoc, payload, 4 * 60, apiKey, projectId);
        if (r === 'sent') timerSent++;
      }
    }

    console.log(`[shift-push-cron] timer heartbeat → ${timerSent} push(es) sent for ${activeLogs.length} active log(s)`);
  }
}
