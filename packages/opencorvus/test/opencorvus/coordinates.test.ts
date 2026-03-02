import { describe, expect, test } from "bun:test"
import { Coordinates } from "../../src/opencorvus/gui/coordinates"

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
})
