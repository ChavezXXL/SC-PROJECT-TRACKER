// ═════════════════════════════════════════════════════════════════════
// Shop Flow Map — horizontal visual of jobs moving through the shop.
//
// Each stage renders as a "station" node:
//   • Count of open jobs + health status (green / yellow / red)
//   • Avg dwell time — how long jobs have been sitting there
//   • Pulsing ring when workers are actively clocked in on its operations
//   • Stuck-job indicator (pile-up / idle too long)
//   • Throughput badge on the arrow — jobs moved OUT in the last 24h
//
// Expand a stage to see the jobs currently queued, sorted by dwell time
// (oldest first) so the operator knows what to pull next.
//
// Responsive + TV-safe: scrolls horizontally on narrow screens, scales
// with clamp() on wide ones. Never clips content on a 720p display.
// ═════════════════════════════════════════════════════════════════════

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Users, Clock, AlertTriangle, TrendingUp, Flame, ArrowRight } from 'lucide-react';
import type { Job, JobStage, TimeLog } from '../types';
import { findStageForOperation, resolveJobStage } from '../utils/stageRouting';
import { computeStageMetrics, formatDwell, healthClasses, stageArrivalTime } from '../utils/flowMetrics';

interface Props {
  jobs: Job[];
  stages: JobStage[];
  activeLogs: TimeLog[];
  /** Called when user taps a stage node and NO drill-down is available
   *  (e.g. read-only TV mode). When omitted, expand-in-place UI is shown. */
  onStageSelect?: (stageId: string) => void;
  /** Called when user taps a specific job row in the drill-down drawer.
   *  When omitted, rows are read-only. */
  onJobSelect?: (jobId: string) => void;
  /** Smaller/denser rendering for TV mode — hides the expand drawer. */
  compact?: boolean;
}

