#!/usr/bin/env python3
"""
HTML-to-Markdown extractor — distills a large HTML/JSX layout into a compact,
design-ready structured outline.

Goal: drop ~90% of the volume (absolute coordinates, empty wrapper divs,
repeated atomic classes, inline CSS) while preserving everything a designer/LLM
needs:
  - real copy / data (text nodes, in document order, grouped by section)
  - asset URLs (deduped, classified by usage)
  - color palette (deduped, ranked by frequency)
  - typography specs (deduped font-size/line-height/letter-spacing combos)
  - skeleton geometry (page width, section sizes, column ratios)
  - semantic structure tree (header/nav/card/row/chip... with relative layout)

Usage:
    python3 extract-html2md.py <input.html> -o <output.md>
    python3 extract-html2md.py <input.html>            # to stdout

Supported input shapes
-----------------------
Two extraction paths run, so both common shapes are covered:

1. Atomic / arbitrary utility-class dumps — every visual property lives in the
   class string, e.g. Tailwind `text-[rgb(...)]`, `text-[16px]`,
   `leading-[..px]`, `tracking-[..px]`, `w-[..px]`, `h-[..px]`,
   `rounded-[..px]`, `bg-[url(..)]`. (Typical Kamis/Figma-style export.) The
   primary pass keys off these class patterns.

2. Hand-written / semantic HTML — colors & font-sizes in a <style> block (or
   inline styles) and assets in <img src> / CSS url(..), styled via named
   classes like `.card`. A secondary pass (`harvest_css_and_markup`) recovers
   palette / typography / assets from CSS text and markup. It triggers whenever
   the primary pass leaves any of those tables empty, so a relative-layout page
   that opens fine in a browser still yields a populated palette/typography/
   assets report.

In both cases <style>/<script> contents are dropped (not leaked as page text),
and the semantic skeleton (with inlined copy) is always produced.

Pure stdlib, no dependencies.
"""

import argparse
import os
import re
import sys
from collections import Counter, OrderedDict
from html.parser import HTMLParser


# ---------------------------------------------------------------------------
# 1. Parsing: the dump uses JSX `className` and is a forest of <div>s. We
#    normalize className->class and wrap in a root so HTMLParser can build a
#    tree. We keep only structurally meaningful attributes.
# ---------------------------------------------------------------------------

URL_RE = re.compile(r"url\((https?://[^)]+)\)")
FONT_SIZE = re.compile(r"text-\[(\d+(?:\.\d+)?)px\]")
LINE_H = re.compile(r"leading-\[(\d+(?:\.\d+)?)px\]")
TRACK = re.compile(r"tracking-\[(-?\d+(?:\.\d+)?)px\]")
W_RE = re.compile(r"\bw-\[(-?\d+(?:\.\d+)?)px\]")
H_RE = re.compile(r"\bh-\[(-?\d+(?:\.\d+)?)px\]")
RADIUS_RE = re.compile(r"rounded-\[(\d+(?:\.\d+)?)px\]")
TEXT_COLOR = re.compile(r"text-\[(rgb\([^)]+\))\]")
BG_COLOR = re.compile(r"bg-\[(rgb\([^)]+\))\]")

# --- secondary signals for semantic/hashed HTML (styles in <style>/CSS,
#     assets in <img src> / url(..)) rather than atomic utility classes ---
STYLE_BLOCK_RE = re.compile(r"<style\b[^>]*>(.*?)</style>", re.S | re.I)
CSS_RGB_RE = re.compile(r"(rgba?\([^)]+\))")
CSS_HEX_RE = re.compile(r"#[0-9a-fA-F]{3,8}\b")
CSS_FONT_SIZE_RE = re.compile(r"font-size\s*:\s*(\d+(?:\.\d+)?)px")
IMG_SRC_RE = re.compile(r"<img\b[^>]*?\bsrc=[\"'](https?://[^\"']+)[\"']", re.I)
CSS_URL_RE = re.compile(r"url\(\s*[\"']?(https?://[^\"')]+)[\"']?\s*\)")


class Node:
    __slots__ = ("tag", "cls", "children", "text", "w", "h", "radius",
                 "font_size", "line_h", "track", "text_color", "bg_color",
                 "asset")

    def __init__(self, tag, cls):
        self.tag = tag
        self.cls = cls
        self.children = []
        self.text = ""
        self.w = self.h = self.radius = None
        self.font_size = self.line_h = self.track = None
        self.text_color = self.bg_color = self.asset = None


# tags whose text content is code/markup, never page copy — skip their data
SKIP_TEXT_TAGS = {"style", "script", "noscript", "template"}


