// ═════════════════════════════════════════════════════════════════════
// Geo utilities — Haversine distance, polyline compression, format.
//
// Used by the Delivery tracker to compute miles driven from a stream
// of GPS breadcrumbs without any map-API dependency.
// ═════════════════════════════════════════════════════════════════════

export interface GeoPoint {
  lat: number;
  lon: number;
  /** Optional timestamp (ms). Used to filter out GPS jitter when stopped. */
  t?: number;
  /** Optional accuracy in meters — points > 100m are noisy, often dropped. */
  acc?: number;
}

const EARTH_RADIUS_MI = 3958.8; // miles
const EARTH_RADIUS_KM = 6371;

/** Great-circle distance between two points in miles. */
export function haversineMiles(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(x));
}

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  return haversineMiles(a, b) * (EARTH_RADIUS_KM / EARTH_RADIUS_MI);
}

/**
 * Total miles along a polyline. Drops points with poor accuracy (> 100m)
 * and movements under 30m — GPS jitter while parked can otherwise
 * generate phantom miles.
 */
export function polylineMiles(points: GeoPoint[]): number {
  if (points.length < 2) return 0;
  const clean = points.filter(p => (p.acc == null || p.acc < 100));
  let total = 0;
  for (let i = 1; i < clean.length; i++) {
    const step = haversineMiles(clean[i - 1], clean[i]);
    // Ignore sub-30m steps — GPS noise when stationary. 30m ≈ 0.019mi
    if (step < 0.019) continue;
    total += step;
  }
  return total;
}

/** Simple decimation — keep every Nth point so a 4hr trip isn't 500 breadcrumbs. */
export function decimate(points: GeoPoint[], targetCount: number = 200): GeoPoint[] {
  if (points.length <= targetCount) return points;
  const step = Math.ceil(points.length / targetCount);
  const out: GeoPoint[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

/** Build a platform-native Maps app URL. Works on both iOS (maps.apple.com)
 *  and Android (google.com/maps) — both apps accept the google.com URL. */
export function directionsUrl(destination: string | GeoPoint, origin?: string | GeoPoint): string {
  const fmt = (p: string | GeoPoint) => typeof p === 'string' ? encodeURIComponent(p) : `${p.lat},${p.lon}`;
  const d = fmt(destination);
  const o = origin ? `&origin=${fmt(origin)}` : '';
  return `https://www.google.com/maps/dir/?api=1&destination=${d}${o}&travelmode=driving`;
}

/** Format a decimal-mile count for human display. */
export function formatMiles(m: number): string {
  if (m < 0.1) return '<0.1 mi';
  if (m < 10) return `${m.toFixed(1)} mi`;
  return `${m.toFixed(0)} mi`;
}
