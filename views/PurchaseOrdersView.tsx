// ═════════════════════════════════════════════════════════════════════
// Purchase Orders — outbound POs WE send to vendors.
//
// Full workflow:
//   • List view with status filter + search
//   • PO editor with vendor picker, line items, QA checklist, attachments
//   • Status lifecycle actions (draft → sent → acknowledged → received → closed)
//   • Per-line blueprint attachments so each part has its own drawing
//   • Approval flow (optional)
//   • Printable PO
// ═════════════════════════════════════════════════════════════════════

import React, { useEffect, useMemo, useState } from 'react';
import {
  Package, Plus, Search, Trash2, Edit2, FileText, Paperclip, AlertCircle,
  CheckCircle2, Clock, XCircle, Truck, Printer, Copy, ChevronRight, Store, Upload, X,
} from 'lucide-react';
import type {
  PurchaseOrder, POLineItem, POStatus, POAttachment, Vendor, SystemSettings, Job,
} from '../types';
import { DEFAULT_QUALITY_REQUIREMENTS } from '../types';
import * as DB from '../services/mockDb';
import { Modal } from '../components/Modal';
import { fmtMoneyK } from '../utils/format';
import { printPurchaseOrderPDF } from '../services/pdfService';

interface Props {
  user: { id: string; name: string; role: string };
  addToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

// Status display metadata — colors + labels for badges everywhere.
const STATUS_META: Record<POStatus, { label: string; color: string; icon: any }> = {
  'draft':              { label: 'Draft',       color: 'bg-zinc-700/30 border-zinc-600/40 text-zinc-400', icon: Edit2 },
  'sent':               { label: 'Sent',        color: 'bg-blue-500/15 border-blue-500/30 text-blue-400', icon: FileText },
  'acknowledged':       { label: 'Acknowledged',color: 'bg-purple-500/15 border-purple-500/30 text-purple-400', icon: CheckCircle2 },
  'in-progress':        { label: 'In Progress', color: 'bg-amber-500/15 border-amber-500/30 text-amber-400', icon: Clock },
  'partially-received': { label: 'Partial Recv',color: 'bg-teal-500/15 border-teal-500/30 text-teal-400', icon: Truck },
  'received':           { label: 'Received',    color: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400', icon: CheckCircle2 },
  'closed':             { label: 'Closed',      color: 'bg-zinc-800 border-white/10 text-zinc-500', icon: CheckCircle2 },
  'cancelled':          { label: 'Cancelled',   color: 'bg-red-500/15 border-red-500/30 text-red-400', icon: XCircle },
};

export const PurchaseOrdersView: React.FC<Props> = ({ user, addToast }) => {
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [settings, setSettings] = useState<SystemSettings>(DB.getSettings());
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<'all' | POStatus>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const u1 = DB.subscribePurchaseOrders(setPos);
    const u2 = DB.subscribeVendors(setVendors);
    const u3 = DB.subscribeJobs(setJobs);
    const u4 = DB.subscribeSettings(setSettings);
    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  // KPI math — top strip so the page has shape even with zero POs.
  const openValue = useMemo(
    () => pos.filter(p => ['sent','acknowledged','in-progress','partially-received'].includes(p.status))
      .reduce((a, p) => a + (p.total || 0), 0),
    [pos],
  );
  const thirtyDaysAgo = Date.now() - 30 * 86_400_000;
  const closedMonth = useMemo(
    () => pos.filter(p => p.status === 'received' || p.status === 'closed').filter(p => (p.createdAt || 0) >= thirtyDaysAgo).length,
    [pos, thirtyDaysAgo],
  );
  const draftCount = useMemo(() => pos.filter(p => p.status === 'draft').length, [pos]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pos.filter(p => {
      if (filter !== 'all' && p.status !== filter) return false;
      if (!q) return true;
      return p.poNumber.toLowerCase().includes(q)
        || p.vendorName.toLowerCase().includes(q)
        || p.items.some(i => (i.partNumber || '').toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
    });
  }, [pos, filter, search]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: pos.length };
    for (const p of pos) counts[p.status] = (counts[p.status] || 0) + 1;
    return counts;
  }, [pos]);

