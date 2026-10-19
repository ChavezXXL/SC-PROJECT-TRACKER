// ═════════════════════════════════════════════════════════════════════
// Tiny Firestore REST client for the Netlify crons.
//
// Same access the crons always had (the web API key, no Admin SDK), but every
// call counts the document reads Firestore bills for it. The project is on the
// free Spark plan — 50,000 reads/day for every screen AND every cron — so a
// cron must be able to say what a run cost. Billing rules modelled here:
//   • get           → 1 read (also when the document doesn't exist)
//   • list / query  → 1 read per document returned, minimum 1 per request
//   • batchGet      → 1 read per document asked for
// Writes are a separate quota and aren't counted.
//
// Nothing here throws: reads return null on failure, writes return false, and
// the failure is counted in `stats` so the run's heartbeat can report it.
// ═════════════════════════════════════════════════════════════════════

export type FsDoc = { id: string; [field: string]: any };
export type WhereOp = '==' | 'in' | '>' | '>=' | '<' | '<=';

export interface RestStats {
  /** Document reads billed so far (see rules above). */
  reads: number;
  /** Failed requests (a create that lost the race to an existing doc isn't one). */
  errors: number;
  lastError: string;
}

export interface WriteOpts {
  /** Only touch the fields given (updateMask) and leave the rest of the doc
   *  alone. Default: the doc's fields are REPLACED by `data`. */
  merge?: boolean;
  /** Create only. Returns false when the doc already exists — atomic, so of
   *  two overlapping runs exactly one wins. */
  mustNotExist?: boolean;
  /** With merge: fields to delete. */
  deleteFields?: string[];
}

export interface FirestoreRest {
  readonly stats: RestStats;
  /** One document, or null when it doesn't exist (or the read failed). */
  get(col: string, id: string): Promise<FsDoc | null>;
  /** A whole collection — null when any page fails (never a silent partial list). */
  list(col: string, opts?: { mask?: string[] }): Promise<FsDoc[] | null>;
  /** Single-field query. `select` limits the fields returned (bandwidth only —
   *  every matching document is still a billed read). */
  where(col: string, field: string, op: WhereOp, value: unknown, opts?: { select?: string[] }): Promise<FsDoc[] | null>;
  /** Several documents by id in one documents:batchGet — only the ids asked
   *  for are read. Missing docs are simply absent from the map. */
  getMany(col: string, ids: string[], opts?: { mask?: string[] }): Promise<Map<string, FsDoc> | null>;
  write(col: string, id: string, data: Record<string, unknown>, opts?: WriteOpts): Promise<boolean>;
  remove(col: string, id: string): Promise<boolean>;
}

// ── Value encoding ────────────────────────────────────────────────────

export function fromFsValue(v: any): any {
  if (v == null) return null;
  if ('stringValue'    in v) return v.stringValue;
  if ('integerValue'   in v) return Number(v.integerValue);
  if ('doubleValue'    in v) return v.doubleValue;
  if ('booleanValue'   in v) return v.booleanValue;
  if ('nullValue'      in v) return null;
  if ('timestampValue' in v) return new Date(v.timestampValue).getTime();
  if ('arrayValue'     in v) return (v.arrayValue.values || []).map(fromFsValue);
  if ('mapValue'       in v) {
    const obj: any = {};
    for (const [k, vv] of Object.entries(v.mapValue.fields || {})) obj[k] = fromFsValue(vv);
    return obj;
  }
  return undefined;
}

export function fromFsDoc(raw: any): FsDoc {
  const parts = String(raw?.name || '').split('/');
  const out: FsDoc = { id: parts[parts.length - 1] };
  for (const [k, v] of Object.entries(raw?.fields || {})) out[k] = fromFsValue(v);
  return out;
}

export function toFsValue(v: unknown): any {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { nullValue: null };
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFsFields(v as Record<string, unknown>) } };
  return { nullValue: null };
}

/** Encode a plain object as Firestore `fields`; undefined values are skipped. */
export function toFsFields(data: Record<string, unknown>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) if (v !== undefined) fields[k] = toFsValue(v);
  return fields;
}

const OPS: Record<WhereOp, string> = {
  '==': 'EQUAL', 'in': 'IN', '>': 'GREATER_THAN', '>=': 'GREATER_THAN_OR_EQUAL',
  '<': 'LESS_THAN', '<=': 'LESS_THAN_OR_EQUAL',
};

/** The structuredQuery body for a single-field filter (exported for tests). */
export function buildWhereQuery(col: string, field: string, op: WhereOp, value: unknown, select?: string[]): any {
  const q: any = {
    from: [{ collectionId: col }],
    where: {
      fieldFilter: {
        field: { fieldPath: field },
        op: OPS[op],
        value: op === 'in' ? { arrayValue: { values: (Array.isArray(value) ? value : [value]).map(toFsValue) } } : toFsValue(value),
      },
    },
  };
  if (select && select.length) q.select = { fields: select.map(f => ({ fieldPath: f })) };
  return q;
}

// ── Client ────────────────────────────────────────────────────────────

const BATCH_GET_CHUNK = 100;

