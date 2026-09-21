# NearbyOrders brand sources

Canonical vector sources for the NearbyOrders identity (Warm Proximity / V7
Editorial direction). These are the design source of truth; platform-specific
assets are generated from them.

## The mark

A location pin holding a shopping bag — the product idea in one glyph:
**"Find nearby. Book or order."**

- The pin reads at launcher-icon size; the bag rewards a second look.
- Flat fills only — no gradients, no glassmorphism, no decorative effects.

| File                  | Use                                              |
| --------------------- | ------------------------------------------------ |
| `mark.svg`            | Primary mark (cream pin) — on brand/dark surfaces |
| `mark-on-light.svg`   | Burgundy pin variant — on light surfaces          |
| `logo.svg`            | Horizontal lockup: mark + wordmark + tagline      |
| `icon-launcher.svg`   | Legacy launcher tile (burgundy rounded square)    |
| `icon-foreground.svg` | 108dp adaptive-icon foreground master            |

## Palette

| Token             | Hex       | Role                              |
| ----------------- | --------- | --------------------------------- |
| Deep burgundy     | `#5C1310` | Brand primary / icon background   |
| Burgundy strong   | `#4A0F0B` | Pressed states                    |
| Burnt orange      | `#C65324` | Action accent (bag handle)        |
| Warm cream        | `#F6F5F2` | Splash / light surfaces           |
| Paper             | `#FBFAF8` | Pin fill on brand surfaces        |
| Ink               | `#171211` | Wordmark                          |
| Muted             | `#756C65` | Tagline                           |

These mirror the CSS tokens in `apps/mobile/src/styles.css`.

## Generated from these sources

- `../public/brand/*` + `../public/favicon.svg` — published web copies
  (verbatim copies of the SVGs above).
- `../android-brand/res/mipmap-*/ic_launcher*.png` — raster launcher icons,
  via `../scripts/generate-android-icons.py` (needs `cairosvg` + `Pillow`).
- `../android-brand/res/drawable/ic_launcher_foreground.xml` — hand-written
  VectorDrawable tracing `icon-foreground.svg` (same path data).
- `../android-brand/res/drawable/splash_icon*.xml` — 288dp splash artwork
  derived from the same pin geometry.

## Rules

- Never place text inside the launcher/splash mark.
- Keep the pin inside the central 66dp circle of the 108dp adaptive canvas —
  launchers mask the outer third.
- Do not recolor outside the palette above without a design review.
