// ═════════════════════════════════════════════════════════════════════
// DeliveriesView — manage courier runs.
//
// Features:
//   • Create a new run: pick driver, add stops (address + jobs)
//   • Start run → GPS tracking begins, "Open in Maps" link appears
//   • Mark each stop arrived → timestamp + lat/lon captured
//   • Finish run → miles computed, status flips to 'delivered'
//   • History list with total miles + duration
//   • CSV export of the whole table for tax / mileage log
//
// No map-API dependency — "Open in Maps" is a deep-link that opens the
// native Apple / Google Maps app (both accept the same URL format).
// ═════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Truck, Plus, MapPin, Navigation, CheckCircle2, X, Play, StopCircle,
  Trash2, Download, Clock, Users,
} from 'lucide-react';
import type { Delivery, DeliveryStop, Job, User } from '../types';
import * as DB from '../services/mockDb';
import { createGpsSession, startTracking, stopTracking, sessionMiles, sessionMinutes, type GpsSession } from '../services/gpsTracker';
import { directionsUrl, formatMiles } from '../utils/geo';
import { fmt, todayFmt } from '../utils/date';

const IRS_MILEAGE_RATE_CENTS_2025 = 70; // $0.70/mi — update annually

interface Props {
  user: { id: string; name: string; role: string };
  addToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const DeliveriesView: React.FC<Props> = ({ user, addToast }) => {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const u1 = DB.subscribeDeliveries(setDeliveries);
    const u2 = DB.subscribeJobs(setJobs);
    const u3 = DB.subscribeUsers(setUsers);
    return () => { u1(); u2(); u3(); };
  }, []);

  // Live GPS session — kept as a ref so the watch handle survives re-renders.
  const gpsRef = useRef<{ id: string; session: GpsSession } | null>(null);
  const [liveMiles, setLiveMiles] = useState(0);

  const active = useMemo(() => deliveries.find(d => d.status === 'in-progress'), [deliveries]);

  // Stop the tracker when the active delivery ends or unmounts.
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
    const updated: Delivery = {
      ...d,
      status: 'in-progress',
      startedAt: Date.now(),
      mileageRateCents: IRS_MILEAGE_RATE_CENTS_2025,
    };
    await DB.saveDelivery(updated);
    addToast('success', `🚚 Run ${d.runNumber} started — tracking GPS`);
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
    const updated: Delivery = {
      ...d,
      status: 'delivered',
      endedAt: Date.now(),
      milesDriven: miles,
      durationMinutes: minutes,
      track,
    };
    await DB.saveDelivery(updated);
    setLiveMiles(0);
    addToast('success', `✅ Run ${d.runNumber} complete · ${formatMiles(miles)}`);
  };

  const cancelRun = async (d: Delivery) => {
    if (!confirm('Cancel this delivery? Any GPS track will be discarded.')) return;
    if (gpsRef.current?.id === d.id) {
      stopTracking(gpsRef.current.session);
      gpsRef.current = null;
    }
    await DB.saveDelivery({ ...d, status: 'cancelled', endedAt: Date.now() });
    addToast('info', `Cancelled ${d.runNumber}`);
  };

  const deleteRun = async (d: Delivery) => {
    if (!confirm(`Delete run ${d.runNumber}? This can't be undone.`)) return;
    await DB.deleteDelivery(d.id);
    addToast('info', 'Deleted');
  };

  // CSV export — one row per run, plus a totals row. Format matches what
  // accountants expect for an IRS mileage log.
  const exportCsv = () => {
    const header = ['Run #', 'Driver', 'Date Started', 'Date Ended', 'Stops', 'Customers', 'Miles', 'Duration (min)', 'Rate ($/mi)', 'Amount ($)', 'Notes'];
    const rows = deliveries
      .filter(d => d.status === 'delivered')
      .map(d => {
        const customers = Array.from(new Set(d.stops.map(s => s.customerName).filter(Boolean))).join('; ');
        const rate = (d.mileageRateCents || 0) / 100;
        const amount = (d.milesDriven || 0) * rate;
        return [
          d.runNumber,
          d.driverName,
          d.startedAt ? new Date(d.startedAt).toLocaleDateString() : '',
          d.endedAt ? new Date(d.endedAt).toLocaleDateString() : '',
          String(d.stops.length),
          customers,
          (d.milesDriven || 0).toFixed(1),
          String(d.durationMinutes || 0),
          rate.toFixed(2),
          amount.toFixed(2),
          (d.notes || '').replace(/"/g, '""'),
        ];
      });
    const totalMiles = rows.reduce((a, r) => a + parseFloat(r[6] || '0'), 0);
    const totalAmount = rows.reduce((a, r) => a + parseFloat(r[9] || '0'), 0);
    rows.push(['', '', '', '', '', 'TOTAL', totalMiles.toFixed(1), '', '', totalAmount.toFixed(2), '']);
    const csv = [header, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mileage-log-${todayFmt().replace(/\//g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addToast('success', 'Mileage log exported');
  };

  const history = useMemo(() => deliveries.filter(d => d.status !== 'in-progress'), [deliveries]);
  const totalMilesAll = useMemo(
    () => history.reduce((a, d) => a + (d.milesDriven || 0), 0),
    [history],
  );

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h2 className="text-2xl font-black text-white flex items-center gap-2 tracking-tight">
            <Truck className="w-6 h-6 text-blue-500" aria-hidden="true" /> Deliveries
          </h2>
          <p className="text-zinc-500 text-sm mt-0.5">
            GPS-tracked runs · {formatMiles(totalMilesAll)} logged all-time
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <button
            type="button"
            onClick={exportCsv}
            disabled={history.length === 0}
            className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 border border-white/10"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" /> Export CSV
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> New Run
          </button>
        </div>
      </div>

      {/* Active run banner */}
      {active && (
        <ActiveRunCard
          delivery={active}
          liveMiles={liveMiles || active.milesDriven || 0}
          onFinish={() => finishRun(active)}
          onCancel={() => cancelRun(active)}
          onUpdateStop={async (stopId, patch) => {
            const stops = active.stops.map(s => s.id === stopId ? { ...s, ...patch } : s);
            await DB.saveDelivery({ ...active, stops });
          }}
          onEditDetails={() => setEditingId(active.id)}
        />
      )}

      {/* History */}
      <HistoryList
        deliveries={history}
        onResume={(d) => beginRun({ ...d, status: 'scheduled', startedAt: undefined, endedAt: undefined })}
        onDelete={deleteRun}
        onEdit={(d) => setEditingId(d.id)}
        addToast={addToast}
      />

      {creating && (
        <DeliveryEditor
          existing={null}
          drivers={users}
          jobs={jobs}
          allRuns={deliveries}
          onCancel={() => setCreating(false)}
          onSave={async (d) => {
            await DB.saveDelivery(d);
            setCreating(false);
            addToast('success', `Run ${d.runNumber} created`);
          }}
          currentUser={user}
        />
      )}

      {editingId && (() => {
        const d = deliveries.find(x => x.id === editingId);
        if (!d) return null;
        return (
          <DeliveryEditor
            existing={d}
            drivers={users}
            jobs={jobs}
            allRuns={deliveries}
            onCancel={() => setEditingId(null)}
            onSave={async (updated) => {
              await DB.saveDelivery(updated);
              setEditingId(null);
              addToast('success', `Saved ${updated.runNumber}`);
            }}
            currentUser={user}
          />
        );
      })()}
    </div>
  );
};

// ── Active run card — shows while a delivery is in progress ──
const ActiveRunCard: React.FC<{
  delivery: Delivery;
  liveMiles: number;
  onFinish: () => void;
  onCancel: () => void;
  onUpdateStop: (stopId: string, patch: Partial<DeliveryStop>) => void;
  onEditDetails: () => void;
}> = ({ delivery, liveMiles, onFinish, onCancel, onUpdateStop, onEditDetails }) => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const tick = () => setElapsed(delivery.startedAt ? Date.now() - delivery.startedAt : 0);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [delivery.startedAt]);

  const mins = Math.floor(elapsed / 60_000);
  const hrs = Math.floor(mins / 60);
  const remMins = mins - hrs * 60;
  const dur = hrs > 0 ? `${hrs}h ${remMins}m` : `${mins}m`;

  const arrived = delivery.stops.filter(s => s.arrivedAt).length;

  return (
    <div className="bg-gradient-to-br from-emerald-500/10 via-blue-500/10 to-transparent border-2 border-emerald-500/30 rounded-2xl p-4 sm:p-5 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0 animate-pulse">
            <Truck className="w-5 h-5 text-emerald-400" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black text-emerald-400 uppercase tracking-widest">● Live Run</p>
            <p className="text-lg font-black text-white tracking-tight truncate">{delivery.runNumber} · {delivery.driverName}</p>
          </div>
        </div>
        <button type="button" onClick={onEditDetails} className="text-[10px] font-bold text-blue-400 hover:text-white">Edit details</button>
      </div>

      {/* Live stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat label="Miles" value={formatMiles(liveMiles)} color="text-blue-400" />
        <Stat label="Time" value={dur} color="text-emerald-400" />
        <Stat label="Stops" value={`${arrived}/${delivery.stops.length}`} color="text-purple-400" />
      </div>

      {/* Stops */}
      <div className="space-y-2">
        {delivery.stops.map((stop, i) => (
          <StopRow key={stop.id} stop={stop} index={i} onUpdate={(patch) => onUpdateStop(stop.id, patch)} />
        ))}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-white/5">
        <button
          type="button"
          onClick={onFinish}
          className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Finish Run
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="bg-zinc-800 hover:bg-red-500/20 border border-white/10 hover:border-red-500/40 text-zinc-400 hover:text-red-400 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2"
        >
          <X className="w-4 h-4" aria-hidden="true" /> Cancel
        </button>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <div className="bg-zinc-950/40 border border-white/5 rounded-xl p-3 text-center">
    <p className="text-[9px] font-black text-white/40 uppercase tracking-widest">{label}</p>
    <p className={`text-xl sm:text-2xl font-black tabular mt-0.5 ${color}`}>{value}</p>
  </div>
);

const StopRow: React.FC<{ stop: DeliveryStop; index: number; onUpdate: (p: Partial<DeliveryStop>) => void }> = ({ stop, index, onUpdate }) => {
  const done = !!stop.arrivedAt;
  const markArrived = () => {
    if (done) return;
    const update: Partial<DeliveryStop> = { arrivedAt: Date.now() };
    // Snag current lat/lon so the arrival point is provable for records
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => onUpdate({ ...update, arrivalLat: pos.coords.latitude, arrivalLon: pos.coords.longitude }),
        () => onUpdate(update),
        { timeout: 5000 },
      );
    } else {
      onUpdate(update);
    }
  };
  return (
    <div className={`flex items-center gap-2 p-2.5 rounded-xl border transition-all ${done ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-zinc-900/40 border-white/5'}`}>
      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${done ? 'bg-emerald-500 text-white' : 'bg-zinc-800 text-zinc-400 border border-white/10'}`}>
        {done ? '✓' : index + 1}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-white truncate">{stop.customerName || stop.address}</p>
        {stop.customerName && <p className="text-[11px] text-zinc-500 truncate">{stop.address}</p>}
        {done && <p className="text-[10px] text-emerald-400">Arrived {new Date(stop.arrivedAt!).toLocaleTimeString()}</p>}
      </div>
      <a
        href={directionsUrl(stop.address)}
        target="_blank"
        rel="noreferrer"
        title="Open in Maps"
        className="p-2 text-blue-400 hover:bg-blue-500/10 rounded-lg"
      >
        <Navigation className="w-4 h-4" aria-hidden="true" />
      </a>
      {!done && (
        <button
          type="button"
          onClick={markArrived}
          className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg whitespace-nowrap"
        >
          Arrived
        </button>
      )}
    </div>
  );
};

// ── History list ──
const HistoryList: React.FC<{
  deliveries: Delivery[];
  onResume: (d: Delivery) => void;
  onDelete: (d: Delivery) => void;
  onEdit: (d: Delivery) => void;
  addToast: Props['addToast'];
}> = ({ deliveries, onDelete, onEdit }) => {
  if (deliveries.length === 0) {
    return (
      <div className="bg-zinc-900/40 border border-dashed border-white/10 rounded-2xl p-8 text-center">
        <Truck className="w-12 h-12 text-zinc-700 mx-auto mb-3" aria-hidden="true" />
        <p className="text-sm font-bold text-zinc-400">No delivery runs yet</p>
        <p className="text-[11px] text-zinc-600 mt-1">Hit "New Run" above to start logging mileage.</p>
      </div>
    );
  }
  return (
    <div className="bg-zinc-900/40 border border-white/5 rounded-2xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-zinc-950/40 border-b border-white/5">
            <th className="text-left text-[10px] font-black text-zinc-500 uppercase tracking-widest px-3 py-2">Run</th>
            <th className="text-left text-[10px] font-black text-zinc-500 uppercase tracking-widest px-3 py-2">Driver</th>
            <th className="text-left text-[10px] font-black text-zinc-500 uppercase tracking-widest px-3 py-2 hidden sm:table-cell">Date</th>
            <th className="text-left text-[10px] font-black text-zinc-500 uppercase tracking-widest px-3 py-2 hidden md:table-cell">Stops</th>
            <th className="text-right text-[10px] font-black text-zinc-500 uppercase tracking-widest px-3 py-2">Miles</th>
            <th className="text-right text-[10px] font-black text-zinc-500 uppercase tracking-widest px-3 py-2 hidden sm:table-cell">Time</th>
            <th className="text-right text-[10px] font-black text-zinc-500 uppercase tracking-widest px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {deliveries.map(d => {
            const cancelled = d.status === 'cancelled';
            return (
              <tr key={d.id} className={`border-b border-white/5 hover:bg-white/[0.02] ${cancelled ? 'opacity-50' : ''}`}>
                <td className="px-3 py-2">
                  <button type="button" onClick={() => onEdit(d)} className="font-black text-white tabular hover:underline text-left">
                    {d.runNumber}
                  </button>
                  {cancelled && <span className="ml-2 text-[9px] font-black text-red-400 bg-red-500/10 border border-red-500/25 rounded px-1">CANCELLED</span>}
                </td>
                <td className="px-3 py-2 text-zinc-300">{d.driverName}</td>
                <td className="px-3 py-2 text-zinc-500 hidden sm:table-cell">{d.startedAt ? fmt(new Date(d.startedAt).toLocaleDateString()) : '—'}</td>
                <td className="px-3 py-2 text-zinc-400 hidden md:table-cell">{d.stops.length}</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-blue-400 tabular">{formatMiles(d.milesDriven || 0)}</td>
                <td className="px-3 py-2 text-right font-mono text-zinc-500 tabular hidden sm:table-cell">{d.durationMinutes ? `${d.durationMinutes}m` : '—'}</td>
                <td className="px-3 py-2 text-right">
                  <button type="button" onClick={() => onDelete(d)} aria-label={`Delete ${d.runNumber}`} className="text-zinc-600 hover:text-red-400 p-1">
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// ── Delivery editor (create + edit) ──
const DeliveryEditor: React.FC<{
  existing: Delivery | null;
  drivers: User[];
  jobs: Job[];
  allRuns: Delivery[];
  currentUser: Props['user'];
  onCancel: () => void;
  onSave: (d: Delivery) => void;
}> = ({ existing, drivers, jobs, allRuns, currentUser, onCancel, onSave }) => {
  const openJobs = useMemo(() => jobs.filter(j => j.status !== 'completed'), [jobs]);
  const [runNumber, setRunNumber] = useState(existing?.runNumber || DB.nextDeliveryRunNumber(allRuns));
  const [driverId, setDriverId] = useState(existing?.driverId || currentUser.id);
  const [notes, setNotes] = useState(existing?.notes || '');
  const [stops, setStops] = useState<DeliveryStop[]>(existing?.stops || []);

  const driver = drivers.find(u => u.id === driverId);

  const addStop = () => {
    setStops([...stops, { id: `stop_${Date.now()}_${stops.length}`, address: '', jobIds: [] }]);
  };
  const updateStop = (idx: number, patch: Partial<DeliveryStop>) => {
    const next = [...stops];
    next[idx] = { ...next[idx], ...patch };
    setStops(next);
  };
  const removeStop = (idx: number) => setStops(stops.filter((_, i) => i !== idx));

  const handleSave = () => {
    if (stops.length === 0 || stops.some(s => !s.address.trim())) {
      alert('Add at least one stop with an address.');
      return;
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
      durationMinutes: existing?.durationMinutes,
      mileageRateCents: existing?.mileageRateCents,
      notes,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    onSave(delivery);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-950/95 backdrop-blur-sm p-0 sm:p-4 animate-fade-in" onClick={onCancel}>
      <div
        className="w-full sm:max-w-2xl bg-zinc-900 border border-white/10 rounded-none sm:rounded-2xl shadow-2xl flex flex-col max-h-[100dvh] sm:max-h-[calc(100dvh-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-sm sm:text-base font-black text-white flex items-center gap-2">
            <Truck className="w-4 h-4 text-blue-400" aria-hidden="true" />
            {existing ? 'Edit Run' : 'New Delivery Run'}
          </h2>
          <button type="button" onClick={onCancel} aria-label="Close" className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Run #</label>
              <input type="text" value={runNumber} onChange={e => setRunNumber(e.target.value)} className="w-full bg-zinc-950 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white tabular" />
            </div>
            <div>
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Driver</label>
              <select value={driverId} onChange={e => setDriverId(e.target.value)} className="w-full bg-zinc-950 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white">
                {drivers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Stops ({stops.length})</label>
              <button type="button" onClick={addStop} className="text-[10px] text-blue-400 hover:text-white font-bold flex items-center gap-1"><Plus className="w-3 h-3" aria-hidden="true" /> Add stop</button>
            </div>
            <div className="space-y-2">
              {stops.length === 0 && <p className="text-[11px] italic text-zinc-600 text-center py-4">No stops yet — add at least one.</p>}
              {stops.map((stop, i) => (
                <StopEditor
                  key={stop.id}
                  stop={stop}
                  index={i}
                  openJobs={openJobs}
                  onChange={(patch) => updateStop(i, patch)}
                  onRemove={() => removeStop(i)}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Anything the driver should know…" className="w-full bg-zinc-950 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white" />
          </div>
        </div>

        <div className="px-4 py-3 border-t border-white/10 flex items-center gap-2 bg-zinc-950/60">
          <button type="button" onClick={onCancel} className="text-zinc-500 hover:text-white text-xs font-bold px-3 py-2">Cancel</button>
          <button type="button" onClick={handleSave} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-bold">
            {existing ? 'Save Changes' : 'Create Run'}
          </button>
        </div>
      </div>
    </div>
  );
};

const StopEditor: React.FC<{
  stop: DeliveryStop;
  index: number;
  openJobs: Job[];
  onChange: (p: Partial<DeliveryStop>) => void;
  onRemove: () => void;
}> = ({ stop, index, openJobs, onChange, onRemove }) => {
  const customers = useMemo(() => {
    const set = new Set<string>();
    openJobs.forEach(j => { if (j.customer) set.add(j.customer); });
    return [...set].sort();
  }, [openJobs]);
  const jobsForCustomer = useMemo(
    () => openJobs.filter(j => !stop.customerName || j.customer === stop.customerName),
    [openJobs, stop.customerName],
  );
  return (
    <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-400 border border-white/10 flex items-center justify-center text-[10px] font-black shrink-0">{index + 1}</span>
        <input
          type="text"
          placeholder="Address"
          value={stop.address}
          onChange={e => onChange({ address: e.target.value })}
          className="flex-1 min-w-0 bg-zinc-950 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white"
        />
        <button type="button" onClick={onRemove} aria-label="Remove stop" className="text-zinc-600 hover:text-red-400 p-1 shrink-0">
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select
          value={stop.customerName || ''}
          onChange={e => onChange({ customerName: e.target.value })}
          className="bg-zinc-950 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
        >
          <option value="">Customer (optional)</option>
          {customers.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          multiple
          value={stop.jobIds}
          onChange={e => {
            const picked = Array.from(e.target.selectedOptions).map(o => (o as HTMLOptionElement).value);
            onChange({ jobIds: picked });
          }}
          className="bg-zinc-950 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white min-h-[60px]"
          title="Ctrl/Cmd-click to select multiple"
        >
          {jobsForCustomer.map(j => (
            <option key={j.id} value={j.id}>{j.poNumber} · {j.partNumber}</option>
          ))}
        </select>
      </div>
    </div>
  );
};
