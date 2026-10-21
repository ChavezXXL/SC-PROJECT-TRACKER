// netlify/functions/daily-recap-cron.ts
// ═════════════════════════════════════════════════════════════════════
// Netlify scheduled function — runs every 10 minutes and sends the daily shop
// recap email on the first run at or after the shop's configured send time
// (settings.recapTime, HH:MM in settings.recapTimezone). Once per shop day:
// settings.recapLastSentDate is stamped after a successful send. A recap set
// for 17:45 goes out between 17:45 and 17:55 — never at 17:00 while the
// floor is still on the clock.
//
// Timers still running at send time count toward today's hours (worked time
// so far, pauses taken out).
//
// READS: only what the recap shows — logs that ended in the last 7 days, the
// open timers, and the full history of the jobs in today's Job Insights (and
// earlier runs of those parts). Never the whole log history.
//
// A failed send isn't stamped: the error goes to settings.recapLastError and
// later runs retry (10 / 20 / 40 min apart, at most 4 tries a day — each try
// re-reads the day's data, so a permanent failure can't burn the read quota).
//
// Uses Firestore REST API (no Admin SDK / service account needed).
// Required Netlify env vars (already set):
//   VITE_FIREBASE_API_KEY  — Firebase web API key
//   VITE_FIREBASE_PROJECT_ID — Firebase project ID
//   RESEND_API_KEY         — from resend.com
//   RESEND_FROM            — verified sender address
// ═════════════════════════════════════════════════════════════════════

import type { Config } from '@netlify/functions';
import type { Job, TimeLog, User, SystemSettings } from '../../types';
import { buildRecapData, buildRecapHtml, buildRecapText } from '../../utils/sendDailyRecap';
import { createFirestoreRest, type FirestoreRest, type FsDoc } from '../../utils/firestoreRest';
import {
  USER_FIELDS, recapDue, recapRetryAllowed, recapInsightJobIds, runningLogsAsOf, shopDayStartMs,
  RECAP_MAX_ATTEMPTS, type RecapRetryState,
} from '../../utils/cronHelpers';
import { createResendSender, DEFAULT_EMAIL_FROM, type EmailSender } from '../../utils/cronEmail';

export const config: Config = {
  schedule: '*/10 * * * *',
};

const TAG = '[daily-recap-cron]';
/** Firestore 'in' filters take a limited number of values — stay well under it. */
const IN_CHUNK = 10;

export interface RecapCronDeps {
  fs: FirestoreRest;
  /** null = RESEND_API_KEY not set. */
  sendEmail: EmailSender | null;
  /** Fixed clock for tests. */
  now?: number;
}

export type RecapOutcome = 'sent' | 'not-due' | 'off' | 'failed';

type Settings = SystemSettings & Record<string, any>;

