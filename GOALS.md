# GOALS — section-by-section roadmap for FabTrack IO

> **Paste the block below into a fresh Claude chat.** It's the strategic brief
> for advancing each major section to ship-quality. Used together with
> [HANDOFF.md](HANDOFF.md) (which has the tactical rules + file map).

---

## 🎯 Prompt to paste into the new chat

```
You're continuing work on FabTrack IO — shop management SaaS by SC Deburring LLC.
Read these in order before touching code:

  1. BRAND.md                       — official brand, NEVER use "Shop OS" or "SC Tracker"
  2. HANDOFF.md                     — file map, hard rules, testing workflow
  3. GOALS.md (this file)           — section-by-section advancement goals
  4. marketing/LANDING_PAGE_BRIEF.md — 3-tier pricing, feature lock spec

Then ASK THE USER which section to work on. Do not pick one yourself.

The user is a working shop owner, not a software person. They want
the product to feel complete, smooth, and sellable. They've asked for
"each section to keep getting better" — which means:

  • Every section should do its job without glitches
  • Every section should feel polished (not half-built)
  • Every section should earn its place in the product or be cut

## HARD RULES (same as HANDOFF.md but worth repeating)
  • Product name is FabTrack IO.
  • All modals portal to document.body via shared Overlay/Modal primitives.
  • Never use native alert() / confirm() — use Toast + ConfirmationModal.
  • Audits must INTERACT (type, click save, click delete), not just "does it load".
  • When the user says "make sure it works" they mean simulate real usage.
  • Commit after each fix, push after each batch.
```

---

## 📊 Where each section stands today (honest read)

### ✅ Shipped & solid
- Sidebar nav (5 labeled groups, 15 items)
- Jobs view (list + kanban + calendar)
- Customer Portal (portal notes, year-grouped history, per-customer routing)
- Purchase Orders (enterprise spec done)
- Settings extraction (8 tabs, all render)
- Overlay/Modal primitives (consistent across the app)
- Customer profiles + per-customer workflow routing
- Modular file structure (App.tsx cut 43%)
- Brand lock-in (FabTrack IO everywhere)

### 🟡 Works but needs polish
- Samples view
- Quality / Rework view
- Live Floor / TV mode (responsive issues)
- Reports view
- Quotes view (works but busy UX)

### 🔴 Not started / blocking ship
- Feature-flag gating (`settings.enabledFeatures` exists but nothing reads it)
- Stripe billing + trial logic
- Landing page build (spec written, no HTML yet)
- Tailwind CDN → PostCSS migration
- Onboarding wizard simplification

---

## 🎯 SECTION-BY-SECTION GOALS

For each section below: the goal, current pain points, and the next 5 moves to ship it.

---

### 1. Overview (Dashboard)

**Goal:** In the first 3 seconds a shop owner opens the app, they see *exactly* what needs their attention today. Nothing else.

**Current pain**
- "0% on-time" + "-$5.3k Net Profit" show scary red numbers when there's just no data yet.
- Too many KPIs of equal visual weight — no hierarchy.
- Right-side stats panel beside Shop Flow Map duplicates the KPI strip above.
- "Needs Attention" alerts can stack up (overdue + timers + missing quotes) — the 3rd row gets visual priority over the 1st.

**Next 5 moves**
1. Empty-state guards: hide "On-Time %" until ≥10 completed jobs; replace "-$5.3k Net Profit" with `—` + "Add quote amounts to see profit" when <5 jobs have quoteAmount.
2. Kill the right-side stats panel — give Shop Flow Map full width.
3. Promote "Needs Attention" card to always-visible first-position hero when it has items.
4. Add a "Today's Focus" block: "Finish {N} overdue jobs · Follow up on {M} quotes · {K} deliveries scheduled."
5. Make each KPI clickable → navigates to the filtered view that produced that number.

---

### 2. Jobs

**Goal:** Create, track, and move jobs through stages faster than a whiteboard. Single-screen editing. No tab-hopping.

**Current pain**
- New Job modal is long — 5 sections stacked vertically.
- No quick-inline edit on the job list (have to open the modal for every change).
- Stage advancement isn't keyboard-driven.
- Bulk actions exist but not discoverable.

**Next 5 moves**
1. Inline-editable fields in the Jobs list for: status, priority, due date (click → edit in place).
2. Keyboard shortcut: press `→` on a focused row to advance to next stage.
3. Bulk-action bar becomes sticky when ≥1 selected.
4. "Quick add" button that opens just the 3 critical fields (PO + Part + Due Date) — full editor accessible via "Add details".
5. Smart prefill: when customer is picked, default PO prefix + payment terms + priority + default route from their profile.

