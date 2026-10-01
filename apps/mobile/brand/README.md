# NearbyOrders brand sources

Canonical vector sources for the NearbyOrders identity (Atlas Refined).
These are the design source of truth; platform-specific assets are generated
from them by `../scripts/generate-brand-assets.py` (SVG + Android XML) and
`../scripts/generate-android-icons.py` (raster launcher PNGs).

## The mark — N+O (Phase 9 geometry, approved and FROZEN 2026-09-30; Phase 9B color application)

A confident letter **N** with an **O** welded exactly onto its diagonal: the
O is centered on the diagonal midpoint, balanced on both sides, and fused to
the beam with smooth tangent-continuous welds. The diagonal does not pass
through the inside of the O — one integrated engineered shape.

- Flat fills only — no gradients, no 3D, no shadows, no decorative effects.
- Do not reinterpret the geometry, recolor, or add elements without a design
  review. The geometry is frozen.

| File                  | Use                                              |
| --------------------- | ------------------------------------------------ |
| `mark.svg`            | Primary mark (slate N, ember O/tie) — on light surfaces |
| `mark-on-dark.svg`    | Porcelain N variant — on dark surfaces (geometry unchanged) |
| `logo.svg`            | Horizontal lockup: mark + NearbyOrders wordmark (Bricolage Grotesque 800; "Nearby" slate, "Orders" ember) |
| `logo-on-dark.svg`    | Lockup for dark surfaces ("Nearby" porcelain)    |
| `icon-launcher.svg`   | 108dp launcher tile (porcelain rounded square + mark in the 66dp safe circle) |
| `icon-foreground.svg` | 108dp adaptive-icon foreground master (transparent) |
| `icon-monochrome.svg` | 108dp monochrome silhouette (Android 13+ themed icons) |

## Palette (production app theme — Phase 9B)

| Token       | Hex       | Role                              |
| ----------- | --------- | --------------------------------- |
| Porcelain   | `#F2F5F7` | Light surfaces / splash / launcher tile |
| Slate       | `#16222E` | N structure, "Nearby", primary ink |
| Slate Deep  | `#0F1822` | Strong brand surfaces (mobile)    |
| Admin Slate | `#0E1720` | Dark admin surfaces               |
| Ember       | `#E23A2E` | O/tie, "Orders", action accent    |
| Ember Strong| `#C22E24` | Pressed/hover accent              |
| Ember Soft  | `#FBE9E7` | Tinted accent surfaces            |
| Brand Soft  | `#E8EEF3` | Soft brand surfaces               |
| Ink-2       | `#33465A` | Secondary ink                     |
| Muted       | `#5C6E80` | Muted text                        |
| Border      | `#E3E9EF` | Hairline borders                  |
| White       | `#FFFFFF` | Raised surfaces                   |

Never use generic black as the brand color. These mirror the CSS tokens in
`apps/mobile/src/styles.css` and `apps/admin/src/styles.css`.

## Generated from these sources

- `../public/brand/*` + `../public/favicon.svg` — published web copies
  (verbatim copies of the SVGs above).
- `../android-brand/res/mipmap-*/ic_launcher*.png` — raster launcher icons,
  via `../scripts/generate-android-icons.py` (needs `cairosvg` + `Pillow`).
- `../android-brand/res/drawable/ic_launcher_foreground.xml` — VectorDrawable
  with the N+O path data on the 120-grid (via a `<group>` transform, so the
  pathData stays byte-identical to the approved geometry).
- `../android-brand/res/drawable/ic_launcher_monochrome.xml` — white
  silhouette for themed icons.
- `../android-brand/res/drawable/splash_icon*.xml` + `../android-brand/res/animator/*`
  — 288dp splash artwork with the approved N → O choreography (N draws
  0–300ms, O ring + welds fade in 250–700ms); the window background is
  porcelain.

## Rules

- Never place text inside the launcher/splash mark.
- Keep the mark inside the central 66dp circle of the 108dp adaptive canvas —
  launchers mask the outer third.
- Never recolor outside the palette above without a design review.
