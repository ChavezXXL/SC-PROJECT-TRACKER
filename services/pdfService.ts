import type { Job, Quote, SystemSettings, PurchaseOrder } from '../types';
import type { PartHistory } from '../utils/partHistory';
import { printTraveler } from './travelerPrint';

// ── Shared PDF Utilities ──

/** Escape user-controlled text before it goes into the print HTML. */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Only allow http(s)/data:image logo URLs into <img src> — blocks javascript:
 *  and data:text/html smuggling. */
export function safeImgSrc(url?: string): string {
  if (!url) return '';
  const u = url.trim();
  return /^(https?:\/\/|data:image\/)/i.test(u) ? u : '';
}

/** The complete printable page. CSP neutralizes the document.write XSS sink:
 *  no script-src means inline <script>, inline event handlers (onerror=...)
 *  and javascript: URLs in any user field can't execute. Static print docs
 *  need no scripts — win.print() is invoked from the parent window. */
function docShell(html: string, title: string): string {
  return `<!DOCTYPE html><html><head><title>${esc(title)}</title>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http: blob:; style-src 'unsafe-inline'; font-src data: https:;">
    <style>
      @page { margin: 0.45in; size: letter portrait; }
      * { margin:0; padding:0; box-sizing:border-box; }
      html, body { height:auto !important; }
      body { font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif; color:#1a1a2e; background:#fff; font-size:11.5px; line-height:1.35; }
      /* Block layout — NOT flex. Flex+margin-top:auto stretches the container to page
         height in Chrome print mode, forcing a 2nd/3rd/4th blank page. */
      .page { width:100%; padding:0; display:block; }
      /* Guard labelled blocks against splitting across pages */
      .info-grid, .client-block, .fields-grid, .special-block, .notes-block, .scope-block, .comments-block, .totals, .sig-section, tr { page-break-inside: avoid; break-inside: avoid; }
      img { max-width:100%; height:auto; }
      /* Header */
      .doc-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px; }
      .company-left { display:flex; flex-direction:column; }
      .company-logo { max-height:50px; max-width:180px; object-fit:contain; margin-bottom:4px; }
      .company-logo-center { display:block; margin:0 auto 8px auto; max-height:55px; max-width:200px; object-fit:contain; }
      .company-name { font-size:22px; font-weight:900; letter-spacing:0.5px; color:#1a1a2e; }
      .doc-type { font-size:20px; font-style:italic; font-weight:600; color:#374151; }
      /* Info rows */
      .info-grid { display:grid; grid-template-columns:1fr 1fr; border:1px solid #d1d5db; border-radius:4px; margin-bottom:10px; }
      .info-left, .info-right { padding:8px 12px; }
      .info-left { border-right:1px solid #d1d5db; }
      .info-row { display:flex; margin-bottom:3px; }
      .info-label { font-weight:700; color:#2563eb; min-width:100px; font-size:11px; }
      .info-value { font-size:11px; color:#1a1a2e; }
      .info-right-text { font-size:11px; color:#374151; line-height:1.5; text-align:right; }
      /* Client block */
      .client-block { border:1px solid #d1d5db; border-radius:4px; padding:7px 12px; margin-bottom:10px; }
      .client-label { font-weight:700; color:#2563eb; font-size:10px; margin-bottom:3px; }
      .client-name { font-size:13px; font-weight:700; color:#1a1a2e; }
      .client-detail { font-size:10px; color:#374151; line-height:1.4; }
      /* Project fields */
      .fields-grid { border:1px solid #d1d5db; border-radius:4px; margin-bottom:10px; }
      .field-row { display:flex; border-bottom:1px solid #e5e7eb; }
      .field-row:last-child { border-bottom:none; }
      .field-label { font-weight:700; color:#2563eb; font-size:10px; padding:5px 12px; min-width:130px; background:#f9fafb; border-right:1px solid #e5e7eb; }
      .field-value { font-size:10px; padding:5px 12px; flex:1; }
      /* Table */
      table { width:100%; border-collapse:collapse; margin-bottom:10px; }
      thead th { text-align:left; padding:6px 8px; font-size:10px; font-weight:700; color:#2563eb; border-bottom:2px solid #2563eb; border-top:1px solid #d1d5db; }
      thead th.right { text-align:right; }
      thead th.center { text-align:center; }
      tbody td { padding:5px 8px; border-bottom:1px solid #e5e7eb; font-size:10px; }
      tbody td.right { text-align:right; }
      tbody td.center { text-align:center; }
      tbody td.bold { font-weight:700; }
      tbody tr:last-child td { border-bottom:2px solid #d1d5db; }
      /* Totals */
      .totals-wrap { display:flex; justify-content:flex-end; margin-bottom:10px; }
      .totals { width:260px; }
      .total-row { display:flex; justify-content:space-between; padding:4px 0; font-size:11px; }
      .total-row.grand { border-top:2px solid #1a1a2e; margin-top:3px; padding-top:7px; font-size:14px; font-weight:900; }
      .total-label { color:#6b7280; }
      .total-value { font-weight:600; }
      .total-row.discount .total-value { color:#dc2626; }
      .total-row.deposit { color:#0891b2; font-weight:700; }
      /* Comments */
      .comments-block { border:1px solid #d1d5db; border-radius:4px; padding:7px 12px; margin-bottom:10px; }
      .comments-label { font-weight:700; color:#2563eb; font-size:10px; margin-bottom:3px; }
      .comments-text { font-size:10px; color:#374151; line-height:1.5; white-space:pre-wrap; }
      /* Scope */
      .scope-block { border:1px solid #bae6fd; border-radius:4px; padding:7px 12px; margin-bottom:10px; background:#f0f9ff; }
      .scope-label { font-weight:700; color:#0369a1; font-size:10px; margin-bottom:3px; }
      .scope-text { font-size:10px; color:#0c4a6e; line-height:1.5; }
      /* Signature — NEVER use margin-top:auto (causes flex stretching in print) */
      .sig-section { margin-top:18px; padding-top:0; display:flex; gap:50px; }
      .sig-block { flex:1; }
      .sig-line { border-top:1px solid #1a1a2e; padding-top:5px; font-size:9px; color:#6b7280; }
      .sig-company { font-size:10px; color:#2563eb; font-weight:600; margin-bottom:20px; }
      /* Footer */
      .doc-footer { margin-top:12px; padding-top:6px; border-top:1px solid #e5e7eb; text-align:center; font-size:9px; color:#9ca3af; }
      .page-num { text-align:center; font-size:9px; color:#2563eb; margin-top:6px; }
      /* Special instructions */
      .special-block { border:1px solid #fde68a; border-radius:4px; padding:7px 12px; margin-bottom:10px; background:#fffbeb; }
      .special-label { font-weight:700; color:#92400e; font-size:10px; margin-bottom:3px; }
      .special-text { font-size:10px; color:#451a03; line-height:1.5; }
      /* Notes */
      .notes-block { border:1px solid #e5e7eb; border-radius:4px; padding:7px 12px; margin-bottom:10px; background:#f9fafb; }
      .notes-label { font-weight:700; color:#6b7280; font-size:10px; margin-bottom:3px; }
      .notes-text { font-size:10px; color:#374151; line-height:1.5; }
      /* Badge */
      .status-badge { display:inline-block; padding:2px 8px; border-radius:4px; font-size:9px; font-weight:700; text-transform:uppercase; }
      /* Print — enforce block layout so no flex auto-margin page stretching */
      @media print {
        html, body { height:auto !important; padding:0; margin:0; }
        .page { display:block !important; padding:0; }
        .sig-section { margin-top:16px !important; }
      }
    </style>
  </head><body>${html}</body></html>`;
}

