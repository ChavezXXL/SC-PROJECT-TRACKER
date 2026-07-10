/**
 * JobTimeline — "the story of a job" in one scroll.
 * Merges every time log, stage move, and note for a single job into one
 * chronological feed, with the part photo, who did what, and the totals
 * (hours, workers, profit, on-time). Pure presentational modal — feed it a
 * job + its logs and it renders. No data fetching, no side effects.
 */
import React, { useMemo, useState } from 'react';
import {
  X, Play, GitBranch, MessageSquare, CheckCircle, Package, Calendar,
  Timer, Users, DollarSign, Plus, ArrowUpDown,
} from 'lucide-react';
import type { Job, TimeLog, JobStage } from '../types';
import { formatDuration } from '../utils/date';

const logMins = (l: TimeLog): number =>
  l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0);

const dueNum = (due?: string): number => {
  const m = (due || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? (+m[3]) * 10000 + (+m[1]) * 100 + (+m[2]) : 0;
};
const msYmd = (ms: number): number => {
  const d = new Date(ms);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
};

type Ev =
  | { ts: number; kind: 'created' }
  | { ts: number; kind: 'log'; log: TimeLog }
  | { ts: number; kind: 'stage'; label: string; color: string; who?: string }
  | { ts: number; kind: 'note'; who: string; text: string }
  | { ts: number; kind: 'complete' };

export const JobTimeline = ({ job, logs, stages, onClose }: {
  job: Job; logs: TimeLog[]; stages: JobStage[]; onClose: () => void;
}) => {
  const [newestFirst, setNewestFirst] = useState(true);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const stageById = useMemo(() => new Map(stages.map(s => [s.id, s])), [stages]);

  const jobLogs = useMemo(() => logs.filter(l => l.jobId === job.id && !l.isSample), [logs, job.id]);

  const stats = useMemo(() => {
    const totalMins = jobLogs.reduce((a, l) => a + logMins(l), 0);
    const workers = new Set(jobLogs.map(l => l.userName).filter(Boolean));
    const running = jobLogs.filter(l => !l.endTime).length;
    let onTime: boolean | null = null;
    if (job.completedAt && dueNum(job.dueDate) > 0) onTime = msYmd(job.completedAt) <= dueNum(job.dueDate);
    return { totalMins, workers: workers.size, sessions: jobLogs.length, running, onTime };
  }, [jobLogs, job]);

  const feed = useMemo(() => {
    const ev: Ev[] = [];
    if (job.createdAt) ev.push({ ts: job.createdAt, kind: 'created' });
    for (const l of jobLogs) ev.push({ ts: l.startTime, kind: 'log', log: l });
    for (const s of (job.stageHistory || [])) {
      const st = stageById.get(s.stageId);
      ev.push({ ts: s.timestamp, kind: 'stage', label: st?.label || s.stageId, color: st?.color || '#71717a', who: s.userName });
    }
    for (const n of (job.jobNotes || [])) ev.push({ ts: n.timestamp, kind: 'note', who: n.userName, text: n.text });
    if (job.completedAt) ev.push({ ts: job.completedAt, kind: 'complete' });
    ev.sort((a, b) => newestFirst ? b.ts - a.ts : a.ts - b.ts);
    return ev;
  }, [job, jobLogs, stageById, newestFirst]);

  const when = (ts: number) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const partPhoto = job.partImage || jobLogs.find(l => l.partImage)?.partImage;

  const Stat = ({ icon, label, value, tone = 'text-white' }: { icon: React.ReactNode; label: string; value: string; tone?: string }) => (
    <div className="bg-zinc-950/50 border border-white/5 rounded-xl px-3 py-2">
      <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-1">{icon}{label}</p>
      <p className={`text-base font-black mt-0.5 ${tone}`}>{value}</p>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-white/10 w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col" style={{ maxHeight: 'calc(100dvh - 1.5rem)' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-4 border-b border-white/10 flex items-start gap-3 bg-zinc-800/40 sticky top-0 rounded-t-2xl">
          {partPhoto ? (
            <button onClick={() => setLightbox(partPhoto!)} className="w-16 h-16 rounded-xl overflow-hidden border border-white/10 hover:border-cyan-400/60 shrink-0" title="View part photo">
              <img src={partPhoto} alt="" className="w-full h-full object-cover" />
            </button>
          ) : (
            <div className="w-16 h-16 rounded-xl bg-zinc-800 border border-white/10 flex items-center justify-center shrink-0"><Package className="w-7 h-7 text-zinc-600" /></div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-black text-white truncate">{job.poNumber || job.jobIdsDisplay}</h2>
              {job.completedAt
                ? <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full uppercase">Complete</span>
                : <span className="text-[10px] font-black text-orange-400 bg-orange-500/10 border border-orange-500/30 px-2 py-0.5 rounded-full uppercase">In Production</span>}
            </div>
            <p className="text-xs text-zinc-500 mt-0.5 truncate">{job.partNumber}{job.customer ? ` · ${job.customer}` : ''}{job.quantity ? ` · ${job.quantity} pcs` : ''}</p>
            {job.dueDate && <p className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-1"><Calendar className="w-3 h-3" /> Due {job.dueDate}</p>}
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5 shrink-0"><X className="w-5 h-5 text-zinc-500 hover:text-white" /></button>
        </div>

        {/* Stats */}
        <div className="p-4 grid grid-cols-3 sm:grid-cols-5 gap-2 border-b border-white/5">
          <Stat icon={<Timer className="w-3 h-3" />} label="Total time" value={formatDuration(stats.totalMins)} tone="text-blue-300" />
          <Stat icon={<Play className="w-3 h-3" />} label="Sessions" value={`${stats.sessions}`} />
          <Stat icon={<Users className="w-3 h-3" />} label="Workers" value={`${stats.workers}`} />
          {job.profitSnapshot
            ? <Stat icon={<DollarSign className="w-3 h-3" />} label="Profit" value={`$${Math.round(job.profitSnapshot.profit).toLocaleString()}`} tone={job.profitSnapshot.profit >= 0 ? 'text-emerald-300' : 'text-red-300'} />
            : <Stat icon={<DollarSign className="w-3 h-3" />} label="Quote" value={job.quoteAmount ? `$${Math.round(job.quoteAmount).toLocaleString()}` : '—'} />}
          {stats.onTime !== null
            ? <Stat icon={<CheckCircle className="w-3 h-3" />} label="Delivery" value={stats.onTime ? 'On time' : 'Late'} tone={stats.onTime ? 'text-emerald-300' : 'text-red-300'} />
            : <Stat icon={<CheckCircle className="w-3 h-3" />} label="Status" value={stats.running > 0 ? 'Running' : 'Open'} tone={stats.running > 0 ? 'text-emerald-300' : 'text-zinc-400'} />}
        </div>

        {/* Timeline feed */}
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Timeline</p>
          <button onClick={() => setNewestFirst(v => !v)} className="text-[10px] font-bold text-zinc-400 hover:text-white flex items-center gap-1"><ArrowUpDown className="w-3 h-3" /> {newestFirst ? 'Newest first' : 'Oldest first'}</button>
        </div>
        <div className="overflow-y-auto flex-1 px-4 pb-4">
          {feed.length === 0 && <p className="text-center text-zinc-600 text-sm py-8">No activity recorded yet.</p>}
          <div className="relative pl-6">
            <div className="absolute left-[9px] top-1 bottom-1 w-px bg-white/10" />
            {feed.map((e, i) => {
              let dot = '#71717a', icon = <Play className="w-3 h-3 text-white" />, title: React.ReactNode = '', sub: React.ReactNode = null;
              if (e.kind === 'created') { dot = '#3b82f6'; icon = <Plus className="w-3 h-3 text-white" />; title = 'Job created'; }
              else if (e.kind === 'complete') { dot = '#10b981'; icon = <CheckCircle className="w-3 h-3 text-white" />; title = 'Job completed'; }
              else if (e.kind === 'stage') { dot = e.color; icon = <GitBranch className="w-3 h-3 text-white" />; title = <>Moved to <span className="font-bold" style={{ color: e.color }}>{e.label}</span></>; sub = e.who ? `by ${e.who}` : null; }
              else if (e.kind === 'note') { dot = '#f59e0b'; icon = <MessageSquare className="w-3 h-3 text-white" />; title = <span className="text-amber-200">{e.text}</span>; sub = e.who; }
              else if (e.kind === 'log') {
                const l = e.log; const dur = logMins(l);
                dot = l.endTime ? '#3b82f6' : '#10b981';
                icon = <Play className="w-3 h-3 text-white" />;
                title = <><span className="font-bold text-white">{l.userName}</span> · {l.operation}</>;
                sub = <>{l.endTime ? formatDuration(dur) : <span className="text-emerald-400 font-bold">running</span>}{l.notes ? ` · 📝 ${l.notes}` : ''}</>;
              }
              return (
                <div key={i} className="relative pb-4 last:pb-1">
                  <span className="absolute -left-6 top-0.5 w-[18px] h-[18px] rounded-full flex items-center justify-center ring-4 ring-zinc-900" style={{ background: dot }}>{icon}</span>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm text-zinc-200 min-w-0">{title}</p>
                    <span className="text-[10px] text-zinc-600 shrink-0 tabular-nums">{when(e.ts)}</span>
                  </div>
                  {sub && <p className="text-[11px] text-zinc-500 truncate">{sub}</p>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-[230] bg-black/90 flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); setLightbox(null); }}>
          <img src={lightbox} alt="Part" className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      )}
    </div>
  );
};

export default JobTimeline;
