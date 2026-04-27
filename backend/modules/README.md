# `/backend/modules/` — Data model scaffolds for missing features

Type-only drafts for the five "table stakes" modules identified in
[`../MODULE_GAP_REPORT.md`](../MODULE_GAP_REPORT.md). Every type here is
a plain interface — no Firestore writes, no UI, no service wiring.

When a module goes from dormant → live, it will:
1. Get Firestore collection paths added to `mockDb.ts` via the same
   `colPath()` helper we used in Phase 1.
2. Get a `services/<module>Service.ts` with subscribe/save/delete APIs.
3. Get a view under `views/`.
4. Get feature-gate wrappers tied to `TierFeatureKey`.

Shipping order per the recommendation:

| # | Module | File | Size | Status |
|---|---|---|---|---|
| 1 | Job costing roll-up | `costing.ts` | types only | 🔨 dormant |
| 2 | Inventory + lot tracking | `inventory.ts` | types only | 🔨 dormant |
| 3 | BOM + routings | `bom.ts` | types only | 🔨 dormant |
| 4 | Drawing revision control | `drawings.ts` | types only | 🔨 dormant |
| 5 | Tank chemistry (plating wedge) | `tanks.ts` | types only | 🔨 dormant |

The `TierFeatureKey` catalog in `../catalog.ts` already references these
via `quality`, `financialReports`, `advancedReporting` etc. — we'll
add specific feature keys (`inventoryTracking`, `bomRoutings`, etc.)
when the feature is ready to ship.
