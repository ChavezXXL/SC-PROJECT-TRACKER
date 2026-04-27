# FabTrack IO — Backend & SaaS Plan

**Owner:** Anthony Chavez (SC Deburring LLC)
**Repo:** github.com/ChavezXXL/SC-PROJECT-TRACKER
**Status:** Phase 0 — scaffold in place, nothing wired.
**Last updated:** 2026-04-24

---

## 1. Safety Contract (read first)

> **The SC Deburring install cannot be affected by this work until we say so.**

Here's how that promise is kept:

1. **All new files live under `/backend/`.** Nothing outside that folder imports from it. If we deleted the folder tomorrow the app would still run exactly as it does now.
2. **The legacy tenant has flat-path fallback.** Phase 1 adds a path helper (`tenantContext.colPath()`). For `tenantId === 'sc_deburring'` it returns the existing flat paths (`jobs`, `logs`, `settings`) — **no data migration required**. New tenants get `tenants/{id}/jobs` etc.
3. **Feature flags default to "permissive" for the legacy tenant.** Until the user (you) manually upgrades the SC Deburring tenant to a plan, every feature reads as enabled — the live shop keeps seeing everything.
4. **Nothing gets shipped to production without you verifying it in the preview first.** No deploy at the end of a build session without an explicit "ship it."
5. **One-way migrations are avoided.** If Phase 1 goes sideways, we can revert by flipping `isLegacy` back to `true` on the tenant doc.

If at any point you want to **pause or cut** this work, nothing here prevents that. The current shop-tracking app keeps running untouched.

---

## 2. Goals

### Primary (why this work exists)
- **Sell the product** to other shops beyond SC Deburring.
- **Charge monthly recurring revenue** with three clear tiers.
- **Scale safely** — one shop's data stays walled off from another's, even if two shops share an auth domain.
- **Stay maintainable by one person** — no enterprise-Kubernetes rabbit holes.

### Non-goals (what this is NOT)
- Not a re-platforming. Firebase / Firestore stays.
- Not a rewrite of existing views or DB calls — only gated additions.
- Not a multi-region setup. US-only for launch.
- Not full RBAC. `owner / admin / manager / viewer` is enough; complex permission matrices are out of scope.

### Success criteria for Phase 4 (feature gating ready)
- [ ] Log in as a Starter-tier tenant → Purchasing nav is hidden.
- [ ] Log in as a Pro-tier tenant → Purchasing visible, Quality hidden, upgrade nudge on Quality.
- [ ] Log in as a FabTrack IO tenant → Everything visible.
- [ ] SC Deburring tenant (legacy) → Everything visible (override).
- [ ] Trial expires → tenant sees soft paywall on write actions, read-only elsewhere.
- [ ] Data between any two tenants is provably isolated in Firestore rules.

---

## 3. Pricing

### Proposed tiers (up from the old $29/$79/$149)

| | **Starter** | **Pro** ⭐ | **FabTrack IO** |
|---|---|---|---|
| **Monthly price** | **$49/mo** | **$149/mo** | **$349/mo** |
| **Annual (billed yearly)** | $39/mo ($468/yr) | $119/mo ($1,428/yr) | $279/mo ($3,348/yr) |
| **Users** | 1 | up to 10 | unlimited |
| **Jobs / month** | 100 | unlimited | unlimited |
| **Workflow stages** | up to 5 | unlimited | unlimited |
| **Trial** | 14 days | 14 days | 14 days |
| **Support** | Email (48h) | Email (24h) | Phone + Slack (4h) |

### Why go up from the draft
The landing brief numbers ($29/$79/$149) were set low to avoid scaring SMB buyers. Reality check:

