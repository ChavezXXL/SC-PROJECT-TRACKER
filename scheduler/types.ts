// ═════════════════════════════════════════════════════════════════════
// Scheduler — types for drag-and-drop production planning.
//
// Philosophy: Jobs already have a stage + dueDate + stageEstimates.
// The scheduler doesn't invent new state — it visualizes existing
// jobs across a time grid and lets you reorder them by stage.
//
// Views:
//   • Day   — today only, hour columns, worker rows
//   • Week  — 7 days, stage columns, job cards stack per day
//   • Month — calendar overlay showing due dates + jams
//
// Drag semantics:
//   Moving a card UPDATES the job's dueDate (week view) OR its
//   assignedOperator (day view). Stage order is NOT changed by
//   the scheduler — use the Job Board for that.
//
// Constraints (tier-gated):
//   • Free   — read-only schedule view
//   • Pro    — drag to reschedule + reassign operators
//   • Prem   — capacity planning with machine slots + what-if mode
// ═════════════════════════════════════════════════════════════════════

import type { Job, User } from '../types';

/** How the schedule grid is sliced. */
export type ScheduleView = 'day' | 'week' | 'month';

/** Row axis of the schedule grid. */
export type ScheduleRowAxis = 'operator' | 'stage' | 'machine';

/** One cell = one job placed on the timeline. */
export interface ScheduledJobCell {
  jobId: string;
  /** Start timestamp — used for day view (which hour slot). */
  startTime: number;
  /** End timestamp. Calculated from stageEstimates when missing. */
  endTime: number;
  /** Row key — operator id, stage id, or machine id. */
  rowKey: string;
  /** Estimated hours in this cell — drives visual width. */
  hours: number;
  /** Soft-conflict flag — something else is booked in the same slot. */
  conflict?: boolean;
}

/** Machine / workstation (tier-gated; Pro+). */
export interface Machine {
  id: string;
  name: string;
  /** Stage this machine serves — so "Mill #2" auto-fits to "Machining". */
  stageIds: string[];
  /** Operators qualified to run this machine. */
  qualifiedUserIds: string[];
  /** Hours available per day (default 8). */
  dailyCapacityHours?: number;
  retired?: boolean;
}

/** A what-if plan stored separately from the live schedule. */
export interface SchedulePlan {
  id: string;
  name: string;
  createdAt: number;
  createdBy: string;
  createdByName: string;
  /** Overrides by job id: new start time + row assignment. */
  overrides: Record<string, { startTime?: number; rowKey?: string }>;
  notes?: string;
  /** Has this plan been committed to the live schedule? */
  applied?: boolean;
  appliedAt?: number;
}

/** Props for the root Scheduler component. */
export interface SchedulerProps {
  jobs: Job[];
  users: User[];
  machines?: Machine[];
  view: ScheduleView;
  rowAxis: ScheduleRowAxis;
  /** Clicked a card — parent opens the job modal. */
  onJobSelect?: (jobId: string) => void;
  /** Moved a card — parent writes the change to the job. */
  onJobMove?: (jobId: string, changes: { dueDate?: string; assignedOperatorId?: string }) => Promise<void> | void;
  /** Read-only mode — Free tier. */
  readOnly?: boolean;
}
