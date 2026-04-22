// ═════════════════════════════════════════════════════════════════════
// Schedule layout engine — pure functions that turn jobs into grid cells.
// No React, no DOM — just data in, data out. Easy to unit test.
// ═════════════════════════════════════════════════════════════════════

import type { Job } from '../types';
import type { ScheduledJobCell, ScheduleRowAxis, ScheduleView } from './types';
import { parseDueDate } from '../utils/date';

const DEFAULT_DAILY_HOURS = 8;
const DEFAULT_STAGE_HOURS = 2;

/**
 * Sum the estimated hours across all of a job's stages.
 * Falls back to a default when the job has no estimates.
 */
export function totalEstimatedHours(job: Job): number {
  const est = (job as any).stageEstimates as Record<string, number> | undefined;
  if (!est) return DEFAULT_STAGE_HOURS;
  const total = Object.values(est).reduce((a, h) => a + (Number(h) || 0), 0);
  return total > 0 ? total : DEFAULT_STAGE_HOURS;
}

/**
 * Determine the row (operator / stage / machine) this job should stack in.
 */
export function rowKeyForJob(job: Job, axis: ScheduleRowAxis): string {
  switch (axis) {
    case 'operator':
      return (job as any).assignedOperatorId || 'unassigned';
    case 'stage':
      return job.currentStage || 'unstaged';
    case 'machine':
      // Machine assignment not yet on Job — fall back to stage for now
      return job.currentStage || 'unassigned';
  }
}

/**
 * Convert a job's dueDate into a block on the schedule.
 * The block "ends" on the due date and backs up by estimated hours.
 * If hours exceed a day, it wraps to prior days.
 */
export function placeJobOnGrid(
  job: Job,
  axis: ScheduleRowAxis,
  dailyHours: number = DEFAULT_DAILY_HOURS
): ScheduledJobCell | null {
  const due = parseDueDate(job.dueDate);
  if (!due) return null;

  const hours = totalEstimatedHours(job);
  const endTime = due.getTime();
  const startTime = endTime - hours * 3_600_000;

  return {
    jobId: job.id,
    startTime,
    endTime,
    rowKey: rowKeyForJob(job, axis),
    hours,
  };
}

/**
 * Lay out all jobs on the grid and tag any overlapping blocks as conflicts.
 */
export function layoutJobs(
  jobs: Job[],
  axis: ScheduleRowAxis,
  dailyHours: number = DEFAULT_DAILY_HOURS
): ScheduledJobCell[] {
  const cells = jobs
    .filter(j => j.status !== 'completed')
    .map(j => placeJobOnGrid(j, axis, dailyHours))
    .filter((c): c is ScheduledJobCell => c !== null);

  // Mark conflicts — any two cells in the same row whose time ranges overlap
  const byRow = new Map<string, ScheduledJobCell[]>();
  for (const cell of cells) {
    const list = byRow.get(cell.rowKey) || [];
    list.push(cell);
    byRow.set(cell.rowKey, list);
  }
  byRow.forEach(list => {
    list.sort((a, b) => a.startTime - b.startTime);
    for (let i = 1; i < list.length; i++) {
      if (list[i].startTime < list[i - 1].endTime) {
        list[i].conflict = true;
        list[i - 1].conflict = true;
      }
    }
  });
  return cells;
}

/**
 * Generate the date axis for a given view.
 * Returns an array of midnight-aligned Date objects.
 */
export function axisDates(view: ScheduleView, anchor: Date = new Date()): Date[] {
  const out: Date[] = [];
  const start = new Date(anchor); start.setHours(0, 0, 0, 0);
  switch (view) {
    case 'day':
      out.push(start);
      break;
    case 'week': {
      // Start on Sunday of the anchor week
      const sun = new Date(start); sun.setDate(start.getDate() - start.getDay());
      for (let i = 0; i < 7; i++) {
        const d = new Date(sun); d.setDate(sun.getDate() + i);
        out.push(d);
      }
      break;
    }
    case 'month': {
      const first = new Date(start.getFullYear(), start.getMonth(), 1);
      const days = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
      for (let i = 0; i < days; i++) {
        const d = new Date(first); d.setDate(first.getDate() + i);
        out.push(d);
      }
      break;
    }
  }
  return out;
}
