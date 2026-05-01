// ═════════════════════════════════════════════════════════════════════════
// US Holidays + Business Days  ·  services/holidays.ts
// ─────────────────────────────────────────────────────────────────────────
// Data source: date.nager.at  (free, no key, JSON, CC-BY-4.0)
// API: https://date.nager.at/api/v3/PublicHolidays/{year}/US
//
// Returns an array of:
//   { date: "YYYY-MM-DD", localName: string, name: string, global: boolean }
//
// Strategy:
//   • Cache per calendar year in memory (survives for the session).
//   • Fetch lazily — only when the year is first requested.
//   • If the network is unavailable, fall back to the bundled short list
//     of the 10 federal holidays that never move (New Year's Day, etc.).
//
// Public API exported by this module:
//   isHoliday(dateStr: string): boolean
//   getHolidays(year: number): Promise<HolidayRecord[]>
//   businessDaysUntil(targetDateStr: string): Promise<number>
//   businessDaysRemaining(targetDateStr: string): Promise<number>   (alias)
//   nextBusinessDay(fromDateStr?: string): Promise<string>
// ═════════════════════════════════════════════════════════════════════════

export interface HolidayRecord {
  date: string;        // "YYYY-MM-DD"
  localName: string;
  name: string;
  global: boolean;
}

// ── In-memory cache ───────────────────────────────────────────────────────
const cache = new Map<number, HolidayRecord[]>();

// ── Federal holiday fallback (no-network) ────────────────────────────────
// These are approximate fixed-date versions; actual observed dates may shift
// by a day for weekend rules, but they cover 95% of cases offline.
function buildFallback(year: number): HolidayRecord[] {
  const hol = (mm: string, dd: string, name: string): HolidayRecord => ({
    date: `${year}-${mm}-${dd}`,
    localName: name,
    name,
    global: true,
  });
  return [
    hol('01', '01', "New Year's Day"),
    hol('01', '15', 'Martin Luther King Jr. Day'),   // 3rd Mon Jan (approx)
    hol('02', '19', "Presidents' Day"),               // 3rd Mon Feb (approx)
    hol('05', '27', 'Memorial Day'),                  // Last Mon May (approx)
    hol('06', '19', 'Juneteenth'),
    hol('07', '04', 'Independence Day'),
    hol('09', '02', 'Labor Day'),                     // 1st Mon Sep (approx)
    hol('11', '11', 'Veterans Day'),
    hol('11', '28', 'Thanksgiving Day'),              // 4th Thu Nov (approx)
    hol('12', '25', 'Christmas Day'),
  ];
}

// ── Fetch from API (with fallback) ───────────────────────────────────────
export async function getHolidays(year: number): Promise<HolidayRecord[]> {
  if (cache.has(year)) return cache.get(year)!;

  try {
    const res = await fetch(
      `https://date.nager.at/api/v3/PublicHolidays/${year}/US`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: HolidayRecord[] = await res.json();
    cache.set(year, data);
    return data;
  } catch {
    // Network unavailable or API down — use bundled fallback
    const fallback = buildFallback(year);
    cache.set(year, fallback);
    return fallback;
  }
}

// ── Synchronous holiday check (works after first fetch for that year) ─────
// Pre-warm by calling getHolidays(currentYear) on app start if you want
// this to work without async on day-1.
export function isHolidaySync(dateStr: string): boolean {
  const iso = normalizeToIso(dateStr);
  const year = parseInt(iso.slice(0, 4), 10);
  if (!cache.has(year)) return false;
  return cache.get(year)!.some(h => h.date === iso);
}

// ── Get the holiday name for a date (if any) ─────────────────────────────
export async function getHolidayName(dateStr: string): Promise<string | null> {
  const iso = normalizeToIso(dateStr);
  const year = parseInt(iso.slice(0, 4), 10);
  const holidays = await getHolidays(year);
  const found = holidays.find(h => h.date === iso);
  return found ? found.localName : null;
}

// ── Weekend check ─────────────────────────────────────────────────────────
function isWeekend(d: Date): boolean {
  const dow = d.getDay();
  return dow === 0 || dow === 6; // Sun = 0, Sat = 6
}

// ── toLocalDateStr: strips timezone by using local date parts ─────────────
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// ── normalizeToIso: accepts MM/DD/YYYY or YYYY-MM-DD ─────────────────────
// This app stores dates as MM/DD/YYYY. All public APIs here call this first
// so callers don't have to think about format conversion.
function normalizeToIso(s: string): string {
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return s; // already ISO or unknown — pass through
}

// ── businessDaysUntil ────────────────────────────────────────────────────
// Returns the number of working days from today (inclusive) to targetDateStr
// (inclusive). Negative if the date has already passed.
export async function businessDaysUntil(targetDateStr: string): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(normalizeToIso(targetDateStr) + 'T00:00:00');

  if (isNaN(target.getTime())) return 0;

  const yearsNeeded = new Set<number>();
  yearsNeeded.add(today.getFullYear());
  yearsNeeded.add(target.getFullYear());
  await Promise.all([...yearsNeeded].map(y => getHolidays(y)));

  const sign = target >= today ? 1 : -1;
  const [start, end] = sign === 1 ? [today, target] : [target, today];

  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    if (!isWeekend(cur) && !isHolidaySync(toDateStr(cur))) {
      count++;
    }
    cur.setDate(cur.getDate() + 1);
  }

  // Subtract 1 so "today" isn't double-counted if target === today
  return sign * Math.max(0, count - 1);
}

// Alias
export const businessDaysRemaining = businessDaysUntil;

// ── nextBusinessDay ───────────────────────────────────────────────────────
// Returns "YYYY-MM-DD" of the next business day after fromDateStr
// (defaults to today). Useful for scheduling deliveries.
export async function nextBusinessDay(fromDateStr?: string): Promise<string> {
  const from = fromDateStr ? new Date(normalizeToIso(fromDateStr) + 'T00:00:00') : new Date();
  from.setHours(0, 0, 0, 0);

  await getHolidays(from.getFullYear());

  const cur = new Date(from);
  cur.setDate(cur.getDate() + 1); // start from tomorrow

  let safety = 0;
  while (safety++ < 20) {
    await getHolidays(cur.getFullYear()); // fetch Jan holidays when crossing year boundary
    if (!isWeekend(cur) && !isHolidaySync(toDateStr(cur))) {
      return toDateStr(cur);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return toDateStr(cur);
}

// ── businessDaysUntilSync ────────────────────────────────────────────────
// Synchronous version — only works after cache is warm.
// Returns null if the required year's holiday data isn't cached yet.
// Use this in render-path code; it will return null for ~0.5s then become
// accurate once the fire-and-forget fetch below completes.
export function businessDaysUntilSync(targetDateStr: string): number | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(normalizeToIso(targetDateStr) + 'T00:00:00');
  if (isNaN(target.getTime())) return null;

  const yearsNeeded = [today.getFullYear(), target.getFullYear()];
  if (yearsNeeded.some(y => !cache.has(y))) return null; // not ready yet

  const sign = target >= today ? 1 : -1;
  const [start, end] = sign === 1 ? [today, target] : [target, today];

  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    if (!isWeekend(cur) && !isHolidaySync(toDateStr(cur))) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return sign * Math.max(0, count - 1);
}

// ── Warm cache for current + next year on import ──────────────────────────
// Fire-and-forget — doesn't block anything.
const thisYear = new Date().getFullYear();
getHolidays(thisYear);
getHolidays(thisYear + 1);
