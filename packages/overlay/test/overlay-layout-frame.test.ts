import { describe, expect, test } from "bun:test"

import { constrainOverlayLayoutFrame } from "../src/utils/overlay-layout-frame"

describe("overlay legal layout frame", () => {
  const constraints = {
    minimum: { width: 1120, height: 720 },
    minimumAspectRatio: 1,
  }

  test("keeps the native minimum floor", () => {
    expect(constrainOverlayLayoutFrame({ width: 640, height: 480 }, constraints)).toEqual(constraints.minimum)
  })

  test("preserves square viewports", () => {
    expect(constrainOverlayLayoutFrame({ width: 1120, height: 1120 }, constraints)).toEqual({
      width: 1120,
      height: 1120,
    })
  })

  test("clamps taller-than-square viewports to the minimum aspect ratio", () => {
    expect(constrainOverlayLayoutFrame({ width: 1120, height: 1300 }, constraints)).toEqual({
      width: 1120,
      height: 1120,
    })
  })

  test("preserves wide fullscreen viewports", () => {
    expect(constrainOverlayLayoutFrame({ width: 1600, height: 720 }, constraints)).toEqual({
      width: 1600,
      height: 720,
    })
  })

  test("preserves legal desktop viewports", () => {
    expect(constrainOverlayLayoutFrame({ width: 1280, height: 760 }, constraints)).toEqual({
      width: 1280,
      height: 760,
    })
  })

  test("derives taller legal frames from the square ratio", () => {
    const frame = constrainOverlayLayoutFrame({ width: 1600, height: 1800 }, constraints)

    expect(frame.width).toBe(1600)
    expect(frame.height).toBe(1600)
  })
})
