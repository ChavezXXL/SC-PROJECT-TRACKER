// netlify/functions/shift-push-cron.ts
// ═════════════════════════════════════════════════════════════════════
// Runs every 5 minutes. Handles four push scenarios:
//
//   1. Shift alarm pushes  — broadcast to ALL devices at alarm time
//   2. Live-timer heartbeat — per-worker elapsed-time push every 5 min
//   3. Missed clock-in      — remind worker 20 min after shift start;
//                             send admin a summary of who's missing
//   4. Long-timer admin alert — admin push when any timer exceeds 5 h
//
// Required Netlify env vars:
//   VITE_FIREBASE_API_KEY / FIREBASE_API_KEY
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

/** Write a document to push_meta (used to debounce daily alerts). */
async function setMetaDoc(
  id: string,
  data: Record<string, string | number | boolean>,
  apiKey: string,
  projectId: string,
): Promise<void> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/push_meta/${id}?key=${apiKey}`;
  const fields: any = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string')  fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = { integerValue: String(Math.round(v)) };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
  }
  await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  }).catch(() => {});
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

/** "YYYY-MM-DD" in the given timezone — used as daily dedup key. */
function todayStr(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

/** True if alarmTime (HH:MM) falls within a ±4-min window of now. */
function isWithinWindow(alarmTime: string, nowHHMM: string): boolean {
  const [ah, am] = alarmTime.split(':').map(Number);
  const [nh, nm] = nowHHMM.split(':').map(Number);
  const alarmTotal = ah * 60 + am;
  const nowTotal   = nh * 60 + nm;
  const diff = Math.abs(alarmTotal - nowTotal);
  return Math.min(diff, 1440 - diff) <= 4;
}

/**
 * True if now is between graceMinutes and 120 minutes AFTER alarmTime.
 * Used to find shift-start alarms where the grace period has elapsed.
 */
function isAfterGracePeriod(alarmTime: string, nowHHMM: string, graceMinutes: number): boolean {
  const [ah, am] = alarmTime.split(':').map(Number);
  const [nh, nm] = nowHHMM.split(':').map(Number);
  const alarmTotal = ah * 60 + am;
  const nowTotal   = nh * 60 + nm;
  let diff = nowTotal - alarmTotal;
  if (diff < -720) diff += 1440; // wrap past midnight
  return diff >= graceMinutes && diff < 120;
}

/** Days of week this alarm should fire (empty = every day). */
function alarmActiveToday(alarm: ShiftAlarm, tz: string): boolean {
  if (!alarm.days || alarm.days.length === 0) return true;
  const dow = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date())
      .replace(/Sun.*/, '0').replace(/Mon.*/, '1').replace(/Tue.*/, '2')
      .replace(/Wed.*/, '3').replace(/Thu.*/, '4').replace(/Fri.*/, '5').replace(/Sat.*/, '6'),
    10,
  );
  return alarm.days.includes(isNaN(dow) ? new Date().getDay() : dow);
}

// ── Firestore structured query — active logs + recent notes ──────────
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

/** Fetch notes with timestamp > sinceMs (for new-note push alerts). */
async function fetchRecentNotes(sinceMs: number, apiKey: string, projectId: string): Promise<any[]> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'notes' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'timestamp' },
          op: 'GREATER_THAN',
          value: { integerValue: String(Math.round(sinceMs)) },
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

/** Send one push, delete sub on 404/410. Returns 'sent' | 'failed' | 'removed'. */
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
  const today    = todayStr(tz);

  // 2. Find alarms that should fire right now
  const alarms: ShiftAlarm[] = settings.shiftAlarms || [];
  const toFire = alarms.filter(a =>
    a.enabled &&
    a.sendPush &&
    isWithinWindow(a.time, nowHHMM) &&
    alarmActiveToday(a, tz),
  );

  // 3. Clock-in alarms past grace period (20 min after shift start)
  const clockInAlarmsForCheck = alarms.filter(a =>
    a.enabled &&
    (a.clockIn || a.label.toLowerCase().includes('clock in') || a.label.toLowerCase().includes('shift start')) &&
    alarmActiveToday(a, tz) &&
    isAfterGracePeriod(a.time, nowHHMM, 20),
  );

  // 4. Fetch active timer logs (in_progress only)
  const activeLogs = await fetchActiveLogs(apiKey, projectId);

  // Nothing to push at all — bail early
  if (toFire.length === 0 && activeLogs.length === 0 && clockInAlarmsForCheck.length === 0) {
    console.log(`[shift-push-cron] Nothing to do at ${nowHHMM} — done`);
    return;
  }

  // 5. Load push subscriptions
  const subDocs = await fetchCollection('push_subscriptions', apiKey, projectId);
  if (subDocs.length === 0) {
    console.log('[shift-push-cron] No push subscriptions — nothing to send');
    return;
  }

  // Build userId → subscriptions map (used across all sections)
  const subsByUser = new Map<string, any[]>();
  for (const sub of subDocs) {
    if (!sub.userId) continue;
    const arr = subsByUser.get(sub.userId) || [];
    arr.push(sub);
    subsByUser.set(sub.userId, arr);
  }

  console.log(`[shift-push-cron] ${subDocs.length} sub(s) | ${toFire.length} alarm(s) | ${activeLogs.length} active timer(s) | ${clockInAlarmsForCheck.length} clock-in check(s)`);

  // 6. Configure webpush
  webpush.setVapidDetails(vapidSub, vapidPub, vapidPriv);

  // ── Section A: Shift alarm pushes — broadcast to ALL subscribed devices ──
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

  const now = Date.now();
  // Jobs loaded once, reused by Sections F (over-estimate).
  let allJobs: any[] = [];
  let jobMap = new Map<string, any>();
  if (activeLogs.length > 0) {
    allJobs = await fetchCollection('jobs', apiKey, projectId);
    jobMap  = new Map(allJobs.map((j: any) => [j.id, j]));
  }

  // ── Section C: Missed clock-in — remind worker every 30 min, admin summary ──
  // Fires up to 6 times (≈ 3 hours) until the worker starts a timer.
  if (clockInAlarmsForCheck.length > 0) {
    const allUsers = await fetchCollection('users', apiKey, projectId);
    const employees = allUsers.filter((u: any) =>
      u.role === 'employee' || u.role === 'worker' || (!u.role && u.id),
    );
    const admins = allUsers.filter((u: any) =>
      u.role === 'admin' || u.role === 'manager' || u.role === 'owner',
    );

    const activeUserIds = new Set(activeLogs.map(l => l.userId));

    for (const alarm of clockInAlarmsForCheck) {
      const metaId = `late-clockin-${alarm.id}-${today}`;
      const meta = await fetchDoc('push_meta', metaId, apiKey, projectId);
      const lastSentAt: number = meta?.lastSentAt || 0;
      const sentCount: number  = meta?.sentCount  || 0;

      if (sentCount >= 6) continue; // max 6 reminders over ~3 hours, then give up
      if (sentCount > 0 && (now - lastSentAt) < 30 * 60 * 1000) continue; // wait 30 min between

      const notClockedIn = employees.filter((u: any) => !activeUserIds.has(u.id));

      // Write meta first (prevents double-send if cron overlaps)
      await setMetaDoc(metaId, { lastSentAt: now, sentCount: sentCount + 1 }, apiKey, projectId);

      if (notClockedIn.length === 0) {
        console.log(`[shift-push-cron] clock-in check "${alarm.label}" — all workers clocked in ✓`);
        continue;
      }

      console.log(`[shift-push-cron] clock-in check "${alarm.label}" — ${notClockedIn.length} missing (reminder #${sentCount + 1})`);

      // Remind each missing worker
      for (const worker of notClockedIn) {
        const workerSubs = subsByUser.get(worker.id) || [];
        if (workerSubs.length === 0) continue;
        const payload = JSON.stringify({
          title: `⏰ Don't Forget to Clock In`,
          body:  `Your shift started at ${alarm.time}. Open FabTrack IO and start your timer.`,
          tag:   `clockin-reminder-${worker.id}`,
          url:   '/',
          requireInteraction: true,
        });
        for (const subDoc of workerSubs) {
          await sendPush(subDoc, payload, 30 * 60, apiKey, projectId);
        }
        console.log(`[shift-push-cron] reminded worker ${worker.name || worker.id} (reminder #${sentCount + 1})`);
      }

      // Admin summary push
      if (admins.length > 0) {
        const names = notClockedIn
          .map((u: any) => (u.name || u.email || u.id).split(' ')[0])
          .join(', ');
        const adminPayload = JSON.stringify({
          title: `⚠️ ${notClockedIn.length} Worker${notClockedIn.length > 1 ? 's' : ''} Haven't Clocked In`,
          body:  `${names} ${notClockedIn.length > 1 ? 'have' : 'has'} not started a timer. Shift was ${alarm.time}.`,
          tag:   `admin-late-clockin-${alarm.id}`,
          url:   '/',
          requireInteraction: true,
        });
        for (const admin of admins) {
          const adminSubs = subsByUser.get(admin.id) || [];
          for (const subDoc of adminSubs) {
            await sendPush(subDoc, adminPayload, 30 * 60, apiKey, projectId);
          }
        }
        console.log(`[shift-push-cron] admin notified: ${notClockedIn.length} missing (reminder #${sentCount + 1})`);
      }

      // ── Escalation email after 3rd reminder (≈ 90 min late) ──────────
      // Pushes can be missed (phone off, notifications blocked). Email is a
      // harder-to-ignore fallback that lands in the owner's inbox directly.
      if (sentCount + 1 >= 3 && notClockedIn.length > 0) {
        const resendKey  = process.env.RESEND_API_KEY;
        const resendFrom = process.env.RESEND_FROM || 'FabTrack IO <noreply@scprecisiondeburring.com>';
        const toEmail    = (settings as any)?.recapEmail || (settings as any)?.alertEmail || (settings as any)?.companyEmail;

        if (resendKey && toEmail) {
          const nameList = notClockedIn.map((u: any) => u.name || u.id).join(', ');
          const minutesLate = Math.round((now - (alarm as any).__alarmTs) / 60000) || 90;
          const emailBody = `
            <div style="font-family:sans-serif;background:#09090b;color:#fff;padding:32px;border-radius:12px;max-width:480px;">
              <h2 style="color:#f87171;margin:0 0 8px;">🚨 Workers Still Not Clocked In</h2>
              <p style="color:#a1a1aa;margin:0 0 16px;">Shift started at <strong style="color:#fff;">${alarm.time}</strong> — approximately ${minutesLate} minutes ago.</p>
              <div style="background:#1c1c1e;border-left:4px solid #f87171;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:20px;">
                <p style="margin:0;font-size:18px;font-weight:800;color:#f87171;">${notClockedIn.length} worker${notClockedIn.length > 1 ? 's' : ''} missing</p>
                <p style="margin:4px 0 0;color:#e4e4e7;">${nameList}</p>
              </div>
              <p style="color:#71717a;font-size:13px;margin:0;">This is reminder #${sentCount + 1}. They have been notified ${sentCount + 1} time${sentCount + 1 > 1 ? 's' : ''} via push.</p>
              <p style="color:#52525b;font-size:12px;margin:12px 0 0;">— FabTrack IO</p>
            </div>`;

          try {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: resendFrom,
                to: [toEmail],
                subject: `🚨 ${notClockedIn.length} Worker${notClockedIn.length > 1 ? 's' : ''} Still Not Clocked In — ${alarm.time} Shift`,
                html: emailBody,
              }),
            });
            console.log(`[shift-push-cron] escalation email sent to ${toEmail} (${notClockedIn.length} missing)`);
          } catch (e: any) {
            console.warn('[shift-push-cron] escalation email failed:', e?.message);
          }
        }
      }
    }
  }

  // ── Section D: Admin alert — long-running timers (> 5 hours) ──
  const LONG_TIMER_MS = 5 * 60 * 60 * 1000;
  const longRunning = activeLogs.filter(log => {
    if (log.pausedAt) return false; // ignore paused timers
    const elapsed = now - log.startTime - (log.totalPausedMs || 0);
    return elapsed >= LONG_TIMER_MS;
  });

  if (longRunning.length > 0) {
    // Lazy-load admins (may already have allUsers from section C — refetch is cheap since it's cached by Firestore)
    const allUsersForAdmin = await fetchCollection('users', apiKey, projectId);
    const admins = allUsersForAdmin.filter((u: any) =>
      u.role === 'admin' || u.role === 'manager' || u.role === 'owner',
    );

    const allJobs = activeLogs.length > 0
      ? await fetchCollection('jobs', apiKey, projectId)
      : [];
    const jobMap = new Map(allJobs.map((j: any) => [j.id, j]));

    for (const log of longRunning) {
      const metaId = `long-timer-${log.id}-${today}`;
      const alreadySent = await fetchDoc('push_meta', metaId, apiKey, projectId);
      if (alreadySent) continue;

      const elapsed = now - log.startTime - (log.totalPausedMs || 0);
      const job: any = jobMap.get(log.jobId);
      const jobLabel = job?.jobIdsDisplay || job?.partNumber || log.jobId;

      await setMetaDoc(metaId, { sentAt: now }, apiKey, projectId);

      const adminPayload = JSON.stringify({
        title: `⏱ Long Timer — ${fmtElapsed(elapsed)}`,
        body:  `${log.userName || 'A worker'} has been running on ${jobLabel} for ${fmtElapsed(elapsed)}. Might need attention.`,
        tag:   `admin-long-timer-${log.id}`,
        url:   '/',
        requireInteraction: true,
      });

      for (const admin of admins) {
        const adminSubs = subsByUser.get(admin.id) || [];
        for (const subDoc of adminSubs) {
          await sendPush(subDoc, adminPayload, 60 * 60, apiKey, projectId);
        }
      }
      console.log(`[shift-push-cron] admin alerted: long timer for ${log.userName || log.id} (${fmtElapsed(elapsed)})`);
    }
  }

  // ── Section F: Over-estimate alert — active session exceeds operation estimate ──
  // Fires once per active log session (deduped). Compares elapsed time to
  // job.checklist[operation].estimatedMinutes × rateBuffer (default 1.15).
  // Both admin AND the worker get a push — admin to act, worker as a heads-up.
  if (activeLogs.length > 0) {
    const rateBuffer: number = (settings as any).rateBuffer ?? 1.15;

    const estAdmins = await fetchCollection('users', apiKey, projectId)
      .then(users => users.filter((u: any) =>
        u.role === 'admin' || u.role === 'manager' || u.role === 'owner',
      ));

    for (const log of activeLogs) {
      if (log.pausedAt) continue; // skip paused timers

      const job = jobMap.get(log.jobId) as any;
      if (!job) continue;

      // Match log.operation to a checklist item with an estimatedMinutes
      const checklist: any[] = job.checklist || [];
      const item = checklist.find((c: any) =>
        (c.label ?? '').toLowerCase().trim() === (log.operation ?? '').toLowerCase().trim(),
      );
      if (!item?.estimatedMinutes) continue;

      const elapsed  = now - log.startTime - (log.totalPausedMs || 0);
      const budgetMs = item.estimatedMinutes * rateBuffer * 60_000;
      if (elapsed <= budgetMs) continue; // still within estimate

      // Dedup — only fire once per active session
      const metaId = `over-est-${log.id}`;
      const alreadySent = await fetchDoc('push_meta', metaId, apiKey, projectId);
      if (alreadySent) continue;
      await setMetaDoc(metaId, { sentAt: now }, apiKey, projectId);

      const jobLabel = job.jobIdsDisplay || job.partNumber || log.jobId;
      const overBy   = fmtElapsed(elapsed - budgetMs);
      const estLabel = `${item.estimatedMinutes}min`;

      // Admin push
      const adminPayload = JSON.stringify({
        title: `🚨 Over Estimate — ${log.operation}`,
        body:  `${log.userName || 'A worker'} on ${jobLabel} is ${overBy} past the ${estLabel} estimate for ${log.operation}.`,
        tag:   `admin-over-est-${log.id}`,
        url:   '/',
        requireInteraction: true,
      });
      for (const admin of estAdmins) {
        const adminSubs = subsByUser.get(admin.id) || [];
        for (const subDoc of adminSubs) {
          await sendPush(subDoc, adminPayload, 60 * 60, apiKey, projectId);
        }
      }

      // Worker push (gentler — give them a heads-up, not a reprimand)
      const workerSubs = subsByUser.get(log.userId) || [];
      if (workerSubs.length > 0) {
        const workerPayload = JSON.stringify({
          title: `⏱ Time Check — ${log.operation}`,
          body:  `You're ${overBy} past the estimated time on ${jobLabel}. Give your supervisor a heads up.`,
          tag:   `worker-over-est-${log.id}`,
          url:   '/',
          requireInteraction: false,
        });
        for (const subDoc of workerSubs) {
          await sendPush(subDoc, workerPayload, 60 * 60, apiKey, projectId);
        }
      }

      console.log(`[shift-push-cron] over-estimate: ${log.userName} on ${jobLabel}/${log.operation} (${fmtElapsed(elapsed)} vs ${estLabel})`);
    }
  }

  // ── Section E: New job notes → admin + workers on that job ──
  // Every 5 min, check for notes posted in the last 6 min. Dedup per note ID.
  // Notifies: admins always + any worker currently active on the same job.
  // Never notifies the person who wrote the note (they already know).
  const NOTES_WINDOW_MS = 6 * 60 * 1000;
  const recentNotes = await fetchRecentNotes(now - NOTES_WINDOW_MS, apiKey, projectId);

  if (recentNotes.length > 0) {
    const noteAllUsers = await fetchCollection('users', apiKey, projectId);
    const noteAdmins   = noteAllUsers.filter((u: any) =>
      u.role === 'admin' || u.role === 'manager' || u.role === 'owner',
    );

    for (const note of recentNotes) {
      // Dedup — only notify once per note
      const noteMeta = `note-notified-${note.id}`;
      const alreadyNotified = await fetchDoc('push_meta', noteMeta, apiKey, projectId);
      if (alreadyNotified) continue;
      await setMetaDoc(noteMeta, { sentAt: now }, apiKey, projectId);

      const preview = (note.text || '').length > 80
        ? (note.text as string).slice(0, 77) + '…'
        : note.text || '';

      const notePayload = JSON.stringify({
        title: `📝 ${note.userName || 'Someone'} left a note`,
        body:  `${note.jobLabel || note.jobId}: "${preview}"`,
        tag:   `job-note-${note.id}`,
        url:   '/',
        requireInteraction: false,
      });

      // Collect everyone to notify — admins + workers active on this job
      // Exclude the note author so they don't get pinged for their own message
      const authorId = String(note.userId || '');
      const recipientIds = new Set<string>();

      // Admins
      for (const admin of noteAdmins) {
        if (String(admin.id) !== authorId) recipientIds.add(String(admin.id));
      }

      // Workers currently clocked into this job
      for (const log of activeLogs) {
        if (log.jobId === note.jobId && String(log.userId) !== authorId) {
          recipientIds.add(String(log.userId));
        }
      }

      let notified = 0;
      for (const uid of recipientIds) {
        const subs = subsByUser.get(uid) || [];
        for (const subDoc of subs) {
          const r = await sendPush(subDoc, notePayload, 60 * 60, apiKey, projectId);
          if (r === 'sent') notified++;
        }
      }

      console.log(`[shift-push-cron] note on ${note.jobLabel || note.jobId} by ${note.userName} → ${notified} notified (${recipientIds.size} recipient(s))`);
    }
  }
}
