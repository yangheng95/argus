import { describe, test, expect } from "bun:test"

import {
  analyzePage,
  scaffoldToPlan,
  generateTokensFile,
  generateAppFile,
  buildSharedContext,
} from "../../../src/mirror/url/pattern"
import { ProjectScaffoldSchema } from "../../../src/mirror/ir/scaffold"
import type { ExtractedPage, ExtractedElement } from "../../../src/mirror/ir/extracted-page"

// Golden parity — mirror originals
import { analyzePage as mirrorAnalyze } from "D:/myhexin-local/opencode-private/packages/mirror/src/infra/pattern/index.ts"
import {
  scaffoldToPlan as mirrorScaffoldToPlan,
  generateTokensFile as mirrorTokensFile,
  generateAppFile as mirrorAppFile,
  buildSharedContext as mirrorSharedContext,
} from "D:/myhexin-local/opencode-private/packages/mirror/src/infra/pattern/scaffold-to-plan.ts"

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

// ─── GOLDEN PARITY on analyzePage ─────────────────────────────────────────

describe("analyzePage — GOLDEN PARITY byte-level", () => {
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
      const ours = analyzePage(p)
      const theirs = mirrorAnalyze(p)
      expect(ours).toEqual(theirs)
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

// ─── GOLDEN PARITY on scaffoldToPlan / generateTokensFile / generateAppFile / buildSharedContext ───

describe("scaffold helpers — GOLDEN PARITY", () => {
  test("scaffoldToPlan matches mirror", () => {
    const p = realisticPage()
    const scaffold = analyzePage(p)
    expect(scaffoldToPlan(scaffold)).toEqual(mirrorScaffoldToPlan(mirrorAnalyze(p)))
  })

  test("generateTokensFile matches mirror (byte-level .code)", () => {
    const p = realisticPage()
    const scaffold = analyzePage(p)
    const ours = generateTokensFile(scaffold)
    const theirs = mirrorTokensFile(mirrorAnalyze(p))
    expect(ours.file_path).toBe(theirs.file_path)
    expect(ours.code).toBe(theirs.code)
  })

  test("generateAppFile matches mirror (byte-level .code)", () => {
    const p = realisticPage()
    const scaffold = analyzePage(p)
    const ours = generateAppFile(scaffold)
    const theirs = mirrorAppFile(mirrorAnalyze(p))
    expect(ours.file_path).toBe(theirs.file_path)
    expect(ours.code).toBe(theirs.code)
  })

  test("buildSharedContext matches mirror (byte-level)", () => {
    const p = realisticPage()
    const scaffold = analyzePage(p)
    const meta = { url: p.url, title: p.title, viewport: p.viewport }
    const ours = buildSharedContext(scaffold, meta)
    const theirs = mirrorSharedContext(mirrorAnalyze(p), meta)
    expect(ours).toBe(theirs)
  })
})
