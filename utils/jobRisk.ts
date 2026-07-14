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
 *            exposure, or a description that flags critical work. Owner or the
 *            most qualified senior person controls it.
 *
 * Familiarity is per worker AND transfers across related work:
 *   exact    — this worker has run THIS part (expert at 3+ runs / 3+ hours)
 *   family   — they've run a SIBLING part number ("0077426-01" when the job
 *              is "0077426-00"; "MS21904W12" when the job is "MS21904W10")
 *   ops      — they've done the OPERATIONS this job needs on other parts
 *              ("ground flashlines on 12 different jobs")
 *   new      — none of the above
 * The point: don't hover over people who effectively already know the work.
 *
 * Pure functions — no React, no Firebase. The admin can override the auto
 * tier on any job (job.riskOverride) because some judgments — flight-critical,
 * unclear edge-break callouts — only a human can make.
 */

import type { Job, TimeLog, ReworkEntry } from '../types';

export type RiskTier = 'green' | 'yellow' | 'red';

/** One worker's history with a part (or part family). */
export interface WorkerPartExperience {
  userId: string;
  userName: string;
  /** Distinct jobs the worker has logged completed time on. */
  runs: number;
  minutes: number;
  lastWorkedMs: number;
  /** True when the experience comes from sibling parts, not this exact part. */
  viaSimilar?: boolean;
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
  /** Everyone who has ever logged real completed time on this part. */
  workers: Map<string, WorkerPartExperience>;
}

/** Aggregated history for a family of sibling part numbers. */
export interface FamilyStats {
  key: string;
  /** Display part numbers in the family, most recently seen first (cap 8). */
  parts: string[];
  completedJobIds: Set<string>;
  reworkCount: number;
  recentReworkCount: number;
  workers: Map<string, WorkerPartExperience>;
}

/** One worker's history with one operation (across all parts). */
export interface OpExperience {
  op: string;          // display casing
  jobs: number;        // distinct jobs where they ran this op
  minutes: number;
}

