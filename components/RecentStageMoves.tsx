// ═════════════════════════════════════════════════════════════════════
// Recent Stage Moves — live feed of who moved what job to where.
//
// Mines each job's stageHistory for the most recent transitions across
// the whole shop. Rendered as a horizontal ticker beneath the Flow Map
// so an operator glancing at the dashboard sees the last ~N moves at once.
//
// When a job has never been moved (no stageHistory), it's silently
// skipped — we don't want to pollute the feed with stale creations.
// ═════════════════════════════════════════════════════════════════════

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Clock } from 'lucide-react';
import type { Job, JobStage } from '../types';
import { formatDwell } from '../utils/flowMetrics';

interface Props {
  jobs: Job[];
  stages: JobStage[];
  /** Cap rendered entries — default 8 so it fits on one line. */
  limit?: number;
}

interface Move {
  jobId: string;
  poNumber: string;
  partNumber: string;
  userName?: string;
  fromStage?: JobStage;
  toStage: JobStage;
  timestamp: number;
}

export const RecentStageMoves: React.FC<Props> = ({ jobs, stages, limit = 8 }) => {
  const moves = useMemo<Move[]>(() => {
    const out: Move[] = [];
    const stageById = new Map<string, JobStage>(stages.map(s => [s.id, s] as const));
    for (const job of jobs) {
      const history = job.stageHistory || [];
      for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1];
        const curr = history[i];
        const toStage = stageById.get(curr.stageId);
        if (!toStage) continue;
        out.push({
          jobId: job.id,
          poNumber: job.poNumber,
          partNumber: job.partNumber,
          userName: curr.userName,
          fromStage: stageById.get(prev.stageId),
          toStage,
          timestamp: curr.timestamp,
        });
      }
    }
    // Newest first
    out.sort((a, b) => b.timestamp - a.timestamp);
    return out.slice(0, limit);
  }, [jobs, stages, limit]);

  // Live tick so "2m ago" → "3m ago" updates without navigation.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (moves.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-white/5">
      <div className="flex items-center gap-2 mb-1.5">
        <Clock className="w-3 h-3 text-zinc-500" aria-hidden="true" />
        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Recent moves</p>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {moves.map((m, i) => {
          const ago = now - m.timestamp;
          const isRecent = ago < 60 * 60 * 1000; // < 1h
          return (
            <div
              key={`${m.jobId}-${m.timestamp}-${i}`}
              className={`shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-lg border ${isRecent ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-white/[0.02] border-white/5'}`}
              title={`${m.userName || 'Someone'} moved PO ${m.poNumber} to ${m.toStage.label} ${formatDwell(ago)} ago`}
            >
              <span className="text-[10px] font-black text-white tabular">{m.poNumber}</span>
              {m.fromStage && (
                <>
                  <span className="text-[10px] font-semibold truncate max-w-[70px]" style={{ color: m.fromStage.color }}>
                    {m.fromStage.label}
                  </span>
                  <ArrowRight className="w-2.5 h-2.5 text-zinc-600 shrink-0" aria-hidden="true" />
                </>
              )}
              <span className="text-[10px] font-black truncate max-w-[80px]" style={{ color: m.toStage.color }}>
                {m.toStage.label}
              </span>
              {m.userName && (
                <span className="text-[9px] text-zinc-500 font-semibold truncate max-w-[70px] border-l border-white/10 pl-1.5">
                  {m.userName.split(' ')[0]}
                </span>
              )}
              <span className={`text-[9px] font-mono tabular shrink-0 ${isRecent ? 'text-emerald-400' : 'text-zinc-600'}`}>
                {formatDwell(ago)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
