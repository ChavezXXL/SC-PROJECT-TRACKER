// ═════════════════════════════════════════════════════════════════
// Shop Goal progress calculation.
// The same function is used by both the TV Goals slide and the Settings
// Goals editor so they always agree.
// ═════════════════════════════════════════════════════════════════

import type { ShopGoal, Job, TimeLog, GoalPeriod } from '../types';

/** Get the start timestamp of the period (day / week / month / quarter / year). */
function goalPeriodStart(period: GoalPeriod): number {
  const now = new Date();
  if (period === 'day') { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  if (period === 'week') { const d = new Date(); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d.getTime(); }
  if (period === 'month') { return new Date(now.getFullYear(), now.getMonth(), 1).getTime(); }
  if (period === 'quarter') { const q = Math.floor(now.getMonth() / 3) * 3; return new Date(now.getFullYear(), q, 1).getTime(); }
  return new Date(now.getFullYear(), 0, 1).getTime();
}

/** Compute current value + completion percent for a single goal against live data. */
export function computeGoalProgress(
  goal: ShopGoal,
  jobs: Job[],
  logs: TimeLog[],
  reworkCount: number,
): { current: number; pct: number } {
  const cutoff = goalPeriodStart(goal.period);
  let current = 0;
  switch (goal.metric) {
    case 'jobs-completed':
      current = jobs.filter(j => j.status === 'completed' && (j.completedAt || 0) >= cutoff).length;
      break;
    case 'hours-logged':
      current = logs
        .filter(l => l.startTime >= cutoff && l.endTime)
        .reduce((a, l) => a + (l.durationMinutes || 0) / 60, 0);
      break;
    case 'revenue':
      current = jobs
        .filter(j => j.status === 'completed' && (j.completedAt || 0) >= cutoff)
        .reduce((a, j) => a + (j.quoteAmount || 0), 0);
      break;
    case 'on-time-delivery': {
      const completed = jobs.filter(j => j.status === 'completed' && (j.completedAt || 0) >= cutoff && j.dueDate);
      if (completed.length === 0) { current = 0; break; }
      const onTime = completed.filter(j => {
        const m = j.dueDate!.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (!m) return false;
        const due = new Date(+m[3], +m[1] - 1, +m[2], 23, 59, 59).getTime();
        return j.completedAt! <= due + 86400000;
      }).length;
      current = Math.round((onTime / completed.length) * 100);
      break;
    }
    case 'rework-count':
      current = reworkCount;
      break;
    case 'customer-jobs': {
      const c = (goal.customerFilter || '').toLowerCase();
      current = jobs.filter(j =>
        (j.completedAt || j.createdAt || 0) >= cutoff &&
        (j.customer || '').toLowerCase() === c
      ).length;
      break;
    }
  }
  const pct = goal.target > 0
    ? Math.max(0, Math.min(100, goal.lowerIsBetter
        ? ((goal.target - current) / goal.target) * 100
        : (current / goal.target) * 100))
    : 0;
  return { current, pct };
}

/** Format a goal value for display (handles $, %, hours, plain counts). */
export function formatGoalValue(goal: ShopGoal, val: number): string {
  if (goal.metric === 'revenue') return '$' + Math.round(val).toLocaleString();
  if (goal.metric === 'on-time-delivery') return Math.round(val) + '%';
  if (goal.metric === 'hours-logged') return val.toFixed(1) + 'h';
  return Math.round(val).toString();
}

/** Get the default unit label for a goal based on its metric. */
export function goalUnit(goal: ShopGoal): string {
  if (goal.unit) return goal.unit;
  switch (goal.metric) {
    case 'jobs-completed': case 'customer-jobs': return 'jobs';
    case 'hours-logged': return 'hrs';
    case 'revenue': return '$';
    case 'on-time-delivery': return '%';
    case 'rework-count': return 'issues';
    default: return '';
  }
}