  const handleDelete = async (p: PurchaseOrder) => {
    if (!confirm(`Delete ${p.poNumber}? Audit history will be lost.`)) return;
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
    };
    await DB.savePurchaseOrder(copy);
    addToast('success', `Created ${newNumber}`);
    setEditing(copy);
  };

  return (
    <div className="space-y-5 animate-fade-in w-full">
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
        <Kpi label="Open Value" value={fmtMoneyK(openValue)} hint="pending delivery" color="text-amber-400" icon={<Package className="w-4 h-4" />} />
        <Kpi label="Drafts" value={String(draftCount)} hint="unsent" color="text-zinc-400" icon={<Edit2 className="w-4 h-4" />} />
        <Kpi label="Received (30d)" value={String(closedMonth)} hint="completed" color="text-emerald-400" icon={<CheckCircle2 className="w-4 h-4" />} />
        <Kpi label="Total POs" value={String(pos.length)} hint="all-time" color="text-blue-400" icon={<FileText className="w-4 h-4" />} />
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
          {(['all', 'draft', 'sent', 'in-progress', 'received', 'closed'] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              aria-pressed={filter === s}
              className={`px-3 py-1.5 text-xs font-bold rounded whitespace-nowrap transition-colors ${filter === s ? 'bg-amber-600 text-white' : 'text-zinc-500 hover:text-white'}`}
            >
              {s === 'all' ? 'All' : STATUS_META[s as POStatus].label} ({statusCounts[s === 'all' ? 'all' : s] || 0})
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState hasAny={pos.length > 0} />
      ) : (
        <div className="space-y-2">
          {filtered.map(p => {
            const meta = STATUS_META[p.status];
            const Icon = meta.icon;
            return (
              <div
                key={p.id}
                className="bg-zinc-900/50 border border-white/5 rounded-2xl p-3 sm:p-4 flex items-center gap-3 hover:bg-white/[0.03] hover:border-white/10 transition-all group"
              >
                <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center border ${meta.color}`}>
                  <Icon className="w-5 h-5" aria-hidden="true" />
                </div>

                <button
                  type="button"
                  onClick={() => setEditing(p)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-black text-white tabular text-sm sm:text-base">{p.poNumber}</span>
                    <span className={`text-[9px] font-black border rounded px-1.5 py-0.5 ${meta.color}`}>{meta.label}</span>
                    {p.approvalRequired && !p.approvedAt && (
                      <span className="text-[9px] font-black text-yellow-400 bg-yellow-500/10 border border-yellow-500/25 rounded px-1.5 py-0.5">NEEDS APPROVAL</span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
                    {p.vendorName} · {p.items.length} line{p.items.length !== 1 ? 's' : ''}
                    {p.requiredDate && ` · need by ${p.requiredDate}`}
                    {p.createdByName && ` · by ${p.createdByName.split(' ')[0]}`}
                  </div>
                </button>

                <div className="shrink-0 text-right">
                  <p className="text-sm sm:text-base font-black text-amber-400 tabular">{fmtMoneyK(p.total)}</p>
                </div>

                <button
                  type="button"
                  onClick={() => handleDuplicate(p)}
                  aria-label={`Duplicate ${p.poNumber}`}
                  title="Duplicate"
                  className="shrink-0 text-zinc-600 hover:text-blue-400 p-2 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Copy className="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(p)}
                  aria-label={`Delete ${p.poNumber}`}
                  title="Delete"
                  className="shrink-0 text-zinc-600 hover:text-red-400 p-2 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      )}

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
    </div>
  );
};

// ── Empty state ──
const EmptyState: React.FC<{ hasAny: boolean }> = ({ hasAny }) => (
  <div className="bg-gradient-to-br from-amber-500/5 via-orange-500/5 to-transparent border border-white/10 rounded-2xl p-6 sm:p-8">
    <div className="flex items-start gap-4">
      <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
        <Package className="w-6 h-6 text-amber-400" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-base sm:text-lg font-black text-white">
          {hasAny ? 'No POs match that filter' : 'No purchase orders yet'}
        </h3>
        <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
          {hasAny
            ? 'Try a different status or clear the search.'
            : 'Create a PO when you need to outsource work (heat treat, plating) or buy raw material. Every PO gets a unique number, tracks status from draft → received, and prints as a proper document for the vendor.'}
        </p>
        {!hasAny && (
          <ul className="mt-4 space-y-2 text-xs text-zinc-400">
            <li className="flex items-start gap-2"><span className="text-amber-400 font-black mt-0.5">1.</span><span><strong className="text-zinc-200">Add vendors</strong> under Settings → Production → Vendors (heat treat shop, plater, material supplier)</span></li>
            <li className="flex items-start gap-2"><span className="text-amber-400 font-black mt-0.5">2.</span><span><strong className="text-zinc-200">Create a PO</strong> — pick vendor, add line items with qty + price, attach drawings per line</span></li>
            <li className="flex items-start gap-2"><span className="text-amber-400 font-black mt-0.5">3.</span><span><strong className="text-zinc-200">Tag quality requirements</strong> — CoC, FAI, Mat-Cert — prints on the PO the vendor receives</span></li>
            <li className="flex items-start gap-2"><span className="text-amber-400 font-black mt-0.5">4.</span><span><strong className="text-zinc-200">Send</strong> → status flips to "Sent" · when parts arrive, mark Received</span></li>
          </ul>
        )}
      </div>
    </div>
  </div>
);

// ── KPI tile ──
const Kpi: React.FC<{ label: string; value: string; hint: string; color: string; icon: React.ReactNode }> = ({ label, value, hint, color, icon }) => (
  <div className="bg-gradient-to-br from-zinc-900/60 to-zinc-900/30 border border-white/5 rounded-2xl p-3 sm:p-4 overflow-hidden">
    <div className="flex items-center justify-between gap-2 mb-1">
      <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest truncate">{label}</p>
      <span className={color}>{icon}</span>
    </div>
    <p className={`text-xl sm:text-2xl font-black tabular leading-tight ${color}`}>{value}</p>
    <p className="text-[10px] text-zinc-600 mt-0.5 truncate">{hint}</p>
  </div>
);

// ═══════════════════════════════════════════════════════════════════
// ── PO Editor Modal ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

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

  // Recompute totals whenever items / tax / shipping change.
  useEffect(() => {
    const subtotal = po.items.reduce((a, i) => a + i.total, 0);
    const taxAmt = subtotal * (po.taxRate || 0) / 100;
    const total = subtotal + taxAmt + (po.shippingAmt || 0);
    if (subtotal !== po.subtotal || taxAmt !== po.taxAmt || total !== po.total) {
      setPO(p => ({ ...p, subtotal, taxAmt, total }));
    }
  }, [po.items, po.taxRate, po.shippingAmt]);

  const update = (patch: Partial<PurchaseOrder>) => setPO(p => ({ ...p, ...patch }));

  // Vendor pick also copies their default terms + contact snapshot
  const pickVendor = (vendorId: string) => {
    const v = vendors.find(x => x.id === vendorId);
    if (!v) return;
    setPO(p => ({
      ...p,
      vendorId: v.id,
      vendorName: v.name,
      vendorContact: {
        name: v.contactPerson,
        email: v.email,
        phone: v.phone,
        address: v.address,
      },
      // Only overwrite terms if still on the previous vendor's default
      terms: (!p.terms || p.terms === vendors.find(x => x.id === p.vendorId)?.defaultTerms) ? (v.defaultTerms || p.terms) : p.terms,
    }));
  };

  // ── Line items ──
  const addLineItem = () => {
    const newItem: POLineItem = {
      id: `li_${Date.now()}`,
      description: '',
      quantity: 1,
      unit: 'ea',
      unitPrice: 0,
      total: 0,
    };
    update({ items: [...po.items, newItem] });
  };

  const updateLineItem = (idx: number, patch: Partial<POLineItem>) => {
    const items = [...po.items];
    const merged = { ...items[idx], ...patch };
    // Auto-compute line total on qty / unitPrice change
    merged.total = (merged.quantity || 0) * (merged.unitPrice || 0);
    items[idx] = merged;
    update({ items });
  };

  const removeLineItem = (idx: number) => update({ items: po.items.filter((_, i) => i !== idx) });

  // ── PO-level quality requirement toggle ──
  const toggleQa = (req: string) => {
    const cur = po.qualityRequirements || [];
    update({ qualityRequirements: cur.includes(req) ? cur.filter(q => q !== req) : [...cur, req] });
  };

  // ── File attachments ──
  const addAttachment = async (files: FileList | null, target: 'po' | { lineIdx: number }) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      if (file.size > 5_000_000) {
        addToast('error', `${file.name}: file too large (max 5MB)`);
        continue;
      }
      const reader = new FileReader();
      await new Promise<void>((resolve) => {
        reader.onload = () => {
          const att: POAttachment = {
            id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            name: file.name,
            url: reader.result as string,
            mimeType: file.type,
            size: file.size,
            kind: /pdf|dwg|step|iges|sldprt|sldasm/i.test(file.name) ? 'drawing' : 'other',
          };
          if (target === 'po') {
            update({ attachments: [...(po.attachments || []), att] });
          } else {
            const items = [...po.items];
            items[target.lineIdx] = {
              ...items[target.lineIdx],
              attachments: [...(items[target.lineIdx].attachments || []), att],
            };
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
      items[target.lineIdx] = {
        ...items[target.lineIdx],
        attachments: (items[target.lineIdx].attachments || []).filter(a => a.id !== attId),
      };
      update({ items });
    }
  };

  const advanceStatus = (to: POStatus, note?: string) => {
    const entry = { status: to, timestamp: Date.now(), userId: currentUser.id, userName: currentUser.name, note };
    update({
      status: to,
      statusHistory: [...(po.statusHistory || []), entry],
      ...(to === 'received' ? { receivedDate: Date.now() } : {}),
    });
  };

  const handleSave = () => {
    if (!po.vendorId) { alert('Pick a vendor'); return; }
    if (po.items.length === 0) { alert('Add at least one line item'); return; }
    if (po.items.some(i => !i.description.trim())) { alert('Every line item needs a description'); return; }
    onSave(po);
  };

  const statusMeta = STATUS_META[po.status];

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="sm:max-w-4xl"
      icon={<Package className="w-4 h-4 text-amber-400" aria-hidden="true" />}
      header={
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Package className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-black text-white truncate">{existing ? `Edit ${po.poNumber}` : 'New Purchase Order'}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-[9px] font-black border rounded px-1.5 py-0.5 ${statusMeta.color}`}>{statusMeta.label}</span>
              <span className="text-[10px] text-zinc-600">by {po.createdByName.split(' ')[0]}</span>
            </div>
          </div>
        </div>
      }
      footer={
        <>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-white text-xs font-bold px-3 py-2">Cancel</button>
          <button
            type="button"
            onClick={() => printPurchaseOrderPDF(po, settings)}
            disabled={po.items.length === 0 || !po.vendorId}
            title="Print / PDF the PO to send to the vendor"
            className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 border border-white/10"
          >
            <Printer className="w-3.5 h-3.5" aria-hidden="true" /> Print
          </button>
          {po.status === 'draft' && (
            <button type="button" onClick={() => { advanceStatus('sent', 'Marked as sent'); handleSave(); }} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg text-xs font-bold">
              Save & Mark Sent
            </button>
          )}
          <button type="button" onClick={handleSave} className="flex-1 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white px-4 py-2 rounded-lg text-sm font-bold">
            {existing ? 'Save Changes' : 'Create Draft'}
          </button>
        </>
      }
    >
      {/* Vendor + dates */}
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
            {po.vendorContact && (po.vendorContact.email || po.vendorContact.phone) && (
              <p className="text-[10px] text-zinc-500 mt-1 truncate">
                {po.vendorContact.name || ''} {po.vendorContact.email ? `· ${po.vendorContact.email}` : ''} {po.vendorContact.phone ? `· ${po.vendorContact.phone}` : ''}
              </p>
            )}
          </div>
          <div>
            <Label>PO Number</Label>
            <input type="text" value={po.poNumber} onChange={e => update({ poNumber: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white tabular font-bold" />
          </div>
          <div>
            <Label>Required By</Label>
            <input
              type="date"
              value={po.requiredDate ? toISODate(po.requiredDate) : ''}
              onChange={e => update({ requiredDate: fromISODate(e.target.value) })}
              className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <Label>Expected Date <span className="text-zinc-600 normal-case font-normal">(vendor confirm)</span></Label>
            <input
              type="date"
              value={po.expectedDate ? toISODate(po.expectedDate) : ''}
              onChange={e => update({ expectedDate: fromISODate(e.target.value) })}
              className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
        </div>
      </section>

      {/* Line items */}
      <section>
        <SectionHeader icon={<FileText className="w-3.5 h-3.5" />} title={`Line Items (${po.items.length})`} action={
          <button type="button" onClick={addLineItem} className="text-[11px] font-bold text-amber-400 hover:text-white flex items-center gap-1">
            <Plus className="w-3 h-3" aria-hidden="true" /> Add Line
          </button>
        } />
        <div className="space-y-3">
          {po.items.length === 0 && (
            <div className="bg-zinc-950/40 border border-dashed border-white/10 rounded-lg p-4 text-center text-xs text-zinc-500">
              No line items yet. Click "Add Line" to start.
            </div>
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

      {/* Quality requirements */}
      <section>
        <SectionHeader icon={<CheckCircle2 className="w-3.5 h-3.5" />} title="Quality Requirements" subtitle="Printed on PO · applies to whole order" />
        <div className="flex flex-wrap gap-1.5">
          {DEFAULT_QUALITY_REQUIREMENTS.map(req => {
            const picked = po.qualityRequirements?.includes(req);
            return (
              <button
                key={req}
                type="button"
                onClick={() => toggleQa(req)}
                aria-pressed={picked}
                className={`text-[10px] font-bold px-2 py-1 rounded-md border transition-all ${picked ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-zinc-950 border-white/10 text-zinc-500 hover:text-white'}`}
              >
                {req}
              </button>
            );
          })}
        </div>
      </section>

      {/* Instructions + Terms */}
      <section>
        <SectionHeader icon={<AlertCircle className="w-3.5 h-3.5" />} title="Instructions & Terms" />
        <div className="space-y-3">
          <div>
            <Label>Special Instructions <span className="text-zinc-600 normal-case font-normal">(printed)</span></Label>
            <textarea
              rows={2}
              value={po.instructions || ''}
              onChange={e => update({ instructions: e.target.value })}
              className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              placeholder="e.g. Call on arrival · Deliver to back dock · Separate packaging per line"
            />
          </div>
          <div>
            <Label>Terms & Conditions <span className="text-zinc-600 normal-case font-normal">(printed)</span></Label>
            <textarea
              rows={2}
              value={po.terms || ''}
              onChange={e => update({ terms: e.target.value })}
              className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              placeholder="Net 30. Prices firm. Defective goods returned at vendor expense."
            />
          </div>
          <div>
            <Label>Internal Notes <span className="text-zinc-600 normal-case font-normal">(NOT printed)</span></Label>
            <textarea
              rows={2}
              value={po.internalNotes || ''}
              onChange={e => update({ internalNotes: e.target.value })}
              className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              placeholder="For your team's eyes only"
            />
          </div>
        </div>
      </section>

      {/* PO-level attachments (terms, blanket docs) */}
      <section>
        <SectionHeader icon={<Paperclip className="w-3.5 h-3.5" />} title={`PO Attachments (${(po.attachments || []).length})`} subtitle="Blanket docs, master T&Cs, general specs" />
        <AttachmentsEditor
          list={po.attachments || []}
          onAdd={(files) => addAttachment(files, 'po')}
          onRemove={(id) => removeAttachment(id, 'po')}
        />
      </section>

      {/* Jobs link */}
      {jobs.length > 0 && (
        <section>
          <SectionHeader icon={<ChevronRight className="w-3.5 h-3.5" />} title="Link to Internal Jobs" subtitle="Which customer job(s) is this PO for?" />
          <select
            multiple
            size={Math.min(6, Math.max(3, jobs.filter(j => j.status !== 'completed').length))}
            value={po.linkedJobIds || []}
            onChange={e => update({ linkedJobIds: Array.from(e.target.selectedOptions).map(o => (o as HTMLOptionElement).value) })}
            className="w-full bg-zinc-950 border border-white/10 rounded-lg px-2 py-2 text-xs text-white"
          >
            {jobs.filter(j => j.status !== 'completed').slice(0, 50).map(j => (
              <option key={j.id} value={j.id}>{j.poNumber} · {j.partNumber}{j.customer ? ` · ${j.customer}` : ''}</option>
            ))}
          </select>
          <p className="text-[10px] text-zinc-600 mt-1">Ctrl/Cmd-click to select multiple</p>
        </section>
      )}

      {/* Totals */}
      <section>
        <SectionHeader icon={<Package className="w-3.5 h-3.5" />} title="Totals" />
        <div className="bg-zinc-950/60 border border-white/10 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-500">Subtotal</span>
            <span className="font-mono font-bold text-white">${po.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">Tax</span>
              <input
                type="number"
                value={po.taxRate || 0}
                onChange={e => update({ taxRate: Number(e.target.value) })}
                className="w-14 bg-zinc-950 border border-white/10 rounded px-1.5 py-0.5 text-xs text-white tabular"
                step="0.1"
                min="0"
                max="100"
              /><span className="text-zinc-500 text-xs">%</span>
            </div>
            <span className="font-mono text-zinc-400">${(po.taxAmt || 0).toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">Shipping</span>
              <span className="text-zinc-500 text-xs">$</span>
              <input
                type="number"
                value={po.shippingAmt || 0}
                onChange={e => update({ shippingAmt: Number(e.target.value) })}
                className="w-20 bg-zinc-950 border border-white/10 rounded px-1.5 py-0.5 text-xs text-white tabular"
                step="0.01"
                min="0"
              />
            </div>
            <span className="font-mono text-zinc-400">${(po.shippingAmt || 0).toFixed(2)}</span>
          </div>
          <div className="border-t border-white/10 pt-2 flex items-center justify-between text-base">
            <span className="font-black text-white">Total</span>
            <span className="font-mono font-black text-amber-400 tabular">${po.total.toFixed(2)}</span>
          </div>
        </div>
      </section>

      {/* Status lifecycle — only show once vendor + items are set */}
      {po.vendorId && po.items.length > 0 && (
        <section>
          <SectionHeader icon={<Clock className="w-3.5 h-3.5" />} title="Status Actions" />
          <div className="flex flex-wrap gap-2">
            {(['sent','acknowledged','in-progress','partially-received','received','closed','cancelled'] as POStatus[])
              .filter(s => s !== po.status)
              .map(s => {
                const m = STATUS_META[s];
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => advanceStatus(s)}
                    className={`text-[10px] font-black border rounded-md px-2 py-1 transition-colors hover:brightness-125 ${m.color}`}
                  >
                    → {m.label}
                  </button>
                );
              })}
          </div>
          {po.statusHistory && po.statusHistory.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[10px] font-bold text-zinc-500 uppercase tracking-widest hover:text-zinc-400">
                Status History ({po.statusHistory.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {po.statusHistory.slice().reverse().map((h, i) => (
                  <li key={i} className="text-[10px] text-zinc-500 flex items-center gap-2">
                    <span className={`font-black border rounded px-1.5 py-0.5 ${STATUS_META[h.status].color}`}>{STATUS_META[h.status].label}</span>
                    <span>{new Date(h.timestamp).toLocaleString()}</span>
                    <span>by {h.userName.split(' ')[0]}</span>
                    {h.note && <em className="italic">— {h.note}</em>}
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

  const toggleQa = (req: string) => {
    const cur = item.qualityReqs || [];
    onChange({ qualityReqs: cur.includes(req) ? cur.filter(q => q !== req) : [...cur, req] });
  };

  return (
    <div className="bg-zinc-950/40 border border-white/10 rounded-lg p-3 space-y-2">
      {/* Line 1 — core fields */}
      <div className="flex items-start gap-2">
        <span className="shrink-0 w-6 h-6 rounded-md bg-zinc-800 border border-white/10 text-zinc-400 flex items-center justify-center text-[10px] font-black mt-1">{index + 1}</span>
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_100px_90px_110px] gap-2">
          <input
            type="text"
            value={item.description}
            onChange={e => onChange({ description: e.target.value })}
            placeholder="Description (e.g. heat treat part #ABC to 62 HRC)"
            className="bg-zinc-950 border border-white/10 rounded px-2 py-1.5 text-sm text-white"
          />
          <input
            type="text"
            value={item.partNumber || ''}
            onChange={e => onChange({ partNumber: e.target.value })}
            placeholder="Part #"
            className="bg-zinc-950 border border-white/10 rounded px-2 py-1.5 text-xs text-white"
          />
          <div className="flex gap-1">
            <input
              type="number"
              value={item.quantity}
              onChange={e => onChange({ quantity: Number(e.target.value) })}
              min="0"
              step="any"
              className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-1.5 text-xs text-white tabular"
            />
            <select
              value={item.unit || 'ea'}
              onChange={e => onChange({ unit: e.target.value })}
              className="bg-zinc-950 border border-white/10 rounded px-1 py-1.5 text-xs text-white"
            >
              <option value="ea">ea</option>
              <option value="lb">lb</option>
              <option value="hr">hr</option>
              <option value="ft">ft</option>
              <option value="lot">lot</option>
            </select>
          </div>
          <input
            type="number"
            value={item.unitPrice}
            onChange={e => onChange({ unitPrice: Number(e.target.value) })}
            placeholder="Unit $"
            min="0"
            step="0.01"
            className="bg-zinc-950 border border-white/10 rounded px-2 py-1.5 text-xs text-white tabular"
          />
        </div>
        <div className="shrink-0 text-right">
          <span className="text-xs text-zinc-500 block">Total</span>
          <span className="font-mono font-bold text-amber-400 tabular text-sm">${item.total.toFixed(2)}</span>
        </div>
        <button type="button" onClick={onRemove} aria-label="Remove line" className="shrink-0 text-zinc-600 hover:text-red-400 p-1 mt-1">
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Expand to show per-line QA + instructions + drawings */}
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="text-[10px] font-black text-zinc-500 hover:text-white uppercase tracking-widest flex items-center gap-1"
      >
        <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden="true" />
        Line Details
        {(item.qualityReqs?.length || 0) > 0 && <span className="text-emerald-400 normal-case tracking-normal">· {item.qualityReqs!.length} QA</span>}
        {(item.attachments?.length || 0) > 0 && <span className="text-blue-400 normal-case tracking-normal">· {item.attachments!.length} file</span>}
        {item.instructions && <span className="text-amber-400 normal-case tracking-normal">· notes</span>}
      </button>

      {expanded && (
        <div className="space-y-2 pl-6 pt-1 border-l-2 border-white/5 ml-3">
          <div>
            <Label>Per-line Instructions</Label>
            <input
              type="text"
              value={item.instructions || ''}
              onChange={e => onChange({ instructions: e.target.value })}
              placeholder="e.g. Mark with 'J12' per drawing rev C"
              className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-1.5 text-xs text-white"
            />
          </div>
          <div>
            <Label>Quality Requirements (this line)</Label>
            <div className="flex flex-wrap gap-1">
              {DEFAULT_QUALITY_REQUIREMENTS.slice(0, 8).map(req => {
                const picked = item.qualityReqs?.includes(req);
                return (
                  <button
                    key={req}
                    type="button"
                    onClick={() => toggleQa(req)}
                    aria-pressed={picked}
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded border transition-all ${picked ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-zinc-950 border-white/10 text-zinc-500 hover:text-white'}`}
                  >
                    {req.replace(/\s*\(.*\)/, '')}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <Label>Drawings / Specs</Label>
            <AttachmentsEditor
              list={item.attachments || []}
              onAdd={onAttach}
              onRemove={onRemoveAttachment}
            />
          </div>
        </div>
      )}
    </div>
  );
};

// ── Attachments editor (shared by PO-level + line-level) ──
const AttachmentsEditor: React.FC<{
  list: POAttachment[];
  onAdd: (files: FileList | null) => void;
  onRemove: (id: string) => void;
}> = ({ list, onAdd, onRemove }) => (
  <div className="space-y-1.5">
    <label className="flex items-center gap-2 bg-zinc-950 border border-dashed border-white/10 hover:border-blue-500/40 rounded-lg px-3 py-2 cursor-pointer transition-colors">
      <Upload className="w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
      <span className="text-[11px] text-zinc-500">Drop or click to attach · PDF · DWG · images · max 5MB each</span>
      <input
        type="file"
        multiple
        accept=".pdf,.dwg,.step,.stp,.iges,.igs,.sldprt,.sldasm,image/*"
        onChange={e => onAdd(e.target.files)}
        className="hidden"
      />
    </label>
    {list.length > 0 && (
      <ul className="space-y-1">
        {list.map(att => (
          <li key={att.id} className="flex items-center gap-2 bg-zinc-950/40 border border-white/5 rounded px-2 py-1.5">
            <Paperclip className="w-3 h-3 text-zinc-500 shrink-0" aria-hidden="true" />
            <a href={att.url} download={att.name} className="flex-1 min-w-0 text-xs text-blue-300 hover:text-white truncate">
              {att.name}
            </a>
            <span className="text-[9px] text-zinc-600 tabular shrink-0">{Math.round(att.size / 1024)}KB</span>
            <button
              type="button"
              onClick={() => onRemove(att.id)}
              aria-label={`Remove ${att.name}`}
              className="text-zinc-600 hover:text-red-400 p-0.5 shrink-0"
            >
              <X className="w-3 h-3" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    )}
  </div>
);

// ── Helpers ──
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

// Date helpers — stored as MM/DD/YYYY, HTML input wants YYYY-MM-DD
function toISODate(d: string): string {
  // "MM/DD/YYYY" → "YYYY-MM-DD"
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return d;
}
function fromISODate(d: string): string {
  // "YYYY-MM-DD" → "MM/DD/YYYY"
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  return d;
}
