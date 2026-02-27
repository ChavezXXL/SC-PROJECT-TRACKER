import React, { useState, useRef, useCallback } from 'react';
import {
  Camera, Upload, CheckCircle, AlertCircle, Loader2,
  X, Calendar, Hash, Package, User, FileText, RefreshCw,
  ChevronRight, ScanLine
} from 'lucide-react';

interface ExtractedPOData {
  poNumber: string;
  jobNumber: string;
  partNumber: string;
  partName: string;
  quantity: string;
  dueDate: string;
  customerName: string;
  confidence: 'high' | 'medium' | 'low';
  notes: string;
}

interface POScannerProps {
  onJobCreate: (jobData: {
    poNumber: string;
    partNumber: string;
    customer: string;
    quantity: number;
    dueDate: string;
    info: string;
  }) => Promise<void>;
  geminiApiKey: string;
  onClose: () => void;
}

const useGeminiGuard = () => {
  const inFlightRef = useRef(false);
  const lastCallRef = useRef(0);
  const run = useCallback(async <T,>(
    fn: () => Promise<T>,
    opts?: { cooldownMs?: number; maxRetries?: number }
  ): Promise<T> => {
    const cooldownMs = opts?.cooldownMs ?? 6000;
    const maxRetries = opts?.maxRetries ?? 2;
    if (inFlightRef.current) throw new Error('Gemini request already running please wait.');
    const now = Date.now();
    const wait = cooldownMs - (now - lastCallRef.current);
    if (wait > 0) await new Promise(res => setTimeout(res, wait));
    inFlightRef.current = true;
    lastCallRef.current = Date.now();
    try {
      let attempt = 0;
      while (true) {
        try {
          return await fn();
        } catch (err: any) {
          attempt++;
          const msg = String(err?.message || err);
          const is429 = msg.includes('429') || msg.toLowerCase().includes('rate') || msg.toLowerCase().includes('quota');
          if (!is429 || attempt > maxRetries) throw err;
          const backoff = 1000 * Math.pow(2, attempt - 1);
          await new Promise(res => setTimeout(res, backoff));
        }
      }
    } finally {
      inFlightRef.current = false;
    }
  }, []);
  return { run };
};

function formatDateForCalendar(dateStr: string): string | null {
  if (!dateStr) return null;
  const cleaned = dateStr.trim();

  // Already ISO format YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;

  // MM/DD/YYYY or MM-DD-YYYY (4-digit year)
  const mdy4 = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (mdy4) {
    const [, m, d, y] = mdy4;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // MM/DD/YY or MM-DD-YY (2-digit year)
  const mdy2 = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (mdy2) {
    const [, m, d, yy] = mdy2;
    const y = parseInt(yy, 10) > 50 ? '19' + yy : '20' + yy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Fallback: let JS parse it
  const parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];

  return null;
}

async function addToGoogleCalendar(data: ExtractedPOData, jobId: string): Promise<boolean> {
  try {
    const dueDateFormatted = formatDateForCalendar(data.dueDate);
    if (!dueDateFormatted) return false;

    const buildEvent = () => ({
      summary: `DUE: ${data.partName || data.partNumber} - PO# ${data.poNumber}`,
      description: [
        `Job ID: ${jobId}`,
        `PO/Order #: ${data.poNumber}`,
        `Part #: ${data.partNumber}`,
        `Part Name: ${data.partName}`,
        `Quantity: ${data.quantity}`,
        `Customer: ${data.customerName}`,
        data.notes ? `Notes: ${data.notes}` : '',
      ].filter(Boolean).join('\n'),
      start: { date: dueDateFormatted, timeZone: 'America/Los_Angeles' },
      end: { date: dueDateFormatted, timeZone: 'America/Los_Angeles' },
      colorId: '11',
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 24 * 60 },
          { method: 'popup', minutes: 3 * 24 * 60 }
        ]
      },
    });

    const insertEvent = async (): Promise<boolean> => {
      await (window as any).gapi.client.calendar.events.insert({
        calendarId: 'primary',
        resource: buildEvent()
      });
      return true;
    };

    const gapi = (window as any).gapi;
    if (gapi?.client?.calendar) return await insertEvent();

    if (typeof (window as any).__requestCalendarAccess === 'function') {
      return await new Promise<boolean>((resolve) => {
        (window as any).__requestCalendarAccess(async (success: boolean) => {
          if (!success) { resolve(false); return; }
          try { resolve(await insertEvent()); } catch { resolve(false); }
        });
      });
    }
    return false;
  } catch (err) {
    console.error('Calendar error:', err);
    return false;
  }
}

