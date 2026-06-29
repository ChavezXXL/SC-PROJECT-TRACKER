// netlify/functions/daily-briefing-cron.ts
// ═════════════════════════════════════════════════════════════════════
// Runs every 10 minutes. Two daily pushes that bookend the work day:
//
//   1. MORNING BRIEFING (admins, default 06:55, settings.briefingTime)
//      — due today, overdue count, yesterday's labor hours + cost.
//        The owner walks in already knowing the day.
//
//   2. END-OF-DAY SCORECARD (each worker, default = clock-out alarm time
//      or 15:30, settings.scorecardTime)
//      — your hours, your pieces, your jobs. Personal, automatic pressure.
//
// Both dedup via push_meta (one send per day), both skip Sundays.
//
// Required Netlify env vars: same as shift-push-cron
//   FIREBASE_API_KEY / VITE_FIREBASE_API_KEY, VAPID_PUBLIC_KEY,
//   VAPID_PRIVATE_KEY, VAPID_SUBJECT
// ═════════════════════════════════════════════════════════════════════

import type { Config } from '@netlify/functions';
import webpush from 'web-push';
import type { SystemSettings, ShiftAlarm } from '../../types';
// Same matching + completion brain the UI uses, so the invoice reminder always
// agrees with what the owner sees on screen. (poOrganizer has type-only imports,
// so it's safe to bundle into this serverless function.)
import { matchJobForPo, isJobComplete, resolveStages } from '../../utils/poOrganizer';

export const config: Config = {
  schedule: '*/10 * * * *',   // every 10 minutes — early-exits outside send windows
};

// ── Firestore REST helpers (same shape as shift-push-cron) ────────────

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

async function setMetaDoc(id: string, data: Record<string, string | number | boolean>, apiKey: string, projectId: string): Promise<void> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/push_meta/${id}?key=${apiKey}`;
  const fields: any = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string')  fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = { integerValue: String(Math.round(v)) };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
  }
  await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) }).catch(() => {});
}

async function deleteDoc(col: string, id: string, apiKey: string, projectId: string): Promise<void> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${col}/${id}?key=${apiKey}`;
  await fetch(url, { method: 'DELETE' });
}

/** Completed logs whose endTime > sinceMs (skips active timers — no endTime field). */
async function fetchLogsSince(sinceMs: number, apiKey: string, projectId: string): Promise<any[]> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'logs' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'endTime' },
          op: 'GREATER_THAN',
          value: { integerValue: String(Math.round(sinceMs)) },
        },
      },
    },
  };
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) return [];
    const rows: any[] = await res.json();
    return rows.filter(r => r.document).map(r => fsDoc(r.document));
  } catch { return []; }
}

// ── Time helpers ──────────────────────────────────────────────────────

function currentHHMM(tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date()).replace(/^24:/, '00:');
}

/** "YYYY-MM-DD" in tz for an arbitrary ms timestamp. */
function dateStrInTz(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ms));
}

/** Day of week (0=Sun) in tz. */
function dowInTz(tz: string): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date());
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd.slice(0, 3));
}

/** True when target HH:MM is within ±5 min of now (10-min cron cadence). */
function inWindow(target: string, nowHHMM: string): boolean {
  const [th, tm] = target.split(':').map(Number);
  const [nh, nm] = nowHHMM.split(':').map(Number);
  if ([th, tm, nh, nm].some(n => isNaN(n))) return false;
  const diff = Math.abs((th * 60 + tm) - (nh * 60 + nm));
  return Math.min(diff, 1440 - diff) <= 5;
}

/** Job dueDate is "MM/DD/YYYY" — convert to comparable YYYYMMDD number. */
function dueNum(due: string): number {
  const m = due.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return 99991231;
  return parseInt(m[3], 10) * 10000 + parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
}

/** Today as YYYYMMDD number in tz. */
function todayNum(tz: string): number {
  return parseInt(dateStrInTz(Date.now(), tz).replace(/-/g, ''), 10);
}

