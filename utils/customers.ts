// Shared customer helpers so every view aggregates the same way.
//
// Without these, case-and-whitespace differences ("ACME", "ACME ", "acme")
// appear as duplicate customers in dropdowns / counts / filters. Settings
// already does this work — this centralises the logic so the rest of the
// app doesn't drift.

import type { Job } from '../types';

/** Normalized key used to decide "same customer" across the app.
 *  Trim + lowercase. Punctuation kept (ACME, Inc. vs ACME are still distinct). */
export function customerKey(name: string | undefined | null): string {
  return (name || '').trim().toLowerCase();
}

/**
 * Unique customer display names from a list of jobs, optionally merged with
 * a supplementary roster (e.g. `settings.clients`). Dedup is case- and
 * whitespace-insensitive; we keep the first-seen casing/punctuation so
 * existing job records stay visually consistent.
 *
 * Returns sorted alphabetically for stable UI.
 */
export function uniqueCustomers(
  jobs: Job[],
  extras: string[] = [],
): string[] {
  const seen = new Map<string, string>();
  const add = (raw: string | undefined | null) => {
    const name = (raw || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  };
  for (const j of jobs) add(j.customer);
  for (const e of extras) add(e);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Count jobs per customer using the normalized key so "ACME" and
 * "acme" aggregate into one bucket. Returns a Map keyed by the
 * canonical display name (first-seen casing).
 */
export function countByCustomer(jobs: Job[]): Map<string, number> {
  const canonical = new Map<string, string>();
  const count = new Map<string, number>();
  for (const j of jobs) {
    const name = (j.customer || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const display = canonical.get(key) || (canonical.set(key, name), name);
    count.set(display, (count.get(display) || 0) + 1);
  }
  return count;
}
