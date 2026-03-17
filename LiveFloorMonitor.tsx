import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Activity,
  Briefcase,
  ChevronLeft,
  Clock,
  Maximize2,
  Minimize2,
  Moon,
  Power,
  Radio,
  Smartphone,
  StopCircle,
  Sun,
  Users,
} from 'lucide-react';

import { Job, TimeLog } from './types';
import * as DB from './services/mockDb';

// ── LIVE TICKER ──────────────────────────────────────────────────
const LiveTicker = ({ startTime, size = 'lg' }: { startTime: number; size?: 'sm' | 'lg' | 'xl' }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startTime) return;
    const tick = () => setElapsed(Math.floor((Date.now() - startTime) / 1000));
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [startTime]);

  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');

  const sizeClasses = {
    sm: 'text-2xl',
    lg: 'text-5xl',
    xl: 'text-7xl',
  };

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

// ── ELAPSED BAR (visual progress indicator) ──────────────────────
const ElapsedBar = ({ startTime }: { startTime: number }) => {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    const tick = () => {
      const mins = (Date.now() - startTime) / 60000;
      // Visual bar: fills over 4 hours, then stays at 100%
      setPct(Math.min(100, (mins / 240) * 100));
    };
    tick();
    const i = setInterval(tick, 5000);
    return () => clearInterval(i);
  }, [startTime]);

  return (
    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-1000 ease-linear"
        style={{
          width: `${pct}%`,
          background: pct < 50
            ? 'linear-gradient(90deg, #3b82f6, #60a5fa)'
            : pct < 80
            ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
            : 'linear-gradient(90deg, #ef4444, #f87171)',
        }}
      />
    </div>
  );
};

