// ═════════════════════════════════════════════════════════════════════
// Finishing Pack — types for Rack, Tank, and Chemistry tracking.
//
// Available when ShopProfile includes: plating, anodizing, passivation,
// coating, deburring (set via the onboarding wizard → enabledFeatures).
//
// Why this matters (vertical SaaS wedge):
//   Generic MRP systems (Katana, Fulcrum, MRPeasy) do not understand
//   plating lines — they track "work orders," not "rack load → tank
//   dwell → post-rinse → inspection." This pack gives finishing shops
//   the exact primitives their process needs.
//
// Models:
//   • Rack         — physical fixture holding parts through a process
//   • TankSession  — timed dwell of a rack in a process tank
//   • ChemistryLog — periodic reading of bath composition (pH, temp,
//                    titration, metal concentration) for ISO compliance
//   • BathAlert    — auto-flag when readings drift outside spec
//
// Persistence: stored alongside jobs in the same DB (Firestore or
// localStorage fallback). Rack IDs are globally unique and scanned
// via QR code on the shop floor.
// ═════════════════════════════════════════════════════════════════════

/** Physical rack / barrel / basket that carries parts through a process. */
export interface Rack {
  id: string;
  /** User-visible code printed on the QR label (e.g. "R-014"). */
  code: string;
  /** Plating / anodizing line this rack belongs to. */
  lineId?: string;
  type: 'rack' | 'barrel' | 'basket' | 'fixture';
  /** Max parts this rack can hold — used for capacity planning. */
  capacity?: number;
  /** Cumulative hours under chemistry — for rework / stripping cycles. */
  totalHours?: number;
  notes?: string;
  createdAt: number;
  /** If true, rack is retired and hidden from the active picker. */
  retired?: boolean;
}

/** A single immersion of a rack in a specific process tank. */
export interface TankSession {
  id: string;
  rackId: string;
  /** Which tank / line step (user-defined in Settings). */
  tankId: string;
  /** Job this rack run is attributable to — one session can serve
   *  multiple jobs if they share a rack. */
  jobIds: string[];
  partCount: number;
  /** Wall-clock start / end of the dwell. */
  startedAt: number;
  endedAt?: number;
  /** Target immersion time (minutes) per the process spec. */
  targetMinutes?: number;
  /** Operator who started the session. */
  startedBy: string;
  startedByName: string;
  endedBy?: string;
  endedByName?: string;
  /** Recorded at end-of-session — compared to `targetMinutes` for OOC flags. */
  actualMinutes?: number;
  /** pH / temp snapshot at session start, for traceability. */
  startReading?: ChemistryReading;
  /** Free-text notes — visible in the audit trail. */
  notes?: string;
}

/** A single row of bath chemistry — what the tank "was" at a moment in time. */
export interface ChemistryReading {
  ph?: number;
  tempF?: number;
  tempC?: number;
  /** Primary metal concentration (oz/gal for plating, g/L for anodizing). */
  metalConcentration?: number;
  /** Titration result — shop-defined units. */
  titration?: number;
  /** Additives / chemistry corrections since last reading. */
  additions?: string;
  /** Anything else the operator logs. */
  notes?: string;
}

export interface ChemistryLog extends ChemistryReading {
  id: string;
  tankId: string;
  /** Logged by — names are stored for the audit trail so a user delete
   *  doesn't erase the historical reading. */
  userId: string;
  userName: string;
  recordedAt: number;
  /** Did the operator make a correction based on this reading? */
  correctionMade?: boolean;
}

/** Process tank (user-defined per shop). */
export interface Tank {
  id: string;
  /** Operator-facing name — "Nickel #1", "Caustic Cleaner". */
  name: string;
  /** Grouping key for dashboards — "plating", "anodizing", "rinse". */
  category: string;
  /** Target operating window — readings outside these trigger a BathAlert. */
  spec?: {
    phMin?: number;
    phMax?: number;
    tempMinF?: number;
    tempMaxF?: number;
    metalMin?: number;
    metalMax?: number;
  };
  /** Required reading cadence (hours) — reminders fire if overdue. */
  readingIntervalHours?: number;
  /** Last time a reading was logged — cached for overdue calc. */
  lastReadingAt?: number;
  retired?: boolean;
}

/** Auto-generated when a chemistry reading falls outside `Tank.spec`. */
export interface BathAlert {
  id: string;
  tankId: string;
  readingId: string;
  /** Which parameter tripped the alert. */
  parameter: 'ph' | 'temp' | 'metal' | 'titration' | 'interval-missed';
  severity: 'warn' | 'critical';
  message: string;
  createdAt: number;
  acknowledgedAt?: number;
  acknowledgedBy?: string;
  resolvedAt?: number;
  resolution?: string;
}

/** Consolidated type for Settings / DB helpers. */
export interface FinishingPackData {
  racks: Rack[];
  tanks: Tank[];
  sessions: TankSession[];
  chemistryLogs: ChemistryLog[];
  alerts: BathAlert[];
}
