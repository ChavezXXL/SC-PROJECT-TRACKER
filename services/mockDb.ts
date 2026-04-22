import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  limit,
  query,
  setDoc,
  updateDoc,
  arrayUnion,
} from "firebase/firestore";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

import type { Job, TimeLog, User, SystemSettings, Sample, SampleWorkEntry, Quote, ReworkEntry } from "../types";
import {
  initFirebaseFromLocalStorage,
  saveFirebaseConfig as saveCfg,
  validateConnection
} from "./firebaseClient";

// --------------------
// STATUS MANAGEMENT
// --------------------
let firebaseStatus: { connected: boolean; error?: string } = {
  connected: false,
};

let dbInstance: any = null;

// Initialize immediately
const initRes = initFirebaseFromLocalStorage();

if (initRes.ok && initRes.db) {
    dbInstance = initRes.db;
    firebaseStatus = { connected: true }; 
    
    // Execute Health Checks (Read & Write)
    (async () => {
        try {
            await validateConnection(dbInstance);
            await setDoc(doc(dbInstance, "__debug", "test"), {
                createdAt: Date.now(),
                source: "diagnostic_test",
                status: "ok",
                info: "If this exists, Firestore writes are WORKING."
            });
            firebaseStatus = { connected: true };
        } catch (e: any) {
            console.error("â Connection/Diagnostic Check Failed. FORCING OFFLINE MODE.", e);
            handleError(e);
            dbInstance = null;
            firebaseStatus = { connected: false, error: "Offline Mode (Connection Failed)" };
        }
    })();

} else {
    firebaseStatus = { connected: false, error: initRes.error };
}

function handleError(e: any) {
    let msg = e.message || "Unknown Error";
    if (msg.includes("permission") || msg.includes("insufficient")) {
        msg = "Permission Denied: Check Firestore Rules.";
    } else if (msg.includes("offline") || msg.includes("client is offline")) {
        msg = "Network Offline";
    } else if (msg.includes("not found")) {
        msg = "Database Not Found (Check Project ID)";
    } else if (msg.includes("Invalid data") || msg.includes("undefined")) {
        msg = "Data Error: Invalid field value";
    }
    
    console.error("DB Error:", msg, e);
    firebaseStatus = { connected: false, error: msg };
    return new Error(msg);
}

// --------------------
// HELPER: Sanitize for Firestore
// --------------------
// Removes undefined fields to prevent Firestore crashes ("Function DocumentReference.set() called with invalid data. Unsupported field value: undefined")
function sanitize(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => sanitize(item));
  const clean: any = {};
  Object.keys(obj).forEach(key => {
    if (obj[key] !== undefined) {
      clean[key] = sanitize(obj[key]);
    }
  });
  return clean;
}

// --------------------
// PUBLIC API
// --------------------

export function isFirebaseConnected() {
  return firebaseStatus;
}

export function saveFirebaseConfig(cfg: any) {
  saveCfg(cfg);
}

// --------------------
// FIREBASE STORAGE - Photo Upload
// --------------------
export async function uploadSamplePhoto(file: File | Blob, sampleId: string): Promise<string> {
  if (!dbInstance) {
    throw new Error('Firebase not connected — cannot upload photo');
  }
  const storage = getStorage();
  const path = `sample-photos/${sampleId}_${Date.now()}.jpg`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file, { contentType: 'image/jpeg' });
  return getDownloadURL(ref);
}

// --------------------
// LOCAL STORAGE FALLBACK CONSTANTS
// --------------------
const LS = {
  jobs: "nexus_jobs",
  logs: "nexus_logs",
  users: "nexus_users",
  settings: "nexus_settings",
  quotes: "nexus_quotes",
};

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// Observer registry — localSubscribe callers get notified immediately after any writeLS.
// This makes pause/resume/edit feel instant in localStorage mode instead of waiting for the 2s poll.
const localSubscribers = new Set<() => void>();
function writeLS<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
  // Notify in a microtask so writes complete before reads
  queueMicrotask(() => localSubscribers.forEach(n => { try { n(); } catch {} }));
}

function ensureSeedUsers() {
  const users = readLS<User[]>(LS.users, []);
  
  const hardcodedAdmins: User[] = [
    { id: "admin_anthony", name: "Anthony", username: "anthony", pin: "2061", role: "admin", isActive: true },
    { id: "admin_chavez", name: "Chavez", username: "chavez", pin: "2061", role: "admin", isActive: true },
    { id: "admin1", name: "Shop Manager", username: "admin", pin: "9999", role: "admin", isActive: true },
    { id: "emp1", name: "John Doe", username: "jdoe", pin: "1234", role: "employee", isActive: true },
  ];

  let changed = false;
  const merged = [...users];

  hardcodedAdmins.forEach(admin => {
     const existingIndex = merged.findIndex(u => u.username.toLowerCase() === admin.username.toLowerCase());
     if (existingIndex === -1) {
         merged.push(admin);
         changed = true;
     } else {
         const existing = merged[existingIndex];
         if (existing.pin !== admin.pin || existing.role !== admin.role) {
             merged[existingIndex] = { ...existing, pin: admin.pin, role: admin.role, isActive: true };
             changed = true;
         }
     }
  });

  if (changed || users.length === 0) {
      writeLS(LS.users, merged);
  }
}

function localSubscribe<T>(getter: () => T, cb: (v: T) => void) {
  cb(getter());
  const notify = () => cb(getter());
  localSubscribers.add(notify);
  const i = setInterval(notify, 3000); // slower fallback in case a write came from another tab
  return () => { localSubscribers.delete(notify); clearInterval(i); };
}

const COL = {
  jobs: "jobs",
  logs: "logs",
  users: "users",
  settings: "settings",
  quotes: "quotes",
};

// --------------------
// JOBS
// --------------------
export function subscribeJobs(cb: (jobs: Job[]) => void) {
  if (dbInstance) {
    const colRef = collection(dbInstance, COL.jobs);
    return onSnapshot(colRef, 
      (snap) => {
        firebaseStatus = { connected: true };
        const jobs = snap.docs.map((d) => d.data() as Job);
        cb(jobs);
      },
      (err) => {
        handleError(err);
        cb(readLS<Job[]>(LS.jobs, []));
      }
    );
  }
  return localSubscribe(() => readLS<Job[]>(LS.jobs, []), cb);
}

