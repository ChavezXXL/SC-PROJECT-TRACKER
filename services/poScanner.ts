/**
 * PO Scanner — free, browser-native OCR using Tesseract.js.
 *
 * Replaces the old Gemini API scanner:
 *  ✅ Zero cost — runs 100% locally in the browser
 *  ✅ No API key needed
 *  ✅ Works offline after first load
 *  ✅ No rate limits or glitches
 *
 * Supports: JPEG, PNG, WEBP, PDF (first page via canvas), camera photo.
 */

import type { Job } from '../types';

export interface ScanResult {
  fields: Partial<Job>;
  rawText: string;
  confidence: number;           // 0-100
  fieldSources: Record<string, string>; // field → matched text snippet
}

// ── Field extraction helpers ──────────────────────────────────────────────────

/** Normalise a date string to YYYY-MM-DD or return undefined */
function normaliseDate(raw: string): string | undefined {
  // Try MM/DD/YYYY, M/D/YYYY, MM-DD-YYYY, M-D-YY
  const us = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (us) {
    const [, m, d, y] = us;
    const year = y.length === 2 ? '20' + y : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // ISO already
  const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return raw;
  return undefined;
}

/** Try many patterns, return first match group and the full match */
function tryPatterns(
  text: string,
  patterns: RegExp[],
): { value: string; snippet: string } | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]?.trim()) {
      return { value: m[1].trim(), snippet: m[0].trim() };
    }
  }
  return null;
}

/** Common all-caps words that get falsely matched as PO numbers or part numbers */
const PO_BLOCKLIST = new Set([
  'QUALITY', 'INSPECTION', 'REVISION', 'CONTROL', 'STANDARD', 'PURCHASE',
  'DELIVERY', 'INVOICE', 'PACKING', 'SHIPPING', 'RECEIPT', 'APPROVAL',
  'ORDER', 'TERMS', 'CONDITIONS', 'DESCRIPTION', 'MATERIAL', 'PRODUCT',
  'DRAWING', 'APPROVED', 'REQUIRED', 'REQUESTED', 'ISSUED', 'RECEIVED',
  'NUMBER', 'DETAILS', 'INFORMATION', 'CONTACT', 'ADDRESS', 'TOTAL',
]);

// All lowercase for case-insensitive lookup
const PART_BLOCKLIST = new Set([
  'rev', 'revision', 'see', 'ref', 'dwg', 'page', 'sheet', 'above',
  'below', 'note', 'notes', 'per', 'ea', 'each', 'lot', 'set',
  'the', 'for', 'and', 'all', 'n/a', 'na', 'tbd',
]);

