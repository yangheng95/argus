import { layoutTokenPx } from "./layout-tokens"

export interface OverlayViewportSize {
  width: number
  height: number
}

export interface OverlayLayoutFrame {
  width: number
  height: number
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`)
  }
}

export function constrainOverlayLayoutFrame(
  viewport: OverlayViewportSize,
  minimum: OverlayViewportSize,
): OverlayLayoutFrame {
  assertPositiveFinite(viewport.width, "Overlay viewport width")
  assertPositiveFinite(viewport.height, "Overlay viewport height")
  assertPositiveFinite(minimum.width, "Overlay minimum width")
  assertPositiveFinite(minimum.height, "Overlay minimum height")

  const width = Math.max(viewport.width, minimum.width)
  const minimumAspectRatio = minimum.width / minimum.height
  const height = Math.max(minimum.height, Math.min(viewport.height, width / minimumAspectRatio))
  return { width, height }
}

export function overlayLayoutFrameSize(): OverlayLayoutFrame {
  if (typeof document === "undefined") {
    throw new Error("Overlay layout frame requires a document.")
  }
  if (typeof window === "undefined") {
    throw new Error("Overlay layout frame requires a window.")
  }
  const minimum = {
    width: layoutTokenPx("--ui-overlay-min-width"),
    height: layoutTokenPx("--ui-overlay-min-height"),
  }
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
  }
  return constrainOverlayLayoutFrame(viewport, minimum)
}