export function createFirestoreRest(opts: {
  apiKey: string;
  projectId: string;
  /** Log prefix, e.g. "shift-push-cron". */
  label?: string;
  fetchImpl?: typeof fetch;
}): FirestoreRest {
  const { apiKey, projectId } = opts;
  const label = opts.label || 'firestore';
  const doFetch: typeof fetch = opts.fetchImpl || ((...a: Parameters<typeof fetch>) => fetch(...a));
  const root = `projects/${projectId}/databases/(default)/documents`;
  const base = `https://firestore.googleapis.com/v1/${root}`;
  const key = `key=${encodeURIComponent(apiKey)}`;
  const docPath = (col: string, id: string) => `${col}/${encodeURIComponent(id)}`;
  const stats: RestStats = { reads: 0, errors: 0, lastError: '' };

  const fail = (what: string, detail: string) => {
    stats.errors++;
    stats.lastError = `${what}: ${detail}`.slice(0, 300);
    console.warn(`[${label}] ${stats.lastError}`);
  };
  const httpDetail = async (res: Response): Promise<string> => {
    const body: any = await res.json().catch(() => null);
    const e = body?.error || (Array.isArray(body) ? body[0]?.error : null);
    return `HTTP ${res.status}${e?.status ? ` ${e.status}` : ''}${e?.message ? ` — ${String(e.message).slice(0, 160)}` : ''}`;
  };
  const errText = (e: any) => String(e?.message || e || 'network error');

  return {
    stats,

    async get(col, id) {
      try {
        const res = await doFetch(`${base}/${docPath(col, id)}?${key}`);
        if (res.status === 404) { stats.reads += 1; return null; }
        if (!res.ok) { fail(`get ${col}/${id}`, await httpDetail(res)); return null; }
        stats.reads += 1;
        return fromFsDoc(await res.json());
      } catch (e) { fail(`get ${col}/${id}`, errText(e)); return null; }
    },

    async list(col, o) {
      const mask = (o?.mask || []).map(f => `&mask.fieldPaths=${encodeURIComponent(f)}`).join('');
      const docs: FsDoc[] = [];
      let pageToken: string | undefined;
      try {
        do {
          const url = `${base}/${col}?${key}&pageSize=300${mask}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
          const res = await doFetch(url);
          if (!res.ok) { fail(`list ${col} (after ${docs.length} docs)`, await httpDetail(res)); return null; }
          const data: any = await res.json();
          const page: any[] = data.documents || [];
          stats.reads += Math.max(1, page.length);
          for (const d of page) docs.push(fromFsDoc(d));
          pageToken = data.nextPageToken;
        } while (pageToken);
        return docs;
      } catch (e) { fail(`list ${col}`, errText(e)); return null; }
    },

    async where(col, field, op, value, o) {
      try {
        const res = await doFetch(`${base}:runQuery?${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ structuredQuery: buildWhereQuery(col, field, op, value, o?.select) }),
        });
        if (!res.ok) { fail(`query ${col}.${field} ${op}`, await httpDetail(res)); return null; }
        const rows: any[] = await res.json();
        const docs = (Array.isArray(rows) ? rows : []).filter(r => r && r.document).map(r => fromFsDoc(r.document));
        stats.reads += Math.max(1, docs.length);
        return docs;
      } catch (e) { fail(`query ${col}.${field} ${op}`, errText(e)); return null; }
    },

    async getMany(col, ids, o) {
      const unique = [...new Set(ids.map(String).filter(Boolean))];
      const out = new Map<string, FsDoc>();
      try {
        for (let i = 0; i < unique.length; i += BATCH_GET_CHUNK) {
          const chunk = unique.slice(i, i + BATCH_GET_CHUNK);
          const body: any = { documents: chunk.map(id => `${root}/${col}/${id}`) };
          if (o?.mask && o.mask.length) body.mask = { fieldPaths: o.mask };
          const res = await doFetch(`${base}:batchGet?${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) { fail(`batchGet ${col} (${chunk.length} ids)`, await httpDetail(res)); return null; }
          const rows: any[] = await res.json();
          for (const r of Array.isArray(rows) ? rows : []) {
            if (r?.found) { const d = fromFsDoc(r.found); out.set(d.id, d); stats.reads += 1; }
            else if (r?.missing) stats.reads += 1;
          }
        }
        return out;
      } catch (e) { fail(`batchGet ${col}`, errText(e)); return null; }
    },

    async write(col, id, data, o = {}) {
      const fields = toFsFields(data);
      let url = `${base}/${docPath(col, id)}?${key}`;
      if (o.merge) {
        const paths = [...Object.keys(fields), ...(o.deleteFields || [])];
        for (const p of paths) url += `&updateMask.fieldPaths=${encodeURIComponent(p)}`;
      }
      if (o.mustNotExist) url += '&currentDocument.exists=false';
      try {
        const res = await doFetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields }),
        });
        if (res.ok) return true;
        const detail = await httpDetail(res);
        // A create that found the doc already there lost the race — expected.
        if (o.mustNotExist && (res.status === 409 || /ALREADY_EXISTS|FAILED_PRECONDITION/.test(detail))) return false;
        fail(`write ${col}/${id}`, detail);
        return false;
      } catch (e) { fail(`write ${col}/${id}`, errText(e)); return false; }
    },

    async remove(col, id) {
      try {
        const res = await doFetch(`${base}/${docPath(col, id)}?${key}`, { method: 'DELETE' });
        if (res.ok || res.status === 404) return true;
        fail(`delete ${col}/${id}`, await httpDetail(res));
        return false;
      } catch (e) { fail(`delete ${col}/${id}`, errText(e)); return false; }
    },
  };
}
