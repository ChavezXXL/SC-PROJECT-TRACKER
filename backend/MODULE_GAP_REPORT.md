# FabTrack IO — Competitive Module Gap Report

> Research dated 2026-04-24. Sourced from ProShop, Steelhead, Paperless
> Parts, Katana, Fulcrum, JobBOSS², MIE Trak Pro public feature pages.
> Re-run quarterly.

**TL;DR:** Five modules every competitor ships and we don't:
1. Raw material + lot/heat inventory
2. BOM + routing templates
3. Capacity / machine scheduler
4. Live job costing (actual vs quoted)
5. Drawing revision control

Plus an industry wedge — **tank chemistry + rack tracking** — where the only competitor (Steelhead) charges $500+/mo and we could eat their lunch at $149–349.

---

## 1. Competitor module inventory

| Module | ProShop | Steelhead | Paperless | Katana | Fulcrum | JobBOSS² | MIE Trak |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Quoting / Estimating | ✅ | ✅ | ✅ AI | – | ✅ | ✅ | ✅ |
| Sales orders | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **BOM / routings** | ✅ | ✅ | ✅ | ✅ | ✅ AI | ✅ AI | ✅ |
| **Inventory / raw material** | ✅ | ✅ | – | ✅ | ✅ | ✅ | ✅ |
| **Production scheduling** | ✅ | ✅ | – | ✅ | ✅ auto | ✅ | ✅ |
| **Job costing (act vs quoted)** | ✅ | ✅ | – | – | ✅ live | ✅ | ✅ |
| Shop-floor MES kiosk | ✅ | ✅ | – | – | ✅ | ✅ | ✅ |
| **QMS / NCR / inspection** | ✅ | ✅ | – | – | ✅ AS9100 | ✅ | ✅ |
| **Doc / drawing rev control** | ✅ | ✅ | ✅ | – | – | – | – |
| **Calibration / tool / fixture** | ✅ | – | – | – | – | ✅ | – |
| **Preventive maintenance** | ✅ | ✅ | – | – | – | – | ✅ |
| Purchasing / PO | ✅ | ✅ | – | ✅ | ✅ | – | ✅ |
| Shipping & receiving | ✅ | ✅ | – | ✅ | ✅ | ✅ | – |
| **Tank chemistry / wet-process** | – | ✅ | – | – | – | – | – |
| Accounting / GL | ✅ | ✅ | – | sync | ✅ | (QB) | ✅ |
| CAD viewer / DFM | – | – | ✅ | – | – | – | – |

**Pricing (publicly listed):**
- Katana Core ~$299/mo
- JobBOSS² from ~$99/mo base
- Steelhead from ~$500/mo
- ProShop, Paperless, Fulcrum, MIE Trak — quote-only / per-seat

---

## 2. Cross-industry "table stakes" we're missing

### A. Raw material + lot/heat inventory
Live count of bar stock, sheet, plate, hardware, consumables — with lot/heat numbers + cert linkage to jobs.
**Why:** Without it you cannot quote material, cannot do FAI, cannot pass an ISO audit, manager re-counts the rack every Monday.
**Best-in-class:** Fulcrum (live transactions + nesting), Steelhead (chemicals + parts).

### B. BOM + routing template library
Bill of materials per part, routing template = ordered list of operations → workcenters → setup/run times.
**Why:** Turns "a job" into a quoted, scheduled, costable work order. Required to scale beyond single-op deburring.
**Best-in-class:** Fulcrum (AI BOM upload), JobBOSS² AI BOM Builder.

### C. Capacity / machine scheduler
Drag-and-drop or auto-fit calendar showing machine load. Answers "can I fit this rush in?"
**Why:** Every owner asks this question; today our app cannot answer it.
**Best-in-class:** Fulcrum Autoschedule, JobBOSS² drag-and-drop Gantt.

### D. Live job costing
Per-job dashboard: labor $ + material $ + outside services $ vs. quote = live margin.
**Why:** The single number that decides if a shop survives. We have time logs and quotes — they don't roll up.
**Best-in-class:** Fulcrum, ProShop.

### E. Drawing revision control
Drawings tagged with rev letters, locked once issued, history preserved, "current rev" surfaced on the traveler.
**Why:** Shipping to Rev B when customer is on Rev C = scrap + chargeback. Required for AS9100 / ITAR / CMMC.
**Best-in-class:** ProShop (built around it).

---

## 3. Industry-specific gaps

### Machining (CNC mill / turn / EDM)
- Tool & fixture library w/ tool life, location, offsets
- Calibration register for mics, gauges, CMM (ISO 17025-style)
- Cycle-time tracking per program (setup vs run, parts/hr)
- Material certs (mat-cert / CoC) attached to lot
- FAI / AS9102 ballooning + report

### Plating / Anodizing / Passivation / Coating (wet process)
- Tank / line definition with chemistry log (pH, concentration, temp, last titration)
- Rack / barrel / load tracking — parts move through as a rack, not a job
- Process recipe / spec library (MIL-A-8625 Type II Class 2, ASTM B633 SC1, etc.)
- Bath maintenance + filter/anode change PM schedule
- Thickness reading capture + cert printing

### Welding / Fabrication
- Welder qualification / WPS / PQR tracking (AWS D1.1 cert expirations)
- Nesting / sheet utilization (laser, plasma, waterjet)
- Material traceability by heat number (ASME, AWS code work)
- Weld inspection records (visual, MT, PT, RT) tied to joint + welder
- Consumables tracking (rod, wire, gas) by lot

### Assembly (kitting, sub-assembly)
- Multi-level BOM with sub-assemblies + phantom parts
- Kitting / pick-list generation
- Serial number / unit traceability through assembly steps
- Torque / test record capture per serial
- Ship-set / shortage tracking

---

## 4. Prioritized recommendation

Ranked 1 = a typical shop will refuse to buy without it.

| # | Module | Why |
|---|---|---|
| 1 | **Raw material inventory + lot tracking** | Without this we are a fancy timer. Hard refusal. |
| 2 | **BOM + routing template library** | Required to start any machining / assembly customer. |
| 3 | **Capacity / machine scheduler** | Owners buy software to answer "can I fit this in?" |
| 4 | **Job costing roll-up (live)** | Inputs already exist — surface the number. |
| 5 | **Document/drawing rev control + rev-locked travelers** | Cheap; required for AS9100/ISO customers. |
| 6 | **Tank chemistry + rack module** (gated by `usesTanks` flag) | Unlocks the plating/anodizing TAM. Steelhead is only serious comp at $500+/mo. |
| 7 | **Calibration register + tool/fixture library** | Cheap, ISO table stakes, retention hook. |

---

## 5. What NOT to build

| Skip | Reason |
|---|---|
| **Full GL / accounting** | Sync to QuickBooks/Xero like JobBOSS² does. Building it = customer complaints. |
| **CAD viewer / DFM analysis** | Paperless Parts has 10 engineers on this. Don't half-do it. |
| **CMMC / cybersecurity module** | Defense-shop niche. First 200 customers won't ask. Scope creep. |
| **MRP demand forecasting** | Katana sells it; most users never enable. Reorder points on inventory is enough. |
| **EDI / RFQ marketplace** | Cool demo, zero shops buy on it. Stay out. |

---

## Strategic takeaway

Add the 5 table-stakes modules → FabTrack IO graduates from "great deburring tracker" → "real shop ERP" at 1/3 the price of the legacy ones.

Add the **plating tank module** as a gated industry pack → we have a defensible niche with no $79–349 competitor (Steelhead's $500+/mo is the only player and they cap there).
