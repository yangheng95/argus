import { describe, expect, test } from "bun:test"
import { analyzeImage } from "../../../src/mirror/image/analyze"
import { ProjectScaffoldSchema } from "../../../src/mirror/ir/scaffold"
import type { ImageAnalysis } from "../../../src/mirror/ir/image-analysis"
import { AnalyzeError } from "../../../src/mirror/errors"
import {
  generateTokensFile,
  generateAppFile,
  buildSharedContext,
} from "../../../src/mirror/shared/scaffold-helpers"

const FIXTURE: ImageAnalysis = {
  description: "Two-section landing demo",
  viewport: { width: 1440, height: 900 },
  tokens: {
    colors: { primary: "#1890ff", background: "#ffffff", text: "#1f2937", muted: "#9ca3af" },
    fonts: ["Inter"],
    textStyles: [
      { name: "h1", font: "Inter", size: 32, weight: 700, color: "#1f2937", lineHeight: 40 },
      { name: "body", font: "Inter", size: 14, weight: 400, color: "#4b5563" },
    ],
  },
  tree: [
    {
      name: "hero",
      role: "hero",
      bounds: { x: 0, y: 0, w: 1440, h: 480 },
      layout: { direction: "vertical", gap: 24 },
      style: { padding: [48, 32, 48, 32], borderRadius: 12, shadow: "0 4px 12px rgba(0,0,0,.05)" },
      children: [
        { name: "headline", bounds: { x: 32, y: 48, w: 800, h: 40 }, text: { content: "Welcome", size: 32, weight: 700, color: "#1f2937" } },
        { name: "cta", role: "button", bounds: { x: 32, y: 120, w: 200, h: 44 }, style: { borderRadius: 8 } },
      ],
    },
    {
      name: "card-grid",
      role: "grid",
      bounds: { x: 0, y: 480, w: 1440, h: 420 },
      layout: { direction: "grid", gridCols: 3, gap: 16 },
      style: { padding: [24, 24, 24, 24] },
      repeatCount: 3,
      componentHint: "ui:Card",
      children: [
        { name: "card-1", role: "card", bounds: { x: 0, y: 0, w: 450, h: 400 }, style: { borderRadius: 12, shadow: "0 4px 12px rgba(0,0,0,.05)" } },
      ],
    },
  ],
  confidence: 0.84,
}

describe("analyzeImage", () => {
  test("returns ProjectScaffold-shaped output that round-trips Zod", () => {
    const scaffold = analyzeImage(FIXTURE)
    expect(() => ProjectScaffoldSchema.parse(scaffold)).not.toThrow()
  })

  test("synthesises sections from top-level ImageElement entries", () => {
    const scaffold = analyzeImage(FIXTURE)
    expect(scaffold.sections).toHaveLength(2)
    expect(scaffold.sections[0].name).toBe("hero")
    expect(scaffold.sections[0].bounds.h).toBe(480)
    expect(scaffold.sections[0].file.exportName).toBe("Hero")
    expect(scaffold.sections[1].name).toBe("grid")
    expect(scaffold.sections[1].file.exportName).toBe("Grid")
    expect(scaffold.sections[1].file.patterns).toContain("ui:Card")
  })

  test("maps LLM tokens to DesignTokenSystem with semantic inference", () => {
    const scaffold = analyzeImage(FIXTURE)
    expect(scaffold.tokens.colors).toHaveLength(4)
    const bg = scaffold.tokens.colors.find((c) => c.value === "#ffffff")
    expect(bg?.semantic).toBe("background")
    const text = scaffold.tokens.colors.find((c) => c.value === "#1f2937")
    expect(text?.semantic).toBe("text")
    const muted = scaffold.tokens.colors.find((c) => c.value === "#9ca3af")
    expect(muted?.semantic).toBe("text-muted")
    // Primary has no semantic hint in our SEMANTIC_NAME_HINTS — undefined.
    const primary = scaffold.tokens.colors.find((c) => c.value === "#1890ff")
    expect(primary?.semantic).toBeUndefined()
  })

  test("aggregates spacing and radii from element padding / borderRadius", () => {
    const scaffold = analyzeImage(FIXTURE)
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
    const scaffold = analyzeImage(FIXTURE)
    const inter = scaffold.tokens.fonts.find((f) => f.family === "Inter")
    expect(inter).toBeDefined()
    expect(inter!.weights).toContain(400)
    expect(inter!.weights).toContain(700)
    expect(inter!.sizes).toContain(14)
    expect(inter!.sizes).toContain(32)
  })

  test("emits empty pattern catalog (image flow skips fingerprint detection)", () => {
    const scaffold = analyzeImage(FIXTURE)
    expect(scaffold.catalog.patterns).toEqual([])
    expect(scaffold.catalog.totalElements).toBeGreaterThan(0)
    expect(scaffold.catalog.coveredElements).toBe(0)
  })

  test("synthesised scaffold drives the shared scaffold-helpers without errors", () => {
    const scaffold = analyzeImage(FIXTURE)
    const tokensFile = generateTokensFile(scaffold)
    expect(tokensFile.code).toContain("export const COLORS")
    expect(tokensFile.code).toContain("background:")
    expect(tokensFile.code).toContain("\"#ffffff\"")
    expect(tokensFile.code).toContain("export const FONTS")
    expect(tokensFile.code).toContain("export const SPACING")
    expect(tokensFile.code).toContain("export const RADII")

    const appFile = generateAppFile(scaffold)
    expect(appFile.code).toContain("import { Hero }")
    expect(appFile.code).toContain("import { Grid }")
    expect(appFile.code).toContain("<Hero />")

    const ctx = buildSharedContext(scaffold, {
      title: "demo",
      viewport: { width: 1440, height: 900 },
    })
    expect(ctx).toContain("Page: demo")
    expect(ctx).toContain("Viewport: 1440x900")
    expect(ctx).not.toContain("URL:") // image flow has no URL
  })

  test("rejects malformed input via the Zod boundary", () => {
    expect(() =>
      analyzeImage({
        description: "x",
        viewport: { width: 1440, height: 900 },
        tokens: { colors: {}, fonts: [], textStyles: [] },
        tree: [],
        confidence: 0.5,
      } as unknown as ImageAnalysis),
    ).toThrow(AnalyzeError)
  })
})