export async function getJobById(id: string): Promise<Job | null> {
  if (dbInstance) {
      try {
        const snap = await getDoc(doc(dbInstance, COL.jobs, id));
        firebaseStatus = { connected: true };
        return snap.exists() ? (snap.data() as Job) : null;
      } catch (e) {
        throw handleError(e);
      }
  }
  const jobs = readLS<Job[]>(LS.jobs, []);
  return jobs.find((j) => j.id === id) || null;
}

export async function saveJob(job: Job) {
  if (dbInstance) {
      try {
        await setDoc(doc(dbInstance, COL.jobs, job.id), sanitize(job), { merge: true });
        firebaseStatus = { connected: true };
      } catch (e) {
        throw handleError(e);
      }
      return;
  }
  const jobs = readLS<Job[]>(LS.jobs, []);
  const idx = jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) jobs[idx] = job;
  else jobs.push(job);
  writeLS(LS.jobs, jobs);
}

// Rename customer on every matching job. Case-sensitive match for `oldNames`.
// Used by Settings → Customers merge tool.
export async function renameCustomer(oldNames: string[], newName: string): Promise<number> {
  const oldSet = new Set(oldNames);
  let count = 0;
  if (dbInstance) {
    try {
      const snap = await getDocs(collection(dbInstance, COL.jobs));
      const writes: Promise<any>[] = [];
      snap.forEach((d: any) => {
        const j = d.data() as Job;
        if (j.customer && oldSet.has(j.customer) && j.customer !== newName) {
          writes.push(setDoc(doc(dbInstance, COL.jobs, j.id), { ...j, customer: newName }, { merge: true }));
          count++;
        }
      });
      await Promise.all(writes);
      firebaseStatus = { connected: true };
    } catch (e) {
      throw handleError(e);
    }
    return count;
  }
  const jobs = readLS<Job[]>(LS.jobs, []);
  const updated = jobs.map(j => {
    if (j.customer && oldSet.has(j.customer) && j.customer !== newName) { count++; return { ...j, customer: newName }; }
    return j;
  });
  writeLS(LS.jobs, updated);
  return count;
}

export async function deleteJob(id: string) {
  if (dbInstance) {
      try {
        await deleteDoc(doc(dbInstance, COL.jobs, id));
        firebaseStatus = { connected: true };
      } catch (e) {
        throw handleError(e);
      }
      return;
  }
  const jobs = readLS<Job[]>(LS.jobs, []).filter((j) => j.id !== id);
  writeLS(LS.jobs, jobs);
  const logs = readLS<TimeLog[]>(LS.logs, []).filter((l) => l.jobId !== id);
  writeLS(LS.logs, logs);
}

export async function completeJob(id: string) {
  const completedAt = Date.now();
  if (dbInstance) {
      try {
        await updateDoc(doc(dbInstance, COL.jobs, id), { status: "completed", completedAt } as any);
        firebaseStatus = { connected: true };
      } catch (e) {
        throw handleError(e);
      }
      return;
  }
  const jobs = readLS<Job[]>(LS.jobs, []);
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx >= 0) {
    jobs[idx] = { ...jobs[idx], status: "completed", completedAt } as Job;
    writeLS(LS.jobs, jobs);
  }
}

export async function addJobNote(jobId: string, text: string, userId: string, userName: string) {
  const note = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, userId, userName, timestamp: Date.now() };
  if (dbInstance) {
    try {
      await updateDoc(doc(dbInstance, COL.jobs, jobId), { jobNotes: arrayUnion(note) } as any);
      firebaseStatus = { connected: true };
    } catch (e) { throw handleError(e); }
    return;
  }
  const jobs = readLS<Job[]>(LS.jobs, []);
  const idx = jobs.findIndex(j => j.id === jobId);
  if (idx >= 0) {
    if (!jobs[idx].jobNotes) jobs[idx].jobNotes = [];
    jobs[idx].jobNotes!.push(note);
    writeLS(LS.jobs, jobs);
  }
}

export async function reopenJob(id: string) {
  if (dbInstance) {
      try {
         await updateDoc(doc(dbInstance, COL.jobs, id), { status: "pending", completedAt: null } as any);
         firebaseStatus = { connected: true };
      } catch (e) {
         throw handleError(e);
      }
      return;
  }
  const jobs = readLS<Job[]>(LS.jobs, []);
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx >= 0) {
    const j = jobs[idx] as any;
    jobs[idx] = { ...j, status: "pending", completedAt: null } as Job;
    writeLS(LS.jobs, jobs);
  }
}

// Advance a job to the next workflow stage
export async function advanceJobStage(id: string, stageId: string, userId: string, userName: string, isComplete?: boolean) {
  const updates: any = {
    currentStage: stageId,
    stageHistory: arrayUnion({ stageId, timestamp: Date.now(), userId, userName }),
  };
  if (isComplete) {
    updates.status = 'completed';
    updates.completedAt = Date.now();
  } else if (stageId === 'in-progress') {
    updates.status = 'in-progress';
  }
  if (stageId === 'shipped') {
    updates.shippedAt = Date.now();
  }
  if (dbInstance) {
    try {
      await updateDoc(doc(dbInstance, COL.jobs, id), updates);
      firebaseStatus = { connected: true };
    } catch (e) { throw handleError(e); }
    return;
  }
  const jobs = readLS<Job[]>(LS.jobs, []);
  const idx = jobs.findIndex(j => j.id === id);
  if (idx >= 0) {
    const j = jobs[idx] as any;
    const history = j.stageHistory || [];
    history.push({ stageId, timestamp: Date.now(), userId, userName });
    jobs[idx] = { ...j, currentStage: stageId, stageHistory: history, ...(isComplete ? { status: 'completed', completedAt: Date.now() } : {}), ...(stageId === 'shipped' ? { shippedAt: Date.now() } : {}), ...(stageId === 'in-progress' ? { status: 'in-progress' } : {}) } as Job;
    writeLS(LS.jobs, jobs);
  }
}

