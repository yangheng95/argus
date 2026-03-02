export namespace Coordinates {
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

  /** Window-relative coordinates → screen-absolute coordinates (with clamp to prevent out-of-bounds) */
  export function toScreen(relX: number, relY: number, bounds: WindowBounds): ScreenPoint {
    const resolved = toScreenDetailed(relX, relY, bounds)
    return { x: resolved.x, y: resolved.y }
  }

  export function toScreenDetailed(relX: number, relY: number, bounds: WindowBounds): ResolvedPoint {
    if (bounds.width <= 0 || bounds.height <= 0) {
      throw new Error(`WindowBounds has zero dimensions (${bounds.width}x${bounds.height}) — window may be minimized`)
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
  export function resolve(x: number, y: number, bounds: WindowBounds | null): ScreenPoint {
    const resolved = resolveDetailed(x, y, bounds)
    return { x: resolved.x, y: resolved.y }
  }

  export function resolveDetailed(x: number, y: number, bounds: WindowBounds | null): ResolvedPoint {
    if (bounds) {
      return toScreenDetailed(x, y, bounds)
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