export const ShopFlowMap: React.FC<Props> = ({ jobs, stages, activeLogs, onStageSelect, onJobSelect, compact = false }) => {
  const [expandedStageId, setExpandedStageId] = useState<string | null>(null);

  // Live clock — bump every 30s so dwell times, stuck flags, and health
  // colors re-evaluate even when the job list itself isn't changing. Without
  // this, a job that's been sitting at a stage for 2d 23h 59m never updates
  // to "3d stuck" until the user navigates away and back.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // ── Metrics (open job count, dwell, throughput, health) ──
  // `nowTick` is a dep so the memo recomputes with the current time each tick.
  const metrics = useMemo(() => computeStageMetrics(jobs, stages, nowTick), [jobs, stages, nowTick]);
  const openJobs = useMemo(() => jobs.filter(j => j.status !== 'completed'), [jobs]);

  // Jobs grouped by stage id (open only). Uses resolveJobStage so legacy
  // jobs without a `currentStage` field still land in the right column —
  // previously they were dumped into "Pending" or vanished entirely.
  const byStage = useMemo(() => {
    const m = new Map<string, Job[]>();
    for (const stage of stages) m.set(stage.id, []);
    for (const job of openJobs) {
      const resolved = resolveJobStage(job, stages);
      if (!resolved) continue;
      const list = m.get(resolved.id);
      if (list) list.push(job);
    }
    // Sort each list by dwell (oldest first — that's what needs attention)
    for (const list of m.values()) {
      list.sort((a, b) => stageArrivalTime(a) - stageArrivalTime(b));
    }
    return m;
  }, [openJobs, stages]);

  // Active workers per stage — driven by smart operation → stage routing
  const workersByStage = useMemo(() => {
    const m = new Map<string, { name: string; initials: string; operation: string }[]>();
    for (const stage of stages) m.set(stage.id, []);
    for (const log of activeLogs) {
      const target = findStageForOperation(log.operation, stages);
      if (!target) continue;
      const list = m.get(target.id);
      if (!list) continue;
      const initials = log.userName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
      list.push({ name: log.userName, initials, operation: log.operation });
    }
    return m;
  }, [activeLogs, stages]);

  const visibleStages = stages.filter(s => !s.isComplete);

  const nodeSize = compact ? 'w-16 h-16' : 'w-20 h-20 sm:w-24 sm:h-24';
  const labelSize = compact ? 'text-[9px]' : 'text-[10px] sm:text-xs';
  const countSize = compact ? 'text-xl' : 'text-2xl sm:text-3xl';

  const handleNodeClick = (stageId: string) => {
    if (onStageSelect) return onStageSelect(stageId);
    if (compact) return; // no drill-down in TV mode
    setExpandedStageId(prev => prev === stageId ? null : stageId);
  };

  // ── Top-line totals shown in the footer strip ──
  const totalOpen = openJobs.length;
  const totalStuck = [...metrics.values()].reduce((a, m) => a + m.stuckCount, 0);
  const total24hMoves = [...metrics.values()].reduce((a, m) => a + m.throughput24h, 0);
  const criticalStages = [...metrics.values()].filter(m => m.health === 'critical').length;

  return (
    <div className="w-full">
      {/* ─── Stage row ─── */}
      <div className="w-full overflow-x-auto">
        <div className="flex items-start gap-1 sm:gap-2 min-w-max px-2 py-3">
          {visibleStages.map((stage, i) => {
            const stageJobs = byStage.get(stage.id) || [];
            const workers = workersByStage.get(stage.id) || [];
            const m = metrics.get(stage.id);
            const isActive = workers.length > 0;
            const isExpanded = expandedStageId === stage.id;
            const h = healthClasses(m?.health || 'idle');
            const hasStuck = (m?.stuckCount || 0) > 0;
            // Find between-stage throughput — jobs that moved FROM this stage to the NEXT one
            const nextStage = visibleStages[i + 1];
            const handoff = m?.throughput24h || 0;

            return (
              <React.Fragment key={stage.id}>
                <div className="flex flex-col items-center gap-1 w-20 sm:w-24 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleNodeClick(stage.id)}
                    aria-label={`${stage.label}: ${stageJobs.length} jobs${workers.length ? `, ${workers.length} working` : ''}${hasStuck ? `, ${m!.stuckCount} stuck` : ''}`}
                    aria-expanded={!compact && !onStageSelect ? isExpanded : undefined}
                    className={`group relative flex flex-col items-center gap-1.5 transition-all ${(onStageSelect || !compact) ? 'cursor-pointer hover:scale-105 active:scale-95' : 'cursor-default'}`}
                  >
                    {/* Node circle — no overflow-hidden so the flame + WIP
                        badges can sit at the -top/-right corners like stickers.
                        The active pulse uses an `inset` box-shadow so it can't
                        overflow either way. */}
                    <div
                      className={`relative ${nodeSize} rounded-2xl border-2 flex flex-col items-center justify-center transition-all ${
                        isActive
                          ? `${h.border} shadow-lg ${h.ring}`
                          : stageJobs.length > 0
                          ? `${h.border} bg-white/[0.02]`
                          : 'bg-zinc-900/30 border-white/5 opacity-60'
                      } ${isExpanded ? 'ring-2 ring-white/30' : ''}`}
                      style={{
                        background: isActive ? `${stage.color}15` : undefined,
                        boxShadow: isActive ? `0 0 24px ${stage.color}40` : undefined,
                      }}
                    >
                      {/* Live pulse — contained inset glow, no overflow into adjacent nodes */}
                      {isActive && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-0 rounded-2xl pointer-events-none"
                          style={{
                            boxShadow: `inset 0 0 0 2px ${stage.color}`,
                            animation: 'flow-node-pulse 2.4s ease-in-out infinite',
                          }}
                        />
                      )}
                      {/* Stuck-job flame badge */}
                      {hasStuck && (
                        <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 border-2 border-zinc-950 flex items-center justify-center shadow-md shadow-red-900/50" title={`${m!.stuckCount} stuck job${m!.stuckCount !== 1 ? 's' : ''}`}>
                          <Flame className="w-2.5 h-2.5 text-white" aria-hidden="true" />
                        </span>
                      )}
                      {/* Overloaded pile-up badge (no stuck jobs but a lot of WIP) */}
                      {!hasStuck && stageJobs.length > 6 && (
                        <span className="absolute -top-1.5 -right-1.5 px-1.5 h-5 rounded-full bg-yellow-500 border-2 border-zinc-950 flex items-center justify-center shadow-md" title={`High WIP — ${stageJobs.length} jobs`}>
                          <AlertTriangle className="w-2.5 h-2.5 text-zinc-900" aria-hidden="true" />
                        </span>
                      )}
                      <span className={`${countSize} font-black tabular leading-none`} style={{ color: stage.color }}>
                        {stageJobs.length}
                      </span>
                      {workers.length > 0 && (
                        <div className="flex items-center gap-0.5 mt-0.5">
                          <Users className="w-2.5 h-2.5 text-white/70" aria-hidden="true" />
                          <span className="text-[9px] font-black text-white/70 tabular">{workers.length}</span>
                        </div>
                      )}
                    </div>

                    {/* Label below — constrained to parent width so text can
                        never overflow into the arrow gap between stages. */}
                    <div className="text-center w-full max-w-full overflow-hidden">
                      <p className={`${labelSize} font-black uppercase tracking-wider truncate`} style={{ color: isActive ? stage.color : 'rgb(161 161 170)' }}>
                        {stage.label}
                      </p>
                      {!compact && m && m.jobCount > 0 && (
                        <p className="text-[9px] text-white/40 font-semibold tabular truncate">
                          avg {formatDwell(m.avgDwellMs)}
                        </p>
                      )}
                      {workers.length > 0 && !compact && (
                        <p className="text-[9px] text-white/50 font-semibold truncate">
                          {workers.slice(0, 2).map(w => w.name.split(' ')[0]).join(', ')}
                          {workers.length > 2 && ` +${workers.length - 2}`}
                        </p>
                      )}
                    </div>
                  </button>
                </div>

                {/* Flow arrow + 24h handoff throughput badge */}
                {nextStage && (
                  <div className={`shrink-0 flex flex-col items-center ${compact ? 'mt-6' : 'mt-8 sm:mt-10'} gap-0.5`}>
                    <ChevronRight
                      className={`${compact ? 'w-3 h-3' : 'w-4 h-4 sm:w-5 sm:h-5'} text-white/20`}
                      aria-hidden="true"
                    />
                    {handoff > 0 && !compact && (
                      <span
                        className="text-[9px] font-black tabular bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
                        title={`${handoff} job${handoff !== 1 ? 's' : ''} moved out of ${stage.label} in the last 24h`}
                      >
                        <TrendingUp className="w-2 h-2" aria-hidden="true" /> {handoff}
                      </span>
                    )}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* ─── Expanded drill-down drawer (below the row) ─── */}
      {!compact && expandedStageId && !onStageSelect && (() => {
        const stage = stages.find(s => s.id === expandedStageId);
        if (!stage) return null;
        const list = byStage.get(expandedStageId) || [];
        const m = metrics.get(expandedStageId);
        const workers = workersByStage.get(expandedStageId) || [];
        return (
          <div className="mt-2 bg-zinc-950/60 border border-white/10 rounded-xl p-4 animate-fade-in">
            <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: stage.color, boxShadow: `0 0 8px ${stage.color}80` }} />
                <div className="min-w-0">
                  <p className="text-sm font-black text-white tracking-tight truncate">{stage.label}</p>
                  <p className="text-[10px] text-zinc-500">
                    {list.length} open · avg {m ? formatDwell(m.avgDwellMs) : '—'} dwell
                    {m && m.throughput24h > 0 && ` · ${m.throughput24h} moved out (24h)`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {workers.length > 0 && (
                  <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[10px] font-black text-emerald-300">
                      {workers.map(w => w.name.split(' ')[0]).join(', ')}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setExpandedStageId(null)}
                  className="text-[10px] text-zinc-500 hover:text-white transition-colors font-bold"
                >
                  Close
                </button>
              </div>
            </div>

            {list.length === 0 ? (
              <p className="text-xs text-zinc-600 italic py-4 text-center">No jobs at this stage.</p>
            ) : (
              <ul className="space-y-1 max-h-64 overflow-y-auto">
                {list.slice(0, 25).map(job => {
                  const dwell = nowTick - stageArrivalTime(job);
                  const isStuck = dwell > 3 * 86_400_000;
                  const rowClass = `flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${isStuck ? 'bg-red-500/10 border border-red-500/20' : 'bg-white/[0.02] hover:bg-white/5 border border-transparent'} ${onJobSelect ? 'cursor-pointer' : ''}`;
                  const inner = (
                    <>
                      {job.priority === 'urgent' && (
                        <span className="shrink-0 text-[9px] font-black text-red-400 bg-red-500/15 border border-red-500/25 px-1 py-0.5 rounded">URG</span>
                      )}
                      <span className="font-black text-white text-xs tabular shrink-0">{job.poNumber}</span>
                      <span className="text-[11px] text-zinc-400 truncate flex-1 text-left">{job.partNumber}</span>
                      {job.customer && (
                        <span className="text-[10px] text-zinc-500 truncate hidden sm:inline max-w-[120px]">{job.customer}</span>
                      )}
                      <span className={`text-[10px] font-mono tabular shrink-0 ${isStuck ? 'text-red-400 font-black' : 'text-zinc-500'}`} title={isStuck ? 'Idle at this stage for more than 3 days' : undefined}>
                        {isStuck && <Flame className="inline w-2.5 h-2.5 mr-0.5" aria-hidden="true" />}
                        {formatDwell(dwell)}
                      </span>
                    </>
                  );
                  return (
                    <li key={job.id} className="list-none">
                      {onJobSelect ? (
                        <button type="button" onClick={() => onJobSelect(job.id)} className={`${rowClass} w-full`}>{inner}</button>
                      ) : (
                        <div className={rowClass}>{inner}</div>
                      )}
                    </li>
                  );
                })}
                {list.length > 25 && (
                  <li className="text-[10px] text-zinc-600 italic text-center py-1">+{list.length - 25} more</li>
                )}
              </ul>
            )}
          </div>
        );
      })()}

      {/* ─── Footer stats strip ─── */}
      <div className="flex items-center gap-3 sm:gap-4 px-3 pt-2 border-t border-white/5 text-[10px] text-zinc-500 flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          {activeLogs.length} working
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="w-3 h-3" aria-hidden="true" />
          {totalOpen} open
        </span>
        {total24hMoves > 0 && (
          <span className="flex items-center gap-1.5 text-emerald-400/80">
            <ArrowRight className="w-3 h-3" aria-hidden="true" />
            {total24hMoves} moved in 24h
          </span>
        )}
        {totalStuck > 0 && (
          <span className="flex items-center gap-1.5 text-red-400/80 font-bold">
            <Flame className="w-3 h-3" aria-hidden="true" />
            {totalStuck} stuck
          </span>
        )}
        {criticalStages > 0 && (
          <span className="flex items-center gap-1.5 text-red-400/80 font-bold">
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
            {criticalStages} stage{criticalStages !== 1 ? 's' : ''} critical
          </span>
        )}
      </div>
    </div>
  );
};
