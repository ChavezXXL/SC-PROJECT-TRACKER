/**
 * Job Traveler Print Renderer — FabTrack IO
 * ─────────────────────────────────────────────────────────────────────────
 * Single source of truth for the printed Production Traveler.
 *
 * Design philosophy:
 *   This is a MANUFACTURING DOCUMENT, not a UI component. It must look like
 *   something from ProShop or Steelhead — not a web page printed out.
 *   Key principles:
 *     • Solid black header bar (authority + readability)
 *     • Thick-bordered data cells (it's a form, not a layout)
 *     • PO / Part# / Qty in physically large type (readable 10ft away)
 *     • Filled section headers (black bar, white uppercase text)
 *     • Certificate of Conformance at bottom (aerospace-standard)
 *     • HTML table layout for identity block (rowspan works perfectly in print)
 *     • pt units throughout — no zoom hacks
 */

import type { Job, SystemSettings } from '../types';
import QRCode from 'qrcode';

const TRAVELER_CSS = `
  @page { size: letter portrait; margin: 0.45in; }
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body {
    font-family: 'Arial', 'Helvetica Neue', Helvetica, sans-serif;
    color: #111;
    font-size: 10pt;
    line-height: 1.4;
  }
  @media print { html, body { height:auto !important; } }

  /* ── ACCENT STRIPE (just the thin top line — no ink-heavy fills) ── */
  .accent { height:4pt; background:#ea580c; margin-bottom:10pt; }

  /* ── HEADER — white bg, black text, thin bottom rule ── */
  .hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 9pt;
    margin-bottom: 10pt;
    border-bottom: 1.5pt solid #111;
  }
  .hdr-left { display:flex; align-items:center; gap:10pt; }
  .hdr-logo { max-height:44pt; max-width:150pt; object-fit:contain; }
  .hdr-co   { font-size:16pt; font-weight:900; letter-spacing:-0.01em; color:#111; line-height:1.1; }
  .hdr-sub  { font-size:7.5pt; color:#71717a; margin-top:2pt; letter-spacing:0.05em; }
  .hdr-right { text-align:right; }
  .hdr-eyebrow { font-size:7pt; font-weight:800; letter-spacing:0.22em; text-transform:uppercase; color:#ea580c; margin-bottom:2pt; }
  .hdr-doctype  { font-size:18pt; font-weight:900; letter-spacing:-0.01em; color:#111; line-height:1; }
  .hdr-meta     { font-size:7.5pt; color:#71717a; margin-top:3pt; font-variant-numeric:tabular-nums; }

  /* ── IDENTITY BLOCK ── */
  .id-table { width:100%; border-collapse:collapse; }
  .id-table td { border:1.5pt solid #111; vertical-align:top; }

  .id-lbl {
    font-size: 7pt; font-weight: 800;
    letter-spacing: 0.16em; text-transform: uppercase;
    color: #71717a;
    padding: 5pt 10pt 1pt;
  }
  .id-val {
    font-weight: 900; line-height: 1;
    letter-spacing: -0.015em;
    color: #111;
    padding: 2pt 10pt 9pt;
    font-variant-numeric: tabular-nums;
    word-break: break-word;
  }
  .id-val.po   { font-size: var(--po-fs, 28pt); }
  .id-val.part { font-size: var(--pn-fs, 20pt); }
  .id-val.qty  { font-size: 36pt; color: #1d4ed8; }

  /* QR column — spans both rows */
  .id-qr-cell {
    width: 88pt;
    text-align: center;
    vertical-align: middle;
    padding: 8pt 10pt;
  }
  .id-qr-cell img {
    width: 72pt; height: 72pt;
    display: block; margin: 0 auto 5pt;
    image-rendering: pixelated;
    border: 0.5pt solid #d4d4d8;
  }
  .qr-cap {
    font-size: 6pt; font-weight: 800;
    letter-spacing: 0.16em; text-transform: uppercase;
    color: #a1a1aa;
  }

  /* Priority badge */
  .pri-pill {
    display: inline-block;
    margin-top: 6pt;
    padding: 2pt 9pt;
    border-radius: 99pt;
    font-size: 8pt; font-weight: 800;
    letter-spacing: 0.06em; text-transform: uppercase;
    border: 1pt solid currentColor;
  }
  .pri-urgent { color:#b91c1c; }
  .pri-high   { color:#9a3412; }

  /* ── META STRIP ── */
  .meta-table {
    width: 100%; border-collapse: collapse;
    border: 1.5pt solid #111; border-top: none;
    margin-bottom: 10pt;
  }
  .meta-table td {
    border-right: 1pt solid #d4d4d8;
    padding: 0; vertical-align: top;
  }
  .meta-table td:last-child { border-right: none; }
  .meta-lbl {
    font-size: 7pt; font-weight: 800;
    letter-spacing: 0.14em; text-transform: uppercase;
    color: #71717a;
    padding: 5pt 8pt 1pt;
  }
  .meta-val {
    font-size: 12pt; font-weight: 800;
    color: #111;
    padding: 0 8pt 6pt;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
  }
  .meta-val.red  { color: #b91c1c; }
  .meta-val.blue { color: #1d4ed8; }

  /* ── PART PHOTO ── */
  .photo-wrap { float:right; margin:0 0 10pt 14pt; }
  .photo-wrap img {
    display:block; width:110pt; height:82pt;
    object-fit:cover; border:1pt solid #d4d4d8;
  }
  .photo-cap {
    font-size:6.5pt; text-align:center; color:#a1a1aa;
    margin-top:3pt; letter-spacing:0.1em; text-transform:uppercase;
  }

  /* ── SPECIAL INSTRUCTIONS ── */
  .callout {
    border-left: 3.5pt solid #ea580c;
    background: #fff7ed;
    padding: 8pt 12pt;
    margin-bottom: 10pt;
    page-break-inside: avoid; break-inside: avoid;
  }
  .callout-lbl {
    font-size: 7.5pt; font-weight: 800;
    letter-spacing: 0.18em; text-transform: uppercase;
    color: #9a3412; margin-bottom: 4pt;
  }
  .callout-txt {
    font-size: 10.5pt; font-weight: 500;
    color: #1c1917; line-height: 1.55; white-space: pre-wrap;
  }

  /* ── NOTES ── */
  .notes-block {
    border-left: 2.5pt solid #d4d4d8;
    padding: 6pt 12pt; margin-bottom: 10pt;
    page-break-inside: avoid; break-inside: avoid;
  }
  .notes-lbl {
    font-size: 7pt; font-weight: 800;
    letter-spacing: 0.16em; text-transform: uppercase;
    color: #71717a; margin-bottom: 3pt;
  }
  .notes-txt { font-size:10pt; color:#3f3f46; line-height:1.5; white-space:pre-wrap; }

  /* ── SECTION HEADERS — ink-friendly: just a bold rule, no fill ── */
  .sec-hdr {
    font-size: 7.5pt; font-weight: 800;
    letter-spacing: 0.2em; text-transform: uppercase;
    color: #111;
    padding: 0 0 4pt 0;
    margin-bottom: 0;
    border-bottom: 1.5pt solid #111;
    page-break-after: avoid;
  }

  /* ── OPERATION LOG ── */
  .op-table { width:100%; border-collapse:collapse; margin-bottom:12pt; }
  .op-table thead th {
    font-size: 7pt; font-weight: 800;
    text-transform: uppercase; letter-spacing: 0.1em;
    color: #71717a;
    padding: 5pt 6pt;
    border: 1pt solid #d4d4d8;
    text-align: left; white-space: nowrap;
  }
  .op-table tbody td {
    height: 0.38in;
    padding: 2pt 6pt;
    border: 1pt solid #e5e5e7;
    font-size: 9pt; vertical-align: bottom;
  }
  .op-table tbody tr:nth-child(even) td { background: #fafafa; }

  /* ── FINAL INSPECTION / SIGN-OFF ── */
  .qa-table { width:100%; border-collapse:collapse; margin-bottom:10pt; }
  .qa-table td { border:1pt solid #d4d4d8; padding:6pt 10pt; vertical-align:top; }
  .qa-lbl {
    font-size: 7pt; font-weight: 800;
    letter-spacing: 0.14em; text-transform: uppercase;
    color: #71717a; margin-bottom: 18pt;
  }
  .qa-line {
    border-top: 1pt solid #111;
    padding-top: 3pt;
    font-size: 7.5pt; color: #71717a;
    font-weight: 700; letter-spacing: 0.04em;
  }
  .qa-checks { display:flex; gap:14pt; margin:8pt 0; }
  .qa-check { display:flex; align-items:center; gap:5pt; font-size:9pt; font-weight:700; }
  .qa-box {
    width:12pt; height:12pt;
    border:1.5pt solid #111;
    display:inline-block; border-radius:1.5pt; flex-shrink:0;
  }

  /* ── CERTIFICATE OF CONFORMANCE ── */
  .coc {
    font-size: 7pt; color: #71717a; line-height: 1.6;
    padding: 5pt 8pt;
    border: 0.5pt solid #d4d4d8;
    margin-bottom: 8pt;
  }
  .coc strong { color: #374151; }

  /* ── FOOTER ── */
  .foot {
    display: flex; justify-content: space-between; align-items: center;
    padding-top: 6pt;
    border-top: 0.5pt solid #d4d4d8;
    font-size: 7pt; color: #a1a1aa;
    font-variant-numeric: tabular-nums;
  }
  .foot strong { color: #71717a; }
  .foot-custom {
    text-align: center; font-size: 8.5pt; color: #71717a;
    margin-top: 8pt; white-space: pre-wrap;
    padding-top: 6pt; border-top: 0.5pt solid #e5e5e7;
  }

  /* clearfix for float:right photo */
  .cf::after { content:''; display:table; clear:both; }
`;

