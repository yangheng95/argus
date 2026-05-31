import { describe, expect, test } from "bun:test"
import {
  enforceCaptureGate,
  resolveNodeSidecarPlaywrightRequirePath,
  shouldUseNodeCaptureSidecar,
  type CaptureManifestType,
} from "../../src/frontend-design/capture-gate"

function manifest(overrides: Partial<CaptureManifestType>): CaptureManifestType {
  return {
    url: "https://www.baidu.com/",
    viewport: { width: 1440, height: 900, device_scale_factor: 1 },
    captured_at: Date.now(),
    duration_ms: 100,
    screenshot_sha256: "a".repeat(64),
    dom_sha256: "b".repeat(64),
    screenshot_byte_size: 50_000,
    har_byte_size: 50_000,
    non_white_pixel_ratio: 0.1,
    unique_color_count: 32,
    text_length: 100,
    reference_strings: ["百度一下", "新闻", "hao123"],
    palette: ["#ffffff", "#4e6ef2"],
    layout: {},
    tool_version: {},
    ...overrides,
  }
}

describe("capture reference authenticity gate", () => {
  test("accepts sparse but real homepage captures with visible text evidence", () => {
    const result = enforceCaptureGate(
      manifest({
        non_white_pixel_ratio: 0.031948,
        text_length: 80,
        reference_strings: ["百度一下", "新闻", "地图"],
      }),
    )

    expect(result.ok).toBe(true)
  })

  test("still rejects blank sparse captures without content evidence", () => {
    const result = enforceCaptureGate(
      manifest({
        non_white_pixel_ratio: 0.031948,
        text_length: 0,
        reference_strings: [],
        layout: {},
      }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violations.some((v) => v.field === "non_white_pixel_ratio")).toBe(true)
    }
  })

  test("allows forcing in-process browser capture for diagnostics", () => {
    const previous = process.env.OPENCORVUS_CAPTURE_BROWSER_IN_PROCESS
    process.env.OPENCORVUS_CAPTURE_BROWSER_IN_PROCESS = "1"
    try {
      expect(shouldUseNodeCaptureSidecar()).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.OPENCORVUS_CAPTURE_BROWSER_IN_PROCESS
      else process.env.OPENCORVUS_CAPTURE_BROWSER_IN_PROCESS = previous
    }
  })

  test("resolves Playwright for the Node sidecar independently of cwd", () => {
    const resolved = resolveNodeSidecarPlaywrightRequirePath().replace(/\\/g, "/")

    expect(resolved).toContain("/node_modules/playwright/")
    expect(resolved.endsWith("/index.js")).toBe(true)
  })
})
