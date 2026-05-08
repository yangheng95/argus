import { describe, test, expect } from "bun:test"
import { PNG } from "pngjs"
import {
  WEBPAGE_EVALUATE_PASS_SCORE,
  evaluateVisual,
  EvaluationReportSchema,
  isEvaluationReportPassing,
} from "../../../src/mirror/visual/evaluate"
import { EvaluateError } from "../../../src/mirror/errors"

// Golden parity — mirror's original service
import { evaluateService as mirrorEvaluate } from "D:/myhexin-local/opencode-private/packages/mirror/src/service/evaluate.ts"

function makePng(w: number, h: number, fill: [number, number, number] = [255, 0, 0]): string {
  const png = new PNG({ width: w, height: h })
  for (let i = 0; i < w * h * 4; i += 4) {
    png.data[i] = fill[0]
    png.data[i + 1] = fill[1]
    png.data[i + 2] = fill[2]
    png.data[i + 3] = 255
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`
}

function makeGradient(w: number, h: number, seed = 0): string {
  const png = new PNG({ width: w, height: h })
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      png.data[i] = (x * 255) / w + seed
      png.data[i + 1] = (y * 255) / h
      png.data[i + 2] = ((x + y) * 128) / (w + h)
      png.data[i + 3] = 255
    }
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`
}

const mirrorCtx = { worktree: ".", onProgress: undefined, onEvent: undefined } as any

describe("evaluateVisual — shape + Zod validation", () => {
  test("identical images score 100", async () => {
    const img = makePng(32, 32, [100, 150, 200])
    const r = await evaluateVisual({ originalImage: img, renderedImage: img })
    expect(r.overallScore).toBe(100)
    expect(r.pixelDiffPercent).toBe(0)
    expect(r.dimensionsMatch).toBe(true)
    expect(r.mismatchedPixels).toBe(0)
    expect(r.totalPixels).toBe(32 * 32)
    expect(r.diffImageDataUrl.startsWith("data:image/png;base64,")).toBe(true)
    expect(() => EvaluationReportSchema.parse(r)).not.toThrow()
  })

  test("disjoint colours produce low score, non-zero mismatch", async () => {
    const a = makePng(16, 16, [255, 0, 0])
    const b = makePng(16, 16, [0, 255, 0])
    const r = await evaluateVisual({ originalImage: a, renderedImage: b })
    expect(r.mismatchedPixels).toBeGreaterThan(0)
    expect(r.pixelDiffPercent).toBeGreaterThan(0)
    expect(r.overallScore).toBeLessThan(100)
  })

  test("dimension mismatch triggers resize path and penalty", async () => {
    const design = makePng(64, 64)
    const rendered = makePng(32, 32) // half area
    const r = await evaluateVisual({ originalImage: design, renderedImage: rendered })
    expect(r.dimensionsMatch).toBe(false)
    expect(r.comparisonDimensions).toEqual({ width: 64, height: 64 })
  })

  test("throws typed error on unrecognised input", async () => {
    try {
      await evaluateVisual({ originalImage: "not a url or path", renderedImage: makePng(8, 8) })
      throw new Error("should have thrown")
    } catch (e) {
      expect(EvaluateError.isInstance(e)).toBe(true)
      if (EvaluateError.isInstance(e)) {
        expect(e.data.reason).toContain("cannot decode image")
      }
    }
  })

  test("error is EvaluateError instance", async () => {
    try {
      await evaluateVisual({ originalImage: "data:", renderedImage: makePng(8, 8) })
      throw new Error("should have thrown")
    } catch (e) {
      expect(EvaluateError.isInstance(e)).toBe(true)
    }
  })

  test("emit hook fires through all phases", async () => {
    const events: string[] = []
    const img = makePng(16, 16)
    await evaluateVisual(
      { originalImage: img, renderedImage: img },
      { emit: (e) => events.push(e.phase) },
    )
    expect(events).toContain("decode")
    expect(events).toContain("pixelmatch")
    expect(events).toContain("ssim")
    expect(events).toContain("score")
  })

  test("webpage numeric pass threshold is 85/100", () => {
    expect(WEBPAGE_EVALUATE_PASS_SCORE).toBe(85)
    expect(isEvaluationReportPassing({ overallScore: 85 })).toBe(true)
    expect(isEvaluationReportPassing({ overallScore: 84 })).toBe(false)
  })
})

// ─── GOLDEN PARITY — byte-level comparison with mirror ────────────────────

describe("evaluateVisual — GOLDEN PARITY with mirror/service/evaluate", () => {
  const cases: Array<{ name: string; a: string; b: string }> = [
    { name: "identical solid", a: makePng(32, 32, [100, 150, 200]), b: makePng(32, 32, [100, 150, 200]) },
    { name: "same size different colours", a: makePng(16, 16, [255, 0, 0]), b: makePng(16, 16, [0, 255, 0]) },
    { name: "same size off-by-one colour", a: makePng(16, 16, [100, 100, 100]), b: makePng(16, 16, [101, 101, 101]) },
    { name: "gradients seed 0 vs 5", a: makeGradient(48, 48, 0), b: makeGradient(48, 48, 5) },
    { name: "design 64x64 vs rendered 32x32", a: makePng(64, 64, [200, 200, 200]), b: makePng(32, 32, [100, 100, 100]) },
    { name: "design 64x32 vs rendered 32x64 (aspect flipped)", a: makePng(64, 32, [80, 80, 80]), b: makePng(32, 64, [80, 80, 80]) },
    { name: "design 128x64 rendered 64x32 (half each dim)", a: makeGradient(128, 64, 0), b: makeGradient(64, 32, 0) },
    { name: "tall design 32x128 rendered 32x16 (rendered much shorter)", a: makeGradient(32, 128, 10), b: makeGradient(32, 16, 10) },
  ]

  for (const c of cases) {
    test(c.name, async () => {
      const ours = await evaluateVisual({ originalImage: c.a, renderedImage: c.b })
      const theirs = await mirrorEvaluate.execute(
        { originalImage: c.a, renderedImage: c.b },
        mirrorCtx,
      )
      // Strict equality on every scalar field.
      expect(ours.overallScore).toBe(theirs.overallScore)
      expect(ours.ssimScore).toBeCloseTo(theirs.ssimScore, 10)
      expect(ours.pixelDiffPercent).toBeCloseTo(theirs.pixelDiffPercent, 10)
      expect(ours.dimensionsMatch).toBe(theirs.dimensionsMatch)
      expect(ours.comparisonDimensions).toEqual(theirs.comparisonDimensions)
      expect(ours.mismatchedPixels).toBe(theirs.mismatchedPixels)
      expect(ours.totalPixels).toBe(theirs.totalPixels)
      // Diff PNG bytes should also match exactly.
      expect(ours.diffImageDataUrl).toBe(theirs.diffImageDataUrl!)
    })
  }
})
