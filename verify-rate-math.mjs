// Standalone verification of the rate-learning algorithm.
// Mirrors utils/rateLearning.ts exactly so we prove the math without a TS runner.
// Run: node verify-rate-math.mjs

function computeOperationRates(logs, partNumber) {
  const part = (partNumber || '').trim().toLowerCase();
  if (!part) return new Map();
  const relevant = logs.filter(l =>
    (l.partNumber || '').trim().toLowerCase() === part &&
    !!l.operation &&
    typeof l.durationMinutes === 'number' && l.durationMinutes > 0 &&
    typeof l.sessionQty === 'number' && l.sessionQty > 0
  );
  // Lowercase bucketing — "Polish" / "polish" / "POLISH" merge into one
  const byOpLower = new Map();
  for (const l of relevant) {
    const key = l.operation.trim().toLowerCase();
    if (!key) continue;
    const e = byOpLower.get(key) || { totalMins: 0, totalQty: 0, runIds: new Set(), sampleCount: 0, displayName: l.operation.trim() };
    e.totalMins += l.durationMinutes;
    e.totalQty += l.sessionQty;
    e.runIds.add(l.jobId);
    e.sampleCount += 1;
    e.displayName = l.operation.trim();
    byOpLower.set(key, e);
  }
  const rates = new Map();
  for (const e of byOpLower.values()) {
    if (e.totalQty <= 0) continue;
    rates.set(e.displayName, {
      operation: e.displayName,
      ratePerPiece: e.totalMins / e.totalQty,
      totalPieces: e.totalQty,
      totalMinutes: e.totalMins,
      runCount: e.runIds.size,
      sampleCount: e.sampleCount,
    });
  }
  return rates;
}

function estimateJobMinutes(quantity, rates, buffer = 1) {
  const safeBuf = Number.isFinite(buffer) && buffer > 0 ? buffer : 1;
  let totalMinutes = 0;
  const rows = [];
  let maxRuns = 0;
  for (const r of rates.values()) {
    const minutes = quantity * r.ratePerPiece * safeBuf;
    rows.push({ operation: r.operation, ratePerPiece: r.ratePerPiece, estimatedMinutes: minutes, runCount: r.runCount });
    totalMinutes += minutes;
    if (r.runCount > maxRuns) maxRuns = r.runCount;
  }
  rows.sort((a, b) => b.estimatedMinutes - a.estimatedMinutes);
  return { breakdown: rows, totalMinutes, totalHours: totalMinutes / 60, basedOnRuns: maxRuns, hasData: rows.length > 0 && quantity > 0 };
}

