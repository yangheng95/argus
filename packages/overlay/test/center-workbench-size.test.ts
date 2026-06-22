import { describe, expect, test } from "bun:test"

import { centerWorkbenchResizeRange, clampCenterWorkbenchResizeWidth } from "../src/utils/center-workbench-size"

describe("center workbench legal resize range", () => {
  test("exposes a legal range when both adjacent panels can satisfy the minimum", () => {
    expect(centerWorkbenchResizeRange(800, 280)).toEqual({ minWidth: 280, maxWidth: 520 })
    expect(clampCenterWorkbenchResizeWidth(800, 280, 120)).toBe(280)
    expect(clampCenterWorkbenchResizeWidth(800, 280, 680)).toBe(520)
  })

  test("rejects resize writes when adjacent panels cannot both satisfy the minimum", () => {
    expect(centerWorkbenchResizeRange(500, 280)).toBeNull()
    expect(clampCenterWorkbenchResizeWidth(500, 280, 250)).toBeNull()
  })
})
