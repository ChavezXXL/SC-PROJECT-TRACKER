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
  PanelLeftClose, PanelLeftOpen, Cloud, Truck
} from 'lucide-react';
import { Toast } from './components/Toast';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { OnboardingWizard } from './components/OnboardingWizard';
import { Job, User, UserRole, TimeLog, ToastMessage, AppView, SystemSettings, TvSlide, SlideMessage, Quote, JobStage, ReworkEntry, ReworkReason, ReworkStatus, ShopGoal, GoalMetric, GoalPeriod, ProcessTemplate, QuoteSnippet } from './types';
import * as DB from './services/mockDb';
import { parseJobDetails } from './services/geminiService';
import { LiveFloorMonitor, useAutoLunch } from './LiveFloorMonitor';
import { SamplesView } from './SamplesView';
import { POScanner } from './POScanner';
import { QuotesView } from './QuotesView';
import { CustomerPortal } from './CustomerPortal';
import { ReportsView } from './views/ReportsView';
import { JobBoardView } from './views/JobBoardView';
import { DeliveriesView } from './views/DeliveriesView';
import { QualityView, ReworkModal } from './views/QualityView';
import { LogsView } from './views/LogsView';
import { printPackingSlipPDF, printJobTravelerPDF } from './services/pdfService';
// Pure helpers — extracted to utils/ so each file has a single responsibility
import { fmt, todayFmt, normDate, dateNum, toDateTimeLocal, formatDuration, getLogDurationMins } from './utils/date';
import { makeClientSlug, buildPortalUrl } from './utils/url';
import { getPartHistory, suggestExpectedHours } from './utils/partHistory';
import { fmtK, fmtMoneyK, fmtMoneySigned, shortName as fmtShortName } from './utils/format';
import { findStageForOperation, shouldAutoRoute } from './utils/stageRouting';
import { ShopFlowMap } from './components/ShopFlowMap';
import { RecentStageMoves } from './components/RecentStageMoves';
import { OperationsStageMapper } from './components/OperationsStageMapper';
import { ClientUpdateGenerator } from './components/ClientUpdateGenerator';
import { CommandPalette, useCommandPalette } from './components/CommandPalette';
import { isDeveloper } from './utils/devMode';
import { watchLongRunningTimers, watchClockInReminder, watchEndOfShiftReminder } from './services/reminders';
import { watchShiftAlarms, playAlarmSound, preloadAlarmSounds, scheduleUpcomingAlarms } from './services/shiftAlarms';

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

const VAPID_KEY = 'BFdk7N8Nnc2xrMgZuECkQEutiO1emvPepXT8k59122AqcI-EPrCZEA32jU4Lfzz47EZBFPj6QFThBURYAsjU6Es';
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
  const [alerts, setAlerts] = useState<Array<{id:string; type:'overdue'|'due-soon'|'urgent'|'long-timer'|'new-urgent'; title:string; body:string; time:number; read:boolean}>>([]);
  // Persist notified tags across page refreshes so we don't re-fire on reload
  const notifiedRef = useRef<Set<string>>(loadNotifiedTags());

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
      await DB.savePushSubscription(userId, sub.toJSON());
      console.log('[Push] ✅ Device registered for background notifications');
    } catch (e) {
      console.warn('[Push] ❌ Subscribe failed:', e);
    }
  }, []);

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
            ? 'bg-blue-500/10 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20'
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
                <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/25 flex items-center justify-center shrink-0">
                  <Bell className="w-4 h-4 text-blue-400" aria-hidden="true" />
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
            {permission !== 'granted' && (
              <div className="mx-3 mt-3 rounded-xl bg-gradient-to-br from-blue-500/15 to-indigo-500/10 border border-blue-500/25 p-3 flex items-center gap-3 shrink-0">
                <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0">
                  <BellRing className="w-4 h-4 text-blue-400" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-blue-200 leading-tight">Get desktop alerts</p>
                  <p className="text-[10px] text-blue-300/70 mt-0.5 leading-snug">Overdue jobs &amp; long timers alert even when the tab is closed.</p>
                </div>
                <button
                  onClick={() => requestPermission(userId)}
                  aria-label="Enable desktop notifications"
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg shrink-0 transition-all shadow-lg shadow-blue-900/40"
                >
                  Enable
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
                      className={`w-full text-left px-3 py-3 border-b border-white/5 last:border-b-0 hover:bg-white/5 transition-colors flex items-start gap-3 relative ${!alert.read ? 'bg-blue-500/[0.04]' : ''}`}
                    >
                      {!alert.read && <span aria-hidden="true" className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-blue-500" />}
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
      <div className="bg-zinc-900 border border-blue-500/30 rounded-2xl p-4 shadow-2xl shadow-black/50">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shrink-0 text-white font-black text-sm">SC</div>
          <div className="flex-1">
            <p className="text-white font-bold text-sm">Install SC Tracker</p>
            <p className="text-zinc-400 text-xs mt-0.5">Add to your home screen for quick access  works offline too.</p>
            <div className="flex gap-2 mt-3">
              <button onClick={install} className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition-all flex-1">
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
// `main` element, which accidentally hid the printable modal too (the modal
// lives inside main in the DOM) — result was a blank print.
const PrintStyles = () => (
  <style>{`
    @media print {
      @page { size: letter; margin: 10mm; }
      html, body, #root {
        background: white !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
      }
      /* Hide EVERYTHING with visibility — this preserves DOM structure so the
         printable content's ancestors (which wrap the printable via position)
         still render even though sidebar/overlays vanish. */
      body * { visibility: hidden !important; }

      /* Un-hide the printable area and every descendant */
      #printable-area,
      #printable-area * {
        visibility: visible !important;
      }

      /* Force the printable area to the page origin so it fills the sheet
         regardless of any transforms/positioning its ancestors had. */
      #printable-area {
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
        width: 100% !important;
        padding: 0 !important;
        margin: 0 !important;
        background: white !important;
        overflow: visible !important;
        box-shadow: none !important;
      }

      /* Explicitly hide print-preview chrome (Cancel/Print buttons in the
         in-app modal). They're marked with .no-print. */
      .no-print, .no-print * { visibility: hidden !important; display: none !important; }

      /* Readable font scaling for print output */
      #printable-area h1 { font-size: 28pt !important; }
      #printable-area .print-po { font-size: inherit !important; }
      #printable-area .print-field-lg { font-size: inherit !important; }
      #printable-area .print-field-md { font-size: inherit !important; }
      #printable-area .print-qr-img { max-width: 240px !important; width: 240px !important; mix-blend-mode: normal !important; }
      #printable-area .print-qr-label { font-size: 14pt !important; }
      #printable-area .print-notes { font-size: 12pt !important; line-height: 1.5 !important; }
      #printable-area .print-instr { font-size: 13pt !important; font-weight: 700 !important; line-height: 1.5 !important; }
      #printable-area label { font-size: 10pt !important; }
      #printable-area .print-part-photo { max-width: 180px !important; max-height: 140px !important; }

      /* Never split field blocks, the QR card, or log rows across pages */
      #printable-area .border-4,
      #printable-area .border-2,
      #printable-area table,
      #printable-area tr {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }

      /* Images never overflow the page width */
      #printable-area img { max-width: 100% !important; height: auto !important; }

      /* Drop every box-shadow so nothing prints washed out */
      #printable-area [class*="shadow"] { box-shadow: none !important; }
    }
  `}</style>
);

// --- DEFAULT WORKFLOW STAGES ---
const DEFAULT_STAGES: JobStage[] = [
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
    <div className={`bg-zinc-900 border ${isPaused ? 'border-yellow-500/30' : 'border-blue-500/30'} rounded-3xl p-6 shadow-2xl relative overflow-hidden animate-fade-in mb-8 no-print`}>
      <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none"><Briefcase className="w-64 h-64 text-blue-500" /></div>
      <div className={`absolute top-0 left-0 w-full h-1 ${isPaused ? 'bg-gradient-to-r from-yellow-500 via-orange-500 to-yellow-500' : 'bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500'} opacity-50 animate-pulse`}></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 relative z-10">
        <div className="flex flex-col justify-center">
          <div className="flex items-center gap-2 mb-4">
            <span className={`animate-pulse w-3 h-3 rounded-full ${isPaused ? 'bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'}`}></span>
            <span className={`font-bold uppercase tracking-widest text-xs ${isPaused ? 'text-yellow-400' : 'text-red-400'}`}>{isPaused ? 'Job Paused' : 'Job In Progress'}</span>
          </div>
          <p className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-1">PO Number</p>
          <h2 className="text-4xl md:text-5xl font-black text-white mb-1">{job ? job.poNumber : 'Unknown'}</h2>
          <p className="text-sm text-zinc-500 mb-3">Job ID: <span className="font-mono text-zinc-400">{job ? job.jobIdsDisplay : ''}</span></p>
          <div className="text-xl text-blue-400 font-medium mb-8 flex items-center gap-2">
            <span className="px-3 py-1 bg-blue-500/10 rounded-lg border border-blue-500/20">{log.operation}</span>
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
const JobSelectionCard: React.FC<{ job: Job, onStart: (id: string, op: string) => void, disabled?: boolean, operations: string[], defaultExpanded?: boolean, user?: { id: string; name: string }, addToast?: any }> = ({ job, onStart, disabled, operations, defaultExpanded, user, addToast }) => {
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
    <div ref={cardRef} data-job-id={job.id} className={`border rounded-2xl overflow-hidden transition-all duration-300 ${borderClass} ${expanded ? 'ring-2 ring-blue-500/50' : 'hover:bg-zinc-800/50'} ${disabled ? 'opacity-50 pointer-events-none' : ''} ${defaultExpanded ? 'ring-2 ring-blue-500 shadow-lg shadow-blue-500/10' : ''}`}>
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
              className="relative group shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-500/50 rounded-lg"
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
          <div className="mt-4 flex items-center text-blue-400 text-xs font-bold uppercase tracking-wide">
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
                className="bg-zinc-800 hover:bg-blue-600 hover:text-white border border-white/5 py-3 px-4 rounded-xl text-sm text-zinc-300 transition-colors font-bold active:scale-95">
                {op}
              </button>
            ))}
            {operations.length === 0 && <p className="col-span-2 text-xs text-zinc-500 text-center py-2">No operations configured.</p>}
          </div>

          {/* Notes toggle */}
          <button onClick={(e) => { e.stopPropagation(); setShowNotes(!showNotes); }} className="mt-3 w-full flex items-center justify-between bg-zinc-900 hover:bg-zinc-800 border border-white/5 rounded-lg px-3 py-2 transition-colors">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              📝 Notes {(job.jobNotes?.length || 0) > 0 && <span className="bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full text-[10px]">{job.jobNotes!.length}</span>}
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
                    <span className="text-[10px] font-bold text-blue-400">{n.userName}</span>
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
                        DB.addJobNote(job.id, newNote.trim(), user.id, user.name);
                        addToast?.('success', 'Note added');
                        setNewNote('');
                      }
                    }}
                    onClick={e => e.stopPropagation()}
                    placeholder="Add a note..."
                    className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!newNote.trim()) return;
                      DB.addJobNote(job.id, newNote.trim(), user.id, user.name);
                      addToast?.('success', 'Note added');
                      setNewNote('');
                    }}
                    disabled={!newNote.trim()}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-30 text-white px-3 py-2 rounded-lg text-sm font-bold transition-colors"
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