const logMins = (l: any): number =>
  typeof l.durationSeconds === 'number' && l.durationSeconds >= 0
    ? l.durationSeconds / 60
    : (typeof l.durationMinutes === 'number' ? l.durationMinutes : 0);

function fmtHrs(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function sendPush(subDoc: any, payload: string, ttl: number, apiKey: string, projectId: string): Promise<'sent' | 'failed' | 'removed'> {
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
    console.log('[daily-briefing-cron] Missing env vars — skipping');
    return;
  }

  const settings = await fetchDoc('settings', 'system', apiKey, projectId) as (SystemSettings & Record<string, any>) | null;
  if (!settings) { console.log('[daily-briefing-cron] No settings doc'); return; }

  const tz       = settings.recapTimezone || 'America/Los_Angeles';
  const shopName = settings.companyName || 'FabTrack IO';
  const nowHHMM  = currentHHMM(tz);
  const today    = dateStrInTz(Date.now(), tz);

  // Sundays off — no briefing, no scorecard
  if (dowInTz(tz) === 0) return;

  // Send times — settings override, sensible defaults
  const briefingTime = settings.briefingTime || '06:55';
  const clockOutAlarm = (settings.shiftAlarms || []).find((a: ShiftAlarm) =>
    a.enabled && (a.clockOut || a.label?.toLowerCase().includes('clock out') || a.label?.toLowerCase().includes('shift end')));
  const scorecardTime = settings.scorecardTime || clockOutAlarm?.time || '15:30';

  const doBriefing  = inWindow(briefingTime, nowHHMM);
  const doScorecard = inWindow(scorecardTime, nowHHMM);
  if (!doBriefing && !doScorecard) return; // outside both windows — cheap exit

  // Shared: subscriptions + users
  const subDocs = await fetchCollection('push_subscriptions', apiKey, projectId);
  if (subDocs.length === 0) { console.log('[daily-briefing-cron] No push subscriptions'); return; }
  const subsByUser = new Map<string, any[]>();
  for (const sub of subDocs) {
    if (!sub.userId) continue;
    const arr = subsByUser.get(sub.userId) || [];
    arr.push(sub);
    subsByUser.set(sub.userId, arr);
  }
  const allUsers = await fetchCollection('users', apiKey, projectId);
  const admins = allUsers.filter((u: any) => u.role === 'admin' || u.role === 'manager' || u.role === 'owner');

  webpush.setVapidDetails(vapidSub, vapidPub, vapidPriv);

  // ── 1. MORNING BRIEFING — admins only ───────────────────────────────
  if (doBriefing) {
    const metaId = `briefing-${today}`;
    const already = await fetchDoc('push_meta', metaId, apiKey, projectId);
    if (!already) {
      await setMetaDoc(metaId, { sentAt: Date.now() }, apiKey, projectId); // write-first: no double send

      const jobs = await fetchCollection('jobs', apiKey, projectId);
      const open = jobs.filter((j: any) => j.status !== 'completed');
      const tNum = todayNum(tz);
      const dueToday = open.filter((j: any) => j.dueDate && dueNum(j.dueDate) === tNum);
      const overdue  = open.filter((j: any) => j.dueDate && dueNum(j.dueDate) < tNum);

      // Yesterday's labor — completed logs whose end fell on yesterday (tz-aware)
      const yesterday = dateStrInTz(Date.now() - 86_400_000, tz);
      const recentLogs = await fetchLogsSince(Date.now() - 48 * 3_600_000, apiKey, projectId);
      const yMins = recentLogs
        .filter((l: any) => !l.isSample && l.endTime && dateStrInTz(l.endTime, tz) === yesterday)
        .reduce((a: number, l: any) => a + logMins(l), 0);
      const shopRate = settings.shopRate && settings.shopRate > 0 ? settings.shopRate : 0;
      const yCost = shopRate > 0 ? (yMins / 60) * shopRate : 0;

      const dueList = dueToday.slice(0, 3).map((j: any) => j.poNumber || j.jobIdsDisplay || j.id).join(', ');
      const lines: string[] = [];
      lines.push(dueToday.length > 0
        ? `${dueToday.length} due today${dueList ? ` — ${dueList}` : ''}${dueToday.length > 3 ? ` +${dueToday.length - 3} more` : ''}`
        : 'Nothing due today');
      if (overdue.length > 0) lines.push(`🚨 ${overdue.length} overdue`);
      lines.push(`Yesterday: ${fmtHrs(yMins)} logged${yCost > 0 ? ` · $${Math.round(yCost)} labor` : ''}`);
      lines.push(`${open.length} jobs open`);

      const payload = JSON.stringify({
        title: `☀️ Morning Briefing — ${shopName}`,
        body: lines.join('\n'),
        tag: `briefing-${today}`,
        url: '/',
        requireInteraction: false,
      });

      let sent = 0;
      for (const admin of admins) {
        for (const subDoc of (subsByUser.get(admin.id) || [])) {
          if (await sendPush(subDoc, payload, 2 * 3600, apiKey, projectId) === 'sent') sent++;
        }
      }
      console.log(`[daily-briefing-cron] morning briefing → ${sent} push(es): ${dueToday.length} due, ${overdue.length} overdue, ${fmtHrs(yMins)} yesterday`);
    }
  }

  // ── 1b. INVOICE REMINDER — customer POs whose job is DONE but not invoiced ──
  // The "I always forget to send invoices" catch. Fires once per day at briefing
  // time: admins get a push + (if configured) an email listing what to bill.
  if (doBriefing) {
    const metaId = `invoice-reminder-${today}`;
    const already = await fetchDoc('push_meta', metaId, apiKey, projectId);
    if (!already) {
      const cpos = await fetchCollection('customer_pos', apiKey, projectId);
      if (cpos.length > 0) {
        const jobs2 = await fetchCollection('jobs', apiKey, projectId);
        const stages = resolveStages(settings as any);

        // Identical logic to the client's derivePo → no drift between what the
        // owner sees in the app and what this reminder fires on.
        const ready = cpos.filter((po: any) => {
          if (po.archived) return false;
          const st = po.invoiceStatus || 'not-invoiced';
          if (st === 'invoiced' || st === 'paid' || st === 'not-applicable') return false;
          const m = matchJobForPo(po, jobs2 as any);
          return !!m.job && isJobComplete(m.job, stages);
        });

        if (ready.length > 0) {
          await setMetaDoc(metaId, { sentAt: Date.now(), count: ready.length }, apiKey, projectId); // write-first
          const names = [...new Set(ready.map((p: any) => p.customerName).filter(Boolean))].slice(0, 4).join(', ');
          const payload = JSON.stringify({
            title: `🧾 ${ready.length} invoice${ready.length > 1 ? 's' : ''} to send`,
            body: `Jobs are done but not invoiced yet${names ? ` — ${names}${ready.length > 4 ? ' +more' : ''}` : ''}. Open Customer POs.`,
            tag: `invoice-reminder-${today}`,
            url: '/',
            requireInteraction: false,
          });
          if (admins.length === 0) console.warn('[daily-briefing-cron] no admins/managers/owners — invoice push skipped, relying on email');
          let sent = 0;
          for (const admin of admins) {
            for (const subDoc of (subsByUser.get(admin.id) || [])) {
              if (await sendPush(subDoc, payload, 4 * 3600, apiKey, projectId) === 'sent') sent++;
            }
          }

          // Email fallback — it's money; worth landing in the inbox too.
          const resendKey = process.env.RESEND_API_KEY;
          const toEmail = (settings as any).recapEmail || (settings as any).alertEmail || (settings as any).companyEmail;
          if (toEmail && !resendKey) console.warn('[daily-briefing-cron] invoice email address set but RESEND_API_KEY missing — email skipped');
          if (resendKey && toEmail) {
            const rows = ready.slice(0, 15).map((p: any) =>
              `<tr><td style="padding:5px 8px;color:#e4e4e7;border-bottom:1px solid #27272a;">${p.customerName || '—'}</td><td style="padding:5px 8px;color:#a1a1aa;border-bottom:1px solid #27272a;">${p.poNumber || ''}</td></tr>`).join('');
            const html = `<div style="font-family:sans-serif;background:#09090b;color:#fff;padding:28px;border-radius:12px;max-width:520px;">
                <h2 style="color:#fb923c;margin:0 0 6px;">🧾 ${ready.length} PO${ready.length > 1 ? 's' : ''} ready to invoice</h2>
                <p style="color:#a1a1aa;margin:0 0 14px;">These jobs are finished but aren't marked invoiced yet. Send the invoice, then mark it in Customer POs.</p>
                <table style="width:100%;border-collapse:collapse;background:#18181b;border-radius:8px;overflow:hidden;">${rows}</table>
                <p style="color:#52525b;font-size:12px;margin:14px 0 0;">— FabTrack IO · Customer POs</p>
              </div>`;
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: process.env.RESEND_FROM || 'FabTrack IO <noreply@scprecisiondeburring.com>',
                to: [toEmail],
                subject: `🧾 ${ready.length} invoice${ready.length > 1 ? 's' : ''} to send — ${shopName}`,
                html,
              }),
            }).catch((e: any) => console.error('[daily-briefing-cron] invoice email failed:', e?.message || e));
          }
          console.log(`[daily-briefing-cron] invoice reminder → ${ready.length} ready, ${sent} push(es)`);
        } else {
          console.log('[daily-briefing-cron] invoice reminder — none ready to invoice');
        }
      }
    }
  }

  // ── 2. END-OF-DAY SCORECARD — one personal push per worker ──────────
  if (doScorecard) {
    const metaId = `scorecard-${today}`;
    const already = await fetchDoc('push_meta', metaId, apiKey, projectId);
    if (!already) {
      await setMetaDoc(metaId, { sentAt: Date.now() }, apiKey, projectId);

      const todayLogs = (await fetchLogsSince(Date.now() - 18 * 3_600_000, apiKey, projectId))
        .filter((l: any) => !l.isSample && l.endTime && dateStrInTz(l.endTime, tz) === today);

      // Aggregate per worker
      const byWorker = new Map<string, { mins: number; pieces: number; jobs: Set<string> }>();
      for (const l of todayLogs) {
        if (!l.userId) continue;
        const e = byWorker.get(l.userId) || { mins: 0, pieces: 0, jobs: new Set<string>() };
        e.mins += logMins(l);
        if (typeof l.sessionQty === 'number' && l.sessionQty > 0) e.pieces += l.sessionQty;
        if (l.jobId) e.jobs.add(l.jobId);
        byWorker.set(l.userId, e);
      }

      let sent = 0;
      for (const [userId, s] of byWorker) {
        const subs = subsByUser.get(userId) || [];
        if (subs.length === 0 || s.mins < 5) continue; // nothing meaningful to report

        const parts: string[] = [fmtHrs(s.mins)];
        if (s.pieces > 0) parts.push(`${s.pieces.toLocaleString()} pcs`);
        parts.push(`${s.jobs.size} job${s.jobs.size !== 1 ? 's' : ''}`);

        const hrs = s.mins / 60;
        const note = hrs >= 7 ? 'Full day — solid work. 💪'
                  : hrs >= 5 ? 'Good day on the floor.'
                             : 'Light day — make tomorrow count.';

        const payload = JSON.stringify({
          title: `🏁 Your Day — ${parts.join(' · ')}`,
          body: note,
          tag: `scorecard-${userId}-${today}`,
          url: '/',
          requireInteraction: false,
        });
        for (const subDoc of subs) {
          if (await sendPush(subDoc, payload, 2 * 3600, apiKey, projectId) === 'sent') sent++;
        }
      }
      console.log(`[daily-briefing-cron] scorecards → ${byWorker.size} worker(s), ${sent} push(es)`);
    }
  }
}
