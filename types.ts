
export type UserRole = 'admin' | 'manager' | 'employee';

export interface User {
  id: string;
  employeeId?: string;  // Human-readable unique ID, e.g. "EMP-042" — auto-generated on save
  name: string;
  username: string;
  pin: string;
  role: UserRole;
  isActive: boolean;
  hourlyRate?: number;  // actual $/hr cost for this worker (admin only)
}

export type JobStatus = 'pending' | 'in-progress' | 'completed' | 'hold';
export type JobPriority = 'low' | 'normal' | 'high' | 'urgent';

// ── Job Routing / Workflow Stages ──
export interface JobStage {
  id: string;
  label: string;        // "QC", "Stamping", "Packing", "Shipped"
  color: string;        // hex color for badge
  order: number;
  isComplete?: boolean; // reaching this stage marks job as done
  /** Operation names that should auto-route a job to this stage when a worker
   *  clocks in. When empty, routing falls back to fuzzy label match. */
  operations?: string[];
}

export interface StageHistoryEntry {
  stageId: string;
  timestamp: number;
  userId: string;
  userName?: string;
}

// ── Quoting System ──
export interface QuoteLineItem {
  description: string;
  qty: number;
  unit?: string;             // "ea", "hr", "ft", "lb", "lot"
  unitPrice: number;
  total: number;
  /** Quantity-break pricing tiers (Round 2 #3).
   *  Sorted ascending by minQty. The tier with the highest minQty <= qty is applied.
   *  Example: [{minQty:1, unitPrice:2.50}, {minQty:500, unitPrice:2.20}, {minQty:1000, unitPrice:1.95}]
   *  When set, unitPrice above becomes a fallback; the tier table drives the actual price. */
  priceTiers?: PriceTier[];
}

export interface PriceTier {
  minQty: number;
  unitPrice: number;
}

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';

// ── Customer Contact (reusable across quotes, jobs, invoices) ──
export interface CustomerContact {
  name: string;              // Company / customer name
  contactPerson?: string;    // Person name
  email?: string;
  phone?: string;
  address?: string;          // Full address (street, city, state, zip)
}

export interface Quote {
  id: string;
  quoteNumber: string;       // "Q-001" auto-incrementing
  // ── Customer ──
  customer: string;          // Customer/company name (for backward compat + quick access)
  billTo: CustomerContact;   // Full billing contact
  shipTo?: CustomerContact;  // Optional shipping contact (if different from bill to)
  // ── Project Details (custom fields like PO, Part No, Job No) ──
  projectFields?: Record<string, string>; // e.g. { "Purchase Order": "0076755-00", "Part No.": "MS21907W20" }
  // ── Line Items ──
  items: QuoteLineItem[];
  subtotal: number;
  // ── Pricing ──
  markupPct: number;
  discountPct?: number;      // Optional discount %
  discountAmt?: number;      // Calculated discount amount
  taxRate?: number;           // Tax % (e.g. 9.5)
  taxAmt?: number;            // Calculated tax amount
  total: number;
  // ── Deposit ──
  depositRequired?: boolean;
  depositPct?: number;        // % of total
  depositAmt?: number;        // Calculated deposit amount
  // ── Metadata ──
  status: QuoteStatus;
  validUntil?: string;        // MM/DD/YYYY
  notes?: string;             // Internal/customer-visible notes
  terms?: string;             // Payment terms & conditions
  jobDescription?: string;    // Scope of work description
  createdAt: number;
  sentAt?: number;
  acceptedAt?: number;
  declinedAt?: number;
  linkedJobId?: string;       // Auto-created job when accepted
  createdBy: string;
  createdByName?: string;
  // ── Engagement tracking (Round 2 #14) — how the customer is interacting
  viewedAt?: number;          // First time the customer opened the portal
  lastViewedAt?: number;      // Most recent open
  viewCount?: number;         // Total opens (de-duped by session)
  viewHistory?: QuoteViewEvent[];  // Detailed event log for admin drill-down
  // ── Revision history (Round 2 #11) — track edits made after the quote was sent
  revisions?: QuoteRevision[];
}

