#!/usr/bin/env python3
"""Generate NearbyOrders Android launcher PNGs from the SVG masters.

Reads:  brand/icon-launcher.svg
Writes: android-brand/res/mipmap-<density>/ic_launcher.png
        android-brand/res/mipmap-<density>/ic_launcher_round.png

Square icons are the burgundy tile + cream mark. Round icons are the same
artwork circle-cropped (matching what launchers do with android:roundIcon).
"""
import io
import sys
from pathlib import Path

import cairosvg
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]  # apps/mobile
BRAND = ROOT / "brand"
OUT = ROOT / "android-brand" / "res"

DENSITIES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

MASTER_PX = 768  # render large, then downscale for crisp edges


def render_square(px: int) -> Image.Image:
    png = cairosvg.svg2png(
        url=str(BRAND / "icon-launcher.svg"),
        output_width=MASTER_PX,
        output_height=MASTER_PX,
    )
    img = Image.open(io.BytesIO(png)).convert("RGBA")
    return img.resize((px, px), Image.LANCZOS)


def circle_crop(img: Image.Image) -> Image.Image:
    size = img.size[0]
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size, size), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def main() -> int:
    if not (BRAND / "icon-launcher.svg").exists():
        print("missing brand/icon-launcher.svg", file=sys.stderr)
        return 1
    for density, px in DENSITIES.items():
        d = OUT / density
        d.mkdir(parents=True, exist_ok=True)
        square = render_square(px)
        square.save(d / "ic_launcher.png")
        circle_crop(square).save(d / "ic_launcher_round.png")
        print(f"{density}: ic_launcher.png + ic_launcher_round.png ({px}px)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
