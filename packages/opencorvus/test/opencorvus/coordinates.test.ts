import { describe, expect, test } from "bun:test"
import { Coordinates } from "../../src/opencorvus/gui/coordinates"
import { Capture } from "../../src/opencorvus/perception/capture"

describe("Coordinates.resolveDetailed", () => {
  const bounds: Coordinates.WindowBounds = {
    x: 100,
    y: 200,
    width: 300,
    height: 400,
  }

  test("maps window-relative coordinates to screen coordinates", () => {
    const result = Coordinates.resolveDetailed(10, 20, bounds)
    expect(result.x).toBe(110)
    expect(result.y).toBe(220)
    expect(result.clamped).toBe(false)
    expect(result.clampedX).toBe(false)
    expect(result.clampedY).toBe(false)
  })

  test("clamps out-of-range coordinates and marks clamp flags", () => {
    const result = Coordinates.resolveDetailed(999, -5, bounds)
    expect(result.x).toBe(399)
    expect(result.y).toBe(200)
    expect(result.clamped).toBe(true)
    expect(result.clampedX).toBe(true)
    expect(result.clampedY).toBe(true)
  })

  test("passes through absolute coordinates when no bounds are provided", () => {
    const result = Coordinates.resolveDetailed(640, 480, null)
    expect(result.x).toBe(640)
    expect(result.y).toBe(480)
    expect(result.clamped).toBe(false)
    expect(result.clampedX).toBe(false)
    expect(result.clampedY).toBe(false)
  })

  test("maps screenshot coordinates to logical coordinates when requested", () => {
    const result = Coordinates.resolveDetailed(450, 300, {
      x: 300,
      y: 150,
      width: 1200,
      height: 900,
      scaleX: 1.5,
      scaleY: 1.5,
      logicalX: 200,
      logicalY: 100,
      logicalWidth: 800,
      logicalHeight: 600,
    }, "logical")
    expect(result.x).toBe(500)
    expect(result.y).toBe(300)
    expect(result.clamped).toBe(false)
  })

  test("falls back to physical mapping when logical metadata is incomplete", () => {
    const result = Coordinates.resolveDetailed(450, 300, {
      x: 300,
      y: 150,
      width: 1200,
      height: 900,
      scaleX: 1.5,
      scaleY: 1.5,
      logicalX: 200,
      logicalY: 100,
      logicalWidth: 0,
      logicalHeight: 0,
    }, "logical")
    expect(result.x).toBe(750)
    expect(result.y).toBe(450)
    expect(result.clamped).toBe(false)
  })
})

describe("Capture.scaleWindowBounds", () => {
  test("scales logical bounds into image space", () => {
    const result = Capture.scaleWindowBounds({
      logicalX: 100,
      logicalY: 50,
      logicalWidth: 800,
      logicalHeight: 600,
      imageWidth: 1200,
      imageHeight: 900,
    })
    expect(result.x).toBe(150)
    expect(result.y).toBe(75)
    expect(result.scaleX).toBe(1.5)
    expect(result.scaleY).toBe(1.5)
  })

  test("uses identity scaling when logical size is invalid", () => {
    const result = Capture.scaleWindowBounds({
      logicalX: 40,
      logicalY: 30,
      logicalWidth: 0,
      logicalHeight: 0,
      imageWidth: 1000,
      imageHeight: 700,
    })
    expect(result.x).toBe(40)
    expect(result.y).toBe(30)
    expect(result.scaleX).toBe(1)
    expect(result.scaleY).toBe(1)
    expect(result.logicalWidth).toBe(0)
    expect(result.logicalHeight).toBe(0)
  })
})
