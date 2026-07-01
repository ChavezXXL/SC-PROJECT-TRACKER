// CustomerPosView — a phone-first library of customer PO photos, filed by
// customer. Snap a picture of the PO, it OCR-reads the PO#/part#/customer,
// matches it to an existing job (showing whether that job is active or done),
// and tracks whether you've invoiced it — so you stop forgetting to bill.
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  FileText, Camera, Upload, X, Search, Trash2, Link2, ChevronDown, ChevronRight,
  Loader2, CheckCircle, Building2, Filter, Send, DollarSign, Edit3, Archive,
  AlertTriangle, Clock, Plus, Briefcase, Download,
} from 'lucide-react';

import { CustomerPoFile, Job, SystemSettings, PoInvoiceStatus } from '../types';
import * as DB from '../services/mockDb';
import { Overlay } from '../components/Overlay';
import { scanDocument } from '../services/poScanner';
import { normDate, todayFmt } from '../utils/date';
import {
  derivePo, resolveStages, matchJobForPo, isJobComplete, readyToInvoiceList,
} from '../utils/poOrganizer';
import type { PoDerived } from '../utils/poOrganizer';

/** Whole days since a timestamp (0 = today). */
const daysSince = (ms?: number): number | null =>
  typeof ms === 'number' && ms > 0 ? Math.max(0, Math.floor((Date.now() - ms) / 86400000)) : null;

/** Normalize a (possibly OCR'd / garbage) due date to a VALID, zero-padded
 *  MM/DD/YYYY — or '' if it isn't a real calendar date. Keeps junk out of jobs. */
const normalizeDue = (s?: string): string => {
  const d = normDate(s || '');
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  const mo = +m[1], da = +m[2];
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return '';
  return `${String(mo).padStart(2, '0')}/${String(da).padStart(2, '0')}/${m[3]}`;
};