function openPrintWindow(html: string, title: string) {
  const win = window.open('', '_blank', 'width=850,height=1100');
  if (!win) return;
  win.document.write(docShell(html, title));
  win.document.close();
  setTimeout(() => { win.print(); }, 400);
}

function formatDate(ts?: number | string): string {
  if (!ts) return new Date().toLocaleDateString('en-US', { month:'2-digit', day:'2-digit', year:'numeric' });
  if (typeof ts === 'number') {
    return new Date(ts).toLocaleDateString('en-US', { month:'2-digit', day:'2-digit', year:'numeric' });
  }
  // MM/DD/YYYY already in correct format — return as-is
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(ts)) return ts;
  // ISO YYYY-MM-DD → reformat
  const iso = ts.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
  // Fallback: let Date() try (works for ISO datetime strings with time component)
  const d = new Date(ts);
  return isNaN(d.getTime())
    ? ts  // last resort: return the raw string rather than "Invalid Date"
    : d.toLocaleDateString('en-US', { month:'2-digit', day:'2-digit', year:'numeric' });
}

/** Escaped, keeping line breaks (addresses, descriptions). */
function escLines(v: unknown): string {
  return esc(v).replace(/\r?\n/g, '<br/>');
}

/** Money with 2 decimals — a missing number prints $0.00 instead of crashing the print. */
function money(n: unknown): string {
  return (Number(n) || 0).toFixed(2);
}