class TreeBuilder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("root", "")
        self.stack = [self.root]
        self._skip_depth = 0  # >0 while inside a SKIP_TEXT_TAGS subtree

    def handle_starttag(self, tag, attrs):
        if tag in SKIP_TEXT_TAGS:
            self._skip_depth += 1
        d = dict(attrs)
        cls = d.get("class", "") or d.get("classname", "")
        n = Node(tag, cls)
        # geometry / typography pulled off the class string
        if (m := W_RE.search(cls)):
            n.w = float(m.group(1))
        if (m := H_RE.search(cls)):
            n.h = float(m.group(1))
        if (m := RADIUS_RE.search(cls)):
            n.radius = float(m.group(1))
        if (m := FONT_SIZE.search(cls)):
            n.font_size = float(m.group(1))
        if (m := LINE_H.search(cls)):
            n.line_h = float(m.group(1))
        if (m := TRACK.search(cls)):
            n.track = float(m.group(1))
        if (m := TEXT_COLOR.search(cls)):
            n.text_color = m.group(1)
        if (m := BG_COLOR.search(cls)):
            n.bg_color = m.group(1)
        if (m := URL_RE.search(cls)):
            n.asset = m.group(1)
        self.stack[-1].children.append(n)
        self.stack.append(n)

    def handle_endtag(self, tag):
        if tag in SKIP_TEXT_TAGS and self._skip_depth > 0:
            self._skip_depth -= 1
        if len(self.stack) > 1:
            self.stack.pop()

    def handle_data(self, data):
        if self._skip_depth:  # inside <style>/<script>/... — drop CSS/JS text
            return
        t = data.strip()
        if t:
            self.stack[-1].text += (" " if self.stack[-1].text else "") + t


# ---------------------------------------------------------------------------
# 2. Collection pass: walk tree, gather deduped palette / assets / typography
#    and ordered text. These become the compact reference tables.
# ---------------------------------------------------------------------------

def harvest_css_and_markup(raw, colors, assets, fonts):
    """Secondary pass for semantic / hand-written HTML.

    The primary pass keys off atomic classes (e.g. `text-[rgb(..)]`). Semantic
    pages instead carry colors/fonts in <style> CSS (or inline styles) and
    assets in <img src> / url(..). When the page is shaped that way the primary
    tables come out empty, so we recover the same signals from CSS text and
    markup here. This fires whenever any primary table is empty, so it is a
    normal code path for relative-layout pages, not an alternate recovery path.
    Counts are by raw occurrence — coarse, but enough to rank a palette.
    """
    css = "\n".join(STYLE_BLOCK_RE.findall(raw))
    for m in CSS_RGB_RE.finditer(css):
        colors[m.group(1).replace(" ", "")] += 1
    for m in CSS_HEX_RE.finditer(css):
        colors[m.group(0).lower()] += 1
    for m in CSS_FONT_SIZE_RE.finditer(css):
        fonts[(float(m.group(1)), None, None)] += 1
    # assets: <img src> across whole doc, plus url(..) in CSS/markup
    for m in IMG_SRC_RE.finditer(raw):
        url = m.group(1)
        if url not in assets:
            assets[url] = 0
        assets[url] += 1
    for m in CSS_URL_RE.finditer(raw):
        url = m.group(1)
        if url not in assets:
            assets[url] = 0
        assets[url] += 1


def collect(node, colors, assets, fonts, texts):
    for c in node.text_color, node.bg_color:
        if c:
            colors[c] += 1
    if node.asset:
        assets[node.asset] = assets.get(node.asset, 0) + 1
    if node.font_size:
        key = (node.font_size, node.line_h, node.track)
        fonts[key] += 1
    if node.text:
        texts.append(node.text)
    for ch in node.children:
        collect(ch, colors, assets, fonts, texts)


# ---------------------------------------------------------------------------
# 3. Fold pass: collapse pure wrapper nodes (no text/asset/own geometry of
#    interest) into their children, building a thin semantic tree. Each kept
#    node reports a role + a coarse size, never absolute coordinates.
# ---------------------------------------------------------------------------

def is_meaningful(n):
    return bool(n.text or n.asset)


def has_kept_descendant(n):
    if is_meaningful(n):
        return True
    return any(has_kept_descendant(c) for c in n.children)


def role_of(n):
    """Heuristic semantic label from geometry. Cheap, best-effort, generic.

    pill  : large radius on a short element (chip/button/search)
    card  : medium+ radius container
    title : large font size
    """
    if n.radius and n.radius >= 999:
        return "pill"
    if n.radius and n.radius >= 24 and n.h and n.h <= 56:
        return "pill"
    if n.radius and n.radius >= 8:
        return "card"
    if n.font_size and n.font_size >= 24:
        return "title"
    if n.asset:
        return "asset"
    if n.text:
        return "text"
    return "group"


def size_hint(n):
    if n.w and n.h:
        return f"{int(n.w)}x{int(n.h)}"
    if n.w:
        return f"w{int(n.w)}"
    if n.h:
        return f"h{int(n.h)}"
    return ""


