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
import { shopLocalTimeMs, shopDayOfWeek } from '../../utils/timezone';

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
    if (!res.ok) {
      // Mid-pagination failure: log loudly so a silently-truncated collection
      // (e.g. alarms reaching only half the devices) is visible in the logs.
      console.error(`[shift-push-cron] fetchCollection ${col} page failed: ${res.status} (loaded ${docs.length} doc(s) so far)`);
      break;
    }
    const data: any = await res.json();
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

/**
 * Atomically create a push_meta doc ONLY if it doesn't already exist, via
 * Firestore's `currentDocument.exists=false` precondition. Returns true when
 * this call created the doc (we "won" and own the send); false when another
 * overlapping cron run already created it — or on a network error, which
 * safely skips the send (the next 5-min tick retries).
 */
async function setMetaDocIfNotExists(
  id: string,
  data: Record<string, string | number | boolean>,
  apiKey: string,
  projectId: string,
): Promise<boolean> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/push_meta/${id}?key=${apiKey}&currentDocument.exists=false`;
  const fields: any = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string')  fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = { integerValue: String(Math.round(v)) };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
  }
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    return res.ok;
  } catch { return false; }
}

/** Delete a Firestore doc (used to remove stale/expired push subscriptions). */
async function deleteDoc(col: string, id: string, apiKey: string, projectId: string): Promise<void> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${col}/${id}?key=${apiKey}`;
  await fetch(url, { method: 'DELETE' });
}

/**
 * Update specific fields on a Firestore doc, leaving all others intact.
 * Uses updateMask so this is a true partial update (never clobbers the rest
 * of the log document). Values: string | number | boolean | null.
 */
