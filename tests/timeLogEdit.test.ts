import { timeLogEditPatch, newTimeLogRecord, finalizeDuration } from '../utils/timeLogEdit';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

const H = 3_600_000, M = 60_000;
const T0 = Date.parse('2026-10-19T14:00:00Z');
const NOW = T0 + 10 * H;
const done = (o: any = {}): any => ({
  id: 'l1', jobId: 'j1', userId: 'u1', userName: 'Maria Lopez', operation: 'Deburr',
  startTime: T0, endTime: T0 + 2 * H, durationSeconds: 7200, durationMinutes: 120,
  totalPausedMs: 0, status: 'completed', stopReason: 'manual', ...o,
});

// Clearing End Time puts the timer back on the clock (a merge save used to keep the old end).
{ const cur = done(); const p = timeLogEditPatch(cur, { ...cur, endTime: null as any, durationSeconds: undefined, durationMinutes: null as any }, NOW);
  // Written as null (not deleted) so the endTime == null "open timer" queries see it.
  ok('cleared end time is set to null', p.set.endTime === null && !p.clear.includes('endTime'));
  ok('durations and stop reason go with it', p.clear.includes('durationSeconds') && p.clear.includes('durationMinutes') && p.clear.includes('stopReason'));
  ok('log is running again', p.set.status === 'in_progress'); }

// Moving the end time recomputes from the times, minus pauses — not the editor's wall-clock minutes.
{ const cur = done({ totalPausedMs: 30 * M, durationSeconds: 5400, durationMinutes: 90 });
  const p = timeLogEditPatch(cur, { ...cur, endTime: T0 + 3 * H, durationSeconds: 3 * 3600, durationMinutes: 180 }, NOW);
  ok('new end written', p.set.endTime === T0 + 3 * H);
  ok('duration = 3h minus 30m paused', p.set.durationSeconds === 9000 && p.set.durationMinutes === 150);
  ok('status completed', p.set.status === 'completed'); }

// The editor's stale copy can't undo a pause the worker made meanwhile.
{ const live: any = { ...done(), endTime: undefined, durationSeconds: undefined, durationMinutes: undefined, status: 'paused', pausedAt: T0 + H, totalPausedMs: 10 * M, pauseReason: 'manual' };
  const stale: any = { ...live, pausedAt: null, totalPausedMs: 0, pauseReason: null, status: 'in_progress', notes: 'fixed the op' };
  const p = timeLogEditPatch(live, stale, NOW);
  ok('pause fields untouched by a non-sample edit', !('pausedAt' in p.set) && !p.clear.includes('pausedAt') && !('totalPausedMs' in p.set) && !p.clear.includes('pauseReason'));
  ok('the real edit still lands', p.set.notes === 'fixed the op'); }

// Ending a running, paused log from the editor counts the open pause, like Stop does.
{ const live: any = { ...done(), endTime: undefined, durationSeconds: undefined, durationMinutes: undefined, status: 'paused', pausedAt: T0 + H, pauseReason: 'manual', totalPausedMs: 0, stopReason: undefined };
  const p = timeLogEditPatch(live, { ...live, endTime: T0 + 2 * H }, NOW);
  ok('open pause counted to the end', p.set.durationSeconds === 3600 && p.set.totalPausedMs === H);
  ok('pause closed', p.set.pausedAt === null && p.set.pauseReason === null); }

// A rate-sample edit moves the start so the typed minutes stick.
{ const cur = done({ isSample: true, sessionQty: 10, durationSeconds: 1200, durationMinutes: 20, startTime: T0, endTime: T0 + 20 * M });
  const p = timeLogEditPatch(cur, { ...cur, sessionQty: 12, startTime: cur.endTime - 35 * M, endTime: cur.endTime, totalPausedMs: 0 }, NOW);
  ok('sample minutes follow the edit', p.set.durationMinutes === 35 && p.set.sessionQty === 12); }

// Nothing changed → only the timestamp.
{ const cur = done(); const p = timeLogEditPatch(cur, { ...cur }, NOW);
  ok('no-op edit writes only updatedAt', Object.keys(p.set).join() === 'updatedAt' && p.clear.length === 0); }

// Repairing a flagged log clears the flag.
{ const cur = done({ durationAnomaly: true }); const p = timeLogEditPatch(cur, { ...cur, endTime: T0 + 90 * M, durationAnomaly: false }, NOW);
  ok('anomaly flag cleared on repair', p.set.durationAnomaly === false && p.set.durationSeconds === 5400); }

// A brand-new record gets its durations from its times.
{ const r = newTimeLogRecord({ ...done(), durationSeconds: 1, durationMinutes: 0.01, startTime: T0, endTime: T0 + 90 * 1000 } as any, NOW);
  ok('new record: 90 s → 1.5 min', r.durationSeconds === 90 && r.durationMinutes === 1.5 && r.status === 'completed'); }
ok('runaway session capped at 14 h', finalizeDuration({ startTime: T0 }, T0 + 30 * H).durationSeconds === 14 * 3600);

// The editor opened on a RUNNING timer; the worker pressed Stop meanwhile; the
// admin only fixed the operation. Their save must not restart the timer.
{ const opened: any = { ...done(), endTime: undefined, durationSeconds: undefined, durationMinutes: undefined, status: 'in_progress', stopReason: undefined };
  const server = done({ stopReason: 'manual', sessionQty: 40 });          // stopped meanwhile
  const p = timeLogEditPatch(server, { ...opened, operation: 'Tumble' }, NOW, opened);
  ok('only the edited field is written', Object.keys(p.set).filter(k => k !== 'updatedAt').join() === 'operation' && p.set.operation === 'Tumble');
  ok("the worker's clock-out survives", !p.clear.includes('endTime') && !('endTime' in p.set) && !p.clear.includes('sessionQty') && !p.clear.includes('stopReason')); }

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