// ── Test cases ──
let pass = 0, fail = 0;
function assert(name, condition, expected, actual) {
  if (condition) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    expected: ${expected}\n    got:      ${actual}`); }
}

console.log('\n══ TEST 1: User\'s exact example — 30 samples × 20 min for "deburr" ══');
{
  const logs = [
    { jobId: 'j1', customer: 'S&H Machine', partNumber: 'ABC-123', operation: 'deburr', durationMinutes: 20, sessionQty: 30 },
  ];
  const rates = computeOperationRates(logs, 'ABC-123');
  const rate = rates.get('deburr');
  assert('1 log creates 1 rate entry', rates.size === 1, 1, rates.size);
  assert('Rate is 0.667 min/pc (20/30)', Math.abs(rate.ratePerPiece - 0.6667) < 0.01, 0.6667, rate.ratePerPiece);
  const est = estimateJobMinutes(1000, rates);
  assert('1000 pcs × 0.667 = ~666.67 min', Math.abs(est.totalMinutes - 666.67) < 1, 666.67, est.totalMinutes);
  assert('Total hours = ~11.11h', Math.abs(est.totalHours - 11.11) < 0.05, 11.11, est.totalHours);
  console.log(`    → 1000 pcs estimated: ${est.totalHours.toFixed(2)}h`);
}

console.log('\n══ TEST 2: Multiple runs averaging — bigger runs get more weight ══');
{
  // Two runs: 30 pcs in 20 min (0.667 min/pc) AND 1000 pcs in 600 min (0.6 min/pc)
  // Weighted avg: (20+600) / (30+1000) = 620/1030 = 0.602 min/pc
  const logs = [
    { jobId: 'j1', customer: 'S&H', partNumber: 'X', operation: 'deburr', durationMinutes: 20,  sessionQty: 30 },
    { jobId: 'j2', customer: 'S&H', partNumber: 'X', operation: 'deburr', durationMinutes: 600, sessionQty: 1000 },
  ];
  const rates = computeOperationRates(logs, 'X');
  const rate = rates.get('deburr');
  const expectedRate = 620 / 1030;
  assert(`Weighted rate ≈ ${expectedRate.toFixed(3)} min/pc`, Math.abs(rate.ratePerPiece - expectedRate) < 0.001, expectedRate, rate.ratePerPiece);
  assert('runCount = 2 (2 distinct jobs)', rate.runCount === 2, 2, rate.runCount);
  assert('totalPieces = 1030', rate.totalPieces === 1030, 1030, rate.totalPieces);
  console.log(`    → Rate scales with bigger sample: ${rate.ratePerPiece.toFixed(3)} min/pc`);
}

console.log('\n══ TEST 3: Multiple operations on same part ══');
{
  const logs = [
    { jobId: 'j1', customer: 'S&H', partNumber: 'X', operation: 'deburr', durationMinutes: 20,  sessionQty: 30 },
    { jobId: 'j1', customer: 'S&H', partNumber: 'X', operation: 'wash',   durationMinutes: 3,   sessionQty: 30 },
    { jobId: 'j1', customer: 'S&H', partNumber: 'X', operation: 'qc',     durationMinutes: 1.5, sessionQty: 30 },
  ];
  const rates = computeOperationRates(logs, 'X');
  assert('3 operations tracked separately', rates.size === 3, 3, rates.size);
  const est = estimateJobMinutes(1000, rates);
  // Expected: deburr ~666.67 + wash ~100 + qc ~50 = ~816.67 min = ~13.61h
  assert('Total ≈ 13.6h for 1000 pcs across 3 ops', Math.abs(est.totalHours - 13.61) < 0.1, 13.61, est.totalHours);
  assert('Breakdown sorted by biggest first (deburr)', est.breakdown[0].operation === 'deburr', 'deburr', est.breakdown[0].operation);
  console.log(`    → 3-operation total: ${est.totalHours.toFixed(2)}h, biggest: ${est.breakdown[0].operation} (${(est.breakdown[0].estimatedMinutes/60).toFixed(2)}h)`);
}

console.log('\n══ TEST 4: Case-insensitive matching + whitespace tolerance ══');
{
  const logs = [
    { jobId: 'j1', partNumber: 'abc-123', operation: 'deburr', durationMinutes: 20, sessionQty: 30 },
  ];
  const rates = computeOperationRates(logs, 'ABC-123');
  assert('Matches despite case+whitespace differences', rates.size === 1, 1, rates.size);
}

console.log('\n══ TEST 5: Skips logs without sessionQty (legacy data safety) ══');
{
  const logs = [
    { jobId: 'j1', customer: 'X', partNumber: 'Y', operation: 'deburr', durationMinutes: 20 }, // missing sessionQty
    { jobId: 'j2', customer: 'X', partNumber: 'Y', operation: 'deburr', durationMinutes: 20, sessionQty: 0 }, // zero qty
    { jobId: 'j3', customer: 'X', partNumber: 'Y', operation: 'deburr', durationMinutes: 30, sessionQty: 60 }, // valid
  ];
  const rates = computeOperationRates(logs, 'Y');
  const rate = rates.get('deburr');
  assert('Only 1 valid log counted', rate.sampleCount === 1, 1, rate.sampleCount);
  assert('Rate from valid log only: 0.5 min/pc', Math.abs(rate.ratePerPiece - 0.5) < 0.001, 0.5, rate.ratePerPiece);
}

console.log('\n══ TEST 6: Pools data across customers for the same part ══');
{
  // Rate engine is partNumber-keyed by design: a part's cycle time
  // shouldn't change based on which customer it ships to.
  const logs = [
    { jobId: 'j1', customer: 'X',     partNumber: 'Y', operation: 'deburr', durationMinutes: 20, sessionQty: 30 },
    { jobId: 'j2', customer: 'OTHER', partNumber: 'Y', operation: 'deburr', durationMinutes: 10, sessionQty: 20 },
  ];
  const rates = computeOperationRates(logs, 'Y');
  const rate = rates.get('deburr');
  // Combined: (20+10) min / (30+20) qty = 30/50 = 0.6 min/pc
  assert('Pooled rate across customers ≈ 0.6 min/pc', Math.abs(rate.ratePerPiece - 0.6) < 0.001, 0.6, rate.ratePerPiece);
  assert('runCount = 2 (across customers)', rate.runCount === 2, 2, rate.runCount);
}

console.log('\n══ TEST 7: Empty inputs handled gracefully ══');
{
  assert('Empty logs → empty rates', computeOperationRates([], 'Y').size === 0, 0, computeOperationRates([], 'Y').size);
  assert('Empty part → empty rates', computeOperationRates([{}], '').size === 0, 0, computeOperationRates([{}], '').size);
  assert('Zero quantity estimate → not hasData', estimateJobMinutes(0, new Map([['op', { operation: 'op', ratePerPiece: 1, totalPieces: 10, totalMinutes: 10, runCount: 1, sampleCount: 1 }]])).hasData === false, false, true);
}

console.log('\n══ TEST 8: Operation case merging — "Polish" + "polish" + "POLISH" → one bucket ══');
{
  const logs = [
    { jobId: 'j1', partNumber: 'X', operation: 'Polish',  durationMinutes: 20, sessionQty: 30 },
    { jobId: 'j2', partNumber: 'X', operation: 'polish',  durationMinutes: 10, sessionQty: 20 },
    { jobId: 'j3', partNumber: 'X', operation: 'POLISH',  durationMinutes: 30, sessionQty: 50 },
  ];
  const rates = computeOperationRates(logs, 'X');
  assert('All three case variants merge into one operation', rates.size === 1, 1, rates.size);
  // Total: (20+10+30) / (30+20+50) = 60/100 = 0.6 min/pc
  const r = [...rates.values()][0];
  assert('Pooled rate = 0.6 min/pc', Math.abs(r.ratePerPiece - 0.6) < 0.001, 0.6, r.ratePerPiece);
  assert('sampleCount = 3', r.sampleCount === 3, 3, r.sampleCount);
}

console.log('\n══ TEST 9: Buffer multiplier applies cleanly ══');
{
  const logs = [
    { jobId: 'j1', partNumber: 'X', operation: 'deburr', durationMinutes: 20, sessionQty: 30 },
  ];
  const rates = computeOperationRates(logs, 'X');
  const base = estimateJobMinutes(1000, rates, 1);     // no buffer
  const buf15 = estimateJobMinutes(1000, rates, 1.15); // 15% buffer
  const buf50 = estimateJobMinutes(1000, rates, 1.5);  // 50% buffer
  assert('No buffer → 11.11h', Math.abs(base.totalHours - 11.11) < 0.05, 11.11, base.totalHours);
  assert('15% buffer → 12.78h (11.11 × 1.15)', Math.abs(buf15.totalHours - 12.78) < 0.05, 12.78, buf15.totalHours);
  assert('50% buffer → 16.67h (11.11 × 1.5)', Math.abs(buf50.totalHours - 16.67) < 0.05, 16.67, buf50.totalHours);
  assert('Invalid buffer (0) treated as 1', Math.abs(estimateJobMinutes(1000, rates, 0).totalHours - 11.11) < 0.05, 11.11, estimateJobMinutes(1000, rates, 0).totalHours);
}

console.log(`\n────────────────────────────────────────`);
console.log(`  PASSED: ${pass}  FAILED: ${fail}`);
console.log(`────────────────────────────────────────\n`);
process.exit(fail === 0 ? 0 : 1);