/** One portal-view event. Tracked when a customer opens the quote link. */
export interface QuoteViewEvent {
  at: number;                 // timestamp when the view started
  sessionId: string;          // random per-tab so we de-dupe same-session refreshes
  userAgent?: string;         // optional user-agent summary for debugging
  durationMs?: number;        // how long they stayed (set on tab close / next event)
}

/** A snapshot of a quote at a point in time (before an edit after send). */
export interface QuoteRevision {
  version: number;            // 1, 2, 3...
  savedAt: number;
  savedBy: string;
  savedByName?: string;
  // Snapshot of key fields — not the whole quote to keep Firestore docs small
  items: QuoteLineItem[];
  subtotal: number;
  markupPct: number;
  discountPct?: number;
  taxRate?: number;
  total: number;
  jobDescription?: string;
  notes?: string;
  terms?: string;
  changeNote?: string;        // optional admin note explaining the revision
}

export interface JobNote {
  id: string;
  text: string;
  userId: string;
  userName: string;
  timestamp: number;
}

export interface Job {
  id: string;
  jobIdsDisplay: string;
  poNumber: string;
  partNumber: string;
  customer?: string;
  priority?: JobPriority;
  quantity: number;
  dateReceived: string;
  dueDate: string;
  info: string;
  specialInstructions?: string;
  status: JobStatus;
  createdAt: number;
  completedAt?: number;
  expectedHours?: number;
  jobNotes?: JobNote[];
  quoteAmount?: number;        // What the customer pays for this job ($)
  partImage?: string;           // Base64 data URL of the part photo (compressed JPEG)
  // ── Routing / Workflow ──
  currentStage?: string;       // stage id from settings.jobStages
  stageHistory?: StageHistoryEntry[];
  // ── Shipping ──
  shippedAt?: number;
  shippingMethod?: string;     // 'pickup' | 'standard' | 'express' | 'fedex' | 'ups' | custom
  trackingNumber?: string;
  shippingNotes?: string;
  // ── Quoting link ──
  linkedQuoteId?: string;      // the quote that created this job
  // ── Operation checklist (Jobs R1 #1) ──
  checklist?: JobChecklistItem[];
  // ── Multiple attachments (Jobs R1 #2) — drawings, PDFs, cert docs ──
  attachments?: JobAttachment[];
  // ── Time estimates (Jobs R1 #3) — expected vs actual per stage ──
  stageEstimates?: Record<string, number>;  // { stageId: expectedHours }
}

/** A single checklist / routing operation within a job. */
export interface JobChecklistItem {
  id: string;
  label: string;
  done: boolean;
  doneBy?: string;             // user id who checked it
  doneByName?: string;
  doneAt?: number;
  estimatedMinutes?: number;   // optional time estimate for this step
  notes?: string;
  stageId?: string;            // tie to a specific stage (QC, Packing, etc.)
}

/** A file attached to a job — drawing, PDF, photo, etc. */
export interface JobAttachment {
  id: string;
  name: string;                // filename
  type: string;                // MIME type
  size: number;                // bytes
  dataUrl: string;             // base64 data URL (stored inline for simplicity — use Firebase Storage later for large files)
  uploadedAt: number;
  uploadedBy: string;
  uploadedByName?: string;
  category?: 'drawing' | 'photo' | 'cert' | 'inspection' | 'other';
  description?: string;
}

export interface TimeLog {
  id: string;
  jobId: string;
  userId: string;
  userName: string;
  operation: string;
  startTime: number;
  endTime?: number | null;
  durationMinutes?: number | null;
  // New fields for historical accuracy and reporting
  partNumber?: string;
  customer?: string;
  jobIdsDisplay?: string; // Human readable Job ID snapshot
  status?: 'in_progress' | 'completed' | 'paused';
  createdAt?: number;
  updatedAt?: number;
  durationSeconds?: number;
  // Pause fields
  pausedAt?: number | null;
  totalPausedMs?: number;
  pauseReason?: string;
  // Existing fields
  isAutoClosed?: boolean;
  notes?: string;
  machineId?: string;
  sessionQty?: number;
}

