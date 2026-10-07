/**
 * Placeholder part numbers ("N/A", "TBD", "MISC", "-") are typed when the real
 * part number isn't known. They are NOT one part — five "N/A" jobs are five
 * different parts. Anything that groups history by part number (photo memory,
 * risk tiers, familiarity) must treat them as "no part number", or unrelated
 * jobs pool together: a hinge job showing a PAMCO part's photo, or a brand-new
 * N/A job rated GREEN because four other N/A jobs shipped.
 */
const PLACEHOLDERS = new Set([
  'na', 'n/a', 'n.a', 'n.a.', 'none', 'nil', 'null', 'unknown', 'unk',
  'tbd', 'tba', 'tbc', 'pending', 'misc', 'miscellaneous', 'various', 'varies',
  'mixed', 'multiple', 'multi', 'several', 'assorted',
  'sample', 'samples', 'test', 'testing', 'demo',
  'seepo', 'seedrawing', 'seedwg', 'seeprint', 'seeattached', 'perpo', 'perdrawing',
  'nopn', 'nopart', 'nopartnumber', 'partnumber', 'pn',
]);

export function isPlaceholderPartNumber(pn?: string | null): boolean {
  const raw = (pn || '').trim().toLowerCase();
  if (!raw) return true;
  const alnum = raw.replace(/[^a-z0-9]/g, '');
  if (alnum.length < 3) return true;          // "-", "?", "x", "0", "na"
  if (/^(.)\1+$/.test(alnum)) return true;    // "xxx", "000", "----"
  return PLACEHOLDERS.has(raw.replace(/\s+/g, '')) || PLACEHOLDERS.has(alnum);
}

/** Key for grouping photos by part: '' when the part number is a placeholder. */
export function photoPartKey(pn?: string | null): string {
  if (isPlaceholderPartNumber(pn)) return '';
  return (pn || '').trim().toLowerCase().replace(/\s+/g, '');
}
