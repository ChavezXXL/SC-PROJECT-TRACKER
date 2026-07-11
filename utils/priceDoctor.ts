/**
 * priceDoctor.ts — per-part pricing recommendations.
 * ─────────────────────────────────────────────────────────────────────────
 * The strategy doc's pricing item, turned into software: for every part the
 * shop has REAL learned cycle data on, compute the true burdened cost per
 * piece (learned labor minutes × (shop rate + overhead/hr) + material),
 * compare it to what's actually being charged, and recommend the price that
 * hits the target margin. Flags the money left on the table at real volume.
 *
 * Pure functions — builds on rateLearning (learned min/piece) and follows
 * jobProfit's burdened-rate conventions exactly, so the doctor can never
 * disagree with the profit engine.
 */

import type { Job, TimeLog, SystemSettings } from '../types';
import { computeOperationRates } from './rateLearning';

export type PriceVerdict = 'underpriced' | 'thin' | 'healthy' | 'no-price';

export interface PartPricing {
  partNumber: string;         // display casing (latest job's)
  customer?: string;          // most recent customer for this part
  runs: number;               // completed jobs of this part (all time)
  volume90d: number;          // pieces completed in last 90 days
  // Learned economics (per piece)
  laborMinPerPiece: number;
  costPerPiece: number;       // burdened labor + material
  materialPerPiece: number;
  // Reality
  currentPricePerPiece: number | null;  // latest price actually charged
  marginNowPct: number | null;          // at current price
  // Recommendation
  recommendedPrice: number;   // hits targetMarginPct
  breakEvenPrice: number;     // cost (0% margin)
  moneyLeft90d: number;       // (recommended − current) × volume90d, when positive
  verdict: PriceVerdict;
  /** low = learned from <2 distinct runs — treat as directional. */
  confidence: 'low' | 'good';
}

export interface PriceDoctorResult {
  parts: PartPricing[];               // underpriced first, by money left
  totalLeft90d: number;               // Σ moneyLeft90d of underpriced parts
  targetMarginPct: number;
  burdenedRate: number;               // $/hr used (shopRate + overhead/hr)
  hasData: boolean;
}

export function computePriceDoctor(
  jobs: Job[],
  logs: TimeLog[],
  settings: SystemSettings,
  now: number = Date.now(),
  targetMarginPct = 35,
): PriceDoctorResult {
  const shopRate = settings.shopRate ?? 0;
  // NaN-safe overhead/hour — identical convention to jobProfit/shopIntelligence.
  const ohMonthly = Number(settings.monthlyOverhead) || 0;
  const ohPerHour = ohMonthly > 0 ? ohMonthly / Math.max(1, Number(settings.monthlyWorkHours) || 160) : 0;
  const burdened = shopRate + ohPerHour;
  const d90 = now - 90 * 86400000;

  const empty: PriceDoctorResult = { parts: [], totalLeft90d: 0, targetMarginPct, burdenedRate: burdened, hasData: false };
  if (burdened <= 0) return empty;    // no cost basis configured → nothing meaningful

  // Group jobs by normalized part number.
  const byPart = new Map<string, Job[]>();
  for (const j of jobs) {
    const pn = (j.partNumber || '').trim().toLowerCase();
    if (!pn) continue;
    const arr = byPart.get(pn) || [];
    arr.push(j);
    byPart.set(pn, arr);
  }

  const parts: PartPricing[] = [];
  byPart.forEach((partJobs, pn) => {
    const rates = computeOperationRates(logs, pn);
    if (rates.size === 0) return;     // no learned cycle data → can't doctor it
    let laborMinPerPiece = 0;
    let maxRuns = 0;
    rates.forEach(r => { laborMinPerPiece += r.ratePerPiece; maxRuns = Math.max(maxRuns, r.runCount); });
    if (laborMinPerPiece <= 0) return;

    // Material per piece — averaged over jobs that recorded a material cost.
    let matCost = 0, matQty = 0;
    for (const j of partJobs) {
      if ((j.materialCost || 0) > 0 && (j.quantity || 0) > 0) { matCost += j.materialCost!; matQty += j.quantity; }
    }
    const materialPerPiece = matQty > 0 ? matCost / matQty : 0;

    const costPerPiece = (laborMinPerPiece / 60) * burdened + materialPerPiece;

    // Latest price actually charged: prefer explicit pricePerPart, else quote ÷ qty.
    const priced = [...partJobs]
      .filter(j => (j.pricePerPart || 0) > 0 || ((j.quoteAmount || 0) > 0 && (j.quantity || 0) > 0))
      .sort((a, b) => (b.completedAt || b.createdAt || 0) - (a.completedAt || a.createdAt || 0));
    const latest = priced[0];
    const currentPricePerPiece = latest
      ? (latest.pricePerPart && latest.pricePerPart > 0
          ? latest.pricePerPart
          : latest.quoteAmount! / latest.quantity)
      : null;

    const marginNowPct = currentPricePerPiece && currentPricePerPiece > 0
      ? ((currentPricePerPiece - costPerPiece) / currentPricePerPiece) * 100
      : null;

    const recommendedPrice = costPerPiece / (1 - targetMarginPct / 100);
    const volume90d = partJobs
      .filter(j => j.status === 'completed' && j.completedAt && j.completedAt >= d90)
      .reduce((a, j) => a + (j.quantity || 0), 0);

    let verdict: PriceVerdict;
    if (currentPricePerPiece === null) verdict = 'no-price';
    else if (marginNowPct! < 15) verdict = 'underpriced';
    else if (marginNowPct! < 30) verdict = 'thin';
    else verdict = 'healthy';

    const moneyLeft90d = verdict === 'underpriced' || verdict === 'thin'
      ? Math.max(0, (recommendedPrice - (currentPricePerPiece || 0)) * volume90d)
      : 0;

    // Display casing + most-recent customer from the newest job.
    const newest = [...partJobs].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];

    parts.push({
      partNumber: newest?.partNumber || pn,
      customer: newest?.customer || undefined,
      runs: partJobs.filter(j => j.status === 'completed').length,
      volume90d,
      laborMinPerPiece,
      costPerPiece,
      materialPerPiece,
      currentPricePerPiece,
      marginNowPct,
      recommendedPrice,
      breakEvenPrice: costPerPiece,
      moneyLeft90d,
      verdict,
      confidence: maxRuns >= 2 ? 'good' : 'low',
    });
  });

  const order: Record<PriceVerdict, number> = { underpriced: 0, 'no-price': 1, thin: 2, healthy: 3 };
  parts.sort((a, b) => order[a.verdict] - order[b.verdict] || b.moneyLeft90d - a.moneyLeft90d || b.volume90d - a.volume90d);

  return {
    parts,
    totalLeft90d: parts.reduce((s, p) => s + p.moneyLeft90d, 0),
    targetMarginPct,
    burdenedRate: burdened,
    hasData: parts.length > 0,
  };
}
