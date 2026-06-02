import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend, Sector
} from 'recharts';

import {
  LayoutDashboard, Briefcase, Users, Settings, LogOut, Menu,
  Sparkles, Zap, Clock, CheckCircle, StopCircle,
  Search, Plus, User as UserIcon, Calendar, Edit2, Save, X,
  ArrowRight, Box, History, AlertCircle, ChevronDown, ChevronRight, Filter, Info,
  Printer, ScanLine, QrCode, Power, AlertTriangle, Trash2, Wifi, WifiOff,
  RotateCcw, ChevronUp, Database, ExternalLink, RefreshCw, Calculator, Activity,
  Play, Bell, BellOff, BellRing, Pause, Camera, Image, ChevronLeft, Download, FileText,
  Share2, Link, Copy, Radio, Columns3, GripVertical, MessageSquare,
  PanelLeftClose, PanelLeftOpen, Cloud, Truck, Package, Scan, DollarSign, TrendingUp, TrendingDown, Award
} from 'lucide-react';
import { Toast } from './components/Toast';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { OnboardingWizard } from './components/OnboardingWizard';
import { Job, User, UserRole, TimeLog, ToastMessage, AppView, SystemSettings, TvSlide, Quote, JobStage, ReworkEntry, PurchaseOrder } from './types';
import { JobProfitCard } from './components/JobProfitCard';
import { calcJobProfit, buildProfitSnapshot } from './utils/jobProfit';
import * as DB from './services/mockDb';
import { LiveFloorMonitor, useAutoLunch } from './LiveFloorMonitor';
import { SamplesView } from './SamplesView';
// AI scanning (parseJobDetails / POScanner) removed from production —
// see Jobs view comment. Gemini service file stays for future re-enable.
import { QuotesView } from './QuotesView';
import { CustomerPortal } from './CustomerPortal';
import { ReportsView } from './views/ReportsView';
import { JobBoardView } from './views/JobBoardView';
import { DeliveriesView } from './views/DeliveriesView';
import { PurchaseOrdersView } from './views/PurchaseOrdersView';
import { SettingsView, ProgressView } from './views/SettingsView';
import { VendorsManager } from './components/VendorsManager';
import { QualityView, ReworkModal } from './views/QualityView';
import { LogsView } from './views/LogsView';
import { POScanner } from './components/POScanner';
import { printPackingSlipPDF, printJobTravelerPDF } from './services/pdfService';
import { printTraveler } from './services/travelerPrint';
import { businessDaysUntilSync, isHolidaySync, getHolidays } from './services/holidays';
// ── Tier-gated feature wrapper ──
// Wraps locked views with upgrade nudges based on the active tenant's plan.
// SC Deburring (legacy tenant) bypasses all gates; new tenants on Pro trial
// see everything for 14 days; post-trial Starter sees nudges instead of UIs.
import { FeatureGate } from './backend/FeatureGate';
// ── Trial countdown banner ──
// Shows X days left when on a trialing subscription. Hidden for SC Deburring.
import { TrialBanner } from './components/TrialBanner';
// Pure helpers — extracted to utils/ so each file has a single responsibility
import { fmt, todayFmt, normDate, dateNum, toDateTimeLocal, formatDuration, getLogDurationMins, parseDueDate } from './utils/date';
import { makeClientSlug, buildPortalUrl } from './utils/url';
import { getPartHistory, suggestExpectedHours } from './utils/partHistory';
import { enrichJobForPrint, getRateBreakdownForJob } from './utils/jobMemory';
import { findOverBudgetJobs, getAlertedJobIds, markJobAlerted } from './utils/overBudget';
import { sendOverBudgetEmail } from './services/emailNotify';
import { computeJobETA, computeCapacityForecast, RISK_COLORS } from './utils/jobETA';
import { fmtK, fmtMoneyK, fmtMoneySigned, shortName as fmtShortName } from './utils/format';
import { findStageForOperation, shouldAutoRoute, resolveJobStage } from './utils/stageRouting';
import { computeStageMetrics, FLOW_CONSTANTS } from './utils/flowMetrics';
import { computeInsights } from './utils/shopIntelligence';
import type { ShopInsight } from './utils/shopIntelligence';
import { ShopFlowMap } from './components/ShopFlowMap';
import { RecentStageMoves } from './components/RecentStageMoves';
import { usePrompt } from './components/usePrompt';
import { OperationsStageMapper } from './components/OperationsStageMapper';
import { ClientUpdateGenerator } from './components/ClientUpdateGenerator';
import { CommandPalette, useCommandPalette } from './components/CommandPalette';
import { isDeveloper } from './utils/devMode';
import { watchLongRunningTimers, watchClockInReminder, watchEndOfShiftReminder, showTimerStarted, cancelTimerNotification, watchLiveTimerBadge } from './services/reminders';
// mediaSession intentionally removed — hijacks music player controls in shop environments
import { watchShiftAlarms, playAlarmSound, preloadAlarmSounds, scheduleUpcomingAlarms } from './services/shiftAlarms';
import { VAPID_KEY, vapidKeyToUint8 } from './utils/vapid';

/** iOS-style toggle switch — shared across App.tsx components. */
const Toggle = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex w-10 h-6 rounded-full transition-colors duration-200 shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500 ${
      checked ? 'bg-amber-500' : 'bg-zinc-700 hover:bg-zinc-600'
    }`}
  >
    <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ${checked ? 'translate-x-5' : 'translate-x-1'}`} />
  </button>
);

/** Hook: track viewport width for responsive chart sizing */
export const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 640 : false);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return isMobile;
};

const getDates = () => {
  const now = new Date();
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).getTime();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();
  return { startOfWeek, startOfMonth, startOfYear };
};


//  NOTIFICATION SERVICE
// Handles PWA permission, browser notifications, and in-app alert feed.
// VAPID_KEY + vapidKeyToUint8 moved to utils/vapid.ts so SettingsView can use them too.

const NOTIFIED_KEY = 'sc-notified-tags';
const loadNotifiedTags = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '[]')); } catch { return new Set(); }
};
const saveNotifiedTags = (set: Set<string>) => {
  try {
    // Keep only today's tags to prevent unbounded growth
    const today = new Date().toISOString().split('T')[0];
    const filtered = [...set].filter(t => t.includes(today));
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(filtered));
  } catch {}
};

const useNotifications = (jobs: Job[], activeLogs: TimeLog[], user: any) => {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [alerts, setAlerts] = useState<Array<{id:string; type:'overdue'|'due-soon'|'urgent'|'long-timer'|'new-urgent'|'clock-in'|'clock-out'; title:string; body:string; time:number; read:boolean}>>([]);
  // Persist notified tags across page refreshes so we don't re-fire on reload
  const notifiedRef = useRef<Set<string>>(loadNotifiedTags());
  // Track previous active logs to diff clock-in / clock-out events
  const prevActiveLogsRef   = useRef<Map<string, TimeLog>>(new Map());
  const clockWatchMountedRef = useRef(false);
  // After mount we give Firebase 5 s to deliver the current snapshot before
  // we start diffing — prevents a flood of "clocked in" toasts for workers
  // who were already on the clock when the admin opened the app.
  const clockWatchReadyRef  = useRef(false);

  // Re-check permission if user changes it in browser settings
  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    const interval = setInterval(() => {
      if (Notification.permission !== permission) setPermission(Notification.permission);
    }, 3000);
    return () => clearInterval(interval);
  }, [permission]);

  // Subscribe this device to Web Push and save to Firestore so the server can reach it
  const subscribePush = useCallback(async (userId: string) => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKeyToUint8(VAPID_KEY),
      });
      // Store role + name so the server can filter admin-only subscriptions
      await DB.savePushSubscription(userId, sub.toJSON(), user?.role, user?.name);
      console.log('[Push] ✅ Device registered for background notifications');
    } catch (e) {
      console.warn('[Push] ❌ Subscribe failed:', e);
    }
  }, [user?.role, user?.name]);

  // Request permission
  const requestPermission = useCallback(async (userId?: string) => {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted' && userId) await subscribePush(userId);
    return result;
  }, [subscribePush]);

  // Auto-subscribe on load if permission already granted (catches returning users)
  useEffect(() => {
    if (permission === 'granted' && user?.id) {
      subscribePush(user.id);
    }
  }, [permission, user?.id, subscribePush]);

  // Fire a browser notification AND add to in-app feed
  const fire = useCallback((type: string, title: string, body: string, tag: string) => {
    const id = tag + '-' + Date.now();
    setAlerts(prev => [{ id, type: type as any, title, body, time: Date.now(), read: false }, ...prev].slice(0, 50));
    if (permission !== 'granted') return;

    // Always use service worker — works even when app is backgrounded/screen locked.
    // Direct new Notification() only fires when the tab is in the foreground.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg) {
          reg.showNotification(title, {
            body, tag, icon: '/icon-192.png', badge: '/icon-72.png',
            vibrate: [200, 100, 200], silent: false,
          } as any).catch(() => {
            try { new Notification(title, { body, tag, icon: '/icon-192.png' }); } catch {}
          });
        } else {
          try { new Notification(title, { body, tag, icon: '/icon-192.png' }); } catch {}
        }
      }).catch(() => {
        try { new Notification(title, { body, tag, icon: '/icon-192.png' }); } catch {}
      });
    } else {
      try { new Notification(title, { body, tag, icon: '/icon-192.png' }); } catch {}
    }
  }, [permission]);

  const markRead = useCallback((id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, read: true } : a));
  }, []);

  const markAllRead = useCallback(() => {
    setAlerts(prev => prev.map(a => ({ ...a, read: true })));
  }, []);

  const clearAll = useCallback(() => setAlerts([]), []);

  // Check jobs every minute
  useEffect(() => {
    const check = () => {
      const today = todayFmt();
      const todayN = dateNum(today);
      const in2DaysN = dateNum(new Date(Date.now() + 2 * 86400000).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }));
      const activeJobs = jobs.filter(j => j.status !== 'completed');

      let changed = false;
      const addTag = (tag: string) => { notifiedRef.current.add(tag); changed = true; };

      // Overdue jobs
      activeJobs.filter(j => j.dueDate && dateNum(j.dueDate) < todayN).forEach(j => {
        const tag = `overdue-${j.id}-${today}`;
        if (!notifiedRef.current.has(tag)) {
          addTag(tag);
          fire('overdue', '🚨 Overdue Job', `PO ${j.poNumber} was due ${fmt(j.dueDate)}`, tag);
        }
      });

      // Due within 2 days
      activeJobs.filter(j => j.dueDate && dateNum(j.dueDate) >= todayN && dateNum(j.dueDate) <= in2DaysN).forEach(j => {
        const tag = `due-soon-${j.id}-${today}`;
        if (!notifiedRef.current.has(tag)) {
          addTag(tag);
          fire('due-soon', '⏰ Due Soon', `PO ${j.poNumber} is due ${fmt(j.dueDate)}`, tag);
        }
      });

      // Urgent jobs added recently (within last hour)
      activeJobs.filter(j => j.priority === 'urgent' && j.createdAt > Date.now() - 3600000).forEach(j => {
        const tag = `urgent-${j.id}`;
        if (!notifiedRef.current.has(tag)) {
          addTag(tag);
          fire('urgent', '🔴 Urgent Job Added', `PO ${j.poNumber} — ${j.partNumber} marked URGENT`, tag);
        }
      });

      // Timers running > 4 hours (admin alert)
      if (user?.role === 'admin') {
        activeLogs.filter(l => l.startTime < Date.now() - 4 * 3600000).forEach(l => {
          const tag = `long-timer-${l.id}`;
          if (!notifiedRef.current.has(tag)) {
            addTag(tag);
            const hrs = ((Date.now() - l.startTime) / 3600000).toFixed(1);
            fire('long-timer', '⏱️ Long Running Timer', `${l.userName} has been on ${l.operation} for ${hrs}h`, tag);
          }
        });
      }

      // Persist to localStorage so page refreshes don't re-fire
      if (changed) saveNotifiedTags(notifiedRef.current);
    };

    check(); // run immediately
    const interval = setInterval(check, 60000);
    return () => clearInterval(interval);
  }, [jobs, activeLogs, fire, user?.role]);

  // ── Clock-in / Clock-out — diff activeLogs on every change (admin only) ──
  //
  // Grace-period design:
  //   • On first mount we don't know whether Firebase has delivered its
  //     initial snapshot yet.  If we diff immediately against an empty prev,
  //     every currently-running worker looks like a NEW clock-in → Chrome
  //     asks to block notifications and the admin taps "Block" by accident.
  //   • Fix: keep updating prevActiveLogsRef silently for the first 5 s after
  //     mount.  After that, clockWatchReadyRef flips true and any NEW diff
  //     genuinely means a worker just started/stopped.
  useEffect(() => {
    if (user?.role !== 'admin') return;

    if (!clockWatchMountedRef.current) {
      // First call — start the 5-second grace timer.
      clockWatchMountedRef.current = true;
      prevActiveLogsRef.current = new Map(activeLogs.map(l => [l.id, l]));
      const t = setTimeout(() => { clockWatchReadyRef.current = true; }, 5000);
      return () => clearTimeout(t);
    }

    // Still in grace window — keep snapshot fresh, no firing.
    if (!clockWatchReadyRef.current) {
      prevActiveLogsRef.current = new Map(activeLogs.map(l => [l.id, l]));
      return;
    }

    const prev = prevActiveLogsRef.current;
    const curr = new Map(activeLogs.map(l => [l.id, l]));

    // New entries = someone just clocked in
    curr.forEach((log, id) => {
      if (prev.has(id)) return;
      const tag = `clockin-${id}`;
      if (notifiedRef.current.has(tag)) return;
      notifiedRef.current.add(tag);
      const job = jobs.find(j => j.id === log.jobId);
      const jobLabel = job
        ? [job.partNumber || job.jobIdsDisplay, job.customer].filter(Boolean).join(' · ')
        : log.partNumber || 'job';
      fire('clock-in', `🟢 ${log.userName} clocked in`, `${log.operation}  ·  ${jobLabel}`, tag);
    });

    // Missing entries = someone just clocked out
    prev.forEach((log, id) => {
      if (curr.has(id)) return;
      const tag = `clockout-${id}`;
      if (notifiedRef.current.has(tag)) return;
      notifiedRef.current.add(tag);
      const job = jobs.find(j => j.id === log.jobId);
      const jobLabel = job
        ? [job.partNumber || job.jobIdsDisplay, job.customer].filter(Boolean).join(' · ')
        : log.partNumber || 'job';
      fire('clock-out', `🔴 ${log.userName} clocked out`, `${log.operation}  ·  ${jobLabel}`, tag);
    });

    prevActiveLogsRef.current = curr;
  }, [activeLogs, jobs, fire, user?.role]);

  return { permission, requestPermission, alerts, markRead, markAllRead, clearAll };
};

//  NOTIFICATION BELL COMPONENT
const NotificationBell = ({ permission, requestPermission, userId, alerts, markRead, markAllRead, clearAll, align }: any) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; right: number } | null>(null);
  const unread = alerts.filter((a: any) => !a.read).length;
  const ref = useRef<HTMLButtonElement>(null);
  const isMobile = useIsMobile();

  // Position the panel relative to the bell button (anchored, not fixed to corner)
  useEffect(() => {
    if (!open || !ref.current) return;
    const update = () => {
      const rect = ref.current!.getBoundingClientRect();
      setPos({ top: rect.bottom + 8, left: rect.left, right: window.innerWidth - rect.right });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open]);

  const iconFor = (type: string) => {
    if (type === 'overdue' || type === 'urgent' || type === 'new-urgent') return { Icon: AlertTriangle, color: '#f87171', tint: 'bg-red-500/10' };
    if (type === 'due-soon') return { Icon: Clock, color: '#fb923c', tint: 'bg-orange-500/10' };
    if (type === 'long-timer') return { Icon: Activity, color: '#facc15', tint: 'bg-yellow-500/10' };
    if (type === 'clock-in')  return { Icon: Play,          color: '#34d399', tint: 'bg-emerald-500/10' };
    if (type === 'clock-out') return { Icon: StopCircle,    color: '#f87171', tint: 'bg-red-500/10'     };
    return { Icon: Bell, color: '#60a5fa', tint: 'bg-blue-500/10' };
  };

  const timeAgo = (ts: number) => {
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  // Panel positioning:
  // - Mobile: bottom sheet style (full width, anchored to bottom)
  // - Desktop: attached to bell. If bell is on left side (sidebar), open to the right of it
  //   If bell is on right side (mobile top bar), open below-right
  const openOnRight = align === 'left' || (pos && pos.left < 200); // bell is on left → panel opens rightward
  const panelStyle: React.CSSProperties = isMobile
    ? { left: 8, right: 8, top: 'auto', bottom: 8, maxHeight: 'calc(100vh - 80px)' }
    : pos
      ? openOnRight
        ? { top: pos.top, left: Math.min(pos.left, window.innerWidth - 392), width: 384, maxHeight: 'calc(100vh - 120px)' }
        : { top: pos.top, right: Math.max(pos.right, 12), width: 384, maxHeight: 'calc(100vh - 120px)' }
      : { top: 64, right: 12, width: 384, maxHeight: 'calc(100vh - 120px)' };

  return (
    <>
      {/* Bell button */}
      <button
        ref={ref as any}
        aria-label={unread > 0 ? `Notifications — ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => { setOpen(!open); if (!open && unread > 0) markAllRead(); }}
        className={`relative p-2 rounded-xl transition-all min-h-[40px] min-w-[40px] ${
          unread > 0
            ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
            : 'bg-zinc-800 border border-white/5 text-zinc-400 hover:text-white'
        }`}
        title="Notifications"
      >
        {unread > 0 ? <BellRing className="w-5 h-5 animate-pulse" aria-hidden="true" /> : <Bell className="w-5 h-5" aria-hidden="true" />}
        {unread > 0 && (
          <span aria-hidden="true" className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center shadow-lg ring-2 ring-zinc-950">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && createPortal(
        <>
          {/* Click-catcher backdrop — transparent on desktop, dim on mobile */}
          <div
            className={`fixed inset-0 z-[99998] ${isMobile ? 'bg-black/60 backdrop-blur-sm' : ''}`}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          {/* Panel */}
          <div
            role="dialog"
            aria-label="Notifications"
            className={`fixed bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl z-[99999] overflow-hidden flex flex-col ${isMobile ? 'animate-slide-up' : 'animate-fade-in'}`}
            style={{ ...panelStyle, boxShadow: '0 24px 60px -12px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-b from-zinc-800/60 to-transparent shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
                  <Bell className="w-4 h-4 text-amber-400" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white leading-none">Notifications</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">{unread > 0 ? `${unread} unread · ${alerts.length} total` : alerts.length === 0 ? 'All caught up' : `${alerts.length} total`}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {alerts.length > 0 && (
                  <button onClick={clearAll} aria-label="Clear all notifications" className="text-[11px] text-zinc-400 hover:text-red-400 transition-colors font-semibold px-2 py-1 rounded hover:bg-white/5">
                    Clear all
                  </button>
                )}
                <button onClick={() => setOpen(false)} aria-label="Close notifications" className="text-zinc-400 hover:text-white transition-colors w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10">
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Permission banner */}
            {permission !== 'granted' ? (
              <div className="mx-3 mt-3 rounded-xl bg-gradient-to-br from-amber-500/10 to-orange-500/5 border border-amber-500/20 p-3 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
                    <BellRing className="w-4 h-4 text-amber-400" aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-amber-200 leading-tight">Enable notifications on THIS device</p>
                    <p className="text-[10px] text-amber-300/60 mt-0.5 leading-snug">Clock-ins, overdue jobs &amp; long timers — works on phone too.</p>
                  </div>
                  <button
                    onClick={() => requestPermission(userId)}
                    aria-label="Enable notifications"
                    className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg shrink-0 transition-all shadow-lg shadow-amber-900/30"
                  >
                    Enable
                  </button>
                </div>
                <p className="text-[10px] text-amber-300/40 mt-2 leading-snug">📱 To get alerts on your phone: open the app on your phone and tap Enable there too.</p>
              </div>
            ) : (
              <div className="mx-3 mt-3 shrink-0">
                <button
                  onClick={async () => {
                    try {
                      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
                      const opts = { body: 'Clock-in alerts are working on this device ✅', icon: '/brand/ftio-icon.png', badge: '/brand/ftio-icon.png', tag: 'test-' + Date.now(), vibrate: [200, 100, 200] } as any;
                      if (reg) await reg.showNotification('🧪 Test — FabTrack IO', opts);
                      else new Notification('🧪 Test — FabTrack IO', opts);
                    } catch { try { new Notification('🧪 Test — FabTrack IO', { body: 'Notifications active ✅' }); } catch {} }
                  }}
                  className="w-full flex items-center justify-center gap-2 py-1.5 rounded-lg border border-white/8 bg-white/[0.03] hover:bg-white/[0.06] text-[11px] text-zinc-400 hover:text-white transition-colors"
                >
                  <BellRing className="w-3.5 h-3.5" /> Send test notification to this device
                </button>
              </div>
            )}

            {/* Alert list — scrollable */}
            <div className="overflow-y-auto flex-1 py-1">
              {alerts.length === 0 ? (
                <div className="py-14 px-6 text-center">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-3">
                    <CheckCircle className="w-6 h-6 text-emerald-400" aria-hidden="true" />
                  </div>
                  <p className="text-sm font-bold text-white">You're all caught up</p>
                  <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">Overdue jobs, due dates &amp; long timers will show up here when they happen.</p>
                </div>
              ) : (
                alerts.map((alert: any) => {
                  const { Icon, color, tint } = iconFor(alert.type);
                  return (
                    <button
                      key={alert.id}
                      type="button"
                      onClick={() => markRead(alert.id)}
                      aria-label={`${alert.title}: ${alert.body}`}
                      className={`w-full text-left px-3 py-3 border-b border-white/5 last:border-b-0 hover:bg-white/5 transition-colors flex items-start gap-3 relative ${!alert.read ? 'bg-amber-500/[0.04]' : ''}`}
                    >
                      {!alert.read && <span aria-hidden="true" className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-amber-500" />}
                      <div className={`w-9 h-9 rounded-lg ${tint} border border-white/5 flex items-center justify-center shrink-0`}>
                        <Icon className="w-4 h-4" style={{ color }} aria-hidden="true" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[13px] font-bold text-white leading-tight truncate">{alert.title}</p>
                          <span className="text-[10px] text-zinc-500 tabular shrink-0 mt-0.5">{timeAgo(alert.time)}</span>
                        </div>
                        <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed line-clamp-2">{alert.body}</p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer */}
            {alerts.length > 0 && (
              <div className="px-4 py-2 border-t border-white/5 bg-zinc-950/40 shrink-0">
                <p className="text-[10px] text-zinc-600 text-center">Tap any notification to mark it read · <kbd className="font-mono text-zinc-500">Esc</kbd> to close</p>
              </div>
            )}
          </div>
        </>,
        document.body
      )}
    </>
  );
};


//  PWA INSTALL BANNER 
const PWAInstallBanner = () => {
  const [prompt, setPrompt] = useState<any>(null);
  const [dismissed, setDismissed] = useState(() => !!localStorage.getItem('pwa-banner-dismissed'));
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const handler = (e: any) => { e.preventDefault(); setPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => setInstalled(true));
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const install = async () => {
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    setPrompt(null);
  };

  const dismiss = () => {
    setDismissed(true);
    localStorage.setItem('pwa-banner-dismissed', '1');
  };

  // Already installed as PWA  don't show
  if (installed || dismissed || !prompt || window.matchMedia('(display-mode: standalone)').matches) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 md:left-auto md:right-6 md:w-80 z-40 animate-fade-in">
      <div className="bg-zinc-900 border border-amber-500/20 rounded-2xl p-4 shadow-2xl shadow-black/50">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-orange-500 to-amber-400 flex items-center justify-center shrink-0 text-white font-black text-sm shadow shadow-amber-900/30">FT</div>
          <div className="flex-1">
            <p className="text-white font-bold text-sm">Install FabTrack IO</p>
            <p className="text-zinc-400 text-xs mt-0.5">Add to your home screen for quick access — works offline too.</p>
            <div className="flex gap-2 mt-3">
              <button onClick={install} className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white text-xs font-bold px-4 py-2 rounded-lg transition-all flex-1">
                Install App
              </button>
              <button onClick={dismiss} className="text-zinc-500 hover:text-white text-xs px-3 py-2 rounded-lg border border-white/10 hover:border-white/20 transition-all">
                Not now
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- PRINT STYLES ---
// Uses the proven "visibility-only" pattern: hide everything, un-hide the
// printable-area and its descendants, then reposition the printable-area
// to the page origin. Previous approach used `display: none` on the parent
// PrintStyles is intentionally a no-op — the traveler prints in a dedicated
// popup window via travelerPrint.ts, so no @media print rules are needed here.
const PrintStyles = () => null;

// --- DEFAULT WORKFLOW STAGES ---
export const DEFAULT_STAGES: JobStage[] = [
  { id: 'pending', label: 'Pending', color: '#71717a', order: 0 },
  { id: 'in-progress', label: 'In Progress', color: '#3b82f6', order: 1 },
  { id: 'qc', label: 'QC', color: '#f59e0b', order: 2 },
  { id: 'packing', label: 'Packing', color: '#8b5cf6', order: 3 },
  { id: 'shipped', label: 'Shipped', color: '#06b6d4', order: 4 },
  { id: 'completed', label: 'Completed', color: '#10b981', order: 5, isComplete: true },
];

export function getStages(settings: SystemSettings): JobStage[] {
  return (settings.jobStages && settings.jobStages.length > 0)
    ? [...settings.jobStages].sort((a, b) => a.order - b.order)
    : DEFAULT_STAGES;
}

export function getJobStage(job: Job, stages: JobStage[]): JobStage {
  if (job.currentStage) {
    const found = stages.find(s => s.id === job.currentStage);
    if (found) return found;
  }
  // Legacy fallback: map old status to stage
  const legacyMap: Record<string, string> = { 'pending': 'pending', 'in-progress': 'in-progress', 'completed': 'completed', 'hold': 'pending' };
  const mapped = legacyMap[job.status] || 'pending';
  return stages.find(s => s.id === mapped) || stages[0];
}

export function getNextStage(job: Job, stages: JobStage[]): JobStage | null {
  const current = getJobStage(job, stages);
  const idx = stages.findIndex(s => s.id === current.id);
  if (idx < 0 || idx >= stages.length - 1) return null;
  return stages[idx + 1];
}

// --- STATUS BADGE (stage-aware) ---
const StatusBadge = ({ status, job, stages }: { status: string; job?: Job; stages?: JobStage[] }) => {
  // If we have a job and stages, use the stage system
  if (job && stages && stages.length > 0) {
    const stage = getJobStage(job, stages);
    return (
      <span className="px-2.5 py-1 rounded-full text-[10px] uppercase font-bold tracking-wide border flex w-fit items-center gap-1.5 whitespace-nowrap"
        style={{ background: `${stage.color}15`, color: stage.color, borderColor: `${stage.color}30` }}>
        {stage.id === 'in-progress' && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: stage.color }} />}
        {stage.label}
      </span>
    );
  }
  // Legacy fallback
  const styles: Record<string, string> = {
    'pending': 'bg-zinc-800 text-zinc-400 border-white/5',
    'in-progress': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    'completed': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    'hold': 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  };
  const labels: Record<string, string> = {
    'pending': 'Pending', 'in-progress': 'Active', 'completed': 'Done', 'hold': 'Hold',
  };
  return (
    <span className={`px-2.5 py-1 rounded-full text-[10px] uppercase font-bold tracking-wide border flex w-fit items-center gap-1.5 whitespace-nowrap ${styles[status] || styles['pending']}`}>
      {status === 'in-progress' && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />}
      {labels[status] || status}
    </span>
  );
};

// --- LIVE TIMER (pause-aware) ---
const LiveTimer = ({ startTime, pausedAt, totalPausedMs }: { startTime: number, pausedAt?: number | null, totalPausedMs?: number }) => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startTime) return;
    const tick = () => {
      const now = Date.now();
      const wall = now - startTime;
      let paused = totalPausedMs || 0;
      if (pausedAt) paused += now - pausedAt;
      setElapsed(Math.max(0, Math.floor((wall - paused) / 1000)));
    };
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [startTime, pausedAt, totalPausedMs]);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  return (
    <div className="font-mono text-4xl md:text-5xl font-bold tracking-widest tabular-nums">
      {h.toString().padStart(2, '0')}:{m.toString().padStart(2, '0')}:{s.toString().padStart(2, '0')}
    </div>
  );
};

// --- ACTIVE JOB PANEL ---
const ActiveJobPanel = ({ job, log, onStop, onPause, onResume }: { job: Job | null, log: TimeLog, onStop: (id: string) => Promise<void>, onPause?: (id: string) => Promise<void>, onResume?: (id: string) => Promise<void> }) => {
  const [isStopping, setIsStopping] = useState(false);
  const isMounted = useRef(true);
  useEffect(() => () => { isMounted.current = false; }, []);

  // Drive the UI purely from the log state. The subscription updates log within
  // ~100-500ms after pause/resume, which is fast enough for perceived-instant feedback.
  const isPaused = !!log.pausedAt;

  const handleStopClick = async () => {
    if (isStopping) return;
    setIsStopping(true);
    const timeout = setTimeout(() => {
      if (isMounted.current) {
        setIsStopping(false);
        console.error('[ActiveJobPanel] Stop timed out after 10s');
      }
    }, 10000);
    try {
      await onStop(log.id);
    } catch (e) {
      console.error('[ActiveJobPanel] Stop failed:', e);
    } finally {
      clearTimeout(timeout);
      if (isMounted.current) setIsStopping(false);
    }
  };

  const handlePauseClick = async () => {
    if (!onPause) return;
    try { await onPause(log.id); }
    catch (e) { console.error('[ActiveJobPanel] Pause failed:', e); }
  };

  const handleResumeClick = async () => {
    if (!onResume) return;
    try { await onResume(log.id); }
    catch (e) { console.error('[ActiveJobPanel] Resume failed:', e); }
  };

  return (
    <div className={`bg-zinc-900 border ${isPaused ? 'border-yellow-500/30' : 'border-emerald-500/30'} rounded-3xl p-6 shadow-2xl relative overflow-hidden animate-fade-in mb-8 no-print`}>
      <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none"><Briefcase className="w-64 h-64 text-emerald-500" /></div>
      <div className={`absolute top-0 left-0 w-full h-1 ${isPaused ? 'bg-gradient-to-r from-yellow-500 via-orange-500 to-yellow-500' : 'bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-500'} opacity-50 animate-pulse`}></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 relative z-10">
        <div className="flex flex-col justify-center">
          <div className="flex items-center gap-2 mb-4">
            <span className={`animate-pulse w-3 h-3 rounded-full ${isPaused ? 'bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'}`}></span>
            <span className={`font-bold uppercase tracking-widest text-xs ${isPaused ? 'text-yellow-400' : 'text-red-400'}`}>{isPaused ? 'Job Paused' : 'Job In Progress'}</span>
          </div>
          <p className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-1">PO Number</p>
          <h2 className="text-4xl md:text-5xl font-black text-white mb-1">{job ? job.poNumber : 'Unknown'}</h2>
          <p className="text-sm text-zinc-500 mb-3">Job ID: <span className="font-mono text-zinc-400">{job ? job.jobIdsDisplay : ''}</span></p>
          <div className="text-xl text-amber-400 font-medium mb-8 flex items-center gap-2">
            <span className="px-3 py-1 bg-amber-500/10 rounded-lg border border-amber-500/20">{log.operation}</span>
          </div>
          <div className="bg-black/40 rounded-2xl p-6 border border-white/10 mb-6 w-full max-w-sm flex items-center justify-between">
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">{isPaused ? 'Paused' : 'Elapsed Time'}</p>
              <div className="text-white"><LiveTimer startTime={log.startTime} pausedAt={log.pausedAt} totalPausedMs={log.totalPausedMs} /></div>
            </div>
            <Clock className="w-8 h-8 text-zinc-600" />
          </div>
          <div className="flex gap-3 w-full max-w-sm">
            {isPaused ? (
              <button aria-label="Resume timer" onClick={handleResumeClick}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-4 rounded-xl font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20 active:scale-[0.97] transition-transform">
                <Play className="w-5 h-5" aria-hidden="true" /> Resume
              </button>
            ) : onPause ? (
              <button aria-label="Pause timer" onClick={handlePauseClick}
                className="flex-1 bg-yellow-600 hover:bg-yellow-500 text-white px-6 py-4 rounded-xl font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-yellow-900/20 active:scale-[0.97] transition-transform">
                <Pause className="w-5 h-5" aria-hidden="true" /> Pause
              </button>
            ) : null}
            <button aria-label="Stop timer" onClick={handleStopClick} disabled={isStopping}
              className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-6 py-4 rounded-xl font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-red-900/20 active:scale-[0.97] transition-transform">
              {isStopping
                ? <><span aria-hidden="true" className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Stopping…</>
                : <><StopCircle className="w-5 h-5" aria-hidden="true" /> Stop</>}
            </button>
          </div>
        </div>
        <div className="bg-white/5 rounded-2xl p-6 border border-white/5 flex flex-col h-full opacity-90">
          <h3 className="text-zinc-400 font-bold uppercase text-sm mb-4 flex items-center gap-2"><Info className="w-4 h-4" /> Job Details</h3>
          {job ? (
            <>
              {/* Part photo + key info */}
              <div className="flex gap-4 mb-4">
                {job.partImage && (
                  <img src={job.partImage} alt="Part" className="w-20 h-20 rounded-xl object-cover border border-white/10 flex-shrink-0" />
                )}
                <div className="grid grid-cols-2 gap-y-3 gap-x-4 flex-1">
                  <div><label className="text-[10px] text-zinc-500 uppercase font-bold">Part Number</label><div className="text-sm font-bold text-white break-words">{job.partNumber}</div></div>
                  <div><label className="text-[10px] text-zinc-500 uppercase font-bold">PO Number</label><div className="text-sm font-bold text-white break-words">{job.poNumber}</div></div>
                  <div><label className="text-[10px] text-zinc-500 uppercase font-bold">Quantity</label><div className="text-sm font-bold text-white">{job.quantity} <span className="text-xs font-normal text-zinc-500">units</span></div></div>
                  <div><label className="text-[10px] text-zinc-500 uppercase font-bold">Due Date</label><div className="text-sm font-bold text-white">{job.dueDate || 'N/A'}</div></div>
                </div>
              </div>
              {/* Special Instructions */}
              {job.specialInstructions && (
                <div className="mb-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3">
                  <label className="text-[10px] text-yellow-400 uppercase font-bold mb-1 block">Deburr Instructions</label>
                  <div className="text-yellow-200 text-sm leading-relaxed">{job.specialInstructions}</div>
                </div>
              )}
              {/* Notes */}
              <div className="mt-auto pt-3 border-t border-white/10">
                <label className="text-[10px] text-zinc-500 uppercase font-bold mb-1 block">Notes</label>
                <div className="text-zinc-300 text-xs leading-relaxed bg-black/20 p-3 rounded-lg border border-white/5">
                  {job.info || <span className="text-zinc-600 italic">No notes for this job.</span>}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 p-8 text-center">
              <AlertCircle className="w-12 h-12 mb-4 opacity-20" />
              <p>Job details not found.</p>
              <p className="text-xs mt-2">The job may have been deleted, but you can still stop the timer.</p>
            </div>
          )}
        </div>
      </div>

    </div>
  );
};

// --- JOB SELECTION CARD ---
const JobSelectionCard: React.FC<{ job: Job, onStart: (id: string, op: string) => void, disabled?: boolean, operations: string[], defaultExpanded?: boolean, user?: { id: string; name: string }, addToast?: any, activeLogs?: TimeLog[] }> = ({ job, onStart, disabled, operations, defaultExpanded, user, addToast, activeLogs = [] }) => {
  const [expanded, setExpanded] = useState(defaultExpanded || false);
  const [showNotes, setShowNotes] = useState(false);
  const [newNote, setNewNote] = useState('');
  // Workers can click the part photo to view a big lightbox version (user request)
  const [showImageLightbox, setShowImageLightbox] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (defaultExpanded) {
      setExpanded(true);
      if (cardRef.current) {
        setTimeout(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
      }
    }
  }, [defaultExpanded]);
  const today = todayFmt();
  const todayN = dateNum(today);
  const in3DaysN = dateNum(new Date(Date.now() + 3 * 86400000).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }));
  const isOverdue = job.dueDate && dateNum(job.dueDate) < todayN;
  const isDueSoon = job.dueDate && dateNum(job.dueDate) >= todayN && dateNum(job.dueDate) <= in3DaysN;
  const priorityColors: Record<string, string> = {
    urgent: 'border-red-500/40 bg-red-500/5',
    high: 'border-orange-500/30 bg-orange-500/5',
    normal: 'border-white/5',
    low: 'border-white/5',
  };
  const borderClass = isOverdue ? 'border-red-500/40 bg-red-500/5' : priorityColors[job.priority || 'normal'];

  return (
    <div ref={cardRef} data-job-id={job.id} className={`border rounded-2xl overflow-hidden transition-all duration-300 ${borderClass} ${expanded ? 'ring-2 ring-amber-500/50' : 'hover:bg-zinc-800/50'} ${disabled ? 'opacity-50 pointer-events-none' : ''} ${defaultExpanded ? 'ring-2 ring-amber-500 shadow-lg shadow-amber-500/10' : ''}`}>
      <div className="p-5 cursor-pointer bg-zinc-900/50" onClick={() => setExpanded(!expanded)}>
        <div className="flex justify-between items-start mb-1">
          <div>
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-0.5">PO Number</p>
            <h3 className="text-xl font-black text-white leading-tight">{job.poNumber}</h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {job.priority === 'urgent' && <span className="text-[10px] font-black text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded animate-pulse">  URGENT</span>}
            {job.priority === 'high' && <span className="text-[10px] font-black text-orange-400 bg-orange-500/10 border border-orange-500/20 px-1.5 py-0.5 rounded">  HIGH</span>}
            {(job.jobNotes?.length || 0) > 0 && <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">📝 {job.jobNotes!.length} note{job.jobNotes!.length > 1 ? 's' : ''}</span>}
            <span className="bg-zinc-950 text-zinc-400 text-xs px-2 py-1 rounded font-mono">{job.quantity} units</span>
          </div>
        </div>
        <div className="flex items-start gap-3 mt-2">
          {job.partImage && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowImageLightbox(true); }}
              className="relative group shrink-0 focus:outline-none focus:ring-2 focus:ring-amber-500/50 rounded-lg"
              aria-label="View part photo full size"
            >
              <img src={job.partImage} alt="Part reference photo" className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg object-cover border-2 border-cyan-500/30 group-hover:border-cyan-400 transition-all" />
              <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                <Image className="w-5 h-5 text-white" aria-hidden="true" />
              </span>
            </button>
          )}
          <div className="text-sm text-zinc-500 space-y-1 min-w-0 flex-1">
          <p className="truncate">Part: <span className="text-zinc-300 font-medium">{job.partNumber}</span></p>
          <p className="text-xs text-zinc-600">Job ID: <span className="text-zinc-500 font-mono">{job.jobIdsDisplay}</span></p>
          {job.dueDate && (
            <p className={`text-xs font-bold flex items-center gap-1 ${isOverdue ? 'text-red-400' : isDueSoon ? 'text-orange-400' : 'text-zinc-500'}`}>
              {isOverdue ? ' OVERDUE:' : isDueSoon ? ' Due Soon:' : 'Due:'} {normDate(job.dueDate)}
            </p>
          )}
          {/* Who's clocked in on this job right now */}
          {activeLogs.filter(l => l.jobId === job.id).length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mt-1">
              {activeLogs.filter(l => l.jobId === job.id).map(l => (
                <span key={l.id} className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-900/50 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                  {l.userName.split(' ')[0]} · {l.operation}
                </span>
              ))}
            </div>
          )}
          {/* Show progress indicators when present */}
          {((job.checklist?.length || 0) > 0 || (job.attachments?.length || 0) > 0) && (
            <div className="flex items-center gap-1.5 flex-wrap mt-1">
              {(job.checklist?.length || 0) > 0 && (() => {
                const total = job.checklist!.length;
                const done = job.checklist!.filter(c => c.done).length;
                return (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${done === total ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-purple-400 bg-purple-500/10 border-purple-500/20'}`}>
                    ✓ {done}/{total} ops
                  </span>
                );
              })()}
              {(job.attachments?.length || 0) > 0 && (
                <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded">📎 {job.attachments!.length} file{job.attachments!.length > 1 ? 's' : ''}</span>
              )}
            </div>
          )}
          </div>
        </div>
        {/* Lightbox modal — portaled to body so parent transforms can't break fixed positioning */}
        {showImageLightbox && job.partImage && createPortal(
          <div
            className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4 animate-fade-in"
            onClick={() => setShowImageLightbox(false)}
          >
            <img src={job.partImage} alt="Part reference photo" className="max-w-full max-h-[90vh] rounded-xl shadow-2xl object-contain" onClick={e => e.stopPropagation()} />
            <button
              type="button"
              onClick={() => setShowImageLightbox(false)}
              aria-label="Close image"
              className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full p-2.5 text-white transition-colors"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 border border-white/10 rounded-full px-4 py-2 backdrop-blur-xl">
              <p className="text-xs text-white/70 font-bold">{job.poNumber} · {job.partNumber}</p>
            </div>
          </div>,
          document.body
        )}
        {!expanded && (
          <div className="mt-4 flex items-center text-amber-400 text-xs font-bold uppercase tracking-wide">
            Tap to Start <ArrowRight className="w-3 h-3 ml-1" />
          </div>
        )}
      </div>
      {expanded && (
        <div className="p-4 bg-zinc-950/50 border-t border-white/5 animate-fade-in">
          {job.info && (
            <div className="mb-3 p-2 bg-zinc-900 rounded-lg text-xs text-zinc-400 border border-white/5">
              <span className="text-zinc-500 font-bold uppercase text-[10px]">Notes: </span>{job.info}
            </div>
          )}

          {/* Operation Checklist — workers can tick off ops live on the floor */}
          {(job.checklist?.length || 0) > 0 && (
            <div className="mb-3 bg-purple-500/5 border border-purple-500/20 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] text-purple-400 uppercase font-black tracking-widest">✓ Operations Checklist</p>
                {(() => {
                  const total = job.checklist!.length;
                  const done = job.checklist!.filter(c => c.done).length;
                  const pct = Math.round((done / total) * 100);
                  return <span className={`text-[10px] font-black tabular ${pct === 100 ? 'text-emerald-400' : 'text-purple-400'}`}>{done}/{total} · {pct}%</span>;
                })()}
              </div>
              <div className="space-y-1">
                {job.checklist!.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!user) return;
                      const next = (job.checklist || []).map(c =>
                        c.id === item.id
                          ? (c.done
                              ? { ...c, done: false, doneAt: undefined, doneBy: undefined, doneByName: undefined }
                              : { ...c, done: true, doneAt: Date.now(), doneBy: user.id, doneByName: user.name })
                          : c
                      );
                      DB.saveJob({ ...job, checklist: next });
                      if (!item.done) addToast?.('success', `✓ ${item.label}`);
                    }}
                    className={`w-full flex items-center gap-2 p-2 rounded-lg border transition-all text-left ${item.done ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-zinc-900 border-white/10 hover:border-purple-400/30'}`}
                  >
                    <span className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${item.done ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-600'}`}>
                      {item.done && <CheckCircle className="w-3 h-3 text-white" aria-hidden="true" />}
                    </span>
                    <span className={`flex-1 text-sm ${item.done ? 'text-zinc-500 line-through' : 'text-white'}`}>{item.label}</span>
                    {item.doneByName && <span className="text-[9px] text-emerald-400/70 shrink-0">✓ {item.doneByName.split(' ')[0]}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Attachments — workers can download drawings/cert docs from the floor */}
          {(job.attachments?.length || 0) > 0 && (
            <div className="mb-3 bg-indigo-500/5 border border-indigo-500/20 rounded-lg p-3">
              <p className="text-[10px] text-indigo-400 uppercase font-black tracking-widest mb-2">📎 Drawings & Files ({job.attachments!.length})</p>
              <div className="grid grid-cols-2 gap-1.5">
                {job.attachments!.map(att => {
                  const icon = att.category === 'drawing' ? '📐' : att.category === 'photo' ? '📷' : att.category === 'cert' ? '📜' : att.category === 'inspection' ? '🔍' : '📎';
                  return (
                    <a
                      key={att.id}
                      href={att.dataUrl}
                      download={att.name}
                      target="_blank"
                      rel="noopener"
                      onClick={e => e.stopPropagation()}
                      className="flex items-center gap-2 bg-zinc-900 hover:bg-indigo-500/10 border border-white/5 hover:border-indigo-500/30 rounded-lg p-2 transition-all"
                    >
                      <span className="text-lg shrink-0">{icon}</span>
                      <span className="text-[11px] text-white truncate flex-1">{att.name}</span>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-xs text-zinc-500 uppercase font-bold mb-3">Select Operation:</p>
          <div className="grid grid-cols-2 gap-2">
            {operations.map(op => (
              <button key={op} onClick={e => { e.stopPropagation(); onStart(job.id, op); }}
                className="bg-zinc-800 hover:bg-amber-600 hover:text-white border border-white/5 py-3 px-4 rounded-xl text-sm text-zinc-300 transition-colors font-bold active:scale-95">
                {op}
              </button>
            ))}
            {operations.length === 0 && <p className="col-span-2 text-xs text-zinc-500 text-center py-2">No operations configured.</p>}
          </div>

          {/* Notes toggle */}
          <button onClick={(e) => { e.stopPropagation(); setShowNotes(!showNotes); }} className="mt-3 w-full flex items-center justify-between bg-zinc-900 hover:bg-zinc-800 border border-white/5 rounded-lg px-3 py-2 transition-colors">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              📝 Notes {(job.jobNotes?.length || 0) > 0 && <span className="bg-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded-full text-[10px]">{job.jobNotes!.length}</span>}
            </span>
            {showNotes ? <ChevronUp className="w-3 h-3 text-zinc-500" /> : <ChevronDown className="w-3 h-3 text-zinc-500" />}
          </button>

          {showNotes && (
            <div className="mt-2 space-y-2 animate-fade-in">
              {/* Existing notes */}
              {(job.jobNotes || []).sort((a, b) => b.timestamp - a.timestamp).map(n => (
                <div key={n.id} className="bg-zinc-900 border border-white/5 rounded-lg px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-zinc-200 leading-relaxed">{n.text}</p>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] font-bold text-amber-400">{n.userName}</span>
                    <span className="text-[10px] text-zinc-600">{new Date(n.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              ))}
              {(job.jobNotes || []).length === 0 && <p className="text-xs text-zinc-600 text-center py-2">No notes yet</p>}

              {/* Add new note */}
              {user && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newNote}
                    onChange={e => setNewNote(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newNote.trim()) {
                        e.stopPropagation();
                        DB.addJobNote(job.id, newNote.trim(), user.id, user.name, job.jobIdsDisplay || job.partNumber || job.id);
                        addToast?.('success', 'Note added');
                        setNewNote('');
                      }
                    }}
                    onClick={e => e.stopPropagation()}
                    placeholder="Add a note..."
                    className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!newNote.trim()) return;
                      DB.addJobNote(job.id, newNote.trim(), user.id, user.name, job.jobIdsDisplay || job.partNumber || job.id);
                      addToast?.('success', 'Note added');
                      setNewNote('');
                    }}
                    disabled={!newNote.trim()}
                    className="bg-amber-600 hover:bg-amber-500 disabled:opacity-30 text-white px-3 py-2 rounded-lg text-sm font-bold transition-colors"
                  >Add</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// --- EMPLOYEE DASHBOARD ---
// ── Helper: post a message to the active Service Worker ──────────
function swPost(msg: object) {
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(msg);
    }
  } catch {}
}

// ── Camera-based QR Scanner tab ──────────────────────────────────────────────
const ScanJobTab = ({ jobs, onJobFound, addToast }: { jobs: Job[]; onJobFound: (id: string) => void; addToast: any }) => {
  const [mode, setMode] = useState<'input' | 'camera'>('input');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  const resolveValue = (val: string) => {
    let v = val.trim();
    // Handle full deep-link URL from QR
    try { const u = new URL(v); v = u.searchParams.get('jobId') || v; } catch {}
    const m = v.match(/[?&]jobId=([^&]+)/);
    if (m) v = decodeURIComponent(m[1]);
    return v;
  };

  const handleResult = (raw: string) => {
    const val = resolveValue(raw);
    const found = jobs.find(j =>
      j.id === val || j.jobIdsDisplay === val || j.poNumber === val ||
      j.id.toLowerCase() === val.toLowerCase()
    );
    if (found) {
      stopCamera();
      onJobFound(found.id);
      addToast('success', `Opened: ${found.poNumber}`);
    } else {
      addToast('info', 'QR scanned — job not found. Try typing the PO#.');
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const val = (e.currentTarget as HTMLInputElement).value;
      (e.currentTarget as HTMLInputElement).value = '';
      handleResult(val);
    }
  };

  const stopCamera = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setScanning(false);
  };

  const startCamera = async () => {
    setError('');
    setScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      // Use BarcodeDetector if available (Chrome 88+)
      const BD = (window as any).BarcodeDetector;
      if (!BD) { setError('Camera scan needs Chrome 88+. Use the text input instead.'); stopCamera(); return; }
      const detector = new BD({ formats: ['qr_code'] });
      const scan = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0) { handleResult(codes[0].rawValue); return; }
        } catch {}
        rafRef.current = requestAnimationFrame(scan);
      };
      rafRef.current = requestAnimationFrame(scan);
    } catch (e: any) {
      setError(e.name === 'NotAllowedError' ? 'Camera permission denied. Allow camera access and try again.' : 'Could not start camera. Use the text input instead.');
      setScanning(false);
    }
  };

  useEffect(() => () => stopCamera(), []);

  return (
    <div className="flex-1 flex items-center justify-center animate-fade-in py-8 px-4">
      <div className="bg-zinc-900 rounded-3xl border border-white/10 text-center w-full max-w-sm shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-6 pb-4">
          <QrCode className="w-14 h-14 mx-auto text-amber-500 mb-3" />
          <h2 className="text-xl font-bold text-white mb-1">Scan Job QR</h2>
          <p className="text-zinc-500 text-xs">Point camera at printed traveler QR code or use hardware scanner</p>
        </div>

        {/* Mode tabs */}
        <div className="flex border-t border-white/5">
          <button onClick={() => { stopCamera(); setMode('input'); }} className={`flex-1 py-2.5 text-sm font-bold transition-all ${mode === 'input' ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-white'}`}>
            ⌨️ Type / Hardware
          </button>
          <button onClick={() => { setMode('camera'); if (!scanning) startCamera(); }} className={`flex-1 py-2.5 text-sm font-bold transition-all ${mode === 'camera' ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-white'}`}>
            📷 Camera Scan
          </button>
        </div>

        <div className="p-6 pt-4">
          {mode === 'input' ? (
            <>
              <input autoFocus onKeyDown={handleKey} className="bg-black/50 border border-amber-500 rounded-xl px-4 py-3 text-white text-center w-full text-base focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Scan or type PO / Job ID…" />
              <p className="text-zinc-600 text-xs mt-3">Press Enter after typing or scanning with a USB barcode reader</p>
            </>
          ) : (
            <>
              <div className="relative rounded-xl overflow-hidden bg-black aspect-square mb-3">
                <video ref={videoRef} muted playsInline className="w-full h-full object-cover" />
                {scanning && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-48 h-48 border-2 border-amber-400 rounded-lg" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)' }} />
                  </div>
                )}
              </div>
              {error ? (
                <p className="text-red-400 text-xs">{error}</p>
              ) : scanning ? (
                <p className="text-amber-400 text-xs animate-pulse">Hold QR code in the box…</p>
              ) : null}
              <button onClick={scanning ? stopCamera : startCamera} className={`mt-3 w-full py-2.5 rounded-xl font-bold text-sm transition-all ${scanning ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-amber-600 hover:bg-amber-500 text-white'}`}>
                {scanning ? 'Stop Camera' : 'Start Camera'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const EmployeeDashboard = ({ user, addToast, onLogout, notifBell }: { user: User, addToast: any, onLogout: () => void, notifBell?: React.ReactNode }) => {
  const [tab, setTab] = useState<'jobs' | 'history' | 'scan' | 'progress'>('jobs');
  const [activeLog, setActiveLog] = useState<TimeLog | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState('');
  const [myHistory, setMyHistory] = useState<TimeLog[]>([]);
  const [shopActiveLogs, setShopActiveLogs] = useState<TimeLog[]>([]);
  const [ops, setOps] = useState<string[]>([]);
  const [scannedJobId, setScannedJobId] = useState<string | null>(null);
  const activePanelRef = useRef<HTMLDivElement>(null);
  const [shouldScrollToTimer, setShouldScrollToTimer] = useState(false);

  // Scroll to active timer panel when it appears after starting an operation
  useEffect(() => {
    if (shouldScrollToTimer && activeLog && activePanelRef.current) {
      activePanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setShouldScrollToTimer(false);
    }
  }, [shouldScrollToTimer, activeLog]);

  // Auto-open job from QR scan — reads from sessionStorage (set on page load before login)
  useEffect(() => {
    const pendingId = sessionStorage.getItem('pending_jobId');
    if (pendingId && jobs.length > 0) {
      const found = jobs.find(j =>
        j.id === pendingId ||
        j.id.toLowerCase() === pendingId.toLowerCase() ||
        j.poNumber === pendingId ||
        j.jobIdsDisplay === pendingId
      );
      if (found) {
        sessionStorage.removeItem('pending_jobId');
        setScannedJobId(found.id);
        setTab('jobs');
        addToast('success', `Opened: ${found.poNumber}`);
      }
    }
  }, [jobs]);

  useEffect(() => {
    const unsubSettings = DB.subscribeSettings((s) => setOps(s.customOperations || []));
    const unsubLogs = DB.subscribeLogs((allLogs) => {
      const myActive = allLogs.find(l => l.userId === user.id && !l.endTime);
      const history = allLogs.filter(l => l.userId === user.id).sort((a, b) => b.startTime - a.startTime);
      setActiveLog(myActive || null);
      setMyHistory(history);
      if (myActive) {
        DB.getJobById(myActive.jobId).then(j => setActiveJob(j || null));
      } else {
        setActiveJob(null);
      }
    });
    const unsubJobs = DB.subscribeJobs((allJobs) => {
      setJobs(allJobs.filter(j => j.status !== 'completed').reverse());
    });
    const unsubActiveLogs = DB.subscribeActiveLogs(setShopActiveLogs);
    return () => { unsubSettings(); unsubLogs(); unsubJobs(); unsubActiveLogs(); };
  }, [user.id]);

  // ── Sync active timer state to Service Worker for lock-screen notification ──
  const prevLogIdRef = useRef<string | null>(null);
  useEffect(() => {
    const logId = activeLog?.id ?? null;
    const prevId = prevLogIdRef.current;

    if (logId && logId !== prevId) {
      // Timer just started (or component mounted with an active log)
      swPost({
        type: 'TIMER_START',
        logId: activeLog!.id,
        operation: activeLog!.operation,
        poNumber: activeJob?.poNumber || activeLog!.jobId,
        partNumber: activeLog!.partNumber || activeJob?.partNumber || '',
        startTime: activeLog!.startTime,
      });
    } else if (!logId && prevId) {
      // Timer just stopped
      swPost({ type: 'TIMER_STOP' });
    }
    prevLogIdRef.current = logId;
  }, [activeLog?.id, activeJob?.poNumber]);

  // ── Screen Wake Lock — keep screen on while timer is running ──────
  const wakeLockRef = useRef<any>(null);
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    if (activeLog && !activeLog.endTime) {
      (navigator as any).wakeLock.request('screen').then((lock: any) => {
        wakeLockRef.current = lock;
      }).catch(() => {});
    } else {
      if (wakeLockRef.current) { wakeLockRef.current.release().catch(() => {}); wakeLockRef.current = null; }
    }
    return () => { if (wakeLockRef.current) { wakeLockRef.current.release().catch(() => {}); wakeLockRef.current = null; } };
  }, [activeLog?.id]);

  // ── Reminders: long timer, morning clock-in, end-of-shift ─────────
  // These fire local browser notifications via the Service Worker. They run while
  // this tab is alive; for true background notifications (closed tab), the worker
  // needs to install the PWA AND grant notification permission — then the backend
  // push infrastructure takes over. See services/reminders.ts for details.
  const [shopSettingsForReminders, setShopSettingsForReminders] = useState<SystemSettings>(DB.getSettings());
  useEffect(() => {
    const unsub = DB.subscribeSettings(setShopSettingsForReminders);
    return unsub;
  }, []);
  useEffect(() => {
    // Only run reminders after the user has granted notification permission
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const getActive = () => (activeLog ? [activeLog] : []);
    const getJobLabel = (jobId: string) => {
      const j = jobs.find(jj => jj.id === jobId);
      return j?.jobIdsDisplay || j?.partNumber || jobId;
    };
    const stopLong     = watchLongRunningTimers(getActive);
    const stopMorning  = watchClockInReminder(user, getActive);
    const stopEndShift = watchEndOfShiftReminder(user, getActive, shopSettingsForReminders);
    const stopBadge    = watchLiveTimerBadge(getActive, getJobLabel);
    return () => { stopLong(); stopMorning(); stopEndShift(); stopBadge(); };
  }, [activeLog?.id, activeLog?.pausedAt, user.id, shopSettingsForReminders.autoClockOutTime]);

  // Shift Alarms — customizable break / lunch / clock-out alerts.
  // Runs regardless of notification permission (audio bell works without it)
  // so shop-floor TVs get an audible cue even if they never saw the permission prompt.
  // Preload CDN sounds on mount so the first alarm of the day plays instantly.
  useEffect(() => { preloadAlarmSounds(); }, []);

  // Proactively schedule upcoming alarms with the browser's Notification
  // Trigger API. On Chrome/Edge Android + desktop this fires notifications
  // EVEN WHEN THE APP IS FULLY CLOSED. iOS silently returns supported:false
  // and relies on the catch-up-on-focus mechanism inside watchShiftAlarms.
  useEffect(() => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    scheduleUpcomingAlarms(shopSettingsForReminders).catch(() => {});
  }, [shopSettingsForReminders]);

  // ── Stable refs so watchShiftAlarms mounts ONCE and never remounts ────
  //
  // ROOT CAUSE OF RANDOM CLOCK-OUT BUG:
  // Previously the dependency array was [shopSettingsForReminders]. Any
  // Firestore settings update (new object reference) would tear down and
  // recreate the watcher. On recreation, tick(30 * 60_000) runs immediately —
  // a 30-minute catch-up. If a clockOut alarm was within the last 30 minutes,
  // DB.stopTimeLog() fired, randomly ending an active worker's shift.
  //
  // Fix strategy:
  //   1. Keep both mutable values in refs so the callback always reads the
  //      latest value without being listed as a dependency.
  //   2. Empty dep array [] — watcher mounts once on component mount, cleaned
  //      up once on unmount. Settings changes never cause a remount.
  //   3. shiftAlarms.ts now passes `isCatchup: boolean` to onFire. Destructive
  //      actions (clockOut, pauseTimers) are skipped during any catch-up sweep
  //      — only real-time fires (exact 60s window) execute those.
  const activeLogRef = useRef<TimeLog | null>(null);
  useEffect(() => { activeLogRef.current = activeLog; }, [activeLog]);

  const shopSettingsAlarmRef = useRef<SystemSettings>(shopSettingsForReminders);
  useEffect(() => { shopSettingsAlarmRef.current = shopSettingsForReminders; }, [shopSettingsForReminders]);

  useEffect(() => {
    const stop = watchShiftAlarms(
      () => shopSettingsAlarmRef.current,
      async (alarm, isCatchup) => {
        // Audible bell first — reliably wakes people on the floor.
        // Audio fires in both real-time AND catch-up (good UX: user reopens
        // the app and hears the bell they missed — but no destructive action).
        playAlarmSound(alarm.sound || 'bell', alarm.customSoundUrl, alarm.durationSec);
        // Visual notification (if permission granted).
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
          try {
            const reg = await navigator.serviceWorker.getRegistration();
            reg?.showNotification(`🔔 ${alarm.label}`, {
              body: alarm.clockOut ? 'Shift is ending — wrap up your current task.' : alarm.pauseTimers ? 'Timers will pause until you come back.' : 'Time to take a break.',
              icon: '/icon-192.png',
              badge: '/icon-72.png',
              tag: `alarm-${alarm.id}`,
              vibrate: [300, 100, 300, 100, 300],
              requireInteraction: !!alarm.clockOut,
            } as any);
          } catch {}
        }
        // Destructive side-effects ONLY in real-time fires (isCatchup = false).
        // This prevents workers being clocked out when:
        //   • The tab is refreshed mid-shift
        //   • Settings are saved (new Firestore snapshot)
        //   • The phone/iPad wakes up from sleep
        if (isCatchup) return;
        // Read from ref so we always have the current log without re-mounting.
        const currentLog = activeLogRef.current;
        if (alarm.pauseTimers && currentLog && !currentLog.pausedAt) {
          try { await DB.pauseTimeLog(currentLog.id, `Auto-pause: ${alarm.label}`); } catch {}
        }
        if (alarm.clockOut && currentLog) {
          try { await DB.stopTimeLog(currentLog.id, undefined, undefined, undefined, 'alarm:shift-end'); } catch {}
        }
      }
    );
    return stop;
  // Empty dep array: watcher mounts once. Both activeLog and shopSettings are
  // accessed via refs so they're always current without causing remounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Listen for TIMER_ACTION messages from SW notification buttons ──
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handler = async (event: MessageEvent) => {
      if (event.data?.type !== 'TIMER_ACTION') return;
      const { action, logId } = event.data;
      if (!logId) return;
      try {
        if (action === 'stop') {
          await DB.stopTimeLog(logId, undefined, undefined, undefined, 'sw:notification');
          cancelTimerNotification(logId);
          addToast('success', '⏹️ Timer stopped');
        } else if (action === 'pause') {
          await DB.pauseTimeLog(logId, 'manual');
          swPost({ type: 'TIMER_PAUSE' });
          addToast('info', '⏸️ Timer paused');
        } else if (action === 'resume') {
          await DB.resumeTimeLog(logId);
          swPost({ type: 'TIMER_RESUME' });
          addToast('success', '▶️ Timer resumed');
        }
      } catch { addToast('error', 'Action failed — please try again'); }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [addToast]);

  const handleStartJob = async (jobId: string, operation: string) => {
    const job = jobs.find(j => j.id === jobId);
    try {
      const logId = await DB.startTimeLog(jobId, user.id, user.name, operation, job?.partNumber, job?.customer, undefined, undefined, job?.jobIdsDisplay);
      if (logId) {
        const jobLabel = job?.jobIdsDisplay || job?.partNumber || jobId;
        const startTime = Date.now();
        showTimerStarted({ id: logId, userId: user.id, operation, startTime }, jobLabel);
      }
      // Smart auto-routing: clocking in on "Washing" moves the job to the Washing stage
      if (job) {
        const settings = DB.getSettings();
        const stages = getStages(settings);
        const target = findStageForOperation(operation, stages);
        if (target && shouldAutoRoute(job, target)) {
          try {
            await DB.advanceJobStage(jobId, target.id, user.id, user.name, false);
            addToast('info', `Job moved to ${target.label}`);
          } catch { /* silent — timer still started */ }
        }
      }
      addToast('success', 'Timer Started');
      setShouldScrollToTimer(true);
    } catch (e) {
      addToast('error', 'Failed to start timer');
    }
  };

  // Worker flow: no qty prompt. Rate learning gets its data from
  // admin-entered Sample Times (Settings → Rate Samples), not from
  // every individual clock-out.
  const handleStopJob = async (logId: string) => {
    const stoppedJobId = activeLog?.jobId ?? null;
    try {
      await DB.stopTimeLog(logId, undefined, undefined, undefined, 'manual');
      swPost({ type: 'TIMER_STOP' });
      cancelTimerNotification(logId);
      addToast('success', 'Job Stopped');
      if (stoppedJobId) {
        setScannedJobId(stoppedJobId);
        setTab('jobs');
        setTimeout(() => {
          const jobCard = document.querySelector(`[data-job-id="${stoppedJobId}"]`);
          if (jobCard) jobCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      }
    } catch (e: any) {
      console.error('[EmployeeDashboard] Stop failed:', e);
      addToast('error', 'Failed to stop. Please try again.');
      throw e;
    }
  };

  // Stuck-timer force-clear — same direct stop, different audit reason.
  const forceStopJob = async (logId: string) => {
    try { await DB.stopTimeLog(logId, undefined, undefined, undefined, 'manual:force-clear'); }
    catch { addToast('error', 'Failed to stop. Please try again.'); }
  };

  const handleScan = (e: any) => {
    if (e.key === 'Enter') {
      let val = e.currentTarget.value.trim();
      e.currentTarget.value = '';
      // Extract jobId from URL if scanned QR contains full URL
      const urlMatch = val.match(/[?&]jobId=([^&]+)/);
      if (urlMatch) val = urlMatch[1];
      // Also handle raw URLs that might be encoded
      const decoded = decodeURIComponent(val);
      const urlMatch2 = decoded.match(/[?&]jobId=([^&]+)/);
      if (urlMatch2) val = urlMatch2[1];
      // Find job by internal ID, jobIdsDisplay, or PO number
      const found = jobs.find(j =>
        j.id === val ||
        j.jobIdsDisplay === val ||
        j.poNumber === val ||
        j.id.toLowerCase() === val.toLowerCase()
      );
      if (found) {
        setScannedJobId(found.id);
        setTab('jobs');
        addToast('success', `Opened: ${found.poNumber}`);
        // Scroll to the job after a short delay for render
        setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 200);
      } else {
        setSearch(val);
        setTab('jobs');
        addToast('info', 'Job not found — showing search results');
      }
    }
  };

  const filteredJobs = jobs.filter(j => {
    try { return JSON.stringify(j).toLowerCase().includes((search || '').toLowerCase()); } catch { return false; }
  });

  // History grouping
  const histToday = new Date(); histToday.setHours(0,0,0,0);
  const histYesterday = new Date(histToday); histYesterday.setDate(histToday.getDate() - 1);
  const histWeekAgo = new Date(histToday); histWeekAgo.setDate(histToday.getDate() - 7);
  const histWeekStart = new Date(histToday); histWeekStart.setDate(histToday.getDate() - histToday.getDay());
  const histWeekLogs = myHistory.filter(l => l.endTime && new Date(l.startTime) >= histWeekStart);
  const histWeekMins = histWeekLogs.reduce((a, l) => a + (l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0)), 0);
  const historyGroups = [
    { label: 'Today', logs: myHistory.filter(l => new Date(l.startTime) >= histToday) },
    { label: 'Yesterday', logs: myHistory.filter(l => new Date(l.startTime) >= histYesterday && new Date(l.startTime) < histToday) },
    { label: 'This Week', logs: myHistory.filter(l => new Date(l.startTime) >= histWeekAgo && new Date(l.startTime) < histYesterday) },
    { label: 'Older', logs: myHistory.filter(l => new Date(l.startTime) < histWeekAgo) },
  ].filter(g => g.logs.length > 0);

  // Today stats for worker header
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayLogs = myHistory.filter(l => new Date(l.startTime) >= todayStart);
  const todayMins = todayLogs.reduce((a, l) => a + (l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0)), 0);
  const todayHours = todayMins >= 60 ? `${Math.floor(todayMins/60)}h ${Math.round(todayMins%60)}m` : `${Math.round(todayMins)}m`;
  const todayJobs = new Set(todayLogs.map(l => l.jobId)).size;
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  return (
    <div className="space-y-5 max-w-5xl mx-auto h-full flex flex-col pb-20">
      {/* Worker hero — personalized greeting + today stats */}
      <div className="card-shine bg-gradient-to-br from-zinc-900/60 to-zinc-900/30 border border-white/5 rounded-3xl p-4 sm:p-6 overflow-hidden relative">
        <div aria-hidden="true" className="absolute top-0 right-0 w-40 h-40 bg-amber-500/10 blur-3xl rounded-full" />
        <div className="relative flex items-center gap-4">
          <Avatar name={user.name} size="xl" ring dot={activeLog ? 'live' : undefined} />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">{greeting}</p>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight truncate mt-0.5">{user.name}</h2>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              {user.employeeId && <span className="text-[10px] font-mono font-bold text-zinc-400 bg-zinc-800/60 border border-white/5 px-1.5 py-0.5 rounded">{user.employeeId}</span>}
              <span className="text-[10px] font-bold text-zinc-500 flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${activeLog ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`} />
                {activeLog ? 'Clocked in' : 'Not clocked in'}
              </span>
              <span className="text-[10px] text-zinc-600 hidden sm:inline">·</span>
              <span className="text-[10px] text-zinc-600 hidden sm:inline">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</span>
            </div>
          </div>
          {/* Today stats — right side on wider screens */}
          <div className="hidden sm:flex items-center gap-4 pl-4 border-l border-white/10 shrink-0">
            <div className="text-right">
              <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Today</p>
              <p className="text-xl font-black text-white tabular mt-0.5">{todayHours}</p>
            </div>
            <div className="text-right">
              <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Jobs</p>
              <p className="text-xl font-black text-amber-400 tabular mt-0.5">{todayJobs}</p>
            </div>
          </div>
        </div>
        {/* Mobile stats row */}
        <div className="sm:hidden grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-white/5">
          <div className="text-center">
            <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Today</p>
            <p className="text-lg font-black text-white tabular mt-0.5">{todayHours}</p>
          </div>
          <div className="text-center">
            <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Jobs</p>
            <p className="text-lg font-black text-blue-400 tabular mt-0.5">{todayJobs}</p>
          </div>
        </div>
      </div>

      {/* Morning reminder — no active timer and no logs today, shows after 5:05 AM */}
      {!activeLog && (() => {
        const now = new Date();
        const hhmm = now.getHours() * 60 + now.getMinutes();
        const tLogs = myHistory.filter(l => new Date(l.startTime) >= new Date(new Date().setHours(0,0,0,0)));
        return hhmm >= 305 && hhmm < 720 && tLogs.length === 0; // 5:05 AM to 12:00 PM
      })() && (
        <div className="bg-orange-500/10 border border-orange-500/20 rounded-2xl p-4 flex items-center gap-3 animate-fade-in">
          <span className="text-3xl" aria-hidden="true">⏰</span>
          <div>
            <p className="text-orange-400 font-bold">You haven't clocked in yet!</p>
            <p className="text-orange-400/60 text-xs">It's {new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} — tap <strong>Scan</strong> below to start your first operation.</p>
          </div>
        </div>
      )}

      {activeLog && <div ref={activePanelRef}><ActiveJobPanel job={activeJob} log={activeLog} onStop={handleStopJob}
        onPause={async (id) => { try { await DB.pauseTimeLog(id, 'manual'); swPost({ type: 'TIMER_PAUSE' }); addToast('info', 'Timer Paused'); } catch { addToast('error', 'Failed to pause'); } }}
        onResume={async (id) => { try { await DB.resumeTimeLog(id); swPost({ type: 'TIMER_RESUME' }); addToast('success', 'Timer Resumed'); } catch { addToast('error', 'Failed to resume'); } }}
      /></div>}

      <div className="flex flex-wrap gap-2 justify-between items-center bg-zinc-900/50 backdrop-blur-md p-2 rounded-2xl border border-white/5 no-print">
        <div className="flex gap-2">
          <button onClick={() => setTab('jobs')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === 'jobs' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-white'}`}>Jobs</button>
          <button onClick={() => setTab('history')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${tab === 'history' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-white'}`}><History className="w-4 h-4" /> History</button>
          <button onClick={() => setTab('progress')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${tab === 'progress' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-white'}`}><Zap className="w-4 h-4" /> Stats</button>
        </div>
        <div className="flex items-center gap-2">
          {notifBell}
          <button onClick={() => setTab('scan')} className={`px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${tab === 'scan' ? 'bg-amber-600 text-white shadow' : 'bg-zinc-800 text-amber-400 hover:bg-amber-600 hover:text-white'}`}><ScanLine className="w-4 h-4" /> Scan</button>
          <button onClick={onLogout} className="bg-red-500/10 text-red-500 hover:bg-red-600 hover:text-white px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all"><LogOut className="w-4 h-4" /> Exit</button>
        </div>
      </div>

      {tab === 'scan' ? (
        <ScanJobTab jobs={jobs} onJobFound={(id) => { setScannedJobId(id); setTab('jobs'); }} addToast={addToast} />

      ) : tab === 'history' ? (
        <div className="space-y-4 animate-fade-in">
          {/* Weekly summary */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-amber-400">
                {histWeekMins >= 60 ? `${Math.floor(histWeekMins/60)}h ${Math.round(histWeekMins%60)}m` : `${Math.round(histWeekMins)}m`}
              </p>
              <p className="text-xs text-zinc-500 mt-1">This Week</p>
            </div>
            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-purple-400">{histWeekLogs.length}</p>
              <p className="text-xs text-zinc-500 mt-1">Operations</p>
            </div>
          </div>
          {/* Grouped history */}
          {historyGroups.length === 0 ? (
            <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-8 text-center text-zinc-500">No history found.</div>
          ) : historyGroups.map(group => (
            <div key={group.label} className="bg-zinc-900/50 border border-white/5 rounded-3xl overflow-hidden">
              <div className="px-4 py-2.5 bg-white/5 border-b border-white/5">
                <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">{group.label}</span>
              </div>
              <div className="divide-y divide-white/5">
                {group.logs.map(log => (
                  <React.Fragment key={log.id}>
                    <div className="px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-white text-sm">{log.jobIdsDisplay || log.jobId}</span>
                          {log.partNumber && <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">{log.partNumber}</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-xs text-zinc-400">{log.operation}</span>
                          <span className="text-xs text-zinc-600">·</span>
                          <span className="text-xs text-zinc-500">
                            {new Date(log.startTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}
                            {log.endTime ? ` → ${new Date(log.endTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}` : ''}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {(log.durationSeconds != null && log.durationSeconds >= 0 ? log.durationSeconds / 60 : log.durationMinutes) ? <span className="text-xs font-mono text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded">{formatDuration(log.durationSeconds != null && log.durationSeconds >= 0 ? log.durationSeconds / 60 : (log.durationMinutes || 0))}</span> : null}
                        {log.endTime
                          ? <span className="text-xs text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full">Done</span>
                          : <span className="text-xs text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded-full flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>Active</span>
                        }
                      </div>
                    </div>
                    {log.notes && (
                      <div className="px-4 pb-3 -mt-1">
                        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2 flex items-start gap-2">
                          <span className="text-amber-500 text-xs mt-0.5">📝</span>
                          <span className="text-amber-300/90 text-xs">{log.notes}</span>
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : tab === 'progress' ? (
        <ProgressView userId={user?.id || ''} userName={user?.name || ''} recentLogs={myHistory} />
      ) : (
        <div className="flex-1 flex flex-col animate-fade-in">
          <div className="relative mb-6">
            <Search className="absolute left-4 top-3.5 w-5 h-5 text-zinc-500" />
            <input type="text" placeholder="Search by Job #, PO, or Part..." value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-zinc-900 border border-white/10 rounded-2xl pl-12 pr-4 py-3 text-white focus:ring-2 focus:ring-amber-500 focus:outline-none shadow-sm" />
          </div>
          {activeLog && (() => {
            const staleMinutes = Math.floor((Date.now() - activeLog.startTime) / 60000);
            const isStale = staleMinutes > 60; // running > 1 hour with no interaction
            return (
              <div className={`mb-4 p-3 rounded-xl border text-sm flex items-center justify-between gap-2 ${isStale ? 'bg-red-900/20 border-red-500/30 text-red-300' : 'bg-emerald-900/20 border-emerald-500/30 text-emerald-300'}`}>
                <span className="flex items-center gap-2">
                  <Info className="w-4 h-4 shrink-0" />
                  {isStale
                    ? `Timer has been running ${staleMinutes >= 60 ? Math.floor(staleMinutes / 60) + 'h ' : ''}${staleMinutes % 60}m — is it stuck?`
                    : 'Timer running — stop it above before starting a new job.'}
                </span>
                {isStale && (
                  <button
                    onClick={() => forceStopJob(activeLog.id)}
                    className="shrink-0 text-xs font-bold text-red-400 hover:text-white bg-red-500/15 hover:bg-red-500 px-3 py-1.5 rounded-lg border border-red-500/20 transition-all"
                  >
                    Clear Stuck Timer
                  </button>
                )}
              </div>
            );
          })()}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredJobs.map(job => (
              <JobSelectionCard key={job.id} job={job} onStart={(id, op) => { handleStartJob(id, op); setScannedJobId(null); }} disabled={!!activeLog} operations={ops} defaultExpanded={job.id === scannedJobId} user={user} addToast={addToast} activeLogs={shopActiveLogs} />
            ))}
            {filteredJobs.length === 0 && <div className="col-span-full py-12 text-center text-zinc-500">No active jobs found matching "{search}".</div>}
          </div>
        </div>
      )}

    </div>
  );
};

// --- CONFIRM MODAL ---
// Portaled to body so it escapes any parent transform/opacity stacking context.
// Esc-to-cancel for keyboard users. Responsive: full-bleed on mobile, centered
// card on tablet+. Natural height — buttons never clip on short viewports.
const ConfirmationModal = ({ isOpen, title, message, onConfirm, onCancel }: any) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') { onConfirm(); onCancel(); }
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [isOpen, onConfirm, onCancel]);

  if (!isOpen) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[400] overflow-y-auto bg-zinc-950 animate-fade-in"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div className="min-h-full flex items-center justify-center p-4">
        <div
          className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-2xl p-5 sm:p-6 shadow-2xl"
          onClick={e => e.stopPropagation()}
        >
          <h3 className="text-base sm:text-lg font-bold text-white mb-2 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" aria-hidden="true" /> {title}
          </h3>
          <p className="text-zinc-400 text-sm mb-5 sm:mb-6">{message}</p>
          <div className="flex justify-end gap-2 sm:gap-3">
            <button type="button" onClick={onCancel} className="text-zinc-400 hover:text-white text-sm font-semibold px-3 sm:px-4 py-2">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { onConfirm(); onCancel(); }}
              className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-red-900/20"
              autoFocus
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// --- PRINTABLE JOB SHEET ---
// Reads layout preferences from settings.traveler so admins can hide QR
// codes, change the row count, add a footer notice, etc. without code.
const PrintableJobSheet = ({ job, onClose, onPrinted }: { job: Job | null, onClose: () => void, onPrinted?: (jobId: string) => void }) => {
  const [appSettings, setAppSettings] = useState<SystemSettings>(DB.getSettings());
  const [allLogs, setAllLogs] = useState<TimeLog[]>([]);
  useEffect(() => DB.subscribeSettings(setAppSettings), []);
  useEffect(() => DB.subscribeLogs(setAllLogs), []);

  if (!job) return null;
  // Operation-level rate breakdown for the traveler estimate section.
  // Recomputes if logs update while the preview is open.
  const rateBreakdown = getRateBreakdownForJob(job, allLogs, appSettings.rateBuffer ?? 1.15);
  const currentBaseUrl = window.location.href.split('?')[0];
  const deepLinkData = `${currentBaseUrl}?jobId=${job.id}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(deepLinkData)}`;

  // Traveler settings with sensible defaults so an unconfigured shop still
  // gets the full sheet. A missing flag → show it (opt-out model).
  const t = appSettings.traveler || {};
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
  const opRows = Math.min(16, Math.max(4, t.operationLogRows ?? 6));

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black/90 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="bg-white text-black w-full max-w-3xl mx-auto rounded-xl shadow-2xl relative flex flex-col my-4 mx-4 sm:mx-auto" style={{maxHeight:'calc(100dvh - 2rem)'}} onClick={e => e.stopPropagation()}>
        <div className="bg-zinc-900 text-white p-3 sm:p-4 flex justify-between items-center shrink-0 border-b border-zinc-700 sticky top-0 rounded-t-xl z-10">
          <div>
            <h3 className="font-bold flex items-center gap-2 text-base sm:text-lg"><Printer className="w-5 h-5 text-amber-500" /> Print Preview</h3>
            <p className="text-xs text-zinc-400 hidden sm:block">Review details before printing.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-2 text-zinc-400 hover:text-white text-sm font-medium">Cancel</button>
            <button onClick={() => { printTraveler(job, appSettings, { _rateBreakdown: rateBreakdown }).then(() => { if (onPrinted) onPrinted(job.id); }); }} className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 text-sm shadow shadow-amber-900/20 transition-all"><Printer className="w-4 h-4" /><span className="hidden sm:inline">Print </span>Traveler</button>
          </div>
        </div>
        <div id="printable-area" className="flex-1 p-4 sm:p-6 bg-white overflow-y-auto overflow-x-hidden">
          {/* Optional header banner above the company name — shops use this
              for notices like "ITAR Controlled" or "AS9100 Certified". */}
          {t.headerBanner && (
            <div className="bg-yellow-100 border-2 border-yellow-500 text-yellow-900 text-center font-black uppercase tracking-widest text-xs px-3 py-1.5 mb-3 rounded">
              {t.headerBanner}
            </div>
          )}
          <div className="flex justify-between items-center border-b-4 border-black pb-2 mb-4 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {show.logo && appSettings.companyLogo && (
                <img src={appSettings.companyLogo} alt="" className="traveler-logo h-12 object-contain shrink-0" />
              )}
              <div className="min-w-0">
                <h1 className="text-2xl sm:text-3xl font-black tracking-tighter truncate">{appSettings.companyName || 'SC DEBURRING'}</h1>
                <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mt-1">Production Traveler</p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <h2 className="text-lg font-bold">{new Date().toLocaleDateString()}</h2>
              <p className="text-xs text-gray-400">Printed On</p>
            </div>
          </div>

          <div className={`grid ${show.qr ? 'grid-cols-2' : 'grid-cols-1'} gap-4 mb-4`}>
            <div className="space-y-3 flex flex-col">
              <div className="border-4 border-black p-3">
                <label className="block text-xs uppercase font-bold text-gray-500 mb-1">PO Number</label>
                <div className={`print-po font-black leading-tight break-all ${job.poNumber.length > 15 ? 'text-2xl' : job.poNumber.length > 12 ? 'text-3xl' : job.poNumber.length > 8 ? 'text-4xl' : 'text-5xl'}`} style={{wordBreak:'break-all'}}>{job.poNumber}</div>
                {show.priority && job.priority && job.priority !== 'normal' && (
                  <div className={`inline-block mt-2 text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${job.priority === 'urgent' ? 'bg-red-600 text-white' : job.priority === 'high' ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-700'}`}>
                    {job.priority}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="border-2 border-gray-300 p-2"><label className="block text-xs uppercase font-bold text-gray-500 mb-1">Part #</label><div className={`print-field-lg font-black ${(job.partNumber||'').length > 16 ? 'text-sm' : (job.partNumber||'').length > 12 ? 'text-base' : (job.partNumber||'').length > 8 ? 'text-lg' : 'text-2xl'}`} style={{wordBreak:'break-all'}}>{job.partNumber}</div></div>
                <div className="border-2 border-gray-300 p-2"><label className="block text-xs uppercase font-bold text-gray-500 mb-1">Qty</label><div className="print-field-lg text-2xl font-black">{job.quantity || '—'}</div></div>
                <div className="border-2 border-gray-300 p-2"><label className="block text-xs uppercase font-bold text-gray-500 mb-1">Received</label><div className="print-field-md text-base font-bold">{job.dateReceived || '—'}</div></div>
                {show.dueDate && (
                  <div className="border-2 border-gray-300 p-2"><label className="block text-xs uppercase font-bold text-gray-500 mb-1">Due Date</label><div className="print-field-md text-base font-black text-red-600">{job.dueDate || '—'}</div></div>
                )}
                <div className="border-2 border-blue-400 bg-blue-50 p-2">
                  <label className="block text-xs uppercase font-bold text-blue-600 mb-1">Est. Time</label>
                  <div className="text-base font-black text-blue-700">
                    {(job.expectedHours || 0) > 0 ? `${job.expectedHours}h` : '—'}
                  </div>
                </div>
              </div>
              {show.customer && job.customer && (
                <div className="border-2 border-gray-300 p-2">
                  <label className="block text-xs uppercase font-bold text-gray-500 mb-1">Customer</label>
                  <div className="text-sm font-bold">{job.customer}</div>
                </div>
              )}
              {/* Part Photo — fits in the empty space below dates */}
              {show.photo && job.partImage && (
                <div className="border-2 border-gray-300 p-2 flex items-center gap-3">
                  <img src={job.partImage} alt="Part" className="print-part-photo object-contain" style={{maxWidth:'120px',maxHeight:'80px'}} />
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-gray-400">Reference</label>
                    <div className="text-xs font-bold text-gray-600">Part Photo</div>
                  </div>
                </div>
              )}
            </div>
            {show.qr && (
              <div className="flex flex-col items-center justify-center border-4 border-black p-4 bg-gray-50">
                <img src={qrUrl} alt="QR Code" className="print-qr-img w-full h-auto mix-blend-multiply max-w-[220px]" crossOrigin="anonymous" />
                <p className="font-mono text-xs mt-2 text-gray-500 text-center break-all">{job.id}</p>
                <p className="print-qr-label font-bold uppercase tracking-widest text-xl mt-1">SCAN JOB ID</p>
              </div>
            )}
          </div>

          {/* Special Instructions — always shown prominently if present */}
          {show.instructions && job.specialInstructions && (
            <div className="border-4 border-orange-500 bg-orange-50 p-3 mb-3">
              <label className="block text-xs uppercase font-black text-orange-700 mb-2 tracking-wider">⚠ Special Instructions</label>
              <div className="print-instr text-base font-bold text-gray-900 whitespace-pre-wrap">{job.specialInstructions}</div>
            </div>
          )}

          {/* General notes / part info */}
          {show.notes && job.info && (
            <div className="border-l-4 border-gray-400 pl-3 py-1 bg-gray-50">
              <label className="block text-xs uppercase font-bold text-gray-500 mb-1">Notes</label>
              <div className="print-notes text-sm text-gray-700 whitespace-pre-wrap">{job.info}</div>
            </div>
          )}

          {/* Operation Log — lines for operators to sign off each stage */}
          {show.operationLog && (
            <div className="mt-4">
              <label className="block text-xs uppercase font-black text-blue-700 mb-2 tracking-wider">Operation Log</label>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b-2 border-black">
                    <th className="text-left py-1.5 px-2 font-black">Operation</th>
                    <th className="text-left py-1.5 px-2 font-black">Operator</th>
                    <th className="text-left py-1.5 px-2 font-black">Start</th>
                    <th className="text-left py-1.5 px-2 font-black">End</th>
                    <th className="text-left py-1.5 px-2 font-black">Qty</th>
                    <th className="text-left py-1.5 px-2 font-black">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: opRows }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-300">
                      <td className="px-2" style={{ height: 26 }}></td>
                      <td className="px-2"></td>
                      <td className="px-2"></td>
                      <td className="px-2"></td>
                      <td className="px-2"></td>
                      <td className="px-2"></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Sign-off line — operator + inspector */}
          {show.signOff && (
            <div className="mt-6 grid grid-cols-2 gap-8 pt-4 border-t border-gray-300">
              <div>
                <div className="border-t border-black pt-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-500">Operator Sign-off</div>
              </div>
              <div>
                <div className="border-t border-black pt-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-500">Inspector Sign-off</div>
              </div>
            </div>
          )}

          {/* Custom footer — certifications, safety note, etc. */}
          {t.footerText && (
            <div className="mt-4 pt-3 border-t border-gray-200 text-center text-[10px] text-gray-500 whitespace-pre-wrap">
              {t.footerText}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- AVATAR ---
// Colorful gradient initials avatar — deterministic from name
const AVATAR_GRADIENTS = [
  'from-blue-600 to-indigo-500',
  'from-emerald-500 to-teal-500',
  'from-purple-600 to-pink-500',
  'from-orange-500 to-red-500',
  'from-cyan-500 to-blue-500',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-lime-500 to-emerald-500',
  'from-violet-600 to-purple-600',
  'from-sky-500 to-indigo-600',
];
const avatarHash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};
const avatarInitials = (name?: string) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};
export const Avatar = ({ name, size = 'md', className = '', ring = false, dot }: { name?: string; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; className?: string; ring?: boolean; dot?: 'live' | 'paused' | 'off' }) => {
  const gradient = AVATAR_GRADIENTS[avatarHash(name || 'User') % AVATAR_GRADIENTS.length];
  const sizeClasses: Record<string, string> = {
    xs: 'w-6 h-6 text-[10px]',
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base',
    xl: 'w-16 h-16 text-lg',
  };
  const dotColors: Record<string, string> = {
    live: 'bg-emerald-500 animate-pulse',
    paused: 'bg-yellow-500',
    off: 'bg-zinc-500',
  };
  return (
    <div className={`relative shrink-0 ${sizeClasses[size]} ${className}`} title={name || 'User'}>
      <div className={`w-full h-full rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-black tracking-tight shadow-lg shadow-black/20 ${ring ? 'ring-2 ring-white/10' : ''}`}>
        {avatarInitials(name)}
      </div>
      {dot && <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-zinc-900 ${dotColors[dot]}`} />}
    </div>
  );
};

// --- LOGIN ---
const LoginView = ({ onLogin, addToast }: { onLogin: (u: User) => void, addToast: any }) => {
  // Read ?u=<username> from URL — used by QR invite codes to pre-fill
  const initialUsername = (() => {
    try { return new URLSearchParams(window.location.search).get('u') || ''; } catch { return ''; }
  })();
  const [username, setUsername] = useState(initialUsername);
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginSettings, setLoginSettings] = useState<SystemSettings>(DB.getSettings());

  useEffect(() => {
    const unsub = DB.subscribeSettings(setLoginSettings);
    return unsub;
  }, []);

  const companyName = loginSettings.companyName || 'My Shop';
  const companyLogo = loginSettings.companyLogo;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await DB.loginUser(username, pin);
      if (user) {
        onLogin(user);
        addToast('success', `Welcome, ${user.name}`);
      } else {
        addToast('error', 'Invalid Credentials');
        setPin('');
      }
    } catch (e: any) {
      addToast('error', 'Login Error: ' + (e.message || 'Unknown'));
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-6">
      {/* subtle background texture */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-amber-950/20 via-zinc-950 to-zinc-950 pointer-events-none" />
      <div className="relative w-full max-w-sm">
        {/* Card */}
        <div className="bg-zinc-900/60 backdrop-blur-xl border border-white/8 p-8 rounded-3xl shadow-2xl shadow-black/60">
          {/* Logo / Icon */}
          <div className="flex justify-center mb-5">
            {companyLogo ? (
              <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/10 shadow-lg bg-white flex items-center justify-center">
                <img src={companyLogo} alt={companyName} className="w-full h-full object-contain" />
              </div>
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-orange-500 to-amber-400 flex items-center justify-center shadow-lg shadow-amber-900/30">
                <Sparkles className="w-8 h-8 text-white" />
              </div>
            )}
          </div>

          {/* Company + product name */}
          <h1 className="text-2xl font-semibold text-center text-white tracking-tight mb-0.5">{companyName}</h1>
          <p className="text-center text-zinc-500 text-xs mb-1 font-medium tracking-widest uppercase">FabTrack IO</p>
          <p className="text-center text-zinc-600 text-xs mb-7">Sign in to continue</p>

          <form onSubmit={handleLogin} className="space-y-3">
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:ring-2 focus:ring-amber-500 focus:border-amber-500/50 outline-none transition-all"
              placeholder="Username"
              autoFocus
            />
            <input
              type="password"
              value={pin}
              onChange={e => setPin(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:ring-2 focus:ring-amber-500 focus:border-amber-500/50 outline-none transition-all"
              placeholder="PIN"
            />
            <button
              disabled={loading}
              type="submit"
              className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white py-3.5 rounded-xl font-semibold tracking-wide transition-all shadow-lg shadow-amber-900/30 mt-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Verifying…' : 'Sign In →'}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-zinc-700 text-xs mt-5">Powered by <span className="text-zinc-500 font-medium">FabTrack IO</span></p>
      </div>
    </div>
  );
};

// ─── Shop Brain Panel ─────────────────────────────────────────────────────────
// Renders the insight cards generated by computeInsights().
// Kept in App.tsx so it can call setView() without extra prop-threading.
const INSIGHT_SEVERITY_CONFIG = {
  critical: { bg: 'bg-red-500/10',     border: 'border-red-500/30',     dot: 'bg-red-500',     label: 'Critical', labelCls: 'text-red-400'    },
  warning:  { bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   dot: 'bg-amber-400',   label: 'Watch',    labelCls: 'text-amber-400'  },
  info:     { bg: 'bg-blue-500/10',    border: 'border-blue-500/30',    dot: 'bg-blue-400',    label: 'Info',     labelCls: 'text-blue-400'   },
  positive: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', dot: 'bg-emerald-400', label: 'Win',      labelCls: 'text-emerald-400'},
} as const;

const INSIGHT_ICON: Record<string, React.ReactNode> = {
  underquoted:   <TrendingDown className="w-4 h-4" />,
  repeat_loss:   <RotateCcw    className="w-4 h-4" />,
  customer_risk: <AlertTriangle className="w-4 h-4" />,
  revenue_drop:  <TrendingDown  className="w-4 h-4" />,
  capacity_risk: <Clock         className="w-4 h-4" />,
  stale_job:     <Clock         className="w-4 h-4" />,
  great_customer:<Award         className="w-4 h-4" />,
  worker_anomaly:<AlertCircle   className="w-4 h-4" />,
  quote_gap:     <FileText      className="w-4 h-4" />,
  hero_part:     <Sparkles      className="w-4 h-4" />,
};

const ShopBrainPanel = ({ insights, setView }: { insights: ShopInsight[]; setView: (v: string) => void }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem('brain_dismissed') || '[]')); }
    catch { return new Set(); }
  });
  const visible = insights.filter(i => !dismissed.has(i.id));
  const critCount = visible.filter(i => i.severity === 'critical').length;
  const warnCount = visible.filter(i => i.severity === 'warning').length;
  const posCount  = visible.filter(i => i.severity === 'positive').length;

  const dismiss = (id: string) => {
    const next = new Set(dismissed); next.add(id);
    setDismissed(next);
    try { sessionStorage.setItem('brain_dismissed', JSON.stringify([...next])); } catch {}
  };

  if (visible.length === 0) return null;

  return (
    <div className="rounded-2xl border border-violet-500/25 bg-violet-500/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-violet-400" />
          </div>
          <div>
            <p className="text-sm font-black text-white tracking-tight flex items-center gap-2">
              Shop Brain
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
                {visible.length} insight{visible.length !== 1 ? 's' : ''}
              </span>
            </p>
            <p className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-2">
              {critCount > 0 && <span className="text-red-400 font-bold">{critCount} critical</span>}
              {warnCount > 0 && <span className="text-amber-400 font-bold">{warnCount} warning{warnCount > 1 ? 's' : ''}</span>}
              {posCount  > 0 && <span className="text-emerald-400 font-bold">{posCount} win{posCount > 1 ? 's' : ''}</span>}
              {critCount === 0 && warnCount === 0 && posCount === 0 && <span>Patterns detected</span>}
            </p>
          </div>
        </div>
        <button
          onClick={() => setCollapsed(v => !v)}
          className="text-zinc-500 hover:text-zinc-300 transition-colors p-1"
          title={collapsed ? 'Show insights' : 'Hide insights'}
        >
          {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
      </div>

      {/* Cards */}
      {!collapsed && (
        <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {visible.map(insight => {
            const cfg = INSIGHT_SEVERITY_CONFIG[insight.severity];
            const icon = INSIGHT_ICON[insight.type];
            return (
              <div
                key={insight.id}
                className={`relative rounded-xl border p-3 ${cfg.bg} ${cfg.border} group`}
              >
                <button
                  onClick={() => dismiss(insight.id)}
                  className="absolute top-2 right-2 text-zinc-600 hover:text-zinc-400 transition-colors opacity-0 group-hover:opacity-100"
                  title="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <div className="flex items-start gap-2.5 pr-5">
                  <div className={`mt-0.5 shrink-0 ${cfg.labelCls}`}>{icon}</div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`text-[9px] font-black uppercase tracking-widest ${cfg.labelCls}`}>{cfg.label}</span>
                    </div>
                    <p className="text-[12px] font-bold text-white leading-snug">{insight.title}</p>
                    <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">{insight.body}</p>
                    {insight.action && insight.actionView && (
                      <button
                        onClick={() => setView(insight.actionView!)}
                        className={`mt-2 text-[11px] font-bold flex items-center gap-1 ${cfg.labelCls} hover:opacity-80 transition-opacity`}
                      >
                        {insight.action} <ChevronRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// --- ADMIN DASHBOARD ---
const AdminDashboard = ({ user, confirmAction, setView, addToast }: any) => {
  const [activeLogs, setActiveLogs] = useState<TimeLog[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [allLogs, setAllLogs] = useState<TimeLog[]>([]);
  const [shopSettings, setShopSettings] = useState<SystemSettings>(DB.getSettings());
  const [dashWorkers, setDashWorkers] = useState<User[]>([]);
  const [reworkEntries, setReworkEntries] = useState<ReworkEntry[]>([]);
  const [dashAllPOs, setDashAllPOs] = useState<PurchaseOrder[]>([]);
  const [dashQuotes, setDashQuotes] = useState<Quote[]>([]);
  const [hoveredCustIdx, setHoveredCustIdx] = useState<number | null>(null);
  const [attentionDismissed, setAttentionDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem('attention_dismissed') === '1'; } catch { return false; }
  });
  const isMobile = useIsMobile();

  useEffect(() => {
    const unsub1 = DB.subscribeActiveLogs(setActiveLogs);
    const unsub2 = DB.subscribeJobs(setJobs);
    const unsub3 = DB.subscribeLogs(all => setLogs(all.filter(l => l.endTime).sort((a, b) => (b.endTime || 0) - (a.endTime || 0)).slice(0, 5)));
    const unsub4 = DB.subscribeLogs(setAllLogs);
    const unsub5 = DB.subscribeSettings(setShopSettings);
    const unsub6 = DB.subscribeUsers(setDashWorkers);
    const unsub7 = DB.subscribeRework(setReworkEntries);
    const unsub8 = DB.subscribePurchaseOrders(setDashAllPOs);
    const unsub9 = DB.subscribeQuotes(setDashQuotes);
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub6(); unsub7(); unsub8(); unsub9(); };
  }, []);

  const liveJobsCount = new Set(activeLogs.map(l => l.jobId)).size;
  const activeJobsCount = jobs.filter(j => j.status !== 'completed').length;
  const activeWorkersCount = new Set(activeLogs.map(l => l.userId)).size;
  const myActiveLog = activeLogs.find(l => l.userId === user.id);
  const myActiveJob = myActiveLog ? jobs.find(j => j.id === myActiveLog.jobId) : null;

  const today = todayFmt();
  const todayN = dateNum(today);
  const in3DaysN = dateNum(new Date(Date.now() + 3 * 86400000).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }));
  const overdueJobs = jobs.filter(j => j.status !== 'completed' && j.dueDate && dateNum(j.dueDate) < todayN);
  const dueSoonJobs = jobs.filter(j => j.status !== 'completed' && j.dueDate && dateNum(j.dueDate) >= todayN && dateNum(j.dueDate) <= in3DaysN);

  // ── Pipeline value — total quote $ across all open jobs
  const pipelineValue = jobs
    .filter(j => j.status !== 'completed' && (j.quoteAmount || 0) > 0)
    .reduce((a, j) => a + (j.quoteAmount || 0), 0);

  // ── On-time delivery rate (rolling 90 days of completed jobs with due dates)
  const ninetyDaysAgo = Date.now() - 90 * 86400000;
  const recentCompleted = jobs.filter(j =>
    j.status === 'completed' && j.completedAt && j.completedAt > ninetyDaysAgo && j.dueDate
  );
  const onTimeCount = recentCompleted.filter(j => {
    const dueD = parseDueDate(j.dueDate!);
    if (!dueD) return false;
    dueD.setHours(23, 59, 59, 999);
    return j.completedAt! <= dueD.getTime();
  }).length;
  const onTimePct = recentCompleted.length > 0
    ? Math.round((onTimeCount / recentCompleted.length) * 100)
    : null;

  const todayStartMs = new Date(); (todayStartMs as any).setHours(0,0,0,0); const todayMs = todayStartMs.getTime();

  // Workers who haven't logged any operations today
  const activeWorkers = (dashWorkers || []).filter((w: User) => w.isActive !== false && w.role !== 'admin');
  const workersWithLogsToday = new Set(allLogs.filter(l => l.startTime >= todayMs).map(l => l.userId));
  const workersNoScansToday = activeWorkers.filter((w: User) => !workersWithLogsToday.has(w.id) && !activeLogs.some(l => l.userId === w.id));
  // Completed logs today (fixed: use allLogs not the trimmed top-5 `logs`)
  const completedTodayMins = allLogs.filter(l => l.endTime && l.startTime >= todayMs).reduce((a, l) => a + (l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0)), 0);
  // Add time from still-running active logs that started today (subtract any paused time)
  const runningTodayMins = activeLogs.filter(l => l.startTime >= todayMs).reduce((a, l) => {
    const pausedMs = (l.totalPausedMs || 0) + (l.pausedAt ? Date.now() - l.pausedAt : 0);
    return a + Math.max(0, Date.now() - l.startTime - pausedMs) / 60000;
  }, 0);
  const todayHoursMins = Math.round(completedTodayMins + runningTodayMins);
  const todayHrsDisplay = todayHoursMins >= 60 ? `${Math.floor(todayHoursMins/60)}h ${Math.round(todayHoursMins%60)}m` : `${todayHoursMins}m`;

  // ── Shop Brain insights — memoized so they only recompute when data changes
  const shopInsights = useMemo(
    () => computeInsights(jobs, allLogs, dashWorkers, shopSettings, dashAllPOs),
    [jobs, allLogs, dashWorkers, shopSettings, dashAllPOs],
  );

  // ── Recent Activity Feed — chronological cross-module event log (72h window)
  const recentActivity = useMemo(() => {
    const WINDOW = 72 * 3600 * 1000;
    const cutoff = Date.now() - WINDOW;
    type FeedEvent = {
      id: string; ts: number; type: string;
      iconEl: React.ReactNode; iconCls: string;
      text: string; sub?: string;
      value?: string; valueCls?: string;
    };
    const events: FeedEvent[] = [];

    // ── Job completions
    jobs.filter(j => j.completedAt && j.completedAt > cutoff).forEach(j => {
      const m = j.profitSnapshot?.marginPct;
      events.push({
        id: `jd-${j.id}`, ts: j.completedAt!, type: 'job_done',
        iconEl: <CheckCircle className="w-3.5 h-3.5" />,
        iconCls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        text: `${j.jobIdsDisplay || j.id} complete`,
        sub: [j.partNumber, j.customer].filter(Boolean).join(' · '),
        value: m != null ? `${m >= 0 ? '+' : ''}${m.toFixed(0)}% margin` : undefined,
        valueCls: m != null ? (m >= 25 ? 'text-emerald-400' : m >= 0 ? 'text-amber-400' : 'text-red-400') : undefined,
      });
    });

    // ── New jobs (last 24 h only — don't flood with older backlog)
    const newCutoff = Date.now() - 24 * 3600000;
    jobs.filter(j => j.createdAt > newCutoff && j.status !== 'completed').forEach(j => {
      events.push({
        id: `jn-${j.id}`, ts: j.createdAt, type: 'job_new',
        iconEl: <Plus className="w-3.5 h-3.5" />,
        iconCls: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
        text: `New job ${j.jobIdsDisplay || j.id}`,
        sub: [j.partNumber, j.customer].filter(Boolean).join(' · '),
        value: j.quoteAmount ? `$${j.quoteAmount.toLocaleString()}` : undefined,
        valueCls: 'text-zinc-400',
      });
    });

    // ── Quote events
    dashQuotes.forEach(q => {
      if (q.acceptedAt && q.acceptedAt > cutoff) {
        events.push({
          id: `qa-${q.id}`, ts: q.acceptedAt, type: 'quote_accepted',
          iconEl: <CheckCircle className="w-3.5 h-3.5" />,
          iconCls: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
          text: `${q.quoteNumber} accepted`,
          sub: q.customer,
          value: `$${q.total.toLocaleString()}`,
          valueCls: 'text-emerald-400',
        });
      }
      if (q.declinedAt && q.declinedAt > cutoff) {
        events.push({
          id: `qd-${q.id}`, ts: q.declinedAt, type: 'quote_declined',
          iconEl: <X className="w-3.5 h-3.5" />,
          iconCls: 'bg-red-500/15 text-red-400 border-red-500/30',
          text: `${q.quoteNumber} declined`,
          sub: [q.customer, q.declineReason?.replace(/-/g, ' ')].filter(Boolean).join(' · '),
          value: `$${q.total.toLocaleString()}`,
          valueCls: 'text-red-400/60',
        });
      }
      if (q.sentAt && q.sentAt > cutoff && q.status === 'sent') {
        events.push({
          id: `qs-${q.id}`, ts: q.sentAt, type: 'quote_sent',
          iconEl: <FileText className="w-3.5 h-3.5" />,
          iconCls: 'bg-zinc-700/50 text-zinc-400 border-white/10',
          text: `${q.quoteNumber} sent to customer`,
          sub: q.customer,
          value: `$${q.total.toLocaleString()}`,
          valueCls: 'text-zinc-400',
        });
      }
    });

    // ── PO received
    dashAllPOs.filter(po => po.receivedDate && po.receivedDate > cutoff).forEach(po => {
      events.push({
        id: `por-${po.id}`, ts: po.receivedDate!, type: 'po_received',
        iconEl: <Package className="w-3.5 h-3.5" />,
        iconCls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        text: `${po.poNumber} received`,
        sub: po.vendorName,
        value: `$${po.total.toLocaleString()}`,
        valueCls: 'text-zinc-400',
      });
    });

    // ── Rework flagged
    reworkEntries.filter(r => r.createdAt > cutoff).forEach(r => {
      if (r.resolvedAt && r.resolvedAt > cutoff) {
        events.push({
          id: `rr-${r.id}`, ts: r.resolvedAt, type: 'rework_resolved',
          iconEl: <CheckCircle className="w-3.5 h-3.5" />,
          iconCls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
          text: 'Rework resolved',
          sub: [r.partNumber, r.customer].filter(Boolean).join(' · '),
        });
      } else {
        events.push({
          id: `ro-${r.id}`, ts: r.createdAt, type: 'rework_open',
          iconEl: <AlertTriangle className="w-3.5 h-3.5" />,
          iconCls: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
          text: 'Rework flagged',
          sub: [r.partNumber, r.customer].filter(Boolean).join(' · '),
          value: r.scrapCost ? `-$${r.scrapCost.toFixed(0)}` : undefined,
          valueCls: 'text-red-400',
        });
      }
    });

    // ── Recent worker sessions (last 8h, one per worker, ≥20 min)
    const eightHCutoff = Date.now() - 8 * 3600000;
    const seenW = new Set<string>();
    allLogs
      .filter(l => !l.isSample && l.endTime && l.endTime > eightHCutoff)
      .sort((a, b) => (b.endTime || 0) - (a.endTime || 0))
      .forEach(l => {
        if (seenW.size >= 3 || seenW.has(l.userId)) return;
        const durMins = l.durationSeconds != null ? l.durationSeconds / 60 : (l.durationMinutes || 0);
        if (durMins < 20) return;
        seenW.add(l.userId);
        const job = jobs.find(j => j.id === l.jobId);
        events.push({
          id: `ws-${l.id}`, ts: l.endTime!, type: 'worker_session',
          iconEl: <Clock className="w-3.5 h-3.5" />,
          iconCls: 'bg-zinc-700/40 text-zinc-500 border-white/8',
          text: `${l.userName.split(' ')[0]} clocked out`,
          sub: [l.operation, job?.partNumber || l.partNumber].filter(Boolean).join(' · '),
          value: `${(durMins / 60).toFixed(1)}h`,
          valueCls: 'text-zinc-400',
        });
      });

    return events.sort((a, b) => b.ts - a.ts).slice(0, 18);
  }, [jobs, allLogs, dashQuotes, dashAllPOs, reworkEntries]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-black text-white flex items-center gap-2.5 tracking-tight"><LayoutDashboard className="w-7 h-7 text-amber-500" aria-hidden="true" /> <span>Overview</span></h1>
          <p className="text-zinc-500 text-sm mt-1">Real-time shop floor status &amp; financials</p>
        </div>
        <div className="text-right hidden sm:block">
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Today</p>
          <p className="text-sm text-zinc-300 font-semibold">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
        </div>
      </div>

      {myActiveLog && (
        <ActiveJobPanel job={myActiveJob || null} log={myActiveLog}
          onStop={async id => {
            try { await DB.stopTimeLog(id, undefined, undefined, undefined, 'manual'); addToast('success', 'Timer Stopped'); }
            catch (e) { addToast('error', 'Failed to stop'); throw e; }
          }}
          onPause={async (id) => { try { await DB.pauseTimeLog(id, 'manual'); addToast('info', 'Timer Paused'); } catch { addToast('error', 'Failed to pause'); } }}
          onResume={async (id) => { try { await DB.resumeTimeLog(id); addToast('success', 'Timer Resumed'); } catch { addToast('error', 'Failed to resume'); } }}
        />
      )}

      {/* ── Needs Attention — aggregated smart banner ── */}
      {!attentionDismissed && (() => {
        const openRework = reworkEntries.filter(r => r.status !== 'resolved').length;
        const missingQuotes = jobs.filter(j => j.status === 'completed' && !(j.quoteAmount && j.quoteAmount > 0)).length;
        const longRunning = activeLogs.filter(l => l.startTime < Date.now() - 4 * 3600000).length;

        // Brain: stale jobs
        const STALE_MS = 48 * 3600000;
        const now = Date.now();
        const lastLogMs = new Map<string, number>();
        allLogs.forEach(l => { if (l.endTime && l.endTime > (lastLogMs.get(l.jobId) || 0)) lastLogMs.set(l.jobId, l.endTime); });
        const staleCount = jobs.filter(j => j.status !== 'completed' && j.status !== 'hold').filter(j => {
          const last = lastLogMs.get(j.id) || 0;
          return (now - j.createdAt) > STALE_MS && (now - last) > STALE_MS;
        }).length;

        // Brain: over-budget active jobs
        const rate = shopSettings.shopRate || 0;
        const overBudgetCount = rate > 0 ? jobs.filter(j => j.status !== 'completed' && j.quoteAmount && j.quoteAmount > 0).filter(j => {
          const mins = allLogs.filter(l => l.jobId === j.id).reduce((a, l) => a + (l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0)), 0);
          return (mins / 60) * rate > j.quoteAmount!;
        }).length : 0;

        // Brain: ETA / capacity forecast — compute inline for the dashboard
        const openJobs = jobs.filter(j => j.status !== 'completed');
        const dashEtaMap = new Map<string, ReturnType<typeof computeJobETA>>();
        for (const job of openJobs) {
          const history = getPartHistory(job.partNumber || '', jobs, allLogs);
          dashEtaMap.set(job.id, computeJobETA(job, allLogs, activeLogs, history, DB.getWorkingElapsedMs));
        }
        const workerCount = Math.max(1, dashWorkers.filter(w => w.isActive !== false).length || activeLogs.length || 1);
        const activeWorkerCount = new Set(activeLogs.map(l => l.userId)).size;
        const dashForecast = computeCapacityForecast(dashEtaMap, workerCount, activeWorkerCount);
        const etaCriticalCount = [...dashEtaMap.values()].filter(e => e.riskLevel === 'critical' && !overdueJobs.find(j => j.id === e.jobId)).length;
        const etaAtRiskCount = dashForecast.jobsAtRisk;

        // Customer duplicate detection — same normalizer as SettingsView.
        // Track UNIQUE original names per key (not job counts). After a
        // merge all jobs share one canonical name so the set size drops to 1
        // and the warning correctly disappears.
        const DUP_SUFFIXES = /\b(inc|incorporated|corp|corporation|co|company|llc|ltd|limited|lp|llp|pllc|gmbh|plc|sa|ag|nv|bv|pty|oy|aero|aerospace|industries|industry|group|holdings|services|solutions|machining|manufacturing|mfg|products|intl|international)\b/gi;
        const normCust = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/\([^)]*\)/g, '').replace(DUP_SUFFIXES, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length > 1).slice(0, 2).join('');
        const custMap = new Map<string, Set<string>>();
        jobs.forEach(j => {
          const c = (j.customer || '').trim();
          if (!c) return;
          const key = normCust(c);
          if (!key) return;
          if (!custMap.has(key)) custMap.set(key, new Set());
          custMap.get(key)!.add(c);
        });
        const dupGroupCount = [...custMap.values()].filter(v => v.size > 1).length;

        const items: { label: string; count: number; color: string; icon: any; onClick: () => void }[] = [];
        if (overdueJobs.length > 0) items.push({ label: `${overdueJobs.length} overdue job${overdueJobs.length > 1 ? 's' : ''}`, count: overdueJobs.length, color: '#ef4444', icon: AlertTriangle, onClick: () => setView('admin-jobs') });
        if (dueSoonJobs.length > 0) items.push({ label: `${dueSoonJobs.length} due in 3 days`, count: dueSoonJobs.length, color: '#f97316', icon: Clock, onClick: () => setView('admin-jobs') });
        if (openRework > 0) items.push({ label: `${openRework} open rework issue${openRework > 1 ? 's' : ''}`, count: openRework, color: '#f59e0b', icon: AlertTriangle, onClick: () => setView('admin-quality') });
        if (longRunning > 0) items.push({ label: `${longRunning} timer${longRunning > 1 ? 's' : ''} running > 4h`, count: longRunning, color: '#eab308', icon: Clock, onClick: () => setView('admin-live') });
        if (workersNoScansToday.length > 0 && new Date().getHours() >= 8) items.push({ label: `${workersNoScansToday.length} worker${workersNoScansToday.length > 1 ? 's' : ''} no scan today`, count: workersNoScansToday.length, color: '#facc15', icon: Users, onClick: () => setView('admin-live') });
        if (dupGroupCount > 0) items.push({ label: `${dupGroupCount} possible customer duplicate${dupGroupCount > 1 ? 's' : ''}`, count: dupGroupCount, color: '#a855f7', icon: Users, onClick: () => setView('admin-settings') });
        if (missingQuotes > 0 && missingQuotes >= 5) items.push({ label: `${missingQuotes} completed jobs missing quote`, count: missingQuotes, color: '#3b82f6', icon: FileText, onClick: () => setView('admin-jobs') });
        if (overBudgetCount > 0) items.push({ label: `${overBudgetCount} job${overBudgetCount > 1 ? 's' : ''} over budget`, count: overBudgetCount, color: '#ef4444', icon: AlertTriangle, onClick: () => setView('admin-jobs') });
        if (staleCount > 0) items.push({ label: `${staleCount} stale job${staleCount > 1 ? 's' : ''} — no activity 48h+`, count: staleCount, color: '#71717a', icon: Clock, onClick: () => setView('admin-jobs') });
        if (etaAtRiskCount > 0) items.push({ label: `${etaAtRiskCount} job${etaAtRiskCount > 1 ? 's' : ''} behind pace`, count: etaAtRiskCount, color: '#f97316', icon: AlertTriangle, onClick: () => setView('admin-jobs') });
        if (dashForecast.overloaded) items.push({ label: `Shop ${Math.round(dashForecast.capacityPct)}% loaded this week`, count: 1, color: '#ef4444', icon: AlertTriangle, onClick: () => setView('admin-jobs') });
        else if (dashForecast.capacityPct > 75 && dashForecast.totalRemainingHours > 0) items.push({ label: `Capacity at ${Math.round(dashForecast.capacityPct)}% this week`, count: 1, color: '#f59e0b', icon: Clock, onClick: () => setView('admin-jobs') });
        // Due-date clustering — multiple jobs sharing the same due date
        const dueDateMap = new Map<string, number>();
        jobs.filter(j => j.status !== 'completed' && j.dueDate).forEach(j => dueDateMap.set(j.dueDate!, (dueDateMap.get(j.dueDate!) || 0) + 1));
        const clusteredDates = [...dueDateMap.entries()].filter(([, n]) => n >= 3);
        if (clusteredDates.length > 0) {
          const worst = clusteredDates.sort((a, b) => b[1] - a[1])[0];
          items.push({ label: `${worst[1]} jobs all due ${worst[0]}`, count: worst[1], color: '#a78bfa', icon: Calendar, onClick: () => setView('admin-jobs') });
        }
        // Rush jobs — created with < 5 days lead time
        const rushCount = jobs.filter(j => { if (j.status === 'completed' || !j.dueDate || !j.createdAt) return false; const dueD = parseDueDate(j.dueDate); if (!dueD) return false; dueD.setHours(23,59,59,999); return (dueD.getTime() - j.createdAt) / 86400000 <= 5; }).length;
        if (rushCount > 0) items.push({ label: `${rushCount} rush job${rushCount > 1 ? 's' : ''} — short lead time`, count: rushCount, color: '#f87171', icon: Zap, onClick: () => setView('admin-jobs') });

        if (items.length === 0) return null;
        return (
          <div className="relative bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-red-500/10 border border-amber-500/25 rounded-2xl p-4 overflow-hidden">
            <div aria-hidden="true" className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-amber-500/60 to-transparent" />
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-amber-400" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-white tracking-tight">Needs Attention</p>
                  <p className="text-[11px] text-amber-200/70 mt-0.5">{items.length} thing{items.length !== 1 ? 's' : ''} to look at right now</p>
                  <div className="flex flex-wrap gap-2 mt-2.5">
                    {items.map((it, i) => {
                      const Icon = it.icon;
                      return (
                        <button
                          key={i}
                          onClick={it.onClick}
                          className="group flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all hover:scale-[1.02] active:scale-[0.98]"
                          style={{ background: `${it.color}15`, borderColor: `${it.color}40`, color: it.color }}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span className="text-xs font-bold">{it.label}</span>
                          <ChevronRight className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" aria-hidden="true" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <button
                aria-label="Dismiss attention banner for this session"
                onClick={() => { setAttentionDismissed(true); try { sessionStorage.setItem('attention_dismissed', '1'); } catch {} }}
                className="shrink-0 p-1.5 rounded-lg text-amber-400/60 hover:text-amber-400 hover:bg-white/5 transition-colors"
                title="Dismiss until next session"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        );
      })()}

      <div className="stagger grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 sm:gap-4">
        {/* Live Activity */}
        <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 p-3 sm:p-5 rounded-2xl flex justify-between items-center gap-2 overflow-hidden">
          <div className="min-w-0"><p className="text-zinc-500 text-[10px] sm:text-xs font-bold uppercase tracking-wider truncate">Live</p><h3 className="text-xl sm:text-2xl font-black text-white">{liveJobsCount}</h3><p className="text-[10px] text-emerald-400 mt-0.5 truncate">Jobs running</p></div>
          <Activity className={`w-7 h-7 sm:w-8 sm:h-8 text-emerald-500 shrink-0 ${liveJobsCount > 0 ? 'animate-pulse' : 'opacity-20'}`} />
        </div>
        {/* Open Jobs */}
        <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 p-3 sm:p-5 rounded-2xl flex justify-between items-center gap-2 overflow-hidden">
          <div className="min-w-0"><p className="text-zinc-500 text-[10px] sm:text-xs font-bold uppercase tracking-wider truncate">Open Jobs</p><h3 className="text-xl sm:text-2xl font-black text-white">{activeJobsCount}</h3><p className="text-[10px] text-zinc-500 mt-0.5 truncate">In progress</p></div>
          <Briefcase className="text-zinc-600 w-7 h-7 sm:w-8 sm:h-8 shrink-0" />
        </div>
        {/* Overdue */}
        <div className={`card-shine hover-lift-glow p-3 sm:p-5 rounded-2xl flex justify-between items-center gap-2 overflow-hidden border ${overdueJobs.length > 0 ? 'bg-red-500/10 border-red-500/30 shadow-lg shadow-red-900/10' : 'bg-zinc-900/50 border-white/5'}`}>
          <div className="min-w-0"><p className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider truncate ${overdueJobs.length > 0 ? 'text-red-400' : 'text-zinc-500'}`}>Overdue</p><h3 className={`text-xl sm:text-2xl font-black ${overdueJobs.length > 0 ? 'text-red-400' : 'text-zinc-600'}`}>{overdueJobs.length}</h3><p className={`text-[10px] mt-0.5 truncate ${overdueJobs.length > 0 ? 'text-red-400/70' : 'text-zinc-600'}`}>Past due</p></div>
          <AlertTriangle className={`w-7 h-7 sm:w-8 sm:h-8 shrink-0 ${overdueJobs.length > 0 ? 'text-red-500' : 'text-zinc-700'}`} />
        </div>
        {/* Floor Staff */}
        <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 p-3 sm:p-5 rounded-2xl flex justify-between items-center gap-2 overflow-hidden">
          <div className="min-w-0"><p className="text-zinc-500 text-[10px] sm:text-xs font-bold uppercase tracking-wider truncate">Floor Staff</p><h3 className="text-xl sm:text-2xl font-black text-white">{activeWorkersCount}</h3><p className="text-[10px] text-zinc-500 mt-0.5 truncate">Clocked in</p></div>
          <Users className="text-emerald-500 w-7 h-7 sm:w-8 sm:h-8 shrink-0" />
        </div>
        {/* Today's hours */}
        <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 p-3 sm:p-5 rounded-2xl flex justify-between items-center gap-2 overflow-hidden">
          <div className="min-w-0"><p className="text-zinc-500 text-[10px] sm:text-xs font-bold uppercase tracking-wider truncate">Today</p><h3 className="text-lg sm:text-xl font-black text-white truncate">{todayHrsDisplay}</h3><p className="text-[10px] text-zinc-500 mt-0.5 truncate">Hours logged</p></div>
          <Clock className="text-blue-400 w-7 h-7 sm:w-8 sm:h-8 opacity-60 shrink-0" />
        </div>
        {/* Pipeline value */}
        <div className={`card-shine hover-lift-glow p-3 sm:p-5 rounded-2xl flex justify-between items-center gap-2 overflow-hidden border ${pipelineValue > 0 ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-zinc-900/50 border-white/5'}`}>
          <div className="min-w-0">
            <p className="text-zinc-500 text-[10px] sm:text-xs font-bold uppercase tracking-wider truncate">Pipeline</p>
            <h3 className={`text-lg sm:text-xl font-black truncate ${pipelineValue > 0 ? 'text-emerald-400' : 'text-zinc-600'}`}>
              {pipelineValue > 0 ? `$${pipelineValue >= 1000 ? (pipelineValue / 1000).toFixed(1) + 'k' : pipelineValue.toFixed(0)}` : '—'}
            </h3>
            <p className="text-[10px] text-zinc-500 mt-0.5 truncate">Open order value</p>
          </div>
          <DollarSign className={`w-7 h-7 sm:w-8 sm:h-8 shrink-0 ${pipelineValue > 0 ? 'text-emerald-500' : 'text-zinc-700'}`} />
        </div>
        {/* On-time rate */}
        <div className={`card-shine hover-lift-glow p-3 sm:p-5 rounded-2xl flex justify-between items-center gap-2 overflow-hidden border ${onTimePct === null ? 'bg-zinc-900/50 border-white/5' : onTimePct >= 90 ? 'bg-emerald-500/5 border-emerald-500/20' : onTimePct >= 70 ? 'bg-amber-500/5 border-amber-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
          <div className="min-w-0">
            <p className="text-zinc-500 text-[10px] sm:text-xs font-bold uppercase tracking-wider truncate">On-Time</p>
            <h3 className={`text-lg sm:text-xl font-black truncate ${onTimePct === null ? 'text-zinc-600' : onTimePct >= 90 ? 'text-emerald-400' : onTimePct >= 70 ? 'text-amber-400' : 'text-red-400'}`}>
              {onTimePct === null ? '—' : `${onTimePct}%`}
            </h3>
            <p className="text-[10px] text-zinc-500 mt-0.5 truncate">90-day delivery</p>
          </div>
          <CheckCircle className={`w-7 h-7 sm:w-8 sm:h-8 shrink-0 ${onTimePct === null ? 'text-zinc-700' : onTimePct >= 90 ? 'text-emerald-500' : onTimePct >= 70 ? 'text-amber-400' : 'text-red-400'}`} />
        </div>
      </div>

      {/* ── TODAY'S PULSE — what happened today + who's working ── */}
      {(() => {
        const now2 = Date.now();
        const dayStart = new Date(); dayStart.setHours(0,0,0,0);
        const dayStartMs = dayStart.getTime();

        // Jobs completed today
        const completedToday = jobs.filter(j => j.status === 'completed' && j.completedAt && j.completedAt >= dayStartMs)
          .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
        const revenueToday = completedToday.reduce((s, j) => s + (j.quoteAmount || 0), 0);

        // Jobs completed in the last 7 days (for "recent wins" feed when today is quiet)
        const week7Start = now2 - 7 * 86400000;
        const recentWins = jobs.filter(j => j.status === 'completed' && j.completedAt && j.completedAt >= week7Start)
          .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
          .slice(0, 5);

        // Worker pulse — clocked-in workers with their active job + elapsed time
        const workerPulse = activeLogs.map(log => {
          const worker = dashWorkers.find(w => w.id === log.userId);
          const job = jobs.find(j => j.id === log.jobId);
          const pausedMs = (log.totalPausedMs || 0) + (log.pausedAt ? now2 - log.pausedAt : 0);
          const elapsedMs = Math.max(0, now2 - log.startTime - pausedMs);
          const elapsedMin = Math.round(elapsedMs / 60000);
          const elapsed = elapsedMin >= 60
            ? `${Math.floor(elapsedMin / 60)}h ${elapsedMin % 60}m`
            : `${elapsedMin}m`;
          return {
            name: worker?.name || log.userName || 'Unknown',
            job: job?.poNumber || log.jobId,
            operation: log.operation || '',
            elapsed,
            elapsedMin,
            paused: !!log.pausedAt,
          };
        }).sort((a, b) => b.elapsedMin - a.elapsedMin);

        const hasActivity = completedToday.length > 0 || workerPulse.length > 0;
        if (!hasActivity && recentWins.length === 0) return null;

        const GRADE_DOT: Record<string, string> = {
          great: 'bg-emerald-400', good: 'bg-blue-400', tight: 'bg-yellow-400', loss: 'bg-red-400',
        };
        const getGrade = (j: Job) => {
          if (j.profitSnapshot) {
            const m = j.profitSnapshot.marginPct;
            return m >= 35 ? 'great' : m >= 15 ? 'good' : m >= 0 ? 'tight' : 'loss';
          }
          return null;
        };

        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">

            {/* ── Today's completions ── */}
            <div className="card-shine bg-zinc-900/50 border border-white/5 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Today's Wins</p>
                  {completedToday.length > 0
                    ? <p className="text-xs text-zinc-400 mt-0.5">{completedToday.length} job{completedToday.length !== 1 ? 's' : ''} · <span className="text-emerald-400 font-bold">{revenueToday >= 1000 ? `$${(revenueToday/1000).toFixed(1)}k` : `$${revenueToday.toFixed(0)}`} revenue</span></p>
                    : <p className="text-xs text-zinc-600 mt-0.5">No completions yet — let's get one done</p>
                  }
                </div>
                <CheckCircle className={`w-5 h-5 shrink-0 ${completedToday.length > 0 ? 'text-emerald-400' : 'text-zinc-700'}`} />
              </div>

              {completedToday.length > 0 ? (
                <div className="space-y-1.5">
                  {completedToday.slice(0, 5).map(j => {
                    const grade = getGrade(j);
                    const minsAgo = Math.round((now2 - (j.completedAt || now2)) / 60000);
                    const timeAgo = minsAgo < 60 ? `${minsAgo}m ago` : `${Math.floor(minsAgo/60)}h ago`;
                    return (
                      <div key={j.id} className="flex items-center justify-between gap-2 py-1 border-b border-white/[0.04] last:border-0">
                        <div className="flex items-center gap-2 min-w-0">
                          {grade && <span className={`w-2 h-2 rounded-full shrink-0 ${GRADE_DOT[grade]}`} />}
                          <span className="text-sm font-bold text-white truncate">{j.poNumber}</span>
                          {j.customer && <span className="text-xs text-zinc-500 truncate hidden sm:inline">{j.customer}</span>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {j.quoteAmount && j.quoteAmount > 0 && (
                            <span className="text-xs font-mono text-emerald-400 font-bold">
                              ${j.quoteAmount >= 1000 ? (j.quoteAmount/1000).toFixed(1)+'k' : j.quoteAmount.toFixed(0)}
                            </span>
                          )}
                          <span className="text-[10px] text-zinc-600">{timeAgo}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : recentWins.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] text-zinc-600 mb-2">Recent (7 days)</p>
                  {recentWins.map(j => {
                    const grade = getGrade(j);
                    const daysAgo = Math.round((now2 - (j.completedAt || now2)) / 86400000);
                    return (
                      <div key={j.id} className="flex items-center justify-between gap-2 py-1 border-b border-white/[0.04] last:border-0">
                        <div className="flex items-center gap-2 min-w-0">
                          {grade && <span className={`w-2 h-2 rounded-full shrink-0 ${GRADE_DOT[grade]}`} />}
                          <span className="text-sm font-bold text-white truncate">{j.poNumber}</span>
                          {j.customer && <span className="text-xs text-zinc-500 truncate hidden sm:inline">{j.customer}</span>}
                        </div>
                        <span className="text-[10px] text-zinc-600 shrink-0">{daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo}d ago`}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-4 text-zinc-700 text-xs">No jobs completed this week yet</div>
              )}
            </div>

            {/* ── Worker pulse ── */}
            <div className="card-shine bg-zinc-900/50 border border-white/5 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Who's Working</p>
                  {workerPulse.length > 0
                    ? <p className="text-xs text-zinc-400 mt-0.5">{workerPulse.length} worker{workerPulse.length !== 1 ? 's' : ''} active right now</p>
                    : <p className="text-xs text-zinc-600 mt-0.5">Nobody clocked in yet</p>
                  }
                </div>
                <Users className={`w-5 h-5 shrink-0 ${workerPulse.length > 0 ? 'text-emerald-400' : 'text-zinc-700'}`} />
              </div>

              {workerPulse.length > 0 ? (
                <div className="space-y-2">
                  {workerPulse.map((w, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className={`relative w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 ${w.paused ? 'bg-zinc-700 text-zinc-400' : 'bg-emerald-500/20 text-emerald-300'}`}>
                        {w.name.charAt(0).toUpperCase()}
                        {!w.paused && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border border-zinc-900" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-white truncate">{w.name}</span>
                          {w.paused && <span className="text-[9px] font-black text-zinc-500 uppercase tracking-wider">paused</span>}
                        </div>
                        <p className="text-[11px] text-zinc-500 truncate">
                          {w.job}
                          {w.operation && <span className="text-zinc-600"> · {w.operation}</span>}
                        </p>
                      </div>
                      <span className={`text-xs font-mono font-bold shrink-0 tabular ${w.paused ? 'text-zinc-600' : w.elapsedMin > 240 ? 'text-amber-400' : 'text-zinc-400'}`}>
                        {w.elapsed}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Show workers available even when none are clocked in */}
                  {activeWorkers.slice(0, 4).map((w, i) => (
                    <div key={i} className="flex items-center gap-3 opacity-40">
                      <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center text-[11px] font-black text-zinc-500 shrink-0">
                        {w.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm text-zinc-600 truncate">{w.name}</span>
                      <span className="text-[10px] text-zinc-700 ml-auto">offline</span>
                    </div>
                  ))}
                  {activeWorkers.length === 0 && (
                    <div className="text-center py-4 text-zinc-700 text-xs">No workers configured yet</div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── WEEKLY CAPACITY FORECAST — ETA engine output ── */}
      {(() => {
        // Only show when we have real data (at least one job with expected hours or part history)
        const openJobsForCap = jobs.filter(j => j.status !== 'completed');
        if (openJobsForCap.length === 0) return null;
        const dashEtaMap2 = new Map<string, ReturnType<typeof computeJobETA>>();
        for (const job of openJobsForCap) {
          const history = getPartHistory(job.partNumber || '', jobs, allLogs);
          dashEtaMap2.set(job.id, computeJobETA(job, allLogs, activeLogs, history, DB.getWorkingElapsedMs));
        }
        const workerCount2 = Math.max(1, dashWorkers.filter(w => w.isActive !== false).length || activeLogs.length || 1);
        const activeCount2 = new Set(activeLogs.map(l => l.userId)).size;
        const fc = computeCapacityForecast(dashEtaMap2, workerCount2, activeCount2);
        if (fc.totalRemainingHours === 0) return null; // nothing to forecast

        const barPct = Math.min(100, fc.capacityPct);
        const barColor = fc.overloaded ? '#ef4444' : fc.capacityPct > 75 ? '#f97316' : '#10b981';
        const statusLabel = fc.overloaded
          ? `Overloaded — ${Math.round(fc.capacityPct - 100)}% more work than capacity`
          : fc.capacityPct > 75
          ? `Heavy — ${Math.round(fc.capacityPct)}% of weekly capacity`
          : `On track — ${Math.round(fc.capacityPct)}% of weekly capacity`;

        return (
          <div className="card-shine bg-zinc-900/50 border border-white/5 rounded-2xl p-3 sm:p-4">
            <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Weekly Capacity</span>
                <span className={`text-[10px] font-black px-1.5 py-0.5 rounded border ${fc.overloaded ? 'text-red-400 bg-red-500/10 border-red-500/30' : fc.capacityPct > 75 ? 'text-orange-400 bg-orange-500/10 border-orange-500/30' : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'}`}>
                  {statusLabel}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                <span><span className="font-black text-white">{fc.totalRemainingHours.toFixed(0)}h</span> remaining</span>
                <span>·</span>
                <span><span className="font-black text-white">{fc.weeklyCapacityHours.toFixed(0)}h</span> capacity ({fc.workdaysLeft}d left)</span>
                {fc.jobsCritical > 0 && <><span>·</span><span className="font-black text-red-400">{fc.jobsCritical} critical</span></>}
                {fc.jobsAtRisk > 0 && <><span>·</span><span className="font-black text-orange-400">{fc.jobsAtRisk} at-risk</span></>}
              </div>
            </div>
            <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${barPct}%`, background: barColor }}
              />
            </div>
          </div>
        );
      })()}

      {/* ── SHOP BRAIN — intelligent pattern detection ── */}
      {shopInsights.length > 0 && (
        <ShopBrainPanel insights={shopInsights} setView={setView} />
      )}

      {/* ── SHOP FLOW MAP — visual of jobs moving through each stage.
          Two-column layout on desktop: the scrollable flow on the left (fills
          its container), a health-summary panel on the right. On mobile the
          panel stacks below so nothing gets squeezed. Eliminates the "empty
          space on the right" issue when only a few stages are configured. */}
      <div className="card-shine hover-lift-glow bg-gradient-to-br from-zinc-900/60 to-zinc-900/30 border border-white/5 rounded-2xl p-4 sm:p-5 overflow-hidden">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div>
            <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" /> Shop Flow Map
            </h3>
            <p className="text-[11px] text-zinc-600 mt-0.5">Tap a stage for jobs inside · glowing = workers on it · flame = stuck</p>
          </div>
        </div>
        {(() => {
          const stages = getStages(shopSettings);
          const openJobs = jobs.filter(j => j.status !== 'completed');
          // ── Single source of truth — same metrics the Flow Map renders.
          //    Previously this block had its own stuck-job math + simplistic
          //    label-string matching for "live stages", which gave numbers
          //    that disagreed with the Flow Map below it. Now identical. ──
          const metrics = computeStageMetrics(jobs, stages);
          const stuckCount = [...metrics.values()].reduce((a, m) => a + m.stuckCount, 0);
          // Live stages = unique stages where a worker is currently clocked in,
          // matched via the same smart routing (acronyms, stems, token overlap).
          const liveStageSet = new Set<string>();
          for (const log of activeLogs) {
            const match = findStageForOperation(log.operation, stages);
            if (match && !match.isComplete) liveStageSet.add(match.id);
          }
          const liveStages = liveStageSet.size;
          // Bottleneck — stage with the most open jobs, using resolveJobStage
          // so legacy jobs (no currentStage field) land in the right column.
          const byStageCount = new Map<string, number>();
          for (const j of openJobs) {
            const resolved = resolveJobStage(j, stages);
            if (!resolved || resolved.isComplete) continue;
            byStageCount.set(resolved.id, (byStageCount.get(resolved.id) || 0) + 1);
          }
          let topStage: { label: string; count: number; color: string } | null = null;
          byStageCount.forEach((count, sid) => {
            const st = stages.find(s => s.id === sid);
            if (!st || st.isComplete) return;
            if (!topStage || count > topStage.count) {
              topStage = { label: st.label, count, color: st.color };
            }
          });
          return (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-4">
              {/* LEFT — flow + recent moves fill the main column */}
              <div className="min-w-0">
                <ShopFlowMap jobs={jobs} stages={stages} activeLogs={activeLogs} />
                <RecentStageMoves jobs={jobs} stages={stages} limit={8} />
              </div>
              {/* RIGHT — summary panel, keeps the card visually balanced */}
              <div className="grid grid-cols-2 lg:grid-cols-1 gap-2 lg:gap-2 lg:border-l lg:border-white/5 lg:pl-4">
                <div className="bg-zinc-950/40 border border-white/5 rounded-xl p-2.5">
                  <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Open Jobs</p>
                  <p className="text-xl lg:text-2xl font-black text-white tabular">{openJobs.length}</p>
                </div>
                <div className={`bg-zinc-950/40 border rounded-xl p-2.5 ${stuckCount > 0 ? 'border-red-500/30' : 'border-white/5'}`}>
                  <p className={`text-[9px] font-black uppercase tracking-widest ${stuckCount > 0 ? 'text-red-400' : 'text-zinc-600'}`}>Stuck 3d+</p>
                  <p className={`text-xl lg:text-2xl font-black tabular ${stuckCount > 0 ? 'text-red-400' : 'text-zinc-500'}`}>{stuckCount}</p>
                </div>
                <div className="bg-zinc-950/40 border border-white/5 rounded-xl p-2.5">
                  <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Live Stages</p>
                  <p className="text-xl lg:text-2xl font-black text-emerald-400 tabular flex items-center gap-1">
                    {liveStages > 0 && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                    {liveStages}
                  </p>
                </div>
                {topStage && (
                  <div className="bg-zinc-950/40 border border-white/5 rounded-xl p-2.5 min-w-0">
                    <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Heaviest</p>
                    <p className="text-xs font-black truncate" style={{ color: (topStage as any).color }}>{(topStage as any).label}</p>
                    <p className="text-[10px] text-zinc-500 tabular">{(topStage as any).count} job{(topStage as any).count !== 1 ? 's' : ''}</p>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── FINANCIAL OVERVIEW ── */}
      {(shopSettings.shopRate || 0) > 0 && (() => {
        const rate = shopSettings.shopRate || 0;
        const ohRate = (shopSettings.monthlyOverhead || 0) / (shopSettings.monthlyWorkHours || 160);
        const completedJobs = jobs.filter(j => j.status === 'completed');
        const thisMonthStart = new Date(); thisMonthStart.setDate(1); thisMonthStart.setHours(0,0,0,0);
        const thisWeekStart = new Date(); thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay()); thisWeekStart.setHours(0,0,0,0);

        const calcJobFinancials = (j: any) => {
          const jLogs = allLogs.filter(l => l.jobId === j.id && l.endTime);
          const _lm = (l: any) => l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0);
          const hrs = jLogs.reduce((a: number, l: any) => a + _lm(l), 0) / 60;
          const laborCost = jLogs.reduce((acc: number, l: any) => {
            const w = dashWorkers.find(w => w.id === l.userId);
            const r = w?.hourlyRate || rate;
            return acc + (_lm(l) / 60) * r;
          }, 0);
          const cost = laborCost + (hrs * ohRate);
          const revenue = j.quoteAmount || 0;
          const profit = revenue > 0 ? revenue - cost : null;
          return { hrs, cost, revenue, profit };
        };

        const monthJobs = completedJobs.filter(j => (j.completedAt || 0) >= thisMonthStart.getTime());
        const weekJobs = completedJobs.filter(j => (j.completedAt || 0) >= thisWeekStart.getTime());

        const monthTotals = monthJobs.reduce((acc, j) => {
          const f = calcJobFinancials(j);
          return { hrs: acc.hrs + f.hrs, cost: acc.cost + f.cost, revenue: acc.revenue + f.revenue, jobs: acc.jobs + 1 };
        }, { hrs: 0, cost: 0, revenue: 0, jobs: 0 });
        const monthProfit = monthTotals.revenue > 0 ? monthTotals.revenue - monthTotals.cost : null;

        const weekTotals = weekJobs.reduce((acc, j) => {
          const f = calcJobFinancials(j);
          return { hrs: acc.hrs + f.hrs, cost: acc.cost + f.cost, revenue: acc.revenue + f.revenue, jobs: acc.jobs + 1 };
        }, { hrs: 0, cost: 0, revenue: 0, jobs: 0 });
        const weekProfit = weekTotals.revenue > 0 ? weekTotals.revenue - weekTotals.cost : null;

        // Jobs without quotes (need attention)
        const unquoted = completedJobs.filter(j => !(j.quoteAmount && j.quoteAmount > 0));

        // Margin calculations
        const monthMargin = monthTotals.revenue > 0 ? ((monthTotals.revenue - monthTotals.cost) / monthTotals.revenue * 100) : 0;
        const weekMargin = weekTotals.revenue > 0 ? ((weekTotals.revenue - weekTotals.cost) / weekTotals.revenue * 100) : 0;

        // ── On-Time Delivery (OTD) — rolling 30 days ──
        const otdWindow = Date.now() - 30 * 86400000;
        const otdJobs = completedJobs.filter(j => j.dueDate && j.completedAt && j.completedAt >= otdWindow);
        const otdOnTime = otdJobs.filter(j => {
          const dueD = parseDueDate(j.dueDate!);
          if (!dueD) return false;
          dueD.setHours(23, 59, 59, 999);
          return (j.completedAt || 0) <= dueD.getTime();
        }).length;
        const otdPct = otdJobs.length > 0 ? Math.round((otdOnTime / otdJobs.length) * 100) : null;
        const otdLate = otdJobs.length - otdOnTime;

        // Active jobs with live costs (estimated vs actual)
        const activeJobsWithCosts = jobs.filter(j => j.status !== 'completed' && j.quoteAmount).map(j => {
          const f = calcJobFinancials(j);
          const remaining = (j.quoteAmount || 0) - f.cost;
          const usedPct = j.quoteAmount ? Math.min(100, (f.cost / j.quoteAmount) * 100) : 0;
          return { ...j, ...f, remaining, usedPct };
        }).sort((a, b) => b.usedPct - a.usedPct).slice(0, 5);

        // Revenue per customer this month
        const custRev = new Map<string, { revenue: number; cost: number; jobs: number }>();
        monthJobs.forEach(j => {
          const c = j.customer || 'Unknown';
          const f = calcJobFinancials(j);
          const cur = custRev.get(c) || { revenue: 0, cost: 0, jobs: 0 };
          cur.revenue += f.revenue; cur.cost += f.cost; cur.jobs++;
          custRev.set(c, cur);
        });
        const topCustomers = Array.from(custRev.entries()).filter(([, d]) => d.revenue > 0).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5);

        // Average cost per hour
        const avgCostPerHr = monthTotals.hrs > 0 ? monthTotals.cost / monthTotals.hrs : 0;
        const avgRevenuePerHr = monthTotals.hrs > 0 ? monthTotals.revenue / monthTotals.hrs : 0;

        return (
          <div className="space-y-4">
            {/* Top KPI Cards */}
            <div className="stagger grid grid-cols-2 md:grid-cols-5 gap-3">
              {/* On-Time Delivery — machine-shop standard KPI */}
              <div className={`card-shine hover-lift-glow border rounded-2xl p-3 sm:p-4 overflow-hidden relative ${otdPct === null ? 'bg-zinc-900/50 border-white/5' : otdPct >= 90 ? 'bg-emerald-500/10 border-emerald-500/25' : otdPct >= 70 ? 'bg-zinc-900/50 border-white/5' : 'bg-red-500/10 border-red-500/25'}`}>
                <p className="text-[10px] text-zinc-500 uppercase font-bold truncate tracking-wider">On-Time Delivery</p>
                <p className={`text-base sm:text-xl md:text-2xl font-black truncate tabular ${otdPct === null ? 'text-zinc-600' : otdPct >= 90 ? 'text-emerald-400' : otdPct >= 70 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {otdPct === null ? '—' : `${otdPct}%`}
                </p>
                <p className="text-[10px] text-zinc-600 truncate">
                  {otdJobs.length === 0 ? 'No data (30d)' : `${otdOnTime}/${otdJobs.length} on time · 30d`}
                </p>
                {otdPct !== null && (
                  <div className="mt-1.5 h-1 rounded-full bg-zinc-800 overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-700 ${otdPct >= 90 ? 'bg-emerald-500' : otdPct >= 70 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${otdPct}%` }} />
                  </div>
                )}
              </div>
              <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 rounded-2xl p-3 sm:p-4 overflow-hidden">
                <p className="text-[10px] text-zinc-500 uppercase font-bold truncate tracking-wider">Monthly Revenue</p>
                <p className="text-base sm:text-xl md:text-2xl font-black text-emerald-400 truncate tabular">{fmtMoneyK(monthTotals.revenue)}</p>
                <p className="text-[10px] text-zinc-600 truncate">{monthTotals.jobs} jobs completed</p>
              </div>
              <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 rounded-2xl p-3 sm:p-4 overflow-hidden">
                <p className="text-[10px] text-zinc-500 uppercase font-bold truncate tracking-wider">Monthly Costs</p>
                <p className="text-base sm:text-xl md:text-2xl font-black text-orange-400 truncate tabular">{fmtMoneyK(monthTotals.cost)}</p>
                <p className="text-[10px] text-zinc-600 truncate">{monthTotals.hrs.toFixed(0)}h labor + overhead</p>
              </div>
              <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 rounded-2xl p-3 sm:p-4 overflow-hidden">
                <p className="text-[10px] text-zinc-500 uppercase font-bold truncate tracking-wider">Net Profit</p>
                <p className={`text-base sm:text-xl md:text-2xl font-black truncate tabular ${monthProfit && monthProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {monthProfit !== null ? fmtMoneySigned(monthProfit) : '—'}
                </p>
                <p className="text-[10px] text-zinc-600 truncate">{monthMargin > 0 ? `${monthMargin.toFixed(0)}% margin` : 'No quoted jobs'}</p>
              </div>
              <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 rounded-2xl p-3 sm:p-4 overflow-hidden">
                <p className="text-[10px] text-zinc-500 uppercase font-bold truncate tracking-wider">$/Hour Earned</p>
                <p className={`text-base sm:text-xl md:text-2xl font-black truncate tabular ${monthTotals.hrs > 0 ? 'text-amber-400' : 'text-zinc-600'}`}>{monthTotals.hrs > 0 ? `$${avgRevenuePerHr.toFixed(0)}` : '—'}</p>
                <p className="text-[10px] text-zinc-600 truncate">{monthTotals.hrs > 0 ? `Cost: $${avgCostPerHr.toFixed(0)}/hr` : 'No hours logged'}</p>
              </div>
            </div>

            {/* Week vs Month Comparison */}
            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden">
              <div className="p-4 border-b border-white/5 flex items-center justify-between">
                <h3 className="font-bold text-white text-sm flex items-center gap-2"><Calculator className="w-4 h-4 text-emerald-400" /> Profit & Loss</h3>
                {unquoted.length > 0 && <span className="text-[10px] bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-2 py-1 rounded-lg font-bold">{unquoted.length} missing quote</span>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-white/5">
                <div className="p-3 sm:p-4 space-y-2">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase">This Week</p>
                  <div className="flex justify-between text-xs"><span className="text-zinc-500">Revenue</span><span className="text-emerald-400 font-mono">${weekTotals.revenue.toLocaleString()}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-zinc-500">Labor</span><span className="text-orange-400 font-mono">${weekTotals.cost.toFixed(0)}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-zinc-500">Hours</span><span className="text-zinc-300 font-mono">{weekTotals.hrs.toFixed(1)}h</span></div>
                  <div className="border-t border-white/5 pt-2 flex justify-between items-center">
                    <span className="text-xs font-bold text-zinc-400">Profit</span>
                    <div className="text-right">
                      <span className={`text-lg font-black ${weekProfit && weekProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {weekProfit !== null ? `${weekProfit >= 0 ? '+' : ''}$${weekProfit.toFixed(0)}` : weekTotals.cost > 0 ? `-$${weekTotals.cost.toFixed(0)}` : '$0'}
                      </span>
                      {weekMargin > 0 && <p className="text-[10px] text-zinc-500">{weekMargin.toFixed(0)}% margin</p>}
                    </div>
                  </div>
                </div>
                <div className="p-3 sm:p-4 space-y-2">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase">This Month</p>
                  <div className="flex justify-between text-xs"><span className="text-zinc-500">Revenue</span><span className="text-emerald-400 font-mono">${monthTotals.revenue.toLocaleString()}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-zinc-500">Labor</span><span className="text-orange-400 font-mono">${monthTotals.cost.toFixed(0)}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-zinc-500">Hours</span><span className="text-zinc-300 font-mono">{monthTotals.hrs.toFixed(1)}h</span></div>
                  <div className="border-t border-white/5 pt-2 flex justify-between items-center">
                    <span className="text-xs font-bold text-zinc-400">Profit</span>
                    <div className="text-right">
                      <span className={`text-lg font-black ${monthProfit && monthProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {monthProfit !== null ? `${monthProfit >= 0 ? '+' : ''}$${monthProfit.toFixed(0)}` : '—'}
                      </span>
                      {monthMargin > 0 && <p className="text-[10px] text-zinc-500">{monthMargin.toFixed(0)}% margin</p>}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Monthly Revenue Goal Progress ── */}
            {(() => {
              const goal = shopSettings.monthlyRevenueGoal;
              if (!goal || goal <= 0) return null;
              const pct = Math.min(100, (monthTotals.revenue / goal) * 100);
              // Pace: how many days into the month, projected finish
              const totalDays = new Date(thisMonthStart.getFullYear(), thisMonthStart.getMonth() + 1, 0).getDate();
              const daysPassed = new Date().getDate();
              const daysLeft = totalDays - daysPassed;
              const paceRevenue = daysPassed > 0 ? (monthTotals.revenue / daysPassed) * totalDays : 0;
              const onPace = paceRevenue >= goal * 0.9;
              const aheadPace = paceRevenue >= goal;
              const barColor = aheadPace ? '#10b981' : onPace ? '#f59e0b' : '#ef4444';
              const statusText = aheadPace ? '🟢 On track to exceed goal' : onPace ? '🟡 Slightly behind pace' : `🔴 Pacing for ${goal > 0 ? `$${Math.round(paceRevenue).toLocaleString()}` : '$0'} — push harder`;
              return (
                <div className="card-shine bg-zinc-900/50 border border-white/5 rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                    <div>
                      <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Monthly Goal</p>
                      <p className="text-xs text-zinc-400 mt-0.5">{statusText}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-base font-black tabular" style={{ color: barColor }}>
                        ${monthTotals.revenue >= 1000 ? (monthTotals.revenue/1000).toFixed(1)+'k' : monthTotals.revenue.toFixed(0)}
                        <span className="text-zinc-600 font-normal text-xs"> / ${goal >= 1000 ? (goal/1000).toFixed(0)+'k' : goal.toLocaleString()}</span>
                      </p>
                      <p className="text-[10px] text-zinc-600">{daysLeft} day{daysLeft !== 1 ? 's' : ''} left</p>
                    </div>
                  </div>
                  <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${barColor}99, ${barColor})`, boxShadow: `0 0 12px ${barColor}60` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1 text-[10px] text-zinc-600">
                    <span>{pct.toFixed(0)}% of goal</span>
                    <span>{pct >= 100 ? '🎉 Goal hit!' : `$${Math.max(0, goal - monthTotals.revenue) >= 1000 ? ((goal - monthTotals.revenue)/1000).toFixed(1)+'k' : Math.max(0, goal - monthTotals.revenue).toFixed(0)} to go`}</span>
                  </div>
                </div>
              );
            })()}

            {/* ── Worker Leaderboard — hours this week ── */}
            {dashWorkers.filter(w => w.isActive !== false && w.role !== 'admin').length > 0 && (() => {
              const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0,0,0,0);
              const weekStartMs = weekStart.getTime();
              type WorkerRow = { id: string; name: string; hrs: number; jobs: number; active: boolean };
              const leaderboard: WorkerRow[] = dashWorkers
                .filter(w => w.isActive !== false && w.role !== 'admin')
                .map(w => {
                  const weekLogs = allLogs.filter(l => l.userId === w.id && l.startTime >= weekStartMs && !l.isSample);
                  const runningMs = activeLogs.filter(l => l.userId === w.id).reduce((a, l) => {
                    const pausedMs2 = (l.totalPausedMs || 0) + (l.pausedAt ? Date.now() - l.pausedAt : 0);
                    return a + Math.max(0, Date.now() - l.startTime - pausedMs2);
                  }, 0);
                  const loggedMins = weekLogs.reduce((a, l) => {
                    if (l.durationSeconds != null && l.durationSeconds >= 0) return a + l.durationSeconds / 60;
                    return a + (l.durationMinutes || 0);
                  }, 0);
                  const totalHrs = (loggedMins + runningMs / 60000) / 60;
                  const jobSet = new Set(weekLogs.map(l => l.jobId));
                  const isActive = activeLogs.some(l => l.userId === w.id);
                  return { id: w.id, name: w.name, hrs: totalHrs, jobs: jobSet.size, active: isActive };
                })
                .sort((a, b) => b.hrs - a.hrs);
              const maxHrs = leaderboard[0]?.hrs || 1;
              if (maxHrs < 0.1) return null; // no data yet
              return (
                <div className="card-shine bg-zinc-900/50 border border-white/5 rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Award className="w-4 h-4 text-amber-400" />
                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Worker Leaderboard</p>
                    <span className="text-[10px] text-zinc-600 ml-auto">this week</span>
                  </div>
                  <div className="space-y-2.5">
                    {leaderboard.map((w, i) => {
                      const barPct2 = maxHrs > 0 ? (w.hrs / maxHrs) * 100 : 0;
                      const hrsDisplay = w.hrs < 0.1 ? '< 6m' : w.hrs >= 1 ? `${w.hrs.toFixed(1)}h` : `${Math.round(w.hrs * 60)}m`;
                      return (
                        <div key={w.id}>
                          <div className="flex items-center justify-between mb-1 gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[10px] font-black text-zinc-700 w-4 text-center shrink-0">#{i+1}</span>
                              <div className={`relative w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${w.active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-800 text-zinc-500'}`}>
                                {w.name.charAt(0).toUpperCase()}
                                {w.active && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 border border-zinc-900" />}
                              </div>
                              <span className={`text-sm font-bold truncate ${i === 0 ? 'text-white' : 'text-zinc-400'}`}>{w.name}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {w.jobs > 0 && <span className="text-[10px] text-zinc-600">{w.jobs} job{w.jobs !== 1 ? 's' : ''}</span>}
                              <span className={`text-sm font-black tabular ${i === 0 ? 'text-amber-400' : 'text-zinc-500'}`}>{hrsDisplay}</span>
                            </div>
                          </div>
                          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden ml-10">
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{
                                width: `${barPct2}%`,
                                background: i === 0 ? 'linear-gradient(90deg, #f59e0b99, #f59e0b)' : '#3f3f46',
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Live Job Budget Tracker — Est. vs Actual */}
            {activeJobsWithCosts.length > 0 && (() => {
              const overBudget = activeJobsWithCosts.filter(j => j.remaining < 0).length;
              const atRisk = activeJobsWithCosts.filter(j => j.remaining >= 0 && j.usedPct > 70).length;
              const onTrack = activeJobsWithCosts.length - overBudget - atRisk;
              return (
              <div className="card-shine hover-lift-glow bg-gradient-to-br from-zinc-900/60 to-zinc-900/30 border border-white/5 rounded-3xl p-4 sm:p-5 overflow-hidden">
                <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
                  <div>
                    <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest">Live Job Budget</h3>
                    <p className="text-[11px] text-zinc-600 mt-0.5">Est. vs actual · {activeJobsWithCosts.length} active job{activeJobsWithCosts.length !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {onTrack > 0 && <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-full">{onTrack} on track</span>}
                    {atRisk > 0 && <span className="text-[10px] font-bold text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-2 py-1 rounded-full">{atRisk} at risk</span>}
                    {overBudget > 0 && <span className="text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-1 rounded-full">{overBudget} over</span>}
                  </div>
                </div>
                <div className="space-y-3">
                  {activeJobsWithCosts.map(j => {
                    const barColor = j.usedPct > 100 ? '#ef4444' : j.usedPct > 90 ? '#f59e0b' : j.usedPct > 70 ? '#eab308' : '#10b981';
                    const statusText = j.remaining < 0 ? 'OVER' : j.usedPct > 90 ? 'WARN' : j.usedPct > 70 ? 'RISK' : 'OK';
                    const statusTint = j.remaining < 0 ? 'bg-red-500/10 text-red-400 border-red-500/20' : j.usedPct > 90 ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' : j.usedPct > 70 ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
                    return (
                      <div key={j.id} className="group">
                        <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-[9px] font-black uppercase tracking-widest border px-1.5 py-0.5 rounded ${statusTint} tabular shrink-0`}>{statusText}</span>
                            <span className="text-sm font-bold text-white truncate">{j.poNumber}</span>
                            <span className="text-[11px] text-zinc-500 font-mono truncate hidden sm:inline">{j.partNumber}</span>
                          </div>
                          <div className="flex items-center gap-2 sm:gap-3 text-[11px] font-mono tabular shrink-0">
                            <span className="text-zinc-500">Spent <span className="text-orange-400 font-bold">{fmtMoneyK(j.cost)}</span></span>
                            <span className="text-zinc-700">/</span>
                            <span className="text-zinc-500">Budget <span className="text-zinc-300 font-bold">{fmtMoneyK(j.quoteAmount || 0)}</span></span>
                            <span className={`font-black px-1.5 py-0.5 rounded text-[10px] ${j.remaining >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                              {fmtMoneySigned(j.remaining)}
                            </span>
                          </div>
                        </div>
                        <div className="relative h-2 bg-zinc-800/60 rounded-full overflow-hidden">
                          {/* 100% marker */}
                          <div aria-hidden="true" className="absolute inset-y-0 w-[1px] bg-white/10" style={{ left: '100%' }} />
                          <div
                            className="h-full rounded-full transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
                            style={{
                              width: `${Math.min(100, j.usedPct)}%`,
                              background: `linear-gradient(90deg, ${barColor}AA, ${barColor})`,
                              boxShadow: `0 0 8px ${barColor}80`,
                            }}
                          />
                          {/* Over-budget overflow indicator */}
                          {j.usedPct > 100 && (
                            <div aria-hidden="true" className="absolute inset-y-0 right-0 w-[4px] bg-red-500 rounded-r-full animate-pulse" style={{ boxShadow: '0 0 10px #ef4444' }} />
                          )}
                        </div>
                        <div className="flex items-center justify-between text-[9px] font-mono tabular text-zinc-600 mt-0.5 px-0.5">
                          <span>{j.usedPct.toFixed(0)}% used</span>
                          <span>{(100 - Math.min(100, j.usedPct)).toFixed(0)}% remaining</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              );
            })()}

            {/* Top Customers — Redesigned Premium Charts */}
            {topCustomers.length > 0 && (() => {
              // Premium palette — cohesive, WCAG-safe saturation
              const CUST_COLORS = ['#3b82f6', '#a855f7', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#f43f5e'];
              const custChartData = topCustomers.map(([cust, data], i) => ({
                name: fmtShortName(cust),
                fullName: cust,
                revenue: data.revenue,
                cost: Math.round(data.cost),
                profit: Math.round(data.revenue - data.cost),
                margin: data.revenue > 0 ? parseFloat(((data.revenue - data.cost) / data.revenue * 100).toFixed(0)) : 0,
                color: CUST_COLORS[i % CUST_COLORS.length],
              }));
              const totalCustRev = custChartData.reduce((a, d) => a + d.revenue, 0);
              const totalCustCost = custChartData.reduce((a, d) => a + d.cost, 0);
              const totalCustProfit = totalCustRev - totalCustCost;
              const maxBarVal = custChartData.reduce((m, x) => Math.max(m, x.revenue, x.cost), 0) || 1;
              const topCust = custChartData[0];

              return (
                <>
                {/* ────────── Donut: Top Customers ────────── */}
                {(() => {
                  const activeCust = hoveredCustIdx !== null ? custChartData[hoveredCustIdx] : topCust;
                  const activeIsLeader = hoveredCustIdx === null;
                  const activePct = totalCustRev > 0 && activeCust ? ((activeCust.revenue / totalCustRev) * 100).toFixed(0) : '0';
                  return (
                <div className="card-shine hover-lift-glow bg-gradient-to-br from-zinc-900/60 to-zinc-900/30 border border-white/5 rounded-3xl p-4 sm:p-6 overflow-hidden">
                  <div className="flex items-start justify-between mb-4 gap-3">
                    <div>
                      <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest">Revenue Mix</h3>
                      <p className="text-[11px] text-zinc-600 mt-0.5">Top {custChartData.length} customers · this month</p>
                    </div>
                    <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-full whitespace-nowrap">
                      {fmtMoneyK(totalCustRev)} total
                    </span>
                  </div>

                  {/* Donut chart */}
                  <div className="relative" onMouseLeave={() => setHoveredCustIdx(null)}>
                    <ResponsiveContainer width="100%" height={isMobile ? 220 : 260}>
                      <PieChart>
                        <defs>
                          {custChartData.map((d, i) => (
                            <linearGradient key={`gradPie-${i}`} id={`gradPie-${i}`} x1="0" y1="0" x2="1" y2="1">
                              <stop offset="0%" stopColor={d.color} stopOpacity={1} />
                              <stop offset="100%" stopColor={d.color} stopOpacity={0.6} />
                            </linearGradient>
                          ))}
                        </defs>
                        <Pie
                          data={custChartData}
                          cx="50%" cy="50%"
                          innerRadius={isMobile ? 62 : 76}
                          outerRadius={isMobile ? 96 : 116}
                          paddingAngle={3}
                          dataKey="revenue"
                          nameKey="fullName"
                          stroke="rgba(9,9,11,0.9)"
                          strokeWidth={2}
                          isAnimationActive
                          animationDuration={900}
                          animationEasing="ease-out"
                          cornerRadius={6}
                          onMouseEnter={(_, i) => setHoveredCustIdx(i)}
                        >
                          {custChartData.map((_, i) => (
                            <Cell
                              key={i}
                              fill={`url(#gradPie-${i})`}
                              style={{
                                filter: hoveredCustIdx !== null && hoveredCustIdx !== i ? 'opacity(0.35)' : 'none',
                                transition: 'filter 0.25s ease',
                              }}
                            />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>

                    {/* Center label — dynamic with hover */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-4">
                      <p className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em]">
                        {activeIsLeader ? 'Leader' : 'Customer'}
                      </p>
                      <p className="text-[11px] font-bold text-zinc-300 truncate max-w-[150px] text-center mt-0.5" style={{ color: activeCust?.color }}>
                        {activeCust?.fullName}
                      </p>
                      <p className="text-xl sm:text-2xl font-black text-white tabular mt-1 leading-none" style={{ textShadow: `0 0 24px ${activeCust?.color || '#3b82f6'}40` }}>
                        {fmtMoneyK(activeCust?.revenue || 0)}
                      </p>
                      <p className="text-[10px] font-mono text-zinc-500 tabular mt-1">{activePct}% share</p>
                    </div>
                  </div>

                  {/* Ranked legend */}
                  <div className="mt-5 space-y-2" onMouseLeave={() => setHoveredCustIdx(null)}>
                    {custChartData.map((d, i) => {
                      const pct = totalCustRev > 0 ? (d.revenue / totalCustRev) * 100 : 0;
                      const isActive = hoveredCustIdx === i;
                      return (
                        <button
                          key={d.name}
                          type="button"
                          onMouseEnter={() => setHoveredCustIdx(i)}
                          onFocus={() => setHoveredCustIdx(i)}
                          onBlur={() => setHoveredCustIdx(null)}
                          aria-label={`${d.fullName}: $${d.revenue.toLocaleString()} revenue, ${pct.toFixed(0)}% share`}
                          className={`w-full flex items-center gap-2 sm:gap-3 px-2 py-1.5 rounded-lg transition-colors ${isActive ? 'bg-white/5' : 'hover:bg-white/[0.03]'}`}
                        >
                          <span className="w-4 text-center text-[10px] font-black text-zinc-600 tabular shrink-0">{i+1}</span>
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color, boxShadow: isActive ? `0 0 10px ${d.color}` : `0 0 4px ${d.color}80` }} />
                          <span className={`flex-1 text-xs font-semibold truncate text-left transition-colors ${isActive ? 'text-white' : 'text-zinc-300'}`}>{d.fullName}</span>
                          <div className="relative w-10 sm:w-20 h-1.5 rounded-full bg-zinc-800 overflow-hidden shrink-0">
                            <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ width: `${pct}%`, background: d.color, boxShadow: `0 0 6px ${d.color}80` }} />
                          </div>
                          <span className="text-[11px] font-mono font-bold text-zinc-200 tabular text-right shrink-0 w-[52px]">{fmtMoneyK(d.revenue)}</span>
                          <span className="text-[10px] font-mono text-zinc-500 tabular text-right shrink-0 w-8">{pct.toFixed(0)}%</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                  );
                })()}

                {/* ────────── Horizontal Bar: Revenue vs Cost ────────── */}
                <div className="card-shine hover-lift-glow bg-gradient-to-br from-zinc-900/60 to-zinc-900/30 border border-white/5 rounded-3xl p-4 sm:p-6 overflow-hidden">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest">Revenue vs Cost</h3>
                      <p className="text-[11px] text-zinc-600 mt-0.5">Profit per customer</p>
                    </div>
                    <span className={`text-[10px] font-bold border px-2 py-1 rounded-full ${totalCustProfit >= 0 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-red-400 bg-red-500/10 border-red-500/20'}`}>
                      {fmtMoneySigned(totalCustProfit)} net
                    </span>
                  </div>

                  <div className="space-y-4">
                    {custChartData.map((d, i) => {
                      const revPct = (d.revenue / maxBarVal) * 100;
                      const costPct = (d.cost / maxBarVal) * 100;
                      const profitable = d.profit >= 0;
                      return (
                        <div key={d.name} className="group">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color, boxShadow: `0 0 6px ${d.color}80` }} />
                              <span className="text-xs font-bold text-zinc-200 truncate">{d.fullName}</span>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] font-mono tabular shrink-0">
                              <span className={`font-black ${profitable ? 'text-emerald-400' : 'text-red-400'}`}>
                                {fmtMoneySigned(d.profit)}
                              </span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded ${profitable ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                                {d.margin}%
                              </span>
                            </div>
                          </div>
                          {/* Revenue bar */}
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest w-10">REV</span>
                            <div className="relative flex-1 h-2.5 rounded-full bg-zinc-800/60 overflow-hidden">
                              <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)]"
                                style={{ width: `${revPct}%`, background: `linear-gradient(90deg, ${d.color}, ${d.color}DD)`, boxShadow: `0 0 10px ${d.color}60` }} />
                            </div>
                            <span className="text-[10px] font-mono font-bold text-zinc-200 tabular w-14 text-right">{fmtMoneyK(d.revenue)}</span>
                          </div>
                          {/* Cost bar */}
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest w-10">COST</span>
                            <div className="relative flex-1 h-2.5 rounded-full bg-zinc-800/60 overflow-hidden">
                              <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)]"
                                style={{ width: `${costPct}%`, background: 'linear-gradient(90deg, #f59e0b, #f59e0bBB)', boxShadow: '0 0 8px rgba(245,158,11,0.4)' }} />
                            </div>
                            <span className="text-[10px] font-mono font-bold text-zinc-400 tabular w-14 text-right">{fmtMoneyK(d.cost)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer summary */}
                  <div className="mt-5 pt-4 border-t border-white/5 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Revenue</p>
                      <p className="text-sm font-black text-white tabular mt-0.5">{fmtMoneyK(totalCustRev)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Cost</p>
                      <p className="text-sm font-black text-amber-400 tabular mt-0.5">{fmtMoneyK(totalCustCost)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Profit</p>
                      <p className={`text-sm font-black tabular mt-0.5 ${totalCustProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {fmtMoneySigned(totalCustProfit)}
                      </p>
                    </div>
                  </div>
                </div>
                </>
              );
            })()}
          </div>
        );
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-zinc-900/50 border border-white/5 rounded-3xl overflow-hidden flex flex-col">
          <div className="p-5 border-b border-white/5 flex items-center justify-between">
            <h3 className="font-bold text-white flex items-center gap-2"><Activity className="w-4 h-4 text-emerald-500" /> Live Operations</h3>
            {activeLogs.length > 0 && (
              <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> {activeLogs.length} ACTIVE
              </span>
            )}
          </div>
          <div className="divide-y divide-white/5 flex-1 overflow-y-auto max-h-[420px]">
            {activeLogs.length === 0 && (
              <div className="p-12 text-center">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-zinc-800/60 flex items-center justify-center mb-3">
                  <Activity className="w-6 h-6 text-zinc-600" />
                </div>
                <p className="text-zinc-400 font-semibold">Floor is quiet</p>
                <p className="text-zinc-600 text-xs mt-1">No active timers right now.</p>
              </div>
            )}
            {activeLogs.map(l => {
              const liveJob = jobs.find(j => j.id === l.jobId);
              return (
              <div key={l.id} className="p-3 sm:p-4 hover:bg-white/5 transition-colors group">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar name={l.userName} size="md" ring dot={l.pausedAt ? 'paused' : 'live'} />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-white text-sm truncate">{l.userName}</p>
                    <p className="text-xs text-amber-400 font-semibold truncate">{l.operation}</p>
                    {liveJob && (
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-[10px] font-black text-white/60 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded font-mono">PO {liveJob.poNumber}</span>
                        {liveJob.partNumber && <span className="text-[10px] text-zinc-500 truncate max-w-[120px]">{liveJob.partNumber}</span>}
                        {liveJob.customer && <span className="text-[10px] font-bold text-zinc-400 truncate max-w-[100px]">{liveJob.customer}</span>}
                        <span className="text-[10px] text-zinc-600">{liveJob.quantity} pc</span>
                      </div>
                    )}
                  </div>
                  <button
                    aria-label={`Force stop ${l.userName}'s timer`}
                    onClick={() => confirmAction({ title: 'Force Stop', message: 'Stop this timer?', onConfirm: () => DB.stopTimeLog(l.id, undefined, undefined, undefined, 'admin:force-stop') })}
                    className="bg-red-500/10 text-red-500 p-2 rounded-lg hover:bg-red-500 hover:text-white transition-colors opacity-60 group-hover:opacity-100 shrink-0"
                    title="Force stop"
                  >
                    <Power className="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
                  </button>
                </div>
                <div className="mt-2 text-white text-2xl sm:text-3xl font-black font-mono tabular-nums text-center sm:text-right tracking-tight">
                  <LiveTimer startTime={l.startTime} pausedAt={l.pausedAt} totalPausedMs={l.totalPausedMs} />
                </div>
              </div>
              );
            })}
          </div>
        </div>
        <div className="bg-zinc-900/50 border border-white/5 rounded-3xl overflow-hidden flex flex-col">
          <div className="p-5 border-b border-white/5 flex justify-between items-center">
            <h3 className="font-bold text-white flex items-center gap-2"><History className="w-4 h-4 text-amber-500" /> Recent Completed</h3>
            <button onClick={() => setView('admin-logs')} className="text-xs font-semibold text-amber-400 hover:text-white transition-colors flex items-center gap-1">View All <ChevronRight className="w-3 h-3" /></button>
          </div>
          <div className="divide-y divide-white/5 flex-1 overflow-y-auto max-h-[420px]">
            {logs.length === 0 && (
              <div className="p-12 text-center">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-zinc-800/60 flex items-center justify-center mb-3">
                  <History className="w-6 h-6 text-zinc-600" />
                </div>
                <p className="text-zinc-400 font-semibold">No recent history</p>
                <p className="text-zinc-600 text-xs mt-1">Completed operations show up here.</p>
              </div>
            )}
            {logs.map(l => (
              <div key={l.id} className="p-4 flex items-start gap-3 hover:bg-white/5 transition-colors">
                <Avatar name={l.userName} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white"><span className="font-bold">{l.userName}</span> <span className="text-zinc-600">—</span> <span className="text-zinc-300">{l.operation}</span></p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-zinc-400 font-mono text-[11px] font-bold">{l.jobIdsDisplay || l.jobId}</span>
                    {l.partNumber && <span className="text-[10px] text-zinc-500 bg-zinc-800 border border-white/5 px-1.5 py-0.5 rounded">{l.partNumber}</span>}
                    <span className="text-[10px] text-zinc-600">{new Date(l.endTime!).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
                  </div>
                  {l.notes && (
                    <div className="mt-1.5 bg-amber-500/5 border border-amber-500/20 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
                      <span className="text-amber-500 text-[10px]">📝</span>
                      <span className="text-amber-300/90 text-xs leading-tight">{l.notes}</span>
                    </div>
                  )}
                </div>
                {(l.durationSeconds != null ? l.durationSeconds >= 0 : l.durationMinutes != null) && (
                  <div className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded shrink-0 font-bold">{formatDuration(l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0))}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── WORKER PERFORMANCE — who's producing, efficiency index, on-time rate ── */}
      {(() => {
        if (dashWorkers.length === 0 || allLogs.length === 0) return null;
        const thirtyDaysAgo = Date.now() - 30 * 86400000;
        const rate = shopSettings.shopRate || 0;

        interface WStats { id: string; name: string; jobsDone: number; totalMins: number; onTime: number; late: number; activeMinsToday: number; workerRate: number; }

        const statMap = new Map<string, WStats>();
        for (const w of dashWorkers) {
          if ((w as any).role === 'admin') continue;
          const wLogs = allLogs.filter(l => l.userId === w.id && l.endTime && l.startTime >= thirtyDaysAgo);
          if (wLogs.length === 0) continue;
          const totalMins = wLogs.reduce((a, l) => a + (l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0)), 0);
          const jobIds = new Set(wLogs.map(l => l.jobId));
          const completedForW = jobs.filter(j => j.status === 'completed' && jobIds.has(j.id) && j.dueDate && j.completedAt);
          const onTime = completedForW.filter(j => { const dueD = parseDueDate(j.dueDate!); if (!dueD) return false; dueD.setHours(23,59,59,999); return j.completedAt! <= dueD.getTime(); }).length;
          const todayStart = new Date(); todayStart.setHours(0,0,0,0);
          const todayLogs = allLogs.filter(l => l.userId === w.id && l.endTime && l.startTime >= todayStart.getTime());
          const activeMinsToday = todayLogs.reduce((a, l) => a + (l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0)), 0);
          statMap.set(w.id, { id: w.id, name: w.name, jobsDone: jobIds.size, totalMins, onTime, late: completedForW.length - onTime, activeMinsToday, workerRate: (w as any).hourlyRate || rate });
        }
        const workers30 = [...statMap.values()].sort((a, b) => b.totalMins - a.totalMins);
        if (workers30.length === 0) return null;
        const maxMins = workers30[0].totalMins || 1;

        return (
          <div className="card-shine hover-lift-glow bg-gradient-to-br from-zinc-900/60 to-zinc-900/30 border border-white/5 rounded-2xl p-4 sm:p-5">
            <div className="flex items-center justify-between mb-4 gap-3">
              <div>
                <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2"><Award className="w-3.5 h-3.5 text-amber-400" /> Worker Performance</h3>
                <p className="text-[11px] text-zinc-600 mt-0.5">Rolling 30 days · hours logged per operator</p>
              </div>
            </div>
            <div className="space-y-2.5">
              {workers30.map((w, i) => {
                const hrs = w.totalMins / 60;
                const barPct = (w.totalMins / maxMins) * 100;
                const onTimePctW = (w.onTime + w.late) > 0 ? Math.round((w.onTime / (w.onTime + w.late)) * 100) : null;
                const todayHrs = w.activeMinsToday / 60;
                return (
                  <div key={w.id} className="flex items-center gap-3">
                    <span className="text-[10px] font-black w-5 text-center shrink-0 text-zinc-600">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}`}</span>
                    <span className="text-sm font-bold text-white w-24 sm:w-28 truncate shrink-0">{w.name.split(' ')[0]}</span>
                    <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden min-w-0">
                      <div className={`h-full rounded-full transition-all duration-700 ${i === 0 ? 'bg-amber-400' : 'bg-blue-500/70'}`} style={{ width: `${barPct}%` }} />
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-[11px]">
                      <span className="font-black text-white tabular">{hrs.toFixed(1)}h</span>
                      {onTimePctW !== null && (
                        <span className={`font-bold px-1.5 py-0.5 rounded border text-[10px] ${onTimePctW >= 90 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : onTimePctW >= 70 ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' : 'text-red-400 bg-red-500/10 border-red-500/20'}`}>{onTimePctW}% OT</span>
                      )}
                      {todayHrs > 0 && <span className="text-emerald-400 font-bold text-[10px] hidden sm:inline">{todayHrs.toFixed(1)}h today</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── QUOTE ACCURACY — are your quotes hitting actual cost? ── */}
      {(() => {
        if ((shopSettings.shopRate || 0) === 0) return null;
        const rate = shopSettings.shopRate!;
        const completedWithQuote = jobs.filter(j =>
          j.status === 'completed' && (j.quoteAmount || 0) > 0 && j.completedAt && j.completedAt > Date.now() - 90 * 86400000
        );
        if (completedWithQuote.length < 3) return null;
        const accuracy = completedWithQuote.map(j => {
          const mins = allLogs.filter(l => l.jobId === j.id && l.endTime).reduce((a, l) => a + (l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0)), 0);
          const actualCost = (mins / 60) * rate;
          return ((actualCost - j.quoteAmount!) / j.quoteAmount!) * 100;
        });
        const avgDrift = accuracy.length > 0 ? accuracy.reduce((a, x) => a + x, 0) / accuracy.length : 0;
        const overQuoted = accuracy.filter(x => x < -10).length;
        const underQuoted = accuracy.filter(x => x > 10).length;
        const accurate = accuracy.length - overQuoted - underQuoted;
        const driftColor = Math.abs(avgDrift) <= 10 ? 'text-emerald-400' : avgDrift > 10 ? 'text-red-400' : 'text-amber-400';
        const driftLabel = Math.abs(avgDrift) <= 10 ? 'Quotes are accurate' : avgDrift > 10 ? 'Jobs costing more than quoted' : 'Leaving money on the table';
        return (
          <div className="card-shine hover-lift-glow bg-gradient-to-br from-zinc-900/60 to-zinc-900/30 border border-white/5 rounded-2xl p-4 sm:p-5">
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <div>
                <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2"><TrendingUp className="w-3.5 h-3.5 text-amber-400" /> Quote Accuracy</h3>
                <p className="text-[11px] text-zinc-600 mt-0.5">{completedWithQuote.length} jobs with quotes · last 90 days</p>
              </div>
              <div className="text-right">
                <p className={`text-xl font-black tabular ${driftColor}`}>{avgDrift > 0 ? '+' : ''}{avgDrift.toFixed(1)}%</p>
                <p className={`text-[10px] font-bold ${driftColor}`}>{driftLabel}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-emerald-500/8 border border-emerald-500/20 rounded-xl p-3 text-center">
                <p className="text-2xl font-black text-emerald-400">{accurate}</p>
                <p className="text-[10px] font-bold text-emerald-400/70 uppercase tracking-wide mt-0.5">Within 10%</p>
              </div>
              <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl p-3 text-center">
                <p className="text-2xl font-black text-amber-400">{overQuoted}</p>
                <p className="text-[10px] font-bold text-amber-400/70 uppercase tracking-wide mt-0.5">Overquoted</p>
              </div>
              <div className="bg-red-500/8 border border-red-500/20 rounded-xl p-3 text-center">
                <p className="text-2xl font-black text-red-400">{underQuoted}</p>
                <p className="text-[10px] font-bold text-red-400/70 uppercase tracking-wide mt-0.5">Underquoted</p>
              </div>
            </div>
            {underQuoted > 0 && (
              <div className="mt-3 flex items-start gap-2 bg-red-500/8 border border-red-500/20 rounded-xl px-3 py-2.5">
                <TrendingDown className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-red-300/80">{underQuoted} job{underQuoted > 1 ? 's' : ''} cost more than quoted. Consider raising rates or tracking setup time separately.</p>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── RECENT ACTIVITY FEED — cross-module chronological event log ── */}
      {recentActivity.length > 0 && (
        <div className="card-shine hover-lift-glow bg-gradient-to-br from-zinc-900/60 to-zinc-900/30 border border-white/5 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <div>
              <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" /> Recent Activity
              </h3>
              <p className="text-[11px] text-zinc-600 mt-0.5">Last 72 h across jobs, quotes, POs &amp; quality</p>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-zinc-500">
              {recentActivity.length} event{recentActivity.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {recentActivity.map(evt => {
              const diff = Date.now() - evt.ts;
              const rel = diff < 60000 ? 'just now'
                : diff < 3600000 ? `${Math.floor(diff / 60000)}m ago`
                : diff < 86400000 ? `${Math.floor(diff / 3600000)}h ago`
                : diff < 172800000 ? 'yesterday'
                : new Date(evt.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              return (
                <div key={evt.id} className="flex items-center gap-3 py-2 px-1 hover:bg-white/[0.025] rounded-lg transition-colors">
                  <div className={`w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 ${evt.iconCls}`}>
                    {evt.iconEl}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-white/90 leading-tight truncate">{evt.text}</p>
                    {evt.sub && <p className="text-[10px] text-zinc-500 truncate leading-tight mt-0.5">{evt.sub}</p>}
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    {evt.value && <p className={`text-[11px] font-black leading-tight ${evt.valueCls || 'text-zinc-400'}`}>{evt.value}</p>}
                    <p className="text-[10px] text-zinc-600 leading-tight">{rel}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
};

// --- PRIORITY BADGE ---
const PriorityBadge = ({ priority }: { priority?: string }) => {
  const p = priority || 'normal';
  const styles: Record<string, string> = {
    low: 'text-zinc-600 bg-zinc-800/50 border-white/5',
    normal: 'text-zinc-500 bg-zinc-800/30 border-white/5',
    high: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
    urgent: 'text-red-400 bg-red-500/10 border-red-500/20 animate-pulse',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border ${styles[p] || styles.normal}`}>
      {p}
    </span>
  );
};

// --- Calendar helper (module-level, used by JobsView + PO scanner) ---
function getCalendarUrl(job: Job): string {
  try {
    if (!job.dueDate) return '';
    const title = encodeURIComponent(`SC Due: PO ${job.poNumber}`);
    const desc = encodeURIComponent([
      `Part: ${job.partNumber}`,
      job.quantity ? `Qty: ${job.quantity}` : '',
      job.info ? `Notes: ${job.info}` : '',
    ].filter(Boolean).join('\n'));
    // Parse date — handles both MM/DD/YYYY and YYYY-MM-DD
    let y: string, m: string, dd: string;
    const iso = job.dueDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const us = job.dueDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (iso) { [, y, m, dd] = iso; }
    else if (us) { [, m, dd, y] = us; }
    else return '';
    m = m.padStart(2, '0');
    dd = dd.padStart(2, '0');
    const d = `${y}${m}${dd}`;
    const nextDay = new Date(Number(y), Number(m) - 1, Number(dd) + 1);
    const d2 = `${nextDay.getFullYear()}${String(nextDay.getMonth() + 1).padStart(2, '0')}${String(nextDay.getDate()).padStart(2, '0')}`;
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${desc}&dates=${d}/${d2}`;
  } catch { return ''; }
}

// ── Image compression helper — resizes & compresses to JPEG ──
function compressImage(file: File | Blob, maxW = 800, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        if (h > maxW) { w = Math.round(w * maxW / h); h = maxW; }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// ══════════════════════════════════════════════════════════════════
// JOB CHECKLIST SECTION — sub-tasks/operations per job (Jobs R1 #1)
// ══════════════════════════════════════════════════════════════════
import type { JobChecklistItem, JobAttachment } from './types';

const JobChecklistSection = ({ job, onUpdate, user }: { job: Job; onUpdate: (items: JobChecklistItem[]) => void; user: User | null }) => {
  const items = job.checklist || [];
  const [newLabel, setNewLabel] = useState('');
  const doneCount = items.filter(i => i.done).length;
  const pct = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;

  const addItem = () => {
    if (!newLabel.trim()) return;
    const item: JobChecklistItem = {
      id: `chk_${Date.now()}`,
      label: newLabel.trim(),
      done: false,
    };
    onUpdate([...items, item]);
    setNewLabel('');
  };
  const toggle = (id: string) => {
    const next = items.map(i => i.id === id
      ? (i.done
          ? { ...i, done: false, doneAt: undefined, doneBy: undefined, doneByName: undefined }
          : { ...i, done: true, doneAt: Date.now(), doneBy: user?.id, doneByName: user?.name })
      : i);
    onUpdate(next);
  };
  const rename = (id: string, label: string) => onUpdate(items.map(i => i.id === id ? { ...i, label } : i));
  const remove = (id: string) => onUpdate(items.filter(i => i.id !== id));
  const move = (id: string, dir: -1 | 1) => {
    const idx = items.findIndex(i => i.id === id);
    const t = idx + dir;
    if (idx < 0 || t < 0 || t >= items.length) return;
    const next = [...items];
    [next[idx], next[t]] = [next[t], next[idx]];
    onUpdate(next);
  };

  return (
    <div className="space-y-5">
      <h4 className="text-xs font-black text-purple-400 uppercase tracking-[0.2em] border-b border-purple-500/20 pb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="bg-purple-500/10 text-purple-400 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black">✓</span>
          Operation Checklist
          {items.length > 0 && <span className="text-zinc-600 normal-case font-normal text-[10px]">({doneCount}/{items.length})</span>}
        </span>
        {items.length > 0 && (
          <span className={`text-[10px] font-black tabular ${pct === 100 ? 'text-emerald-400' : pct > 50 ? 'text-yellow-400' : 'text-zinc-500'}`}>{pct}%</span>
        )}
      </h4>

      {/* Progress bar */}
      {items.length > 0 && (
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden -mt-2">
          <div className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : 'bg-gradient-to-r from-purple-500 to-pink-500'}`} style={{ width: `${pct}%` }} />
        </div>
      )}

      {/* Checklist items */}
      <div className="space-y-1.5">
        {items.map((item, idx) => (
          <div key={item.id} className={`flex items-center gap-2 p-2.5 rounded-lg border transition-all ${item.done ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-zinc-950 border-white/5 hover:border-white/15'}`}>
            <button
              type="button"
              onClick={() => toggle(item.id)}
              aria-label={item.done ? `Mark "${item.label}" incomplete` : `Mark "${item.label}" complete`}
              className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${item.done ? 'bg-emerald-500 border-emerald-500' : 'bg-transparent border-zinc-600 hover:border-purple-400'}`}
            >
              {item.done && <CheckCircle className="w-3 h-3 text-white" aria-hidden="true" />}
            </button>
            <input
              value={item.label}
              onChange={e => rename(item.id, e.target.value)}
              className={`flex-1 bg-transparent text-sm outline-none ${item.done ? 'text-zinc-500 line-through' : 'text-white'}`}
            />
            {item.done && item.doneByName && (
              <span className="text-[9px] text-emerald-400/70 truncate shrink-0" title={`Completed ${item.doneAt ? new Date(item.doneAt).toLocaleString() : ''}`}>
                by {item.doneByName.split(' ')[0]}
              </span>
            )}
            <div className="flex flex-col shrink-0">
              <button type="button" onClick={() => move(item.id, -1)} disabled={idx === 0} aria-label="Move up" className="text-zinc-600 hover:text-white disabled:opacity-20 p-0.5"><ChevronUp className="w-3 h-3" aria-hidden="true" /></button>
              <button type="button" onClick={() => move(item.id, 1)} disabled={idx === items.length - 1} aria-label="Move down" className="text-zinc-600 hover:text-white disabled:opacity-20 p-0.5"><ChevronDown className="w-3 h-3" aria-hidden="true" /></button>
            </div>
            <button type="button" onClick={() => remove(item.id)} aria-label="Remove step" className="text-zinc-600 hover:text-red-400 p-1 shrink-0"><X className="w-3.5 h-3.5" aria-hidden="true" /></button>
          </div>
        ))}
      </div>

      {/* Add new item */}
      <div className="flex gap-2">
        <input
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
          placeholder="Add operation (e.g. Deburr edges, QC inspect, Pack)..."
          className="flex-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500/50"
        />
        <button type="button" onClick={addItem} disabled={!newLabel.trim()} className="bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add
        </button>
      </div>
      {items.length === 0 && (
        <p className="text-[10px] text-zinc-600 italic text-center">💡 Break big jobs into steps. Workers check them off on the shop floor — nothing gets missed.</p>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════
// JOB ATTACHMENTS SECTION — drawings, PDFs, cert docs (Jobs R1 #2)
// ══════════════════════════════════════════════════════════════════
const JobAttachmentsSection = ({ job, onUpdate, user, addToast }: { job: Job; onUpdate: (atts: JobAttachment[]) => void; user: User | null; addToast: any }) => {
  const attachments = job.attachments || [];
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const MAX_BYTES = 2 * 1024 * 1024; // 2 MB inline cap — larger files should go to Firebase Storage later

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    const newAtts: JobAttachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        addToast('error', `"${file.name}" is over 2MB — compress or use smaller file`);
        continue;
      }
      try {
        const dataUrl: string = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = reject;
          r.readAsDataURL(file);
        });
        const category: JobAttachment['category'] =
          file.type.startsWith('image/') ? 'photo' :
          file.name.toLowerCase().match(/(drawing|dwg|stp|step|iges)/) ? 'drawing' :
          file.name.toLowerCase().match(/(cert|compliance|conform)/) ? 'cert' :
          file.name.toLowerCase().match(/(inspection|fai|qc)/) ? 'inspection' :
          'other';
        newAtts.push({
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: file.name,
          type: file.type,
          size: file.size,
          dataUrl,
          uploadedAt: Date.now(),
          uploadedBy: user?.id || 'unknown',
          uploadedByName: user?.name,
          category,
        });
      } catch (e) {
        addToast('error', `Failed to read ${file.name}`);
      }
    }
    if (newAtts.length > 0) {
      onUpdate([...attachments, ...newAtts]);
      addToast('success', `Added ${newAtts.length} attachment${newAtts.length > 1 ? 's' : ''}`);
    }
    setUploading(false);
  };

  const remove = (id: string) => onUpdate(attachments.filter(a => a.id !== id));

  const download = (att: JobAttachment) => {
    const a = document.createElement('a');
    a.href = att.dataUrl;
    a.download = att.name;
    a.click();
  };

  const formatBytes = (b: number) => b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

  const catIcon = (cat?: string) => {
    if (cat === 'drawing') return '📐';
    if (cat === 'photo') return '📷';
    if (cat === 'cert') return '📜';
    if (cat === 'inspection') return '🔍';
    return '📎';
  };

  return (
    <div className="space-y-5">
      <h4 className="text-xs font-black text-indigo-400 uppercase tracking-[0.2em] border-b border-indigo-500/20 pb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="bg-indigo-500/10 text-indigo-400 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black">📎</span>
          Attachments
          {attachments.length > 0 && <span className="text-zinc-600 normal-case font-normal text-[10px]">({attachments.length})</span>}
        </span>
      </h4>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        accept="image/*,.pdf,.dwg,.dxf,.stp,.step,.iges,.doc,.docx,.xls,.xlsx,.txt"
        onChange={e => handleFiles(e.target.files)}
      />

      {attachments.length === 0 ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full border-2 border-dashed border-indigo-500/20 hover:border-indigo-500/40 rounded-xl p-6 flex flex-col items-center gap-2 text-indigo-400/60 hover:text-indigo-400 transition-all group"
        >
          <span className="text-3xl">📎</span>
          <span className="font-bold text-sm">{uploading ? 'Uploading…' : 'Upload Attachments'}</span>
          <span className="text-[10px] text-zinc-600">Drawings · PDFs · Cert docs · Inspection reports · 2 MB max each</span>
        </button>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {attachments.map(att => (
              <div key={att.id} className="bg-zinc-950 border border-white/10 rounded-xl p-3 flex items-center gap-3 group hover:border-indigo-500/30 transition-all">
                <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0 text-lg">{catIcon(att.category)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white truncate" title={att.name}>{att.name}</p>
                  <p className="text-[10px] text-zinc-500">
                    <span className="uppercase">{att.category || 'file'}</span> · {formatBytes(att.size)}
                    {att.uploadedByName && <> · {att.uploadedByName.split(' ')[0]}</>}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {att.type.startsWith('image/') && (
                    <a href={att.dataUrl} target="_blank" rel="noopener" className="text-zinc-500 hover:text-indigo-400 p-1" title="View"><ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /></a>
                  )}
                  <button type="button" onClick={() => download(att)} aria-label="Download" className="text-zinc-500 hover:text-indigo-400 p-1"><Download className="w-3.5 h-3.5" aria-hidden="true" /></button>
                  <button type="button" onClick={() => remove(att.id)} aria-label="Remove" className="text-zinc-500 hover:text-red-400 p-1"><X className="w-3.5 h-3.5" aria-hidden="true" /></button>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="text-xs font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
          >
            <Plus className="w-3 h-3" aria-hidden="true" /> Add more
          </button>
        </>
      )}
    </div>
  );
};

// ── Part Image Lightbox ──
// Portaled + Esc-to-close + tap-anywhere-to-close. Image scales down on any
// viewport (uses dvh so iOS Safari URL bar doesn't crop the image).
const PartImageLightbox = ({ src, onClose }: { src: string, onClose: () => void }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/90 backdrop-blur-sm animate-fade-in p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Part photo"
      onClick={onClose}
    >
      <div className="relative w-full max-w-3xl" style={{ maxHeight: 'calc(100dvh - 2rem)' }} onClick={e => e.stopPropagation()}>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute -top-3 -right-3 z-10 bg-zinc-800 border border-white/10 rounded-full p-2 text-white hover:bg-red-500 transition-colors shadow-lg"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
        <img
          src={src}
          alt="Part photo"
          className="w-full rounded-xl shadow-2xl object-contain mx-auto"
          style={{ maxHeight: 'calc(100dvh - 2rem)' }}
        />
      </div>
    </div>,
    document.body,
  );
};


// --- ADMIN: JOBS ---
const JobsView = ({ user, addToast, setPrintable, confirm, onOpenPOScanner, initialTab, calendarOnly }: any) => {
  const { prompt: askName, PromptHost } = usePrompt();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [reworkEntries, setReworkEntries] = useState<ReworkEntry[]>([]);
  const [reworkModal, setReworkModal] = useState<Partial<ReworkEntry> | null>(null);
  const [activeTab, setActiveTab] = useState<'active' | 'completed' | 'calendar'>(calendarOnly ? 'calendar' : (initialTab || 'active'));
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [calSelectedDay, setCalSelectedDay] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'dueDate' | 'priority' | 'newest' | 'oldest'>('dueDate');
  const [showFilters, setShowFilters] = useState(false);
  // Jobs R1 #4: Saved filter views (stored in localStorage per admin — no Firestore dep)
  type SavedView = { id: string; name: string; search: string; priority: string; status: string; sortBy: typeof sortBy; tab: 'active' | 'completed' };
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => {
    try { return JSON.parse(localStorage.getItem('jobs_saved_views') || '[]'); } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem('jobs_saved_views', JSON.stringify(savedViews)); } catch {} }, [savedViews]);
  // Jobs R1 #5: Bulk selection
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [bulkActionOpen, setBulkActionOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Partial<Job>>({});
  const [showModal, setShowModal] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showClientUpdate, setShowClientUpdate] = useState(false);
  const [startJobModal, setStartJobModal] = useState<Job | null>(null);
  const [ops, setOps] = useState<string[]>([]);
  const [clients, setClients] = useState<string[]>([]);
  const [partSuggestions, setPartSuggestions] = useState<Job[]>([]);
  const [shopSettings, setShopSettings] = useState<SystemSettings>(DB.getSettings());
  const [allLogs, setAllLogs] = useState<TimeLog[]>([]);
  const [activeLogs, setActiveLogs] = useState<TimeLog[]>([]);
  const [workers, setWorkers] = useState<User[]>([]);
  const [allPOs, setAllPOs] = useState<PurchaseOrder[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<User | null>(null);
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const { prompt: promptInput, PromptHost: JobCompletePromptHost } = usePrompt();
  const modalBodyRef = useRef<HTMLDivElement>(null);
  const [calAdded, setCalAdded] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('cal_added_jobs') || '[]'); } catch { return []; } });
  const [printed, setPrinted] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('printed_jobs') || '[]'); } catch { return []; } });
  // Force-re-render once holiday cache is warm so bizDays cells show numbers.
  const [, setHolidayTick] = useState(0);
  useEffect(() => {
    const year = new Date().getFullYear();
    getHolidays(year).then(() => setHolidayTick(t => t + 1));
  }, []);
  useEffect(() => {
    const refresh = () => { try { setPrinted(JSON.parse(localStorage.getItem('printed_jobs') || '[]')); } catch {} };
    window.addEventListener('printed-update', refresh);
    return () => window.removeEventListener('printed-update', refresh);
  }, []);


  useEffect(() => {
    const u1 = DB.subscribeJobs(setJobs);
    const u2 = DB.subscribeSettings((s) => { setOps(s.customOperations || []); setClients(s.clients || []); setShopSettings(s); });
    const u3 = DB.subscribeUsers((u) => setWorkers(u.filter((w: User) => w.isActive !== false)));
    const u4 = DB.subscribeLogs(l => setAllLogs(l.filter(x => x.endTime)));
    const u5 = DB.subscribeRework(setReworkEntries);
    const u6 = DB.subscribeActiveLogs(setActiveLogs);
    const u7 = DB.subscribePurchaseOrders(setAllPOs);
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); };
  }, []);

  // ── All clients — settings list PLUS every unique customer name ever used on a job.
  // This is the fix for "clients not showing in dropdown" — historically entered
  // customer names that weren't explicitly added to Settings → Clients were invisible.
  const allClients = useMemo(() => {
    const set = new Set<string>(clients.map(c => c.trim()).filter(Boolean));
    jobs.forEach(j => { if (j.customer?.trim()) set.add(j.customer.trim()); });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [clients, jobs]);

  // Open rework counts per job
  const reworkByJob = useMemo(() => {
    const m = new Map<string, { open: number; total: number }>();
    reworkEntries.forEach(r => {
      if (!r.jobId) return;
      const cur = m.get(r.jobId) || { open: 0, total: 0 };
      cur.total++;
      if (r.status !== 'resolved') cur.open++;
      m.set(r.jobId, cur);
    });
    return m;
  }, [reworkEntries]);

  const handleAdminStartJob = async (operation: string) => {
    if (!startJobModal) return;
    const targetWorker = selectedWorker || user;
    try {
      const logId = await DB.startTimeLog(startJobModal.id, targetWorker.id, targetWorker.name, operation, startJobModal.partNumber, startJobModal.customer, selectedMachine || undefined, undefined, startJobModal.jobIdsDisplay);
      if (logId) {
        const jobLabel = startJobModal.jobIdsDisplay || startJobModal.partNumber || startJobModal.id;
        showTimerStarted({ id: logId, userId: user.id, operation, startTime: Date.now() }, jobLabel);
      }
      // Smart auto-routing: clocking in on an operation advances the job to the
      // matching stage (e.g. "Washing" → Washing stage). Silent when no match.
      const stages = getStages(shopSettings);
      const target = findStageForOperation(operation, stages);
      if (target && shouldAutoRoute(startJobModal, target)) {
        try {
          await DB.advanceJobStage(startJobModal.id, target.id, targetWorker.id, targetWorker.name, false);
          addToast('info', `Job moved to ${target.label}`);
        } catch { /* silent — timer still started */ }
      }
      addToast('success', `Operation started${selectedMachine ? ` on ${selectedMachine}` : ''} for ${targetWorker.name}`);
      setStartJobModal(null);
      setSelectedWorker(null);
      setSelectedMachine(null);
    } catch (e: any) {
      addToast('error', 'Failed to start: ' + e.message);
    }
  };

  const today = todayFmt();
  const todayN = dateNum(today);
  const in3DaysN = dateNum(new Date(Date.now() + 3 * 86400000).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }));

  const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

  const filteredJobs = useMemo(() => {
    return jobs.filter(j => {
      const isCompleted = j.status === 'completed';
      if (activeTab === 'active' && isCompleted) return false;
      if (activeTab === 'completed' && !isCompleted) return false;
      if (filterPriority !== 'all' && j.priority !== filterPriority) return false;
      if (filterStatus !== 'all' && j.status !== filterStatus) return false;
      if (search) {
        const s = search.toLowerCase();
        return (j.poNumber || '').toLowerCase().includes(s) ||
               (j.partNumber || '').toLowerCase().includes(s) ||
               (j.jobIdsDisplay || '').toLowerCase().includes(s) ||
               (j.customer || '').toLowerCase().includes(s) ||
               (j.info || '').toLowerCase().includes(s);
      }
      return true;
    }).sort((a, b) => {
      if (activeTab === 'completed') return (b.completedAt || 0) - (a.completedAt || 0);
      if (sortBy === 'priority') return (priorityOrder[a.priority || 'normal'] ?? 2) - (priorityOrder[b.priority || 'normal'] ?? 2);
      if (sortBy === 'newest') return b.createdAt - a.createdAt;
      if (sortBy === 'oldest') return a.createdAt - b.createdAt;
      // dueDate sort: put jobs without due date at end
      const ad = a.dueDate ? dateNum(a.dueDate) : 99991231;
      const bd = b.dueDate ? dateNum(b.dueDate) : 99991231;
      return ad - bd;
    });
  }, [jobs, search, activeTab, filterPriority, filterStatus, sortBy]);

  const stats = useMemo(() => {
    const { startOfWeek, startOfMonth, startOfYear } = getDates();
    const completed = jobs.filter(j => j.status === 'completed' && j.completedAt);
    return {
      week: completed.filter(j => j.completedAt! >= startOfWeek).length,
      month: completed.filter(j => j.completedAt! >= startOfMonth).length,
      year: completed.filter(j => j.completedAt! >= startOfYear).length,
    };
  }, [jobs]);

  // Count active filters
  const activeFilterCount = [filterPriority !== 'all', filterStatus !== 'all', sortBy !== 'dueDate'].filter(Boolean).length;

  // ── SHOP BRAIN — per-job intelligence ──────────────────────────────────────
  // Stale: active job with no time log (or last log) older than 48h
  const staleJobIds = useMemo(() => {
    const STALE_MS = 48 * 3600000;
    const now = Date.now();
    const lastLogMs = new Map<string, number>();
    allLogs.forEach(l => {
      if (l.endTime && l.endTime > (lastLogMs.get(l.jobId) || 0)) lastLogMs.set(l.jobId, l.endTime);
    });
    const ids = new Set<string>();
    jobs.filter(j => j.status !== 'completed' && j.status !== 'hold').forEach(j => {
      const last = lastLogMs.get(j.id) || 0;
      const age = now - j.createdAt;
      if (age > STALE_MS && (now - last) > STALE_MS) ids.add(j.id);
    });
    return ids;
  }, [jobs, allLogs]);

  // ── ETA / risk map — computed once for the whole jobs view ──────────
  // Maps jobId → JobETA so every job card can show a risk badge instantly.
  const jobEtaMap = useMemo(() => {
    const openJobs = jobs.filter(j => j.status !== 'completed');
    const m = new Map<string, ReturnType<typeof computeJobETA>>();
    for (const job of openJobs) {
      const history = getPartHistory(job.partNumber || '', jobs, allLogs);
      m.set(job.id, computeJobETA(job, allLogs, activeLogs, history, DB.getWorkingElapsedMs));
    }
    return m;
  }, [jobs, allLogs, activeLogs]);

  // ── Capacity forecast — total queued hours vs this week's capacity ──
  const capacityForecast = useMemo(() => {
    const workerCount = Math.max(1, workers.length || activeLogs.length || 1);
    const activeCount = new Set(activeLogs.map(l => l.userId)).size;
    return computeCapacityForecast(jobEtaMap, workerCount, activeCount);
  }, [jobEtaMap, workers, activeLogs]);

  // Budget map: per-job { usedPct, overBudget, atRisk }
  const jobBudgetMap = useMemo(() => {
    const rate = shopSettings.shopRate || 0;
    const m = new Map<string, { usedPct: number; overBudget: boolean; atRisk: boolean; cost: number }>();
    if (!rate) return m;
    jobs.filter(j => j.quoteAmount && j.quoteAmount > 0).forEach(j => {
      const totalMins = allLogs.filter(l => l.jobId === j.id).reduce((a, l) => a + (l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0)), 0);
      const cost = (totalMins / 60) * rate;
      const usedPct = Math.min(999, (cost / j.quoteAmount!) * 100);
      m.set(j.id, { usedPct, overBudget: cost > j.quoteAmount!, atRisk: usedPct >= 70 && cost <= j.quoteAmount!, cost });
    });
    return m;
  }, [jobs, allLogs, shopSettings.shopRate]);

  // Smart job memory: same customer + part number → full history
  const priceSuggestion = useMemo(() => {
    const cust = (editingJob.customer || '').trim().toLowerCase();
    const part = (editingJob.partNumber || '').trim().toLowerCase();
    if (!cust || !part) return null;
    const matches = jobs.filter(j =>
      j.id !== editingJob.id &&
      (j.customer || '').trim().toLowerCase() === cust &&
      (j.partNumber || '').trim().toLowerCase() === part
    ).sort((a, b) => (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt));
    if (!matches.length) return null;
    const last = matches[0];
    // Total hours logged for the last completed run
    const lastLogs = allLogs.filter(l => l.jobId === last.id);
    const logMs = (l: TimeLog) => l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0);
    const totalMins = lastLogs.reduce((a, l) => a + logMs(l), 0);
    const totalHrs = totalMins / 60;
    // Average hours across all completed runs
    const completedRuns = matches.filter(j => j.status === 'completed');
    const avgHrs = completedRuns.length > 0
      ? completedRuns.reduce((sum, j) => {
          const mins = allLogs.filter(l => l.jobId === j.id).reduce((a, l) => a + logMs(l), 0);
          return sum + mins;
        }, 0) / completedRuns.length / 60
      : null;
    return {
      quoteAmount: last.quoteAmount || null,
      pricePerPart: last.pricePerPart || null,
      quantity: last.quantity || null,
      poNumber: last.poNumber,
      runCount: matches.length,
      completedCount: completedRuns.length,
      lastTotalHrs: totalHrs > 0 ? totalHrs : null,
      avgHrs,
      lastStatus: last.status,
      lastJob: last,
    };
  }, [jobs, allLogs, editingJob.customer, editingJob.partNumber, editingJob.id]);

  // ── Shop Brain auto-apply ──────────────────────────────────────────────
  // When customer + part number match a prior job, automatically fill in
  // empty fields from the last run. Never overwrites user input — only
  // populates blanks. Runs whenever the memory match changes.
  //
  // Applies to BOTH new and existing jobs: existing jobs created before
  // expectedHours started persisting are otherwise frozen with "—" on
  // their travelers forever. Filling missing fields nudges the user to
  // save once and the data carries forward everywhere.
  useEffect(() => {
    const patch: Partial<Job> = {};
    const filled: string[] = [];
    // 1. Expected hours — rate-based (partNumber-only) is preferred since
    //    it scales with quantity. Falls back to job-level avg from
    //    priceSuggestion when no rate samples exist. Runs as soon as part
    //    number + quantity are typed — customer not required.
    if (!editingJob.expectedHours && editingJob.partNumber && (editingJob.quantity || 0) > 0) {
      const rateEst = getRateBreakdownForJob(editingJob, allLogs, shopSettings.rateBuffer ?? 1.15);
      if (rateEst && rateEst.hasData && rateEst.totalHours > 0) {
        patch.expectedHours = parseFloat(rateEst.totalHours.toFixed(1));
        filled.push(`Est. ${patch.expectedHours}h (scaled to ${(editingJob.quantity || 0).toLocaleString()} pcs across ${rateEst.breakdown.length} ops)`);
      } else if (priceSuggestion) {
        const suggestedHrs = priceSuggestion.avgHrs ?? priceSuggestion.lastTotalHrs;
        if (suggestedHrs && suggestedHrs > 0) {
          patch.expectedHours = parseFloat(suggestedHrs.toFixed(1));
          filled.push(`Est. ${patch.expectedHours}h`);
        }
      }
    }
    // Price/instructions still need customer+part match (priceSuggestion)
    if (!priceSuggestion) {
      if (Object.keys(patch).length > 0) {
        setEditingJob(prev => ({ ...prev, ...patch }));
        addToast('info', `🧠 Filled from memory: ${filled.join(' · ')}. Save to keep.`);
      }
      return;
    }
    // 2. Price per part — last paid rate
    if (priceSuggestion.pricePerPart && !editingJob.pricePerPart && !editingJob.quoteAmount) {
      patch.pricePerPart = priceSuggestion.pricePerPart;
      const qty = editingJob.quantity || priceSuggestion.quantity || 0;
      if (qty > 0) patch.quoteAmount = parseFloat((priceSuggestion.pricePerPart * qty).toFixed(2));
      filled.push(`$${patch.pricePerPart.toFixed(2)}/part`);
    }
    // 3. Special instructions — carry forward from last run if blank
    const lastInstr = priceSuggestion.lastJob?.specialInstructions;
    if (lastInstr && lastInstr.trim() && !editingJob.specialInstructions) {
      patch.specialInstructions = lastInstr;
      filled.push('instructions');
    }
    if (Object.keys(patch).length > 0) {
      setEditingJob(prev => ({ ...prev, ...patch }));
      // Make the magic visible so the user knows to hit Save to keep it.
      addToast('info', `🧠 Filled from memory: ${filled.join(' · ')}. Save to keep.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceSuggestion?.poNumber, editingJob.partNumber, editingJob.quantity]);

  // Customer pipeline hint: does this customer have a custom stage pipeline?
  const customerPipelineHint = useMemo(() => {
    const cust = (editingJob.customer || '').trim();
    if (!cust) return null;
    const pipeline = shopSettings.customerPipelines?.[cust];
    if (!pipeline) return null;
    const stages = getStages(shopSettings);
    const customStages = pipeline.map(id => stages.find(s => s.id === id)).filter(Boolean) as typeof stages;
    const allStages = getStages(shopSettings);
    if (customStages.length === allStages.length) return null; // same as default, no hint needed
    return { customer: cust, stages: customStages };
  }, [editingJob.customer, shopSettings]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { addToast('error', 'Please select an image file'); return; }
    try {
      const compressed = await compressImage(file, 800, 0.6);
      // Check size — Firestore doc limit ~1MB, image should be well under
      if (compressed.length > 500_000) {
        const smaller = await compressImage(file, 500, 0.4);
        setEditingJob({ ...editingJob, partImage: smaller });
      } else {
        setEditingJob({ ...editingJob, partImage: compressed });
      }
      addToast('success', 'Part photo added');
    } catch {
      addToast('error', 'Failed to process image');
    }
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const handleSave = async () => {
    if (!editingJob.poNumber || !editingJob.partNumber) return addToast('error', 'PO and Part Number required');
    const today = new Date();
    // Format as MM/DD/YYYY — the app's canonical date format.
    // The old ISO-string approach produced YYYY-MM-DD which broke every dateNum() comparison.
    const localDate = `${String(today.getMonth()+1).padStart(2,'0')}/${String(today.getDate()).padStart(2,'0')}/${today.getFullYear()}`;
    const job: Job = {
      // Spread all existing fields FIRST so completedAt, jobNotes, checklist,
      // attachments, expectedHours, linkedQuoteId etc. survive a save in
      // localStorage mode (which does a full replace, not a merge like Firestore).
      ...(editingJob as Job),
      // Explicit fields below override the spread — these are the form-controlled values.
      id: editingJob.id || Date.now().toString(),
      jobIdsDisplay: editingJob.jobIdsDisplay || editingJob.poNumber || 'J-' + Date.now().toString().slice(-4),
      poNumber: editingJob.poNumber,
      partNumber: editingJob.partNumber,
      quantity: editingJob.quantity || 0,
      customer: editingJob.customer || '',
      priority: editingJob.priority || 'normal',
      dueDate: normDate(editingJob.dueDate) || '',
      info: editingJob.info || '',
      status: editingJob.status || 'in-progress',
      dateReceived: normDate(editingJob.dateReceived) || localDate,
      createdAt: editingJob.createdAt || Date.now(),
      quoteAmount: editingJob.quoteAmount || undefined,
      specialInstructions: editingJob.specialInstructions || '',
      partImage: editingJob.partImage || undefined,
      // Shipping
      shippingMethod: editingJob.shippingMethod || undefined,
      trackingNumber: editingJob.trackingNumber || undefined,
      shippingNotes: editingJob.shippingNotes || undefined,
      shippedAt: editingJob.shippedAt || undefined,
      // Pricing
      pricePerPart: editingJob.pricePerPart || undefined,
      // Time budget — must persist so traveler prints it and over-budget alerts work
      expectedHours: editingJob.expectedHours || undefined,
      // Material / consumable cost (entered during job lifecycle or at close-out)
      materialCost: editingJob.materialCost || undefined,
      // Stage
      currentStage: editingJob.currentStage || undefined,
      stageHistory: editingJob.stageHistory || undefined,
      // Portal note — only persist when text is non-empty so we don't
      // bloat the doc with empty shells on every save.
      portalNote: editingJob.portalNote?.text?.trim()
        ? { ...editingJob.portalNote, updatedAt: Date.now(), updatedBy: user?.name }
        : undefined,
    };
    try {
      const isNew = !editingJob.id;
      await DB.saveJob(job);
      setShowModal(false);
      setEditingJob({});
      if (isNew) {
        addToast('success', '✅ Job created — click it to add stages, shipping & checklist.');
      } else {
        addToast('success', 'Job saved');
      }
    }
    catch (e) { addToast('error', 'Save Failed'); }
  };

  // ── Complete a job — locks a profit snapshot immediately, no prompt needed.
  // Material costs are already baked into monthly overhead (settings.monthlyOverhead).
  const handleCompleteWithSnapshot = useCallback(async (j: Job) => {
    const stages = getStages(shopSettings);
    const completedStage = stages.find(s => s.isComplete);
    const breakdown = calcJobProfit(j, allLogs, workers, shopSettings, allPOs);
    const snapshot = buildProfitSnapshot(breakdown);
    if (completedStage) {
      await DB.advanceJobStage(j.id, completedStage.id, user.id, user.name, true);
    }
    await DB.completeJobWithSnapshot(j.id, j.materialCost ?? 0, snapshot);
    if (editingJob.id === j.id) {
      setEditingJob(prev => ({ ...prev, status: 'completed', currentStage: completedStage?.id || prev.currentStage, profitSnapshot: snapshot }));
    }
    const gradeMsg = breakdown.grade === 'great' ? '🟢 Great margin!' : breakdown.grade === 'good' ? '🔵 Good job' : breakdown.grade === 'tight' ? '🟡 Tight margin' : '🔴 Loss';
    addToast('success', `✅ "${j.poNumber}" complete — ${gradeMsg}`);
  }, [allLogs, workers, shopSettings, allPOs, user, editingJob]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            {calendarOnly ? <><Calendar className="w-6 h-6 text-amber-500" /> Production Calendar</> : <><Briefcase className="w-6 h-6 text-amber-500" /> Production Jobs</>}
          </h2>
          <p className="text-zinc-500 text-sm">{calendarOnly ? 'Month view of every job due date. Click a day to see what ships.' : 'Manage orders and track by PO, priority, and due date.'}</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <button onClick={() => { setEditingJob({}); setShowModal(true); }} className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 text-sm transition-all shadow-lg shadow-amber-900/20"><Plus className="w-4 h-4" /> New Job</button>
          <button onClick={() => setShowScanner(true)} title="Scan a PO document to auto-fill a new job" className="bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 text-sm transition-all"><Scan className="w-4 h-4 text-amber-400" /> Scan PO</button>
          <button
            onClick={() => setShowClientUpdate(true)}
            title="Generate a status message for a customer based on their open jobs"
            className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg font-bold border border-white/10 text-sm transition-all"
          >
            <FileText className="w-4 h-4" aria-hidden="true" /> Client Update
          </button>
        </div>
      </div>

      {/* Tab Bar — hidden when calendarOnly (dedicated /calendar route) */}
      {!calendarOnly && (
        <div className="inline-flex gap-1 p-1 bg-zinc-900/60 border border-white/5 rounded-xl">
          <button onClick={() => { setActiveTab('active'); setFilterStatus('all'); }} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'active' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-white'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${activeTab === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-700'}`} />
            Active Production
            <span className={`text-xs font-black px-2 py-0.5 rounded-full ${activeTab === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>{jobs.filter(j => j.status !== 'completed').length}</span>
          </button>
          <button onClick={() => { setActiveTab('completed'); setFilterStatus('all'); }} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'completed' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-white'}`}>
            <CheckCircle className={`w-3.5 h-3.5 ${activeTab === 'completed' ? 'text-amber-400' : 'text-zinc-600'}`} />
            Completed History
            <span className={`text-xs font-black px-2 py-0.5 rounded-full ${activeTab === 'completed' ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-800 text-zinc-500'}`}>{jobs.filter(j => j.status === 'completed').length}</span>
          </button>
        </div>
      )}

      {activeTab === 'completed' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-fade-in">
          <div className="bg-zinc-900/50 border border-emerald-500/20 p-4 rounded-2xl"><p className="text-xs font-bold text-emerald-500 uppercase tracking-wider mb-1">Completed This Week</p><p className="text-2xl sm:text-3xl font-black text-white">{stats.week}</p></div>
          <div className="bg-zinc-900/50 border border-white/5 p-4 rounded-2xl"><p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">Completed This Month</p><p className="text-2xl sm:text-3xl font-black text-white">{stats.month}</p></div>
          <div className="bg-zinc-900/50 border border-white/5 p-4 rounded-2xl"><p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">Completed This Year</p><p className="text-2xl sm:text-3xl font-black text-white">{stats.year}</p></div>
        </div>
      )}

      {/* Calendar View */}
      {activeTab === 'calendar' && (() => {
        const yr = calMonth.year, mo = calMonth.month;
        const firstDay = new Date(yr, mo, 1).getDay();
        const daysInMonth = new Date(yr, mo + 1, 0).getDate();
        const monthName = new Date(yr, mo, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
        const todayStr = todayFmt();
        const todayD = new Date();
        const isToday = (day: number) => todayD.getFullYear() === yr && todayD.getMonth() === mo && todayD.getDate() === day;

        // Group ALL jobs (including completed) by due date
        const jobsByDay: Record<number, Job[]> = {};
        jobs.filter(j => j.dueDate).forEach(j => {
          const dueD = parseDueDate(j.dueDate);
          if (!dueD) return;
          const jYr = dueD.getFullYear(), jMo = dueD.getMonth(), jDay = dueD.getDate();
          if (jYr === yr && jMo === mo) {
            if (!jobsByDay[jDay]) jobsByDay[jDay] = [];
            jobsByDay[jDay].push(j);
          }
        });

        const prevMonth = () => { setCalMonth(mo === 0 ? { year: yr - 1, month: 11 } : { year: yr, month: mo - 1 }); setCalSelectedDay(null); };
        const nextMonth = () => { setCalMonth(mo === 11 ? { year: yr + 1, month: 0 } : { year: yr, month: mo + 1 }); setCalSelectedDay(null); };
        const goToday = () => { const d = new Date(); setCalMonth({ year: d.getFullYear(), month: d.getMonth() }); setCalSelectedDay(d.getDate()); };

        const statusColor = (s?: string) => {
          if (s === 'completed') return 'bg-emerald-500';
          if (s === 'in-progress') return 'bg-blue-500';
          if (s === 'hold') return 'bg-yellow-500';
          return 'bg-zinc-500';
        };
        const statusLabel = (s?: string) => {
          if (s === 'completed') return 'Completed';
          if (s === 'in-progress') return 'In Progress';
          if (s === 'hold') return 'On Hold';
          return 'Pending';
        };

        // Stats for month
        const allMonthJobs = Object.values(jobsByDay).flat();
        const pendingCount = allMonthJobs.filter(j => j.status === 'pending').length;
        const inProgressCount = allMonthJobs.filter(j => j.status === 'in-progress').length;
        const completedCount = allMonthJobs.filter(j => j.status === 'completed').length;
        const overdueCount = allMonthJobs.filter(j => j.status !== 'completed' && j.dueDate && dateNum(j.dueDate) < dateNum(todayStr)).length;

        const selectedDayJobs = calSelectedDay ? (jobsByDay[calSelectedDay] || []) : [];
        const selectedDateStr = calSelectedDay ? new Date(yr, mo, calSelectedDay).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';

        const cells = [];
        for (let i = 0; i < firstDay; i++) cells.push(<div key={`e${i}`} className="min-h-[80px] md:min-h-[110px] bg-zinc-950/20 rounded" />);
        for (let d = 1; d <= daysInMonth; d++) {
          const dayJobs = jobsByDay[d] || [];
          const past = dateNum(`${String(mo+1).padStart(2,'0')}/${String(d).padStart(2,'0')}/${yr}`) < dateNum(todayStr);
          const selected = calSelectedDay === d;
          const hasOverdue = dayJobs.some(j => j.status !== 'completed') && past;
          cells.push(
            <div key={d} onClick={() => setCalSelectedDay(selected ? null : d)}
              className={`min-h-[80px] md:min-h-[110px] border p-1.5 md:p-2 rounded-lg cursor-pointer transition-all ${selected ? 'bg-blue-500/20 border-blue-500/50 ring-1 ring-blue-500/30' : isToday(d) ? 'bg-blue-500/10 border-blue-500/30' : past ? 'bg-zinc-950/40 border-white/5' : 'bg-zinc-900/30 border-white/5 hover:bg-zinc-800/40 hover:border-white/10'}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-sm font-bold ${selected ? 'text-blue-300' : isToday(d) ? 'text-blue-400' : past ? 'text-zinc-600' : 'text-zinc-400'}`}>{d}</span>
                {dayJobs.length > 0 && (
                  <div className="flex gap-0.5 items-center">
                    {hasOverdue && <span className="w-2 h-2 rounded-full bg-red-500" />}
                    <span className="text-[10px] bg-zinc-700/80 text-zinc-300 px-1.5 py-0.5 rounded font-bold">{dayJobs.length}</span>
                  </div>
                )}
              </div>
              <div className="space-y-0.5 overflow-hidden max-h-[64px]">
                {dayJobs.slice(0, 4).map(j => (
                  <div key={j.id} className="flex items-center gap-1 text-[10px] truncate">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor(j.status)}`} />
                    <span className={`truncate font-medium ${j.status === 'completed' ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}>{j.poNumber}</span>
                  </div>
                ))}
                {dayJobs.length > 4 && <p className="text-[9px] text-zinc-600 font-bold">+{dayJobs.length - 4} more</p>}
              </div>
            </div>
          );
        }

        return (
          <div className="animate-fade-in">
            {/* Month Stats Bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3 text-center">
                <p className="text-xs text-zinc-500 uppercase font-bold tracking-wider">Pending</p>
                <p className="text-2xl font-black text-zinc-300">{pendingCount}</p>
              </div>
              <div className="bg-zinc-900/50 border border-blue-500/20 rounded-xl p-3 text-center">
                <p className="text-xs text-blue-400 uppercase font-bold tracking-wider">In Progress</p>
                <p className="text-2xl font-black text-blue-400">{inProgressCount}</p>
              </div>
              <div className="bg-zinc-900/50 border border-emerald-500/20 rounded-xl p-3 text-center">
                <p className="text-xs text-emerald-400 uppercase font-bold tracking-wider">Completed</p>
                <p className="text-2xl font-black text-emerald-400">{completedCount}</p>
              </div>
              <div className="bg-zinc-900/50 border border-red-500/20 rounded-xl p-3 text-center">
                <p className="text-xs text-red-400 uppercase font-bold tracking-wider">Overdue</p>
                <p className="text-2xl font-black text-red-400">{overdueCount}</p>
              </div>
            </div>

            {/* Month nav */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <button aria-label="Previous month" onClick={prevMonth} className="p-2.5 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white min-w-[40px] min-h-[40px]"><ChevronLeft className="w-5 h-5" aria-hidden="true" /></button>
                <h3 className="text-xl font-black text-white min-w-[220px] text-center" aria-live="polite">{monthName}</h3>
                <button aria-label="Next month" onClick={nextMonth} className="p-2.5 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white min-w-[40px] min-h-[40px]"><ChevronRight className="w-5 h-5" aria-hidden="true" /></button>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={goToday} className="text-xs text-amber-400 hover:text-amber-300 font-bold px-3 py-1.5 rounded-lg hover:bg-amber-500/10 border border-amber-500/20">Today</button>
                <div className="hidden md:flex items-center gap-3 text-[10px] text-zinc-500">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-zinc-500" /> Pending</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> Active</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Done</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Overdue</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-4">
              {/* Calendar Grid */}
              <div className={`${calSelectedDay ? 'flex-1' : 'w-full'} transition-all`}>
                <div className="grid grid-cols-7 gap-1 mb-2">
                  {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
                    <div key={d} className="text-center text-xs font-bold text-zinc-500 uppercase py-1.5">{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">{cells}</div>
              </div>

              {/* Day Detail Panel */}
              {calSelectedDay && (
                <div className="w-full md:w-96 bg-zinc-900/50 border border-white/5 rounded-xl p-5 animate-fade-in flex-shrink-0 max-h-[500px] md:max-h-[620px] overflow-y-auto">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-white font-bold">{selectedDateStr}</p>
                      <p className="text-xs text-zinc-500">{selectedDayJobs.length} job{selectedDayJobs.length !== 1 ? 's' : ''} due</p>
                    </div>
                    <button onClick={() => setCalSelectedDay(null)} className="p-1 hover:bg-white/10 rounded-lg text-zinc-500 hover:text-white"><X className="w-4 h-4" /></button>
                  </div>

                  {selectedDayJobs.length === 0 ? (
                    <div className="text-center py-8 text-zinc-600">
                      <Calendar className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No jobs due this day</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selectedDayJobs.map(j => {
                        const isOverdue = j.status !== 'completed' && dateNum(j.dueDate) < dateNum(todayStr);
                        const jobLogs = allLogs.filter(l => l.jobId === j.id);
                        const totalMins = jobLogs.reduce((a, l) => a + (l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0)), 0);
                        return (
                          <div key={j.id} onClick={() => { setEditingJob(j); setShowModal(true); }}
                            className="bg-zinc-800/50 border border-white/5 rounded-lg p-3 cursor-pointer hover:bg-zinc-800 hover:border-white/10 transition-all">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-white font-black text-sm">{j.poNumber}</span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${j.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' : j.status === 'in-progress' ? 'bg-blue-500/20 text-blue-400' : isOverdue ? 'bg-red-500/20 text-red-400' : 'bg-zinc-700 text-zinc-400'}`}>
                                {isOverdue ? 'OVERDUE' : statusLabel(j.status).toUpperCase()}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mb-1">
                              {j.partImage && <img src={j.partImage} className="w-8 h-8 rounded object-cover border border-white/10" alt="" />}
                              <div>
                                <p className="text-xs text-zinc-300 font-bold">{j.partNumber}</p>
                                <p className="text-[10px] text-zinc-500">{j.customer || 'No customer'}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 text-[10px] text-zinc-500 mt-2">
                              <span>Qty: {j.quantity}</span>
                              {totalMins > 0 && <span>{(totalMins / 60).toFixed(1)}h logged</span>}
                              {j.quoteAmount ? <span className="text-emerald-400">${j.quoteAmount}</span> : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Filter Bar */}
      {activeTab !== 'calendar' && <><div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4 space-y-3">
        {/* Search + Filter Toggle Row */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search PO, Job ID, Part, Customer, Notes..."
              className="w-full bg-zinc-950 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-sm text-white focus:ring-2 focus:ring-amber-500 outline-none"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-bold transition-all ${showFilters || activeFilterCount > 0 ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'border-white/10 text-zinc-400 hover:text-white hover:border-white/20'}`}
          >
            <Filter className="w-4 h-4" />
            Filters
            {activeFilterCount > 0 && <span className="bg-amber-500 text-white text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center">{activeFilterCount}</span>}
          </button>
        </div>

        {/* ── Saved Views Bar (Jobs R1 #4) ── */}
        {(savedViews.length > 0 || activeFilterCount > 0 || search) && (
          <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-white/5">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest shrink-0">📌 Views</span>
            {savedViews.map(v => {
              const isActive = v.search === search && v.priority === filterPriority && v.status === filterStatus && v.sortBy === sortBy && v.tab === activeTab;
              return (
                <button
                  key={v.id}
                  onClick={() => {
                    setSearch(v.search);
                    setFilterPriority(v.priority);
                    setFilterStatus(v.status);
                    setSortBy(v.sortBy);
                    setActiveTab(v.tab);
                  }}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border flex items-center gap-1.5 transition-colors ${isActive ? 'bg-amber-500/15 border-amber-500/30 text-amber-400' : 'bg-zinc-900 border-white/10 text-zinc-400 hover:text-white hover:border-white/20'}`}
                >
                  {v.name}
                  <X className="w-3 h-3 opacity-50 hover:opacity-100" onClick={(e) => { e.stopPropagation(); setSavedViews(savedViews.filter(x => x.id !== v.id)); }} />
                </button>
              );
            })}
            {(activeFilterCount > 0 || search) && (
              <button
                onClick={async () => {
                  const suggested = search
                    ? `"${search}" ${filterStatus !== 'all' ? filterStatus : ''}`.trim()
                    : `${filterStatus !== 'all' ? filterStatus : 'custom'} ${filterPriority !== 'all' ? filterPriority : ''}`.trim();
                  const name = await askName({
                    title: 'Save this view',
                    message: 'Name this filter so you can jump back to it from the Saved Views row.',
                    placeholder: 'e.g. Urgent overdue',
                    defaultValue: suggested,
                    confirmLabel: 'Save view',
                  });
                  if (!name) return;
                  const v: SavedView = { id: `v_${Date.now()}`, name, search, priority: filterPriority, status: filterStatus, sortBy, tab: activeTab === 'calendar' ? 'active' : activeTab };
                  setSavedViews([...savedViews, v]);
                }}
                className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/20 px-2.5 py-1 rounded-lg flex items-center gap-1"
              >
                <Plus className="w-3 h-3" aria-hidden="true" /> Save as view
              </button>
            )}
          </div>
        )}

        {/* Expanded Filters */}
        {showFilters && (
          <div className="flex flex-wrap gap-3 pt-2 border-t border-white/5 animate-fade-in">
            {/* Priority Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Priority</label>
              <div className="flex gap-1">
                {(['all', 'urgent', 'high', 'normal', 'low'] as const).map(p => (
                  <button key={p} onClick={() => setFilterPriority(p)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all capitalize border ${
                      filterPriority === p
                        ? p === 'urgent' ? 'bg-red-500/20 border-red-500/40 text-red-400'
                          : p === 'high' ? 'bg-orange-500/20 border-orange-500/40 text-orange-400'
                          : p === 'low' ? 'bg-zinc-700 border-white/10 text-zinc-300'
                          : 'bg-zinc-700 border-white/10 text-white'
                        : 'border-white/5 text-zinc-500 hover:text-zinc-300'
                    }`}
                  >{p === 'all' ? 'All' : p}</button>
                ))}
              </div>
            </div>

            {/* Status Filter (active tab only) */}
            {activeTab === 'active' && (
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Status</label>
                <div className="flex gap-1">
                  {(['all', 'pending', 'in-progress', 'hold'] as const).map(s => (
                    <button key={s} onClick={() => setFilterStatus(s)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all capitalize border ${filterStatus === s ? 'bg-zinc-700 border-white/20 text-white' : 'border-white/5 text-zinc-500 hover:text-zinc-300'}`}
                    >{s === 'all' ? 'All' : s}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Sort */}
            {activeTab === 'active' && (
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Sort By</label>
                <div className="flex gap-1">
                  {([
                    { key: 'dueDate', label: 'Due Date' },
                    { key: 'priority', label: 'Priority' },
                    { key: 'newest', label: 'Newest' },
                    { key: 'oldest', label: 'Oldest' },
                  ] as const).map(s => (
                    <button key={s.key} onClick={() => setSortBy(s.key)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all border ${sortBy === s.key ? 'bg-zinc-700 border-white/20 text-white' : 'border-white/5 text-zinc-500 hover:text-zinc-300'}`}
                    >{s.label}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Clear Filters */}
            {activeFilterCount > 0 && (
              <div className="flex flex-col justify-end">
                <button onClick={() => { setFilterPriority('all'); setFilterStatus('all'); setSortBy('dueDate'); }}
                  className="px-3 py-1 text-xs text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/10 transition-colors font-bold">
                  Clear Filters
                </button>
              </div>
            )}
          </div>
        )}

        {/* Results count */}
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>{filteredJobs.length} job{filteredJobs.length !== 1 ? 's' : ''} shown</span>
          {filteredJobs.filter(j => j.dueDate && dateNum(j.dueDate) < todayN && j.status !== 'completed').length > 0 && (
            <span className="text-red-400 font-bold flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {filteredJobs.filter(j => j.dueDate && dateNum(j.dueDate) < todayN && j.status !== 'completed').length} overdue
            </span>
          )}
        </div>
      </div>

      {/* ── Bulk Action Bar (Jobs R1 #5) — appears when rows are selected ── */}
      {selectedJobIds.size > 0 && (
        <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/5 border border-amber-500/25 rounded-xl p-3 flex items-center gap-3 flex-wrap animate-fade-in">
          <span className="text-sm font-bold text-white flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-amber-400" aria-hidden="true" />
            {selectedJobIds.size} selected
          </span>
          <button
            type="button"
            onClick={() => setSelectedJobIds(new Set())}
            className="text-xs text-zinc-400 hover:text-white px-2 py-1 rounded"
          >
            Clear
          </button>
          <div className="h-5 w-px bg-white/20" />
          {/* Batch: set priority */}
          <div className="inline-flex gap-1 p-0.5 bg-zinc-900/60 border border-white/5 rounded-lg">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest px-2 py-1">Priority:</span>
            {(['urgent','high','normal','low'] as const).map(p => (
              <button
                key={p}
                type="button"
                onClick={async () => {
                  const ids: string[] = Array.from(selectedJobIds);
                  await Promise.all(ids.map(id => {
                    const job = jobs.find(x => x.id === id);
                    if (!job) return Promise.resolve();
                    return DB.saveJob({ ...job, priority: p });
                  }));
                  addToast('success', `Set ${ids.length} job${ids.length > 1 ? 's' : ''} to ${p}`);
                  setSelectedJobIds(new Set());
                }}
                className={`text-[11px] font-bold px-2 py-1 rounded capitalize ${p === 'urgent' ? 'text-red-400 hover:bg-red-500/10' : p === 'high' ? 'text-orange-400 hover:bg-orange-500/10' : p === 'low' ? 'text-zinc-500 hover:bg-zinc-700' : 'text-zinc-400 hover:bg-zinc-700'}`}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="h-5 w-px bg-white/20" />
          {/* Batch: advance to next stage */}
          <button
            type="button"
            onClick={async () => {
              const stages = getStages(shopSettings);
              const ids: string[] = Array.from(selectedJobIds);
              await Promise.all(ids.map(async id => {
                const job = jobs.find(x => x.id === id);
                if (!job) return;
                const next = getNextStage(job, stages);
                if (next) {
                  await DB.advanceJobStage(id, next.id, user.id, user.name, next.isComplete);
                }
              }));
              addToast('success', `Advanced ${ids.length} job${ids.length > 1 ? 's' : ''} to next stage`);
              setSelectedJobIds(new Set());
            }}
            className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/20 px-3 py-1 rounded-lg flex items-center gap-1"
          >
            <ArrowRight className="w-3 h-3" aria-hidden="true" /> Advance Stage
          </button>
          {/* Batch: print travelers */}
          <button
            type="button"
            onClick={() => {
              const ids: string[] = Array.from(selectedJobIds);
              ids.forEach(id => {
                const job = jobs.find(x => x.id === id);
                if (job) {
                  const buf = shopSettings.rateBuffer ?? 1.15;
                  const enriched = enrichJobForPrint(job, jobs, allLogs, buf);
                  printJobTravelerPDF(
                    enriched,
                    shopSettings,
                    getPartHistory(job.partNumber || '', jobs, allLogs),
                    getRateBreakdownForJob(enriched, allLogs, buf),
                  );
                }
              });
              addToast('info', `Generated ${ids.length} traveler${ids.length > 1 ? 's' : ''}`);
            }}
            className="text-[11px] font-bold text-zinc-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1 rounded-lg flex items-center gap-1"
          >
            <Printer className="w-3 h-3" aria-hidden="true" /> Print Travelers
          </button>
          {/* Batch: delete (danger) */}
          <button
            type="button"
            onClick={() => {
              const ids: string[] = Array.from(selectedJobIds);
              confirm({
                title: `Delete ${ids.length} jobs?`,
                message: `This permanently deletes ${ids.length} job${ids.length > 1 ? 's' : ''}. Cannot be undone.`,
                onConfirm: async () => {
                  await Promise.all(ids.map(id => DB.deleteJob(id)));
                  addToast('success', `Deleted ${ids.length} jobs`);
                  setSelectedJobIds(new Set());
                }
              });
            }}
            className="text-[11px] font-bold text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/15 border border-red-500/20 px-3 py-1 rounded-lg flex items-center gap-1 ml-auto"
          >
            <Trash2 className="w-3 h-3" aria-hidden="true" /> Delete
          </button>
        </div>
      )}

      <div className="bg-zinc-900/30 border border-white/5 rounded-2xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm text-left">
          <thead className="bg-zinc-950/50 text-zinc-500 uppercase tracking-wider font-bold text-[10px] sm:text-xs">
            <tr>
              <th className="p-2 sm:p-3 w-8">
                <input
                  type="checkbox"
                  aria-label="Select all jobs on this view"
                  checked={filteredJobs.length > 0 && filteredJobs.every(j => selectedJobIds.has(j.id))}
                  ref={el => { if (el) el.indeterminate = selectedJobIds.size > 0 && !filteredJobs.every(j => selectedJobIds.has(j.id)); }}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedJobIds(new Set(filteredJobs.map(j => j.id)));
                    else setSelectedJobIds(new Set());
                  }}
                  className="w-4 h-4 rounded accent-amber-500 cursor-pointer"
                />
              </th>
              <th className="p-2 sm:p-4">PO / Job</th>
              <th className="p-3 sm:p-4 hidden md:table-cell">Part Details</th>
              <th className="p-3 sm:p-4 hidden sm:table-cell">Qty</th>
              <th className="p-3 sm:p-4 hidden lg:table-cell">Priority</th>
              <th className="p-3 sm:p-4 hidden md:table-cell">Status</th>
              <th className="p-2 sm:p-4">Due</th>
              <th className="p-1.5 sm:p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filteredJobs.map(j => {
              const isOverdue = j.status !== 'completed' && j.dueDate && dateNum(j.dueDate) < todayN;
              const isDueSoon = j.status !== 'completed' && j.dueDate && dateNum(j.dueDate) >= todayN && dateNum(j.dueDate) <= in3DaysN;
              // Historical on-time / late for completed jobs
              const _dueD = j.dueDate ? parseDueDate(j.dueDate) : null;
              const _dueMs = _dueD ? (_dueD.setHours(23,59,59,999), _dueD.getTime()) : null;
              const deliveredLate = j.status === 'completed' && _dueMs != null && j.completedAt != null && j.completedAt > _dueMs;
              const deliveredOnTime = j.status === 'completed' && _dueMs != null && j.completedAt != null && j.completedAt <= _dueMs;
              // Brain signals
              const isStale = staleJobIds.has(j.id);
              const budget = jobBudgetMap.get(j.id);
              // Job costing — per-worker rates (prefer durationSeconds for precision)
              const jobLogs = allLogs.filter(l => l.jobId === j.id);
              const logMins2 = (l: TimeLog) => l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0);
              const totalMins = jobLogs.reduce((a, l) => a + logMins2(l), 0);
              const totalHrs = totalMins / 60;
              const fallbackRate = shopSettings.shopRate || 0;
              const overheadRate = (shopSettings.monthlyOverhead || 0) / (shopSettings.monthlyWorkHours || 160);
              const laborCost = jobLogs.reduce((acc, l) => {
                const w = workers.find(w => w.id === l.userId);
                const r = w?.hourlyRate || fallbackRate;
                return acc + (logMins2(l) / 60) * r;
              }, 0);
              const overheadCost = totalHrs * overheadRate;
              const totalCost = laborCost + overheadCost;
              const hasQuote = (j.quoteAmount || 0) > 0;
              const profit = hasQuote ? (j.quoteAmount || 0) - totalCost : null;
              return (
                <tr key={j.id} className={`hover:bg-white/5 transition-colors group cursor-pointer ${isOverdue ? 'bg-red-500/5' : ''} ${selectedJobIds.has(j.id) ? 'bg-amber-500/5' : ''}`} onClick={() => { setEditingJob(j); setShowModal(true); }}>
                  <td className="p-2 sm:p-3 w-8" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${j.poNumber}`}
                      checked={selectedJobIds.has(j.id)}
                      onChange={(e) => {
                        const next = new Set(selectedJobIds);
                        if (e.target.checked) next.add(j.id);
                        else next.delete(j.id);
                        setSelectedJobIds(next);
                      }}
                      className="w-4 h-4 rounded accent-amber-500 cursor-pointer"
                    />
                  </td>
                  <td className="p-2 sm:p-4">
                    <div className="flex items-start gap-2.5">
                      {/* Part Photo thumbnail — always visible (mobile + desktop).
                          Tap to enlarge. Camera icon placeholder → tap to add. */}
                      {j.partImage ? (
                        <img
                          src={j.partImage}
                          alt={`${j.partNumber} reference`}
                          className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg object-cover border border-white/10 hover:border-cyan-500/60 transition-all flex-shrink-0 cursor-pointer"
                          onClick={(e) => { e.stopPropagation(); setLightboxImg(j.partImage!); }}
                        />
                      ) : (
                        <label
                          className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg border border-dashed border-white/10 flex items-center justify-center cursor-pointer hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all flex-shrink-0 group/cam"
                          title="Add part photo"
                          onClick={e => e.stopPropagation()}
                        >
                          <Camera className="w-4 h-4 sm:w-5 sm:h-5 text-zinc-600 group-hover/cam:text-cyan-400" aria-hidden="true" />
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0]; if (!file) return;
                              const compressed = await compressImage(file, 800, 0.6);
                              const updated = { ...j, partImage: compressed };
                              await DB.saveJob(updated);
                              addToast('success', 'Photo added');
                            }}
                          />
                        </label>
                      )}
                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                        <span className="text-white font-black text-sm sm:text-xl">{j.poNumber}</span>
                        {isOverdue && <span className="text-[10px] font-black text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded">OVERDUE</span>}
                        {isDueSoon && !isOverdue && <span className="text-[10px] font-black text-orange-400 bg-orange-500/10 border border-orange-500/20 px-1.5 py-0.5 rounded">DUE SOON</span>}
                        {deliveredOnTime && <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">ON TIME</span>}
                        {deliveredLate && <span className="text-[10px] font-black text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded">LATE</span>}
                        {budget?.overBudget && <span className="text-[10px] font-black text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded" title={`${budget.usedPct.toFixed(0)}% of quote used`}>OVER BUDGET</span>}
                        {budget?.atRisk && !budget.overBudget && <span className="text-[10px] font-black text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-1.5 py-0.5 rounded" title={`${budget.usedPct.toFixed(0)}% of quote used`}>AT RISK</span>}
                        {isStale && j.status !== 'completed' && <span className="text-[10px] font-black text-zinc-500 bg-zinc-800/60 border border-zinc-700/60 px-1.5 py-0.5 rounded" title="No activity in 48+ hours">STALE</span>}
                        {/* RUSH badge — job was created with very little lead time (<= 5 days before due) */}
                        {j.status !== 'completed' && j.dueDate && j.createdAt && (() => {
                          const _dueD2 = parseDueDate(j.dueDate); if (!_dueD2) return null;
                          _dueD2.setHours(23,59,59,999); const dueDateMs = _dueD2.getTime();
                          const leadDays = (dueDateMs - j.createdAt) / 86400000;
                          if (leadDays > 5) return null;
                          return (
                            <span className="text-[10px] font-black text-red-300 bg-red-600/20 border border-red-500/40 px-1.5 py-0.5 rounded animate-pulse" title={`Only ${leadDays < 1 ? '<1 day' : Math.ceil(leadDays) + ' days'} lead time`}>
                              RUSH
                            </span>
                          );
                        })()}
                        {/* ETA risk badge — only for open jobs where the engine has a meaningful signal */}
                        {(() => {
                          if (j.status === 'completed') return null;
                          const eta = jobEtaMap.get(j.id);
                          if (!eta) return null;
                          // 'critical' already surfaced by OVERDUE badge; 'on-track'/'no-data' are noise
                          if (eta.riskLevel !== 'at-risk' && eta.riskLevel !== 'watch') return null;
                          const c = RISK_COLORS[eta.riskLevel];
                          return (
                            <span
                              className={`text-[10px] font-black px-1.5 py-0.5 rounded border ${c.bg} ${c.border} ${c.text}`}
                              title={`ETA: ${eta.riskReason}`}
                            >
                              {eta.riskLevel === 'at-risk' ? 'PACE RISK' : 'WATCH'}
                            </span>
                          );
                        })()}
                        {/* Live worker indicators — who's clocked in right now */}
                        {activeLogs.filter(l => l.jobId === j.id).map(l => (
                          <span key={l.id} className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full" title={`${l.userName} — ${l.operation}`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                            {l.userName.split(' ')[0]}
                          </span>
                        ))}
                      </div>
                      <span className="text-zinc-600 font-mono text-[10px] sm:text-[11px] truncate max-w-[160px] sm:max-w-none">Job ID: {j.jobIdsDisplay}</span>
                      {/* Below sm (< 640px): Qty + Customer + Part Details columns are
                          all hidden, so surface all three inline in the PO cell. Without
                          this, mobile users can't see quantity without opening details. */}
                      <span className="sm:hidden text-zinc-400 text-xs truncate max-w-[220px]">
                        {j.partNumber}
                        {j.quantity ? <> · <span className="font-bold text-zinc-300">Qty {j.quantity}</span></> : null}
                        {user.role === 'admin' && j.customer ? <> · {j.customer}</> : null}
                      </span>
                      {/* Between sm and md (640–768px): Qty column is visible now, but
                          the Part Details column (which has customer) is still hidden.
                          Show part number + customer inline. */}
                      <span className="hidden sm:inline md:hidden text-zinc-400 text-xs truncate max-w-[260px]">
                        {j.partNumber}
                        {user.role === 'admin' && j.customer ? <> · {j.customer}</> : null}
                      </span>
                      {/* Jobs R1 badges: checklist progress + attachments + time budget */}
                      {((j.checklist?.length || 0) > 0 || (j.attachments?.length || 0) > 0 || (j.expectedHours || 0) > 0) && (
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {(j.checklist?.length || 0) > 0 && (() => {
                            const total = j.checklist!.length;
                            const done = j.checklist!.filter(c => c.done).length;
                            const pct = Math.round((done / total) * 100);
                            return (
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${pct === 100 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-purple-400 bg-purple-500/10 border-purple-500/20'}`} title={`${done} of ${total} operations complete`}>
                                ✓ {done}/{total} {pct === 100 ? '· Done' : ''}
                              </span>
                            );
                          })()}
                          {(j.attachments?.length || 0) > 0 && (
                            <span className="text-[9px] font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded" title={`${j.attachments!.length} attached file(s)`}>
                              📎 {j.attachments!.length}
                            </span>
                          )}
                          {(j.expectedHours || 0) > 0 && totalHrs > 0 && (() => {
                            const ratio = totalHrs / j.expectedHours!;
                            const state = ratio > 1.1 ? 'over' : ratio > 0.9 ? 'near' : 'under';
                            const cls = state === 'over' ? 'text-red-400 bg-red-500/10 border-red-500/20' : state === 'near' ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
                            return (
                              <span className={`text-[9px] font-bold border px-1.5 py-0.5 rounded tabular ${cls}`} title={`Budget: ${j.expectedHours}h · Actual: ${totalHrs.toFixed(1)}h`}>
                                ⏱ {totalHrs.toFixed(1)}/{j.expectedHours}h
                              </span>
                            );
                          })()}
                          {(j.expectedHours || 0) > 0 && totalHrs === 0 && (
                            <span className="text-[9px] font-bold text-zinc-500 bg-zinc-800/60 border border-white/5 px-1.5 py-0.5 rounded tabular" title={`Budgeted ${j.expectedHours}h`}>
                              ⏱ {j.expectedHours}h budget
                            </span>
                          )}
                        </div>
                      )}
                      {/* Inline notes preview — shows most recent non-empty note with count badge */}
                      {j.jobNotes && j.jobNotes.length > 0 && (() => {
                        const latest = [...j.jobNotes].filter(n => n && n.text?.trim()).sort((a, b) => b.timestamp - a.timestamp)[0];
                        if (!latest) return null;
                        const text = latest.text.trim();
                        const preview = text.length > 60 ? text.slice(0, 60) + '…' : text;
                        return (
                          <div className="mt-1 flex items-start gap-1.5 text-[11px] text-zinc-400 max-w-[200px] sm:max-w-[400px] min-w-0">
                            <MessageSquare className="w-3 h-3 text-zinc-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
                            <span className="italic truncate min-w-0"><span className="text-zinc-500 not-italic font-semibold">{latest.userName?.split(' ')[0] || 'Note'}:</span> {preview}</span>
                            {j.jobNotes.length > 1 && (
                              <span className="text-[9px] font-black text-zinc-500 bg-zinc-800 px-1 py-0.5 rounded flex-shrink-0">+{j.jobNotes.length - 1}</span>
                            )}
                          </div>
                        );
                      })()}
                      {j.specialInstructions && (
                        <div className="mt-0.5 flex items-start gap-1.5 text-[11px] text-amber-400/80 max-w-[200px] sm:max-w-[400px] min-w-0">
                          <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" aria-hidden="true" />
                          <span className="truncate italic min-w-0">{j.specialInstructions.length > 60 ? j.specialInstructions.slice(0, 60) + '…' : j.specialInstructions}</span>
                        </div>
                      )}
                      {j.status === 'completed' && (() => {
                        const snap = j.profitSnapshot;
                        if (snap) {
                          const marginColor = snap.marginPct >= 35 ? 'text-emerald-400 bg-emerald-500/10' : snap.marginPct >= 15 ? 'text-blue-400 bg-blue-500/10' : snap.marginPct >= 0 ? 'text-yellow-400 bg-yellow-500/10' : 'text-red-400 bg-red-500/10';
                          return (
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${marginColor}`}>
                                {snap.profit >= 0 ? '+' : ''}${Math.abs(snap.profit).toFixed(0)} · {snap.marginPct.toFixed(0)}% margin
                              </span>
                              <span className="text-[9px] text-zinc-600">locked</span>
                            </div>
                          );
                        }
                        if (totalMins > 0) return (
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] font-mono text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">{totalHrs.toFixed(1)}h · ${totalCost.toFixed(0)} cost</span>
                            {profit !== null && (
                              <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${profit >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                                {profit >= 0 ? '+' : '-'}${Math.abs(profit).toFixed(0)} profit
                              </span>
                            )}
                          </div>
                        );
                        return null;
                      })()}
                      </div>
                    </div>
                  </td>
                  <td className="p-3 sm:p-4 hidden md:table-cell">
                    <div className="flex items-center gap-2.5">
                      {j.partImage ? (
                        <img src={j.partImage} alt="Part" className="w-10 h-10 rounded-lg object-cover border border-white/10 cursor-pointer hover:border-cyan-500/50 hover:scale-110 transition-all flex-shrink-0" onClick={(e) => { e.stopPropagation(); setLightboxImg(j.partImage!); }} />
                      ) : (
                        <label className="w-10 h-10 rounded-lg border border-dashed border-white/10 flex items-center justify-center cursor-pointer hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all flex-shrink-0 group" title="Add part photo" onClick={e => e.stopPropagation()}>
                          <Camera className="w-4 h-4 text-zinc-600 group-hover:text-cyan-400" />
                          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => {
                            const file = e.target.files?.[0]; if (!file) return;
                            const compressed = await compressImage(file, 800, 0.6);
                            const updated = { ...j, partImage: compressed }; await DB.saveJob(updated);
                            addToast('success', 'Photo added');
                          }} />
                        </label>
                      )}
                      <div>
                        <div className="text-zinc-300 font-bold">{j.partNumber}</div>
                        <div className="text-xs text-zinc-500 mt-0.5">{user.role === 'admin' ? j.customer : '***'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 sm:p-4 font-mono text-zinc-300 hidden sm:table-cell">{j.quantity}</td>
                  <td className="p-3 sm:p-4 hidden lg:table-cell"><PriorityBadge priority={j.priority} /></td>
                  <td className="p-3 sm:p-4 hidden md:table-cell"><StatusBadge status={j.status} job={j} stages={getStages(shopSettings)} /></td>
                  <td className={`p-2 sm:p-4 sm:whitespace-nowrap text-[11px] sm:text-sm ${isOverdue ? 'text-red-400' : isDueSoon ? 'text-orange-400' : 'text-zinc-400'}`}>
                    <div className="font-mono font-bold">{fmt(j.dueDate)}</div>
                    {j.dueDate && j.status !== 'completed' && (() => {
                      const bizDays = businessDaysUntilSync(j.dueDate);
                      const isHol = j.dueDate ? isHolidaySync(j.dueDate) : false;
                      return (
                        <div className="flex flex-col gap-0.5 mt-0.5">
                          {bizDays !== null && (
                            <span className={`text-[9px] font-bold ${bizDays < 0 ? 'text-red-500' : bizDays <= 2 ? 'text-orange-400' : 'text-zinc-600'}`}>
                              {bizDays < 0 ? `${Math.abs(bizDays)}bd late` : bizDays === 0 ? 'due today' : `${bizDays} biz days`}
                            </span>
                          )}
                          {isHol && (
                            <span className="text-[9px] font-bold text-yellow-400" title="Due date falls on a US holiday">🏖 Holiday</span>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="p-1.5 sm:p-4 text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-end gap-1 sm:gap-2 flex-wrap sm:flex-nowrap">
                      <button aria-label="Start operation" onClick={() => setStartJobModal(j)} className="p-2 bg-amber-500/10 text-amber-500 rounded-lg hover:bg-amber-500 hover:text-white transition-colors" title="Start Operation"><Play className="w-4 h-4" aria-hidden="true" /></button>
                      {activeTab === 'active' && (() => {
                        const stages = getStages(shopSettings);
                        const nextStage = getNextStage(j, stages);
                        const completedStage = stages.find(s => s.isComplete);
                        const isAlreadyComplete = j.status === 'completed';
                        return (
                          <>
                            {nextStage && (
                              <button
                                aria-label={`Advance ${j.poNumber || 'job'} to ${nextStage.label}`}
                                onClick={() => confirm({
                                title: `Advance to ${nextStage.label}`,
                                message: `Move this job to "${nextStage.label}"?`,
                                onConfirm: async () => {
                                  await DB.advanceJobStage(j.id, nextStage.id, user.id, user.name, nextStage.isComplete);
                                  addToast('success', `Job advanced to ${nextStage.label}`);
                                }
                              })}
                                className="p-2 rounded-lg transition-colors hover:text-white"
                                style={{ background: `${nextStage.color}15`, color: nextStage.color }}
                                title={`Advance to ${nextStage.label}`}>
                                <ArrowRight className="w-4 h-4" aria-hidden="true" />
                              </button>
                            )}
                            {!isAlreadyComplete && completedStage && (
                              <button
                                aria-label={`Complete job ${j.poNumber || ''}`}
                                onClick={() => handleCompleteWithSnapshot(j)}
                                className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500 hover:text-white transition-colors"
                                title="Complete Job">
                                <CheckCircle className="w-4 h-4" aria-hidden="true" />
                              </button>
                            )}
                          </>
                        );
                      })()}
                      {j.dueDate && (
                        <button
                          aria-label={calAdded.includes(j.id) ? `Already added to Google Calendar — ${j.poNumber || ''}` : `Add ${j.poNumber || 'job'} to Google Calendar`}
                          onClick={() => {
                          const url = getCalendarUrl(j);
                          if (url) {
                            const updated = [...calAdded]; if (!updated.includes(j.id)) { updated.push(j.id); setCalAdded(updated); localStorage.setItem('cal_added_jobs', JSON.stringify(updated)); }
                            window.location.href = url;
                          }
                        }} className={`hidden sm:flex p-2 rounded-lg transition-colors ${calAdded.includes(j.id) ? 'bg-emerald-500/10 text-emerald-400' : 'hover:bg-zinc-700/50 text-zinc-500 hover:text-zinc-300'}`} title={calAdded.includes(j.id) ? 'Already in Google Calendar' : 'Add to Google Calendar'}>
                          {calAdded.includes(j.id) ? <CheckCircle className="w-4 h-4" aria-hidden="true" /> : <Calendar className="w-4 h-4" aria-hidden="true" />}
                        </button>
                      )}
                      {j.customer && (
                        <button onClick={() => {
                          const url = buildPortalUrl(j.customer!, shopSettings);
                          navigator.clipboard.writeText(url).then(() => addToast('success', 'Portal link copied!')).catch(() => prompt('Copy this link:', url));
                        }} aria-label="Copy customer portal link" className="hidden sm:flex p-2 hover:bg-purple-500/10 rounded-lg text-purple-400 hover:text-purple-300 transition-colors" title="Copy Customer Portal Link"><Share2 className="w-4 h-4" aria-hidden="true" /></button>
                      )}
                      <button
                        aria-label={printed.includes(j.id) ? `Reprint traveler for ${j.poNumber || ''}` : `Print traveler for ${j.poNumber || ''}`}
                        onClick={() => setPrintable(enrichJobForPrint(j, jobs, allLogs, shopSettings.rateBuffer ?? 1.15))} className={`hidden sm:flex p-2 rounded-lg transition-colors ${printed.includes(j.id) ? 'bg-emerald-500/10 text-emerald-400' : 'hover:bg-zinc-800 text-zinc-400 hover:text-white'}`} title={printed.includes(j.id) ? 'Printed ✓ — click to reprint' : 'Print Traveler'}><Printer className="w-4 h-4" aria-hidden="true" /></button>
                      <button aria-label={`Report rework for ${j.poNumber || ''}`} onClick={(e) => { e.stopPropagation(); setReworkModal({ jobId: j.id, poNumber: j.poNumber, partNumber: j.partNumber, customer: j.customer, reason: 'finish', quantity: 1, status: 'open' }); }} className="p-2 hover:bg-amber-500/10 rounded-lg text-amber-400/70 hover:text-amber-400 transition-colors relative" title="Report rework">
                        <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                        {reworkByJob.get(j.id) && (reworkByJob.get(j.id)!.open > 0) && (
                          <span aria-hidden="true" className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 bg-amber-500 text-white text-[9px] font-black rounded-full flex items-center justify-center ring-2 ring-zinc-950">{reworkByJob.get(j.id)!.open}</span>
                        )}
                      </button>
                      <button aria-label={`Edit job ${j.poNumber || ''}`} onClick={() => { setEditingJob(j); setShowModal(true); }} className="p-2 hover:bg-zinc-800 rounded-lg text-amber-400 hover:text-white" title="Edit"><Edit2 className="w-4 h-4" aria-hidden="true" /></button>
                      <button aria-label={`Delete job ${j.poNumber || ''}`} onClick={() => confirm({ title: "Delete Job", message: "Permanently delete?", onConfirm: () => DB.deleteJob(j.id) })} className="hidden sm:flex p-2 hover:bg-red-500/10 rounded-lg text-red-400 hover:text-red-500" title="Delete"><Trash2 className="w-4 h-4" aria-hidden="true" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredJobs.length === 0 && <tr><td colSpan={8} className="p-12 text-center text-zinc-500">No jobs found matching filters.</td></tr>}
          </tbody>
        </table>
      </div>
      </>}

      {showClientUpdate && (
        <ClientUpdateGenerator
          jobs={jobs}
          stages={getStages(shopSettings)}
          settings={shopSettings}
          userName={user.name}
          onClose={() => setShowClientUpdate(false)}
          onToast={addToast}
        />
      )}

      {showModal && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editingJob.id ? 'Edit Job' : 'Create New Job'}
          className="fixed inset-0 z-[200] overflow-y-auto bg-zinc-950 animate-fade-in"
        >
          <div className="min-h-full flex items-start sm:items-center justify-center p-0 sm:p-4">
            <div className="bg-zinc-900 border border-white/10 w-full max-w-2xl rounded-none sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col my-0 sm:my-4" style={{ maxHeight: 'calc(100dvh - 2rem)' }}>
            <div className="p-3 sm:p-5 border-b border-white/10 flex justify-between items-center bg-zinc-800/50 sticky top-0 z-10 shrink-0">
              <h3 className="font-bold text-white text-base sm:text-lg">{editingJob.id ? 'Edit Job' : 'Create New Job'}</h3>
              <div className="flex items-center gap-2">
                {!editingJob.id && (
                  <button
                    type="button"
                    title="Scan a PO document to auto-fill fields"
                    onClick={() => { setShowModal(false); setShowScanner(true); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 text-amber-400 hover:text-amber-300 text-xs font-bold transition-colors"
                  >
                    <Scan className="w-3.5 h-3.5" /> Scan PO
                  </button>
                )}
                <button type="button" aria-label="Close" onClick={() => setShowModal(false)}><X className="w-5 h-5 text-zinc-500 hover:text-white" /></button>
              </div>
            </div>
            <div ref={modalBodyRef} className="p-4 sm:p-8 overflow-y-auto space-y-5 sm:space-y-8">
              {/* ── Stage Pipeline (for existing jobs) ── */}
              {editingJob.id && (() => {
                const stages = getStages(shopSettings);
                const currentStage = getJobStage(editingJob as Job, stages);
                const currentIdx = stages.findIndex(s => s.id === currentStage.id);
                const nextStage = getNextStage(editingJob as Job, stages);
                const completedStage = stages.find(s => s.isComplete);
                const isJobComplete = (editingJob as Job).status === 'completed';
                return (
                  <div className="bg-zinc-800/30 rounded-xl p-4 border border-white/5 space-y-3">
                    {/* Header row: label on top, action buttons on a clean grid below.
                        Using a responsive grid avoids the mobile overlap mess. */}
                    <div className="space-y-2">
                      <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Job Progress</p>
                      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_auto] gap-2 items-stretch">
                        {/* Stage dropdown — jump to any stage */}
                        <select
                          value={currentStage.id}
                          onChange={async (e) => {
                            const targetStage = stages.find(s => s.id === e.target.value);
                            if (!targetStage || targetStage.id === currentStage.id) return;
                            await DB.advanceJobStage(editingJob.id, targetStage.id, user.id, user.name, targetStage.isComplete);
                            setEditingJob({ ...editingJob, currentStage: targetStage.id, status: targetStage.isComplete ? 'completed' : targetStage.id === 'in-progress' ? 'in-progress' : (editingJob as Job).status });
                            addToast('success', `Moved to ${targetStage.label}`);
                          }}
                          className="text-xs font-bold px-3 py-2 rounded-lg bg-zinc-800 border border-white/10 text-zinc-300 outline-none cursor-pointer hover:border-white/20 transition-colors min-w-0 w-full"
                          aria-label="Change job stage"
                        >
                          {stages.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </select>
                        {nextStage && (
                          <button
                            type="button"
                            onClick={async () => {
                              await DB.advanceJobStage(editingJob.id, nextStage.id, user.id, user.name, nextStage.isComplete);
                              setEditingJob({ ...editingJob, currentStage: nextStage.id, status: nextStage.isComplete ? 'completed' : nextStage.id === 'in-progress' ? 'in-progress' : (editingJob as Job).status });
                              addToast('success', `Advanced to ${nextStage.label}`);
                            }}
                            className="text-xs font-bold px-3 py-2 rounded-lg transition-colors hover:brightness-110 flex items-center justify-center gap-1.5 whitespace-nowrap"
                            style={{ background: `${nextStage.color}20`, color: nextStage.color }}
                            title={`Move to ${nextStage.label}`}
                          >
                            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                            <span className="truncate max-w-[110px]">{nextStage.label}</span>
                          </button>
                        )}
                        {!isJobComplete && completedStage && (
                          <button
                            type="button"
                            onClick={() => handleCompleteWithSnapshot(editingJob as Job)}
                            className="text-xs font-bold px-3 py-2 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
                          >
                            <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" /> Complete
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Visual pipeline */}
                    <div className="flex items-center gap-1">
                      {stages.map((stage, i) => {
                        const isActive = i <= currentIdx;
                        const isCurrent = i === currentIdx;
                        return (
                          <button key={stage.id} className="flex-1 flex flex-col items-center gap-1 cursor-pointer group" onClick={async () => {
                            if (stage.id === currentStage.id) return;
                            await DB.advanceJobStage(editingJob.id, stage.id, user.id, user.name, stage.isComplete);
                            setEditingJob({ ...editingJob, currentStage: stage.id, status: stage.isComplete ? 'completed' : stage.id === 'in-progress' ? 'in-progress' : (editingJob as Job).status });
                            addToast('success', `Moved to ${stage.label}`);
                          }}>
                            <div className={`h-3 w-full rounded-full transition-all group-hover:scale-y-125 ${isCurrent ? 'ring-2 ring-white/40 ring-offset-1 ring-offset-zinc-900' : ''}`}
                              style={{ background: isActive ? stage.color : '#27272a', opacity: isActive ? 1 : 0.3 }} />
                            <span className={`text-[9px] font-bold transition-colors ${isCurrent ? 'text-white' : isActive ? '' : 'text-zinc-600'} group-hover:text-white`}
                              style={isActive ? { color: stage.color } : {}}>{stage.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    {/* Share with Customer */}
                    {(editingJob as Job).customer && (
                      <div className="flex items-center gap-2 pt-1">
                        <button onClick={() => {
                          const url = buildPortalUrl((editingJob as Job).customer!, shopSettings);
                          navigator.clipboard.writeText(url).then(() => addToast('success', 'Customer portal link copied!')).catch(() => {
                            prompt('Copy this link:', url);
                          });
                        }} className="flex items-center gap-1.5 text-[11px] font-bold text-purple-400 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 px-3 py-1.5 rounded-lg transition-all">
                          <Share2 className="w-3.5 h-3.5" /> Share Portal Link
                        </button>
                        <button onClick={() => {
                          const url = buildPortalUrl((editingJob as Job).customer!, shopSettings);
                          window.open(url, '_blank');
                        }} className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-all">
                          <ExternalLink className="w-3.5 h-3.5" /> Preview
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="space-y-5">
                <h4 className="text-xs font-black text-amber-400 uppercase tracking-[0.2em] border-b border-amber-500/20 pb-2 flex items-center gap-2">
                  <span className="bg-amber-500/10 text-amber-400 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black">1</span>
                  Primary Information
                </h4>
                <div>
                  <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Purchase Order (PO) # <span className="text-red-500">*</span></label>
                  <input className="w-full bg-black/40 border-2 border-amber-500/30 focus:border-amber-500 rounded-xl p-4 text-white text-2xl font-black outline-none transition-all placeholder-zinc-700" value={editingJob.poNumber || ''} onChange={e => setEditingJob({ ...editingJob, poNumber: e.target.value })} placeholder="e.g. PO-4500123" autoFocus />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="relative">
                    <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Part Number <span className="text-red-500">*</span></label>
                    <input className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white font-bold outline-none focus:ring-2 focus:ring-amber-500/50" value={editingJob.partNumber || ''} autoComplete="off" onChange={e => {
                      setEditingJob({ ...editingJob, partNumber: e.target.value });
                      const q = e.target.value.toLowerCase();
                      setPartSuggestions(q.length >= 2 ? jobs.filter(j => j.partNumber?.toLowerCase().includes(q) && j.partNumber !== e.target.value).reduce((acc: Job[], j) => acc.find(a => a.partNumber === j.partNumber) ? acc : [...acc, j], [] as Job[]).slice(0, 5) : []);
                    }} onBlur={() => setTimeout(() => setPartSuggestions([]), 200)} placeholder="e.g. 123-ABC-001" />
                    {partSuggestions.length > 0 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-zinc-900 border border-white/10 rounded-xl overflow-hidden shadow-2xl">
                        <div className="px-3 py-1.5 bg-zinc-800/50 text-[10px] text-zinc-500 font-bold uppercase">Previous Parts — tap to auto-fill</div>
                        {partSuggestions.map(s => (
                          <button key={s.id} className="w-full text-left px-3 py-2.5 hover:bg-amber-500/10 border-t border-white/5 transition-colors" onClick={() => {
                            setEditingJob({ ...editingJob, partNumber: s.partNumber, customer: s.customer || editingJob.customer, info: s.info || editingJob.info, specialInstructions: s.specialInstructions || editingJob.specialInstructions, partImage: s.partImage || editingJob.partImage });
                            setPartSuggestions([]);
                          }}>
                            <span className="text-white font-bold text-sm">{s.partNumber}</span>
                            {s.customer && <span className="text-zinc-500 text-xs ml-2">— {s.customer}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">SC Job # <span className="text-zinc-600 normal-case font-normal">(auto-generated if empty)</span></label>
                    <input className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white font-mono outline-none focus:ring-2 focus:ring-amber-500/50 placeholder-zinc-600" value={editingJob.jobIdsDisplay || ''} onChange={e => setEditingJob({ ...editingJob, jobIdsDisplay: e.target.value })} placeholder="e.g. J-001234" />
                  </div>
                </div>
              </div>

              {/* Part History Banner — shows when we've run this part before */}
              {editingJob.partNumber && (() => {
                const history = getPartHistory(editingJob.partNumber, jobs, allLogs);
                if (!history || history.totalRuns === 0) return null;
                const suggestedHrs = editingJob.quantity
                  ? suggestExpectedHours(history, editingJob.quantity)
                  : history.avgJobHours;
                return (
                  <div className="bg-gradient-to-br from-purple-500/10 to-blue-500/5 border border-purple-500/25 rounded-2xl p-4 sm:p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center shrink-0">
                          <History className="w-5 h-5 text-purple-400" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-black text-purple-400 uppercase tracking-widest">We've run this part before</p>
                          <p className="text-sm text-white font-bold truncate">
                            {history.totalRuns} prior run{history.totalRuns > 1 ? 's' : ''} · {history.totalUnits.toLocaleString()} units total
                          </p>
                        </div>
                      </div>
                      {history.onTimeRate > 0 && (
                        <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border ${history.onTimeRate >= 90 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25' : history.onTimeRate >= 70 ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/25' : 'text-orange-400 bg-orange-500/10 border-orange-500/25'}`}>
                          {history.onTimeRate}% on-time
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div className="bg-zinc-900/50 rounded-lg p-2.5 border border-white/5">
                        <p className="text-[9px] text-zinc-500 uppercase font-black tracking-widest">Avg / Unit</p>
                        <p className="text-lg font-black text-white tabular">{history.avgHoursPerUnit > 0 ? (history.avgHoursPerUnit * 60).toFixed(1) + ' min' : '—'}</p>
                      </div>
                      <div className="bg-zinc-900/50 rounded-lg p-2.5 border border-white/5">
                        <p className="text-[9px] text-zinc-500 uppercase font-black tracking-widest">Avg Job Time</p>
                        <p className="text-lg font-black text-white tabular">{history.avgJobHours.toFixed(1)}h</p>
                      </div>
                      <div className="bg-zinc-900/50 rounded-lg p-2.5 border border-white/5">
                        <p className="text-[9px] text-zinc-500 uppercase font-black tracking-widest">Last Run</p>
                        <p className="text-lg font-black text-white tabular truncate">{history.lastRun?.completedAt ? new Date(history.lastRun.completedAt).toLocaleDateString() : '—'}</p>
                      </div>
                      <div className="bg-zinc-900/50 rounded-lg p-2.5 border border-white/5">
                        <p className="text-[9px] text-zinc-500 uppercase font-black tracking-widest">Best Worker</p>
                        <p className="text-sm font-black text-emerald-400 truncate" title={history.bestWorker?.name || ''}>{history.bestWorker?.name?.split(' ')[0] || '—'}</p>
                      </div>
                    </div>
                    {editingJob.quantity && editingJob.quantity > 0 && suggestedHrs > 0 && (
                      <button
                        type="button"
                        onClick={() => setEditingJob({ ...editingJob, expectedHours: suggestedHrs })}
                        className="w-full flex items-center justify-between gap-2 bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/25 rounded-lg p-3 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-lg">💡</span>
                          <span className="text-sm text-white text-left">
                            Suggested budget: <strong className="text-emerald-400 font-black tabular">{suggestedHrs}h</strong>
                            <span className="text-zinc-500 text-xs"> for {editingJob.quantity} units</span>
                          </span>
                        </div>
                        <span className="text-[10px] font-bold text-emerald-400 shrink-0">Apply →</span>
                      </button>
                    )}
                  </div>
                );
              })()}

              <div className="space-y-5">
                <h4 className="text-xs font-black text-emerald-400 uppercase tracking-[0.2em] border-b border-emerald-500/20 pb-2 flex items-center gap-2">
                  <span className="bg-emerald-500/10 text-emerald-400 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black">2</span>
                  Quantity & Timeline
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div><label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Quantity</label><input type="number" className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white font-mono outline-none focus:ring-2 focus:ring-emerald-500/50" value={editingJob.quantity || ''} onChange={e => {
                    const qty = Number(e.target.value);
                    const ppp = editingJob.pricePerPart || 0;
                    const updates: any = { quantity: qty };
                    if (ppp > 0 && qty > 0) updates.quoteAmount = parseFloat((ppp * qty).toFixed(2));
                    setEditingJob({ ...editingJob, ...updates });
                  }} placeholder="0" /></div>
                  <div><label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Date Received</label><input type="date" className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-emerald-500/50" value={editingJob.dateReceived ? (editingJob.dateReceived.includes('/') ? `${editingJob.dateReceived.split('/')[2]}-${editingJob.dateReceived.split('/')[0].padStart(2,'0')}-${editingJob.dateReceived.split('/')[1].padStart(2,'0')}` : editingJob.dateReceived) : ''} onChange={e => setEditingJob({ ...editingJob, dateReceived: e.target.value })} /></div>
                  <div><label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Due Date</label><input type="date" className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-emerald-500/50" value={editingJob.dueDate ? (editingJob.dueDate.includes('/') ? `${editingJob.dueDate.split('/')[2]}-${editingJob.dueDate.split('/')[0].padStart(2,'0')}-${editingJob.dueDate.split('/')[1].padStart(2,'0')}` : editingJob.dueDate) : ''} onChange={e => setEditingJob({ ...editingJob, dueDate: e.target.value })} /></div>
                </div>
              </div>

              <div className="space-y-5">
                <h4 className="text-xs font-black text-orange-400 uppercase tracking-[0.2em] border-b border-orange-500/20 pb-2 flex items-center gap-2">
                  <span className="bg-orange-500/10 text-orange-400 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black">3</span>
                  Additional Details
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {user.role === 'admin' && (
                    <div>
                      <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Customer Name</label>
                      {allClients.length > 0 ? (
                        <select
                          className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-orange-500/50"
                          value={editingJob.customer || ''}
                          onChange={e => setEditingJob({ ...editingJob, customer: e.target.value })}
                        >
                          <option value="">— Select a client —</option>
                          {allClients.map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      ) : (
                        <input className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-orange-500/50" value={editingJob.customer || ''} onChange={e => setEditingJob({ ...editingJob, customer: e.target.value })} placeholder="Client or Company Name" />
                      )}
                      {allClients.length === 0 && <p className="text-xs text-zinc-500 mt-1">💡 Add clients in <span className="text-purple-400 font-bold">Settings → Clients</span> to get a dropdown here.</p>}
                    </div>
                  )}
                  <div><label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Priority Level</label><select className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-orange-500/50" value={editingJob.priority || 'normal'} onChange={e => setEditingJob({ ...editingJob, priority: e.target.value as any })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
                </div>
                <div>
                  <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Notes / Special Instructions</label>
                  <textarea className="w-full bg-zinc-950 border border-white/10 rounded-xl p-4 text-white min-h-[140px] outline-none focus:ring-2 focus:ring-orange-500/50 resize-y leading-relaxed" value={editingJob.info || ''} onChange={e => setEditingJob({ ...editingJob, info: e.target.value })} placeholder="Enter any process details, material specs, or special requirements here..." rows={5} />
                  <p className="text-[10px] text-zinc-600 mt-1">Internal — shown to operators on the floor. NOT visible to the customer.</p>
                </div>

                {/* Customer Portal Update — human-friendly status for the
                    customer. Appears in a blue callout on their portal. */}
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <span className="text-amber-400 text-sm mt-0.5">💬</span>
                    <div className="flex-1">
                      <label className="text-xs font-bold text-amber-300 uppercase tracking-wider block">Customer Portal Update</label>
                      <p className="text-[10px] text-zinc-500 mt-0.5">
                        Written for the customer. Example: "Shipping Friday EOD" or "Running a day behind — targeting Tue next week."
                      </p>
                    </div>
                  </div>
                  <textarea
                    className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white min-h-[80px] outline-none focus:ring-2 focus:ring-amber-500/40 resize-y text-sm leading-relaxed"
                    value={editingJob.portalNote?.text || ''}
                    onChange={e => setEditingJob({
                      ...editingJob,
                      portalNote: {
                        ...(editingJob.portalNote || { updatedAt: Date.now() }),
                        text: e.target.value,
                      },
                    })}
                    placeholder="On track for Tuesday. Final inspection tomorrow morning."
                    rows={3}
                  />
                  <div>
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Expected Ready Date <span className="text-zinc-600 normal-case font-normal">(optional)</span></label>
                    <input
                      type="text"
                      placeholder="MM/DD/YYYY — e.g. Friday EOD or 04/30/2026"
                      value={editingJob.portalNote?.expectedDate || ''}
                      onChange={e => setEditingJob({
                        ...editingJob,
                        portalNote: {
                          ...(editingJob.portalNote || { text: '', updatedAt: Date.now() }),
                          expectedDate: e.target.value,
                        },
                      })}
                      className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-amber-500/40 tabular"
                    />
                    <p className="text-[10px] text-zinc-600 mt-1">Rendered as a green badge on the customer's portal card.</p>
                  </div>
                  {editingJob.portalNote?.updatedAt && editingJob.portalNote.text && (
                    <p className="text-[10px] text-zinc-500">Last sent {new Date(editingJob.portalNote.updatedAt).toLocaleString()}{editingJob.portalNote.updatedBy ? ` · by ${editingJob.portalNote.updatedBy}` : ''}</p>
                  )}
                </div>
              </div>

              {/* ── SHOP BRAIN: Job Memory Card ─────────────────────────────────
                  Appears when customer + part number match a past job.
                  Shows last price, time, and run count so the admin can
                  fill in costing without guessing or opening another tab.
                  ──────────────────────────────────────────────────────── */}
              {priceSuggestion && (
                <div className="bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent border border-amber-500/25 rounded-2xl p-4 space-y-3 relative overflow-hidden">
                  <div aria-hidden="true" className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🧠</span>
                    <div>
                      <p className="text-sm font-black text-white">FabTrack Remembers This Job</p>
                      <p className="text-[11px] text-amber-300/70">
                        {priceSuggestion.runCount} run{priceSuggestion.runCount > 1 ? 's' : ''} found for <span className="font-bold">{editingJob.customer}</span> — <span className="font-mono">{editingJob.partNumber}</span>
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {priceSuggestion.pricePerPart && (
                      <div className="bg-black/20 rounded-xl p-2.5 text-center">
                        <p className="text-[9px] text-zinc-500 uppercase tracking-widest">Last $/Part</p>
                        <p className="text-base font-black text-amber-400">${priceSuggestion.pricePerPart.toFixed(2)}</p>
                      </div>
                    )}
                    {priceSuggestion.quoteAmount && (
                      <div className="bg-black/20 rounded-xl p-2.5 text-center">
                        <p className="text-[9px] text-zinc-500 uppercase tracking-widest">Last Total</p>
                        <p className="text-base font-black text-emerald-400">${priceSuggestion.quoteAmount.toFixed(2)}</p>
                      </div>
                    )}
                    {priceSuggestion.lastTotalHrs !== null && (
                      <div className="bg-black/20 rounded-xl p-2.5 text-center">
                        <p className="text-[9px] text-zinc-500 uppercase tracking-widest">Last Run Time</p>
                        <p className="text-base font-black text-amber-400">{priceSuggestion.lastTotalHrs.toFixed(1)}h</p>
                      </div>
                    )}
                    {priceSuggestion.avgHrs !== null && priceSuggestion.completedCount > 1 && (
                      <div className="bg-black/20 rounded-xl p-2.5 text-center">
                        <p className="text-[9px] text-zinc-500 uppercase tracking-widest">Avg Time</p>
                        <p className="text-base font-black text-violet-400">{priceSuggestion.avgHrs.toFixed(1)}h</p>
                      </div>
                    )}
                  </div>
                  {/* One-tap apply buttons */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {priceSuggestion.pricePerPart && (
                      <button
                        type="button"
                        onClick={() => {
                          const ppp = priceSuggestion.pricePerPart!;
                          const qty = editingJob.quantity || priceSuggestion.quantity || 0;
                          const newQuote = ppp > 0 && qty > 0 ? parseFloat((ppp * qty).toFixed(2)) : (priceSuggestion.quoteAmount || 0);
                          setEditingJob({ ...editingJob, pricePerPart: ppp, quoteAmount: newQuote, quantity: qty || editingJob.quantity });
                        }}
                        className="text-xs font-black bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all active:scale-95"
                      >
                        ↙ Apply Last Price ${priceSuggestion.pricePerPart.toFixed(2)}/part
                      </button>
                    )}
                    {priceSuggestion.lastTotalHrs !== null && !editingJob.expectedHours && (
                      <button
                        type="button"
                        onClick={() => setEditingJob({ ...editingJob, expectedHours: parseFloat(priceSuggestion.lastTotalHrs!.toFixed(1)) })}
                        className="text-xs font-black bg-amber-600/80 hover:bg-amber-500/80 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all active:scale-95"
                      >
                        ↙ Set {priceSuggestion.lastTotalHrs.toFixed(1)}h budget
                      </button>
                    )}
                    <span className="text-[10px] text-zinc-600 self-center ml-auto">from {priceSuggestion.poNumber}</span>
                  </div>
                </div>
              )}

              {/* Customer pipeline hint */}
              {customerPipelineHint && (
                <div className="bg-violet-500/10 border border-violet-500/25 rounded-xl px-3 py-2.5 flex items-center gap-3">
                  <span className="text-base">🔀</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-violet-300">{customerPipelineHint.customer} uses a custom pipeline</p>
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {customerPipelineHint.stages.map((s, i) => (
                        <React.Fragment key={s.id}>
                          <span className="text-[10px] font-bold rounded px-1.5 py-0.5 border" style={{ color: s.color, backgroundColor: s.color + '18', borderColor: s.color + '40' }}>{s.label}</span>
                          {i < customerPipelineHint.stages.length - 1 && <span className="text-zinc-700 text-xs">→</span>}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-5">
                <h4 className="text-xs font-black text-emerald-400 uppercase tracking-[0.2em] border-b border-emerald-500/20 pb-2 flex items-center gap-2">
                  <span className="bg-emerald-500/10 text-emerald-400 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black">4</span>
                  Job Costing <span className="text-zinc-600 normal-case font-normal text-[10px]">(optional)</span>
                </h4>
                {/* ── Price Per Part → auto-calculates Quote Total ── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Price Per Part <span className="text-zinc-600 normal-case font-normal">(auto-calc)</span></label>
                    <div className="relative">
                      <span className="absolute left-4 top-3 text-zinc-500 font-bold text-lg">$</span>
                      <input
                        type="number" step="0.01" min="0"
                        className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 pl-9 text-white font-mono text-lg outline-none focus:ring-2 focus:ring-emerald-500/50"
                        value={editingJob.pricePerPart || ''}
                        placeholder="0.00"
                        onChange={e => {
                          const ppp = Number(e.target.value) || 0;
                          const qty = editingJob.quantity || 0;
                          const newQuote = ppp > 0 && qty > 0 ? parseFloat((ppp * qty).toFixed(2)) : (editingJob.quoteAmount || 0);
                          setEditingJob({ ...editingJob, pricePerPart: ppp, quoteAmount: newQuote });
                        }}
                      />
                    </div>
                    <p className="text-[10px] text-zinc-600 mt-1">Enter rate/part — Quote Total auto-fills from Qty × this.</p>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">
                      Quote Total ($)
                      {editingJob.pricePerPart && editingJob.quantity ? (
                        <span className="ml-2 normal-case font-normal text-emerald-400">
                          = ${editingJob.pricePerPart.toFixed(2)} × {editingJob.quantity}
                        </span>
                      ) : null}
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-3 text-zinc-500 font-bold text-lg">$</span>
                      <input type="number" step="0.01" className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 pl-9 text-white font-mono text-lg outline-none focus:ring-2 focus:ring-emerald-500/50" value={editingJob.quoteAmount || ''} onChange={e => {
                        const qa = Number(e.target.value) || 0;
                        const qty = editingJob.quantity || 0;
                        // Keep pricePerPart consistent — recalc from total/qty so both fields persist
                        const ppp = qa > 0 && qty > 0 ? parseFloat((qa / qty).toFixed(2)) : editingJob.pricePerPart;
                        setEditingJob({ ...editingJob, quoteAmount: qa, pricePerPart: ppp });
                      }} placeholder="0.00" />
                    </div>
                    <p className="text-[10px] text-zinc-600 mt-1">What the customer pays. Profit calculated when complete.</p>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Expected Hours <span className="text-zinc-600 normal-case">(budget)</span></label>
                  <div className="relative">
                    <span className="absolute left-4 top-3 text-zinc-500 font-bold text-lg">⏱</span>
                    <input type="number" step="0.5" className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 pl-9 text-white font-mono text-lg outline-none focus:ring-2 focus:ring-emerald-500/50" value={editingJob.expectedHours || ''} onChange={e => setEditingJob({ ...editingJob, expectedHours: Number(e.target.value) || 0 })} placeholder="0" />
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-1">Time budget. Job row shows red badge if actual exceeds this.</p>
                </div>
                {editingJob.id && (
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Material Cost <span className="text-zinc-600 normal-case">(actual spend)</span></label>
                    <div className="relative">
                      <span className="absolute left-4 top-3 text-zinc-500 font-bold text-lg">$</span>
                      <input
                        type="number" step="0.01" min="0"
                        className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 pl-9 text-white font-mono text-lg outline-none focus:ring-2 focus:ring-emerald-500/50"
                        value={(editingJob as Job).materialCost || ''}
                        onChange={e => setEditingJob({ ...editingJob, materialCost: Number(e.target.value) || 0 })}
                        placeholder="0.00"
                      />
                    </div>
                    <p className="text-[10px] text-zinc-600 mt-1">Abrasives, media, consumables used. You'll also be prompted at close-out.</p>
                  </div>
                )}
                {editingJob.id && (
                  <div className="pt-1">
                    <JobProfitCard
                      job={editingJob as Job}
                      allLogs={allLogs}
                      allUsers={workers}
                      settings={shopSettings}
                      allPOs={allPOs}
                      useSnapshot={!!(editingJob as Job).profitSnapshot}
                    />
                  </div>
                )}
              </div>

              {/* ── "What's next" hint for new jobs ── only Shipping needs an existing job ── */}
              {!editingJob.id && (
                <div className="bg-zinc-800/20 border border-white/5 rounded-xl p-3 flex items-center gap-3">
                  <span className="text-lg">🚚</span>
                  <p className="text-[11px] text-zinc-500">
                    <span className="font-bold text-zinc-400">Shipping details + print packing slip</span> unlock after you hit <span className="font-bold text-amber-400">Create Job →</span>
                  </p>
                </div>
              )}

              {/* Shipping */}
              {editingJob.id && (
              <div className="space-y-5">
                <h4 className="text-xs font-black text-cyan-400 uppercase tracking-[0.2em] border-b border-cyan-500/20 pb-2 flex items-center gap-2">
                  <span className="bg-cyan-500/10 text-cyan-400 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black">5</span>
                  Shipping <span className="text-zinc-600 normal-case font-normal text-[10px]">(optional)</span>
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Shipping Method</label>
                    <select className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-cyan-500/50" value={editingJob.shippingMethod || ''} onChange={e => setEditingJob({ ...editingJob, shippingMethod: e.target.value })}>
                      <option value="">— Select —</option>
                      <option value="pickup">Customer Pickup</option>
                      <option value="standard">Standard Shipping</option>
                      <option value="express">Express</option>
                      <option value="fedex">FedEx</option>
                      <option value="ups">UPS</option>
                      <option value="freight">Freight / LTL</option>
                      <option value="hand-deliver">Hand Deliver</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Tracking Number</label>
                    <input className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono" value={editingJob.trackingNumber || ''} onChange={e => setEditingJob({ ...editingJob, trackingNumber: e.target.value })} placeholder="Enter tracking number" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Shipping Notes</label>
                  <textarea className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-cyan-500/50 min-h-[60px] text-sm" value={editingJob.shippingNotes || ''} onChange={e => setEditingJob({ ...editingJob, shippingNotes: e.target.value })} placeholder="Special delivery instructions, address notes, etc." />
                </div>
                {editingJob.shippingMethod && (
                  <div className="flex gap-3">
                    <button onClick={() => { printPackingSlipPDF(editingJob as Job, shopSettings); }} className="bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500 hover:text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors flex items-center gap-2"><Download className="w-4 h-4" /> Packing Slip</button>
                    <button onClick={() => {
                      const buf = shopSettings.rateBuffer ?? 1.15;
                      const enriched = enrichJobForPrint(editingJob as Job, jobs, allLogs, buf);
                      printJobTravelerPDF(
                        enriched,
                        shopSettings,
                        getPartHistory(editingJob.partNumber || '', jobs, allLogs),
                        getRateBreakdownForJob(enriched, allLogs, buf),
                      );
                    }} className="bg-zinc-700 hover:bg-zinc-600 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors flex items-center gap-2"><Download className="w-4 h-4" /> Job Traveler</button>
                  </div>
                )}
              </div>
              )}

              {/* ── Operation Checklist — always visible, saved with job ── */}
              <JobChecklistSection
                job={editingJob as Job}
                onUpdate={(items) => setEditingJob({ ...editingJob, checklist: items })}
                user={user}
              />

              {/* ── Attachments / Blueprints — always visible, saved with job ── */}
              <JobAttachmentsSection
                job={editingJob as Job}
                onUpdate={(atts) => setEditingJob({ ...editingJob, attachments: atts })}
                user={user}
                addToast={addToast}
              />

              {/* Part Photo */}
              <div className="space-y-5">
                <h4 className="text-xs font-black text-cyan-400 uppercase tracking-[0.2em] border-b border-cyan-500/20 pb-2 flex items-center gap-2">
                  <span className="bg-cyan-500/10 text-cyan-400 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black">6</span>
                  Part Photo <span className="text-zinc-600 normal-case font-normal text-[10px]">(optional)</span>
                </h4>
                <input ref={imageInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageUpload} />
                {editingJob.partImage ? (
                  <div className="flex items-start gap-4">
                    <div className="relative group">
                      <img src={editingJob.partImage} alt="Part" className="w-32 h-32 object-cover rounded-xl border-2 border-cyan-500/30 cursor-pointer hover:border-cyan-400 transition-all" onClick={() => setLightboxImg(editingJob.partImage!)} />
                      <button onClick={() => setEditingJob({ ...editingJob, partImage: undefined })}
                        className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-400 text-white rounded-full p-1 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"><X className="w-3.5 h-3.5" /></button>
                    </div>
                    <div className="flex flex-col gap-2">
                      <button onClick={() => imageInputRef.current?.click()} className="text-xs text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1"><Camera className="w-3.5 h-3.5" /> Replace Photo</button>
                      <p className="text-[10px] text-zinc-600">Click image to enlarge. Hover to remove.</p>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => imageInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-cyan-500/20 hover:border-cyan-500/40 rounded-xl p-6 flex flex-col items-center gap-2 text-cyan-400/60 hover:text-cyan-400 transition-all group">
                    <Camera className="w-8 h-8 group-hover:scale-110 transition-transform" />
                    <span className="font-bold text-sm">Add Part Photo</span>
                    <span className="text-[10px] text-zinc-600">Take a photo or upload from gallery</span>
                  </button>
                )}
              </div>

              {/* ── Worker QR Code — only for saved jobs ─────────────────────
                  Workers scan this on the shop floor to clock in instantly.
                  No typing: scan → deep-link → Start Operation modal opens.
                  ────────────────────────────────────────────────────────── */}
              {editingJob.id && (() => {
                const baseUrl = window.location.href.split('?')[0];
                const deepLink = `${baseUrl}?jobId=${editingJob.id}`;
                const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=8&data=${encodeURIComponent(deepLink)}`;
                return (
                  <div className="space-y-3 pt-1">
                    <h4 className="text-xs font-black text-indigo-400 uppercase tracking-[0.2em] border-b border-indigo-500/20 pb-2 flex items-center gap-2">
                      <span className="bg-indigo-500/10 text-indigo-400 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black">7</span>
                      Worker Clock-In QR
                    </h4>
                    <div className="flex items-start gap-4">
                      <div className="bg-white p-2 rounded-xl shadow-lg shrink-0">
                        <img
                          src={qrSrc}
                          alt={`Scan to open ${editingJob.poNumber}`}
                          className="w-24 h-24 object-contain block"
                          loading="lazy"
                        />
                      </div>
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <p className="text-sm font-bold text-white">Scan to clock in</p>
                        <p className="text-xs text-zinc-500 leading-relaxed">Workers scan this code on the shop floor to open this job instantly and start/stop time without typing anything.</p>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(deepLink).then(() => addToast('success', '🔗 Deep-link copied to clipboard'));
                          }}
                          className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 mt-2 transition-colors"
                        >
                          <Copy className="w-3 h-3" /> Copy link
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="p-5 border-t border-white/10 bg-zinc-800/50 flex justify-end gap-3 sticky bottom-0 z-10">
              <button onClick={() => setShowModal(false)} className="px-6 py-3 text-zinc-400 hover:text-white font-medium transition-colors">Cancel</button>
              <button onClick={handleSave} className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-amber-900/20 flex items-center gap-2 transition-all">
                {editingJob.id ? <><Save className="w-4 h-4" /> Save Changes</> : <>Create Job <ArrowRight className="w-4 h-4" /></>}
              </button>
            </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ── PO Scanner — free browser OCR, replaces Gemini API ── */}
      {showScanner && (
        <POScanner
          clients={allClients}
          onClose={() => setShowScanner(false)}
          onFill={(scannedFields) => {
            // Auto-compute Quote Total from price × qty so the price actually
            // shows up + persists. Without this, the user sees pricePerPart
            // filled but no Quote Total, gets confused, and the data is brittle.
            const patch: Partial<Job> = { ...scannedFields };
            const ppp = patch.pricePerPart;
            const qty = patch.quantity;
            if (ppp && qty && ppp > 0 && qty > 0 && !patch.quoteAmount) {
              patch.quoteAmount = parseFloat((ppp * qty).toFixed(2));
            }
            setEditingJob(prev => ({ ...prev, ...patch }));
            setShowScanner(false);
            setShowModal(true);
          }}
        />
      )}

      {startJobModal && createPortal(
        <div role="dialog" aria-modal="true" aria-label="Start job" className="fixed inset-0 z-[200] overflow-y-auto bg-zinc-950 animate-fade-in">
          <div className="min-h-full flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-zinc-900 border border-white/10 w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col my-0 sm:my-4" style={{ maxHeight: 'calc(100dvh - 2rem)' }}>

            {/* Header — always visible */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
              <div>
                <h3 className="text-lg font-bold text-white">Start Operation</h3>
                <p className="text-sm text-zinc-400 mt-0.5">PO: <strong className="text-white">{startJobModal.poNumber}</strong> — {startJobModal.partNumber}</p>
              </div>
              <button
                onClick={() => { setStartJobModal(null); setSelectedWorker(null); setSelectedMachine(null); }}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1 px-5 pb-2 space-y-4">
              {/* Worker selector */}
              <div>
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider block mb-2">Assign To Worker</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedWorker(null)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${!selectedWorker ? 'bg-amber-600 border-amber-500 text-white' : 'bg-zinc-800 border-white/10 text-zinc-300 hover:border-white/30'}`}
                  >
                    Myself ({user.name})
                  </button>
                  {workers.filter(w => w.id !== user.id).map(w => (
                    <button
                      key={w.id}
                      onClick={() => setSelectedWorker(selectedWorker?.id === w.id ? null : w)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${selectedWorker?.id === w.id ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-zinc-800 border-white/10 text-zinc-300 hover:border-white/30'}`}
                    >
                      {w.name}
                    </button>
                  ))}
                </div>
                {selectedWorker && (
                  <p className="text-xs text-emerald-400 mt-2">⚡ Timer will appear on <strong>{selectedWorker.name}</strong>'s workstation when they log in.</p>
                )}
              </div>

              {/* Machine / Station picker — optional, appears only if admin has configured machines */}
              {(shopSettings.machines || []).length > 0 && (
                <div>
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider block mb-2 flex items-center gap-2">
                    <span>Machine / Station</span>
                    <span className="text-[9px] font-normal text-zinc-600 normal-case">Optional</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setSelectedMachine(null)}
                      aria-pressed={!selectedMachine}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${!selectedMachine ? 'bg-zinc-700 border-white/30 text-white' : 'bg-zinc-800 border-white/10 text-zinc-400 hover:border-white/30'}`}
                    >
                      — None —
                    </button>
                    {(shopSettings.machines || []).map(m => {
                      const active = selectedMachine === m;
                      return (
                        <button
                          key={m}
                          onClick={() => setSelectedMachine(m)}
                          aria-pressed={active}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${active ? 'bg-orange-600 border-orange-500 text-white shadow-lg shadow-orange-900/30' : 'bg-zinc-800 border-white/10 text-zinc-300 hover:border-white/30'}`}
                        >
                          {m}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Operation buttons */}
              <div>
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider block mb-2">Select Operation</label>
                <div className="grid grid-cols-2 gap-2">
                  {ops.map(op => (
                    <button key={op} onClick={() => handleAdminStartJob(op)} className="bg-zinc-800 hover:bg-amber-600 hover:text-white border border-white/5 py-3 px-3 rounded-xl text-sm font-medium text-zinc-300 transition-colors">{op}</button>
                  ))}
                  {ops.length === 0 && <p className="col-span-2 text-center text-sm text-zinc-500">No operations defined. Check Settings.</p>}
                </div>
              </div>
            </div>

            {/* Footer — always visible, safe-area aware */}
            <div className="px-5 py-4 border-t border-white/5 shrink-0 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <button
                onClick={() => { setStartJobModal(null); setSelectedWorker(null); setSelectedMachine(null); }}
                className="w-full py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white font-bold text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Part Image Lightbox */}
      {lightboxImg && <PartImageLightbox src={lightboxImg} onClose={() => setLightboxImg(null)} />}

      {/* Rework modal — opened from the row's AlertTriangle button */}
      {reworkModal && <ReworkModal entry={reworkModal} jobs={jobs} user={user} onClose={() => setReworkModal(null)} addToast={addToast} />}
      {PromptHost}
      {JobCompletePromptHost}
    </div>
  );
};

// LogsView moved to ./views/LogsView.tsx — see import at top of file.

// --- ROLE META ---
// Single source of truth for role UI/permissions. Add/edit here to change everywhere.
const ROLE_META: Record<UserRole, { label: string; description: string; color: string; tint: string; accent: string; icon: any }> = {
  admin:    { label: 'Admin',    description: 'Full access to everything — billing, settings, team, financials.', color: '#a855f7', tint: 'bg-purple-500/10 border-purple-500/25 text-purple-400', accent: 'from-purple-500 to-pink-500', icon: Settings },
  manager:  { label: 'Manager',  description: 'Runs the floor — jobs, workers, reports. Cannot change billing.',  color: '#3b82f6', tint: 'bg-blue-500/10 border-blue-500/25 text-blue-400',      accent: 'from-blue-500 to-indigo-500',  icon: Users },
  employee: { label: 'Worker',   description: 'Scans jobs, logs time, sees their own history.',                   color: '#10b981', tint: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400', accent: 'from-emerald-500 to-teal-500', icon: Play },
};

// --- ADMIN: EMPLOYEES ---
const AdminEmployees = ({ addToast, confirm }: { addToast: any, confirm: any }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [editingUser, setEditingUser] = useState<Partial<User>>({});
  const [showModal, setShowModal] = useState(false);
  const [wizardStep, setWizardStep] = useState(1); // 1=role, 2=identity, 3=access, 4=review
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [showBadges, setShowBadges] = useState(false);
  const [shopSettings, setShopSettings] = useState<SystemSettings>(DB.getSettings());

  useEffect(() => {
    const u1 = DB.subscribeUsers(setUsers);
    const u2 = DB.subscribeSettings(setShopSettings);
    return () => { u1(); u2(); };
  }, []);

  const handleDelete = (id: string) => confirm({
    title: 'Remove User',
    message: 'Are you sure you want to remove this user? This cannot be undone.',
    onConfirm: () => DB.deleteUser(id)
  });

  const openNew = () => { setEditingUser({ role: 'employee', isActive: true }); setWizardStep(1); setShowModal(true); };
  const openEdit = (u: User) => { setEditingUser(u); setWizardStep(2); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setEditingUser({}); setWizardStep(1); };

  // Auto-generate next available employee ID (EMP-001, EMP-002, ...)
  const nextEmployeeId = () => {
    const existing = users.map(u => u.employeeId).filter(Boolean) as string[];
    const nums = existing.map(id => parseInt(id.replace(/^\D+/, ''), 10)).filter(n => !isNaN(n));
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    return `EMP-${String(next).padStart(3, '0')}`;
  };

  const handleSave = () => {
    if (!editingUser.name || !editingUser.username || !editingUser.pin) { addToast('error', 'Missing fields'); return; }
    if (editingUser.pin.length < 4) { addToast('error', 'PIN must be at least 4 digits'); return; }
    if (users.some(u => u.username.toLowerCase() === editingUser.username!.toLowerCase() && u.id !== editingUser.id)) {
      addToast('error', 'Username already taken');
      return;
    }
    const newUser: User = {
      id: editingUser.id || Date.now().toString(),
      employeeId: editingUser.employeeId || nextEmployeeId(),
      name: editingUser.name,
      username: editingUser.username,
      pin: editingUser.pin,
      role: editingUser.role || 'employee',
      isActive: editingUser.isActive !== false,
      hourlyRate: editingUser.hourlyRate || undefined,
    };
    DB.saveUser(newUser);
    closeModal();
    addToast('success', `${editingUser.id ? 'Updated' : 'Welcome'} ${newUser.name} (${newUser.employeeId})`);
  };

  const randomPin = () => String(Math.floor(1000 + Math.random() * 9000));
  const suggestUsername = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9.]/g, '');

  const admins = users.filter(u => u.role === 'admin');
  const managers = users.filter(u => u.role === 'manager');
  const workers = users.filter(u => u.role === 'employee');
  const isEditing = !!editingUser.id;

  const canNextWizard =
    wizardStep === 1 ? !!editingUser.role :
    wizardStep === 2 ? !!editingUser.name && !!editingUser.username :
    wizardStep === 3 ? !!editingUser.pin && editingUser.pin.length >= 4 :
    true;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-2xl font-black text-white flex items-center gap-2 tracking-tight"><Users className="w-6 h-6 text-amber-500" /> Team</h2>
          <p className="text-sm text-zinc-500 mt-0.5">{users.length} member{users.length !== 1 ? 's' : ''} · {admins.length} admin · {managers.length} manager{managers.length !== 1 ? 's' : ''} · {workers.length} worker{workers.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowBadges(true)} disabled={users.length === 0} className="bg-zinc-800/80 hover:bg-zinc-700 border border-white/10 text-white px-4 py-2.5 rounded-xl flex items-center gap-2 text-sm font-bold transition-all disabled:opacity-40" title="Print QR sign-in badges">
            <QrCode className="w-4 h-4" aria-hidden="true" /> Print Badges
          </button>
          <button onClick={openNew} className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white px-5 py-2.5 rounded-xl flex items-center gap-2 text-sm font-bold shadow-lg shadow-amber-900/40 transition-all">
            <Plus className="w-4 h-4" aria-hidden="true" /> Invite Member
          </button>
        </div>
      </div>

      {/* Role sections */}
      {(['admin', 'manager', 'employee'] as const).map(role => {
        const meta = ROLE_META[role];
        const list = users.filter(u => u.role === role);
        if (list.length === 0 && role !== 'employee') return null;
        const Icon = meta.icon;
        return (
          <div key={role} className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <div className={`w-6 h-6 rounded-lg ${meta.tint} border flex items-center justify-center`}>
                <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} aria-hidden="true" />
              </div>
              <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest">{meta.label}s</h3>
              <span className="text-[10px] text-zinc-600 font-mono">{list.length}</span>
              <div aria-hidden="true" className="flex-1 h-[1px] bg-gradient-to-r from-white/10 to-transparent ml-2" />
            </div>
            {list.length === 0 ? (
              <div className="bg-zinc-900/30 border border-dashed border-white/5 rounded-2xl p-6 text-center">
                <p className="text-zinc-600 text-xs">{role === 'employee' ? 'No workers yet — invite your first team member above.' : `No ${meta.label.toLowerCase()}s.`}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {list.map(u => (
                  <div key={u.id} className="card-shine hover-lift-glow group bg-zinc-900/50 border border-white/5 rounded-2xl p-4 flex items-start gap-3 relative overflow-hidden">
                    <div aria-hidden="true" className="absolute top-0 left-0 right-0 h-[2px]" style={{ backgroundImage: `linear-gradient(90deg, ${meta.color}66, transparent)` }} />
                    <Avatar name={u.name} size="md" ring />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-1.5 flex-wrap">
                        <p className="font-bold text-white leading-tight break-words" style={{ wordBreak: 'break-word' }}>{u.name}</p>
                        {u.isActive === false && <span className="text-[9px] font-black text-zinc-500 bg-zinc-800 border border-white/5 px-1.5 py-0.5 rounded shrink-0">INACTIVE</span>}
                      </div>
                      <p className="text-[11px] text-zinc-500 truncate mt-0.5">@{u.username}</p>
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {u.employeeId && <span className="text-[9px] font-mono font-bold text-zinc-400 bg-zinc-800/60 border border-white/5 px-1.5 py-0.5 rounded">{u.employeeId}</span>}
                        {u.hourlyRate ? <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">${u.hourlyRate.toFixed(2)}/hr</span> : null}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button aria-label={`Edit ${u.name}`} onClick={() => openEdit(u)} className="p-1.5 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors" title="Edit"><Edit2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
                      <button aria-label={`Remove ${u.name}`} onClick={() => handleDelete(u.id)} className="p-1.5 hover:bg-red-500/10 rounded-lg text-zinc-500 hover:text-red-400 transition-colors" title="Remove"><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Onboarding Wizard Modal — portaled + fully opaque so nothing bleeds through */}
      {showModal && createPortal(
        <div role="dialog" aria-modal="true" aria-label={isEditing ? 'Edit team member' : 'Invite new member'} className="fixed inset-0 z-[200] overflow-y-auto bg-zinc-950 animate-fade-in" onClick={closeModal}>
          <div className="min-h-full flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col my-0 sm:my-4 animate-slide-up" style={{ maxHeight: 'calc(100dvh - 2rem)' }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between bg-gradient-to-b from-zinc-800/40 to-transparent shrink-0">
              <div>
                <h3 className="font-black text-white text-base tracking-tight">{isEditing ? 'Edit Member' : 'Invite New Member'}</h3>
                {!isEditing && <p className="text-[11px] text-zinc-500 mt-0.5">Step {wizardStep} of 4</p>}
              </div>
              <button aria-label="Close" onClick={closeModal} className="text-zinc-400 hover:text-white transition-colors w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10"><X className="w-4 h-4" aria-hidden="true" /></button>
            </div>

            {/* Progress bar (wizard only) */}
            {!isEditing && (
              <div className="px-5 pt-4 shrink-0">
                <div className="flex items-center gap-1.5">
                  {[1, 2, 3, 4].map(s => (
                    <div key={s} className={`flex-1 h-1 rounded-full transition-all duration-500 ${s < wizardStep ? 'bg-gradient-to-r from-orange-500 to-amber-500' : s === wizardStep ? 'bg-amber-500' : 'bg-zinc-800'}`} />
                  ))}
                </div>
                <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider mt-2 text-zinc-600">
                  <span className={wizardStep >= 1 ? 'text-amber-400' : ''}>Role</span>
                  <span className={wizardStep >= 2 ? 'text-amber-400' : ''}>Identity</span>
                  <span className={wizardStep >= 3 ? 'text-amber-400' : ''}>Access</span>
                  <span className={wizardStep >= 4 ? 'text-amber-400' : ''}>Review</span>
                </div>
              </div>
            )}

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Step 1 — role picker (wizard only) */}
              {!isEditing && wizardStep === 1 && (
                <div className="space-y-3 animate-fade-in">
                  <div>
                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1">Pick a role</p>
                    <p className="text-[11px] text-zinc-600">Controls what this person can see and do.</p>
                  </div>
                  {(['employee', 'manager', 'admin'] as const).map(r => {
                    const meta = ROLE_META[r];
                    const Icon = meta.icon;
                    const active = editingUser.role === r;
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setEditingUser({ ...editingUser, role: r })}
                        className={`w-full flex items-start gap-3 p-4 rounded-2xl border text-left transition-all ${active ? 'bg-gradient-to-br from-amber-500/15 to-orange-500/5 border-amber-500/40 ring-1 ring-amber-500/30' : 'bg-zinc-900/50 border-white/5 hover:border-white/15 hover:bg-zinc-900/80'}`}
                      >
                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${meta.accent} flex items-center justify-center shadow-lg shrink-0`}>
                          <Icon className="w-5 h-5 text-white" aria-hidden="true" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white">{meta.label}</span>
                            {active && <span className="text-[10px] font-black text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">SELECTED</span>}
                          </div>
                          <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{meta.description}</p>
                        </div>
                        {active && <CheckCircle className="w-5 h-5 text-amber-400 shrink-0" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Step 2 — identity (wizard + edit) */}
              {(isEditing || wizardStep === 2) && (
                <div className="space-y-4 animate-fade-in">
                  {!isEditing && (
                    <div>
                      <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1">Who is joining?</p>
                      <p className="text-[11px] text-zinc-600">Their full name and a username they'll use to sign in.</p>
                    </div>
                  )}
                  {/* Preview avatar */}
                  {editingUser.name && (
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900/60 border border-white/5">
                      <Avatar name={editingUser.name} size="lg" ring />
                      <div className="min-w-0">
                        <p className="text-white font-bold truncate">{editingUser.name}</p>
                        <p className="text-xs text-zinc-500 truncate">@{editingUser.username || suggestUsername(editingUser.name)}</p>
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Full Name</label>
                    <input
                      autoFocus
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-700 outline-none"
                      placeholder="e.g. Maria Gonzales"
                      value={editingUser.name || ''}
                      onChange={e => {
                        const name = e.target.value;
                        setEditingUser({ ...editingUser, name, username: editingUser.username || suggestUsername(name) });
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Username</label>
                    <div className="relative">
                      <span aria-hidden="true" className="absolute left-4 top-3 text-zinc-500">@</span>
                      <input
                        className="w-full bg-black/40 border border-white/10 rounded-xl pl-8 pr-4 py-3 text-white placeholder:text-zinc-700 outline-none font-mono"
                        placeholder="maria.gonzales"
                        value={editingUser.username || ''}
                        onChange={e => setEditingUser({ ...editingUser, username: e.target.value.toLowerCase().replace(/\s+/g, '.') })}
                      />
                    </div>
                    <p className="text-[10px] text-zinc-600 mt-1.5">They'll sign in with this. No spaces, lowercase.</p>
                  </div>
                  {isEditing && (
                    <div>
                      <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Role</label>
                      <div className="grid grid-cols-3 gap-2">
                        {(['employee', 'manager', 'admin'] as const).map(r => {
                          const meta = ROLE_META[r];
                          const active = editingUser.role === r;
                          return (
                            <button
                              key={r}
                              type="button"
                              onClick={() => setEditingUser({ ...editingUser, role: r })}
                              className={`px-3 py-2.5 rounded-xl border text-sm font-bold transition-all ${active ? 'ring-1 ring-blue-500/30 ' + meta.tint : 'bg-zinc-900/50 border-white/5 text-zinc-400 hover:text-white'}`}
                            >
                              {meta.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step 3 — PIN + hourly rate (wizard + edit) */}
              {(isEditing || wizardStep === 3) && (
                <div className="space-y-4 animate-fade-in">
                  {!isEditing && (
                    <div>
                      <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1">Access &amp; pay</p>
                      <p className="text-[11px] text-zinc-600">Set a PIN for sign-in. You can change it anytime.</p>
                    </div>
                  )}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">PIN (4+ digits)</label>
                      <button type="button" onClick={() => setEditingUser({ ...editingUser, pin: randomPin() })} className="text-[11px] text-amber-400 hover:text-amber-300 font-semibold">Generate</button>
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={8}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-700 outline-none font-mono text-lg tracking-[0.3em]"
                      placeholder="••••"
                      value={editingUser.pin || ''}
                      onChange={e => setEditingUser({ ...editingUser, pin: e.target.value.replace(/\D/g, '') })}
                    />
                  </div>
                  {(editingUser.role === 'admin' || editingUser.role === 'manager' || editingUser.role === 'employee') && (
                    <div>
                      <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Hourly Rate <span className="text-zinc-600 normal-case font-normal">— used for job costing, hidden from workers</span></label>
                      <div className="relative">
                        <span aria-hidden="true" className="absolute left-4 top-3 text-zinc-500">$</span>
                        <input
                          type="number"
                          step="0.01"
                          className="w-full bg-black/40 border border-white/10 rounded-xl pl-8 pr-4 py-3 text-white placeholder:text-zinc-700 outline-none font-mono"
                          placeholder="0.00"
                          value={editingUser.hourlyRate || ''}
                          onChange={e => setEditingUser({ ...editingUser, hourlyRate: Number(e.target.value) || 0 })}
                        />
                      </div>
                    </div>
                  )}
                  {isEditing && (
                    <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-900/60 border border-white/5">
                      <div>
                        <p className="text-sm font-semibold text-white">Active</p>
                        <p className="text-[10px] text-zinc-500">Inactive members can't sign in but their history stays intact.</p>
                      </div>
                      <Toggle checked={editingUser.isActive !== false} onChange={v => setEditingUser({ ...editingUser, isActive: v })} />
                    </div>
                  )}
                </div>
              )}

              {/* Step 4 — review + invite (wizard only) */}
              {!isEditing && wizardStep === 4 && (
                <div className="space-y-4 animate-fade-in">
                  <div>
                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1">Ready to invite</p>
                    <p className="text-[11px] text-zinc-600">Review the details, then share these credentials with the new member.</p>
                  </div>

                  {/* Summary card */}
                  {(() => {
                    const meta = ROLE_META[editingUser.role || 'employee'];
                    return (
                      <div className="bg-gradient-to-br from-zinc-900/80 to-zinc-900/40 border border-white/10 rounded-2xl p-4 space-y-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={editingUser.name} size="lg" ring />
                          <div className="min-w-0">
                            <p className="text-white font-black truncate">{editingUser.name}</p>
                            <p className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded border inline-block mt-1 ${meta.tint}`}>{meta.label}</p>
                          </div>
                        </div>
                        <div className="divider-gradient" />
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Username</p>
                            <p className="text-white font-mono mt-0.5">@{editingUser.username}</p>
                          </div>
                          <div>
                            <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">PIN</p>
                            <p className="text-white font-mono tracking-[0.2em] mt-0.5">{editingUser.pin}</p>
                          </div>
                          {editingUser.hourlyRate ? (
                            <div className="col-span-2">
                              <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Hourly Rate</p>
                              <p className="text-emerald-400 font-mono mt-0.5">${(editingUser.hourlyRate || 0).toFixed(2)}/hr</p>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })()}

                  {/* QR-invite card — scan from phone to sign in */}
                  {(() => {
                    const inviteUrl = `${window.location.origin}?u=${encodeURIComponent(editingUser.username || '')}`;
                    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&bgcolor=09090b&color=ffffff&margin=0&data=${encodeURIComponent(inviteUrl)}`;
                    return (
                      <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/5 border border-amber-500/25 rounded-2xl p-4 flex items-center gap-4">
                        <div className="shrink-0 p-2 bg-white rounded-xl">
                          <img src={qrUrl} alt={`QR code for ${editingUser.name}`} className="w-24 h-24 block" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-black text-amber-300 uppercase tracking-widest">Scan to sign in</p>
                          <p className="text-[11px] text-amber-400/80 mt-1 leading-snug">Have {editingUser.name?.split(' ')[0] || 'them'} scan this with their phone camera to open the app. They'll just need to enter their PIN.</p>
                          <button
                            type="button"
                            onClick={async () => {
                              const text = `${editingUser.name} — sign-in\nUsername: ${editingUser.username}\nPIN: ${editingUser.pin}\nApp: ${window.location.origin}`;
                              try { await navigator.clipboard.writeText(text); setCopiedInvite(true); setTimeout(() => setCopiedInvite(false), 2000); } catch {}
                            }}
                            className="mt-2 bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-colors"
                          >
                            <Copy className="w-3 h-3" aria-hidden="true" /> {copiedInvite ? 'Copied!' : 'Copy Credentials'}
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Role capabilities preview */}
                  <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3">
                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">What they'll see</p>
                    <ul className="space-y-1.5 text-[12px] text-zinc-300">
                      {editingUser.role === 'admin' && <>
                        <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" aria-hidden="true" /> Everything — jobs, logs, team, billing, TV display, settings</li>
                        <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" aria-hidden="true" /> Financials: revenue, profit, hourly rates</li>
                      </>}
                      {editingUser.role === 'manager' && <>
                        <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" aria-hidden="true" /> Jobs, logs, workers, reports, live floor</li>
                        <li className="flex items-center gap-2"><X className="w-3 h-3 text-zinc-600 shrink-0" aria-hidden="true" /> Cannot edit billing or remove admins</li>
                      </>}
                      {editingUser.role === 'employee' && <>
                        <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" aria-hidden="true" /> Work Station view, scan jobs, log time, view own history</li>
                        <li className="flex items-center gap-2"><X className="w-3 h-3 text-zinc-600 shrink-0" aria-hidden="true" /> Cannot see rates, other workers' logs, or financials</li>
                      </>}
                    </ul>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-white/10 bg-zinc-950/50 flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={() => wizardStep > 1 ? setWizardStep(wizardStep - 1) : closeModal()}
                className="px-4 py-2.5 text-zinc-400 hover:text-white font-medium transition-colors"
              >
                {wizardStep === 1 || isEditing ? 'Cancel' : 'Back'}
              </button>
              {isEditing || wizardStep === 4 ? (
                <button
                  type="button"
                  onClick={handleSave}
                  className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-amber-900/30 flex items-center gap-2 transition-all"
                >
                  <Save className="w-4 h-4" aria-hidden="true" />
                  {isEditing ? 'Save Changes' : 'Invite Member'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => canNextWizard && setWizardStep(wizardStep + 1)}
                  disabled={!canNextWizard}
                  className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-amber-900/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-all"
                >
                  Continue <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Badge Sheet — printable 4-up QR badge grid — portaled, opaque */}
      {showBadges && createPortal(
        <div role="dialog" aria-modal="true" aria-label="Sign-in badges" className="fixed inset-0 z-[200] overflow-y-auto bg-zinc-950 animate-fade-in no-print" onClick={() => setShowBadges(false)}>
          <div className="min-h-full flex items-start sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-zinc-900 border border-white/10 w-full max-w-5xl rounded-none sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col my-0 sm:my-4" style={{ maxHeight: 'calc(100dvh - 2rem)' }} onClick={e => e.stopPropagation()}>
            {/* Header — hidden in print */}
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between bg-gradient-to-b from-zinc-800/40 to-transparent shrink-0 no-print">
              <div>
                <h3 className="font-black text-white text-base tracking-tight flex items-center gap-2"><QrCode className="w-4 h-4 text-amber-400" aria-hidden="true" /> Sign-In Badges</h3>
                <p className="text-[11px] text-zinc-500 mt-0.5">Print, cut, and laminate. Workers scan their badge to sign in instantly.</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => window.print()} className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg shadow-amber-900/30 transition-all">
                  <Printer className="w-4 h-4" aria-hidden="true" /> Print
                </button>
                <button aria-label="Close" onClick={() => setShowBadges(false)} className="text-zinc-400 hover:text-white transition-colors w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10"><X className="w-4 h-4" aria-hidden="true" /></button>
              </div>
            </div>

            {/* Badge grid — 2 cols on screen, 2 cols in print (A4 letter, 4 per page works at this size) */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-zinc-950/50">
              <div id="badge-sheet" className="grid grid-cols-1 sm:grid-cols-2 gap-4 print:gap-3 max-w-4xl mx-auto">
                {users.filter(u => u.isActive !== false).map(u => {
                  const meta = ROLE_META[u.role];
                  const inviteUrl = `${window.location.origin}?u=${encodeURIComponent(u.username)}`;
                  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&bgcolor=ffffff&color=000000&margin=0&data=${encodeURIComponent(inviteUrl)}`;
                  return (
                    <div key={u.id} className="badge-card bg-white text-black rounded-2xl overflow-hidden relative shadow-lg" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                      {/* Role-colored top strip */}
                      <div className="h-2" style={{ background: `linear-gradient(90deg, ${meta.color}, ${meta.color}80)` }} />

                      {/* Body */}
                      <div className="p-4 flex items-center gap-4">
                        {/* QR code */}
                        <div className="shrink-0 p-1.5 bg-white border border-zinc-200 rounded-xl">
                          <img src={qrUrl} alt={`Sign-in QR for ${u.name}`} className="w-24 h-24 block" />
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em]">{shopSettings.companyName || 'SC DEBURRING'}</p>
                          <p className="text-lg font-black text-zinc-900 leading-tight mt-0.5 truncate" title={u.name}>{u.name}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            <span className="text-[9px] font-mono font-bold text-zinc-700 bg-zinc-100 border border-zinc-200 px-1.5 py-0.5 rounded">{u.employeeId || 'EMP-???'}</span>
                            <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded text-white" style={{ background: meta.color }}>{meta.label}</span>
                          </div>
                          <p className="text-[9px] text-zinc-500 mt-2 font-mono">@{u.username}</p>
                          <p className="text-[9px] text-zinc-400 mt-0.5 italic">Scan to sign in</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Help text — screen only */}
              <p className="text-center text-[11px] text-zinc-500 mt-6 no-print">
                {users.filter(u => u.isActive !== false).length} active badge{users.filter(u => u.isActive !== false).length !== 1 ? 's' : ''} ·
                Tip: print on cardstock or laminate for durability · Inactive users excluded
              </p>
            </div>
          </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};


// ── TV Error Boundary — catches React render crashes and auto-reloads in 5s.
// Wall-mounted TVs can't have someone walk over and refresh. If a slide
// throws (bad data, null ref, etc.), show a friendly "reconnecting" screen
// and reload automatically so the TV recovers without human intervention.
// ── TvAutoReload — hooks global error events and auto-reloads after 10s if
// a JS error fires while the TV is in standalone mode. Simpler than a class
// error boundary and handles async/network crashes class EBs miss.
const TvAutoReload: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [crashed, setCrashed] = useState(false);
  const [countdown, setCountdown] = useState(10);
  useEffect(() => {
    const onErr = () => setCrashed(true);
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onErr);
    return () => { window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onErr); };
  }, []);
  useEffect(() => {
    if (!crashed) return;
    const id = setInterval(() => setCountdown(n => { if (n <= 1) { window.location.reload(); } return n - 1; }), 1000);
    return () => clearInterval(id);
  }, [crashed]);
  if (crashed) return (
    <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center gap-6 text-white">
      <div className="text-6xl animate-pulse">📡</div>
      <h1 className="text-3xl font-black">Reconnecting…</h1>
      <p className="text-zinc-400 text-lg">Display will refresh in <span className="text-white font-bold">{countdown}s</span></p>
      <button onClick={() => window.location.reload()} className="mt-2 px-6 py-3 bg-amber-600 hover:bg-amber-500 rounded-xl font-bold text-sm">Reload now</button>
    </div>
  );
  return <>{children}</>;
};

export default function App() {
  // ── TV mode detection ───────────────────────────────────────────────
  // Priority: URL param (?tv=1) → localStorage fallback (persists across browser restarts)
  // When detected via URL, write to localStorage so Smart TV browsers that lose
  // the query string on restart can recover automatically.
  const [tvToken] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('tv');
    if (urlToken) {
      // Save TV mode so it survives browser restarts / tab closures
      try { localStorage.setItem('fabtrack_tv', '1'); } catch {}
      return urlToken;
    }
    // localStorage recovery — TV browser restarted without the ?tv param
    try {
      if (localStorage.getItem('fabtrack_tv') === '1') {
        // Restore the URL param so TvAutoReload reloads preserve it
        const p = new URLSearchParams(window.location.search);
        p.set('tv', '1');
        history.replaceState({}, '', `${window.location.pathname}?${p.toString()}`);
        return '1';
      }
    } catch {}
    return null;
  });

  // Check for Customer Portal mode
  // Supports both legacy (?portal=CUSTOMER_NAME) and short slug (?c=slug)
  // `?c=slug` is resolved to the customer name via settings.clientSlugs
  const [portalCustomer] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const portal = params.get('portal');
    if (portal) return portal;
    const slug = params.get('c');
    if (!slug) return null;
    // Resolve slug → customer name from settings
    try {
      const settings = DB.getSettings();
      const slugMap = settings.clientSlugs || {};
      for (const [customerName, s] of Object.entries(slugMap)) {
        if (s === slug) return customerName;
      }
    } catch {}
    return slug; // fallback: treat slug as customer name
  });
  const [portalQuoteId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('quote') || params.get('q') || null;
  });

  // Save ?jobId= from QR scan URL to sessionStorage IMMEDIATELY before anything else
  // This survives login flow, page refreshes, and works for both admin and employee
  useState(() => {
    const params = new URLSearchParams(window.location.search);
    const qrJobId = params.get('jobId');
    if (qrJobId) {
      sessionStorage.setItem('pending_jobId', qrJobId);
      window.history.replaceState({}, '', window.location.pathname);
    }
  });

  const [user, setUser] = useState<User | null>(() => {
    try { return JSON.parse(localStorage.getItem('nexus_user') || 'null'); }
    catch (e) { return null; }
  });

  const [view, setView] = useState<AppView>('login');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [printable, setPrintable] = useState<Job | null>(null);
  const [confirm, setConfirm] = useState<any>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar_collapsed') === '1'; } catch { return false; }
  });
  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('sidebar_collapsed', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);
  // AI POScanner state retained as inert placeholder; UI button removed.
  const [appSettings, setAppSettings] = useState<SystemSettings>(DB.getSettings());
  // For notifications  track all jobs and active logs globally
  const [allJobs, setAllJobs] = useState<Job[]>([]);
  const [allActiveLogs, setAllActiveLogs] = useState<TimeLog[]>([]);
  // Full logs (including completed sessions + samples) — needed by the
  // over-budget alert engine, which compares actual vs rate-learned est.
  const [allFullLogs, setAllFullLogs] = useState<TimeLog[]>([]);
  // Command palette — global Cmd+K / Ctrl+K
  const [paletteOpen, setPaletteOpen] = useCommandPalette();
  const { permission, requestPermission, alerts, markRead, markAllRead, clearAll } = useNotifications(allJobs, allActiveLogs, user);

  // Subscribe globally for notification checks + settings
  useEffect(() => {
    const unsubS = DB.subscribeSettings(s => setAppSettings(s));
    return unsubS;
  }, []);
  useEffect(() => {
    if (!user) return;
    const unsub1 = DB.subscribeJobs(jobs => setAllJobs(jobs));
    const unsub2 = DB.subscribeLogs(logs => {
      setAllActiveLogs(logs.filter((l: TimeLog) => !l.endTime));
      setAllFullLogs(logs);
    });
    return () => { unsub1(); unsub2(); };
  }, [user]);

  // ── Over-budget alert engine ─────────────────────────────────────────
  // Fires when a job's actual logged time crosses its rate-learned
  // estimate (with buffer applied). Sends in-app toast + EmailJS email.
  // Tracks already-alerted jobs in localStorage so we don't re-fire
  // every render. Only admins/managers get the alerts.
  useEffect(() => {
    if (!user) return;
    if (user.role !== 'admin' && user.role !== 'manager') return;
    if (!appSettings.overBudgetAlertEnabled) return;
    if (allJobs.length === 0 || allFullLogs.length === 0) return;

    const buffer = appSettings.rateBuffer && appSettings.rateBuffer > 0 ? appSettings.rateBuffer : 1.15;
    const hits = findOverBudgetJobs(allJobs, allFullLogs, buffer);
    if (hits.length === 0) return;

    const alerted = getAlertedJobIds();
    const fresh = hits.filter(h => !alerted.has(h.job.id));
    if (fresh.length === 0) return;

    // Fire toast + email for each newly-over-budget job
    fresh.forEach(async hit => {
      markJobAlerted(hit.job.id);
      const label = hit.job.jobIdsDisplay || hit.job.poNumber || hit.job.id.slice(-6);
      addToast('error', `⚠ ${label} — ${hit.actualHours.toFixed(1)}h logged, est ${hit.estimatedHours.toFixed(1)}h. Over by ${hit.overByHours.toFixed(1)}h.`);

      // Email (no-op if EmailJS not configured)
      await sendOverBudgetEmail(appSettings, {
        jobIdDisplay:   label,
        poNumber:       hit.job.poNumber || '',
        partNumber:     hit.job.partNumber || '',
        customer:       hit.job.customer || '',
        estimatedHours: hit.estimatedHours,
        actualHours:    hit.actualHours,
        overByHours:    hit.overByHours,
        operations:     hit.operations.join(', '),
        shopName:       appSettings.companyName || 'FabTrack',
        jobUrl:         `${window.location.origin}?jobId=${hit.job.id}`,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allJobs, allFullLogs, appSettings.rateBuffer, appSettings.overBudgetAlertEnabled, user?.id, user?.role]);

  useEffect(() => {
    if (user) {
      localStorage.setItem('nexus_user', JSON.stringify(user));
      if (view === 'login') {
        // If there's a pending QR scan, go to jobs/workstation instead of default
        const pendingJob = sessionStorage.getItem('pending_jobId');
        const isStaff = user.role === 'admin' || user.role === 'manager';
        if (pendingJob && isStaff) {
          setView('admin-scan'); // Staff goes to Work Station where scan handler lives
        } else {
          setView(isStaff ? 'admin-dashboard' : 'employee-scan');
        }
      }
    } else {
      localStorage.removeItem('nexus_user');
      setView('login');
    }
  }, [user]);

  const addToast = useCallback((type: any, message: any) => {
    setToasts(p => [...p, { id: Date.now().toString(), type, message }]);
  }, []);

  // Auto lunch pause hook
  useAutoLunch(addToast);

  // Theme effect — apply light/dark class to body
  useEffect(() => {
    const unsub = DB.subscribeSettings((s) => {
      if (s.theme === 'light') { document.body.classList.add('light-theme'); }
      else { document.body.classList.remove('light-theme'); }
    });
    return unsub;
  }, []);

  // Auto clock-out sweep: runs on mount + every 60s
  useEffect(() => {
    DB.sweepStaleLogs().catch(e => console.warn('[auto-clock-out] sweep failed:', e));
    const id = setInterval(() => {
      DB.sweepStaleLogs().catch(e => console.warn('[auto-clock-out] sweep failed:', e));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(p => p.filter(x => x.id !== id));
  }, []);

  // ── Customer Portal Mode ──
  // Standalone TV mode — no login needed, loads account data via token
  if (tvToken) {
    return <TvAutoReload><LiveFloorMonitor standalone /></TvAutoReload>;
  }

  if (portalCustomer) {
    return <CustomerPortal customerFilter={portalCustomer} quoteId={portalQuoteId} />;
  }

  if (!user || view === 'login') {
    return (
      <>
        <PrintStyles />
        <LoginView onLogin={setUser} addToast={addToast} />
        <div className="fixed bottom-4 right-4 z-50 pointer-events-none">
          <div className="pointer-events-auto flex flex-col items-end gap-2">
            {toasts.map(t => <Toast key={t.id} toast={t} onClose={removeToast} />)}
          </div>
        </div>
      </>
    );
  }

 // Sidebar organized into 5 logical groups. Grouped labels make the
  // 15-item menu scannable instead of a wall of icons. Each section header
  // is hidden when the sidebar is collapsed (icons-only mode).
  const navGroups: { label: string; items: { id: string; l: string; i: any; adminOnly?: boolean }[] }[] = [
    { label: 'Dashboard', items: [
      { id: 'admin-dashboard', l: 'Overview',     i: LayoutDashboard },
      { id: 'admin-live',      l: 'Live Floor',   i: Activity },
    ]},
    { label: 'Jobs & Schedule', items: [
      { id: 'admin-jobs',      l: 'Jobs',         i: Briefcase },
      { id: 'admin-board',     l: 'Board',        i: Columns3 },
      { id: 'admin-calendar',  l: 'Calendar',     i: Calendar },
      { id: 'admin-samples',   l: 'Samples',      i: Camera },
    ]},
    { label: 'Documents', items: [
      { id: 'admin-quotes',          l: 'Quotes',     i: FileText },
      { id: 'admin-purchase-orders', l: 'Purchasing', i: Package },
      { id: 'admin-deliveries',      l: 'Deliveries', i: Truck },
    ]},
    { label: 'Quality & Ops', items: [
      { id: 'admin-quality',   l: 'Quality',      i: AlertTriangle },
      { id: 'admin-logs',      l: 'Logs',         i: History },
      { id: 'admin-scan',      l: 'Work Station', i: ScanLine },
    ]},
    { label: 'Admin', items: [
      { id: 'admin-reports',   l: 'Reports',      i: Calculator },
      { id: 'admin-team',      l: 'Team',         i: Users },
      { id: 'admin-settings',  l: 'Settings',     i: Settings, adminOnly: true },
    ]},
  ];
  // Managers see everything EXCEPT Settings (admin-only billing/config surface).
  // Filter empty groups so hidden sections don't render phantom labels.
  const visibleGroups = navGroups
    .map(g => ({ ...g, items: g.items.filter(n => !n.adminOnly || user?.role === 'admin') }))
    .filter(g => g.items.length > 0);

  // (handlePOJobCreate removed — only used by the AI POScanner which we
  // pulled out. New jobs come in via the New Job modal in JobsView.)

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <TrialBanner />
      <div className="flex-1 flex min-h-0">
      <PrintStyles />
      <PWAInstallBanner />
      <PrintableJobSheet job={printable} onClose={() => setPrintable(null)} onPrinted={(id) => { const list = JSON.parse(localStorage.getItem('printed_jobs') || '[]'); if (!list.includes(id)) { list.push(id); localStorage.setItem('printed_jobs', JSON.stringify(list)); } window.dispatchEvent(new Event('printed-update')); }} />
      <ConfirmationModal isOpen={!!confirm} {...(confirm || {})} onCancel={() => setConfirm(null)} />

      {(user.role === 'admin' || user.role === 'manager') && (
        <>
          {/* Mobile overlay backdrop */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 bg-black/60 z-30 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          {/* Sidebar  hidden on mobile unless open, always visible on md+. Collapsible to icons-only on md+. */}
          <aside aria-label="Primary sidebar" className={`
            fixed h-full z-40 flex flex-col
            ${sidebarCollapsed ? 'md:w-[68px] w-64' : 'w-64'}
            border-r border-white/5 bg-gradient-to-b from-zinc-950 via-zinc-950 to-black
            transition-[transform,width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            md:translate-x-0
          `}>
            {/* Gradient accent line */}
            <div aria-hidden="true" className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />

            <div className={`font-bold text-white flex items-center ${sidebarCollapsed ? 'md:flex-col md:p-3 md:gap-3 md:justify-center p-5 justify-between gap-3' : 'p-5 justify-between gap-3'}`}>
              <div className={`flex items-center gap-2.5 min-w-0 ${sidebarCollapsed ? 'md:justify-center' : ''}`}>
                <div className="relative shrink-0">
                  {appSettings.companyLogo ? (
                    <div className="w-9 h-9 rounded-xl overflow-hidden bg-white flex items-center justify-center shadow-lg shadow-black/40">
                      <img src={appSettings.companyLogo} alt="" className="w-full h-full object-contain p-0.5" />
                    </div>
                  ) : (
                    <>
                      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-orange-500 to-amber-600 rounded-xl blur-md opacity-60" />
                      <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center shadow-lg shadow-orange-500/30">
                        <Sparkles className="w-5 h-5 text-white" aria-hidden="true" />
                      </div>
                    </>
                  )}
                </div>
                <div className={`min-w-0 ${sidebarCollapsed ? 'md:hidden' : ''}`}>
                  <p className="text-[15px] font-black tracking-tight leading-none truncate">{appSettings.companyName || 'My Shop'}</p>
                  <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-widest mt-0.5">FabTrack IO</p>
                </div>
              </div>
              <NotificationBell permission={permission} requestPermission={requestPermission} userId={user?.id} alerts={alerts} markRead={markRead} markAllRead={markAllRead} clearAll={clearAll} align="left" />
            </div>
            <nav aria-label="Main navigation" className={`mt-2 ${sidebarCollapsed ? 'md:px-2 px-3' : 'px-3'}`}>
              {visibleGroups.map((group, gi) => (
                <div key={group.label} className={gi > 0 ? 'mt-3' : ''}>
                  {/* Section label — hidden when sidebar is collapsed; on collapse
                      a thin divider stands in so the visual grouping survives. */}
                  <p
                    className={`text-[10px] font-black text-zinc-600 uppercase tracking-widest px-3.5 mb-1 ${
                      sidebarCollapsed ? 'md:hidden' : ''
                    }`}
                    aria-hidden={sidebarCollapsed ? 'true' : undefined}
                  >
                    {group.label}
                  </p>
                  {sidebarCollapsed && gi > 0 && (
                    <div aria-hidden="true" className="hidden md:block h-[1px] bg-white/5 mx-2 my-2" />
                  )}
                  <div className="space-y-0.5">
                    {group.items.map(x => {
                      const active = view === x.id;
                      return (
                        <button key={x.id} onClick={() => { setView(x.id as any); setSidebarOpen(false); }}
                          aria-current={active ? 'page' : undefined}
                          title={sidebarCollapsed ? x.l : undefined}
                          className={`relative flex items-center gap-3 w-full rounded-xl text-sm font-semibold transition-all group
                            ${sidebarCollapsed ? 'md:justify-center md:px-2.5 md:py-2.5 px-3.5 py-2.5' : 'px-3.5 py-2.5'}
                            ${active
                              ? 'bg-gradient-to-r from-amber-500/15 to-transparent text-white shadow-sm'
                              : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}>
                          {active && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-gradient-to-b from-amber-400 to-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]" />}
                          <x.i className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${active ? 'text-amber-400' : 'text-zinc-500 group-hover:text-zinc-300'}`} aria-hidden="true" />
                          <span className={sidebarCollapsed ? 'md:hidden' : ''}>{x.l}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
            {/* Collapse toggle — desktop only */}
            <button
              onClick={toggleSidebarCollapsed}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-pressed={sidebarCollapsed}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={`hidden md:flex items-center gap-2 mx-3 mt-3 rounded-xl text-xs font-bold text-zinc-500 hover:text-white hover:bg-white/5 transition-all
                ${sidebarCollapsed ? 'justify-center px-2.5 py-2' : 'px-3.5 py-2'}`}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" aria-hidden="true" /> : <PanelLeftClose className="w-4 h-4" aria-hidden="true" />}
              <span className={sidebarCollapsed ? 'hidden' : ''}>Collapse</span>
            </button>
            <div className={`mt-auto border-t border-white/5 ${sidebarCollapsed ? 'md:p-2 p-4' : 'p-4'}`}>
              <div className={`flex items-center gap-3 rounded-xl bg-zinc-900/60 mb-2 hover-lift
                ${sidebarCollapsed ? 'md:justify-center md:p-2 p-3' : 'p-3'}`}>
                <Avatar name={user?.name} size="md" ring />
                <div className={`min-w-0 flex-1 ${sidebarCollapsed ? 'md:hidden' : ''}`}>
                  <p className="text-sm font-bold text-white truncate">{user?.name}</p>
                  <p className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {user?.role}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setUser(null)}
                aria-label="Sign out"
                title={sidebarCollapsed ? 'Sign Out' : undefined}
                className={`w-full flex items-center justify-center gap-2 rounded-xl border border-white/5 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20 text-sm font-bold transition-all
                  ${sidebarCollapsed ? 'md:px-2 md:py-2 px-4 py-2.5' : 'px-4 py-2.5'}`}
              >
                <LogOut className="w-4 h-4" aria-hidden="true" />
                <span className={sidebarCollapsed ? 'md:hidden' : ''}>Sign Out</span>
              </button>
            </div>
          </aside>
        </>
      )}

      {/* Main content */}
      <main id="main-content" aria-label="Main content" className={`flex-1 overflow-auto transition-[margin] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${(user.role === 'admin' || user.role === 'manager') ? (sidebarCollapsed ? 'md:ml-[68px]' : 'md:ml-64') : ''}`}>

        {/* Mobile top bar  only shows for staff (admin/manager) on small screens */}
        {(user.role === 'admin' || user.role === 'manager') && (
          <div className="md:hidden flex items-center justify-between px-4 py-3 bg-zinc-950/80 backdrop-blur-xl border-b border-white/5 sticky top-0 z-20">
            <button
              aria-label="Open navigation menu"
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-xl bg-zinc-800/80 border border-white/10 text-zinc-300 hover:text-white hover:bg-zinc-700 min-h-[40px] min-w-[40px] active:scale-95 transition-all"
            >
              <Menu className="w-5 h-5" aria-hidden="true" />
            </button>
            <div className="flex items-center gap-2 font-black text-white text-sm tracking-tight">
              <div className="relative w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/30">
                <Sparkles className="w-4 h-4 text-white" aria-hidden="true" />
              </div>
              SC DEBURRING
            </div>
            <NotificationBell permission={permission} requestPermission={requestPermission} userId={user?.id} alerts={alerts} markRead={markRead} markAllRead={markAllRead} clearAll={clearAll} />
          </div>
        )}

        <div className="p-4 md:p-8 pb-24 md:pb-8">
          {view === 'admin-dashboard' && <AdminDashboard confirmAction={setConfirm} setView={setView} user={user} addToast={addToast} />}
          {view === 'admin-jobs' && <JobsView user={user} addToast={addToast} setPrintable={setPrintable} confirm={setConfirm} onOpenPOScanner={() => { /* AI scan disabled */ }} />}
          {view === 'admin-board' && (
            <FeatureGate feature="kanbanBoard">
              <JobBoardView user={user} addToast={addToast} confirm={setConfirm} onEditStages={() => setView('admin-settings')} />
            </FeatureGate>
          )}
          {view === 'admin-quality' && (
            <FeatureGate feature="quality">
              <QualityView user={user} addToast={addToast} confirm={setConfirm} />
            </FeatureGate>
          )}
          {view === 'admin-deliveries' && user && (
            <FeatureGate feature="deliveries">
              <DeliveriesView user={{ id: user.id, name: user.name, role: user.role }} addToast={addToast} />
            </FeatureGate>
          )}
          {view === 'admin-purchase-orders' && user && (
            <FeatureGate feature="purchaseOrders">
              <PurchaseOrdersView user={{ id: user.id, name: user.name, role: user.role }} addToast={addToast} />
            </FeatureGate>
          )}
          {view === 'admin-calendar' && <JobsView key="cal" user={user} addToast={addToast} setPrintable={setPrintable} confirm={setConfirm} onOpenPOScanner={() => { /* AI scan disabled */ }} calendarOnly />}
          {view === 'admin-logs' && <LogsView addToast={addToast} confirm={setConfirm} />}
          {view === 'admin-team' && <AdminEmployees addToast={addToast} confirm={setConfirm} />}
          {view === 'admin-settings' && <SettingsView addToast={addToast} userId={user?.id} />}
          {view === 'admin-reports' && <ReportsView />}
          {view === 'admin-live' && <LiveFloorMonitor user={user} onBack={() => setView('admin-dashboard')} addToast={addToast} />}
          {view === 'admin-samples' && (
            <FeatureGate feature="samples">
              <SamplesView addToast={addToast} currentUser={user ? { id: user.id, name: user.name } : null} />
            </FeatureGate>
          )}
          {view === 'admin-quotes' && user && <QuotesView addToast={addToast} user={{ id: user.id, name: user.name }} onJobCreate={async (data) => {
            const jobId = `JOB-${Date.now()}`;
            await DB.saveJob({
              id: jobId,
              jobIdsDisplay: `J-${jobId.slice(-6)}`,
              poNumber: data.poNumber,
              partNumber: data.partNumber,
              customer: data.customer,
              quantity: data.quantity,
              dateReceived: new Date().toLocaleDateString('en-US'),
              dueDate: data.dueDate,
              info: data.info,
              status: 'pending',
              createdAt: Date.now(),
              quoteAmount: data.quoteAmount,
              linkedQuoteId: data.linkedQuoteId,
              // Routing (Round 2 #7): when the quote used Process Library items, pick the matching stage
              ...(data.initialStageId ? { currentStage: data.initialStageId } : {}),
            } as any);
          }} />}
          {view === 'admin-scan' && <EmployeeDashboard user={user} addToast={addToast} onLogout={() => setView('admin-dashboard')} notifBell={<NotificationBell permission={permission} requestPermission={requestPermission} userId={user?.id} alerts={alerts} markRead={markRead} markAllRead={markAllRead} clearAll={clearAll} />} />}
          {view === 'employee-scan' && <EmployeeDashboard user={user} addToast={addToast} onLogout={() => setUser(null)} notifBell={<NotificationBell permission={permission} requestPermission={requestPermission} userId={user?.id} alerts={alerts} markRead={markRead} markAllRead={markAllRead} clearAll={clearAll} />} />}
        </div>
      </main>

     {/* AI POScanner removed — kept the file in repo so we can re-enable
         later as a Shop OS-tier feature. For now, manual entry is faster
         and free vs. paying Gemini per scan. */}
            <div className="fixed bottom-6 right-6 z-50 pointer-events-none">
        <div className="pointer-events-auto flex flex-col items-end gap-2">
          {toasts.map(t => <Toast key={t.id} toast={t} onClose={removeToast} />)}
        </div>
      </div>
      {/* PWA install prompt — only shows if not installed + not dismissed in last 7 days */}
      <PwaInstallPrompt />

      {/* Command palette — Cmd+K / Ctrl+K jump anywhere.
          Only wired up when a user is logged in; the login view has no nav. */}
      {user && (
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onNavigate={(v) => { setView(v as AppView); setPaletteOpen(false); }}
          jobs={allJobs}
        />
      )}


      {/* Onboarding wizard — first-run only for admin/manager on a TRULY new account.
          Suppressed for existing shops (they already have data) so it doesn't nag during dev.
          Can be triggered manually from Settings → Shop Profile. */}
      {user && (user.role === 'admin' || user.role === 'manager')
        && !appSettings.onboardingComplete
        && !appSettings.companyName  // existing accounts have a company name set
        && (allJobs.length === 0)    // and no jobs yet = truly new
        && (
        <OnboardingWizard
          currentSettings={appSettings}
          canSkip={true}
          onComplete={(updated) => {
            setAppSettings(updated);
            DB.saveSettings(updated);
            addToast('success', '✨ Shop profile saved — app tailored to your workflow');
          }}
          onSkip={() => {
            setAppSettings({ ...appSettings, onboardingComplete: true });
            DB.saveSettings({ ...appSettings, onboardingComplete: true });
          }}
        />
      )}
      </div>{/* /flex-1 inner row that holds sidebar + main + overlays */}
    </div>
  );
}





