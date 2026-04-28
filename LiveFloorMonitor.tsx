import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Activity,
  Award,
  Briefcase,
  ChevronLeft,
  Clock,
  Cloud,
  CloudRain,
  CloudSnow,
  Maximize2,
  Minimize2,
  Moon,
  Pause,
  Play,
  Power,
  Radio,
  Smartphone,
  StopCircle,
  Sun,
  TrendingUp,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';

import { Job, TimeLog, SystemSettings, TvSlide, JobStage, ShopGoal, GoalMetric, GoalPeriod } from './types';
import * as DB from './services/mockDb';
import { ShopFlowMap } from './components/ShopFlowMap';
import { countByCustomer } from './utils/customers';
import { useConfirm } from './components/useConfirm';

// ── STAGE HELPERS (mirror App.tsx to keep this file standalone-friendly) ──
const DEFAULT_STAGES: JobStage[] = [
  { id: 'pending', label: 'Pending', color: '#71717a', order: 0 },
  { id: 'in-progress', label: 'In Progress', color: '#3b82f6', order: 1 },
  { id: 'qc', label: 'QC', color: '#f59e0b', order: 2 },
  { id: 'packing', label: 'Packing', color: '#8b5cf6', order: 3 },
  { id: 'shipped', label: 'Shipped', color: '#06b6d4', order: 4 },
  { id: 'completed', label: 'Completed', color: '#10b981', order: 5, isComplete: true },
];
function getStages(settings: SystemSettings): JobStage[] {
  return (settings.jobStages && settings.jobStages.length > 0)
    ? [...settings.jobStages].sort((a, b) => a.order - b.order)
    : DEFAULT_STAGES;
}
function getJobStage(job: Job, stages: JobStage[]): JobStage {
  if (job.currentStage) {
    const found = stages.find(s => s.id === job.currentStage);
    if (found) return found;
  }
  const legacyMap: Record<string, string> = { 'pending': 'pending', 'in-progress': 'in-progress', 'completed': 'completed', 'hold': 'pending' };
  const mapped = legacyMap[job.status] || 'pending';
  return stages.find(s => s.id === mapped) || stages[0];
}

// ── DUE DATE HELPERS ── robust against MM/DD/YYYY, YYYY-MM-DD, blanks, or garbage strings
function parseDueDate(raw?: string | null): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  // MM/DD/YYYY
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const d = new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]), 12, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }
  // YYYY-MM-DD (ISO)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }
  // Fallback native parse
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Shared auto-scroll hook for TV lists. Seamless infinite loop.
 *  - Scrolls down continuously via setInterval at a constant pace.
 *  - Assumes the caller duplicates the content (clone + aria-hidden) so scrolling
 *    past the first copy reveals the duplicate seamlessly — then we reset to 0 invisibly.
 *  - Pauses for 8s when the user manually scrolls/wheels/touches.
 */
function useTvAutoScroll(ref: React.RefObject<HTMLDivElement>, speed: 'slow' | 'normal' | 'fast' | 'off', _itemCount: number) {
  const pauseUntilRef = useRef<number>(0);
  const lastScrollRef = useRef<number>(0);
  // px per 50ms tick — normal ≈ 30px/sec, enough to notice but not dizzying
  const pxPerTick = speed === 'off' ? 0 : speed === 'slow' ? 0.75 : speed === 'fast' ? 3 : 1.5;

  useEffect(() => {
    if (pxPerTick === 0) return;
    const tick = () => {
      const el = ref.current;
      if (!el) return;
      if (Date.now() < pauseUntilRef.current) return;
      // Seamless loop: the caller duplicates the content. When we pass the first
      // copy, instantly rewind by its height — user sees no jump because the
      // content at (height/2) looks identical to the content at 0.
      const halfway = el.scrollHeight / 2;
      if (halfway > el.clientHeight) {
        if (el.scrollTop >= halfway) {
          el.scrollTop = el.scrollTop - halfway;
        } else {
          el.scrollTop += pxPerTick;
        }
      } else if (el.scrollHeight > el.clientHeight + 2) {
        // Fallback: content only fits once, use classic bottom-to-top with pause.
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) {
          pauseUntilRef.current = Date.now() + 1500;
          el.scrollTop = 0;
        } else {
          el.scrollTop += pxPerTick;
        }
      }
      lastScrollRef.current = el.scrollTop;
    };
    const id = window.setInterval(tick, 50);
    return () => window.clearInterval(id);
  }, [pxPerTick, ref]);

  return {
    onScroll: () => {
      const el = ref.current;
      if (!el) return;
      const delta = Math.abs(el.scrollTop - lastScrollRef.current);
      if (delta > 3) pauseUntilRef.current = Date.now() + 8000;
      lastScrollRef.current = el.scrollTop;
    },
    onWheel: () => { pauseUntilRef.current = Date.now() + 8000; },
    onTouchStart: () => { pauseUntilRef.current = Date.now() + 8000; },
  };
}

/** Returns { dueText, daysLeft, overdue, urgency } — dueText is pretty for TV, like "Apr 25" */
function formatDueForTv(raw?: string | null): { dueText: string; daysLeft: number | null; overdue: boolean; urgency: 'late' | 'today' | 'soon' | 'normal' | 'none' } {
  const due = parseDueDate(raw);
  if (!due) return { dueText: '', daysLeft: null, overdue: false, urgency: 'none' };
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const startDue = new Date(due); startDue.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((startDue.getTime() - startToday.getTime()) / 86400000);
  const overdue = daysLeft < 0;
  const urgency: 'late' | 'today' | 'soon' | 'normal' = overdue ? 'late' : daysLeft === 0 ? 'today' : daysLeft <= 3 ? 'soon' : 'normal';
  // Friendly label: "Apr 25", include year only if far future/past
  const sameYear = due.getFullYear() === startToday.getFullYear();
  const dueText = due.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  return { dueText, daysLeft, overdue, urgency };
}

// ── LIVE CLOCK — big, always ticking ──
const LiveClock = ({ size = 'xl' }: { size?: 'md' | 'lg' | 'xl' | 'huge' }) => {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(i); }, []);
  const sz = { md: 'text-2xl', lg: 'text-4xl', xl: 'text-6xl', huge: 'text-8xl' }[size];
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  const [clockTime, ampm] = time.split(' ');
  return (
    <div className="flex items-baseline gap-3">
      <span className={`${sz} font-black text-white tabular tracking-tight leading-none`} style={{ textShadow: '0 0 40px rgba(59,130,246,0.3)' }}>{clockTime}</span>
      {ampm && <span className="text-white/40 font-bold text-2xl">{ampm}</span>}
    </div>
  );
};

// ── LIVE TICKER (pause-aware) ───────────────────────────────────
const LiveTicker = ({ log, size = 'lg' }: { log: TimeLog; size?: 'sm' | 'lg' | 'xl' }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!log.startTime) return;
    const tick = () => setElapsed(Math.floor(DB.getWorkingElapsedMs(log) / 1000));
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [log.startTime, log.pausedAt, log.totalPausedMs]);

  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');

  const sizeClasses = { sm: 'text-2xl', lg: 'text-5xl', xl: 'text-7xl' };

  return (
    <div className={`font-mono font-black tabular-nums tracking-wider ${sizeClasses[size]}`}>
      <span className="text-white">{pad(h)}</span>
      <span className="text-white/30 animate-pulse">:</span>
      <span className="text-white">{pad(m)}</span>
      <span className="text-white/30 animate-pulse">:</span>
      <span className="text-white">{pad(s)}</span>
    </div>
  );
};

// ── ELAPSED BAR (pause-aware) ───────────────────────────────────
const ElapsedBar = ({ log }: { log: TimeLog }) => {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    const tick = () => {
      const mins = DB.getWorkingElapsedMs(log) / 60000;
      setPct(Math.min(100, (mins / 240) * 100));
    };
    tick();
    const i = setInterval(tick, 5000);
    return () => clearInterval(i);
  }, [log.startTime, log.pausedAt, log.totalPausedMs]);

  const hrs = DB.getWorkingElapsedMs(log) / 3600000;

  return (
    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-1000 ease-linear"
        style={{
          width: `${pct}%`,
          background: hrs < 2
            ? 'linear-gradient(90deg, #3b82f6, #60a5fa)'
            : hrs < 3.5
            ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
            : 'linear-gradient(90deg, #ef4444, #f87171)',
        }}
      />
    </div>
  );
};

