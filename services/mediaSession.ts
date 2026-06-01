// services/mediaSession.ts
// ─────────────────────────────────────────────────────────────────────
// Lock-screen "Now Playing" card for the running timer.
//
// Technique: play a near-silent looping audio track to keep the browser's
// media session alive (same trick used by clock/timer PWAs). The Media
// Session API then lets us stamp our own title/artist on the lock-screen
// card and wire up Pause / Stop action buttons — exactly like Spotify.
//
// Also manages:
//   • Screen Wake Lock  — prevents dimming while a timer is visible
//   • App Badge API     — shows active-timer count on the home-screen icon
//
// iOS notes:
//   • Requires the PWA to be added to the Home Screen (safari browser tab = no)
//   • Audio MUST be started from a direct user-gesture (button tap) — the
//     caller is responsible for invoking startMediaSession() from a click handler
//   • Wake Lock fixed for Home-Screen PWAs in iOS 18.4 (was broken before)
// ─────────────────────────────────────────────────────────────────────

export interface MediaTimerSession {
  logId:         string;
  userId:        string;
  jobLabel:      string;
  operation:     string;
  startTime:     number;       // epoch ms
  totalPausedMs: number;
  isPaused:      boolean;
  pausedAt?:     number | null;
  onPause:  () => void;
  onResume: () => void;
  onStop:   () => void;
}

// ── Module state ──────────────────────────────────────────────────────
let _audio: HTMLAudioElement | null = null;
let _silentSrc = '';
let _tick: ReturnType<typeof setInterval> | null = null;
let _wakeLock: WakeLockSentinel | null = null;
let _session: MediaTimerSession | null = null;

// ── Helpers ───────────────────────────────────────────────────────────

/** Generate a 2-second silent WAV as a blob URL — no external file needed. */
function silentWavSrc(): string {
  if (_silentSrc) return _silentSrc;
  const rate = 8000;
  const n    = rate * 2;                          // 2 s @ 8 kHz mono
  const buf  = new ArrayBuffer(44 + n * 2);
  const v    = new DataView(buf);
  const s    = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  s(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true);
  s(8, 'WAVE'); s(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);   v.setUint16(34, 16, true);
  s(36, 'data'); v.setUint32(40, n * 2, true);
  // PCM samples are all-zero (silence)
  _silentSrc = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return _silentSrc;
}

/** Format elapsed ms → "H:MM:SS" or "M:SS". */
function fmt(ms: number): string {
  const s  = Math.max(0, Math.floor(ms / 1000));
  const h  = Math.floor(s / 3600);
  const m  = Math.floor((s % 3600) / 60);
  const sc = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sc).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** Push the current elapsed time + state to the lock-screen card. */
function refreshMetadata(): void {
  if (!_session || !('mediaSession' in navigator)) return;
  const sess = _session;
  const now  = Date.now();

  const elapsed = sess.isPaused
    ? Math.max(0, (sess.pausedAt ?? now) - sess.startTime - sess.totalPausedMs)
    : Math.max(0, now - sess.startTime - sess.totalPausedMs);

  const title = sess.isPaused
    ? `⏸ Paused  ${fmt(elapsed)}`
    : `⏱ ${fmt(elapsed)}  Running`;

  navigator.mediaSession.metadata = new MediaMetadata({
    title,
    artist: `${sess.jobLabel} · ${sess.operation}`,
    album:  'FabTrack IO',
    artwork: [
      { src: '/brand/ftio-icon.png', sizes: '192x192', type: 'image/png' },
    ],
  });

  navigator.mediaSession.playbackState = sess.isPaused ? 'paused' : 'playing';

  // App icon badge — show elapsed full hours while running, clear when done
  try {
    const hours = Math.floor(elapsed / 3_600_000);
    if ('setAppBadge' in navigator) {
      if (hours >= 1) (navigator as any).setAppBadge(hours);
      else            (navigator as any).setAppBadge();   // dot (no number)
    }
  } catch { /* badge API optional */ }
}