/** MM/DD/YYYY (or YYYY-MM-DD) → YYYY-MM-DD for a native <input type="date">. */
const toDateInput = (s?: string): string => {
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return '';
};
/** YYYY-MM-DD (from the date input) → MM/DD/YYYY for storage. */
const fromDateInput = (s?: string): string => {
  const m = (s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
};

/** "today" / "1d" / "5d ago" for invoice aging. */
const agingLabel = (ms?: number): string => {
  const d = daysSince(ms);
  if (d === null) return '';
  return d === 0 ? 'done today' : d === 1 ? '1 day' : `${d} days`;
};

function downloadCsv(filename: string, rows: (string | number | undefined)[][]) {
  const esc = (v: string | number | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = rows.map(r => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Compress + re-encode to JPEG so uploads are small and Storage-friendly.
function compressImage(file: File, maxWidth = 1600, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas unavailable')); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Could not read image'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, b64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

type MatchFilter = '' | 'active' | 'completed' | 'unmatched';
type InvoiceFilter = '' | 'ready' | 'not-invoiced' | 'invoiced' | 'paid';

const INVOICE_OPTIONS: { v: PoInvoiceStatus; l: string }[] = [
  { v: 'not-invoiced', l: 'Not invoiced' },
  { v: 'invoiced', l: 'Invoiced' },
  { v: 'paid', l: 'Paid' },
  { v: 'not-applicable', l: 'No invoice needed' },
];

export const CustomerPosView = ({ addToast, confirm, user }: any) => {
  const [pos, setPos] = useState<CustomerPoFile[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [settings, setSettings] = useState<SystemSettings>(DB.getSettings());

  // Filters
  const [search, setSearch] = useState('');
  const [fCustomer, setFCustomer] = useState('');
  const [fMatch, setFMatch] = useState<MatchFilter>('');
  const [fInvoice, setFInvoice] = useState<InvoiceFilter>('');
  const [showArchived, setShowArchived] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<string | null>(null);

  // Draft (the upload / edit modal)
  const [draft, setDraft] = useState<Partial<CustomerPoFile> | null>(null);
  const [editing, setEditing] = useState(false);         // editing an existing PO vs new upload
  const [draftPreview, setDraftPreview] = useState('');  // base64 (new) or photoUrl (edit)
  const [scanning, setScanning] = useState(false);
  const [scanPct, setScanPct] = useState(0);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState('');   // id of PO currently being turned into a job
  const [newCustomer, setNewCustomer] = useState(false);          // typing a brand-new customer name
  const [chipTarget, setChipTarget] = useState<'po' | 'job' | 'part'>('po'); // where a tapped scan-chip lands
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scanTimer = useRef<any>(null);
  const scanningRef = useRef(false);   // synchronous re-entry guards (state is async)
  const savingRef = useRef(false);

  // Clear the scan-timeout if the view unmounts mid-scan.
  useEffect(() => () => { if (scanTimer.current) clearTimeout(scanTimer.current); }, []);

  useEffect(() => {
    const u1 = DB.subscribeCustomerPos(setPos);
    const u2 = DB.subscribeJobs(setJobs);
    const u3 = DB.subscribeSettings(setSettings);
    return () => { u1(); u2(); u3(); };
  }, []);

  const stages = useMemo(() => resolveStages(settings), [settings]);

  const clients = useMemo(() => {
    const set = new Set<string>((settings.clients || []).map(c => c.trim()).filter(Boolean));
    jobs.forEach(j => { if (j.customer?.trim()) set.add(j.customer.trim()); });
    pos.forEach(p => { if (p.customerName?.trim()) set.add(p.customerName.trim()); });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [settings.clients, jobs, pos]);

  // Per-PO derived state (match + invoice), recomputed when data changes.
  const derivedMap = useMemo(() => {
    const map = new Map<string, PoDerived>();
    pos.forEach(p => map.set(p.id, derivePo(p, jobs, stages)));
    return map;
  }, [pos, jobs, stages]);

  // The "send the invoice!" worklist — job done but not invoiced yet.
  const readyList = useMemo(() => readyToInvoiceList(pos, jobs, settings), [pos, jobs, settings]);

  /** Live match for the open draft (so the modal shows the current match + status). */
  const draftMatch = useMemo(() => {
    if (!draft) return null;
    const m = matchJobForPo({ poNumber: draft.poNumber, partNumber: draft.partNumber, linkedJobId: editing ? draft.linkedJobId : undefined }, jobs);
    if (!m.job) return null;
    return { job: m.job, complete: isJobComplete(m.job, stages), field: m.field, exact: m.exact };
  }, [draft?.poNumber, draft?.partNumber, draft?.linkedJobId, editing, jobs, stages]);

  const handlePhoto = async (file: File) => {
    if (!file.type.startsWith('image/')) { addToast('error', 'Pick an image / photo'); return; }
    if (scanningRef.current) return;   // synchronous guard — don't overlap scans
    scanningRef.current = true;
    const id = `cpo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setEditing(false);
    setScanning(true);
    setScanPct(0);
    // Safety: never let the scanning overlay get stuck if OCR hangs.
    if (scanTimer.current) clearTimeout(scanTimer.current);
    scanTimer.current = setTimeout(() => { setScanning(false); addToast('error', 'Scan took too long — try again or type it in.'); }, 60000);
    let ocrFailed = false;
    try {
      const preview = await compressImage(file, 1600, 0.7);
      setDraftPreview(preview);
      // OCR — best effort. Pre-fills the form; the user verifies.
      let fields: any = {};
      let rawText = '';
      try {
        const result = await scanDocument(file, (pct) => setScanPct(pct));
        fields = result.fields || {};
        rawText = result.rawText || '';
      } catch { ocrFailed = true; }
      const matched = matchJobForPo({ poNumber: fields.poNumber, partNumber: fields.partNumber }, jobs).job;
      setDraft({
        id,
        customerName: fields.customer || matched?.customer || '',
        poNumber: fields.poNumber || matched?.poNumber || '',
        jobNumber: fields.jobNumber || matched?.jobIdsDisplay || '',
        partNumber: fields.partNumber || matched?.partNumber || '',
        qty: fields.quantity || matched?.quantity || undefined,
        dueDate: fields.dueDate ? normalizeDue(fields.dueDate) : '',   // OCR gives YYYY-MM-DD → store MM/DD/YYYY
        rawText,
        linkedJobId: matched?.id,
        linkedJobDisplay: matched ? (matched.jobIdsDisplay || matched.poNumber) : undefined,
        notes: '',
        invoiceStatus: 'not-invoiced',
        uploadedAt: Date.now(),
        uploadedBy: user?.name,
      });
      if (ocrFailed) addToast('info', "Couldn't auto-read that one — type the details in.");
    } catch (e: any) {
      addToast('error', e?.message || 'Could not read that photo');
    } finally {
      if (scanTimer.current) { clearTimeout(scanTimer.current); scanTimer.current = null; }
      scanningRef.current = false;
      setScanning(false);
    }
  };

  const openEdit = (po: CustomerPoFile) => {
    setEditing(true);
    setNewCustomer(false);
    setChipTarget('po');
    setDraft({ ...po });
    setDraftPreview(po.photoUrl);
  };

  const closeModal = () => { if (!saving) { setDraft(null); setDraftPreview(''); setEditing(false); setNewCustomer(false); setChipTarget('po'); } };

  // Candidate tokens pulled from the raw OCR text — short alphanumeric strings
  // containing a digit (PO/part-shaped). Tapping one drops it into PO# or Part#.
  const scanTokens = useMemo(() => {
    if (!draft?.rawText) return [] as string[];
    const toks = (draft.rawText.match(/[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,19}/g) || [])
      .map(t => t.toUpperCase())
      .filter(t => /\d/.test(t) && /^[A-Z0-9][A-Z0-9\-/.]*$/.test(t) && !/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t));
    return [...new Set(toks)].slice(0, 12);
  }, [draft?.rawText]);

  const saveDraft = async () => {
    if (savingRef.current) return;   // synchronous guard against double-tap
    if (!draft || !draftPreview) return;
    if (!draft.customerName?.trim()) { addToast('error', 'Pick a customer'); return; }
    savingRef.current = true;
    setSaving(true);
    try {
      // Re-match against the (possibly user-edited) PO#/part#.
      const matched = matchJobForPo({ poNumber: draft.poNumber, partNumber: draft.partNumber, linkedJobId: editing ? draft.linkedJobId : undefined }, jobs).job;

      let photoUrl = editing ? (draft.photoUrl || draftPreview) : draftPreview; // base64 / existing URL fallback
      // Upload for new POs; also re-upload when editing if the stored photo is
      // still a base64 data URL (an earlier upload had failed) so it gets upgraded.
      const storedIsDataUrl = typeof draft.photoUrl === 'string' && draft.photoUrl.startsWith('data:');
      const needsUpload = !editing || storedIsDataUrl || !draft.photoUrl;
      if (needsUpload && draftPreview.startsWith('data:')) {
        try {
          const small = await compressImage(dataUrlToFile(draftPreview), 1400, 0.6);
          photoUrl = await DB.uploadCustomerPoPhoto(dataUrlToBlob(small), draft.id!);
        } catch { /* keep base64 fallback */ }
      }

      const rec: CustomerPoFile = {
        id: draft.id!,
        customerName: draft.customerName!.trim(),
        photoUrl,
        poNumber: draft.poNumber?.trim() || undefined,
        jobNumber: draft.jobNumber?.trim() || undefined,
        partNumber: draft.partNumber?.trim() || undefined,
        qty: draft.qty || undefined,
        dueDate: draft.dueDate?.trim() || undefined,
        rawText: draft.rawText || undefined,
        linkedJobId: matched?.id || undefined,
        linkedJobDisplay: matched ? (matched.jobIdsDisplay || matched.poNumber) : undefined,
        notes: draft.notes?.trim() || undefined,
        invoiceStatus: draft.invoiceStatus || 'not-invoiced',
        invoicedAt: draft.invoicedAt,
        paidAt: draft.paidAt,
        invoiceNumber: draft.invoiceNumber?.trim() || undefined,
        invoiceAmount: typeof draft.invoiceAmount === 'number' ? draft.invoiceAmount : undefined,
        archived: !!draft.archived,   // persist false too, so un-archiving sticks (merge-write)
        uploadedAt: draft.uploadedAt || Date.now(),
        uploadedBy: draft.uploadedBy,
        updatedAt: Date.now(),
      };
      await DB.saveCustomerPo(rec);
      addToast('success', editing ? 'PO updated' : 'PO filed');
      closeModal();
    } catch (e: any) {
      addToast('error', `Save failed${e?.message ? ` — ${e.message}` : ''}`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  /** Quick invoice-status change from a card / the worklist. */
  const setInvoice = async (po: CustomerPoFile, status: PoInvoiceStatus) => {
    try {
      const now = Date.now();
      // Timestamp-once: stamp each milestone the first time it's reached and
      // never wipe it (cycling paid → invoiced must not erase the paid date).
      await DB.saveCustomerPo({
        ...po,
        invoiceStatus: status,
        invoicedAt: (status === 'invoiced' || status === 'paid') ? (po.invoicedAt || now) : po.invoicedAt,
        paidAt: status === 'paid' ? (po.paidAt || now) : po.paidAt,
        updatedAt: now,
      });
      addToast('success', status === 'invoiced' ? 'Marked invoiced' : status === 'paid' ? 'Marked paid' : 'Updated');
    } catch { addToast('error', 'Update failed'); }
  };

  /** Turn an unmatched PO into a real job on the board, then link them. */
  const createJobFromPo = (po: CustomerPoFile) => {
    const doCreate = async () => {
      setCreating(po.id);
      try {
        const id = Date.now().toString();
        const job: Job = {
          id,
          jobIdsDisplay: po.poNumber?.trim() || `J-${id.slice(-4)}`,
          poNumber: po.poNumber?.trim() || '',
          partNumber: po.partNumber?.trim() || '',
          customer: po.customerName?.trim() || '',
          quantity: Math.max(0, po.qty || 0),
          dateReceived: todayFmt(),
          dueDate: normalizeDue(po.dueDate),
          info: `Created from customer PO photo${po.notes ? ` — ${po.notes}` : ''}`,
          status: 'pending',
          createdAt: Date.now(),
        };
        await DB.saveJob(job);
        await DB.saveCustomerPo({
          ...po,
          linkedJobId: id,
          linkedJobDisplay: job.jobIdsDisplay,
          updatedAt: Date.now(),
        });
        addToast('success', `Job ${job.jobIdsDisplay} created & linked`);
      } catch (e: any) {
        addToast('error', `Couldn't create job${e?.message ? ` — ${e.message}` : ''}`);
      } finally {
        setCreating('');
      }
    };
    if (confirm) confirm({ title: 'Add this PO to the Job Board?', message: `Creates a new job for ${po.customerName}${po.poNumber ? ` · ${po.poNumber}` : ''} and links this PO to it.`, onConfirm: doCreate });
    else doCreate();
  };

  const handleDelete = (po: CustomerPoFile) => {
    const doDelete = async () => {
      try { await DB.deleteCustomerPo(po.id); addToast('success', 'Deleted'); }
      catch { addToast('error', 'Delete failed'); }
    };
    if (confirm) confirm({ title: 'Delete this PO?', message: `${po.poNumber || 'PO'} — ${po.customerName}`, onConfirm: doDelete });
    else doDelete();
  };

  // Apply filters → group by customer
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, CustomerPoFile[]>();
    pos
      .filter(p => {
        const d = derivedMap.get(p.id);
        if (!d) return false;
        if (!showArchived && p.archived) return false;
        if (fCustomer && p.customerName !== fCustomer) return false;
        if (fMatch && d.matchState !== fMatch) return false;
        if (fInvoice === 'ready' && !d.readyToInvoice) return false;
        if (fInvoice && fInvoice !== 'ready' && d.invoiceStatus !== fInvoice) return false;
        if (q && ![p.customerName, p.poNumber, p.jobNumber, p.partNumber, p.notes, p.invoiceNumber].filter(Boolean).join(' ').toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => b.uploadedAt - a.uploadedAt)
      .forEach(p => {
        const k = p.customerName || 'Unfiled';
        (map.get(k) || map.set(k, []).get(k)!).push(p);
      });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [pos, derivedMap, search, fCustomer, fMatch, fInvoice, showArchived]);

  const shownCount = useMemo(() => grouped.reduce((n, [, l]) => n + l.length, 0), [grouped]);
  const outstanding = useMemo(() => readyList.reduce((s, x) => s + (x.derived.amount || 0), 0), [readyList]);
  const activeFilterCount = (fCustomer ? 1 : 0) + (fMatch ? 1 : 0) + (fInvoice ? 1 : 0) + (showArchived ? 1 : 0);
  const clearFilters = () => { setFCustomer(''); setFMatch(''); setFInvoice(''); setShowArchived(false); };

  const exportVisible = () => {
    const rows: (string | number | undefined)[][] = [
      ['Customer', 'PO #', 'Job #', 'Part #', 'Qty', 'Due', 'Linked Job', 'Job Status', 'Invoice Status', 'Invoice #', 'Amount', 'Uploaded'],
    ];
    grouped.forEach(([, list]) => list.forEach(p => {
      const d = derivedMap.get(p.id);
      rows.push([
        p.customerName, p.poNumber, p.jobNumber, p.partNumber, p.qty, p.dueDate, d?.jobLabel,
        d?.matchState === 'completed' ? 'Completed' : d?.matchState === 'active' ? 'Active' : 'Not added',
        d?.readyToInvoice ? 'Ready to invoice' : (d?.invoiceStatus || 'not-invoiced'),
        p.invoiceNumber, d?.amount, new Date(p.uploadedAt).toLocaleDateString(),
      ]);
    }));
    if (rows.length <= 1) { addToast('info', 'Nothing to export'); return; }
    downloadCsv(`customer-pos-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  // ── small presentational helpers ──
  const MatchBadge = ({ d }: { d: PoDerived }) => {
    if (d.matchState === 'completed') return (
      <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full" title={d.jobLabel ? `Job ${d.jobLabel} is completed` : 'Job completed'}>
        <CheckCircle className="w-2.5 h-2.5" /> Done{d.jobLabel ? ` · ${d.jobLabel}` : ''}
      </span>
    );
    if (d.matchState === 'active') return (
      <span className="inline-flex items-center gap-1 text-[9px] font-bold text-blue-300 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded-full" title={d.jobLabel ? `Job ${d.jobLabel} is active` : 'Active job'}>
        <Link2 className="w-2.5 h-2.5" /> Active{d.jobLabel ? ` · ${d.jobLabel}` : ''}{d.exact ? '' : ' ?'}
      </span>
    );
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full" title="No matching job in the system yet">
        <AlertTriangle className="w-2.5 h-2.5" /> Not added
      </span>
    );
  };

  const InvoiceBadge = ({ d }: { d: PoDerived }) => {
    if (d.readyToInvoice) return (
      <span className="inline-flex items-center gap-1 text-[9px] font-bold text-orange-300 bg-orange-500/15 border border-orange-500/30 px-1.5 py-0.5 rounded-full animate-pulse" title="Job is done — time to invoice">
        <Send className="w-2.5 h-2.5" /> Invoice now
      </span>
    );
    if (d.invoiceStatus === 'invoiced') return (
      <span className="inline-flex items-center gap-1 text-[9px] font-bold text-sky-300 bg-sky-500/10 border border-sky-500/20 px-1.5 py-0.5 rounded-full"><DollarSign className="w-2.5 h-2.5" /> Invoiced</span>
    );
    if (d.invoiceStatus === 'paid') return (
      <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full"><CheckCircle className="w-2.5 h-2.5" /> Paid</span>
    );
    if (d.invoiceStatus === 'not-applicable') return (
      <span className="inline-flex items-center gap-1 text-[9px] font-bold text-zinc-400 bg-zinc-500/10 border border-zinc-500/20 px-1.5 py-0.5 rounded-full">No invoice</span>
    );
    return null;
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-3">
        <div>
          <h2 className="text-2xl font-black text-white flex items-center gap-2 tracking-tight"><FileText className="w-6 h-6 text-amber-500" /> Customer POs</h2>
          <p className="text-zinc-500 text-sm mt-0.5">Snap a photo of a customer's PO — filed by customer, read, matched to a job &amp; tracked through invoicing.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => cameraRef.current?.click()} className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 text-sm shadow-lg shadow-amber-900/20">
            <Camera className="w-4 h-4" /> Take Photo
          </button>
          <button onClick={() => fileRef.current?.click()} className="bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 text-sm">
            <Upload className="w-4 h-4 text-amber-400" /> Upload
          </button>
          <button onClick={exportVisible} title="Export the filtered list to CSV" className="bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-zinc-300 px-3 py-2 rounded-xl font-bold flex items-center gap-2 text-sm">
            <Download className="w-4 h-4" /> Export
          </button>
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handlePhoto(f); e.target.value = ''; }} />
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handlePhoto(f); e.target.value = ''; }} />
      </div>

      {/* Ready-to-invoice worklist — the "you forgot to bill these" banner */}
      {readyList.length > 0 && (
        <div className="bg-gradient-to-br from-orange-500/10 to-amber-500/[0.04] border border-orange-500/25 rounded-2xl p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="font-black text-orange-200 flex items-center gap-2 text-sm"><Send className="w-4 h-4" /> Ready to invoice — {readyList.length}</h3>
            <button onClick={() => { setFInvoice(fInvoice === 'ready' ? '' : 'ready'); setShowFilters(true); }} className="text-[11px] font-bold text-orange-300 hover:text-orange-200 underline underline-offset-2">
              {fInvoice === 'ready' ? 'Show all' : 'Filter to these'}
            </button>
          </div>
          <p className="text-[11px] text-orange-300/70 mb-3">These jobs are finished but not marked invoiced. Send the invoice, then mark it.</p>
          <div className="space-y-1.5">
            {readyList.slice(0, 5).map(({ po, derived }) => {
              const age = daysSince(derived.completedAt);
              return (
                <div key={po.id} className="flex items-center gap-2 bg-black/20 rounded-lg px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-white truncate">
                      {po.customerName} <span className="text-zinc-500 font-normal">· {po.poNumber || '(no PO#)'}</span>
                      {derived.amount ? <span className="text-emerald-400 font-bold"> · ${derived.amount >= 1000 ? (derived.amount / 1000).toFixed(1) + 'k' : derived.amount.toFixed(0)}</span> : ''}
                    </p>
                    <p className="text-[10px] text-zinc-500 truncate">
                      Job {derived.jobLabel} done{age !== null ? ` · ` : ''}
                      {age !== null && <span className={age >= 3 ? 'text-red-400 font-bold' : 'text-zinc-400'}>{agingLabel(derived.completedAt)}{age >= 3 ? ' waiting' : ''}</span>}
                    </p>
                  </div>
                  <button onClick={() => setInvoice(po, 'invoiced')} className="shrink-0 bg-orange-500/90 hover:bg-orange-400 text-white text-[11px] font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1">
                    <DollarSign className="w-3 h-3" /> Mark invoiced
                  </button>
                </div>
              );
            })}
            {readyList.length > 5 && (
              <button onClick={() => { setFInvoice('ready'); setShowFilters(true); }} className="text-[11px] font-bold text-orange-300 hover:text-orange-200 pt-1">
                +{readyList.length - 5} more →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Search + filter toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search PO#, part, customer, invoice#…" className="w-full bg-zinc-900/60 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none" />
        </div>
        <button onClick={() => setShowFilters(s => !s)} className={`px-3 py-2 rounded-xl font-bold text-sm flex items-center gap-2 border ${activeFilterCount > 0 ? 'bg-amber-500/15 border-amber-500/30 text-amber-300' : 'bg-zinc-900/60 border-white/10 text-zinc-300'}`}>
          <Filter className="w-4 h-4" /> Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <div className="bg-zinc-900/50 border border-white/10 rounded-xl p-3 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="cpo-filter-customer" className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Customer</label>
            <select id="cpo-filter-customer" value={fCustomer} onChange={e => setFCustomer(e.target.value)} className="bg-zinc-950 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white min-w-[140px]">
              <option value="">All customers</option>
              {clients.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="cpo-filter-job" className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Job status</label>
            <select id="cpo-filter-job" value={fMatch} onChange={e => setFMatch(e.target.value as MatchFilter)} className="bg-zinc-950 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white">
              <option value="">Any</option>
              <option value="active">Active job</option>
              <option value="completed">Completed job</option>
              <option value="unmatched">Not added</option>
            </select>
          </div>
          <div>
            <label htmlFor="cpo-filter-invoice" className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Invoice</label>
            <select id="cpo-filter-invoice" value={fInvoice} onChange={e => setFInvoice(e.target.value as InvoiceFilter)} className="bg-zinc-950 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white">
              <option value="">Any</option>
              <option value="ready">Ready to invoice</option>
              <option value="not-invoiced">Not invoiced</option>
              <option value="invoiced">Invoiced</option>
              <option value="paid">Paid</option>
            </select>
          </div>
          <label className="flex items-center gap-1.5 text-sm text-zinc-300 pb-1.5 cursor-pointer">
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} className="accent-amber-500" /> Show archived
          </label>
          {activeFilterCount > 0 && (
            <button onClick={clearFilters} className="text-[11px] font-bold text-zinc-400 hover:text-white pb-1.5 ml-auto">Clear all</button>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 text-[11px] text-zinc-500 flex-wrap">
        <span>{shownCount} shown · {pos.length} total</span>
        {readyList.length > 0 && <span className="text-orange-400 font-bold">· {readyList.length} to invoice</span>}
        {outstanding > 0 && <span className="text-emerald-400 font-bold">· ${outstanding >= 1000 ? (outstanding / 1000).toFixed(1) + 'k' : outstanding.toFixed(0)} unbilled</span>}
      </div>

      {/* Scanning overlay (full-screen while OCR runs) */}
      {scanning && (
        <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-10 h-10 text-amber-400 animate-spin" />
          <p className="text-white font-bold">Reading the PO… {scanPct > 0 ? `${scanPct}%` : ''}</p>
          <p className="text-zinc-400 text-xs">Extracting PO#, part #, customer &amp; date</p>
        </div>
      )}

      {/* Empty state */}
      {grouped.length === 0 && !scanning && (
        <div className="p-12 text-center text-zinc-500 bg-zinc-900/50 rounded-2xl border border-white/5">
          <div className="inline-block p-4 rounded-full bg-zinc-800 mb-3"><FileText className="w-8 h-8 text-zinc-600" /></div>
          <p className="font-medium">{pos.length === 0 ? 'No customer POs filed yet.' : 'No POs match your filters.'}</p>
          {pos.length === 0
            ? <p className="text-sm mt-1 text-zinc-600">Tap <span className="text-amber-400 font-bold">Take Photo</span> to file your first one.</p>
            : (activeFilterCount > 0 || search) && <button onClick={() => { clearFilters(); setSearch(''); }} className="text-sm mt-1 text-amber-400 font-bold">Clear filters</button>}
        </div>
      )}

      {/* Grouped list */}
      <div className="space-y-3">
        {grouped.map(([customer, list]) => {
          const isCollapsed = collapsed.has(customer);
          const readyHere = list.filter(p => derivedMap.get(p.id)?.readyToInvoice).length;
          return (
            <div key={customer} className="bg-zinc-900/40 border border-white/5 rounded-2xl overflow-hidden">
              <button onClick={() => setCollapsed(prev => { const n = new Set(prev); n.has(customer) ? n.delete(customer) : n.add(customer); return n; })}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/[0.02]">
                <div className="flex items-center gap-2.5 min-w-0">
                  {isCollapsed ? <ChevronRight className="w-4 h-4 text-zinc-500 shrink-0" /> : <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" />}
                  <Building2 className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="font-black text-white truncate">{customer}</span>
                  <span className="text-[10px] font-mono text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded-full shrink-0">{list.length}</span>
                  {readyHere > 0 && <span className="text-[9px] font-bold text-orange-300 bg-orange-500/15 border border-orange-500/25 px-1.5 py-0.5 rounded-full shrink-0">{readyHere} to invoice</span>}
                </div>
              </button>
              {!isCollapsed && (
                <div className="px-3 pb-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {list.map(po => {
                    const d = derivedMap.get(po.id)!;
                    return (
                      <div key={po.id} className={`bg-zinc-950/60 border rounded-xl overflow-hidden group ${d.readyToInvoice ? 'border-orange-500/40' : 'border-white/10'} ${po.archived ? 'opacity-60' : ''}`}>
                        <div className="relative aspect-[4/3] bg-zinc-900 cursor-pointer" onClick={() => setLightbox(po.photoUrl)}>
                          <img src={po.photoUrl} alt={po.poNumber || 'PO'} className="w-full h-full object-cover" loading="lazy" />
                          <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={e => { e.stopPropagation(); openEdit(po); }} className="bg-black/60 hover:bg-amber-500/80 text-white p-1 rounded-lg" title="Edit / invoice"><Edit3 className="w-3.5 h-3.5" /></button>
                            <button onClick={e => { e.stopPropagation(); handleDelete(po); }} className="bg-black/60 hover:bg-red-500/80 text-white p-1 rounded-lg" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                        <div className="p-2.5 space-y-1.5">
                          <p className="text-sm font-black text-white truncate">{po.poNumber || '(no PO #)'}</p>
                          {po.jobNumber && <p className="text-[10px] text-zinc-500 truncate">Job {po.jobNumber}</p>}
                          {po.partNumber && <p className="text-[11px] text-zinc-400 truncate">{po.partNumber}{po.qty ? ` · ${po.qty}pc` : ''}</p>}
                          <div className="flex flex-wrap gap-1">
                            <MatchBadge d={d} />
                            <InvoiceBadge d={d} />
                          </div>
                          {/* Quick invoice action */}
                          {d.readyToInvoice && (
                            <button onClick={() => setInvoice(po, 'invoiced')} className="w-full mt-1 bg-orange-500/90 hover:bg-orange-400 text-white text-[10px] font-bold px-2 py-1 rounded-lg flex items-center justify-center gap-1">
                              <DollarSign className="w-3 h-3" /> Mark invoiced
                            </button>
                          )}
                          {d.invoiceStatus === 'invoiced' && (
                            <button onClick={() => setInvoice(po, 'paid')} className="w-full mt-1 bg-emerald-600/80 hover:bg-emerald-500 text-white text-[10px] font-bold px-2 py-1 rounded-lg flex items-center justify-center gap-1">
                              <CheckCircle className="w-3 h-3" /> Mark paid
                            </button>
                          )}
                          {d.matchState === 'unmatched' ? (
                            <button onClick={() => createJobFromPo(po)} disabled={creating === po.id} className="w-full mt-1 bg-blue-600/80 hover:bg-blue-500 disabled:opacity-50 text-white text-[10px] font-bold px-2 py-1 rounded-lg flex items-center justify-center gap-1" title="Create a job on the board from this PO">
                              {creating === po.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add to jobs
                            </button>
                          ) : (
                            // Escape hatch: matched to the wrong job? force a new one anyway.
                            <button onClick={() => createJobFromPo(po)} disabled={creating === po.id} className="w-full mt-1 text-[9px] font-bold text-blue-300/80 hover:text-blue-200 flex items-center justify-center gap-1" title="Not the right job? Create a new job from this PO">
                              {creating === po.id ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Plus className="w-2.5 h-2.5" />} Wrong job? Add new
                            </button>
                          )}
                          <p className="text-[9px] text-zinc-600 flex items-center gap-1"><Clock className="w-2.5 h-2.5" />{new Date(po.uploadedAt).toLocaleDateString()}{po.invoiceNumber ? ` · inv ${po.invoiceNumber}` : ''}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-[130] bg-black/90 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="PO" className="max-w-full max-h-full object-contain rounded-lg" />
          <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 text-white bg-white/10 hover:bg-white/20 p-2 rounded-full"><X className="w-5 h-5" /></button>
        </div>
      )}

      {/* Upload / confirm / edit modal */}
      {draft && (
        <Overlay open onClose={closeModal} ariaLabel="Confirm PO" zIndex={110} backdrop="bg-zinc-950">
          <div className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-2xl shadow-2xl flex flex-col my-4" style={{ maxHeight: 'calc(100dvh - 2rem)' }}>
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-zinc-800/50 sticky top-0 z-10">
              <h3 className="font-bold text-white flex items-center gap-2"><FileText className="w-4 h-4 text-amber-400" /> {editing ? 'Edit PO' : 'File this PO'}</h3>
              <button onClick={closeModal} className="p-2 rounded-lg hover:bg-white/5"><X className="w-5 h-5 text-zinc-500 hover:text-white" /></button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {draftPreview && <img src={draftPreview} alt="PO preview" className="w-full max-h-52 object-contain rounded-xl border border-white/10 bg-zinc-950" />}

              {/* Smart fix: tap a scanned value to drop it into PO# or Part# */}
              {scanTokens.length > 0 && (
                <div className="bg-zinc-950/60 border border-white/10 rounded-xl p-2.5">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Scan wrong? Tap the right value</p>
                    <div className="flex gap-1 bg-zinc-900 rounded-lg p-0.5">
                      {(['po', 'job', 'part'] as const).map(t => (
                        <button key={t} onClick={() => setChipTarget(t)} className={`text-[10px] font-bold px-2 py-0.5 rounded ${chipTarget === t ? 'bg-amber-500 text-white' : 'text-zinc-400'}`}>→ {t === 'po' ? 'PO #' : t === 'job' ? 'Job #' : 'Part #'}</button>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {scanTokens.map(t => (
                      <button key={t} onClick={() => setDraft({ ...draft, [chipTarget === 'po' ? 'poNumber' : chipTarget === 'job' ? 'jobNumber' : 'partNumber']: t })}
                        className="bg-zinc-800 hover:bg-amber-600 hover:text-white text-[11px] font-mono text-zinc-200 px-2 py-1 rounded-lg border border-white/10 transition-colors">
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Live match indicator */}
              {draftMatch ? (
                <div className={`rounded-xl px-3 py-2 flex items-center gap-2 text-sm font-bold border ${draftMatch.complete ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300' : 'bg-blue-500/10 border-blue-500/25 text-blue-300'}`}>
                  {draftMatch.complete ? <CheckCircle className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
                  Matched job {draftMatch.job.jobIdsDisplay || draftMatch.job.poNumber}
                  <span className="font-normal opacity-80">· {draftMatch.complete ? 'completed' : 'active'}{draftMatch.exact ? '' : ' (loose match)'}</span>
                </div>
              ) : (
                <div className="rounded-xl px-3 py-2 flex items-center gap-2 text-sm font-bold border bg-amber-500/10 border-amber-500/25 text-amber-300">
                  <AlertTriangle className="w-4 h-4" /> No matching job yet <span className="font-normal opacity-80">· filed for reference</span>
                </div>
              )}

              <div>
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Customer *</label>
                {newCustomer ? (
                  <div className="flex gap-2">
                    <input autoFocus value={draft.customerName || ''} onChange={e => setDraft({ ...draft, customerName: e.target.value })} placeholder="New customer name" className="flex-1 bg-zinc-950 border border-white/10 rounded-lg p-2.5 text-sm text-white" />
                    <button type="button" onClick={() => { setNewCustomer(false); setDraft({ ...draft, customerName: '' }); }} className="px-3 rounded-lg bg-zinc-800 border border-white/10 text-xs font-bold text-zinc-300 hover:text-white">List</button>
                  </div>
                ) : (
                  <select
                    value={draft.customerName && clients.includes(draft.customerName) ? draft.customerName : (draft.customerName ? '__scanned__' : '')}
                    onChange={e => {
                      const v = e.target.value;
                      if (v === '__new__') { setNewCustomer(true); setDraft({ ...draft, customerName: '' }); }
                      else if (v === '__scanned__') { /* keep scanned value */ }
                      else setDraft({ ...draft, customerName: v });
                    }}
                    className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 text-sm text-white"
                  >
                    <option value="">Select customer…</option>
                    {draft.customerName && !clients.includes(draft.customerName) && <option value="__scanned__">{draft.customerName} (scanned)</option>}
                    {clients.map(c => <option key={c} value={c}>{c}</option>)}
                    <option value="__new__">➕ Add new customer…</option>
                  </select>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-amber-500/80 uppercase tracking-widest block mb-1">PO Number <span className="text-zinc-600">(matches jobs)</span></label>
                  <input value={draft.poNumber || ''} onChange={e => setDraft({ ...draft, poNumber: e.target.value })} className="w-full bg-zinc-950 border border-amber-500/30 rounded-lg p-2.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Job Number</label>
                  <input value={draft.jobNumber || ''} onChange={e => setDraft({ ...draft, jobNumber: e.target.value })} placeholder="reference" className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Part Number</label>
                  <input value={draft.partNumber || ''} onChange={e => setDraft({ ...draft, partNumber: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Quantity</label>
                  <input type="number" value={draft.qty || ''} onChange={e => setDraft({ ...draft, qty: Number(e.target.value) || undefined })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Due Date</label>
                  <input type="date" value={toDateInput(draft.dueDate)} onChange={e => setDraft({ ...draft, dueDate: fromDateInput(e.target.value) })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 text-sm text-white [color-scheme:dark]" />
                </div>
              </div>

              {/* Invoicing */}
              <div className="border-t border-white/10 pt-4">
                <label className="text-[10px] font-black text-amber-500/80 uppercase tracking-widest block mb-2 flex items-center gap-1"><DollarSign className="w-3 h-3" /> Invoicing</label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Status</label>
                    <select value={draft.invoiceStatus || 'not-invoiced'} onChange={e => setDraft({ ...draft, invoiceStatus: e.target.value as PoInvoiceStatus })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 text-sm text-white">
                      {INVOICE_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Invoice #</label>
                    <input value={draft.invoiceNumber || ''} onChange={e => setDraft({ ...draft, invoiceNumber: e.target.value })} placeholder="optional" className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 text-sm text-white" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Amount $</label>
                    <input type="number" value={draft.invoiceAmount ?? ''} onChange={e => setDraft({ ...draft, invoiceAmount: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="optional" className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 text-sm text-white" />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-zinc-300 self-end pb-2 cursor-pointer">
                    <input type="checkbox" checked={!!draft.archived} onChange={e => setDraft({ ...draft, archived: e.target.checked })} className="accent-amber-500" /> <Archive className="w-3.5 h-3.5" /> Archive
                  </label>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Notes</label>
                <textarea value={draft.notes || ''} onChange={e => setDraft({ ...draft, notes: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 text-sm text-white min-h-[60px] resize-y" />
              </div>
              {!editing && <p className="text-[10px] text-zinc-600">We read these off the photo automatically — double-check they're right before saving.</p>}
            </div>
            <div className="p-4 border-t border-white/10 bg-zinc-800/50 flex justify-end gap-2 sticky bottom-0">
              <button onClick={closeModal} className="px-4 py-2 text-zinc-400 hover:text-white font-bold text-sm">Cancel</button>
              <button onClick={saveDraft} disabled={saving || !draft.customerName?.trim()} className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 disabled:opacity-50 text-white px-6 py-2 rounded-xl font-bold text-sm flex items-center gap-2">
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> {editing ? 'Saving…' : 'Filing…'}</> : (editing ? 'Save' : 'File PO')}
              </button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
};

// A base64 data URL re-wrapped as a File so compressImage can re-process it.
function dataUrlToFile(dataUrl: string): File {
  const blob = dataUrlToBlob(dataUrl);
  return new File([blob], 'po.jpg', { type: blob.type });
}

export default CustomerPosView;
