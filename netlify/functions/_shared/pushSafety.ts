// netlify/functions/_shared/pushSafety.ts
// ═════════════════════════════════════════════════════════════════════
// Where the server may deliver a Web Push, and how.
//
// A push subscription is a URL plus two keys that a browser hands the page;
// web-push POSTs the encrypted message to that URL. Subscriptions reach the
// server from request bodies and from a collection browsers write to, so the
// URL must be a real browser push service — never an arbitrary host, port or
// internal address.
//
// Lives in _shared/ (no file named after the folder, no index) so Netlify
// bundles it into the functions that import it instead of deploying it as an
// endpoint of its own.
// ═════════════════════════════════════════════════════════════════════

/** Browser push services: Chrome / Edge / Android / Samsung → FCM,
 *  Firefox → Mozilla autopush, Windows (legacy Edge) → WNS, Safari / iOS → Apple. */
const PUSH_HOSTS = ['fcm.googleapis.com', 'web.push.apple.com'];
const PUSH_HOST_SUFFIXES = ['.push.services.mozilla.com', '.notify.windows.com', '.push.apple.com'];

/** Socket timeout for one push request, so a slow or silent host can't hold a
 *  function open until Netlify kills it. Pass to every sendNotification call. */
export const PUSH_TIMEOUT_MS = 5000;

export function isAllowedPushHost(hostname: string): boolean {
  const h = String(hostname || '').toLowerCase();
  return PUSH_HOSTS.includes(h) || PUSH_HOST_SUFFIXES.some(s => h.endsWith(s) && h.length > s.length);
}

/** The endpoint, normalised, when it is an https URL on a known push service
 *  (default port, no credentials); otherwise null. */
export function safePushEndpoint(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.port !== '' && u.port !== '443') return null;
  if (!isAllowedPushHost(u.hostname)) return null;
  // Hand web-push the normalised form we just checked, never the raw string.
  return u.href;
}

export interface SafeSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const KEY_CHARS = /^[A-Za-z0-9_\-+/=]+$/;

/** A fresh subscription object holding only what web-push needs — or null when
 *  the input isn't a well-formed subscription on a known push service. */
export function safeSubscription(raw: unknown): SafeSubscription | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = safePushEndpoint(r.endpoint);
  const p256dh = r.keys?.p256dh;
  const auth = r.keys?.auth;
  if (!endpoint) return null;
  if (typeof p256dh !== 'string' || p256dh.length < 20 || p256dh.length > 200 || !KEY_CHARS.test(p256dh)) return null;
  if (typeof auth !== 'string' || auth.length < 8 || auth.length > 100 || !KEY_CHARS.test(auth)) return null;
  return { endpoint, keys: { p256dh, auth } };
}

/** The push service says this subscription no longer exists — delete it. */
export function isGonePushError(e: unknown): boolean {
  const code = (e as { statusCode?: unknown } | null)?.statusCode;
  return code === 404 || code === 410;
}
