// localStorage shim so mockDb runs in its offline (localStorage) mode under node.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
(globalThis as any).window = globalThis;

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

(async () => {
  const DB = await import('../services/mockDb');
  const LSKEY = 'nexus_jobs';
  const seed = (jobs: any[]) => store.set(LSKEY, JSON.stringify(jobs));
  const read = (id: string): any => JSON.parse(store.get(LSKEY) || '[]').find((j: any) => j.id === id);
  const live = (): Promise<any[]> => new Promise(res => { const u = DB.subscribeJobs(l => { res(l); setTimeout(() => u(), 0); }); });
  const J = (o: any) => ({ jobIdsDisplay: '', poNumber: 'PO', partNumber: 'P-1', quantity: 10, dateReceived: '', dueDate: '', info: '', status: 'pending', createdAt: 1000, ...o });

  // SAFETY: prove we're on the fake in-memory store before ANY write.
  seed([J({ id: '__offline_probe__' })]);
  const probe = await live();
  if (probe.length !== 1 || probe[0].id !== '__offline_probe__') {
    console.error('SAFETY ABORT: jobs did not come from the test store — refusing to run writes.');
    process.exit(3);
  }

  // ── An emptied field really clears (it used to come back) ─────────
  seed([J({ id: 'A', quoteAmount: 500, pricePerPart: 50, trackingNumber: '1Z999', expectedHours: 4 })]);
  const editorCopy = { ...read('A'), quoteAmount: undefined, trackingNumber: undefined };
  const r1 = await DB.saveJob(editorCopy, { clear: ['quoteAmount', 'trackingNumber'] });
  const a = read('A');
  ok('saveJob reports saved', r1 === 'saved');
  ok('emptied quote is gone', !('quoteAmount' in a));
  ok('emptied tracking number is gone', !('trackingNumber' in a));
  ok('untouched price stays', a.pricePerPart === 50);
  ok('untouched hours stay', a.expectedHours === 4);

  // A field listed to clear but given a value in the same save keeps the value.
  await DB.saveJob({ ...read('A'), quoteAmount: 750 }, { clear: ['quoteAmount'] });
  ok('clear never wipes a value being saved', read('A').quoteAmount === 750);

  // Without `clear`, an undefined field is left alone (plain merge, as before).
  await DB.saveJob({ ...read('A'), pricePerPart: undefined });
  ok('plain save keeps fields it leaves out', read('A').pricePerPart === 50);

  // ── One-field updates don't touch the rest of the job ────────────
  seed([J({ id: 'B', priority: 'low', dueDate: '10/20/2026', jobNotes: [{ id: 'n1', text: 'hi' }] })]);
  const r2 = await DB.updateJobFields('B', { priority: 'urgent' });
  const b = read('B');
  ok('updateJobFields reports saved', r2 === 'saved');
  ok('priority changed', b.priority === 'urgent');
  ok('due date untouched', b.dueDate === '10/20/2026');
  ok('notes untouched', Array.isArray(b.jobNotes) && b.jobNotes.length === 1);
  await DB.updateJobFields('B', { portalNote: { text: 'Ships Friday', updatedAt: 1 } as any });
  ok('portal note saved', read('B').portalNote?.text === 'Ships Friday');
  await DB.updateJobFields('B', { portalNote: undefined });
  ok('undefined deletes the portal note', !('portalNote' in read('B')));
  await DB.updateJobFields('missing', { priority: 'high' });
  ok('unknown job is a no-op', read('missing') === undefined);

  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
