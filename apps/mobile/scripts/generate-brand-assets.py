#!/usr/bin/env python3
"""Generate NearbyOrders brand assets from the canonical Meridian N geometry.

Concept 3B "Clearer N" — approved 2026-09-25, locked as the final brand.

Canonical geometry (viewBox 0 0 1000 1000), traced from the approved artwork:
  - Left stem:  slate rect, full height
  - Ember diagonal: bold band from the top-left, crossing through the N and
    resolving into the location-pin point below the baseline
  - Right stem: slate, fuller than the refined concept, with the angled cut
    where the ember diagonal emerges

Draw order: left stem -> ember diagonal -> right stem.

Reads:  (nothing — geometry constants below are the source of truth)
Writes: brand/*.svg                      canonical vector sources
        android-brand/res/drawable/*.xml VectorDrawables (foreground,
                                         monochrome, splash)
        android-brand/res/values/colors.xml
        android-brand/res/mipmap-anydpi-v26/*.xml
        public/brand/*.svg               verbatim web copies
        public/favicon.svg
"""

import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # apps/mobile
BRAND = ROOT / "brand"
ANDROID_RES = ROOT / "android-brand" / "res"
PUBLIC_BRAND = ROOT / "public" / "brand"

SLATE = "#16222E"
EMBER = "#E23A2E"
PORCELAIN = "#F2F5F7"
WHITE = "#FFFFFF"

# Canonical Meridian N path data (1000x1000 grid). Do not edit without a
# design review — this is the locked, approved geometry.
LEFT_STEM_D = "M220,80 h69.7 v620.5 h-69.7 Z"
LEFT_STEM_D_ABS = "M220,80 L289.7,80 L289.7,700.5 L220,700.5 Z"
EMBER_D = "M220,80 L385.3,80 L711.6,623.8 L612.6,920.1 Z"
RIGHT_STEM_D = "M701.1,80 L779.9,80 L779.9,550.6 L701.1,613.3 Z"


def mark_group(stem_fill: str, ember_fill: str = EMBER) -> str:
    """The N mark as an SVG <g> (draw order: left stem, ember, right stem)."""
    return (
        f'<g>\n'
        f'    <path d="{LEFT_STEM_D}" fill="{stem_fill}"/>\n'
        f'    <path d="{EMBER_D}" fill="{ember_fill}"/>\n'
        f'    <path d="{RIGHT_STEM_D}" fill="{stem_fill}"/>\n'
        f"  </g>"
    )


def bake(paths, scale: float, tx: float, ty: float):
    """Bake an affine transform into absolute SVG path data (M/L/Z, pairs)."""
    out = []
    for d in paths:
        tokens = re.findall(r"[MLZ]|-?\d+(?:\.\d+)?", d)
        res, is_x = [], True
        for t in tokens:
            if t in "MLZ":
                res.append(t)
                is_x = True
            else:
                v = float(t)
                res.append(f"{(scale * v + (tx if is_x else ty)):.1f}")
                is_x = not is_x
        out.append(" ".join(res))
    return out


MARK_SVG_TMPL = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" role="img" aria-label="NearbyOrders mark">
  <title>{title}</title>
  <desc>{desc}</desc>
{group}
</svg>
"""

LOGO_TMPL = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} 160" role="img" aria-label="NearbyOrders logo">
  <title>NearbyOrders — Find nearby. Book or order.</title>
  <desc>Horizontal brand lockup: the Meridian N mark beside the NearbyOrders wordmark.</desc>
  <g transform="translate(28,36) scale(0.104)">
{group}
  </g>
  <text x="112" y="108" font-family="'Bricolage Grotesque', 'BricolageGrotesque', sans-serif" font-size="64" font-weight="800" letter-spacing="-1"><tspan fill="{nearby_fill}">Nearby</tspan><tspan fill="{orders_fill}">Orders</tspan></text>
</svg>
"""


