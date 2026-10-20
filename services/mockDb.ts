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
  deleteField,
  runTransaction,
  getDocFromServer,
  getDocFromCache,
  getDocsFromCache,
  serverTimestamp,
  Timestamp,
  FieldPath,
  writeBatch,
  increment,
} from "firebase/firestore";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

import type { Job, TimeLog, User, SystemSettings, Sample, SampleWorkEntry, Quote, QuoteViewEvent, ReworkEntry, Delivery, Vendor, PurchaseOrder, CustomerPoFile, ShopAction, TvDevice, TvPairing, ChecklistTick } from "../types";
import { shopLocalTimeMs, shopDayOfWeek } from "../utils/timezone";
import { photoPartKey } from "../utils/partKey";
import { setShopStages, isShippedStageId } from "../utils/dueDates";
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
import { newTvToken } from "../utils/tvRuntime";
import { finalizeDuration, timeLogEditPatch, newTimeLogRecord } from "../utils/timeLogEdit";

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
    } else if (msg.includes("No document to update")) {
        msg = "That record was deleted on another device";
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

// Cloud Storage now requires the Firebase Blaze plan; on the free Spark plan
// every upload fails with storage/quota-exceeded (HTTP 402). Once we've seen
// that, skip Storage for a few hours so photo saves don't each wait on a doomed
// upload before falling back to base64. Re-checks automatically, so upgrading
// the plan takes effect on its own.
const STORAGE_BLOCKED_KEY = 'fabtrack_storage_blocked_until';
function storageBlocked(): boolean {
  try { return Date.now() < Number(localStorage.getItem(STORAGE_BLOCKED_KEY) || 0); } catch { return false; }
}

async function uploadPhoto(folder: string, id: string, file: File | Blob, timeoutMs: number): Promise<string> {
  if (storageBlocked()) throw new Error('Storage upload failed: storage unavailable (quota-exceeded)');
  try {
    // getStorage() uses the Firebase app singleton — works whenever the app
    // initialised, even if the Firestore dbInstance is null.
    const ref = storageRef(getStorage(), `${folder}/${id}_${Date.now()}.jpg`);
    await withTimeout(uploadBytes(ref, file, { contentType: 'image/jpeg' }), timeoutMs, 'Storage upload');
    return await withTimeout(getDownloadURL(ref), 10_000, 'Storage URL fetch');
  } catch (e) {
    const msg = String((e as any)?.message || '');
    if (msg.includes('quota-exceeded')) {
      try { localStorage.setItem(STORAGE_BLOCKED_KEY, String(Date.now() + 6 * 3600_000)); } catch {}
    }
    throw new Error('Storage upload failed: ' + msg);
  }
}

export const uploadSamplePhoto = (file: File | Blob, sampleId: string) => uploadPhoto('sample-photos', sampleId, file, 15_000);
/** Part photos in Storage keep job docs tiny — embedded base64 makes every
 *  device re-download every photo on every jobs sync. */
export const uploadJobPartImage = (file: File | Blob, jobId: string) => uploadPhoto('job-parts', jobId, file, 15_000);
export const uploadCustomerPoPhoto = (file: File | Blob, poId: string) => uploadPhoto('customer-pos', poId, file, 20_000);

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
  // A full localStorage (QuotaExceeded) is only this device's backup copy —
  // it must not fail a save that already reached Firestore, or stop a
  // subscription from delivering data.
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.warn('[storage] could not keep a local copy of', key, e); }
  // Notify in a microtask so writes complete before reads
  queueMicrotask(() => localSubscribers.forEach(n => { try { n(); } catch {} }));
}

// SECURITY: this file used to seed demo accounts — admin/9999 (role admin) and
// op1/1234 — into every browser's localStorage, re-asserting PIN 9999 if anyone
// changed it, and loginUser() checked that list whenever the real user list had
// no match. So typing admin / 9999 on the live login page opened the full admin
// app on any device, and the credentials were published in the repo. Seeding is
// gone; this removes the accounts it already planted on devices that ran it.
const SEEDED_BACKDOORS: Array<{ id: string; username: string; pin: string }> = [
  { id: 'admin1', username: 'admin', pin: '9999' },
  { id: 'emp1', username: 'op1', pin: '1234' },
];
function purgeSeedUsers(): void {
  try {
    const users = readLS<User[]>(LS.users, []);
    const kept = users.filter(u => !SEEDED_BACKDOORS.some(s =>
      u.id === s.id || ((u.username || '').trim().toLowerCase() === s.username && (u.pin || '').trim() === s.pin)));
    if (kept.length !== users.length) writeLS(LS.users, kept);
  } catch { /* storage unavailable — nothing to purge */ }
}
purgeSeedUsers();

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
// Cache key = collection path (already tenant-scoped by COL.*).
//
// When the last subscriber leaves, the listener stays open a while
// (MC_LINGER_MS) before closing. On a shared floor tablet one worker signs
// out and the next signs in minutes or hours later; re-opening a listener
// after Firestore's ~30-minute resume window re-reads every job (~325) and
// the newest 500 logs — the biggest cost of a sign-in. An open, idle
// listener only costs the documents that actually change.
const MC_LINGER_MS = 4 * 3600_000;
type MCEntry<T> = {
  cbs:     Set<(v: T) => void>;
  last:    T | undefined;
  hasLast: boolean;
  unsub:   (() => void) | null;
  tenant:  string;   // tenant at attach time — stale-listener guard on tenant switch
  linger:  ReturnType<typeof setTimeout> | null;
};
const _mc = new Map<string, MCEntry<any>>();

function multicast<T>(
  key:    string,
  create: (notify: (v: T) => void) => () => void,
  cb:     (v: T) => void,
): () => void {
  let m = _mc.get(key) as MCEntry<T> | undefined;
  if (!m) {
    m = { cbs: new Set(), last: undefined, hasLast: false, unsub: null, tenant: getTenantId(), linger: null };
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
  if (m.linger) { clearTimeout(m.linger); m.linger = null; }
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
    if (e.cbs.size === 0 && !e.linger) {
      e.linger = setTimeout(() => {
        e.linger = null;
        if (_mc.get(key) === e && e.cbs.size === 0) {
          e.unsub?.();
          _mc.delete(key);
        }
      }, MC_LINGER_MS);
    }
  };
}

/** Call on a tenant switch / account sign-out to tear down all shared listeners now. */
export function clearMulticastCache() {
  _mc.forEach(e => { if (e.linger) clearTimeout(e.linger); e.unsub?.(); });
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
  get shopActions()       { return colPath(getTenantId(), "shop_actions"); },
  get tvDevices()         { return colPath(getTenantId(), "tv_devices"); },
  get tvPairing()         { return colPath(getTenantId(), "tv_pairing"); },
};

// --------------------
// JOBS
// --------------------

// ── Part-photo memory ─────────────────────────────────────────────
// Photos are stored per JOB, but a part looks the same on every run — so a
// new job for a repeat part used to render photo-less until someone
// re-uploaded the same picture ("photo shows up sometimes and sometimes
// not"). Enriching here, at the single subscription choke point, means every
// view (board, lists, clock-in snapshot, traveler) inherits the part's best
// known photo with no per-view changes. In-memory only — nothing is written
// back to Firestore unless the user saves the job, which merely persists a
// tiny Storage-URL string.
/** When a job's own photo was taken. Older photos predate partImageAt, so fall
 *  back to the job's own timestamps — imperfect, but only until re-photographed. */
const photoTakenAt = (j: Job): number => j.partImageAt || j.completedAt || j.createdAt || 0;

/** Exported for tests — pure. */
export function enrichJobsWithPartPhotos(list: Job[]): Job[] {
  // One photo per part: the most recently TAKEN one. (This used to prefer any
  // Storage URL over a newer base64 photo, so a fresh photo could lose to an
  // old one — the part kept showing its old picture after a re-shoot.)
  // Placeholder part numbers ("N/A", "TBD") never pool: five N/A jobs are
  // five different parts, and pooling showed one job's photo on another.
  const best = new Map<string, { url: string; at: number; po: string }>();
  for (const j of list) {
    if (!j.partImage) continue;
    const k = photoPartKey(j.partNumber);
    if (!k) continue;
    const at = photoTakenAt(j);
    const cur = best.get(k);
    if (!cur || at > cur.at) best.set(k, { url: j.partImage, at, po: j.poNumber || '' });
  }
  if (best.size === 0) return list;
  let changed = false;
  const out = list.map(j => {
    if (j.partImage) return j;
    const hit = best.get(photoPartKey(j.partNumber));
    if (!hit) return j;
    changed = true;
    // Tagged so saveJob() can strip it again. Several callers save with
    // `{ ...job, oneField }`, which would otherwise persist a borrowed photo
    // as this job's OWN copy — duplicating 126 KB of base64 per save and
    // re-bloating the very docs this is meant to keep small.
    return { ...j, partImage: hit.url, photoInherited: true, photoFromPo: hit.po } as Job;
  });
  return changed ? out : list;
}

/** The photo a part currently shows (newest own photo across its jobs), for
 *  previews — e.g. the job editor before a new job has been saved. */
export function partPhotoFor(jobs: Job[], partNumber?: string, excludeJobId?: string): { url: string; po: string } | null {
  const k = photoPartKey(partNumber);
  if (!k) return null;
  let best: { url: string; po: string; at: number } | null = null;
  for (const j of jobs) {
    if (j.id === excludeJobId || !j.partImage || j.photoInherited) continue;
    if (photoPartKey(j.partNumber) !== k) continue;
    const at = photoTakenAt(j);
    if (!best || at > best.at) best = { url: j.partImage, po: j.poNumber || '', at };
  }
  return best ? { url: best.url, po: best.po } : null;
}

/**
 * Set (or clear, with null) a job's OWN part photo. Writes only the photo
 * fields — never the whole job — so a slow upload can't revert edits made to
 * the job meanwhile, and clearing really deletes (a plain save can't: merge
 * writes skip undefined, so a "removed" photo used to come straight back).
 */
/** Tick / untick checklist items. Writes ONLY the checklist — the worker card
 *  used to re-save the whole job (photo included) from its possibly stale
 *  copy, so a lagging tablet could undo an office edit to the due date or qty. */
export async function setJobChecklist(jobId: string, checklist: NonNullable<Job['checklist']>): Promise<void> {
  if (dbInstance) {
    try {
      await settleWrite(updateDoc(doc(dbInstance, COL.jobs, jobId), { checklist: sanitize(checklist) } as any));
      firebaseStatus = { connected: true };
    } catch (e) { throw handleError(e); }
    return;
  }
  const jobs = readLS<Job[]>(LS.jobs, []);
  const idx = jobs.findIndex(j => j.id === jobId);
  if (idx >= 0) { jobs[idx] = { ...jobs[idx], checklist }; writeLS(LS.jobs, jobs); }
}

/**
 * Tick or un-tick ONE checklist step. Written as its own field
 * (checklistTicks.<itemId>), so two people ticking different steps at once —
 * or the office saving the job editor meanwhile — can't erase each other's
 * ticks. (The whole checklist array used to be saved; last write won.)
 */
export async function setChecklistTick(jobId: string, itemId: string, tick: ChecklistTick): Promise<'saved' | 'queued' | void> {
  if (dbInstance) {
    try {
      const result = await settleWrite(updateDoc(doc(dbInstance, COL.jobs, jobId), new FieldPath('checklistTicks', itemId), sanitize(tick)));
      firebaseStatus = { connected: true };
      return result;
    } catch (e) { throw handleError(e); }
  }
  const jobs = readLS<Job[]>(LS.jobs, []);
  const idx = jobs.findIndex(j => j.id === jobId);
  if (idx >= 0) {
    jobs[idx] = { ...jobs[idx], checklistTicks: { ...(jobs[idx].checklistTicks || {}), [itemId]: tick } };
    writeLS(LS.jobs, jobs);
  }
}

export async function setJobPhoto(jobId: string, partImage: string | null): Promise<void> {
  if (dbInstance) {
    const fields = partImage
      ? { partImage, partImageAt: Date.now() }
      : { partImage: deleteField(), partImageAt: deleteField() };
    if (partImage) await assertJobFits(jobId, { partImage });
    try {
      await settleWrite(updateDoc(doc(dbInstance, COL.jobs, jobId), fields as any));
      firebaseStatus = { connected: true };
    } catch (e) { throw handleError(e); }
    return;
  }
  const jobs = readLS<Job[]>(LS.jobs, []);
  const idx = jobs.findIndex(j => j.id === jobId);
  if (idx < 0) return;
  if (partImage) {
    jobs[idx] = { ...jobs[idx], partImage, partImageAt: Date.now() };
  } else {
    const { partImage: _p, partImageAt: _a, ...rest } = jobs[idx];
    jobs[idx] = rest as Job;
  }
  writeLS(LS.jobs, jobs);
}

