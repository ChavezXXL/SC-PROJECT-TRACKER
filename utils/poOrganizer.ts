// utils/poOrganizer.ts
// ─────────────────────────────────────────────────────────────────────────────
// The "brain" for the Customer PO library. Pure functions only (no React, no
// Firebase) so they can be unit-tested and reused by a server cron.
//
// It does two jobs:
//   1. MATCH a customer PO photo to an existing job (PO# → part# → loose), and
//      report how strong the match is.
//   2. DERIVE the PO's real-world state: is the matched job still active or
//      already completed? has the PO been invoiced? is it ready to invoice?
//
// "Ready to invoice" = the matched job is DONE but you haven't marked the PO
// invoiced yet. That's the "I always forget to send invoices" catch.
// ─────────────────────────────────────────────────────────────────────────────

import type { CustomerPoFile, Job, JobStage, SystemSettings, PoInvoiceStatus } from '../types';

// Kept in sync with App.DEFAULT_STAGES — duplicated here so this module has no
// dependency on the React app entrypoint (which would be a circular import).
const DEFAULT_STAGES: JobStage[] = [
  { id: 'pending', label: 'Pending', color: '#71717a', order: 0 },
  { id: 'in-progress', label: 'In Progress', color: '#3b82f6', order: 1 },
  { id: 'qc', label: 'QC', color: '#f59e0b', order: 2 },
  { id: 'packing', label: 'Packing', color: '#8b5cf6', order: 3 },
  { id: 'shipped', label: 'Shipped', color: '#06b6d4', order: 4 },
  { id: 'completed', label: 'Completed', color: '#10b981', order: 5, isComplete: true },
];

/** Mirror of App.getStages — the configured pipeline or the default. */
export function resolveStages(settings?: SystemSettings | null): JobStage[] {
  const s = settings?.jobStages;
  return s && s.length > 0 ? [...s].sort((a, b) => a.order - b.order) : DEFAULT_STAGES;
}

/** Mirror of App.getJobStage's completion test — is this job DONE? */
export function isJobComplete(job: Job, stages: JobStage[]): boolean {
  if (job.currentStage) {
    const st = stages.find(s => s.id === job.currentStage);
    if (st) return !!st.isComplete;
  }
  // Legacy / fallback: explicit completed status or a completion timestamp.
  return job.status === 'completed' || !!job.completedAt;
}

// ── Matching ─────────────────────────────────────────────────────────────────

/** Aggressive normalize for fuzzy ID compare: keep only [a-z0-9]. */
export const normKey = (s?: string): string => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const stripZeros = (s: string): string => s.replace(/^0+/, '');

/**
 * Fold the letters Tesseract most often confuses with digits onto those digits,
 * so an OCR'd PO like "PO 1l42i3" still matches the job's real "114213". Applied
 * to an already-normalized (lowercase a-z0-9) key. Non-destructive — only used
 * for comparison, never stored.
 */
const ocrFold = (k: string): string =>
  k.replace(/[oq]/g, '0').replace(/[il]/g, '1').replace(/s/g, '5').replace(/b/g, '8').replace(/z/g, '2').replace(/g/g, '6');

export type PoMatchField = 'link' | 'po' | 'part';

export interface PoMatchResult {
  job?: Job;
  field?: PoMatchField;
  exact: boolean;       // true = confident (id/PO#/part# matched exactly)
}

/**
 * Find the job a PO belongs to. Order of confidence:
 *   1. Explicit stored linkedJobId (user/earlier match already decided)
 *   2. Exact normalized PO# match
 *   3. Loose PO# match (leading zeros / contained-within) — guarded by length
 *   4. Exact normalized part# match
 *   5. Loose part# match — guarded so short strings can't false-positive
 */
