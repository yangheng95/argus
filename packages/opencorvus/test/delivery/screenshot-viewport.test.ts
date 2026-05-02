import { describe, expect, test } from "bun:test"
import { normalizeDeliveryScreenshotViewport } from "../../src/delivery/tools"

describe("delivery screenshot viewport", () => {
  test("keeps normal captures inside the defensive viewport", () => {
    expect(normalizeDeliveryScreenshotViewport({ width: 1280, height: 720 })).toEqual({
      width: 1280,
      height: 720,
      capped: false,
    })
  })

  test("caps capture viewport without requiring host display resolution changes", () => {
    expect(normalizeDeliveryScreenshotViewport({ width: 4096, height: 2160 })).toEqual({
      width: 1440,
      height: 1080,
      capped: true,
    })
  })
})
