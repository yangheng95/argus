import { describe, test, expect } from "bun:test"

import { extractTokenSystem } from "../../../src/mirror/url/pattern/tokens"
import { DesignTokenSystemSchema } from "../../../src/mirror/ir/scaffold"
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

const cases: Array<{ name: string; build: () => ExtractedPage }> = [
  { name: "empty tree", build: () => page([]) },
  {
    name: "colors",
    build: () =>
      page([
        el("div", {
          styles: {
            color: "rgb(17, 17, 17)",
            backgroundColor: "rgb(255, 255, 255)",
            border: "1px solid rgb(229, 231, 235)",
          },
        }),
        el("p", { styles: { color: "rgb(100, 100, 100)" } }),
      ]),
  },
  {
    name: "spacing",
    build: () =>
      page([
        el("div", { styles: { gap: "8px", padding: "16px 8px", margin: "8px" } }),
        el("div", { styles: { gap: "8px", padding: "16px" } }),
      ]),
  },
  {
    name: "fonts",
    build: () =>
      page([
        el("h1", { styles: { fontFamily: "Inter, system-ui", fontWeight: "700", fontSize: "32px" } }),
        el("code", { styles: { fontFamily: "JetBrains Mono", fontSize: "14px" } }),
      ]),
  },
  {
    name: "full mini page",
    build: () =>
      page(
        [
          el("header", {
            styles: {
              display: "flex",
              padding: "16px 24px",
              backgroundColor: "rgb(255, 255, 255)",
              borderRadius: "0px",
            },
            children: [
              el("h1", {
                styles: { color: "rgb(17, 17, 17)", fontFamily: "Inter", fontWeight: "700", fontSize: "24px" },
              }),
              el("nav", { styles: { gap: "16px", display: "flex" } }),
            ],
          }),
          el("section", {
            styles: {
              padding: "48px 24px",
              backgroundColor: "rgb(51, 102, 255)",
              borderRadius: "8px",
              boxShadow: "0 4px 8px rgba(0, 0, 0, 0.15)",
            },
          }),
        ],
        {
          tokens: {
            colors: {},
            fonts: [],
            customProperties: { "--primary": "#3366ff", "--surface": "#ffffff" },
          },
        },
      ),
  },
]

describe("extractTokenSystem", () => {
  for (const c of cases) {
    test(`${c.name} produces schema-valid deterministic tokens`, () => {
      const result = extractTokenSystem(c.build())
      expect(() => DesignTokenSystemSchema.parse(result)).not.toThrow()
      expect(result).toEqual(extractTokenSystem(c.build()))
    })
  }

  test("includes common colors, fonts, spacing, and custom properties", () => {
    const result = extractTokenSystem(cases[cases.length - 1].build())
    expect(result.colors.length).toBeGreaterThan(0)
    expect(result.fonts.length).toBeGreaterThan(0)
    expect(result.spacing.length).toBeGreaterThan(0)
    expect(result.customProperties["--primary"]).toBe("#3366ff")
  })
})
