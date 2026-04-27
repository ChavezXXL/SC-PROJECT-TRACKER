// ═════════════════════════════════════════════════════════════════════
// Module: BOM + Routing Templates
//
// Bill of materials = what parts + consumables a job needs.
// Routing template = the ordered list of operations with setup/run times.
//
// Key idea: reusable per-part-number definitions. "Every time we do part
// NAS1762W1212, it takes 30 min programming, 15 min setup, 4 min/piece
// run time, and consumes 0.25 lb of 303SS bar."
//
// Works with:
//   • InventoryItem (BOM references items to consume)
//   • JobStage / Machine (routing references stages + workcenters)
//   • Job.quoteAmount / quoting engine (for material + labor cost predictions)
//
// Phase: dormant. Types only.
// ═════════════════════════════════════════════════════════════════════

/** A saved BOM = list of items (with qty) required to make ONE unit of a part. */
export interface BomDefinition {
  id: string;
  tenantId: string;
  partNumber: string;               // e.g. "NAS1762W1212"
  partDescription?: string;
  customer?: string;                // optional — some BOMs are customer-specific
  revision?: string;                // "Rev C"
  effectiveFrom?: number;           // when this BOM becomes current
  /** Items consumed per finished unit. */
  items: BomLineItem[];
  /** Free-form notes — "use only 303SS per customer spec". */
  notes?: string;
  createdAt: number;
  updatedAt: number;
  /** Optional: is this a sub-assembly referenced by parent BOMs? */
  isSubassembly?: boolean;
  /** Phantom parts = pulled through, not tracked as inventory. */
  isPhantom?: boolean;
  archived?: boolean;
}

export interface BomLineItem {
  id: string;
  /** What gets consumed — an inventory item. */
  itemId?: string;                  // → InventoryItem
  /** Inline description if not yet linked to inventory. */
  description?: string;
  /** Quantity per finished unit. */
  qtyPer: number;
  unit: string;                     // "ea" | "in" | "lb" | ...
  /** Scrap factor — add 10% for expected waste. */
  scrapPct?: number;
  /** Optional sub-assembly reference. */
  subassemblyBomId?: string;
  notes?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Routing Template
// ─────────────────────────────────────────────────────────────────────

/** A reusable sequence of operations that defines how a part is built. */
export interface RoutingTemplate {
  id: string;
  tenantId: string;
  partNumber: string;
  partDescription?: string;
  customer?: string;
  revision?: string;
  steps: RoutingStep[];
  /** Total cycle time summary — computed from steps. */
  totalSetupMinutes: number;
  totalRunMinutesPerPiece: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
}

export interface RoutingStep {
  id: string;
  order: number;                    // 1, 2, 3 — sequence
  operation: string;                // "Mill Op 1" / "Deburr" / "FAI"
  stageId?: string;                 // → settings.jobStages
  /** Workcenter / machine this typically runs on. */
  machineId?: string;
  machineName?: string;
  /** Setup + run times. */
  setupMinutes: number;
  runMinutesPerPiece: number;
  /** Which worker type / operation qualification is required. */
  requiredQualification?: string;
  /** Inspection requirements at this step. */
  inspectionReq?: 'none' | 'in-process' | 'first-article' | 'final';
  /** Per-step standard cost (hourly rate × minutes + any fixed cost). */
  standardCostPerPiece?: number;
  /** Link to drawing / specs needed at this step. */
  drawingId?: string;               // → DrawingDefinition
  notes?: string;
}

/** Applied to a specific job: a snapshot of the routing + BOM at job creation. */
export interface JobRouting {
  jobId: string;
  tenantId: string;
  /** Snapshot so future template edits don't rewrite history. */
  templateId?: string;              // source template (may be null for one-off)
  templateRevision?: string;
  steps: RoutingStep[];
  bomSnapshot?: BomLineItem[];
  /** Per-step actual times accumulated from TimeLog. Filled live by the aggregator. */
  actualByStep?: Record<string, { setupMinutes: number; runMinutes: number; piecesRun: number }>;
  createdAt: number;
}
