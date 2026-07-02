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
  where,
} from "firebase/firestore";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

import type { Job, TimeLog, User, SystemSettings, Sample, SampleWorkEntry, Quote, ReworkEntry, Delivery, Vendor, PurchaseOrder, CustomerPoFile } from "../types";
import { shopLocalTimeMs, shopDayOfWeek } from "../utils/timezone";
import {
  initFirebaseFromLocalStorage,
  saveFirebaseConfig as saveCfg,
  validateConnection
} from "./firebaseClient";
// ── Phase 1 tenant paths ─────────────────────────────────────────────
// Tenant-scoped Firestore path helper. For the legacy SC Deburring
// install, `colPath('sc_deburring', 'jobs')` returns the flat string
// "jobs" — identical to the pre-multitenant behavior. For new tenants,
// returns "tenants/{tid}/jobs". Nothing changes for SC Deburring until
// we explicitly switch `getTenantId()` to return something else.
import { colPath, resolveCurrentTenantId } from "../backend/tenantContext";

/** Current tenant resolver. Reads from URL param → localStorage →
 *  legacy SC Deburring fallback (LEGACY_TENANT_ID). AuthProvider writes
 *  the localStorage entry on sign-in / sign-up; sign-out clears it,
 *  which falls back to legacy paths.
 *
 *  This is the single switch point. Every Firestore path in this file
 *  resolves through here. Swap the implementation here to change how
 *  multi-tenancy works app-wide. */
