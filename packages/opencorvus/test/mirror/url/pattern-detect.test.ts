import { describe, test, expect } from "bun:test"

import { detectPatterns } from "../../../src/mirror/url/pattern/detect"
import { ComponentCatalogSchema } from "../../../src/mirror/ir/scaffold"
import type { ExtractedPage, ExtractedElement } from "../../../src/mirror/ir/extracted-page"

// Golden parity — mirror original
import { detectPatterns as mirrorDetect } from "D:/myhexin-local/opencode-private/packages/mirror/src/infra/pattern/detect.ts"

function el(tag: string, extras: Partial<ExtractedElement> = {}): ExtractedElement {
  return {
    selector: tag,
    tag,
    bounds: { x: 0, y: 0, w: 100, h: 100 },
    styles: {},
    ...extras,
  } as ExtractedElement
}

function page(tree: ExtractedElement[]): ExtractedPage {
  return {
    url: "https://example.test/",
    title: "Test",
    viewport: { width: 1440, height: 900 },
    screenshotUrl: "",
    tree,
    tokens: { colors: {}, fonts: [], customProperties: {} },
    assets: { images: [], icons: [] },
    stats: { totalElements: tree.length, extractedElements: tree.length, imageCount: 0, extractionTimeMs: 0 },
  }
}

function card(title: string, desc: string, img?: string, href?: string): ExtractedElement {
  const children: ExtractedElement[] = [
    el("h3", { text: title }),
    el("p", { text: desc }),
  ]
  if (img) children.unshift(el("img", { imageSrc: img }))
  if (href) children.push(el("a", { href, text: "Read more" }))
  return el("article", {
    role: "card",
    styles: { display: "flex", flexDirection: "column" },
    children,
  })
}

const cases: Array<{ name: string; build: () => ExtractedPage }> = [
  { name: "empty tree", build: () => page([]) },
  {
    name: "single element (no repetition)",
    build: () => page([el("div", { children: [el("p", { text: "alone" })] })]),
  },
  {
    name: "three identical cards (Card pattern)",
    build: () =>
      page([
        el("section", {
          styles: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr" },
          children: [
            card("A", "Desc A"),
            card("B", "Desc B"),
            card("C", "Desc C"),
          ],
        }),
      ]),
  },
  {
    name: "cards with image prop inferred",
    build: () =>
      page([
        el("section", {
          styles: { display: "grid" },
          children: [
            card("A", "x", "https://cdn/a.png"),
            card("B", "y", "https://cdn/b.png"),
            card("C", "z", "https://cdn/c.png"),
          ],
        }),
      ]),
  },
  {
    name: "nav links (NavLink pattern via href+short-text)",
    build: () =>
      page([
        el("nav", {
          styles: { display: "flex", flexDirection: "row" },
          children: [
            el("a", { href: "/home", text: "Home" }),
            el("a", { href: "/about", text: "About" }),
            el("a", { href: "/contact", text: "Contact" }),
          ],
        }),
      ]),
  },
  {
    name: "mixed: 3 cards + 3 nav links (two distinct patterns)",
    build: () =>
      page([
        el("nav", {
          styles: { display: "flex" },
          children: [
            el("a", { href: "/a", text: "A" }),
            el("a", { href: "/b", text: "B" }),
            el("a", { href: "/c", text: "C" }),
          ],
        }),
        el("section", {
          styles: { display: "grid" },
          children: [card("Card1", "D1"), card("Card2", "D2"), card("Card3", "D3")],
        }),
      ]),
  },
]

// ─── GOLDEN PARITY ────────────────────────────────────────────────────────

describe("detectPatterns — GOLDEN PARITY byte-level", () => {
  for (const c of cases) {
    test(c.name, () => {
      const p = c.build()
      const ours = detectPatterns(p)
      const theirs = mirrorDetect(p)
      expect(ours).toEqual(theirs)
    })
  }
})

describe("detectPatterns — schema validation", () => {
  test("output passes ComponentCatalogSchema", () => {
    const result = detectPatterns(cases[2].build())
    expect(() => ComponentCatalogSchema.parse(result)).not.toThrow()
  })

  test("output has expected fields", () => {
    const result = detectPatterns(cases[2].build())
    expect(result.patterns).toBeInstanceOf(Array)
    expect(typeof result.totalElements).toBe("number")
    expect(typeof result.coveredElements).toBe("number")
  })
})
