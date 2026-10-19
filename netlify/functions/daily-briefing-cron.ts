// netlify/functions/daily-briefing-cron.ts
// ═════════════════════════════════════════════════════════════════════
// Runs every 10 minutes. Two daily pushes that bookend the work day:
//
//   1. MORNING BRIEFING (admins, default 06:55, settings.briefingTime)
//      — due today, overdue count, yesterday's labor hours + cost.
//        The owner walks in already knowing the day.
//      + invoice reminder, + Monday Weekly Pulse.
//
//   2. END-OF-DAY SCORECARD (each worker, settings.scorecardTime, else the
//      clock-out alarm, else the auto clock-out time, else 15:30)
//      — your hours (running timers included), your pieces, your jobs.
//
// Each send is claimed with an atomic create-if-absent push_meta stamp (one
// send per day), and nothing heavy is read until a claim is won: the `jobs`
// list is read at most once per run, only when something needs it. Both skip
// Sundays. Deactivated people get nothing.
//
// Required Netlify env vars: same as shift-push-cron
//   FIREBASE_API_KEY / VITE_FIREBASE_API_KEY, VAPID_PUBLIC_KEY,
//   VAPID_PRIVATE_KEY, VAPID_SUBJECT
// ═════════════════════════════════════════════════════════════════════

import type { Config } from '@netlify/functions';
import type { SystemSettings } from '../../types';
// Same matching + completion brain the UI uses, so the invoice reminder always
// agrees with what the owner sees on screen. (poOrganizer has type-only imports,
// so it's safe to bundle into this serverless function.)
import { matchJobForPo, isJobComplete, resolveStages } from '../../utils/poOrganizer';
// Weekly Pulse (Monday digest) — same pure trend brain the dashboard panel uses.
import { computeShopTrends, fmtTrendValue, fmtTrendDelta } from '../../utils/shopTrends';
import { computeCustomerIntel } from '../../utils/customerIntel';
import { dueState } from '../../utils/dueDates';
import { shopDayOfWeek } from '../../utils/timezone';
import { createFirestoreRest, type FirestoreRest, type FsDoc } from '../../utils/firestoreRest';
import {
  USER_FIELDS, activeAdmins, isActiveUser, scorecardTimeFor, shopDateStr, shopDayStartMs, runningLogsAsOf, loggedMinutes, escHtml,
} from '../../utils/cronHelpers';
import { createResendSender, DEFAULT_EMAIL_FROM, type EmailSender } from '../../utils/cronEmail';
import { createWebPushSender, subsByUserId, type PushSender } from '../../utils/cronPush';

export const config: Config = {
  schedule: '*/10 * * * *',   // every 10 minutes — early-exits outside send windows
};

const TAG = '[daily-briefing-cron]';

export interface BriefingCronDeps {
  fs: FirestoreRest;
  /** null = no VAPID keys → nothing to do (every send here is a push). */
  push: PushSender | null;
  /** null = no Resend key → the invoice / weekly emails are skipped. */
  sendEmail: EmailSender | null;
  /** Fixed clock for tests. */
  now?: number;
}

// ── Time helpers ──────────────────────────────────────────────────────

function hhmmIn(tz: string, ms: number): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date(ms)).replace(/^24:/, '00:');
}

/** True when target HH:MM is within ±5 min of now (10-min cron cadence). */
function inWindow(target: string, nowHHMM: string): boolean {
  const [th, tm] = target.split(':').map(Number);
  const [nh, nm] = nowHHMM.split(':').map(Number);
  if ([th, tm, nh, nm].some(n => isNaN(n))) return false;
  const diff = Math.abs((th * 60 + tm) - (nh * 60 + nm));
  return Math.min(diff, 1440 - diff) <= 5;
}