// --------------------
// LOGS
// --------------------
export function subscribeLogs(cb: (logs: TimeLog[]) => void) {
  if (dbInstance) {
    // Limit to 500 most recent logs to conserve Firebase free-tier reads
    const q = query(collection(dbInstance, COL.logs), orderBy('startTime', 'desc'), limit(500));
    return onSnapshot(q,
      (snap) => {
        firebaseStatus = { connected: true };
        const logs = snap.docs.map((d) => d.data() as TimeLog);
        cb(logs);
      },
      (err) => {
        handleError(err);
        cb(readLS<TimeLog[]>(LS.logs, []));
      }
    );
  }
  return localSubscribe(() => readLS<TimeLog[]>(LS.logs, []), cb);
}

export function subscribeActiveLogs(cb: (logs: TimeLog[]) => void) {
  return subscribeLogs((all) => cb(all.filter((l) => !l.endTime)));
}

// UPDATED: Now accepts partNumber, customer, and jobIdsDisplay for snapshotting
export async function startTimeLog(
    jobId: string, 
    userId: string, 
    userName: string, 
    operation: string, 
    partNumber?: string,
    customer?: string,
    machineId?: string, 
    notes?: string,
    jobIdsDisplay?: string
) {
  const id = Date.now().toString();
  const startTime = Date.now();
  
  // Construct log object carefully
  const log: TimeLog = {
    id, 
    jobId, 
    userId, 
    userName, 
    operation, 
    startTime,
    endTime: null, 
    durationMinutes: null, 
    status: 'in_progress',
    createdAt: startTime,
    updatedAt: startTime,
    machineId: machineId ?? undefined, // Explicitly handle if passed
    notes: notes ?? undefined
  };

  // Add optional fields only if they exist and are not undefined
  if (partNumber !== undefined) log.partNumber = partNumber;
  if (customer !== undefined) log.customer = customer;
  if (machineId !== undefined) log.machineId = machineId;
  if (notes !== undefined) log.notes = notes;
  if (jobIdsDisplay !== undefined) log.jobIdsDisplay = jobIdsDisplay;

  if (dbInstance) {
    try {
        // Sanitize ensures no undefined values are sent to Firestore
        const cleanLog = sanitize(log);
        await setDoc(doc(dbInstance, COL.logs, id), cleanLog, { merge: true });
        
        // Update job status safely
        try {
            await updateDoc(doc(dbInstance, COL.jobs, jobId), { status: "in-progress" } as any);
        } catch(e) {
            // Ignore job update error, log is more important
        }
        
        firebaseStatus = { connected: true };
    } catch (e) {
        throw handleError(e);
    }
    return;
  }

  const logs = readLS<TimeLog[]>(LS.logs, []);
  logs.push(log);
  writeLS(LS.logs, logs);

  const jobs = readLS<Job[]>(LS.jobs, []);
  const idx = jobs.findIndex((j) => j.id === jobId);
  if (idx >= 0) {
    jobs[idx] = { ...(jobs[idx] as any), status: "in-progress" } as Job;
    writeLS(LS.jobs, jobs);
  }
}

export async function stopTimeLog(logId: string, sessionQty?: number, notes?: string) {
  const endTime = Date.now();

  if (dbInstance) {
      try {
        const ref = doc(dbInstance, COL.logs, logId);
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error("Log not found.");

        const existing = snap.data() as TimeLog;

        // Finalize any active pause
        let totalPausedMs = existing.totalPausedMs || 0;
        if (existing.pausedAt) {
          totalPausedMs += endTime - existing.pausedAt;
        }

        const wallMs = endTime - existing.startTime;
        const workingMs = Math.max(0, wallMs - totalPausedMs);
        const durationSeconds = Math.max(0, Math.floor(workingMs / 1000));
        const durationMinutes = Math.ceil(durationSeconds / 60);

        const updates: any = {
            endTime,
            durationMinutes,
            durationSeconds,
            status: 'completed',
            updatedAt: endTime,
            pausedAt: null,
            totalPausedMs,
            pauseReason: null,
        };
        if (sessionQty !== undefined) updates.sessionQty = sessionQty;
        if (notes !== undefined) updates.notes = notes;

        await updateDoc(ref, sanitize(updates));
        updateUserProgress(existing.userId, existing.jobId, existing.operation, durationSeconds).catch(() => {});
        firebaseStatus = { connected: true };
      } catch (e) {
        throw handleError(e);
      }
      return;
  }

  const logs = readLS<TimeLog[]>(LS.logs, []);
  const idx = logs.findIndex((l) => l.id === logId);
  if (idx >= 0) {
    const l = logs[idx];
    let totalPausedMs = l.totalPausedMs || 0;
    if (l.pausedAt) {
      totalPausedMs += endTime - l.pausedAt;
    }
    const wallMs = endTime - l.startTime;
    const workingMs = Math.max(0, wallMs - totalPausedMs);
    const durationSeconds = Math.max(0, Math.floor(workingMs / 1000));
    const durationMinutes = Math.ceil(durationSeconds / 60);
    logs[idx] = {
        ...l,
        endTime,
        durationMinutes,
        durationSeconds,
        status: 'completed',
        updatedAt: endTime,
        pausedAt: null,
        totalPausedMs,
        pauseReason: undefined,
        ...(sessionQty !== undefined ? { sessionQty } : {}),
        ...(notes !== undefined ? { notes } : {})
    } as TimeLog;
    writeLS(LS.logs, logs);
  }
}

export async function updateTimeLog(log: TimeLog) {
  // Recalculate duration if end time exists
  if (log.endTime) {
     const wallMs = log.endTime - log.startTime;
     const pausedMs = log.totalPausedMs || 0;
     const workingMs = Math.max(0, wallMs - pausedMs);
     log.durationSeconds = Math.max(0, Math.floor(workingMs / 1000));
     log.durationMinutes = Math.ceil(log.durationSeconds / 60);
     log.status = 'completed';
  } else {
     log.endTime = null;
     log.durationMinutes = null;
     log.durationSeconds = null;
     log.status = 'in_progress';
  }
  log.updatedAt = Date.now();

  if (dbInstance) {
      try {
        await setDoc(doc(dbInstance, COL.logs, log.id), sanitize(log), { merge: true });
        firebaseStatus = { connected: true };
      } catch (e) {
        throw handleError(e);
      }
      return;
  }

  const logs = readLS<TimeLog[]>(LS.logs, []);
  const idx = logs.findIndex(l => l.id === log.id);
  if (idx >= 0) {
    logs[idx] = log;
    writeLS(LS.logs, logs);
  }
}

