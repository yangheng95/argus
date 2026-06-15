import { describe, expect, test } from "bun:test"
import path from "node:path"
import { normalizeRuntimeCaptureRequest, normalizeRuntimeCaptureViewport } from "../../src/runtime/capture-contract"

describe("runtime page capture", () => {
  test("keeps normal captures inside the defensive viewport", () => {
    expect(normalizeRuntimeCaptureViewport({ width: 1280, height: 720 })).toEqual({
      width: 1280,
      height: 720,
      capped: false,
    })
  })

  test("caps capture viewport without requiring host display resolution changes", () => {
    expect(normalizeRuntimeCaptureViewport({ width: 4096, height: 2160 })).toEqual({
      width: 1440,
      height: 1080,
      capped: true,
    })
  })

  test("runtime capture applies defaults before viewport normalization", () => {
    expect(normalizeRuntimeCaptureRequest({ url: "http://localhost:4173" })).toEqual({
      url: "http://localhost:4173",
      viewport_width: 1440,
      viewport_height: 1080,
      min_dom_descendants: 20,
      expect_selectors: [],
      expect_texts: [],
      wait_timeout_ms: 30_000,
      settle_ms: 2_500,
    })
  })

  test("build agent does not expose the retired direct screenshot tool", async () => {
    const source = await Bun.file(path.resolve(import.meta.dir, "../../src/build/agent.ts")).text()

    expect(source).not.toContain("./screenshot-tool")
    expect(source).not.toContain("createBuildScreenshotTool")
    expect(source).not.toContain("captureRuntimePage")
  })
})
