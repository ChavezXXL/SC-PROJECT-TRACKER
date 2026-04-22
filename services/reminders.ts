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

/** Post a message to the active Service Worker — shows a notification. */
function swShow(opts: {
  title: string;
  body: string;
  tag: string;
  logId?: string;
  actions?: { action: string; title: string }[];
  requireInteraction?: boolean;
  url?: string;
}) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'NOTIFY', ...opts });
    } else {
      // Fallback: plain Notification (no action buttons)
      new Notification(opts.title, {
        body: opts.body,
        icon: '/icon-192.png',
        tag: opts.tag,
      });
    }
  } catch {}
}

/** Cancel a notification by tag. */
function swCancel(tag: string) {
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CANCEL_NOTIFICATION', tag });
    }
  } catch {}
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