export interface RiskIndex {
  parts: Map<string, PartRiskStats>;
  families: Map<string, FamilyStats>;
  /** userId → normalized op → experience. */
  ops: Map<string, Map<string, OpExperience>>;
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

export type FamiliarityLevel = 'expert' | 'familiar' | 'family' | 'ops' | 'new';

export interface Familiarity {
  level: FamiliarityLevel;
  runs: number;              // exact-part runs
  minutes: number;
  lastWorkedMs: number;
  /** family level: sibling-part runs + which parts (display, cap 3). */
  familyRuns?: number;
  familyParts?: string[];
  /** ops level: the matched operations they know, biggest first (cap 3). */
  knownOps?: OpExperience[];
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
const normOp = (op?: string): string => (op || '').trim().toLowerCase();
const logMins = (l: TimeLog): number =>
  l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0);
const jobValue = (j: Job): number =>
  (j.quoteAmount || 0) > 0 ? j.quoteAmount! : ((j.pricePerPart || 0) > 0 ? j.pricePerPart! * (j.quantity || 0) : 0);

/**
 * Family key for "slightly different" part numbers — dash numbers, revision
 * suffixes, size digits:
 *   "0077426-00" / "0077426-01"  → "0077426"
 *   "MS21904W10" / "MS21904W12"  → "ms21904w"
 *   "ABC-123-A"  / "ABC-123-B"   → "abc123"
 * Guarded: the stem must keep ≥4 characters, otherwise the part stands alone
 * ("P-100" does NOT join a family with "P-200").
 */
export function partFamilyKey(pn?: string): string {
  const raw = normPart(pn);
  if (!raw) return '';
  const norm = raw.replace(/[^a-z0-9]/g, '');
  // Separator form: drop a short trailing segment (dash number / rev letter).
  const segs = raw.split(/[^a-z0-9]+/).filter(Boolean);
  if (segs.length >= 2) {
    const last = segs[segs.length - 1];
    const stem = segs.slice(0, -1).join('');
    if (last.length <= 3 && stem.length >= 4) return stem;
  }
  // No separator: strip a trailing digit run when a letter-bearing stem remains
  // (size variants like MS21904W10 → ms21904w).
  const m = norm.match(/^(.*[a-z])(\d{1,3})$/);
  if (m && m[1].length >= 4) return m[1];
  return norm;
}

/**
 * Criticality scan of the job's own text. Strong words mean someone wrote
 * "this one matters" — trust them and go red. Soft words mean extra care.
 * Sparse descriptions ("deburr complete") match nothing and change nothing.
 */
const STRONG_CRIT = /\b(flight|aircraft|aerospace|critical|first\s*article|fai)\b/i;
const SOFT_CRIT = /\b(no\s+scratch\w*|scratch[-\s]?free|do\s+not\s+scratch|cosmetic|class\s*a|tight\s+tolerance\w*|mirror\s+finish|fragile)\b/i;
export function scanCriticality(job: Job): { level: 'strong' | 'soft'; match: string } | null {
  const text = `${job.info || ''} ${job.specialInstructions || ''}`;
  const strong = text.match(STRONG_CRIT);
  if (strong) return { level: 'strong', match: strong[0].trim() };
  const soft = text.match(SOFT_CRIT);
  if (soft) return { level: 'soft', match: soft[0].trim() };
  return null;
}

type MutableExp = WorkerPartExperience & { _jobs: Set<string> };
const touchWorker = (map: Map<string, WorkerPartExperience>, l: TimeLog, end: number): void => {
  let w = map.get(l.userId) as MutableExp | undefined;
  if (!w) {
    w = { userId: l.userId, userName: l.userName || '', runs: 0, minutes: 0, lastWorkedMs: 0, _jobs: new Set() };
    map.set(l.userId, w);
  }
  if (l.jobId && !w._jobs.has(l.jobId)) { w._jobs.add(l.jobId); w.runs++; }
  w.minutes += logMins(l);
  // Freshest display name = the name on the NEWEST log (input order varies).
  if (l.userName && end >= w.lastWorkedMs) w.userName = l.userName;
  w.lastWorkedMs = Math.max(w.lastWorkedMs, end);
};

/**
 * Build the history index once per data change; O(jobs + logs + rework).
 * Logs without a partNumber resolve through their job. Sample logs and
 * still-running sessions excluded.
 */
export function buildPartRiskIndex(
  jobs: Job[],
  logs: TimeLog[],
  rework: ReworkEntry[],
  now: number = Date.now(),
): RiskIndex {
  const parts = new Map<string, PartRiskStats>();
  const families = new Map<string, FamilyStats>();
  const ops = new Map<string, Map<string, OpExperience>>();

  const getPart = (pn: string): PartRiskStats => {
    let s = parts.get(pn);
    if (!s) {
      s = {
        part: pn, completedJobIds: new Set(), lastCompletedMs: 0, maxQtyCompleted: 0,
        reworkCount: 0, recentReworkCount: 0, lastReworkMs: 0, workers: new Map(),
      };
      parts.set(pn, s);
    }
    return s;
  };
  const getFamily = (fk: string): FamilyStats => {
    let f = families.get(fk);
    if (!f) {
      f = { key: fk, parts: [], completedJobIds: new Set(), reworkCount: 0, recentReworkCount: 0, workers: new Map() };
      families.set(fk, f);
    }
    return f;
  };

  const jobPart = new Map<string, string>();       // jobId → normalized part
  const partDisplay = new Map<string, string>();   // normalized → latest display casing
  const famSeen = new Map<string, Map<string, number>>(); // famKey → pn → last seen ts
  for (const j of jobs) {
    const pn = normPart(j.partNumber);
    if (!pn) continue;
    jobPart.set(j.id, pn);
    partDisplay.set(pn, j.partNumber!.trim());
    const fk = partFamilyKey(pn);
    const seen = famSeen.get(fk) || new Map();
    seen.set(pn, Math.max(seen.get(pn) || 0, j.createdAt || 0));
    famSeen.set(fk, seen);
    if (j.status === 'completed' && j.completedAt) {
      const s = getPart(pn);
      s.completedJobIds.add(j.id);
      s.lastCompletedMs = Math.max(s.lastCompletedMs, j.completedAt);
      s.maxQtyCompleted = Math.max(s.maxQtyCompleted, j.quantity || 0);
      getFamily(fk).completedJobIds.add(j.id);
    }
  }
  famSeen.forEach((seen, fk) => {
    getFamily(fk).parts = [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([pn]) => partDisplay.get(pn) || pn);
  });

  for (const l of logs) {
    // Completed sessions only — a worker clocking in on their FIRST run of a
    // part shouldn't flip to "you've run this before" mid-run, and it keeps
    // worker/admin views (which filter logs differently) in agreement.
    if (l.isSample || !l.endTime) continue;
    const end = l.endTime;
    // Operation experience — transfers across parts ("knows flashlines").
    const ok = normOp(l.operation);
    if (ok) {
      let m = ops.get(l.userId);
      if (!m) { m = new Map(); ops.set(l.userId, m); }
      let e = m.get(ok) as (OpExperience & { _jobs: Set<string> }) | undefined;
      if (!e) { e = { op: l.operation.trim(), jobs: 0, minutes: 0, _jobs: new Set() }; m.set(ok, e); }
      if (l.jobId && !e._jobs.has(l.jobId)) { e._jobs.add(l.jobId); e.jobs++; }
      e.minutes += logMins(l);
    }
    const pn = normPart(l.partNumber) || jobPart.get(l.jobId) || '';
    if (!pn) continue;
    touchWorker(getPart(pn).workers, l, end);
    touchWorker(getFamily(partFamilyKey(pn)).workers, l, end);
  }
  // Strip the private _jobs sets so results are plain data.
  parts.forEach(s => s.workers.forEach(w => { delete (w as any)._jobs; }));
  families.forEach(f => f.workers.forEach(w => { delete (w as any)._jobs; }));
  ops.forEach(m => m.forEach(e => { delete (e as any)._jobs; }));

  const recentCutoff = now - 120 * DAY;
  for (const r of rework) {
    const pn = normPart(r.partNumber) || (r.jobId ? jobPart.get(r.jobId) || '' : '');
    if (!pn) continue;
    const s = getPart(pn);
    const f = getFamily(partFamilyKey(pn));
    s.reworkCount++; f.reworkCount++;
    s.lastReworkMs = Math.max(s.lastReworkMs, r.createdAt || 0);
    if ((r.createdAt || 0) >= recentCutoff) { s.recentReworkCount++; f.recentReworkCount++; }
  }

  return { parts, families, ops };
}

const GUIDANCE: Record<RiskTier, string> = {
  green: 'Run it — owner reviews results, not every motion.',
  yellow: 'First-piece approval before running the lot.',
  red: 'Owner or senior hands only — do not start without them.',
};

/**
 * Classify one job. Self-excluding: a completed job doesn't count itself as
 * its own "previous run", and its own rework still counts (it happened on
 * this very run — highly relevant). Sibling-part history softens first-run
 * severity ("new size of a proven family") and shares quality warnings.
 */
export function computeJobRisk(
  job: Job,
  index: RiskIndex,
  opts: RiskOptions = {},
): JobRisk {
  const highValue = opts.highValue ?? 1500;
  const veryHighValue = opts.veryHighValue ?? 5000;
  const staleDays = opts.staleDays ?? 180;
  const now = opts.now ?? Date.now();

  const pn = normPart(job.partNumber);
  const s = pn ? index.parts.get(pn) : undefined;
  const fam = pn ? index.families.get(partFamilyKey(pn)) : undefined;
  const prevRuns = s ? s.completedJobIds.size - (s.completedJobIds.has(job.id) ? 1 : 0) : 0;
  const famRuns = fam ? fam.completedJobIds.size - (fam.completedJobIds.has(job.id) ? 1 : 0) : 0;
  const siblingRuns = Math.max(0, famRuns - prevRuns);       // runs of OTHER parts in the family
  const famProven = siblingRuns >= 2 && (fam?.recentReworkCount || 0) === 0;
  const famSiblings = (fam?.parts || []).filter(p => normPart(p) !== pn).slice(0, 3);
  const value = jobValue(job);

  const reasons: string[] = [];
  let auto: RiskTier;

  const hasQualityHistory = !!s && (s.recentReworkCount > 0 || s.reworkCount >= 2);
  const isFirstRun = prevRuns === 0;
  const famNote = famSiblings.length
    ? ` (shop has run similar: ${famSiblings.join(', ')})`
    : '';

  if (hasQualityHistory) {
    auto = 'red';
    reasons.push(
      s!.recentReworkCount > 0
        ? `Rework recorded on this part in the last 4 months (${s!.reworkCount} total)`
        : `${s!.reworkCount} rework entries on this part's history`,
    );
  } else if (isFirstRun && value >= highValue && !famProven) {
    auto = 'red';
    reasons.push(`Brand-new part with $${Math.round(value).toLocaleString()} on the line`);
  } else if (isFirstRun && job.priority === 'urgent' && !famProven) {
    auto = 'red';
    reasons.push('New part on a rush — no proven process yet');
  } else if (isFirstRun) {
    auto = 'yellow';
    reasons.push(
      famProven
        ? `New variant of a proven family — ${siblingRuns} clean runs on siblings${famNote}`
        : `First time running this part — no history yet${famNote}`,
    );
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

  // A recent quality problem on a SIBLING part warns this one too.
  if (auto === 'green' && (fam?.recentReworkCount || 0) > 0 && (s?.recentReworkCount || 0) === 0) {
    auto = 'yellow';
    reasons.unshift('Recent rework on a similar part — same concept, double-check the spec');
  }

  // Big money never runs unsupervised, even with history.
  if (value >= veryHighValue && auto === 'green') {
    auto = 'yellow';
    reasons.unshift(`$${Math.round(value).toLocaleString()} job — big exposure even on a proven part`);
  }

  // The description outranks history: someone wrote "this one matters."
  const crit = scanCriticality(job);
  if (crit) {
    if (crit.level === 'strong') {
      if (auto !== 'red') reasons.unshift(`Description says “${crit.match}” — treated as critical`);
      else reasons.push(`Description also says “${crit.match}”`);
      auto = 'red';
    } else if (auto === 'green') {
      auto = 'yellow';
      reasons.unshift(`Description says “${crit.match}” — extra care`);
    } else {
      reasons.push(`Description says “${crit.match}”`);
    }
  }

  const override = job.riskOverride;
  const overridden = override === 'green' || override === 'yellow' || override === 'red';
  const tier = overridden ? override! : auto;
  if (overridden) {
    reasons.unshift(job.riskNote ? `Set by admin: ${job.riskNote}` : 'Tier set manually by admin');
  }

  return { tier, autoTier: auto, overridden, reasons, guidance: GUIDANCE[tier] };
}

/**
 * How well does THIS worker know THIS work? Checks the exact part first,
 * then sibling parts, then the operations the job needs (pass `jobOps` —
 * e.g. the ops actually used on this job/part before, or checklist labels).
 */
export function workerFamiliarity(
  partNumber: string | undefined,
  index: RiskIndex,
  userId: string,
  jobOps: string[] = [],
): Familiarity {
  const pn = normPart(partNumber);
  const w = index.parts.get(pn)?.workers.get(userId);
  if (w && (w.runs > 0 || w.minutes > 0)) {
    const level: FamiliarityLevel = w.runs >= 3 || w.minutes >= 180 ? 'expert' : 'familiar';
    return { level, runs: w.runs, minutes: w.minutes, lastWorkedMs: w.lastWorkedMs };
  }

  // Sibling parts — "slightly different part number, same concept."
  const fam = index.families.get(partFamilyKey(pn));
  const fw = fam?.workers.get(userId);
  if (fw && fw.runs > 0) {
    return {
      level: 'family', runs: 0, minutes: fw.minutes, lastWorkedMs: fw.lastWorkedMs,
      familyRuns: fw.runs,
      familyParts: (fam!.parts || []).filter(p => normPart(p) !== pn).slice(0, 3),
    };
  }

  // Operations they know from other parts — "flashlines are flashlines."
  if (jobOps.length) {
    const mine = index.ops.get(userId);
    if (mine) {
      const matched = jobOps
        .map(op => mine.get(normOp(op)))
        .filter((e): e is OpExperience => !!e && e.jobs > 0)
        .sort((a, b) => b.jobs - a.jobs);
      const totalJobs = matched.reduce((a, e) => a + e.jobs, 0);
      if (totalJobs >= 2) {
        return { level: 'ops', runs: 0, minutes: 0, lastWorkedMs: 0, knownOps: matched.slice(0, 3) };
      }
    }
  }

  return { level: 'new', runs: 0, minutes: 0, lastWorkedMs: 0 };
}

/**
 * Who should a newcomer ask? The part's most experienced workers, most runs
 * first (minutes break ties), excluding the asker. Falls back to sibling-part
 * veterans (marked viaSimilar) when nobody has run this exact part.
 */
export function partVeterans(
  partNumber: string | undefined,
  index: RiskIndex,
  excludeUserId?: string,
  limit = 3,
): WorkerPartExperience[] {
  const pn = normPart(partNumber);
  const rank = (list: Iterable<WorkerPartExperience>) =>
    [...list]
      .filter(w => w.userId !== excludeUserId && (w.runs > 0 || w.minutes > 0))
      .sort((a, b) => b.runs - a.runs || b.minutes - a.minutes)
      .slice(0, limit);

  const exact = rank(index.parts.get(pn)?.workers.values() || []);
  if (exact.length > 0) return exact;

  const fam = index.families.get(partFamilyKey(pn));
  if (!fam) return [];
  return rank(fam.workers.values()).map(w => ({ ...w, viaSimilar: true }));
}

export const TIER_LABEL: Record<RiskTier, string> = { green: 'GREEN', yellow: 'YELLOW', red: 'RED' };
