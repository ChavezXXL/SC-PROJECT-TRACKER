import {
  parseYmd, dueNum, canonicalDue, dayNum, daysUntilDue, dueState, isJobClosed, isClosedStage,
  shippedOnTime, shippedDaysLate, onTimeRate, compareByDue, dueLabel, daysBetween,
} from '../utils/dueDates';
import { dateNum, normDate, parseDueDate } from '../utils/date';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();

// ── Parsing ───────────────────────────────────────────────────────
ok('MM/DD/YYYY', dueNum('09/20/2026') === 20260920);
ok('M/D/YYYY', dueNum('9/5/2026') === 20260905);
ok('M/D/YY → 20YY', dueNum('9/5/26') === 20260905);
ok('ISO', dueNum('2026-09-20') === 20260920);
ok('ISO with time', dueNum('2026-09-20T00:00:00.000Z') === 20260920);
ok('MM-DD-YYYY', dueNum('09-20-2026') === 20260920);
ok('month name with year', dueNum('Sep 20, 2026') === 20260920 && dueNum('September 20 2026') === 20260920);
ok('month name WITHOUT year rejected (old bug: became 2001)', dueNum('Sep 20') === 0);
ok('13/45/2026 rejected (old bug: rolled into 2027)', dueNum('13/45/2026') === 0);
ok('Feb 30 rejected', dueNum('02/30/2026') === 0);
ok('leap day ok', dueNum('02/29/2028') === 20280229);
ok('garbage → 0', dueNum('ASAP') === 0 && dueNum('') === 0 && dueNum(undefined) === 0);
ok('whitespace trimmed', dueNum('  09/20/2026 ') === 20260920);
ok('canonical pads', canonicalDue('9/5/26') === '09/05/2026' && canonicalDue('2026-09-20') === '09/20/2026');
ok('canonical garbage → ""', canonicalDue('ASAP') === '');
ok('parseYmd shape', JSON.stringify(parseYmd('12/31/2026')) === '{"y":2026,"m":12,"d":31}');

// ── Legacy helpers now share the parser ───────────────────────────
ok('dateNum accepts ISO now (was 0 → "always overdue")', dateNum('2026-09-20') === 20260920);
ok('dateNum garbage still 0', dateNum('ASAP') === 0);
ok('normDate keeps unreadable input instead of dropping it', normDate('ASAP') === 'ASAP');
ok('normDate fixes Sep 20 → no 2001', normDate('Sep 20') === 'Sep 20');
ok('normDate pads M/D/YYYY', normDate('9/5/2026') === '09/05/2026');
ok('parseDueDate ISO', parseDueDate('2026-09-20')?.getDate() === 20);
ok('parseDueDate rejects 13/45/2026', parseDueDate('13/45/2026') === null);

// ── Day math ──────────────────────────────────────────────────────
ok('daysBetween across month', daysBetween(20260930, 20261002) === 2);
ok('daysBetween across DST change', daysBetween(20261031, 20261102) === 2);
ok('dayNum device-local', dayNum(at(2026, 9, 20, 23, 59)) === 20260920);
ok('dayNum in shop tz (UTC instant late evening Pacific)', dayNum(Date.UTC(2026, 8, 21, 6, 30), 'America/Los_Angeles') === 20260920);

// ── THE cutoff: on time through the END of the due day ────────────
const job = (o: any) => ({ status: 'in-progress', dueDate: '09/20/2026', ...o });
ok('due day 8am → today', dueState(job({}), { now: at(2026, 9, 20, 8) }) === 'today');
ok('due day 1pm → STILL today (old bug: overdue at noon)', dueState(job({}), { now: at(2026, 9, 20, 13) }) === 'today');
ok('due day 11:59pm → today', dueState(job({}), { now: at(2026, 9, 20, 23, 59) }) === 'today');
ok('day after → overdue', dueState(job({}), { now: at(2026, 9, 21, 0, 1) }) === 'overdue');
ok('2 days before → soon', dueState(job({}), { now: at(2026, 9, 18) }) === 'soon');
ok('soonDays window', dueState(job({}), { now: at(2026, 9, 16), soonDays: 3 }) === 'later');
ok('no due date → none', dueState(job({ dueDate: '' }), { now: at(2026, 9, 20) }) === 'none');
ok('unreadable due → none (old bug: always overdue)', dueState(job({ dueDate: 'ASAP' }), { now: at(2026, 9, 20) }) === 'none');
ok('daysUntilDue late', daysUntilDue('09/20/2026', at(2026, 9, 25)) === -5);