export async function deleteTimeLog(logId: string) {
  if (dbInstance) {
      try {
        await deleteDoc(doc(dbInstance, COL.logs, logId));
        firebaseStatus = { connected: true };
      } catch (e) {
        throw handleError(e);
      }
      return;
  }
  const logs = readLS<TimeLog[]>(LS.logs, []).filter(l => l.id !== logId);
  writeLS(LS.logs, logs);
}

// --------------------
// USERS
// --------------------
export function subscribeUsers(cb: (users: User[]) => void) {
  if (dbInstance) {
    const colRef = collection(dbInstance, COL.users);
    return onSnapshot(colRef,
      (snap) => {
        firebaseStatus = { connected: true };
        const users = snap.docs.map((d) => d.data() as User);
        cb(users);
      },
      (err) => {
        handleError(err);
        ensureSeedUsers();
        cb(readLS<User[]>(LS.users, []));
      }
    );
  }
  ensureSeedUsers();
  return localSubscribe(() => readLS<User[]>(LS.users, []), cb);
}

export async function saveUser(user: User) {
  if (dbInstance) {
      try {
        await setDoc(doc(dbInstance, COL.users, user.id), sanitize(user), { merge: true });
        firebaseStatus = { connected: true };
      } catch (e) {
        throw handleError(e);
      }
      return;
  }
  ensureSeedUsers();
  const users = readLS<User[]>(LS.users, []);
  const idx = users.findIndex((u) => u.id === user.id);
  if (idx >= 0) users[idx] = user;
  else users.push(user);
  writeLS(LS.users, users);
}

export async function deleteUser(id: string) {
  if (dbInstance) {
      try {
        await deleteDoc(doc(dbInstance, COL.users, id));
        firebaseStatus = { connected: true };
      } catch (e) {
        throw handleError(e);
      }
      return;
  }
  const users = readLS<User[]>(LS.users, []).filter((u) => u.id !== id);
  writeLS(LS.users, users);
}

export async function loginUser(username: string, pin: string): Promise<User | null> {
  const normalizedUser = username.toLowerCase();
  
  if (dbInstance) {
      try {
        const q = query(collection(dbInstance, COL.users));
        const snap: any = await Promise.race([
            getDocs(q),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Cloud timeout")), 5000))
        ]);
        firebaseStatus = { connected: true };
        const users = snap.docs.map((d: any) => d.data() as User);
        const found = users.find((u: User) => u.username.toLowerCase() === normalizedUser && u.pin === pin && u.isActive !== false);
        if (found) return found;
      } catch (e) {
        console.warn("Firebase Login failed (Network/Config/Timeout), falling back to Local Storage:", e);
      }
  }

  ensureSeedUsers();
  const users = readLS<User[]>(LS.users, []);
  const found = users.find(u => u.username.toLowerCase() === normalizedUser && u.pin === pin && u.isActive !== false);
  return found || null;
}

// --------------------
// SETTINGS
// --------------------
export function getSettings(): SystemSettings {
  const fallback: SystemSettings = {
    lunchStart: "12:00",
    lunchEnd: "12:30",
    autoClockOutTime: "17:30",
    autoClockOutEnabled: false,
    customOperations: ['Cutting', 'Deburring', 'Polishing', 'Assembly', 'QC', 'Packing'],
    autoLunchPauseEnabled: false,
    clients: [],
  };
  const settings = readLS<SystemSettings>(LS.settings, fallback);

  if (!settings.customOperations) settings.customOperations = fallback.customOperations;
  if (settings.autoLunchPauseEnabled === undefined) settings.autoLunchPauseEnabled = false;
  if (!settings.clients) settings.clients = [];
  return settings;
}

export function subscribeSettings(cb: (settings: SystemSettings) => void): () => void {
  const fallback: SystemSettings = {
    lunchStart: "12:00",
    lunchEnd: "12:30",
    autoClockOutTime: "17:30",
    autoClockOutEnabled: false,
    customOperations: ['Cutting', 'Deburring', 'Polishing', 'Assembly', 'QC', 'Packing'],
    autoLunchPauseEnabled: false,
    clients: [],
  };

  const merge = (data: any): SystemSettings => {
    const s = { ...fallback, ...data };
    if (!s.customOperations) s.customOperations = fallback.customOperations;
    if (s.autoLunchPauseEnabled === undefined) s.autoLunchPauseEnabled = false;
    if (!s.clients) s.clients = [];
    return s;
  };

  if (dbInstance) {
    const ref = doc(dbInstance, COL.settings, "system");
    return onSnapshot(ref,
      (snap: any) => {
        firebaseStatus = { connected: true };
        if (snap.exists()) {
          const data = snap.data();
          const merged = merge(data);
          writeLS(LS.settings, merged);
          cb(merged);
        } else {
          cb(merge(readLS(LS.settings, fallback)));
        }
      },
      (err: any) => {
        handleError(err);
        cb(merge(readLS(LS.settings, fallback)));
      }
    );
  }
  return localSubscribe(() => merge(readLS(LS.settings, fallback)), cb);
}

export async function saveSettings(settings: SystemSettings) {
  writeLS(LS.settings, settings);

  if (dbInstance) {
      try {
        await setDoc(doc(dbInstance, COL.settings, "system"), sanitize(settings), { merge: true });
        firebaseStatus = { connected: true };
      } catch (e) {
        throw handleError(e);
      }
  }
}


// ═══════════════════════════════════════════════════
// USER PROGRESS - Spark-safe stat tracking (Option B)
// 1 read + 1 write per timer stop. 1 read per tab open.
// ═══════════════════════════════════════════════════

function getISOWeek(): string {
  const d = new Date();
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  return d.getFullYear() + '-W' + String(week).padStart(2, '0');
}

