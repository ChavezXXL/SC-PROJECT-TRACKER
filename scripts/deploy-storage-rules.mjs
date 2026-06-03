// scripts/deploy-storage-rules.mjs
// ─────────────────────────────────────────────────────────────────────
// Deploys storage.rules to Firebase Storage using the service account
// already stored in the FIREBASE_SERVICE_ACCOUNT Netlify env var.
//
// Runs automatically at the end of every Netlify build (see netlify.toml).
// Safe to re-run: deploying the same rules is a no-op from Firebase's POV.
//
// No extra npm packages needed — uses Node 18+ built-ins only.
// ─────────────────────────────────────────────────────────────────────

import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';

// ── 1. Read inputs ────────────────────────────────────────────────
const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!svcJson) {
  console.warn('[storage-rules] FIREBASE_SERVICE_ACCOUNT not set — skipping Storage rules deploy.');
  process.exit(0);
}

let svc;
try {
  svc = JSON.parse(svcJson);
} catch {
  console.error('[storage-rules] FIREBASE_SERVICE_ACCOUNT is not valid JSON — skipping.');
  process.exit(0);
}

const projectId  = svc.project_id;
// Use the actual Firebase Storage bucket name (NOT the legacy .appspot.com form).
// The Firebase console shows this under Storage → bucket URL.
const bucketName = svc.storage_bucket || `${projectId}.firebasestorage.app`;

let rulesSource;
try {
  rulesSource = await readFile('storage.rules', 'utf8');
} catch {
  console.warn('[storage-rules] storage.rules not found — skipping.');
  process.exit(0);
}

// ── 2. Create a short-lived OAuth2 access token ──────────────────
function b64url(str) {
  return Buffer.from(str).toString('base64url');
}

function makeJwt(svc) {
  const now  = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({
    iss: svc.client_email,
    sub: svc.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: [
      'https://www.googleapis.com/auth/firebase',
      'https://www.googleapis.com/auth/cloud-platform',
    ].join(' '),
  }));
  const sign = createSign('RSA-SHA256');
  sign.update(`${head}.${body}`);
  const sig = sign.sign(svc.private_key, 'base64url');
  return `${head}.${body}.${sig}`;
}

async function getAccessToken(svc) {
  const jwt = makeJwt(svc);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token exchange failed: ' + JSON.stringify(data));
  return data.access_token;
}

// ── 3. Deploy via Firebase Security Rules REST API ───────────────
async function deployRules(token, projectId, bucketName, rulesSource) {
  const baseUrl = 'https://firebaserules.googleapis.com/v1';
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // Step A: create a new ruleset
  const createRes = await fetch(`${baseUrl}/projects/${projectId}/rulesets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      source: {
        files: [{ name: 'storage.rules', content: rulesSource }],
      },
    }),
  });
  const rulesetData = await createRes.json();
  if (!createRes.ok || !rulesetData.name) {
    throw new Error('Ruleset create failed: ' + JSON.stringify(rulesetData));
  }
  const rulesetName = rulesetData.name;
  console.log('[storage-rules] Created ruleset:', rulesetName);

  // Step B: apply the ruleset to the storage release
  const releaseName = `projects/${projectId}/releases/firebase.storage/${bucketName}`;
  const patchRes = await fetch(`${baseUrl}/${releaseName}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ release: { name: releaseName, rulesetName } }),
  });
  const patchData = await patchRes.json();
  if (!patchRes.ok) {
    // Release might not exist yet — create it
    if (patchRes.status === 404) {
      const putRes = await fetch(`${baseUrl}/projects/${projectId}/releases`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ release: { name: releaseName, rulesetName } }),
      });
      const putData = await putRes.json();
      if (!putRes.ok) throw new Error('Release create failed: ' + JSON.stringify(putData));
      console.log('[storage-rules] Created release:', releaseName);
    } else {
      throw new Error('Release patch failed: ' + JSON.stringify(patchData));
    }
  } else {
    console.log('[storage-rules] Updated release:', releaseName);
  }
}

// ── 4. Run ───────────────────────────────────────────────────────
try {
  console.log('[storage-rules] Deploying storage.rules to project:', projectId);
  const token = await getAccessToken(svc);
  await deployRules(token, projectId, bucketName, rulesSource);
  console.log('[storage-rules] ✅ Storage rules deployed successfully.');
} catch (e) {
  // Non-fatal: a rules deploy failure must not break the whole Netlify build.
  // Photos will still work via base64 fallback (30-80 KB after our compression fix).
  console.warn('[storage-rules] ⚠ Deploy failed (non-fatal):', e.message);
}
