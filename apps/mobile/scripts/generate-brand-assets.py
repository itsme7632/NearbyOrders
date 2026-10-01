#!/usr/bin/env python3
"""Generate NearbyOrders brand assets from the canonical N+O geometry.

Phase 9 / 9B "N+O" — geometry approved and FROZEN 2026-09-30.
Color application: the real production app theme (9B).

Canonical geometry (viewBox 0 0 120 120) — DO NOT EDIT without a design
review; this is the locked, approved construction:
  - N: one stroked path (two sub-paths), stroke 14, round joins/caps.
    Diagonal runs upper-left -> lower-right.
  - O: ring centered EXACTLY on the diagonal midpoint (60,60); outer R=13,
    ring stroke 6, counter r=7. The diagonal does NOT pass through the
    inside of the O; its butt-ends are buried under the ring.
  - Four cubic-Bezier weld slivers smooth the beam/ring junctions,
    tangent-continuous to both.

Draw order: N sub-paths -> O ring -> weld slivers. Pure vector: no masks,
no gradients, no booleans.

Reads:  (nothing — geometry constants/functions below are the source of truth)
Writes: brand/*.svg                      canonical vector sources
        android-brand/res/drawable/*.xml VectorDrawables (foreground,
                                         monochrome, splash vector)
        android-brand/res/animator/*.xml splash N->O choreography
        android-brand/res/values/colors.xml
        android-brand/res/mipmap-anydpi-v26/*.xml
        public/brand/*.svg               verbatim web copies
        public/favicon.svg
"""

import math
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # apps/mobile
BRAND = ROOT / "brand"
ANDROID_RES = ROOT / "android-brand" / "res"
PUBLIC_BRAND = ROOT / "public" / "brand"

# ---- Production theme tokens (verified from apps/mobile/src/styles.css,
#      apps/admin/src/styles.css, apps/mobile/brand/README.md) ----
SLATE = "#16222E"        # primary brand / N structure / primary ink
SLATE_DEEP = "#0F1822"   # mobile --brand-strong
ADMIN_SLATE = "#0E1720"  # admin sidebar surface
EMBER = "#E23A2E"        # O tie / action accent
EMBER_STRONG = "#C22E24"
EMBER_SOFT = "#FBE9E7"
PORCELAIN = "#F2F5F7"    # app background / splash / launcher tile
WHITE = "#FFFFFF"
BRAND_SOFT = "#E8EEF3"
INK_2 = "#33465A"
MUTED = "#5C6E80"
BORDER = "#E3E9EF"

# ======================================================================
# FROZEN Phase 9 geometry (ported from the approved phase9b reference).
# ======================================================================
NX1, NY_TOP, NY_BOT = 29.0, 30.0, 90.0
NX2 = 91.0
N_STROKE = 14.0
W = N_STROKE / 2.0

A_PT = (NX1, NY_TOP)
B_PT = (NX2, NY_BOT)

CX, CY = 60.0, 60.0          # diagonal midpoint == O center
R_OUT = 13.0
RING = 6.0
R_IN = R_OUT - RING          # counter radius = 7
R_MID = R_OUT - RING / 2.0   # ring centerline radius = 10

L0 = 11.0                    # weld: beam-edge run-up before the kink
DPHI = math.radians(60.0)    # weld: arc around the ring past the kink
BLEND_C = 9.0                # weld: bezier control length
D_BURY = 10.9                # diagonal butt-ends buried this far under the ring
assert D_BURY ** 2 + W ** 2 <= R_OUT ** 2


def _norm(v):
    l = math.hypot(*v)
    return (v[0] / l, v[1] / l)


_U = _norm((B_PT[0] - A_PT[0], B_PT[1] - A_PT[1]))  # diagonal direction (down-right)
_NUP = (_U[1], -_U[0])                             # "upper" edge normal (right-up)

_S = math.sqrt(R_OUT ** 2 - W ** 2)                # edge/circle intersection offset


def junctions():
    """Beam-edge / outer-circle junction points K1..K4."""
    k1 = (CX + W * _NUP[0] - _S * _U[0], CY + W * _NUP[1] - _S * _U[1])
    k2 = (CX - W * _NUP[0] - _S * _U[0], CY - W * _NUP[1] - _S * _U[1])
    k3 = (2 * CX - k1[0], 2 * CY - k1[1])
    k4 = (2 * CX - k2[0], 2 * CY - k2[1])
    return [k1, k2, k3, k4]


