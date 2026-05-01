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
  RotateCcw,
} from 'lucide-react';
import type { Delivery, DeliveryStop, StopType, Job, User, SystemSettings, CustomerContact, Vendor } from '../types';
import * as DB from '../services/mockDb';
import { createGpsSession, startTracking, stopTracking, sessionMiles, sessionMinutes, type GpsSession } from '../services/gpsTracker';
import { directionsUrl, formatMiles } from '../utils/geo';
import { fmt, todayFmt } from '../utils/date';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/useConfirm';

const IRS_MILEAGE_RATE_CENTS_2025 = 70; // $0.70/mi — update annually

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const { confirm: confirmDialog, ConfirmHost } = useConfirm();

  useEffect(() => {
    const u1 = DB.subscribeDeliveries(setDeliveries);
    const u2 = DB.subscribeJobs(setJobs);
    const u3 = DB.subscribeUsers(setUsers);
    const u4 = DB.subscribeSettings(setSettings);
    const u5 = DB.subscribeVendors(setVendors);
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, []);

  const gpsRef = useRef<{ id: string; session: GpsSession } | null>(null);
  const [liveMiles, setLiveMiles] = useState(0);

  const active = useMemo(() => deliveries.find(d => d.status === 'in-progress'), [deliveries]);

  useEffect(() => {
    return () => {
      if (gpsRef.current) stopTracking(gpsRef.current.session);
    };
  }, []);

  const beginRun = async (d: Delivery) => {
    const session = createGpsSession();
    gpsRef.current = { id: d.id, session };
    startTracking(
      session,
      () => setLiveMiles(sessionMiles(session)),
      (msg) => addToast('error', `GPS: ${msg}`),
    );
    const updated: Delivery = { ...d, status: 'in-progress', startedAt: Date.now(), mileageRateCents: IRS_MILEAGE_RATE_CENTS_2025 };
    await DB.saveDelivery(updated);
    addToast('success', `🚚 Run ${d.runNumber} started — GPS tracking`);
  };

  const finishRun = async (d: Delivery) => {
    const ref = gpsRef.current;
    let miles = d.milesDriven || 0;
    let minutes = d.durationMinutes || 0;
    let track = d.track || [];
    if (ref && ref.id === d.id) {
      stopTracking(ref.session);
      miles = sessionMiles(ref.session);
      minutes = sessionMinutes(ref.session);
      track = ref.session.points.map(p => ({ lat: p.lat, lon: p.lon, t: p.t || 0, acc: p.acc }));
      gpsRef.current = null;
    } else if (d.startedAt) {
      minutes = Math.round((Date.now() - d.startedAt) / 60_000);
    }
    const updated: Delivery = { ...d, status: 'delivered', endedAt: Date.now(), milesDriven: miles, durationMinutes: minutes, track };
    await DB.saveDelivery(updated);
    setLiveMiles(0);
    addToast('success', `✅ Run ${d.runNumber} complete · ${formatMiles(miles)}`);
  };

  const cancelRun = async (d: Delivery) => {
    const ok = await confirmDialog({ title: 'Cancel this delivery?', message: 'GPS track will be discarded. Run marked cancelled.', tone: 'warning', confirmLabel: 'Cancel run', cancelLabel: 'Keep running' });
    if (!ok) return;
    if (gpsRef.current?.id === d.id) { stopTracking(gpsRef.current.session); gpsRef.current = null; }
    await DB.saveDelivery({ ...d, status: 'cancelled', endedAt: Date.now() });
    addToast('info', `Cancelled ${d.runNumber}`);
  };

  const deleteRun = async (d: Delivery) => {
    const ok = await confirmDialog({ title: `Delete run ${d.runNumber}?`, message: "Can't be undone. Mileage log entry removed.", tone: 'danger', confirmLabel: 'Delete' });
    if (!ok) return;
    await DB.deleteDelivery(d.id);
    addToast('info', 'Deleted');
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Miles This Month" value={formatMiles(milesMonth)} hint={milesMonth > 0 ? `~$${mileageDeductible.toFixed(0)} deductible` : 'Log your first run'} color="text-amber-400" icon={<Truck className="w-4 h-4" />} />
        <KpiCard label="Runs (30d)" value={String(runs30)} hint={`${completed.length} all-time`} color="text-emerald-400" icon={<CheckCircle2 className="w-4 h-4" />} />
        <KpiCard label="All-Time Miles" value={formatMiles(totalMilesAll)} hint={`${completed.length} completed`} color="text-blue-400" icon={<Navigation className="w-4 h-4" />} />
        <KpiCard label="Vendors Served" value={String(new Set(completed.flatMap(d => d.stops.map(s => s.vendorName).filter(Boolean))).size)} hint="heat treat, plating, etc." color="text-purple-400" icon={<Building2 className="w-4 h-4" />} />
      </div>

      {/* ── Active run ── */}
      {active && (
        <ActiveRunCard
          delivery={active}
          liveMiles={liveMiles || active.milesDriven || 0}
          jobs={jobs}
          onFinish={() => finishRun(active)}
          onCancel={() => cancelRun(active)}
          onUpdateStop={async (stopId, patch) => {
            const stops = active.stops.map(s => s.id === stopId ? { ...s, ...patch } : s);
            await DB.saveDelivery({ ...active, stops });
          }}
          onEditDetails={() => setEditingId(active.id)}
          addToast={addToast}
        />
      )}

      {/* ── History ── */}
      <HistoryList deliveries={history} jobs={jobs} onDelete={deleteRun} onEdit={(d) => setEditingId(d.id)} addToast={addToast} />

      {/* ── Create modal ── */}
      {creating && (
        <DeliveryEditor
          existing={null} drivers={users} jobs={jobs} vendors={vendors} allRuns={deliveries}
          settings={settings} allCustomers={allCustomers} currentUser={user} addToast={addToast}
          onCancel={() => setCreating(false)}
          onSave={async (d, updatedContacts) => {
            await DB.saveDelivery(d);
            if (updatedContacts) await DB.saveSettings({ ...settings, clientContacts: updatedContacts });
            setCreating(false);
            addToast('success', `Run ${d.runNumber} created — ${d.stops.length} stops`);
          }}
        />
      )}

      {/* ── Edit modal ── */}
      {editingId && (() => {
        const d = deliveries.find(x => x.id === editingId);
        if (!d) return null;
        return (
          <DeliveryEditor
            existing={d} drivers={users} jobs={jobs} vendors={vendors} allRuns={deliveries}
            settings={settings} allCustomers={allCustomers} currentUser={user} addToast={addToast}
            onCancel={() => setEditingId(null)}
            onSave={async (updated, updatedContacts) => {
              await DB.saveDelivery(updated);
              if (updatedContacts) await DB.saveSettings({ ...settings, clientContacts: updatedContacts });
              setEditingId(null);
              addToast('success', `Saved ${updated.runNumber}`);
            }}
          />
        );
      })()}
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
  onFinish: () => void;
  onCancel: () => void;
  onUpdateStop: (stopId: string, patch: Partial<DeliveryStop>) => void;
  onEditDetails: () => void;
  addToast: Props['addToast'];
}> = ({ delivery, liveMiles, jobs, onFinish, onCancel, onUpdateStop, onEditDetails, addToast }) => {
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
  const nextStop = delivery.stops.find(s => !s.arrivedAt);

  return (
    <div className="bg-gradient-to-br from-emerald-500/10 via-amber-500/5 to-transparent border-2 border-emerald-500/30 rounded-2xl p-4 sm:p-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0 animate-pulse">
            <Truck className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black text-emerald-400 uppercase tracking-widest">● Live Run</p>
            <p className="text-lg font-black text-white tracking-tight truncate">{delivery.runNumber} · {delivery.driverName}</p>
            {nextStop && (
              <p className="text-[10px] text-zinc-400 truncate">Next: {nextStop.vendorName || nextStop.customerName || nextStop.address}</p>
            )}
          </div>
        </div>
        <button type="button" onClick={onEditDetails} className="text-[10px] font-bold text-blue-400 hover:text-white shrink-0">Edit details</button>
      </div>

      {/* Live stats */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <div className="bg-zinc-950/40 border border-white/5 rounded-xl p-2.5 text-center">
          <p className="text-[9px] font-black text-white/40 uppercase tracking-widest">Miles</p>
          <p className="text-lg font-black text-blue-400 tabular">{formatMiles(liveMiles)}</p>
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

      {/* Stop list */}
      <div className="space-y-2 mb-4">
        {delivery.stops.map((stop, i) => (
          <ActiveStopRow
            key={stop.id}
            stop={stop}
            index={i}
            jobs={jobs}
            onUpdate={(patch) => onUpdateStop(stop.id, patch)}
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
        <button type="button" onClick={onFinish}
          className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> Finish Run
        </button>
        <button type="button" onClick={onCancel}
          className="bg-zinc-800 hover:bg-red-500/20 border border-white/10 hover:border-red-500/40 text-zinc-400 hover:text-red-400 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2">
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
  onUpdate: (p: Partial<DeliveryStop>) => void;
  addToast: Props['addToast'];
}> = ({ stop, index, jobs, onUpdate, addToast }) => {
  const def = stopTypeDef(stop.stopType);
  const arrived = !!stop.arrivedAt;
  const done = !!stop.completedAt;
  const [showPhoto, setShowPhoto] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  const markArrived = () => {
    if (arrived) return;
    const patch: Partial<DeliveryStop> = { arrivedAt: Date.now() };
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => onUpdate({ ...patch, arrivalLat: pos.coords.latitude, arrivalLon: pos.coords.longitude }),
        () => onUpdate(patch),
        { timeout: 5000 },
      );
    } else {
      onUpdate(patch);
    }
  };

  const markDone = () => {
    if (!arrived || done) return;
    onUpdate({ completedAt: Date.now() });
  };

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onUpdate({ photoUrl: reader.result as string });
      addToast('success', '📸 Proof of delivery photo saved');
    };
    reader.readAsDataURL(file);
  };

  const linkedJobs = jobs.filter(j => stop.jobIds.includes(j.id));

  return (
    <div className={`rounded-xl border transition-all overflow-hidden ${done ? 'bg-emerald-500/5 border-emerald-500/20' : arrived ? `${def.bgClass} ${def.borderClass}` : 'bg-zinc-900/40 border-white/5'}`}>
      <div className="flex items-center gap-2 p-2.5">
        {/* Number / status dot */}
        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${done ? 'bg-emerald-500 text-white' : arrived ? 'bg-amber-500 text-white' : 'bg-zinc-800 text-zinc-400 border border-white/10'}`}>
          {done ? '✓' : index + 1}
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
            <p className="text-[10px] text-zinc-600 truncate">{linkedJobs.map(j => j.poNumber).join(', ')}</p>
          )}
          {done && <p className="text-[10px] text-emerald-400">✓ Done {new Date(stop.completedAt!).toLocaleTimeString()}</p>}
          {arrived && !done && <p className="text-[10px] text-amber-400">Arrived {new Date(stop.arrivedAt!).toLocaleTimeString()}</p>}
        </div>

        {/* Navigation button */}
        <a href={directionsUrl(stop.address)} target="_blank" rel="noreferrer"
          className="p-1.5 text-blue-400 hover:bg-blue-500/10 rounded-lg shrink-0">
          <Navigation className="w-4 h-4" />
        </a>

        {/* Arrived / Done buttons */}
        {!arrived && (
          <button type="button" onClick={markArrived}
            className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg whitespace-nowrap shrink-0">
            Arrived
          </button>
        )}
        {arrived && !done && (
          <button type="button" onClick={markDone}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg whitespace-nowrap shrink-0">
            Done ✓
          </button>
        )}
      </div>

      {/* Photo proof area — shows after arrived */}
      {arrived && (
        <div className="px-2.5 pb-2.5 flex items-center gap-2">
          <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />
          {stop.photoUrl ? (
            <div className="flex items-center gap-2">
              <img src={stop.photoUrl} alt="POD" className="w-10 h-10 rounded-lg object-cover border border-emerald-500/30" onClick={() => setShowPhoto(!showPhoto)} />
              <span className="text-[10px] text-emerald-400 font-bold">📸 Photo on file</span>
            </div>
          ) : (
            <button type="button" onClick={() => photoRef.current?.click()}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1 border border-dashed border-white/10 hover:border-white/20 rounded-lg px-2.5 py-1.5 transition-colors">
              <Camera className="w-3 h-3" /> Add proof photo
            </button>
          )}
          {stop.signedBy ? (
            <span className="text-[10px] text-zinc-500">Signed: {stop.signedBy}</span>
          ) : arrived && (
            <input
              type="text"
              placeholder="Received by (optional)"
              defaultValue={stop.signedBy || ''}
              onBlur={e => onUpdate({ signedBy: e.target.value })}
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
        const isExpanded = expanded === d.id;
        return (
          <div key={d.id} className={`bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden hover:border-white/10 transition-all ${cancelled ? 'opacity-60' : ''}`}>
            {/* Main row */}
            <div className="flex items-center gap-3 p-3 sm:p-4">
              <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${cancelled ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                {cancelled ? <X className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
              </div>

              <button type="button" onClick={() => onEdit(d)} className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-black text-white tabular text-sm sm:text-base">{d.runNumber}</span>
                  {cancelled && <span className="text-[9px] font-black text-red-400 bg-red-500/10 border border-red-500/25 rounded px-1.5 py-0.5">CANCELLED</span>}
                  {/* Stop type breakdown badges */}
                  {customerStops.length > 0 && (
                    <span className="text-[9px] font-black text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded px-1.5 py-0.5">{customerStops.length} cust</span>
                  )}
                  {vendorStops.length > 0 && (
                    <span className="text-[9px] font-black text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded px-1.5 py-0.5">{vendorStops.length} vendor</span>
                  )}
                </div>
                <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
                  {d.driverName} · {d.startedAt ? new Date(d.startedAt).toLocaleDateString() : '—'} · {d.stops.length} stop{d.stops.length !== 1 ? 's' : ''}
                </div>
              </button>

              {/* Miles + expand */}
              <div className="shrink-0 text-right flex flex-col items-end gap-1">
                <p className="text-sm sm:text-base font-black text-blue-400 tabular">{formatMiles(d.milesDriven || 0)}</p>
                {d.estimatedMiles && !d.milesDriven && (
                  <p className="text-[10px] text-zinc-600 tabular">~{formatMiles(d.estimatedMiles)} est</p>
                )}
                {d.durationMinutes ? (
                  <p className="text-[10px] text-zinc-500 tabular">{d.durationMinutes < 60 ? `${d.durationMinutes}m` : `${(d.durationMinutes / 60).toFixed(1)}h`}</p>
                ) : null}
              </div>

              <button type="button" onClick={() => setExpanded(isExpanded ? null : d.id)}
                className="shrink-0 p-1.5 text-zinc-600 hover:text-zinc-300 transition-colors">
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              <button type="button" onClick={() => onDelete(d)} aria-label={`Delete ${d.runNumber}`}
                className="shrink-0 text-zinc-600 hover:text-red-400 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Expanded stop detail */}
            {isExpanded && (
              <div className="border-t border-white/5 px-3 sm:px-4 pb-3 pt-2 space-y-1.5">
                {d.stops.map((stop, i) => {
                  const def = stopTypeDef(stop.stopType);
                  const linkedJobs = jobs.filter(j => stop.jobIds.includes(j.id));
                  return (
                    <div key={stop.id} className={`flex items-start gap-2 rounded-lg p-2 ${def.bgClass}`}>
                      <span className={`text-[10px] font-black w-5 h-5 flex items-center justify-center rounded-full ${stop.completedAt ? 'bg-emerald-500 text-white' : stop.arrivedAt ? 'bg-amber-500 text-white' : 'bg-zinc-800 text-zinc-400'}`}>
                        {stop.completedAt ? '✓' : i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <StopTypeBadge type={stop.stopType} size="xs" />
                          <span className="text-xs font-bold text-white truncate">{stop.vendorName || stop.customerName || stop.address}</span>
                        </div>
                        {(stop.vendorName || stop.customerName) && <p className="text-[10px] text-zinc-600 truncate">{stop.address}</p>}
                        {linkedJobs.length > 0 && <p className="text-[10px] text-zinc-600">{linkedJobs.map(j => `${j.poNumber} · ${j.partNumber}`).join(' · ')}</p>}
                        {stop.signedBy && <p className="text-[10px] text-zinc-500">Signed: {stop.signedBy}</p>}
                      </div>
                      {stop.photoUrl && <img src={stop.photoUrl} alt="POD" className="w-8 h-8 rounded object-cover shrink-0" />}
                    </div>
                  );
                })}
                {d.notes && <p className="text-[10px] text-zinc-500 italic pt-1">{d.notes}</p>}
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
  onSave: (d: Delivery, updatedContacts?: Record<string, CustomerContact>) => void;
  addToast: Props['addToast'];
}> = ({ existing, drivers, jobs, vendors, allRuns, settings, allCustomers, currentUser, onCancel, onSave, addToast }) => {
  const [runNumber, setRunNumber] = useState(existing?.runNumber || DB.nextDeliveryRunNumber(allRuns));
  const [driverId, setDriverId] = useState(existing?.driverId || currentUser.id);
  const [notes, setNotes] = useState(existing?.notes || '');
  const [stops, setStops] = useState<DeliveryStop[]>(existing?.stops || []);
  const [estimating, setEstimating] = useState(false);
  const [estimatedMiles, setEstimatedMiles] = useState<number | null>(existing?.estimatedMiles || null);

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

  const handleSave = () => {
    if (stops.length === 0) { addToast('error', 'Add at least one stop.'); return; }
    if (stops.some(s => !s.address.trim())) { addToast('error', 'All stops need an address.'); return; }

    // Save-back: persist new addresses into clientContacts for future auto-fill
    let updatedContacts: Record<string, CustomerContact> | undefined;
    for (const s of stops) {
      if (!s.customerName || !s.address.trim()) continue;
      const existing = clientContacts[s.customerName];
      if (!existing?.address) {
        updatedContacts = updatedContacts || { ...clientContacts };
        updatedContacts[s.customerName] = { ...(existing || {}), address: s.address };
      }
    }

    const now = Date.now();
    const delivery: Delivery = {
      id: existing?.id || `del_${now}`,
      runNumber,
      driverId,
      driverName: driver?.name || currentUser.name,
      status: existing?.status || 'scheduled',
      stops: stops.map(s => ({ ...s, jobIds: s.jobIds || [] })),
      startedAt: existing?.startedAt,
      endedAt: existing?.endedAt,
      track: existing?.track,
      milesDriven: existing?.milesDriven,
      estimatedMiles: estimatedMiles ?? existing?.estimatedMiles,
      durationMinutes: existing?.durationMinutes,
      mileageRateCents: existing?.mileageRateCents,
      notes,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    onSave(delivery, updatedContacts);
  };

  // Stop type quick-add buttons
  const quickAddTypes: Array<{ type: StopType; label: string; color: string }> = [
    { type: 'customer-dropoff', label: '+ Customer Drop', color: 'text-blue-400 border-blue-500/30 hover:bg-blue-500/10' },
    { type: 'vendor-dropoff', label: '+ Vendor Drop', color: 'text-orange-400 border-orange-500/30 hover:bg-orange-500/10' },
    { type: 'vendor-pickup', label: '+ Vendor Pickup', color: 'text-purple-400 border-purple-500/30 hover:bg-purple-500/10' },
    { type: 'other', label: '+ Other Stop', color: 'text-zinc-400 border-white/10 hover:bg-zinc-800' },
  ];

  return (
    <Modal
      open
      onClose={onCancel}
      title={existing ? 'Edit Run' : 'New Delivery Run'}
      icon={<Truck className="w-4 h-4 text-amber-400" />}
      footer={
        <div className="flex items-center gap-2 w-full">
          <button type="button" onClick={onCancel} className="text-zinc-500 hover:text-white text-xs font-bold px-3 py-2">Cancel</button>
          <div className="flex-1" />
          {estimatedMiles && (
            <span className="text-[10px] text-zinc-500 flex items-center gap-1">
              <Route className="w-3 h-3" /> {formatMiles(estimatedMiles)} est
            </span>
          )}
          <button type="button" onClick={handleSave}
            className="bg-amber-600 hover:bg-amber-500 text-white px-6 py-2.5 rounded-lg text-sm font-bold">
            {existing ? 'Save Changes' : 'Create Run'}
          </button>
        </div>
      }
    >
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
