import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronRight,
  Edit2,
  Image,
  Plus,
  Search,
  Trash2,
  X,
  Save,
  Upload,
  Play,
  Square,
  Pause,
  Clock,
  History,
  ArrowRight,
} from 'lucide-react';

import { Sample, SampleWorkEntry } from './types';
import * as DB from './services/mockDb';

// ── Compress image ──────────────────────────────────────────────
function compressImage(file: File, maxWidth = 1200): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas context failed')); return; }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = event.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// ── Helpers ─────────────────────────────────────────────────────
const DifficultyBadge = ({ d }: { d: string }) => {
  const styles: Record<string, string> = {
    easy: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    medium: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    hard: 'bg-red-500/10 text-red-400 border-red-500/20',
  };
  return (
    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${styles[d] || styles.medium}`}>
      {d}
    </span>
  );
};

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDurationShort(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(ts: number): string {
  return `${fmtDate(ts)} ${fmtTime(ts)}`;
}

// ── Live Timer ──────────────────────────────────────────────────
const LiveTimer: React.FC<{ startTime: number; pausedAt?: number | null; totalPausedMs?: number }> = ({ startTime, pausedAt, totalPausedMs }) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (pausedAt) return;
    const i = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(i);
  }, [pausedAt]);

  const end = pausedAt || Date.now();
  const wall = end - startTime;
  const paused = totalPausedMs || 0;
  const working = Math.max(0, wall - paused);
  return <span className="font-mono font-black">{formatMs(working)}</span>;
};

// ── Full screen photo viewer ────────────────────────────────────
const PhotoViewer = ({ url, onClose }: { url: string; onClose: () => void }) => (
  <div className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-4" onClick={onClose}>
    <button onClick={onClose} className="absolute top-4 right-4 text-white/60 hover:text-white z-10">
      <X className="w-8 h-8" />
    </button>
    <img src={url} alt="Sample" className="max-w-full max-h-full object-contain rounded-xl" />
  </div>
);

// ── Edit Work Entry Modal ───────────────────────────────────────
const EditEntryModal: React.FC<{
  entry: SampleWorkEntry;
  operations: string[];
  onSave: (updates: Partial<SampleWorkEntry>) => void;
  onClose: () => void;
}> = ({ entry, operations, onSave, onClose }) => {
  const toLocalInput = (ts: number) => {
    const d = new Date(ts);
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().slice(0, 16);
  };
  const [startStr, setStartStr] = useState(toLocalInput(entry.startTime));
  const [endStr, setEndStr] = useState(entry.endTime ? toLocalInput(entry.endTime) : '');
  const [op, setOp] = useState(entry.operation);
  const [notes, setNotes] = useState(entry.notes || '');

  const handleSave = () => {
    const startTime = new Date(startStr).getTime();
    const endTime = endStr ? new Date(endStr).getTime() : entry.endTime;
    onSave({
      startTime,
      endTime,
      operation: op,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-zinc-900 border border-white/10 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-5 border-b border-white/10 flex justify-between items-center bg-zinc-800/50">
          <h3 className="font-bold text-white text-lg">Edit Work Entry</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-zinc-500 hover:text-white" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-bold text-zinc-400 uppercase mb-1 block">Operation</label>
            <select className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white outline-none"
              value={op} onChange={e => setOp(e.target.value)}>
              {operations.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-zinc-400 uppercase mb-1 block">Start Time</label>
              <input type="datetime-local" className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white text-sm outline-none"
                value={startStr} onChange={e => setStartStr(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-bold text-zinc-400 uppercase mb-1 block">End Time</label>
              <input type="datetime-local" className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white text-sm outline-none"
                value={endStr} onChange={e => setEndStr(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-zinc-400 uppercase mb-1 block">Notes</label>
            <textarea className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white min-h-[60px] outline-none resize-y"
              value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes..." />
          </div>
        </div>
        <div className="p-5 border-t border-white/10 bg-zinc-800/50 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-3 text-zinc-400 hover:text-white font-medium">Cancel</button>
          <button onClick={handleSave}
            className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2">
            <Save className="w-4 h-4" /> Save
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Work History Modal ──────────────────────────────────────────
const WorkHistoryModal: React.FC<{
  sample: Sample;
  operations: string[];
  onEditEntry: (entryId: string, updates: Partial<SampleWorkEntry>) => void;
  onDeleteEntry: (entryId: string) => void;
  onClose: () => void;
}> = ({ sample, operations, onEditEntry, onDeleteEntry, onClose }) => {
  const entries = [...(sample.workEntries || [])].sort((a, b) => b.startTime - a.startTime);
  const [editingEntry, setEditingEntry] = useState<SampleWorkEntry | null>(null);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-5 border-b border-white/10 flex justify-between items-center bg-zinc-800/50">
          <div>
            <h3 className="font-bold text-white text-lg">Work History</h3>
            <p className="text-zinc-500 text-xs">{sample.partNumber} — {sample.companyName}</p>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-zinc-500 hover:text-white" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {entries.length === 0 ? (
            <p className="text-zinc-500 text-sm text-center py-8">No work sessions yet</p>
          ) : (
            <>
              {/* Summary strip */}
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 grid grid-cols-3 gap-3 text-center mb-2">
                <div>
                  <p className="text-blue-400 text-[10px] font-bold uppercase">Total Time</p>
                  <p className="text-white font-black text-lg">{formatMs(sample.totalWorkedMs || 0)}</p>
                </div>
                <div>
                  <p className="text-blue-400 text-[10px] font-bold uppercase">Sessions</p>
                  <p className="text-white font-black text-lg">{entries.length}</p>
                </div>
                <div>
                  <p className="text-blue-400 text-[10px] font-bold uppercase">Total Qty</p>
                  <p className="text-white font-black text-lg">{entries.reduce((sum, e) => sum + (e.qty || 0), 0) || '—'}</p>
                </div>
              </div>

              {/* Entries */}
              {entries.map(e => (
                <div key={e.id} className="bg-zinc-950/50 border border-white/5 rounded-xl p-4 space-y-2">
                  {/* Row 1: Name + Operation + Qty */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-bold text-sm">{e.userName}</span>
                      {e.qty && e.qty > 0 && (
                        <span className="text-[10px] font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded">
                          {e.qty} pcs
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded font-bold">{e.operation}</span>
                  </div>

                  {/* Row 2: Start → End with timestamps */}
                  <div className="bg-zinc-900/50 rounded-lg p-2.5 space-y-1">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-green-400 font-bold w-12">Start</span>
                      <span className="text-zinc-300">{fmtDateTime(e.startTime)}</span>
                    </div>
                    {e.endTime && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-red-400 font-bold w-12">End</span>
                        <span className="text-zinc-300">{fmtDateTime(e.endTime)}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-xs pt-1 border-t border-white/5">
                      <span className="text-zinc-500 font-bold w-12">Duration</span>
                      <span className="font-mono font-bold text-white">{e.durationSeconds ? formatDurationShort(e.durationSeconds) : '—'}</span>
                      {(e.totalPausedMs || 0) > 0 && (
                        <span className="text-yellow-500/60 text-[10px]">(paused {formatMs(e.totalPausedMs || 0)})</span>
                      )}
                    </div>
                  </div>

                  {/* Notes */}
                  {e.notes && (
                    <p className="text-zinc-500 text-xs italic">{e.notes}</p>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setEditingEntry(e)}
                      className="flex-1 text-xs text-blue-400 bg-blue-500/10 border border-blue-500/20 px-3 py-1.5 rounded-lg hover:bg-blue-500/20 font-bold flex items-center justify-center gap-1">
                      <Edit2 className="w-3 h-3" /> Edit
                    </button>
                    <button onClick={() => { if (confirm('Delete this work entry?')) onDeleteEntry(e.id); }}
                      className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-1.5 rounded-lg hover:bg-red-500/20 font-bold flex items-center justify-center gap-1">
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Edit entry sub-modal */}
      {editingEntry && (
        <EditEntryModal
          entry={editingEntry}
          operations={operations}
          onSave={(updates) => {
            onEditEntry(editingEntry.id, updates);
            setEditingEntry(null);
          }}
          onClose={() => setEditingEntry(null)}
        />
      )}
    </div>
  );
};

// ── Start Work Modal ────────────────────────────────────────────
const StartWorkModal: React.FC<{
  sample: Sample;
  operations: string[];
  userName: string;
  onStart: (operation: string, qty?: number) => void;
  onClose: () => void;
}> = ({ sample, operations, userName, onStart, onClose }) => {
  const [op, setOp] = useState(operations[0] || 'Deburring');
  const [qty, setQty] = useState<number>(0);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-5 border-b border-white/10 bg-zinc-800/50">
          <h3 className="font-bold text-white text-lg">Start Working</h3>
          <p className="text-zinc-500 text-xs mt-1">{sample.partNumber} — {sample.companyName}</p>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-bold text-zinc-400 uppercase mb-1 block">Operation</label>
            <select className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white focus:ring-2 focus:ring-green-500 outline-none"
              value={op} onChange={e => setOp(e.target.value)}>
              {operations.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-zinc-400 uppercase mb-1 block">How Many Samples?</label>
            <input type="number" className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white focus:ring-2 focus:ring-green-500 outline-none"
              value={qty || ''} onChange={e => setQty(Number(e.target.value) || 0)} placeholder="Optional — number of pieces" />
          </div>
          <p className="text-zinc-500 text-xs">Working as <span className="text-white font-bold">{userName}</span></p>
        </div>
        <div className="p-5 border-t border-white/10 bg-zinc-800/50 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-3 text-zinc-400 hover:text-white font-medium">Cancel</button>
          <button onClick={() => onStart(op, qty > 0 ? qty : undefined)}
            className="bg-green-600 hover:bg-green-500 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2">
            <Play className="w-4 h-4" /> Start Timer
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Add/Edit Sample Modal ───────────────────────────────────────
const SampleModal = ({
  sample,
  existingCompanies,
  clients,
  onSave,
  onClose,
}: {
  sample: Partial<Sample> | null;
  existingCompanies: string[];
  clients: string[];
  onSave: (s: Sample) => void;
  onClose: () => void;
}) => {
  const [form, setForm] = useState<Partial<Sample>>(sample || {});
  const [photoPreview, setPhotoPreview] = useState<string>(sample?.photoUrl || '');
  const [saving, setSaving] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const handlePhoto = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setPhotoUploading(true);
    try {
      // Compress for instant preview
      const dataUrl = await compressImage(file);
      setPhotoPreview(dataUrl);

      // Generate a stable ID for the storage path
      const tempId = form.id || `sample_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      try {
        // Upload original file to Firebase Storage, get permanent URL
        const storageUrl = await DB.uploadSamplePhoto(file, tempId);
        setForm(f => ({ ...f, photoUrl: storageUrl }));
      } catch (uploadErr) {
        console.warn('Storage upload failed, falling back to base64:', uploadErr);
        // Fallback: store compressed base64 in Firestore (old behaviour)
        setForm(f => ({ ...f, photoUrl: dataUrl }));
      }
    } catch {
      // ignore
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleSave = async () => {
    if (!form.companyName?.trim() || !form.partNumber?.trim()) return;
    setSaving(true);
    const now = Date.now();
    const s: Sample = {
      id: form.id || `sample_${now}_${Math.random().toString(36).slice(2, 9)}`,
      companyName: form.companyName.trim(),
      partNumber: form.partNumber.trim(),
      partName: form.partName?.trim() || '',
      photoUrl: form.photoUrl || '',
      difficulty: (form.difficulty as any) || 'medium',
      notes: form.notes?.trim() || '',
      ...(form.qty ? { qty: form.qty } : {}),
      createdAt: form.createdAt || now,
      updatedAt: now,
      createdBy: form.createdBy || 'admin',
      // Preserve existing work data when editing
      workEntries: (sample as Sample)?.workEntries,
      activeEntry: (sample as Sample)?.activeEntry,
      totalWorkedMs: (sample as Sample)?.totalWorkedMs,
    };
    onSave(s);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-5 border-b border-white/10 flex justify-between items-center bg-zinc-800/50">
          <h3 className="font-bold text-white text-lg">{form.id ? 'Edit Sample' : 'Add Sample'}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-zinc-500 hover:text-white" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Photo */}
          <div>
            <label className="text-xs font-bold text-zinc-400 uppercase mb-2 block">Photo</label>
            {photoPreview ? (
              <div className="relative">
                <img src={photoPreview} alt="Preview" className="w-full h-40 object-cover rounded-xl border border-white/10" />
                {photoUploading && (
                  <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center rounded-xl gap-2">
                    <svg className="animate-spin w-8 h-8 text-blue-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
                    </svg>
                    <span className="text-xs text-blue-300 font-bold">Uploading to Storage…</span>
                  </div>
                )}
                {!photoUploading && (
                  <button onClick={() => { setPhotoPreview(''); setForm(f => ({ ...f, photoUrl: '' })); }}
                    className="absolute top-2 right-2 bg-black/60 text-white p-1 rounded-lg"><X className="w-4 h-4" /></button>
                )}
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => cameraRef.current?.click()}
                  className="flex-1 bg-zinc-800 hover:bg-zinc-700 border border-white/10 rounded-xl py-4 flex flex-col items-center gap-2 text-zinc-400 hover:text-white transition-colors">
                  <Camera className="w-5 h-5" /><span className="text-xs font-bold">Take Photo</span>
                </button>
                <button onClick={() => fileRef.current?.click()}
                  className="flex-1 bg-zinc-800 hover:bg-zinc-700 border border-white/10 rounded-xl py-4 flex flex-col items-center gap-2 text-zinc-400 hover:text-white transition-colors">
                  <Upload className="w-5 h-5" /><span className="text-xs font-bold">Upload</span>
                </button>
              </div>
            )}
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => e.target.files?.[0] && handlePhoto(e.target.files[0])} />
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && handlePhoto(e.target.files[0])} />
          </div>
          {/* Company Name */}
          <div>
            <label className="text-xs font-bold text-zinc-400 uppercase mb-1 block">Company / Client *</label>
            {clients.length > 0 ? (
              <select
                className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                value={form.companyName || ''}
                onChange={e => setForm({ ...form, companyName: e.target.value })}
              >
                <option value="">— Select a client —</option>
                {clients.sort((a, b) => a.localeCompare(b)).map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            ) : (
              <>
                <input
                  className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  value={form.companyName || ''}
                  onChange={e => setForm({ ...form, companyName: e.target.value })}
                  placeholder="e.g. Boeing"
                  list="companies-list"
                />
                <datalist id="companies-list">
                  {existingCompanies.map(c => <option key={c} value={c} />)}
                </datalist>
                <p className="text-xs text-zinc-500 mt-1">💡 Add clients in <span className="text-purple-400 font-bold">Settings → Clients</span> to get a dropdown here.</p>
              </>
            )}
          </div>
          {/* Part Number + Part Name */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-zinc-400 uppercase mb-1 block">Part Number *</label>
              <input className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                value={form.partNumber || ''} onChange={e => setForm({ ...form, partNumber: e.target.value })} placeholder="e.g. ABC-123" />
            </div>
            <div>
              <label className="text-xs font-bold text-zinc-400 uppercase mb-1 block">Part Name</label>
              <input className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                value={form.partName || ''} onChange={e => setForm({ ...form, partName: e.target.value })} placeholder="e.g. Bracket Assembly" />
            </div>
          </div>
          {/* Difficulty + Quantity */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-zinc-400 uppercase mb-1 block">Difficulty</label>
              <select className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                value={form.difficulty || 'medium'} onChange={e => setForm({ ...form, difficulty: e.target.value as any })}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-zinc-400 uppercase mb-1 block">Quantity</label>
              <input type="number" className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                value={form.qty || ''} onChange={e => setForm({ ...form, qty: Number(e.target.value) || undefined })} placeholder="How many" />
            </div>
          </div>
          {/* Notes */}
          <div>
            <label className="text-xs font-bold text-zinc-400 uppercase mb-1 block">Notes / Special Instructions</label>
            <textarea className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white min-h-[80px] focus:ring-2 focus:ring-blue-500 outline-none resize-y"
              value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Material, finish requirements, edge break specs..." />
          </div>
        </div>
        <div className="p-5 border-t border-white/10 bg-zinc-800/50 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-3 text-zinc-400 hover:text-white font-medium">Cancel</button>
          <button onClick={handleSave} disabled={saving || photoUploading || !form.companyName?.trim() || !form.partNumber?.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2">
            <Save className="w-4 h-4" /> {saving ? 'Saving...' : photoUploading ? 'Uploading Photo…' : 'Save Sample'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── MAIN SAMPLES VIEW ───────────────────────────────────────────
interface SamplesViewProps {
  addToast: (type: 'success' | 'error' | 'info', message: string) => void;
  currentUser?: { id: string; name: string } | null;
}

export const SamplesView: React.FC<SamplesViewProps> = ({ addToast, currentUser }) => {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [search, setSearch] = useState('');
  const [ops, setOps] = useState<string[]>([]);
  const [clients, setClients] = useState<string[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingSample, setEditingSample] = useState<Partial<Sample> | null>(null);
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [startWorkSample, setStartWorkSample] = useState<Sample | null>(null);
  const [histSample, setHistSample] = useState<Sample | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);

  useEffect(() => {
    const unsub1 = DB.subscribeSamples(setSamples);
    const unsub2 = DB.subscribeSettings((s) => {
      setOps(s.customOperations || []);
      setClients(s.clients || []);
    });
    return () => { unsub1(); unsub2(); };
  }, []);

  // Keep histSample in sync with live data
  useEffect(() => {
    if (histSample) {
      const updated = samples.find(s => s.id === histSample.id);
      if (updated) setHistSample(updated);
    }
  }, [samples]);

  const handleSave = async (sample: Sample) => {
    try {
      await DB.saveSample(sample);
      addToast('success', 'Sample saved');
      setShowModal(false);
      setEditingSample(null);
    } catch {
      addToast('error', 'Failed to save sample');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this sample?')) return;
    try { await DB.deleteSample(id); addToast('success', 'Sample deleted'); }
    catch { addToast('error', 'Failed to delete'); }
  };

  const handleStartWork = async (sampleId: string, operation: string, qty?: number) => {
    try {
      const userId = currentUser?.id || 'admin';
      const userName = currentUser?.name || 'Admin';
      await DB.startSampleWork(sampleId, userId, userName, operation, qty);
      addToast('success', 'Timer started');
      setStartWorkSample(null);
    } catch {
      addToast('error', 'Failed to start work');
    }
  };

  const handleStopWork = async (sampleId: string) => {
    setStopping(sampleId);
    try {
      await DB.stopSampleWork(sampleId);
      addToast('success', 'Work session saved');
    } catch {
      addToast('error', 'Failed to stop');
    } finally {
      setStopping(null);
    }
  };

  const handlePause = async (sampleId: string) => {
    try { await DB.pauseSampleWork(sampleId); }
    catch { addToast('error', 'Failed to pause'); }
  };

  const handleResume = async (sampleId: string) => {
    try { await DB.resumeSampleWork(sampleId); }
    catch { addToast('error', 'Failed to resume'); }
  };

  const handleEditEntry = async (entryId: string, updates: Partial<SampleWorkEntry>) => {
    if (!histSample) return;
    try {
      await DB.editSampleWorkEntry(histSample.id, entryId, updates);
      addToast('success', 'Entry updated');
    } catch {
      addToast('error', 'Failed to update entry');
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!histSample) return;
    try {
      await DB.deleteSampleWorkEntry(histSample.id, entryId);
      addToast('success', 'Entry deleted');
    } catch {
      addToast('error', 'Failed to delete entry');
    }
  };

  const toggleGroup = (company: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(company)) next.delete(company); else next.add(company);
      return next;
    });
  };

  const term = search.toLowerCase().trim();
  const filtered = term
    ? samples.filter(s =>
        s.companyName.toLowerCase().includes(term) ||
        s.partNumber.toLowerCase().includes(term) ||
        s.partName.toLowerCase().includes(term) ||
        s.notes.toLowerCase().includes(term))
    : samples;

  const groups: Record<string, Sample[]> = {};
  filtered.forEach(s => {
    const key = s.companyName || 'Unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  });
  const sortedGroups = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  const existingCompanies: string[] = samples.map(s => s.companyName).filter((c): c is string => !!c).filter((v, i, a) => a.indexOf(v) === i).sort();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Image className="w-6 h-6 text-blue-500" /> Part Samples Library
          </h2>
          <p className="text-zinc-500 text-sm">Reference photos for parts — start working on any sample to track time</p>
        </div>
        <button onClick={() => { setEditingSample({}); setShowModal(true); }}
          className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-blue-900/20 flex items-center gap-2 transition-all">
          <Plus className="w-4 h-4" /> Add Sample
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-3.5 w-5 h-5 text-zinc-500" />
        <input type="text" placeholder="Search by company, part number, part name, notes..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="w-full bg-zinc-900 border border-white/10 rounded-2xl pl-12 pr-4 py-3 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-sm" />
      </div>

      {/* Grouped samples */}
      {sortedGroups.length === 0 ? (
        <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-12 text-center">
          <Image className="w-12 h-12 mx-auto text-zinc-700 mb-4" />
          <h3 className="text-white font-bold text-lg mb-2">No samples yet</h3>
          <p className="text-zinc-500 text-sm">Add your first part sample to start building your reference library.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedGroups.map(([company, companySamples]) => {
            const isCollapsed = collapsed.has(company);
            return (
              <div key={company} className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden">
                <button onClick={() => toggleGroup(company)}
                  className="w-full p-5 flex items-center justify-between bg-zinc-900/80 hover:bg-zinc-800/80 transition-colors text-left">
                  <div className="flex items-center gap-3">
                    {isCollapsed ? <ChevronRight className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
                    <h3 className="text-white font-black text-lg">{company}</h3>
                    <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">{companySamples.length} sample{companySamples.length !== 1 ? 's' : ''}</span>
                  </div>
                </button>
                {!isCollapsed && (
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {companySamples.sort((a, b) => a.partNumber.localeCompare(b.partNumber)).map(s => {
                      const isActive = !!s.activeEntry;
                      const isPaused = !!s.activeEntry?.pausedAt;
                      const isStopping = stopping === s.id;

                      return (
                        <div key={s.id} className={`bg-zinc-950/50 border rounded-xl overflow-hidden transition-all ${
                          isActive ? (isPaused ? 'border-yellow-500/30 shadow-lg shadow-yellow-500/5' : 'border-green-500/30 shadow-lg shadow-green-500/5') : 'border-white/5 hover:border-white/10'
                        }`}>
                          {/* Photo */}
                          {s.photoUrl ? (
                            <div className="cursor-pointer relative" onClick={() => setViewPhoto(s.photoUrl)}>
                              <img src={s.photoUrl} alt={s.partNumber} className="w-full h-36 object-cover" />
                              {isActive && (
                                <div className={`absolute top-2 left-2 px-2 py-1 rounded-lg text-[10px] font-black uppercase ${
                                  isPaused ? 'bg-yellow-500/90 text-black' : 'bg-green-500/90 text-black'
                                }`}>{isPaused ? 'PAUSED' : 'WORKING'}</div>
                              )}
                            </div>
                          ) : (
                            <div className="w-full h-36 bg-zinc-800 flex items-center justify-center relative">
                              <Camera className="w-8 h-8 text-zinc-700" />
                              {isActive && (
                                <div className={`absolute top-2 left-2 px-2 py-1 rounded-lg text-[10px] font-black uppercase ${
                                  isPaused ? 'bg-yellow-500/90 text-black' : 'bg-green-500/90 text-black'
                                }`}>{isPaused ? 'PAUSED' : 'WORKING'}</div>
                              )}
                            </div>
                          )}

                          <div className="p-4 space-y-2">
                            <div className="flex items-start justify-between">
                              <div>
                                <p className="text-white font-black text-lg leading-tight">{s.partNumber}</p>
                                {s.partName && <p className="text-zinc-400 text-xs mt-0.5">{s.partName}</p>}
                                {s.qty && <p className="text-purple-400 text-xs font-bold mt-0.5">{s.qty} pcs</p>}
                              </div>
                              <DifficultyBadge d={s.difficulty} />
                            </div>

                            {/* Stats badges */}
                            <div className="flex items-center gap-2 flex-wrap">
                              {(s.totalWorkedMs || 0) > 0 && (
                                <span className="text-[10px] font-bold text-zinc-400 bg-zinc-800 border border-white/10 px-2 py-0.5 rounded flex items-center gap-1 cursor-pointer hover:bg-zinc-700"
                                  onClick={() => setHistSample(s)}>
                                  <Clock className="w-3 h-3" /> {formatMs(s.totalWorkedMs || 0)} total
                                </span>
                              )}
                              {(s.workEntries?.length || 0) > 0 && (
                                <span className="text-[10px] font-bold text-zinc-500 bg-zinc-800 border border-white/10 px-2 py-0.5 rounded cursor-pointer hover:bg-zinc-700"
                                  onClick={() => setHistSample(s)}>
                                  {s.workEntries!.length} session{s.workEntries!.length !== 1 ? 's' : ''}
                                </span>
                              )}
                            </div>

                            {/* Active work display */}
                            {isActive && s.activeEntry && (
                              <div className={`rounded-lg p-3 space-y-2 ${isPaused ? 'bg-yellow-500/10 border border-yellow-500/20' : 'bg-green-500/10 border border-green-500/20'}`}>
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-zinc-300">{s.activeEntry.userName}</span>
                                    {s.activeEntry.qty && s.activeEntry.qty > 0 && (
                                      <span className="text-[10px] text-purple-400 font-bold">{s.activeEntry.qty} pcs</span>
                                    )}
                                  </div>
                                  <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded">{s.activeEntry.operation}</span>
                                </div>
                                <div className={`text-center text-xl ${isPaused ? 'text-yellow-400' : 'text-green-400'}`}>
                                  <LiveTimer startTime={s.activeEntry.startTime} pausedAt={s.activeEntry.pausedAt} totalPausedMs={s.activeEntry.totalPausedMs} />
                                </div>
                                <div className="text-center text-[10px] text-zinc-500">
                                  Started {fmtTime(s.activeEntry.startTime)}
                                </div>
                                <div className="flex gap-2">
                                  {isPaused ? (
                                    <button onClick={() => handleResume(s.id)}
                                      className="flex-1 text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-3 py-1.5 rounded-lg hover:bg-green-500/20 font-bold flex items-center justify-center gap-1">
                                      <Play className="w-3 h-3" /> Resume
                                    </button>
                                  ) : (
                                    <button onClick={() => handlePause(s.id)}
                                      className="flex-1 text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-3 py-1.5 rounded-lg hover:bg-yellow-500/20 font-bold flex items-center justify-center gap-1">
                                      <Pause className="w-3 h-3" /> Pause
                                    </button>
                                  )}
                                  <button onClick={() => handleStopWork(s.id)} disabled={isStopping}
                                    className="flex-1 text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-1.5 rounded-lg hover:bg-red-500/20 font-bold flex items-center justify-center gap-1 disabled:opacity-50">
                                    <Square className="w-3 h-3" /> {isStopping ? 'Stopping...' : 'Stop'}
                                  </button>
                                </div>
                              </div>
                            )}

                            {s.notes && <p className="text-zinc-500 text-xs line-clamp-2">{s.notes}</p>}

                            <div className="flex gap-2 pt-1">
                              {!isActive && (
                                <button onClick={() => setStartWorkSample(s)}
                                  className="flex-1 text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-3 py-1.5 rounded-lg hover:bg-green-500/20 font-bold flex items-center justify-center gap-1 transition-colors">
                                  <Play className="w-3 h-3" /> Work on this
                                </button>
                              )}
                              {(s.workEntries?.length || 0) > 0 && (
                                <button onClick={() => setHistSample(s)}
                                  className="text-xs text-zinc-400 bg-zinc-800 border border-white/10 px-3 py-1.5 rounded-lg hover:bg-zinc-700 font-bold flex items-center justify-center gap-1 transition-colors">
                                  <History className="w-3 h-3" />
                                </button>
                              )}
                              <button onClick={() => { setEditingSample(s); setShowModal(true); }}
                                className="text-xs text-blue-400 bg-blue-500/10 border border-blue-500/20 px-3 py-1.5 rounded-lg hover:bg-blue-500/20 font-bold flex items-center justify-center gap-1 transition-colors">
                                <Edit2 className="w-3 h-3" />
                              </button>
                              {!isActive && (
                                <button onClick={() => handleDelete(s.id)}
                                  className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-1.5 rounded-lg hover:bg-red-500/20 font-bold flex items-center justify-center gap-1 transition-colors">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
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
      )}

      {/* Modals */}
      {showModal && (
        <SampleModal
          sample={editingSample}
          existingCompanies={existingCompanies}
          clients={clients}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditingSample(null); }}
        />
      )}
      {startWorkSample && (
        <StartWorkModal
          sample={startWorkSample}
          operations={ops}
          userName={currentUser?.name || 'Admin'}
          onStart={(op, qty) => handleStartWork(startWorkSample.id, op, qty)}
          onClose={() => setStartWorkSample(null)}
        />
      )}
      {histSample && (
        <WorkHistoryModal
          sample={histSample}
          operations={ops}
          onEditEntry={handleEditEntry}
          onDeleteEntry={handleDeleteEntry}
          onClose={() => setHistSample(null)}
        />
      )}
      {viewPhoto && <PhotoViewer url={viewPhoto} onClose={() => setViewPhoto(null)} />}
    </div>
  );
};

export default SamplesView;
