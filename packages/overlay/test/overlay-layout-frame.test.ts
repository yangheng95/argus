import { describe, expect, test } from "bun:test"

import { constrainOverlayLayoutFrame } from "../src/utils/overlay-layout-frame"

describe("overlay legal layout frame", () => {
  const minimum = { width: 1120, height: 720 }

  test("keeps the native minimum floor", () => {
    expect(constrainOverlayLayoutFrame({ width: 640, height: 480 }, minimum)).toEqual(minimum)
  })

  test("clamps illegal tall viewports to the minimum aspect ratio", () => {
    expect(constrainOverlayLayoutFrame({ width: 1120, height: 1000 }, minimum)).toEqual({
      width: 1120,
      height: 720,
    })
  })

  test("preserves legal desktop viewports", () => {
    expect(constrainOverlayLayoutFrame({ width: 1280, height: 760 }, minimum)).toEqual({
      width: 1280,
      height: 760,
    })
  })

  test("derives taller legal frames from the same minimum ratio", () => {
    const frame = constrainOverlayLayoutFrame({ width: 1600, height: 1100 }, minimum)

    expect(frame.width).toBe(1600)
    expect(frame.height).toBeCloseTo(1028.5714285714287, 6)
  })
})