async function updateUserProgress(
  userId: string,
  jobId: string,
  operation: string,
  durationSeconds: number
): Promise<void> {
  if (durationSeconds < 10 || !dbInstance) return;
  try {
    const today = new Date().toISOString().split('T')[0];
    const weekKey = getISOWeek();
    const prKey = jobId + '|' + operation;
    const ref = doc(dbInstance, 'userProgress', userId);
    const snap = await getDoc(ref);
    const now: any = snap.exists() ? snap.data() : {};

    const sameWeek = now.weekKey === weekKey;
    const weekHours = (sameWeek ? (now.weekHours || 0) : 0) + (durationSeconds / 3600);
    const weekOpCount = (sameWeek ? (now.weekOpCount || 0) : 0) + 1;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    let streakDays = now.streakDays || 0;
    if (now.lastLogDate === today) {
      // already logged today - no change
    } else if (now.lastLogDate === yesterdayStr) {
      streakDays += 1;
    } else {
      streakDays = 1;
    }

    const prs: Record<string, number> = now.prs || {};
    const existing = prs[prKey];
    if (existing === undefined || durationSeconds < existing) {
      prs[prKey] = durationSeconds;
    }

    await setDoc(ref, {
      weekKey, weekHours, weekOpCount, streakDays,
      lastLogDate: today, prs, updatedAt: Date.now(),
    }, { merge: true });

    firebaseStatus = { connected: true };
  } catch (e) {
    console.warn('Progress update skipped (non-critical):', e);
  }
}

export function subscribeUserProgress(userId: string, cb: (data: any) => void): () => void {
  if (!dbInstance) { cb(null); return () => {}; }
  const ref = doc(dbInstance, 'userProgress', userId);
  return onSnapshot(ref,
    (snap: any) => cb(snap.exists() ? snap.data() : null),
    () => cb(null)
  );
}

