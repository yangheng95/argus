import { describe, test, expect } from "bun:test"

import { generateScaffold } from "../../../src/mirror/url/pattern/contract"
import { detectPatterns } from "../../../src/mirror/url/pattern/detect"
import { extractTokenSystem } from "../../../src/mirror/url/pattern/tokens"
import { ProjectScaffoldSchema } from "../../../src/mirror/ir/scaffold"
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

function page(tree: ExtractedElement[], extra: Partial<ExtractedPage> = {}): ExtractedPage {
  return {
    url: "https://example.test/",
    title: "Test",
    viewport: { width: 1440, height: 900 },
    screenshotUrl: "",
    tree,
    tokens: { colors: {}, fonts: [], customProperties: {} },
    assets: { images: [], icons: [] },
    stats: { totalElements: tree.length, extractedElements: tree.length, imageCount: 0, extractionTimeMs: 0 },
    ...extra,
  }
}

function buildLandingPage(): ExtractedPage {
  const navLinks = Array.from({ length: 3 }, (_, i) =>
    el("a", { href: `/nav${i}`, text: `Nav ${i}`, bounds: { x: 0, y: 0, w: 60, h: 20 } }),
  )
  const cards = Array.from({ length: 3 }, (_, i) =>
    el("article", {
      role: "card",
      styles: { display: "flex", flexDirection: "column" },
      bounds: { x: i * 200, y: 500, w: 200, h: 200 },
      children: [
        el("h3", { text: `Title ${i}`, bounds: { x: 0, y: 0, w: 200, h: 24 } }),
        el("p", { text: `Description ${i}`, bounds: { x: 0, y: 24, w: 200, h: 40 } }),
      ],
    }),
  )

  return page([
    el("header", {
      role: "header",
      styles: { display: "flex", padding: "16px" },
      bounds: { x: 0, y: 0, w: 1440, h: 64 },
      children: [el("nav", { children: navLinks, bounds: { x: 0, y: 0, w: 400, h: 40 } })],
    }),
    el("section", {
      role: "hero",
      styles: { padding: "48px 24px", backgroundColor: "rgb(51,102,255)" },
      bounds: { x: 0, y: 64, w: 1440, h: 400 },
      children: [el("h1", { text: "Welcome", bounds: { x: 0, y: 0, w: 400, h: 40 } })],
    }),
    el("section", {
      role: "grid",
      styles: { display: "grid", padding: "24px" },
      bounds: { x: 0, y: 464, w: 1440, h: 400 },
      children: cards,
    }),
    el("footer", {
      role: "footer",
      bounds: { x: 0, y: 864, w: 1440, h: 120 },
      children: [el("small", { text: "© 2026", bounds: { x: 0, y: 0, w: 200, h: 20 } })],
    }),
  ])
}

// ─── Deterministic scaffold generation ────────────────────────────────────

describe("generateScaffold — deterministic source layout", () => {
  const cases: Array<{ name: string; build: () => ExtractedPage }> = [
    { name: "empty page", build: () => page([]) },
    { name: "single wrapper unwrapping", build: () => page([el("div", { children: [el("header", { role: "header" }), el("main"), el("footer", { role: "footer" })] })]) },
    { name: "landing page (header/hero/cards/footer)", build: () => buildLandingPage() },
  ]

  for (const c of cases) {
    test(c.name, () => {
      const p = c.build()
      const catalog = detectPatterns(p)
      const tokens = extractTokenSystem(p)
      const ours = generateScaffold(p, catalog, tokens)

      expect(ours).toEqual(generateScaffold(p, catalog, tokens))
      expect(ours.appFile.filePath).toBe("src/App.tsx")
      expect(ours.tokensFile.filePath).toBe("src/design-tokens.ts")
    })
  }
})

// ─── Schema validation ────────────────────────────────────────────────────

describe("generateScaffold — schema validation", () => {
  test("landing page scaffold passes ProjectScaffoldSchema", () => {
    const p = buildLandingPage()
    const catalog = detectPatterns(p)
    const tokens = extractTokenSystem(p)
    const scaffold = generateScaffold(p, catalog, tokens)
    expect(() => ProjectScaffoldSchema.parse(scaffold)).not.toThrow()
  })

  test("scaffold has required structural fields", () => {
    const p = buildLandingPage()
    const catalog = detectPatterns(p)
    const tokens = extractTokenSystem(p)
    const s = generateScaffold(p, catalog, tokens)
    expect(s.version).toBe(2)
    expect(s.tokensFile.filePath).toContain("design-tokens")
    expect(s.appFile.filePath).toContain("App.tsx")
    expect(s.surfaces.length).toBeGreaterThan(0)
    expect(s.surfaces.every((surface) => !surface.id.startsWith("section-"))).toBe(true)
  })
})
