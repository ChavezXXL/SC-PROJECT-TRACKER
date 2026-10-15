// Printed quotes / invoices / packing slips: shop text must come out exactly
// as typed (a "<" used to swallow the rest of the line), and Settings →
// Documents must change the real PDF — not just the preview in Settings.
import { quoteHtml, invoiceHtml, packingSlipHtml } from '../services/pdfService';
import { getNextQuoteNumber } from '../services/mockDb';
import type { Quote, Job, SystemSettings } from '../types';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

const base = { companyName: 'SC Deburring & Finishing' } as SystemSettings;
const quote = {
  id: 'QT-1', quoteNumber: 'Q-007', customer: 'Acme <Aero>', status: 'draft', createdAt: Date.UTC(2026, 9, 15, 12),
  items: [{ id: 'i1', description: 'Break edges <0.005 max', qty: 250, unit: 'ea', unitPrice: 1.5, total: 375 }],
  subtotal: 375, total: 375, markupPct: 0, validUntil: '2026-11-15', terms: 'Net 30', notes: 'Rush "if possible"',
} as unknown as Quote;

// ── Text comes out exactly as typed ──
{
  const html = quoteHtml(quote, base);
  ok('a "<" in a line item is printed, not eaten', html.includes('Break edges &lt;0.005 max'));
  ok('customer with angle brackets is escaped', html.includes('Acme &lt;Aero&gt;') && !html.includes('<Aero>'));
  ok('ampersand in the shop name is escaped', html.includes('SC Deburring &amp; Finishing'));
  ok('quotes in notes are escaped', html.includes('Rush &quot;if possible&quot;'));
  const slip = packingSlipHtml({ id: 'j1', poNumber: 'PO<1>', partNumber: 'P-9', customer: 'X', quantity: 10, info: 'Deburr <all> edges', specialInstructions: 'Bag & tag' } as unknown as Job, base);
  ok('packing slip escapes the PO number', slip.includes('PO&lt;1&gt;') && !slip.includes('PO<1>'));
  ok('packing slip escapes the description', slip.includes('Deburr &lt;all&gt; edges'));
  ok('packing slip escapes special instructions', slip.includes('Bag &amp; tag'));
}

// ── Defaults: nothing changes for a shop that never touched these settings ──
{
  const html = quoteHtml(quote, base);
  ok('default: all columns', html.includes('>Qty</th>') && html.includes('>Unit</th>') && html.includes('>Rate</th>'));
  ok('default: signature lines', html.includes('sig-section'));
  ok('default: terms block', html.includes('Terms & Conditions'));
  ok('default: valid-until row', html.includes('Valid Until'));
  ok('default: original blue accent', html.includes('color:#2563eb'));
  ok('default: no watermark', !html.includes('rotate(-30deg)'));
}

// ── Settings → Documents now reach the printed page ──
{
  const html = quoteHtml(quote, {
    ...base, showQtyCol: false, showUnitCol: false, showRateCol: false, showSignatureLines: false,
    showTermsOnDocs: false, showDueDateOnDocs: false, accentColor: '#22c55e', watermark: 'DRAFT',
  });
  ok('columns can be hidden', !html.includes('>Qty</th>') && !html.includes('>Unit</th>') && !html.includes('>Rate</th>') && html.includes('>Amount</th>'));
  ok('hidden rate column drops the unit price cell too', !html.includes('$1.50'));
  ok('signature lines can be hidden', !html.includes('sig-section'));
  ok('terms block can be hidden', !html.includes('Terms & Conditions'));
  ok('valid-until row can be hidden', !html.includes('Valid Until'));
  ok('accent color is applied', html.includes('color:#22c55e'));
  ok('watermark is printed', html.includes('>DRAFT</div>'));
  const inv = invoiceHtml(quote, null, { ...base, watermark: 'COPY', showSignatureLines: false });
  ok('invoice follows the same settings', inv.includes('>COPY</div>') && !inv.includes('sig-section'));
}

// ── A bad accent value can't inject CSS ──
{
  const html = quoteHtml(quote, { ...base, accentColor: 'red;} body{display:none' });
  ok('invalid accent falls back to blue', html.includes('color:#2563eb') && !html.includes('display:none'));
}

// ── Quote numbers: "Start at" in Settings ──
{
  const qs = [{ quoteNumber: 'Q-004' }, { quoteNumber: 'Q-011' }] as Quote[];
  ok('counts up from the highest quote', getNextQuoteNumber(qs, 'Q-') === 'Q-012');
  ok('first quote starts at 1', getNextQuoteNumber([], 'Q-') === 'Q-001');
  ok('"start at" lifts the next number', getNextQuoteNumber(qs, 'Q-', 1500) === 'Q-1500');
  ok('"start at" never goes backwards', getNextQuoteNumber(qs, 'Q-', 5) === 'Q-012');
}

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
