// ═════════════════════════════════════════════════════════════════════
// DeliveriesView — full-featured multi-stop delivery management.
//
// Features:
//   • Stop types: Customer Dropoff / Vendor Dropoff / Vendor Pickup / Other
//   • Multi-job picker (checkbox chips — mobile friendly, no Ctrl-click)
//   • All customers + all vendors in entity selectors
//   • Route mile estimate via OSRM (free, no key) + Nominatim geocoding
//   • Proof-of-delivery photo on "Arrived" (device camera)
//   • GPS tracking, IRS mileage log CSV export
//   • Active run card with stop-by-stop progress
//   • History list with stop type breakdown
// ═════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Truck, Plus, MapPin, Navigation, CheckCircle2, X, StopCircle,
  Trash2, Download, Clock, Users, Package, ArrowUpCircle,
  Building2, Camera, Route, ChevronDown, ChevronUp, Milestone,
  RotateCcw, AlertTriangle, DollarSign, Flag, Play, Calendar,
} from 'lucide-react';
import type { Delivery, DeliveryStop, StopType, Job, User, SystemSettings, CustomerContact, Vendor } from '../types';
import * as DB from '../services/mockDb';
import {
  createGpsSession, startTracking, stopTracking, sessionMinutes, trackForSave, trackingSession,
  saveStoredSession, loadStoredSession, clearStoredSession, type GpsSession,
} from '../services/gpsTracker';
import { directionsUrl, formatMiles } from '../utils/geo';
import { fmt, todayFmt } from '../utils/date';
import { shrinkImage } from '../utils/imageShrink';
import { changedFields, hasChanges, sameValue } from '../utils/changedFields';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/useConfirm';

const IRS_MILEAGE_RATE_CENTS_2025 = 70; // $0.70/mi — update annually

/** How often a live run's miles + track are written to the run (this phone keeps a copy in between). */
const GPS_FLUSH_MS = 5 * 60_000;

// Proof photos are embedded in the run's ONE record (no cloud storage on the
// free plan), which can't pass ~1 MB — so photos share that room instead of
// each getting the 450 KB single-photo budget (the 3rd one failed).
const RUN_DOC_ROOM = 1_000_000 - 45_000;   // minus room for the GPS track (≤ 500 points) + field names
const MAX_STOP_PHOTO = 150_000;
const MIN_STOP_PHOTO = 25_000;             // below this a phone photo isn't readable any more

const syncNote = (r: unknown) => (r === 'queued' ? ' — saved on this phone, will sync' : '');
const errText = (e: any) => e?.message || 'check the connection and try again';
const isTooBig = (e: any) => /too big/i.test(String(e?.message || ''));
const roundMiles = (m: number) => Math.round(m * 100) / 100;

/** Room for one more proof photo on this run: what's left ÷ stops still without a photo. */
export function runPhotoBudget(run: Delivery, stopId: string): number {
  const rest = JSON.stringify({
    ...run, track: undefined,
    stops: run.stops.map(s => (s.id === stopId ? { ...s, photoUrl: undefined } : s)),
  }).length;
  const waiting = run.stops.filter(s => s.id === stopId || !s.photoUrl).length;
  return Math.max(0, Math.min(MAX_STOP_PHOTO, Math.floor((RUN_DOC_ROOM - rest) / Math.max(1, waiting))));
}

/** Apply a driver's tap to one stop. A time already recorded wins — a late GPS
 *  answer or a double tap mustn't move when the driver arrived / finished. */
export function applyStopPatch(stop: DeliveryStop, patch: Partial<DeliveryStop>): DeliveryStop {
  const next: any = { ...stop, ...patch };
  if (stop.arrivedAt && patch.arrivedAt) next.arrivedAt = stop.arrivedAt;
  if (stop.completedAt && patch.completedAt) next.completedAt = stop.completedAt;
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  return next;
}

/** Recorded on the driver's phone during the run — the editor never owns these. */
const DRIVER_FIELDS = new Set(['arrivedAt', 'completedAt', 'photoUrl', 'signedBy', 'isException', 'exceptionReason', 'arrivalLat', 'arrivalLon']);

/**
 * Merge the delivery editor's stops into the LIVE stops. The editor seeds its
 * stops once; saving that copy back wiped arrivals, Done, photos, signatures
 * and exceptions the driver recorded while it was open.
 *  • order, added and removed stops come from the editor;
 *  • per stop, a field the user changed in the editor wins, anything else
 *    (and every driver-recorded field) comes from the live copy;
 *  • a stop added on another device while the editor was open is kept.
 */
export function mergeEditedStops(live: DeliveryStop[], opened: DeliveryStop[], edited: DeliveryStop[]): DeliveryStop[] {
  const liveById = new Map(live.map(s => [s.id, s]));
  const openedById = new Map(opened.map(s => [s.id, s]));
  const editedIds = new Set(edited.map(s => s.id));
  const out: DeliveryStop[] = [];
  for (const e of edited) {
    const l = liveById.get(e.id);
    const o = openedById.get(e.id);
    if (!l) {
      // Removed on another device after the editor opened — keep it only if the user worked on it here.
      if (!o || hasChanges(o, e)) out.push(e);
      continue;
    }
    const m: any = { ...l };
    const keys = new Set([...Object.keys(e), ...Object.keys(o || {})]);
    for (const k of keys) {
      if (DRIVER_FIELDS.has(k)) continue;
      const ev = (e as any)[k];
      if (!o || !sameValue((o as any)[k], ev)) {
        if (ev === undefined) delete m[k]; else m[k] = ev;
      }
    }
    out.push(m);
  }
  for (const l of live) if (!editedIds.has(l.id) && !openedById.has(l.id)) out.push(l);
  return out;
}

// ── Stop type config ──────────────────────────────────────────────────────
interface StopTypeDef {
  value: StopType;
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
  colorClass: string;       // text + border color
  bgClass: string;          // background tint
  borderClass: string;
  description: string;
}
const STOP_TYPES: StopTypeDef[] = [
  {
    value: 'customer-dropoff',
    label: 'Customer Drop',
    shortLabel: 'CUST DROP',
    icon: <Package className="w-3.5 h-3.5" />,
    colorClass: 'text-blue-400',
    bgClass: 'bg-blue-500/10',
    borderClass: 'border-blue-500/30',
    description: 'Deliver finished parts to customer',
  },
  {
    value: 'vendor-dropoff',
    label: 'Vendor Drop',
    shortLabel: 'VEND DROP',
    icon: <Building2 className="w-3.5 h-3.5" />,
    colorClass: 'text-orange-400',
    bgClass: 'bg-orange-500/10',
    borderClass: 'border-orange-500/30',
    description: 'Drop off material at vendor',
  },
  {
    value: 'vendor-pickup',
    label: 'Vendor Pickup',
    shortLabel: 'VEND PICK',
    icon: <ArrowUpCircle className="w-3.5 h-3.5" />,
    colorClass: 'text-purple-400',
    bgClass: 'bg-purple-500/10',
    borderClass: 'border-purple-500/30',
    description: 'Pick up processed parts from vendor',
  },
  {
    value: 'other',
    label: 'Other',
    shortLabel: 'OTHER',
    icon: <MapPin className="w-3.5 h-3.5" />,
    colorClass: 'text-zinc-400',
    bgClass: 'bg-zinc-800/40',
    borderClass: 'border-white/10',
    description: 'Gas, supplies, custom stop',
  },
];

function stopTypeDef(type?: StopType): StopTypeDef {
  return STOP_TYPES.find(t => t.value === type) ?? STOP_TYPES[3];
}

// ── Free routing utilities ────────────────────────────────────────────────
// Nominatim geocoding (OpenStreetMap, no key, 1 req/s limit — fine for this)
async function geocodeAddress(address: string): Promise<[number, number] | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=us`,
      { headers: { 'User-Agent': 'FabTrack-IO/1.0' }, signal: AbortSignal.timeout(5000) },
    );
    const data = await res.json() as Array<{ lat: string; lon: string }>;
    if (!data.length) return null;
    return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
  } catch {
    return null;
  }
}

// OSRM public API — free, no key. Returns distance in miles.
async function osrmRoute(points: Array<[number, number]>): Promise<number | null> {
  if (points.length < 2) return null;
  const coords = points.map(([lat, lon]) => `${lon},${lat}`).join(';');
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`,
      { signal: AbortSignal.timeout(7000) },
    );
    const data = await res.json() as { code: string; routes: Array<{ distance: number }> };
    if (data.code !== 'Ok' || !data.routes?.length) return null;
    return data.routes[0].distance * 0.000621371;
  } catch {
    return null;
  }
}

// Estimate route from address strings — geocodes each, then calls OSRM.
// Rate-limits to 1 Nominatim request/second.
async function estimateRouteFromAddresses(addresses: string[]): Promise<number | null> {
  const valid = addresses.filter(a => a.trim().length > 5);
  if (valid.length < 2) return null;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < valid.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1100)); // Nominatim rate limit
    const pt = await geocodeAddress(valid[i]);
    if (pt) points.push(pt);
  }
  if (points.length < 2) return null;
  return osrmRoute(points);
}