const EmployeeDashboard = ({ user, addToast, onLogout, notifBell }: { user: User, addToast: any, onLogout: () => void, notifBell?: React.ReactNode }) => {
  const [tab, setTab] = useState<'jobs' | 'history' | 'scan' | 'progress'>('jobs');
  const [activeLog, setActiveLog] = useState<TimeLog | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState('');
  const [myHistory, setMyHistory] = useState<TimeLog[]>([]);
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
    return () => { unsubSettings(); unsubLogs(); unsubJobs(); };
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
    const stopLong = watchLongRunningTimers(getActive);
    const stopMorning = watchClockInReminder(user, getActive);
    const stopEndShift = watchEndOfShiftReminder(user, getActive, shopSettingsForReminders);
    return () => { stopLong(); stopMorning(); stopEndShift(); };
  }, [activeLog?.id, user.id, shopSettingsForReminders.autoClockOutTime]);

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

  useEffect(() => {
    const stop = watchShiftAlarms(
      () => shopSettingsForReminders,
      async (alarm) => {
        // Audible bell first — reliably wakes people on the floor.
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
        // Side effects: pause running work or clock out when flagged.
        if (alarm.pauseTimers && activeLog && !activeLog.pausedAt) {
          try { await DB.pauseTimeLog(activeLog.id, `Auto-pause: ${alarm.label}`); } catch {}
        }
        if (alarm.clockOut && activeLog) {
          try { await DB.stopTimeLog(activeLog.id); } catch {}
        }
      }
    );
    return stop;
  }, [shopSettingsForReminders, activeLog?.id]);

  // ── Listen for TIMER_ACTION messages from SW notification buttons ──
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handler = async (event: MessageEvent) => {
      if (event.data?.type !== 'TIMER_ACTION') return;
      const { action, logId } = event.data;
      if (!logId) return;
      try {
        if (action === 'stop') {
          await DB.stopTimeLog(logId);
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
      await DB.startTimeLog(jobId, user.id, user.name, operation, job?.partNumber, job?.customer, undefined, undefined, job?.jobIdsDisplay);
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

  const handleStopJob = async (logId: string) => {
    const stoppedJobId = activeLog?.jobId ?? null;
    try {
      await DB.stopTimeLog(logId);
      swPost({ type: 'TIMER_STOP' });
      addToast('success', 'Job Stopped');
      // Return user to the job they just stopped so they can start another operation
      if (stoppedJobId) {
        setScannedJobId(stoppedJobId);
        setTab('jobs');
        // Scroll to the job card after a brief delay for re-render
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

  const filteredJobs = jobs.filter(j => JSON.stringify(j).toLowerCase().includes(search.toLowerCase()));

  // History grouping
  const histToday = new Date(); histToday.setHours(0,0,0,0);
  const histYesterday = new Date(histToday); histYesterday.setDate(histToday.getDate() - 1);
  const histWeekAgo = new Date(histToday); histWeekAgo.setDate(histToday.getDate() - 7);
  const histWeekStart = new Date(histToday); histWeekStart.setDate(histToday.getDate() - histToday.getDay());
  const histWeekLogs = myHistory.filter(l => l.endTime && new Date(l.startTime) >= histWeekStart);
  const histWeekMins = histWeekLogs.reduce((a, l) => a + (l.durationMinutes || 0), 0);
  const historyGroups = [
    { label: 'Today', logs: myHistory.filter(l => new Date(l.startTime) >= histToday) },
    { label: 'Yesterday', logs: myHistory.filter(l => new Date(l.startTime) >= histYesterday && new Date(l.startTime) < histToday) },
    { label: 'This Week', logs: myHistory.filter(l => new Date(l.startTime) >= histWeekAgo && new Date(l.startTime) < histYesterday) },
    { label: 'Older', logs: myHistory.filter(l => new Date(l.startTime) < histWeekAgo) },
  ].filter(g => g.logs.length > 0);

  // Today stats for worker header
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayLogs = myHistory.filter(l => new Date(l.startTime) >= todayStart);
  const todayMins = todayLogs.reduce((a, l) => a + (l.durationMinutes || 0), 0);
  const todayHours = todayMins >= 60 ? `${Math.floor(todayMins/60)}h ${todayMins%60}m` : `${todayMins}m`;
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
        <div aria-hidden="true" className="absolute top-0 right-0 w-40 h-40 bg-blue-500/10 blur-3xl rounded-full" />
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
              <p className="text-xl font-black text-blue-400 tabular mt-0.5">{todayJobs}</p>
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
          <button onClick={() => setTab('scan')} className={`px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${tab === 'scan' ? 'bg-blue-600 text-white shadow' : 'bg-zinc-800 text-blue-400 hover:bg-blue-600 hover:text-white'}`}><ScanLine className="w-4 h-4" /> Scan</button>
          <button onClick={onLogout} className="bg-red-500/10 text-red-500 hover:bg-red-600 hover:text-white px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all"><LogOut className="w-4 h-4" /> Exit</button>
        </div>
      </div>

      {tab === 'scan' ? (
        <div className="flex-1 flex items-center justify-center animate-fade-in py-12">
          <div className="bg-zinc-900 p-8 rounded-3xl border border-white/10 text-center max-w-sm w-full shadow-2xl">
            <QrCode className="w-16 h-16 mx-auto text-blue-500 mb-4" />
            <h2 className="text-2xl font-bold text-white mb-4">Scan Job QR</h2>
            <input autoFocus onKeyDown={handleScan} className="bg-black/50 border border-blue-500 rounded-xl px-4 py-3 text-white text-center w-full text-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Scan or Type..." />
            <p className="text-zinc-500 text-xs mt-4">Point scanner at Traveler QR code.</p>
          </div>
        </div>
      ) : tab === 'history' ? (
        <div className="space-y-4 animate-fade-in">
          {/* Weekly summary */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-blue-400">
                {histWeekMins >= 60 ? `${Math.floor(histWeekMins/60)}h ${histWeekMins%60}m` : `${histWeekMins}m`}
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
                        {log.durationMinutes ? <span className="text-xs font-mono text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded">{formatDuration(log.durationMinutes)}</span> : null}
                        {log.endTime
                          ? <span className="text-xs text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full">Done</span>
                          : <span className="text-xs text-blue-400 font-bold bg-blue-500/10 px-2 py-0.5 rounded-full flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>Active</span>
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
            <input type="text" placeholder="Search by Job #, PO, or Part..." value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-zinc-900 border border-white/10 rounded-2xl pl-12 pr-4 py-3 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-sm" />
          </div>
          {activeLog && (
            <div className="mb-4 p-3 rounded-xl bg-blue-900/20 border border-blue-500/30 text-blue-300 text-sm text-center flex items-center justify-center gap-2">
              <Info className="w-4 h-4" /> You have a job running. Please stop it before starting a new one.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredJobs.map(job => (
              <JobSelectionCard key={job.id} job={job} onStart={(id, op) => { handleStartJob(id, op); setScannedJobId(null); }} disabled={!!activeLog} operations={ops} defaultExpanded={job.id === scannedJobId} user={user} addToast={addToast} />
            ))}
            {filteredJobs.length === 0 && <div className="col-span-full py-12 text-center text-zinc-500">No active jobs found matching "{search}".</div>}
          </div>
        </div>
      )}
    </div>
  );
};

// --- CONFIRM MODAL ---
const ConfirmationModal = ({ isOpen, title, message, onConfirm, onCancel }: any) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-xl p-4 animate-fade-in">
      <div className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-2xl p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2"><AlertTriangle className="text-red-500" /> {title}</h3>
        <p className="text-zinc-400 text-sm mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="text-zinc-400 hover:text-white text-sm px-4 py-2">Cancel</button>
          <button onClick={() => { onConfirm(); onCancel(); }} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-red-900/20">Confirm</button>
        </div>
      </div>
    </div>
  );
};

// --- PRINTABLE JOB SHEET ---
// Reads layout preferences from settings.traveler so admins can hide QR
// codes, change the row count, add a footer notice, etc. without code.
const PrintableJobSheet = ({ job, onClose, onPrinted }: { job: Job | null, onClose: () => void, onPrinted?: (jobId: string) => void }) => {
  const [appSettings, setAppSettings] = useState<SystemSettings>(DB.getSettings());
  useEffect(() => DB.subscribeSettings(setAppSettings), []);

  if (!job) return null;
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
  const opRows = Math.min(20, Math.max(4, t.operationLogRows ?? 8));

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black/90 backdrop-blur-sm animate-fade-in print-overlay" onClick={onClose}>
      <div className="bg-white text-black w-full max-w-3xl mx-auto rounded-xl shadow-2xl relative flex flex-col my-4 mx-4 sm:mx-auto" style={{maxHeight:'calc(100dvh - 2rem)'}} id="printable-modal" onClick={e => e.stopPropagation()}>
        <div className="bg-zinc-900 text-white p-3 sm:p-4 flex justify-between items-center no-print shrink-0 border-b border-zinc-700 sticky top-0 rounded-t-xl z-10">
          <div>
            <h3 className="font-bold flex items-center gap-2 text-base sm:text-lg"><Printer className="w-5 h-5 text-blue-500" /> Print Preview</h3>
            <p className="text-xs text-zinc-400 hidden sm:block">Review details before printing.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-2 text-zinc-400 hover:text-white text-sm font-medium">Cancel</button>
            <button onClick={() => { window.print(); if (job && onPrinted) onPrinted(job.id); }} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 text-sm"><Printer className="w-4 h-4" /><span className="hidden sm:inline">Print </span>Traveler</button>
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
                <img src={appSettings.companyLogo} alt="" className="h-12 object-contain shrink-0" />
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
      <div className="w-full max-w-sm bg-zinc-900/50 backdrop-blur-xl border border-white/5 p-8 rounded-3xl shadow-2xl">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
        </div>
        <h1 className="text-2xl font-semibold text-center text-white tracking-tight mb-1">SC DEBURRING</h1>
        <p className="text-center text-zinc-500 text-sm mb-6">Access Portal</p>
        <form onSubmit={handleLogin} className="space-y-4">
          <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Username" autoFocus />
          <input type="password" value={pin} onChange={e => setPin(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none" placeholder="PIN" />
          <button disabled={loading} type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3.5 rounded-xl font-medium transition-all shadow-lg shadow-blue-900/20 mt-2 disabled:opacity-50">
            {loading ? 'Verifying...' : 'Sign In'}
          </button>
        </form>
      </div>
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
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub6(); unsub7(); };
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

  const todayStartMs = new Date(); (todayStartMs as any).setHours(0,0,0,0); const todayMs = todayStartMs.getTime();

  // Workers who haven't logged any operations today
  const activeWorkers = (dashWorkers || []).filter((w: User) => w.isActive !== false && w.role !== 'admin');
  const workersWithLogsToday = new Set(allLogs.filter(l => l.startTime >= todayMs).map(l => l.userId));
  const workersNoScansToday = activeWorkers.filter((w: User) => !workersWithLogsToday.has(w.id) && !activeLogs.some(l => l.userId === w.id));
  const todayHoursMins = logs.filter(l => l.endTime && l.endTime >= todayMs).reduce((a, l) => a + (l.durationMinutes || 0), 0);
  const todayHrsDisplay = todayHoursMins >= 60 ? `${Math.floor(todayHoursMins/60)}h ${todayHoursMins%60}m` : `${todayHoursMins}m`;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-black text-white flex items-center gap-2.5 tracking-tight"><LayoutDashboard className="w-7 h-7 text-blue-500" aria-hidden="true" /> <span>Overview</span></h1>
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
            try { await DB.stopTimeLog(id); addToast('success', 'Timer Stopped'); }
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

        // Customer duplicate detection (same logic as Settings)
        const custMap = new Map<string, number>();
        jobs.forEach(j => {
          const c = (j.customer || '').trim();
          if (!c) return;
          const key = c.toLowerCase().replace(/&/g, 'and').replace(/\([^)]*\)/g, '').replace(/\b(inc|corp|co|llc|ltd|aero|industries|group|machining|mfg)\b/gi, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length > 1).slice(0, 2).join('');
          if (!key) return;
          custMap.set(key, (custMap.get(key) || 0) + 1);
        });
        const dupGroupCount = [...custMap.values()].filter(v => v > 1).length;

        const items: { label: string; count: number; color: string; icon: any; onClick: () => void }[] = [];
        if (overdueJobs.length > 0) items.push({ label: `${overdueJobs.length} overdue job${overdueJobs.length > 1 ? 's' : ''}`, count: overdueJobs.length, color: '#ef4444', icon: AlertTriangle, onClick: () => setView('admin-jobs') });
        if (openRework > 0) items.push({ label: `${openRework} open rework issue${openRework > 1 ? 's' : ''}`, count: openRework, color: '#f59e0b', icon: AlertTriangle, onClick: () => setView('admin-quality') });
        if (longRunning > 0) items.push({ label: `${longRunning} timer${longRunning > 1 ? 's' : ''} running > 4h`, count: longRunning, color: '#eab308', icon: Clock, onClick: () => setView('admin-live') });
        if (dupGroupCount > 0) items.push({ label: `${dupGroupCount} possible customer duplicate${dupGroupCount > 1 ? 's' : ''}`, count: dupGroupCount, color: '#a855f7', icon: Users, onClick: () => setView('admin-settings') });
        if (missingQuotes > 0 && missingQuotes >= 5) items.push({ label: `${missingQuotes} completed jobs missing quote`, count: missingQuotes, color: '#3b82f6', icon: FileText, onClick: () => setView('admin-jobs') });

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

      {/* Overdue / Due Soon Alert Banner */}
      {(overdueJobs.length > 0 || dueSoonJobs.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {overdueJobs.length > 0 && (
            <div className="min-w-0 bg-red-500/10 border border-red-500/30 rounded-2xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-red-400 font-bold text-sm">{overdueJobs.length} Overdue Job{overdueJobs.length > 1 ? 's' : ''}</p>
                <p className="text-red-400/70 text-xs truncate">
                  {overdueJobs.slice(0, 3).map(j => j.poNumber).join(' · ')}
                  {overdueJobs.length > 3 && <span className="text-red-400/90 font-semibold"> +{overdueJobs.length - 3} more</span>}
                </p>
              </div>
              <button onClick={() => setView('admin-jobs')} className="text-xs font-medium text-red-400 hover:text-white border border-red-500/30 px-3 py-2 rounded-lg hover:bg-red-500/20 transition-colors shrink-0 min-h-[36px]">View Jobs</button>
            </div>
          )}
          {dueSoonJobs.length > 0 && (
            <div className="min-w-0 bg-orange-500/10 border border-orange-500/30 rounded-2xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5 text-orange-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-orange-400 font-bold text-sm">{dueSoonJobs.length} Due Within 3 Days</p>
                <p className="text-orange-400/70 text-xs truncate">
                  {dueSoonJobs.slice(0, 3).map(j => j.poNumber).join(' · ')}
                  {dueSoonJobs.length > 3 && <span className="text-orange-400/90 font-semibold"> +{dueSoonJobs.length - 3} more</span>}
                </p>
              </div>
              <button onClick={() => setView('admin-jobs')} className="text-xs font-medium text-orange-400 hover:text-white border border-orange-500/30 px-3 py-2 rounded-lg hover:bg-orange-500/20 transition-colors shrink-0 min-h-[36px]">View Jobs</button>
            </div>
          )}
        </div>
      )}

      {/* Missing Scans Alert */}
      {workersNoScansToday.length > 0 && new Date().getHours() >= 8 && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-2xl p-4 flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-yellow-500/20 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-yellow-400 font-bold text-sm truncate">
              {workersNoScansToday.length} worker{workersNoScansToday.length > 1 ? 's' : ''} haven't scanned today
            </p>
            <p className="text-yellow-400/70 text-xs truncate">
              {workersNoScansToday.slice(0, 4).map((w: User) => w.name.split(' ')[0]).join(' · ')}
              {workersNoScansToday.length > 4 && <span className="text-yellow-400/90 font-semibold"> +{workersNoScansToday.length - 4} more</span>}
            </p>
          </div>
        </div>
      )}

      <div className="stagger grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4">
        <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 p-3 sm:p-6 rounded-2xl flex justify-between items-center gap-2 overflow-hidden">
          <div className="min-w-0"><p className="text-zinc-500 text-[10px] sm:text-sm font-bold uppercase tracking-wider truncate">Live Activity</p><h3 className="text-xl sm:text-3xl font-black text-white">{liveJobsCount}</h3><p className="text-[10px] sm:text-xs text-blue-400 mt-1 truncate">Jobs running now</p></div>
          <Activity className={`w-7 h-7 sm:w-10 sm:h-10 text-blue-500 shrink-0 ${liveJobsCount > 0 ? 'animate-pulse' : 'opacity-20'}`} />
        </div>
        <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 p-3 sm:p-6 rounded-2xl flex justify-between items-center gap-2 overflow-hidden">
          <div className="min-w-0"><p className="text-zinc-500 text-[10px] sm:text-sm font-bold uppercase tracking-wider truncate">Open Jobs</p><h3 className="text-xl sm:text-3xl font-black text-white">{activeJobsCount}</h3><p className="text-[10px] sm:text-xs text-zinc-500 mt-1 truncate">Total open jobs</p></div>
          <Briefcase className="text-zinc-600 w-7 h-7 sm:w-10 sm:h-10 shrink-0" />
        </div>
        <div className={`card-shine hover-lift-glow p-3 sm:p-6 rounded-2xl flex justify-between items-center gap-2 overflow-hidden border ${overdueJobs.length > 0 ? 'bg-red-500/10 border-red-500/30 shadow-lg shadow-red-900/10' : 'bg-zinc-900/50 border-white/5'}`}>
          <div className="min-w-0"><p className={`text-[10px] sm:text-sm font-bold uppercase tracking-wider truncate ${overdueJobs.length > 0 ? 'text-red-400' : 'text-zinc-500'}`}>Overdue</p><h3 className={`text-xl sm:text-3xl font-black ${overdueJobs.length > 0 ? 'text-red-400' : 'text-zinc-600'}`}>{overdueJobs.length}</h3><p className={`text-[10px] sm:text-xs mt-1 truncate ${overdueJobs.length > 0 ? 'text-red-400/70' : 'text-zinc-600'}`}>Past due date</p></div>
          <AlertTriangle className={`w-7 h-7 sm:w-10 sm:h-10 shrink-0 ${overdueJobs.length > 0 ? 'text-red-500' : 'text-zinc-700'}`} />
        </div>
        <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 p-3 sm:p-6 rounded-2xl flex justify-between items-center gap-2 overflow-hidden">
          <div className="min-w-0"><p className="text-zinc-500 text-[10px] sm:text-sm font-bold uppercase tracking-wider truncate">Floor Staff</p><h3 className="text-xl sm:text-3xl font-black text-white">{activeWorkersCount}</h3><p className="text-[10px] sm:text-xs text-zinc-500 mt-1 truncate">Active Operators</p></div>
          <Users className="text-emerald-500 w-7 h-7 sm:w-10 sm:h-10 shrink-0" />
        </div>
        <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 p-3 sm:p-6 rounded-2xl flex justify-between items-center gap-2 overflow-hidden">
          <div className="min-w-0"><p className="text-zinc-500 text-[10px] sm:text-sm font-bold uppercase tracking-wider truncate">Today</p><h3 className="text-xl sm:text-3xl font-black text-white truncate">{todayHrsDisplay}</h3><p className="text-[10px] sm:text-xs text-zinc-500 mt-1 truncate">Hours logged</p></div>
          <Clock className="text-blue-400 w-7 h-7 sm:w-10 sm:h-10 opacity-60 shrink-0" />
        </div>
      </div>

      {/* ── SHOP FLOW MAP — visual of jobs moving through each stage ── */}
      <div className="card-shine hover-lift-glow bg-gradient-to-br from-zinc-900/60 to-zinc-900/30 border border-white/5 rounded-2xl p-4 sm:p-5 overflow-hidden">
        <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
          <div>
            <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-blue-400" aria-hidden="true" /> Shop Flow Map
            </h3>
            <p className="text-[11px] text-zinc-600 mt-0.5">Tap a stage to see the jobs inside · glowing = workers on it · flame = stuck jobs</p>
          </div>
        </div>
        <ShopFlowMap
          jobs={jobs}
          stages={getStages(shopSettings)}
          activeLogs={activeLogs}
        />
        <RecentStageMoves jobs={jobs} stages={getStages(shopSettings)} limit={8} />
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
          const hrs = jLogs.reduce((a: number, l: any) => a + (l.durationMinutes || 0), 0) / 60;
          const laborCost = jLogs.reduce((acc: number, l: any) => {
            const w = dashWorkers.find(w => w.id === l.userId);
            const r = w?.hourlyRate || rate;
            return acc + ((l.durationMinutes || 0) / 60) * r;
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
          // End-of-day on due date
          const due = new Date(j.dueDate + 'T23:59:59').getTime();
          return (j.completedAt || 0) <= due;
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
                <p className="text-base sm:text-xl md:text-2xl font-black text-blue-400 truncate tabular">${avgRevenuePerHr.toFixed(0)}</p>
                <p className="text-[10px] text-zinc-600 truncate">Cost: ${avgCostPerHr.toFixed(0)}/hr</p>
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
            {activeLogs.map(l => (
              <div key={l.id} className="p-3 sm:p-4 hover:bg-white/5 transition-colors group">
                {/* Row 1: avatar + name/operation + stop button (always visible, never collides with timer) */}
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar name={l.userName} size="md" ring dot={l.pausedAt ? 'paused' : 'live'} />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-white text-sm truncate">{l.userName}</p>
                    <p className="text-xs text-zinc-500 truncate">{l.operation}</p>
                  </div>
                  <button
                    aria-label={`Force stop ${l.userName}'s timer`}
                    onClick={() => confirmAction({ title: 'Force Stop', message: 'Stop this timer?', onConfirm: () => DB.stopTimeLog(l.id) })}
                    className="bg-red-500/10 text-red-500 p-2 rounded-lg hover:bg-red-500 hover:text-white transition-colors opacity-60 group-hover:opacity-100 shrink-0"
                    title="Force stop"
                  >
                    <Power className="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
                  </button>
                </div>
                {/* Row 2: large timer on its own line so it never overlaps the avatar at any width */}
                <div className="mt-2 text-white text-2xl sm:text-3xl font-black font-mono tabular-nums text-center sm:text-right tracking-tight">
                  <LiveTimer startTime={l.startTime} pausedAt={l.pausedAt} totalPausedMs={l.totalPausedMs} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-zinc-900/50 border border-white/5 rounded-3xl overflow-hidden flex flex-col">
          <div className="p-5 border-b border-white/5 flex justify-between items-center">
            <h3 className="font-bold text-white flex items-center gap-2"><History className="w-4 h-4 text-blue-500" /> Recent Completed</h3>
            <button onClick={() => setView('admin-logs')} className="text-xs font-semibold text-blue-400 hover:text-white transition-colors flex items-center gap-1">View All <ChevronRight className="w-3 h-3" /></button>
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
                {l.durationMinutes != null && (
                  <div className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded shrink-0 font-bold">{formatDuration(l.durationMinutes)}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
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
const PartImageLightbox = ({ src, onClose }: { src: string, onClose: () => void }) => (
  <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/90 backdrop-blur-sm animate-fade-in" onClick={onClose}>
    <div className="relative max-w-3xl max-h-[85vh] m-4" onClick={e => e.stopPropagation()}>
      <button aria-label="Close" onClick={onClose} className="absolute -top-3 -right-3 z-10 bg-zinc-800 border border-white/10 rounded-full p-2 text-white hover:bg-red-500 transition-colors shadow-lg"><X className="w-5 h-5" aria-hidden="true" /></button>
      <img src={src} alt="Part Photo" className="max-w-full max-h-[85vh] rounded-xl shadow-2xl object-contain" />
    </div>
  </div>
);


// --- ADMIN: JOBS ---
const JobsView = ({ user, addToast, setPrintable, confirm, onOpenPOScanner, initialTab, calendarOnly }: any) => {
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
  const [showClientUpdate, setShowClientUpdate] = useState(false);
  const [startJobModal, setStartJobModal] = useState<Job | null>(null);
  const [ops, setOps] = useState<string[]>([]);
  const [clients, setClients] = useState<string[]>([]);
  const [partSuggestions, setPartSuggestions] = useState<Job[]>([]);
  const [shopSettings, setShopSettings] = useState<SystemSettings>(DB.getSettings());
  const [allLogs, setAllLogs] = useState<TimeLog[]>([]);
  const [workers, setWorkers] = useState<User[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<User | null>(null);
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [calAdded, setCalAdded] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('cal_added_jobs') || '[]'); } catch { return []; } });
  const [printed, setPrinted] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('printed_jobs') || '[]'); } catch { return []; } });
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
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, []);

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
      await DB.startTimeLog(startJobModal.id, targetWorker.id, targetWorker.name, operation, startJobModal.partNumber, startJobModal.customer, selectedMachine || undefined, undefined, startJobModal.jobIdsDisplay);
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
    const localDate = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    const job: Job = {
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
      // Stage
      currentStage: editingJob.currentStage || undefined,
      stageHistory: editingJob.stageHistory || undefined,
    };
    try {
      const isNew = !editingJob.id;
      await DB.saveJob(job);
      setShowModal(false);
      setEditingJob({});
      addToast('success', 'Job Saved');
      if (isNew && job.dueDate) {
        addToast('info', '📅 Tap the calendar icon on the job to add to Google Calendar');
      }
    }
    catch (e) { addToast('error', 'Save Failed'); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            {calendarOnly ? <><Calendar className="w-6 h-6 text-blue-500" /> Production Calendar</> : <><Briefcase className="w-6 h-6 text-blue-500" /> Production Jobs</>}
          </h2>
          <p className="text-zinc-500 text-sm">{calendarOnly ? 'Month view of every job due date. Click a day to see what ships.' : 'Manage orders and track by PO, priority, and due date.'}</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <button onClick={() => { setEditingJob({}); setShowModal(true); }} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 text-sm transition-all"><Plus className="w-4 h-4" /> New Job</button>
          <button onClick={onOpenPOScanner} className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg font-bold border border-white/10 text-sm transition-all"><ScanLine className="w-4 h-4" /> Scan PO</button>
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
            <CheckCircle className={`w-3.5 h-3.5 ${activeTab === 'completed' ? 'text-blue-400' : 'text-zinc-600'}`} />
            Completed History
            <span className={`text-xs font-black px-2 py-0.5 rounded-full ${activeTab === 'completed' ? 'bg-blue-500/20 text-blue-400' : 'bg-zinc-800 text-zinc-500'}`}>{jobs.filter(j => j.status === 'completed').length}</span>
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
          const m = j.dueDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (!m) return;
          const jMo = parseInt(m[1]) - 1, jDay = parseInt(m[2]), jYr = parseInt(m[3]);
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
                <button onClick={goToday} className="text-xs text-blue-400 hover:text-blue-300 font-bold px-3 py-1.5 rounded-lg hover:bg-blue-500/10 border border-blue-500/20">Today</button>
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
                        const totalMins = jobLogs.reduce((a, l) => a + (l.durationMinutes || 0), 0);
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
              className="w-full bg-zinc-950 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-bold transition-all ${showFilters || activeFilterCount > 0 ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'border-white/10 text-zinc-400 hover:text-white hover:border-white/20'}`}
          >
            <Filter className="w-4 h-4" />
            Filters
            {activeFilterCount > 0 && <span className="bg-blue-500 text-white text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center">{activeFilterCount}</span>}
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
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border flex items-center gap-1.5 transition-colors ${isActive ? 'bg-blue-500/15 border-blue-500/30 text-blue-400' : 'bg-zinc-900 border-white/10 text-zinc-400 hover:text-white hover:border-white/20'}`}
                >
                  {v.name}
                  <X className="w-3 h-3 opacity-50 hover:opacity-100" onClick={(e) => { e.stopPropagation(); setSavedViews(savedViews.filter(x => x.id !== v.id)); }} />
                </button>
              );
            })}
            {(activeFilterCount > 0 || search) && (
              <button
                onClick={() => {
                  const name = prompt('Name this view:', search ? `"${search}" ${filterStatus !== 'all' ? filterStatus : ''}`.trim() : `${filterStatus !== 'all' ? filterStatus : 'custom'} ${filterPriority !== 'all' ? filterPriority : ''}`.trim());
                  if (!name?.trim()) return;
                  const v: SavedView = { id: `v_${Date.now()}`, name: name.trim(), search, priority: filterPriority, status: filterStatus, sortBy, tab: activeTab === 'calendar' ? 'active' : activeTab };
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
        <div className="bg-gradient-to-r from-blue-500/15 to-indigo-500/10 border border-blue-500/30 rounded-xl p-3 flex items-center gap-3 flex-wrap animate-fade-in">
          <span className="text-sm font-bold text-white flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-blue-400" aria-hidden="true" />
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
                if (job) printJobTravelerPDF(job, shopSettings);
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
                  className="w-4 h-4 rounded accent-blue-500 cursor-pointer"
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
              const deliveredLate = j.status === 'completed' && j.dueDate && j.completedAt && j.completedAt > new Date(j.dueDate + 'T23:59:59').getTime();
              const deliveredOnTime = j.status === 'completed' && j.dueDate && j.completedAt && j.completedAt <= new Date(j.dueDate + 'T23:59:59').getTime();
              // Job costing — per-worker rates
              const jobLogs = allLogs.filter(l => l.jobId === j.id);
              const totalMins = jobLogs.reduce((a, l) => a + (l.durationMinutes || 0), 0);
              const totalHrs = totalMins / 60;
              const fallbackRate = shopSettings.shopRate || 0;
              const overheadRate = (shopSettings.monthlyOverhead || 0) / (shopSettings.monthlyWorkHours || 160);
              const laborCost = jobLogs.reduce((acc, l) => {
                const w = workers.find(w => w.id === l.userId);
                const r = w?.hourlyRate || fallbackRate;
                return acc + ((l.durationMinutes || 0) / 60) * r;
              }, 0);
              const overheadCost = totalHrs * overheadRate;
              const totalCost = laborCost + overheadCost;
              const hasQuote = (j.quoteAmount || 0) > 0;
              const profit = hasQuote ? (j.quoteAmount || 0) - totalCost : null;
              return (
                <tr key={j.id} className={`hover:bg-white/5 transition-colors group cursor-pointer ${isOverdue ? 'bg-red-500/5' : ''} ${selectedJobIds.has(j.id) ? 'bg-blue-500/5' : ''}`} onClick={() => { setEditingJob(j); setShowModal(true); }}>
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
                      className="w-4 h-4 rounded accent-blue-500 cursor-pointer"
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
                      </div>
                      <span className="text-zinc-600 font-mono text-[10px] sm:text-[11px] truncate max-w-[160px] sm:max-w-none">Job ID: {j.jobIdsDisplay}</span>
                      {/* Mobile-only: show customer + part inline since column is hidden */}
                      <span className="md:hidden text-zinc-400 text-xs truncate max-w-[180px]">{j.partNumber} · {user.role === 'admin' ? j.customer : '***'}</span>
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
                      {j.status === 'completed' && totalMins > 0 && (
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] font-mono text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">{totalHrs.toFixed(1)}h · ${totalCost.toFixed(0)} cost</span>
                          {profit !== null && (
                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${profit >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                              {profit >= 0 ? '+' : '-'}${Math.abs(profit).toFixed(0)} {profit >= 0 ? 'profit' : 'loss'}
                            </span>
                          )}
                        </div>
                      )}
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
                  <td className={`p-2 sm:p-4 font-mono sm:whitespace-nowrap font-bold text-[11px] sm:text-sm ${isOverdue ? 'text-red-400' : isDueSoon ? 'text-orange-400' : 'text-zinc-400'}`}>
                    {fmt(j.dueDate)}
                  </td>
                  <td className="p-1.5 sm:p-4 text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-end gap-1 sm:gap-2 flex-wrap sm:flex-nowrap">
                      <button aria-label="Start operation" onClick={() => setStartJobModal(j)} className="p-2 bg-blue-500/10 text-blue-500 rounded-lg hover:bg-blue-500 hover:text-white transition-colors" title="Start Operation"><Play className="w-4 h-4" aria-hidden="true" /></button>
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
                                onClick={() => confirm({
                                title: 'Complete Job',
                                message: `Mark "${j.poNumber}" as completed?`,
                                onConfirm: async () => {
                                  await DB.advanceJobStage(j.id, completedStage.id, user.id, user.name, true);
                                  addToast('success', `✅ Job "${j.poNumber}" completed!`);
                                }
                              })}
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
                        }} className={`hidden sm:flex p-2 rounded-lg transition-colors ${calAdded.includes(j.id) ? 'bg-emerald-500/10 text-emerald-400' : 'hover:bg-blue-500/10 text-zinc-500 hover:text-blue-400'}`} title={calAdded.includes(j.id) ? 'Already in Google Calendar' : 'Add to Google Calendar'}>
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
                        onClick={() => setPrintable(j)} className={`hidden sm:flex p-2 rounded-lg transition-colors ${printed.includes(j.id) ? 'bg-emerald-500/10 text-emerald-400' : 'hover:bg-zinc-800 text-zinc-400 hover:text-white'}`} title={printed.includes(j.id) ? 'Printed ✓ — click to reprint' : 'Print Traveler'}><Printer className="w-4 h-4" aria-hidden="true" /></button>
                      <button aria-label={`Report rework for ${j.poNumber || ''}`} onClick={(e) => { e.stopPropagation(); setReworkModal({ jobId: j.id, poNumber: j.poNumber, partNumber: j.partNumber, customer: j.customer, reason: 'finish', quantity: 1, status: 'open' }); }} className="p-2 hover:bg-amber-500/10 rounded-lg text-amber-400/70 hover:text-amber-400 transition-colors relative" title="Report rework">
                        <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                        {reworkByJob.get(j.id) && (reworkByJob.get(j.id)!.open > 0) && (
                          <span aria-hidden="true" className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 bg-amber-500 text-white text-[9px] font-black rounded-full flex items-center justify-center ring-2 ring-zinc-950">{reworkByJob.get(j.id)!.open}</span>
                        )}
                      </button>
                      <button aria-label={`Edit job ${j.poNumber || ''}`} onClick={() => { setEditingJob(j); setShowModal(true); }} className="p-2 hover:bg-zinc-800 rounded-lg text-blue-400 hover:text-white" title="Edit"><Edit2 className="w-4 h-4" aria-hidden="true" /></button>
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

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xl p-2 sm:p-4 animate-fade-in">
          <div className="bg-zinc-900 border border-white/10 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh] sm:max-h-[90vh]">
            <div className="p-3 sm:p-5 border-b border-white/10 flex justify-between items-center bg-zinc-800/50 sticky top-0">
              <h3 className="font-bold text-white text-base sm:text-lg">{editingJob.id ? 'Edit Job' : 'Create New Job'}</h3>
              <button onClick={() => setShowModal(false)}><X className="w-5 h-5 text-zinc-500 hover:text-white" /></button>
            </div>
            <div className="p-4 sm:p-8 overflow-y-auto space-y-5 sm:space-y-8">
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
                            onClick={async () => {
                              await DB.advanceJobStage(editingJob.id, completedStage.id, user.id, user.name, true);
                              setEditingJob({ ...editingJob, currentStage: completedStage.id, status: 'completed' });
                              addToast('success', `✅ Job completed!`);
                            }}
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
                <h4 className="text-xs font-black text-blue-400 uppercase tracking-[0.2em] border-b border-blue-500/20 pb-2 flex items-center gap-2">
                  <span className="bg-blue-500/10 text-blue-400 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black">1</span>
                  Primary Information
                </h4>
                <div>
                  <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Purchase Order (PO) # <span className="text-red-500">*</span></label>
                  <input className="w-full bg-black/40 border-2 border-blue-500/30 focus:border-blue-500 rounded-xl p-4 text-white text-2xl font-black outline-none transition-all placeholder-zinc-700" value={editingJob.poNumber || ''} onChange={e => setEditingJob({ ...editingJob, poNumber: e.target.value })} placeholder="e.g. PO-4500123" autoFocus />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="relative">
                    <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Part Number <span className="text-red-500">*</span></label>
                    <input className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white font-bold outline-none focus:ring-2 focus:ring-blue-500/50" value={editingJob.partNumber || ''} autoComplete="off" onChange={e => {
                      setEditingJob({ ...editingJob, partNumber: e.target.value });
                      const q = e.target.value.toLowerCase();
                      setPartSuggestions(q.length >= 2 ? jobs.filter(j => j.partNumber?.toLowerCase().includes(q) && j.partNumber !== e.target.value).reduce((acc: Job[], j) => acc.find(a => a.partNumber === j.partNumber) ? acc : [...acc, j], [] as Job[]).slice(0, 5) : []);
                    }} onBlur={() => setTimeout(() => setPartSuggestions([]), 200)} placeholder="e.g. 123-ABC-001" />
                    {partSuggestions.length > 0 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-zinc-900 border border-white/10 rounded-xl overflow-hidden shadow-2xl">
                        <div className="px-3 py-1.5 bg-zinc-800/50 text-[10px] text-zinc-500 font-bold uppercase">Previous Parts — tap to auto-fill</div>
                        {partSuggestions.map(s => (
                          <button key={s.id} className="w-full text-left px-3 py-2.5 hover:bg-blue-500/10 border-t border-white/5 transition-colors" onClick={() => {
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
                    <input className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white font-mono outline-none focus:ring-2 focus:ring-blue-500/50 placeholder-zinc-600" value={editingJob.jobIdsDisplay || ''} onChange={e => setEditingJob({ ...editingJob, jobIdsDisplay: e.target.value })} placeholder="e.g. J-001234" />
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
                  <div><label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Quantity</label><input type="number" className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white font-mono outline-none focus:ring-2 focus:ring-emerald-500/50" value={editingJob.quantity || ''} onChange={e => setEditingJob({ ...editingJob, quantity: Number(e.target.value) })} placeholder="0" /></div>
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
                      {clients.length > 0 ? (
                        <select
                          className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-orange-500/50"
                          value={editingJob.customer || ''}
                          onChange={e => setEditingJob({ ...editingJob, customer: e.target.value })}
                        >
                          <option value="">— Select a client —</option>
                          {clients.sort((a, b) => a.localeCompare(b)).map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      ) : (
                        <input className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-orange-500/50" value={editingJob.customer || ''} onChange={e => setEditingJob({ ...editingJob, customer: e.target.value })} placeholder="Client or Company Name" />
                      )}
                      {clients.length === 0 && <p className="text-xs text-zinc-500 mt-1">💡 Add clients in <span className="text-purple-400 font-bold">Settings → Clients</span> to get a dropdown here.</p>}
                    </div>
                  )}
                  <div><label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Priority Level</label><select className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-orange-500/50" value={editingJob.priority || 'normal'} onChange={e => setEditingJob({ ...editingJob, priority: e.target.value as any })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
                </div>
                <div>
                  <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Notes / Special Instructions</label>
                  <textarea className="w-full bg-zinc-950 border border-white/10 rounded-xl p-4 text-white min-h-[140px] outline-none focus:ring-2 focus:ring-orange-500/50 resize-y leading-relaxed" value={editingJob.info || ''} onChange={e => setEditingJob({ ...editingJob, info: e.target.value })} placeholder="Enter any process details, material specs, or special requirements here..." rows={5} />
                </div>
              </div>

              <div className="space-y-5">
                <h4 className="text-xs font-black text-emerald-400 uppercase tracking-[0.2em] border-b border-emerald-500/20 pb-2 flex items-center gap-2">
                  <span className="bg-emerald-500/10 text-emerald-400 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black">4</span>
                  Job Costing <span className="text-zinc-600 normal-case font-normal text-[10px]">(optional)</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Quote / Revenue Amount ($)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-3 text-zinc-500 font-bold text-lg">$</span>
                      <input type="number" step="0.01" className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 pl-9 text-white font-mono text-lg outline-none focus:ring-2 focus:ring-emerald-500/50" value={editingJob.quoteAmount || ''} onChange={e => setEditingJob({ ...editingJob, quoteAmount: Number(e.target.value) || 0 })} placeholder="0.00" />
                    </div>
                    <p className="text-[10px] text-zinc-600 mt-1">What the customer is paying. Profit calculated when complete.</p>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Expected Hours <span className="text-zinc-600 normal-case">(budget)</span></label>
                    <div className="relative">
                      <span className="absolute left-4 top-3 text-zinc-500 font-bold text-lg">⏱</span>
                      <input type="number" step="0.5" className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 pl-9 text-white font-mono text-lg outline-none focus:ring-2 focus:ring-emerald-500/50" value={editingJob.expectedHours || ''} onChange={e => setEditingJob({ ...editingJob, expectedHours: Number(e.target.value) || 0 })} placeholder="0" />
                    </div>
                    <p className="text-[10px] text-zinc-600 mt-1">Time budget. Job row shows red badge if actual exceeds this.</p>
                  </div>
                </div>
              </div>

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
                    <button onClick={() => { printJobTravelerPDF(editingJob as Job, shopSettings); }} className="bg-zinc-700 hover:bg-zinc-600 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors flex items-center gap-2"><Download className="w-4 h-4" /> Job Traveler</button>
                  </div>
                )}
              </div>
              )}

              {/* ── Operation Checklist (Jobs R1 #1) ── */}
              {editingJob.id && (
                <JobChecklistSection
                  job={editingJob as Job}
                  onUpdate={(items) => setEditingJob({ ...editingJob, checklist: items })}
                  user={user}
                />
              )}

              {/* ── Attachments (Jobs R1 #2) ── */}
              {editingJob.id && (
                <JobAttachmentsSection
                  job={editingJob as Job}
                  onUpdate={(atts) => setEditingJob({ ...editingJob, attachments: atts })}
                  user={user}
                  addToast={addToast}
                />
              )}

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
            </div>
            <div className="p-5 border-t border-white/10 bg-zinc-800/50 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-6 py-3 text-zinc-400 hover:text-white font-medium transition-colors">Cancel</button>
              <button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-blue-900/20 flex items-center gap-2"><Save className="w-4 h-4" /> Save Job</button>
            </div>
          </div>
        </div>
      )}

      {startJobModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-xl p-0 sm:p-4 animate-fade-in">
          <div className="bg-zinc-900 border border-white/10 w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">

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
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${!selectedWorker ? 'bg-blue-600 border-blue-500 text-white' : 'bg-zinc-800 border-white/10 text-zinc-300 hover:border-white/30'}`}
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
                    <button key={op} onClick={() => handleAdminStartJob(op)} className="bg-zinc-800 hover:bg-blue-600 hover:text-white border border-white/5 py-3 px-3 rounded-xl text-sm font-medium text-zinc-300 transition-colors">{op}</button>
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
      )}

      {/* Part Image Lightbox */}
      {lightboxImg && <PartImageLightbox src={lightboxImg} onClose={() => setLightboxImg(null)} />}

      {/* Rework modal — opened from the row's AlertTriangle button */}
      {reworkModal && <ReworkModal entry={reworkModal} jobs={jobs} user={user} onClose={() => setReworkModal(null)} addToast={addToast} />}
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
          <h2 className="text-2xl font-black text-white flex items-center gap-2 tracking-tight"><Users className="w-6 h-6 text-blue-500" /> Team</h2>
          <p className="text-sm text-zinc-500 mt-0.5">{users.length} member{users.length !== 1 ? 's' : ''} · {admins.length} admin · {managers.length} manager{managers.length !== 1 ? 's' : ''} · {workers.length} worker{workers.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowBadges(true)} disabled={users.length === 0} className="bg-zinc-800/80 hover:bg-zinc-700 border border-white/10 text-white px-4 py-2.5 rounded-xl flex items-center gap-2 text-sm font-bold transition-all disabled:opacity-40" title="Print QR sign-in badges">
            <QrCode className="w-4 h-4" aria-hidden="true" /> Print Badges
          </button>
          <button onClick={openNew} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-5 py-2.5 rounded-xl flex items-center gap-2 text-sm font-bold shadow-lg shadow-blue-900/40 transition-all">
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

      {/* Onboarding Wizard Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-xl p-0 sm:p-4 animate-fade-in" onClick={closeModal}>
          <div className="bg-zinc-900/95 backdrop-blur-xl border border-white/10 w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-slide-up" style={{ boxShadow: '0 24px 60px -12px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04)' }} onClick={e => e.stopPropagation()}>
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
                    <div key={s} className={`flex-1 h-1 rounded-full transition-all duration-500 ${s < wizardStep ? 'bg-gradient-to-r from-blue-500 to-indigo-500' : s === wizardStep ? 'bg-blue-500' : 'bg-zinc-800'}`} />
                  ))}
                </div>
                <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider mt-2 text-zinc-600">
                  <span className={wizardStep >= 1 ? 'text-blue-400' : ''}>Role</span>
                  <span className={wizardStep >= 2 ? 'text-blue-400' : ''}>Identity</span>
                  <span className={wizardStep >= 3 ? 'text-blue-400' : ''}>Access</span>
                  <span className={wizardStep >= 4 ? 'text-blue-400' : ''}>Review</span>
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
                        className={`w-full flex items-start gap-3 p-4 rounded-2xl border text-left transition-all ${active ? 'bg-gradient-to-br from-blue-500/15 to-indigo-500/5 border-blue-500/40 ring-1 ring-blue-500/30' : 'bg-zinc-900/50 border-white/5 hover:border-white/15 hover:bg-zinc-900/80'}`}
                      >
                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${meta.accent} flex items-center justify-center shadow-lg shrink-0`}>
                          <Icon className="w-5 h-5 text-white" aria-hidden="true" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white">{meta.label}</span>
                            {active && <span className="text-[10px] font-black text-blue-400 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded">SELECTED</span>}
                          </div>
                          <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{meta.description}</p>
                        </div>
                        {active && <CheckCircle className="w-5 h-5 text-blue-400 shrink-0" aria-hidden="true" />}
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
                      <button type="button" onClick={() => setEditingUser({ ...editingUser, pin: randomPin() })} className="text-[11px] text-blue-400 hover:text-blue-300 font-semibold">Generate</button>
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
                    <label className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900/60 border border-white/5 cursor-pointer">
                      <input type="checkbox" checked={editingUser.isActive !== false} onChange={e => setEditingUser({ ...editingUser, isActive: e.target.checked })} className="w-4 h-4 rounded bg-zinc-800 border-white/10 text-blue-600 focus:ring-blue-500" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-white">Active</p>
                        <p className="text-[10px] text-zinc-500">Inactive members can't sign in but their history stays intact.</p>
                      </div>
                    </label>
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
                      <div className="bg-gradient-to-br from-blue-500/10 to-indigo-500/5 border border-blue-500/25 rounded-2xl p-4 flex items-center gap-4">
                        <div className="shrink-0 p-2 bg-white rounded-xl">
                          <img src={qrUrl} alt={`QR code for ${editingUser.name}`} className="w-24 h-24 block" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-black text-blue-300 uppercase tracking-widest">Scan to sign in</p>
                          <p className="text-[11px] text-blue-400/80 mt-1 leading-snug">Have {editingUser.name?.split(' ')[0] || 'them'} scan this with their phone camera to open the app. They'll just need to enter their PIN.</p>
                          <button
                            type="button"
                            onClick={async () => {
                              const text = `${editingUser.name} — sign-in\nUsername: ${editingUser.username}\nPIN: ${editingUser.pin}\nApp: ${window.location.origin}`;
                              try { await navigator.clipboard.writeText(text); setCopiedInvite(true); setTimeout(() => setCopiedInvite(false), 2000); } catch {}
                            }}
                            className="mt-2 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-colors"
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
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-blue-900/40 flex items-center gap-2 transition-all"
                >
                  <Save className="w-4 h-4" aria-hidden="true" />
                  {isEditing ? 'Save Changes' : 'Invite Member'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => canNextWizard && setWizardStep(wizardStep + 1)}
                  disabled={!canNextWizard}
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-blue-900/40 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-all"
                >
                  Continue <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Badge Sheet — printable 4-up QR badge grid */}
      {showBadges && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xl p-0 sm:p-4 animate-fade-in no-print" onClick={() => setShowBadges(false)}>
          <div className="bg-zinc-900 border border-white/10 w-full max-w-5xl rounded-none sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-screen sm:max-h-[92vh]" onClick={e => e.stopPropagation()}>
            {/* Header — hidden in print */}
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between bg-gradient-to-b from-zinc-800/40 to-transparent shrink-0 no-print">
              <div>
                <h3 className="font-black text-white text-base tracking-tight flex items-center gap-2"><QrCode className="w-4 h-4 text-blue-400" aria-hidden="true" /> Sign-In Badges</h3>
                <p className="text-[11px] text-zinc-500 mt-0.5">Print, cut, and laminate. Workers scan their badge to sign in instantly.</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => window.print()} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg shadow-blue-900/30 transition-all">
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
      )}
    </div>
  );
};

