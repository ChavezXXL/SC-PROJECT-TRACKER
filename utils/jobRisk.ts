/**
 * jobRisk.ts — Green / Yellow / Red job classification + per-worker familiarity.
 * ─────────────────────────────────────────────────────────────────────────
 * The owner's control system, computed from data the shop already records:
 *
 *   GREEN  — repeat part, proven process, no quality problems. Workers run it;
 *            the owner reviews results, not every motion.
 *   YELLOW — new quantity, unfamiliar/revised work, long gap since last run.
 *            Run after setup / first-piece approval.
 *   RED    — brand-new difficult parts, rejection history, high dollar
 *            exposure. Owner or the most qualified senior person controls it.
 *
 * Plus the personal layer: the same part can be green FOR VICTOR (ran it 4
 * times) and new FOR JOSE (never touched it) — familiarity is per worker,
 * derived from that worker's own time logs on the part.
 *
 * Pure functions — no React, no Firebase. The admin can override the auto
 * tier on any job (job.riskOverride) because some judgments — flight-critical,
 * unclear edge-break callouts — only a human can make.
 */

import type { Job, TimeLog, ReworkEntry } from '../types';

export type RiskTier = 'green' | 'yellow' | 'red';

/** One worker's history with a part. */
export interface WorkerPartExperience {
  userId: string;
  userName: string;
  /** Distinct jobs of this part the worker has logged time on. */
  runs: number;
  minutes: number;
  lastWorkedMs: number;
}

export interface PartRiskStats {
  /** Normalized (trim+lowercase) part number. */
  part: string;
  /** Completed jobs of this part, all time. */
  completedJobIds: Set<string>;
  lastCompletedMs: number;
  /** Largest quantity ever completed. */
  maxQtyCompleted: number;
  /** Rework/scrap entries recorded against this part. */
  reworkCount: number;
  /** Rework in the last 120 days. */
  recentReworkCount: number;
  lastReworkMs: number;
  /** Everyone who has ever logged real time on this part. */
  workers: Map<string, WorkerPartExperience>;
}

export interface JobRisk {
  tier: RiskTier;
  /** What the data says, before any manual override. */
  autoTier: RiskTier;
  overridden: boolean;
  /** Plain-English reasons, most important first. */
  reasons: string[];
  /** What the tier means operationally — one line for the floor. */
  guidance: string;
}

export type FamiliarityLevel = 'expert' | 'familiar' | 'new';

export interface Familiarity {
  level: FamiliarityLevel;
  runs: number;
  minutes: number;
  lastWorkedMs: number;
}

export interface RiskOptions {
  /** First-run jobs at/above this $ are red (default $1,500). */
  highValue?: number;
  /** Any job at/above this $ can never be green (default $5,000). */
  veryHighValue?: number;
  /** Days without a run before a proven part drops to yellow (default 180). */
  staleDays?: number;
  now?: number;
}

const DAY = 86400000;
const normPart = (pn?: string): string => (pn || '').trim().toLowerCase();
const logMins = (l: TimeLog): number =>
  l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0);
const jobValue = (j: Job): number =>
  (j.quoteAmount || 0) > 0 ? j.quoteAmount! : ((j.pricePerPart || 0) > 0 ? j.pricePerPart! * (j.quantity || 0) : 0);

/**
 * Build the per-part history index once per data change; O(jobs + logs + rework).
 * Logs without a partNumber resolve through their job. Sample logs excluded.
 */
export function buildPartRiskIndex(
  jobs: Job[],
  logs: TimeLog[],
  rework: ReworkEntry[],
  now: number = Date.now(),
): Map<string, PartRiskStats> {
  const index = new Map<string, PartRiskStats>();
  const get = (pn: string): PartRiskStats => {
    let s = index.get(pn);
    if (!s) {
      s = {
        part: pn, completedJobIds: new Set(), lastCompletedMs: 0, maxQtyCompleted: 0,
        reworkCount: 0, recentReworkCount: 0, lastReworkMs: 0, workers: new Map(),
      };
      index.set(pn, s);
    }
    return s;
  };

  const jobPart = new Map<string, string>();   // jobId → normalized part
  for (const j of jobs) {
    const pn = normPart(j.partNumber);
    if (!pn) continue;
    jobPart.set(j.id, pn);
    if (j.status === 'completed' && j.completedAt) {
      const s = get(pn);
      s.completedJobIds.add(j.id);
      s.lastCompletedMs = Math.max(s.lastCompletedMs, j.completedAt);
      s.maxQtyCompleted = Math.max(s.maxQtyCompleted, j.quantity || 0);
    }
  }

  for (const l of logs) {
    // Completed sessions only — a worker clocking in on their FIRST run of a
    // part shouldn't flip to "you've run this before" mid-run, and it keeps
    // worker/admin views (which filter logs differently) in agreement.
    if (l.isSample || !l.endTime) continue;
    const pn = normPart(l.partNumber) || jobPart.get(l.jobId) || '';
    if (!pn) continue;
    const s = get(pn);
    let w = s.workers.get(l.userId);
    if (!w) {
      w = { userId: l.userId, userName: l.userName || '', runs: 0, minutes: 0, lastWorkedMs: 0, _jobs: new Set() } as any;
      s.workers.set(l.userId, w!);
    }
    const wj: Set<string> = (w as any)._jobs;
    if (l.jobId && !wj.has(l.jobId)) { wj.add(l.jobId); w.runs++; }
    w.minutes += logMins(l);
    const end = l.endTime;
    // Freshest display name = the name on the NEWEST log (input order varies).
    if (l.userName && end >= w.lastWorkedMs) w.userName = l.userName;
    w.lastWorkedMs = Math.max(w.lastWorkedMs, end);
  }
  // Strip the private _jobs sets so the result is plain data.
  index.forEach(s => s.workers.forEach(w => { delete (w as any)._jobs; }));

  const recentCutoff = now - 120 * DAY;
  for (const r of rework) {
    const pn = normPart(r.partNumber) || (r.jobId ? jobPart.get(r.jobId) || '' : '');
    if (!pn) continue;
    const s = get(pn);
    s.reworkCount++;
    s.lastReworkMs = Math.max(s.lastReworkMs, r.createdAt || 0);
    if ((r.createdAt || 0) >= recentCutoff) s.recentReworkCount++;
  }

  return index;
}

