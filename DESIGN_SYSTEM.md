# SC Deburring — Design System

Canonical tokens and utility classes for the SC Job Tracker. Use these for new code; old inlined styles still work (migrate incrementally).

---

## Tokens

### Color

| Role | Tailwind | Hex | Use |
|------|----------|-----|-----|
| **Primary** | `blue-600` / `blue-500` | `#2563eb` / `#3b82f6` | CTAs, active state, links |
| **Success** | `emerald-500` / `emerald-400` | `#10b981` / `#34d399` | Profit, live, completion |
| **Warning** | `amber-400` / `yellow-400` | `#fbbf24` / `#facc15` | Paused, due-soon, missing data |
| **Danger** | `red-500` / `red-400` | `#ef4444` / `#f87171` | Overdue, destroy, stop |
| **Info / AI** | `purple-500` / `cyan-500` | — | AI tags, portal links |
| **Neutral** | `zinc-950…zinc-400` | — | Body, surfaces, text, borders |

**Text contrast on dark surfaces (WCAG AA):**
- `text-white` = 19.9:1 ✅
- `text-zinc-300` = 13.5:1 ✅
- `text-zinc-400` = 7.8:1 ✅
- `text-zinc-500` = 8.6:1 ✅ (boosted)
- `text-zinc-600` = 6.0:1 ✅ (boosted)

### Typography

| Family | Use |
|--------|-----|
| **Inter** (300–900) | All UI text |
| **JetBrains Mono** (400, 700) | Numbers, times, PO/job IDs |

Tabular numerals enabled globally on `h1`, `h2`, `h3`, `.font-mono`, `.tabular`.

**Scale:**
- Page heading `h1`: `text-2xl font-bold`
- Section heading `h3`: `text-base font-bold`
- Body: `text-sm`
- Meta / label: `text-xs` or `text-[11px] uppercase tracking-wider`

### Radius
- **`rounded-lg`** (0.5rem) — chips, small icon buttons
- **`rounded-xl`** (0.75rem) — buttons, inputs *(canonical)*
- **`rounded-2xl`** (1rem) — cards, banners *(canonical)*
- **`rounded-3xl`** (1.5rem) — large panels (Live Ops container)

### Spacing
Standard Tailwind scale. Common: `gap-2` (sm lists), `gap-3` (cards), `gap-4` (major), `gap-6` (sections).

### Motion
- `transition-colors` 150ms — hover state
- `transition-transform` 200ms — `.hover-lift`
- `animate-pulse` — live indicators
- `animate-fade-in` / `animate-slide-up` — panel mount

---

## Components

### `<Avatar>` (React)
```tsx
<Avatar name="Anthony Chavez" size="md" ring dot="live" />
```
| Prop | Values |
|------|--------|
| `name` | `string` — drives initials + deterministic gradient |
| `size` | `xs` / `sm` / `md` / `lg` / `xl` |
| `ring` | `boolean` — subtle white/10 ring |
| `dot` | `'live'` / `'paused'` / `'off'` — status badge |

### Utility classes

#### Buttons — `.btn` + variant + size
```html
<button class="btn btn-primary btn-md">Save Job</button>
<button class="btn btn-secondary btn-sm">Cancel</button>
<button class="btn btn-danger btn-lg">Delete Forever</button>
<button class="btn btn-ghost btn-md">Dismiss</button>
<button class="btn btn-icon btn-secondary" aria-label="Edit"><Edit2/></button>
```

| Variant | When |
|---------|------|
| `btn-primary` | Primary CTA on a view — one per view |
| `btn-secondary` | Supporting actions |
| `btn-ghost` | Tertiary/dismiss |
| `btn-danger` | Destructive (with confirm) |
| `btn-success` | Positive confirmation (complete, approve) |
| `btn-icon` | Square icon-only; requires `aria-label` |

| Size | Height | Use |
|------|--------|-----|
| `btn-sm` | 32px | Dense tables, inline actions |
| `btn-md` | 40px | Default |
| `btn-lg` | 48px | Hero CTA, mobile primary |

**All buttons:**
- `cursor: pointer`, `transition`, active scale 0.98
- `:disabled` → 45% opacity, no pointer
- Min touch target 32–48px; icon-only has 36px min via `[aria-label]` rule

#### Inputs — `.input-field` + `.field-label`
```html
<div>
  <label class="field-label">PO Number</label>
  <input class="input-field" placeholder="e.g. 0076617-00" />
</div>
```
- Focus ring: 3px blue-500/18% shadow + blue-500 border
- Placeholder: `zinc-600`

#### Cards — `.card` / `.card-elevated` / `.card-interactive`
```html
<div class="card card-padding">
  <h3>Section</h3>
</div>

<div class="card-elevated card-padding-lg card-interactive hover-lift">
  <h3>Clickable</h3>
</div>
```

#### Chips / Badges — `.chip` + tone
```html
<span class="chip chip-success">ACTIVE</span>
<span class="chip chip-danger">OVERDUE</span>
<span class="chip chip-warning">PAUSED</span>
<span class="chip chip-primary">SCANNED</span>
```

#### Tint surfaces — `.tint-*`
```html
<div class="card-padding tint-danger">Overdue alert content</div>
```

---

## Accessibility contract

Every component must meet:
- **4.5:1** text contrast (AA)
- **36×36px** minimum touch target for icon-only
- Visible `:focus-visible` ring (inherited from global CSS)
- `aria-label` on every icon-only button
- `aria-hidden="true"` on decorative lucide icons

---

## Migration guide (inlined → utility)

| Old (inlined) | New (utility) |
|---------------|---------------|
| `bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-bold text-sm` | `btn btn-primary btn-sm` |
| `bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-xl font-bold` | `btn btn-primary btn-lg` |
| `bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white` | `input-field` |
| `bg-zinc-900/50 border border-white/5 rounded-2xl p-6` | `card card-padding-lg` |
| `text-[10px] bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded font-black` | `chip chip-danger` |

**Do not bulk-migrate** — change file-by-file when you're already touching that area. This keeps diffs safe.
