import React, { useState, useRef, useCallback } from 'react';
import {
  Camera,
  Upload,
  CheckCircle,
  AlertCircle,
  Loader2,
  X,
  Calendar,
  Hash,
  Package,
  User,
  FileText,
  RefreshCw,
  ChevronRight,
  ScanLine,
  ClipboardList
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
  specialInstructions: string;
}

interface POScannerProps {
  onJobCreate: (jobData: {
    poNumber: string;
    partNumber: string;
    customer: string;
    quantity: number;
    dueDate: string;
    info: string;
    specialInstructions?: string;
  }) => Promise<void>;
  onClose: () => void;
  clients?: string[];
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

    // If another request is in flight, wait for it to finish rather than
    // hard-throwing. Double-tapping scan should feel natural, not broken.
    const start = Date.now();
    const maxWait = 30000; // 30s safety cap
    while (inFlightRef.current) {
      if (Date.now() - start > maxWait) {
        throw new Error('Previous scan is taking too long — please refresh and try again.');
      }
      await new Promise((res) => setTimeout(res, 200));
    }

    const now = Date.now();
    const wait = cooldownMs - (now - lastCallRef.current);

    if (wait > 0) {
      await new Promise((res) => setTimeout(res, wait));
    }

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
          const is429 =
            msg.includes('429') ||
            msg.toLowerCase().includes('rate') ||
            msg.toLowerCase().includes('quota');

          if (!is429 || attempt > maxRetries) {
            throw err;
          }

