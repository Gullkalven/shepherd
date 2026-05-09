#!/usr/bin/env python3
"""
Build UI + PWA assets from public/shepherd-logo-source.png

Outputs:
  shepherd-logo-mark.png    — RGBA in-app logo (transparent outside yellow frame)
  icon-192/512, maskable    — solid black square PWA icons (chip + yellow border, large)
  apple-touch-icon.png      — 180×180, black canvas, yellow visible, iOS safe-area padding
  favicon*                  — same chip on black for tab readability

Run from app/frontend:
  python3 scripts/generate-pwa-icons.py
Requires: Pillow (pip install Pillow)
"""

from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

from PIL import Image

PUBLIC = Path(__file__).resolve().parent.parent / "public"
SRC = PUBLIC / "shepherd-logo-source.png"

# Home screen / tab icons: solid black so the yellow frame reads clearly (not #0b1623).
BG_ICON = (0, 0, 0)


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
    return img.crop((minx, miny, maxx + 1, maxy + 1))


def transparent_outer_black(chip: Image.Image) -> Image.Image:
    """
    Remove edge-connected dark background so the mark floats on any UI background.
    Yellow and light pixels block traversal so interior artwork stays intact.
    """
    img = chip.convert("RGBA").copy()
    w, h = img.size
    px = img.load()

    def blocks_barrier(r: int, g: int, b: int, a: int) -> bool:
        if a < 40:
            return False
        if is_yellow_pixel(r, g, b, a):
            return True
        # Dog / hardhat highlights — do not cross into artwork
        if r + g + b > 95:
            return True
        return False

    def can_erase(r: int, g: int, b: int, a: int) -> bool:
        if a < 40:
            return False
        if is_yellow_pixel(r, g, b, a):
            return False
        if r + g + b > 95:
            return False
        return True

    seen = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    def try_seed(x: int, y: int) -> None:
        if not (0 <= x < w and 0 <= y < h) or seen[y][x]:
            return
        r, g, b, a = px[x, y]
        if blocks_barrier(r, g, b, a):
            return
        if not can_erase(r, g, b, a):
            return
        seen[y][x] = True
        q.append((x, y))

    for x in range(w):
        try_seed(x, 0)
        try_seed(x, h - 1)
    for y in range(h):
        try_seed(0, y)
        try_seed(w - 1, y)

    while q:
        x, y = q.popleft()
        r, g, b, a = px[x, y]
        if can_erase(r, g, b, a):
            px[x, y] = (0, 0, 0, 0)
        for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < w and 0 <= ny < h) or seen[ny][nx]:
                continue
            nr, ng, nb, na = px[nx, ny]
            if blocks_barrier(nr, ng, nb, na):
                continue
            if not can_erase(nr, ng, nb, na):
                continue
            seen[ny][nx] = True
            q.append((nx, ny))

    return img


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
        print(f"Missing source asset {SRC}", file=sys.stderr)
        return 1

    base = Image.open(SRC)
    chip = tight_crop_logo(base)

    # —— In-app mark (transparent outside chip; no outer black rectangle) ——
    mark = transparent_outer_black(chip)
    mark.save(PUBLIC / "shepherd-logo-mark.png", optimize=True)

    # —— Square app icons: tight-cropped chip (no outer gutter), full yellow border, solid black ——
    # Larger fill for 192/512 so the mark reads on home screen / launcher.
    fill_launcher = 0.94
    render_contain(chip, 192, BG_ICON, fill_launcher).convert("RGB").save(PUBLIC / "icon-192.png", optimize=True)
    render_contain(chip, 512, BG_ICON, fill_launcher).convert("RGB").save(PUBLIC / "icon-512.png", optimize=True)
    # Maskable: keep artwork inside ~80% circle/squircle for adaptive icons.
    render_contain(chip, 512, BG_ICON, 0.76).convert("RGB").save(PUBLIC / "icon-512-maskable.png", optimize=True)

    # Apple touch: extra inset so yellow stays inside iOS rounded mask (no double-frame artefact).
    render_contain(chip, 180, BG_ICON, 0.82).convert("RGB").save(PUBLIC / "apple-touch-icon.png", optimize=True)

    render_contain(chip, 32, BG_ICON, 0.94).convert("RGB").save(PUBLIC / "favicon-32.png", optimize=True)
    render_contain(chip, 16, BG_ICON, 0.94).convert("RGB").save(PUBLIC / "favicon-16.png", optimize=True)

    i16 = render_contain(chip, 16, BG_ICON, 0.94).convert("RGBA")
    i32 = render_contain(chip, 32, BG_ICON, 0.94).convert("RGBA")
    i48 = render_contain(chip, 48, BG_ICON, 0.94).convert("RGBA")
    i32.save(
        PUBLIC / "favicon.ico",
        format="ICO",
        sizes=[(x.width, x.height) for x in (i16, i32, i48)],
        append_images=[i16, i48],
    )

    print("Wrote shepherd-logo-mark.png + PWA/favicon assets to", PUBLIC)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
