import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

import {
  LayoutDashboard, Briefcase, Users, Settings, LogOut, Menu,
  Sparkles, Zap, Clock, CheckCircle, StopCircle,
  Search, Plus, User as UserIcon, Calendar, Edit2, Save, X,
  ArrowRight, Box, History, AlertCircle, ChevronDown, ChevronRight, Filter, Info,
  Printer, ScanLine, QrCode, Power, AlertTriangle, Trash2, Wifi, WifiOff,
  RotateCcw, ChevronUp, Database, ExternalLink, RefreshCw, Calculator, Activity,
  Play, Bell, BellOff, BellRing, Pause, Camera, Image, ChevronLeft, Download
} from 'lucide-react';
import { Toast } from './components/Toast';
import { Job, User, TimeLog, ToastMessage, AppView, SystemSettings } from './types';
import * as DB from './services/mockDb';
import { parseJobDetails } from './services/geminiService';
import { LiveFloorMonitor, useAutoLunch } from './LiveFloorMonitor';
import { SamplesView } from './SamplesView';
import { POScanner } from './POScanner';

function fmt(d?: string | null): string {
  if (!d) return '';
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  return d;
}
function todayFmt(): string {
  const d = new Date();
  return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}/${d.getFullYear()}`;
}

function normDate(raw: string | null | undefined): string {
  if (!raw) return '';
  const s = raw.trim();
  // Already MM/DD/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return s;
  // YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[2] + '/' + iso[3] + '/' + iso[1];
  // Try native parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return String(d.getMonth()+1).padStart(2,'0') + '/' + String(d.getDate()).padStart(2,'0') + '/' + d.getFullYear();
  }
  return s;
}

// Convert MM/DD/YYYY to numeric YYYYMMDD for safe comparisons
// (string comparison of MM/DD/YYYY is broken: "04/05/2026" < "12/31/2025")
function dateNum(mmddyyyy: string): number {
  const m = mmddyyyy.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return 0;
  return parseInt(m[3]) * 10000 + parseInt(m[1]) * 100 + parseInt(m[2]);
}

// --- UTILS ---
const formatDuration = (mins: number | undefined) => {
  if (mins === undefined || mins === null) return 'Running...';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const toDateTimeLocal = (ts: number | undefined | null) => {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hour = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hour}:${min}`;
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
const NotificationBell = ({ permission, requestPermission, userId, alerts, markRead, markAllRead, clearAll }: any) => {
  const [open, setOpen] = useState(false);
  const unread = alerts.filter((a: any) => !a.read).length;
  const ref = useRef<HTMLButtonElement>(null);

  const typeColors: Record<string, string> = {
    overdue: 'text-red-400 bg-red-500/10 border-red-500/20',
    'due-soon': 'text-orange-400 bg-orange-500/10 border-orange-500/20',
    urgent: 'text-red-400 bg-red-500/10 border-red-500/20',
    'long-timer': 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    'new-urgent': 'text-red-400 bg-red-500/10 border-red-500/20',
  };

  const timeAgo = (ts: number) => {
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  };

  return (
    <>
      {/* Bell button */}
      <button
        ref={ref as any}
        onClick={() => { setOpen(!open); if (!open && unread > 0) markAllRead(); }}
        className={`relative p-2 rounded-xl transition-all ${
          unread > 0
            ? 'bg-blue-500/10 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20'
            : 'bg-zinc-800 border border-white/5 text-zinc-400 hover:text-white'
        }`}
        title="Notifications"
      >
        {unread > 0 ? <BellRing className="w-5 h-5 animate-pulse" /> : <Bell className="w-5 h-5" />}
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center shadow-lg">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && createPortal(
        <>
          {/* Backdrop — rendered at document.body level, escapes all stacking contexts */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-[2px] z-[99998]"
            onClick={() => setOpen(false)}
          />

          {/* Panel — also at body level, always on top */}
          <div className="fixed right-3 top-[4.5rem] w-[22rem] max-w-[calc(100vw-1.5rem)] bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl z-[99999] overflow-hidden flex flex-col animate-fade-in"
               style={{ maxHeight: 'calc(100vh - 6rem)' }}>

            {/* Header */}
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-zinc-800/80 shrink-0">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-blue-400 shrink-0" />
                <span className="font-bold text-white text-sm">Notifications</span>
                {unread > 0 && (
                  <span className="bg-blue-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">{unread}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {alerts.length > 0 && (
                  <button onClick={clearAll} className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors font-medium">
                    Clear all
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-white transition-colors w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/10">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Permission banner */}
            {permission !== 'granted' && (
              <div className="mx-3 mt-3 rounded-xl bg-blue-500/10 border border-blue-500/20 p-3 flex items-center gap-3 shrink-0">
                <BellRing className="w-5 h-5 text-blue-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-blue-300">Enable notifications</p>
                  <p className="text-[10px] text-blue-400/70 mt-0.5">Get alerts for overdue jobs & long timers</p>
                </div>
                <button
                  onClick={() => requestPermission(userId)}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold px-3 py-2 rounded-lg shrink-0 transition-all"
                >
                  Enable
                </button>
              </div>
            )}

            {/* Alert list — scrollable */}
            <div className="overflow-y-auto flex-1 mt-1 pb-2">
              {alerts.length === 0 ? (
                <div className="py-12 text-center text-zinc-500">
                  <Bell className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p className="text-sm font-medium">All caught up!</p>
                  <p className="text-xs mt-1 opacity-60">Overdue jobs, due dates & timer alerts appear here</p>
                </div>
              ) : (
                alerts.map((alert: any) => (
                  <div
                    key={alert.id}
                    onClick={() => markRead(alert.id)}
                    className={`px-4 py-3 border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors flex items-start gap-3 ${!alert.read ? 'bg-blue-500/5' : ''}`}
                  >
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded border shrink-0 mt-0.5 ${typeColors[alert.type] || 'text-zinc-400 bg-zinc-800 border-white/10'}`}>
                      {alert.type === 'overdue' ? 'OVERDUE' :
                       alert.type === 'due-soon' ? 'DUE SOON' :
                       alert.type === 'urgent' ? 'URGENT' :
                       alert.type === 'long-timer' ? 'TIMER' : 'ALERT'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-white leading-tight">{alert.title}</p>
                      <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">{alert.body}</p>
                      <p className="text-[10px] text-zinc-600 mt-1">{timeAgo(alert.time)}</p>
                    </div>
                    {!alert.read && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />}
                  </div>
                ))
              )}
            </div>
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
const PrintStyles = () => (
  <style>{`
    @media print {
      html, body, #root {
        height: auto !important;
        overflow: visible !important;
        margin: 0 !important;
        padding: 0 !important;
        background: white !important;
      }
      /* Hide sidebar nav completely */
      aside, nav { display: none !important; }
      /* Hide the main app content (jobs list, header, etc.) */
      main { display: none !important; }
      /* Hide mobile header bar */
      header { display: none !important; }
      /* Hide the no-print elements (Print Preview bar, Cancel, Print buttons) */
      .no-print { display: none !important; }
      /* The print overlay becomes static, full width, white background */
      .print-overlay {
        position: static !important;
        display: block !important;
        width: 100% !important;
        height: auto !important;
        background: white !important;
        padding: 0 !important;
        margin: 0 !important;
        overflow: visible !important;
      }
      /* The modal card fills the page */
      #printable-modal {
        position: static !important;
        width: 100% !important;
        max-width: 100% !important;
        height: auto !important;
        margin: 0 !important;
        padding: 0 !important;
        background: white !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        overflow: visible !important;
      }
      /* App wrapper should not constrain */
      #root > div {
        min-height: 0 !important;
        height: auto !important;
        display: block !important;
        background: white !important;
      }
      #printable-area {
        padding: 20px !important;
        overflow: visible !important;
        width: 100% !important;
      }
      /* Scale text for printing — auto-fit long values */
      #printable-area h1 { font-size: 36pt !important; }
      #printable-area .print-po { font-size: inherit !important; }
      #printable-area .print-field-lg { font-size: inherit !important; }
      #printable-area .print-field-md { font-size: inherit !important; }
      #printable-area .print-qr-img { max-width: 280px !important; width: 280px !important; }
      #printable-area .print-qr-label { font-size: 16pt !important; }
      #printable-area .print-notes { font-size: 14pt !important; min-height: auto !important; line-height: 1.5 !important; }
      #printable-area .print-instr { font-size: 15pt !important; font-weight: 700 !important; line-height: 1.5 !important; }
      #printable-area label { font-size: 11pt !important; }
      #printable-area .grid { gap: 12px !important; }
      #printable-area .border-4 { overflow: hidden !important; }
      #printable-area .border-2 { overflow: hidden !important; }
      #printable-area .print-part-photo { max-width: 180px !important; max-height: 140px !important; }
      @page { size: letter; margin: 10mm; }
    }
  `}</style>
);

// --- STATUS BADGE ---
const StatusBadge = ({ status }: { status: string }) => {
  const styles: Record<string, string> = {
    'pending': 'bg-zinc-800 text-zinc-500 border-white/5',
    'in-progress': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    'completed': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    'hold': 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  };
  return (
    <span className={`px-3 py-1 rounded-full text-xs uppercase font-bold tracking-wide border flex w-fit items-center gap-2 ${styles[status] || styles['pending']}`}>
      {status === 'in-progress' && <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />}
      {status}
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
  const [isPausing, setIsPausing] = useState(false);
  const isMounted = useRef(true);
  useEffect(() => () => { isMounted.current = false; }, []);

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
    if (isPausing || !onPause) return;
    setIsPausing(true);
    try { await onPause(log.id); }
    catch (e) { console.error('[ActiveJobPanel] Pause failed:', e); }
    finally { if (isMounted.current) setIsPausing(false); }
  };

  const handleResumeClick = async () => {
    if (isPausing || !onResume) return;
    setIsPausing(true);
    try { await onResume(log.id); }
    catch (e) { console.error('[ActiveJobPanel] Resume failed:', e); }
    finally { if (isMounted.current) setIsPausing(false); }
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
              <button onClick={handleResumeClick} disabled={isPausing}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-6 py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 shadow-lg shadow-emerald-900/20 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer">
                {isPausing ? 'Resuming...' : <><Play className="w-6 h-6" /> Resume</>}
              </button>
            ) : onPause ? (
              <button onClick={handlePauseClick} disabled={isPausing}
                className="bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white px-6 py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 shadow-lg shadow-yellow-900/20 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer">
                {isPausing ? '...' : <><Pause className="w-6 h-6" /></>}
              </button>
            ) : null}
            <button onClick={handleStopClick} disabled={isStopping}
              className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 shadow-lg shadow-red-900/20 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer">
              {isStopping ? 'Stopping...' : <><StopCircle className="w-6 h-6" /> Stop Timer</>}
            </button>
          </div>
        </div>
        <div className="bg-white/5 rounded-2xl p-6 border border-white/5 flex flex-col h-full opacity-90">
          <h3 className="text-zinc-400 font-bold uppercase text-sm mb-6 flex items-center gap-2"><Info className="w-4 h-4" /> Job Details</h3>
          {job ? (
            <>
              <div className="grid grid-cols-2 gap-y-6 gap-x-4 mb-6">
                <div><label className="text-xs text-zinc-500 uppercase font-bold">Part Number</label><div className="text-lg md:text-xl font-bold text-white mt-1 break-words">{job.partNumber}</div></div>
                <div><label className="text-xs text-zinc-500 uppercase font-bold">PO Number</label><div className="text-lg md:text-xl font-bold text-white mt-1 break-words">{job.poNumber}</div></div>
                <div><label className="text-xs text-zinc-500 uppercase font-bold">Quantity</label><div className="text-lg md:text-xl font-bold text-white mt-1">{job.quantity} <span className="text-sm font-normal text-zinc-500">units</span></div></div>
                <div><label className="text-xs text-zinc-500 uppercase font-bold">Due Date</label><div className="text-lg md:text-xl font-bold text-white mt-1">{job.dueDate || 'N/A'}</div></div>
              </div>
              <div className="mt-auto pt-6 border-t border-white/10">
                <label className="text-xs text-zinc-500 uppercase font-bold mb-2 block">Notes / Instructions</label>
                <div className="text-zinc-300 text-sm leading-relaxed bg-black/20 p-4 rounded-xl border border-white/5 min-h-[80px]">
                  {job.info || <span className="text-zinc-600 italic">No notes provided for this job.</span>}
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
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (defaultExpanded && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    <div ref={cardRef} className={`border rounded-2xl overflow-hidden transition-all duration-300 ${borderClass} ${expanded ? 'ring-2 ring-blue-500/50' : 'hover:bg-zinc-800/50'} ${disabled ? 'opacity-50 pointer-events-none' : ''} ${defaultExpanded ? 'ring-2 ring-blue-500 shadow-lg shadow-blue-500/10' : ''}`}>
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
        <div className="text-sm text-zinc-500 space-y-1 mt-2">
          <p>Part: <span className="text-zinc-300 font-medium">{job.partNumber}</span></p>
          <p className="text-xs text-zinc-600">Job ID: <span className="text-zinc-500 font-mono">{job.jobIdsDisplay}</span></p>
          {job.dueDate && (
            <p className={`text-xs font-bold flex items-center gap-1 ${isOverdue ? 'text-red-400' : isDueSoon ? 'text-orange-400' : 'text-zinc-500'}`}>
              {isOverdue ? ' OVERDUE:' : isDueSoon ? ' Due Soon:' : 'Due:'} {normDate(job.dueDate)}
            </p>
          )}
        </div>
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
          <p className="text-xs text-zinc-500 uppercase font-bold mb-3">Select Operation:</p>
          <div className="grid grid-cols-2 gap-2">
            {operations.map(op => (
              <button key={op} onClick={e => { e.stopPropagation(); onStart(job.id, op); }}
                className="bg-zinc-800 hover:bg-blue-600 hover:text-white border border-white/5 py-2 px-3 rounded-lg text-sm text-zinc-300 transition-colors font-medium">
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
      addToast('success', 'Timer Started');
      window.scrollTo({ top: 0, behavior: 'smooth' });
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

  return (
    <div className="space-y-6 max-w-5xl mx-auto h-full flex flex-col pb-20">
      {/* Morning reminder — no active timer and no logs today, shows after 5:05 AM */}
      {!activeLog && (() => {
        const now = new Date();
        const hhmm = now.getHours() * 60 + now.getMinutes();
        const todayLogs = myHistory.filter(l => new Date(l.startTime) >= new Date(new Date().setHours(0,0,0,0)));
        return hhmm >= 305 && hhmm < 720 && todayLogs.length === 0; // 5:05 AM to 12:00 PM
      })() && (
        <div className="bg-orange-500/10 border border-orange-500/20 rounded-2xl p-4 flex items-center gap-3 animate-fade-in">
          <span className="text-3xl">⏰</span>
          <div>
            <p className="text-orange-400 font-bold">You haven't clocked in yet!</p>
            <p className="text-orange-400/60 text-xs">It's past 5:05 AM — tap <strong>Scan</strong> below to start your first operation.</p>
          </div>
        </div>
      )}

      {activeLog && <ActiveJobPanel job={activeJob} log={activeLog} onStop={handleStopJob}
        onPause={async (id) => { try { await DB.pauseTimeLog(id, 'manual'); swPost({ type: 'TIMER_PAUSE' }); addToast('info', 'Timer Paused'); } catch { addToast('error', 'Failed to pause'); } }}
        onResume={async (id) => { try { await DB.resumeTimeLog(id); swPost({ type: 'TIMER_RESUME' }); addToast('success', 'Timer Resumed'); } catch { addToast('error', 'Failed to resume'); } }}
      />}

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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
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
const PrintableJobSheet = ({ job, onClose, onPrinted }: { job: Job | null, onClose: () => void, onPrinted?: (jobId: string) => void }) => {
  if (!job) return null;
  const currentBaseUrl = window.location.href.split('?')[0];
  const deepLinkData = `${currentBaseUrl}?jobId=${job.id}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(deepLinkData)}`;

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
          <div className="flex justify-between items-center border-b-4 border-black pb-2 mb-4">
            <div>
              <h1 className="text-3xl font-black tracking-tighter">SC DEBURRING</h1>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mt-1">Production Traveler</p>
            </div>
            <div className="text-right">
              <h2 className="text-lg font-bold">{new Date().toLocaleDateString()}</h2>
              <p className="text-xs text-gray-400">Printed On</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="space-y-3 flex flex-col">
              <div className="border-4 border-black p-3">
                <label className="block text-xs uppercase font-bold text-gray-500 mb-1">PO Number</label>
                <div className={`print-po font-black leading-tight break-all ${job.poNumber.length > 15 ? 'text-2xl' : job.poNumber.length > 12 ? 'text-3xl' : job.poNumber.length > 8 ? 'text-4xl' : 'text-5xl'}`} style={{wordBreak:'break-all'}}>{job.poNumber}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="border-2 border-gray-300 p-2"><label className="block text-xs uppercase font-bold text-gray-500 mb-1">Part #</label><div className={`print-field-lg font-black ${(job.partNumber||'').length > 16 ? 'text-sm' : (job.partNumber||'').length > 12 ? 'text-base' : (job.partNumber||'').length > 8 ? 'text-lg' : 'text-2xl'}`} style={{wordBreak:'break-all'}}>{job.partNumber}</div></div>
                <div className="border-2 border-gray-300 p-2"><label className="block text-xs uppercase font-bold text-gray-500 mb-1">Qty</label><div className="print-field-lg text-2xl font-black">{job.quantity || '—'}</div></div>
                <div className="border-2 border-gray-300 p-2"><label className="block text-xs uppercase font-bold text-gray-500 mb-1">Received</label><div className="print-field-md text-base font-bold">{job.dateReceived || '—'}</div></div>
                <div className="border-2 border-gray-300 p-2"><label className="block text-xs uppercase font-bold text-gray-500 mb-1">Due Date</label><div className="print-field-md text-base font-black text-red-600">{job.dueDate || '—'}</div></div>
              </div>
              {/* Part Photo — fits in the empty space below dates */}
              {job.partImage && (
                <div className="border-2 border-gray-300 p-2 flex items-center gap-3">
                  <img src={job.partImage} alt="Part" className="print-part-photo object-contain" style={{maxWidth:'120px',maxHeight:'80px'}} />
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-gray-400">Reference</label>
                    <div className="text-xs font-bold text-gray-600">Part Photo</div>
                  </div>
                </div>
              )}
            </div>
            <div className="flex flex-col items-center justify-center border-4 border-black p-4 bg-gray-50">
              <img src={qrUrl} alt="QR Code" className="print-qr-img w-full h-auto mix-blend-multiply max-w-[220px]" crossOrigin="anonymous" />
              <p className="font-mono text-xs mt-2 text-gray-500 text-center break-all">{job.id}</p>
              <p className="print-qr-label font-bold uppercase tracking-widest text-xl mt-1">SCAN JOB ID</p>
            </div>
          </div>

          {/* Special Instructions — always shown prominently if present */}
          {job.specialInstructions && (
            <div className="border-4 border-orange-500 bg-orange-50 p-3 mb-3">
              <label className="block text-xs uppercase font-black text-orange-700 mb-2 tracking-wider">⚠ Special Instructions</label>
              <div className="print-instr text-base font-bold text-gray-900 whitespace-pre-wrap">{job.specialInstructions}</div>
            </div>
          )}

          {/* General notes / part info */}
          {job.info && (
            <div className="border-l-4 border-gray-400 pl-3 py-1 bg-gray-50">
              <label className="block text-xs uppercase font-bold text-gray-500 mb-1">Notes</label>
              <div className="print-notes text-sm text-gray-700 whitespace-pre-wrap">{job.info}</div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

// --- LOGIN ---
const LoginView = ({ onLogin, addToast }: { onLogin: (u: User) => void, addToast: any }) => {
  const [username, setUsername] = useState('');
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

  useEffect(() => {
    const unsub1 = DB.subscribeActiveLogs(setActiveLogs);
    const unsub2 = DB.subscribeJobs(setJobs);
    const unsub3 = DB.subscribeLogs(all => setLogs(all.filter(l => l.endTime).sort((a, b) => (b.endTime || 0) - (a.endTime || 0)).slice(0, 5)));
    const unsub4 = DB.subscribeLogs(setAllLogs);
    const unsub5 = DB.subscribeSettings(setShopSettings);
    const unsub6 = DB.subscribeUsers(setDashWorkers);
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub6(); };
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

      {/* Overdue / Due Soon Alert Banner */}
      {(overdueJobs.length > 0 || dueSoonJobs.length > 0) && (
        <div className="flex flex-col sm:flex-row gap-3">
          {overdueJobs.length > 0 && (
            <div className="flex-1 bg-red-500/10 border border-red-500/30 rounded-2xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-red-400 font-bold text-sm"> {overdueJobs.length} Overdue Job{overdueJobs.length > 1 ? 's' : ''}</p>
                <p className="text-red-400/70 text-xs truncate">{overdueJobs.map(j => j.poNumber).join(', ')}</p>
              </div>
              <button onClick={() => setView('admin-jobs')} className="text-xs text-red-400 hover:text-white border border-red-500/30 px-3 py-1.5 rounded-lg hover:bg-red-500/20 transition-colors shrink-0">View Jobs</button>
            </div>
          )}
          {dueSoonJobs.length > 0 && (
            <div className="flex-1 bg-orange-500/10 border border-orange-500/30 rounded-2xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5 text-orange-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-orange-400 font-bold text-sm"> {dueSoonJobs.length} Due Within 3 Days</p>
                <p className="text-orange-400/70 text-xs truncate">{dueSoonJobs.map(j => j.poNumber).join(', ')}</p>
              </div>
              <button onClick={() => setView('admin-jobs')} className="text-xs text-orange-400 hover:text-white border border-orange-500/30 px-3 py-1.5 rounded-lg hover:bg-orange-500/20 transition-colors shrink-0">View Jobs</button>
            </div>
          )}
        </div>
      )}

      {/* Missing Scans Alert */}
      {workersNoScansToday.length > 0 && new Date().getHours() >= 8 && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-2xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-yellow-500/20 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-yellow-400 font-bold text-sm">{workersNoScansToday.length} worker{workersNoScansToday.length > 1 ? 's' : ''} haven't scanned today</p>
            <p className="text-yellow-400/70 text-xs truncate">{workersNoScansToday.map((w: User) => w.name.split(' ')[0]).join(', ')}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-zinc-900/50 border border-white/5 p-6 rounded-2xl flex justify-between items-center">
          <div><p className="text-zinc-500 text-sm font-bold uppercase tracking-wider">Live Activity</p><h3 className="text-3xl font-black text-white">{liveJobsCount}</h3><p className="text-xs text-blue-400 mt-1">Jobs running now</p></div>
          <Activity className={`w-10 h-10 text-blue-500 ${liveJobsCount > 0 ? 'animate-pulse' : 'opacity-20'}`} />
        </div>
        <div className="bg-zinc-900/50 border border-white/5 p-6 rounded-2xl flex justify-between items-center">
          <div><p className="text-zinc-500 text-sm font-bold uppercase tracking-wider">Open Jobs</p><h3 className="text-3xl font-black text-white">{activeJobsCount}</h3><p className="text-xs text-zinc-500 mt-1">Total open jobs</p></div>
          <Briefcase className="text-zinc-600 w-10 h-10" />
        </div>
        <div className={`p-6 rounded-2xl flex justify-between items-center border ${overdueJobs.length > 0 ? 'bg-red-500/10 border-red-500/20' : 'bg-zinc-900/50 border-white/5'}`}>
          <div><p className={`text-sm font-bold uppercase tracking-wider ${overdueJobs.length > 0 ? 'text-red-400' : 'text-zinc-500'}`}>Overdue</p><h3 className={`text-3xl font-black ${overdueJobs.length > 0 ? 'text-red-400' : 'text-zinc-600'}`}>{overdueJobs.length}</h3><p className={`text-xs mt-1 ${overdueJobs.length > 0 ? 'text-red-400/70' : 'text-zinc-600'}`}>Past due date</p></div>
          <AlertTriangle className={`w-10 h-10 ${overdueJobs.length > 0 ? 'text-red-500' : 'text-zinc-700'}`} />
        </div>
        <div className="bg-zinc-900/50 border border-white/5 p-6 rounded-2xl flex justify-between items-center">
          <div><p className="text-zinc-500 text-sm font-bold uppercase tracking-wider">Floor Staff</p><h3 className="text-3xl font-black text-white">{activeWorkersCount}</h3><p className="text-xs text-zinc-500 mt-1">Active Operators</p></div>
          <Users className="text-emerald-500 w-10 h-10" />
        </div>
        <div className="bg-zinc-900/50 border border-white/5 p-6 rounded-2xl flex justify-between items-center">
          <div><p className="text-zinc-500 text-sm font-bold uppercase tracking-wider">Today</p><h3 className="text-3xl font-black text-white">{todayHrsDisplay}</h3><p className="text-xs text-zinc-500 mt-1">Hours logged</p></div>
          <Clock className="text-blue-400 w-10 h-10 opacity-60" />
        </div>
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4">
                <p className="text-[10px] text-zinc-500 uppercase font-bold">Monthly Revenue</p>
                <p className="text-2xl font-black text-emerald-400">${monthTotals.revenue.toLocaleString()}</p>
                <p className="text-[10px] text-zinc-600">{monthTotals.jobs} jobs completed</p>
              </div>
              <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4">
                <p className="text-[10px] text-zinc-500 uppercase font-bold">Monthly Costs</p>
                <p className="text-2xl font-black text-orange-400">${monthTotals.cost.toFixed(0)}</p>
                <p className="text-[10px] text-zinc-600">{monthTotals.hrs.toFixed(0)}h labor + overhead</p>
              </div>
              <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4">
                <p className="text-[10px] text-zinc-500 uppercase font-bold">Net Profit</p>
                <p className={`text-2xl font-black ${monthProfit && monthProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {monthProfit !== null ? `${monthProfit >= 0 ? '+' : ''}$${monthProfit.toFixed(0)}` : '—'}
                </p>
                <p className="text-[10px] text-zinc-600">{monthMargin > 0 ? `${monthMargin.toFixed(0)}% margin` : 'No quoted jobs'}</p>
              </div>
              <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4">
                <p className="text-[10px] text-zinc-500 uppercase font-bold">$/Hour Earned</p>
                <p className="text-2xl font-black text-blue-400">${avgRevenuePerHr.toFixed(0)}</p>
                <p className="text-[10px] text-zinc-600">Cost: ${avgCostPerHr.toFixed(0)}/hr</p>
              </div>
            </div>

            {/* Week vs Month Comparison */}
            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden">
              <div className="p-4 border-b border-white/5 flex items-center justify-between">
                <h3 className="font-bold text-white text-sm flex items-center gap-2"><Calculator className="w-4 h-4 text-emerald-400" /> Profit & Loss</h3>
                {unquoted.length > 0 && <span className="text-[10px] bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-2 py-1 rounded-lg font-bold">{unquoted.length} missing quote</span>}
              </div>
              <div className="grid grid-cols-2 divide-x divide-white/5">
                <div className="p-4 space-y-2">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase">This Week</p>
                  <div className="flex justify-between text-xs"><span className="text-zinc-500">Revenue</span><span className="text-emerald-400 font-mono">${weekTotals.revenue.toLocaleString()}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-zinc-500">Labor</span><span className="text-orange-400 font-mono">${weekTotals.cost.toFixed(0)}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-zinc-500">Hours</span><span className="text-zinc-300 font-mono">{weekTotals.hrs.toFixed(1)}h</span></div>
                  <div className="border-t border-white/5 pt-2 flex justify-between items-center">
                    <span className="text-xs font-bold text-zinc-400">Profit</span>
                    <div className="text-right">
                      <span className={`text-lg font-black ${weekProfit && weekProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {weekProfit !== null ? `${weekProfit >= 0 ? '+' : ''}$${weekProfit.toFixed(0)}` : '—'}
                      </span>
                      {weekMargin > 0 && <p className="text-[10px] text-zinc-500">{weekMargin.toFixed(0)}% margin</p>}
                    </div>
                  </div>
                </div>
                <div className="p-4 space-y-2">
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

            {/* Live Job Budget Tracker — Estimated vs Actual */}
            {activeJobsWithCosts.length > 0 && (
              <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Live Job Budget — Est. vs Actual</h3>
                <div className="space-y-3">
                  {activeJobsWithCosts.map(j => (
                    <div key={j.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-white font-bold">{j.poNumber} <span className="text-zinc-500 font-normal">{j.partNumber}</span></span>
                        <div className="flex items-center gap-3">
                          <span className="text-zinc-500">Spent: <span className="text-orange-400 font-mono">${j.cost.toFixed(0)}</span></span>
                          <span className="text-zinc-500">Budget: <span className="text-zinc-300 font-mono">${(j.quoteAmount || 0).toLocaleString()}</span></span>
                          <span className={`font-bold font-mono ${j.remaining >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{j.remaining >= 0 ? '+' : ''}${j.remaining.toFixed(0)}</span>
                        </div>
                      </div>
                      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${j.usedPct > 90 ? 'bg-red-500' : j.usedPct > 70 ? 'bg-yellow-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, j.usedPct)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top Customers Revenue */}
            {topCustomers.length > 0 && (
              <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Top Customers (This Month)</h3>
                <div className="space-y-2">
                  {topCustomers.map(([cust, data], i) => {
                    const maxRev = topCustomers[0][1].revenue || 1;
                    const margin = data.revenue > 0 ? ((data.revenue - data.cost) / data.revenue * 100) : 0;
                    return (
                      <div key={cust} className="flex items-center gap-3">
                        <span className="text-xs text-zinc-500 w-4">{i + 1}</span>
                        <span className="text-xs text-white font-bold w-28 truncate">{cust}</span>
                        <div className="flex-1 h-5 bg-zinc-800 rounded overflow-hidden relative">
                          <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded transition-all" style={{ width: `${(data.revenue / maxRev) * 100}%` }} />
                          <span className="absolute right-2 top-0 text-[10px] font-mono text-white/80">${data.revenue.toLocaleString()}</span>
                        </div>
                        <span className={`text-[10px] font-bold w-10 text-right ${margin >= 20 ? 'text-emerald-400' : margin >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>{margin.toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-zinc-900/50 border border-white/5 rounded-3xl overflow-hidden flex flex-col">
          <div className="p-6 border-b border-white/5"><h3 className="font-bold text-white flex items-center gap-2"><Activity className="w-4 h-4 text-emerald-500" /> Live Operations</h3></div>
          <div className="divide-y divide-white/5 flex-1 overflow-y-auto max-h-[400px]">
            {activeLogs.length === 0 && <div className="p-8 text-center text-zinc-500">Floor is quiet. No active timers.</div>}
            {activeLogs.map(l => (
              <div key={l.id} className="p-4 flex items-center justify-between hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center font-bold text-zinc-400 border border-white/5">{l.userName.charAt(0)}</div>
                  <div>
                    <p className="font-bold text-white">{l.userName}</p>
                    <p className="text-xs text-zinc-500 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> {l.operation}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-white text-xl font-bold font-mono"><LiveTimer startTime={l.startTime} pausedAt={l.pausedAt} totalPausedMs={l.totalPausedMs} /></div>
                  <button onClick={() => confirmAction({ title: "Force Stop", message: "Stop this timer?", onConfirm: () => DB.stopTimeLog(l.id) })} className="bg-red-500/10 text-red-500 p-2 rounded-lg hover:bg-red-500 hover:text-white transition-colors"><Power className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-zinc-900/50 border border-white/5 rounded-3xl overflow-hidden flex flex-col">
          <div className="p-6 border-b border-white/5 flex justify-between items-center">
            <h3 className="font-bold text-white flex items-center gap-2"><History className="w-4 h-4 text-blue-500" /> Recent Completed</h3>
            <button onClick={() => setView('admin-logs')} className="text-xs text-blue-400 hover:text-white transition-colors">View All</button>
          </div>
          <div className="divide-y divide-white/5 flex-1 overflow-y-auto max-h-[400px]">
            {logs.length === 0 && <div className="p-8 text-center text-zinc-500">No recent history.</div>}
            {logs.map(l => (
              <div key={l.id} className="p-4 flex items-start gap-3 hover:bg-white/5 transition-colors">
                <div className="mt-1 w-2 h-2 rounded-full shrink-0 bg-emerald-500"></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white"><span className="font-bold">{l.userName}</span> — <span className="text-zinc-300">{l.operation}</span></p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-zinc-300 font-bold text-xs">{l.jobIdsDisplay || l.jobId}</span>
                    {l.partNumber && <span className="text-xs text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">{l.partNumber}</span>}
                    <span className="text-xs text-zinc-600">{new Date(l.endTime!).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
                  </div>
                  {l.notes && (
                    <div className="mt-1.5 bg-amber-500/5 border border-amber-500/20 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
                      <span className="text-amber-500 text-[10px]">📝</span>
                      <span className="text-amber-300/90 text-xs leading-tight">{l.notes}</span>
                    </div>
                  )}
                </div>
                {l.durationMinutes != null && (
                  <div className="text-xs font-mono text-zinc-400 bg-zinc-800 px-2 py-1 rounded shrink-0">{formatDuration(l.durationMinutes)}</div>
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

// ── Part Image Lightbox ──
const PartImageLightbox = ({ src, onClose }: { src: string, onClose: () => void }) => (
  <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/90 backdrop-blur-sm animate-fade-in" onClick={onClose}>
    <div className="relative max-w-3xl max-h-[85vh] m-4" onClick={e => e.stopPropagation()}>
      <button onClick={onClose} className="absolute -top-3 -right-3 z-10 bg-zinc-800 border border-white/10 rounded-full p-1.5 text-white hover:bg-red-500 transition-colors shadow-lg"><X className="w-5 h-5" /></button>
      <img src={src} alt="Part Photo" className="max-w-full max-h-[85vh] rounded-xl shadow-2xl object-contain" />
    </div>
  </div>
);

// --- ADMIN: JOBS ---
const JobsView = ({ user, addToast, setPrintable, confirm, onOpenPOScanner }: any) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeTab, setActiveTab] = useState<'active' | 'completed' | 'calendar'>('active');
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [calSelectedDay, setCalSelectedDay] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'dueDate' | 'priority' | 'newest' | 'oldest'>('dueDate');
  const [showFilters, setShowFilters] = useState(false);
  const [editingJob, setEditingJob] = useState<Partial<Job>>({});
  const [showModal, setShowModal] = useState(false);
  const [startJobModal, setStartJobModal] = useState<Job | null>(null);
  const [ops, setOps] = useState<string[]>([]);
  const [clients, setClients] = useState<string[]>([]);
  const [partSuggestions, setPartSuggestions] = useState<Job[]>([]);
  const [shopSettings, setShopSettings] = useState<SystemSettings>(DB.getSettings());
  const [allLogs, setAllLogs] = useState<TimeLog[]>([]);
  const [workers, setWorkers] = useState<User[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<User | null>(null);
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
    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  const handleAdminStartJob = async (operation: string) => {
    if (!startJobModal) return;
    const targetWorker = selectedWorker || user;
    try {
      await DB.startTimeLog(startJobModal.id, targetWorker.id, targetWorker.name, operation, startJobModal.partNumber, startJobModal.customer, undefined, undefined, startJobModal.jobIdsDisplay);
      addToast('success', `Operation started for ${targetWorker.name}`);
      setStartJobModal(null);
      setSelectedWorker(null);
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
          <h2 className="text-2xl font-bold text-white flex items-center gap-2"><Briefcase className="w-6 h-6 text-blue-500" /> Production Jobs</h2>
          <p className="text-zinc-500 text-sm">Manage orders and track by PO, priority, and due date.</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <button onClick={() => { setEditingJob({}); setShowModal(true); }} className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-blue-900/20 flex items-center gap-2 transition-all"><Plus className="w-4 h-4" /> New Job Order</button>
          <button
            onClick={onOpenPOScanner}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-lg shadow-blue-900/20 transition-all"
          >
            <ScanLine className="w-4 h-4" /> Scan PO
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-2 border-b border-white/5 pb-2">
        <button onClick={() => { setActiveTab('active'); setFilterStatus('all'); }} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'active' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white'}`}>
          Active Production
          <span className="ml-2 text-xs bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded-full">{jobs.filter(j => j.status !== 'completed').length}</span>
        </button>
        <button onClick={() => { setActiveTab('completed'); setFilterStatus('all'); }} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'completed' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white'}`}>
          Completed History
          <span className="ml-2 text-xs bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded-full">{jobs.filter(j => j.status === 'completed').length}</span>
        </button>
        <button onClick={() => setActiveTab('calendar')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-1.5 ${activeTab === 'calendar' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white'}`}>
          <Calendar className="w-3.5 h-3.5" /> Calendar
        </button>
      </div>

      {activeTab === 'completed' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-fade-in">
          <div className="bg-zinc-900/50 border border-emerald-500/20 p-4 rounded-2xl"><p className="text-xs font-bold text-emerald-500 uppercase tracking-wider mb-1">Completed This Week</p><p className="text-3xl font-black text-white">{stats.week}</p></div>
          <div className="bg-zinc-900/50 border border-white/5 p-4 rounded-2xl"><p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">Completed This Month</p><p className="text-3xl font-black text-white">{stats.month}</p></div>
          <div className="bg-zinc-900/50 border border-white/5 p-4 rounded-2xl"><p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">Completed This Year</p><p className="text-3xl font-black text-white">{stats.year}</p></div>
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
        for (let i = 0; i < firstDay; i++) cells.push(<div key={`e${i}`} className="min-h-[80px] bg-zinc-950/20 rounded" />);
        for (let d = 1; d <= daysInMonth; d++) {
          const dayJobs = jobsByDay[d] || [];
          const past = dateNum(`${String(mo+1).padStart(2,'0')}/${String(d).padStart(2,'0')}/${yr}`) < dateNum(todayStr);
          const selected = calSelectedDay === d;
          const hasOverdue = dayJobs.some(j => j.status !== 'completed') && past;
          cells.push(
            <div key={d} onClick={() => setCalSelectedDay(selected ? null : d)}
              className={`min-h-[80px] border p-1.5 rounded-lg cursor-pointer transition-all ${selected ? 'bg-blue-500/20 border-blue-500/50 ring-1 ring-blue-500/30' : isToday(d) ? 'bg-blue-500/10 border-blue-500/30' : past ? 'bg-zinc-950/40 border-white/5' : 'bg-zinc-900/30 border-white/5 hover:bg-zinc-800/40 hover:border-white/10'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-bold ${selected ? 'text-blue-300' : isToday(d) ? 'text-blue-400' : past ? 'text-zinc-600' : 'text-zinc-400'}`}>{d}</span>
                {dayJobs.length > 0 && (
                  <div className="flex gap-0.5">
                    {hasOverdue && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
                    <span className="text-[9px] bg-zinc-700/80 text-zinc-300 px-1 rounded">{dayJobs.length}</span>
                  </div>
                )}
              </div>
              <div className="space-y-0.5 overflow-hidden max-h-[48px]">
                {dayJobs.slice(0, 3).map(j => (
                  <div key={j.id} className="flex items-center gap-1 text-[9px] truncate">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColor(j.status)}`} />
                    <span className={`truncate ${j.status === 'completed' ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}>{j.poNumber}</span>
                  </div>
                ))}
                {dayJobs.length > 3 && <p className="text-[8px] text-zinc-600">+{dayJobs.length - 3} more</p>}
              </div>
            </div>
          );
        }

        return (
          <div className="animate-fade-in">
            {/* Month Stats Bar */}
            <div className="grid grid-cols-4 gap-2 mb-4">
              <div className="bg-zinc-900/50 border border-white/5 rounded-lg p-2 text-center">
                <p className="text-[10px] text-zinc-500 uppercase">Pending</p>
                <p className="text-lg font-black text-zinc-300">{pendingCount}</p>
              </div>
              <div className="bg-zinc-900/50 border border-blue-500/20 rounded-lg p-2 text-center">
                <p className="text-[10px] text-blue-400 uppercase">In Progress</p>
                <p className="text-lg font-black text-blue-400">{inProgressCount}</p>
              </div>
              <div className="bg-zinc-900/50 border border-emerald-500/20 rounded-lg p-2 text-center">
                <p className="text-[10px] text-emerald-400 uppercase">Completed</p>
                <p className="text-lg font-black text-emerald-400">{completedCount}</p>
              </div>
              <div className="bg-zinc-900/50 border border-red-500/20 rounded-lg p-2 text-center">
                <p className="text-[10px] text-red-400 uppercase">Overdue</p>
                <p className="text-lg font-black text-red-400">{overdueCount}</p>
              </div>
            </div>

            {/* Month nav */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white"><ChevronLeft className="w-4 h-4" /></button>
                <h3 className="text-lg font-bold text-white min-w-[200px] text-center">{monthName}</h3>
                <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white"><ChevronRight className="w-4 h-4" /></button>
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

            <div className="flex gap-4">
              {/* Calendar Grid */}
              <div className={`${calSelectedDay ? 'flex-1' : 'w-full'} transition-all`}>
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
                    <div key={d} className="text-center text-[10px] font-bold text-zinc-500 uppercase py-1">{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">{cells}</div>
              </div>

              {/* Day Detail Panel */}
              {calSelectedDay && (
                <div className="w-80 bg-zinc-900/50 border border-white/5 rounded-xl p-4 animate-fade-in flex-shrink-0 max-h-[520px] overflow-y-auto">
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

      <div className="bg-zinc-900/30 border border-white/5 rounded-2xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm text-left min-w-[800px]">
          <thead className="bg-zinc-950/50 text-zinc-500 uppercase tracking-wider font-bold text-xs">
            <tr>
              <th className="p-4">PO Number / Job ID</th>
              <th className="p-4">Part Details</th>
              <th className="p-4">Qty</th>
              <th className="p-4">Priority</th>
              <th className="p-4">Status</th>
              <th className="p-4">Due</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filteredJobs.map(j => {
              const isOverdue = j.status !== 'completed' && j.dueDate && dateNum(j.dueDate) < todayN;
              const isDueSoon = j.status !== 'completed' && j.dueDate && dateNum(j.dueDate) >= todayN && dateNum(j.dueDate) <= in3DaysN;
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
                <tr key={j.id} className={`hover:bg-white/5 transition-colors group cursor-pointer ${isOverdue ? 'bg-red-500/5' : ''}`} onClick={() => { setEditingJob(j); setShowModal(true); }}>
                  <td className="p-4">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-black text-xl">{j.poNumber}</span>
                        {isOverdue && <span className="text-[10px] font-black text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded">OVERDUE</span>}
                        {isDueSoon && !isOverdue && <span className="text-[10px] font-black text-orange-400 bg-orange-500/10 border border-orange-500/20 px-1.5 py-0.5 rounded">DUE SOON</span>}
                      </div>
                      <span className="text-zinc-600 font-mono text-[11px]">Job ID: {j.jobIdsDisplay}</span>
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
                  </td>
                  <td className="p-4">
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
                  <td className="p-4 font-mono text-zinc-300">{j.quantity}</td>
                  <td className="p-4"><PriorityBadge priority={j.priority} /></td>
                  <td className="p-4"><StatusBadge status={j.status} /></td>
                  <td className={`p-4 font-mono whitespace-nowrap font-bold ${isOverdue ? 'text-red-400' : isDueSoon ? 'text-orange-400' : 'text-zinc-400'}`}>
                    {fmt(j.dueDate)}
                  </td>
                  <td className="p-4 text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setStartJobModal(j)} className="p-2 bg-blue-500/10 text-blue-500 rounded-lg hover:bg-blue-500 hover:text-white transition-colors" title="Start Operation"><Play className="w-4 h-4" /></button>
                      {activeTab === 'active' && (
                        <button onClick={() => confirm({ title: "Complete Job", message: "Mark as finished?", onConfirm: () => DB.completeJob(j.id) })} className="p-2 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white rounded-lg transition-colors" title="Complete Job"><CheckCircle className="w-4 h-4" /></button>
                      )}
                      {j.dueDate && (
                        <button onClick={() => {
                          const url = getCalendarUrl(j);
                          if (url) {
                            const updated = [...calAdded]; if (!updated.includes(j.id)) { updated.push(j.id); setCalAdded(updated); localStorage.setItem('cal_added_jobs', JSON.stringify(updated)); }
                            window.location.href = url;
                          }
                        }} className={`p-2 rounded-lg transition-colors ${calAdded.includes(j.id) ? 'bg-emerald-500/10 text-emerald-400' : 'hover:bg-blue-500/10 text-zinc-500 hover:text-blue-400'}`} title={calAdded.includes(j.id) ? 'Already in Google Calendar' : 'Add to Google Calendar'}>
                          {calAdded.includes(j.id) ? <CheckCircle className="w-4 h-4" /> : <Calendar className="w-4 h-4" />}
                        </button>
                      )}
                      <button onClick={() => setPrintable(j)} className={`p-2 rounded-lg transition-colors ${printed.includes(j.id) ? 'bg-emerald-500/10 text-emerald-400' : 'hover:bg-zinc-800 text-zinc-400 hover:text-white'}`} title={printed.includes(j.id) ? 'Printed ✓ — click to reprint' : 'Print Traveler'}><Printer className="w-4 h-4" /></button>
                      <button onClick={() => { setEditingJob(j); setShowModal(true); }} className="p-2 hover:bg-zinc-800 rounded-lg text-blue-400 hover:text-white" title="Edit"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => confirm({ title: "Delete Job", message: "Permanently delete?", onConfirm: () => DB.deleteJob(j.id) })} className="p-2 hover:bg-red-500/10 rounded-lg text-red-400 hover:text-red-500" title="Delete"><Trash2 className="w-4 h-4" /></button>
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

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-zinc-900 border border-white/10 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-white/10 flex justify-between items-center bg-zinc-800/50">
              <h3 className="font-bold text-white text-lg">{editingJob.id ? 'Edit Job' : 'Create New Job'}</h3>
              <button onClick={() => setShowModal(false)}><X className="w-5 h-5 text-zinc-500 hover:text-white" /></button>
            </div>
            <div className="p-8 overflow-y-auto space-y-8">
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
                <div>
                  <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">Quote / Revenue Amount ($)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-3 text-zinc-500 font-bold text-lg">$</span>
                    <input type="number" step="0.01" className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 pl-9 text-white font-mono text-lg outline-none focus:ring-2 focus:ring-emerald-500/50" value={editingJob.quoteAmount || ''} onChange={e => setEditingJob({ ...editingJob, quoteAmount: Number(e.target.value) || 0 })} placeholder="0.00" />
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-1">What the customer is paying for this job. Profit is calculated automatically when the job is completed.</p>
                </div>
              </div>

              {/* Part Photo */}
              <div className="space-y-5">
                <h4 className="text-xs font-black text-cyan-400 uppercase tracking-[0.2em] border-b border-cyan-500/20 pb-2 flex items-center gap-2">
                  <span className="bg-cyan-500/10 text-cyan-400 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black">5</span>
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
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
          <div className="bg-zinc-900 border border-white/10 w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">

            {/* Header — always visible */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
              <div>
                <h3 className="text-lg font-bold text-white">Start Operation</h3>
                <p className="text-sm text-zinc-400 mt-0.5">PO: <strong className="text-white">{startJobModal.poNumber}</strong> — {startJobModal.partNumber}</p>
              </div>
              <button
                onClick={() => { setStartJobModal(null); setSelectedWorker(null); }}
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
                onClick={() => { setStartJobModal(null); setSelectedWorker(null); }}
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
    </div>
  );
};

// ============================================================
// --- ADMIN: LOGS (v3  filters by JOB completion status) ---
// ============================================================
const LogsView = ({ addToast, confirm }: { addToast: any; confirm?: (cfg: any) => void }) => {
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingLog, setEditingLog] = useState<TimeLog | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const savedScrollRef = useRef(0);
  const [ops, setOps] = useState<string[]>([]);
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedExportJobs, setSelectedExportJobs] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [showBackfill, setShowBackfill] = useState(false);
  const [bfJob, setBfJob] = useState('');
  const [bfWorker, setBfWorker] = useState('');
  const [bfOp, setBfOp] = useState('');
  const [bfStart, setBfStart] = useState('');
  const [bfEnd, setBfEnd] = useState('');

  // "active" = job not yet marked complete | "completed" = job marked complete
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'completed'>('active');
  const [filterSearch, setFilterSearch] = useState('');

  const [dateRange, setDateRange] = useState<{ start: string; end: string }>(() => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay  = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { start: fmt(firstDay), end: fmt(lastDay) };
  });

  useEffect(() => {
    const unsub1 = DB.subscribeLogs(setLogs);
    const unsub2 = DB.subscribeUsers(setUsers);
    const unsub3 = DB.subscribeJobs(setJobs);
    const unsub4 = DB.subscribeSettings((s) => setOps(s.customOperations || []));
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [refreshKey]);

  // Build quick lookups: jobId → job.status and jobId → full job
  const jobStatusMap = useMemo(() => {
    const map: Record<string, string> = {};
    jobs.forEach(j => { map[j.id] = j.status; });
    return map;
  }, [jobs]);

  const jobMap = useMemo(() => {
    const map: Record<string, Job> = {};
    jobs.forEach(j => { map[j.id] = j; });
    return map;
  }, [jobs]);

  const handleEditLog = (log: TimeLog) => {
    savedScrollRef.current = document.querySelector('main')?.scrollTop ?? 0;
    setEditingLog({ ...log });
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setEditingLog(null);
    requestAnimationFrame(() => {
      const main = document.querySelector('main');
      if (main) main.scrollTop = savedScrollRef.current;
    });
  };

  const handleSaveLog = async () => {
    if (!editingLog) return;
    if (editingLog.endTime && editingLog.endTime < editingLog.startTime) {
      addToast('error', 'End time cannot be before Start time');
      return;
    }
    try {
      await DB.updateTimeLog(editingLog);
      addToast('success', 'Log updated successfully');
      closeEditModal();
    } catch (e) { addToast('error', 'Failed to update log'); }
  };

  const handleDeleteLog = () => {
    if (!editingLog) return;
    const logToDelete = editingLog;
    const doDelete = async () => {
      try {
        await DB.deleteTimeLog(logToDelete.id);
        addToast('success', 'Log deleted');
        closeEditModal();
      } catch (e) { addToast('error', 'Failed to delete log'); }
    };
    if (confirm) {
      confirm({ title: 'Delete Log', message: `Permanently delete this time entry for ${logToDelete.userName}?`, onConfirm: doDelete });
    } else {
      doDelete();
    }
  };

  const setPreset = (type: 'today' | 'week' | 'month') => {
    const now = new Date();
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (type === 'today') {
      const s = fmt(now);
      setDateRange({ start: s, end: s });
    } else if (type === 'week') {
      const diff = now.getDay() === 0 ? -6 : 1 - now.getDay();
      const mon = new Date(now); mon.setDate(now.getDate() + diff);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      setDateRange({ start: fmt(mon), end: fmt(sun) });
    } else {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last  = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setDateRange({ start: fmt(first), end: fmt(last) });
    }
  };

  const groupedLogs = useMemo(() => {
    const [sY, sM, sD] = dateRange.start.split('-').map(Number);
    const startTs = new Date(sY, sM - 1, sD, 0, 0, 0, 0).getTime();
    const [eY, eM, eD] = dateRange.end.split('-').map(Number);
    const endTs = new Date(eY, eM - 1, eD, 23, 59, 59, 999).getTime();

    const term = filterSearch.toLowerCase().trim();

    const filtered = logs.filter(log => {
      //  KEY LOGIC 
      // A log belongs to "completed" tab if its parent JOB is marked complete.
      // A log belongs to "active" tab if its parent JOB is NOT yet complete.
      // Individual timer start/stop (log.endTime) is shown INSIDE the group
      // as a detail row  it does NOT drive the tab grouping.
      // 
      const jobIsCompleted = jobStatusMap[log.jobId] === 'completed';

      if (activeTab === 'completed' && !jobIsCompleted) return false;
      if (activeTab === 'active'    &&  jobIsCompleted) return false;

      // Date range: use startTime for the check (covers both active & completed logs)
      if (log.startTime < startTs || log.startTime > endTs) return false;

      // Search — includes job's poNumber and partNumber from the job record
      if (term) {
        const job = jobMap[log.jobId];
        const haystack = [
          log.jobId, log.jobIdsDisplay, log.userName,
          log.operation, log.partNumber, log.customer,
          job?.poNumber, job?.partNumber,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(term)) return false;
      }

      return true;
    });

    // Group by the human-readable job display ID
    const groups: Record<string, {
      jobId: string;
      internalJobId: string;
      partNumber: string;
      customer: string;
      dueDate: string;
      poNumber: string;
      jobIsCompleted: boolean;
      completedAt: number | null;
      logs: TimeLog[];
      totalDurationMinutes: number;
      users: Set<string>;
      lastActivity: number;
      runningCount: number;   // timers still ticking
      stoppedCount: number;   // timers that have been stopped
    }> = {};

    filtered.forEach(log => {
      const displayKey = log.jobIdsDisplay || log.jobId || 'Unknown Job';
      if (!groups[displayKey]) {
        // Pull extra info from the jobs list
        const job = jobs.find(j => j.id === log.jobId);
        groups[displayKey] = {
          jobId: displayKey,
          internalJobId: log.jobId,
          partNumber: log.partNumber || job?.partNumber || 'N/A',
          customer:   log.customer  || job?.customer  || '',
          dueDate:    job?.dueDate  || '',
          poNumber:   job?.poNumber || '',
          quantity:   job?.quantity || 0,
          jobIsCompleted: jobStatusMap[log.jobId] === 'completed',
          completedAt:    job?.completedAt || null,
          logs: [],
          totalDurationMinutes: 0,
          users: new Set(),
          lastActivity: 0,
          runningCount: 0,
          stoppedCount: 0,
        };
      }
      const g = groups[displayKey];
      g.logs.push(log);
      if (log.durationMinutes) g.totalDurationMinutes += log.durationMinutes;
      g.users.add(log.userName);
      const t = log.endTime || log.startTime;
      if (t > g.lastActivity) g.lastActivity = t;
      if (log.endTime) g.stoppedCount++;
      else g.runningCount++;
    });

    return Object.values(groups)
      .sort((a, b) => {
        // Completed jobs: sort by when job was completed, newest first
        if (a.jobIsCompleted && b.jobIsCompleted) {
          return (b.completedAt || b.lastActivity) - (a.completedAt || a.lastActivity);
        }
        // Active jobs: sort by most recent activity
        return b.lastActivity - a.lastActivity;
      })
      .map(g => {
        g.logs.sort((a, b) => b.startTime - a.startTime);
        return g;
      });
  }, [logs, jobs, jobStatusMap, jobMap, activeTab, dateRange, filterSearch]);

  const totalHours    = groupedLogs.reduce((acc, g) => acc + g.totalDurationMinutes / 60, 0);
  const totalEntries  = groupedLogs.reduce((acc, g) => acc + g.logs.length, 0);

  // Counts for the tab badges (based on JOB status, not log status)
  const jobsWithLogs     = useMemo(() => new Set(logs.map(l => l.jobId)), [logs]);
  const activeJobCount   = useMemo(() => [...jobsWithLogs].filter(id => jobStatusMap[id] !== 'completed').length, [jobsWithLogs, jobStatusMap]);
  const completedJobCount= useMemo(() => [...jobsWithLogs].filter(id => jobStatusMap[id] === 'completed').length, [jobsWithLogs, jobStatusMap]);

  // ── CSV Export ───────────────────────────────────────────────────────────────
  const openExportModal = () => {
    // Pre-select all jobs by default
    setSelectedExportJobs(new Set(groupedLogs.map(g => g.jobId)));
    setShowExportModal(true);
  };

  const toggleExportJob = (jobId: string) => {
    setSelectedExportJobs(prev => {
      const next = new Set(prev);
      next.has(jobId) ? next.delete(jobId) : next.add(jobId);
      return next;
    });
  };

  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

  const fmtDate = (ts: number) =>
    new Date(ts).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });

  const fmtDur = (mins: number) => {
    if (!mins) return '';
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const csvEscape = (val: string | number | undefined) => {
    const s = String(val ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const exportToGoogleSheets = () => {
    const exportGroups = groupedLogs.filter(g => selectedExportJobs.has(g.jobId));
    if (exportGroups.length === 0) { addToast('error', 'Select at least one PO to export'); return; }
    if (typeof (window as any).__requestSheetsAccess !== 'function') {
      addToast('error', 'Google Sheets not available'); return;
    }

    setExporting(true);

    (window as any).__requestSheetsAccess(async (success: boolean, err: string) => {
      if (!success) {
        addToast('error', 'Google access denied: ' + (err || 'Unknown error'));
        setExporting(false); return;
      }
      try {
        const sheetsToken: string = (window as any).__sheetsToken;
        const drStart = new Date(dateRange.start + 'T00:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
        const drEnd   = new Date(dateRange.end   + 'T00:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
        const totalExportMins = exportGroups.reduce((a, g) => a + g.totalDurationMinutes, 0);
        const now = new Date().toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
        const title = `SC Deburring Work Logs — ${drStart} to ${drEnd}`;

        // ── Build rows + track formatting targets ──────────────────
        const rows: any[][] = [];
        const formatRequests: any[] = [];

        // Helper: record row index BEFORE pushing
        const colCount = 13;

        // Rows 0-4: Report header
        rows.push(['SC DEBURRING — Work Log Export', ...Array(colCount - 1).fill('')]);
        rows.push([`Date Range: ${drStart} to ${drEnd}`, ...Array(colCount - 1).fill('')]);
        rows.push([`Generated: ${now}  |  POs: ${exportGroups.length}  |  Total Hours: ${(totalExportMins / 60).toFixed(2)}`, ...Array(colCount - 1).fill('')]);
        rows.push(Array(colCount).fill(''));

        // Row 4: Column headers
        const headerRowIdx = rows.length;
        rows.push(['PO Number', 'SC Job #', 'Part Number', 'Customer', 'Status', 'Date', 'Employee', 'Operation', 'Start', 'End', 'Mins', 'Duration', 'Timer']);

        const jobSeparatorRowIdxs: number[] = [];
        const subtotalRowIdxs: number[] = [];
        const logRowIdxs: number[] = [];

        exportGroups.forEach(group => {
          rows.push(Array(colCount).fill('')); // blank

          // Job separator
          jobSeparatorRowIdxs.push(rows.length);
          rows.push([
            `PO: ${group.poNumber || group.jobId}`,
            `SC#: ${group.jobId}`,
            `Part: ${group.partNumber}`,
            group.customer || '',
            group.jobIsCompleted ? 'COMPLETED' : 'ACTIVE',
            `Total: ${fmtDur(group.totalDurationMinutes)}`,
            `Staff: ${[...group.users].join(', ')}`,
            '', '', '', '', '', '',
          ]);

          // Log entries
          group.logs.forEach(log => {
            logRowIdxs.push(rows.length);
            rows.push([
              group.poNumber || group.jobId,
              group.jobId,
              group.partNumber,
              group.customer || '',
              group.jobIsCompleted ? 'Completed' : 'Active',
              fmtDate(log.startTime),
              log.userName,
              log.operation,
              fmtTime(log.startTime),
              log.endTime ? fmtTime(log.endTime) : 'Running',
              log.durationMinutes ? Math.round(log.durationMinutes) : '',
              log.durationMinutes ? fmtDur(log.durationMinutes) : '',
              log.endTime ? 'Stopped' : 'Live',
            ]);
          });

          // Subtotal
          subtotalRowIdxs.push(rows.length);
          rows.push(['', '', '', '', '', 'JOB TOTAL', '', '', '', '',
            Math.round(group.totalDurationMinutes),
            fmtDur(group.totalDurationMinutes), '']);
        });

        rows.push(Array(colCount).fill(''));
        const grandTotalRowIdx = rows.length;
        rows.push(['GRAND TOTAL', '', '', '', '', '', '', '', '', '',
          Math.round(totalExportMins), fmtDur(totalExportMins), '']);

        // ── Create spreadsheet ────────────────────────────────────
        const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${sheetsToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            properties: { title },
            sheets: [{ properties: { title: 'Work Logs', gridProperties: { frozenRowCount: headerRowIdx + 1 } } }]
          }),
        });
        if (!createRes.ok) throw new Error(`Create failed: ${await createRes.text()}`);
        const createData = await createRes.json();
        const spreadsheetId = createData.spreadsheetId;
        const spreadsheetUrl = createData.spreadsheetUrl;
        const sheetId = createData.sheets[0].properties.sheetId;

        // ── Write values ──────────────────────────────────────────
        const writeRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Work%20Logs!A1?valueInputOption=USER_ENTERED`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${sheetsToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: rows }),
        });
        if (!writeRes.ok) throw new Error(`Write failed: ${await writeRes.text()}`);

        // ── Helper colors ─────────────────────────────────────────
        const rgb = (r: number, g: number, b: number) => ({ red: r/255, green: g/255, blue: b/255 });
        const rowFmt = (rowIdx: number, bg: any, textColor: any, bold: boolean, fontSize?: number) => ({
          repeatCell: {
            range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: colCount },
            cell: { userEnteredFormat: {
              backgroundColor: bg,
              textFormat: { foregroundColor: textColor, bold, fontSize: fontSize || 10 },
              verticalAlignment: 'MIDDLE',
              wrapStrategy: 'CLIP',
            }},
            fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)',
          }
        });

        // Title row (row 0)
        formatRequests.push(rowFmt(0, rgb(15, 23, 42), rgb(255,255,255), true, 13));
        // Info rows (1-2)
        formatRequests.push(rowFmt(1, rgb(30, 41, 59), rgb(148,163,184), false, 9));
        formatRequests.push(rowFmt(2, rgb(30, 41, 59), rgb(148,163,184), false, 9));
        // Column header row
        formatRequests.push(rowFmt(headerRowIdx, rgb(30, 64, 175), rgb(255,255,255), true, 10));
        // Job separator rows
        jobSeparatorRowIdxs.forEach(i => formatRequests.push(rowFmt(i, rgb(55, 65, 81), rgb(229,231,235), true, 10)));
        // Subtotal rows
        subtotalRowIdxs.forEach(i => formatRequests.push(rowFmt(i, rgb(220, 252, 231), rgb(21, 128, 61), true, 10)));
        // Grand total row
        formatRequests.push(rowFmt(grandTotalRowIdx, rgb(21, 128, 61), rgb(255,255,255), true, 11));

        // Alternating log row colors
        logRowIdxs.forEach((i, idx) => {
          const bg = idx % 2 === 0 ? rgb(255,255,255) : rgb(248,250,252);
          formatRequests.push(rowFmt(i, bg, rgb(30,41,59), false, 10));
        });

        // Column widths
        const colWidths = [120, 90, 110, 100, 80, 85, 90, 130, 80, 80, 50, 70, 60];
        colWidths.forEach((px, i) => {
          formatRequests.push({
            updateDimensionProperties: {
              range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
              properties: { pixelSize: px },
              fields: 'pixelSize',
            }
          });
        });

        // Row heights
        formatRequests.push({
          updateDimensionProperties: {
            range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: rows.length },
            properties: { pixelSize: 22 },
            fields: 'pixelSize',
          }
        });
        // Taller title row
        formatRequests.push({
          updateDimensionProperties: {
            range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
            properties: { pixelSize: 32 },
            fields: 'pixelSize',
          }
        });

        // ── Apply formatting ───────────────────────────────────────
        const fmtRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${sheetsToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests: formatRequests }),
        });
        if (!fmtRes.ok) throw new Error(`Format failed: ${await fmtRes.text()}`);

        window.open(spreadsheetUrl, '_blank');
        setShowExportModal(false);
        addToast('success', `Opened in Google Sheets — ${exportGroups.length} PO${exportGroups.length !== 1 ? 's' : ''} exported`);
      } catch (e: any) {
        addToast('error', 'Export failed: ' + (e?.message || 'Unknown error'));
      } finally {
        setExporting(false);
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 no-print">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2 text-white"><Calendar className="w-6 h-6 text-blue-500" /> Work Logs</h2>
          <p className="text-zinc-500 text-sm mt-1">Logs grouped by job  Active = job still open, Completed = job marked done.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => { setShowBackfill(true); setBfJob(''); setBfWorker(''); setBfOp(''); setBfStart(''); setBfEnd(''); }} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-bold transition-colors">
            <Plus className="w-4 h-4" /> Backfill Entry
          </button>
          <button onClick={openExportModal} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-bold transition-colors shadow-lg shadow-emerald-900/20">
            <Download className="w-4 h-4" /> Export
          </button>
          <button onClick={() => setRefreshKey(k => k + 1)} className="px-3 bg-zinc-900 border border-white/10 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 no-print">
        <div className="bg-zinc-900/50 border border-white/5 p-4 rounded-xl">
          <p className="text-zinc-500 text-xs uppercase font-bold">Jobs Shown</p>
          <p className="text-2xl font-bold text-white">{groupedLogs.length}</p>
        </div>
        <div className="bg-zinc-900/50 border border-white/5 p-4 rounded-xl">
          <p className="text-zinc-500 text-xs uppercase font-bold">Total Hours</p>
          <p className="text-2xl font-bold text-blue-400">{totalHours.toFixed(2)} hrs</p>
        </div>
        <div className="bg-zinc-900/50 border border-orange-500/10 p-4 rounded-xl">
          <p className="text-zinc-500 text-xs uppercase font-bold">Active Jobs</p>
          <p className="text-2xl font-bold text-orange-400">{activeJobCount}</p>
        </div>
        <div className="bg-zinc-900/50 border border-emerald-500/10 p-4 rounded-xl">
          <p className="text-zinc-500 text-xs uppercase font-bold">Completed Jobs</p>
          <p className="text-2xl font-bold text-emerald-400">{completedJobCount}</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-zinc-900 border border-white/10 rounded-2xl p-4 space-y-4 no-print">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold text-zinc-500">Start Date</label>
            <input type="date" value={dateRange.start} onChange={e => setDateRange({ ...dateRange, start: e.target.value })} className="bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white min-w-[130px]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold text-zinc-500">End Date</label>
            <input type="date" value={dateRange.end} onChange={e => setDateRange({ ...dateRange, end: e.target.value })} className="bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white min-w-[130px]" />
          </div>
          <div className="flex gap-1">
            {(['today', 'week', 'month'] as const).map(p => (
              <button key={p} onClick={() => setPreset(p)} className="px-3 py-2 text-xs font-bold rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors capitalize">{p}</button>
            ))}
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-3 items-start md:items-center">
          {/* Tabs driven by JOB status */}
          <div className="bg-black/30 p-1 rounded-xl flex gap-1 shrink-0">
            {([
              { key: 'all',       label: 'All Jobs',        count: activeJobCount + completedJobCount },
              { key: 'active',    label: ' Active Jobs',  count: activeJobCount },
              { key: 'completed', label: ' Completed Jobs',count: completedJobCount },
            ] as const).map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${activeTab === key ? 'bg-zinc-700 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                {label}
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${activeTab === key ? 'bg-zinc-600 text-zinc-200' : 'bg-zinc-800 text-zinc-500'}`}>{count}</span>
              </button>
            ))}
          </div>

          <div className="flex-1 relative w-full">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
            <input
              placeholder="Search by PO#, Part#, Employee, Operation..."
              value={filterSearch}
              onChange={e => setFilterSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-black/30 border border-white/10 rounded-xl text-sm text-white focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>
      </div>

      {/* Grouped Logs */}
      <div className="space-y-4">
        {groupedLogs.length === 0 && (
          <div className="p-12 text-center text-zinc-500 bg-zinc-900/50 rounded-2xl border border-white/5">
            <div className="inline-block p-4 rounded-full bg-zinc-800 mb-4"><Filter className="w-8 h-8 text-zinc-600" /></div>
            <p className="font-medium">No logs found matching your filters.</p>
            <p className="text-sm mt-2 text-zinc-600">Try adjusting the date range or switching tabs.</p>
          </div>
        )}

        {groupedLogs.map(group => (
          <div key={group.jobId}
            className={`border rounded-2xl overflow-hidden shadow-sm transition-all ${
              group.jobIsCompleted
                ? 'bg-emerald-950/20 border-emerald-500/20 hover:border-emerald-500/40'
                : 'bg-zinc-900/50 border-white/5 hover:border-white/10'
            }`}
          >
            {/* Group Header */}
            <div className={`p-4 border-b flex flex-col md:flex-row md:items-center justify-between gap-4 ${group.jobIsCompleted ? 'bg-emerald-950/30 border-emerald-500/10' : 'bg-zinc-900/80 border-white/5'}`}>
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${group.jobIsCompleted ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-blue-500/10 border border-blue-500/20'}`}>
                  {group.jobIsCompleted
                    ? <CheckCircle className="w-5 h-5 text-emerald-400" />
                    : <Briefcase className="w-5 h-5 text-blue-500" />
                  }
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-xl font-black text-white leading-tight">{group.poNumber || group.jobId}</h3>
                    {group.jobIsCompleted
                      ? <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full uppercase tracking-wider">Job Complete</span>
                      : <span className="text-[10px] font-black text-orange-400 bg-orange-500/10 border border-orange-500/30 px-2 py-0.5 rounded-full uppercase tracking-wider">In Production</span>
                    }
                  </div>
                  <div className="flex items-center gap-2 text-xs mt-1 flex-wrap">
                    {group.poNumber && <span className="text-zinc-500 font-mono">Job ID: {group.jobId}</span>}
                    {group.poNumber && <span className="text-zinc-700"></span>}
                    <span className="text-zinc-500">Part: <span className="text-zinc-300">{group.partNumber}</span></span>
                    {group.quantity > 0 && <><span className="text-zinc-700"></span><span className="text-zinc-500">Qty: <span className="text-zinc-300">{group.quantity}</span></span></>}
                    {group.customer && <><span className="text-zinc-700"></span><span className="text-zinc-400">{group.customer}</span></>}
                    {group.dueDate  && <><span className="text-zinc-700"></span><span className="text-zinc-500">Due: <span className="text-zinc-300">{fmt(group.dueDate)}</span></span></>}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {group.runningCount > 0 && (
                      <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
                        {group.runningCount} timer{group.runningCount > 1 ? 's' : ''} running
                      </span>
                    )}
                    {group.stoppedCount > 0 && (
                      <span className="text-[10px] font-bold text-zinc-400 bg-zinc-800 border border-white/10 px-2 py-0.5 rounded-full">
                        {group.stoppedCount} operation{group.stoppedCount > 1 ? 's' : ''} logged
                      </span>
                    )}
                    {group.completedAt && (
                      <span className="text-[10px] text-emerald-500 font-bold">
                        Completed {new Date(group.completedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs shrink-0">
                <div className="text-right">
                  <p className="text-zinc-500 uppercase font-bold tracking-wide">Total Time</p>
                  <p className={`text-xl font-mono font-bold ${group.jobIsCompleted ? 'text-emerald-400' : 'text-white'}`}>{formatDuration(group.totalDurationMinutes)}</p>
                </div>
                <div className="text-right border-l border-white/10 pl-4">
                  <p className="text-zinc-500 uppercase font-bold tracking-wide">Staff</p>
                  <p className="text-white text-lg font-bold">{group.users.size}</p>
                </div>
                {(() => {
                  const job = jobs.find(j => j.id === group.internalJobId);
                  const ss = DB.getSettings();
                  const r = ss.shopRate || 0;
                  if (!r || !group.totalDurationMinutes) return null;
                  const hrs = group.totalDurationMinutes / 60;
                  const ohR = (ss.monthlyOverhead || 0) / (ss.monthlyWorkHours || 160);
                  const cost = hrs * (r + ohR);
                  const quote = job?.quoteAmount || 0;
                  const profit = quote > 0 ? quote - cost : null;
                  return (
                    <div className="text-right border-l border-white/10 pl-4">
                      <p className="text-zinc-500 uppercase font-bold tracking-wide">Cost</p>
                      <p className="text-white text-lg font-mono font-bold">${cost.toFixed(0)}</p>
                      {profit !== null && (
                        <p className={`text-xs font-black mt-0.5 ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {profit >= 0 ? '+' : '-'}${Math.abs(profit).toFixed(0)} {profit >= 0 ? 'profit' : 'loss'}
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Logs Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-black/20 text-zinc-500 uppercase tracking-wide">
                  <tr>
                    <th className="p-3 pl-6">Date</th>
                    <th className="p-3">Employee</th>
                    <th className="p-3">Operation</th>
                    <th className="p-3">Start  End</th>
                    <th className="p-3">Timer</th>
                    <th className="p-3 text-right pr-6">Duration</th>
                    <th className="p-3 text-right pr-6 no-print"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {group.logs.map(log => (
                    <React.Fragment key={log.id}>
                    <tr className="hover:bg-white/5 transition-colors group/row">
                      <td className="p-3 pl-6 text-zinc-400 whitespace-nowrap">{new Date(log.startTime).toLocaleDateString()}</td>
                      <td className="p-3 text-white font-semibold">{log.userName}</td>
                      <td className="p-3 text-blue-400 font-medium">{log.operation}</td>
                      <td className="p-3 font-mono text-zinc-400 whitespace-nowrap">
                        {new Date(log.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {'  '}
                        {log.endTime
                          ? new Date(log.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : <span className="text-blue-400 font-bold">Running</span>
                        }
                      </td>
                      <td className="p-3">
                        {log.endTime
                          ? <span className="text-[10px] font-bold text-zinc-400 bg-zinc-800 border border-white/10 px-2 py-0.5 rounded-full">Stopped</span>
                          : <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full flex items-center gap-1 w-fit"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>Live</span>
                        }
                      </td>
                      <td className="p-3 text-right pr-6 font-mono text-zinc-300 font-bold">{formatDuration(log.durationMinutes)}</td>
                      <td className="p-3 text-right pr-6 no-print opacity-0 group-hover/row:opacity-100 transition-opacity">
                        <button onClick={() => handleEditLog(log)} className="text-blue-500 hover:text-white p-1 rounded hover:bg-blue-500/20 transition-colors" title="Edit log"><Edit2 className="w-3 h-3" /></button>
                      </td>
                    </tr>
                    {log.notes && (
                      <tr className="bg-amber-500/5 border-l-2 border-amber-500/40">
                        <td colSpan={7} className="px-6 py-2">
                          <div className="flex items-start gap-2 text-sm">
                            <span className="text-amber-500 mt-0.5">📝</span>
                            <div>
                              <span className="text-amber-300/90">{log.notes}</span>
                              <span className="text-zinc-600 text-xs ml-2">— {log.userName}</span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {/* Edit Modal */}
      {showEditModal && editingLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-zinc-800/50">
              <h3 className="font-bold text-white flex items-center gap-2"><Edit2 className="w-4 h-4 text-blue-500" /> Edit Time Log</h3>
              <button onClick={closeEditModal}><X className="w-5 h-5 text-zinc-500 hover:text-white" /></button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="text-xs text-zinc-500 uppercase font-bold mb-1 block">Employee</label>
                <select className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  value={editingLog.userId}
                  onChange={e => {
                    const u = users.find(u => u.id === e.target.value);
                    if (u) setEditingLog({ ...editingLog, userId: u.id, userName: u.name });
                  }}>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-zinc-500 uppercase font-bold mb-1 block">Operation</label>
                <select className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  value={editingLog.operation}
                  onChange={e => setEditingLog({ ...editingLog, operation: e.target.value })}>
                  {ops.map(o => <option key={o} value={o}>{o}</option>)}
                  {!ops.includes(editingLog.operation) && <option value={editingLog.operation}>{editingLog.operation} (Legacy)</option>}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-zinc-500 uppercase font-bold mb-1 block">Start Time</label>
                  <input type="datetime-local" className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white text-sm"
                    value={toDateTimeLocal(editingLog.startTime)}
                    onChange={e => setEditingLog({ ...editingLog, startTime: new Date(e.target.value).getTime() })} />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 uppercase font-bold mb-1 block">End Time</label>
                  <input type="datetime-local" className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white text-sm"
                    value={toDateTimeLocal(editingLog.endTime)}
                    onChange={e => {
                      const val = e.target.value ? new Date(e.target.value).getTime() : null;
                      setEditingLog({ ...editingLog, endTime: val });
                    }} />
                  <p className="text-[10px] text-zinc-500 mt-1">Clear to mark as active.</p>
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-white/10 bg-zinc-800/50 flex justify-between items-center">
              <button onClick={handleDeleteLog} className="text-red-500 hover:text-red-400 text-sm font-bold flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-500/10 transition-colors"><Trash2 className="w-4 h-4" /> Delete Log</button>
              <div className="flex gap-2">
                <button onClick={closeEditModal} className="px-4 py-2 text-zinc-400 hover:text-white">Cancel</button>
                <button onClick={handleSaveLog} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-xl font-bold">Save Changes</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Backfill Entry Modal ──────────────────────────────────── */}
      {showBackfill && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
          <div className="bg-zinc-900 border border-white/10 w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <div><h3 className="text-lg font-bold text-white flex items-center gap-2"><Clock className="w-5 h-5 text-blue-400" /> Backfill Time Entry</h3><p className="text-sm text-zinc-400 mt-0.5">Add a past entry for a worker who forgot to scan</p></div>
              <button onClick={() => setShowBackfill(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 pb-4 space-y-4">
              <div>
                <label className="text-xs font-bold text-zinc-500 uppercase block mb-1">Job</label>
                <select value={bfJob} onChange={e => setBfJob(e.target.value)} className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white">
                  <option value="">Select job...</option>
                  {jobs.filter(j => j.status !== 'completed').map(j => <option key={j.id} value={j.id}>PO {j.poNumber} — {j.partNumber}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-zinc-500 uppercase block mb-1">Worker</label>
                <select value={bfWorker} onChange={e => setBfWorker(e.target.value)} className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white">
                  <option value="">Select worker...</option>
                  {users.filter(u => u.isActive !== false).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-zinc-500 uppercase block mb-1">Operation</label>
                <select value={bfOp} onChange={e => setBfOp(e.target.value)} className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white">
                  <option value="">Select operation...</option>
                  {ops.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-zinc-500 uppercase block mb-1">Start Time</label>
                  <input type="datetime-local" value={bfStart} onChange={e => setBfStart(e.target.value)} className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white" />
                </div>
                <div>
                  <label className="text-xs font-bold text-zinc-500 uppercase block mb-1">End Time</label>
                  <input type="datetime-local" value={bfEnd} onChange={e => setBfEnd(e.target.value)} className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white" />
                </div>
              </div>
              {bfStart && bfEnd && new Date(bfEnd) > new Date(bfStart) && (
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-center">
                  <span className="text-blue-400 font-bold">{((new Date(bfEnd).getTime() - new Date(bfStart).getTime()) / 3600000).toFixed(1)}h</span>
                  <span className="text-zinc-400 text-sm"> will be logged</span>
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-white/5 flex gap-3">
              <button onClick={() => setShowBackfill(false)} className="flex-1 py-3 rounded-xl bg-zinc-800 text-zinc-300 font-bold text-sm">Cancel</button>
              <button
                disabled={!bfJob || !bfWorker || !bfOp || !bfStart || !bfEnd || new Date(bfEnd) <= new Date(bfStart)}
                onClick={async () => {
                  try {
                    const job = jobs.find(j => j.id === bfJob);
                    const worker = users.find(u => u.id === bfWorker);
                    if (!job || !worker) return;
                    await DB.createBackfillLog(
                      bfJob, bfWorker, worker.name, bfOp,
                      new Date(bfStart).getTime(), new Date(bfEnd).getTime(),
                      job.partNumber, job.customer, job.jobIdsDisplay
                    );
                    addToast('success', `Backfill logged: ${worker.name} → ${job.poNumber} (${bfOp})`);
                    setShowBackfill(false);
                    setRefreshKey(k => k + 1);
                  } catch (e: any) { addToast('error', e?.message || 'Failed to create backfill'); }
                }}
                className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-30 text-white font-bold text-sm transition-colors"
              >
                Save Entry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Export CSV Modal ─────────────────────────────────────────── */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="p-5 border-b border-white/10 flex justify-between items-center bg-zinc-800/50">
              <div>
                <h3 className="font-bold text-white text-lg flex items-center gap-2">
                  <Download className="w-5 h-5 text-emerald-400" /> Export Work Logs
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {dateRange.start} → {dateRange.end} · {groupedLogs.length} PO{groupedLogs.length !== 1 ? 's' : ''} in current view
                </p>
              </div>
              <button onClick={() => setShowExportModal(false)}><X className="w-5 h-5 text-zinc-500 hover:text-white" /></button>
            </div>

            {/* PO Selector */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Select POs to Export</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedExportJobs(new Set(groupedLogs.map(g => g.jobId)))}
                    className="text-[11px] text-blue-400 hover:text-blue-300 font-bold"
                  >Select All</button>
                  <span className="text-zinc-700">·</span>
                  <button
                    onClick={() => setSelectedExportJobs(new Set())}
                    className="text-[11px] text-zinc-500 hover:text-zinc-300 font-bold"
                  >Clear</button>
                </div>
              </div>

              {groupedLogs.length === 0 ? (
                <p className="text-zinc-500 text-sm text-center py-8">No logs in current date range.</p>
              ) : (
                groupedLogs.map(group => {
                  const checked = selectedExportJobs.has(group.jobId);
                  return (
                    <label
                      key={group.jobId}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        checked
                          ? 'bg-emerald-500/10 border-emerald-500/30'
                          : 'bg-zinc-800/50 border-white/5 hover:border-white/15'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleExportJob(group.jobId)}
                        className="w-4 h-4 accent-emerald-500 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-black text-white text-sm">{group.poNumber || group.jobId}</span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                            group.jobIsCompleted
                              ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                              : 'text-orange-400 bg-orange-500/10 border-orange-500/20'
                          }`}>{group.jobIsCompleted ? 'Completed' : 'Active'}</span>
                        </div>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                          {group.partNumber}{group.customer ? ` · ${group.customer}` : ''} · {group.logs.length} entr{group.logs.length === 1 ? 'y' : 'ies'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-white font-mono">{fmtDur(group.totalDurationMinutes)}</p>
                        <p className="text-[10px] text-zinc-600">{[...group.users].join(', ')}</p>
                      </div>
                    </label>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="p-5 border-t border-white/10 bg-zinc-800/30 space-y-3">
              {/* Summary of selection */}
              {selectedExportJobs.size > 0 && (() => {
                const sel = groupedLogs.filter(g => selectedExportJobs.has(g.jobId));
                const selMins = sel.reduce((a, g) => a + g.totalDurationMinutes, 0);
                const selEntries = sel.reduce((a, g) => a + g.logs.length, 0);
                return (
                  <div className="flex items-center justify-between text-xs text-zinc-400 bg-zinc-900/50 rounded-lg px-3 py-2">
                    <span><span className="text-white font-bold">{selectedExportJobs.size}</span> PO{selectedExportJobs.size !== 1 ? 's' : ''} selected · <span className="text-white font-bold">{selEntries}</span> entries</span>
                    <span>Total: <span className="text-emerald-400 font-bold">{fmtDur(selMins)}</span></span>
                  </div>
                );
              })()}
              <div className="flex gap-3">
                <button onClick={() => setShowExportModal(false)} disabled={exporting} className="px-4 py-2.5 text-zinc-400 hover:text-white text-sm font-medium transition-colors disabled:opacity-40">Cancel</button>
                <button
                  onClick={exportToGoogleSheets}
                  disabled={selectedExportJobs.size === 0 || exporting}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 text-sm transition-all"
                >
                  {exporting ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" /> Creating Sheet...</>
                  ) : (
                    <><Download className="w-4 h-4" /> Open in Google Sheets ({selectedExportJobs.size} PO{selectedExportJobs.size !== 1 ? 's' : ''})</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- ADMIN: EMPLOYEES ---
const AdminEmployees = ({ addToast, confirm }: { addToast: any, confirm: any }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [editingUser, setEditingUser] = useState<Partial<User>>({});
  const [showModal, setShowModal] = useState(false);

  useEffect(() => DB.subscribeUsers(setUsers), []);

  const handleDelete = (id: string) => confirm({
    title: 'Remove User',
    message: 'Are you sure you want to remove this user? This cannot be undone.',
    onConfirm: () => DB.deleteUser(id)
  });

  const handleSave = () => {
    if (!editingUser.name || !editingUser.username || !editingUser.pin) return addToast('error', 'Missing fields');
    const newUser: User = {
      id: editingUser.id || Date.now().toString(),
      name: editingUser.name,
      username: editingUser.username,
      pin: editingUser.pin,
      role: editingUser.role || 'employee',
      isActive: editingUser.isActive !== false,
      hourlyRate: editingUser.hourlyRate || undefined,
    };
    DB.saveUser(newUser);
    setShowModal(false);
    setEditingUser({});
    addToast('success', 'User Saved');
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-white">Team</h2>
        <button onClick={() => { setEditingUser({}); setShowModal(true); }} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl flex items-center gap-2"><Plus className="w-4 h-4" /> Add Member</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {users.map(u => (
          <div key={u.id} className="bg-zinc-900/50 border border-white/5 p-4 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400"><UserIcon className="w-5 h-5" /></div>
              <div><p className="font-bold text-white">{u.name}</p><p className="text-xs text-zinc-500">@{u.username} · {u.role}{u.hourlyRate ? <span className="text-emerald-400 ml-2">${u.hourlyRate.toFixed(2)}/hr</span> : ''}</p></div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleDelete(u.id)} className="p-2 hover:bg-red-500/10 rounded-lg text-zinc-500 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
              <button onClick={() => { setEditingUser(u); setShowModal(true); }} className="p-2 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors"><Edit2 className="w-4 h-4" /></button>
            </div>
          </div>
        ))}
      </div>
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-zinc-800/50">
              <h3 className="font-bold text-white">User Details</h3>
              <button onClick={() => setShowModal(false)}><X className="w-5 h-5 text-zinc-500 hover:text-white" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div><label className="text-xs text-zinc-500 ml-1">Full Name</label><input className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white mt-1" value={editingUser.name || ''} onChange={e => setEditingUser({ ...editingUser, name: e.target.value })} /></div>
              <div><label className="text-xs text-zinc-500 ml-1">Username</label><input className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white mt-1" value={editingUser.username || ''} onChange={e => setEditingUser({ ...editingUser, username: e.target.value })} /></div>
              <div><label className="text-xs text-zinc-500 ml-1">PIN</label><input type="text" className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white mt-1" value={editingUser.pin || ''} onChange={e => setEditingUser({ ...editingUser, pin: e.target.value })} /></div>
              <div><label className="text-xs text-zinc-500 ml-1">Role</label><select className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white mt-1" value={editingUser.role || 'employee'} onChange={e => setEditingUser({ ...editingUser, role: e.target.value as any })}><option value="employee">Employee</option><option value="admin">Admin</option></select></div>
              <div><label className="text-xs text-zinc-500 ml-1">Hourly Rate <span className="text-zinc-600">(admin only — workers can't see this)</span></label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-2.5 text-zinc-500">$</span>
                  <input type="number" step="0.01" className="w-full bg-black/40 border border-white/10 rounded-lg p-2 pl-7 text-white font-mono" value={editingUser.hourlyRate || ''} onChange={e => setEditingUser({ ...editingUser, hourlyRate: Number(e.target.value) || 0 })} placeholder="0.00" />
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-white/10 bg-zinc-800/50 flex justify-end gap-2">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-zinc-400 hover:text-white">Cancel</button>
              <button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-xl font-medium">Save</button>
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

const PushRegistrationPanel = ({ addToast }: { addToast: any }) => {
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  // Diagnose environment on mount so we can show what's supported
  const hasSW     = 'serviceWorker' in navigator;
  const hasPush   = 'PushManager' in window;
  const hasNotif  = typeof Notification !== 'undefined';
  const isPWA     = window.matchMedia('(display-mode: standalone)').matches || !!(navigator as any).standalone;
  const notifPerm = hasNotif ? Notification.permission : 'unavailable';

  const register = async () => {
    setStatus('working');
    setMsg('Checking environment...');
    try {
      if (!hasSW)    throw new Error('Service Worker not available — try Chrome or install to home screen');
      if (!hasPush)  throw new Error('Web Push not available — install the app to your home screen first');
      if (!hasNotif) throw new Error('Notifications not available on this browser');

      setMsg('Requesting permission...');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error(`Permission ${perm} — go to iPhone Settings and allow notifications for this app`);

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

      setMsg('Saving to server...');
      const res = await fetch('/api/send-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          title: '✅ Notifications Active',
          body: 'This device will now receive alerts even when your phone is locked.',
          tag: 'test-push',
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}: ${await res.text()}`);

      setStatus('done');
      setMsg('Done! A test notification was just sent to your phone.');
      addToast('success', '✅ Push notifications activated!');
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
        <div className={`text-sm px-3 py-2 rounded-lg ${status === 'error' ? 'bg-red-500/10 text-red-300' : status === 'done' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-blue-500/10 text-blue-300'}`}>
          {status === 'working' && <span className="animate-pulse">⏳ </span>}{msg}
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
              <p className="text-5xl font-black text-emerald-400">${priceAtMarkup.toFixed(0)}</p>
              <p className="text-lg font-bold text-zinc-300">${pricePerPart.toFixed(2)} per part</p>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center pt-4 border-t border-white/10">
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

// ═══════════════════════════════════════════════════
// REPORTS VIEW — Worker productivity, job metrics
// ═══════════════════════════════════════════════════
const ReportsView = () => {
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [period, setPeriod] = useState<'week' | 'month' | 'all'>('week');
  const [settings, setSettings] = useState<SystemSettings>(DB.getSettings());

  useEffect(() => {
    const u1 = DB.subscribeLogs(setLogs);
    const u2 = DB.subscribeUsers(setUsers);
    const u3 = DB.subscribeJobs(setJobs);
    const u4 = DB.subscribeSettings(setSettings);
    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  const now = Date.now();
  const weekAgo = now - 7 * 86400000;
  const monthAgo = now - 30 * 86400000;
  const cutoff = period === 'week' ? weekAgo : period === 'month' ? monthAgo : 0;

  const completedLogs = logs.filter(l => l.endTime && l.endTime > cutoff);
  const activeWorkers = users.filter(u => u.isActive !== false && u.role !== 'admin');
  const shopRate = settings.shopRate || 0;
  const ohRate = (settings.monthlyOverhead || 0) / (settings.monthlyWorkHours || 160);

  // Per-worker stats
  const workerStats = activeWorkers.map(w => {
    const wLogs = completedLogs.filter(l => l.userId === w.id);
    const totalMins = wLogs.reduce((a, l) => a + (l.durationMinutes || 0), 0);
    const totalHrs = totalMins / 60;
    const jobIds = [...new Set(wLogs.map(l => l.jobId))];
    const operations = [...new Set(wLogs.map(l => l.operation))];
    const rate = (w as any).hourlyRate || shopRate;
    const cost = totalHrs * (rate + ohRate);
    const avgMinsPerSession = wLogs.length > 0 ? totalMins / wLogs.length : 0;
    return { user: w, logs: wLogs, totalMins, totalHrs, jobCount: jobIds.length, operations, cost, sessions: wLogs.length, avgMinsPerSession };
  }).sort((a, b) => b.totalHrs - a.totalHrs);

  // Totals
  const totalHrs = workerStats.reduce((a, w) => a + w.totalHrs, 0);
  const totalCost = workerStats.reduce((a, w) => a + w.cost, 0);
  const totalSessions = workerStats.reduce((a, w) => a + w.sessions, 0);
  const completedJobs = jobs.filter(j => j.status === 'completed' && j.completedAt && j.completedAt > cutoff);
  const totalRevenue = completedJobs.reduce((a, j) => a + (j.quoteAmount || 0), 0);

  // Operations breakdown
  const opMap = new Map<string, number>();
  completedLogs.forEach(l => opMap.set(l.operation, (opMap.get(l.operation) || 0) + (l.durationMinutes || 0)));
  const opBreakdown = Array.from(opMap.entries()).sort((a, b) => b[1] - a[1]);
  const maxOpMins = opBreakdown.length > 0 ? opBreakdown[0][1] : 1;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Reports</h2>
          <p className="text-sm text-zinc-500">Worker productivity and shop performance.</p>
        </div>
        <div className="flex gap-1 bg-zinc-900/50 p-1 rounded-lg border border-white/5">
          {(['week', 'month', 'all'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${period === p ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'}`}>
              {p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'All Time'}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3 text-center">
          <p className="text-[10px] text-zinc-500 uppercase font-bold">Total Hours</p>
          <p className="text-2xl font-black text-white">{totalHrs.toFixed(1)}</p>
        </div>
        <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3 text-center">
          <p className="text-[10px] text-zinc-500 uppercase font-bold">Sessions</p>
          <p className="text-2xl font-black text-white">{totalSessions}</p>
        </div>
        <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3 text-center">
          <p className="text-[10px] text-zinc-500 uppercase font-bold">Jobs Done</p>
          <p className="text-2xl font-black text-emerald-400">{completedJobs.length}</p>
        </div>
        <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3 text-center">
          <p className="text-[10px] text-zinc-500 uppercase font-bold">Revenue</p>
          <p className="text-2xl font-black text-green-400">${totalRevenue.toLocaleString()}</p>
        </div>
        <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3 text-center">
          <p className="text-[10px] text-zinc-500 uppercase font-bold">Labor Cost</p>
          <p className="text-2xl font-black text-orange-400">${totalCost.toFixed(0)}</p>
        </div>
      </div>

      {/* Worker Productivity Table */}
      <div>
        <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Worker Productivity</h3>
        <div className="bg-zinc-900/50 border border-white/5 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950/50 text-zinc-500 text-xs uppercase">
              <tr>
                <th className="text-left p-3">Worker</th>
                <th className="text-right p-3">Hours</th>
                <th className="text-right p-3">Sessions</th>
                <th className="text-right p-3">Jobs</th>
                <th className="text-right p-3">Avg/Session</th>
                <th className="text-right p-3">Cost</th>
                <th className="p-3">Top Operations</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {workerStats.map(w => (
                <tr key={w.user.id} className="hover:bg-white/5">
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 text-xs font-bold">{w.user.name.charAt(0)}</div>
                      <div>
                        <p className="text-white font-bold text-sm">{w.user.name}</p>
                        <p className="text-zinc-600 text-[10px]">{w.user.role}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-right font-mono text-white font-bold">{w.totalHrs.toFixed(1)}h</td>
                  <td className="p-3 text-right font-mono text-zinc-300">{w.sessions}</td>
                  <td className="p-3 text-right font-mono text-zinc-300">{w.jobCount}</td>
                  <td className="p-3 text-right font-mono text-zinc-400">{w.avgMinsPerSession.toFixed(0)}m</td>
                  <td className="p-3 text-right font-mono text-orange-400">${w.cost.toFixed(0)}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {w.operations.slice(0, 3).map(op => (
                        <span key={op} className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">{op}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {workerStats.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-zinc-500">No activity in this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Worker Hours Chart */}
        <div>
          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Worker Hours</h3>
          <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-4 space-y-2">
            {workerStats.filter(w => w.totalHrs > 0).map(w => {
              const maxHrs = workerStats[0]?.totalHrs || 1;
              return (
                <div key={w.user.id} className="flex items-center gap-2">
                  <span className="text-xs text-zinc-300 font-bold w-20 truncate">{w.user.name}</span>
                  <div className="flex-1 h-6 bg-zinc-800 rounded overflow-hidden relative">
                    <div className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded transition-all" style={{ width: `${(w.totalHrs / maxHrs) * 100}%` }} />
                    <span className="absolute right-2 top-0.5 text-[10px] font-mono text-white/80">{w.totalHrs.toFixed(1)}h</span>
                  </div>
                </div>
              );
            })}
            {workerStats.filter(w => w.totalHrs > 0).length === 0 && <p className="text-zinc-500 text-sm text-center py-4">No hours logged.</p>}
          </div>
        </div>

        {/* Operations Breakdown */}
        <div>
          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Operations Breakdown</h3>
          <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-4 space-y-2">
            {opBreakdown.map(([op, mins]) => (
              <div key={op} className="flex items-center gap-2">
                <span className="text-xs text-zinc-300 font-bold w-24 truncate">{op}</span>
                <div className="flex-1 h-6 bg-zinc-800 rounded overflow-hidden relative">
                  <div className="h-full bg-gradient-to-r from-purple-600 to-purple-400 rounded transition-all" style={{ width: `${(mins / maxOpMins) * 100}%` }} />
                  <span className="absolute right-2 top-0.5 text-[10px] font-mono text-white/80">{(mins / 60).toFixed(1)}h</span>
                </div>
              </div>
            ))}
            {opBreakdown.length === 0 && <p className="text-zinc-500 text-sm text-center py-4">No data.</p>}
          </div>
        </div>
      </div>

      {/* Customer Breakdown */}
      {(() => {
        const custMap = new Map<string, { jobs: number; hours: number; revenue: number; cost: number }>();
        completedLogs.forEach(l => {
          const j = jobs.find(jj => jj.id === l.jobId);
          const cust = j?.customer || 'Unknown';
          const cur = custMap.get(cust) || { jobs: 0, hours: 0, revenue: 0, cost: 0 };
          cur.hours += (l.durationMinutes || 0) / 60;
          custMap.set(cust, cur);
        });
        jobs.filter(j => j.status === 'completed' && j.completedAt && j.completedAt > cutoff).forEach(j => {
          const cust = j.customer || 'Unknown';
          const cur = custMap.get(cust) || { jobs: 0, hours: 0, revenue: 0, cost: 0 };
          cur.jobs++;
          cur.revenue += j.quoteAmount || 0;
          custMap.set(cust, cur);
        });
        const custBreakdown = Array.from(custMap.entries()).sort((a, b) => b[1].hours - a[1].hours);
        if (custBreakdown.length === 0) return null;
        return (
          <div>
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Customer Breakdown</h3>
            <div className="bg-zinc-900/50 border border-white/5 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-zinc-950/50 text-zinc-500 text-xs uppercase">
                  <tr>
                    <th className="text-left p-3">Customer</th>
                    <th className="text-right p-3">Jobs</th>
                    <th className="text-right p-3">Hours</th>
                    <th className="text-right p-3">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {custBreakdown.map(([cust, data]) => (
                    <tr key={cust} className="hover:bg-white/5">
                      <td className="p-3 text-white font-bold">{cust}</td>
                      <td className="p-3 text-right font-mono text-zinc-300">{data.jobs}</td>
                      <td className="p-3 text-right font-mono text-zinc-300">{data.hours.toFixed(1)}h</td>
                      <td className="p-3 text-right font-mono text-emerald-400">{data.revenue > 0 ? `$${data.revenue.toLocaleString()}` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* Job Profitability */}
      {(() => {
        const profitableJobs = jobs.filter(j => j.status === 'completed' && j.completedAt && j.completedAt > cutoff && j.quoteAmount).map(j => {
          const jLogs = completedLogs.filter(l => l.jobId === j.id);
          const hrs = jLogs.reduce((a, l) => a + (l.durationMinutes || 0), 0) / 60;
          const cost = hrs * ((shopRate || 0) + ohRate);
          const profit = (j.quoteAmount || 0) - cost;
          const margin = j.quoteAmount ? (profit / j.quoteAmount) * 100 : 0;
          return { ...j, hrs, cost, profit, margin };
        }).sort((a, b) => b.profit - a.profit);
        if (profitableJobs.length === 0) return null;
        return (
          <div>
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Job Profitability</h3>
            <div className="bg-zinc-900/50 border border-white/5 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-zinc-950/50 text-zinc-500 text-xs uppercase">
                  <tr>
                    <th className="text-left p-3">PO / Part</th>
                    <th className="text-right p-3">Quote</th>
                    <th className="text-right p-3">Cost</th>
                    <th className="text-right p-3">Profit</th>
                    <th className="text-right p-3">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {profitableJobs.map(j => (
                    <tr key={j.id} className="hover:bg-white/5">
                      <td className="p-3"><span className="text-white font-bold">{j.poNumber}</span> <span className="text-zinc-500 text-xs">{j.partNumber}</span></td>
                      <td className="p-3 text-right font-mono text-zinc-300">${(j.quoteAmount || 0).toLocaleString()}</td>
                      <td className="p-3 text-right font-mono text-orange-400">${j.cost.toFixed(0)}</td>
                      <td className={`p-3 text-right font-mono font-bold ${j.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{j.profit >= 0 ? '+' : ''}${j.profit.toFixed(0)}</td>
                      <td className={`p-3 text-right font-mono text-xs ${j.margin >= 20 ? 'text-emerald-400' : j.margin >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>{j.margin.toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

const SettingsView = ({ addToast }: { addToast: any }) => {
  const [settings, setSettings] = useState<SystemSettings>(DB.getSettings());
  const [newOp, setNewOp] = useState('');
  const [newClient, setNewClient] = useState('');
  const [settingsTab, setSettingsTab] = useState<'general' | 'financial' | 'tools'>('general');
  const [opsOpen, setOpsOpen] = useState(false);
  const [clientsOpen, setClientsOpen] = useState(false);

  useEffect(() => {
    const unsub = DB.subscribeSettings((s) => setSettings(s));
    return unsub;
  }, []);

  const handleSave = () => { DB.saveSettings(settings); addToast('success', 'Settings Updated'); };
  const handleAddOp = () => { if (!newOp.trim()) return; const ops = settings.customOperations || []; if (ops.includes(newOp.trim())) return; setSettings({ ...settings, customOperations: [...ops, newOp.trim()] }); setNewOp(''); };
  const handleDeleteOp = (op: string) => { setSettings({ ...settings, customOperations: (settings.customOperations || []).filter(o => o !== op) }); };
  const handleAddClient = () => { if (!newClient.trim()) return; const clients = settings.clients || []; if (clients.map(c => c.toLowerCase()).includes(newClient.trim().toLowerCase())) return; const updated = { ...settings, clients: [...clients, newClient.trim()] }; setSettings(updated); DB.saveSettings(updated); setNewClient(''); };
  const handleDeleteClient = (client: string) => { const updated = { ...settings, clients: (settings.clients || []).filter(c => c !== client) }; setSettings(updated); DB.saveSettings(updated); };

  const ohRate = (settings.monthlyOverhead || 0) / (settings.monthlyWorkHours || 160);
  const trueCost = (settings.shopRate || 0) + ohRate;

  const stab = (id: 'general' | 'financial' | 'tools', label: string) => (
    <button key={id} onClick={() => setSettingsTab(id)}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${settingsTab === id ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}>
      {label}
    </button>
  );

  return (
    <div className="max-w-2xl">
      {/* Header + Tabs */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">Settings</h2>
        <button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg font-bold text-sm flex items-center gap-2"><Save className="w-4 h-4" /> Save</button>
      </div>
      <div className="flex gap-1 mb-6 bg-zinc-900/50 p-1 rounded-lg border border-white/5">
        {stab('general', 'General')}
        {stab('financial', 'Financial')}
        {stab('tools', 'Tools')}
      </div>

      {/* ── TAB: General ── */}
      {settingsTab === 'general' && (
        <div className="space-y-6">
          {/* Automation */}
          <div>
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Automation</p>
            <div className="bg-zinc-900/50 border border-white/5 rounded-xl">
              <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                <div>
                  <p className="text-sm text-white">Auto Clock-Out</p>
                  <p className="text-xs text-zinc-500">Stop forgotten timers automatically</p>
                </div>
                <div className="flex items-center gap-2">
                  <input type="time" value={settings.autoClockOutTime} onChange={e => setSettings({ ...settings, autoClockOutTime: e.target.value })} className="bg-zinc-950 border border-white/10 rounded px-2 py-1 text-white text-xs w-24" />
                  <input type="checkbox" checked={settings.autoClockOutEnabled} onChange={e => setSettings({ ...settings, autoClockOutEnabled: e.target.checked })} className="w-4 h-4 rounded bg-zinc-800 text-blue-600" />
                </div>
              </div>
              <div className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white">Lunch Pause</p>
                    <p className="text-xs text-zinc-500">Auto-pause timers during break</p>
                  </div>
                  <input type="checkbox" checked={settings.autoLunchPauseEnabled || false} onChange={e => setSettings({ ...settings, autoLunchPauseEnabled: e.target.checked })} className="w-4 h-4 rounded bg-zinc-800 text-blue-600" />
                </div>
                {settings.autoLunchPauseEnabled && (
                  <div className="flex gap-3 mt-2">
                    <div><label className="text-[10px] text-zinc-600">Start</label><input type="time" value={settings.lunchStart || '12:00'} onChange={e => setSettings({ ...settings, lunchStart: e.target.value })} className="block bg-zinc-950 border border-white/10 rounded px-2 py-1 text-white text-xs w-24" /></div>
                    <div><label className="text-[10px] text-zinc-600">End</label><input type="time" value={settings.lunchEnd || '12:30'} onChange={e => setSettings({ ...settings, lunchEnd: e.target.value })} className="block bg-zinc-950 border border-white/10 rounded px-2 py-1 text-white text-xs w-24" /></div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Operations — collapsible */}
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
                        {op}<button onClick={() => handleDeleteOp(op)} className="text-zinc-600 hover:text-red-400"><X className="w-2.5 h-2.5" /></button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Clients — collapsible, alphabetical */}
          <div>
            <div className="bg-zinc-900/50 border border-white/5 rounded-xl">
              <button onClick={() => setClientsOpen(!clientsOpen)} className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 rounded-xl transition-colors">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white">Clients</p>
                  <span className="text-[10px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded-full font-bold">{(settings.clients || []).length}</span>
                </div>
                <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${clientsOpen ? 'rotate-180' : ''}`} />
              </button>
              {clientsOpen && (
                <div className="px-4 pb-4 space-y-3 border-t border-white/5">
                  <div className="flex gap-2 mt-3">
                    <input value={newClient} onChange={e => setNewClient(e.target.value)} placeholder="Add client..." className="flex-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white" onKeyDown={e => e.key === 'Enter' && handleAddClient()} />
                    <button onClick={handleAddClient} className="bg-purple-600 hover:bg-purple-500 px-3 rounded-lg text-white text-xs font-bold">Add</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(settings.clients || []).sort((a, b) => a.localeCompare(b)).map(client => (
                      <span key={client} className="bg-zinc-800 border border-white/10 px-2 py-0.5 rounded flex items-center gap-1 text-xs text-zinc-300">
                        {client}<button onClick={() => handleDeleteClient(client)} className="text-zinc-600 hover:text-red-400"><X className="w-2.5 h-2.5" /></button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Financial ── */}
      {settingsTab === 'financial' && (
        <div className="space-y-6">
          <div>
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Shop Rates</p>
            <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-4 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] text-zinc-500 block mb-1">Rate ($/hr)</label>
                  <div className="relative"><span className="absolute left-2 top-1.5 text-zinc-600 text-xs">$</span><input type="number" step="0.01" className="w-full bg-zinc-950 border border-white/10 rounded py-1.5 pl-5 pr-2 text-white text-sm font-mono" value={settings.shopRate || ''} onChange={e => setSettings({ ...settings, shopRate: Number(e.target.value) || 0 })} placeholder="21" /></div>
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 block mb-1">Overhead / mo</label>
                  <div className="relative"><span className="absolute left-2 top-1.5 text-zinc-600 text-xs">$</span><input type="number" step="0.01" className="w-full bg-zinc-950 border border-white/10 rounded py-1.5 pl-5 pr-2 text-white text-sm font-mono" value={settings.monthlyOverhead || ''} onChange={e => setSettings({ ...settings, monthlyOverhead: Number(e.target.value) || 0 })} placeholder="5000" /></div>
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 block mb-1">Hours / mo</label>
                  <input type="number" className="w-full bg-zinc-950 border border-white/10 rounded py-1.5 px-2 text-white text-sm font-mono" value={settings.monthlyWorkHours || ''} onChange={e => setSettings({ ...settings, monthlyWorkHours: Number(e.target.value) || 0 })} placeholder="160" />
                </div>
              </div>
              {trueCost > 0 && (
                <div className="bg-zinc-800/50 rounded-lg p-3 grid grid-cols-3 text-center text-xs">
                  <div><span className="text-zinc-500">Rate</span><p className="text-white font-bold">${(settings.shopRate || 0).toFixed(2)}/hr</p></div>
                  <div><span className="text-zinc-500">Overhead</span><p className="text-yellow-400 font-bold">${ohRate.toFixed(2)}/hr</p></div>
                  <div><span className="text-zinc-500">True Cost</span><p className="text-emerald-400 font-bold">${trueCost.toFixed(2)}/hr</p></div>
                </div>
              )}
              <p className="text-[10px] text-zinc-600">Set individual worker rates in Team. This rate is used as fallback.</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Quote Calculator</p>
            <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-4">
              <QuoteCalculator settings={settings} />
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Tools ── */}
      {settingsTab === 'tools' && (
        <div className="space-y-6">
          <div>
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Notifications</p>
            <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-4">
              <PushRegistrationPanel addToast={addToast} />
            </div>
          </div>
        </div>
      )}

      {/* Bottom save */}
      <div className="flex justify-end mt-8 pb-8">
        <button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg font-bold text-sm flex items-center gap-2"><Save className="w-4 h-4" /> Save</button>
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
    <div className="space-y-4 animate-fade-in max-w-2xl mx-auto">

      {/* Streak + Goal */}
      <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            {streak > 0 && (
              <div className="flex items-center gap-1.5 bg-orange-500/10 border border-orange-500/20 px-3 py-1.5 rounded-xl">
                <span className="text-lg">🔥</span>
                <span className="text-orange-400 font-black text-sm">{streak}-day streak</span>
              </div>
            )}
          </div>
          {goalPct >= 100 && <span className="text-emerald-400 font-black text-xs bg-emerald-500/10 px-2 py-1 rounded-lg">🏆 GOAL HIT!</span>}
        </div>
        <div>
          <div className="flex justify-between items-baseline mb-1.5">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Weekly Goal</span>
            <span className="text-xs font-mono text-zinc-400">
              <span className={`font-bold ${goalPct >= 100 ? 'text-emerald-400' : 'text-white'}`}>{weekHrsCalc.toFixed(1)}h</span>
              <span className="text-zinc-600"> / {WEEKLY_GOAL_HRS}h</span>
            </span>
          </div>
          <div className="w-full h-3 bg-zinc-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full bg-gradient-to-r transition-all duration-1000 ${goalPct >= 100 ? 'from-emerald-500 to-emerald-400' : 'from-blue-500 to-blue-400'}`} style={{ width: `${goalPct}%` }} />
          </div>
          {goalPct < 100 && <p className="text-xs text-zinc-500 mt-1">{(WEEKLY_GOAL_HRS - weekHrsCalc).toFixed(1)}h remaining — keep grinding! 💪</p>}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4 text-center">
          <p className="text-2xl font-bold text-blue-400">{fmtHours(weekHrsCalc)}</p>
          <p className="text-xs text-zinc-500 mt-1">This Week</p>
        </div>
        <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4 text-center">
          <p className="text-2xl font-bold text-purple-400">{weekOps}</p>
          <p className="text-xs text-zinc-500 mt-1">Operations</p>
        </div>
        <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4 text-center">
          <p className="text-2xl font-bold text-emerald-400">
            {todayMins >= 60 ? `${Math.floor(todayMins/60)}h ${todayMins%60}m` : `${todayMins}m`}
          </p>
          <p className="text-xs text-zinc-500 mt-1">Today</p>
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
  const [showPOScanner, setShowPOScanner] = useState(false);
  // For notifications  track all jobs and active logs globally
  const [allJobs, setAllJobs] = useState<Job[]>([]);
  const [allActiveLogs, setAllActiveLogs] = useState<TimeLog[]>([]);
  const { permission, requestPermission, alerts, markRead, markAllRead, clearAll } = useNotifications(allJobs, allActiveLogs, user);

  // Subscribe globally for notification checks
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
        if (pendingJob && user.role === 'admin') {
          setView('admin-scan'); // Admin goes to Work Station where scan handler lives
        } else {
          setView(user.role === 'admin' ? 'admin-dashboard' : 'employee-scan');
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

 const navItems = [
    { id: 'admin-dashboard', l: 'Overview', i: LayoutDashboard },
    { id: 'admin-jobs', l: 'Jobs', i: Briefcase },
    { id: 'admin-logs', l: 'Logs', i: Calendar },
    { id: 'admin-team', l: 'Team', i: Users },
    { id: 'admin-reports', l: 'Reports', i: Calculator },
    { id: 'admin-settings', l: 'Settings', i: Settings },
    { id: 'admin-live', l: 'Live Floor', i: Activity },
    { id: 'admin-samples', l: 'Samples', i: Camera },
    { id: 'admin-scan', l: 'Work Station', i: ScanLine },
  ];

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
      <PrintStyles />
      <PWAInstallBanner />
      <PrintableJobSheet job={printable} onClose={() => setPrintable(null)} onPrinted={(id) => { const list = JSON.parse(localStorage.getItem('printed_jobs') || '[]'); if (!list.includes(id)) { list.push(id); localStorage.setItem('printed_jobs', JSON.stringify(list)); } window.dispatchEvent(new Event('printed-update')); }} />
      <ConfirmationModal isOpen={!!confirm} {...(confirm || {})} onCancel={() => setConfirm(null)} />

      {user.role === 'admin' && (
        <>
          {/* Mobile overlay backdrop */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 bg-black/60 z-30 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          {/* Sidebar  hidden on mobile unless open, always visible on md+ */}
          <aside className={`
            fixed h-full z-40 flex flex-col w-64
            border-r border-white/5 bg-zinc-950
            transition-transform duration-300 ease-in-out
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            md:translate-x-0
          `}>
            <div className="p-6 font-bold text-white flex gap-2 items-center justify-between">
              <div className="flex items-center gap-2"><Sparkles className="text-blue-500" /> SC DEBURRING</div>
              <NotificationBell permission={permission} requestPermission={requestPermission} userId={user?.id} alerts={alerts} markRead={markRead} markAllRead={markAllRead} clearAll={clearAll} align="left" />
            </div>
            <nav className="px-4 space-y-1">
              {navItems.map(x => (
                <button key={x.id} onClick={() => { setView(x.id as any); setSidebarOpen(false); }}
                  className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-bold transition-all ${view === x.id ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-white hover:bg-zinc-900/50'}`}>
                  <x.i className="w-4 h-4" /> {x.l}
                </button>
              ))}
            </nav>
            <button onClick={() => setUser(null)} className="mt-auto m-6 flex items-center gap-3 text-zinc-500 hover:text-white text-sm font-bold transition-colors">
              <LogOut className="w-4 h-4" /> Sign Out
            </button>
          </aside>
        </>
      )}

      {/* Main content */}
      <main className={`flex-1 overflow-auto ${user.role === 'admin' ? 'md:ml-64' : ''}`}>

        {/* Mobile top bar  only shows for admin on small screens */}
        {user.role === 'admin' && (
          <div className="md:hidden flex items-center justify-between px-4 py-3 bg-zinc-950 border-b border-white/5 sticky top-0 z-20">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-xl bg-zinc-800 border border-white/5 text-zinc-400 hover:text-white"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 font-bold text-white text-sm">
              <Sparkles className="w-4 h-4 text-blue-500" /> SC DEBURRING
            </div>
            <NotificationBell permission={permission} requestPermission={requestPermission} userId={user?.id} alerts={alerts} markRead={markRead} markAllRead={markAllRead} clearAll={clearAll} />
          </div>
        )}

        <div className="p-4 md:p-8">
          {view === 'admin-dashboard' && <AdminDashboard confirmAction={setConfirm} setView={setView} user={user} addToast={addToast} />}
          {view === 'admin-jobs' && <JobsView user={user} addToast={addToast} setPrintable={setPrintable} confirm={setConfirm} onOpenPOScanner={() => setShowPOScanner(true)} />}
          {view === 'admin-logs' && <LogsView addToast={addToast} confirm={setConfirm} />}
          {view === 'admin-team' && <AdminEmployees addToast={addToast} confirm={setConfirm} />}
          {view === 'admin-settings' && <SettingsView addToast={addToast} />}
          {view === 'admin-reports' && <ReportsView />}
          {view === 'admin-live' && <LiveFloorMonitor user={user} onBack={() => setView('admin-dashboard')} addToast={addToast} />}
          {view === 'admin-samples' && <SamplesView addToast={addToast} currentUser={user ? { id: user.id, name: user.name } : null} />}
          {view === 'admin-scan' && <EmployeeDashboard user={user} addToast={addToast} onLogout={() => setView('admin-dashboard')} notifBell={<NotificationBell permission={permission} requestPermission={requestPermission} userId={user?.id} alerts={alerts} markRead={markRead} markAllRead={markAllRead} clearAll={clearAll} />} />}
          {view === 'employee-scan' && <EmployeeDashboard user={user} addToast={addToast} onLogout={() => setUser(null)} notifBell={<NotificationBell permission={permission} requestPermission={requestPermission} userId={user?.id} alerts={alerts} markRead={markRead} markAllRead={markAllRead} clearAll={clearAll} />} />}
        </div>
      </main>

     {showPOScanner && (
  <POScanner
    geminiApiKey={import.meta.env.VITE_GEMINI_API_KEY || ''}
    onJobCreate={handlePOJobCreate}
    onClose={() => setShowPOScanner(false)}
  />
)}
            <div className="fixed bottom-6 right-6 z-50 pointer-events-none">
        <div className="pointer-events-auto flex flex-col items-end gap-2">
          {toasts.map(t => <Toast key={t.id} toast={t} onClose={removeToast} />)}
        </div>
      </div>
    </div>
  );
}