          const backoff = 1000 * Math.pow(2, attempt - 1);
          await new Promise((res) => setTimeout(res, backoff));
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

  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return cleaned;
  }

  const mdy4 = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (mdy4) {
    const [, m, d, y] = mdy4;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const mdy2 = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (mdy2) {
    const [, m, d, yy] = mdy2;
    const y = parseInt(yy, 10) > 50 ? '19' + yy : '20' + yy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return null;
}

function getNextDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

function normalizeExtractedPOData(parsed: Partial<ExtractedPOData>): ExtractedPOData {
  return {
    poNumber: typeof parsed.poNumber === 'string' ? parsed.poNumber.trim() : '',
    jobNumber: typeof parsed.jobNumber === 'string' ? parsed.jobNumber.trim() : '',
    partNumber: typeof parsed.partNumber === 'string' ? parsed.partNumber.trim() : '',
    partName: typeof parsed.partName === 'string' ? parsed.partName.trim() : '',
    quantity: typeof parsed.quantity === 'string' ? parsed.quantity.trim() : '',
    dueDate: typeof parsed.dueDate === 'string' ? parsed.dueDate.trim() : '',
    customerName: typeof parsed.customerName === 'string' ? parsed.customerName.trim() : '',
    confidence:
      parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
        ? parsed.confidence
        : 'low',
    notes: typeof parsed.notes === 'string' ? parsed.notes.trim() : '',
    specialInstructions:
      typeof parsed.specialInstructions === 'string' ? parsed.specialInstructions.trim() : '',
  };
}

function parseQuantity(value: string): number {
  const cleaned = String(value || '').replace(/[^\d]/g, '');
  return parseInt(cleaned, 10) || 0;
}

async function addToGoogleCalendar(data: ExtractedPOData, jobId: string): Promise<boolean> {
  try {
    const dueDateFormatted = formatDateForCalendar(data.dueDate);
    if (!dueDateFormatted) return false;

    const buildEvent = () => ({
      summary: `DUE: ${data.partName || data.partNumber || 'Part'} - PO# ${data.poNumber || 'N/A'}`,
      description: [
        `Job ID: ${jobId}`,
        `PO/Order #: ${data.poNumber || 'N/A'}`,
        `Job #: ${data.jobNumber || 'N/A'}`,
        `Part #: ${data.partNumber || 'N/A'}`,
        `Part Name: ${data.partName || 'N/A'}`,
        `Quantity: ${data.quantity || 'N/A'}`,
        `Customer: ${data.customerName || 'N/A'}`,
        data.specialInstructions ? `Instructions: ${data.specialInstructions}` : '',
        data.notes ? `Notes: ${data.notes}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      start: { date: dueDateFormatted },
      end: { date: getNextDate(dueDateFormatted) },
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

    if (gapi?.client?.calendar) {
      return await insertEvent();
    }

    if (typeof (window as any).__requestCalendarAccess === 'function') {
      return await new Promise<boolean>((resolve) => {
        (window as any).__requestCalendarAccess(async (success: boolean) => {
          if (!success) {
            resolve(false);
            return;
          }

          try {
            resolve(await insertEvent());
          } catch {
            resolve(false);
          }
        });
      });
    }

    return false;
  } catch (err) {
    console.error('Calendar error:', err);
    return false;
  }
}

async function extractPODataWithGemini(
  imageBase64: string,
  mimeType: string
): Promise<ExtractedPOData> {
  // Prompt kept concise — every token costs money
  const prompt = `Extract PO fields from this manufacturing Purchase Order / Work Order image. Return ONLY this JSON, no other text:
{"poNumber":"","jobNumber":"","partNumber":"","partName":"","quantity":"","dueDate":"","customerName":"","confidence":"high|medium|low","notes":"","specialInstructions":""}

Field mapping:
- poNumber: PO#, P.O., Order#, SO#, Release#, Contract#
- jobNumber: Job#, WO#, Work Order, Traveler# ("" if none)
- partNumber: Part#, P/N, PN, Item#, Drawing#, NSN
- partName: Description / Nomenclature
- quantity: Qty, Quantity, Pcs, Ea
- dueDate: Due/Required/Need-By/Ship — format MM/DD/YYYY
- customerName: company name / Bill To / Sold To
- specialInstructions: ONLY deburring-relevant (edge breaks, deburr callouts, blending, Scotch-Brite warnings, "don't nick") — SHORT. Skip material, heat treat, certs, shipping.
- confidence: "high" if 5+ fields, "medium" if 3-4, "low" if <3

Use "" for anything not found. Search headers, footers, tables, fine print.`;

  // Single call to our Netlify function — key stays on server, no retry loop in client
  const response = await fetch('/.netlify/functions/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, imageBase64, mimeType }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const code = err?.code || '';
    const msg = err?.error || `HTTP ${response.status}`;
    // Billing/quota errors get flagged for the UI to show the friendly billing screen
    if (code === 'BILLING' || response.status === 429) {
      throw new Error(`BILLING: Gemini API spending cap reached. Go to https://ai.studio/billing to raise your limit. (${msg})`);
    }
    if (code === 'AUTH') {
      throw new Error('BILLING: Gemini API key invalid or not configured. Check Netlify env vars.');
    }
    throw new Error(`Scan failed: ${msg}`);
  }

  const { text } = await response.json();

  // Clean + parse JSON
  let cleaned = (text || '').replace(/[\u0000-\u001F]+/g, ' ').trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) cleaned = jsonMatch[0];

  let parsed: Partial<ExtractedPOData> = {};
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Scanner returned invalid data. Try a clearer photo.');
  }

  const normalized = normalizeExtractedPOData(parsed);
  const anyField = normalized.poNumber || normalized.jobNumber || normalized.partNumber
    || normalized.partName || normalized.quantity || normalized.dueDate
    || normalized.customerName || normalized.specialInstructions;

  if (!anyField) {
    throw new Error('Could not read any fields from this image. Try a clearer, well-lit photo.');
  }

  return normalized;
}

// 1280px is plenty for OCR/text extraction and cuts token cost ~60% vs 2000px
function compressImage(file: File, maxWidth = 1280): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      const img = new Image();

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
        if (!ctx) {
          reject(new Error('Canvas context failed'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        // 0.82 quality is visually fine for text and cuts file size ~40% vs 0.95
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
      };

      img.onerror = () => reject(new Error('Failed to load image for compression.'));
      img.src = event.target?.result as string;
    };

    reader.onerror = () => reject(new Error('Failed to read file.'));
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

  return (
    <span className={`text-xs px-2 py-1 rounded-full border ${styles[level]}`}>
      {labels[level]}
    </span>
  );
};

// Fuzzy match a scanned customer name to the closest client in the settings list
function matchClient(scanned: string, clients: string[]): string {
  if (!scanned || clients.length === 0) return scanned;
  const s = scanned.toLowerCase().trim();
  // Exact match first
  const exact = clients.find(c => c.toLowerCase() === s);
  if (exact) return exact;
  // Contains match — either direction
  const contains = clients.find(c => s.includes(c.toLowerCase()) || c.toLowerCase().includes(s));
  if (contains) return contains;
  // Word overlap match
  const sWords = s.split(/[\s,.\-_]+/).filter(w => w.length > 2);
  let bestMatch = '';
  let bestScore = 0;
  for (const c of clients) {
    const cWords = c.toLowerCase().split(/[\s,.\-_]+/).filter(w => w.length > 2);
    const overlap = sWords.filter(w => cWords.some(cw => cw.includes(w) || w.includes(cw))).length;
    const score = overlap / Math.max(sWords.length, cWords.length, 1);
    if (score > bestScore && score >= 0.4) { bestScore = score; bestMatch = c; }
  }
  return bestMatch || scanned;
}

export const POScanner: React.FC<POScannerProps> = ({
  onJobCreate,
  onClose,
  clients = []
}) => {
  const [step, setStep] = useState<'upload' | 'processing' | 'review' | 'saving' | 'success' | 'error'>('upload');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
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
      const { base64, mimeType } = await compressImage(file);
      // Single call, no retries — server handles model fallbacks. Prevents cost blowout on errors.
      const data = await geminiRun(
        () => extractPODataWithGemini(base64, mimeType),
        { cooldownMs: 3000, maxRetries: 0 }
      );

      // Match scanned customer name to existing clients list
      if (data.customerName && clients.length > 0) {
        data.customerName = matchClient(data.customerName, clients);
      }
      setEditedData({ ...data });
      setStep('review');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to process image.');
      setStep('error');
    }
  }, [geminiRun, clients]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      handleImageSelect(f);
    }
  };

  const handleFieldChange = (field: keyof ExtractedPOData, value: string) => {
    if (!editedData) return;
    setEditedData({ ...editedData, [field]: value });
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
        quantity: parseQuantity(editedData.quantity),
        dueDate: editedData.dueDate,
        info: [
          editedData.partName ? `Part: ${editedData.partName}` : '',
          editedData.jobNumber ? `Job#: ${editedData.jobNumber}` : '',
        ]
          .filter(Boolean)
          .join(' | '),
        specialInstructions: editedData.specialInstructions || '',
      });

      const calSuccess = await Promise.race([
        addToGoogleCalendar(editedData, jobId),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000))
      ]);

      setCalendarAdded(calSuccess);
      setStep('success');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to create job.');
      setStep('error');
    }
  };

  const reset = () => {
    setStep('upload');
    setImagePreview(null);
    setEditedData(null);
    setErrorMsg('');
    setCalendarAdded(null);

    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  if (step === 'upload') {
    return (
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
            <button onClick={onClose} className="text-gray-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl p-4 flex items-center justify-center gap-3 font-semibold"
            >
              <Camera className="w-6 h-6" />
              Take Photo of PO
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
              <Upload className="w-5 h-5 text-gray-400" />
              Upload from Device
            </button>

            <p className="text-gray-500 text-xs text-center">
              Works with photos, scans, or screenshots of any PO format
            </p>
          </div>

          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileInput}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileInput}
          />
        </div>
      </div>
    );
  }

  if (step === 'processing') {
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl p-8 text-center">
          {imagePreview && (
            <div className="mb-6 relative">
              <img
                src={imagePreview}
                alt="PO"
                className="w-full h-40 object-cover rounded-xl opacity-50"
              />
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
          <p className="text-gray-400 text-sm">Reading fields and extracting instructions...</p>
        </div>
      </div>
    );
  }

  if (step === 'review' && editedData) {
    const standardFields = [
      { key: 'poNumber', label: 'PO / Order Number', icon: Hash, placeholder: 'e.g. PO-12345' },
      { key: 'jobNumber', label: 'Job Number (optional)', icon: FileText, placeholder: 'e.g. JOB-001' },
      { key: 'partNumber', label: 'Part Number', icon: Package, placeholder: 'e.g. ABC-123' },
      { key: 'partName', label: 'Part Name / Description', icon: Package, placeholder: 'e.g. Bracket Assembly' },
      { key: 'quantity', label: 'Quantity', icon: Hash, placeholder: 'e.g. 50' },
      { key: 'dueDate', label: 'Due Date', icon: Calendar, placeholder: 'e.g. 03/15/2025' },
      { key: 'customerName', label: 'Customer Name', icon: User, placeholder: 'e.g. Boeing', isCustomer: true },
    ] as const;

    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
          <div className="flex items-center justify-between p-5 border-b border-gray-700 flex-shrink-0">
            <div>
              <h2 className="text-white font-bold text-lg">Review Extracted Data</h2>
              <div className="mt-1">
                <ConfidenceBadge level={editedData.confidence} />
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>

          {imagePreview && (
            <div className="px-5 pt-4 flex-shrink-0">
              <img
                src={imagePreview}
                alt="PO"
                className="w-full h-24 object-cover rounded-xl border border-gray-700"
              />
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            <p className="text-gray-400 text-xs mb-3">
              Review and correct any fields before creating the job.
            </p>

            {standardFields.map(({ key, label, icon: Icon, placeholder, ...rest }) => (
              <div key={key}>
                <label className="flex items-center gap-2 text-gray-400 text-xs mb-1">
                  <Icon className="w-3 h-3" />
                  {label}
                </label>
                {('isCustomer' in rest) && clients.length > 0 ? (
                  <select
                    value={editedData[key] || ''}
                    onChange={(e) => handleFieldChange(key, e.target.value)}
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="">— Select a client —</option>
                    {clients.sort((a, b) => a.localeCompare(b)).map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                    {editedData[key] && !clients.some(c => c.toLowerCase() === (editedData[key] || '').toLowerCase()) && (
                      <option value={editedData[key]}>📝 {editedData[key]} (scanned)</option>
                    )}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={editedData[key] || ''}
                    onChange={(e) => handleFieldChange(key, e.target.value)}
                    placeholder={placeholder}
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                )}
              </div>
            ))}

            <div>
              <label className="flex items-center gap-2 text-orange-400 text-xs mb-1 font-medium">
                <ClipboardList className="w-3 h-3" />
                Special Instructions
              </label>
              <textarea
                value={editedData.specialInstructions || ''}
                onChange={(e) => handleFieldChange('specialInstructions', e.target.value)}
                placeholder="e.g. Break all sharp edges .005-.015 | Stamp part number | Heat treat 48-53 HRC per AMS2759 | No Scotch-Brite on flow passages"
                rows={3}
                className="w-full bg-gray-800 border border-orange-700/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 resize-none"
              />
              <p className="text-gray-500 text-xs mt-1">
                Edge breaks, stamping, material specs, surface finish, certifications, warnings
              </p>
            </div>

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
              <RefreshCw className="w-4 h-4" />
              Rescan
            </button>
            <button
              onClick={handleConfirmAndCreate}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold text-sm"
            >
              <CheckCircle className="w-4 h-4" />
              Create Job + Add to Calendar
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'saving') {
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm shadow-2xl p-8 text-center">
          <Loader2 className="w-12 h-12 text-green-500 animate-spin mx-auto mb-4" />
          <h3 className="text-white font-bold text-lg mb-2">Creating Job...</h3>
          <p className="text-gray-400 text-sm">Saving to Database and Google Calendar</p>
        </div>
      </div>
    );
  }

  if (step === 'success' && editedData) {
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm shadow-2xl p-8 text-center">
          <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-white" />
          </div>

          <h3 className="text-white font-bold text-xl mb-2">Job Created!</h3>

          <div className="bg-gray-800 rounded-xl p-4 text-left space-y-2 mb-4">
            {editedData.poNumber && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">PO #</span>
                <span className="text-white font-medium">{editedData.poNumber}</span>
              </div>
            )}
            {editedData.partNumber && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Part #</span>
                <span className="text-white font-medium">{editedData.partNumber}</span>
              </div>
            )}
            {editedData.quantity && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Qty</span>
                <span className="text-white font-medium">{editedData.quantity}</span>
              </div>
            )}
            {editedData.dueDate && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Due</span>
                <span className="text-white font-medium">{editedData.dueDate}</span>
              </div>
            )}
            {editedData.specialInstructions && (
              <div className="pt-1 border-t border-gray-700">
                <p className="text-orange-400 text-xs font-medium mb-1">Instructions</p>
                <p className="text-gray-300 text-xs">{editedData.specialInstructions}</p>
              </div>
            )}
          </div>

          <div
            className={`flex items-center justify-center gap-2 text-sm mb-6 ${
              calendarAdded ? 'text-green-400' : 'text-yellow-400'
            }`}
          >
            <Calendar className="w-4 h-4" />
            {calendarAdded ? 'Added to Google Calendar' : 'Connect Google Calendar to auto-add'}
          </div>

          <div className="flex gap-3">
            <button
              onClick={reset}
              className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm"
            >
              Scan Another
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-semibold text-sm"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'error') {
    const isBilling = errorMsg.startsWith('BILLING:');
    const displayMsg = isBilling ? errorMsg.replace(/^BILLING:\s*/, '') : errorMsg;
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className={`bg-gray-900 border rounded-2xl w-full max-w-md shadow-2xl p-8 text-center ${isBilling ? 'border-amber-500/50' : 'border-red-800/50'}`}>
          <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${isBilling ? 'bg-amber-900/40' : 'bg-red-900/40'}`}>
            <AlertCircle className={`w-8 h-8 ${isBilling ? 'text-amber-400' : 'text-red-400'}`} />
          </div>

          <h3 className="text-white font-bold text-xl mb-2">
            {isBilling ? 'Gemini Billing Issue' : 'Something went wrong'}
          </h3>
          <p className="text-gray-300 text-sm mb-6 leading-relaxed">{displayMsg}</p>

          {isBilling && (
            <a
              href="https://ai.studio/billing"
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full py-2.5 mb-3 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold text-sm transition-colors"
            >
              Open Google AI Studio Billing →
            </a>
          )}

          <div className="flex gap-3">
            <button
              onClick={reset}
              className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-semibold text-sm"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default POScanner;
