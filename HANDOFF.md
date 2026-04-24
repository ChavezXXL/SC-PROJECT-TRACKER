# HANDOFF — pick up here

> **Paste the block below into a fresh Claude chat.** It has everything the
> next agent needs to keep moving without re-asking us for context.

---

## 🚀 Prompt to paste into the new chat

```
You're continuing work on FabTrack IO — a shop management SaaS built by
SC Deburring LLC (a working Fresno deburring shop). The codebase is a
Vite + React + Firebase (Firestore) PWA deployed to Netlify from
github.com/ChavezXXL/SC-PROJECT-TRACKER (master branch).

## READ FIRST (in this order)
1. BRAND.md — official brand: "FabTrack IO" (NOT "SC Tracker" or "Shop OS")
2. marketing/LANDING_PAGE_BRIEF.md — pricing tiers + feature lock spec
3. public/brand/README.md — logo file expectations
4. types.ts — understand the data model before editing views
5. Recent commits: `git log --oneline -15` — see what the last agent shipped

## HARD RULES
- DO NOT call this product "Shop OS" or "SC Tracker" — it's FabTrack IO.
- DO NOT rebuild things that already exist. Read the file before editing.
- DO NOT ship an audit that only checks "does the view render?" — you must
  INTERACT with forms (type into inputs, click Save, click Delete) and
  verify behavior. The last agent shipped 3 real bugs because they only
  tested navigation.
- DO NOT use native `alert()` or `confirm()` for anything customer-visible.
  Use the Toast component + the shared `ConfirmationModal` (passed as the
  `confirm` prop to each view).
- All modals MUST be portaled to document.body via createPortal AND use
  an opaque backdrop (`bg-zinc-950`, not `bg-black/70`). We have TWO
  shared primitives for this:
    - components/Modal.tsx — when you want the full header/body/footer API
    - components/Overlay.tsx — when you need a custom-chrome modal
  Never write a fresh `<div className="fixed inset-0 z-[50] …">`.

## FILE MAP (the important ones)
- App.tsx (5,524 lines) — still too big; contains Jobs view, Team view,
  shared hooks (useIsMobile, getStages/getJobStage/getNextStage), the
  top-level router. Reasonable next extraction: JobsView into views/.
- views/SettingsView.tsx (~4,200 lines) — was extracted from App.tsx
  last session. Contains 18 sub-editors. Works but could be split into
  views/settings/{Profile,Schedule,Production,Financial,Goals,Documents,
  Tv,System}.tsx for maintainability.
- views/PurchaseOrdersView.tsx (~900 lines) — enterprise PO system
- views/JobBoardView.tsx, DeliveriesView.tsx, LogsView.tsx,
  QualityView.tsx, ReportsView.tsx
- CustomerPortal.tsx — what customers see at ?c={slug}
- LiveFloorMonitor.tsx — shop-floor TV display
- SamplesView.tsx — one-off test work tracking
- QuotesView.tsx — quote builder with process library
- components/
  - Modal.tsx, Overlay.tsx — modal primitives (use these!)
  - ShopFlowMap.tsx — the stage pipeline on Overview
  - OperationsStageMapper.tsx — drag ops into stages
  - VendorsManager.tsx — vendor CRUD used by PO
  - CommandPalette.tsx — Cmd+K
  - OnboardingWizard.tsx, ClientUpdateGenerator.tsx, Toast.tsx, Avatar
- services/
  - mockDb.ts — Firestore + localStorage fallback; all DB calls here
  - pdfService.ts — printable Traveler/Quote/PO
  - geminiService.ts — Google Gemini AI (PO scanning)
  - gpsTracker.ts — delivery mileage
  - reminders.ts, shiftAlarms.ts
- utils/ — customers.ts, date.ts, stageRouting.ts, clientUpdate.ts,
  flowMetrics.ts, format.ts, geo.ts, goals.ts, partHistory.ts, url.ts,
  vapid.ts, devMode.ts

## HOW TO TEST (don't skip this)
There's a Vite dev server on port 3000 via:
  mcp__Claude_Preview__preview_start { name: "dev" }

For every fix, follow this workflow:
  1. Open the preview, navigate to the affected view
  2. Use preview_eval to simulate clicking buttons, typing into inputs,
     saving forms. INTERACT — don't just check "did the page load?"
  3. After saving, verify the data actually persisted (re-open the modal
     or re-query DB)
  4. Check console for errors: preview_console_logs with level: "error"
  5. Only then commit.

## KNOWN INCOMPLETE AREAS (honest list)
Things that exist but need real polish before sale:
- No Stripe billing or tier-gating yet. Feature-flag pattern is set up via
  settings.enabledFeatures but nothing actually reads those flags to
  hide/show UI. This is the #1 blocker for monetization.
- No 14-day trial logic (settings.trialEndsAt doesn't exist yet).
- Still uses the Tailwind CDN (see index.html) — works but emits a
  production warning in console. Needs a Vite PostCSS migration.
- AI PO scanner still gated by isDeveloper() and hits Gemini directly.
  Per landing brief, AI should be Shop OS tier only.
- The following flows haven't been end-to-end tested programmatically:
  Samples work-timer start/stop, Deliveries GPS tracking, Kanban
  drag-and-drop, printing PDFs, Google Calendar sync, push notification
  registration.
- Customer Portal: year-grouped completed jobs ships, but the admin
  Portal Preview modal needs a "send a quick update" button per job that
  doesn't require opening the full Job edit modal.
- alert() and confirm() still present in 6 files (find via grep). Replace
  with Toast + ConfirmationModal.
- Overview page: "0% on-time" and "-$5.3k Net Profit" show even when
  there's no data. Should display "—" with explanatory subtitle when
  <10 completed jobs or no quote amounts exist.
- `Samples` view: the Start Work modal + Work History modal need a UX
  pass. User said "Samples can use a touch up."
- `Quality` view: user said "make it make more sense." Consider adding
  cost-impact column ($ lost per rework), trend chart over 8 weeks, and
  grouping by part number to surface repeat offenders.
- Landing page from the brief has NOT been built yet. marketing/
  LANDING_PAGE_BRIEF.md is a self-contained spec.

## DATA MODEL HIGHLIGHTS
- Job has `portalNote: { text, expectedDate?, updatedAt, updatedBy? }`
  — admin-written customer-facing status
- CustomerContact has `customStageIds?: string[]` — per-customer workflow
  (e.g. PAMCO uses Stamp, Boeing doesn't). Wired into
  utils/stageRouting.ts → stagesForCustomer()
- SystemSettings.clientContacts: Record<string, CustomerContact>
- SystemSettings.clientSlugs: customer name → URL slug for portal links
- SystemSettings.enabledFeatures: feature flags (NOT YET CONSUMED by UI —
  plumbing needed)
- Job.status: 'pending' | 'in-progress' | 'completed' | 'hold'
- PurchaseOrder.status: draft | sent | acknowledged | in-progress |
  partially-received | received | closed | cancelled

## SHARED UTILS TO KNOW
- utils/customers.ts — uniqueCustomers(jobs) + countByCustomer(jobs) +
  customerKey(name) — case+whitespace-insensitive dedup, use EVERYWHERE
  you build a customer list.
- utils/stageRouting.ts — resolveJobStage(job, stages),
  findStageForOperation(op, stages), stagesForCustomer(stages, contact)
- utils/date.ts — fmt, todayFmt, normDate, dateNum, toDateTimeLocal,
  formatDuration, getLogDurationMins
- utils/vapid.ts — VAPID_KEY + vapidKeyToUint8 (shared by useNotifications
  + PushRegistrationPanel)

## CURRENT PRIORITIES (pick one to start)

### 🔥 SHIP-BLOCKERS (needed before monetization)
1. Wire settings.enabledFeatures to actually hide/show nav items +
   gate modal content. Pattern:
     {features.purchaseOrders && <NavItem … />}
   Also add a tiny "🔒 upgrade" card that pops when a locked feature is
   accessed.
2. Migrate off Tailwind CDN to Vite PostCSS. Kill the production warning.
3. Integrate Stripe Checkout, write subscription tier to
   settings.subscription.tier. Wire a trial-ends-in-X-days banner.

### 🧩 POLISH (makes the product feel done)
4. Samples touch-up: better Start Work modal, Work History hierarchy.
5. Quality upgrade: cost-impact, trends, repeat offenders.
6. Overview empty-states: "—" + context when no data.
7. Replace all alert()/confirm() with Toast + ConfirmationModal.
8. Extract JobsView from App.tsx into views/JobsView.tsx.

### 🏗 BIG ROCKS
9. Build the landing page from marketing/LANDING_PAGE_BRIEF.md (likely
   Astro or Next.js hosted separately).
10. Onboarding wizard flow: 5-question shop profile → feature flag
    suggestions → imported customer list → ready in <1 hour.

## HOW THE USER WORKS
- Direct, impatient — they know what they want and hate hand-holding.
- Wants to see the preview BEFORE pushing. Use preview_start → verify →
  only then commit.
- Says "audit" — they mean INTERACTION-LEVEL test, not "does it load."
- Capslock means they're frustrated. Take the feedback, move fast.
- They'll push you to cut scope at launch — some features should hide
  behind paid tiers per LANDING_PAGE_BRIEF.md.

## FIRST TASK WHEN YOU START
Check in with:
  1. Pull latest: `git pull origin master`
  2. Read the last 3 commit messages: `git log --oneline -3`
  3. Start preview, open app, click through 5 main views verifying no
     runtime errors.
  4. Ask the user which of the priority items they want next. DO NOT
     pick one yourself on turn 1.
```

