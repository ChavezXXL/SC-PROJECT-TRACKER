// ═════════════════════════════════════════════════════════════════════
// SettingsView — full admin settings surface.
//
// Extracted from App.tsx to keep that file readable. Contains:
//   • Main SettingsView with 8-tab sidebar nav (profile/schedule/production/
//     financial/goals/documents/tv/system)
//   • 18 sub-editors for individual settings domains
//   • All settings-related data wiring (autosave, live TV preview, etc.)
//
// Zero behavior changes from the App.tsx version — purely a file split
// so sections can evolve independently.
// ═════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Activity, AlertCircle, AlertTriangle, Bell, Briefcase, Calculator,
  Calendar, Camera, CheckCircle, CheckCircle2, ChevronDown, ChevronRight,
  ChevronUp, Clock, Cloud, Copy, Edit2, Eye, FileText, Image, Info, Link2, Mail, MapPin, Maximize2,
  MessageSquare, Phone, Play, Plus, Printer, Radio, RotateCcw, Save, Search, Settings, Share2,
  Trash2, Tv, Users, X, Zap,
} from 'lucide-react';

import type {
  Job, TimeLog, SystemSettings, Quote, ShopGoal, GoalMetric,
  GoalPeriod, ProcessTemplate, QuoteSnippet, QuoteTemplate, User, JobStage,
  ShiftAlarm, ShiftAlarmSound, Vendor,
} from '../types';
import * as DB from '../services/mockDb';
import { ShopFlowMap } from '../components/ShopFlowMap';
import { fmtMinutes } from '../utils/jobSteps';
import { OperationsStageMapper } from '../components/OperationsStageMapper';
import { VendorsManager } from '../components/VendorsManager';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/useConfirm';
import { CustomerPortal } from '../CustomerPortal';
import { makeClientSlug, buildPortalUrl } from '../utils/url';
import { parseDueDate } from '../utils/date';
import { VAPID_KEY, vapidKeyToUint8 } from '../utils/vapid';
import { customerKey } from '../utils/customers';
import { computeGoalProgress as computeGoalProgressForGoal, formatGoalValue as formatGoalDisplay } from '../utils/goals';
import { getActiveAlarms, playAlarmSound, alarmDays, alarmOnDay } from '../services/shiftAlarms';
import { isDeveloper } from '../utils/devMode';
import { planSessionQtyBackfill } from '../utils/jobMemory';
import { sendTestEmail, getEmailJsConfig } from '../services/emailNotify';
import { clearAllAlerts } from '../utils/overBudget';
import { getStages, DEFAULT_STAGES } from '../App';
import { buildTravelerBlobUrl, printTraveler } from '../services/travelerPrint';
import { quoteDocument } from '../services/pdfService';
import { sendDailyRecap } from '../utils/sendDailyRecap';
import { Toggle } from '../components/Toggle';
import { TvDisplaySettings } from '../components/TvDisplaySettings';

const STAGE_COLORS = [
  { hex: '#71717a', name: 'Gray' }, { hex: '#3b82f6', name: 'Blue' }, { hex: '#f59e0b', name: 'Amber' },
  { hex: '#8b5cf6', name: 'Purple' }, { hex: '#06b6d4', name: 'Cyan' }, { hex: '#10b981', name: 'Green' },
  { hex: '#ef4444', name: 'Red' }, { hex: '#ec4899', name: 'Pink' }, { hex: '#f97316', name: 'Orange' },
];

/** Log duration in fractional minutes — prefers precise durationSeconds when available. */
const lMs = (l: { durationSeconds?: number | null; durationMinutes?: number | null }) =>
  l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0);

