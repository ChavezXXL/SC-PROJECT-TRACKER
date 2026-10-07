// Offline only (tests/run.mjs stubs the Firebase client).
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

// A device that ran the old code has the planted backdoor accounts saved —
// next to a real local account.
store.set('nexus_users', JSON.stringify([
  { id: 'admin1', name: 'Shop Manager', username: 'admin', pin: '9999', role: 'admin', isActive: true },
  { id: 'emp1', name: 'Operator 1', username: 'op1', pin: '1234', role: 'employee', isActive: true },
  { id: 'u-real', name: 'Victor', username: 'victor', pin: '4821', role: 'employee', isActive: true },
  { id: 'u-gone', name: 'Old Hand', username: 'oldhand', pin: '1111', role: 'employee', isActive: false },
]));

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

(async () => {
  const DB = await import('../services/mockDb');
  const saved = JSON.parse(store.get('nexus_users') || '[]');
  ok('planted admin/9999 purged from this device', !saved.some((u: any) => u.username === 'admin'));
  ok('planted op1/1234 purged from this device', !saved.some((u: any) => u.username === 'op1'));
  ok('real local account kept', saved.some((u: any) => u.id === 'u-real'));

  ok('admin / 9999 no longer logs in', (await DB.loginUser('admin', '9999')) === null);
  ok('op1 / 1234 no longer logs in', (await DB.loginUser('op1', '1234')) === null);
  ok('real account still logs in (trims mobile-keyboard spaces)', (await DB.loginUser(' Victor ', '4821 '))?.id === 'u-real');
  ok('wrong PIN rejected', (await DB.loginUser('victor', '0000')) === null);
  ok('deactivated account rejected', (await DB.loginUser('oldhand', '1111')) === null);

  // A planted account can't come back through the users feed either.
  const users: any[] = await new Promise(res => { const u = DB.subscribeUsers(l => { res(l); setTimeout(() => u(), 0); }); });
  ok('users feed has no backdoor accounts', !users.some(u => u.username === 'admin' || u.username === 'op1'));

  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
