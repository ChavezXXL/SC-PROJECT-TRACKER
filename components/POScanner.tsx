/**
 * POScanner — drag-drop or camera scan of a PO document.
 * Uses Tesseract.js (100% free, browser-native OCR — zero API cost).
 * Renders into document.body via createPortal so it's never trapped
 * inside an overflow:hidden or CSS-transform parent.
 */

import React, { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Upload, Camera, Scan, CheckCircle, AlertCircle,
  Loader2, FileText, RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react';
import { scanDocument } from '../services/poScanner';
import type { Job } from '../types';

interface Props {
  onFill: (fields: Partial<Job>) => void;
  onClose: () => void;
}

type Phase = 'idle' | 'scanning' | 'done' | 'error';

const FIELD_LABELS: Record<string, string> = {
  poNumber:            'PO Number',
  partNumber:          'Part Number',
  quantity:            'Quantity',
  customer:            'Customer',
  dueDate:             'Due Date',
  dateReceived:        'Date Received',
  pricePerPart:        'Price / Part',
  specialInstructions: 'Special Instructions',
};

export const POScanner: React.FC<Props> = ({ onFill, onClose }) => {
  const [phase,      setPhase]      = useState<Phase>('idle');
  const [progress,   setProgress]   = useState(0);
  const [status,     setStatus]     = useState('');
  const [preview,    setPreview]    = useState<string | null>(null);
  const [fields,     setFields]     = useState<Partial<Job>>({});
  const [confidence, setConfidence] = useState(0);
  const [error,      setError]      = useState('');
  const [dragging,   setDragging]   = useState(false);
  const [editFields, setEditFields] = useState<Partial<Job>>({});
  const [rawText,    setRawText]    = useState('');
  const [showRaw,    setShowRaw]    = useState(false);
  const fileRef   = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const runScan = useCallback(async (file: File) => {
    const isPdf    = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isImage  = file.type.startsWith('image/');
    if (!isPdf && !isImage) {
      setError('Please upload a JPG, PNG, PDF, or WEBP file.');
      setPhase('error');
      return;
    }
    setPhase('scanning');
    setProgress(0);
    setStatus('');
    setError('');
    setShowRaw(false);

    // Preview: images only — PDFs show a placeholder
    setPreview(isImage ? URL.createObjectURL(file) : null);

    try {
      const result = await scanDocument(file, (pct, stat) => {
        setProgress(pct);
        setStatus(stat);
      });
      setFields(result.fields);
      setEditFields(result.fields);
      setConfidence(result.confidence);
      setRawText(result.rawText);
      setPhase('done');
    } catch (e: any) {
      const msg = e?.message || e?.toString() || 'Unknown error';
      console.error('[POScanner] scanDocument error:', e);
      setError(msg);
      setPhase('error');
    }
  }, []);

  const handleFile = (f: File | null) => { if (f) runScan(f); };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const handleImport = () => {
    onFill(editFields);
    onClose();
  };

  const reset = () => {
    setPhase('idle');
    setProgress(0);
    setPreview(null);
    setFields({});
    setEditFields({});
    setRawText('');
    setShowRaw(false);
    setError('');
  };

  const filledCount = Object.keys(fields).length;

  const modal = (
    <div
      className="fixed inset-0 z-[300] overflow-y-auto bg-zinc-950/95 animate-fade-in"
      onClick={onClose}
    >
      <div className="min-h-full flex items-start sm:items-center justify-center p-0 sm:p-4">
        <div
          className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-none sm:rounded-2xl shadow-2xl flex flex-col my-0 sm:my-4"
          style={{ maxHeight: 'calc(100dvh - 2rem)' }}
          onClick={e => e.stopPropagation()}
        >

          {/* ── Header ── */}
          <div className="px-5 pt-5 pb-4 border-b border-white/10 flex items-start justify-between shrink-0 bg-zinc-800/50">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Scan className="w-5 h-5 text-blue-400" />
                Scan PO Document
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Free · runs in browser · no API cost
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* ── Scrollable body ── */}
          <div className="overflow-y-auto flex-1">

            {/* IDLE — upload zone */}
            {phase === 'idle' && (
              <div className="p-5 space-y-4">
                {/* Drop zone */}
                <div
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileRef.current?.click()}
                  className={`relative border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all
                    ${dragging
                      ? 'border-blue-400 bg-blue-500/10'
                      : 'border-white/15 hover:border-blue-500/50 hover:bg-white/5'
                    }`}
                >
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all
                    ${dragging ? 'bg-blue-500/20 text-blue-400' : 'bg-zinc-800 text-zinc-500'}`}>
                    <Upload className="w-7 h-7" />
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-white text-sm">Drop PO document here or click to browse</p>
                    <p className="text-xs text-zinc-500 mt-1">PDF · JPG · PNG · WEBP</p>
                    <p className="text-[10px] text-zinc-600 mt-1">PDFs extract text instantly — no OCR wait</p>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={e => handleFile(e.target.files?.[0] || null)}
                  />
                </div>

                {/* Camera */}
                <button
                  onClick={() => cameraRef.current?.click()}
                  className="w-full py-3 rounded-xl bg-zinc-800 border border-white/10 hover:bg-zinc-700 text-white font-bold flex items-center justify-center gap-2 text-sm transition-all"
                >
                  <Camera className="w-4 h-4 text-blue-400" /> Take Photo with Camera
                </button>
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={e => handleFile(e.target.files?.[0] || null)}
                />

                <p className="text-[11px] text-zinc-600 text-center">
                  Tip: Good lighting + flat document = best results. Works on most PO formats.
                </p>
              </div>
            )}

            {/* SCANNING */}
            {phase === 'scanning' && (
              <div className="p-8 flex flex-col items-center gap-6">
                {preview ? (
                  <div className="w-full max-h-40 overflow-hidden rounded-xl border border-white/10 bg-zinc-800">
                    <img src={preview} alt="Scanning" className="w-full h-full object-contain" />
                  </div>
                ) : (
                  <div className="w-full h-28 rounded-xl border border-white/10 bg-zinc-800 flex flex-col items-center justify-center gap-2">
                    <FileText className="w-10 h-10 text-blue-400" />
                    <p className="text-xs text-zinc-400 font-bold">Reading PDF…</p>
                  </div>
                )}
                <div className="w-full space-y-2">
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-zinc-400 capitalize">{status || 'Initialising…'}</span>
                    <span className="text-blue-400">{progress}%</span>
                  </div>
                  <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 text-zinc-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                  Reading document…
                </div>
              </div>
            )}

            {/* ERROR */}
            {phase === 'error' && (
              <div className="p-6 space-y-4">
                <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/25 rounded-xl p-4">
                  <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-red-300 text-sm">Scan failed</p>
                    <p className="text-xs text-red-400/80 mt-1 font-mono break-all">{error}</p>
                  </div>
                </div>
                <button
                  onClick={reset}
                  className="w-full py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-sm flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" /> Try Again
                </button>
              </div>
            )}

            {/* DONE — extracted fields */}
            {phase === 'done' && (
              <div className="p-5 space-y-4">

                {/* Confidence banner */}
                <div className={`flex items-center gap-3 rounded-xl px-4 py-3 ${
                  confidence >= 60
                    ? 'bg-emerald-500/10 border border-emerald-500/25'
                    : confidence > 0
                      ? 'bg-amber-500/10 border border-amber-500/25'
                      : 'bg-zinc-800 border border-white/10'
                }`}>
                  {confidence >= 60
                    ? <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
                    : <AlertCircle className={`w-5 h-5 shrink-0 ${confidence > 0 ? 'text-amber-400' : 'text-zinc-500'}`} />
                  }
                  <div className="min-w-0">
                    <p className={`font-bold text-sm ${
                      confidence >= 60 ? 'text-emerald-300'
                      : confidence > 0 ? 'text-amber-300'
                      : 'text-zinc-400'
                    }`}>
                      {filledCount} field{filledCount !== 1 ? 's' : ''} extracted · {confidence}% confidence
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {confidence >= 60
                        ? 'Review then click Import to fill the job form.'
                        : confidence > 0
                          ? 'Low confidence — check values before importing.'
                          : 'Nothing detected — see raw text below to debug.'}
                    </p>
                  </div>
                </div>

                {/* Preview image (images only) */}
                {preview && (
                  <div
                    className="w-full max-h-32 overflow-hidden rounded-xl border border-white/10 bg-zinc-800 cursor-pointer"
                    onClick={reset}
                    title="Click to scan a different document"
                  >
                    <img src={preview} alt="Scanned" className="w-full h-full object-contain" />
                  </div>
                )}

                {/* Editable fields */}
                <div className="space-y-2">
                  {Object.entries(FIELD_LABELS).map(([key, label]) => {
                    const k   = key as keyof Job;
                    const val = editFields[k];
                    const has = val !== undefined && val !== null && val !== '';
                    return (
                      <div
                        key={key}
                        className={`rounded-xl border px-3 py-2.5 transition-all ${
                          has
                            ? 'border-blue-500/30 bg-blue-500/5'
                            : 'border-white/5 bg-zinc-800/40 opacity-50'
                        }`}
                      >
                        <label className={`text-[10px] font-black uppercase tracking-wider block mb-1 ${
                          has ? 'text-blue-400' : 'text-zinc-600'
                        }`}>
                          {label}
                        </label>
                        {key === 'specialInstructions' ? (
                          <textarea
                            rows={2}
                            value={String(val ?? '')}
                            onChange={e => setEditFields(f => ({ ...f, [key]: e.target.value }))}
                            placeholder="Not detected"
                            className="w-full bg-transparent text-white text-sm outline-none resize-none placeholder:text-zinc-600"
                          />
                        ) : (
                          <input
                            type={key === 'quantity' || key === 'pricePerPart' ? 'number' : 'text'}
                            step={key === 'pricePerPart' ? '0.01' : undefined}
                            value={
                              key === 'quantity' || key === 'pricePerPart'
                                ? (val !== undefined ? String(val) : '')
                                : String(val ?? '')
                            }
                            onChange={e => {
                              const raw = e.target.value;
                              if (key === 'quantity')
                                setEditFields(f => ({ ...f, [key]: raw ? parseInt(raw) : undefined }));
                              else if (key === 'pricePerPart')
                                setEditFields(f => ({ ...f, [key]: raw ? parseFloat(raw) : undefined }));
                              else
                                setEditFields(f => ({ ...f, [key]: raw || undefined }));
                            }}
                            placeholder="Not detected"
                            className="w-full bg-transparent text-white text-sm font-bold outline-none placeholder:text-zinc-600 placeholder:font-normal"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Raw text — collapsible debug panel */}
                {rawText && (
                  <div className="rounded-xl border border-white/8 overflow-hidden">
                    <button
                      onClick={() => setShowRaw(v => !v)}
                      className="w-full px-4 py-3 flex items-center justify-between text-left bg-zinc-800/60 hover:bg-zinc-800 transition-colors"
                    >
                      <span className="text-xs font-bold text-zinc-400">
                        Raw extracted text
                        <span className="ml-2 font-normal text-zinc-600">
                          ({rawText.length} chars) — use this to tune patterns
                        </span>
                      </span>
                      {showRaw
                        ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" />
                        : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
                      }
                    </button>
                    {showRaw && (
                      <pre className="px-4 py-3 text-[10px] leading-relaxed text-zinc-400 font-mono whitespace-pre-wrap bg-zinc-950/60 max-h-48 overflow-y-auto">
                        {rawText}
                      </pre>
                    )}
                  </div>
                )}

                {filledCount === 0 && (
                  <div className="flex items-start gap-2 bg-zinc-800/60 rounded-xl p-3 text-xs text-zinc-400">
                    <FileText className="w-4 h-4 shrink-0 mt-0.5 text-zinc-500" />
                    <span>
                      No fields detected. Expand "Raw extracted text" above to see what was read.
                      Try a higher-resolution image or ensure the document is flat and well-lit.
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Footer ── */}
          {phase === 'done' && (
            <div className="px-5 py-4 border-t border-white/10 flex gap-3 shrink-0 bg-zinc-800/30">
              <button
                onClick={reset}
                className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-sm flex items-center gap-2 transition-colors"
              >
                <RefreshCw className="w-4 h-4" /> Scan Again
              </button>
              <button
                onClick={handleImport}
                disabled={filledCount === 0}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <CheckCircle className="w-4 h-4" />
                Import {filledCount} Field{filledCount !== 1 ? 's' : ''}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};