/** One run. Exported for tests — the scheduled handler is the default export. */
export async function runDailyRecapCron(deps: RecapCronDeps): Promise<RecapOutcome> {
  const { fs } = deps;
  const now = deps.now ?? Date.now();

  // 1. Read settings (the only read on most runs)
  const settings = await fs.get('settings', 'system') as unknown as Settings | null;
  if (!settings) { console.log(`${TAG} No settings doc — skipping`); return 'off'; }

  // 2. Guards
  if (!settings.recapEmailEnabled)  { console.log(`${TAG} recapEmailEnabled=false`); return 'off'; }
  if (!settings.recapEmail?.trim()) { console.log(`${TAG} No recapEmail set`); return 'off'; }
  if (!settings.recapTime)          { console.log(`${TAG} No recapTime set`); return 'off'; }

  // 3. Time check + once-a-day guard: first run at or after HH:MM, shop time.
  const tz = settings.recapTimezone || 'America/Los_Angeles';
  const due = recapDue({ nowMs: now, tz, recapTime: settings.recapTime, lastSentDate: settings.recapLastSentDate });
  if (!due.due) {
    console.log(`${TAG} ${due.reason === 'already-sent' ? `Already sent today (${due.today})` : due.reason === 'bad-time' ? `Bad recapTime "${settings.recapTime}"` : `Not time yet (${settings.recapTime} ${tz})`} — skipping`);
    return 'not-due';
  }
  const today = due.today;

  // A failed send retries on later runs, with backoff, a few times a day.
  if (!recapRetryAllowed(settings.recapRetry as RecapRetryState | undefined, today, now)) {
    console.log(`${TAG} Last send failed — waiting before the next try (${settings.recapLastError || 'no detail'})`);
    return 'not-due';
  }
  // No sender → don't read a single log; just make the problem visible.
  if (!deps.sendEmail) {
    await recordFailure(fs, settings, today, now, 'RESEND_API_KEY not set in Netlify', false);
    return 'failed';
  }

  // Mark today sent BEFORE reading or sending. If that can't be saved — the
  // database refusing writes, e.g. the free daily quota used up — a sent
  // email couldn't be recorded either, and every later run would send it
  // again: on 2026-10-20 that meant the recap every 10 minutes until
  // midnight, ~350 reads each. So skip; the next run tries again. A send
  // that fails afterwards takes the mark back off (recordFailure).
  const claimed = await fs.write('settings', 'system', { recapLastSentDate: today }, { merge: true });
  if (!claimed) {
    console.error(`${TAG} can't save to the database right now (${fs.stats.lastError || 'unknown error'}) — not sending, so it can't go out twice`);
    return 'failed';
  }
  const unclaim = { prevSentDate: settings.recapLastSentDate as string | undefined };

  console.log(`${TAG} Recap due (${settings.recapTime} ${tz}) — fetching data…`);

  // 4. Fetch only what the recap uses
  const todayStart = shopDayStartMs(now, tz);
  const weekStart = todayStart - 6 * 86_400_000;   // buildRecapData's 7-day labor window
  const [jobs, users, reworkDocs, weekLogs, openLogs] = await Promise.all([
    fs.list('jobs'),
    fs.list('users', { mask: USER_FIELDS }),
    fs.list('rework', { mask: ['status'] }),
    fs.where('logs', 'endTime', '>=', Math.round(weekStart)),
    fs.where('logs', 'status', 'in', ['in_progress', 'paused']),
  ]);
  if (!jobs || !users || !reworkDocs || !weekLogs || !openLogs) {
    await recordFailure(fs, settings, today, now, `couldn't read the shop data (${fs.stats.lastError || 'unknown error'})`, true, unclaim);
    return 'failed';
  }

  // Timers still running count up to now (worked time so far, pauses out).
  const running = runningLogsAsOf(openLogs.filter(l => !l.endTime), now, todayStart);

  // Job Insights compare each job worked today against its whole history and
  // earlier runs of the same part — read exactly those jobs' logs.
  const todayJobIds = new Set<string>();
  for (const l of [...weekLogs, ...running]) {
    if (l.jobId && typeof l.endTime === 'number' && l.endTime >= todayStart) todayJobIds.add(String(l.jobId));
  }
  const historyLogs = await logsForJobs(fs, recapInsightJobIds(jobs as any, todayJobIds));
  if (!historyLogs) {
    await recordFailure(fs, settings, today, now, `couldn't read job history (${fs.stats.lastError || 'unknown error'})`, true, unclaim);
    return 'failed';
  }
  const byId = new Map<string, FsDoc>();
  for (const l of [...historyLogs, ...weekLogs, ...running]) byId.set(l.id, l);   // running copies win
  const logs = [...byId.values()];

  const openReworkCount = reworkDocs.filter(r => r.status !== 'resolved').length;
  console.log(`${TAG} Loaded ${jobs.length} jobs, ${logs.length} logs (${running.length} running), ${users.length} users, ${openReworkCount} open rework — ${fs.stats.reads} reads`);

  // 5. Build the recap with timezone-correct day bounds
  const shopName = settings.companyName || 'FabTrack IO';
  const ccEmails = (settings.recapEmailCC || '').split(',').map((e: string) => e.trim()).filter(Boolean);
  const data = buildRecapData({
    to: settings.recapEmail.trim(),
    ccEmails,
    logs: logs as unknown as TimeLog[],
    allJobs: jobs as unknown as Job[],
    users: users as unknown as User[],
    shopName,
    shopRate: settings.shopRate,
    openReworkCount,
    todayStart,
  });
  // The email header prints `date` in the server's timezone (UTC on Netlify),
  // where an evening recap is already tomorrow. Shop-day noon is the same
  // calendar date in UTC for US shops.
  data.date = todayStart + 12 * 3_600_000;

  const html = buildRecapHtml(data);
  const text = buildRecapText(data);
  // Noon (not 1am) so DST boundary shifts never flip the date
  const dateStr = new Date(todayStart + 12 * 3_600_000).toLocaleDateString('en-US', {
    timeZone: tz, weekday: 'long', month: 'long', day: 'numeric',
  });
  const subject = `${shopName} — Daily Recap · ${dateStr}`;

  // 6. Send
  const to = [settings.recapEmail.trim(), ...ccEmails];
  const r = await deps.sendEmail({ to, subject, html, text });
  if (!r.ok) {
    await recordFailure(fs, settings, today, now, r.error || 'send failed', true, unclaim);
    return 'failed';
  }
  console.log(`${TAG} ✓ Sent${r.id ? ` (id=${r.id})` : ''} to: ${to.join(', ')}`);
  // Today was marked before sending; just clear an earlier error, if any
  // (every settings write makes every open screen re-read the settings doc).
  if (settings.recapLastError !== undefined || settings.recapRetry !== undefined) {
    await fs.write('settings', 'system', {}, { merge: true, deleteFields: ['recapLastError', 'recapRetry'] });
  }
  return 'sent';
}