async function extractPODataWithGemini(imageBase64: string, mimeType: string, apiKey: string): Promise<ExtractedPOData> {
  const prompt = `You are analyzing a purchase order (PO) for a precision deburring company. Extract these fields:
- PO Number: PO#, P.O., Order#, Order Number, Purchase Order, SO#, Release#, Work Order
- Job Number: Job#, Work Order#, WO#, Traveler# - may not exist
- Part Number: Part#, P/N, Part No., Item#, Drawing#
- Part Name: description/name of the part
- Quantity: Qty, QTY, Units, Pieces, Pcs
- Due Date: Due Date, Required By, Need By, Delivery Date, Ship Date
- Customer Name: company/person who sent the PO

RULES:
1. Fill in best guess for every field - NEVER leave blank if info exists
2. confidence = "high" if 4+ fields readable, "medium" if 2-3, "low" if unreadable
3. jobNumber is optional - use "" only if truly none exists
4. Return due date in MM/DD/YYYY format

Return ONLY raw JSON, no markdown, no backticks:
{"poNumber":"","jobNumber":"","partNumber":"","partName":"","quantity":"","dueDate":"MM/DD/YYYY","customerName":"","confidence":"high|medium|low","notes":""}`;

  const models = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.5-flash'];
  let lastError: any;

  for (const model of models) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType, data: imageBase64 } }
              ]
            }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`${response.status}: ${err?.error?.message || 'API error'}`);
      }

      const result = await response.json();
      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleaned = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]); } catch {}
      }
      try { return JSON.parse(cleaned); } catch {}
      continue;
    } catch (err: any) {
      lastError = err;
      console.warn(`Model ${model} failed:`, err.message);
      continue;
    }
  }

  return {
    poNumber: '', jobNumber: '', partNumber: '', partName: '',
    quantity: '', dueDate: '', customerName: '',
    confidence: 'low' as const,
    notes: `Scan failed: ${lastError?.message || 'Unknown error'}. Please fill in fields manually.`,
  };
}

function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve({ base64: result.split(',')[1], mimeType: file.type || 'image/jpeg' });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const ConfidenceBadge = ({ level }: { level: 'high' | 'medium' | 'low' }) => {
  const styles = {
    high: 'bg-green-500/20 text-green-400 border-green-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    low: 'bg-red-500/20 text-red-400 border-red-500/30'
  };
  const labels = {
    high: 'High Confidence',
    medium: 'Review Carefully',
    low: 'Low Confidence - Check All Fields'
  };
  return <span className={`text-xs px-2 py-1 rounded-full border ${styles[level]}`}>{labels[level]}</span>;
};