def _mirror_diag(p):
    """Mirror a point across the diagonal centerline."""
    vx, vy = p[0] - CX, p[1] - CY
    par = vx * _U[0] + vy * _U[1]
    px, py = par * _U[0], par * _U[1]
    return (CX + px - (vx - px), CY + py - (vy - py))


def _rot180(p):
    return (2 * CX - p[0], 2 * CY - p[1])


def _sliver_k1(l0=L0, dphi=DPHI, c=BLEND_C):
    """Weld sliver for junction K1 (upper edge, top-left).

    Returns dict of points; other slivers derive by mirror/rotation.
    Sliver polygon: P0 -> K -> (arc) -> P3 -> (bezier) -> P0.
    """
    k = (CX + W * _NUP[0] - _S * _U[0], CY + W * _NUP[1] - _S * _U[1])
    p0 = (k[0] - l0 * _U[0], k[1] - l0 * _U[1])
    c1 = (p0[0] + c * _U[0], p0[1] + c * _U[1])
    phi_k = math.atan2(k[1] - CY, k[0] - CX)
    phi_3 = phi_k - dphi  # toward K2 (decreasing angle)
    p3 = (CX + R_OUT * math.cos(phi_3), CY + R_OUT * math.sin(phi_3))
    t3 = (math.sin(phi_3), -math.cos(phi_3))  # travel direction (decreasing phi)
    c2 = (p3[0] - c * t3[0], p3[1] - c * t3[1])
    # arc samples from K to P3 along the circle
    n = 10
    arc = [
        (CX + R_OUT * math.cos(phi_k + (phi_3 - phi_k) * i / n),
         CY + R_OUT * math.sin(phi_k + (phi_3 - phi_k) * i / n))
        for i in range(1, n)
    ]
    return {"p0": p0, "k": k, "arc": arc, "p3": p3, "c1": c1, "c2": c2}


def slivers(l0=L0, dphi=DPHI, c=BLEND_C):
    """All four weld slivers as point dicts."""
    s1 = _sliver_k1(l0, dphi, c)
    xf = {
        "p0": _mirror_diag, "k": _mirror_diag, "p3": _mirror_diag,
        "c1": _mirror_diag, "c2": _mirror_diag,
    }
    s2 = {kk: (xf[kk](v) if kk != "arc" else [_mirror_diag(p) for p in v])
          for kk, v in s1.items()}
    s3 = {kk: (_rot180(v) if kk != "arc" else [_rot180(p) for p in v])
          for kk, v in s1.items()}
    s4 = {kk: (_rot180(v) if kk != "arc" else [_rot180(p) for p in v])
          for kk, v in s2.items()}
    return [s1, s2, s3, s4]


def _sliver_path(s):
    d = f"M{s['p0'][0]:.2f} {s['p0'][1]:.2f} L{s['k'][0]:.2f} {s['k'][1]:.2f}"
    for p in s["arc"]:
        d += f" L{p[0]:.2f} {p[1]:.2f}"
    d += (f" L{s['p3'][0]:.2f} {s['p3'][1]:.2f}"
          f" C{s['c2'][0]:.2f} {s['c2'][1]:.2f} "
          f"{s['c1'][0]:.2f} {s['c1'][1]:.2f} "
          f"{s['p0'][0]:.2f} {s['p0'][1]:.2f} Z")
    return d


def beam_ends(d=D_BURY):
    """Inner butt-ends of the two diagonal segments, buried under the ring."""
    e1 = (CX - d * _U[0], CY - d * _U[1])
    e2 = (CX + d * _U[0], CY + d * _U[1])
    return e1, e2


def n_left_d():
    e1, _ = beam_ends()
    return f"M{NX1:g} {NY_BOT:g} L{NX1:g} {NY_TOP:g} L{e1[0]:.2f} {e1[1]:.2f}"


def n_right_d():
    _, e2 = beam_ends()
    return f"M{e2[0]:.2f} {e2[1]:.2f} L{NX2:g} {NY_BOT:g} L{NX2:g} {NY_TOP:g}"


def ring_path_d():
    """O ring centerline as path data (two arcs), for VectorDrawable."""
    x0 = CX - R_MID
    x1 = CX + R_MID
    return (f"M{x0:g} {CY:g} A{R_MID:g} {R_MID:g} 0 1 1 {x1:g} {CY:g} "
            f"A{R_MID:g} {R_MID:g} 0 1 1 {x0:g} {CY:g} Z")


