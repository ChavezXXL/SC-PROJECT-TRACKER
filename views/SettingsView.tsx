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
  MessageSquare, Phone, Play, Plus, Printer, Radio, RotateCcw, Save, Settings, Share2,
  Trash2, Users, X, Zap,
} from 'lucide-react';

import type {
  Job, TimeLog, SystemSettings, TvSlide, SlideMessage, ShopGoal, GoalMetric,
  GoalPeriod, ProcessTemplate, QuoteSnippet, QuoteTemplate, User, JobStage,
  ShiftAlarm, ShiftAlarmSound, Vendor,
} from '../types';
import * as DB from '../services/mockDb';
import { ShopFlowMap } from '../components/ShopFlowMap';
import { OperationsStageMapper } from '../components/OperationsStageMapper';
import { VendorsManager } from '../components/VendorsManager';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/useConfirm';
import { CustomerPortal } from '../CustomerPortal';
import { makeClientSlug, buildPortalUrl } from '../utils/url';
import { VAPID_KEY, vapidKeyToUint8 } from '../utils/vapid';
import { customerKey } from '../utils/customers';
import { computeGoalProgress as computeGoalProgressForGoal, formatGoalValue as formatGoalDisplay } from '../utils/goals';
import { getActiveAlarms, playAlarmSound } from '../services/shiftAlarms';
import { isDeveloper } from '../utils/devMode';
import { getStages, DEFAULT_STAGES } from '../App';

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
          const res = await fetch('/.netlify/functions/send-push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subscription: sub.toJSON(),
              title: '🚀 Server Push Works',
              body: 'This notification came from the Netlify function — works when app is closed.',
              tag: 'server-push-test',
            }),
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
      <h3 className="font-bold text-white flex items-center gap-2"><Bell className="w-4 h-4 text-blue-400" /> Push Notifications</h3>

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
        className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-5 py-3 rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2"
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
  { id: 'morning-break',   label: 'Morning Break',    time: '10:00', enabled: false, sound: 'triangle' },
  { id: 'lunch-start',     label: 'Lunch Starts',     time: '12:00', enabled: true,  sound: 'bell',   pauseTimers: true },
  { id: 'lunch-end',       label: 'Lunch Ends',       time: '12:30', enabled: true,  sound: 'chime' },
  { id: 'afternoon-break', label: 'Afternoon Break',  time: '14:30', enabled: false, sound: 'triangle' },
  { id: 'shift-end',       label: 'Shift Ends',       time: '16:30', enabled: true,  sound: 'horn',   clockOut: true },
];

const ShiftAlarmsEditor = ({ settings, setSettings, addToast }: { settings: SystemSettings; setSettings: (s: SystemSettings) => void; addToast: any }) => {
  const { confirm: askConfirm, ConfirmHost } = useConfirm();
  const alarms: ShiftAlarm[] = settings.shiftAlarms && settings.shiftAlarms.length > 0
    ? settings.shiftAlarms
    : getActiveAlarms(settings); // fall back to legacy fields on first load

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
    const current = alarms[idx].days || [];
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
        <label className="flex items-center gap-2 cursor-pointer shrink-0">
          <span className={`text-[10px] font-bold uppercase tracking-widest ${alarmsEnabled ? 'text-emerald-400' : 'text-zinc-600'}`}>{alarmsEnabled ? 'On' : 'Off'}</span>
          <input type="checkbox" checked={alarmsEnabled} onChange={e => enableAlarms(e.target.checked)} className="w-4 h-4 rounded accent-blue-500" />
        </label>
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
              <input
                type="checkbox"
                aria-label={`Enable alarm: ${alarm.label}`}
                checked={alarm.enabled}
                onChange={e => update(idx, { enabled: e.target.checked })}
                className="w-4 h-4 rounded accent-blue-500 shrink-0"
              />

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
                className="shrink-0 p-1.5 rounded-lg text-blue-400 hover:bg-blue-500/10 hover:text-white"
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
                const active = !alarm.days || alarm.days.length === 0 || alarm.days.includes(d.value);
                const allDays = !alarm.days || alarm.days.length === 0;
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => toggleDay(idx, d.value)}
                    aria-pressed={active}
                    className={`text-[9px] font-black px-1.5 py-0.5 rounded transition-colors ${active ? (allDays ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-blue-500/15 text-blue-400 border border-blue-500/30') : 'bg-zinc-900 text-zinc-600 border border-white/5 hover:text-white'}`}
                    title={allDays ? 'Every day' : undefined}
                  >
                    {d.label}
                  </button>
                );
              })}
              <span className="w-px h-3 bg-white/10" />
              <label className="flex items-center gap-1 text-[10px] text-zinc-500 cursor-pointer" title="Also pause all running timers when this alarm fires">
                <input type="checkbox" checked={!!alarm.pauseTimers} onChange={e => update(idx, { pauseTimers: e.target.checked })} className="w-3 h-3 rounded accent-amber-500" />
                Pause timers
              </label>
              <label className="flex items-center gap-1 text-[10px] text-zinc-500 cursor-pointer" title="Also clock everyone out (end of shift)">
                <input type="checkbox" checked={!!alarm.clockOut} onChange={e => update(idx, { clockOut: e.target.checked })} className="w-3 h-3 rounded accent-red-500" />
                Clock out
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
            className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5"
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

const GoalsSettings = ({ settings, setSettings }: { settings: SystemSettings; setSettings: (s: SystemSettings) => void }) => {
  const goals = settings.shopGoals || [];
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
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
  const remove = (idx: number) => {
    setSettings({ ...settings, shopGoals: goals.filter((_, i) => i !== idx) });
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
      <div>
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

      <div className="space-y-3">
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
                  <input type="checkbox" checked={goal.showOnTv !== false} onChange={e => update(idx, { showOnTv: e.target.checked })} className="w-3.5 h-3.5 rounded accent-blue-500" aria-label="Show on TV" /> TV
                </label>
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-zinc-500 shrink-0 cursor-pointer">
                  <input type="checkbox" checked={goal.enabled} onChange={e => update(idx, { enabled: e.target.checked })} className="w-3.5 h-3.5 rounded accent-blue-500" aria-label="Enabled" /> Active
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
                    <input className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none" value={goal.label} onChange={e => update(idx, { label: e.target.value })} />
                    <p className="text-[10px] text-zinc-600 mt-1">What the TV shows as the goal name.</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] text-zinc-500 block mb-1 font-black uppercase tracking-widest">Target</label>
                      <input type="number" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-blue-500/50 focus:outline-none" value={goal.target} onChange={e => update(idx, { target: Number(e.target.value) || 0 })} />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 block mb-1 font-black uppercase tracking-widest">Unit</label>
                      <input className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none" value={goal.unit || meta.unit} onChange={e => update(idx, { unit: e.target.value })} placeholder={meta.unit} />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 block mb-1 font-black uppercase tracking-widest">Period</label>
                      <select className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none" value={goal.period} onChange={e => update(idx, { period: e.target.value as GoalPeriod })}>
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
                      <input className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none" value={goal.customerFilter || ''} onChange={e => update(idx, { customerFilter: e.target.value })} placeholder="e.g. PAMCO" list="goal-customers" />
                      <datalist id="goal-customers">
                        {(settings.clients || []).map(c => <option key={c} value={c} />)}
                      </datalist>
                    </div>
                  )}
                  <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                    <input type="checkbox" checked={!!goal.lowerIsBetter} onChange={e => update(idx, { lowerIsBetter: e.target.checked })} className="w-4 h-4 rounded accent-blue-500" />
                    <span><strong className="text-white">Lower is better</strong> — treat the target as a ceiling instead of a floor</span>
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>
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
  const loggedMins30 = allLogs.filter(l => l.startTime >= thirtyDaysAgo && l.endTime).reduce((a, l) => a + (l.durationMinutes || 0), 0);
  const loggedHrs30 = loggedMins30 / 60;

  // Revenue from completed jobs' quoteAmount
  const revenue30 = completedRecent.reduce((a, j) => a + (j.quoteAmount || 0), 0);
  const jobsWithQuote = completedRecent.filter(j => (j.quoteAmount || 0) > 0);

  // Labor cost using each worker's hourlyRate (fallback to shopRate)
  const laborCost30 = allLogs.filter(l => l.startTime >= thirtyDaysAgo && l.endTime).reduce((acc, l) => {
    const w = workers.find(w => w.id === l.userId);
    const r = w?.hourlyRate || shopRate;
    return acc + ((l.durationMinutes || 0) / 60) * r;
  }, 0);
  const overheadCost30 = loggedHrs30 * ohRate;
  const totalCost30 = laborCost30 + overheadCost30;
  const grossProfit30 = revenue30 - totalCost30;
  const marginPct = revenue30 > 0 ? (grossProfit30 / revenue30) * 100 : 0;

  // Break-even: hours needed per month to cover overhead at current avg margin
  const avgJobMargin = jobsWithQuote.length > 0
    ? jobsWithQuote.reduce((acc, j) => {
        const logs = allLogs.filter(l => l.jobId === j.id);
        const mins = logs.reduce((a, l) => a + (l.durationMinutes || 0), 0);
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
      <div>
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
          <div className={`card-shine border rounded-xl p-4 ${grossProfit30 >= 0 ? 'bg-gradient-to-br from-blue-500/10 to-blue-500/[0.02] border-blue-500/20' : 'bg-gradient-to-br from-red-500/10 to-red-500/[0.02] border-red-500/30'}`}>
            <div className="flex items-center gap-1.5 mb-1"><span className={`w-1.5 h-1.5 rounded-full ${grossProfit30 >= 0 ? 'bg-blue-400' : 'bg-red-400'}`} /><p className={`text-[10px] font-black uppercase tracking-widest ${grossProfit30 >= 0 ? 'text-blue-400' : 'text-red-400'}`}>Gross Profit</p></div>
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
      <div>
        <p className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-3">Shop Rates</p>
        <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-zinc-500 block mb-1 font-bold uppercase tracking-widest">Fallback Rate</label>
              <div className="relative"><span className="absolute left-3 top-2 text-zinc-500 text-sm">$</span><input type="number" step="0.01" className="w-full bg-zinc-950 border border-white/10 rounded-lg py-2 pl-6 pr-10 text-white text-sm font-mono focus:border-blue-500/50 focus:outline-none" value={settings.shopRate || ''} onChange={e => setSettings({ ...settings, shopRate: Number(e.target.value) || 0 })} placeholder="21" /><span className="absolute right-3 top-2 text-zinc-600 text-xs">/hr</span></div>
              <p className="text-[10px] text-zinc-600 mt-1">Used when a worker has no individual rate.</p>
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 block mb-1 font-bold uppercase tracking-widest">Monthly Overhead</label>
              <div className="relative"><span className="absolute left-3 top-2 text-zinc-500 text-sm">$</span><input type="number" step="0.01" className="w-full bg-zinc-950 border border-white/10 rounded-lg py-2 pl-6 pr-10 text-white text-sm font-mono focus:border-blue-500/50 focus:outline-none" value={settings.monthlyOverhead || ''} onChange={e => setSettings({ ...settings, monthlyOverhead: Number(e.target.value) || 0 })} placeholder="5000" /><span className="absolute right-3 top-2 text-zinc-600 text-xs">/mo</span></div>
              <p className="text-[10px] text-zinc-600 mt-1">Rent, utilities, insurance, software, etc.</p>
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 block mb-1 font-bold uppercase tracking-widest">Productive Hours</label>
              <div className="relative"><input type="number" className="w-full bg-zinc-950 border border-white/10 rounded-lg py-2 px-3 pr-10 text-white text-sm font-mono focus:border-blue-500/50 focus:outline-none" value={settings.monthlyWorkHours || ''} onChange={e => setSettings({ ...settings, monthlyWorkHours: Number(e.target.value) || 0 })} placeholder="160" /><span className="absolute right-3 top-2 text-zinc-600 text-xs">/mo</span></div>
              <p className="text-[10px] text-zinc-600 mt-1">Billable hours per month per worker.</p>
            </div>
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
            <div className="rounded-lg bg-blue-500/5 border border-blue-500/15 p-3 flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-xs text-zinc-300 leading-relaxed">
                <strong className="text-blue-300">Worker-specific rates</strong> override the fallback. Set them in
                <strong className="text-white"> Team → edit worker</strong>. Currently {workers.filter(w => w.hourlyRate).length} of {workers.length} workers have individual rates set.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── QUOTE CALCULATOR (existing) */}
      <div>
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
                <p className="text-xl font-black text-blue-400">${laborCost.toFixed(0)}</p>
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
  const machines = settings.machines || [];
  const handleAdd = () => {
    const name = newMachine.trim();
    if (!name) return;
    if (machines.some(m => m.toLowerCase() === name.toLowerCase())) { setNewMachine(''); return; }
    onSaveSettings({ ...settings, machines: [...machines, name] });
    setNewMachine('');
  };
  const handleDelete = (m: string) => onSaveSettings({ ...settings, machines: machines.filter(x => x !== m) });
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
    </div>
  );
};