function getTenantId(): string {
  return resolveCurrentTenantId();
}

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
    
    // Verify Firestore is reachable (read-only probe).
    // NOTE: We do NOT write to __debug/test here — Firestore security rules deny
    // unknown collections and would always throw, which used to null out dbInstance
    // and permanently disable all writes until the page was reloaded.
    (async () => {
        try {
            await validateConnection(dbInstance);
            firebaseStatus = { connected: true };
        } catch (e: any) {
            // Do NOT set dbInstance = null here. Subscriptions have their own
            // error + retry handling. Forcing offline mode on a probe failure
            // permanently breaks cross-device sync until the user reloads.
            console.warn("[FabTrack] Firestore probe failed — subscriptions will retry automatically.", e);
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
/** Race a promise against a hard timeout — Firebase Storage retries with
 *  exponential backoff for MINUTES on flaky networks, which left the sample
 *  modal stuck on "Uploading Photo…" with Save disabled. Fail fast instead;
 *  callers fall back to base64 and the save goes through normally. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)),
  ]);
}

export async function uploadSamplePhoto(file: File | Blob, sampleId: string): Promise<string> {
  // NOTE: We attempt Firebase Storage upload regardless of dbInstance state.
  // getStorage() uses the Firebase app singleton — it works as long as the
  // Firebase app was initialised, even if the Firestore dbInstance is null.
  try {
    const storage = getStorage();
    const path = `sample-photos/${sampleId}_${Date.now()}.jpg`;
    const ref = storageRef(storage, path);
    await withTimeout(uploadBytes(ref, file, { contentType: 'image/jpeg' }), 15_000, 'Storage upload');
    return await withTimeout(getDownloadURL(ref), 10_000, 'Storage URL fetch');
  } catch (e) {
    throw new Error('Storage upload failed: ' + (e as any)?.message);
  }
}

/** Upload a job part photo to Firebase Storage. Part images used to live as
 *  base64 INSIDE the job document — every device re-downloaded every photo on
 *  every snapshot. Storage URLs keep job docs tiny and sync fast. */
export async function uploadJobPartImage(file: File | Blob, jobId: string): Promise<string> {
  try {
    const storage = getStorage();
    const path = `job-parts/${jobId}_${Date.now()}.jpg`;
    const ref = storageRef(storage, path);
    await withTimeout(uploadBytes(ref, file, { contentType: 'image/jpeg' }), 15_000, 'Storage upload');
    return await withTimeout(getDownloadURL(ref), 10_000, 'Storage URL fetch');
  } catch (e) {
    throw new Error('Storage upload failed: ' + (e as any)?.message);
  }
}

/** Upload a customer-PO photo to Firebase Storage (separate path from samples). */
export async function uploadCustomerPoPhoto(file: File | Blob, poId: string): Promise<string> {
  try {
    const storage = getStorage();
    const path = `customer-pos/${poId}_${Date.now()}.jpg`;
    const ref = storageRef(storage, path);
    await withTimeout(uploadBytes(ref, file, { contentType: 'image/jpeg' }), 20_000, 'Storage upload');
    return await withTimeout(getDownloadURL(ref), 10_000, 'Storage URL fetch');
  } catch (e) {
    throw new Error('Storage upload failed: ' + (e as any)?.message);
  }
}

// --------------------
// LOCAL STORAGE FALLBACK CONSTANTS
// --------------------
// Tenant-scoped so a second tenant's offline cache doesn't bleed into
// the first. SC Deburring (legacy) keeps the original keys ("nexus_jobs"
// etc.) so its existing cached data is preserved across this change.
// New tenants get prefixed keys: "t_{tid}__nexus_jobs".
function lsPrefix(): string {
  try {
    const tid = getTenantId();
    return tid && tid !== 'sc_deburring' ? `t_${tid}__` : '';
  } catch {
    return '';
  }
}
const LS = {
  get jobs()     { return lsPrefix() + 'nexus_jobs'; },
  get logs()     { return lsPrefix() + 'nexus_logs'; },
  get users()    { return lsPrefix() + 'nexus_users'; },
  get settings() { return lsPrefix() + 'nexus_settings'; },
  get quotes()   { return lsPrefix() + 'nexus_quotes'; },
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
  
  // Generic demo users only — personal credentials removed for SaaS safety
  const hardcodedAdmins: User[] = [
    { id: "admin1", name: "Shop Manager", username: "admin", pin: "9999", role: "admin", isActive: true },
    { id: "emp1", name: "Operator 1", username: "op1", pin: "1234", role: "employee", isActive: true },
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

// ── Auto-retry onSnapshot wrapper ─────────────────────────────────────
// Firestore permanently kills a listener after the error callback fires.
// This wrapper re-subscribes with exponential backoff so a brief network
// glitch (or a Firestore rules hiccup) does not leave the device stranded
// on stale localStorage data until the user manually refreshes the page.
function retryingSnapshot(
  getRef:     () => any,
  onNext:     (snap: any) => void,
  onFallback: () => void,
): () => void {
  let currentUnsub: (() => void) | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  let delay = 5_000; // start at 5 s, cap at 60 s

  const attach = () => {
    if (destroyed) return;
    try {
      currentUnsub = onSnapshot(
        getRef(),
        (snap: any) => { delay = 5_000; onNext(snap); }, // reset backoff on success
        (_err: any) => {
          handleError(_err);
          onFallback();                                    // serve cached data now
          retryTimer = setTimeout(() => {
            delay = Math.min(delay * 2, 60_000);           // exponential cap 60 s
            attach();
          }, delay);
        },
      );
    } catch (e) {
      // getRef() itself threw (e.g. dbInstance became null) — back off and retry
      onFallback();
      retryTimer = setTimeout(() => { delay = Math.min(delay * 2, 60_000); attach(); }, delay);
    }
  };

  attach();
  return () => {
    destroyed = true;
    currentUnsub?.();
    if (retryTimer) clearTimeout(retryTimer);
  };
}

// ── Multicast registry ────────────────────────────────────────────────
// Problem: App.tsx calls subscribeLogs/subscribeJobs 5-8 times from
// different components.  Each call created its own Firebase onSnapshot
// listener → Firestore sends full 500-log payload 8× on every write →
// React re-renders 8×, heavy memory, freezes on low-end phones.
//
// Fix: one Firebase listener per collection, shared across all callers.
// The last unsubscribe tears the listener down.  Cache key = collection
// path (already tenant-scoped by COL.*).
//
type MCEntry<T> = {
  cbs:     Set<(v: T) => void>;
  last:    T | undefined;
  hasLast: boolean;
  unsub:   (() => void) | null;
  tenant:  string;   // tenant at attach time — stale-listener guard on tenant switch
};
const _mc = new Map<string, MCEntry<any>>();

function multicast<T>(
  key:    string,
  create: (notify: (v: T) => void) => () => void,
  cb:     (v: T) => void,
): () => void {
  let m = _mc.get(key) as MCEntry<T> | undefined;
  if (!m) {
    m = { cbs: new Set(), last: undefined, hasLast: false, unsub: null, tenant: getTenantId() };
    _mc.set(key, m);
    m.unsub = create(v => {
      const e = _mc.get(key) as MCEntry<T>;
      if (!e) return;
      // Tenant switched since this listener attached — tear it down and DROP
      // the payload, so the previous tenant's data can never reach subscribers
      // that haven't re-subscribed yet (cross-tenant leak).
      if (getTenantId() !== e.tenant) {
        e.unsub?.();
        _mc.delete(key);
        return;
      }
      e.last = v; e.hasLast = true;
      e.cbs.forEach(fn => { try { fn(v); } catch {} });
    });
  }
  m.cbs.add(cb);
  // Deliver cached value immediately so components don't flash empty state
  if (m.hasLast) {
    const cached = m.last;
    queueMicrotask(() => { try { cb(cached as T); } catch {} });
  }
  return () => {
    const e = _mc.get(key) as MCEntry<T> | undefined;
    if (!e) return;
    e.cbs.delete(cb);
    if (e.cbs.size === 0) {
      e.unsub?.();
      _mc.delete(key);
    }
  };
}

/** Call on logout / tenant switch to tear down all shared listeners. */
export function clearMulticastCache() {
  _mc.forEach(e => e.unsub?.());
  _mc.clear();
}

// ── Firestore collection paths ──
// Uses getters so each access resolves the CURRENT tenant. For the
// legacy SC Deburring tenant these return the same flat strings the
// code has always used ("jobs", "logs", etc.). For future tenants they
// return "tenants/{tid}/jobs" etc.
//
// NEVER replace a COL.x reference with a hardcoded string — that path
// won't move correctly when multi-tenancy goes live.
const COL = {
  get jobs()              { return colPath(getTenantId(), "jobs"); },
  get logs()              { return colPath(getTenantId(), "logs"); },
  get users()             { return colPath(getTenantId(), "users"); },
  get settings()          { return colPath(getTenantId(), "settings"); },
  get quotes()            { return colPath(getTenantId(), "quotes"); },
  get deliveries()        { return colPath(getTenantId(), "deliveries"); },
  get vendors()           { return colPath(getTenantId(), "vendors"); },
  get purchaseOrders()    { return colPath(getTenantId(), "purchase_orders"); },
  get samples()           { return colPath(getTenantId(), "samples"); },
  get rework()            { return colPath(getTenantId(), "rework"); },
  get userProgress()      { return colPath(getTenantId(), "userProgress"); },
  get pushSubscriptions() { return colPath(getTenantId(), "push_subscriptions"); },
  get notes()             { return colPath(getTenantId(), "notes"); },
  get customerPos()       { return colPath(getTenantId(), "customer_pos"); },
};

// --------------------
// JOBS
// --------------------
export function subscribeJobs(cb: (jobs: Job[]) => void) {
  if (dbInstance) {
    const key = 'jobs:' + COL.jobs;
    return multicast<Job[]>(key, notify => {
      return retryingSnapshot(
        () => collection(dbInstance!, COL.jobs),
        snap => { firebaseStatus = { connected: true }; notify(snap.docs.map(d => d.data() as Job)); },
        () => notify(readLS<Job[]>(LS.jobs, [])),
      );
    }, cb);
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
        // Network glitch / permission error — serve the localStorage cache
        // before giving up (same fallback pattern as getOpenLogsForUser).
        try {
          const cached = readLS<Job[]>(LS.jobs, []).find((j) => j.id === id);
          if (cached) return cached;
        } catch {}
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
  // Merge (not replace) so fields intentionally omitted by the caller — e.g.
  // currentStage/stageHistory, which only advanceJobStage should write — keep
  // their existing values instead of being wiped. Matches Firestore merge:true.
  if (idx >= 0) jobs[idx] = { ...jobs[idx], ...job };
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
        // Cascade-delete this job's time logs FIRST — otherwise they become
        // orphans pointing at a job that no longer exists, silently corrupting
        // labor-cost and worker-hour reports. (Previously only the localStorage
        // branch cascaded; Firestore left orphans behind.)
        try {
          const snap = await getDocs(query(collection(dbInstance, COL.logs), where('jobId', '==', id)));
          await Promise.all(snap.docs.map((d: any) => deleteDoc(d.ref)));
        } catch (e) { console.warn('deleteJob: log cascade failed', e); }
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

export async function completeJobWithSnapshot(
  id: string,
  materialCost: number,
  snapshot: NonNullable<Job['profitSnapshot']>,
) {
  const completedAt = Date.now();
  const updates: any = { status: 'completed', completedAt, profitSnapshot: snapshot };
  if (materialCost > 0) updates.materialCost = materialCost;
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
    jobs[idx] = { ...jobs[idx], ...updates } as Job;
    writeLS(LS.jobs, jobs);
  }
}

export async function addJobNote(jobId: string, text: string, userId: string, userName: string, jobLabel?: string) {
  const note = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, userId, userName, timestamp: Date.now() };
  if (dbInstance) {
    try {
      await updateDoc(doc(dbInstance, COL.jobs, jobId), { jobNotes: arrayUnion(note) } as any);
      firebaseStatus = { connected: true };
      // Also write to flat notes collection so the push cron can query recent notes
      try {
        await setDoc(doc(dbInstance, COL.notes, note.id), {
          jobId,
          jobLabel: jobLabel || jobId,
          text: note.text,
          userId: note.userId,
          userName: note.userName,
          timestamp: note.timestamp,
        });
      } catch { /* non-critical — note is already saved on the job */ }
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
  } else {
    // Moving to ANY non-complete stage must drop the job out of 'completed' and
    // clear the locked snapshot — otherwise dragging a done job back to QC
    // leaves it counted as both completed AND active (the two views disagree).
    updates.status = stageId === 'pending' ? 'pending' : 'in-progress';
    updates.completedAt = null;
    updates.profitSnapshot = null;
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
    jobs[idx] = {
      ...j, currentStage: stageId, stageHistory: history,
      ...(isComplete
        ? { status: 'completed', completedAt: Date.now() }
        : { status: stageId === 'pending' ? 'pending' : 'in-progress', completedAt: null, profitSnapshot: null }),
      ...(stageId === 'shipped' ? { shippedAt: Date.now() } : {}),
    } as Job;
    writeLS(LS.jobs, jobs);
  }
}

// --------------------
// LOGS
// --------------------
export function subscribeLogs(cb: (logs: TimeLog[]) => void) {
  if (dbInstance) {
    // ONE shared listener for all callers — multicast fans out to N components
    const key = 'logs:' + COL.logs;
    return multicast<TimeLog[]>(key, notify => {
      return retryingSnapshot(
        () => query(collection(dbInstance!, COL.logs), orderBy('startTime', 'desc'), limit(500)),
        snap => { firebaseStatus = { connected: true }; notify(snap.docs.map(d => d.data() as TimeLog)); },
        () => notify(readLS<TimeLog[]>(LS.logs, [])),
      );
    }, cb);
  }
  return localSubscribe(() => readLS<TimeLog[]>(LS.logs, []), cb);
}

export function subscribeActiveLogs(cb: (logs: TimeLog[]) => void) {
  return subscribeLogs((all) => cb(all.filter((l) => !l.endTime)));
}

// UPDATED: Now accepts partNumber, customer, and jobIdsDisplay for snapshotting
/** All currently-open (not-yet-stopped) logs for a worker. Single-field
 *  query (auto-indexed); falls back to a full scan, then localStorage. */
async function getOpenLogsForUser(userId: string): Promise<TimeLog[]> {
  if (dbInstance) {
    try {
      const q = query(collection(dbInstance, COL.logs), where('userId', '==', userId));
      const snap = await getDocs(q);
      return snap.docs.map((d: any) => d.data() as TimeLog).filter((l: TimeLog) => !l.endTime);
    } catch {
      try {
        const snap = await getDocs(collection(dbInstance, COL.logs));
        return snap.docs.map((d: any) => d.data() as TimeLog).filter((l: TimeLog) => l.userId === userId && !l.endTime);
      } catch { return []; }
    }
  }
  return readLS<TimeLog[]>(LS.logs, []).filter((l) => l.userId === userId && !l.endTime);
}

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
): Promise<string> {
  // ── Validate + trim required fields — a blank operation breaks rate learning
  // and PR tracking; a blank user/job corrupts payroll attribution.
  jobId = (jobId || '').trim();
  userId = (userId || '').trim();
  userName = (userName || '').trim();
  operation = (operation || '').trim();
  if (!jobId || !userId || !userName || !operation) {
    throw new Error('Cannot clock in: job, worker, and operation are all required.');
  }

  // ── One active timer per worker. If this worker already has an open log
  // (forgot to stop, or started on another device), close it FIRST so the
  // same wall-clock minutes are never billed to two jobs at once.
  try {
    const existingOpen = await getOpenLogsForUser(userId);
    for (const open of existingOpen) {
      try { await stopTimeLog(open.id, undefined, undefined, undefined, 'auto:switched-job'); } catch { /* best effort */ }
    }
  } catch { /* if the lookup fails, fall through — better to clock in than block */ }

  // Collision-proof id (Date.now() alone collides on same-ms / shared-tablet
  // clock-ins and silently merge-overwrites a session).
  const id = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
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
        // Sanitize ensures no undefined values are sent to Firestore.
        // No merge: a fresh clock-in is always a create — merging would let a
        // (now near-impossible) id clash silently fuse two workers' sessions.
        const cleanLog = sanitize(log);
        await setDoc(doc(dbInstance, COL.logs, id), cleanLog);
        
        // Update job status safely
        try {
            await updateDoc(doc(dbInstance, COL.jobs, jobId), { status: "in-progress" } as any);
        } catch(e) {
            // Ignore job update error, log is more important
        }
        
        firebaseStatus = { connected: true };
        // Server-push admin devices so they get a notification even with browser closed
        notifyAdminsClockEvent(
          'clock-in', userName, operation,
          [partNumber, customer].filter(Boolean).join(' · '),
        ).catch(() => {});
    } catch (e) {
        throw handleError(e);
    }
    return id;
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
  return id;
}

/** Hard ceiling on a single session's working time — matches the 14h safety
 *  sweep. Stops a corrupt startTime (e.g. epoch 0) or runaway timer from
 *  recording absurd hours that would dominate payroll + rate learning. */
const MAX_SESSION_MS = 14 * 3600000;

/**
 * Compute finalized duration fields for a log being stopped — the SINGLE
 * source of truth so the Firestore + localStorage branches can never diverge.
 * Guards (each fixes a real payroll-corruption bug found in audit):
 *   • pause delta only counts if the pause began before endTime (no negative
 *     delta inflating working time when a forced cutoff predates the pause)
 *   • totalPausedMs clamped to [0, wall] (corrupt pause can't 0-floor or inflate)
 *   • workingMs clamped to [0, MAX_SESSION_MS] (no absurd multi-day durations)
 */
function finalizeDuration(
  log: { startTime: number; pausedAt?: number | null; totalPausedMs?: number },
  endTime: number,
): { totalPausedMs: number; durationSeconds: number; durationMinutes: number; anomaly: boolean } {
  const startTime = log.startTime || 0;
  let totalPausedMs = log.totalPausedMs || 0;
  if (log.pausedAt && log.pausedAt < endTime) totalPausedMs += endTime - log.pausedAt;
  const wallMs = endTime - startTime;
  // endTime before startTime (clock skew / bad edit) → anomaly, clamp to 0
  const anomaly = wallMs < 0 || totalPausedMs < 0 || totalPausedMs > Math.max(0, wallMs) || wallMs - totalPausedMs > MAX_SESSION_MS;
  totalPausedMs = Math.min(Math.max(0, totalPausedMs), Math.max(0, wallMs));
  const workingMs = Math.min(Math.max(0, wallMs - totalPausedMs), MAX_SESSION_MS);
  const durationSeconds = Math.floor(workingMs / 1000);
  // 2-decimal minutes — must match updateTimeLog (90s → 1.5 min, not 2) so
  // stop vs. edit paths never record different durations for the same session.
  const durationMinutes = Math.round((durationSeconds / 60) * 100) / 100;
  return { totalPausedMs, durationSeconds, durationMinutes, anomaly };
}

export async function stopTimeLog(logId: string, sessionQty?: number, notes?: string, forcedEndTime?: number, stopReason?: string) {
  const endTime = forcedEndTime ?? Date.now();

  if (dbInstance) {
      try {
        const ref = doc(dbInstance, COL.logs, logId);
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error("Log not found.");

        const existing = snap.data() as TimeLog;
        // Already finalized — second clock-out (manual + sweep + cron racing,
        // or a double-tap) must be a no-op, never overwrite a correct record.
        if (existing.endTime) return;

        const { totalPausedMs, durationSeconds, durationMinutes, anomaly } = finalizeDuration(existing, endTime);

        const updates: any = {
            endTime,
            durationMinutes,
            durationSeconds,
            status: 'completed',
            updatedAt: Date.now(),
            pausedAt: null,
            totalPausedMs,
            pauseReason: null,
            stopReason: stopReason ?? 'manual',
        };
        if (anomaly) updates.durationAnomaly = true; // surfaced by the health brain
        if (sessionQty !== undefined) updates.sessionQty = sessionQty;
        if (notes !== undefined) updates.notes = notes;

        await updateDoc(ref, sanitize(updates));
        updateUserProgress(existing.userId, existing.jobId, existing.operation, durationSeconds).catch(() => {});
        firebaseStatus = { connected: true };
        // Server-push admin devices on clock-out — but ONLY for real worker
        // clock-outs. Routine system stops (auto clock-out, 14h sweep, lunch
        // alarm, admin force-stop, job-switch) must NOT buzz the admin's phone.
        const routine = /^(sweep:|alarm:|admin:|auto:)/.test(updates.stopReason || '');
        if (!routine) {
          notifyAdminsClockEvent(
            'clock-out', existing.userName, existing.operation,
            [existing.partNumber, existing.customer].filter(Boolean).join(' · '),
          ).catch(() => {});
        }
      } catch (e) {
        throw handleError(e);
      }
      return;
  }

  const logs = readLS<TimeLog[]>(LS.logs, []);
  const idx = logs.findIndex((l) => l.id === logId);
  if (idx >= 0) {
    const l = logs[idx];
    if (l.endTime) return; // already completed — no-op
    const { totalPausedMs, durationSeconds, durationMinutes, anomaly } = finalizeDuration(l, endTime);
    logs[idx] = {
        ...l,
        endTime,
        durationMinutes,
        durationSeconds,
        status: 'completed',
        updatedAt: Date.now(),
        pausedAt: null,
        totalPausedMs,
        pauseReason: undefined,
        stopReason: stopReason ?? 'manual',
        ...(anomaly ? { durationAnomaly: true } : {}),
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
     // 2-decimal minutes — short sample sessions (90s for 2pc) must keep
     // sub-minute precision or per-piece rate learning is off by 30%+.
     log.durationMinutes = Math.round((log.durationSeconds / 60) * 100) / 100;
     log.status = 'completed';
  } else {
     log.endTime = undefined;
     log.durationMinutes = undefined;
     log.durationSeconds = undefined;
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

// NOTE: Deleting a user INTENTIONALLY does not cascade to their TimeLogs.
// Logs are payroll/job-costing history and must survive user deletion; each
// TimeLog snapshots `userName` at creation, so historical entries remain
// readable in reports even after the user document is gone.
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
  // Trim both inputs — mobile keyboards commonly append a trailing space,
  // which would otherwise fail an exact match. PINs stay case-sensitive (digits).
  const normalizedUser = username.trim().toLowerCase();
  const normalizedPin = pin.trim();

  if (dbInstance) {
      try {
        const q = query(collection(dbInstance, COL.users));
        const snap: any = await Promise.race([
            getDocs(q),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Cloud timeout")), 5000))
        ]);
        firebaseStatus = { connected: true };
        const users = snap.docs.map((d: any) => d.data() as User);
        const found = users.find((u: User) => u.username.trim().toLowerCase() === normalizedUser && u.pin.trim() === normalizedPin && u.isActive !== false);
        if (found) return found;
      } catch (e) {
        console.warn("Firebase Login failed (Network/Config/Timeout), falling back to Local Storage:", e);
      }
  }

  ensureSeedUsers();
  const users = readLS<User[]>(LS.users, []);
  const found = users.find(u => u.username.trim().toLowerCase() === normalizedUser && u.pin.trim() === normalizedPin && u.isActive !== false);
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
  if (dbInstance) {
    try {
      await setDoc(doc(dbInstance, COL.settings, "system"), sanitize(settings), { merge: true });
      firebaseStatus = { connected: true };
    } catch (e) {
      // Firestore failed — still persist locally so the app keeps working offline
      writeLS(LS.settings, settings);
      throw handleError(e);
    }
  }
  // Write localStorage AFTER Firestore succeeds (or when offline-only mode)
  writeLS(LS.settings, settings);
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
    const ref = doc(dbInstance, COL.userProgress, userId);
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
  const ref = doc(dbInstance, COL.userProgress, userId);
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
      // Clamp ≥ 0 — clock skew (now < pausedAt) must not write a negative
      // pause total to Firestore (finalizeDuration guards reads, not writes).
      const pausedDuration = Math.max(0, now - existing.pausedAt);
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
    const pausedDuration = Math.max(0, now - l.pausedAt); // clamp — see Firestore branch
    const totalPausedMs = (l.totalPausedMs || 0) + pausedDuration;
    logs[idx] = { ...l, pausedAt: null, pauseReason: null, totalPausedMs, status: 'in_progress', updatedAt: now };
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

/** Resume paused timers. When `reason` is given, ONLY resume logs paused with
 *  that exact pauseReason — so the lunch-end auto-resume never force-resumes a
 *  worker's own manual pause (machine down, personal break). */
export async function resumeAllPaused(reason?: string): Promise<number> {
  return new Promise((resolve) => {
    const unsub = subscribeLogs(async (all) => {
      unsub();
      const paused = all.filter(l => !l.endTime && l.pausedAt && (!reason || l.pauseReason === reason));
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
  const durationSeconds = Math.max(0, Math.floor((endTime - startTime) / 1000));
  const durationMinutes = Math.round((durationSeconds / 60) * 100) / 100; // 2-decimal, matches finalizeDuration/updateTimeLog
  const log: TimeLog = {
    id, jobId, userId, userName, operation,
    startTime, endTime, durationSeconds, durationMinutes,
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

export async function stopAllActive(reason: string = 'admin:force-stop'): Promise<number> {
  return new Promise((resolve) => {
    const unsub = subscribeLogs(async (all) => {
      unsub();
      const active = all.filter(l => !l.endTime);
      for (const l of active) {
        try { await stopTimeLog(l.id, undefined, undefined, undefined, reason); } catch {}
      }
      resolve(active.length);
    });
  });
}

// ── Cron heartbeat ──────────────────────────────────────────────
// The server cron stamps push_meta/cron-heartbeat every run. The Timekeeping
// Health brain reads this to prove the 24/7 auto-clock-out engine is alive.
export async function getCronHeartbeatMs(): Promise<number | null> {
  if (!dbInstance) return null;
  try {
    const snap = await getDoc(doc(dbInstance, 'push_meta', 'cron-heartbeat'));
    if (!snap.exists()) return null;
    const v = (snap.data() as any).lastRunMs;
    return typeof v === 'number' ? v : null;
  } catch { return null; }
}

// ── Auto Clock-Out Sweep ────────────────────────────────────────
let sweepInFlight = false;

export async function sweepStaleLogs(): Promise<number> {
  if (sweepInFlight) return 0;
  sweepInFlight = true;
  try {
    // Read settings LIVE from Firestore when connected — getSettings() reads
    // localStorage, which can be stale/empty on a fresh device before the
    // first snapshot lands, making the cutoff wrong. Fall back to cache.
    let settings = getSettings();
    if (dbInstance) {
      try {
        const sSnap = await getDoc(doc(dbInstance, COL.settings, 'system'));
        if (sSnap.exists()) settings = { ...settings, ...(sSnap.data() as any) };
      } catch { /* use cached settings */ }
    }
    const tz = (settings as any).recapTimezone || 'America/Los_Angeles';
    const nowMs = Date.now();

    // ── Always gather active logs — needed for both sweeps below ──────
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

    if (activeLogs.length === 0) return 0;

    // ── Build the list of clock-out cutoffs to check ──────────────────────
    // Sources:
    //  1. settings.autoClockOutEnabled + autoClockOutTime  (explicit, every day)
    //  2. Any shift alarm with clockOut:true && enabled !== false (alarm-driven,
    //     honoring the alarm's days[] in the SHOP timezone)
    // All cutoff math uses the shop timezone (shopLocalTimeMs) so the device's
    // own timezone never changes the result — mirrors the server cron exactly.
    const cutoffs: { h: number; m: number; days?: number[] }[] = [];

    if (settings.autoClockOutEnabled) {
      const mm = (settings.autoClockOutTime || '17:30').match(/^(\d{1,2}):(\d{2})$/);
      if (mm) cutoffs.push({ h: +mm[1], m: +mm[2] });
    }

    // Pick up any alarm flagged as a clock-out alarm (e.g. "Shift Ends")
    for (const alarm of (settings.shiftAlarms || []) as any[]) {
      if (!alarm.clockOut || alarm.enabled === false) continue;
      const mm = (alarm.time || '').match(/^(\d{1,2}):(\d{2})$/);
      if (mm) cutoffs.push({ h: +mm[1], m: +mm[2], days: alarm.days });
    }

    const SAFETY_MS = 14 * 3600000;
    const todayDow = shopDayOfWeek(tz, nowMs);

    let stopped = 0;
    for (const log of activeLogs) {
      // ── Corrupt log with no usable startTime — force-close so it can't live
      // forever and block the worker. finalizeDuration clamps the result to 0.
      if (!Number.isFinite(log.startTime) || !log.startTime) {
        try { await stopTimeLog(log.id, undefined, undefined, nowMs, 'sweep:corrupt-no-starttime'); stopped++; } catch {}
        continue;
      }

      // ── 14-hour safety net — ALWAYS runs, regardless of settings.
      // Clears orphaned logs from crashed sessions / closed browsers / forgotten
      // clock-ins. Without this, workers are permanently blocked from clocking in.
      const forcedStop = (nowMs - log.startTime) > SAFETY_MS;

      // ── Configured / alarm-driven cutoff (shop timezone) ──────────────────
      // Pick the EARLIEST qualifying cutoff so the end time is accurate when
      // multiple alarms are configured.
      let stopAt: number | null = null;
      for (const c of cutoffs) {
        // Day gate — alarm restricted to specific weekdays only fires on them.
        if (c.days && c.days.length > 0 && !c.days.includes(todayDow)) continue;
        let cutoffMs = shopLocalTimeMs(log.startTime, tz, c.h, c.m);
        // Overnight shift: an early-morning (AM) cutoff for an evening clock-in
        // lands before the clock-in → roll to the next morning. Only roll for
        // genuine AM cutoffs; a PM cutoff already passed (e.g. clock back in at
        // 6pm after a 5:30pm cutoff) must NOT roll a full day — let the safety
        // net / next cutoff handle it instead of running ~14h.
        if (cutoffMs <= log.startTime && c.h < 12) cutoffMs = shopLocalTimeMs(log.startTime + 86400000, tz, c.h, c.m);
        if (log.startTime < cutoffMs && nowMs > cutoffMs) {
          if (stopAt === null || cutoffMs < stopAt) stopAt = cutoffMs;
        }
      }

      if (stopAt !== null || forcedStop) {
        try {
          const autoEndTime = stopAt !== null ? stopAt : log.startTime + SAFETY_MS;
          const sweepReason = stopAt === null && forcedStop ? 'sweep:14h-safety' : 'sweep:auto-clockout';
          await stopTimeLog(log.id, undefined, undefined, autoEndTime, sweepReason);
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
// role + name are stored so the server-side notify-clockin function can
// filter admin subscriptions without having to join the users collection.
export async function savePushSubscription(
  userId: string,
  subscription: any,
  role?: string,
  name?: string,
): Promise<void> {
  const db = dbInstance;
  if (!db) return;
  const endpoint: string = subscription.endpoint || '';
  const key = userId + '_' + btoa(endpoint).slice(-20).replace(/[^a-zA-Z0-9]/g, '');
  await setDoc(doc(db, COL.pushSubscriptions, key), {
    userId,
    subscription,
    role:      role || '',
    name:      name || '',
    updatedAt: Date.now(),
  }, { merge: true });
}

// ── Server-push helper — clock-in / clock-out admin alerts ───────────
// Calls /.netlify/functions/notify-clockin which delivers a Web Push to
// every admin device via VAPID, even when their browser is fully closed.
// Fire-and-forget: never throws — a failed push must not break a clock-in.
async function notifyAdminsClockEvent(
  eventType: 'clock-in' | 'clock-out',
  workerName: string,
  operation: string,
  jobLabel: string,
): Promise<void> {
  try {
    await fetch('/.netlify/functions/notify-clockin', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ eventType, workerName, operation, jobLabel }),
    });
  } catch { /* silent — notification is best-effort */ }
}

// ── Server-push helper — over-estimate alert ─────────────────────────
// Fires when a running timer passes its job's expected-hours budget so the
// owner can step in. Reuses the notify-clockin function (admin fan-out) with
// the 'over-estimate' event type. Fire-and-forget — never throws.
export async function notifyAdminsOverEstimate(
  workerName: string,
  operation: string,
  jobLabel: string,
  detail: string,
): Promise<void> {
  try {
    await fetch('/.netlify/functions/notify-clockin', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ eventType: 'over-estimate', workerName, operation, jobLabel, detail }),
    });
  } catch { /* silent — notification is best-effort */ }
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
    const key = 'samples:' + COL.samples;
    return multicast<Sample[]>(key, notify => {
      return retryingSnapshot(
        () => collection(dbInstance!, COL.samples),
        (snap: any) => { firebaseStatus = { connected: true }; notify(snap.docs.map((d: any) => d.data() as Sample)); },
        () => notify(readLS<Sample[]>(LS_SAMPLES, [])),
      );
    }, cb);
  }
  return localSubscribe(() => readLS<Sample[]>(LS_SAMPLES, []), cb);
}

export async function saveSample(sample: Sample): Promise<void> {
  if (dbInstance) {
    try {
      await setDoc(doc(dbInstance, COL.samples, sample.id), sanitize(sample), { merge: true });
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
      // Remove the bridged rate-learning logs for every work entry first,
      // so a deleted sample's timing stops feeding estimates.
      try {
        const snap = await getDoc(doc(dbInstance, COL.samples, id));
        if (snap.exists()) {
          const s = snap.data() as Sample;
          await Promise.all((s.workEntries || []).map(e => deleteTimeLog(`sample-tl-${e.id}`).catch(() => {})));
        }
      } catch {}
      await deleteDoc(doc(dbInstance, COL.samples, id));
      firebaseStatus = { connected: true };
    } catch (e) {
      throw handleError(e);
    }
    return;
  }
  const all = readLS<Sample[]>(LS_SAMPLES, []);
  const gone = all.find(s => s.id === id);
  if (gone) (gone.workEntries || []).forEach(e => { deleteTimeLog(`sample-tl-${e.id}`).catch(() => {}); });
  writeLS(LS_SAMPLES, all.filter(s => s.id !== id));
}

// ── CUSTOMER PO FILES ────────────────────────────────────────────────
const LS_CUSTOMER_POS = "nexus_customer_pos";

export function subscribeCustomerPos(cb: (pos: CustomerPoFile[]) => void): () => void {
  if (dbInstance) {
    const key = 'customerPos:' + COL.customerPos;
    return multicast<CustomerPoFile[]>(key, notify => {
      return retryingSnapshot(
        () => collection(dbInstance!, COL.customerPos),
        (snap: any) => { firebaseStatus = { connected: true }; notify(snap.docs.map((d: any) => d.data() as CustomerPoFile)); },
        () => notify(readLS<CustomerPoFile[]>(LS_CUSTOMER_POS, [])),
      );
    }, cb);
  }
  return localSubscribe(() => readLS<CustomerPoFile[]>(LS_CUSTOMER_POS, []), cb);
}

export async function saveCustomerPo(po: CustomerPoFile): Promise<void> {
  if (dbInstance) {
    try {
      await setDoc(doc(dbInstance, COL.customerPos, po.id), sanitize(po), { merge: true });
      firebaseStatus = { connected: true };
    } catch (e) { throw handleError(e); }
    return;
  }
  const list = readLS<CustomerPoFile[]>(LS_CUSTOMER_POS, []);
  const idx = list.findIndex(p => p.id === po.id);
  if (idx >= 0) list[idx] = po; else list.push(po);
  writeLS(LS_CUSTOMER_POS, list);
}

export async function deleteCustomerPo(id: string): Promise<void> {
  if (dbInstance) {
    try { await deleteDoc(doc(dbInstance, COL.customerPos, id)); firebaseStatus = { connected: true }; }
    catch (e) { throw handleError(e); }
    return;
  }
  writeLS(LS_CUSTOMER_POS, readLS<CustomerPoFile[]>(LS_CUSTOMER_POS, []).filter(p => p.id !== id));
}

// ── localStorage → Firestore photo migration ──────────────────────────
// Runs once on startup. Finds any samples in phone localStorage that have
// a base64 photoUrl (saved during the period when dbInstance was null due
// to the startup bug), uploads them to Firebase Storage, then writes the
// download URL back to Firestore so all devices can see the photos.
//
// Safe to call multiple times — skips samples that already have a proper
// Storage URL in Firestore, and skips if Firebase is not connected.
function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const [header, b64] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
    const bin  = atob(b64);
    const arr  = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  } catch {
    return null;
  }
}

export async function migrateLocalPhotosToFirestore(): Promise<void> {
  if (!dbInstance) return;

  let localSamples: Sample[];
  try {
    localSamples = readLS<Sample[]>(LS_SAMPLES, []);
  } catch {
    return;
  }

  const candidates = localSamples.filter(
    s => s.photoUrl && s.photoUrl.startsWith('data:'),
  );
  if (candidates.length === 0) return;

  console.log(`[FabTrack] Migrating ${candidates.length} local photo(s) to Firebase Storage…`);

  for (const local of candidates) {
    try {
      // Check Firestore — skip if it already has a real Storage URL
      const snap = await getDoc(doc(dbInstance!, COL.samples, local.id));
      const remote = snap.exists() ? (snap.data() as Sample) : null;
      if (remote?.photoUrl && !remote.photoUrl.startsWith('data:')) {
        // Firestore already has a proper URL — just scrub the base64 from localStorage
        const updated = localSamples.map(s =>
          s.id === local.id ? { ...s, photoUrl: remote.photoUrl } : s,
        );
        writeLS(LS_SAMPLES, updated);
        continue;
      }

      // Convert base64 → Blob → Firebase Storage
      const blob = dataUrlToBlob(local.photoUrl!);
      if (!blob) continue;

      const storageUrl = await uploadSamplePhoto(blob, local.id);

      // Write the Storage URL into Firestore (merge so other fields are preserved)
      const merged = { ...(remote || local), photoUrl: storageUrl };
      await setDoc(doc(dbInstance!, COL.samples, local.id), sanitize(merged), { merge: true });

      // Update localStorage cache too so this device shows the img immediately
      const updated = localSamples.map(s =>
        s.id === local.id ? { ...s, photoUrl: storageUrl } : s,
      );
      writeLS(LS_SAMPLES, updated);

      console.log(`[FabTrack] ✓ Migrated photo for sample ${local.id}`);
    } catch (e: any) {
      // Per-sample failure must never crash the whole migration
      console.warn(`[FabTrack] Photo migration failed for sample ${local.id}:`, e?.message);
    }
  }
}

// ── Job part-image → Storage migration ────────────────────────────────
// Part photos historically lived as base64 INSIDE job documents, so every
// device re-downloaded every photo on every jobs snapshot (a 100-job board
// with 200KB photos = ~20MB per sync — the single biggest source of lag).
// This moves them to Firebase Storage and patches the job with the URL.
//
// Safe by construction: capped per run (spreads work across startups),
// re-checks each doc right before patching (another device may have done it),
// patches ONLY the partImage field (updateDoc — never clobbers other edits),
// and any failure just leaves that job on base64 until the next run.
export async function migrateJobPartImagesToStorage(maxPerRun = 10): Promise<void> {
  if (!dbInstance) return;
  try {
    const snap = await getDocs(collection(dbInstance, COL.jobs));
    const candidates: Job[] = [];
    snap.forEach(d => {
      const j = d.data() as Job;
      if (j.partImage && j.partImage.startsWith('data:')) candidates.push(j);
    });
    if (candidates.length === 0) return;

    const batch = candidates.slice(0, maxPerRun);
    console.log(`[FabTrack] Migrating ${batch.length}/${candidates.length} job part image(s) to Storage…`);
    for (const job of batch) {
      try {
        // Re-check right before work — another device may have migrated it.
        const fresh = await getDoc(doc(dbInstance!, COL.jobs, job.id));
        const cur = fresh.exists() ? (fresh.data() as Job) : null;
        if (!cur?.partImage || !cur.partImage.startsWith('data:')) continue;

        const blob = dataUrlToBlob(cur.partImage);
        if (!blob) continue;
        const url = await uploadJobPartImage(blob, job.id);
        await updateDoc(doc(dbInstance!, COL.jobs, job.id), { partImage: url });
        console.log(`[FabTrack] ✓ Part image → Storage for job ${job.jobIdsDisplay || job.id}`);
      } catch (e: any) {
        console.warn(`[FabTrack] Part-image migration failed for job ${job.id}:`, e?.message);
      }
    }
  } catch (e: any) {
    console.warn('[FabTrack] Part-image migration skipped:', e?.message);
  }
}

// ── REWORK ENTRIES ────────────────────────────────────────────────
const LS_REWORK = "nexus_rework";

export function subscribeRework(cb: (entries: ReworkEntry[]) => void): () => void {
  if (dbInstance) {
    const colRef = collection(dbInstance, COL.rework);
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
      await setDoc(doc(dbInstance, COL.rework, entry.id), sanitize(entry), { merge: true });
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

// ── DELIVERIES ────────────────────────────────────────────────────
// GPS-tracked courier runs. Stored in Firestore when online, localStorage
// fallback otherwise. Same CRUD shape as the other collections.
const LS_DELIVERIES = "nexus_deliveries";

export function subscribeDeliveries(cb: (deliveries: Delivery[]) => void): () => void {
  if (dbInstance) {
    const colRef = collection(dbInstance, COL.deliveries);
    return onSnapshot(colRef,
      (snap: any) => {
        firebaseStatus = { connected: true };
        const rows = snap.docs.map((d: any) => d.data() as Delivery)
          .sort((a: Delivery, b: Delivery) => (b.createdAt || 0) - (a.createdAt || 0));
        cb(rows);
      },
      (err: any) => {
        handleError(err);
        cb(readLS<Delivery[]>(LS_DELIVERIES, []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
      }
    );
  }
  return localSubscribe(
    () => readLS<Delivery[]>(LS_DELIVERIES, []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    cb,
  );
}

export async function saveDelivery(d: Delivery): Promise<void> {
  const withUpdated: Delivery = { ...d, updatedAt: Date.now() };
  if (dbInstance) {
    try {
      await setDoc(doc(dbInstance, COL.deliveries, d.id), sanitize(withUpdated), { merge: true });
      firebaseStatus = { connected: true };
    } catch (e) { throw handleError(e); }
    return;
  }
  const list = readLS<Delivery[]>(LS_DELIVERIES, []);
  const idx = list.findIndex(x => x.id === d.id);
  if (idx >= 0) list[idx] = withUpdated; else list.push(withUpdated);
  writeLS(LS_DELIVERIES, list);
}

export async function deleteDelivery(id: string): Promise<void> {
  if (dbInstance) {
    try {
      await deleteDoc(doc(dbInstance, COL.deliveries, id));
      firebaseStatus = { connected: true };
    } catch (e) { throw handleError(e); }
    return;
  }
  writeLS(LS_DELIVERIES, readLS<Delivery[]>(LS_DELIVERIES, []).filter(d => d.id !== id));
}

/** Auto-generate the next run number — "DEL-001", "DEL-002" etc.
 *  Scans existing runs for max + 1. Non-numeric custom runs are ignored. */
export function nextDeliveryRunNumber(list: Delivery[]): string {
  let max = 0;
  for (const d of list) {
    const m = /^DEL-(\d+)$/.exec(d.runNumber || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `DEL-${String(max + 1).padStart(3, '0')}`;
}

// ── VENDORS ────────────────────────────────────────────────────────
// Reusable supplier records — created once, referenced by many POs.
const LS_VENDORS = 'nexus_vendors';

export function subscribeVendors(cb: (vendors: Vendor[]) => void): () => void {
  if (dbInstance) {
    const colRef = collection(dbInstance, COL.vendors);
    return onSnapshot(colRef,
      (snap: any) => {
        firebaseStatus = { connected: true };
        const rows = snap.docs.map((d: any) => d.data() as Vendor)
          .sort((a: Vendor, b: Vendor) => a.name.localeCompare(b.name));
        cb(rows);
      },
      (err: any) => {
        handleError(err);
        cb(readLS<Vendor[]>(LS_VENDORS, []).sort((a, b) => a.name.localeCompare(b.name)));
      }
    );
  }
  return localSubscribe(
    () => readLS<Vendor[]>(LS_VENDORS, []).sort((a, b) => a.name.localeCompare(b.name)),
    cb,
  );
}

export async function saveVendor(v: Vendor): Promise<void> {
  const stamped: Vendor = { ...v, updatedAt: Date.now() };
  if (dbInstance) {
    try {
      await setDoc(doc(dbInstance, COL.vendors, v.id), sanitize(stamped), { merge: true });
      firebaseStatus = { connected: true };
    } catch (e) { throw handleError(e); }
    return;
  }
  const list = readLS<Vendor[]>(LS_VENDORS, []);
  const idx = list.findIndex(x => x.id === v.id);
  if (idx >= 0) list[idx] = stamped; else list.push(stamped);
  writeLS(LS_VENDORS, list);
}

export async function deleteVendor(id: string): Promise<void> {
  if (dbInstance) {
    try {
      await deleteDoc(doc(dbInstance, COL.vendors, id));
      firebaseStatus = { connected: true };
    } catch (e) { throw handleError(e); }
    return;
  }
  writeLS(LS_VENDORS, readLS<Vendor[]>(LS_VENDORS, []).filter(v => v.id !== id));
}

// ── PURCHASE ORDERS ───────────────────────────────────────────────
// Outbound POs we send to vendors. Big, complex documents — we store
// them as a single doc per PO (like quotes) since they're loaded one
// at a time and edited as a unit.
const LS_PURCHASE_ORDERS = 'nexus_purchase_orders';

export function subscribePurchaseOrders(cb: (pos: PurchaseOrder[]) => void): () => void {
  if (dbInstance) {
    const colRef = collection(dbInstance, COL.purchaseOrders);
    return onSnapshot(colRef,
      (snap: any) => {
        firebaseStatus = { connected: true };
        const rows = snap.docs.map((d: any) => d.data() as PurchaseOrder)
          .sort((a: PurchaseOrder, b: PurchaseOrder) => (b.createdAt || 0) - (a.createdAt || 0));
        cb(rows);
      },
      (err: any) => {
        handleError(err);
        cb(readLS<PurchaseOrder[]>(LS_PURCHASE_ORDERS, []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
      }
    );
  }
  return localSubscribe(
    () => readLS<PurchaseOrder[]>(LS_PURCHASE_ORDERS, []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    cb,
  );
}

export async function savePurchaseOrder(po: PurchaseOrder): Promise<void> {
  const stamped: PurchaseOrder = { ...po, updatedAt: Date.now() };
  if (dbInstance) {
    try {
      await setDoc(doc(dbInstance, COL.purchaseOrders, po.id), sanitize(stamped), { merge: true });
      firebaseStatus = { connected: true };
    } catch (e) { throw handleError(e); }
    return;
  }
  const list = readLS<PurchaseOrder[]>(LS_PURCHASE_ORDERS, []);
  const idx = list.findIndex(x => x.id === po.id);
  if (idx >= 0) list[idx] = stamped; else list.push(stamped);
  writeLS(LS_PURCHASE_ORDERS, list);
}

export async function deletePurchaseOrder(id: string): Promise<void> {
  if (dbInstance) {
    try {
      await deleteDoc(doc(dbInstance, COL.purchaseOrders, id));
      firebaseStatus = { connected: true };
    } catch (e) { throw handleError(e); }
    return;
  }
  writeLS(LS_PURCHASE_ORDERS, readLS<PurchaseOrder[]>(LS_PURCHASE_ORDERS, []).filter(p => p.id !== id));
}

/** PO numbers format: "PO-YYYY-NNNN". Year-prefixed so new fiscal year
 *  resets the counter without clashing with prior years in history. */
export function nextPurchaseOrderNumber(list: PurchaseOrder[]): string {
  const year = new Date().getFullYear();
  let max = 0;
  // Allow an optional suffix (e.g. "-RW" rework POs) so those numbers still
  // advance the counter — otherwise the next regular PO reuses the base number.
  for (const p of list) {
    const m = new RegExp(`^PO-${year}-(\\d+)`).exec(p.poNumber || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `PO-${year}-${String(max + 1).padStart(4, '0')}`;
}

/** Every log for a job — UNLIMITED (the live subscription caps at 500). Used
 *  when locking a profit snapshot so cost/margin is computed from the full set. */
export async function getLogsForJob(jobId: string): Promise<TimeLog[]> {
  if (dbInstance) {
    try {
      const snap = await getDocs(query(collection(dbInstance, COL.logs), where('jobId', '==', jobId)));
      return snap.docs.map((d: any) => d.data() as TimeLog);
    } catch {
      try {
        const snap = await getDocs(collection(dbInstance, COL.logs));
        return snap.docs.map((d: any) => d.data() as TimeLog).filter((l: TimeLog) => l.jobId === jobId);
      } catch { return []; }
    }
  }
  return readLS<TimeLog[]>(LS.logs, []).filter(l => l.jobId === jobId);
}

export async function deleteRework(id: string): Promise<void> {
  if (dbInstance) {
    try {
      await deleteDoc(doc(dbInstance, COL.rework, id));
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
      const ref = doc(dbInstance, COL.samples, sampleId);
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

// Bridge: when a sample work session completes, also write a TimeLog with
// isSample:true so the rate-learning engine reads it. Without this, all
// sample work is invisible to the rate engine — the admin's whole calibration
// effort would silently produce no data. Idempotent via a deterministic id.
async function _bridgeSampleWorkToTimeLog(sample: Sample, entry: SampleWorkEntry, durationSecondsCalc: number): Promise<void> {
  // Need qty + duration > 0 to be useful for rate learning
  if (!entry.qty || entry.qty <= 0) return;
  if (!durationSecondsCalc || durationSecondsCalc <= 0) return;
  if (!sample.partNumber || !entry.operation) return;

  const log: TimeLog = {
    id: `sample-tl-${entry.id}`, // deterministic — re-stopping won't duplicate
    jobId: `sample-${sample.id}`,
    userId: entry.userId || 'sample',
    userName: entry.userName || 'Sample Entry',
    operation: entry.operation,
    startTime: entry.startTime,
    endTime: entry.endTime || Date.now(),
    durationSeconds: durationSecondsCalc,
    durationMinutes: Math.round((durationSecondsCalc / 60) * 100) / 100,
    // Carry the finalized paused span so updateTimeLog's recompute subtracts it
    // — otherwise a sample paused for lunch teaches the rate engine the break.
    totalPausedMs: entry.totalPausedMs || 0,
    partNumber: sample.partNumber,
    customer: sample.companyName,
    status: 'completed',
    sessionQty: entry.qty,
    isSample: true,
    createdAt: entry.startTime,
    updatedAt: Date.now(),
    notes: entry.notes,
  };
  try {
    await updateTimeLog(log);
  } catch (e) {
    // Don't fail the sample save if rate-learning bridge fails — log it instead
    console.warn('[bridgeSampleWorkToTimeLog] failed:', e);
  }
}

export async function stopSampleWork(sampleId: string, notes?: string): Promise<void> {
  const now = Date.now();

  if (dbInstance) {
    try {
      const ref = doc(dbInstance, COL.samples, sampleId);
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
      // ── Bridge to rate-learning engine ──
      await _bridgeSampleWorkToTimeLog(sample, completed, durationSeconds);
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
    // ── Bridge to rate-learning engine ──
    await _bridgeSampleWorkToTimeLog(samples[idx], completed, durationSeconds);
  }
}

export async function pauseSampleWork(sampleId: string, reason?: string): Promise<void> {
  const now = Date.now();
  if (dbInstance) {
    try {
      const ref = doc(dbInstance, COL.samples, sampleId);
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
      const ref = doc(dbInstance, COL.samples, sampleId);
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
      const ref = doc(dbInstance, COL.samples, sampleId);
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
      // Re-sync the bridged rate-learning log so a corrected time actually
      // updates estimates (the bridge id is deterministic → overwrites in place).
      try { await _bridgeSampleWorkToTimeLog(sample, updated, updated.durationSeconds || 0); } catch {}
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
  try { await _bridgeSampleWorkToTimeLog(samples[sIdx], updated, updated.durationSeconds || 0); } catch {}
}

export async function deleteSampleWorkEntry(sampleId: string, entryId: string): Promise<void> {
  const now = Date.now();

  if (dbInstance) {
    try {
      const ref = doc(dbInstance, COL.samples, sampleId);
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
      // Remove the bridged rate-learning log so deleted timing stops polluting estimates.
      try { await deleteTimeLog(`sample-tl-${entryId}`); } catch {}
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
  try { await deleteTimeLog(`sample-tl-${entryId}`); } catch {}
}
