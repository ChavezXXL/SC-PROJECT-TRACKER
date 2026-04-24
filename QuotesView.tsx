import React, { useState, useEffect } from 'react';
import { Plus, FileText, Send, Check, X, Trash2, Copy, Download, Edit2, Save, ChevronDown, User, MapPin, Phone, Mail, Package, CheckCircle2, Link2, Zap, AlertTriangle, TrendingUp, Clock } from 'lucide-react';
import type { Quote, QuoteLineItem, QuoteStatus, SystemSettings, CustomerContact, ProcessTemplate, QuoteSnippet, QuoteTemplate } from './types';
import * as DB from './services/mockDb';
import { printQuotePDF } from './services/pdfService';
import { fmtMoneyK } from './utils/format';
import { Overlay } from './components/Overlay';

interface QuotesViewProps {
  addToast: (type: 'success' | 'error' | 'info', message: string) => void;
  user: { id: string; name: string };
  onJobCreate: (data: {
    poNumber: string;
    partNumber: string;
    customer: string;
    quantity: number;
    dueDate: string;
    info: string;
    quoteAmount: number;
    linkedQuoteId: string;
    /** Optional stage id to start the job on (pulled from matched process-library category).
     *  If omitted, job starts at the first stage in the pipeline. */
    initialStageId?: string;
    /** Optional list of process names derived from quote items — shown in job notes. */
    processRouting?: string[];
  }) => Promise<void>;
}

const STATUS_STYLES: Record<QuoteStatus, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-zinc-700/30 border-zinc-600/30', text: 'text-zinc-400', label: 'Draft' },
  sent: { bg: 'bg-blue-500/10 border-blue-500/20', text: 'text-blue-400', label: 'Sent' },
  accepted: { bg: 'bg-emerald-500/10 border-emerald-500/20', text: 'text-emerald-400', label: 'Accepted' },
  declined: { bg: 'bg-red-500/10 border-red-500/20', text: 'text-red-400', label: 'Declined' },
  expired: { bg: 'bg-orange-500/10 border-orange-500/20', text: 'text-orange-400', label: 'Expired' },
};

const UNITS = ['ea', 'hr', 'ft', 'lb', 'lot', 'pcs', 'set'];
const emptyLine = (): QuoteLineItem => ({ description: '', qty: 1, unit: 'ea', unitPrice: 0, total: 0 });
const emptyContact = (): CustomerContact => ({ name: '', contactPerson: '', email: '', phone: '', address: '' });

