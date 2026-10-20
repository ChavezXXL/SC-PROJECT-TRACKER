// Delivery GPS + stop-merge helpers. Pure functions only — nothing here writes
// to a database (mockDb is only pulled in by the view's imports, offline).

// localStorage shim — the tracker keeps its live-session copy there.
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
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

(async () => {
  const { thinTrack, polylineMiles } = await import('../utils/geo');
  const T = await import('../services/gpsTracker');

  // ── thinTrack: hard cap, first + last kept ────────────────────────
  const line = (n: number, t0 = 0) => Array.from({ length: n }, (_, i) => ({ lat: 33 + i * 0.001, lon: -117, t: t0 + i * 10_000, acc: 10 }));
  for (const [n, max] of [[1000, 500], [501, 500], [999, 400], [10, 2], [3, 2]] as const) {
    const out = thinTrack(line(n), max);
    ok(`thinTrack ${n}→≤${max}`, out.length <= max);
    ok(`thinTrack ${n} keeps first+last`, out[0].lat === 33 && out[out.length - 1].lat === 33 + (n - 1) * 0.001);
  }
  ok('thinTrack small list untouched', thinTrack(line(5), 500).length === 5);

  // ── acceptFix: filtering + running miles ──────────────────────────
  const s = T.createGpsSession('run1');
  ok('first fix accepted', T.acceptFix(s, { lat: 33, lon: -117, t: 0, acc: 10 }));
  ok('junk accuracy dropped', !T.acceptFix(s, { lat: 33.01, lon: -117, t: 1000, acc: 150 }));
  ok('jitter < 30 m within 2 min dropped', !T.acceptFix(s, { lat: 33.0001, lon: -117, t: 5000, acc: 10 }));
  ok('NaN fix dropped', !T.acceptFix(s, { lat: NaN, lon: -117, t: 6000 }));
  ok('parked fix after 2 min kept…', T.acceptFix(s, { lat: 33.0001, lon: -117, t: 130_000, acc: 10 }));
  ok('…but adds no miles', s.miles === 0);
  T.acceptFix(s, { lat: 33.01, lon: -117, t: 140_000, acc: 10 });
  ok('miles match the polyline', near(s.miles, polylineMiles(s.points)));

  // Long drive: thinning keeps the track bounded and never changes the miles.
  const long = T.createGpsSession('run2');
  const pts = line(2000, 1_000_000);
  for (const p of pts) T.acceptFix(long, p);
  ok('track stays ≤ MAX_TRACK_POINTS', long.points.length <= T.MAX_TRACK_POINTS);
  ok('thinning keeps the full miles', near(long.miles, polylineMiles(pts), 1e-6));
  ok('trackForSave ≤ 500', T.trackForSave(long).length <= 500);
  ok('trackForSave trims coordinates', T.trackForSave(long).every(p => (String(p.lat).split('.')[1] || '').length <= 5));
  ok('trackForSave keeps the last fix', T.trackForSave(long).slice(-1)[0].t === pts[pts.length - 1].t);

  // ── Stored session: survives a reload, only for the same run ───────
  long.savedMiles = 3.25;
  T.saveStoredSession(long);
  const back = T.loadStoredSession('run2');
  ok('stored session reloads', !!back && back.runId === 'run2');
  ok('reloaded miles intact', !!back && near(back.miles, long.miles));
  ok('reloaded savedMiles intact', !!back && back.savedMiles === 3.25);
  ok('reloaded points', !!back && back.points.length === T.trackForSave(long).length);
  ok('reloaded session not watching', !!back && back.watchId === null);
  ok('other run → no session', T.loadStoredSession('someOtherRun') === null);
  // Resuming continues from the last stored point (a gap counts as a straight line).
  if (back) {
    const before = back.miles;
    const last = pts[pts.length - 1];
    T.acceptFix(back, { lat: last.lat + 0.01, lon: last.lon, t: last.t + 600_000, acc: 10 });
    ok('resume keeps counting from the stored total', back.miles > before + 0.6 && back.miles < before + 0.8);
  }
  T.clearStoredSession('someOtherRun');
  ok("clear for another run leaves it", T.loadStoredSession('run2') !== null);
  T.clearStoredSession('run2');
  ok('clear removes it', T.loadStoredSession() === null);
  store.set('fabtrack_gps_session', '{not json');
  ok('corrupt storage → null, no throw', T.loadStoredSession() === null);
  store.set('fabtrack_gps_session', JSON.stringify({ v: 1, runId: 'r', miles: -5, points: [{ lat: 1, lon: 2 }, { lat: 'x' }] }));
  const odd = T.loadStoredSession('r');
  ok('bad numbers / points sanitized', !!odd && odd.miles === 0 && odd.points.length === 1);

  // ── View helpers: stop merge, stop patch, photo budget ─────────────
  const V = await import('../views/DeliveriesView');
  const opened = [
    { id: 'a', address: '1 Main', jobIds: ['j1'], customerName: 'ACME' },
    { id: 'b', address: '2 Oak', jobIds: [] },
    { id: 'c', address: '3 Pine', jobIds: [] },
  ];
  // Driver recorded progress while the office had the editor open; another device added stop d.
  const live = [
    { ...opened[0], arrivedAt: 100, completedAt: 200, photoUrl: 'data:image/jpeg;base64,AAA', signedBy: 'Joe' },
    { ...opened[1], isException: true, exceptionReason: 'Closed', arrivedAt: 150, arrivalLat: 1, arrivalLon: 2 },
    { ...opened[2], address: '3 Pine Suite B' },
    { id: 'd', address: '4 Elm', jobIds: [] },
  ];
  // Office: re-ordered b before a, changed a's address, removed c, added e.
  const edited = [
    { ...opened[1] },
    { ...opened[0], address: '1 Main St' },
    { id: 'e', address: '5 Ash', jobIds: [] },
  ];
  const merged = V.mergeEditedStops(live as any, opened as any, edited as any);
  const byId = (id: string) => merged.find(x => x.id === id) as any;
  ok('merge: editor order, removed c, added e, kept d', merged.map(x => x.id).join() === 'b,a,e,d');
  ok("merge: editor's address change wins", byId('a').address === '1 Main St');
  ok('merge: arrival/done/photo/signature kept', byId('a').arrivedAt === 100 && byId('a').completedAt === 200 && !!byId('a').photoUrl && byId('a').signedBy === 'Joe');
  ok('merge: exception + arrival location kept', byId('b').isException === true && byId('b').exceptionReason === 'Closed' && byId('b').arrivalLat === 1);
  ok('merge: untouched fields keep the live value', byId('a').customerName === 'ACME');
  const cleared = V.mergeEditedStops(live as any, opened as any, [{ ...opened[0], customerName: undefined }] as any);
  ok('merge: field cleared in the editor is cleared', !('customerName' in (cleared.find(x => x.id === 'a') as any)));
  const untouchedEdit = V.mergeEditedStops(live as any, opened as any, opened as any);
  ok('merge: unchanged stop takes the other device\'s edit', (untouchedEdit.find(x => x.id === 'c') as any).address === '3 Pine Suite B');
  const goneElsewhere = V.mergeEditedStops([live[0]] as any, opened as any, opened as any);
  ok('merge: stop removed elsewhere and untouched here stays removed', goneElsewhere.map(x => x.id).join() === 'a');

  const st = { id: 'a', address: 'x', jobIds: [], arrivedAt: 100 } as any;
  ok('patch: recorded arrival not moved by a late tap', V.applyStopPatch(st, { arrivedAt: 999, arrivalLat: 5 }).arrivedAt === 100);
  ok('patch: clearing a flag removes the field', !('exceptionReason' in V.applyStopPatch({ ...st, isException: true, exceptionReason: 'r' }, { isException: false, exceptionReason: undefined })));
  ok('patch: completedAt first wins', V.applyStopPatch({ ...st, completedAt: 5 }, { completedAt: 9 }).completedAt === 5);

  const run = (photos: number, stops: number) => ({
    id: 'r', runNumber: 'DEL-1', driverId: 'u', driverName: 'U', status: 'in-progress', createdAt: 0, updatedAt: 0,
    stops: Array.from({ length: stops }, (_, i) => ({ id: `s${i}`, address: 'a', jobIds: [], ...(i < photos ? { photoUrl: 'x'.repeat(150_000) } : {}) })),
  }) as any;
  ok('budget: capped per photo', V.runPhotoBudget(run(0, 2), 's0') === 150_000);
  ok('budget: shared when many stops wait', V.runPhotoBudget(run(0, 12), 's0') < 90_000);
  const full = run(6, 8);
  const b = V.runPhotoBudget(full, 's6');
  ok('budget: last photos fit under ~1 MB', JSON.stringify(full).length + b * 2 < 1_000_000);
  ok('budget: never negative', V.runPhotoBudget(run(7, 7), 's0') >= 0);

  console.log(`deliveryGps: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
