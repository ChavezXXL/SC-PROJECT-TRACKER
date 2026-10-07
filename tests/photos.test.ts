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

import { isPlaceholderPartNumber, photoPartKey } from '../utils/partKey';
import { buildPartRiskIndex, computeJobRisk } from '../utils/jobRisk';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

(async () => {
  const DB = await import('../services/mockDb');
  const LSKEY = 'nexus_jobs';
  const seed = (jobs: any[]) => store.set(LSKEY, JSON.stringify(jobs));
  const read = (): any[] => JSON.parse(store.get(LSKEY) || '[]');
  const live = (): Promise<any[]> => new Promise(res => { const u = DB.subscribeJobs(l => { res(l); setTimeout(() => u(), 0); }); });
  const J = (o: any) => ({ jobIdsDisplay: '', poNumber: 'PO', quantity: 1, dateReceived: '', dueDate: '', info: '', status: 'in-progress', createdAt: 1000, ...o });

  // SAFETY: prove we're on the fake in-memory store before ANY write.
  seed([J({ id: '__offline_probe__', partNumber: 'PROBE-1' })]);
  const probe = await live();
  if (probe.length !== 1 || probe[0].id !== '__offline_probe__') {
    console.error('SAFETY ABORT: jobs did not come from the test store — refusing to run writes.');
    process.exit(3);
  }

  // ── Placeholder part numbers ─────────────────────────────────────
  for (const p of ['N/A', 'n/a', 'NA', 'na', 'TBD', '-', '?', 'x', '000', 'XXX', 'see PO', 'Sample', 'MISC', '', '  ']) ok(`placeholder: "${p}"`, isPlaceholderPartNumber(p));
  for (const p of ['AS4307K04', '65993_', '41928', '387-3706-3 / J', '123', '0077426-00', 'P-100']) ok(`real part: "${p}"`, !isPlaceholderPartNumber(p));
  ok('photo key strips spaces', photoPartKey(' AS1008W0808 Rev K ') === 'as1008w0808revk');

  // ── 1. The reported bug: replace a BORROWED photo → must stick ───
  seed([J({ id: 'A', partNumber: 'P-100', poNumber: 'PO-A', partImage: 'data:X', partImageAt: 100 }), J({ id: 'B', partNumber: 'P-100', poNumber: 'PO-B' })]);
  let jobs = await live();
  const B = jobs.find(j => j.id === 'B');
  ok('B borrows A photo', B.partImage === 'data:X' && B.photoInherited === true && B.photoFromPo === 'PO-A');
  // Old editor behavior: replace photo but tag stays → photo dropped (the bug)
  await DB.saveJob({ ...B, partImage: 'data:Y' });
  ok('OLD path reproduces the bug (tag left on → photo dropped)', read().find(j => j.id === 'B').partImage === undefined);
  // New editor behavior (handleImageUpload clears the tag)
  await DB.saveJob({ ...B, partImage: 'data:Y', partImageAt: 200, photoInherited: undefined, photoFromPo: undefined });
  ok('NEW path: replaced photo is saved as B\'s own', read().find(j => j.id === 'B').partImage === 'data:Y');
  ok('UI-only fields never persisted', read().every(j => !('photoInherited' in j) && !('photoFromPo' in j)));

  // ── 2. Saving a job that shows a borrowed photo doesn't copy it ──
  seed([J({ id: 'A', partNumber: 'P-100', partImage: 'data:X', partImageAt: 100 }), J({ id: 'B', partNumber: 'P-100' })]);
  jobs = await live();
  await DB.saveJob({ ...jobs.find(j => j.id === 'B'), dueDate: '10/10/2026' });
  ok('borrowed photo not copied on unrelated save', read().find(j => j.id === 'B').partImage === undefined && read().find(j => j.id === 'B').dueDate === '10/10/2026');

  // ── 3. Newest photo wins (old behavior: any Storage URL beat a newer base64) ─
  seed([
    J({ id: 'old', partNumber: 'P-100', partImage: 'https://storage/old.jpg', partImageAt: 100 }),
    J({ id: 'new', partNumber: 'P-100', partImage: 'data:NEW', partImageAt: 900 }),
    J({ id: 'empty', partNumber: 'P-100' }),
  ]);
  jobs = await live();
  ok('photoless job shows the NEWEST photo', jobs.find(j => j.id === 'empty').partImage === 'data:NEW');
  ok('jobs keep their own photos', jobs.find(j => j.id === 'old').partImage === 'https://storage/old.jpg');

  // ── 4. Placeholder part numbers never pool photos (real case: PO 1014) ─
  seed([J({ id: 'pamco', partNumber: 'N/A', poNumber: 'N/A', partImage: 'data:PAMCO', partImageAt: 100 }), J({ id: 'hinges', partNumber: 'N/A', poNumber: '1014', info: 'DEBURR HINGES' })]);
  jobs = await live();
  ok('N/A job does NOT show another N/A job\'s photo', !jobs.find(j => j.id === 'hinges').partImage);

  // ── 5. setJobPhoto writes only photo fields; null really deletes ──
  seed([J({ id: 'C', partNumber: 'P-200', dueDate: '01/01/2027', partImage: 'data:OLD', partImageAt: 5 })]);
  await DB.setJobPhoto('C', 'data:FRESH');
  let C = read().find(j => j.id === 'C');
  ok('setJobPhoto sets photo + timestamp, keeps other fields', C.partImage === 'data:FRESH' && C.partImageAt > 5 && C.dueDate === '01/01/2027');
  await DB.setJobPhoto('C', null);
  C = read().find(j => j.id === 'C');
  ok('setJobPhoto(null) really removes the photo', !('partImage' in C) && !('partImageAt' in C) && C.dueDate === '01/01/2027');

  // ── 6. partPhotoFor (editor preview for new jobs) ────────────────
  const pool: any[] = [J({ id: 'a', partNumber: 'P-100', partImage: 'data:1', partImageAt: 10, poNumber: 'PO-1' }), J({ id: 'b', partNumber: 'p-100 ', partImage: 'data:2', partImageAt: 20, poNumber: 'PO-2' })];
  ok('partPhotoFor returns newest + its PO', DB.partPhotoFor(pool, 'P-100')?.url === 'data:2' && DB.partPhotoFor(pool, 'P-100')?.po === 'PO-2');
  ok('partPhotoFor excludes the job itself', DB.partPhotoFor(pool, 'P-100', 'b')?.url === 'data:1');
  ok('partPhotoFor: placeholder → null', DB.partPhotoFor(pool, 'N/A') === null);

  // ── 7. Risk tiers: N/A jobs don't pool into "repeat part" ────────
  const NOW = Date.now();
  const naDone = [1, 2, 3, 4].map(i => J({ id: 'na' + i, partNumber: 'N/A', status: 'completed', completedAt: NOW - i * 86400000 }));
  const naOpen = J({ id: 'naOpen', partNumber: 'N/A', quoteAmount: 200 });
  const idx = buildPartRiskIndex([...naDone, naOpen], [], [], NOW);
  const r = computeJobRisk(naOpen, idx, { now: NOW });
  ok('new N/A job is NOT green from other N/A runs', r.tier !== 'green' && r.reasons[0].includes('No real part number'));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
