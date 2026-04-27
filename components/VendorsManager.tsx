// ═════════════════════════════════════════════════════════════════════
// Vendors Manager — CRUD for supplier records. Embedded in Settings →
// Production. Same UX pattern as Operations/Clients managers.
// ═════════════════════════════════════════════════════════════════════

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Archive, Store, Mail, Phone, MapPin, Tag } from 'lucide-react';
import type { Vendor } from '../types';
import * as DB from '../services/mockDb';
import { Modal } from './Modal';
import { useConfirm } from './useConfirm';

interface Props {
  addToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

// Suggested categories — admins can type any string, these just pre-fill.
const SUGGESTED_CATEGORIES = [
  'Heat Treat', 'Plating', 'Coating', 'Laser / Waterjet', 'Raw Material',
  'Tooling', 'Machining', 'Welding', 'Deburring', 'Inspection',
  'Packaging', 'Freight', 'Other',
];

export const VendorsManager: React.FC<Props> = ({ addToast }) => {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const { confirm: confirmDialog, ConfirmHost } = useConfirm();

  useEffect(() => DB.subscribeVendors(setVendors), []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendors.filter(v => {
      if (!showArchived && v.archived) return false;
      if (!q) return true;
      return v.name.toLowerCase().includes(q)
        || (v.contactPerson || '').toLowerCase().includes(q)
        || (v.email || '').toLowerCase().includes(q)
        || (v.categories || []).some(c => c.toLowerCase().includes(q));
    });
  }, [vendors, search, showArchived]);

  const handleSave = async (v: Vendor) => {
    await DB.saveVendor(v);
    addToast('success', `Saved ${v.name}`);
    setEditing(null);
    setCreating(false);
  };

  const handleDelete = async (v: Vendor) => {
    const ok = await confirmDialog({
      title: `Delete vendor "${v.name}"?`,
      message: "This can't be undone. Consider archiving instead so PO history is preserved.",
      tone: 'danger',
      confirmLabel: 'Delete vendor',
    });
    if (!ok) return;
    await DB.deleteVendor(v.id);
    addToast('info', `Deleted ${v.name}`);
  };

  const toggleArchive = async (v: Vendor) => {
    await DB.saveVendor({ ...v, archived: !v.archived });
    addToast('info', v.archived ? `${v.name} restored` : `${v.name} archived`);
  };

