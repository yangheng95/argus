import { expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { screenshotPixelSummary } from "../../src/mcp/browser/tools"

test("browser screenshot CDP session detaches on capture errors", () => {
  const source = fs.readFileSync(path.join(import.meta.dir, "../../src/mcp/browser/tools.ts"), "utf8")
  expect(source).toContain('cdp.send("Page.captureScreenshot"')
  expect(source).toMatch(/finally\s*\{\s*await cdp\.detach\(\)\.catch\(\(\)\s*=>\s*undefined\)/s)
})

test("browser screenshot pixel summary warns when compression is too high", () => {
  const summary = screenshotPixelSummary(3000, 2000)

  expect(summary.currentPixels).toBe(6_000_000)
  expect(summary.compressedPixels).toBe(1_048_576)
  expect(summary.compressionRatio).toBe(5.72)
  expect(summary.preferPartialScreenshot).toBe(true)
  expect(summary.text).toContain("当前像素: 6000000 (3000x2000)")
  expect(summary.text).toContain("压缩后像素: 1048576")
  expect(summary.text).toContain("压缩率过大，请优先使用 selector 或 clip 做局部截图")
})

test("browser screenshot pixel summary keeps viewport screenshots unflagged", () => {
  const summary = screenshotPixelSummary(640, 480)

  expect(summary.currentPixels).toBe(307_200)
  expect(summary.compressedPixels).toBe(307_200)
  expect(summary.compressionRatio).toBe(1)
  expect(summary.preferPartialScreenshot).toBe(false)
  expect(summary.text).not.toContain("压缩率过大")
})
