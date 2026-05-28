import { describe, test, expect } from "bun:test"

import {
  analyzePage,
  scaffoldToPlan,
  generateTokensFile,
  generateAppViewFile,
  buildSharedContext,
} from "../../../src/mirror/url/pattern"
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

function realisticPage(): ExtractedPage {
  const navLinks = Array.from({ length: 3 }, (_, i) =>
    el("a", { href: `/nav${i}`, text: `Nav ${i}`, bounds: { x: 0, y: 0, w: 60, h: 20 } }),
  )
  const cards = Array.from({ length: 3 }, (_, i) =>
    el("article", {
      role: "card",
      styles: { display: "flex", flexDirection: "column", padding: "16px" },
      bounds: { x: i * 300, y: 500, w: 280, h: 200 },
      children: [
        el("h3", {
          text: `Title ${i}`,
          styles: { fontSize: "18px", fontWeight: "700", color: "rgb(17, 17, 17)" },
          bounds: { x: 0, y: 0, w: 260, h: 24 },
        }),
        el("p", {
          text: `Description ${i} here`,
          styles: { color: "rgb(100, 100, 100)", fontSize: "14px" },
          bounds: { x: 0, y: 24, w: 260, h: 40 },
        }),
      ],
    }),
  )

  return page(
    [
      el("header", {
        role: "header",
        styles: { display: "flex", padding: "16px" },
        bounds: { x: 0, y: 0, w: 1440, h: 64 },
        children: [el("nav", { children: navLinks, bounds: { x: 0, y: 0, w: 400, h: 40 } })],
      }),
      el("section", {
        role: "hero",
        styles: { padding: "48px 24px", backgroundColor: "rgb(51, 102, 255)" },
        bounds: { x: 0, y: 64, w: 1440, h: 400 },
        children: [
          el("h1", {
            text: "Welcome",
            styles: { fontSize: "32px", fontWeight: "700", color: "rgb(255, 255, 255)" },
            bounds: { x: 0, y: 0, w: 400, h: 40 },
          }),
        ],
      }),
      el("section", {
        role: "grid",
        styles: { display: "grid", padding: "24px", gap: "16px" },
        bounds: { x: 0, y: 464, w: 1440, h: 400 },
        children: cards,
      }),
      el("footer", {
        role: "footer",
        bounds: { x: 0, y: 864, w: 1440, h: 120 },
        children: [el("small", { text: "© 2026", bounds: { x: 0, y: 0, w: 200, h: 20 } })],
      }),
    ],
    {
      tokens: {
        colors: {},
        fonts: [],
        customProperties: { "--brand-primary": "#3366ff", "--shiki-token-comment": "grey" }, // one noise prefix
      },
    },
  )
}

// ─── Deterministic analysis ───────────────────────────────────────────────

describe("analyzePage — deterministic source layout", () => {
  const cases: Array<{ name: string; build: () => ExtractedPage }> = [
    { name: "empty tree", build: () => page([]) },
    {
      name: "wrapper div collapsed by optimizeTree",
      build: () =>
        page([
          el("div", {
            children: [
              el("div", {
                children: [
                  el("header", { role: "header", bounds: { x: 0, y: 0, w: 1440, h: 64 } }),
                  el("main", { role: "main", bounds: { x: 0, y: 64, w: 1440, h: 800 } }),
                  el("footer", { role: "footer", bounds: { x: 0, y: 864, w: 1440, h: 120 } }),
                ],
              }),
            ],
          }),
        ]),
    },
    { name: "realistic landing page", build: () => realisticPage() },
  ]

  for (const c of cases) {
    test(c.name, () => {
      const p = c.build()
      expect(analyzePage(p)).toEqual(analyzePage(p))
    })
  }
})

// ─── Schema validation ────────────────────────────────────────────────────

describe("analyzePage — schema", () => {
  test("output passes ProjectScaffoldSchema", () => {
    const p = realisticPage()
    const scaffold = analyzePage(p)
    expect(() => ProjectScaffoldSchema.parse(scaffold)).not.toThrow()
  })
})

// ─── Scaffold helper contracts ────────────────────────────────────────────

describe("scaffold helpers", () => {
  test("scaffoldToPlan uses generated source paths", () => {
    const p = realisticPage()
    const scaffold = analyzePage(p)
    const plan = scaffoldToPlan(scaffold)
    expect(plan.every((file) => file.file_path.startsWith("src/"))).toBe(true)
  })

  test("generateTokensFile emits the source-layout token file", () => {
    const p = realisticPage()
    const scaffold = analyzePage(p)
    const ours = generateTokensFile(scaffold)
    expect(ours.file_path).toBe("src/design-tokens.ts")
    expect(ours.code).toContain("export const COLORS")
  })

  test("generateAppViewFile imports generated surface view files", () => {
    const p = realisticPage()
    const scaffold = analyzePage(p)
    const ours = generateAppViewFile(scaffold)
    expect(ours.file_path).toBe("src/App.tsx")
    expect(ours.code).toContain(".view")
  })

  test("buildSharedContext includes page metadata", () => {
    const p = realisticPage()
    const scaffold = analyzePage(p)
    const meta = { url: p.url, title: p.title, viewport: p.viewport }
    const ours = buildSharedContext(scaffold, meta)
    expect(ours).toContain("Page: Test")
    expect(ours).toContain("URL: https://example.test/")
  })
})
