// ═════════════════════════════════════════════════════════════════════
// Module: Job Costing
//
// Live actual-vs-quoted roll-up per job. All inputs already exist in
// the app (TimeLog, Job.quoteAmount, PurchaseOrder.linkedJobIds, etc.);
// this module is the aggregation layer.
//
// Phase: dormant. Types only.
// ═════════════════════════════════════════════════════════════════════

/** Snapshot of a job's cost state at a point in time.
 *  Computed on-the-fly OR cached hourly — TBD when we build the service. */
export interface JobCostSnapshot {
  jobId: string;
  tenantId: string;
  jobDisplay: string;              // "0076617-00"
  customer?: string;
  /** Quote amount for the job — the revenue side. */
  quotedAmount: number;
  /** Sum of time-log durations × worker rate. */
  laborActual: number;
  laborEstimated?: number;
  /** Sum of materials consumed (from inventory transactions, when built). */
  materialActual: number;
  materialEstimated?: number;
  /** Sum of PO line totals linked to this job (outsourcing/heat treat/etc). */
  outsideServicesActual: number;
  outsideServicesEstimated?: number;
  /** Shop overhead allocation — computed from settings.monthlyOverhead + monthlyWorkHours. */
  overheadAllocated: number;
  /** Total cost side. */
  totalActualCost: number;
  /** Gross profit = quotedAmount - totalActualCost. */
  grossProfit: number;
  grossMarginPct: number;
  /** When true, the job's profitability dropped below settings.minMarginPct — flag red on dashboard. */
  underMargin: boolean;
  /** Convenience: how many hours are logged (for quick glance). */
  hoursLogged: number;
  computedAt: number;
}

/** Per-workcenter cost breakdown — used in the advanced report. */
export interface WorkcenterCostRow {
  jobId: string;
  stageId: string;
  stageLabel: string;
  hoursLogged: number;
  laborCost: number;
  materialsConsumed: number;
  notes?: string;
}

/** Per-period cost roll-up for the whole shop. */
export interface ShopCostPeriod {
  periodStart: number;
  periodEnd: number;
  totalRevenue: number;
  totalLabor: number;
  totalMaterials: number;
  totalOverhead: number;
  grossProfit: number;
  avgMarginPct: number;
  jobsCompleted: number;
  underMarginCount: number;        // how many jobs finished below target margin
  topUnderMarginJobs: Array<{ jobId: string; display: string; marginPct: number }>;
}

/** User-editable cost overrides (e.g. "this job used $500 of misc material not tracked in inventory"). */
export interface CostOverride {
  id: string;
  jobId: string;
  kind: 'material' | 'labor' | 'outside-service' | 'overhead' | 'other';
  amount: number;
  note: string;
  addedBy: string;
  addedByName?: string;
  addedAt: number;
}