/** Every log of these jobs ('in' queries, a few ids at a time). null = a query failed. */
async function logsForJobs(fs: FirestoreRest, jobIds: string[]): Promise<FsDoc[] | null> {
  const out: FsDoc[] = [];
  for (let i = 0; i < jobIds.length; i += IN_CHUNK) {
    const rows = await fs.where('logs', 'jobId', 'in', jobIds.slice(i, i + IN_CHUNK));
    if (!rows) return null;
    out.push(...rows);
  }
  return out;
}

/**
 * Record a failed send on settings/system (recapLastError) instead of stamping
 * it sent, so a later run retries. `countAttempt` = this try read the day's
 * data; those are capped (RECAP_MAX_ATTEMPTS) and spaced out.
 */
async function recordFailure(fs: FirestoreRest, settings: Settings, today: string, now: number, message: string, countAttempt: boolean, unclaim?: { prevSentDate?: string }) {
  const prev = settings.recapRetry as RecapRetryState | undefined;
  const failuresBefore = prev?.date === today ? (prev.failures || 0) : 0;
  const failures = countAttempt ? failuresBefore + 1 : failuresBefore;
  const giveUp = countAttempt && failures >= RECAP_MAX_ATTEMPTS;
  const recapLastError = `${today}: ${message}`.slice(0, 280) + (giveUp ? ' — gave up for today' : '');
  console.error(`${TAG} recap NOT sent — ${recapLastError}`);

  const data: Record<string, unknown> = { recapLastError };
  if (countAttempt) data.recapRetry = { date: today, failures, lastAttemptMs: now };
  // Same error as last time and nothing new to count → don't rewrite settings
  // (every write makes every open screen re-read the settings doc).
  else if (settings.recapLastError === recapLastError && !unclaim) return;
  // Today was marked sent before trying — take that back so a later run retries.
  const deleteFields: string[] = [];
  if (unclaim) {
    if (unclaim.prevSentDate) data.recapLastSentDate = unclaim.prevSentDate;
    else deleteFields.push('recapLastSentDate');
  }
  await fs.write('settings', 'system', data, { merge: true, ...(deleteFields.length ? { deleteFields } : {}) });
}

// ── Scheduled entry point ─────────────────────────────────────────────

export default async function handler() {
  console.log(`${TAG} tick`, new Date().toISOString());
  const apiKey    = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || 'AIzaSyChOewBMJeW3oAM4KYn6ergrGIV9bPHTC8';
  const projectId = process.env.FIREBASE_PROJECT_ID || 'sc-job-tracker';
  const resendKey = process.env.RESEND_API_KEY;

  const fs = createFirestoreRest({ apiKey, projectId, label: 'daily-recap-cron' });
  const sendEmail = resendKey ? createResendSender(resendKey, process.env.RESEND_FROM || DEFAULT_EMAIL_FROM) : null;
  await runDailyRecapCron({ fs, sendEmail });
}
