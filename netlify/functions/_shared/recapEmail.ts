// netlify/functions/_shared/recapEmail.ts
// ═════════════════════════════════════════════════════════════════════
// The daily recap email, built entirely on the server — shared by
// send-email ("Send now" in Settings) and test-recap.
//
//   • recipients come from the saved settings (recapEmail + recapEmailCC)
//   • content comes from the shop's own data (jobs, logs, users, rework)
//   • "Send now" is rate-limited by an atomic stamp in push_meta/recap-now:
//     at most one every 10 minutes and RECAP_NOW_DAILY_CAP per shop day
//
// Lives in _shared/ (no file named after the folder, no index) so Netlify
// bundles it into the functions that import it instead of deploying it.
// ═════════════════════════════════════════════════════════════════════

import type { Job, TimeLog, User, SystemSettings } from '../../../types';
import { buildRecapData, buildRecapHtml, buildRecapText, type RecapData } from '../../../utils/sendDailyRecap';

// ── Firestore REST (same access the scheduled recap uses) ─────────────

export interface FsRest { apiKey: string; projectId: string }

export function fsRestFromEnv(): FsRest {
  return {
    apiKey: process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || 'AIzaSyChOewBMJeW3oAM4KYn6ergrGIV9bPHTC8',
    projectId: process.env.FIREBASE_PROJECT_ID || 'sc-job-tracker',
  };
}

const docsBase = (fs: FsRest) =>
  `https://firestore.googleapis.com/v1/projects/${fs.projectId}/databases/(default)/documents`;

export function fsVal(v: any): any {
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

export function fsDoc(raw: any): any {
  const parts = (raw.name || '').split('/');
  const out: any = { id: parts[parts.length - 1] };
  for (const [k, v] of Object.entries(raw.fields || {})) out[k] = fsVal(v as any);
  return out;
}

export async function fetchDoc(fs: FsRest, col: string, id: string): Promise<any | null> {
  const res = await fetch(`${docsBase(fs)}/${col}/${id}?key=${fs.apiKey}`);
  if (!res.ok) return null;
  return fsDoc(await res.json());
}

/** Every document in a collection. Throws if any page can't be read — a recap
 *  built from half the logs would report wrong hours. */
export async function fetchCollection(fs: FsRest, col: string): Promise<any[]> {
  const docs: any[] = [];
  let pageToken: string | undefined;
  do {
    const url = `${docsBase(fs)}/${col}?key=${fs.apiKey}&pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url);
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Firestore read of ${col} failed (${res.status})`);
    (data.documents || []).forEach((d: any) => docs.push(fsDoc(d)));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return docs;
}

// ── Recipients + shop day ──────────────────────────────────────────────

const EMAIL_RE = /^[^\s@,;<>()"]+@[^\s@,;<>()"]+\.[^\s@,;<>()"]+$/;

/** [recapEmail, ...recapEmailCC] from the saved settings — trimmed, address-
 *  shaped, de-duplicated (any case), at most 10. */
export function recapRecipients(settings: { recapEmail?: unknown; recapEmailCC?: unknown } | null | undefined): string[] {
  const raw = [String(settings?.recapEmail ?? ''), ...String(settings?.recapEmailCC ?? '').split(',')];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const email = r.trim();
    if (!EMAIL_RE.test(email) || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    out.push(email);
    if (out.length >= 10) break;
  }
  return out;
}

/** The shop's recap timezone (settings.recapTimezone), falling back to Pacific. */
export function recapTimezone(settings: { recapTimezone?: unknown } | null | undefined): string {
  const tz = settings?.recapTimezone;
  if (typeof tz === 'string' && tz) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { /* unknown zone */ }
  }
  return 'America/Los_Angeles';
}

/** Midnight (UTC ms) of the current day in `tz` — the scheduled recap's "today". */
export function shopDayStart(tz: string, now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? '0', 10);
  const msFromMidnight = ((get('hour') % 24) * 3600 + get('minute') * 60 + get('second')) * 1000 + now.getMilliseconds();
  return now.getTime() - msFromMidnight;
}