// ── Deliveries — track driver runs, GPS miles, and attach to jobs.
// Designed so a shop with an in-house courier can log mileage for tax
// purposes and tell customers "your parts are on the way."
export type DeliveryStatus = 'scheduled' | 'in-progress' | 'delivered' | 'cancelled';

export interface DeliveryStop {
  id: string;
  address: string;
  customerName?: string;
  /** Linked job ids being delivered to this stop (so "what's in the truck"
   *  is a click away from either the Jobs list or the Delivery detail). */
  jobIds: string[];
  /** Set when the driver taps "Arrived at this stop". */
  arrivedAt?: number;
  /** Optional signed-for-by / recipient name captured at delivery. */
  signedBy?: string;
  notes?: string;
  /** Captured lat/lon at arrival for accurate mileage proof. */
  arrivalLat?: number;
  arrivalLon?: number;
}

export interface Delivery {
  id: string;
  /** Auto-generated run number like "DEL-042" for receipts and emails. */
  runNumber: string;
  driverId: string;
  driverName: string;
  status: DeliveryStatus;
  stops: DeliveryStop[];
  startedAt?: number;
  endedAt?: number;
  /** GPS breadcrumbs captured every ~30s while active. Decimated on save. */
  track?: Array<{ lat: number; lon: number; t: number; acc?: number }>;
  /** Computed from the track — final miles driven. Cached here so reports
   *  don't re-walk the polyline every render. */
  milesDriven?: number;
  /** Wall-clock drive time in minutes. */
  durationMinutes?: number;
  /** Cost basis — IRS mileage rate at time of trip × miles. Saved so
   *  historical tax exports don't shift when the IRS rate changes. */
  mileageRateCents?: number;
  /** Optional free-form notes (weather, detours, gas stop, etc.). */
  notes?: string;
  createdAt: number;
  /** Last-updated cache for Firestore subscribe ordering. */
  updatedAt: number;
}

// ── Shift Alarms — configurable audible/visual alerts at specific times of day.
// Fire via browser notification (works backgrounded) + optional audio bell.
// Each value maps to a different synthesized sound in services/shiftAlarms.ts.
export type ShiftAlarmSound =
  | 'bell'        // Classic school/factory bell — rapid ring cluster
  | 'chime'       // Dinner / elevator three-note cascade (break time)
  | 'triangle'    // Single soft dinner-triangle ding
  | 'ship-bell'   // Warm single "clang" — slow fade
  | 'horn'        // Factory air-horn blasts — heard across a loud shop
  | 'siren'       // Rising/falling wail — urgent shift end / lockdown
  | 'silent';

export interface ShiftAlarm {
  id: string;
  label: string;       // Shown to workers in the notification: "Lunch starts" / "Break"
  time: string;        // HH:MM, 24-hour
  enabled: boolean;
  sound?: ShiftAlarmSound;
  /** Custom sound URL — pasted by admin. Overrides `sound` when present.
   *  Accepts any MP3/OGG/WAV the browser can play (Freesound, Mixkit, etc.). */
  customSoundUrl?: string;
  /** How long the alarm should ring, in seconds. Short files loop to fill
   *  the duration. Default 3s. Range 1–30. */
  durationSec?: number;
  /** Days of the week this alarm is active (0=Sun..6=Sat). Empty = every day. */
  days?: number[];
  /** When true, also pause all running timers at this moment (for lunch/breaks). */
  pauseTimers?: boolean;
  /** When true, also auto-clock-out all workers (used for end-of-shift). */
  clockOut?: boolean;
}

