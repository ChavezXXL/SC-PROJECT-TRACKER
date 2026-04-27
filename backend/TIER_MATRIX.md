# FabTrack IO — Tier Matrix

> **Source of truth:** `backend/catalog.ts`. This file is the human-readable
> version for the landing page + sales conversations. If you change pricing,
> edit both.

---

## Pricing

| | **Starter** | **Pro** ⭐ | **FabTrack IO** |
|---|---|---|---|
| **Monthly** | $49/mo | $149/mo | $349/mo |
| **Annual (per month)** | $39/mo | $119/mo | $279/mo |
| **Annual total** | $468/yr | $1,428/yr | $3,348/yr |
| **Trial** | 14 days | 14 days | 14 days |
| **Users** | 1 | up to 10 | unlimited |
| **Jobs / month** | 100 | unlimited | unlimited |
| **Workflow stages** | up to 5 | unlimited | unlimited |
| **AI scans / month** | – | – | 500 |
| **Support** | Email · 48h | Email · 24h | Phone + Slack · 4h |

*Annual billed yearly — saves ~16% vs monthly.*

---

## Features by Tier

### Core (every paid tier)
| Feature | Starter | Pro | FabTrack IO |
|---|:-:|:-:|:-:|
| Jobs | ✅ | ✅ | ✅ |
| Quote builder | ✅ | ✅ | ✅ |
| Shop Flow Map | ✅ | ✅ | ✅ |
| Customer portal | ✅ | ✅ | ✅ |
| Basic reports | ✅ | ✅ | ✅ |
| Custom workflow stages | ✅ up to 5 | ✅ unlimited | ✅ unlimited |

### Shop floor
| Feature | Starter | Pro | FabTrack IO |
|---|:-:|:-:|:-:|
| Kanban board | – | ✅ | ✅ |
| Live Floor TV mode | – | ✅ | ✅ |
| TV slideshow | – | ✅ | ✅ |
| Per-customer routing | – | ✅ | ✅ |
| Shift alarms | – | ✅ | ✅ |
| Worker QR badges | – | ✅ | ✅ |
| Google Calendar sync | – | ✅ | ✅ |

### Commerce & operations
| Feature | Starter | Pro | FabTrack IO |
|---|:-:|:-:|:-:|
| Purchase Orders | – | ✅ | ✅ |
| Vendor database | – | ✅ | ✅ |
| GPS deliveries | – | ✅ | ✅ |
| Samples library | – | ✅ | ✅ |

### Quality & finance (FabTrack IO only)
| Feature | Starter | Pro | FabTrack IO |
|---|:-:|:-:|:-:|
| Quality / Rework tracking | – | – | ✅ |
| Financial reports | – | – | ✅ |
| Advanced reporting | – | – | ✅ |

### Advanced (FabTrack IO only)
| Feature | Starter | Pro | FabTrack IO |
|---|:-:|:-:|:-:|
| AI PO scanner | – | – | ✅ |
| API access | – | – | ✅ |
| SSO / SAML | – | – | ✅ |
| Custom portal domain | – | – | ✅ |
| Priority support | – | – | ✅ |

---

## What happens when a feature is gated

Three outcomes, all handled by `<FeatureGate>`:

1. **Plan doesn't include it** → Upgrade nudge card
   > 🔒 **Purchase Orders is on Pro.** Upgrade to Pro to unlock it.
   > [Upgrade to Pro →]

2. **Shop profile says it's not relevant** (e.g. `tankSessions` for a woodworker) → Rendered as `null` (hidden entirely).

3. **Trial expired / payment failed / suspended** → Paywall card
   > 🔒 **Your trial ended.** Pick a plan to keep using FabTrack IO.
   > [Choose a plan →]

---

## Add-ons (future)

| Add-on | Price | Included with |
|---|---|---|
| Extra Pro seats | $15/user/mo | – |
| AI scan credits beyond tier ceiling | $0.10/scan | FabTrack IO (500 free) |
| Custom portal domain | $25/mo | Included in FabTrack IO |
| Onboarding white-glove call | $500 one-time | Optional |

---

## Enterprise (on request only)

- $999+/mo, annual contract
- Custom SLA, SSO/SAML, data-residency choice, dedicated CSM
- Not listed on landing page; email to request
