
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
  customer?: string;
  priority?: JobPriority;
  quantity: number;
  dateReceived: string;
  dueDate: string;
  info: string;
  status: JobStatus;
  createdAt: number;
  completedAt?: number;
  expectedHours?: number;
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
  status?: 'in_progress' | 'completed';
  createdAt?: number;
  updatedAt?: number;
  durationSeconds?: number;
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