---

### 3. Board (Kanban)

**Goal:** Drag job card between columns. That's it. No-frills.

**Current pain**
- Drag-and-drop works but is finicky on mobile (small touch targets).
- Column counts aren't clickable to filter.
- No filter chips at the top (customer / priority / due-window).

**Next 5 moves**
1. Increase drag-handle size on mobile (min 44×44 hit area).
2. Column header click → filter that column (e.g. click "Stuck 3d+" shows only stuck jobs app-wide).
3. Top filter bar: chips for urgent, overdue, by customer. Sticky on scroll.
4. Card hover → reveal "advance to next stage" inline button (no drag required).
5. Stage-order editable directly on the board (drag column headers).

---

### 4. Calendar

**Goal:** See what's due when. Month-view default, week/day for detail.

**Current pain**
- Month view dumps all jobs for a day into a flat list — no visual weight for priority or overdue.
- No week view.
- Can't click a day to pre-fill a "new job due this date".

**Next 5 moves**
1. Add week view + day view toggles.
2. Color-code dots on the month grid (red = overdue, amber = due-soon, green = on-track).
3. Click a day → modal with that day's jobs + "+ New Job Due Today" button.
4. "Workload warning" badge on days with >5 due jobs.
5. Print-ready calendar view (for shop-floor posting).

---

### 5. Live Floor / TV Mode

**Goal:** Shop-wall TV shows who's working, what's stuck, and what's next — readable from 20 feet away.

**Current pain** (YOUR reported bugs)
- **TV view cuts off on some screens** (not all content visible).
- **TV exits after ~15 min** (fixed in this commit — wake lock heartbeat every 90s).
- Text scales weirdly between 720p and 1080p.
- Weather widget can overlap other elements.
- Slide auto-rotation doesn't pause on hover even though Space should toggle it.

**Next 5 moves**
1. **Build a proper TV responsive grid.** Use CSS container queries (or JS `useResizeObserver`) to snap layout into 3 modes: *small TV* (≤1366), *1080p* (1367–1920), *wall-display* (>1920). Each mode has its own card sizing + font scale.
2. Kill any element that relies on fixed `px` heights in TV mode — use `clamp()` or viewport-relative units everywhere.
3. Add a "Preview at resolution" dropdown in Settings → TV Display so admins can see exactly what each screen size looks like without having to plug in a TV.
4. Slide-change transitions should always fit — use `object-fit: contain` on any image, `overflow: hidden` with `text-overflow: ellipsis` on any single-line text.
5. Add a visible "TV will sleep in Xm" countdown in the corner when idle — gives the admin a visible signal if the heartbeat ever fails.

---

### 6. Logs

**Goal:** Every time log, every worker, every job. Editable, exportable.

**Current pain** (mostly fixed)
- Datetime-edit glitch: **fixed** (local string state).
- Wrong-job-on-Edit: **fixed** (group by jobId).
- Delete hidden behind Edit modal: **fixed** (z-400).
- No filter-by-user (only search).
- Export to Google Sheets works but feels slow — no progress UI.

**Next 5 moves**
1. Add per-user filter chip above the table.
2. Batch-delete mode (shift-click a range, select all via checkbox header).
3. "Active sessions" sticky bar at top — workers currently clocked in.
4. Export progress toast with % indicator.
5. Smart duplicate detection: if the same worker has two overlapping logs on the same job, flag in yellow with a "fix" button.

---

### 7. Quotes

**Goal:** Turn a request into a sent quote in under 60 seconds. Customer sees a link and can approve in one click.

**Current pain**
- Quote editor is dense — process picker, template picker, line items, pricing, tax, deposit, terms, all on one modal.
- Margin guardrails exist but buried.
- No quote-to-PO workflow (if customer supplies their own PO after approval).
- Email send uses mailto: (no tracking).

**Next 5 moves**
1. Split quote editor into 3 visible steps: (1) Customer + scope, (2) Items + pricing, (3) Terms + send. Wizard-style but navigable freely.
2. Surface margin % prominently next to total — red if below shop minimum.
3. Add "Convert to Job" button on approved quotes — pre-fills a job with the quote's line items + customer + due date.
4. Replace mailto with a real send path: `/.netlify/functions/send-email` (SES or Resend) + track opens via the existing engagement log.
5. Quote templates UX: add a "⭐ Favorite" toggle so frequently-used templates pin to the top.

---

### 8. Samples

