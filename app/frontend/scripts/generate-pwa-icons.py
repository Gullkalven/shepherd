#!/usr/bin/env python3
"""
Regenerate PWA / favicon / apple-touch-icon assets from public/shepherd-logo.png.

Run from repo root or app/frontend:
  python3 scripts/generate-pwa-icons.py
Requires: Pillow (pip install Pillow)
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

PUBLIC = Path(__file__).resolve().parent.parent / "public"
SRC = PUBLIC / "shepherd-logo.png"

# Theme matches manifest / index.html
BG_PWA = (11, 22, 35)  # #0b1623
BG_IOS = (0, 0, 0)


def is_yellow_pixel(r: int, g: int, b: int, a: int) -> bool:
    return a > 200 and r > 175 and g > 155 and b < 145 and (r + g) > 380


def tight_crop_logo(img: Image.Image) -> Image.Image:
    """Remove outer black margin (outside yellow rounded frame)."""
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()
    minx = miny = 10**9
    maxx = maxy = -1
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if is_yellow_pixel(r, g, b, a):
                minx = min(minx, x)
                miny = min(miny, y)
                maxx = max(maxx, x)
                maxy = max(maxy, y)
    if maxx < minx:
        return img
    # PIL crop box is (left, upper, right, lower) with exclusive right/lower.
    # Do not pad outward — that would pull outer corner padding back in.
    return img.crop((minx, miny, maxx + 1, maxy + 1))


def yellow_to_black(img: Image.Image) -> Image.Image:
    """Flatten decorative yellow frame into black (for iOS home screen)."""
    img = img.convert("RGBA").copy()
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if is_yellow_pixel(r, g, b, a):
                px[x, y] = (0, 0, 0, a)
    return img


def bbox_non_black(img: Image.Image, threshold: int = 18) -> tuple[int, int, int, int]:
    px = img.load()
    w, h = img.size
    minx = miny = 10**9
    maxx = maxy = -1
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 40:
                continue
            if r > threshold or g > threshold or b > threshold:
                minx = min(minx, x)
                miny = min(miny, y)
                maxx = max(maxx, x)
                maxy = max(maxy, y)
    if maxx < minx:
        return 0, 0, w, h
    return minx, miny, maxx + 1, maxy + 1


def render_contain(
    img: Image.Image,
    side: int,
    bg: tuple[int, int, int],
    fill_ratio: float,
) -> Image.Image:
    """Scale uniformly so the logo fits within fill_ratio * side (centered)."""
    img = img.convert("RGBA")
    iw, ih = img.size
    target_max = int(side * fill_ratio)
    scale = min(target_max / iw, target_max / ih)
    nw, nh = max(1, int(round(iw * scale))), max(1, int(round(ih * scale)))
    resized = img.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (side, side), bg + (255,))
    ox = (side - nw) // 2
    oy = (side - nh) // 2
    canvas.paste(resized, (ox, oy), resized)
    return canvas


def main() -> int:
    if not SRC.exists():
        print(f"Missing {SRC}", file=sys.stderr)
        return 1

    base = Image.open(SRC)
    chip = tight_crop_logo(base)

    # —— PWA (keep yellow frame; fills canvas after outer margin crop) ——
    fill_standard = 0.97
    render_contain(chip, 192, BG_PWA, fill_standard).convert("RGB").save(PUBLIC / "icon-192.png", optimize=True)
    render_contain(chip, 512, BG_PWA, fill_standard).convert("RGB").save(PUBLIC / "icon-512.png", optimize=True)

    # Maskable: leave breathing room for adaptive icons
    render_contain(chip, 512, BG_PWA, 0.78).convert("RGB").save(PUBLIC / "icon-512-maskable.png", optimize=True)

    # —— Apple touch: black canvas, no yellow ring, tight on artwork ——
    ios_chip = yellow_to_black(chip)
    l, u, r, d = bbox_non_black(ios_chip)
    ios_tight = ios_chip.crop((l, u, r, d))
    render_contain(ios_tight, 180, BG_IOS, 0.92).convert("RGB").save(
        PUBLIC / "apple-touch-icon.png", optimize=True
    )

    # —— Favicons from colored chip (readable at tiny sizes) ——
    fav = render_contain(chip, 32, BG_PWA, 0.95).convert("RGB")
    fav.save(PUBLIC / "favicon-32.png", optimize=True)
    render_contain(chip, 16, BG_PWA, 0.95).convert("RGB").save(PUBLIC / "favicon-16.png", optimize=True)

    # Multi-size ICO (first image is primary)
    i16 = render_contain(chip, 16, BG_PWA, 0.95).convert("RGBA")
    i32 = render_contain(chip, 32, BG_PWA, 0.95).convert("RGBA")
    i48 = render_contain(chip, 48, BG_PWA, 0.95).convert("RGBA")
    i32.save(
        PUBLIC / "favicon.ico",
        format="ICO",
        sizes=[(x.width, x.height) for x in (i16, i32, i48)],
        append_images=[i16, i48],
    )

    print("Wrote icons to", PUBLIC)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