// Settings → Documents, applied to quotes and invoices. These switches used
// to change only the preview inside Settings — the printed PDF ignored them.
function docOptions(settings: SystemSettings) {
  return {
    accent: /^#[0-9a-f]{3,8}$/i.test(settings.accentColor || '') ? settings.accentColor! : '#2563eb',
    qty: settings.showQtyCol !== false,
    unit: settings.showUnitCol !== false,
    rate: settings.showRateCol !== false,
    terms: settings.showTermsOnDocs !== false,
    validUntil: settings.showDueDateOnDocs !== false,
    signatures: settings.showSignatureLines !== false,
    watermark: (settings.watermark || '').trim().slice(0, 24),
  };
}
type DocOptions = ReturnType<typeof docOptions>;

function docTheme(o: DocOptions): string {
  return `<style>
      .info-label, .client-label, .field-label, .comments-label, .sig-company, .page-num, thead th { color:${o.accent}; }
      thead th { border-bottom-color:${o.accent}; }
    </style>
    ${o.watermark ? `<div aria-hidden="true" style="position:fixed;top:42%;left:-10%;right:-10%;z-index:-1;text-align:center;font-size:110px;font-weight:900;letter-spacing:10px;color:rgba(0,0,0,0.07);transform:rotate(-30deg)">${esc(o.watermark)}</div>` : ''}`;
}

function docHeader(settings: SystemSettings, docType: string): string {
  const logo = safeImgSrc(settings.companyLogo);
  return `${logo ? `<img src="${esc(logo)}" class="company-logo-center" />` : ''}
    <div class="doc-header">
      <div class="company-left">
        <div class="company-name">${esc(settings.companyName || 'Company Name')}</div>
      </div>
      <div class="doc-type">${docType}</div>
    </div>`;
}

function companyContact(settings: SystemSettings, withEmail = false): string {
  return [
    settings.companyAddress ? escLines(settings.companyAddress) : '',
    settings.companyPhone ? esc(settings.companyPhone) : '',
    withEmail && settings.companyEmail ? esc(settings.companyEmail) : '',
  ].filter(Boolean).join('<br/>');
}

function contactBlock(label: string, name: unknown, lines: unknown[]): string {
  return `<div class="client-block">
        <div class="client-label">${label}</div>
        <div class="client-name">${esc(name)}</div>
        ${lines.filter(Boolean).map(l => `<div class="client-detail">${escLines(l)}</div>`).join('')}
      </div>`;
}

function projectFieldsBlock(fields: [string, unknown][]): string {
  return fields.length > 0 ? `<div class="fields-grid">
      ${fields.map(([k, v]) => `<div class="field-row"><div class="field-label">${esc(k)}</div><div class="field-value">${esc(v)}</div></div>`).join('')}
    </div>` : '';
}

