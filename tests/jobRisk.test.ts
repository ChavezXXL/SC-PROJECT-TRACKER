import { buildPartRiskIndex, computeJobRisk, workerFamiliarity, partVeterans, partFamilyKey, scanCriticality } from '../utils/jobRisk';

const NOW = new Date('2026-07-14T12:00:00Z').getTime();
const DAY = 86400000;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

const job = (o: any): any => ({ id: o.id || 'j' + Math.floor(Math.random() * 1e9), jobIdsDisplay: '', poNumber: 'PO', partNumber: 'P-100', quantity: 100, dateReceived: '', dueDate: '', info: '', status: 'active', createdAt: NOW - 30 * DAY, ...o });
const log = (o: any): any => ({ id: 'l' + Math.random(), userId: 'u1', userName: 'Victor', jobId: 'j1', operation: 'Deburr', startTime: NOW - 10 * DAY, endTime: NOW - 10 * DAY + 3600000, durationSeconds: 3600, ...o });
const rw = (o: any): any => ({ id: 'r' + Math.random(), createdAt: NOW - 10 * DAY, reason: 'scratch', quantity: 1, reporterUserId: 'u1', reporterName: 'V', status: 'open', ...o });
const risk = (jobs: any[], target: any, logs: any[] = [], rework: any[] = []) => computeJobRisk(target, buildPartRiskIndex(jobs, logs, rework, NOW), { now: NOW });
const done = (id: string, daysAgo: number, o: any = {}) => job({ id, status: 'completed', completedAt: NOW - daysAgo * DAY, ...o });

// ── Tiers ──────────────────────────────────────────────────────────
{ const j = job({ id: 'n1', partNumber: 'NEW-1', quoteAmount: 300 }); const r = risk([j], j); ok('new low-value part is yellow', r.tier === 'yellow' && r.reasons[0].includes('First time')); }
{ const j = job({ id: 'n2', partNumber: 'NEWPART-2', quoteAmount: 2000 }); const r = risk([j], j); ok('new high-value part is red', r.tier === 'red' && r.reasons[0].includes('Brand-new')); }
{ const j = job({ id: 'n3', partNumber: 'NEWPART-3', quoteAmount: 200, priority: 'urgent' }); ok('new urgent part is red', risk([j], j).tier === 'red'); }
{ const o = job({ id: 'o1', quantity: 180 }); const r = risk([done('d1', 60, { quantity: 200 }), done('d2', 20, { quantity: 150 }), o], o); ok('repeat clean part is green', r.tier === 'green' && r.reasons[0].includes('2 completed runs')); ok('green guidance', r.guidance.includes('owner reviews results')); }
{ const s = done('solo', 5, { quoteAmount: 100 }); ok('a completed job is not its own previous run', risk([s], s).tier === 'yellow'); }
{ const o = job({ id: 'o1', quantity: 500 }); const r = risk([done('d1', 20, { quantity: 100 }), done('d2', 40, { quantity: 80 }), o], o); ok('quantity jump is yellow', r.tier === 'yellow' && r.reasons[0].includes('Quantity jump')); }
{ const o = job({ id: 'o1' }); const r = risk([done('d1', 200), done('d2', 300), o], o); ok('stale part is yellow', r.tier === 'yellow' && r.reasons[0].includes("Hasn't run")); }
{ const o = job({ id: 'o1' }); ok('recent rework is red', risk([done('d1', 60), done('d2', 20), o], o, [], [rw({ partNumber: 'P-100', createdAt: NOW - 30 * DAY })]).tier === 'red'); }
{ const o = job({ id: 'o1' }); const r = risk([done('d1', 60), done('d2', 20), o], o, [], [rw({ partNumber: 'P-100', createdAt: NOW - 200 * DAY })]); ok('one old rework is yellow', r.tier === 'yellow' && r.reasons[0].includes('One past quality issue')); }
{ const o = job({ id: 'o1' }); ok('two old reworks is red', risk([done('d1', 60), o], o, [], [rw({ partNumber: 'P-100', createdAt: NOW - 200 * DAY }), rw({ partNumber: 'P-100', createdAt: NOW - 300 * DAY })]).tier === 'red'); }
{ const o = job({ id: 'o1' }); ok('rework links via jobId', risk([done('d1', 20), o], o, [], [rw({ jobId: 'd1', createdAt: NOW - 20 * DAY })]).tier === 'red'); }
{ const o = job({ id: 'o1', quoteAmount: 8000 }); const r = risk([done('d1', 30), done('d2', 10), o], o); ok('very-high-value floors at yellow', r.tier === 'yellow' && r.reasons[0].includes('big exposure')); }
{ const j = job({ id: 'n9', partNumber: 'NEW-9', pricePerPart: 20, quantity: 100 }); ok('pricePerPart x qty drives value', risk([j], j).tier === 'red'); }
{ const o = job({ id: 'o1', riskOverride: 'red', riskNote: 'Flight-critical' }); const r = risk([done('d1', 30), done('d2', 10), o], o); ok('override wins', r.tier === 'red' && r.autoTier === 'green' && r.overridden && r.reasons[0].includes('Flight-critical')); }
{ const j = job({ id: 'np', partNumber: '', quoteAmount: 100 }); ok('no part number is yellow', risk([j], j).tier === 'yellow'); }

