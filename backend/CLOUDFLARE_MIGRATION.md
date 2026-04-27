# FabTrack IO — Cloudflare Migration Runbook

> **Status:** Phase A complete (config + functions written, parallel deploy possible).
> Phase B (DNS cutover, Netlify decommission) blocked on you.
>
> The current SC Deburring install on Netlify keeps running while we set up
> Cloudflare alongside. **Nothing is decommissioned until you say so.**

---

## What was added

| File | Purpose |
|---|---|
| `wrangler.toml` | Cloudflare Pages + Workers config. Future bindings (R2, KV, D1, Queues, Cron) commented out, ready when needed. |
| `functions/api/gemini.ts` | Pages Function — server-side Gemini proxy. Behavior identical to old Netlify function. |
| `functions/api/send-push.ts` | Pages Function — web push delivery. Uses `nodejs_compat` so the existing `web-push` library works unchanged. |
| `public/_headers` | Cache control headers (replaces `netlify.toml [[headers]]`). |
| `public/_redirects` | SPA fallback + **legacy bridge** that rewrites `/.netlify/functions/*` → `/api/*` so existing client code works on Cloudflare without changes. |
| `package.json` | Added `wrangler` + `@cloudflare/workers-types` to devDependencies; `dev:cf` and `deploy:cf` scripts. |

## What was NOT touched

- Existing `netlify.toml`, `netlify/functions/gemini.ts`, `netlify/functions/send-push.ts` → **left in place**. The current production deploy on Netlify keeps running. We delete these only after you confirm the Cloudflare deploy is green.
- All client code (POScanner, SettingsView, geminiService.ts) still fetches `/.netlify/functions/...`. That keeps working on Netlify and ALSO works on Cloudflare via the `_redirects` rewrite. Zero client edits required for the migration itself.

---

## How to bring up Cloudflare (one-time)

1. **Install the new dev dependency** (run once locally):
   ```bash
   npm install
   ```
   This pulls `wrangler` + `@cloudflare/workers-types`.

2. **Sign in to Cloudflare** (one-time):
   ```bash
   npx wrangler login
   ```
   Browser pops, authorize, done.

3. **Connect the GitHub repo to Cloudflare Pages** (dashboard, easiest):
   - Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git
   - Pick `ChavezXXL/SC-PROJECT-TRACKER`
   - Build command: `npm run build`
   - Output dir: `dist`
   - Pages auto-detects the `functions/` folder → all functions deploy automatically.

4. **Set environment variables** (Cloudflare dashboard → Pages → Settings → Environment Variables):
   - `GEMINI_API_KEY` — your Gemini key
   - `VAPID_PUBLIC_KEY` — same key currently in Netlify
   - `VAPID_PRIVATE_KEY` — same
   - `VAPID_SUBJECT` — `mailto:admin@fabtrack.io` (or your address)

   Or via CLI:
   ```bash
   npx wrangler pages secret put GEMINI_API_KEY --project-name fabtrack-io
   npx wrangler pages secret put VAPID_PUBLIC_KEY --project-name fabtrack-io
   npx wrangler pages secret put VAPID_PRIVATE_KEY --project-name fabtrack-io
   npx wrangler pages secret put VAPID_SUBJECT --project-name fabtrack-io
   ```

5. **First deploy** — push a commit to master, or run:
   ```bash
   npm run deploy:cf
   ```
   You'll get a `*.pages.dev` URL like `fabtrack-io.pages.dev`.

