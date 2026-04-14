import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Activity,
  ChevronLeft,
  Clock,
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
  Users,
} from 'lucide-react';

import { Job, TimeLog, SystemSettings } from './types';
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
}> = ({
  log,
  job,
  compact,
  onForceStop,
  onPause,
  onResume,
  isAdmin,
  tvSettings,
}) => {
  const initials = log.userName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const isPaused = !!log.pausedAt;
  const minsElapsed = Math.floor(DB.getWorkingElapsedMs(log) / 60000);
  const isLong = minsElapsed > 240;

  if (compact) {
    return (
      <div className={`flex items-center justify-between p-4 border-b border-white/5 ${isPaused ? 'bg-yellow-500/5' : isLong ? 'bg-red-500/5' : ''}`}>
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-black text-white/80">
              {initials}
            </div>
            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-zinc-950 ${isPaused ? 'bg-yellow-500' : 'bg-emerald-500 animate-pulse'}`} />
          </div>
          <div className="min-w-0">
            <p className="text-white font-bold text-sm truncate">{log.userName}</p>
            <div className="flex items-center gap-1.5">
              <p className="text-white/40 text-xs truncate">
                {log.operation} {job ? `— PO ${job.poNumber} · Qty ${job.quantity}${job.customer ? ` · ${job.customer}` : ''}` : ''}
              </p>
              {isPaused && <span className="text-[9px] font-black text-yellow-400 bg-yellow-500/10 px-1 py-0.5 rounded">PAUSED</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LiveTicker log={log} size="sm" />
          {isAdmin && (
            <div className="flex gap-1">
              {isPaused && onResume ? (
                <button onClick={() => onResume(log.id)} className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-colors">
                  <Play className="w-3.5 h-3.5" />
                </button>
              ) : onPause ? (
                <button onClick={() => onPause(log.id)} className="p-1.5 rounded-lg bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500 hover:text-white transition-colors">
                  <Pause className="w-3.5 h-3.5" />
                </button>
              ) : null}
              {onForceStop && (
                <button onClick={() => onForceStop(log.id)} className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-colors">
                  <Power className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border overflow-hidden transition-all ${
      isPaused
        ? 'border-yellow-500/30 bg-yellow-500/5'
        : isLong
        ? 'border-red-500/30 bg-red-500/5 shadow-lg shadow-red-500/5'
        : 'border-white/5 bg-white/[0.02]'
    }`}>
      <div className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-base font-black text-white/80">
                {initials}
              </div>
              <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-zinc-950 ${isPaused ? 'bg-yellow-500' : 'bg-emerald-500 animate-pulse'}`} />
            </div>
            <div>
              <p className="text-white font-bold text-lg">{log.userName}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md">
                  {log.operation}
                </span>
                {isPaused && (
                  <span className="text-[10px] font-black text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded">
                    PAUSED
                  </span>
                )}
                {isLong && !isPaused && (
                  <span className="text-[10px] font-black text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded animate-pulse">
                    {Math.floor(minsElapsed / 60)}h+
                  </span>
                )}
              </div>
            </div>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              {isPaused && onResume ? (
                <button onClick={() => onResume(log.id)} className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all" title="Resume">
                  <Play className="w-4 h-4" />
                </button>
              ) : onPause ? (
                <button onClick={() => onPause(log.id)} className="p-2 rounded-xl bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500 hover:text-white transition-all" title="Pause">
                  <Pause className="w-4 h-4" />
                </button>
              ) : null}
              {onForceStop && (
                <button onClick={() => onForceStop(log.id)} className="p-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all" title="Force Stop">
                  <StopCircle className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="mb-4">
          <LiveTicker log={log} size="lg" />
        </div>

        {(tvSettings?.tvShowElapsedBar !== false) && <ElapsedBar log={log} />}

        {job && (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div>
              <p className="text-[10px] text-white/30 uppercase font-bold tracking-widest">PO</p>
              <p className="text-white font-bold text-sm mt-0.5 truncate">{job.poNumber}</p>
            </div>
            <div>
              <p className="text-[10px] text-white/30 uppercase font-bold tracking-widest">Part</p>
              <p className="text-white/70 text-sm mt-0.5 truncate">{job.partNumber}</p>
            </div>
            <div>
              <p className="text-[10px] text-white/30 uppercase font-bold tracking-widest">Qty</p>
              <p className="text-white/70 text-sm mt-0.5">{job.quantity}</p>
            </div>
            {(tvSettings?.tvShowCustomer !== false) && job.customer && (
              <div className="col-span-3">
                <p className="text-[10px] text-white/30 uppercase font-bold tracking-widest">Customer</p>
                <p className="text-purple-400 text-sm font-bold mt-0.5 truncate">{job.customer}</p>
              </div>
            )}
            {(tvSettings?.tvShowJobId !== false) && job.jobIdsDisplay && (
              <div className="col-span-3">
                <p className="text-[10px] text-white/30 uppercase font-bold tracking-widest">Job #</p>
                <p className="text-white/50 text-xs font-mono mt-0.5 truncate">{job.jobIdsDisplay}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── useAutoLunch HOOK ───────────────────────────────────────────
export function useAutoLunch(addToast: (type: 'success' | 'error' | 'info', message: string) => void) {
  const pausedTodayRef   = useRef<string | null>(null);
  const resumedTodayRef  = useRef<string | null>(null);
  const stoppedTodayRef  = useRef<string | null>(null);

  useEffect(() => {
    const check = () => {
      const settings = DB.getSettings();

      const now   = new Date();
      const today = now.toISOString().split('T')[0];
      const hhmm  = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      // ── Auto Clock-Out ──────────────────────────────────────────
      if (settings.autoClockOutEnabled && settings.autoClockOutTime) {
        if (hhmm >= settings.autoClockOutTime && stoppedTodayRef.current !== today) {
          stoppedTodayRef.current = today;
          DB.stopAllActive().then((count) => {
            if (count > 0) addToast('info', `⏹ Auto clock-out: stopped ${count} timer${count > 1 ? 's' : ''}`);
          });
        }
      }

      // ── Auto Lunch Pause ────────────────────────────────────────
      if (!settings.autoLunchPauseEnabled) return;

      const lunchStart = settings.lunchStart || '12:00';
      const lunchEnd   = settings.lunchEnd   || '12:30';
      const inLunch    = hhmm >= lunchStart && hhmm < lunchEnd;

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
    const i = setInterval(check, 30000); // check every 30 seconds
    return () => clearInterval(i);
  }, [addToast]);
}

// ── MAIN COMPONENT ──────────────────────────────────────────────
interface LiveFloorMonitorProps {
  user: { id: string; name: string; role: string };
  onBack: () => void;
  addToast: (type: 'success' | 'error' | 'info', message: string) => void;
}

export const LiveFloorMonitor: React.FC<LiveFloorMonitorProps> = ({ user, onBack, addToast }) => {
  const [activeLogs, setActiveLogs] = useState<TimeLog[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [settings, setSettings] = useState<SystemSettings>(DB.getSettings());
  const [compact, setCompact] = useState(false);
  const [dimMode, setDimMode] = useState(false);
  const prevLogIdsRef = useRef<Set<string>>(new Set());

  const isAdmin = user.role === 'admin';

  useEffect(() => {
    const unsub1 = DB.subscribeActiveLogs(setActiveLogs);
    const unsub2 = DB.subscribeJobs(setJobs);
    const unsub3 = DB.subscribeSettings(setSettings);
    return () => { unsub1(); unsub2(); unsub3(); };
  }, []);

  // Detect start/stop and fire push notifications
  useEffect(() => {
    const currentIds = new Set(activeLogs.map((l) => l.id));
    const prevIds = prevLogIdsRef.current;

    activeLogs.forEach((log) => {
      if (!prevIds.has(log.id)) {
        const job = jobs.find((j) => j.id === log.jobId);
        fireNotification(`${log.userName} started`, `${log.operation}${job ? ` — PO ${job.poNumber}` : ''}`, `start-${log.id}`);
      }
    });

    prevIds.forEach((id) => {
      if (!currentIds.has(id)) {
        fireNotification('Timer stopped', 'A worker finished their operation.', `stop-${id}`);
      }
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

  const getJob = (jobId: string) => jobs.find((j) => j.id === jobId) || null;

  // Sort: running first, paused at bottom
  const sorted = [...activeLogs].sort((a, b) => {
    const aPaused = a.pausedAt ? 1 : 0;
    const bPaused = b.pausedAt ? 1 : 0;
    if (aPaused !== bPaused) return aPaused - bPaused;
    return a.startTime - b.startTime;
  });

  const workerCount = new Set(activeLogs.map((l) => l.userId)).size;
  const runningCount = activeLogs.filter(l => !l.pausedAt).length;
  const pausedCount = activeLogs.filter(l => !!l.pausedAt).length;

  // Check if currently in lunch window
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const inLunch = settings.autoLunchPauseEnabled && hhmm >= (settings.lunchStart || '12:00') && hhmm < (settings.lunchEnd || '12:30');

  return (
    <div className={`min-h-screen transition-all duration-500 ${dimMode ? 'bg-black' : 'bg-zinc-950'}`}>
      <div className="sticky top-0 z-30 bg-zinc-950/90 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={onBack} className="flex items-center gap-2 text-white/60 hover:text-white text-sm font-medium transition-colors">
            <ChevronLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back</span>
          </button>
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-red-500 animate-pulse" />
            <span className="text-white font-black text-sm tracking-wide">LIVE FLOOR</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setDimMode(!dimMode)}
              className={`p-2 rounded-lg transition-colors ${dimMode ? 'bg-blue-500/20 text-blue-400' : 'bg-white/5 text-white/40 hover:text-white'}`}
              title={dimMode ? 'Normal brightness' : 'Dim mode'}>
              {dimMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={() => setCompact(!compact)}
              className={`p-2 rounded-lg transition-colors ${compact ? 'bg-white/10 text-white' : 'bg-white/5 text-white/40 hover:text-white'}`}
              title={compact ? 'Expanded view' : 'Compact view'}>
              {compact ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
            </button>
            <button onClick={() => {
              if (document.fullscreenElement) { document.exitFullscreen(); }
              else { document.documentElement.requestFullscreen().catch(() => {}); }
            }}
              className="p-2 rounded-lg transition-colors bg-white/5 text-white/40 hover:text-white hover:bg-blue-500/20"
              title="Toggle fullscreen (TV mode)">
              <Smartphone className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Company header (configurable) */}
        {settings.tvCompanyHeader !== false && (settings.companyName || settings.companyLogo) && (
          <div className="flex items-center justify-center gap-3 px-4 py-2 border-b border-white/5">
            {settings.companyLogo && <img src={settings.companyLogo} alt="" className="h-6 object-contain" />}
            {settings.companyName && <span className="text-white font-bold text-sm tracking-wide">{settings.companyName}</span>}
          </div>
        )}

        {/* Live clock */}
        {settings.tvShowClock !== false && (() => {
          const [now, setNow] = React.useState(new Date());
          React.useEffect(() => { const i = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(i); }, []);
          return <div className="text-center py-1 text-white/40 text-xs font-mono tracking-widest">{now.toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit',second:'2-digit'})}</div>;
        })()}

        {/* Announcement banner */}
        {settings.tvAnnouncement && (
          <div className={`px-4 py-2 text-center text-sm font-bold ${(settings.tvAnnouncementColor || 'blue') === 'red' ? 'bg-red-500/20 text-red-300' : (settings.tvAnnouncementColor || 'blue') === 'yellow' ? 'bg-yellow-500/20 text-yellow-300' : (settings.tvAnnouncementColor || 'blue') === 'green' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-blue-500/20 text-blue-300'}`}>
            {settings.tvAnnouncement}
          </div>
        )}

        {/* Stats strip */}
        {settings.tvShowStats !== false && <div className="flex items-center justify-center gap-6 px-4 pb-3">
          <div className="flex items-center gap-2">
            <Users className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-white font-bold text-sm">{workerCount}</span>
            <span className="text-white/30 text-xs">worker{workerCount !== 1 ? 's' : ''}</span>
          </div>
          <div className="w-px h-4 bg-white/10" />
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-white font-bold text-sm">{runningCount}</span>
            <span className="text-white/30 text-xs">running</span>
          </div>
          {pausedCount > 0 && (
            <>
              <div className="w-px h-4 bg-white/10" />
              <div className="flex items-center gap-2">
                <Pause className="w-3.5 h-3.5 text-yellow-400" />
                <span className="text-yellow-400 font-bold text-sm">{pausedCount}</span>
                <span className="text-white/30 text-xs">paused</span>
              </div>
            </>
          )}
        </div>}

        {/* Auto-lunch banner */}
        {inLunch && (
          <div className="bg-yellow-500/10 border-t border-yellow-500/20 px-4 py-2 text-center">
            <span className="text-yellow-400 text-xs font-black uppercase tracking-wider">LUNCH BREAK — Timers auto-paused</span>
          </div>
        )}
      </div>

      <div className={`p-4 ${compact ? 'max-w-2xl' : 'max-w-3xl'} mx-auto`}>
        {activeLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-24 px-6">
            <div className="w-20 h-20 rounded-full bg-white/[0.03] flex items-center justify-center mb-6">
              <Clock className="w-10 h-10 text-white/10" />
            </div>
            <h2 className="text-white/60 font-bold text-xl mb-2">Floor is quiet</h2>
            <p className="text-white/20 text-sm max-w-xs">
              When workers start timers, their live activity will appear here in real-time.
            </p>
            <div className="mt-8 flex items-center gap-2 text-white/10 text-xs">
              <Radio className="w-3 h-3" />
              Listening for activity...
            </div>
          </div>
        ) : compact ? (
          <div className="rounded-2xl border border-white/5 overflow-hidden bg-white/[0.01]">
            {sorted.map((log) => (
              <WorkerCard key={log.id} log={log} job={getJob(log.jobId)} compact isAdmin={isAdmin} tvSettings={settings}
                onForceStop={isAdmin ? handleForceStop : undefined}
                onPause={isAdmin ? handlePause : undefined}
                onResume={isAdmin ? handleResume : undefined} />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {sorted.map((log) => (
              <WorkerCard key={log.id} log={log} job={getJob(log.jobId)} compact={false} isAdmin={isAdmin} tvSettings={settings}
                onForceStop={isAdmin ? handleForceStop : undefined}
                onPause={isAdmin ? handlePause : undefined}
                onResume={isAdmin ? handleResume : undefined} />
            ))}
          </div>
        )}
      </div>

      {activeLogs.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 h-1">
          <div className="h-full bg-gradient-to-r from-transparent via-blue-500/50 to-transparent animate-pulse" />
        </div>
      )}
    </div>
  );
};

export default LiveFloorMonitor;