function fmtHrs(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Email subjects must stay RFC 5322-safe — strip newlines/quotes from user text. */
function subjSafe(s: any): string {
  return String(s ?? '').replace(/[\r\n"]+/g, ' ').trim();
}

// ── Run context ───────────────────────────────────────────────────────

interface Ctx {
  fs: FirestoreRest;
  push: PushSender;
  sendEmail: EmailSender | null;
  settings: SystemSettings & Record<string, any>;
  tz: string;
  shopName: string;
  now: number;
  today: string;
  /** Lazy, read at most once per run. null = couldn't be read. */
  jobs: () => Promise<FsDoc[] | null>;
  users: () => Promise<FsDoc[] | null>;
  subsByUser: () => Promise<Map<string, FsDoc[]> | null>;
  /** Claim a once-a-day send (atomic create). false = already done today. */
  claim: (metaId: string, data?: Record<string, unknown>) => Promise<boolean>;
  /** Give a claim back when the send couldn't happen, so a later run retries. */
  release: (metaId: string) => Promise<void>;
  /** Push to these users' devices; returns how many went through. */
  pushToUsers: (userIds: string[], payload: string, ttlSec: number) => Promise<number>;
}

/** One run. Exported for tests — the scheduled handler is the default export. */
export async function runDailyBriefingCron(deps: BriefingCronDeps): Promise<void> {
  const { fs } = deps;
  const now = deps.now ?? Date.now();
  if (!deps.push) {
    console.log(`${TAG} Missing VAPID keys — skipping`);
    return;
  }

  const settings = await fs.get('settings', 'system') as unknown as (SystemSettings & Record<string, any>) | null;
  if (!settings) { console.log(`${TAG} No settings doc`); return; }

  const tz       = settings.recapTimezone || 'America/Los_Angeles';
  const nowHHMM  = hhmmIn(tz, now);
  const dow      = shopDayOfWeek(tz, now);

  // Sundays off — no briefing, no scorecard
  if (dow === 0) return;

  // Send times — settings override, sensible defaults
  const briefingTime  = settings.briefingTime || '06:55';
  const scorecardTime = scorecardTimeFor(settings);
  const doBriefing  = inWindow(briefingTime, nowHHMM);
  const doScorecard = inWindow(scorecardTime, nowHHMM);
  if (!doBriefing && !doScorecard) return; // outside both windows — cheap exit (1 read)

  const once = <T>(load: () => Promise<T>): (() => Promise<T>) => {
    let p: Promise<T> | undefined;
    return () => (p ??= load());
  };
  const subs = once(() => fs.list('push_subscriptions'));
  const subsByUser = once(async () => { const s = await subs(); return s ? subsByUserId(s) : null; });
  const push = deps.push;
  const c: Ctx = {
    fs, push, sendEmail: deps.sendEmail, settings, tz, now,
    shopName: settings.companyName || 'FabTrack IO',
    today: shopDateStr(now, tz),
    jobs: once(() => fs.list('jobs')),
    users: once(() => fs.list('users', { mask: USER_FIELDS })),
    subsByUser,
    claim: (metaId, data = { sentAt: now }) => fs.write('push_meta', metaId, data, { mustNotExist: true }),
    release: async (metaId) => { await fs.remove('push_meta', metaId); },
    pushToUsers: async (userIds, payload, ttlSec) => {
      const byUser = await subsByUser();
      let sent = 0;
      for (const uid of new Set(userIds)) {
        for (const subDoc of (byUser?.get(uid) || [])) {
          if (await push(subDoc, payload, ttlSec) === 'sent') sent++;
        }
      }
      return sent;
    },
  };

  const steps: [string, (c: Ctx) => Promise<void>][] = [];
  if (doBriefing) {
    steps.push(['morning briefing', morningBriefing], ['invoice reminder', invoiceReminder]);
    if (dow === 1) steps.push(['weekly pulse', weeklyPulse]);
  }
  if (doScorecard) steps.push(['scorecards', scorecards]);
  for (const [name, fn] of steps) {
    try { await fn(c); } catch (e: any) { console.error(`${TAG} ${name} failed:`, e?.message || e); }
  }
  console.log(`${TAG} run done — ${fs.stats.reads} read(s), ${fs.stats.errors} error(s)`);
}

// ── 1. MORNING BRIEFING — admins only ─────────────────────────────────

async function morningBriefing(c: Ctx): Promise<void> {
  const metaId = `briefing-${c.today}`;
  if (!await c.claim(metaId)) return; // already sent today — nothing else is read

  const [jobs, users, recentLogs, devices] = await Promise.all([
    c.jobs(),
    c.users(),
    // Yesterday's labor — completed logs whose end fell on yesterday (tz-aware)
    c.fs.where('logs', 'endTime', '>', Math.round(c.now - 48 * 3_600_000)),
    c.subsByUser(),
  ]);
  if (!jobs || !users || !recentLogs || !devices) { await c.release(metaId); return; } // retry next run in the window

  const open = jobs.filter((j: any) => j.status !== 'completed');
  // Same rule as every screen, in the shop's timezone. This used to count a
  // job in a Shipped stage as overdue, and treat an ISO-format due date as
  // never overdue (the app treated the same string as always overdue).
  const dueOpts = { tz: c.tz, stages: c.settings.jobStages };
  const dueToday = open.filter((j: any) => dueState(j, dueOpts) === 'today');
  const overdue  = open.filter((j: any) => dueState(j, dueOpts) === 'overdue');

  const yesterday = shopDateStr(c.now - 86_400_000, c.tz);
  const yMins = recentLogs
    .filter((l: any) => !l.isSample && l.endTime && shopDateStr(l.endTime, c.tz) === yesterday)
    .reduce((a: number, l: any) => a + loggedMinutes(l), 0);
  const shopRate = c.settings.shopRate && c.settings.shopRate > 0 ? c.settings.shopRate : 0;
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
    title: `☀️ Morning Briefing — ${c.shopName}`,
    body: lines.join('\n'),
    tag: `briefing-${c.today}`,
    url: '/',
    requireInteraction: false,
  });
  const sent = await c.pushToUsers(activeAdmins(users).map(a => String(a.id)), payload, 2 * 3600);
  console.log(`${TAG} morning briefing → ${sent} push(es): ${dueToday.length} due, ${overdue.length} overdue, ${fmtHrs(yMins)} yesterday`);
}

// ── 1b. INVOICE REMINDER — customer POs whose job is DONE but not invoiced ──
// The "I always forget to send invoices" catch. Fires once per day at briefing
// time: admins get a push + (if configured) an email listing what to bill.

async function invoiceReminder(c: Ctx): Promise<void> {
  const metaId = `invoice-reminder-${c.today}`;
  // Stamp the check itself, even when nothing turns out ready — a second run
  // inside the briefing window must not re-read every PO and every job.
  if (!await c.claim(metaId, { checkedAt: c.now, count: 0 })) return;

  const cpos = await c.fs.list('customer_pos');
  if (!cpos) { await c.release(metaId); return; }
  if (cpos.length === 0) { console.log(`${TAG} invoice reminder — no customer POs`); return; }
  const jobs = await c.jobs();
  if (!jobs) { await c.release(metaId); return; }
  const stages = resolveStages(c.settings as any);

  // Identical logic to the client's derivePo → no drift between what the
  // owner sees in the app and what this reminder fires on.
  const ready = cpos.filter((po: any) => {
    if (po.archived) return false;
    const st = po.invoiceStatus || 'not-invoiced';
    if (st === 'invoiced' || st === 'paid' || st === 'not-applicable') return false;
    const m = matchJobForPo(po, jobs as any);
    return !!m.job && isJobComplete(m.job, stages);
  });
  if (ready.length === 0) { console.log(`${TAG} invoice reminder — none ready to invoice`); return; }
  await c.fs.write('push_meta', metaId, { sentAt: c.now, count: ready.length }, { merge: true });

  const names = [...new Set(ready.map((p: any) => p.customerName).filter(Boolean))].slice(0, 4).join(', ');
  const payload = JSON.stringify({
    title: `🧾 ${ready.length} invoice${ready.length > 1 ? 's' : ''} to send`,
    body: `Jobs are done but not invoiced yet${names ? ` — ${names}${ready.length > 4 ? ' +more' : ''}` : ''}. Open Customer POs.`,
    tag: `invoice-reminder-${c.today}`,
    url: '/',
    requireInteraction: false,
  });
  const users = await c.users();
  const admins = activeAdmins(users || []);
  if (admins.length === 0) console.warn(`${TAG} no active admins/managers/owners — invoice push skipped, relying on email`);
  const sent = await c.pushToUsers(admins.map(a => String(a.id)), payload, 4 * 3600);

  // Email fallback — it's money; worth landing in the inbox too.
  const toEmail = c.settings.recapEmail || c.settings.alertEmail || c.settings.companyEmail;
  if (toEmail && !c.sendEmail) console.warn(`${TAG} invoice email address set but RESEND_API_KEY missing — email skipped`);
  if (c.sendEmail && toEmail) {
    const rows = ready.slice(0, 15).map((p: any) =>
      `<tr><td style="padding:5px 8px;color:#e4e4e7;border-bottom:1px solid #27272a;">${escHtml(p.customerName || '—')}</td><td style="padding:5px 8px;color:#a1a1aa;border-bottom:1px solid #27272a;">${escHtml(p.poNumber || '')}</td></tr>`).join('');
    const html = `<div style="font-family:sans-serif;background:#09090b;color:#fff;padding:28px;border-radius:12px;max-width:520px;">
        <h2 style="color:#fb923c;margin:0 0 6px;">🧾 ${ready.length} PO${ready.length > 1 ? 's' : ''} ready to invoice</h2>
        <p style="color:#a1a1aa;margin:0 0 14px;">These jobs are finished but aren't marked invoiced yet. Send the invoice, then mark it in Customer POs.</p>
        <table style="width:100%;border-collapse:collapse;background:#18181b;border-radius:8px;overflow:hidden;">${rows}</table>
        <p style="color:#52525b;font-size:12px;margin:14px 0 0;">— FabTrack IO · Customer POs</p>
      </div>`;
    const r = await c.sendEmail({
      to: [toEmail],
      subject: `🧾 ${ready.length} invoice${ready.length > 1 ? 's' : ''} to send — ${subjSafe(c.shopName)}`,
      html,
    });
    if (!r.ok) console.error(`${TAG} invoice email failed:`, r.error);
  }
  console.log(`${TAG} invoice reminder → ${ready.length} ready, ${sent} push(es)`);
}

// ── 1c. WEEKLY PULSE — Monday-morning strategic digest (trend brain) ──
// The daily recap says what happened YESTERDAY; this says where the shop is
// HEADING: last complete week vs the 4-week normal, computed by the same
// shopTrends brain the dashboard panel uses (never disagrees with the UI).

async function weeklyPulse(c: Ctx): Promise<void> {
  const metaId = `weekly-digest-${c.today}`;
  if (!await c.claim(metaId)) return;

  const [wJobs, wLogs, wRework] = await Promise.all([
    c.jobs(),
    c.fs.where('logs', 'endTime', '>', Math.round(c.now - 42 * 86_400_000)),
    c.fs.list('rework'),   // optional — an empty list just drops the rework metric
  ]);
  if (!wJobs || !wLogs) { await c.release(metaId); return; }

  const trends = computeShopTrends(wJobs as any, wLogs as any, (wRework || []) as any);
  if (!trends.hasData) {
    console.log(`${TAG} weekly pulse — not enough history yet`);
    return;
  }
  const arrow = (m: any) => (m.direction === 'up' ? '▲' : m.direction === 'down' ? '▼' : '—');
  const color = (m: any) => (m.good === null || m.direction === 'flat' ? '#a1a1aa' : m.good ? '#34d399' : '#f87171');

  // Push: lead with the two biggest movers
  const movers = trends.metrics.filter(m => m.direction !== 'flat').slice(0, 2);
  const pushBody = movers.length > 0
    ? movers.map(m => `${m.label}: ${fmtTrendValue(m.current, m.unit)} (${fmtTrendDelta(m)})`).join(' · ')
    : 'Steady week — everything within your normal range.';
  const payload = JSON.stringify({
    title: `📈 Weekly Pulse — ${c.shopName}`,
    body: pushBody,
    tag: `weekly-digest-${c.today}`,
    url: '/',
    requireInteraction: false,
  });
  const users = await c.users();
  const sent = await c.pushToUsers(activeAdmins(users || []).map(a => String(a.id)), payload, 4 * 3600);

  // Email: full trend table + customer movers
  const toEmail = c.settings.recapEmail || c.settings.alertEmail || c.settings.companyEmail;
  if (toEmail && !c.sendEmail) console.warn(`${TAG} weekly pulse email configured but RESEND_API_KEY missing`);
  if (c.sendEmail && toEmail) {
    const rows = trends.metrics.map(m => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #27272a;color:#e4e4e7;font-weight:700;">${escHtml(m.label)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #27272a;color:#fff;font-weight:800;text-align:right;">${escHtml(fmtTrendValue(m.current, m.unit))}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #27272a;color:#71717a;text-align:right;">${escHtml(fmtTrendValue(m.baseline, m.unit))}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #27272a;font-weight:900;text-align:right;color:${color(m)};">${arrow(m)} ${escHtml(fmtTrendDelta(m))}</td>
      </tr>`).join('');
    const moverLine = (x: any, up: boolean) =>
      `<span style="display:inline-block;margin:2px 6px 2px 0;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:700;color:${up ? '#34d399' : '#f87171'};border:1px solid ${up ? '#065f46' : '#7f1d1d'};">${up ? '▲' : '▼'} ${escHtml(x.customer)} · ${escHtml(fmtTrendValue(x.current, 'money'))}/wk</span>`;
    const html = `
      <div style="font-family:sans-serif;background:#09090b;color:#fff;padding:28px;border-radius:12px;max-width:560px;">
        <h2 style="color:#38bdf8;margin:0 0 4px;">📈 Weekly Pulse — ${escHtml(c.shopName)}</h2>
        <p style="color:#a1a1aa;margin:0 0 16px;">Last week vs your 4-week normal. Where the shop is heading, not just what happened.</p>
        <table style="width:100%;border-collapse:collapse;background:#18181b;border-radius:8px;overflow:hidden;">
          <tr>
            <th style="padding:8px 12px;text-align:left;color:#71717a;font-size:11px;text-transform:uppercase;">Metric</th>
            <th style="padding:8px 12px;text-align:right;color:#71717a;font-size:11px;text-transform:uppercase;">Last wk</th>
            <th style="padding:8px 12px;text-align:right;color:#71717a;font-size:11px;text-transform:uppercase;">Normal</th>
            <th style="padding:8px 12px;text-align:right;color:#71717a;font-size:11px;text-transform:uppercase;">Trend</th>
          </tr>
          ${rows}
        </table>
        ${(trends.risingCustomers.length || trends.fallingCustomers.length) ? `
          <p style="color:#a1a1aa;font-size:12px;margin:16px 0 6px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Customer movers</p>
          <div>${trends.risingCustomers.map(x => moverLine(x, true)).join('')}${trends.fallingCustomers.map(x => moverLine(x, false)).join('')}</div>` : ''}
        ${(() => {
          // Concentration risk — how dependent 90-day revenue is on one shop.
          try {
            const intel = computeCustomerIntel(wJobs as any, wLogs as any);
            if (intel.topSharePct === null || intel.topSharePct < 40) return '';
            const col = intel.topSharePct >= 60 ? '#f87171' : '#fbbf24';
            return `<p style="color:${col};font-size:12px;margin:14px 0 0;font-weight:700;">⚠ Concentration: ${escHtml(intel.topShareName)} is ${Math.round(intel.topSharePct)}% of your last-90-day revenue — worth spreading the base.</p>`;
          } catch { return ''; }
        })()}
        <p style="color:#52525b;font-size:12px;margin:18px 0 0;">— FabTrack IO · Shop Trends</p>
      </div>`;
    const r = await c.sendEmail({ to: [toEmail], subject: `📈 Weekly Pulse — ${subjSafe(c.shopName)}`, html });
    if (!r.ok) console.error(`${TAG} weekly pulse email failed:`, r.error);
  }
  console.log(`${TAG} weekly pulse → ${sent} push(es), ${trends.metrics.filter(m => m.direction !== 'flat').length} moving metric(s)`);
}

// ── 2. END-OF-DAY SCORECARD — one personal push per worker ────────────

async function scorecards(c: Ctx): Promise<void> {
  const metaId = `scorecard-${c.today}`;
  if (!await c.claim(metaId)) return;

  const dayStart = shopDayStartMs(c.now, c.tz);
  const [ended, open, devices] = await Promise.all([
    c.fs.where('logs', 'endTime', '>=', Math.round(dayStart)),
    c.fs.where('logs', 'status', 'in', ['in_progress', 'paused']),
    c.subsByUser(),
  ]);
  if (!ended || !open || !devices) { await c.release(metaId); return; }   // retry next run in the window

  // Today's finished sessions + timers still running (worked time so far,
  // pauses taken out) — people are often still on the clock at send time.
  const todayLogs: any[] = [
    ...ended.filter((l: any) => !l.isSample && l.endTime && shopDateStr(l.endTime, c.tz) === c.today),
    ...runningLogsAsOf(open.filter((l: any) => !l.endTime), c.now, dayStart),
  ];

  // Aggregate per worker
  const byWorker = new Map<string, { mins: number; pieces: number; jobs: Set<string> }>();
  for (const l of todayLogs) {
    if (!l.userId) continue;
    const e = byWorker.get(l.userId) || { mins: 0, pieces: 0, jobs: new Set<string>() };
    e.mins += loggedMinutes(l);
    if (typeof l.sessionQty === 'number' && l.sessionQty > 0) e.pieces += l.sessionQty;
    if (l.jobId) e.jobs.add(l.jobId);
    byWorker.set(l.userId, e);
  }

  // Deactivated people don't get a scorecard. (If the people list can't be
  // read, send anyway — the recipients come from today's own time logs.)
  const users = await c.users();
  const inactive = new Set((users || []).filter(u => !isActiveUser(u)).map(u => String(u.id)));

  let sent = 0;
  for (const [userId, s] of byWorker) {
    if (inactive.has(String(userId)) || s.mins < 5) continue; // nothing meaningful to report

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
      tag: `scorecard-${userId}-${c.today}`,
      url: '/',
      requireInteraction: false,
    });
    sent += await c.pushToUsers([String(userId)], payload, 2 * 3600);
  }
  console.log(`${TAG} scorecards → ${byWorker.size} worker(s), ${sent} push(es)`);
}

// ── Scheduled entry point ─────────────────────────────────────────────

export default async function handler() {
  const apiKey    = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || 'AIzaSyChOewBMJeW3oAM4KYn6ergrGIV9bPHTC8';
  const projectId = process.env.FIREBASE_PROJECT_ID || 'sc-job-tracker';
  const resendKey = process.env.RESEND_API_KEY;

  const fs = createFirestoreRest({ apiKey, projectId, label: 'daily-briefing-cron' });
  const { push, error } = createWebPushSender({
    fs,
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT || 'mailto:hello@fabtrack.io',
    label: 'daily-briefing-cron',
  });
  if (error) console.error(`${TAG} ${error}`);
  const sendEmail = resendKey ? createResendSender(resendKey, process.env.RESEND_FROM || DEFAULT_EMAIL_FROM) : null;

  await runDailyBriefingCron({ fs, push, sendEmail });
}
