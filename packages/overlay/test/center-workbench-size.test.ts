import { describe, expect, test } from "bun:test"

import { centerWorkbenchResizeRange, clampCenterWorkbenchResizeWidth } from "../src/utils/center-workbench-size"

describe("center workbench legal resize range", () => {
  test("exposes a legal range when both adjacent panels can satisfy the minimum", () => {
    const range = centerWorkbenchResizeRange(800, 280)
    expect(range).toEqual({ minWidth: 280, maxWidth: 520 })
    expect(clampCenterWorkbenchResizeWidth(range!, 120)).toBe(280)
    expect(clampCenterWorkbenchResizeWidth(range!, 680)).toBe(520)
  })

  test("rejects resize writes when adjacent panels cannot both satisfy the minimum", () => {
    expect(centerWorkbenchResizeRange(500, 280)).toBeNull()
  })

  test("clamp consumes the measured range instead of recomputing it", () => {
    expect(clampCenterWorkbenchResizeWidth({ minWidth: 300, maxWidth: 450 }, 375)).toBe(375)
    expect(() => clampCenterWorkbenchResizeWidth({ minWidth: 450, maxWidth: 300 }, 375)).toThrow(
      "Center workbench resize range maximum width must be greater than or equal to the minimum width.",
    )
  })
})
