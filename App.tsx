import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

import {
  LayoutDashboard, Briefcase, Users, Settings, LogOut, Menu,
  Sparkles, Zap, Clock, CheckCircle, StopCircle,
  Search, Plus, User as UserIcon, Calendar, Edit2, Save, X,
  ArrowRight, Box, History, AlertCircle, ChevronDown, ChevronRight, Filter, Info,
  Printer, ScanLine, QrCode, Power, AlertTriangle, Trash2, Wifi, WifiOff,
  RotateCcw, ChevronUp, Database, ExternalLink, RefreshCw, Calculator, Activity,
  Play, Bell, BellOff, BellRing, Pause, Camera, Image, ChevronLeft, Download, FileText, ClipboardCheck,
  Share2, Link, Copy, Radio, Columns3, GripVertical, MessageSquare,
  PanelLeftClose, PanelLeftOpen, Cloud, Truck, Package, Scan, DollarSign, TrendingUp, TrendingDown, Award, Beaker, PhoneCall
} from 'lucide-react';
import { Toast } from './components/Toast';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { useConfirm } from './components/useConfirm';
import { OnboardingWizard } from './components/OnboardingWizard';
import { Job, User, UserRole, TimeLog, ToastMessage, AppView, SystemSettings, TvSlide, Quote, JobStage, ReworkEntry, PurchaseOrder, Sample, CustomerPoFile, ShopAction } from './types';
import { readyToInvoiceList } from './utils/poOrganizer';
import { JobProfitCard } from './components/JobProfitCard';
import { CanWeTakeIt } from './components/CanWeTakeIt';
import { TimekeepingHealthPanel } from './components/TimekeepingHealthPanel';
import { ShopTrendsPanel } from './components/ShopTrendsPanel';
import { ShopActionsPanel } from './components/ShopActionsPanel';
import { FocusStrip } from './components/FocusStrip';
import { RiskPill, FamiliarityChip, RiskBanner, RiskCrewPanel } from './components/RiskBadge';
import { buildPartRiskIndex, computeJobRisk, workerFamiliarity, partVeterans, type JobRisk, type Familiarity, type WorkerPartExperience } from './utils/jobRisk';
import { jobSteps, stepProgress, nextStep, stepDone, stepTickedBy, logMinutes, fmtMinutes, normOp } from './utils/jobSteps';
// ── Lazy views ────────────────────────────────────────────────────────────
// Post-login screens load on demand — cuts the startup bundle roughly in half
// so the login/dashboard paint much sooner. LiveFloorMonitor, CustomerPortal
// and QuotesView stay EAGER: they render before login (?tv= wall, ?portal=).
//
// lazyView = React.lazy + a stale-deploy net. Chunks are content-hashed, so a
// device still running YESTERDAY'S index.html asks for chunk names that no
// longer exist after a deploy → the import rejects → the view renders blank.
// Net: retry once (transient network), then force ONE reload (sessionStorage
// guard prevents loops) so the client picks up the fresh index + chunks.
function lazyView<T extends React.ComponentType<any>>(loader: () => Promise<{ default: T }>): React.LazyExoticComponent<T> {
  return React.lazy(() =>
    loader().catch(() =>
      new Promise<{ default: T }>(res => setTimeout(res as any, 800)).then(() => loader())
    ).then((mod) => {
      try { sessionStorage.removeItem('chunk_reload'); } catch {}   // healthy again — re-arm the net
      return mod;
    }).catch((err) => {
      try {
        if (!sessionStorage.getItem('chunk_reload')) {
          sessionStorage.setItem('chunk_reload', '1');
          window.location.reload();
        }
      } catch {}
      throw err;
    })
  );
}
const CustomerPosView = lazyView(() => import('./views/CustomerPosView').then(m => ({ default: m.CustomerPosView })));
import { calcJobProfit, buildProfitSnapshot } from './utils/jobProfit';
import { groupLogsByJob, jobBudgets, jobMoney, type JobBudget } from './utils/jobBudget';
import { RowMenu } from './components/RowMenu';
import { changedFields, hasChanges } from './utils/changedFields';
import { shrinkImage, FILE_BUDGET_BYTES } from './utils/imageShrink';
import { DateInput } from './components/DateInput';
import { useOverlayLayer } from './components/overlayStack';
import * as DB from './services/mockDb';
import { LiveFloorMonitor, useAutoLunch } from './LiveFloorMonitor';
const SamplesView = lazyView(() => import('./SamplesView').then(m => ({ default: m.SamplesView })));
// AI scanning (parseJobDetails / POScanner) removed from production —
// see Jobs view comment. Gemini service file stays for future re-enable.
import { QuotesView } from './QuotesView';
import { CustomerPortal } from './CustomerPortal';
const ReportsView = lazyView(() => import('./views/ReportsView').then(m => ({ default: m.ReportsView })));
const WeeklyReportView = lazyView(() => import('./views/WeeklyReportView').then(m => ({ default: m.WeeklyReportView })));
const JobBoardView = lazyView(() => import('./views/JobBoardView').then(m => ({ default: m.JobBoardView })));
const DeliveriesView = lazyView(() => import('./views/DeliveriesView').then(m => ({ default: m.DeliveriesView })));
const PurchaseOrdersView = lazyView(() => import('./views/PurchaseOrdersView').then(m => ({ default: m.PurchaseOrdersView })));
const SettingsView = lazyView(() => import('./views/SettingsView').then(m => ({ default: m.SettingsView })));
const ProgressView = lazyView(() => import('./views/SettingsView').then(m => ({ default: m.ProgressView })));
import { VendorsManager } from './components/VendorsManager';
const QualityView = lazyView(() => import('./views/QualityView').then(m => ({ default: m.QualityView })));
const ReworkModal = lazyView(() => import('./views/QualityView').then(m => ({ default: m.ReworkModal })));
const LogsView = lazyView(() => import('./views/LogsView').then(m => ({ default: m.LogsView })));
const CustomersView = lazyView(() => import('./views/CustomersView').then(m => ({ default: m.CustomersView })));
const PricingView = lazyView(() => import('./views/PricingView').then(m => ({ default: m.PricingView })));

/** base64 data URL → Blob (for uploading legacy/captured images to Storage). */
function dataUrlToBlobApp(dataUrl: string): Blob | null {
  try {
    const [header, b64] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  } catch { return null; }
}

/** Suspense fallback while a lazy view chunk downloads — calm, centered, brief. */
const ViewLoader = () => (
  <div className="flex flex-col items-center justify-center py-24 gap-3 animate-fade-in">
    <div className="w-8 h-8 rounded-full border-2 border-amber-500/30 border-t-amber-500 animate-spin" />
    <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Loading…</p>
  </div>
);

/** Last-resort net under the lazy views: if a chunk still can't load after
 *  lazyView's retry+reload (e.g. offline mid-deploy), show a reload button
 *  instead of a silent blank screen. */
class ViewErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: any) { console.error('[FabTrack] view failed to load:', err?.message || err); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 animate-fade-in text-center px-6">
        <p className="text-white font-bold">This screen couldn't load.</p>
        <p className="text-zinc-500 text-sm max-w-sm">Usually a fresh update was just published. Reload to grab the newest version.</p>
        <button
          onClick={() => { try { sessionStorage.removeItem('chunk_reload'); } catch {} window.location.reload(); }}
          className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white px-6 py-2.5 rounded-xl font-bold text-sm"
        >
          Reload App
        </button>
      </div>
    );
  }
}
import { POScanner } from './components/POScanner';
import { printPackingSlipPDF, printJobTravelerPDF, printJobTravelersPDF } from './services/pdfService';
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
import { dueState, shippedOnTime, onTimeRate, compareByDue, dueLabel, toDateInput, isJobClosed, isShippedStageId } from './utils/dueDates';
import { makeClientSlug, buildPortalUrl } from './utils/url';
import { getPartHistory, suggestExpectedHours } from './utils/partHistory';
import { getSampleEstimateForPart, suggestHoursFromSample, getAggregatedSampleEstimate, suggestHoursFromAggregated } from './utils/sampleEstimate';
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
import { useShipDate, resolveShipAt, type ShipChoice } from './components/useShipDate';
import { saveTvToken, getSavedTvToken, setTvExitReason } from './utils/tvRuntime';
import { OperationsStageMapper } from './components/OperationsStageMapper';
import { ClientUpdateGenerator } from './components/ClientUpdateGenerator';
import { CommandPalette, useCommandPalette } from './components/CommandPalette';
import { JobTimeline } from './components/JobTimeline';
import { isDeveloper } from './utils/devMode';
import { watchLongRunningTimers, watchClockInReminder, watchEndOfShiftReminder, showTimerStarted, cancelTimerNotification, watchLiveTimerBadge } from './services/reminders';
// mediaSession intentionally removed — hijacks music player controls in shop environments
import { watchShiftAlarms, playAlarmSound, preloadAlarmSounds, scheduleUpcomingAlarms, lunchWindow } from './services/shiftAlarms';
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

// Drops a double-tap on Start: a second clock-in for the same worker while the
// first is still in flight is ignored, so they can't open two timers at once.
const _startInFlight = new Set<string>();

const useNotifications = (jobs: Job[], activeLogs: TimeLog[], user: any, fullLogs: TimeLog[] = []) => {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [alerts, setAlerts] = useState<Array<{id:string; type:'overdue'|'due-soon'|'urgent'|'long-timer'|'new-urgent'|'clock-in'|'clock-out'|'over-budget'|'dead-job'; title:string; body:string; time:number; read:boolean}>>([]);
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
      const reg = await navigator.serviceWorker.ready;
      // If there's already a subscription, unsubscribe first.
      // This handles VAPID key rotation — keeping the old sub would cause
      // pushManager.subscribe() to throw "applicationServerKey does not match".
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        const existingKey = existing.options?.applicationServerKey;
        const newKey = vapidKeyToUint8(VAPID_KEY);
        const keysMatch = existingKey && existingKey.byteLength === newKey.byteLength &&
          new Uint8Array(existingKey as ArrayBuffer).every((b, i) => b === newKey[i]);
        if (!keysMatch) await existing.unsubscribe();
      }
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
      const activeJobs = jobs.filter(j => j.status !== 'completed');

      let changed = false;
      const addTag = (tag: string) => { notifiedRef.current.add(tag); changed = true; };

      // Overdue jobs — shared rule (shipped/closed jobs never alert)
      activeJobs.filter(j => dueState(j) === 'overdue').forEach(j => {
        const tag = `overdue-${j.id}-${today}`;
        if (!notifiedRef.current.has(tag)) {
          addTag(tag);
          fire('overdue', '🚨 Overdue Job', `PO ${j.poNumber} was due ${fmt(j.dueDate)}`, tag);
        }
      });

      // Due today or soon — same window as the "Due Soon" badge on job cards
      activeJobs.filter(j => { const s = dueState(j); return s === 'today' || s === 'soon'; }).forEach(j => {
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

      // ── Budget watch — push alert at 90% and 100% of expectedHours ──────
      // Only fires while a worker is actually clocked in (live hours include
      // the running session). Admin only — workers see the on-screen banner.
      if (user?.role === 'admin') {
        const nowMs = Date.now();
        const logMins = (l: TimeLog) => l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0);
        const completedMins = new Map<string, number>();
        fullLogs.forEach(l => {
          if (!l.endTime || l.isSample) return;
          completedMins.set(l.jobId, (completedMins.get(l.jobId) || 0) + logMins(l));
        });
        activeJobs.filter(j => (j.expectedHours || 0) > 0).forEach(j => {
          const live = activeLogs.filter(l => l.jobId === j.id);
          if (live.length === 0) return; // nobody on it — nothing burning
          const liveMins = live.reduce((a, l) => a + Math.max(0, ((l.pausedAt ?? nowMs) - l.startTime - (l.totalPausedMs || 0))) / 60000, 0);
          const totalHrs = ((completedMins.get(j.id) || 0) + liveMins) / 60;
          const pct = totalHrs / j.expectedHours!;
          if (pct >= 1) {
            const tag = `budget100-${j.id}`;
            if (!notifiedRef.current.has(tag)) {
              addTag(tag);
              fire('over-budget', '🔴 Job Over Budget', `PO ${j.poNumber} — ${totalHrs.toFixed(1)}h of ${j.expectedHours}h used, worker still clocked in`, tag);
            }
          } else if (pct >= 0.9) {
            const tag = `budget90-${j.id}`;
            if (!notifiedRef.current.has(tag)) {
              addTag(tag);
              const minsLeft = Math.max(0, Math.round((j.expectedHours! - totalHrs) * 60));
              fire('over-budget', '⚠️ Approaching Budget', `PO ${j.poNumber} — 90% of ${j.expectedHours}h used, ~${minsLeft} min left`, tag);
            }
          }
        });
      }

      // ── Dead job watch — started, then went silent for 4+ work hours ────
      // Catches forgotten/blocked jobs: status in-progress, has prior logged
      // work, nobody clocked in, and the last session ended over 4h ago.
      // Only fires during working hours (7am–6pm, Mon–Sat), once per day.
      if (user?.role === 'admin') {
        const now = new Date();
        const hr = now.getHours();
        const dow = now.getDay(); // 0 = Sunday
        if (hr >= 7 && hr < 18 && dow !== 0) {
          const lastEnd = new Map<string, number>();
          fullLogs.forEach(l => {
            if (!l.endTime || l.isSample) return;
            if (l.endTime > (lastEnd.get(l.jobId) || 0)) lastEnd.set(l.jobId, l.endTime);
          });
          const liveJobIds = new Set(activeLogs.map(l => l.jobId));
          activeJobs.filter(j => j.status === 'in-progress').forEach(j => {
            if (liveJobIds.has(j.id)) return;          // someone's on it
            const last = lastEnd.get(j.id);
            if (!last) return;                          // never started — not "dead"
            if (Date.now() - last < 4 * 3600000) return;
            const tag = `deadjob-${j.id}-${today}`;
            if (!notifiedRef.current.has(tag)) {
              addTag(tag);
              const hrsAgo = ((Date.now() - last) / 3600000).toFixed(1);
              fire('dead-job', '💀 Job Stalled', `PO ${j.poNumber} — in progress but no work logged for ${hrsAgo}h`, tag);
            }
          });
        }
      }

      // Persist to localStorage so page refreshes don't re-fire
      if (changed) saveNotifiedTags(notifiedRef.current);
    };

    check(); // run immediately
    const interval = setInterval(check, 60000);
    return () => clearInterval(interval);
  }, [jobs, activeLogs, fullLogs, fire, user?.role]);

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
    if (type === 'over-budget') return { Icon: DollarSign,  color: '#f87171', tint: 'bg-red-500/10'     };
    if (type === 'dead-job')    return { Icon: AlertTriangle, color: '#a1a1aa', tint: 'bg-zinc-500/10'  };
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
    ? { left: 8, right: 8, top: 'auto', bottom: 8, maxHeight: 'calc(100vh - 80px - env(safe-area-inset-bottom))' }
    : pos
      ? openOnRight
        ? { top: pos.top, left: Math.min(pos.left, window.innerWidth - 392), width: 384, maxHeight: `calc(100vh - ${Math.max(pos.top + 24, 120)}px - env(safe-area-inset-bottom))` }
        : { top: pos.top, right: Math.max(pos.right, 12), width: 384, maxHeight: `calc(100vh - ${Math.max(pos.top + 24, 120)}px - env(safe-area-inset-bottom))` }
      : { top: 64, right: 12, width: 384, maxHeight: 'calc(100vh - 120px - env(safe-area-inset-bottom))' };

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
const ActiveJobPanel = ({ job, log, onStop, onPause, onResume, priorMinutes = 0 }: { job: Job | null, log: TimeLog, onStop: (id: string) => Promise<void>, onPause?: (id: string) => Promise<void>, onResume?: (id: string) => Promise<void>, /** Finished time already logged on this job (everyone), in minutes. */ priorMinutes?: number }) => {
  const [isStopping, setIsStopping] = useState(false);
  const isMounted = useRef(true);
  useEffect(() => () => { isMounted.current = false; }, []);

  // ── Pace warning ────────────────────────────────────────────────────
  // Re-evaluate every 30 s so the banner appears as soon as the worker
  // passes (or approaches) the job estimate — without waiting for a re-render.
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const calc = () => {
      if (log.pausedAt) { setElapsedMs(log.pausedAt - log.startTime - (log.totalPausedMs || 0)); return; }
      setElapsedMs(Date.now() - log.startTime - (log.totalPausedMs || 0));
    };
    calc();
    const id = setInterval(calc, 30_000);
    return () => clearInterval(id);
  }, [log.startTime, log.pausedAt, log.totalPausedMs]);

  // The estimate is for the WHOLE job (every operation, every worker), so
  // compare it with everything logged on the job plus this timer — this
  // timer alone said "over budget" too late, or when the job wasn't.
  const estMs   = job?.expectedHours ? job.expectedHours * 3_600_000 : 0;
  const jobMs   = priorMinutes * 60_000 + elapsedMs;
  const pctUsed = estMs > 0 ? jobMs / estMs : 0;
  const isOverEst    = estMs > 0 && pctUsed >= 1;
  const isApproaching = estMs > 0 && pctUsed >= 0.75 && !isOverEst;
  const minsRemaining = estMs > 0 ? Math.max(0, Math.round((estMs - jobMs) / 60000)) : 0;

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
          {/* Job ID only when it isn't just the PO number again */}
          {job?.jobIdsDisplay && job.jobIdsDisplay !== job.poNumber && (
            <p className="text-sm text-zinc-500 mb-3">Job ID: <span className="font-mono text-zinc-400">{job.jobIdsDisplay}</span></p>
          )}
          <div className="text-xl text-amber-400 font-medium mb-4 mt-2 flex items-center gap-2">
            <span className="px-3 py-1 bg-amber-500/10 rounded-lg border border-amber-500/20">{log.operation}</span>
          </div>

          {/* Pace warning banner — shown only when job has an estimate */}
          {isOverEst && (
            <div className="mb-4 w-full max-w-sm bg-red-500/15 border border-red-500/40 rounded-xl px-4 py-3 flex items-start gap-3">
              <span className="text-red-400 text-lg mt-0.5">⚠</span>
              <div>
                <p className="text-red-400 font-black text-sm uppercase tracking-wide">Past the estimate</p>
                <p className="text-red-300/70 text-xs mt-0.5">This job has {fmtMinutes(jobMs / 60000)} logged against a {job!.expectedHours}h estimate. Let your supervisor know.</p>
              </div>
            </div>
          )}
          {isApproaching && (
            <div className="mb-4 w-full max-w-sm bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex items-start gap-3">
              <span className="text-amber-400 text-lg mt-0.5">⏱</span>
              <div>
                <p className="text-amber-400 font-bold text-sm">Close to the estimate</p>
                <p className="text-amber-300/60 text-xs mt-0.5">About {fmtMinutes(minsRemaining)} left of the {job!.expectedHours}h estimate for the whole job.</p>
              </div>
            </div>
          )}

          <div className="bg-black/40 rounded-2xl p-6 border border-white/10 mb-6 w-full max-w-sm flex items-center justify-between">
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">{isPaused ? 'Paused' : 'Elapsed Time'}</p>
              <div className="text-white"><LiveTimer startTime={log.startTime} pausedAt={log.pausedAt} totalPausedMs={log.totalPausedMs} /></div>
            </div>
            <Clock className="w-8 h-8 text-zinc-600" />
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
            {isPaused ? (
              <button aria-label="Resume timer" onClick={handleResumeClick}
                className="flex-1 w-full min-h-[48px] bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-5 sm:py-4 rounded-xl font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20 active:scale-[0.97] transition-transform">
                <Play className="w-5 h-5" aria-hidden="true" /> Resume
              </button>
            ) : onPause ? (
              <button aria-label="Pause timer" onClick={handlePauseClick}
                className="flex-1 w-full min-h-[48px] bg-yellow-600 hover:bg-yellow-500 text-white px-6 py-5 sm:py-4 rounded-xl font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-yellow-900/20 active:scale-[0.97] transition-transform">
                <Pause className="w-5 h-5" aria-hidden="true" /> Pause
              </button>
            ) : null}
            <button aria-label="Stop timer" onClick={handleStopClick} disabled={isStopping}
              className="flex-1 w-full min-h-[48px] bg-red-600 hover:bg-red-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-6 py-5 sm:py-4 rounded-xl font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-red-900/20 active:scale-[0.97] transition-transform">
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
                  <div><label className="text-[10px] text-zinc-500 uppercase font-bold">Quantity</label><div className="text-sm font-bold text-white">{job.quantity} <span className="text-xs font-normal text-zinc-500">pcs</span></div></div>
                  <div className="col-span-2"><label className="text-[10px] text-zinc-500 uppercase font-bold">Due</label>
                    {(() => {
                      const d = dueState(job);
                      return (
                        <div className={`text-sm font-bold ${d === 'overdue' ? 'text-red-400' : d === 'today' || d === 'soon' ? 'text-orange-400' : 'text-white'}`}>
                          {job.dueDate ? `${fmt(job.dueDate)} · ${dueLabel(job.dueDate)}` : '—'}
                        </div>
                      );
                    })()}
                  </div>
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
              {job.info && (
                <div className="mt-auto pt-3 border-t border-white/10">
                  <label className="text-[10px] text-zinc-500 uppercase font-bold mb-1 block">Notes</label>
                  <div className="text-zinc-300 text-xs leading-relaxed bg-black/20 p-3 rounded-lg border border-white/5">{job.info}</div>
                </div>
              )}
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
// The worker's view of one job. Closed, it shows only what's needed to pick a
// job from the list: photo, PO, part and quantity, when it's due, one flag
// when it changes what you do, who's on it and the next step. Open, it shows
// what to watch out for, the instructions, the job's steps (each with its own
// Start button, the time logged on it, and a tick for when it's finished),
// other operations, drawings and notes.
// `disabled` = this worker already has a timer running; the card still opens
// for the steps, drawings and notes — only starting is blocked.
// `startingKey` = "jobId|op" being started.
const firstNameOf = (n?: string) => (n || '').trim().split(/\s+/)[0] || 'Someone';

