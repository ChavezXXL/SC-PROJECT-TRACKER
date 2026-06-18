// ═════════════════════════════════════════════════════════════════════
// Shared shop-timezone math.
//
// Used by BOTH the client auto-clock-out sweep (services/mockDb.ts) and the
// server cron (netlify/functions/shift-push-cron.ts) so a configured cutoff
// like "15:30" resolves to the SAME wall-clock moment regardless of whether
// the code runs on a UTC server, an admin's laptop set to Eastern, or a shop
// TV set to auto-timezone. The shop's own timezone (settings.recapTimezone)
// is the single source of truth — device/server tz is never consulted.
// ═════════════════════════════════════════════════════════════════════

/**
 * Offset (ms) such that the wall-clock reading in `tz` at instant `atMs`,
 * interpreted as if it were UTC, equals atMs + offset. For US zones this is
 * negative (e.g. PDT → −7h). Used to convert a desired shop-local wall time
 * into a real UTC epoch.
 */
export function tzOffsetMs(tz: string, atMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(new Date(atMs))) {
    if (p.type !== 'literal') parts[p.type] = parseInt(p.value, 10);
  }
  const asUTC = Date.UTC(
    parts.year, parts.month - 1, parts.day,
    parts.hour === 24 ? 0 : parts.hour, parts.minute, parts.second,
  );
  return asUTC - atMs;
}

/**
 * The UTC epoch (ms) of HH:MM shop-local time, on the SAME calendar day that
 * `refMs` falls on in `tz`. DST-safe via two-pass offset correction.
 */
export function shopLocalTimeMs(refMs: number, tz: string, h: number, m: number): number {
  const [y, mo, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(refMs)).split('-').map(Number);
  const wallAsUTC = Date.UTC(y, mo - 1, d, h, m, 0, 0);
  let guess = wallAsUTC;
  for (let i = 0; i < 2; i++) guess = wallAsUTC - tzOffsetMs(tz, guess);
  return guess;
}

/** Day of week (0=Sun .. 6=Sat) for instant `atMs` in the given shop timezone. */
export function shopDayOfWeek(tz: string, atMs: number): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
    .format(new Date(atMs));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd.slice(0, 3));
}
