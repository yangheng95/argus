import { layoutTokenPx } from "./layout-tokens"

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
  maximumAspect: OverlayViewportSize
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
  const { minimum, maximumAspect } = constraints
  assertPositiveFinite(minimum.width, "Overlay minimum width")
  assertPositiveFinite(minimum.height, "Overlay minimum height")
  assertPositiveFinite(maximumAspect.width, "Overlay maximum aspect width")
  assertPositiveFinite(maximumAspect.height, "Overlay maximum aspect height")

  const minimumAspectRatio = minimum.width / minimum.height
  const maximumAspectRatio = maximumAspect.width / maximumAspect.height
  if (maximumAspectRatio < minimumAspectRatio) {
    throw new Error("Overlay maximum aspect ratio must be greater than or equal to the minimum aspect ratio.")
  }

  let width = Math.max(viewport.width, minimum.width)
  const height = Math.max(minimum.height, Math.min(viewport.height, width / minimumAspectRatio))
  width = Math.max(minimum.width, Math.min(width, height * maximumAspectRatio))
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
    maximumAspect: {
      width: layoutTokenPx("--ui-overlay-max-aspect-width"),
      height: layoutTokenPx("--ui-overlay-max-aspect-height"),
    },
  }
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
  }
  return constrainOverlayLayoutFrame(viewport, constraints)
}
