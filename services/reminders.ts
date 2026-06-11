// ═════════════════════════════════════════════════════════════════════
// Reminders Service — client-side scheduled notifications for workers.
//
// Why this exists: real server-sent push notifications require a backend
// we don't have yet (Firebase Cloud Messaging server, or a Vercel function
// hitting web-push libraries). This file uses the browser's Service Worker
// + setTimeout to fire local notifications while the tab is alive, AND
// registers push subscriptions for the server to hit later.
//
// Use cases built in here:
//   • "Long-timer" check — fires after N hours of a running timer
//   • "Clock-in reminder" — fires at start-of-shift if worker hasn't logged in
//   • "Shift-end reminder" — fires near clock-out time if still running
//
// iOS Safari note: The Service Worker stays alive for ~30s after the tab
// closes. For true background notifications on iOS, users MUST add the PWA
// to their home screen AND grant notification permission. Otherwise the
// reminders only fire while the browser tab/app is open.
// ═════════════════════════════════════════════════════════════════════

import type { TimeLog, User, SystemSettings } from '../types';

/** Show a notification through the Service Worker registration.
 *
 *  IMPORTANT: uses `serviceWorker.ready` (the registration), NOT
 *  `serviceWorker.controller`. After a hard refresh the page loads
 *  UNCONTROLLED — controller is null until the next navigation — which
 *  made notifications silently vanish "sometimes". The registration is
 *  always available once the SW is installed, controller or not.
 *  (The old `new Notification()` fallback also throws "Illegal
 *  constructor" on Android Chrome, so failures were double-swallowed.) */
function swShow(opts: {
  title: string;
  body: string;
  tag: string;
  logId?: string;
  userId?: string;
  actions?: { action: string; title: string }[];
  requireInteraction?: boolean;
  silent?: boolean;
  url?: string;
}) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(opts.title, {
          body: opts.body,
          icon: '/brand/ftio-icon.png',
          badge: '/brand/ftio-icon.png',
          tag: opts.tag,
          data: { url: opts.url || '/', logId: opts.logId, userId: opts.userId },
          vibrate: opts.silent ? [] : [200, 100, 200],
          silent: !!opts.silent,
          requireInteraction: !!opts.requireInteraction,
          actions: opts.actions || [],
        } as any).catch(() => {});
      }).catch(() => {});
      return;
    }
    // No SW support at all (very old browser) — basic notification, no actions
    new Notification(opts.title, { body: opts.body, icon: '/brand/ftio-icon.png', tag: opts.tag });
  } catch {}
}

/** Cancel a notification by tag. */
function swCancel(tag: string) {
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg =>
        reg.getNotifications({ tag }).then(list => list.forEach(n => n.close()))
      ).catch(() => {});
    }
  } catch {}
}

// ── Live-timer badge (Strava / iPhone-timer style) ────────────────
// Shows a persistent notification the moment a timer starts, updates
// elapsed time every 60s while the app is open, and clears it on stop.

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Call immediately after DB.startTimeLog() succeeds. */
export function showTimerStarted(
  log: { id: string; userId: string; operation: string; startTime: number },
  jobLabel: string
) {
  // User just tapped Start while LOOKING at the app — they know the timer is
  // running, no need to notify. The persistent badge appears automatically
  // the moment they background the app (watchLiveTimerBadge visibilitychange).
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
  swShow({
    title: '⏱ Timer Running',
    body: `${jobLabel} · ${log.operation} · 0:00`,
    tag: `live-timer-${log.id}`,
    logId: log.id,
    userId: log.userId,
    requireInteraction: true,
    actions: [
      { action: 'pause', title: '⏸ Pause' },
      { action: 'stop',  title: '⏹ Stop'  },
    ],
    url: '/',
  });
}

/** Call when a timer stops (manual or forced). */
export function cancelTimerNotification(logId: string) {
  swCancel(`live-timer-${logId}`);
}

/**
 * Runs every 60 s while the app is open:
 *  • Replaces the live-timer notification with updated elapsed time
 *  • Swaps Pause ↔ Resume action when the log is paused
 *  • Auto-cancels the notification when a log disappears from activeLogs
 */