export interface SystemSettings {
  lunchStart: string;
  lunchEnd: string;
  autoClockOutTime: string;
  autoClockOutEnabled: boolean;
  customOperations: string[];
  autoLunchPauseEnabled: boolean;
  /** Customizable alarm times — fires audible + visual notification at each.
   *  When absent, the legacy lunchStart/lunchEnd/autoClockOutTime fields are used. */
  shiftAlarms?: ShiftAlarm[];
  /** Master switch for the shift-alarm system (default on). */
  shiftAlarmsEnabled?: boolean;
  clients: string[];
  clientContacts?: Record<string, CustomerContact>; // saved contact info per client name
  clientSlugs?: Record<string, string>; // short URL slug per client (e.g. "S&H Deburring" → "sh-deburring") for simple shareable portal links
  // Shop Financials
  shopRate?: number;           // $/hr billed to workers
  monthlyOverhead?: number;    // Monthly fixed costs (rent, utilities, insurance, etc.)
  monthlyWorkHours?: number;   // Estimated work hours per month (for overhead calc)
  // Shop Info
  companyName?: string;        // Shown in header, print travelers, etc.
  companyLogo?: string;        // URL to logo image
  companyAddress?: string;     // For print travelers
  companyPhone?: string;       // For print travelers
  weeklyGoalHours?: number;    // Weekly target hours per worker (default 40)
  defaultPriority?: string;    // Default priority for new jobs
  // Display
  theme?: 'dark' | 'light';   // UI theme
  // TV Display customization
  tvShowCustomer?: boolean;    // Show customer name on TV cards
  tvShowJobId?: boolean;       // Show Job ID on TV cards
  tvShowElapsedBar?: boolean;  // Show time progress bar
  tvShowPausedBadge?: boolean; // Show paused status badge
  tvCardSize?: 'compact' | 'normal' | 'large'; // Card size on TV
  tvAutoScroll?: boolean;      // Auto-scroll when many workers
  tvCompanyHeader?: boolean;   // Show company name/logo at top of TV
  tvShowClock?: boolean;       // Show current time on TV header
  tvShowStats?: boolean;       // Show stats strip (workers/running/paused)
  tvShowWeather?: boolean;     // Show outside temperature widget (default true)
  // Manual weather location — used when a TV/kiosk device doesn't have geolocation
  // or denies the permission. Lat/lon are resolved from city or zip via geocoding.
  weatherCity?: string;        // e.g. "Fresno, CA" or "93710"
  weatherLat?: number;         // resolved latitude (written after geocoding)
  weatherLon?: number;         // resolved longitude
  tvShowJobsBelt?: boolean;    // Show the auto-scrolling open-jobs panel (default true)
  tvScrollSpeed?: 'slow' | 'normal' | 'fast' | 'off'; // Auto-scroll speed (default normal)
  // ── Document Settings (Quote/Invoice) ──
  quotePrefix?: string;        // e.g. "Q-", "EST-", "SC-" (default "Q-")
  quoteAutoNumber?: boolean;   // auto-increment (default true)
  quoteNextNumber?: number;    // next number to use (default 1)
  defaultPaymentTerms?: string; // e.g. "Net 30"
  defaultQuoteComment?: string; // e.g. "Certificate of Conformance..."
  showShippingOnDocs?: boolean; // show Ship To section
  showDueDateOnDocs?: boolean;  // show due date
  // ── Job Traveler (shop-floor route sheet) customization ──
  // Every shop runs their Traveler a bit different. These flags let admins
  // toggle what lands on the printed sheet without editing code.
  traveler?: {
    showLogo?: boolean;              // Company logo at top (default true)
    showQrCode?: boolean;            // QR of job ID for floor scanning (default true)
    showPartPhoto?: boolean;         // Part reference photo (default true)
    showSpecialInstructions?: boolean;
    showNotes?: boolean;
    showOperationLog?: boolean;      // Blank rows for operator sign-off (default true)
    operationLogRows?: number;       // How many blank rows (default 8, range 4-20)
    showSignOff?: boolean;           // Operator/Inspector sign-off lines (default true)
    showDueDate?: boolean;           // Due date prominently at top (default true)
    showPriority?: boolean;          // Priority badge (default true)
    showCustomer?: boolean;          // Customer block (default true)
    /** Custom footer message — certifications, safety notice, etc. */
    footerText?: string;
    /** Custom header text above the part info (e.g. "ITAR Controlled"). */
    headerBanner?: string;
  };
  showTermsOnDocs?: boolean;    // show payment terms
  taxRate?: number;             // default tax rate %
  // ── Document styling/defaults (appear on quote PDFs) ──
  accentColor?: string;         // Hex color for quote header accent, e.g. '#3b82f6'
  defaultMarkup?: number;       // Default markup % applied to quote calculator
  defaultDiscount?: number;     // Default discount % shown on quotes
  watermark?: string;           // Optional watermark text ('DRAFT', 'SAMPLE', etc.)
  showSignatureLines?: boolean; // Show signature lines on printed quotes
  showUnitCol?: boolean;        // Show the "Unit" column in quote table
  showRateCol?: boolean;        // Show the "Rate" column in quote table
  showQtyCol?: boolean;         // Show the "Qty" column in quote table
  // ── Custom Project Fields (like Invoice2go's PO, Part No, Job No) ──
  customProjectFields?: string[]; // field names shown on quotes/invoices
  // ── Job Workflow Stages ──
  jobStages?: JobStage[];      // Configurable pipeline stages
  // ── Machines / Stations ── (physical work locations)
  machines?: string[];          // e.g. ["Bench 1", "Belt Sander", "Vibratory Tumbler 2"]
  // Slideshow
  tvSlides?: TvSlide[];        // Ordered list of slides for TV rotation
  tvSlideDuration?: number;    // Default seconds per slide (default 15)
  tvSlideshowEnabled?: boolean; // Enable slideshow rotation
  tvToken?: string;            // Unique token for shareable TV URL (?tv=TOKEN)
  // ── Customizable Shop Goals (per-company targets) ──
  shopGoals?: ShopGoal[];
  // ── Shop Profile (set during onboarding wizard — tailors the app per industry) ──
  shopProfile?: ShopProfile;
  enabledFeatures?: EnabledFeatures;
  onboardingComplete?: boolean;   // set true when user finishes the wizard
  // ── TV Privacy toggles (for customer-facing or public TVs) ──
  tvShowRevenue?: boolean;        // Show $ amounts on TV (default false — money is sensitive)
  tvShowCustomerNames?: boolean;  // Show customer names on TV slides (default true)
  // ── Quote productivity: process library + snippets + templates ──
  processTemplates?: ProcessTemplate[];
  quoteSnippets?: QuoteSnippet[];
  quoteTemplates?: QuoteTemplate[];
  // Margin guardrails — warn red when quote's gross profit % drops below this threshold
  minMarginPct?: number;          // default 20
}

