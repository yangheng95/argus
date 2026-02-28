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
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
  }

  /** Window-relative coordinates → screen-absolute coordinates (with clamp to prevent out-of-bounds) */
  export function toScreen(relX: number, relY: number, bounds: WindowBounds): ScreenPoint {
    if (bounds.width <= 0 || bounds.height <= 0) {
      throw new Error(`WindowBounds has zero dimensions (${bounds.width}x${bounds.height}) — window may be minimized`)
    }
    return {
      x: bounds.x + clamp(relX, 0, bounds.width - 1),
      y: bounds.y + clamp(relY, 0, bounds.height - 1),
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
    if (bounds) {
      return toScreen(x, y, bounds)
    }
    return { x, y }
  }
}
