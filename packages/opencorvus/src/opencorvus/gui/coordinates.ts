export namespace Coordinates {
  export type CoordinateSpace = "physical" | "logical"

  export interface ScreenPoint {
    x: number
    y: number
  }

  export interface WindowBounds {
    x: number
    y: number
    width: number
    height: number
    scaleX?: number
    scaleY?: number
    logicalX?: number
    logicalY?: number
    logicalWidth?: number
    logicalHeight?: number
  }

  export interface ResolvedPoint extends ScreenPoint {
    clamped: boolean
    clampedX: boolean
    clampedY: boolean
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
  }

  function clampWithMeta(value: number, min: number, max: number): { value: number; clamped: boolean } {
    const result = clamp(value, min, max)
    return {
      value: result,
      clamped: result !== value,
    }
  }

  function positive(value?: number): number | null {
    if (value === undefined) return null
    if (!Number.isFinite(value) || value <= 0) return null
    return value
  }

  function finite(value?: number): number | null {
    if (value === undefined) return null
    if (!Number.isFinite(value)) return null
    return value
  }

  function logical(bounds: WindowBounds) {
    const logicalX = finite(bounds.logicalX)
    const logicalY = finite(bounds.logicalY)
    const logicalWidth = positive(bounds.logicalWidth)
    const logicalHeight = positive(bounds.logicalHeight)
    if (logicalX === null || logicalY === null || logicalWidth === null || logicalHeight === null) return null

    const scaleX = positive(bounds.scaleX) ?? positive(bounds.width / logicalWidth)
    const scaleY = positive(bounds.scaleY) ?? positive(bounds.height / logicalHeight)
    if (scaleX === null || scaleY === null) return null

    return {
      x: logicalX,
      y: logicalY,
      width: logicalWidth,
      height: logicalHeight,
      scaleX,
      scaleY,
    }
  }

  /** Window-relative coordinates → screen-absolute coordinates (with clamp to prevent out-of-bounds) */
  export function toScreen(
    relX: number,
    relY: number,
    bounds: WindowBounds,
    space: CoordinateSpace = "physical",
  ): ScreenPoint {
    const resolved = toScreenDetailed(relX, relY, bounds, space)
    return { x: resolved.x, y: resolved.y }
  }

  export function toScreenDetailed(
    relX: number,
    relY: number,
    bounds: WindowBounds,
    space: CoordinateSpace = "physical",
  ): ResolvedPoint {
    if (bounds.width <= 0 || bounds.height <= 0) {
      throw new Error(`WindowBounds has zero dimensions (${bounds.width}x${bounds.height}) — window may be minimized`)
    }

    if (space === "logical") {
      const info = logical(bounds)
      if (info) {
        const px = clampWithMeta(relX, 0, bounds.width - 1)
        const py = clampWithMeta(relY, 0, bounds.height - 1)
        const logicalX = clampWithMeta(Math.round(px.value / info.scaleX), 0, info.width - 1)
        const logicalY = clampWithMeta(Math.round(py.value / info.scaleY), 0, info.height - 1)
        return {
          x: info.x + logicalX.value,
          y: info.y + logicalY.value,
          clamped: px.clamped || py.clamped || logicalX.clamped || logicalY.clamped,
          clampedX: px.clamped || logicalX.clamped,
          clampedY: py.clamped || logicalY.clamped,
        }
      }
    }

    const cx = clampWithMeta(relX, 0, bounds.width - 1)
    const cy = clampWithMeta(relY, 0, bounds.height - 1)
    return {
      x: bounds.x + cx.value,
      y: bounds.y + cy.value,
      clamped: cx.clamped || cy.clamped,
      clampedX: cx.clamped,
      clampedY: cy.clamped,
    }
  }

  /** Screen-absolute coordinates → window-relative coordinates */
  export function toRelative(screenX: number, screenY: number, bounds: WindowBounds): ScreenPoint {
    return {
      x: screenX - bounds.x,
      y: screenY - bounds.y,
    }
  }

  /** Unified entry: if bounds exist, convert window-relative to screen-absolute; otherwise pass through */
  export function resolve(
    x: number,
    y: number,
    bounds: WindowBounds | null,
    space: CoordinateSpace = "physical",
  ): ScreenPoint {
    const resolved = resolveDetailed(x, y, bounds, space)
    return { x: resolved.x, y: resolved.y }
  }

  export function resolveDetailed(
    x: number,
    y: number,
    bounds: WindowBounds | null,
    space: CoordinateSpace = "physical",
  ): ResolvedPoint {
    if (bounds) {
      return toScreenDetailed(x, y, bounds, space)
    }
    return {
      x,
      y,
      clamped: false,
      clampedX: false,
      clampedY: false,
    }
  }
}