def sliver_paths():
    """The four weld sliver path-data strings, in reference order."""
    return [_sliver_path(s) for s in slivers()]


# ======================================================================
# SVG assembly
# ======================================================================

def mark_inner(n_fill: str, o_fill: str = EMBER) -> str:
    """The N+O mark as SVG inner content (120x120 grid)."""
    sw = f"{N_STROKE:g}"
    rw = f"{RING:g}"
    parts = [
        f'<path d="{n_left_d()}" stroke="{n_fill}" stroke-width="{sw}" '
        f'fill="none" stroke-linejoin="round" stroke-linecap="round"/>',
        f'<path d="{n_right_d()}" stroke="{n_fill}" stroke-width="{sw}" '
        f'fill="none" stroke-linejoin="round" stroke-linecap="round"/>',
        f'<circle cx="{CX:g}" cy="{CY:g}" r="{R_MID:g}" fill="none" '
        f'stroke="{o_fill}" stroke-width="{rw}"/>',
    ]
    parts += [f'<path d="{d}" fill="{o_fill}"/>' for d in sliver_paths()]
    return "\n".join("  " + p for p in parts)


MARK_SVG_TMPL = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="NearbyOrders mark">
  <title>{title}</title>
  <desc>{desc}</desc>
{inner}
</svg>
"""

LOGO_TMPL = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} 160" role="img" aria-label="NearbyOrders logo">
  <title>NearbyOrders — Find nearby. Book or order.</title>
  <desc>Horizontal brand lockup: the N+O mark beside the NearbyOrders wordmark.</desc>
  <g transform="translate(24,28) scale(0.86667)">
{inner}
  </g>
  <text x="140" y="104" font-family="'Bricolage Grotesque', 'BricolageGrotesque', sans-serif" font-size="60" font-weight="800" letter-spacing="-1"><tspan fill="{nearby_fill}">Nearby</tspan><tspan fill="{orders_fill}">Orders</tspan></text>
</svg>
"""


def measure_wordmark() -> tuple[float, float]:
    """Measure 'Nearby'/'Orders' in Bricolage Grotesque ExtraBold at 60px."""
    from PIL import ImageFont

    candidates = [
        Path.home() / "workspace/brand-exploration/fonts/BricolageGrotesque-800.ttf",
        ROOT / "public/fonts/BricolageGrotesque-Variable.ttf",
    ]
    font_path = next((p for p in candidates if p.exists()), None)
    if font_path is None:
        return 235.0, 220.0
    font = ImageFont.truetype(str(font_path), 60)
    try:
        font.set_variation_by_axes([800])
    except Exception:
        pass
    w1 = font.getbbox("Nearby")[2]
    w2 = font.getbbox("Orders")[2]
    return w1 - 6, w2 - 6


def write(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)}")


# ======================================================================
# Android VectorDrawable assembly (120-grid artwork via <group> transform,
# so pathData stays byte-identical to the approved geometry).
# ======================================================================

def vd_group(tx: float, ty: float, scale: float, inner: str, name: str = None) -> str:
    name_attr = f'\n        android:name="{name}"' if name else ""
    return (
        f'    <group{name_attr}\n'
        f'        android:translateX="{tx:g}"\n'
        f'        android:translateY="{ty:g}"\n'
        f'        android:scaleX="{scale:g}"\n'
        f'        android:scaleY="{scale:g}">\n'
        f"{inner}\n"
        f"    </group>"
    )


def vd_n_paths(n_color: str) -> str:
    """The two stroked N sub-paths as VectorDrawable <path> elements.

    Names (n_path_l / n_path_r) are animation targets for the splash
    N -> O choreography.
    """
    sw = f"{N_STROKE:g}"
    out = []
    for key, d in (("n_path_l", n_left_d()), ("n_path_r", n_right_d())):
        out.append(
            f'        <path\n'
            f'            android:name="{key}"\n'
            f'            android:strokeColor="{n_color}"\n'
            f'            android:strokeWidth="{sw}"\n'
            f'            android:strokeLineCap="round"\n'
            f'            android:strokeLineJoin="round"\n'
            f'            android:pathData="{d}" />'
        )
    return "\n".join(out)