export interface TravelerOptions {
  operationRows?: number;
  showLogo?: boolean;
  showCustomer?: boolean;
  showDueDate?: boolean;
  showPriority?: boolean;
  showSpecialInstructions?: boolean;
  showNotes?: boolean;
  showOperationLog?: boolean;
  showSignOff?: boolean;
  showQr?: boolean;
  showPartImage?: boolean;
  headerBanner?: string;
  footerText?: string;
  /** Pre-generated QR data URL (from qrcode lib). If omitted, QR is skipped. */
  _qrDataUrl?: string;
}

function flag(opt: boolean | undefined, fromSettings: boolean | undefined): boolean {
  if (typeof opt === 'boolean') return opt;
  if (typeof fromSettings === 'boolean') return fromSettings;
  return true;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Responsive font size for long strings in a fixed-width cell. */
function poFontSize(s: string): string {
  const n = s.length;
  if (n > 22) return '16pt';
  if (n > 17) return '20pt';
  if (n > 12) return '24pt';
  if (n > 8)  return '28pt';
  return '32pt';
}
function partFontSize(s: string): string {
  const n = s.length;
  if (n > 22) return '12pt';
  if (n > 16) return '14pt';
  if (n > 11) return '17pt';
  return '21pt';
}

export function renderTravelerHtml(
  job: Job,
  settings: SystemSettings,
  options: TravelerOptions = {}
): string {
  const t = settings.traveler ?? {};

  const show = {
    logo:                flag(options.showLogo,                t.showLogo),
    customer:            flag(options.showCustomer,            t.showCustomer),
    dueDate:             flag(options.showDueDate,             t.showDueDate),
    priority:            flag(options.showPriority,            t.showPriority),
    specialInstructions: flag(options.showSpecialInstructions, t.showSpecialInstructions),
    notes:               flag(options.showNotes,               t.showNotes),
    operationLog:        flag(options.showOperationLog,        t.showOperationLog),
    signOff:             flag(options.showSignOff,             t.showSignOff),
    qr:                  flag(options.showQr,                  t.showQrCode) && !!options._qrDataUrl,
    partImage:           flag(options.showPartImage,           t.showPartPhoto) && !!job.partImage,
  };

  const opRows = Math.min(20, Math.max(4, options.operationRows ?? t.operationLogRows ?? 8));
  const banner = options.headerBanner ?? t.headerBanner ?? '';
  const footer = options.footerText  ?? t.footerText  ?? '';

  const priority   = job.priority || 'normal';
  const jobLabel   = job.jobIdsDisplay || job.id.slice(-8);
  const qtyStr     = job.quantity != null ? job.quantity.toLocaleString() : '—';
  const estTime    = (job.expectedHours || 0) > 0 ? `${job.expectedHours}h` : '—';
  const printedAt  = new Date().toLocaleString('en-US', {
    month: '2-digit', day: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const poFs   = poFontSize(job.poNumber   || '');
  const partFs = partFontSize(job.partNumber || '');

  // ── BANNER ──
  const bannerHtml = banner
    ? `<div style="background:#fffbeb;border-left:3pt solid #f59e0b;color:#78350f;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;font-size:8pt;padding:5pt 10pt;margin-bottom:10pt">${escapeHtml(banner)}</div>`
    : '';

  // ── HEADER ──
  const logoHtml = show.logo && settings.companyLogo
    ? `<img class="hdr-logo" src="${settings.companyLogo}" alt="" />`
    : '';
  const phoneHtml = settings.companyPhone
    ? `<div class="hdr-sub">${escapeHtml(settings.companyPhone)}</div>` : '';

  // ── QR cell (spans both rows of identity block) ──
  const qrCellHtml = show.qr && options._qrDataUrl
    ? `<td class="id-qr-cell" rowspan="2">
        <img src="${options._qrDataUrl}" alt="Scan to open job in FabTrack" />
        <div class="qr-cap">Scan to Open</div>
       </td>`
    : '';

  // ── Priority badge inside PO cell ──
  const priBadge = show.priority && priority !== 'normal'
    ? `<div class="pri-pill ${priority === 'urgent' ? 'pri-urgent' : 'pri-high'}">${escapeHtml(priority.toUpperCase())}</div>`
    : '';

  // ── META STRIP cells ──
  const metaCells: string[] = [];
  if (show.customer) {
    metaCells.push(`<td>
      <div class="meta-lbl">Customer</div>
      <div class="meta-val">${escapeHtml(job.customer || '—')}</div>
    </td>`);
  }
  metaCells.push(`<td>
    <div class="meta-lbl">Date Received</div>
    <div class="meta-val">${escapeHtml(job.dateReceived || '—')}</div>
  </td>`);
  if (show.dueDate) {
    metaCells.push(`<td>
      <div class="meta-lbl">Due Date</div>
      <div class="meta-val red">${escapeHtml(job.dueDate || '—')}</div>
    </td>`);
  }
  metaCells.push(`<td>
    <div class="meta-lbl">Est. Time</div>
    <div class="meta-val blue">${estTime}</div>
  </td>`);
  if (show.priority && priority !== 'normal') {
    metaCells.push(`<td>
      <div class="meta-lbl">Priority</div>
      <div class="meta-val"><span class="pri-pill ${priority === 'urgent' ? 'pri-urgent' : 'pri-high'}" style="margin-top:0;display:inline-block;margin-top:2pt">${escapeHtml(priority.toUpperCase())}</span></div>
    </td>`);
  }

  // ── PART PHOTO ──
  const photoHtml = show.partImage && job.partImage
    ? `<div class="photo-wrap">
        <img src="${job.partImage}" alt="Part photo" />
        <div class="photo-cap">Part Reference</div>
       </div>` : '';

  // ── SPECIAL INSTRUCTIONS ──
  const instrHtml = show.specialInstructions && job.specialInstructions
    ? `<div class="callout">
        <div class="callout-lbl">⚠ Special Instructions</div>
        <div class="callout-txt">${escapeHtml(job.specialInstructions)}</div>
       </div>` : '';

  // ── NOTES ──
  const notesHtml = show.notes && job.info
    ? `<div class="notes-block">
        <div class="notes-lbl">Job Notes</div>
        <div class="notes-txt">${escapeHtml(job.info)}</div>
       </div>` : '';

  // ── OPERATION LOG ──
  const opRowsHtml = Array.from({ length: opRows }, () =>
    '<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>'
  ).join('');

  const opLogHtml = show.operationLog ? `
    <div class="sec-hdr">Operation Log</div>
    <table class="op-table">
      <thead><tr>
        <th style="width:24%">Operation / Process</th>
        <th style="width:18%">Operator</th>
        <th style="width:10%">Date</th>
        <th style="width:9%">Start</th>
        <th style="width:9%">End</th>
        <th style="width:8%">Qty OK</th>
        <th style="width:22%">Notes / Initials</th>
      </tr></thead>
      <tbody>${opRowsHtml}</tbody>
    </table>` : '';

  // ── FINAL INSPECTION / SIGN-OFF ──
  const qaHtml = show.signOff ? `
    <div class="sec-hdr">Final Inspection &amp; Sign-Off</div>
    <table class="qa-table" style="margin-top:0">
      <tr>
        <td style="width:34%">
          <div class="qa-lbl">Inspection Result</div>
          <div class="qa-checks">
            <div class="qa-check"><span class="qa-box"></span> Pass</div>
            <div class="qa-check"><span class="qa-box"></span> Fail</div>
            <div class="qa-check"><span class="qa-box"></span> Rework</div>
          </div>
        </td>
        <td style="width:33%">
          <div class="qa-lbl">Inspector Signature</div>
          <div class="qa-line">Print Name &amp; Sign</div>
        </td>
        <td style="width:33%">
          <div class="qa-lbl">Production Lead</div>
          <div class="qa-line">Signature &amp; Date</div>
        </td>
      </tr>
      <tr>
        <td>
          <div class="qa-lbl">Final Qty Shipped</div>
          <div class="qa-line">&nbsp;</div>
        </td>
        <td>
          <div class="qa-lbl">Packed By</div>
          <div class="qa-line">&nbsp;</div>
        </td>
        <td>
          <div class="qa-lbl">Date / Time Released</div>
          <div class="qa-line">&nbsp;</div>
        </td>
      </tr>
    </table>` : '';

  // ── CERTIFICATE OF CONFORMANCE ──
  const cocHtml = `
    <div class="coc">
      <strong>CERTIFICATE OF CONFORMANCE:</strong>
      This document certifies that all parts and processes described herein conform to applicable
      specifications, drawings, purchase order requirements, and quality standards unless otherwise
      noted. Authorized signature required before shipment.
    </div>`;

  const footerCustomHtml = footer
    ? `<div class="foot-custom">${escapeHtml(footer)}</div>` : '';

  return `
    <style>
      :root {
        --po-fs: ${poFs};
        --pn-fs: ${partFs};
      }
    </style>

    ${bannerHtml}

    <div class="accent"></div>

    <!-- HEADER -->
    <div class="hdr">
      <div class="hdr-left">
        ${logoHtml}
        <div>
          <div class="hdr-co">${escapeHtml(settings.companyName || 'Company Name')}</div>
          ${phoneHtml}
        </div>
      </div>
      <div class="hdr-right">
        <div class="hdr-eyebrow">Production</div>
        <div class="hdr-doctype">Traveler</div>
        <div class="hdr-meta">Job&nbsp;${escapeHtml(jobLabel)}&nbsp;·&nbsp;${printedAt}</div>
      </div>
    </div>

    <!-- IDENTITY BLOCK: PO / Part# / Qty / QR — table for reliable rowspan in print -->
    <table class="id-table">
      <colgroup>
        <col style="width:${show.qr && options._qrDataUrl ? '62%' : '100%'}" />
        <col style="width:${show.qr && options._qrDataUrl ? '38%' : '0'}" />
        ${show.qr && options._qrDataUrl ? '<col style="width:88pt" />' : ''}
      </colgroup>
      <tr>
        <!-- PO number — full width (minus QR column) -->
        <td colspan="2" style="border-bottom:1pt solid #d4d4d8;">
          <div class="id-lbl">Purchase Order</div>
          <div class="id-val po">${escapeHtml(job.poNumber || '—')}${priBadge}</div>
        </td>
        ${qrCellHtml}
      </tr>
      <tr>
        <!-- Part number -->
        <td style="border-right:1pt solid #d4d4d8;">
          <div class="id-lbl">Part Number</div>
          <div class="id-val part">${escapeHtml(job.partNumber || '—')}</div>
        </td>
        <!-- Quantity -->
        <td style="background:#f0f7ff;">
          <div class="id-lbl" style="color:#1e40af;">Qty to Process</div>
          <div class="id-val qty">${qtyStr}</div>
        </td>
        <!-- QR spans into this row — no extra td needed -->
      </tr>
    </table>

    <!-- META STRIP: secondary info, continuous with identity block border -->
    <table class="meta-table">
      <tr>${metaCells.join('')}</tr>
    </table>

    <!-- CONTENT (photo floated right, instructions + notes flow left) -->
    <div class="cf">
      ${photoHtml}
      ${instrHtml}
      ${notesHtml}
    </div>

    <!-- OPERATION LOG -->
    ${opLogHtml}

    <!-- FINAL INSPECTION -->
    ${qaHtml}

    <!-- CERTIFICATE OF CONFORMANCE -->
    ${cocHtml}

    <!-- FOOTER -->
    <div class="foot">
      <div><strong>${escapeHtml(settings.companyName || '')}</strong> · Job ${escapeHtml(jobLabel)} · PO ${escapeHtml(job.poNumber || '')}</div>
      <div>Printed ${printedAt}</div>
    </div>

    ${footerCustomHtml}
  `;
}

/** Generate QR data URL locally (no network), then open popup + print. */
export async function printTraveler(
  job: Job,
  settings: SystemSettings,
  options: TravelerOptions = {}
): Promise<void> {
  let qrDataUrl = '';
  const wantQr = flag(options.showQr, settings.traveler?.showQrCode ?? true);
  if (wantQr) {
    try {
      const deepLink = `${window.location.origin}?jobId=${job.id}`;
      qrDataUrl = await QRCode.toDataURL(deepLink, {
        width: 200,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      });
    } catch {
      // QR generation failed — continue without it
    }
  }

  const win = window.open('', '_blank', 'width=850,height=1100');
  if (!win) {
    alert('Pop-up blocked — allow pop-ups for this site to print travelers.');
    return;
  }

  const title = `Traveler — ${job.poNumber || job.jobIdsDisplay || job.id.slice(-8)}`;
  const body  = renderTravelerHtml(job, settings, { ...options, _qrDataUrl: qrDataUrl });

  win.document.write(
    `<!DOCTYPE html><html><head>` +
    `<meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
    `<style>${TRAVELER_CSS}</style>` +
    `</head><body>${body}</body></html>`
  );
  win.document.close();

  // Let logo + part photo load before opening print dialog
  setTimeout(() => { win.focus(); win.print(); }, 600);
}

/** Returns a blob: URL — useful for iframe preview or batch download. */
export async function buildTravelerBlobUrl(
  job: Job,
  settings: SystemSettings,
  options: TravelerOptions = {}
): Promise<string> {
  let qrDataUrl = '';
  const wantQr = flag(options.showQr, settings.traveler?.showQrCode ?? true);
  if (wantQr) {
    try {
      const deepLink = `${window.location.origin}?jobId=${job.id}`;
      qrDataUrl = await QRCode.toDataURL(deepLink, { width: 200, margin: 1 });
    } catch { /* skip */ }
  }
  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8">` +
    `<style>${TRAVELER_CSS}</style></head>` +
    `<body>${renderTravelerHtml(job, settings, { ...options, _qrDataUrl: qrDataUrl })}</body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  return URL.createObjectURL(blob);
}
