import type { Job, Quote, SystemSettings, PurchaseOrder } from '../types';

// ── Shared PDF Utilities ──

function openPrintWindow(html: string, title: string) {
  const win = window.open('', '_blank', 'width=850,height=1100');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
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
  </head><body>${html}</body></html>`);
  win.document.close();
  setTimeout(() => { win.print(); }, 400);
}

function formatDate(ts?: number | string): string {
  if (!ts) return new Date().toLocaleDateString('en-US', { month:'2-digit', day:'2-digit', year:'numeric' });
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts);
  return d.toLocaleDateString('en-US', { month:'2-digit', day:'2-digit', year:'numeric' });
}

// ── Quote PDF ──

export function printQuotePDF(quote: Quote, settings: SystemSettings) {
  const projectFields = quote.projectFields ? Object.entries(quote.projectFields).filter(([,v]) => v) : [];

  const html = `<div class="page">
    ${settings.companyLogo ? `<img src="${settings.companyLogo}" class="company-logo-center" />` : ''}

    <div class="doc-header">
      <div class="company-left">
        <div class="company-name">${settings.companyName || 'Company Name'}</div>
      </div>
      <div class="doc-type">Quote</div>
    </div>

    <div class="info-grid">
      <div class="info-left">
        <div class="info-row"><span class="info-label">Quote No:</span><span class="info-value">${quote.quoteNumber}</span></div>
        <div class="info-row"><span class="info-label">Date:</span><span class="info-value">${formatDate(quote.createdAt)}</span></div>
        ${quote.validUntil ? `<div class="info-row"><span class="info-label">Valid Until:</span><span class="info-value">${quote.validUntil}</span></div>` : ''}
        <div class="info-row"><span class="info-label">Status:</span><span class="info-value">${quote.status.toUpperCase()}</span></div>
      </div>
      <div class="info-right">
        <div class="info-right-text">
          ${settings.companyAddress || ''}<br/>
          ${settings.companyPhone ? settings.companyPhone + '<br/>' : ''}
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:${quote.shipTo?.name ? '1fr 1fr' : '1fr'};gap:12px;margin-bottom:16px">
      <div class="client-block">
        <div class="client-label">Bill To</div>
        <div class="client-name">${quote.billTo?.name || quote.customer}</div>
        ${quote.billTo?.contactPerson ? `<div class="client-detail">${quote.billTo.contactPerson}</div>` : ''}
        ${quote.billTo?.email ? `<div class="client-detail">${quote.billTo.email}</div>` : ''}
        ${quote.billTo?.phone ? `<div class="client-detail">${quote.billTo.phone}</div>` : ''}
        ${quote.billTo?.address ? `<div class="client-detail">${quote.billTo.address}</div>` : ''}
      </div>
      ${quote.shipTo?.name ? `<div class="client-block">
        <div class="client-label">Ship To</div>
        <div class="client-name">${quote.shipTo.name}</div>
        ${quote.shipTo.contactPerson ? `<div class="client-detail">${quote.shipTo.contactPerson}</div>` : ''}
        ${quote.shipTo.address ? `<div class="client-detail">${quote.shipTo.address}</div>` : ''}
        ${quote.shipTo.phone ? `<div class="client-detail">${quote.shipTo.phone}</div>` : ''}
      </div>` : ''}
    </div>

    ${projectFields.length > 0 ? `<div class="fields-grid">
      ${projectFields.map(([k, v]) => `<div class="field-row"><div class="field-label">${k}</div><div class="field-value">${v}</div></div>`).join('')}
    </div>` : ''}

    ${quote.jobDescription ? `<div class="scope-block"><div class="scope-label">Scope of Work</div><div class="scope-text">${quote.jobDescription}</div></div>` : ''}

    <table>
      <thead>
        <tr><th>Description</th><th class="center">Qty</th><th class="center">Unit</th><th class="right">Rate</th><th class="right">Amount</th></tr>
      </thead>
      <tbody>
        ${quote.items.map(item => `<tr>
          <td>${item.description}</td>
          <td class="center">${item.qty}</td>
          <td class="center">${item.unit || 'ea'}</td>
          <td class="right">$${item.unitPrice.toFixed(2)}</td>
          <td class="right bold">$${item.total.toFixed(2)}</td>
        </tr>`).join('')}
      </tbody>
    </table>

    <div class="totals-wrap">
      <div class="totals">
        <div class="total-row"><span class="total-label">Subtotal</span><span class="total-value">$${quote.subtotal.toFixed(2)}</span></div>
        ${quote.markupPct ? `<div class="total-row"><span class="total-label">Markup (${quote.markupPct}%)</span><span class="total-value">+$${(quote.subtotal * quote.markupPct / 100).toFixed(2)}</span></div>` : ''}
        ${quote.discountAmt ? `<div class="total-row discount"><span class="total-label">Discount (${quote.discountPct || 0}%)</span><span class="total-value">-$${quote.discountAmt.toFixed(2)}</span></div>` : ''}
        ${quote.taxAmt ? `<div class="total-row"><span class="total-label">Tax (${quote.taxRate || 0}%)</span><span class="total-value">+$${quote.taxAmt.toFixed(2)}</span></div>` : ''}
        <div class="total-row grand"><span>Total</span><span>$${quote.total.toFixed(2)}</span></div>
        ${quote.depositRequired && quote.depositAmt ? `<div class="total-row deposit"><span>Deposit Due (${quote.depositPct || 50}%)</span><span>$${quote.depositAmt.toFixed(2)}</span></div>` : ''}
      </div>
    </div>

    ${quote.notes ? `<div class="comments-block"><div class="comments-label">Comments</div><div class="comments-text">${quote.notes}</div></div>` : ''}
    ${quote.terms ? `<div class="comments-block"><div class="comments-label">Terms & Conditions</div><div class="comments-text">${quote.terms}</div></div>` : ''}

    <div class="sig-section">
      <div class="sig-block">
        <div class="sig-company">${settings.companyName || 'Company'}</div>
        <div class="sig-line">Authorized Signature</div>
      </div>
      <div class="sig-block">
        <div class="sig-company">Client's signature</div>
        <div class="sig-line">Acceptance Signature</div>
      </div>
    </div>

    <div class="page-num">1 / 1</div>
  </div>`;
  openPrintWindow(html, `Quote ${quote.quoteNumber}`);
}

// ── Packing Slip PDF ──

export function printPackingSlipPDF(job: Job, settings: SystemSettings) {
  const html = `<div class="page">
    ${settings.companyLogo ? `<img src="${settings.companyLogo}" class="company-logo-center" />` : ''}

    <div class="doc-header">
      <div class="company-left">
        <div class="company-name">${settings.companyName || 'Company Name'}</div>
      </div>
      <div class="doc-type">Packing Slip</div>
    </div>

    <div class="info-grid">
      <div class="info-left">
        <div class="info-row"><span class="info-label">Invoice No:</span><span class="info-value">${job.jobIdsDisplay || job.id.slice(-8)}</span></div>
        <div class="info-row"><span class="info-label">Date:</span><span class="info-value">${formatDate(job.shippedAt || Date.now())}</span></div>
      </div>
      <div class="info-right">
        <div class="info-right-text">
          ${settings.companyAddress || ''}<br/>
          ${settings.companyPhone ? settings.companyPhone + '<br/>' : ''}
        </div>
      </div>
    </div>

    <div class="client-block">
      <div class="client-label">Client</div>
      <div class="client-name">${job.customer || 'Customer'}</div>
    </div>

    <div class="fields-grid">
      <div class="field-row"><div class="field-label">Purchase Order</div><div class="field-value">${job.poNumber}</div></div>
      <div class="field-row"><div class="field-label">Part No.</div><div class="field-value">${job.partNumber}</div></div>
      <div class="field-row"><div class="field-label">Job No.</div><div class="field-value">${job.jobIdsDisplay || ''}</div></div>
      ${job.shippingMethod ? `<div class="field-row"><div class="field-label">Ship Method</div><div class="field-value">${job.shippingMethod}</div></div>` : ''}
      ${job.trackingNumber ? `<div class="field-row"><div class="field-label">Tracking No.</div><div class="field-value">${job.trackingNumber}</div></div>` : ''}
    </div>

    <table>
      <thead>
        <tr><th>Description</th><th class="right">Quantity</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>${job.info || job.partNumber}<br/><span style="font-size:10px;color:#6b7280">${job.specialInstructions ? 'DEBURR COMPLETE PER PO' : ''}</span></td>
          <td class="right bold">${job.quantity}</td>
        </tr>
      </tbody>
    </table>

    ${(job.specialInstructions || job.info) ? `<div class="comments-block">
      <div class="comments-label">Comments</div>
      <div class="comments-text">CERTIFICATE OF CONFORMANCE: This is to certify that all processes conform to applicable Specifications, Drawings, Contracts, and/or Order Requirements unless otherwise specified.${job.specialInstructions ? '\n\n' + job.specialInstructions : ''}</div>
    </div>` : `<div class="comments-block">
      <div class="comments-label">Comments</div>
      <div class="comments-text">CERTIFICATE OF CONFORMANCE: This is to certify that all processes conform to applicable Specifications, Drawings, Contracts, and/or Order Requirements unless otherwise specified.</div>
    </div>`}

    ${job.shippingNotes ? `<div class="notes-block"><div class="notes-label">Shipping Notes</div><div class="notes-text">${job.shippingNotes}</div></div>` : ''}

    <div class="sig-section">
      <div class="sig-block">
        <div class="sig-company">${settings.companyName || 'Company'}</div>
        <div class="sig-line">Authorized Signature</div>
      </div>
      <div class="sig-block">
        <div class="sig-company">Client's signature</div>
        <div class="sig-line">Acceptance Signature</div>
      </div>
    </div>

    <div class="page-num">1 / 1</div>
  </div>`;
  openPrintWindow(html, `Packing Slip - ${job.poNumber}`);
}

// ── Job Traveler PDF ──
// Uses its OWN print window with standalone CSS — does NOT use openPrintWindow.
// Key guarantees:
//   • @page margin:0.5in (matches Chrome default so we never fight the browser)
//   • zoom:0.82 in @media print — Chrome scales layout for print, guaranteeing
//     single-page even on worst-case printer driver margin settings
//   • No external image requests (QR removed, replaced with large job number)
//   • No page-break-inside:avoid on <tr> — that rule was cascading the entire
//     table to page 2 if there wasn't enough room for ALL rows at once

export function printJobTravelerPDF(job: Job, settings: SystemSettings) {
  const priorityColor = job.priority === 'urgent' ? '#dc2626' : job.priority === 'high' ? '#ea580c' : '#374151';
  const win = window.open('', '_blank', 'width=860,height=1050');
  if (!win) return;

  win.document.write(`<!DOCTYPE html><html><head><title>Traveler - ${job.poNumber || ''}</title>
  <style>
    /* ─── PAGE SETUP ─── */
    @page { size: letter portrait; margin: 0.5in; }
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body { background:#fff; font-family:'Segoe UI',-apple-system,sans-serif; font-size:10px; color:#111; height:auto; }

    /* ─── PRINT: zoom scales the layout itself in Chrome/Edge ─── */
    @media print {
      html { zoom: 0.82; }
      body { height: auto !important; }
    }

    /* ─── LAYOUT HELPERS ─── */
    .wrap   { padding:0; }
    .row    { display:flex; align-items:stretch; }
    .grid4  { display:grid; grid-template-columns:repeat(4,1fr); }
    .grid3  { display:grid; grid-template-columns:repeat(3,1fr); }
    .cell   { border:1px solid #d1d5db; padding:5px 8px; }
    .cell + .cell { border-left:none; }
    .lbl    { font-size:8px; font-weight:700; color:#2563eb; text-transform:uppercase; letter-spacing:.04em; margin-bottom:2px; }
    .val    { font-size:11px; font-weight:700; color:#111; }
    .val.big{ font-size:16px; font-weight:900; color:#1d4ed8; }
    .val.red{ color:#dc2626; }

    /* ─── HEADER STRIP ─── */
    .hdr { display:flex; align-items:center; justify-content:space-between;
           border:2px solid #111; border-radius:3px; padding:6px 10px; margin-bottom:6px; }
    .hdr-left { display:flex; align-items:center; gap:10px; }
    .hdr-logo { max-height:38px; max-width:120px; object-fit:contain; }
    .hdr-co   { font-size:14px; font-weight:900; color:#111; letter-spacing:-.2px; }
    .hdr-title{ font-size:11px; font-weight:700; color:#6b7280; }
    .hdr-jobno{ text-align:right; }
    .hdr-jobno .lbl { font-size:8px; color:#2563eb; }
    .hdr-jobno .num { font-size:20px; font-weight:900; color:#111; letter-spacing:-.5px; }

    /* ─── INFO BAND ─── */
    .info-band { display:grid; grid-template-columns:2fr 1fr 1fr 1fr 1fr; border:1px solid #d1d5db; border-radius:3px; margin-bottom:6px; overflow:hidden; }
    .info-band .cell { border:none; border-right:1px solid #d1d5db; padding:5px 8px; }
    .info-band .cell:last-child { border-right:none; }

    /* ─── SPECIAL / NOTES ─── */
    .special { border:1.5px solid #fbbf24; border-radius:3px; padding:5px 8px; margin-bottom:6px; background:#fffbeb; }
    .special .lbl { color:#92400e; }
    .special .txt { font-size:10px; color:#451a03; line-height:1.4; }
    .notes   { border:1px solid #d1d5db; border-radius:3px; padding:5px 8px; margin-bottom:6px; background:#f9fafb; }
    .notes .txt  { font-size:10px; color:#374151; line-height:1.4; }

    /* ─── OPERATION LOG TABLE ─── */
    .op-title { font-size:9px; font-weight:700; color:#2563eb; text-transform:uppercase; letter-spacing:.08em; margin-bottom:4px; border-bottom:2px solid #2563eb; padding-bottom:2px; }
    table { width:100%; border-collapse:collapse; }
    thead th { font-size:8.5px; font-weight:700; color:#2563eb; text-align:left; padding:4px 6px; border-bottom:1.5px solid #2563eb; border-top:1px solid #d1d5db; background:#f8faff; white-space:nowrap; }
    tbody td { padding:0 6px; border-bottom:1px solid #e5e7eb; font-size:10px; height:24px; }
    tbody tr:last-child td { border-bottom:2px solid #d1d5db; }

    /* ─── FOOTER ─── */
    .footer { display:flex; justify-content:space-between; align-items:flex-end; margin-top:8px; padding-top:6px; border-top:1px solid #d1d5db; }
    .sig-line { flex:1; margin-right:40px; }
    .sig-name { font-size:9px; color:#2563eb; font-weight:700; margin-bottom:16px; }
    .sig-rule { border-top:1px solid #111; padding-top:3px; font-size:8px; color:#6b7280; }
    .coc { font-size:7.5px; color:#6b7280; max-width:320px; line-height:1.4; text-align:right; }
  </style>
  </head><body><div class="wrap">

  <!-- ── HEADER ── -->
  <div class="hdr">
    <div class="hdr-left">
      ${settings.companyLogo ? `<img class="hdr-logo" src="${settings.companyLogo}" />` : ''}
      <div>
        <div class="hdr-co">${settings.companyName || 'Company'}</div>
        <div class="hdr-title">Production Traveler</div>
      </div>
    </div>
    <div class="hdr-jobno">
      <div class="lbl">Job No.</div>
      <div class="num">${job.jobIdsDisplay || job.id.slice(-6)}</div>
    </div>
  </div>

  <!-- ── INFO BAND ── -->
  <div class="info-band">
    <div class="cell">
      <div class="lbl">Customer</div>
      <div class="val">${job.customer || '—'}</div>
    </div>
    <div class="cell">
      <div class="lbl">Purchase Order</div>
      <div class="val">${job.poNumber || '—'}</div>
    </div>
    <div class="cell">
      <div class="lbl">Part Number</div>
      <div class="val">${job.partNumber || '—'}</div>
    </div>
    <div class="cell">
      <div class="lbl">Quantity</div>
      <div class="val big">${job.quantity ?? '—'}</div>
    </div>
    <div class="cell">
      <div class="lbl">Due Date</div>
      <div class="val red">${job.dueDate || '—'}</div>
      ${job.dateReceived ? `<div style="font-size:8px;color:#6b7280;margin-top:2px">Recv: ${job.dateReceived}</div>` : ''}
      ${job.priority ? `<div style="font-size:8px;font-weight:700;text-transform:uppercase;color:${priorityColor};margin-top:2px">${job.priority}</div>` : ''}
    </div>
  </div>

  ${job.partImage ? `<div style="margin-bottom:6px"><img src="${job.partImage}" style="max-height:60px;max-width:120px;object-fit:contain;border:1px solid #e5e7eb;border-radius:3px" /></div>` : ''}

  <!-- ── SPECIAL INSTRUCTIONS ── -->
  ${job.specialInstructions ? `<div class="special"><div class="lbl">⚠ Special Instructions</div><div class="txt">${job.specialInstructions}</div></div>` : ''}

  <!-- ── NOTES ── -->
  ${job.info ? `<div class="notes"><div class="lbl">Notes</div><div class="txt">${job.info}</div></div>` : ''}

  <!-- ── OPERATION LOG ── -->
  <div class="op-title">Operation Log</div>
  <table>
    <thead>
      <tr>
        <th style="width:22%">Operation</th>
        <th style="width:14%">Machine / Station</th>
        <th style="width:16%">Operator</th>
        <th style="width:10%">Date</th>
        <th style="width:9%">Start</th>
        <th style="width:9%">End</th>
        <th style="width:9%">Duration</th>
        <th style="width:11%">Qty Out / Init</th>
      </tr>
    </thead>
    <tbody>
      ${Array(8).fill('<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>').join('')}
    </tbody>
  </table>

  <!-- ── FOOTER ── -->
  <div class="footer">
    <div class="sig-line">
      <div class="sig-name">${settings.companyName || 'Company'}</div>
      <div class="sig-rule">Authorized Signature &amp; Date</div>
    </div>
    <div class="coc">CERTIFICATE OF CONFORMANCE: All processes conform to applicable specifications, drawings, contracts and/or order requirements unless otherwise noted. Job #${job.jobIdsDisplay || ''} · PO ${job.poNumber || ''}</div>
  </div>

  </div></body></html>`);

  win.document.close();
  setTimeout(() => { win.print(); }, 600);
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
    ${settings.companyLogo ? `<img src="${settings.companyLogo}" class="company-logo-center" />` : ''}

    <div class="doc-header">
      <div class="company-left">
        <div class="company-name">${settings.companyName || 'Company Name'}</div>
      </div>
      <div class="doc-type">Purchase Order</div>
    </div>

    <div class="info-grid">
      <div class="info-left">
        <div class="info-row"><span class="info-label">PO Number:</span><span class="info-value" style="font-weight:700">${po.poNumber}</span></div>
        <div class="info-row"><span class="info-label">Ordered:</span><span class="info-value">${formatDate(po.orderedDate)}</span></div>
        ${po.requiredDate ? `<div class="info-row"><span class="info-label">Required By:</span><span class="info-value" style="color:#dc2626;font-weight:700">${po.requiredDate}</span></div>` : ''}
        ${po.expectedDate ? `<div class="info-row"><span class="info-label">Expected:</span><span class="info-value">${po.expectedDate}</span></div>` : ''}
      </div>
      <div class="info-right">
        <div class="info-right-text">
          ${settings.companyAddress || ''}<br/>
          ${settings.companyPhone ? settings.companyPhone + '<br/>' : ''}
          ${settings.companyEmail || ''}
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
      <div class="client-block">
        <div class="client-label">Vendor</div>
        <div class="client-name">${po.vendorName}</div>
        ${po.vendorContact?.name ? `<div class="client-detail">${po.vendorContact.name}</div>` : ''}
        ${po.vendorContact?.email ? `<div class="client-detail">${po.vendorContact.email}</div>` : ''}
        ${po.vendorContact?.phone ? `<div class="client-detail">${po.vendorContact.phone}</div>` : ''}
        ${po.vendorContact?.address ? `<div class="client-detail">${po.vendorContact.address}</div>` : ''}
      </div>
      ${po.billTo ? `<div class="client-block">
        <div class="client-label">Bill To / Ship To</div>
        <div class="client-name">${po.billTo.name}</div>
        ${po.billTo.address ? `<div class="client-detail">${po.billTo.address}</div>` : ''}
        ${po.billTo.phone ? `<div class="client-detail">${po.billTo.phone}</div>` : ''}
      </div>` : ''}
    </div>

    ${po.qualityRequirements && po.qualityRequirements.length > 0 ? `
    <div class="special-block" style="border-color:#10b981;background:#f0fdf4">
      <div class="special-label" style="color:#065f46">✓ Quality Requirements</div>
      <div class="special-text" style="color:#064e3b">${po.qualityRequirements.map(r => `• ${r}`).join(' &nbsp; ')}</div>
    </div>` : ''}

    ${po.instructions ? `<div class="notes-block"><div class="notes-label">Special Instructions</div><div class="notes-text">${po.instructions}</div></div>` : ''}

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
            <strong>${item.description}</strong>
            ${item.instructions ? `<div style="font-size:10px;color:#6b7280;margin-top:2px;font-style:italic">${item.instructions}</div>` : ''}
            ${item.qualityReqs && item.qualityReqs.length > 0 ? `<div style="font-size:9px;color:#059669;margin-top:2px">✓ ${item.qualityReqs.join(' · ')}</div>` : ''}
            ${item.attachments && item.attachments.length > 0 ? `<div style="font-size:9px;color:#2563eb;margin-top:2px">📎 ${item.attachments.length} file${item.attachments.length !== 1 ? 's' : ''} attached</div>` : ''}
          </td>
          <td style="font-size:10px;color:#374151">${item.partNumber || '—'}</td>
          <td class="center">${item.quantity}</td>
          <td class="center">${item.unit || 'ea'}</td>
          <td class="right">$${item.unitPrice.toFixed(2)}</td>
          <td class="right bold">$${item.total.toFixed(2)}</td>
        </tr>`).join('')}
      </tbody>
    </table>

    <div class="totals-wrap">
      <div class="totals">
        <div class="total-row"><span class="total-label">Subtotal</span><span class="total-value">$${po.subtotal.toFixed(2)}</span></div>
        ${po.taxAmt ? `<div class="total-row"><span class="total-label">Tax (${(po.taxRate || 0).toFixed(1)}%)</span><span class="total-value">$${po.taxAmt.toFixed(2)}</span></div>` : ''}
        ${po.shippingAmt ? `<div class="total-row"><span class="total-label">Shipping</span><span class="total-value">$${po.shippingAmt.toFixed(2)}</span></div>` : ''}
        <div class="total-row grand"><span>Total</span><span>$${po.total.toFixed(2)}</span></div>
      </div>
    </div>

    ${po.terms ? `<div class="comments-block"><div class="comments-label">Terms & Conditions</div><div class="comments-text">${po.terms}</div></div>` : ''}

    ${attachmentCount > 0 ? `<div class="notes-block" style="background:#eff6ff;border-color:#bfdbfe"><div class="notes-label" style="color:#1e40af">📎 Attachments</div><div class="notes-text" style="color:#1e3a8a">This PO references ${attachmentCount} attached file${attachmentCount !== 1 ? 's' : ''}. See accompanying email or file transfer for drawings / specs.</div></div>` : ''}

    <div class="sig-section">
      <div class="sig-block">
        <div class="sig-company">${settings.companyName || 'Purchaser'}</div>
        <div class="sig-line">Authorized By${po.approvedByName ? ` — ${po.approvedByName}` : ''}</div>
      </div>
      <div class="sig-block">
        <div class="sig-company">${po.vendorName}</div>
        <div class="sig-line">Vendor Acknowledgment</div>
      </div>
    </div>

    <div class="page-num">PO ${po.poNumber} · 1 / 1</div>
  </div>`;
  openPrintWindow(html, `PO ${po.poNumber}`);
}

export function printInvoicePDF(quote: Quote, job: Job | null, settings: SystemSettings) {
  const projectFields = quote.projectFields ? Object.entries(quote.projectFields).filter(([,v]) => v) : [];

  const html = `<div class="page">
    ${settings.companyLogo ? `<img src="${settings.companyLogo}" class="company-logo-center" />` : ''}

    <div class="doc-header">
      <div class="company-left">
        <div class="company-name">${settings.companyName || 'Company Name'}</div>
      </div>
      <div class="doc-type">Invoice</div>
    </div>

    <div class="info-grid">
      <div class="info-left">
        <div class="info-row"><span class="info-label">Invoice No:</span><span class="info-value">${quote.quoteNumber}</span></div>
        <div class="info-row"><span class="info-label">Date:</span><span class="info-value">${formatDate(Date.now())}</span></div>
        ${job ? `<div class="info-row"><span class="info-label">PO Number:</span><span class="info-value">${job.poNumber}</span></div>` : ''}
      </div>
      <div class="info-right">
        <div class="info-right-text">
          ${settings.companyAddress || ''}<br/>
          ${settings.companyPhone ? settings.companyPhone + '<br/>' : ''}
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:${quote.shipTo?.name ? '1fr 1fr' : '1fr'};gap:12px;margin-bottom:16px">
      <div class="client-block">
        <div class="client-label">Bill To</div>
        <div class="client-name">${quote.billTo?.name || quote.customer}</div>
        ${quote.billTo?.contactPerson ? `<div class="client-detail">${quote.billTo.contactPerson}</div>` : ''}
        ${quote.billTo?.email ? `<div class="client-detail">${quote.billTo.email}</div>` : ''}
        ${quote.billTo?.phone ? `<div class="client-detail">${quote.billTo.phone}</div>` : ''}
        ${quote.billTo?.address ? `<div class="client-detail">${quote.billTo.address}</div>` : ''}
      </div>
      ${quote.shipTo?.name ? `<div class="client-block">
        <div class="client-label">Ship To</div>
        <div class="client-name">${quote.shipTo.name}</div>
        ${quote.shipTo.contactPerson ? `<div class="client-detail">${quote.shipTo.contactPerson}</div>` : ''}
        ${quote.shipTo.address ? `<div class="client-detail">${quote.shipTo.address}</div>` : ''}
      </div>` : ''}
    </div>

    ${projectFields.length > 0 ? `<div class="fields-grid">
      ${projectFields.map(([k, v]) => `<div class="field-row"><div class="field-label">${k}</div><div class="field-value">${v}</div></div>`).join('')}
    </div>` : ''}

    <table>
      <thead>
        <tr><th>Description</th><th class="center">Qty</th><th class="center">Unit</th><th class="right">Rate</th><th class="right">Amount</th></tr>
      </thead>
      <tbody>
        ${quote.items.map(item => `<tr>
          <td>${item.description}</td>
          <td class="center">${item.qty}</td>
          <td class="center">${item.unit || 'ea'}</td>
          <td class="right">$${item.unitPrice.toFixed(2)}</td>
          <td class="right bold">$${item.total.toFixed(2)}</td>
        </tr>`).join('')}
      </tbody>
    </table>

    <div class="totals-wrap">
      <div class="totals">
        <div class="total-row"><span class="total-label">Subtotal</span><span class="total-value">$${quote.subtotal.toFixed(2)}</span></div>
        ${quote.markupPct ? `<div class="total-row"><span class="total-label">Markup (${quote.markupPct}%)</span><span class="total-value">+$${(quote.subtotal * quote.markupPct / 100).toFixed(2)}</span></div>` : ''}
        ${quote.discountAmt ? `<div class="total-row discount"><span class="total-label">Discount (${quote.discountPct || 0}%)</span><span class="total-value">-$${quote.discountAmt.toFixed(2)}</span></div>` : ''}
        ${quote.taxAmt ? `<div class="total-row"><span class="total-label">Tax (${quote.taxRate || 0}%)</span><span class="total-value">+$${quote.taxAmt.toFixed(2)}</span></div>` : ''}
        <div class="total-row grand"><span>Amount Due</span><span>$${quote.total.toFixed(2)}</span></div>
      </div>
    </div>

    ${quote.notes ? `<div class="comments-block"><div class="comments-label">Comments</div><div class="comments-text">${quote.notes}</div></div>` : ''}
    ${quote.terms ? `<div class="comments-block"><div class="comments-label">Terms & Conditions</div><div class="comments-text">${quote.terms}</div></div>` : ''}

    <div class="sig-section">
      <div class="sig-block">
        <div class="sig-company">${settings.companyName || 'Company'}</div>
        <div class="sig-line">Authorized Signature</div>
      </div>
      <div class="sig-block">
        <div class="sig-company">Client's signature</div>
        <div class="sig-line">Acceptance Signature</div>
      </div>
    </div>

    <div class="page-num">1 / 1</div>
  </div>`;
  openPrintWindow(html, `Invoice - ${quote.quoteNumber}`);
}
