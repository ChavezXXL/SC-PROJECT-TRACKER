// CustomerPosView — a phone-first library of customer PO photos, filed by
// customer. Snap a picture of the PO, it OCR-reads the PO#/part#/customer,
// tries to match an existing job, and stores it for reference.
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  FileText, Camera, Upload, X, Search, Trash2, Link2, ChevronDown, ChevronRight,
  Loader2, CheckCircle, Building2,
} from 'lucide-react';

import { CustomerPoFile, Job, SystemSettings } from '../types';
import * as DB from '../services/mockDb';
import { Overlay } from '../components/Overlay';
import { scanDocument } from '../services/poScanner';

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

const norm = (s?: string) => (s || '').trim().toLowerCase().replace(/\s+/g, '');

export const CustomerPosView = ({ addToast, confirm, user }: any) => {
  const [pos, setPos] = useState<CustomerPoFile[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [settings, setSettings] = useState<SystemSettings>(DB.getSettings());
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<string | null>(null);

  // Draft (the upload/edit modal)
  const [draft, setDraft] = useState<Partial<CustomerPoFile> | null>(null);
  const [draftPreview, setDraftPreview] = useState('');      // base64 preview
  const [scanning, setScanning] = useState(false);
  const [scanPct, setScanPct] = useState(0);
  const [saving, setSaving] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const u1 = DB.subscribeCustomerPos(setPos);
    const u2 = DB.subscribeJobs(setJobs);
    const u3 = DB.subscribeSettings(setSettings);
    return () => { u1(); u2(); u3(); };
  }, []);

  const clients = useMemo(() => {
    const set = new Set<string>((settings.clients || []).map(c => c.trim()).filter(Boolean));
    jobs.forEach(j => { if (j.customer?.trim()) set.add(j.customer.trim()); });
    pos.forEach(p => { if (p.customerName?.trim()) set.add(p.customerName.trim()); });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [settings.clients, jobs, pos]);

  /** Find an existing job matching the OCR'd PO# / part#. */
  const matchJob = (poNumber?: string, partNumber?: string): Job | undefined => {
    const pn = norm(poNumber), part = norm(partNumber);
    if (pn) { const m = jobs.find(j => norm(j.poNumber) === pn); if (m) return m; }
    if (part) { const m = jobs.find(j => norm(j.partNumber) === part); if (m) return m; }
    return undefined;
  };

  const handlePhoto = async (file: File) => {
    if (!file.type.startsWith('image/')) { addToast('error', 'Pick an image / photo'); return; }
    const id = `cpo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setScanning(true);
    setScanPct(0);
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
      } catch { /* OCR failed — user fills manually */ }
      const matched = matchJob(fields.poNumber, fields.partNumber);
      setDraft({
        id,
        customerName: fields.customer || matched?.customer || '',
        poNumber: fields.poNumber || matched?.poNumber || '',
        partNumber: fields.partNumber || matched?.partNumber || '',
        qty: fields.quantity || matched?.quantity || undefined,
        dueDate: fields.dueDate || '',
        rawText,
        linkedJobId: matched?.id,
        linkedJobDisplay: matched ? (matched.jobIdsDisplay || matched.poNumber) : undefined,
        notes: '',
        uploadedAt: Date.now(),
        uploadedBy: user?.name,
      });
    } catch (e: any) {
      addToast('error', e?.message || 'Could not read that photo');
    } finally {
      setScanning(false);
    }
  };

  const saveDraft = async () => {
    if (!draft || !draftPreview) return;
    if (!draft.customerName?.trim()) { addToast('error', 'Pick a customer'); return; }
    setSaving(true);
    try {
      // Re-match in case the user edited the PO#/part# fields.
      const matched = matchJob(draft.poNumber, draft.partNumber);
      let photoUrl = draftPreview; // base64 fallback
      try {
        const small = await compressImage(dataUrlToFile(draftPreview), 1400, 0.6);
        photoUrl = await DB.uploadCustomerPoPhoto(dataUrlToBlob(small), draft.id!);
      } catch { /* keep base64 fallback */ }
      const rec: CustomerPoFile = {
        id: draft.id!,
        customerName: draft.customerName!.trim(),
        photoUrl,
        poNumber: draft.poNumber?.trim() || undefined,
        partNumber: draft.partNumber?.trim() || undefined,
        qty: draft.qty || undefined,
        dueDate: draft.dueDate?.trim() || undefined,
        rawText: draft.rawText || undefined,
        linkedJobId: draft.linkedJobId || matched?.id || undefined,
        linkedJobDisplay: draft.linkedJobDisplay || (matched ? (matched.jobIdsDisplay || matched.poNumber) : undefined),
        notes: draft.notes?.trim() || undefined,
        uploadedAt: draft.uploadedAt || Date.now(),
        uploadedBy: draft.uploadedBy,
      };
      await DB.saveCustomerPo(rec);
      addToast('success', 'PO filed');
      setDraft(null);
      setDraftPreview('');
    } catch (e: any) {
      addToast('error', `Save failed${e?.message ? ` — ${e.message}` : ''}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (po: CustomerPoFile) => {
    const doDelete = async () => {
      try { await DB.deleteCustomerPo(po.id); addToast('success', 'Deleted'); }
      catch { addToast('error', 'Delete failed'); }
    };
    if (confirm) confirm({ title: 'Delete this PO?', message: `${po.poNumber || 'PO'} — ${po.customerName}`, onConfirm: doDelete });
    else doDelete();
  };

  // Group by customer, filtered by search
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, CustomerPoFile[]>();
    pos
      .filter(p => !q || [p.customerName, p.poNumber, p.partNumber, p.notes].filter(Boolean).join(' ').toLowerCase().includes(q))
      .sort((a, b) => b.uploadedAt - a.uploadedAt)
      .forEach(p => {
        const k = p.customerName || 'Unfiled';
        (map.get(k) || map.set(k, []).get(k)!).push(p);
      });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [pos, search]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-3">
        <div>
          <h2 className="text-2xl font-black text-white flex items-center gap-2 tracking-tight"><FileText className="w-6 h-6 text-amber-500" /> Customer POs</h2>
          <p className="text-zinc-500 text-sm mt-0.5">Snap a photo of a customer's PO — filed by customer, read &amp; matched to a job.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => cameraRef.current?.click()} className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 text-sm shadow-lg shadow-amber-900/20">
            <Camera className="w-4 h-4" /> Take Photo
          </button>
          <button onClick={() => fileRef.current?.click()} className="bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 text-sm">
            <Upload className="w-4 h-4 text-amber-400" /> Upload
          </button>
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handlePhoto(f); e.target.value = ''; }} />
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handlePhoto(f); e.target.value = ''; }} />
      </div>

      {/* Search + stat */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search PO#, part, customer…" className="w-full bg-zinc-900/60 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none" />
        </div>
        <span className="text-[11px] text-zinc-500">{pos.length} PO{pos.length !== 1 ? 's' : ''} · {grouped.length} customer{grouped.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Scanning overlay (full-screen while OCR runs) */}
      {scanning && (
        <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-10 h-10 text-amber-400 animate-spin" />
          <p className="text-white font-bold">Reading the PO… {scanPct > 0 ? `${scanPct}%` : ''}</p>
          <p className="text-zinc-400 text-xs">Extracting PO#, part #, and customer</p>
        </div>
      )}

      {/* Empty state */}
      {grouped.length === 0 && !scanning && (
        <div className="p-12 text-center text-zinc-500 bg-zinc-900/50 rounded-2xl border border-white/5">
          <div className="inline-block p-4 rounded-full bg-zinc-800 mb-3"><FileText className="w-8 h-8 text-zinc-600" /></div>
          <p className="font-medium">{pos.length === 0 ? 'No customer POs filed yet.' : 'No POs match your search.'}</p>
          {pos.length === 0 && <p className="text-sm mt-1 text-zinc-600">Tap <span className="text-amber-400 font-bold">Take Photo</span> to file your first one.</p>}
        </div>
      )}

      {/* Grouped list */}
      <div className="space-y-3">
        {grouped.map(([customer, list]) => {
          const isCollapsed = collapsed.has(customer);
          return (
            <div key={customer} className="bg-zinc-900/40 border border-white/5 rounded-2xl overflow-hidden">
              <button onClick={() => setCollapsed(prev => { const n = new Set(prev); n.has(customer) ? n.delete(customer) : n.add(customer); return n; })}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/[0.02]">
                <div className="flex items-center gap-2.5 min-w-0">
                  {isCollapsed ? <ChevronRight className="w-4 h-4 text-zinc-500 shrink-0" /> : <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" />}
                  <Building2 className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="font-black text-white truncate">{customer}</span>
                  <span className="text-[10px] font-mono text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded-full shrink-0">{list.length}</span>
                </div>
              </button>
              {!isCollapsed && (
                <div className="px-3 pb-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {list.map(po => (
                    <div key={po.id} className="bg-zinc-950/60 border border-white/10 rounded-xl overflow-hidden group">
                      <div className="relative aspect-[4/3] bg-zinc-900 cursor-pointer" onClick={() => setLightbox(po.photoUrl)}>
                        <img src={po.photoUrl} alt={po.poNumber || 'PO'} className="w-full h-full object-cover" loading="lazy" />
                        <button onClick={e => { e.stopPropagation(); handleDelete(po); }} className="absolute top-1.5 right-1.5 bg-black/60 hover:bg-red-500/80 text-white p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="p-2.5 space-y-1">
                        <p className="text-sm font-black text-white truncate">{po.poNumber || '(no PO #)'}</p>
                        {po.partNumber && <p className="text-[11px] text-zinc-400 truncate">{po.partNumber}{po.qty ? ` · ${po.qty}pc` : ''}</p>}
                        {po.linkedJobId && (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">
                            <Link2 className="w-2.5 h-2.5" /> Matched {po.linkedJobDisplay}
                          </span>
                        )}
                        <p className="text-[9px] text-zinc-600">{new Date(po.uploadedAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                  ))}
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

      {/* Upload / confirm modal */}
      {draft && (
        <Overlay open onClose={() => { if (!saving) { setDraft(null); setDraftPreview(''); } }} ariaLabel="Confirm PO" zIndex={110} backdrop="bg-zinc-950">
          <div className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-2xl shadow-2xl flex flex-col my-4" style={{ maxHeight: 'calc(100dvh - 2rem)' }}>
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-zinc-800/50 sticky top-0 z-10">
              <h3 className="font-bold text-white flex items-center gap-2"><FileText className="w-4 h-4 text-amber-400" /> File this PO</h3>
              <button onClick={() => { if (!saving) { setDraft(null); setDraftPreview(''); } }} className="p-2 rounded-lg hover:bg-white/5"><X className="w-5 h-5 text-zinc-500 hover:text-white" /></button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {draftPreview && <img src={draftPreview} alt="PO preview" className="w-full max-h-52 object-contain rounded-xl border border-white/10 bg-zinc-950" />}
              {draft.linkedJobId && (
                <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-3 py-2 flex items-center gap-2 text-emerald-300 text-sm font-bold">
                  <CheckCircle className="w-4 h-4" /> Matched to job {draft.linkedJobDisplay}
                </div>
              )}
              <div>
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Customer *</label>
                <input list="cpo-clients" value={draft.customerName || ''} onChange={e => setDraft({ ...draft, customerName: e.target.value })} placeholder="e.g. Boeing" className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 text-sm text-white" />
                <datalist id="cpo-clients">{clients.map(c => <option key={c} value={c} />)}</datalist>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">PO Number</label>
                  <input value={draft.poNumber || ''} onChange={e => setDraft({ ...draft, poNumber: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 text-sm text-white" />
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
                  <input value={draft.dueDate || ''} onChange={e => setDraft({ ...draft, dueDate: e.target.value })} placeholder="MM/DD/YYYY" className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 text-sm text-white" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Notes</label>
                <textarea value={draft.notes || ''} onChange={e => setDraft({ ...draft, notes: e.target.value })} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2.5 text-sm text-white min-h-[60px] resize-y" />
              </div>
              <p className="text-[10px] text-zinc-600">We read these off the photo automatically — double-check they're right before saving.</p>
            </div>
            <div className="p-4 border-t border-white/10 bg-zinc-800/50 flex justify-end gap-2 sticky bottom-0">
              <button onClick={() => { if (!saving) { setDraft(null); setDraftPreview(''); } }} className="px-4 py-2 text-zinc-400 hover:text-white font-bold text-sm">Cancel</button>
              <button onClick={saveDraft} disabled={saving || !draft.customerName?.trim()} className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 disabled:opacity-50 text-white px-6 py-2 rounded-xl font-bold text-sm flex items-center gap-2">
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Filing…</> : 'File PO'}
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
