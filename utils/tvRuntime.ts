// Wall-TV runtime helpers. A TV runs unattended for days, so everything here
// is about staying on screen: remembering its link, keeping the panel awake,
// not leaving the page on a remote's Back button, and refreshing itself at a
// quiet hour instead of mid-shift.

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

/** Is the board dimmed right now? The nightly window (overnight is fine) plus
 *  whole quiet days, e.g. weekends (0 = Sunday … 6 = Saturday). */
export function isTvQuiet(q: TvQuiet | undefined, now: Date = new Date()): boolean {
  if (!q?.enabled) return false;
  if (q.days?.includes(now.getDay())) return true;
  return inQuietHours(now.getHours() * 60 + now.getMinutes(), q.start, q.end);
}

/** When a quiet board comes back on — null if it isn't quiet now, or if every
 *  day is a quiet day. */
export function tvQuietUntil(q: TvQuiet | undefined, now: Date = new Date()): Date | null {
  if (!q || !isTvQuiet(q, now)) return null;
  // Quiet can only end at the window's end time or at midnight (leaving a
  // quiet day), so those are the only moments worth checking.
  const end = hhmmToMinutes(q.end);
  const moments: number[] = [];
  for (let d = 0; d <= 8; d++) {
    moments.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() + d).getTime());
    if (end !== null) moments.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, Math.floor(end / 60), end % 60).getTime());
  }
  moments.sort((a, b) => a - b);
  for (const t of moments) if (t > now.getTime() && !isTvQuiet(q, new Date(t))) return new Date(t);
  return null;
}

/** "at 5:00 AM" when it's later today / overnight, else "Monday at 5:00 AM". */
export function resumeLabel(when: Date, now: Date = new Date()): string {
  const time = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return when.getTime() - now.getTime() < 20 * 3_600_000
    ? `at ${time}`
    : `${when.toLocaleDateString('en-US', { weekday: 'long' })} at ${time}`;
}

/**
 * Milliseconds until the next `hour`:00 local time — the daily refresh.
 * If that time is less than 30 minutes away it goes to the next day, so a TV
 * that just started doesn't refresh again right away.
 */
export function msUntilDailyRefresh(hour: number, now: number = Date.now()): number {
  const h = Number.isFinite(hour) ? Math.min(23, Math.max(0, Math.floor(hour))) : 3;
  const d = new Date(now);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0, 0, 0).getTime();
  const next = target - now < 30 * 60_000 ? target + 86_400_000 : target;
  // DST days are 23/25 h long; re-derive from the calendar instead of +24h.
  const nd = new Date(next);
  return new Date(nd.getFullYear(), nd.getMonth(), nd.getDate(), h, 0, 0, 0).getTime() - now;
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
