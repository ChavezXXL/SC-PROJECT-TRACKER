import { jobSteps, stepDone, stepProgress, nextStep, fmtMinutes } from '../utils/jobSteps';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

const T0 = Date.parse('2026-10-19T14:00:00Z');
const item = (id: string, label: string, o: any = {}): any => ({ id, label, done: false, ...o });
const job: any = {
  id: 'j1', poNumber: '4500123456', partNumber: '0077426-01', quantity: 250,
  checklist: [
    item('a', 'Deburr'),
    item('b', 'Wash', { done: true, doneByName: 'Old Timer', doneAt: T0 }),   // ticked the old way
    item('c', 'Inspect'),
    item('d', 'Pack'),
  ],
  checklistTicks: {
    a: { done: true, by: 'u1', name: 'Maria Lopez', at: T0 + 1 },
    b: { done: false, by: 'u2', name: 'Joe', at: T0 + 2 },                    // un-ticked since
  },
};
const log = (o: any): any => ({ id: 'l' + Math.random(), jobId: 'j1', userId: 'u1', userName: 'Maria Lopez', operation: 'Deburr', startTime: T0, endTime: T0 + 3600_000, durationSeconds: 3600, ...o });

ok('a tick on the job wins', stepDone(job, job.checklist[0]) === true);
ok('a newer un-tick beats the old done flag', stepDone(job, job.checklist[1]) === false);
ok('old done flag still counts with no tick', stepDone({}, item('x', 'X', { done: true })) === true);
ok('progress counts ticks', JSON.stringify(stepProgress(job)) === '{"done":1,"total":4}');
ok('next step is the first not done', nextStep(job)?.label === 'Wash');

const steps = jobSteps(job, ['Deburr', 'wash', 'Packing'], [
  log({}), log({ userName: 'Joe Smith', durationSeconds: 1800 }), log({ operation: 'deburr ', durationSeconds: 600 }),
  log({ operation: 'Wash', userName: 'Joe Smith', endTime: undefined, durationSeconds: undefined }),
  log({ jobId: 'other', durationSeconds: 99999 }),
]);
ok('step matched to an operation (case/space-insensitive)', steps[0].operation === 'Deburr' && steps[1].operation === 'wash');
ok('step with no matching operation gets no Start', steps[2].operation === undefined && steps[3].operation === undefined);
ok('time logged on the step, this job only', Math.round(steps[0].loggedMinutes) === 100);
ok('who worked it, most time first', steps[0].workers.join() === 'Maria,Joe');
ok('who is on it now', steps[1].runningBy.join() === 'Joe' && steps[1].loggedMinutes === 0);
ok('done step shows who ticked it', steps[0].done && steps[0].doneBy === 'Maria');

ok('minutes rounded', fmtMinutes(27.483333333333334) === '27m');
ok('hours and minutes', fmtMinutes(207.48) === '3h 27m');
ok('whole hours', fmtMinutes(120) === '2h');
ok('never negative', fmtMinutes(-5) === '0m');

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
