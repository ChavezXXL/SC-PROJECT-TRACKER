
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
  tvAnnouncement?: string;     // Custom scrolling message on TV
  tvAnnouncementColor?: string; // Banner color: 'blue' | 'yellow' | 'red' | 'green'
  tvShowClock?: boolean;       // Show current time on TV header
  tvShowStats?: boolean;       // Show stats strip (workers/running/paused)
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

export type AppView = 'login' | 'admin-dashboard' | 'admin-jobs' | 'admin-logs' | 'admin-team' | 'admin-settings' | 'admin-reports' | 'admin-live' | 'admin-samples' | 'admin-scan' | 'employee-scan' | 'employee-job';

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