/** YYYY-MM-DD of the current day in `tz`. */
export function shopDayKey(tz: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** "Monday, October 19" — noon is used so a DST shift never flips the date. */
export function recapDateLabel(todayStart: number, tz: string): string {
  return new Date(todayStart + 12 * 3_600_000).toLocaleDateString('en-US', {
    timeZone: tz, weekday: 'long', month: 'long', day: 'numeric',
  });
}

// ── The recap itself ───────────────────────────────────────────────────

export interface ServerRecap {
  to: string[];
  shopName: string;
  tz: string;
  todayStart: number;
  dateLabel: string;
  data: RecapData;
  html: string;
  text: string;
  counts: { jobs: number; logs: number; users: number; openRework: number };
}

/** Load the shop's data and build the recap — nothing from any request. */
export async function buildServerRecap(fs: FsRest, settings: SystemSettings, now: Date = new Date()): Promise<ServerRecap> {
  const tz = recapTimezone(settings as any);
  const todayStart = shopDayStart(tz, now);

  const [allJobs, logs, users, reworkDocs] = await Promise.all([
    fetchCollection(fs, 'jobs') as Promise<Job[]>,
    fetchCollection(fs, 'logs') as Promise<TimeLog[]>,
    fetchCollection(fs, 'users') as Promise<User[]>,
    fetchCollection(fs, 'rework'),
  ]);
  const openReworkCount = reworkDocs.filter((r: any) => r.status !== 'resolved').length;

  const shopName = settings.companyName || 'FabTrack IO';
  const to = recapRecipients(settings as any);
  const data = buildRecapData({
    to: to[0] || '',
    ccEmails: to.slice(1),
    logs,
    allJobs,
    users,
    shopName,
    shopRate: settings.shopRate,
    openReworkCount,
    todayStart,
    timeZone: tz,
  });

  return {
    to, shopName, tz, todayStart,
    dateLabel: recapDateLabel(todayStart, tz),
    data,
    html: buildRecapHtml(data),
    text: buildRecapText(data),
    counts: { jobs: allJobs.length, logs: logs.length, users: users.length, openRework: openReworkCount },
  };
}

// ── Who may ask send-email for what ────────────────────────────────────

export type EmailRequest =
  | { kind: 'daily-recap' }
  | { kind: 'relay' }
  | { kind: 'refused'; status: number; error: string };

const CONTENT_FIELDS = ['to', 'subject', 'html', 'text'];

/** Callers without the relay secret may only ask for the recap — they can't
 *  supply recipients, subject or body at all. Trusted server code (relay
 *  secret) keeps the general { to, subject, html, text } path. */
export function classifyEmailRequest(body: unknown, trusted: boolean): EmailRequest {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const carriesContent = CONTENT_FIELDS.some(k => b[k] !== undefined);
  if (b.kind === 'daily-recap') {
    if (carriesContent) {
      return { kind: 'refused', status: 400, error: 'The recap is written on the server — send only { kind: "daily-recap" }.' };
    }
    return { kind: 'daily-recap' };
  }
  if (!trusted) {
    return { kind: 'refused', status: 403, error: 'Only the daily recap can be sent from the app.' };
  }
  return { kind: 'relay' };
}

// ── "Send now" rate stamp ──────────────────────────────────────────────

export const RECAP_NOW_GAP_MS = 10 * 60_000;
/** Keeps "Send now" well inside Resend's 100 emails/day and the Firestore read
 *  budget (every recap reads the whole shop) — the scheduled recap is separate. */
export const RECAP_NOW_DAILY_CAP = 5;

export interface RecapNowStamp { lastSentAt?: unknown; day?: unknown; count?: unknown }

export type RecapNowDecision =
  | { ok: true; next: { lastSentAt: number; day: string; count: number } }
  | { ok: false; reason: 'too-soon'; retryInMs: number }
  | { ok: false; reason: 'daily-cap' };

/** May a recap go out now, given the last stamp? `today` = shopDayKey(). */
export function decideRecapNow(prev: RecapNowStamp | null | undefined, nowMs: number, today: string): RecapNowDecision {
  const last = Number(prev?.lastSentAt) || 0;
  const since = nowMs - last;
  if (last > 0 && since >= 0 && since < RECAP_NOW_GAP_MS) {
    return { ok: false, reason: 'too-soon', retryInMs: RECAP_NOW_GAP_MS - since };
  }
  const count = prev?.day === today ? Math.max(0, Number(prev?.count) || 0) : 0;
  if (count >= RECAP_NOW_DAILY_CAP) return { ok: false, reason: 'daily-cap' };
  return { ok: true, next: { lastSentAt: nowMs, day: today, count: count + 1 } };
}

export function recapNowRefusal(d: Exclude<RecapNowDecision, { ok: true }>): string {
  if (d.reason === 'too-soon') {
    return `A recap was sent in the last 10 minutes — try again in ${Math.max(1, Math.ceil(d.retryInMs / 60_000))} min.`;
  }
  return `"Send now" is limited to ${RECAP_NOW_DAILY_CAP} recaps a day — try again tomorrow (the scheduled recap isn't affected).`;
}

export type RecapNowClaim =
  | { ok: true; release: () => Promise<void> }
  | { ok: false; status: number; error: string };

const stampFields = (s: { lastSentAt: number; day: string; count: number }) => ({
  lastSentAt: { integerValue: String(Math.round(s.lastSentAt)) },
  day: { stringValue: s.day },
  count: { integerValue: String(Math.round(s.count)) },
});

/**
 * Atomically claim the "Send now" slot: read push_meta/recap-now, decide, then
 * write it back with a precondition (doc still absent / unchanged since the
 * read) so two simultaneous requests can't both win. `release()` gives the
 * slot back when the email then fails to send.
 */
export async function claimRecapNow(fs: FsRest, nowMs: number, today: string): Promise<RecapNowClaim> {
  const url = `${docsBase(fs)}/push_meta/recap-now`;
  const unavailable: RecapNowClaim = { ok: false, status: 503, error: "Couldn't check when the last recap went out — try again." };
  const json = { 'Content-Type': 'application/json' };

  let prev: RecapNowStamp | null = null;
  let precondition: string;
  try {
    const res = await fetch(`${url}?key=${fs.apiKey}`);
    if (res.status === 404) {
      precondition = 'currentDocument.exists=false';
    } else if (res.ok) {
      const raw: any = await res.json();
      if (typeof raw?.updateTime !== 'string') return unavailable;
      prev = fsDoc(raw);
      precondition = `currentDocument.updateTime=${encodeURIComponent(raw.updateTime)}`;
    } else {
      return unavailable;
    }
  } catch {
    return unavailable;
  }

  const decision = decideRecapNow(prev, nowMs, today);
  if (decision.ok === false) return { ok: false, status: 429, error: recapNowRefusal(decision) };

  let writtenAt = '';
  try {
    const res = await fetch(`${url}?key=${fs.apiKey}&${precondition}`, {
      method: 'PATCH', headers: json, body: JSON.stringify({ fields: stampFields(decision.next) }),
    });
    if (!res.ok) {
      const err: any = await res.json().catch(() => null);
      const status = String(err?.error?.status || '');
      if (status === 'FAILED_PRECONDITION' || status === 'ALREADY_EXISTS') {
        // Another "Send now" claimed the slot between our read and write.
        return { ok: false, status: 429, error: 'A recap is already on its way — try again in a few minutes.' };
      }
      return unavailable;
    }
    const raw: any = await res.json().catch(() => ({}));
    writtenAt = typeof raw?.updateTime === 'string' ? raw.updateTime : '';
  } catch {
    return unavailable;
  }

  const release = async () => {
    // Only undo our own write — if anything changed the stamp since, leave it.
    const cond = writtenAt ? `&currentDocument.updateTime=${encodeURIComponent(writtenAt)}` : '';
    try {
      if (!prev) {
        await fetch(`${url}?key=${fs.apiKey}${cond}`, { method: 'DELETE' });
      } else {
        const before = { lastSentAt: Number(prev.lastSentAt) || 0, day: String(prev.day ?? ''), count: Number(prev.count) || 0 };
        await fetch(`${url}?key=${fs.apiKey}${cond}`, {
          method: 'PATCH', headers: json, body: JSON.stringify({ fields: stampFields(before) }),
        });
      }
    } catch { /* best effort — worst case the owner waits out the 10 minutes */ }
  };
  return { ok: true, release };
}
