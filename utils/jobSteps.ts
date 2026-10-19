// A job's steps (its checklist) and where each one stands: ticked done or not,
// the time the floor has logged on it, and who is on it right now. Shared by
// the worker's job card, the office job list and the job editor, so they all
// agree on what "done" means.
import type { Job, JobChecklistItem, TimeLog } from '../types';

export const normOp = (s?: string) => (s || '').trim().toLowerCase();

/** Is this step done? A tick on the job wins; older ticks lived on the item. */
export function stepDone(job: Pick<Job, 'checklistTicks'>, item: JobChecklistItem): boolean {
  const t = job.checklistTicks?.[item.id];
  return t ? t.done : !!item.done;
}

/** Who ticked a done step, and when. */
export function stepTickedBy(job: Pick<Job, 'checklistTicks'>, item: JobChecklistItem): { name?: string; at?: number } | null {
  const t = job.checklistTicks?.[item.id];
  if (t) return t.done ? { name: t.name, at: t.at } : null;
  return item.done ? { name: item.doneByName, at: item.doneAt } : null;
}

/** Worked minutes of a finished log. */
export const logMinutes = (l: Pick<TimeLog, 'durationSeconds' | 'durationMinutes'>) =>
  l.durationSeconds != null && l.durationSeconds >= 0 ? l.durationSeconds / 60 : (l.durationMinutes || 0);

const firstName = (n?: string) => (n || '').trim().split(/\s+/)[0] || 'Someone';

export interface StepView {
  item: JobChecklistItem;
  done: boolean;
  doneBy?: string;
  /** The configured operation this step starts (label matched case-insensitively). */
  operation?: string;
  /** Finished time logged on this job + operation, in minutes. */
  loggedMinutes: number;
  /** First names of everyone who logged time on it, most time first. */
  workers: string[];
  /** First names with a timer running on it now. */
  runningBy: string[];
}

export function jobSteps(job: Job, operations: string[], logs: TimeLog[]): StepView[] {
  const opByNorm = new Map(operations.map(o => [normOp(o), o]));
  const jobLogs = logs.filter(l => l.jobId === job.id);
  return (job.checklist || []).map(item => {
    const operation = opByNorm.get(normOp(item.label));
    const onStep = jobLogs.filter(l => normOp(l.operation) === normOp(item.label));
    const byWorker = new Map<string, number>();
    let loggedMinutes = 0;
    const runningBy: string[] = [];
    for (const l of onStep) {
      if (!l.endTime) { runningBy.push(firstName(l.userName)); continue; }
      const m = logMinutes(l);
      loggedMinutes += m;
      const who = firstName(l.userName);
      byWorker.set(who, (byWorker.get(who) || 0) + m);
    }
    const tick = stepTickedBy(job, item);
    return {
      item,
      done: stepDone(job, item),
      doneBy: tick?.name ? firstName(tick.name) : undefined,
      operation,
      loggedMinutes,
      workers: [...byWorker.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w),
      runningBy: [...new Set(runningBy)],
    };
  });
}

/** How many steps are done, out of how many. */
export function stepProgress(job: Pick<Job, 'checklist' | 'checklistTicks'>): { done: number; total: number } {
  const items = job.checklist || [];
  return { done: items.filter(i => stepDone(job, i)).length, total: items.length };
}

/** The first step not done yet (in the job's order), if any. */
export function nextStep(job: Pick<Job, 'checklist' | 'checklistTicks'>): JobChecklistItem | undefined {
  return (job.checklist || []).find(i => !stepDone(job, i));
}

/** "2h 10m" / "45m" — whole minutes, never "27.4833m". */
export function fmtMinutes(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