export const POScanner: React.FC<POScannerProps> = ({ onJobCreate, geminiApiKey, onClose }) => {
  const [step, setStep] = useState<'upload' | 'processing' | 'review' | 'saving' | 'success' | 'error'>('upload');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<ExtractedPOData | null>(null);
  const [editedData, setEditedData] = useState<ExtractedPOData | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [calendarAdded, setCalendarAdded] = useState<boolean | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const { run: geminiRun } = useGeminiGuard();

  const handleImageSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please select an image file.');
      setStep('error');
      return;
    }
    setImagePreview(URL.createObjectURL(file));
    setStep('processing');
    try {
      const { base64, mimeType } = await fileToBase64(file);
      const data = await geminiRun(
        () => extractPODataWithGemini(base64, mimeType, geminiApiKey),
        { cooldownMs: 3000, maxRetries: 1 }
      );
      setExtractedData(data);
      setEditedData({ ...data });
      setStep('review');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to process image. Check your Gemini API key.');
      setStep('error');
    }
  }, [geminiApiKey, geminiRun]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleImageSelect(f);
  };

  const handleFieldChange = (field: keyof ExtractedPOData, value: string) => {
    if (editedData) setEditedData({ ...editedData, [field]: value });
  };

  const handleConfirmAndCreate = async () => {
    if (!editedData) return;
    setStep('saving');
    try {
      const jobId = `JOB-${Date.now()}`;
      await onJobCreate({
        poNumber: editedData.poNumber || editedData.jobNumber || 'N/A',
        partNumber: editedData.partNumber,
        customer: editedData.customerName,
        quantity: parseInt(editedData.quantity) || 0,
        dueDate: editedData.dueDate,
        info: [
          editedData.partName ? `Part: ${editedData.partName}` : '',
          editedData.jobNumber ? `Job#: ${editedData.jobNumber}` : '',
          editedData.notes || ''
        ].filter(Boolean).join(' | '),
      });
      const calSuccess = await addToGoogleCalendar(editedData, jobId);
      setCalendarAdded(calSuccess);
      setStep('success');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create job.');
      setStep('error');
    }
  };

  const reset = () => {
    setStep('upload');
    setImagePreview(null);
    setExtractedData(null);
    setEditedData(null);
    setErrorMsg('');
    setCalendarAdded(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  if (step === 'upload') return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
              <ScanLine className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-white font-bold text-lg">Scan Purchase Order</h2>
              <p className="text-gray-400 text-xs">AI extracts all job details automatically</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <button
            onClick={() => cameraInputRef.current?.click()}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl p-4 flex items-center justify-center gap-3 font-semibold"
          >
            <Camera className="w-6 h-6" />Take Photo of PO
          </button>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-700" />
            <span className="text-gray-500 text-sm">or</span>
            <div className="flex-1 h-px bg-gray-700" />
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-600 text-white rounded-xl p-4 flex items-center justify-center gap-3"
          >
            <Upload className="w-5 h-5 text-gray-400" />Upload from Device
          </button>
          <p className="text-gray-500 text-xs text-center">Works with photos, scans, or screenshots of any PO format</p>
        </div>
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileInput} />
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileInput} />
      </div>
    </div>
  );

  if (step === 'processing') return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl p-8 text-center">
        {imagePreview && (
          <div className="mb-6 relative">
            <img src={imagePreview} alt="PO" className="w-full h-40 object-cover rounded-xl opacity-50" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-black/60 rounded-xl px-4 py-2 flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                <span className="text-white text-sm">AI Reading PO...</span>
              </div>
            </div>
          </div>
        )}
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
        <h3 className="text-white font-bold text-lg mb-2">Analyzing Purchase Order</h3>
        <p className="text-gray-400 text-sm">AI is reading your PO image...</p>
      </div>
    </div>
  );

  if (step === 'review' && editedData) {
    const fields = [
      { key: 'poNumber', label: 'PO / Order Number', icon: Hash, placeholder: 'e.g. PO-12345' },
      { key: 'jobNumber', label: 'Job Number (optional)', icon: FileText, placeholder: 'e.g. JOB-001' },
      { key: 'partNumber', label: 'Part Number', icon: Package, placeholder: 'e.g. ABC-123' },
      { key: 'partName', label: 'Part Name / Description', icon: Package, placeholder: 'e.g. Bracket Assembly' },
      { key: 'quantity', label: 'Quantity', icon: Hash, placeholder: 'e.g. 50' },
      { key: 'dueDate', label: 'Due Date', icon: Calendar, placeholder: 'e.g. 03/15/2025' },
      { key: 'customerName', label: 'Customer Name', icon: User, placeholder: 'e.g. Boeing' },
    ];

    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
          <div className="flex items-center justify-between p-5 border-b border-gray-700 flex-shrink-0">
            <div>
              <h2 className="text-white font-bold text-lg">Review Extracted Data</h2>
              <div className="mt-1"><ConfidenceBadge level={editedData.confidence} /></div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
          </div>
          {imagePreview && (
            <div className="px-5 pt-4 flex-shrink-0">
              <img src={imagePreview} alt="PO" className="w-full h-24 object-cover rounded-xl border border-gray-700" />
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            <p className="text-gray-400 text-xs mb-3">Review and correct any fields before creating the job.</p>
            {fields.map(({ key, label, icon: Icon, placeholder }) => (
              <div key={key}>
                <label className="flex items-center gap-2 text-gray-400 text-xs mb-1">
                  <Icon className="w-3 h-3" />{label}
                </label>
                <input
                  type="text"
                  value={(editedData as any)[key] || ''}
                  onChange={(e) => handleFieldChange(key as keyof ExtractedPOData, e.target.value)}
                  placeholder={placeholder}
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            ))}
            {editedData.notes && (
              <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-lg p-3">
                <p className="text-yellow-400 text-xs font-medium mb-1">AI Notes</p>
                <p className="text-gray-300 text-xs">{editedData.notes}</p>
              </div>
            )}
          </div>
          <div className="p-5 border-t border-gray-700 flex gap-3 flex-shrink-0">
            <button
              onClick={reset}
              className="flex items-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-sm"
            >
              <RefreshCw className="w-4 h-4" />Rescan
            </button>
            <button
              onClick={handleConfirmAndCreate}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold text-sm"
            >
              <CheckCircle className="w-4 h-4" />Create Job + Add to Calendar<ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'saving') return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm shadow-2xl p-8 text-center">
        <Loader2 className="w-12 h-12 text-green-500 animate-spin mx-auto mb-4" />
        <h3 className="text-white font-bold text-lg mb-2">Creating Job...</h3>
        <p className="text-gray-400 text-sm">Saving to Firebase and Google Calendar</p>
      </div>
    </div>
  );

  if (step === 'success' && editedData) return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm shadow-2xl p-8 text-center">
        <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-white font-bold text-xl mb-2">Job Created!</h3>
        <div className="bg-gray-800 rounded-xl p-4 text-left space-y-2 mb-4">
          {editedData.poNumber && <div className="flex justify-between text-sm"><span className="text-gray-400">PO #</span><span className="text-white font-medium">{editedData.poNumber}</span></div>}
          {editedData.partNumber && <div className="flex justify-between text-sm"><span className="text-gray-400">Part #</span><span className="text-white font-medium">{editedData.partNumber}</span></div>}
          {editedData.quantity && <div className="flex justify-between text-sm"><span className="text-gray-400">Qty</span><span className="text-white font-medium">{editedData.quantity}</span></div>}
          {editedData.dueDate && <div className="flex justify-between text-sm"><span className="text-gray-400">Due</span><span className="text-white font-medium">{editedData.dueDate}</span></div>}
        </div>
        <div className={`flex items-center justify-center gap-2 text-sm mb-6 ${calendarAdded ? 'text-green-400' : 'text-yellow-400'}`}>
          <Calendar className="w-4 h-4" />
          {calendarAdded ? 'Added to Google Calendar' : 'Connect Google Calendar to auto-add'}
        </div>
        <div className="flex gap-3">
          <button onClick={reset} className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm">Scan Another</button>
          <button onClick={onClose} className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-semibold text-sm">Done</button>
        </div>
      </div>
    </div>
  );

  if (step === 'error') return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-red-800/50 rounded-2xl w-full max-w-sm shadow-2xl p-8 text-center">
        <div className="w-16 h-16 bg-red-900/40 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-8 h-8 text-red-400" />
        </div>
        <h3 className="text-white font-bold text-xl mb-2">Something went wrong</h3>
        <p className="text-gray-400 text-sm mb-6">{errorMsg}</p>
        <div className="flex gap-3">
          <button onClick={reset} className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4" />Try Again
          </button>
          <button onClick={onClose} className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-semibold text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );

  return null;
};

export default POScanner;
