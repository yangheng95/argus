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

  test("150% DPI: logical mode converts screenshot coords to OS coords", () => {
    // Real scenario: VS Code is 2560x1392 logical at (0,0).
    // Screenshot is 3840x2088 physical pixels (1.5x DPI).
    // Model identifies terminal at y≈1900 in screenshot space.
    // Without DPI conversion, nut.js gets y=1900 logical → off-screen.
    // With logical mode, 1900/1.5 = 1267 logical → inside window.
    const dpi150: Coordinates.WindowBounds = {
      x: 0,
      y: 0,
      width: 3840,
      height: 2088,
      scaleX: 1.5,
      scaleY: 1.5,
      logicalX: 0,
      logicalY: 0,
      logicalWidth: 2560,
      logicalHeight: 1392,
    }

    const result = Coordinates.resolveDetailed(300, 1900, dpi150, "logical")
    expect(result.x).toBe(200)   // 300 / 1.5 = 200
    expect(result.y).toBe(1267)  // 1900 / 1.5 ≈ 1267
    expect(result.clamped).toBe(false)

    // Verify the physical path would give wrong (off-screen) coordinates
    const physical = Coordinates.resolveDetailed(300, 1900, dpi150, "physical")
    expect(physical.x).toBe(300)
    expect(physical.y).toBe(1900)  // This would be off-screen on a 1440-tall logical display
  })

  test("auto mode chooses logical when dpi scale differs from 1", () => {
    const dpi150: Coordinates.WindowBounds = {
      x: 0,
      y: 0,
      width: 3840,
      height: 2088,
      scaleX: 1.5,
      scaleY: 1.5,
      logicalX: 0,
      logicalY: 0,
      logicalWidth: 2560,
      logicalHeight: 1392,
    }
    expect(Coordinates.resolveSpace(300, 1900, dpi150, "auto")).toBe("logical")
    const result = Coordinates.resolveDetailed(300, 1900, dpi150, "auto")
    expect(result.x).toBe(200)
    expect(result.y).toBe(1267)
  })

  test("auto mode chooses physical when scale is 1", () => {
    const unitScale: Coordinates.WindowBounds = {
      x: 10,
      y: 20,
      width: 1920,
      height: 1080,
      scaleX: 1,
      scaleY: 1,
      logicalX: 10,
      logicalY: 20,
      logicalWidth: 1920,
      logicalHeight: 1080,
    }
    expect(Coordinates.resolveSpace(400, 500, unitScale, "auto")).toBe("physical")
    const result = Coordinates.resolveDetailed(400, 500, unitScale, "auto")
    expect(result.x).toBe(410)
    expect(result.y).toBe(520)
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