export function subscribeJobs(cb: (jobs: Job[]) => void) {
  if (dbInstance) {
    const key = 'jobs:' + COL.jobs;
    return multicast<Job[]>(key, notify => {
      return retryingSnapshot(
        () => collection(dbInstance!, COL.jobs),
        snap => { firebaseStatus = { connected: true }; notify(enrichJobsWithPartPhotos(snap.docs.map(d => d.data() as Job))); },
        () => notify(enrichJobsWithPartPhotos(readLS<Job[]>(LS.jobs, []))),
      );
    }, cb);
  }
  return localSubscribe(() => enrichJobsWithPartPhotos(readLS<Job[]>(LS.jobs, [])), cb);
}

/**
 * The wall TV's jobs: everything still open, plus jobs finished since `since`
 * (enough for its Today / week / month numbers). Loading every job ever —
 * 325 for this shop, ~200 photos stored inside them (≈28 MB) — was heavy for
 * a 1 GB TV stick, and every clock-in re-processed all of them. An open job
 * whose part photo lives on an older run still shows it: those photos are
 * looked up once per part.
 */
export function subscribeTvJobs(since: number, cb: (jobs: Job[]) => void): () => void {
  if (!dbInstance) return subscribeJobs(cb);
  let open: Job[] = [], done: Job[] = [];
  let haveOpen = false, haveDone = false, destroyed = false;
  const borrowed = new Map<string, { url: string; at: number; po: string }>();   // part key → photo from an older run
  const lookedUp = new Set<string>();

  const lookUpMissing = (list: Job[]) => {
    const parts: string[] = [];
    for (const j of list) {
      if (j.status === 'completed' || j.partImage || !j.partNumber) continue;
      const k = photoPartKey(j.partNumber);
      if (!k || lookedUp.has(k)) continue;
      lookedUp.add(k);
      parts.push(j.partNumber);
    }
    for (let i = 0; i < parts.length; i += 30) {            // 'in' takes up to 30 values
      const chunk = parts.slice(i, i + 30);
      queryDocs(query(collection(dbInstance!, COL.jobs), where('partNumber', 'in', chunk)))
        .then((snap: any) => {
          let added = false;
          for (const d of snap.docs) {
            const j = d.data() as Job;
            const k = j.partImage ? photoPartKey(j.partNumber) : '';
            if (!k) continue;
            const at = photoTakenAt(j), cur = borrowed.get(k);
            if (!cur || at > cur.at) { borrowed.set(k, { url: j.partImage!, at, po: j.poNumber || '' }); added = true; }
          }
          if (added) emit();
        })
        .catch(() => { chunk.forEach(p => lookedUp.delete(photoPartKey(p))); });   // try again on the next update
    }
  };

  const emit = () => {
    if (destroyed || !haveOpen || !haveDone) return;       // both halves first — no half list flashing up
    const byId = new Map<string, Job>();
    for (const j of done) byId.set(j.id, j);
    for (const j of open) byId.set(j.id, j);
    let list = enrichJobsWithPartPhotos([...byId.values()]);
    if (borrowed.size) {
      list = list.map(j => {
        if (j.partImage) return j;
        const hit = borrowed.get(photoPartKey(j.partNumber));
        return hit ? ({ ...j, partImage: hit.url, photoInherited: true, photoFromPo: hit.po } as Job) : j;
      });
    }
    cb(list);
    lookUpMissing(list);
  };

  const unsubOpen = retryingSnapshot(
    () => query(collection(dbInstance!, COL.jobs), where('status', 'in', ['pending', 'in-progress', 'hold'])),
    (snap: any) => { firebaseStatus = { connected: true }; open = snap.docs.map((d: any) => d.data() as Job); haveOpen = true; emit(); },
    () => { haveOpen = true; emit(); },
  );
  const unsubDone = retryingSnapshot(
    () => query(collection(dbInstance!, COL.jobs), where('completedAt', '>=', since)),
    (snap: any) => { done = snap.docs.map((d: any) => d.data() as Job).filter((j: Job) => j.status === 'completed'); haveDone = true; emit(); },
    () => { haveDone = true; emit(); },
  );
  return () => { destroyed = true; unsubOpen(); unsubDone(); };
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

/**
 * Save a job (merge). `clear` lists fields to DELETE in the same write — a
 * merge skips undefined, so a price, budget or tracking number emptied in the
 * editor used to come straight back. Resolves 'queued' when offline (the save
 * is on this device and syncs later) instead of hanging.
 */
export async function saveJob(job: Job, opts: { clear?: string[] } = {}): Promise<'saved' | 'queued'> {
  // Never persist a photo this job only BORROWED from another run of the same
  // part (see enrichJobsWithPartPhotos). Callers commonly save with
  // `{ ...job, oneField }`, so the tag has to be honored here at the single
  // write choke point rather than at each call site. Copy first — mutating the
  // caller's object would wipe the photo from the live UI.
  if ((job as any).photoInherited || (job as any).photoFromPo !== undefined) {
    const { partImage, photoInherited, photoFromPo, ...rest } = job as any;
    job = (photoInherited ? rest : { ...rest, partImage }) as Job;
  }
  const clear = (opts.clear || []).filter(f => (job as any)[f] === undefined);
  if (dbInstance) {
      await assertJobFits(job.id, { ...job, ...Object.fromEntries(clear.map(f => [f, undefined])) });
      try {
        const payload = sanitize(job);
        for (const f of clear) payload[f] = deleteField();
        const result = await settleWrite(setDoc(doc(dbInstance, COL.jobs, job.id), payload, { merge: true }));
        firebaseStatus = { connected: true };
        return result;
      } catch (e) {
        throw handleError(e);
      }
  }
  const jobs = readLS<Job[]>(LS.jobs, []);
  const idx = jobs.findIndex((j) => j.id === job.id);
  // Merge (not replace) so fields intentionally omitted by the caller — e.g.
  // currentStage/stageHistory, which only advanceJobStage should write — keep
  // their existing values instead of being wiped. Matches Firestore merge:true.
  // Like Firestore, an undefined field is skipped (only `clear` deletes).
  if (idx >= 0) {
    const merged: any = { ...jobs[idx], ...sanitize(job) };
    for (const f of clear) delete merged[f];
    jobs[idx] = merged;
  } else jobs.push(job);
  writeLS(LS.jobs, jobs);
  return 'saved';
}

/**
 * Change just these fields of a job; `undefined` deletes a field. Prefer this
 * to saveJob({ ...job, field }) — re-saving a whole job from a copy that may be
 * stale reverted edits made elsewhere meanwhile (and re-sent its photo).
 */
/** Job docs carry embedded photos/attachments; refuse an edit that would
 *  push one past Firestore's limit (the server would reject it later, after
 *  the user was told it saved). */
async function assertJobFits(jobId: string, fields: Record<string, unknown>) {
  if (!dbInstance) return;
  await assertMergedFits(doc(dbInstance, COL.jobs, jobId), fields, 'job');
}

export async function updateJobFields(jobId: string, changes: Partial<Job>): Promise<'saved' | 'queued'> {
  const keys = Object.keys(changes);
  if (!keys.length) return 'saved';
  if (dbInstance) {
    await assertJobFits(jobId, changes as Record<string, unknown>);
    const payload: Record<string, unknown> = {};
    for (const k of keys) {
      const v = (changes as any)[k];
      payload[k] = v === undefined ? deleteField() : sanitize(v);
    }
    try {
      const result = await settleWrite(updateDoc(doc(dbInstance, COL.jobs, jobId), payload as any));
      firebaseStatus = { connected: true };
      return result;
    } catch (e) { throw handleError(e); }
  }
  const jobs = readLS<Job[]>(LS.jobs, []);
  const idx = jobs.findIndex(j => j.id === jobId);
  if (idx >= 0) {
    const next: any = { ...jobs[idx] };
    for (const k of keys) {
      const v = (changes as any)[k];
      if (v === undefined) delete next[k]; else next[k] = v;
    }
    jobs[idx] = next;
    writeLS(LS.jobs, jobs);
  }
  return 'saved';
}

// Rename customer on every matching job. Case-sensitive match for `oldNames`.
// Used by Settings → Customers merge tool.
export async function renameCustomer(oldNames: string[], newName: string): Promise<number> {
  const oldSet = new Set(oldNames.filter(n => n && n !== newName));
  let count = 0;
  if (dbInstance) {
    try {
      // Only the jobs with those names (it read every job — ~28 MB with
      // photos), and only the customer field changes (it rewrote each whole
      // job, photos and all, and hung offline).
      const names = [...oldSet];
      const ids = new Set<string>();
      for (let i = 0; i < names.length; i += 30) {
        const snap = await queryDocs(query(collection(dbInstance, COL.jobs), where('customer', 'in', names.slice(i, i + 30))));
        snap.forEach((d: any) => ids.add(d.id));
      }
      const all = [...ids];
      for (let i = 0; i < all.length; i += 400) {
        const batch = writeBatch(dbInstance);
        all.slice(i, i + 400).forEach(id => batch.update(doc(dbInstance, COL.jobs, id), { customer: newName }));
        await settleWrite(batch.commit());
      }
      count = all.length;
      firebaseStatus = { connected: true };
    } catch (e) {
      throw handleError(e);
    }
    return count;
  }
  const jobs = readLS<Job[]>(LS.jobs, []);
  const updated = jobs.map(j => {
    if (j.customer && oldSet.has(j.customer)) { count++; return { ...j, customer: newName }; }
    return j;
  });
  writeLS(LS.jobs, updated);
  return count;
}

/**
 * Delete a job. Its time logs STAY: they're people's worked hours (payroll,
 * weekly report), the same rule as deleting a user. Each log carries its own
 * job label, so it still reads right with the job gone. (This used to
 * cascade-delete them — deleting a duplicate job wiped hours someone worked.)
 */
export async function deleteJob(id: string) {
  if (dbInstance) {
      try {
        await settleWrite(deleteDoc(doc(dbInstance, COL.jobs, id)));
        firebaseStatus = { connected: true };
      } catch (e) {
        throw handleError(e);
      }
      return;
  }
  const jobs = readLS<Job[]>(LS.jobs, []).filter((j) => j.id !== id);
  writeLS(LS.jobs, jobs);
}

export async function completeJob(id: string) {
  const completedAt = Date.now();
  if (dbInstance) {
      try {
        await settleWrite(updateDoc(doc(dbInstance, COL.jobs, id), { status: "completed", completedAt } as any));
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
  /** When the job actually left the shop (from the ship-date dialog). On-time
   *  is judged by this; completedAt only records when someone clicked. */
  shippedAt?: number,
) {
  const completedAt = Date.now();
  const updates: any = { status: 'completed', completedAt, profitSnapshot: snapshot };
  if (materialCost > 0) updates.materialCost = materialCost;
  if (shippedAt) updates.shippedAt = shippedAt;
  if (dbInstance) {
    try {
      await settleWrite(updateDoc(doc(dbInstance, COL.jobs, id), updates));
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
      await settleWrite(updateDoc(doc(dbInstance, COL.jobs, jobId), { jobNotes: arrayUnion(note) } as any));
      firebaseStatus = { connected: true };
      // Also write to flat notes collection so the push cron can query recent notes
      try {
        await settleWrite(setDoc(doc(dbInstance, COL.notes, note.id), {
          jobId,
          jobLabel: jobLabel || jobId,
          text: note.text,
          userId: note.userId,
          userName: note.userName,
          timestamp: note.timestamp,
        }));
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
         await settleWrite(updateDoc(doc(dbInstance, COL.jobs, id), { status: "pending", completedAt: null, shippedAt: null } as any));
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
    jobs[idx] = { ...j, status: "pending", completedAt: null, shippedAt: null } as Job;
    writeLS(LS.jobs, jobs);
  }
}

// Advance a job to the next workflow stage
export async function advanceJobStage(id: string, stageId: string, userId: string, userName: string, isComplete?: boolean, shippedAt?: number) {
  const updates: any = {
    currentStage: stageId,
    stageHistory: arrayUnion({ stageId, timestamp: Date.now(), userId, userName }),
  };
  if (isComplete) {
    updates.status = 'completed';
    // Already finished (e.g. Shipped → Invoiced): keep the real completion
    // date — it moved the job into this month's numbers.
    let alreadyDone = false;
    if (dbInstance) {
      try { const snap = await getDocFromCache(doc(dbInstance, COL.jobs, id)); alreadyDone = snap.exists() && (snap.data() as Job).status === 'completed' && !!(snap.data() as Job).completedAt; } catch { /* not cached */ }
    } else {
      const cur = readLS<Job[]>(LS.jobs, []).find(j => j.id === id);
      alreadyDone = !!(cur && cur.status === 'completed' && cur.completedAt);
    }
    if (!alreadyDone) updates.completedAt = Date.now();
    // Keep a ship date already recorded by a Shipped stage unless the user
    // just told us a different one.
    if (shippedAt) updates.shippedAt = shippedAt;
  } else {
    // Moving to ANY non-complete stage must drop the job out of 'completed' and
    // clear the locked snapshot — otherwise dragging a done job back to QC
    // leaves it counted as both completed AND active (the two views disagree).
    updates.status = stageId === 'pending' ? 'pending' : 'in-progress';
    updates.completedAt = null;
    updates.profitSnapshot = null;
    // Entering a Shipped stage (built-in id OR a custom stage named "Shipped" —
    // only the built-in id used to count) records the ship date; moving back
    // to any other open stage means it hasn't shipped.
    updates.shippedAt = isShippedStageId(stageId) ? (shippedAt || Date.now()) : null;
  }
  if (dbInstance) {
    try {
      await settleWrite(updateDoc(doc(dbInstance, COL.jobs, id), updates));
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
        ? { status: 'completed', completedAt: updates.completedAt ?? j.completedAt ?? Date.now(), ...(shippedAt ? { shippedAt } : {}) }
        : {
            status: stageId === 'pending' ? 'pending' : 'in-progress', completedAt: null, profitSnapshot: null,
            shippedAt: isShippedStageId(stageId) ? (shippedAt || Date.now()) : null,
          }),
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

/**
 * One-shot DEEP log history (newest-first, default 5000). The live
 * subscribeLogs stream caps at 500 for bandwidth — fine for dashboards, but
 * the risk/familiarity engine needs the long memory ("Victor ran this part in
 * January").
 *
 * Shared across every caller in the tab (worker screen + admin Jobs view
 * both want it) via a module-level cache: concurrent callers await the same
 * in-flight read, and a remount within the TTL reuses the cached result.
 *
 * Kept on the device, too (IndexedDB): it used to re-read EVERY log
 * (~1,700+) on each worker sign-in and each Jobs/Calendar visit after a
 * reload — a big share of the free daily read quota. Now a refresh asks only
 * for logs started in the last few days (that catches timers that ended or
 * were edited since); the whole history is re-read at most once a week,
 * which also drops deleted logs. Edits to older logs can show up to a week
 * late here — fine for what this feeds (part history / familiarity).
 */
const LOG_HISTORY_TTL_MS = 10 * 60_000;
const LOG_HISTORY_OVERLAP_MS = 3 * 86_400_000;
const LOG_HISTORY_FULL_EVERY_MS = 7 * 86_400_000;
let logHistoryCache: { at: number; max: number; data: TimeLog[] } | null = null;
let logHistoryPromise: Promise<TimeLog[]> | null = null;

// Tiny IndexedDB key/value store for device-side caches. Every call is
// best-effort: no IndexedDB (or a blocked one) just means no cache.
let kvDbPromise: Promise<IDBDatabase | null> | null = null;
function kvDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!kvDbPromise) {
    kvDbPromise = new Promise(resolve => {
      try {
        const req = indexedDB.open('fabtrack-cache', 1);
        req.onupgradeneeded = () => { req.result.createObjectStore('kv'); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  return kvDbPromise;
}
async function kvGet<T>(key: string): Promise<T | undefined> {
  const kv = await kvDb();
  if (!kv) return undefined;
  return new Promise(resolve => {
    try {
      const r = kv.transaction('kv', 'readonly').objectStore('kv').get(key);
      r.onsuccess = () => resolve(r.result as T);
      r.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}
async function kvSet(key: string, value: unknown): Promise<void> {
  const kv = await kvDb();
  if (!kv) return;
  return new Promise(resolve => {
    try {
      const tx = kv.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
}

export async function fetchLogHistory(max = 5000): Promise<TimeLog[]> {
  if (logHistoryCache && logHistoryCache.max >= max && Date.now() - logHistoryCache.at < LOG_HISTORY_TTL_MS) {
    return logHistoryCache.data;
  }
  if (logHistoryPromise) return logHistoryPromise;

  logHistoryPromise = (async () => {
    let data: TimeLog[];
    if (dbInstance) {
      const key = 'logHistory:' + COL.logs;
      const stored = await kvGet<{ v: 1; fullAt: number; data: TimeLog[] }>(key);
      const now = Date.now();
      try {
        if (stored?.v === 1 && stored.data?.length && now - stored.fullAt < LOG_HISTORY_FULL_EVERY_MS) {
          const newest = stored.data.reduce((m, l) => Math.max(m, l.startTime || 0), 0);
          const snap = await getDocs(query(collection(dbInstance, COL.logs), where('startTime', '>=', newest - LOG_HISTORY_OVERLAP_MS), orderBy('startTime', 'desc'), limit(max)));
          const byId = new Map(stored.data.map(l => [l.id, l]));
          snap.docs.forEach((d: any) => { const l = d.data() as TimeLog; byId.set(l.id || d.id, l); });
          data = [...byId.values()].sort((a, b) => (b.startTime || 0) - (a.startTime || 0)).slice(0, max);
          kvSet(key, { v: 1, fullAt: stored.fullAt, data });
        } else {
          const snap = await getDocs(query(collection(dbInstance, COL.logs), orderBy('startTime', 'desc'), limit(max)));
          data = snap.docs.map((d: any) => d.data() as TimeLog);
          kvSet(key, { v: 1, fullAt: now, data });
        }
        firebaseStatus = { connected: true };
      } catch {
        data = stored?.data?.length ? stored.data : readLS<TimeLog[]>(LS.logs, []);
      }
    } else {
      data = readLS<TimeLog[]>(LS.logs, []);
    }
    logHistoryCache = { at: Date.now(), max, data };
    return data;
  })();
  try {
    return await logHistoryPromise;
  } finally {
    logHistoryPromise = null;
  }
}

/** Keep this device's cached history in step with an edit (next) or a delete (null) made here. */
function patchCachedHistory(logId: string, next: TimeLog | null) {
  const apply = (list: TimeLog[]) => (next ? list.map(l => (l.id === logId ? next : l)) : list.filter(l => l.id !== logId));
  if (logHistoryCache) logHistoryCache = { ...logHistoryCache, data: apply(logHistoryCache.data) };
  if (!dbInstance) return;
  const key = 'logHistory:' + COL.logs;
  kvGet<{ v: 1; fullAt: number; data: TimeLog[] }>(key).then(stored => {
    if (stored?.data?.some(l => l.id === logId)) kvSet(key, { ...stored, data: apply(stored.data) });
  });
}

/**
 * Every log this device knows, newest first: the live stream (newest 500)
 * over the cached deep history (fetchLogHistory). For reports, exports and
 * job totals that reach back further than the last couple of months — the
 * live stream alone silently cut them off.
 *
 * Inside the live stream's time window the live list is the truth (so a log
 * deleted there disappears); older logs come from the history.
 */
export function subscribeAllLogs(cb: (logs: TimeLog[]) => void): () => void {
  let live: TimeLog[] | null = null;
  let history: TimeLog[] = [];
  let alive = true;
  const emit = () => {
    if (!alive || live === null) return;
    // Fewer than 500 live logs means the live stream already holds them all.
    const liveOldest = live.length >= 500 ? live.reduce((m, l) => Math.min(m, l.startTime || 0), Infinity) : -Infinity;
    const liveIds = new Set(live.map(l => l.id));
    const older = history.filter(l => (l.startTime || 0) < liveOldest && !liveIds.has(l.id));
    cb([...live, ...older].sort((a, b) => (b.startTime || 0) - (a.startTime || 0)));
  };
  fetchLogHistory().then(h => { history = h; emit(); }).catch(() => {});
  const unsub = subscribeLogs(l => { live = l; emit(); });
  return () => { alive = false; unsub(); };
}

// UPDATED: Now accepts partNumber, customer, and jobIdsDisplay for snapshotting
/** All currently-open (not-yet-stopped) logs for a worker.
 *
 *  Runs on EVERY clock-in. Filtering on endTime server-side matters: a
 *  userId-only query re-reads that worker's entire history (170+ docs for a
 *  long-tenured worker) just to find the zero-or-one session still running.
 *  Two equality clauses are served by merging the automatic single-field
 *  indexes, so no composite index is needed. Falls back progressively to the
 *  old userId-only query, then localStorage, so a missing index or an offline
 *  device can never block a clock-in. */
// ── Shop-floor Wi-Fi: never wait on the server forever ────────────────
// A Firestore write lands in this device's cache at once (every screen here
// sees it immediately), but its promise only settles when the SERVER confirms
// — which never happens while offline. Timer actions used to await that: the
// Start button stayed locked, "Stopping…" spun, and confirmations never came.
const SERVER_WAIT_MS = 4000;
const READ_WAIT_MS = 2500;

/** Wait for the server to confirm a write, up to SERVER_WAIT_MS. 'saved' =
 *  confirmed; 'queued' = kept on this device, synced when the connection is
 *  back. Rejects only when the write fails fast (e.g. permission denied). */
// Writes this device has sent that the server hasn't confirmed yet. The sync
// indicator said "synced" as soon as the settings doc came from the server,
// even with changes still waiting to upload.
let pendingWrites = 0;
const pendingListeners = new Set<() => void>();
function trackPending(p: Promise<unknown>) {
  pendingWrites++;
  if (pendingWrites === 1) pendingListeners.forEach(f => f());
  const done = () => { pendingWrites = Math.max(0, pendingWrites - 1); if (pendingWrites === 0) pendingListeners.forEach(f => f()); };
  p.then(done, done);
}

async function settleWrite(p: Promise<unknown>, ms = SERVER_WAIT_MS): Promise<'saved' | 'queued'> {
  trackPending(p);
  let toldQueued = false;
  p.catch(e => {
    console.warn('[sync] a change saved on this device failed to sync:', e);
    // The caller already told the user "saved on this device"; the server has
    // now refused it and Firestore rolls the change back. Say so (App shows a
    // toast) instead of letting the edit silently disappear.
    if (toldQueued) notifySyncFailed(e);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const r = await Promise.race([
      p.then(() => 'saved' as const),
      new Promise<'queued'>(res => { timer = setTimeout(() => res('queued'), ms); }),
    ]);
    if (r === 'queued') toldQueued = true;
    return r;
  } finally { clearTimeout(timer); }
}

/** Event App listens to: a change queued on this device was refused later. */
export const SYNC_FAILED_EVENT = 'fabtrack:sync-failed';
function notifySyncFailed(e: any) {
  const code = String(e?.code || '');
  const msg = String(e?.message || e || '');
  const reason = /invalid-argument|exceeds the maximum|too large|longer than/i.test(code + ' ' + msg)
    ? 'it was too big to save (a large photo or file)'
    : /not-found|No document/i.test(code + ' ' + msg)
      ? 'the record was deleted on another device'
      : /permission/i.test(code + ' ' + msg)
        ? 'the database refused it'
        : 'the server rejected it';
  try { window.dispatchEvent(new CustomEvent(SYNC_FAILED_EVENT, { detail: { reason } })); } catch { /* no window (tests) */ }
}

/** Firestore rejects a document over 1 MiB — but only on the server, after a
 *  queued write already "saved" on the device, so the change was silently
 *  lost (big delivery photos, PO attachments). Check before writing. */
const DOC_LIMIT_BYTES = 1_030_000;   // Firestore: 1 MiB incl. field names — keep a little room
export class TooBigError extends Error {}
function assertFitsInDoc(data: unknown, what: string) {
  let size = 0;
  try { size = JSON.stringify(data)?.length || 0; } catch { return; }
  if (size > DOC_LIMIT_BYTES) {
    throw new TooBigError(`This ${what} is too big to save (${(size / 1_000_000).toFixed(1)} MB, limit 1 MB) — remove or shrink a photo or file`);
  }
}

/** Size check on what the record will look like after this write: the
 *  stored copy on this device with the given top-level fields applied
 *  (`undefined` = deleted). Checking only the payload missed a small edit
 *  to a record that was already nearly full. */
async function assertMergedFits(ref: any, fields: Record<string, unknown>, what: string) {
  let base: Record<string, unknown> = {};
  try { const snap = await getDocFromCache(ref); if (snap.exists()) base = snap.data() as Record<string, unknown>; } catch { /* not cached */ }
  const merged: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(fields)) { if (v === undefined) delete merged[k]; else merged[k] = v; }
  assertFitsInDoc(merged, what);
}

/**
 * The editor-save rule. Writes the given top-level fields of one record:
 *  • each field given replaces the stored value WHOLE — maps included (a
 *    merge kept a removed vendor's email, an old Bill To phone number);
 *  • a field set to `undefined` is DELETED (a merge kept it: an unlinked
 *    customer PO stayed linked, a reopened rework stayed "resolved");
 *  • fields left out are untouched, so saving only what the user changed
 *    can't undo another device's change.
 * Checks the size first, resolves 'queued' offline, throws on failure.
 */
async function saveFields(colName: string, lsKey: string, rec: { id: string } & Record<string, any>, what: string): Promise<'saved' | 'queued'> {
  if (!rec?.id) throw new Error(`Can't save this ${what}: it has no id`);
  if (dbInstance) {
    const ref = doc(dbInstance, colName, rec.id);
    await assertMergedFits(ref, rec, what);
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) payload[k] = v === undefined ? deleteField() : sanitize(v);
    try {
      const r = await settleWrite(setDoc(ref, payload, { mergeFields: Object.keys(payload) }));
      if (r === 'saved') firebaseStatus = { connected: true };
      return r;
    } catch (e) { throw handleError(e); }
  }
  const list = readLS<any[]>(lsKey, []);
  const idx = list.findIndex(x => x.id === rec.id);
  const merged: any = idx >= 0 ? { ...list[idx] } : {};
  for (const [k, v] of Object.entries(rec)) { if (v === undefined) delete merged[k]; else merged[k] = v; }
  if (idx >= 0) list[idx] = merged; else list.push(merged);
  writeLS(lsKey, list);
  return 'saved';
}

/** Delete one doc — resolves 'queued' offline instead of hanging. */
async function deleteRecord(colName: string, id: string): Promise<'saved' | 'queued'> {
  try {
    const r = await settleWrite(deleteDoc(doc(dbInstance, colName, id)));
    if (r === 'saved') firebaseStatus = { connected: true };
    return r;
  } catch (e) { throw handleError(e); }
}

const SLOW = 'server-slow';
function slowAfter(ms: number, onTimer: (t: ReturnType<typeof setTimeout>) => void): Promise<never> {
  return new Promise((_, rej) => { onTimer(setTimeout(() => rej(new Error(SLOW)), ms)); });
}

/** Read a doc from the server if it answers quickly, else this device's copy. */
async function readDoc(ref: any): Promise<any> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([getDoc(ref), slowAfter(READ_WAIT_MS, t => { timer = t; })]);
  } catch {
    return await getDocFromCache(ref);
  } finally { clearTimeout(timer); }
}

/** Run a query on the server if it answers quickly, else on this device's copy.
 *  Real errors (e.g. a missing index) still throw, as before. */
async function queryDocs(q: any): Promise<any> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([getDocs(q), slowAfter(READ_WAIT_MS, t => { timer = t; })]);
  } catch (e: any) {
    if (e?.message !== SLOW) throw e;
    return await getDocsFromCache(q);
  } finally { clearTimeout(timer); }
}

async function getOpenLogsForUser(userId: string): Promise<TimeLog[]> {
  if (dbInstance) {
    try {
      const q = query(
        collection(dbInstance, COL.logs),
        where('userId', '==', userId),
        where('endTime', '==', null),
      );
      const snap = await queryDocs(q);
      return snap.docs.map((d: any) => d.data() as TimeLog);
    } catch {
      try {
        const q = query(collection(dbInstance, COL.logs), where('userId', '==', userId));
        const snap = await getDocs(q);
        return snap.docs.map((d: any) => d.data() as TimeLog).filter((l: TimeLog) => !l.endTime);
      } catch { return readLS<TimeLog[]>(LS.logs, []).filter((l) => l.userId === userId && !l.endTime); }
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
    jobIdsDisplay?: string,
    partImage?: string
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
  // Snapshot the part photo so a log stays self-identifying even after the job
  // is completed/deleted. Only Storage URLs — never a base64 data: URL (that
  // would re-bloat every log with the image we just moved OUT of job docs).
  if (partImage && !partImage.startsWith('data:')) log.partImage = partImage;

  if (dbInstance) {
    try {
        // Sanitize ensures no undefined values are sent to Firestore.
        // No merge: a fresh clock-in is always a create — merging would let a
        // (now near-impossible) id clash silently fuse two workers' sessions.
        const cleanLog = sanitize(log);
        await settleWrite(setDoc(doc(dbInstance, COL.logs, id), cleanLog));

        // Mark the job in progress — but a job the office put on HOLD stays on
        // hold (a clock-in used to silently take it off hold). Reads the job
        // from this device's copy first: job docs are big (inline photos).
        markJobInProgress(jobId);
        
        firebaseStatus = { connected: true };
        // Server-push admin devices so they get a notification even with browser closed
        notifyAdminsClockEvent('clock-in', id).catch(() => {});
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
  if (idx >= 0 && jobs[idx].status !== 'hold') {
    jobs[idx] = { ...(jobs[idx] as any), status: "in-progress" } as Job;
    writeLS(LS.jobs, jobs);
  }
  return id;
}

function markJobInProgress(jobId: string) {
  if (!dbInstance) return;
  const ref = doc(dbInstance, COL.jobs, jobId);
  getDocFromCache(ref).catch(() => readDoc(ref)).then((snap: any) => {
    const status = snap?.exists?.() ? (snap.data() as Job).status : undefined;
    // Completed too: flipping only the status left a job "completed" (date,
    // snapshot, stage) AND "in progress" at once.
    if (status === 'hold' || status === 'in-progress' || status === 'completed') return;
    return settleWrite(updateDoc(ref, { status: 'in-progress' } as any));
  }).catch(() => { /* the clock-in itself is what matters */ });
}

// finalizeDuration (stop) and timeLogEditPatch (edit) live in
// utils/timeLogEdit.ts — one set of duration rules for both paths.

export async function stopTimeLog(logId: string, sessionQty?: number, notes?: string, forcedEndTime?: number, stopReason?: string) {
  const endTime = forcedEndTime ?? Date.now();

  if (dbInstance) {
      try {
        const ref = doc(dbInstance, COL.logs, logId);
        // Automatic stops (sweep, alarm, auto clock-out) must see the SERVER
        // copy: an offline TV's cached "still running" would otherwise end a
        // log the worker already clocked out of — at a later time (extra pay).
        // Offline → skip; the server cron covers auto clock-out.
        const automatic = /^(sweep:|alarm:|auto:)/.test(stopReason || '');
        let snap: any;
        if (automatic) {
          try { snap = await getDocFromServer(ref); } catch { return; }
        } else {
          snap = await readDoc(ref);
        }
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

        await settleWrite(updateDoc(ref, sanitize(updates)));
        updateUserProgress(existing.userId, existing.jobId, existing.operation, durationSeconds).catch(() => {});
        firebaseStatus = { connected: true };
        // Server-push admin devices on clock-out — but ONLY for real worker
        // clock-outs. Routine system stops (auto clock-out, 14h sweep, lunch
        // alarm, admin force-stop, job-switch) must NOT buzz the admin's phone.
        const routine = /^(sweep:|alarm:|admin:|auto:)/.test(updates.stopReason || '');
        if (!routine) {
          notifyAdminsClockEvent('clock-out', logId).catch(() => {});
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

/**
 * Save an edited log (or write a new one, e.g. a rate sample). Only the
 * fields that actually changed are written, so:
 *   • clearing End Time really puts the timer back on the clock (a merge used
 *     to drop the cleared value and keep the old one);
 *   • the editor's stale copy can't undo a pause/resume the worker made while
 *     the editor was open;
 *   • durations always follow the times and pauses (utils/timeLogEdit).
 */
/**
 * Save an edited log. Pass `opts.original` — the copy the editor opened
 * with — and only the fields the user changed are written (see
 * timeLogEditPatch); without it, every field that differs from the server is.
 */
export async function updateTimeLog(log: TimeLog, opts: { original?: Partial<TimeLog> } = {}): Promise<'saved' | 'queued' | void> {
  const now = Date.now();
  if (dbInstance) {
      try {
        const ref = doc(dbInstance, COL.logs, log.id);
        const snap = await readDoc(ref);
        if (!snap.exists()) {
          const result = await settleWrite(setDoc(ref, sanitize(newTimeLogRecord(log, now))));
          firebaseStatus = { connected: true };
          return result;
        }
        const cur = snap.data() as TimeLog;
        const { set, clear } = timeLogEditPatch(cur, log, now, opts.original);
        const payload: Record<string, unknown> = sanitize(set);
        for (const k of clear) payload[k] = deleteField();
        const result = await settleWrite(updateDoc(ref, payload as any));
        const merged: any = { ...cur, ...set };
        for (const k of clear) delete merged[k];
        patchCachedHistory(log.id, merged);
        firebaseStatus = { connected: true };
        return result;
      } catch (e) {
        throw handleError(e);
      }
  }

  const logs = readLS<TimeLog[]>(LS.logs, []);
  const idx = logs.findIndex(l => l.id === log.id);
  if (idx < 0) {
    logs.push(newTimeLogRecord(log, now));
  } else {
    const { set, clear } = timeLogEditPatch(logs[idx], log, now, opts.original);
    const merged: any = { ...logs[idx], ...set };
    for (const k of clear) delete merged[k];
    logs[idx] = merged;
  }
  writeLS(LS.logs, logs);
}

export async function deleteTimeLog(logId: string): Promise<'saved' | 'queued'> {
  if (dbInstance) {
      try {
        const r = await settleWrite(deleteDoc(doc(dbInstance, COL.logs, logId)));
        patchCachedHistory(logId, null);
        if (r === 'saved') firebaseStatus = { connected: true };
        return r;
      } catch (e) {
        throw handleError(e);
      }
  }
  const logs = readLS<TimeLog[]>(LS.logs, []).filter(l => l.id !== logId);
  writeLS(LS.logs, logs);
  return 'saved';
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
        cb(readLS<User[]>(LS.users, []));
      }
    );
  }
  return localSubscribe(() => readLS<User[]>(LS.users, []), cb);
}

/**
 * Save a team member. `clear` lists fields emptied in the editor (e.g. an
 * hourly rate removed) — a merge save skips undefined, so they're deleted
 * explicitly. Resolves 'queued' when offline (it syncs later) instead of
 * hanging the dialog.
 */
export async function saveUser(user: User, opts: { clear?: string[] } = {}): Promise<'saved' | 'queued' | void> {
  const clear = (opts.clear || []).filter(f => (user as any)[f] === undefined);
  if (dbInstance) {
      try {
        const payload: Record<string, unknown> = sanitize(user);
        for (const f of clear) payload[f] = deleteField();
        const result = await settleWrite(setDoc(doc(dbInstance, COL.users, user.id), payload, { merge: true }));
        firebaseStatus = { connected: true };
        return result;
      } catch (e) {
        throw handleError(e);
      }
  }
  const users = readLS<User[]>(LS.users, []);
  const idx = users.findIndex((u) => u.id === user.id);
  if (idx >= 0) {
    const merged: any = { ...users[idx], ...sanitize(user) };
    for (const f of clear) delete merged[f];
    users[idx] = merged;
  } else users.push(user);
  writeLS(LS.users, users);
}

// NOTE: Deleting a user INTENTIONALLY does not cascade to their TimeLogs.
// Logs are payroll/job-costing history and must survive user deletion; each
// TimeLog snapshots `userName` at creation, so historical entries remain
// readable in reports even after the user document is gone.
export async function deleteUser(id: string) {
  if (dbInstance) {
      try {
        await settleWrite(deleteDoc(doc(dbInstance, COL.users, id)));
        firebaseStatus = { connected: true };
      } catch (e) {
        throw handleError(e);
      }
      return;
  }
  const users = readLS<User[]>(LS.users, []).filter((u) => u.id !== id);
  writeLS(LS.users, users);
}

/**
 * Re-check a saved session against the SERVER copy of the account (never the
 * offline cache — a stale cache could wrongly log out a just-added worker).
 * 'gone' = deleted or deactivated; 'unknown' = server unreachable (keep the
 * session, don't punish a Wi-Fi blip).
 */
export async function verifySessionUser(id: string): Promise<{ status: 'ok'; user: User } | { status: 'gone' } | { status: 'unknown' }> {
  if (!dbInstance || !id) return { status: 'unknown' };
  try {
    const snap: any = await Promise.race([
      getDocFromServer(doc(dbInstance, COL.users, id)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ]);
    if (!snap.exists()) return { status: 'gone' };
    const u = snap.data() as User;
    return u.isActive === false ? { status: 'gone' } : { status: 'ok', user: u };
  } catch {
    return { status: 'unknown' };
  }
}

export async function loginUser(username: string, pin: string): Promise<User | null> {
  // Trim both inputs — mobile keyboards commonly append a trailing space,
  // which would otherwise fail an exact match. PINs stay case-sensitive (digits).
  const normalizedUser = username.trim().toLowerCase();
  const normalizedPin = pin.trim();

  const matches = (u: User) =>
    (u.username || '').trim().toLowerCase() === normalizedUser && (u.pin || '').trim() === normalizedPin && u.isActive !== false;

  if (dbInstance) {
    // The shop's real user list is the ONLY place a login can match. No local
    // fallback: "no match" means wrong credentials, and an unreachable
    // database is an error to show — not a reason to check some other list.
    let users: User[];
    try {
      const snap: any = await Promise.race([
        getDocs(query(collection(dbInstance, COL.users))),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
      ]);
      firebaseStatus = { connected: true };
      users = snap.docs.map((d: any) => d.data() as User);
    } catch (e) {
      console.warn('[FabTrack] Login lookup failed:', e);
      throw new Error("Can't reach the server — check the Wi-Fi and try again.");
    }
    return users.find(matches) || null;
  }

  // Local-only mode (no database configured): real local accounts only.
  return readLS<User[]>(LS.users, []).find(matches) || null;
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

// True once a live settings listener has delivered the server's copy. From
// then on the local copy stays current, so the once-a-minute sweep no longer
// downloads the whole settings document — ≈376 KB with the logo inside it,
// every minute, on every open screen (wall TVs included).
let settingsLive = false;

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
    setShopStages(s.jobStages);   // due-date rules learn which stages mean "shipped"
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
          if (!snap.metadata?.fromCache) settingsLive = true;
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

/**
 * Save only the settings fields that changed. `undefined` really deletes the
 * field. (A whole-document merge write can't delete — sanitize() drops
 * undefined and merge keeps the old value — so "clear the revenue goal",
 * "remove this slug", "reset this pipeline" all came back after a reload.)
 * Writing only changed fields also stops this device from overwriting
 * settings another device changed in the meantime. Each changed top-level
 * field is replaced whole (nested maps included), so removed map keys stick.
 */
export async function saveSettingsChanges(
  changes: Partial<Record<keyof SystemSettings, unknown>>,
  // The settings the editor started from. Keyed maps are diffed against it
  // entry by entry, so an entry another device added meanwhile (absent from
  // both) is left alone instead of deleted.
  opts: { base?: Partial<SystemSettings> } = {},
): Promise<'saved' | 'queued'> {
  const keys = Object.keys(changes);
  if (keys.length === 0) return 'saved';
  const cached = readLS<any>(LS.settings, {});
  // The settings as this device last knew them — keyed maps are diffed
  // against this, entry by entry (below).
  const before: any = opts.base ? { ...opts.base } : { ...cached };
  for (const k of keys) {
    const v = (changes as any)[k];
    if (v === undefined) delete cached[k]; else cached[k] = v;
  }
  let result: 'saved' | 'queued' = 'saved';
  if (dbInstance) {
    const ref = doc(dbInstance, COL.settings, 'system');
    // Keyed maps (customer contacts, portal slugs, per-customer routes…) are
    // written ENTRY by entry: replacing the whole map from this device's copy
    // erased entries another device added meanwhile (e.g. a contact saved
    // from Deliveries while Settings was open, or edited offline).
    const isMap = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
    const pairs: unknown[] = [];
    for (const k of keys) {
      const v = (changes as any)[k];
      const was = before[k];
      if (isMap(v) && isMap(was)) {
        for (const sub of new Set([...Object.keys(was), ...Object.keys(v)])) {
          const nv = v[sub], ov = was[sub];
          if (JSON.stringify(nv) === JSON.stringify(ov)) continue;
          pairs.push(new FieldPath(k, sub), nv === undefined ? deleteField() : sanitize(nv));
        }
      } else {
        pairs.push(new FieldPath(k), v === undefined ? deleteField() : sanitize(v));
      }
    }
    if (pairs.length === 0) { writeLS(LS.settings, cached); return 'saved'; }
    await assertMergedFits(ref, changes as Record<string, unknown>, 'settings change');
    const write = (updateDoc as any)(ref, ...pairs).catch(async (e: any) => {
      if (!/not-found|No document/i.test(String(e?.code || '') + String(e?.message || ''))) throw e;
      // First save for a brand-new shop — create the doc (deletes are moot).
      const created: Record<string, unknown> = {};
      for (const k of keys) { const v = (changes as any)[k]; if (v !== undefined) created[k] = sanitize(v); }
      await setDoc(ref, created, { merge: true });
    });
    try {
      // Offline the write only resolves when the server acks — Settings sat on
      // "Saving…" forever. It's kept on this device and syncs by itself.
      result = await settleWrite(write);
    } catch (e: any) {
      writeLS(LS.settings, cached);   // keep the edit on this device
      throw handleError(e);
    }
    if (result === 'saved') firebaseStatus = { connected: true };
  }
  writeLS(LS.settings, cached);
  return result;
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
/** `opts.system`: a shared screen pausing everyone's timers (lunch) — reads
 *  the server copy and skips offline, since a stale cache could mark a log
 *  already stopped elsewhere as paused. A worker's own device uses its copy. */
export async function pauseTimeLog(logId: string, reason?: string, opts: { system?: boolean } = {}): Promise<void> {
  const now = Date.now();
  if (dbInstance) {
    try {
      const ref = doc(dbInstance, COL.logs, logId);
      let snap: any;
      if (opts.system) {
        try { snap = await getDocFromServer(ref); } catch { return; }
      } else {
        snap = await readDoc(ref);
      }
      if (!snap.exists()) throw new Error("Log not found.");
      const existing = snap.data() as TimeLog;
      if (existing.pausedAt || existing.endTime) return; // already paused or stopped
      await settleWrite(updateDoc(ref, sanitize({
        pausedAt: now,
        pauseReason: reason || 'manual',
        status: 'paused',
        updatedAt: now,
      })));
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

/**
 * Resume a paused log. `opts.at` ends the pause at that moment instead of
 * now (the lunch auto-resume passes lunch end: a screen first opened at 1:15
 * used to count a 12:30 lunch end as 45 more unpaid minutes). `opts.system`
 * makes it read the server copy and skip offline.
 */
export async function resumeTimeLog(logId: string, opts: { at?: number; system?: boolean } = {}): Promise<boolean> {
  const now = Date.now();
  const endPause = (pausedAt: number) => Math.min(now, Math.max(pausedAt, opts.at ?? now));
  if (dbInstance) {
    try {
      const ref = doc(dbInstance, COL.logs, logId);
      let snap: any;
      if (opts.system) {
        try { snap = await getDocFromServer(ref); } catch { return false; }
      } else {
        snap = await readDoc(ref);
      }
      if (!snap.exists()) throw new Error("Log not found.");
      const existing = snap.data() as TimeLog;
      // Not paused, or already stopped (a stale copy must not revive it).
      if (!existing.pausedAt || existing.endTime) return false;
      // Clamp ≥ 0 — clock skew (now < pausedAt) must not write a negative
      // pause total to Firestore (finalizeDuration guards reads, not writes).
      const pausedDuration = Math.max(0, endPause(existing.pausedAt) - existing.pausedAt);
      const totalPausedMs = (existing.totalPausedMs || 0) + pausedDuration;
      await settleWrite(updateDoc(ref, sanitize({
        pausedAt: null,
        pauseReason: null,
        totalPausedMs,
        status: 'in_progress',
        updatedAt: now,
      })));
      firebaseStatus = { connected: true };
    } catch (e) {
      throw handleError(e);
    }
    return true;
  }
  const logs = readLS<TimeLog[]>(LS.logs, []);
  const idx = logs.findIndex(l => l.id === logId);
  if (idx >= 0) {
    const l = logs[idx];
    if (!l.pausedAt || l.endTime) return false;
    const pausedDuration = Math.max(0, endPause(l.pausedAt) - l.pausedAt); // clamp — see Firestore branch
    const totalPausedMs = (l.totalPausedMs || 0) + pausedDuration;
    logs[idx] = { ...l, pausedAt: null, pauseReason: null, totalPausedMs, status: 'in_progress', updatedAt: now };
    writeLS(LS.logs, logs);
    return true;
  }
  return false;
}

export async function pauseAllActive(reason: string): Promise<number> {
  return new Promise((resolve) => {
    // The local store calls back synchronously — before `unsub` exists.
    let done = false;
    let unsub: (() => void) | null = null;
    unsub = subscribeLogs(async (all) => {
      if (done) return;
      done = true;
      queueMicrotask(() => unsub?.());
      const active = all.filter(l => !l.endTime && !l.pausedAt);
      for (const l of active) {
        try { await pauseTimeLog(l.id, reason, { system: true }); } catch {}
      }
      resolve(active.length);
    });
    if (done) unsub();
  });
}

/** Resume paused timers. When `reason` is given, ONLY resume logs paused with
 *  that exact pauseReason — so the lunch-end auto-resume never force-resumes a
 *  worker's own manual pause (machine down, personal break). */
/** Resume timers paused for `reason`. `pauseMs` (the lunch length) caps
 *  each pause at that long, so a late resume doesn't add unpaid time. */
export async function resumeAllPaused(reason?: string, pauseMs?: number): Promise<number> {
  return new Promise((resolve) => {
    let done = false;
    let unsub: (() => void) | null = null;
    unsub = subscribeLogs(async (all) => {
      if (done) return;
      done = true;
      queueMicrotask(() => unsub?.());
      const paused = all.filter(l => !l.endTime && l.pausedAt && (!reason || l.pauseReason === reason));
      let resumed = 0;   // the real number — "Auto-resumed 5" used to show even when none went through
      for (const l of paused) {
        const at = pauseMs && pauseMs > 0 ? (l.pausedAt as number) + pauseMs : undefined;
        try { if (await resumeTimeLog(l.id, { at, system: !!reason })) resumed++; } catch {}
      }
      resolve(resumed);
    });
    if (done) unsub();
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
  jobIdsDisplay?: string,
  // Pass the same id on a retry (the form makes it once) — a second tap used
  // to create a second entry and double the hours.
  fixedId?: string,
): Promise<'saved' | 'queued'> {
  const id = fixedId || 'bf_' + Date.now().toString();
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
      return await settleWrite(setDoc(doc(dbInstance, COL.logs, id), sanitize(log), { merge: true }));
    } catch (e) { throw handleError(e); }
  }
  const logs = readLS<TimeLog[]>(LS.logs, []);
  if (!logs.some(l => l.id === id)) logs.push(log);
  writeLS(LS.logs, logs);
  return 'saved';
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
    if (dbInstance && !settingsLive) {
      try {
        const sSnap = await getDoc(doc(dbInstance, COL.settings, 'system'));
        if (sSnap.exists()) settings = { ...settings, ...(sSnap.data() as any) };
      } catch { /* use cached settings */ }
    }
    const tz = (settings as any).recapTimezone || 'America/Los_Angeles';
    const nowMs = Date.now();

    // ── Always gather active logs — needed for both sweeps below ──────
    //
    // QUOTA-CRITICAL: this runs every 60s on EVERY open device (App.tsx and
    // LiveFloorMonitor each schedule it). A full-collection getDocs here read
    // all ~1,600 log docs per sweep = ~98,000 reads/hour/device, which drained
    // the entire 50k/day free quota in ~31 minutes and made the app unusable
    // by mid-morning. startTimeLog always writes `endTime: null` (sanitize()
    // preserves null, only stripping undefined), so an equality filter finds
    // exactly the open sessions and costs one read per OPEN log — typically
    // a handful, and zero when the floor is quiet.
    let activeLogs: TimeLog[] = [];
    if (dbInstance) {
      try {
        const snap = await getDocs(query(collection(dbInstance, COL.logs), where('endTime', '==', null)));
        activeLogs = snap.docs.map((d: any) => d.data() as TimeLog);
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

    // Pick up any alarm flagged as a clock-out alarm (e.g. "Shift Ends") —
    // unless the alarms are switched off (overtime days): the server cron and
    // the in-app watcher already honored that switch, this sweep didn't.
    for (const alarm of (settings.shiftAlarmsEnabled === false ? [] : settings.shiftAlarms || []) as any[]) {
      if (!alarm.clockOut || alarm.enabled === false) continue;
      const mm = (alarm.time || '').match(/^(\d{1,2}):(\d{2})$/);
      if (mm) cutoffs.push({ h: +mm[1], m: +mm[2], days: alarm.days });
    }

    const SAFETY_MS = 14 * 3600000;

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
        let cutoffMs = shopLocalTimeMs(log.startTime, tz, c.h, c.m);
        // Overnight shift: an early-morning (AM) cutoff for an evening clock-in
        // lands before the clock-in → roll to the next morning. Only roll for
        // genuine AM cutoffs; a PM cutoff already passed (e.g. clock back in at
        // 6pm after a 5:30pm cutoff) must NOT roll a full day — let the safety
        // net / next cutoff handle it instead of running ~14h.
        if (cutoffMs <= log.startTime && c.h < 12) cutoffMs = shopLocalTimeMs(log.startTime + 86400000, tz, c.h, c.m);
        // Day gate — on the day of that cutoff, not today: a Friday shift
        // still open on Saturday skipped its Mon–Fri cut-off and ran to 14 h.
        if (c.days && c.days.length > 0 && !c.days.includes(shopDayOfWeek(tz, cutoffMs))) continue;
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
// One doc per DEVICE (keyed by its push endpoint), belonging to whoever
// signed in on it last, and removed when they sign out. It used to be one
// doc per user + device, so a shared shop tablet collected a doc for every
// person who ever signed in on it and kept receiving their pushes (an
// admin's clock-in alerts, someone's "still clocked in?") after they left.
// role + name are stored so the server can filter admin devices without
// joining the users collection.
const pushDeviceKey = (endpoint: string) => 'dev_' + btoa(endpoint).slice(-40).replace(/[^a-zA-Z0-9]/g, '');

export async function savePushSubscription(
  userId: string,
  subscription: any,
  role?: string,
  name?: string,
): Promise<void> {
  const db = dbInstance;
  if (!db) return;
  const endpoint: string = subscription?.endpoint || '';
  if (!endpoint) return;
  // Callers without the user's role (Settings' "register this device") must
  // not leave the previous owner's role on the device.
  if (role === undefined || name === undefined) {
    const u = readLS<User[]>(LS.users, []).find(x => x.id === userId);
    role = role ?? u?.role; name = name ?? u?.name;
  }
  const key = pushDeviceKey(endpoint);
  await settleWrite(setDoc(doc(db, COL.pushSubscriptions, key), {
    userId,
    subscription,
    role:      role || '',
    name:      name || '',
    updatedAt: Date.now(),
  }, { merge: true }));
  // Copies of this device under the old per-user keys.
  try {
    const same = await getDocs(query(collection(db, COL.pushSubscriptions), where('subscription.endpoint', '==', endpoint)));
    await Promise.all(same.docs.filter((d: any) => d.id !== key).map((d: any) => deleteDoc(d.ref)));
  } catch { /* best effort */ }
}

/** Sign-out: this device stops receiving the signed-out person's pushes. */
export async function removeThisDevicePush(): Promise<void> {
  const db = dbInstance;
  if (!db || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (!sub?.endpoint) return;
    await settleWrite(deleteDoc(doc(db, COL.pushSubscriptions, pushDeviceKey(sub.endpoint))));
    const same = await getDocs(query(collection(db, COL.pushSubscriptions), where('subscription.endpoint', '==', sub.endpoint)));
    await Promise.all(same.docs.map((d: any) => deleteDoc(d.ref)));
  } catch { /* best effort — never block sign-out */ }
}

// ── Server-push helper — clock-in / clock-out admin alerts ───────────
// Calls /.netlify/functions/notify-clockin which delivers a Web Push to
// every admin device via VAPID, even when their browser is fully closed.
// Only the event type and the log's id go up: the function reads that log
// itself and writes the notification text from it.
// Fire-and-forget: never throws — a failed push must not break a clock-in.
async function postAdminNotify(
  eventType: 'clock-in' | 'clock-out' | 'over-estimate',
  logId: string,
): Promise<void> {
  if (!logId) return;
  // 409 = the server can't see the log in that state yet (on a slow connection
  // the clock-in/out write can still be in flight) — ask again a bit later.
  for (const waitMs of [0, 4_000, 12_000]) {
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    try {
      const res = await fetch('/.netlify/functions/notify-clockin', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ eventType, logId }),
      });
      if (res.status !== 409) return;
    } catch { return; /* silent — notification is best-effort */ }
  }
}

async function notifyAdminsClockEvent(
  eventType: 'clock-in' | 'clock-out',
  logId: string,
): Promise<void> {
  await postAdminNotify(eventType, logId);
}

// ── Server-push helper — over-estimate alert ─────────────────────────
// Fires when a running timer passes its job's expected-hours budget so the
// owner can step in. Reuses the notify-clockin function (admin fan-out) with
// the 'over-estimate' event type; the server checks the budget itself.
// Fire-and-forget — never throws.
export async function notifyAdminsOverEstimate(logId: string): Promise<void> {
  await postAdminNotify('over-estimate', logId);
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

/** One quote, live — the customer portal's quote link. Listening to every
 *  quote for that read one document per quote on every visit. */
export function subscribeQuote(id: string, cb: (quote: Quote | null) => void) {
  if (dbInstance) {
    return onSnapshot(doc(dbInstance, COL.quotes, id), (snap: any) => {
      firebaseStatus = { connected: true };
      cb(snap.exists() ? (snap.data() as Quote) : null);
    }, () => cb(readLS<Quote[]>(LS.quotes, []).find(q => q.id === id) || null));
  }
  return localSubscribe(() => readLS<Quote[]>(LS.quotes, []).find(q => q.id === id) || null, cb);
}

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

/**
 * Save a quote from the office editor. `clear` lists fields emptied in the
 * editor (a removed discount, tax, valid-until date, notes…) — a merge save
 * skips undefined, so they used to stay, and the customer saw a discount line
 * the total didn't include. Resolves 'queued' offline instead of hanging.
 */
export async function saveQuote(quote: Quote, opts: { clear?: string[] } = {}): Promise<'saved' | 'queued' | void> {
  const clear = (opts.clear || []).filter(f => (quote as any)[f] === undefined);
  if (dbInstance) {
    try {
      const payload: Record<string, unknown> = sanitize(quote);
      for (const f of clear) payload[f] = deleteField();
      const ref = doc(dbInstance, COL.quotes, quote.id);
      await assertMergedFits(ref, { ...quote, ...Object.fromEntries(clear.map(f => [f, undefined])) }, 'quote');
      // mergeFields: each field written replaces the stored value whole — a
      // plain merge deep-merged Bill To / Ship To and kept the previous
      // customer's phone or email when the new contact had none.
      const result = await settleWrite(setDoc(ref, payload, { mergeFields: Object.keys(payload) }));
      firebaseStatus = { connected: true };
      return result;
    }
    catch (e) { throw handleError(e); }
  }
  const quotes = readLS<Quote[]>(LS.quotes, []);
  const idx = quotes.findIndex(q => q.id === quote.id);
  if (idx >= 0) {
    const merged: any = { ...quotes[idx], ...sanitize(quote) };
    for (const f of clear) delete merged[f];
    quotes[idx] = merged;
  } else quotes.push(quote);
  writeLS(LS.quotes, quotes);
}

/** Write just these fields of a quote (status changes, the linked job). */
export async function updateQuoteFields(quoteId: string, patch: Partial<Quote>): Promise<'saved' | 'queued' | void> {
  if (dbInstance) {
    try {
      const result = await settleWrite(updateDoc(doc(dbInstance, COL.quotes, quoteId), sanitize(patch) as any));
      firebaseStatus = { connected: true };
      return result;
    } catch (e) { throw handleError(e); }
  }
  patchQuoteLS(quoteId, () => patch);
}

// ── Quote writes from the customer portal and auto-expiry ────────────
// Each changes only its own fields, read and written in one transaction
// against the server copy. The portal used to save its whole first-loaded
// copy of the quote — on open and again on tab close — which could undo a
// revised price, or the customer's own approval.
function patchQuoteLS(quoteId: string, fn: (q: Quote) => Partial<Quote> | null) {
  const quotes = readLS<Quote[]>(LS.quotes, []);
  const idx = quotes.findIndex(q => q.id === quoteId);
  if (idx < 0) return;
  const patch = fn(quotes[idx]);
  if (patch) { quotes[idx] = { ...quotes[idx], ...patch }; writeLS(LS.quotes, quotes); }
}
async function patchQuote(quoteId: string, fn: (q: Quote) => Partial<Quote> | null): Promise<void> {
  if (!dbInstance) { patchQuoteLS(quoteId, fn); return; }
  const ref = doc(dbInstance, COL.quotes, quoteId);
  await runTransaction(dbInstance, async (tx: any) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const patch = fn(snap.data() as Quote);
    if (patch) tx.update(ref, sanitize(patch));
  });
}

/** A customer opened a quote link: counters + one history entry (once per browser tab session). */
export async function recordQuoteView(quoteId: string, event: QuoteViewEvent): Promise<void> {
  await patchQuote(quoteId, q => {
    const history = q.viewHistory || [];
    if (history.some(h => h.sessionId === event.sessionId)) return null;
    return {
      viewedAt: q.viewedAt || event.at,
      lastViewedAt: event.at,
      viewCount: (q.viewCount || 0) + 1,
      viewHistory: [...history, event].slice(-50),
    };
  });
}

/** How long a portal visit lasted (sent as the tab closes) — only that visit's entry changes. */
export async function recordQuoteViewDuration(quoteId: string, sessionId: string, durationMs: number): Promise<void> {
  await patchQuote(quoteId, q => {
    const history = q.viewHistory || [];
    if (!history.some(h => h.sessionId === sessionId)) return null;
    return { viewHistory: history.map(h => (h.sessionId === sessionId ? { ...h, durationMs } : h)) };
  });
}

/**
 * The customer's answer from the portal. Only while the quote is still open
 * on the server: one already answered or expired can't be flipped. Throws
 * 'quote-closed' otherwise.
 */
export async function answerQuote(quoteId: string, answer: 'accepted' | 'declined'): Promise<void> {
  let closed = false;
  await patchQuote(quoteId, q => {
    if (q.status !== 'sent' && q.status !== 'draft') { closed = true; return null; }
    return answer === 'accepted' ? { status: 'accepted', acceptedAt: Date.now() } : { status: 'declined', declinedAt: Date.now() };
  });
  if (closed) throw new Error('quote-closed');
}

/**
 * Mark a quote expired — status only, and only if, on the server, it's still
 * open with the same valid-until date this device saw (so a date extended or
 * an approval made elsewhere is never undone by a device with an old copy).
 */
export async function expireQuote(quoteId: string, validUntilSeen: string | undefined): Promise<void> {
  await patchQuote(quoteId, q => {
    if (q.status !== 'sent' && q.status !== 'draft') return null;
    if ((q.validUntil || '') !== (validUntilSeen || '')) return null;
    return { status: 'expired' };
  });
}

export async function deleteQuote(id: string): Promise<'saved' | 'queued'> {
  if (dbInstance) return deleteRecord(COL.quotes, id);
  writeLS(LS.quotes, readLS<Quote[]>(LS.quotes, []).filter(x => x.id !== id));
  return 'saved';
}

/** Next quote number: one past the highest so far, but never below `startAt`
 *  (Settings → Documents → "Start numbering at", e.g. to carry on from the
 *  numbers in an old system). */
export function getNextQuoteNumber(quotes: Quote[], prefix?: string, startAt?: number): string {
  const pfx = prefix || 'Q-';
  const nums = quotes.map(q => parseInt(q.quoteNumber?.replace(/\D/g, '') || '0', 10)).filter(n => !isNaN(n));
  const next = Math.max(nums.length > 0 ? Math.max(...nums) + 1 : 1, Math.floor(Number(startAt)) || 1);
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

/** Saves the given fields of a sample (see saveFields: undefined deletes,
 *  left-out fields — e.g. the live timer data — stay as they are). */
export async function saveSample(sample: Partial<Sample> & { id: string }): Promise<'saved' | 'queued'> {
  return saveFields(COL.samples, LS_SAMPLES, sample, 'sample');
}

export async function deleteSample(id: string): Promise<'saved' | 'queued'> {
  if (dbInstance) {
    try {
      // Remove the bridged rate-learning logs for every work entry first,
      // so a deleted sample's timing stops feeding estimates.
      try {
        const snap = await readDoc(doc(dbInstance, COL.samples, id));
        if (snap.exists()) {
          const s = snap.data() as Sample;
          await Promise.all((s.workEntries || []).map(e => deleteTimeLog(`sample-tl-${e.id}`).catch(() => {})));
        }
      } catch {}
      const r = await settleWrite(deleteDoc(doc(dbInstance, COL.samples, id)));
      if (r === 'saved') firebaseStatus = { connected: true };
      return r;
    } catch (e) {
      throw handleError(e);
    }
  }
  const all = readLS<Sample[]>(LS_SAMPLES, []);
  const gone = all.find(s => s.id === id);
  if (gone) (gone.workEntries || []).forEach(e => { deleteTimeLog(`sample-tl-${e.id}`).catch(() => {}); });
  writeLS(LS_SAMPLES, all.filter(s => s.id !== id));
  return 'saved';
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

/** Saves the given fields of a customer PO (see saveFields — e.g.
 *  `linkedJobId: undefined` really unlinks it). */
export async function saveCustomerPo(po: Partial<CustomerPoFile> & { id: string }): Promise<'saved' | 'queued'> {
  return saveFields(COL.customerPos, LS_CUSTOMER_POS, po, 'customer PO');
}

export async function deleteCustomerPo(id: string): Promise<'saved' | 'queued'> {
  if (dbInstance) return deleteRecord(COL.customerPos, id);
  writeLS(LS_CUSTOMER_POS, readLS<CustomerPoFile[]>(LS_CUSTOMER_POS, []).filter(x => x.id !== id));
  return 'saved';
}

// ── SHOP ACTIONS ─────────────────────────────────────────────────────
// Owner to-dos: manual or promoted from a Shop Brain insight. Same
// Firestore + localStorage-fallback pattern as customer POs.
const LS_SHOP_ACTIONS = "nexus_shop_actions";

export function subscribeShopActions(cb: (actions: ShopAction[]) => void): () => void {
  if (dbInstance) {
    const key = 'shopActions:' + COL.shopActions;
    return multicast<ShopAction[]>(key, notify => {
      return retryingSnapshot(
        () => collection(dbInstance!, COL.shopActions),
        (snap: any) => { firebaseStatus = { connected: true }; notify(snap.docs.map((d: any) => d.data() as ShopAction)); },
        () => notify(readLS<ShopAction[]>(LS_SHOP_ACTIONS, [])),
      );
    }, cb);
  }
  return localSubscribe(() => readLS<ShopAction[]>(LS_SHOP_ACTIONS, []), cb);
}

/** Saves the given fields of a shop action (see saveFields). */
export async function saveShopAction(action: Partial<ShopAction> & { id: string }): Promise<'saved' | 'queued'> {
  return saveFields(COL.shopActions, LS_SHOP_ACTIONS, action, 'action');
}

export async function deleteShopAction(id: string): Promise<'saved' | 'queued'> {
  if (dbInstance) return deleteRecord(COL.shopActions, id);
  writeLS(LS_SHOP_ACTIONS, readLS<ShopAction[]>(LS_SHOP_ACTIONS, []).filter(x => x.id !== id));
  return 'saved';
}

// ── TV DISPLAYS ───────────────────────────────────────────────────────
// Wall TVs aren't signed in, so these are how the office can see them and
// reach them: a live "am I getting server data?" signal, a check-in every few
// minutes, a few remote commands, and a 6-digit pairing code so nobody has to
// type a long link on a TV remote.

/**
 * Is this device getting live server data, or showing its cached copy?
 * A metadata-only listener on the small settings doc; Firestore shares the
 * watch target with subscribeSettings, so this adds no reads.
 */
export function subscribeSyncStatus(cb: (s: { online: boolean; synced: boolean }) => void): () => void {
  let synced = !dbInstance;   // local-only mode has nothing to sync
  // Synced = live server data AND nothing of ours still waiting to upload.
  const emit = () => cb({ online: typeof navigator === 'undefined' || navigator.onLine !== false, synced: synced && pendingWrites === 0 });
  window.addEventListener('online', emit);
  window.addEventListener('offline', emit);
  pendingListeners.add(emit);
  let unsub = () => {};
  if (dbInstance) {
    try {
      unsub = onSnapshot(doc(dbInstance, COL.settings, 'system'), { includeMetadataChanges: true },
        (snap: any) => { synced = !snap.metadata.fromCache; emit(); },
        () => { synced = false; emit(); });
    } catch { synced = false; }
  }
  emit();
  return () => { unsub(); pendingListeners.delete(emit); window.removeEventListener('online', emit); window.removeEventListener('offline', emit); };
}

// Times written for TVs come from the SERVER clock (serverTimestamp). TV
// clocks drift: a TV a few minutes slow looked "Not responding" between
// check-ins, one 15+ minutes off could never be paired, and a Refresh sent
// from a phone with a fast clock made later ones look old and get ignored.
const tsMs = (v: any): number =>
  v && typeof v.toMillis === 'function' ? v.toMillis() : typeof v === 'number' ? v : 0;

function readTvDevice(snap: any): TvDevice {
  const raw = snap.data({ serverTimestamps: 'estimate' }) || {};
  return {
    ...raw,
    id: snap.id,
    lastSeen: tsMs(raw.lastSeen),
    ...(raw.reloadAt != null ? { reloadAt: tsMs(raw.reloadAt) } : {}),
    ...(raw.identifyAt != null ? { identifyAt: tsMs(raw.identifyAt) } : {}),
  } as TvDevice;
}

/** TV check-in (merge) — creates the device row on first call. */
export async function tvCheckIn(device: Partial<TvDevice> & { id: string }): Promise<void> {
  if (!dbInstance) return;
  try {
    await settleWrite(setDoc(doc(dbInstance, COL.tvDevices, device.id), { ...sanitize(device), lastSeen: serverTimestamp() }, { merge: true }));
  } catch { /* a missed check-in only makes the office view stale */ }
}

/** The TV listens to its own row for office commands. */
export function subscribeTvDevice(id: string, cb: (d: TvDevice | null) => void): () => void {
  if (!dbInstance) return () => {};
  return retryingSnapshot(
    () => doc(dbInstance!, COL.tvDevices, id),
    (snap: any) => cb(snap.exists() ? readTvDevice(snap) : null),
    () => {},
  );
}

/** Settings: every TV that has checked in, most recently seen first. Removed
 *  TVs stay in the collection as hidden, disconnected rows (see removeTvDevice). */
export function subscribeTvDevices(cb: (list: TvDevice[]) => void): () => void {
  if (!dbInstance) { cb([]); return () => {}; }
  return retryingSnapshot(
    () => collection(dbInstance!, COL.tvDevices),
    (snap: any) => cb(snap.docs.map(readTvDevice).filter((d: TvDevice) => !d.hidden).sort((a: TvDevice, b: TvDevice) => (b.lastSeen || 0) - (a.lastSeen || 0))),
    () => {},
  );
}

/** Office → TV: refresh, show its name on screen, or disconnect it. */
export async function sendTvCommand(id: string, cmd: 'reload' | 'identify' | 'disconnect'): Promise<void> {
  if (!dbInstance) return;
  const patch = cmd === 'reload' ? { reloadAt: serverTimestamp() } : cmd === 'identify' ? { identifyAt: serverTimestamp() } : { revoked: true };
  try { await settleWrite(updateDoc(doc(dbInstance, COL.tvDevices, id), patch)); }
  catch (e) { throw handleError(e); }
}

export async function renameTvDevice(id: string, name: string): Promise<void> {
  if (!dbInstance) return;
  try { await settleWrite(updateDoc(doc(dbInstance, COL.tvDevices, id), { name: name.trim().slice(0, 40) || 'TV' })); }
  catch (e) { throw handleError(e); }
}

/** Take a TV off the list — and disconnect it in the same step. Deleting the
 *  row let a TV that was switched off come back on its next start (still
 *  holding a valid link) and quietly recreate itself. The row stays, hidden,
 *  so that TV finds the disconnect whenever it wakes up. */
export async function removeTvDevice(id: string): Promise<void> {
  if (!dbInstance) return;
  try { await settleWrite(updateDoc(doc(dbInstance, COL.tvDevices, id), { revoked: true, hidden: true })); }
  catch (e) { throw handleError(e); }
}

/** The shop's TV link — created only when the SERVER copy has none. A fresh
 *  browser shows no link until settings arrive; making one in that window
 *  silently replaced the real link and dropped every TV. Needs internet. */
export async function ensureTvToken(): Promise<string> {
  if (!dbInstance) {
    const existing = getSettings().tvToken;
    if (existing) return existing;
    const t = newTvToken();
    await saveSettingsChanges({ tvToken: t });
    return t;
  }
  const ref = doc(dbInstance, COL.settings, 'system');
  const token = await runTransaction(dbInstance, async (tx: any) => {
    const snap = await tx.get(ref);
    const existing = snap.exists() ? (snap.data() as any).tvToken : undefined;
    if (existing) return existing as string;
    const t = newTvToken();
    if (snap.exists()) tx.update(ref, { tvToken: t }); else tx.set(ref, { tvToken: t }, { merge: true });
    return t;
  });
  const cached = readLS<any>(LS.settings, {});
  if (cached.tvToken !== token) { cached.tvToken = token; writeLS(LS.settings, cached); }
  return token;
}

const TV_PAIR_TTL_MS = 15 * 60_000;

function readPairing(snap: any): TvPairing {
  const raw = snap.data({ serverTimestamps: 'estimate' }) || {};
  return { ...raw, createdAt: tsMs(raw.createdAt) } as TvPairing;
}

/** TV side: claim a fresh 6-digit code and wait for the office to enter it. */
export async function startTvPairing(deviceId: string): Promise<string> {
  // Self-cleaning: codes left behind by TVs that were switched off mid-pairing
  // (a page closing can't finish its own cleanup). An extra hour of margin —
  // this runs on a TV, whose clock may be off.
  if (dbInstance) {
    try {
      const cutoff = Timestamp.fromMillis(Date.now() - TV_PAIR_TTL_MS - 60 * 60_000);
      const stale = await queryDocs(query(collection(dbInstance, COL.tvPairing), where('createdAt', '<', cutoff)));
      stale.docs.forEach((d: any) => { deleteDoc(d.ref).catch(() => {}); });
    } catch { /* best effort */ }
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    if (!dbInstance) return code;
    const ref = doc(dbInstance, COL.tvPairing, code);
    const existing = await readDoc(ref).catch(() => null);
    const live = existing?.exists() && existing.data().status === 'waiting';
    if (live) continue;
    await settleWrite(setDoc(ref, { code, deviceId, createdAt: serverTimestamp(), status: 'waiting' }));
    return code;
  }
  throw new Error('Could not create a pairing code');
}

export function subscribeTvPairing(code: string, cb: (p: TvPairing | null) => void): () => void {
  if (!dbInstance) return () => {};
  return retryingSnapshot(
    () => doc(dbInstance!, COL.tvPairing, code),
    (snap: any) => cb(snap.exists() ? readPairing(snap) : null),
    () => {},
  );
}

export async function endTvPairing(code: string): Promise<void> {
  if (!dbInstance) return;
  try { await settleWrite(deleteDoc(doc(dbInstance, COL.tvPairing, code))); } catch { /* expires on its own */ }
}

/** Office side: hand the TV link to the TV showing this code. */
export async function approveTvPairing(code: string, token: string, name: string): Promise<'ok' | 'not-found' | 'expired'> {
  if (!dbInstance) return 'not-found';
  const clean = code.replace(/\D/g, '');
  if (clean.length !== 6) return 'not-found';
  const ref = doc(dbInstance, COL.tvPairing, clean);
  const snap = await getDoc(ref);
  if (!snap.exists()) return 'not-found';
  const p = readPairing(snap);
  if (p.status !== 'waiting') return 'not-found';
  if (Date.now() - (p.createdAt || 0) > TV_PAIR_TTL_MS) return 'expired';
  await updateDoc(ref, { status: 'approved', token, name: name.trim().slice(0, 40) || 'Shop TV' });
  return 'ok';
}

/** Save customer contacts one entry at a time (one field path per customer).
 *  Writing the whole map from one device's copy dropped a contact another
 *  device had just added. */
export async function saveClientContacts(contacts: Record<string, any>): Promise<void> {
  const names = Object.keys(contacts);
  if (!names.length) return;
  const cached = readLS<any>(LS.settings, {});
  cached.clientContacts = { ...(cached.clientContacts || {}), ...contacts };
  if (dbInstance) {
    const ref = doc(dbInstance, COL.settings, 'system');
    const args: any[] = [];
    for (const n of names) args.push(new FieldPath('clientContacts', n), sanitize(contacts[n]));
    try {
      const [first, firstVal, ...rest] = args;
      await settleWrite(updateDoc(ref, first, firstVal, ...rest));
    } catch (e) {
      writeLS(LS.settings, cached);
      throw handleError(e);
    }
  }
  writeLS(LS.settings, cached);
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
const MIGRATION_COOLDOWN_KEY = 'fabtrack_photo_migration_next';

/**
 * Every staff login (8s after mount) used to run this unconditionally: a full
 * jobs-collection scan, every time, forever — including forever retrying
 * uploads after the Storage bucket hit its quota, which can never succeed
 * until the quota clears. That meant a pointless full scan + up to 10 doomed
 * upload attempts on every device, every login, spamming the console.
 *
 * A per-device cooldown fixes both: skip the scan entirely until it's due,
 * and back off hard (24h) the moment we see quota-exceeded rather than
 * hammering it again on the next login a few minutes later.
 */
function migrationDue(): boolean {
  try {
    const next = Number(localStorage.getItem(MIGRATION_COOLDOWN_KEY) || 0);
    return Date.now() >= next;
  } catch { return true; }
}
function setMigrationCooldown(hours: number): void {
  try { localStorage.setItem(MIGRATION_COOLDOWN_KEY, String(Date.now() + hours * 3600_000)); } catch {}
}

export async function migrateJobPartImagesToStorage(maxPerRun = 10): Promise<void> {
  if (!dbInstance || !migrationDue()) return;
  try {
    // Prefer the jobs the live subscription already holds — a fresh getDocs
    // here re-downloaded the WHOLE collection (~28 MB with embedded photos)
    // just to find candidates. Borrowed photos belong to another job; skip.
    const live = _mc.get('jobs:' + COL.jobs) as MCEntry<Job[]> | undefined;
    let pool: Job[];
    if (live?.hasLast && Array.isArray(live.last)) {
      pool = live.last;
    } else {
      const snap = await getDocs(collection(dbInstance, COL.jobs));
      pool = snap.docs.map(d => d.data() as Job);
    }
    const candidates = pool.filter(j => !j.photoInherited && j.partImage?.startsWith('data:'));
    if (candidates.length === 0) { setMigrationCooldown(6); return; }

    const batch = candidates.slice(0, maxPerRun);
    console.log(`[FabTrack] Migrating ${batch.length}/${candidates.length} job part image(s) to Storage…`);
    let migrated = 0, storageBlocked = false;
    for (const job of batch) {
      try {
        const ref = doc(dbInstance!, COL.jobs, job.id);
        const fresh = await getDoc(ref);
        const original = fresh.exists() ? (fresh.data() as Job).partImage : undefined;
        if (!original || !original.startsWith('data:')) continue;   // another device got it

        const blob = dataUrlToBlob(original);
        if (!blob) continue;
        const url = await uploadJobPartImage(blob, job.id);
        // Compare-and-set: the upload takes seconds, and a new photo saved in
        // that window must win. A blind updateDoc here put the OLD photo back
        // over the new one ("my photo got replaced").
        const swapped = await runTransaction(dbInstance!, async tx => {
          const now = await tx.get(ref);
          if (!now.exists() || (now.data() as Job).partImage !== original) return false;
          tx.update(ref, { partImage: url });
          return true;
        });
        if (swapped) migrated++;
      } catch (e: any) {
        if (String(e?.message || '').includes('quota-exceeded')) { storageBlocked = true; break; }
        console.warn(`[FabTrack] Part-image migration failed for job ${job.id}:`, e?.message);
      }
    }
    if (storageBlocked) {
      // Firebase returns quota-exceeded for every upload when the project is on
      // the free Spark plan — Cloud Storage requires the Blaze plan now.
      console.warn('[FabTrack] Cloud Storage unavailable (project needs the Firebase Blaze plan) — pausing part-photo migration for 24h.');
      setMigrationCooldown(24);
    } else {
      if (migrated > 0) console.log(`[FabTrack] ✓ Migrated ${migrated}/${batch.length} part image(s) to Storage`);
      setMigrationCooldown(migrated < batch.length ? 1 : 0.25);
    }
  } catch (e: any) {
    console.warn('[FabTrack] Part-image migration skipped:', e?.message);
    setMigrationCooldown(1);
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

/** Saves the given fields of a rework entry (see saveFields — reopening
 *  with resolvedAt: undefined really clears the resolution). */
export async function saveRework(entry: Partial<ReworkEntry> & { id: string }): Promise<'saved' | 'queued'> {
  return saveFields(COL.rework, LS_REWORK, entry, 'rework entry');
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

/** Saves the given fields of a delivery run (see saveFields). */
export async function saveDelivery(d: Partial<Delivery> & { id: string }): Promise<'saved' | 'queued'> {
  return saveFields(COL.deliveries, LS_DELIVERIES, { ...d, updatedAt: Date.now() }, 'delivery run');
}

export async function deleteDelivery(id: string): Promise<'saved' | 'queued'> {
  if (dbInstance) return deleteRecord(COL.deliveries, id);
  writeLS(LS_DELIVERIES, readLS<Delivery[]>(LS_DELIVERIES, []).filter(x => x.id !== id));
  return 'saved';
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

/** Saves the given fields of a vendor (see saveFields). */
export async function saveVendor(v: Partial<Vendor> & { id: string }): Promise<'saved' | 'queued'> {
  return saveFields(COL.vendors, LS_VENDORS, { ...v, updatedAt: Date.now() }, 'vendor');
}

export async function deleteVendor(id: string): Promise<'saved' | 'queued'> {
  if (dbInstance) return deleteRecord(COL.vendors, id);
  writeLS(LS_VENDORS, readLS<Vendor[]>(LS_VENDORS, []).filter(x => x.id !== id));
  return 'saved';
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

/** Saves the given fields of a purchase order (see saveFields). */
export async function savePurchaseOrder(po: Partial<PurchaseOrder> & { id: string }): Promise<'saved' | 'queued'> {
  return saveFields(COL.purchaseOrders, LS_PURCHASE_ORDERS, { ...po, updatedAt: Date.now() }, 'purchase order');
}

export async function deletePurchaseOrder(id: string): Promise<'saved' | 'queued'> {
  if (dbInstance) return deleteRecord(COL.purchaseOrders, id);
  writeLS(LS_PURCHASE_ORDERS, readLS<PurchaseOrder[]>(LS_PURCHASE_ORDERS, []).filter(x => x.id !== id));
  return 'saved';
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

/** Correct a completed job's ship date (job editor "Shipped On"). Writes only
 *  that field, so it can't revert anything else. */
export async function setJobShippedAt(jobId: string, shippedAt: number): Promise<void> {
  if (dbInstance) {
    try {
      await settleWrite(updateDoc(doc(dbInstance, COL.jobs, jobId), { shippedAt }));
      firebaseStatus = { connected: true };
    } catch (e) { throw handleError(e); }
    return;
  }
  const jobs = readLS<Job[]>(LS.jobs, []);
  const idx = jobs.findIndex(j => j.id === jobId);
  if (idx >= 0) { jobs[idx] = { ...jobs[idx], shippedAt }; writeLS(LS.jobs, jobs); }
}

/** When work on a job last ended (latest real session), or null — the "day the
 *  work finished" choice in the ship-date dialog. */
export async function lastWorkEndForJob(jobId: string): Promise<number | null> {
  try {
    const logs = await getLogsForJob(jobId);
    let last = 0;
    for (const l of logs) if (!l.isSample && l.endTime && l.endTime > last) last = l.endTime;
    return last || null;
  } catch { return null; }
}

/** Every log for a job — UNLIMITED (the live subscription caps at 500). Used
 *  when locking a profit snapshot so cost/margin is computed from the full set. */
export async function getLogsForJob(jobId: string): Promise<TimeLog[]> {
  if (dbInstance) {
    try {
      const snap = await queryDocs(query(collection(dbInstance, COL.logs), where('jobId', '==', jobId)));
      return snap.docs.map((d: any) => d.data() as TimeLog);
    } catch { return []; }
  }
  return readLS<TimeLog[]>(LS.logs, []).filter(l => l.jobId === jobId);
}

export async function deleteRework(id: string): Promise<'saved' | 'queued'> {
  if (dbInstance) return deleteRecord(COL.rework, id);
  writeLS(LS_REWORK, readLS<ReworkEntry[]>(LS_REWORK, []).filter(x => x.id !== id));
  return 'saved';
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
      const snap = await readDoc(ref);   // offline: this device's copy, not a hang
      if (!snap.exists()) throw new Error("Sample not found.");
      // Someone else's running session would be replaced and its time lost.
      const running = (snap.data() as Sample).activeEntry;
      if (running && !running.endTime) throw new Error(`${running.userName || 'Someone'} is already timing this sample — stop that timer first`);
      await settleWrite(updateDoc(ref, sanitize({
        activeEntry: entry,
        updatedAt: now,
      })));
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
      const snap = await readDoc(ref);   // offline: this device's copy, not a hang
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

      // Append + add, not a rewrite of the whole list read a moment ago — a
      // concurrent edit or delete of another entry used to be undone.
      await settleWrite(updateDoc(ref, {
        activeEntry: null,
        workEntries: arrayUnion(sanitize(completed)),
        totalWorkedMs: increment(workingMs),
        updatedAt: now,
      } as any));
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
      const snap = await readDoc(ref);   // offline: this device's copy, not a hang
      if (!snap.exists()) throw new Error("Sample not found.");
      const sample = snap.data() as Sample;
      if (!sample.activeEntry || sample.activeEntry.pausedAt) return;
      await settleWrite(updateDoc(ref, sanitize({
        activeEntry: { ...sample.activeEntry, pausedAt: now },
        updatedAt: now,
      })));
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
      const snap = await readDoc(ref);   // offline: this device's copy, not a hang
      if (!snap.exists()) throw new Error("Sample not found.");
      const sample = snap.data() as Sample;
      if (!sample.activeEntry || !sample.activeEntry.pausedAt) return;
      const pausedDuration = now - sample.activeEntry.pausedAt;
      const totalPausedMs = (sample.activeEntry.totalPausedMs || 0) + pausedDuration;
      await settleWrite(updateDoc(ref, sanitize({
        activeEntry: { ...sample.activeEntry, pausedAt: null, totalPausedMs },
        updatedAt: now,
      })));
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
): Promise<'saved' | 'queued' | void> {
  const now = Date.now();
  // A cleared/garbled time arrives as NaN — refuse it instead of saving a
  // session with no start or end.
  for (const k of ['startTime', 'endTime'] as const) {
    if (k in updates && updates[k] != null && !Number.isFinite(updates[k] as number)) throw new Error('Enter a valid start and end time');
  }
  if (updates.startTime && updates.endTime && updates.endTime < updates.startTime) throw new Error('The end time is before the start time');

  if (dbInstance) {
    try {
      const ref = doc(dbInstance, COL.samples, sampleId);
      const snap = await readDoc(ref);
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

      const r = await settleWrite(updateDoc(ref, sanitize({ workEntries: entries, totalWorkedMs, updatedAt: now })));
      // Re-sync the bridged rate-learning log so a corrected time actually
      // updates estimates (the bridge id is deterministic → overwrites in place).
      try { await _bridgeSampleWorkToTimeLog(sample, updated, updated.durationSeconds || 0); } catch {}
      if (r === 'saved') firebaseStatus = { connected: true };
      return r;
    } catch (e) {
      throw handleError(e);
    }
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
      const snap = await readDoc(ref);
      if (!snap.exists()) throw new Error("Sample not found.");
      const sample = snap.data() as Sample;
      const entries = sample.workEntries || [];
      const entry = entries.find(e => e.id === entryId);
      if (!entry) return;
      const removedMs = (entry.durationSeconds || 0) * 1000;
      const filtered = entries.filter(e => e.id !== entryId);
      const totalWorkedMs = Math.max(0, (sample.totalWorkedMs || 0) - removedMs);

      await settleWrite(updateDoc(ref, sanitize({ workEntries: filtered, totalWorkedMs, updatedAt: now })));
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
