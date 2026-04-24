# FabTrack IO — Brand Spec

> The official brand for the product formerly called "SC Project Tracker" /
> "Shop OS." Every new chat, every new marketing asset, every email signature
> uses the name and visuals below.

---

## 🏷 Name

**Product name:** FabTrack IO
**Pronunciation:** "fab-track eye-oh"
**Short form / badge:** FTIO
**Parent company:** SC Deburring LLC (Fresno, CA)
**Tagline options:**
1. *"Tracking made for the shop floor."*
2. *"Your shop. Your flow. Your numbers."*
3. *"Built by a shop. For shops."*

### When to use which
- **"FabTrack IO"** — full name, marketing, app title, PDF headers
- **"FTIO"** — short spots (favicon, badge avatar, cramped UI)
- **"FabTrack"** — casual reference only (never drop "IO" from the primary
  logo lockup)

---

## 🎨 Logos

Three variants live in [`public/brand/`](public/brand/README.md):

### 1. Badge / App Icon (`ftio-icon`)
- Rounded-square dark tile with blue gradient "FTIO" monogram
- Use: app header, favicon, PWA icon, browser tab
- Min size: 32×32 (usable down to 16×16 if really tight)

### 2. Full Logo (`fabtrack-io-logo`)
- Vertical stack: FTIO mark + "FabTrack IO" wordmark below
- Use: login page, printed document headers, marketing hero
- Keep generous whitespace around it — at least 20% of its own width

### 3. Wordmark (`fabtrack-io-wordmark`)
- Horizontal text-only lockup
- Use: invoice/PO footer, narrow horizontal spaces, email signatures

### ❌ Don't
- Don't recolor (the blue gradient is the brand)
- Don't italicize, outline, or drop-shadow
- Don't stretch non-uniformly
- Don't place on busy photos without adding a dark tile behind

---

## 🎨 Colors

Extracted from the logo + matched to the app:

| Role          | Hex       | Tailwind class     | Use                             |
|---------------|-----------|--------------------|---------------------------------|
| **Deep Navy** | `#0a1628` | `bg-slate-950`     | Logo dark half, dark backgrounds|
| **Brand Blue**| `#2563eb` | `bg-blue-600`      | Primary CTAs, accents, links    |
| **Bright Blue**| `#3b82f6`| `bg-blue-500`      | Hover state, icon default       |
| **Ice Blue**  | `#60a5fa` | `text-blue-400`    | Active nav, small accents       |
| **Near Black**| `#09090b` | `bg-zinc-950`      | App background (matches logo)   |
| **Success**   | `#10b981` | `bg-emerald-500`   | "Saved", live indicators        |
| **Warning**   | `#f59e0b` | `bg-amber-500`     | Paused, due-soon                |
| **Danger**    | `#ef4444` | `bg-red-500`       | Overdue, destroy                |

---

## ✒️ Typography

Already set in the app — keep it:

- **Inter** (weights 300, 400, 500, 600, 700, 900) — all UI text
- **JetBrains Mono** (400, 700) — PO numbers, timestamps, financial figures

Headings use weight 900 (black) with tight letter-spacing. Body uses 500.

---

## 💬 Voice

The tone used throughout the app + marketing:
- **Direct, not corporate** — "Start free trial" not "Begin your journey"
- **From a shop, not a software vendor** — reference real ops vocabulary (PO, Rev, QC, FAIR, lot size)
- **Honest about tradeoffs** — "AI scanning costs per use — use it for hard POs"
- **Zero emojis in product copy.** OK in marketing + status notes where the customer sees them

---

## 🏷 Product positioning one-liner

> *"FabTrack IO is the everything-in-one-place platform built by a working
> deburring shop. Jobs, quotes, customers, POs, deliveries — all talking to
> each other, all on your phone."*

---

## 🚫 Legacy names — DO NOT use anymore

The following used to refer to this product. Replace on sight:
- "SC Project Tracker" → FabTrack IO
- "SC Tracker" → FabTrack IO
- "Shop OS" → FabTrack IO
- "Nexus" → FabTrack IO (appears in some DB keys — safe to leave but don't use externally)

The company (SC Deburring LLC) still owns the product — the old name just
referred to the internal tool before it became a product.
