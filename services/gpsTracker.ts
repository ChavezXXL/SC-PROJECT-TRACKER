// ═════════════════════════════════════════════════════════════════════
// GPS Tracker — follows the driver's position while a delivery is active.
//
// Responsibilities:
//   • Ask for high-accuracy geolocation
//   • Keep a running mile total + a thinned breadcrumb track (≤ 500 points)
//   • Copy the session to this phone's storage on every accepted fix, so a
//     reload, leaving the Deliveries screen or iOS killing the tab no longer
//     loses the miles — the Deliveries screen resumes it when it opens
//   • The session outlives the Deliveries screen (one per phone), so looking
//     at another screen mid-run keeps counting
//   • The Deliveries screen writes miles + track to the run every few
//     minutes and on Finish (it owns the database calls)
//
// Constraints:
//   • Browser geolocation works in the foreground tab reliably. iOS Safari
//     in a PWA backgrounded does NOT run watchPosition — so drivers must
//     keep the app open. A gap counts as the straight line between the last
//     fix before it and the first one after (short, but not zero).
//   • Accuracy filtering drops points with acc > 100m (urban canyons /
//     tunnels produce useless fixes).
// ═════════════════════════════════════════════════════════════════════

import type { GeoPoint } from '../utils/geo';
import { haversineMiles, thinTrack } from '../utils/geo';

/** Most breadcrumbs kept. The track lives inside the run's record next to the
 *  proof photos, and the whole record has to stay under ~1 MB. */
export const MAX_TRACK_POINTS = 500;
const MIN_STEP_MI = 0.019;          // ~30 m — smaller moves are GPS jitter
const STORE_KEY = 'fabtrack_gps_session';

export interface GpsSession {
  /** The delivery run being tracked — a stored session only resumes for it. */
  runId: string;
  points: GeoPoint[];
  /** Running total. Kept apart from the points so thinning the track never changes the miles. */
  miles: number;
  /** Miles last written to the run — differs from `miles` = not saved to the run yet. */
  savedMiles: number;
  startedAt: number;
  watchId: number | null;
  lastFlushed: number;
  /** The open Deliveries screen's callbacks — swapped when it re-opens, cleared when it closes. */
  onPoint?: (s: GpsSession) => void;
  onError?: (msg: string) => void;
}

export function createGpsSession(runId: string, startMiles = 0): GpsSession {
  return { runId, points: [], miles: startMiles, savedMiles: startMiles, startedAt: Date.now(), watchId: null, lastFlushed: Date.now() };
}

/**
 * Add one fix to the session: drops junk, adds the step to the miles, thins
 * the track when it gets long. Returns false when the fix was dropped.
 */
export function acceptFix(session: GpsSession, p: GeoPoint): boolean {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return false;
  // Skip junk fixes (>100m accuracy)
  if (p.acc != null && p.acc > 100) return false;
  const last = session.points[session.points.length - 1];
  if (last) {
    const step = haversineMiles(last, p);
    const dtSec = ((p.t || 0) - (last.t || 0)) / 1000;
    // Dedup — don't store points less than 30m from the last one unless
    // more than 2 minutes have passed (keeps the track moving when parked)
    if (step < MIN_STEP_MI && dtSec < 120) return false;
    if (step >= MIN_STEP_MI) session.miles += step;
  }
  session.points.push(p);
  if (session.points.length > MAX_TRACK_POINTS) session.points = thinTrack(session.points, Math.round(MAX_TRACK_POINTS * 0.8));
  return true;
}

/** The one session tracking on this phone. Lives outside the Deliveries
 *  screen so switching screens mid-run doesn't stop the miles. */
let tracking: GpsSession | null = null;
export const trackingSession = (): GpsSession | null => tracking;

/**
 * Start watching position (or, if already watching, just re-point the
 * callbacks). onPoint fires every time a new fix is added; onError fires on
 * permission denial or hardware failure.
 */
export function startTracking(
  session: GpsSession,
  onPoint?: (s: GpsSession) => void,
  onError?: (msg: string) => void,
): void {
  session.onPoint = onPoint;
  session.onError = onError;
  if (tracking && tracking !== session) stopTracking(tracking);
  tracking = session;
  if (session.watchId != null) return;
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onError?.('Geolocation not supported — enter the miles by hand.');
    return;
  }
  const opts: PositionOptions = {
    enableHighAccuracy: true,
    maximumAge: 10_000,
    timeout: 30_000,
  };
  session.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const p: GeoPoint = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        t: pos.timestamp,
        acc: pos.coords.accuracy,
      };
      if (!acceptFix(session, p)) return;
      saveStoredSession(session);
      session.onPoint?.(session);
    },
    (err) => session.onError?.(err.message || 'Location error'),
    opts,
  );
}

export function stopTracking(session: GpsSession): void {
  if (session.watchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
    try { navigator.geolocation.clearWatch(session.watchId); } catch {}
  }
  session.watchId = null;
  session.onPoint = undefined;
  session.onError = undefined;
  if (tracking === session) tracking = null;
}

/** Total miles so far (GPS, plus any correction typed in). */
export function sessionMiles(session: GpsSession): number {
  return session.miles;
}

/** Duration in minutes from first to last point (or 0 if no track). */
export function sessionMinutes(session: GpsSession): number {
  const first = session.points[0]?.t;
  const last = session.points[session.points.length - 1]?.t;
  if (!first || !last) return 0;
  return Math.max(0, Math.round((last - first) / 60_000));
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;   // ~1 m — plenty for a mileage log

/** The track as stored on the run: ≤ MAX_TRACK_POINTS, coordinates trimmed. */
export function trackForSave(session: GpsSession, max = MAX_TRACK_POINTS): Array<{ lat: number; lon: number; t: number; acc?: number }> {
  return thinTrack(session.points, max).map(p => {
    const o: { lat: number; lon: number; t: number; acc?: number } = { lat: round5(p.lat), lon: round5(p.lon), t: Math.round(p.t || 0) };
    if (p.acc != null && Number.isFinite(p.acc)) o.acc = Math.round(p.acc);
    return o;
  });
}

// ── This phone's copy of the live session ─────────────────────────────
// Storage can be full, blocked (private mode) or missing (tests) — the copy
// is a safety net, so failures are ignored rather than stopping tracking.

export function saveStoredSession(session: GpsSession): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      v: 1,
      runId: session.runId,
      miles: session.miles,
      savedMiles: session.savedMiles,
      startedAt: session.startedAt,
      points: trackForSave(session),
    }));
  } catch { /* see above */ }
}

/** The stored session — only for `runId` when given. Null if none / unreadable. */
export function loadStoredSession(runId?: string): GpsSession | null {
  let raw: any;
  try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { return null; }
  if (!raw || raw.v !== 1 || typeof raw.runId !== 'string' || !raw.runId) return null;
  if (runId && raw.runId !== runId) return null;
  const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);
  const points: GeoPoint[] = Array.isArray(raw.points)
    ? raw.points.filter((p: any) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon))
    : [];
  const miles = num(raw.miles);
  return {
    runId: raw.runId,
    points,
    miles,
    savedMiles: num(raw.savedMiles, miles),
    startedAt: num(raw.startedAt, Date.now()),
    watchId: null,
    lastFlushed: 0,
  };
}

/** Forget the stored session (only if it belongs to `runId`, when given). */
export function clearStoredSession(runId?: string): void {
  try {
    if (runId) {
      const s = loadStoredSession();
      if (s && s.runId !== runId) return;
    }
    localStorage.removeItem(STORE_KEY);
  } catch { /* see above */ }
}