// --- CUSTOMER MANAGER — discovers + dedupes customers pulled from actual jobs ---
const CustomerManager = ({ addToast, settings, onSaveSettings }: { addToast: any; settings: SystemSettings; onSaveSettings: (s: SystemSettings) => void }) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [canonicalName, setCanonicalName] = useState('');
  const [merging, setMerging] = useState(false);
  const [newClient, setNewClient] = useState('');
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [previewingPortal, setPreviewingPortal] = useState<string | null>(null);
  const [search, setSearch] = useState('');

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
      const clients = (settings.clients || []).filter(c => !others.includes(c));
      if (!clients.includes(canonicalName.trim()) && canonicalName.trim()) clients.push(canonicalName.trim());
      onSaveSettings({ ...settings, clients });
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
            <button onClick={handleMerge} disabled={merging || selected.size < 2 || !canonicalName.trim()} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-40 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all">
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
                      className="w-4 h-4 rounded bg-zinc-800 border-white/10 text-blue-600 focus:ring-blue-500 shrink-0 cursor-pointer"
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
                          onClick={(e) => { e.preventDefault(); onSaveSettings({ ...settings, clients: (settings.clients || []).filter(c => c !== r.name) }); }}
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
  addToast,
}: {
  name: string;
  settings: SystemSettings;
  onClose: () => void;
  onSave: (c: import('../types').CustomerContact) => void;
  onSaveSettings?: (s: SystemSettings) => void;
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
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Company Name *</label>
            <input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500/40" />
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
              onClick={() => {
                const url = buildPortalUrl(form.name || name, { ...settings, clientSlugs: { ...(settings.clientSlugs || {}), [form.name || name]: slug } });
                navigator.clipboard.writeText(url).then(() => addToast('success', 'Portal link copied')).catch(() => prompt('Copy:', url));
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
              ? 'border-blue-500 text-white'
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
              ? 'border-blue-500 text-white'
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
            <Eye className="w-3.5 h-3.5 text-blue-400 shrink-0" />
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
      const next: Job = {
        ...job,
        portalNote: text.trim()
          ? { text: text.trim(), expectedDate: expectedDate.trim() || undefined, updatedAt: Date.now() }
          : undefined,
      };
      await DB.saveJob(next);
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
      await DB.saveJob({ ...job, portalNote: undefined });
      setText('');
      setExpectedDate('');
      addToast('info', `Update cleared · ${job.poNumber}`);
    } catch {
      addToast('error', 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const isOverdue = job.dueDate && new Date(job.dueDate).getTime() < Date.now();

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
          className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500/40"
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
            className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white tabular outline-none focus:border-blue-500/40"
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
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1.5"
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

const ProcessLibraryManager = ({ settings, setSettings }: { settings: SystemSettings; setSettings: (s: SystemSettings) => void }) => {
  const processes = settings.processTemplates || [];
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showSeeds, setShowSeeds] = useState(false);

  const update = (idx: number, patch: Partial<ProcessTemplate>) => {
    const next = [...processes];
    next[idx] = { ...next[idx], ...patch };
    setSettings({ ...settings, processTemplates: next });
  };
  const remove = (idx: number) => setSettings({ ...settings, processTemplates: processes.filter((_, i) => i !== idx) });
  const add = (seed?: Omit<ProcessTemplate, 'id'>) => {
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
          <button type="button" onClick={() => add()} className="text-[10px] bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg font-bold flex items-center gap-1"><Plus className="w-3 h-3" aria-hidden="true" /> Add</button>
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

const SnippetLibraryManager = ({ settings, setSettings }: { settings: SystemSettings; setSettings: (s: SystemSettings) => void }) => {
  const snippets = settings.quoteSnippets || [];
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showSeeds, setShowSeeds] = useState(false);

  const update = (idx: number, patch: Partial<QuoteSnippet>) => {
    const next = [...snippets]; next[idx] = { ...next[idx], ...patch };
    setSettings({ ...settings, quoteSnippets: next });
  };
  const remove = (idx: number) => setSettings({ ...settings, quoteSnippets: snippets.filter((_, i) => i !== idx) });
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
          <span className="text-[9px] font-black text-blue-400 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded uppercase tracking-widest">{snippets.length}</span>
        </div>
        <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" />
      </summary>
      <div className="px-4 pb-4 space-y-2">
        <p className="text-[10px] text-zinc-500 leading-relaxed">Reusable text for Scope, Notes, and Terms. One click to insert — saves retyping common boilerplate every quote.</p>
        <div className="flex gap-1.5">
          {snippets.length === 0 && (
            <button type="button" onClick={() => setShowSeeds(!showSeeds)} className="text-[10px] bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 rounded font-bold">✨ Starter Pack</button>
          )}
          <button type="button" onClick={() => add()} className="text-[10px] bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1 rounded font-bold flex items-center gap-1"><Plus className="w-3 h-3" aria-hidden="true" /> Add</button>
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
      </div>
    </details>
  );
};

// ── TV Slides Editor ─ full-featured editor for rotating slideshow
const SLIDE_TYPE_META: Record<string, { label: string; desc: string; icon: string; color: string }> = {
  workers:     { label: 'Live Workers + Jobs', desc: 'Running timers + auto-scroll jobs belt (the default view)', icon: '👷', color: 'bg-blue-500/15 border-blue-500/30 text-blue-400' },
  jobs:        { label: 'Open Jobs (full-screen)', desc: 'All open jobs on one screen, auto-scrolling', icon: '📋', color: 'bg-purple-500/15 border-purple-500/30 text-purple-400' },
  leaderboard: { label: 'Leaderboard', desc: 'Ranked workers by hours/jobs', icon: '🏆', color: 'bg-amber-500/15 border-amber-500/30 text-amber-400' },
  weather:     { label: 'Weather Forecast', desc: 'Current conditions + 5-day outlook', icon: '🌤️', color: 'bg-cyan-500/15 border-cyan-500/30 text-cyan-400' },
  'stats-week': { label: 'Weekly Stats', desc: 'Hours, jobs & sessions with daily bar graph', icon: '📊', color: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' },
  goals:       { label: 'Shop Goals', desc: 'Your custom targets (jobs/week, revenue, etc)', icon: '🎯', color: 'bg-teal-500/15 border-teal-500/30 text-teal-400' },
  'flow-map':  { label: 'Shop Flow Map', desc: 'Visual of jobs moving through each stage · live workers', icon: '🗺️', color: 'bg-indigo-500/15 border-indigo-500/30 text-indigo-400' },
  safety:      { label: 'Safety Message', desc: 'Big, bold safety reminder', icon: '⚠️', color: 'bg-yellow-500/15 border-yellow-500/30 text-yellow-400' },
  message:     { label: 'Announcement', desc: 'Custom title + body with color', icon: '📢', color: 'bg-pink-500/15 border-pink-500/30 text-pink-400' },
  stats:       { label: 'Quick Stats (legacy)', desc: 'Basic stats card', icon: '📈', color: 'bg-zinc-500/15 border-zinc-500/30 text-zinc-400' },
};

// ── Weather Location Card — request & display location status for TV weather slide
// Live miniature Job Traveler preview — re-renders on every settings change
// so admins see section toggles / banner text / row count update in real time.
// Uses sample job data (PO-SAMPLE, ACME) so the preview is populated even if
// the shop has zero real jobs yet.
const TravelerPreview = ({ settings }: { settings: SystemSettings }) => {
  const sampleJob: Job = {
    id: 'sample',
    jobIdsDisplay: 'SAMPLE-001',
    poNumber: 'PO-12345',
    partNumber: 'WIDGET-A',
    customer: 'Acme Manufacturing',
    priority: 'high',
    quantity: 200,
    dateReceived: '04/20/2026',
    dueDate: '05/01/2026',
    info: 'Sample job. Changes to your Traveler settings update this preview live.',
    specialInstructions: 'No sharp edges — break 0.010 max.',
    status: 'in-progress',
    createdAt: Date.now() - 86400000,
  };
  const t = settings.traveler || {};
  const show = {
    logo: t.showLogo !== false,
    qr: t.showQrCode !== false,
    photo: t.showPartPhoto !== false,
    instructions: t.showSpecialInstructions !== false,
    notes: t.showNotes !== false,
    operationLog: t.showOperationLog !== false,
    signOff: t.showSignOff !== false,
    dueDate: t.showDueDate !== false,
    priority: t.showPriority !== false,
    customer: t.showCustomer !== false,
  };
  const opRows = Math.min(20, Math.max(4, t.operationLogRows ?? 8));

  return (
    <div className="sticky top-4 bg-white text-black rounded-2xl shadow-2xl overflow-hidden">
      <div className="p-5" style={{ fontFamily: '-apple-system, sans-serif', fontSize: 10 }}>
        {t.headerBanner && (
          <div className="bg-yellow-100 border-2 border-yellow-500 text-yellow-900 text-center font-black uppercase tracking-widest text-[9px] px-2 py-1 mb-2 rounded">
            {t.headerBanner}
          </div>
        )}
        <div className="flex justify-between items-center border-b-2 border-black pb-2 mb-3 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {show.logo && settings.companyLogo && (
              <img src={settings.companyLogo} alt="" className="h-8 object-contain shrink-0" />
            )}
            <div className="min-w-0">
              <h1 className="text-base font-black tracking-tighter truncate">{settings.companyName || 'Your Company'}</h1>
              <p className="text-[8px] font-bold uppercase tracking-widest text-gray-500">Production Traveler</p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] font-bold">{new Date().toLocaleDateString()}</p>
            <p className="text-[8px] text-gray-400">Printed On</p>
          </div>
        </div>

        <div className={`grid ${show.qr ? 'grid-cols-[1fr_90px]' : 'grid-cols-1'} gap-2 mb-2`}>
          <div className="space-y-1.5">
            <div className="border-2 border-black p-2">
              <p className="text-[8px] uppercase font-bold text-gray-500">PO Number</p>
              <p className="text-xl font-black leading-tight">{sampleJob.poNumber}</p>
              {show.priority && sampleJob.priority && sampleJob.priority !== 'normal' && (
                <span className="inline-block mt-1 text-[8px] font-black uppercase px-1 rounded bg-orange-500 text-white">
                  {sampleJob.priority}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="border border-gray-300 p-1.5">
                <p className="text-[8px] uppercase font-bold text-gray-500">Part #</p>
                <p className="text-xs font-black">{sampleJob.partNumber}</p>
              </div>
              <div className="border border-gray-300 p-1.5">
                <p className="text-[8px] uppercase font-bold text-gray-500">Qty</p>
                <p className="text-xs font-black">{sampleJob.quantity}</p>
              </div>
              <div className="border border-gray-300 p-1.5">
                <p className="text-[8px] uppercase font-bold text-gray-500">Received</p>
                <p className="text-[10px] font-bold">{sampleJob.dateReceived}</p>
              </div>
              {show.dueDate && (
                <div className="border border-gray-300 p-1.5">
                  <p className="text-[8px] uppercase font-bold text-gray-500">Due Date</p>
                  <p className="text-[10px] font-black text-red-600">{sampleJob.dueDate}</p>
                </div>
              )}
            </div>
            {show.customer && (
              <div className="border border-gray-300 p-1.5">
                <p className="text-[8px] uppercase font-bold text-gray-500">Customer</p>
                <p className="text-xs font-bold">{sampleJob.customer}</p>
              </div>
            )}
          </div>
          {show.qr && (
            <div className="flex flex-col items-center justify-center border-2 border-black p-2 bg-gray-50 min-w-0">
              <div className="w-[60px] h-[60px] bg-white border border-gray-300 grid grid-cols-7 gap-px p-1">
                {Array.from({ length: 49 }).map((_, i) => (
                  <div key={i} className={Math.random() > 0.55 ? 'bg-black' : 'bg-white'} />
                ))}
              </div>
              <p className="text-[8px] font-bold uppercase tracking-widest mt-1">SCAN JOB</p>
            </div>
          )}
        </div>

        {show.instructions && sampleJob.specialInstructions && (
          <div className="border-2 border-orange-500 bg-orange-50 p-1.5 mb-1.5">
            <p className="text-[8px] uppercase font-black text-orange-700 tracking-wider">⚠ Special Instructions</p>
            <p className="text-[10px] font-bold text-gray-900">{sampleJob.specialInstructions}</p>
          </div>
        )}

        {show.notes && sampleJob.info && (
          <div className="border-l-2 border-gray-400 pl-2 py-1 bg-gray-50 mb-1.5">
            <p className="text-[8px] uppercase font-bold text-gray-500">Notes</p>
            <p className="text-[9px] text-gray-700">{sampleJob.info}</p>
          </div>
        )}

        {show.operationLog && (
          <div className="mt-2">
            <p className="text-[8px] uppercase font-black text-blue-700 tracking-wider mb-1">Operation Log</p>
            <table className="w-full border-collapse text-[8px]">
              <thead>
                <tr className="border-b border-black">
                  <th className="text-left py-1 px-1 font-black">Op</th>
                  <th className="text-left py-1 px-1 font-black">Operator</th>
                  <th className="text-left py-1 px-1 font-black">Start</th>
                  <th className="text-left py-1 px-1 font-black">End</th>
                  <th className="text-left py-1 px-1 font-black">Qty</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: Math.min(opRows, 6) }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-200">
                    <td className="px-1" style={{ height: 14 }}></td>
                    <td></td><td></td><td></td><td></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {opRows > 6 && <p className="text-[7px] text-gray-400 italic mt-0.5">+{opRows - 6} more rows</p>}
          </div>
        )}

        {show.signOff && (
          <div className="mt-3 grid grid-cols-2 gap-4 pt-2 border-t border-gray-300">
            <div><p className="border-t border-black pt-0.5 text-[7px] font-bold uppercase text-gray-500">Operator</p></div>
            <div><p className="border-t border-black pt-0.5 text-[7px] font-bold uppercase text-gray-500">Inspector</p></div>
          </div>
        )}

        {t.footerText && (
          <div className="mt-2 pt-1 border-t border-gray-200 text-center text-[8px] text-gray-500 whitespace-pre-wrap">
            {t.footerText}
          </div>
        )}
      </div>
      <div className="bg-zinc-950 px-3 py-2 border-t border-zinc-800 text-center">
        <p className="text-[9px] text-zinc-500">Live preview · <span className="text-zinc-300 font-bold">sample data</span></p>
      </div>
    </div>
  );
};

const WeatherLocationCard = ({ addToast, settings, setSettings }: { addToast: any; settings: SystemSettings; setSettings: (s: SystemSettings) => void }) => {
  const [status, setStatus] = useState<'unknown' | 'granted' | 'denied' | 'prompt' | 'unsupported'>('unknown');
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [temp, setTemp] = useState<number | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) { setStatus('unsupported'); return; }
    // Check permission state if supported
    if ((navigator as any).permissions) {
      (navigator as any).permissions.query({ name: 'geolocation' }).then((r: any) => {
        setStatus(r.state);
        r.addEventListener?.('change', () => setStatus(r.state));
      }).catch(() => {});
    }
    // Try a silent fetch — if already granted it'll work
    navigator.geolocation.getCurrentPosition(
      pos => {
        setStatus('granted');
        const lat = pos.coords.latitude, lon = pos.coords.longitude;
        setCoords({ lat, lon });
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m&temperature_unit=fahrenheit`)
          .then(r => r.json() as Promise<{ current?: { temperature_2m?: number } }>).then(d => setTemp(d.current?.temperature_2m ? Math.round(d.current.temperature_2m) : null)).catch(() => {});
      },
      err => { if (err.code === err.PERMISSION_DENIED) setStatus('denied'); },
      { timeout: 8000 }
    );
  }, []);

  const request = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => {
        setStatus('granted');
        const lat = pos.coords.latitude, lon = pos.coords.longitude;
        setCoords({ lat, lon });
        addToast('success', 'Location access granted — weather will appear on TV');
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m&temperature_unit=fahrenheit`)
          .then(r => r.json() as Promise<{ current?: { temperature_2m?: number } }>).then(d => setTemp(d.current?.temperature_2m ? Math.round(d.current.temperature_2m) : null)).catch(() => {});
      },
      err => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus('denied');
          addToast('error', 'Location denied. Enable it in your browser settings.');
        } else {
          addToast('error', 'Could not get location — try again');
        }
      },
      { timeout: 10000 }
    );
  };

  const statusColor = status === 'granted' ? 'text-emerald-400' : status === 'denied' ? 'text-red-400' : 'text-amber-400';
  const statusBg = status === 'granted' ? 'bg-emerald-500/10 border-emerald-500/25' : status === 'denied' ? 'bg-red-500/10 border-red-500/25' : 'bg-amber-500/10 border-amber-500/25';

  return (
    <div className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Cloud className="w-4 h-4 text-cyan-400" aria-hidden="true" />
        <span className="text-sm font-bold text-white">Weather Location</span>
      </div>
      <p className="text-[10px] text-zinc-500 leading-snug">The TV weather slide + header widget need browser location permission to show your local forecast.</p>
      <div className={`rounded-xl border p-3 flex items-center gap-3 ${statusBg}`}>
        {status === 'granted' ? (
          <>
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
              <CheckCircle className="w-5 h-5 text-emerald-400" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-bold ${statusColor}`}>Location active</p>
              <p className="text-[10px] text-zinc-400 mt-0.5">
                {temp !== null ? <span className="text-white font-black">{temp}°F</span> : 'Loading…'}
                {coords && <span className="ml-1.5 text-zinc-600">· {coords.lat.toFixed(2)}, {coords.lon.toFixed(2)}</span>}
              </p>
            </div>
          </>
        ) : status === 'denied' ? (
          <>
            <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center shrink-0">
              <X className="w-5 h-5 text-red-400" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-bold ${statusColor}`}>Location blocked</p>
              <p className="text-[10px] text-zinc-400 mt-0.5 leading-snug">Click the 🔒 in your browser's address bar → allow location → refresh.</p>
            </div>
          </>
        ) : status === 'unsupported' ? (
          <>
            <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
              <AlertCircle className="w-5 h-5 text-zinc-500" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-zinc-400">Not supported</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">This browser doesn't support geolocation.</p>
            </div>
          </>
        ) : (
          <>
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
              <Cloud className="w-5 h-5 text-amber-400" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-bold ${statusColor}`}>Location needed</p>
              <p className="text-[10px] text-zinc-400 mt-0.5">Click below to allow this site to see your location.</p>
            </div>
            <button type="button" onClick={request} className="shrink-0 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg">Enable</button>
          </>
        )}
      </div>
      {status === 'granted' && (
        <button type="button" onClick={request} className="w-full text-[11px] text-zinc-500 hover:text-white py-1 transition-colors">Refresh location</button>
      )}

      {/* Manual fallback — works on smart TVs / kiosks where geolocation is unavailable.
          Uses Open-Meteo's free geocoding API to resolve a city or zip to lat/lon, then
          persists the result so the TV weather slide always has coordinates to hit. */}
      <div className="border-t border-white/5 pt-3 mt-2 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Manual Location (for TVs)</p>
          {settings.weatherLat != null && settings.weatherLon != null && (
            <span className="text-[9px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 rounded">✓ Saved</span>
          )}
        </div>
        <p className="text-[10px] text-zinc-500 leading-snug">
          If your TV or shop display can't share location, type a city or ZIP here. We'll look up the coordinates and save them so every device uses the same weather.
        </p>
        <ManualWeatherEditor settings={settings} setSettings={setSettings} addToast={addToast} />
      </div>
    </div>
  );
};

// Inline geocode-on-save input. Uses Open-Meteo's free geocoding (no API key).
const ManualWeatherEditor: React.FC<{ settings: SystemSettings; setSettings: (s: SystemSettings) => void; addToast: any }> = ({ settings, setSettings, addToast }) => {
  const [input, setInput] = useState(settings.weatherCity || '');
  const [looking, setLooking] = useState(false);

  const resolve = async () => {
    const q = input.trim();
    if (!q) return;
    setLooking(true);
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`);
      const d = await res.json() as { results?: Array<{ latitude: number; longitude: number; name: string; admin1?: string; country?: string; country_code?: string }> };
      const hit = d?.results?.[0];
      if (!hit || typeof hit.latitude !== 'number') {
        addToast('error', `Couldn't find "${q}" — try "City, State" or a 5-digit ZIP`);
        return;
      }
      const label = [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(', ');
      setSettings({ ...settings, weatherCity: label, weatherLat: hit.latitude, weatherLon: hit.longitude });
      addToast('success', `Weather location set: ${label}`);
      setInput(label);
    } catch {
      addToast('error', 'Geocoding failed — check your connection');
    } finally {
      setLooking(false);
    }
  };

  const clear = () => {
    setInput('');
    setSettings({ ...settings, weatherCity: '', weatherLat: undefined, weatherLon: undefined });
    addToast('info', 'Manual weather location cleared');
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !looking && resolve()}
          placeholder="e.g. Fresno, CA or 93710"
          className="flex-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white"
        />
        <button
          type="button"
          onClick={resolve}
          disabled={looking || !input.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold px-3 rounded-lg"
        >
          {looking ? 'Looking…' : 'Set'}
        </button>
      </div>
      {settings.weatherLat != null && settings.weatherLon != null && (
        <div className="flex items-center justify-between gap-2 text-[10px]">
          <span className="text-zinc-500">
            <span className="text-emerald-400 font-black">{settings.weatherCity || 'Custom'}</span>
            <span className="text-zinc-700 ml-1">· {settings.weatherLat.toFixed(2)}, {settings.weatherLon.toFixed(2)}</span>
          </span>
          <button type="button" onClick={clear} className="text-zinc-500 hover:text-red-400 font-bold">Clear</button>
        </div>
      )}
    </div>
  );
};

