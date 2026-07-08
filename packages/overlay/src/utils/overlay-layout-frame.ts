import { layoutTokenNumber, layoutTokenPx } from "./layout-tokens"

export interface OverlayViewportSize {
  width: number
  height: number
}

export interface OverlayLayoutFrame {
  width: number
  height: number
}

export interface OverlayLayoutFrameConstraints {
  minimum: OverlayViewportSize
  minimumAspectRatio: number
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`)
  }
}

export function constrainOverlayLayoutFrame(
  viewport: OverlayViewportSize,
  constraints: OverlayLayoutFrameConstraints,
): OverlayLayoutFrame {
  assertPositiveFinite(viewport.width, "Overlay viewport width")
  assertPositiveFinite(viewport.height, "Overlay viewport height")
  const { minimum } = constraints
  assertPositiveFinite(minimum.width, "Overlay minimum width")
  assertPositiveFinite(minimum.height, "Overlay minimum height")
  assertPositiveFinite(constraints.minimumAspectRatio, "Overlay minimum aspect ratio")

  const width = Math.max(viewport.width, minimum.width)
  const height = Math.max(minimum.height, Math.min(viewport.height, width / constraints.minimumAspectRatio))
  return { width, height }
}

export function overlayLayoutFrameSize(): OverlayLayoutFrame {
  if (typeof document === "undefined") {
    throw new Error("Overlay layout frame requires a document.")
  }
  if (typeof window === "undefined") {
    throw new Error("Overlay layout frame requires a window.")
  }
  const constraints = {
    minimum: {
      width: layoutTokenPx("--ui-overlay-min-width"),
      height: layoutTokenPx("--ui-overlay-min-height"),
    },
    minimumAspectRatio: layoutTokenNumber("--ui-overlay-min-aspect-ratio"),
  }
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
  }
  return constrainOverlayLayoutFrame(viewport, constraints)
}
