import { afterEach, describe, expect, test } from "bun:test"
import { PNG } from "pngjs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { computeVisualMetric, type VisualThresholdsType } from "../../src/acceptance/visual-metric"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("visual metric text evidence", () => {
  test("fails when text evidence is missing even if image gates pass", async () => {
    const paths = await writeMatchingPNGs()

    const missingReferenceStrings = await computeVisualMetric({
      renderedPath: paths.rendered,
      referencePath: paths.reference,
      renderedText: "Reference copy",
      thresholds,
    })
    const missingRenderedText = await computeVisualMetric({
      renderedPath: paths.rendered,
      referencePath: paths.reference,
      referenceStrings: ["Reference copy"],
      thresholds,
    })

    for (const result of [missingReferenceStrings, missingRenderedText]) {
      const textGate = result.gates.find((gate) => gate.name === "text_hit_ratio")
      expect(result.gates.filter((gate) => gate.name !== "text_hit_ratio").every((gate) => gate.passed)).toBe(true)
      expect(result.passed).toBe(false)
      expect(textGate?.passed).toBe(false)
      expect(Number.isNaN(textGate?.value)).toBe(true)
      expect(textGate?.note).toContain("missing referenceStrings/renderedText evidence")
      expect(result.score).toBeLessThan(1)
    }
  })

  test("fails placeholder copy while identical screenshots pass image gates", async () => {
    const paths = await writeMatchingPNGs()

    const result = await computeVisualMetric({
      renderedPath: paths.rendered,
      referencePath: paths.reference,
      referenceStrings: ["Market overview", "Revenue growth"],
      renderedText: "Lorem ipsum placeholder text",
      thresholds,
    })

    const textGate = result.gates.find((gate) => gate.name === "text_hit_ratio")
    expect(result.gates.filter((gate) => gate.name !== "text_hit_ratio").every((gate) => gate.passed)).toBe(true)
    expect(textGate?.passed).toBe(false)
    expect(textGate?.value).toBe(0)
    expect(result.passed).toBe(false)
  })

  test("passes text gate only when required reference strings are present", async () => {
    const paths = await writeMatchingPNGs()

    const result = await computeVisualMetric({
      renderedPath: paths.rendered,
      referencePath: paths.reference,
      referenceStrings: ["Market overview", "Revenue growth"],
      renderedText: "Revenue growth is visible in the Market overview.",
      thresholds,
    })

    const textGate = result.gates.find((gate) => gate.name === "text_hit_ratio")
    expect(textGate?.passed).toBe(true)
    expect(textGate?.value).toBe(1)
    expect(result.passed).toBe(true)
  })
})

async function writeMatchingPNGs(): Promise<{ rendered: string; reference: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-visual-metric-"))
  tempDirs.push(dir)
  const rendered = path.join(dir, "rendered.png")
  const reference = path.join(dir, "reference.png")
  const buffer = pngBuffer([20, 40, 60, 255])
  await fs.writeFile(rendered, buffer)
  await fs.writeFile(reference, buffer)
  return { rendered, reference }
}

function pngBuffer(rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width: 1, height: 1 })
  png.data[0] = rgba[0]
  png.data[1] = rgba[1]
  png.data[2] = rgba[2]
  png.data[3] = rgba[3]
  return PNG.sync.write(png)
}

const thresholds: VisualThresholdsType = {
  phash_hamming_max: 0,
  ssim_min: 0.99,
  chart_region_density_min_ratio: 1,
  unique_color_ratio_min: 1,
  text_hit_ratio_min: 0.7,
  score_weights: {
    phash: 0.25,
    ssim: 0.25,
    density: 0.25,
    text_hit: 0.25,
  },
}