// --- ADMIN: SETTINGS ---
// Safari requires applicationServerKey as Uint8Array, not a raw base64url string
function vapidKeyToUint8(base64: string): Uint8Array {
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

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

// ── AI HEALTH PANEL ──
// Verifies that /.netlify/functions/gemini exists, the key is configured,
// and a round-trip prompt returns text. Mirrors the Push panel's UX.
const AIHealthPanel = ({ addToast }: { addToast: any }) => {
  const [status, setStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);
  const [lastModel, setLastModel] = useState<string | null>(null);
  const [lastMsg, setLastMsg] = useState('');

  // Passive check on mount — doesn't actually hit Gemini, just verifies the
  // endpoint exists and the env var is set.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/.netlify/functions/gemini', { method: 'GET' });
        if (res.ok) {
          const d = await res.json().catch(() => ({}));
          setKeyConfigured(!!d.keyConfigured);
        } else {
          setKeyConfigured(false);
        }
      } catch { setKeyConfigured(false); }
    })();
  }, []);

  const runTest = async () => {
    setStatus('checking');
    setLastMsg('Sending round-trip test to Gemini…');
    try {
      const res = await fetch('/.netlify/functions/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Reply with exactly: AI_OK' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${res.status}`);
      }
      const d = await res.json();
      if (!d.text) throw new Error('Empty response from Gemini');
      setLastModel(d.model || null);
      setStatus('ok');
      setLastMsg(`Working — reply: "${String(d.text).slice(0, 60)}"`);
      addToast('success', '✅ AI is working');
    } catch (e: any) {
      setStatus('error');
      const msg = e?.message || 'Unknown error';
      setLastMsg(msg);
      addToast('error', msg);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="font-bold text-white flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" /> AI Status</h3>
      <p className="text-[10px] text-zinc-500 leading-relaxed">
        The PO scanner uses Gemini to extract purchase-order details from photos. If you get "Scan failed" errors, check here first.
      </p>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${keyConfigured === null ? 'bg-zinc-800/50 text-zinc-500' : keyConfigured ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
          <span>{keyConfigured === null ? '⏳' : keyConfigured ? '✅' : '❌'}</span>
          <span>API Key</span>
        </div>
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${status === 'ok' ? 'bg-emerald-500/10 text-emerald-400' : status === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-zinc-800/50 text-zinc-500'}`}>
          <span>{status === 'ok' ? '✅' : status === 'error' ? '❌' : '⏸'}</span>
          <span>Round-trip{lastModel ? ` · ${lastModel.replace('gemini-', '')}` : ''}</span>
        </div>
      </div>
      {keyConfigured === false && (
        <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-3 text-xs text-red-300 space-y-1">
          <p className="font-bold">GEMINI_API_KEY not set</p>
          <p className="text-red-300/80 leading-relaxed">
            In Netlify → Site settings → Environment variables, add <code className="bg-black/40 px-1 rounded">GEMINI_API_KEY</code>. Get a free key at <a href="https://ai.google.dev/" target="_blank" rel="noreferrer" className="underline">ai.google.dev</a>.
          </p>
        </div>
      )}
      {lastMsg && (
        <div className={`text-xs px-3 py-2 rounded-lg break-words ${status === 'error' ? 'bg-red-500/10 text-red-300' : status === 'ok' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-blue-500/10 text-blue-300'}`}>
          {status === 'checking' && <span className="animate-pulse">⏳ </span>}{lastMsg}
        </div>
      )}
      <button
        type="button"
        onClick={runTest}
        disabled={status === 'checking'}
        className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2"
      >
        <Zap className="w-4 h-4" />
        {status === 'checking' ? 'Testing…' : 'Test AI Connection'}
      </button>
    </div>
  );
};

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
import { computeGoalProgress as computeGoalProgressForGoal, formatGoalValue as formatGoalDisplay } from './utils/goals';

