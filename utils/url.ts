// ═════════════════════════════════════════════════════════════════
// URL / slug utilities for customer portals.
// Each customer can have a short, human-readable slug (e.g. "acme-corp")
// stored in settings.clientSlugs — makes portal links tidy + shareable.
// ═════════════════════════════════════════════════════════════════

import type { SystemSettings } from '../types';

/** Turn any client name into a URL-safe slug
 *  (e.g. "S&H Deburring LLC" → "sh-and-h-deburring-llc").
 *  Lowercase, dash-separated, max 32 chars. Falls back to 'client'. */
export function makeClientSlug(name: string): string {
  const s = (name || '')
    .toLowerCase()
    .replace(/&/g, '-and-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return s || 'client';
}

/** Build a short portal URL for a customer, using clientSlugs map from settings.
 *  Falls back to ?portal=encoded if no slug is defined. */
export function buildPortalUrl(
  customer: string,
  settings: SystemSettings,
  quoteId?: string,
): string {
  const base = window.location.origin + window.location.pathname;
  const slug = settings.clientSlugs?.[customer];
  if (slug) {
    return `${base}?c=${slug}${quoteId ? `&q=${quoteId}` : ''}`;
  }
  return `${base}?portal=${encodeURIComponent(customer)}${quoteId ? `&quote=${quoteId}` : ''}`;
}
