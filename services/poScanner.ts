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

  // Shared date fragment (no capture group — wrapped by callers)
  const D = '\\d{1,2}[\/\\-]\\d{1,2}[\/\\-]\\d{2,4}|\\d{4}[\/\\-]\\d{2}[\/\\-]\\d{2}';

  // ── PO Number ────────────────────────────────────────────────────────────
  // Real-world PO formats seen in the wild:
  //   "P.O.# 114213"           — hash without colon (SH Machine)
  //   "Our P.O.# 114213"       — prefixed with "Our"
  //   "PO: 5042"               — colon, no hash
  //   "Purchase Order: 9812"   — full words
  //   "Order No 7734"          — order number label
  // RULE: value MUST contain at least one digit + not be a blocklisted word.
  const po = tryPatterns(text, [
    // Hash as separator — colon NOT required (most common industrial format)
    /\bP\.?O\.?[ \t]*#[ \t]*([A-Z0-9][A-Z0-9\-\/\.]{0,24})/i,
    // "PO:" or "P.O.:" with colon
    /\bP\.?O\.?[ \t]*:[ \t]*([A-Z0-9][A-Z0-9\-\/\.]{0,24})/i,
    // "PO No", "PO Number" — colon optional but label is specific
    /\bP\.?O\.?[ \t]*(?:No\.?|Num(?:ber)?)[ \t]*:?[ \t]*([A-Z0-9][A-Z0-9\-\/\.]{0,24})/i,
    // "Purchase Order" with any separator
    /\bPurchase[ \t]+Order[ \t]*(?:#|No\.?|Num(?:ber)?)?[ \t]*:?[ \t]*([A-Z0-9][A-Z0-9\-\/\.]{0,24})/i,
    // "Order No / Order # / Order Number" — specific enough to not need colon
    /\bOrder[ \t]*(?:#|No\.?|Num(?:ber)?)[ \t]*:?[ \t]*([A-Z0-9][A-Z0-9\-\/\.]{0,24})/i,
    // "Job #" / "Job No"
    /\bJob[ \t]*(?:#|No\.?|Num(?:ber)?)[ \t]*:?[ \t]*([A-Z0-9][A-Z0-9\-\/\.]{0,24})/i,
    // "Order:" standalone — colon REQUIRED to avoid matching "Order" mid-sentence
    /\bOrder[ \t]*:[ \t]*([A-Z0-9][A-Z0-9\-\/\.]{0,24})/i,
  ]);
  if (po) {
    const upper = po.value.toUpperCase();
    if (/\d/.test(po.value) && !PO_BLOCKLIST.has(upper)) {
      fields.poNumber = po.value;
      sources.poNumber = po.snippet;
    }
  }

  // ── Part Number ──────────────────────────────────────────────────────────
  // Priority 1: explicit label
  // Priority 2: line-item row — "XXXX-XXX  qty  description  $price" format
  //   (common on POs where table headers appear at bottom of row in PDF extraction)
  let rawPart = tryPatterns(text, [
    /\bPart[ \t]*(?:#|No\.?|Num(?:ber)?)[ \t]*:?[ \t]*([A-Z0-9][A-Z0-9\-\.\/]{1,30})/i,
    /\bDrawing[ \t]*(?:#|No\.?|Num(?:ber)?)[ \t]*:?[ \t]*([A-Z0-9][A-Z0-9\-\.\/]{1,30})/i,
    /\b(?:P\/N|PN)[ \t]*:?[ \t]*([A-Z0-9][A-Z0-9\-\.\/]{1,30})/i,
    /\bItem[ \t]*(?:#|No\.?|Num(?:ber)?|ID)[ \t]*:?[ \t]*([A-Z0-9][A-Z0-9\-\.\/]{1,30})/i,
    /\bMaterial[ \t]*(?:#|No\.?|Num(?:ber)?)[ \t]*:?[ \t]*([A-Z0-9][A-Z0-9\-\.\/]{1,30})/i,
  ]);
  // Filter noise words
  if (rawPart && (PART_BLOCKLIST.has(rawPart.value.toLowerCase()) || rawPart.value.length < 2)) {
    rawPart = null;
  }
  if (!rawPart) {
    // Line-item heuristic: "PARTNO  QTY  Description  $X.XX  $Y.YY"
    // Looks for an alphanumeric-dash token followed by a small number and a dollar amount
    const liMatch = text.match(/\b([A-Z0-9]{2,10}-[A-Z0-9]{2,10})[ \t]+(\d{1,5})[ \t]+[A-Za-z][\w\s]{2,30}\$[\d]/i);
    if (liMatch) {
      rawPart = { value: liMatch[1], snippet: liMatch[0].slice(0, 60) };
      // Also grab quantity from same line-item row if not yet found
      if (!fields.quantity) {
        const n = parseInt(liMatch[2], 10);
        if (!isNaN(n) && n > 0 && n < 1_000_000) {
          fields.quantity = n;
          sources.quantity = liMatch[0].slice(0, 60);
        }
      }
    }
  }
  if (rawPart) { fields.partNumber = rawPart.value; sources.partNumber = rawPart.snippet; }

  // ── Quantity ─────────────────────────────────────────────────────────────
  if (!fields.quantity) {
    const qty = tryPatterns(text, [
      /(?:Qty|Quantity|QTY)\.?[ \t]*(?:Ordered|Req(?:uired|uested)?|Shipped)?[ \t]*:?[ \t]*(\d[\d,]*)/i,
      /(?:Pieces?|Pcs?|Count|Units?)[ \t]*:?[ \t]*(\d[\d,]*)/i,
      /(\d{1,6}[\d,]*)[ \t]*(?:EA|PCS?|PIECES?|UNITS?|EACH)\b/i,
      /\bQty[ \t]+(\d[\d,]*)/i,
    ]);
    if (qty) {
      const n = parseInt(qty.value.replace(/,/g, ''), 10);
      if (!isNaN(n) && n > 0 && n < 1_000_000) {
        fields.quantity = n;
        sources.quantity = qty.snippet;
      }
    }
  }

  // ── Due Date ─────────────────────────────────────────────────────────────
  const due = tryPatterns(text, [
    // "Due Date", "Delivery Date", "Required Date", "Need Date", etc.
    new RegExp(`(?:(?:First[ \\t]+)?Due|Delivery|Required?|Need(?:ed)?|Promise|Wanted)[ \\t]*(?:Date|By|On)?[ \\t]*:?[ \\t]*(${D})`, 'i'),
    // "Ship Date", "Ship By", "Must Ship"
    new RegExp(`(?:Ship(?:[ \\t]*(?:Date|By|On))?|Must[ \\t]+Ship)[ \\t]*:?[ \\t]*(${D})`, 'i'),
    // Date followed by due label (reversed order)
    new RegExp(`(${D})[ \\t]*(?:Due|Delivery|Required?)`, 'i'),
  ]);
  if (due) {
    const d = normaliseDate(due.value);
    if (d) { fields.dueDate = d; sources.dueDate = due.snippet; }
  }

  // ── Date Received / PO Date ───────────────────────────────────────────────
  const recv = tryPatterns(text, [
    new RegExp(`(?:Date[ \\t]*(?:Received?|Issued?|Created?)|(?:PO|Order|Issue)[ \\t]*Date|Order[ \\t]*Date)[ \\t]*:?[ \\t]*(${D})`, 'i'),
    // "ORDER DATE ... 4/28/26" where ORDER DATE is label in header row
    new RegExp(`ORDER[ \\t]+DATE[ \\t]+(${D})`, 'i'),
  ]);
  if (recv) {
    const d = normaliseDate(recv.value);
    if (d) { fields.dateReceived = d; sources.dateReceived = recv.snippet; }
  }

  // ── Customer / Company ────────────────────────────────────────────────────
  // A PO is sent TO SC Deburring FROM a customer. Priority:
  //   1. Explicit label ("Customer:", "Company:", "Buyer:")
  //   2. "Our account # is: COMPANY NAME"  (SH Machine format)
  //   3. Letterhead heuristic — scan first 12 lines for company-name pattern
  const SC_SELF = /^(sc deburring|scdeburring|sc-deburring)/i;

  let rawCust = tryPatterns(text, [
    /(?:Customer|Client|Company|Issued[ \t]*By|Bill[ \t]*(?:To|From)|Sold[ \t]*(?:To|By)|Buyer)[ \t]*:[ \t]*([A-Za-z][A-Za-z0-9 ,\.&'\-]{2,50})$/im,
    /\bFrom[ \t]*:[ \t]*([A-Za-z][A-Za-z0-9 ,\.&'\-]{2,50})$/im,
    // "Our account # is: COMPANY NAME"  /  "Account: COMPANY"
    /(?:Our[ \t]+)?[Aa]ccount[ \t]*(?:#[ \t]*)?(?:is|:)[ \t]*:?[ \t]*([A-Za-z][A-Za-z0-9 ,\.&'\-]{2,50})/im,
    // "Vendor:" — may refer to us or the sender depending on PO format; low priority
    /\bVendor[ \t]*:[ \t]*([A-Za-z][A-Za-z0-9 ,\.&'\-]{2,50})$/im,
  ]);

  if (!rawCust) {
    // Letterhead scan: look in first 12 lines for anything resembling a company name
    const bizWords = /\b(Inc\.?|LLC\.?|Ltd\.?|Corp\.?|Co\.?|Machine|Mfg|Manufacturing|Industries|Engineering|Supply|Solutions|Systems|Technologies|Fabricat|Metal|Precision|Products|Services|Group)\b/i;
    const notALabel = /^(purchase|order|invoice|delivery|packing|bill|from|to|date|page|ship|vendor|po |p\.o\.|quantity|part|item|ref|attn|\d)/i;
    for (const line of text.split('\n').slice(0, 12)) {
      const t = line.trim().replace(/\s+/g, ' ');
      if (t.length >= 4 && t.length <= 70 && /^[A-Z]/.test(t) && bizWords.test(t) && !notALabel.test(t) && !SC_SELF.test(t)) {
        // Trim address details — stop at first digit (starts address) or bullet/dash
        const nameOnly = t.replace(/\s+\d.+$/, '').replace(/\s+[•·].+$/, '').trim();
        if (nameOnly.length >= 4) { rawCust = { value: nameOnly, snippet: t }; break; }
      }
    }
  }

  if (rawCust) {
    const cleaned = rawCust.value.replace(/[,\.]+$/, '').trim();
    if (cleaned.length > 2 && !SC_SELF.test(cleaned)) {
      fields.customer = cleaned;
      sources.customer = rawCust.snippet;
    }
  }

  // ── Unit Price / Price Per Part ───────────────────────────────────────────
  const price = tryPatterns(text, [
    // Labelled unit price
    /(?:Unit[ \t]*Price|Price[ \t]*(?:Ea(?:ch)?|\/[ \t]*(?:EA|PC|Each))|Per[ \t]*(?:Piece|Part|PC|EA)|Price\/EA|Price\/PC|\$\/(?:PC|EA|Part))[ \t]*:?[ \t]*\$?([\d,]+(?:\.\d{1,4})?)/i,
    // "$X.XX / EA" explicit per-unit denominator
    /\$[ \t]*([\d,]+\.\d{2})[ \t]*(?:\/[ \t]*(?:PC|EA|each|piece|part))\b/i,
    // Line-item "$X.XX" — only if quantity already found (proves it's a unit price row)
    ...(fields.quantity ? [/\$\s*([\d,]+\.\d{2})\b/] as RegExp[] : []),
  ]);
  if (price) {
    const p = parseFloat(price.value.replace(/,/g, ''));
    if (!isNaN(p) && p > 0 && p < 100_000) {
      fields.pricePerPart = p;
      sources.pricePerPart = price.snippet;
    }
  }

  // ── Special Instructions / Notes ─────────────────────────────────────────
  // Do NOT match Terms/Conditions (legal boilerplate). Reject URL-containing values.
  const instrREs = [
    /\bSpecial[ \t]*(?:Inst(?:ructions?)?|Notes?)[ \t]*:?[ \t]*([^\n]{8,400})/i,
    /\bINSTRUCTIONS[ \t]*:[ \t]*([^\n]{8,400})/,
    /\bInstr(?:uctions?)?[ \t]*:[ \t]*([^\n]{8,400})/i,
    /\bNotes?[ \t]*:[ \t]*([^\n]{8,400})/i,
    /\bRemarks?[ \t]*:[ \t]*([^\n]{8,400})/i,
    /\bComments?[ \t]*:[ \t]*([^\n]{8,400})/i,
  ];
  for (const re of instrREs) {
    const m = text.match(re);
    if (m?.[1]?.trim()) {
      const val = m[1].trim();
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

/** Extract embedded text from a machine-generated PDF, preserving line structure.
 *
 *  Uses PDF.js transform[5] (Y-coordinate) to group text items into visual lines.
 *  Items on the same Y position join with a space; different Y = new line.
 *  This is critical — simply joining all items with spaces produces a single
 *  wall of text where every line-anchored regex fails.
 */
async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = getPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageBlocks: string[] = [];

  for (let p = 1; p <= Math.min(pdf.numPages, 2); p++) {
    const page  = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items  = content.items as any[];

    // Group by Y coordinate (rounded to nearest 2 px to handle floating point)
    const byY = new Map<number, string[]>();
    for (const item of items) {
      if (!item.str) continue;
      const y = Math.round(item.transform[5] / 2) * 2; // bucket to 2px
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y)!.push(item.str);
    }

    // Sort Y descending (PDF coords: 0 = bottom, so higher Y = visually higher)
    const sorted = [...byY.entries()].sort((a, b) => b[0] - a[0]);
    const pageLines = sorted.map(([, strs]) => strs.join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (pageLines.length) pageBlocks.push(pageLines.join('\n'));
  }

  return pageBlocks.join('\n');
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
