import { describe, expect, test } from "bun:test"
import { evaluateContentFingerprint, type ContentFingerprintInput } from "../../src/acceptance/checks/content-fingerprint"

const baseInput: ContentFingerprintInput = {
  manifest: {
    url: "https://example.test/",
    viewport: { width: 320, height: 240, device_scale_factor: 1 },
    captured_at: 1,
    duration_ms: 1,
    screenshot_sha256: "a".repeat(64),
    dom_sha256: "b".repeat(64),
    screenshot_byte_size: 100,
    har_byte_size: 100,
    non_white_pixel_ratio: 0.5,
    unique_color_count: 8,
    text_length: 20,
    reference_strings: ["Alpha"],
    palette: ["#ffffff"],
    layout: {
      hero: { x: 0, y: 0, width: 100, height: 100 },
    },
    tool_version: {},
  },
  rendered: {
    text: "Alpha beta",
    palette: ["#ffffff"],
    layout: {
      hero: { x: 0, y: 0, width: 100, height: 100 },
    },
  },
  regionIouThreshold: 0.8,
}

describe("content fingerprint acceptance check", () => {
  test("requires an explicit region IoU threshold", () => {
    expect(() =>
      evaluateContentFingerprint({
        ...baseInput,
        regionIouThreshold: undefined as unknown as number,
      }),
    ).toThrow("content fingerprint regionIouThreshold must be in (0, 1]")
  })

  test("uses the explicit region IoU threshold for per-region pass mask", () => {
    const result = evaluateContentFingerprint(baseInput)

    expect(result.stringHitRatio).toBe(1)
    expect(result.paletteJaccard).toBe(1)
    expect(result.regionPassedMask.hero).toBe(true)
  })
})
