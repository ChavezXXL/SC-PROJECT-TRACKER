import React, { useState, useRef, useCallback } from 'react';
import {
  Camera, Upload, CheckCircle, AlertCircle, Loader2,
  X, Calendar, Hash, Package, User, FileText, RefreshCw,
  ChevronRight, ScanLine, CalendarCheck, CalendarX
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

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

let _cachedToken: string | null = null;
let _tokenExpiry = 0;

function isTokenValid() {
  return _cachedToken && Date.now() < _tokenExpiry - 60_000;
}

async function getGoogleToken(): Promise<string> {
  if (isTokenValid()) return _cachedToken!;
  if (!GOOGLE_CLIENT_ID) throw new Error('VITE_GOOGLE_CLIENT_ID is not set.');
  return new Promise((resolve, reject) => {
    const redirectUri = window.location.origin;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'token');
    url.searchParams.set('scope', CALENDAR_SCOPE);
    const popup = window.open(url.toString(), 'google-auth', 'width=500,height=600,left=200,top=100');
    if (!popup) { reject(new Error('Popup blocked. Allow popups for this site.')); return; }
    const timer = setInterval(() => {
      try {
        if (popup.closed) { clearInterval(timer); reject(new Error('Auth cancelled.')); return; }
        const popupUrl = popup.location.href;
        if (popupUrl.startsWith(redirectUri) && popupUrl.includes('access_token')) {
          popup.close(); clearInterval(timer);
          const hash = new URL(popupUrl).hash.slice(1);
          const params = new URLSearchParams(hash);
          const token = params.get('access_token');
          const expiresIn = parseInt(params.get('expires_in') || '3600', 10);
          if (token) { _cachedToken = token; _tokenExpiry = Date.now() + expiresIn * 1000; resolve(token); }
          else { reject(new Error('No access token in response.')); }
        }
      } catch { /* cross-origin during redirect */ }
    }, 200);
    setTimeout(() => { clearInterval(timer); if (!popup.closed) popup.close(); reject(new Error('Auth timed out.')); }, 120_000);
  });
}

function formatDateForCalendar(dateStr: string): string | null {
  if (!dateStr) return null;
  const cleaned = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
  const mdyMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (mdyMatch) { const [, m, d, y] = mdyMatch; return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`; }
  const parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
  return null;
}

async function addToGoogleCalendar(data: ExtractedPOData, jobId: string): Promise<boolean> {
  try {
    const dueDateFormatted = formatDateForCalendar(data.dueDate);
    if (!dueDateFormatted) return false;
    const token = await getGoogleToken();
    const event = {
      summary: `DUE: ${data.partName || data.partNumber} — PO# ${data.poNumber}`,
      description: [`Job ID: ${jobId}`, `PO/Order #: ${data.poNumber}`, `Part #: ${data.partNumber}`, data.partName ? `Part Name: ${data.partName}` : '', `Quantity: ${data.quantity}`, data.customerName ? `Customer: ${data.customerName}` : '', data.notes ? `Notes: ${data.notes}` : ''].filter(Boolean).join('\n'),
      start: { date: dueDateFormatted },
      end: { date: dueDateFormatted },
      colorId: '11',
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 24 * 60 }, { method: 'popup', minutes: 3 * 24 * 60 }] },
    };
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); console.error('Calendar API error:', err); return false; }
    return true;
  } catch (err) { console.error('Calendar error:', err); return false; }
}

async function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const result = reader.result as string; resolve({ base64: result.split(',')[1], mimeType: file.type || 'image/jpeg' }); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function extractPODataWithGemini(imageBase64: string, mimeType: string, apiKey: string): Promise<ExtractedPOData> {
  const prompt = `You are analyzing a purchase order (PO) for a precision deburring company.
Extract these fields — be flexible with different label names:
- PO Number: PO#, P.O., Order#, Order Number, Purchase Order, SO#, Release#, Work Order
- Job Number: Job#, Work Order#, WO#, Traveler# — may not exist
- Part Number: Part#, P/N, Part No., Item#, Drawing#
- Part Name: description or name of the part being ordered
- Quantity: Qty, QTY, Units, Pieces, Pcs
- Due Date: Due Date, Required By, Need By, Delivery Date, Ship Date, Must Ship
- Customer Name: company or person who sent the PO
Return ONLY valid JSON, absolutely no markdown fences or extra text:
{"poNumber":"","jobNumber":"","partNumber":"","partName":"","quantity":"","dueDate":"MM/DD/YYYY format if possible","customerName":"","confidence":"high|medium|low","notes":"any special instructions"}`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: imageBase64 } }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 1024 } }),
  });
  if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(`Gemini API error: ${response.status} — ${err?.error?.message || 'Unknown error'}`); }
  const result = await response.json();
  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const cleaned = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
  try { return JSON.parse(cleaned); } catch { throw new Error('Could not parse AI response. Try a clearer photo with better lighting.'); }
}