// ── Snippet Inserter ─ dropdown that inserts reusable text blocks into a textarea.
// Filters snippets by target (scope/notes/terms) or shows all when target === 'all'.
const SnippetInserter = ({ snippets, target, onInsert }: { snippets: QuoteSnippet[]; target: 'scope' | 'notes' | 'terms'; onInsert: (text: string) => void }) => {
  const [open, setOpen] = useState(false);
  const applicable = snippets.filter(s => s.target === target || s.target === 'all');
  if (applicable.length === 0) return null;
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-[10px] font-bold text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/15 border border-blue-500/20 px-2 py-1 rounded transition-colors flex items-center gap-1"
        title="Insert a saved snippet"
      >
        ⚡ Insert snippet ({applicable.length})
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-72 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl z-50 max-h-80 overflow-y-auto">
            {applicable.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => { onInsert(s.text); setOpen(false); }}
                className="w-full text-left px-3 py-2 hover:bg-blue-500/10 border-b border-white/5 last:border-0"
              >
                <p className="text-xs font-bold text-white truncate">{s.label}</p>
                <p className="text-[10px] text-zinc-500 truncate mt-0.5">{s.text.slice(0, 80)}…</p>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ── Section Label Component ─ with optional "done" state
const SectionLabel = ({ num, title, sub, done }: { num: number; title: string; sub?: string; done?: boolean }) => (
  <div className="flex items-center gap-3 mb-3">
    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0 transition-colors ${
      done ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30' : 'bg-blue-500/10 text-blue-400'
    }`}>
      {done ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : num}
    </span>
    <div className="min-w-0">
      <h4 className="text-sm font-bold text-white">{title}</h4>
      {sub && <p className="text-[10px] text-zinc-500">{sub}</p>}
    </div>
  </div>
);

// ── Top Stepper ─ shows completion progress across the whole quote form ──
const QuoteStepper = ({ steps, currentIdx, completedCount }: { steps: { num: number; label: string; done: boolean }[]; currentIdx: number; completedCount: number }) => {
  const pct = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0;
  return (
    <div className="px-5 pt-3 pb-4 space-y-2 border-b border-white/5 bg-gradient-to-b from-zinc-800/40 to-transparent">
      {/* Progress percent bar */}
      <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
        <span className={pct >= 100 ? 'text-emerald-400' : 'text-blue-400'}>
          {pct >= 100 ? '✓ Ready to save' : `${completedCount} of ${steps.length} sections complete`}
        </span>
        <span className="text-zinc-500 tabular">{pct}%</span>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${pct >= 100 ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : 'bg-gradient-to-r from-blue-500 to-indigo-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* Step dots — compact horizontal list */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pt-1">
        {steps.map((s, i) => (
          <div key={s.num} className="flex items-center gap-1 shrink-0">
            <div
              title={s.label}
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black transition-all ${
                s.done ? 'bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-500/50' : i === currentIdx ? 'bg-blue-500/30 text-blue-300 ring-1 ring-blue-500/50' : 'bg-zinc-800 text-zinc-500'
              }`}
            >
              {s.done ? <Check className="w-2.5 h-2.5" /> : s.num}
            </div>
            <span className={`text-[10px] font-bold truncate ${s.done ? 'text-emerald-400' : i === currentIdx ? 'text-white' : 'text-zinc-500'}`}>{s.label}</span>
            {i < steps.length - 1 && <span className="text-zinc-700 mx-1">›</span>}
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Contact Input Block ──
const ContactBlock = ({ label, contact, onChange, clients, savedContacts, onSaveContact }: { label: string; contact: CustomerContact; onChange: (c: CustomerContact) => void; clients?: string[]; savedContacts?: Record<string, CustomerContact>; onSaveContact?: (c: CustomerContact) => void }) => {
  // Is the current contact info identical to what's saved? (so we can show "saved" badge)
  const saved = contact.name && savedContacts ? savedContacts[contact.name] : undefined;
  const matchesSaved = saved
    && (saved.contactPerson || '') === (contact.contactPerson || '')
    && (saved.email || '') === (contact.email || '')
    && (saved.phone || '') === (contact.phone || '')
    && (saved.address || '') === (contact.address || '');
  const hasData = !!(contact.contactPerson || contact.email || contact.phone || contact.address);
  return (
    <div className="space-y-2 bg-zinc-800/30 rounded-xl p-4 border border-white/5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">{label}</p>
        {matchesSaved ? (
          <span className="text-[9px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase tracking-widest">
            <CheckCircle2 className="w-2.5 h-2.5" aria-hidden="true" /> Auto-filled from saved
          </span>
        ) : contact.name && hasData && onSaveContact ? (
          <button
            type="button"
            onClick={() => onSaveContact(contact)}
            className="text-[10px] font-bold text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/15 border border-blue-500/20 px-2 py-0.5 rounded transition-colors flex items-center gap-1"
            title="Save this contact info so next time you pick this client, fields auto-fill"
          >
            💾 Save for next time
          </button>
        ) : null}
      </div>
      {clients && clients.length > 0 ? (
        <select value={contact.name} onChange={e => {
          const name = e.target.value;
          const s = savedContacts?.[name];
          if (s) { onChange({ ...s, name }); }
          else { onChange({ ...contact, name }); }
        }} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 text-white text-sm outline-none">
          <option value="">— Select client —</option>
          {clients.sort((a, b) => a.localeCompare(b)).map(c => (
            <option key={c} value={c}>
              {savedContacts?.[c] ? '✓ ' : ''}{c}
            </option>
          ))}
        </select>
      ) : (
        <div className="relative"><User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" /><input value={contact.name} onChange={e => onChange({ ...contact, name: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 pl-9 text-white text-sm outline-none" placeholder="Company or Customer Name" /></div>
      )}
      <div className="relative"><User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" /><input value={contact.contactPerson || ''} onChange={e => onChange({ ...contact, contactPerson: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 pl-9 text-white text-sm outline-none" placeholder="Contact Person" /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="relative"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" /><input value={contact.email || ''} onChange={e => onChange({ ...contact, email: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 pl-9 text-white text-sm outline-none" placeholder="Email" type="email" /></div>
        <div className="relative"><Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" /><input value={contact.phone || ''} onChange={e => onChange({ ...contact, phone: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 pl-9 text-white text-sm outline-none" placeholder="Phone" type="tel" /></div>
      </div>
      <div className="relative"><MapPin className="absolute left-3 top-3 w-3.5 h-3.5 text-zinc-600" /><textarea value={contact.address || ''} onChange={e => onChange({ ...contact, address: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 pl-9 text-white text-sm outline-none min-h-[50px] resize-none" placeholder="Street Address, City, State ZIP" rows={2} /></div>
    </div>
  );
};

export const QuotesView: React.FC<QuotesViewProps> = ({ addToast, user, onJobCreate }) => {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [settings, setSettings] = useState<SystemSettings>(DB.getSettings());
  const [filter, setFilter] = useState<QuoteStatus | 'all'>('all');
  // View mode — list or kanban pipeline (Round 2 #9)
  const [viewMode, setViewMode] = useState<'list' | 'pipeline'>(() => {
    try { return (localStorage.getItem('quotes_view_mode') as 'list' | 'pipeline') || 'list'; } catch { return 'list'; }
  });
  useEffect(() => { try { localStorage.setItem('quotes_view_mode', viewMode); } catch {} }, [viewMode]);
  const [draggingQuoteId, setDraggingQuoteId] = useState<string | null>(null);
  const [hoverStatus, setHoverStatus] = useState<QuoteStatus | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Quote | null>(null);
  const [items, setItems] = useState<QuoteLineItem[]>([emptyLine()]);
  const [billTo, setBillTo] = useState<CustomerContact>(emptyContact());
  const [shipTo, setShipTo] = useState<CustomerContact>(emptyContact());
  const [shipToDifferent, setShipToDifferent] = useState(false);
  const [form, setForm] = useState({ jobDescription: '', notes: '', terms: '', validUntil: '', markupPct: 25, discountPct: 0, taxRate: 0, quoteNumber: '' });
  const [projectFields, setProjectFields] = useState<Record<string, string>>({});
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [modalTab, setModalTab] = useState<'edit' | 'preview' | 'send'>('edit');
  const [sendEmail, setSendEmail] = useState({ to: '', subject: '', body: 'Thank you for your business. Please review the attached quote and let us know if you have any questions.' });
  // UI state for the Process Library picker (Round 1 #2)
  const [showProcessPicker, setShowProcessPicker] = useState(false);
  const [processSearch, setProcessSearch] = useState('');
  // Quote templates (Round 1 #15)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  useEffect(() => {
    const u1 = DB.subscribeQuotes(setQuotes);
    const u2 = DB.subscribeSettings(setSettings);
    return () => { u1(); u2(); };
  }, []);

  // Auto-lapse quotes whose validUntil has passed. Runs once when quotes/settings load.
  // Flips status from 'sent' or 'draft' → 'expired' so the Quotes list reflects reality
  // without the admin having to manually track each one.
  useEffect(() => {
    if (quotes.length === 0) return;
    const now = Date.now();
    const toExpire = quotes.filter(q => {
      if (q.status !== 'sent' && q.status !== 'draft') return false;
      if (!q.validUntil) return false;
      const us = q.validUntil.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      const iso = q.validUntil.match(/^(\d{4})-(\d{2})-(\d{2})/);
      let expiresMs: number;
      if (us) expiresMs = new Date(+us[3], +us[1] - 1, +us[2], 23, 59, 59).getTime();
      else if (iso) expiresMs = new Date(+iso[1], +iso[2] - 1, +iso[3], 23, 59, 59).getTime();
      else { const d = new Date(q.validUntil); if (isNaN(d.getTime())) return false; expiresMs = d.getTime(); }
      return expiresMs < now;
    });
    if (toExpire.length > 0) {
      Promise.all(toExpire.map(q => DB.saveQuote({ ...q, status: 'expired' })))
        .then(() => addToast('info', `${toExpire.length} quote${toExpire.length > 1 ? 's' : ''} auto-expired`))
        .catch(() => {});
    }
  }, [quotes.length]);

  const clients = settings.clients || [];
  const filtered = filter === 'all' ? quotes : quotes.filter(q => q.status === filter);

  // ── Stats ──
  const thisMonth = new Date(); thisMonth.setDate(1); thisMonth.setHours(0, 0, 0, 0);
  const monthQuotes = quotes.filter(q => q.createdAt >= thisMonth.getTime());
  const monthTotal = monthQuotes.reduce((a, q) => a + q.total, 0);
  const acceptedCount = monthQuotes.filter(q => q.status === 'accepted').length;
  const acceptRate = monthQuotes.length > 0 ? Math.round((acceptedCount / monthQuotes.length) * 100) : 0;
  const pendingTotal = quotes.filter(q => q.status === 'sent').reduce((a, q) => a + q.total, 0);

  // ── Form Handlers ──
  const openNew = () => {
    setEditing(null);
    setItems([emptyLine()]);
    setBillTo(emptyContact());
    setShipTo(emptyContact());
    setShipToDifferent(false);
    const nextNum = DB.getNextQuoteNumber(quotes, settings.quotePrefix);
    setForm({ jobDescription: '', notes: '', terms: settings.defaultPaymentTerms || 'Net 30', validUntil: '', markupPct: 25, discountPct: 0, taxRate: settings.taxRate || 0, quoteNumber: nextNum });
    const pf: Record<string, string> = {};
    (settings.customProjectFields || ['Purchase Order', 'Part No.']).forEach(f => pf[f] = '');
    setProjectFields(pf);
    setModalTab('edit');
    setShowModal(true);
  };

  const openEdit = (q: Quote) => {
    setEditing(q);
    setItems(q.items.length > 0 ? q.items : [emptyLine()]);
    setBillTo(q.billTo || { name: q.customer, contactPerson: '', email: '', phone: '', address: '' });
    setShipTo(q.shipTo || emptyContact());
    setShipToDifferent(!!q.shipTo?.name);
    setForm({ jobDescription: q.jobDescription || '', notes: q.notes || '', terms: q.terms || '', validUntil: q.validUntil || '', markupPct: q.markupPct, discountPct: q.discountPct || 0, taxRate: q.taxRate || 0, quoteNumber: q.quoteNumber });
    setProjectFields(q.projectFields || {});
    setSendEmail({ to: q.billTo?.email || '', subject: `Quote ${q.quoteNumber} from ${settings.companyName || 'Our Company'}`, body: 'Thank you for your business. Please review the attached quote and let us know if you have any questions.' });
    setModalTab('edit');
    setShowModal(true);
  };

  // ── Quantity-break tier helper (Round 2 #3) ──
  // Given qty + optional tier table, return the unit price that applies.
  // Uses the highest-qty tier whose minQty <= qty (ascending sort first).
  const resolveTierPrice = (qty: number, tiers: QuoteLineItem['priceTiers'], fallbackUnitPrice: number): number => {
    if (!tiers || tiers.length === 0) return fallbackUnitPrice;
    const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
    let applied = fallbackUnitPrice;
    for (const t of sorted) {
      if (qty >= t.minQty) applied = t.unitPrice;
    }
    return applied;
  };

  const updateItem = (idx: number, field: keyof QuoteLineItem, value: any) => {
    const next = [...items];
    (next[idx] as any)[field] = value;
    // Recalculate total — honor tier pricing if defined
    const current = next[idx];
    const effectiveUnit = resolveTierPrice(current.qty, current.priceTiers, current.unitPrice);
    // If a tier was applied, sync unitPrice to it so the display matches the math
    if (current.priceTiers && current.priceTiers.length > 0 && field === 'qty') {
      current.unitPrice = effectiveUnit;
    }
    current.total = current.qty * effectiveUnit;
    setItems(next);
  };

  // Add a new tier row. Starts at qty 1 if no tiers yet.
  const addTier = (idx: number) => {
    const next = [...items];
    const existing = next[idx].priceTiers || [];
    const lastMinQty = existing.length > 0 ? Math.max(...existing.map(t => t.minQty)) : 0;
    const newTier = { minQty: lastMinQty > 0 ? lastMinQty * 2 : 1, unitPrice: next[idx].unitPrice };
    next[idx].priceTiers = [...existing, newTier].sort((a, b) => a.minQty - b.minQty);
    // Seed the first tier from current unitPrice so math matches
    if (!existing.length) {
      next[idx].priceTiers = [{ minQty: 1, unitPrice: next[idx].unitPrice }, newTier].sort((a, b) => a.minQty - b.minQty);
    }
    setItems(next);
  };

  const updateTier = (itemIdx: number, tierIdx: number, field: 'minQty' | 'unitPrice', value: number) => {
    const next = [...items];
    const tiers = [...(next[itemIdx].priceTiers || [])];
    tiers[tierIdx] = { ...tiers[tierIdx], [field]: value };
    tiers.sort((a, b) => a.minQty - b.minQty);
    next[itemIdx].priceTiers = tiers;
    // Recalculate current row price + total
    const effective = resolveTierPrice(next[itemIdx].qty, tiers, next[itemIdx].unitPrice);
    next[itemIdx].unitPrice = effective;
    next[itemIdx].total = next[itemIdx].qty * effective;
    setItems(next);
  };

  const removeTier = (itemIdx: number, tierIdx: number) => {
    const next = [...items];
    next[itemIdx].priceTiers = (next[itemIdx].priceTiers || []).filter((_, i) => i !== tierIdx);
    if (next[itemIdx].priceTiers!.length === 0) delete next[itemIdx].priceTiers;
    // Recalculate
    const effective = resolveTierPrice(next[itemIdx].qty, next[itemIdx].priceTiers, next[itemIdx].unitPrice);
    next[itemIdx].total = next[itemIdx].qty * effective;
    setItems(next);
  };

  const addItem = () => setItems([...items, emptyLine()]);
  const removeItem = (idx: number) => { if (items.length > 1) setItems(items.filter((_, i) => i !== idx)); };

  // ── Quote Templates (Round 1 #15) ──
  // Save current quote editor state as a reusable template. Keyed by customer for
  // per-client starter setups ("Boeing standard", "walk-in cash", etc.)
  const saveAsTemplate = () => {
    const label = prompt('Name this template:', billTo.name ? `${billTo.name} standard` : 'New template');
    if (!label?.trim()) return;
    const template: QuoteTemplate = {
      id: `qt_${Date.now()}`,
      label: label.trim(),
      customer: billTo.name || undefined,
      items: items.filter(i => i.description.trim()).map(i => ({ ...i })),
      markupPct: form.markupPct,
      discountPct: form.discountPct || undefined,
      taxRate: form.taxRate || undefined,
      terms: form.terms || undefined,
      notes: form.notes || undefined,
      jobDescription: form.jobDescription || undefined,
      createdAt: Date.now(),
    };
    const templates = [...(settings.quoteTemplates || []), template];
    const updated = { ...settings, quoteTemplates: templates };
    setSettings(updated);
    DB.saveSettings(updated);
    addToast('success', `Template "${label}" saved`);
  };

  const loadTemplate = (tpl: QuoteTemplate) => {
    setItems(tpl.items.length > 0 ? tpl.items.map(i => ({ ...i })) : [emptyLine()]);
    setForm(prev => ({
      ...prev,
      markupPct: tpl.markupPct ?? prev.markupPct,
      discountPct: tpl.discountPct ?? prev.discountPct,
      taxRate: tpl.taxRate ?? prev.taxRate,
      terms: tpl.terms ?? prev.terms,
      notes: tpl.notes ?? prev.notes,
      jobDescription: tpl.jobDescription ?? prev.jobDescription,
    }));
    // Bump lastUsedAt so the most-used templates float to the top
    const templates = (settings.quoteTemplates || []).map(t => t.id === tpl.id ? { ...t, lastUsedAt: Date.now() } : t);
    const updated = { ...settings, quoteTemplates: templates };
    setSettings(updated);
    DB.saveSettings(updated);
    setShowTemplatePicker(false);
    addToast('success', `Loaded template "${tpl.label}"`);
  };

  const deleteTemplate = (id: string) => {
    if (!confirm('Delete this template?')) return;
    const templates = (settings.quoteTemplates || []).filter(t => t.id !== id);
    const updated = { ...settings, quoteTemplates: templates };
    setSettings(updated);
    DB.saveSettings(updated);
  };

  // Add a line item from a saved Process Template — pre-fills description, unit,
  // price per unit, and min-lot quantity. If the process has a setup fee, adds a
  // separate setup line too.
  const addProcessFromLibrary = (process: ProcessTemplate) => {
    const qty = process.minLot || 1;
    const processLine: QuoteLineItem = {
      description: process.description || process.name,
      qty,
      unit: process.unit,
      unitPrice: process.pricePerUnit,
      total: qty * process.pricePerUnit,
    };
    // If the quote starts with a single empty line, replace it; otherwise append.
    const startItems = items.length === 1 && !items[0].description && items[0].qty === 1 && items[0].unitPrice === 0
      ? []
      : items;
    const next = [...startItems, processLine];
    // If process has a setup fee, add it as its own line
    if (process.setupFee && process.setupFee > 0) {
      next.push({
        description: `Setup — ${process.name}`,
        qty: 1,
        unit: 'lot',
        unitPrice: process.setupFee,
        total: process.setupFee,
      });
    }
    setItems(next);
    setShowProcessPicker(false);
    setProcessSearch('');
    addToast('success', `Added "${process.name}" from library`);
  };

  const calcTotals = () => {
    const subtotal = items.reduce((a, i) => a + i.total, 0);
    const afterMarkup = subtotal * (1 + form.markupPct / 100);
    const discountAmt = afterMarkup * (form.discountPct / 100);
    const afterDiscount = afterMarkup - discountAmt;
    const taxAmt = afterDiscount * (form.taxRate / 100);
    const total = afterDiscount + taxAmt;
    return { subtotal, afterMarkup, discountAmt, afterDiscount, taxAmt, total };
  };

  const handleSave = async () => {
    if (!billTo.name) { addToast('error', 'Customer name is required'); return; }
    if (items.every(i => !i.description)) { addToast('error', 'Add at least one line item'); return; }
    const { subtotal, discountAmt, taxAmt, total } = calcTotals();
    const validItems = items.filter(i => i.description.trim()).map(i => ({ ...i, total: i.qty * i.unitPrice }));

    // ── Revision history (Round 2 #11) ──
    // If this is an EDIT of a quote that was already sent/accepted/declined, snapshot
    // the prior state into revisions[] so we can show a change log to the customer.
    let revisions = editing?.revisions || [];
    const shouldSnapshot = editing
      && (editing.status === 'sent' || editing.status === 'accepted' || editing.status === 'declined')
      && (
        editing.total !== total ||
        editing.items.length !== validItems.length ||
        JSON.stringify(editing.items) !== JSON.stringify(validItems) ||
        (editing.notes || '') !== (form.notes || '') ||
        (editing.terms || '') !== (form.terms || '') ||
        (editing.jobDescription || '') !== (form.jobDescription || '')
      );
    if (shouldSnapshot) {
      const priorVersion = revisions.length > 0 ? Math.max(...revisions.map(r => r.version)) : 0;
      revisions = [
        ...revisions,
        {
          version: priorVersion + 1,
          savedAt: Date.now(),
          savedBy: user.id,
          savedByName: user.name,
          items: editing.items,
          subtotal: editing.subtotal,
          markupPct: editing.markupPct,
          discountPct: editing.discountPct,
          taxRate: editing.taxRate,
          total: editing.total,
          jobDescription: editing.jobDescription,
          notes: editing.notes,
          terms: editing.terms,
        },
      ];
    }

    const quote: Quote = {
      id: editing?.id || `QT-${Date.now()}`,
      quoteNumber: form.quoteNumber || editing?.quoteNumber || DB.getNextQuoteNumber(quotes, settings.quotePrefix),
      customer: billTo.name,
      billTo,
      shipTo: shipToDifferent ? shipTo : undefined,
      projectFields: Object.keys(projectFields).length > 0 ? projectFields : undefined,
      items: validItems,
      subtotal,
      markupPct: form.markupPct,
      discountPct: form.discountPct || undefined,
      discountAmt: discountAmt > 0 ? discountAmt : undefined,
      taxRate: form.taxRate || undefined,
      taxAmt: taxAmt > 0 ? taxAmt : undefined,
      total,
      status: editing?.status || 'draft',
      validUntil: form.validUntil || undefined,
      jobDescription: form.jobDescription || undefined,
      notes: form.notes || undefined,
      terms: form.terms || undefined,
      createdAt: editing?.createdAt || Date.now(),
      createdBy: user.id,
      createdByName: user.name,
      ...(editing ? { sentAt: editing.sentAt, acceptedAt: editing.acceptedAt, declinedAt: editing.declinedAt, linkedJobId: editing.linkedJobId, viewedAt: editing.viewedAt, lastViewedAt: editing.lastViewedAt, viewCount: editing.viewCount, viewHistory: editing.viewHistory } : {}),
      ...(revisions.length > 0 ? { revisions } : {}),
    };
    try {
      await DB.saveQuote(quote);
      // Auto-save client contact info for next time
      if (billTo.name && (billTo.email || billTo.phone || billTo.address || billTo.contactPerson)) {
        const updatedContacts = { ...(settings.clientContacts || {}), [billTo.name]: billTo };
        DB.saveSettings({ ...settings, clientContacts: updatedContacts });
      }
      addToast('success', editing ? 'Quote updated' : `Quote ${quote.quoteNumber} created`);
      setShowModal(false);
    } catch { addToast('error', 'Failed to save quote'); }
  };

  // ── Match a quote line item to a process template by fuzzy name match (Round 2 #7) ──
  // Used to infer routing ops when auto-creating a job from an accepted quote.
  const matchProcessFromLine = (itemDesc: string): ProcessTemplate | undefined => {
    const procs = settings.processTemplates || [];
    if (procs.length === 0) return undefined;
    const desc = itemDesc.toLowerCase().trim();
    // Exact name match wins
    let match = procs.find(p => desc.includes(p.name.toLowerCase()));
    if (match) return match;
    // Fallback: check description keyword overlap
    match = procs.find(p => p.description && desc.includes(p.description.toLowerCase().slice(0, 20)));
    return match;
  };

  const updateStatus = async (q: Quote, status: QuoteStatus) => {
    const updates: Partial<Quote> = { status };
    if (status === 'sent') updates.sentAt = Date.now();
    if (status === 'accepted') updates.acceptedAt = Date.now();
    if (status === 'declined') updates.declinedAt = Date.now();
    try {
      await DB.saveQuote({ ...q, ...updates } as Quote);
      addToast('success', `Quote marked as ${status}`);
      if (status === 'accepted') {
        // Build a rich job description from the quote — processes detected + line items
        const matchedProcesses: ProcessTemplate[] = [];
        q.items.forEach(item => {
          const m = matchProcessFromLine(item.description);
          if (m && !matchedProcesses.some(p => p.id === m.id)) matchedProcesses.push(m);
        });
        const routingText = matchedProcesses.length > 0
          ? `Routing: ${matchedProcesses.map(p => p.name).join(' → ')}`
          : '';
        const itemsText = q.items.map(i => `• ${i.qty} ${i.unit || 'ea'} × ${i.description}`).join('\n');
        const info = [routingText, '', itemsText].filter(Boolean).join('\n');

        // Pick initial stage: first category-matching stage in the pipeline, else default
        const stages = settings.jobStages || [];
        let initialStageId: string | undefined;
        if (matchedProcesses.length > 0 && stages.length > 0) {
          const firstCat = matchedProcesses[0].category?.toLowerCase() || '';
          const matchingStage = stages.find(s =>
            s.label.toLowerCase().includes(firstCat) ||
            firstCat.includes(s.label.toLowerCase())
          );
          if (matchingStage) initialStageId = matchingStage.id;
        }

        await onJobCreate({
          poNumber: q.quoteNumber,
          partNumber: q.items[0]?.description?.slice(0, 60) || 'See quote',
          customer: q.customer,
          quantity: q.items.reduce((a, i) => a + i.qty, 0),
          dueDate: q.validUntil || '',
          info,
          quoteAmount: q.total,
          linkedQuoteId: q.id,
          initialStageId,
          processRouting: matchedProcesses.map(p => p.name),
        });
        addToast('success', matchedProcesses.length > 0
          ? `Job created — routing: ${matchedProcesses.map(p => p.name).join(' → ')}`
          : 'Job auto-created from accepted quote');
      }
    } catch { addToast('error', 'Failed to update'); }
    setActionMenuId(null);
  };

  const getPortalLink = (q: Quote) => {
    const base = window.location.origin + window.location.pathname;
    // Prefer short slug if defined (?c=acme-corp&q=Q-001)
    const slug = settings.clientSlugs?.[q.customer];
    if (slug) return `${base}?c=${slug}&q=${q.id}`;
    return `${base}?portal=${encodeURIComponent(q.customer)}&quote=${q.id}`;
  };

  const sendQuoteToCustomer = async (q: Quote) => {
    // Generate the portal/approval link
    const link = getPortalLink(q);
    const companyName = settings.companyName || 'Our Company';
    const items = q.items.map(i => `  • ${i.description} — ${i.qty} ${i.unit || 'ea'} × $${i.unitPrice.toFixed(2)} = $${i.total.toFixed(2)}`).join('\n');

    const subject = encodeURIComponent(`Quote ${q.quoteNumber} from ${companyName}`);
    const body = encodeURIComponent(
`Hi ${q.billTo?.contactPerson || q.customer},

Thank you for your interest. Please find your quote details below:

Quote #: ${q.quoteNumber}
Date: ${new Date(q.createdAt).toLocaleDateString()}
${q.validUntil ? `Valid Until: ${q.validUntil}` : ''}

Items:
${items}

Total: $${q.total.toFixed(2)}

${q.jobDescription ? `Scope of Work:\n${q.jobDescription}\n` : ''}
View & Approve Online:
${link}

${q.terms ? `Terms: ${q.terms}` : ''}
${q.notes ? `Notes: ${q.notes}` : ''}

Thank you,
${companyName}
${settings.companyPhone || ''}`.trim()
    );

    const email = q.billTo?.email || '';
    window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_blank');

    // Also copy link to clipboard
    try {
      await navigator.clipboard.writeText(link);
      addToast('info', 'Approval link copied to clipboard');
    } catch { /* clipboard may fail in some browsers */ }

    // Mark as sent
    await updateStatus(q, 'sent');
    setActionMenuId(null);
  };

  const duplicateQuote = async (q: Quote) => {
    const dup: Quote = { ...q, id: `QT-${Date.now()}`, quoteNumber: DB.getNextQuoteNumber(quotes, settings.quotePrefix), status: 'draft', createdAt: Date.now(), sentAt: undefined, acceptedAt: undefined, declinedAt: undefined, linkedJobId: undefined };
    await DB.saveQuote(dup);
    addToast('success', `Duplicated as ${dup.quoteNumber}`);
    setActionMenuId(null);
  };

  return (
    // Full-width so large monitors don't show a dead column on the right
    <div className="w-full space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2"><FileText className="w-5 h-5 text-blue-400" /> Quotes & Estimates</h2>
          <p className="text-sm text-zinc-500">Create professional quotes, track approvals, and convert to jobs.</p>
        </div>
        <button onClick={openNew} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shrink-0 shadow-lg shadow-blue-500/20"><Plus className="w-4 h-4" /> New Quote</button>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3 text-center">
          <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Total Quotes</p>
          <p className="text-2xl font-black text-white">{quotes.length}</p>
        </div>
        <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3 text-center">
          <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Quoted This Month</p>
          <p className="text-2xl font-black text-blue-400">{fmtMoneyK(monthTotal)}</p>
        </div>
        <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3 text-center">
          <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Awaiting Response</p>
          <p className="text-2xl font-black text-yellow-400">{fmtMoneyK(pendingTotal)}</p>
        </div>
        <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3 text-center">
          <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Win Rate</p>
          <p className={`text-2xl font-black ${acceptRate >= 50 ? 'text-emerald-400' : acceptRate >= 25 ? 'text-yellow-400' : 'text-zinc-400'}`}>{acceptRate}%</p>
        </div>
      </div>

      {/* ── View mode toggle: List / Pipeline ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex gap-1 bg-zinc-900/50 p-1 rounded-lg border border-white/5">
          <button
            onClick={() => setViewMode('list')}
            aria-pressed={viewMode === 'list'}
            className={`px-3 py-1.5 text-xs font-bold rounded transition-colors flex items-center gap-1.5 ${viewMode === 'list' ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-white'}`}
          >
            📋 List
          </button>
          <button
            onClick={() => setViewMode('pipeline')}
            aria-pressed={viewMode === 'pipeline'}
            className={`px-3 py-1.5 text-xs font-bold rounded transition-colors flex items-center gap-1.5 ${viewMode === 'pipeline' ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-white'}`}
          >
            📊 Pipeline
          </button>
        </div>
        {viewMode === 'list' && (
          <div className="inline-flex gap-1 bg-zinc-900/50 p-1 rounded-lg border border-white/5 overflow-x-auto">
            {(['all', 'draft', 'sent', 'accepted', 'declined'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`px-3 py-1.5 text-xs font-bold rounded transition-colors whitespace-nowrap min-h-[28px] ${filter === f ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}>
                {f === 'all' ? `All (${quotes.length})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${quotes.filter(q => q.status === f).length})`}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* ── PIPELINE KANBAN VIEW (Round 2 #9) ── */}
      {/* ═══════════════════════════════════════════════════════ */}
      {viewMode === 'pipeline' && (() => {
        const PIPELINE_STAGES: { key: QuoteStatus; label: string; color: string; tint: string }[] = [
          { key: 'draft',    label: 'Draft',    color: '#71717a', tint: 'bg-zinc-500/5 border-zinc-500/20' },
          { key: 'sent',     label: 'Sent',     color: '#3b82f6', tint: 'bg-blue-500/5 border-blue-500/20' },
          { key: 'accepted', label: 'Won',      color: '#10b981', tint: 'bg-emerald-500/5 border-emerald-500/25' },
          { key: 'declined', label: 'Lost',     color: '#ef4444', tint: 'bg-red-500/5 border-red-500/20' },
          { key: 'expired',  label: 'Expired',  color: '#f97316', tint: 'bg-orange-500/5 border-orange-500/20' },
        ];
        const byStatus: Record<QuoteStatus, typeof quotes> = { draft: [], sent: [], accepted: [], declined: [], expired: [] };
        quotes.forEach(q => byStatus[q.status].push(q));
        // Win rate: accepted / (accepted + declined)
        const decided = byStatus.accepted.length + byStatus.declined.length;
        const winRate = decided > 0 ? Math.round((byStatus.accepted.length / decided) * 100) : 0;
        const wonValue = byStatus.accepted.reduce((a, q) => a + q.total, 0);
        const lostValue = byStatus.declined.reduce((a, q) => a + q.total, 0);
        const pipelineValue = (byStatus.draft.reduce((a, q) => a + q.total, 0)) + (byStatus.sent.reduce((a, q) => a + q.total, 0));

        const onDrop = async (targetStatus: QuoteStatus, quoteId: string) => {
          const q = quotes.find(x => x.id === quoteId);
          if (!q || q.status === targetStatus) return;
          setDraggingQuoteId(null);
          setHoverStatus(null);
          await updateStatus(q, targetStatus);
        };

        return (
          <div className="space-y-4">
            {/* Win-rate summary bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-gradient-to-br from-emerald-500/15 to-emerald-500/[0.02] border border-emerald-500/25 rounded-xl p-3">
                <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Win Rate</p>
                <p className="text-2xl font-black text-white tabular mt-1">{winRate}%</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">{byStatus.accepted.length} won / {decided} decided</p>
              </div>
              <div className="bg-gradient-to-br from-blue-500/15 to-blue-500/[0.02] border border-blue-500/25 rounded-xl p-3">
                <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">In Pipeline</p>
                <p className="text-2xl font-black text-white tabular mt-1">{fmtMoneyK(pipelineValue)}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">{byStatus.draft.length + byStatus.sent.length} active</p>
              </div>
              <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3">
                <p className="text-[10px] font-black text-emerald-400/70 uppercase tracking-widest">Won $</p>
                <p className="text-2xl font-black text-emerald-400 tabular mt-1">{fmtMoneyK(wonValue)}</p>
              </div>
              <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3">
                <p className="text-[10px] font-black text-red-400/70 uppercase tracking-widest">Lost $</p>
                <p className="text-2xl font-black text-red-400 tabular mt-1">{fmtMoneyK(lostValue)}</p>
              </div>
            </div>

            {/* Kanban columns */}
            <div className="flex gap-3 overflow-x-auto pb-3">
              {PIPELINE_STAGES.map(stage => {
                const list = byStatus[stage.key];
                const isHover = hoverStatus === stage.key;
                const stageTotal = list.reduce((a, q) => a + q.total, 0);
                return (
                  <div
                    key={stage.key}
                    onDragOver={(e) => { e.preventDefault(); setHoverStatus(stage.key); }}
                    onDragLeave={() => setHoverStatus(prev => prev === stage.key ? null : prev)}
                    onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/quoteId'); if (id) onDrop(stage.key, id); }}
                    className={`shrink-0 w-[280px] sm:w-[300px] rounded-2xl border flex flex-col max-h-[calc(100vh-240px)] transition-all ${isHover ? 'bg-white/[0.04] ring-1' : stage.tint}`}
                    style={isHover ? { boxShadow: `0 0 0 1px ${stage.color}60` } : undefined}
                  >
                    {/* Header */}
                    <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between sticky top-0 bg-zinc-900/80 backdrop-blur-xl rounded-t-2xl">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: stage.color, boxShadow: `0 0 8px ${stage.color}80` }} />
                        <span className="text-[13px] font-black text-white uppercase tracking-wide truncate">{stage.label}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] font-mono font-bold tabular px-2 py-0.5 rounded-full border" style={{ background: `${stage.color}15`, color: stage.color, borderColor: `${stage.color}30` }}>{list.length}</span>
                      </div>
                    </div>
                    <div className="px-4 py-2 text-[10px] text-zinc-500 tabular border-b border-white/5">
                      {fmtMoneyK(stageTotal)} total
                    </div>
                    {/* Cards */}
                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                      {list.length === 0 && (
                        <div className="py-8 text-center text-zinc-700 text-xs italic">Drop quotes here</div>
                      )}
                      {list.sort((a, b) => b.createdAt - a.createdAt).map(q => (
                        <div
                          key={q.id}
                          draggable
                          onDragStart={(e) => { setDraggingQuoteId(q.id); e.dataTransfer.setData('text/quoteId', q.id); e.dataTransfer.effectAllowed = 'move'; }}
                          onDragEnd={() => { setDraggingQuoteId(null); setHoverStatus(null); }}
                          onClick={() => openEdit(q)}
                          className={`group bg-zinc-950/60 border rounded-xl p-3 cursor-grab active:cursor-grabbing transition-all hover:border-white/15 ${draggingQuoteId === q.id ? 'opacity-40 scale-95' : 'border-white/5'}`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <p className="font-black text-white text-sm tabular truncate">{q.quoteNumber}</p>
                            <p className="text-[11px] font-mono font-black text-emerald-400 shrink-0">{fmtMoneyK(q.total)}</p>
                          </div>
                          <p className="text-[11px] text-zinc-400 font-semibold truncate">{q.customer}</p>
                          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                            <span className="text-[9px] text-zinc-600 tabular">{new Date(q.createdAt).toLocaleDateString()}</span>
                            {q.items.length > 0 && <span className="text-[9px] text-zinc-500">· {q.items.length} item{q.items.length !== 1 ? 's' : ''}</span>}
                            {(q.viewCount || 0) > 0 && (
                              <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1 py-0.5 rounded">👁 {q.viewCount}</span>
                            )}
                            {(q.revisions?.length || 0) > 0 && (
                              <span className="text-[9px] font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20 px-1 py-0.5 rounded">v{q.revisions!.length + 1}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-zinc-600 text-center italic">💡 Drag quotes between columns to change status. Moving to "Won" auto-creates a job.</p>
          </div>
        );
      })()}

      {/* ── Quote List (hidden when pipeline view is active) ── */}
      <div className={`space-y-3 ${viewMode !== 'list' ? 'hidden' : ''}`}>
        {filtered.length === 0 && (
          <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-12 text-center">
            <FileText className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-400 font-bold">No quotes yet</p>
            <p className="text-zinc-600 text-sm mt-1">Create your first quote to start winning work.</p>
            <button onClick={openNew} className="mt-4 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl font-bold text-sm inline-flex items-center gap-2"><Plus className="w-4 h-4" /> Create Quote</button>
          </div>
        )}
        {filtered.map(q => {
          const st = STATUS_STYLES[q.status];
          return (
            <div key={q.id} className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4 hover:bg-white/[0.03] transition-colors">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0"><FileText className="w-5 h-5 text-blue-400" /></div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-bold">{q.quoteNumber}</span>
                      <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${st.bg} ${st.text}`}>{st.label}</span>
                    </div>
                    <p className="text-sm text-zinc-400 truncate">{q.customer}{q.billTo?.contactPerson ? ` — ${q.billTo.contactPerson}` : ''}</p>
                    <p className="text-[10px] text-zinc-600">{new Date(q.createdAt).toLocaleDateString()}{q.validUntil ? ` · Expires ${q.validUntil}` : ''}</p>
                    {/* Engagement + Revision pills — admin-only insights */}
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      {(q.viewCount || 0) > 0 && (
                        <div className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded" title={q.lastViewedAt ? `Last opened ${new Date(q.lastViewedAt).toLocaleString()}` : ''}>
                          👁 {q.viewCount}× viewed
                        </div>
                      )}
                      {q.status === 'sent' && !q.viewCount && (
                        <div className="inline-flex items-center gap-1 text-[10px] font-bold text-zinc-500 bg-zinc-800/60 border border-white/5 px-1.5 py-0.5 rounded">
                          ⏳ Not yet opened
                        </div>
                      )}
                      {(q.revisions?.length || 0) > 0 && (
                        <div className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.5 rounded" title={`Edited ${q.revisions!.length} time${q.revisions!.length > 1 ? 's' : ''} after sending`}>
                          📝 v{q.revisions!.length + 1}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-lg font-black text-white">${q.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    <p className="text-[10px] text-zinc-500">{q.items.length} item{q.items.length !== 1 ? 's' : ''}{q.markupPct ? ` · ${q.markupPct}% markup` : ''}</p>
                  </div>
                  <div className="relative">
                    <button aria-label={`Actions for quote ${q.number || q.id}`} aria-expanded={actionMenuId === q.id} aria-haspopup="menu" onClick={() => setActionMenuId(actionMenuId === q.id ? null : q.id)} className="p-2 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors min-w-[36px] min-h-[36px]"><ChevronDown className={`w-4 h-4 transition-transform ${actionMenuId === q.id ? 'rotate-180' : ''}`} aria-hidden="true" /></button>
                    {actionMenuId === q.id && (
                      <div className="absolute right-0 top-full mt-1 bg-zinc-800 border border-white/10 rounded-xl shadow-2xl z-50 min-w-[200px] py-1 animate-fade-in">
                        {q.status === 'draft' && <button onClick={() => openEdit(q)} className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-white/5 flex items-center gap-2"><Edit2 className="w-3.5 h-3.5" /> Edit Quote</button>}
                        {q.status === 'draft' && <button onClick={() => { sendQuoteToCustomer(q); }} className="w-full text-left px-4 py-2.5 text-sm text-blue-400 hover:bg-white/5 flex items-center gap-2"><Send className="w-3.5 h-3.5" /> Send to Customer</button>}
                        {q.status === 'draft' && <button onClick={() => updateStatus(q, 'sent')} className="w-full text-left px-4 py-2.5 text-sm text-zinc-400 hover:bg-white/5 flex items-center gap-2"><Check className="w-3.5 h-3.5" /> Mark as Sent (no email)</button>}
                        {q.status === 'sent' && <button onClick={() => updateStatus(q, 'accepted')} className="w-full text-left px-4 py-2.5 text-sm text-emerald-400 hover:bg-white/5 flex items-center gap-2"><Check className="w-3.5 h-3.5" /> Accept & Create Job</button>}
                        {q.status === 'sent' && <button onClick={() => updateStatus(q, 'declined')} className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-white/5 flex items-center gap-2"><X className="w-3.5 h-3.5" /> Mark Declined</button>}
                        {q.status === 'sent' && <button onClick={() => { sendQuoteToCustomer(q); }} className="w-full text-left px-4 py-2.5 text-sm text-blue-400 hover:bg-white/5 flex items-center gap-2"><Send className="w-3.5 h-3.5" /> Resend to Customer</button>}
                        <button onClick={async () => { try { await navigator.clipboard.writeText(getPortalLink(q)); addToast('success', 'Share link copied!'); } catch {} setActionMenuId(null); }} className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-white/5 flex items-center gap-2"><Copy className="w-3.5 h-3.5" /> Copy Share Link</button>
                        <div className="border-t border-white/5 my-1" />
                        <button onClick={() => { printQuotePDF(q, settings); setActionMenuId(null); }} className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-white/5 flex items-center gap-2"><Download className="w-3.5 h-3.5" /> Print / Save as PDF</button>
                        <button onClick={() => duplicateQuote(q)} className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-white/5 flex items-center gap-2"><Copy className="w-3.5 h-3.5" /> Duplicate</button>
                        <div className="border-t border-white/5 my-1" />
                        <button onClick={async () => { await DB.deleteQuote(q.id); addToast('info', 'Quote deleted'); setActionMenuId(null); }} className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-white/5 flex items-center gap-2"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {/* ── Line Items Preview ── */}
              {q.items.length > 0 && (
                <div className="mt-3 pt-3 border-t border-white/5">
                  {q.items.slice(0, 3).map((item, i) => (
                    <div key={i} className="text-xs text-zinc-500 flex justify-between py-0.5">
                      <span className="truncate">{item.description}</span>
                      <span className="text-zinc-400 font-mono shrink-0 ml-2">{item.qty} {item.unit || 'ea'} × ${item.unitPrice.toFixed(2)} = <span className="text-zinc-300">${item.total.toFixed(2)}</span></span>
                    </div>
                  ))}
                  {q.items.length > 3 && <p className="text-[10px] text-zinc-600 mt-1">+{q.items.length - 3} more items</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ══════════════════════════════════════════════════ */}
      {/* ── CREATE / EDIT QUOTE MODAL ── */}
      {/* ══════════════════════════════════════════════════ */}
      {showModal && (() => {
        // Compute per-section "done" states for the stepper
        const s1Done = !!billTo.name && (!shipToDifferent || !!shipTo.name);
        const s2Done = !!form.quoteNumber;
        const s3Done = !!form.jobDescription?.trim();
        const s4Done = items.some(it => it.description?.trim() && it.qty > 0);
        const s5Done = form.markupPct > 0 || form.discountPct > 0 || form.taxRate > 0 || items.some(it => it.unitPrice > 0);
        const s6Done = !!form.terms?.trim() || !!form.validUntil;
        const stepperSteps = [
          { num: 1, label: 'Customer', done: s1Done },
          { num: 2, label: 'Project', done: s2Done },
          { num: 3, label: 'Scope', done: s3Done },
          { num: 4, label: 'Items', done: s4Done },
          { num: 5, label: 'Pricing', done: s5Done },
          { num: 6, label: 'Terms', done: s6Done },
        ];
        const completedCount = stepperSteps.filter(s => s.done).length;
        // Figure out which section is "current" (first incomplete)
        const currentIdx = stepperSteps.findIndex(s => !s.done);
        const activeIdx = currentIdx === -1 ? stepperSteps.length - 1 : currentIdx;
        return (
        <Overlay open onClose={() => setShowModal(false)} ariaLabel={editing ? 'Edit quote' : 'Create quote'} zIndex={1000} backdrop="bg-zinc-950" padding="p-2 sm:p-4">
          <div className="bg-zinc-900 border border-white/10 w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden flex flex-col my-2 sm:my-4" style={{ maxHeight: 'calc(100dvh - 1rem)' }} onClick={e => e.stopPropagation()}>
            {/* ── Modal Header + Tabs ── */}
            <div className="border-b border-white/10 bg-zinc-800/50">
              <div className="p-4 pb-0 flex justify-between items-start flex-wrap gap-2">
                <div className="min-w-0">
                  <h3 className="font-bold text-white text-lg">{editing ? `Edit ${editing.quoteNumber}` : 'Create a Quote'}</h3>
                  {!editing && form.quoteNumber && <p className="text-[11px] text-zinc-500 mt-0.5">Number: <span className="font-mono text-zinc-400">{form.quoteNumber}</span></p>}
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                  {/* Templates: load or save as */}
                  {(settings.quoteTemplates?.length || 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowTemplatePicker(true)}
                      className="text-[11px] font-bold text-purple-400 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/15 border border-purple-500/20 px-2 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                      title="Start from a saved template"
                    >
                      📋 Load Template
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={saveAsTemplate}
                    disabled={!items.some(i => i.description?.trim())}
                    className="text-[11px] font-bold text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-2 py-1.5 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40 disabled:hover:bg-white/5"
                    title="Save current quote as a reusable template"
                  >
                    💾 Save as Template
                  </button>
                  <button onClick={() => setShowModal(false)} className="text-zinc-400 hover:text-white text-sm px-2">Close</button>
                  <button onClick={handleSave} className={`${completedCount >= 4 ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-lg shadow-blue-900/40' : 'bg-blue-600 hover:bg-blue-500'} text-white px-4 py-1.5 rounded-lg font-bold text-sm flex items-center gap-1.5 transition-all`}>
                    <Save className="w-3.5 h-3.5" aria-hidden="true" /> Save
                  </button>
                </div>
              </div>
              <div className="flex gap-0 mt-3 px-4">
                {(['edit', 'preview', 'send'] as const).map(t => (
                  <button key={t} onClick={() => setModalTab(t)}
                    className={`px-5 py-2.5 text-sm font-bold transition-colors border-b-2 ${modalTab === t ? 'text-blue-400 border-blue-400' : 'text-zinc-500 border-transparent hover:text-zinc-300'}`}>
                    {t === 'edit' ? 'Edit' : t === 'preview' ? 'Preview' : 'Send'}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Stepper (only on Edit tab) ── */}
            {modalTab === 'edit' && <QuoteStepper steps={stepperSteps} currentIdx={activeIdx} completedCount={completedCount} />}

            {/* ── EDIT TAB ── */}
            <div className={`p-5 overflow-y-auto space-y-6 flex-1 ${modalTab !== 'edit' ? 'hidden' : ''}`}>

              {/* §1 — Customer Information */}
              <div>
                <SectionLabel num={1} title="Customer Information" sub="Who is this quote for?" done={s1Done} />
                <div className="space-y-3">
                  <ContactBlock
                    label="Bill To *"
                    contact={billTo}
                    onChange={setBillTo}
                    clients={clients}
                    savedContacts={settings.clientContacts}
                    onSaveContact={(c) => {
                      if (!c.name) return;
                      const updatedContacts = { ...(settings.clientContacts || {}), [c.name]: c };
                      setSettings({ ...settings, clientContacts: updatedContacts });
                      DB.saveSettings({ ...settings, clientContacts: updatedContacts });
                      addToast('success', `Saved contact info for ${c.name}`);
                    }}
                  />
                  <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
                    <input type="checkbox" checked={shipToDifferent} onChange={e => setShipToDifferent(e.target.checked)} className="rounded" />
                    Ship to a different address
                  </label>
                  {shipToDifferent && <ContactBlock label="Ship To" contact={shipTo} onChange={setShipTo} />}
                </div>
              </div>

              {/* §2 — Quote Number + Project Details */}
              <div>
                <SectionLabel num={2} title="Project Details" sub="Quote number, PO, part number, and other job info" done={s2Done} />
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-zinc-500 uppercase font-bold block mb-1">Quote Number</label>
                      <input value={form.quoteNumber} onChange={e => setForm({ ...form, quoteNumber: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 text-white text-sm outline-none font-mono" placeholder="Q-001" />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 uppercase font-bold block mb-1">Valid Until</label>
                      <input type="date" value={form.validUntil} onChange={e => setForm({ ...form, validUntil: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 text-white text-sm outline-none" />
                    </div>
                  </div>
                  {/* Custom Project Fields */}
                  {Object.keys(projectFields).length > 0 && (
                    <div className="bg-zinc-800/30 rounded-xl p-4 border border-white/5 space-y-2">
                      <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Job Information</p>
                      <div className="grid grid-cols-2 gap-2">
                        {Object.entries(projectFields).map(([key, val]) => (
                          <div key={key}>
                            <label className="text-[10px] text-zinc-500 block mb-0.5">{key}</label>
                            <input value={val} onChange={e => setProjectFields({ ...projectFields, [key]: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2 text-white text-sm outline-none" placeholder={`Enter ${key.toLowerCase()}`} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* §3 — Scope of Work */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <SectionLabel num={3} title="Scope of Work" sub="Describe what you're quoting for" done={s3Done} />
                  <SnippetInserter
                    snippets={settings.quoteSnippets || []}
                    target="scope"
                    onInsert={(text) => setForm({ ...form, jobDescription: form.jobDescription ? `${form.jobDescription}\n\n${text}` : text })}
                  />
                </div>
                <textarea value={form.jobDescription} onChange={e => setForm({ ...form, jobDescription: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white text-sm outline-none min-h-[70px] focus:ring-2 focus:ring-blue-500/30" placeholder="e.g. Deburr 500 units of Part #ABC-123, tumble finish, QC inspection..." />
              </div>

              {/* §4 — Line Items */}
              <div>
                <SectionLabel num={4} title="Line Items" sub="Add the items, services, or labor being quoted" done={s4Done} />
                <div className="space-y-2">
                  {/* Header */}
                  <div className="hidden sm:grid grid-cols-[1fr_60px_60px_80px_70px_24px] gap-2 text-[10px] text-zinc-500 uppercase font-bold px-1">
                    <span>Description</span><span className="text-center">Qty</span><span className="text-center">Unit</span><span className="text-right">Rate ($)</span><span className="text-right">Total</span><span></span>
                  </div>
                  {items.map((item, i) => (
                    <div key={i}>
                      {/* Mobile stacked card */}
                      <div className="sm:hidden bg-zinc-950 border border-white/10 rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] text-zinc-500 uppercase font-bold">Item #{i + 1}</span>
                          {items.length > 1 && <button onClick={() => removeItem(i)} className="text-zinc-500 hover:text-red-400 p-1"><X className="w-4 h-4" /></button>}
                        </div>
                        <input value={item.description} onChange={e => updateItem(i, 'description', e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white text-sm outline-none" placeholder="Description" />
                        <div className="grid grid-cols-[70px_70px_1fr] gap-2">
                          <input type="number" value={item.qty || ''} onChange={e => updateItem(i, 'qty', parseInt(e.target.value) || 0)} className="bg-black/40 border border-white/10 rounded-lg p-2 text-white text-sm outline-none text-center" placeholder="Qty" />
                          <select value={item.unit || 'ea'} onChange={e => updateItem(i, 'unit', e.target.value)} className="bg-black/40 border border-white/10 rounded-lg p-2 text-white text-xs outline-none">
                            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                          <input type="number" value={item.unitPrice || ''} onChange={e => updateItem(i, 'unitPrice', parseFloat(e.target.value) || 0)} className="bg-black/40 border border-white/10 rounded-lg p-2 text-white text-sm outline-none text-right" step="0.01" placeholder="Rate $" />
                        </div>
                        <div className="flex items-center justify-between pt-1 border-t border-white/5">
                          <span className="text-[10px] text-zinc-500 uppercase font-bold">Total</span>
                          <span className="text-sm font-mono font-bold text-emerald-400">${(item.qty * item.unitPrice).toFixed(2)}</span>
                        </div>
                      </div>
                      {/* Desktop grid row */}
                      <div className="hidden sm:grid grid-cols-[1fr_60px_60px_80px_70px_24px] gap-2 items-center">
                        <input value={item.description} onChange={e => updateItem(i, 'description', e.target.value)} className="bg-zinc-950 border border-white/10 rounded-lg p-2 text-white text-sm outline-none min-w-0" placeholder="Item description" />
                        <input type="number" value={item.qty || ''} onChange={e => updateItem(i, 'qty', parseInt(e.target.value) || 0)} className="bg-zinc-950 border border-white/10 rounded-lg p-2 text-white text-sm outline-none text-center" />
                        <select value={item.unit || 'ea'} onChange={e => updateItem(i, 'unit', e.target.value)} className="bg-zinc-950 border border-white/10 rounded-lg p-2 text-white text-xs outline-none">
                          {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                        <input type="number" value={item.unitPrice || ''} onChange={e => updateItem(i, 'unitPrice', parseFloat(e.target.value) || 0)} className="bg-zinc-950 border border-white/10 rounded-lg p-2 text-white text-sm outline-none text-right" step="0.01" placeholder="0.00" />
                        <div className="text-right text-sm font-mono text-zinc-300">${(item.qty * item.unitPrice).toFixed(2)}</div>
                        {items.length > 1 ? <button onClick={() => removeItem(i)} className="text-zinc-600 hover:text-red-400"><X className="w-4 h-4" /></button> : <div />}
                      </div>
                      {/* Quantity-break tier editor (Round 2 #3) — shown if tiers exist, toggled via button below */}
                      {item.priceTiers && item.priceTiers.length > 0 && (
                        <div className="mt-2 ml-0 sm:ml-4 bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2.5 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">📊 Quantity Price Tiers</p>
                            <span className="text-[10px] text-zinc-500">Applied: <strong className="text-emerald-400">${resolveTierPrice(item.qty, item.priceTiers, item.unitPrice).toFixed(2)}/{item.unit || 'ea'}</strong> at qty {item.qty}</span>
                          </div>
                          <div className="space-y-1">
                            {item.priceTiers.map((tier, tIdx) => {
                              const isActive = item.qty >= tier.minQty && (!item.priceTiers![tIdx + 1] || item.qty < item.priceTiers![tIdx + 1].minQty);
                              return (
                                <div key={tIdx} className={`flex items-center gap-2 rounded p-1.5 border ${isActive ? 'bg-emerald-500/15 border-emerald-500/40' : 'bg-zinc-900/40 border-white/5'}`}>
                                  <span className="text-[10px] text-zinc-500 font-bold">Qty ≥</span>
                                  <input type="number" min={1} value={tier.minQty} onChange={e => updateTier(i, tIdx, 'minQty', parseInt(e.target.value) || 1)} className="w-16 bg-zinc-950 border border-white/10 rounded px-2 py-1 text-xs text-white outline-none text-center" />
                                  <span className="text-[10px] text-zinc-500">@</span>
                                  <span className="text-zinc-500 text-xs">$</span>
                                  <input type="number" step="0.01" value={tier.unitPrice} onChange={e => updateTier(i, tIdx, 'unitPrice', parseFloat(e.target.value) || 0)} className="w-20 bg-zinc-950 border border-white/10 rounded px-2 py-1 text-xs text-white outline-none text-right font-mono" />
                                  <span className="text-[10px] text-zinc-500">/{item.unit || 'ea'}</span>
                                  {isActive && <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest ml-auto">✓ Active</span>}
                                  <button type="button" onClick={() => removeTier(i, tIdx)} aria-label="Remove tier" className="text-zinc-500 hover:text-red-400 p-0.5"><X className="w-3 h-3" aria-hidden="true" /></button>
                                </div>
                              );
                            })}
                          </div>
                          <button type="button" onClick={() => addTier(i)} className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1">
                            <Plus className="w-3 h-3" aria-hidden="true" /> Add Tier
                          </button>
                        </div>
                      )}
                      {/* Add-tier toggle — only shown if no tiers yet */}
                      {(!item.priceTiers || item.priceTiers.length === 0) && item.description?.trim() && item.unitPrice > 0 && (
                        <button
                          type="button"
                          onClick={() => addTier(i)}
                          className="mt-1 ml-0 sm:ml-4 text-[10px] font-bold text-emerald-400/70 hover:text-emerald-400 flex items-center gap-1"
                        >
                          📊 + Add quantity-break pricing
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button onClick={addItem} type="button" className="flex items-center gap-1.5 text-xs font-bold text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/15 border border-blue-500/20 px-3 py-1.5 rounded-lg transition-colors">
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add Blank Line
                  </button>
                  {(settings.processTemplates?.length || 0) > 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowProcessPicker(true)}
                      className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/20 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <Zap className="w-3.5 h-3.5" aria-hidden="true" /> Add from Library ({settings.processTemplates!.length})
                    </button>
                  ) : (
                    <span className="text-[10px] text-zinc-500 italic">
                      💡 Tip: Define reusable processes in <strong className="text-zinc-400">Settings → Production → Process Library</strong> to add them here in one click.
                    </span>
                  )}
                </div>

                {/* Process Picker Modal */}
                {showProcessPicker && (
                  <Overlay open onClose={() => setShowProcessPicker(false)} ariaLabel="Process library" zIndex={1100} backdrop="bg-zinc-950">
                    <div className="bg-zinc-900 border border-emerald-500/25 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden my-4" style={{ maxHeight: 'calc(100dvh - 2rem)' }} onClick={e => e.stopPropagation()}>
                      <div className="p-4 border-b border-white/10 flex items-center justify-between gap-3 bg-gradient-to-b from-emerald-500/10 to-transparent">
                        <div className="min-w-0">
                          <h3 className="font-bold text-white flex items-center gap-2"><Zap className="w-5 h-5 text-emerald-400" aria-hidden="true" /> Process Library</h3>
                          <p className="text-[11px] text-zinc-500 mt-0.5">Pick a process — description, unit, price, and min lot auto-fill.</p>
                        </div>
                        <button type="button" aria-label="Close library" onClick={() => setShowProcessPicker(false)} className="text-zinc-400 hover:text-white p-2"><X className="w-5 h-5" aria-hidden="true" /></button>
                      </div>
                      <div className="p-3 border-b border-white/5">
                        <input
                          autoFocus
                          value={processSearch}
                          onChange={e => setProcessSearch(e.target.value)}
                          placeholder="Search processes…"
                          className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                        />
                      </div>
                      <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {(() => {
                          const s = processSearch.trim().toLowerCase();
                          const list = (settings.processTemplates || []).filter(p =>
                            !s || p.name.toLowerCase().includes(s) || (p.description || '').toLowerCase().includes(s) || (p.category || '').toLowerCase().includes(s)
                          );
                          if (list.length === 0) {
                            return (
                              <div className="text-center py-10 text-zinc-500">
                                <p className="text-sm">{s ? `No processes match "${s}"` : 'No processes defined yet.'}</p>
                                <p className="text-[10px] mt-1">Add them in <strong className="text-zinc-400">Settings → Production → Process Library</strong>.</p>
                              </div>
                            );
                          }
                          // Group by category if any defined
                          const byCat: Record<string, ProcessTemplate[]> = {};
                          list.forEach(p => { const c = p.category || 'Other'; (byCat[c] = byCat[c] || []).push(p); });
                          return Object.entries(byCat).map(([cat, procs]) => (
                            <div key={cat}>
                              {Object.keys(byCat).length > 1 && <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mt-2 mb-1.5">{cat}</p>}
                              <div className="space-y-1.5">
                                {procs.map(p => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => addProcessFromLibrary(p)}
                                    className="w-full text-left bg-zinc-800/50 hover:bg-emerald-500/10 border border-white/5 hover:border-emerald-500/30 rounded-xl p-3 transition-all flex items-center gap-3 group"
                                  >
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-bold text-white truncate">{p.name}</p>
                                      {p.description && <p className="text-[11px] text-zinc-500 truncate mt-0.5">{p.description}</p>}
                                    </div>
                                    <div className="text-right shrink-0">
                                      <p className="text-sm font-black text-emerald-400 tabular">${p.pricePerUnit.toFixed(2)}<span className="text-zinc-500 text-[10px] font-normal">/{p.unit}</span></p>
                                      {p.setupFee ? <p className="text-[10px] text-zinc-500">+ ${p.setupFee} setup</p> : null}
                                      {p.minLot ? <p className="text-[10px] text-zinc-500">min {p.minLot}</p> : null}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  </Overlay>
                )}
              </div>

              {/* §4 — Pricing */}
              <div>
                <SectionLabel num={5} title="Pricing & Adjustments" sub="Markup, discount, and tax" done={s5Done} />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase font-bold block mb-1">Markup %</label>
                    <div className="flex gap-1 flex-wrap">
                      {[0, 15, 20, 25, 30, 40, 50].map(m => (
                        <button key={m} onClick={() => setForm({ ...form, markupPct: m })}
                          className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-colors ${form.markupPct === m ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'}`}>
                          {m}%
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase font-bold block mb-1">Discount %</label>
                    <input type="number" value={form.discountPct || ''} onChange={e => setForm({ ...form, discountPct: parseFloat(e.target.value) || 0 })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2 text-white text-sm outline-none" placeholder="0" min="0" max="100" />
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase font-bold block mb-1">Tax Rate %</label>
                    <input type="number" value={form.taxRate || ''} onChange={e => setForm({ ...form, taxRate: parseFloat(e.target.value) || 0 })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2 text-white text-sm outline-none" placeholder="0" step="0.1" />
                  </div>
                </div>
              </div>

              {/* ── Totals + Admin-Only Margin Guardrails ── */}
              {(() => {
                const t = calcTotals();
                // Gross profit estimation: subtotal is what we charge before markup.
                // "Cost" = subtotal (the raw process prices are our floor). Markup = margin.
                // True GP% = (final price - cost) / final price. Discount lowers the margin.
                const priceBeforeTax = t.afterDiscount;
                const cost = t.subtotal; // approximation: line items sum = our internal cost floor
                const grossProfit = priceBeforeTax - cost;
                const marginPct = priceBeforeTax > 0 ? (grossProfit / priceBeforeTax) * 100 : 0;
                const minMargin = settings.minMarginPct ?? 20;
                const marginState: 'danger' | 'warn' | 'ok' | 'strong' =
                  marginPct < 0 ? 'danger' :
                  marginPct < minMargin ? 'warn' :
                  marginPct < minMargin + 15 ? 'ok' : 'strong';
                const marginStyles = {
                  danger:  { text: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/25',        label: '🚨 LOSING MONEY' },
                  warn:    { text: 'text-orange-400',  bg: 'bg-orange-500/10 border-orange-500/25',  label: '⚠ Below target' },
                  ok:      { text: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20',    label: '✓ Fair margin' },
                  strong:  { text: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/25', label: '💪 Strong margin' },
                } as const;
                const m = marginStyles[marginState];
                return (
                  <div className="space-y-3">
                    <div className="bg-zinc-800/50 rounded-xl p-4 space-y-1.5">
                      <div className="flex justify-between text-sm"><span className="text-zinc-500">Subtotal</span><span className="text-zinc-300 font-mono">${t.subtotal.toFixed(2)}</span></div>
                      {form.markupPct > 0 && <div className="flex justify-between text-sm"><span className="text-zinc-500">Markup ({form.markupPct}%)</span><span className="text-zinc-300 font-mono">+${(t.afterMarkup - t.subtotal).toFixed(2)}</span></div>}
                      {form.discountPct > 0 && <div className="flex justify-between text-sm"><span className="text-zinc-500">Discount ({form.discountPct}%)</span><span className="text-red-400 font-mono">-${t.discountAmt.toFixed(2)}</span></div>}
                      {form.taxRate > 0 && <div className="flex justify-between text-sm"><span className="text-zinc-500">Tax ({form.taxRate}%)</span><span className="text-zinc-300 font-mono">+${t.taxAmt.toFixed(2)}</span></div>}
                      <div className="flex justify-between text-lg font-bold border-t border-white/10 pt-2 mt-1"><span className="text-white">Quote Total</span><span className="text-emerald-400 font-mono">${t.total.toFixed(2)}</span></div>
                    </div>

                    {/* Margin Guardrail — admin only, never shown to customer */}
                    {t.subtotal > 0 && (
                      <div className={`rounded-xl border p-3 ${m.bg} flex items-center gap-3`}>
                        <TrendingUp className={`w-5 h-5 shrink-0 ${m.text}`} aria-hidden="true" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className={`text-xs font-black uppercase tracking-widest ${m.text}`}>{m.label}</span>
                            <span className={`text-lg font-black tabular ${m.text}`}>{marginPct.toFixed(1)}%</span>
                            <span className="text-[11px] text-zinc-500">
                              · ${grossProfit.toFixed(2)} profit on ${priceBeforeTax.toFixed(2)} price
                            </span>
                          </div>
                          <p className="text-[10px] text-zinc-500 mt-0.5">
                            🔒 Admin-only — never shown on the customer copy. Target: <strong className="text-zinc-400">{minMargin}%+</strong> (edit in Financial settings)
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* §6 — Terms & Notes */}
              <div>
                <SectionLabel num={6} title="Terms, Notes & Comments" sub="Add expiration, payment terms, and customer notes" done={s6Done} />
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <label className="text-[10px] text-zinc-500 uppercase font-bold">Payment Terms</label>
                      <SnippetInserter
                        snippets={settings.quoteSnippets || []}
                        target="terms"
                        onInsert={(text) => setForm({ ...form, terms: form.terms ? `${form.terms}\n${text}` : text })}
                      />
                    </div>
                    <textarea value={form.terms} onChange={e => setForm({ ...form, terms: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white text-sm outline-none min-h-[50px]" placeholder="e.g. Net 30, 50% deposit required..." />
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <label className="text-[10px] text-zinc-500 uppercase font-bold">Comments</label>
                      <SnippetInserter
                        snippets={settings.quoteSnippets || []}
                        target="notes"
                        onInsert={(text) => setForm({ ...form, notes: form.notes ? `${form.notes}\n\n${text}` : text })}
                      />
                    </div>
                    <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white text-sm outline-none min-h-[60px]" placeholder={settings.defaultQuoteComment || 'CERTIFICATE OF CONFORMANCE: This is to certify that all processes conform to applicable Specifications, Drawings, Contracts, and/or Order Requirements unless otherwise specified.'} />
                    {!form.notes && (settings.defaultQuoteComment || true) && (
                      <button onClick={() => setForm({ ...form, notes: settings.defaultQuoteComment || 'CERTIFICATE OF CONFORMANCE: This is to certify that all processes conform to applicable Specifications, Drawings, Contracts, and/or Order Requirements unless otherwise specified.' })} className="text-[10px] text-blue-400 hover:text-blue-300 mt-1">+ Insert default comment</button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ══ PREVIEW TAB ══ */}
            {modalTab === 'preview' && (
              <div className="p-3 sm:p-5 overflow-y-auto flex-1">
                <div className="bg-white text-black rounded-xl p-4 sm:p-8 max-w-xl mx-auto shadow-lg" style={{ fontFamily: '-apple-system, sans-serif' }}>
                  {/* Company Header */}
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      {settings.companyLogo && <img src={settings.companyLogo} className="h-12 mb-2 object-contain" alt="" />}
                      <div className="text-xl font-extrabold text-gray-900">{settings.companyName || 'Company Name'}</div>
                      {settings.companyAddress && <div className="text-xs text-gray-500 mt-1">{settings.companyAddress}</div>}
                      {settings.companyPhone && <div className="text-xs text-gray-500">{settings.companyPhone}</div>}
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-extrabold text-gray-400">QUOTE</div>
                      <div className="text-sm text-gray-500 mt-1">{form.quoteNumber || editing?.quoteNumber || 'Q-001'}</div>
                      <div className="text-xs text-gray-400 mt-2">Date: {new Date().toLocaleDateString()}</div>
                      {form.validUntil && <div className="text-xs text-gray-400">Valid Until: {form.validUntil}</div>}
                    </div>
                  </div>
                  {/* Bill To */}
                  <div className="bg-gray-50 rounded-lg p-3 mb-4 border border-gray-200">
                    <div className="text-[10px] uppercase text-gray-400 font-bold mb-1">Bill To</div>
                    <div className="font-bold text-gray-900">{billTo.name || '—'}</div>
                    {billTo.contactPerson && <div className="text-xs text-gray-600">{billTo.contactPerson}</div>}
                    {billTo.email && <div className="text-xs text-gray-500">{billTo.email}</div>}
                    {billTo.phone && <div className="text-xs text-gray-500">{billTo.phone}</div>}
                    {billTo.address && <div className="text-xs text-gray-400 mt-1">{billTo.address}</div>}
                  </div>
                  {/* Scope */}
                  {form.jobDescription && (
                    <div className="bg-blue-50 rounded-lg p-3 mb-4 border border-blue-200">
                      <div className="text-[10px] uppercase text-blue-600 font-bold mb-1">Scope of Work</div>
                      <div className="text-xs text-blue-900">{form.jobDescription}</div>
                    </div>
                  )}
                  {/* Items Table */}
                  <div className="overflow-x-auto -mx-1 px-1">
                    <table className="w-full text-xs mb-4 min-w-[380px]">
                      <thead><tr className="border-b-2 border-gray-200 text-gray-500 text-[10px] uppercase"><th className="text-left py-2">Description</th><th className="text-center py-2">Qty</th><th className="text-center py-2">Unit</th><th className="text-right py-2">Rate</th><th className="text-right py-2">Amount</th></tr></thead>
                      <tbody>
                        {items.filter(i => i.description).map((item, i) => (
                          <tr key={i} className="border-b border-gray-100"><td className="py-2 text-gray-800">{item.description}</td><td className="py-2 text-center text-gray-600">{item.qty}</td><td className="py-2 text-center text-gray-400">{item.unit || 'ea'}</td><td className="py-2 text-right text-gray-600">${item.unitPrice.toFixed(2)}</td><td className="py-2 text-right font-bold text-gray-800">${(item.qty * item.unitPrice).toFixed(2)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Totals */}
                  {(() => { const t = calcTotals(); return (
                    <div className="flex justify-end">
                      <div className="w-48 space-y-1 text-xs">
                        <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>${t.subtotal.toFixed(2)}</span></div>
                        {form.markupPct > 0 && <div className="flex justify-between"><span className="text-gray-500">Markup ({form.markupPct}%)</span><span>+${(t.afterMarkup - t.subtotal).toFixed(2)}</span></div>}
                        {form.discountPct > 0 && <div className="flex justify-between"><span className="text-gray-500">Discount</span><span className="text-red-600">-${t.discountAmt.toFixed(2)}</span></div>}
                        {form.taxRate > 0 && <div className="flex justify-between"><span className="text-gray-500">Tax ({form.taxRate}%)</span><span>+${t.taxAmt.toFixed(2)}</span></div>}
                        <div className="flex justify-between pt-2 border-t-2 border-gray-800 text-base font-extrabold"><span>Total</span><span>${t.total.toFixed(2)}</span></div>
                      </div>
                    </div>
                  ); })()}
                  {/* Terms & Notes */}
                  {form.terms && <div className="mt-4 pt-3 border-t border-gray-200 text-[10px] text-gray-500"><span className="font-bold uppercase">Terms:</span> {form.terms}</div>}
                  {form.notes && <div className="mt-2 text-[10px] text-gray-500"><span className="font-bold uppercase">Notes:</span> {form.notes}</div>}
                  {/* Signature Lines */}
                  <div className="flex gap-8 mt-10">
                    <div className="flex-1 pt-2 border-t border-gray-300 text-[10px] text-gray-400">{settings.companyName || 'Company'}</div>
                    <div className="flex-1 pt-2 border-t border-gray-300 text-[10px] text-gray-400">Client's signature</div>
                  </div>
                </div>
              </div>
            )}

            {/* ══ SEND TAB — Invoice2go style ══ */}
            {modalTab === 'send' && (
              <div className="flex-1 overflow-y-auto">
                <div className="flex flex-col md:flex-row h-full">
                  {/* Left — Email Composer */}
                  <div className="flex-1 p-5 space-y-4 border-r border-white/5">
                    <div>
                      <label className="text-[10px] text-zinc-500 uppercase font-bold block mb-1">To</label>
                      <div className="flex items-center gap-2">
                        <input value={sendEmail.to || billTo.email || ''} onChange={e => setSendEmail({ ...sendEmail, to: e.target.value })} className="flex-1 bg-zinc-950 border border-white/10 rounded-lg p-2.5 text-white text-sm outline-none" placeholder="customer@email.com" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 uppercase font-bold block mb-1">Subject</label>
                      <input value={sendEmail.subject || `Quote ${form.quoteNumber} from ${settings.companyName || 'Company'}`} onChange={e => setSendEmail({ ...sendEmail, subject: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 text-white text-sm outline-none" />
                    </div>
                    <div>
                      <textarea value={sendEmail.body} onChange={e => setSendEmail({ ...sendEmail, body: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white text-sm outline-none min-h-[140px]" />
                    </div>
                    <div className="text-center text-xs text-zinc-500 py-2">Already approved? <button className="text-blue-400 hover:text-blue-300 underline" onClick={() => { if (editing) updateStatus(editing, 'accepted'); }}>Click here</button> to mark as accepted.</div>
                    {/* Approval Link */}
                    <div className="bg-zinc-800/30 rounded-xl p-3">
                      <p className="text-[10px] text-zinc-500 uppercase font-bold mb-1.5">Approval Link</p>
                      <div className="flex gap-2">
                        <input readOnly value={editing ? getPortalLink(editing) : '(save first)'} className="flex-1 bg-zinc-950 border border-white/10 rounded-lg p-2 text-zinc-400 text-[11px] font-mono outline-none" />
                        <button onClick={async () => { if (editing) { try { await navigator.clipboard.writeText(getPortalLink(editing)); addToast('success', 'Link copied!'); } catch {} } }} className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shrink-0"><Copy className="w-3 h-3" /></button>
                      </div>
                    </div>
                  </div>
                  {/* Right — Summary + Actions */}
                  <div className="w-full md:w-64 p-5 space-y-4 bg-zinc-800/20 shrink-0">
                    <div>
                      <p className="text-white font-bold">Quote</p>
                      <p className="text-blue-400 font-mono text-lg font-bold">#{form.quoteNumber}</p>
                      <span className="text-[10px] font-bold text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded mt-1 inline-block">{editing?.status?.toUpperCase() || 'DRAFT'}</span>
                    </div>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between"><span className="text-zinc-500">Date</span><span className="text-zinc-300">{new Date().toLocaleDateString()}</span></div>
                      {form.validUntil && <div className="flex justify-between"><span className="text-zinc-500">Valid Until</span><span className="text-zinc-300">{form.validUntil}</span></div>}
                      <div className="flex justify-between"><span className="text-zinc-500">Subtotal</span><span className="text-zinc-300 font-mono">${calcTotals().subtotal.toFixed(2)}</span></div>
                      {form.discountPct > 0 && <div className="flex justify-between"><span className="text-zinc-500">Discount</span><span className="text-red-400 font-mono">-${calcTotals().discountAmt.toFixed(2)}</span></div>}
                      <div className="flex justify-between font-bold border-t border-white/10 pt-2"><span className="text-white">Total</span><span className="text-emerald-400 font-mono">${calcTotals().total.toFixed(2)}</span></div>
                    </div>
                    <button onClick={() => {
                      const to = sendEmail.to || billTo.email || '';
                      const subj = encodeURIComponent(sendEmail.subject || `Quote ${form.quoteNumber} from ${settings.companyName}`);
                      const portalLink = editing ? getPortalLink(editing) : '';
                      const body = encodeURIComponent(`${sendEmail.body}\n\nView & Approve Online:\n${portalLink}\n\nThank you,\n${settings.companyName || ''}\n${settings.companyPhone || ''}`);
                      window.open(`mailto:${to}?subject=${subj}&body=${body}`, '_blank');
                      if (editing && editing.status === 'draft') updateStatus(editing, 'sent');
                    }} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"><Send className="w-4 h-4" /> Send Quote</button>
                    <button onClick={() => { if (editing) printQuotePDF(editing, settings); }} className="w-full bg-zinc-700 hover:bg-zinc-600 text-white py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2"><Download className="w-4 h-4" /> Download PDF</button>
                    <button onClick={async () => { if (editing) { try { await navigator.clipboard.writeText(getPortalLink(editing)); addToast('success', 'Link copied!'); } catch {} } }} className="w-full border border-white/10 text-zinc-400 hover:text-white py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2"><Copy className="w-4 h-4" /> Copy Share Link</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Overlay>
        );
      })()}

      {/* Template Picker — load saved quote template (Round 1 #15) */}
      {showTemplatePicker && (() => {
        const templates = settings.quoteTemplates || [];
        // Sort: customer match first, then most recently used
        const currentCustomer = billTo.name?.toLowerCase();
        const sorted = [...templates].sort((a, b) => {
          const aMatch = currentCustomer && a.customer?.toLowerCase() === currentCustomer ? 1 : 0;
          const bMatch = currentCustomer && b.customer?.toLowerCase() === currentCustomer ? 1 : 0;
          if (aMatch !== bMatch) return bMatch - aMatch;
          return (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt);
        });
        return (
          <Overlay open onClose={() => setShowTemplatePicker(false)} ariaLabel="Quote templates" zIndex={1100} backdrop="bg-zinc-950">
            <div className="bg-zinc-900 border border-purple-500/25 rounded-2xl shadow-2xl w-full max-w-xl flex flex-col overflow-hidden my-4" style={{ maxHeight: 'calc(100dvh - 2rem)' }} onClick={e => e.stopPropagation()}>
              <div className="p-4 border-b border-white/10 flex items-center justify-between gap-3 bg-gradient-to-b from-purple-500/10 to-transparent">
                <div className="min-w-0">
                  <h3 className="font-bold text-white flex items-center gap-2">📋 Quote Templates</h3>
                  <p className="text-[11px] text-zinc-500 mt-0.5">One-click clone — line items, pricing, terms, notes all fill in.</p>
                </div>
                <button type="button" aria-label="Close" onClick={() => setShowTemplatePicker(false)} className="text-zinc-400 hover:text-white p-2"><X className="w-5 h-5" aria-hidden="true" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {sorted.length === 0 ? (
                  <p className="text-center text-sm text-zinc-500 py-8">No templates yet. Use "Save as Template" on a finished quote to create one.</p>
                ) : sorted.map(tpl => {
                  const isMatch = currentCustomer && tpl.customer?.toLowerCase() === currentCustomer;
                  return (
                    <div key={tpl.id} className={`border rounded-xl p-3 transition-all flex items-center gap-3 ${isMatch ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-zinc-800/40 border-white/5'}`}>
                      <button type="button" onClick={() => loadTemplate(tpl)} className="flex-1 text-left min-w-0 hover:bg-white/[0.03] -m-3 p-3 rounded-xl">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold text-white truncate">{tpl.label}</p>
                          {isMatch && <span className="text-[9px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded uppercase tracking-widest">Match</span>}
                        </div>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                          {tpl.customer ? <span className="text-zinc-400">{tpl.customer}</span> : <span className="italic">Any customer</span>}
                          {' · '}{tpl.items.length} line item{tpl.items.length !== 1 ? 's' : ''}
                          {tpl.lastUsedAt && <> · used {new Date(tpl.lastUsedAt).toLocaleDateString()}</>}
                        </p>
                      </button>
                      <button type="button" onClick={() => deleteTemplate(tpl.id)} aria-label="Delete template" className="text-zinc-500 hover:text-red-400 p-1 shrink-0"><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
                    </div>
                  );
                })}
              </div>
            </div>
          </Overlay>
        );
      })()}

      {/* Click outside to close action menu */}
      {actionMenuId && <div className="fixed inset-0 z-40" onClick={() => setActionMenuId(null)} />}
    </div>
  );
};