// ── Placeholder part numbers don't pool (N/A ≠ one part) ───────────
{
  const naOpen = job({ id: 'naOpen', partNumber: 'N/A', quoteAmount: 200 });
  const r = risk([done('a', 5, { partNumber: 'N/A' }), done('b', 9, { partNumber: 'n/a' }), done('c', 12, { partNumber: 'N/A' }), naOpen], naOpen);
  ok('new N/A job is not GREEN from other N/A runs', r.tier !== 'green' && r.reasons[0].includes('No real part number'));
  const idx = buildPartRiskIndex([job({ id: 'x1', partNumber: 'N/A' })], [log({ jobId: 'x1', userId: 'u1' }), log({ jobId: 'x1', userId: 'u1' })], [], NOW);
  ok('no familiarity on N/A parts', workerFamiliarity('N/A', idx, 'u1').level === 'new');
}

// ── Part families ──────────────────────────────────────────────────
ok('dash-number family', partFamilyKey('0077426-00') === '0077426' && partFamilyKey('0077426-01') === '0077426');
ok('size-digit family', partFamilyKey('MS21904W10') === 'ms21904w' && partFamilyKey('MS21904W12') === 'ms21904w');
ok('rev-letter family', partFamilyKey('ABC-123-A') === partFamilyKey('ABC-123-B'));
ok('short stems stand alone', partFamilyKey('P-100') !== partFamilyKey('P-200'));
{ const o = job({ id: 'o1', partNumber: '0077426-00', quoteAmount: 3000 }); const r = risk([done('s1', 60, { partNumber: '0077426-01' }), done('s2', 30, { partNumber: '0077426-02' }), o], o); ok('proven family softens first run to yellow', r.tier === 'yellow' && r.reasons[0].includes('proven family')); }
{ const o = job({ id: 'o1', partNumber: '0077426-00', quoteAmount: 3000 }); ok('one sibling run is not proven', risk([done('s1', 60, { partNumber: '0077426-01' }), o], o).tier === 'red'); }
{ const o = job({ id: 'o1', partNumber: 'MS21904W10' }); const r = risk([done('d1', 60, { partNumber: 'MS21904W10' }), done('d2', 20, { partNumber: 'MS21904W10' }), done('sib', 15, { partNumber: 'MS21904W12' }), o], o, [], [rw({ partNumber: 'MS21904W12', createdAt: NOW - 10 * DAY })]); ok('sibling rework floors green to yellow', r.tier === 'yellow' && r.reasons[0].includes('similar part')); }

// ── Criticality from the description ───────────────────────────────
ok('strong keyword', scanCriticality(job({ info: 'Flight critical hardware' }))?.level === 'strong');
ok('soft keyword', scanCriticality(job({ specialInstructions: 'NO SCRATCHES on sealing surface' }))?.level === 'soft');
ok('sparse description is silent', scanCriticality(job({ info: 'deburr complete' })) === null);
ok('"failed" does not match FAI', scanCriticality(job({ info: 'previous lot failed inspection' })) === null);
{ const o = job({ id: 'o1', info: 'Aircraft bracket' }); ok('strong word forces red', risk([done('d1', 30), done('d2', 10), o], o).tier === 'red'); }
{ const o = job({ id: 'o1', specialInstructions: 'no scratches allowed' }); ok('soft word floors yellow', risk([done('d1', 30), done('d2', 10), o], o).tier === 'yellow'); }

// ── Familiarity ladder ─────────────────────────────────────────────
{
  const jobs = [job({ id: 'j1', partNumber: '0077426-01' }), job({ id: 'j2', partNumber: '0077426-01' }), job({ id: 'j3', partNumber: 'OTHER-1' }), job({ id: 'j4', partNumber: 'OTHER-2' })];
  const logs = [log({ jobId: 'j1', userId: 'u1' }), log({ jobId: 'j2', userId: 'u1' }), log({ jobId: 'j3', userId: 'u2', userName: 'Jose', operation: 'Flashline Grind' }), log({ jobId: 'j4', userId: 'u2', userName: 'Jose', operation: 'Flashline Grind' })];
  const idx = buildPartRiskIndex(jobs, logs, [], NOW);
  const f1 = workerFamiliarity('0077426-00', idx, 'u1');
  ok('sibling experience = family', f1.level === 'family' && f1.familyRuns === 2);
  const f2 = workerFamiliarity('0077426-00', idx, 'u2', ['Flashline Grind']);
  ok('op experience = ops', f2.level === 'ops' && f2.knownOps![0].jobs === 2);
  ok('stranger is new', workerFamiliarity('0077426-00', idx, 'u9', ['Flashline Grind']).level === 'new');
}
{ const idx = buildPartRiskIndex([job({ id: 'j1' }), job({ id: 'j2' }), job({ id: 'j3' })], [1, 2, 3].map(i => log({ jobId: 'j' + i })), [], NOW); ok('3 runs = expert', workerFamiliarity('P-100', idx, 'u1').level === 'expert'); }
{ const idx = buildPartRiskIndex([job({ id: 'j1' })], [log({ jobId: 'j1', isSample: true }), log({ jobId: 'j1', userId: 'u2', endTime: null })], [], NOW); ok('sample + open logs ignored', workerFamiliarity('P-100', idx, 'u1').level === 'new' && workerFamiliarity('P-100', idx, 'u2').level === 'new'); }
{ const idx = buildPartRiskIndex([job({ id: 'j1', partNumber: '0077426-01' })], [log({ jobId: 'j1', userName: 'Victor' })], [], NOW); const v = partVeterans('0077426-00', idx, 'u9'); ok('family veterans marked viaSimilar', v.length === 1 && v[0].viaSimilar === true); }

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
