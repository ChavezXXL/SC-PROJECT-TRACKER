
export type UserRole = 'admin' | 'employee';

export interface User {
  id: string;
  name: string;
  username: string;
  pin: string;
  role: UserRole;
  isActive: boolean;
}

export type JobStatus = 'pending' | 'in-progress' | 'completed' | 'hold';
export type JobPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Job {
  id: string;
  jobIdsDisplay: string;
  poNumber: string;
  partNumber: string;
  customer?: string; // New
  priority?: JobPriority; // New
  quantity: number;
  dateReceived: string;
  dueDate: string;
  info: string;
  status: JobStatus;
  createdAt: number;
  completedAt?: number;
  expectedHours?: number; // Alert threshold
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
  isAutoClosed?: boolean; // Flag if system auto-closed it
  notes?: string;
  machineId?: string; // New
  sessionQty?: number; // New: Qty completed in this session
}

export interface SystemSettings {
  lunchStart: string; // "12:00"
  lunchEnd: string;   // "12:30"
  lunchDeductionMinutes: number; // 30
  autoClockOutTime: string; // "17:00"
  autoClockOutEnabled: boolean;
  customOperations: string[]; // e.g. ["Cutting", "Deburring"]
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

export type AppView = 'login' | 'admin-dashboard' | 'admin-jobs' | 'admin-logs' | 'admin-team' | 'admin-settings' | 'admin-scan' | 'employee-scan' | 'employee-job';

export interface SmartPasteData {
  poNumber: string | null;
  partNumber: string | null;
  quantity: number | null;
  dueDate: string | null;
  customer?: string | null;
}
