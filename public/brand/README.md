# FabTrack IO — Brand Asset Files

Save the three logos the user provided into this folder. Any code path that
references brand images expects these exact filenames:

| Filename              | What it is                                      | Dimensions                |
|-----------------------|--------------------------------------------------|---------------------------|
| `ftio-icon.png`       | Badge / app icon (rounded-square, blue F+T+IO)   | Square, ≥ 512×512         |
| `fabtrack-io-logo.png`| Full lockup (FTIO mark above "FabTrack IO" text) | Square, ≥ 1024×1024       |
| `fabtrack-io-wordmark.png` | Horizontal wordmark only (no mark)          | Wide, ≥ 1200×300          |

Also save SVG versions if possible:

- `ftio-icon.svg`
- `fabtrack-io-logo.svg`
- `fabtrack-io-wordmark.svg`

The SVGs are preferred for the in-app header and PDF/printable documents
because they scale without blur.

## Where each asset gets used

- **App header (top-left in sidebar)** → `ftio-icon.svg` (falls back to `.png`)
- **Login page hero** → `fabtrack-io-logo.svg`
- **Printable Job Traveler / Quote / PO header** → `fabtrack-io-wordmark.png`
- **PWA install icon** → `ftio-icon.png`
- **favicon.ico** → generated from `ftio-icon.png`
- **Landing page (marketing)** → all three at various places

## Drop-in instructions

1. Export the three images from your design tool
2. Save them in this folder with the filenames above
3. Re-run `npm run dev` — the app auto-picks them up from `/brand/…`