// ── WORKER CARD ─────────────────────────────────────────────────
const WorkerCard: React.FC<{
  log: TimeLog;
  job: Job | null;
  compact: boolean;
  onForceStop?: (logId: string) => void;
  onPause?: (logId: string) => void;
  onResume?: (logId: string) => void;
  isAdmin: boolean;
  tvSettings?: SystemSettings;
}> = ({ log, job, compact, onForceStop, onPause, onResume, isAdmin, tvSettings }) => {
  const initials = log.userName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const isPaused = !!log.pausedAt;
  const minsElapsed = Math.floor(DB.getWorkingElapsedMs(log) / 60000);
  const isLong = minsElapsed > 240;

  if (compact) {
    return (
      <div className={`flex items-center justify-between p-4 border-b border-white/5 ${isPaused ? 'bg-yellow-500/5' : isLong ? 'bg-red-500/5' : ''}`}>
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-black text-white/80">{initials}</div>
            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-zinc-950 ${isPaused ? 'bg-yellow-500' : 'bg-emerald-500 animate-pulse'}`} />
          </div>
          <div className="min-w-0">
            <p className="text-white font-bold text-sm truncate">{log.userName}</p>
            <div className="flex items-center gap-1.5">
              <p className="text-white/40 text-xs truncate">{log.operation} {job ? `— PO ${job.poNumber} · Qty ${job.quantity}${job.customer ? ` · ${job.customer}` : ''}` : ''}</p>
              {isPaused && <span className="text-[9px] font-black text-yellow-400 bg-yellow-500/10 px-1 py-0.5 rounded">PAUSED</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LiveTicker log={log} size="sm" />
          {isAdmin && (
            <div className="flex gap-1">
              {isPaused && onResume ? (
                <button onClick={() => onResume(log.id)} className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-colors"><Play className="w-3.5 h-3.5" /></button>
              ) : onPause ? (
                <button onClick={() => onPause(log.id)} className="p-1.5 rounded-lg bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500 hover:text-white transition-colors"><Pause className="w-3.5 h-3.5" /></button>
              ) : null}
              {onForceStop && <button onClick={() => onForceStop(log.id)} className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-colors"><Power className="w-3.5 h-3.5" /></button>}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border overflow-hidden transition-all ${isPaused ? 'border-yellow-500/30 bg-yellow-500/5' : isLong ? 'border-red-500/30 bg-red-500/5 shadow-lg shadow-red-500/5' : 'border-white/5 bg-white/[0.02]'}`}>
      <div className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-base font-black text-white/80">{initials}</div>
              <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-zinc-950 ${isPaused ? 'bg-yellow-500' : 'bg-emerald-500 animate-pulse'}`} />
            </div>
            <div>
              <p className="text-white font-bold text-lg">{log.userName}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md">{log.operation}</span>
                {isPaused && <span className="text-[10px] font-black text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded">PAUSED</span>}
                {isLong && !isPaused && <span className="text-[10px] font-black text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded animate-pulse">{Math.floor(minsElapsed / 60)}h+</span>}
              </div>
            </div>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              {isPaused && onResume ? (
                <button aria-label={`Resume ${log.userName || 'timer'}`} onClick={() => onResume(log.id)} className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all min-w-[36px] min-h-[36px]" title="Resume"><Play className="w-4 h-4" aria-hidden="true" /></button>
              ) : onPause ? (
                <button aria-label={`Pause ${log.userName || 'timer'}`} onClick={() => onPause(log.id)} className="p-2 rounded-xl bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500 hover:text-white transition-all min-w-[36px] min-h-[36px]" title="Pause"><Pause className="w-4 h-4" aria-hidden="true" /></button>
              ) : null}
              {onForceStop && <button aria-label={`Force stop ${log.userName || 'timer'}`} onClick={() => onForceStop(log.id)} className="p-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all min-w-[36px] min-h-[36px]" title="Force Stop"><StopCircle className="w-4 h-4" aria-hidden="true" /></button>}
            </div>
          )}
        </div>
        <div className="mb-4"><LiveTicker log={log} size="lg" /></div>
        {(tvSettings?.tvShowElapsedBar !== false) && <ElapsedBar log={log} />}
        {job && (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div><p className="text-[10px] text-white/30 uppercase font-bold tracking-widest">PO</p><p className="text-white font-bold text-sm mt-0.5 truncate">{job.poNumber}</p></div>
            <div><p className="text-[10px] text-white/30 uppercase font-bold tracking-widest">Part</p><p className="text-white/70 text-sm mt-0.5 truncate">{job.partNumber}</p></div>
            <div><p className="text-[10px] text-white/30 uppercase font-bold tracking-widest">Qty</p><p className="text-white/70 text-sm mt-0.5">{job.quantity}</p></div>
            {(tvSettings?.tvShowCustomer !== false) && job.customer && (
              <div className="col-span-3"><p className="text-[10px] text-white/30 uppercase font-bold tracking-widest">Customer</p><p className="text-purple-400 text-sm font-bold mt-0.5 truncate">{job.customer}</p></div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── useAutoLunch HOOK ───────────────────────────────────────────
export function useAutoLunch(addToast: (type: 'success' | 'error' | 'info', message: string) => void) {
  const pausedTodayRef = useRef<string | null>(null);
  const resumedTodayRef = useRef<string | null>(null);
  const stoppedTodayRef = useRef<string | null>(null);

  useEffect(() => {
    const check = () => {
      const settings = DB.getSettings();
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      if (settings.autoClockOutEnabled && settings.autoClockOutTime) {
        if (hhmm >= settings.autoClockOutTime && stoppedTodayRef.current !== today) {
          stoppedTodayRef.current = today;
          DB.stopAllActive().then((count) => {
            if (count > 0) addToast('info', `⏹ Auto clock-out: stopped ${count} timer${count > 1 ? 's' : ''}`);
          });
        }
      }

      if (!settings.autoLunchPauseEnabled) return;
      const lunchStart = settings.lunchStart || '12:00';
      const lunchEnd = settings.lunchEnd || '12:30';
      const inLunch = hhmm >= lunchStart && hhmm < lunchEnd;

      if (inLunch && pausedTodayRef.current !== today) {
        pausedTodayRef.current = today;
        DB.pauseAllActive('auto-lunch').then((count) => {
          if (count > 0) addToast('info', `Auto-paused ${count} timer${count > 1 ? 's' : ''} for lunch`);
        });
      }

      if (!inLunch && hhmm >= lunchEnd && pausedTodayRef.current === today && resumedTodayRef.current !== today) {
        resumedTodayRef.current = today;
        DB.resumeAllPaused().then((count) => {
          if (count > 0) addToast('success', `Auto-resumed ${count} timer${count > 1 ? 's' : ''} after lunch`);
        });
      }
    };
    check();
    const i = setInterval(check, 30000);
    return () => clearInterval(i);
  }, [addToast]);
}

// ── BIG CLOCK ───────────────────────────────────────────────────
// ── Compact inline TV-mode weather pill ──
// ── WEATHER HELPERS ──
// Single shared weather fetcher so we don't ping the API from each component.
type WeatherCurrent = { temp: number; code: number };
type WeatherDay = { dateMs: number; dayLabel: string; tMin: number; tMax: number; code: number };
type WeatherData = {
  current: WeatherCurrent | null;
  forecast: WeatherDay[];
  /** Fetch state — 'idle' means not attempted yet. 'unavailable' means
   *  all location sources failed (no geolocation + IP lookup blocked) and
   *  the user should set a manual location in Settings. */
  status?: 'idle' | 'loading' | 'ready' | 'unavailable';
  /** Which location source produced the current reading. */
  source?: 'manual' | 'geolocation' | 'ip';
};

function weatherIcon(code: number, className = 'w-6 h-6') {
  if (code <= 3) return <Sun className={`${className} text-yellow-400`} aria-hidden="true" />;
  if (code <= 48) return <Cloud className={`${className} text-zinc-400`} aria-hidden="true" />;
  if (code <= 67) return <CloudRain className={`${className} text-blue-400`} aria-hidden="true" />;
  if (code <= 77) return <CloudSnow className={`${className} text-cyan-300`} aria-hidden="true" />;
  return <CloudRain className={`${className} text-blue-500`} aria-hidden="true" />;
}
function weatherLabel(code: number) {
  if (code <= 1) return 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 48) return 'Overcast';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  return 'Storm';
}

// Module-level cache + subscribers: one geolocation fetch feeds every useWeather() caller.
// Before cache: each slide mount re-fetched → TV mode Weather slide stuck loading.
//
// Location source priority (important for smart TVs / kiosks):
//   1) Manual lat/lon from settings (admin entered in Settings → TV Display)
//   2) Browser geolocation (requires HTTPS + permission; often denied on TVs)
//   3) IP-based geolocation (no permission needed — works everywhere)
//   4) Hard failure → status='unavailable' so UI can explain what to do
let weatherCache: WeatherData = { current: null, forecast: [], status: 'idle' };
let weatherFetchPromise: Promise<void> | null = null;
let weatherLastFetch = 0;
const weatherSubs = new Set<(d: WeatherData) => void>();

async function resolveCoords(override?: { lat?: number; lon?: number }): Promise<{ lat: number; lon: number; source: WeatherData['source'] } | null> {
  // 1. Admin-supplied coords win every time.
  if (override?.lat != null && override?.lon != null) {
    return { lat: override.lat, lon: override.lon, source: 'manual' };
  }
  // 2. Browser geolocation — only if HTTPS + API available. 6s timeout so we
  //    don't hang the TV slide when the device silently ignores the prompt.
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    try {
      const pos = await new Promise<GeolocationPosition>((ok, fail) => {
        navigator.geolocation.getCurrentPosition(ok, fail, { timeout: 6000, maximumAge: 60 * 60 * 1000 });
      });
      return { lat: pos.coords.latitude, lon: pos.coords.longitude, source: 'geolocation' };
    } catch { /* fall through to IP */ }
  }
  // 3. IP lookup — no permission, no prompt, works on TVs.
  try {
    const res = await fetch('https://ipapi.co/json/');
    if (res.ok) {
      const d = await res.json() as { latitude?: number; longitude?: number };
      if (typeof d.latitude === 'number' && typeof d.longitude === 'number') {
        return { lat: d.latitude, lon: d.longitude, source: 'ip' };
      }
    }
  } catch { /* network blocked, nothing we can do */ }
  return null;
}

function fetchWeather(override?: { lat?: number; lon?: number }): Promise<void> {
  if (weatherFetchPromise) return weatherFetchPromise;
  weatherFetchPromise = (async () => {
    const coords = await resolveCoords(override);
    if (!coords) {
      weatherCache = { ...weatherCache, status: 'unavailable' };
      weatherSubs.forEach(s => s(weatherCache));
      return;
    }
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}` +
        `&current=temperature_2m,weather_code` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
        `&temperature_unit=fahrenheit&timezone=auto&forecast_days=5`
      );
      const d = await res.json() as {
        current?: { temperature_2m: number; weather_code: number };
        daily?: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
      };
      const current = d.current ? { temp: Math.round(d.current.temperature_2m), code: d.current.weather_code } : null;
      const forecast: WeatherDay[] = [];
      if (d.daily?.time) {
        for (let i = 0; i < d.daily.time.length; i++) {
          const day = new Date(d.daily.time[i]);
          forecast.push({
            dateMs: day.getTime(),
            dayLabel: i === 0 ? 'Today' : day.toLocaleDateString('en-US', { weekday: 'short' }),
            tMin: Math.round(d.daily.temperature_2m_min[i]),
            tMax: Math.round(d.daily.temperature_2m_max[i]),
            code: d.daily.weather_code[i],
          });
        }
      }
      weatherCache = { current, forecast, status: 'ready', source: coords.source };
      weatherLastFetch = Date.now();
      weatherSubs.forEach(s => s(weatherCache));
    } catch {
      weatherCache = { ...weatherCache, status: 'unavailable' };
      weatherSubs.forEach(s => s(weatherCache));
    }
  })().finally(() => { weatherFetchPromise = null; });
  return weatherFetchPromise;
}

function useWeather(override?: { lat?: number; lon?: number }): WeatherData {
  const [data, setData] = useState<WeatherData>(weatherCache);
  // Stringify override so effect deps are stable — re-fetch when admin changes
  // the manual coords in Settings.
  const overrideKey = override?.lat != null && override?.lon != null ? `${override.lat},${override.lon}` : '';
  useEffect(() => {
    const sub = (d: WeatherData) => setData(d);
    weatherSubs.add(sub);
    // Fetch if cache is empty or stale (> 10 min old)
    if (!weatherCache.current || Date.now() - weatherLastFetch > 10 * 60 * 1000) {
      fetchWeather(override);
    }
    return () => { weatherSubs.delete(sub); };
  }, [overrideKey]);
  return data;
}

/** Force an immediate re-fetch (e.g. after admin saves a new manual location). */
export function refreshWeather(override?: { lat?: number; lon?: number }) {
  weatherLastFetch = 0;
  weatherCache = { current: null, forecast: [], status: 'loading' };
  weatherSubs.forEach(s => s(weatherCache));
  fetchWeather(override);
}

const TVWeather: React.FC<{ lat?: number; lon?: number }> = ({ lat, lon }) => {
  const { current } = useWeather({ lat, lon });
  if (!current) return null;
  return (
    <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl px-4 py-2.5 backdrop-blur-xl" title="Outside">
      {weatherIcon(current.code, 'w-7 h-7')}
      <div className="text-3xl font-black text-white tabular leading-none">{current.temp}°</div>
      <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">F</span>
    </div>
  );
};

// ── MAIN COMPONENT ──────────────────────────────────────────────
interface LiveFloorMonitorProps {
  user?: { id: string; name: string; role: string } | null;
  onBack?: () => void;
  addToast?: (type: 'success' | 'error' | 'info', message: string) => void;
  standalone?: boolean; // true when accessed via ?tv=TOKEN URL (no login, no back button)
}

// ═══════════════════════════════════════════════════════════════════
// ── FULL-SCREEN TV SLIDES ─ each one takes the whole TV viewport
// ═══════════════════════════════════════════════════════════════════

type LeaderRow = { userId: string; name: string; hours: number; jobs: number; sessions: number; topOp: string };

