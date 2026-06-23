import { describe, expect, test } from "bun:test"

import { constrainOverlayLayoutFrame } from "../src/utils/overlay-layout-frame"

describe("overlay legal layout frame", () => {
  const constraints = {
    minimum: { width: 1120, height: 720 },
    maximumAspect: { width: 1280, height: 720 },
  }

  test("keeps the native minimum floor", () => {
    expect(constrainOverlayLayoutFrame({ width: 640, height: 480 }, constraints)).toEqual(constraints.minimum)
  })

  test("clamps illegal tall viewports to the minimum aspect ratio", () => {
    expect(constrainOverlayLayoutFrame({ width: 1120, height: 1000 }, constraints)).toEqual({
      width: 1120,
      height: 720,
    })
  })

  test("clamps illegal wide viewports to the maximum aspect ratio", () => {
    expect(constrainOverlayLayoutFrame({ width: 1600, height: 720 }, constraints)).toEqual({
      width: 1280,
      height: 720,
    })
  })

  test("preserves legal desktop viewports", () => {
    expect(constrainOverlayLayoutFrame({ width: 1280, height: 760 }, constraints)).toEqual({
      width: 1280,
      height: 760,
    })
  })

  test("derives taller legal frames from the same minimum ratio", () => {
    const frame = constrainOverlayLayoutFrame({ width: 1600, height: 1100 }, constraints)

    expect(frame.width).toBe(1600)
    expect(frame.height).toBeCloseTo(1028.5714285714287, 6)
  })
})
