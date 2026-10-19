import { jobBudgets, jobMoney, groupLogsByJob, AT_RISK_PCT } from '../utils/jobBudget';
import { computeInsights } from '../utils/shopIntelligence';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

// Shop: $25 fallback rate, $10/h overhead (8000 ÷ 800 h).
const settings: any = { shopRate: 25, monthlyOverhead: 8000, monthlyWorkHours: 800 };
const users: any[] = [
  { id: 'maria', name: 'Maria', hourlyRate: 20 },
  { id: 'joe', name: 'Joe' },                       // no rate → shop rate
];
const job = (o: any = {}): any => ({ id: 'j1', poNumber: 'PO-1', status: 'in-progress', quoteAmount: 300, ...o });
const log = (o: any = {}): any => ({ id: 'l' + Math.random(), jobId: 'j1', userId: 'maria', userName: 'Maria', durationSeconds: 3600, ...o });

// Cost = hours × (person's rate + overhead) + material + POs.
{ const logs = [log(), log({ userId: 'joe', userName: 'Joe' })];         // 1 h each
  const b = jobBudgets([job()], groupLogsByJob(logs), users, settings, []).get('j1')!;
  ok('labor at each person\'s rate + overhead', near(b.cost, 1 * (20 + 10) + 1 * (25 + 10)));
  ok('used % of the quote', near(b.usedPct, (65 / 300) * 100));
  ok('not over, not at risk', !b.overBudget && !b.atRisk); }

// Sample (rate-learning) logs never count.
{ const b = jobBudgets([job()], groupLogsByJob([log({ isSample: true, durationSeconds: 36000 })]), users, settings, []).get('j1')!;
  ok('samples ignored', b.cost === 0); }

// Material and placed outside-processing POs count; drafts don't.
{ const pos: any[] = [
    { id: 'p1', linkedJobIds: ['j1'], status: 'ordered', total: 100 },
    { id: 'p2', linkedJobIds: ['j1'], status: 'draft', total: 999 },
  ];
  const b = jobBudgets([job({ materialCost: 50 })], groupLogsByJob([]), users, settings, pos).get('j1')!;
  ok('material + placed PO', near(b.cost, 150)); }

// At-risk threshold, then over.
{ const atRisk = jobBudgets([job({ quoteAmount: 40 })], groupLogsByJob([log()]), users, settings, []).get('j1')!;   // $30 of $40
  ok(`≥ ${AT_RISK_PCT}% is at risk`, atRisk.atRisk && !atRisk.overBudget);
  const over = jobBudgets([job({ quoteAmount: 25 })], groupLogsByJob([log()]), users, settings, []).get('j1')!;
  ok('over budget past the quote', over.overBudget && !over.atRisk && near(over.remaining, -5)); }

ok('jobs without a quote are left out', jobBudgets([job({ quoteAmount: 0 })], groupLogsByJob([log()]), users, settings, []).size === 0);

// A closed job reports its locked snapshot, not today's rates.
{ const snap = { revenue: 300, laborCost: 90, materialCost: 0, outsourcedCost: 0, totalCost: 90, profit: 210, marginPct: 70, laborHours: 3, snappedAt: 1 };
  const m = jobMoney(job({ status: 'completed', profitSnapshot: snap }), [log({ durationSeconds: 36000 })], users, settings, []);
  ok('snapshot wins for closed jobs', m.totalCost === 90 && m.profit === 210 && m.laborHours === 3);
  const live = jobMoney(job(), [log()], users, settings, []);
  ok('open job is live', near(live.totalCost, 30) && near(live.profit, 270)); }

// The Shop Brain names exactly the jobs the dashboard calls over budget.
{ const jobs = [job({ id: 'a', poNumber: 'A', quoteAmount: 25 }), job({ id: 'b', poNumber: 'B', quoteAmount: 31 }), job({ id: 'c', poNumber: 'C', quoteAmount: 500 })];
  const logs = ['a', 'b', 'c'].map(id => log({ jobId: id }));                // $30 each
  const budgets = jobBudgets(jobs, groupLogsByJob(logs), users, settings, []);
  const overIds = jobs.filter(j => budgets.get(j.id)?.overBudget).map(j => j.id).sort();
  const brain = computeInsights(jobs, logs, users, settings, []).filter(i => i.type === 'underquoted').map(i => (i.metadata as any).jobId).sort();
  ok('dashboard: only A is over ($30 vs $25)', overIds.join() === 'a');
  ok('brain agrees with the dashboard', brain.join() === overIds.join()); }

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