6. **Smoke test the Cloudflare deploy** (don't touch DNS yet):
   - Open `https://fabtrack-io.pages.dev`
   - App loads
   - Settings → AI Status panel: should show "Cloud AI Connected"
   - Hit `https://fabtrack-io.pages.dev/api/gemini` (GET) — returns `{"ok":true,"keyConfigured":true}`
   - Try a PO scan — should hit Gemini and return data

7. **DNS cutover** (when CF preview tests pass):
   - Cloudflare → Pages → fabtrack-io → Custom domains → add your apex (`fabtrack.io`) and `app.fabtrack.io`
   - Update DNS records — Cloudflare guides you; if your domain is already on Cloudflare DNS this is one click
   - Netlify deploy stops receiving traffic
   - **At this point you can decommission Netlify**: delete `netlify.toml`, delete `netlify/functions/`, remove `@netlify/functions` from devDependencies.

---

## Local development

The Vite dev server keeps working as before (`npm run dev`). For testing the Pages Functions locally, use:

```bash
npm run dev:cf
```

This starts Wrangler's dev server which bundles `functions/api/*.ts` and serves them at `http://localhost:8788/api/*`. The Vite dev server is proxied so your app hits Vite for static + Wrangler for functions.

---

## Local dev paths to know

| URL | Where it goes |
|---|---|
| `npm run dev` only | `http://localhost:3000` — static + HMR. Functions return 404. |
| `npm run dev:cf` | `http://localhost:8788` — static + functions. |
| `npm run deploy:cf` | Builds + deploys to `*.pages.dev`. |

---

## Rollback plan

If anything is broken on Cloudflare:
1. Don't change DNS — Netlify is still serving the prod traffic.
2. If DNS was already changed, point it back to Netlify (revert the Cloudflare custom-domain config).
3. Open an issue, fix, redeploy.

The `_redirects` legacy bridge means the moment we cut DNS to CF, every existing client request still works on the new platform.

---

## What's next (after Cloudflare is live and stable)

Once the prod deploy is on Cloudflare and stable for a week:

1. **Migrate client URLs** — rename `/.netlify/functions/...` to `/api/...` in:
   - `POScanner.tsx:261`
   - `views/SettingsView.tsx:57, 121, 223, 238`
   - `services/geminiService.ts:7`
   Removes the legacy bridge; cleaner URLs.

2. **Delete Netlify config** — `netlify.toml`, `netlify/functions/`, drop `@netlify/functions` from devDependencies.

3. **Set up R2 bucket** for file storage (drawings, photos, attachments). Currently inline base64 in Firestore — works for small files, will hit Firestore document size limits at scale.

4. **Set up Cron Triggers** in `wrangler.toml` for the trial-expiry + dunning workflow (Phase 3).

5. **Set up KV namespace** for tenant-id-by-slug lookup cache (faster than Firestore on every request).

These are all opt-in, none affect what's already deployed.

---

## Cost projection (revisit at 50 / 100 customers)

| Tier | Pages | Functions | R2 | Total |
|---|---|---|---|---|
| 0–10 customers | $0 | $0 | $0 | **$0** |
| 50 customers | $0 | $0 (under free tier) | ~$2/mo | **~$2/mo** |
| 100 customers | $0 | $5/mo (Workers Paid for higher quotas) | ~$5/mo | **~$10/mo** |
| 500 customers | $0 | $5/mo | ~$25/mo | **~$30/mo** |

For comparison, Netlify Pro at 100 customers with similar usage would be ~$200/mo. CF saves ~$2,000+/year.

---

## Troubleshooting

**"Functions not deploying"** — Make sure the build output dir in CF dashboard is `dist`, not `functions/`. Pages Functions are auto-detected from the `functions/` directory at the project root.

**"web-push fails with crypto error"** — Check `wrangler.toml` has `compatibility_flags = ["nodejs_compat"]`. Without that, Node's `crypto` module isn't available.

**"Old `/.netlify/functions/...` URL returns 404 on Cloudflare"** — Check `public/_redirects` got copied into `dist/_redirects` at build time. Vite copies everything from `public/` automatically; if your custom build excludes it, add a step to copy.

**"VAPID keys mismatch"** — The public key set in Cloudflare env must match the `VAPID_KEY` constant in `utils/vapid.ts` exactly. If you generate new VAPID keys, update both at the same time and have all clients re-register their push subscriptions.