interface Props {
  user: { id: string; name: string; role: string };
  addToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const DeliveriesView: React.FC<Props> = ({ user, addToast }) => {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [settings, setSettings] = useState<SystemSettings>(DB.getSettings());
  const [creating, setCreating] = useState(false);
  // The copy the editor opened with (not an id) — a run deleted elsewhere
  // mustn't make an open editor vanish with the user's typing in it.
  const [editing, setEditing] = useState<Delivery | null>(null);
  const { confirm: confirmDialog, ConfirmHost } = useConfirm();
  const [loaded, setLoaded] = useState(false);
  // Latest list for work that finishes after a re-render (GPS callbacks,
  // chained stop saves, editor merges) — building from a render's copy
  // dropped changes saved in between.
  const deliveriesRef = useRef<Delivery[]>([]);
  const toastRef = useRef(addToast);
  toastRef.current = addToast;

  useEffect(() => {
    const u1 = DB.subscribeDeliveries(list => { deliveriesRef.current = list; setDeliveries(list); setLoaded(true); });
    const u2 = DB.subscribeJobs(setJobs);
    const u3 = DB.subscribeUsers(setUsers);
    const u4 = DB.subscribeSettings(setSettings);
    const u5 = DB.subscribeVendors(setVendors);
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, []);

  // ── GPS ──
  // The session lives in gpsTracker (it keeps counting on other screens) and
  // in this phone's storage (survives a reload / iOS killing the tab). This
  // screen re-attaches to it, and writes the miles to the run every few minutes.
  const gpsRef = useRef<GpsSession | null>(null);
  const [gpsRunId, setGpsRunId] = useState<string | null>(null);   // run this phone is tracking (for rendering)
  const [liveMiles, setLiveMiles] = useState(() => trackingSession()?.miles || 0);
  const gpsErrAt = useRef<Record<string, number>>({});
  const flushingRef = useRef(false);
  const flushErrShown = useRef(new Set<string>());
  // Runs with a start/finish/cancel/delete in flight — one at a time per run
  // (a double tap started two GPS sessions / saved twice).
  const busyRef = useRef(new Set<string>());
  const [busyIds, setBusyIds] = useState<string[]>([]);

  const active = useMemo(() => deliveries.find(d => d.status === 'in-progress'), [deliveries]);

  /** Write the miles so far (+ track) to the run. Not forced: only every GPS_FLUSH_MS. */
  const flushGps = useCallback(async (force = false) => {
    const s = gpsRef.current;
    if (!s || flushingRef.current || busyRef.current.has(s.runId)) return;   // Finish/Cancel writes the final figures
    if (Math.abs(s.miles - s.savedMiles) < 0.01) return;
    if (!force && Date.now() - s.lastFlushed < GPS_FLUSH_MS) return;
    // Only onto a run that's still live — a partial save to a deleted run
    // would create a broken stub, and Finish already wrote the final miles.
    const run = deliveriesRef.current.find(d => d.id === s.runId);
    if (!run || run.status !== 'in-progress') return;
    flushingRef.current = true;
    s.lastFlushed = Date.now();
    const miles = roundMiles(s.miles);
    try {
      try {
        await DB.saveDelivery({ id: s.runId, milesDriven: miles, track: trackForSave(s) });
      } catch (e) {
        if (!isTooBig(e)) throw e;
        await DB.saveDelivery({ id: s.runId, milesDriven: miles });   // record full of photos — the miles matter most
      }
      s.savedMiles = miles;
      saveStoredSession(s);
    } catch (e) {
      // Kept on this phone either way; say it once per run, not every 5 minutes.
      if (!flushErrShown.current.has(s.runId)) {
        flushErrShown.current.add(s.runId);
        toastRef.current('error', `Couldn't save the miles so far (${errText(e)}) — they're kept on this phone and saved when you finish`);
      }
    } finally {
      flushingRef.current = false;
    }
  }, []);

  const attachGps = useCallback((s: GpsSession) => {
    gpsRef.current = s;
    setGpsRunId(s.runId);
    setLiveMiles(s.miles);
    startTracking(
      s,
      () => { setLiveMiles(s.miles); void flushGps(); },
      (msg) => {
        // watchPosition repeats its error (e.g. every 30 s in a dead zone) — one toast a minute is plenty.
        const now = Date.now();
        if (now - (gpsErrAt.current[msg] || 0) < 60_000) return;
        gpsErrAt.current[msg] = now;
        toastRef.current('error', `GPS: ${msg}`);
      },
    );
  }, [flushGps]);

  const dropGps = (runId: string) => {
    const s = gpsRef.current?.runId === runId ? gpsRef.current : trackingSession()?.runId === runId ? trackingSession() : null;
    if (s) stopTracking(s);
    clearStoredSession(runId);
    if (gpsRef.current?.runId === runId) gpsRef.current = null;
    setGpsRunId(null);
    setLiveMiles(0);
  };

  // Re-attach to (or resume) this phone's session for the live run; stop
  // following a run that was finished or cancelled on another device.
  useEffect(() => {
    if (!loaded) return;
    const s = gpsRef.current || trackingSession() || loadStoredSession();
    // A Finish/Cancel from this phone is in flight: the list already shows it
    // (unconfirmed), and that action keeps or drops the session itself.
    if (!s || busyRef.current.has(s.runId)) return;
    const run = deliveries.find(d => d.id === s.runId);
    // Not in the list (yet / a cached copy) — leave it alone rather than lose miles.
    if (!run) return;
    if (run.status === 'delivered' || run.status === 'cancelled') { dropGps(s.runId); return; }
    if (run.status !== 'in-progress' || gpsRef.current === s) return;
    const resumed = s.watchId == null && trackingSession() !== s;
    attachGps(s);
    if (resumed) toastRef.current('info', `GPS tracking resumed for ${run.runNumber} — ${formatMiles(s.miles)} so far`);
    void flushGps(true);
  }, [loaded, deliveries, attachGps, flushGps]);

  useEffect(() => {
    // Catch the miles of a parked tail, and save before iOS may kill a hidden tab.
    const t = setInterval(() => { void flushGps(); }, 60_000);
    const onHide = () => { if (document.visibilityState === 'hidden') void flushGps(true); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onHide);
      // Leaving the screen: tracking carries on (gpsTracker), but nothing here
      // can show it — detach, and save the miles so far.
      const s = gpsRef.current;
      if (s) {
        s.onPoint = undefined; s.onError = undefined;
        saveStoredSession(s);
        void flushGps(true);
        gpsRef.current = null;   // a remount re-attaches
      }
    };
  }, [flushGps]);

  // ── Run actions ──
  const withBusy = async (id: string, fn: () => Promise<void>) => {
    if (busyRef.current.has(id)) return;
    busyRef.current.add(id); setBusyIds([...busyRef.current]);
    try { await fn(); }
    finally { busyRef.current.delete(id); setBusyIds([...busyRef.current]); }
  };

  const beginRun = (d: Delivery) => withBusy(d.id, async () => {
    // One active run at a time — starting a second would orphan the first run's
    // GPS session so its miles are never saved.
    if (deliveriesRef.current.some(x => x.status === 'in-progress' && x.id !== d.id)) {
      addToast('error', 'Finish or cancel the active run first');
      return;
    }
    let r: 'saved' | 'queued';
    try {
      r = await DB.saveDelivery({ id: d.id, status: 'in-progress', startedAt: Date.now(), mileageRateCents: IRS_MILEAGE_RATE_CENTS_2025 });
    } catch (e) {
      addToast('error', `Couldn't start ${d.runNumber} — ${errText(e)}`);
      return;
    }
    // GPS only once the run has really started — a failed start used to leave
    // it tracking with no run on screen.
    const session = createGpsSession(d.id, d.milesDriven || 0);
    saveStoredSession(session);
    attachGps(session);
    addToast('success', `🚚 Run ${d.runNumber} started — GPS tracking${syncNote(r)}`);
  });

  const finishRun = (d: Delivery) => withBusy(d.id, async () => {
    const live = deliveriesRef.current.find(x => x.id === d.id) || d;
    // Keep the session until the save lands — dropping it first meant a failed
    // save + a second tap on Finish saved 0 miles.
    const s = gpsRef.current?.runId === d.id ? gpsRef.current : null;
    const endedAt = Date.now();
    const wallMinutes = live.startedAt ? Math.round((endedAt - live.startedAt) / 60_000) : 0;
    const fields: Partial<Delivery> & { id: string } = { id: d.id, status: 'delivered', endedAt };
    if (s) {
      fields.milesDriven = roundMiles(s.miles);
      fields.durationMinutes = sessionMinutes(s) || wallMinutes;
      fields.track = trackForSave(s);
    } else {
      // No GPS on this phone — keep the miles already saved/typed on the run.
      fields.durationMinutes = wallMinutes || live.durationMinutes;
    }
    let r: 'saved' | 'queued';
    let trackDropped = false;
    try {
      try { r = await DB.saveDelivery(fields); }
      catch (e) {
        if (!isTooBig(e) || !s) throw e;
        // The record is full of proof photos — save the run without the breadcrumbs rather than not at all.
        r = await DB.saveDelivery({ ...fields, track: undefined });
        trackDropped = true;
      }
    } catch (e) {
      addToast('error', `Couldn't finish ${d.runNumber} — ${errText(e)}${s ? '. GPS is still counting; try again.' : ''}`);
      return;
    }
    if (s) dropGps(d.id);
    const miles = fields.milesDriven ?? live.milesDriven ?? 0;
    addToast('success', `✅ Run ${d.runNumber} complete · ${formatMiles(miles)}${trackDropped ? ' (no room left for the GPS track)' : ''}${syncNote(r)}`);
  });

  /** Miles typed in on the tracking phone — GPS keeps adding from the new figure. */
  const setMilesByHand = async (d: Delivery, miles: number) => {
    const s = gpsRef.current?.runId === d.id ? gpsRef.current : null;
    if (!s) return;
    s.miles = miles;
    saveStoredSession(s);
    setLiveMiles(miles);
    addToast('success', `Miles set to ${formatMiles(miles)} — GPS keeps adding from here`);
    await flushGps(true);
  };

  const cancelRun = async (d: Delivery) => {
    const ok = await confirmDialog({ title: 'Cancel this delivery?', message: 'GPS track will be discarded. Run marked cancelled.', tone: 'warning', confirmLabel: 'Cancel run', cancelLabel: 'Keep running' });
    if (!ok) return;
    await withBusy(d.id, async () => {
      let r: 'saved' | 'queued';
      // Miles + track saved along the way go too, as the dialog says.
      try { r = await DB.saveDelivery({ id: d.id, status: 'cancelled', endedAt: Date.now(), track: undefined, milesDriven: undefined }); }
      catch (e) { addToast('error', `Couldn't cancel ${d.runNumber} — ${errText(e)}`); return; }
      dropGps(d.id);
      addToast('info', `Cancelled ${d.runNumber}${syncNote(r)}`);
    });
  };

  const deleteRun = async (d: Delivery) => {
    const ok = await confirmDialog({ title: `Delete run ${d.runNumber}?`, message: "Can't be undone. Mileage log entry removed.", tone: 'danger', confirmLabel: 'Delete' });
    if (!ok) return;
    await withBusy(d.id, async () => {
      let r: unknown;
      try { r = await DB.deleteDelivery(d.id); }
      catch (e) { addToast('error', `Couldn't delete ${d.runNumber} — ${errText(e)}`); return; }
      addToast('info', `Deleted ${d.runNumber}${syncNote(r)}`);
    });
  };

  // ── Stop updates ── serialized per run and built from the LATEST run, so
  // "Received by" (saved on blur) + Done, or a late Arrived GPS answer + Done,
  // can't drop one another. Only the stops are written.
  const stopChain = useRef<Record<string, Promise<unknown>>>({});
  const updateStop = useCallback((runId: string, stopId: string, patch: Partial<DeliveryStop>): Promise<'saved' | 'queued' | 'failed'> => {
    const run = async (): Promise<'saved' | 'queued' | 'failed'> => {
      const d = deliveriesRef.current.find(x => x.id === runId);
      if (!d || !d.stops.some(s => s.id === stopId)) {
        toastRef.current('error', 'That stop is no longer on this run — it was changed on another device');
        return 'failed';
      }
      const before = d.stops;
      const stops = before.map(s => (s.id === stopId ? applyStopPatch(s, patch) : s));
      try {
        const r = await DB.saveDelivery({ id: runId, stops });
        // If the live copy hasn't come back yet, the next queued update must still build on this one.
        deliveriesRef.current = deliveriesRef.current.map(x => (x.id === runId && x.stops === before ? { ...x, stops } : x));
        return r;
      } catch (e) {
        toastRef.current('error', `Couldn't save that stop — ${errText(e)}`);
        return 'failed';
      }
    };
    const next = (stopChain.current[runId] || Promise.resolve()).then(run, run);
    stopChain.current[runId] = next;
    return next;
  }, []);

  /** Save-back of new customer addresses for auto-fill — secondary to the run, so it never blocks it. */
  const saveContactsQuietly = async (contacts?: Record<string, CustomerContact>) => {
    if (!contacts || Object.keys(contacts).length === 0) return;
    try { await DB.saveClientContacts(contacts); }
    catch (e) { addToast('info', `Run saved, but the new customer address for auto-fill wasn't (${errText(e)})`); }
  };

  const createRun = async (d: Delivery, _opened: Delivery | null, contacts?: Record<string, CustomerContact>): Promise<boolean> => {
    let r: 'saved' | 'queued';
    try { r = await DB.saveDelivery(d); }
    catch (e) { addToast('error', `Couldn't create ${d.runNumber} — ${errText(e)}`); return false; }
    await saveContactsQuietly(contacts);
    setCreating(false);
    addToast('success', `Run ${d.runNumber} created — ${d.stops.length} stops${syncNote(r)}`);
    return true;
  };

  const saveEditedRun = async (edited: Delivery, opened: Delivery | null, contacts?: Record<string, CustomerContact>): Promise<boolean> => {
    const live = deliveriesRef.current.find(x => x.id === edited.id);
    if (!live) { addToast('error', `${edited.runNumber} was deleted on another device — nothing to save it to`); return false; }
    // Only what the user changed — saving the whole copy undid progress
    // recorded on the driver's phone while the editor was open.
    const changes = changedFields<Delivery>(opened, edited, { ignore: ['updatedAt', 'stops'] });
    if (!sameValue(opened?.stops, edited.stops)) changes.stops = mergeEditedStops(live.stops, opened?.stops || [], edited.stops);
    if (Object.keys(changes).length === 0) {
      await saveContactsQuietly(contacts);
      setEditing(null);
      addToast('info', 'No changes to save');
      return true;
    }
    let r: 'saved' | 'queued';
    try { r = await DB.saveDelivery({ id: edited.id, ...changes }); }
    catch (e) { addToast('error', `Couldn't save ${edited.runNumber} — ${errText(e)}`); return false; }
    await saveContactsQuietly(contacts);
    setEditing(null);
    addToast('success', `Saved ${edited.runNumber}${syncNote(r)}`);
    return true;
  };

  const exportCsv = () => {
    const header = ['Run #', 'Driver', 'Date', 'Stops', 'Stop Types', 'Customers', 'Vendors', 'Miles', 'Est. Miles', 'Duration (min)', 'Rate ($/mi)', 'Amount ($)', 'Notes'];
    const rows = deliveries.filter(d => d.status === 'delivered').map(d => {
      const customers = Array.from(new Set(d.stops.map(s => s.customerName).filter(Boolean))).join('; ');
      const vendorNames = Array.from(new Set(d.stops.map(s => s.vendorName).filter(Boolean))).join('; ');
      const stopTypes = Array.from(new Set(d.stops.map(s => s.stopType).filter(Boolean))).join('; ');
      const rate = (d.mileageRateCents || 0) / 100;
      const amount = (d.milesDriven || 0) * rate;
      return [d.runNumber, d.driverName, d.startedAt ? new Date(d.startedAt).toLocaleDateString() : '', String(d.stops.length), stopTypes, customers, vendorNames, (d.milesDriven || 0).toFixed(1), (d.estimatedMiles || 0).toFixed(1), String(d.durationMinutes || 0), rate.toFixed(2), amount.toFixed(2), (d.notes || '').replace(/"/g, '""')];
    });
    const totalMiles = rows.reduce((a, r) => a + parseFloat(r[7] || '0'), 0);
    const totalAmount = rows.reduce((a, r) => a + parseFloat(r[11] || '0'), 0);
    rows.push(['', '', '', '', '', 'TOTAL', '', totalMiles.toFixed(1), '', '', '', totalAmount.toFixed(2), '']);
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `mileage-log-${todayFmt().replace(/\//g, '-')}.csv`; a.click();
    URL.revokeObjectURL(url);
    addToast('success', 'Mileage log exported');
  };

  const history = useMemo(() => deliveries.filter(d => d.status !== 'in-progress'), [deliveries]);
  const completed = useMemo(() => deliveries.filter(d => d.status === 'delivered'), [deliveries]);
  const totalMilesAll = useMemo(() => history.reduce((a, d) => a + (d.milesDriven || 0), 0), [history]);

  const now = Date.now();
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const thirtyDaysAgo = now - 30 * 86_400_000;
  const milesMonth = useMemo(() => completed.filter(d => (d.startedAt || 0) >= monthStart.getTime()).reduce((a, d) => a + (d.milesDriven || 0), 0), [completed]);
  const runs30 = useMemo(() => completed.filter(d => (d.startedAt || 0) >= thirtyDaysAgo).length, [completed]);
  const mileageDeductible = milesMonth * ((completed[0]?.mileageRateCents || IRS_MILEAGE_RATE_CENTS_2025) / 100);

  // All unique customers across ALL jobs (not just open ones) + settings.clients
  const allCustomers = useMemo(() => {
    const fromJobs = new Set(jobs.map(j => j.customer).filter(Boolean));
    const fromSettings = new Set((settings.clients || []));
    return Array.from(new Set([...fromJobs, ...fromSettings])).sort();
  }, [jobs, settings.clients]);

  return (
    <div className="space-y-5 animate-fade-in">
      {ConfirmHost}

      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h2 className="text-2xl font-black text-white flex items-center gap-2 tracking-tight">
            <Truck className="w-6 h-6 text-amber-500" aria-hidden="true" /> Deliveries
          </h2>
          <p className="text-zinc-500 text-sm mt-0.5">Multi-stop runs — customers, vendors, GPS mileage</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {/* Stop type legend */}
          <div className="hidden sm:flex items-center gap-1.5">
            {STOP_TYPES.slice(0, 3).map(t => (
              <span key={t.value} className={`text-[9px] font-black px-2 py-1 rounded-lg border flex items-center gap-1 ${t.colorClass} ${t.bgClass} ${t.borderClass}`}>
                {t.icon} {t.shortLabel}
              </span>
            ))}
          </div>
          <button type="button" onClick={exportCsv} disabled={history.length === 0}
            className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 border border-white/10">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <button type="button" onClick={() => setCreating(true)}
            className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 shadow-lg shadow-amber-900/30">
            <Plus className="w-4 h-4" /> New Run
          </button>
        </div>
      </div>

      {/* ── KPI strip ── */}
      {(() => {
        const deliveredValueMonth = completed
          .filter(d => (d.startedAt || 0) >= monthStart.getTime())
          .reduce((sum, d) => sum + d.stops.reduce((s2, stop) => {
            const linkedJobValues = jobs.filter(j => stop.jobIds.includes(j.id)).reduce((a, j) => a + (j.quoteAmount || 0), 0);
            return s2 + linkedJobValues;
          }, 0), 0);
        const exceptionCount = history.reduce((a, d) => a + d.stops.filter(s => s.isException).length, 0);
        return (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiCard label="Miles This Month" value={formatMiles(milesMonth)} hint={milesMonth > 0 ? `~$${mileageDeductible.toFixed(0)} deductible` : 'Log your first run'} color="text-amber-400" icon={<Truck className="w-4 h-4" />} />
            <KpiCard label="Runs (30d)" value={String(runs30)} hint={`${completed.length} all-time`} color="text-emerald-400" icon={<CheckCircle2 className="w-4 h-4" />} />
            <KpiCard label="All-Time Miles" value={formatMiles(totalMilesAll)} hint={`${completed.length} completed`} color="text-blue-400" icon={<Navigation className="w-4 h-4" />} />
            <KpiCard
              label="Delivered Value"
              value={deliveredValueMonth > 0 ? `$${deliveredValueMonth >= 1000 ? (deliveredValueMonth/1000).toFixed(1)+'k' : deliveredValueMonth.toFixed(0)}` : '—'}
              hint="job value delivered this month"
              color="text-emerald-400"
              icon={<DollarSign className="w-4 h-4" />}
            />
            <KpiCard
              label="Exceptions"
              value={exceptionCount > 0 ? String(exceptionCount) : '0'}
              hint={exceptionCount > 0 ? 'stops flagged all-time' : 'no issues flagged'}
              color={exceptionCount > 0 ? 'text-red-400' : 'text-zinc-500'}
              icon={<AlertTriangle className="w-4 h-4" />}
            />
          </div>
        );
      })()}

      {/* ── Scheduled runs (not yet started) ── */}
      {(() => {
        const scheduled = deliveries.filter(d => d.status === 'scheduled');
        if (scheduled.length === 0) return null;
        return (
          <div className="space-y-2">
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest px-1">Scheduled · {scheduled.length} run{scheduled.length !== 1 ? 's' : ''} queued</p>
            {scheduled.map(d => {
              const runValue = d.stops.reduce((s, stop) =>
                s + jobs.filter(j => stop.jobIds.includes(j.id)).reduce((a, j) => a + (j.quoteAmount || 0), 0), 0);
              return (
                <div key={d.id} className="bg-zinc-900/50 border border-white/5 rounded-2xl p-3 sm:p-4 flex items-center gap-3 hover:border-white/10 transition-all">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center shrink-0">
                    <Calendar className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-white text-sm">{d.runNumber} <span className="text-[10px] font-normal text-blue-400 uppercase tracking-wider ml-1">scheduled</span></p>
                    <p className="text-[11px] text-zinc-500 truncate">{d.driverName} · {d.stops.length} stop{d.stops.length !== 1 ? 's' : ''}
                      {runValue > 0 && <span className="text-emerald-400 font-bold ml-1">· ${runValue >= 1000 ? (runValue/1000).toFixed(1)+'k' : runValue.toFixed(0)}</span>}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setEditing(d)}
                      className="text-[11px] text-zinc-400 hover:text-white border border-white/10 hover:border-white/20 px-3 py-1.5 rounded-lg font-bold transition-colors">
                      Edit
                    </button>
                    <button type="button" onClick={() => beginRun(d)} disabled={busyIds.includes(d.id)}
                      className="text-[11px] text-emerald-400 hover:text-white bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition-colors disabled:opacity-50">
                      <Play className="w-3 h-3" /> {busyIds.includes(d.id) ? 'Starting…' : 'Start'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ── Active run ── */}
      {active && (
        <ActiveRunCard
          delivery={active}
          liveMiles={liveMiles || active.milesDriven || 0}
          jobs={jobs}
          busy={busyIds.includes(active.id)}
          onFinish={() => finishRun(active)}
          onCancel={() => cancelRun(active)}
          onUpdateStop={(stopId, patch) => updateStop(active.id, stopId, patch)}
          photoBudget={(stopId) => {
            const run = deliveriesRef.current.find(x => x.id === active.id) || active;
            return runPhotoBudget(run, stopId);
          }}
          // Only the phone doing the GPS can correct the live figure — another
          // device's edit would be overwritten by that phone's next save.
          onSetMiles={gpsRunId === active.id ? (m) => setMilesByHand(active, m) : undefined}
          onEditDetails={() => setEditing(active)}
          addToast={addToast}
          allJobs={jobs}
        />
      )}

      {/* ── History ── */}
      <HistoryList deliveries={history} jobs={jobs} onDelete={deleteRun} onEdit={(d) => setEditing(d)} addToast={addToast} />

      {/* ── Create modal ── */}
      {creating && (
        <DeliveryEditor
          existing={null} drivers={users} jobs={jobs} vendors={vendors} allRuns={deliveries}
          settings={settings} allCustomers={allCustomers} currentUser={user} addToast={addToast}
          onCancel={() => setCreating(false)}
          onSave={createRun}
        />
      )}

      {/* ── Edit modal ── keyed so switching runs re-seeds it */}
      {editing && (
        <DeliveryEditor
          key={editing.id}
          existing={editing} drivers={users} jobs={jobs} vendors={vendors} allRuns={deliveries}
          settings={settings} allCustomers={allCustomers} currentUser={user} addToast={addToast}
          onCancel={() => setEditing(null)}
          onSave={saveEditedRun}
        />
      )}
    </div>
  );
};

// ── KPI card ─────────────────────────────────────────────────────────────
const KpiCard: React.FC<{ label: string; value: string; hint: string; color: string; icon: React.ReactNode }> = ({ label, value, hint, color, icon }) => (
  <div className="bg-gradient-to-br from-zinc-900/60 to-zinc-900/30 border border-white/5 rounded-2xl p-3 sm:p-4 overflow-hidden">
    <div className="flex items-center justify-between gap-2 mb-1">
      <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest truncate">{label}</p>
      <span className={color}>{icon}</span>
    </div>
    <p className={`text-xl sm:text-2xl font-black tabular leading-tight ${color}`}>{value}</p>
    <p className="text-[10px] text-zinc-600 mt-0.5 truncate">{hint}</p>
  </div>
);

// ── Stop type badge ───────────────────────────────────────────────────────
const StopTypeBadge: React.FC<{ type?: StopType; size?: 'sm' | 'xs' }> = ({ type, size = 'sm' }) => {
  const def = stopTypeDef(type);
  const cls = size === 'xs' ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5';
  return (
    <span className={`font-black rounded flex items-center gap-0.5 border shrink-0 ${cls} ${def.colorClass} ${def.bgClass} ${def.borderClass}`}>
      {def.icon} {def.shortLabel}
    </span>
  );
};

// ── Active run card ───────────────────────────────────────────────────────
const ActiveRunCard: React.FC<{
  delivery: Delivery;
  liveMiles: number;
  jobs: Job[];
  allJobs: Job[];
  busy: boolean;
  onFinish: () => void;
  onCancel: () => void;
  onUpdateStop: (stopId: string, patch: Partial<DeliveryStop>) => Promise<unknown>;
  photoBudget: (stopId: string) => number;
  /** Set only on the phone doing the GPS. */
  onSetMiles?: (miles: number) => void;
  onEditDetails: () => void;
  addToast: Props['addToast'];
}> = ({ delivery, liveMiles, jobs, allJobs, busy, onFinish, onCancel, onUpdateStop, photoBudget, onSetMiles, onEditDetails, addToast }) => {
  const [milesDraft, setMilesDraft] = useState<string | null>(null);
  const submitMiles = (e: React.FormEvent) => {
    e.preventDefault();
    const m = parseFloat(milesDraft || '');
    if (!Number.isFinite(m) || m < 0 || m > 5000) { addToast('error', 'Enter the miles driven so far, e.g. 12.5'); return; }
    onSetMiles?.(Math.round(m * 10) / 10);
    setMilesDraft(null);
  };
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const tick = () => setElapsed(delivery.startedAt ? Date.now() - delivery.startedAt : 0);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [delivery.startedAt]);

  const mins = Math.floor(elapsed / 60_000);
  const hrs = Math.floor(mins / 60);
  const dur = hrs > 0 ? `${hrs}h ${mins - hrs * 60}m` : `${mins}m`;
  const arrived = delivery.stops.filter(s => s.arrivedAt).length;
  const completed = delivery.stops.filter(s => s.completedAt).length;
  const exceptions = delivery.stops.filter(s => s.isException).length;
  const nextStop = delivery.stops.find(s => !s.arrivedAt);
  const runValue = delivery.stops.reduce((sum, stop) =>
    sum + allJobs.filter(j => stop.jobIds.includes(j.id)).reduce((a, j) => a + (j.quoteAmount || 0), 0), 0);

  return (
    <div className="bg-gradient-to-br from-emerald-500/10 via-amber-500/5 to-transparent border-2 border-emerald-500/30 rounded-2xl p-4 sm:p-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0 animate-pulse">
            <Truck className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black text-emerald-400 uppercase tracking-widest flex items-center gap-2">
              ● Live Run
              {exceptions > 0 && <span className="text-red-400 bg-red-500/15 border border-red-500/30 rounded px-1.5 py-0 text-[9px] normal-case tracking-normal">{exceptions} exception{exceptions > 1 ? 's' : ''}</span>}
            </p>
            <p className="text-lg font-black text-white tracking-tight truncate">{delivery.runNumber} · {delivery.driverName}</p>
            <div className="flex items-center gap-2 flex-wrap">
              {nextStop && <p className="text-[10px] text-zinc-400 truncate">Next: {nextStop.vendorName || nextStop.customerName || nextStop.address}</p>}
              {runValue > 0 && <p className="text-[10px] text-emerald-400 font-bold">${runValue >= 1000 ? (runValue/1000).toFixed(1)+'k' : runValue.toFixed(0)} in parts</p>}
            </div>
          </div>
        </div>
        <button type="button" onClick={onEditDetails} className="text-[10px] font-bold text-blue-400 hover:text-white shrink-0">Edit details</button>
      </div>

      {/* Live stats */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <div className="bg-zinc-950/40 border border-white/5 rounded-xl p-2.5 text-center">
          <p className="text-[9px] font-black text-white/40 uppercase tracking-widest">Miles</p>
          {onSetMiles ? (
            <button type="button" onClick={() => setMilesDraft(liveMiles.toFixed(1))} title="Correct the miles (e.g. GPS lost signal)"
              className="text-lg font-black text-blue-400 tabular underline decoration-dotted decoration-blue-400/40 underline-offset-4">
              {formatMiles(liveMiles)}
            </button>
          ) : (
            <p className="text-lg font-black text-blue-400 tabular" title="Counted by the GPS on the driver's phone — fix it after the run if needed">{formatMiles(liveMiles)}</p>
          )}
        </div>
        <div className="bg-zinc-950/40 border border-white/5 rounded-xl p-2.5 text-center">
          <p className="text-[9px] font-black text-white/40 uppercase tracking-widest">Time</p>
          <p className="text-lg font-black text-emerald-400 tabular">{dur}</p>
        </div>
        <div className="bg-zinc-950/40 border border-white/5 rounded-xl p-2.5 text-center">
          <p className="text-[9px] font-black text-white/40 uppercase tracking-widest">Arrived</p>
          <p className="text-lg font-black text-amber-400 tabular">{arrived}/{delivery.stops.length}</p>
        </div>
        <div className="bg-zinc-950/40 border border-white/5 rounded-xl p-2.5 text-center">
          <p className="text-[9px] font-black text-white/40 uppercase tracking-widest">Done</p>
          <p className="text-lg font-black text-purple-400 tabular">{completed}/{delivery.stops.length}</p>
        </div>
      </div>

      {/* Hand-typed miles — GPS lost signal, or the phone was off for part of the run */}
      {onSetMiles && milesDraft !== null && (
        <form onSubmit={submitMiles} className="flex items-center gap-2 flex-wrap bg-zinc-950/40 border border-blue-500/20 rounded-xl p-2.5 mb-4">
          <label htmlFor="live-miles" className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Miles so far</label>
          <input id="live-miles" type="number" inputMode="decimal" step="0.1" min="0" autoFocus value={milesDraft}
            onChange={e => setMilesDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setMilesDraft(null); }}
            className="w-24 bg-zinc-950 border border-white/10 rounded-lg px-2 py-1 text-sm text-white tabular" />
          <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg">Set</button>
          <button type="button" onClick={() => setMilesDraft(null)} className="text-zinc-500 hover:text-white text-xs font-bold px-2 py-1.5">Cancel</button>
          <p className="w-full text-[10px] text-zinc-500">GPS keeps adding from the figure you enter.</p>
        </form>
      )}

      {/* Stop list */}
      <div className="space-y-2 mb-4">
        {delivery.stops.map((stop, i) => (
          <ActiveStopRow
            key={stop.id}
            stop={stop}
            index={i}
            jobs={jobs}
            onUpdate={(patch) => onUpdateStop(stop.id, patch)}
            photoBudget={() => photoBudget(stop.id)}
            addToast={addToast}
          />
        ))}
      </div>

      {/* Open in Maps — all stops in one Google Maps URL */}
      {delivery.stops.length > 0 && (
        <a
          href={`https://www.google.com/maps/dir/${delivery.stops.map(s => encodeURIComponent(s.address)).join('/')}`}
          target="_blank" rel="noreferrer"
          className="flex items-center justify-center gap-2 w-full text-xs font-bold text-zinc-400 hover:text-amber-400 py-2 border border-white/5 rounded-xl hover:bg-amber-500/5 transition-all mb-3"
        >
          <Route className="w-3.5 h-3.5" /> Open Full Route in Maps
        </a>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 pt-3 border-t border-white/5">
        <button type="button" onClick={onFinish} disabled={busy}
          className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white px-4 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> {busy ? 'Saving…' : 'Finish Run'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}
          className="bg-zinc-800 hover:bg-red-500/20 disabled:opacity-60 border border-white/10 hover:border-red-500/40 text-zinc-400 hover:text-red-400 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2">
          <X className="w-4 h-4" /> Cancel
        </button>
      </div>
    </div>
  );
};

// ── Active stop row (during live run) ────────────────────────────────────
const ActiveStopRow: React.FC<{
  stop: DeliveryStop;
  index: number;
  jobs: Job[];
  onUpdate: (p: Partial<DeliveryStop>) => Promise<unknown>;
  photoBudget: () => number;
  addToast: Props['addToast'];
}> = ({ stop, index, jobs, onUpdate, photoBudget, addToast }) => {
  const def = stopTypeDef(stop.stopType);
  const arrived = !!stop.arrivedAt;
  const done = !!stop.completedAt;
  // Arrived waits up to 5 s for a GPS fix — a second tap meanwhile saved twice.
  const [saving, setSaving] = useState<'arrived' | 'done' | 'photo' | null>(null);
  const [showPhoto, setShowPhoto] = useState(false);
  const [showExceptionPicker, setShowExceptionPicker] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  const EXCEPTION_REASONS = [
    'Customer not home / facility closed',
    'Partial delivery — quantity mismatch',
    'Parts refused / not accepted',
    'Damaged in transit',
    'Wrong address',
    'Vendor not ready — will reschedule',
    'Access denied',
    'Other issue',
  ];

  const markArrived = async () => {
    if (arrived || saving) return;
    setSaving('arrived');
    const patch: Partial<DeliveryStop> = { arrivedAt: Date.now() };
    const pos = await new Promise<GeolocationPosition | null>(res => {
      if (!navigator.geolocation) { res(null); return; }
      // Own deadline too: the 5 s timeout doesn't run while a permission prompt is open.
      const t = setTimeout(() => res(null), 6000);
      navigator.geolocation.getCurrentPosition(p => { clearTimeout(t); res(p); }, () => { clearTimeout(t); res(null); }, { timeout: 5000 });
    });
    if (pos) { patch.arrivalLat = pos.coords.latitude; patch.arrivalLon = pos.coords.longitude; }
    try { await onUpdate(patch); } finally { setSaving(null); }
  };

  const markDone = async () => {
    if (!arrived || done || saving) return;
    setSaving('done');
    try { await onUpdate({ completedAt: Date.now() }); } finally { setSaving(null); }
  };

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    // The photo is stored inside the run's ONE record with every other stop's
    // photo (no cloud storage on the free plan, 1 MB cap) — so it gets its
    // share of the room that's left, not a whole-record budget. Only say saved
    // once the save resolves.
    setSaving('photo');
    try {
      const budget = photoBudget();
      if (budget < MIN_STOP_PHOTO) { addToast('error', "No room left on this run for another photo — its record is full"); return; }
      const photoUrl = await shrinkImage(file, budget);
      const r = await onUpdate({ photoUrl });
      if (r === 'failed') return;   // the save error is already on screen
      addToast('success', r === 'queued' ? '📸 Photo saved on this phone — will sync' : '📸 Proof of delivery photo saved');
    } catch (err: any) {
      addToast('error', err?.message || 'Could not read that photo');
    } finally {
      setSaving(null);
      input.value = '';   // let the same photo be picked again after a failure
    }
  };

  const linkedJobs = jobs.filter(j => stop.jobIds.includes(j.id));

  const isException = stop.isException;

  return (
    <div className={`rounded-xl border transition-all overflow-hidden ${
      isException ? 'bg-red-500/8 border-red-500/30' :
      done ? 'bg-emerald-500/5 border-emerald-500/20' :
      arrived ? `${def.bgClass} ${def.borderClass}` :
      'bg-zinc-900/40 border-white/5'
    }`}>
      <div className="flex items-center gap-2 p-2.5">
        {/* Number / status dot */}
        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
          isException ? 'bg-red-500 text-white' :
          done ? 'bg-emerald-500 text-white' :
          arrived ? 'bg-amber-500 text-white' :
          'bg-zinc-800 text-zinc-400 border border-white/10'
        }`}>
          {isException ? '!' : done ? '✓' : index + 1}
        </span>

        {/* Stop info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <StopTypeBadge type={stop.stopType} size="xs" />
            <p className="text-sm font-bold text-white truncate">
              {stop.vendorName || stop.customerName || stop.address}
            </p>
          </div>
          {(stop.vendorName || stop.customerName) && (
            <p className="text-[10px] text-zinc-500 truncate">{stop.address}</p>
          )}
          {linkedJobs.length > 0 && (
            <p className="text-[10px] text-zinc-600 truncate">
              {linkedJobs.map(j => j.poNumber).join(', ')}
              {linkedJobs.some(j => j.quoteAmount) && (
                <span className="text-emerald-500 ml-1">
                  · ${linkedJobs.reduce((a,j)=>a+(j.quoteAmount||0),0) >= 1000
                    ? (linkedJobs.reduce((a,j)=>a+(j.quoteAmount||0),0)/1000).toFixed(1)+'k'
                    : linkedJobs.reduce((a,j)=>a+(j.quoteAmount||0),0).toFixed(0)}
                </span>
              )}
            </p>
          )}
          {isException && stop.exceptionReason && (
            <p className="text-[10px] text-red-400 font-bold mt-0.5">⚠ {stop.exceptionReason}</p>
          )}
          {done && !isException && <p className="text-[10px] text-emerald-400">✓ Done {new Date(stop.completedAt!).toLocaleTimeString()}</p>}
          {arrived && !done && !isException && <p className="text-[10px] text-amber-400">Arrived {new Date(stop.arrivedAt!).toLocaleTimeString()}</p>}
        </div>

        {/* Navigation button */}
        <a href={directionsUrl(stop.address)} target="_blank" rel="noreferrer"
          className="p-1.5 text-amber-400 hover:bg-amber-500/10 rounded-lg shrink-0">
          <Navigation className="w-4 h-4" />
        </a>

        {/* Flag exception button (available once arrived) */}
        {arrived && !done && !isException && (
          <button type="button" onClick={() => setShowExceptionPicker(v => !v)}
            title="Flag an issue at this stop"
            className="p-1.5 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg shrink-0 transition-colors">
            <Flag className="w-3.5 h-3.5" />
          </button>
        )}
        {isException && (
          <button type="button" onClick={() => onUpdate({ isException: false, exceptionReason: undefined })}
            title="Clear exception flag"
            className="text-[10px] font-bold text-red-400 hover:text-white bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 px-2 py-1 rounded-lg transition-colors shrink-0">
            Clear Flag
          </button>
        )}

        {/* Arrived / Done buttons */}
        {!arrived && !isException && (
          <button type="button" onClick={markArrived} disabled={!!saving}
            className="bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg whitespace-nowrap shrink-0">
            {saving === 'arrived' ? 'Saving…' : 'Arrived'}
          </button>
        )}
        {arrived && !done && !isException && (
          <button type="button" onClick={markDone} disabled={!!saving}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg whitespace-nowrap shrink-0">
            {saving === 'done' ? 'Saving…' : 'Done ✓'}
          </button>
        )}
      </div>

      {/* Exception reason picker */}
      {showExceptionPicker && (
        <div className="border-t border-red-500/20 bg-red-500/5 px-2.5 py-2">
          <p className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-1.5">What happened?</p>
          <div className="flex flex-wrap gap-1.5">
            {EXCEPTION_REASONS.map(reason => (
              <button key={reason} type="button"
                onClick={() => {
                  onUpdate({ isException: true, exceptionReason: reason, arrivedAt: stop.arrivedAt || Date.now() });
                  setShowExceptionPicker(false);
                }}
                className="text-[10px] font-bold text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 px-2 py-1 rounded-lg transition-colors">
                {reason}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Photo proof area — shows after arrived */}
      {arrived && (
        <div className="px-2.5 pb-2.5 flex items-center gap-2 flex-wrap">
          <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />
          {stop.photoUrl ? (
            <div className="flex items-center gap-2">
              <img src={stop.photoUrl} alt="POD" className="w-10 h-10 rounded-lg object-cover border border-emerald-500/30" onClick={() => setShowPhoto(!showPhoto)} />
              <span className="text-[10px] text-emerald-400 font-bold">📸 Photo on file</span>
            </div>
          ) : (
            <button type="button" onClick={() => photoRef.current?.click()} disabled={saving === 'photo'}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 disabled:opacity-60 flex items-center gap-1 border border-dashed border-white/10 hover:border-white/20 rounded-lg px-2.5 py-1.5 transition-colors">
              <Camera className="w-3 h-3" /> {saving === 'photo' ? 'Saving photo…' : 'Add proof photo'}
            </button>
          )}
          {stop.signedBy ? (
            <span className="text-[10px] text-zinc-500">Signed: {stop.signedBy}</span>
          ) : arrived && (
            <input
              type="text"
              placeholder="Received by (optional)"
              defaultValue={stop.signedBy || ''}
              // Only a real name — focusing and leaving it blank used to rewrite every stop for nothing.
              onBlur={e => { const v = e.target.value.trim(); if (v && v !== (stop.signedBy || '')) void onUpdate({ signedBy: v }); }}
              className="flex-1 min-w-0 bg-zinc-950/60 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
            />
          )}
        </div>
      )}
    </div>
  );
};

// ── History list ──────────────────────────────────────────────────────────
const HistoryList: React.FC<{
  deliveries: Delivery[];
  jobs: Job[];
  onDelete: (d: Delivery) => void;
  onEdit: (d: Delivery) => void;
  addToast: Props['addToast'];
}> = ({ deliveries, jobs, onDelete, onEdit }) => {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (deliveries.length === 0) {
    return (
      <div className="bg-gradient-to-br from-amber-500/5 via-orange-500/5 to-transparent border border-white/10 rounded-2xl p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
            <Truck className="w-6 h-6 text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base sm:text-lg font-black text-white">Build your first delivery run</h3>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Track customer drop-offs, vendor drop-offs, and vendor pickups in a single run. Miles auto-logged via GPS — IRS deduction-ready at year-end.
            </p>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {STOP_TYPES.slice(0, 3).map(t => (
                <div key={t.value} className={`rounded-xl border p-3 ${t.bgClass} ${t.borderClass}`}>
                  <div className={`flex items-center gap-1.5 font-black text-xs mb-1 ${t.colorClass}`}>{t.icon} {t.label}</div>
                  <p className="text-[10px] text-zinc-500">{t.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest px-1">History — {deliveries.length} run{deliveries.length !== 1 ? 's' : ''}</p>
      {deliveries.map(d => {
        const cancelled = d.status === 'cancelled';
        const customerStops = d.stops.filter(s => s.stopType === 'customer-dropoff' || (!s.stopType && s.customerName));
        const vendorStops = d.stops.filter(s => s.stopType === 'vendor-dropoff' || s.stopType === 'vendor-pickup');
        const exStops = d.stops.filter(s => s.isException);
        const isExpanded = expanded === d.id;
        const runValue = d.stops.reduce((sum, stop) =>
          sum + jobs.filter(j => stop.jobIds.includes(j.id)).reduce((a, j) => a + (j.quoteAmount || 0), 0), 0);
        const irsValue = (d.milesDriven || 0) * ((d.mileageRateCents || IRS_MILEAGE_RATE_CENTS_2025) / 100);
        return (
          <div key={d.id} className={`group bg-zinc-900/50 border rounded-2xl overflow-hidden hover:border-white/10 transition-all ${cancelled ? 'opacity-60 border-white/5' : exStops.length > 0 ? 'border-red-500/20' : 'border-white/5'}`}>
            {/* Main row */}
            <div className="flex items-center gap-3 p-3 sm:p-4">
              <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${cancelled ? 'bg-red-500/10 text-red-400' : exStops.length > 0 ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                {cancelled ? <X className="w-5 h-5" /> : exStops.length > 0 ? <AlertTriangle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
              </div>

              <button type="button" onClick={() => onEdit(d)} className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-black text-white tabular text-sm sm:text-base">{d.runNumber}</span>
                  {cancelled && <span className="text-[9px] font-black text-red-400 bg-red-500/10 border border-red-500/25 rounded px-1.5 py-0.5">CANCELLED</span>}
                  {exStops.length > 0 && <span className="text-[9px] font-black text-red-400 bg-red-500/10 border border-red-500/25 rounded px-1.5 py-0.5">{exStops.length} exception{exStops.length > 1 ? 's' : ''}</span>}
                  {customerStops.length > 0 && (
                    <span className="text-[9px] font-black text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded px-1.5 py-0.5">{customerStops.length} cust</span>
                  )}
                  {vendorStops.length > 0 && (
                    <span className="text-[9px] font-black text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded px-1.5 py-0.5">{vendorStops.length} vendor</span>
                  )}
                  {runValue > 0 && (
                    <span className="text-[9px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-0.5">
                      ${runValue >= 1000 ? (runValue/1000).toFixed(1)+'k' : runValue.toFixed(0)}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
                  {d.driverName} · {d.startedAt ? new Date(d.startedAt).toLocaleDateString() : '—'} · {d.stops.length} stop{d.stops.length !== 1 ? 's' : ''}
                </div>
              </button>

              {/* Miles + IRS deduction */}
              <div className="shrink-0 text-right flex flex-col items-end gap-1">
                <p className="text-sm sm:text-base font-black text-blue-400 tabular">{formatMiles(d.milesDriven || 0)}</p>
                {d.estimatedMiles && !d.milesDriven && (
                  <p className="text-[10px] text-zinc-600 tabular">~{formatMiles(d.estimatedMiles)} est</p>
                )}
                {irsValue > 0 && <p className="text-[10px] text-amber-500/70 tabular">${irsValue.toFixed(2)} deduct</p>}
                {d.durationMinutes ? (
                  <p className="text-[10px] text-zinc-500 tabular">{d.durationMinutes < 60 ? `${d.durationMinutes}m` : `${(d.durationMinutes / 60).toFixed(1)}h`}</p>
                ) : null}
              </div>

              <button type="button" onClick={() => setExpanded(isExpanded ? null : d.id)}
                className="shrink-0 p-1.5 text-zinc-600 hover:text-zinc-300 transition-colors">
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              <button type="button" onClick={() => onDelete(d)} aria-label={`Delete ${d.runNumber}`}
                className="shrink-0 text-zinc-600 hover:text-red-400 p-1.5 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Expanded stop detail */}
            {isExpanded && (
              <div className="border-t border-white/5 px-3 sm:px-4 pb-3 pt-2 space-y-1.5">
                {d.stops.map((stop, i) => {
                  const def2 = stopTypeDef(stop.stopType);
                  const linkedJobs = jobs.filter(j => stop.jobIds.includes(j.id));
                  const stopValue = linkedJobs.reduce((a, j) => a + (j.quoteAmount || 0), 0);
                  return (
                    <div key={stop.id} className={`flex items-start gap-2 rounded-lg p-2 ${stop.isException ? 'bg-red-500/8 border border-red-500/20' : def2.bgClass}`}>
                      <span className={`text-[10px] font-black w-5 h-5 flex items-center justify-center rounded-full shrink-0 ${
                        stop.isException ? 'bg-red-500 text-white' :
                        stop.completedAt ? 'bg-emerald-500 text-white' :
                        stop.arrivedAt ? 'bg-amber-500 text-white' : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {stop.isException ? '!' : stop.completedAt ? '✓' : i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <StopTypeBadge type={stop.stopType} size="xs" />
                          <span className="text-xs font-bold text-white truncate">{stop.vendorName || stop.customerName || stop.address}</span>
                          {stopValue > 0 && <span className="text-[9px] font-black text-emerald-400">${stopValue >= 1000 ? (stopValue/1000).toFixed(1)+'k' : stopValue.toFixed(0)}</span>}
                        </div>
                        {(stop.vendorName || stop.customerName) && <p className="text-[10px] text-zinc-600 truncate">{stop.address}</p>}
                        {linkedJobs.length > 0 && <p className="text-[10px] text-zinc-600">{linkedJobs.map(j => `${j.poNumber}`).join(', ')}</p>}
                        {stop.isException && stop.exceptionReason && <p className="text-[10px] text-red-400 font-bold mt-0.5">⚠ {stop.exceptionReason}</p>}
                        {stop.signedBy && <p className="text-[10px] text-zinc-500">Signed: {stop.signedBy}</p>}
                        {stop.notes && <p className="text-[10px] text-zinc-500 italic">{stop.notes}</p>}
                      </div>
                      {stop.photoUrl && <img src={stop.photoUrl} alt="POD" className="w-8 h-8 rounded object-cover shrink-0" />}
                    </div>
                  );
                })}
                {d.notes && <p className="text-[10px] text-zinc-500 italic pt-1">Note: {d.notes}</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Delivery editor (create + edit) ──────────────────────────────────────
const DeliveryEditor: React.FC<{
  existing: Delivery | null;
  drivers: User[];
  jobs: Job[];
  vendors: Vendor[];
  allRuns: Delivery[];
  settings: SystemSettings;
  allCustomers: string[];
  currentUser: Props['user'];
  onCancel: () => void;
  /** Resolves true once saved (the parent closes the editor); false leaves it open to retry. */
  onSave: (edited: Delivery, opened: Delivery | null, updatedContacts?: Record<string, CustomerContact>) => Promise<boolean>;
  addToast: Props['addToast'];
}> = ({ existing, drivers, jobs, vendors, allRuns, settings, allCustomers, currentUser, onCancel, onSave, addToast }) => {
  // What "changed" is measured against: the run as it was when the editor opened.
  const [opened] = useState(existing);
  // One id per editor session — a retry after a failed save re-saves the same
  // run instead of creating a duplicate.
  const [newId] = useState(() => `del_${Date.now()}`);
  const [createdAt] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const { confirm, ConfirmHost } = useConfirm();
  const [runNumber, setRunNumber] = useState(opened?.runNumber || DB.nextDeliveryRunNumber(allRuns));
  const [driverId, setDriverId] = useState(opened?.driverId || currentUser.id);
  const [notes, setNotes] = useState(opened?.notes || '');
  const [stops, setStops] = useState<DeliveryStop[]>(opened?.stops || []);
  const [estimating, setEstimating] = useState(false);
  const [estimatedMiles, setEstimatedMiles] = useState<number | null>(opened?.estimatedMiles || null);
  // Miles can be fixed by hand once a run is over (GPS lost, phone died).
  // A live run's miles belong to the GPS phone — corrected on the run card there.
  const milesEditable = !!opened && (opened.status === 'delivered' || opened.status === 'cancelled');
  const initialMilesText = opened?.milesDriven != null ? String(Math.round(opened.milesDriven * 10) / 10) : '';
  const [milesText, setMilesText] = useState(initialMilesText);
  const [initialForm] = useState(() => ({ runNumber, driverId, notes, stops, estimatedMiles, milesText }));
  const isDirty = () => hasChanges(initialForm, { runNumber, driverId, notes, stops, estimatedMiles, milesText });

  const driver = drivers.find(u => u.id === driverId);
  const clientContacts = settings.clientContacts || {};
  const activeJobs = useMemo(() => jobs.filter(j => j.status !== 'completed'), [jobs]);

  const addStop = (type: StopType = 'customer-dropoff') => {
    setStops(prev => [...prev, { id: `stop_${Date.now()}_${prev.length}`, stopType: type, address: '', jobIds: [] }]);
  };

  const updateStop = useCallback((idx: number, patch: Partial<DeliveryStop>) => {
    setStops(prev => {
      const next = [...prev];
      const merged = { ...next[idx], ...patch };
      // Auto-fill address from customer or vendor when entity name changes
      if (patch.customerName && patch.customerName !== next[idx].customerName) {
        const saved = clientContacts[patch.customerName];
        if (saved?.address && !merged.address.trim()) merged.address = saved.address;
      }
      if (patch.vendorName && patch.vendorName !== next[idx].vendorName) {
        const v = vendors.find(vv => vv.name === patch.vendorName);
        if (v?.address && !merged.address.trim()) merged.address = v.address;
      }
      next[idx] = merged;
      return next;
    });
  }, [clientContacts, vendors]);

  const removeStop = (idx: number) => setStops(prev => prev.filter((_, i) => i !== idx));
  const moveStop = (idx: number, dir: -1 | 1) => {
    setStops(prev => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const handleEstimateMiles = async () => {
    const addresses = stops.map(s => s.address).filter(a => a.trim().length > 5);
    if (addresses.length < 2) { addToast('error', 'Need at least 2 addresses to estimate route'); return; }
    setEstimating(true);
    addToast('info', '🗺 Estimating route… (geocoding addresses)');
    try {
      const miles = await estimateRouteFromAddresses(addresses);
      if (miles !== null) {
        setEstimatedMiles(miles);
        addToast('success', `✅ Route estimate: ${formatMiles(miles)}`);
      } else {
        addToast('error', 'Could not estimate route — check addresses');
      }
    } finally {
      setEstimating(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;   // a double tap created the run twice
    if (!runNumber.trim()) { addToast('error', 'The run needs a run #.'); return; }
    if (stops.length === 0) { addToast('error', 'Add at least one stop.'); return; }
    if (stops.some(s => !s.address.trim())) { addToast('error', 'All stops need an address.'); return; }
    const milesChanged = milesEditable && milesText.trim() !== initialMilesText;
    const typedMiles = milesText.trim() === '' ? undefined : parseFloat(milesText);
    if (milesChanged && typedMiles !== undefined && (!Number.isFinite(typedMiles) || typedMiles < 0 || typedMiles > 5000)) {
      addToast('error', 'Miles driven must be a number, e.g. 42.5'); return;
    }

    // Save-back: persist new addresses into clientContacts for future auto-fill
    // Only the NEW entries — the caller saves each one on its own (re-saving the
    // whole contact book could undo another device's just-added contact).
    let updatedContacts: Record<string, CustomerContact> | undefined;
    for (const s of stops) {
      if (!s.customerName || !s.address.trim()) continue;
      const existing = clientContacts[s.customerName];
      if (!existing?.address) {
        updatedContacts = updatedContacts || {};
        updatedContacts[s.customerName] = { name: s.customerName, ...(existing || {}), address: s.address };
      }
    }

    // Everything this form doesn't edit comes from the OPENED copy, so it
    // compares equal and isn't sent — the caller saves only what the user changed.
    const delivery: Delivery = {
      ...(opened || {}),
      id: opened?.id || newId,
      runNumber: runNumber.trim(),
      driverId,
      driverName: driver?.name || opened?.driverName || currentUser.name,
      status: opened?.status || 'scheduled',
      stops: stops.map(s => ({ ...s, jobIds: s.jobIds || [] })),
      milesDriven: milesChanged ? (typedMiles === undefined ? undefined : Math.round(typedMiles * 100) / 100) : opened?.milesDriven,
      estimatedMiles: estimatedMiles ?? opened?.estimatedMiles,
      notes,
      createdAt: opened?.createdAt || createdAt,
      updatedAt: Date.now(),
    };
    setSaving(true);
    try { await onSave(delivery, opened, updatedContacts); }
    finally { setSaving(false); }
  };

  // Backdrop, Esc, ✕ and Cancel all come here — unsaved edits used to vanish silently.
  const closingRef = useRef(false);
  const requestClose = async () => {
    if (saving || closingRef.current) return;
    if (isDirty()) {
      closingRef.current = true;
      const ok = await confirm({ title: 'Discard unsaved changes?', message: `Your changes to ${runNumber || 'this run'} haven't been saved.`, tone: 'warning', confirmLabel: 'Discard', cancelLabel: 'Keep editing' });
      closingRef.current = false;
      if (!ok) return;
    }
    onCancel();
  };

  // Stop type quick-add buttons
  const quickAddTypes: Array<{ type: StopType; label: string; color: string }> = [
    { type: 'customer-dropoff', label: '+ Customer Drop', color: 'text-amber-400 border-amber-500/30 hover:bg-amber-500/10' },
    { type: 'vendor-dropoff', label: '+ Vendor Drop', color: 'text-orange-400 border-orange-500/30 hover:bg-orange-500/10' },
    { type: 'vendor-pickup', label: '+ Vendor Pickup', color: 'text-purple-400 border-purple-500/30 hover:bg-purple-500/10' },
    { type: 'other', label: '+ Other Stop', color: 'text-zinc-400 border-white/10 hover:bg-zinc-800' },
  ];

  return (
    <Modal
      open
      onClose={requestClose}
      title={opened ? 'Edit Run' : 'New Delivery Run'}
      icon={<Truck className="w-4 h-4 text-amber-400" />}
      footer={
        <div className="flex items-center gap-2 w-full">
          <button type="button" onClick={requestClose} disabled={saving} className="text-zinc-500 hover:text-white disabled:opacity-50 text-xs font-bold px-3 py-2">Cancel</button>
          <div className="flex-1" />
          {estimatedMiles && (
            <span className="text-[10px] text-zinc-500 flex items-center gap-1">
              <Route className="w-3 h-3" /> {formatMiles(estimatedMiles)} est
            </span>
          )}
          <button type="button" onClick={handleSave} disabled={saving}
            className="bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white px-6 py-2.5 rounded-lg text-sm font-bold">
            {saving ? 'Saving…' : opened ? 'Save Changes' : 'Create Run'}
          </button>
        </div>
      }
    >
      {ConfirmHost}
      {/* Run # + Driver */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Run #</label>
          <input type="text" value={runNumber} onChange={e => setRunNumber(e.target.value)}
            className="w-full bg-zinc-950 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white tabular" />
        </div>
        <div>
          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Driver</label>
          <select value={driverId} onChange={e => setDriverId(e.target.value)}
            className="w-full bg-zinc-950 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white">
            {drivers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </div>

      {/* Miles driven — correct a lost / short GPS track after the run */}
      {milesEditable && (
        <div>
          <label htmlFor="run-miles" className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">
            Miles driven <span className="text-zinc-700 normal-case font-normal">(from GPS — fix it here if the track was lost)</span>
          </label>
          <input id="run-miles" type="number" inputMode="decimal" step="0.1" min="0" value={milesText}
            onChange={e => setMilesText(e.target.value)} placeholder="0.0"
            className="w-32 bg-zinc-950 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white tabular" />
        </div>
      )}

      {/* Stops */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Stops ({stops.length})</label>
            {estimatedMiles && <span className="text-[10px] text-blue-400 ml-2 font-bold">~{formatMiles(estimatedMiles)}</span>}
          </div>
          <button type="button" onClick={handleEstimateMiles} disabled={estimating || stops.filter(s => s.address.trim()).length < 2}
            className="text-[10px] text-amber-400 hover:text-white font-bold flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed border border-amber-500/20 hover:border-amber-500/40 px-2 py-1 rounded-lg transition-colors">
            <Route className="w-3 h-3" /> {estimating ? 'Estimating…' : 'Estimate Route'}
          </button>
        </div>

        {/* Quick add buttons */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {quickAddTypes.map(q => (
            <button key={q.type} type="button" onClick={() => addStop(q.type)}
              className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg border transition-all ${q.color}`}>
              {q.label}
            </button>
          ))}
        </div>

        {stops.length === 0 && (
          <p className="text-[11px] italic text-zinc-600 text-center py-6 border border-dashed border-white/5 rounded-xl">
            No stops yet — use the buttons above to add customer drops or vendor stops
          </p>
        )}
        <div className="space-y-3">
          {stops.map((stop, i) => (
            <StopEditorCard
              key={stop.id}
              stop={stop}
              index={i}
              total={stops.length}
              allJobs={activeJobs}
              allCustomers={allCustomers}
              vendors={vendors}
              onChange={patch => updateStop(i, patch)}
              onRemove={() => removeStop(i)}
              onMove={dir => moveStop(i, dir)}
            />
          ))}
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Driver Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          placeholder="Special instructions, gate codes, weight limits…"
          className="w-full bg-zinc-950 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white resize-none" />
      </div>
    </Modal>
  );
};

// ── Stop editor card ──────────────────────────────────────────────────────
const StopEditorCard: React.FC<{
  stop: DeliveryStop;
  index: number;
  total: number;
  allJobs: Job[];
  allCustomers: string[];
  vendors: Vendor[];
  onChange: (p: Partial<DeliveryStop>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}> = ({ stop, index, total, allJobs, allCustomers, vendors, onChange, onRemove, onMove }) => {
  const def = stopTypeDef(stop.stopType);
  const [jobsOpen, setJobsOpen] = useState(false);

  // Jobs relevant to this stop
  const relevantJobs = useMemo(() => {
    if (stop.stopType === 'customer-dropoff' || (!stop.stopType && stop.customerName)) {
      return stop.customerName ? allJobs.filter(j => j.customer === stop.customerName) : allJobs;
    }
    // For vendor stops, show all jobs (you could be dropping any job's parts)
    return allJobs;
  }, [allJobs, stop.stopType, stop.customerName]);

  const selectedCount = stop.jobIds.length;
  const toggleJob = (id: string) => {
    if (stop.jobIds.includes(id)) onChange({ jobIds: stop.jobIds.filter(x => x !== id) });
    else onChange({ jobIds: [...stop.jobIds, id] });
  };

  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${def.borderClass} ${def.bgClass}`}>
      {/* Stop header */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        {/* Order number */}
        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${def.colorClass} border ${def.borderClass}`}>
          {index + 1}
        </span>

        {/* Stop type selector */}
        <div className="flex gap-1 flex-wrap flex-1">
          {STOP_TYPES.map(t => (
            <button key={t.value} type="button"
              onClick={() => onChange({ stopType: t.value, customerName: t.value === 'customer-dropoff' ? stop.customerName : undefined, vendorName: t.value !== 'customer-dropoff' ? stop.vendorName : undefined })}
              className={`text-[9px] font-black px-2 py-1 rounded-lg border transition-all flex items-center gap-0.5 ${stop.stopType === t.value ? `${t.colorClass} ${t.bgClass} ${t.borderClass}` : 'text-zinc-600 border-white/5 hover:text-zinc-400'}`}>
              {t.icon} {t.shortLabel}
            </button>
          ))}
        </div>

        {/* Move up/down */}
        <div className="flex gap-0.5 shrink-0">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0}
            className="p-1 text-zinc-600 hover:text-zinc-300 disabled:opacity-30 transition-colors">
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={index === total - 1}
            className="p-1 text-zinc-600 hover:text-zinc-300 disabled:opacity-30 transition-colors">
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Remove */}
        <button type="button" onClick={onRemove} className="text-zinc-600 hover:text-red-400 p-1 shrink-0 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Entity selector */}
      <div className="px-3 pb-2 space-y-2">
        {(stop.stopType === 'customer-dropoff' || !stop.stopType) && (
          <div>
            <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Customer</label>
            <select value={stop.customerName || ''} onChange={e => onChange({ customerName: e.target.value })}
              className="w-full bg-zinc-950 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white">
              <option value="">— Select customer —</option>
              {allCustomers.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
        {(stop.stopType === 'vendor-dropoff' || stop.stopType === 'vendor-pickup') && (
          <div>
            <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Vendor</label>
            <select value={stop.vendorName || ''} onChange={e => onChange({ vendorName: e.target.value })}
              className="w-full bg-zinc-950 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white">
              <option value="">— Select vendor —</option>
              {vendors.map(v => <option key={v.id} value={v.name}>{v.name}{v.categories?.length ? ` · ${v.categories.slice(0, 2).join(', ')}` : ''}</option>)}
              <option value="__other__">Other / Not listed</option>
            </select>
          </div>
        )}

        {/* Address */}
        <div>
          <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block mb-1">
            Address <span className="text-zinc-700 normal-case font-normal">(auto-filled from saved contacts)</span>
          </label>
          <input type="text" placeholder="123 Industrial Blvd, City, ST 12345"
            value={stop.address} onChange={e => onChange({ address: e.target.value })}
            className="w-full bg-zinc-950 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white" />
          {stop.address.trim().length > 5 && (
            <a href={directionsUrl(stop.address)} target="_blank" rel="noreferrer"
              className="text-[9px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5 mt-0.5">
              <Navigation className="w-2.5 h-2.5" /> Open in Maps
            </a>
          )}
        </div>

        {/* Notes for this stop */}
        <input type="text" placeholder="Stop notes (gate code, contact, etc.)" value={stop.notes || ''}
          onChange={e => onChange({ notes: e.target.value })}
          className="w-full bg-zinc-950 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white" />

        {/* Job picker — checkbox chips, collapsible */}
        <div>
          <button type="button" onClick={() => setJobsOpen(p => !p)}
            className={`text-[9px] font-black uppercase tracking-widest flex items-center gap-1 transition-colors ${selectedCount > 0 ? def.colorClass : 'text-zinc-500 hover:text-zinc-300'}`}>
            {jobsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Jobs on this stop
            {selectedCount > 0 && <span className={`ml-1 px-1.5 py-0.5 rounded font-black text-white text-[9px] ${def.bgClass} border ${def.borderClass}`}>{selectedCount} selected</span>}
          </button>

          {/* Selected job pills — always visible */}
          {selectedCount > 0 && !jobsOpen && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {stop.jobIds.map(id => {
                const j = allJobs.find(jj => jj.id === id);
                return j ? (
                  <span key={id} className={`text-[9px] font-bold px-2 py-0.5 rounded border flex items-center gap-1 ${def.colorClass} ${def.bgClass} ${def.borderClass}`}>
                    {j.poNumber}
                    <button type="button" onClick={() => toggleJob(id)} className="hover:text-red-400">×</button>
                  </span>
                ) : null;
              })}
            </div>
          )}

          {jobsOpen && (
            <div className="mt-2 space-y-1.5">
              {relevantJobs.length === 0 ? (
                <p className="text-[10px] text-zinc-600 italic">No open jobs{stop.customerName ? ` for ${stop.customerName}` : ''}</p>
              ) : (
                <>
                  <div className="flex gap-2 mb-1">
                    {selectedCount > 0 && (
                      <button type="button" onClick={() => onChange({ jobIds: [] })}
                        className="text-[9px] text-red-400 hover:text-red-300 flex items-center gap-0.5">
                        <RotateCcw className="w-2.5 h-2.5" /> Clear all
                      </button>
                    )}
                    <button type="button" onClick={() => onChange({ jobIds: relevantJobs.map(j => j.id) })}
                      className="text-[9px] text-zinc-500 hover:text-zinc-300 flex items-center gap-0.5">
                      Select all ({relevantJobs.length})
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                    {relevantJobs.map(j => {
                      const picked = stop.jobIds.includes(j.id);
                      return (
                        <button key={j.id} type="button" onClick={() => toggleJob(j.id)}
                          className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition-all text-left ${picked ? `${def.colorClass} ${def.bgClass} ${def.borderClass}` : 'text-zinc-500 bg-zinc-950 border-white/5 hover:border-white/20 hover:text-zinc-300'}`}>
                          <span className="font-black">{j.poNumber}</span>
                          <span className="text-[9px] opacity-70"> · {j.partNumber}</span>
                          {j.quantity ? <span className="text-[9px] opacity-60"> · {j.quantity}pc</span> : null}
                          {j.customer && stop.stopType !== 'customer-dropoff' ? <span className="text-[9px] opacity-60"> · {j.customer}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