export function watchLiveTimerBadge(
  getActiveLogs: () => TimeLog[],
  getJobLabel: (jobId: string) => string
): () => void {
  const knownIds = new Set<string>();

  const tick = (force = false) => {
    const logs = getActiveLogs();
    const now = Date.now();

    // ── While the app is VISIBLE on screen, never re-show the badge ──
    // The user can see the timer in the UI — re-notifying is pure noise
    // (and iOS ignores `silent`, so every update bannered + buzzed).
    // Updates only happen when the app is backgrounded/locked, where the
    // notification is the only way to see the running timer.
    const appVisible = typeof document !== 'undefined' && document.visibilityState === 'visible';

    if (!appVisible || force) {
      logs.forEach(log => {
        knownIds.add(log.id);
        const isPaused = !!log.pausedAt;
        const elapsedMs = isPaused
          ? (log.pausedAt! - log.startTime - (log.totalPausedMs || 0))
          : (now - log.startTime - (log.totalPausedMs || 0));
        swShow({
          title: isPaused ? `⏸ Paused — ${fmtElapsed(elapsedMs)}` : `⏱ ${fmtElapsed(elapsedMs)} — Running`,
          body: `${getJobLabel(log.jobId)} · ${log.operation}`,
          tag: `live-timer-${log.id}`,
          logId: log.id,
          userId: log.userId,
          requireInteraction: false, // don't force dismissal every update
          silent: true,              // update silently — no sound/vibration/popup
          actions: isPaused
            ? [{ action: 'resume', title: '▶ Resume' }, { action: 'stop', title: '⏹ Stop' }]
            : [{ action: 'pause',  title: '⏸ Pause'  }, { action: 'stop', title: '⏹ Stop' }],
          url: '/',
        });
      });
    } else {
      // Still track ids while visible so cleanup below works
      logs.forEach(log => knownIds.add(log.id));
    }

    // Clean up notifications for logs that ended — runs in every state
    knownIds.forEach(id => {
      if (!logs.find(l => l.id === id)) {
        swCancel(`live-timer-${id}`);
        knownIds.delete(id);
      }
    });
  };

  const intervalId = window.setInterval(() => tick(), 5 * 60_000); // every 5 min, background only
  // When the user backgrounds the app, refresh the badge immediately so the
  // notification shows current elapsed time the moment they leave.
  const onVis = () => { if (document.visibilityState === 'hidden') tick(true); };
  document.addEventListener('visibilitychange', onVis);
  tick(); // initial: no-op while visible, shows badge if mounted in background

  return () => {
    window.clearInterval(intervalId);
    document.removeEventListener('visibilitychange', onVis);
    knownIds.forEach(id => swCancel(`live-timer-${id}`));
    knownIds.clear();
  };
}

// ── Long-running timer watcher ─────────────────────────────────────
// Checks every minute: if the active log has been running > threshold hours,
// fire a notification with Pause / Resume action buttons.
const LONG_TIMER_HOURS = 4; // fire when a timer has been running 4+ hours
const firedLongTimerFor = new Set<string>(); // track so we don't spam

export function watchLongRunningTimers(getActiveLogs: () => TimeLog[], thresholdHours = LONG_TIMER_HOURS): () => void {
  const tick = () => {
    const logs = getActiveLogs();
    const now = Date.now();
    logs.forEach(log => {
      if (log.pausedAt) return; // Only notify on actively-running timers
      const elapsedMs = now - log.startTime - (log.totalPausedMs || 0);
      const hrs = elapsedMs / 3600000;
      if (hrs >= thresholdHours && !firedLongTimerFor.has(log.id)) {
        firedLongTimerFor.add(log.id);
        swShow({
          title: `Timer running ${Math.floor(hrs)}h ${Math.round((hrs % 1) * 60)}m`,
          body: `${log.userName} — ${log.operation} is still going. Tap to pause or stop.`,
          tag: `long-timer-${log.id}`,
          logId: log.id,
          requireInteraction: true,
          actions: [
            { action: 'pause', title: '⏸ Pause' },
            { action: 'stop',  title: '⏹ Stop' },
          ],
          url: '/',
        });
      }
      // Clear the flag when log stops
      if (!logs.find(l => l.id === log.id)) {
        firedLongTimerFor.delete(log.id);
      }
    });
    // Clean up flags for stopped logs
    firedLongTimerFor.forEach(id => {
      if (!logs.find(l => l.id === id)) firedLongTimerFor.delete(id);
    });
  };
  const id = window.setInterval(tick, 60_000); // check every minute
  tick(); // fire immediately
  return () => window.clearInterval(id);
}

