#!/usr/bin/env python3
"""
Generate OpenCorvus lander posters with local assets.

Outputs:
  - packages/console/app/src/asset/lander/opencorvus-poster.png
  - packages/console/app/src/asset/lander/opencorvus-comparison-poster.png
"""

from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
LANDER = ROOT / "packages" / "console" / "app" / "src" / "asset" / "lander"
WEB_LANDER = ROOT / "packages" / "web" / "src" / "assets" / "lander"
BRAND = ROOT / "packages" / "console" / "app" / "src" / "asset" / "brand"

OUT_POSTER = LANDER / "opencorvus-poster.png"
OUT_COMPARE = LANDER / "opencorvus-comparison-poster.png"

SIZE = (2244, 1128)
DARK_TOP = (13, 11, 11)
DARK_BOTTOM = (28, 22, 22)
ACCENT = (232, 168, 56, 255)


def gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    w, h = size
    img = Image.new("RGB", size)
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        for x in range(w):
            px[x, y] = (r, g, b)
    return img


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle((0, 0, size[0], size[1]), radius=radius, fill=255)
    return m


def cover(src: Image.Image, size: tuple[int, int]) -> Image.Image:
    sw, sh = src.size
    tw, th = size
    s = max(tw / sw, th / sh)
    nw = int(sw * s)
    nh = int(sh * s)
    x = (nw - tw) // 2
    y = (nh - th) // 2
    return src.resize((nw, nh), Image.Resampling.LANCZOS).crop((x, y, x + tw, y + th))


def contain(src: Image.Image, size: tuple[int, int]) -> Image.Image:
    sw, sh = src.size
    tw, th = size
    s = min(tw / sw, th / sh)
    nw = int(sw * s)
    nh = int(sh * s)
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    resized = src.resize((nw, nh), Image.Resampling.LANCZOS).convert("RGBA")
    out.alpha_composite(resized, ((tw - nw) // 2, (th - nh) // 2))
    return out


def add_card(
    base: Image.Image,
    src: Image.Image,
    xy: tuple[int, int],
    size: tuple[int, int],
    radius: int,
    border: tuple[int, int, int, int],
) -> None:
    x, y = xy
    w, h = size
    card = contain(src, size)
    mask = rounded_mask((w, h), radius)
    shadow = Image.new("RGBA", (w + 30, h + 30), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((15, 15, w + 15, h + 15), radius=radius + 4, fill=(0, 0, 0, 140))
    shadow = shadow.filter(ImageFilter.GaussianBlur(10))
    base.alpha_composite(shadow, (x - 15, y - 12))

    framed = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    framed.paste(card, (0, 0), mask)
    base.alpha_composite(framed, (x, y))

    bd = ImageDraw.Draw(base)
    bd.rounded_rectangle((x, y, x + w, y + h), radius=radius, outline=border, width=3)


def make_poster() -> None:
    bg = gradient(SIZE, DARK_TOP, DARK_BOTTOM).convert("RGBA")
    draw = ImageDraw.Draw(bg)

    splash = Image.open(WEB_LANDER / "screenshot-splash.png").convert("RGB")
    splash_bg = cover(splash, SIZE).filter(ImageFilter.GaussianBlur(24)).convert("RGBA")
    splash_bg.putalpha(72)
    bg.alpha_composite(splash_bg, (0, 0))

    screenshot = Image.open(WEB_LANDER / "screenshot.png").convert("RGB")
    add_card(bg, screenshot, (372, 186), (1500, 760), 24, (232, 168, 56, 220))

    logo = Image.open(BRAND / "opencorvus-logo-light-square.png").convert("RGBA")
    logo = logo.resize((100, 100), Image.Resampling.LANCZOS)
    wordmark = Image.open(BRAND / "opencorvus-wordmark-light.png").convert("RGBA")
    wordmark = contain(wordmark, (520, 92))
    bg.alpha_composite(logo, (96, 74))
    bg.alpha_composite(wordmark, (214, 78))

    draw.rounded_rectangle((96, 988, 2130, 1000), radius=6, fill=ACCENT)
    draw.rounded_rectangle((96, 1024, 980, 1032), radius=4, fill=(241, 236, 236, 170))

    bg.convert("RGB").save(OUT_POSTER, "PNG", optimize=True)


def make_comparison() -> None:
    bg = gradient(SIZE, (13, 11, 11), (22, 18, 18)).convert("RGBA")
    draw = ImageDraw.Draw(bg)

    splash = Image.open(WEB_LANDER / "screenshot.png").convert("RGB")
    splash_bg = cover(splash, SIZE).filter(ImageFilter.GaussianBlur(30)).convert("RGBA")
    splash_bg.putalpha(66)
    bg.alpha_composite(splash_bg, (0, 0))

    left = Image.open(WEB_LANDER / "screenshot-github.png").convert("RGB")
    right = Image.open(WEB_LANDER / "screenshot-vscode.png").convert("RGB")
    add_card(bg, left, (110, 210), (980, 690), 22, (241, 236, 236, 150))
    add_card(bg, right, (1154, 210), (980, 690), 22, (232, 168, 56, 220))

    draw.rounded_rectangle((1121, 190, 1126, 928), radius=2, fill=(232, 168, 56, 210))

    wordmark = Image.open(BRAND / "opencorvus-wordmark-light.png").convert("RGBA")
    wordmark = contain(wordmark, (620, 100))
    bg.alpha_composite(wordmark, (812, 68))

    draw.rounded_rectangle((110, 966, 2134, 978), radius=6, fill=ACCENT)
    draw.rounded_rectangle((110, 1002, 1600, 1010), radius=4, fill=(241, 236, 236, 170))

    bg.convert("RGB").save(OUT_COMPARE, "PNG", optimize=True)


def main() -> None:
    make_poster()
    make_comparison()
    print(f"wrote {OUT_POSTER}")
    print(f"wrote {OUT_COMPARE}")


if __name__ == "__main__":
    main()
