// ═════════════════════════════════════════════════════════════════════
// Shift Alarms — fires customizable alerts at configured times of day.
//
// Backed by the browser's Notification API (works even when tab is not
// focused, as long as the service worker is registered) plus an optional
// Web Audio bell so the alarm is audible on the shop floor.
//
// Checked once per minute from a single call-site (the EmployeeDashboard
// mount). Each alarm fires at most once per day, keyed in localStorage so
// a page refresh doesn't re-fire yesterday's alarms.
// ═════════════════════════════════════════════════════════════════════

import type { ShiftAlarm, ShiftAlarmSound, SystemSettings } from '../types';

const LS_FIRED = 'sc_alarms_fired'; // map: { alarmId: 'YYYY-MM-DD' }

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadFired(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LS_FIRED) || '{}'); }
  catch { return {}; }
}

function saveFired(map: Record<string, string>) {
  try { localStorage.setItem(LS_FIRED, JSON.stringify(map)); } catch {}
}

/** Compare current time vs. alarm's HH:MM. Returns true within a 1-minute window. */
function shouldFireNow(alarm: ShiftAlarm): boolean {
  if (!alarm.enabled) return false;
  const now = new Date();
  if (alarm.days && alarm.days.length > 0 && !alarm.days.includes(now.getDay())) return false;
  const [h, m] = (alarm.time || '00:00').split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return false;
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  const diffMs = now.getTime() - target.getTime();
  // Fire window: target time → 60s past. This keeps us firing only once even
  // if the poll tick isn't perfectly aligned with HH:MM:00.
  return diffMs >= 0 && diffMs < 60_000;
}

// ── Audio ─────────────────────────────────────────────────────────────
// Strategy:
//   1. Try to play a real recorded sound from Google's public sound library
//      (https://actions.google.com/sounds/) — these have been hosted for 7+
//      years and used by thousands of Google Assistant actions. CDN-cached.
//   2. If the CDN is blocked, unreachable, or the codec fails, fall back to
//      the WebAudio-synthesized versions below. Shop floor stays audible
//      even offline.
//   3. Admins can also paste a custom URL (settings.shiftAlarmSoundUrl)
//      to use their own MP3/OGG — overrides the built-in picks.

/**
 * Real recorded sounds.
 *
 *   'bell'  → bundled MP3 in /public/sounds/school-bell.mp3 (shipped with the app).
 *             This is the shop's primary alarm — worth hosting locally for zero
 *             latency + 100% reliability, no CDN dependency.
 *
 *   Others → Google's public sound library (actions.google.com/sounds).
 *             These have been hosted for 7+ years; they're OGG which modern
 *             browsers decode fine, and we auto-fall-back to synthesis if not.
 */
const SOUND_URLS: Record<Exclude<ShiftAlarmSound, 'silent'>, string> = {
  'bell':      '/sounds/school-bell.mp3',
  'chime':     'https://actions.google.com/sounds/v1/alarms/dinner_bell_triangle.ogg',
  'triangle':  'https://actions.google.com/sounds/v1/alarms/dinner_bell_triangle.ogg',
  'ship-bell': 'https://actions.google.com/sounds/v1/alarms/ship_bell_single.ogg',
  'horn':      'https://actions.google.com/sounds/v1/alarms/bugle_tune.ogg',
  'siren':     'https://actions.google.com/sounds/v1/emergency/ambulance_siren.ogg',
};

// Cache Audio elements so second+ plays are instant (no CDN re-fetch).
const audioCache = new Map<string, HTMLAudioElement>();

function getAudioElement(url: string): HTMLAudioElement {
  let el = audioCache.get(url);
  if (!el) {
    el = new Audio(url);
    el.preload = 'auto';
    el.volume = 0.85;
    el.crossOrigin = 'anonymous';
    audioCache.set(url, el);
  }
  return el;
}

/**
 * Try the recorded audio file. Resolves true on success, false on any failure.
 * When `durationSec` is provided, the sound loops until that duration is reached.
 */
function tryPlayFile(url: string, durationSec?: number): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const audio = getAudioElement(url);
      audio.currentTime = 0;
      audio.loop = !!durationSec && durationSec > 0;
      const p = audio.play();
      if (!p || typeof p.then !== 'function') { resolve(true); return; }
      p.then(() => {
        resolve(true);
        // Stop after the configured duration — stops the loop cleanly.
        if (durationSec && durationSec > 0) {
          setTimeout(() => { try { audio.pause(); audio.loop = false; audio.currentTime = 0; } catch {} }, durationSec * 1000);
        }
      }).catch(() => resolve(false));
      // Belt-and-suspenders: if the `play()` promise never resolves (e.g. stuck
      // in a "loading" state because the CDN is slow), time out after 2s and
      // fall back to synthesis so the shop floor still hears something.
      setTimeout(() => resolve(false), 2000);
    } catch {
      resolve(false);
    }
  });
}

