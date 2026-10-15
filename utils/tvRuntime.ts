// Wall-TV runtime helpers. A TV runs unattended for days, so everything here
// is about staying on screen: remembering its link, keeping the panel awake,
// not leaving the page on a remote's Back button, and refreshing itself at a
// quiet hour instead of mid-shift.

import { shopLocalTimeMs } from './timezone';

const TOKEN_KEY = 'fabtrack_tv';
const DEVICE_KEY = 'fabtrack_tv_device';
const NAME_KEY = 'fabtrack_tv_name';

/** Stable id for this TV (one per browser), so the office can tell TVs apart. */
export function getTvDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = 'tv_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'tv_unsaved';
  }
}

export function getSavedTvName(): string {
  try { return localStorage.getItem(NAME_KEY) || 'Shop TV'; } catch { return 'Shop TV'; }
}
export function saveTvName(name: string): void {
  try { localStorage.setItem(NAME_KEY, name); } catch {}
}
export function getSavedTvToken(): string | null {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    // "1" was the old placeholder value — not a real link.
    return t && t !== '1' ? t : null;
  } catch { return null; }
}
export function saveTvToken(token: string): void {
  try { localStorage.setItem(TOKEN_KEY, token); } catch {}
}
export function clearTvToken(): void {
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
}

/** A new private TV link (16 hex characters). Changing it disconnects every TV. */
export function newTvToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
}

/** The one address a TV needs. Its link is remembered after pairing. */
export function tvHomeUrl(origin: string = location.origin): string {
  return `${origin}/tv`;
}

/** App version baked in at build time (see vite.config define). */
export function appBuild(): string {
  try {
    // eslint-disable-next-line no-undef
    return typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : 'dev';
  } catch { return 'dev'; }
}

/** "17:30" → minutes after midnight, or null if unreadable. */
export function hhmmToMinutes(s?: string | null): number | null {
  const m = (s || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

/** Is `nowMinutes` inside [start, end)? Handles overnight windows (18:00 → 05:00). */
export function inQuietHours(nowMinutes: number, start?: string, end?: string): boolean {
  const s = hhmmToMinutes(start), e = hhmmToMinutes(end);
  if (s === null || e === null || s === e) return false;
  return s < e ? nowMinutes >= s && nowMinutes < e : nowMinutes >= s || nowMinutes < e;
}

export interface TvQuiet { enabled?: boolean; start?: string; end?: string; days?: number[] }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The SHOP's wall clock at `nowMs` — minutes after midnight + weekday — in
 * `tz` (settings.recapTimezone, the same clock auto clock-out uses). A TV
 * browser set to UTC used to dim the board mid-shift. Without a tz (or with a
 * bad one) the device's own clock is used.
 */
export function shopClock(nowMs: number, tz?: string): { minutes: number; day: number } {
  if (tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit', weekday: 'short',
      }).formatToParts(new Date(nowMs));
      const get = (t: string) => parts.find(x => x.type === t)?.value || '';
      const h = parseInt(get('hour'), 10) % 24, m = parseInt(get('minute'), 10);
      const day = DAYS.indexOf(get('weekday').slice(0, 3));
      if (Number.isFinite(h) && Number.isFinite(m) && day >= 0) return { minutes: h * 60 + m, day };
    } catch { /* unknown tz — fall through to the device clock */ }
  }
  const d = new Date(nowMs);
  return { minutes: d.getHours() * 60 + d.getMinutes(), day: d.getDay() };
}

/** Epoch of h:m on the shop calendar day `dayOffset` days from `nowMs`.
 *  Day steps go through the calendar (anchored at noon), never "+24 h" — DST
 *  days are 23 or 25 hours long. */
function shopTimeOn(nowMs: number, dayOffset: number, h: number, m: number, tz?: string): number {
  if (tz) {
    try {
      const noon = shopLocalTimeMs(nowMs, tz, 12, 0) + dayOffset * 86_400_000;
      return shopLocalTimeMs(noon, tz, h, m);
    } catch { /* fall through */ }
  }
  const d = new Date(nowMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, h, m, 0, 0).getTime();
}

/** Is the board dimmed right now? The nightly window (overnight is fine) plus
 *  whole quiet days, e.g. weekends (0 = Sunday … 6 = Saturday). */
export function isTvQuiet(q: TvQuiet | undefined, now: Date = new Date(), tz?: string): boolean {
  if (!q?.enabled) return false;
  const c = shopClock(now.getTime(), tz);
  if (q.days?.includes(c.day)) return true;
  return inQuietHours(c.minutes, q.start, q.end);
}

/** When a quiet board comes back on — null if it isn't quiet now, or if every
 *  day is a quiet day. */