// ── QUOTE HELPERS ──

/** A reusable manufacturing process that pre-fills a quote line item.
 *  e.g. "Vibratory Deburr" → setup $75, $0.45/pc, min lot 50 pcs, unit "ea" */
export interface ProcessTemplate {
  id: string;
  name: string;                  // "Vibratory Deburr"
  description?: string;          // default line-item description shown on quote
  unit: string;                  // "ea" | "hr" | "lb" | "lot" etc.
  setupFee?: number;             // one-time setup charge added as a separate line
  pricePerUnit: number;          // $/unit (applies at qty)
  minLot?: number;               // minimum quantity (pricing floor)
  minCharge?: number;            // minimum total charge regardless of qty
  category?: string;             // "Deburring" | "Finishing" | "Inspection" for grouping
  notes?: string;                // internal notes (not shown on quote)
}

/** A reusable text block — "Mil-spec inspection per MIL-STD-1595", payment terms, cert language. */
export interface QuoteSnippet {
  id: string;
  label: string;                 // "Mil-Spec Inspection"
  text: string;                  // the content
  target: 'scope' | 'notes' | 'terms' | 'all'; // which field it inserts into
  category?: string;             // "Quality" | "Shipping" | "Legal" for grouping
}

/** A saved quote structure keyed by customer (or generic) for one-click cloning. */
export interface QuoteTemplate {
  id: string;
  label: string;                 // "Boeing standard quote"
  customer?: string;             // optional: tied to a specific customer name
  items: QuoteLineItem[];        // saved line items
  markupPct?: number;
  discountPct?: number;
  taxRate?: number;
  terms?: string;
  notes?: string;
  jobDescription?: string;
  createdAt: number;
  lastUsedAt?: number;
}

