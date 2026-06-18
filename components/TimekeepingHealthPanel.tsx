// Timekeeping Health panel — the brain's dashboard face.
// Reads live time data + the cron heartbeat and calls out every problem.
import React, { useState, useEffect, useMemo } from 'react';
import { ShieldCheck, ShieldAlert, ChevronDown, ChevronUp, Activity } from 'lucide-react';
import type { Job, TimeLog, User, SystemSettings } from '../types';
import { computeTimekeepingHealth, type HealthSeverity } from '../utils/timekeepingHealth';
import * as DB from '../services/mockDb';

const SEV: Record<HealthSeverity, { dot: string; text: string; bg: string; border: string; label: string }> = {
  critical: { dot: 'bg-red-500',    text: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/30',    label: 'Critical' },
  warning:  { dot: 'bg-amber-500',  text: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/25',  label: 'Warning'  },
  info:     { dot: 'bg-blue-500',   text: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20',   label: 'Heads-up' },
};

export const TimekeepingHealthPanel: React.FC<{
  logs: TimeLog[];
  jobs: Job[];
  users: User[];
  settings: SystemSettings;
  onView?: () => void;   // jump to Logs
}> = ({ logs, jobs, users, settings, onView }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [cronLastRunMs, setCronLastRunMs] = useState<number | null | undefined>(undefined);

  // Poll the cron heartbeat every 2 min so a dead 24/7 engine surfaces fast.
  useEffect(() => {
    let alive = true;
    const load = () => DB.getCronHeartbeatMs().then(v => { if (alive) setCronLastRunMs(v); }).catch(() => {});
    load();
    const id = setInterval(load, 120000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const health = useMemo(
    () => computeTimekeepingHealth({ logs, jobs, users, settings, cronLastRunMs: cronLastRunMs ?? null }),
    [logs, jobs, users, settings, cronLastRunMs],
  );

  const { issues, criticalCount, warningCount, infoCount } = health;
  const allClear = issues.length === 0;

  return (
    <div className={`rounded-2xl border overflow-hidden ${allClear ? 'bg-emerald-500/[0.06] border-emerald-500/20' : 'bg-zinc-900/50 border-white/5'}`}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${allClear ? 'bg-emerald-500/15 border border-emerald-500/30' : 'bg-red-500/10 border border-red-500/25'}`}>
            {allClear
              ? <ShieldCheck className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              : <ShieldAlert className="w-4 h-4 text-red-400" aria-hidden="true" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-black text-white tracking-tight flex items-center gap-2">
              Timekeeping Health
              {health.cronAlive === true && (
                <span title="24/7 auto clock-out engine is running" className="flex items-center gap-1 text-[9px] font-bold text-emerald-400">
                  <Activity className="w-3 h-3" aria-hidden="true" /> live
                </span>
              )}
            </p>
            <p className="text-[11px] text-zinc-500 truncate">
              {allClear
                ? `All clear · ${health.checkedLogs} records checked`
                : [
                    criticalCount ? `${criticalCount} critical` : '',
                    warningCount ? `${warningCount} warning${warningCount > 1 ? 's' : ''}` : '',
                    infoCount ? `${infoCount} heads-up` : '',
                  ].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onView && !allClear && (
            <button onClick={onView} className="text-[11px] font-bold text-zinc-400 hover:text-white transition-colors">Open Logs</button>
          )}
          {!allClear && (
            <button onClick={() => setCollapsed(v => !v)} className="text-zinc-500 hover:text-zinc-300 p-1" title={collapsed ? 'Show' : 'Hide'}>
              {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Issues */}
      {!allClear && !collapsed && (
        <div className="px-3 pb-3 space-y-2">
          {issues.map(issue => {
            const c = SEV[issue.severity];
            return (
              <div key={issue.id} className={`rounded-xl border p-3 ${c.bg} ${c.border}`}>
                <div className="flex items-start gap-2.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${c.dot} ${issue.severity === 'critical' ? 'animate-pulse' : ''}`} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[8px] font-black uppercase tracking-widest ${c.text}`}>{c.label}</span>
                      <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-wider">{issue.category}</span>
                    </div>
                    <p className="text-[12px] font-bold text-white leading-snug mt-0.5">{issue.title}</p>
                    <p className="text-[11px] text-zinc-400 leading-relaxed mt-0.5">{issue.detail}</p>
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

export default TimekeepingHealthPanel;