export function tvQuietUntil(q: TvQuiet | undefined, now: Date = new Date(), tz?: string): Date | null {
  if (!q || !isTvQuiet(q, now, tz)) return null;
  // Quiet can only end at the window's end time or at midnight (leaving a
  // quiet day), so those are the only moments worth checking.
  const end = hhmmToMinutes(q.end);
  const nowMs = now.getTime();
  const moments: number[] = [];
  for (let d = 0; d <= 8; d++) {
    moments.push(shopTimeOn(nowMs, d, 0, 0, tz));
    if (end !== null) moments.push(shopTimeOn(nowMs, d, Math.floor(end / 60), end % 60, tz));
  }
  moments.sort((a, b) => a - b);
  for (const t of moments) if (t > nowMs && !isTvQuiet(q, new Date(t), tz)) return new Date(t);
  return null;
}

/** "at 5:00 AM" when it's later today / overnight, else "Monday at 5:00 AM". */
export function resumeLabel(when: Date, now: Date = new Date(), tz?: string): string {
  const opts = tz ? { timeZone: tz } : {};
  const time = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...opts });
  return when.getTime() - now.getTime() < 20 * 3_600_000
    ? `at ${time}`
    : `${when.toLocaleDateString('en-US', { weekday: 'long', ...opts })} at ${time}`;
}

/**
 * Milliseconds until the next `hour`:00 shop time — the daily refresh. If that
 * is less than 30 minutes away it goes to the next day, so a TV that just
 * started doesn't refresh again right away. "Tomorrow" comes from the
 * calendar: on the night clocks fall back, "+24 h" from midnight landed on the
 * SAME day and every TV with a 12 AM refresh reloaded in a loop all day.
 */
export function msUntilDailyRefresh(hour: number, now: number = Date.now(), tz?: string): number {
  const h = Number.isFinite(hour) ? Math.min(23, Math.max(0, Math.floor(hour))) : 3;
  let next = shopTimeOn(now, 0, h, 0, tz);
  if (next - now < 30 * 60_000) next = shopTimeOn(now, 1, h, 0, tz);
  // Belt and braces: never sooner than 30 minutes, whatever the clock does.
  return Math.max(30 * 60_000, next - now);
}

/**
 * Keep the panel awake on TVs where the Wake Lock API is missing or ignored:
 * a 2×2 muted video that is always "playing" (fed by a canvas stream), which
 * TV operating systems treat as content on screen. No file to download.
 * Returns a stop function; never throws.
 */