def measure_wordmark() -> tuple[float, float]:
    """Measure 'Nearby'/'Orders' in Bricolage Grotesque ExtraBold at 64px."""
    from PIL import ImageFont

    candidates = [
        Path.home() / "workspace/brand-exploration/fonts/BricolageGrotesque-800.ttf",
        ROOT / "public/fonts/BricolageGrotesque-Variable.ttf",
    ]
    font_path = next((p for p in candidates if p.exists()), None)
    if font_path is None:
        # Fallback estimate; the committed SVG still references the family.
        return 250.0, 235.0
    font = ImageFont.truetype(str(font_path), 64)
    # Variable font: request the heaviest instance if supported.
    try:
        font.set_variation_by_axes([800])
    except Exception:
        pass
    w1 = font.getbbox("Nearby")[2]
    w2 = font.getbbox("Orders")[2]
    # letter-spacing -1 over ~12 glyphs
    return w1 - 6, w2 - 6


def write(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)}")


def main() -> int:
    # ---- brand/ canonical sources ----
    write(
        BRAND / "mark.svg",
        MARK_SVG_TMPL.format(
            title="NearbyOrders mark — the Meridian N",
            desc="A bold letter N in deep slate; an ember-red diagonal crosses through it and resolves into a location point. For light backgrounds.",
            group=mark_group(SLATE),
        ),
    )
    write(
        BRAND / "mark-on-dark.svg",
        MARK_SVG_TMPL.format(
            title="NearbyOrders mark — the Meridian N (on dark surfaces)",
            desc="Same Meridian N geometry with porcelain stems for dark backgrounds. Geometry unchanged.",
            group=mark_group(PORCELAIN),
        ),
    )

    w_nearby, w_orders = measure_wordmark()
    logo_w = int(112 + w_nearby + w_orders + 28)
    write(
        BRAND / "logo.svg",
        LOGO_TMPL.format(w=logo_w, group=mark_group(SLATE),
                         nearby_fill=SLATE, orders_fill=EMBER),
    )
    write(
        BRAND / "logo-on-dark.svg",
        LOGO_TMPL.format(w=logo_w, group=mark_group(PORCELAIN),
                         nearby_fill=PORCELAIN, orders_fill=EMBER),
    )

    # Launcher tile (108dp): porcelain rounded square, mark centered inside the
    # 66dp safe circle (scale 0.065 keeps the farthest artwork at r=32.8).
    launcher_group = (
        '<g transform="translate(21.5,21.5) scale(0.065)">\n'
        f"    {mark_group(SLATE).replace(chr(10), chr(10) + '    ')}\n"
        "  </g>"
    )
    write(
        BRAND / "icon-launcher.svg",
        f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" role="img" aria-label="NearbyOrders app icon">
  <title>NearbyOrders launcher icon</title>
  <rect width="108" height="108" rx="24" fill="{PORCELAIN}"/>
{launcher_group}
</svg>
""",
    )
    write(
        BRAND / "icon-foreground.svg",
        f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" role="img" aria-label="NearbyOrders adaptive icon foreground">
  <title>NearbyOrders adaptive-icon foreground (108dp master)</title>
  <desc>Keep artwork inside the central 66dp circle: Android masks the outer third on all launcher shapes.</desc>
{launcher_group}
</svg>
""",
    )
    mono_group = mark_group(WHITE, WHITE).replace("\n", "\n    ")
    write(
        BRAND / "icon-monochrome.svg",
        f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" role="img" aria-label="NearbyOrders monochrome icon">
  <title>NearbyOrders monochrome icon (Android 13+ themed icons)</title>
  <desc>Single-silhouette Meridian N; the launcher applies the dynamic tint.</desc>
  <g transform="translate(21.5,21.5) scale(0.065)">
    {mono_group}
  </g>
</svg>
""",
    )

    # ---- public/ web copies (verbatim) ----
    for name in ["mark.svg", "mark-on-dark.svg", "logo.svg", "logo-on-dark.svg"]:
        shutil.copy2(BRAND / name, PUBLIC_BRAND / f"nearbyorders-{name}")
        print(f"copied brand/{name} -> public/brand/nearbyorders-{name}")
    write(ROOT / "public" / "favicon.svg",
          (BRAND / "icon-launcher.svg").read_text(encoding="utf-8"))

    # ---- android-brand/res ----
    fg_paths = bake([LEFT_STEM_D_ABS, EMBER_D, RIGHT_STEM_D], 0.065, 21.5, 21.5)
    mono_paths = fg_paths  # same geometry, white fill
    write(
        ANDROID_RES / "drawable/ic_launcher_foreground.xml",
        f"""<?xml version="1.0" encoding="utf-8"?>
<!-- NearbyOrders adaptive-icon foreground (108dp master): the Meridian N.
     Artwork sits inside the central 66dp circle: launchers mask the outer third. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <!-- Left stem -->
    <path
        android:fillColor="{SLATE}"
        android:pathData="{fg_paths[0]}" />
    <!-- Ember diagonal: the N-to-location-point gesture -->
    <path
        android:fillColor="{EMBER}"
        android:pathData="{fg_paths[1]}" />
    <!-- Right stem (fuller, angled cut where the diagonal emerges) -->
    <path
        android:fillColor="{SLATE}"
        android:pathData="{fg_paths[2]}" />
</vector>
""",
    )
    write(
        ANDROID_RES / "drawable/ic_launcher_monochrome.xml",
        f"""<?xml version="1.0" encoding="utf-8"?>
<!-- NearbyOrders monochrome icon for Android 13+ themed icons.
     Single-silhouette Meridian N; the launcher applies the dynamic tint. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="{mono_paths[0]}" />
    <path
        android:fillColor="#FFFFFF"
        android:pathData="{mono_paths[1]}" />
    <path
        android:fillColor="#FFFFFF"
        android:pathData="{mono_paths[2]}" />
</vector>
""",
    )

    # Splash (Android 12+ SplashScreen API): porcelain window background (see
    # colors.xml), the N mark large and centered on transparent. 288dp canvas,
    # artwork within r=96 of center (scale 0.18 -> farthest point r=90.9).
    sp_paths = bake([LEFT_STEM_D_ABS, EMBER_D, RIGHT_STEM_D], 0.18, 54.0, 54.0)
    write(
        ANDROID_RES / "drawable/splash_icon_vector.xml",
        f"""<?xml version="1.0" encoding="utf-8"?>
<!-- NearbyOrders splash icon (Android 12+ SplashScreen API): the Meridian N,
     large and centered on the porcelain window background.
     288dp canvas, artwork within r=96 of center.
     Rendered through the animated-vector wrapper so the platform draws it at
     full size instead of upscaling a 108dp pre-render. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="288dp"
    android:height="288dp"
    android:viewportWidth="288"
    android:viewportHeight="288">
    <path
        android:fillColor="{SLATE}"
        android:pathData="{sp_paths[0]}" />
    <path
        android:fillColor="{EMBER}"
        android:pathData="{sp_paths[1]}" />
    <path
        android:fillColor="{SLATE}"
        android:pathData="{sp_paths[2]}" />
</vector>
""",
    )
    write(
        ANDROID_RES / "drawable/splash_icon.xml",
        """<?xml version="1.0" encoding="utf-8"?>
<!-- Wraps the static splash vector as an animated-vector (no animators) so the
     Android 12+ splash pipeline renders it at full size instead of upscaling a
     108dp pre-render (which shows up blurry on xhdpi+ devices). -->
<animated-vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:drawable="@drawable/splash_icon_vector" />
""",
    )

    anydpi = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
"""
    write(ANDROID_RES / "mipmap-anydpi-v26/ic_launcher.xml", anydpi)
    write(ANDROID_RES / "mipmap-anydpi-v26/ic_launcher_round.xml", anydpi)

    write(
        ANDROID_RES / "values/colors.xml",
        f"""<?xml version="1.0" encoding="utf-8"?>
<!-- NearbyOrders brand colors (Atlas Refined).
     Also supplies colorPrimary/colorPrimaryDark/colorAccent, which the
     generated AppTheme references. -->
<resources>
    <color name="ic_launcher_background">{PORCELAIN}</color>
    <color name="splash_background">{PORCELAIN}</color>
    <color name="colorPrimary">{SLATE}</color>
    <color name="colorPrimaryDark">#0E1620</color>
    <color name="colorAccent">{EMBER}</color>
</resources>
""",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