/** Preload CDN sounds in the background so first-play latency is near zero. */
export function preloadAlarmSounds() {
  for (const url of Object.values(SOUND_URLS)) {
    try { getAudioElement(url).load(); } catch {}
  }
}

// ── Synthesis fallback ────────────────────────────────────────────────
// Used when the CDN is unreachable OR the browser can't decode OGG. Works
// 100% offline and sounds acceptable — real recordings are preferred.
//
// Why not pure sine tones: a single sine wave sounds like an iPhone alarm
// clock — thin and piercing. Real bells / school bells / dinner chimes get
// their character from:
//   • Multiple harmonics layered at inharmonic ratios (metal doesn't vibrate
//     at perfect integer multiples — that's what makes it sound "metallic")
//   • Fast attack (<10ms), long exponential decay (500ms–3s)
//   • A "strike" transient — brief burst of bandpass-filtered noise at the
//     start of each hit, simulating the hammer hitting the bell
//   • Slight random detuning across repeated strikes so the ear doesn't
//     perceive it as a synth loop
//
// Autoplay policies require a user gesture somewhere before audio fires.
// Chrome typically treats the clock-in button tap as enough.

let audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  try {
    if (!audioCtx) {
      const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }
    if (audioCtx!.state === 'suspended') audioCtx!.resume().catch(() => {});
    return audioCtx;
  } catch { return null; }
}

/**
 * Play a single bell strike — a stack of detuned partials at realistic ratios
 * plus a noise transient for the "hammer hit".
 */
function playBellStrike(ctx: AudioContext, fundamentalHz: number, delaySec: number, durationSec: number, volume: number = 0.35) {
  const start = ctx.currentTime + delaySec;
  // Inharmonic partials — these ratios approximate a real struck bell (tubular bell-ish)
  // The slight offsets from integer multiples are why a bell doesn't sound like a flute.
  const partials = [
    { ratio: 1.0,  gain: 1.0 },
    { ratio: 2.0,  gain: 0.6 },
    { ratio: 2.76, gain: 0.45 }, // characteristic "hum" partial of a real bell
    { ratio: 3.0,  gain: 0.3 },
    { ratio: 4.2,  gain: 0.25 },
    { ratio: 5.4,  gain: 0.2 },
  ];
  const master = ctx.createGain();
  master.gain.setValueAtTime(volume, start);
  master.connect(ctx.destination);

  for (const p of partials) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = fundamentalHz * p.ratio;
    // Each partial has its own envelope — higher partials decay faster (like real metal)
    const life = durationSec * (1 / (p.ratio * 0.45 + 0.55));
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(p.gain, start + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + life);
    osc.connect(gain); gain.connect(master);
    osc.start(start);
    osc.stop(start + life);
  }

  // Hammer strike — a 12ms burst of bandpass-filtered white noise at the fundamental
  // This is what makes it sound like a thing HIT a thing, not just a tone turning on.
  const noiseDur = 0.02;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * noiseDur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = fundamentalHz * 2;
  filter.Q.value = 3;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.25, start);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, start + noiseDur);
  noiseSrc.connect(filter); filter.connect(noiseGain); noiseGain.connect(master);
  noiseSrc.start(start);
}

/**
 * Play a horn blast — low sawtooth + buzzing saw harmonic, sustained with envelope.
 * This is the factory shift-end / truck air-horn feel.
 */
function playHornBlast(ctx: AudioContext, fundamentalHz: number, delaySec: number, durationSec: number, volume: number = 0.4) {
  const start = ctx.currentTime + delaySec;
  const end = start + durationSec;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, start);
  master.gain.linearRampToValueAtTime(volume, start + 0.04);      // punchy attack
  master.gain.setValueAtTime(volume, end - 0.08);                  // sustain
  master.gain.exponentialRampToValueAtTime(0.001, end);            // quick release
  master.connect(ctx.destination);
  // Low sawtooth for the body
  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.value = fundamentalHz;
  // Higher harmonic for the brass bite
  const squ = ctx.createOscillator();
  squ.type = 'square';
  squ.frequency.value = fundamentalHz * 3;
  const sqGain = ctx.createGain();
  sqGain.gain.value = 0.15;
  // Lowpass to cut harshness — keeps it sounding like an air horn, not a synth buzz
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = fundamentalHz * 6;
  lp.Q.value = 0.8;
  saw.connect(lp); squ.connect(sqGain); sqGain.connect(lp); lp.connect(master);
  saw.start(start); squ.start(start);
  saw.stop(end); squ.stop(end);
}