// ── Shift Alarms editor — fully customizable break + lunch + clock-out alerts.
// Each alarm fires an audible sound + browser notification at its configured time.
// Admin can add as many as needed (morning break, lunch, afternoon break, end-of-shift, etc.)
import { getActiveAlarms } from './services/shiftAlarms';
import type { ShiftAlarm, ShiftAlarmSound } from './types';

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

  const loadDefaults = () => {
    if (alarms.length > 0 && !confirm('Replace current alarms with the default set (Morning Break · Lunch · Afternoon Break · Shift End)?')) return;
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

  useEffect(() => DB.subscribeJobs(setJobs), []);

  // Aggregate: unique customer strings from jobs + manually-added clients
  const rows = useMemo(() => {
    const map = new Map<string, { jobs: number; active: number; completed: number; lastSeen: number }>();
    jobs.forEach(j => {
      const c = (j.customer || '').trim();
      if (!c) return;
      const cur = map.get(c) || { jobs: 0, active: 0, completed: 0, lastSeen: 0 };
      cur.jobs++;
      if (j.status === 'completed') cur.completed++; else cur.active++;
      cur.lastSeen = Math.max(cur.lastSeen, j.completedAt || j.createdAt || 0);
      map.set(c, cur);
    });
    // Merge in manually-added clients with 0 jobs
    (settings.clients || []).forEach(c => {
      if (!map.has(c)) map.set(c, { jobs: 0, active: 0, completed: 0, lastSeen: 0 });
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
            <p className="text-sm font-bold text-white">Customers</p>
            <span className="text-[10px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded-full font-bold">{rows.length}</span>
          </div>
          <p className="text-[11px] text-zinc-500 mt-0.5">Found from your jobs + manually added. Select duplicates and merge to clean up reports.</p>
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
      <div className="max-h-[400px] overflow-y-auto">
        {rows.length === 0 ? (
          <p className="p-6 text-center text-zinc-500 text-xs italic">No customers yet. Scan a PO or add one above.</p>
        ) : (
          <div className="divide-y divide-white/5">
            {rows.map(r => {
              const isSelected = selected.has(r.name);
              const slug = settings.clientSlugs?.[r.name] || makeClientSlug(r.name);
              const hasCustomSlug = !!settings.clientSlugs?.[r.name];
              return (
                <div key={r.name} className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${isSelected ? 'bg-blue-500/10' : 'hover:bg-white/[0.03]'}`}>
                  <input type="checkbox" checked={isSelected} onChange={() => toggle(r.name)} className="w-4 h-4 rounded bg-zinc-800 border-white/10 text-blue-600 focus:ring-blue-500 shrink-0 cursor-pointer" aria-label={`Select ${r.name}`} />
                  <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-white truncate" title={r.name}>{r.name}</span>
                    {/* Short URL slug — editable pill */}
                    <div className="flex items-center gap-1 bg-zinc-800/80 rounded px-1.5 py-0.5 border border-white/5 group/slug">
                      <span className="text-[9px] text-zinc-600 font-mono">?c=</span>
                      <input
                        value={slug}
                        onChange={(e) => {
                          const cleaned = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
                          const slugs = { ...(settings.clientSlugs || {}) };
                          if (cleaned) slugs[r.name] = cleaned;
                          else delete slugs[r.name];
                          onSaveSettings({ ...settings, clientSlugs: slugs });
                        }}
                        className={`bg-transparent border-none outline-none text-[10px] font-mono tabular w-24 p-0 ${hasCustomSlug ? 'text-emerald-400' : 'text-zinc-400'}`}
                        aria-label={`URL slug for ${r.name}`}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const url = buildPortalUrl(r.name, { ...settings, clientSlugs: { ...(settings.clientSlugs || {}), [r.name]: slug } });
                          navigator.clipboard.writeText(url).then(() => addToast('success', `Copied: ${url.slice(0, 60)}${url.length > 60 ? '…' : ''}`)).catch(() => prompt('Copy:', url));
                        }}
                        aria-label={`Copy portal link for ${r.name}`}
                        title="Copy portal URL"
                        className="text-zinc-500 hover:text-emerald-400 p-0.5 transition-colors"
                      >
                        <Copy className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono tabular text-zinc-400 shrink-0">{r.jobs} job{r.jobs !== 1 ? 's' : ''}</span>
                  {r.active > 0 && <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded shrink-0">{r.active} active</span>}
                  {r.jobs === 0 && <button type="button" aria-label={`Remove ${r.name}`} onClick={(e) => { e.preventDefault(); onSaveSettings({ ...settings, clients: (settings.clients || []).filter(c => c !== r.name) }); }} className="text-zinc-500 hover:text-red-400 p-1 rounded shrink-0"><X className="w-3 h-3" aria-hidden="true" /></button>}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {rows.length > 0 && (
        <div className="px-4 py-2 border-t border-white/5 bg-zinc-950/40">
          <p className="text-[10px] text-zinc-600 leading-relaxed">
            💡 <strong className="text-zinc-500">Short URL slug:</strong> each customer gets a tidy portal link like <code className="font-mono text-emerald-400">?c=acme-corp</code>. Edit inline → copy with the 📋 icon.
          </p>
        </div>
      )}
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
          .then(r => r.json()).then(d => setTemp(d.current?.temperature_2m ? Math.round(d.current.temperature_2m) : null)).catch(() => {});
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
          .then(r => r.json()).then(d => setTemp(d.current?.temperature_2m ? Math.round(d.current.temperature_2m) : null)).catch(() => {});
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
      const d = await res.json();
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
                    onClick={() => {
                      if (alreadyExists && !confirm(`You already have a "${meta.label}" slide. Adding another will show the same content twice. Continue?`)) return;
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
              onClick={() => {
                // Load the default lineup so user can customize from a clean state
                if (!confirm('Replace current slides with defaults (Workers · Jobs · Leaderboard · Goals · Week Stats · Weather)?')) return;
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
              onClick={() => { if (confirm('Clear all slides? (Defaults will run instead.)')) setSettings({ ...settings, tvSlides: [] }); }}
              className="w-full text-[10px] text-zinc-600 hover:text-red-400 py-1 transition-colors"
            >
              Clear all (use built-in defaults)
            </button>
          </div>
        )}
      </div>
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

const SettingsView = ({ addToast, userId }: { addToast: any; userId?: string }) => {
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

  const sideItems: { id: typeof settingsTab; label: string; icon: any }[] = [
    { id: 'profile', label: 'Shop Profile', icon: Briefcase },
    { id: 'schedule', label: 'Schedule', icon: Clock },
    { id: 'production', label: 'Production', icon: Activity },
    { id: 'financial', label: 'Financial', icon: Calculator },
    { id: 'goals', label: 'Goals', icon: Zap },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'tv', label: 'TV Display', icon: Activity },
    { id: 'system', label: 'System', icon: Settings },
  ];

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
      {/* Left sidebar nav — desktop only (sticks on scroll) */}
      <aside className="w-48 xl:w-56 flex-shrink-0 hidden md:block">
        <div className="sticky top-4 space-y-1">
          <div className="flex items-center justify-between px-3 mb-3">
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Settings</p>
            {savedFlash && (
              <span className="text-[10px] font-black text-emerald-400 flex items-center gap-1 animate-fade-in">
                <CheckCircle className="w-3 h-3" aria-hidden="true" /> Saved
              </span>
            )}
          </div>
          {sideItems.map(item => (
            <button key={item.id} onClick={() => setSettingsTab(item.id)}
              aria-current={settingsTab === item.id ? 'page' : undefined}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all text-left ${settingsTab === item.id ? 'bg-blue-500/10 border border-blue-500/20 text-white font-bold shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent'}`}>
              <item.icon className={`w-4 h-4 flex-shrink-0 ${settingsTab === item.id ? 'text-blue-400' : ''}`} aria-hidden="true" />{item.label}
            </button>
          ))}
          <div className="border-t border-white/5 mt-4 pt-4 space-y-2">
            <p className="text-[10px] text-zinc-600 px-3">Changes save automatically as you edit.</p>
            <button onClick={handleSave} className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-3 py-2 rounded-lg font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-900/40"><Save className="w-4 h-4" aria-hidden="true" /> Save Now</button>
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
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 shrink-0 ${settingsTab === item.id ? 'bg-blue-600 text-white shadow-md shadow-blue-900/40' : 'text-zinc-400 hover:text-white bg-zinc-900/50 border border-white/5'}`}>
                <item.icon className="w-3.5 h-3.5" aria-hidden="true" /> {item.label}
              </button>
            ))}
          </div>
          {savedFlash && (
            <p className="text-[10px] font-black text-emerald-400 mt-2 flex items-center gap-1"><CheckCircle className="w-3 h-3" aria-hidden="true" /> Saved</p>
          )}
        </div>

      {/* ── TAB: General ── */}
      {/* ── SHOP PROFILE ── */}
      {settingsTab === 'profile' && (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-bold text-white mb-1">Shop Profile</h3>
            <p className="text-sm text-zinc-500">Your company information used in headers and print travelers.</p>
          </div>
          <div>
            <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-zinc-500 block mb-1">Company Name</label>
                  <input className="w-full bg-zinc-950 border border-white/10 rounded px-3 py-1.5 text-sm text-white" value={settings.companyName || ''} onChange={e => setSettings({ ...settings, companyName: e.target.value })} placeholder="SC Deburring LLC" />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 block mb-1">Phone</label>
                  <input className="w-full bg-zinc-950 border border-white/10 rounded px-3 py-1.5 text-sm text-white" value={settings.companyPhone || ''} onChange={e => setSettings({ ...settings, companyPhone: e.target.value })} placeholder="(555) 123-4567" />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-zinc-500 block mb-1">Address</label>
                <input className="w-full bg-zinc-950 border border-white/10 rounded px-3 py-1.5 text-sm text-white" value={settings.companyAddress || ''} onChange={e => setSettings({ ...settings, companyAddress: e.target.value })} placeholder="123 Industrial Blvd, City, ST 12345" />
              </div>
              <div>
                <label className="text-[10px] text-zinc-500 block mb-1">Company Logo</label>
                <div className="flex gap-3 items-start">
                  <div
                    className="flex-1 border-2 border-dashed border-white/10 rounded-xl p-4 text-center cursor-pointer hover:border-blue-500/40 hover:bg-blue-500/5 transition-all"
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
                          const maxW = 400;
                          const scale = Math.min(1, maxW / img.width);
                          canvas.width = img.width * scale;
                          canvas.height = img.height * scale;
                          canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
                          const dataUrl = canvas.toDataURL('image/png', 0.9);
                          const updated = { ...settings, companyLogo: dataUrl };
                          setSettings(updated);
                          DB.saveSettings(updated);
                          addToast('success', 'Logo uploaded & saved');
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
                        if (file) {
                          const img = new window.Image();
                          img.onload = () => {
                            const canvas = document.createElement('canvas');
                            const maxW = 400;
                            const scale = Math.min(1, maxW / img.width);
                            canvas.width = img.width * scale;
                            canvas.height = img.height * scale;
                            canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
                            const dataUrl = canvas.toDataURL('image/png', 0.9);
                            const updated = { ...settings, companyLogo: dataUrl };
                            setSettings(updated);
                            DB.saveSettings(updated);
                            addToast('success', 'Logo uploaded & saved');
                          };
                          img.src = URL.createObjectURL(file);
                        }
                      };
                      input.click();
                    }}
                  >
                    {settings.companyLogo ? (
                      <img src={settings.companyLogo} alt="Logo" className="max-h-16 mx-auto object-contain" />
                    ) : (
                      <div className="text-zinc-500">
                        <Image className="w-8 h-8 mx-auto mb-1 text-zinc-600" />
                        <p className="text-xs">Drop your logo here or click to upload</p>
                        <p className="text-[10px] text-zinc-600 mt-0.5">PNG, JPG, SVG</p>
                      </div>
                    )}
                  </div>
                  {settings.companyLogo && (
                    <button onClick={() => { setSettings({ ...settings, companyLogo: '' }); addToast('info', 'Logo removed'); }} className="text-zinc-600 hover:text-red-400 text-xs shrink-0 mt-2">Remove</button>
                  )}
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
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-bold text-white mb-1">Production</h3>
            <p className="text-sm text-zinc-500">Operations, clients, and workflow configuration.</p>
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
              }} className="text-[10px] bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg font-bold">+ Add Stage</button>
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
                  <p className="text-sm font-medium text-white">Operations</p>
                  <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full font-bold">{(settings.customOperations || []).length}</span>
                </div>
                <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${opsOpen ? 'rotate-180' : ''}`} />
              </button>
              {opsOpen && (
                <div className="px-4 pb-4 space-y-3 border-t border-white/5">
                  <div className="flex gap-2 mt-3">
                    <input value={newOp} onChange={e => setNewOp(e.target.value)} placeholder="Add operation..." className="flex-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white" onKeyDown={e => e.key === 'Enter' && handleAddOp()} />
                    <button onClick={handleAddOp} className="bg-blue-600 hover:bg-blue-500 px-3 rounded-lg text-white text-xs font-bold">Add</button>
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

          {/* Operations → Stages mapper — the unified drag-and-drop board
              that makes smart auto-routing configurable in one screen.
              Replaces the old per-stage "Auto-route operations" disclosure. */}
          <OperationsStageMapper settings={settings} setSettings={setSettings} />

          {/* Machines / Stations — physical work locations */}
          <MachineManager settings={settings} onSaveSettings={(s: SystemSettings) => setSettings(s)} />

          {/* Process Library — reusable pricing templates that pre-fill quote line items */}
          <ProcessLibraryManager settings={settings} setSettings={setSettings} />

          {/* Customers — merge/dedupe tool */}
          <CustomerManager addToast={addToast} settings={settings} onSaveSettings={(s: SystemSettings) => setSettings(s)} />
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
              <div className="sticky top-4 bg-zinc-900 border border-white/5 rounded-2xl p-8 text-center">
                <div className="text-5xl mb-3">📋</div>
                <p className="text-sm font-black text-white">Job Traveler Preview</p>
                <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed max-w-xs mx-auto">
                  The Traveler is rendered per-job with that job's data.
                  <br />Open any job → <strong className="text-zinc-300">Print Traveler</strong> to see your changes live.
                </p>
              </div>
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
        );
      })()}

      {/* ── TV DISPLAY — Split-pane with live preview ── */}
      {settingsTab === 'tv' && (
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
                          <button onClick={() => { if (confirm('Generate a new TV link? The old one will stop working.')) { setSettings({ ...settings, tvToken: crypto.randomUUID().replace(/-/g, '').slice(0, 16) }); } }} className="px-3 py-2 bg-white/5 hover:bg-red-500/20 text-zinc-400 hover:text-red-400 text-xs font-bold rounded-lg transition-colors">Reset</button>
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
      )}

      {/* ── SYSTEM ── */}
      {settingsTab === 'system' && (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-bold text-white mb-1">System</h3>
            <p className="text-sm text-zinc-500">Defaults, notifications, and system information.</p>
          </div>
          {/* Worker Defaults */}
          <div>
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Worker Defaults</p>
            <div className="bg-zinc-900/50 border border-white/5 rounded-xl">
              <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                <div>
                  <p className="text-sm text-white">Weekly Goal Hours</p>
                  <p className="text-xs text-zinc-500">Target shown on worker stats page</p>
                </div>
                <input type="number" className="bg-zinc-950 border border-white/10 rounded px-2 py-1 text-white text-sm w-20 text-center" value={settings.weeklyGoalHours || 40} onChange={e => setSettings({ ...settings, weeklyGoalHours: Number(e.target.value) || 40 })} />
              </div>
              <div className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm text-white">Default Job Priority</p>
                  <p className="text-xs text-zinc-500">Used when creating new jobs</p>
                </div>
                <select className="bg-zinc-950 border border-white/10 rounded px-2 py-1 text-white text-sm" value={settings.defaultPriority || 'normal'} onChange={e => setSettings({ ...settings, defaultPriority: e.target.value })}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
          </div>

          {/* Notifications */}
          {/* Notifications — dev-only diagnostic panel.
              End users get push via the bell icon in the header; this card
              exists to troubleshoot subscription + service-worker issues, which
              means VAPID env vars and jargon that would confuse a shop owner. */}
          {isDeveloper() && (
            <div>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Notifications <span className="text-[9px] text-amber-400 normal-case tracking-normal">(dev only)</span></p>
              <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-4">
                <PushRegistrationPanel addToast={addToast} userId={userId} />
              </div>
            </div>
          )}

          {/* AI Status — dev-only. Shop owners don't manage our Netlify env vars. */}
          {isDeveloper() && (
            <div>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">AI Assistant <span className="text-[9px] text-amber-400 normal-case tracking-normal">(dev only)</span></p>
              <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-4">
                <AIHealthPanel addToast={addToast} />
              </div>
            </div>
          )}

          {/* System Info — always shown, but with end-user-friendly labels.
              Raw Firebase connection status is gated behind dev mode. */}
          <div>
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">System</p>
            <div className="bg-zinc-900/50 border border-white/5 rounded-xl">
              {isDeveloper() && (
                <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                  <div>
                    <p className="text-sm text-white">Firebase Status <span className="text-[9px] text-amber-400">(dev)</span></p>
                    <p className="text-xs text-zinc-500">Database connection</p>
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${DB.isFirebaseConnected().connected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>{DB.isFirebaseConnected().connected ? 'Connected' : 'Offline'}</span>
                </div>
              )}
              <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                <div>
                  <p className="text-sm text-white">Operations</p>
                  <p className="text-xs text-zinc-500">How many operation types are set up</p>
                </div>
                <span className="text-sm text-zinc-300 font-mono">{(settings.customOperations || []).length} configured</span>
              </div>
              <div className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm text-white">Version</p>
                  <p className="text-xs text-zinc-500">SC Project Tracker</p>
                </div>
                <span className="text-xs text-zinc-500 font-mono">v2.0</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile save */}
      <div className="flex justify-end mt-6 pb-8 md:hidden">
        <button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg font-bold text-sm flex items-center gap-2"><Save className="w-4 h-4" /> Save</button>
      </div>
      </div>
    </div>
  );
};

// --- APP ROOT ---
// PROGRESS VIEW - Worker stats
function ProgressView({ userId, userName, recentLogs = [] }: { userId: string; userName: string; recentLogs?: TimeLog[] }) {
  const [progress, setProgress] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!userId) return;
    const unsub = DB.subscribeUserProgress(userId, (data: any) => {
      setProgress(data);
      setLoading(false);
    });
    return () => unsub();
  }, [userId]);

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

      {/* Summary cards — wide */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 rounded-2xl p-4 text-center overflow-hidden">
          <p className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em]">This Week</p>
          <p className="text-2xl sm:text-3xl font-black text-blue-400 tabular mt-1 leading-none">{fmtHours(weekHrsCalc)}</p>
          <div className="h-0.5 rounded-full bg-gradient-to-r from-transparent via-blue-500/50 to-transparent mt-2" aria-hidden="true" />
        </div>
        <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 rounded-2xl p-4 text-center overflow-hidden">
          <p className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em]">Operations</p>
          <p className="text-2xl sm:text-3xl font-black text-purple-400 tabular mt-1 leading-none">{weekOps}</p>
          <div className="h-0.5 rounded-full bg-gradient-to-r from-transparent via-purple-500/50 to-transparent mt-2" aria-hidden="true" />
        </div>
        <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 rounded-2xl p-4 text-center overflow-hidden">
          <p className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em]">Today</p>
          <p className="text-2xl sm:text-3xl font-black text-emerald-400 tabular mt-1 leading-none">
            {todayMins >= 60 ? `${Math.floor(todayMins/60)}h ${todayMins%60}m` : `${todayMins}m`}
          </p>
          <div className="h-0.5 rounded-full bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent mt-2" aria-hidden="true" />
        </div>
      </div>

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