// ═════════════════════════════════════════════════════════════════════
// SHOP PROFILE — collected during onboarding; drives which features show.
// ═════════════════════════════════════════════════════════════════════

export type ShopType =
  | 'deburring'        // Mechanical deburring, vibratory, tumbling
  | 'plating'          // Plating (nickel, chrome, zinc, etc.)
  | 'anodizing'        // Type II/III anodizing
  | 'passivation'      // Stainless steel passivation
  | 'coating'          // Powder coat, paint, e-coat
  | 'machining'        // CNC mill/lathe, manual machining
  | 'welding'          // Welding + fabrication
  | 'fabrication'      // Sheet metal, brake, laser
  | 'assembly'         // Final assembly, kitting
  | 'molding'          // Injection mold, thermoforming
  | 'woodworking'      // Wood shop
  | 'other';           // Custom / fallback

export type ShopSize = 'solo' | 'small' | 'medium' | 'large'; // 1 | 2-5 | 6-15 | 15+

export type ChargeBasis = 'hour' | 'piece' | 'lot' | 'mixed';

export type Certification = 'iso-9001' | 'as-9100' | 'nadcap' | 'itar' | 'fda' | 'as-9102' | 'other';

export interface ShopProfile {
  /** Primary + secondary services — can be multiple. E.g. ['deburring', 'passivation'] */
  types: ShopType[];
  size: ShopSize;
  certifications: Certification[];
  chargesBy: ChargeBasis[];
  /** Does the shop have chemistry tanks (plating, anodizing, passivation, cleaning)? */
  usesTanks: boolean;
  /** Does the shop group parts into batches/racks that move together through processes? */
  usesBatches: boolean;
  /** Does the shop track non-conformances / rework formally? */
  tracksNCR: boolean;
  /** Does the shop quote work for customers? */
  makesQuotes: boolean;
  /** Do workers clock in with PINs on a shared tablet (vs everyone has a login)? */
  sharedFloorTablet: boolean;
  /** Raw notes the user typed during onboarding — for later customization tuning */
  notes?: string;
  /** Set on first save — never changes */
  completedAt: number;
}

/** Feature flags derived from the shop profile. The UI checks these to decide
 *  whether to render a given section / menu item. Admins can override manually. */
export interface EnabledFeatures {
  // Finishing Pack
  rackTracking: boolean;
  tankSessions: boolean;
  chemistryLog: boolean;
  // ISO Compliance Pack
  ncrModule: boolean;
  auditTrail: boolean;
  // Assembly Pack
  bomTracking: boolean;
  kitting: boolean;
  // Quoting
  quoteProcessLibrary: boolean;
  quoteMarginCalc: boolean;
  // Core
  samples: boolean;
  tvSlideshow: boolean;
  customerPortal: boolean;
  scheduler: boolean;
}

export type TvSlideType =
  | 'workers'        // Currently running workers (default left column)
  | 'jobs'           // All open jobs belt (default right column)
  | 'leaderboard'    // Ranked workers by hours/jobs this week
  | 'weather'        // Current + 5-day forecast
  | 'stats-week'     // Weekly stats with graphs
  | 'goals'          // Customizable shop goals with progress
  | 'flow-map'       // Visual flow of jobs through each workflow stage
  | 'safety'         // Safety message with big icon
  | 'message'        // Custom announcement
  | 'stats';         // Legacy simple stats (kept for backward compat)

// ── SHOP GOALS ─ customizable targets every shop can define
export type GoalMetric =
  | 'jobs-completed'      // count of jobs with status='completed'
  | 'hours-logged'        // sum of time logs
  | 'revenue'             // sum of quoteAmount on completed jobs
  | 'on-time-delivery'    // % of completed jobs delivered by dueDate
  | 'rework-count'        // count of open rework entries (lower is better)
  | 'customer-jobs';      // count of jobs for a specific customer

