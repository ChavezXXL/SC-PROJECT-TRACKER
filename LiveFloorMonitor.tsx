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
  Wind,
  Zap,
} from 'lucide-react';

import { Job, TimeLog, SystemSettings, TvSlide } from './types';
import * as DB from './services/mockDb';

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
                <button onClick={() => onResume(log.id)} className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all" title="Resume"><Play className="w-4 h-4" /></button>
              ) : onPause ? (
                <button onClick={() => onPause(log.id)} className="p-2 rounded-xl bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500 hover:text-white transition-all" title="Pause"><Pause className="w-4 h-4" /></button>
              ) : null}
              {onForceStop && <button onClick={() => onForceStop(log.id)} className="p-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all" title="Force Stop"><StopCircle className="w-4 h-4" /></button>}
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
const BigClock = () => {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(i); }, []);
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return (
    <div className="text-center">
      <div className="text-7xl md:text-8xl font-black text-white font-mono tabular-nums tracking-wider">{time}</div>
      <div className="text-lg text-white/40 font-medium mt-2">{date}</div>
    </div>
  );
};

// ── WEATHER WIDGET ──────────────────────────────────────────────
const WeatherWidget = () => {
  const [weather, setWeather] = useState<any>(null);

  useEffect(() => {
    // Use browser geolocation + open-meteo (free, no API key)
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const { latitude, longitude } = pos.coords;
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`);
        const data = await res.json();
        if (data.current) {
          setWeather({
            temp: Math.round(data.current.temperature_2m),
            code: data.current.weather_code,
            wind: Math.round(data.current.wind_speed_10m),
            humidity: data.current.relative_humidity_2m,
            location: data.timezone?.replace('_', ' ')?.split('/')?.pop() || '',
          });
        }
      } catch { /* ignore */ }
    }, () => { /* denied */ }, { timeout: 5000 });
  }, []);

  if (!weather) return null;

  const getIcon = (code: number) => {
    if (code <= 3) return <Sun className="w-12 h-12 text-yellow-400" />;
    if (code <= 48) return <Cloud className="w-12 h-12 text-zinc-400" />;
    if (code <= 67) return <CloudRain className="w-12 h-12 text-blue-400" />;
    if (code <= 77) return <CloudSnow className="w-12 h-12 text-cyan-300" />;
    return <CloudRain className="w-12 h-12 text-blue-500" />;
  };

  const getLabel = (code: number) => {
    if (code === 0) return 'Clear Sky';
    if (code <= 3) return 'Partly Cloudy';
    if (code <= 48) return 'Cloudy';
    if (code <= 55) return 'Drizzle';
    if (code <= 67) return 'Rain';
    if (code <= 77) return 'Snow';
    return 'Showers';
  };

  return (
    <div className="flex items-center gap-6 bg-white/5 rounded-2xl p-6">
      {getIcon(weather.code)}
      <div>
        <div className="text-5xl font-black text-white">{weather.temp}°F</div>
        <div className="text-white/50 text-sm font-medium">{getLabel(weather.code)}</div>
      </div>
      <div className="ml-auto text-right space-y-1">
        <div className="flex items-center gap-2 text-white/40 text-sm"><Wind className="w-4 h-4" />{weather.wind} mph</div>
        <div className="text-white/40 text-sm">💧 {weather.humidity}%</div>
        {weather.location && <div className="text-white/30 text-xs">{weather.location}</div>}
      </div>
    </div>
  );
};

// ── SLIDE INDICATORS ────────────────────────────────────────────
const SlideIndicators = ({ slides, currentIdx, labels }: { slides: any[]; currentIdx: number; labels: string[] }) => (
  <div className="fixed bottom-4 left-0 right-0 flex justify-center gap-2 z-50">
    {slides.map((_, i) => (
      <div key={i} className="flex items-center gap-1.5">
        <div className={`h-2 rounded-full transition-all duration-500 ${i === currentIdx ? 'w-10 bg-blue-500' : 'w-2 bg-white/20'}`} />
        {i === currentIdx && <span className="text-[10px] text-white/40 font-medium">{labels[i]}</span>}
      </div>
    ))}
  </div>
);

// ── MAIN COMPONENT ──────────────────────────────────────────────
interface LiveFloorMonitorProps {
  user?: { id: string; name: string; role: string } | null;
  onBack?: () => void;
  addToast?: (type: 'success' | 'error' | 'info', message: string) => void;
  standalone?: boolean; // true when accessed via ?tv=TOKEN URL (no login, no back button)
}

export const LiveFloorMonitor: React.FC<LiveFloorMonitorProps> = ({ user, onBack, addToast: addToastProp, standalone }) => {
  const addToast = addToastProp || (() => {});
  const [activeLogs, setActiveLogs] = useState<TimeLog[]>([]);
  const [allLogs, setAllLogs] = useState<TimeLog[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [settings, setSettings] = useState<SystemSettings>(DB.getSettings());
  const [compact, setCompact] = useState(false);
  const [dimMode, setDimMode] = useState(false);
  const prevLogIdsRef = useRef<Set<string>>(new Set());
  const [currentSlideIdx, setCurrentSlideIdx] = useState(0);
  const [fadeIn, setFadeIn] = useState(true);

  const isAdmin = !standalone && user?.role === 'admin';

  useEffect(() => {
    const unsub1 = DB.subscribeActiveLogs(setActiveLogs);
    const unsub2 = DB.subscribeJobs(setJobs);
    const unsub3 = DB.subscribeSettings(setSettings);
    const unsub4 = DB.subscribeLogs(setAllLogs);
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
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
    if (!confirm('Force stop this timer?')) return;
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

  // ── BASE SLIDES (always present) + custom message slides ──────
  const BASE_SLIDE_LABELS = ['Live Workers', 'Shop Stats', 'Leaderboard', 'Clock & Weather', 'Job Board'];
  const baseSlideCount = 5;

  // Custom message slides from settings
  const customSlides = (settings.tvSlides || []).filter(s => s.enabled && s.type === 'message');

  const totalSlides = baseSlideCount + customSlides.length;
  const allLabels = [...BASE_SLIDE_LABELS, ...customSlides.map(s => s.title || 'Message')];

  const slideDuration = (settings.tvSlideDuration || 15) * 1000;

  // Auto-rotate with fade transition
  useEffect(() => {
    const timer = setTimeout(() => {
      setFadeIn(false);
      setTimeout(() => {
        setCurrentSlideIdx(prev => (prev + 1) % totalSlides);
        setFadeIn(true);
      }, 400);
    }, slideDuration);
    return () => clearTimeout(timer);
  }, [currentSlideIdx, totalSlides, slideDuration]);

  // ── WEEKLY LEADERBOARD DATA ───────────────────────────────────
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekCutoff = weekStart.getTime();

  const weeklyData = React.useMemo(() => {
    const userMap = new Map<string, { name: string; hours: number; sessions: number; topOp: string }>();
    allLogs.filter(l => l.startTime >= weekCutoff && l.endTime).forEach(l => {
      const cur = userMap.get(l.userId) || { name: l.userName, hours: 0, sessions: 0, topOp: '' };
      cur.hours += (l.durationMinutes || 0) / 60;
      cur.sessions += 1;
      cur.name = l.userName;
      userMap.set(l.userId, cur);
    });
    // Also count active logs
    activeLogs.forEach(l => {
      const cur = userMap.get(l.userId) || { name: l.userName, hours: 0, sessions: 0, topOp: '' };
      cur.hours += DB.getWorkingElapsedMs(l) / 3600000;
      if (!allLogs.find(al => al.id === l.id && al.endTime)) cur.sessions += 1;
      cur.name = l.userName;
      userMap.set(l.userId, cur);
    });
    // Find top operation per user
    allLogs.filter(l => l.startTime >= weekCutoff).forEach(l => {
      const cur = userMap.get(l.userId);
      if (cur) {
        const opCounts = new Map<string, number>();
        allLogs.filter(ll => ll.userId === l.userId && ll.startTime >= weekCutoff).forEach(ll => {
          opCounts.set(ll.operation, (opCounts.get(ll.operation) || 0) + 1);
        });
        let maxOp = ''; let maxCount = 0;
        opCounts.forEach((c, op) => { if (c > maxCount) { maxCount = c; maxOp = op; } });
        cur.topOp = maxOp;
      }
    });
    return Array.from(userMap.values()).sort((a, b) => b.hours - a.hours);
  }, [allLogs, activeLogs, weekCutoff]);

  // ── OPEN JOBS ─────────────────────────────────────────────────
  const openJobs = jobs.filter(j => j.status !== 'completed').sort((a, b) => {
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return 0;
  });

  const MEDAL_COLORS = ['#fbbf24', '#94a3b8', '#d97706'];

  return (
    <div className={`min-h-screen transition-all duration-500 ${dimMode ? 'bg-black' : 'bg-zinc-950'}`}>
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
            <span className="text-white/20 text-xs ml-2">{allLabels[currentSlideIdx]}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setDimMode(!dimMode)} className={`p-2 rounded-lg transition-colors ${dimMode ? 'bg-blue-500/20 text-blue-400' : 'bg-white/5 text-white/40 hover:text-white'}`} title={dimMode ? 'Normal' : 'Dim'}>
              {dimMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={() => setCompact(!compact)} className={`p-2 rounded-lg transition-colors ${compact ? 'bg-white/10 text-white' : 'bg-white/5 text-white/40 hover:text-white'}`} title={compact ? 'Expand' : 'Compact'}>
              {compact ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
            </button>
            <button onClick={() => {
              if (document.fullscreenElement) document.exitFullscreen();
              else document.documentElement.requestFullscreen().catch(() => {});
            }} className="p-2 rounded-lg transition-colors bg-white/5 text-white/40 hover:text-white hover:bg-blue-500/20" title="Fullscreen">
              <Smartphone className="w-4 h-4" />
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

      {/* ── SLIDE CONTENT with fade ── */}
      <div className={`transition-opacity duration-400 ${fadeIn ? 'opacity-100' : 'opacity-0'}`} style={{ minHeight: 'calc(100vh - 140px)' }}>

        {/* SLIDE 0: Workers Live View */}
        {currentSlideIdx === 0 && (
          <div className={`p-4 ${compact ? 'max-w-2xl' : 'max-w-3xl'} mx-auto pb-16`}>
            {activeLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-24 px-6">
                <div className="w-20 h-20 rounded-full bg-white/[0.03] flex items-center justify-center mb-6"><Clock className="w-10 h-10 text-white/10" /></div>
                <h2 className="text-white/60 font-bold text-xl mb-2">Floor is quiet</h2>
                <p className="text-white/20 text-sm max-w-xs">When workers start timers, their live activity will appear here.</p>
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
        )}

        {/* SLIDE 1: Shop Stats Overview */}
        {currentSlideIdx === 1 && (
          <div className="flex flex-col items-center justify-center p-8 pb-16">
            <div className="max-w-3xl w-full space-y-8">
              <h2 className="text-3xl font-black text-white text-center flex items-center justify-center gap-3"><TrendingUp className="w-8 h-8 text-blue-400" /> Shop Overview</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white/5 rounded-2xl p-6 text-center border border-white/5">
                  <p className="text-white/40 text-xs uppercase font-bold mb-1">Active Workers</p>
                  <p className="text-5xl font-black text-emerald-400">{workerCount}</p>
                </div>
                <div className="bg-white/5 rounded-2xl p-6 text-center border border-white/5">
                  <p className="text-white/40 text-xs uppercase font-bold mb-1">Running</p>
                  <p className="text-5xl font-black text-blue-400">{runningCount}</p>
                </div>
                <div className="bg-white/5 rounded-2xl p-6 text-center border border-white/5">
                  <p className="text-white/40 text-xs uppercase font-bold mb-1">Paused</p>
                  <p className="text-5xl font-black text-yellow-400">{pausedCount}</p>
                </div>
                <div className="bg-white/5 rounded-2xl p-6 text-center border border-white/5">
                  <p className="text-white/40 text-xs uppercase font-bold mb-1">Open Jobs</p>
                  <p className="text-5xl font-black text-purple-400">{openJobs.length}</p>
                </div>
              </div>
              <div className="bg-white/5 rounded-2xl p-6 border border-white/5">
                <h3 className="text-white/40 text-xs uppercase font-bold mb-4">Currently Active</h3>
                <div className="space-y-3">
                  {sorted.slice(0, 8).map(log => {
                    const job = getJob(log.jobId);
                    return (
                      <div key={log.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${log.pausedAt ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'}`}>{log.userName.charAt(0)}</div>
                          <div>
                            <span className="text-white font-bold text-sm">{log.userName}</span>
                            <span className="text-white/40 text-xs ml-2">{log.operation}</span>
                          </div>
                        </div>
                        <div className="text-right flex items-center gap-3">
                          <LiveTicker log={log} size="sm" />
                          {job && <p className="text-white/30 text-[10px] w-20 truncate text-right">{job.poNumber}</p>}
                        </div>
                      </div>
                    );
                  })}
                  {sorted.length === 0 && <p className="text-white/20 text-sm text-center py-4">No active workers</p>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SLIDE 2: Employee Leaderboard */}
        {currentSlideIdx === 2 && (
          <div className="flex flex-col items-center justify-center p-8 pb-16">
            <div className="max-w-3xl w-full space-y-6">
              <h2 className="text-3xl font-black text-white text-center flex items-center justify-center gap-3"><Trophy className="w-8 h-8 text-yellow-400" /> Weekly Leaderboard</h2>
              <p className="text-white/30 text-sm text-center">Top performers this week</p>
              <div className="space-y-3">
                {weeklyData.slice(0, 10).map((w, i) => {
                  const initials = w.name.split(' ').map(x => x[0]).join('').toUpperCase().slice(0, 2);
                  const pct = weeklyData[0]?.hours > 0 ? (w.hours / weeklyData[0].hours) * 100 : 0;
                  return (
                    <div key={w.name} className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${i === 0 ? 'bg-yellow-500/5 border-yellow-500/20' : i === 1 ? 'bg-zinc-500/5 border-zinc-500/20' : i === 2 ? 'bg-orange-500/5 border-orange-500/20' : 'bg-white/[0.02] border-white/5'}`}>
                      <div className="w-8 text-center">
                        {i < 3 ? (
                          <Award className="w-6 h-6 mx-auto" style={{ color: MEDAL_COLORS[i] }} />
                        ) : (
                          <span className="text-white/30 font-bold text-lg">{i + 1}</span>
                        )}
                      </div>
                      <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-sm font-black text-white/80">{initials}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-white font-bold text-base">{w.name}</span>
                          <span className="text-white font-black text-lg">{w.hours.toFixed(1)}h</span>
                        </div>
                        <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${pct}%`, background: i === 0 ? 'linear-gradient(90deg, #fbbf24, #f59e0b)' : i === 1 ? 'linear-gradient(90deg, #94a3b8, #64748b)' : i === 2 ? 'linear-gradient(90deg, #d97706, #b45309)' : 'linear-gradient(90deg, #3b82f6, #2563eb)' }} />
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-white/30 text-xs">{w.sessions} sessions</span>
                          {w.topOp && <span className="text-blue-400/60 text-xs">{w.topOp}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {weeklyData.length === 0 && <p className="text-white/20 text-sm text-center py-8">No data this week yet</p>}
              </div>
            </div>
          </div>
        )}

        {/* SLIDE 3: Clock & Weather */}
        {currentSlideIdx === 3 && (
          <div className="flex flex-col items-center justify-center p-8 pb-16" style={{ minHeight: 'calc(100vh - 140px)' }}>
            <div className="max-w-2xl w-full space-y-10">
              <BigClock />
              <WeatherWidget />
              {/* Quick stats below */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white/5 rounded-2xl p-5 text-center border border-white/5">
                  <p className="text-white/30 text-[10px] uppercase font-bold">Today's Hours</p>
                  <p className="text-2xl font-black text-blue-400 mt-1">
                    {(() => {
                      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
                      const todayMs = todayStart.getTime();
                      const mins = allLogs.filter(l => l.startTime >= todayMs && l.endTime).reduce((a, l) => a + (l.durationMinutes || 0), 0);
                      const activeMins = activeLogs.reduce((a, l) => a + DB.getWorkingElapsedMs(l) / 60000, 0);
                      return ((mins + activeMins) / 60).toFixed(1);
                    })()}h
                  </p>
                </div>
                <div className="bg-white/5 rounded-2xl p-5 text-center border border-white/5">
                  <p className="text-white/30 text-[10px] uppercase font-bold">Jobs Due Today</p>
                  <p className="text-2xl font-black text-orange-400 mt-1">
                    {jobs.filter(j => {
                      const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
                      return j.dueDate === today && j.status !== 'completed';
                    }).length}
                  </p>
                </div>
                <div className="bg-white/5 rounded-2xl p-5 text-center border border-white/5">
                  <p className="text-white/30 text-[10px] uppercase font-bold">Completed Today</p>
                  <p className="text-2xl font-black text-emerald-400 mt-1">
                    {(() => {
                      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
                      return jobs.filter(j => j.completedAt && j.completedAt >= todayStart.getTime()).length;
                    })()}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SLIDE 4: Job Board */}
        {currentSlideIdx === 4 && (
          <div className="p-4 max-w-5xl mx-auto pb-16">
            <h2 className="text-2xl font-black text-white mb-4 flex items-center gap-3"><Briefcase className="w-6 h-6 text-purple-400" /> Open Jobs ({openJobs.length})</h2>
            <div className="rounded-2xl border border-white/5 overflow-hidden">
              <div className="grid grid-cols-[1fr_1fr_80px_100px_100px_80px] gap-0 text-xs font-bold text-white/30 uppercase tracking-widest bg-white/5 px-4 py-3">
                <span>PO Number</span><span>Part / Customer</span><span className="text-center">Qty</span><span className="text-center">Due Date</span><span className="text-center">Status</span><span className="text-center">Priority</span>
              </div>
              <div className="divide-y divide-white/5 max-h-[60vh] overflow-y-auto">
                {openJobs.slice(0, 30).map(job => {
                  const todayN = Date.now();
                  const dueMs = job.dueDate ? new Date(job.dueDate).getTime() : Infinity;
                  const isOverdue = dueMs < todayN && job.status !== 'completed';
                  const isDueSoon = !isOverdue && dueMs - todayN < 3 * 86400000;
                  return (
                    <div key={job.id} className={`grid grid-cols-[1fr_1fr_80px_100px_100px_80px] gap-0 px-4 py-3 items-center ${isOverdue ? 'bg-red-500/5' : ''}`}>
                      <div>
                        <span className="text-white font-bold text-sm">{job.poNumber}</span>
                        {job.jobIdsDisplay && <span className="text-white/20 text-[10px] ml-2">{job.jobIdsDisplay}</span>}
                      </div>
                      <div>
                        <span className="text-white/70 text-sm">{job.partNumber}</span>
                        {job.customer && <span className="text-purple-400/60 text-xs ml-2">{job.customer}</span>}
                      </div>
                      <span className="text-center text-white font-bold">{job.quantity}</span>
                      <span className={`text-center text-sm font-medium ${isOverdue ? 'text-red-400 font-bold' : isDueSoon ? 'text-yellow-400' : 'text-white/50'}`}>
                        {job.dueDate || '-'}
                      </span>
                      <div className="text-center">
                        <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-full ${job.status === 'in-progress' ? 'bg-blue-500/20 text-blue-400' : job.status === 'hold' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-white/5 text-white/40'}`}>
                          {job.status}
                        </span>
                      </div>
                      <div className="text-center">
                        {job.priority && job.priority !== 'normal' && (
                          <span className={`text-[10px] font-black uppercase ${job.priority === 'urgent' ? 'text-red-400' : job.priority === 'high' ? 'text-orange-400' : 'text-white/30'}`}>
                            {job.priority}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* CUSTOM MESSAGE SLIDES */}
        {currentSlideIdx >= baseSlideCount && (() => {
          const customIdx = currentSlideIdx - baseSlideCount;
          const slide = customSlides[customIdx];
          if (!slide) return null;
          return (
            <div className="flex flex-col items-center justify-center p-8" style={{ minHeight: 'calc(100vh - 140px)' }}>
              <div className={`max-w-2xl text-center ${slide.color === 'red' ? 'text-red-400' : slide.color === 'yellow' ? 'text-yellow-400' : slide.color === 'green' ? 'text-emerald-400' : slide.color === 'white' ? 'text-white' : 'text-blue-400'}`}>
                {slide.title && <h1 className="text-4xl md:text-6xl font-black mb-6 leading-tight">{slide.title}</h1>}
                {slide.body && <p className="text-xl md:text-2xl opacity-80 leading-relaxed">{slide.body}</p>}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Slide indicators */}
      <SlideIndicators slides={Array(totalSlides).fill(0)} currentIdx={currentSlideIdx} labels={allLabels} />

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
