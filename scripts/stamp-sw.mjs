// Post-build: stamp the service worker with a build hash so every
// deploy gets a unique CACHE_NAME. Without this, old PWA installs
// won't realize there's a new version and keep serving stale shells.
//
// Runs after `vite build` (see package.json "build" script).
import { readFile, writeFile } from 'node:fs/promises';

const SW_PATH = 'dist/sw.js';
const PLACEHOLDER = '__BUILD_HASH__';
const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14); // YYYYMMDDhhmmss

try {
  const src = await readFile(SW_PATH, 'utf8');
  if (!src.includes(PLACEHOLDER)) {
    console.warn(`[stamp-sw] ${SW_PATH} does not contain ${PLACEHOLDER} — already stamped or missing.`);
    process.exit(0);
  }
  const stamped = src.replaceAll(PLACEHOLDER, stamp);
  await writeFile(SW_PATH, stamped, 'utf8');
  console.log(`[stamp-sw] CACHE_NAME stamped: fabtrack-${stamp}`);
} catch (e) {
  console.error('[stamp-sw] failed:', e);
  process.exit(1);
}
