# NearbyOrders brand sources

Canonical vector sources for the NearbyOrders identity (Atlas Refined).
These are the design source of truth; platform-specific assets are generated
from them by `../scripts/generate-brand-assets.py` (SVG + Android XML) and
`../scripts/generate-android-icons.py` (raster launcher PNGs).

## The mark — the Meridian N (Concept 3B "Clearer N", approved 2026-09-25, LOCKED)

A bold letter **N** whose ember-red diagonal crosses through it and resolves
into a location point below the baseline: **N + nearby**, one intentional
gesture. The right stem is fuller for immediate N readability, with the
angled cut where the diagonal emerges.

- Flat fills only — no gradients, no 3D, no shadows, no decorative effects.
- Do not reinterpret the geometry, recolor, or add elements without a design
  review. This mark is final.

| File                  | Use                                              |
| --------------------- | ------------------------------------------------ |
| `mark.svg`            | Primary mark (slate stems) — on light surfaces   |
| `mark-on-dark.svg`    | Porcelain stems variant — on dark surfaces (geometry unchanged) |
| `logo.svg`            | Horizontal lockup: mark + NearbyOrders wordmark (Bricolage Grotesque 800; "Nearby" slate, "Orders" ember) |
| `logo-on-dark.svg`    | Lockup for dark surfaces ("Nearby" porcelain)    |
| `icon-launcher.svg`   | 108dp launcher tile (porcelain rounded square + mark in the 66dp safe circle) |
| `icon-foreground.svg` | 108dp adaptive-icon foreground master (transparent) |
| `icon-monochrome.svg` | 108dp monochrome silhouette (Android 13+ themed icons) |

## Palette (Atlas Refined)

| Token     | Hex       | Role                              |
| --------- | --------- | --------------------------------- |
| Porcelain | `#F2F5F7` | Light surfaces / splash / launcher tile |
| Slate     | `#16222E` | N stems, "Nearby", primary ink     |
| Ember     | `#E23A2E` | Diagonal gesture, "Orders", action accent |

These mirror the CSS tokens in `apps/mobile/src/styles.css`
(`--brand`, `--ink`, `--action`).

## Generated from these sources

- `../public/brand/*` + `../public/favicon.svg` — published web copies
  (verbatim copies of the SVGs above).
- `../android-brand/res/mipmap-*/ic_launcher*.png` — raster launcher icons,
  via `../scripts/generate-android-icons.py` (needs `cairosvg` + `Pillow`).
- `../android-brand/res/drawable/ic_launcher_foreground.xml` — VectorDrawable
  with the Meridian N path data baked to the 108dp grid.
- `../android-brand/res/drawable/ic_launcher_monochrome.xml` — white
  silhouette for themed icons.
- `../android-brand/res/drawable/splash_icon*.xml` — 288dp splash artwork
  (the N large on transparent; the window background is porcelain).

## Rules

- Never place text inside the launcher/splash mark.
- Keep the N inside the central 66dp circle of the 108dp adaptive canvas —
  launchers mask the outer third.
- Never recolor outside the palette above without a design review.
