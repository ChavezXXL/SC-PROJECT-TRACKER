import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import type { Job, TimeLog, User, SystemSettings } from "../types";
import {
  initFirebaseFromLocalStorage,
  saveFirebaseConfig as saveCfg,
  validateConnection
} from "./firebaseClient";

/**
 * Service to handle Data persistence.
 * Logic:
 * 1. Try to initialize Firebase.
 * 2. If initialized, verify connection (permissions).
 * 3. If connected, ALL writes go to Firestore. If write fails, THROW error (don't fallback silently).
 * 4. If NOT initialized (no config), use localStorage.
 */

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
    // Assume connected initially, but verify asynchronously
    firebaseStatus = { connected: true }; 
    
    // Execute Health Checks (Read & Write)
    (async () => {
        try {
            // 1. Verify Read Access
            await validateConnection(dbInstance);
            
            // 2. Verify Write Access (Diagnostic)
            // This proves if 'auto-creation' of collections and documents works
            console.log("🛠 Attempting Diagnostic Write to '__debug/test'...");
            await setDoc(doc(dbInstance, "__debug", "test"), {
                createdAt: Date.now(),
                source: "diagnostic_test",
                status: "ok",
                info: "If this exists, Firestore writes are WORKING."
            });
            console.log("✅ Diagnostic Write Success: Firestore is Writable.");
            
            // If both pass, we are effectively online
            firebaseStatus = { connected: true };
        } catch (e: any) {
            console.error("❌ Connection/Diagnostic Check Failed. FORCING OFFLINE MODE.", e);
            handleError(e);
            
            // CRITICAL FIX: If check fails, nullify dbInstance immediately.
            // This ensures loginUser() skips the cloud attempt and goes straight to local storage.
            dbInstance = null;
            firebaseStatus = { connected: false, error: "Offline Mode (Connection Failed)" };
        }
    })();

} else {
    firebaseStatus = { connected: false, error: initRes.error };
}

function handleError(e: any) {
    let msg = e.message || "Unknown Error";
    // Clean up common error messages for the UI
    if (msg.includes("permission") || msg.includes("insufficient")) {
        msg = "Permission Denied: Check Firestore Rules.";
    } else if (msg.includes("offline") || msg.includes("client is offline")) {
        msg = "Network Offline";
    } else if (msg.includes("not found")) {
        // Often happens if project ID is wrong or database doesn't exist
        msg = "Database Not Found (Check Project ID)";
    }
    
    console.error("DB Error:", msg);
    firebaseStatus = { connected: false, error: msg };
    return new Error(msg);
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
// LOCAL STORAGE FALLBACK CONSTANTS
// --------------------
const LS = {
  jobs: "nexus_jobs",
  logs: "nexus_logs",
  users: "nexus_users",
  settings: "nexus_settings",
};

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLS<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function ensureSeedUsers() {
  const users = readLS<User[]>(LS.users, []);
  
  // GUARANTEED USERS: These will always be restored if missing
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
         // User doesn't exist, add them
         merged.push(admin);
         changed = true;
     } else {
         // User exists, check if critical fields match. 
         // If PIN or Role is different from hardcoded default, FORCE update to ensure access.
         const existing = merged[existingIndex];
         if (existing.pin !== admin.pin || existing.role !== admin.role) {
             merged[existingIndex] = { ...existing, pin: admin.pin, role: admin.role, isActive: true };
             changed = true;
         }
     }
  });

  if (changed || users.length === 0) {
      console.log("Restoring guaranteed admin users...");
      writeLS(LS.users, merged);
  }
}

// Helper for polling local storage
function localSubscribe<T>(getter: () => T, cb: (v: T) => void) {
  cb(getter());
  const i = setInterval(() => cb(getter()), 1000);
  return () => clearInterval(i);
}

const COL = {
  jobs: "jobs",
  logs: "logs",
  users: "users",
  settings: "settings",
};

