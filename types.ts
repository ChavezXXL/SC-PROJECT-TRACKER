
export type UserRole = 'admin' | 'employee';

export interface User {
  id: string;
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

export interface SystemSettings {
  lunchStart: string;
  lunchEnd: string;
  lunchDeductionMinutes: number;
  autoClockOutTime: string;
  autoClockOutEnabled: boolean;
  customOperations: string[];
  autoLunchPauseEnabled: boolean;
  clients: string[];
  clientContacts?: Record<string, CustomerContact>; // saved contact info per client name
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
  tvRefreshRate?: number;      // Seconds between ticker updates
  tvCompanyHeader?: boolean;   // Show company name/logo at top of TV
  tvAnnouncement?: string;     // Legacy single message (kept for backward compat)
  tvAnnouncementColor?: string; // Legacy banner color
  tvShowClock?: boolean;       // Show current time on TV header
  tvShowStats?: boolean;       // Show stats strip (workers/running/paused)
  // ── Document Settings (Quote/Invoice) ──
  quotePrefix?: string;        // e.g. "Q-", "EST-", "SC-" (default "Q-")
  quoteAutoNumber?: boolean;   // auto-increment (default true)
  quoteNextNumber?: number;    // next number to use (default 1)
  invoicePrefix?: string;      // e.g. "INV-", "00" (default "INV-")
  invoiceNextNumber?: number;
  defaultPaymentTerms?: string; // e.g. "Net 30"
  defaultQuoteComment?: string; // e.g. "Certificate of Conformance..."
  showShippingOnDocs?: boolean; // show Ship To section
  showDueDateOnDocs?: boolean;  // show due date
  showTermsOnDocs?: boolean;    // show payment terms
  taxRate?: number;             // default tax rate %
  // ── Custom Project Fields (like Invoice2go's PO, Part No, Job No) ──
  customProjectFields?: string[]; // field names shown on quotes/invoices
  // ── Job Workflow Stages ──
  jobStages?: JobStage[];      // Configurable pipeline stages
  // Slideshow
  tvSlides?: TvSlide[];        // Ordered list of slides for TV rotation
  tvSlideDuration?: number;    // Default seconds per slide (default 15)
  tvSlideshowEnabled?: boolean; // Enable slideshow rotation
  tvToken?: string;            // Unique token for shareable TV URL (?tv=TOKEN)
}

export interface TvSlide {
  id: string;
  type: 'workers' | 'message' | 'stats';
  enabled: boolean;
  duration?: number;           // Override seconds for this slide
  // Message slide fields
  title?: string;
  body?: string;
  color?: 'blue' | 'yellow' | 'red' | 'green' | 'white';
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

export type AppView = 'login' | 'admin-dashboard' | 'admin-jobs' | 'admin-logs' | 'admin-team' | 'admin-settings' | 'admin-reports' | 'admin-live' | 'admin-samples' | 'admin-scan' | 'admin-quotes' | 'employee-scan' | 'employee-job';

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