---

## 📎 Things the next chat might ask you for

Keep these handy:
- **Netlify deploy URL:** (whatever your site is currently at)
- **Firebase project ID:** see services/firebaseClient.ts
- **Gemini API billing status:** (Netlify env var `GEMINI_API_KEY`)
- **Domain plans:** are you registering `fabtrack.io` or something else?
- **Do you have the logo SVGs?** Need to drop them into `public/brand/`
  (the current build falls back to an inline SVG monogram — fine, but
  the real exports will look better)

---

## ✅ What's done as of this handoff

- App.tsx trimmed from 9,661 → 5,524 lines
- Settings fully extracted + 8 tabs each with heading
- Customer profiles with per-customer workflow routing (Stamp skip etc.)
- Customer Portal preview modal (admin view with inline note editor)
- Portal notes system end-to-end (admin writes, customer sees glowing card)
- Year-grouped completed jobs on customer portal ("This Year · 25 orders")
- Purchase Orders: full enterprise spec (vendors, QA, ITAR, blueprints)
- All modals portaled to document.body with opaque zinc-950 backdrops
- Shared Overlay + Modal primitives consistent across 15+ modal sites
- Datetime-local edit glitch killed (local string state)
- Wrong-job-opens-on-Edit bug killed (group by jobId not display name)
- Delete confirm dialog floats at z-400 above every other modal
- Customer dedup normalized across 5+ views (case+whitespace-insensitive)
- Sidebar organized into 5 labeled groups
- Shop Flow Map: ping no longer overflows, flame badges render correctly
- Landing page brief written (marketing/LANDING_PAGE_BRIEF.md)
- Brand lock-in: FabTrack IO name, BRAND.md, public/brand/ folder,
  manifest + index.html updated
