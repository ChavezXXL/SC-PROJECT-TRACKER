// In-memory stand-in for the Firestore REST API, served through a fake fetch.
// Not a test file itself (no .test.ts) — imported by the cron tests so the
// crons run end-to-end through the real REST client without any network.
//
// Speaks the subset the crons use: GET doc, GET list (mask, pagination),
// POST :runQuery (single fieldFilter, select), POST :batchGet (mask),
// PATCH (updateMask, currentDocument.exists), DELETE.
//
// Reads are billed like Firestore does: get → 1 (even if missing), each list
// page / query → 1 per doc returned (min 1), batchGet → 1 per doc asked for.

import { fromFsValue, toFsFields } from '../utils/firestoreRest';

export interface FakeCall {
  kind: 'get' | 'list' | 'query' | 'batchGet' | 'write' | 'delete';
  col: string;
  id?: string;
  reads: number;
  /** query: "field op"; batchGet: the ids; list: the page offset; write: the options. */
  detail?: any;
  failed?: boolean;
}

type Data = Record<string, any>;

export function createFakeFirestore(projectId = 'test-proj') {
  const store = new Map<string, Map<string, Data>>();
  const calls: FakeCall[] = [];
  let failWhen: ((c: FakeCall) => boolean) | null = null;
  const root = `projects/${projectId}/databases/(default)/documents`;

  const col = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name)!;
  };
  const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const project = (data: Data, fields?: string[]) => {
    if (!fields || !fields.length) return data;
    const out: Data = {};
    for (const f of fields) if (f in data) out[f] = data[f];
    return out;
  };
  const docJson = (c: string, id: string, data: Data, fields?: string[]) =>
    ({ name: `${root}/${c}/${id}`, fields: toFsFields(project(data, fields)) });
  const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const err = (status: number, code: string, message: string) => json({ error: { code: status, status: code, message } }, status);

  const cmp = (a: any, b: any): number | null => {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
    return null;   // range filters only match values of the same type
  };
  const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
  const matches = (data: Data, f: any): boolean => {
    const path = f.field.fieldPath;
    if (!(path in data)) return false;   // docs missing the field never match
    const v = data[path];
    const want = fromFsValue(f.value);
    switch (f.op) {
      case 'EQUAL': return same(v, want);
      case 'IN': return (want as any[]).some(w => same(v, w));
      case 'GREATER_THAN': { const d = cmp(v, want); return d !== null && d > 0; }
      case 'GREATER_THAN_OR_EQUAL': { const d = cmp(v, want); return d !== null && d >= 0; }
      case 'LESS_THAN': { const d = cmp(v, want); return d !== null && d < 0; }
      case 'LESS_THAN_OR_EQUAL': { const d = cmp(v, want); return d !== null && d <= 0; }
      default: throw new Error(`fake firestore: unsupported op ${f.op}`);
    }
  };

  const record = (c: FakeCall): boolean => {
    if (failWhen && failWhen(c)) { c.failed = true; c.reads = 0; calls.push(c); return false; }
    calls.push(c);
    return true;
  };

  async function fakeFetch(input: any, init?: any): Promise<Response> {
    const url = new URL(String(input));
    const method = String(init?.method || 'GET').toUpperCase();
    const prefix = `/v1/${root}`;
    const path = decodeURIComponent(url.pathname);
    if (!path.startsWith(prefix)) throw new Error(`fake firestore: unexpected URL ${url}`);
    const rest = path.slice(prefix.length);
    const body = init?.body ? JSON.parse(String(init.body)) : null;

    if (method === 'POST' && rest === ':runQuery') {
      const q = body.structuredQuery;
      const c = q.from[0].collectionId;
      const f = q.where?.fieldFilter;
      if (!f || q.where.compositeFilter) throw new Error('fake firestore: only single fieldFilter queries');
      const select = q.select?.fields?.map((x: any) => x.fieldPath);
      const hits = [...col(c).entries()].filter(([, d]) => matches(d, f));
      const call: FakeCall = { kind: 'query', col: c, reads: Math.max(1, hits.length), detail: `${f.field.fieldPath} ${f.op}` };
      if (!record(call)) return err(503, 'UNAVAILABLE', 'injected failure');
      if (!hits.length) return json([{ readTime: 'now' }]);
      return json(hits.map(([id, d]) => ({ document: docJson(c, id, d, select), readTime: 'now' })));
    }

    if (method === 'POST' && rest === ':batchGet') {
      const names: string[] = body.documents;
      const mask = body.mask?.fieldPaths;
      const c = names[0]?.slice(root.length + 1).split('/')[0] || '';
      const ids = names.map(n => n.slice(root.length + 1).split('/')[1]);
      const call: FakeCall = { kind: 'batchGet', col: c, reads: names.length, detail: ids };
      if (!record(call)) return err(503, 'UNAVAILABLE', 'injected failure');
      return json(names.map(n => {
        const [cc, id] = n.slice(root.length + 1).split('/');
        const d = col(cc).get(id);
        return d ? { found: docJson(cc, id, d, mask), readTime: 'now' } : { missing: n, readTime: 'now' };
      }));
    }

    const parts = rest.replace(/^\//, '').split('/');
    if (parts.length === 1 && method === 'GET') {
      const c = parts[0];
      const mask = url.searchParams.getAll('mask.fieldPaths');
      const size = Number(url.searchParams.get('pageSize') || 300);
      const offset = Number(url.searchParams.get('pageToken') || 0);
      const all = [...col(c).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const page = all.slice(offset, offset + size);
      const call: FakeCall = { kind: 'list', col: c, reads: Math.max(1, page.length), detail: offset };
      if (!record(call)) return err(503, 'UNAVAILABLE', 'injected failure');
      const out: any = { documents: page.map(([id, d]) => docJson(c, id, d, mask)) };
      if (offset + size < all.length) out.nextPageToken = String(offset + size);
      return json(out);
    }

    if (parts.length === 2) {
      const [c, id] = parts;
      if (method === 'GET') {
        const call: FakeCall = { kind: 'get', col: c, id, reads: 1 };
        if (!record(call)) return err(503, 'UNAVAILABLE', 'injected failure');
        const d = col(c).get(id);
        return d ? json(docJson(c, id, d)) : err(404, 'NOT_FOUND', 'no such document');
      }
      if (method === 'PATCH') {
        const mask = url.searchParams.getAll('updateMask.fieldPaths');
        const mustNotExist = url.searchParams.get('currentDocument.exists') === 'false';
        const call: FakeCall = { kind: 'write', col: c, id, reads: 0, detail: { mask, mustNotExist } };
        if (!record(call)) return err(503, 'UNAVAILABLE', 'injected failure');
        const existing = col(c).get(id);
        if (mustNotExist && existing) return err(409, 'ALREADY_EXISTS', 'document already exists');
        const incoming: Data = {};
        for (const [k, v] of Object.entries(body?.fields || {})) incoming[k] = fromFsValue(v);
        let next: Data;
        if (mask.length) {
          next = { ...(existing || {}) };
          for (const p of mask) { if (p in incoming) next[p] = incoming[p]; else delete next[p]; }
        } else {
          next = incoming;
        }
        col(c).set(id, next);
        return json(docJson(c, id, next));
      }
      if (method === 'DELETE') {
        const call: FakeCall = { kind: 'delete', col: c, id, reads: 0 };
        if (!record(call)) return err(503, 'UNAVAILABLE', 'injected failure');
        col(c).delete(id);
        return json({});
      }
    }
    throw new Error(`fake firestore: unsupported ${method} ${url}`);
  }

  return {
    projectId,
    fetch: fakeFetch as unknown as typeof fetch,
    calls,
    /** Seed / overwrite a document. */
    set(c: string, id: string, data: Data) { col(c).set(id, clone(data)); },
    /** A copy of a document's data, or undefined. */
    get(c: string, id: string): Data | undefined { return clone(col(c).get(id)); },
    all(c: string): (Data & { id: string })[] { return [...col(c).entries()].map(([id, d]) => ({ id, ...clone(d) })); },
    clear(c: string) { col(c).clear(); },
    remove(c: string, id: string) { col(c).delete(id); },
    /** Make matching requests fail with 503 (null to stop). */
    failWhen(fn: ((c: FakeCall) => boolean) | null) { failWhen = fn; },
    /** Total reads billed (optionally only since call index `from`). */
    reads(from = 0) { return calls.slice(from).reduce((a, c) => a + c.reads, 0); },
    callsSince(from: number) { return calls.slice(from); },
  };
}

export type FakeFirestore = ReturnType<typeof createFakeFirestore>;