  return (
    <div className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden">
      {ConfirmHost}
      <div className="px-4 py-3 flex items-center justify-between border-b border-white/5 gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Store className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-white">Vendors / Suppliers</p>
            <p className="text-[11px] text-zinc-500">Reusable records for POs — heat treat, plating, material, etc.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowArchived(!showArchived)}
            className={`text-[10px] font-bold px-2 py-1 rounded border transition-colors ${showArchived ? 'bg-white/10 border-white/20 text-white' : 'bg-zinc-900 border-white/10 text-zinc-500 hover:text-white'}`}
          >
            {showArchived ? 'Hide Archived' : 'Show Archived'}
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="text-xs bg-amber-600 hover:bg-amber-500 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5"
          >
            <Plus className="w-3 h-3" aria-hidden="true" /> Add Vendor
          </button>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-white/5">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name / contact / category…"
          className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="p-8 text-center text-xs text-zinc-500">
          {vendors.length === 0
            ? 'No vendors yet. Add your heat-treat shop, plater, material supplier…'
            : 'No vendors match your search.'}
        </div>
      ) : (
        <ul>
          {filtered.map(v => (
            <li key={v.id} className={`px-4 py-3 border-b border-white/5 last:border-b-0 flex items-center gap-3 hover:bg-white/[0.02] ${v.archived ? 'opacity-60' : ''}`}>
              <button
                type="button"
                onClick={() => setEditing(v)}
                className="flex-1 min-w-0 text-left"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-white text-sm truncate">{v.name}</span>
                  {v.archived && <span className="text-[9px] font-black text-zinc-500 bg-zinc-800 border border-white/10 rounded px-1">ARCHIVED</span>}
                  {(v.categories || []).slice(0, 3).map(c => (
                    <span key={c} className="text-[9px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded px-1.5 py-0.5">{c}</span>
                  ))}
                </div>
                <div className="text-[11px] text-zinc-500 truncate mt-0.5">
                  {v.contactPerson || '—'}{v.email ? ` · ${v.email}` : ''}{v.phone ? ` · ${v.phone}` : ''}
                </div>
              </button>
              <button
                type="button"
                onClick={() => toggleArchive(v)}
                aria-label={v.archived ? `Restore ${v.name}` : `Archive ${v.name}`}
                className="text-zinc-600 hover:text-amber-400 p-1.5 shrink-0"
                title={v.archived ? 'Restore' : 'Archive'}
              >
                <Archive className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => handleDelete(v)}
                aria-label={`Delete ${v.name}`}
                className="text-zinc-600 hover:text-red-400 p-1.5 shrink-0"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {(editing || creating) && (
        <VendorEditor
          existing={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSave={handleSave}
          addToast={addToast}
        />
      )}
    </div>
  );
};

// ── Editor modal ──
const VendorEditor: React.FC<{
  existing: Vendor | null;
  onClose: () => void;
  onSave: (v: Vendor) => void;
  addToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}> = ({ existing, onClose, onSave, addToast }) => {
  const [v, setV] = useState<Vendor>(() => existing || {
    id: `vendor_${Date.now()}`,
    name: '',
    categories: [],
    createdAt: Date.now(),
  });

  const update = (patch: Partial<Vendor>) => setV(p => ({ ...p, ...patch }));

  const toggleCategory = (cat: string) => {
    const cur = v.categories || [];
    update({ categories: cur.includes(cat) ? cur.filter(c => c !== cat) : [...cur, cat] });
  };

  const handleSave = () => {
    if (!v.name.trim()) { addToast('error', 'Vendor name is required'); return; }
    onSave(v);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? `Edit ${existing.name}` : 'Add Vendor'}
      icon={<Store className="w-4 h-4 text-amber-400" aria-hidden="true" />}
      footer={
        <>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-white text-xs font-bold px-3 py-2">Cancel</button>
          <button type="button" onClick={handleSave} className="flex-1 bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-lg text-sm font-bold">
            {existing ? 'Save Changes' : 'Create Vendor'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1.5">Company Name *</label>
          <input
            type="text"
            value={v.name}
            onChange={e => update({ name: e.target.value })}
            className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-bold"
            placeholder="Acme Plating Inc."
            autoFocus
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Contact Person" icon={<Mail className="w-3 h-3" />}>
            <input
              type="text"
              value={v.contactPerson || ''}
              onChange={e => update({ contactPerson: e.target.value })}
              className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              placeholder="Jane Smith"
            />
          </Field>
          <Field label="Email" icon={<Mail className="w-3 h-3" />}>
            <input
              type="email"
              value={v.email || ''}
              onChange={e => update({ email: e.target.value })}
              className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              placeholder="orders@acme.com"
            />
          </Field>
          <Field label="Phone" icon={<Phone className="w-3 h-3" />}>
            <input
              type="tel"
              value={v.phone || ''}
              onChange={e => update({ phone: e.target.value })}
              className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              placeholder="(555) 123-4567"
            />
          </Field>
          <Field label="Website">
            <input
              type="url"
              value={v.website || ''}
              onChange={e => update({ website: e.target.value })}
              className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              placeholder="acmeplating.com"
            />
          </Field>
        </div>

        <Field label="Address" icon={<MapPin className="w-3 h-3" />}>
          <input
            type="text"
            value={v.address || ''}
            onChange={e => update({ address: e.target.value })}
            className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            placeholder="123 Industrial Blvd, City, ST 12345"
          />
        </Field>

        <Field label="Categories — what they do" icon={<Tag className="w-3 h-3" />}>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_CATEGORIES.map(c => {
              const picked = v.categories?.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCategory(c)}
                  aria-pressed={picked}
                  className={`text-[10px] font-bold px-2 py-1 rounded-md border transition-all ${picked ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'bg-zinc-950 border-white/10 text-zinc-500 hover:text-white'}`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Default Terms">
            <input
              type="text"
              value={v.defaultTerms || ''}
              onChange={e => update({ defaultTerms: e.target.value })}
              className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              placeholder="Net 30"
            />
          </Field>
          <Field label="Tax ID (optional)">
            <input
              type="text"
              value={v.taxId || ''}
              onChange={e => update({ taxId: e.target.value })}
              className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              placeholder="EIN / VAT"
            />
          </Field>
        </div>

        <Field label="Internal Notes">
          <textarea
            rows={2}
            value={v.notes || ''}
            onChange={e => update({ notes: e.target.value })}
            className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-y"
            placeholder="Anything your team should remember about this vendor…"
          />
        </Field>
      </div>
    </Modal>
  );
};

const Field: React.FC<{ label: string; icon?: React.ReactNode; children: React.ReactNode }> = ({ label, icon, children }) => (
  <div>
    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
      {icon && <span className="text-zinc-600">{icon}</span>}
      {label}
    </label>
    {children}
  </div>
);