export function matchJobForPo(
  po: Pick<CustomerPoFile, 'poNumber' | 'partNumber' | 'linkedJobId'>,
  jobs: Job[],
): PoMatchResult {
  if (po.linkedJobId) {
    const j = jobs.find(j => j.id === po.linkedJobId);
    if (j) return { job: j, field: 'link', exact: true };
  }

  const pn = normKey(po.poNumber);
  const part = normKey(po.partNumber);

  if (pn) {
    let m = jobs.find(j => normKey(j.poNumber) === pn);
    if (m) return { job: m, field: 'po', exact: true };
    // OCR-tolerant match — fold confusable letters→digits so a slightly-misread
    // PO still finds its job (this is why a bad scan used to fall back to the
    // part number). Heavily guarded against collisions: the scanned PO must be
    // DIGIT-DOMINANT (so real word-like codes like "TAIL" never fold-match), the
    // job PO must be the SAME LENGTH and also digit-dominant, and the fold must
    // resolve to exactly ONE job (never link when it's ambiguous).
    const digitShare = (s: string) => s.replace(/[^0-9]/g, '').length / Math.max(1, s.length);
    if (pn.length >= 4 && digitShare(pn) >= 0.5) {
      const fpn = ocrFold(pn);
      const cands = jobs.filter(j => {
        const k = normKey(j.poNumber);
        return k.length === pn.length && digitShare(k) >= 0.5 && ocrFold(k) === fpn;
      });
      if (cands.length === 1) return { job: cands[0], field: 'po', exact: false };
    }
    // Loose match — guarded so short IDs can't substring-match the wrong job.
    if (pn.length >= 4) {
      const zpn = stripZeros(pn);
      m = jobs.find(j => {
        const k = normKey(j.poNumber);
        if (k.length < 4) return false;          // both sides must be substantial
        const zk = stripZeros(k);
        return (!!zpn && zpn === zk) || k.includes(pn) || pn.includes(k);
      });
      if (m) return { job: m, field: 'po', exact: false };
    }
  }

  if (part) {
    let m = jobs.find(j => normKey(j.partNumber) === part);
    if (m) return { job: m, field: 'part', exact: true };
    if (part.length >= 4) {
      m = jobs.find(j => {
        const k = normKey(j.partNumber);
        return k.length >= 4 && (k.includes(part) || part.includes(k));
      });
      if (m) return { job: m, field: 'part', exact: false };
    }
  }

  return { exact: false };
}

// ── Derived state (drives badges + filters + reminders) ──────────────────────

export type PoMatchState = 'completed' | 'active' | 'unmatched';

export interface PoDerived {
  matchState: PoMatchState;       // job done | job in-flight | no job in system
  job?: Job;
  matchField?: PoMatchField;
  exact: boolean;                 // confidence of the match
  invoiceStatus: PoInvoiceStatus; // normalized (unset → 'not-invoiced')
  readyToInvoice: boolean;        // job done & not yet invoiced/paid/n-a
  jobLabel?: string;              // human label of the matched job
  amount?: number;                // best-known $ value (invoiceAmount → job.quoteAmount → ppp×qty)
  completedAt?: number;           // matched job's completion timestamp (for aging)
}

/** Best-known dollar value for a PO: explicit invoice amount, else the job's quote. */
export function poAmount(po: CustomerPoFile, job?: Job): number | undefined {
  if (typeof po.invoiceAmount === 'number' && po.invoiceAmount > 0) return po.invoiceAmount;
  if (!job) return undefined;
  if (typeof job.quoteAmount === 'number' && job.quoteAmount > 0) return job.quoteAmount;
  // Only derive from unit price when there's a real quantity — otherwise return
  // undefined (a $0 would pollute "unbilled" totals), not 0.
  if (typeof job.pricePerPart === 'number' && job.pricePerPart > 0 && (job.quantity || 0) > 0) return job.pricePerPart * (job.quantity as number);
  return undefined;
}

export function derivePo(po: CustomerPoFile, jobs: Job[], stages: JobStage[]): PoDerived {
  const m = matchJobForPo(po, jobs);
  const invoiceStatus: PoInvoiceStatus = po.invoiceStatus || 'not-invoiced';

  let matchState: PoMatchState = 'unmatched';
  if (m.job) matchState = isJobComplete(m.job, stages) ? 'completed' : 'active';

  const readyToInvoice =
    matchState === 'completed' &&
    invoiceStatus !== 'invoiced' &&
    invoiceStatus !== 'paid' &&
    invoiceStatus !== 'not-applicable';

  return {
    matchState,
    job: m.job,
    matchField: m.field,
    exact: m.exact,
    invoiceStatus,
    readyToInvoice,
    jobLabel: m.job ? (m.job.jobIdsDisplay || m.job.poNumber || undefined) : undefined,
    amount: poAmount(po, m.job),
    completedAt: m.job?.completedAt,
  };
}

/**
 * POs whose matched job is DONE but which haven't been invoiced — the
 * "send the invoice!" worklist. Oldest-completed first (most overdue to bill).
 */
export function readyToInvoiceList(
  pos: CustomerPoFile[],
  jobs: Job[],
  settings?: SystemSettings | null,
): { po: CustomerPoFile; derived: PoDerived }[] {
  const stages = resolveStages(settings);
  return pos
    .filter(po => !po.archived)
    .map(po => ({ po, derived: derivePo(po, jobs, stages) }))
    .filter(x => x.derived.readyToInvoice)
    .sort((a, b) => (a.derived.job?.completedAt || 0) - (b.derived.job?.completedAt || 0));
}
