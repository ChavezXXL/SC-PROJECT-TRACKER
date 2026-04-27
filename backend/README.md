# `/backend/` — FabTrack IO SaaS Backend Scaffold

> **Read this first if you opened this folder.**
>
> Nothing in this folder is wired into the live app yet. It's the dormant
> plumbing for multi-tenant SaaS, tier-gating, billing, and auth.
> You can delete the whole folder and the running app at SC Deburring
> does not change.

## What's in here

| File | What it is | Phase |
|---|---|---|
| `BACKEND_PLAN.md` | **Start here.** Roadmap, pricing, goals, safety contract. | – |
| `ADMIN_CONSOLE.md` | Operator controls: super-admin, bans, dunning, email, impersonation. | – |
| `TIER_MATRIX.md` | Feature → tier comparison table (for landing page + sales). | – |
| `types.ts` | Tenant, Member, Subscription, Plan, FeatureKey types. | 0 |
| `catalog.ts` | `TIER_CATALOG` + `FEATURE_CATALOG` — the source of truth for pricing and gating. | 0 |
| `featureFlags.ts` | `isFeatureEnabled()` — central policy check. | 0 |
| `tenantContext.ts` | Path helpers + **legacy fallback** so SC Deburring's flat-path data keeps working. | 0 |
| `authService.ts` | Firebase Auth signup / login stubs. Not wired. | 2 |
| `billingService.ts` | Stripe Checkout + webhook shape. Not wired. | 3 |
| `useTenant.ts`, `useFeatureGate.ts` | React hooks. | 0 |
| `FeatureGate.tsx`, `UpgradeNudge.tsx` | UI wrapper + upgrade card. | 0 |
| `firestore.rules.draft` | Proposed deny-by-default rules (not deployed). | 1 |
| `firestore.indexes.draft.json` | Index skeleton. | 1 |

## Wiring it up (later)

When ready to flip the switch, see `BACKEND_PLAN.md → Phase-by-phase
execution`. Short version:

1. Phase 0 (this drop) — scaffold lives here, nothing imports it.
2. Phase 1 — `mockDb.ts` collection paths swapped to use `tenantContext.colPath()`.
3. Phase 2 — Firebase Auth + `/signup` page create a tenant + owner.
4. Phase 3 — Stripe Checkout writes `subscription` into the tenant doc.
5. Phase 4 — Live nav items / modal buttons wrapped in `<FeatureGate>`.
6. Phase 5 — Invite teammates, per-role permissions.
7. Phase 6 — Demo sandbox, public launch.

## Golden rule

**Never import anything from `/backend/` into an existing view, service, or
hook until the corresponding phase gate is met.** That's what keeps the
SC Deburring install safe.