// --------------------
// PAUSE / RESUME
// --------------------
export async function pauseTimeLog(logId: string, reason?: string): Promise<void> {
  const now = Date.now();
  if (dbInstance) {
    try {
      const ref = doc(dbInstance, COL.logs, logId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Log not found.");
      const existing = snap.data() as TimeLog;
      if (existing.pausedAt || existing.endTime) return; // already paused or stopped
      await updateDoc(ref, sanitize({
        pausedAt: now,
        pauseReason: reason || 'manual',
        status: 'paused',
        updatedAt: now,
      }));
      firebaseStatus = { connected: true };
    } catch (e) {
      throw handleError(e);
    }
    return;
  }
  const logs = readLS<TimeLog[]>(LS.logs, []);
  const idx = logs.findIndex(l => l.id === logId);
  if (idx >= 0) {
    const l = logs[idx];
    if (l.pausedAt || l.endTime) return;
    logs[idx] = { ...l, pausedAt: now, pauseReason: reason || 'manual', status: 'paused', updatedAt: now };
    writeLS(LS.logs, logs);
  }
}

export async function resumeTimeLog(logId: string): Promise<void> {
  const now = Date.now();
  if (dbInstance) {
    try {
      const ref = doc(dbInstance, COL.logs, logId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Log not found.");
      const existing = snap.data() as TimeLog;
      if (!existing.pausedAt) return; // not paused
      const pausedDuration = now - existing.pausedAt;
      const totalPausedMs = (existing.totalPausedMs || 0) + pausedDuration;
      await updateDoc(ref, sanitize({
        pausedAt: null,
        pauseReason: null,
        totalPausedMs,
        status: 'in_progress',
        updatedAt: now,
      }));
      firebaseStatus = { connected: true };
    } catch (e) {
      throw handleError(e);
    }
    return;
  }
  const logs = readLS<TimeLog[]>(LS.logs, []);
  const idx = logs.findIndex(l => l.id === logId);
  if (idx >= 0) {
    const l = logs[idx];
    if (!l.pausedAt) return;
    const pausedDuration = now - l.pausedAt;
    const totalPausedMs = (l.totalPausedMs || 0) + pausedDuration;
    logs[idx] = { ...l, pausedAt: null, pauseReason: undefined, totalPausedMs, status: 'in_progress', updatedAt: now };
    writeLS(LS.logs, logs);
  }
}

export async function pauseAllActive(reason: string): Promise<number> {
  return new Promise((resolve) => {
    const unsub = subscribeLogs(async (all) => {
      unsub();
      const active = all.filter(l => !l.endTime && !l.pausedAt);
      for (const l of active) {
        try { await pauseTimeLog(l.id, reason); } catch {}
      }
      resolve(active.length);
    });
  });
}

export async function resumeAllPaused(): Promise<number> {
  return new Promise((resolve) => {
    const unsub = subscribeLogs(async (all) => {
      unsub();
      const paused = all.filter(l => !l.endTime && l.pausedAt);
      for (const l of paused) {
        try { await resumeTimeLog(l.id); } catch {}
      }
      resolve(paused.length);
    });
  });
}

export async function createBackfillLog(
  jobId: string,
  userId: string,
  userName: string,
  operation: string,
  startTime: number,
  endTime: number,
  partNumber?: string,
  customer?: string,
  jobIdsDisplay?: string
) {
  const id = 'bf_' + Date.now().toString();
  const durationMinutes = Math.round((endTime - startTime) / 60000);
  const log: TimeLog = {
    id, jobId, userId, userName, operation,
    startTime, endTime, durationMinutes,
    status: 'completed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  if (partNumber) log.partNumber = partNumber;
  if (customer) log.customer = customer;
  if (jobIdsDisplay) log.jobIdsDisplay = jobIdsDisplay;

  if (dbInstance) {
    try {
      await setDoc(doc(dbInstance, COL.logs, id), sanitize(log), { merge: true });
    } catch (e) { throw handleError(e); }
    return;
  }
  const logs = readLS<TimeLog[]>(LS.logs, []);
  logs.push(log);
  writeLS(LS.logs, logs);
}

export async function stopAllActive(): Promise<number> {
  return new Promise((resolve) => {
    const unsub = subscribeLogs(async (all) => {
      unsub();
      const active = all.filter(l => !l.endTime);
      for (const l of active) {
        try { await stopTimeLog(l.id); } catch {}
      }
      resolve(active.length);
    });
  });
}

// ── Auto Clock-Out Sweep ────────────────────────────────────────
let sweepInFlight = false;

export async function sweepStaleLogs(): Promise<number> {
  if (sweepInFlight) return 0;
  sweepInFlight = true;
  try {
    const settings = getSettings();
    if (!settings.autoClockOutEnabled) return 0;

    const timeStr = settings.autoClockOutTime || '17:30';
    const m = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return 0;
    const cutoffHour = parseInt(m[1], 10);
    const cutoffMin = parseInt(m[2], 10);

    const now = new Date();
    const nowMs = Date.now();
    const cutoffToday = new Date(
      now.getFullYear(), now.getMonth(), now.getDate(),
      cutoffHour, cutoffMin, 0, 0
    ).getTime();

    // Gather active logs
    let activeLogs: TimeLog[] = [];
    if (dbInstance) {
      try {
        const snap = await getDocs(collection(dbInstance, COL.logs));
        activeLogs = snap.docs
          .map((d: any) => d.data() as TimeLog)
          .filter((l: TimeLog) => !l.endTime);
      } catch (e) {
        console.warn('sweepStaleLogs: failed to read logs', e);
        return 0;
      }
    } else {
      activeLogs = readLS<TimeLog[]>(LS.logs, []).filter((l) => !l.endTime);
    }

    let stopped = 0;
    for (const log of activeLogs) {
      // Calculate the cutoff for the DAY the log started (not just today)
      const logStart = new Date(log.startTime);
      const logDayCutoff = new Date(
        logStart.getFullYear(), logStart.getMonth(), logStart.getDate(),
        cutoffHour, cutoffMin, 0, 0
      ).getTime();

      // Stop if: the log started before its day's cutoff AND that cutoff has passed
      // This catches logs from previous days that were never swept
      const shouldStop = log.startTime < logDayCutoff && nowMs > logDayCutoff;

      // Also stop any log running for more than 14 hours as a safety net
      // (handles edge cases like clock-in at 4pm, cutoff at 3:30pm — the log
      // started AFTER that day's cutoff but has been running way too long)
      const runningHours = (nowMs - log.startTime) / 3600000;
      const forcedStop = runningHours > 14;

      if (shouldStop || forcedStop) {
        try {
          await stopTimeLog(log.id);
          stopped++;
        } catch (e) {
          console.warn('sweepStaleLogs: failed to stop log', log.id, e);
        }
      }
    }
    return stopped;
  } finally {
    sweepInFlight = false;
  }
}

// ── Web Push Subscriptions ────────────────────────────────────────
export async function savePushSubscription(userId: string, subscription: any): Promise<void> {
  const db = dbInstance;
  if (!db) return;
  // Key by userId + endpoint hash so one user can have multiple devices
  const endpoint: string = subscription.endpoint || '';
  const key = userId + '_' + btoa(endpoint).slice(-20).replace(/[^a-zA-Z0-9]/g, '');
  await setDoc(doc(db, 'push_subscriptions', key), {
    userId,
    subscription,
    updatedAt: Date.now(),
  }, { merge: true });
}

export function getWorkingElapsedMs(log: TimeLog): number {
  const end = log.endTime || Date.now();
  const wall = end - log.startTime;
  let paused = log.totalPausedMs || 0;
  if (log.pausedAt && !log.endTime) {
    paused += Date.now() - log.pausedAt;
  }
  return Math.max(0, wall - paused);
}

// --------------------
// QUOTES
// --------------------

export function subscribeQuotes(cb: (quotes: Quote[]) => void) {
  if (dbInstance) {
    const colRef = collection(dbInstance, COL.quotes);
    return onSnapshot(colRef, (snap) => {
      firebaseStatus = { connected: true };
      const quotes = snap.docs.map(d => d.data() as Quote);
      cb(quotes.sort((a, b) => b.createdAt - a.createdAt));
    }, () => cb(readLS<Quote[]>(LS.quotes, [])));
  }
  return localSubscribe(() => readLS<Quote[]>(LS.quotes, []), cb);
}

export async function saveQuote(quote: Quote) {
  if (dbInstance) {
    try { await setDoc(doc(dbInstance, COL.quotes, quote.id), sanitize(quote), { merge: true }); firebaseStatus = { connected: true }; }
    catch (e) { throw handleError(e); }
    return;
  }
  const quotes = readLS<Quote[]>(LS.quotes, []);
  const idx = quotes.findIndex(q => q.id === quote.id);
  if (idx >= 0) quotes[idx] = quote; else quotes.push(quote);
  writeLS(LS.quotes, quotes);
}

export async function deleteQuote(id: string) {
  if (dbInstance) {
    try { await deleteDoc(doc(dbInstance, COL.quotes, id)); firebaseStatus = { connected: true }; }
    catch (e) { throw handleError(e); }
    return;
  }
  writeLS(LS.quotes, readLS<Quote[]>(LS.quotes, []).filter(q => q.id !== id));
}

export function getNextQuoteNumber(quotes: Quote[], prefix?: string): string {
  const pfx = prefix || 'Q-';
  const nums = quotes.map(q => parseInt(q.quoteNumber?.replace(/\D/g, '') || '0', 10)).filter(n => !isNaN(n));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `${pfx}${String(next).padStart(3, '0')}`;
}

// --------------------
// SAMPLES
// --------------------
const LS_SAMPLES = "nexus_samples";

export function subscribeSamples(cb: (samples: Sample[]) => void): () => void {
  if (dbInstance) {
    const colRef = collection(dbInstance, "samples");
    return onSnapshot(colRef,
      (snap: any) => {
        firebaseStatus = { connected: true };
        const samples = snap.docs.map((d: any) => d.data() as Sample);
        cb(samples);
      },
      (err: any) => {
        handleError(err);
        cb(readLS<Sample[]>(LS_SAMPLES, []));
      }
    );
  }
  return localSubscribe(() => readLS<Sample[]>(LS_SAMPLES, []), cb);
}

export async function saveSample(sample: Sample): Promise<void> {
  if (dbInstance) {
    try {
      await setDoc(doc(dbInstance, "samples", sample.id), sanitize(sample), { merge: true });
      firebaseStatus = { connected: true };
    } catch (e) {
      throw handleError(e);
    }
    return;
  }
  const samples = readLS<Sample[]>(LS_SAMPLES, []);
  const idx = samples.findIndex(s => s.id === sample.id);
  if (idx >= 0) samples[idx] = sample;
  else samples.push(sample);
  writeLS(LS_SAMPLES, samples);
}

export async function deleteSample(id: string): Promise<void> {
  if (dbInstance) {
    try {
      await deleteDoc(doc(dbInstance, "samples", id));
      firebaseStatus = { connected: true };
    } catch (e) {
      throw handleError(e);
    }
    return;
  }
  const samples = readLS<Sample[]>(LS_SAMPLES, []).filter(s => s.id !== id);
  writeLS(LS_SAMPLES, samples);
}

// ── REWORK ENTRIES ────────────────────────────────────────────────
const LS_REWORK = "nexus_rework";

export function subscribeRework(cb: (entries: ReworkEntry[]) => void): () => void {
  if (dbInstance) {
    const colRef = collection(dbInstance, "rework");
    return onSnapshot(colRef,
      (snap: any) => {
        firebaseStatus = { connected: true };
        const entries = snap.docs.map((d: any) => d.data() as ReworkEntry).sort((a: ReworkEntry, b: ReworkEntry) => b.createdAt - a.createdAt);
        cb(entries);
      },
      (err: any) => {
        handleError(err);
        cb(readLS<ReworkEntry[]>(LS_REWORK, []).sort((a, b) => b.createdAt - a.createdAt));
      }
    );
  }
  return localSubscribe(
    () => readLS<ReworkEntry[]>(LS_REWORK, []).sort((a, b) => b.createdAt - a.createdAt),
    cb
  );
}

export async function saveRework(entry: ReworkEntry): Promise<void> {
  if (dbInstance) {
    try {
      await setDoc(doc(dbInstance, "rework", entry.id), sanitize(entry), { merge: true });
      firebaseStatus = { connected: true };
    } catch (e) {
      throw handleError(e);
    }
    return;
  }
  const list = readLS<ReworkEntry[]>(LS_REWORK, []);
  const idx = list.findIndex(r => r.id === entry.id);
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  writeLS(LS_REWORK, list);
}

export async function deleteRework(id: string): Promise<void> {
  if (dbInstance) {
    try {
      await deleteDoc(doc(dbInstance, "rework", id));
      firebaseStatus = { connected: true };
    } catch (e) {
      throw handleError(e);
    }
    return;
  }
  const list = readLS<ReworkEntry[]>(LS_REWORK, []).filter(r => r.id !== id);
  writeLS(LS_REWORK, list);
}

export async function startSampleWork(
  sampleId: string,
  userId: string,
  userName: string,
  operation: string,
  qty?: number
): Promise<void> {
  const now = Date.now();
  const entry: SampleWorkEntry = {
    id: `sw_${now}_${Math.random().toString(36).slice(2, 7)}`,
    userId,
    userName,
    operation,
    startTime: now,
    endTime: null,
    pausedAt: null,
    totalPausedMs: 0,
    ...(qty ? { qty } : {}),
  };

  if (dbInstance) {
    try {
      const ref = doc(dbInstance, "samples", sampleId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Sample not found.");
      await updateDoc(ref, sanitize({
        activeEntry: entry,
        updatedAt: now,
      }));
      firebaseStatus = { connected: true };
    } catch (e) {
      throw handleError(e);
    }
    return;
  }
  const samples = readLS<Sample[]>(LS_SAMPLES, []);
  const idx = samples.findIndex(s => s.id === sampleId);
  if (idx >= 0) {
    samples[idx] = { ...samples[idx], activeEntry: entry, updatedAt: now };
    writeLS(LS_SAMPLES, samples);
  }
}

export async function stopSampleWork(sampleId: string, notes?: string): Promise<void> {
  const now = Date.now();

  if (dbInstance) {
    try {
      const ref = doc(dbInstance, "samples", sampleId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Sample not found.");
      const sample = snap.data() as Sample;
      if (!sample.activeEntry) return;

      const entry = sample.activeEntry;
      // Finalize any active pause
      let totalPausedMs = entry.totalPausedMs || 0;
      if (entry.pausedAt) {
        totalPausedMs += now - entry.pausedAt;
      }
      const wallMs = now - entry.startTime;
      const workingMs = Math.max(0, wallMs - totalPausedMs);
      const durationSeconds = Math.floor(workingMs / 1000);

      const completed: SampleWorkEntry = {
        ...entry,
        endTime: now,
        durationSeconds,
        pausedAt: null,
        totalPausedMs,
        notes: notes || entry.notes,
      };

      const existingEntries = sample.workEntries || [];
      const newTotalWorked = (sample.totalWorkedMs || 0) + workingMs;

      await updateDoc(ref, sanitize({
        activeEntry: null,
        workEntries: [...existingEntries, completed],
        totalWorkedMs: newTotalWorked,
        updatedAt: now,
      }));
      firebaseStatus = { connected: true };
    } catch (e) {
      throw handleError(e);
    }
    return;
  }

  const samples = readLS<Sample[]>(LS_SAMPLES, []);
  const idx = samples.findIndex(s => s.id === sampleId);
  if (idx >= 0) {
    const sample = samples[idx];
    if (!sample.activeEntry) return;
    const entry = sample.activeEntry;
    let totalPausedMs = entry.totalPausedMs || 0;
    if (entry.pausedAt) {
      totalPausedMs += now - entry.pausedAt;
    }
    const wallMs = now - entry.startTime;
    const workingMs = Math.max(0, wallMs - totalPausedMs);
    const durationSeconds = Math.floor(workingMs / 1000);

    const completed: SampleWorkEntry = {
      ...entry,
      endTime: now,
      durationSeconds,
      pausedAt: null,
      totalPausedMs,
      notes: notes || entry.notes,
    };

    samples[idx] = {
      ...sample,
      activeEntry: null,
      workEntries: [...(sample.workEntries || []), completed],
      totalWorkedMs: (sample.totalWorkedMs || 0) + workingMs,
      updatedAt: now,
    };
    writeLS(LS_SAMPLES, samples);
  }
}

export async function pauseSampleWork(sampleId: string, reason?: string): Promise<void> {
  const now = Date.now();
  if (dbInstance) {
    try {
      const ref = doc(dbInstance, "samples", sampleId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Sample not found.");
      const sample = snap.data() as Sample;
      if (!sample.activeEntry || sample.activeEntry.pausedAt) return;
      await updateDoc(ref, sanitize({
        activeEntry: { ...sample.activeEntry, pausedAt: now },
        updatedAt: now,
      }));
      firebaseStatus = { connected: true };
    } catch (e) {
      throw handleError(e);
    }
    return;
  }
  const samples = readLS<Sample[]>(LS_SAMPLES, []);
  const idx = samples.findIndex(s => s.id === sampleId);
  if (idx >= 0 && samples[idx].activeEntry && !samples[idx].activeEntry!.pausedAt) {
    samples[idx] = {
      ...samples[idx],
      activeEntry: { ...samples[idx].activeEntry!, pausedAt: now },
      updatedAt: now,
    };
    writeLS(LS_SAMPLES, samples);
  }
}

export async function resumeSampleWork(sampleId: string): Promise<void> {
  const now = Date.now();
  if (dbInstance) {
    try {
      const ref = doc(dbInstance, "samples", sampleId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Sample not found.");
      const sample = snap.data() as Sample;
      if (!sample.activeEntry || !sample.activeEntry.pausedAt) return;
      const pausedDuration = now - sample.activeEntry.pausedAt;
      const totalPausedMs = (sample.activeEntry.totalPausedMs || 0) + pausedDuration;
      await updateDoc(ref, sanitize({
        activeEntry: { ...sample.activeEntry, pausedAt: null, totalPausedMs },
        updatedAt: now,
      }));
      firebaseStatus = { connected: true };
    } catch (e) {
      throw handleError(e);
    }
    return;
  }
  const samples = readLS<Sample[]>(LS_SAMPLES, []);
  const idx = samples.findIndex(s => s.id === sampleId);
  if (idx >= 0 && samples[idx].activeEntry?.pausedAt) {
    const entry = samples[idx].activeEntry!;
    const pausedDuration = now - entry.pausedAt!;
    const totalPausedMs = (entry.totalPausedMs || 0) + pausedDuration;
    samples[idx] = {
      ...samples[idx],
      activeEntry: { ...entry, pausedAt: null, totalPausedMs },
      updatedAt: now,
    };
    writeLS(LS_SAMPLES, samples);
  }
}

export async function editSampleWorkEntry(
  sampleId: string,
  entryId: string,
  updates: Partial<SampleWorkEntry>
): Promise<void> {
  const now = Date.now();

  if (dbInstance) {
    try {
      const ref = doc(dbInstance, "samples", sampleId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Sample not found.");
      const sample = snap.data() as Sample;
      const entries = sample.workEntries || [];
      const idx = entries.findIndex(e => e.id === entryId);
      if (idx < 0) return;

      const old = entries[idx];
      const oldMs = (old.durationSeconds || 0) * 1000;
      const updated = { ...old, ...updates };
      // Recalc duration if start/end changed
      if (updated.startTime && updated.endTime) {
        const wall = updated.endTime - updated.startTime;
        const paused = updated.totalPausedMs || 0;
        updated.durationSeconds = Math.max(0, Math.floor((wall - paused) / 1000));
      }
      const newMs = (updated.durationSeconds || 0) * 1000;
      entries[idx] = updated;
      const totalWorkedMs = Math.max(0, (sample.totalWorkedMs || 0) - oldMs + newMs);

      await updateDoc(ref, sanitize({ workEntries: entries, totalWorkedMs, updatedAt: now }));
      firebaseStatus = { connected: true };
    } catch (e) {
      throw handleError(e);
    }
    return;
  }

  const samples = readLS<Sample[]>(LS_SAMPLES, []);
  const sIdx = samples.findIndex(s => s.id === sampleId);
  if (sIdx < 0) return;
  const sample = samples[sIdx];
  const entries = sample.workEntries || [];
  const eIdx = entries.findIndex(e => e.id === entryId);
  if (eIdx < 0) return;

  const old = entries[eIdx];
  const oldMs = (old.durationSeconds || 0) * 1000;
  const updated = { ...old, ...updates };
  if (updated.startTime && updated.endTime) {
    const wall = updated.endTime - updated.startTime;
    const paused = updated.totalPausedMs || 0;
    updated.durationSeconds = Math.max(0, Math.floor((wall - paused) / 1000));
  }
  const newMs = (updated.durationSeconds || 0) * 1000;
  entries[eIdx] = updated;
  samples[sIdx] = {
    ...sample,
    workEntries: entries,
    totalWorkedMs: Math.max(0, (sample.totalWorkedMs || 0) - oldMs + newMs),
    updatedAt: now,
  };
  writeLS(LS_SAMPLES, samples);
}

export async function deleteSampleWorkEntry(sampleId: string, entryId: string): Promise<void> {
  const now = Date.now();

  if (dbInstance) {
    try {
      const ref = doc(dbInstance, "samples", sampleId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Sample not found.");
      const sample = snap.data() as Sample;
      const entries = sample.workEntries || [];
      const entry = entries.find(e => e.id === entryId);
      if (!entry) return;
      const removedMs = (entry.durationSeconds || 0) * 1000;
      const filtered = entries.filter(e => e.id !== entryId);
      const totalWorkedMs = Math.max(0, (sample.totalWorkedMs || 0) - removedMs);

      await updateDoc(ref, sanitize({ workEntries: filtered, totalWorkedMs, updatedAt: now }));
      firebaseStatus = { connected: true };
    } catch (e) {
      throw handleError(e);
    }
    return;
  }

  const samples = readLS<Sample[]>(LS_SAMPLES, []);
  const sIdx = samples.findIndex(s => s.id === sampleId);
  if (sIdx < 0) return;
  const sample = samples[sIdx];
  const entries = sample.workEntries || [];
  const entry = entries.find(e => e.id === entryId);
  if (!entry) return;
  const removedMs = (entry.durationSeconds || 0) * 1000;
  samples[sIdx] = {
    ...sample,
    workEntries: entries.filter(e => e.id !== entryId),
    totalWorkedMs: Math.max(0, (sample.totalWorkedMs || 0) - removedMs),
    updatedAt: now,
  };
  writeLS(LS_SAMPLES, samples);
}