/** Wire up the action handlers (re-call after pause/resume to swap callbacks). */
function bindHandlers(sess: MediaTimerSession): void {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;

  // Primary controls
  ms.setActionHandler('pause',        sess.isPaused ? null : sess.onPause);
  ms.setActionHandler('play',         sess.isPaused ? sess.onResume : null);
  ms.setActionHandler('stop',         sess.onStop);

  // Headphone / AirPod button fallbacks:
  // seekbackward = ⏸ Pause   seekforward = ⏹ Stop
  ms.setActionHandler('seekbackward', sess.isPaused ? sess.onResume : sess.onPause);
  ms.setActionHandler('seekforward',  sess.onStop);

  // Some platforms expose previoustrack / nexttrack instead of seekbackward/forward
  try { ms.setActionHandler('previoustrack', sess.onPause);  } catch { /* optional */ }
  try { ms.setActionHandler('nexttrack',     sess.onStop);   } catch { /* optional */ }
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Start (or replace) the lock-screen timer card.
 *
 * Must be called from a direct user-gesture (button click) on iOS
 * so the browser permits audio playback.
 */
export async function startMediaSession(session: MediaTimerSession): Promise<void> {
  _session = session;

  // ── 1. Silent audio loop ──────────────────────────────────────────
  if (!_audio) {
    _audio        = new Audio();
    _audio.src    = silentWavSrc();
    _audio.loop   = true;
    _audio.volume = 0.01;   // near-silent — some browsers kill volume=0
  }
  try { await _audio.play(); } catch { /* swallow: requires user gesture */ }

  // ── 2. Screen Wake Lock (iOS 18.4+ PWA, all modern Android Chrome) ─
  try {
    if ('wakeLock' in navigator && !_wakeLock) {
      _wakeLock = await (navigator as any).wakeLock.request('screen');
      // Re-acquire on tab visibility restore (iOS releases it when tab hides)
      document.addEventListener('visibilitychange', _reacquireWakeLock);
    }
  } catch { /* not supported or denied (low battery, power-save mode) */ }

  // ── 3. Media Session metadata + handlers ──────────────────────────
  bindHandlers(session);
  refreshMetadata();

  // ── 4. Tick every second ──────────────────────────────────────────
  if (_tick) clearInterval(_tick);
  _tick = setInterval(refreshMetadata, 1_000);
}

/**
 * Call after pause or resume to swap the action-button labels
 * and update session state (isPaused, pausedAt, totalPausedMs).
 */
export function updateMediaSession(updates: Partial<MediaTimerSession>): void {
  if (!_session) return;
  _session = { ..._session, ...updates };
  bindHandlers(_session);
  refreshMetadata();
}

/**
 * Tear everything down — call when the timer is stopped.
 */
export function stopMediaSession(): void {
  if (_tick) { clearInterval(_tick); _tick = null; }

  if (_audio) {
    _audio.pause();
    _audio.src = '';
    _audio     = null;
  }

  _releaseWakeLock();
  document.removeEventListener('visibilitychange', _reacquireWakeLock);

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata      = null;
    navigator.mediaSession.playbackState = 'none';
    for (const a of ['pause','play','stop','seekbackward','seekforward','previoustrack','nexttrack'] as const) {
      try { navigator.mediaSession.setActionHandler(a, null); } catch { /* optional actions may throw */ }
    }
  }

  try {
    if ('clearAppBadge' in navigator) (navigator as any).clearAppBadge();
  } catch {}

  _session = null;
}

// ── Wake Lock helpers ─────────────────────────────────────────────────

async function _reacquireWakeLock(): Promise<void> {
  if (document.visibilityState !== 'visible') return;
  if (_wakeLock?.released === false) return;
  try {
    _wakeLock = await (navigator as any).wakeLock.request('screen');
  } catch { /* ignore */ }
}

function _releaseWakeLock(): void {
  if (_wakeLock) {
    _wakeLock.release().catch(() => {});
    _wakeLock = null;
  }
}