def vd_o_paths(o_color: str, group_name: str = "o_group") -> str:
    """O ring + weld slivers, wrapped in a named group for the splash fade."""
    rw = f"{RING:g}"
    inner = "\n".join(
        [
            f'            <path\n'
            f'                android:strokeColor="{o_color}"\n'
            f'                android:strokeWidth="{rw}"\n'
            f'                android:pathData="{ring_path_d()}" />',
        ]
        + [
            f'            <path\n'
            f'                android:fillColor="{o_color}"\n'
            f'                android:pathData="{d}" />'
            for d in sliver_paths()
        ]
    )
    return (
        f'        <group\n'
        f'            android:name="{group_name}">\n'
        f"{inner}\n"
        f"        </group>"
    )


def main() -> int:
    # ---- brand/ canonical sources ----
    write(
        BRAND / "mark.svg",
        MARK_SVG_TMPL.format(
            title="NearbyOrders mark — N+O",
            desc=("The approved N+O mark: a slate N with an ember O welded "
                  "onto its diagonal. For light backgrounds. Geometry frozen 2026-09-30."),
            inner=mark_inner(SLATE),
        ),
    )
    write(
        BRAND / "mark-on-dark.svg",
        MARK_SVG_TMPL.format(
            title="NearbyOrders mark — N+O (on dark surfaces)",
            desc=("Same N+O geometry with porcelain N for dark backgrounds. "
                  "Geometry unchanged."),
            inner=mark_inner(PORCELAIN),
        ),
    )

    w_nearby, w_orders = measure_wordmark()
    logo_w = int(140 + w_nearby + w_orders + 24)
    write(
        BRAND / "logo.svg",
        LOGO_TMPL.format(w=logo_w, inner=mark_inner(SLATE),
                         nearby_fill=SLATE, orders_fill=EMBER),
    )
    write(
        BRAND / "logo-on-dark.svg",
        LOGO_TMPL.format(w=logo_w, inner=mark_inner(PORCELAIN),
                         nearby_fill=PORCELAIN, orders_fill=EMBER),
    )

    # Launcher tile (108dp): porcelain rounded square, mark centered inside
    # the 66dp safe circle (120-grid artwork scaled to 65 units).
    LAUNCHER_S = 65.0 / 120.0
    LAUNCHER_T = (108.0 - 65.0) / 2.0
    launcher_inner = (
        f'  <g transform="translate({LAUNCHER_T:g},{LAUNCHER_T:g}) scale({LAUNCHER_S:.6f})">\n'
        f"{mark_inner(SLATE).replace(chr(10), chr(10) + '    ')}\n"
        "  </g>"
    )
    write(
        BRAND / "icon-launcher.svg",
        f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" role="img" aria-label="NearbyOrders app icon">
  <title>NearbyOrders launcher icon</title>
  <rect width="108" height="108" rx="24" fill="{PORCELAIN}"/>
{launcher_inner}
</svg>
""",
    )
    write(
        BRAND / "icon-foreground.svg",
        f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" role="img" aria-label="NearbyOrders adaptive icon foreground">
  <title>NearbyOrders adaptive-icon foreground (108dp master)</title>
  <desc>Keep artwork inside the central 66dp circle: Android masks the outer third on all launcher shapes.</desc>
{launcher_inner}
</svg>
""",
    )
    mono_inner = mark_inner(WHITE, WHITE)
    write(
        BRAND / "icon-monochrome.svg",
        f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" role="img" aria-label="NearbyOrders monochrome icon">
  <title>NearbyOrders monochrome icon (Android 13+ themed icons)</title>
  <desc>Single-silhouette N+O; the launcher applies the dynamic tint.</desc>
  <g transform="translate({LAUNCHER_T:g},{LAUNCHER_T:g}) scale({LAUNCHER_S:.6f})">
{mono_inner.replace(chr(10), chr(10) + '    ')}
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
    fg_inner = vd_n_paths(SLATE) + "\n" + vd_o_paths(EMBER)
    write(
        ANDROID_RES / "drawable/ic_launcher_foreground.xml",
        f"""<?xml version="1.0" encoding="utf-8"?>
<!-- NearbyOrders adaptive-icon foreground (108dp master): the N+O mark.
     Artwork sits inside the central 66dp circle: launchers mask the outer third.
     The <group> transform keeps pathData byte-identical to the approved
     120-grid geometry (frozen 2026-09-30). -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
{vd_group(LAUNCHER_T, LAUNCHER_T, LAUNCHER_S, fg_inner)}
</vector>
""",
    )
    mono_vd_inner = vd_n_paths(WHITE) + "\n" + vd_o_paths(WHITE)
    write(
        ANDROID_RES / "drawable/ic_launcher_monochrome.xml",
        f"""<?xml version="1.0" encoding="utf-8"?>
<!-- NearbyOrders monochrome icon for Android 13+ themed icons.
     Single-silhouette N+O; the launcher applies the dynamic tint. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
{vd_group(LAUNCHER_T, LAUNCHER_T, LAUNCHER_S, mono_vd_inner)}
</vector>
""",
    )

    # Splash (Android 12+ SplashScreen API): porcelain window background (see
    # colors.xml), the N+O mark large and centered on transparent. 288dp
    # canvas; 120-grid artwork scaled x1.5 (180 units) and centered.
    # The N draws first (trimPath 0-300ms), then the O ring + welds fade in
    # (250-700ms), then a 200ms settle hold: the approved 900ms N -> O
    # storyboard, as a native AnimatedVectorDrawable.
    SP_S = 1.5
    SP_T = (288.0 - 120.0 * SP_S) / 2.0
    splash_inner = vd_n_paths(SLATE) + "\n" + vd_o_paths(EMBER)
    write(
        ANDROID_RES / "drawable/splash_icon_vector.xml",
        f"""<?xml version="1.0" encoding="utf-8"?>
<!-- NearbyOrders splash icon (Android 12+ SplashScreen API): the N+O mark,
     large and centered on the porcelain window background.
     288dp canvas. Named paths/groups are animation targets for
     splash_icon.xml (N draws via trimPath, O fades in). -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="288dp"
    android:height="288dp"
    android:viewportWidth="288"
    android:viewportHeight="288">
{vd_group(SP_T, SP_T, SP_S, splash_inner, "mark_root")}
</vector>
""",
    )
    write(
        ANDROID_RES / "drawable/splash_icon.xml",
        """<?xml version="1.0" encoding="utf-8"?>
<!-- NearbyOrders launch splash: N draws first (0-300ms), then the O ring +
     welds fade in (250-700ms), then a 200ms settle hold — the approved 900ms
     N -> O storyboard. Finishes on the exact production mark. -->
<animated-vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:drawable="@drawable/splash_icon_vector">
    <target
        android:name="n_path_l"
        android:animation="@animator/n_draw" />
    <target
        android:name="n_path_r"
        android:animation="@animator/n_draw" />
    <target
        android:name="o_group"
        android:animation="@animator/o_fade" />
    <target
        android:name="mark_root"
        android:animation="@animator/settle" />
</animated-vector>
""",
    )
    write(
        ANDROID_RES / "animator/n_draw.xml",
        """<?xml version="1.0" encoding="utf-8"?>
<!-- N stroke draws in over the first 300ms of the splash. -->
<objectAnimator xmlns:android="http://schemas.android.com/apk/res/android"
    android:propertyName="trimPathEnd"
    android:valueFrom="0"
    android:valueTo="1"
    android:startOffset="0"
    android:duration="300"
    android:interpolator="@android:interpolator/fast_out_slow_in" />
""",
    )
    write(
        ANDROID_RES / "animator/o_fade.xml",
        """<?xml version="1.0" encoding="utf-8"?>
<!-- O ring + welds fade in 250-700ms, resolving onto the drawn N. -->
<objectAnimator xmlns:android="http://schemas.android.com/apk/res/android"
    android:propertyName="alpha"
    android:valueFrom="0"
    android:valueTo="1"
    android:startOffset="250"
    android:duration="450"
    android:interpolator="@android:interpolator/fast_out_slow_in" />
""",
    )
    write(
        ANDROID_RES / "animator/settle.xml",
        """<?xml version="1.0" encoding="utf-8"?>
<!-- Settle hold 700-900ms: no-op alpha hold on the root group so the full
     splash lifecycle is the approved 900ms. The artwork does not move. -->
<objectAnimator xmlns:android="http://schemas.android.com/apk/res/android"
    android:propertyName="alpha"
    android:valueFrom="1"
    android:valueTo="1"
    android:startOffset="0"
    android:duration="900" />
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
<!-- NearbyOrders brand colors (production app theme, Phase 9B).
     Also supplies colorPrimary/colorPrimaryDark/colorAccent, which the
     generated AppTheme references. -->
<resources>
    <color name="ic_launcher_background">{PORCELAIN}</color>
    <color name="splash_background">{PORCELAIN}</color>
    <color name="colorPrimary">{SLATE}</color>
    <color name="colorPrimaryDark">{SLATE_DEEP}</color>
    <color name="colorAccent">{EMBER}</color>
</resources>
""",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
