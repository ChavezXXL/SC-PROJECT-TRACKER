// ═════════════════════════════════════════════════════════════════════
// Number / currency formatting helpers.
// Extracted from 13+ inline copies of the same "format thousands with k"
// logic previously scattered across Overview charts, Reports, and tables.
// ═════════════════════════════════════════════════════════════════════

/**
 * Compact dollar / number format — "42.5k" for >= 1000, full number otherwise.
 * Does NOT prefix with "$". Use `fmtMoneyK` for that.
 * Negative numbers are returned negative: fmtK(-2500) → "-2.5k".
 */
export function fmtK(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) return `${n < 0 ? '-' : ''}${(abs / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

/** Same as fmtK but prefixed with "$". For positive values only — use fmtMoneySigned for +/-. */
export function fmtMoneyK(n: number): string {
  return `$${fmtK(Math.abs(n))}`;
}

/**
 * Signed currency: "+$2.5k" / "-$420". Useful for profit / net columns.
 */
export function fmtMoneySigned(n: number): string {
  const sign = n >= 0 ? '+' : '-';
  return `${sign}$${fmtK(Math.abs(n))}`;
}

/**
 * Full currency with USD symbol, no decimals. "$1,234".
 * Use this when precision matters more than brevity (e.g. detail modals).
 */
export function fmtCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/**
 * Truncate a long string for tight columns. Appends "…".
 */
export function shortName(s: string, max = 14): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