- Shops with 1–25 employees pay **$30k–$250k/mo in labor**. A tool that saves 1 missed job/mo pays for itself at any tier.
- Competitor pricing:
  - Jobber: $49–$199 (but that's for field service — not shop floor).
  - Katana: $179–$799.
  - Paperless Parts: $500–$2,000+ (enterprise quoting only).
  - Steelhead: $500+ (plating-focused).
  - ProShop: **$10k setup + $100–$300/user/month** — the one to beat on price.
- At **$349/mo** for the full suite (POs + Quality + Reports + AI + Portal + Deliveries), FabTrack IO is still ~10× cheaper than ProShop while covering the same jobs-to-billing workflow.
- Under-pricing hurts — low price = signal of low value to shop owners who've been burned by cheap tools before. $49 > $29 for that reason alone.

### Add-ons (optional, future)
- **Extra seats on Pro** — $15/user/month beyond 10
- **AI scan credits beyond Pro ceiling** — $0.10 per scan (bundled free at FabTrack IO tier)
- **Custom domain** (`tracker.yourshop.com`) — $25/mo add-on, bundled in FabTrack IO
- **Dedicated onboarding call** — $500 one-time (optional, not required)

### Enterprise tier (later, by request only)
- $999+/mo, annual contract
- SSO/SAML, SLA, data-residency choice, custom SLA, dedicated CSM
- Not listed on landing page. Email to request.

### Discounts & promotions
- **Annual billing:** 2 months free (~16% off) — shown prominently.
- **Founder pricing:** First 10 customers get 50% off for 12 months in exchange for testimonial + case study rights. Tracked in a separate coupon code.

### What your current prices cost us to serve
At-rest: Firebase free-tier handles 50+ small shops. Each paying customer costs ~$5–$15/mo in Firebase reads/writes/storage. Gross margin is **90%+** at every tier. Good.

---

## 4. Multi-Tenant Architecture

### Firestore layout

```
/accounts/{uid}                 ← per-user top-level (Firebase Auth UID)
  email, displayName, tenantIds: [...], defaultTenantId
  createdAt, lastLoginAt

/tenants/{tenantId}             ← one doc per shop / customer of ours
  name, slug, ownerUid, billingEmail, createdAt, isLegacy

/tenants/{tenantId}/members/{uid}
  role: 'owner' | 'admin' | 'manager' | 'viewer'
  email, name, invitedAt, joinedAt

/tenants/{tenantId}/subscription/current
  planId, status, trialEndsAt, seats, stripeCustomerId, stripeSubscriptionId

/tenants/{tenantId}/settings/system      ← existing SystemSettings
/tenants/{tenantId}/jobs/{jobId}         ← existing Job
/tenants/{tenantId}/logs/{logId}         ← existing TimeLog
/tenants/{tenantId}/quotes/{quoteId}
/tenants/{tenantId}/samples/{sampleId}
/tenants/{tenantId}/deliveries/{deliveryId}
/tenants/{tenantId}/purchaseOrders/{poId}
/tenants/{tenantId}/vendors/{vendorId}
/tenants/{tenantId}/reworkEntries/{entryId}
/tenants/{tenantId}/workers/{workerId}   ← existing User (PIN-based floor workers)
/tenants/{tenantId}/push_subscriptions/{key}

/invites/{inviteId}                      ← cross-tenant email invites
  tenantId, email, role, token, expiresAt, createdBy

/public_portal/{slug}/jobs/{jobId}       ← read-only portal mirror
```

### Legacy tenant (SC Deburring)

For backward compat, the SC Deburring tenant has `isLegacy: true` and `id: 'sc_deburring'`. The path helper `colPath()` returns **flat paths** (`jobs`, not `tenants/sc_deburring/jobs`) when `isLegacy === true`. The app reads/writes unchanged. Zero data migration.

When we're comfortable, Phase 7 optionally runs a batch copy from flat → scoped and flips `isLegacy: false`. Until then, both modes work.

### Identity model

Two separate concepts, both tenant-scoped:

- **Member** (`members/{uid}`) = person who signs into the web app with email/password (or Google SSO). Firebase Auth identity. Roles: owner/admin/manager/viewer. Can be billed, can invite teammates.
- **Worker** (`workers/{workerId}`) = shop-floor person who clocks in with a **PIN on a shared tablet**. Existing `User` type. No Firebase Auth account. Belongs to the tenant.

A single person might be both (the owner works the floor AND signs in). They'd have a `members/{uid}` record and a separate `workers/{wid}` record. That's fine.

### Security rules (see `firestore.rules.draft`)

- Deny-by-default.
- Reads/writes to `tenants/{tid}/**` require `request.auth.uid` to appear in `tenants/{tid}/members/` with an appropriate role.
- Public portal reads for `public_portal/{slug}/**` are permitted without auth.
- `accounts/{uid}` readable only by the owner.
- All writes from the client are capped at specific collections; no wild writes.

---

## 5. Feature Gating

Two independent layers — **both must allow** for a feature to show:

### Layer 1: Tier (paid) — new, in this scaffold
```ts
tierAllows(feature, subscription) → boolean
```
Source of truth: `catalog.ts → TIER_CATALOG`. Example: `purchaseOrders` requires `pro` or higher.

### Layer 2: Pack (industry) — existing
```ts
packAllows(feature, shopProfile) → boolean
```
Source of truth: `utils/shopProfile.ts → deriveFeatures()`. Example: `bomTracking` only makes sense for assembly/fabrication shops.

### Central gate
```ts
isFeatureEnabled(feature, tenant, subscription, settings) → {
  allowed: boolean,
  reason?: 'plan' | 'trial_expired' | 'pack_off',
  requiredTier?: PlanId
}
```

Legacy tenant bypass: `tenant.isLegacy === true` → always `allowed: true`. SC Deburring sees everything, always.

### UI pattern
```tsx
<FeatureGate feature="purchaseOrders">
  <NavItem icon={Package} label="Purchasing" />
</FeatureGate>
```

- `allowed === true` → renders children normally.
- `allowed === false` & reason === `'plan'` → renders `<UpgradeNudge>` with copy: *"🔒 Purchase Orders is part of Pro. [Upgrade]"*
- `allowed === false` & reason === `'pack_off'` → renders nothing (not relevant for this shop type).

### Trial logic
- New tenant gets 14-day trial automatically (`subscription.status === 'trialing'`, `trialEndsAt = createdAt + 14d`).
- During trial, treat tier as whatever they selected on signup (default: Pro).
- When trial ends without payment:
  - `status: 'past_due'` for 3 days (grace) → soft nudge banner, all features still work
  - Day 18 → `status: 'unpaid'` → read-only mode (no new jobs, no new POs), upgrade modal every session
  - Day 30 → account pause (`status: 'paused'`) → can read but not log in except to billing page

---

## 6. Roadmap (Phased Execution)

Each phase is **independently mergeable and reversible**. No phase gates the next; we can stop at any point.

### ✅ Phase 0 — Scaffold (this chat, done now)
- `/backend/` folder created with all dormant plumbing.
- Nothing imported from live app → **zero regression risk**.
- Docs written: this file, `TIER_MATRIX.md`, `README.md`.
- Firestore rules drafted (`.draft` suffix → not deployed).

**Exit:** Dev server still runs. SC Deburring app looks identical. ✅

---

### ✅ Phase 1 — Tenant-aware paths (shipped 2026-04-24)
- `services/mockDb.ts` → `COL` getters resolve via `colPath(getTenantId(), ...)`.
- Legacy `sc_deburring` tenant returns flat paths — live install unchanged.
- Verified Overview, Samples, Quality, Purchasing all read real SC Deburring data.

**Exit:** SC Deburring still reads/writes from flat paths. Single switch (`getTenantId()`) moves all paths when we're ready.

---

### 🔨 Phase 2 — Firebase Auth + `/signup` (in progress)
- Add Firebase Auth email/password + Google SSO.
- `/signup` flow:
  1. Email + password
  2. Tenant name + slug
  3. Shop profile wizard (5 questions — reuse existing `OnboardingWizard`)
  4. Plan selection (or trial)
- Creates: `accounts/{uid}`, `tenants/{tid}`, `tenants/{tid}/members/{uid}` (role=owner), `tenants/{tid}/subscription/current` (status=trialing).
- `/login` → resolves tenant → sets current tenant in React context.
- Existing SC Deburring usage: **no login required** because legacy tenant skips auth (feature flag on the tenant doc).

**Risk:** Medium. New auth path + new routes. Test with a fresh Firebase project first, then promote.

---

### 🔨 Phase 3 — Stripe + billing
- Stripe Checkout Session via Netlify Function.
- Webhook endpoint (`/.netlify/functions/stripe-webhook`) writes to `tenants/{tid}/subscription/current`.
- Customer portal link for self-serve management.
- Trial countdown banner component.
- Past-due / unpaid state UI.

**Risk:** Medium. Stripe webhook secrets must be rotated safely. Test in Stripe test mode end-to-end before prod.

---

### 🔨 Phase 4 — Feature gate rollout
- Wrap each tier-gated feature in `<FeatureGate>` per `TIER_MATRIX.md`.
- Smoke-test every tier: starter/pro/fabtrack_io/legacy.
- Roll out ONE gate first (purchasing), verify, then the rest.

**Risk:** Low if phase 0 scaffold is right.

---

### 🔨 Phase 5 — Invites + roles
- `/tenants/:tid/team` — invite teammates by email.
- `invites/{id}` doc with time-limited token.
- Role-based UI (viewer can't edit, manager can't change billing, etc.).

**Risk:** Low-medium. Write rules for role checks carefully.

---

### 🔨 Phase 6 — Demo sandbox + public launch
- Seed dataset tenant (`demo` slug) — read-only, 10-minute sessions.
- Landing page integration.
- Status page, changelog.
- Data export (CSV + Google Sheets).

---

### 🔨 Phase 7 (optional) — Legacy migration
- Copy SC Deburring flat data into `tenants/sc_deburring/*` scoped paths.
- Flip `isLegacy: false`.
- Old flat paths left in place as an archive until we're sure scoped reads are fine.

---

## 7. Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-24 | Plan IDs: `starter`, `pro`, `fabtrack_io` (not `shop_os`) | Brand consistency with FabTrack IO rename. |
| 2026-04-24 | Bump prices to $49 / $149 / $349 | Underpricing signals low value; competitors cost 2–30×. |
| 2026-04-24 | Two-layer gating (tier × pack) | Tier = what they buy. Pack = what their shop needs. Both required. |
| 2026-04-24 | Legacy tenant bypass | SC Deburring keeps running flat-path, no migration required. |
| 2026-04-24 | Worker ≠ Member | Workers clock in with PIN (no account). Members sign in and get billed. |
| 2026-04-24 | No enterprise tier on the public page | Quiet, email-to-request. Keeps landing page clean. |
| 2026-04-24 | 14-day trial → 3-day grace → read-only → 30-day pause | Generous but firm. Most SaaS benchmarks this range. |

---

## 8. What Could Get Cut

If scope balloons, here's what gets trimmed first:

- **SSO / SAML** — punt to Enterprise-by-request. Not worth building for v1.
- **API access** — same. Ship after 20+ paying customers ask.
- **Custom domain** — nice but not blocker. Can live on `app.fabtrack.io/c/slug` URL forever.
- **GPS delivery tracking** — keep it since SC Deburring uses it, but fine to hide on the landing page.
- **AI PO scanning** — already gated. Keep as premium differentiator.
- **Push notifications** — hide from shop owners behind a "for developers" toggle; email-based reminders for everyone else.

Keeping:
- Multi-tenancy (non-negotiable for SaaS)
- 3-tier pricing
- Stripe billing
- Customer portal
- Jobs / Quotes / Time logs / Reports

---

## 9. Questions to Answer Before Phase 2 (Auth)

1. **Domain / URL.** Where does the app live? `fabtrack.io`? `app.fabtrack.io`? Portal URLs?
2. **Email sender.** Outbound (invites, receipts, password reset) — Resend? Postmark? Firebase's built-in?
3. **Stripe account.** Existing SC Deburring account or a new FabTrack LLC one?
4. **Terms of Service + Privacy Policy.** Termly? Iubenda? DIY?
5. **Customer support inbox.** `support@fabtrack.io` → where?
6. **Data export format.** CSV-only? + Google Sheets API? + JSON dump?

Park these; answer in the Phase 2 chat.

---

## 10. How This Chat Will Run

This is the **dedicated backend chat.** For UI / feature / shop-tracker fixes, start a new chat. That keeps context focused.

**This chat will:**
- Review the scaffold periodically for drift.
- Build Phase 1 when you say go.
- Build Phase 2 (Auth) in its own session — probably the longest phase.
- Build Phase 3 (Stripe) in its own session.
- NOT touch existing views, services, or hooks outside `/backend/`.

Say "start phase 1" when you want to move forward.
