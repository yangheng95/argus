import { describe, test, expect } from "bun:test"

import { detectPatterns } from "../../../src/mirror/url/pattern/detect"
import { ComponentCatalogSchema } from "../../../src/mirror/ir/scaffold"
import type { ExtractedPage, ExtractedElement } from "../../../src/mirror/ir/extracted-page"

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
    name: "single element",
    build: () => page([el("div", { children: [el("p", { text: "alone" })] })]),
  },
  {
    name: "three cards",
    build: () =>
      page([
        el("section", {
          styles: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr" },
          children: [card("A", "Desc A"), card("B", "Desc B"), card("C", "Desc C")],
        }),
      ]),
  },
  {
    name: "cards with image prop",
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
    name: "nav links",
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
]

describe("detectPatterns", () => {
  for (const c of cases) {
    test(`${c.name} produces schema-valid deterministic output`, () => {
      const result = detectPatterns(c.build())
      expect(() => ComponentCatalogSchema.parse(result)).not.toThrow()
      expect(result).toEqual(detectPatterns(c.build()))
    })
  }

  test("infers props for repeated cards", () => {
    const result = detectPatterns(cases[3].build())
    const propNames = result.patterns.flatMap((pattern) => pattern.props.map((prop) => prop.name))
    expect(result.patterns.some((pattern) => pattern.instanceCount >= 3)).toBe(true)
    expect(propNames).toContain("imageSrc")
  })

  test("output has expected fields", () => {
    const result = detectPatterns(cases[2].build())
    expect(result.patterns).toBeInstanceOf(Array)
    expect(typeof result.totalElements).toBe("number")
    expect(typeof result.coveredElements).toBe("number")
  })
})