export function parseJobFields(rawText: string): ScanResult {
  // Normalise line endings; collapse runs of spaces/tabs within each line
  // but KEEP newlines so line-anchored patterns work correctly.
  const text = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  const fields: Partial<Job> = {};
  const sources: Record<string, string> = {};

  // ── PO Number ────────────────────────────────────────────────────────────
  // Many formats: "PO: 123", "P.O.# 123", "Purchase Order Number 123",
  // "Order No 123" — colon is OPTIONAL, spaces flexible.
  // RULE: PO numbers must contain at least one digit (words like "QUALITY"
  // are common OCR false-positives from department headers / doc type labels).
  const po = tryPatterns(text, [
    // "PO:", "P.O.#", "PO Number", "PO No" → value on same line
    /\bP\.?O\.?[ \t]*(?:#|No\.?|Num(?:ber)?)?[ \t]*:[ \t]*([A-Z0-9][A-Z0-9\-\/\.]{0,24})/i,
    // "Purchase Order" / "Purchase Order Number"
    /\bPurchase[ \t]+Order[ \t]*(?:#|No\.?|Num(?:ber)?)?[ \t]*:?[ \t]*([A-Z0-9][A-Z0-9\-\/\.]{0,24})/i,
    // "Order Number / Order No / Order #" — colon required to avoid matching "Order" in sentences
    /\bOrder[ \t]*(?:#|No\.?|Num(?:ber)?)[ \t]*:?[ \t]*([A-Z0-9][A-Z0-9\-\/\.]{0,24})/i,
    // "Job Number / Job No"
    /\bJob[ \t]*(?:#|No\.?|Num(?:ber)?)[ \t]*:?[ \t]*([A-Z0-9][A-Z0-9\-\/\.]{0,24})/i,
    // Standalone "Order:" label — colon REQUIRED (stricter to avoid sentence matches)
    /\bOrder[ \t]*:[ \t]*([A-Z0-9][A-Z0-9\-\/\.]{0,24})/i,
  ]);
  if (po) {
    const val = po.value.toUpperCase();
    // Must contain at least one digit — pure-word values are header labels, not PO#s
    if (/\d/.test(po.value) && !PO_BLOCKLIST.has(val)) {
      fields.poNumber = po.value;
      sources.poNumber = po.snippet;
    }
  }

  // ── Part Number ──────────────────────────────────────────────────────────
  // RULE: block short noise words like "Rev", "See", "Ref"; require content.
  const part = tryPatterns(text, [
    /\bPart[ \t]*(?:#|No\.?|Num(?:ber)?)?[ \t]*:?[ \t]*([A-Z0-9][A-Z0-9\-\.\/]{1,30})/i,
    /\bDrawing[ \t]*(?:#|No\.?|Num(?:ber)?)?[ \t]*:?[ \t]*([A-Z0-9][A-Z0-9\-\.\/]{1,30})/i,
    /\b(?:P\/N|PN)[ \t]*:?[ \t]*([A-Z0-9][A-Z0-9\-\.\/]{1,30})/i,
    /\bItem[ \t]*(?:#|No\.?|Num(?:ber)?|ID)?[ \t]*:?[ \t]*([A-Z0-9][A-Z0-9\-\.\/]{1,30})/i,
    /\bMaterial[ \t]*(?:#|No\.?|Num(?:ber)?)?[ \t]*:?[ \t]*([A-Z0-9][A-Z0-9\-\.\/]{1,30})/i,
    /\bProduct[ \t]*(?:#|No\.?|Code)?[ \t]*:?[ \t]*([A-Z0-9][A-Z0-9\-\.\/]{1,30})/i,
  ]);
  if (part) {
    const val = part.value;
    if (!PART_BLOCKLIST.has(val.toLowerCase()) && val.length >= 2) {
      fields.partNumber = val;
      sources.partNumber = part.snippet;
    }
  }

  // ── Quantity ─────────────────────────────────────────────────────────────
  const qty = tryPatterns(text, [
    // "Quantity:", "Qty:", "QTY Ordered:", etc. — colon optional
    /(?:Qty|Quantity|QTY)\.?[ \t]*(?:Ordered|Req(?:uired|uested)?|Shipped)?[ \t]*:?[ \t]*(\d[\d,]*)/i,
    /(?:Pieces?|Pcs?|Count|Units?|Ordered)[ \t]*:?[ \t]*(\d[\d,]*)/i,
    // Number immediately followed by unit: "500 EA", "250 PCS"
    /(\d{1,6}[\d,]*)[ \t]*(?:EA|PCS?|PIECES?|UNITS?|EACH)\b/i,
    // Bare "Order Qty 500" or "Qty 500"
    /\bQty[ \t]+(\d[\d,]*)/i,
  ]);
  if (qty) {
    const n = parseInt(qty.value.replace(/,/g, ''), 10);
    if (!isNaN(n) && n > 0 && n < 1_000_000) {
      fields.quantity = n;
      sources.quantity = qty.snippet;
    }
  }

  // ── Due Date ─────────────────────────────────────────────────────────────
  // Capture any date-like value on the same line as common due-date labels.
  // Date formats: MM/DD/YYYY, M/D/YY, YYYY-MM-DD, MM-DD-YYYY
  const DATE_PAT = '(\\d{1,2}[\/\\-]\\d{1,2}[\/\\-]\\d{2,4}|\\d{4}[\/\\-]\\d{2}[\/\\-]\\d{2})';
  const due = tryPatterns(text, [
    new RegExp(`(?:Due|Delivery|Required?|Need(?:ed)?|Ship|Must[ \\t]+Ship|Requested?|Promise)[ \\t]*(?:Date|By|On)?[ \\t]*:?[ \\t]*${DATE_PAT}`, 'i'),
    new RegExp(`${DATE_PAT}[ \\t]*(?:Due|Delivery|Required?|Ship)`, 'i'),
  ]);
  if (due) {
    const d = normaliseDate(due.value);
    if (d) { fields.dueDate = d; sources.dueDate = due.snippet; }
  }

  // ── Date Received / PO Date ───────────────────────────────────────────────
  const recv = tryPatterns(text, [
    new RegExp(`(?:Date[ \\t]*(?:Received?|Issued?|Created?)|(?:PO|Order|Issue)[ \\t]*Date|Received?[ \\t]*Date)[ \\t]*:?[ \\t]*${DATE_PAT}`, 'i'),
  ]);
  if (recv) {
    const d = normaliseDate(recv.value);
    if (d) { fields.dateReceived = d; sources.dateReceived = recv.snippet; }
  }

  // ── Customer / Company ────────────────────────────────────────────────────
  // A PO is sent TO SC Deburring FROM a customer. The issuing company is our customer.
  // Priority 1: explicit label patterns
  // Priority 2: letterhead heuristic — first line that looks like a company name
  let rawCust = tryPatterns(text, [
    // Explicit labels — capture to end of line
    /(?:Customer|Client|Company|Issued[ \t]*By|Bill[ \t]*(?:To|From)|Sold[ \t]*(?:To|By)|Buyer)[ \t]*:[ \t]*([A-Za-z][A-Za-z0-9 ,\.&'\-]{2,60})$/im,
    // "From:" label
    /\bFrom[ \t]*:[ \t]*([A-Za-z][A-Za-z0-9 ,\.&'\-]{2,60})$/im,
    // "Vendor:" — often the customer in sub-contractor PO formats
    /\bVendor[ \t]*:[ \t]*([A-Za-z][A-Za-z0-9 ,\.&'\-]{2,60})$/im,
  ]);

  if (!rawCust) {
    // Letterhead heuristic: scan the first 6 lines for a company-looking name.
    // Company names typically:  start with a capital, contain business suffixes,
    // or contain words like Machine, Manufacturing, Industries, Supply, etc.
    const topLines = text.split('\n').slice(0, 6);
    const bizWords = /\b(Inc\.?|LLC\.?|Ltd\.?|Corp\.?|Co\.?|Machine|Manufacturing|Industries|Engineering|Supply|Solutions|Systems|Technologies|Fabricat|Metal|Precision|Products|Services|Group)\b/i;
    const notALabel = /^(purchase|order|invoice|delivery|packing|bill|from|to|date|page|ship|vendor|po |p\.o\.|quantity|part|item|ref|attn)/i;
    for (const line of topLines) {
      const t = line.trim();
      if (t.length >= 4 && t.length <= 60 && /^[A-Z]/.test(t) && bizWords.test(t) && !notALabel.test(t)) {
        rawCust = { value: t, snippet: t };
        break;
      }
    }
  }

  if (rawCust) {
    const cleaned = rawCust.value.replace(/[,\.]+$/, '').trim();
    if (cleaned.length > 2 && !/^(sc deburring|scdeburring)/i.test(cleaned)) {
      fields.customer = cleaned;
      sources.customer = rawCust.snippet;
    }
  }

  // ── Unit Price / Price Per Part ───────────────────────────────────────────
  // Prefer explicitly-labelled unit price patterns; the bare "$X.XX" fallback
  // is last resort and only fires if we have a quantity (otherwise "Total: $7.00"
  // or a footer dollar amount would be grabbed as unit price).
  const price = tryPatterns(text, [
    // Labelled unit price — highest confidence
    /(?:Unit[ \t]*Price|Price[ \t]*(?:Ea(?:ch)?|\/[ \t]*(?:EA|PC|Each))|Per[ \t]*(?:Piece|Part|PC|EA)|Price\/EA|Price\/PC|\$\/(?:PC|EA|Part))[ \t]*:?[ \t]*\$?([\d,]+(?:\.\d{1,4})?)/i,
    // "$X.XX / EA" or "$X.XX / PC" — includes unit denominator
    /\$[ \t]*([\d,]+\.\d{2})[ \t]*(?:\/[ \t]*(?:PC|EA|each|piece|part))\b/i,
    // Bare "$X.XX" — only if we already have a quantity (confirms it's a line-item, not a total)
    ...(qty ? [/\$\s*([\d,]+\.\d{2})\b/] as RegExp[] : []),
  ]);
  if (price) {
    const p = parseFloat(price.value.replace(/,/g, ''));
    if (!isNaN(p) && p > 0 && p < 100_000) {
      fields.pricePerPart = p;
      sources.pricePerPart = price.snippet;
    }
  }

  // ── Special Instructions / Notes ─────────────────────────────────────────
  // NOTE: Do NOT match "Terms" or "Conditions" — those are legal footer boilerplate,
  // not manufacturing instructions.  Also reject values containing URLs.
  const instrPatterns = [
    /\bSpecial[ \t]*Inst(?:ructions?)?[ \t]*:?[ \t]*([^\n]{8,400})/i,
    /\bInstr(?:uctions?)?[ \t]*:[ \t]*([^\n]{8,400})/i,
    /\bNotes?[ \t]*:[ \t]*([^\n]{8,400})/i,
    /\bRemarks?[ \t]*:[ \t]*([^\n]{8,400})/i,
    /\bComments?[ \t]*:[ \t]*([^\n]{8,400})/i,
    /\bRequirements?[ \t]*:[ \t]*([^\n]{8,400})/i,
  ];
  for (const re of instrPatterns) {
    const m = text.match(re);
    if (m && m[1]?.trim()) {
      const val = m[1].trim();
      // Skip if it looks like legal boilerplate or contains a URL
      if (!/https?:\/\//i.test(val) && !/visit:/i.test(val) && val.length >= 5) {
        fields.specialInstructions = val;
        sources.specialInstructions = m[0].trim();
        break;
      }
    }
  }

  // ── Confidence heuristic ──────────────────────────────────────────────────
  const keyFields = ['poNumber', 'partNumber', 'quantity', 'dueDate', 'customer'];
  const filled = keyFields.filter(k => k in fields).length;
  const confidence = Math.round((filled / keyFields.length) * 100);

  return { fields, rawText: text, confidence, fieldSources: sources };
}

// ── Image helpers ─────────────────────────────────────────────────────────────

/** Render an image file through canvas → JPEG data URL.
 *  Handles HEIC, WEBP, AVIF, PNG, JPEG — anything the browser can decode.
 *  Caps at 1800 px to prevent WASM heap exhaustion on phone photos.
 */
function imageFileToJpeg(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const blobUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 1800;
      let { width: w, height: h } = img;
      if (w > MAX || h > MAX) {
        const r = Math.min(MAX / w, MAX / h);
        w = Math.round(w * r);
        h = Math.round(h * r);
      }
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(blobUrl);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error('Could not load image. Make sure it is a JPG, PNG, or WEBP file.'));
    };
    img.src = blobUrl;
  });
}

// ── PDF helpers ───────────────────────────────────────────────────────────────

function getPdfJs(): any {
  const lib = (window as any).pdfjsLib;
  if (!lib) throw new Error('PDF.js not loaded — refresh the page and try again.');
  // Point the worker at the same CDN version
  lib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  return lib;
}

/** Extract embedded text from a machine-generated PDF (no OCR needed).
 *  Returns empty string if the PDF has no usable text (e.g. scanned image). */
async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = getPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 3); p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => item.str || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (pageText) lines.push(pageText);
  }
  return lines.join('\n');
}

/** Render the first page of a PDF to a JPEG data URL for OCR.
 *  Used when the PDF contains only scanned images (no embedded text). */
async function pdfPageToJpeg(file: File): Promise<string> {
  const pdfjsLib = getPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  // scale 2 ≈ 150 DPI equivalent — enough for Tesseract, not too heavy
  const viewport = page.getViewport({ scale: 2.0 });
  const canvas = document.createElement('canvas');
  canvas.width  = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.92);
}

// ── Main entry point ──────────────────────────────────────────────────────────

/** Scan a PO document (PDF or image) and extract job fields.
 *
 *  PDF flow:
 *    1. Try direct text extraction (PDF.js) — instant, perfect for digital POs
 *    2. If no embedded text found, render page 1 → canvas → Tesseract OCR
 *
 *  Image flow:
 *    1. Canvas-normalise to JPEG (handles HEIC/WEBP, caps resolution)
 *    2. Tesseract OCR
 *
 *  Uses window.Tesseract (self-hosted script tag) to bypass Vite's bundler
 *  which incorrectly selects the Node.js worker instead of the browser worker.
 */
export async function scanDocument(
  file: File,
  onProgress?: (pct: number, status: string) => void,
): Promise<ScanResult> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    // ── PDF: try embedded text first (fastest, most accurate) ──────────────
    onProgress?.(10, 'Reading PDF…');
    try {
      const text = await extractPdfText(file);
      if (text.length > 60) {
        // Enough text — skip OCR entirely
        onProgress?.(100, 'Done');
        return parseJobFields(text);
      }
    } catch {
      // PDF.js failed, fall through to OCR
    }

    // ── PDF has no text layer → render to canvas → OCR ─────────────────────
    onProgress?.(20, 'Rendering PDF page…');
    const jpegUrl = await pdfPageToJpeg(file);
    return runOcr(jpegUrl, onProgress);
  }

  // ── Image file ─────────────────────────────────────────────────────────────
  onProgress?.(5, 'Preparing image…');
  const jpegUrl = await imageFileToJpeg(file);
  return runOcr(jpegUrl, onProgress);
}

/** Run Tesseract OCR on a JPEG data URL and return parsed fields. */
async function runOcr(
  jpegDataUrl: string,
  onProgress?: (pct: number, status: string) => void,
): Promise<ScanResult> {
  const T = (window as any).Tesseract;
  if (!T) throw new Error('Tesseract not loaded — refresh the page and try again.');

  const worker = await T.createWorker('eng', 1, {
    workerPath: '/tesseract-worker.min.js',
    logger: (m: any) => {
      if (onProgress && typeof m.progress === 'number') {
        onProgress(Math.round(m.progress * 100), m.status || '');
      }
    },
  });

  try {
    const { data } = await worker.recognize(jpegDataUrl);
    return parseJobFields(data.text);
  } finally {
    await worker.terminate();
  }
}