// Leaderboard — ranked workers, big podium + medal bars
const TvLeaderboardSlide: React.FC<{
  data: LeaderRow[];
  period: 'today' | 'week' | 'month';
  count: number;
  metric: 'hours' | 'jobs' | 'mixed';
  speed?: 'slow' | 'normal' | 'fast' | 'off';
}> = ({ data, period, count, metric, speed }) => {
  const scrollSpeed: 'slow' | 'normal' | 'fast' | 'off' = speed ?? 'normal';
  const rows = data.slice(0, count);
  const maxH = Math.max(1, ...rows.map(r => r.hours));
  const maxJ = Math.max(1, ...rows.map(r => r.jobs));
  const periodLabel = period === 'today' ? 'Today' : period === 'month' ? 'This Month' : 'This Week';
  const totalHrs = rows.reduce((a, r) => a + r.hours, 0);
  const totalJobs = rows.reduce((a, r) => a + r.jobs, 0);

  // Same auto-scroll engine the Workers + Jobs columns use. The list sits in
  // a flex-1 scroll container; long lineups (10+ workers on a 720p TV) cycle
  // top→bottom→top so every name gets a turn on screen.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const handlers = useTvAutoScroll(scrollRef, scrollSpeed, rows.length);

  return (
    <div className="h-full flex flex-col items-center p-[clamp(1rem,2.5vw,3rem)] overflow-hidden">
      <div className="w-full max-w-5xl flex flex-col h-full min-h-0">
        {/* Header — pinned, doesn't scroll */}
        <div className="shrink-0 flex items-center justify-between mb-[clamp(0.75rem,1.5vw,1.5rem)] gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="font-black text-amber-400/80 uppercase tracking-[0.3em] flex items-center gap-2" style={{ fontSize: 'clamp(0.625rem, 0.85vw, 0.75rem)' }}>
              <Trophy className="w-4 h-4" aria-hidden="true" /> Shop Leaderboard
            </p>
            <h2 className="font-black text-white tracking-tight mt-2 truncate" style={{ fontSize: 'clamp(1.5rem, 4vw, 3.25rem)' }}>{periodLabel}'s Top Workers</h2>
          </div>
          <div className="text-right hidden sm:block">
            <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Total Logged</p>
            <p className="text-3xl font-black text-white tabular">{totalHrs.toFixed(1)}h</p>
            <p className="text-[11px] text-white/50">{totalJobs} jobs</p>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <div className="w-24 h-24 rounded-3xl bg-zinc-800/60 flex items-center justify-center mb-4">
              <Award className="w-12 h-12 text-zinc-600" aria-hidden="true" />
            </div>
            <p className="text-zinc-400 text-2xl font-bold">No data yet</p>
            <p className="text-zinc-600 text-sm mt-1">{periodLabel.toLowerCase()}'s leaderboard will fill as workers clock time.</p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 relative">
            <div
              ref={scrollRef}
              {...handlers}
              className="absolute inset-0 overflow-y-auto pr-1"
              style={{ scrollBehavior: 'auto' }}
            >
              {/* Duplicate content for seamless top→bottom→top loop. The 2nd
                  copy is aria-hidden so screen readers don't double-announce. */}
              {[0, 1].map(copy => (
                <div key={copy} className="space-y-3 pb-3" aria-hidden={copy === 1 ? 'true' : undefined}>
                  {rows.map((r, idx) => {
                    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;
                    const medalColor = idx === 0 ? 'from-amber-400 to-yellow-600' : idx === 1 ? 'from-zinc-300 to-zinc-500' : idx === 2 ? 'from-orange-500 to-amber-700' : 'from-zinc-600 to-zinc-800';
                    const pctH = (r.hours / maxH) * 100;
                    const pctJ = (r.jobs / maxJ) * 100;
                    return (
                      <div key={`${copy}-${r.userId}`} className={`rounded-2xl border ${idx === 0 ? 'bg-gradient-to-r from-amber-500/10 to-transparent border-amber-500/30' : 'bg-zinc-900/50 border-white/5'}`} style={{ padding: 'clamp(0.75rem, 1.4vw, 1.25rem)' }}>
                        <div className="flex items-center" style={{ gap: 'clamp(0.625rem, 1.2vw, 1rem)' }}>
                          {/* Rank */}
                          <div className={`shrink-0 rounded-xl flex items-center justify-center font-black text-white shadow-xl bg-gradient-to-br ${medalColor}`} style={{ width: 'clamp(2.5rem, 3.5vw, 3.5rem)', height: 'clamp(2.5rem, 3.5vw, 3.5rem)', fontSize: 'clamp(1rem, 1.5vw, 1.5rem)' }}>
                            {medal || `#${idx + 1}`}
                          </div>
                          {/* Avatar */}
                          <div className={`shrink-0 rounded-2xl flex items-center justify-center font-black text-white shadow-xl ${idx === 0 ? 'bg-gradient-to-br from-amber-500 to-orange-600' : 'bg-gradient-to-br from-blue-500 to-indigo-600'}`} style={{ width: 'clamp(2.75rem, 4vw, 4rem)', height: 'clamp(2.75rem, 4vw, 4rem)', fontSize: 'clamp(1rem, 1.5vw, 1.5rem)' }}>
                            {r.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-black text-white tracking-tight truncate" style={{ fontSize: 'clamp(1.1rem, 2.2vw, 1.875rem)' }}>{r.name}</p>
                            {r.topOp && <p className="text-[11px] text-white/40 uppercase tracking-widest font-bold mt-0.5 truncate">most: {r.topOp}</p>}
                          </div>
                          {/* Stats */}
                          <div className="shrink-0 text-right flex items-center" style={{ gap: 'clamp(0.75rem, 2vw, 1.5rem)' }}>
                            {(metric === 'hours' || metric === 'mixed') && (
                              <div>
                                <div className="font-black text-white tabular tracking-tight" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.5rem)' }}>{r.hours.toFixed(1)}<span className="text-white/50" style={{ fontSize: 'clamp(0.75rem, 1.4vw, 1.25rem)' }}>h</span></div>
                                <div className="h-1 bg-white/10 rounded-full mt-1 overflow-hidden" style={{ width: 'clamp(3rem, 8vw, 6rem)' }}><div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500" style={{ width: `${pctH}%` }} /></div>
                              </div>
                            )}
                            {(metric === 'jobs' || metric === 'mixed') && (
                              <div>
                                <div className="font-black text-emerald-400 tabular tracking-tight" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.5rem)' }}>{r.jobs}<span className="text-emerald-400/60 ml-1" style={{ fontSize: 'clamp(0.75rem, 1.4vw, 1.25rem)' }}>jobs</span></div>
                                <div className="h-1 bg-white/10 rounded-full mt-1 overflow-hidden" style={{ width: 'clamp(3rem, 8vw, 6rem)' }}><div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500" style={{ width: `${pctJ}%` }} /></div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {/* Top + bottom fade gradients hint there's more content above/below */}
            <div aria-hidden="true" className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-zinc-950 to-transparent pointer-events-none" />
            <div aria-hidden="true" className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-zinc-950 to-transparent pointer-events-none" />
          </div>
        )}
      </div>
    </div>
  );
};

// Weather forecast — current + next 5 days
const TvWeatherSlide: React.FC<{ lat?: number; lon?: number }> = ({ lat, lon }) => {
  const { current, forecast, status } = useWeather({ lat, lon });
  const today = forecast[0];
  return (
    <div className="h-full flex flex-col items-center justify-center p-[clamp(1rem,2.5vw,3rem)] overflow-hidden">
      <div className="w-full max-w-5xl">
        <p className="font-black text-blue-400/80 uppercase tracking-[0.3em] text-center" style={{ fontSize: 'clamp(0.625rem, 0.85vw, 0.75rem)' }}>Outside · Live</p>
        <h2 className="font-black text-white tracking-tight text-center mt-2" style={{ fontSize: 'clamp(2rem, 5vw, 3.75rem)' }}>Weather Forecast</h2>
        {!current && !forecast.length ? (
          <div className="flex flex-col items-center justify-center text-center py-24">
            <Cloud className="w-24 h-24 text-zinc-700 mb-4" aria-hidden="true" />
            {status === 'unavailable' ? (
              <>
                <p className="text-zinc-300 text-xl font-bold">Can't detect location</p>
                <p className="text-zinc-500 text-sm mt-2 max-w-md leading-relaxed">
                  This TV doesn't have geolocation and the IP lookup was blocked. Set your city or zip under <strong className="text-zinc-400">Settings → TV Display → Weather Location</strong>.
                </p>
              </>
            ) : status === 'loading' ? (
              <>
                <p className="text-zinc-400 text-xl font-bold">Loading forecast…</p>
                <p className="text-zinc-600 text-sm mt-1">Finding your location.</p>
              </>
            ) : (
              <>
                <p className="text-zinc-400 text-xl font-bold">Grant location to see forecast</p>
                <p className="text-zinc-600 text-sm mt-1">Or set a city under Settings → TV Display.</p>
              </>
            )}
          </div>
        ) : (
          <>
            {/* CURRENT */}
            {current && (
              <div className="mt-10 bg-gradient-to-br from-blue-500/10 to-indigo-500/5 border border-blue-500/20 rounded-3xl p-8 flex items-center justify-around">
                <div className="text-center">
                  <div className="flex items-center justify-center mb-2">{weatherIcon(current.code, 'w-20 h-20')}</div>
                  <p className="text-2xl font-bold text-white/80">{weatherLabel(current.code)}</p>
                </div>
                <div className="text-center">
                  <div className="text-9xl font-black text-white tabular leading-none">{current.temp}°</div>
                  <p className="text-xl text-white/50 mt-2">Right now</p>
                </div>
                {today && (
                  <div className="text-center">
                    <p className="text-sm font-black text-white/50 uppercase tracking-widest">Today</p>
                    <p className="text-3xl font-black text-white tabular mt-1">{today.tMax}° <span className="text-xl text-blue-400">/ {today.tMin}°</span></p>
                    <p className="text-xs text-white/40 mt-1">high / low</p>
                  </div>
                )}
              </div>
            )}
            {/* 5-DAY */}
            {forecast.length > 1 && (
              <div className="mt-6 grid grid-cols-5 gap-3">
                {forecast.slice(0, 5).map((d, i) => (
                  <div key={d.dateMs} className={`rounded-2xl p-4 border text-center ${i === 0 ? 'bg-blue-500/10 border-blue-500/30' : 'bg-zinc-900/50 border-white/5'}`}>
                    <p className={`text-xs font-black uppercase tracking-widest mb-2 ${i === 0 ? 'text-blue-400' : 'text-white/40'}`}>{d.dayLabel}</p>
                    <div className="flex items-center justify-center mb-3">{weatherIcon(d.code, 'w-12 h-12')}</div>
                    <p className="text-3xl font-black text-white tabular">{d.tMax}°</p>
                    <p className="text-sm font-bold text-blue-400 tabular mt-0.5">{d.tMin}°</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// Weekly stats — bar graphs of hours/jobs by day
const TvWeeklyStatsSlide: React.FC<{ allLogs: TimeLog[]; weekStart: Date; jobs: Job[]; showRevenue?: boolean; showCustomers?: boolean }> = ({ allLogs, weekStart, jobs, showRevenue = false, showCustomers = true }) => {
  // Group by day-of-week
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const daily = dayNames.map((name, i) => {
    const start = new Date(weekStart); start.setDate(weekStart.getDate() + i); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(start.getDate() + 1);
    const logs = allLogs.filter(l => l.startTime >= start.getTime() && l.startTime < end.getTime() && l.endTime);
    const hours = logs.reduce((a, l) => a + (l.durationMinutes || 0) / 60, 0);
    const dayJobs = new Set(logs.map(l => l.jobId)).size;
    const sessions = logs.length;
    return { name, hours, jobs: dayJobs, sessions, isToday: new Date().toDateString() === start.toDateString() };
  });
  const maxH = Math.max(1, ...daily.map(d => d.hours));
  const totalH = daily.reduce((a, d) => a + d.hours, 0);
  const totalSessions = daily.reduce((a, d) => a + d.sessions, 0);
  const weekJobIds = new Set(allLogs.filter(l => l.startTime >= weekStart.getTime()).map(l => l.jobId));
  const totalJobs = weekJobIds.size;
  const uniqueWorkers = new Set(allLogs.filter(l => l.startTime >= weekStart.getTime()).map(l => l.userId)).size;
  const avgPerJob = totalJobs > 0 ? totalH / totalJobs : 0;
  // Jobs completed this week
  const completedThisWeek = jobs.filter(j => j.status === 'completed' && (j.completedAt || 0) >= weekStart.getTime());
  const completedCount = completedThisWeek.length;
  // On-time count
  const onTimeCount = completedThisWeek.filter(j => {
    const d = parseDueDate(j.dueDate);
    return d && j.completedAt && j.completedAt <= d.getTime() + 86400000;
  }).length;
  const onTimePct = completedCount > 0 ? Math.round((onTimeCount / completedCount) * 100) : 0;
  // Top customer — uses shared helper that normalizes case/whitespace
  // so "ACME " and "ACME" aggregate together.
  const customerCounts = countByCustomer(completedThisWeek);
  let topCustomer = '—'; let topCustCount = 0;
  customerCounts.forEach((c, name) => { if (c > topCustCount) { topCustCount = c; topCustomer = name; } });
  // Revenue this week
  const revenue = completedThisWeek.reduce((a, j) => a + (j.quoteAmount || 0), 0);

  return (
    <div className="h-full w-full overflow-hidden flex items-center justify-center p-[clamp(1rem,2vw,2.5rem)]">
      <div className="w-full max-w-6xl mx-auto">
        <p className="font-black text-emerald-400/80 uppercase tracking-[0.3em] text-center flex items-center justify-center gap-2" style={{ fontSize: 'clamp(0.625rem, 0.85vw, 0.75rem)' }}>
          <TrendingUp className="w-4 h-4" aria-hidden="true" /> Weekly Output
        </p>
        <h2 className="font-black text-white tracking-tight text-center mt-2" style={{ fontSize: 'clamp(2rem, 5vw, 3.75rem)' }}>This Week at a Glance</h2>

        {/* Primary metrics — hero row. Revenue card only shows if admin opts-in (money is sensitive) */}
        <div className={`mt-6 grid grid-cols-2 gap-3 ${showRevenue ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
          <div className="bg-gradient-to-br from-blue-500/15 to-blue-500/[0.02] border border-blue-500/20 rounded-2xl p-4 text-center">
            <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Hours Logged</p>
            <p className="text-4xl font-black text-white tabular mt-1.5">{totalH.toFixed(1)}<span className="text-xl text-white/50">h</span></p>
          </div>
          <div className="bg-gradient-to-br from-emerald-500/15 to-emerald-500/[0.02] border border-emerald-500/20 rounded-2xl p-4 text-center">
            <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Jobs Completed</p>
            <p className="text-4xl font-black text-white tabular mt-1.5">{completedCount}</p>
            <p className="text-[9px] text-white/40 mt-0.5">{totalJobs} touched</p>
          </div>
          <div className="bg-gradient-to-br from-cyan-500/15 to-cyan-500/[0.02] border border-cyan-500/20 rounded-2xl p-4 text-center">
            <p className="text-[10px] font-black text-cyan-400 uppercase tracking-widest">On-Time</p>
            <p className="text-4xl font-black text-white tabular mt-1.5">{onTimePct}<span className="text-xl text-white/50">%</span></p>
            <p className="text-[9px] text-white/40 mt-0.5">{onTimeCount} of {completedCount}</p>
          </div>
          {showRevenue && (
            <div className="bg-gradient-to-br from-amber-500/15 to-amber-500/[0.02] border border-amber-500/20 rounded-2xl p-4 text-center">
              <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Revenue</p>
              <p className="text-4xl font-black text-white tabular mt-1.5">${Math.round(revenue).toLocaleString()}</p>
            </div>
          )}
        </div>

        {/* Secondary metrics — smaller row */}
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3 text-center">
            <p className="text-[9px] font-black text-white/40 uppercase tracking-widest">Active Workers</p>
            <p className="text-2xl font-black text-white tabular mt-1">{uniqueWorkers}</p>
          </div>
          <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3 text-center">
            <p className="text-[9px] font-black text-white/40 uppercase tracking-widest">Sessions</p>
            <p className="text-2xl font-black text-white tabular mt-1">{totalSessions}</p>
          </div>
          <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3 text-center">
            <p className="text-[9px] font-black text-white/40 uppercase tracking-widest">Avg / Job</p>
            <p className="text-2xl font-black text-white tabular mt-1">{avgPerJob.toFixed(1)}<span className="text-base text-white/50">h</span></p>
          </div>
          <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3 text-center min-w-0">
            <p className="text-[9px] font-black text-white/40 uppercase tracking-widest">{showCustomers ? 'Top Customer' : 'Top Contributor'}</p>
            <p className="text-base font-black text-white truncate mt-1" title={showCustomers ? topCustomer : 'hidden'}>{showCustomers ? topCustomer : '—'}</p>
            <p className="text-[9px] text-white/40">{topCustCount} {topCustCount === 1 ? 'job' : 'jobs'}</p>
          </div>
        </div>

        {/* Bar chart */}
        <div className="mt-5 bg-zinc-900/50 border border-white/5 rounded-3xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Hours by Day</p>
            <p className="text-[10px] text-white/30">Peak: {Math.max(...daily.map(d => d.hours)).toFixed(1)}h · Avg: {(totalH / 7).toFixed(1)}h/day</p>
          </div>
          <div className="flex items-end justify-around gap-3 h-44">
            {daily.map((d) => {
              const pct = (d.hours / maxH) * 100;
              return (
                <div key={d.name} className="flex flex-col items-center gap-1.5 flex-1 h-full">
                  <div className="text-[11px] font-black text-white tabular">{d.hours > 0 ? d.hours.toFixed(1) + 'h' : ''}</div>
                  <div className="w-full flex-1 flex items-end min-h-0">
                    <div
                      className={`w-full rounded-t-xl transition-all ${d.isToday ? 'bg-gradient-to-t from-blue-500 to-indigo-400 shadow-lg shadow-blue-500/40' : 'bg-gradient-to-t from-zinc-700 to-zinc-600'}`}
                      style={{ height: d.hours > 0 ? `${Math.max(4, pct)}%` : '2%' }}
                    />
                  </div>
                  <div className={`text-[10px] font-black uppercase tracking-widest ${d.isToday ? 'text-blue-400' : 'text-white/40'}`}>{d.name}</div>
                  {d.sessions > 0 && <div className="text-[9px] text-white/30 tabular">{d.sessions}×</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

// Full-screen Flow Map slide — live visual of jobs across every stage.
const TvFlowMapSlide: React.FC<{ jobs: Job[]; stages: JobStage[]; activeLogs: TimeLog[] }> = ({ jobs, stages, activeLogs }) => {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center overflow-hidden p-[clamp(1rem,2.5vw,3rem)]">
      <div className="w-full max-w-7xl mx-auto">
        <p className="font-black text-indigo-400/80 uppercase tracking-[0.3em] text-center flex items-center justify-center gap-2" style={{ fontSize: 'clamp(0.625rem, 0.85vw, 0.75rem)' }}>
          <Activity className="w-4 h-4" aria-hidden="true" /> Shop Flow
        </p>
        <h2 className="font-black text-white tracking-tight text-center mt-2" style={{ fontSize: 'clamp(2rem, 5vw, 3.75rem)' }}>
          Where Every Job Is Right Now
        </h2>
        <div className="mt-[clamp(1rem,2.5vw,2.5rem)] bg-gradient-to-br from-zinc-900/40 to-transparent border border-white/5 rounded-3xl p-[clamp(0.75rem,1.5vw,1.5rem)]">
          <ShopFlowMap jobs={jobs} stages={stages} activeLogs={activeLogs} />
        </div>
      </div>
    </div>
  );
};

// Safety slide — full-screen, bold, attention-grabbing
const TvSafetySlide: React.FC<{ title?: string; body?: string; color?: string; icon?: string; cycleInfo?: { current: number; total: number } }> = ({ title, body, color, icon, cycleInfo }) => {
  const palette: Record<string, { from: string; border: string; text: string }> = {
    red: { from: 'from-red-500/20', border: 'border-red-500/40', text: 'text-red-400' },
    yellow: { from: 'from-yellow-500/20', border: 'border-yellow-500/40', text: 'text-yellow-400' },
    orange: { from: 'from-orange-500/20', border: 'border-orange-500/40', text: 'text-orange-400' },
    blue: { from: 'from-blue-500/20', border: 'border-blue-500/40', text: 'text-blue-400' },
    green: { from: 'from-emerald-500/20', border: 'border-emerald-500/40', text: 'text-emerald-400' },
    white: { from: 'from-white/15', border: 'border-white/40', text: 'text-white' },
  };
  const p = palette[color || 'yellow'] || palette.yellow;
  return (
    <div className="h-full flex items-center justify-center p-[clamp(1rem,3vw,4rem)] overflow-hidden">
      <div className={`w-full max-w-5xl bg-gradient-to-br ${p.from} to-transparent border-2 ${p.border} rounded-[clamp(1.5rem,3vw,3rem)] text-center relative overflow-hidden`} style={{ padding: 'clamp(1.5rem,4vw,5rem)' }}>
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
        <div className="relative">
          <p className={`font-black uppercase tracking-[0.4em] ${p.text} mb-[clamp(0.75rem,1.5vw,1.5rem)] flex items-center justify-center gap-3`} style={{ fontSize: 'clamp(0.625rem, 0.85vw, 0.75rem)' }}>
            <span>⚠ Safety Reminder</span>
            {cycleInfo && <span className="text-white/40">· {cycleInfo.current} of {cycleInfo.total}</span>}
          </p>
          <div className="mb-[clamp(0.75rem,1.5vw,1.5rem)]" style={{ fontSize: 'clamp(3rem, 8vw, 7rem)' }}>{icon || '⚠️'}</div>
          <h2 className="font-black text-white tracking-tight leading-tight" style={{ fontSize: 'clamp(2rem, 5.5vw, 4.5rem)' }}>{title || 'Think Safety First'}</h2>
          {body && <p className="text-white/70 mt-[clamp(0.75rem,1.5vw,1.5rem)] leading-relaxed max-w-3xl mx-auto" style={{ fontSize: 'clamp(0.95rem, 1.6vw, 1.5rem)' }}>{body}</p>}
        </div>
      </div>
    </div>
  );
};

// Message slide — announcement
const TvMessageSlide: React.FC<{ title?: string; body?: string; color?: string; cycleInfo?: { current: number; total: number } }> = ({ title, body, color, cycleInfo }) => {
  const palette: Record<string, string> = {
    blue: 'from-blue-500/20 border-blue-500/40 text-blue-400',
    yellow: 'from-yellow-500/20 border-yellow-500/40 text-yellow-400',
    red: 'from-red-500/20 border-red-500/40 text-red-400',
    green: 'from-emerald-500/20 border-emerald-500/40 text-emerald-400',
    white: 'from-white/15 border-white/40 text-white',
    orange: 'from-orange-500/20 border-orange-500/40 text-orange-400',
  };
  const cls = palette[color || 'blue'] || palette.blue;
  return (
    <div className="h-full flex items-center justify-center p-[clamp(1rem,3vw,4rem)] overflow-hidden">
      <div className={`w-full max-w-5xl bg-gradient-to-br ${cls.split(' ')[0]} to-transparent border-2 ${cls.split(' ')[1]} rounded-[clamp(1.5rem,3vw,3rem)] text-center`} style={{ padding: 'clamp(2rem,5vw,6rem)' }}>
        <p className={`font-black uppercase tracking-[0.4em] ${cls.split(' ')[2]} mb-[clamp(0.75rem,1.5vw,1.5rem)] flex items-center justify-center gap-3`} style={{ fontSize: 'clamp(0.625rem, 0.85vw, 0.75rem)' }}>
          <span>Announcement</span>
          {cycleInfo && <span className="text-white/40">· {cycleInfo.current} of {cycleInfo.total}</span>}
        </p>
        <h2 className="font-black text-white tracking-tight leading-tight" style={{ fontSize: 'clamp(2.5rem, 7vw, 5.5rem)' }}>{title || 'Message'}</h2>
        {body && <p className="text-white/70 mt-[clamp(1rem,2vw,2rem)] leading-relaxed max-w-3xl mx-auto" style={{ fontSize: 'clamp(1.125rem, 2vw, 1.875rem)' }}>{body}</p>}
      </div>
    </div>
  );
};

// Goal calculation helpers come from utils/goals.ts — same logic used by Settings editor
import { computeGoalProgress, formatGoalValue, goalUnit } from './utils/goals';

// ── Full-screen GOALS slide with progress gauges
const TvGoalsSlide: React.FC<{ goals: ShopGoal[]; jobs: Job[]; logs: TimeLog[]; reworkCount: number; showRevenue?: boolean }> = ({ goals, jobs, logs, reworkCount, showRevenue = false }) => {
  // Filter out revenue goals if user has TV revenue hidden
  const visible = goals.filter(g => g.enabled && g.showOnTv !== false && (showRevenue || g.metric !== 'revenue'));
  if (visible.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-12">
        <div className="text-center max-w-xl">
          <div className="w-24 h-24 mx-auto rounded-3xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/25 flex items-center justify-center mb-4">
            <Zap className="w-12 h-12 text-emerald-400" aria-hidden="true" />
          </div>
          <p className="text-zinc-200 text-3xl font-black">No goals set yet</p>
          <p className="text-zinc-400 text-base mt-3 leading-relaxed">Set targets that matter to your shop — jobs per week, revenue, on-time delivery, and more.</p>
          <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20">
            <span className="text-blue-400 text-sm font-bold">📍 Settings → Goals → Add Goal</span>
          </div>
          <div className="mt-8 grid grid-cols-3 gap-3 text-left max-w-2xl mx-auto">
            {[
              { icn: '✅', lbl: 'Jobs / Week' },
              { icn: '💰', lbl: 'Revenue' },
              { icn: '🎯', lbl: 'On-Time %' },
              { icn: '⏱️', lbl: 'Hours Logged' },
              { icn: '🔧', lbl: 'Rework < N' },
              { icn: '👥', lbl: 'Customer Jobs' },
            ].map(s => (
              <div key={s.lbl} className="bg-zinc-900/50 border border-white/5 rounded-xl px-3 py-2.5 flex items-center gap-2">
                <span className="text-xl" aria-hidden="true">{s.icn}</span>
                <span className="text-xs font-bold text-zinc-400">{s.lbl}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const palette: Record<string, { ring: string; bar: string; text: string; bg: string }> = {
    blue:    { ring: 'ring-blue-500/30', bar: 'from-blue-500 to-indigo-500', text: 'text-blue-400', bg: 'from-blue-500/10' },
    emerald: { ring: 'ring-emerald-500/30', bar: 'from-emerald-500 to-teal-500', text: 'text-emerald-400', bg: 'from-emerald-500/10' },
    amber:   { ring: 'ring-amber-500/30', bar: 'from-amber-500 to-orange-500', text: 'text-amber-400', bg: 'from-amber-500/10' },
    purple:  { ring: 'ring-purple-500/30', bar: 'from-purple-500 to-pink-500', text: 'text-purple-400', bg: 'from-purple-500/10' },
    red:     { ring: 'ring-red-500/30', bar: 'from-red-500 to-rose-500', text: 'text-red-400', bg: 'from-red-500/10' },
    cyan:    { ring: 'ring-cyan-500/30', bar: 'from-cyan-500 to-sky-500', text: 'text-cyan-400', bg: 'from-cyan-500/10' },
  };

  return (
    <div className="h-full flex flex-col items-center justify-center overflow-y-auto" style={{ padding: 'clamp(1rem, 2.5vw, 3rem)' }}>
      <div className="w-full max-w-6xl">
        <p className="text-xs font-black text-emerald-400/80 uppercase tracking-[0.3em] text-center flex items-center justify-center gap-2">
          <Zap className="w-4 h-4" aria-hidden="true" /> Shop Goals
        </p>
        <h2 className="font-black text-white tracking-tight text-center mt-2" style={{ fontSize: 'clamp(2rem, 5vw, 4rem)' }}>How we're tracking</h2>
        <div className={`mt-8 grid gap-5 ${visible.length === 1 ? 'grid-cols-1' : visible.length <= 3 ? 'md:grid-cols-' + visible.length : 'md:grid-cols-3'}`}>
          {visible.map(g => {
            const { current, pct } = computeGoalProgress(g, jobs, logs, reworkCount);
            const p = palette[g.color || 'blue'];
            const achieved = g.lowerIsBetter ? current <= g.target : current >= g.target;
            return (
              <div key={g.id} className={`bg-gradient-to-br ${p.bg} to-transparent border-2 border-white/5 rounded-3xl p-6 relative overflow-hidden ${achieved ? 'ring-2 ' + p.ring : ''}`}>
                <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
                <div className="relative">
                  <div className="flex items-center justify-between mb-3">
                    <p className={`text-[11px] font-black uppercase tracking-widest ${p.text}`}>{g.period} · {g.metric.replace(/-/g, ' ')}</p>
                    {achieved && <span className="text-xs font-black uppercase tracking-widest text-emerald-400 flex items-center gap-1">✓ Hit</span>}
                  </div>
                  <h3 className="text-2xl font-black text-white tracking-tight leading-tight mb-3">{g.label}</h3>
                  {/* Big number */}
                  <div className="flex items-baseline gap-2 mb-4">
                    <span className="text-6xl font-black text-white tabular leading-none">{formatGoalValue(g, current)}</span>
                    <span className="text-xl text-white/40 font-bold">/ {formatGoalValue(g, g.target)} {goalUnit(g)}</span>
                  </div>
                  {/* Progress bar */}
                  <div className="h-3 rounded-full bg-white/5 overflow-hidden border border-white/5">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${p.bar} transition-all duration-1000 shadow-lg`}
                      style={{ width: `${pct}%`, boxShadow: achieved ? `0 0 12px currentColor` : undefined }}
                    />
                  </div>
                  <div className="flex justify-between mt-2 text-xs font-bold">
                    <span className={p.text}>{Math.round(pct)}% {g.lowerIsBetter ? 'under target' : 'to goal'}</span>
                    <span className="text-white/40">{g.lowerIsBetter
                      ? (current <= g.target ? 'On track' : `${current - g.target} over`)
                      : (current >= g.target ? '🎯 Achieved!' : `${formatGoalValue(g, g.target - current)} to go`)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// Workers + Jobs combined (the default TV layout)
const TvWorkersJobsSlide: React.FC<{
  sorted: TimeLog[];
  jobs: Job[];
  jobsForBelt: Job[];
  stages: JobStage[];
  runningCount: number;
  speed: 'slow' | 'normal' | 'fast' | 'off';
  showJobsBelt: boolean;
}> = ({ sorted, jobs, jobsForBelt, stages, runningCount, speed, showJobsBelt }) => (
  <div className={`h-full grid grid-cols-1 ${showJobsBelt ? 'lg:grid-cols-2' : ''} min-h-0 gap-0`}>
    <TvWorkersColumn sorted={sorted} jobs={jobs} stages={stages} runningCount={runningCount} speed={speed} />
    {showJobsBelt && <TvJobsBelt jobs={jobsForBelt} stages={stages} speed={speed} />}
  </div>
);

// ── TV Jobs Belt — scrollable, auto-advances, pauses on manual scroll ──
// ── TV Currently-Running Workers column with the same auto-scroll behavior as the jobs belt
const TvWorkersColumn: React.FC<{
  sorted: TimeLog[];
  jobs: Job[];
  stages: JobStage[];
  runningCount: number;
  speed: 'slow' | 'normal' | 'fast' | 'off';
  showCustomers?: boolean;
}> = ({ sorted, jobs, stages, runningCount, speed, showCustomers = true }) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const handlers = useTvAutoScroll(scrollRef, speed, sorted.length);
  return (
    <div className="h-full border-r border-white/5 overflow-hidden flex flex-col relative">
      <div className="px-8 py-4 border-b border-white/5 flex items-center justify-between shrink-0">
        <h2 className="text-sm font-black text-white/60 uppercase tracking-[0.3em]">● Currently Running</h2>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-white/40 font-mono">{runningCount} active</span>
          {speed !== 'off' && sorted.length > 3 && (
            <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full uppercase tracking-widest">Auto-scroll</span>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-hidden relative">
        {sorted.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <div className="w-20 h-20 rounded-3xl bg-zinc-800/60 border border-white/5 flex items-center justify-center mb-4">
              <Activity className="w-10 h-10 text-zinc-600" aria-hidden="true" />
            </div>
            <p className="text-zinc-400 text-xl font-bold">Floor is quiet</p>
            <p className="text-zinc-600 text-sm mt-1">No active timers right now.</p>
          </div>
        ) : (
          <div
            ref={scrollRef}
            {...handlers}
            className="absolute inset-0 overflow-y-auto p-8 space-y-4"
            style={{ scrollBehavior: 'auto' }}
          >
            {/* Duplicate content for seamless infinite scroll loop */}
            {[0, 1].map(copy => (
              <React.Fragment key={copy}>
                {sorted.map(log => {
                  const job = jobs.find(j => j.id === log.jobId);
                  const stage = job ? getJobStage(job, stages) : null;
                  const isPaused = !!log.pausedAt;
                  return (
                    <div key={`${copy}-${log.id}`} aria-hidden={copy === 1 ? 'true' : undefined} className={`bg-gradient-to-br rounded-3xl border transition-all ${isPaused ? 'from-yellow-500/10 to-yellow-500/0 border-yellow-500/25' : 'from-zinc-900/90 to-zinc-900/40 border-white/5'}`} style={{ padding: 'clamp(0.75rem, 1.4vw, 1.25rem)' }}>
                      <div className="flex items-center" style={{ gap: 'clamp(0.625rem, 1.2vw, 1rem)' }}>
                        <div className={`shrink-0 rounded-2xl flex items-center justify-center font-black text-white shadow-xl ${isPaused ? 'bg-gradient-to-br from-yellow-500 to-orange-500' : 'bg-gradient-to-br from-blue-500 to-indigo-600'}`} style={{ width: 'clamp(2.75rem, 4.5vw, 4rem)', height: 'clamp(2.75rem, 4.5vw, 4rem)', fontSize: 'clamp(1rem, 1.75vw, 1.5rem)' }}>
                          {log.userName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-black text-white tracking-tight truncate" style={{ fontSize: 'clamp(1.1rem, 1.9vw, 1.5rem)' }}>{log.userName}</p>
                          <p className="text-blue-300 font-semibold truncate" style={{ fontSize: 'clamp(0.75rem, 1.1vw, 0.875rem)' }}>{log.operation}</p>
                          {job && (
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <p className="text-white/40 truncate" style={{ fontSize: 'clamp(0.625rem, 0.85vw, 0.75rem)' }}>PO {job.poNumber} · {job.partNumber}</p>
                              {job.quantity && <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded tabular shrink-0">Qty {job.quantity.toLocaleString()}</span>}
                              {log.sessionQty && <span className="text-[10px] font-black text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded tabular shrink-0">Session {log.sessionQty}</span>}
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-black text-white tabular tracking-tight" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.5rem)' }}><LiveTicker log={log} size="lg" /></div>
                          {stage && <div className="mt-1 inline-block text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded border" style={{ background: `${stage.color}22`, color: stage.color, borderColor: `${stage.color}44` }}>{stage.label}</div>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        )}
        <div aria-hidden="true" className="absolute top-0 left-0 right-0 h-10 bg-gradient-to-b from-zinc-950 to-transparent pointer-events-none" />
        <div aria-hidden="true" className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-zinc-950 to-transparent pointer-events-none" />
      </div>
    </div>
  );
};

const TvJobsBelt: React.FC<{ jobs: Job[]; stages: JobStage[]; speed: 'slow' | 'normal' | 'fast' | 'off'; showCustomers?: boolean }> = ({ jobs, stages, speed, showCustomers = true }) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const handlers = useTvAutoScroll(scrollRef, speed, jobs.length);

  return (
    <div className="h-full overflow-hidden flex flex-col relative">
      <div className="px-8 py-4 border-b border-white/5 flex items-center justify-between shrink-0">
        <h2 className="text-sm font-black text-white/60 uppercase tracking-[0.3em]">All Open Jobs</h2>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-white/40 font-mono">{jobs.length} on the floor</span>
          {speed !== 'off' && <span className="text-[10px] font-black text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full uppercase tracking-widest">Auto-scroll</span>}
        </div>
      </div>
      <div className="flex-1 overflow-hidden relative">
        {jobs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-zinc-600 text-sm">No open jobs</div>
        ) : (
          <div
            ref={scrollRef}
            {...handlers}
            className="absolute inset-0 overflow-y-auto p-8 space-y-3"
            style={{ scrollBehavior: 'auto' }}
          >
            {/* Duplicate content for seamless infinite scroll loop */}
            {[0, 1].map(copy => (
              <React.Fragment key={copy}>
                {jobs.map(j => {
                  const stage = getJobStage(j, stages);
                  const stageIdx = stages.findIndex(s => s.id === stage.id);
                  const progressPct = stages.length > 1 ? Math.round((stageIdx / (stages.length - 1)) * 100) : 0;
                  const { dueText, daysLeft, overdue, urgency } = formatDueForTv(j.dueDate);
                  const dueColor = urgency === 'late' ? 'text-red-400' : urgency === 'today' ? 'text-orange-300' : urgency === 'soon' ? 'text-orange-400' : 'text-white/60';
                  const dueTint = urgency === 'late' ? 'bg-red-500/10 border-red-500/25' : urgency === 'today' ? 'bg-orange-500/10 border-orange-500/25' : urgency === 'soon' ? 'bg-orange-500/10 border-orange-500/20' : 'bg-white/[0.03] border-white/5';
                  return (
                    <div key={`${copy}-${j.id}`} aria-hidden={copy === 1 ? 'true' : undefined} className={`bg-zinc-900/50 border rounded-2xl px-5 py-4 backdrop-blur-xl ${overdue ? 'border-red-500/30' : 'border-white/5'}`}>
                      <div className="flex items-center justify-between gap-4 mb-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xl font-black text-white tabular">{j.poNumber}</span>
                            {overdue && <span className="text-[10px] font-black text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded">OVERDUE</span>}
                            {j.priority === 'urgent' && <span className="text-[10px] font-black text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded animate-pulse">URGENT</span>}
                          </div>
                          <p className="text-sm text-white/70 truncate mt-0.5">{j.partNumber}{j.customer && showCustomers ? ` · ${j.customer}` : ''}</p>
                        </div>
                        <div className="shrink-0 text-right flex flex-col items-end gap-1">
                          <div className="text-xs font-mono text-white/80 tabular">{j.quantity || '—'} pc</div>
                          {dueText ? (
                            <div className={`inline-flex items-center gap-1.5 text-[11px] font-bold tabular border rounded-md px-2 py-0.5 ${dueColor} ${dueTint}`}>
                              <Clock className="w-3 h-3" aria-hidden="true" />
                              <span>{dueText}</span>
                              {daysLeft !== null && (
                                <span className="opacity-80 font-black">
                                  {urgency === 'late' ? `· ${Math.abs(daysLeft)}d late` : urgency === 'today' ? '· today' : `· ${daysLeft}d`}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="text-[10px] text-white/30 italic">no due date</div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 relative h-2 rounded-full bg-zinc-800 overflow-hidden">
                          <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-700" style={{ width: `${progressPct}%`, background: stage.color, boxShadow: `0 0 8px ${stage.color}80` }} />
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded border shrink-0" style={{ background: `${stage.color}22`, color: stage.color, borderColor: `${stage.color}44` }}>{stage.label}</span>
                      </div>
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        )}
        <div aria-hidden="true" className="absolute top-0 left-0 right-0 h-10 bg-gradient-to-b from-zinc-950 to-transparent pointer-events-none" />
        <div aria-hidden="true" className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-zinc-950 to-transparent pointer-events-none" />
      </div>
    </div>
  );
};

export const LiveFloorMonitor: React.FC<LiveFloorMonitorProps> = ({ user, onBack, addToast: addToastProp, standalone }) => {
  const addToast = addToastProp || (() => {});
  const { confirm: confirmDialog, ConfirmHost } = useConfirm();
  const [activeLogs, setActiveLogs] = useState<TimeLog[]>([]);
  const [allLogs, setAllLogs] = useState<TimeLog[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [settings, setSettings] = useState<SystemSettings>(DB.getSettings());
  const [compact, setCompact] = useState(false);
  const [dimMode, setDimMode] = useState(false);
  // STANDALONE TV LINK (?tv=TOKEN): auto-enter slideshow on page load — the
  // whole point of that URL is "stick this on a wall TV and never touch it
  // again". Previously tvMode defaulted to false even with standalone, so
  // every refresh / browser hiccup dumped the TV back to the admin-style
  // view and someone had to walk over and re-click "TV Mode".
  const [tvMode, setTvMode] = useState(() => !!standalone);
  const prevLogIdsRef = useRef<Set<string>>(new Set());

  const isAdmin = !standalone && user?.role === 'admin';

  // TV Mode effects: fullscreen + wake lock (no screen sleep) + body class.
  // Wake Lock keeps the TV / monitor from dimming or sleeping while TV mode
  // is active. Without it, most displays go to screen saver in 10-15 min.
  // Re-requested when the tab regains focus because the lock drops on blur.
  useEffect(() => {
    if (tvMode) {
      document.body.classList.add('tv-mode');
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.body.classList.remove('tv-mode');
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
    return () => {
      document.body.classList.remove('tv-mode');
    };
  }, [tvMode]);

  // Screen Wake Lock — keeps the display awake while TV mode is active.
  // Works on Chrome / Edge / Safari 16.4+ (exactly the browsers shops use
  // on wall-mounted TVs). Ignored silently on older browsers.
  //
  // Triple safety net because TVs are LAZY about holding the lock:
  //   1. Initial request on TV mode entry
  //   2. Re-request on visibilitychange (handles background/foreground)
  //   3. Re-request every 90s on a timer regardless (handles the case
  //      where the lock silently drops on TVs with no focus events)
  //   4. Also bumps a meaningless DOM write every 90s so the tab never
  //      enters the "idle" background-tier that browsers use to throttle
  //      / discard long-idle tabs.
  useEffect(() => {
    if (!tvMode) return;
    let lock: any = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const wl = (navigator as any).wakeLock;
        if (!wl || cancelled) return;
        // Release the prior lock before acquiring — some browsers reject
        // double-acquires instead of reusing the existing lock.
        if (lock && !lock.released) {
          try { await lock.release(); } catch {}
        }
        lock = await wl.request('screen');
        lock?.addEventListener?.('release', () => { lock = null; });
      } catch { /* browser doesn't support it — fine, TV just won't force-awake */ }
    };
    acquire();

    // Browsers drop the wake lock on visibility change — re-acquire on focus
    const onVis = () => { if (!document.hidden && tvMode) acquire(); };
    document.addEventListener('visibilitychange', onVis);

    // Periodic heartbeat every 90s: re-acquire the wake lock + do a tiny
    // DOM write. Both keep the tab "alive" from the browser's tier-down
    // policy. Must be short enough to beat the typical 5-min background
    // throttle, long enough not to burn battery on passive TVs.
    const heartbeat = window.setInterval(() => {
      if (!tvMode || cancelled) return;
      acquire();
      // Ping the DOM with a data-attr so the tab isn't pure-idle. Cheap.
      try {
        document.body.dataset.tvHeartbeat = String(Date.now());
      } catch {}
    }, 90_000);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      window.clearInterval(heartbeat);
      try { lock?.release?.(); } catch {}
    };
  }, [tvMode]);

  const [tvPaused, setTvPaused] = useState(false);
  // Ref updated each render so keyboard handler always sees current slide count without re-binding
  const slideCountRef = useRef(1);
  useEffect(() => {
    if (!tvMode) return;
    const h = (e: KeyboardEvent) => {
      // Standalone TV link locks itself in TV mode — Esc would otherwise
      // drop a wall-mounted display into an unusable admin view nobody can
      // recover without a keyboard. Admin-mode TV (no standalone) keeps the
      // Esc-to-exit affordance because they have a "Back" button to return to.
      if (e.key === 'Escape') {
        if (!standalone) setTvMode(false);
        return;
      }
      const n = Math.max(1, slideCountRef.current);
      if (e.key === 'ArrowRight') {
        setTvFade(false);
        setTimeout(() => { setTvSlideIdx(prev => (prev + 1) % n); setTvFade(true); }, 300);
      } else if (e.key === 'ArrowLeft') {
        setTvFade(false);
        setTimeout(() => { setTvSlideIdx(prev => (prev - 1 + n) % n); setTvFade(true); }, 300);
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        setTvPaused(p => !p);
      }
    };
    // NOTE: Intentionally NOT listening to fullscreenchange here anymore.
    // Previously we exited TV mode whenever fullscreen dropped — but TVs drop
    // fullscreen automatically after ~15 min on many browsers, which kicked
    // the shop out of TV mode even though they wanted to stay. Now the only
    // exit is the Esc key or the explicit Exit button. Fullscreen is
    // best-effort: we ask for it on entry and let the OS/browser manage it.
    window.addEventListener('keydown', h);
    return () => { window.removeEventListener('keydown', h); };
  }, [tvMode]);

  // If fullscreen drops (some TVs/Chromium builds force-exit every ~15 min),
  // silently request it again — don't yank the user out of TV mode.
  useEffect(() => {
    if (!tvMode) return;
    const fsChange = () => {
      if (!document.fullscreenElement && tvMode) {
        // Re-request fullscreen, but swallow rejections — some browsers block
        // a re-request without a fresh user gesture. Worst case: TV mode stays
        // active but not fullscreen, which is still better than fully exiting.
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
    };
    document.addEventListener('fullscreenchange', fsChange);
    return () => { document.removeEventListener('fullscreenchange', fsChange); };
  }, [tvMode]);

  const [openReworkCount, setOpenReworkCount] = useState(0);
  useEffect(() => {
    const unsub1 = DB.subscribeActiveLogs(setActiveLogs);
    const unsub2 = DB.subscribeJobs(setJobs);
    const unsub3 = DB.subscribeSettings(setSettings);
    const unsub4 = DB.subscribeLogs(setAllLogs);
    // subscribeRework may not exist in all builds — optional
    const maybeSub = (DB as any).subscribeRework;
    const unsub5 = typeof maybeSub === 'function'
      ? maybeSub((entries: any[]) => setOpenReworkCount((entries || []).filter((r: any) => r.status === 'open' || r.status === 'in-rework').length))
      : () => {};
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); };
  }, []);

  // Detect start/stop and fire push notifications
  useEffect(() => {
    const currentIds = new Set(activeLogs.map(l => l.id));
    const prevIds = prevLogIdsRef.current;
    activeLogs.forEach(log => {
      if (!prevIds.has(log.id)) {
        const job = jobs.find(j => j.id === log.jobId);
        fireNotification(`${log.userName} started`, `${log.operation}${job ? ` — PO ${job.poNumber}` : ''}`, `start-${log.id}`);
      }
    });
    prevIds.forEach(id => {
      if (!currentIds.has(id)) fireNotification('Timer stopped', 'A worker finished their operation.', `stop-${id}`);
    });
    prevLogIdsRef.current = currentIds;
  }, [activeLogs, jobs]);

  const fireNotification = (title: string, body: string, tag: string) => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'NOTIFY', title, body, tag });
      } else {
        new Notification(title, { body, tag, icon: '/icon-192.png' });
      }
    }
  };

  const handleForceStop = async (logId: string) => {
    const ok = await confirmDialog({
      title: 'Force stop this timer?',
      message: 'The worker may still be running it. They will need to clock back in if this was a mistake.',
      tone: 'warning',
      confirmLabel: 'Force stop',
    });
    if (!ok) return;
    try { await DB.stopTimeLog(logId); addToast('success', 'Timer stopped'); }
    catch { addToast('error', 'Failed to stop timer'); }
  };
  const handlePause = async (logId: string) => {
    try { await DB.pauseTimeLog(logId, 'manual'); addToast('info', 'Timer paused'); }
    catch { addToast('error', 'Failed to pause'); }
  };
  const handleResume = async (logId: string) => {
    try { await DB.resumeTimeLog(logId); addToast('success', 'Timer resumed'); }
    catch { addToast('error', 'Failed to resume'); }
  };

  const getJob = (jobId: string) => jobs.find(j => j.id === jobId) || null;

  const sorted = [...activeLogs].sort((a, b) => {
    const aPaused = a.pausedAt ? 1 : 0;
    const bPaused = b.pausedAt ? 1 : 0;
    if (aPaused !== bPaused) return aPaused - bPaused;
    return a.startTime - b.startTime;
  });

  const workerCount = new Set(activeLogs.map(l => l.userId)).size;
  const runningCount = activeLogs.filter(l => !l.pausedAt).length;
  const pausedCount = activeLogs.filter(l => !!l.pausedAt).length;

  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const inLunch = settings.autoLunchPauseEnabled && hhmm >= (settings.lunchStart || '12:00') && hhmm < (settings.lunchEnd || '12:30');

  // ─── TV MODE SLIDES ────────────────────────────────────────────
  // If user has defined tvSlides, use those. Otherwise, use sensible defaults.
  // Default lineup: Workers+Jobs · Leaderboard · Weather · Weekly Stats
  // Default TV slides — each tab gets its own dedicated full-screen slide.
  // Users can customize in Settings → TV Display → Slides.
  const DEFAULT_TV_SLIDES: TvSlide[] = [
    { id: 'default-workers', type: 'workers', enabled: true },                         // Live workers (full-screen)
    { id: 'default-jobs', type: 'jobs', enabled: true },                               // All open jobs (full-screen)
    { id: 'default-leaderboard-week', type: 'leaderboard', enabled: true, leaderboardMetric: 'mixed', leaderboardPeriod: 'week', leaderboardCount: 5 },
    { id: 'default-leaderboard-month', type: 'leaderboard', enabled: true, leaderboardMetric: 'mixed', leaderboardPeriod: 'month', leaderboardCount: 5 },
    { id: 'default-goals', type: 'goals', enabled: true },
    { id: 'default-stats-week', type: 'stats-week', enabled: true },
    { id: 'default-weather', type: 'weather', enabled: true },
  ];
  // Dedup enabled slides by id (prevents "same slide shows twice" bugs from legacy configs)
  const configuredTvSlides = React.useMemo(() => {
    const enabled = (settings.tvSlides || []).filter(s => s.enabled);
    if (enabled.length === 0) return DEFAULT_TV_SLIDES;
    const seen = new Set<string>();
    const deduped: TvSlide[] = [];
    for (const s of enabled) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      deduped.push(s);
    }
    return deduped;
  }, [settings.tvSlides]);
  // Keep the ref in sync so the keyboard handler can read the count without re-binding
  slideCountRef.current = configuredTvSlides.length;

  const slideDuration = (settings.tvSlideDuration || 15) * 1000;
  const [tvSlideIdx, setTvSlideIdx] = useState(0);
  const [tvFade, setTvFade] = useState(true);

  // Auto-rotate through TV slides (only while in TV mode, and not paused via Spacebar).
  //
  // CONTENT-AWARE DURATION: slides like Jobs / Workers / Leaderboard auto-scroll
  // through long lists — if the slide rotates away after the default 15s, viewers
  // never get to see jobs / workers past the first ~5 visible. We extend the
  // default duration on those slides based on item count so the auto-scroll has
  // a fair chance to cycle once. An explicitly-set per-slide duration always wins.
  useEffect(() => {
    if (!tvMode || tvPaused || configuredTvSlides.length <= 1) return;
    const thisSlide = configuredTvSlides[tvSlideIdx];
    const baseDur = thisSlide?.duration ?? settings.tvSlideDuration ?? 15;

    let effectiveDur = baseDur;
    if (!thisSlide?.duration) {
      // No per-slide override → upscale auto-scroll-heavy slides when content is long.
      // Rough rule of thumb: 1.5s per item past the ~6 that fit on screen, capped
      // at 90s so we don't park forever on one slide.
      // (We recompute the open-jobs count inline to dodge a TDZ — the canonical
      // `openJobs` const is declared further down in the function body.)
      const openJobsCount = jobs.filter(j => j.status !== 'completed').length;
      const itemCount =
        thisSlide?.type === 'jobs' ? openJobsCount :
        thisSlide?.type === 'workers' ? sorted.length :
        thisSlide?.type === 'leaderboard' ? (thisSlide.leaderboardCount || 5) :
        0;
      if (itemCount > 6) {
        effectiveDur = Math.min(90, Math.max(baseDur, Math.round(baseDur + (itemCount - 6) * 1.5)));
      }
    }

    const t = setTimeout(() => {
      setTvFade(false);
      setTimeout(() => {
        setTvSlideIdx(prev => (prev + 1) % configuredTvSlides.length);
        setTvFade(true);
      }, 400);
    }, effectiveDur * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tvMode, tvPaused, tvSlideIdx, configuredTvSlides.length, settings.tvSlideDuration, jobs.length, sorted.length]);

  // Reset slide index when entering TV mode
  useEffect(() => { if (tvMode) { setTvSlideIdx(0); setTvFade(true); } }, [tvMode]);

  // Per-slide sub-index for rotating messages within a single slide (e.g. 10 safety messages cycle one at a time)
  const [slideCycleCounts, setSlideCycleCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!tvMode) return;
    // Each time we land on a slide, bump its cycle counter so sub-messages rotate
    setSlideCycleCounts(prev => {
      const slide = configuredTvSlides[tvSlideIdx];
      if (!slide) return prev;
      return { ...prev, [slide.id]: (prev[slide.id] || 0) + 1 };
    });
  }, [tvSlideIdx, tvMode]);


  // ── WEEKLY LEADERBOARD DATA ───────────────────────────────────
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekCutoff = weekStart.getTime();

  // Shared leaderboard builder that takes a cutoff timestamp
  const buildLeaderboard = React.useCallback((cutoffMs: number): LeaderRow[] => {
    const userMap = new Map<string, { userId: string; name: string; hours: number; jobIds: Set<string>; sessions: number; topOp: string }>();
    allLogs.filter(l => l.startTime >= cutoffMs && l.endTime).forEach(l => {
      const cur = userMap.get(l.userId) || { userId: l.userId, name: l.userName, hours: 0, jobIds: new Set(), sessions: 0, topOp: '' };
      cur.hours += (l.durationMinutes || 0) / 60;
      cur.sessions += 1;
      cur.jobIds.add(l.jobId);
      cur.name = l.userName;
      userMap.set(l.userId, cur);
    });
    activeLogs.filter(l => l.startTime >= cutoffMs).forEach(l => {
      const cur = userMap.get(l.userId) || { userId: l.userId, name: l.userName, hours: 0, jobIds: new Set(), sessions: 0, topOp: '' };
      cur.hours += DB.getWorkingElapsedMs(l) / 3600000;
      if (!allLogs.find(al => al.id === l.id && al.endTime)) cur.sessions += 1;
      cur.jobIds.add(l.jobId);
      cur.name = l.userName;
      userMap.set(l.userId, cur);
    });
    // Top operation per user within cutoff
    userMap.forEach((cur, userId) => {
      const opCounts = new Map<string, number>();
      allLogs.filter(ll => ll.userId === userId && ll.startTime >= cutoffMs).forEach(ll => {
        opCounts.set(ll.operation, (opCounts.get(ll.operation) || 0) + 1);
      });
      let maxOp = ''; let maxCount = 0;
      opCounts.forEach((c, op) => { if (c > maxCount) { maxCount = c; maxOp = op; } });
      cur.topOp = maxOp;
    });
    return Array.from(userMap.values())
      .map(u => ({ userId: u.userId, name: u.name, hours: u.hours, jobs: u.jobIds.size, sessions: u.sessions, topOp: u.topOp }))
      .sort((a, b) => b.hours - a.hours);
  }, [allLogs, activeLogs]);

  const weeklyData = React.useMemo(() => buildLeaderboard(weekCutoff), [buildLeaderboard, weekCutoff]);

  // ── OPEN JOBS ─────────────────────────────────────────────────
  // Sort by parsed due date (soonest first). Jobs without a due date fall to the end.
  const openJobs = jobs.filter(j => j.status !== 'completed').sort((a, b) => {
    const da = parseDueDate(a.dueDate)?.getTime() ?? Infinity;
    const db = parseDueDate(b.dueDate)?.getTime() ?? Infinity;
    return da - db;
  });

  const stages = getStages(settings);

  // ── TV MODE VIEW — full-screen immersive, auto-scroll, always-on clock + weather ──
  if (tvMode) {
    // Show every open job — auto-scroll cycles through them, no count cap.
    // Previously had a `.slice(0, 30)` fallback that hid jobs past 30 when
    // the openJobs array happened to be empty, which was misleading; now
    // we just use the canonical openJobs list whatever its length.
    const jobsForBelt = openJobs;
    const currentSlide = configuredTvSlides[tvSlideIdx] || configuredTvSlides[0];

    // Compute leaderboard based on slide period
    const leaderboardForSlide = (slide: TvSlide): LeaderRow[] => {
      const now = new Date();
      let cutoff: number;
      if (slide.leaderboardPeriod === 'today') {
        const d = new Date(); d.setHours(0, 0, 0, 0); cutoff = d.getTime();
      } else if (slide.leaderboardPeriod === 'month') {
        const d = new Date(now.getFullYear(), now.getMonth(), 1); cutoff = d.getTime();
      } else {
        cutoff = weekCutoff;
      }
      return buildLeaderboard(cutoff);
    };

    const renderSlide = (slide: TvSlide) => {
      switch (slide.type) {
        case 'workers':
          // Full-screen live workers view — no jobs belt on this slide. Jobs get their own 'jobs' slide.
          return <TvWorkersJobsSlide sorted={sorted} jobs={jobs} jobsForBelt={jobsForBelt} stages={stages} runningCount={runningCount} speed={settings.tvScrollSpeed || 'normal'} showJobsBelt={false} />;
        case 'jobs':
          return <div className="h-full flex flex-col"><TvJobsBelt jobs={jobsForBelt} stages={stages} speed={settings.tvScrollSpeed || 'normal'} showCustomers={settings.tvShowCustomerNames !== false} /></div>;
        case 'leaderboard':
          return <TvLeaderboardSlide data={leaderboardForSlide(slide)} period={slide.leaderboardPeriod || 'week'} count={slide.leaderboardCount || 5} metric={slide.leaderboardMetric || 'mixed'} speed={settings.tvScrollSpeed || 'normal'} />;
        case 'weather':
          return <TvWeatherSlide lat={settings.weatherLat} lon={settings.weatherLon} />;
        case 'stats-week':
        case 'stats':
          return <TvWeeklyStatsSlide
            allLogs={allLogs}
            weekStart={weekStart}
            jobs={jobs}
            showRevenue={settings.tvShowRevenue === true}
            showCustomers={settings.tvShowCustomerNames !== false}
          />;
        case 'goals':
          return <TvGoalsSlide
            goals={settings.shopGoals || []}
            jobs={jobs}
            logs={allLogs}
            reworkCount={openReworkCount}
            showRevenue={settings.tvShowRevenue === true}
          />;
        case 'flow-map':
          return <TvFlowMapSlide jobs={jobs} stages={stages} activeLogs={activeLogs} />;
        case 'safety': {
          // Safety slide cycles through multiple messages — one per TV rotation
          const msgs = (slide.messages && slide.messages.length > 0)
            ? slide.messages
            : [{ id: 'legacy', title: slide.title, body: slide.body, color: slide.color, icon: slide.icon }];
          const i = (slideCycleCounts[slide.id] || 1) - 1;
          const m = msgs[i % msgs.length];
          return <TvSafetySlide title={m.title} body={m.body} color={m.color} icon={m.icon} cycleInfo={msgs.length > 1 ? { current: (i % msgs.length) + 1, total: msgs.length } : undefined} />;
        }
        case 'message': {
          // Announcement slide cycles through multiple messages
          const msgs = (slide.messages && slide.messages.length > 0)
            ? slide.messages
            : [{ id: 'legacy', title: slide.title, body: slide.body, color: slide.color }];
          const i = (slideCycleCounts[slide.id] || 1) - 1;
          const m = msgs[i % msgs.length];
          return <TvMessageSlide title={m.title} body={m.body} color={m.color} cycleInfo={msgs.length > 1 ? { current: (i % msgs.length) + 1, total: msgs.length } : undefined} />;
        }
        default:
          return <TvWorkersJobsSlide sorted={sorted} jobs={jobs} jobsForBelt={jobsForBelt} stages={stages} runningCount={runningCount} speed={settings.tvScrollSpeed || 'normal'} showJobsBelt={settings.tvShowJobsBelt !== false} />;
      }
    };

    const slideLabel = (slide: TvSlide): string => {
      switch (slide.type) {
        case 'workers': return 'Live Workers';
        case 'jobs': return 'Open Jobs';
        case 'leaderboard': return 'Leaderboard';
        case 'weather': return 'Weather';
        case 'stats-week': case 'stats': return 'Week Stats';
        case 'goals': return 'Goals';
        case 'flow-map': return 'Shop Flow';
        case 'safety': return slide.title || 'Safety';
        case 'message': return slide.title || 'Message';
        default: return 'Slide';
      }
    };

    return (
      <div className="fixed inset-0 z-[9999] bg-gradient-to-br from-zinc-950 via-black to-zinc-950 text-white overflow-hidden">
        {/* Ambient glow */}
        <div aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-blue-600/10 blur-[120px]" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-600/10 blur-[120px]" />
        </div>

        {/* Exit chrome — always visible, with keyboard-shortcut chips + FAB-style Exit */}
        <div className="tv-chrome absolute top-4 right-4 z-[10001] flex items-center gap-2">
          {tvPaused && (
            <div className="flex items-center gap-1.5 text-[11px] text-yellow-400 uppercase tracking-widest font-black bg-yellow-500/15 border border-yellow-500/30 rounded-lg px-2.5 py-1.5 animate-pulse">
              <Pause className="w-3 h-3" aria-hidden="true" /> Paused
            </div>
          )}
          <button
            aria-label="Exit TV Mode"
            onClick={() => setTvMode(false)}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-500/80 to-red-600/80 hover:from-red-500 hover:to-red-600 text-white text-sm font-black border border-red-400/30 transition-all flex items-center gap-2 backdrop-blur-xl shadow-lg shadow-red-900/40 active:scale-95"
          >
            <Minimize2 className="w-4 h-4" aria-hidden="true" /> Exit TV Mode
          </button>
        </div>

        {/* Bottom keyboard-shortcut hint bar */}
        <div className="tv-chrome absolute bottom-4 left-1/2 -translate-x-1/2 z-[10001] flex items-center gap-3 bg-black/50 backdrop-blur-xl border border-white/10 rounded-full px-4 py-2 pointer-events-none">
          <span className="text-[10px] text-white/60 font-semibold flex items-center gap-1.5">
            <kbd className="text-white bg-white/10 border border-white/15 px-1.5 py-0.5 rounded font-mono text-[10px]">Esc</kbd> exit
          </span>
          <span className="w-px h-3 bg-white/10" />
          <span className="text-[10px] text-white/60 font-semibold flex items-center gap-1.5">
            <kbd className="text-white bg-white/10 border border-white/15 px-1.5 py-0.5 rounded font-mono text-[10px]">←</kbd>
            <kbd className="text-white bg-white/10 border border-white/15 px-1.5 py-0.5 rounded font-mono text-[10px]">→</kbd>
            skip
          </span>
          <span className="w-px h-3 bg-white/10" />
          <span className="text-[10px] text-white/60 font-semibold flex items-center gap-1.5">
            <kbd className="text-white bg-white/10 border border-white/15 px-1.5 py-0.5 rounded font-mono text-[10px]">Space</kbd>
            {tvPaused ? 'resume' : 'pause'}
          </span>
        </div>

        <div className="relative h-full flex flex-col overflow-hidden">
          {/* TOP BAR — Shop name + Clock + Stats + Weather
              Sizes use clamp() so content shrinks on small TVs (720p / portrait)
              and grows on 4K displays without overflow. Wraps to 2 rows below
              ~900px so nothing gets clipped. */}
          <div
            className="shrink-0 flex items-center justify-between gap-3 sm:gap-6 border-b border-white/5 backdrop-blur-xl bg-black/20 flex-wrap"
            style={{ padding: 'clamp(0.5rem, 1.2vw, 1.5rem) clamp(0.75rem, 2vw, 2rem)' }}
          >
            {/* Left — shop */}
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {settings.companyLogo && <img src={settings.companyLogo} alt="" className="object-contain shrink-0" style={{ height: 'clamp(1.75rem, 3.5vw, 3rem)' }} />}
              <div className="min-w-0">
                {settings.companyName && <p className="font-black text-white tracking-tight truncate" style={{ fontSize: 'clamp(1rem, 1.8vw, 1.5rem)' }}>{settings.companyName}</p>}
                <div className="flex items-center gap-2 mt-0.5">
                  <Radio className="w-3 h-3 text-red-500 animate-pulse shrink-0" aria-hidden="true" />
                  <span className="font-black text-white/60 uppercase tracking-[0.3em] truncate" style={{ fontSize: 'clamp(0.55rem, 0.7vw, 0.7rem)' }}>Live Shop Floor</span>
                </div>
              </div>
            </div>

            {/* Center — clock */}
            <div className="shrink-0 text-center">
              <LiveClock size="huge" />
              <p className="text-white/40 font-semibold mt-1 truncate" style={{ fontSize: 'clamp(0.65rem, 0.9vw, 0.875rem)' }}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
            </div>

            {/* Right — stats + weather */}
            <div className="shrink-0 flex items-center gap-3 sm:gap-5 min-w-0 flex-1 justify-end flex-wrap">
              <div className="flex items-center" style={{ gap: 'clamp(0.5rem, 1.2vw, 1.25rem)' }}>
                <div className="text-center">
                  <div className="flex items-center gap-1 justify-center">
                    <Users className="w-3 h-3 sm:w-4 sm:h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                    <span className="font-black text-white tabular leading-none" style={{ fontSize: 'clamp(1.25rem, 2vw, 1.875rem)' }}>{workerCount}</span>
                  </div>
                  <p className="font-black text-white/30 uppercase tracking-widest mt-1" style={{ fontSize: 'clamp(0.5rem, 0.65vw, 0.625rem)' }}>Workers</p>
                </div>
                <div className="w-px h-8 bg-white/10" />
                <div className="text-center">
                  <div className="flex items-center gap-1 justify-center">
                    <Activity className="w-3 h-3 sm:w-4 sm:h-4 text-blue-400 animate-pulse shrink-0" aria-hidden="true" />
                    <span className="font-black text-white tabular leading-none" style={{ fontSize: 'clamp(1.25rem, 2vw, 1.875rem)' }}>{runningCount}</span>
                  </div>
                  <p className="font-black text-white/30 uppercase tracking-widest mt-1" style={{ fontSize: 'clamp(0.5rem, 0.65vw, 0.625rem)' }}>Running</p>
                </div>
                <div className="w-px h-8 bg-white/10" />
                <div className="text-center">
                  <div className="flex items-center gap-1 justify-center">
                    <Briefcase className="w-3 h-3 sm:w-4 sm:h-4 text-purple-400 shrink-0" aria-hidden="true" />
                    <span className="font-black text-white tabular leading-none" style={{ fontSize: 'clamp(1.25rem, 2vw, 1.875rem)' }}>{openJobs.length}</span>
                  </div>
                  <p className="font-black text-white/30 uppercase tracking-widest mt-1" style={{ fontSize: 'clamp(0.5rem, 0.65vw, 0.625rem)' }}>Open</p>
                </div>
              </div>
              {/* Weather — compact inline */}
              {settings.tvShowWeather !== false && <TVWeather lat={settings.weatherLat} lon={settings.weatherLon} />}
            </div>
          </div>

          {/* MAIN — Rotating slides (fades between).
              min-h-0 is critical so the flex child can shrink below its content
              and overflow-hidden prevents children from pushing the layout off-screen. */}
          <div className={`flex-1 min-h-0 overflow-hidden transition-opacity duration-400 ${tvFade ? 'opacity-100' : 'opacity-0'}`}>
            {renderSlide(currentSlide)}
          </div>

          {/* Slide indicators + slide label — bottom of screen */}
          {configuredTvSlides.length > 1 && (
            <div className="tv-chrome shrink-0 border-t border-white/5 bg-black/40 backdrop-blur-xl flex items-center justify-center gap-2 flex-wrap" style={{ padding: 'clamp(0.35rem, 0.6vw, 0.75rem) clamp(0.75rem, 2vw, 2rem)' }}>
              {configuredTvSlides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setTvFade(false); setTimeout(() => { setTvSlideIdx(i); setTvFade(true); }, 300); }}
                  aria-label={`Show ${slideLabel(s)}`}
                  aria-current={i === tvSlideIdx ? 'true' : undefined}
                  className="group flex items-center gap-1.5"
                >
                  <span className={`h-1.5 rounded-full transition-all duration-500 ${i === tvSlideIdx ? 'w-12 bg-blue-500' : 'w-1.5 bg-white/20 group-hover:bg-white/40'}`} />
                  {i === tvSlideIdx && (
                    <span className="text-[10px] text-white/60 font-black uppercase tracking-widest">{slideLabel(s)}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen transition-all duration-500 ${dimMode ? 'bg-black' : 'bg-zinc-950'}`}>
      {ConfirmHost}
      {/* HEADER */}
      <div className="sticky top-0 z-30 bg-zinc-950/90 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-3">
          {standalone ? (
            <div className="w-16" />
          ) : (
            <button onClick={onBack} className="flex items-center gap-2 text-white/60 hover:text-white text-sm font-medium transition-colors">
              <ChevronLeft className="w-4 h-4" /><span className="hidden sm:inline">Back</span>
            </button>
          )}
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-red-500 animate-pulse" />
            <span className="text-white font-black text-sm tracking-wide">LIVE FLOOR</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button aria-label={dimMode ? 'Exit dim mode' : 'Enter dim mode'} aria-pressed={dimMode} onClick={() => setDimMode(!dimMode)} className={`p-2 rounded-lg transition-colors min-w-[36px] min-h-[36px] ${dimMode ? 'bg-blue-500/20 text-blue-400' : 'bg-white/5 text-white/40 hover:text-white'}`} title={dimMode ? 'Normal' : 'Dim'}>
              {dimMode ? <Sun className="w-4 h-4" aria-hidden="true" /> : <Moon className="w-4 h-4" aria-hidden="true" />}
            </button>
            <button aria-label={compact ? 'Expand layout' : 'Compact layout'} aria-pressed={compact} onClick={() => setCompact(!compact)} className={`p-2 rounded-lg transition-colors min-w-[36px] min-h-[36px] ${compact ? 'bg-white/10 text-white' : 'bg-white/5 text-white/40 hover:text-white'}`} title={compact ? 'Expand' : 'Compact'}>
              {compact ? <Maximize2 className="w-4 h-4" aria-hidden="true" /> : <Minimize2 className="w-4 h-4" aria-hidden="true" />}
            </button>
            <button aria-label="Toggle fullscreen" onClick={() => {
              if (document.fullscreenElement) document.exitFullscreen();
              else document.documentElement.requestFullscreen().catch(() => {});
            }} className="p-2 rounded-lg transition-colors bg-white/5 text-white/40 hover:text-white hover:bg-blue-500/20 min-w-[36px] min-h-[36px]" title="Fullscreen">
              <Smartphone className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              aria-label="Enter TV Mode"
              onClick={() => setTvMode(true)}
              className="ml-1 px-3 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-blue-900/40 min-h-[36px] transition-all"
              title="Full-screen TV mode — hides sidebar, auto-scrolls"
            >
              <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" /> TV Mode
            </button>
          </div>
        </div>

        {settings.tvCompanyHeader !== false && (settings.companyName || settings.companyLogo) && (
          <div className="flex items-center justify-center gap-3 px-4 py-2 border-b border-white/5">
            {settings.companyLogo && <img src={settings.companyLogo} alt="" className="h-6 object-contain" />}
            {settings.companyName && <span className="text-white font-bold text-sm tracking-wide">{settings.companyName}</span>}
          </div>
        )}

        {settings.tvShowStats !== false && (
          <div className="flex items-center justify-center gap-6 px-4 py-2">
            <div className="flex items-center gap-2"><Users className="w-3.5 h-3.5 text-emerald-400" /><span className="text-white font-bold text-sm">{workerCount}</span><span className="text-white/30 text-xs">workers</span></div>
            <div className="w-px h-4 bg-white/10" />
            <div className="flex items-center gap-2"><Activity className="w-3.5 h-3.5 text-blue-400" /><span className="text-white font-bold text-sm">{runningCount}</span><span className="text-white/30 text-xs">running</span></div>
            {pausedCount > 0 && (<><div className="w-px h-4 bg-white/10" /><div className="flex items-center gap-2"><Pause className="w-3.5 h-3.5 text-yellow-400" /><span className="text-yellow-400 font-bold text-sm">{pausedCount}</span><span className="text-white/30 text-xs">paused</span></div></>)}
            <div className="w-px h-4 bg-white/10" />
            <div className="flex items-center gap-2"><Briefcase className="w-3.5 h-3.5 text-purple-400" /><span className="text-white font-bold text-sm">{openJobs.length}</span><span className="text-white/30 text-xs">open jobs</span></div>
          </div>
        )}

        {inLunch && (
          <div className="bg-yellow-500/10 border-t border-yellow-500/20 px-4 py-2 text-center">
            <span className="text-yellow-400 text-xs font-black uppercase tracking-wider">LUNCH BREAK — Timers auto-paused</span>
          </div>
        )}
      </div>

      {/* ── LIVE WORKERS VIEW — admin-focused; for slideshow (Leaderboard, Goals, Weather, Stats) click "TV Mode" ── */}
      <div className="pb-16">
        {/* CTA banner — teaches users what TV Mode does (only show when there's activity to broadcast) */}
        {activeLogs.length > 0 && (
          <div className="px-4 pt-4 max-w-3xl mx-auto">
            <button
              onClick={() => setTvMode(true)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-blue-500/10 to-indigo-500/5 border border-blue-500/20 hover:border-blue-500/40 hover:from-blue-500/15 hover:to-indigo-500/10 transition-all text-left group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0 group-hover:bg-blue-500/30 transition-colors">
                  <Radio className="w-5 h-5 text-blue-400 animate-pulse" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white">Put this on the shop TV</p>
                  <p className="text-[11px] text-white/50 truncate">Full-screen slideshow: Workers · Jobs · Leaderboard · Goals · Weather · Weekly Stats</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-blue-400 text-xs font-bold shrink-0 group-hover:text-blue-300">
                <Maximize2 className="w-4 h-4" aria-hidden="true" /> TV Mode
              </div>
            </button>
          </div>
        )}

        {/* Active workers list — the admin-controllable view */}
        <div className={`p-4 ${compact ? 'max-w-2xl' : 'max-w-3xl'} mx-auto`}>
          {activeLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-20 px-6">
              <div className="w-20 h-20 rounded-full bg-white/[0.03] flex items-center justify-center mb-6">
                <Clock className="w-10 h-10 text-white/10" aria-hidden="true" />
              </div>
              <h2 className="text-white/60 font-bold text-xl mb-2">Floor is quiet</h2>
              <p className="text-white/20 text-sm max-w-xs mb-6">When workers start timers, their live activity will appear here.</p>
              <button
                onClick={() => setTvMode(true)}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-bold flex items-center gap-2 shadow-lg shadow-blue-900/40 transition-all"
              >
                <Maximize2 className="w-4 h-4" aria-hidden="true" /> Preview TV Slideshow
              </button>
              <p className="text-[10px] text-white/20 mt-3">Shows leaderboard, goals, weather, and weekly stats even without active workers.</p>
            </div>
          ) : compact ? (
            <div className="rounded-2xl border border-white/5 overflow-hidden bg-white/[0.01]">
              {sorted.map(log => (
                <WorkerCard key={log.id} log={log} job={getJob(log.jobId)} compact isAdmin={isAdmin} tvSettings={settings}
                  onForceStop={isAdmin ? handleForceStop : undefined} onPause={isAdmin ? handlePause : undefined} onResume={isAdmin ? handleResume : undefined} />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {sorted.map(log => (
                <WorkerCard key={log.id} log={log} job={getJob(log.jobId)} compact={false} isAdmin={isAdmin} tvSettings={settings}
                  onForceStop={isAdmin ? handleForceStop : undefined} onPause={isAdmin ? handlePause : undefined} onResume={isAdmin ? handleResume : undefined} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom pulse line */}
      {activeLogs.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 h-1 z-40">
          <div className="h-full bg-gradient-to-r from-transparent via-blue-500/50 to-transparent animate-pulse" />
        </div>
      )}
    </div>
  );
};

export default LiveFloorMonitor;