export default function App() {
  // Check for TV mode (?tv=TOKEN — standalone fullscreen TV for any account)
  const [tvToken] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('tv') || null;
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
  const [showPOScanner, setShowPOScanner] = useState(false);
  const [appSettings, setAppSettings] = useState<SystemSettings>(DB.getSettings());
  // For notifications  track all jobs and active logs globally
  const [allJobs, setAllJobs] = useState<Job[]>([]);
  const [allActiveLogs, setAllActiveLogs] = useState<TimeLog[]>([]);
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
    const unsub2 = DB.subscribeLogs(logs => setAllActiveLogs(logs.filter((l: TimeLog) => !l.endTime)));
    return () => { unsub1(); unsub2(); };
  }, [user]);

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
    return <LiveFloorMonitor standalone />;
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

 const allNavItems: { id: string; l: string; i: any; adminOnly?: boolean }[] = [
    { id: 'admin-dashboard', l: 'Overview',     i: LayoutDashboard },
    { id: 'admin-jobs',      l: 'Jobs',         i: Briefcase },
    { id: 'admin-board',     l: 'Board',        i: Columns3 },
    { id: 'admin-calendar',  l: 'Calendar',     i: Calendar },
    { id: 'admin-live',      l: 'Live Floor',   i: Activity },
    { id: 'admin-logs',      l: 'Logs',         i: History },
    { id: 'admin-quotes',    l: 'Quotes',       i: FileText },
    { id: 'admin-samples',   l: 'Samples',      i: Camera },
    { id: 'admin-quality',   l: 'Quality',      i: AlertTriangle },
    { id: 'admin-deliveries',l: 'Deliveries',   i: Truck },
    { id: 'admin-reports',   l: 'Reports',      i: Calculator },
    { id: 'admin-team',      l: 'Team',         i: Users },
    { id: 'admin-scan',      l: 'Work Station', i: ScanLine },
    { id: 'admin-settings',  l: 'Settings',     i: Settings, adminOnly: true },
  ];
  // Managers see everything EXCEPT Settings (admin-only billing/config surface)
  const navItems = allNavItems.filter(n => !n.adminOnly || user?.role === 'admin');

 //  PO SCANNER 
  const handlePOJobCreate = async (jobData: { poNumber: string; partNumber: string; customer: string; quantity: number; dueDate: string; dateReceived?: string; priority?: string; info: string; specialInstructions?: string; }) => {

    // Safety Fallback: Clear the placeholder if the AI failed to find a date
    let cleanDueDate = jobData.dueDate;
    if (cleanDueDate === "MM/DD/YYYY" || !cleanDueDate) {
      cleanDueDate = "";
    }

    const newJob: Job = {
      id: `job_${Date.now()}_${Math.random().toString(36).substr(2,9)}`,
      jobIdsDisplay: `J-${Date.now().toString().slice(-6)}`,
      poNumber: jobData.poNumber,
      partNumber: jobData.partNumber,
      customer: jobData.customer || '',
      quantity: jobData.quantity,
      dueDate: normDate(cleanDueDate),
      dateReceived: jobData.dateReceived || todayFmt(),
      info: jobData.info,
      specialInstructions: jobData.specialInstructions || '',
      status: 'pending',
      priority: (jobData.priority as any) || 'normal',
      createdAt: Date.now(),
    };
    await DB.saveJob(newJob);
  };

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100 flex font-sans">
      <a href="#main-content" className="skip-link">Skip to main content</a>
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
            <div aria-hidden="true" className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-blue-500/40 to-transparent" />

            <div className={`font-bold text-white flex items-center ${sidebarCollapsed ? 'md:flex-col md:p-3 md:gap-3 md:justify-center p-5 justify-between gap-3' : 'p-5 justify-between gap-3'}`}>
              <div className={`flex items-center gap-2.5 min-w-0 ${sidebarCollapsed ? 'md:justify-center' : ''}`}>
                <div className="relative shrink-0">
                  <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl blur-md opacity-60" />
                  <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
                    <Sparkles className="w-5 h-5 text-white" aria-hidden="true" />
                  </div>
                </div>
                <div className={`min-w-0 ${sidebarCollapsed ? 'md:hidden' : ''}`}>
                  <p className="text-[15px] font-black tracking-tight leading-none">SC DEBURRING</p>
                  <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-widest mt-0.5">Shop OS</p>
                </div>
              </div>
              <NotificationBell permission={permission} requestPermission={requestPermission} userId={user?.id} alerts={alerts} markRead={markRead} markAllRead={markAllRead} clearAll={clearAll} align="left" />
            </div>
            <nav aria-label="Main navigation" className={`space-y-0.5 mt-2 ${sidebarCollapsed ? 'md:px-2 px-3' : 'px-3'}`}>
              {navItems.map(x => {
                const active = view === x.id;
                return (
                  <button key={x.id} onClick={() => { setView(x.id as any); setSidebarOpen(false); }}
                    aria-current={active ? 'page' : undefined}
                    title={sidebarCollapsed ? x.l : undefined}
                    className={`relative flex items-center gap-3 w-full rounded-xl text-sm font-semibold transition-all group
                      ${sidebarCollapsed ? 'md:justify-center md:px-2.5 md:py-2.5 px-3.5 py-2.5' : 'px-3.5 py-2.5'}
                      ${active
                        ? 'bg-gradient-to-r from-blue-500/15 to-transparent text-white shadow-sm'
                        : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}>
                    {active && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-gradient-to-b from-blue-400 to-indigo-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />}
                    <x.i className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${active ? 'text-blue-400' : 'text-zinc-500 group-hover:text-zinc-300'}`} aria-hidden="true" />
                    <span className={sidebarCollapsed ? 'md:hidden' : ''}>{x.l}</span>
                  </button>
                );
              })}
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
              <div className="relative w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
                <Sparkles className="w-4 h-4 text-white" aria-hidden="true" />
              </div>
              SC DEBURRING
            </div>
            <NotificationBell permission={permission} requestPermission={requestPermission} userId={user?.id} alerts={alerts} markRead={markRead} markAllRead={markAllRead} clearAll={clearAll} />
          </div>
        )}

        <div className="p-4 md:p-8">
          {view === 'admin-dashboard' && <AdminDashboard confirmAction={setConfirm} setView={setView} user={user} addToast={addToast} />}
          {view === 'admin-jobs' && <JobsView user={user} addToast={addToast} setPrintable={setPrintable} confirm={setConfirm} onOpenPOScanner={() => setShowPOScanner(true)} />}
          {view === 'admin-board' && <JobBoardView user={user} addToast={addToast} confirm={setConfirm} onEditStages={() => setView('admin-settings')} />}
          {view === 'admin-quality' && <QualityView user={user} addToast={addToast} confirm={setConfirm} />}
          {view === 'admin-deliveries' && user && <DeliveriesView user={{ id: user.id, name: user.name, role: user.role }} addToast={addToast} />}
          {view === 'admin-calendar' && <JobsView key="cal" user={user} addToast={addToast} setPrintable={setPrintable} confirm={setConfirm} onOpenPOScanner={() => setShowPOScanner(true)} calendarOnly />}
          {view === 'admin-logs' && <LogsView addToast={addToast} confirm={setConfirm} />}
          {view === 'admin-team' && <AdminEmployees addToast={addToast} confirm={setConfirm} />}
          {view === 'admin-settings' && <SettingsView addToast={addToast} userId={user?.id} />}
          {view === 'admin-reports' && <ReportsView />}
          {view === 'admin-live' && <LiveFloorMonitor user={user} onBack={() => setView('admin-dashboard')} addToast={addToast} />}
          {view === 'admin-samples' && <SamplesView addToast={addToast} currentUser={user ? { id: user.id, name: user.name } : null} />}
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

     {showPOScanner && (
  <POScanner
    onJobCreate={handlePOJobCreate}
    onClose={() => setShowPOScanner(false)}
    clients={appSettings.clients || []}
  />
)}
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
    </div>
  );
}