// ── Safety message presets ─ each emoji has a default title + body.
// User can still edit freely. Picking the icon auto-fills blank fields.
const SAFETY_PRESETS: Record<string, { title: string; body: string; color: 'yellow' | 'red' | 'orange' | 'blue' | 'green' | 'white' }> = {
  '⚠️': { title: 'Stay Alert', body: 'Watch for hazards. Report anything unsafe to your supervisor.', color: 'yellow' },
  '🦺': { title: 'Wear Your Vest', body: 'High-visibility gear is required on the shop floor.', color: 'orange' },
  '🥽': { title: 'Eye Protection', body: 'Safety glasses on at all times in the work area.', color: 'blue' },
  '🧤': { title: 'Hand Protection', body: 'Use the correct gloves for the job. Inspect before use.', color: 'blue' },
  '🚫': { title: 'No Shortcuts', body: 'Follow the process. Shortcuts cause injuries and rework.', color: 'red' },
  '🔥': { title: 'Fire Safety', body: 'Know where extinguishers are. Keep work areas clear of combustibles.', color: 'red' },
  '⚡': { title: 'Electrical Safety', body: 'Inspect cords before use. Report damaged equipment.', color: 'yellow' },
  '🛑': { title: 'Stop & Think', body: 'If something feels wrong — stop. Unsafe tasks aren\'t worth it.', color: 'red' },
  '✅': { title: 'Good Job!', body: 'Zero incidents this week — keep it up!', color: 'green' },
  '🎯': { title: 'Quality First', body: 'Double-check your work. Quality protects us all.', color: 'blue' },
  '🏭': { title: 'Keep It Clean', body: '5S: Sort, Set in order, Shine, Standardize, Sustain.', color: 'green' },
  '👷': { title: 'PPE Check', body: 'Head, eyes, ears, hands, feet — run through the list every shift.', color: 'orange' },
  '🦾': { title: 'Machine Safety', body: 'Lock-out / tag-out before servicing. No exceptions.', color: 'red' },
  '📢': { title: 'Important Notice', body: 'Check the bulletin board for today\'s updates.', color: 'blue' },
  '🔔': { title: 'Shift Change', body: 'Hand off your work cleanly. Leave notes for the next shift.', color: 'yellow' },
};

const ANNOUNCEMENT_PRESETS: Record<string, { title: string; body: string; color: 'blue' | 'yellow' | 'red' | 'green' | 'white' | 'orange' }> = {
  '📢': { title: 'Important Announcement', body: 'Please read the board for today\'s updates.', color: 'blue' },
  '🎉': { title: 'Great Job Team!', body: 'We hit our goal — thank you all for the hard work.', color: 'green' },
  '🎯': { title: 'Focus Today', body: 'Priority: get the hot jobs out the door.', color: 'blue' },
  '⭐': { title: 'Shout-Out', body: 'Congrats to our top performer this week!', color: 'yellow' },
  '✨': { title: 'Keep It Up', body: 'We\'re on track — let\'s finish strong.', color: 'green' },
  '🏆': { title: 'Milestone Hit', body: 'Celebrate the win before starting the next push.', color: 'yellow' },
  '📋': { title: 'Reminder', body: 'Log all your time — it helps us quote accurately.', color: 'blue' },
  '💡': { title: 'Suggestion Box', body: 'Have an idea? Share it with your supervisor.', color: 'blue' },
};