// --------------------
// JOBS
// --------------------
export function subscribeJobs(cb: (jobs: Job[]) => void) {
  if (dbInstance) {
    const colRef = collection(dbInstance, COL.jobs);
    return onSnapshot(colRef, 
      (snap) => {
        firebaseStatus = { connected: true }; // Recover status on success
        const jobs = snap.docs.map((d) => d.data() as Job);
        cb(jobs);
      },
      (err) => {
        handleError(err);
        // Fallback to empty or local on error to prevent UI crash, but status shows error
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
        await setDoc(doc(dbInstance, COL.jobs, job.id), job, { merge: true });
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

// --------------------
// LOGS
// --------------------
export function subscribeLogs(cb: (logs: TimeLog[]) => void) {
  if (dbInstance) {
    const colRef = collection(dbInstance, COL.logs);
    return onSnapshot(colRef,
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

export async function startTimeLog(jobId: string, userId: string, userName: string, operation: string) {
  const id = Date.now().toString();
  const startTime = Date.now();
  const log: TimeLog = {
    id, jobId, userId, userName, operation, startTime,
    endTime: null as any, durationMinutes: undefined,
  };

  if (dbInstance) {
    try {
        await setDoc(doc(dbInstance, COL.logs, id), log, { merge: true });
        // Also update job status
        await updateDoc(doc(dbInstance, COL.jobs, jobId), { status: "in-progress" } as any).catch(() => {});
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

export async function stopTimeLog(logId: string) {
  const endTime = Date.now();

  if (dbInstance) {
      try {
        const ref = doc(dbInstance, COL.logs, logId);
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error("Log not found.");

        const existing = snap.data() as TimeLog;
        const mins = Math.max(0, Math.round((endTime - existing.startTime) / 60000));

        await updateDoc(ref, { endTime, durationMinutes: mins } as any);
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
    const mins = Math.max(0, Math.round((endTime - l.startTime) / 60000));
    logs[idx] = { ...l, endTime, durationMinutes: mins } as TimeLog;
    writeLS(LS.logs, logs);
  }
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
        await setDoc(doc(dbInstance, COL.users, user.id), user, { merge: true });
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

export async function loginUser(username: string, pin: string): Promise<User | null> {
  const normalizedUser = username.toLowerCase();
  
  if (dbInstance) {
      try {
        // TIMEOUT SAFETY: If Cloud DB hangs (offline but not detected), reject after 1s (fast fail)
        const q = query(collection(dbInstance, COL.users));
        
        const snap: any = await Promise.race([
            getDocs(q),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Cloud timeout")), 1000))
        ]);

        firebaseStatus = { connected: true };
        
        const users = snap.docs.map((d: any) => d.data() as User);
        const found = users.find((u: User) => u.username.toLowerCase() === normalizedUser && u.pin === pin && u.isActive !== false);
        
        // If found in cloud, return it. 
        if (found) return found;

      } catch (e) {
        // CRITICAL FIX: If Firebase connection fails or TIMEOUTS,
        // we CATCH the error and fallback to local storage so the user can still log in.
        console.warn("Firebase Login failed (Network/Config/Timeout), falling back to Local Storage:", e);
      }
  }

  // Fallback / Offline / Local Mode
  // ALWAYS run ensureSeedUsers here to guarantee 'Anthony' exists before checking
  ensureSeedUsers();
  const users = readLS<User[]>(LS.users, []);
  const found = users.find(u => u.username.toLowerCase() === normalizedUser && u.pin === pin && u.isActive !== false);
  return found || null;
}

// --------------------
// SETTINGS
// --------------------
export function getSettings(): SystemSettings {
  // Always prefer local for fast rendering, assume synced elsewhere
  const fallback: SystemSettings = {
    lunchStart: "12:00", lunchEnd: "12:30", lunchDeductionMinutes: 30,
    autoClockOutTime: "17:30", autoClockOutEnabled: false
  };
  return readLS<SystemSettings>(LS.settings, fallback);
}

export async function saveSettings(settings: SystemSettings) {
  writeLS(LS.settings, settings);

  if (dbInstance) {
      try {
        await setDoc(doc(dbInstance, COL.settings, "system"), settings, { merge: true });
        firebaseStatus = { connected: true };
      } catch (e) {
        throw handleError(e);
      }
  }
}