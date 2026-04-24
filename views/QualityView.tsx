// Quality / Rework view — tracks parts that came back for re-work so patterns surface.
// Extracted from App.tsx. Zero functional changes.
//
// Exports:
//   - QualityView (used by App.tsx admin router)
//   - ReworkModal (also used by JobsView in App.tsx from the job-row rework button)
//   - REWORK_REASONS (kept exported for potential cross-view use; locally owned here)
//
// Shared helper `Avatar` is imported from ../App.

import React, { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle, X, Save, Plus, Info, Search, CheckCircle, Play, Edit2, Trash2,
} from 'lucide-react';

import { Job, User, ReworkEntry, ReworkReason, ReworkStatus } from '../types';
import * as DB from '../services/mockDb';
import { Avatar } from '../App';
import { Overlay } from '../components/Overlay';

export const REWORK_REASONS: { value: ReworkReason; label: string; color: string }[] = [
  { value: 'finish',       label: 'Finish quality',  color: '#f59e0b' },
  { value: 'dimensional',  label: 'Dimensional',     color: '#ef4444' },
  { value: 'missed-area',  label: 'Missed area',     color: '#a855f7' },
  { value: 'damage',       label: 'Damage',          color: '#ec4899' },
  { value: 'wrong-part',   label: 'Wrong part',      color: '#06b6d4' },
  { value: 'other',        label: 'Other',           color: '#71717a' },
];
const reworkReasonMeta = (r: ReworkReason) => REWORK_REASONS.find(x => x.value === r) || REWORK_REASONS[REWORK_REASONS.length - 1];

