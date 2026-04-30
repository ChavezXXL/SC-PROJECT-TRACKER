// ═════════════════════════════════════════════════════════════════════
// Purchase Orders — outbound POs WE send to vendors.
//
// Workflow:
//   List → quick status actions → editor (full details, receiving, job links)
//
// What changed in this version:
//   • Overdue detection — past required date + not closed/received/cancelled
//   • KPIs: Open Value · Overdue (red) · Spend 30d · Total
//   • List rows: overdue badge, required-by date, quick "→ Sent / Receive"
//   • Receiving workflow: per-line received-qty inputs, auto-status logic
//   • Job linking: checkbox list (no more ctrl-click select multiple)
//   • Status stepper in editor header
//   • Vendor contact clickable (mailto / tel)
// ═════════════════════════════════════════════════════════════════════

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Package, Plus, Search, Trash2, Edit2, FileText, Paperclip, AlertCircle,
  CheckCircle2, Clock, XCircle, Truck, Printer, Copy, ChevronRight, Store,
  Upload, X, AlertTriangle, Mail, Phone, BarChart2, Send, ArrowRight, Link2,
  Zap,
} from 'lucide-react';

// ── Preset line-item descriptions ──
// Grouped by category so the picker stays scannable.
// Edit this list to match whatever your shop orders regularly.
const PRESET_DESCRIPTIONS: { label: string; items: string[] }[] = [
  { label: 'Services', items: [
    'Deburring — per print',
    'Deburring — tumble/vibratory',
    'Deburring — hand finish',
    'Edge break per drawing',
    'Part marking / engraving',
    'Inspection / FAI',
  ]},
  { label: 'Finishing', items: [
    'Heat treat to Rockwell spec',
    'Anodize — Type II clear',
    'Anodize — Type III hard coat',
    'Zinc plate per spec',
    'Black oxide coating',
    'Powder coat',
    'Passivation per AMS 2700',
    'Shot peen / blast',
  ]},
  { label: 'Material', items: [
    'Raw material — aluminum bar stock',
    'Raw material — steel bar stock',
    'Raw material — stainless sheet',
    'Raw material — titanium',
    'Raw material — plastic / nylon',
    'Hardware / fasteners',
    'Tooling / consumables',
  ]},
  { label: 'Logistics', items: [
    'Outside processing — subcontract',
    'Shipping / freight',
    'Rush / expedite fee',
    'Certification / cert of conformance',
  ]},
];
import type {
  PurchaseOrder, POLineItem, POStatus, POAttachment, Vendor, SystemSettings, Job,
} from '../types';
import { DEFAULT_QUALITY_REQUIREMENTS } from '../types';
import * as DB from '../services/mockDb';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/useConfirm';
import { fmtMoneyK } from '../utils/format';
import { printPurchaseOrderPDF } from '../services/pdfService';

