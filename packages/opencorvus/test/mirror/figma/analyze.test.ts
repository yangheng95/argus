import { describe, expect, test } from "bun:test"
import { analyzeFigma } from "../../../src/mirror/figma/analyze"
import { ProjectScaffoldSchema } from "../../../src/mirror/ir/scaffold"
import type { CompressedDesign } from "../../../src/mirror/ir/compressed-design"
import { AnalyzeError } from "../../../src/mirror/errors"
import {
  generateTokensFile,
  generateAppViewFile,
  buildSharedContext,
} from "../../../src/mirror/shared/scaffold-helpers"

const FIXTURE: CompressedDesign = {
  fileName: "Figma Demo File",
  lastModified: "2026-04-26T00:00:00Z",
  figmaUrl: "https://figma.com/design/abc/Demo",
  pages: [
    {
      name: "Home",
      frames: [
        {
          id: "1:1",
          name: "Hero",
          type: "FRAME",
          bounds: { x: 0, y: 0, w: 1440, h: 480 },
          layout: { mode: "VERTICAL", padding: [48, 32, 48, 32], gap: 24 },
          style: { borderRadius: 12, shadow: "0 4px 12px rgba(0,0,0,.05)" },
          children: [
            {
              id: "1:2",
              name: "Headline",
              type: "TEXT",
              bounds: { x: 32, y: 48, w: 800, h: 40 },
              text: { content: "Welcome", size: 32, weight: 700, color: "#1f2937", font: "Inter" },
            },
            {
              id: "1:3",
              name: "CTA",
              type: "INSTANCE",
              componentName: "Button",
              bounds: { x: 32, y: 120, w: 200, h: 44 },
              style: { borderRadius: 8 },
            },
          ],
        },
        {
          id: "1:4",
          name: "Cards",
          type: "FRAME",
          bounds: { x: 0, y: 480, w: 1440, h: 420 },
          layout: { mode: "GRID", padding: [24, 24, 24, 24], gap: 16 },
          children: [
            {
              id: "1:5",
              name: "Card",
              type: "FRAME",
              bounds: { x: 0, y: 0, w: 450, h: 400 },
              style: { borderRadius: 12, shadow: "0 4px 12px rgba(0,0,0,.05)" },
            },
          ],
        },
      ],
    },
  ],
  components: { "1:3": { name: "Button", description: "Primary button", key: "btn" } },
  componentSets: {},
  tokens: {
    colors: { primary: "#1890ff", background: "#ffffff", text: "#1f2937", muted: "#9ca3af" },
    gradients: [],
    fonts: ["Inter"],
    textStyles: [
      { name: "h1", font: "Inter", size: 32, weight: 700, color: "#1f2937", lineHeight: 40 },
      { name: "body", font: "Inter", size: 14, weight: 400, color: "#4b5563" },
    ],
    effects: [],
  },
  images: {},
  comments: [],
  stats: { totalNodes: 6, compressedNodes: 6, imageCount: 0, compressionRatio: "1:1" },
}

describe("analyzeFigma", () => {
  test("returns ProjectScaffold-shaped output that round-trips Zod", () => {
    const scaffold = analyzeFigma(FIXTURE)
    expect(() => ProjectScaffoldSchema.parse(scaffold)).not.toThrow()
  })

  test("synthesises semantic surfaces from page frames with PascalCased export names", () => {
    const scaffold = analyzeFigma(FIXTURE)
    expect(scaffold.surfaces).toHaveLength(2)
    const heroSec = scaffold.surfaces.find((s) => s.view.exportName === "HomeHero")
    expect(heroSec).toBeDefined()
    expect(heroSec!.bounds.h).toBe(480)
    const cardsSec = scaffold.surfaces.find((s) => s.view.exportName === "HomeCards")
    expect(cardsSec).toBeDefined()
  })

  test("maps figma tokens to DesignTokenSystem with semantic inference", () => {
    const scaffold = analyzeFigma(FIXTURE)
    expect(scaffold.tokens.colors).toHaveLength(4)
    const bg = scaffold.tokens.colors.find((c) => c.value === "#ffffff")
    expect(bg?.semantic).toBe("background")
    const text = scaffold.tokens.colors.find((c) => c.value === "#1f2937")
    expect(text?.semantic).toBe("text")
  })

  test("aggregates spacing + radii from frame layout / style", () => {
    const scaffold = analyzeFigma(FIXTURE)
    const spacingValues = scaffold.tokens.spacing.map((s) => s.px).sort((a, b) => a - b)
    expect(spacingValues).toContain(48)
    expect(spacingValues).toContain(32)
    expect(spacingValues).toContain(24)
    expect(spacingValues).toContain(16)
    const radiiValues = scaffold.tokens.radii.map((r) => r.px).sort((a, b) => a - b)
    expect(radiiValues).toContain(8)
    expect(radiiValues).toContain(12)
  })

  test("aggregates font weights/sizes from textStyles per family", () => {
    const scaffold = analyzeFigma(FIXTURE)
    const inter = scaffold.tokens.fonts.find((f) => f.family === "Inter")
    expect(inter).toBeDefined()
    expect(inter!.weights).toContain(400)
    expect(inter!.weights).toContain(700)
    expect(inter!.sizes).toContain(14)
    expect(inter!.sizes).toContain(32)
  })

  test("emits empty pattern catalog with correct totalElements", () => {
    const scaffold = analyzeFigma(FIXTURE)
    expect(scaffold.catalog.patterns).toEqual([])
    // 5 nodes total: Hero, Headline, CTA, Cards, Card.
    expect(scaffold.catalog.totalElements).toBe(5)
    expect(scaffold.catalog.coveredElements).toBe(0)
  })

  test("synthesised scaffold drives shared scaffold-helpers cleanly", () => {
    const scaffold = analyzeFigma(FIXTURE)
    const tokensFile = generateTokensFile(scaffold)
    expect(tokensFile.code).toContain("export const COLORS")
    expect(tokensFile.code).toContain("background:")
    expect(tokensFile.code).toContain("\"#ffffff\"")
    expect(tokensFile.code).toContain("export const FONTS")

    const appFile = generateAppViewFile(scaffold)
    expect(appFile.code).toContain("import { HomeHeroView }")
    expect(appFile.code).toContain("<HomeHeroView />")
    expect(appFile.code).toContain("import { HomeCardsView }")

    const ctx = buildSharedContext(scaffold, {
      url: FIXTURE.figmaUrl,
      title: FIXTURE.fileName,
      viewport: { width: 1440, height: 480 },
    })
    expect(ctx).toContain("Page: Figma Demo File")
    expect(ctx).toContain("URL: https://figma.com/design/abc/Demo")
  })

  test("rejects malformed input via the Zod boundary", () => {
    expect(() =>
      analyzeFigma({ pages: [], tokens: {} } as unknown as CompressedDesign),
    ).toThrow(AnalyzeError)
  })
})
