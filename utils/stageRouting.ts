// ═════════════════════════════════════════════════════════════════════
// Smart stage routing — when a worker clocks in on an operation, figure
// out which workflow stage that operation belongs to and auto-advance
// the job.
//
// Match priority (most → least confident):
//   1) Explicit mapping on the stage (`stage.operations` array)
//   2) Exact label match, case-insensitive, post-normalize
//   3) Stemmed exact match — "packing" == "pack" ("pack-" common root)
//   4) Token overlap — any word of the operation matches any word of the
//      stage label after stemming. Catches "QC Inspection" → "QC" even
//      with tiny 2-char labels.
//   5) Containment — op contains label, or vice versa (≥3 chars)
//
// If nothing matches, returns null and the caller should leave the job
// where it is — we never move a job to a stage we're not confident about.
// ═════════════════════════════════════════════════════════════════════

import type { Job, JobStage, CustomerContact } from '../types';

/**
 * Filter a stage list down to the subset that applies to a given customer.
 * Shops often have one customer requiring extra steps (e.g. only Boeing
 * needs "Stamp") — setting `customStageIds` on that customer lets them run
 * a custom pipeline while everyone else stays on the default.
 *
 * Rules:
 *   • customStageIds empty / unset → return all stages unchanged
 *   • A stage marked `isComplete` is ALWAYS kept (jobs need a terminus)
 *   • Order preserved from the original stages list
 */
export function stagesForCustomer(
  stages: JobStage[],
  customer: CustomerContact | undefined,
): JobStage[] {
  const allowed = customer?.customStageIds;
  if (!allowed || allowed.length === 0) return stages;
  return stages.filter(s => allowed.includes(s.id) || s.isComplete);
}

/** Normalize for comparison — strip punctuation, lowercase, collapse whitespace. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Strip common English suffixes so "packing", "packed", "packs" all stem to "pack". */
function stem(word: string): string {
  if (word.length <= 3) return word;
  for (const suffix of ['ing', 'ed', 'es', 's']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

/** Split and stem — "Packing Parts" → ["pack", "part"]. */
function tokens(s: string): string[] {
  return norm(s).split(' ').filter(Boolean).map(stem);
}

/**
 * Given an operation string and the shop's stage list, return the stage
 * that this operation should map to — or null if no confident match.
 */
export function findStageForOperation(operation: string, stages: JobStage[]): JobStage | null {
  if (!operation || stages.length === 0) return null;
  const op = norm(operation);
  const opTokens = tokens(operation);

  // 1. Explicit operations mapping on a stage — highest confidence.
  for (const stage of stages) {
    if (stage.operations && stage.operations.some(o => norm(o) === op)) return stage;
  }

  // 2. Exact label match (operation "Deburring" → stage labeled "Deburring").
  for (const stage of stages) {
    if (norm(stage.label) === op) return stage;
  }

  // 3. Stemmed exact match — "pack" ↔ "packing" ↔ "packed".
  for (const stage of stages) {
    const labelTokens = tokens(stage.label);
    if (labelTokens.length === 1 && opTokens.length === 1 && labelTokens[0] === opTokens[0]) return stage;
  }

  // 4. Token overlap — any stemmed word of op matches any stemmed word of label.
  //    This is what turns "QC Inspection" → "QC Check" and "Pack & Ship" → "Shipping".
  //    Skip 1-char tokens ("a", "i") and common noise ("and", "the").
  const NOISE = new Set(['and', 'the', 'of', 'for', 'to', 'in', 'on']);
  for (const stage of stages) {
    const labelTokens = tokens(stage.label).filter(t => t.length >= 2 && !NOISE.has(t));
    const opRealTokens = opTokens.filter(t => t.length >= 2 && !NOISE.has(t));
    if (labelTokens.some(lt => opRealTokens.some(ot => ot === lt))) return stage;
  }

  // 5. Substring containment — final fallback. 3-char minimum to avoid
  //    "Pre-polish" matching "Shipping" because both have "ip".
  for (const stage of stages) {
    const lbl = norm(stage.label);
    if (lbl.length >= 3 && (op.includes(lbl) || lbl.includes(op))) return stage;
  }

  return null;
}

/**
 * Determine if we should auto-route the job.
 * Returns true only when the candidate stage is different from the current
 * stage and not a "completed" stage (never auto-complete on clock-in).
 */
export function shouldAutoRoute(job: Job, candidate: JobStage): boolean {
  if (!candidate) return false;
  if (candidate.isComplete) return false;
  if (job.currentStage === candidate.id) return false;
  return true;
}

/**
 * Resolve a job to its effective stage — single source of truth.
 *
 * Priority:
 *   1. Explicit `job.currentStage` pointing at an existing stage
 *   2. Legacy `job.status` mapped to a same-named stage (old jobs pre-dating
 *      the stage system land here — without this, they'd disappear from the
 *      Flow Map and Kanban)
 *   3. First non-complete stage (safe default for a brand-new job)
 */
export function resolveJobStage(job: Job, stages: JobStage[]): JobStage | null {
  if (stages.length === 0) return null;
  if (job.currentStage) {
    const found = stages.find(s => s.id === job.currentStage);
    if (found) return found;
  }
  const legacyMap: Record<string, string> = {
    'pending': 'pending',
    'in-progress': 'in-progress',
    'completed': 'completed',
    'hold': 'pending',
  };
  const mappedId = legacyMap[job.status] || 'in-progress';
  const mapped = stages.find(s => s.id === mappedId);
  if (mapped) return mapped;
  // Fall back to first open stage — never "Completed" for an open job
  return stages.find(s => !s.isComplete) || stages[0];
}