interface Props {
  user: { id: string; name: string; role: string };
  addToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

// ── Status display metadata ──
const STATUS_META: Record<POStatus, { label: string; color: string; icon: any; step: number }> = {
  'draft':              { label: 'Draft',        color: 'bg-zinc-700/30 border-zinc-600/40 text-zinc-400',         icon: Edit2,        step: 0 },
  'sent':               { label: 'Sent',         color: 'bg-blue-500/15 border-blue-500/30 text-blue-400',         icon: Send,         step: 1 },
  'acknowledged':       { label: 'Acknowledged', color: 'bg-purple-500/15 border-purple-500/30 text-purple-400',   icon: CheckCircle2, step: 2 },
  'in-progress':        { label: 'In Progress',  color: 'bg-amber-500/15 border-amber-500/30 text-amber-400',      icon: Clock,        step: 3 },
  'partially-received': { label: 'Partial Recv', color: 'bg-teal-500/15 border-teal-500/30 text-teal-400',         icon: Truck,        step: 4 },
  'received':           { label: 'Received',     color: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',icon: CheckCircle2, step: 5 },
  'closed':             { label: 'Closed',       color: 'bg-zinc-800 border-white/10 text-zinc-500',               icon: CheckCircle2, step: 6 },
  'cancelled':          { label: 'Cancelled',    color: 'bg-red-500/15 border-red-500/30 text-red-400',            icon: XCircle,      step: -1 },
};

const STEPPER_STATUSES: POStatus[] = ['draft','sent','acknowledged','in-progress','partially-received','received','closed'];

// ── Overdue helper ──
function isOverdue(po: PurchaseOrder): boolean {
  if (!po.requiredDate) return false;
  if (['received','closed','cancelled'].includes(po.status)) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  const [m,d,y] = po.requiredDate.split('/').map(Number);
  if (!m || !d || !y) return false;
  return new Date(y, m - 1, d) < today;
}

// ── Date helpers (stored MM/DD/YYYY, input wants YYYY-MM-DD) ──
function toISODate(d: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : d;
}
function fromISODate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : d;
}
function fmtDate(d?: string | number): string {
  if (!d) return '';
  if (typeof d === 'number') return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const [m,day,y] = d.split('/');
  if (!m) return d;
  const months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[+m]} ${+day}`;
}

// ══════════════════════════════════════════════════════════════════════
// Main view
// ══════════════════════════════════════════════════════════════════════
export const PurchaseOrdersView: React.FC<Props> = ({ user, addToast }) => {
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [settings, setSettings] = useState<SystemSettings>(DB.getSettings());
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const [filter, setFilter] = useState<'all' | 'overdue' | POStatus>('all');
  const [search, setSearch] = useState('');
  const { confirm: confirmDialog, ConfirmHost } = useConfirm();

  useEffect(() => {
    const u1 = DB.subscribePurchaseOrders(setPos);
    const u2 = DB.subscribeVendors(setVendors);
    const u3 = DB.subscribeJobs(setJobs);
    const u4 = DB.subscribeSettings(setSettings);
    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  // ── KPIs ──
  const thirtyDaysAgo = Date.now() - 30 * 86_400_000;
  const openValue = useMemo(
    () => pos.filter(p => ['sent','acknowledged','in-progress','partially-received'].includes(p.status))
      .reduce((a, p) => a + (p.total || 0), 0), [pos]);
  const overdueCount = useMemo(() => pos.filter(isOverdue).length, [pos]);
  const spendThisMonth = useMemo(
    () => pos.filter(p => (p.status === 'received' || p.status === 'closed') && (p.receivedDate || p.orderedDate) >= thirtyDaysAgo)
      .reduce((a, p) => a + (p.total || 0), 0), [pos, thirtyDaysAgo]);
  const totalCount = pos.length;

  // ── Filter ──
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pos.filter(p => {
      if (filter === 'overdue' && !isOverdue(p)) return false;
      if (filter !== 'all' && filter !== 'overdue' && p.status !== filter) return false;
      if (!q) return true;
      return p.poNumber.toLowerCase().includes(q)
        || p.vendorName.toLowerCase().includes(q)
        || p.items.some(i => (i.partNumber || '').toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
    });
  }, [pos, filter, search]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { all: pos.length, overdue: pos.filter(isOverdue).length };
    for (const p of pos) c[p.status] = (c[p.status] || 0) + 1;
    return c;
  }, [pos]);

  const handleDelete = async (p: PurchaseOrder) => {
    const ok = await confirmDialog({
      title: `Delete ${p.poNumber}?`,
      message: 'Audit history will be lost. This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Delete PO',
    });
    if (!ok) return;
    await DB.deletePurchaseOrder(p.id);
    addToast('info', `Deleted ${p.poNumber}`);
  };

  const handleDuplicate = async (p: PurchaseOrder) => {
    const newNumber = DB.nextPurchaseOrderNumber(pos);
    const copy: PurchaseOrder = {
      ...p,
      id: `po_${Date.now()}`,
      poNumber: newNumber,
      status: 'draft',
      orderedDate: Date.now(),
      receivedDate: undefined,
      approvedBy: undefined, approvedByName: undefined, approvedAt: undefined,
      statusHistory: [{ status: 'draft', timestamp: Date.now(), userId: user.id, userName: user.name, note: `Duplicated from ${p.poNumber}` }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: user.id,
      createdByName: user.name,
      isRework: undefined, reworkOf: undefined, reworkOfNumber: undefined, reworkReason: undefined,
    };
    await DB.savePurchaseOrder(copy);
    addToast('success', `Created ${newNumber} (draft copy)`);
    setEditing(copy);
  };

  const handleRework = async (p: PurchaseOrder) => {
    // Ask for a brief reason — keeps it in a single interaction
    const reason = window.prompt(
      `Rework reason for ${p.poNumber}?\n(e.g. "finish off-spec", "wrong dimension", "missed area")\n\nLeave blank to fill in the editor.`,
      ''
    );
    if (reason === null) return; // user cancelled
    const newNumber = `${DB.nextPurchaseOrderNumber(pos).replace(/PO-(\d+)-(\d+)/, (_, y, n) => `PO-${y}-${n}`)}-RW`;
    // Tag each line item description so the vendor knows it's rework
    const reworkItems = p.items.map(item => ({
      ...item,
      id: `li_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      description: item.description.startsWith('[REWORK]') ? item.description : `[REWORK] ${item.description}`,
      receivedQty: undefined,
    }));
    const reworkPO: PurchaseOrder = {
      ...p,
      id: `po_${Date.now()}`,
      poNumber: newNumber,
      status: 'draft',
      items: reworkItems,
      orderedDate: Date.now(),
      requiredDate: undefined,
      expectedDate: undefined,
      receivedDate: undefined,
      approvedBy: undefined, approvedByName: undefined, approvedAt: undefined,
      statusHistory: [{ status: 'draft', timestamp: Date.now(), userId: user.id, userName: user.name, note: `Rework of ${p.poNumber}${reason ? ` — ${reason}` : ''}` }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: user.id,
      createdByName: user.name,
      isRework: true,
      reworkOf: p.id,
      reworkOfNumber: p.poNumber,
      reworkReason: reason || undefined,
      internalNotes: `REWORK of ${p.poNumber}${reason ? ` — Reason: ${reason}` : ''}${p.internalNotes ? `\n\nOriginal notes: ${p.internalNotes}` : ''}`,
    };
    await DB.savePurchaseOrder(reworkPO);
    addToast('success', `↩ Rework PO ${newNumber} created — same vendor, items tagged [REWORK]`);
    setEditing(reworkPO);
  };

  const quickAdvance = async (p: PurchaseOrder, to: POStatus) => {
    const entry = { status: to, timestamp: Date.now(), userId: user.id, userName: user.name };
    const updated = {
      ...p,
      status: to,
      statusHistory: [...(p.statusHistory || []), entry],
      ...(to === 'received' ? { receivedDate: Date.now() } : {}),
      updatedAt: Date.now(),
    };
    await DB.savePurchaseOrder(updated);
    addToast('success', `${p.poNumber} → ${STATUS_META[to].label}`);
  };

  return (
    <div className="space-y-5 animate-fade-in w-full">
      {ConfirmHost}

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h2 className="text-2xl font-black text-white flex items-center gap-2 tracking-tight">
            <Package className="w-6 h-6 text-amber-500" aria-hidden="true" /> Purchase Orders
          </h2>
          <p className="text-zinc-500 text-sm mt-0.5">Outsource work · buy material · track receipts</p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 shadow-lg shadow-amber-900/30"
        >
          <Plus className="w-4 h-4" aria-hidden="true" /> New Purchase Order
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Open Value"    value={fmtMoneyK(openValue)}   hint="pending delivery"    color="text-amber-400"   icon={<Package className="w-4 h-4" />} />
        <Kpi label="Overdue"       value={String(overdueCount)}   hint="past required date"  color={overdueCount > 0 ? 'text-red-400' : 'text-zinc-500'} icon={<AlertTriangle className="w-4 h-4" />} flash={overdueCount > 0} />
        <Kpi label="Spend (30 d)"  value={fmtMoneyK(spendThisMonth)} hint="received this month" color="text-emerald-400" icon={<BarChart2 className="w-4 h-4" />} />
        <Kpi label="Total POs"     value={String(totalCount)}     hint="all-time"            color="text-blue-400"    icon={<FileText className="w-4 h-4" />} />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="PO #, vendor, part #…"
            className="w-full bg-zinc-900/60 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none"
          />
        </div>
        <div className="inline-flex gap-1 p-1 bg-zinc-900/60 border border-white/5 rounded-lg overflow-x-auto">
          <FilterBtn label="All" count={statusCounts.all} active={filter === 'all'} onClick={() => setFilter('all')} />
          {statusCounts.overdue > 0 && (
            <FilterBtn label="🔴 Overdue" count={statusCounts.overdue} active={filter === 'overdue'} onClick={() => setFilter('overdue')} danger />
          )}
          {(['draft','sent','in-progress','partially-received','received','closed'] as POStatus[]).map(s => (
            <FilterBtn
              key={s}
              label={STATUS_META[s].label}
              count={statusCounts[s] || 0}
              active={filter === s}
              onClick={() => setFilter(s as any)}
            />
          ))}
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState hasAny={pos.length > 0} />
      ) : (
        <div className="space-y-2">
          {filtered.map(p => (
            <PORow
              key={p.id}
              po={p}
              jobs={jobs}
              onEdit={() => setEditing(p)}
              onReceive={() => setReceiving(p)}
              onDuplicate={() => handleDuplicate(p)}
              onDelete={() => handleDelete(p)}
              onRework={() => handleRework(p)}
              onQuickAdvance={(to) => quickAdvance(p, to)}
            />
          ))}
        </div>
      )}

      {/* Editor modal */}
      {(editing || creating) && (
        <PurchaseOrderEditor
          existing={editing}
          allPOs={pos}
          vendors={vendors.filter(v => !v.archived)}
          jobs={jobs}
          settings={settings}
          currentUser={user}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSave={async (po) => {
            await DB.savePurchaseOrder(po);
            addToast('success', `Saved ${po.poNumber}`);
            setEditing(null);
            setCreating(false);
          }}
          addToast={addToast}
        />
      )}

      {/* Receiving modal */}
      {receiving && (
        <ReceivingModal
          po={receiving}
          currentUser={user}
          onClose={() => setReceiving(null)}
          onSave={async (po) => {
            await DB.savePurchaseOrder(po);
            addToast('success', `${po.poNumber} receipt recorded`);
            setReceiving(null);
          }}
        />
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════
// PO list row
// ══════════════════════════════════════════════════════════════════════
const PORow: React.FC<{
  po: PurchaseOrder;
  jobs: Job[];
  onEdit: () => void;
  onReceive: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRework: () => void;
  onQuickAdvance: (to: POStatus) => void;
}> = ({ po, jobs, onEdit, onReceive, onDuplicate, onDelete, onRework, onQuickAdvance }) => {
  const meta = STATUS_META[po.status];
  const Icon = meta.icon;
  const overdue = isOverdue(po);
  const linkedJobs = useMemo(() => jobs.filter(j => po.linkedJobIds?.includes(j.id)), [jobs, po.linkedJobIds]);

  // What's the most useful quick action for this status?
  const quickAction: { label: string; to: POStatus } | null =
    po.status === 'draft'        ? { label: 'Mark Sent', to: 'sent' } :
    po.status === 'sent'         ? { label: 'Acknowledged', to: 'acknowledged' } :
    po.status === 'acknowledged' ? { label: 'In Progress', to: 'in-progress' } :
    null;

  return (
    <div className={`bg-zinc-900/50 border rounded-2xl p-3 sm:p-4 flex items-center gap-3 hover:bg-white/[0.03] transition-all group ${overdue ? 'border-red-500/30 hover:border-red-500/50' : 'border-white/5 hover:border-white/10'}`}>
      {/* Status icon */}
      <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center border ${overdue ? 'bg-red-500/15 border-red-500/40 text-red-400' : meta.color}`}>
        {overdue ? <AlertTriangle className="w-5 h-5" aria-hidden="true" /> : <Icon className="w-5 h-5" aria-hidden="true" />}
      </div>

      {/* Main info — clickable */}
      <button type="button" onClick={onEdit} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-black text-white tabular text-sm sm:text-base">{po.poNumber}</span>
          <span className={`text-[9px] font-black border rounded px-1.5 py-0.5 ${overdue ? 'bg-red-500/15 border-red-500/40 text-red-400' : meta.color}`}>
            {overdue ? 'OVERDUE' : meta.label}
          </span>
          {po.isRework && (
            <span className="text-[9px] font-black text-violet-300 bg-violet-500/15 border border-violet-500/30 rounded px-1.5 py-0.5">↩ REWORK</span>
          )}
          {po.approvalRequired && !po.approvedAt && (
            <span className="text-[9px] font-black text-yellow-400 bg-yellow-500/10 border border-yellow-500/25 rounded px-1.5 py-0.5">NEEDS APPROVAL</span>
          )}
        </div>
        <div className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-zinc-400">{po.vendorName}</span>
          <span>·</span>
          <span>{po.items.length} line{po.items.length !== 1 ? 's' : ''}</span>
          {po.requiredDate && (
            <>
              <span>·</span>
              <span className={overdue ? 'text-red-400 font-semibold' : ''}>
                need by {fmtDate(po.requiredDate)}
              </span>
            </>
          )}
          {po.expectedDate && po.expectedDate !== po.requiredDate && (
            <>
              <span>·</span>
              <span className="text-zinc-600">vendor est. {fmtDate(po.expectedDate)}</span>
            </>
          )}
          {po.isRework && po.reworkOfNumber && (
            <>
              <span>·</span>
              <span className="text-violet-400 flex items-center gap-0.5">↩ from {po.reworkOfNumber}{po.reworkReason ? ` — ${po.reworkReason}` : ''}</span>
            </>
          )}
          {linkedJobs.length > 0 && (
            <>
              <span>·</span>
              <span className="text-blue-400 flex items-center gap-0.5"><Link2 className="w-2.5 h-2.5" />{linkedJobs.map(j => j.poNumber || j.id.slice(-4)).slice(0,2).join(', ')}{linkedJobs.length > 2 ? ` +${linkedJobs.length-2}` : ''}</span>
            </>
          )}
        </div>
      </button>

      {/* Total */}
      <div className="shrink-0 text-right hidden sm:block">
        <p className="text-sm sm:text-base font-black text-amber-400 tabular">{fmtMoneyK(po.total)}</p>
      </div>

      {/* Quick actions — visible on hover */}
      <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {quickAction && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onQuickAdvance(quickAction.to); }}
            className="text-[10px] font-black bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-zinc-300 hover:text-white px-2 py-1 rounded-md whitespace-nowrap flex items-center gap-1"
            title={`Quick advance to ${STATUS_META[quickAction.to].label}`}
          >
            <ArrowRight className="w-3 h-3" /> {quickAction.label}
          </button>
        )}
        {['sent','acknowledged','in-progress','partially-received'].includes(po.status) && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onReceive(); }}
            className="text-[10px] font-black bg-emerald-900/40 hover:bg-emerald-900/70 border border-emerald-500/30 text-emerald-400 px-2 py-1 rounded-md whitespace-nowrap flex items-center gap-1"
            title="Record receipt"
          >
            <Truck className="w-3 h-3" /> Receive
          </button>
        )}
        {['received','closed','partially-received'].includes(po.status) && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onRework(); }}
            className="text-[10px] font-black bg-violet-900/40 hover:bg-violet-900/70 border border-violet-500/30 text-violet-400 px-2 py-1 rounded-md whitespace-nowrap flex items-center gap-1"
            title="Create a rework PO from this one"
          >
            ↩ Rework
          </button>
        )}
        <button type="button" onClick={e => { e.stopPropagation(); onDuplicate(); }} title="Duplicate" className="text-zinc-600 hover:text-blue-400 p-1.5">
          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <button type="button" onClick={e => { e.stopPropagation(); onDelete(); }} title="Delete" className="text-zinc-600 hover:text-red-400 p-1.5">
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════
// Receiving modal — focused per-line received qty entry
// ══════════════════════════════════════════════════════════════════════
const ReceivingModal: React.FC<{
  po: PurchaseOrder;
  currentUser: { id: string; name: string; role: string };
  onClose: () => void;
  onSave: (po: PurchaseOrder) => void;
}> = ({ po, currentUser, onClose, onSave }) => {
  const [items, setItems] = useState<POLineItem[]>(po.items.map(i => ({ ...i, receivedQty: i.receivedQty ?? i.quantity })));
  const [note, setNote] = useState('');
  const [shipVia, setShipVia] = useState(po.shipVia || '');
  const [tracking, setTracking] = useState(po.trackingNumber || '');

  const allFull = items.every(i => (i.receivedQty ?? 0) >= i.quantity);
  const anyReceived = items.some(i => (i.receivedQty ?? 0) > 0);

  const handleSave = () => {
    const newStatus: POStatus = !anyReceived ? po.status : allFull ? 'received' : 'partially-received';
    const entry = {
      status: newStatus,
      timestamp: Date.now(),
      userId: currentUser.id,
      userName: currentUser.name,
      note: note || (allFull ? 'All items received' : 'Partial receipt'),
    };
    const updated: PurchaseOrder = {
      ...po,
      items,
      status: newStatus,
      statusHistory: [...(po.statusHistory || []), ...(newStatus !== po.status ? [entry] : [])],
      receivedDate: allFull ? Date.now() : po.receivedDate,
      shipVia: shipVia || po.shipVia,
      trackingNumber: tracking || po.trackingNumber,
      updatedAt: Date.now(),
    };
    onSave(updated);
  };

  const updateReceivedQty = (idx: number, qty: number) => {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, receivedQty: Math.max(0, Math.min(qty, item.quantity)) } : item));
  };

  const markAllReceived = () => setItems(prev => prev.map(i => ({ ...i, receivedQty: i.quantity })));

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="sm:max-w-xl"
      header={
        <div className="flex items-center gap-2">
          <Truck className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-black text-white">Receive Against {po.poNumber}</h2>
            <p className="text-[10px] text-zinc-500 mt-0.5">{po.vendorName}</p>
          </div>
        </div>
      }
      footer={
        <>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-white text-xs font-bold px-3 py-2">Cancel</button>
          <button type="button" onClick={markAllReceived} className="text-xs font-bold text-emerald-400 hover:text-white px-3 py-2">Mark All Received</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!anyReceived}
            className="flex-1 bg-emerald-700 hover:bg-emerald-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-4 py-2 rounded-lg text-sm font-bold"
          >
            {allFull ? 'Mark Fully Received' : 'Save Partial Receipt'}
          </button>
        </>
      }
    >
      {/* Summary */}
      {allFull ? (
        <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-3 py-2 text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> All quantities filled — will mark as Received
        </div>
      ) : anyReceived ? (
        <div className="bg-teal-500/10 border border-teal-500/25 rounded-lg px-3 py-2 text-xs text-teal-300 flex items-center gap-2">
          <Truck className="w-3.5 h-3.5 shrink-0" /> Partial quantities — will mark as Partially Received
        </div>
      ) : null}

      {/* Line items */}
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_80px_80px] gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 px-1">
          <span>Line Item</span>
          <span className="text-right">Ordered</span>
          <span className="text-right">Received</span>
        </div>
        {items.map((item, idx) => {
          const full = (item.receivedQty ?? 0) >= item.quantity;
          return (
            <div key={item.id} className={`grid grid-cols-[1fr_80px_80px] gap-2 items-center bg-zinc-950/40 border rounded-lg px-3 py-2.5 ${full ? 'border-emerald-500/25' : 'border-white/10'}`}>
              <div className="min-w-0">
                <p className="text-xs text-white font-semibold truncate">{item.description}</p>
                {item.partNumber && <p className="text-[10px] text-zinc-500">{item.partNumber}</p>}
              </div>
              <div className="text-right text-sm font-mono text-zinc-400">{item.quantity} <span className="text-[10px]">{item.unit || 'ea'}</span></div>
              <div className="flex justify-end">
                <input
                  type="number"
                  value={item.receivedQty ?? item.quantity}
                  onChange={e => updateReceivedQty(idx, Number(e.target.value))}
                  min="0"
                  max={item.quantity}
                  step="1"
                  className={`w-20 bg-zinc-950 border rounded px-2 py-1 text-sm font-mono text-right text-white ${full ? 'border-emerald-500/40' : 'border-white/10'}`}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Shipping info */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Ship Via</Label>
          <input
            type="text"
            value={shipVia}
            onChange={e => setShipVia(e.target.value)}
            placeholder="UPS Ground, Freight, Pickup…"
            className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <Label>Tracking #</Label>
          <input
            type="text"
            value={tracking}
            onChange={e => setTracking(e.target.value)}
            placeholder="1Z…"
            className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono"
          />
        </div>
      </div>

      <div>
        <Label>Receipt Note <span className="text-zinc-600 normal-case font-normal">(optional — added to status history)</span></Label>
        <input
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="e.g. Short-shipped on line 2, vendor to re-order"
          className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
        />
      </div>
    </Modal>
  );
};

// ══════════════════════════════════════════════════════════════════════
// PO Editor modal
// ══════════════════════════════════════════════════════════════════════
interface EditorProps {
  existing: PurchaseOrder | null;
  allPOs: PurchaseOrder[];
  vendors: Vendor[];
  jobs: Job[];
  settings: SystemSettings;
  currentUser: { id: string; name: string; role: string };
  onClose: () => void;
  onSave: (po: PurchaseOrder) => void;
  addToast: Props['addToast'];
}

const PurchaseOrderEditor: React.FC<EditorProps> = ({
  existing, allPOs, vendors, jobs, settings, currentUser, onClose, onSave, addToast,
}) => {
  const seed = useMemo<PurchaseOrder>(() => existing || {
    id: `po_${Date.now()}`,
    poNumber: DB.nextPurchaseOrderNumber(allPOs),
    status: 'draft',
    vendorId: vendors[0]?.id || '',
    vendorName: vendors[0]?.name || '',
    billTo: {
      name: settings.companyName || '',
      address: settings.companyAddress,
      phone: settings.companyPhone,
      email: settings.companyEmail,
    },
    orderedDate: Date.now(),
    items: [],
    subtotal: 0,
    total: 0,
    terms: vendors[0]?.defaultTerms || settings.defaultPaymentTerms || 'Net 30',
    createdBy: currentUser.id,
    createdByName: currentUser.name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }, [existing, allPOs, vendors, settings, currentUser]);

  const [po, setPO] = useState<PurchaseOrder>(seed);
  const [jobSearch, setJobSearch] = useState('');

  // Recompute totals on items / tax / shipping change
  useEffect(() => {
    const subtotal = po.items.reduce((a, i) => a + i.total, 0);
    const taxAmt = subtotal * (po.taxRate || 0) / 100;
    const total = subtotal + taxAmt + (po.shippingAmt || 0);
    if (subtotal !== po.subtotal || taxAmt !== po.taxAmt || total !== po.total) {
      setPO(p => ({ ...p, subtotal, taxAmt, total }));
    }
  }, [po.items, po.taxRate, po.shippingAmt]);

  const update = (patch: Partial<PurchaseOrder>) => setPO(p => ({ ...p, ...patch }));

  const pickVendor = (vendorId: string) => {
    const v = vendors.find(x => x.id === vendorId);
    if (!v) return;
    setPO(p => ({
      ...p,
      vendorId: v.id,
      vendorName: v.name,
      vendorContact: { name: v.contactPerson, email: v.email, phone: v.phone, address: v.address },
      terms: (!p.terms || p.terms === vendors.find(x => x.id === p.vendorId)?.defaultTerms) ? (v.defaultTerms || p.terms) : p.terms,
    }));
  };

  // Line items
  const addLineItem = () => update({ items: [...po.items, { id: `li_${Date.now()}`, description: '', quantity: 1, unit: 'ea', unitPrice: 0, total: 0 }] });
  const updateLineItem = (idx: number, patch: Partial<POLineItem>) => {
    const items = [...po.items];
    const merged = { ...items[idx], ...patch };
    merged.total = (merged.quantity || 0) * (merged.unitPrice || 0);
    items[idx] = merged;
    update({ items });
  };
  const removeLineItem = (idx: number) => update({ items: po.items.filter((_, i) => i !== idx) });

  // QA
  const toggleQa = (req: string) => {
    const cur = po.qualityRequirements || [];
    update({ qualityRequirements: cur.includes(req) ? cur.filter(q => q !== req) : [...cur, req] });
  };

  // Attachments
  const addAttachment = async (files: FileList | null, target: 'po' | { lineIdx: number }) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      if (file.size > 5_000_000) { addToast('error', `${file.name}: max 5 MB`); continue; }
      const reader = new FileReader();
      await new Promise<void>(resolve => {
        reader.onload = () => {
          const att: POAttachment = {
            id: `att_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
            name: file.name, url: reader.result as string,
            mimeType: file.type, size: file.size,
            kind: /pdf|dwg|step|iges|sldprt|sldasm/i.test(file.name) ? 'drawing' : 'other',
          };
          if (target === 'po') {
            update({ attachments: [...(po.attachments || []), att] });
          } else {
            const items = [...po.items];
            items[target.lineIdx] = { ...items[target.lineIdx], attachments: [...(items[target.lineIdx].attachments || []), att] };
            update({ items });
          }
          resolve();
        };
        reader.readAsDataURL(file);
      });
    }
  };
  const removeAttachment = (attId: string, target: 'po' | { lineIdx: number }) => {
    if (target === 'po') {
      update({ attachments: (po.attachments || []).filter(a => a.id !== attId) });
    } else {
      const items = [...po.items];
      items[target.lineIdx] = { ...items[target.lineIdx], attachments: (items[target.lineIdx].attachments || []).filter(a => a.id !== attId) };
      update({ items });
    }
  };

  // Status advance
  const advanceStatus = (to: POStatus, note?: string) => {
    const entry = { status: to, timestamp: Date.now(), userId: currentUser.id, userName: currentUser.name, note };
    update({ status: to, statusHistory: [...(po.statusHistory || []), entry], ...(to === 'received' ? { receivedDate: Date.now() } : {}) });
  };

  // Job linking — checkbox toggle
  const toggleJob = (jobId: string) => {
    const cur = po.linkedJobIds || [];
    update({ linkedJobIds: cur.includes(jobId) ? cur.filter(id => id !== jobId) : [...cur, jobId] });
  };

  // Vendor mailto
  const vendorMailto = po.vendorContact?.email
    ? `mailto:${po.vendorContact.email}?subject=${encodeURIComponent(po.poNumber)}&body=${encodeURIComponent(`Hi,\n\nPlease find Purchase Order ${po.poNumber} attached.\n\nTotal: $${po.total.toFixed(2)}\nRequired by: ${po.requiredDate || 'TBD'}\n\nThank you.`)}`
    : null;

  const handleSave = () => {
    if (!po.vendorId) { addToast('error', 'Pick a vendor before saving'); return; }
    if (po.items.length === 0) { addToast('error', 'Add at least one line item'); return; }
    if (po.items.some(i => !i.description.trim())) { addToast('error', 'Every line item needs a description'); return; }
    onSave({ ...po, updatedAt: Date.now() });
  };

  const overdueWarning = isOverdue(po);
  const activeStep = STATUS_META[po.status].step;
  const filteredJobs = useMemo(() => {
    const q = jobSearch.trim().toLowerCase();
    return jobs.filter(j => j.status !== 'completed').filter(j =>
      !q || (j.poNumber || '').toLowerCase().includes(q) ||
      (j.customer || '').toLowerCase().includes(q) ||
      (j.partNumber || '').toLowerCase().includes(q)
    ).slice(0, 40);
  }, [jobs, jobSearch]);

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="sm:max-w-4xl"
      header={
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Package className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm sm:text-base font-black text-white truncate">{existing ? `Edit ${po.poNumber}` : 'New Purchase Order'}</h2>
            <p className="text-[10px] text-zinc-600 mt-0.5">
              {po.vendorName || 'No vendor selected'} · by {po.createdByName.split(' ')[0]}
              {overdueWarning && <span className="text-red-400 font-bold ml-2">⚠ OVERDUE</span>}
            </p>
          </div>
          {/* Status stepper */}
          {po.status !== 'cancelled' && (
            <div className="hidden sm:flex items-center gap-0.5 ml-auto shrink-0">
              {STEPPER_STATUSES.map((s, i) => {
                const done = activeStep > i;
                const current = activeStep === i;
                return (
                  <React.Fragment key={s}>
                    {i > 0 && <div className={`w-4 h-px ${done ? 'bg-amber-500' : 'bg-zinc-700'}`} />}
                    <button
                      type="button"
                      onClick={() => { if (!current) advanceStatus(s); }}
                      title={STATUS_META[s].label}
                      className={`w-2 h-2 rounded-full transition-all ${current ? 'w-3 h-3 bg-amber-500 ring-2 ring-amber-500/30' : done ? 'bg-amber-500/70' : 'bg-zinc-700 hover:bg-zinc-500'}`}
                    />
                  </React.Fragment>
                );
              })}
              <span className="text-[9px] text-zinc-500 ml-2 font-bold uppercase tracking-widest">{STATUS_META[po.status].label}</span>
            </div>
          )}
        </div>
      }
      footer={
        <>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-white text-xs font-bold px-3 py-2">Cancel</button>
          <button
            type="button"
            onClick={() => printPurchaseOrderPDF(po, settings)}
            disabled={po.items.length === 0 || !po.vendorId}
            className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 border border-white/10"
          >
            <Printer className="w-3.5 h-3.5" aria-hidden="true" /> Print
          </button>
          {vendorMailto && (
            <a
              href={vendorMailto}
              className="bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 border border-white/10"
              title="Open in email client"
            >
              <Mail className="w-3.5 h-3.5" aria-hidden="true" /> Email Vendor
            </a>
          )}
          {po.status === 'draft' && (
            <button type="button" onClick={() => { advanceStatus('sent', 'Marked as sent'); handleSave(); }} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5" aria-hidden="true" /> Save & Mark Sent
            </button>
          )}
          <button type="button" onClick={handleSave} className="flex-1 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white px-4 py-2 rounded-lg text-sm font-bold">
            {existing ? 'Save Changes' : 'Create Draft'}
          </button>
        </>
      }
    >
      {/* Overdue warning */}
      {overdueWarning && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-xs text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <strong>Overdue</strong> — required {po.requiredDate} has passed and this PO is still {STATUS_META[po.status].label.toLowerCase()}.
        </div>
      )}

      {/* Rework origin banner */}
      {po.isRework && po.reworkOfNumber && (
        <div className="bg-violet-500/10 border border-violet-500/30 rounded-lg px-3 py-2 text-xs text-violet-300 flex items-center gap-2">
          <span className="text-base">↩</span>
          <div>
            <strong>Rework PO</strong> — cloned from <span className="font-mono">{po.reworkOfNumber}</span>
            {po.reworkReason && <span className="text-violet-400"> · {po.reworkReason}</span>}
            . All items are tagged <code className="bg-violet-900/40 px-1 rounded">[REWORK]</code> — update descriptions or quantities as needed before sending to vendor.
          </div>
        </div>
      )}

      {/* ── SECTION: Vendor & Dates ── */}
      <section>
        <SectionHeader icon={<Store className="w-3.5 h-3.5" />} title="Vendor & Dates" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Vendor *</Label>
            {vendors.length === 0 ? (
              <div className="bg-yellow-500/10 border border-yellow-500/25 rounded-lg p-2.5 text-[11px] text-yellow-300">
                No vendors yet — add one under Settings → Production → Vendors first.
              </div>
            ) : (
              <select
                value={po.vendorId}
                onChange={e => pickVendor(e.target.value)}
                className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="">— Pick a vendor —</option>
                {vendors.map(v => (
                  <option key={v.id} value={v.id}>{v.name}{v.categories?.[0] ? ` · ${v.categories[0]}` : ''}</option>
                ))}
              </select>
            )}
            {po.vendorContact && (
              <div className="flex items-center gap-3 mt-1.5">
                {po.vendorContact.email && (
                  <a href={`mailto:${po.vendorContact.email}`} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 truncate">
                    <Mail className="w-3 h-3 shrink-0" />{po.vendorContact.email}
                  </a>
                )}
                {po.vendorContact.phone && (
                  <a href={`tel:${po.vendorContact.phone}`} className="text-[10px] text-zinc-400 hover:text-white flex items-center gap-1 shrink-0">
                    <Phone className="w-3 h-3" />{po.vendorContact.phone}
                  </a>
                )}
              </div>
            )}
          </div>
          <div>
            <Label>PO Number</Label>
            <input type="text" value={po.poNumber} onChange={e => update({ poNumber: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white tabular font-bold" />
          </div>
          <div>
            <Label>Required By <span className="text-zinc-600 font-normal normal-case">(when WE need it)</span></Label>
            <input
              type="date"
              value={po.requiredDate ? toISODate(po.requiredDate) : ''}
              onChange={e => update({ requiredDate: fromISODate(e.target.value) })}
              className={`w-full bg-zinc-950 border rounded-lg px-3 py-2 text-sm text-white ${overdueWarning ? 'border-red-500/50' : 'border-white/10'}`}
            />
          </div>
          <div>
            <Label>Vendor Est. Date <span className="text-zinc-600 font-normal normal-case">(their promise)</span></Label>
            <input
              type="date"
              value={po.expectedDate ? toISODate(po.expectedDate) : ''}
              onChange={e => update({ expectedDate: fromISODate(e.target.value) })}
              className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
        </div>
      </section>

      {/* ── SECTION: Line Items ── */}
      <section>
        <SectionHeader
          icon={<FileText className="w-3.5 h-3.5" />}
          title={`Line Items (${po.items.length})`}
          action={
            <button type="button" onClick={addLineItem} className="text-[11px] font-bold text-amber-400 hover:text-white flex items-center gap-1">
              <Plus className="w-3 h-3" aria-hidden="true" /> Add Line
            </button>
          }
        />
        <div className="space-y-3">
          {po.items.length === 0 && (
            <button type="button" onClick={addLineItem} className="w-full bg-zinc-950/40 border border-dashed border-white/10 hover:border-amber-500/30 rounded-lg p-4 text-center text-xs text-zinc-500 hover:text-amber-400 transition-colors flex items-center justify-center gap-2">
              <Plus className="w-3.5 h-3.5" /> Click to add first line item
            </button>
          )}
          {po.items.map((item, idx) => (
            <LineItemEditor
              key={item.id}
              item={item}
              index={idx}
              onChange={(patch) => updateLineItem(idx, patch)}
              onRemove={() => removeLineItem(idx)}
              onAttach={(files) => addAttachment(files, { lineIdx: idx })}
              onRemoveAttachment={(attId) => removeAttachment(attId, { lineIdx: idx })}
            />
          ))}
        </div>
      </section>

      {/* ── SECTION: Totals ── */}
      <section>
        <SectionHeader icon={<Package className="w-3.5 h-3.5" />} title="Totals" />
        <div className="bg-zinc-950/60 border border-white/10 rounded-lg p-3 space-y-2">
          <TotalRow label="Subtotal" value={`$${po.subtotal.toFixed(2)}`} />
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">Tax</span>
              <input type="number" value={po.taxRate || 0} onChange={e => update({ taxRate: Number(e.target.value) })} className="w-14 bg-zinc-950 border border-white/10 rounded px-1.5 py-0.5 text-xs text-white tabular" step="0.1" min="0" max="100" />
              <span className="text-zinc-500 text-xs">%</span>
            </div>
            <span className="font-mono text-zinc-400">${(po.taxAmt || 0).toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">Shipping</span>
              <span className="text-zinc-500 text-xs">$</span>
              <input type="number" value={po.shippingAmt || 0} onChange={e => update({ shippingAmt: Number(e.target.value) })} className="w-20 bg-zinc-950 border border-white/10 rounded px-1.5 py-0.5 text-xs text-white tabular" step="0.01" min="0" />
            </div>
            <span className="font-mono text-zinc-400">${(po.shippingAmt || 0).toFixed(2)}</span>
          </div>
          <div className="border-t border-white/10 pt-2 flex items-center justify-between text-base">
            <span className="font-black text-white">Total</span>
            <span className="font-mono font-black text-amber-400 tabular text-lg">${po.total.toFixed(2)}</span>
          </div>
        </div>
      </section>

      {/* ── SECTION: Quality Requirements ── */}
      <section>
        <SectionHeader icon={<CheckCircle2 className="w-3.5 h-3.5" />} title="Quality Requirements" subtitle="Printed on PO · applies to whole order" />
        <div className="flex flex-wrap gap-1.5">
          {DEFAULT_QUALITY_REQUIREMENTS.map(req => {
            const picked = po.qualityRequirements?.includes(req);
            return (
              <button key={req} type="button" onClick={() => toggleQa(req)} aria-pressed={picked}
                className={`text-[10px] font-bold px-2 py-1 rounded-md border transition-all ${picked ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-zinc-950 border-white/10 text-zinc-500 hover:text-white'}`}>
                {req}
              </button>
            );
          })}
        </div>
      </section>

      {/* ── SECTION: Instructions & Terms ── */}
      <section>
        <SectionHeader icon={<AlertCircle className="w-3.5 h-3.5" />} title="Instructions & Terms" />
        <div className="space-y-3">
          <div>
            <Label>Special Instructions <span className="text-zinc-600 normal-case font-normal">(printed)</span></Label>
            <textarea rows={2} value={po.instructions || ''} onChange={e => update({ instructions: e.target.value })}
              className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              placeholder="e.g. Call on arrival · Deliver to back dock · Separate packaging per line" />
          </div>
          <div>
            <Label>Payment Terms <span className="text-zinc-600 normal-case font-normal">(printed)</span></Label>
            <textarea rows={2} value={po.terms || ''} onChange={e => update({ terms: e.target.value })}
              className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              placeholder="Net 30. Prices firm. Defective goods returned at vendor expense." />
          </div>
          <div>
            <Label>Internal Notes <span className="text-zinc-600 normal-case font-normal">(NOT printed)</span></Label>
            <textarea rows={2} value={po.internalNotes || ''} onChange={e => update({ internalNotes: e.target.value })}
              className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              placeholder="For your team only" />
          </div>
        </div>
      </section>

      {/* ── SECTION: PO-level attachments ── */}
      <section>
        <SectionHeader icon={<Paperclip className="w-3.5 h-3.5" />} title={`PO Attachments (${(po.attachments || []).length})`} subtitle="Blanket docs, master T&Cs, general specs" />
        <AttachmentsEditor list={po.attachments || []} onAdd={(files) => addAttachment(files, 'po')} onRemove={(id) => removeAttachment(id, 'po')} />
      </section>

      {/* ── SECTION: Link to Jobs ── */}
      {jobs.length > 0 && (
        <section>
          <SectionHeader icon={<Link2 className="w-3.5 h-3.5" />} title="Linked Jobs" subtitle="Which customer jobs is this PO for?" />
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
              <input
                type="search"
                value={jobSearch}
                onChange={e => setJobSearch(e.target.value)}
                placeholder="Filter by PO #, customer, part #…"
                className="w-full bg-zinc-950 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-xs text-white"
              />
            </div>
            {(po.linkedJobIds || []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(po.linkedJobIds || []).map(jid => {
                  const j = jobs.find(x => x.id === jid);
                  if (!j) return null;
                  return (
                    <span key={jid} className="inline-flex items-center gap-1.5 bg-blue-500/15 border border-blue-500/30 text-blue-300 text-[10px] font-bold px-2 py-1 rounded-full">
                      {j.poNumber || jid.slice(-4)}{j.customer ? ` · ${j.customer}` : ''}
                      <button type="button" onClick={() => toggleJob(jid)} className="hover:text-white" aria-label="Unlink">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="max-h-48 overflow-y-auto space-y-0.5 border border-white/5 rounded-lg bg-zinc-950/40 p-1">
              {filteredJobs.length === 0 && (
                <p className="text-[11px] text-zinc-600 p-2 text-center">No open jobs match that search</p>
              )}
              {filteredJobs.map(j => {
                const linked = (po.linkedJobIds || []).includes(j.id);
                return (
                  <button
                    key={j.id}
                    type="button"
                    onClick={() => toggleJob(j.id)}
                    className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-colors text-xs ${linked ? 'bg-blue-500/15 text-blue-300' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}
                  >
                    <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${linked ? 'bg-blue-500 border-blue-500' : 'border-zinc-600'}`}>
                      {linked && <CheckCircle2 className="w-2.5 h-2.5 text-white" />}
                    </span>
                    <span className="font-mono font-semibold">{j.poNumber || '—'}</span>
                    {j.partNumber && <span className="text-zinc-500">· {j.partNumber}</span>}
                    {j.customer && <span className="text-zinc-500 truncate">· {j.customer}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── SECTION: Status Actions ── */}
      {po.vendorId && po.items.length > 0 && (
        <section>
          <SectionHeader icon={<Clock className="w-3.5 h-3.5" />} title="Status Actions" />
          <div className="flex flex-wrap gap-2">
            {(['sent','acknowledged','in-progress','partially-received','received','closed','cancelled'] as POStatus[])
              .filter(s => s !== po.status)
              .map(s => {
                const m = STATUS_META[s];
                return (
                  <button key={s} type="button" onClick={() => advanceStatus(s)}
                    className={`text-[10px] font-black border rounded-md px-2.5 py-1.5 transition-colors hover:brightness-125 flex items-center gap-1.5 ${m.color}`}>
                    <ArrowRight className="w-3 h-3" /> {m.label}
                  </button>
                );
              })}
          </div>
          {po.statusHistory && po.statusHistory.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[10px] font-bold text-zinc-500 uppercase tracking-widest hover:text-zinc-400">
                History ({po.statusHistory.length} event{po.statusHistory.length !== 1 ? 's' : ''})
              </summary>
              <ul className="mt-2 space-y-1 border-l-2 border-white/5 ml-2 pl-3">
                {po.statusHistory.slice().reverse().map((h, i) => (
                  <li key={i} className="text-[10px] text-zinc-500 flex items-center gap-2 flex-wrap">
                    <span className={`font-black border rounded px-1.5 py-0.5 ${STATUS_META[h.status].color}`}>{STATUS_META[h.status].label}</span>
                    <span>{new Date(h.timestamp).toLocaleString()}</span>
                    <span>by {h.userName.split(' ')[0]}</span>
                    {h.note && <em className="italic text-zinc-600">— {h.note}</em>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </Modal>
  );
};

// ── Line item editor ──
const LineItemEditor: React.FC<{
  item: POLineItem;
  index: number;
  onChange: (patch: Partial<POLineItem>) => void;
  onRemove: () => void;
  onAttach: (files: FileList | null) => void;
  onRemoveAttachment: (id: string) => void;
}> = ({ item, index, onChange, onRemove, onAttach, onRemoveAttachment }) => {
  const [expanded, setExpanded] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const presetsRef = useRef<HTMLDivElement>(null);
  const toggleQa = (req: string) => {
    const cur = item.qualityReqs || [];
    onChange({ qualityReqs: cur.includes(req) ? cur.filter(q => q !== req) : [...cur, req] });
  };
  // Close preset picker when clicking outside
  React.useEffect(() => {
    if (!showPresets) return;
    const handler = (e: MouseEvent) => {
      if (presetsRef.current && !presetsRef.current.contains(e.target as Node)) setShowPresets(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPresets]);

  return (
    <div className="bg-zinc-950/40 border border-white/10 rounded-lg p-3 space-y-2">
      {/* Quick-pick preset descriptions */}
      {showPresets && (
        <div ref={presetsRef} className="mb-1 bg-zinc-900 border border-amber-500/30 rounded-lg p-3 shadow-xl z-10 relative">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest flex items-center gap-1">
              <Zap className="w-3 h-3" /> Quick Pick Description
            </span>
            <button type="button" onClick={() => setShowPresets(false)} className="text-zinc-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PRESET_DESCRIPTIONS.map(group => (
              <div key={group.label}>
                <div className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-1">{group.label}</div>
                <div className="flex flex-col gap-0.5">
                  {group.items.map(desc => (
                    <button key={desc} type="button"
                      onClick={() => { onChange({ description: desc }); setShowPresets(false); }}
                      className="text-left text-xs text-zinc-300 hover:text-white hover:bg-white/5 px-2 py-1 rounded transition-colors">
                      {desc}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-start gap-2">
        <span className="shrink-0 w-6 h-6 rounded-md bg-zinc-800 border border-white/10 text-zinc-400 flex items-center justify-center text-[10px] font-black mt-1">{index + 1}</span>
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_100px_90px_110px] gap-2">
          <div className="relative">
            <input type="text" value={item.description} onChange={e => onChange({ description: e.target.value })}
              placeholder="Description — or click ⚡ for presets"
              className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-1.5 pr-8 text-sm text-white" />
            <button type="button" onClick={() => setShowPresets(p => !p)}
              title="Quick-pick preset description"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-amber-400 transition-colors">
              <Zap className="w-3.5 h-3.5" />
            </button>
          </div>
          <input type="text" value={item.partNumber || ''} onChange={e => onChange({ partNumber: e.target.value })}
            placeholder="Part #" className="bg-zinc-950 border border-white/10 rounded px-2 py-1.5 text-xs text-white" />
          <div className="flex gap-1">
            <input type="number" value={item.quantity} onChange={e => onChange({ quantity: Number(e.target.value) })}
              min="0" step="any" className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-1.5 text-xs text-white tabular" />
            <select value={item.unit || 'ea'} onChange={e => onChange({ unit: e.target.value })}
              className="bg-zinc-950 border border-white/10 rounded px-1 py-1.5 text-xs text-white">
              {['ea','lb','hr','ft','lot','kg','in'].map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <input type="number" value={item.unitPrice} onChange={e => onChange({ unitPrice: Number(e.target.value) })}
            placeholder="Unit $" min="0" step="0.01"
            className="bg-zinc-950 border border-white/10 rounded px-2 py-1.5 text-xs text-white tabular" />
        </div>
        <div className="shrink-0 text-right min-w-[56px]">
          <span className="text-[10px] text-zinc-500 block">Total</span>
          <span className="font-mono font-bold text-amber-400 tabular text-sm">${item.total.toFixed(2)}</span>
        </div>
        <button type="button" onClick={onRemove} aria-label="Remove line" className="shrink-0 text-zinc-600 hover:text-red-400 p-1 mt-1">
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
      <button type="button" onClick={() => setExpanded(e => !e)}
        className="text-[10px] font-black text-zinc-500 hover:text-white uppercase tracking-widest flex items-center gap-1">
        <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden="true" />
        Line Details
        {(item.qualityReqs?.length || 0) > 0 && <span className="text-emerald-400 normal-case tracking-normal">· {item.qualityReqs!.length} QA req</span>}
        {(item.attachments?.length || 0) > 0 && <span className="text-blue-400 normal-case tracking-normal">· {item.attachments!.length} file</span>}
        {item.instructions && <span className="text-amber-400 normal-case tracking-normal">· notes</span>}
      </button>
      {expanded && (
        <div className="space-y-2 pl-6 pt-1 border-l-2 border-white/5 ml-3">
          <div>
            <Label>Per-line Instructions</Label>
            <input type="text" value={item.instructions || ''} onChange={e => onChange({ instructions: e.target.value })}
              placeholder="e.g. Mark with 'J12' per drawing rev C"
              className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-1.5 text-xs text-white" />
          </div>
          <div>
            <Label>Quality Requirements (this line)</Label>
            <div className="flex flex-wrap gap-1">
              {DEFAULT_QUALITY_REQUIREMENTS.slice(0, 8).map(req => {
                const picked = item.qualityReqs?.includes(req);
                return (
                  <button key={req} type="button" onClick={() => toggleQa(req)} aria-pressed={picked}
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded border transition-all ${picked ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-zinc-950 border-white/10 text-zinc-500 hover:text-white'}`}>
                    {req.replace(/\s*\(.*\)/, '')}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <Label>Drawings / Specs</Label>
            <AttachmentsEditor list={item.attachments || []} onAdd={onAttach} onRemove={onRemoveAttachment} />
          </div>
        </div>
      )}
    </div>
  );
};

// ── Shared attachment editor ──
const AttachmentsEditor: React.FC<{
  list: POAttachment[];
  onAdd: (files: FileList | null) => void;
  onRemove: (id: string) => void;
}> = ({ list, onAdd, onRemove }) => (
  <div className="space-y-1.5">
    <label className="flex items-center gap-2 bg-zinc-950 border border-dashed border-white/10 hover:border-blue-500/40 rounded-lg px-3 py-2 cursor-pointer transition-colors">
      <Upload className="w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
      <span className="text-[11px] text-zinc-500">Drop or click to attach · PDF · DWG · images · max 5 MB each</span>
      <input type="file" multiple accept=".pdf,.dwg,.step,.stp,.iges,.igs,.sldprt,.sldasm,image/*" onChange={e => onAdd(e.target.files)} className="hidden" />
    </label>
    {list.length > 0 && (
      <ul className="space-y-1">
        {list.map(att => (
          <li key={att.id} className="flex items-center gap-2 bg-zinc-950/40 border border-white/5 rounded px-2 py-1.5">
            <Paperclip className="w-3 h-3 text-zinc-500 shrink-0" aria-hidden="true" />
            <a href={att.url} download={att.name} className="flex-1 min-w-0 text-xs text-blue-300 hover:text-white truncate">{att.name}</a>
            <span className="text-[9px] text-zinc-600 tabular shrink-0">{Math.round(att.size / 1024)} KB</span>
            <button type="button" onClick={() => onRemove(att.id)} aria-label={`Remove ${att.name}`} className="text-zinc-600 hover:text-red-400 p-0.5 shrink-0">
              <X className="w-3 h-3" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    )}
  </div>
);

// ── Empty state ──
const EmptyState: React.FC<{ hasAny: boolean }> = ({ hasAny }) => (
  <div className="bg-gradient-to-br from-amber-500/5 via-orange-500/5 to-transparent border border-white/10 rounded-2xl p-6 sm:p-8">
    <div className="flex items-start gap-4">
      <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
        <Package className="w-6 h-6 text-amber-400" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-base sm:text-lg font-black text-white">{hasAny ? 'No POs match that filter' : 'No purchase orders yet'}</h3>
        <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
          {hasAny ? 'Try a different status or clear the search.' : 'Create a PO when you outsource work (heat treat, plating) or buy material. Every PO tracks status from draft → received and prints as a proper document.'}
        </p>
        {!hasAny && (
          <ul className="mt-4 space-y-2 text-xs text-zinc-400">
            {['Add vendors under Settings → Production → Vendors',
              'Create a PO — pick vendor, add line items with qty + price',
              'Tag quality requirements (CoC, FAI, Mat-Cert) — prints on the PO',
              'Mark Sent → vendor gets it → Mark Received when parts arrive'].map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-amber-400 font-black mt-0.5">{i+1}.</span><span>{s}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  </div>
);

// ── Shared primitives ──
const Kpi: React.FC<{ label: string; value: string; hint: string; color: string; icon: React.ReactNode; flash?: boolean }> = ({ label, value, hint, color, icon, flash }) => (
  <div className={`bg-gradient-to-br from-zinc-900/60 to-zinc-900/30 border rounded-2xl p-3 sm:p-4 overflow-hidden ${flash ? 'border-red-500/30' : 'border-white/5'}`}>
    <div className="flex items-center justify-between gap-2 mb-1">
      <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest truncate">{label}</p>
      <span className={color}>{icon}</span>
    </div>
    <p className={`text-xl sm:text-2xl font-black tabular leading-tight ${color} ${flash ? 'animate-pulse' : ''}`}>{value}</p>
    <p className="text-[10px] text-zinc-600 mt-0.5 truncate">{hint}</p>
  </div>
);

const FilterBtn: React.FC<{ label: string; count: number; active: boolean; onClick: () => void; danger?: boolean }> = ({ label, count, active, onClick, danger }) => (
  <button type="button" onClick={onClick} aria-pressed={active}
    className={`px-3 py-1.5 text-xs font-bold rounded whitespace-nowrap transition-colors ${active ? (danger ? 'bg-red-600 text-white' : 'bg-amber-600 text-white') : (danger ? 'text-red-400 hover:text-white' : 'text-zinc-500 hover:text-white')}`}>
    {label} ({count})
  </button>
);

const TotalRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between text-sm">
    <span className="text-zinc-500">{label}</span>
    <span className="font-mono font-bold text-white">{value}</span>
  </div>
);

const SectionHeader: React.FC<{ icon: React.ReactNode; title: string; subtitle?: string; action?: React.ReactNode }> = ({ icon, title, subtitle, action }) => (
  <div className="flex items-center justify-between gap-3 mb-2">
    <div className="min-w-0">
      <p className="text-[11px] font-black text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
        <span className="text-amber-400">{icon}</span>{title}
      </p>
      {subtitle && <p className="text-[10px] text-zinc-600 mt-0.5 truncate">{subtitle}</p>}
    </div>
    {action}
  </div>
);

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">{children}</label>
);