/**
 * Play a triangle / dinner-bell — simple, pleasant, gentle.
 * Two high-pitched partials with long decay, no hammer transient.
 */
function playTriangle(ctx: AudioContext, fundamentalHz: number, delaySec: number, durationSec: number, volume: number = 0.3) {
  const start = ctx.currentTime + delaySec;
  const master = ctx.createGain();
  master.gain.setValueAtTime(volume, start);
  master.connect(ctx.destination);
  // Two clean sines an octave + fifth apart — sounds like a real dinner triangle
  for (const [ratio, g] of [[1, 1], [2, 0.5], [3, 0.2]] as const) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = fundamentalHz * ratio;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(g, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);
    osc.connect(gain); gain.connect(master);
    osc.start(start);
    osc.stop(start + durationSec);
  }
}

/**
 * Play a siren — a swept sine that rises + falls over time.
 * Used for urgent end-of-shift / lockdown style alerts.
 */
function playSiren(ctx: AudioContext, delaySec: number, cycles: number = 2) {
  const start = ctx.currentTime + delaySec;
  const cycleTime = 0.8;
  const master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  // Sweep from 440 → 880 → 440 Hz across each cycle
  for (let i = 0; i <= cycles; i++) {
    const t = start + i * cycleTime;
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + cycleTime / 2);
    osc.frequency.exponentialRampToValueAtTime(440, t + cycleTime);
  }
  // Second oscillator slightly detuned gives that classic "two-tone" siren timbre
  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  for (let i = 0; i <= cycles; i++) {
    const t = start + i * cycleTime;
    osc2.frequency.setValueAtTime(445, t);
    osc2.frequency.exponentialRampToValueAtTime(890, t + cycleTime / 2);
    osc2.frequency.exponentialRampToValueAtTime(445, t + cycleTime);
  }
  const osc2Gain = ctx.createGain();
  osc2Gain.gain.value = 0.5;
  osc.connect(master);
  osc2.connect(osc2Gain); osc2Gain.connect(master);
  osc.start(start); osc2.start(start);
  const endTime = start + cycles * cycleTime + 0.05;
  osc.stop(endTime); osc2.stop(endTime);
}

/**
 * Play an alarm. Uses a real recorded sound from the CDN when available,
 * falls back to synthesis if the file can't load or decode.
 *
 * @param sound       Built-in sound to play (or 'silent' to skip audio)
 * @param customUrl   Admin-pasted URL — overrides the built-in pick
 * @param durationSec Ring duration in seconds (1–30). Short files loop to fill.
 *                    Undefined = play once through the file's natural length.
 */
export async function playAlarmSound(
  sound: ShiftAlarmSound = 'bell',
  customUrl?: string,
  durationSec?: number,
) {
  if (sound === 'silent') return;

  // Admin-supplied URL wins — try it first, no fallback (if they typed it,
  // they're responsible for it; a broken URL shouldn't play a weird synth tone).
  if (customUrl) {
    const ok = await tryPlayFile(customUrl, durationSec);
    if (ok) return;
    // Only fall through to synthesis if the custom URL completely failed.
  }

  // Built-in: try the CDN recording first
  const url = SOUND_URLS[sound as Exclude<ShiftAlarmSound, 'silent'>];
  if (url) {
    const ok = await tryPlayFile(url, durationSec);
    if (ok) return;
  }

  // Fallback — synthesis (keeps the shop floor audible when CDN is blocked).
  // Loop the synth sample to fill the configured duration.
  const loops = durationSec && durationSec > 0 ? Math.max(1, Math.round(durationSec / 2.5)) : 1;
  for (let i = 0; i < loops; i++) {
    setTimeout(() => playSynthesizedFallback(sound), i * 2500);
  }
}