export function startKeepAwakeVideo(): () => void {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 2; canvas.height = 2;
    const ctx = canvas.getContext('2d');
    const capture = (canvas as any).captureStream;
    if (!ctx || typeof capture !== 'function') return () => {};
    const video = document.createElement('video');
    video.muted = true; video.defaultMuted = true; video.playsInline = true; video.loop = true;
    video.setAttribute('muted', ''); video.setAttribute('playsinline', ''); video.setAttribute('aria-hidden', 'true');
    // On screen (browsers pause videos that are off screen), but invisible.
    Object.assign(video.style, { position: 'fixed', right: '0', bottom: '0', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none', zIndex: '1' });
    video.srcObject = capture.call(canvas, 1);
    document.body.appendChild(video);
    let tick = 0;
    const paint = () => { ctx.fillStyle = tick++ % 2 ? '#000000' : '#010101'; ctx.fillRect(0, 0, 2, 2); };
    paint();
    const play = () => { try { const p = video.play(); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch {} };
    play();
    const iv = window.setInterval(() => { paint(); if (video.paused) play(); }, 1000);
    return () => {
      window.clearInterval(iv);
      try { video.pause(); video.srcObject = null; video.remove(); } catch {}
    };
  } catch {
    return () => {};
  }
}

/**
 * Keep a TV remote's Back button inside the app: each Back lands on a
 * duplicate history entry instead of leaving the page. (Some TVs exit the
 * whole browser on Back — nothing a web page can do about those.)
 */
export function installBackTrap(): () => void {
  try {
    history.pushState({ fabtrackTv: true }, '', location.href);
    const onPop = () => { try { history.pushState({ fabtrackTv: true }, '', location.href); } catch {} };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  } catch {
    return () => {};
  }
}

/** Short device description for the office ("Samsung TV (Tizen)", "Fire TV", …). */
export function describeDevice(ua: string = navigator.userAgent): string {
  if (/Tizen/i.test(ua)) return 'Samsung TV (Tizen)';
  if (/Web0S|webOS/i.test(ua)) return 'LG TV (webOS)';
  if (/AFT[A-Z]|Silk/i.test(ua)) return 'Amazon Fire TV';
  if (/CrKey|Chromecast/i.test(ua)) return 'Chromecast';
  if (/Android TV|GoogleTV|BRAVIA|SMART-TV|SmartTV|HbbTV/i.test(ua)) return 'Smart TV';
  if (/Android/i.test(ua)) return 'Android device';
  if (/iPad|iPhone/i.test(ua)) return 'iPhone / iPad';
  if (/Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/CrOS/i.test(ua)) return 'Chromebook';
  if (/Linux/i.test(ua)) return 'Linux PC';
  return 'Browser';
}

// ── Why did the last TV session end? ─────────────────────────────────
// A wall TV that "just went away" can't tell anyone why. Each session keeps
// a heartbeat in this device's storage, and a planned reload (nightly
// refresh, office command, app update…) stamps its reason on the way out.
// The next start reads it back: no reason means the browser stopped without
// closing the page — it crashed or ran out of memory, was closed, or the
// device went to sleep.
const SESSION_KEY = 'fabtrack_tv_session';
let exitReason = '';

/** Call right before a planned reload/redirect so the next start knows why. */
export function setTvExitReason(reason: string): void {
  exitReason = reason;
  if (reason) tvEvent(`exit: ${reason}`, true);
}

// ── Flight recorder ──────────────────────────────────────────────────
// The last few dozen things the TV did (slides, data, photos, memory,
// screen covered, errors), kept on the device and reported by the NEXT
// start — so if the board dies, we can see what it was doing right before.
const LOG_KEY = 'fabtrack_tv_log';
const LOG_MAX = 40;
let logLines: string[] = [];
let logOn = false;
let logTimer: ReturnType<typeof setTimeout> | null = null;

const hms = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

function flushTvLog(): void {
  if (logTimer) { clearTimeout(logTimer); logTimer = null; }
  try { localStorage.setItem(LOG_KEY, JSON.stringify(logLines)); } catch {}
}

/** Note what the wall TV is doing. A no-op outside a real TV session. */
export function tvEvent(msg: string, urgent = false): void {
  if (!logOn) return;
  logLines.push(`${hms()} ${msg}`.slice(0, 160));
  if (logLines.length > LOG_MAX) logLines = logLines.slice(-LOG_MAX);
  if (urgent) flushTvLog();
  else if (!logTimer) logTimer = setTimeout(flushTvLog, 5000);
}

/** The previous session's last lines, oldest first (for the check-in). */
export function readPrevTvLog(raw: string | null, lines = 15): string {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.slice(-lines).join(' · ').slice(0, 1500) : '';
  } catch { return ''; }
}

const clockLabel = (ms: number) =>
  new Date(ms).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** What happened to the previous session, in words (or '' on a first start). */
export function describePrevSession(raw: string | null): string {
  if (!raw) return '';
  try {
    const p = JSON.parse(raw);
    if (p.exit) return `${p.exit} (${clockLabel(p.exitAt || p.lastBeat)})`;
    const hidden = p.hiddenAt ? `; screen hidden since ${clockLabel(p.hiddenAt)}` : '';
    return `stopped without closing — crash, out of memory, browser closed or device asleep (last alive ${clockLabel(p.lastBeat || p.startedAt)}${hidden})`;
  } catch { return ''; }
}

/**
 * Start tracking this session. Returns the previous session's ending and a
 * stop function. Never throws.
 */
export function startTvSession(startedAt: number): { previous: string; previousLog: string; stop: () => void } {
  let previous = '', previousLog = '';
  try { previous = describePrevSession(localStorage.getItem(SESSION_KEY)); } catch {}
  try { previousLog = readPrevTvLog(localStorage.getItem(LOG_KEY)); } catch {}
  logLines = [];
  logOn = true;
  tvEvent(`start · ${memoryLabel() || 'memory n/a'}`, true);
  let hiddenAt: number | null = null;
  // Once the page is leaving, nothing may overwrite the exit stamp: a reload
  // fires "pagehide" and THEN "visibilitychange → hidden", and that second
  // save used to erase the reason — a planned update read as a crash.
  let leaving = false;
  const save = (extra: Record<string, unknown> = {}) => {
    if (leaving) return;
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ startedAt, lastBeat: Date.now(), ...(hiddenAt ? { hiddenAt } : {}), ...extra }));
    } catch {}
  };
  save();
  const beat = window.setInterval(() => { save(); tvEvent(`alive · ${memoryLabel() || ''}`); }, 60_000);
  const onVis = () => {
    hiddenAt = document.visibilityState === 'hidden' ? Date.now() : null;
    save();
    tvEvent(hiddenAt ? 'screen hidden (covered or switched away)' : 'screen visible again', true);
  };
  const onHide = () => {
    save({ exit: exitReason || (window as any).__fabtrackExitReason || 'page closed or reloaded', exitAt: Date.now() });
    if (!leaving) tvEvent(`pagehide (${exitReason || (window as any).__fabtrackExitReason || 'closed or reloaded'})`, true);
    leaving = true;
  };
  // Back from the browser's back/forward cache: the session goes on.
  const onShow = (e: any) => { if (e && e.persisted) { leaving = false; save(); } };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', onHide);
  window.addEventListener('pageshow', onShow);
  return {
    previous,
    previousLog,
    stop: () => {
      logOn = false;
      flushTvLog();
      window.clearInterval(beat);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('pageshow', onShow);
    },
  };
}

/** Memory in use / allowed (Chromium browsers only), e.g. "182/512 MB". */
export function memoryLabel(): string | undefined {
  const m = (performance as any)?.memory;
  if (!m || !m.jsHeapSizeLimit) return undefined;
  return `${Math.round(m.usedJSHeapSize / 1048576)}/${Math.round(m.jsHeapSizeLimit / 1048576)} MB`;
}