const JobSelectionCard: React.FC<{
  job: Job;
  onStart: (id: string, op: string) => void;
  disabled?: boolean;
  startingKey?: string | null;
  operations: string[];
  defaultExpanded?: boolean;
  user?: { id: string; name: string };
  addToast?: any;
  /** Everyone's running timers — who's on this job right now. */
  activeLogs?: TimeLog[];
  /** This job's logs (finished and running) — time logged per step. */
  jobLogs?: TimeLog[];
  /** Operations this job / this part has actually been run through before. */
  doneBeforeOps?: string[];
  risk?: JobRisk;
  familiarity?: Familiarity;
  vets?: WorkerPartExperience[];
}> = ({ job, onStart, disabled, startingKey = null, operations, defaultExpanded, user, addToast, activeLogs = [], jobLogs = [], doneBeforeOps = [], risk, familiarity, vets = [] }) => {
  const [expanded, setExpanded] = useState(defaultExpanded || false);
  const [showAllOps, setShowAllOps] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [newNote, setNewNote] = useState('');
  const submitNote = () => {
    const text = newNote.trim();
    if (!text || !user) return;
    setNewNote('');
    DB.addJobNote(job.id, text, user.id, user.name, job.jobIdsDisplay || job.partNumber || job.id)
      .then(() => addToast?.('success', 'Note added'))
      .catch(() => { setNewNote(text); addToast?.('error', "Couldn't save the note — check the Wi-Fi and try again"); });
  };
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

  const due = dueState(job);
  const isOverdue = due === 'overdue';
  const isDueSoon = due === 'today' || due === 'soon';
  const borderClass = isOverdue || job.priority === 'urgent' ? 'border-red-500/40 bg-red-500/5'
    : job.priority === 'high' ? 'border-orange-500/30 bg-orange-500/5'
    : 'border-white/5';
  // At most one flag on the closed card, and only when it changes what you do.
  const flag = job.status === 'hold' ? { text: '⏸ On hold', cls: 'text-zinc-200 bg-zinc-700/70 border-white/15' }
    : job.priority === 'urgent' ? { text: 'Urgent', cls: 'text-red-300 bg-red-500/10 border-red-500/30' }
    : risk?.tier === 'red' ? { text: 'Red job', cls: 'text-red-300 bg-red-500/10 border-red-500/30' }
    : job.priority === 'high' ? { text: 'High', cls: 'text-orange-300 bg-orange-500/10 border-orange-500/25' }
    : risk?.tier === 'yellow' ? { text: 'Yellow job', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30' }
    : null;
  const onIt = activeLogs.filter(l => l.jobId === job.id);
  const whoText = onIt.length === 0 ? ''
    : onIt.length === 1 ? `${firstNameOf(onIt[0].userName)} on ${(onIt[0].operation || 'it').toLowerCase()}`
    : `${[...new Set(onIt.map(l => firstNameOf(l.userName)))].join(', ')} on it`;
  const steps = jobSteps(job, operations, jobLogs);
  const doneCount = steps.filter(s => s.done).length;
  const next = steps.find(s => !s.done);
  const stepOps = new Set(steps.map(s => normOp(s.item.label)));
  const busy = !!startingKey;

  const tick = (item: JobChecklistItem, done: boolean) => {
    if (!user) return;
    DB.setChecklistTick(job.id, item.id, { done, by: user.id, name: user.name, at: Date.now() })
      .then(() => { if (done) addToast?.('success', `✓ ${item.label} done`); })
      .catch(() => addToast?.('error', "Couldn't save that tick — check the Wi-Fi and try again"));
  };

  const startBtn = (op: string, highlight: boolean) => (
    <button key={op} disabled={disabled || busy} onClick={e => { e.stopPropagation(); onStart(job.id, op); }}
      className={`${highlight
        ? 'bg-gradient-to-br from-amber-500/20 to-amber-500/[0.06] hover:from-amber-500 hover:to-orange-500 border-amber-500/40 text-amber-200 hover:text-white'
        : 'bg-zinc-800 hover:bg-amber-600 hover:text-white border-white/5 text-zinc-300'} border py-3 px-4 min-h-[48px] rounded-xl text-sm transition-colors font-bold active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5`}>
      {startingKey === `${job.id}|${op}`
        ? <><span aria-hidden="true" className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Starting…</>
        : <>{highlight && <span className="text-[10px] opacity-70">↺</span>}{op}</>}
    </button>
  );
  const stepStartBtn = (op: string, highlight: boolean) => (
    <button disabled={disabled || busy} onClick={e => { e.stopPropagation(); onStart(job.id, op); }}
      aria-label={`Start ${op}`}
      className={`shrink-0 min-h-[44px] px-3.5 rounded-lg text-sm font-bold flex items-center gap-1.5 border transition-colors active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${highlight
        ? 'bg-amber-500 hover:bg-amber-400 text-zinc-950 border-amber-400'
        : 'bg-zinc-800 hover:bg-amber-600 hover:text-white text-zinc-200 border-white/10'}`}>
      {startingKey === `${job.id}|${op}`
        ? <><span aria-hidden="true" className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Starting…</>
        : <><Play className="w-3.5 h-3.5" aria-hidden="true" /> Start</>}
    </button>
  );

  return (
    <div ref={cardRef} data-job-id={job.id} className={`border rounded-2xl overflow-hidden transition-all duration-300 ${borderClass} ${expanded ? 'ring-2 ring-amber-500/50' : 'hover:bg-zinc-800/50'} ${defaultExpanded ? 'ring-2 ring-amber-500 shadow-lg shadow-amber-500/10' : ''}`}>
      <div className="p-4 sm:p-5 cursor-pointer bg-zinc-900/50" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
        <div className="flex items-start gap-3">
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
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-xl font-black text-white leading-tight truncate">PO {job.poNumber}</h3>
              <div className="flex items-center gap-1.5 shrink-0">
                {flag && <span className={`text-[10px] font-black px-1.5 py-0.5 rounded border ${flag.cls}`}>{flag.text}</span>}
                <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
              </div>
            </div>
            <p className="text-sm text-zinc-400 truncate mt-0.5">
              <span className="text-zinc-200 font-medium">{job.partNumber}</span>
              {(job.quantity || 0) > 0 && <> · {job.quantity} pcs</>}
            </p>
            {job.dueDate && (
              <p className={`text-sm font-bold mt-0.5 ${isOverdue ? 'text-red-400' : isDueSoon ? 'text-orange-400' : 'text-zinc-400'}`}>
                {due === 'overdue' ? `OVERDUE · ${dueLabel(job.dueDate)} (${fmt(job.dueDate)})`
                  : due === 'today' ? `Due TODAY · ${fmt(job.dueDate)}`
                  : due === 'soon' ? `Due soon · ${fmt(job.dueDate)}`
                  : `Due ${fmt(job.dueDate)}`}
              </p>
            )}
          </div>
        </div>
        {(steps.length > 0 || whoText) && (
          <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-zinc-400">
              {next ? <>Next: <span className="text-white font-bold">{next.item.label}</span></>
                : steps.length > 0 ? <span className="text-emerald-400 font-bold">✓ All steps done</span> : null}
            </span>
            <span className="shrink-0 text-xs text-zinc-500 truncate max-w-[60%] text-right">
              {[steps.length > 0 && next ? `${doneCount} of ${steps.length} done` : '', whoText].filter(Boolean).join(' · ')}
            </span>
          </div>
        )}
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
      </div>
      {expanded && (
        <div className="p-4 bg-zinc-950/50 border-t border-white/5 space-y-3 animate-fade-in">
          {risk && familiarity && <RiskBanner risk={risk} fam={familiarity} vets={vets} />}
          {(job.specialInstructions || job.info || (job.jobIdsDisplay && job.jobIdsDisplay !== job.poNumber)) && (
            <div className="p-3 bg-zinc-900 rounded-lg border border-white/5 text-sm space-y-1.5">
              {job.specialInstructions && (
                <p className="text-yellow-100/90 leading-relaxed"><span className="text-[10px] font-black uppercase tracking-wider text-yellow-400 mr-1.5">Instructions</span>{job.specialInstructions}</p>
              )}
              {job.info && (
                <p className="text-zinc-300 leading-relaxed"><span className="text-[10px] font-black uppercase tracking-wider text-zinc-500 mr-1.5">Notes</span>{job.info}</p>
              )}
              {/* Job ID only when it's not just the PO number again. */}
              {job.jobIdsDisplay && job.jobIdsDisplay !== job.poNumber && (
                <p className="text-xs text-zinc-500">Job ID <span className="font-mono text-zinc-400">{job.jobIdsDisplay}</span></p>
              )}
            </div>
          )}

          {disabled && (
            <p className="text-xs font-bold text-amber-400/90">Your timer is running — stop it above to start this job.</p>
          )}

          {/* Steps — the job's checklist, each step with its own Start button
              and a tick for when it's finished (also offered at Stop). */}
          {steps.length > 0 && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1.5">Steps · {doneCount} of {steps.length} done</p>
              <div className="rounded-xl border border-white/10 divide-y divide-white/5 overflow-hidden">
                {steps.map(s => {
                  const isNext = next?.item.id === s.item.id;
                  const sub = s.done
                    ? [s.doneBy ? `Done by ${s.doneBy}` : 'Done', s.loggedMinutes >= 1 ? fmtMinutes(s.loggedMinutes) : ''].filter(Boolean).join(' · ')
                    : [s.runningBy.length ? `${s.runningBy.join(', ')} on it now` : '',
                       s.loggedMinutes >= 1 ? `${fmtMinutes(s.loggedMinutes)} so far${s.workers.length ? ` · ${s.workers.join(', ')}` : ''}` : ''].filter(Boolean).join(' · ');
                  return (
                    <div key={s.item.id} className={`flex items-center gap-2 pl-1.5 pr-2 py-1.5 ${s.done ? 'bg-emerald-500/[0.04]' : isNext ? 'bg-amber-500/[0.05]' : 'bg-zinc-900/60'}`}>
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); tick(s.item, !s.done); }}
                        aria-label={s.done ? `Mark ${s.item.label} not done` : `Mark ${s.item.label} done`}
                        className="w-11 h-11 flex items-center justify-center shrink-0 rounded-lg hover:bg-white/5"
                      >
                        {s.done
                          ? <CheckCircle className="w-6 h-6 text-emerald-400" aria-hidden="true" />
                          : <span aria-hidden="true" className={`w-6 h-6 rounded-full border-2 ${isNext ? 'border-amber-400/70' : 'border-zinc-600'}`} />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-bold truncate ${s.done ? 'text-zinc-500 line-through' : 'text-white'}`}>{s.item.label}</p>
                        {sub && <p className="text-[11px] text-zinc-500 truncate">{sub}</p>}
                      </div>
                      {s.operation && !s.done && stepStartBtn(s.operation, isNext)}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(() => {
            // A job with steps: everything else hides behind "Other operation".
            if (steps.length > 0) {
              const others = operations.filter(op => !stepOps.has(normOp(op)));
              if (others.length === 0) return null;
              return (<>
                <button onClick={e => { e.stopPropagation(); setShowAllOps(s => !s); }}
                  className="w-full min-h-[44px] text-xs font-bold text-zinc-400 hover:text-white flex items-center justify-center gap-1 transition-colors">
                  {showAllOps ? <>Hide other operations <ChevronUp className="w-3 h-3" /></> : <>Other operation ({others.length}) <ChevronDown className="w-3 h-3" /></>}
                </button>
                {showAllOps && <div className="grid grid-cols-2 gap-2 animate-fade-in">{others.map(op => startBtn(op, false))}</div>}
              </>);
            }
            // No steps: the operations this job / part has really run before
            // come first, the rest behind "All operations". Only ops that
            // still exist in settings can be started.
            const usual = doneBeforeOps.filter(op => op && op.trim() && operations.includes(op));
            const rest = operations.filter(op => !usual.includes(op));
            if (usual.length === 0) {
              return (<>
                <p className="text-xs text-zinc-500 uppercase font-bold">Select operation</p>
                <div className="grid grid-cols-2 gap-2">
                  {operations.map(op => startBtn(op, false))}
                  {operations.length === 0 && <p className="col-span-2 text-xs text-zinc-500 text-center py-2">No operations configured.</p>}
                </div>
              </>);
            }
            return (<>
              <p className="text-xs text-amber-400/90 uppercase font-bold flex items-center gap-1.5">↺ Run on this part before</p>
              <div className="grid grid-cols-2 gap-2">{usual.map(op => startBtn(op, true))}</div>
              {rest.length > 0 && (
                <button onClick={e => { e.stopPropagation(); setShowAllOps(s => !s); }}
                  className="w-full min-h-[44px] text-xs font-bold text-zinc-400 hover:text-white flex items-center justify-center gap-1 transition-colors">
                  {showAllOps ? <>Hide other operations <ChevronUp className="w-3 h-3" /></> : <>All operations ({rest.length}) <ChevronDown className="w-3 h-3" /></>}
                </button>
              )}
              {showAllOps && rest.length > 0 && (
                <div className="grid grid-cols-2 gap-2 animate-fade-in">{rest.map(op => startBtn(op, false))}</div>
              )}
            </>);
          })()}

          {/* Drawings & files — one row of chips; tap one to open it */}
          {(job.attachments?.length || 0) > 0 && (
            <div className="flex flex-wrap gap-1.5">
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
                    className="flex items-center gap-1.5 max-w-full bg-zinc-900 hover:bg-indigo-500/10 border border-white/10 hover:border-indigo-500/30 rounded-lg px-2.5 py-2 min-h-[40px] transition-all"
                  >
                    <span className="shrink-0">{icon}</span>
                    <span className="text-xs text-white truncate">{att.name}</span>
                  </a>
                );
              })}
            </div>
          )}

          {/* Notes toggle */}
          <button onClick={(e) => { e.stopPropagation(); setShowNotes(!showNotes); }} className="w-full flex items-center justify-between bg-zinc-900 hover:bg-zinc-800 border border-white/5 rounded-lg px-3 py-2 min-h-[44px] transition-colors">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              📝 Notes {(job.jobNotes?.length || 0) > 0 && <span className="bg-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded-full text-[10px]">{job.jobNotes!.length}</span>}
            </span>
            {showNotes ? <ChevronUp className="w-3 h-3 text-zinc-500" /> : <ChevronDown className="w-3 h-3 text-zinc-500" />}
          </button>

          {showNotes && (
            <div className="space-y-2 animate-fade-in">
              {/* Existing notes, newest first (sorted copy — never the live array) */}
              {[...(job.jobNotes || [])].sort((a, b) => b.timestamp - a.timestamp).map(n => (
                <div key={n.id} className="bg-zinc-900 border border-white/5 rounded-lg px-3 py-2">
                  <p className="text-sm text-zinc-200 leading-relaxed">{n.text}</p>
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
                        submitNote();
                      }
                    }}
                    onClick={e => e.stopPropagation()}
                    placeholder="Add a note..."
                    className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      submitNote();
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
const ScanJobTab = ({ jobs, onJobFound, onNotFound, addToast }: { jobs: Job[]; onJobFound: (id: string) => void; onNotFound: (text: string) => void; addToast: any }) => {
  const [mode, setMode] = useState<'input' | 'camera'>('input');
  // iPad/Safari has no BarcodeDetector — don't ask for the camera only to fail.
  const canCamera = typeof (window as any).BarcodeDetector !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
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
    if (!val) return;
    const v = val.toLowerCase();
    const found = jobs.find(j =>
      j.id === val || j.id.toLowerCase() === v ||
      (j.jobIdsDisplay || '').toLowerCase() === v || (j.poNumber || '').toLowerCase() === v
    );
    stopCamera();
    if (found) {
      onJobFound(found.id);
      addToast('success', `Opened: ${found.poNumber}`);
    } else {
      onNotFound(val);   // falls back to searching the job list
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
          <button onClick={() => { stopCamera(); setMode('input'); }} className={`flex-1 py-3 min-h-[44px] text-sm font-bold transition-all ${mode === 'input' ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-white'}`}>
            ⌨️ Type / Hardware
          </button>
          <button disabled={!canCamera} title={canCamera ? undefined : "This browser can't scan with the camera"} onClick={() => { setMode('camera'); if (!scanning) startCamera(); }} className={`flex-1 py-3 min-h-[44px] text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${mode === 'camera' ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-white'}`}>
            📷 Camera Scan
          </button>
        </div>

        <div className="p-6 pt-4">
          {mode === 'input' ? (
            <>
              <input autoFocus onKeyDown={handleKey} className="bg-black/50 border border-amber-500 rounded-xl px-4 py-3 text-white text-center w-full text-base focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Scan or type PO / Job ID…" />
              <p className="text-zinc-500 text-xs mt-3">Press Enter after typing or scanning with a USB barcode reader</p>
              {!canCamera && <p className="text-zinc-600 text-xs mt-2">Camera scanning isn't available in this browser — use a scanner or type the PO#.</p>}
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

/** Plain words for a timer the worker didn't stop themselves (null = they did). */
function systemStopReason(reason?: string): string | null {
  if (!reason || reason === 'manual' || reason.startsWith('manual:') || reason.startsWith('sw:') || reason === 'auto:switched-job') return null;
  if (reason === 'sweep:auto-clockout') return 'automatic clock-out at the end of the shift';
  if (reason === 'alarm:shift-end') return 'the end-of-shift alarm';
  if (reason === 'sweep:14h-safety') return 'it had been running over 14 hours';
  if (reason.startsWith('admin:')) return 'stopped by the office';
  return 'stopped automatically';
}

const EmployeeDashboard = ({ user, addToast, onLogout, notifBell }: { user: User, addToast: any, onLogout: () => void, notifBell?: React.ReactNode }) => {
  const { confirm: askConfirm, ConfirmHost } = useConfirm();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<'jobs' | 'history' | 'scan' | 'progress'>('jobs');
  const [activeLog, setActiveLog] = useState<TimeLog | null>(null);
  const lastActiveIdRef = useRef<string | null>(null);
  const [startingKey, setStartingKey] = useState<string | null>(null);
  // Online / synced — shown in the header so a worker on bad Wi-Fi knows their
  // taps are kept on the tablet (they sync by themselves).
  const [sync, setSync] = useState<{ online: boolean; synced: boolean }>({ online: true, synced: true });
  useEffect(() => DB.subscribeSyncStatus(setSync), []);
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const [showSyncWarning, setShowSyncWarning] = useState(false);
  useEffect(() => {
    if (sync.online && sync.synced) { setShowSyncWarning(false); return; }
    // Startup is briefly "not synced" — only warn when it lasts.
    const t = setTimeout(() => setShowSyncWarning(true), sync.online ? 8000 : 1500);
    return () => clearTimeout(t);
  }, [sync.online, sync.synced]);
  const willSync = () => (syncRef.current.online && syncRef.current.synced ? '' : ' · saved on this tablet, will sync');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState('');
  const [myHistory, setMyHistory] = useState<TimeLog[]>([]);
  const [shopActiveLogs, setShopActiveLogs] = useState<TimeLog[]>([]);
  const [ops, setOps] = useState<string[]>([]);
  const [scannedJobId, setScannedJobId] = useState<string | null>(null);
  const [resumeStarting, setResumeStarting] = useState(false);   // optimistic guard for one-tap "Jump back in"
  // Job memory: jobId → ops used before (recent first), partNumber → same.
  const [opsMemory, setOpsMemory] = useState<{ byJob: Map<string, string[]>; byPart: Map<string, string[]> }>({ byJob: new Map(), byPart: new Map() });
  // Risk system inputs — unfiltered jobs (history lives in completed ones),
  // all logs (everyone's — familiarity is per worker), and rework entries.
  const [riskJobs, setRiskJobs] = useState<Job[]>([]);
  // The running job comes from the live jobs list — it used to be fetched from
  // the server on every log change (with the inline photo), flashing "PO
  // Unknown / job not found" right when the worker checks it started.
  const activeJob = useMemo(
    () => (activeLog ? riskJobs.find(j => j.id === activeLog.jobId) || null : null),
    [activeLog?.jobId, riskJobs],
  );
  const [riskLogsAll, setRiskLogsAll] = useState<TimeLog[]>([]);
  const [riskRework, setRiskRework] = useState<ReworkEntry[]>([]);
  // Deep log history (one-shot) — the live stream caps at 500 logs, which
  // would make familiarity "forget" parts a worker ran months ago.
  const [riskHistLogs, setRiskHistLogs] = useState<TimeLog[]>([]);
  useEffect(() => { DB.fetchLogHistory().then(setRiskHistLogs).catch(() => {}); }, []);
  const activePanelRef = useRef<HTMLDivElement>(null);
  const [shouldScrollToTimer, setShouldScrollToTimer] = useState(false);

  // Clear the optimistic resume guard once the timer actually registers (or as a
  // safety net if the start fails and no activeLog ever arrives).
  useEffect(() => {
    if (!resumeStarting) return;
    if (activeLog) { setResumeStarting(false); return; }
    const t = setTimeout(() => setResumeStarting(false), 6000);
    return () => clearTimeout(t);
  }, [resumeStarting, activeLog]);

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
      // A timer the system ended (auto clock-out, 14-hour safety stop, the
      // office) used to just vanish from this screen — say what happened.
      const prevActiveId = lastActiveIdRef.current;
      lastActiveIdRef.current = myActive?.id ?? null;
      if (prevActiveId && myActive?.id !== prevActiveId) {
        const ended = allLogs.find(l => l.id === prevActiveId);
        const why = ended?.endTime ? systemStopReason(ended.stopReason) : null;
        if (ended && why) {
          const at = new Date(ended.endTime!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          addToast('info', `Your ${ended.operation} timer${ended.jobIdsDisplay ? ` on ${ended.jobIdsDisplay}` : ''} was stopped at ${at} — ${why}. Tell your supervisor if that's wrong.`);
        }
      }
      // Job memory: which operations has this job / this part ACTUALLY used
      // before (any worker)? Lets the picker surface "the usual ops" first
      // instead of making workers scan the whole operation list every time.
      const byJob = new Map<string, string[]>();
      const byPart = new Map<string, string[]>();
      const push = (map: Map<string, string[]>, key: string, op: string) => {
        const arr = map.get(key) || [];
        const i = arr.indexOf(op);
        if (i >= 0) arr.splice(i, 1);
        arr.unshift(op);              // most recent first
        map.set(key, arr);
      };
      // Iterate oldest → newest (snapshot order isn't guaranteed) so the final
      // order after unshift is most-recent-first.
      const chrono = allLogs.filter(l => l.operation && !l.isSample).sort((a, b) => a.startTime - b.startTime);
      for (const l of chrono) {
        if (l.jobId) push(byJob, l.jobId, l.operation);
        const pn = (l.partNumber || '').trim().toLowerCase();
        if (pn) push(byPart, pn, l.operation);
      }
      setOpsMemory({ byJob, byPart });
      setRiskLogsAll(allLogs);
    });
    const unsubJobs = DB.subscribeJobs((allJobs) => {
      setJobs(allJobs.filter(j => j.status !== 'completed').reverse());
      setRiskJobs(allJobs);
    });
    const unsubActiveLogs = DB.subscribeActiveLogs(setShopActiveLogs);
    const unsubRework = DB.subscribeRework(setRiskRework);
    return () => { unsubSettings(); unsubLogs(); unsubJobs(); unsubActiveLogs(); unsubRework(); };
  }, [user.id]);

  // Part history index for Green/Yellow/Red + "you've run this before".
  // Live logs win over the one-shot history on id collisions (fresher fields).
  const knownLogs = useMemo(() => {
    const byId = new Map<string, TimeLog>();
    for (const l of riskHistLogs) byId.set(l.id, l);
    for (const l of riskLogsAll) byId.set(l.id, l);
    return [...byId.values()];
  }, [riskLogsAll, riskHistLogs]);
  const riskIndex = useMemo(() => buildPartRiskIndex(riskJobs, knownLogs, riskRework), [riskJobs, knownLogs, riskRework]);
  // Each job's logs — time per step on the job cards, and the job's total
  // for the running timer's estimate check.
  const logsByJob = useMemo(() => {
    const m = new Map<string, TimeLog[]>();
    for (const l of knownLogs) {
      const list = m.get(l.jobId);
      if (list) list.push(l); else m.set(l.jobId, [l]);
    }
    return m;
  }, [knownLogs]);

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
        // Read from ref so we always have the current log without re-mounting.
        const currentLog = activeLogRef.current;
        // Lunch-end resume — the counterpart to pauseTimers, so afternoon hours
        // don't silently freeze. Never resume a worker's OWN manual pause.
        // Runs on catch-up too (resuming takes nothing away): a phone locked
        // at lunch end used to leave the whole afternoon paused. The pause
        // counts as the lunch length at most, and the server's copy decides.
        if (alarm.resumeTimers && currentLog && currentLog.pausedAt && currentLog.pauseReason !== 'manual') {
          const lunch = lunchWindow(shopSettingsAlarmRef.current);
          try { await DB.resumeTimeLog(currentLog.id, { system: true, at: lunch ? currentLog.pausedAt + lunch.ms : undefined }); } catch {}
        }
        // Destructive side-effects ONLY in real-time fires (isCatchup = false).
        // This prevents workers being clocked out when:
        //   • The tab is refreshed mid-shift
        //   • Settings are saved (new Firestore snapshot)
        //   • The phone/iPad wakes up from sleep
        if (isCatchup) return;
        if (alarm.pauseTimers && currentLog && !currentLog.pausedAt) {
          // Lunch alarms must write the SAME pauseReason as useAutoLunch so
          // resumeAllPaused('auto-lunch') can resume them — otherwise a lunch
          // paused via alarm freezes the worker's afternoon hours.
          const isLunch = alarm.id === 'legacy-lunch-start' || /lunch/i.test(alarm.label || '');
          try { await DB.pauseTimeLog(currentLog.id, isLunch ? 'auto-lunch' : `Auto-pause: ${alarm.label}`, { system: true }); } catch {}
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
          swPost({ type: 'TIMER_PAUSE', logId });
          addToast('info', '⏸️ Timer paused');
        } else if (action === 'resume') {
          await DB.resumeTimeLog(logId);
          swPost({ type: 'TIMER_RESUME', logId });
          addToast('success', '▶️ Timer resumed');
        }
      } catch { addToast('error', 'Action failed — please try again'); }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [addToast]);

  // Operations this job / this part has REALLY been run through before (any
  // worker) — the card's "Run on this part before" quick starts. (Planned
  // checklist steps used to be mixed in, so a brand-new job looked worked on.)
  const doneBeforeOpsFor = (job: Job) => [...new Set([
    ...(opsMemory.byJob.get(job.id) || []),
    ...(opsMemory.byPart.get((job.partNumber || '').trim().toLowerCase()) || []),
  ])];
  // What the job needs — those plus its planned steps — for "you know the ops".
  const jobOpsFor = (job: Job) => [...new Set([...doneBeforeOpsFor(job), ...((job.checklist || []).map(c => c.label))])];

  const handleStartJob = async (jobId: string, operation: string) => {
    if (_startInFlight.has(user.id)) return;   // drop double-tap
    const job = jobs.find(j => j.id === jobId);
    // Held jobs: the office stopped them on purpose — ask first.
    if (job?.status === 'hold' && !(await askConfirm({
      title: `${job.poNumber} is on hold`,
      message: 'The office paused this job. Start it anyway?',
      tone: 'warning', confirmLabel: 'Start anyway',
    }))) return;
    // RED job + this worker has never run the part: one check. Experienced
    // hands are never asked.
    if (job) {
      const risk = computeJobRisk(job, riskIndex);
      if (risk.tier === 'red' && workerFamiliarity(job.partNumber, riskIndex, user.id, jobOpsFor(job)).level === 'new' && !(await askConfirm({
        title: 'RED job — your first time on this part',
        message: `${risk.guidance} Has the owner or a senior OK'd you running it?`,
        tone: 'warning', confirmLabel: "Yes, I'm cleared",
      }))) return;
    }
    if (_startInFlight.has(user.id)) return;
    _startInFlight.add(user.id);
    setStartingKey(`${jobId}|${operation}`);
    try {
      const logId = await DB.startTimeLog(jobId, user.id, user.name, operation, job?.partNumber, job?.customer, undefined, undefined, job?.jobIdsDisplay, job?.partImage);
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
      addToast('success', `Timer started · ${operation}${job ? ` on PO ${job.poNumber}` : ''}${willSync()}`);
      setShouldScrollToTimer(true);
    } catch (e: any) {
      addToast('error', e?.message || 'Failed to start timer');
    } finally {
      setStartingKey(null);
      // Hold the guard briefly so a second tap can't slip through before the
      // Firestore snapshot with the new log arrives (subscription latency).
      setTimeout(() => _startInFlight.delete(user.id), 2000);
    }
  };

  // Worker flow: no qty prompt. Rate learning gets its data from
  // admin-entered Sample Times (Settings → Rate Samples), not from
  // every individual clock-out.
  const handleStopJob = async (logId: string) => {
    const stoppedJobId = activeLog?.jobId ?? null;
    const stoppedLog = activeLogRef.current;
    const workedMins = stoppedLog ? DB.getWorkingElapsedMs(stoppedLog) / 60000 : 0;
    try {
      await DB.stopTimeLog(logId, undefined, undefined, undefined, 'manual');
      swPost({ type: 'TIMER_STOP' });
      cancelTimerNotification(logId);
      addToast('success', `Stopped · ${formatDuration(workedMins)}${activeJob ? ` on PO ${activeJob.poNumber}` : ''}${stoppedLog ? ` · ${stoppedLog.operation}` : ''}${willSync()}`);
      // Stopping isn't always finishing (lunch, end of day), so ask: one tap
      // ticks the step off and the next step shows for everyone.
      const stoppedJob = stoppedJobId ? jobs.find(j => j.id === stoppedJobId) : undefined;
      const step = stoppedJob && stoppedLog
        ? (stoppedJob.checklist || []).find(i => normOp(i.label) === normOp(stoppedLog.operation) && !stepDone(stoppedJob, i))
        : undefined;
      if (stoppedJob && step) {
        askConfirm({
          title: `Is ${step.label} finished on PO ${stoppedJob.poNumber}?`,
          message: 'Tick it off so the next step shows up for everyone.',
          tone: 'info', confirmLabel: "Yes, it's done", cancelLabel: 'Not yet',
        }).then(yes => {
          if (!yes) return;
          DB.setChecklistTick(stoppedJob.id, step.id, { done: true, by: user.id, name: user.name, at: Date.now() })
            .then(() => addToast('success', `✓ ${step.label} done`))
            .catch(() => addToast('error', "Couldn't save that tick — check the Wi-Fi and try again"));
        });
      }
      if (stoppedJobId) {
        setScannedJobId(stoppedJobId);
        setTab('jobs');
        setTimeout(() => {
          // Skip scroll if the worker already started a different job in the 300ms window
          if (activeLogRef.current && activeLogRef.current.jobId !== stoppedJobId) return;
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
    if (!(await askConfirm({
      title: 'Stop this timer?',
      message: 'It ends now and the time so far is kept.',
      tone: 'warning', confirmLabel: 'Stop timer',
    }))) return;
    try {
      await DB.stopTimeLog(logId, undefined, undefined, undefined, 'manual:force-clear');
      addToast('success', `Timer stopped${willSync()}`);
    } catch { addToast('error', 'Failed to stop. Please try again.'); }
  };

  // Search only the fields a worker would actually type — the old version
  // JSON.stringify'd EVERY job (including base64 part images!) on EVERY
  // keystroke, which froze the search box on shops with photo-heavy jobs.
  // Most urgent first: overdue (most late at the top), then soonest due,
  // undated last. This list was in raw database order, so the job that was
  // due today could sit below twenty that weren't.
  const filteredJobs = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    const list = !q ? jobs : jobs.filter(j =>
      [j.poNumber, j.partNumber, j.customer, j.jobIdsDisplay, j.info, j.specialInstructions]
        .filter(Boolean).join(' ').toLowerCase().includes(q)
    );
    return [...list].sort((a, b) => {
      const urgent = (j: Job) => (j.priority === 'urgent' ? 0 : 1);
      return compareByDue(a, b) || urgent(a) - urgent(b);
    });
  }, [jobs, search]);

  // One-tap "jump back in": the worker's most recent job+operation combos that
  // are still open — clock straight back in after a break/lunch without
  // searching, expanding a card, and picking the operation every time.
  const quickResume = (() => {
    const seen = new Set<string>();
    const out: { job: Job; operation: string }[] = [];
    for (const l of [...myHistory].sort((a, b) => b.startTime - a.startTime)) {
      if (!l.jobId || !l.operation) continue;
      const key = `${l.jobId}|${l.operation}`;
      if (seen.has(key)) continue;
      const job = jobs.find(j => j.id === l.jobId);
      if (!job || job.status === 'completed' || job.status === 'hold') continue; // don't resume done/held jobs
      if (ops.length > 0 && !ops.includes(l.operation)) continue;                 // only offer still-configured operations
      seen.add(key);
      out.push({ job, operation: l.operation });
      if (out.length >= 3) break;
    }
    return out;
  })();

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
      {/* Worker hero — greeting + today stats. Kept to one compact row on phones
          (it used to fill half the screen and push the job list below the fold). */}
      <div className="card-shine bg-gradient-to-br from-zinc-900/60 to-zinc-900/30 border border-white/5 rounded-3xl p-3 sm:p-6 overflow-hidden relative">
        <div aria-hidden="true" className="absolute top-0 right-0 w-40 h-40 bg-amber-500/10 blur-3xl rounded-full" />
        <div className="relative flex items-center gap-3 sm:gap-4">
          <Avatar name={user.name} size={isMobile ? 'lg' : 'xl'} ring dot={activeLog ? 'live' : undefined} />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest hidden sm:block">{greeting}</p>
            <h2 className="text-lg sm:text-2xl font-black text-white tracking-tight truncate sm:mt-0.5">{user.name}</h2>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 sm:mt-1.5">
              {user.employeeId && <span className="hidden sm:inline text-[10px] font-mono font-bold text-zinc-400 bg-zinc-800/60 border border-white/5 px-1.5 py-0.5 rounded">{user.employeeId}</span>}
              <span className="text-[11px] sm:text-[10px] font-bold text-zinc-500 flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${activeLog ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`} />
                {activeLog ? 'Clocked in' : 'Not clocked in'}
              </span>
              {/* Phones: today's numbers inline instead of a second stats row */}
              <span className="sm:hidden text-[11px] text-zinc-500">· today <span className="font-black text-white tabular">{todayHours}</span> · <span className="font-black text-amber-400 tabular">{todayJobs}</span> job{todayJobs !== 1 ? 's' : ''}</span>
              {showSyncWarning && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${!sync.online ? 'text-red-300 bg-red-500/10 border-red-500/30' : 'text-amber-300 bg-amber-500/10 border-amber-500/30'}`}>
                  {!sync.online ? 'Offline — taps are saved here and sync later' : 'Reconnecting…'}
                </span>
              )}
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
        priorMinutes={(logsByJob.get(activeLog.jobId) || []).filter(l => l.endTime && l.id !== activeLog.id).reduce((a, l) => a + logMinutes(l), 0)}
        onPause={async (id) => { try { await DB.pauseTimeLog(id, 'manual'); swPost({ type: 'TIMER_PAUSE', logId: id }); addToast('info', 'Timer Paused'); } catch { addToast('error', 'Failed to pause'); } }}
        onResume={async (id) => { try { await DB.resumeTimeLog(id); swPost({ type: 'TIMER_RESUME', logId: id }); addToast('success', 'Timer Resumed'); } catch { addToast('error', 'Failed to resume'); } }}
      /></div>}

      <div className="flex flex-wrap gap-2 justify-between items-center bg-zinc-900/50 backdrop-blur-md p-2 rounded-2xl border border-white/5 no-print">
        <div className="flex gap-2">
          <button onClick={() => setTab('jobs')} className={`px-4 py-3 min-h-[44px] rounded-xl text-sm font-medium transition-all ${tab === 'jobs' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-white'}`}>Jobs</button>
          <button onClick={() => setTab('history')} className={`px-4 py-3 min-h-[44px] rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${tab === 'history' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-white'}`}><History className="w-4 h-4" /> History</button>
          <button onClick={() => setTab('progress')} className={`px-4 py-3 min-h-[44px] rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${tab === 'progress' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-white'}`}><Zap className="w-4 h-4" /> Stats</button>
        </div>
        <div className="flex items-center gap-2">
          {notifBell}
          <button onClick={() => setTab('scan')} className={`px-3 py-3 min-h-[44px] rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${tab === 'scan' ? 'bg-amber-600 text-white shadow' : 'bg-zinc-800 text-amber-400 hover:bg-amber-600 hover:text-white'}`}><ScanLine className="w-4 h-4" /> Scan</button>
          <button onClick={() => { if (activeLog) addToast('info', `Signed out — your ${activeLog.operation} timer keeps running`); onLogout(); }} className="bg-red-500/10 text-red-500 hover:bg-red-600 hover:text-white px-3 py-3 min-h-[44px] rounded-xl text-sm font-bold flex items-center gap-2 transition-all"><LogOut className="w-4 h-4" /> Exit</button>
        </div>
      </div>

      {tab === 'scan' ? (
        <ScanJobTab jobs={jobs}
          onJobFound={(id) => { setSearch(''); setScannedJobId(id); setTab('jobs'); }}
          onNotFound={(text) => { setSearch(text); setTab('jobs'); addToast('info', `No job matches "${text}" exactly — showing search results`); }}
          addToast={addToast} />

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
                {group.logs.map(log => {
                  const logPhoto = log.partImage || jobs.find(j => j.id === log.jobId)?.partImage;
                  return (
                  <React.Fragment key={log.id}>
                    <div className="px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors">
                      {logPhoto && <img src={logPhoto} alt="" className="w-10 h-10 rounded-lg object-cover border border-white/10 shrink-0" loading="lazy" />}
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
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : tab === 'progress' ? (
        <React.Suspense fallback={<div className="py-12 text-center text-zinc-500 text-sm">Loading…</div>}>
          <ProgressView userId={user?.id || ''} userName={user?.name || ''} recentLogs={myHistory} />
        </React.Suspense>
      ) : (
        <div className="flex-1 flex flex-col animate-fade-in">
          {/* One-tap jump back in — recent open job+operation combos */}
          {quickResume.length > 0 && !activeLog && !resumeStarting && (
            <div className="mb-4">
              <p className="text-[11px] font-black text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-amber-400" /> Jump back in</p>
              {/* Slim rows — three tall cards here pushed the job list off a phone screen */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {quickResume.map(({ job, operation }) => (
                  <button key={`${job.id}|${operation}`} disabled={resumeStarting}
                    onClick={() => { if (resumeStarting || activeLog) return; setResumeStarting(true); handleStartJob(job.id, operation); }}
                    className="flex items-center gap-2.5 text-left bg-gradient-to-br from-amber-500/15 to-amber-500/[0.04] hover:from-amber-500/25 border border-amber-500/30 rounded-xl px-3 py-2 min-h-[48px] transition-all active:scale-95 disabled:opacity-50">
                    {/* Part photo when there is one — instant recognition; no empty placeholder */}
                    {job.partImage && (
                      <img src={job.partImage} alt="" className="w-9 h-9 rounded-lg object-cover border border-white/10 shrink-0" loading="lazy" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-black text-white truncate">{job.poNumber}</p>
                      <p className="text-[11px] truncate"><span className="text-amber-300/90 font-bold">▶ {operation}</span>{job.partNumber && <span className="text-zinc-500"> · {job.partNumber}</span>}</p>
                    </div>
                    <Play className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="relative mb-4">
            <Search className="absolute left-4 top-3.5 w-5 h-5 text-zinc-500" />
            <input type="text" placeholder="Search by Job #, PO, or Part..." value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-zinc-900 border border-white/10 rounded-2xl pl-12 pr-4 py-3 text-white focus:ring-2 focus:ring-amber-500 focus:outline-none shadow-sm" />
          </div>
          {activeLog && (() => {
            // Working time (lunch + pauses excluded). Long deburring runs are
            // normal — this used to turn red after one hour, every day.
            const staleMinutes = Math.floor(DB.getWorkingElapsedMs(activeLog) / 60000);
            const isStale = staleMinutes > 600;
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
                    className="shrink-0 min-h-[40px] text-xs font-bold text-red-400 hover:text-white bg-red-500/15 hover:bg-red-500 px-3 py-2 rounded-lg border border-red-500/20 transition-all"
                  >
                    Clear Stuck Timer
                  </button>
                )}
              </div>
            );
          })()}
          {/* items-start: an opened card mustn't stretch its row-mates into tall empty boxes */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
            {filteredJobs.map(job => (
              <JobSelectionCard key={job.id} job={job} onStart={(id, op) => { handleStartJob(id, op); setScannedJobId(null); }} disabled={!!activeLog} startingKey={startingKey} operations={ops} defaultExpanded={job.id === scannedJobId} user={user} addToast={addToast} activeLogs={shopActiveLogs}
                jobLogs={logsByJob.get(job.id)}
                doneBeforeOps={doneBeforeOpsFor(job)}
                risk={computeJobRisk(job, riskIndex)}
                familiarity={workerFamiliarity(job.partNumber, riskIndex, user.id, jobOpsFor(job))}
                vets={partVeterans(job.partNumber, riskIndex, user.id)} />
            ))}
            {filteredJobs.length === 0 && <div className="col-span-full py-12 text-center text-zinc-500">No active jobs found matching "{search}".</div>}
          </div>
        </div>
      )}
      {ConfirmHost}
    </div>
  );
};

// --- CONFIRM MODAL ---
// Portaled to body so it escapes any parent transform/opacity stacking context.
// Esc-to-cancel for keyboard users. Responsive: full-bleed on mobile, centered
// card on tablet+. Natural height — buttons never clip on short viewports.
const ConfirmationModal = ({ isOpen, title, message, onConfirm, onCancel }: any) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (isOpen) { setBusy(false); setError(''); } }, [isOpen]);
  // Escape cancels — only while this is the topmost dialog (shared overlay
  // stack: one Esc used to close this AND the editor under it). Enter is left
  // to whichever button has focus (Confirm, to start with): a window-wide
  // Enter ran the action twice, and ran it even when Cancel had focus.
  useOverlayLayer(!!isOpen, () => onCancel());

  // Runs once, waits for the result, and stays open on failure — it used to
  // close straight away, so a failed delete looked like it had worked. A slow
  // action (no internet) closes after a few seconds and finishes on its own.
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await Promise.race([
        Promise.resolve(onConfirm?.()),
        new Promise(res => setTimeout(res, 8000)),
      ]);
      onCancel();
    } catch {
      setError("That didn't go through — check the internet and try again.");
      setBusy(false);
    }
  };

  if (!isOpen) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[1200] overflow-y-auto bg-zinc-950 animate-fade-in"
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
          {error && <p role="alert" className="text-sm font-semibold text-red-400 -mt-3 mb-4">{error}</p>}
          <div className="flex justify-end gap-2 sm:gap-3">
            <button type="button" onClick={onCancel} className="text-zinc-400 hover:text-white text-sm font-semibold px-3 sm:px-4 py-2">
              Cancel
            </button>
            <button
              type="button"
              onClick={run}
              disabled={busy}
              aria-busy={busy}
              className="bg-red-600 hover:bg-red-500 disabled:opacity-60 disabled:cursor-wait text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-red-900/20"
              autoFocus
            >
              {busy ? 'Working…' : error ? 'Try again' : 'Confirm'}
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
  // Read ?u=<username> from a badge QR to pre-fill — then drop it from the
  // address, or the NEXT person on this tablet got the previous badge's name
  // (and their PIN tries counted toward the lockout).
  const [initialUsername] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const u = params.get('u') || '';
      if (u) {
        params.delete('u');
        const qs = params.toString();
        history.replaceState(history.state, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
      }
      return u;
    } catch { return ''; }
  });
  const [username, setUsername] = useState(initialUsername);
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginSettings, setLoginSettings] = useState<SystemSettings>(DB.getSettings());

  // Brute-force guard — 5 consecutive failures locks the form for 30s (persists across reloads)
  const MAX_LOGIN_ATTEMPTS = 5;
  const LOCKOUT_MS = 30_000;
  const failedAttemptsRef = useRef<number>((() => {
    try { return Number(localStorage.getItem('login_fails')) || 0; } catch { return 0; }
  })());
  const [lockedUntil, setLockedUntil] = useState<number>(() => {
    try { return Number(localStorage.getItem('login_lock_until')) || 0; } catch { return 0; }
  });
  const [nowTick, setNowTick] = useState(Date.now());
  const locked = lockedUntil > nowTick;

  useEffect(() => {
    if (!locked) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [locked]);

  useEffect(() => {
    const unsub = DB.subscribeSettings(setLoginSettings);
    return unsub;
  }, []);

  const companyName = loginSettings.companyName || 'My Shop';
  const companyLogo = loginSettings.companyLogo;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockedUntil > Date.now()) return;
    setLoading(true);
    try {
      const user = await DB.loginUser(username, pin);
      if (user) {
        failedAttemptsRef.current = 0;
        try { localStorage.removeItem('login_fails'); localStorage.removeItem('login_lock_until'); } catch {}
        onLogin(user);
        addToast('success', `Welcome, ${user.name}`);
      } else {
        failedAttemptsRef.current += 1;
        try { localStorage.setItem('login_fails', String(failedAttemptsRef.current)); } catch {}
        if (failedAttemptsRef.current >= MAX_LOGIN_ATTEMPTS) {
          const until = Date.now() + LOCKOUT_MS;
          failedAttemptsRef.current = 0;
          setLockedUntil(until);
          setNowTick(Date.now());
          try { localStorage.setItem('login_lock_until', String(until)); localStorage.removeItem('login_fails'); } catch {}
          addToast('error', 'Too many failed attempts — locked for 30 seconds');
        } else {
          addToast('error', 'Wrong username or PIN. Ask your supervisor if you forgot it.');
        }
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
              aria-label="Username"
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus={!initialUsername}
            />
            <input
              type="password"
              value={pin}
              onChange={e => setPin(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:ring-2 focus:ring-amber-500 focus:border-amber-500/50 outline-none transition-all"
              placeholder="PIN"
              aria-label="PIN"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              autoFocus={!!initialUsername}
            />
            <button
              disabled={loading || locked}
              type="submit"
              className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white py-3.5 rounded-xl font-semibold tracking-wide transition-all shadow-lg shadow-amber-900/30 mt-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {locked ? `Locked — try again in ${Math.max(1, Math.ceil((lockedUntil - nowTick) / 1000))}s` : loading ? 'Verifying…' : 'Sign In →'}
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
  customer_late: <Clock         className="w-4 h-4" />,
  part_overrun:  <TrendingDown  className="w-4 h-4" />,
};

const BRAIN_DEFAULT_SHOWN = 4;
const ShopBrainPanel = ({ insights, setView, onMakeTask }: { insights: ShopInsight[]; setView: (v: string) => void; onMakeTask?: (insight: ShopInsight) => void }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem('brain_dismissed') || '[]')); }
    catch { return new Set(); }
  });
  const visible = insights.filter(i => !dismissed.has(i.id));
  const critCount = visible.filter(i => i.severity === 'critical').length;
  const warnCount = visible.filter(i => i.severity === 'warning').length;
  const posCount  = visible.filter(i => i.severity === 'positive').length;
  // Criticals always shown; everything else caps to a handful so 18 insights
  // don't turn into 18 full cards on first paint — expand to see the rest.
  const shown = showAll ? visible : visible.filter((i, idx) => i.severity === 'critical' || idx < BRAIN_DEFAULT_SHOWN);
  const hiddenCount = visible.length - shown.length;

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
          {shown.map(insight => {
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
                    <div className="flex items-center gap-3 flex-wrap">
                      {insight.action && insight.actionView && (
                        <button
                          onClick={() => setView(insight.actionView!)}
                          className={`mt-2 text-[11px] font-bold flex items-center gap-1 ${cfg.labelCls} hover:opacity-80 transition-opacity`}
                        >
                          {insight.action} <ChevronRight className="w-3 h-3" />
                        </button>
                      )}
                      {onMakeTask && insight.severity !== 'positive' && (
                        <button
                          onClick={() => { onMakeTask(insight); dismiss(insight.id); }}
                          className="mt-2 text-[11px] font-bold flex items-center gap-1 text-violet-300 hover:text-violet-200 transition-colors"
                          title="Turn this insight into an assigned action"
                        >
                          <ClipboardCheck className="w-3 h-3" /> Make task
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {hiddenCount > 0 && (
            <button
              onClick={() => setShowAll(true)}
              className="col-span-1 sm:col-span-2 text-xs font-bold text-violet-300 hover:text-violet-200 border border-dashed border-violet-500/25 hover:border-violet-500/40 rounded-xl py-2.5 transition-colors"
            >
              Show {hiddenCount} more insight{hiddenCount > 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// --- ADMIN DASHBOARD ---
const AdminDashboard = ({ user, confirmAction, setView, addToast }: any) => {
  const [activeLogs, setActiveLogs] = useState<TimeLog[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [allLogs, setAllLogs] = useState<TimeLog[]>([]);
  const [shopSettings, setShopSettings] = useState<SystemSettings>(DB.getSettings());
  const [dashWorkers, setDashWorkers] = useState<User[]>([]);
  const [reworkEntries, setReworkEntries] = useState<ReworkEntry[]>([]);
  const [dashAllPOs, setDashAllPOs] = useState<PurchaseOrder[]>([]);
  const [dashQuotes, setDashQuotes] = useState<Quote[]>([]);
  const [dashSamples, setDashSamples] = useState<Sample[]>([]);
  const [dashCustomerPos, setDashCustomerPos] = useState<CustomerPoFile[]>([]);
  const [dashActions, setDashActions] = useState<ShopAction[]>([]);
  const [showCanWeTakeIt, setShowCanWeTakeIt] = useState(false);
  const [attentionDismissed, setAttentionDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem('attention_dismissed') === '1'; } catch { return false; }
  });
  // The analysis panels (money, trends, flow map…) sit behind "More insights"
  // so the page opens on today's work. Remembered per device.
  const [showMore, setShowMore] = useState<boolean>(() => {
    try { return localStorage.getItem('dash_more_insights') === '1'; } catch { return false; }
  });
  const toggleMore = () => setShowMore(v => {
    try { localStorage.setItem('dash_more_insights', v ? '0' : '1'); } catch {}
    return !v;
  });

  useEffect(() => {
    const unsub1 = DB.subscribeActiveLogs(setActiveLogs);
    const unsub2 = DB.subscribeJobs(setJobs);
    const unsub4 = DB.subscribeAllLogs(setAllLogs);   // month figures need more than the newest 500
    const unsub5 = DB.subscribeSettings(setShopSettings);
    const unsub6 = DB.subscribeUsers(setDashWorkers);
    const unsub7 = DB.subscribeRework(setReworkEntries);
    const unsub8 = DB.subscribePurchaseOrders(setDashAllPOs);
    const unsub9 = DB.subscribeQuotes(setDashQuotes);
    const unsub10 = DB.subscribeSamples(setDashSamples);
    const unsub11 = DB.subscribeCustomerPos(setDashCustomerPos);
    const unsub12 = DB.subscribeShopActions(setDashActions);
    return () => { unsub1(); unsub2(); unsub4(); unsub5(); unsub6(); unsub7(); unsub8(); unsub9(); unsub10(); unsub11(); unsub12(); };
  }, []);

  // ── Live tick — re-renders every 60s so time-derived memos (attack plan
  // remaining hours) stay fresh even when Firestore sends no updates.
  const [liveTick, setLiveTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setLiveTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const invoicePos = useMemo(() => readyToInvoiceList(dashCustomerPos, jobs, shopSettings), [dashCustomerPos, jobs, shopSettings]);
  const invoiceCount = invoicePos.length;
  const invoiceTotal = useMemo(() => invoicePos.reduce((s, x) => s + (x.derived.amount || 0), 0), [invoicePos]);

  const liveJobsCount = new Set(activeLogs.map(l => l.jobId)).size;
  const activeJobsCount = jobs.filter(j => j.status !== 'completed').length;
  const activeWorkersCount = new Set(activeLogs.map(l => l.userId)).size;
  const myActiveLog = activeLogs.find(l => l.userId === user.id);
  const myActiveJob = myActiveLog ? jobs.find(j => j.id === myActiveLog.jobId) : null;

  const today = todayFmt();
  const todayN = dateNum(today);
  const in3DaysN = dateNum(new Date(Date.now() + 3 * 86400000).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }));
  const overdueJobs = jobs.filter(j => dueState(j) === 'overdue');
  const dueSoonJobs = jobs.filter(j => { const s = dueState(j); return s === 'today' || s === 'soon'; });

  // ── Pipeline value — total quote $ across all open jobs
  const pipelineValue = jobs
    .filter(j => j.status !== 'completed' && (j.quoteAmount || 0) > 0)
    .reduce((a, j) => a + (j.quoteAmount || 0), 0);

  // ── On-time delivery rate (rolling 90 days). Shared rule: judged by the
  // ship date when recorded (else the Complete click); jobs with no readable
  // due date are left out instead of counted late.
  const ninetyDaysAgo = Date.now() - 90 * 86400000;
  const onTimePct = onTimeRate(jobs.filter(j => j.status === 'completed' && (j.shippedAt || j.completedAt || 0) > ninetyDaysAgo)).pct;

  const todayStartMs = new Date(); (todayStartMs as any).setHours(0,0,0,0); const todayMs = todayStartMs.getTime();

  // Workers who haven't logged any operations today
  const activeWorkers = (dashWorkers || []).filter((w: User) => w.isActive !== false && w.role !== 'admin');
  const workersWithLogsToday = new Set(allLogs.filter(l => l.startTime >= todayMs && !l.isSample).map(l => l.userId));
  const workersNoScansToday = activeWorkers.filter((w: User) => !workersWithLogsToday.has(w.id) && !activeLogs.some(l => l.userId === w.id));
  // Completed logs today (fixed: use allLogs not the trimmed top-5 `logs`; exclude sample/rate-learning logs)
  const completedTodayMins = allLogs.filter(l => l.endTime && l.startTime >= todayMs && !l.isSample).reduce((a, l) => a + (l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0)), 0);
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

  // Money uses the same rule as the Jobs page (utils/jobBudget): labor at each
  // person's rate + overhead + material + outside POs; closed jobs use their
  // locked snapshot.
  const logsByJob = useMemo(() => groupLogsByJob(allLogs), [allLogs]);
  const openBudgets = useMemo(
    () => jobBudgets(jobs.filter(j => !isJobClosed(j)), logsByJob, dashWorkers, shopSettings, dashAllPOs),
    [jobs, logsByJob, dashWorkers, shopSettings, dashAllPOs],
  );
  const moneyOf = (j: Job) => jobMoney(j, logsByJob.get(j.id) || [], dashWorkers, shopSettings, dashAllPOs);
  const hasOpenActions = dashActions.some(a => !a.done);

  // ── Today's Attack Plan — ranked "run these in this order" queue ──────────
  // Risk level first (critical → at-risk → watch), then earliest due date,
  // then priority. The answer to "what should the floor be doing right now?"
  const attackPlan = useMemo(() => {
    // isJobClosed: a job sitting in Shipped (status still 'in-progress' until
    // the close-out) is done — it was ranked #1 as "3d overdue".
    const open = jobs.filter(j => !isJobClosed(j) && j.status !== 'hold');
    const etaMap = new Map<string, ReturnType<typeof computeJobETA>>();
    for (const job of open) {
      const history = getPartHistory(job.partNumber || '', jobs, allLogs);
      etaMap.set(job.id, computeJobETA(job, allLogs, activeLogs, history, DB.getWorkingElapsedMs));
    }
    const riskScore: Record<string, number> = { critical: 0, 'at-risk': 1, watch: 2, 'on-track': 3, 'no-data': 4 };
    const prioScore: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    const ranked = open
      .map(j => ({ job: j, eta: etaMap.get(j.id)! }))
      .sort((a, b) => {
        const r = (riskScore[a.eta.riskLevel] ?? 4) - (riskScore[b.eta.riskLevel] ?? 4);
        if (r !== 0) return r;
        const ad = a.job.dueDate ? dateNum(a.job.dueDate) : 99991231;
        const bd = b.job.dueDate ? dateNum(b.job.dueDate) : 99991231;
        if (ad !== bd) return ad - bd;
        return (prioScore[a.job.priority || 'normal'] ?? 2) - (prioScore[b.job.priority || 'normal'] ?? 2);
      });
    const totalRemaining = [...etaMap.values()].reduce((a, e) => a + (e.remainingHours ?? 0), 0);
    return { ranked: ranked.slice(0, 6), totalCount: open.length, totalRemaining };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, allLogs, activeLogs, liveTick]);

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
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCanWeTakeIt(true)}
            title="Customer on the phone? Check if a new job fits the schedule."
            className="bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 hover:text-blue-200 px-4 py-2 rounded-xl font-bold flex items-center gap-2 text-sm transition-all"
          >
            <PhoneCall className="w-4 h-4" aria-hidden="true" /> Can We Take It?
          </button>
          <div className="text-right hidden sm:block">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Today</p>
            <p className="text-sm text-zinc-300 font-semibold">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
          </div>
        </div>
      </div>

      {showCanWeTakeIt && (
        <CanWeTakeIt
          jobs={jobs}
          allLogs={allLogs.filter(l => l.endTime)}
          activeLogs={activeLogs}
          workers={dashWorkers}
          settings={shopSettings}
          samples={dashSamples}
          onClose={() => setShowCanWeTakeIt(false)}
        />
      )}

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

      {/* ── Needs Attention — aggregated smart banner ──
          Scoped to signals that AREN'T already shown elsewhere on this page:
          overdue lives in the KPI strip + Today's Attack Plan, stale jobs and
          missing-quote-on-open-jobs live in Shop Brain, capacity/ETA lives in
          the Weekly Capacity Forecast panel below. Showing the same fact
          twice with two different numbers (different thresholds) read as a
          bug, not two insights — so each signal gets exactly one home. */}
      {!attentionDismissed && (() => {
        const openRework = reworkEntries.filter(r => r.status !== 'resolved').length;
        const missingQuotes = jobs.filter(j => j.status === 'completed' && !(j.quoteAmount && j.quoteAmount > 0)).length;
        const longRunning = activeLogs.filter(l => l.startTime < Date.now() - 4 * 3600000).length;

        // Over-budget open jobs — same rule as the Jobs list badge
        const overBudgetCount = [...openBudgets.values()].filter(b => b.overBudget).length;

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
        // Open jobs with no (or unreadable) due date can't be tracked at all —
        // quote→job conversions arrive this way on purpose, so say so.
        const noDueCount = jobs.filter(j => dueState(j) === 'none').length;
        if (noDueCount > 0) items.push({ label: `${noDueCount} open job${noDueCount > 1 ? 's' : ''} with no due date`, count: noDueCount, color: '#ef4444', icon: Calendar, onClick: () => setView('admin-jobs') });
        if (dueSoonJobs.length > 0) items.push({ label: `${dueSoonJobs.length} due in 3 days`, count: dueSoonJobs.length, color: '#f97316', icon: Clock, onClick: () => setView('admin-jobs') });
        if (openRework > 0) items.push({ label: `${openRework} open rework issue${openRework > 1 ? 's' : ''}`, count: openRework, color: '#f59e0b', icon: AlertTriangle, onClick: () => setView('admin-quality') });
        if (longRunning > 0) items.push({ label: `${longRunning} timer${longRunning > 1 ? 's' : ''} running > 4h`, count: longRunning, color: '#eab308', icon: Clock, onClick: () => setView('admin-live') });
        if (workersNoScansToday.length > 0 && new Date().getHours() >= 8) items.push({ label: `${workersNoScansToday.length} worker${workersNoScansToday.length > 1 ? 's' : ''} no scan today`, count: workersNoScansToday.length, color: '#facc15', icon: Users, onClick: () => setView('admin-live') });
        if (dupGroupCount > 0) items.push({ label: `${dupGroupCount} possible customer duplicate${dupGroupCount > 1 ? 's' : ''}`, count: dupGroupCount, color: '#a855f7', icon: Users, onClick: () => setView('admin-settings') });
        if (missingQuotes > 0 && missingQuotes >= 5) items.push({ label: `${missingQuotes} completed jobs missing quote`, count: missingQuotes, color: '#3b82f6', icon: FileText, onClick: () => setView('admin-jobs') });
        if (overBudgetCount > 0) items.push({ label: `${overBudgetCount} job${overBudgetCount > 1 ? 's' : ''} over budget`, count: overBudgetCount, color: '#ef4444', icon: AlertTriangle, onClick: () => setView('admin-jobs') });
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

      <div className="stagger grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {/* Working now — people on the clock + today's hours; tap for the live floor */}
        <button type="button" onClick={() => setView('admin-live')} title="Open the live floor"
          className={`card-shine hover-lift-glow text-left p-3 sm:p-5 rounded-2xl flex justify-between items-center gap-2 overflow-hidden border ${activeWorkersCount > 0 ? 'bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/10' : 'bg-zinc-900/50 border-white/5'}`}>
          <div className="min-w-0"><p className="text-zinc-500 text-[10px] sm:text-xs font-bold uppercase tracking-wider truncate">Working</p><h3 className="text-xl sm:text-2xl font-black text-white">{activeWorkersCount}</h3><p className="text-[10px] text-emerald-400 mt-0.5 truncate" title={`${liveJobsCount} job${liveJobsCount !== 1 ? 's' : ''} running · ${todayHrsDisplay} logged today`}>{todayHrsDisplay} today</p></div>
          <Activity className={`w-7 h-7 sm:w-8 sm:h-8 text-emerald-500 shrink-0 ${activeWorkersCount > 0 ? 'animate-pulse' : 'opacity-20'}`} />
        </button>
        {/* Open Jobs */}
        <button type="button" onClick={() => setView('admin-jobs')} title="Open the jobs list" className="card-shine hover-lift-glow text-left bg-zinc-900/50 border border-white/5 p-3 sm:p-5 rounded-2xl flex justify-between items-center gap-2 overflow-hidden hover:border-white/10">
          <div className="min-w-0"><p className="text-zinc-500 text-[10px] sm:text-xs font-bold uppercase tracking-wider truncate">Open Jobs</p><h3 className="text-xl sm:text-2xl font-black text-white">{activeJobsCount}</h3><p className="text-[10px] text-zinc-500 mt-0.5 truncate">Not finished yet</p></div>
          <Briefcase className="text-zinc-600 w-7 h-7 sm:w-8 sm:h-8 shrink-0" />
        </button>
        {/* Overdue — tap to open Jobs filtered to the overdue ones */}
        <button type="button" onClick={() => openJobsFiltered('overdue', setView)} title="Show the overdue jobs"
          className={`card-shine hover-lift-glow text-left p-3 sm:p-5 rounded-2xl flex justify-between items-center gap-2 overflow-hidden border ${overdueJobs.length > 0 ? 'bg-red-500/10 border-red-500/30 shadow-lg shadow-red-900/10 hover:bg-red-500/15' : 'bg-zinc-900/50 border-white/5'}`}>
          <div className="min-w-0"><p className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider truncate ${overdueJobs.length > 0 ? 'text-red-400' : 'text-zinc-500'}`}>Overdue</p><h3 className={`text-xl sm:text-2xl font-black ${overdueJobs.length > 0 ? 'text-red-400' : 'text-zinc-600'}`}>{overdueJobs.length}</h3><p className={`text-[10px] mt-0.5 truncate ${overdueJobs.length > 0 ? 'text-red-400/70' : 'text-zinc-600'}`}>{overdueJobs.length > 0 ? 'Tap to see them' : 'Past due'}</p></div>
          <AlertTriangle className={`w-7 h-7 sm:w-8 sm:h-8 shrink-0 ${overdueJobs.length > 0 ? 'text-red-500' : 'text-zinc-700'}`} />
        </button>
        {/* Pipeline value */}
        <div className={`card-shine hover-lift-glow p-3 sm:p-5 rounded-2xl flex justify-between items-center gap-2 overflow-hidden border ${pipelineValue > 0 ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-zinc-900/50 border-white/5'}`}>
          <div className="min-w-0">
            <p className="text-zinc-500 text-[10px] sm:text-xs font-bold uppercase tracking-wider truncate">Pipeline</p>
            <h3 className={`text-lg sm:text-xl font-black truncate ${pipelineValue > 0 ? 'text-emerald-400' : 'text-zinc-600'}`}>
              {pipelineValue > 0 ? `$${pipelineValue >= 1000 ? (pipelineValue / 1000).toFixed(1) + 'k' : pipelineValue.toFixed(0)}` : '—'}
            </h3>
            <p className="text-[10px] text-zinc-500 mt-0.5 truncate">Open orders</p>
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
        {/* Ready to Invoice — customer POs whose job is done but not billed */}
        <button onClick={() => setView('admin-customer-pos')} title="Customer POs ready to invoice" className={`text-left card-shine hover-lift-glow p-3 sm:p-5 rounded-2xl flex justify-between items-center gap-2 overflow-hidden border ${invoiceCount > 0 ? 'bg-orange-500/10 border-orange-500/30' : 'bg-zinc-900/50 border-white/5'}`}>
          <div className="min-w-0">
            <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider truncate ${invoiceCount > 0 ? 'text-orange-400' : 'text-zinc-500'}`}>To Invoice</p>
            <h3 className={`text-xl sm:text-2xl font-black ${invoiceCount > 0 ? 'text-orange-400' : 'text-zinc-600'}`}>{invoiceCount}</h3>
            <p className={`text-[10px] mt-0.5 truncate ${invoiceCount > 0 ? 'text-orange-400/70' : 'text-zinc-600'}`}>{invoiceTotal > 0 ? `$${invoiceTotal >= 1000 ? (invoiceTotal / 1000).toFixed(1) + 'k' : invoiceTotal.toFixed(0)} unbilled` : 'POs done'}</p>
          </div>
          <FileText className={`w-7 h-7 sm:w-8 sm:h-8 shrink-0 ${invoiceCount > 0 ? 'text-orange-500' : 'text-zinc-700'}`} />
        </button>
      </div>

      {/* 🛡 TIMEKEEPING HEALTH — payroll-data watchdog (only shows when something's wrong) */}
      <TimekeepingHealthPanel
        logs={allLogs}
        jobs={jobs}
        users={dashWorkers}
        settings={shopSettings}
        onView={() => setView('admin-logs')}
      />

      {/* ⚡ TODAY'S ATTACK PLAN — ranked run-order for the floor */}
      {attackPlan.ranked.length > 0 && (
        <div className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-orange-500/15 border border-orange-500/30 flex items-center justify-center shrink-0">
                <Zap className="w-4 h-4 text-orange-400" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-black text-white tracking-tight">Today's Attack Plan</p>
                <p className="text-[11px] text-zinc-500 truncate">
                  Run these in this order · {attackPlan.totalCount} open job{attackPlan.totalCount !== 1 ? 's' : ''}
                  {attackPlan.totalRemaining > 0 && <> · ~{attackPlan.totalRemaining.toFixed(0)}h of estimated work queued</>}
                </p>
              </div>
            </div>
            <button onClick={() => setView('admin-jobs')} className="shrink-0 text-[11px] font-bold text-zinc-400 hover:text-white flex items-center gap-1 transition-colors">
              All jobs <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
          <div className="divide-y divide-white/5">
            {attackPlan.ranked.map(({ job: j, eta }, i) => {
              const c = RISK_COLORS[eta.riskLevel];
              const liveNames = activeLogs.filter(l => l.jobId === j.id).map(l => l.userName.split(' ')[0]);
              return (
                <button
                  key={j.id}
                  onClick={() => setView('admin-jobs')}
                  className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-white/[0.03] transition-colors text-left"
                >
                  <span className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[12px] font-black tabular ${i === 0 ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40' : 'bg-zinc-800/80 text-zinc-400 border border-white/5'}`}>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-black text-white truncate">{j.poNumber}</span>
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${c.bg} ${c.border} ${c.text}`}>{c.label.toUpperCase()}</span>
                      {liveNames.length > 0 && (
                        <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          {liveNames.join(', ')}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                      {j.partNumber}{j.customer ? ` · ${j.customer}` : ''} — {eta.riskReason}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {eta.remainingHours !== null && (
                      <p className="text-[12px] font-black text-white tabular">{eta.remainingHours.toFixed(1)}h<span className="text-zinc-600 font-bold text-[10px]"> left</span></p>
                    )}
                    {j.dueDate && <p className="text-[10px] text-zinc-500 font-mono tabular">{fmt(j.dueDate).slice(0, 5)}</p>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

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
                {/* Stopping someone's timer lives on the live floor */}
                <button onClick={() => setView('admin-live')} className="shrink-0 text-[11px] font-bold text-zinc-400 hover:text-white flex items-center gap-1 transition-colors">
                  Live floor <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
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

      {/* ✅ SHOP ACTIONS — up front only while something is still open */}
      {hasOpenActions && (
        <ShopActionsPanel actions={dashActions} users={dashWorkers} currentUserName={user?.name} addToast={addToast} />
      )}

      {/* ── MORE INSIGHTS — money, trends and analysis. Closed by default so the
          page opens on what needs doing today; the choice is remembered. ── */}
      <button type="button" onClick={toggleMore} aria-expanded={showMore}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-zinc-900/50 border border-white/5 hover:bg-zinc-900/80 hover:border-white/10 transition-colors text-left">
        <span className="flex items-center gap-2.5 min-w-0">
          <Sparkles className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-sm font-black text-white">{showMore ? 'Hide insights' : 'More insights'}</span>
            <span className="block text-[11px] text-zinc-500 truncate">Money, capacity, trends, flow map, worker stats, recent activity</span>
          </span>
        </span>
        <ChevronDown className={`w-4 h-4 text-zinc-400 shrink-0 transition-transform ${showMore ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {showMore && (
        <div className="space-y-6">
          {/* 🎯 FOCUS THIS WEEK — the owner report's punchline, jumps to the full report */}
          <FocusStrip
            jobs={jobs}
            logs={allLogs}
            rework={reworkEntries}
            actions={dashActions}
            users={dashWorkers}
            settings={shopSettings}
            onOpen={() => setView('admin-weekly')}
          />

          {/* ── WEEKLY CAPACITY FORECAST — ETA engine output ── */}
          {(() => {
            // Only show when we have real data (at least one job with expected hours or part history)
            const openJobsForCap = jobs.filter(j => !isJobClosed(j));
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
            <ShopBrainPanel insights={shopInsights} setView={setView} onMakeTask={async (insight) => {
              try {
                await DB.saveShopAction({
                  id: crypto.randomUUID(),
                  title: insight.title,
                  notes: insight.body,
                  done: false,
                  createdAt: Date.now(),
                  createdBy: user?.name,
                  source: 'brain',
                  sourceInsightId: insight.id,
                });
                addToast('success', 'Added to Shop Actions — assign it a person & date');
              } catch { addToast('error', 'Could not create the action'); }
            }} />
          )}

          {/* 📈 SHOP TRENDS — the brain's memory: last week vs your 4-week normal */}
          <ShopTrendsPanel jobs={jobs} logs={allLogs} rework={reworkEntries} />

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

          {/* ── MONEY THIS MONTH — one set of numbers. Closed jobs use their locked
              profit snapshot, open ones the same live rule as the Jobs page
              (utils/jobBudget). Replaces six panels (KPI cards, P&L, leaderboard,
              budget tracker, donut, revenue-vs-cost) that each did their own math. ── */}
          {(shopSettings.shopRate || 0) > 0 && (() => {
            const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
            const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0, 0, 0, 0);
            const completedJobs = jobs.filter(j => j.status === 'completed');
            const monthJobs = completedJobs.filter(j => (j.completedAt || 0) >= monthStart.getTime());
            const total = (list: Job[]) => list.reduce((acc, j) => {
              const m = moneyOf(j);
              return { revenue: acc.revenue + m.revenue, cost: acc.cost + m.totalCost, hrs: acc.hrs + m.laborHours, jobs: acc.jobs + 1 };
            }, { revenue: 0, cost: 0, hrs: 0, jobs: 0 });
            const month = total(monthJobs);
            const week = total(completedJobs.filter(j => (j.completedAt || 0) >= weekStart.getTime()));
            const monthProfit = month.revenue - month.cost;
            const monthMargin = month.revenue > 0 ? (monthProfit / month.revenue) * 100 : null;
            const unquoted = monthJobs.filter(j => !(j.quoteAmount && j.quoteAmount > 0)).length;
            const revPerHr = month.hrs > 0 ? month.revenue / month.hrs : 0;
            const costPerHr = month.hrs > 0 ? month.cost / month.hrs : 0;

            const budgetRows = jobs.filter(j => openBudgets.has(j.id))
              .map(j => ({ job: j, b: openBudgets.get(j.id)! }))
              .sort((a, b) => b.b.usedPct - a.b.usedPct)
              .slice(0, 5);

            const custMap = new Map<string, { revenue: number; cost: number }>();
            monthJobs.forEach(j => {
              const m = moneyOf(j);
              const c = j.customer || 'Unknown';
              const cur = custMap.get(c) || { revenue: 0, cost: 0 };
              cur.revenue += m.revenue; cur.cost += m.totalCost;
              custMap.set(c, cur);
            });
            const topCustomers = [...custMap.entries()].filter(([, d]) => d.revenue > 0).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5);
            const maxBar = topCustomers.reduce((m, [, d]) => Math.max(m, d.revenue, d.cost), 0) || 1;

            const goal = shopSettings.monthlyRevenueGoal || 0;
            const cards = [
              { label: 'Revenue', value: fmtMoneyK(month.revenue), sub: 'quoted value of finished jobs', cls: 'text-emerald-400' },
              { label: 'Costs', value: fmtMoneyK(month.cost), sub: `${month.hrs.toFixed(0)}h labor + overhead, material, POs`, cls: 'text-orange-400' },
              { label: 'Profit', value: month.revenue > 0 ? fmtMoneySigned(monthProfit) : '—', sub: monthMargin !== null ? `${monthMargin.toFixed(0)}% margin` : 'No quoted jobs yet', cls: month.revenue <= 0 ? 'text-zinc-600' : monthProfit >= 0 ? 'text-emerald-400' : 'text-red-400' },
              { label: '$ per hour', value: month.hrs > 0 ? `$${revPerHr.toFixed(0)}` : '—', sub: month.hrs > 0 ? `costs $${costPerHr.toFixed(0)}/hr` : 'No hours yet', cls: month.hrs > 0 ? 'text-amber-400' : 'text-zinc-600' },
            ];

            return (
              <div className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h3 className="font-bold text-white text-sm flex items-center gap-2"><Calculator className="w-4 h-4 text-emerald-400" aria-hidden="true" /> Money this month</h3>
                    <p className="text-[11px] text-zinc-500 mt-0.5">
                      {month.jobs} job{month.jobs !== 1 ? 's' : ''} finished
                      {week.jobs > 0 && <> · this week {fmtMoneyK(week.revenue)} in, {fmtMoneySigned(week.revenue - week.cost)} profit</>}
                    </p>
                  </div>
                  {unquoted > 0 && (
                    <span className="text-[10px] bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-2 py-1 rounded-lg font-bold" title="Finished this month with no quote — they count as $0 revenue">
                      {unquoted} with no quote
                    </span>
                  )}
                </div>
                <div className="p-4 space-y-5">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {cards.map(c => (
                      <div key={c.label} className="bg-zinc-950/40 border border-white/5 rounded-xl p-3 min-w-0">
                        <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider truncate">{c.label}</p>
                        <p className={`text-lg sm:text-2xl font-black tabular truncate ${c.cls}`}>{c.value}</p>
                        <p className="text-[10px] text-zinc-600 truncate">{c.sub}</p>
                      </div>
                    ))}
                  </div>

                  {goal > 0 && (() => {
                    const pct = Math.min(100, (month.revenue / goal) * 100);
                    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
                    const day = new Date().getDate();
                    const pace = (month.revenue / day) * daysInMonth;
                    const color = pace >= goal ? '#10b981' : pace >= goal * 0.9 ? '#f59e0b' : '#ef4444';
                    return (
                      <div>
                        <div className="flex items-center justify-between gap-2 text-[11px] mb-1.5 flex-wrap">
                          <span className="font-bold text-zinc-400">Monthly goal {fmtMoneyK(goal)} · {pct.toFixed(0)}%</span>
                          <span className="text-zinc-500 tabular">on pace for <span className="font-black" style={{ color }}>{fmtMoneyK(pace)}</span> · {daysInMonth - day}d left</span>
                        </div>
                        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
                        </div>
                      </div>
                    );
                  })()}

                  {budgetRows.length > 0 && (
                    <div>
                      <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Open jobs — how much of the quote is used</p>
                      <div className="space-y-2.5">
                        {budgetRows.map(({ job: j, b }) => {
                          const color = b.overBudget ? '#ef4444' : b.atRisk ? '#eab308' : '#10b981';
                          return (
                            <div key={j.id}>
                              <div className="flex items-center justify-between gap-2 text-[11px] mb-1">
                                <span className="min-w-0 truncate">
                                  <span className="font-bold text-white text-sm">{j.poNumber}</span>
                                  {j.partNumber && <span className="text-zinc-500 font-mono ml-2 hidden sm:inline">{j.partNumber}</span>}
                                </span>
                                <span className="shrink-0 font-mono tabular text-zinc-500">
                                  {fmtMoneyK(b.cost)} of {fmtMoneyK(b.quote)} · <span className="font-black" style={{ color }}>{b.overBudget ? `${fmtMoneyK(-b.remaining)} over` : `${b.usedPct.toFixed(0)}%`}</span>
                                </span>
                              </div>
                              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(100, b.usedPct)}%`, background: color }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {topCustomers.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">By customer — this month</p>
                        <p className="text-[10px] text-zinc-600 flex items-center gap-2">
                          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500/70" /> revenue</span>
                          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400/80" /> cost</span>
                        </p>
                      </div>
                      <div className="space-y-2.5">
                        {topCustomers.map(([cust, d]) => {
                          const profit = d.revenue - d.cost;
                          return (
                            <div key={cust}>
                              <div className="flex items-center justify-between gap-2 text-[11px] mb-1">
                                <span className="text-xs font-bold text-zinc-200 truncate">{cust}</span>
                                <span className="shrink-0 font-mono tabular text-zinc-500">
                                  {fmtMoneyK(d.revenue)} in · <span className={`font-black ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtMoneySigned(profit)}</span>
                                </span>
                              </div>
                              <div className="relative h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-500/70" style={{ width: `${(d.revenue / maxBar) * 100}%` }} />
                                <div className="absolute inset-y-0 left-0 rounded-full bg-orange-400/80" style={{ width: `${(d.cost / maxBar) * 100}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

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
              const otW = onTimeRate(jobs.filter(j => j.status === 'completed' && jobIds.has(j.id)));
              const onTime = otW.onTime;
              const todayStart = new Date(); todayStart.setHours(0,0,0,0);
              const todayLogs = allLogs.filter(l => l.userId === w.id && l.endTime && l.startTime >= todayStart.getTime());
              const activeMinsToday = todayLogs.reduce((a, l) => a + (l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0)), 0);
              statMap.set(w.id, { id: w.id, name: w.name, jobsDone: jobIds.size, totalMins, onTime, late: otW.judged - onTime, activeMinsToday, workerRate: (w as any).hourlyRate || rate });
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

          {/* ── QUOTE RESULTS — did the quotes cover the real cost? Same cost rule and
              margin grades as the job profit cards (great/good ≥ 15%, tight ≥ 0%).
              It used to compare hours × shop rate to the quote, so a healthy 30%
              margin read as "overquoted — leaving money on the table". ── */}
          {(() => {
            if ((shopSettings.shopRate || 0) === 0) return null;
            const done = jobs.filter(j =>
              j.status === 'completed' && (j.quoteAmount || 0) > 0 && j.completedAt && j.completedAt > Date.now() - 90 * 86400000
            );
            if (done.length < 3) return null;
            const margins = done.map(j => { const m = moneyOf(j); return m.revenue > 0 ? (m.profit / m.revenue) * 100 : 0; });
            const avg = margins.reduce((a, x) => a + x, 0) / margins.length;
            const healthy = margins.filter(x => x >= 15).length;
            const thin = margins.filter(x => x >= 0 && x < 15).length;
            const lost = margins.filter(x => x < 0).length;
            const color = avg >= 15 ? 'text-emerald-400' : avg >= 0 ? 'text-amber-400' : 'text-red-400';
            const label = avg >= 15 ? 'Quotes are covering costs' : avg >= 0 ? 'Margins are thin' : 'Jobs are losing money';
            return (
              <div className="card-shine hover-lift-glow bg-gradient-to-br from-zinc-900/60 to-zinc-900/30 border border-white/5 rounded-2xl p-4 sm:p-5">
                <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                  <div>
                    <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2"><TrendingUp className="w-3.5 h-3.5 text-amber-400" /> Quote Results</h3>
                    <p className="text-[11px] text-zinc-600 mt-0.5">{done.length} finished jobs with a quote · last 90 days</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-xl font-black tabular ${color}`}>{avg.toFixed(0)}% <span className="text-[11px] font-bold">avg margin</span></p>
                    <p className={`text-[10px] font-bold ${color}`}>{label}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-emerald-500/8 border border-emerald-500/20 rounded-xl p-3 text-center">
                    <p className="text-2xl font-black text-emerald-400">{healthy}</p>
                    <p className="text-[10px] font-bold text-emerald-400/70 uppercase tracking-wide mt-0.5">15%+ margin</p>
                  </div>
                  <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl p-3 text-center">
                    <p className="text-2xl font-black text-amber-400">{thin}</p>
                    <p className="text-[10px] font-bold text-amber-400/70 uppercase tracking-wide mt-0.5">Thin (0–15%)</p>
                  </div>
                  <div className="bg-red-500/8 border border-red-500/20 rounded-xl p-3 text-center">
                    <p className="text-2xl font-black text-red-400">{lost}</p>
                    <p className="text-[10px] font-bold text-red-400/70 uppercase tracking-wide mt-0.5">Lost money</p>
                  </div>
                </div>
                {lost > 0 && (
                  <div className="mt-3 flex items-start gap-2 bg-red-500/8 border border-red-500/20 rounded-xl px-3 py-2.5">
                    <TrendingDown className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-red-300/80">{lost} job{lost > 1 ? 's' : ''} cost more than quoted. Consider raising the price on those parts or tracking setup time separately.</p>
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

          {/* Nothing open → the panel lives here, where new actions get added */}
          {!hasOpenActions && (
            <ShopActionsPanel actions={dashActions} users={dashWorkers} currentUserName={user?.name} addToast={addToast} />
          )}
        </div>
      )}

    </div>
  );
};

// --- PRIORITY BADGE ---
const PriorityBadge = ({ priority }: { priority?: string }) => {
  const p = priority || 'normal';
  // Most jobs are normal — a grey NORMAL pill on every row was just noise.
  if (p === 'normal') return <span className="text-zinc-700 text-xs" aria-label="Normal priority">—</span>;
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

// The steps (labels, order) are edited here and saved with the job; ticks go
// straight to the job one step at a time (onTick → DB.setChecklistTick) and
// show the LIVE ticks, so the floor's check-offs appear here as they happen.
const JobChecklistSection = ({ job, ticks, operations = [], onUpdate, onTick }: {
  job: Job;
  ticks?: Job['checklistTicks'];
  /** The shop's operations — a step named like one gets a Start button on the floor. */
  operations?: string[];
  onUpdate: (items: JobChecklistItem[]) => void;
  /** Absent for a job not saved yet — nothing to tick until it exists. */
  onTick?: (item: JobChecklistItem, done: boolean) => void;
}) => {
  const items = job.checklist || [];
  const [newLabel, setNewLabel] = useState('');
  const live = { checklistTicks: ticks };
  const doneCount = items.filter(i => stepDone(live, i)).length;
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
        {items.map((item, idx) => {
          const done = stepDone(live, item);
          const by = done ? stepTickedBy(live, item) : null;
          return (
          <div key={item.id} className={`flex items-center gap-2 p-2.5 rounded-lg border transition-all ${done ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-zinc-950 border-white/5 hover:border-white/15'}`}>
            {onTick ? (
              <button
                type="button"
                onClick={() => onTick(item, !done)}
                aria-label={done ? `Mark "${item.label}" not done` : `Mark "${item.label}" done`}
                className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${done ? 'bg-emerald-500 border-emerald-500' : 'bg-transparent border-zinc-600 hover:border-purple-400'}`}
              >
                {done && <CheckCircle className="w-3 h-3 text-white" aria-hidden="true" />}
              </button>
            ) : (
              <span className="w-5 text-center text-[11px] font-bold text-zinc-600 shrink-0 tabular">{idx + 1}</span>
            )}
            <input
              value={item.label}
              onChange={e => rename(item.id, e.target.value)}
              className={`flex-1 bg-transparent text-sm outline-none ${done ? 'text-zinc-500 line-through' : 'text-white'}`}
            />
            {by?.name && (
              <span className="text-[9px] text-emerald-400/70 truncate shrink-0" title={by.at ? `Done ${new Date(by.at).toLocaleString()}` : undefined}>
                by {by.name.split(' ')[0]}
              </span>
            )}
            <div className="flex flex-col shrink-0">
              <button type="button" onClick={() => move(item.id, -1)} disabled={idx === 0} aria-label="Move up" className="text-zinc-600 hover:text-white disabled:opacity-20 p-0.5"><ChevronUp className="w-3 h-3" aria-hidden="true" /></button>
              <button type="button" onClick={() => move(item.id, 1)} disabled={idx === items.length - 1} aria-label="Move down" className="text-zinc-600 hover:text-white disabled:opacity-20 p-0.5"><ChevronDown className="w-3 h-3" aria-hidden="true" /></button>
            </div>
            <button type="button" onClick={() => remove(item.id)} aria-label="Remove step" className="text-zinc-600 hover:text-red-400 p-1 shrink-0"><X className="w-3.5 h-3.5" aria-hidden="true" /></button>
          </div>
          );
        })}
      </div>

      {/* Add new item */}
      <div className="flex gap-2">
        <input
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
          list="job-step-ops"
          placeholder="Add a step — pick an operation or type one"
          className="flex-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500/50"
        />
        <datalist id="job-step-ops">
          {operations.filter(op => !items.some(i => normOp(i.label) === normOp(op))).map(op => <option key={op} value={op} />)}
        </datalist>
        <button type="button" onClick={addItem} disabled={!newLabel.trim()} className="bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add
        </button>
      </div>
      {items.length === 0 && (
        <p className="text-[10px] text-zinc-600 italic text-center">💡 Break big jobs into steps. A step named like an operation gets its own Start button on the floor, and workers check steps off as they finish them.</p>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════
// JOB ATTACHMENTS SECTION — drawings, PDFs, cert docs (Jobs R1 #2)
// ══════════════════════════════════════════════════════════════════
const JobAttachmentsSection = ({ job, onUpdate, user, addToast }: { job: Job; onUpdate: (atts: JobAttachment[] | ((prev: JobAttachment[]) => JobAttachment[])) => void; user: User | null; addToast: any }) => {
  const attachments = job.attachments || [];
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  // Files live inside the job record (no cloud storage on the free plan) and
  // a record can't pass ~1 MB — photo, notes and all. A 2 MB-per-file cap let
  // a drawing "attach", then the job save failed. Photos are shrunk; other
  // files must be small.
  const MAX_FILE_BYTES = Math.floor(FILE_BUDGET_BYTES * 3 / 4);   // base64 grows 4/3

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    const newAtts: JobAttachment[] = [];
    for (const file of Array.from(files)) {
      const isImage = file.type.startsWith('image/');
      if (!isImage && file.size > MAX_FILE_BYTES) {
        addToast('error', `"${file.name}" is too big to attach (max ${Math.round(MAX_FILE_BYTES / 1000)} KB) — save a smaller copy or a photo of it`);
        continue;
      }
      try {
        const dataUrl: string = isImage ? await shrinkImage(file, 250_000) : await new Promise((resolve, reject) => {
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
          type: isImage ? 'image/jpeg' : file.type,
          size: isImage ? Math.round(dataUrl.length * 3 / 4) : file.size,
          dataUrl,
          uploadedAt: Date.now(),
          uploadedBy: user?.id || 'unknown',
          uploadedByName: user?.name,
          category,
        });
      } catch (e: any) {
        addToast('error', `Couldn't add ${file.name}${e?.message ? ` — ${e.message}` : ''}`);
      }
    }
    if (newAtts.length > 0) {
      // The whole job has to fit: the part photo, notes and everything else
      // count too (only the attachments were counted before).
      const rest = JSON.stringify({ ...job, attachments: [] }).length;
      const merged = [...attachments, ...newAtts];
      const totalBytes = merged.reduce((sum, att) => sum + (att.dataUrl?.length || 0), 0);
      const room = 980_000 - rest;
      if (totalBytes > room) {
        addToast('error', `Not enough room on this job for that (${Math.round(totalBytes / 1000)} KB of files, ${Math.max(0, Math.round(room / 1000))} KB free) — remove an attachment or use a smaller file.`);
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      // Added to whatever the list holds NOW — one removed while files were
      // being read used to come back.
      onUpdate(prev => [...prev, ...newAtts]);
      addToast('success', `Added ${newAtts.length} attachment${newAtts.length > 1 ? 's' : ''}`);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';   // picking the same file again works
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
          <span className="text-[10px] text-zinc-600">Drawings · PDFs · Cert docs · Inspection reports · photos are shrunk, other files up to ~450 KB</span>
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
  useOverlayLayer(true, onClose);   // Esc closes only this, not the editor under it
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
// Due-date quick filter for the Jobs list. The dashboard's Overdue tile sets
// a one-time starting filter here before switching to Jobs.
type DueFilter = 'all' | 'overdue' | 'today' | 'week';
let pendingJobsDueFilter: DueFilter | null = null;
function openJobsFiltered(due: DueFilter, setView: (v: AppView) => void) {
  pendingJobsDueFilter = due;
  setView('admin-jobs');
}
const matchesDueFilter = (j: Job, f: DueFilter): boolean => {
  if (f === 'all') return true;
  const st = dueState(j, f === 'week' ? { soonDays: 7 } : {});
  return f === 'overdue' ? st === 'overdue' : f === 'today' ? st === 'today' : st === 'today' || st === 'soon';
};

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
  const [filterDue, setFilterDue] = useState<DueFilter>(() => pendingJobsDueFilter || 'all');
  useEffect(() => { pendingJobsDueFilter = null; }, []);
  const [sortBy, setSortBy] = useState<'dueDate' | 'priority' | 'newest' | 'oldest'>('dueDate');
  const [showFilters, setShowFilters] = useState(false);
  // Jobs R1 #4: Saved filter views (stored in localStorage per admin — no Firestore dep)
  type SavedView = { id: string; name: string; search: string; priority: string; status: string; sortBy: typeof sortBy; tab: 'active' | 'completed'; due?: DueFilter };
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => {
    try { return JSON.parse(localStorage.getItem('jobs_saved_views') || '[]'); } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem('jobs_saved_views', JSON.stringify(savedViews)); } catch {} }, [savedViews]);
  // Jobs R1 #5: Bulk selection
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [bulkActionOpen, setBulkActionOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Partial<Job>>({});
  const [showModal, setShowModal] = useState(false);
  // Tracks whether the checklist was edited in THIS modal session. Workers
  // check items off from the floor card while the modal sits open — if the
  // admin then saves an untouched (stale) checklist it clobbers their
  // check-offs. Only write the checklist when it actually changed here.
  // (Concurrent edits on BOTH sides remain last-write-wins on the array.)
  const checklistDirtyRef = useRef(false);
  // Same idea for the part photo: the modal's copy goes stale the moment it
  // opens (another device, or the background Storage move, can change it), so
  // only write the photo when it was actually changed in this modal session.
  const photoDirtyRef = useRef(false);
  const shipDirtyRef = useRef(false);   // "Shipped On" corrected in this session
  // Attachments too — and they're inline files, so re-sending them on every
  // save was also slow.
  const attachmentsDirtyRef = useRef(false);
  // The job as it was when the editor opened: a field emptied in this session
  // is deleted on save (see saveEditedJob).
  const openedJobRef = useRef<Partial<Job>>({});
  const savingJobRef = useRef(false);
  const [savingJob, setSavingJob] = useState(false);
  const editingJobIdRef = useRef<string>('');
  // The hours estimate this editor filled in (null = none, or the person typed
  // their own). While the field still holds it, it follows the quantity — it
  // used to freeze at whatever quantity was typed first.
  const autoHoursRef = useRef<number | null>(null);
  useEffect(() => {
    if (showModal) {
      checklistDirtyRef.current = false; photoDirtyRef.current = false; shipDirtyRef.current = false;
      attachmentsDirtyRef.current = false;
      openedJobRef.current = editingJob;
      autoHoursRef.current = null;
      editingJobIdRef.current = editingJob.id || '';
    } else {
      editingJobIdRef.current = '__closed__';
    }
    // Snapshot only when the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModal]);
  // Closing the editor forgets the job it showed, so nothing later (Scan PO,
  // the next New Job) can land on top of it.
  const closeJobEditor = () => { setShowModal(false); setEditingJob({}); };
  // X / Cancel: never while a save is running (it would land on the next
  // job opened), and ask before throwing away unsaved edits.
  const requestCloseJobEditor = () => {
    if (savingJobRef.current) return;
    const dirty = hasChanges(openedJobRef.current, editingJob, { ignore: ['status', 'currentStage', 'stageHistory', 'checklistTicks', 'jobNotes', 'completedAt', 'shippedAt', 'profitSnapshot', 'photoInherited', 'photoFromPo'] })
      || photoDirtyRef.current || checklistDirtyRef.current || attachmentsDirtyRef.current;
    if (!dirty) { closeJobEditor(); return; }
    confirm({ title: 'Discard changes?', message: 'This job has changes that are not saved. Close without saving them?', onConfirm: async () => closeJobEditor() });
  };
  // Move the open job to another (not-complete) stage. On a FINISHED job that
  // reopens it — clearing its ship date and locked profit — so ask first; one
  // tap on the stage bar used to do it.
  // The editor's copy follows the same rule the database applies to an open
  // stage: it's open again (no completion, ship date or locked profit). It
  // used to keep "completed", so Shipped On stayed editable on a reopened job
  // and Complete stayed hidden.
  const stageBusyRef = useRef(false);
  const moveEditorJob = async (stage: JobStage, verb: string) => {
    const jobId = editingJob.id;
    if (!jobId || stageBusyRef.current) return;   // a double-click added two history entries
    stageBusyRef.current = true;
    try {
      await DB.advanceJobStage(jobId, stage.id, user.id, user.name, false);
      // stageHistory is owned by DB.advanceJobStage (arrayUnion) — never append locally
      setEditingJob(p => ({
        ...p, currentStage: stage.id, status: stage.id === 'pending' ? 'pending' : 'in-progress',
        completedAt: undefined, profitSnapshot: undefined, shippedAt: isShippedStageId(stage.id) ? Date.now() : undefined,
      }));
      addToast('success', `${verb} ${stage.label}`);
    } catch {
      addToast('error', `Couldn't move it to ${stage.label} — check the internet and try again.`);
    } finally { stageBusyRef.current = false; }
  };
  const moveToStage = (stage: JobStage) => {
    const jobId = editingJob.id;
    if (!jobId) return;
    const go = () => moveEditorJob(stage, 'Moved to');
    if (editingJob.status === 'completed') {
      confirm({
        title: 'Reopen this finished job?',
        message: `Moving PO ${editingJob.poNumber || ''} back to ${stage.label} reopens it — its ship date and locked profit are cleared.`,
        onConfirm: go,
      });
    } else {
      go();
    }
  };
  // Deleting a job keeps the hours logged on it (DB.deleteJob) — say so.
  const keptHoursNote = (ids: string[]) => {
    const want = new Set(ids);
    const seen = new Set<string>();
    let mins = 0;
    for (const l of [...allLogs, ...adminHistLogs]) {
      if (!want.has(l.jobId) || seen.has(l.id) || !l.endTime) continue;
      seen.add(l.id);
      mins += logMinutes(l);
    }
    return mins >= 1 ? ` Workers logged ${fmtMinutes(mins)} on ${ids.length > 1 ? 'them' : 'it'} — those hours stay in their time records.` : '';
  };
  const [bulkBusy, setBulkBusy] = useState(false);
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
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [allPOs, setAllPOs] = useState<PurchaseOrder[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<User | null>(null);
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  // Which job row has its inline time-breakdown panel open (⏱ chip click)
  const [timeBreakdownJobId, setTimeBreakdownJobId] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const { prompt: promptInput, PromptHost: JobCompletePromptHost } = usePrompt();
  const { askShipDate, ShipDateHost } = useShipDate();
  const modalBodyRef = useRef<HTMLDivElement>(null);
  const [calAdded, setCalAdded] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('cal_added_jobs') || '[]'); } catch { return []; } });
  const [printed, setPrinted] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('printed_jobs') || '[]'); } catch { return []; } });
  // Part history index for the Green/Yellow/Red pills + Risk & Crew panel.
  // Merged with one-shot deep history — the live stream caps at 500 logs.
  const [adminHistLogs, setAdminHistLogs] = useState<TimeLog[]>([]);
  useEffect(() => { DB.fetchLogHistory().then(setAdminHistLogs).catch(() => {}); }, []);
  const adminRiskIndex = useMemo(() => {
    const byId = new Map<string, TimeLog>();
    for (const l of adminHistLogs) byId.set(l.id, l);
    for (const l of allLogs) byId.set(l.id, l);
    return buildPartRiskIndex(jobs, [...byId.values()], reworkEntries);
  }, [jobs, allLogs, adminHistLogs, reworkEntries]);
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
    // Everyone (incl. switched-off people) for labor rates in job profit; only
    // active people for picking a worker.
    const u3 = DB.subscribeUsers((u) => { setAllUsers(u); setWorkers(u.filter((w: User) => w.isActive !== false)); });
    const u4 = DB.subscribeAllLogs(l => setAllLogs(l.filter(x => x.endTime)));   // job hours from the whole history, not the newest 500
    const u5 = DB.subscribeRework(setReworkEntries);
    const u6 = DB.subscribeActiveLogs(setActiveLogs);
    const u7 = DB.subscribePurchaseOrders(setAllPOs);
    const u8 = DB.subscribeSamples(setSamples);
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); u8(); };
  }, []);

  // ── Live clock — forces re-render every 30 s so active-job elapsed times stay fresh.
  const [, setLiveTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setLiveTick(t => t + 1), 30_000);
    return () => clearInterval(id);
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

  const handleAdminStartJob = async (operation: string, confirmed = false) => {
    if (!startJobModal) return;
    const targetWorker = selectedWorker || user;
    // Starting stops whatever they're timing now — ask first (it used to end
    // the worker's running timer without a word).
    const busy = !confirmed && activeLogs.find(l => l.userId === targetWorker.id && l.jobId !== startJobModal.id);
    if (busy) {
      confirm({
        title: `${targetWorker.name.split(' ')[0]} is on another job`,
        message: `${targetWorker.name} is timing ${busy.operation || 'work'} on ${busy.jobIdsDisplay || busy.partNumber || 'another job'}. Starting this stops that timer. Switch them?`,
        onConfirm: async () => { await handleAdminStartJob(operation, true); },
      });
      return;
    }
    if (_startInFlight.has(targetWorker.id)) return;   // drop double-tap
    _startInFlight.add(targetWorker.id);
    try {
      const logId = await DB.startTimeLog(startJobModal.id, targetWorker.id, targetWorker.name, operation, startJobModal.partNumber, startJobModal.customer, selectedMachine || undefined, undefined, startJobModal.jobIdsDisplay, startJobModal.partImage);
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
      addToast('error', 'Failed to start: ' + (e?.message || 'unknown'));
    } finally {
      // Hold the guard briefly so a second tap can't slip through before the
      // Firestore snapshot with the new log arrives (subscription latency).
      setTimeout(() => _startInFlight.delete(targetWorker.id), 2000);
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
      // No priority set shows as Normal everywhere, so the Normal filter includes it.
      if (filterPriority !== 'all' && (j.priority || 'normal') !== filterPriority) return false;
      if (filterStatus !== 'all' && j.status !== filterStatus) return false;
      if (activeTab !== 'completed' && !matchesDueFilter(j, filterDue)) return false;
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
  }, [jobs, search, activeTab, filterPriority, filterStatus, filterDue, sortBy]);

  // Counts for the due chips — open jobs, the shared due rule.
  const dueCounts = useMemo(() => {
    const open = jobs.filter(j => j.status !== 'completed');
    return {
      overdue: open.filter(j => matchesDueFilter(j, 'overdue')).length,
      today: open.filter(j => matchesDueFilter(j, 'today')).length,
      week: open.filter(j => matchesDueFilter(j, 'week')).length,
    };
  }, [jobs]);

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
  const activeFilterCount = [filterPriority !== 'all', filterStatus !== 'all', filterDue !== 'all', sortBy !== 'dueDate'].filter(Boolean).length;

  // ── SHOP BRAIN — per-job intelligence ──────────────────────────────────────
  // Stale: active job with no time log (or last log) older than 48h
  const staleJobIds = useMemo(() => {
    const STALE_MS = 48 * 3600000;
    const now = Date.now();
    const lastLogMs = new Map<string, number>();
    allLogs.forEach(l => {
      const ts = l.endTime || l.startTime;
      if (ts && ts > (lastLogMs.get(l.jobId) || 0)) lastLogMs.set(l.jobId, ts);
    });
    // Someone on the clock right now is activity too — allLogs holds finished
    // sessions only, so a job being worked showed STALE.
    activeLogs.forEach(l => lastLogMs.set(l.jobId, now));
    const ids = new Set<string>();
    jobs.filter(j => j.status !== 'completed' && j.status !== 'hold').forEach(j => {
      const last = lastLogMs.get(j.id) || 0;
      const age = now - j.createdAt;
      if (age > STALE_MS && (now - last) > STALE_MS) ids.add(j.id);
    });
    return ids;
  }, [jobs, allLogs, activeLogs]);

  // ── ETA / risk map — computed once for the whole jobs view ──────────
  // Maps jobId → JobETA so every job card can show a risk badge instantly.
  const jobEtaMap = useMemo(() => {
    const openJobs = jobs.filter(j => !isJobClosed(j));
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
  // Same rule as the dashboard (utils/jobBudget) — open jobs only; a finished
  // job's result is its profit card, not a budget warning.
  const jobBudgetMap = useMemo(() => {
    if (!(shopSettings.shopRate || 0)) return new Map<string, JobBudget>();
    return jobBudgets(jobs.filter(j => !isJobClosed(j)), groupLogsByJob(allLogs), allUsers, shopSettings, allPOs);
  }, [jobs, allLogs, allUsers, shopSettings, allPOs]);

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
    const hoursAreAuto = autoHoursRef.current !== null && editingJob.expectedHours === autoHoursRef.current;
    // Not on finished jobs — opening one to fix a date shouldn't change its budget.
    if (editingJob.status !== 'completed' && (!editingJob.expectedHours || hoursAreAuto) && editingJob.partNumber && (editingJob.quantity || 0) > 0) {
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
      } else {
        // Last fallback: aggregated sample estimate — averages ALL samples for
        // this part, weighted by piece count, with rateBuffer applied.
        const aggEst = getAggregatedSampleEstimate(
          editingJob.partNumber,
          samples,
          shopSettings.rateBuffer ?? 1.0,
        );
        if (aggEst) {
          const qty = editingJob.quantity || 0;
          const suggestedHrs = suggestHoursFromAggregated(aggEst, qty);
          if (suggestedHrs > 0) {
            patch.expectedHours = suggestedHrs;
            const opNames = aggEst.breakdown.map(b => b.operation).join(', ');
            const src = aggEst.sampleCount > 1
              ? `${aggEst.sampleCount} samples avg`
              : '1 sample';
            filled.push(`Est. ${suggestedHrs}h from ${src} (${aggEst.breakdown.length} ops: ${opNames})`);
          }
        }
      }
      if (patch.expectedHours !== undefined) {
        if (hoursAreAuto) {
          // Re-estimated for a new quantity: update quietly (no toast per keystroke).
          filled.length = 0;
          if (patch.expectedHours === editingJob.expectedHours) delete patch.expectedHours;
        }
        if (patch.expectedHours !== undefined) autoHoursRef.current = patch.expectedHours;
      }
    }
    // Price/instructions still need customer+part match (priceSuggestion)
    if (!priceSuggestion) {
      if (Object.keys(patch).length > 0) setEditingJob(prev => ({ ...prev, ...patch }));
      if (filled.length > 0) addToast('info', `🧠 Filled from memory: ${filled.join(' · ')}. Save to keep.`);
      return;
    }
    // 2. Price per part — last paid rate. New jobs only: on an existing (often
    // finished) job a guessed price got saved with any unrelated edit and
    // re-locked its profit on that guess.
    if (!editingJob.id && priceSuggestion.pricePerPart && !editingJob.pricePerPart && !editingJob.quoteAmount) {
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
    if (Object.keys(patch).length > 0) setEditingJob(prev => ({ ...prev, ...patch }));
    // Make the magic visible so the user knows to hit Save to keep it.
    if (filled.length > 0) addToast('info', `🧠 Filled from memory: ${filled.join(' · ')}. Save to keep.`);
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

  // Quick photo from a job row. Photo fields only — the upload takes seconds,
  // and saving the whole job could revert edits made meanwhile. Shrunk to fit
  // the job record; errors are shown (a HEIC or unreadable file used to fail
  // without a word).
  const addRowPhoto = async (jobId: string, input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = '';   // picking the same file again still works
    if (!file) return;
    try {
      let partImage = await shrinkImage(await compressImage(file, 800, 0.6), 200_000);
      // Upload to Storage when available (base64 fallback) — keeps job docs tiny
      try { const b = dataUrlToBlobApp(partImage); if (b) partImage = await DB.uploadJobPartImage(b, jobId); } catch {}
      // "Added" only once the server has it — a photo that's still on this
      // phone shows here but not on the office PC yet.
      const result = await DB.setJobPhoto(jobId, partImage);
      if (result === 'queued') addToast('info', 'Photo saved on this phone — other screens get it once it uploads.');
      else addToast('success', 'Photo added');
    } catch (e: any) {
      addToast('error', `Could not save photo${e?.message ? ` — ${e.message}` : ''}`);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { addToast('error', 'Please select an image file'); return; }
    try {
      // Must fit inside the job record next to its attachments and notes.
      const partImage = await shrinkImage(await compressImage(file, 800, 0.6), 200_000);
      // This job's OWN photo now. Clearing the borrowed-photo tag is the whole
      // fix for "I replaced the photo and the old one came back": with the tag
      // still set, saveJob() treated the new photo as borrowed and dropped it.
      photoDirtyRef.current = true;
      setEditingJob(prev => ({ ...prev, partImage, photoInherited: undefined, photoFromPo: undefined }));
      addToast('success', 'Part photo added');
    } catch {
      addToast('error', 'Failed to process image');
    }
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const handleSave = async () => {
    // One save at a time: a double-tap on "Create Job" made two jobs.
    if (savingJobRef.current) return;
    if (!editingJob.poNumber || !editingJob.partNumber) return addToast('error', 'PO and Part Number required');
    if ((editingJob.expectedHours ?? 0) < 0) return addToast('error', 'Expected hours must be 0 or positive');
    savingJobRef.current = true;
    setSavingJob(true);
    try { return await saveEditedJob(); } finally { savingJobRef.current = false; setSavingJob(false); }
  };

  // Complete from inside the editor: save its edits first. Completing used to
  // lock the profit on the editor's unsaved quote/quantity (and write its
  // unsaved material cost) even if you then pressed Cancel.
  const completeFromEditor = async () => {
    const opened = openedJobRef.current as Partial<Job>;
    const current = editingJob as Job;
    const pending = hasChanges(opened, current, { ignore: ['status', 'currentStage', 'stageHistory', 'checklistTicks', 'jobNotes', 'photoInherited', 'photoFromPo'] })
      || photoDirtyRef.current || checklistDirtyRef.current || attachmentsDirtyRef.current;
    if (pending && !(await handleSave())) return;
    const live = jobs.find(j => j.id === current.id);
    await handleCompleteWithSnapshot({ ...(live || {}), ...current } as Job);
  };

  // The fields this editor's form controls. For an existing job only the ones
  // actually edited are written: saving the whole copy taken when the editor
  // opened undid due dates, priorities, quantities… changed on another device
  // while it was open.
  const JOB_FORM_FIELDS = ['jobIdsDisplay', 'poNumber', 'partNumber', 'quantity', 'customer', 'priority', 'dueDate', 'info',
    'dateReceived', 'quoteAmount', 'specialInstructions', 'pricePerPart', 'expectedHours', 'materialCost',
    'shippingMethod', 'trackingNumber', 'shippingNotes', 'portalNote'] as const;

  const saveEditedJob = async () => {
    const today = new Date();
    // Format as MM/DD/YYYY — the app's canonical date format.
    // The old ISO-string approach produced YYYY-MM-DD which broke every dateNum() comparison.
    const localDate = `${String(today.getMonth()+1).padStart(2,'0')}/${String(today.getDate()).padStart(2,'0')}/${today.getFullYear()}`;
    const isNew = !editingJob.id;
    // Captured now — the refs reset if the editor is reopened while saving.
    const photoChanged = photoDirtyRef.current;
    const checklistChanged = checklistDirtyRef.current;
    const attachmentsChanged = attachmentsDirtyRef.current;
    const shipChanged = shipDirtyRef.current;
    // Normalise a copy of the form the same way for the edited copy and the
    // copy the editor opened with, so only real edits count as changes.
    const formJob = (src: Partial<Job>, current: boolean): Job => ({
      ...(src as Job),
      id: editingJob.id || Date.now().toString(),
      jobIdsDisplay: src.jobIdsDisplay || src.poNumber || 'J-' + Date.now().toString().slice(-4),
      poNumber: src.poNumber || '',
      partNumber: src.partNumber || '',
      quantity: src.quantity || 0,
      customer: src.customer || '',
      priority: src.priority || 'normal',
      dueDate: normDate(src.dueDate) || '',
      info: src.info || '',
      status: src.status || 'pending',   // first clock-in moves it to In Progress
      // New jobs default to today; an existing job's emptied date stays empty
      // (it used to quietly become today).
      dateReceived: normDate(src.dateReceived) || (isNew ? localDate : ''),
      createdAt: src.createdAt || Date.now(),
      quoteAmount: src.quoteAmount || undefined,
      specialInstructions: src.specialInstructions || '',
      partImage: src.partImage || undefined,
      shippingMethod: src.shippingMethod || undefined,
      trackingNumber: src.trackingNumber || undefined,
      shippingNotes: src.shippingNotes || undefined,
      shippedAt: src.shippedAt || undefined,
      pricePerPart: src.pricePerPart || undefined,
      // Time budget — must persist so traveler prints it and over-budget alerts work
      expectedHours: src.expectedHours || undefined,
      // Material / consumable cost (entered during job lifecycle or at close-out)
      materialCost: src.materialCost || undefined,
      // Portal note — kept when it has text or an expected date. Its time is
      // re-stamped only when the note itself changed: stamping it on every
      // save made a two-week-old note show as "New update · just now".
      portalNote: (src.portalNote?.text?.trim() || src.portalNote?.expectedDate)
        ? (() => {
            const note = src.portalNote!;
            const was = (openedJobRef.current as Partial<Job>).portalNote;
            const changed = !was || (was.text || '') !== (note.text || '') || (was.expectedDate || '') !== (note.expectedDate || '');
            return current && changed ? { ...note, text: note.text || '', updatedAt: Date.now(), updatedBy: user?.name } : (was || note);
          })()
        : undefined,
    });
    const job = formJob(editingJob, true);
    delete (job as any).photoInherited;
    delete (job as any).photoFromPo;

    // Part photo: Storage URL when Storage is available (keeps job docs
    // tiny); otherwise the base64 stays on the job and the background move
    // upgrades it later.
    // A new job keeps whatever photo it has (reopening the editor after Scan PO
    // reset the "changed" flags and dropped it).
    if ((photoChanged || isNew) && job.partImage) {
      job.partImageAt = Date.now();
      if (job.partImage.startsWith('data:')) {
        try {
          const blob = dataUrlToBlobApp(job.partImage);
          if (blob) job.partImage = await DB.uploadJobPartImage(blob, job.id);
        } catch { /* keep base64 */ }
      }
    }
    const clearPhoto = photoChanged && !editingJob.partImage && !isNew;

    // A finished job's locked profit follows a quote or material cost entered
    // after close-out (the dashboard asks for exactly that). It used to keep
    // the close-out numbers forever — "Loss −100%" for a job closed before its
    // quote went in, in every report.
    const opened = openedJobRef.current as Record<string, unknown>;
    const liveJob = !isNew ? jobs.find(x => x.id === editingJob.id) : undefined;
    const money = (v: unknown) => Number(v) || 0;
    let relocked: Job['profitSnapshot'] | undefined;
    if (liveJob?.status === 'completed' && liveJob.profitSnapshot
      && (money(opened.quoteAmount) !== money(job.quoteAmount) || money(opened.materialCost) !== money(job.materialCost))) {
      let jobLogs = allLogs.filter(l => l.jobId === liveJob.id);
      try { jobLogs = await DB.getLogsForJob(liveJob.id); } catch { /* fall back to the loaded set */ }
      relocked = buildProfitSnapshot(calcJobProfit({ ...liveJob, quoteAmount: job.quoteAmount, materialCost: job.materialCost } as Job, jobLogs, allUsers, shopSettings, allPOs));
    }

    try {
      let result: 'saved' | 'queued';
      if (isNew) {
        // A new job: the whole record. Stage, notes and ticks start empty.
        delete (job as any).currentStage;
        delete (job as any).stageHistory;
        delete (job as any).checklistTicks;
        // Steps and photo stay on a new job even if the editor was reopened
        // (Scan PO) — there is nothing older for them to overwrite.
        if (!job.partImage) { delete (job as any).partImage; delete (job as any).partImageAt; }
        result = await DB.saveJob(job);
      } else {
        // An existing job: only what was edited here. Status, stage, notes,
        // ticks and completion are written by their own actions, never from
        // this copy.
        const pick = (o: Job) => Object.fromEntries(JOB_FORM_FIELDS.map(k => [k, (o as any)[k]])) as Partial<Job>;
        const changes: Partial<Job> = changedFields(pick(formJob(openedJobRef.current, false)), pick(job));
        // Due-date history, compared against the LIVE job: a moved date keeps
        // the original promise and logs the change.
        if ('dueDate' in changes) {
          const before = normDate(liveJob?.dueDate || '');
          if (before && job.dueDate && before !== job.dueDate) {
            changes.originalDueDate = liveJob?.originalDueDate || before;
            changes.dueDateHistory = [...(liveJob?.dueDateHistory || []), { from: before, to: job.dueDate, at: Date.now(), by: user?.name }];
          }
        }
        if (checklistChanged) changes.checklist = job.checklist;
        if (attachmentsChanged) changes.attachments = job.attachments;
        if (photoChanged && job.partImage) { changes.partImage = job.partImage; changes.partImageAt = job.partImageAt; }
        if (relocked) changes.profitSnapshot = relocked;
        result = Object.keys(changes).length ? await DB.updateJobFields(job.id, changes) : 'saved';
        // Removing a photo deletes both photo fields.
        if (clearPhoto) await DB.setJobPhoto(job.id, null);
        if (shipChanged && editingJob.shippedAt) await DB.setJobShippedAt(job.id, editingJob.shippedAt);
      }
      // Only close the editor that was saved — a save finishing after Cancel
      // used to close (and wipe) the next job's editor.
      if (editingJobIdRef.current === (editingJob.id || '')) { setShowModal(false); setEditingJob({}); }
      if (result === 'queued') {
        addToast('info', `${isNew ? 'Job created' : 'Saved'} on this device — it syncs when the internet is back.`);
      } else if (isNew) {
        addToast('success', '✅ Job created — click it to add stages, shipping & checklist.');
      } else {
        addToast('success', 'Job saved');
      }
      return true;
    }
    catch (e: any) {
      addToast('error', e instanceof DB.TooBigError || /deleted on another device/.test(e?.message || '')
        ? `${e.message}. Your changes are still here.`
        : "Couldn't save — check the internet and try again. Your changes are still here.");
      return false;
    }
  };

  // ── Complete a job — locks a profit snapshot immediately, no prompt needed.
  // Material costs are already baked into monthly overhead (settings.monthlyOverhead).
  const handleCompleteWithSnapshot = useCallback(async (j: Job) => {
    const stages = getStages(shopSettings);
    const completedStage = stages.find(s => s.isComplete);
    // Compute the LOCKED snapshot from the COMPLETE log set, not the live
    // subscription (capped at 500) — an old/long job would otherwise lock an
    // understated cost / overstated margin permanently.
    let jobLogs = allLogs.filter(l => l.jobId === j.id);
    try { jobLogs = await DB.getLogsForJob(j.id); } catch { /* fall back to capped set */ }
    // Ask when it actually shipped — on-time is judged by that, not this click.
    let lastWork = 0;
    for (const l of jobLogs) if (!l.isSample && l.endTime && l.endTime > lastWork) lastWork = l.endTime;
    const choice = await askShipDate({ count: 1, label: `PO ${j.poNumber}`, lastWorkMs: lastWork || null, shippedMs: j.shippedAt || null });
    if (!choice) return;
    const shippedAt = await resolveShipAt(choice, async () => lastWork || null, j.shippedAt);
    // All users — a worker since switched off is still paid their own rate.
    const breakdown = calcJobProfit(j, jobLogs, allUsers, shopSettings, allPOs);
    const snapshot = buildProfitSnapshot(breakdown);
    try {
      if (completedStage) {
        await DB.advanceJobStage(j.id, completedStage.id, user.id, user.name, true, shippedAt);
      }
      await DB.completeJobWithSnapshot(j.id, j.materialCost ?? 0, snapshot, shippedAt);
    } catch {
      // Used to fail silently — the job just stayed open with no word why.
      addToast('error', `Couldn't complete PO ${j.poNumber} — check the internet and try again.`);
      return;
    }
    if (editingJob.id === j.id) {
      setEditingJob(prev => ({ ...prev, status: 'completed', currentStage: completedStage?.id || prev.currentStage, profitSnapshot: snapshot }));
    }
    const gradeMsg = breakdown.grade === 'great' ? '🟢 Great margin!' : breakdown.grade === 'good' ? '🔵 Good job' : breakdown.grade === 'tight' ? '🟡 Tight margin' : '🔴 Loss';
    const onTime = shippedOnTime({ dueDate: j.dueDate, shippedAt });
    addToast('success', `✅ "${j.poNumber}" complete${onTime === true ? ' — on time' : onTime === false ? ' — late' : ''} · ${gradeMsg}`);
  }, [allLogs, allUsers, shopSettings, allPOs, user, editingJob, askShipDate]);

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
          <button onClick={() => { setEditingJob({}); setShowScanner(true); }} title="Scan a PO document to auto-fill a new job" className="bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 text-sm transition-all"><Scan className="w-4 h-4 text-amber-400" /> Scan PO</button>
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
        const overdueCount = allMonthJobs.filter(j => dueState(j) === 'overdue').length;

        const selectedDayJobs = calSelectedDay ? (jobsByDay[calSelectedDay] || []) : [];
        const selectedDateStr = calSelectedDay ? new Date(yr, mo, calSelectedDay).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';

        const cells = [];
        for (let i = 0; i < firstDay; i++) cells.push(<div key={`e${i}`} className="min-h-[80px] md:min-h-[110px] bg-zinc-950/20 rounded" />);
        for (let d = 1; d <= daysInMonth; d++) {
          const dayJobs = jobsByDay[d] || [];
          const past = dateNum(`${String(mo+1).padStart(2,'0')}/${String(d).padStart(2,'0')}/${yr}`) < dateNum(todayStr);
          const selected = calSelectedDay === d;
          const hasOverdue = dayJobs.some(j => dueState(j) === 'overdue');   // same rule as the Overdue count
          const bdays = (shopSettings.birthdays || []).filter(b => b.month === mo + 1 && b.day === d).map(b => b.name.trim().split(/\s+/)[0]);
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
              {bdays.length > 0 && <p className="text-[10px] font-bold text-pink-300 truncate mb-0.5" title={`Birthday: ${bdays.join(', ')}`}>🎂 {bdays.join(', ')}</p>}
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
                        const isOverdue = dueState(j) === 'overdue';
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

        {/* Due-date quick filters — one tap, always visible (due dates come first) */}
        {activeTab === 'active' && (
          <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Filter by due date">
            {([
              { key: 'overdue', label: 'Overdue', count: dueCounts.overdue, on: 'bg-red-500/20 border-red-500/50 text-red-300', off: 'border-red-500/25 text-red-400 hover:bg-red-500/10' },
              { key: 'today', label: 'Due today', count: dueCounts.today, on: 'bg-orange-500/20 border-orange-500/50 text-orange-200', off: 'border-orange-500/25 text-orange-300 hover:bg-orange-500/10' },
              { key: 'week', label: 'Next 7 days', count: dueCounts.week, on: 'bg-amber-500/20 border-amber-500/50 text-amber-200', off: 'border-amber-500/20 text-amber-300 hover:bg-amber-500/10' },
            ] as const).map(c => (
              <button
                key={c.key}
                type="button"
                aria-pressed={filterDue === c.key}
                onClick={() => setFilterDue(filterDue === c.key ? 'all' : c.key)}
                className={`min-h-[32px] px-3 rounded-lg border text-xs font-bold flex items-center gap-1.5 transition-colors ${filterDue === c.key ? c.on : c.count ? c.off : 'border-white/5 text-zinc-600 hover:text-zinc-400'}`}
              >
                {c.label}
                <span className="tabular font-black">{c.count}</span>
                {filterDue === c.key && <X className="w-3 h-3" aria-hidden="true" />}
              </button>
            ))}
          </div>
        )}

        {/* ── Saved Views Bar (Jobs R1 #4) ── */}
        {(savedViews.length > 0 || activeFilterCount > 0 || search) && (
          <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-white/5">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest shrink-0">📌 Views</span>
            {savedViews.map(v => {
              const isActive = v.search === search && v.priority === filterPriority && v.status === filterStatus && (v.due || 'all') === filterDue && v.sortBy === sortBy && v.tab === activeTab;
              return (
                <button
                  key={v.id}
                  onClick={() => {
                    setSearch(v.search);
                    setFilterPriority(v.priority);
                    setFilterStatus(v.status);
                    setFilterDue(v.due || 'all');
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
                  const v: SavedView = { id: `v_${Date.now()}`, name, search, priority: filterPriority, status: filterStatus, due: filterDue, sortBy, tab: (activeTab as string) === 'calendar' ? 'active' : (activeTab as 'active' | 'completed') };
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
                <button onClick={() => { setFilterPriority('all'); setFilterStatus('all'); setFilterDue('all'); setSortBy('dueDate'); }}
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
          {filteredJobs.filter(j => dueState(j) === 'overdue').length > 0 && (
            <span className="text-red-400 font-bold flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {filteredJobs.filter(j => dueState(j) === 'overdue').length} overdue
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
                disabled={bulkBusy}
                onClick={async () => {
                  if (bulkBusy) return;
                  const ids: string[] = Array.from(selectedJobIds);
                  setBulkBusy(true);
                  try {
                    // Just the priority — re-saving whole jobs from this list's
                    // copies could undo edits made elsewhere meanwhile.
                    const results = await Promise.allSettled(ids.map(id => DB.updateJobFields(id, { priority: p })));
                    const failedIds = ids.filter((_, i) => results[i].status === 'rejected');
                    if (failedIds.length) {
                      addToast('error', `Couldn't change ${failedIds.length} of ${ids.length} — they're still selected, try again.`);
                      setSelectedJobIds(new Set(failedIds));
                    } else {
                      addToast('success', `Set ${ids.length} job${ids.length > 1 ? 's' : ''} to ${p}`);
                      setSelectedJobIds(new Set());
                    }
                  } finally { setBulkBusy(false); }
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
            disabled={bulkBusy}
            onClick={async () => {
              // A second click while the first was still saving advanced jobs twice.
              if (bulkBusy) return;
              setBulkBusy(true);
              try {
              const stages = getStages(shopSettings);
              const ids: string[] = Array.from(selectedJobIds);
              const plan = ids
                .map(id => { const job = jobs.find(x => x.id === id); return job ? { id, next: getNextStage(job, stages) } : null; })
                .filter((p): p is { id: string; next: JobStage } => !!p && !!p.next);
              if (!plan.length) { addToast('info', 'Nothing to advance — those jobs are already at their last stage.'); return; }
              // Bulk close-outs are where on-time went wrong: jobs finished days
              // earlier were stamped "completed" today. Ask once for the batch.
              const completing = plan.filter(p => p.next.isComplete);
              let choice: ShipChoice | null = null;
              if (completing.length) {
                choice = await askShipDate({
                  count: completing.length,
                  shippedCount: completing.filter(p => jobs.find(x => x.id === p.id)?.shippedAt).length,
                });
                if (!choice) return;
              }
              const results = await Promise.allSettled(plan.map(async ({ id, next }) => {
                const shippedAt = next.isComplete && choice
                  ? await resolveShipAt(choice, () => DB.lastWorkEndForJob(id), jobs.find(x => x.id === id)?.shippedAt)
                  : undefined;
                await DB.advanceJobStage(id, next.id, user.id, user.name, next.isComplete, shippedAt);
                // Lock the profit like every other way of finishing a job —
                // bulk-finished jobs never got a locked margin.
                if (next.isComplete) {
                  const j = jobs.find(x => x.id === id);
                  if (j) {
                    let jl = allLogs.filter(l => l.jobId === id);
                    try { jl = await DB.getLogsForJob(id); } catch { /* loaded set */ }
                    await DB.completeJobWithSnapshot(id, j.materialCost ?? 0, buildProfitSnapshot(calcJobProfit(j, jl, allUsers, shopSettings, allPOs)), shippedAt);
                  }
                }
              }));
              const failedIds = plan.filter((_, i) => results[i].status === 'rejected').map(x => x.id);
              if (failedIds.length) {
                addToast('error', `Advanced ${plan.length - failedIds.length} of ${plan.length} — ${failedIds.length} couldn't be saved and are still selected. Try again.`);
                setSelectedJobIds(new Set(failedIds));
              } else {
                addToast('success', `Advanced ${plan.length} job${plan.length !== 1 ? 's' : ''} to next stage`);
                setSelectedJobIds(new Set());
              }
              } finally { setBulkBusy(false); }
            }}
            className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/20 px-3 py-1 rounded-lg flex items-center gap-1"
          >
            <ArrowRight className="w-3 h-3" aria-hidden="true" /> Advance Stage
          </button>
          {/* Batch: print travelers */}
          <button
            type="button"
            onClick={() => {
              // One print job, a page per traveler — not a print dialog per job.
              const buf = shopSettings.rateBuffer ?? 1.15;
              const items = Array.from(selectedJobIds)
                .map(id => jobs.find(x => x.id === id))
                .filter((j): j is Job => !!j)
                .map(job => {
                  const enriched = enrichJobForPrint(job, jobs, allLogs, buf);
                  return { job: enriched, rateBreakdown: getRateBreakdownForJob(enriched, allLogs, buf) };
                });
              printJobTravelersPDF(items, shopSettings);
              addToast('info', `Printing ${items.length} traveler${items.length !== 1 ? 's' : ''}`);
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
                message: `This permanently deletes ${ids.length} job${ids.length > 1 ? 's' : ''}. Cannot be undone.${keptHoursNote(ids)}`,
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
              <th className="p-3 sm:p-4 hidden md:table-cell">Status</th>
              <th className="p-2 sm:p-4">Due</th>
              <th className="p-1.5 sm:p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filteredJobs.map(j => {
              const _due = dueState(j);
              const isOverdue = _due === 'overdue';
              const isDueSoon = _due === 'today' || _due === 'soon';
              // Historical on-time / late for completed jobs
              const _shipOk = j.status === 'completed' ? shippedOnTime(j) : null;
              const deliveredLate = _shipOk === false;
              const deliveredOnTime = _shipOk === true;
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

              // ── Live elapsed from currently-open logs (ticks every 30 s) ──────────
              const jobActiveLogs = activeLogs.filter(l => l.jobId === j.id);
              const nowMs = Date.now();
              const activeElapsedMins = jobActiveLogs.reduce((acc, l) => {
                const elapsed = ((l.pausedAt ?? nowMs) - l.startTime - (l.totalPausedMs || 0));
                return acc + Math.max(0, elapsed) / 60_000;
              }, 0);
              const liveTotalMins = totalMins + activeElapsedMins;
              const liveTotalHrs  = liveTotalMins / 60;
              const activeLaborCost = jobActiveLogs.reduce((acc, l) => {
                const wk = workers.find(w => w.id === l.userId);
                const r  = wk?.hourlyRate || fallbackRate;
                const elapsed = Math.max(0, (l.pausedAt ?? nowMs) - l.startTime - (l.totalPausedMs || 0));
                return acc + (elapsed / 3_600_000) * r;
              }, 0);
              const liveTotalCost = totalCost + activeLaborCost;
              const isLive = jobActiveLogs.length > 0 && j.status !== 'completed';

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
                      {/* Part Photo thumbnail — phones/tablets only; from md up the
                          Part Details column has it (two camera slots per row before).
                          Tap to enlarge. Camera icon placeholder → tap to add. */}
                      {j.partImage ? (
                        <img
                          src={j.partImage}
                          alt={`${j.partNumber} reference`}
                          className="md:hidden w-12 h-12 sm:w-14 sm:h-14 rounded-lg object-cover border border-white/10 hover:border-cyan-500/60 transition-all flex-shrink-0 cursor-pointer"
                          onClick={(e) => { e.stopPropagation(); setLightboxImg(j.partImage!); }}
                        />
                      ) : (
                        // Empty "add photo" slot on tablets. Phones get the 📷 Photo
                        // button in the badge line below instead — a box here pushed
                        // the Due date off a phone screen.
                        <label
                          aria-label={`Take a photo of ${j.partNumber || 'this part'}`}
                          className="hidden sm:flex md:hidden w-14 h-14 rounded-lg border border-dashed border-cyan-500/30 bg-cyan-500/5 items-center justify-center cursor-pointer hover:border-cyan-500/50 hover:bg-cyan-500/10 transition-all flex-shrink-0 group/cam"
                          title="Add part photo"
                          onClick={e => e.stopPropagation()}
                        >
                          <Camera className="w-5 h-5 text-cyan-400/70 group-hover/cam:text-cyan-400" aria-hidden="true" />
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            onChange={e => addRowPhoto(j.id, e.currentTarget)}
                          />
                        </label>
                      )}
                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                        <span className="text-white font-black text-sm sm:text-xl">{j.poNumber}</span>
                        {/* Badges only for things that need a look. Overdue / due soon
                            already show in red/orange in the Due column, green risk tier
                            and "watch" pace were on nearly every row, and budget "at risk"
                            is the ⏱ chip's colour below. */}
                        {/* Priority only when it's raised (the old Priority column was "normal" on almost every row) */}
                        {j.status !== 'completed' && (j.priority === 'high' || j.priority === 'urgent') && <PriorityBadge priority={j.priority} />}
                        {j.status !== 'completed' && (() => {
                          const risk = computeJobRisk(j, adminRiskIndex);
                          return risk.tier !== 'green' ? <RiskPill risk={risk} /> : null;
                        })()}
                        {deliveredOnTime && <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">ON TIME</span>}
                        {deliveredLate && <span className="text-[10px] font-black text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded">LATE</span>}
                        {budget?.overBudget && <span className="text-[10px] font-black text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded" title={`${budget.usedPct.toFixed(0)}% of the quote used so far`}>OVER BUDGET</span>}
                        {isStale && j.status !== 'completed' && <span className="text-[10px] font-black text-zinc-500 bg-zinc-800/60 border border-zinc-700/60 px-1.5 py-0.5 rounded" title="No activity in 48+ hours">STALE</span>}
                        {/* RUSH badge — job was created with very little lead time (<= 5 days before due) */}
                        {j.status !== 'completed' && j.dueDate && j.createdAt && (() => {
                          const _dueD2 = parseDueDate(j.dueDate); if (!_dueD2) return null;
                          _dueD2.setHours(23,59,59,999); const dueDateMs = _dueD2.getTime();
                          const leadDays = (dueDateMs - j.createdAt) / 86400000;
                          if (leadDays > 5) return null;
                          return (
                            <span className="text-[10px] font-black text-red-300 bg-red-600/20 border border-red-500/40 px-1.5 py-0.5 rounded" title={`Only ${leadDays < 1 ? '<1 day' : Math.ceil(leadDays) + ' days'} lead time`}>
                              RUSH
                            </span>
                          );
                        })()}
                        {/* ETA pace badge — only when the engine says it won't make it at this pace */}
                        {(() => {
                          if (j.status === 'completed' || isOverdue) return null;
                          const eta = jobEtaMap.get(j.id);
                          if (!eta || eta.riskLevel !== 'at-risk') return null;
                          const c = RISK_COLORS[eta.riskLevel];
                          return (
                            <span
                              className={`text-[10px] font-black px-1.5 py-0.5 rounded border ${c.bg} ${c.border} ${c.text}`}
                              title={`ETA: ${eta.riskReason}`}
                            >
                              PACE RISK
                            </span>
                          );
                        })()}
                        {/* Phones: tap, snap the part, done — no trip into the job
                            editor. It wraps onto its own line, so the row doesn't widen. */}
                        {!j.partImage && (
                          <label
                            aria-label={`Take a photo of ${j.partNumber || 'this part'}`}
                            className="sm:hidden inline-flex items-center gap-1 h-7 px-2 rounded-md border border-dashed border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-[11px] font-bold cursor-pointer active:scale-95"
                            onClick={e => e.stopPropagation()}
                          >
                            <Camera className="w-3.5 h-3.5" aria-hidden="true" /> Photo
                            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => addRowPhoto(j.id, e.currentTarget)} />
                          </label>
                        )}
                        {/* Live worker indicators — who's clocked in right now */}
                        {activeLogs.filter(l => l.jobId === j.id).map(l => (
                          <span key={l.id} className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full" title={`${l.userName} — ${l.operation}`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                            {l.userName.split(' ')[0]}
                          </span>
                        ))}
                      </div>
                      {/* Job ID only when it says something the PO doesn't */}
                      {j.jobIdsDisplay && j.jobIdsDisplay !== j.poNumber && (
                        <span className="text-zinc-600 font-mono text-[10px] sm:text-[11px] truncate max-w-[160px] sm:max-w-none">Job {j.jobIdsDisplay}</span>
                      )}
                      {/* Below sm (< 640px): Qty + Customer + Part Details columns are
                          all hidden, so surface all three inline in the PO cell. Without
                          this, mobile users can't see quantity without opening details.
                          Qty sits in its own chip that never shrinks: inside the
                          truncated line, a long part number cut it off. */}
                      <span className="sm:hidden flex items-center gap-1.5 min-w-0 max-w-full text-xs">
                        {j.quantity ? <span className="shrink-0 font-bold text-zinc-200 font-mono tabular bg-zinc-800 px-1.5 py-0.5 rounded">Qty {Number(j.quantity).toLocaleString()}</span> : null}
                        <span className="text-zinc-400 truncate min-w-0">
                          {j.partNumber}
                          {user.role === 'admin' && j.customer ? <> · {j.customer}</> : null}
                        </span>
                      </span>
                      {/* Between sm and md (640–768px): Qty column is visible now, but
                          the Part Details column (which has customer) is still hidden.
                          Show part number + customer inline. */}
                      <span className="hidden sm:inline md:hidden text-zinc-400 text-xs truncate max-w-[260px]">
                        {j.partNumber}
                        {user.role === 'admin' && j.customer ? <> · {j.customer}</> : null}
                      </span>
                      {/* Jobs R1 badges: checklist progress + attachments + time budget */}
                      {((j.checklist?.length || 0) > 0 || (j.attachments?.length || 0) > 0 || (j.expectedHours || 0) > 0 || liveTotalHrs > 0) && (
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {(j.checklist?.length || 0) > 0 && (() => {
                            const { done, total } = stepProgress(j);
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
                          {liveTotalHrs > 0 && (() => {
                            // Clickable ⏱ chip — expands an inline per-op / per-worker
                            // time breakdown so you never have to dig through Logs.
                            const hasBudget = (j.expectedHours || 0) > 0;
                            const ratio = hasBudget ? liveTotalHrs / j.expectedHours! : 0;
                            const state = !hasBudget ? 'plain' : ratio > 1.1 ? 'over' : ratio > 0.9 ? 'near' : 'under';
                            const cls = state === 'over' ? 'text-red-400 bg-red-500/10 border-red-500/20' : state === 'near' ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' : state === 'under' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20';
                            const isOpen = timeBreakdownJobId === j.id;
                            // While someone's on it: wall-clock finish = remaining estimate ÷
                            // people running it (paused ones don't burn the clock).
                            let finishStr = '';
                            if (isLive && hasBudget && j.expectedHours! - liveTotalHrs > 0) {
                              const runningCount = Math.max(1, jobActiveLogs.filter(l => !l.pausedAt).length);
                              const finishAt = new Date(nowMs + ((j.expectedHours! - liveTotalHrs) / runningCount) * 3_600_000);
                              const t = finishAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                              finishStr = finishAt.toDateString() === new Date(nowMs).toDateString()
                                ? ` · done ~${t}`
                                : ` · done ${finishAt.toLocaleDateString([], { month: 'numeric', day: 'numeric' })}`;
                            }
                            return (
                              <button
                                onClick={e => { e.stopPropagation(); setTimeBreakdownJobId(isOpen ? null : j.id); }}
                                className={`text-[9px] font-bold border px-1.5 py-0.5 rounded tabular cursor-pointer hover:brightness-125 transition-all ${cls}`}
                                title={`${hasBudget ? `Budget: ${j.expectedHours}h · ` : ''}${isLive ? 'Live' : 'Actual'}: ${liveTotalHrs.toFixed(1)}h${isLive && liveTotalCost > 0 ? ` · $${liveTotalCost.toFixed(0)} labor so far` : ''} — click for breakdown`}
                              >
                                ⏱ {liveTotalHrs.toFixed(1)}{hasBudget ? `/${j.expectedHours}h` : 'h'}{finishStr} {isOpen ? '▴' : '▾'}
                              </button>
                            );
                          })()}
                          {(j.expectedHours || 0) > 0 && liveTotalHrs === 0 && (
                            <span className="text-[9px] font-bold text-zinc-500 bg-zinc-800/60 border border-white/5 px-1.5 py-0.5 rounded tabular" title={`Budgeted ${j.expectedHours}h`}>
                              ⏱ {j.expectedHours}h budget
                            </span>
                          )}
                        </div>
                      )}
                      {/* ── Inline time breakdown — per operation + per worker, live included ── */}
                      {timeBreakdownJobId === j.id && (() => {
                        const fmtT = (mins: number) => {
                          const h = Math.floor(mins / 60), m = Math.round(mins % 60);
                          return h > 0 ? `${h}h ${m}m` : `${m}m`;
                        };
                        // Pool completed + live sessions by operation and by worker
                        const byOp = new Map<string, { mins: number; live: boolean }>();
                        const byWorker = new Map<string, { mins: number; live: boolean }>();
                        const addTo = (map: Map<string, { mins: number; live: boolean }>, key: string, mins: number, live: boolean) => {
                          const e = map.get(key) || { mins: 0, live: false };
                          e.mins += mins; e.live = e.live || live;
                          map.set(key, e);
                        };
                        jobLogs.forEach(l => {
                          const m = logMins2(l);
                          if (m <= 0) return;
                          addTo(byOp, l.operation || 'No operation', m, false);
                          addTo(byWorker, l.userName || 'Unknown', m, false);
                        });
                        jobActiveLogs.forEach(l => {
                          const m = Math.max(0, ((l.pausedAt ?? nowMs) - l.startTime - (l.totalPausedMs || 0))) / 60_000;
                          addTo(byOp, l.operation || 'No operation', m, true);
                          addTo(byWorker, l.userName || 'Unknown', m, true);
                        });
                        const ops = [...byOp.entries()].sort((a, b) => b[1].mins - a[1].mins);
                        const wks = [...byWorker.entries()].sort((a, b) => b[1].mins - a[1].mins);
                        const sessions = jobLogs.length + jobActiveLogs.length;
                        return (
                          <div
                            className="mt-1.5 bg-zinc-900/90 border border-cyan-500/20 rounded-xl p-3 max-w-[340px] space-y-2.5"
                            onClick={e => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[9px] font-black text-cyan-400 uppercase tracking-widest">Time Worked</span>
                              <span className="text-[10px] font-mono text-zinc-500 tabular">{fmtT(liveTotalMins)} · {sessions} session{sessions !== 1 ? 's' : ''}</span>
                            </div>
                            <div>
                              <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-wider mb-1">By Operation</p>
                              {ops.map(([op, v]) => (
                                <div key={op} className="flex items-center justify-between gap-3 py-0.5">
                                  <span className="text-[11px] text-zinc-300 truncate flex items-center gap-1.5">
                                    {v.live && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />}
                                    {op}
                                  </span>
                                  <span className="text-[11px] font-bold text-white font-mono tabular shrink-0">{fmtT(v.mins)}</span>
                                </div>
                              ))}
                            </div>
                            <div className="pt-2 border-t border-white/5">
                              <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-wider mb-1">By Worker</p>
                              {wks.map(([name, v]) => (
                                <div key={name} className="flex items-center justify-between gap-3 py-0.5">
                                  <span className="text-[11px] text-zinc-300 truncate flex items-center gap-1.5">
                                    {v.live && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />}
                                    {name}
                                  </span>
                                  <span className="text-[11px] font-bold text-white font-mono tabular shrink-0">{fmtT(v.mins)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
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
                          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => addRowPhoto(j.id, e.currentTarget)} />
                        </label>
                      )}
                      <div>
                        <div className="text-zinc-300 font-bold">{j.partNumber}</div>
                        <div className="text-xs text-zinc-500 mt-0.5">{user.role === 'admin' ? j.customer : '***'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 sm:p-4 font-mono text-zinc-300 hidden sm:table-cell">{j.quantity}</td>
                  <td className="p-3 sm:p-4 hidden md:table-cell"><StatusBadge status={j.status} job={j} stages={getStages(shopSettings)} /></td>
                  <td className={`p-2 sm:p-4 sm:whitespace-nowrap text-[11px] sm:text-sm ${isOverdue ? 'text-red-400' : isDueSoon ? 'text-orange-400' : 'text-zinc-400'}`}>
                    <div className="font-mono font-bold">{fmt(j.dueDate)}</div>
                    {j.dueDate && _due !== 'closed' && _due !== 'none' && (() => {
                      // Late/today come from the shared rule (calendar days). Business
                      // days are only for the countdown: a due date that fell on a
                      // weekend counted 0 business days and read "due today" while late.
                      const bizDays = _due === 'overdue' || _due === 'today' ? null : businessDaysUntilSync(j.dueDate);
                      const isHol = j.dueDate ? isHolidaySync(j.dueDate) : false;
                      return (
                        <div className="flex flex-col gap-0.5 mt-0.5">
                          {_due === 'overdue' && <span className="text-[9px] font-bold text-red-500">{dueLabel(j.dueDate)}</span>}
                          {_due === 'today' && <span className="text-[9px] font-bold text-orange-400">due today</span>}
                          {bizDays !== null && (
                            <span className={`text-[9px] font-bold ${bizDays <= 2 ? 'text-orange-400' : 'text-zinc-600'}`}>
                              {bizDays > 0 ? `${bizDays} biz day${bizDays === 1 ? '' : 's'}` : dueLabel(j.dueDate)}
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
                                onClick={() => nextStage.isComplete
                                  // Completing goes through the one complete flow: asks the ship
                                  // date and locks the profit snapshot (this arrow skipped both).
                                  ? handleCompleteWithSnapshot(j)
                                  : confirm({
                                      title: `Advance to ${nextStage.label}`,
                                      message: `Move this job to "${nextStage.label}"?`,
                                      onConfirm: async () => {
                                        await DB.advanceJobStage(j.id, nextStage.id, user.id, user.name, false);
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
                      {/* Everyday actions stay as buttons; the rest live in the ⋯ menu
                          (nine icons per row pushed this column off the screen). */}
                      {(() => {
                        const printJob = () => setPrintable(enrichJobForPrint(j, jobs, allLogs, shopSettings.rateBuffer ?? 1.15));
                        const openRework = () => setReworkModal({ jobId: j.id, poNumber: j.poNumber, partNumber: j.partNumber, customer: j.customer, reason: 'finish', quantity: 1, status: 'open' });
                        const openReworkCount = reworkByJob.get(j.id)?.open || 0;
                        return (
                          <>
                            <button
                              aria-label={printed.includes(j.id) ? `Reprint traveler for ${j.poNumber || ''}` : `Print traveler for ${j.poNumber || ''}`}
                              onClick={printJob} className={`hidden sm:flex p-2 rounded-lg transition-colors ${printed.includes(j.id) ? 'bg-emerald-500/10 text-emerald-400' : 'hover:bg-zinc-800 text-zinc-400 hover:text-white'}`} title={printed.includes(j.id) ? 'Printed ✓ — click to reprint' : 'Print Traveler'}><Printer className="w-4 h-4" aria-hidden="true" /></button>
                            {/* Open rework stays visible — it's a signal, not just an action */}
                            {openReworkCount > 0 && (
                              <button aria-label={`Report rework for ${j.poNumber || ''} — ${openReworkCount} open`} onClick={openRework} className="p-2 hover:bg-amber-500/10 rounded-lg text-amber-400 transition-colors relative" title={`${openReworkCount} open rework — report another`}>
                                <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                                <span aria-hidden="true" className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 bg-amber-500 text-white text-[9px] font-black rounded-full flex items-center justify-center ring-2 ring-zinc-950">{openReworkCount}</span>
                              </button>
                            )}
                            <RowMenu label={`More actions for ${j.poNumber || 'job'}`} items={[
                              { label: 'Edit job', icon: <Edit2 className="w-4 h-4" />, onSelect: () => { setEditingJob(j); setShowModal(true); } },
                              { label: printed.includes(j.id) ? 'Reprint traveler' : 'Print traveler', icon: <Printer className="w-4 h-4" />, onSelect: printJob, hidden: window.innerWidth >= 640 },
                              { label: 'Report rework', icon: <AlertTriangle className="w-4 h-4" />, onSelect: openRework },
                              {
                                label: calAdded.includes(j.id) ? 'In Google Calendar ✓' : 'Add to Google Calendar', icon: <Calendar className="w-4 h-4" />, hidden: !j.dueDate,
                                onSelect: () => {
                                  const url = getCalendarUrl(j);
                                  if (!url) return;
                                  const updated = [...calAdded]; if (!updated.includes(j.id)) { updated.push(j.id); setCalAdded(updated); localStorage.setItem('cal_added_jobs', JSON.stringify(updated)); }
                                  window.location.href = url;
                                },
                              },
                              {
                                label: 'Copy customer portal link', icon: <Share2 className="w-4 h-4" />, hidden: !j.customer,
                                onSelect: () => {
                                  const url = buildPortalUrl(j.customer!, shopSettings);
                                  navigator.clipboard.writeText(url).then(() => addToast('success', 'Portal link copied!')).catch(() => prompt('Copy this link:', url));
                                },
                              },
                              { label: 'Delete job', icon: <Trash2 className="w-4 h-4" />, danger: true, onSelect: () => confirm({ title: "Delete Job", message: `Permanently delete PO ${j.poNumber || j.jobIdsDisplay || ''}?${keptHoursNote([j.id])}`, onConfirm: () => DB.deleteJob(j.id) }) },
                            ]} />
                          </>
                        );
                      })()}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredJobs.length === 0 && <tr><td colSpan={7} className="p-12 text-center text-zinc-500">No jobs found matching filters.</td></tr>}
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
                <button type="button" aria-label="Close" onClick={requestCloseJobEditor} disabled={savingJob} className="disabled:opacity-40"><X className="w-5 h-5 text-zinc-500 hover:text-white" /></button>
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
                            if (targetStage.isComplete) { await completeFromEditor(); return; }
                            moveToStage(targetStage);
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
                              if (nextStage.isComplete) { await completeFromEditor(); return; }
                              await moveEditorJob(nextStage, 'Advanced to');
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
                            onClick={() => completeFromEditor()}
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
                            if (stage.isComplete) { await completeFromEditor(); return; }
                            moveToStage(stage);
                          }}>
                            <div className={`h-3 w-full rounded-full transition-all group-hover:scale-y-125 ${isCurrent ? 'ring-2 ring-white/40 ring-offset-1 ring-offset-zinc-900' : ''}`}
                              style={{ background: isActive ? stage.color : '#27272a', opacity: isActive ? 1 : 0.3 }} />
                            <span className={`text-[9px] font-bold transition-colors ${isCurrent ? 'text-white' : isActive ? '' : 'text-zinc-600'} group-hover:text-white`}
                              style={isActive ? { color: stage.color } : {}}>{stage.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    {/* Print + share. Print is here because on a phone the job
                        list's print icon is hidden and its ⋯ menu sits off the
                        right edge of the screen. */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button type="button" onClick={() => {
                        const buf = shopSettings.rateBuffer ?? 1.15;
                        const enriched = enrichJobForPrint(editingJob as Job, jobs, allLogs, buf);
                        void printTraveler(enriched, shopSettings, { _rateBreakdown: getRateBreakdownForJob(enriched, allLogs, buf) }).then(() => {
                          try {
                            const list: string[] = JSON.parse(localStorage.getItem('printed_jobs') || '[]');
                            if (!list.includes(enriched.id)) { list.push(enriched.id); localStorage.setItem('printed_jobs', JSON.stringify(list)); }
                          } catch { /* the ✓ is a convenience */ }
                          window.dispatchEvent(new Event('printed-update'));
                        });
                      }} className="flex items-center gap-1.5 text-[11px] font-bold text-orange-300 hover:text-white bg-orange-500/15 hover:bg-orange-500/30 px-3 py-1.5 rounded-lg transition-all">
                        <Printer className="w-3.5 h-3.5" aria-hidden="true" /> {printed.includes((editingJob as Job).id) ? 'Reprint Traveler' : 'Print Traveler'}
                      </button>
                    {(editingJob as Job).customer && (
                      <>
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
                      </>
                    )}
                    </div>
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
                            // No partImage copy: the part's current photo shows automatically
                            // (photo memory), and a copied base64 would freeze an old photo onto
                            // this job and add ~126 KB to it.
                            setEditingJob({ ...editingJob, partNumber: s.partNumber, customer: s.customer || editingJob.customer, info: s.info || editingJob.info, specialInstructions: s.specialInstructions || editingJob.specialInstructions });
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

              {/* Sample-Based Estimate Banner — aggregates ALL samples for this part,
                  shows per-op breakdown with confidence level, auto-applies on qty entry. */}
              {editingJob.partNumber && (() => {
                const est = getAggregatedSampleEstimate(
                  editingJob.partNumber,
                  samples,
                  shopSettings.rateBuffer ?? 1.0,
                );
                if (!est) return null;
                const qty = editingJob.quantity || 0;
                const suggestedHrs = qty > 0 ? suggestHoursFromAggregated(est, qty) : 0;
                const alreadyApplied = editingJob.expectedHours === suggestedHrs && suggestedHrs > 0;
                const confidenceLabel = est.confidence === 'high' ? '🟢 High confidence' : est.confidence === 'medium' ? '🟡 Medium confidence' : '🔴 Low confidence — run more samples';
                const confidenceColor = est.confidence === 'high' ? 'text-emerald-400' : est.confidence === 'medium' ? 'text-amber-400' : 'text-red-400';
                return (
                  <div className="bg-gradient-to-br from-cyan-500/10 to-teal-500/5 border border-cyan-500/25 rounded-2xl p-4 sm:p-5 space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-cyan-500/20 flex items-center justify-center shrink-0">
                          <Beaker className="w-4 h-4 text-cyan-400" aria-hidden="true" />
                        </div>
                        <div>
                          <p className="text-xs font-black text-cyan-400 uppercase tracking-widest">Sample Data — {editingJob.partNumber}</p>
                          <p className="text-xs text-zinc-400 mt-0.5">
                            {est.sampleCount} sample{est.sampleCount !== 1 ? 's' : ''} · {est.totalPieces} pcs timed · {est.rawMinPerPc.toFixed(2)} min/pc raw
                            {est.rateBuffer !== 1.0 && <span className="text-amber-400/70"> → {est.minPerPc.toFixed(2)} buffered ({((est.rateBuffer - 1) * 100).toFixed(0)}%)</span>}
                          </p>
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold shrink-0 ${confidenceColor}`}>{confidenceLabel}</span>
                    </div>

                    {/* Per-operation breakdown */}
                    <div className="rounded-xl overflow-hidden border border-cyan-500/15">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-cyan-500/10">
                            <th className="text-left px-3 py-2 text-cyan-400/70 font-bold uppercase tracking-wide">Operation</th>
                            <th className="text-right px-3 py-2 text-cyan-400/70 font-bold uppercase tracking-wide">Min/pc</th>
                            <th className="text-right px-3 py-2 text-cyan-400/70 font-bold uppercase tracking-wide">Sample qty</th>
                            {qty > 0 && <th className="text-right px-3 py-2 text-cyan-400/70 font-bold uppercase tracking-wide">Est @ {qty.toLocaleString()} pcs</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {est.breakdown.map((op, i) => {
                            const opHrs = qty > 0 ? Math.round((op.minPerPc * qty / 60) * 10) / 10 : null;
                            return (
                              <tr key={op.operation} className={i % 2 === 0 ? 'bg-black/20' : 'bg-black/10'}>
                                <td className="px-3 py-2 text-white font-medium">{op.operation}</td>
                                <td className="px-3 py-2 text-amber-400 font-bold tabular-nums text-right">{op.minPerPc.toFixed(2)}</td>
                                <td className="px-3 py-2 text-zinc-400 tabular-nums text-right">{op.qty} pcs</td>
                                {qty > 0 && <td className="px-3 py-2 text-cyan-300 font-bold tabular-nums text-right">{opHrs}h</td>}
                              </tr>
                            );
                          })}
                          {qty > 0 && est.breakdown.length > 1 && (
                            <tr className="border-t border-cyan-500/20 bg-cyan-500/5">
                              <td className="px-3 py-2 text-cyan-400 font-black">TOTAL</td>
                              <td className="px-3 py-2 text-amber-400 font-black tabular-nums text-right">{est.minPerPc.toFixed(2)}</td>
                              <td />
                              <td className="px-3 py-2 text-cyan-400 font-black tabular-nums text-right">{suggestedHrs}h</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Apply button */}
                    {qty > 0 && suggestedHrs > 0 && (
                      <button
                        type="button"
                        onClick={() => setEditingJob({ ...editingJob, expectedHours: suggestedHrs })}
                        className={`w-full flex items-center justify-between gap-2 border rounded-xl p-3 transition-colors ${alreadyApplied ? 'bg-cyan-500/20 border-cyan-400/40 cursor-default' : 'bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-500/25'}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-base">{alreadyApplied ? '✅' : '🧪'}</span>
                          <span className="text-sm text-white font-bold">
                            {alreadyApplied ? 'Applied — ' : 'Apply sample estimate: '}
                            <strong className="text-cyan-400">{suggestedHrs}h</strong>
                            <span className="text-zinc-500 text-xs font-normal"> for {qty.toLocaleString()} pcs</span>
                          </span>
                        </div>
                        {!alreadyApplied && <span className="text-[10px] font-bold text-cyan-400 shrink-0">Apply →</span>}
                      </button>
                    )}
                    {qty === 0 && (
                      <p className="text-xs text-zinc-500 text-center py-1">Enter a quantity to see the estimated hours</p>
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
                  <div><label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Date Received</label><DateInput className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-emerald-500/50" value={toDateInput(editingJob.dateReceived)} onChange={v => setEditingJob(prev => ({ ...prev, dateReceived: v }))} /></div>
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Due Date</label>
                    {/* DateInput: typing the year no longer blanks the field or saves "0002-…" */}
                    <DateInput className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-emerald-500/50"
                      value={toDateInput(editingJob.dueDate)}
                      onChange={v => setEditingJob(prev => ({ ...prev, dueDate: v }))} />
                    {/* The first promise is kept when a date moves — reschedules no
                        longer erase what the customer was originally told. */}
                    {editingJob.originalDueDate && normDate(editingJob.originalDueDate) !== normDate(editingJob.dueDate) && (
                      <p className="text-[11px] text-amber-300/80 mt-1.5 ml-1">
                        Originally promised {fmt(editingJob.originalDueDate)}
                        {(editingJob.dueDateHistory?.length || 0) > 0 && ` · moved ${editingJob.dueDateHistory!.length}×`}
                      </p>
                    )}
                    {!editingJob.dueDate && editingJob.status !== 'completed' && (
                      <p className="text-[11px] text-red-400/90 mt-1.5 ml-1">No due date — set one so this job shows up in overdue tracking.</p>
                    )}
                  </div>
                  {editingJob.id && editingJob.status === 'completed' && (
                    <div>
                      <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Shipped On</label>
                      <DateInput className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-emerald-500/50"
                        value={(() => { const t = editingJob.shippedAt || editingJob.completedAt; if (!t) return ''; const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })()}
                        max={(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })()}
                        onChange={v => {
                          const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                          if (!m) return;
                          shipDirtyRef.current = true;
                          setEditingJob(prev => ({ ...prev, shippedAt: new Date(+m[1], +m[2] - 1, +m[3], 12).getTime() }));
                        }} />
                      <p className="text-[11px] text-zinc-500 mt-1.5 ml-1">
                        {editingJob.shippedAt ? 'On-time is judged by this date.' : 'Not recorded — using the day it was marked complete. Fix it here if it shipped earlier.'}
                      </p>
                    </div>
                  )}
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
                      {/* Suggestions from the client list, but a new customer can still be
                          typed (the strict dropdown couldn't take one, and showed a job
                          whose customer wasn't on the list as blank). */}
                      <input
                        list="job-customer-options"
                        autoComplete="off"
                        className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-orange-500/50"
                        value={editingJob.customer || ''}
                        onChange={e => { const customer = e.target.value; setEditingJob(prev => ({ ...prev, customer })); }}
                        placeholder={allClients.length ? 'Start typing — pick from your clients' : 'Client or Company Name'}
                      />
                      <datalist id="job-customer-options">
                        {allClients.map(c => <option key={c} value={c} />)}
                      </datalist>
                      {allClients.length === 0 && <p className="text-xs text-zinc-500 mt-1">💡 Add clients in <span className="text-purple-400 font-bold">Settings → Clients</span> to get a dropdown here.</p>}
                    </div>
                  )}
                  <div><label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Priority Level</label><select className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-orange-500/50" value={editingJob.priority || 'normal'} onChange={e => setEditingJob({ ...editingJob, priority: e.target.value as any })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
                </div>

                {/* Green/Yellow/Red — live risk read on whatever's typed, crew
                    experience, and the manual override. */}
                <RiskCrewPanel
                  job={editingJob}
                  index={adminRiskIndex}
                  onChange={patch => setEditingJob(prev => ({ ...prev, ...patch }))}
                />
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
                    <input type="number" step="0.5" min="0" className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 pl-9 text-white font-mono text-lg outline-none focus:ring-2 focus:ring-emerald-500/50" value={editingJob.expectedHours || ''} onChange={e => setEditingJob({ ...editingJob, expectedHours: Math.max(0, Number(e.target.value) || 0) })} placeholder="0" />
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
                    <p className="text-[10px] text-zinc-600 mt-1">Abrasives, media, consumables used. On a finished job, changing it updates the job's locked profit.</p>
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
                ticks={jobs.find(x => x.id === editingJob.id)?.checklistTicks}
                operations={ops}
                onUpdate={(items) => { checklistDirtyRef.current = true; setEditingJob(prev => ({ ...prev, checklist: items })); }}
                onTick={editingJob.id ? (item, done) => {
                  DB.setChecklistTick(editingJob.id!, item.id, { done, by: user?.id || '', name: user?.name || '', at: Date.now() })
                    .catch(() => addToast('error', "Couldn't save that tick — check the internet and try again"));
                } : undefined}
              />

              {/* ── Attachments / Blueprints — always visible, saved with job ── */}
              <JobAttachmentsSection
                job={editingJob as Job}
                onUpdate={(atts) => { attachmentsDirtyRef.current = true; setEditingJob(prev => ({ ...prev, attachments: typeof atts === 'function' ? atts(prev.attachments || []) : atts })); }}
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
                {(() => {
                  // Three honest states: this job's own photo, the part's photo on
                  // file from another run (shown automatically, can't be "removed"
                  // from here — it isn't this job's), or nothing yet.
                  const own = editingJob.partImage && !editingJob.photoInherited ? editingJob.partImage : null;
                  const onFile = own ? null
                    : editingJob.photoInherited && editingJob.partImage
                      ? { url: editingJob.partImage, po: editingJob.photoFromPo || '' }
                      : DB.partPhotoFor(jobs, editingJob.partNumber, editingJob.id);
                  if (own) return (
                    <div className="flex items-start gap-4">
                      <div className="relative">
                        <img src={own} alt="Part" className="w-32 h-32 object-cover rounded-xl border-2 border-cyan-500/30 cursor-pointer hover:border-cyan-400 transition-all" onClick={() => setLightboxImg(own)} />
                        <button type="button" aria-label="Remove photo"
                          onClick={() => { photoDirtyRef.current = true; setEditingJob(prev => ({ ...prev, partImage: undefined })); }}
                          className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-400 text-white rounded-full p-1.5 shadow-lg"><X className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="flex flex-col gap-2">
                        <button type="button" onClick={() => imageInputRef.current?.click()} className="text-xs text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1"><Camera className="w-3.5 h-3.5" /> Replace Photo</button>
                        <p className="text-[10px] text-zinc-600">Tap the photo to enlarge.</p>
                      </div>
                    </div>
                  );
                  if (onFile) return (
                    <div className="flex items-start gap-4">
                      <img src={onFile.url} alt="Part photo on file" className="w-32 h-32 object-cover rounded-xl border-2 border-dashed border-cyan-500/25 cursor-pointer opacity-90" onClick={() => setLightboxImg(onFile.url)} />
                      <div className="flex flex-col gap-2 min-w-0">
                        <p className="text-xs text-zinc-400 leading-snug">
                          <span className="font-bold text-zinc-200">Photo on file</span> for this part{onFile.po ? ` (from PO ${onFile.po})` : ''} — shown on this job automatically.
                        </p>
                        <button type="button" onClick={() => imageInputRef.current?.click()} className="text-xs text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1"><Camera className="w-3.5 h-3.5" /> Take a new photo</button>
                      </div>
                    </div>
                  );
                  return (
                    <button type="button" onClick={() => imageInputRef.current?.click()}
                      className="w-full border-2 border-dashed border-cyan-500/20 hover:border-cyan-500/40 rounded-xl p-6 flex flex-col items-center gap-2 text-cyan-400/60 hover:text-cyan-400 transition-all group">
                      <Camera className="w-8 h-8 group-hover:scale-110 transition-transform" />
                      <span className="font-bold text-sm">Add Part Photo</span>
                      <span className="text-[10px] text-zinc-600">Take a photo or upload from gallery</span>
                    </button>
                  );
                })()}
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
              <button onClick={requestCloseJobEditor} disabled={savingJob} className="px-6 py-3 text-zinc-400 hover:text-white font-medium transition-colors disabled:opacity-40">Cancel</button>
              <button onClick={handleSave} disabled={savingJob} aria-busy={savingJob} className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 disabled:opacity-60 disabled:cursor-wait text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-amber-900/20 flex items-center gap-2 transition-all">
                {savingJob ? 'Saving…' : editingJob.id ? <><Save className="w-4 h-4" /> Save Changes</> : <>Create Job <ArrowRight className="w-4 h-4" /></>}
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
            // Only a NEW job being filled in takes the scan. An existing job is
            // never the target — that saved the scanned PO over it.
            setEditingJob(prev => (prev.id ? { ...patch } : { ...prev, ...patch }));
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
      {reworkModal && <React.Suspense fallback={null}><ReworkModal entry={reworkModal} jobs={jobs} user={user} onClose={() => setReworkModal(null)} addToast={addToast} /></React.Suspense>}
      {PromptHost}
      {JobCompletePromptHost}
      {ShipDateHost}
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
const AdminEmployees = ({ addToast, confirm, currentUser }: { addToast: any, confirm: any, currentUser?: User | null }) => {
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

  // Managers run the floor but don't manage admins: they can't edit or remove
  // an admin, or make anyone — themselves included — an admin. And nobody can
  // remove, switch off or demote themselves or the last admin (there'd be no
  // way back in the app).
  const isAdmin = currentUser?.role === 'admin';
  const activeAdmins = users.filter(u => u.role === 'admin' && u.isActive !== false);
  const canManage = (u: Partial<User>) => isAdmin || u.role !== 'admin';
  const roleChoices: ('employee' | 'manager' | 'admin')[] = isAdmin ? ['employee', 'manager', 'admin'] : ['employee', 'manager'];

  const handleDelete = (u: User) => {
    if (u.id === currentUser?.id) { addToast('error', "You can't remove your own account — ask another admin."); return; }
    if (!canManage(u)) { addToast('error', 'Only an admin can remove an admin.'); return; }
    if (u.role === 'admin' && u.isActive !== false && activeAdmins.length <= 1) { addToast('error', "That's the last admin — make someone else an admin first."); return; }
    confirm({
      title: 'Remove User',
      message: `Remove ${u.name}? Their time history stays in the reports. This cannot be undone.`,
      onConfirm: () => DB.deleteUser(u.id)
    });
  };

  const openNew = () => { setEditingUser({ role: 'employee', isActive: true }); setWizardStep(1); setShowModal(true); };
  // The PIN field starts EMPTY when editing — a member's PIN is never shown
  // (leave it blank to keep it, or type a new one).
  const openEdit = (u: User) => {
    if (!canManage(u)) { addToast('error', 'Only an admin can edit an admin.'); return; }
    setEditingUser({ ...u, pin: '' }); setWizardStep(2); setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditingUser({}); setWizardStep(1); };

  // Auto-generate next available employee ID (EMP-001, EMP-002, ...)
  const nextEmployeeId = () => {
    const existing = users.map(u => u.employeeId).filter(Boolean) as string[];
    const nums = existing.map(id => parseInt(id.replace(/^\D+/, ''), 10)).filter(n => !isNaN(n));
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    return `EMP-${String(next).padStart(3, '0')}`;
  };

  // One save at a time: a second click while the first was still saving made
  // a second member with the same username, PIN and employee number.
  const savingUserRef = useRef(false);
  const [savingUser, setSavingUser] = useState(false);
  // The new member's id is made once per form, so a retry overwrites, never duplicates.
  const newUserIdRef = useRef<string>('');
  const handleSave = async () => {
    if (savingUserRef.current) return;
    savingUserRef.current = true;
    setSavingUser(true);
    try { await saveMember(); } finally { savingUserRef.current = false; setSavingUser(false); }
  };
  const saveMember = async () => {
    const original = editingUser.id ? users.find(u => u.id === editingUser.id) : undefined;
    const typedPin = (editingUser.pin || '').trim();
    const pin = typedPin || original?.pin || '';   // blank when editing = keep the PIN
    if (!editingUser.name || !editingUser.username || !pin) { addToast('error', 'Missing fields'); return; }
    if (typedPin && typedPin.length < 4) { addToast('error', 'PIN must be at least 4 digits'); return; }
    if (users.some(u => u.username.toLowerCase() === editingUser.username!.toLowerCase() && u.id !== editingUser.id)) {
      addToast('error', 'Username already taken');
      return;
    }
    if (typedPin && users.some(u => u.pin === typedPin && u.id !== editingUser.id)) {
      addToast('error', 'PIN already in use by another member');
      return;
    }
    if (editingUser.hourlyRate !== undefined && editingUser.hourlyRate < 0) {
      addToast('error', 'Hourly rate cannot be negative');
      return;
    }
    const role = editingUser.role || 'employee';
    const isActive = editingUser.isActive !== false;
    if (!isAdmin && (role === 'admin' || original?.role === 'admin')) {
      addToast('error', 'Only an admin can make or change an admin.'); return;
    }
    if (original && original.id === currentUser?.id && (role !== original.role || !isActive)) {
      addToast('error', "You can't change your own role or switch yourself off — ask another admin."); return;
    }
    if (original?.role === 'admin' && original.isActive !== false && (role !== 'admin' || !isActive) && activeAdmins.length <= 1) {
      addToast('error', "That's the last admin — make someone else an admin first."); return;
    }
    if (!editingUser.id && !newUserIdRef.current) newUserIdRef.current = crypto.randomUUID();
    const newUser: User = {
      id: editingUser.id || newUserIdRef.current,
      employeeId: editingUser.employeeId || nextEmployeeId(),
      name: editingUser.name,
      username: editingUser.username,
      pin,
      role,
      isActive,
      hourlyRate: editingUser.hourlyRate || undefined,
    };
    let result: 'saved' | 'queued' | void;
    try {
      // A rate cleared in the editor is deleted (a merge save would keep the old one).
      result = await DB.saveUser(newUser, { clear: original?.hourlyRate && !newUser.hourlyRate ? ['hourlyRate'] : [] });
    } catch (e: any) {
      addToast('error', 'Save failed: ' + (e?.message || 'Unknown error'));
      return;
    }
    newUserIdRef.current = '';
    closeModal();
    if (result === 'queued') addToast('info', `${newUser.name} saved on this device — it syncs when the internet is back.`);
    else addToast('success', `${editingUser.id ? 'Updated' : 'Welcome'} ${newUser.name} (${newUser.employeeId})`);
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
                    {canManage(u) && (
                      <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                        <button aria-label={`Edit ${u.name}`} onClick={() => openEdit(u)} className="p-1.5 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors" title="Edit"><Edit2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
                        {u.id !== currentUser?.id && (
                          <button aria-label={`Remove ${u.name}`} onClick={() => handleDelete(u)} className="p-1.5 hover:bg-red-500/10 rounded-lg text-zinc-500 hover:text-red-400 transition-colors" title="Remove"><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
                        )}
                      </div>
                    )}
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
                  {roleChoices.map(r => {
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
                      <div className={`grid ${roleChoices.length === 3 ? 'grid-cols-3' : 'grid-cols-2'} gap-2`}>
                        {roleChoices.map(r => {
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
                      <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">{isEditing ? 'New PIN' : 'PIN (4+ digits)'}</label>
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
                    {isEditing && <p className="text-[10px] text-zinc-600 mt-1.5">Leave blank to keep their current PIN.</p>}
                  </div>
                  {(editingUser.role === 'admin' || editingUser.role === 'manager' || editingUser.role === 'employee') && (
                    <div>
                      <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Hourly Rate <span className="text-zinc-600 normal-case font-normal">— used for job costing, hidden from workers</span></label>
                      <div className="relative">
                        <span aria-hidden="true" className="absolute left-4 top-3 text-zinc-500">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
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
                            <p className="text-white font-mono tracking-[0.2em] mt-0.5">{'•'.repeat(editingUser.pin?.length || 4)}</p>
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
                onClick={() => !isEditing && wizardStep > 1 ? setWizardStep(wizardStep - 1) : closeModal()}
                className="px-4 py-2.5 text-zinc-400 hover:text-white font-medium transition-colors"
              >
                {wizardStep === 1 || isEditing ? 'Cancel' : 'Back'}
              </button>
              {isEditing || wizardStep === 4 ? (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={savingUser}
                  className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-amber-900/30 flex items-center gap-2 transition-all disabled:opacity-60"
                >
                  <Save className="w-4 h-4" aria-hidden="true" />
                  {savingUser ? 'Saving…' : isEditing ? 'Save Changes' : 'Invite Member'}
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
// It is a real error boundary now: it reloads only when the TV screen itself
// crashed. It used to treat ANY background error — a failed sound, a dropped
// network request, a browser extension — as a crash and blank the wall with
// "Reconnecting…" and a reload, which is one way a TV "switched out" mid-day.
class TvAutoReload extends React.Component<{ children: React.ReactNode }, { crashed: boolean; countdown: number }> {
  state = { crashed: false, countdown: 10 };
  private timer: number | undefined;
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(err: unknown) {
    console.error('[FabTrack TV] screen crashed — reloading', err);
    setTvExitReason(`screen error: ${String((err as any)?.message || err).slice(0, 120)}`);
  }
  componentDidUpdate(_p: unknown, prev: { crashed: boolean }) {
    if (this.state.crashed && !prev.crashed) {
      this.timer = window.setInterval(() => {
        this.setState(s => {
          if (s.countdown <= 1) window.location.reload();
          return { countdown: s.countdown - 1 };
        });
      }, 1000);
    }
  }
  componentWillUnmount() { if (this.timer) window.clearInterval(this.timer); }
  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center gap-6 text-white">
        <div className="text-6xl animate-pulse">📡</div>
        <h1 className="text-3xl font-black">Reconnecting…</h1>
        <p className="text-zinc-400 text-lg">Display will refresh in <span className="text-white font-bold">{this.state.countdown}s</span></p>
        <button onClick={() => window.location.reload()} className="mt-2 px-6 py-3 bg-amber-600 hover:bg-amber-500 rounded-xl font-bold text-sm">Reload now</button>
      </div>
    );
  }
}

export default function App() {
  // ── TV screen detection ─────────────────────────────────────────────
  // "/tv" is the one address a wall TV needs: it remembers its link after a
  // one-time pairing code. Older "?tv=TOKEN" links keep working. A TV browser
  // that restarts on "/" with a saved link goes straight back to the board.
  // "&preview=1" (Settings → Preview) shows the board without saving anything.
  const [tvRoute] = useState<{ active: boolean; token: string | null }>(() => {
    const params = new URLSearchParams(window.location.search);
    const isTvPath = /^\/tv\/?$/.test(window.location.pathname);
    const preview = params.get('preview') === '1';
    const urlToken = params.get('tv');
    const realUrlToken = urlToken && urlToken !== '1' ? urlToken : null;   // "1" was the old placeholder
    // The board saves a link only once it checks out against the shop's
    // settings (LiveFloorMonitor) — saving the address's link here let an
    // outdated home-page link overwrite a TV's newer one at every power-on.
    const saved = getSavedTvToken();
    if (isTvPath || urlToken) return { active: true, token: realUrlToken || (preview ? null : saved) };
    if (saved) {
      try { history.replaceState({}, '', `/tv?tv=${encodeURIComponent(saved)}`); } catch {}
      return { active: true, token: saved };
    }
    return { active: false, token: null };
  });
  const tvToken = tvRoute.token;

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

  // The saved session never holds the PIN or pay rate (it used to store the
  // whole user record in localStorage, readable by anyone at that device).
  const toSession = (u: User | null): User | null => {
    if (!u) return null;
    const { pin: _pin, hourlyRate: _rate, ...safe } = u as any;
    return safe as User;
  };
  const [user, setUser] = useState<User | null>(() => {
    try { return toSession(JSON.parse(localStorage.getItem('nexus_user') || 'null')); }
    catch (e) { return null; }
  });

  // Re-check the saved session against the server once per app load. A
  // deleted or deactivated account is logged out (it used to stay logged in
  // forever), and the role always comes from the server — editing the
  // saved session can no longer turn a worker into an admin.
  const sessionCheckedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user || sessionCheckedRef.current === user.id) return;
    sessionCheckedRef.current = user.id;
    DB.verifySessionUser(user.id).then(res => {
      if (res.status === 'gone') {
        DB.removeThisDevicePush();
        setUser(null);
        addToast('error', 'Your account is no longer active — please sign in again.');
      } else if (res.status === 'ok' && (res.user.role !== user.role || res.user.name !== user.name)) {
        setUser(prev => prev ? { ...prev, role: res.user.role, name: res.user.name } : prev);
      }
    });
  }, [user?.id]);

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
  // Palette job pick → the job's full Story (timeline modal) right here at root.
  const [storyJob, setStoryJob] = useState<Job | null>(null);
  const { permission, requestPermission, alerts, markRead, markAllRead, clearAll } = useNotifications(allJobs, allActiveLogs, user, allFullLogs);

  // Subscribe globally for notification checks + settings.
  // Keyed on user?.id (not []) so the subscription re-attaches after
  // handleLogout wipes the multicast cache.
  useEffect(() => {
    const unsubS = DB.subscribeSettings(s => setAppSettings(s));
    return unsubS;
  }, [user?.id]);
  useEffect(() => {
    if (!user) return;
    const unsub1 = DB.subscribeJobs(jobs => setAllJobs(jobs));
    const unsub2 = DB.subscribeLogs(logs => {
      setAllActiveLogs(logs.filter((l: TimeLog) => !l.endTime));
      setAllFullLogs(logs);
    });
    return () => { unsub1(); unsub2(); };
  }, [user]);

  // ── One-time photo migration ─────────────────────────────────────────
  // Recovers sample photos that were saved as base64 in localStorage during
  // the period when dbInstance was incorrectly nulled on startup (now fixed).
  // Uploads them to Firebase Storage so all devices can see them.
  // Runs once after login; safe to re-run (no-ops if already migrated).
  useEffect(() => {
    if (!user) return;
    // Small delay to let Firestore connection settle before issuing reads
    const t = setTimeout(() => DB.migrateLocalPhotosToFirestore(), 3000);
    // Move legacy base64 part images out of job docs → Storage URLs (capped
    // per run; admin devices only so ten floor iPads don't all race it).
    const isStaff = user.role === 'admin' || user.role === 'manager';
    const t2 = isStaff ? setTimeout(() => DB.migrateJobPartImagesToStorage(), 8000) : null;
    return () => { clearTimeout(t); if (t2) clearTimeout(t2); };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
      localStorage.setItem('nexus_user', JSON.stringify(toSession(user)));
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
    setToasts(p => [...p, { id: Date.now().toString() + Math.random().toString(36).slice(2, 5), type, message }]);
  }, []);

  // A change saved on this device (offline) that the server later refused —
  // too big, or its record deleted elsewhere. Firestore quietly rolls it back,
  // so say so instead of letting the edit just disappear.
  useEffect(() => {
    const onFail = (e: Event) => {
      const reason = (e as CustomEvent).detail?.reason || 'the server rejected it';
      addToast('error', `A change made while offline didn't save — ${reason}. Please check it and enter it again.`);
    };
    window.addEventListener(DB.SYNC_FAILED_EVENT, onFail);
    return () => window.removeEventListener(DB.SYNC_FAILED_EVENT, onFail);
  }, [addToast]);

  // Logout (PIN sign-out on the same shop). The shared listeners are NOT torn
  // down: everyone in the shop sees the same jobs and logs, and they close by
  // themselves after a while idle (mockDb multicast linger). Tearing them down
  // here made every sign-in on a shared tablet re-read all jobs and logs.
  // A tenant switch / account sign-out still clears them (AuthContext).
  const handleLogout = useCallback(() => {
    // This device stops getting the signed-out person's pushes (fire-and-forget;
    // the next person to sign in re-registers it as theirs).
    DB.removeThisDevicePush();
    setUser(null);
  }, []);

  // Auto lunch pause — only on the shop's own screens (signed-in staff, the
  // wall TV), never on a customer's portal page or the sign-in screen.
  useAutoLunch(addToast, !portalCustomer && (!!user || tvRoute.active));

  // Theme effect — apply light/dark class to body.
  // Keyed on user?.id so it re-subscribes after logout wipes the multicast cache.
  useEffect(() => {
    const unsub = DB.subscribeSettings((s) => {
      if (s.theme === 'light') { document.body.classList.add('light-theme'); }
      else { document.body.classList.remove('light-theme'); }
    });
    return unsub;
  }, [user?.id]);

  // Auto clock-out sweep: runs on mount + every 5 minutes. Each run costs at
  // least one database read on every open screen even when nothing is open,
  // and the stop time it records is the cutoff itself — so a minute-by-minute
  // sweep spent ~1,440 reads per screen per day for no extra accuracy.
  useEffect(() => {
    DB.sweepStaleLogs().catch(e => console.warn('[auto-clock-out] sweep failed:', e));
    const id = setInterval(() => {
      DB.sweepStaleLogs().catch(e => console.warn('[auto-clock-out] sweep failed:', e));
    }, 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(p => p.filter(x => x.id !== id));
  }, []);

  // ── Customer Portal Mode ──
  // Standalone TV mode — no login needed, loads account data via token
  if (tvRoute.active) {
    return <TvAutoReload><LiveFloorMonitor standalone tvToken={tvToken} /></TvAutoReload>;
  }

  if (portalCustomer) {
    // The portal resolves a ?c= short link itself once settings load.
    return <CustomerPortal customerFilter={portalCustomer} quoteId={portalQuoteId} slug={new URLSearchParams(window.location.search).get('portal') ? null : new URLSearchParams(window.location.search).get('c')} />;
  }

  if (!user || view === 'login') {
    return (
      <>
        <PrintStyles />
        <LoginView onLogin={u => setUser(toSession(u))} addToast={addToast} />
        <div className="fixed bottom-4 left-4 right-4 sm:left-auto z-[1300] pointer-events-none">
          <div className="pointer-events-none flex flex-col items-stretch sm:items-end gap-2">
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
      { id: 'admin-customers',       l: 'Customers',  i: Users },
      { id: 'admin-customer-pos',    l: 'Customer POs', i: FileText },
      { id: 'admin-purchase-orders', l: 'Purchasing', i: Package },
      { id: 'admin-deliveries',      l: 'Deliveries', i: Truck },
    ]},
    { label: 'Quality & Ops', items: [
      { id: 'admin-quality',   l: 'Quality',      i: AlertTriangle },
      { id: 'admin-logs',      l: 'Logs',         i: History },
      { id: 'admin-scan',      l: 'Work Station', i: ScanLine },
    ]},
    { label: 'Admin', items: [
      { id: 'admin-weekly',    l: 'Weekly Report', i: FileText },
      { id: 'admin-reports',   l: 'Reports',      i: Calculator },
      { id: 'admin-pricing',   l: 'Pricing',      i: DollarSign },
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

  // app-shell = the VISIBLE screen height (index.html). Plain 100vh (h-screen)
  // is taller than the visible area on iPhone/iPad, so the page itself could
  // scroll behind the content — typing in a field scrolled "the background".
  return (
    <div className="app-shell bg-zinc-950 text-zinc-100 flex flex-col font-sans">
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

            {/* Quick-Jump — visible entry point for the Cmd+K palette */}
            <div className={`${sidebarCollapsed ? 'md:px-2 px-3' : 'px-3'}`}>
              <button
                onClick={() => { setPaletteOpen(true); setSidebarOpen(false); }}
                aria-label="Search everything (Ctrl+K)"
                className={`w-full flex items-center gap-2.5 rounded-xl border border-white/10 bg-zinc-900/60 hover:bg-zinc-800 hover:border-white/20 text-zinc-500 hover:text-zinc-300 transition-all ${sidebarCollapsed ? 'md:justify-center md:px-0 md:py-2.5 px-3.5 py-2.5' : 'px-3.5 py-2.5'}`}
              >
                <Search className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className={`text-xs font-bold flex-1 text-left ${sidebarCollapsed ? 'md:hidden' : ''}`}>Search…</span>
                <kbd className={`text-[9px] font-bold border border-white/10 rounded px-1.5 py-0.5 ${sidebarCollapsed ? 'md:hidden' : ''}`}>Ctrl K</kbd>
              </button>
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
                onClick={handleLogout}
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
              <span className="truncate max-w-[45vw] uppercase">{appSettings.companyName || 'FabTrack IO'}</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Quick-Jump — search any job / customer / PO / screen */}
              <button
                aria-label="Search everything"
                onClick={() => setPaletteOpen(true)}
                className="p-2.5 rounded-xl border min-h-[44px] min-w-[44px] flex items-center justify-center active:scale-95 transition-all bg-zinc-800/80 border-white/10 text-zinc-300 hover:text-white hover:bg-zinc-700"
              >
                <Search className="w-5 h-5" aria-hidden="true" />
              </button>
              {/* Settings — one tap (was buried at the bottom of the drawer). Admin-only, like the sidebar entry. */}
              {user?.role === 'admin' && <button
                aria-label="Settings"
                onClick={() => setView('admin-settings')}
                className={`p-2.5 rounded-xl border min-h-[44px] min-w-[44px] flex items-center justify-center active:scale-95 transition-all ${view === 'admin-settings' ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'bg-zinc-800/80 border-white/10 text-zinc-300 hover:text-white hover:bg-zinc-700'}`}
              >
                <Settings className="w-5 h-5" aria-hidden="true" />
              </button>}
              <NotificationBell permission={permission} requestPermission={requestPermission} userId={user?.id} alerts={alerts} markRead={markRead} markAllRead={markAllRead} clearAll={clearAll} />
            </div>
          </div>
        )}

        <div className="p-4 md:p-8 pb-24 md:pb-8">
          <ViewErrorBoundary>
          <React.Suspense fallback={<ViewLoader />}>
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
          {view === 'admin-team' && <AdminEmployees addToast={addToast} confirm={setConfirm} currentUser={user} />}
          {/* Settings are admin-only (the sidebar already hid them from managers;
              the phone header button and in-app links didn't). */}
          {view === 'admin-settings' && (user?.role === 'admin'
            ? <SettingsView addToast={addToast} userId={user?.id} />
            : <div className="max-w-md mx-auto mt-16 text-center px-4">
                <p className="text-lg font-bold text-white">Settings are for the shop admin</p>
                <p className="text-sm text-zinc-400 mt-2">Ask the owner to change shop settings.</p>
              </div>)}
          {view === 'admin-weekly' && <WeeklyReportView />}
          {view === 'admin-reports' && <ReportsView />}
          {view === 'admin-live' && <LiveFloorMonitor user={user} onBack={() => setView('admin-dashboard')} addToast={addToast} />}
          {view === 'admin-samples' && (
            <FeatureGate feature="samples">
              <SamplesView addToast={addToast} currentUser={user ? { id: user.id, name: user.name } : null} />
            </FeatureGate>
          )}
          {view === 'admin-customer-pos' && user && <CustomerPosView addToast={addToast} confirm={setConfirm} user={{ id: user.id, name: user.name }} />}
          {view === 'admin-customers' && user && <CustomersView addToast={addToast} />}
          {view === 'admin-pricing' && user && <PricingView addToast={addToast} />}
          {view === 'admin-quotes' && user && <QuotesView addToast={addToast} user={{ id: user.id, name: user.name }} onJobCreate={async (data) => {
            // A job already made from this quote (on any device) is reused, never
            // duplicated — e.g. when linking it back to the quote failed last time.
            const existing = data.linkedQuoteId ? allJobs.find(j => j.linkedQuoteId === data.linkedQuoteId) : undefined;
            if (existing) return existing.id;
            const jobId = `JOB-${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            await DB.saveJob({
              id: jobId,
              jobIdsDisplay: `J-${jobId.slice(-6)}`,
              poNumber: data.poNumber,
              partNumber: data.partNumber,
              customer: data.customer,
              quantity: data.quantity,
              // The app's one date format (MM/DD/YYYY) — these were stored as
              // "10/5/2026" and as typed, which date sorting can misread.
              dateReceived: todayFmt(),
              dueDate: normDate(data.dueDate) || '',
              info: data.info,
              status: 'pending',
              createdAt: Date.now(),
              quoteAmount: data.quoteAmount,
              linkedQuoteId: data.linkedQuoteId,
              // Routing (Round 2 #7): when the quote used Process Library items, pick the matching stage
              ...(data.initialStageId ? { currentStage: data.initialStageId } : {}),
            } as any);
            return jobId; // so the quote can record linkedJobId + block duplicate creation
          }} />}
          {view === 'admin-scan' && <EmployeeDashboard user={user} addToast={addToast} onLogout={() => setView('admin-dashboard')} notifBell={<NotificationBell permission={permission} requestPermission={requestPermission} userId={user?.id} alerts={alerts} markRead={markRead} markAllRead={markAllRead} clearAll={clearAll} />} />}
          {view === 'employee-scan' && <EmployeeDashboard user={user} addToast={addToast} onLogout={handleLogout} notifBell={<NotificationBell permission={permission} requestPermission={requestPermission} userId={user?.id} alerts={alerts} markRead={markRead} markAllRead={markAllRead} clearAll={clearAll} />} />}
          </React.Suspense>
          </ViewErrorBoundary>
        </div>
      </main>

     {/* AI POScanner removed — kept the file in repo so we can re-enable
         later as a Shop OS-tier feature. For now, manual entry is faster
         and free vs. paying Gemini per scan. */}
            {/* Above every dialog (editor z-200, confirms z-400) — a toast about
                a failed save used to sit hidden behind the editor it was about. */}
            <div className="fixed bottom-4 left-4 right-4 sm:bottom-6 sm:left-auto sm:right-6 z-[1300] pointer-events-none">
        <div className="pointer-events-none flex flex-col items-stretch sm:items-end gap-2">
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
          onOpenJob={(jobId) => {
            const j = allJobs.find(x => x.id === jobId);
            if (j) setStoryJob(j); else setView('admin-jobs');
            setPaletteOpen(false);
          }}
        />
      )}

      {/* Palette job pick → full job story, from anywhere */}
      {user && storyJob && (
        <JobTimeline job={storyJob} logs={allFullLogs} stages={getStages(appSettings)} onClose={() => setStoryJob(null)} />
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
            DB.saveSettingsChanges({ onboardingComplete: true });
          }}
        />
      )}
      </div>{/* /flex-1 inner row that holds sidebar + main + overlays */}
    </div>
  );
}