**Goal:** Log one-off test work (parts the shop is trying out for a new customer). Track time + qty per sample.

**Current pain** (YOU flagged this one)
- Start Work modal is tiny, feels basic.
- Work History modal is a flat list — no grouping by date.
- Photo upload ok but no bulk add.
- No link between Samples and Jobs (can't promote a sample into a real job).

**Next 5 moves**
1. Redesign Start Work: big operation picker (pill buttons), qty input with +/-, bold "Start Timer" CTA.
2. Work History grouped by week, with daily totals.
3. Bulk photo upload (drag 10 photos at once, each becomes a sample).
4. "Promote to Job" button — seeds a new job from the sample's data.
5. "Sample → Quote" shortcut — takes measured sample time × shop rate = suggested quote line.

---

### 9. Quality / Rework

**Goal:** When a part comes back for rework, log it in 15 seconds. Spot patterns over time (repeat offenders, cost impact).

**Current pain** (YOU flagged this one)
- List view is a flat scroll — no grouping by reason / customer / part.
- No cost-impact column (which customer costs the most rework?).
- No trend chart.
- No root-cause prompts — just a free-text field.

**Next 5 moves**
1. Add a stats strip: "Open: 5 · Resolved 30d: 12 · Cost impact: $2,340 · Top reason: Missed Area".
2. 8-week trend sparkline showing rework counts per week.
3. Group list view by: reason / customer / part number (toggle).
4. Cost-impact column: `quantity × job.quoteAmount / job.quantity` per entry, total at top.
5. "Repeat offender" flag — any part number with 3+ rework entries in 90d gets a red 🔁 badge and a "common cause?" prompt.

---

### 10. Deliveries

**Goal:** One-click start a run. GPS tracks miles. Exports IRS-ready mileage log for taxes.

**Current pain**
- GPS permission prompt fires on first click — feels abrupt.
- Can't reorder stops once a run starts.
- No route optimization (stops in the order entered, even if zigzag).
- IRS export lacks the standard mileage-log format (needs driver name + "business purpose" per trip).

**Next 5 moves**
1. Ask for geolocation permission on Deliveries view FIRST load, not on run start (friendlier UX).
2. Drag to reorder stops mid-run (until "Finish Run" is clicked).
3. "Optimize route" button using the nearest-neighbor heuristic.
4. IRS-format export: adds Date / Start Odo / End Odo / Miles / Purpose columns exactly per Publication 463.
5. "Scheduled runs" — let admins create a run in advance, driver sees it on their phone at 7 AM.

---

### 11. Purchasing (POs)

**Goal:** Issue a PO to a vendor in 30 seconds. Track status, receive, match to invoice.

**Current pain**
- Vendor picker is a `<select>` — can't type-to-search if the list is long.
- PO doesn't PDF-print cleanly (some fields overflow the page).
- "Acknowledge" status requires manual marking — no vendor-side portal.
- No email-to-vendor from inside the app (have to export PDF + attach manually).

**Next 5 moves**
1. Replace vendor picker with a type-ahead dropdown (search by name / category).
2. Audit PO PDF template for page overflow — add a print-preview button before "Send".
3. Build vendor-side acknowledgment page (optional, but legit differentiator).
4. Add `/.netlify/functions/send-po` that emails the PDF to vendor with tracking.
5. "Bulk receive" mode — tick-list of open line items, mark several received with one save.

---

### 12. Reports

**Goal:** Answer "how is the shop doing?" in one screen. Revenue, profit, on-time, worker utilization.

**Current pain**
- Hasn't been opened this session — needs audit.
- Uses Recharts which is heavy.
- No date range picker flexibility beyond presets.

**Next 5 moves**
1. Audit this view end-to-end — confirm every metric calculates correctly.
2. Custom date-range picker.
3. Add "compare to last period" overlay on every chart.
4. Per-customer profitability report (revenue − labor × hrs × cost).
5. Export to PDF for monthly financial review.

---

### 13. Team

**Goal:** Manage workers: add, edit, badges, hourly rate, active/inactive. Print QR sign-in badges.

**Current pain**
- Onboarding wizard works but has 4 steps for what should be 1.
- Hourly rate is admin-only but no visual distinction in the UI.
- No "employee of the week" or recognition.

**Next 5 moves**
1. Collapse the 4-step wizard into a single form with progressive disclosure.
2. Add a gold-border / icon for the highest-hours worker this week.
3. Per-worker "scorecard" drill-down: jobs completed, avg cycle time, rework rate.
4. Schedule-based active/inactive (auto-disable after 30d of no scans).
5. Integrate badges print sheet with a QR check-in kiosk URL for shared tablets.

---

### 14. Work Station

**Goal:** Worker taps their badge → sees jobs they can clock into → starts timer. No logins.

**Current pain**
- Worker dashboard mixes "your jobs today" with "all open jobs" — confusing.
- PIN unlock exists but isn't enforced everywhere.

**Next 5 moves**
1. Split into tabs: "My Active Timer" | "Ready to Start" | "Today's Plan".
2. Sticky bottom bar shows running timer (always visible, hard to miss).
3. Big red "CLOCK OUT" button at EOD.
4. Optional "Daily stand-up" — shows yesterday's hours + today's plan from a sticky note the manager left.
5. Voice dictation for notes (`SpeechRecognition` — free browser API).

---

### 15. Settings

**Goal:** Everything a shop configures — profile, schedule, workflow, financial, goals, documents, TV, system — in one organized place.

**Current pain**
- Still 4,200 lines in one file. 
- Each tab has its own sub-pattern — admins get lost between them.
- Autosave exists but no "just saved" toast for each change.
- Documents tab's subtab toggle (Quote vs Traveler) is easy to miss.

**Next 5 moves**
1. Split into `views/settings/{Profile,Schedule,Production,Financial,Goals,Documents,Tv,System}.tsx` — one file each, imports shared helpers from `_shared.tsx`.
2. Add a "Recently saved" toast (bottom corner, auto-dismiss in 2s) on each autosave trigger.
3. Each tab starts with a "What's configured so far" summary at the top.
4. Search bar at the top of settings — `Cmd+/` focuses it; searches across every settings field.
5. "Quick setup" modal for fresh installs — 5-question wizard seeds the most important defaults (stages, ops, priority, payment terms, shop hours).

---

## 🔥 THREE CROSS-CUTTING THINGS to tackle across ALL sections

### A. Feature-flag gating (MONETIZATION BLOCKER)
Nothing in the UI reads `settings.enabledFeatures` today. Until this ships, we can't sell tiers.

Implementation:
1. Write a `useFeatures()` hook that reads settings.enabledFeatures + settings.subscription.tier.
2. Wrap every "Pro-only" or "Shop OS-only" nav item + button + feature in `<GatedFeature flag="purchaseOrders">{...}</GatedFeature>`.
3. On locked feature click, show an upgrade modal with Stripe Checkout URL.
4. Gate map lives in `utils/features.ts` — single source of truth for which flag unlocks what.

### B. Empty states
Every view should have a meaningful empty state with:
- A friendly icon
- "Here's what this section does" explainer
- A "Get started" CTA
- Optional seed-data button for demo/trial

Right now half the views show blank screens with a tiny "No jobs yet" sentence.

### C. Mobile polish
Half the modals feel cramped on phones. Fixes needed across:
- Sticky footers on all form modals (save buttons don't scroll off)
- Swipe-to-dismiss on all Overlay-based modals
- Auto-focus the first input on open
- Full-bleed on mobile, centered on tablet+

---

## 🛠 Technical debt to chase alongside features

1. **Tailwind CDN → PostCSS build.** Kills the prod warning + unlocks JIT pruning.
2. **Firebase offline queue** — show a banner when writes are queued.
3. **Service Worker cache versioning** — users on old cached JS never see new features. Add a "new version available" toast.
4. **Error boundaries per view** — one broken section shouldn't crash the app.
5. **TypeScript strict mode** — currently it's lax. Turning on `strict: true` in `tsconfig.json` will surface real type bugs.

---

## 🎯 How to sequence this (if you want my opinion)

Week 1: **Ship-blockers**
- Feature-flag gating (A)
- Stripe billing + trial (from HANDOFF.md priorities)
- Tailwind CDN migration

Week 2: **TV Mode + Live Floor**
- Responsive grid (§ 5 — user-reported)
- Empty-state polish (B)
- Reports audit (§ 12)

Week 3: **UX polish on top 3 used views**
- Jobs inline-edit (§ 2)
- Quotes 3-step wizard (§ 7)
- Logs user filter + batch actions (§ 6)

Week 4: **Samples + Quality redesign**
- Samples touch-up (§ 8)
- Quality cost-impact + trends (§ 9)
- Customer Portal send-update shortcut

Month 2: **Landing page + onboarding**
- Build landing page from marketing/LANDING_PAGE_BRIEF.md
- 5-question onboarding wizard
- Demo/sandbox mode

Month 3: **Scale features**
- API access (Shop OS tier)
- SSO / SAML
- Mobile app wrapper (Capacitor)