async function patchDoc(
  col: string,
  id: string,
  data: Record<string, string | number | boolean | null>,
  apiKey: string,
  projectId: string,
): Promise<boolean> {
  const fields: any = {};
  const maskParams: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === null) fields[k] = { nullValue: null };
    else if (typeof v === 'string')  fields[k] = { stringValue: v };
    else if (typeof v === 'number')  fields[k] = { integerValue: String(Math.round(v)) };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    maskParams.push(`updateMask.fieldPaths=${encodeURIComponent(k)}`);
  }
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${col}/${id}?key=${apiKey}&${maskParams.join('&')}`;
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    return res.ok;
  } catch { return false; }
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

// Shop-timezone cutoff math lives in utils/timezone.ts (shared with the client
// sweep so both compute the identical wall-clock cutoff). Imported above.

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

/**
 * Every open timer — status in {in_progress, paused}. Used by the auto
 * clock-out sweep, which must close paused timers too (a worker who paused
 * and went home should still be clocked out at the cutoff).
 */
async function fetchOpenLogs(apiKey: string, projectId: string): Promise<any[]> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'logs' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'IN',
          value: { arrayValue: { values: [{ stringValue: 'in_progress' }, { stringValue: 'paused' }] } },
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
    // Defensive: never touch a log that already has an endTime.
    return rows.filter(r => r.document).map(r => fsDoc(r.document)).filter((l: any) => !l.endTime);
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

/**
 * Completed logs that ENDED on/after sinceMs (shop-day start). Used by the
 * idle-gap nudge to find workers who finished a job earlier today and haven't
 * started another. Single-field range query on endTime.
 */
async function fetchCompletedLogsSince(sinceMs: number, apiKey: string, projectId: string): Promise<any[]> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'logs' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'endTime' },
          op: 'GREATER_THAN_OR_EQUAL',
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
    return rows.filter(r => r.document).map(r => fsDoc(r.document))
      .filter((l: any) => typeof l.endTime === 'number' && l.endTime > 0);
  } catch { return []; }
}

/** Format elapsed ms as "Xh Ym" or "Ym" */
function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Send one push. Deletes the sub on 404/410 (device gone); retries transient
 * failures (5xx / 429) with a short backoff so a push-service hiccup doesn't
 * silently drop a time-sensitive alarm. Returns 'sent' | 'failed' | 'removed'.
 */
async function sendPush(
  subDoc: any,
  payload: string,
  ttl: number,
  apiKey: string,
  projectId: string,
): Promise<'sent' | 'failed' | 'removed'> {
  const subscription = subDoc.subscription;
  if (!subscription?.endpoint) return 'failed';
  const MAX_RETRIES = 2; // backoff: 1s then 2s
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await webpush.sendNotification(subscription, payload, { TTL: ttl });
      return 'sent';
    } catch (e: any) {
      const code = e?.statusCode || 0;
      if (code === 404 || code === 410) {
        await deleteDoc('push_subscriptions', subDoc.id, apiKey, projectId).catch(() => {});
        return 'removed';
      }
      // Transient push-service error — back off and retry.
      if (attempt < MAX_RETRIES && (code >= 500 || code === 429)) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        continue;
      }
      console.warn(`[shift-push-cron] Push failed for sub ${subDoc.id} (${code || 'no status'}): ${e?.message}`);
      return 'failed';
    }
  }
  return 'failed';
}

// ── Main handler ──────────────────────────────────────────────────────

export default async function handler() {
  const apiKey    = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || 'AIzaSyChOewBMJeW3oAM4KYn6ergrGIV9bPHTC8';
  const projectId = process.env.FIREBASE_PROJECT_ID || 'sc-job-tracker';
  const vapidPub  = process.env.VAPID_PUBLIC_KEY;
  const vapidPriv = process.env.VAPID_PRIVATE_KEY;
  const vapidSub  = process.env.VAPID_SUBJECT || 'mailto:hello@fabtrack.io';

  // Auto-clock-out only needs Firestore (apiKey). Push needs VAPID too — but
  // VAPID is gated separately LOWER DOWN so a shop that never set up push still
  // gets reliable auto-clock-out. (apiKey has a hardcoded fallback above, so
  // this guard effectively never trips; kept for completeness.)
  if (!apiKey) {
    console.log('[shift-push-cron] Missing Firebase API key — skipping');
    return;
  }

  // ── Heartbeat FIRST — before settings read and every early return — so the
  // Timekeeping Health brain can prove this 24/7 engine is alive. If this stops
  // updating, the dashboard surfaces "auto clock-out engine is down".
  await setMetaDoc('cron-heartbeat', { lastRunMs: Date.now() }, apiKey, projectId).catch(() => {});

  // 1. Read shop settings
  const settings = await fetchDoc('settings', 'system', apiKey, projectId) as SystemSettings | null;
  if (!settings) { console.log('[shift-push-cron] No settings doc'); return; }

  const tz       = (settings as any).recapTimezone || 'America/Los_Angeles';
  const shopName = settings.companyName || 'FabTrack IO';
  const nowHHMM  = currentHHMM(tz);
  const today    = todayStr(tz);

  // ── Section 0: AUTO CLOCK-OUT (server-side — the reliable path) ────────
  // The client sweep (sweepStaleLogs) only runs while a browser tab is open.
  // When the shop closes and everyone shuts the app, nothing clocks workers
  // out — they stay "running" until someone reopens the app or the 14h safety
  // net trips the next day. THAT is the "not clocking out at the time I set"
  // bug. This runs every 5 min regardless of any open tab, so timers end at
  // the configured cutoff for real. Field-for-field identical to stopTimeLog.
  try {
    const cutoffs: { h: number; m: number }[] = [];
    if (settings.autoClockOutEnabled) {
      const mm = (settings.autoClockOutTime || '17:30').match(/^(\d{1,2}):(\d{2})$/);
      if (mm) cutoffs.push({ h: +mm[1], m: +mm[2] });
    }
    // Any "Shift Ends" style alarm flagged as a clock-out alarm also counts —
    // matches the client sweep so the user only configures one place.
    // alarmActiveToday gates the alarm's days[] so a Mon–Fri clock-out alarm
    // does NOT force a clock-out on a Saturday overtime shift.
    // Alarm-driven cutoffs only count when the master Break & Shift Alarms
    // switch is on. (The dedicated autoClockOutEnabled path above is independent.)
    if (settings.shiftAlarmsEnabled !== false) {
      for (const a of (settings.shiftAlarms || []) as any[]) {
        if (!a?.clockOut || a.enabled === false || !alarmActiveToday(a, tz)) continue;
        const mm = (a.time || '').match(/^(\d{1,2}):(\d{2})$/);
        if (mm) cutoffs.push({ h: +mm[1], m: +mm[2] });
      }
    }

    const SAFETY_MS = 14 * 3600 * 1000;
    const nowMs = Date.now();
    const openLogs = await fetchOpenLogs(apiKey, projectId);

    let stopped = 0;
    for (const log of openLogs) {
      // Corrupt log with no usable startTime — force-close it so it can't live
      // forever (the safety-net check below would NaN-skip it otherwise).
      if (typeof log.startTime !== 'number' || !log.startTime) {
        const ok0 = await patchDoc('logs', log.id, {
          endTime: nowMs, durationMinutes: 0, durationSeconds: 0, status: 'completed',
          updatedAt: nowMs, pausedAt: null, stopReason: 'sweep:corrupt-no-starttime',
          isAutoClosed: true, durationAnomaly: true,
        }, apiKey, projectId);
        if (ok0) stopped++;
        continue;
      }

      // Earliest qualifying cutoff for this log (shop timezone), so a timer is
      // closed at the right wall-clock time even across midnight.
      let stopAt: number | null = null;
      for (const c of cutoffs) {
        let cutoffMs = shopLocalTimeMs(log.startTime, tz, c.h, c.m);
        // Overnight shift: an early-morning (AM) cutoff for an evening clock-in
        // lands BEFORE the clock-in → roll to the next morning. Only for genuine
        // AM cutoffs: a PM cutoff already passed (clock back in 6pm after a
        // 5:30pm cutoff) must NOT roll ~24h — let the safety net handle it.
        // DST-safe roll: startTime+24h can land on the wrong shop-calendar day
        // across a spring-forward/fall-back boundary (23h/25h days). Anchor at
        // the SAME day's noon instead — noon+24h shifted ±1h by DST is always
        // inside the next calendar day — then rebuild the cutoff on that day.
        if (cutoffMs <= log.startTime && c.h < 12) {
          const noonSameDay = shopLocalTimeMs(log.startTime, tz, 12, 0);
          cutoffMs = shopLocalTimeMs(noonSameDay + 86400000, tz, c.h, c.m);
        }
        if (log.startTime < cutoffMs && nowMs > cutoffMs) {
          if (stopAt === null || cutoffMs < stopAt) stopAt = cutoffMs;
        }
      }

      // 14h safety net — always on, even with no cutoffs configured.
      const forced = (nowMs - log.startTime) > SAFETY_MS;
      const reason = stopAt !== null ? 'sweep:auto-clockout' : (forced ? 'sweep:14h-safety' : '');
      if (!reason) continue;
      const endTime = stopAt !== null ? stopAt : log.startTime + SAFETY_MS;

      // Finalize an active pause (only if it began before the cutoff — a pause
      // started after the cutoff doesn't reduce pre-cutoff work). Then compute
      // working duration exactly like stopTimeLog so records are consistent.
      let totalPausedMs = log.totalPausedMs || 0;
      if (log.pausedAt && log.pausedAt < endTime) totalPausedMs += endTime - log.pausedAt;
      const workingMs = Math.max(0, (endTime - log.startTime) - totalPausedMs);
      const durationSeconds = Math.floor(workingMs / 1000);
      const durationMinutes = Math.round(durationSeconds / 60);

      const ok = await patchDoc('logs', log.id, {
        endTime,
        durationMinutes,
        durationSeconds,
        status: 'completed',
        updatedAt: nowMs,
        pausedAt: null,
        totalPausedMs,
        pauseReason: null,
        stopReason: reason,
        isAutoClosed: true,
      }, apiKey, projectId);
      if (ok) stopped++;
    }
    if (stopped > 0) console.log(`[shift-push-cron] auto clock-out: ended ${stopped} timer(s) — ${nowHHMM} ${tz}`);
  } catch (e: any) {
    console.warn('[shift-push-cron] auto clock-out failed:', e?.message);
  }

  // ── Push gate ── everything below sends Web Push, which needs VAPID keys.
  // Auto-clock-out above does NOT, so it already ran regardless.
  if (!vapidPub || !vapidPriv) {
    console.log('[shift-push-cron] No VAPID keys — auto clock-out done, skipping push sections');
    return;
  }

  // 2. Find alarms that should fire right now. The master Break & Shift Alarms
  // switch gates ALL alarm-driven pushes (matches the client watcher).
  const alarmsOn = settings.shiftAlarmsEnabled !== false;
  const alarms: ShiftAlarm[] = alarmsOn ? (settings.shiftAlarms || []) : [];
  const toFire = alarms.filter(a =>
    a.enabled &&
    a.sendPush &&
    isWithinWindow(a.time, nowHHMM) &&
    alarmActiveToday(a, tz),
  );

  // 3. Clock-in reminder alarms past grace period (20 min after shift start).
  // Requires the EXPLICIT clockIn flag — naming an alarm "shift start" must not
  // silently turn it into a late-nag enforcement alarm.
  const clockInAlarmsForCheck = alarms.filter(a =>
    a.enabled &&
    a.clockIn === true &&
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
    // Once-per-day dedup: the cron runs every 5 min with a ±4-min window, so an
    // alarm can match two ticks. Atomic create-if-absent — a plain fetch-then-
    // write check lets two overlapping runs both send; only one can win this.
    const metaId = `shift-alarm-${alarm.id}-${today}`;
    const won = await setMetaDocIfNotExists(metaId, { sentAt: Date.now() }, apiKey, projectId);
    if (!won) continue;

    const isClockIn  = alarm.clockIn === true;
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

    // Open timers (in_progress + paused) — a paused timer is still evidence of
    // a clock-in, so a worker on break must NOT get a missed-clock-in nag.
    const openForClockIn = await fetchOpenLogs(apiKey, projectId);
    const activeUserIds = new Set(openForClockIn.map(l => l.userId));

    for (const alarm of clockInAlarmsForCheck) {
      const metaId = `late-clockin-${alarm.id}-${today}`;
      const meta = await fetchDoc('push_meta', metaId, apiKey, projectId);
      const lastSentAt: number = meta?.lastSentAt || 0;
      const sentCount: number  = meta?.sentCount  || 0;

      if (sentCount >= 6) continue; // max 6 reminders over ~3 hours, then give up
      if (sentCount > 0 && (now - lastSentAt) < 30 * 60 * 1000) continue; // wait 30 min between

      const notClockedIn = employees.filter((u: any) => !activeUserIds.has(u.id));

      // Write meta first (prevents double-send if cron overlaps). Reminder #1
      // is an atomic create-if-absent so two overlapping runs can't both send
      // it; later reminders are already throttled by the 30-min gate above.
      if (!meta) {
        const won = await setMetaDocIfNotExists(metaId, { lastSentAt: now, sentCount: 1 }, apiKey, projectId);
        if (!won) continue; // a concurrent run just sent this reminder
      } else {
        await setMetaDoc(metaId, { lastSentAt: now, sentCount: sentCount + 1 }, apiKey, projectId);
      }

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
            const emailRes = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: resendFrom,
                to: [toEmail],
                subject: `🚨 ${notClockedIn.length} Worker${notClockedIn.length > 1 ? 's' : ''} Still Not Clocked In — ${alarm.time} Shift`,
                html: emailBody,
              }),
            });
            if (!emailRes.ok) {
              const errText = await emailRes.text().catch(() => '');
              throw new Error(`Resend API ${emailRes.status}: ${errText.slice(0, 200)}`);
            }
            console.log(`[shift-push-cron] escalation email sent to ${toEmail} (${notClockedIn.length} missing)`);
          } catch (e: any) {
            // Critical escalation (3+ reminders, workers ~90 min late) — log at
            // error level so it surfaces in Netlify alerts instead of vanishing.
            console.error('[shift-push-cron] CRITICAL: escalation email failed:', e?.message);
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
      // Atomic create-if-absent — only one overlapping run gets to send.
      const won = await setMetaDocIfNotExists(metaId, { sentAt: now }, apiKey, projectId);
      if (!won) continue;

      const elapsed = now - log.startTime - (log.totalPausedMs || 0);
      const job: any = jobMap.get(log.jobId);
      const jobLabel = job?.jobIdsDisplay || job?.partNumber || log.jobId;

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

      // Dedup — only fire once per active session (atomic create-if-absent)
      const metaId = `over-est-${log.id}`;
      const won = await setMetaDocIfNotExists(metaId, { sentAt: now }, apiKey, projectId);
      if (!won) continue;

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
      // Dedup — only notify once per note (atomic create-if-absent)
      const noteMeta = `note-notified-${note.id}`;
      const won = await setMetaDocIfNotExists(noteMeta, { sentAt: now }, apiKey, projectId);
      if (!won) continue;

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

  // ── Section G: Idle / gap nudge — finished a job but hasn't started another ──
  // The "did a job in the AM, stopped, and never clocked back in" gap. During
  // work hours, find any worker whose last timer ENDED ≥ idleMin ago with no
  // timer now running (or paused). Nudge the worker, summarize for the admin.
  try {
    const dow = shopDayOfWeek(tz, now);                 // 0=Sun … 6=Sat
    const isWorkday = dow >= 1 && dow <= 6;             // Mon–Sat
    const workStart = shopLocalTimeMs(now, tz, 6, 0);  // no expectation before 6:00
    let weH = 17, weM = 30;
    const wm = (settings.autoClockOutTime || '17:30').match(/^(\d{1,2}):(\d{2})$/);
    if (wm) { weH = +wm[1]; weM = +wm[2]; }
    const workEnd = shopLocalTimeMs(now, tz, weH, weM);
    const idleMin = Math.max(20, Number((settings as any).idleGapMinutes) || 75);

    // Only during work hours, on a workday, and not in the last 30 min before
    // clock-out (no point telling someone to start a job right before they leave).
    if (isWorkday && now >= workStart && now <= workEnd - 30 * 60 * 1000) {
      const completedToday = await fetchCompletedLogsSince(workStart, apiKey, projectId);

      // Last time each worker finished a job today.
      const lastEndByUser = new Map<string, number>();
      for (const l of completedToday) {
        const uid = String(l.userId || '');
        if (!uid) continue;
        if (l.endTime > (lastEndByUser.get(uid) || 0)) lastEndByUser.set(uid, l.endTime);
      }

      // Anyone with ANY open timer (running OR paused) is not idle.
      const openNow = await fetchOpenLogs(apiKey, projectId);
      const busyUserIds = new Set(openNow.map((l: any) => String(l.userId || '')));

      const idleUsers: { id: string; gapMs: number }[] = [];
      for (const [uid, lastEnd] of lastEndByUser) {
        if (busyUserIds.has(uid)) continue;   // currently on a job
        if (lastEnd < workStart) continue;    // finished before work hours
        const gapMs = now - lastEnd;
        if (gapMs >= idleMin * 60 * 1000) idleUsers.push({ id: uid, gapMs });
      }

      if (idleUsers.length > 0) {
        const allUsersIdle = await fetchCollection('users', apiKey, projectId);
        const userById = new Map(allUsersIdle.map((u: any) => [String(u.id), u]));
        const idleAdmins = allUsersIdle.filter((u: any) =>
          u.role === 'admin' || u.role === 'manager' || u.role === 'owner',
        );

        const nudgedNames: string[] = [];
        for (const { id, gapMs } of idleUsers) {
          const worker: any = userById.get(id);
          // Don't nag admins/owners about their own gaps.
          if (worker && (worker.role === 'admin' || worker.role === 'manager' || worker.role === 'owner')) continue;

          // Escalating dedup — re-nudge every 45 min, max 4 times per day.
          const metaId = `idle-gap-${id}-${today}`;
          const meta = await fetchDoc('push_meta', metaId, apiKey, projectId);
          const lastSentAt: number = meta?.lastSentAt || 0;
          const sentCount:  number = meta?.sentCount  || 0;
          if (sentCount >= 4) continue;
          if (sentCount > 0 && (now - lastSentAt) < 45 * 60 * 1000) continue;

          // First nudge of the day: atomic create-if-absent so two overlapping
          // runs can't both fire it; re-nudges are throttled 45 min apart.
          if (!meta) {
            const won = await setMetaDocIfNotExists(metaId, { lastSentAt: now, sentCount: 1 }, apiKey, projectId);
            if (!won) continue; // a concurrent run just nudged them
          } else {
            await setMetaDoc(metaId, { lastSentAt: now, sentCount: sentCount + 1 }, apiKey, projectId);
          }
          nudgedNames.push((worker?.name || worker?.email || id).split(' ')[0]);

          const workerSubs = subsByUser.get(id) || [];
          if (workerSubs.length > 0) {
            const wPayload = JSON.stringify({
              title: `⏱ Start Your Next Job`,
              body:  `You finished a job ${fmtElapsed(gapMs)} ago and no timer is running. Open FabTrack IO and clock into your next job.`,
              tag:   `idle-gap-${id}`,
              url:   '/',
              requireInteraction: true,
            });
            for (const subDoc of workerSubs) await sendPush(subDoc, wPayload, 30 * 60, apiKey, projectId);
          }
          console.log(`[shift-push-cron] idle-gap nudge: ${worker?.name || id} idle ${fmtElapsed(gapMs)} (#${sentCount + 1})`);
        }

        // Admin summary — only when we actually nudged someone this run.
        if (nudgedNames.length > 0 && idleAdmins.length > 0) {
          const aPayload = JSON.stringify({
            title: `😴 ${nudgedNames.length} Worker${nudgedNames.length > 1 ? 's' : ''} Idle Between Jobs`,
            body:  `${nudgedNames.join(', ')} ${nudgedNames.length > 1 ? 'have' : 'has'} no timer running. They've been reminded to clock into their next job.`,
            tag:   `admin-idle-gap-${today}`,
            url:   '/',
            requireInteraction: false,
          });
          for (const admin of idleAdmins) {
            const adminSubs = subsByUser.get(String(admin.id)) || [];
            for (const subDoc of adminSubs) await sendPush(subDoc, aPayload, 30 * 60, apiKey, projectId);
          }
        }
      }
    }
  } catch (e: any) {
    console.warn('[shift-push-cron] idle-gap nudge failed:', e?.message);
  }
}