function playSynthesizedFallback(sound: ShiftAlarmSound) {
  const ctx = getAudioCtx();
  if (!ctx) return;

  switch (sound) {
    case 'silent':
      return;

    case 'bell': {
      // Classic school/factory bell — rapid "RING RING RING" cluster.
      // Strikes alternate between two close pitches like a clapper bouncing
      // between two metal plates. Total ~2.2s.
      const strikeHz = 1040;                   // high, attention-getting
      const altHz    = 920;
      const interval = 0.11;                   // strikes 90ms apart for that classic rattle
      const strikes  = 14;
      for (let i = 0; i < strikes; i++) {
        // Slight random detune so it doesn't sound like a loop
        const detune = (Math.random() - 0.5) * 15;
        const hz = (i % 2 === 0 ? strikeHz : altHz) + detune;
        // Decay grows slightly as the sequence ends — gives it a "winding down" feel
        const decay = 0.22 + (i === strikes - 1 ? 0.5 : 0);
        playBellStrike(ctx, hz, i * interval, decay, 0.32);
      }
      return;
    }

    case 'chime': {
      // Dinner/elevator chime — three pleasant bells in cascade.
      // Major-third intervals (E → C → G) = classic "ding dong ding" that says
      // "come eat" without being alarming.
      playBellStrike(ctx, 659, 0,    1.8, 0.35); // E5
      playBellStrike(ctx, 523, 0.35, 2.0, 0.35); // C5
      playBellStrike(ctx, 784, 0.7,  2.4, 0.35); // G5
      return;
    }

    case 'triangle': {
      // Single clean dinner-triangle ding — gentle, no decay-bell metallic clang.
      // Perfect for a short break reminder that isn't meant to rally everyone.
      playTriangle(ctx, 1760, 0,   2.5, 0.32); // A6
      playTriangle(ctx, 1318, 0.4, 2.5, 0.28); // E6 follow-up
      return;
    }

    case 'ship-bell': {
      // Low, warm single clang — like a brass ship's bell. Lower fundamental
      // means deeper, more resonant sound. Two hits ~1.5s apart.
      playBellStrike(ctx, 440, 0,   2.5, 0.4); // A4
      playBellStrike(ctx, 440, 1.4, 2.8, 0.38);
      return;
    }

    case 'horn': {
      // Two short factory air-horn blasts — shift-end / end-of-day feel.
      // Low, commanding. Heard across a loud shop floor.
      playHornBlast(ctx, 146, 0,    0.45, 0.42); // ~D3
      playHornBlast(ctx, 146, 0.65, 1.2,  0.45); // longer second blast
      return;
    }

    case 'siren': {
      // Rising/falling wail — 2 full cycles. Use sparingly, it's URGENT.
      playSiren(ctx, 0, 2);
      return;
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────

export function getActiveAlarms(settings: SystemSettings): ShiftAlarm[] {
  // Master switch — when off, nothing fires.
  if (settings.shiftAlarmsEnabled === false) return [];
  // Prefer explicit shiftAlarms array. When absent, synthesize from legacy fields.
  if (settings.shiftAlarms && settings.shiftAlarms.length > 0) return settings.shiftAlarms;
  const legacy: ShiftAlarm[] = [];
  if (settings.autoLunchPauseEnabled) {
    if (settings.lunchStart) legacy.push({ id: 'legacy-lunch-start', label: 'Lunch starts', time: settings.lunchStart, enabled: true, sound: 'bell', pauseTimers: true });
    if (settings.lunchEnd)   legacy.push({ id: 'legacy-lunch-end',   label: 'Back to work', time: settings.lunchEnd,   enabled: true, sound: 'chime' });
  }
  if (settings.autoClockOutEnabled && settings.autoClockOutTime) {
    legacy.push({ id: 'legacy-clockout', label: 'Shift ends — clock out', time: settings.autoClockOutTime, enabled: true, sound: 'bell', clockOut: true });
  }
  return legacy;
}

/**
 * Catch-up check — fires any alarm whose time was "now or within the last
 * 30 minutes" and hasn't been fired today yet. Called on:
 *   • Page load
 *   • Every 30s while the page is visible
 *   • Whenever the page becomes visible again (user tabs back in / unlocks
 *     phone / opens the PWA from the home screen).
 *
 * The 30-minute back-window covers the common "app was backgrounded when
 * the alarm time hit" case — when the user reopens the PWA, they see the
 * notification they would've gotten had the app been open.
 */
function shouldFireNowOrRecently(alarm: ShiftAlarm, lookbackMs: number): boolean {
  if (!alarm.enabled) return false;
  const now = new Date();
  if (alarm.days && alarm.days.length > 0 && !alarm.days.includes(now.getDay())) return false;
  const [h, m] = (alarm.time || '00:00').split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return false;
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  const diffMs = now.getTime() - target.getTime();
  return diffMs >= 0 && diffMs < lookbackMs;
}

/** Starts a minute-resolution poller. Returns an unsubscribe function. */
export function watchShiftAlarms(
  getSettings: () => SystemSettings,
  onFire: (alarm: ShiftAlarm) => void,
): () => void {
  const tick = (lookbackMs: number = 60_000) => {
    const settings = getSettings();
    const alarms = getActiveAlarms(settings);
    if (alarms.length === 0) return;
    const fired = loadFired();
    const today = todayKey();
    let changed = false;
    for (const alarm of alarms) {
      if (fired[alarm.id] === today) continue;
      if (!shouldFireNowOrRecently(alarm, lookbackMs)) continue;
      fired[alarm.id] = today;
      changed = true;
      onFire(alarm);
    }
    if (changed) saveFired(fired);
  };

  // On initial mount, look back 30 minutes — catches alarms that would've
  // fired while the PWA was closed / suspended. Shop owners reopen the app
  // in the morning and immediately see "Lunch starts — 12:00" if it's past.
  tick(30 * 60_000);

  const interval = setInterval(() => tick(60_000), 30_000); // 30s resolution

  // Re-check on visibility change — iOS Safari suspends timers but fires
  // `visibilitychange` the instant the app comes back to foreground.
  const onVis = () => { if (!document.hidden) tick(30 * 60_000); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('focus', onVis);

  return () => {
    clearInterval(interval);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('focus', onVis);
  };
}

/** Manually clear the "fired today" log — useful for a "test alarm" button. */
export function resetFiredAlarms() {
  saveFired({});
}

// ── Proactive scheduling via Notification Triggers API ───────────────
// This is the ONLY way to get notifications to fire when the PWA is
// completely closed (not just backgrounded). Supported on Chrome / Edge
// Android + desktop. iOS Safari does NOT support it — falls back to the
// catch-up-on-focus mechanism above.
//
// Registers the next occurrence of every enabled alarm as a scheduled
// browser notification. When the time hits, the OS fires it even if no
// browser tab is open. Call this whenever settings change.

declare global {
  interface NotificationOptions { showTrigger?: any }
  interface Window { TimestampTrigger?: any }
}

function nextOccurrence(alarm: ShiftAlarm): number | null {
  if (!alarm.enabled) return null;
  const [h, m] = (alarm.time || '00:00').split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  const now = new Date();
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  // Respect day-of-week filter by rolling forward up to 7 days
  if (alarm.days && alarm.days.length > 0) {
    for (let i = 0; i < 8; i++) {
      if (alarm.days.includes(next.getDay())) break;
      next.setDate(next.getDate() + 1);
    }
  }
  return next.getTime();
}

export async function scheduleUpcomingAlarms(settings: SystemSettings): Promise<{ scheduled: number; supported: boolean }> {
  const hasTrigger = typeof window !== 'undefined' && typeof window.TimestampTrigger !== 'undefined';
  if (!hasTrigger || !('serviceWorker' in navigator) || !('Notification' in window)) {
    return { scheduled: 0, supported: false };
  }
  if (Notification.permission !== 'granted') return { scheduled: 0, supported: true };

  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return { scheduled: 0, supported: true };

  // Cancel previously-scheduled alarm notifications so we don't double up
  try {
    const existing = await reg.getNotifications({ includeTriggered: false } as any);
    for (const n of existing) {
      if (n.tag?.startsWith('scheduled-alarm-')) n.close();
    }
  } catch {}

  const alarms = getActiveAlarms(settings);
  let scheduled = 0;
  for (const alarm of alarms) {
    const fireAt = nextOccurrence(alarm);
    if (!fireAt) continue;
    try {
      const trigger = new window.TimestampTrigger(fireAt);
      await reg.showNotification(`🔔 ${alarm.label}`, {
        body: alarm.clockOut ? 'Shift is ending — wrap up your current task.' : alarm.pauseTimers ? 'Timers will pause until you come back.' : 'Time to take a break.',
        icon: '/icon-192.png',
        badge: '/icon-72.png',
        tag: `scheduled-alarm-${alarm.id}`,
        vibrate: [300, 100, 300, 100, 300],
        requireInteraction: !!alarm.clockOut,
        showTrigger: trigger,
      } as any);
      scheduled++;
    } catch (e) {
      // Some browsers report TimestampTrigger as defined but reject it in
      // showNotification. Silently fall back to catch-up mechanism.
      console.warn('[alarms] scheduleUpcomingAlarms:', e);
    }
  }
  return { scheduled, supported: true };
}