// ── Morning clock-in reminder ───────────────────────────────────────
// If the worker hasn't started any timer by their usual start time, remind them.
// Default: remind at 8:15 AM if no active timer by then (gives 15 min grace).
// Skips weekends by default.
const CLOCK_IN_HOUR = 8;
const CLOCK_IN_MINUTE = 15;

export function watchClockInReminder(
  user: User | null,
  getActiveLogs: () => TimeLog[],
  opts: { hour?: number; minute?: number; skipWeekends?: boolean } = {}
): () => void {
  const { hour = CLOCK_IN_HOUR, minute = CLOCK_IN_MINUTE, skipWeekends = true } = opts;
  const key = `clockin-reminder-${user?.id}-${new Date().toDateString()}`;

  const tick = () => {
    if (!user || user.role !== 'employee') return;
    try { if (sessionStorage.getItem(key)) return; } catch {}
    const now = new Date();
    if (skipWeekends && (now.getDay() === 0 || now.getDay() === 6)) return;
    if (now.getHours() < hour) return;
    if (now.getHours() === hour && now.getMinutes() < minute) return;
    // Already past clock-in time today. Check if worker has any log today.
    const myLogs = getActiveLogs().filter(l => l.userId === user.id);
    if (myLogs.length > 0) return; // already clocked in
    // Fire the reminder
    swShow({
      title: `Good morning ${user.name.split(' ')[0]} ☕`,
      body: `Don't forget to clock in — start a timer when you begin your first job.`,
      tag: `clock-in-${user.id}`,
      url: '/',
    });
    try { sessionStorage.setItem(key, '1'); } catch {}
  };
  const id = window.setInterval(tick, 5 * 60_000); // check every 5 min
  tick();
  return () => window.clearInterval(id);
}

// ── End-of-shift reminder ────────────────────────────────────────────
// Fires near the auto-clock-out time (default 5:30 PM) if still running.
export function watchEndOfShiftReminder(
  user: User | null,
  getActiveLogs: () => TimeLog[],
  settings: SystemSettings
): () => void {
  const key = `eos-reminder-${user?.id}-${new Date().toDateString()}`;

  const tick = () => {
    if (!user) return;
    try { if (sessionStorage.getItem(key)) return; } catch {}
    const raw = settings.autoClockOutTime || '17:30';
    const [h, m] = raw.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return;
    const now = new Date();
    // Fire 10 min before auto-clockout
    const target = new Date(); target.setHours(h, m - 10, 0, 0);
    if (now < target) return;
    const endTime = new Date(); endTime.setHours(h, m, 0, 0);
    if (now >= endTime) return;
    const myLogs = getActiveLogs().filter(l => l.userId === user.id && !l.endTime);
    if (myLogs.length === 0) return;
    swShow({
      title: `Wrapping up soon ⏰`,
      body: `Your timer is still running. Clock out before ${raw} or it'll auto-stop.`,
      tag: `eos-${user.id}`,
      logId: myLogs[0].id,
      actions: [
        { action: 'stop',  title: '⏹ Stop Timer' },
        { action: 'pause', title: '⏸ Pause' },
      ],
      url: '/',
    });
    try { sessionStorage.setItem(key, '1'); } catch {}
  };
  const id = window.setInterval(tick, 60_000);
  tick();
  return () => window.clearInterval(id);
}
