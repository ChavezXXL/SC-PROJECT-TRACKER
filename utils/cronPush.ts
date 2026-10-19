// ═════════════════════════════════════════════════════════════════════
// Web Push for the scheduled functions. A sender is injected into each cron's
// run function, so tests can swap in a fake and assert who got what.
// Server-only (imports web-push) — never import this from app code.
// ═════════════════════════════════════════════════════════════════════

import webpush from 'web-push';
import type { FirestoreRest, FsDoc } from './firestoreRest';

export type PushResult = 'sent' | 'failed' | 'removed';
/** Send one Web Push to one push_subscriptions doc. */
export type PushSender = (subDoc: FsDoc, payload: string, ttlSec: number) => Promise<PushResult>;

/**
 * VAPID setup + sender. `push` is null when the keys are missing (no error —
 * push simply isn't set up) or rejected (`error` says why).
 *
 * Each send deletes the subscription on 404/410 (device gone) and retries
 * transient failures (5xx / 429) with a short backoff, so a push-service
 * hiccup doesn't silently drop a time-sensitive alarm.
 */
export function createWebPushSender(opts: {
  fs: FirestoreRest;
  publicKey?: string;
  privateKey?: string;
  subject?: string;
  label: string;
}): { push: PushSender | null; error?: string } {
  if (!opts.publicKey || !opts.privateKey) return { push: null };
  try {
    webpush.setVapidDetails(opts.subject || 'mailto:hello@fabtrack.io', opts.publicKey, opts.privateKey);
  } catch (e: any) {
    return { push: null, error: `VAPID keys rejected — no pushes: ${e?.message || e}` };
  }
  const push: PushSender = async (subDoc, payload, ttlSec) => {
    const subscription = subDoc.subscription;
    if (!subscription?.endpoint) return 'failed';
    const MAX_RETRIES = 2; // backoff: 1s then 2s
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await webpush.sendNotification(subscription, payload, { TTL: ttlSec });
        return 'sent';
      } catch (e: any) {
        const code = e?.statusCode || 0;
        if (code === 404 || code === 410) {
          await opts.fs.remove('push_subscriptions', subDoc.id);
          return 'removed';
        }
        if (attempt < MAX_RETRIES && (code >= 500 || code === 429)) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          continue;
        }
        console.warn(`[${opts.label}] Push failed for sub ${subDoc.id} (${code || 'no status'}): ${e?.message}`);
        return 'failed';
      }
    }
    return 'failed';
  };
  return { push };
}

/** push_subscriptions docs grouped by userId (docs without one are left out). */
export function subsByUserId(subs: FsDoc[]): Map<string, FsDoc[]> {
  const m = new Map<string, FsDoc[]>();
  for (const s of subs) {
    if (!s.userId) continue;
    const k = String(s.userId);
    (m.get(k) || m.set(k, []).get(k)!).push(s);
  }
  return m;
}
