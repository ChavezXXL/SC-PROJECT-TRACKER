// ═════════════════════════════════════════════════════════════════════
// Module: Tank Chemistry + Rack Tracking (plating/anodizing/passivation)
//
// The FabTrack IO "wedge" — Steelhead (the only real competitor in this
// niche) charges $500+/mo; we can ship the same core at $149-349.
//
// Core concepts specific to wet-process shops:
//
//   Tank      — a physical plating / etching / anodize bath
//   Recipe    — a named process spec ("MIL-A-8625 Type II Class 2")
//   Rack      — parts hung on a fixture; move together through tanks
//   Run       — a rack passing through a recipe (= a timed tank session)
//   Reading   — chemistry sample (pH, temp, concentration) on a tank
//   Addition  — chemical add-in event (log for traceability)
//
// This pack only loads when `shopProfile.usesTanks === true` OR one of
// the plating/anodizing/passivation/coating shop types is set.
//
// Phase: dormant. Types only.
// ═════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────
// Tanks
// ─────────────────────────────────────────────────────────────────────

export type TankKind =
  | 'plating'          // nickel, chrome, zinc, tin, gold, silver
  | 'anodize'          // Type I/II/III anodize
  | 'etch'             // acid/alkaline etch, desmut
  | 'passivate'        // citric, nitric passivation
  | 'clean'            // degrease, ultrasonic, alkaline clean
  | 'rinse'            // DI, cascade rinse
  | 'seal'             // anodize seal (hot water / dichromate / nickel acetate)
  | 'strip'            // process strip (mask or plating removal)
  | 'bake'             // embrittlement relief oven — borderline "tank", include here
  | 'other';

export interface Tank {
  id: string;
  tenantId: string;
  name: string;                     // "Nickel Strike Tank"
  kind: TankKind;
  /** Process the tank is set up for. If the tank is multi-use, null. */
  defaultRecipeId?: string;
  /** Line / row position — drives the flow map visualization. */
  lineId?: string;
  lineSequence?: number;
  /** Physical size — volume, working dimensions. */
  capacityGallons?: number;
  workingDimensions?: string;       // "24x36x48 in"
  /** Chemistry targets (for drift tracking + alerts). */
  targets?: {
    temperatureF?: { min: number; max: number };
    pH?: { min: number; max: number };
    concentrationPct?: { min: number; max: number };
    currentDensityAmps?: { min: number; max: number };
  };
  /** Last-known chemistry snapshot — denormalized for fast dashboard queries. */
  lastReading?: TankReading;
  /** Filter / anode / dummy-run schedule. */
  maintenance?: {
    filterChangeHours?: number;
    anodeChangeWeeks?: number;
    lastFilterChangedAt?: number;
    lastAnodeChangedAt?: number;
  };
  archived?: boolean;
  createdAt: number;
  updatedAt: number;
}

// ─────────────────────────────────────────────────────────────────────
// Recipes — named process specs
// ─────────────────────────────────────────────────────────────────────

export interface Recipe {
  id: string;
  tenantId: string;
  name: string;                     // "Boeing ZnNi 10-15 μm Trivalent"
  specReference?: string;           // "AMS 2417 Type 1", "MIL-DTL-5541"
  /** Ordered tank operations this recipe runs through. */
  steps: RecipeStep[];
  /** Incoming requirement (e.g. base metal, prior finish). */
  incomingSpec?: string;
  /** Outgoing requirement — thickness range, cosmetic callouts. */
  outgoingSpec?: string;
  /** Who can approve a run on this recipe. */
  requiresApprovalFrom?: string[];
  /** Customer tags — some recipes are customer-specific. */
  customerScope?: string[];
  archived?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface RecipeStep {
  id: string;
  order: number;
  tankKind: TankKind;
  /** Optional: pin to a specific tank. When empty, the line's default tank is used. */
  tankId?: string;
  durationMinutes: number;          // target dwell time
  temperatureF?: number;
  /** Electro-plate specific. */
  amperage?: number;
  voltage?: number;
  /** Notes — agitate, mask, rotate, etc. */
  instructions?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Racks + Runs
// ─────────────────────────────────────────────────────────────────────

/** A rack / barrel / basket — what parts hang on together. */
export interface Rack {
  id: string;
  tenantId: string;
  label: string;                    // "Rack 7A" or barcode
  kind: 'rack' | 'barrel' | 'basket' | 'fixture';
  capacity?: number;                // max parts that fit
  /** Active job links — what's on it right now. */
  activeJobs: Array<{ jobId: string; jobDisplay: string; qty: number }>;
  /** Current location — which tank it's in, or "staging" / "rinse station". */
  currentLocation?: string;
  archived?: boolean;
  createdAt: number;
}

/** A Run = a rack executing a recipe. One run per trip through the line. */
export interface ProcessRun {
  id: string;
  tenantId: string;
  rackId: string;
  recipeId: string;
  recipeName: string;               // denormalized
  /** What jobs this run is satisfying. */
  jobIds: string[];
  /** Lifecycle. */
  status: 'scheduled' | 'in-progress' | 'paused' | 'complete' | 'scrapped';
  startedAt?: number;
  endedAt?: number;
  /** Per-step timing actuals. */
  stepActuals?: Array<{
    stepId: string;
    tankId: string;
    enteredAt: number;
    exitedAt?: number;
    readings?: TankReading[];
  }>;
  operatorUid: string;
  operatorName: string;
  /** Post-process results — thickness etc. */
  thicknessResults?: Array<{ location: string; value: number; unit: 'um' | 'mil' | 'in' }>;
  /** Pass / fail + notes. */
  outcome?: 'pass' | 'rework' | 'scrap';
  notes?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Tank chemistry logs
// ─────────────────────────────────────────────────────────────────────

export interface TankReading {
  id: string;
  tenantId: string;
  tankId: string;
  at: number;
  temperatureF?: number;
  pH?: number;
  concentrationPct?: number;
  specificGravity?: number;
  /** Operator-measured amperage + voltage (for plating tanks). */
  amperage?: number;
  voltage?: number;
  takenBy: string;
  takenByName: string;
  /** Attached titration sheet / photo of test strip. */
  attachmentUrl?: string;
  notes?: string;
}

export interface TankAddition {
  id: string;
  tenantId: string;
  tankId: string;
  at: number;
  /** What was added. */
  chemicalItemId?: string;          // → InventoryItem (consumes a lot)
  chemicalName: string;             // denormalized for history
  quantity: number;
  unit: string;                     // "gal", "lb", "oz"
  reason: 'maintenance' | 'drift-correction' | 'bath-makeup' | 'startup' | 'other';
  addedBy: string;
  addedByName: string;
  /** Lot number of the chemical consumed — traceability. */
  lotId?: string;
  notes?: string;
}

/** Alert when a tank drifts out of target spec. */
export interface TankAlert {
  id: string;
  tenantId: string;
  tankId: string;
  kind: 'temperature' | 'ph' | 'concentration' | 'overdue-reading' | 'overdue-filter' | 'overdue-anode';
  severity: 'info' | 'warn' | 'critical';
  message: string;
  firstSeenAt: number;
  resolvedAt?: number;
}