def fold(n, depth, out, registry, max_depth=6):
    """Emit a compact indented outline of meaningful nodes only.

    A node earns its own line only if it is a leaf with text/asset, or a
    structural container (card / large group with a size). Pure pass-through
    wrappers are transparent: their children render at the same depth.
    """
    if not has_kept_descendant(n):
        return

    role = role_of(n)
    leaf = is_meaningful(n)
    # is this a container worth showing as its own structural line?
    structural = role == "card" or (role in ("title",)) or \
        (n.w and n.h and n.w >= 300 and len(n.children) > 1)

    emit = leaf or structural
    if emit:
        parts = []
        if n.text:
            parts.append(f'"{n.text}"')
        if n.asset:
            parts.append(f"[{registry.short(n.asset)}]")
        meta = []
        if role == "card":
            meta.append("card")
        if structural and not leaf:
            sh = size_hint(n)
            if sh:
                meta.append(sh)
        line = ("  " * depth) + ("- " if leaf else "+ ") + \
            (" ".join(parts) if parts else "group")
        if meta:
            line += "  {" + ", ".join(meta) + "}"
        out.append(line)
        depth += 1

    if depth <= max_depth:
        for c in n.children:
            fold(c, depth, out, registry, max_depth)


class AssetRegistry:
    """Stable, per-run short ids for asset URLs (no global state)."""

    def __init__(self):
        self._ids = {}
        self._seq = 0

    def short(self, url):
        if url not in self._ids:
            self._seq += 1
            ext = url.rsplit(".", 1)[-1].split("?")[0]
            self._ids[url] = f"A{self._seq:03d}.{ext}"
        return self._ids[url]


def classify_asset(url):
    ext = url.rsplit(".", 1)[-1].split("?")[0].lower()
    if ext in ("png", "jpg", "jpeg", "gif", "webp"):
        return "raster image"
    if ext == "svg":
        return "vector icon/logo"
    return ext or "asset"


# ---------------------------------------------------------------------------
# 4. Output assembly
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("-o", "--output", default=None)
    ap.add_argument("--max-depth", type=int, default=7)
    args = ap.parse_args()

    if not os.path.isfile(args.input):
        sys.exit(f"error: input file not found: {args.input}")

    raw = open(args.input, encoding="utf-8").read()
    if not raw.strip():
        sys.exit(f"error: input file is empty: {args.input}")
    raw = raw.replace("className", "class")
    # wrap so the forest has a single root
    tb = TreeBuilder()
    tb.feed("<root>" + raw + "</root>")
    root = tb.root

    colors = Counter()
    assets = OrderedDict()
    fonts = Counter()
    texts = []
    collect(root, colors, assets, fonts, texts)

    # Secondary pass for semantic HTML: if the utility-class pass left any of
    # palette/typography/assets empty, those signals live in <style> CSS and
    # markup (<img src> / url(..)) — recover them there.
    if not colors or not fonts or not assets:
        harvest_css_and_markup(raw, colors, assets, fonts)

    # assign asset ids up front (document order) so skeleton refs and the
    # asset table agree regardless of which section is rendered first.
    registry = AssetRegistry()
    for url in assets:
        registry.short(url)

    outline = []
    fold(root, 0, outline, registry, args.max_depth)

    # ---- write ----
    L = []
    L.append(f"# {os.path.basename(args.input)} — Extracted design context")
    L.append("")
    L.append("> Auto-distilled from the source HTML. Absolute coordinates, "
             "inline CSS and empty wrappers dropped; copy, assets, palette, "
             "typography and semantic skeleton preserved.")
    L.append("")

    L.append("## Color palette (deduped, by frequency)")
    L.append("")
    for c, n in colors.most_common():
        L.append(f"- `{c}`  ×{n}")
    L.append("")

    L.append("## Typography specs (font-size / line-height / letter-spacing px)")
    L.append("")
    for (fs, lh, tr), n in sorted(fonts.items(), key=lambda x: -x[1]):
        L.append(f"- size {fs} / lh {lh} / track {tr}  ×{n}")
    L.append("")

    L.append("## Assets (deduped, classified)")
    L.append("")
    for url in assets:
        L.append(f"- {registry.short(url)} — {classify_asset(url)} — {url}")
    L.append("")

    L.append("## Semantic skeleton (folded, relative)")
    L.append("")
    L.append("> Roles + container sizes + grouping in document order. "
             "Leaf text is inlined here, so this doubles as the full copy "
             "source — no separate text dump needed.")
    L.append("")
    L.append("```")
    L.extend(outline)
    L.append("```")

    text = "\n".join(L) + "\n"
    if args.output:
        open(args.output, "w", encoding="utf-8").write(text)
        in_kb = len(raw.encode()) / 1024
        out_kb = len(text.encode()) / 1024
        sys.stderr.write(
            f"input {in_kb:.0f}KB -> output {out_kb:.0f}KB "
            f"({out_kb / in_kb * 100:.1f}%)  | "
            f"texts={len(texts)} assets={len(assets)} "
            f"colors={len(colors)} fonts={len(fonts)}\n")
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