const ConfidenceBadge = ({ level }: { level: string }) => {
  const styles: Record<string, string> = { high: 'bg-green-900/40 text-green-400 border-green-700/50', medium: 'bg-yellow-900/40 text-yellow-400 border-yellow-700/50', low: 'bg-red-900/40 text-red-400 border-red-700/50' };
  const labels: Record<string, string> = { high: '\u2713 High Confidence', medium: '\u26a0 Medium Confidence \u2014 verify fields', low: '\u2717 Low Confidence \u2014 review carefully' };
  return <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border ${styles[level] || styles.medium}`}>{labels[level] || level}</span>;
};

export const POScanner: React.FC<POScannerProps> = ({ onJobCreate, geminiApiKey, onClose }) => {
  const [step, setStep] = useState<'upload'|'processing'|'review'|'saving'|'success'|'error'>('upload');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<ExtractedPOData | null>(null);
  const [editedData, setEditedData] = useState<ExtractedPOData | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [calendarAdded, setCalendarAdded] = useState<boolean | null>(null);
  const [createdJobId, setCreatedJobId] = useState('');
  const [skipCalendar, setSkipCalendar] = useState(!GOOGLE_CLIENT_ID);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) { setErrorMsg('Please select an image file.'); setStep('error'); return; }
    setImagePreview(URL.createObjectURL(file));
    setStep('processing');
    try {
      const { base64, mimeType } = await fileToBase64(file);
      const data = await extractPODataWithGemini(base64, mimeType, geminiApiKey);
      setExtractedData(data); setEditedData({ ...data }); setStep('review');
    } catch (err: any) { setErrorMsg(err.message || 'Failed to process image.'); setStep('error'); }
  }, [geminiApiKey]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) handleImageSelect(f); };
  const handleFieldChange = (field: keyof ExtractedPOData, value: string) => { if (editedData) setEditedData({ ...editedData, [field]: value }); };

  const handleConfirmAndCreate = async () => {
    if (!editedData) return;
    setStep('saving');
    try {
      const jobId = `JOB-${Date.now()}`;
      setCreatedJobId(jobId);
      await onJobCreate({ poNumber: editedData.poNumber || editedData.jobNumber || 'N/A', partNumber: editedData.partNumber, customer: editedData.customerName, quantity: parseInt(editedData.quantity) || 0, dueDate: editedData.dueDate, info: [editedData.partName ? `Part: ${editedData.partName}` : '', editedData.jobNumber ? `Job#: ${editedData.jobNumber}` : '', editedData.notes || ''].filter(Boolean).join(' | ') });
      let calSuccess = false;
      if (!skipCalendar && editedData.dueDate) calSuccess = await addToGoogleCalendar(editedData, jobId);
      setCalendarAdded(calSuccess);
      setStep('success');
    } catch (err: any) { setErrorMsg(err.message || 'Failed to create job.'); setStep('error'); }
  };

  const reset = () => {
    setStep('upload'); setImagePreview(null); setExtractedData(null); setEditedData(null);
    setErrorMsg(''); setCalendarAdded(null); setCreatedJobId('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  if (step === 'upload') return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center"><ScanLine className="w-5 h-5 text-white" /></div>
            <div><h2 className="text-white font-bold text-lg">Scan Purchase Order</h2><p className="text-gray-400 text-xs">AI extracts all job details automatically</p></div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <button onClick={() => cameraInputRef.current?.click()} className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl p-4 flex items-center justify-center gap-3 font-semibold transition-colors"><Camera className="w-6 h-6" />Take Photo of PO</button>
          <div className="flex items-center gap-3"><div className="flex-1 h-px bg-gray-700" /><span className="text-gray-500 text-sm">or</span><div className="flex-1 h-px bg-gray-700" /></div>
          <button onClick={() => fileInputRef.current?.click()} className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-600 text-white rounded-xl p-4 flex items-center justify-center gap-3 transition-colors"><Upload className="w-5 h-5 text-gray-400" />Upload from Device</button>
          {GOOGLE_CLIENT_ID ? (
            <label className="flex items-center gap-3 cursor-pointer px-1">
              <input type="checkbox" checked={!skipCalendar} onChange={e => setSkipCalendar(!e.target.checked)} className="w-4 h-4 rounded accent-blue-500" />
              <span className="text-gray-400 text-sm flex items-center gap-1.5"><Calendar className="w-4 h-4" />Add due date to Google Calendar</span>
            </label>
          ) : (
            <p className="text-gray-600 text-xs text-center">Calendar sync not configured</p>
          )}
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
        {imagePreview && <div className="mb-6 relative"><img src={imagePreview} alt="PO" className="w-full h-40 object-cover rounded-xl opacity-50" /><div className="absolute inset-0 flex items-center justify-center"><div className="bg-black/60 rounded-xl px-4 py-2 flex items-center gap-2"><Loader2 className="w-4 h-4 text-blue-400 animate-spin" /><span className="text-white text-sm">AI Reading PO...</span></div></div></div>}
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
        <h3 className="text-white font-bold text-lg mb-2">Analyzing Purchase Order</h3>
        <p className="text-gray-400 text-sm">Gemini AI is extracting all job details...</p>
      </div>
    </div>
  );

  if (step === 'review' && editedData) {
    const fields = [
      { key: 'poNumber', label: 'PO / Order Number', icon: Hash, placeholder: 'e.g. PO-12345' },
      { key: 'jobNumber', label: 'Job Number (if any)', icon: FileText, placeholder: 'e.g. JOB-001 (optional)' },
      { key: 'partNumber', label: 'Part Number', icon: Package, placeholder: 'e.g. ABC-123' },
      { key: 'partName', label: 'Part Name / Description', icon: Package, placeholder: 'e.g. Bracket Assembly' },
      { key: 'quantity', label: 'Quantity', icon: Hash, placeholder: 'e.g. 50' },
      { key: 'dueDate', label: 'Due Date', icon: Calendar, placeholder: 'e.g. 03/15/2025' },
      { key: 'customerName', label: 'Customer Name', icon: User, placeholder: 'e.g. Boeing' },
    ] as const;
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
          <div className="flex items-center justify-between p-5 border-b border-gray-700 flex-shrink-0">
            <div><h2 className="text-white font-bold text-lg">Review Extracted Data</h2><div className="mt-1"><ConfidenceBadge level={editedData.confidence} /></div></div>
            <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
          </div>
          {imagePreview && <div className="px-5 pt-4 flex-shrink-0"><img src={imagePreview} alt="PO" className="w-full h-24 object-cover rounded-xl border border-gray-700" /></div>}
          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            <p className="text-gray-400 text-xs mb-3">\u270f\ufe0f Review and correct any fields before creating the job.</p>
            {fields.map(({ key, label, icon: Icon, placeholder }) => (
              <div key={key}>
                <label className="flex items-center gap-2 text-gray-400 text-xs mb-1"><Icon className="w-3 h-3" />{label}</label>
                <input type="text" value={(editedData as any)[key] || ''} onChange={e => handleFieldChange(key as keyof ExtractedPOData, e.target.value)} placeholder={placeholder} className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500" />
              </div>
            ))}
            {editedData.notes && <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-lg p-3"><p className="text-yellow-400 text-xs font-medium mb-1">\ud83d\udccb AI Notes from PO</p><p className="text-gray-300 text-xs">{editedData.notes}</p></div>}
            {GOOGLE_CLIENT_ID && editedData.dueDate && (
              <label className="flex items-center gap-3 cursor-pointer bg-blue-900/20 border border-blue-700/30 rounded-lg p-3">
                <input type="checkbox" checked={!skipCalendar} onChange={e => setSkipCalendar(!e.target.checked)} className="w-4 h-4 rounded accent-blue-500" />
                <span className="text-blue-300 text-sm flex items-center gap-1.5"><Calendar className="w-4 h-4" />Add <strong>{editedData.dueDate}</strong> to Google Calendar</span>
              </label>
            )}
          </div>
          <div className="p-5 border-t border-gray-700 flex gap-3 flex-shrink-0">
            <button onClick={reset} className="flex items-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-sm transition-colors"><RefreshCw className="w-4 h-4" />Rescan</button>
            <button onClick={handleConfirmAndCreate} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold text-sm transition-colors">
              <CheckCircle className="w-4 h-4" />{skipCalendar ? 'Create Job' : 'Create Job + Calendar'}<ChevronRight className="w-4 h-4" />
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
        <p className="text-gray-400 text-sm">{skipCalendar ? 'Saving job to system...' : 'Saving to system and Google Calendar...'}</p>
      </div>
    </div>
  );

  if (step === 'success') return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm shadow-2xl p-8 text-center">
        <div className="w-16 h-16 bg-green-900/40 rounded-full flex items-center justify-center mx-auto mb-4"><CheckCircle className="w-8 h-8 text-green-400" /></div>
        <h3 className="text-white font-bold text-xl mb-2">Job Created!</h3>
        {createdJobId && <p className="text-gray-400 text-sm mb-3">ID: <span className="text-blue-400 font-mono">{createdJobId}</span></p>}
        {!skipCalendar && (
          <div className={`flex items-center justify-center gap-2 text-sm mb-4 ${calendarAdded ? 'text-green-400' : 'text-yellow-400'}`}>
            {calendarAdded ? <><CalendarCheck className="w-4 h-4" />\u2713 Added to Google Calendar</> : <><CalendarX className="w-4 h-4" />\u26a0 Calendar sync failed</>}
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={reset} className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm transition-colors">Scan Another</button>
          <button onClick={onClose} className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-semibold text-sm transition-colors">Done</button>
        </div>
      </div>
    </div>
  );

  if (step === 'error') return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-red-800/50 rounded-2xl w-full max-w-sm shadow-2xl p-8 text-center">
        <div className="w-16 h-16 bg-red-900/40 rounded-full flex items-center justify-center mx-auto mb-4"><AlertCircle className="w-8 h-8 text-red-400" /></div>
        <h3 className="text-white font-bold text-xl mb-2">Something went wrong</h3>
        <p className="text-gray-400 text-sm mb-6">{errorMsg}</p>
        <div className="flex gap-3">
          <button onClick={reset} className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors"><RefreshCw className="w-4 h-4" />Try Again</button>
          <button onClick={onClose} className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-semibold text-sm transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  );

  return null;
};

export default POScanner;