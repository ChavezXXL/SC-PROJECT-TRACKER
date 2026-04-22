// ═════════════════════════════════════════════════════════════════════
// Shop-flow metrics.
//
// Given the current job list + stage definitions, compute everything
// the Shop Flow Map needs to render:
//
//   • Per-stage dwell time (how long jobs have been sitting there)
//   • Stuck count (jobs idle > 3 days)
//   • Throughput (jobs moved OUT of each stage in last 24h)
//   • Health score (green / yellow / red)
//   • Oldest job reference per stage
//
// Pure functions — no React, no DOM. Keeps the flow-map component thin
// and makes the math easy to reason about + unit test.
// ═════════════════════════════════════════════════════════════════════

import type { Job, JobStage, StageHistoryEntry } from '../types';
import { resolveJobStage } from './stageRouting';

const DAY_MS = 86_400_000;
const STUCK_THRESHOLD_MS = 3 * DAY_MS;       // jobs idle > 3 days are "stuck"
const OVERLOADED_JOB_COUNT = 8;              // > 8 jobs on one stage = pile-up

export type StageHealth = 'idle' | 'ok' | 'warn' | 'critical';

export interface StageMetrics {
  stageId: string;
  jobCount: number;
  /** Jobs that have been at this stage longer than STUCK_THRESHOLD_MS. */
  stuckCount: number;
  /** Average ms a job has been sitting at this stage. 0 when empty. */
  avgDwellMs: number;
  /** Longest-sitting job's dwell (for the warning tooltip). */
  oldestDwellMs: number;
  oldestJobId: string | null;
  /** Jobs that left this stage in the last 24h (measured from stageHistory). */
  throughput24h: number;
  health: StageHealth;
}

/**
 * When did this job arrive at its current stage?
 * Falls back to createdAt if stageHistory is missing.
 */
export function stageArrivalTime(job: Job): number {
  const history: StageHistoryEntry[] = job.stageHistory || [];
  if (!job.currentStage) return job.createdAt;
  // Walk history backwards for the most recent entry matching currentStage.
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].stageId === job.currentStage) return history[i].timestamp;
  }
  return job.createdAt;
}

/** Did this job leave `stageId` within the last `withinMs`? */
function leftStageWithin(job: Job, stageId: string, now: number, withinMs: number): boolean {
  const history = job.stageHistory || [];
  // Find an entry for stageId, then check if there's a LATER entry (meaning it left).
  let lastAtStageIdx = -1;
  for (let i = 0; i < history.length; i++) {
    if (history[i].stageId === stageId) lastAtStageIdx = i;
  }
  if (lastAtStageIdx < 0) return false;
  // If there's a subsequent entry, the job has left stageId.
  const nextEntry = history[lastAtStageIdx + 1];
  if (!nextEntry) return false;
  return now - nextEntry.timestamp <= withinMs;
}

/** Classify stage health based on job count + dwell + stuck ratio. */
function classifyHealth(jobCount: number, stuckCount: number, avgDwellMs: number): StageHealth {
  if (jobCount === 0) return 'idle';
  // Any stuck job is at least a warn
  if (stuckCount >= 2 || avgDwellMs > STUCK_THRESHOLD_MS * 1.5) return 'critical';
  if (stuckCount >= 1 || avgDwellMs > STUCK_THRESHOLD_MS || jobCount > OVERLOADED_JOB_COUNT) return 'warn';
  return 'ok';
}

/**
 * Build metrics for every stage in one pass.
 * Open jobs (status !== completed) contribute to jobCount + dwell.
 * All jobs (including completed) contribute to throughput.
 */
export function computeStageMetrics(jobs: Job[], stages: JobStage[], now: number = Date.now()): Map<string, StageMetrics> {
  const byStage = new Map<string, StageMetrics>();
  for (const stage of stages) {
    byStage.set(stage.id, {
      stageId: stage.id,
      jobCount: 0,
      stuckCount: 0,
      avgDwellMs: 0,
      oldestDwellMs: 0,
      oldestJobId: null,
      throughput24h: 0,
      health: 'idle',
    });
  }

  const dwellSums = new Map<string, number>();

  for (const job of jobs) {
    // Open-job dwell accounting — use the resolver so jobs created before
    // the stage system (no `currentStage` field) still count, mapped from
    // their legacy `status`.
    if (job.status !== 'completed') {
      const effectiveStage = resolveJobStage(job, stages);
      if (effectiveStage && byStage.has(effectiveStage.id)) {
        const m = byStage.get(effectiveStage.id)!;
        const dwell = Math.max(0, now - stageArrivalTime(job));
        m.jobCount++;
        dwellSums.set(effectiveStage.id, (dwellSums.get(effectiveStage.id) || 0) + dwell);
        if (dwell > STUCK_THRESHOLD_MS) m.stuckCount++;
        if (dwell > m.oldestDwellMs) {
          m.oldestDwellMs = dwell;
          m.oldestJobId = job.id;
        }
      }
    }

    // Throughput — walk stageHistory once per job
    const history = job.stageHistory || [];
    for (let i = 0; i < history.length - 1; i++) {
      const entry = history[i];
      const next = history[i + 1];
      // Job left entry.stageId at next.timestamp
      if (byStage.has(entry.stageId) && now - next.timestamp <= DAY_MS) {
        byStage.get(entry.stageId)!.throughput24h++;
      }
    }
  }

  // Finalize averages + health
  for (const [stageId, m] of byStage) {
    if (m.jobCount > 0) {
      m.avgDwellMs = (dwellSums.get(stageId) || 0) / m.jobCount;
    }
    m.health = classifyHealth(m.jobCount, m.stuckCount, m.avgDwellMs);
  }

  return byStage;
}

/** Human-readable dwell time — "2d 4h", "5h", "12m". */
export function formatDwell(ms: number): string {
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours - days * 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

/** Tailwind classes for each health state — applied to the stage node border/ring. */
export function healthClasses(h: StageHealth): { border: string; ring: string; dot: string; text: string } {
  switch (h) {
    case 'critical': return { border: 'border-red-500/60',     ring: 'shadow-red-500/40',      dot: 'bg-red-500',      text: 'text-red-400' };
    case 'warn':     return { border: 'border-yellow-500/60',  ring: 'shadow-yellow-500/40',   dot: 'bg-yellow-500',   text: 'text-yellow-400' };
    case 'ok':       return { border: 'border-emerald-500/50', ring: 'shadow-emerald-500/30',  dot: 'bg-emerald-500',  text: 'text-emerald-400' };
    case 'idle':     return { border: 'border-white/5',         ring: '',                       dot: 'bg-zinc-700',     text: 'text-zinc-500' };
  }
}

export const FLOW_CONSTANTS = {
  DAY_MS,
  STUCK_THRESHOLD_MS,
  OVERLOADED_JOB_COUNT,
};
