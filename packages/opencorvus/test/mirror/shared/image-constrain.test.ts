import { describe, test, expect } from "bun:test"
import { PNG } from "pngjs"
import {
  constrainImage,
  probeImageDimensions,
  DEFAULT_MAX_DIMENSION,
} from "../../../src/mirror/shared/image-constrain"

function makePng(width: number, height: number, r = 255, g = 0, b = 0): Buffer {
  const png = new PNG({ width, height })
  for (let i = 0; i < width * height * 4; i += 4) {
    png.data[i] = r
    png.data[i + 1] = g
    png.data[i + 2] = b
    png.data[i + 3] = 255
  }
  return PNG.sync.write(png)
}

function toDataUrl(buf: Buffer, mime = "image/png"): string {
  return `data:${mime};base64,${buf.toString("base64")}`
}

describe("probeImageDimensions", () => {
  test("reads PNG IHDR", () => {
    const buf = makePng(120, 60)
    expect(probeImageDimensions(buf)).toEqual({ width: 120, height: 60 })
  })

  test("returns null for unknown magic", () => {
    expect(probeImageDimensions(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull()
  })
})

describe("constrainImage", () => {
  test("returns URL unchanged when already within limit", async () => {
    const buf = makePng(100, 100)
    const url = toDataUrl(buf)
    const result = await constrainImage(url, DEFAULT_MAX_DIMENSION)
    expect(result).toBe(url)
  })

  test("downscales oversized PNG preserving aspect ratio", async () => {
    const buf = makePng(200, 100)
    const url = toDataUrl(buf)
    const result = await constrainImage(url, 100)
    expect(result).not.toBe(url)
    expect(result.startsWith("data:image/png;base64,")).toBe(true)

    // Decode and verify dimensions
    const resultBuf = Buffer.from(result.split(",")[1], "base64")
    const dims = probeImageDimensions(resultBuf)
    expect(dims?.width).toBe(100)
    expect(dims?.height).toBe(50)
  })

  test("handles square → square", async () => {
    const buf = makePng(400, 400)
    const url = toDataUrl(buf)
    const result = await constrainImage(url, 100)
    const resultBuf = Buffer.from(result.split(",")[1], "base64")
    const dims = probeImageDimensions(resultBuf)
    expect(dims?.width).toBe(100)
    expect(dims?.height).toBe(100)
  })

  test("returns URL unchanged when data URL is malformed", async () => {
    const url = "data:"
    expect(await constrainImage(url)).toBe(url)
  })
})