// ── WORKER CARD ──────────────────────────────────────────────────
const WorkerCard = ({
  log,
  job,
  compact,
  onForceStop,
  isAdmin,
}: {
  log: TimeLog;
  job: Job | null;
  compact: boolean;
  onForceStop?: (logId: string) => void;
  isAdmin: boolean;
}) => {
  const initials = log.userName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const minsElapsed = Math.floor((Date.now() - log.startTime) / 60000);
  const isLong = minsElapsed > 240; // 4+ hours

  if (compact) {
    return (
      <div className={`flex items-center justify-between p-4 border-b border-white/5 ${isLong ? 'bg-red-500/5' : ''}`}>
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-black text-white/80">
              {initials}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-zinc-950 animate-pulse" />
          </div>
          <div className="min-w-0">
            <p className="text-white font-bold text-sm truncate">{log.userName}</p>
            <p className="text-white/40 text-xs truncate">
              {log.operation} {job ? `— ${job.poNumber}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LiveTicker startTime={log.startTime} size="sm" />
          {isAdmin && onForceStop && (
            <button
              onClick={() => onForceStop(log.id)}
              className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-colors"
            >
              <Power className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border overflow-hidden transition-all ${
      isLong
        ? 'border-red-500/30 bg-red-500/5 shadow-lg shadow-red-500/5'
        : 'border-white/5 bg-white/[0.02]'
    }`}>
      <div className="p-5">
        {/* Worker header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-base font-black text-white/80">
                {initials}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-zinc-950 animate-pulse" />
            </div>
            <div>
              <p className="text-white font-bold text-lg">{log.userName}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md">
                  {log.operation}
                </span>
                {isLong && (
                  <span className="text-[10px] font-black text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded animate-pulse">
                    {Math.floor(minsElapsed / 60)}h+
                  </span>
                )}
              </div>
            </div>
          </div>
          {isAdmin && onForceStop && (
            <button
              onClick={() => onForceStop(log.id)}
              className="p-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all"
              title="Force Stop"
            >
              <StopCircle className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Timer */}
        <div className="mb-4">
          <LiveTicker startTime={log.startTime} size="lg" />
        </div>

        {/* Elapsed bar */}
        <ElapsedBar startTime={log.startTime} />

        {/* Job info */}
        {job && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-white/30 uppercase font-bold tracking-widest">PO</p>
              <p className="text-white font-bold text-sm mt-0.5 truncate">{job.poNumber}</p>
            </div>
            <div>
              <p className="text-[10px] text-white/30 uppercase font-bold tracking-widest">Part</p>
              <p className="text-white/70 text-sm mt-0.5 truncate">{job.partNumber}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── MAIN COMPONENT ───────────────────────────────────────────────
interface LiveFloorMonitorProps {
  user: { id: string; name: string; role: string };
  onBack: () => void;
  addToast: (type: 'success' | 'error' | 'info', message: string) => void;
}

export const LiveFloorMonitor: React.FC<LiveFloorMonitorProps> = ({ user, onBack, addToast }) => {
  const [activeLogs, setActiveLogs] = useState<TimeLog[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [compact, setCompact] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [dimMode, setDimMode] = useState(false);
  const wakeLockRef = useRef<any>(null);
  const prevLogIdsRef = useRef<Set<string>>(new Set());

  const isAdmin = user.role === 'admin';

  // ── Subscribe to live data ──────────────────────────────────────
  useEffect(() => {
    const unsub1 = DB.subscribeActiveLogs(setActiveLogs);
    const unsub2 = DB.subscribeJobs(setJobs);
    return () => { unsub1(); unsub2(); };
  }, []);

  // ── Detect start/stop and fire push notifications ───────────────
  useEffect(() => {
    const currentIds = new Set(activeLogs.map((l) => l.id));
    const prevIds = prevLogIdsRef.current;

    // New timers started
    activeLogs.forEach((log) => {
      if (!prevIds.has(log.id)) {
        const job = jobs.find((j) => j.id === log.jobId);
        fireNotification(
          `${log.userName} started`,
          `${log.operation}${job ? ` — PO ${job.poNumber}` : ''}`,
          `start-${log.id}`
        );
      }
    });

    // Timers that stopped (were in prev but not in current)
    prevIds.forEach((id) => {
      if (!currentIds.has(id)) {
        fireNotification('Timer stopped', 'A worker finished their operation.', `stop-${id}`);
      }
    });

    prevLogIdsRef.current = currentIds;
  }, [activeLogs, jobs]);

  // ── Wake Lock (keep screen on like Strava) ─────────────────────
  const toggleWakeLock = useCallback(async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        setWakeLockActive(false);
        addToast('info', 'Screen lock released');
      } else if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        setWakeLockActive(true);
        addToast('success', 'Screen will stay on');

        wakeLockRef.current.addEventListener('release', () => {
          setWakeLockActive(false);
          wakeLockRef.current = null;
        });
      } else {
        addToast('error', 'Wake Lock not supported on this device');
      }
    } catch (err) {
      addToast('error', 'Could not control screen wake');
    }
  }, [addToast]);

  // Release wake lock on unmount
  useEffect(() => {
    return () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release();
      }
    };
  }, []);

  // Re-acquire wake lock when page becomes visible again (like Strava does)
  useEffect(() => {
    const reacquire = async () => {
      if (wakeLockActive && !wakeLockRef.current && 'wakeLock' in navigator) {
        try {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        } catch {}
      }
    };
    document.addEventListener('visibilitychange', reacquire);
    return () => document.removeEventListener('visibilitychange', reacquire);
  }, [wakeLockActive]);

  // ── Notification helper ─────────────────────────────────────────
  const fireNotification = (title: string, body: string, tag: string) => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'NOTIFY', title, body, tag });
      } else {
        new Notification(title, { body, tag, icon: '/icon-192.png' });
      }
    }
  };

  // ── Force stop ──────────────────────────────────────────────────
  const handleForceStop = async (logId: string) => {
    if (!confirm('Force stop this timer?')) return;
    try {
      await DB.stopTimeLog(logId);
      addToast('success', 'Timer stopped');
    } catch {
      addToast('error', 'Failed to stop timer');
    }
  };

  // ── Job lookup ──────────────────────────────────────────────────
  const getJob = (jobId: string) => jobs.find((j) => j.id === jobId) || null;

  // Sort: longest running first
  const sorted = [...activeLogs].sort((a, b) => a.startTime - b.startTime);
  const workerCount = new Set(activeLogs.map((l) => l.userId)).size;

  return (
    <div className={`min-h-screen transition-all duration-500 ${dimMode ? 'bg-black' : 'bg-zinc-950'}`}>
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-zinc-950/90 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-white/60 hover:text-white text-sm font-medium transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back</span>
          </button>

          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-red-500 animate-pulse" />
            <span className="text-white font-black text-sm tracking-wide">LIVE FLOOR</span>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Dim mode */}
            <button
              onClick={() => setDimMode(!dimMode)}
              className={`p-2 rounded-lg transition-colors ${dimMode ? 'bg-blue-500/20 text-blue-400' : 'bg-white/5 text-white/40 hover:text-white'}`}
              title={dimMode ? 'Normal brightness' : 'Dim mode'}
            >
              {dimMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {/* Wake lock */}
            <button
              onClick={toggleWakeLock}
              className={`p-2 rounded-lg transition-colors ${wakeLockActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-white/40 hover:text-white'}`}
              title={wakeLockActive ? 'Screen staying on (tap to disable)' : 'Keep screen on'}
            >
              <Smartphone className="w-4 h-4" />
            </button>

            {/* Compact toggle */}
            <button
              onClick={() => setCompact(!compact)}
              className={`p-2 rounded-lg transition-colors ${compact ? 'bg-white/10 text-white' : 'bg-white/5 text-white/40 hover:text-white'}`}
              title={compact ? 'Expanded view' : 'Compact view'}
            >
              {compact ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Stats strip */}
        <div className="flex items-center justify-center gap-6 px-4 pb-3">
          <div className="flex items-center gap-2">
            <Users className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-white font-bold text-sm">{workerCount}</span>
            <span className="text-white/30 text-xs">worker{workerCount !== 1 ? 's' : ''}</span>
          </div>
          <div className="w-px h-4 bg-white/10" />
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-white font-bold text-sm">{activeLogs.length}</span>
            <span className="text-white/30 text-xs">timer{activeLogs.length !== 1 ? 's' : ''}</span>
          </div>
          {wakeLockActive && (
            <>
              <div className="w-px h-4 bg-white/10" />
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-emerald-400 text-[10px] font-bold uppercase tracking-wider">Screen On</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────── */}
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
              <WorkerCard
                key={log.id}
                log={log}
                job={getJob(log.jobId)}
                compact
                isAdmin={isAdmin}
                onForceStop={isAdmin ? handleForceStop : undefined}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {sorted.map((log) => (
              <WorkerCard
                key={log.id}
                log={log}
                job={getJob(log.jobId)}
                compact={false}
                isAdmin={isAdmin}
                onForceStop={isAdmin ? handleForceStop : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Footer pulse ────────────────────────────────────────── */}
      {activeLogs.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 h-1">
          <div className="h-full bg-gradient-to-r from-transparent via-blue-500/50 to-transparent animate-pulse" />
        </div>
      )}
    </div>
  );
};

export default LiveFloorMonitor;
