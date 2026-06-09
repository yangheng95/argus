import { describe, test, expect } from "bun:test"
import { PNG } from "pngjs"
import {
  WEBPAGE_EVALUATE_PASS_SCORE,
  WEBPAGE_HIGH_FIDELITY_PASS_SCORE,
  evaluateVisual,
  EvaluationReportSchema,
  isEvaluationReportPassing,
} from "../../../src/verification/visual/evaluate"
import { EvaluateError } from "../../../src/verification/visual/errors"

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

describe("evaluateVisual", () => {
  test("identical images score 100", async () => {
    const img = makePng(32, 32, [100, 150, 200])
    const result = await evaluateVisual({ originalImage: img, renderedImage: img })
    expect(result.overallScore).toBe(100)
    expect(result.pixelDiffPercent).toBe(0)
    expect(result.dimensionsMatch).toBe(true)
    expect(result.mismatchedPixels).toBe(0)
    expect(result.totalPixels).toBe(32 * 32)
    expect(result.diffImageDataUrl.startsWith("data:image/png;base64,")).toBe(true)
    expect(() => EvaluationReportSchema.parse(result)).not.toThrow()
  })

  test("disjoint colors produce low score and non-zero mismatch", async () => {
    const result = await evaluateVisual({
      originalImage: makePng(16, 16, [255, 0, 0]),
      renderedImage: makePng(16, 16, [0, 255, 0]),
    })
    expect(result.mismatchedPixels).toBeGreaterThan(0)
    expect(result.pixelDiffPercent).toBeGreaterThan(0)
    expect(result.overallScore).toBeLessThan(100)
  })

  test("dimension mismatch triggers resize path and penalty", async () => {
    const result = await evaluateVisual({ originalImage: makePng(64, 64), renderedImage: makePng(32, 32) })
    expect(result.dimensionsMatch).toBe(false)
    expect(result.comparisonDimensions).toEqual({ width: 64, height: 64 })
  })

  test("gradient differences produce a partial score and a diff image", async () => {
    const result = await evaluateVisual({
      originalImage: makeGradient(48, 48, 0),
      renderedImage: makeGradient(48, 48, 5),
    })
    expect(result.overallScore).toBeGreaterThan(0)
    expect(result.overallScore).toBeLessThanOrEqual(100)
    expect(result.diffImageDataUrl.startsWith("data:image/png;base64,")).toBe(true)
  })

  test("throws typed error on unrecognized input", async () => {
    try {
      await evaluateVisual({ originalImage: "not a url or path", renderedImage: makePng(8, 8) })
      throw new Error("should have thrown")
    } catch (error) {
      expect(EvaluateError.isInstance(error)).toBe(true)
      if (EvaluateError.isInstance(error)) {
        expect(error.data.reason).toContain("cannot decode image")
      }
    }
  })

  test("error is EvaluateError instance", async () => {
    try {
      await evaluateVisual({ originalImage: "data:", renderedImage: makePng(8, 8) })
      throw new Error("should have thrown")
    } catch (error) {
      expect(EvaluateError.isInstance(error)).toBe(true)
    }
  })

  test("emit hook fires through all phases", async () => {
    const events: string[] = []
    const img = makePng(16, 16)
    await evaluateVisual({ originalImage: img, renderedImage: img }, { emit: (event) => events.push(event.phase) })
    expect(events).toContain("decode")
    expect(events).toContain("pixelmatch")
    expect(events).toContain("ssim")
    expect(events).toContain("score")
  })

  test("webpage numeric pass threshold defaults to 85 and supports >95 acceptance", () => {
    expect(WEBPAGE_EVALUATE_PASS_SCORE).toBe(85)
    expect(WEBPAGE_HIGH_FIDELITY_PASS_SCORE).toBe(96)
    expect(isEvaluationReportPassing({ overallScore: 85 })).toBe(true)
    expect(isEvaluationReportPassing({ overallScore: 84 })).toBe(false)
    expect(isEvaluationReportPassing({ overallScore: 95 }, WEBPAGE_HIGH_FIDELITY_PASS_SCORE)).toBe(false)
    expect(isEvaluationReportPassing({ overallScore: 96 }, WEBPAGE_HIGH_FIDELITY_PASS_SCORE)).toBe(true)
  })
})