// ── Multi-message editor for safety + announcement slides ──
// Each slide can hold several messages that cycle one per TV rotation.
const SlideMessagesEditor = ({ slide, onUpdate }: { slide: TvSlide; onUpdate: (patch: Partial<TvSlide>) => void }) => {
  // Normalize legacy single-message slides into messages[]
  const messages: SlideMessage[] = slide.messages && slide.messages.length > 0
    ? slide.messages
    : [{ id: 'legacy', title: slide.title, body: slide.body, color: slide.color, icon: slide.icon }];

  const updateMsg = (i: number, patch: Partial<SlideMessage>) => {
    const next = [...messages];
    next[i] = { ...next[i], ...patch };
    onUpdate({ messages: next, title: undefined, body: undefined, color: undefined, icon: undefined });
  };
  const removeMsg = (i: number) => {
    if (messages.length <= 1) return;
    const next = messages.filter((_, idx) => idx !== i);
    onUpdate({ messages: next });
  };
  const addMsg = () => {
    const defaults: SlideMessage = slide.type === 'safety'
      ? { id: `m_${Date.now()}`, title: 'New Safety Reminder', body: '', color: 'yellow', icon: '⚠️' }
      : { id: `m_${Date.now()}`, title: 'New Announcement', body: '', color: 'blue' };
    onUpdate({ messages: [...messages, defaults] });
  };
  const move = (i: number, dir: -1 | 1) => {
    const t = i + dir;
    if (t < 0 || t >= messages.length) return;
    const next = [...messages];
    [next[i], next[t]] = [next[t], next[i]];
    onUpdate({ messages: next });
  };

  const icons = slide.type === 'safety' ? ['⚠️','🦺','🥽','🧤','🚫','🔥','⚡','🛑','✅','🎯','🏭','👷','🦾','📢','🔔'] : ['📢','🎉','🎯','⭐','✨','🏆','📋','💡'];

  const loadPreset = () => {
    const presets = slide.type === 'safety' ? SAFETY_PRESETS : ANNOUNCEMENT_PRESETS;
    const newMsgs: SlideMessage[] = Object.entries(presets).slice(0, slide.type === 'safety' ? 8 : 6).map(([icon, p], i) => ({
      id: `m_${Date.now()}_${i}`,
      title: p.title,
      body: p.body,
      color: p.color,
      ...(slide.type === 'safety' ? { icon } : {}),
    }));
    onUpdate({ messages: newMsgs, title: undefined, body: undefined, color: undefined, icon: undefined });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
          {slide.type === 'safety' ? 'Safety Messages' : 'Announcements'} · {messages.length} total
        </p>
        <div className="flex gap-1">
          <button type="button" onClick={loadPreset} className="text-[10px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded-md flex items-center gap-1" title="Replace with preset pack">
            ✨ Preset Pack
          </button>
          <button type="button" onClick={addMsg} className="text-[10px] font-bold bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded-md flex items-center gap-1">
            <Plus className="w-3 h-3" aria-hidden="true" /> Add
          </button>
        </div>
      </div>
      <p className="text-[10px] text-zinc-600 italic">Each message shows in turn — one per slide rotation. Great for cycling 10 safety tips without cluttering the rotation.</p>
      <div className="space-y-2">
        {messages.map((m, i) => (
          <div key={m.id} className="bg-zinc-900/60 border border-white/5 rounded-lg p-2.5 space-y-1.5">
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">#{i + 1}</span>
              <div className="flex-1" />
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="text-zinc-500 hover:text-white disabled:opacity-20 p-0.5"><ChevronUp className="w-3 h-3" aria-hidden="true" /></button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === messages.length - 1} aria-label="Move down" className="text-zinc-500 hover:text-white disabled:opacity-20 p-0.5"><ChevronDown className="w-3 h-3" aria-hidden="true" /></button>
              {messages.length > 1 && <button type="button" onClick={() => removeMsg(i)} aria-label="Remove message" className="text-zinc-500 hover:text-red-400 p-0.5"><X className="w-3 h-3" aria-hidden="true" /></button>}
            </div>
            <input className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-1 text-xs text-white" placeholder={slide.type === 'safety' ? 'Safety reminder title…' : 'Announcement title…'} value={m.title || ''} onChange={e => updateMsg(i, { title: e.target.value })} />
            <textarea className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-1 text-[11px] text-white resize-y" rows={2} placeholder="Body (optional)…" value={m.body || ''} onChange={e => updateMsg(i, { body: e.target.value })} />
            {slide.type === 'safety' && (
              <div className="flex flex-wrap gap-1">
                {icons.map(icn => (
                  <button
                    key={icn}
                    type="button"
                    onClick={() => {
                      const preset = SAFETY_PRESETS[icn];
                      const patch: Partial<SlideMessage> = { icon: icn };
                      // Only auto-fill blank fields so we don't overwrite user's edits
                      if (preset) {
                        if (!m.title?.trim()) patch.title = preset.title;
                        if (!m.body?.trim()) patch.body = preset.body;
                        if (!m.color) patch.color = preset.color;
                      }
                      updateMsg(i, patch);
                    }}
                    className={`w-7 h-7 rounded-md transition-all text-base ${(m.icon || '⚠️') === icn ? 'bg-blue-500/30 ring-2 ring-blue-500' : 'bg-zinc-900 hover:bg-zinc-800'}`}
                    title={SAFETY_PRESETS[icn] ? `${SAFETY_PRESETS[icn].title} — click to use preset` : icn}
                  >{icn}</button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-widest mr-1">Color:</span>
              {[{id:'blue',cls:'bg-blue-500'},{id:'yellow',cls:'bg-yellow-500'},{id:'orange',cls:'bg-orange-500'},{id:'red',cls:'bg-red-500'},{id:'green',cls:'bg-emerald-500'},{id:'white',cls:'bg-white'}].map(c => (
                <button key={c.id} type="button" onClick={() => updateMsg(i, { color: c.id as any })} className={`w-5 h-5 rounded ${c.cls} transition-all ${(m.color || (slide.type === 'safety' ? 'yellow' : 'blue')) === c.id ? 'ring-2 ring-white scale-110' : 'opacity-40 hover:opacity-80'}`} aria-label={c.id} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const TvSlidesEditor = ({ settings, setSettings }: { settings: SystemSettings; setSettings: (s: SystemSettings) => void }) => {
  const slides = settings.tvSlides || [];
  const [addOpen, setAddOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { confirm: askConfirm, ConfirmHost } = useConfirm();

  const update = (idx: number, patch: Partial<TvSlide>) => {
    const next = [...slides];
    next[idx] = { ...next[idx], ...patch };
    setSettings({ ...settings, tvSlides: next });
  };
  const remove = (idx: number) => {
    setSettings({ ...settings, tvSlides: slides.filter((_, i) => i !== idx) });
  };
  const move = (idx: number, dir: -1 | 1) => {
    const t = idx + dir;
    if (t < 0 || t >= slides.length) return;
    const next = [...slides];
    [next[idx], next[t]] = [next[t], next[idx]];
    setSettings({ ...settings, tvSlides: next });
  };
  const add = (type: TvSlide['type']) => {
    const defaults: Record<string, Partial<TvSlide>> = {
      workers:      { title: 'Live Workers' },
      jobs:         { title: 'Open Jobs' },
      leaderboard:  { leaderboardMetric: 'mixed', leaderboardPeriod: 'week', leaderboardCount: 5 },
      weather:      {},
      'stats-week': {},
      goals:        {},
      'flow-map':   {},
      safety:       { title: 'Safety First', body: 'Wear your PPE. Keep your work area clean. Report hazards.', color: 'yellow', icon: '⚠️' },
      message:      { title: 'Announcement', body: '', color: 'blue' },
      stats:        {},
    };
    const newSlide: TvSlide = {
      id: `${type}_${Date.now()}`,
      type,
      enabled: true,
      ...defaults[type],
    };
    setSettings({ ...settings, tvSlides: [...slides, newSlide] });
    setAddOpen(false);
    setExpandedId(newSlide.id);
  };

  const enabledCount = slides.filter(s => s.enabled).length;

  return (
    <details open className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
      <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-white/[0.02]">
        <div>
          <p className="text-sm font-bold text-white flex items-center gap-2">📺 Slides</p>
          <p className="text-[10px] text-zinc-500 mt-0.5">{slides.length === 0 ? 'Using defaults (Workers · Leaderboard · Weather · Stats)' : `${enabledCount} of ${slides.length} enabled`}</p>
        </div>
        <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" />
      </summary>
      <div className="px-4 pb-4 space-y-3">
        {/* Add slide menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setAddOpen(!addOpen)}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold px-3 py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-900/30"
          >
            <Plus className="w-4 h-4" aria-hidden="true" /> Add Slide {addOpen ? '▲' : '▼'}
          </button>
          {addOpen && (
            <div className="mt-2 grid grid-cols-1 gap-1.5 p-2 bg-zinc-950 border border-white/10 rounded-xl animate-fade-in">
              {(Object.keys(SLIDE_TYPE_META) as (keyof typeof SLIDE_TYPE_META)[]).filter(t => t !== 'stats').map(t => {
                const meta = SLIDE_TYPE_META[t];
                // Non-configurable types render identical content every time — warn on duplicate add
                const SINGLE_INSTANCE: TvSlide['type'][] = ['workers', 'jobs', 'weather', 'stats-week', 'goals', 'flow-map'];
                const existing = slides.filter(s => s.type === t).length;
                const alreadyExists = SINGLE_INSTANCE.includes(t as TvSlide['type']) && existing > 0;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={async () => {
                      if (alreadyExists) {
                        const ok = await askConfirm({
                          title: `Add another "${meta.label}" slide?`,
                          message: 'You already have one of these. Adding another will show the same content twice in the rotation.',
                          tone: 'warning',
                          confirmLabel: 'Add anyway',
                        });
                        if (!ok) return;
                      }
                      add(t as TvSlide['type']);
                    }}
                    className={`text-left px-3 py-2 rounded-lg border ${meta.color} hover:brightness-125 transition-all flex items-center gap-2.5`}
                  >
                    <span className="text-xl" aria-hidden="true">{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-white flex items-center gap-1.5">
                        {meta.label}
                        {alreadyExists && <span className="text-[9px] font-black text-yellow-400 bg-yellow-500/15 border border-yellow-500/30 rounded px-1 py-0.5">✓ Added</span>}
                      </p>
                      <p className="text-[10px] text-white/60 mt-0.5 leading-tight">{meta.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {slides.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/10 p-4 text-center">
            <p className="text-xs text-zinc-400 font-bold">Using default slideshow</p>
            <p className="text-[10px] text-zinc-600 mt-1 leading-relaxed">
              Workers+Jobs · Leaderboard · Weather · Week Stats will rotate every {settings.tvSlideDuration || 15}s.<br />
              Click <strong className="text-zinc-400">Add Slide</strong> above to customize.
            </p>
          </div>
        )}

        {slides.map((slide, idx) => {
          const meta = SLIDE_TYPE_META[slide.type] || SLIDE_TYPE_META.message;
          const expanded = expandedId === slide.id;
          return (
            <div key={slide.id} className={`border rounded-xl overflow-hidden transition-all ${slide.enabled ? 'border-white/10 bg-zinc-800/20' : 'border-white/5 bg-zinc-900/40 opacity-60'}`}>
              {/* Header row */}
              <div className="p-2.5 flex items-center gap-2">
                {/* Move up/down */}
                <div className="flex flex-col shrink-0">
                  <button type="button" aria-label="Move up" disabled={idx === 0} onClick={() => move(idx, -1)} className="text-zinc-500 hover:text-white disabled:opacity-20 disabled:hover:text-zinc-500"><ChevronUp className="w-3 h-3" aria-hidden="true" /></button>
                  <button type="button" aria-label="Move down" disabled={idx === slides.length - 1} onClick={() => move(idx, 1)} className="text-zinc-500 hover:text-white disabled:opacity-20 disabled:hover:text-zinc-500"><ChevronDown className="w-3 h-3" aria-hidden="true" /></button>
                </div>
                {/* Icon + label */}
                <button type="button" onClick={() => setExpandedId(expanded ? null : slide.id)} className="flex-1 flex items-center gap-2 min-w-0 text-left">
                  <span className="text-lg shrink-0" aria-hidden="true">{meta.icon}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white truncate">{slide.title || meta.label}</p>
                    <p className="text-[9px] text-zinc-500 truncate">{slide.type === 'leaderboard' ? `${slide.leaderboardPeriod || 'week'} · top ${slide.leaderboardCount || 5}` : meta.label}</p>
                  </div>
                </button>
                {/* Duration */}
                <select
                  className="bg-zinc-950 border border-white/10 rounded px-1 py-0.5 text-white text-[10px] shrink-0"
                  aria-label="Duration"
                  value={slide.duration || settings.tvSlideDuration || 15}
                  onChange={e => update(idx, { duration: Number(e.target.value) })}
                >
                  {[5, 10, 15, 20, 30, 45, 60, 90].map(s => <option key={s} value={s}>{s}s</option>)}
                </select>
                {/* Enabled toggle */}
                <label className="flex items-center gap-1 shrink-0 cursor-pointer" title={slide.enabled ? 'Disable slide' : 'Enable slide'}>
                  <input
                    type="checkbox"
                    checked={slide.enabled}
                    onChange={e => update(idx, { enabled: e.target.checked })}
                    className="w-3.5 h-3.5 rounded accent-blue-500"
                  />
                </label>
                {/* Delete */}
                <button type="button" aria-label="Delete slide" onClick={() => remove(idx)} className="text-zinc-600 hover:text-red-400 shrink-0 p-1"><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
              </div>

              {/* Expanded editor */}
              {expanded && (
                <div className="border-t border-white/5 bg-zinc-950/40 p-3 space-y-2">
                  {(slide.type === 'message' || slide.type === 'safety') && (
                    <SlideMessagesEditor slide={slide} onUpdate={(patch) => update(idx, patch)} />
                  )}
                  {slide.type === 'leaderboard' && (
                    <>
                      <div>
                        <label className="text-[10px] text-zinc-500 block mb-1 font-bold uppercase tracking-widest">Period</label>
                        <div role="group" className="inline-flex gap-1 p-1 bg-zinc-900 border border-white/10 rounded-lg w-full">
                          {(['today', 'week', 'month'] as const).map(p => (
                            <button key={p} type="button" onClick={() => update(idx, { leaderboardPeriod: p })} aria-pressed={(slide.leaderboardPeriod || 'week') === p} className={`flex-1 px-2 py-1 text-[10px] font-bold rounded capitalize ${(slide.leaderboardPeriod || 'week') === p ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'}`}>{p}</button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-500 block mb-1 font-bold uppercase tracking-widest">Show</label>
                        <div role="group" className="inline-flex gap-1 p-1 bg-zinc-900 border border-white/10 rounded-lg w-full">
                          {(['hours', 'jobs', 'mixed'] as const).map(m => (
                            <button key={m} type="button" onClick={() => update(idx, { leaderboardMetric: m })} aria-pressed={(slide.leaderboardMetric || 'mixed') === m} className={`flex-1 px-2 py-1 text-[10px] font-bold rounded capitalize ${(slide.leaderboardMetric || 'mixed') === m ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'}`}>{m === 'mixed' ? 'Hours + Jobs' : m}</button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-500 block mb-1 font-bold uppercase tracking-widest">Top N workers · {slide.leaderboardCount || 5}</label>
                        <input type="range" min={3} max={10} value={slide.leaderboardCount || 5} onChange={e => update(idx, { leaderboardCount: Number(e.target.value) })} className="w-full accent-blue-500" />
                      </div>
                    </>
                  )}
                  {(slide.type === 'workers' || slide.type === 'jobs' || slide.type === 'weather' || slide.type === 'stats-week' || slide.type === 'stats' || slide.type === 'flow-map' || slide.type === 'goals') && (
                    <p className="text-[10px] text-zinc-500 italic">No additional options — this slide uses the shop's live data.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {slides.length > 0 && (
          <div className="pt-2 border-t border-white/5 space-y-1">
            <button
              type="button"
              onClick={async () => {
                // Load the default lineup so user can customize from a clean state
                const ok = await askConfirm({
                  title: 'Replace slides with defaults?',
                  message: 'Sets up Workers · Jobs · Leaderboards · Goals · Week Stats · Weather. Your current customizations will be removed.',
                  tone: 'warning',
                  confirmLabel: 'Replace',
                });
                if (!ok) return;
                const ts = Date.now();
                setSettings({ ...settings, tvSlides: [
                  { id: `slide_${ts}_1`, type: 'workers', enabled: true },
                  { id: `slide_${ts}_2`, type: 'jobs', enabled: true },
                  { id: `slide_${ts}_3`, type: 'leaderboard', enabled: true, leaderboardMetric: 'mixed', leaderboardPeriod: 'week', leaderboardCount: 5 },
                  { id: `slide_${ts}_4`, type: 'leaderboard', enabled: true, leaderboardMetric: 'mixed', leaderboardPeriod: 'month', leaderboardCount: 5 },
                  { id: `slide_${ts}_5`, type: 'goals', enabled: true },
                  { id: `slide_${ts}_6`, type: 'stats-week', enabled: true },
                  { id: `slide_${ts}_7`, type: 'weather', enabled: true },
                ]});
              }}
              className="w-full text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/5 py-1.5 rounded transition-colors font-bold"
            >
              ↻ Load Default Lineup
            </button>
            <button
              type="button"
              onClick={async () => {
                const ok = await askConfirm({
                  title: 'Clear all slides?',
                  message: 'The TV will fall back to the default rotation (Workers + Jobs + Leaderboard + Weather + Stats).',
                  tone: 'danger',
                  confirmLabel: 'Clear all',
                });
                if (ok) setSettings({ ...settings, tvSlides: [] });
              }}
              className="w-full text-[10px] text-zinc-600 hover:text-red-400 py-1 transition-colors"
            >
              Clear all (use built-in defaults)
            </button>
          </div>
        )}
      </div>
      {ConfirmHost}
    </details>
  );
};

// ── TV Mirror Preview ─ a miniature, true-to-life mock of the TV-mode layout
// so admins can see how their customizations will look before they push to TV.
// Cycles through configured slides at 1/3 speed so admins can see each one.
const TvMirrorPreview = ({ settings, activeLogs, jobs, allLogs }: { settings: SystemSettings; activeLogs: TimeLog[]; jobs: Job[]; allLogs: TimeLog[] }) => {
  const [previewSlideIdx, setPreviewSlideIdx] = useState(0);
  // Same default slides as TV mode — deduped by id so legacy configs can't double-show
  const enabledSlides: TvSlide[] = (settings.tvSlides && settings.tvSlides.filter(s => s.enabled).length > 0)
    ? settings.tvSlides.filter(s => s.enabled)
    : [
        { id: 'p-workers', type: 'workers', enabled: true },
        { id: 'p-leader', type: 'leaderboard', enabled: true, leaderboardPeriod: 'week', leaderboardCount: 5, leaderboardMetric: 'mixed' },
        { id: 'p-weather', type: 'weather', enabled: true },
        { id: 'p-stats', type: 'stats-week', enabled: true },
      ];
  const slides = React.useMemo(() => {
    const seen = new Set<string>();
    const out: TvSlide[] = [];
    for (const s of enabledSlides) { if (seen.has(s.id)) continue; seen.add(s.id); out.push(s); }
    return out;
  }, [enabledSlides]);
  useEffect(() => {
    if (slides.length <= 1) return;
    const t = setInterval(() => setPreviewSlideIdx(prev => (prev + 1) % slides.length), 4000);
    return () => clearInterval(t);
  }, [slides.length]);
  const currentSlide = slides[previewSlideIdx] || slides[0];

  return <TvMirrorPreviewInner settings={settings} activeLogs={activeLogs} jobs={jobs} allLogs={allLogs} slides={slides} currentSlide={currentSlide} previewSlideIdx={previewSlideIdx} setPreviewSlideIdx={setPreviewSlideIdx} />;
};

const TvMirrorPreviewInner = ({ settings, activeLogs, jobs, allLogs, slides, currentSlide, previewSlideIdx, setPreviewSlideIdx }: { settings: SystemSettings; activeLogs: TimeLog[]; jobs: Job[]; allLogs: TimeLog[]; slides: TvSlide[]; currentSlide: TvSlide; previewSlideIdx: number; setPreviewSlideIdx: (i: number) => void }) => {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(i); }, []);
  const runningCount = activeLogs.filter(l => !l.pausedAt).length;
  const pausedCount = activeLogs.filter(l => !!l.pausedAt).length;
  const workerCount = new Set(activeLogs.map(l => l.userId)).size;
  const openJobs = jobs.filter(j => j.status !== 'completed').slice(0, 8);
  const sorted = [...activeLogs].sort((a, b) => {
    const ap = a.pausedAt ? 1 : 0, bp = b.pausedAt ? 1 : 0;
    return ap !== bp ? ap - bp : a.startTime - b.startTime;
  }).slice(0, 4);
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const fmtElapsed = (log: TimeLog) => {
    const el = DB.getWorkingElapsedMs(log);
    const s = Math.floor(el / 1000);
    return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <div className="sticky top-4 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs font-black text-zinc-500 uppercase tracking-widest flex items-center gap-1.5"><Radio className="w-3.5 h-3.5 text-red-500 animate-pulse" aria-hidden="true" /> Live TV Preview</p>
        <p className="text-[10px] text-zinc-600">Updates as you change settings</p>
      </div>
      {/* TV frame */}
      <div className="bg-black rounded-2xl shadow-2xl overflow-hidden border-2 border-zinc-800 p-2">
        <div className="bg-gradient-to-br from-zinc-950 via-black to-zinc-950 rounded-xl overflow-hidden relative" style={{ aspectRatio: '16 / 9' }}>
          {/* Ambient glow */}
          <div aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-blue-600/10 blur-[60px]" />
            <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-600/10 blur-[60px]" />
          </div>

          {/* TOP BAR */}
          <div className="relative shrink-0 px-3 py-2 flex items-center justify-between gap-3 border-b border-white/5 backdrop-blur-xl bg-black/20">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {settings.companyLogo && <img src={settings.companyLogo} alt="" className="h-5 object-contain" />}
              <div className="min-w-0">
                {settings.companyName && <p className="text-[11px] font-black text-white truncate">{settings.companyName}</p>}
                <div className="flex items-center gap-1"><Radio className="w-2 h-2 text-red-500 animate-pulse" /><span className="text-[7px] font-black text-white/60 uppercase tracking-[0.3em]">Live</span></div>
              </div>
            </div>
            {settings.tvShowClock !== false && (
              <div className="shrink-0 text-center">
                <p className="text-[15px] sm:text-lg font-black text-white tabular leading-none tracking-tight">{timeStr}</p>
                <p className="text-white/40 text-[7px] font-semibold mt-0.5 truncate max-w-[90px]">{dateStr}</p>
              </div>
            )}
            <div className="shrink-0 flex items-center gap-2 min-w-0 flex-1 justify-end">
              {settings.tvShowStats !== false && (
                <div className="flex items-center gap-2">
                  <div className="text-center"><p className="text-[13px] font-black text-white tabular leading-none">{workerCount}</p><p className="text-[6px] font-black text-white/30 uppercase tracking-widest mt-0.5">Wrk</p></div>
                  <div className="w-px h-4 bg-white/10" />
                  <div className="text-center"><p className="text-[13px] font-black text-white tabular leading-none">{runningCount}</p><p className="text-[6px] font-black text-white/30 uppercase tracking-widest mt-0.5">Run</p></div>
                  <div className="w-px h-4 bg-white/10" />
                  <div className="text-center"><p className="text-[13px] font-black text-white tabular leading-none">{openJobs.length}</p><p className="text-[6px] font-black text-white/30 uppercase tracking-widest mt-0.5">Open</p></div>
                </div>
              )}
              {settings.tvShowWeather !== false && <div className="bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[8px] text-white/60">72°F</div>}
            </div>
          </div>

          {/* MAIN: Rotating slides (scaled-down representation) */}
          <div className="absolute left-0 right-0 bottom-[18px] top-[42px] overflow-hidden">
            <MiniSlideRender slide={currentSlide} activeLogs={activeLogs} jobs={jobs} settings={settings} sorted={sorted} openJobs={openJobs} fmtElapsed={fmtElapsed} allLogs={allLogs} />
          </div>

          {/* Slide indicator dots */}
          {slides.length > 1 && (
            <div className="absolute bottom-0 left-0 right-0 h-[18px] flex items-center justify-center gap-1 px-2 bg-black/50 backdrop-blur-sm">
              {slides.map((s, i) => (
                <button key={s.id} type="button" onClick={() => setPreviewSlideIdx(i)} aria-label={`Show ${SLIDE_TYPE_META[s.type]?.label || s.type}`} aria-current={i === previewSlideIdx ? 'true' : undefined} className="flex items-center gap-0.5">
                  <span className={`h-1 rounded-full transition-all ${i === previewSlideIdx ? 'w-5 bg-blue-500' : 'w-1 bg-white/20'}`} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px] text-zinc-600 px-1">
        <span>📺 Previewing: <strong className="text-zinc-400">{SLIDE_TYPE_META[currentSlide?.type]?.label || 'Slide'}</strong> ({previewSlideIdx + 1}/{slides.length})</span>
        <span>{activeLogs.length} live · {openJobs.length} open</span>
      </div>
    </div>
  );
};

// Miniature rendering of each slide type for the settings preview.
// Wired to LIVE data (allLogs + jobs) so admins see what will actually appear on TV
// — not hardcoded placeholder numbers that would repeat on every slide cycle.
const MiniSlideRender = ({ slide, activeLogs, jobs, settings, sorted, openJobs, fmtElapsed, allLogs = [] }: any) => {
  if (!slide) return null;

  if (slide.type === 'workers' || !slide.type) {
    return (
      <div className="h-full grid grid-cols-2 gap-0">
        <div className="border-r border-white/5 overflow-hidden flex flex-col">
          <div className="px-3 py-1.5 border-b border-white/5 flex items-center justify-between">
            <h2 className="text-[8px] font-black text-white/60 uppercase tracking-[0.3em]">● Running</h2>
            <span className="text-[8px] text-white/40 font-mono">{activeLogs.filter((l: any) => !l.pausedAt).length}</span>
          </div>
          <div className="flex-1 overflow-hidden p-2 space-y-1.5">
            {sorted.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-2">
                <div className="w-8 h-8 rounded-xl bg-zinc-800/60 border border-white/5 flex items-center justify-center mb-1"><Activity className="w-4 h-4 text-zinc-600" aria-hidden="true" /></div>
                <p className="text-zinc-400 text-[10px] font-bold">Floor is quiet</p>
              </div>
            ) : sorted.map((log: any) => {
              const job = jobs.find((j: any) => j.id === log.jobId);
              const isPaused = !!log.pausedAt;
              return (
                <div key={log.id} className={`bg-gradient-to-br rounded-lg p-1.5 border ${isPaused ? 'from-yellow-500/10 to-yellow-500/0 border-yellow-500/25' : 'from-zinc-900/90 to-zinc-900/40 border-white/5'}`}>
                  <div className="flex items-center gap-1.5">
                    <div className={`shrink-0 w-6 h-6 rounded-md flex items-center justify-center font-black text-[9px] text-white ${isPaused ? 'bg-gradient-to-br from-yellow-500 to-orange-500' : 'bg-gradient-to-br from-blue-500 to-indigo-600'}`}>{log.userName.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-black text-white truncate leading-tight">{log.userName}</p>
                      <p className="text-[7px] text-blue-300 truncate">{log.operation}</p>
                      {settings.tvShowJobId !== false && job && <p className="text-[6px] text-white/40 truncate">PO {job.poNumber}</p>}
                    </div>
                    <p className="text-[10px] font-black text-white tabular shrink-0">{fmtElapsed(log)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {settings.tvShowJobsBelt !== false ? (
          <div className="overflow-hidden flex flex-col">
            <div className="px-3 py-1.5 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-[8px] font-black text-white/60 uppercase tracking-[0.3em]">Open Jobs</h2>
            </div>
            <div className="flex-1 overflow-hidden p-2 space-y-1.5">
              {openJobs.slice(0, 4).map((j: any) => (
                <div key={j.id} className="bg-zinc-900/50 border border-white/5 rounded-md px-1.5 py-1">
                  <span className="text-[10px] font-black text-white tabular truncate">{j.poNumber}</span>
                  <p className="text-[7px] text-white/60 truncate">{j.partNumber}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center p-4 text-[8px] text-zinc-600 italic">Jobs Belt off</div>
        )}
      </div>
    );
  }

  if (slide.type === 'jobs') {
    return (
      <div className="h-full overflow-hidden flex flex-col p-3">
        <h2 className="text-[8px] font-black text-white/60 uppercase tracking-[0.3em] mb-2">All Open Jobs ({openJobs.length})</h2>
        <div className="flex-1 overflow-hidden grid grid-cols-2 gap-1.5">
          {openJobs.slice(0, 8).map((j: any) => (
            <div key={j.id} className="bg-zinc-900/50 border border-white/5 rounded-md px-1.5 py-1">
              <span className="text-[10px] font-black text-white tabular truncate block">{j.poNumber}</span>
              <p className="text-[7px] text-white/60 truncate">{j.partNumber}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (slide.type === 'leaderboard') {
    // Build real leaderboard from allLogs for the chosen period
    const now = new Date();
    let cutoff: number;
    if (slide.leaderboardPeriod === 'today') {
      const d = new Date(); d.setHours(0, 0, 0, 0); cutoff = d.getTime();
    } else if (slide.leaderboardPeriod === 'month') {
      cutoff = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    } else {
      const w = new Date(); w.setDate(w.getDate() - w.getDay()); w.setHours(0, 0, 0, 0); cutoff = w.getTime();
    }
    const userMap = new Map<string, { name: string; hours: number }>();
    (allLogs as TimeLog[]).filter(l => l.startTime >= cutoff && l.endTime).forEach(l => {
      const cur = userMap.get(l.userId) || { name: l.userName, hours: 0 };
      cur.hours += (l.durationMinutes || 0) / 60;
      cur.name = l.userName;
      userMap.set(l.userId, cur);
    });
    const top = Array.from(userMap.values()).sort((a, b) => b.hours - a.hours).slice(0, 3);
    const maxH = Math.max(1, ...top.map(u => u.hours));
    const periodLabel = slide.leaderboardPeriod === 'today' ? "Today" : slide.leaderboardPeriod === 'month' ? "This Month" : "This Week";

    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-[8px] font-black text-amber-400 uppercase tracking-widest">🏆 Leaderboard</p>
        <h2 className="text-lg font-black text-white tracking-tight mt-1">{periodLabel}'s Top Workers</h2>
        <div className="w-full mt-3 space-y-1">
          {top.length === 0 ? (
            <p className="text-[9px] text-zinc-500 italic py-3">No hours logged yet {slide.leaderboardPeriod === 'today' ? 'today' : 'this period'}</p>
          ) : ['🥇','🥈','🥉'].slice(0, top.length).map((medal, i) => (
            <div key={i} className={`flex items-center gap-2 p-1.5 rounded-lg ${i === 0 ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-zinc-900/50'}`}>
              <span className="text-lg">{medal}</span>
              <div className="flex-1 min-w-0 flex flex-col items-start">
                <p className="text-[9px] font-black text-white truncate max-w-full">{top[i].name}</p>
                <div className="w-full h-1 rounded-full bg-white/5 overflow-hidden mt-0.5"><div className={`h-full rounded-full ${i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-zinc-400' : 'bg-orange-500'}`} style={{ width: `${(top[i].hours / maxH) * 100}%` }} /></div>
              </div>
              <span className="text-[10px] font-black text-white tabular">{top[i].hours.toFixed(1)}h</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (slide.type === 'flow-map') {
    const stages = getStages(settings);
    return (
      <div className="h-full flex flex-col items-center justify-center p-2 text-center">
        <p className="text-[8px] font-black text-indigo-400 uppercase tracking-widest">🗺️ Flow Map</p>
        <h2 className="text-xs font-black text-white tracking-tight mt-0.5 mb-1">Where Every Job Is</h2>
        <div className="w-full scale-[0.6] origin-top -mt-1">
          <ShopFlowMap jobs={jobs} stages={stages} activeLogs={activeLogs} compact />
        </div>
      </div>
    );
  }

  if (slide.type === 'weather') {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-[8px] font-black text-blue-400 uppercase tracking-widest">🌤️ Weather</p>
        <div className="flex items-center gap-3 mt-2">
          <div className="text-5xl font-black text-white tabular">72°</div>
          <div className="text-left">
            <p className="text-[10px] text-white/70">Partly cloudy</p>
            <p className="text-[9px] text-white/40">H 78° · L 62°</p>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-5 gap-1 w-full">
          {['Today', 'Tue', 'Wed', 'Thu', 'Fri'].map((d, i) => (
            <div key={d} className="bg-zinc-900/50 border border-white/5 rounded p-1 text-center">
              <p className="text-[6px] font-black text-white/40 uppercase">{d}</p>
              <p className="text-[9px] font-black text-white tabular">{78 - i}°</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (slide.type === 'stats-week' || slide.type === 'stats') {
    // Compute real weekly stats from allLogs + jobs (same math as full-screen TV slide)
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0, 0, 0, 0);
    const wkMs = weekStart.getTime();
    const weekLogs = (allLogs as TimeLog[]).filter(l => l.startTime >= wkMs && l.endTime);
    const totalH = weekLogs.reduce((a, l) => a + (l.durationMinutes || 0) / 60, 0);
    const sessions = weekLogs.length;
    const completedThisWeek = (jobs as Job[]).filter(j => j.status === 'completed' && (j.completedAt || 0) >= wkMs).length;
    // Hours per day of week (Sun..Sat)
    const daily = Array.from({ length: 7 }, (_, i) => {
      const start = new Date(weekStart); start.setDate(weekStart.getDate() + i);
      const end = new Date(start); end.setDate(start.getDate() + 1);
      const hrs = weekLogs.filter(l => l.startTime >= start.getTime() && l.startTime < end.getTime()).reduce((a, l) => a + (l.durationMinutes || 0) / 60, 0);
      return hrs;
    });
    const maxH = Math.max(1, ...daily);
    const anyData = totalH > 0 || sessions > 0 || completedThisWeek > 0;

    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-[8px] font-black text-emerald-400 uppercase tracking-widest">📊 Weekly Output</p>
        <h2 className="text-lg font-black text-white tracking-tight mt-1">This Week at a Glance</h2>
        <div className="mt-2 grid grid-cols-3 gap-1 w-full">
          <div className="bg-blue-500/10 border border-blue-500/20 rounded p-1.5 text-center"><p className="text-[6px] text-blue-400 font-black">Hours</p><p className="text-sm font-black text-white tabular">{totalH.toFixed(1)}h</p></div>
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded p-1.5 text-center"><p className="text-[6px] text-emerald-400 font-black">Jobs</p><p className="text-sm font-black text-white tabular">{completedThisWeek}</p></div>
          <div className="bg-purple-500/10 border border-purple-500/20 rounded p-1.5 text-center"><p className="text-[6px] text-purple-400 font-black">Sessions</p><p className="text-sm font-black text-white tabular">{sessions}</p></div>
        </div>
        <div className="mt-2 flex items-end gap-1 h-12 w-full">
          {daily.map((h, i) => (
            <div key={i} className="flex-1 bg-blue-500/40 rounded-t" style={{ height: `${Math.max(anyData ? 4 : 0, (h / maxH) * 100)}%` }} />
          ))}
        </div>
        {!anyData && <p className="text-[8px] text-zinc-500 italic mt-1">No activity yet this week</p>}
      </div>
    );
  }

  if (slide.type === 'safety') {
    const palette: any = { red: 'from-red-500/20 border-red-500/40', yellow: 'from-yellow-500/20 border-yellow-500/40', orange: 'from-orange-500/20 border-orange-500/40', blue: 'from-blue-500/20 border-blue-500/40', green: 'from-emerald-500/20 border-emerald-500/40', white: 'from-white/15 border-white/40' };
    const cls = palette[slide.color || 'yellow'] || palette.yellow;
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className={`w-full h-full bg-gradient-to-br ${cls.split(' ')[0]} to-transparent border-2 ${cls.split(' ')[1]} rounded-2xl p-3 text-center flex flex-col items-center justify-center`}>
          <p className={`text-[7px] font-black uppercase tracking-[0.4em] mb-1`} style={{ color: slide.color === 'red' ? '#f87171' : slide.color === 'green' ? '#34d399' : slide.color === 'orange' ? '#fb923c' : slide.color === 'blue' ? '#60a5fa' : '#facc15' }}>⚠ Safety</p>
          <div className="text-3xl mb-1">{slide.icon || '⚠️'}</div>
          <h2 className="text-base font-black text-white tracking-tight leading-tight">{slide.title || 'Think Safety First'}</h2>
          {slide.body && <p className="text-[9px] text-white/70 mt-1 leading-snug">{slide.body}</p>}
        </div>
      </div>
    );
  }

  if (slide.type === 'message') {
    const palette: any = { blue: 'from-blue-500/20 border-blue-500/40', yellow: 'from-yellow-500/20 border-yellow-500/40', red: 'from-red-500/20 border-red-500/40', green: 'from-emerald-500/20 border-emerald-500/40', white: 'from-white/15 border-white/40', orange: 'from-orange-500/20 border-orange-500/40' };
    const cls = palette[slide.color || 'blue'] || palette.blue;
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className={`w-full h-full bg-gradient-to-br ${cls.split(' ')[0]} to-transparent border-2 ${cls.split(' ')[1]} rounded-2xl p-4 text-center flex flex-col items-center justify-center`}>
          <p className="text-[7px] font-black uppercase tracking-[0.4em] text-white/60 mb-2">Announcement</p>
          <h2 className="text-lg font-black text-white tracking-tight leading-tight">{slide.title || 'Message'}</h2>
          {slide.body && <p className="text-[9px] text-white/70 mt-2 leading-snug">{slide.body}</p>}
        </div>
      </div>
    );
  }

  return null;
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

export const SettingsView = ({ addToast, userId }: { addToast: any; userId?: string }) => {
  const { confirm: askConfirm, ConfirmHost } = useConfirm();
  const [settings, setSettings] = useState<SystemSettings>(DB.getSettings());
  const [newOp, setNewOp] = useState('');
  const [newClient, setNewClient] = useState('');
  const [settingsTab, setSettingsTab] = useState<'profile' | 'schedule' | 'production' | 'financial' | 'goals' | 'documents' | 'tv' | 'system'>('profile');
  // Within the Documents tab, split customer-facing Quote/Invoice settings
  // from internal Job Traveler settings — admins were confusing them.
  const [docSubTab, setDocSubTab] = useState<'quote' | 'traveler'>('quote');
  const [opsOpen, setOpsOpen] = useState(false);
  const [clientsOpen, setClientsOpen] = useState(false);
  // Live data for TV preview
  const [tvActiveLogs, setTvActiveLogs] = useState<TimeLog[]>([]);
  const [tvJobs, setTvJobs] = useState<Job[]>([]);
  const [tvAllLogs, setTvAllLogs] = useState<TimeLog[]>([]);

  useEffect(() => {
    const unsub = DB.subscribeSettings((s) => setSettings(s));
    const unsub2 = DB.subscribeActiveLogs(setTvActiveLogs);
    const unsub3 = DB.subscribeJobs(setTvJobs);
    const unsub4 = DB.subscribeLogs(setTvAllLogs);
    return () => { unsub(); unsub2(); unsub3(); unsub4(); };
  }, []);

  const handleSave = () => { DB.saveSettings(settings); addToast('success', 'Settings Updated'); };

  // Autosave: save settings 1.5s after any change
  const settingsJson = JSON.stringify(settings);
  const initialSettingsRef = useRef(settingsJson);
  useEffect(() => {
    if (settingsJson === initialSettingsRef.current) return; // skip initial render
    const timer = setTimeout(() => {
      DB.saveSettings(settings);
    }, 1500);
    return () => clearTimeout(timer);
  }, [settingsJson]);
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
        { id: 'tv', label: 'Live Display', icon: Activity },
      ],
    },
  ];
  // Flat list for mobile pills
  const sideItems = sideGroups.flatMap(g => g.items);

  // Autosave indicator — pulses briefly after each change
  const [savedFlash, setSavedFlash] = useState(false);
  useEffect(() => {
    if (settingsJson === initialSettingsRef.current) return;
    const t = setTimeout(() => {
      setSavedFlash(true);
      const off = setTimeout(() => setSavedFlash(false), 1800);
      return () => clearTimeout(off);
    }, 1600);
    return () => clearTimeout(t);
  }, [settingsJson]);

  return (
    <div className="flex gap-4 lg:gap-6 w-full animate-fade-in min-w-0">
      {/* ── LEFT SIDEBAR — Apple Settings style, grouped nav ── */}
      <aside className="w-52 xl:w-60 flex-shrink-0 hidden md:block">
        <div className="sticky top-4">
          {/* Header */}
          <div className="flex items-center justify-between px-2 mb-4">
            <p className="text-[11px] font-black text-zinc-500 uppercase tracking-[0.12em]">Settings</p>
            {savedFlash && (
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
                            ? 'bg-amber-500/12 text-white font-semibold'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
                          }`}
                      >
                        {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-amber-500 rounded-r-full" aria-hidden="true" />}
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
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            {sideItems.map(item => (
              <button key={item.id} onClick={() => setSettingsTab(item.id)}
                aria-current={settingsTab === item.id ? 'page' : undefined}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 shrink-0 ${settingsTab === item.id ? 'bg-amber-600 text-white shadow-md shadow-amber-900/40' : 'text-zinc-400 hover:text-white bg-zinc-900/50 border border-white/5'}`}>
                <item.icon className="w-3.5 h-3.5" aria-hidden="true" /> {item.label}
              </button>
            ))}
          </div>
          {savedFlash && (
            <p className="text-[10px] font-black text-emerald-400 mt-2 flex items-center gap-1"><CheckCircle className="w-3 h-3" aria-hidden="true" /> Saved</p>
          )}
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
            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4">
              <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Company Logo</p>
              <div
                className="border-2 border-dashed border-white/10 rounded-xl p-5 text-center cursor-pointer hover:border-blue-500/40 hover:bg-blue-500/5 transition-all aspect-square flex items-center justify-center"
                onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-blue-500/60', 'bg-blue-500/10'); }}
                onDragLeave={e => { e.currentTarget.classList.remove('border-blue-500/60', 'bg-blue-500/10'); }}
                onDrop={e => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('border-blue-500/60', 'bg-blue-500/10');
                  const file = e.dataTransfer.files[0];
                  if (file && file.type.startsWith('image/')) {
                    const img = new window.Image();
                    img.onload = () => {
                      const canvas = document.createElement('canvas');
                      const scale = Math.min(1, 400 / img.width);
                      canvas.width = img.width * scale;
                      canvas.height = img.height * scale;
                      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
                      const updated = { ...settings, companyLogo: canvas.toDataURL('image/png', 0.9) };
                      setSettings(updated); DB.saveSettings(updated);
                      addToast('success', 'Logo saved');
                    };
                    img.src = URL.createObjectURL(file);
                  }
                }}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'image/*';
                  input.onchange = (ev: any) => {
                    const file = ev.target.files?.[0];
                    if (!file) return;
                    const img = new window.Image();
                    img.onload = () => {
                      const canvas = document.createElement('canvas');
                      const scale = Math.min(1, 400 / img.width);
                      canvas.width = img.width * scale;
                      canvas.height = img.height * scale;
                      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
                      const updated = { ...settings, companyLogo: canvas.toDataURL('image/png', 0.9) };
                      setSettings(updated); DB.saveSettings(updated);
                      addToast('success', 'Logo saved');
                    };
                    img.src = URL.createObjectURL(file);
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
                  onClick={() => { const u = { ...settings, companyLogo: '' }; setSettings(u); DB.saveSettings(u); addToast('info', 'Logo removed'); }}
                  className="w-full mt-2 text-[11px] text-zinc-500 hover:text-red-400 font-bold py-1.5 rounded hover:bg-red-500/5 transition-colors"
                >
                  Remove logo
                </button>
              )}
            </div>

            {/* Basics — name, phone, email, address */}
            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4 space-y-3">
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
          <div>
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

          <ShiftAlarmsEditor settings={settings} setSettings={setSettings} addToast={addToast} />

          {/* Lunch pause toggle — auto-pauses timers during the lunch window.
              This is separate from alarms (which just fire notifications). */}
          <div className="bg-zinc-900/50 border border-white/5 rounded-xl">
            <div className="px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white">Auto-Pause Timers at Lunch</p>
                  <p className="text-xs text-zinc-500">When on, any alarm marked "Pause Timers" will pause running work</p>
                </div>
                <input type="checkbox" checked={settings.autoLunchPauseEnabled || false} onChange={e => setSettings({ ...settings, autoLunchPauseEnabled: e.target.checked })} className="w-4 h-4 rounded bg-zinc-800 text-blue-600" />
              </div>
            </div>
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
          <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-white">Workflow Stages</h4>
                <p className="text-[10px] text-zinc-500">Define the stages a job moves through from start to finish.</p>
              </div>
              <button onClick={() => {
                const stages = [...(settings.jobStages || DEFAULT_STAGES)];
                const newId = `stage_${Date.now()}`;
                stages.splice(stages.length - 1, 0, { id: newId, label: 'New Stage', color: '#8b5cf6', order: stages.length - 1 });
                // Reorder
                stages.forEach((s, i) => s.order = i);
                setSettings({ ...settings, jobStages: stages });
              }} className="text-[10px] bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg font-bold">+ Add Stage</button>
            </div>
            {/* Stage Pipeline Preview */}
            <div className="flex items-center gap-1 bg-zinc-950 rounded-xl p-3">
              {(settings.jobStages || DEFAULT_STAGES).sort((a, b) => a.order - b.order).map((stage, i, arr) => (
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
              {(settings.jobStages || DEFAULT_STAGES).sort((a, b) => a.order - b.order).map((stage, idx) => (
                <div key={stage.id} className="bg-zinc-800/30 rounded-xl border border-white/5">
                 <div className="flex items-center gap-3 p-3">
                  <div className="w-4 h-4 rounded-full shrink-0" style={{ background: stage.color }} />
                  <input className="flex-1 bg-transparent text-white text-sm font-bold outline-none border-b border-transparent focus:border-white/20" value={stage.label} onChange={e => {
                    const stages = [...(settings.jobStages || DEFAULT_STAGES)];
                    const si = stages.findIndex(s => s.id === stage.id);
                    if (si >= 0) { stages[si] = { ...stages[si], label: e.target.value }; setSettings({ ...settings, jobStages: stages }); }
                  }} />
                  {/* Color picker */}
                  <div className="flex gap-1">
                    {['#71717a', '#3b82f6', '#f59e0b', '#8b5cf6', '#06b6d4', '#10b981', '#ef4444', '#ec4899', '#f97316'].map(c => (
                      <button key={c} onClick={() => {
                        const stages = [...(settings.jobStages || DEFAULT_STAGES)];
                        const si = stages.findIndex(s => s.id === stage.id);
                        if (si >= 0) { stages[si] = { ...stages[si], color: c }; setSettings({ ...settings, jobStages: stages }); }
                      }} className={`w-4 h-4 rounded-full transition-all ${stage.color === c ? 'ring-2 ring-white scale-125' : 'opacity-40 hover:opacity-80'}`} style={{ background: c }} />
                    ))}
                  </div>
                  {/* Move up/down */}
                  <button onClick={() => {
                    if (idx === 0) return;
                    const stages = [...(settings.jobStages || DEFAULT_STAGES)].sort((a, b) => a.order - b.order);
                    [stages[idx - 1], stages[idx]] = [stages[idx], stages[idx - 1]];
                    stages.forEach((s, i) => s.order = i);
                    setSettings({ ...settings, jobStages: stages });
                  }} aria-label="Move up" className="text-zinc-500 hover:text-white p-1 rounded hover:bg-white/5" title="Move Up"><ChevronUp className="w-3.5 h-3.5" aria-hidden="true" /></button>
                  <button onClick={() => {
                    const stages = [...(settings.jobStages || DEFAULT_STAGES)].sort((a, b) => a.order - b.order);
                    if (idx >= stages.length - 1) return;
                    [stages[idx], stages[idx + 1]] = [stages[idx + 1], stages[idx]];
                    stages.forEach((s, i) => s.order = i);
                    setSettings({ ...settings, jobStages: stages });
                  }} aria-label="Move down" className="text-zinc-500 hover:text-white p-1 rounded hover:bg-white/5" title="Move Down"><ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /></button>
                  {/* Mark as complete stage */}
                  <label className="flex items-center gap-1 text-[9px] text-zinc-500 cursor-pointer shrink-0" title="Reaching this stage completes the job">
                    <input type="checkbox" checked={stage.isComplete || false} onChange={e => {
                      const stages = [...(settings.jobStages || DEFAULT_STAGES)];
                      const si = stages.findIndex(s => s.id === stage.id);
                      if (si >= 0) { stages[si] = { ...stages[si], isComplete: e.target.checked }; setSettings({ ...settings, jobStages: stages }); }
                    }} className="w-3 h-3 rounded accent-emerald-500" />
                    Done
                  </label>
                  {/* Delete (only if not a built-in) */}
                  {!['pending', 'in-progress', 'completed'].includes(stage.id) && (
                    <button onClick={() => {
                      const stages = (settings.jobStages || DEFAULT_STAGES).filter(s => s.id !== stage.id);
                      stages.forEach((s, i) => s.order = i);
                      setSettings({ ...settings, jobStages: stages });
                    }} className="text-zinc-600 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
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
          <div>
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
          <OperationsStageMapper settings={settings} setSettings={setSettings} />

          {/* Per-Customer Pipelines ─ each company can have a unique stage sequence */}
          <CustomerPipelineAssigner settings={settings} setSettings={setSettings} />
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
            <MachineManager settings={settings} onSaveSettings={(s: SystemSettings) => setSettings(s)} />

            {/* Process Library — reusable pricing templates that pre-fill quote line items */}
            <ProcessLibraryManager settings={settings} setSettings={setSettings} />
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
            <CustomerManager addToast={addToast} settings={settings} onSaveSettings={(s: SystemSettings) => setSettings(s)} />

            {/* Vendors — reusable supplier records used by Purchase Orders */}
            <VendorsManager addToast={addToast} />
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
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${docSubTab === 'quote' ? 'bg-blue-600 text-white shadow-lg' : 'text-zinc-500 hover:text-white'}`}
              >
                <FileText className="w-3.5 h-3.5" aria-hidden="true" /> Quote / Invoice
              </button>
              <button
                type="button"
                onClick={() => setDocSubTab('traveler')}
                aria-pressed={docSubTab === 'traveler'}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${docSubTab === 'traveler' ? 'bg-blue-600 text-white shadow-lg' : 'text-zinc-500 hover:text-white'}`}
              >
                📋 Job Traveler
              </button>
            </div>

            {/* Logo — shared between both docs */}
            <details className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
              <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <span className="text-sm font-bold text-white">Logo <span className="text-[9px] text-zinc-600 ml-1 normal-case font-normal">(shared)</span></span>
                <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="px-4 pb-4">
                <div
                  className="border-2 border-dashed border-white/10 rounded-xl p-4 text-center cursor-pointer hover:border-blue-500/40 hover:bg-blue-500/5 transition-all"
                  onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-blue-500/60', 'bg-blue-500/10'); }}
                  onDragLeave={e => { e.currentTarget.classList.remove('border-blue-500/60', 'bg-blue-500/10'); }}
                  onDrop={e => {
                    e.preventDefault(); e.currentTarget.classList.remove('border-blue-500/60', 'bg-blue-500/10');
                    const file = e.dataTransfer.files[0];
                    if (file?.type.startsWith('image/')) {
                      const img = new window.Image(); img.onload = () => { const c = document.createElement('canvas'); const s = Math.min(1, 400 / img.width); c.width = img.width * s; c.height = img.height * s; c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); const u = { ...settings, companyLogo: c.toDataURL('image/png', 0.9) }; setSettings(u); DB.saveSettings(u); addToast('success', 'Logo saved'); }; img.src = URL.createObjectURL(file);
                    }
                  }}
                  onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = (ev: any) => { const f = ev.target.files?.[0]; if (f) { const img = new window.Image(); img.onload = () => { const c = document.createElement('canvas'); const s = Math.min(1, 400 / img.width); c.width = img.width * s; c.height = img.height * s; c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); const u = { ...settings, companyLogo: c.toDataURL('image/png', 0.9) }; setSettings(u); DB.saveSettings(u); addToast('success', 'Logo saved'); }; img.src = URL.createObjectURL(f); } }; i.click(); }}
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
            <details open className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
              <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <span className="text-sm font-bold text-white">Numbering</span>
                <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="px-4 pb-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-zinc-500 block mb-1">Quote Prefix</label>
                    <input className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={settings.quotePrefix || 'Q-'} onChange={e => setSettings({ ...settings, quotePrefix: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 block mb-1">Next Number</label>
                    <div className="flex gap-1">
                      <input type="number" className="flex-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={settings.quoteNextNumber || 1} onChange={e => setSettings({ ...settings, quoteNextNumber: parseInt(e.target.value) || 1 })} min={1} />
                      <button onClick={() => setSettings({ ...settings, quoteNextNumber: 1 })} className="text-[10px] text-red-400 hover:text-red-300 px-2 shrink-0">Reset</button>
                    </div>
                  </div>
                </div>
              </div>
            </details>

            {/* Header */}
            <details className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
              <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <span className="text-sm font-bold text-white">Header</span>
                <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="px-4 pb-4 space-y-3">
                {[
                  { key: 'showShippingOnDocs', label: 'Shipping Details', desc: 'Show Ship To address' },
                  { key: 'showDueDateOnDocs', label: 'Due Date', desc: 'Show due date', def: true },
                  { key: 'showTermsOnDocs', label: 'Payment Terms', desc: 'Show terms (e.g. Net 30)', def: true },
                ].map(o => (
                  <label key={o.key} className="flex items-center justify-between cursor-pointer py-1">
                    <div><p className="text-sm text-white">{o.label}</p><p className="text-[10px] text-zinc-600">{o.desc}</p></div>
                    <input type="checkbox" checked={(settings as any)[o.key] ?? o.def ?? false} onChange={e => setSettings({ ...settings, [o.key]: e.target.checked })} className="w-5 h-5 rounded accent-blue-500" />
                  </label>
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
            <details open className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
              <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <span className="text-sm font-bold text-white flex items-center gap-2">📋 Job Traveler</span>
                <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="px-4 pb-4 space-y-3">
                <p className="text-[10px] text-zinc-500 leading-relaxed">Controls the production-floor route sheet. Open any job → Print Traveler to preview.</p>

                {/* Section toggles — each maps to a show.* flag in the renderer */}
                {([
                  { key: 'showLogo', label: 'Company Logo' },
                  { key: 'showQrCode', label: 'QR Code', desc: 'Scannable job-ID square' },
                  { key: 'showPartPhoto', label: 'Part Photo', desc: 'Reference image if uploaded' },
                  { key: 'showSpecialInstructions', label: 'Special Instructions', desc: 'Orange warning block' },
                  { key: 'showNotes', label: 'Notes Block' },
                  { key: 'showOperationLog', label: 'Operation Log', desc: 'Blank rows for sign-off' },
                  { key: 'showSignOff', label: 'Sign-off Lines', desc: 'Operator + Inspector' },
                  { key: 'showDueDate', label: 'Due Date', desc: 'Prominently in red' },
                  { key: 'showPriority', label: 'Priority Badge', desc: 'URGENT / HIGH markers' },
                  { key: 'showCustomer', label: 'Customer Block' },
                ] as const).map(o => {
                  const v = settings.traveler?.[o.key as keyof NonNullable<SystemSettings['traveler']>];
                  const checked = v !== false; // default ON for all flags (opt-out model)
                  return (
                    <label key={o.key} className="flex items-center justify-between cursor-pointer py-1">
                      <div>
                        <p className="text-sm text-white">{o.label}</p>
                        {'desc' in o && o.desc && <p className="text-[10px] text-zinc-600">{o.desc}</p>}
                      </div>
                      <input
                        type="checkbox"
                        checked={checked as boolean}
                        onChange={e => setSettings({ ...settings, traveler: { ...(settings.traveler || {}), [o.key]: e.target.checked } })}
                        className="w-5 h-5 rounded accent-blue-500"
                      />
                    </label>
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
            <details className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
              <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <span className="text-sm font-bold text-white">Table</span>
                <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="px-4 pb-4 space-y-3">
                {[
                  { key: 'showUnitCol', label: 'Unit Column', desc: 'Show unit (ea, hr, ft) column', def: true },
                  { key: 'showRateCol', label: 'Rate Column', desc: 'Show unit price column', def: true },
                  { key: 'showQtyCol', label: 'Quantity Column', desc: 'Show quantity column', def: true },
                ].map(o => (
                  <label key={o.key} className="flex items-center justify-between cursor-pointer py-1">
                    <div><p className="text-sm text-white">{o.label}</p><p className="text-[10px] text-zinc-600">{o.desc}</p></div>
                    <input type="checkbox" checked={(settings as any)[o.key] ?? o.def ?? true} onChange={e => setSettings({ ...settings, [o.key]: e.target.checked })} className="w-5 h-5 rounded accent-blue-500" />
                  </label>
                ))}
              </div>
            </details>

            {/* Footer */}
            <details className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
              <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <span className="text-sm font-bold text-white">Footer</span>
                <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="px-4 pb-4 space-y-3">
                <label className="flex items-center justify-between cursor-pointer py-1">
                  <div><p className="text-sm text-white">Signature Lines</p><p className="text-[10px] text-zinc-600">Show company + client signature lines</p></div>
                  <input type="checkbox" checked={settings.showSignatureLines ?? true} onChange={e => setSettings({ ...settings, showSignatureLines: e.target.checked })} className="w-5 h-5 rounded accent-blue-500" />
                </label>
                <div>
                  <label className="text-[10px] text-zinc-500 block mb-1">Default Comment / Certificate</label>
                  <textarea className="w-full bg-zinc-950 border border-white/10 rounded-xl px-3 py-2 text-sm text-white min-h-[70px]" value={settings.defaultQuoteComment || ''} onChange={e => setSettings({ ...settings, defaultQuoteComment: e.target.value })} placeholder="CERTIFICATE OF CONFORMANCE: This is to certify that all processes conform..." />
                </div>
              </div>
            </details>

            {/* Project Details */}
            <details className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
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
                  <button onClick={() => { const inp = document.getElementById('newPF') as HTMLInputElement; if (inp?.value.trim()) { setSettings({ ...settings, customProjectFields: [...(settings.customProjectFields || ['Purchase Order', 'Part No.']), inp.value.trim()] }); inp.value = ''; } }} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg text-xs font-bold">Add</button>
                </div>
              </div>
            </details>

            {/* Defaults */}
            <details className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
              <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <span className="text-sm font-bold text-white">Defaults</span>
                <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="px-4 pb-4 space-y-3">
                <div><label className="text-[10px] text-zinc-500 block mb-1">Default Payment Terms</label><input className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={settings.defaultPaymentTerms || ''} onChange={e => setSettings({ ...settings, defaultPaymentTerms: e.target.value })} placeholder="Net 30" /></div>
                <div><label className="text-[10px] text-zinc-500 block mb-1">Default Tax Rate (%)</label><input type="number" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={settings.taxRate || ''} onChange={e => setSettings({ ...settings, taxRate: parseFloat(e.target.value) || 0 })} step="0.1" placeholder="0" /></div>
                <div><label className="text-[10px] text-zinc-500 block mb-1">Default Discount (%)</label><input type="number" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={settings.defaultDiscount || ''} onChange={e => setSettings({ ...settings, defaultDiscount: parseFloat(e.target.value) || 0 })} step="0.1" placeholder="0" /></div>
                <div><label className="text-[10px] text-zinc-500 block mb-1">Default Markup (%)</label><input type="number" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={settings.defaultMarkup || '25'} onChange={e => setSettings({ ...settings, defaultMarkup: parseFloat(e.target.value) || 0 })} step="1" placeholder="25" /></div>
                <div>
                  <label className="text-[10px] text-zinc-500 block mb-1">Min Margin Threshold (%)</label>
                  <input type="number" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" value={settings.minMarginPct ?? ''} onChange={e => setSettings({ ...settings, minMarginPct: parseFloat(e.target.value) || 0 })} step="1" placeholder="20" />
                  <p className="text-[10px] text-zinc-600 mt-1">Quotes below this % margin show a red warning in the editor.</p>
                </div>
              </div>
            </details>

            {/* Snippet Library — reusable text blocks (Round 1 #8) */}
            <SnippetLibraryManager settings={settings} setSettings={setSettings} />

            {/* Color */}
            <details className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
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
            <details className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
              <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <span className="text-sm font-bold text-white">Watermark</span>
                <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="px-4 pb-4">
                <div className="flex flex-wrap gap-2">
                  {['None', 'DRAFT', 'SAMPLE', 'CONFIDENTIAL', 'COPY', 'VOID'].map(w => (
                    <button key={w} onClick={() => setSettings({ ...settings, watermark: w === 'None' ? '' : w })} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${(settings.watermark || '') === (w === 'None' ? '' : w) ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'}`}>{w}</button>
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
            <div className="sticky top-4 bg-white text-black rounded-2xl shadow-2xl overflow-hidden" style={{ fontFamily: '-apple-system, sans-serif' }}>
            <div className="p-10" style={{ fontSize: 13 }}>
              {/* Mini Preview */}
              <div className="flex justify-between items-start mb-6 gap-4">
                <div className="min-w-0">
                  {settings.companyLogo && <img src={settings.companyLogo} className="h-12 mb-2 object-contain" alt="" />}
                  <div className="font-extrabold text-gray-900 leading-tight" style={{ fontSize: 18 }}>{settings.companyName || 'Company Name'}</div>
                  {settings.companyAddress && <div className="text-gray-500 mt-1" style={{ fontSize: 11 }}>{settings.companyAddress}</div>}
                  {settings.companyPhone && <div className="text-gray-500" style={{ fontSize: 11 }}>{settings.companyPhone}</div>}
                </div>
                <div className="text-right shrink-0">
                  <div className="font-extrabold" style={{ fontSize: 28, color: accent, letterSpacing: '0.02em' }}>QUOTE</div>
                  <div className="text-gray-500 font-medium" style={{ fontSize: 12 }}>{settings.quotePrefix || 'Q-'}001</div>
                  <div className="text-gray-400 mt-1" style={{ fontSize: 10 }}>{new Date().toLocaleDateString()}</div>
                </div>
              </div>
              {/* Watermark */}
              {settings.watermark && <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ fontSize: 48, color: 'rgba(0,0,0,0.06)', fontWeight: 900, transform: 'rotate(-30deg)' }}>{settings.watermark}</div>}
              {/* Info Block */}
              <div className="flex gap-6 mb-4 border-b border-gray-200 pb-3" style={{ fontSize: 11 }}>
                <div><span className="text-gray-400">Date:</span> <span className="text-gray-700 font-medium">{new Date().toLocaleDateString()}</span></div>
                {(settings.showTermsOnDocs ?? true) && <div><span className="text-gray-400">Terms:</span> <span className="text-gray-700 font-medium">{settings.defaultPaymentTerms || 'Net 30'}</span></div>}
                {(settings.showDueDateOnDocs ?? true) && <div><span className="text-gray-400">Due:</span> <span className="text-gray-700 font-medium">05/14/2026</span></div>}
              </div>
              <div className="bg-gray-50 rounded-lg p-4 mb-4 border border-gray-200">
                <div className="text-gray-400 uppercase font-bold tracking-wider" style={{ fontSize: 9 }}>Bill To</div>
                <div className="font-bold text-gray-800 mt-1" style={{ fontSize: 15 }}>Acme Manufacturing</div>
                <div className="text-gray-500" style={{ fontSize: 11 }}>orders@acmemfg.com</div>
                <div className="text-gray-400" style={{ fontSize: 11 }}>(555) 123-4567</div>
              </div>
              {(settings.showShippingOnDocs) && <div className="bg-gray-50 rounded-lg p-4 mb-4 border border-gray-200"><div className="text-gray-400 uppercase font-bold tracking-wider" style={{ fontSize: 9 }}>Ship To</div><div className="text-gray-500 mt-1" style={{ fontSize: 11 }}>123 Industrial Pkwy, Suite 200</div></div>}
              {/* Project Fields */}
              <div className="mb-4 space-y-1" style={{ fontSize: 11 }}>
                {(settings.customProjectFields || ['Purchase Order', 'Part No.']).map((f: string, fi: number) => (
                  <div key={f}><span className="font-bold text-gray-700">{f}:</span> <span className="text-gray-400">{fi === 0 ? 'PO-78432' : fi === 1 ? 'BRK-1200' : '—'}</span></div>
                ))}
              </div>
              {/* Items Table */}
              <table className="w-full mb-4" style={{ fontSize: 11 }}>
                <thead><tr className="border-b-2 border-gray-200 text-gray-400 uppercase" style={{ fontSize: 9 }}><th className="text-left py-2">Description</th><th className="text-right py-2">Qty</th>{settings.showUnitCol !== false && <th className="text-right py-2">Unit</th>}<th className="text-right py-2">Rate</th><th className="text-right py-2">Amount</th></tr></thead>
                <tbody>
                  <tr className="border-b border-gray-100"><td className="py-2.5 text-gray-700">Deburring — Bracket Assembly</td><td className="py-2.5 text-right text-gray-600">500</td>{settings.showUnitCol !== false && <td className="py-2.5 text-right text-gray-400">ea</td>}<td className="py-2.5 text-right text-gray-600">$2.50</td><td className="py-2.5 text-right font-bold text-gray-800">$1,250.00</td></tr>
                  <tr className="border-b border-gray-100 bg-gray-50"><td className="py-2.5 text-gray-700">Setup & Inspection</td><td className="py-2.5 text-right text-gray-600">1</td>{settings.showUnitCol !== false && <td className="py-2.5 text-right text-gray-400">lot</td>}<td className="py-2.5 text-right text-gray-600">$125.00</td><td className="py-2.5 text-right font-bold text-gray-800">$125.00</td></tr>
                </tbody>
              </table>
              {/* Totals */}
              <div className="flex justify-end" style={{ fontSize: 12 }}>
                <div className="w-52 space-y-1.5">
                  <div className="flex justify-between"><span className="text-gray-400">Subtotal</span><span className="text-gray-700">$1,375.00</span></div>
                  {settings.defaultMarkup > 0 && <div className="flex justify-between"><span className="text-gray-400">Markup {settings.defaultMarkup}%</span><span className="text-gray-700">+${(settings.defaultMarkup / 100 * 1375).toFixed(2)}</span></div>}
                  {settings.defaultDiscount > 0 && <div className="flex justify-between"><span className="text-gray-400">Discount</span><span className="text-red-500">-${(settings.defaultDiscount / 100 * 1375).toFixed(2)}</span></div>}
                  {(settings.taxRate || 0) > 0 && <div className="flex justify-between"><span className="text-gray-400">Tax {settings.taxRate}%</span><span className="text-gray-700">+${(settings.taxRate! / 100 * 1375).toFixed(2)}</span></div>}
                  {(() => { const sub = 1375; const m = (settings.defaultMarkup || 0) / 100; const d = (settings.defaultDiscount || 0) / 100; const t = (settings.taxRate || 0) / 100; const total = (sub * (1 + m) * (1 - d)) * (1 + t); return (
                  <div className="flex justify-between font-extrabold border-t-2 border-gray-800 pt-2 mt-1" style={{ fontSize: 16, color: accent }}>
                    <span>Total</span><span>${total.toFixed(2)}</span>
                  </div>
                  ); })()}
                </div>
              </div>
              {/* Footer */}
              {settings.defaultQuoteComment && <div className="mt-4 pt-3 border-t border-gray-200"><div className="text-gray-400 uppercase font-bold tracking-wider" style={{ fontSize: 9 }}>Comments</div><div className="text-gray-500 mt-1" style={{ fontSize: 10 }}>{settings.defaultQuoteComment.substring(0, 150)}{settings.defaultQuoteComment.length > 150 ? '...' : ''}</div></div>}
              {settings.showSignatureLines !== false && (
                <div className="flex gap-8 mt-8"><div className="flex-1 pt-2 border-t border-gray-300 text-gray-400" style={{ fontSize: 10 }}>{settings.companyName || 'Company'}</div><div className="flex-1 pt-2 border-t border-gray-300 text-gray-400" style={{ fontSize: 10 }}>Client's signature</div></div>
              )}
            </div>
            </div>
            )}
          </div>
          </div>
        </div>
        );
      })()}

      {/* ── TV DISPLAY — Split-pane with live preview ── */}
      {settingsTab === 'tv' && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-bold text-white mb-1">TV Display</h3>
            <p className="text-sm text-zinc-500">Shop-floor TV mode — slides, weather, and the shareable stream link. Changes preview live on the right.</p>
          </div>
          <div className="flex gap-4 flex-col lg:flex-row">
          {/* LEFT: TV Controls — scrollable inside its own column on desktop, free-flow on mobile */}
          <div className="w-full lg:w-[320px] xl:w-[340px] shrink-0 space-y-3 lg:overflow-y-auto lg:max-h-[calc(100vh-120px)]">

            {/* Weather Location */}
            <WeatherLocationCard addToast={addToast} settings={settings} setSettings={setSettings} />

            {/* TV Stream Link */}
            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-red-500" />
                <span className="text-sm font-bold text-white">TV Stream Link</span>
              </div>
              <p className="text-[10px] text-zinc-500">Open this URL on any TV or browser — no login needed. Each account gets their own private link.</p>
              {(() => {
                const token = settings.tvToken || '';
                const tvUrl = token ? `${window.location.origin}?tv=${token}` : '';
                return (
                  <>
                    {token ? (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <input readOnly value={tvUrl} className="flex-1 bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono truncate" />
                          <button onClick={() => { navigator.clipboard.writeText(tvUrl); addToast('success', 'TV link copied!'); }} className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-colors shrink-0">Copy</button>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => window.open(tvUrl, '_blank')} className="flex-1 px-3 py-2 bg-white/5 hover:bg-white/10 text-white text-xs font-bold rounded-lg transition-colors">Open in New Tab</button>
                          <button onClick={async () => {
                            const ok = await askConfirm({
                              title: 'Generate a new TV link?',
                              message: 'The current link will stop working. Anyone using it on a TV will need the new URL.',
                              tone: 'warning',
                              confirmLabel: 'Reset link',
                            });
                            if (ok) setSettings({ ...settings, tvToken: crypto.randomUUID().replace(/-/g, '').slice(0, 16) });
                          }} className="px-3 py-2 bg-white/5 hover:bg-red-500/20 text-zinc-400 hover:text-red-400 text-xs font-bold rounded-lg transition-colors">Reset</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setSettings({ ...settings, tvToken: crypto.randomUUID().replace(/-/g, '').slice(0, 16) })} className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-xl transition-colors">Generate TV Link</button>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Privacy — sensitive data toggles */}
            <details open className="bg-red-500/5 border border-red-500/20 rounded-2xl overflow-hidden group">
              <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-red-500/10">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white flex items-center gap-1.5">🔒 Privacy</span>
                  <span className="text-[9px] font-black text-red-400 bg-red-500/10 border border-red-500/25 px-1.5 py-0.5 rounded uppercase tracking-widest">Sensitive</span>
                </div>
                <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="px-4 pb-4 space-y-2">
                <p className="text-[10px] text-zinc-500 leading-snug italic">TVs are often visible to customers, visitors, and workers — hide sensitive data by default.</p>
                {[
                  { key: 'tvShowRevenue', label: 'Show $ / Revenue', desc: '💰 Dollar amounts on stats + goal slides (off by default)', def: false },
                  { key: 'tvShowCustomerNames', label: 'Show Customer Names', desc: '🏢 Customer names on job cards + Top Customer', def: true },
                ].map(o => (
                  <label key={o.key} className="flex items-center justify-between cursor-pointer py-1">
                    <div className="flex-1 min-w-0 pr-3"><p className="text-xs font-bold text-white">{o.label}</p><p className="text-[10px] text-zinc-500 mt-0.5 leading-snug">{o.desc}</p></div>
                    <input type="checkbox" checked={(settings as any)[o.key] ?? o.def} onChange={e => setSettings({ ...settings, [o.key]: e.target.checked })} className="w-4 h-4 rounded accent-blue-500 shrink-0" />
                  </label>
                ))}
              </div>
            </details>

            {/* Display Options */}
            <details open className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
              <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-white/[0.02]"><span className="text-sm font-bold text-white">Display</span><ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" /></summary>
              <div className="px-4 pb-4 space-y-2">
                {[
                  { key: 'tvCompanyHeader', label: 'Company Header', desc: 'Show name + logo at top', def: true },
                  { key: 'tvShowClock', label: 'Live Clock', desc: 'Current time in header', def: true },
                  { key: 'tvShowWeather', label: 'Outside Temperature', desc: 'Weather widget (needs location)', def: true },
                  { key: 'tvShowStats', label: 'Stats Bar', desc: 'Workers, running, paused counts', def: true },
                  { key: 'tvShowJobsBelt', label: 'Jobs Belt', desc: 'Auto-scrolling list of open jobs', def: true },
                  { key: 'tvShowCustomer', label: 'Customer on Worker Cards', desc: 'Legacy — use Privacy toggle instead', def: true },
                  { key: 'tvShowJobId', label: 'Job ID', desc: 'Show job ID on cards', def: true },
                  { key: 'tvShowElapsedBar', label: 'Progress Bar', desc: 'Time elapsed bar', def: true },
                  { key: 'tvAutoScroll', label: 'Auto-Scroll', desc: 'Scroll when many workers', def: false },
                ].map(o => (
                  <label key={o.key} className="flex items-center justify-between cursor-pointer py-1">
                    <div><p className="text-xs text-white">{o.label}</p><p className="text-[9px] text-zinc-600">{o.desc}</p></div>
                    <input type="checkbox" checked={(settings as any)[o.key] ?? o.def} onChange={e => setSettings({ ...settings, [o.key]: e.target.checked })} className="w-4 h-4 rounded accent-blue-500" />
                  </label>
                ))}
                <div className="flex items-center justify-between py-1">
                  <p className="text-xs text-white">Card Size</p>
                  <select aria-label="TV card size" className="bg-zinc-950 border border-white/10 rounded px-2 py-1 text-white text-xs" value={settings.tvCardSize || 'normal'} onChange={e => setSettings({ ...settings, tvCardSize: e.target.value as any })}>
                    <option value="compact">Compact</option><option value="normal">Normal</option><option value="large">Large</option>
                  </select>
                </div>
                <div className="flex items-center justify-between py-1">
                  <p className="text-xs text-white">Jobs Belt Scroll Speed</p>
                  <div role="group" aria-label="Jobs belt scroll speed" className="inline-flex gap-1 p-1 bg-zinc-950 border border-white/10 rounded-lg">
                    {(['off', 'slow', 'normal', 'fast'] as const).map(s => (
                      <button key={s} type="button" onClick={() => setSettings({ ...settings, tvScrollSpeed: s })} aria-pressed={(settings.tvScrollSpeed || 'normal') === s} className={`px-2.5 py-1 text-[11px] font-bold rounded capitalize min-h-[28px] ${(settings.tvScrollSpeed || 'normal') === s ? 'bg-blue-600 text-white' : 'text-zinc-500 hover:text-white'}`}>{s}</button>
                    ))}
                  </div>
                </div>
              </div>
            </details>

            {/* Slideshow */}
            <details className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden group">
              <summary className="p-4 cursor-pointer flex items-center justify-between hover:bg-white/[0.02]"><span className="text-sm font-bold text-white">Slideshow</span><ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform" /></summary>
              <div className="px-4 pb-4 space-y-3">
                <label className="flex items-center justify-between cursor-pointer py-1">
                  <div><p className="text-xs text-white">Enable Slideshow</p><p className="text-[9px] text-zinc-600">Rotate between views</p></div>
                  <input type="checkbox" checked={settings.tvSlideshowEnabled || false} onChange={e => setSettings({ ...settings, tvSlideshowEnabled: e.target.checked })} className="w-4 h-4 rounded accent-blue-500" />
                </label>
                <div className="flex items-center justify-between py-1">
                  <p className="text-xs text-white">Duration</p>
                  <select className="bg-zinc-950 border border-white/10 rounded px-2 py-1 text-white text-xs" value={settings.tvSlideDuration || 15} onChange={e => setSettings({ ...settings, tvSlideDuration: Number(e.target.value) })}>
                    {[5,10,15,20,30,45,60].map(s => <option key={s} value={s}>{s}s</option>)}
                  </select>
                </div>
              </div>
            </details>

            {/* Slides — rich editor with all slide types */}
            <TvSlidesEditor settings={settings} setSettings={setSettings} />
          </div>

          {/* RIGHT: True TV-mode Mirror Preview */}
          <div className="flex-1 min-w-0">
            <TvMirrorPreview settings={settings} activeLogs={tvActiveLogs} jobs={tvJobs} allLogs={tvAllLogs} />
          </div>
          </div>
        </div>
      )}

      {/* ── SYSTEM ── */}
      {settingsTab === 'system' && (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-black text-white mb-1">Defaults</h3>
            <p className="text-sm text-zinc-500">Job and worker defaults applied across the system.</p>
          </div>

          {/* Job Defaults */}
          <div>
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.12em] mb-2">Job Defaults</p>
            <div className="bg-zinc-900/60 border border-white/[0.06] rounded-2xl overflow-hidden">
              <div className="px-4 py-3.5 flex items-center justify-between border-b border-white/[0.04]">
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
              <div className="px-4 py-3.5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">Default Payment Terms</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Pre-filled on new quotes and POs</p>
                </div>
                <select className="bg-zinc-950 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-amber-500/40" value={settings.defaultPaymentTerms || 'Net 30'} onChange={e => setSettings({ ...settings, defaultPaymentTerms: e.target.value })}>
                  <option>Due on Receipt</option>
                  <option>Net 15</option>
                  <option>Net 30</option>
                  <option>Net 45</option>
                  <option>Net 60</option>
                </select>
              </div>
            </div>
          </div>

          {/* Worker Defaults */}
          <div>
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
                    value={settings.weeklyGoalHours || 40}
                    onChange={e => setSettings({ ...settings, weeklyGoalHours: Number(e.target.value) || 40 })}
                  />
                  <span className="text-xs text-zinc-500">hrs</span>
                </div>
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
    entry.mins += l.durationMinutes || 0;
  });
  const weekJobs = Array.from(weekJobMap.values());

  // Today's minutes
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayMins = recentLogs
    .filter(l => l.endTime && new Date(l.startTime) >= todayStart)
    .reduce((a, l) => a + (l.durationMinutes || 0), 0);

  const weekHours = progress?.weekHours || 0;
  const weekOps = progress?.weekOpCount || 0;

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-zinc-500">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm">Loading stats...</p>
      </div>
    </div>
  );

  // Streak calc
  const WEEKLY_GOAL_HRS = 54;
  const streakCheck = new Date(todayStart);
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const dow = streakCheck.getDay();
    if (dow === 0 || dow === 6) { streakCheck.setDate(streakCheck.getDate() - 1); continue; }
    const dayEnd = new Date(streakCheck); dayEnd.setHours(23,59,59,999);
    if (recentLogs.some(l => l.startTime >= streakCheck.getTime() && l.startTime <= dayEnd.getTime())) {
      streak++; streakCheck.setDate(streakCheck.getDate() - 1);
    } else break;
  }

  // Weekly goal
  const weekMins = recentLogs.filter(l => l.endTime && new Date(l.startTime) >= weekStart).reduce((a, l) => a + (l.durationMinutes || 0), 0);
  const weekHrsCalc = weekMins / 60;
  const goalPct = Math.min(100, (weekHrsCalc / WEEKLY_GOAL_HRS) * 100);

  // Daily breakdown (last 7 days)
  const dailyData: { label: string; mins: number; ops: number }[] = [];
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayStart); d.setDate(d.getDate() - i);
    const dEnd = new Date(d); dEnd.setHours(23,59,59,999);
    const dayLogs = recentLogs.filter(l => l.endTime && l.startTime >= d.getTime() && l.startTime <= dEnd.getTime());
    const mins = dayLogs.reduce((a, l) => a + (l.durationMinutes || 0), 0);
    dailyData.push({ label: i === 0 ? 'Today' : i === 1 ? 'Yest' : dayNames[d.getDay()], mins, ops: dayLogs.length });
  }
  const maxDayMins = Math.max(...dailyData.map(d => d.mins), 60);

  // Operation breakdown
  const opMap = new Map<string, number>();
  recentLogs.filter(l => l.endTime && new Date(l.startTime) >= weekStart).forEach(l => {
    opMap.set(l.operation, (opMap.get(l.operation) || 0) + (l.durationMinutes || 0));
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
    monthMinsByUser.set(l.userId, (monthMinsByUser.get(l.userId) || 0) + (l.durationMinutes || 0));
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
            {todayMins >= 60 ? `${Math.floor(todayMins/60)}h ${todayMins%60}m` : `${todayMins}m`}
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
                  <span className="text-[10px] font-mono text-zinc-500">{d.mins >= 60 ? `${Math.floor(d.mins/60)}h` : d.mins > 0 ? `${d.mins}m` : ''}</span>
                  <div className="w-full flex items-end" style={{ height: 80 }}>
                    <div
                      className={`w-full rounded-t-md transition-all duration-700 ${isToday ? 'bg-gradient-to-t from-blue-600 to-blue-400' : d.mins > 0 ? 'bg-gradient-to-t from-zinc-700 to-zinc-500' : 'bg-zinc-800'}`}
                      style={{ height: `${h}%` }}
                    />
                  </div>
                  <span className={`text-[10px] font-bold ${isToday ? 'text-blue-400' : 'text-zinc-500'}`}>{d.label}</span>
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
                <div key={op} className={`h-full ${opColors[i % opColors.length]}`} style={{ width: `${(mins / totalOpMins) * 100}%` }} title={`${op}: ${mins >= 60 ? `${Math.floor(mins/60)}h ${mins%60}m` : `${mins}m`}`} />
              ))}
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {opBreakdown.map(([op, mins], i) => (
                <div key={op} className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${opColors[i % opColors.length]}`} />
                  <span className="text-xs text-zinc-300 font-medium">{op}</span>
                  <span className="text-xs text-zinc-500 font-mono">{mins >= 60 ? `${Math.floor(mins/60)}h ${mins%60}m` : `${mins}m`}</span>
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
                  {j.mins >= 60 ? `${Math.floor(j.mins/60)}h ${j.mins%60}m` : `${j.mins}m`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
