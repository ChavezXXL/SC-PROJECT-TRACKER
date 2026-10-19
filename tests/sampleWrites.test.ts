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
  const KEY = 'nexus_samples';
  const seed = (list: any[]) => store.set(KEY, JSON.stringify(list));
  const read = (id: string): any => JSON.parse(store.get(KEY) || '[]').find((s: any) => s.id === id);

  // SAFETY: prove we're on the fake in-memory store before ANY write.
  seed([{ id: '__probe__' }]);
  const probe: any[] = await new Promise(res => { const u = DB.subscribeSamples((l: any[]) => { res(l); setTimeout(() => u(), 0); }); });
  if (probe.length !== 1 || probe[0].id !== '__probe__') {
    console.error('SAFETY ABORT: samples did not come from the test store — refusing to run writes.');
    process.exit(3);
  }

  const running = { id: 'e2', userId: 'u1', userName: 'Maria', operation: 'Deburr', startTime: 1000, endTime: null, pausedAt: null, totalPausedMs: 0 };
  const done = { id: 'e1', userId: 'u1', userName: 'Maria', operation: 'Tumble', startTime: 1, endTime: 600_001, durationSeconds: 600 };
  seed([{ id: 'S', companyName: 'Acme', partNumber: 'P-1', notes: 'old', workEntries: [done], activeEntry: running, totalWorkedMs: 600_000 }]);

  // The editor saves its fields without timer data (it used to send the copy
  // taken when it opened, undoing timers started/stopped meanwhile).
  const r = await DB.saveSample({ id: 'S', companyName: 'Acme Aero', partNumber: 'P-1', notes: 'new', difficulty: 'medium', createdAt: 1, updatedAt: 2, createdBy: 'admin', photoUrl: '', partName: '' } as any);
  const s = read('S');
  ok('save reports saved', r === 'saved');
  ok('edited fields saved', s.companyName === 'Acme Aero' && s.notes === 'new');
  ok('running timer survives an editor save', s.activeEntry?.id === 'e2');
  ok('finished entries survive', s.workEntries?.length === 1 && s.totalWorkedMs === 600_000);

  // Locking a price writes the price only.
  await DB.saveSample({ id: 'S', pricePerPart: 1.25, quotedAt: 3, updatedAt: 3 } as any);
  const p = read('S');
  ok('price saved', p.pricePerPart === 1.25);
  ok('price save keeps everything else', p.companyName === 'Acme Aero' && p.activeEntry?.id === 'e2');

  // Stopping the timer still works after those saves.
  await DB.stopSampleWork('S');
  const t = read('S');
  ok('timer stopped', !t.activeEntry && t.workEntries.length === 2);

  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