const PushRegistrationPanel = ({ addToast, userId }: { addToast: any; userId?: string }) => {
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);

  // Diagnose environment on mount so we can show what's supported
  const hasSW     = 'serviceWorker' in navigator;
  const hasPush   = 'PushManager' in window;
  const hasNotif  = typeof Notification !== 'undefined';
  const isPWA     = window.matchMedia('(display-mode: standalone)').matches || !!(navigator as any).standalone;
  const notifPerm = hasNotif ? Notification.permission : 'unavailable';

  // Returns true if /.netlify/functions/send-push exists (JSON response). False = endpoint missing
  // (Netlify SPA catch-all returns index.html HTML instead).
  const checkBackend = async (): Promise<boolean> => {
    try {
      const res = await fetch('/.netlify/functions/send-push', { method: 'OPTIONS' });
      const ct = res.headers.get('content-type') || '';
      return res.ok && (ct.includes('json') || ct.includes('text/plain'));
    } catch { return false; }
  };

  const register = async () => {
    setStatus('working');
    setMsg('Checking environment...');
    try {
      if (!hasSW)    throw new Error('Service Worker not available — try Chrome or install to home screen');
      if (!hasPush)  throw new Error('Web Push not available — install the app to your home screen first');
      if (!hasNotif) throw new Error('Notifications not available on this browser');

      setMsg('Requesting permission...');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error(`Permission ${perm} — go to Settings and allow notifications for this app`);

      setMsg('Connecting to service worker...');
      // On iOS, navigator.serviceWorker.ready can hang if a new SW is waiting.
      // Grab the existing registration directly instead.
      let reg: ServiceWorkerRegistration | undefined;
      const regs = await navigator.serviceWorker.getRegistrations();
      reg = regs.find(r => r.active) ?? regs[0];
      if (!reg) {
        // Nothing registered yet — register sw.js then wait
        reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        await new Promise<void>(resolve => {
          if (reg!.active) { resolve(); return; }
          const onState = () => { if (reg!.active) { resolve(); } };
          reg!.addEventListener('updatefound', onState);
          reg!.installing?.addEventListener('statechange', onState);
          setTimeout(resolve, 5000); // fallback
        });
      }
      if (!reg) throw new Error('Could not find or register service worker');

      setMsg('Subscribing to push...');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyToUint8(VAPID_KEY) });

      // Save subscription to Firestore so the server (when configured) can reach this device.
      // This is what matters for "alerts when not on the site" — future server cron pushes here.
      if (userId) {
        setMsg('Saving subscription...');
        try { await DB.savePushSubscription(userId, sub.toJSON()); } catch {}
      }

      // Local test notification via the SW — works right now, no backend required.
      setMsg('Sending test notification...');
      await reg.showNotification('✅ Notifications Active', {
        body: 'This device is subscribed. Server-triggered alerts arrive even when the app is closed.',
        icon: '/icon-192.png',
        badge: '/icon-72.png',
        tag: 'push-registration-test',
        vibrate: [200, 100, 200],
      } as any);

      // Try the real backend — but don't fail registration if it's not deployed yet.
      // The subscription is already saved; the server can use it later.
      const hasBackend = await checkBackend();
      setBackendReachable(hasBackend);

      if (hasBackend) {
        try {
          // The server always sends its own fixed "🚀 Server Push Works" test
          // message — only the subscription goes up.
          const res = await fetch('/.netlify/functions/send-push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription: sub.toJSON() }),
          });
          if (!res.ok) {
            const text = await res.text();
            // Trim HTML bodies so the toast doesn't explode with a raw error page
            const short = text.replace(/<[^>]*>/g, '').slice(0, 120);
            throw new Error(`Server ${res.status}: ${short}`);
          }
        } catch (e: any) {
          // Non-fatal — subscription is saved, local notification fired
          console.warn('[Push] Server test failed:', e);
        }
      }

      setStatus('done');
      setMsg(hasBackend
        ? 'Done! Subscription saved + test notification sent.'
        : 'Subscription saved + local test fired. Server-push endpoint not deployed yet — alerts-when-off-site will start working once /.netlify/functions/send-push is live.'
      );
      addToast('success', '✅ Device registered for notifications');
    } catch (e: any) {
      setStatus('error');
      setMsg(e?.message || 'Unknown error');
      addToast('error', e?.message || 'Registration failed');
    }
  };

  return (
    <div className="bg-zinc-900 border border-white/5 rounded-2xl p-6 space-y-4">
      <h3 className="font-bold text-white flex items-center gap-2"><Bell className="w-4 h-4 text-amber-400" /> Push Notifications</h3>

      {/* Environment check */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {[
          { label: 'Service Worker', ok: hasSW },
          { label: 'Push API', ok: hasPush },
          { label: 'Notifications API', ok: hasNotif },
          { label: 'Installed as App (PWA)', ok: isPWA },
          { label: 'Permission', ok: notifPerm === 'granted', val: notifPerm },
        ].map(({ label, ok, val }) => (
          <div key={label} className={`flex items-center gap-2 px-3 py-2 rounded-lg ${ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
            <span>{ok ? '✅' : '❌'}</span>
            <span>{label}{val ? `: ${val}` : ''}</span>
          </div>
        ))}
      </div>

      {!isPWA && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 text-xs text-yellow-300">
          ⚠️ <strong>iPhone users:</strong> You must add this app to your Home Screen first. In Safari tap <strong>Share → Add to Home Screen</strong>, then open from the icon and come back here.
        </div>
      )}

      {msg && (
        <div className={`text-sm px-3 py-2 rounded-lg break-words ${status === 'error' ? 'bg-red-500/10 text-red-300' : status === 'done' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-blue-500/10 text-blue-300'}`}>
          {status === 'working' && <span className="animate-pulse">⏳ </span>}{msg}
        </div>
      )}

      {status === 'done' && backendReachable === false && (
        <div className="bg-orange-500/10 border border-orange-500/25 rounded-xl p-3 text-xs text-orange-300 space-y-1">
          <p className="font-bold">Heads up — server push endpoint not deployed yet</p>
          <p className="text-orange-300/80 leading-relaxed">
            This device is subscribed, but to receive alerts <strong>when the app is closed</strong> the Netlify function <code className="bg-black/40 px-1 rounded">/.netlify/functions/send-push</code> needs to exist + a scheduled task needs to trigger it. Until then, only the in-app reminders fire (which require the tab to be open).
          </p>
        </div>
      )}

      <button
        onClick={register}
        disabled={status === 'working'}
        className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 disabled:opacity-50 text-white px-5 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow shadow-amber-900/20"
      >
        <Bell className="w-4 h-4" />
        {status === 'working' ? 'Registering...' : status === 'done' ? 'Re-register This Device' : 'Register This Device for Alerts'}
      </button>
    </div>
  );
};

// ── AI HEALTH PANEL — REMOVED ──
// AI PO scanner removed 2026-04-27. The Gemini round-trip checker that lived
// here is gone; if AI features return on a higher tier later, rebuild fresh.

// ── FINANCIAL SETTINGS ──
// Precise computation pulls actual jobs + logs data to show real shop economics,
// not just theoretical values from the rate/overhead inputs.
// ── GOALS SETTINGS ── build customizable shop goals (jobs/week, revenue, on-time, etc.)
const GOAL_METRIC_META: Record<GoalMetric, { label: string; desc: string; icon: string; unit: string; color: ShopGoal['color'] }> = {
  'jobs-completed':   { label: 'Jobs Completed', desc: 'How many jobs finished in the period', icon: '✅', unit: 'jobs', color: 'emerald' },
  'hours-logged':     { label: 'Hours Logged', desc: 'Total worker hours in the period', icon: '⏱️', unit: 'hrs', color: 'blue' },
  'revenue':          { label: 'Revenue', desc: 'Sum of quote amounts on completed jobs', icon: '💰', unit: '$', color: 'amber' },
  'on-time-delivery': { label: 'On-Time Delivery', desc: '% of completed jobs shipped by due date', icon: '🎯', unit: '%', color: 'cyan' },
  'rework-count':     { label: 'Rework Issues', desc: 'Lower is better — keep under target', icon: '🔧', unit: 'issues', color: 'red' },
  'customer-jobs':    { label: 'Customer Jobs', desc: 'Jobs completed for a specific customer', icon: '👥', unit: 'jobs', color: 'purple' },
};

// Shared goal helpers live in utils/goals.ts — used by both Settings editor and TV slide

// ── Shift Alarms editor — fully customizable break + lunch + clock-out alerts.
// Each alarm fires an audible sound + browser notification at its configured time.
// Admin can add as many as needed (morning break, lunch, afternoon break, end-of-shift, etc.)

// Descriptions tell admins what each sound actually sounds like — picked
// for different moods: a dinner bell for lunch, a horn for shift end, etc.
const ALARM_SOUNDS: { value: ShiftAlarmSound; label: string; desc: string }[] = [
  { value: 'bell',      label: '🔔 School Bell',    desc: 'Classic ring-ring-ring — attention grabbing' },
  { value: 'chime',     label: '🎵 Dinner Chime',   desc: 'Three-note cascade — pleasant, says "come eat"' },
  { value: 'triangle',  label: '🔺 Dinner Triangle', desc: 'Soft ding — gentle break reminder' },
  { value: 'ship-bell', label: '⚓ Ship Bell',       desc: 'Warm, low clang — resonant' },
  { value: 'horn',      label: '📯 Air Horn',       desc: 'Factory blast — heard across a loud shop' },
  { value: 'siren',     label: '🚨 Siren',           desc: 'Wailing — urgent, for emergencies only' },
  { value: 'silent',    label: '🔕 Silent',          desc: 'Notification only, no sound' },
];

const DAY_CHIPS: { value: number; label: string }[] = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

const DEFAULT_ALARMS: ShiftAlarm[] = [
  // sendPush:true on every alarm so closed-app phones (especially iOS) still get
  // the alert via server push, not just the in-app bell.
  { id: 'shift-start',     label: 'Clock In Reminder', time: '06:00', enabled: true,  sound: 'bell',     clockIn: true,  sendPush: true },
  { id: 'morning-break',   label: 'Morning Break',     time: '10:00', enabled: false, sound: 'triangle', sendPush: true },
  { id: 'lunch-start',     label: 'Lunch Starts',      time: '12:00', enabled: true,  sound: 'bell',     pauseTimers: true, sendPush: true },
  { id: 'lunch-end',       label: 'Lunch Ends',        time: '12:30', enabled: true,  sound: 'chime',    resumeTimers: true, sendPush: true },
  { id: 'afternoon-break', label: 'Afternoon Break',   time: '14:30', enabled: false, sound: 'triangle', sendPush: true },
  { id: 'shift-end',       label: 'Shift Ends',        time: '16:30', enabled: true,  sound: 'horn',     clockOut: true, sendPush: true },
];

const ShiftAlarmsEditor = ({ settings, setSettings, addToast }: { settings: SystemSettings; setSettings: (s: SystemSettings) => void; addToast: any }) => {
  const { confirm: askConfirm, ConfirmHost } = useConfirm();
  // `!== undefined` (not `.length > 0`): an admin who deletes every alarm should
  // see an empty list, not have the legacy defaults silently resurrected.
  const alarms: ShiftAlarm[] = settings.shiftAlarms !== undefined
    ? settings.shiftAlarms
    : getActiveAlarms(settings); // fall back to legacy fields on first load only

  const update = (idx: number, patch: Partial<ShiftAlarm>) => {
    const next = [...alarms];
    next[idx] = { ...next[idx], ...patch };
    setSettings({ ...settings, shiftAlarms: next });
  };

  const remove = (idx: number) => {
    const next = alarms.filter((_, i) => i !== idx);
    setSettings({ ...settings, shiftAlarms: next });
  };

  const addAlarm = () => {
    const newAlarm: ShiftAlarm = {
      id: `alarm_${Date.now()}`,
      label: 'New Break',
      time: '15:00',
      enabled: true,
      sound: 'bell',
      sendPush: true,
    };
    setSettings({ ...settings, shiftAlarms: [...alarms, newAlarm] });
  };

  const loadDefaults = async () => {
    if (alarms.length > 0) {
      const ok = await askConfirm({
        title: 'Replace alarms with defaults?',
        message: 'This swaps your current alarms for Morning Break, Lunch, Afternoon Break, and Shift End. Custom alarms will be removed.',
        tone: 'warning',
        confirmLabel: 'Replace',
      });
      if (!ok) return;
    }
    setSettings({ ...settings, shiftAlarms: DEFAULT_ALARMS });
  };

  const testAlarm = (alarm: ShiftAlarm) => {
    playAlarmSound(alarm.sound || 'bell', alarm.customSoundUrl, alarm.durationSec);
    addToast('info', `🔔 Testing: ${alarm.label}`);
  };

  const toggleDay = (idx: number, day: number) => {
    // Saved alarms may hold their days as text ("1") — work in numbers, and
    // saving writes numbers back.
    const current = alarmDays(alarms[idx].days);
    const next = current.includes(day) ? current.filter(d => d !== day) : [...current, day];
    update(idx, { days: next });
  };

  const alarmsEnabled = settings.shiftAlarmsEnabled !== false;
  // Auto-request notification permission the moment an admin enables alarms.
  // Without this, alarms ring in-app but never pop up when the PWA is closed.
  const enableAlarms = async (on: boolean) => {
    if (on && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try {
        const result = await Notification.requestPermission();
        if (result !== 'granted') {
          addToast('info', 'Tip: allow notifications so alarms work when the app is closed');
        }
      } catch {}
    }
    setSettings({ ...settings, shiftAlarmsEnabled: on });
  };

  return (
    <div className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden">
      {/* Master switch */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
        <div className="min-w-0">
          <p className="text-sm font-bold text-white flex items-center gap-2">
            <span className="text-base">🔔</span> Break & Shift Alarms
          </p>
          <p className="text-[11px] text-zinc-500 mt-0.5">Audible alerts at lunch, breaks, and end-of-shift</p>
          {alarmsEnabled && typeof Notification !== 'undefined' && Notification.permission !== 'granted' && (
            <p className="text-[10px] text-amber-400 mt-1 font-bold">⚠ Allow notifications so alarms work when the app is closed</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[10px] font-bold uppercase tracking-widest ${alarmsEnabled ? 'text-emerald-400' : 'text-zinc-600'}`}>{alarmsEnabled ? 'On' : 'Off'}</span>
          <Toggle checked={alarmsEnabled} onChange={enableAlarms} />
        </div>
      </div>

      <div className={`px-4 py-3 space-y-2 ${!alarmsEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
        {alarms.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/10 p-6 text-center">
            <p className="text-sm text-zinc-400 font-bold">No alarms set up yet</p>
            <p className="text-[11px] text-zinc-600 mt-1">Click "Load Defaults" below for typical shop schedules — or add one custom.</p>
          </div>
        )}

        {alarms.map((alarm, idx) => (
          <div key={alarm.id} className={`rounded-xl border p-3 transition-colors ${alarm.enabled ? 'border-white/10 bg-zinc-800/30' : 'border-white/5 bg-zinc-900/40 opacity-70'}`}>
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              {/* Enabled toggle */}
              <Toggle checked={alarm.enabled} onChange={v => update(idx, { enabled: v })} label={`Alarm on: ${alarm.label}`} />

              {/* Label */}
              <input
                type="text"
                value={alarm.label}
                onChange={e => update(idx, { label: e.target.value })}
                placeholder="Label (e.g. Coffee Break)"
                className="flex-1 min-w-0 bg-zinc-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-sm text-white font-bold"
              />

              {/* Time */}
              <input
                type="time"
                value={alarm.time}
                onChange={e => update(idx, { time: e.target.value })}
                aria-label={`Time for ${alarm.label}`}
                className="bg-zinc-950 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white tabular w-28 shrink-0"
              />

              {/* Sound */}
              <select
                value={alarm.sound || 'bell'}
                onChange={e => update(idx, { sound: e.target.value as ShiftAlarmSound })}
                aria-label={`Sound for ${alarm.label}`}
                className="bg-zinc-950 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white shrink-0"
              >
                {ALARM_SOUNDS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>

              {/* Test */}
              <button
                type="button"
                onClick={() => testAlarm(alarm)}
                title="Play this alarm sound now"
                className="shrink-0 p-1.5 rounded-lg text-amber-400 hover:bg-amber-500/10 hover:text-white"
                aria-label={`Test ${alarm.label} sound`}
              >
                <Play className="w-3.5 h-3.5" aria-hidden="true" />
              </button>

              {/* Delete */}
              <button
                type="button"
                onClick={() => remove(idx)}
                title="Remove this alarm"
                className="shrink-0 p-1.5 rounded-lg text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
                aria-label={`Remove ${alarm.label}`}
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>

            {/* Day chips + behavior toggles — expandable detail row */}
            <div className="mt-2 pl-6 flex items-center gap-2 flex-wrap">
              <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Days</span>
              {DAY_CHIPS.map(d => {
                const active = alarmOnDay(alarm.days, d.value);
                const allDays = alarmDays(alarm.days).length === 0;
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => toggleDay(idx, d.value)}
                    aria-pressed={active}
                    className={`text-[9px] font-black px-1.5 py-0.5 rounded transition-colors ${active ? (allDays ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/15 text-amber-400 border border-amber-500/30') : 'bg-zinc-900 text-zinc-600 border border-white/5 hover:text-white'}`}
                    title={allDays ? 'Every day' : undefined}
                  >
                    {d.label}
                  </button>
                );
              })}
              <span className="w-px h-3 bg-white/10" />
              <label className="flex items-center gap-1.5 min-h-[32px] text-[11px] text-zinc-500 cursor-pointer" title="Pause all running timers when this alarm fires (lunch start)">
                <input type="checkbox" checked={!!alarm.pauseTimers} onChange={e => update(idx, { pauseTimers: e.target.checked })} className="w-4 h-4 rounded accent-amber-500" />
                Pause timers
              </label>
              <label className="flex items-center gap-1.5 min-h-[32px] text-[11px] text-zinc-500 cursor-pointer" title="Resume timers that were auto-paused for lunch (lunch end). Pair this with a 'Pause timers' alarm.">
                <input type="checkbox" checked={!!alarm.resumeTimers} onChange={e => update(idx, { resumeTimers: e.target.checked })} className="w-4 h-4 rounded accent-blue-500" />
                Resume timers
              </label>
              <label className="flex items-center gap-1.5 min-h-[32px] text-[11px] text-zinc-500 cursor-pointer" title="Auto-clocks out all running workers at this time (handled server-side every few minutes; each open device also ends its own timer immediately)">
                <input type="checkbox" checked={!!alarm.clockOut} onChange={e => update(idx, { clockOut: e.target.checked })} className="w-4 h-4 rounded accent-red-500" />
                Clock out
              </label>
              <label className="flex items-center gap-1.5 min-h-[32px] text-[11px] cursor-pointer font-bold" title="Send a push notification to every worker's phone/device at this time — works even when the app is closed">
                <input type="checkbox" checked={!!alarm.sendPush} onChange={e => update(idx, { sendPush: e.target.checked })} className="w-4 h-4 rounded accent-emerald-500" />
                <span className={alarm.sendPush ? 'text-emerald-400' : 'text-zinc-500'}>📲 Push all workers</span>
              </label>
            </div>

            {/* Duration — how long the alarm rings. Short audio files loop. */}
            <div className="mt-2 pl-6 flex items-center gap-3">
              <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest shrink-0">Ring for</span>
              <input
                type="range"
                min={1}
                max={30}
                step={1}
                value={alarm.durationSec ?? 3}
                onChange={e => update(idx, { durationSec: Number(e.target.value) })}
                className="flex-1 accent-blue-500 max-w-[200px]"
                aria-label={`Alarm duration in seconds for ${alarm.label}`}
              />
              <span className="text-[11px] font-black text-white tabular w-12 text-right">{alarm.durationSec ?? 3}s</span>
            </div>

            {/* Custom sound URL — collapsed by default. Admin can paste an MP3/OGG
                link from anywhere (freesound.org, mixkit.co, their own server). */}
            <details className="mt-2 pl-6 group">
              <summary className="cursor-pointer text-[10px] font-black text-zinc-600 uppercase tracking-widest hover:text-zinc-400 flex items-center gap-1 select-none">
                <ChevronRight className="w-2.5 h-2.5 group-open:rotate-90 transition-transform" />
                Custom Sound URL
                {alarm.customSoundUrl && <span className="text-[9px] font-bold text-emerald-400 normal-case tracking-normal bg-emerald-500/10 border border-emerald-500/25 rounded px-1 py-0.5 ml-1">✓ Set</span>}
              </summary>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="url"
                  placeholder="https://... link to MP3/OGG (optional)"
                  value={alarm.customSoundUrl || ''}
                  onChange={e => update(idx, { customSoundUrl: e.target.value || undefined })}
                  className="flex-1 bg-zinc-950 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white"
                />
                {alarm.customSoundUrl && (
                  <button
                    type="button"
                    onClick={() => update(idx, { customSoundUrl: undefined })}
                    className="text-[10px] text-zinc-500 hover:text-red-400 font-bold"
                  >
                    Clear
                  </button>
                )}
              </div>
              <p className="text-[9px] text-zinc-600 mt-1 leading-relaxed">
                Overrides the built-in sound. Works with any direct MP3/OGG URL — grab one from{' '}
                <a href="https://pixabay.com/sound-effects/search/lunch%20bell/" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">Pixabay</a>
                {' · '}
                <a href="https://mixkit.co/free-sound-effects/bell/" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">Mixkit</a>
                {' · '}
                <a href="https://freesound.org/search/?q=factory+bell" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">Freesound</a>
              </p>
            </details>
          </div>
        ))}

        {/* Add + Defaults */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={addAlarm}
            className="flex-1 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white text-xs font-bold py-2 rounded-lg transition-all flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add Alarm
          </button>
          <button
            type="button"
            onClick={loadDefaults}
            className="text-xs text-zinc-500 hover:text-white px-3 py-2 rounded-lg hover:bg-white/5 transition-colors font-bold"
          >
            ↻ Load Defaults
          </button>
        </div>
      </div>
      {ConfirmHost}
    </div>
  );
};

const GoalsSettings = ({ settings, setSettings }: { settings: SystemSettings; setSettings: React.Dispatch<React.SetStateAction<SystemSettings>> }) => {
  const goals = settings.shopGoals || [];
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { confirm: askConfirm, ConfirmHost } = useConfirm();
  // Subscribe to live data so the progress bar on each goal row is always current
  const [gJobs, setGJobs] = useState<Job[]>([]);
  const [gLogs, setGLogs] = useState<TimeLog[]>([]);
  const [gReworkOpen, setGReworkOpen] = useState(0);
  useEffect(() => {
    const u1 = DB.subscribeJobs(setGJobs);
    const u2 = DB.subscribeLogs(setGLogs);
    const subRework = (DB as any).subscribeRework;
    const u3 = typeof subRework === 'function'
      ? subRework((entries: any[]) => setGReworkOpen((entries || []).filter((r: any) => r.status === 'open' || r.status === 'in-rework').length))
      : () => {};
    return () => { u1(); u2(); u3(); };
  }, []);

  const update = (idx: number, patch: Partial<ShopGoal>) => {
    const next = [...goals];
    next[idx] = { ...next[idx], ...patch };
    setSettings({ ...settings, shopGoals: next });
  };
  const remove = async (idx: number) => {
    const goal = goals[idx];
    const ok = await askConfirm({
      title: `Delete goal "${goal?.label || 'Untitled'}"?`,
      message: goal?.showOnTv !== false
        ? 'This goal is shown on the TV display — deleting it removes it from all displays.'
        : 'This goal will be permanently removed.',
      tone: 'warning',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    // On the latest settings, matched by the goal itself (not its position):
    // a list changed while this dialog was open lost the wrong one.
    setSettings(prev => ({ ...prev, shopGoals: (prev.shopGoals || []).filter(g => !(g.id && goal?.id ? g.id === goal.id : JSON.stringify(g) === JSON.stringify(goal))) }));
  };
  const add = (metric: GoalMetric) => {
    const meta = GOAL_METRIC_META[metric];
    const defaults: Record<GoalMetric, { label: string; target: number; period: GoalPeriod }> = {
      'jobs-completed':   { label: 'Jobs Completed This Week', target: 20, period: 'week' },
      'hours-logged':     { label: 'Hours Logged This Week', target: 160, period: 'week' },
      'revenue':          { label: 'Monthly Revenue Goal', target: 50000, period: 'month' },
      'on-time-delivery': { label: 'On-Time Delivery', target: 95, period: 'month' },
      'rework-count':     { label: 'Keep Rework Low', target: 2, period: 'week' },
      'customer-jobs':    { label: 'Top Customer Jobs This Month', target: 10, period: 'month' },
    };
    const d = defaults[metric];
    const newGoal: ShopGoal = {
      id: `goal_${Date.now()}`,
      label: d.label,
      metric,
      period: d.period,
      target: d.target,
      unit: meta.unit,
      color: meta.color,
      lowerIsBetter: metric === 'rework-count',
      enabled: true,
      showOnTv: true,
      showOnDashboard: true,
    };
    setSettings({ ...settings, shopGoals: [...goals, newGoal] });
    setPickerOpen(false);
    setExpandedId(newGoal.id);
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div data-settings-anchor="goals-overview" className="rounded-xl">
        <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2"><Zap className="w-5 h-5 text-amber-400" aria-hidden="true" /> Shop Goals</h3>
        <p className="text-sm text-zinc-500">Set targets that matter to <em>your</em> shop — jobs per week, revenue, on-time delivery, rework limits, or custom metrics. Shown on the TV Goals slide and admin dashboard.</p>
      </div>

      {/* Add goal picker */}
      <div>
        <button
          type="button"
          onClick={() => setPickerOpen(!pickerOpen)}
          className="w-full sm:w-auto bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-sm font-bold px-4 py-2.5 rounded-xl transition-colors flex items-center gap-2 shadow-lg shadow-emerald-900/30"
        >
          <Plus className="w-4 h-4" aria-hidden="true" /> Add Goal {pickerOpen ? '▲' : '▼'}
        </button>
        {pickerOpen && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 bg-zinc-900/50 border border-white/5 rounded-2xl animate-fade-in">
            {(Object.keys(GOAL_METRIC_META) as GoalMetric[]).map(m => {
              const meta = GOAL_METRIC_META[m];
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => add(m)}
                  className="text-left px-3 py-3 rounded-xl border border-white/5 bg-zinc-950/40 hover:bg-zinc-800/60 hover:border-white/15 transition-all flex items-start gap-3"
                >
                  <span className="text-2xl shrink-0" aria-hidden="true">{meta.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white">{meta.label}</p>
                    <p className="text-xs text-zinc-500 mt-0.5 leading-snug">{meta.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Goals list */}
      {goals.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-white/10 p-6 space-y-4">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-3">
              <Zap className="w-8 h-8 text-emerald-400" aria-hidden="true" />
            </div>
            <p className="text-base font-bold text-white">No goals yet — pick a quick-start pack or build your own</p>
            <p className="text-sm text-zinc-500 mt-1">Every shop is different. You can always edit or delete these later.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                const pack: ShopGoal[] = [
                  { id: `g_${Date.now()}_1`, label: 'Jobs Completed This Week', metric: 'jobs-completed', period: 'week', target: 20, unit: 'jobs', color: 'emerald', enabled: true, showOnTv: true, showOnDashboard: true },
                  { id: `g_${Date.now()}_2`, label: 'On-Time Delivery', metric: 'on-time-delivery', period: 'month', target: 95, unit: '%', color: 'cyan', enabled: true, showOnTv: true, showOnDashboard: true },
                  { id: `g_${Date.now()}_3`, label: 'Keep Rework Under', metric: 'rework-count', period: 'week', target: 3, unit: 'issues', color: 'red', lowerIsBetter: true, enabled: true, showOnTv: true, showOnDashboard: true },
                ];
                setSettings({ ...settings, shopGoals: pack });
              }}
              className="text-left px-4 py-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 hover:bg-emerald-500/10 transition-all"
            >
              <p className="text-sm font-bold text-emerald-400 flex items-center gap-2">🏭 Production Shop</p>
              <p className="text-xs text-zinc-400 mt-1">Jobs/week · On-time % · Rework</p>
            </button>
            <button
              type="button"
              onClick={() => {
                const pack: ShopGoal[] = [
                  { id: `g_${Date.now()}_1`, label: 'Monthly Revenue', metric: 'revenue', period: 'month', target: 50000, unit: '$', color: 'amber', enabled: true, showOnTv: true, showOnDashboard: true },
                  { id: `g_${Date.now()}_2`, label: 'Weekly Hours Billed', metric: 'hours-logged', period: 'week', target: 160, unit: 'hrs', color: 'blue', enabled: true, showOnTv: true, showOnDashboard: true },
                  { id: `g_${Date.now()}_3`, label: 'Jobs Shipped / Month', metric: 'jobs-completed', period: 'month', target: 60, unit: 'jobs', color: 'emerald', enabled: true, showOnTv: true, showOnDashboard: true },
                ];
                setSettings({ ...settings, shopGoals: pack });
              }}
              className="text-left px-4 py-3 rounded-xl border border-amber-500/25 bg-amber-500/5 hover:bg-amber-500/10 transition-all"
            >
              <p className="text-sm font-bold text-amber-400 flex items-center gap-2">💰 Revenue-Focused</p>
              <p className="text-xs text-zinc-400 mt-1">Revenue · Hours billed · Shipments</p>
            </button>
          </div>
          <p className="text-[10px] text-zinc-600 text-center">or use <strong className="text-zinc-400">+ Add Goal</strong> above to build from scratch</p>
        </div>
      )}

      <div data-settings-anchor="goals-list" className="space-y-3 rounded-2xl">
        {goals.map((goal, idx) => {
          const meta = GOAL_METRIC_META[goal.metric];
          const expanded = expandedId === goal.id;
          const { current, pct } = computeGoalProgressForGoal(goal, gJobs, gLogs, gReworkOpen);
          const achieved = goal.lowerIsBetter ? current <= goal.target : current >= goal.target;
          const colorMap: Record<string, string> = {
            blue: 'from-blue-500 to-indigo-500',
            emerald: 'from-emerald-500 to-teal-500',
            amber: 'from-amber-500 to-orange-500',
            purple: 'from-purple-500 to-pink-500',
            red: 'from-red-500 to-rose-500',
            cyan: 'from-cyan-500 to-sky-500',
          };
          const barGrad = colorMap[goal.color || 'blue'];
          return (
            <div key={goal.id} className={`border rounded-2xl overflow-hidden transition-all ${goal.enabled ? 'border-white/10 bg-zinc-900/50' : 'border-white/5 bg-zinc-950/40 opacity-60'}`}>
              <div className="p-4 flex items-center gap-3">
                <span className="text-2xl shrink-0" aria-hidden="true">{meta.icon}</span>
                <button type="button" onClick={() => setExpandedId(expanded ? null : goal.id)} className="flex-1 text-left min-w-0">
                  <p className="text-sm font-bold text-white truncate">{goal.label}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Target: <strong className="text-zinc-300">{goal.target} {goal.unit || meta.unit}</strong> · per <strong className="text-zinc-300">{goal.period}</strong>
                    {goal.lowerIsBetter && <span className="text-amber-400/80 ml-1">(lower is better)</span>}
                  </p>
                </button>
                {/* Live progress pill — mini visualization of current state */}
                {goal.enabled && (
                  <div className="hidden sm:flex flex-col items-end gap-1 shrink-0 w-28">
                    <div className="flex items-baseline gap-1 text-xs">
                      <span className={`font-black tabular ${achieved ? 'text-emerald-400' : 'text-white'}`}>{formatGoalDisplay(goal, current)}</span>
                      <span className="text-zinc-600">/ {formatGoalDisplay(goal, goal.target)}</span>
                    </div>
                    <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full bg-gradient-to-r ${barGrad} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                    {achieved ? (
                      <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">✓ Hit</span>
                    ) : (
                      <span className="text-[9px] text-zinc-500 tabular">{Math.round(pct)}%</span>
                    )}
                  </div>
                )}
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-zinc-500 shrink-0 cursor-pointer">
                  <input type="checkbox" checked={goal.showOnTv !== false} onChange={e => update(idx, { showOnTv: e.target.checked })} className="w-4 h-4 rounded accent-amber-500" aria-label="Show on TV" /> TV
                </label>
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-zinc-500 shrink-0 cursor-pointer">
                  <input type="checkbox" checked={goal.enabled} onChange={e => update(idx, { enabled: e.target.checked })} className="w-4 h-4 rounded accent-amber-500" aria-label="Enabled" /> Active
                </label>
                <button type="button" onClick={() => remove(idx)} aria-label="Delete goal" className="text-zinc-600 hover:text-red-400 shrink-0 p-1"><Trash2 className="w-4 h-4" aria-hidden="true" /></button>
              </div>
              {/* Mobile progress bar — full-width, shown below header on small screens */}
              {goal.enabled && (
                <div className="sm:hidden px-4 pb-3 -mt-2">
                  <div className="flex items-baseline gap-2 mb-1 text-xs">
                    <span className={`font-black tabular ${achieved ? 'text-emerald-400' : 'text-white'}`}>{formatGoalDisplay(goal, current)}</span>
                    <span className="text-zinc-600">/ {formatGoalDisplay(goal, goal.target)} {goal.unit || meta.unit}</span>
                    <span className="ml-auto text-[10px] text-zinc-500 tabular">{achieved ? '✓ Hit' : `${Math.round(pct)}%`}</span>
                  </div>
                  <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full bg-gradient-to-r ${barGrad} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )}
              {expanded && (
                <div className="border-t border-white/5 bg-zinc-950/60 p-4 space-y-3">
                  <div>
                    <label className="text-[10px] text-zinc-500 block mb-1 font-black uppercase tracking-widest">Display Name</label>
                    <input className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-amber-500/50 focus:outline-none" value={goal.label} onChange={e => update(idx, { label: e.target.value })} />
                    <p className="text-[10px] text-zinc-600 mt-1">What the TV shows as the goal name.</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] text-zinc-500 block mb-1 font-black uppercase tracking-widest">Target</label>
                      <input type="number" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-amber-500/50 focus:outline-none" value={goal.target} onChange={e => update(idx, { target: Number(e.target.value) || 0 })} />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 block mb-1 font-black uppercase tracking-widest">Unit</label>
                      <input className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-amber-500/50 focus:outline-none" value={goal.unit || meta.unit} onChange={e => update(idx, { unit: e.target.value })} placeholder={meta.unit} />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 block mb-1 font-black uppercase tracking-widest">Period</label>
                      <select className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-amber-500/50 focus:outline-none" value={goal.period} onChange={e => update(idx, { period: e.target.value as GoalPeriod })}>
                        {(['day','week','month','quarter','year'] as GoalPeriod[]).map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 block mb-1 font-black uppercase tracking-widest">Color Accent</label>
                    <div className="flex gap-1.5 flex-wrap">
                      {(['blue','emerald','amber','purple','red','cyan'] as const).map(c => {
                        const bg = { blue: 'bg-blue-500', emerald: 'bg-emerald-500', amber: 'bg-amber-500', purple: 'bg-purple-500', red: 'bg-red-500', cyan: 'bg-cyan-500' }[c];
                        return (
                          <button key={c} type="button" onClick={() => update(idx, { color: c })} aria-label={c} className={`w-8 h-8 rounded-lg ${bg} transition-all ${(goal.color || 'blue') === c ? 'ring-2 ring-white scale-110' : 'opacity-40 hover:opacity-80'}`} />
                        );
                      })}
                    </div>
                  </div>
                  {goal.metric === 'customer-jobs' && (
                    <div>
                      <label className="text-[10px] text-zinc-500 block mb-1 font-black uppercase tracking-widest">Customer Filter</label>
                      <input className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-amber-500/50 focus:outline-none" value={goal.customerFilter || ''} onChange={e => update(idx, { customerFilter: e.target.value })} placeholder="e.g. PAMCO" list="goal-customers" />
                      <datalist id="goal-customers">
                        {(settings.clients || []).map(c => <option key={c} value={c} />)}
                      </datalist>
                    </div>
                  )}
                  <div className="flex items-center justify-between py-1 gap-3">
                    <span className="text-xs text-zinc-400"><strong className="text-white">Lower is better</strong> — treat the target as a ceiling instead of a floor</span>
                    <Toggle checked={!!goal.lowerIsBetter} onChange={v => update(idx, { lowerIsBetter: v })} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {ConfirmHost}
    </div>
  );
};

const FinancialSettings = ({ settings, setSettings }: { settings: SystemSettings; setSettings: (s: SystemSettings) => void }) => {
  const [allJobs, setAllJobs] = useState<Job[]>([]);
  const [allLogs, setAllLogs] = useState<TimeLog[]>([]);
  const [workers, setWorkers] = useState<User[]>([]);

  useEffect(() => {
    const u1 = DB.subscribeJobs(setAllJobs);
    const u2 = DB.subscribeLogs(setAllLogs);
    const u3 = DB.subscribeUsers(setWorkers);
    return () => { u1(); u2(); u3(); };
  }, []);

  const shopRate = settings.shopRate || 0;
  const monthlyOverhead = settings.monthlyOverhead || 0;
  const monthlyHours = settings.monthlyWorkHours || 160;
  const ohRate = monthlyHours > 0 ? monthlyOverhead / monthlyHours : 0;
  const trueCost = shopRate + ohRate;

  // Real-data calculations — last 30 days
  const thirtyDaysAgo = Date.now() - 30 * 86400000;
  const completedRecent = allJobs.filter(j => j.status === 'completed' && j.completedAt && j.completedAt >= thirtyDaysAgo);
  const loggedMins30 = allLogs.filter(l => l.startTime >= thirtyDaysAgo && l.endTime).reduce((a, l) => a + (lMs(l)), 0);
  const loggedHrs30 = loggedMins30 / 60;

  // Revenue from completed jobs' quoteAmount
  const revenue30 = completedRecent.reduce((a, j) => a + (j.quoteAmount || 0), 0);
  const jobsWithQuote = completedRecent.filter(j => (j.quoteAmount || 0) > 0);

  // Labor cost using each worker's hourlyRate (fallback to shopRate)
  const laborCost30 = allLogs.filter(l => l.startTime >= thirtyDaysAgo && l.endTime).reduce((acc, l) => {
    const w = workers.find(w => w.id === l.userId);
    const r = w?.hourlyRate || shopRate;
    return acc + ((lMs(l)) / 60) * r;
  }, 0);
  const overheadCost30 = loggedHrs30 * ohRate;
  const totalCost30 = laborCost30 + overheadCost30;
  const grossProfit30 = revenue30 - totalCost30;
  const marginPct = revenue30 > 0 ? (grossProfit30 / revenue30) * 100 : 0;

  // Break-even: hours needed per month to cover overhead at current avg margin
  const avgJobMargin = jobsWithQuote.length > 0
    ? jobsWithQuote.reduce((acc, j) => {
        const logs = allLogs.filter(l => l.jobId === j.id);
        const mins = logs.reduce((a, l) => a + (lMs(l)), 0);
        const cost = (mins / 60) * trueCost;
        return acc + ((j.quoteAmount || 0) - cost);
      }, 0) / jobsWithQuote.length
    : 0;
  const breakEvenHours = avgJobMargin > 0 && ohRate > 0 ? monthlyOverhead / (avgJobMargin / (completedRecent.length > 0 ? loggedHrs30 / completedRecent.length : 1)) : null;

  const fmtCurrency = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2"><Calculator className="w-5 h-5 text-emerald-400" aria-hidden="true" /> Financial</h3>
        <p className="text-sm text-zinc-500">Shop rates, overhead, and real-world margins pulled from your actual job data.</p>
      </div>

      {/* ── LIVE SHOP ECONOMICS (last 30 days) — real data */}
      <div data-settings-anchor="financial-live" className="rounded-xl">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-black text-zinc-500 uppercase tracking-widest">Live · Last 30 Days</p>
          <span className="text-[10px] text-zinc-600">{completedRecent.length} jobs · {loggedHrs30.toFixed(1)}h logged</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="card-shine bg-gradient-to-br from-emerald-500/10 to-emerald-500/[0.02] border border-emerald-500/20 rounded-xl p-4">
            <div className="flex items-center gap-1.5 mb-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /><p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Revenue</p></div>
            <p className="text-xl sm:text-2xl font-black text-white tabular">{fmtCurrency(revenue30)}</p>
            <p className="text-[10px] text-zinc-500 mt-1">{jobsWithQuote.length} job{jobsWithQuote.length !== 1 ? 's' : ''} w/ quote</p>
          </div>
          <div className="card-shine bg-zinc-900/50 border border-white/5 rounded-xl p-4">
            <div className="flex items-center gap-1.5 mb-1"><span className="w-1.5 h-1.5 rounded-full bg-red-400" /><p className="text-[10px] font-black text-red-400 uppercase tracking-widest">Total Cost</p></div>
            <p className="text-xl sm:text-2xl font-black text-white tabular">{fmtCurrency(totalCost30)}</p>
            <p className="text-[10px] text-zinc-500 mt-1">{fmtCurrency(laborCost30)} labor + {fmtCurrency(overheadCost30)} OH</p>
          </div>
          <div className={`card-shine border rounded-xl p-4 ${grossProfit30 >= 0 ? 'bg-gradient-to-br from-emerald-500/10 to-emerald-500/[0.02] border-emerald-500/20' : 'bg-gradient-to-br from-red-500/10 to-red-500/[0.02] border-red-500/30'}`}>
            <div className="flex items-center gap-1.5 mb-1"><span className={`w-1.5 h-1.5 rounded-full ${grossProfit30 >= 0 ? 'bg-emerald-400' : 'bg-red-400'}`} /><p className={`text-[10px] font-black uppercase tracking-widest ${grossProfit30 >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>Gross Profit</p></div>
            <p className={`text-xl sm:text-2xl font-black tabular ${grossProfit30 >= 0 ? 'text-white' : 'text-red-300'}`}>{grossProfit30 < 0 ? '-' : ''}{fmtCurrency(Math.abs(grossProfit30))}</p>
            <p className="text-[10px] text-zinc-500 mt-1">on completed jobs</p>
          </div>
          <div className="card-shine bg-zinc-900/50 border border-white/5 rounded-xl p-4">
            <div className="flex items-center gap-1.5 mb-1"><span className={`w-1.5 h-1.5 rounded-full ${marginPct >= 20 ? 'bg-emerald-400' : marginPct >= 10 ? 'bg-yellow-400' : 'bg-red-400'}`} /><p className={`text-[10px] font-black uppercase tracking-widest ${marginPct >= 20 ? 'text-emerald-400' : marginPct >= 10 ? 'text-yellow-400' : 'text-red-400'}`}>Margin</p></div>
            <p className="text-xl sm:text-2xl font-black text-white tabular">{marginPct.toFixed(1)}%</p>
            <p className="text-[10px] text-zinc-500 mt-1">{marginPct >= 30 ? '💪 healthy' : marginPct >= 15 ? 'ok' : marginPct >= 0 ? '⚠ thin' : '🚨 losing money'}</p>
          </div>
        </div>
        {revenue30 === 0 && (
          <p className="text-[10px] text-zinc-600 italic mt-2">Tip: set <strong className="text-zinc-400">Quote Amount</strong> on completed jobs (job edit modal) so these numbers populate.</p>
        )}
      </div>

      {/* ── RATE & OVERHEAD INPUTS */}
      <div data-settings-anchor="financial-rates" className="rounded-xl">
        <p className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-3">Shop Rates</p>
        <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-zinc-500 block mb-1 font-bold uppercase tracking-widest">Fallback Rate</label>
              <div className="relative"><span className="absolute left-3 top-2 text-zinc-500 text-sm">$</span><input type="number" step="0.01" className="w-full bg-zinc-950 border border-white/10 rounded-lg py-2 pl-6 pr-10 text-white text-sm font-mono focus:border-amber-500/50 focus:outline-none" value={settings.shopRate ?? ''} onChange={e => setSettings({ ...settings, shopRate: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="21" /><span className="absolute right-3 top-2 text-zinc-600 text-xs">/hr</span></div>
              <p className="text-[10px] text-zinc-600 mt-1">Used when a worker has no individual rate.</p>
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 block mb-1 font-bold uppercase tracking-widest">Monthly Overhead</label>
              <div className="relative"><span className="absolute left-3 top-2 text-zinc-500 text-sm">$</span><input type="number" step="0.01" className="w-full bg-zinc-950 border border-white/10 rounded-lg py-2 pl-6 pr-10 text-white text-sm font-mono focus:border-amber-500/50 focus:outline-none" value={settings.monthlyOverhead ?? ''} onChange={e => setSettings({ ...settings, monthlyOverhead: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="5000" /><span className="absolute right-3 top-2 text-zinc-600 text-xs">/mo</span></div>
              <p className="text-[10px] text-zinc-600 mt-1">Rent, utilities, insurance, software, etc.</p>
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 block mb-1 font-bold uppercase tracking-widest">Productive Hours</label>
              <div className="relative"><input type="number" className="w-full bg-zinc-950 border border-white/10 rounded-lg py-2 px-3 pr-10 text-white text-sm font-mono focus:border-amber-500/50 focus:outline-none" value={settings.monthlyWorkHours ?? ''} onChange={e => setSettings({ ...settings, monthlyWorkHours: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="160" /><span className="absolute right-3 top-2 text-zinc-600 text-xs">/mo</span></div>
              <p className="text-[10px] text-zinc-600 mt-1">Billable hours per month per worker.</p>
            </div>
          </div>
          {/* Monthly Revenue Goal */}
          <div>
            <label className="text-[10px] text-zinc-500 block mb-1 font-bold uppercase tracking-widest">Monthly Revenue Goal</label>
            <div className="relative max-w-xs">
              <span className="absolute left-3 top-2 text-zinc-500 text-sm">$</span>
              <input type="number" className="w-full bg-zinc-950 border border-white/10 rounded-lg py-2 px-3 pl-7 text-white text-sm font-mono focus:border-amber-500/50 focus:outline-none" value={settings.monthlyRevenueGoal ?? ''} onChange={e => setSettings({ ...settings, monthlyRevenueGoal: Number(e.target.value) || undefined })} placeholder="e.g. 25000" />
            </div>
            <p className="text-[10px] text-zinc-600 mt-1">Shows a progress bar on the Dashboard — how close you are to hitting your monthly target.</p>
          </div>

          {trueCost > 0 && (
            <div className="bg-gradient-to-br from-zinc-800/70 to-zinc-800/30 border border-white/5 rounded-xl p-4">
              <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-3">True Hourly Cost (calculated)</p>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div><p className="text-[10px] text-zinc-500">Labor</p><p className="text-lg font-black text-white tabular mt-0.5">${shopRate.toFixed(2)}</p></div>
                <div className="text-zinc-600 self-center text-xl">+</div>
                <div><p className="text-[10px] text-zinc-500">Overhead</p><p className="text-lg font-black text-yellow-400 tabular mt-0.5">${ohRate.toFixed(2)}</p></div>
              </div>
              <div className="border-t border-white/10 mt-3 pt-3 text-center">
                <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest">Every hour costs</p>
                <p className="text-3xl font-black text-emerald-400 tabular mt-1">${trueCost.toFixed(2)}</p>
                <p className="text-[10px] text-zinc-600 mt-1">Quote at ≥ ${(trueCost * 1.3).toFixed(2)}/hr for 30% margin · ≥ ${(trueCost * 1.5).toFixed(2)}/hr for 50%</p>
              </div>
            </div>
          )}
          {workers.length > 0 && (
            <div className="rounded-lg bg-amber-500/5 border border-amber-500/15 p-3 flex items-start gap-2">
              <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-xs text-zinc-300 leading-relaxed">
                <strong className="text-amber-300">Worker-specific rates</strong> override the fallback. Set them in
                <strong className="text-white"> Team → edit worker</strong>. Currently {workers.filter(w => w.hourlyRate).length} of {workers.length} workers have individual rates set.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── QUOTE CALCULATOR (existing) */}
      <div data-settings-anchor="financial-calculator" className="rounded-2xl">
        <p className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-3">Quote Calculator</p>
        <QuoteCalculator settings={settings} />
      </div>
    </div>
  );
};

const QuoteCalculator = ({ settings }: { settings: SystemSettings }) => {
  const [qty, setQty] = useState<number>(0);
  const [minsPerPart, setMinsPerPart] = useState<number>(0);
  const [markup, setMarkup] = useState<number>(30);

  const shopRate = settings.shopRate || 21;
  const overheadRate = (settings.monthlyOverhead || 0) / (settings.monthlyWorkHours || 232);

  const totalMins = qty * minsPerPart;
  const totalHrs = totalMins / 60;
  const laborCost = totalHrs * shopRate;
  const overheadCost = totalHrs * overheadRate;
  const totalCost = laborCost + overheadCost;
  const priceAtMarkup = totalCost * (1 + markup / 100);
  const pricePerPart = qty > 0 ? priceAtMarkup / qty : 0;
  const profit = priceAtMarkup - totalCost;

  const markups = [15, 20, 25, 30, 35, 40, 50];

  const hasInput = qty > 0 && minsPerPart > 0;

  return (
    <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6 space-y-6">
      <div className="flex items-center gap-3 pb-6 border-b border-white/5">
        <div className="bg-cyan-500/20 p-2 rounded-lg text-cyan-400"><Calculator className="w-6 h-6" /></div>
        <div><h3 className="font-bold text-white">Quote Calculator</h3><p className="text-sm text-zinc-500">Price jobs accurately using your real shop costs.</p></div>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-1 block">Quantity</label>
          <input type="number" className="w-full bg-zinc-950 border border-white/10 rounded-lg p-3 text-white font-mono text-lg" value={qty || ''} onChange={e => setQty(Number(e.target.value) || 0)} placeholder="40" />
        </div>
        <div>
          <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-1 block">Min / Part</label>
          <input type="number" className="w-full bg-zinc-950 border border-white/10 rounded-lg p-3 text-white font-mono text-lg" value={minsPerPart || ''} onChange={e => setMinsPerPart(Number(e.target.value) || 0)} placeholder="50" />
        </div>
      </div>

      {hasInput && (
        <>
          {/* Cost Breakdown */}
          <div className="bg-zinc-800/50 rounded-xl p-4 space-y-2">
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">Your Cost Breakdown</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <p className="text-xs text-zinc-500">Total Hours</p>
                <p className="text-xl font-black text-white">{totalHrs.toFixed(1)}h</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-zinc-500">Labor</p>
                <p className="text-xl font-black text-amber-400">${laborCost.toFixed(0)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-zinc-500">Overhead</p>
                <p className="text-xl font-black text-yellow-400">${overheadCost.toFixed(0)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-zinc-500">Total Cost</p>
                <p className="text-xl font-black text-red-400">${totalCost.toFixed(0)}</p>
              </div>
            </div>
          </div>

          {/* Markup Selector */}
          <div>
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">Select Markup</h4>
            <div className="flex flex-wrap gap-2">
              {markups.map(m => (
                <button key={m} onClick={() => setMarkup(m)} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${markup === m ? 'bg-emerald-600 text-white ring-2 ring-emerald-400' : 'bg-zinc-800 text-zinc-400 hover:text-white border border-white/5'}`}>
                  {m}%
                </button>
              ))}
            </div>
          </div>

          {/* Quote Result */}
          <div className="bg-gradient-to-br from-emerald-500/10 to-blue-500/10 border border-emerald-500/20 rounded-2xl p-6">
            <div className="text-center space-y-1 mb-4">
              <p className="text-xs text-zinc-400 uppercase font-bold tracking-wider">Recommended Quote ({markup}% markup)</p>
              <p className="text-3xl sm:text-5xl font-black text-emerald-400">${priceAtMarkup.toFixed(0)}</p>
              <p className="text-lg font-bold text-zinc-300">${pricePerPart.toFixed(2)} per part</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center pt-4 border-t border-white/10">
              <div>
                <p className="text-xs text-zinc-500">Your Cost</p>
                <p className="text-lg font-bold text-red-400">${totalCost.toFixed(0)}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Profit</p>
                <p className={`text-lg font-bold ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>${profit.toFixed(0)}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Cost/Part</p>
                <p className="text-lg font-bold text-zinc-300">${qty > 0 ? (totalCost / qty).toFixed(2) : '0.00'}</p>
              </div>
            </div>
          </div>

          {/* Quick Reference Table */}
          <div>
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">All Markup Options</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-zinc-500 text-xs uppercase">
                    <th className="text-left p-2">Markup</th>
                    <th className="text-right p-2">Total Quote</th>
                    <th className="text-right p-2">Per Part</th>
                    <th className="text-right p-2">Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {markups.map(m => {
                    const p = totalCost * (1 + m / 100);
                    const pp = qty > 0 ? p / qty : 0;
                    const pr = p - totalCost;
                    return (
                      <tr key={m} className={`${m === markup ? 'bg-emerald-500/10' : 'hover:bg-white/5'} transition-colors cursor-pointer`} onClick={() => setMarkup(m)}>
                        <td className="p-2 font-bold text-zinc-300">{m}%</td>
                        <td className="p-2 text-right font-mono text-white">${p.toFixed(0)}</td>
                        <td className="p-2 text-right font-mono text-zinc-400">${pp.toFixed(2)}</td>
                        <td className={`p-2 text-right font-mono font-bold ${pr >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>+${pr.toFixed(0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!hasInput && (
        <div className="text-center py-8 text-zinc-600">
          <Calculator className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Enter quantity and minutes per part to see pricing</p>
        </div>
      )}
    </div>
  );
};


// --- MACHINE MANAGER — simple list of physical stations/machines ---
const MachineManager = ({ settings, onSaveSettings }: { settings: SystemSettings; onSaveSettings: (s: SystemSettings) => void }) => {
  const [open, setOpen] = useState(false);
  const [newMachine, setNewMachine] = useState('');
  const { confirm: askConfirm, ConfirmHost } = useConfirm();
  const machines = settings.machines || [];
  const handleAdd = () => {
    const name = newMachine.trim();
    if (!name) return;
    if (machines.some(m => m.toLowerCase() === name.toLowerCase())) { setNewMachine(''); return; }
    onSaveSettings({ ...settings, machines: [...machines, name] });
    setNewMachine('');
  };
  const handleDelete = async (m: string) => {
    const ok = await askConfirm({
      title: `Remove "${m}"?`,
      message: 'This machine/station will no longer be offered when workers tag where an operation happened. Past logs keep their tag.',
      tone: 'warning',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    onSaveSettings({ ...settings, machines: machines.filter(x => x !== m) });
  };
  return (
    <div>
      <div className="bg-zinc-900/50 border border-white/5 rounded-xl">
        <button onClick={() => setOpen(!open)} className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 rounded-xl transition-colors">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-white">Machines &amp; Stations</p>
            <span className="text-[10px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded-full font-bold">{machines.length}</span>
          </div>
          <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {open && (
          <div className="px-4 pb-4 space-y-3 border-t border-white/5">
            <p className="text-[11px] text-zinc-500 mt-3">Physical work locations in your shop (e.g. "Bench 1", "Vibratory Tumbler", "Belt Sander 2"). Workers can tag which machine an operation happened at.</p>
            <div className="flex gap-2">
              <input aria-label="Add machine or station" value={newMachine} onChange={e => setNewMachine(e.target.value)} placeholder="Add machine or station…" className="flex-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white outline-none" onKeyDown={e => e.key === 'Enter' && handleAdd()} />
              <button onClick={handleAdd} className="bg-orange-600 hover:bg-orange-500 px-3 rounded-lg text-white text-xs font-bold">Add</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {machines.sort((a, b) => a.localeCompare(b)).map(m => (
                <span key={m} className="bg-zinc-800 border border-white/10 px-2 py-0.5 rounded flex items-center gap-1 text-xs text-zinc-300">
                  {m}<button aria-label={`Remove ${m}`} onClick={() => handleDelete(m)} className="text-zinc-500 hover:text-red-400 p-1 rounded"><X className="w-2.5 h-2.5" aria-hidden="true" /></button>
                </span>
              ))}
            </div>
            {machines.length === 0 && (
              <div className="bg-zinc-950/60 border border-dashed border-white/5 rounded-lg p-3 mt-2">
                <p className="text-[11px] text-zinc-500 mb-2">Common machines in a deburring/finishing shop:</p>
                <div className="flex flex-wrap gap-1.5">
                  {['Bench 1', 'Bench 2', 'Belt Sander', 'Vibratory Tumbler', 'Blast Cabinet', 'Drill Press', 'Hand Grinder'].map(suggested => (
                    <button
                      key={suggested}
                      type="button"
                      onClick={() => onSaveSettings({ ...settings, machines: [...(settings.machines || []), suggested] })}
                      className="text-[11px] bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/20 text-orange-400 px-2.5 py-1 rounded-lg font-semibold transition-colors"
                    >
                      + {suggested}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {ConfirmHost}
    </div>
  );
};

// --- CUSTOMER MANAGER — discovers + dedupes customers pulled from actual jobs ---
const CustomerManager = ({ addToast, settings, onSaveSettings, onSaveNow }: { addToast: any; settings: SystemSettings; onSaveSettings: (s: SystemSettings) => void; onSaveNow?: (changes: Partial<SystemSettings>) => Promise<boolean> }) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [canonicalName, setCanonicalName] = useState('');
  const [merging, setMerging] = useState(false);
  const [newClient, setNewClient] = useState('');
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [previewingPortal, setPreviewingPortal] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const { confirm: askConfirm, ConfirmHost } = useConfirm();

  useEffect(() => DB.subscribeJobs(setJobs), []);

  // Aggregate: unique customer strings from jobs + manually-added clients.
  // Dedup is case- and whitespace-insensitive so "ACME", "acme", and
  // "ACME " collapse into a single row. The first-seen display casing
  // is kept to preserve what's on existing job records.
  const rows = useMemo(() => {
    const canonical = new Map<string, string>();  // key -> display name
    const map = new Map<string, { jobs: number; active: number; completed: number; lastSeen: number }>();
    const bucketFor = (raw: string) => {
      const name = raw.trim();
      const key = customerKey(name);
      if (!key) return null;
      if (!canonical.has(key)) canonical.set(key, name);
      const display = canonical.get(key)!;
      return display;
    };
    jobs.forEach(j => {
      const display = bucketFor(j.customer || '');
      if (!display) return;
      const cur = map.get(display) || { jobs: 0, active: 0, completed: 0, lastSeen: 0 };
      cur.jobs++;
      if (j.status === 'completed') cur.completed++; else cur.active++;
      cur.lastSeen = Math.max(cur.lastSeen, j.completedAt || j.createdAt || 0);
      map.set(display, cur);
    });
    // Merge in manually-added clients with 0 jobs
    (settings.clients || []).forEach(c => {
      const display = bucketFor(c);
      if (display && !map.has(display)) map.set(display, { jobs: 0, active: 0, completed: 0, lastSeen: 0 });
    });
    return [...map.entries()]
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.jobs - a.jobs || a.name.localeCompare(b.name));
  }, [jobs, settings.clients]);

  // Duplicate detection — strip corporate suffixes, punctuation, whitespace;
  // then fuzzy-match on first 2 meaningful tokens.
  const COMMON_SUFFIXES = /\b(inc|incorporated|corp|corporation|co|company|llc|ltd|limited|lp|llp|pllc|gmbh|plc|sa|ag|nv|bv|pty|oy|aero|aerospace|industries|industry|group|holdings|services|solutions|machining|manufacturing|mfg|products|intl|international)\b/gi;
  const normalize = (s: string) => s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\([^)]*\)/g, '')
    .replace(COMMON_SUFFIXES, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1)
    .slice(0, 2)
    .join('');

  const suggestedGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    rows.forEach(r => {
      const key = normalize(r.name);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r.name);
    });
    return [...groups.values()].filter(g => g.length > 1);
  }, [rows]);

  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name); else next.add(name);
    setSelected(next);
    // Default canonical to the longest/most-jobs name in selection
    if (next.size > 0) {
      const best = rows.filter(r => next.has(r.name)).sort((a, b) => b.jobs - a.jobs || b.name.length - a.name.length)[0];
      if (best) setCanonicalName(best.name);
    }
  };

  const handleMerge = async () => {
    if (selected.size < 2) { addToast('error', 'Select at least 2 customers to merge'); return; }
    if (!canonicalName.trim()) { addToast('error', 'Pick a final name'); return; }
    setMerging(true);
    try {
      const others = [...selected].filter(n => n !== canonicalName.trim());
      if (others.length === 0) { addToast('info', 'Nothing to merge — all selected already use this name'); setMerging(false); return; }
      const count = await DB.renameCustomer(others, canonicalName.trim());
      // Also remove merged aliases from saved clients list if present
      const final = canonicalName.trim();
      const clients = (settings.clients || []).filter(c => !others.includes(c));
      if (!clients.includes(final) && final) clients.push(final);
      // The merged names' profile, portal link and custom route follow them to
      // the final name — they used to stay under the old names, so contact
      // info and routes vanished and the customer's portal link showed no
      // jobs. The final name's own entries win; an old portal link is moved
      // only when the final name has none (otherwise it's left, still
      // resolving to a name variant of the same customer).
      const contacts = { ...(settings.clientContacts || {}) };
      const slugs = { ...(settings.clientSlugs || {}) };
      const pipes = { ...(settings.customerPipelines || {}) };
      for (const o of others) {
        if (contacts[o]) { contacts[final] = { ...contacts[o], ...(contacts[final] || {}), name: final }; delete contacts[o]; }
        if (slugs[o] && !slugs[final]) { slugs[final] = slugs[o]; delete slugs[o]; }
        if (pipes[o]) { if (!pipes[final]) pipes[final] = pipes[o]; delete pipes[o]; }
      }
      const changes = { clients, clientContacts: contacts, clientSlugs: slugs, customerPipelines: pipes };
      // Saved straight away on top of the LATEST settings (not this screen's
      // copy from before the long rename).
      if (onSaveNow) await onSaveNow(changes);
      else onSaveSettings({ ...settings, ...changes });
      addToast('success', `Merged ${others.length} name${others.length !== 1 ? 's' : ''} → "${canonicalName.trim()}" · ${count} job${count !== 1 ? 's' : ''} updated`);
      setSelected(new Set());
      setCanonicalName('');
    } catch {
      addToast('error', 'Merge failed');
    }
    setMerging(false);
  };

  const applySuggestedGroup = (names: string[]) => {
    setSelected(new Set(names));
    const best = rows.filter(r => names.includes(r.name)).sort((a, b) => b.jobs - a.jobs || b.name.length - a.name.length)[0];
    if (best) setCanonicalName(best.name);
  };

  const handleAddClient = () => {
    const name = newClient.trim();
    if (!name) return;
    if ((settings.clients || []).some(c => c.toLowerCase() === name.toLowerCase())) { addToast('info', 'Already exists'); return; }
    onSaveSettings({ ...settings, clients: [...(settings.clients || []), name] });
    setNewClient('');
  };

  return (
    <div className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-purple-400" aria-hidden="true" />
            <p className="text-sm font-bold text-white">Customers</p>
            <span className="text-[10px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded-full font-bold">{rows.length}</span>
          </div>
          <p className="text-[11px] text-zinc-500 mt-0.5">Full profiles, per-customer workflows, and a live preview of what each one sees in their portal.</p>
        </div>
      </div>

      {/* Suggested merges */}
      {suggestedGroups.length > 0 && (
        <div className="px-4 py-3 border-b border-white/5 bg-amber-500/5">
          <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest mb-2">⚠ Possible duplicates</p>
          <div className="space-y-1.5">
            {suggestedGroups.slice(0, 4).map((group, i) => (
              <button key={i} type="button" onClick={() => applySuggestedGroup(group)} className="w-full text-left flex items-center gap-2 p-2 rounded-lg bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/15 transition-colors">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                <span className="flex-1 text-xs text-zinc-300 truncate">
                  {group.map((n, idx) => <span key={n}>{idx > 0 && <span className="text-zinc-600 mx-1">·</span>}<span className="font-semibold text-white">{n}</span></span>)}
                </span>
                <span className="text-[10px] text-amber-400 font-bold shrink-0">Select all</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="px-4 py-2.5 border-b border-white/5 bg-zinc-950/30">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search customers by name…"
          className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-purple-500/40"
        />
      </div>

      {/* Action bar */}
      <div className="px-4 py-3 border-b border-white/5 flex flex-wrap items-center gap-2 bg-zinc-950/40">
        <span className="text-[11px] text-zinc-500">{selected.size > 0 ? `${selected.size} selected` : 'Pick 2+ to merge'}</span>
        {selected.size > 0 && (
          <>
            <span className="text-zinc-600">→</span>
            <input
              aria-label="Final customer name"
              value={canonicalName}
              onChange={e => setCanonicalName(e.target.value)}
              placeholder="Final name…"
              className="flex-1 min-w-[140px] bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white outline-none"
            />
            <button onClick={handleMerge} disabled={merging || selected.size < 2 || !canonicalName.trim()} className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 disabled:opacity-40 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all">
              {merging ? 'Merging…' : 'Merge'}
            </button>
            <button onClick={() => { setSelected(new Set()); setCanonicalName(''); }} className="text-zinc-400 hover:text-white text-xs font-medium px-2 py-1 rounded hover:bg-white/5">Clear</button>
          </>
        )}
        {selected.size === 0 && (
          <div className="flex gap-2 flex-1 ml-auto justify-end">
            <input aria-label="Add customer" value={newClient} onChange={e => setNewClient(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddClient()} placeholder="Add new customer…" className="bg-zinc-950 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white outline-none w-48" />
            <button onClick={handleAddClient} className="bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg">Add</button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="max-h-[500px] overflow-y-auto">
        {rows.length === 0 ? (
          <p className="p-6 text-center text-zinc-500 text-xs italic">No customers yet. Scan a PO or add one above.</p>
        ) : (() => {
          const q = search.trim().toLowerCase();
          const visible = q ? rows.filter(r => r.name.toLowerCase().includes(q)) : rows;
          if (visible.length === 0) return <p className="p-6 text-center text-zinc-500 text-xs italic">No matches for "{search}".</p>;
          return (
            <div className="divide-y divide-white/5">
              {visible.map(r => {
                const isSelected = selected.has(r.name);
                const contact = settings.clientContacts?.[r.name];
                const stageIds = contact?.customStageIds;
                const hasCustomRoute = stageIds && stageIds.length > 0;
                const hasContact = !!(contact?.contactPerson || contact?.email || contact?.phone);
                const initial = (r.name || '?').trim().slice(0, 2).toUpperCase();
                return (
                  <div key={r.name} className={`group flex items-center gap-3 px-4 py-3 transition-colors ${isSelected ? 'bg-blue-500/10' : 'hover:bg-white/[0.03]'}`}>
                    {/* Merge checkbox — stays compact, tooltip explains intent */}
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(r.name)}
                      className="w-4 h-4 rounded bg-zinc-800 border-white/10 text-amber-500 focus:ring-amber-500 shrink-0 cursor-pointer"
                      aria-label={`Select ${r.name} for merge`}
                      title="Select to merge duplicates"
                    />

                    {/* Avatar — deterministic purple tint, instant visual anchor */}
                    <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/25 text-purple-300 flex items-center justify-center shrink-0 font-black text-sm">
                      {initial}
                    </div>

                    {/* Name + contact preview */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-white font-semibold truncate" title={r.name}>{r.name}</span>
                        {hasCustomRoute && (
                          <span
                            className="text-[9px] font-black text-amber-300 bg-amber-500/10 border border-amber-500/25 px-1.5 py-0.5 rounded"
                            title={`Custom workflow: ${stageIds!.length} stage${stageIds!.length !== 1 ? 's' : ''}`}
                          >
                            ⚙ CUSTOM ROUTE
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                        {hasContact
                          ? [contact?.contactPerson, contact?.email, contact?.phone].filter(Boolean).join(' · ')
                          : <span className="italic text-zinc-600">No contact details — click Edit to add</span>}
                      </p>
                    </div>

                    {/* Stats — right-aligned, compact */}
                    <div className="hidden sm:flex flex-col items-end shrink-0 min-w-[80px]">
                      <span className="text-[11px] font-mono tabular text-zinc-300">{r.jobs} job{r.jobs !== 1 ? 's' : ''}</span>
                      {r.active > 0 && <span className="text-[9px] font-black text-emerald-400">{r.active} active</span>}
                    </div>

                    {/* Action buttons — clear labels, grouped */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setPreviewingPortal(r.name)}
                        className="bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-zinc-300 hover:text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                        title="Preview what the customer sees + leave portal notes"
                      >
                        <Eye className="w-3 h-3" aria-hidden="true" /> View Portal
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingProfile(r.name)}
                        className="bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                        title="Edit profile: contact, addresses, workflow"
                      >
                        <Edit2 className="w-3 h-3" aria-hidden="true" /> Edit
                      </button>
                      {r.jobs === 0 && (
                        <button
                          type="button"
                          aria-label={`Remove ${r.name}`}
                          onClick={async (e) => {
                            e.preventDefault();
                            const ok = await askConfirm({
                              title: `Remove customer "${r.name}"?`,
                              message: 'They have no jobs on file. This removes them from the customer list.',
                              tone: 'warning',
                              confirmLabel: 'Remove',
                            });
                            if (!ok) return;
                            onSaveSettings({ ...settings, clients: (settings.clients || []).filter(c => c !== r.name) });
                          }}
                          className="text-zinc-500 hover:text-red-400 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Delete (no jobs)"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* Customer profile editor modal */}
      {editingProfile && (
        <CustomerProfileEditor
          name={editingProfile}
          settings={settings}
          onClose={() => setEditingProfile(null)}
          onSave={(updated) => {
            const contacts = { ...(settings.clientContacts || {}) };
            contacts[updated.name] = updated;
            // If the name changed, remove the old key
            if (updated.name !== editingProfile) {
              delete contacts[editingProfile];
            }
            onSaveSettings({ ...settings, clientContacts: contacts });
            addToast('success', `${updated.name} profile saved`);
            setEditingProfile(null);
          }}
          onSaveSettings={onSaveSettings}
          onSaveNow={onSaveNow}
          addToast={addToast}
        />
      )}
      {rows.length > 0 && (
        <div className="px-4 py-2 border-t border-white/5 bg-zinc-950/40 flex items-center gap-2 flex-wrap">
          <p className="text-[10px] text-zinc-500 leading-relaxed flex-1 min-w-0">
            <span className="text-purple-400 font-bold">Edit</span> for profile + per-customer workflow ·
            <span className="text-zinc-300 font-bold"> View Portal</span> to see what they see and leave a status update on any active job.
          </p>
        </div>
      )}

      {/* Portal preview — what the customer sees, with inline note editor */}
      {previewingPortal && (
        <CustomerPortalPreview
          customerName={previewingPortal}
          settings={settings}
          onClose={() => setPreviewingPortal(null)}
          addToast={addToast}
        />
      )}
      {ConfirmHost}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════
// CUSTOMER PROFILE EDITOR
// Full-featured dialog for editing a customer's contact info, billing
// details, default terms, and — critically — their custom workflow
// routing. A customer can override the shop's default stages (e.g.
// "Boeing skips Stamp, goes straight from QC to Packing").
// ══════════════════════════════════════════════════════════════════
const CustomerProfileEditor = ({
  name,
  settings,
  onClose,
  onSave,
  onSaveSettings,
  onSaveNow,
  addToast,
}: {
  name: string;
  settings: SystemSettings;
  onClose: () => void;
  onSave: (c: import('../types').CustomerContact) => void;
  onSaveSettings?: (s: SystemSettings) => void;
  onSaveNow?: (changes: Partial<SystemSettings>) => Promise<boolean>;
  addToast: any;
}) => {
  const existing = settings.clientContacts?.[name];
  const defaultStages = (settings.jobStages || []).slice().sort((a, b) => a.order - b.order);

  const [form, setForm] = useState<import('../types').CustomerContact>(() => existing || { name });
  const [slug, setSlug] = useState<string>(() => settings.clientSlugs?.[name] || makeClientSlug(name));
  const [useCustomRoute, setUseCustomRoute] = useState<boolean>(
    !!(existing?.customStageIds && existing.customStageIds.length > 0),
  );
  const [customStageIds, setCustomStageIds] = useState<string[]>(
    existing?.customStageIds && existing.customStageIds.length > 0
      ? existing.customStageIds
      // Default: all non-complete stages checked
      : defaultStages.filter(s => !s.isComplete).map(s => s.id),
  );

  const toggleStage = (id: string) => {
    setCustomStageIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  };

  const handleSave = () => {
    if (!form.name?.trim()) {
      addToast('error', 'Customer name is required');
      return;
    }
    const now = Date.now();
    const updated: import('../types').CustomerContact = {
      ...form,
      name: form.name.trim(),
      customStageIds: useCustomRoute && customStageIds.length > 0 ? customStageIds : undefined,
      updatedAt: now,
      createdAt: existing?.createdAt || now,
    };
    // Strip empty strings so stored records stay clean
    for (const k of Object.keys(updated) as (keyof typeof updated)[]) {
      if (updated[k] === '') (updated as any)[k] = undefined;
    }
    onSave(updated);
  };

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="sm:max-w-2xl"
      title={existing ? `Edit ${name}` : 'Customer Profile'}
      subtitle="Contact, billing, defaults, and per-customer workflow"
      icon={<Users className="w-4 h-4 text-purple-400" aria-hidden="true" />}
      footer={
        <>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-white text-xs font-bold px-3 py-2">Cancel</button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleSave}
            className="bg-purple-600 hover:bg-purple-500 text-white px-5 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" /> Save Profile
          </button>
        </>
      }
    >
      {/* ── Identity ── */}
      <div>
        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Identity</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Company Name</label>
            {/* Read-only here: renaming only the profile hid it (jobs keep the old
                name, the list is built from them) and broke the portal link.
                Merge Customers renames everything together. */}
            <input value={form.name || ''} readOnly title="To rename a customer, use Merge Customers — it renames their jobs, profile and portal link together" className="w-full bg-zinc-950/60 border border-white/5 rounded-lg px-3 py-2 text-sm text-zinc-400 outline-none cursor-not-allowed" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Contact Person</label>
            <input value={form.contactPerson || ''} onChange={e => setForm({ ...form, contactPerson: e.target.value })} placeholder="Jane Smith" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500/40" />
          </div>
        </div>
      </div>

      {/* ── Contact ── */}
      <div>
        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Contact</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Email</label>
            <input type="email" value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="orders@acme.com" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500/40" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Phone</label>
            <input type="tel" value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="559-555-0100" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500/40" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Billing Email <span className="text-zinc-600 normal-case font-normal">(if different)</span></label>
            <input type="email" value={form.billingEmail || ''} onChange={e => setForm({ ...form, billingEmail: e.target.value })} placeholder="ap@acme.com" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500/40" />
          </div>
        </div>
      </div>

      {/* ── Addresses ── */}
      <div>
        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Addresses</p>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Billing Address</label>
            <textarea rows={2} value={form.address || ''} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="1234 Market St · Fresno, CA 93721" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500/40" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Shipping Address <span className="text-zinc-600 normal-case font-normal">(leave blank to use billing)</span></label>
            <textarea rows={2} value={form.shippingAddress || ''} onChange={e => setForm({ ...form, shippingAddress: e.target.value })} placeholder="Dock 3 · 5678 Industrial Way · Fresno, CA 93725" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500/40" />
          </div>
        </div>
      </div>

      {/* ── Business defaults ── */}
      <div>
        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Business Defaults</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Payment Terms</label>
            <input value={form.paymentTerms || ''} onChange={e => setForm({ ...form, paymentTerms: e.target.value })} placeholder="Net 30" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500/40" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Tax ID / EIN</label>
            <input value={form.taxId || ''} onChange={e => setForm({ ...form, taxId: e.target.value })} placeholder="99-9999999" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500/40 font-mono" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">PO # Prefix <span className="text-zinc-600 normal-case font-normal">(auto-fill on new jobs)</span></label>
            <input value={form.poPrefix || ''} onChange={e => setForm({ ...form, poPrefix: e.target.value })} placeholder="BOE-" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500/40 font-mono" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Default Priority</label>
            <select value={form.defaultPriority || ''} onChange={e => setForm({ ...form, defaultPriority: (e.target.value || undefined) as any })} className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500/40">
              <option value="">— (use shop default)</option>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Portal URL ── */}
      <div>
        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Customer Portal Link</p>
        <div className="bg-zinc-950/60 border border-white/10 rounded-xl p-3 space-y-2">
          <p className="text-[11px] text-zinc-500">
            Share this link so the customer can see their jobs' progress, tracking numbers, and your status updates.
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-zinc-600 shrink-0">…/?c=</span>
            <input
              type="text"
              value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32))}
              onBlur={() => {
                if (!onSaveSettings) return;
                const slugs = { ...(settings.clientSlugs || {}) };
                if (slug) slugs[form.name || name] = slug;
                else delete slugs[form.name || name];
                onSaveSettings({ ...settings, clientSlugs: slugs });
              }}
              className="flex-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-emerald-400 font-mono tabular outline-none focus:border-emerald-500/40"
              placeholder="acme-corp"
            />
            <button
              type="button"
              onClick={async () => {
                // The link only opens once its name is saved — it used to copy a
                // just-typed name that was still waiting on the autosave.
                const key = form.name || name;
                const slugs = { ...(settings.clientSlugs || {}) };
                if (slug) slugs[key] = slug; else delete slugs[key];
                const url = buildPortalUrl(key, { ...settings, clientSlugs: slugs });
                // Copy inside the tap (browsers refuse clipboard writes after an await)
                const copied = navigator.clipboard.writeText(url).catch(() => { prompt('Copy:', url); });
                const saved = onSaveNow ? await onSaveNow({ clientSlugs: slugs }) : true;
                await copied;
                if (saved) addToast('success', 'Portal link copied');
                else addToast('error', "Link copied, but its name didn't save yet — it won't open until it does");
              }}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-2 rounded-lg flex items-center gap-1.5 shrink-0"
              title="Copy full portal URL"
            >
              <Copy className="w-3.5 h-3.5" aria-hidden="true" /> Copy link
            </button>
          </div>
        </div>
      </div>

      {/* ── Custom workflow routing ── */}
      <div>
        <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
          ⚙ Custom Workflow Routing
          <span className="text-[9px] text-zinc-600 normal-case font-normal tracking-normal">(the important one)</span>
        </p>
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={useCustomRoute}
              onChange={e => setUseCustomRoute(e.target.checked)}
              className="w-4 h-4 mt-0.5 rounded bg-zinc-800 border-white/10 accent-amber-500 shrink-0"
            />
            <div className="flex-1">
              <p className="text-sm text-white font-semibold">Use a custom workflow for {form.name || 'this customer'}</p>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Pick only the stages that apply. E.g. if this customer skips <strong>Stamp</strong>,
                uncheck it and their jobs will go straight through the rest.
              </p>
            </div>
          </label>

          {useCustomRoute && (
            <div className="pl-7 space-y-1.5 pt-1">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Stages for this customer</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {defaultStages.filter(s => !s.isComplete).map(stage => {
                  const on = customStageIds.includes(stage.id);
                  return (
                    <label
                      key={stage.id}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border cursor-pointer transition-all ${
                        on
                          ? 'border-amber-500/40 bg-amber-500/10'
                          : 'border-white/5 bg-zinc-950/40 hover:border-white/15'
                      }`}
                    >
                      <input type="checkbox" checked={on} onChange={() => toggleStage(stage.id)} className="w-3.5 h-3.5 rounded accent-amber-500" />
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: stage.color }} />
                      <span className={`text-xs font-bold truncate ${on ? 'text-white' : 'text-zinc-400'}`}>{stage.label}</span>
                    </label>
                  );
                })}
              </div>
              <p className="text-[10px] text-zinc-500 mt-2">
                <strong className="text-amber-300">Preview:</strong>{' '}
                {customStageIds.length === 0 ? (
                  <span className="text-red-400">⚠ No stages selected — pick at least one.</span>
                ) : (
                  defaultStages
                    .filter(s => customStageIds.includes(s.id) || s.isComplete)
                    .map(s => s.label)
                    .join(' → ')
                )}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Internal notes ── */}
      <div>
        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Internal Notes <span className="text-zinc-600 normal-case font-normal">(not printed)</span></p>
        <textarea rows={3} value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Prefers UPS Ground · accounting contact is Jane · don't call after 3pm" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500/40" />
      </div>
    </Modal>
  );
};

// ══════════════════════════════════════════════════════════════════
// CUSTOMER PORTAL PREVIEW
// Split-pane modal for admins:
//   • LEFT  — exact live preview of what this customer sees on their portal
//   • RIGHT — list of their active jobs with inline portal-note editors
// Admin writes a note, hits Save, preview updates instantly. No context
// switching to the Jobs view just to leave a "shipping Friday" update.
// ══════════════════════════════════════════════════════════════════
const CustomerPortalPreview: React.FC<{
  customerName: string;
  settings: SystemSettings;
  onClose: () => void;
  addToast: any;
}> = ({ customerName, settings, onClose, addToast }) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [tab, setTab] = useState<'preview' | 'notes'>('notes');

  useEffect(() => {
    const u = DB.subscribeJobs(setJobs);
    return () => u();
  }, []);

  const customerJobs = useMemo(
    () => jobs.filter(j => (j.customer || '').trim().toLowerCase() === customerName.trim().toLowerCase()),
    [jobs, customerName],
  );
  const activeJobs = useMemo(() => customerJobs.filter(j => j.status !== 'completed'), [customerJobs]);
  const completedJobs = useMemo(() => customerJobs.filter(j => j.status === 'completed'), [customerJobs]);

  const portalUrl = buildPortalUrl(customerName, settings);

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="sm:max-w-6xl"
      title={`Portal view · ${customerName}`}
      subtitle={`${activeJobs.length} active · ${completedJobs.length} completed`}
      icon={<Users className="w-4 h-4 text-purple-400" aria-hidden="true" />}
      footer={
        <>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-white text-xs font-bold px-3 py-2">Close</button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => { navigator.clipboard.writeText(portalUrl).then(() => addToast('success', 'Link copied')).catch(() => prompt('Copy:', portalUrl)); }}
            className="bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-white text-xs font-bold px-3 py-2 rounded-lg flex items-center gap-1.5"
          >
            <Copy className="w-3.5 h-3.5" /> Copy portal link
          </button>
          <a
            href={portalUrl}
            target="_blank"
            rel="noreferrer"
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-2 rounded-lg flex items-center gap-1.5"
          >
            Open in new tab ↗
          </a>
        </>
      }
    >
      {/* Tab picker */}
      <div className="flex gap-1 border-b border-white/10 -mx-4 px-4 pb-0 -mt-2">
        <button
          type="button"
          onClick={() => setTab('notes')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold border-b-2 transition-colors -mb-[1px] ${
            tab === 'notes'
              ? 'border-amber-500 text-white'
              : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" /> Status Updates ({activeJobs.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('preview')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold border-b-2 transition-colors -mb-[1px] ${
            tab === 'preview'
              ? 'border-amber-500 text-white'
              : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Eye className="w-3.5 h-3.5" /> Customer's View
        </button>
      </div>

      {/* ─── Status updates tab — list of active jobs with inline editors ─── */}
      {tab === 'notes' && (
        <div className="space-y-3">
          {activeJobs.length === 0 ? (
            <div className="bg-zinc-950/40 border border-dashed border-white/10 rounded-xl p-8 text-center">
              <MessageSquare className="w-10 h-10 text-zinc-700 mx-auto mb-2" aria-hidden="true" />
              <p className="text-sm text-zinc-400">No active jobs for {customerName}</p>
              <p className="text-[11px] text-zinc-600 mt-0.5">Status updates only show on active (not-yet-completed) orders.</p>
            </div>
          ) : (
            activeJobs.map(job => (
              <PortalNoteRow key={job.id} job={job} addToast={addToast} />
            ))
          )}
        </div>
      )}

      {/* ─── Customer's view tab — embedded CustomerPortal ─── */}
      {tab === 'preview' && (
        <div className="space-y-3 -mx-4 -mb-4">
          <div className="mx-4 bg-zinc-950/60 border border-white/10 rounded-xl p-3 flex items-center gap-2 text-[11px] text-zinc-400">
            <Eye className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>This is exactly what <strong className="text-white">{customerName}</strong> sees when they visit their portal link.</span>
          </div>
          <div className="border-t border-white/10 max-h-[600px] overflow-y-auto">
            <CustomerPortal customerFilter={customerName} />
          </div>
        </div>
      )}
    </Modal>
  );
};

// One row of the portal-note editor — lets admins write/update the
// customer-facing status message + expected date in place, then save.
const PortalNoteRow: React.FC<{ job: Job; addToast: any }> = ({ job, addToast }) => {
  const [text, setText] = useState(job.portalNote?.text || '');
  const [expectedDate, setExpectedDate] = useState(job.portalNote?.expectedDate || '');
  const [saving, setSaving] = useState(false);
  const dirty = text !== (job.portalNote?.text || '') || expectedDate !== (job.portalNote?.expectedDate || '');

  const save = async () => {
    setSaving(true);
    try {
      // Only the note — re-saving the whole job from this row's copy could undo
      // an edit made elsewhere. An emptied note is deleted, not left behind.
      await DB.updateJobFields(job.id, {
        portalNote: text.trim()
          ? { text: text.trim(), expectedDate: expectedDate.trim() || undefined, updatedAt: Date.now() }
          : undefined,
      });
      addToast('success', `Update saved · ${job.poNumber}`);
    } catch {
      addToast('error', 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const clearNote = async () => {
    setSaving(true);
    try {
      await DB.updateJobFields(job.id, { portalNote: undefined });   // really deletes it (a merge save skipped undefined)
      setText('');
      setExpectedDate('');
      addToast('info', `Update cleared · ${job.poNumber}`);
    } catch {
      addToast('error', 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const isOverdue = job.dueDate && (parseDueDate(job.dueDate)?.getTime() ?? 0) < Date.now();

  return (
    <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-black text-white tabular">{job.poNumber}</span>
            <span className="text-[11px] text-zinc-500">·</span>
            <span className="text-[11px] text-zinc-400 truncate">{job.partNumber}</span>
            {isOverdue && (
              <span className="text-[9px] font-black text-red-400 bg-red-500/10 border border-red-500/25 px-1.5 py-0.5 rounded">OVERDUE</span>
            )}
          </div>
          {job.dueDate && (
            <p className="text-[10px] text-zinc-500 mt-0.5">Due {job.dueDate} · Qty {job.quantity}</p>
          )}
        </div>
        {job.portalNote?.updatedAt && !dirty && (
          <span className="text-[10px] text-zinc-500">Sent {new Date(job.portalNote.updatedAt).toLocaleString()}</span>
        )}
      </div>

      <div>
        <label className="text-[10px] font-bold text-blue-300 uppercase tracking-wider block mb-1">💬 Status message (visible to customer)</label>
        <textarea
          rows={2}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={'On track for Friday EOD · 2 parts remaining in QC'}
          className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-amber-500/40"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
        <div>
          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">Expected ready date (optional)</label>
          <input
            type="text"
            value={expectedDate}
            onChange={e => setExpectedDate(e.target.value)}
            placeholder="MM/DD/YYYY or 'Friday EOD'"
            className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white tabular outline-none focus:border-amber-500/40"
          />
        </div>
        {job.portalNote && (
          <button
            type="button"
            onClick={clearNote}
            disabled={saving}
            className="text-zinc-500 hover:text-red-400 text-xs font-bold px-3 py-2 disabled:opacity-50"
          >
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1.5"
        >
          {saving ? 'Saving…' : dirty ? 'Save update' : 'Saved'}
        </button>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════
// PROCESS LIBRARY MANAGER — reusable process templates (Quotes Round 1 #2)
// ══════════════════════════════════════════════════════════════════
const DEFAULT_PROCESS_SEEDS: Omit<ProcessTemplate, 'id'>[] = [
  { name: 'Vibratory Deburr', description: 'Vibratory tumble deburring, break sharp edges', unit: 'ea', setupFee: 75, pricePerUnit: 0.45, minLot: 50, category: 'Deburring' },
  { name: 'Hand Deburr', description: 'Manual deburring with files/stones per print', unit: 'ea', setupFee: 50, pricePerUnit: 1.25, minLot: 25, category: 'Deburring' },
  { name: 'Polishing', description: 'Multi-step polish to customer spec', unit: 'ea', setupFee: 100, pricePerUnit: 2.5, minLot: 10, category: 'Finishing' },
  { name: 'Setup & Inspection', description: 'First article inspection + setup', unit: 'lot', pricePerUnit: 125, category: 'Inspection' },
  { name: 'Passivation', description: 'Stainless steel passivation per AMS 2700', unit: 'lb', setupFee: 150, pricePerUnit: 4.5, minCharge: 250, category: 'Finishing' },
];

const ProcessLibraryManager = ({ settings, setSettings }: { settings: SystemSettings; setSettings: React.Dispatch<React.SetStateAction<SystemSettings>> }) => {
  const processes = settings.processTemplates || [];
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showSeeds, setShowSeeds] = useState(false);
  const { confirm: askConfirm, ConfirmHost } = useConfirm();

  // Duplicate names break quote auto-matching (find() returns the first hit) —
  // warn inline while editing rather than blocking keystrokes.
  const isDupName = (name: string, selfIdx: number) =>
    processes.some((p, i) => i !== selfIdx && p.name.trim().toLowerCase() === name.trim().toLowerCase());

  const update = (idx: number, patch: Partial<ProcessTemplate>) => {
    const next = [...processes];
    next[idx] = { ...next[idx], ...patch };
    setSettings({ ...settings, processTemplates: next });
  };
  const remove = async (idx: number) => {
    const procName = processes[idx]?.name || 'this process';
    const ok = await askConfirm({
      title: `Delete "${procName}"?`,
      message: 'Removes it from the process library. Existing quotes that used it are unaffected.',
      tone: 'warning',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    const target = processes[idx];
    // On the latest settings, matched by the process itself (see GoalsSettings).
    setSettings(prev => ({ ...prev, processTemplates: (prev.processTemplates || []).filter(p => !(p.id && target?.id ? p.id === target.id : JSON.stringify(p) === JSON.stringify(target))) }));
  };
  const add = (seed?: Omit<ProcessTemplate, 'id'>) => {
    // Don't create a second template with the same name — expand the existing one instead
    if (seed) {
      const existing = processes.find(x => x.name.trim().toLowerCase() === seed.name.trim().toLowerCase());
      if (existing) { setExpandedId(existing.id); setShowSeeds(false); return; }
    }
    const p: ProcessTemplate = seed
      ? { id: `proc_${Date.now()}`, ...seed }
      : { id: `proc_${Date.now()}`, name: 'New Process', unit: 'ea', pricePerUnit: 0, category: 'Other' };
    setSettings({ ...settings, processTemplates: [...processes, p] });
    setExpandedId(p.id);
    setShowSeeds(false);
  };

  // Group by category for cleaner display
  const byCategory: Record<string, ProcessTemplate[]> = {};
  processes.forEach(p => { const c = p.category || 'Other'; (byCategory[c] = byCategory[c] || []).push(p); });

  return (
    <div className="bg-zinc-900/50 border border-emerald-500/15 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between gap-2 bg-gradient-to-b from-emerald-500/10 to-transparent">
        <div className="min-w-0">
          <p className="text-sm font-bold text-white flex items-center gap-2"><Zap className="w-4 h-4 text-emerald-400" aria-hidden="true" /> Process Library</p>
          <p className="text-[11px] text-zinc-500 mt-0.5">Reusable process templates — quote line items fill in with one click. Setup fee, per-unit price, min lot all saved.</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {processes.length === 0 && (
            <button type="button" onClick={() => setShowSeeds(!showSeeds)} className="text-[10px] bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg font-bold">✨ Starter Pack</button>
          )}
          <button type="button" onClick={() => add()} className="text-[10px] bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg font-bold flex items-center gap-1"><Plus className="w-3 h-3" aria-hidden="true" /> Add</button>
        </div>
      </div>

      {showSeeds && (
        <div className="p-4 bg-emerald-500/5 border-b border-white/5 space-y-2">
          <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest">Quick start — pick what applies to your shop</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {DEFAULT_PROCESS_SEEDS.map(seed => (
              <button key={seed.name} type="button" onClick={() => add(seed)} className="text-left bg-zinc-900/70 hover:bg-zinc-800 border border-white/5 hover:border-emerald-500/30 rounded-lg p-3 transition-all">
                <p className="text-sm font-bold text-white">{seed.name}</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">${seed.pricePerUnit}/{seed.unit}{seed.setupFee ? ` · $${seed.setupFee} setup` : ''}{seed.minLot ? ` · min ${seed.minLot}` : ''}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {processes.length === 0 && !showSeeds && (
        <div className="px-4 py-8 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-3">
            <Zap className="w-7 h-7 text-emerald-400" aria-hidden="true" />
          </div>
          <p className="text-sm font-bold text-white">No processes yet</p>
          <p className="text-xs text-zinc-500 mt-1">Saved processes pre-fill quote line items — saves minutes per quote.</p>
          <p className="text-[10px] text-zinc-600 mt-3 italic">Try: "Vibratory Deburr @ $0.45/ea · $75 setup · min 50"</p>
        </div>
      )}

      {Object.keys(byCategory).length > 0 && (
        <div className="divide-y divide-white/5">
          {Object.entries(byCategory).sort().map(([cat, procs]) => (
            <div key={cat}>
              <p className="px-4 py-2 text-[10px] font-black text-emerald-400 uppercase tracking-widest bg-zinc-950/40">{cat}</p>
              <div className="divide-y divide-white/5">
                {procs.map(p => {
                  const idx = processes.findIndex(x => x.id === p.id);
                  const expanded = expandedId === p.id;
                  return (
                    <div key={p.id}>
                      <div className="px-4 py-3 flex items-center gap-3">
                        <button type="button" onClick={() => setExpandedId(expanded ? null : p.id)} className="flex-1 text-left min-w-0">
                          <p className="text-sm font-bold text-white truncate">{p.name}</p>
                          <p className="text-[11px] text-zinc-500 mt-0.5">
                            <span className="text-emerald-400 font-mono font-bold">${p.pricePerUnit.toFixed(2)}</span>/<span>{p.unit}</span>
                            {p.setupFee ? <span className="text-zinc-600"> · <span className="text-zinc-400">${p.setupFee} setup</span></span> : null}
                            {p.minLot ? <span className="text-zinc-600"> · <span className="text-zinc-400">min {p.minLot}</span></span> : null}
                            {p.minCharge ? <span className="text-zinc-600"> · <span className="text-zinc-400">${p.minCharge} min charge</span></span> : null}
                          </p>
                        </button>
                        <button type="button" onClick={() => remove(idx)} aria-label="Delete" className="text-zinc-500 hover:text-red-400 p-1 rounded"><Trash2 className="w-4 h-4" aria-hidden="true" /></button>
                      </div>
                      {expanded && (
                        <div className="border-t border-white/5 bg-zinc-950/40 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="sm:col-span-2">
                            <label className="text-[10px] text-zinc-500 block mb-1 font-black uppercase tracking-widest">Process Name</label>
                            <input value={p.name} onChange={e => update(idx, { name: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500/50 focus:outline-none" />
                            {isDupName(p.name, idx) && (
                              <p className="text-[10px] text-red-400 mt-1">Another process already has this name — quote auto-matching may pick the wrong one.</p>
                            )}
                          </div>
                          <div className="sm:col-span-2">
                            <label className="text-[10px] text-zinc-500 block mb-1 font-black uppercase tracking-widest">Default Line-Item Description</label>
                            <textarea value={p.description || ''} onChange={e => update(idx, { description: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500/50 focus:outline-none resize-y" rows={2} placeholder={`e.g. "${p.name} per customer spec"`} />
                          </div>
                          <div>
                            <label className="text-[10px] text-zinc-500 block mb-1 font-black uppercase tracking-widest">Category</label>
                            <input value={p.category || ''} onChange={e => update(idx, { category: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500/50 focus:outline-none" placeholder="Deburring, Finishing, etc." list={`cat-options-${p.id}`} />
                            <datalist id={`cat-options-${p.id}`}>{['Deburring','Finishing','Inspection','Assembly','Packing','Other'].map(c => <option key={c} value={c} />)}</datalist>
                          </div>
                          <div>
                            <label className="text-[10px] text-zinc-500 block mb-1 font-black uppercase tracking-widest">Unit</label>
                            <input value={p.unit} onChange={e => update(idx, { unit: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500/50 focus:outline-none" list={`unit-options-${p.id}`} />
                            <datalist id={`unit-options-${p.id}`}>{['ea','hr','ft','lb','lot','pcs','set'].map(u => <option key={u} value={u} />)}</datalist>
                          </div>
                          <div>
                            <label className="text-[10px] text-zinc-500 block mb-1 font-black uppercase tracking-widest">Price / Unit</label>
                            <div className="relative"><span className="absolute left-3 top-2 text-zinc-500 text-sm">$</span><input type="number" step="0.01" value={p.pricePerUnit} onChange={e => update(idx, { pricePerUnit: Number(e.target.value) || 0 })} className="w-full bg-zinc-950 border border-white/10 rounded-lg py-2 pl-7 pr-3 text-sm text-white font-mono focus:border-emerald-500/50 focus:outline-none" /></div>
                          </div>
                          <div>
                            <label className="text-[10px] text-zinc-500 block mb-1 font-black uppercase tracking-widest">Setup Fee (optional)</label>
                            <div className="relative"><span className="absolute left-3 top-2 text-zinc-500 text-sm">$</span><input type="number" step="1" value={p.setupFee || ''} onChange={e => update(idx, { setupFee: Number(e.target.value) || undefined })} className="w-full bg-zinc-950 border border-white/10 rounded-lg py-2 pl-7 pr-3 text-sm text-white font-mono focus:border-emerald-500/50 focus:outline-none" placeholder="0" /></div>
                          </div>
                          <div>
                            <label className="text-[10px] text-zinc-500 block mb-1 font-black uppercase tracking-widest">Min Lot Size</label>
                            <input type="number" value={p.minLot || ''} onChange={e => update(idx, { minLot: Number(e.target.value) || undefined })} className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-emerald-500/50 focus:outline-none" placeholder="0" />
                          </div>
                          <div>
                            <label className="text-[10px] text-zinc-500 block mb-1 font-black uppercase tracking-widest">Min Charge</label>
                            <div className="relative"><span className="absolute left-3 top-2 text-zinc-500 text-sm">$</span><input type="number" step="1" value={p.minCharge || ''} onChange={e => update(idx, { minCharge: Number(e.target.value) || undefined })} className="w-full bg-zinc-950 border border-white/10 rounded-lg py-2 pl-7 pr-3 text-sm text-white font-mono focus:border-emerald-500/50 focus:outline-none" placeholder="0" /></div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {ConfirmHost}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════
// SNIPPET LIBRARY MANAGER — reusable text blocks for quote Scope/Notes/Terms
// (Quotes Round 1 #8 — steal from PandaDoc)
// ══════════════════════════════════════════════════════════════════
const DEFAULT_SNIPPET_SEEDS: Omit<QuoteSnippet, 'id'>[] = [
  { label: 'Certificate of Conformance', text: 'CERTIFICATE OF CONFORMANCE: This is to certify that all processes conform to applicable Specifications, Drawings, Contracts, and/or Order Requirements unless otherwise specified.', target: 'notes', category: 'Quality' },
  { label: 'Mil-Spec Inspection', text: 'First-article and in-process inspection per MIL-STD-1595. Documentation available on request.', target: 'scope', category: 'Quality' },
  { label: 'Rush Fee Terms', text: 'Rush lead-time (< 5 business days) adds 25% to total. Standard lead-time applies unless otherwise quoted.', target: 'terms', category: 'Pricing' },
  { label: 'Net 30 Terms', text: 'Net 30 from invoice date. Past-due balances incur 1.5% monthly finance charge.', target: 'terms', category: 'Pricing' },
  { label: '50% Deposit Required', text: 'A 50% deposit is required before production begins. Balance due upon completion prior to shipment.', target: 'terms', category: 'Pricing' },
  { label: 'Customer-Supplied Material', text: 'Customer is responsible for providing material in good condition. We inspect upon receipt but assume no liability for pre-existing defects.', target: 'scope', category: 'Scope' },
];

const SnippetLibraryManager = ({ settings, setSettings }: { settings: SystemSettings; setSettings: React.Dispatch<React.SetStateAction<SystemSettings>> }) => {
  const snippets = settings.quoteSnippets || [];
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showSeeds, setShowSeeds] = useState(false);
  const { confirm: askConfirm, ConfirmHost } = useConfirm();

  const update = (idx: number, patch: Partial<QuoteSnippet>) => {
    const next = [...snippets]; next[idx] = { ...next[idx], ...patch };
    setSettings({ ...settings, quoteSnippets: next });
  };
  const remove = async (idx: number) => {
    const ok = await askConfirm({
      title: 'Delete snippet?',
      message: `"${snippets[idx]?.label || 'This snippet'}" will be removed from the library. Quotes it was already inserted into keep their text.`,
      tone: 'warning',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    const target = snippets[idx];
    // On the latest settings, matched by the snippet itself (see GoalsSettings).
    setSettings(prev => ({ ...prev, quoteSnippets: (prev.quoteSnippets || []).filter(q => !(q.id && target?.id ? q.id === target.id : JSON.stringify(q) === JSON.stringify(target))) }));
  };
  const add = (seed?: Omit<QuoteSnippet, 'id'>) => {
    const s: QuoteSnippet = seed
      ? { id: `snip_${Date.now()}`, ...seed }
      : { id: `snip_${Date.now()}`, label: 'New Snippet', text: '', target: 'notes', category: 'Other' };
    setSettings({ ...settings, quoteSnippets: [...snippets, s] });
    setExpandedId(s.id);
    setShowSeeds(false);
  };

  return (
    <details className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
      <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white">Content Blocks (Snippets)</span>
          <span className="text-[9px] font-black text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded uppercase tracking-widest">{snippets.length}</span>
        </div>
        <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" />
      </summary>
      <div className="px-4 pb-4 space-y-2">
        <p className="text-[10px] text-zinc-500 leading-relaxed">Reusable text for Scope, Notes, and Terms. One click to insert — saves retyping common boilerplate every quote.</p>
        <div className="flex gap-1.5">
          {snippets.length === 0 && (
            <button type="button" onClick={() => setShowSeeds(!showSeeds)} className="text-[10px] bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 rounded font-bold">✨ Starter Pack</button>
          )}
          <button type="button" onClick={() => add()} className="text-[10px] bg-amber-600 hover:bg-amber-500 text-white px-2.5 py-1 rounded font-bold flex items-center gap-1"><Plus className="w-3 h-3" aria-hidden="true" /> Add</button>
        </div>

        {showSeeds && (
          <div className="space-y-1 pt-2">
            {DEFAULT_SNIPPET_SEEDS.map(seed => (
              <button key={seed.label} type="button" onClick={() => add(seed)} className="w-full text-left bg-zinc-950 hover:bg-zinc-800 border border-white/5 hover:border-emerald-500/30 rounded-lg p-2 transition-all">
                <p className="text-xs font-bold text-white truncate">{seed.label}</p>
                <p className="text-[10px] text-zinc-500 truncate">{seed.text.slice(0, 70)}…</p>
              </button>
            ))}
          </div>
        )}

        {snippets.map((s, idx) => {
          const expanded = expandedId === s.id;
          return (
            <div key={s.id} className="border border-white/5 bg-zinc-800/30 rounded-lg overflow-hidden">
              <div className="p-2 flex items-center gap-2">
                <button type="button" onClick={() => setExpandedId(expanded ? null : s.id)} className="flex-1 text-left min-w-0">
                  <p className="text-xs font-bold text-white truncate">{s.label}</p>
                  <p className="text-[10px] text-zinc-500 truncate mt-0.5">
                    <span className="text-emerald-400 uppercase font-black tracking-widest text-[9px]">{s.target}</span>
                    {' · '}{s.text.slice(0, 50)}…
                  </p>
                </button>
                <button type="button" onClick={() => remove(idx)} aria-label="Delete" className="text-zinc-500 hover:text-red-400 p-1"><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
              </div>
              {expanded && (
                <div className="border-t border-white/5 bg-zinc-950 p-3 space-y-2">
                  <div>
                    <label className="text-[10px] text-zinc-500 block mb-1 font-black uppercase tracking-widest">Label</label>
                    <input value={s.label} onChange={e => update(idx, { label: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-1.5 text-xs text-white" />
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 block mb-1 font-black uppercase tracking-widest">Text</label>
                    <textarea value={s.text} onChange={e => update(idx, { text: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-1.5 text-xs text-white resize-y" rows={4} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-zinc-500 block mb-1 font-black uppercase tracking-widest">Inserts Into</label>
                      <select value={s.target} onChange={e => update(idx, { target: e.target.value as QuoteSnippet['target'] })} className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-1.5 text-xs text-white">
                        <option value="scope">Scope of Work</option>
                        <option value="notes">Notes / Comments</option>
                        <option value="terms">Payment Terms</option>
                        <option value="all">Any Field</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 block mb-1 font-black uppercase tracking-widest">Category</label>
                      <input value={s.category || ''} onChange={e => update(idx, { category: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-1.5 text-xs text-white" placeholder="Quality, Pricing..." />
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {ConfirmHost}
      </div>
    </details>
  );
};

// The real printed quote (same builder as Print) with sample data. The old
// preview was a separate hand-drawn layout, and half its switches never
// reached the printed PDF.
const QuotePreview = ({ settings }: { settings: SystemSettings }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(Math.min(1, (entry.contentRect.width - 2) / 850)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const doc = useMemo(() => {
    const markup = settings.defaultMarkup || 25;
    const discount = settings.defaultDiscount || 0;
    const tax = settings.taxRate || 0;
    const subtotal = 1375;
    const afterMarkup = subtotal * (1 + markup / 100);
    const discountAmt = afterMarkup * (discount / 100);
    const taxAmt = (afterMarkup - discountAmt) * (tax / 100);
    const fields = settings.customProjectFields || ['Purchase Order', 'Part No.'];
    const sample = {
      id: 'PREVIEW',
      quoteNumber: DB.getNextQuoteNumber([], settings.quotePrefix, settings.quoteNextNumber),
      customer: 'Acme Manufacturing', status: 'draft', createdAt: Date.now(),
      validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      billTo: { name: 'Acme Manufacturing', contactPerson: 'Jamie Ortiz', email: 'orders@acmemfg.com', phone: '(555) 123-4567' },
      projectFields: Object.fromEntries(fields.map((f, i) => [f, i === 0 ? 'PO-78432' : i === 1 ? 'BRK-1200-A' : '—'])),
      jobDescription: 'Deburr all edges per print. Break sharp edges 0.005–0.010.',
      items: [
        { description: 'Deburring — Bracket Assembly', qty: 500, unit: 'ea', unitPrice: 2.5, total: 1250 },
        { description: 'Setup & Inspection', qty: 1, unit: 'lot', unitPrice: 125, total: 125 },
      ],
      subtotal, markupPct: markup, discountPct: discount, discountAmt, taxRate: tax, taxAmt,
      total: afterMarkup - discountAmt + taxAmt,
      notes: settings.defaultQuoteComment || undefined,
      terms: settings.defaultPaymentTerms || 'Net 30',
    } as unknown as Quote;
    // Paper margins come from the printer; give the on-screen page the same.
    return quoteDocument(sample, settings).replace('<body>', '<body style="padding:0.45in">');
  }, [settings]);

  return (
    <div className="sticky top-4 rounded-2xl overflow-hidden shadow-2xl border border-white/10 bg-zinc-900">
      <div className="px-4 py-3 border-b border-white/10">
        <p className="text-sm font-bold text-white flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
          Quote Preview
        </p>
        <p className="text-[10px] text-zinc-500 mt-0.5">The real printed page, filled with sample data</p>
      </div>
      <div ref={containerRef} className="bg-white overflow-hidden" style={{ height: Math.round(1100 * scale) + 2 }}>
        <iframe
          title="Quote preview"
          sandbox=""
          srcDoc={doc}
          style={{ width: 850, height: 1100, border: 'none', transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none', display: 'block' }}
        />
      </div>
    </div>
  );
};

// Live miniature Job Traveler preview — re-renders on every settings change
// so admins see section toggles / banner text / row count update in real time.
// Uses sample job data (PO-SAMPLE, ACME) so the preview is populated even if
// the shop has zero real jobs yet.
const TravelerPreview = ({ settings }: { settings: SystemSettings }) => {
  const sampleJob: Job = {
    id: 'PREVIEW-001',
    jobIdsDisplay: 'PREVIEW-001',
    poNumber: 'PO-78432',
    partNumber: 'BRK-1200-A',
    customer: 'Acme Manufacturing',
    priority: 'high',
    quantity: 250,
    dateReceived: new Date().toLocaleDateString('en-US'),
    dueDate: new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-US'),
    info: 'Deburr all edges per print. Inspect per AS9102 FAI requirements.',
    specialInstructions: 'No sharp edges — break 0.010 max. Passivate per AMS 2700.',
    status: 'in-progress',
    createdAt: Date.now() - 86400000,
    expectedHours: 4,
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  const [blobUrl, setBlobUrl] = useState('');

  // Auto-scale to container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setScale(Math.min(1, (entry.contentRect.width - 2) / 850));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Regenerate real traveler HTML whenever branding or traveler settings change
  const depKey = JSON.stringify({
    t: settings.traveler,
    n: settings.companyName,
    ph: settings.companyPhone,
    hasLogo: !!settings.companyLogo,
  });
  useEffect(() => {
    let currentUrl = '';
    let cancelled = false;
    buildTravelerBlobUrl(sampleJob, settings, {}).then(url => {
      // If this effect was cleaned up before the blob resolved, revoke it right
      // away instead of leaking — otherwise store + show it.
      if (cancelled) { URL.revokeObjectURL(url); return; }
      currentUrl = url;
      setBlobUrl(url);
    });
    return () => { cancelled = true; if (currentUrl) URL.revokeObjectURL(currentUrl); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey]);

  const scaledHeight = Math.round(1100 * scale);

  return (
    <div className="sticky top-4 rounded-2xl overflow-hidden shadow-2xl border border-white/10 bg-zinc-900">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div>
          <p className="text-sm font-bold text-white flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
            Live Traveler Preview
          </p>
          <p className="text-[10px] text-zinc-500 mt-0.5">Reflects your exact settings — what will actually print</p>
        </div>
        <button
          onClick={() => void printTraveler(sampleJob, settings, {})}
          className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white text-xs font-bold px-3 py-2 rounded-lg border border-white/10 transition-all"
        >
          <Printer className="w-3.5 h-3.5" aria-hidden="true" />
          Print Sample
        </button>
      </div>

      {/* Scaled iframe — shows the real traveler HTML */}
      <div ref={containerRef} className="bg-white overflow-hidden" style={{ height: scaledHeight + 2 }}>
        {blobUrl ? (
          <iframe
            key={blobUrl}
            src={blobUrl}
            title="Traveler Preview"
            style={{
              width: 850,
              height: 1100,
              border: 'none',
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              pointerEvents: 'none',
              display: 'block',
            }}
          />
        ) : (
          <div className="flex items-center justify-center py-20">
            <div className="w-7 h-7 border-2 border-zinc-200 border-t-orange-500 rounded-full animate-spin" />
          </div>
        )}
      </div>

      <div className="bg-zinc-950 px-3 py-2.5 border-t border-zinc-800 flex items-center justify-between">
        <p className="text-[9px] text-zinc-500">
          Sample data · <span className="text-zinc-300 font-bold">exact match</span> to printed output
        </p>
        <p className="text-[9px] text-zinc-600">PO-78432 · 250 pcs</p>
      </div>
    </div>
  );
};



// ══════════════════════════════════════════════════════════════════════
// Per-Customer Pipeline Assigner
// Lets each customer/company have its own stage sequence so different
// companies that require different processes (e.g., deburr-only vs
// deburr + inspection + packaging) don't share the same pipeline.
// ══════════════════════════════════════════════════════════════════════
const CustomerPipelineAssigner: React.FC<{ settings: SystemSettings; setSettings: (s: SystemSettings) => void }> = ({ settings, setSettings }) => {
  const customers = settings.clients || [];
  const stages = (settings.jobStages || []).sort((a, b) => a.order - b.order);
  const pipelines: Record<string, string[]> = settings.customerPipelines || {};
  const [open, setOpen] = useState<string | null>(null);

  if (customers.length === 0 || stages.length === 0) return null;

  const setPipeline = (customer: string, stageIds: string[]) => {
    const next = { ...pipelines, [customer]: stageIds };
    setSettings({ ...settings, customerPipelines: next });
  };

  const getCustomerStages = (customer: string): string[] => pipelines[customer] || stages.map(s => s.id);

  const toggleStage = (customer: string, stageId: string) => {
    const current = getCustomerStages(customer);
    const next = current.includes(stageId) ? current.filter(id => id !== stageId) : [...current, stageId].sort((a, b) => {
      const ai = stages.findIndex(s => s.id === a);
      const bi = stages.findIndex(s => s.id === b);
      return ai - bi;
    });
    setPipeline(customer, next);
  };

  const isCustom = (customer: string) => {
    const custom = pipelines[customer];
    if (!custom) return false;
    const defaults = stages.map(s => s.id);
    return JSON.stringify([...custom].sort()) !== JSON.stringify([...defaults].sort());
  };

  return (
    <div className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/5">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-white">Per-Company Pipelines</h4>
            <p className="text-[11px] text-zinc-500 mt-0.5">Assign different stage sequences for each customer. Jobs auto-use their customer's pipeline.</p>
          </div>
          <span className="text-[10px] font-black text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded px-2 py-0.5">
            {Object.keys(pipelines).filter(c => isCustom(c)).length} custom
          </span>
        </div>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {customers.map(customer => {
          const custom = isCustom(customer);
          const active = getCustomerStages(customer);
          const isOpen = open === customer;
          return (
            <div key={customer}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : customer)}
                className="w-full px-5 py-3 flex items-center gap-3 hover:bg-white/[0.02] transition-colors text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">{customer}</span>
                    {custom && <span className="text-[9px] font-black text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded px-1.5 py-0.5">CUSTOM</span>}
                  </div>
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    {active.map(id => {
                      const s = stages.find(st => st.id === id);
                      if (!s) return null;
                      return <span key={id} className="text-[9px] font-bold rounded px-1.5 py-0.5 border" style={{ color: s.color, backgroundColor: s.color + '18', borderColor: s.color + '40' }}>{s.label}</span>;
                    })}
                  </div>
                </div>
                <ChevronDown className={`w-4 h-4 text-zinc-600 transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && (
                <div className="px-5 pb-4 space-y-2">
                  <p className="text-[10px] text-zinc-600 mb-2">Toggle stages on/off for {customer}. Unchecked stages are skipped in their job pipeline.</p>
                  <div className="flex flex-wrap gap-2">
                    {stages.map(s => {
                      const on = active.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggleStage(customer, s.id)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${on ? 'text-white' : 'opacity-40 bg-zinc-900 border-white/10 text-zinc-500'}`}
                          style={on ? { backgroundColor: s.color + '22', borderColor: s.color + '50', color: s.color } : {}}
                        >
                          {on ? <CheckCircle className="w-3 h-3" /> : <X className="w-3 h-3" />}
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                  {custom && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...pipelines };
                        delete next[customer];
                        setSettings({ ...settings, customerPipelines: next });
                      }}
                      className="text-[10px] text-zinc-500 hover:text-red-400 flex items-center gap-1 mt-1 transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" /> Reset to default pipeline
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Clock-Out Audit Log ────────────────────────────────────────────────────
// Shows recent completed time-logs with a colour-coded badge explaining WHY
// the timer stopped — manual, alarm, admin force-stop, or system sweep.
// Lets managers quickly confirm that workers clocked out themselves and catch
// any system misfires at a glance.

const STOP_REASON_META: Record<string, { label: string; color: string; dot: string }> = {
  'manual':             { label: 'Manual',         color: 'text-emerald-400', dot: 'bg-emerald-400' },
  'alarm:shift-end':    { label: 'Alarm (shift end)', color: 'text-blue-400', dot: 'bg-blue-400' },
  'alarm:auto-pause':   { label: 'Alarm (pause)',   color: 'text-blue-300',  dot: 'bg-blue-300' },
  'sweep:auto-clockout':{ label: 'Auto clock-out',  color: 'text-amber-400', dot: 'bg-amber-400' },
  'sweep:14h-safety':   { label: '14-h safety net', color: 'text-red-400',   dot: 'bg-red-400' },
  'admin:force-stop':   { label: 'Admin force-stop',color: 'text-orange-400',dot: 'bg-orange-400' },
  'sw:notification':    { label: 'Notification btn',color: 'text-purple-400',dot: 'bg-purple-400' },
};

const UNKNOWN_REASON = { label: 'Unknown', color: 'text-zinc-500', dot: 'bg-zinc-500' };

function fmtAuditTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const daysDiff = Math.floor((now.getTime() - ms) / 86400000);
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (daysDiff === 0) return `Today ${timeStr}`;
  if (daysDiff === 1) return `Yesterday ${timeStr}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${timeStr}`;
}

function fmtDurShort(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const ClockOutAuditLog = ({ logs }: { logs: TimeLog[] }) => {
  const [expanded, setExpanded] = useState(false);
  const [filterReason, setFilterReason] = useState<string>('all');

  // Only completed logs, sorted newest first
  const completed = useMemo(() => {
    return logs
      .filter(l => l.endTime)
      .sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0));
  }, [logs]);

  const filtered = useMemo(() => {
    if (filterReason === 'all') return completed;
    if (filterReason === 'system') {
      return completed.filter(l => l.stopReason && l.stopReason !== 'manual');
    }
    return completed.filter(l => (l.stopReason ?? 'manual') === filterReason);
  }, [completed, filterReason]);

  const systemCount = useMemo(() =>
    completed.filter(l => l.stopReason && l.stopReason !== 'manual').length,
    [completed]
  );

  const displayed = expanded ? filtered : filtered.slice(0, 10);

  return (
    <div className="bg-zinc-900/50 border border-white/5 rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Clock-Out Audit Log</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            See whether each clock-out was manual, by alarm, or forced by the system
            {systemCount > 0 && (
              <span className="ml-2 text-amber-400 font-medium">{systemCount} system-initiated</span>
            )}
          </p>
        </div>
        {/* Filter pills */}
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {(['all', 'manual', 'system'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilterReason(f)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                filterReason === f
                  ? 'bg-orange-500 border-orange-500 text-white'
                  : 'border-white/10 text-zinc-400 hover:border-white/25'
              }`}
            >
              {f === 'all' ? 'All' : f === 'manual' ? 'Manual' : 'System'}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="px-4 pb-4 text-xs text-zinc-600 italic">No completed logs yet.</div>
      ) : (
        <>
          {/* Column headers */}
          <div className="px-4 py-1.5 grid grid-cols-[1fr_90px_80px_130px] gap-2 text-[10px] uppercase tracking-widest text-zinc-600 border-t border-white/5">
            <span>Worker / Job</span>
            <span>Duration</span>
            <span>Clocked out</span>
            <span>Reason</span>
          </div>
          <div className="divide-y divide-white/5">
            {displayed.map(l => {
              const meta = STOP_REASON_META[l.stopReason ?? 'manual'] ?? UNKNOWN_REASON;
              const isSystem = l.stopReason && l.stopReason !== 'manual';
              return (
                <div
                  key={l.id}
                  className={`px-4 py-2.5 grid grid-cols-[1fr_90px_80px_130px] gap-2 items-center text-xs ${isSystem ? 'bg-amber-500/5' : ''}`}
                >
                  <div className="min-w-0">
                    <p className="text-white font-medium truncate">{l.userName}</p>
                    <p className="text-zinc-500 truncate">{l.customer || l.jobId}</p>
                  </div>
                  <span className="text-zinc-300 tabular-nums">
                    {(l.durationSeconds != null || l.durationMinutes != null) ? fmtDurShort(lMs(l)) : '—'}
                  </span>
                  <span className="text-zinc-400 tabular-nums">
                    {l.endTime ? fmtAuditTime(l.endTime) : '—'}
                  </span>
                  <span className={`flex items-center gap-1.5 font-medium ${meta.color}`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
                    {meta.label}
                  </span>
                </div>
              );
            })}
          </div>
          {filtered.length > 10 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full px-4 py-2.5 text-xs text-zinc-500 hover:text-white border-t border-white/5 transition-colors flex items-center justify-center gap-1"
            >
              {expanded ? <><ChevronUp className="w-3 h-3" /> Show less</> : <><ChevronDown className="w-3 h-3" /> Show all {filtered.length} records</>}
            </button>
          )}
        </>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════
//  SampleTimesEntry — admin enters a cycle-time sample which becomes
//  an isSample TimeLog the rate engine learns from. No worker clock
//  needed; this is the calibration tool.
// ═══════════════════════════════════════════════════════════════════════
const fmtRate = (minPerPiece: number): string =>
  minPerPiece >= 1 ? `${minPerPiece.toFixed(2)} min/pc` : `${(minPerPiece * 60).toFixed(1)} sec/pc`;

const SampleTimesEntry: React.FC<{
  addToast: any;
  allLogs: TimeLog[];
  knownOperations: string[];
  knownPartNumbers: string[];
  rateBuffer: number;
  shopRate: number;
  pricingMarkup: number;
  askConfirm: (opts: any) => Promise<boolean>;
}> = ({ addToast, allLogs, knownOperations, knownPartNumbers, rateBuffer, shopRate, pricingMarkup, askConfirm }) => {
  const [partNumber, setPartNumber] = React.useState('');
  const [operation, setOperation] = React.useState('');
  const [qty, setQty] = React.useState('');
  const [minutes, setMinutes] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  // Inline edit state: { sampleId: { qty, minutes } } when a row is being edited
  const [editing, setEditing] = React.useState<{ id: string; qty: string; minutes: string } | null>(null);

  // ── Group all sample logs by (partNumber lowercased, operation lowercased) ──
  // One visible row per group; group includes aggregate + the underlying logs.
  type Group = {
    key: string;                  // "abc-123|polish"
    partNumber: string;            // display
    operation: string;             // display (latest casing)
    samples: TimeLog[];            // individual rows, most recent first
    totalMinutes: number;
    totalPieces: number;
    avgRate: number;               // weighted avg min/piece
    latestAt: number;              // most recent createdAt — for sort order
  };
  const groups = React.useMemo<Group[]>(() => {
    const byKey = new Map<string, Group>();
    for (const l of allLogs) {
      if (!l.isSample) continue;
      if (!l.durationMinutes || !l.sessionQty) continue;
      if (!l.partNumber || !l.operation) continue;
      const pnKey = l.partNumber.trim().toLowerCase();
      const opKey = l.operation.trim().toLowerCase();
      if (!pnKey || !opKey) continue;
      const key = pnKey + '|' + opKey;
      const g = byKey.get(key);
      if (!g) {
        byKey.set(key, {
          key,
          partNumber: l.partNumber.trim(),
          operation: l.operation.trim(),
          samples: [l],
          totalMinutes: l.durationMinutes,
          totalPieces: l.sessionQty,
          avgRate: l.durationMinutes / l.sessionQty,
          latestAt: l.createdAt || 0,
        });
      } else {
        g.samples.push(l);
        g.totalMinutes += l.durationMinutes;
        g.totalPieces += l.sessionQty;
        g.avgRate = g.totalMinutes / g.totalPieces;
        if ((l.createdAt || 0) > g.latestAt) {
          g.latestAt = l.createdAt || 0;
          g.operation = l.operation.trim(); // most recent display casing wins
          g.partNumber = l.partNumber.trim();
        }
      }
    }
    // Sort each group's samples newest-first, then sort groups by recency
    for (const g of byKey.values()) {
      g.samples.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }
    return Array.from(byKey.values()).sort((a, b) => b.latestAt - a.latestAt);
  }, [allLogs]);

  // ── Filter groups by search text ──
  const filteredGroups = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(g =>
      g.partNumber.toLowerCase().includes(q) ||
      g.operation.toLowerCase().includes(q)
    );
  }, [groups, search]);

  // ── Live duplicate detection while typing ──
  const existingGroup = React.useMemo<Group | null>(() => {
    const pnKey = partNumber.trim().toLowerCase();
    const opKey = operation.trim().toLowerCase();
    if (!pnKey || !opKey) return null;
    return groups.find(g => g.partNumber.trim().toLowerCase() === pnKey && g.operation.trim().toLowerCase() === opKey) || null;
  }, [partNumber, operation, groups]);

  const save = async () => {
    const pn = partNumber.trim();
    const op = operation.trim();
    const q = parseInt(qty, 10);
    const m = parseFloat(minutes);
    if (!pn) { addToast('error', 'Part number is required.'); return; }
    if (!op) { addToast('error', 'Operation is required.'); return; }
    if (!(q > 0)) { addToast('error', 'Pieces must be greater than 0.'); return; }
    if (!(m > 0)) { addToast('error', 'Minutes must be greater than 0.'); return; }
    setBusy(true);
    try {
      const now = Date.now();
      const start = now - Math.round(m * 60_000);
      const sample: TimeLog = {
        id: 'sample-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 7),
        jobId: 'sample',
        userId: 'sample',
        userName: 'Sample Entry',
        operation: op,
        startTime: start,
        endTime: now,
        durationMinutes: m,
        durationSeconds: Math.round(m * 60),
        partNumber: pn,
        status: 'completed',
        sessionQty: q,
        isSample: true,
        createdAt: now,
        updatedAt: now,
      };
      await DB.updateTimeLog(sample);
      const rate = m / q;
      addToast('success', `✅ Saved: ${pn} · ${op} — ${q} pcs in ${m}m (${fmtRate(rate)})`);
      // Keep part+operation in the form so admin can quickly add another
      // sample for the same combo. Only clear qty + minutes.
      setQty(''); setMinutes('');
      // Auto-expand the group we just added to so the new row is visible
      const justKey = pn.toLowerCase() + '|' + op.toLowerCase();
      setExpanded(prev => new Set(prev).add(justKey));
    } catch (e) {
      console.error('[SampleTimesEntry] save failed:', e);
      addToast('error', 'Failed to save sample — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (log: TimeLog) => {
    const ok = await askConfirm({
      title: 'Remove this sample?',
      message: `${log.partNumber} · ${log.operation} — ${log.sessionQty} pcs / ${log.durationMinutes?.toFixed(1)} min. Cannot be undone.`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await DB.deleteTimeLog(log.id);
      addToast('info', 'Sample removed.');
    } catch (e) {
      console.error('[SampleTimesEntry] remove failed:', e);
      addToast('error', 'Failed to remove sample.');
    }
  };

  const saveEdit = async (original: TimeLog) => {
    if (!editing) return;
    const q = parseInt(editing.qty, 10);
    const m = parseFloat(editing.minutes);
    if (!(q > 0) || !(m > 0)) {
      addToast('error', 'Pieces and minutes must both be greater than 0.');
      return;
    }
    try {
      // A log's minutes always come from its start/end times, so move the
      // start to match the typed minutes (editing only the minutes used to be
      // recomputed straight back to the old value).
      const end = original.endTime || Date.now();
      await DB.updateTimeLog({
        ...original,
        sessionQty: q,
        startTime: end - Math.round(m * 60) * 1000,
        endTime: end,
        totalPausedMs: 0,
        updatedAt: Date.now(),
      });
      addToast('success', `Updated: ${original.partNumber} · ${original.operation} — ${q} pcs / ${m}m`);
      setEditing(null);
    } catch (e) {
      console.error('[SampleTimesEntry] edit failed:', e);
      addToast('error', 'Failed to update sample.');
    }
  };

  const toggleExpanded = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Datalist values — unique known operations + part numbers, alpha sorted
  const opSuggestions = React.useMemo(() => Array.from(new Set([
    ...knownOperations,
    ...groups.map(g => g.operation),
  ])).filter(Boolean).sort((a, b) => a.localeCompare(b)), [knownOperations, groups]);

  const partSuggestions = React.useMemo(() => Array.from(new Set([
    ...knownPartNumbers,
    ...groups.map(g => g.partNumber),
  ])).filter(Boolean).sort((a, b) => a.localeCompare(b)), [knownPartNumbers, groups]);

  return (
    <div className="px-4 py-4">
      <p className="text-sm font-semibold text-white">Cycle-time samples</p>
      <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
        Time yourself running a few parts through one operation, then log it here. FabTrack uses these
        to estimate any future job size for that part. Example: 30 pcs of polish in 60 min → 2 min/pc.
      </p>

      {/* ── Entry form ── */}
      <div className="bg-zinc-950/40 border border-white/[0.04] rounded-xl p-3 mt-3 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="text" placeholder="Part Number (e.g. ABC-123)"
            list="sample-parts" autoComplete="off"
            className="bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-amber-500/40"
            value={partNumber} onChange={e => setPartNumber(e.target.value)}
          />
          <input
            type="text" placeholder="Operation (e.g. polish, deburr, qc)"
            list="sample-ops" autoComplete="off"
            className="bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-amber-500/40"
            value={operation} onChange={e => setOperation(e.target.value)}
          />
          <input
            type="number" placeholder="Pieces in this sample" min="1" step="1"
            className="bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-amber-500/40"
            value={qty} onChange={e => setQty(e.target.value)}
          />
          <input
            type="number" placeholder="Minutes it took" min="0.1" step="0.1"
            className="bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-amber-500/40"
            value={minutes} onChange={e => setMinutes(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !busy) save(); }}
          />
        </div>
        <datalist id="sample-parts">{partSuggestions.map(p => <option key={p} value={p} />)}</datalist>
        <datalist id="sample-ops">{opSuggestions.map(o => <option key={o} value={o} />)}</datalist>

        {/* Live preview: time + pricing math */}
        {(() => {
          const q = parseInt(qty, 10);
          const m = parseFloat(minutes);
          if (!(q > 0) || !(m > 0)) return null;
          const rate = m / q;                  // min per piece
          const buffered = rate * (rateBuffer || 1);
          // Pricing math (only if shopRate configured)
          const laborPerPc = shopRate > 0 ? (rate / 60) * shopRate : 0;        // $ per pc, time-based
          const suggestedPerPc = laborPerPc * (pricingMarkup || 1);            // marked up
          const revenue1000 = suggestedPerPc * 1000;
          return (
            <div className="space-y-1.5">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                <p className="text-[11px] text-emerald-300 font-bold">
                  ⏱ Rate: {fmtRate(rate)} · 1000 pcs ≈ {(rate * 1000 / 60).toFixed(1)}h
                  {rateBuffer > 1 && <span className="text-emerald-400/70 ml-1">· w/ {Math.round((rateBuffer - 1) * 100)}% buffer: {(buffered * 1000 / 60).toFixed(1)}h</span>}
                </p>
              </div>
              {shopRate > 0 ? (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 space-y-0.5">
                  <p className="text-[11px] text-amber-300 font-bold">
                    💰 Labor cost: ${laborPerPc.toFixed(4)}/pc · @ {Math.round((pricingMarkup || 1) * 100)}% markup → <span className="text-amber-200">${suggestedPerPc.toFixed(3)}/pc</span>
                  </p>
                  <p className="text-[10px] text-amber-400/70">
                    1000 pcs revenue ≈ ${revenue1000.toFixed(2)} (labor cost ${(laborPerPc * 1000).toFixed(2)}, margin ${(revenue1000 - laborPerPc * 1000).toFixed(2)})
                  </p>
                </div>
              ) : (
                <div className="bg-zinc-800/40 border border-white/[0.04] rounded-lg px-3 py-2">
                  <p className="text-[10px] text-zinc-500">
                    💰 Set your shop hourly rate in Settings → Financial to see suggested charge per part.
                  </p>
                </div>
              )}
            </div>
          );
        })()}
        {existingGroup && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
            <p className="text-[11px] text-amber-300 font-bold">
              ℹ {existingGroup.samples.length} existing sample{existingGroup.samples.length === 1 ? '' : 's'} for this part/operation — current avg: {fmtRate(existingGroup.avgRate)}. Adding this one will combine.
            </p>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button" disabled={busy}
            onClick={save}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-black tracking-wide transition-colors"
          >
            {busy ? 'Saving…' : '+ Save Sample'}
          </button>
          {(partNumber || operation || qty || minutes) && (
            <button
              type="button"
              onClick={() => { setPartNumber(''); setOperation(''); setQty(''); setMinutes(''); }}
              className="px-3 py-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 text-xs font-bold transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Grouped sample list ── */}
      {groups.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.12em]">
              {groups.length} part/op pair{groups.length === 1 ? '' : 's'} · {allLogs.filter(l => l.isSample).length} samples total
            </p>
            {groups.length > 3 && (
              <input
                type="text" placeholder="Filter by part or operation…"
                value={search} onChange={e => setSearch(e.target.value)}
                className="bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1 text-white text-[11px] w-48 focus:outline-none focus:border-amber-500/40"
              />
            )}
          </div>

          <div className="bg-zinc-950/60 rounded-xl border border-white/[0.04] divide-y divide-white/[0.04] max-h-96 overflow-y-auto">
            {filteredGroups.length === 0 && (
              <div className="px-3 py-4 text-center text-[11px] text-zinc-500">No samples match "{search}"</div>
            )}
            {filteredGroups.map(g => {
              const open = expanded.has(g.key);
              return (
                <div key={g.key} className="text-xs">
                  {/* Group header row — aggregate */}
                  <button
                    type="button"
                    onClick={() => toggleExpanded(g.key)}
                    className="w-full px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-zinc-900/40 transition-colors text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-mono font-bold text-white truncate">
                        {g.partNumber} <span className="text-zinc-500">·</span> <span className="text-zinc-300">{g.operation}</span>
                      </p>
                      <p className="text-[10px] text-zinc-500 mt-0.5 truncate">
                        {g.samples.length} sample{g.samples.length === 1 ? '' : 's'} · {g.totalPieces.toLocaleString()} pcs · {g.totalMinutes.toFixed(1)} min · <span className="text-emerald-400 font-bold">{fmtRate(g.avgRate)}</span>
                      </p>
                    </div>
                    <span className="text-zinc-500 text-[10px] shrink-0">{open ? '▾' : '▸'}</span>
                  </button>
                  {/* Expanded individual samples */}
                  {open && (
                    <div className="bg-zinc-900/30 px-3 pb-2.5 pt-1 space-y-1">
                      {g.samples.map(s => {
                        const isEditing = editing?.id === s.id;
                        const r = (s.durationMinutes || 0) / (s.sessionQty || 1);
                        return (
                          <div key={s.id} className="flex items-center gap-2 text-[11px] py-1">
                            {isEditing ? (
                              <>
                                <input
                                  type="number" min="1" step="1"
                                  className="bg-zinc-950 border border-white/10 rounded px-2 py-1 text-white w-16 font-mono focus:outline-none focus:border-amber-500/40"
                                  value={editing!.qty}
                                  onChange={e => setEditing(prev => prev ? { ...prev, qty: e.target.value } : prev)}
                                  placeholder="pcs"
                                />
                                <span className="text-zinc-600">pcs ·</span>
                                <input
                                  type="number" min="0.1" step="0.1"
                                  className="bg-zinc-950 border border-white/10 rounded px-2 py-1 text-white w-20 font-mono focus:outline-none focus:border-amber-500/40"
                                  value={editing!.minutes}
                                  onChange={e => setEditing(prev => prev ? { ...prev, minutes: e.target.value } : prev)}
                                  placeholder="min"
                                />
                                <span className="text-zinc-600">min</span>
                                <button type="button" onClick={() => saveEdit(s)} className="ml-auto text-emerald-400 hover:text-emerald-300 font-bold">Save</button>
                                <button type="button" onClick={() => setEditing(null)} className="text-zinc-500 hover:text-white">Cancel</button>
                              </>
                            ) : (
                              <>
                                <span className="text-zinc-400 font-mono">{s.sessionQty} pcs</span>
                                <span className="text-zinc-600">·</span>
                                <span className="text-zinc-400 font-mono">{s.durationMinutes?.toFixed(1)} min</span>
                                <span className="text-zinc-600">·</span>
                                <span className="text-emerald-400 font-bold">{fmtRate(r)}</span>
                                {s.createdAt && (
                                  <span className="text-zinc-600 text-[10px] ml-1">
                                    {new Date(s.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setEditing({ id: s.id, qty: String(s.sessionQty || ''), minutes: String(s.durationMinutes || '') })}
                                  className="ml-auto text-zinc-500 hover:text-amber-400 px-1.5 py-0.5 transition-colors"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => remove(s)}
                                  className="text-zinc-500 hover:text-red-400 px-1.5 py-0.5 transition-colors"
                                >
                                  Remove
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {groups.length === 0 && (
        <p className="text-[11px] text-zinc-600 mt-3 italic">No samples yet. Add one above to start training the rate engine.</p>
      )}
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// SETTINGS SEARCH — find any setting by keyword and jump straight to it.
// Each entry maps plain-language synonyms → a tab + a data-settings-anchor
// attribute somewhere in that tab's markup. Selecting a result switches
// tabs, scrolls the anchored section into view, and flashes it briefly.
// ═════════════════════════════════════════════════════════════════════
type SettingsTabId = 'profile' | 'schedule' | 'production' | 'financial' | 'goals' | 'documents' | 'tv' | 'system';

interface SettingsSearchEntry {
  /** Plain-language synonyms a shop owner might type */
  keywords: string[];
  label: string;
  tab: SettingsTabId;
  anchor: string;
  /** Documents tab has a Quote/Traveler sub-toggle — jump must pick the right pane */
  docSubTab?: 'quote' | 'traveler';
}

const SETTINGS_TAB_LABELS: Record<SettingsTabId, string> = {
  profile: 'Shop Profile',
  schedule: 'Schedule & Time',
  system: 'Defaults',
  production: 'Production',
  financial: 'Financial',
  goals: 'Goals',
  documents: 'Documents',
  tv: 'TV Display',
};

const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[] = [
  // ── Shop Profile ──
  { label: 'Company Logo', tab: 'profile', anchor: 'profile-logo', keywords: ['logo', 'picture', 'brand', 'image', 'upload', 'branding'] },
  { label: 'Company Name', tab: 'profile', anchor: 'profile-company', keywords: ['company', 'name', 'business', 'shop name'] },
  { label: 'Phone Number', tab: 'profile', anchor: 'profile-company', keywords: ['phone', 'telephone', 'number', 'contact'] },
  { label: 'Company Email', tab: 'profile', anchor: 'profile-company', keywords: ['email', 'contact', 'mail'] },
  { label: 'Company Address', tab: 'profile', anchor: 'profile-company', keywords: ['address', 'street', 'location', 'city'] },
  { label: 'Website & Tax ID', tab: 'profile', anchor: 'profile-company', keywords: ['website', 'url', 'tax', 'ein', 'vat'] },
  { label: 'Theme (Dark / Light)', tab: 'profile', anchor: 'profile-theme', keywords: ['theme', 'dark', 'light', 'mode', 'appearance', 'color scheme'] },
  // ── Schedule & Time ──
  { label: 'Shift Alarms & Breaks', tab: 'schedule', anchor: 'schedule-alarms', keywords: ['alarm', 'shift', 'bell', 'buzzer', 'break', 'sound', 'horn', 'siren', 'start time', 'end time'] },
  { label: 'Auto-Pause at Lunch', tab: 'schedule', anchor: 'schedule-lunch', keywords: ['lunch', 'meal', 'pause', 'auto pause', 'timers'] },
  { label: 'Auto Clock-Out', tab: 'schedule', anchor: 'schedule-autoclockout', keywords: ['clock out', 'clockout', 'auto stop', 'forgot', 'timer', 'end of day', 'punch out'] },
  { label: 'Clock-Out Audit Log', tab: 'schedule', anchor: 'schedule-audit', keywords: ['audit', 'history', 'log', 'clock out', 'who forgot'] },
  // ── Production ──
  { label: 'Workflow Stages', tab: 'production', anchor: 'production-stages', keywords: ['stages', 'workflow', 'pipeline', 'status', 'kanban', 'steps', 'job stages'] },
  { label: 'Operations List', tab: 'production', anchor: 'production-operations', keywords: ['operations', 'ops', 'process', 'tasks', 'deburr', 'tumble', 'work types'] },
  { label: 'Operations → Stage Routing', tab: 'production', anchor: 'production-opmap', keywords: ['routing', 'route', 'auto route', 'map', 'mapper', 'clock in moves job'] },
  { label: 'Per-Customer Pipelines', tab: 'production', anchor: 'production-pipelines', keywords: ['customer pipeline', 'custom workflow', 'per customer', 'stage sequence'] },
  { label: 'Machines & Stations', tab: 'production', anchor: 'production-machines', keywords: ['machine', 'station', 'equipment', 'tumbler', 'workcenter', 'work center'] },
  { label: 'Process Library (Pricing Templates)', tab: 'production', anchor: 'production-processes', keywords: ['process library', 'pricing', 'templates', 'presets', 'line items'] },
  { label: 'Customers', tab: 'production', anchor: 'production-customers', keywords: ['customer', 'client', 'company', 'contact', 'portal', 'accounts'] },
  { label: 'Vendors & Suppliers', tab: 'production', anchor: 'production-vendors', keywords: ['vendor', 'supplier', 'purchase order', 'po', 'outside service'] },
  // ── Financial ──
  { label: 'Live Shop Economics (30 days)', tab: 'financial', anchor: 'financial-live', keywords: ['profit', 'margin', 'revenue', 'economics', 'money', 'cost', 'gross'] },
  { label: 'Shop Hourly Rate', tab: 'financial', anchor: 'financial-rates', keywords: ['shop rate', 'hourly', 'rate', 'labor', 'wage', 'fallback rate'] },
  { label: 'Monthly Overhead', tab: 'financial', anchor: 'financial-rates', keywords: ['overhead', 'rent', 'utilities', 'insurance', 'fixed costs'] },
  { label: 'Productive Hours / Month', tab: 'financial', anchor: 'financial-rates', keywords: ['productive hours', 'billable', 'work hours', 'monthly hours'] },
  { label: 'Monthly Revenue Goal', tab: 'financial', anchor: 'financial-rates', keywords: ['revenue goal', 'sales target', 'monthly goal'] },
  { label: 'Quote Calculator', tab: 'financial', anchor: 'financial-calculator', keywords: ['calculator', 'quote', 'price', 'estimate', 'markup', 'per part'] },
  // ── Goals ──
  { label: 'Shop Goals & Targets', tab: 'goals', anchor: 'goals-overview', keywords: ['goals', 'targets', 'kpi', 'metrics', 'on-time', 'rework', 'jobs per week'] },
  { label: 'Edit Goal Targets', tab: 'goals', anchor: 'goals-list', keywords: ['goal target', 'edit goal', 'goal period', 'goal color', 'show on tv'] },
  // ── Documents · Quote / Invoice ──
  { label: 'Document Logo', tab: 'documents', anchor: 'documents-logo', keywords: ['logo', 'document logo', 'quote logo', 'brand'] },
  { label: 'Quote Numbering & Prefix', tab: 'documents', anchor: 'documents-numbering', docSubTab: 'quote', keywords: ['numbering', 'prefix', 'quote number', 'invoice number', 'next number', 'start number'] },
  { label: 'Quote Page (Valid-Until / Terms)', tab: 'documents', anchor: 'documents-header', docSubTab: 'quote', keywords: ['header', 'valid until', 'expires', 'due date', 'terms', 'conditions'] },
  { label: 'Quote Table Columns', tab: 'documents', anchor: 'documents-table', docSubTab: 'quote', keywords: ['table', 'columns', 'unit', 'rate', 'quantity', 'qty'] },
  { label: 'Signature Lines & Certificate', tab: 'documents', anchor: 'documents-footer', docSubTab: 'quote', keywords: ['signature', 'sign', 'certificate', 'conformance', 'comment', 'footer'] },
  { label: 'Project Detail Fields', tab: 'documents', anchor: 'documents-project-fields', docSubTab: 'quote', keywords: ['project fields', 'po number', 'part number', 'custom fields'] },
  { label: 'Quote Defaults (Terms · Tax · Markup)', tab: 'documents', anchor: 'documents-defaults', docSubTab: 'quote', keywords: ['payment terms', 'tax', 'discount', 'markup', 'margin', 'net 30', 'defaults'] },
  { label: 'Snippet Library', tab: 'documents', anchor: 'documents-snippets', docSubTab: 'quote', keywords: ['snippet', 'text blocks', 'boilerplate', 'reusable text'] },
  { label: 'Document Accent Color', tab: 'documents', anchor: 'documents-color', docSubTab: 'quote', keywords: ['color', 'accent', 'document color', 'brand color'] },
  { label: 'Watermark (Draft / Confidential)', tab: 'documents', anchor: 'documents-watermark', docSubTab: 'quote', keywords: ['watermark', 'draft', 'sample', 'confidential', 'void', 'copy'] },
  // ── Documents · Job Traveler ──
  { label: 'Job Traveler Layout', tab: 'documents', anchor: 'documents-traveler', docSubTab: 'traveler', keywords: ['traveler', 'traveller', 'route sheet', 'shop floor', 'print', 'work order'] },
  { label: 'Traveler QR Code', tab: 'documents', anchor: 'documents-traveler', docSubTab: 'traveler', keywords: ['qr', 'qr code', 'barcode', 'scan'] },
  { label: 'Traveler Header Banner (ITAR etc.)', tab: 'documents', anchor: 'documents-traveler', docSubTab: 'traveler', keywords: ['banner', 'itar', 'as9100', 'certified', 'header strip'] },
  { label: 'Traveler Sign-Off & Operation Log', tab: 'documents', anchor: 'documents-traveler', docSubTab: 'traveler', keywords: ['sign off', 'signoff', 'operation log', 'inspector', 'rows'] },
  // ── TV Display ──
  { label: 'Connect a TV (code)', tab: 'tv', anchor: 'tv-connect', keywords: ['connect tv', 'add tv', 'new tv', 'pair', 'pairing', 'code', 'wall tv', 'wall display', 'monitor', 'screen'] },
  { label: 'Your TVs (status, refresh, disconnect)', tab: 'tv', anchor: 'tv-connect', keywords: ['tv status', 'online', 'offline', 'not responding', 'refresh tv', 'reload', 'disconnect', 'rename tv', 'show name', 'identify'] },
  { label: 'TV Link (direct link / start over)', tab: 'tv', anchor: 'tv-link', keywords: ['tv link', 'tv url', 'token', 'stream', 'shareable', 'reset link', 'new link'] },
  { label: 'Keep the TV On (setup tips)', tab: 'tv', anchor: 'tv-setup', keywords: ['turns off', 'turn off', 'sleep', 'screen saver', 'screensaver', 'power saving', 'eco', 'auto off', 'kiosk', 'fire tv', 'hdmi', 'cec', 'input', 'switches'] },
  { label: 'TV Screen (text size, fit, header)', tab: 'tv', anchor: 'tv-display', keywords: ['text size', 'bigger', 'font', 'overscan', 'cut off', 'edges', 'burn in', 'clock', 'header', 'stats', 'scroll speed', 'connection'] },
  { label: 'TV After Hours & Daily Refresh', tab: 'tv', anchor: 'tv-quiet', keywords: ['quiet hours', 'night', 'after hours', 'weekend', 'dim', 'schedule', 'refresh time', 'reload time'] },
  { label: 'Weather Location', tab: 'tv', anchor: 'tv-weather', keywords: ['weather', 'temperature', 'city', 'zip', 'location', 'forecast'] },
  { label: 'TV Privacy (Revenue / Names)', tab: 'tv', anchor: 'tv-privacy', keywords: ['privacy', 'hide', 'revenue', 'customer names', 'sensitive', 'dollar'] },
  { label: 'TV Slides', tab: 'tv', anchor: 'tv-slides', keywords: ['slides', 'slideshow', 'rotate', 'duration', 'slide length', 'order', 'announcement', 'messages', 'safety', 'leaderboard'] },
  { label: 'Live Floor Worker Cards', tab: 'tv', anchor: 'tv-floor-cards', keywords: ['worker cards', 'live floor', 'time bar', 'progress bar', 'customer on cards'] },
  // ── System / Defaults ──
  { label: 'Default Job Priority', tab: 'system', anchor: 'system-job-defaults', keywords: ['priority', 'urgent', 'default priority', 'new job'] },
  { label: 'Default Payment Terms', tab: 'documents', anchor: 'documents-defaults', docSubTab: 'quote', keywords: ['payment terms', 'net 30', 'net 15', 'terms'] },
  { label: 'Weekly Goal Hours (Workers)', tab: 'system', anchor: 'system-worker-defaults', keywords: ['weekly hours', 'worker goal', 'goal hours', '40 hours', 'target hours'] },
  { label: 'Daily Email Recap', tab: 'system', anchor: 'system-recap', keywords: ['recap', 'daily email', 'summary', 'nightly', 'report', 'email'] },
  { label: 'Recap Send Time & Timezone', tab: 'system', anchor: 'system-recap', keywords: ['timezone', 'time zone', 'send time', 'auto send', 'schedule email'] },
  { label: 'Morning Briefing (Push)', tab: 'system', anchor: 'system-push', keywords: ['briefing', 'morning', 'push', 'notification', 'due today', 'overdue'] },
  { label: 'Worker Scorecards (Push)', tab: 'system', anchor: 'system-push', keywords: ['scorecard', 'end of shift', 'worker stats', 'push', 'pieces'] },
  { label: 'Rate Learning & Sample Times', tab: 'system', anchor: 'system-rate-learning', keywords: ['rate learning', 'sample times', 'estimates', 'learn', 'pieces per hour'] },
  { label: 'Estimate Buffer %', tab: 'system', anchor: 'system-rate-learning', keywords: ['buffer', 'padding', 'generosity', 'estimate padding'] },
  { label: 'Pricing Markup %', tab: 'system', anchor: 'system-rate-learning', keywords: ['pricing markup', 'markup', 'charge per part', 'labor cost'] },
  { label: 'Over-Budget Email Alerts', tab: 'system', anchor: 'system-rate-learning', keywords: ['over budget', 'alert', 'emailjs', 'exceeded', 'warning email'] },
  { label: 'Backfill Historical Pieces', tab: 'system', anchor: 'system-rate-learning', keywords: ['backfill', 'historical', 'pieces data', 'old jobs'] },
];

/** Token-AND matcher with light ranking: exact keyword > prefix > substring. */
const searchSettingsIndex = (query: string): SettingsSearchEntry[] => {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored: { entry: SettingsSearchEntry; score: number }[] = [];
  for (const entry of SETTINGS_SEARCH_INDEX) {
    const label = entry.label.toLowerCase();
    let total = 0;
    let allMatch = true;
    for (const t of tokens) {
      let s = 0;
      if (label.startsWith(t)) s = 5;
      else if (label.includes(t)) s = 3;
      for (const k of entry.keywords) {
        if (k === t) { s = Math.max(s, 6); break; }
        if (k.startsWith(t)) s = Math.max(s, 4);
        else if (k.includes(t)) s = Math.max(s, 2);
      }
      if (s === 0) { allMatch = false; break; }
      total += s;
    }
    if (allMatch) scored.push({ entry, score: total });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 8).map(s => s.entry);
};

// Compact search input + dropdown. Self-contained query state so the desktop
// sidebar and mobile bar instances stay independent. Dropdown is absolutely
// positioned so it never shifts the surrounding layout.
const SettingsSearchBox = ({ onJump }: { onJump: (entry: SettingsSearchEntry) => void }) => {
  const [q, setQ] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const matches = useMemo(() => searchSettingsIndex(q), [q]);
  const open = q.trim().length >= 2;

  const select = (entry: SettingsSearchEntry) => {
    setQ('');
    setActiveIdx(0);
    onJump(entry);
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
        <input
          type="text"
          value={q}
          onChange={e => { setQ(e.target.value); setActiveIdx(0); }}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              setQ(''); setActiveIdx(0); (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Enter') {
              const m = matches[activeIdx] || matches[0];
              if (m) select(m);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault(); setActiveIdx(i => Math.min(i + 1, matches.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0));
            }
          }}
          placeholder="Search settings…"
          aria-label="Search settings"
          role="combobox"
          aria-expanded={open}
          className="w-full bg-zinc-900/70 border border-white/10 rounded-xl pl-9 pr-8 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/40 focus:bg-zinc-900 transition-colors"
        />
        {q && (
          <button
            type="button"
            onClick={() => { setQ(''); setActiveIdx(0); }}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white p-1.5 rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-3 h-3" aria-hidden="true" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-[70] bg-zinc-900 border border-white/10 rounded-xl shadow-2xl shadow-black/60 overflow-hidden animate-fade-in">
          {matches.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-zinc-500">No settings match “{q.trim()}”</p>
          ) : (
            <div className="max-h-72 overflow-y-auto py-1" role="listbox">
              {matches.map((m, i) => (
                <button
                  key={`${m.anchor}-${m.label}`}
                  type="button"
                  role="option"
                  aria-selected={i === activeIdx}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => select(m)}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 transition-colors ${i === activeIdx ? 'bg-amber-500/15' : ''}`}
                >
                  <span className={`text-xs font-bold truncate ${i === activeIdx ? 'text-white' : 'text-zinc-300'}`}>{m.label}</span>
                  <span className="text-[10px] text-zinc-500 shrink-0">{SETTINGS_TAB_LABELS[m.tab]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const SettingsView = ({ addToast, userId }: { addToast: any; userId?: string }) => {
  const { confirm: askConfirm, ConfirmHost } = useConfirm();
  const [settings, setSettings] = useState<SystemSettings>(DB.getSettings());
  const [newOp, setNewOp] = useState('');
  const [newClient, setNewClient] = useState('');
  // Remembers the tab for this browser session — leaving Settings and coming
  // back used to drop you on Shop Profile every time.
  const [settingsTab, setSettingsTabState] = useState<SettingsTabId>(() => {
    try {
      const saved = sessionStorage.getItem('fabtrack_settings_tab');
      if (saved && saved in SETTINGS_TAB_LABELS) return saved as SettingsTabId;
    } catch {}
    return 'profile';
  });
  const setSettingsTab = useCallback((tab: SettingsTabId) => {
    setSettingsTabState(tab);
    try { sessionStorage.setItem('fabtrack_settings_tab', tab); } catch {}
  }, []);
  // Within the Documents tab, split customer-facing Quote/Invoice settings
  // from internal Job Traveler settings — admins were confusing them.
  const [docSubTab, setDocSubTab] = useState<'quote' | 'traveler'>('quote');
  const [opsOpen, setOpsOpen] = useState(false);
  const [clientsOpen, setClientsOpen] = useState(false);
  // Shop data for the tabs that need it (clock-out audit, rate learning,
  // recap). Loaded only while one of those tabs is open — it used to be
  // subscribed on every Settings visit (the whole jobs list, photos and all)
  // just to feed a mock TV preview.
  const [shopJobs, setShopJobs] = useState<Job[]>([]);
  const [shopLogs, setShopLogs] = useState<TimeLog[]>([]);

  // Dirty flag — true while local edits haven't been written to Firestore yet.
  // The settings subscription must NOT overwrite local state during that window:
  // our own save echoes back through the snapshot (clobbering whatever the user
  // typed in the last 1.5s), and another device's update mid-edit silently
  // discards the user's in-progress changes.
  const dirtyRef = useRef(false);
  // Monotonic edit counter — bumped on every local change. A completing save
  // only clears the dirty flag if NO newer edits happened while it was in
  // flight; otherwise a remote snapshot arriving in that gap would clobber
  // the user's newest unsaved keystrokes.
  const editSeqRef = useRef(0);
  // Honest save indicator — driven by the REAL save promise, not a blind timer.
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'queued' | 'error'>('idle');
  const saveStateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashSaveState = (s: 'saved' | 'queued' | 'error') => {
    setSaveState(s);
    if (saveStateTimer.current) clearTimeout(saveStateTimer.current);
    saveStateTimer.current = setTimeout(() => setSaveState('idle'), s === 'saved' ? 1800 : 4000);
  };

  // ── Saving ─────────────────────────────────────────────────────────
  // `baseRef` is the settings as last saved / received from the server. Each
  // save writes only the fields that differ from it (cleared ones are really
  // deleted), so: clearing a value sticks, and this screen never overwrites a
  // field another device changed. Edits save 1.2 s after typing stops, and
  // immediately when you leave the page or switch apps.
  // `baseRef` holds its own deep copy: editing a settings object in place
  // somewhere in this screen must never change "what was saved" too, or the
  // edit looks unchanged and is silently never saved.
  const snapshot = (x: SystemSettings): SystemSettings => JSON.parse(JSON.stringify(x));
  const baseRef = useRef<SystemSettings>(null as unknown as SystemSettings);
  if (baseRef.current === null) baseRef.current = snapshot(settings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Fields the server or another flow owns — this screen never writes them.
  // A copy of settings held across a confirm dialog wrote an old
  // recapLastSentDate back after the cron stamped it, and the recap email
  // went out twice.
  const SERVER_OWNED = new Set(['recapLastSentDate', 'recapLastError', 'recapRetry']);
  const diffSettings = (base: SystemSettings, cur: SystemSettings): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(cur)]);
    keys.forEach(k => {
      if (SERVER_OWNED.has(k)) return;
      const a = (base as any)[k], b = (cur as any)[k];
      if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = b;
    });
    return out;
  };
  const flushSave = useCallback(async (): Promise<boolean> => {
    const changes = diffSettings(baseRef.current, settingsRef.current);
    if (Object.keys(changes).length === 0) { dirtyRef.current = false; return true; }
    const mySeq = editSeqRef.current;
    setSaveState('saving');
    try {
      // 'queued' = offline: kept on this device, syncs by itself (no endless "Saving…")
      const result = await DB.saveSettingsChanges(changes as any, { base: baseRef.current });
      const next: any = { ...baseRef.current };
      for (const [k, v] of Object.entries(changes)) { if (v === undefined) delete next[k]; else next[k] = JSON.parse(JSON.stringify(v)); }
      baseRef.current = next;
      if (editSeqRef.current === mySeq) dirtyRef.current = false;
      flashSaveState(result === 'queued' ? 'queued' : 'saved');
      return true;
    } catch {
      flashSaveState('error');   // stays dirty — retried on the next edit / leave
      return false;
    }
  }, []);
  /** Change + save right away (no 1.2 s wait) — for things other devices act on
   *  immediately, like a new TV link. */
  const saveNow = useCallback(async (changes: Partial<SystemSettings>): Promise<boolean> => {
    const merged = { ...settingsRef.current, ...changes };
    settingsRef.current = merged;
    setSettings(merged);
    return flushSave();
  }, [flushSave]);

  // Logo: everything in Settings shares ONE ~1 MB record, and a 400 px-wide
  // PNG of a tall or photographic logo could take most of it — then every
  // later Settings save failed. Both sides are capped and it's stored as WebP
  // (keeps transparency, a fraction of PNG's size). The toast now says what
  // really happened, and a logo that can't be saved is dropped so it doesn't
  // block the next save.
  const saveLogo = async (file: File | undefined | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const im = new window.Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error("Couldn't read that image"));
        im.src = URL.createObjectURL(file);
      });
      let url = '';
      for (const [maxW, maxH, q] of [[400, 240, 0.9], [300, 180, 0.8], [200, 120, 0.7]] as const) {
        const scale = Math.min(1, maxW / img.width, maxH / img.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        url = canvas.toDataURL('image/webp', q);
        if (url.length <= 120_000) break;
      }
      if (url.length > 120_000) { addToast('error', 'That logo is too large — try a simpler or smaller image.'); return; }
      const ok = await saveNow({ companyLogo: url });
      if (ok) addToast('success', 'Logo saved');
      else {
        setSettings(prev => ({ ...prev, companyLogo: (baseRef.current as any).companyLogo }));
        addToast('error', "The logo didn't save — check the connection and try again.");
      }
    } catch (e: any) {
      addToast('error', e?.message || "Couldn't use that image");
    }
  };

  useEffect(() => {
    const unsub = DB.subscribeSettings((s) => {
      if (!dirtyRef.current) { baseRef.current = snapshot(s); setSettings(s); return; }
      // Local edits pending: keep them, but take another device's changes to
      // fields you haven't touched (those used to be dropped until a reload).
      const base = baseRef.current, local = settingsRef.current;
      let merged: any = local, changed = false;
      new Set([...Object.keys(s), ...Object.keys(base)]).forEach(k => {
        const remote = (s as any)[k], b = (base as any)[k], l = (local as any)[k];
        if (JSON.stringify(remote) === JSON.stringify(b)) return;      // not a remote change
        if (JSON.stringify(l) === JSON.stringify(b)) { merged = { ...merged, [k]: remote }; changed = true; }
      });
      baseRef.current = snapshot(s);
      if (changed) setSettings(merged);
    });
    return () => { unsub(); };
  }, []);

  const handleSave = () => {
    flushSave().then(ok => ok ? addToast('success', 'Settings saved') : addToast('error', 'Save failed — check connection'));
  };

  const needsShopData = settingsTab === 'schedule' || settingsTab === 'system';
  useEffect(() => {
    if (!needsShopData) return;
    const u1 = DB.subscribeJobs(setShopJobs);
    const u2 = DB.subscribeAllLogs(setShopLogs);   // backfill must see every session of a job
    return () => { u1(); u2(); };
  }, [needsShopData]);

  // Autosave: 1.2 s after the last change (only when something differs from what's saved).
  const settingsJson = JSON.stringify(settings);
  useEffect(() => {
    if (Object.keys(diffSettings(baseRef.current, settings)).length === 0) return;
    dirtyRef.current = true;
    ++editSeqRef.current;
    const timer = setTimeout(() => { flushSave(); }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsJson]);

  // Leaving the page / switching apps / closing Settings saves immediately —
  // edits made in the last second used to be lost.
  useEffect(() => {
    const flushIfDirty = () => { if (dirtyRef.current) flushSave(); };
    const onVis = () => { if (document.visibilityState === 'hidden') flushIfDirty(); };
    window.addEventListener('pagehide', flushIfDirty);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flushIfDirty);
      document.removeEventListener('visibilitychange', onVis);
      flushIfDirty();
    };
  }, [flushSave]);
  const handleAddOp = () => { if (!newOp.trim()) return; const ops = settings.customOperations || []; if (ops.includes(newOp.trim())) return; setSettings({ ...settings, customOperations: [...ops, newOp.trim()] }); setNewOp(''); };
  const handleDeleteOp = (op: string) => { setSettings({ ...settings, customOperations: (settings.customOperations || []).filter(o => o !== op) }); };
  // Clients + ops: just update local state; autosave persists it 1.5s later (same path as every other field)
  const handleAddClient = () => {
    if (!newClient.trim()) return;
    const clients = settings.clients || [];
    if (clients.map(c => c.toLowerCase()).includes(newClient.trim().toLowerCase())) return;
    setSettings({ ...settings, clients: [...clients, newClient.trim()] });
    setNewClient('');
  };
  const handleDeleteClient = (client: string) => {
    setSettings({ ...settings, clients: (settings.clients || []).filter(c => c !== client) });
  };

  const ohRate = (settings.monthlyOverhead || 0) / (settings.monthlyWorkHours || 160);
  const trueCost = (settings.shopRate || 0) + ohRate;

  // Sidebar grouped nav — Apple-like with section labels
  const sideGroups: { label: string; items: { id: typeof settingsTab; label: string; icon: any; badge?: string }[] }[] = [
    {
      label: 'General',
      items: [
        { id: 'profile', label: 'Shop Profile', icon: Briefcase },
        { id: 'schedule', label: 'Schedule & Time', icon: Clock },
        { id: 'system', label: 'Defaults', icon: Settings },
      ],
    },
    {
      label: 'Operations',
      items: [
        { id: 'production', label: 'Production', icon: Activity },
        { id: 'financial', label: 'Financial', icon: Calculator },
        { id: 'goals', label: 'Goals', icon: Zap },
      ],
    },
    {
      label: 'Output',
      items: [
        { id: 'documents', label: 'Documents', icon: FileText },
        { id: 'tv', label: 'TV Display', icon: Tv },
      ],
    },
  ];
  // Flat list for mobile pills
  const sideItems = sideGroups.flatMap(g => g.items);

  // ── Settings search: jump to any anchored section ────────────────────
  // Switch tab (and Documents sub-tab) first, then after a tick — once the
  // tab content has rendered — scroll the anchor into view and flash it.
  const jumpToSetting = useCallback((entry: SettingsSearchEntry) => {
    setSettingsTab(entry.tab);
    if (entry.docSubTab) setDocSubTab(entry.docSubTab);
    if (entry.anchor === 'production-operations') setOpsOpen(true); // collapsed by default
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-settings-anchor="${entry.anchor}"]`);
      if (!el) return;
      if (el instanceof HTMLDetailsElement) el.open = true; // expand collapsed <details> sections
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Restart the flash animation even if the same anchor is picked twice
      el.classList.remove('settings-anchor-flash');
      void el.offsetWidth;
      el.classList.add('settings-anchor-flash');
      window.setTimeout(() => el.classList.remove('settings-anchor-flash'), 1700);
    }, 80);
  }, []);

  // ── Email recap ──────────────────────────────────────────────────────
  const [recapSending, setRecapSending] = useState(false);
  const [recapStatus, setRecapStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleSendRecap = useCallback(async () => {
    if (!settings.recapEmail?.trim()) {
      setRecapStatus({ ok: false, msg: 'Enter an email address first.' });
      return;
    }
    setRecapSending(true);
    setRecapStatus(null);
    try {
      // The email server only sends to recap addresses that are SAVED in
      // settings — save a just-typed address first or the send is refused.
      if (!(await flushSave())) {
        setRecapStatus({ ok: false, msg: "Couldn't save the email address — check the connection and try again." });
        return;
      }
      // Parse comma-separated CC addresses
      const ccEmails = (settings.recapEmailCC || '')
        .split(',').map(e => e.trim()).filter(Boolean);
      const result = await sendDailyRecap({
        to: settings.recapEmail.trim(),
        ccEmails,
        logs: shopLogs,
        allJobs: shopJobs,
        users: [],
        shopName: settings.companyName || 'Your Shop',
        shopRate: settings.shopRate,
        openReworkCount: 0,
      });
      setRecapStatus({ ok: result.ok, msg: result.ok ? 'Recap sent!' : (result.error || 'Send failed') });
    } catch (e: any) {
      setRecapStatus({ ok: false, msg: e?.message || 'Unknown error' });
    } finally {
      setRecapSending(false);
    }
  }, [settings, shopLogs, shopJobs, flushSave]);

  return (
    <div className="flex gap-4 lg:gap-6 w-full animate-fade-in min-w-0 pb-6 md:pb-0">
      {/* Search-jump flash + scroll offset (keeps anchors clear of sticky bars) */}
      <style>{`
        @keyframes settingsFlash {
          0%   { box-shadow: 0 0 0 3px rgba(245,158,11,0.8), 0 0 24px rgba(245,158,11,0.25); }
          60%  { box-shadow: 0 0 0 3px rgba(245,158,11,0.45), 0 0 12px rgba(245,158,11,0.1); }
          100% { box-shadow: 0 0 0 3px rgba(245,158,11,0); }
        }
        .settings-anchor-flash { animation: settingsFlash 1.6s ease-out; }
        /* Mobile: clear the sticky app header + search + pill tabs (~150px);
           desktop sidebar layout only needs a small breathing gap. */
        [data-settings-anchor] { scroll-margin-top: 160px; }
        @media (min-width: 768px) { [data-settings-anchor] { scroll-margin-top: 24px; } }
      `}</style>
      {/* Floating save indicator — fixed position so it NEVER shifts layout
          (the old inline version grew the sticky mobile tab bar on every save,
          making the page jump while typing). Visible on every screen size,
          and honest: reflects the actual Firestore write, including failure. */}
      {saveState !== 'idle' && (
        <div
          role="status"
          className={`fixed bottom-6 inset-x-0 mx-auto w-fit z-[80] flex items-center gap-2 px-4 py-2 rounded-full border shadow-2xl backdrop-blur-xl text-xs font-black animate-fade-in pointer-events-none ${
            saveState === 'saving' ? 'bg-zinc-900/95 border-white/15 text-zinc-300' :
            saveState === 'saved'  ? 'bg-emerald-950/95 border-emerald-500/40 text-emerald-300' :
            saveState === 'queued' ? 'bg-amber-950/95 border-amber-500/40 text-amber-300' :
                                     'bg-red-950/95 border-red-500/40 text-red-300'
          }`}
        >
          {saveState === 'saving' && <><span className="w-3 h-3 rounded-full border-2 border-zinc-500 border-t-white animate-spin" aria-hidden="true" /> Saving…</>}
          {saveState === 'saved' && <><CheckCircle className="w-3.5 h-3.5" aria-hidden="true" /> Saved</>}
          {saveState === 'queued' && <><CheckCircle className="w-3.5 h-3.5" aria-hidden="true" /> Saved on this device — will sync when back online</>}
          {saveState === 'error' && <><AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> Couldn't save — check connection</>}
        </div>
      )}
      {/* ── LEFT SIDEBAR — Apple Settings style, grouped nav ── */}
      <aside className="w-52 xl:w-60 flex-shrink-0 hidden md:block">
        <div className="sticky top-4">
          {/* Search — finds any setting by keyword and jumps to it */}
          <div className="mb-4">
            <SettingsSearchBox onJump={jumpToSetting} />
          </div>
          {/* Header */}
          <div className="flex items-center justify-between px-2 mb-4">
            <p className="text-[11px] font-black text-zinc-500 uppercase tracking-[0.12em]">Settings</p>
            {saveState === 'saved' && (
              <span className="text-[10px] font-black text-emerald-400 flex items-center gap-1 animate-fade-in">
                <CheckCircle className="w-3 h-3" aria-hidden="true" /> Saved
              </span>
            )}
          </div>

          {/* Grouped nav sections */}
          <div className="space-y-5">
            {sideGroups.map(group => (
              <div key={group.label}>
                <p className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.15em] px-3 mb-1">{group.label}</p>
                <div className="bg-zinc-900/60 border border-white/[0.06] rounded-xl overflow-hidden">
                  {group.items.map((item, idx) => {
                    const active = settingsTab === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setSettingsTab(item.id)}
                        aria-current={active ? 'page' : undefined}
                        className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm transition-all text-left relative
                          ${idx > 0 ? 'border-t border-white/[0.04]' : ''}
                          ${active
                            ? 'bg-amber-500/15 text-white font-bold'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
                          }`}
                      >
                        {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-amber-500 rounded-r-full shadow-[0_0_8px_rgba(245,158,11,0.6)]" aria-hidden="true" />}
                        <span className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${active ? 'bg-amber-500 text-white' : 'bg-zinc-800 text-zinc-500'}`}>
                          <item.icon className="w-3.5 h-3.5" aria-hidden="true" />
                        </span>
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.badge && (
                          <span className="text-[9px] font-black bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded px-1 py-0.5">{item.badge}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Autosave note + manual save */}
          <div className="mt-5 space-y-2 px-1">
            <div className="flex items-center gap-2 px-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <p className="text-[10px] text-zinc-600">Autosaves as you type</p>
            </div>
            <button
              onClick={handleSave}
              className="w-full bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white px-3 py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-amber-900/30 transition-all active:scale-[0.98]"
            >
              <Save className="w-4 h-4" aria-hidden="true" /> Save Now
            </button>
          </div>
        </div>
      </aside>

      {/* Right content area (includes mobile tabs) */}
      <div className="flex-1 min-w-0">
        {/* Mobile tabs — horizontal pill scroll */}
        <div className="md:hidden sticky top-[56px] z-10 -mx-4 px-4 pb-3 pt-1 bg-zinc-950/90 backdrop-blur-xl mb-4">
          {/* Search — same jump behavior as desktop sidebar */}
          <div className="mb-2">
            <SettingsSearchBox onJump={jumpToSetting} />
          </div>
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            {sideItems.map(item => (
              <button key={item.id} onClick={() => setSettingsTab(item.id)}
                aria-current={settingsTab === item.id ? 'page' : undefined}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 shrink-0 ${settingsTab === item.id ? 'bg-amber-600 text-white shadow-md shadow-amber-900/40' : 'text-zinc-400 hover:text-white bg-zinc-900/50 border border-white/5'}`}>
                <item.icon className="w-3.5 h-3.5" aria-hidden="true" /> {item.label}
              </button>
            ))}
          </div>
        </div>

      {/* ── SHOP PROFILE — company info that prints on quotes, travelers,
          and shows in the top bar. Laid out as a proper form:
          preview card at top, logo + basics side-by-side on desktop,
          stacks on mobile. Includes email (was missing). */}
      {settingsTab === 'profile' && (
        <div className="space-y-5">
          <div>
            <h3 className="text-lg font-bold text-white mb-1">Shop Profile</h3>
            <p className="text-sm text-zinc-500">Company info — prints on quotes, travelers, and shows in the top bar.</p>
          </div>

          {/* Live preview card — shows exactly how the company appears on
              printed docs, so admins can see their branding at a glance. */}
          <div className="bg-gradient-to-br from-blue-500/10 via-indigo-500/5 to-transparent border border-blue-500/20 rounded-2xl p-4 sm:p-5">
            <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-3">Preview</p>
            <div className="bg-white text-black rounded-xl p-4 flex items-center gap-3 shadow-lg">
              {settings.companyLogo ? (
                <img src={settings.companyLogo} alt="Logo" className="h-10 w-auto object-contain shrink-0" />
              ) : (
                <div className="h-10 w-10 rounded-lg bg-zinc-200 flex items-center justify-center shrink-0">
                  <Image className="w-5 h-5 text-zinc-400" aria-hidden="true" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-black text-base truncate">{settings.companyName || 'Your Company Name'}</p>
                <p className="text-xs text-zinc-600 truncate">
                  {[settings.companyAddress, settings.companyPhone, (settings as any).companyEmail].filter(Boolean).join(' · ') || 'Add address / phone / email below'}
                </p>
              </div>
            </div>
          </div>

          {/* Two-column layout: logo on the left (square dropzone), basics on the right */}
          <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4">
            {/* Logo uploader — clear dropzone + separate remove button so
                it doesn't live on top of the drop target. */}
            <div data-settings-anchor="profile-logo" className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4">
              <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Company Logo</p>
              <div
                className="border-2 border-dashed border-white/10 rounded-xl p-5 text-center cursor-pointer hover:border-amber-500/40 hover:bg-amber-500/5 transition-all aspect-square flex items-center justify-center"
                onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-blue-500/60', 'bg-blue-500/10'); }}
                onDragLeave={e => { e.currentTarget.classList.remove('border-blue-500/60', 'bg-blue-500/10'); }}
                onDrop={e => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('border-blue-500/60', 'bg-blue-500/10');
                  saveLogo(e.dataTransfer.files[0]);
                }}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'image/*';
                  input.onchange = (ev: any) => {
                    saveLogo(ev.target.files?.[0]);
                  };
                  input.click();
                }}
              >
                {settings.companyLogo ? (
                  <img src={settings.companyLogo} alt="Logo" className="max-h-32 max-w-full object-contain" />
                ) : (
                  <div className="text-zinc-500">
                    <Image className="w-10 h-10 mx-auto mb-2 text-zinc-600" aria-hidden="true" />
                    <p className="text-xs font-bold">Drop logo or click to upload</p>
                    <p className="text-[10px] text-zinc-600 mt-1">PNG · JPG · SVG</p>
                  </div>
                )}
              </div>
              {settings.companyLogo && (
                <button
                  type="button"
                  onClick={() => { saveNow({ companyLogo: '' }); addToast('info', 'Logo removed'); }}
                  className="w-full mt-2 text-[11px] text-zinc-500 hover:text-red-400 font-bold py-1.5 rounded hover:bg-red-500/5 transition-colors"
                >
                  Remove logo
                </button>
              )}
            </div>

            {/* Basics — name, phone, email, address */}
            <div data-settings-anchor="profile-company" className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4 space-y-3">
              <div>
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1.5">Company Name</label>
                <input
                  className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-bold"
                  value={settings.companyName || ''}
                  onChange={e => setSettings({ ...settings, companyName: e.target.value })}
                  placeholder="SC Deburring LLC"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1.5">Phone</label>
                  <input
                    type="tel"
                    className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                    value={settings.companyPhone || ''}
                    onChange={e => setSettings({ ...settings, companyPhone: e.target.value })}
                    placeholder="(555) 123-4567"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1.5">Email</label>
                  <input
                    type="email"
                    className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                    value={(settings as any).companyEmail || ''}
                    onChange={e => setSettings({ ...settings, companyEmail: e.target.value } as any)}
                    placeholder="contact@yourcompany.com"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1.5">Address</label>
                <input
                  className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                  value={settings.companyAddress || ''}
                  onChange={e => setSettings({ ...settings, companyAddress: e.target.value })}
                  placeholder="123 Industrial Blvd, City, ST 12345"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-white/5">
                <div>
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1.5">Website (optional)</label>
                  <input
                    type="url"
                    className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                    value={(settings as any).companyWebsite || ''}
                    onChange={e => setSettings({ ...settings, companyWebsite: e.target.value } as any)}
                    placeholder="yourcompany.com"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1.5">Tax ID (optional)</label>
                  <input
                    className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                    value={(settings as any).companyTaxId || ''}
                    onChange={e => setSettings({ ...settings, companyTaxId: e.target.value } as any)}
                    placeholder="EIN / VAT (optional)"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Theme */}
          <div data-settings-anchor="profile-theme" className="rounded-2xl">
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Appearance</p>
            <div className="bg-zinc-900/50 border border-white/5 rounded-xl">
              <div className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm text-white">Theme</p>
                  <p className="text-xs text-zinc-500">Switch between dark and light mode</p>
                </div>
                <div role="group" aria-label="Theme" className="flex gap-1 bg-zinc-800 p-1 rounded-lg">
                  <button aria-pressed={(settings.theme || 'dark') === 'dark'} onClick={() => { setSettings({ ...settings, theme: 'dark' }); document.body.classList.remove('light-theme'); }} className={`px-3 py-1.5 rounded text-xs font-bold transition-colors min-h-[32px] ${(settings.theme || 'dark') === 'dark' ? 'bg-zinc-600 text-white' : 'text-zinc-400 hover:text-white'}`}>Dark</button>
                  <button aria-pressed={settings.theme === 'light'} onClick={() => { setSettings({ ...settings, theme: 'light' }); document.body.classList.add('light-theme'); }} className={`px-3 py-1.5 rounded text-xs font-bold transition-colors min-h-[32px] ${settings.theme === 'light' ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'}`}>Light</button>
                </div>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ── SCHEDULE ── */}
      {settingsTab === 'schedule' && (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-bold text-white mb-1">Schedule & Alarms</h3>
            <p className="text-sm text-zinc-500">Set up break alarms, lunch times, and shift end — fully customizable.</p>
          </div>

          <div data-settings-anchor="schedule-alarms" className="rounded-2xl">
            <ShiftAlarmsEditor settings={settings} setSettings={setSettings} addToast={addToast} />
          </div>

          {/* Lunch pause toggle — auto-pauses timers during the lunch window.
              This is separate from alarms (which just fire notifications). */}
          <div data-settings-anchor="schedule-lunch" className="bg-zinc-900/50 border border-white/5 rounded-xl">
            <div className="px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white">Auto-Pause Timers at Lunch</p>
                  <p className="text-xs text-zinc-500">When on, any alarm marked "Pause Timers" will pause running work</p>
                </div>
                <Toggle checked={settings.autoLunchPauseEnabled || false} onChange={v => setSettings({ ...settings, autoLunchPauseEnabled: v })} />
              </div>
            </div>
          </div>

          {/* ── Auto Clock-Out ────────────────────────────────────────────
              Server-side sweep that stops forgotten timers even when the
              browser tab is closed. Works in addition to shift alarm clock-out.
              Shift alarm clock-out = in-browser only (tab must be open).
              This setting = server sweep runs every minute regardless.
              ─────────────────────────────────────────────────────────── */}
          <div data-settings-anchor="schedule-autoclockout" className="bg-zinc-900/50 border border-white/5 rounded-xl overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between border-b border-white/[0.04]">
              <div>
                <p className="text-sm font-semibold text-white flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                  Auto Clock-Out
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Automatically stops any running timer at this time — even if the browser is closed
                </p>
              </div>
              <Toggle
                checked={settings.autoClockOutEnabled || false}
                onChange={v => setSettings({ ...settings, autoClockOutEnabled: v })}
              />
            </div>
            {settings.autoClockOutEnabled && (
              <div className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-zinc-300">Clock-Out Time</p>
                  <p className="text-[11px] text-zinc-600 mt-0.5">24-hour · local time</p>
                </div>
                <input
                  type="time"
                  className="bg-zinc-950 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm w-32 focus:outline-none focus:border-amber-500/40"
                  value={settings.autoClockOutTime || '15:30'}
                  onChange={e => setSettings({ ...settings, autoClockOutTime: e.target.value })}
                />
              </div>
            )}
            <div className="px-4 py-2 bg-zinc-950/30 border-t border-white/[0.03]">
              <p className="text-[11px] text-zinc-600">
                💡 Tip: Also check "Clock out" on any Shift Alarm above — that plays a sound <em>and</em> stops timers when the app is open.
              </p>
            </div>
          </div>

          {/* ── Clock-Out Audit Log ────────────────────────────────────── */}
          <div data-settings-anchor="schedule-audit" className="rounded-2xl">
            <ClockOutAuditLog logs={shopLogs} />
          </div>

        </div>
      )}

      {/* ── PRODUCTION ── */}
      {settingsTab === 'production' && (
        <div className="space-y-8">
          <div>
            <h3 className="text-lg font-bold text-white mb-1">Production</h3>
            <p className="text-sm text-zinc-500">Everything that makes jobs flow: your workflow, the resources you use, and the partners you work with.</p>
          </div>

          {/* ═══════════════════════════════════════════════════════════
              SECTION 1 — WORKFLOW (how jobs move through the shop)
              ═══════════════════════════════════════════════════════════ */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-1 h-5 bg-amber-500 rounded-full" />
              <h4 className="text-xs font-black text-zinc-400 uppercase tracking-widest">1 · Workflow</h4>
              <div className="h-px bg-white/5 flex-1" />
              <span className="text-[10px] text-zinc-600">How jobs move through your shop</span>
            </div>

          {/* Workflow Stages */}
          <div data-settings-anchor="production-stages" className="bg-zinc-900/50 border border-white/5 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-white">Workflow Stages</h4>
                <p className="text-[10px] text-zinc-500">Define the stages a job moves through from start to finish.</p>
              </div>
              <button onClick={() => {
                const stages = (settings.jobStages || DEFAULT_STAGES).slice().sort((a, b) => a.order - b.order);
                // New stage goes just before the last (finishing) stage.
                stages.splice(Math.max(0, stages.length - 1), 0, { id: `stage_${Date.now()}`, label: 'New Stage', color: '#8b5cf6', order: 0 });
                setSettings({ ...settings, jobStages: stages.map((s, i) => ({ ...s, order: i })) });
              }} className="text-[10px] bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg font-bold">+ Add Stage</button>
            </div>
            {/* Stage Pipeline Preview */}
            <div className="flex items-center gap-1 bg-zinc-950 rounded-xl p-3">
              {(settings.jobStages || DEFAULT_STAGES).slice().sort((a, b) => a.order - b.order).map((stage, i, arr) => (
                <React.Fragment key={stage.id}>
                  <div className="flex-1 text-center">
                    <div className="h-2 rounded-full mb-1" style={{ background: stage.color }} />
                    <span className="text-[9px] font-bold" style={{ color: stage.color }}>{stage.label}</span>
                  </div>
                  {i < arr.length - 1 && <ChevronRight className="w-3 h-3 text-zinc-700 shrink-0" />}
                </React.Fragment>
              ))}
            </div>
            {/* Stage List */}
            <div className="space-y-2">
              {(settings.jobStages || DEFAULT_STAGES).slice().sort((a, b) => a.order - b.order).map((stage, idx, sortedStages) => (
                <div key={stage.id} className="bg-zinc-800/30 rounded-xl border border-white/5">
                 {/* Wraps on phones: name + buttons on one line, colors below. */}
                 <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
                  <div className="w-4 h-4 rounded-full shrink-0" style={{ background: stage.color }} />
                  <input aria-label="Stage name" className="flex-1 min-w-[8rem] bg-transparent text-white text-sm font-bold outline-none border-b border-transparent focus:border-white/20" value={stage.label} onChange={e => {
                    const stages = (settings.jobStages || DEFAULT_STAGES).map(s => (s.id === stage.id ? { ...s, label: e.target.value } : s));
                    setSettings({ ...settings, jobStages: stages });
                  }} />
                  {/* Color picker */}
                  <div className="flex flex-wrap gap-1.5 order-last basis-full sm:order-none sm:basis-auto">
                    {STAGE_COLORS.map(c => (
                      <button key={c.hex} type="button" aria-label={`${c.name} color`} aria-pressed={stage.color === c.hex} onClick={() => {
                        const stages = (settings.jobStages || DEFAULT_STAGES).map(s => (s.id === stage.id ? { ...s, color: c.hex } : s));
                        setSettings({ ...settings, jobStages: stages });
                      }} className={`w-5 h-5 rounded-full transition-all ${stage.color === c.hex ? 'ring-2 ring-white scale-110' : 'opacity-40 hover:opacity-80'}`} style={{ background: c.hex }} />
                    ))}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Move up/down — builds new stage objects (never edits the saved ones in place) */}
                    <button type="button" disabled={idx === 0} onClick={() => {
                      const order = sortedStages.map(s => s.id);
                      [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
                      setSettings({ ...settings, jobStages: order.map((id, i) => ({ ...sortedStages.find(s => s.id === id)!, order: i })) });
                    }} aria-label={`Move ${stage.label} up`} className="w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-white rounded hover:bg-white/5 disabled:opacity-20" title="Move up"><ChevronUp className="w-4 h-4" aria-hidden="true" /></button>
                    <button type="button" disabled={idx >= sortedStages.length - 1} onClick={() => {
                      const order = sortedStages.map(s => s.id);
                      [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
                      setSettings({ ...settings, jobStages: order.map((id, i) => ({ ...sortedStages.find(s => s.id === id)!, order: i })) });
                    }} aria-label={`Move ${stage.label} down`} className="w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-white rounded hover:bg-white/5 disabled:opacity-20" title="Move down"><ChevronDown className="w-4 h-4" aria-hidden="true" /></button>
                    {/* Mark as complete stage */}
                    <label className="flex items-center gap-1.5 px-1.5 min-h-[32px] text-[11px] text-zinc-500 cursor-pointer shrink-0" title="Reaching this stage completes the job">
                      <input type="checkbox" checked={stage.isComplete || false} onChange={e => {
                        const stages = (settings.jobStages || DEFAULT_STAGES).map(s => (s.id === stage.id ? { ...s, isComplete: e.target.checked } : s));
                        setSettings({ ...settings, jobStages: stages });
                      }} className="w-4 h-4 rounded accent-emerald-500" />
                      Done
                    </label>
                    {/* Delete (only if not a built-in) */}
                    {!['pending', 'in-progress', 'completed'].includes(stage.id) && (
                      <button type="button" aria-label={`Delete the ${stage.label} stage`} title="Delete stage" onClick={async () => {
                        const ok = await askConfirm({
                          title: `Delete the "${stage.label}" stage?`,
                          message: 'It disappears from the pipeline. Jobs sitting in it will need to be moved to another stage.',
                          tone: 'danger', confirmLabel: 'Delete stage',
                        });
                        if (!ok) return;
                        setSettings({ ...settings, jobStages: sortedStages.filter(s => s.id !== stage.id).map((s, i) => ({ ...s, order: i })) });
                      }} className="w-8 h-8 flex items-center justify-center text-zinc-600 hover:text-red-400 rounded hover:bg-red-500/10"><Trash2 className="w-4 h-4" aria-hidden="true" /></button>
                    )}
                  </div>
                 </div>
                  {/* Per-stage operations mapping lives in the unified
                      OperationsStageMapper below — cleaner UX than a disclosure
                      tucked inside every stage row. Shows a summary chip here
                      so admins see which stages are mapped at a glance. */}
                  {!stage.isComplete && (stage.operations?.length || 0) > 0 && (
                    <div className="border-t border-white/5 px-3 py-1.5 flex items-center gap-2 flex-wrap">
                      <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Routes:</span>
                      {(stage.operations || []).slice(0, 5).map(op => (
                        <span key={op} className="text-[10px] font-bold text-blue-300 bg-blue-500/10 border border-blue-500/25 rounded px-1.5 py-0.5">{op}</span>
                      ))}
                      {(stage.operations?.length || 0) > 5 && (
                        <span className="text-[10px] text-zinc-500">+{stage.operations!.length - 5} more</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Operations */}
          <div data-settings-anchor="production-operations" className="rounded-xl">
            <div className="bg-zinc-900/50 border border-white/5 rounded-xl">
              <button onClick={() => setOpsOpen(!opsOpen)} className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 rounded-xl transition-colors">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-white">Operations</p>
                  <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-bold">{(settings.customOperations || []).length}</span>
                </div>
                <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${opsOpen ? 'rotate-180' : ''}`} />
              </button>
              {opsOpen && (
                <div className="px-4 pb-4 space-y-3 border-t border-white/5">
                  <div className="flex gap-2 mt-3">
                    <input value={newOp} onChange={e => setNewOp(e.target.value)} placeholder="Add operation..." className="flex-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white" onKeyDown={e => e.key === 'Enter' && handleAddOp()} />
                    <button onClick={handleAddOp} className="bg-amber-600 hover:bg-amber-500 px-3 rounded-lg text-white text-xs font-bold">Add</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[...(settings.customOperations || [])].sort((a, b) => a.localeCompare(b)).map(op => (
                      <span key={op} className="bg-zinc-800 border border-white/10 px-2 py-0.5 rounded flex items-center gap-1 text-xs text-zinc-300">
                        {op}<button aria-label={`Remove ${op}`} onClick={() => handleDeleteOp(op)} className="text-zinc-500 hover:text-red-400 p-1 rounded"><X className="w-2.5 h-2.5" aria-hidden="true" /></button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Operations → Stages mapper — drag operations into their stages
              so clock-ins auto-route jobs. */}
          <div data-settings-anchor="production-opmap" className="rounded-2xl">
            <OperationsStageMapper settings={settings} setSettings={setSettings} />
          </div>

          {/* Per-Customer Pipelines ─ each company can have a unique stage sequence */}
          <div data-settings-anchor="production-pipelines" className="rounded-2xl">
            <CustomerPipelineAssigner settings={settings} setSettings={setSettings} />
          </div>
          </section>

          {/* ═══════════════════════════════════════════════════════════
              SECTION 2 — RESOURCES (what you use to do the work)
              ═══════════════════════════════════════════════════════════ */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-1 h-5 bg-emerald-500 rounded-full" />
              <h4 className="text-xs font-black text-zinc-400 uppercase tracking-widest">2 · Resources</h4>
              <div className="h-px bg-white/5 flex-1" />
              <span className="text-[10px] text-zinc-600">Machines, stations, and reusable pricing</span>
            </div>

            {/* Machines / Stations — physical work locations */}
            <div data-settings-anchor="production-machines" className="rounded-2xl">
              <MachineManager settings={settings} onSaveSettings={(s: SystemSettings) => setSettings(s)} />
            </div>

            {/* Process Library — reusable pricing templates that pre-fill quote line items */}
            <div data-settings-anchor="production-processes" className="rounded-2xl">
              <ProcessLibraryManager settings={settings} setSettings={setSettings} />
            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════════
              SECTION 3 — BUSINESS PARTNERS (customers + vendors)
              ═══════════════════════════════════════════════════════════ */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-1 h-5 bg-purple-500 rounded-full" />
              <h4 className="text-xs font-black text-zinc-400 uppercase tracking-widest">3 · Business Partners</h4>
              <div className="h-px bg-white/5 flex-1" />
              <span className="text-[10px] text-zinc-600">Customers + vendors with full profiles</span>
            </div>

            {/* Customers — full profile editor + per-customer workflow routing */}
            <div data-settings-anchor="production-customers" className="rounded-2xl">
              <CustomerManager addToast={addToast} settings={settings} onSaveSettings={(s: SystemSettings) => setSettings(s)} onSaveNow={saveNow} />
            </div>

            {/* Vendors — reusable supplier records used by Purchase Orders */}
            <div data-settings-anchor="production-vendors" className="rounded-2xl">
              <VendorsManager addToast={addToast} />
            </div>
          </section>
        </div>
      )}

      {/* ── FINANCIAL ── */}
      {settingsTab === 'financial' && (
        <FinancialSettings
          settings={settings}
          setSettings={setSettings}
        />
      )}

      {/* ── GOALS ── */}
      {settingsTab === 'goals' && (
        <GoalsSettings
          settings={settings}
          setSettings={setSettings}
        />
      )}

      {/* ── DOCUMENTS — Split-pane with live preview.
          Sub-tab toggle at the top separates Quote/Invoice (customer-facing)
          from Job Traveler (shop-floor route sheet) — admins were getting
          them confused when they were mixed in one list. */}
      {settingsTab === 'documents' && (() => {
        const accent = settings.accentColor || '#3b82f6';
        return (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-bold text-white mb-1">Documents</h3>
            <p className="text-sm text-zinc-500">Quote / invoice defaults, branding, and the shop-floor Job Traveler layout.</p>
          </div>
          <div className="flex gap-4 flex-col lg:flex-row">
          {/* ── LEFT: Settings Controls ── */}
          <div className="w-full lg:w-[320px] xl:w-[340px] shrink-0 space-y-3 lg:overflow-y-auto lg:max-h-[calc(100vh-120px)]">
            {/* Sub-tab toggle */}
            <div className="inline-flex gap-1 p-1 bg-zinc-900/60 border border-white/5 rounded-xl w-full">
              <button
                type="button"
                onClick={() => setDocSubTab('quote')}
                aria-pressed={docSubTab === 'quote'}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${docSubTab === 'quote' ? 'bg-amber-600 text-white shadow-lg' : 'text-zinc-500 hover:text-white'}`}
              >
                <FileText className="w-3.5 h-3.5" aria-hidden="true" /> Quote / Invoice
              </button>
              <button
                type="button"
                onClick={() => setDocSubTab('traveler')}
                aria-pressed={docSubTab === 'traveler'}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${docSubTab === 'traveler' ? 'bg-amber-600 text-white shadow-lg' : 'text-zinc-500 hover:text-white'}`}
              >
                📋 Job Traveler
              </button>
            </div>

            {/* Logo — shared between both docs */}
            <details data-settings-anchor="documents-logo" className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
              <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <span className="text-sm font-bold text-white">Logo <span className="text-[9px] text-zinc-600 ml-1 normal-case font-normal">(shared)</span></span>
                <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="px-4 pb-4">
                <div
                  className="border-2 border-dashed border-white/10 rounded-xl p-4 text-center cursor-pointer hover:border-amber-500/40 hover:bg-amber-500/5 transition-all"
                  onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-blue-500/60', 'bg-blue-500/10'); }}
                  onDragLeave={e => { e.currentTarget.classList.remove('border-blue-500/60', 'bg-blue-500/10'); }}
                  onDrop={e => {
                    e.preventDefault(); e.currentTarget.classList.remove('border-blue-500/60', 'bg-blue-500/10');
                    const file = e.dataTransfer.files[0];
                    if (file?.type.startsWith('image/')) {
                      saveLogo(file);
                    }
                  }}
                  onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = (ev: any) => { saveLogo(ev.target.files?.[0]); }; i.click(); }}
                >
                  {settings.companyLogo ? (
                    <div><img src={settings.companyLogo} alt="Logo" className="max-h-16 mx-auto object-contain" /><p className="text-[10px] text-zinc-500 mt-2">Click to change</p></div>
                  ) : (
                    <div className="text-zinc-500"><Image className="w-8 h-8 mx-auto mb-1 text-zinc-600" /><p className="text-xs">Drop logo or click to upload</p><p className="text-[10px] text-zinc-600">PNG, JPG, SVG</p></div>
                  )}
                </div>
                {settings.companyLogo && <button onClick={() => setSettings({ ...settings, companyLogo: '' })} className="text-xs text-zinc-600 hover:text-red-400 mt-2 block mx-auto">Remove logo</button>}
              </div>
            </details>

            {/* ─── Quote/Invoice only sections ─── */}
            {docSubTab === 'quote' && <>
            {/* Numbering */}
            <details data-settings-anchor="documents-numbering" open className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
              <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <span className="text-sm font-bold text-white">Numbering</span>
                <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="px-4 pb-4 space-y-3">
                <p className="text-[10px] text-zinc-500 leading-snug">New quotes count up from your highest quote number. To carry on from an old system, set a starting number (e.g. 1500).</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-zinc-500 block mb-1">Quote Prefix</label>
                    <input className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={settings.quotePrefix || 'Q-'} onChange={e => setSettings({ ...settings, quotePrefix: e.target.value })} />
                  </div>
                  <div>
                    <label htmlFor="quote-start-number" className="text-[10px] text-zinc-500 block mb-1">Start numbering at</label>
                    <input id="quote-start-number" type="number" min={1} placeholder="1" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={settings.quoteNextNumber ?? ''} onChange={e => setSettings({ ...settings, quoteNextNumber: e.target.value === '' ? undefined : (parseInt(e.target.value) || undefined) })} />
                  </div>
                </div>
              </div>
            </details>

            {/* Header */}
            <details data-settings-anchor="documents-header" className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
              <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <span className="text-sm font-bold text-white">On the page</span>
                <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="px-4 pb-4 space-y-3">
                {[
                  { key: 'showDueDateOnDocs', label: 'Valid-until date', desc: 'How long the quote is good for', def: true },
                  { key: 'showTermsOnDocs',   label: 'Terms & conditions', desc: 'The terms block near the bottom', def: true },
                ].map(o => (
                  <div key={o.key} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                    <div><p className="text-sm text-white font-medium">{o.label}</p><p className="text-[10px] text-zinc-500 mt-0.5">{o.desc}</p></div>
                    <Toggle checked={(settings as any)[o.key] ?? o.def ?? false} onChange={v => setSettings({ ...settings, [o.key]: v })} label={o.label} />
                  </div>
                ))}
              </div>
            </details>
            </>}
            {/* ─── End Quote-only sections ─── */}

            {/* ─── Job Traveler sections (only shown on Traveler sub-tab) ─── */}
            {docSubTab === 'traveler' && <>
            {/* Job Traveler — production route sheet customization. Every shop
                uses a slightly different traveler; these toggles let them
                hide sections they don't need without touching code. */}
            <details data-settings-anchor="documents-traveler" open className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
              <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <span className="text-sm font-bold text-white flex items-center gap-2">📋 Job Traveler</span>
                <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="px-4 pb-4 space-y-3">
                <p className="text-[10px] text-zinc-500 leading-relaxed">Controls the production-floor route sheet. Open any job → Print Traveler to preview.</p>

                {/* Section toggles — each maps to a show.* flag in the renderer */}
                {([
                  { key: 'showLogo',                label: 'Company Logo' },
                  { key: 'showQrCode',              label: 'QR Code',              desc: 'Scannable job-ID square' },
                  { key: 'showPartPhoto',           label: 'Part Photo',           desc: 'Reference image if uploaded' },
                  { key: 'showSpecialInstructions', label: 'Special Instructions', desc: 'Orange warning callout' },
                  { key: 'showNotes',               label: 'Notes Block' },
                  { key: 'showOperationLog',        label: 'Operation Log',        desc: 'Sign-off rows for each op' },
                  { key: 'showSignOff',             label: 'Sign-off Lines',       desc: 'Operator + Inspector' },
                  { key: 'showDueDate',             label: 'Due Date',             desc: 'Shown in red' },
                  { key: 'showPriority',            label: 'Priority Badge',       desc: 'URGENT / HIGH markers' },
                  { key: 'showCustomer',            label: 'Customer Block' },
                ] as const).map(o => {
                  const v = settings.traveler?.[o.key as keyof NonNullable<SystemSettings['traveler']>];
                  const checked = v !== false; // default ON — opt-out model
                  return (
                    <div key={o.key} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                      <div>
                        <p className="text-sm text-white font-medium">{o.label}</p>
                        {'desc' in o && o.desc && <p className="text-[10px] text-zinc-500 mt-0.5">{o.desc}</p>}
                      </div>
                      <Toggle
                        checked={checked as boolean}
                        onChange={v => setSettings({ ...settings, traveler: { ...(settings.traveler || {}), [o.key]: v } })}
                      />
                    </div>
                  );
                })}

                {/* Operation-log row count */}
                {(settings.traveler?.showOperationLog !== false) && (
                  <div className="pt-2 border-t border-white/5">
                    <label className="text-[10px] text-zinc-500 block mb-1">
                      Operation Log Rows: <span className="text-white font-black">{settings.traveler?.operationLogRows ?? 8}</span>
                    </label>
                    <input
                      type="range"
                      min={4}
                      max={20}
                      step={1}
                      value={settings.traveler?.operationLogRows ?? 8}
                      onChange={e => setSettings({ ...settings, traveler: { ...(settings.traveler || {}), operationLogRows: Number(e.target.value) } })}
                      className="w-full accent-blue-500"
                    />
                    <div className="flex justify-between text-[9px] text-zinc-600">
                      <span>4</span><span>8</span><span>12</span><span>16</span><span>20</span>
                    </div>
                  </div>
                )}

                {/* Header banner — free text that appears above the company name.
                    Typical use: "ITAR CONTROLLED" or "FIRST ARTICLE INSPECTION". */}
                <div className="pt-2 border-t border-white/5">
                  <label className="text-[10px] text-zinc-500 block mb-1">Header Banner (optional)</label>
                  <input
                    type="text"
                    placeholder='e.g. "ITAR Controlled" or "AS9100 Certified"'
                    value={settings.traveler?.headerBanner || ''}
                    onChange={e => setSettings({ ...settings, traveler: { ...(settings.traveler || {}), headerBanner: e.target.value } })}
                    className="w-full bg-zinc-950 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white"
                  />
                  <p className="text-[9px] text-zinc-600 mt-1">Yellow strip at the very top of every traveler.</p>
                </div>

                {/* Footer text — certs, legal notice, safety message */}
                <div>
                  <label className="text-[10px] text-zinc-500 block mb-1">Footer Text (optional)</label>
                  <textarea
                    rows={2}
                    placeholder='e.g. "All parts inspected per AS9102. Contact 555-1234 with questions."'
                    value={settings.traveler?.footerText || ''}
                    onChange={e => setSettings({ ...settings, traveler: { ...(settings.traveler || {}), footerText: e.target.value } })}
                    className="w-full bg-zinc-950 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white"
                  />
                </div>
              </div>
            </details>
            </>}
            {/* ─── End Job Traveler sections ─── */}

            {/* Remaining sections below are Quote-only — keep them gated too */}
            {docSubTab === 'quote' && <>

            {/* Table */}
            <details data-settings-anchor="documents-table" className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
              <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <span className="text-sm font-bold text-white">Table</span>
                <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="px-4 pb-4 space-y-3">
                {[
                  { key: 'showUnitCol', label: 'Unit Column',     desc: 'Show unit (ea, hr, ft) column', def: true },
                  { key: 'showRateCol', label: 'Rate Column',     desc: 'Show unit price column',         def: true },
                  { key: 'showQtyCol',  label: 'Quantity Column', desc: 'Show quantity column',            def: true },
                ].map(o => (
                  <div key={o.key} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                    <div><p className="text-sm text-white font-medium">{o.label}</p><p className="text-[10px] text-zinc-500 mt-0.5">{o.desc}</p></div>
                    <Toggle checked={(settings as any)[o.key] ?? o.def ?? true} onChange={v => setSettings({ ...settings, [o.key]: v })} label={o.label} />
                  </div>
                ))}
              </div>
            </details>

            {/* Footer */}
            <details data-settings-anchor="documents-footer" className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
              <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <span className="text-sm font-bold text-white">Footer</span>
                <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="px-4 pb-4 space-y-3">
                <div className="flex items-center justify-between py-2">
                  <div><p className="text-sm text-white font-medium">Signature Lines</p><p className="text-[10px] text-zinc-500 mt-0.5">Show company + client signature lines</p></div>
                  <Toggle checked={settings.showSignatureLines ?? true} onChange={v => setSettings({ ...settings, showSignatureLines: v })} />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 block mb-1">Default Comment / Certificate</label>
                  <textarea className="w-full bg-zinc-950 border border-white/10 rounded-xl px-3 py-2 text-sm text-white min-h-[70px]" value={settings.defaultQuoteComment || ''} onChange={e => setSettings({ ...settings, defaultQuoteComment: e.target.value })} placeholder="CERTIFICATE OF CONFORMANCE: This is to certify that all processes conform..." />
                </div>
              </div>
            </details>

            {/* Project Details */}
            <details data-settings-anchor="documents-project-fields" className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
              <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <span className="text-sm font-bold text-white">Project Details</span>
                <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="px-4 pb-4 space-y-3">
                <p className="text-xs text-zinc-500">Add fields to capture job info (e.g. PO number, part number).</p>
                {(settings.customProjectFields || ['Purchase Order', 'Part No.']).map((f: string, i: number) => (
                  <div key={i} className="flex items-center justify-between py-1 border-b border-white/5">
                    <span className="text-sm text-white font-bold">{f}</span>
                    <button onClick={() => { const fs = [...(settings.customProjectFields || ['Purchase Order', 'Part No.'])]; fs.splice(i, 1); setSettings({ ...settings, customProjectFields: fs }); }} className="text-xs text-zinc-600 hover:text-red-400">Remove</button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <input id="newPF" className="flex-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. Job No., Machine ID" />
                  <button onClick={() => { const inp = document.getElementById('newPF') as HTMLInputElement; if (inp?.value.trim()) { setSettings({ ...settings, customProjectFields: [...(settings.customProjectFields || ['Purchase Order', 'Part No.']), inp.value.trim()] }); inp.value = ''; } }} className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-2 rounded-lg text-xs font-bold">Add</button>
                </div>
              </div>
            </details>

            {/* Defaults */}
            <details data-settings-anchor="documents-defaults" className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
              <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <span className="text-sm font-bold text-white">Defaults</span>
                <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="px-4 pb-4 space-y-3">
                <div><label htmlFor="default-payment-terms" className="text-[10px] text-zinc-500 block mb-1">Default Payment Terms</label><input id="default-payment-terms" list="payment-terms-options" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={settings.defaultPaymentTerms || ''} onChange={e => setSettings({ ...settings, defaultPaymentTerms: e.target.value })} placeholder="Net 30" /><datalist id="payment-terms-options"><option value="Due on Receipt" /><option value="Net 15" /><option value="Net 30" /><option value="Net 45" /><option value="Net 60" /></datalist><p className="text-[10px] text-zinc-600 mt-1">Filled in on new quotes.</p></div>
                <div><label className="text-[10px] text-zinc-500 block mb-1">Default Tax Rate (%)</label><input type="number" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={settings.taxRate || ''} onChange={e => setSettings({ ...settings, taxRate: parseFloat(e.target.value) || 0 })} step="0.1" placeholder="0" /></div>
                <div><label className="text-[10px] text-zinc-500 block mb-1">Default Discount (%)</label><input type="number" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={settings.defaultDiscount || ''} onChange={e => setSettings({ ...settings, defaultDiscount: parseFloat(e.target.value) || 0 })} step="0.1" placeholder="0" /></div>
                <div><label className="text-[10px] text-zinc-500 block mb-1">Default Markup (%)</label><input type="number" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={settings.defaultMarkup || ''} onChange={e => setSettings({ ...settings, defaultMarkup: e.target.value === '' ? undefined : parseFloat(e.target.value) })} step="1" min={0} placeholder="25" /><p className="text-[10px] text-zinc-600 mt-1">Used on new quotes. Blank = 25%.</p></div>
                <div>
                  <label className="text-[10px] text-zinc-500 block mb-1">Min Margin Threshold (%)</label>
                  <input type="number" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={settings.minMarginPct ?? ''} onChange={e => setSettings({ ...settings, minMarginPct: e.target.value === '' ? undefined : parseFloat(e.target.value) })} step="1" placeholder="20" />
                  <p className="text-[10px] text-zinc-600 mt-1">Quotes below this % margin show a red warning in the editor.</p>
                </div>
              </div>
            </details>

            {/* Snippet Library — reusable text blocks (Round 1 #8) */}
            <div data-settings-anchor="documents-snippets" className="rounded-2xl">
              <SnippetLibraryManager settings={settings} setSettings={setSettings} />
            </div>

            {/* Color */}
            <details data-settings-anchor="documents-color" className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
              <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <span className="text-sm font-bold text-white">Color</span>
                <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="px-4 pb-4">
                <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
                  {[
                    '#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#22c55e','#10b981','#14b8a6',
                    '#06b6d4','#0ea5e9','#3b82f6','#6366f1','#8b5cf6','#a855f7','#d946ef','#ec4899',
                    '#f43f5e','#be123c','#9f1239','#7f1d1d','#78350f','#365314','#064e3b','#134e4a',
                    '#0c4a6e','#1e3a5f','#312e81','#4c1d95','#581c87','#701a75','#831843','#18181b',
                  ].map(c => (
                    <button key={c} onClick={() => setSettings({ ...settings, accentColor: c } as any)} className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 ${accent === c ? 'border-white scale-110 ring-2 ring-white/30' : 'border-transparent'}`} style={{ background: c }} />
                  ))}
                </div>
              </div>
            </details>

            {/* Watermark */}
            <details data-settings-anchor="documents-watermark" className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
              <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <span className="text-sm font-bold text-white">Watermark</span>
                <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="px-4 pb-4">
                <div className="flex flex-wrap gap-2">
                  {['None', 'DRAFT', 'SAMPLE', 'CONFIDENTIAL', 'COPY', 'VOID'].map(w => (
                    <button key={w} onClick={() => setSettings({ ...settings, watermark: w === 'None' ? '' : w })} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${(settings.watermark || '') === (w === 'None' ? '' : w) ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'}`}>{w}</button>
                  ))}
                </div>
              </div>
            </details>
            </>}
            {/* ─── End second Quote-only block ─── */}
          </div>

          {/* ── RIGHT: Live Document Preview ── */}
          <div className="flex-1 hidden lg:block min-w-0">
            {docSubTab === 'traveler' ? (
              <TravelerPreview settings={settings} />
            ) : (
            <QuotePreview settings={settings} />
            )}
          </div>
          </div>
        </div>
        );
      })()}

      {/* ── TV DISPLAY ── */}
      {settingsTab === 'tv' && (
        <TvDisplaySettings settings={settings} setSettings={setSettings} saveNow={saveNow} addToast={addToast} />
      )}

      {/* ── SYSTEM ── */}
      {settingsTab === 'system' && (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-black text-white mb-1">Defaults</h3>
            <p className="text-sm text-zinc-500">Job and worker defaults applied across the system.</p>
          </div>

          {/* Job Defaults */}
          <div data-settings-anchor="system-job-defaults" className="rounded-2xl">
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.12em] mb-2">Job Defaults</p>
            <div className="bg-zinc-900/60 border border-white/[0.06] rounded-2xl overflow-hidden">
              <div className="px-4 py-3.5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">Default Priority</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Applied when creating new jobs</p>
                </div>
                <select className="bg-zinc-950 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-amber-500/40" value={settings.defaultPriority || 'normal'} onChange={e => setSettings({ ...settings, defaultPriority: e.target.value })}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
          </div>

          {/* Worker Defaults */}
          <div data-settings-anchor="system-worker-defaults" className="rounded-2xl">
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.12em] mb-2">Worker Defaults</p>
            <div className="bg-zinc-900/60 border border-white/[0.06] rounded-2xl overflow-hidden">
              <div className="px-4 py-3.5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">Weekly Goal Hours</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Target shown on each worker's stats page</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    className="bg-zinc-950 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm w-20 text-center focus:outline-none focus:border-amber-500/40"
                    aria-label="Weekly goal hours"
                    min={1}
                    placeholder="40"
                    value={settings.weeklyGoalHours ?? ''}
                    onChange={e => setSettings({ ...settings, weeklyGoalHours: e.target.value === '' ? undefined : Number(e.target.value) })}
                  />
                  <span className="text-xs text-zinc-500">hrs</span>
                </div>
              </div>
            </div>
          </div>

          {/* Daily Email Recap */}
          <div data-settings-anchor="system-recap" className="rounded-2xl">
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.12em] mb-2">Daily Email Recap</p>
            <div className="bg-zinc-900/60 border border-white/[0.06] rounded-2xl overflow-hidden">
              <div className="px-4 py-3.5 flex items-center justify-between border-b border-white/[0.04]">
                <div>
                  <p className="text-sm font-semibold text-white">Enable Daily Recap</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Get a nightly summary of hours, jobs, and revenue</p>
                </div>
                <Toggle
                  checked={!!settings.recapEmailEnabled}
                  onChange={v => setSettings({ ...settings, recapEmailEnabled: v })}
                />
              </div>
              <div className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.04]">
                <div className="sm:shrink-0">
                  <p className="text-sm font-semibold text-white">Primary Email</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Main recipient for the daily summary</p>
                </div>
                <input
                  type="email"
                  placeholder="you@example.com"
                  className="bg-zinc-950 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm w-full sm:w-52 focus:outline-none focus:border-amber-500/40"
                  value={settings.recapEmail || ''}
                  onChange={e => setSettings({ ...settings, recapEmail: e.target.value })}
                />
              </div>
              <div className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.04]">
                <div className="sm:shrink-0">
                  <p className="text-sm font-semibold text-white">Also Send To</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Comma-separated additional addresses</p>
                </div>
                <input
                  type="text"
                  placeholder="other@example.com, ..."
                  className="bg-zinc-950 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm w-full sm:w-52 focus:outline-none focus:border-amber-500/40"
                  value={settings.recapEmailCC || ''}
                  onChange={e => setSettings({ ...settings, recapEmailCC: e.target.value })}
                />
              </div>
              <div className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-white/[0.04]">
                <div>
                  <p className="text-sm font-semibold text-white">Auto-Send Time</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Recap fires automatically each day at this time</p>
                </div>
                <input
                  type="time"
                  className="bg-zinc-950 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm w-full sm:w-36 focus:outline-none focus:border-amber-500/40"
                  value={settings.recapTime || ''}
                  onChange={e => setSettings({ ...settings, recapTime: e.target.value })}
                />
              </div>
              <div className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-white/[0.04]">
                <div>
                  <p className="text-sm font-semibold text-white">Timezone</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Used for the recap, briefing &amp; scorecard send times</p>
                </div>
                <select
                  className="bg-zinc-950 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm w-full sm:w-52 focus:outline-none focus:border-amber-500/40 cursor-pointer"
                  value={settings.recapTimezone || 'America/Los_Angeles'}
                  onChange={e => setSettings({ ...settings, recapTimezone: e.target.value })}
                >
                  <option value="America/Los_Angeles">Pacific (Los Angeles)</option>
                  <option value="America/Phoenix">Arizona (Phoenix)</option>
                  <option value="America/Denver">Mountain (Denver)</option>
                  <option value="America/Chicago">Central (Chicago)</option>
                  <option value="America/New_York">Eastern (New York)</option>
                </select>
              </div>
              <div className="px-4 py-3.5 flex items-center justify-between border-t border-white/[0.04]">
                <div>
                  <p className="text-sm font-semibold text-white">Send Recap Now</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Sends today's hours &amp; jobs immediately</p>
                </div>
                <div className="flex items-center gap-3">
                  {recapStatus && (
                    <span className={`text-xs font-semibold animate-fade-in ${recapStatus.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                      {recapStatus.ok ? '✓ ' : '✗ '}{recapStatus.msg}
                    </span>
                  )}
                  <button
                    onClick={handleSendRecap}
                    disabled={recapSending || !settings.recapEmail?.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold bg-amber-500/15 text-amber-400 border border-amber-500/25 hover:bg-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    {recapSending ? 'Sending…' : 'Send Now'}
                  </button>
                </div>
              </div>
            </div>
            {isDeveloper() && (
              <p className="text-[11px] text-zinc-600 mt-2 px-1">
                Requires <code className="font-mono text-zinc-500 bg-zinc-800/60 px-1 py-0.5 rounded text-[10px]">RESEND_API_KEY</code> in Netlify environment variables.
                Free tier: 100 emails/day — <span className="text-zinc-500">resend.com</span>
              </p>
            )}
          </div>

          {/* Daily Push Notifications — morning briefing + worker scorecards */}
          <div data-settings-anchor="system-push" className="rounded-2xl">
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.12em] mb-2">Daily Push Notifications</p>
            <div className="bg-zinc-900/60 border border-white/[0.06] rounded-2xl overflow-hidden">
              <div className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.04]">
                <div>
                  <p className="text-sm font-semibold text-white">☀️ Morning Briefing</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Push to admins: due today, overdue, yesterday's labor cost. Mon–Sat.</p>
                </div>
                <input
                  type="time"
                  className="bg-zinc-950 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm w-full sm:w-36 focus:outline-none focus:border-amber-500/40"
                  value={settings.briefingTime || '06:55'}
                  onChange={e => setSettings({ ...settings, briefingTime: e.target.value })}
                />
              </div>
              <div className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-white">🏁 Worker Scorecards</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Each worker gets their hours · pieces · jobs at end of shift. Blank = clock-out alarm time.</p>
                </div>
                <input
                  type="time"
                  className="bg-zinc-950 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm w-full sm:w-36 focus:outline-none focus:border-amber-500/40"
                  value={settings.scorecardTime || ''}
                  onChange={e => setSettings({ ...settings, scorecardTime: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* ═══ Rate Learning ═══ */}
          <div data-settings-anchor="system-rate-learning" className="rounded-2xl">
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.12em] mb-2">Rate Learning</p>
            <div className="bg-zinc-900/60 border border-white/[0.06] rounded-2xl overflow-hidden divide-y divide-white/[0.04]">

              {/* ── Sample Times Entry ── */}
              <SampleTimesEntry
                addToast={addToast}
                allLogs={shopLogs}
                knownOperations={settings.customOperations || []}
                knownPartNumbers={Array.from(new Set(shopJobs.map(j => j.partNumber).filter(Boolean) as string[]))}
                rateBuffer={settings.rateBuffer ?? 1.15}
                shopRate={settings.shopRate ?? 0}
                pricingMarkup={settings.pricingMarkup ?? 2.0}
                askConfirm={askConfirm}
              />

              {/* ── Buffer % ── */}
              <div className="px-4 py-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-white">Generosity buffer</p>
                    <p className="text-xs text-zinc-500 mt-0.5">Pad estimates by this much so they're a comfortable target, not a tight one.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" step="5" min="0" max="100"
                      className="bg-zinc-950 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm w-20 text-center focus:outline-none focus:border-amber-500/40"
                      value={Math.round(((settings.rateBuffer ?? 1.15) - 1) * 100)}
                      onChange={e => {
                        const pct = Number(e.target.value) || 0;
                        setSettings({ ...settings, rateBuffer: 1 + (pct / 100) });
                      }}
                    />
                    <span className="text-xs text-zinc-500">% extra</span>
                  </div>
                </div>
                <p className="text-[10px] text-zinc-600 mt-2">
                  Example: 15% on a 10h base estimate → 11.5h shown on the traveler. Set to 0 for no buffer.
                </p>
              </div>

              {/* ── Pricing markup % ── */}
              <div className="px-4 py-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-white">Pricing markup</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Multiplier on labor cost when suggesting a charge per part. Shows up on the sample preview.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" step="10" min="0" max="500"
                      className="bg-zinc-950 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm w-20 text-center focus:outline-none focus:border-amber-500/40"
                      value={Math.round(((settings.pricingMarkup ?? 2.0) - 1) * 100)}
                      onChange={e => {
                        const pct = Number(e.target.value) || 0;
                        setSettings({ ...settings, pricingMarkup: 1 + (pct / 100) });
                      }}
                    />
                    <span className="text-xs text-zinc-500">% markup</span>
                  </div>
                </div>
                <p className="text-[10px] text-zinc-600 mt-2">
                  Example: 100% on $0.10/pc labor → $0.20/pc charge. Default 100% (= 2× labor cost).
                  {!(settings.shopRate && settings.shopRate > 0) && (
                    <span className="block mt-0.5 text-amber-500/70">⚠ Set Shop Hourly Rate in Financial tab to enable pricing previews.</span>
                  )}
                </p>
              </div>

              {/* ── Over-budget alerts ── */}
              <div className="px-4 py-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <p className="text-sm font-semibold text-white">Over-budget email alerts</p>
                    <p className="text-xs text-zinc-500 mt-0.5">Email when a job's actual time exceeds the buffered estimate.</p>
                  </div>
                  <Toggle checked={!!settings.overBudgetAlertEnabled} onChange={v => setSettings({ ...settings, overBudgetAlertEnabled: v })} label="Over-budget email alerts" />
                </div>

                {settings.overBudgetAlertEnabled && (
                  <div className="mt-3 space-y-2.5 bg-zinc-950/50 rounded-xl p-3 border border-white/[0.04]">
                    <p className="text-[10px] font-black text-amber-400 uppercase tracking-wider">EmailJS Configuration</p>
                    <p className="text-[10px] text-zinc-500 -mt-1.5 leading-relaxed">
                      Sign up free at <a className="text-amber-400 underline" href="https://www.emailjs.com" target="_blank" rel="noopener noreferrer">emailjs.com</a>, create a Service + Template, then paste the IDs below. Template should accept variables: <code className="text-zinc-400">job_id, po, part, customer, estimated, actual, over_by, operations, shop_name, link, to_email</code>.
                    </p>
                    <input
                      type="email" placeholder="Email to alert (e.g. you@scdeburring.com)"
                      className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-amber-500/40"
                      value={settings.alertEmail || ''}
                      onChange={e => setSettings({ ...settings, alertEmail: e.target.value })}
                    />
                    <input
                      type="text" placeholder="EmailJS Service ID (e.g. service_xxxxxxx)"
                      className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-amber-500/40"
                      value={settings.emailJsServiceId || ''}
                      onChange={e => setSettings({ ...settings, emailJsServiceId: e.target.value })}
                    />
                    <input
                      type="text" placeholder="EmailJS Template ID (e.g. template_xxxxxxx)"
                      className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-amber-500/40"
                      value={settings.emailJsTemplateId || ''}
                      onChange={e => setSettings({ ...settings, emailJsTemplateId: e.target.value })}
                    />
                    <input
                      type="text" placeholder="EmailJS Public Key"
                      className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-amber-500/40"
                      value={settings.emailJsPublicKey || ''}
                      onChange={e => setSettings({ ...settings, emailJsPublicKey: e.target.value })}
                    />
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={async () => {
                          addToast('info', 'Sending test email…');
                          const r = await sendTestEmail(settings);
                          if (r.ok) addToast('success', '✉ Test email sent — check your inbox');
                          else addToast('error', r.reason || 'Test email failed');
                        }}
                        disabled={!getEmailJsConfig(settings)}
                        className="text-xs font-bold bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg transition-colors"
                      >
                        ✉ Send Test Email
                      </button>
                      <button
                        type="button"
                        onClick={() => { clearAllAlerts(); addToast('info', 'Cleared over-budget alert history — jobs will re-alert if still over.'); }}
                        className="text-xs font-bold text-zinc-300 bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Reset Alert History
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Backfill ── */}
              <div className="px-4 py-4">
                <p className="text-sm font-semibold text-white">Backfill historical pieces data</p>
                <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                  Distributes each completed job's total quantity across its sessions (weighted by time logged) so past work also feeds the rate engine.
                  Skips logs that already have piece counts — never overwrites real data.
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    const patches = planSessionQtyBackfill(shopJobs, shopLogs);
                    if (patches.length === 0) {
                      addToast('info', 'Nothing to backfill — all completed jobs already have piece data or no eligible logs found.');
                      return;
                    }
                    const proceed = await askConfirm({
                      title: `Backfill ${patches.length} log${patches.length === 1 ? '' : 's'}?`,
                      message: `This will assign session pieces to ${patches.length} time log entries across your completed jobs.`,
                      confirmLabel: 'Backfill Now',
                    });
                    if (!proceed) return;
                    addToast('info', `Backfilling ${patches.length} logs…`);
                    let ok = 0, fail = 0;
                    for (const p of patches) {
                      try {
                        const log = shopLogs.find(l => l.id === p.logId);
                        if (!log) { fail++; continue; }
                        await DB.updateTimeLog({ ...log, sessionQty: p.sessionQty });
                        ok++;
                      } catch {
                        fail++;
                      }
                    }
                    if (fail === 0) addToast('success', `✅ Backfilled ${ok} logs. Rate learning is now active for past parts.`);
                    else addToast('info', `Backfilled ${ok} logs (${fail} failed).`);
                  }}
                  className="mt-3 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-black tracking-wide transition-colors"
                >
                  ↻ Backfill Now
                </button>
              </div>
            </div>
          </div>

          {/* Notifications — dev-only */}
          {isDeveloper() && (
            <div>
              <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.12em] mb-2">
                Notifications <span className="text-amber-400 normal-case tracking-normal text-[9px]">dev only</span>
              </p>
              <div className="bg-zinc-900/60 border border-white/[0.06] rounded-2xl p-4">
                <PushRegistrationPanel addToast={addToast} userId={userId} />
              </div>
            </div>
          )}

          {/* About */}
          <div>
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.12em] mb-2">About</p>
            <div className="bg-zinc-900/60 border border-white/[0.06] rounded-2xl overflow-hidden">
              {isDeveloper() && (
                <div className="px-4 py-3.5 flex items-center justify-between border-b border-white/[0.04]">
                  <div>
                    <p className="text-sm font-semibold text-white">Database</p>
                    <p className="text-xs text-zinc-500 mt-0.5">Firebase connection status</p>
                  </div>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${DB.isFirebaseConnected().connected ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25' : 'bg-red-500/15 text-red-400 border border-red-500/25'}`}>
                    {DB.isFirebaseConnected().connected ? '● Connected' : '○ Offline'}
                  </span>
                </div>
              )}
              <div className="px-4 py-3.5 flex items-center justify-between border-b border-white/[0.04]">
                <div>
                  <p className="text-sm font-semibold text-white">Operations Configured</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Custom operation types set up</p>
                </div>
                <span className="text-sm font-bold text-amber-400">{(settings.customOperations || []).length}</span>
              </div>
              <div className="px-4 py-3.5 flex items-center justify-between border-b border-white/[0.04]">
                <div>
                  <p className="text-sm font-semibold text-white">Workflow Stages</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Stages in your production pipeline</p>
                </div>
                <span className="text-sm font-bold text-amber-400">{(settings.jobStages || []).length}</span>
              </div>
              <div className="px-4 py-3.5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">FabTrack IO</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Shop management platform</p>
                </div>
                <span className="text-xs text-zinc-600 font-mono">v2.1</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile save */}
      <div className="flex justify-end mt-6 pb-8 md:hidden">
        <button onClick={handleSave} className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white px-5 py-2 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg shadow-amber-900/30"><Save className="w-4 h-4" /> Save</button>
      </div>
      </div>
      {ConfirmHost}
    </div>
  );
};

// --- APP ROOT ---
// PROGRESS VIEW - Worker stats
export function ProgressView({ userId, userName, recentLogs = [] }: { userId: string; userName: string; recentLogs?: TimeLog[] }) {
  const [progress, setProgress] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  // Shop-wide leaderboard data — every active employee + completed log this
  // month. Subscribed once here (not lifted into the parent) because no other
  // panel on the worker dashboard needs it.
  const [allLogs, setAllLogs] = React.useState<TimeLog[]>([]);
  const [allUsers, setAllUsers] = React.useState<User[]>([]);

  React.useEffect(() => {
    if (!userId) return;
    const unsub = DB.subscribeUserProgress(userId, (data: any) => {
      setProgress(data);
      setLoading(false);
    });
    return () => unsub();
  }, [userId]);

  React.useEffect(() => {
    const unsubLogs = DB.subscribeLogs(setAllLogs);
    const unsubUsers = DB.subscribeUsers(setAllUsers);
    return () => { unsubLogs(); unsubUsers(); };
  }, []);

  const fmtHours = (h: number) => {
    const hrs = Math.floor(h);
    const mins = Math.round((h - hrs) * 60);
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  };

  // Jobs worked this week from recentLogs
  const weekStart = new Date(); weekStart.setHours(0,0,0,0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekJobMap = new Map<string, { label: string; ops: Set<string>; mins: number }>();
  recentLogs.filter(l => l.endTime && new Date(l.startTime) >= weekStart).forEach(l => {
    if (!weekJobMap.has(l.jobId)) weekJobMap.set(l.jobId, { label: l.jobIdsDisplay || l.jobId, ops: new Set(), mins: 0 });
    const entry = weekJobMap.get(l.jobId)!;
    entry.ops.add(l.operation);
    entry.mins += lMs(l);
  });
  const weekJobs = Array.from(weekJobMap.values());

  // Today's minutes
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayMins = recentLogs
    .filter(l => l.endTime && new Date(l.startTime) >= todayStart)
    .reduce((a, l) => a + (lMs(l)), 0);

  const weekHours = progress?.weekHours || 0;
  // Counted from the logs, Sunday to Saturday like the History tab — the
  // progress doc counted Monday-based weeks in UTC, so the two disagreed.
  const weekOps = recentLogs.filter(l => l.endTime && new Date(l.startTime) >= weekStart).length;

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-zinc-500">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm">Loading stats...</p>
      </div>
    </div>
  );

  // Streak calc — compare local calendar-day keys (year/month/date) instead of
  // ms boundary math so DST shifts and timezone offsets can't misfile a log
  // into the wrong day.
  const WEEKLY_GOAL_HRS = 54;
  const dayKey = (t: number | Date) => {
    const d = t instanceof Date ? t : new Date(t);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  const workedDayKeys = new Set(recentLogs.map(l => dayKey(l.startTime)));
  const streakCheck = new Date(todayStart);
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const dow = streakCheck.getDay();
    if (dow === 0 || dow === 6) { streakCheck.setDate(streakCheck.getDate() - 1); continue; }
    if (workedDayKeys.has(dayKey(streakCheck))) {
      streak++; streakCheck.setDate(streakCheck.getDate() - 1);
    } else break;
  }

  // Weekly goal
  const weekMins = recentLogs.filter(l => l.endTime && new Date(l.startTime) >= weekStart).reduce((a, l) => a + (lMs(l)), 0);
  const weekHrsCalc = weekMins / 60;
  const goalPct = Math.min(100, (weekHrsCalc / WEEKLY_GOAL_HRS) * 100);

  // Daily breakdown (last 7 days)
  const dailyData: { label: string; mins: number; ops: number }[] = [];
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayStart); d.setDate(d.getDate() - i);
    const dEnd = new Date(d); dEnd.setHours(23,59,59,999);
    const dayLogs = recentLogs.filter(l => l.endTime && l.startTime >= d.getTime() && l.startTime <= dEnd.getTime());
    const mins = dayLogs.reduce((a, l) => a + (lMs(l)), 0);
    dailyData.push({ label: i === 0 ? 'Today' : i === 1 ? 'Yest' : dayNames[d.getDay()], mins, ops: dayLogs.length });
  }
  const maxDayMins = Math.max(...dailyData.map(d => d.mins), 60);

  // Operation breakdown
  const opMap = new Map<string, number>();
  recentLogs.filter(l => l.endTime && new Date(l.startTime) >= weekStart).forEach(l => {
    opMap.set(l.operation, (opMap.get(l.operation) || 0) + (lMs(l)));
  });
  const opBreakdown = Array.from(opMap.entries()).sort((a, b) => b[1] - a[1]);
  const totalOpMins = opBreakdown.reduce((a, [, m]) => a + m, 0) || 1;
  const opColors = ['bg-blue-500', 'bg-purple-500', 'bg-emerald-500', 'bg-orange-500', 'bg-pink-500', 'bg-cyan-500', 'bg-yellow-500'];

  // ── THIS-MONTH stats + SHOP LEADERBOARD ───────────────────────────────
  // Calendar month, not rolling 30 days — workers think of their hours per
  // pay-period, and most shops still bill monthly. We anchor to the 1st of
  // the current month at midnight local time.
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const monthLabel = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Per-employee minute totals from completed logs only (running timers
  // would unfairly inflate the active worker's number until they stop).
  const monthMinsByUser = new Map<string, number>();
  for (const l of allLogs) {
    if (!l.endTime) continue;
    if (l.startTime < monthStart.getTime()) continue;
    monthMinsByUser.set(l.userId, (monthMinsByUser.get(l.userId) || 0) + (lMs(l)));
  }

  // Build leaderboard from the active employee roster. Skip admins (managers
  // shouldn't be in a worker race) and inactive accounts. Always include
  // *this* worker even if their account is admin or inactive — they still
  // get to see their rank.
  type LeaderRow = { id: string; name: string; mins: number; isMe: boolean };
  const leaderRows: LeaderRow[] = [];
  for (const u of allUsers) {
    const isMe = u.id === userId;
    if (!isMe) {
      if (u.role !== 'employee') continue;
      if (u.isActive === false) continue;
    }
    leaderRows.push({ id: u.id, name: u.name, mins: monthMinsByUser.get(u.id) || 0, isMe });
  }
  // If "me" still isn't in there (e.g. ProgressView opened with empty userId),
  // show roster anyway. Sort high→low so the top of the list is the leader.
  leaderRows.sort((a, b) => b.mins - a.mins);
  const myRow = leaderRows.find(r => r.isMe);
  const myRank = myRow ? leaderRows.indexOf(myRow) + 1 : null;
  const topMins = leaderRows[0]?.mins || 0;
  const myMonthMins = myRow?.mins || 0;
  // Gap to next person up — "you're 1h 12m behind Sarah" feels like a race.
  const gapToNext = (() => {
    if (!myRow || !myRank || myRank <= 1) return null;
    const above = leaderRows[myRank - 2];
    return { name: above.name, mins: Math.max(0, above.mins - myRow.mins) };
  })();

  return (
    <div className="space-y-4 animate-fade-in">

      {/* Hero: Streak + Weekly Goal — full width, 2 columns on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Streak card */}
        <div className="card-shine hover-lift-glow bg-gradient-to-br from-orange-500/10 via-zinc-900/50 to-zinc-900/50 border border-orange-500/20 rounded-2xl p-5 relative overflow-hidden">
          <div aria-hidden="true" className="absolute top-0 right-0 w-32 h-32 bg-orange-500/10 blur-3xl rounded-full" />
          <div className="relative">
            <p className="text-[10px] font-black text-orange-400/80 uppercase tracking-[0.2em]">Current Streak</p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-6xl font-black text-white tabular leading-none" style={{ textShadow: '0 0 30px rgba(249,115,22,0.4)' }}>{streak}</span>
              <span className="text-2xl">🔥</span>
            </div>
            <p className="text-xs text-zinc-400 mt-1.5">{streak === 0 ? 'Clock in to start a streak' : streak === 1 ? 'day — keep it going!' : `days in a row — on fire!`}</p>
          </div>
        </div>

        {/* Weekly Goal card */}
        <div className="card-shine hover-lift-glow bg-gradient-to-br from-blue-500/10 via-zinc-900/50 to-zinc-900/50 border border-blue-500/20 rounded-2xl p-5 relative overflow-hidden lg:col-span-2">
          <div aria-hidden="true" className="absolute top-0 right-0 w-40 h-40 bg-blue-500/10 blur-3xl rounded-full" />
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-black text-blue-400/80 uppercase tracking-[0.2em]">Weekly Goal</p>
              {goalPct >= 100 && <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-1 rounded-full flex items-center gap-1">🏆 HIT!</span>}
            </div>
            <div className="flex items-baseline gap-3">
              <span className={`text-6xl font-black tabular leading-none ${goalPct >= 100 ? 'text-emerald-400' : 'text-white'}`} style={{ textShadow: '0 0 30px rgba(59,130,246,0.3)' }}>{weekHrsCalc.toFixed(1)}</span>
              <span className="text-2xl font-bold text-zinc-500">h</span>
              <span className="text-sm text-zinc-600 ml-1">of {WEEKLY_GOAL_HRS}h</span>
            </div>
            <div className="mt-4 relative h-3 rounded-full bg-zinc-800 overflow-hidden">
              <div className={`absolute inset-y-0 left-0 rounded-full transition-all duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)] ${goalPct >= 100 ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' : 'bg-gradient-to-r from-blue-500 to-indigo-400'}`} style={{ width: `${goalPct}%`, boxShadow: goalPct >= 100 ? '0 0 12px rgba(16,185,129,0.6)' : '0 0 12px rgba(59,130,246,0.6)' }} />
            </div>
            <div className="flex items-center justify-between text-[11px] mt-1.5">
              <span className="text-zinc-500">{goalPct.toFixed(0)}% complete</span>
              <span className="text-zinc-400 font-mono">{goalPct < 100 ? `${(WEEKLY_GOAL_HRS - weekHrsCalc).toFixed(1)}h remaining` : `+${(weekHrsCalc - WEEKLY_GOAL_HRS).toFixed(1)}h over goal`}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Summary cards — Today / Week / Month */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 rounded-2xl p-4 text-center overflow-hidden">
          <p className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em]">Today</p>
          <p className="text-2xl sm:text-3xl font-black text-emerald-400 tabular mt-1 leading-none">
            {fmtMinutes(todayMins)}
          </p>
          <div className="h-0.5 rounded-full bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent mt-2" aria-hidden="true" />
        </div>
        <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 rounded-2xl p-4 text-center overflow-hidden">
          <p className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em]">This Week</p>
          <p className="text-2xl sm:text-3xl font-black text-blue-400 tabular mt-1 leading-none">{fmtHours(weekHrsCalc)}</p>
          <div className="h-0.5 rounded-full bg-gradient-to-r from-transparent via-blue-500/50 to-transparent mt-2" aria-hidden="true" />
        </div>
        <div className="card-shine hover-lift-glow bg-gradient-to-br from-amber-500/10 via-zinc-900/50 to-zinc-900/50 border border-amber-500/20 rounded-2xl p-4 text-center overflow-hidden relative">
          <div aria-hidden="true" className="absolute -top-6 -right-6 w-24 h-24 bg-amber-500/10 blur-2xl rounded-full" />
          <p className="text-[9px] font-black text-amber-400/80 uppercase tracking-[0.2em] relative">This Month</p>
          <p className="text-2xl sm:text-3xl font-black text-amber-400 tabular mt-1 leading-none relative">{fmtHours(myMonthMins / 60)}</p>
          <p className="text-[10px] text-zinc-500 mt-1 relative">{monthLabel}</p>
        </div>
        <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 rounded-2xl p-4 text-center overflow-hidden">
          <p className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em]">Operations</p>
          <p className="text-2xl sm:text-3xl font-black text-purple-400 tabular mt-1 leading-none">{weekOps}</p>
          <p className="text-[10px] text-zinc-500 mt-1">this week</p>
        </div>
      </div>

      {/* ── SHOP RACE — monthly leaderboard ─────────────────────────────
          Workers see where they rank against the rest of the floor. Hours
          come from completed time logs only (running timers don't count
          until stopped, otherwise the working person always "wins"). */}
      {leaderRows.length > 1 && (
        <div className="card-shine bg-gradient-to-br from-zinc-900/80 via-zinc-900/50 to-zinc-900/30 border border-white/10 rounded-3xl overflow-hidden">
          <div className="px-4 py-3 bg-gradient-to-r from-amber-500/10 via-orange-500/5 to-transparent border-b border-white/5 flex items-center justify-between flex-wrap gap-2">
            <div>
              <span className="text-xs font-black text-amber-400 uppercase tracking-widest flex items-center gap-2">🏁 Shop Race</span>
              <p className="text-[10px] text-zinc-500 mt-0.5">Hours logged this month · {monthLabel}</p>
            </div>
            {myRank && (
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-zinc-500">You're</span>
                <span className={`font-black px-2 py-1 rounded-lg ${myRank === 1 ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : myRank <= 3 ? 'bg-blue-500/15 text-blue-300 border border-blue-500/30' : 'bg-zinc-800 text-zinc-300 border border-white/10'}`}>
                  #{myRank} of {leaderRows.length}
                </span>
                {gapToNext && gapToNext.mins > 0 && (
                  <span className="text-zinc-500">· {fmtHours(gapToNext.mins / 60)} behind {gapToNext.name.split(' ')[0]}</span>
                )}
              </div>
            )}
          </div>
          <div className="divide-y divide-white/5">
            {leaderRows.map((row, i) => {
              const pct = topMins > 0 ? (row.mins / topMins) * 100 : 0;
              const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;
              return (
                <div
                  key={row.id}
                  className={`relative px-4 py-3 flex items-center gap-3 transition-colors ${row.isMe ? 'bg-amber-500/[0.06] hover:bg-amber-500/10' : 'hover:bg-white/[0.03]'}`}
                >
                  {/* Progress fill — sits behind the row content like a race-track lane */}
                  <div
                    aria-hidden="true"
                    className={`absolute inset-y-0 left-0 transition-all duration-700 ${i === 0 ? 'bg-gradient-to-r from-amber-500/15 to-transparent' : row.isMe ? 'bg-gradient-to-r from-blue-500/10 to-transparent' : 'bg-gradient-to-r from-zinc-700/15 to-transparent'}`}
                    style={{ width: `${pct}%` }}
                  />
                  <span className={`relative shrink-0 w-7 text-center text-xs font-black tabular ${i === 0 ? 'text-amber-400' : i <= 2 ? 'text-blue-400' : 'text-zinc-500'}`}>
                    {medal || `#${i + 1}`}
                  </span>
                  <span className={`relative flex-1 truncate text-sm font-bold ${row.isMe ? 'text-white' : 'text-zinc-300'}`}>
                    {row.name}
                    {row.isMe && <span className="ml-2 text-[10px] font-black text-amber-300 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded uppercase tracking-wider">You</span>}
                  </span>
                  <span className={`relative text-sm font-mono tabular shrink-0 ${row.mins === 0 ? 'text-zinc-600' : i === 0 ? 'text-amber-300 font-black' : 'text-zinc-300 font-bold'}`}>
                    {fmtHours(row.mins / 60)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Daily bar chart — last 7 days */}
      <div className="bg-zinc-900/50 border border-white/5 rounded-3xl overflow-hidden">
        <div className="px-4 py-3 bg-white/5 border-b border-white/5">
          <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Last 7 Days</span>
        </div>
        <div className="p-4">
          <div className="flex items-end justify-between gap-2" style={{ height: 120 }}>
            {dailyData.map((d, i) => {
              const h = d.mins > 0 ? Math.max(8, (d.mins / maxDayMins) * 100) : 4;
              const isToday = i === dailyData.length - 1;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-mono text-zinc-500">{d.mins >= 60 ? `${Math.floor(d.mins/60)}h` : d.mins >= 1 ? `${Math.round(d.mins)}m` : ''}</span>
                  <div className="w-full flex items-end" style={{ height: 80 }}>
                    <div
                      className={`w-full rounded-t-md transition-all duration-700 ${isToday ? 'bg-gradient-to-t from-orange-600 to-amber-400' : d.mins > 0 ? 'bg-gradient-to-t from-zinc-700 to-zinc-500' : 'bg-zinc-800'}`}
                      style={{ height: `${h}%` }}
                    />
                  </div>
                  <span className={`text-[10px] font-bold ${isToday ? 'text-amber-400' : 'text-zinc-500'}`}>{d.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Operation breakdown */}
      {opBreakdown.length > 0 && (
        <div className="bg-zinc-900/50 border border-white/5 rounded-3xl overflow-hidden">
          <div className="px-4 py-3 bg-white/5 border-b border-white/5">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Time by Operation</span>
          </div>
          <div className="p-4 space-y-3">
            {/* Stacked bar */}
            <div className="w-full h-4 bg-zinc-800 rounded-full overflow-hidden flex">
              {opBreakdown.map(([op, mins], i) => (
                <div key={op} className={`h-full ${opColors[i % opColors.length]}`} style={{ width: `${(mins / totalOpMins) * 100}%` }} title={`${op}: ${fmtMinutes(mins)}`} />
              ))}
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {opBreakdown.map(([op, mins], i) => (
                <div key={op} className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${opColors[i % opColors.length]}`} />
                  <span className="text-xs text-zinc-300 font-medium">{op}</span>
                  <span className="text-xs text-zinc-500 font-mono">{fmtMinutes(mins)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Jobs worked this week */}
      <div className="bg-zinc-900/50 border border-white/5 rounded-3xl overflow-hidden">
        <div className="px-4 py-3 bg-white/5 border-b border-white/5">
          <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Jobs This Week</span>
        </div>
        {weekJobs.length === 0 ? (
          <p className="text-sm text-zinc-500 text-center py-6">No jobs logged this week yet.</p>
        ) : (
          <div className="divide-y divide-white/5">
            {weekJobs.map(j => (
              <div key={j.label} className="px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-colors">
                <div>
                  <p className="text-sm font-bold text-white">{j.label}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{[...j.ops].join(' · ')}</p>
                </div>
                <span className="text-xs font-mono text-zinc-400 bg-zinc-800 px-2 py-1 rounded">
                  {fmtMinutes(j.mins)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