export type GoalPeriod = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface ShopGoal {
  id: string;
  label: string;                // "Jobs Completed This Week"
  metric: GoalMetric;
  period: GoalPeriod;
  target: number;               // e.g. 20
  unit?: string;                // auto-filled per metric but can override ("jobs", "hrs", "$")
  color?: 'blue' | 'emerald' | 'amber' | 'purple' | 'red' | 'cyan';
  lowerIsBetter?: boolean;      // For metrics like rework-count
  customerFilter?: string;      // For 'customer-jobs' metric
  enabled: boolean;
  showOnTv?: boolean;           // Show in Goals TV slide
  showOnDashboard?: boolean;    // Show on admin dashboard
}

// A single message within a safety/announcement slide.
// Safety and announcement slides can hold MANY messages that cycle — one per rotation.
export interface SlideMessage {
  id: string;
  title?: string;
  body?: string;
  color?: 'blue' | 'yellow' | 'red' | 'green' | 'white' | 'orange';
  icon?: string;               // emoji icon (safety slides)
}

export interface TvSlide {
  id: string;
  type: TvSlideType;
  enabled: boolean;
  duration?: number;           // Override seconds for this slide
  // Legacy single-message fields (kept for backward compat; new entries use messages[])
  title?: string;
  body?: string;
  color?: 'blue' | 'yellow' | 'red' | 'green' | 'white' | 'orange';
  icon?: string;               // emoji or icon name
  // Safety & announcement slides: array of messages that cycle one per rotation
  messages?: SlideMessage[];
  // Leaderboard options
  leaderboardMetric?: 'hours' | 'jobs' | 'mixed';   // default 'mixed'
  leaderboardPeriod?: 'today' | 'week' | 'month';   // default 'week'
  leaderboardCount?: number;                         // how many to show, default 5
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

export type AppView = 'login' | 'admin-dashboard' | 'admin-jobs' | 'admin-board' | 'admin-calendar' | 'admin-logs' | 'admin-team' | 'admin-settings' | 'admin-reports' | 'admin-live' | 'admin-samples' | 'admin-scan' | 'admin-quotes' | 'admin-quality' | 'admin-deliveries' | 'employee-scan' | 'employee-job';

// ── Quality / Rework Tracking ──
export type ReworkReason = 'finish' | 'dimensional' | 'missed-area' | 'damage' | 'wrong-part' | 'other';
export type ReworkStatus = 'open' | 'in-rework' | 'resolved';

export interface ReworkEntry {
  id: string;
  createdAt: number;
  jobId?: string;           // optional link to the Job
  poNumber?: string;        // denormalized for display even if job deleted
  partNumber?: string;
  customer?: string;
  reason: ReworkReason;
  quantity: number;
  reporterUserId: string;
  reporterName: string;
  status: ReworkStatus;
  notes?: string;
  photoUrl?: string;
  resolvedAt?: number;
  resolvedBy?: string;
  resolvedByName?: string;
  resolutionNotes?: string;
}

export interface SampleWorkEntry {
  id: string;
  userId: string;
  userName: string;
  operation: string;
  startTime: number;
  endTime?: number | null;
  durationSeconds?: number;
  pausedAt?: number | null;
  totalPausedMs?: number;
  notes?: string;
  qty?: number;
}

export interface Sample {
  id: string;
  companyName: string;
  partNumber: string;
  partName: string;
  photoUrl: string;
  difficulty: 'easy' | 'medium' | 'hard';
  notes: string;
  qty?: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  // Work tracking
  workEntries?: SampleWorkEntry[];
  activeEntry?: SampleWorkEntry | null;
  totalWorkedMs?: number;
}

export interface SmartPasteData {
  poNumber: string | null;
  partNumber: string | null;
  quantity: number | null;
  dueDate: string | null;
  customer?: string | null;
}