const GUIDANCE: Record<RiskTier, string> = {
  green: 'Run it — owner reviews results, not every motion.',
  yellow: 'First-piece approval before running the lot.',
  red: 'Owner or senior hands only — do not start without them.',
};

/**
 * Classify one job. Self-excluding: a completed job doesn't count itself as
 * its own "previous run", and its own rework still counts (it happened on
 * this very run — highly relevant).
 */
export function computeJobRisk(
  job: Job,
  index: Map<string, PartRiskStats>,
  opts: RiskOptions = {},
): JobRisk {
  const highValue = opts.highValue ?? 1500;
  const veryHighValue = opts.veryHighValue ?? 5000;
  const staleDays = opts.staleDays ?? 180;
  const now = opts.now ?? Date.now();

  const pn = normPart(job.partNumber);
  const s = pn ? index.get(pn) : undefined;
  const prevRuns = s ? s.completedJobIds.size - (s.completedJobIds.has(job.id) ? 1 : 0) : 0;
  const value = jobValue(job);

  const reasons: string[] = [];
  let auto: RiskTier;

  const hasQualityHistory = !!s && (s.recentReworkCount > 0 || s.reworkCount >= 2);
  const isFirstRun = prevRuns === 0;

  if (hasQualityHistory) {
    auto = 'red';
    reasons.push(
      s!.recentReworkCount > 0
        ? `Rework recorded on this part in the last 4 months (${s!.reworkCount} total)`
        : `${s!.reworkCount} rework entries on this part's history`,
    );
  } else if (isFirstRun && value >= highValue) {
    auto = 'red';
    reasons.push(`Brand-new part with $${Math.round(value).toLocaleString()} on the line`);
  } else if (isFirstRun && job.priority === 'urgent') {
    auto = 'red';
    reasons.push('New part on a rush — no proven process yet');
  } else if (isFirstRun) {
    auto = 'yellow';
    reasons.push('First time running this part — no history yet');
  } else {
    // Has clean history — start green, degrade to yellow on soft flags.
    auto = 'green';
    const hadOldRework = !!s && s.reworkCount === 1 && s.recentReworkCount === 0;
    reasons.push(`Repeat part — ${prevRuns} completed run${prevRuns > 1 ? 's' : ''}${hadOldRework ? '' : ', no quality problems'}`);

    if (s && s.maxQtyCompleted > 0 && (job.quantity || 0) > 2 * s.maxQtyCompleted) {
      auto = 'yellow';
      reasons.unshift(`Quantity jump: ${(job.quantity || 0).toLocaleString()} pcs vs biggest past run of ${s.maxQtyCompleted.toLocaleString()}`);
    }
    if (s && s.lastCompletedMs > 0 && now - s.lastCompletedMs > staleDays * DAY) {
      auto = 'yellow';
      const months = Math.round((now - s.lastCompletedMs) / (30 * DAY));
      reasons.unshift(`Hasn't run in ~${months} months — refresh the process before full speed`);
    }
    if (hadOldRework) {
      auto = 'yellow';
      reasons.unshift('One past quality issue on record — double-check the spec');
    }
  }

  // Big money never runs unsupervised, even with history.
  if (value >= veryHighValue && auto === 'green') {
    auto = 'yellow';
    reasons.unshift(`$${Math.round(value).toLocaleString()} job — big exposure even on a proven part`);
  }

  const override = job.riskOverride;
  const overridden = override === 'green' || override === 'yellow' || override === 'red';
  const tier = overridden ? override! : auto;
  if (overridden) {
    reasons.unshift(job.riskNote ? `Set by admin: ${job.riskNote}` : 'Tier set manually by admin');
  }

  return { tier, autoTier: auto, overridden, reasons, guidance: GUIDANCE[tier] };
}

/** How well does THIS worker know THIS part? */
export function workerFamiliarity(
  partNumber: string | undefined,
  index: Map<string, PartRiskStats>,
  userId: string,
): Familiarity {
  const s = index.get(normPart(partNumber));
  const w = s?.workers.get(userId);
  if (!w || (w.runs === 0 && w.minutes <= 0)) return { level: 'new', runs: 0, minutes: 0, lastWorkedMs: 0 };
  const level: FamiliarityLevel = w.runs >= 3 || w.minutes >= 180 ? 'expert' : 'familiar';
  return { level, runs: w.runs, minutes: w.minutes, lastWorkedMs: w.lastWorkedMs };
}

/**
 * Who should a newcomer ask? The part's most experienced workers,
 * most runs first (minutes break ties), excluding the asker.
 */
export function partVeterans(
  partNumber: string | undefined,
  index: Map<string, PartRiskStats>,
  excludeUserId?: string,
  limit = 3,
): WorkerPartExperience[] {
  const s = index.get(normPart(partNumber));
  if (!s) return [];
  return [...s.workers.values()]
    .filter(w => w.userId !== excludeUserId && (w.runs > 0 || w.minutes > 0))
    .sort((a, b) => b.runs - a.runs || b.minutes - a.minutes)
    .slice(0, limit);
}

export const TIER_LABEL: Record<RiskTier, string> = { green: 'GREEN', yellow: 'YELLOW', red: 'RED' };