// ── Closed jobs are never overdue ────────────────────────────────
const stages: any[] = [{ id: 'pending', label: 'Pending', order: 0 }, { id: 'stage_1', label: 'Shipped', order: 5 }, { id: 'done', label: 'Completed', order: 6, isComplete: true }];
ok('completed → closed', dueState(job({ status: 'completed' }), { now: at(2026, 10, 1) }) === 'closed');
ok('in a custom "Shipped" stage → closed (old bug: still OVERDUE, even on the customer portal)', dueState(job({ currentStage: 'stage_1' }), { now: at(2026, 10, 1), stages }) === 'closed');
ok('legacy "shipped" stage id → closed', isJobClosed({ status: 'in-progress', currentStage: 'shipped' } as any));
ok('isComplete stage → closed', isClosedStage(stages[2]));
ok('pending stage → open', !isClosedStage(stages[0]));
ok('open + late → overdue', dueState(job({ currentStage: 'pending' }), { now: at(2026, 10, 1), stages }) === 'overdue');

// ── On time = left the shop by end of due day ────────────────────
ok('shipped on due day evening → on time', shippedOnTime({ dueDate: '09/20/2026', shippedAt: at(2026, 9, 20, 22) }) === true);
ok('shipped next day → late', shippedOnTime({ dueDate: '09/20/2026', shippedAt: at(2026, 9, 21, 8) }) === false);
ok('ship date beats a late "Complete" click', shippedOnTime({ dueDate: '09/20/2026', shippedAt: at(2026, 9, 19), completedAt: at(2026, 9, 25) }) === true);
ok('no ship date → falls back to completedAt', shippedOnTime({ dueDate: '09/20/2026', completedAt: at(2026, 9, 25) }) === false);
ok('no due date → not judged', shippedOnTime({ dueDate: '', completedAt: at(2026, 9, 25) }) === null);
ok('not shipped → not judged', shippedOnTime({ dueDate: '09/20/2026' }) === null);
ok('days late', shippedDaysLate({ dueDate: '09/20/2026', shippedAt: at(2026, 9, 23) }) === 3);
{
  const r = onTimeRate([
    { dueDate: '09/20/2026', shippedAt: at(2026, 9, 20) },
    { dueDate: '09/20/2026', shippedAt: at(2026, 9, 22) },
    { dueDate: '', completedAt: at(2026, 9, 22) },          // excluded, not "late"
    { dueDate: 'ASAP', completedAt: at(2026, 9, 22) },      // excluded, not "late"
  ]);
  ok('onTimeRate excludes unjudgeable jobs instead of counting them late', r.judged === 2 && r.onTime === 1 && r.pct === 50);
}
ok('onTimeRate empty → null', onTimeRate([]).pct === null);

// ── Sorting + labels ──────────────────────────────────────────────
{
  const list = [{ dueDate: '' }, { dueDate: '10/01/2026' }, { dueDate: '09/01/2026' }, { dueDate: '2026-09-15' }];
  const sorted = [...list].sort(compareByDue).map(j => j.dueDate);
  ok('sort: soonest/most-late first, undated last, mixed formats', JSON.stringify(sorted) === JSON.stringify(['09/01/2026', '2026-09-15', '10/01/2026', '']));
}
ok('label late', dueLabel('09/20/2026', at(2026, 9, 23)) === '3d late');
ok('label today', dueLabel('09/20/2026', at(2026, 9, 20, 15)) === 'due today');
ok('label tomorrow', dueLabel('09/20/2026', at(2026, 9, 19, 15)) === 'due tomorrow');
ok('label none', dueLabel('', at(2026, 9, 19)) === '');

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