function lineItemsTable(items: Quote['items'], o: DocOptions): string {
  return `<table>
      <thead>
        <tr><th>Description</th>${o.qty ? '<th class="center">Qty</th>' : ''}${o.unit ? '<th class="center">Unit</th>' : ''}${o.rate ? '<th class="right">Rate</th>' : ''}<th class="right">Amount</th></tr>
      </thead>
      <tbody>
        ${items.map(item => `<tr>
          <td>${escLines(item.description)}</td>
          ${o.qty ? `<td class="center">${esc(item.qty)}</td>` : ''}
          ${o.unit ? `<td class="center">${esc(item.unit || 'ea')}</td>` : ''}
          ${o.rate ? `<td class="right">$${money(item.unitPrice)}</td>` : ''}
          <td class="right bold">$${money(item.total)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function quoteTotals(quote: Quote, grandLabel: string, withDeposit: boolean): string {
  return `<div class="totals-wrap">
      <div class="totals">
        <div class="total-row"><span class="total-label">Subtotal</span><span class="total-value">$${money(quote.subtotal)}</span></div>
        ${quote.markupPct ? `<div class="total-row"><span class="total-label">Markup (${esc(quote.markupPct)}%)</span><span class="total-value">+$${money(quote.subtotal * quote.markupPct / 100)}</span></div>` : ''}
        ${quote.discountAmt ? `<div class="total-row discount"><span class="total-label">Discount (${esc(quote.discountPct || 0)}%)</span><span class="total-value">-$${money(quote.discountAmt)}</span></div>` : ''}
        ${quote.taxAmt ? `<div class="total-row"><span class="total-label">Tax (${esc(quote.taxRate || 0)}%)</span><span class="total-value">+$${money(quote.taxAmt)}</span></div>` : ''}
        <div class="total-row grand"><span>${grandLabel}</span><span>$${money(quote.total)}</span></div>
        ${withDeposit && quote.depositRequired && quote.depositAmt ? `<div class="total-row deposit"><span>Deposit Due (${esc(quote.depositPct || 50)}%)</span><span>$${money(quote.depositAmt)}</span></div>` : ''}
      </div>
    </div>`;
}

function signatureLines(signer: unknown, otherParty: string, otherLine: string): string {
  return `<div class="sig-section">
      <div class="sig-block">
        <div class="sig-company">${esc(signer)}</div>
        <div class="sig-line">Authorized Signature</div>
      </div>
      <div class="sig-block">
        <div class="sig-company">${esc(otherParty)}</div>
        <div class="sig-line">${esc(otherLine)}</div>
      </div>
    </div>`;
}

// ── Quote PDF ──

export function quoteHtml(quote: Quote, settings: SystemSettings): string {
  const o = docOptions(settings);
  const projectFields = quote.projectFields ? Object.entries(quote.projectFields).filter(([, v]) => v) : [];

  const html = `${docTheme(o)}<div class="page">
    ${docHeader(settings, 'Quote')}

    <div class="info-grid">
      <div class="info-left">
        <div class="info-row"><span class="info-label">Quote No:</span><span class="info-value">${esc(quote.quoteNumber)}</span></div>
        <div class="info-row"><span class="info-label">Date:</span><span class="info-value">${esc(formatDate(quote.createdAt))}</span></div>
        ${o.validUntil && quote.validUntil ? `<div class="info-row"><span class="info-label">Valid Until:</span><span class="info-value">${esc(formatDate(quote.validUntil))}</span></div>` : ''}
        <div class="info-row"><span class="info-label">Status:</span><span class="info-value">${esc(String(quote.status || '').toUpperCase())}</span></div>
      </div>
      <div class="info-right">
        <div class="info-right-text">${companyContact(settings)}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:${quote.shipTo?.name ? '1fr 1fr' : '1fr'};gap:12px;margin-bottom:16px">
      ${contactBlock('Bill To', quote.billTo?.name || quote.customer, [quote.billTo?.contactPerson, quote.billTo?.email, quote.billTo?.phone, quote.billTo?.address])}
      ${quote.shipTo?.name ? contactBlock('Ship To', quote.shipTo.name, [quote.shipTo.contactPerson, quote.shipTo.address, quote.shipTo.phone]) : ''}
    </div>

    ${projectFieldsBlock(projectFields)}

    ${quote.jobDescription ? `<div class="scope-block"><div class="scope-label">Scope of Work</div><div class="scope-text">${escLines(quote.jobDescription)}</div></div>` : ''}

    ${lineItemsTable(quote.items, o)}

    ${quoteTotals(quote, 'Total', true)}

    ${quote.notes ? `<div class="comments-block"><div class="comments-label">Comments</div><div class="comments-text">${esc(quote.notes)}</div></div>` : ''}
    ${o.terms && quote.terms ? `<div class="comments-block"><div class="comments-label">Terms & Conditions</div><div class="comments-text">${esc(quote.terms)}</div></div>` : ''}

    ${o.signatures ? signatureLines(settings.companyName || 'Company', "Client's signature", 'Acceptance Signature') : ''}

    <div class="page-num">1 / 1</div>
  </div>`;
  return html;
}

export function printQuotePDF(quote: Quote, settings: SystemSettings) {
  openPrintWindow(quoteHtml(quote, settings), `Quote ${quote.quoteNumber}`);
}

/** The exact page a quote prints as — Settings → Documents shows this as its preview. */
export function quoteDocument(quote: Quote, settings: SystemSettings): string {
  return docShell(quoteHtml(quote, settings), `Quote ${quote.quoteNumber}`);
}

// ── Packing Slip PDF ──

export function packingSlipHtml(job: Job, settings: SystemSettings): string {
  const coc = 'CERTIFICATE OF CONFORMANCE: This is to certify that all processes conform to applicable Specifications, Drawings, Contracts, and/or Order Requirements unless otherwise specified.';
  const html = `<div class="page">
    ${docHeader(settings, 'Packing Slip')}

    <div class="info-grid">
      <div class="info-left">
        <div class="info-row"><span class="info-label">Invoice No:</span><span class="info-value">${esc(job.jobIdsDisplay || job.id.slice(-8))}</span></div>
        <div class="info-row"><span class="info-label">Date:</span><span class="info-value">${esc(formatDate(job.shippedAt || Date.now()))}</span></div>
      </div>
      <div class="info-right">
        <div class="info-right-text">${companyContact(settings)}</div>
      </div>
    </div>

    <div class="client-block">
      <div class="client-label">Client</div>
      <div class="client-name">${esc(job.customer || 'Customer')}</div>
    </div>

    <div class="fields-grid">
      <div class="field-row"><div class="field-label">Purchase Order</div><div class="field-value">${esc(job.poNumber)}</div></div>
      <div class="field-row"><div class="field-label">Part No.</div><div class="field-value">${esc(job.partNumber)}</div></div>
      <div class="field-row"><div class="field-label">Job No.</div><div class="field-value">${esc(job.jobIdsDisplay || '')}</div></div>
      ${job.shippingMethod ? `<div class="field-row"><div class="field-label">Ship Method</div><div class="field-value">${esc(job.shippingMethod)}</div></div>` : ''}
      ${job.trackingNumber ? `<div class="field-row"><div class="field-label">Tracking No.</div><div class="field-value">${esc(job.trackingNumber)}</div></div>` : ''}
    </div>

    <table>
      <thead>
        <tr><th>Description</th><th class="right">Quantity</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>${escLines(job.info || job.partNumber)}<br/><span style="font-size:10px;color:#6b7280">${job.specialInstructions ? 'DEBURR COMPLETE PER PO' : ''}</span></td>
          <td class="right bold">${esc(job.quantity)}</td>
        </tr>
      </tbody>
    </table>

    <div class="comments-block">
      <div class="comments-label">Comments</div>
      <div class="comments-text">${coc}${job.specialInstructions ? '\n\n' + esc(job.specialInstructions) : ''}</div>
    </div>

    ${job.shippingNotes ? `<div class="notes-block"><div class="notes-label">Shipping Notes</div><div class="notes-text">${escLines(job.shippingNotes)}</div></div>` : ''}

    ${signatureLines(settings.companyName || 'Company', "Client's signature", 'Acceptance Signature')}

    <div class="page-num">1 / 1</div>
  </div>`;
  return html;
}

export function printPackingSlipPDF(job: Job, settings: SystemSettings) {
  openPrintWindow(packingSlipHtml(job, settings), `Packing Slip - ${job.poNumber}`);
}

// ── Job Traveler PDF ──
// Thin wrapper — delegates entirely to travelerPrint.ts which is the single
// source of truth for traveler design. Both the Jobs-view "Print" button and
// the modal "Print Traveler" button now produce identical output.
// `history` is kept for compatibility but no longer the rate source.
// `rateBreakdown` (when provided) feeds the "Estimated Time by Operation"
// section on the traveler so the floor sees predicted cycle next to actual.
export function printJobTravelerPDF(
  job: Job,
  settings: SystemSettings,
  _history?: PartHistory | null,
  rateBreakdown?: import('./travelerPrint').TravelerOptions['_rateBreakdown']
): void {
  void printTraveler(job, settings, { _rateBreakdown: rateBreakdown ?? null });
}

// ── Invoice PDF ──

// ── Purchase Order PDF ──
// Prints the PO you send to vendors. Matches the same visual style as
// Quote / Invoice so the shop's documents look like a cohesive set.
// Includes PO-level QA requirements, instructions, terms, and attachment
// reference list (files are NOT embedded — vendor gets them as separate
// emails since blueprints can be 10+ MB each).
export function printPurchaseOrderPDF(po: PurchaseOrder, settings: SystemSettings) {
  const attachmentCount = (po.attachments?.length || 0)
    + po.items.reduce((a, i) => a + (i.attachments?.length || 0), 0);

  const html = `<div class="page">
    ${docHeader(settings, 'Purchase Order')}

    <div class="info-grid">
      <div class="info-left">
        <div class="info-row"><span class="info-label">PO Number:</span><span class="info-value" style="font-weight:700">${esc(po.poNumber)}</span></div>
        <div class="info-row"><span class="info-label">Ordered:</span><span class="info-value">${esc(formatDate(po.orderedDate))}</span></div>
        ${po.requiredDate ? `<div class="info-row"><span class="info-label">Required By:</span><span class="info-value" style="color:#dc2626;font-weight:700">${esc(po.requiredDate)}</span></div>` : ''}
        ${po.expectedDate ? `<div class="info-row"><span class="info-label">Expected:</span><span class="info-value">${esc(po.expectedDate)}</span></div>` : ''}
      </div>
      <div class="info-right">
        <div class="info-right-text">${companyContact(settings, true)}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
      ${contactBlock('Vendor', po.vendorName, [po.vendorContact?.name, po.vendorContact?.email, po.vendorContact?.phone, po.vendorContact?.address])}
      ${po.billTo ? contactBlock('Bill To / Ship To', po.billTo.name, [po.billTo.address, po.billTo.phone]) : ''}
    </div>

    ${po.qualityRequirements && po.qualityRequirements.length > 0 ? `
    <div class="special-block" style="border-color:#10b981;background:#f0fdf4">
      <div class="special-label" style="color:#065f46">✓ Quality Requirements</div>
      <div class="special-text" style="color:#064e3b">${po.qualityRequirements.map(r => `• ${esc(r)}`).join(' &nbsp; ')}</div>
    </div>` : ''}

    ${po.instructions ? `<div class="notes-block"><div class="notes-label">Special Instructions</div><div class="notes-text">${escLines(po.instructions)}</div></div>` : ''}

    <table>
      <thead>
        <tr>
          <th style="width:30px">#</th>
          <th>Description</th>
          <th style="width:80px">Part #</th>
          <th class="center" style="width:50px">Qty</th>
          <th class="center" style="width:40px">Unit</th>
          <th class="right" style="width:70px">Price</th>
          <th class="right" style="width:80px">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${po.items.map((item, i) => `<tr>
          <td style="text-align:center;color:#6b7280">${i + 1}</td>
          <td>
            <strong>${escLines(item.description)}</strong>
            ${item.instructions ? `<div style="font-size:10px;color:#6b7280;margin-top:2px;font-style:italic">${escLines(item.instructions)}</div>` : ''}
            ${item.qualityReqs && item.qualityReqs.length > 0 ? `<div style="font-size:9px;color:#059669;margin-top:2px">✓ ${item.qualityReqs.map(r => esc(r)).join(' · ')}</div>` : ''}
            ${item.attachments && item.attachments.length > 0 ? `<div style="font-size:9px;color:#2563eb;margin-top:2px">📎 ${item.attachments.length} file${item.attachments.length !== 1 ? 's' : ''} attached</div>` : ''}
          </td>
          <td style="font-size:10px;color:#374151">${esc(item.partNumber || '—')}</td>
          <td class="center">${esc(item.quantity)}</td>
          <td class="center">${esc(item.unit || 'ea')}</td>
          <td class="right">$${money(item.unitPrice)}</td>
          <td class="right bold">$${money(item.total)}</td>
        </tr>`).join('')}
      </tbody>
    </table>

    <div class="totals-wrap">
      <div class="totals">
        <div class="total-row"><span class="total-label">Subtotal</span><span class="total-value">$${money(po.subtotal)}</span></div>
        ${po.taxAmt ? `<div class="total-row"><span class="total-label">Tax (${(po.taxRate || 0).toFixed(1)}%)</span><span class="total-value">$${money(po.taxAmt)}</span></div>` : ''}
        ${po.shippingAmt ? `<div class="total-row"><span class="total-label">Shipping</span><span class="total-value">$${money(po.shippingAmt)}</span></div>` : ''}
        <div class="total-row grand"><span>Total</span><span>$${money(po.total)}</span></div>
      </div>
    </div>

    ${po.terms ? `<div class="comments-block"><div class="comments-label">Terms & Conditions</div><div class="comments-text">${esc(po.terms)}</div></div>` : ''}

    ${attachmentCount > 0 ? `<div class="notes-block" style="background:#eff6ff;border-color:#bfdbfe"><div class="notes-label" style="color:#1e40af">📎 Attachments</div><div class="notes-text" style="color:#1e3a8a">This PO references ${attachmentCount} attached file${attachmentCount !== 1 ? 's' : ''}. See accompanying email or file transfer for drawings / specs.</div></div>` : ''}

    <div class="sig-section">
      <div class="sig-block">
        <div class="sig-company">${esc(settings.companyName || 'Purchaser')}</div>
        <div class="sig-line">Authorized By${po.approvedByName ? ` — ${esc(po.approvedByName)}` : ''}</div>
      </div>
      <div class="sig-block">
        <div class="sig-company">${esc(po.vendorName)}</div>
        <div class="sig-line">Vendor Acknowledgment</div>
      </div>
    </div>

    <div class="page-num">PO ${esc(po.poNumber)} · 1 / 1</div>
  </div>`;
  openPrintWindow(html, `PO ${po.poNumber}`);
}

export function invoiceHtml(quote: Quote, job: Job | null, settings: SystemSettings): string {
  const o = docOptions(settings);
  const projectFields = quote.projectFields ? Object.entries(quote.projectFields).filter(([, v]) => v) : [];

  const html = `${docTheme(o)}<div class="page">
    ${docHeader(settings, 'Invoice')}

    <div class="info-grid">
      <div class="info-left">
        <div class="info-row"><span class="info-label">Invoice No:</span><span class="info-value">${esc(quote.quoteNumber)}</span></div>
        <div class="info-row"><span class="info-label">Date:</span><span class="info-value">${esc(formatDate(Date.now()))}</span></div>
        ${job ? `<div class="info-row"><span class="info-label">PO Number:</span><span class="info-value">${esc(job.poNumber)}</span></div>` : ''}
      </div>
      <div class="info-right">
        <div class="info-right-text">${companyContact(settings)}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:${quote.shipTo?.name ? '1fr 1fr' : '1fr'};gap:12px;margin-bottom:16px">
      ${contactBlock('Bill To', quote.billTo?.name || quote.customer, [quote.billTo?.contactPerson, quote.billTo?.email, quote.billTo?.phone, quote.billTo?.address])}
      ${quote.shipTo?.name ? contactBlock('Ship To', quote.shipTo.name, [quote.shipTo.contactPerson, quote.shipTo.address]) : ''}
    </div>

    ${projectFieldsBlock(projectFields)}

    ${lineItemsTable(quote.items, o)}

    ${quoteTotals(quote, 'Amount Due', false)}

    ${quote.notes ? `<div class="comments-block"><div class="comments-label">Comments</div><div class="comments-text">${esc(quote.notes)}</div></div>` : ''}
    ${o.terms && quote.terms ? `<div class="comments-block"><div class="comments-label">Terms & Conditions</div><div class="comments-text">${esc(quote.terms)}</div></div>` : ''}

    ${o.signatures ? signatureLines(settings.companyName || 'Company', "Client's signature", 'Acceptance Signature') : ''}

    <div class="page-num">1 / 1</div>
  </div>`;
  return html;
}

export function printInvoicePDF(quote: Quote, job: Job | null, settings: SystemSettings) {
  openPrintWindow(invoiceHtml(quote, job, settings), `Invoice - ${quote.quoteNumber}`);
}
