/**
 * changedFields.ts — what the user actually changed in an editor.
 *
 * Editors open with a copy of a record and used to save that whole copy back,
 * which undid anything another device changed while the editor was open (a
 * worker's progress, a receipt, a customer's answer). Compare the edited
 * copy with the copy the editor OPENED with and save only the difference.
 *
 * Result: only top-level fields whose value changed. A field the user
 * emptied comes back as `undefined` — the data layer deletes those. Fields
 * the user didn't touch are left out, so they keep whatever the server has.
 */

/** Empty means the same thing however a form spells it. */
const empty = (v: unknown) => v === undefined || v === null || v === '';

/** Key-order-independent JSON, so {a,b} and {b,a} compare equal. */
function stable(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (empty(a) && empty(b)) return true;
  return stable(a) === stable(b);
}

export function changedFields<T extends object>(
  original: Partial<T> | null | undefined,
  edited: Partial<T>,
  opts: { ignore?: string[] } = {},
): Partial<T> {
  const o = (original || {}) as Record<string, unknown>;
  const e = edited as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(o), ...Object.keys(e)]);
  for (const k of keys) {
    if (opts.ignore?.includes(k)) continue;
    if (sameValue(o[k], e[k])) continue;
    out[k] = empty(e[k]) ? undefined : e[k];
  }
  return out as Partial<T>;
}

/** True when the editor holds unsaved changes (for "discard changes?" prompts). */
export const hasChanges = <T extends object>(original: Partial<T> | null | undefined, edited: Partial<T>, opts?: { ignore?: string[] }) =>
  Object.keys(changedFields(original, edited, opts)).length > 0;
