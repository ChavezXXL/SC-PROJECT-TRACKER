// ═════════════════════════════════════════════════════════════════════
// GPS Tracker — follows the driver's position while a delivery is active.
//
// Responsibilities:
//   • Ask for high-accuracy geolocation
//   • Emit a new point every 30s (or when position changes significantly)
//   • Buffer in memory + write to Firestore every 5 min (batch)
//   • Compute final miles via the Haversine polyline utility
//
// Constraints:
//   • Browser geolocation works in the foreground tab reliably. iOS Safari
//     in a PWA backgrounded does NOT run watchPosition — so drivers must
//     keep the app open. We warn the driver about this at start.
//   • Accuracy filtering drops points with acc > 100m (urban canyons /
//     tunnels produce useless fixes).
// ═════════════════════════════════════════════════════════════════════

import type { GeoPoint } from '../utils/geo';
import { polylineMiles } from '../utils/geo';

export interface GpsSession {
  points: GeoPoint[];
  startedAt: number;
  watchId: number | null;
  lastFlushed: number;
}

export function createGpsSession(): GpsSession {
  return { points: [], startedAt: Date.now(), watchId: null, lastFlushed: Date.now() };
}

/**
 * Start watching position. onPoint fires every time a new fix is added;
 * onError fires on permission denial or hardware failure.
 */
export function startTracking(
  session: GpsSession,
  onPoint: (p: GeoPoint) => void,
  onError?: (msg: string) => void,
): void {
  if (session.watchId != null) return;
  if (!navigator.geolocation) {
    onError?.('Geolocation not supported — miles must be entered manually.');
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
      // Skip junk fixes (>100m accuracy)
      if (p.acc != null && p.acc > 100) return;
      // Dedup — don't store points less than 30m from the last one unless
      // more than 2 minutes have passed (keeps the track moving when parked)
      const last = session.points[session.points.length - 1];
      if (last) {
        const dtSec = (p.t! - (last.t || 0)) / 1000;
        const minSpacingMi = 0.019; // ~30m
        if (dtSec < 120 && polylineMiles([last, p]) < minSpacingMi) return;
      }
      session.points.push(p);
      onPoint(p);
    },
    (err) => onError?.(err.message || 'Location error'),
    opts,
  );
}

export function stopTracking(session: GpsSession): void {
  if (session.watchId != null && navigator.geolocation) {
    try { navigator.geolocation.clearWatch(session.watchId); } catch {}
  }
  session.watchId = null;
}

/** Total miles from the session's polyline. */
export function sessionMiles(session: GpsSession): number {
  return polylineMiles(session.points);
}

/** Duration in minutes from first to last point (or 0 if no track). */
export function sessionMinutes(session: GpsSession): number {
  const first = session.points[0]?.t;
  const last = session.points[session.points.length - 1]?.t;
  if (!first || !last) return 0;
  return Math.max(0, Math.round((last - first) / 60_000));
}