export const ReworkModal = ({ entry, jobs, user, onClose, addToast }: { entry?: Partial<ReworkEntry>; jobs: Job[]; user: User; onClose: () => void; addToast: any }) => {
  const [form, setForm] = useState<Partial<ReworkEntry>>(entry || { reason: 'finish', quantity: 1, status: 'open' });
  const linkedJob = form.jobId ? jobs.find(j => j.id === form.jobId) : null;
  const isEdit = !!entry?.id;

  const handleSave = async () => {
    if (!form.reason || !form.quantity || form.quantity < 1) { addToast('error', 'Reason and quantity required'); return; }
    const now = Date.now();
    const saved: ReworkEntry = {
      id: entry?.id || `rw_${now}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: entry?.createdAt || now,
      jobId: form.jobId || undefined,
      poNumber: linkedJob?.poNumber || form.poNumber || undefined,
      partNumber: linkedJob?.partNumber || form.partNumber || undefined,
      customer: linkedJob?.customer || form.customer || undefined,
      reason: form.reason as ReworkReason,
      quantity: form.quantity,
      reporterUserId: entry?.reporterUserId || user.id,
      reporterName: entry?.reporterName || user.name,
      status: form.status as ReworkStatus || 'open',
      notes: form.notes || undefined,
      photoUrl: form.photoUrl || undefined,
      resolvedAt: form.status === 'resolved' ? (form.resolvedAt || now) : undefined,
      resolvedBy: form.status === 'resolved' ? (form.resolvedBy || user.id) : undefined,
      resolvedByName: form.status === 'resolved' ? (form.resolvedByName || user.name) : undefined,
      resolutionNotes: form.status === 'resolved' ? form.resolutionNotes : undefined,
    };
    try { await DB.saveRework(saved); addToast('success', isEdit ? 'Rework entry updated' : 'Rework logged'); onClose(); }
    catch { addToast('error', 'Save failed'); }
  };

  return (
    <Overlay open onClose={onClose} ariaLabel={isEdit ? 'Edit rework' : 'Report rework'} zIndex={200}>
      <div className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col my-0 sm:my-4 animate-slide-up" style={{ maxHeight: 'calc(100dvh - 2rem)' }} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between bg-gradient-to-b from-zinc-800/40 to-transparent shrink-0">
          <div>
            <h3 className="font-black text-white text-base tracking-tight flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-400" aria-hidden="true" /> {isEdit ? 'Edit Rework' : 'Report Rework'}</h3>
            <p className="text-[11px] text-zinc-500 mt-0.5">Track parts that came back for re-work so you can spot patterns.</p>
          </div>
          <button aria-label="Close" onClick={onClose} className="text-zinc-400 hover:text-white transition-colors w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10"><X className="w-4 h-4" aria-hidden="true" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Job link */}
          <div>
            <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Linked Job (optional)</label>
            <select value={form.jobId || ''} onChange={e => setForm({ ...form, jobId: e.target.value || undefined })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none">
              <option value="">— No specific job —</option>
              {jobs.slice(0, 50).map(j => <option key={j.id} value={j.id}>{j.poNumber} · {j.partNumber} · {j.customer}</option>)}
            </select>
          </div>
          {/* Reason */}
          <div>
            <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Reason</label>
            <div className="grid grid-cols-2 gap-2">
              {REWORK_REASONS.map(r => {
                const active = form.reason === r.value;
                return (
                  <button key={r.value} type="button" onClick={() => setForm({ ...form, reason: r.value })} className={`px-3 py-2.5 rounded-xl border text-sm font-bold text-left transition-all flex items-center gap-2 ${active ? 'ring-1' : 'bg-zinc-900/50 border-white/5 text-zinc-400 hover:text-white'}`} style={active ? { background: `${r.color}15`, borderColor: `${r.color}40`, color: r.color, boxShadow: `0 0 0 1px ${r.color}30` } : undefined}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color, boxShadow: active ? `0 0 8px ${r.color}` : undefined }} />
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Qty + Status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Qty Affected</label>
              <input type="number" min={1} value={form.quantity || ''} onChange={e => setForm({ ...form, quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none font-mono text-lg" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Status</label>
              <select value={form.status || 'open'} onChange={e => setForm({ ...form, status: e.target.value as ReworkStatus })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none">
                <option value="open">Open</option>
                <option value="in-rework">In Rework</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
          </div>
          {/* Notes */}
          <div>
            <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">Notes</label>
            <textarea value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="What went wrong? What needs to happen?" className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none min-h-[80px] resize-y" />
          </div>
          {form.status === 'resolved' && (
            <div>
              <label className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider block mb-1.5">Resolution Notes</label>
              <textarea value={form.resolutionNotes || ''} onChange={e => setForm({ ...form, resolutionNotes: e.target.value })} placeholder="How was it fixed?" className="w-full bg-emerald-500/5 border border-emerald-500/20 rounded-xl px-4 py-3 text-white outline-none min-h-[60px] resize-y" />
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-white/10 bg-zinc-950/50 flex items-center justify-between gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2.5 text-zinc-400 hover:text-white font-medium transition-colors">Cancel</button>
          <button onClick={handleSave} className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-orange-900/40 flex items-center gap-2 transition-all">
            <Save className="w-4 h-4" aria-hidden="true" /> {isEdit ? 'Save Changes' : 'Log Rework'}
          </button>
        </div>
      </div>
    </Overlay>
  );
};

export const QualityView = ({ user, addToast, confirm }: any) => {
  const [entries, setEntries] = useState<ReworkEntry[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Partial<ReworkEntry> | undefined>();
  const [filterStatus, setFilterStatus] = useState<'all' | ReworkStatus>('all');
  const [filterReason, setFilterReason] = useState<'all' | ReworkReason>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const u1 = DB.subscribeRework(setEntries);
    const u2 = DB.subscribeJobs(setJobs);
    return () => { u1(); u2(); };
  }, []);

  const openNew = () => { setEditing({ reason: 'finish', quantity: 1, status: 'open' }); setShowModal(true); };
  const openEdit = (e: ReworkEntry) => { setEditing(e); setShowModal(true); };
  const handleDelete = (id: string) => confirm({ title: 'Delete rework entry', message: 'This cannot be undone.', onConfirm: () => DB.deleteRework(id) });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter(e => {
      if (filterStatus !== 'all' && e.status !== filterStatus) return false;
      if (filterReason !== 'all' && e.reason !== filterReason) return false;
      if (q && !(
        (e.poNumber || '').toLowerCase().includes(q) ||
        (e.partNumber || '').toLowerCase().includes(q) ||
        (e.customer || '').toLowerCase().includes(q) ||
        (e.notes || '').toLowerCase().includes(q) ||
        (e.reporterName || '').toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [entries, filterStatus, filterReason, search]);

  // Stats
  const last30 = Date.now() - 30 * 86400000;
  const recent = entries.filter(e => e.createdAt >= last30);
  const openCount = entries.filter(e => e.status !== 'resolved').length;
  const resolved30 = entries.filter(e => e.status === 'resolved' && (e.resolvedAt || 0) >= last30).length;
  const totalAffected = entries.filter(e => e.status !== 'resolved').reduce((a, e) => a + (e.quantity || 0), 0);

  // Top offenders (customers)
  const byCustomer = useMemo(() => {
    const map = new Map<string, number>();
    recent.forEach(e => { if (e.customer) map.set(e.customer, (map.get(e.customer) || 0) + e.quantity); });
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [recent]);

  const byReason = useMemo(() => {
    const map = new Map<ReworkReason, number>();
    recent.forEach(e => map.set(e.reason, (map.get(e.reason) || 0) + e.quantity));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [recent]);
  const maxReason = byReason.reduce((m, [, c]) => Math.max(m, c), 0) || 1;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h2 className="text-2xl font-black text-white flex items-center gap-2 tracking-tight"><AlertTriangle className="w-6 h-6 text-amber-400" aria-hidden="true" /> Quality / Rework</h2>
          <p className="text-zinc-500 text-sm mt-0.5">Track parts that came back for re-work. Spot patterns &amp; drive improvement.</p>
        </div>
        <button onClick={openNew} className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white px-5 py-2.5 rounded-xl flex items-center gap-2 text-sm font-bold shadow-lg shadow-orange-900/40 transition-all">
          <Plus className="w-4 h-4" aria-hidden="true" /> Report Rework
        </button>
      </div>

      {/* How-it-works hint — only visible when there are no entries */}
      {entries.length === 0 && (
        <div className="bg-gradient-to-br from-amber-500/5 to-orange-500/5 border border-amber-500/20 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
              <Info className="w-5 h-5 text-amber-400" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-white">How this works</p>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">This is a <strong className="text-amber-300">log</strong>, not a timer. Use it to record when a part comes back for re-work — note the reason, qty, and link it to the original job. You'll spot patterns (which customer, which reason) over time.</p>
              <div className="mt-3 grid sm:grid-cols-3 gap-2 text-[11px]">
                <div className="flex items-start gap-2 bg-amber-500/5 border border-amber-500/10 rounded-lg p-2.5">
                  <span className="text-amber-400 font-black shrink-0">1.</span>
                  <div>
                    <p className="text-white font-semibold">Report it</p>
                    <p className="text-zinc-500 mt-0.5">Click <span className="text-amber-400 font-bold">Report Rework</span> above, or the amber ⚠ button on any job row.</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 bg-blue-500/5 border border-blue-500/10 rounded-lg p-2.5">
                  <span className="text-blue-400 font-black shrink-0">2.</span>
                  <div>
                    <p className="text-white font-semibold">Start working</p>
                    <p className="text-zinc-500 mt-0.5">Click <span className="text-blue-400 font-bold">Start</span> on the card to move it to "In Rework".</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-2.5">
                  <span className="text-emerald-400 font-black shrink-0">3.</span>
                  <div>
                    <p className="text-white font-semibold">Resolve</p>
                    <p className="text-zinc-500 mt-0.5">Click <span className="text-emerald-400 font-bold">Resolve</span> + add how you fixed it.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KPI cards */}
      <div className="stagger grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 rounded-2xl p-4 overflow-hidden">
          <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest">Open Issues</p>
          <p className={`text-2xl font-black tabular mt-1 ${openCount > 0 ? 'text-amber-400' : 'text-zinc-500'}`}>{openCount}</p>
          <p className="text-[10px] text-zinc-600 mt-0.5">{totalAffected} pc{totalAffected !== 1 ? 's' : ''} affected</p>
          <div className="h-0.5 rounded-full bg-gradient-to-r from-transparent via-amber-500/50 to-transparent mt-2" aria-hidden="true" />
        </div>
        <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 rounded-2xl p-4 overflow-hidden">
          <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest">Logged · 30d</p>
          <p className="text-2xl font-black text-white tabular mt-1">{recent.length}</p>
          <p className="text-[10px] text-zinc-600 mt-0.5">{recent.reduce((a, e) => a + e.quantity, 0)} total pieces</p>
          <div className="h-0.5 rounded-full bg-gradient-to-r from-transparent via-blue-500/40 to-transparent mt-2" aria-hidden="true" />
        </div>
        <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 rounded-2xl p-4 overflow-hidden">
          <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest">Resolved · 30d</p>
          <p className="text-2xl font-black text-emerald-400 tabular mt-1">{resolved30}</p>
          <p className="text-[10px] text-zinc-600 mt-0.5">{recent.length > 0 ? Math.round((resolved30 / recent.length) * 100) : 0}% closure rate</p>
          <div className="h-0.5 rounded-full bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent mt-2" aria-hidden="true" />
        </div>
        <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 rounded-2xl p-4 overflow-hidden">
          <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest">Total Logged</p>
          <p className="text-2xl font-black text-white tabular mt-1">{entries.length}</p>
          <p className="text-[10px] text-zinc-600 mt-0.5">All time</p>
          <div className="h-0.5 rounded-full bg-gradient-to-r from-transparent via-zinc-500/40 to-transparent mt-2" aria-hidden="true" />
        </div>
      </div>

      {/* Breakdown: Reasons + Top customers */}
      {recent.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card-shine hover-lift-glow bg-gradient-to-br from-zinc-900/60 to-zinc-900/30 border border-white/5 rounded-2xl p-5">
            <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-3">Rework by Reason · 30d</h3>
            <div className="space-y-2">
              {byReason.map(([reason, count]) => {
                const meta = reworkReasonMeta(reason);
                const pct = (count / maxReason) * 100;
                return (
                  <div key={reason} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: meta.color, boxShadow: `0 0 6px ${meta.color}80` }} />
                    <span className="text-xs font-semibold text-zinc-300 flex-1 truncate">{meta.label}</span>
                    <div className="relative flex-[2] h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                      <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: meta.color, boxShadow: `0 0 6px ${meta.color}80` }} />
                    </div>
                    <span className="text-[11px] font-mono font-bold text-zinc-200 tabular w-8 text-right">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card-shine hover-lift-glow bg-gradient-to-br from-zinc-900/60 to-zinc-900/30 border border-white/5 rounded-2xl p-5">
            <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-3">Top Customers · 30d</h3>
            {byCustomer.length === 0 ? (
              <p className="text-zinc-600 text-xs italic">No customer-linked rework this period.</p>
            ) : (
              <div className="space-y-2">
                {byCustomer.map(([customer, count], i) => {
                  const pct = (count / (byCustomer[0][1] || 1)) * 100;
                  return (
                    <div key={customer} className="flex items-center gap-2">
                      <span className="w-5 text-center text-[10px] font-black text-zinc-600 tabular">{i + 1}</span>
                      <span className="text-xs font-semibold text-zinc-300 flex-1 truncate">{customer}</span>
                      <div className="relative flex-[2] h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                        <div className="absolute inset-y-0 left-0 rounded-full bg-amber-500" style={{ width: `${pct}%`, boxShadow: '0 0 6px rgba(245,158,11,0.6)' }} />
                      </div>
                      <span className="text-[11px] font-mono font-bold text-zinc-200 tabular w-8 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 bg-zinc-900/40 border border-white/5 rounded-2xl p-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" aria-hidden="true" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search PO, part, customer, notes…" className="w-full bg-zinc-950/60 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none" />
        </div>
        <div role="group" aria-label="Filter by status" className="inline-flex gap-1 p-1 bg-zinc-950/60 border border-white/5 rounded-lg">
          {(['all', 'open', 'in-rework', 'resolved'] as const).map(s => (
            <button key={s} onClick={() => setFilterStatus(s)} aria-pressed={filterStatus === s} className={`px-3 py-1.5 text-[11px] font-bold rounded transition-colors capitalize min-h-[32px] ${filterStatus === s ? 'bg-blue-600 text-white' : 'text-zinc-500 hover:text-white hover:bg-white/5'}`}>{s === 'in-rework' ? 'In Rework' : s}</button>
          ))}
        </div>
        <select aria-label="Filter by reason" value={filterReason} onChange={e => setFilterReason(e.target.value as any)} className="bg-zinc-950/60 border border-white/10 rounded-lg px-2.5 py-1.5 text-[12px] text-white outline-none cursor-pointer min-h-[32px]">
          <option value="all">All reasons</option>
          {REWORK_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      {/* List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="bg-zinc-900/30 border border-dashed border-white/5 rounded-2xl p-12 text-center">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-3">
              <CheckCircle className="w-6 h-6 text-emerald-400" aria-hidden="true" />
            </div>
            <p className="text-white font-bold">No rework entries {search || filterStatus !== 'all' || filterReason !== 'all' ? 'match these filters' : 'yet'}</p>
            <p className="text-zinc-500 text-xs mt-1">{search || filterStatus !== 'all' || filterReason !== 'all' ? 'Try clearing filters.' : 'That\'s a good thing. Log one when a part comes back.'}</p>
          </div>
        ) : (
          filtered.map(e => {
            const meta = reworkReasonMeta(e.reason);
            const statusTint = e.status === 'resolved' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : e.status === 'in-rework' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20';
            return (
              <div key={e.id} className="card-shine hover-lift-glow group bg-zinc-900/50 border border-white/5 rounded-2xl p-4 relative overflow-hidden">
                <div aria-hidden="true" className="absolute top-0 left-0 right-0 h-[2px]" style={{ backgroundImage: `linear-gradient(90deg, ${meta.color}66, transparent)` }} />
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${meta.color}15`, border: `1px solid ${meta.color}30` }}>
                    <AlertTriangle className="w-5 h-5" style={{ color: meta.color }} aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-black text-white">{e.poNumber || 'No PO'}</span>
                      <span className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border" style={{ background: `${meta.color}15`, color: meta.color, borderColor: `${meta.color}40` }}>{meta.label}</span>
                      <span className={`text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border ${statusTint}`}>{e.status === 'in-rework' ? 'IN REWORK' : e.status.toUpperCase()}</span>
                      <span className="text-[10px] font-mono text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded">{e.quantity} pc{e.quantity !== 1 ? 's' : ''}</span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-1 truncate">{e.partNumber || '—'}{e.customer ? ` · ${e.customer}` : ''}</p>
                    {e.notes && <p className="text-[11px] text-zinc-300 mt-1.5 leading-relaxed">{e.notes}</p>}
                    {e.status === 'resolved' && e.resolutionNotes && (
                      <div className="mt-2 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-2.5 py-1.5">
                        <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Resolution</p>
                        <p className="text-[11px] text-emerald-300 mt-0.5">{e.resolutionNotes}</p>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
                      <div className="flex items-center gap-2 text-[10px] text-zinc-600 min-w-0">
                        <Avatar name={e.reporterName} size="xs" />
                        <span className="truncate">{e.reporterName}</span>
                        <span>·</span>
                        <span>{new Date(e.createdAt).toLocaleDateString()}</span>
                      </div>
                      {/* Quick-action status transitions — no need to open the full modal */}
                      <div className="flex items-center gap-1 shrink-0">
                        {e.status === 'open' && (
                          <button
                            onClick={() => DB.saveRework({ ...e, status: 'in-rework' })}
                            className="text-[10px] font-bold text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/25 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
                            title="Start working on it"
                          >
                            <Play className="w-2.5 h-2.5" aria-hidden="true" /> Start
                          </button>
                        )}
                        {e.status !== 'resolved' && (
                          <button
                            onClick={() => DB.saveRework({ ...e, status: 'resolved', resolvedAt: Date.now(), resolvedBy: user.id, resolvedByName: user.name })}
                            className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
                            title="Mark as resolved"
                          >
                            <CheckCircle className="w-2.5 h-2.5" aria-hidden="true" /> Resolve
                          </button>
                        )}
                        {e.status === 'resolved' && (
                          <button
                            onClick={() => DB.saveRework({ ...e, status: 'open', resolvedAt: undefined, resolvedBy: undefined, resolvedByName: undefined, resolutionNotes: undefined })}
                            className="text-[10px] font-bold text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
                            title="Reopen this issue"
                          >
                            Reopen
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                    <button aria-label="Edit rework entry" onClick={() => openEdit(e)} className="p-1.5 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors"><Edit2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
                    <button aria-label="Delete rework entry" onClick={() => handleDelete(e.id)} className="p-1.5 hover:bg-red-500/10 rounded-lg text-zinc-500 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showModal && <ReworkModal entry={editing} jobs={jobs} user={user} onClose={() => setShowModal(false)} addToast={addToast} />}
    </div>
  );
};
