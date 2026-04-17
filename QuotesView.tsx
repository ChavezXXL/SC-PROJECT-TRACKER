import React, { useState, useEffect } from 'react';
import { Plus, FileText, Send, Check, X, Trash2, Copy, Download, Edit2, Save, ChevronDown, DollarSign, User, MapPin, Phone, Mail, Package } from 'lucide-react';
import type { Quote, QuoteLineItem, QuoteStatus, SystemSettings, CustomerContact } from './types';
import * as DB from './services/mockDb';
import { printQuotePDF, printInvoicePDF } from './services/pdfService';

interface QuotesViewProps {
  addToast: (type: 'success' | 'error' | 'info', message: string) => void;
  user: { id: string; name: string };
  onJobCreate: (data: { poNumber: string; partNumber: string; customer: string; quantity: number; dueDate: string; info: string; quoteAmount: number; linkedQuoteId: string }) => Promise<void>;
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

// ── Section Label Component ──
const SectionLabel = ({ num, title, sub }: { num: number; title: string; sub?: string }) => (
  <div className="flex items-center gap-3 mb-3">
    <span className="bg-blue-500/10 text-blue-400 w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0">{num}</span>
    <div><h4 className="text-sm font-bold text-white">{title}</h4>{sub && <p className="text-[10px] text-zinc-500">{sub}</p>}</div>
  </div>
);

// ── Contact Input Block ──
const ContactBlock = ({ label, contact, onChange, clients, savedContacts }: { label: string; contact: CustomerContact; onChange: (c: CustomerContact) => void; clients?: string[]; savedContacts?: Record<string, CustomerContact> }) => (
  <div className="space-y-2 bg-zinc-800/30 rounded-xl p-4 border border-white/5">
    <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">{label}</p>
    {clients && clients.length > 0 ? (
      <select value={contact.name} onChange={e => {
        const name = e.target.value;
        const saved = savedContacts?.[name];
        if (saved) { onChange({ ...saved, name }); }
        else { onChange({ ...contact, name }); }
      }} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 text-white text-sm outline-none">
        <option value="">— Select client —</option>
        {clients.sort((a, b) => a.localeCompare(b)).map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    ) : (
      <div className="relative"><User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" /><input value={contact.name} onChange={e => onChange({ ...contact, name: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 pl-9 text-white text-sm outline-none" placeholder="Company or Customer Name" /></div>
    )}
    <div className="relative"><User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" /><input value={contact.contactPerson || ''} onChange={e => onChange({ ...contact, contactPerson: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 pl-9 text-white text-sm outline-none" placeholder="Contact Person" /></div>
    <div className="grid grid-cols-2 gap-2">
      <div className="relative"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" /><input value={contact.email || ''} onChange={e => onChange({ ...contact, email: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 pl-9 text-white text-sm outline-none" placeholder="Email" /></div>
      <div className="relative"><Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" /><input value={contact.phone || ''} onChange={e => onChange({ ...contact, phone: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 pl-9 text-white text-sm outline-none" placeholder="Phone" /></div>
    </div>
    <div className="relative"><MapPin className="absolute left-3 top-3 w-3.5 h-3.5 text-zinc-600" /><textarea value={contact.address || ''} onChange={e => onChange({ ...contact, address: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 pl-9 text-white text-sm outline-none min-h-[50px] resize-none" placeholder="Street Address, City, State ZIP" rows={2} /></div>
  </div>
);

export const QuotesView: React.FC<QuotesViewProps> = ({ addToast, user, onJobCreate }) => {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [settings, setSettings] = useState<SystemSettings>(DB.getSettings());
  const [filter, setFilter] = useState<QuoteStatus | 'all'>('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Quote | null>(null);
  const [items, setItems] = useState<QuoteLineItem[]>([emptyLine()]);
  const [billTo, setBillTo] = useState<CustomerContact>(emptyContact());
  const [shipTo, setShipTo] = useState<CustomerContact>(emptyContact());
  const [shipToDifferent, setShipToDifferent] = useState(false);
  const [form, setForm] = useState({ jobDescription: '', notes: '', terms: '', validUntil: '', markupPct: 25, discountPct: 0, taxRate: 0, depositRequired: false, depositPct: 50, quoteNumber: '' });
  const [projectFields, setProjectFields] = useState<Record<string, string>>({});
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [modalTab, setModalTab] = useState<'edit' | 'preview' | 'send'>('edit');
  const [sendEmail, setSendEmail] = useState({ to: '', subject: '', body: 'Thank you for your business. Please review the attached quote and let us know if you have any questions.' });

  useEffect(() => {
    const u1 = DB.subscribeQuotes(setQuotes);
    const u2 = DB.subscribeSettings(setSettings);
    return () => { u1(); u2(); };
  }, []);

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
    setForm({ jobDescription: '', notes: '', terms: settings.defaultPaymentTerms || 'Net 30', validUntil: '', markupPct: 25, discountPct: 0, taxRate: settings.taxRate || 0, depositRequired: false, depositPct: 50, quoteNumber: nextNum });
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
    setForm({ jobDescription: q.jobDescription || '', notes: q.notes || '', terms: q.terms || '', validUntil: q.validUntil || '', markupPct: q.markupPct, discountPct: q.discountPct || 0, taxRate: q.taxRate || 0, depositRequired: q.depositRequired || false, depositPct: q.depositPct || 50, quoteNumber: q.quoteNumber });
    setProjectFields(q.projectFields || {});
    setSendEmail({ to: q.billTo?.email || '', subject: `Quote ${q.quoteNumber} from ${settings.companyName || 'Our Company'}`, body: 'Thank you for your business. Please review the attached quote and let us know if you have any questions.' });
    setModalTab('edit');
    setShowModal(true);
  };

  const updateItem = (idx: number, field: keyof QuoteLineItem, value: any) => {
    const next = [...items];
    (next[idx] as any)[field] = value;
    next[idx].total = next[idx].qty * next[idx].unitPrice;
    setItems(next);
  };

  const addItem = () => setItems([...items, emptyLine()]);
  const removeItem = (idx: number) => { if (items.length > 1) setItems(items.filter((_, i) => i !== idx)); };

  const calcTotals = () => {
    const subtotal = items.reduce((a, i) => a + i.total, 0);
    const afterMarkup = subtotal * (1 + form.markupPct / 100);
    const discountAmt = afterMarkup * (form.discountPct / 100);
    const afterDiscount = afterMarkup - discountAmt;
    const taxAmt = afterDiscount * (form.taxRate / 100);
    const total = afterDiscount + taxAmt;
    const depositAmt = form.depositRequired ? total * (form.depositPct / 100) : 0;
    return { subtotal, afterMarkup, discountAmt, afterDiscount, taxAmt, total, depositAmt };
  };

  const handleSave = async () => {
    if (!billTo.name) { addToast('error', 'Customer name is required'); return; }
    if (items.every(i => !i.description)) { addToast('error', 'Add at least one line item'); return; }
    const { subtotal, discountAmt, taxAmt, total, depositAmt } = calcTotals();
    const validItems = items.filter(i => i.description.trim()).map(i => ({ ...i, total: i.qty * i.unitPrice }));
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
      depositRequired: form.depositRequired || undefined,
      depositPct: form.depositRequired ? form.depositPct : undefined,
      depositAmt: form.depositRequired ? depositAmt : undefined,
      status: editing?.status || 'draft',
      validUntil: form.validUntil || undefined,
      jobDescription: form.jobDescription || undefined,
      notes: form.notes || undefined,
      terms: form.terms || undefined,
      createdAt: editing?.createdAt || Date.now(),
      createdBy: user.id,
      createdByName: user.name,
      ...(editing ? { sentAt: editing.sentAt, acceptedAt: editing.acceptedAt, declinedAt: editing.declinedAt, linkedJobId: editing.linkedJobId } : {}),
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

  const updateStatus = async (q: Quote, status: QuoteStatus) => {
    const updates: Partial<Quote> = { status };
    if (status === 'sent') updates.sentAt = Date.now();
    if (status === 'accepted') updates.acceptedAt = Date.now();
    if (status === 'declined') updates.declinedAt = Date.now();
    try {
      await DB.saveQuote({ ...q, ...updates } as Quote);
      addToast('success', `Quote marked as ${status}`);
      if (status === 'accepted') {
        const desc = q.items.map(i => i.description).join(', ');
        await onJobCreate({ poNumber: q.quoteNumber, partNumber: q.items[0]?.description || 'See quote', customer: q.customer, quantity: q.items.reduce((a, i) => a + i.qty, 0), dueDate: q.validUntil || '', info: desc, quoteAmount: q.total, linkedQuoteId: q.id });
        addToast('success', 'Job auto-created from accepted quote');
      }
    } catch { addToast('error', 'Failed to update'); }
    setActionMenuId(null);
  };

  const getPortalLink = (q: Quote) => {
    const base = window.location.origin + window.location.pathname;
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
${q.depositRequired && q.depositAmt ? `Deposit Due: $${q.depositAmt.toFixed(2)} (${q.depositPct}%)` : ''}

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
    <div className="max-w-4xl w-full space-y-6">
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
          <p className="text-2xl font-black text-blue-400">${monthTotal >= 1000 ? `${(monthTotal / 1000).toFixed(1)}k` : monthTotal.toFixed(0)}</p>
        </div>
        <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3 text-center">
          <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Awaiting Response</p>
          <p className="text-2xl font-black text-yellow-400">${pendingTotal >= 1000 ? `${(pendingTotal / 1000).toFixed(1)}k` : pendingTotal.toFixed(0)}</p>
        </div>
        <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3 text-center">
          <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Win Rate</p>
          <p className={`text-2xl font-black ${acceptRate >= 50 ? 'text-emerald-400' : acceptRate >= 25 ? 'text-yellow-400' : 'text-zinc-400'}`}>{acceptRate}%</p>
        </div>
      </div>

      {/* ── Status Filters ── */}
      <div className="flex gap-1 bg-zinc-900/50 p-1 rounded-lg border border-white/5 overflow-x-auto">
        {(['all', 'draft', 'sent', 'accepted', 'declined'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors whitespace-nowrap ${filter === f ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'}`}>
            {f === 'all' ? `All (${quotes.length})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${quotes.filter(q => q.status === f).length})`}
          </button>
        ))}
      </div>

      {/* ── Quote List ── */}
      <div className="space-y-3">
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
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-lg font-black text-white">${q.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    {q.depositRequired && q.depositAmt && <p className="text-[10px] text-cyan-400">Deposit: ${q.depositAmt.toFixed(2)}</p>}
                    <p className="text-[10px] text-zinc-500">{q.items.length} item{q.items.length !== 1 ? 's' : ''} · {q.markupPct}% markup</p>
                  </div>
                  <div className="relative">
                    <button onClick={() => setActionMenuId(actionMenuId === q.id ? null : q.id)} className="p-2 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"><ChevronDown className="w-4 h-4" /></button>
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
                        {q.status === 'accepted' && <button onClick={() => { printInvoicePDF(q, null, settings); setActionMenuId(null); }} className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-white/5 flex items-center gap-2"><DollarSign className="w-3.5 h-3.5" /> Generate Invoice</button>}
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
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in" onClick={() => setShowModal(false)}>
          <div className="bg-zinc-900 border border-white/10 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            {/* ── Modal Header + Tabs ── */}
            <div className="border-b border-white/10 bg-zinc-800/50">
              <div className="p-4 pb-0 flex justify-between items-start">
                <h3 className="font-bold text-white text-lg">{editing ? `Edit ${editing.quoteNumber}` : 'Create a Quote'}</h3>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowModal(false)} className="text-zinc-400 hover:text-white text-sm">Close</button>
                  <button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-lg font-bold text-sm">Save</button>
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

            {/* ── EDIT TAB ── */}
            <div className={`p-5 overflow-y-auto space-y-6 flex-1 ${modalTab !== 'edit' ? 'hidden' : ''}`}>

              {/* §1 — Customer Information */}
              <div>
                <SectionLabel num={1} title="Customer Information" sub="Who is this quote for?" />
                <div className="space-y-3">
                  <ContactBlock label="Bill To *" contact={billTo} onChange={setBillTo} clients={clients} savedContacts={settings.clientContacts} />
                  <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
                    <input type="checkbox" checked={shipToDifferent} onChange={e => setShipToDifferent(e.target.checked)} className="rounded" />
                    Ship to a different address
                  </label>
                  {shipToDifferent && <ContactBlock label="Ship To" contact={shipTo} onChange={setShipTo} />}
                </div>
              </div>

              {/* §2 — Quote Number + Project Details */}
              <div>
                <SectionLabel num={2} title="Project Details" sub="Quote number, PO, part number, and other job info" />
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
                <SectionLabel num={3} title="Scope of Work" sub="Describe what you're quoting for" />
                <textarea value={form.jobDescription} onChange={e => setForm({ ...form, jobDescription: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white text-sm outline-none min-h-[70px] focus:ring-2 focus:ring-blue-500/30" placeholder="e.g. Deburr 500 units of Part #ABC-123, tumble finish, QC inspection..." />
              </div>

              {/* §4 — Line Items */}
              <div>
                <SectionLabel num={4} title="Line Items" sub="Add the items, services, or labor being quoted" />
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
                    </div>
                  ))}
                </div>
                <button onClick={addItem} className="mt-2 text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"><Plus className="w-3 h-3" /> Add Line Item</button>
              </div>

              {/* §4 — Pricing */}
              <div>
                <SectionLabel num={5} title="Pricing & Adjustments" sub="Markup, discount, and tax" />
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

              {/* ── Totals ── */}
              {(() => {
                const t = calcTotals();
                return (
                  <div className="bg-zinc-800/50 rounded-xl p-4 space-y-1.5">
                    <div className="flex justify-between text-sm"><span className="text-zinc-500">Subtotal</span><span className="text-zinc-300 font-mono">${t.subtotal.toFixed(2)}</span></div>
                    {form.markupPct > 0 && <div className="flex justify-between text-sm"><span className="text-zinc-500">Markup ({form.markupPct}%)</span><span className="text-zinc-300 font-mono">+${(t.afterMarkup - t.subtotal).toFixed(2)}</span></div>}
                    {form.discountPct > 0 && <div className="flex justify-between text-sm"><span className="text-zinc-500">Discount ({form.discountPct}%)</span><span className="text-red-400 font-mono">-${t.discountAmt.toFixed(2)}</span></div>}
                    {form.taxRate > 0 && <div className="flex justify-between text-sm"><span className="text-zinc-500">Tax ({form.taxRate}%)</span><span className="text-zinc-300 font-mono">+${t.taxAmt.toFixed(2)}</span></div>}
                    <div className="flex justify-between text-lg font-bold border-t border-white/10 pt-2 mt-1"><span className="text-white">Quote Total</span><span className="text-emerald-400 font-mono">${t.total.toFixed(2)}</span></div>
                    {form.depositRequired && <div className="flex justify-between text-sm text-cyan-400"><span>Deposit Due ({form.depositPct}%)</span><span className="font-mono">${t.depositAmt.toFixed(2)}</span></div>}
                  </div>
                );
              })()}

              {/* §5 — Deposit */}
              <div>
                <SectionLabel num={6} title="Deposit Request" sub="Require upfront payment before starting" />
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
                    <input type="checkbox" checked={form.depositRequired} onChange={e => setForm({ ...form, depositRequired: e.target.checked })} className="rounded" />
                    Require deposit
                  </label>
                  {form.depositRequired && (
                    <div className="flex gap-1">
                      {[25, 50, 75, 100].map(p => (
                        <button key={p} onClick={() => setForm({ ...form, depositPct: p })}
                          className={`px-2.5 py-1 text-xs font-bold rounded-lg ${form.depositPct === p ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}>
                          {p}%
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* §6 — Terms & Notes */}
              <div>
                <SectionLabel num={7} title="Terms, Notes & Comments" sub="Add expiration, payment terms, and customer notes" />
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase font-bold block mb-1">Payment Terms</label>
                    <textarea value={form.terms} onChange={e => setForm({ ...form, terms: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white text-sm outline-none min-h-[50px]" placeholder="e.g. Net 30, 50% deposit required..." />
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase font-bold block mb-1">Comments</label>
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
                        {form.depositRequired && <div className="flex justify-between text-cyan-700 font-semibold"><span>Deposit ({form.depositPct}%)</span><span>${t.depositAmt.toFixed(2)}</span></div>}
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
                      {form.depositRequired && <div className="flex justify-between text-cyan-400"><span>Deposit</span><span className="font-mono">${calcTotals().depositAmt.toFixed(2)}</span></div>}
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
        </div>
      )}

      {/* Click outside to close action menu */}
      {actionMenuId && <div className="fixed inset-0 z-40" onClick={() => setActionMenuId(null)} />}
    </div>
  );
};
