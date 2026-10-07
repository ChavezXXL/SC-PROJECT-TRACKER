// npm test — bundles each tests/*.test.ts with esbuild and runs it under node.
//
// Firebase is HARD-DISABLED: services/firebaseClient is swapped for a stub that
// never connects, so tests can only ever touch an in-memory localStorage. The
// app ships a built-in production config, so without this a test that calls
// saveJob() would write to the real shop database.
import { build } from 'esbuild';
import { readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter(f => f.endsWith('.test.ts')).sort();
const outDir = mkdtempSync(join(tmpdir(), 'fabtrack-tests-'));
let failed = 0;

for (const f of files) {
  let stubbed = 0;
  const out = join(outDir, f.replace(/\.ts$/, '.cjs'));
  await build({
    entryPoints: [join(here, f)], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
    plugins: [{
      name: 'no-firebase',
      setup(b) {
        b.onResolve({ filter: /firebaseClient$/ }, () => { stubbed++; return { path: 'stub', namespace: 'fb-stub' }; });
        b.onLoad({ filter: /.*/, namespace: 'fb-stub' }, () => ({
          loader: 'js',
          contents: `export const saveFirebaseConfig = () => {};
                     export function initFirebaseFromLocalStorage() { return { ok: false, error: 'disabled in tests' }; }
                     export async function validateConnection() { throw new Error('disabled in tests'); }`,
        }));
      },
    }],
  });
  process.stdout.write(`\n▶ ${f}${stubbed ? ' (offline)' : ''}\n`);
  const r = spawnSync(process.execPath, [out], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
rmSync(outDir, { recursive: true, force: true });
console.log(failed ? `\n✗ ${failed} test file(s) failed` : `\n✓ all ${files.length} test file(s) passed`);
process.exit(failed ? 1 : 0);
