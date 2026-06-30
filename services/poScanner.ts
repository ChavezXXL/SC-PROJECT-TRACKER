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

// ── Lazy script loading ───────────────────────────────────────────────────────
// Tesseract.js + PDF.js used to be parse-blocking <script> tags in index.html —
// ~400KB of JS delaying EVERY app start for a feature used a few times a week.
// Now injected on first scan only; cached for the rest of the session.

const scriptPromises = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  let p = scriptPromises.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptPromises.delete(src); // allow retry on next scan
        reject(new Error(`Failed to load ${src} — check your connection and try again.`));
      };
      document.head.appendChild(s);
    });
    scriptPromises.set(src, p);
  }
  return p;
}

/** Make sure window.Tesseract and window.pdfjsLib exist before scanning. */
async function ensureOcrLibs(): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (!(window as any).Tesseract) tasks.push(loadScript('/tesseract.min.js'));
  if (!(window as any).pdfjsLib) tasks.push(loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'));
  if (tasks.length) await Promise.all(tasks);
}

// ── Field extraction helpers ──────────────────────────────────────────────────

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** Normalise a date string to YYYY-MM-DD or return undefined (rejects impossible dates). */
function normaliseDate(raw: string): string | undefined {
  // Build + validate — month 1-12, day 1-31. Garbage like "25/13/01" → undefined.
  const build = (y: string, m: string, d: string): string | undefined => {
    const mi = +m, di = +d;
    if (mi < 1 || mi > 12 || di < 1 || di > 31) return undefined;
    return `${y}-${String(mi).padStart(2, '0')}-${String(di).padStart(2, '0')}`;
  };
  // ISO first (YYYY-MM-DD) — must run BEFORE the MM/DD matcher, which would
  // otherwise greedily mis-read "2025-12-01" as 25-12-01 → year 2001.
  const iso = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return build(iso[1], iso[2], iso[3]);
  // Then MM/DD/YYYY, M/D/YYYY, MM-DD-YYYY, M-D-YY
  const us = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (us) {
    const [, m, d, y] = us;
    return build(y.length === 2 ? '20' + y : y, m, d);
  }
  // "Jan 15, 2025" / "January 15 2025" / "Jan 15th 2025"
  const mdy = raw.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[ \t]+(\d{1,2})(?:st|nd|rd|th)?,?[ \t]+(\d{2,4})/i);
  if (mdy) {
    const mo = MONTHS[mdy[1].toLowerCase()];
    if (mo) return build(mdy[3].length === 2 ? '20' + mdy[3] : mdy[3], mo, mdy[2]);
  }
  // "15 Jan 2025" / "15th January 2025"
  const dmy = raw.match(/\b(\d{1,2})(?:st|nd|rd|th)?[ \t]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?[ \t]+(\d{2,4})/i);
  if (dmy) {
    const mo = MONTHS[dmy[2].toLowerCase()];
    if (mo) return build(dmy[3].length === 2 ? '20' + dmy[3] : dmy[3], mo, dmy[1]);
  }
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

  // Shared date fragment (no capture group — wrapped by callers).
  // Covers MM/DD/YYYY, ISO, and month-name forms ("Jan 15, 2025" / "15 Jan 2025").
  const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?';
  const D =
    '\\d{1,2}[\/\\-]\\d{1,2}[\/\\-]\\d{2,4}' +
    '|\\d{4}[\/\\-]\\d{2}[\/\\-]\\d{2}' +
    `|${MONTH}[ \\t]+\\d{1,2}(?:st|nd|rd|th)?,?[ \\t]+\\d{2,4}` +
    `|\\d{1,2}(?:st|nd|rd|th)?[ \\t]+${MONTH},?[ \\t]+\\d{2,4}`;

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
    // "Customer PO", "Cust PO#", "Cust. P.O. No"
    /\bCust(?:omer)?\.?[ \t]*P\.?O\.?[ \t]*(?:#|No\.?|Num(?:ber)?)?[ \t]*:?[ \t]*([A-Z0-9][A-Z0-9\-\/\.]{0,24})/i,
    // "PurchaseOrder#" (no space — common in PDF text extraction)
    /\bPurchase[ \t]*Order[ \t]*(?:#|No\.?|Num(?:ber)?)?[ \t]*:?[ \t]*([A-Z0-9][A-Z0-9\-\/\.]{0,24})/i,
    // "P/O" with a slash
    /\bP[ \t]*\/[ \t]*O[ \t]*(?:#|No\.?|Num(?:ber)?)?[ \t]*:?[ \t]*([A-Z0-9][A-Z0-9\-\/\.]{0,24})/i,
    // "Order:" standalone — colon REQUIRED to avoid matching "Order" mid-sentence
    /\bOrder[ \t]*:[ \t]*([A-Z0-9][A-Z0-9\-\/\.]{0,24})/i,
  ]);
  if (po) {
    const upper = po.value.toUpperCase();
    if (/\d/.test(po.value) && !PO_BLOCKLIST.has(upper)) {
      fields.poNumber = upper;   // PO numbers are uppercase — normalize for display + matching
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
  // Hold a description captured from the line-item row, used as a fallback
  // for specialInstructions later if no explicit INSTRUCTIONS label exists.
  let lineItemDescription = '';
  if (!rawPart) {
    // Line-item heuristic: "PARTNO  QTY  Description  $X.XX  $Y.YY"
    // Capture the description so we can use it as a fallback for instructions.
    const liMatch = text.match(/\b([A-Z0-9]{2,10}-[A-Z0-9]{2,10})[ \t]+(\d{1,5})[ \t]+([A-Za-z][\w\s,\.\-\/&'"()]{2,100}?)\$[\d]/i);
    if (liMatch) {
      rawPart = { value: liMatch[1], snippet: liMatch[0].slice(0, 60) };
      lineItemDescription = (liMatch[3] || '').trim();
      // Also grab quantity from same line-item row if not yet found
      if (!fields.quantity) {
        const n = parseInt(liMatch[2], 10);
        if (!isNaN(n) && n > 0 && n < 1_000_000) {
          fields.quantity = n;
          sources.quantity = liMatch[0].slice(0, 60);
        }
      }
    } else {
      // No-dash SKU line item: "ABC123  100  Widget  $5.00".
      // Lookaheads require the token to mix letters AND digits, so we don't
      // grab a bare quantity ("100") or a plain word ("Widget") by mistake.
      const li2 = text.match(/\b((?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{3,18})[ \t]+(\d{1,5})[ \t]+([A-Za-z][\w\s,\.\-\/&'"()]{2,100}?)\$[\d]/i);
      if (li2 && !PART_BLOCKLIST.has(li2[1].toLowerCase())) {
        rawPart = { value: li2[1], snippet: li2[0].slice(0, 60) };
        lineItemDescription = (li2[3] || '').trim();
        if (!fields.quantity) {
          const n = parseInt(li2[2], 10);
          if (!isNaN(n) && n > 0 && n < 1_000_000) {
            fields.quantity = n;
            sources.quantity = li2[0].slice(0, 60);
          }
        }
      }
    }
  } else {
    // Even when we already have a labelled part number, look for its line-item
    // description in the body — useful for "Part #: ABC" then later "ABC 100 Widget $5.00"
    const partVal = rawPart.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const liMatch = text.match(new RegExp(`\\b${partVal}\\b[ \\t]+\\d{1,5}[ \\t]+([A-Za-z][\\w\\s,\\.\\-\\/&'"()]{2,100}?)\\$[\\d]`, 'i'));
    if (liMatch) lineItemDescription = (liMatch[1] || '').trim();
  }
  if (rawPart) { fields.partNumber = rawPart.value; sources.partNumber = rawPart.snippet; }

  // ── Quantity ─────────────────────────────────────────────────────────────
  if (!fields.quantity) {
    const qty = tryPatterns(text, [
      /(?:Qty|Quantity|QTY)\.?[ \t]*(?:Ordered|Ord\.?|Req(?:uired|uested)?|Shipped)?[ \t]*:?[ \t]*(\d[\d,]*)/i,
      /(?:Order[ \t]*Qty|Qty[ \t]*Ord(?:ered)?)\.?[ \t]*:?[ \t]*(\d[\d,]*)/i,
      /(?:Pieces?|Pcs?|Count|Units?)[ \t]*:?[ \t]*(\d[\d,]*)/i,
      /(\d{1,6}[\d,]*)[ \t]*(?:EA\.?|PCS?\.?|PIECES?|UNITS?|EACH)\b/i,
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
    /(?:Customer|Client|Company|Issued[ \t]*By|Bill[ \t]*(?:To|From)|Sold[ \t]*(?:To|By)|Buyer)[ \t]*:[ \t]*([A-Za-z][A-Za-z0-9 ,\.&'()\/#\-]{2,50})$/im,
    /\bFrom[ \t]*:[ \t]*([A-Za-z][A-Za-z0-9 ,\.&'()\/#\-]{2,50})$/im,
    // "Our account # is: COMPANY NAME"  /  "Account: COMPANY"
    /(?:Our[ \t]+)?[Aa]ccount[ \t]*(?:#[ \t]*)?(?:is|:)[ \t]*:?[ \t]*([A-Za-z][A-Za-z0-9 ,\.&'()\/#\-]{2,50})/im,
    // "Vendor:" — may refer to us or the sender depending on PO format; low priority
    /\bVendor[ \t]*:[ \t]*([A-Za-z][A-Za-z0-9 ,\.&'()\/#\-]{2,50})$/im,
  ]);

  if (!rawCust) {
    // Letterhead scan: look in first 12 lines for anything resembling a company name
    const bizWords = /\b(Inc\.?|LLC\.?|L\.?L\.?C\.?|Ltd\.?|Corp\.?|Co\.?|Company|Machine|Machining|Mfg|Manufacturing|Industries|Industrial|Engineering|Supply|Solutions|Systems|Technologies|Tech|Fabricat|Metal|Metals|Steel|Precision|Products|Services|Group|Aerospace|Aero|Tool|Tooling|Plastics|Welding|Components|Enterprises|Corporation)\b/i;
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
    // Strip trailing symbol junk (the broadened char class allows ()/#, so a
    // capture like "Inc. ###" trims to "Inc"), then require real letters.
    const cleaned = rawCust.value.replace(/[^A-Za-z0-9)]+$/, '').replace(/[,\.]+$/, '').trim();
    if (cleaned.length > 2 && /[A-Za-z]{2}/.test(cleaned) && !SC_SELF.test(cleaned)) {
      fields.customer = cleaned;
      sources.customer = rawCust.snippet;
    }
  }

  // ── Unit Price / Price Per Part ───────────────────────────────────────────
  // On line-item POs: "PARTNO  QTY  Desc  $UNIT  $EXT"
  // We want the UNIT price (smaller), not the extended total.
  // Strategy: find all bare dollar amounts on the line-item row and pick the smallest.
  const price = tryPatterns(text, [
    // Labelled unit price — highest confidence
    /(?:Unit[ \t]*Price|Price[ \t]*(?:Ea(?:ch)?|\/[ \t]*(?:EA|PC|Each))|Per[ \t]*(?:Piece|Part|PC|EA)|Price\/EA|Price\/PC|\$\/(?:PC|EA|Part))[ \t]*:?[ \t]*\$?([\d,]+(?:\.\d{1,4})?)/i,
    // "$X.XX / EA" explicit per-unit denominator
    /\$[ \t]*([\d,]+\.\d{2})[ \t]*(?:\/[ \t]*(?:PC|EA|each|piece|part))\b/i,
  ]);
  if (price) {
    const p = parseFloat(price.value.replace(/,/g, ''));
    if (!isNaN(p) && p > 0 && p < 100_000) {
      fields.pricePerPart = p;
      sources.pricePerPart = price.snippet;
    }
  } else if (fields.quantity) {
    // Line-item heuristic: find all dollar amounts, unit price × qty ≈ extended price
    // Pick the amount that satisfies unit * qty ≈ another amount on the same line
    const allAmounts = [...text.matchAll(/\$\s*([\d,]+\.\d{2})/g)]
      .map(m => parseFloat(m[1].replace(/,/g, '')))
      .filter(n => n > 0 && n < 100_000);
    const qty = fields.quantity;
    // Look for a pair (unit, ext) where unit * qty is close to ext (within 5%)
    for (const unit of allAmounts) {
      const ext = allAmounts.find(e => e !== unit && Math.abs(e - unit * qty) / e < 0.05);
      if (ext) { fields.pricePerPart = unit; sources.pricePerPart = `$${unit}`; break; }
    }
    // Fallback: just the smallest dollar amount if only one found
    if (!fields.pricePerPart && allAmounts.length === 1) {
      fields.pricePerPart = allAmounts[0];
      sources.pricePerPart = `$${allAmounts[0]}`;
    }
  }

  // ── Shipping Method ───────────────────────────────────────────────────────
  const ship = tryPatterns(text, [
    // Known carriers / methods first — highest confidence, no false grabs
    /\b(UPS(?:[ \t]*Ground| Next[ \t]*Day)?|FED[ \t]*EX|FedEx|DHL|USPS|OnTrac|Old[ \t]*Dominion|Will[ \t]*Call|Customer[ \t]*Pick[ \t]*-?[ \t]*Up|Pick[ \t]*-?[ \t]*Up|Pickup|LTL|Freight|Common[ \t]*Carrier|Best[ \t]*Way|Our[ \t]*Truck|Your[ \t]*Truck)\b/i,
    /\bShip(?:ping)?[ \t]*(?:Via|Method|By|Mode)?[ \t]*:?[ \t]*([A-Za-z][A-Za-z0-9 &\-\.]{2,40})/i,
    /\bShip[ \t]*Via[ \t]+([\w][A-Za-z0-9 &\-\.]{2,40})/i,
  ]);
  if (ship) {
    const v = ship.value.trim().replace(/\s+/g, ' ');
    // Exclude date-like values that sneak in
    if (!/^\d/.test(v) && v.length >= 3) {
      (fields as any).shippingMethod = v;
      sources.shippingMethod = ship.snippet;
    }
  }

  // ── Special Instructions / Notes ─────────────────────────────────────────
  // Capture MULTI-LINE instruction blocks — stop only at clearly new section headers.
  // Priority: "INSTRUCTIONS:" > "Special Instructions" > "Notes:" > fallbacks.
  // Reject URL-containing blocks (legal boilerplate).
  const SECTION_STOP = /\n(?:P\.?O\.?\s*QUALITY|CONFIRMATION|TERMS|OUR CUSTOMER|SUBTOTAL|ORDER TOTAL|ISSUED BY|Signature|Page \d)/i;

  const instrREs: [RegExp, RegExp][] = [
    // Pattern to find the label, then a stop pattern to end the block
    [/\bINSTRUCTIONS\s*:\s*/i,           SECTION_STOP],
    [/\bSpecial\s+Inst(?:ructions?)?\s*:\s*/i, SECTION_STOP],
    [/\bSpecial\s+Notes?\s*:\s*/i,       SECTION_STOP],
    [/\bInstr(?:uctions?)?\s*:\s*/i,     SECTION_STOP],
    [/\bNotes?\s*:\s*/i,                 SECTION_STOP],
    [/\bRemarks?\s*:\s*/i,               SECTION_STOP],
    [/\bComments?\s*:\s*/i,              SECTION_STOP],
  ];

  for (const [labelRe] of instrREs) {
    const start = text.search(labelRe);
    if (start === -1) continue;
    // Find end of label
    const labelMatch = text.slice(start).match(labelRe)!;
    const contentStart = start + labelMatch[0].length;
    // Find next section stop after the label
    const rest = text.slice(contentStart);
    const stopMatch = rest.search(SECTION_STOP);
    const block = (stopMatch === -1 ? rest : rest.slice(0, stopMatch)).trim();
    if (block.length < 5) continue;
    // Reject if the WHOLE block is dominated by a URL
    if (/https?:\/\//i.test(block) && block.split(' ').filter(w => w.startsWith('http')).length > 1) continue;
    // Trim trailing URLs / "Please visit..." sentences
    const cleaned = block
      .replace(/\s*(Please\s+visit\s+https?:\/\/\S+\s*)/gi, ' ')
      .replace(/\s*(For the latest.+?visit.+)/gi, '')
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (cleaned.length >= 5) {
      fields.specialInstructions = cleaned;
      sources.specialInstructions = cleaned.slice(0, 80);
      break;
    }
  }

  // ── Description fallbacks (when no INSTRUCTIONS/NOTES label found) ───────
  // Many POs put the description ON the line item, not under a separate label.
  // 1. Use the line-item description we captured during part-number extraction
  // 2. If still empty, look for "Description: ..." label
  // 3. Last resort: a 1-3 line paragraph block that's not boilerplate
  if (!fields.specialInstructions) {
    if (lineItemDescription && lineItemDescription.length >= 3) {
      const clean = lineItemDescription
        .replace(/\s{2,}/g, ' ')
        .replace(/[\.,;:\-]+$/, '')
        .trim();
      if (clean.length >= 3) {
        fields.specialInstructions = clean;
        sources.specialInstructions = clean.slice(0, 80);
      }
    }
  }
  if (!fields.specialInstructions) {
    // Explicit "Description:" label, sometimes used in lieu of "Notes:"
    const dm = text.match(/\b(?:Item[ \t]+)?Descr(?:iption)?[ \t]*:[ \t]*([^\n]{3,200})/i);
    if (dm) {
      const clean = dm[1].replace(/\s{2,}/g, ' ').replace(/\s+(Page \d.*|Subtotal.*|Total.*|\$[\d,.]+)$/i, '').trim();
      if (clean.length >= 3) {
        fields.specialInstructions = clean;
        sources.specialInstructions = clean.slice(0, 80);
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
 *  For camera photos: upscales to 2400px and boosts contrast + sharpness
 *  so Tesseract reads printed text on PO documents more reliably.
 */
function imageFileToJpeg(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const blobUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Size for OCR: shrink huge photos, but also UPSCALE small ones so tiny
      // printed PO numbers have enough pixels for Tesseract to resolve.
      const MAX = 2600, MIN = 1200;
      let { width: w, height: h } = img;
      const longEdge = Math.max(w, h), shortEdge = Math.min(w, h);
      let scale = 1;
      if (longEdge > MAX) scale = MAX / longEdge;
      else if (shortEdge < MIN) scale = Math.min(MIN / shortEdge, MAX / longEdge);
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));

      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      (ctx as any).imageSmoothingQuality = 'high';

      // White background (handles transparent PNGs)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      // ── OCR preprocessing ────────────────────────────────────────────────
      // 1) grayscale + contrast stretch, then 2) Bradley ADAPTIVE thresholding
      // to pure black/white. Adaptive (local) thresholding handles the uneven
      // lighting and shadows of phone photos far better than a global stretch —
      // the single biggest accuracy win for Tesseract on printed PO forms.
      try {
        const imageData = ctx.getImageData(0, 0, w, h);
        const d = imageData.data;
        const n = w * h;
        const gray = new Uint8ClampedArray(n);
        let minL = 255, maxL = 0;
        for (let i = 0, p = 0; i < d.length; i += 4, p++) {
          const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
          gray[p] = g;
          if (g < minL) minL = g;
          if (g > maxL) maxL = g;
        }
        const range = Math.max(1, maxL - minL);
        for (let p = 0; p < n; p++) gray[p] = (Math.min(255, Math.max(0, ((gray[p] - minL) / range) * 255))) | 0;

        // Integral image → O(1) window means for the adaptive threshold.
        const iw = w + 1;
        const integral = new Uint32Array(iw * (h + 1));
        for (let y = 0; y < h; y++) {
          let rowSum = 0;
          for (let x = 0; x < w; x++) {
            rowSum += gray[y * w + x];
            integral[(y + 1) * iw + (x + 1)] = integral[y * iw + (x + 1)] + rowSum;
          }
        }
        const S = Math.max(16, Math.min(64, Math.round(w / 16)));
        const half = S >> 1;
        const Tf = 0.85;   // ink if pixel < local mean * Tf
        let black = 0;
        for (let y = 0; y < h; y++) {
          const y1 = Math.max(0, y - half), y2 = Math.min(h - 1, y + half);
          for (let x = 0; x < w; x++) {
            const x1 = Math.max(0, x - half), x2 = Math.min(w - 1, x + half);
            const count = (x2 - x1 + 1) * (y2 - y1 + 1);
            const sum = integral[(y2 + 1) * iw + (x2 + 1)] - integral[y1 * iw + (x2 + 1)] - integral[(y2 + 1) * iw + x1] + integral[y1 * iw + x1];
            const p = y * w + x;
            const ink = gray[p] * count < sum * Tf;
            if (ink) black++;
            const di = p * 4; d[di] = d[di + 1] = d[di + 2] = ink ? 0 : 255;
          }
        }
        // Safety net: if thresholding blew out (nearly all white/black), the
        // params didn't suit this image — fall back to plain grayscale so we
        // never hand Tesseract a blank page.
        const ratio = black / n;
        if (ratio < 0.003 || ratio > 0.7) {
          for (let p = 0; p < n; p++) { const di = p * 4; d[di] = d[di + 1] = d[di + 2] = gray[p]; }
        }
        ctx.putImageData(imageData, 0, 0);
      } catch {
        // If pixel manipulation fails (e.g. cross-origin), keep original render
      }

      URL.revokeObjectURL(blobUrl);
      resolve(canvas.toDataURL('image/jpeg', 0.95));
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
  // Load the OCR libs on demand — first scan pays ~1s, every page load saves it.
  onProgress?.(2, 'Loading scanner…');
  await ensureOcrLibs();

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
    const recognize = async (psm: string): Promise<string> => {
      await worker.setParameters({
        tessedit_pageseg_mode: psm,
        tessedit_char_whitelist: '',
        preserve_interword_spaces: '1',
      });
      const { data } = await worker.recognize(jpegDataUrl);
      return (data?.text as string) || '';
    };

    // Bound each pass so a hung worker can't run forever (the UI overlay also
    // has its own 60s timeout; this kills the worker thread at the source).
    const withTimeout = <X>(p: Promise<X>, ms = 45000): Promise<X> =>
      Promise.race([p, new Promise<X>((_, rej) => setTimeout(() => rej(new Error('OCR timed out — try again')), ms))]);

    // Primary pass — PSM 6 (assume a uniform block of text). After adaptive
    // binarization this reads printed PO forms cleanly and keeps the line
    // structure our label-anchored regexes rely on.
    let result = parseJobFields(await withTimeout(recognize('6')));

    // If the PO number didn't come through (the field most likely to sit in a
    // boxed header), retry with PSM 4 (single column of variable-size text).
    // PSM 4 preserves reading order — unlike sparse PSM 11 — so our line-anchored
    // regexes still work. Merge: primary wins where both found something.
    if (!result.fields.poNumber || result.confidence < 60) {
      onProgress?.(92, 'Re-reading…');
      result = mergeScans(result, parseJobFields(await withTimeout(recognize('4'))));
    }
    onProgress?.(100, 'Done');
    return result;
  } finally {
    // Always runs — including when withTimeout rejects — so a hung recognize()
    // is aborted and the worker thread is freed (no accumulating OOM).
    await worker.terminate().catch(() => {});
  }
}

/** Merge two scan passes: the primary's fields win; the other fills the gaps. */
function mergeScans(primary: ScanResult, other: ScanResult): ScanResult {
  const fields = { ...other.fields, ...primary.fields };          // primary keys override
  const fieldSources = { ...other.fieldSources, ...primary.fieldSources };
  const rawText = [primary.rawText, other.rawText].filter(Boolean).join('\n');
  const keyFields = ['poNumber', 'partNumber', 'quantity', 'dueDate', 'customer'];
  const filled = keyFields.filter(k => k in fields).length;
  return { fields, rawText, confidence: Math.round((filled / keyFields.length) * 100), fieldSources };
}
